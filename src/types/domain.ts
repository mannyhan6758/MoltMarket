/**
 * Core domain types for MoltMarket.
 */

import type { Amount } from './amount.js';

// =============================================================================
// Run & Configuration
// =============================================================================

export type RunStatus = 'created' | 'running' | 'stopped' | 'completed';

export interface RunConfig {
  /** Initial CASH balance for each agent */
  initialCash: Amount;
  /** Initial ASSET balance for each agent */
  initialAsset: Amount;
  /** Trading fee in basis points (1 bp = 0.01%) */
  tradingFeeBps: number;
  /** Capital decay rate per interval (in basis points) */
  decayRateBps: number;
  /** Number of ticks between decay applications */
  decayIntervalTicks: number;
  /** Maximum actions per agent per tick */
  maxActionsPerTick: number;
  /** Tick duration in milliseconds (0 = manual advance) */
  tickDurationMs: number;
  /** Maximum price allowed */
  maxPrice: Amount;
  /** Minimum price allowed */
  minPrice: Amount;
  /** Minimum order quantity */
  minQuantity: Amount;
}

export interface Run {
  id: string;
  seed: number;
  scenarioVersion: string;
  status: RunStatus;
  config: RunConfig;
  currentTick: number;
  eventCount: number;
  lastEventHash: string;
  createdAt: Date;
  startedAt: Date | null;
  stoppedAt: Date | null;
}

// =============================================================================
// Agent
// =============================================================================

export type AgentStatus = 'active' | 'bankrupt' | 'inactive';

export interface Agent {
  id: string;
  runId: string;
  apiKeyHash: string;
  name: string;
  cashBalance: Amount;
  assetBalance: Amount;
  status: AgentStatus;
  actionsThisTick: number;
  createdAt: Date;
  bankruptAtTick: number | null;
}

export interface AgentSnapshot {
  agentId: string;
  tickId: number;
  cashBalance: Amount;
  assetBalance: Amount;
  equity: Amount;
  pnl: Amount;
  pnlPct: number;
  maxEquity: Amount;
  drawdown: number;
  tradeCount: number;
  orderCount: number;
  rejectCount: number;
}

// =============================================================================
// Order Book
// =============================================================================

export type OrderSide = 'bid' | 'ask';
export type OrderStatus = 'open' | 'filled' | 'cancelled' | 'expired';

export interface Order {
  id: string;
  runId: string;
  agentId: string;
  side: OrderSide;
  price: Amount;
  quantity: Amount;
  filledQuantity: Amount;
  status: OrderStatus;
  tickCreated: number;
  sequenceNum: number;
  createdAt: Date;
}

export interface BookLevel {
  price: Amount;
  quantity: Amount;
}

export interface OrderBookSnapshot {
  tickId: number;
  bids: BookLevel[];
  asks: BookLevel[];
  spread: Amount | null;
  midPrice: Amount | null;
}

// =============================================================================
// Trade
// =============================================================================

export interface Trade {
  id: string;
  runId: string;
  tickId: number;
  price: Amount;
  quantity: Amount;
  bidOrderId: string;
  askOrderId: string;
  bidAgentId: string;
  askAgentId: string;
  feeTotal: Amount;
  createdAt: Date;
}

// =============================================================================
// Actions
// =============================================================================

export type ActionType = 'place_limit_order' | 'cancel_order';

export interface PlaceLimitOrderAction {
  type: 'place_limit_order';
  side: OrderSide;
  price: string; // Decimal string
  quantity: string; // Decimal string
}

export interface CancelOrderAction {
  type: 'cancel_order';
  orderId: string;
}

export type Action = PlaceLimitOrderAction | CancelOrderAction;

export interface ActionRequest {
  idempotencyKey: string;
  actions: Action[];
}

export type ActionResultStatus = 'accepted' | 'rejected';

export interface ActionResult {
  actionIndex: number;
  status: ActionResultStatus;
  orderId?: string;
  reasonCode?: string;
  message?: string;
}

export interface ActionResponse {
  tickId: number;
  results: ActionResult[];
}

// =============================================================================
// Rejection Codes
// =============================================================================

export type RejectionCode =
  | 'INSUFFICIENT_FUNDS'
  | 'INVALID_PRICE'
  | 'INVALID_QUANTITY'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_NOT_OWNED'
  | 'AGENT_BANKRUPT'
  | 'RATE_LIMITED'
  | 'INVALID_ACTION'
  | 'RUN_NOT_ACTIVE'
  | 'DUPLICATE_IDEMPOTENCY_KEY';

