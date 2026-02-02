import { describe, it, expect, beforeEach } from 'vitest';
import { createKernel, Kernel } from './tick-controller.js';
import type { RunConfig } from '../types/domain.js';
import { parseAmount, formatAmount } from '../types/amount.js';

const defaultConfig: RunConfig = {
  initialCash: parseAmount('10000.00'),
  initialAsset: parseAmount('100.00'),
  tradingFeeBps: 10, // 0.1%
  decayRateBps: 0,
  decayIntervalTicks: 0,
  maxActionsPerTick: 10,
  tickDurationMs: 0,
  maxPrice: parseAmount('1000000.00'),
  minPrice: parseAmount('0.00000001'),
  minQuantity: parseAmount('0.00000001'),
};

describe('Kernel', () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = createKernel('test-run', defaultConfig, 12345, 'v1.0.0');
  });

  describe('initialization', () => {
    it('creates with initial event', () => {
      const events = kernel.getEventStore().getAll();
      expect(events.length).toBe(1);
      expect(events[0]!.eventType).toBe('RUN_CREATED');
    });

    it('starts at tick 0', () => {
      expect(kernel.getCurrentTick()).toBe(0);
    });

    it('is not running initially', () => {
      expect(kernel.isRunning()).toBe(false);
    });
  });

  describe('lifecycle', () => {
    it('starts and stops', () => {
      const startEvent = kernel.start();
      expect(startEvent.eventType).toBe('RUN_STARTED');
      expect(kernel.isRunning()).toBe(true);

      const stopEvent = kernel.stop('test complete');
      expect(stopEvent.eventType).toBe('RUN_STOPPED');
      expect(kernel.isRunning()).toBe(false);
    });

    it('throws when starting twice', () => {
      kernel.start();
      expect(() => kernel.start()).toThrow();
    });

    it('throws when stopping without starting', () => {
      expect(() => kernel.stop('test')).toThrow();
    });
  });

  describe('agent creation', () => {
    it('creates agent with initial balances', () => {
      kernel.start();
      const { agentId, apiKey } = kernel.createAgent('TestBot');

      expect(agentId).toBeDefined();
      expect(apiKey).toMatch(/^mm_/);

      const state = kernel.getState();
      const agent = state.agents.get(agentId);

      expect(agent).toBeDefined();
      expect(agent!.name).toBe('TestBot');
      expect(agent!.cashBalance).toBe(defaultConfig.initialCash);
      expect(agent!.assetBalance).toBe(defaultConfig.initialAsset);
      expect(agent!.status).toBe('active');
    });

    it('emits AGENT_CREATED event', () => {
      kernel.start();
      kernel.createAgent('TestBot');

      const events = kernel.getEventStore().getByType('AGENT_CREATED');
      expect(events.length).toBe(1);
    });
  });

  describe('tick progression', () => {
    it('advances tick and emits events', () => {
      kernel.start();
      const result = kernel.advanceTick();

      expect(result.tickId).toBe(0);
      expect(kernel.getCurrentTick()).toBe(1);

      const tickEvents = result.events.filter(
        (e) => e.eventType === 'TICK_START' || e.eventType === 'TICK_END'
      );
      expect(tickEvents.length).toBe(2);
    });

    it('processes actions in order', () => {
      kernel.start();
      const { agentId: agent1 } = kernel.createAgent('Bot1');
      const { agentId: agent2 } = kernel.createAgent('Bot2');

      // Agent 2 submits first but agent 1's order should match first
      kernel.submitActions(
        agent2,
        [{ type: 'place_limit_order', side: 'ask', price: '100.00', quantity: '5.00' }],
        'key1'
      );
      kernel.submitActions(
        agent1,
        [{ type: 'place_limit_order', side: 'bid', price: '100.00', quantity: '5.00' }],
        'key2'
      );

      const result = kernel.advanceTick();

      // Both orders should be processed
      expect(result.ordersProcessed).toBe(2);
      expect(result.tradesExecuted).toBe(1);
    });
  });

  describe('action submission', () => {
    it('rejects actions when not running', () => {
      const { agentId } = kernel.createAgent('TestBot');
      const results = kernel.submitActions(
        agentId,
        [{ type: 'place_limit_order', side: 'bid', price: '100.00', quantity: '1.00' }],
        'key1'
      );

      expect(results[0]!.status).toBe('rejected');
      expect(results[0]!.reasonCode).toBe('RUN_NOT_ACTIVE');
    });

    it('accepts valid actions when running', () => {
      kernel.start();
      const { agentId } = kernel.createAgent('TestBot');

      const results = kernel.submitActions(
        agentId,
        [{ type: 'place_limit_order', side: 'bid', price: '100.00', quantity: '1.00' }],
        'key1'
      );

      expect(results[0]!.status).toBe('accepted');
    });

    it('handles idempotency', () => {
      kernel.start();
      const { agentId } = kernel.createAgent('TestBot');

      const results1 = kernel.submitActions(
        agentId,
        [{ type: 'place_limit_order', side: 'bid', price: '100.00', quantity: '1.00' }],
        'same-key'
      );

      const results2 = kernel.submitActions(
        agentId,
        [{ type: 'place_limit_order', side: 'bid', price: '100.00', quantity: '1.00' }],
        'same-key'
      );

      expect(results1).toEqual(results2);
    });

    it('enforces rate limits', () => {
      const limitedConfig = { ...defaultConfig, maxActionsPerTick: 2 };
      kernel = createKernel('test-run', limitedConfig, 12345, 'v1.0.0');
      kernel.start();

      const { agentId } = kernel.createAgent('TestBot');

      const results = kernel.submitActions(
        agentId,
        [
          { type: 'place_limit_order', side: 'bid', price: '100.00', quantity: '1.00' },
          { type: 'place_limit_order', side: 'bid', price: '101.00', quantity: '1.00' },
          { type: 'place_limit_order', side: 'bid', price: '102.00', quantity: '1.00' },
        ],
        'key1'
      );

      expect(results[0]!.status).toBe('accepted');
      expect(results[1]!.status).toBe('accepted');
      expect(results[2]!.status).toBe('rejected');
      expect(results[2]!.reasonCode).toBe('RATE_LIMITED');
    });
  });

  describe('event hash chain', () => {
    it('maintains valid hash chain', () => {
      kernel.start();
      kernel.createAgent('Bot1');
      kernel.createAgent('Bot2');
      kernel.advanceTick();
      kernel.advanceTick();

      const verification = kernel.getEventStore().verifyChain();
      expect(verification.valid).toBe(true);
    });
  });

  describe('determinism', () => {
    it('produces identical events with same seed and actions', () => {
      // First run
      const kernel1 = createKernel('run1', defaultConfig, 42, 'v1.0.0');
      kernel1.start();
      const { agentId: a1 } = kernel1.createAgent('Bot1');
      const { agentId: a2 } = kernel1.createAgent('Bot2');

      kernel1.submitActions(
        a1,
        [{ type: 'place_limit_order', side: 'bid', price: '100.00', quantity: '10.00' }],
        'k1'
      );
      kernel1.submitActions(
        a2,
        [{ type: 'place_limit_order', side: 'ask', price: '100.00', quantity: '5.00' }],
        'k2'
      );
      kernel1.advanceTick();

      // Second run (identical)
      const kernel2 = createKernel('run1', defaultConfig, 42, 'v1.0.0');
      kernel2.start();
      const { agentId: b1 } = kernel2.createAgent('Bot1');
      const { agentId: b2 } = kernel2.createAgent('Bot2');

      kernel2.submitActions(
        b1,
        [{ type: 'place_limit_order', side: 'bid', price: '100.00', quantity: '10.00' }],
        'k1'
      );
      kernel2.submitActions(
        b2,
        [{ type: 'place_limit_order', side: 'ask', price: '100.00', quantity: '5.00' }],
        'k2'
      );
      kernel2.advanceTick();

      // Compare final event hashes
      expect(kernel1.getEventStore().getLastHash()).toBe(kernel2.getEventStore().getLastHash());
    });
  });
});
