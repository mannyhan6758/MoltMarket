/**
 * Data persistence for MoltMarket runs.
 * Saves run data to disk as JSON/JSONL files.
 */

import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Kernel } from './kernel/tick-controller.js';
import { formatAmount, parseAmount } from './types/amount.js';
import { getMidPrice } from './kernel/world-state.js';

/**
 * Save all run data to `{outputDir}/{run_id}/`.
 */
export function saveRunData(kernel: Kernel, outputDir: string): string {
  const state = kernel.getState();
  const runDir = join(outputDir, state.runId);
  mkdirSync(runDir, { recursive: true });

  const eventStore = kernel.getEventStore();
  const midPrice = getMidPrice(state) || parseAmount('100.00');

  // summary.json
  const summary = {
    run_id: state.runId,
    seed: null as number | null, // seed not stored on state; filled from event if available
    config: {
      initial_cash: formatAmount(state.config.initialCash),
      initial_asset: formatAmount(state.config.initialAsset),
      trading_fee_bps: state.config.tradingFeeBps,
      decay_rate_bps: state.config.decayRateBps,
      decay_interval_ticks: state.config.decayIntervalTicks,
      max_actions_per_tick: state.config.maxActionsPerTick,
    },
    tick_count: kernel.getCurrentTick(),
    agent_count: state.agents.size,
    total_trades: state.trades.length,
    total_volume: formatAmount(state.totalTradeVolume),
    total_fees: formatAmount(state.totalFees),
    final_event_hash: eventStore.getLastHash(),
    event_count: eventStore.getCount(),
    saved_at: new Date().toISOString(),
  };

  // Try to extract seed from RUN_STARTED event
  const runStartedEvents = eventStore.getByType('RUN_STARTED');
  if (runStartedEvents.length > 0) {
    const payload = (runStartedEvents[0] as any).payload;
    if (payload?.seed !== undefined) {
      summary.seed = payload.seed;
    }
  }

  writeFileSync(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

  // agents.json
  const agents = Array.from(state.agents.values()).map((agent) => {
    const equity =
      agent.cashBalance + (agent.assetBalance * midPrice) / parseAmount('1.00');
    const initialEquity =
      state.config.initialCash +
      (state.config.initialAsset * midPrice) / parseAmount('1.00');
    const pnl = equity - initialEquity;
    const pnlPct =
      initialEquity > 0n ? Number((pnl * 10000n) / initialEquity) / 100 : 0;

    const tradeCount = state.trades.filter(
      (t) => t.bidAgentId === agent.id || t.askAgentId === agent.id
    ).length;

    return {
      agent_id: agent.id,
      name: agent.name,
      status: agent.status,
      cash_balance: formatAmount(agent.cashBalance),
      asset_balance: formatAmount(agent.assetBalance),
      equity: formatAmount(equity),
      pnl: formatAmount(pnl),
      pnl_pct: pnlPct.toFixed(2),
      trade_count: tradeCount,
      bankrupt_at_tick: agent.bankruptAtTick,
    };
  });

  writeFileSync(join(runDir, 'agents.json'), JSON.stringify(agents, null, 2) + '\n');

  // trades.jsonl
  const tradesPath = join(runDir, 'trades.jsonl');
  writeFileSync(tradesPath, ''); // truncate
  for (const trade of state.trades) {
    const line = JSON.stringify({
      trade_id: trade.id,
      tick_id: trade.tickId,
      price: formatAmount(trade.price),
      quantity: formatAmount(trade.quantity),
      bid_order_id: trade.bidOrderId,
      ask_order_id: trade.askOrderId,
      bid_agent_id: trade.bidAgentId,
      ask_agent_id: trade.askAgentId,
      fee_total: formatAmount(trade.feeTotal),
    });
    appendFileSync(tradesPath, line + '\n');
  }

  // events.jsonl
  writeFileSync(join(runDir, 'events.jsonl'), eventStore.exportJsonl() + '\n');

  return runDir;
}
