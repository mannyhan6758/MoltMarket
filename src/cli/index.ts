#!/usr/bin/env node

/**
 * MoltMarket CLI
 * Command-line interface for managing simulations.
 */

import { createKernel, Kernel } from '../kernel/tick-controller.js';
import { createApiServer, ApiServer } from '../api/server.js';
import type { RunConfig } from '../types/domain.js';
import { parseAmount, formatAmount } from '../types/amount.js';
import { generateId } from '../utils/hash.js';

const DEFAULT_CONFIG: RunConfig = {
  initialCash: parseAmount('10000.00'),
  initialAsset: parseAmount('100.00'),
  tradingFeeBps: 10,
  decayRateBps: 1, // 0.01% per interval
  decayIntervalTicks: 100,
  maxActionsPerTick: 10,
  tickDurationMs: 0, // Manual tick advancement
  maxPrice: parseAmount('1000000.00'),
  minPrice: parseAmount('0.00000001'),
  minQuantity: parseAmount('0.00000001'),
};

interface RunContext {
  kernel: Kernel;
  server: ApiServer | null;
  tickInterval: NodeJS.Timeout | null;
}

let currentRun: RunContext | null = null;

async function createRun(seed?: number, scenarioVersion: string = 'v1.0.0'): Promise<string> {
  const runId = generateId();
  const actualSeed = seed ?? Math.floor(Math.random() * 2147483647);

  const kernel = createKernel(runId, DEFAULT_CONFIG, actualSeed, scenarioVersion);

  currentRun = {
    kernel,
    server: null,
    tickInterval: null,
  };

  console.log(`Created run: ${runId}`);
  console.log(`  Seed: ${actualSeed}`);
  console.log(`  Scenario: ${scenarioVersion}`);

  return runId;
}

async function startRun(port: number = 3000, autoTick: boolean = false): Promise<void> {
  if (!currentRun) {
    console.error('No run created. Use create-run first.');
    process.exit(1);
  }

  currentRun.kernel.start();

  const server = createApiServer(currentRun.kernel, {
    port,
    host: '0.0.0.0',
  });

  await server.start();
  currentRun.server = server;

  console.log(`Started run on http://localhost:${port}`);
  console.log('  POST /v1/actions - Submit actions');
  console.log('  GET /v1/agent - Agent state');
  console.log('  GET /v1/market/book - Order book');
  console.log('  GET /v1/market/trades - Recent trades');
  console.log('  GET /v1/run/status - Run status');

  if (autoTick) {
    currentRun.tickInterval = setInterval(() => {
      if (currentRun?.kernel.isRunning()) {
        const result = currentRun.kernel.advanceTick();
        if (result.tradesExecuted > 0) {
          console.log(
            `Tick ${result.tickId}: ${result.ordersProcessed} orders, ${result.tradesExecuted} trades`
          );
        }
      }
    }, 100); // 10 ticks per second
  }
}

async function stopRun(): Promise<void> {
  if (!currentRun) {
    console.error('No run active.');
    return;
  }

  if (currentRun.tickInterval) {
    clearInterval(currentRun.tickInterval);
  }

  if (currentRun.kernel.isRunning()) {
    currentRun.kernel.stop('manual stop');
  }

  if (currentRun.server) {
    await currentRun.server.stop();
  }

  console.log('Run stopped.');
}

function createAgent(name: string): { agentId: string; apiKey: string } {
  if (!currentRun) {
    throw new Error('No run created');
  }
  return currentRun.kernel.createAgent(name);
}

function advanceTick(): void {
  if (!currentRun) {
    throw new Error('No run created');
  }
  if (!currentRun.kernel.isRunning()) {
    throw new Error('Run not started');
  }
  const result = currentRun.kernel.advanceTick();
  console.log(
    `Tick ${result.tickId}: ${result.ordersProcessed} orders, ${result.tradesExecuted} trades, ${result.events.length} events`
  );
}

function exportRun(): string {
  if (!currentRun) {
    throw new Error('No run created');
  }
  return currentRun.kernel.getEventStore().exportJsonl();
}

