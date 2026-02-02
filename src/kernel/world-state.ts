/**
 * World State - Canonical simulation state.
 * All mutations happen through the kernel and emit events.
 */

import type {
  Agent,
  AgentStatus,
  Order,
  OrderSide,
  OrderStatus,
  Trade,
  RunConfig,
  BookLevel,
} from '../types/domain.js';
import type { Amount } from '../types/amount.js';
import { ZERO, addAmount, subAmount, isNegative, formatAmount } from '../types/amount.js';
import { generateId, hashApiKey, createDeterministicIdGenerator } from '../utils/hash.js';

export interface WorldState {
  // Configuration
  readonly runId: string;
  readonly config: RunConfig;

  // ID generation (deterministic)
  generateId: () => string;

  // State
  agents: Map<string, Agent>;
  agentsByApiKeyHash: Map<string, string>; // apiKeyHash -> agentId
  orders: Map<string, Order>;
  trades: Trade[];

  // Counters
  currentTick: number;
  globalSequence: number;

  // Statistics
  totalTradeVolume: Amount;
  totalFees: Amount;
}

/**
 * Create a new world state.
 */
export function createWorldState(runId: string, config: RunConfig, seed: number = 0): WorldState {
  return {
    runId,
    config,
    generateId: createDeterministicIdGenerator(seed),
    agents: new Map(),
    agentsByApiKeyHash: new Map(),
    orders: new Map(),
    trades: [],
    currentTick: 0,
    globalSequence: 0,
    totalTradeVolume: ZERO,
    totalFees: ZERO,
  };
}

/**
 * Add an agent to the world.
 */
export function addAgent(
  state: WorldState,
  name: string,
  apiKey: string
): { agent: Agent; apiKey: string } {
  const agentId = state.generateId();
  const apiKeyHash = hashApiKey(apiKey);

  const agent: Agent = {
    id: agentId,
    runId: state.runId,
    apiKeyHash,
    name,
    cashBalance: state.config.initialCash,
    assetBalance: state.config.initialAsset,
    status: 'active',
    actionsThisTick: 0,
    createdAt: new Date(),
    bankruptAtTick: null,
  };

  state.agents.set(agentId, agent);
  state.agentsByApiKeyHash.set(apiKeyHash, agentId);

  return { agent, apiKey };
}

/**
 * Get agent by ID.
 */
export function getAgent(state: WorldState, agentId: string): Agent | undefined {
  return state.agents.get(agentId);
}

/**
 * Get agent by API key hash.
 */
export function getAgentByApiKeyHash(state: WorldState, apiKeyHash: string): Agent | undefined {
  const agentId = state.agentsByApiKeyHash.get(apiKeyHash);
  if (!agentId) return undefined;
  return state.agents.get(agentId);
}

/**
 * Update agent balance.
 */
