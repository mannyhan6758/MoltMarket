#!/usr/bin/env npx tsx

/**
 * Determinism Demo
 *
 * This script proves that MoltMarket simulations are fully deterministic.
 * Running the same seed twice produces identical event hashes.
 */

import { createKernel } from '../src/kernel/tick-controller.js';
import { createBotFleet, runSimulation, SimulationResult } from '../src/bots/runner.js';
import { parseAmount } from '../src/types/amount.js';
import type { RunConfig } from '../src/types/domain.js';

const CONFIG: RunConfig = {
  initialCash: parseAmount('10000.00'),
  initialAsset: parseAmount('100.00'),
  tradingFeeBps: 10,
  decayRateBps: 1,
  decayIntervalTicks: 100,
  maxActionsPerTick: 10,
  tickDurationMs: 0,
  maxPrice: parseAmount('1000000.00'),
  minPrice: parseAmount('0.00000001'),
  minQuantity: parseAmount('0.00000001'),
};

function runWithSeed(seed: number, numBots: number, numTicks: number): SimulationResult {
  const runId = `determinism-test-${seed}`;
  const kernel = createKernel(runId, CONFIG, seed, 'v1.0.0');

  const bots = createBotFleet(kernel, seed, numBots);

  console.log(`Running simulation with seed=${seed}, bots=${numBots}, ticks=${numTicks}`);

  const result = runSimulation(kernel, bots, numTicks, (tick, trades) => {
    process.stdout.write(`\r  Tick ${tick}/${numTicks}, Trades: ${trades}`);
  });

  console.log(''); // New line after progress

  return result;
}

async function main() {
  console.log('='.repeat(60));
  console.log('MoltMarket Determinism Demonstration');
  console.log('='.repeat(60));
  console.log('');

  const SEED = 42;
  const NUM_BOTS = 10;
  const NUM_TICKS = 500;

  console.log('Configuration:');
  console.log(`  Seed: ${SEED}`);
  console.log(`  Bots: ${NUM_BOTS}`);
  console.log(`  Ticks: ${NUM_TICKS}`);
  console.log('');

  // First run
  console.log('-'.repeat(60));
  console.log('RUN 1');
  console.log('-'.repeat(60));
  const result1 = runWithSeed(SEED, NUM_BOTS, NUM_TICKS);
  console.log(`  Total Trades: ${result1.totalTrades}`);
  console.log(`  Total Events: ${result1.totalEvents}`);
  console.log(`  Final Hash: ${result1.finalEventHash}`);
  console.log('');

  // Second run (identical)
  console.log('-'.repeat(60));
  console.log('RUN 2 (same seed)');
  console.log('-'.repeat(60));
  const result2 = runWithSeed(SEED, NUM_BOTS, NUM_TICKS);
  console.log(`  Total Trades: ${result2.totalTrades}`);
  console.log(`  Total Events: ${result2.totalEvents}`);
  console.log(`  Final Hash: ${result2.finalEventHash}`);
  console.log('');

  // Compare
  console.log('='.repeat(60));
  console.log('COMPARISON');
  console.log('='.repeat(60));

  const hashMatch = result1.finalEventHash === result2.finalEventHash;
  const tradesMatch = result1.totalTrades === result2.totalTrades;
  const eventsMatch = result1.totalEvents === result2.totalEvents;

  console.log(`  Hashes match: ${hashMatch ? 'YES' : 'NO'}`);
  console.log(`  Trade counts match: ${tradesMatch ? 'YES' : 'NO'}`);
  console.log(`  Event counts match: ${eventsMatch ? 'YES' : 'NO'}`);
  console.log('');

  if (hashMatch && tradesMatch && eventsMatch) {
    console.log('DETERMINISM VERIFIED');
    console.log('Both runs produced identical results!');
  } else {
    console.log('DETERMINISM FAILED');
    console.log('Runs produced different results!');
    process.exit(1);
  }

  console.log('');

  // Third run with different seed
  const DIFFERENT_SEED = 43;
  console.log('-'.repeat(60));
  console.log(`RUN 3 (different seed: ${DIFFERENT_SEED})`);
  console.log('-'.repeat(60));
  const result3 = runWithSeed(DIFFERENT_SEED, NUM_BOTS, NUM_TICKS);
  console.log(`  Total Trades: ${result3.totalTrades}`);
  console.log(`  Total Events: ${result3.totalEvents}`);
  console.log(`  Final Hash: ${result3.finalEventHash}`);
  console.log('');

  const differentHash = result1.finalEventHash !== result3.finalEventHash;
  console.log(`  Different seed produces different hash: ${differentHash ? 'YES' : 'NO'}`);
  console.log('');

  // Show agent performance comparison
  console.log('='.repeat(60));
  console.log('AGENT RESULTS (from Run 1)');
  console.log('='.repeat(60));
  console.log('');
  console.log('Name'.padEnd(15) + 'Cash'.padStart(20) + 'Asset'.padStart(20) + 'Status'.padStart(12));
  console.log('-'.repeat(67));

  for (const agent of result1.agentResults) {
    const cash = parseFloat(agent.finalCash).toFixed(2);
    const asset = parseFloat(agent.finalAsset).toFixed(2);
    console.log(
      agent.name.padEnd(15) +
      cash.padStart(20) +
      asset.padStart(20) +
      agent.status.padStart(12)
    );
  }

  console.log('');
  console.log('Demo complete!');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
