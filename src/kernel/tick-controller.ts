/**
 * Tick Controller - Orchestrates simulation tick progression.
 */

import type { Event, EventType, RunConfig, Action, ActionResult, RejectionCode } from '../types/domain.js';
import type { EventStore, EventData } from './event-store.js';
import type { WorldState } from './world-state.js';
import { createEventStore } from './event-store.js';
import {
  createWorldState,
  resetAgentActions,
  isAgentRateLimited,
  incrementAgentActions,
  getAgent,
  shouldBeBankrupt,
  bankruptAgent,
  updateAgentBalance,
  addAgent,
} from './world-state.js';
import { mulBasisPoints, formatAmount, isPositive } from '../types/amount.js';
import type { RNG } from '../utils/rng.js';
import { createRNG } from '../utils/rng.js';
import { generateId, generateApiKey, createDeterministicIdGenerator } from '../utils/hash.js';
import type { MatchingEngine } from '../market/matching-engine.js';
import { createMatchingEngine } from '../market/matching-engine.js';

export interface PendingAction {
  agentId: string;
  action: Action;
  receiveSequence: number;
  idempotencyKey: string;
}

export interface TickResult {
  tickId: number;
  events: Event[];
  ordersProcessed: number;
  tradesExecuted: number;
}

export interface Kernel {
  // State access
  getState(): WorldState;
  getEventStore(): EventStore;
  getRNG(): RNG;
  getCurrentTick(): number;
  isRunning(): boolean;

  // Run lifecycle
  start(): Event;
  stop(reason: string): Event;

  // Agent management
  createAgent(name: string): { agentId: string; apiKey: string };

  // Action submission
  submitActions(agentId: string, actions: Action[], idempotencyKey: string): ActionResult[];

  // Tick control
  advanceTick(): TickResult;

  // Decay application
  applyDecay(): Event[];
}

/**
 * Create a new simulation kernel.
 */