function verifyChain(): boolean {
  if (!currentRun) {
    throw new Error('No run created');
  }
  const result = currentRun.kernel.getEventStore().verifyChain();
  if (result.valid) {
    console.log('Event chain verified: VALID');
  } else {
    console.error(`Event chain INVALID at event ${result.errorAt}`);
  }
  return result.valid;
}

function showStatus(): void {
  if (!currentRun) {
    console.log('No run active.');
    return;
  }

  const state = currentRun.kernel.getState();
  const running = currentRun.kernel.isRunning();

  console.log('\n=== MoltMarket Status ===');
  console.log(`Run ID: ${state.runId}`);
  console.log(`Status: ${running ? 'RUNNING' : 'STOPPED'}`);
  console.log(`Current Tick: ${currentRun.kernel.getCurrentTick()}`);
  console.log(`Agents: ${state.agents.size}`);
  console.log(`Open Orders: ${Array.from(state.orders.values()).filter((o) => o.status === 'open').length}`);
  console.log(`Total Trades: ${state.trades.length}`);
  console.log(`Total Volume: ${formatAmount(state.totalTradeVolume)}`);
  console.log(`Total Fees: ${formatAmount(state.totalFees)}`);
  console.log(`Events: ${currentRun.kernel.getEventStore().getCount()}`);
  console.log(`Last Hash: ${currentRun.kernel.getEventStore().getLastHash().slice(0, 16)}...`);
  console.log('');
}

// CLI argument parsing
const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case 'create-run': {
      const seedArg = args.find((a) => a.startsWith('--seed='));
      const seed = seedArg ? parseInt(seedArg.split('=')[1]!) : undefined;
      const scenarioArg = args.find((a) => a.startsWith('--scenario='));
      const scenario = scenarioArg ? scenarioArg.split('=')[1]! : 'v1.0.0';
      await createRun(seed, scenario);
      break;
    }

    case 'start-run': {
      const portArg = args.find((a) => a.startsWith('--port='));
      const port = portArg ? parseInt(portArg.split('=')[1]!) : 3000;
      const autoTick = args.includes('--auto-tick');
      await startRun(port, autoTick);
      // Keep running
      process.on('SIGINT', async () => {
        console.log('\nShutting down...');
        await stopRun();
        process.exit(0);
      });
      break;
    }

    case 'stop-run':
      await stopRun();
      break;

    case 'status':
      showStatus();
      break;

    case 'tick':
      advanceTick();
      break;

    case 'verify':
      verifyChain();
      break;

    case 'export':
      console.log(exportRun());
      break;

    case 'demo': {
      // Demo mode: create run, add agents, run simulation
      const seed = 42;
      await createRun(seed);
      await startRun(3000, true);

      // Create some agents
      const agents: Array<{ id: string; key: string; name: string }> = [];
      for (let i = 1; i <= 5; i++) {
        const { agentId, apiKey } = createAgent(`Bot_${i}`);
        agents.push({ id: agentId, key: apiKey, name: `Bot_${i}` });
        console.log(`Created agent ${i}: ${agentId.slice(0, 8)}... (key: ${apiKey.slice(0, 16)}...)`);
      }

      console.log('\nDemo running. Press Ctrl+C to stop.');
      console.log('Agents can connect with their API keys.');

      process.on('SIGINT', async () => {
        console.log('\nShutting down...');
        showStatus();
        verifyChain();
        await stopRun();
        process.exit(0);
      });
      break;
    }

    default:
      console.log('MoltMarket CLI');
      console.log('');
      console.log('Usage: npm run cli <command> [options]');
      console.log('');
      console.log('Commands:');
      console.log('  create-run [--seed=N] [--scenario=VERSION]  Create a new simulation run');
      console.log('  start-run [--port=N] [--auto-tick]          Start the API server');
      console.log('  stop-run                                    Stop the current run');
      console.log('  status                                      Show run status');
      console.log('  tick                                        Advance one tick');
      console.log('  verify                                      Verify event chain integrity');
      console.log('  export                                      Export events as JSONL');
      console.log('  demo                                        Run demo simulation');
      console.log('');
      break;
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
