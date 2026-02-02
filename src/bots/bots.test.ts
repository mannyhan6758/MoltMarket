import { describe, it, expect, beforeEach } from 'vitest';
import { createKernel, Kernel } from '../kernel/tick-controller.js';
import { createBotFleet, runSimulation, runBotTick } from './runner.js';
import type { RunConfig } from '../types/domain.js';
import { parseAmount } from '../types/amount.js';

const defaultConfig: RunConfig = {
  initialCash: parseAmount('10000.00'),
  initialAsset: parseAmount('100.00'),
  tradingFeeBps: 10,
  decayRateBps: 0,
  decayIntervalTicks: 0,
  maxActionsPerTick: 10,
  tickDurationMs: 0,
  maxPrice: parseAmount('1000000.00'),
  minPrice: parseAmount('0.00000001'),
  minQuantity: parseAmount('0.00000001'),
};

describe('Bot Runner', () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = createKernel('test-run', defaultConfig, 42, 'v1.0.0');
  });

  describe('createBotFleet', () => {
    it('creates specified number of bots', () => {
      const bots = createBotFleet(kernel, 42, 10);
      expect(bots).toHaveLength(10);
    });

    it('creates agents in kernel', () => {
      const bots = createBotFleet(kernel, 42, 5);
      const state = kernel.getState();
      expect(state.agents.size).toBe(5);
    });

    it('assigns diverse strategies', () => {
      const bots = createBotFleet(kernel, 42, 10);
      const names = bots.map((b) => b.bot.name);

      // Should have different strategy types
      expect(names.some((n) => n.includes('Random'))).toBe(true);
      expect(names.some((n) => n.includes('MM'))).toBe(true);
      expect(names.some((n) => n.includes('Trend'))).toBe(true);
      expect(names.some((n) => n.includes('MeanRev'))).toBe(true);
      expect(names.some((n) => n.includes('Taker'))).toBe(true);
    });
  });

  describe('runBotTick', () => {
    it('allows bots to submit actions', () => {
      kernel.start();
      const bots = createBotFleet(kernel, 42, 5);

      // Run several ticks to let bots place orders
      for (let i = 0; i < 10; i++) {
        runBotTick(kernel, bots);
        kernel.advanceTick();
      }

      const state = kernel.getState();
      expect(state.orders.size).toBeGreaterThan(0);
    });
  });

  describe('runSimulation', () => {
    it('runs complete simulation', () => {
      const bots = createBotFleet(kernel, 42, 5);
      const result = runSimulation(kernel, bots, 100);

      expect(result.totalTicks).toBe(100);
      expect(result.totalEvents).toBeGreaterThan(0);
      expect(result.finalEventHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('generates trades', () => {
      const bots = createBotFleet(kernel, 42, 10);
      const result = runSimulation(kernel, bots, 200);

      expect(result.totalTrades).toBeGreaterThan(0);
    });

    it('produces deterministic results', () => {
      // First run
      const kernel1 = createKernel('run1', defaultConfig, 42, 'v1.0.0');
      const bots1 = createBotFleet(kernel1, 42, 5);
      const result1 = runSimulation(kernel1, bots1, 100);

      // Second run (identical)
      const kernel2 = createKernel('run1', defaultConfig, 42, 'v1.0.0');
      const bots2 = createBotFleet(kernel2, 42, 5);
      const result2 = runSimulation(kernel2, bots2, 100);

      expect(result1.finalEventHash).toBe(result2.finalEventHash);
      expect(result1.totalTrades).toBe(result2.totalTrades);
      expect(result1.totalEvents).toBe(result2.totalEvents);
    });

    it('produces different results with different seed', () => {
      const kernel1 = createKernel('run1', defaultConfig, 42, 'v1.0.0');
      const bots1 = createBotFleet(kernel1, 42, 5);
      const result1 = runSimulation(kernel1, bots1, 100);

      const kernel2 = createKernel('run2', defaultConfig, 43, 'v1.0.0');
      const bots2 = createBotFleet(kernel2, 43, 5);
      const result2 = runSimulation(kernel2, bots2, 100);

      expect(result1.finalEventHash).not.toBe(result2.finalEventHash);
    });
  });

  describe('agent results', () => {
    it('tracks final balances', () => {
      const bots = createBotFleet(kernel, 42, 5);
      const result = runSimulation(kernel, bots, 100);

      expect(result.agentResults).toHaveLength(5);

      for (const agent of result.agentResults) {
        expect(agent.name).toBeDefined();
        expect(agent.finalCash).toBeDefined();
        expect(agent.finalAsset).toBeDefined();
        expect(agent.status).toBe('active');
      }
    });
  });
});
