import { describe, it, expect, beforeEach } from 'vitest';
import { createMatchingEngine, MatchingEngine } from './matching-engine.js';
import { createWorldState, addAgent } from '../kernel/world-state.js';
import type { WorldState } from '../kernel/world-state.js';
import type { RunConfig } from '../types/domain.js';
import { parseAmount, formatAmount, formatAmountDisplay } from '../types/amount.js';
import { generateApiKey } from '../utils/hash.js';

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

describe('MatchingEngine', () => {
  let engine: MatchingEngine;
  let state: WorldState;
  let agentA: string;
  let agentB: string;

  beforeEach(() => {
    engine = createMatchingEngine();
    state = createWorldState('test-run', defaultConfig, 12345);

    // Create two agents
    const { agent: a } = addAgent(state, 'AgentA', generateApiKey());
    const { agent: b } = addAgent(state, 'AgentB', generateApiKey());
    agentA = a.id;
    agentB = b.id;
  });

  describe('order placement', () => {
    it('places bid order successfully', () => {
      const result = engine.placeOrder(state, agentA, 'bid', '100.00', '10.00', 10);

      expect(result.rejected).toBe(false);
      expect(result.order).toBeDefined();
      expect(result.order!.side).toBe('bid');
      expect(formatAmountDisplay(result.order!.price)).toBe('100.00');
      expect(formatAmountDisplay(result.order!.quantity)).toBe('10.00');
    });

    it('places ask order successfully', () => {
      const result = engine.placeOrder(state, agentA, 'ask', '100.00', '10.00', 10);

      expect(result.rejected).toBe(false);
      expect(result.order).toBeDefined();
      expect(result.order!.side).toBe('ask');
    });

    it('rejects invalid price format', () => {
      const result = engine.placeOrder(state, agentA, 'bid', 'invalid', '10.00', 10);

      expect(result.rejected).toBe(true);
      expect(result.rejectionCode).toBe('INVALID_ACTION');
    });

    it('rejects zero price', () => {
      const result = engine.placeOrder(state, agentA, 'bid', '0.00', '10.00', 10);

      expect(result.rejected).toBe(true);
      expect(result.rejectionCode).toBe('INVALID_PRICE');
    });

    it('rejects zero quantity', () => {
      const result = engine.placeOrder(state, agentA, 'bid', '100.00', '0.00', 10);

      expect(result.rejected).toBe(true);
      expect(result.rejectionCode).toBe('INVALID_QUANTITY');
    });

    it('rejects bid with insufficient cash', () => {
      // Try to buy more than cash allows
      const result = engine.placeOrder(state, agentA, 'bid', '1000.00', '100.00', 10);
      // 1000 * 100 = 100,000 > 10,000 initial cash

      expect(result.rejected).toBe(true);
      expect(result.rejectionCode).toBe('INSUFFICIENT_FUNDS');
    });

    it('rejects ask with insufficient asset', () => {
      // Try to sell more than owned
      const result = engine.placeOrder(state, agentA, 'ask', '100.00', '200.00', 10);
      // 200 > 100 initial asset

      expect(result.rejected).toBe(true);
      expect(result.rejectionCode).toBe('INSUFFICIENT_FUNDS');
    });
  });

  describe('order matching', () => {
    it('matches crossing orders', () => {
      // Agent A places ask at 100
      engine.placeOrder(state, agentA, 'ask', '100.00', '10.00', 10);

      // Agent B places bid at 100 - should match
      const result = engine.placeOrder(state, agentB, 'bid', '100.00', '10.00', 10);

      expect(result.rejected).toBe(false);
      expect(result.trades).toBeDefined();
      expect(result.trades!.length).toBe(1);

      const trade = result.trades![0]!;
      expect(formatAmountDisplay(trade.price)).toBe('100.00');
      expect(formatAmountDisplay(trade.quantity)).toBe('10.00');
    });

    it('uses resting order price', () => {
      // Resting ask at 99
      engine.placeOrder(state, agentA, 'ask', '99.00', '10.00', 10);

      // Incoming bid at 100 - should trade at 99 (resting price)
      const result = engine.placeOrder(state, agentB, 'bid', '100.00', '10.00', 10);

      expect(result.trades!.length).toBe(1);
      expect(formatAmountDisplay(result.trades![0]!.price)).toBe('99.00');
    });

    it('handles partial fills', () => {
      // Ask for 20
      engine.placeOrder(state, agentA, 'ask', '100.00', '20.00', 10);

      // Bid for only 5
      const result = engine.placeOrder(state, agentB, 'bid', '100.00', '5.00', 10);

      expect(result.trades!.length).toBe(1);
      expect(formatAmountDisplay(result.trades![0]!.quantity)).toBe('5.00');

      // Check order is partially filled
      const askOrder = state.orders.get(Array.from(state.orders.keys())[0]!);
      expect(askOrder!.status).toBe('open');
      expect(formatAmountDisplay(askOrder!.filledQuantity)).toBe('5.00');
    });

    it('matches multiple resting orders', () => {
      // Two asks
      engine.placeOrder(state, agentA, 'ask', '100.00', '5.00', 10);
      engine.placeOrder(state, agentA, 'ask', '101.00', '5.00', 10);

      // Bid for 8 at 101 - should fill first ask fully, second partially
      const result = engine.placeOrder(state, agentB, 'bid', '101.00', '8.00', 10);

      expect(result.trades!.length).toBe(2);
      expect(formatAmountDisplay(result.trades![0]!.quantity)).toBe('5.00'); // First ask filled
      expect(formatAmountDisplay(result.trades![1]!.quantity)).toBe('3.00'); // Second ask partial
    });

    it('respects price-time priority', () => {
      // Multiple asks at same price
      engine.placeOrder(state, agentA, 'ask', '100.00', '5.00', 10);
      state.currentTick++; // Advance to ensure different sequence
      engine.placeOrder(state, agentB, 'ask', '100.00', '5.00', 10);

      // Create third agent
      const { agent: c } = addAgent(state, 'AgentC', generateApiKey());

      // Bid should match first ask (time priority)
      const result = engine.placeOrder(state, c.id, 'bid', '100.00', '3.00', 10);

      expect(result.trades!.length).toBe(1);
      expect(result.trades![0]!.askAgentId).toBe(agentA); // First ask matched
    });

    it('does not match non-crossing orders', () => {
      // Ask at 100
      engine.placeOrder(state, agentA, 'ask', '100.00', '10.00', 10);

      // Bid at 99 - no match
      const result = engine.placeOrder(state, agentB, 'bid', '99.00', '10.00', 10);

      expect(result.trades).toEqual([]);
      expect(state.orders.size).toBe(2); // Both orders remain
    });
  });

  describe('balance updates', () => {
    it('updates balances correctly on trade', () => {
      const initialCashA = state.agents.get(agentA)!.cashBalance;
      const initialAssetA = state.agents.get(agentA)!.assetBalance;

      // A sells 10 @ 100 = 1000 cash
      engine.placeOrder(state, agentA, 'ask', '100.00', '10.00', 10);
      // B buys 10 @ 100 = 1000 cash
      engine.placeOrder(state, agentB, 'bid', '100.00', '10.00', 10);

      const agentAState = state.agents.get(agentA)!;
      const agentBState = state.agents.get(agentB)!;

      // A: gained cash (minus fee), lost asset
      expect(agentAState.assetBalance).toBeLessThan(initialAssetA);

      // B: lost cash (plus fee), gained asset
      expect(agentBState.assetBalance).toBeGreaterThan(defaultConfig.initialAsset);
    });

    it('deducts fees from both parties', () => {
      // Trade 10 @ 100 = 1000 value
      // Fee = 10 bps = 0.1% = 1.00 total, 0.50 per side
      engine.placeOrder(state, agentA, 'ask', '100.00', '10.00', 10);
      const result = engine.placeOrder(state, agentB, 'bid', '100.00', '10.00', 10);

      const trade = result.trades![0]!;
      const expectedFee = parseAmount('1.00'); // 10 bps of 1000
      expect(trade.feeTotal).toBe(expectedFee);
    });
  });

  describe('order cancellation', () => {
    it('cancels own order', () => {
      const placeResult = engine.placeOrder(state, agentA, 'bid', '100.00', '10.00', 10);
      const orderId = placeResult.order!.id;

      const cancelResult = engine.cancelOrder(state, agentA, orderId);

      expect(cancelResult.rejected).toBe(false);
      expect(state.orders.get(orderId)!.status).toBe('cancelled');
    });

    it('rejects cancel of non-existent order', () => {
      const result = engine.cancelOrder(state, agentA, 'fake-order-id');

      expect(result.rejected).toBe(true);
      expect(result.rejectionCode).toBe('ORDER_NOT_FOUND');
    });

    it('rejects cancel of other agent order', () => {
      const placeResult = engine.placeOrder(state, agentA, 'bid', '100.00', '10.00', 10);
      const orderId = placeResult.order!.id;

      const cancelResult = engine.cancelOrder(state, agentB, orderId);

      expect(cancelResult.rejected).toBe(true);
      expect(cancelResult.rejectionCode).toBe('ORDER_NOT_OWNED');
    });

    it('rejects cancel of already cancelled order', () => {
      const placeResult = engine.placeOrder(state, agentA, 'bid', '100.00', '10.00', 10);
      const orderId = placeResult.order!.id;

      engine.cancelOrder(state, agentA, orderId);
      const secondCancel = engine.cancelOrder(state, agentA, orderId);

      expect(secondCancel.rejected).toBe(true);
    });
  });

  describe('determinism', () => {
    it('produces identical results for identical inputs', () => {
      // First run
      const state1 = createWorldState('run1', defaultConfig, 42);
      const { agent: a1 } = addAgent(state1, 'A', 'key1');
      const { agent: b1 } = addAgent(state1, 'B', 'key2');

      const result1_1 = engine.placeOrder(state1, a1.id, 'ask', '100.00', '10.00', 10);
      const result1_2 = engine.placeOrder(state1, b1.id, 'bid', '100.00', '10.00', 10);

      // Second run (identical)
      const state2 = createWorldState('run1', defaultConfig, 42);
      const { agent: a2 } = addAgent(state2, 'A', 'key1');
      const { agent: b2 } = addAgent(state2, 'B', 'key2');

      const result2_1 = engine.placeOrder(state2, a2.id, 'ask', '100.00', '10.00', 10);
      const result2_2 = engine.placeOrder(state2, b2.id, 'bid', '100.00', '10.00', 10);

      // Compare trade prices and quantities
      expect(result1_2.trades![0]!.price).toBe(result2_2.trades![0]!.price);
      expect(result1_2.trades![0]!.quantity).toBe(result2_2.trades![0]!.quantity);

      // Compare final balances
      expect(state1.agents.get(a1.id)!.cashBalance).toBe(state2.agents.get(a2.id)!.cashBalance);
      expect(state1.agents.get(b1.id)!.cashBalance).toBe(state2.agents.get(b2.id)!.cashBalance);
    });
  });
});