export function createKernel(
  runId: string,
  config: RunConfig,
  seed: number,
  scenarioVersion: string
): Kernel {
  const state = createWorldState(runId, config, seed);
  const eventStore = createEventStore(runId);
  const rng = createRNG(seed);
  const matchingEngine = createMatchingEngine();

  let running = false;
  let receiveSequence = 0;
  const pendingActions: PendingAction[] = [];
  const idempotencyCache = new Map<string, ActionResult[]>();

  // Emit initial run created event
  emitEvent('RUN_CREATED', null, {
    config: serializeConfig(config),
    seed,
    scenarioVersion,
  });

  function emitEvent(
    eventType: EventType,
    agentId: string | null,
    payload: Record<string, unknown>
  ): Event {
    return eventStore.append({
      runId,
      tickId: state.currentTick,
      eventType,
      agentId,
      payload,
    });
  }

  function serializeConfig(cfg: RunConfig): Record<string, unknown> {
    return {
      initialCash: formatAmount(cfg.initialCash),
      initialAsset: formatAmount(cfg.initialAsset),
      tradingFeeBps: cfg.tradingFeeBps,
      decayRateBps: cfg.decayRateBps,
      decayIntervalTicks: cfg.decayIntervalTicks,
      maxActionsPerTick: cfg.maxActionsPerTick,
      tickDurationMs: cfg.tickDurationMs,
      maxPrice: formatAmount(cfg.maxPrice),
      minPrice: formatAmount(cfg.minPrice),
      minQuantity: formatAmount(cfg.minQuantity),
    };
  }

  function getState(): WorldState {
    return state;
  }

  function getEventStore(): EventStore {
    return eventStore;
  }

  function getRNG(): RNG {
    return rng;
  }

  function getCurrentTick(): number {
    return state.currentTick;
  }

  function isRunning(): boolean {
    return running;
  }

  function start(): Event {
    if (running) {
      throw new Error('Run already started');
    }
    running = true;
    return emitEvent('RUN_STARTED', null, {});
  }

  function stop(reason: string): Event {
    if (!running) {
      throw new Error('Run not started');
    }
    running = false;
    return emitEvent('RUN_STOPPED', null, { reason });
  }

  function createAgent(name: string): { agentId: string; apiKey: string } {
    const apiKey = generateApiKey();
    const { agent } = addAgent(state, name, apiKey);

    emitEvent('AGENT_CREATED', agent.id, {
      agentId: agent.id,
      name,
      initialCash: formatAmount(state.config.initialCash),
      initialAsset: formatAmount(state.config.initialAsset),
    });

    return { agentId: agent.id, apiKey };
  }

  function submitActions(
    agentId: string,
    actions: Action[],
    idempotencyKey: string
  ): ActionResult[] {
    // Check idempotency
    const cached = idempotencyCache.get(idempotencyKey);
    if (cached) {
      return cached;
    }

    const results: ActionResult[] = [];
    const agent = getAgent(state, agentId);

    if (!agent) {
      results.push({
        actionIndex: 0,
        status: 'rejected',
        reasonCode: 'INVALID_ACTION',
        message: 'Agent not found',
      });
      idempotencyCache.set(idempotencyKey, results);
      return results;
    }

    if (!running) {
      results.push({
        actionIndex: 0,
        status: 'rejected',
        reasonCode: 'RUN_NOT_ACTIVE',
        message: 'Simulation is not running',
      });
      idempotencyCache.set(idempotencyKey, results);
      return results;
    }

    if (agent.status === 'bankrupt') {
      results.push({
        actionIndex: 0,
        status: 'rejected',
        reasonCode: 'AGENT_BANKRUPT',
        message: 'Agent is bankrupt and cannot trade',
      });
      idempotencyCache.set(idempotencyKey, results);
      return results;
    }

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i]!;

      // Check rate limit
      if (isAgentRateLimited(state, agentId)) {
        emitEvent('RATE_LIMIT_HIT', agentId, {
          agentId,
          actionsAttempted: agent.actionsThisTick + 1,
          limit: state.config.maxActionsPerTick,
        });

        results.push({
          actionIndex: i,
          status: 'rejected',
          reasonCode: 'RATE_LIMITED',
          message: `Rate limit exceeded: ${state.config.maxActionsPerTick} actions per tick`,
        });
        continue;
      }

      // Queue action for processing
      pendingActions.push({
        agentId,
        action,
        receiveSequence: receiveSequence++,
        idempotencyKey,
      });

      incrementAgentActions(state, agentId);

      results.push({
        actionIndex: i,
        status: 'accepted',
      });
    }

    idempotencyCache.set(idempotencyKey, results);
    return results;
  }

  function advanceTick(): TickResult {
    const tickId = state.currentTick;
    const events: Event[] = [];

    // Emit tick start
    events.push(emitEvent('TICK_START', null, { tickId }));

    // Reset action counters
    resetAgentActions(state);

    // Sort pending actions deterministically
    pendingActions.sort((a, b) => a.receiveSequence - b.receiveSequence);

    let ordersProcessed = 0;
    let tradesExecuted = 0;

    // Process all pending actions
    for (const pending of pendingActions) {
      const result = processAction(pending.agentId, pending.action);
      if (result.events) {
        events.push(...result.events);
      }
      if (result.ordersProcessed) ordersProcessed += result.ordersProcessed;
      if (result.tradesExecuted) tradesExecuted += result.tradesExecuted;
    }

    // Clear pending actions
    pendingActions.length = 0;

    // Apply decay if needed
    if (
      state.config.decayIntervalTicks > 0 &&
      tickId > 0 &&
      tickId % state.config.decayIntervalTicks === 0
    ) {
      const decayEvents = applyDecay();
      events.push(...decayEvents);
    }

    // Check for bankruptcies
    for (const agent of state.agents.values()) {
      if (agent.status === 'active' && shouldBeBankrupt(agent)) {
        bankruptAgent(state, agent.id);
        events.push(
          emitEvent('AGENT_BANKRUPT', agent.id, {
            agentId: agent.id,
            finalCash: formatAmount(agent.cashBalance),
            finalAsset: formatAmount(agent.assetBalance),
          })
        );
      }
    }

    // Emit tick end
    events.push(
      emitEvent('TICK_END', null, {
        tickId,
        ordersProcessed,
        tradesExecuted,
      })
    );

    // Advance tick counter
    state.currentTick++;

    // Clear old idempotency keys periodically
    if (state.currentTick % 100 === 0) {
      idempotencyCache.clear();
    }

    return { tickId, events, ordersProcessed, tradesExecuted };
  }

  function processAction(
    agentId: string,
    action: Action
  ): { events: Event[]; ordersProcessed: number; tradesExecuted: number } {
    const events: Event[] = [];
    let ordersProcessed = 0;
    let tradesExecuted = 0;

    const agent = getAgent(state, agentId);
    if (!agent || agent.status !== 'active') {
      return { events, ordersProcessed, tradesExecuted };
    }

    if (action.type === 'place_limit_order') {
      const result = matchingEngine.placeOrder(
        state,
        agentId,
        action.side,
        action.price,
        action.quantity,
        state.config.tradingFeeBps
      );

      if (result.rejected) {
        events.push(
          emitEvent('ORDER_REJECTED', agentId, {
            agentId,
            reasonCode: result.rejectionCode,
            details: result.rejectionMessage || '',
          })
        );
      } else {
        ordersProcessed++;

        if (result.order) {
          events.push(
            emitEvent('ORDER_PLACED', agentId, {
              orderId: result.order.id,
              agentId,
              side: result.order.side,
              price: formatAmount(result.order.price),
              quantity: formatAmount(result.order.quantity),
            })
          );
        }

        // Record trades
        if (result.trades) {
          for (const trade of result.trades) {
            tradesExecuted++;
            events.push(
              emitEvent('TRADE_EXECUTED', null, {
                tradeId: trade.id,
                price: formatAmount(trade.price),
                quantity: formatAmount(trade.quantity),
                bidOrderId: trade.bidOrderId,
                askOrderId: trade.askOrderId,
                bidAgentId: trade.bidAgentId,
                askAgentId: trade.askAgentId,
                fee: formatAmount(trade.feeTotal),
              })
            );
          }
        }

        // Record balance updates
        if (result.balanceUpdates) {
          for (const update of result.balanceUpdates) {
            events.push(
              emitEvent('BALANCE_UPDATED', update.agentId, {
                agentId: update.agentId,
                cashDelta: formatAmount(update.cashDelta),
                assetDelta: formatAmount(update.assetDelta),
                newCash: formatAmount(update.newCash),
                newAsset: formatAmount(update.newAsset),
                reason: update.reason,
              })
            );
          }
        }
      }
    } else if (action.type === 'cancel_order') {
      const result = matchingEngine.cancelOrder(state, agentId, action.orderId);

      if (result.rejected) {
        events.push(
          emitEvent('ORDER_REJECTED', agentId, {
            agentId,
            reasonCode: result.rejectionCode,
            details: result.rejectionMessage || '',
          })
        );
      } else {
        events.push(
          emitEvent('ORDER_CANCELLED', agentId, {
            orderId: action.orderId,
            agentId,
            reason: 'user_cancelled',
          })
        );
      }
    }

    return { events, ordersProcessed, tradesExecuted };
  }

  function applyDecay(): Event[] {
    const events: Event[] = [];

    if (state.config.decayRateBps <= 0) {
      return events;
    }

    for (const agent of state.agents.values()) {
      if (agent.status !== 'active') continue;
      if (!isPositive(agent.cashBalance)) continue;

      const decayAmount = mulBasisPoints(agent.cashBalance, state.config.decayRateBps);
      if (!isPositive(decayAmount)) continue;

      const { newCash } = updateAgentBalance(state, agent.id, -decayAmount, 0n);

      events.push(
        emitEvent('DECAY_APPLIED', agent.id, {
          agentId: agent.id,
          amount: formatAmount(decayAmount),
          newCash: formatAmount(newCash),
        })
      );
    }

    return events;
  }

  return {
    getState,
    getEventStore,
    getRNG,
    getCurrentTick,
    isRunning,
    start,
    stop,
    createAgent,
    submitActions,
    advanceTick,
    applyDecay,
  };
}
