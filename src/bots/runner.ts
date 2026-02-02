/**
 * Bot Runner - Orchestrates multiple trading bots in simulation.
 */

import type { Kernel } from '../kernel/tick-controller.js';
import type { Bot, MarketState } from './base-bot.js';
import { RandomBot, MarketMakerBot, TrendFollowerBot, MeanReversionBot, AggressiveTakerBot } from './strategies.js';
import { createRNG, RNG } from '../utils/rng.js';
import { generateId } from '../utils/hash.js';
import {
  getAgent,
  getAgentOpenOrders,
  getMidPrice,
  getBookLevels,
  getRecentTrades,
} from '../kernel/world-state.js';
import { formatAmount, parseAmount } from '../types/amount.js';

export interface BotInstance {
  bot: Bot;
  agentId: string;
  apiKey: string;
}

export interface RunnerConfig {
  numBots: number;
  seed: number;
}

export interface SimulationResult {
  totalTicks: number;
  totalTrades: number;
  totalEvents: number;
  finalEventHash: string;
  agentResults: Array<{
    name: string;
    finalCash: string;
    finalAsset: string;
    status: string;
  }>;
}

/**
 * Create a set of bots with diverse strategies.
 */
export function createBotFleet(kernel: Kernel, seed: number, numBots: number): BotInstance[] {
  const rng = createRNG(seed);
  const bots: BotInstance[] = [];

  const strategies = [
    (name: string, botRng: RNG) => new RandomBot({ name, rng: botRng }, 0.05, 5),
    (name: string, botRng: RNG) => new MarketMakerBot({ name, rng: botRng }, 50, 2, 50),
    (name: string, botRng: RNG) => new TrendFollowerBot({ name, rng: botRng }, 5, 0.01, 3),
    (name: string, botRng: RNG) => new MeanReversionBot({ name, rng: botRng }, 10, 0.02, 2),
    (name: string, botRng: RNG) => new AggressiveTakerBot({ name, rng: botRng }, 1),
  ];

  const strategyNames = ['Random', 'MM', 'Trend', 'MeanRev', 'Taker'];

  for (let i = 0; i < numBots; i++) {
    const strategyIdx = i % strategies.length;
    const strategyName = strategyNames[strategyIdx]!;
    const botNumber = Math.floor(i / strategies.length) + 1;
    const name = `${strategyName}_${botNumber}`;

    // Create agent in kernel
    const { agentId, apiKey } = kernel.createAgent(name);

    // Create bot with its own RNG (derived from master seed)
    const botSeed = rng.nextInt(0, 2147483647);
    const botRng = createRNG(botSeed);
    const bot = strategies[strategyIdx]!(name, botRng);

    bots.push({ bot, agentId, apiKey });
  }

  return bots;
}

/**
 * Get market state for a bot.
 */
function getMarketState(kernel: Kernel, agentId: string): MarketState {
  const state = kernel.getState();
  const agent = getAgent(state, agentId);

  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  const midPrice = getMidPrice(state);
  const bids = getBookLevels(state, 'bid', 1);
  const asks = getBookLevels(state, 'ask', 1);
  const recentTrades = getRecentTrades(state, 20);
  const openOrders = getAgentOpenOrders(state, agentId);

  return {
    midPrice: midPrice ? Number(formatAmount(midPrice)) : null,
    bestBid: bids.length > 0 ? Number(formatAmount(bids[0]!.price)) : null,
    bestAsk: asks.length > 0 ? Number(formatAmount(asks[0]!.price)) : null,
    spread: bids.length > 0 && asks.length > 0
      ? Number(formatAmount(asks[0]!.price)) - Number(formatAmount(bids[0]!.price))
      : null,
    cashBalance: Number(formatAmount(agent.cashBalance)),
    assetBalance: Number(formatAmount(agent.assetBalance)),
    openOrders: openOrders.map((o) => ({
      orderId: o.id,
      side: o.side,
      price: Number(formatAmount(o.price)),
      quantity: Number(formatAmount(o.quantity)),
    })),
    recentTrades: recentTrades.map((t) => ({
      price: Number(formatAmount(t.price)),
      quantity: Number(formatAmount(t.quantity)),
      tickId: t.tickId,
    })),
    currentTick: kernel.getCurrentTick(),
  };
}

/**
 * Run a single tick for all bots.
 */
export function runBotTick(kernel: Kernel, bots: BotInstance[]): void {
  for (const { bot, agentId } of bots) {
    try {
      const marketState = getMarketState(kernel, agentId);
      const actions = bot.decide(marketState);

      if (actions.length > 0) {
        const idempotencyKey = `${agentId}-${kernel.getCurrentTick()}-${generateId()}`;
        kernel.submitActions(agentId, actions, idempotencyKey);
      }
    } catch (error) {
      // Bot errors should not crash simulation
      console.error(`Bot ${bot.name} error:`, error);
    }
  }
}

/**
 * Run a complete simulation with bots.
 */
export function runSimulation(
  kernel: Kernel,
  bots: BotInstance[],
  numTicks: number,
  progressCallback?: (tick: number, trades: number) => void
): SimulationResult {
  // Ensure kernel is running
  if (!kernel.isRunning()) {
    kernel.start();
  }

  let totalTrades = 0;

  for (let tick = 0; tick < numTicks; tick++) {
    // Bots decide and submit actions
    runBotTick(kernel, bots);

    // Advance tick
    const result = kernel.advanceTick();
    totalTrades += result.tradesExecuted;

    if (progressCallback && tick % 100 === 0) {
      progressCallback(tick, totalTrades);
    }
  }

  const state = kernel.getState();

  return {
    totalTicks: numTicks,
    totalTrades,
    totalEvents: kernel.getEventStore().getCount(),
    finalEventHash: kernel.getEventStore().getLastHash(),
    agentResults: Array.from(state.agents.values()).map((a) => ({
      name: a.name,
      finalCash: formatAmount(a.cashBalance),
      finalAsset: formatAmount(a.assetBalance),
      status: a.status,
    })),
  };
}