// =============================================================================
// Events
// =============================================================================

export type EventType =
  | 'RUN_CREATED'
  | 'RUN_STARTED'
  | 'RUN_STOPPED'
  | 'TICK_START'
  | 'TICK_END'
  | 'AGENT_CREATED'
  | 'AGENT_BANKRUPT'
  | 'ORDER_PLACED'
  | 'ORDER_CANCELLED'
  | 'ORDER_REJECTED'
  | 'TRADE_EXECUTED'
  | 'BALANCE_UPDATED'
  | 'DECAY_APPLIED'
  | 'RATE_LIMIT_HIT'
  | 'SCENARIO_EVENT';

export interface BaseEvent {
  id: number;
  runId: string;
  tickId: number;
  eventSeq: number;
  eventType: EventType;
  agentId: string | null;
  prevHash: string;
  eventHash: string;
  createdAt: Date;
}

export interface RunCreatedEvent extends BaseEvent {
  eventType: 'RUN_CREATED';
  payload: { config: RunConfig; seed: number; scenarioVersion: string };
}

export interface RunStartedEvent extends BaseEvent {
  eventType: 'RUN_STARTED';
  payload: Record<string, never>;
}

export interface RunStoppedEvent extends BaseEvent {
  eventType: 'RUN_STOPPED';
  payload: { reason: string };
}

export interface TickStartEvent extends BaseEvent {
  eventType: 'TICK_START';
  payload: { tickId: number };
}

export interface TickEndEvent extends BaseEvent {
  eventType: 'TICK_END';
  payload: { tickId: number; ordersProcessed: number; tradesExecuted: number };
}

export interface AgentCreatedEvent extends BaseEvent {
  eventType: 'AGENT_CREATED';
  payload: {
    agentId: string;
    name: string;
    initialCash: string;
    initialAsset: string;
  };
}

export interface AgentBankruptEvent extends BaseEvent {
  eventType: 'AGENT_BANKRUPT';
  payload: { agentId: string; finalCash: string; finalAsset: string };
}

export interface OrderPlacedEvent extends BaseEvent {
  eventType: 'ORDER_PLACED';
  payload: {
    orderId: string;
    agentId: string;
    side: OrderSide;
    price: string;
    quantity: string;
  };
}

export interface OrderCancelledEvent extends BaseEvent {
  eventType: 'ORDER_CANCELLED';
  payload: { orderId: string; agentId: string; reason: string };
}

export interface OrderRejectedEvent extends BaseEvent {
  eventType: 'ORDER_REJECTED';
  payload: { agentId: string; reasonCode: RejectionCode; details: string };
}

export interface TradeExecutedEvent extends BaseEvent {
  eventType: 'TRADE_EXECUTED';
  payload: {
    tradeId: string;
    price: string;
    quantity: string;
    bidOrderId: string;
    askOrderId: string;
    bidAgentId: string;
    askAgentId: string;
    fee: string;
  };
}

export interface BalanceUpdatedEvent extends BaseEvent {
  eventType: 'BALANCE_UPDATED';
  payload: {
    agentId: string;
    cashDelta: string;
    assetDelta: string;
    newCash: string;
    newAsset: string;
    reason: string;
  };
}

export interface DecayAppliedEvent extends BaseEvent {
  eventType: 'DECAY_APPLIED';
  payload: { agentId: string; amount: string; newCash: string };
}

export interface RateLimitHitEvent extends BaseEvent {
  eventType: 'RATE_LIMIT_HIT';
  payload: { agentId: string; actionsAttempted: number; limit: number };
}

export interface ScenarioEventEvent extends BaseEvent {
  eventType: 'SCENARIO_EVENT';
  payload: { scenarioEventType: string; params: Record<string, unknown> };
}

export type Event =
  | RunCreatedEvent
  | RunStartedEvent
  | RunStoppedEvent
  | TickStartEvent
  | TickEndEvent
  | AgentCreatedEvent
  | AgentBankruptEvent
  | OrderPlacedEvent
  | OrderCancelledEvent
  | OrderRejectedEvent
  | TradeExecutedEvent
  | BalanceUpdatedEvent
  | DecayAppliedEvent
  | RateLimitHitEvent
  | ScenarioEventEvent;