export function updateAgentBalance(
  state: WorldState,
  agentId: string,
  cashDelta: Amount,
  assetDelta: Amount
): { success: boolean; newCash: Amount; newAsset: Amount } {
  const agent = state.agents.get(agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  const newCash = addAmount(agent.cashBalance, cashDelta);
  const newAsset = addAmount(agent.assetBalance, assetDelta);

  agent.cashBalance = newCash;
  agent.assetBalance = newAsset;

  return { success: true, newCash, newAsset };
}

/**
 * Mark agent as bankrupt.
 */
export function bankruptAgent(state: WorldState, agentId: string): void {
  const agent = state.agents.get(agentId);
  if (!agent) return;

  agent.status = 'bankrupt';
  agent.bankruptAtTick = state.currentTick;

  // Cancel all open orders for this agent
  for (const order of state.orders.values()) {
    if (order.agentId === agentId && order.status === 'open') {
      order.status = 'cancelled';
    }
  }
}

/**
 * Check if agent should be bankrupt.
 */
export function shouldBeBankrupt(agent: Agent): boolean {
  return isNegative(agent.cashBalance);
}

/**
 * Add an order to the book.
 */
export function addOrder(
  state: WorldState,
  agentId: string,
  side: OrderSide,
  price: Amount,
  quantity: Amount
): Order {
  const orderId = state.generateId();

  const order: Order = {
    id: orderId,
    runId: state.runId,
    agentId,
    side,
    price,
    quantity,
    filledQuantity: ZERO,
    status: 'open',
    tickCreated: state.currentTick,
    sequenceNum: state.globalSequence++,
    createdAt: new Date(),
  };

  state.orders.set(orderId, order);
  return order;
}

/**
 * Get order by ID.
 */
export function getOrder(state: WorldState, orderId: string): Order | undefined {
  return state.orders.get(orderId);
}

/**
 * Cancel an order.
 */
export function cancelOrder(state: WorldState, orderId: string): boolean {
  const order = state.orders.get(orderId);
  if (!order || order.status !== 'open') {
    return false;
  }

  order.status = 'cancelled';
  return true;
}

/**
 * Update order fill.
 */
export function fillOrder(state: WorldState, orderId: string, fillQuantity: Amount): void {
  const order = state.orders.get(orderId);
  if (!order) return;

  order.filledQuantity = addAmount(order.filledQuantity, fillQuantity);

  if (order.filledQuantity >= order.quantity) {
    order.status = 'filled';
  }
}

/**
 * Get all open orders for an agent.
 */
export function getAgentOpenOrders(state: WorldState, agentId: string): Order[] {
  return Array.from(state.orders.values()).filter(
    (o) => o.agentId === agentId && o.status === 'open'
  );
}

/**
 * Get all open orders on a side, sorted by price-time priority.
 */
export function getOpenOrdersBySide(state: WorldState, side: OrderSide): Order[] {
  const orders = Array.from(state.orders.values()).filter(
    (o) => o.side === side && o.status === 'open'
  );

  // Sort by price-time priority
  // For bids: highest price first, then lowest sequence (earliest)
  // For asks: lowest price first, then lowest sequence (earliest)
  orders.sort((a, b) => {
    if (side === 'bid') {
      // Higher price = higher priority
      if (a.price !== b.price) {
        return a.price > b.price ? -1 : 1;
      }
    } else {
      // Lower price = higher priority
      if (a.price !== b.price) {
        return a.price < b.price ? -1 : 1;
      }
    }
    // Same price: earlier sequence = higher priority
    return a.sequenceNum - b.sequenceNum;
  });

  return orders;
}

/**
 * Add a trade to history.
 */
export function addTrade(state: WorldState, trade: Trade): void {
  state.trades.push(trade);
  state.totalTradeVolume = addAmount(state.totalTradeVolume, trade.quantity);
  state.totalFees = addAmount(state.totalFees, trade.feeTotal);
}

/**
 * Get recent trades.
 */
export function getRecentTrades(state: WorldState, limit: number): Trade[] {
  return state.trades.slice(-limit);
}

/**
 * Aggregate order book levels.
 */
export function getBookLevels(state: WorldState, side: OrderSide, depth: number): BookLevel[] {
  const orders = getOpenOrdersBySide(state, side);
  const levels = new Map<string, Amount>();

  for (const order of orders) {
    const priceKey = formatAmount(order.price);
    const remaining = subAmount(order.quantity, order.filledQuantity);
    const current = levels.get(priceKey) || ZERO;
    levels.set(priceKey, addAmount(current, remaining));
  }

  // Convert to array and sort
  const result: BookLevel[] = Array.from(levels.entries()).map(([priceStr, quantity]) => ({
    price: BigInt(priceStr.replace('.', '')), // Convert back - simplified
    quantity,
  }));

  // Already sorted by getOpenOrdersBySide, just take top N levels
  // But we need to re-sort by unique price levels
  const uniquePrices = new Map<bigint, Amount>();
  for (const order of orders) {
    const remaining = subAmount(order.quantity, order.filledQuantity);
    if (remaining > ZERO) {
      const current = uniquePrices.get(order.price) || ZERO;
      uniquePrices.set(order.price, addAmount(current, remaining));
    }
  }

  const sorted = Array.from(uniquePrices.entries())
    .map(([price, quantity]) => ({ price, quantity }))
    .sort((a, b) => {
      if (side === 'bid') {
        return a.price > b.price ? -1 : a.price < b.price ? 1 : 0;
      }
      return a.price < b.price ? -1 : a.price > b.price ? 1 : 0;
    });

  return sorted.slice(0, depth);
}

/**
 * Get mid price (average of best bid and best ask).
 */
export function getMidPrice(state: WorldState): Amount | null {
  const bids = getBookLevels(state, 'bid', 1);
  const asks = getBookLevels(state, 'ask', 1);

  if (bids.length === 0 || asks.length === 0) {
    return null;
  }

  return (bids[0]!.price + asks[0]!.price) / 2n;
}

/**
 * Get spread (difference between best ask and best bid).
 */
export function getSpread(state: WorldState): Amount | null {
  const bids = getBookLevels(state, 'bid', 1);
  const asks = getBookLevels(state, 'ask', 1);

  if (bids.length === 0 || asks.length === 0) {
    return null;
  }

  return subAmount(asks[0]!.price, bids[0]!.price);
}

/**
 * Reset agent action counter for new tick.
 */
export function resetAgentActions(state: WorldState): void {
  for (const agent of state.agents.values()) {
    agent.actionsThisTick = 0;
  }
}

/**
 * Increment agent action counter.
 */
export function incrementAgentActions(state: WorldState, agentId: string): number {
  const agent = state.agents.get(agentId);
  if (!agent) return 0;
  agent.actionsThisTick++;
  return agent.actionsThisTick;
}

/**
 * Check if agent is rate limited.
 */
export function isAgentRateLimited(state: WorldState, agentId: string): boolean {
  const agent = state.agents.get(agentId);
  if (!agent) return true;
  return agent.actionsThisTick >= state.config.maxActionsPerTick;
}

/**
 * Get active agents count.
 */
export function getActiveAgentCount(state: WorldState): number {
  let count = 0;
  for (const agent of state.agents.values()) {
    if (agent.status === 'active') count++;
  }
  return count;
}

/**
 * Get bankrupt agents count.
 */
export function getBankruptCount(state: WorldState): number {
  let count = 0;
  for (const agent of state.agents.values()) {
    if (agent.status === 'bankrupt') count++;
  }
  return count;
}
