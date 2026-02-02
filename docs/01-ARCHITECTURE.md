# MoltMarket Architecture Summary

## Overview

MoltMarket is a deterministic, event-sourced market simulation engine. Agents interact via HTTP/WS API, submitting orders to a continuous double auction (CDA) order book. All state transitions are logged append-only, enabling perfect replay from (seed, scenario_version, agent_actions).

## Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MoltMarket System                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐     ┌──────────────────────────────────────────────────┐  │
│  │   CLI       │────▶│                  Run Controller                   │  │
│  │ (Operator)  │     │  - create/start/stop/replay/export runs          │  │
│  └─────────────┘     └──────────────────────────────────────────────────┘  │
│                                        │                                    │
│                                        ▼                                    │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         WORLD KERNEL (Pure/Deterministic)             │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │  │
│  │  │ Tick Loop   │  │ RNG (Seeded)│  │ Event       │  │ State       │  │  │
│  │  │ Controller  │──│ Mulberry32  │──│ Emitter     │──│ Manager     │  │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │  │
│  │         │                                  │               │          │  │
│  │         ▼                                  ▼               ▼          │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │  │
│  │  │                    MARKET MECHANISM (CDA)                       │ │  │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │ │  │
│  │  │  │ Order Book  │  │ Matching    │  │ Settlement  │             │ │  │
│  │  │  │ (Bids/Asks) │──│ Engine      │──│ Engine      │             │ │  │
│  │  │  └─────────────┘  └─────────────┘  └─────────────┘             │ │  │
│  │  └─────────────────────────────────────────────────────────────────┘ │  │
│  │         │                                                             │  │
│  │         ▼                                                             │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │  │
│  │  │                    INCENTIVE FIELD                              │ │  │
│  │  │  • Trade fees (basis points)    • Rate limits (actions/tick)   │ │  │
│  │  │  • Capital decay (per N ticks)  • Bankruptcy enforcement       │ │  │
│  │  └─────────────────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                        │                                    │
│         ┌──────────────────────────────┼──────────────────────────────┐    │
│         ▼                              ▼                              ▼    │
│  ┌─────────────┐              ┌─────────────┐              ┌─────────────┐ │
│  │ Agent API   │              │ Event Store │              │ Telemetry   │ │
│  │ (HTTP/WS)   │              │ (Postgres)  │              │ & Metrics   │ │
│  │ Fastify+WS  │              │ Append-Only │              │ Snapshots   │ │
│  └─────────────┘              └─────────────┘              └─────────────┘ │
│         ▲                                                        │         │
│         │                                                        ▼         │
│  ┌─────────────┐                                         ┌─────────────┐  │
│  │ Agent       │                                         │ Dashboard   │  │
│  │ Clients     │                                         │ (Read-Only) │  │
│  │ (Bots/LLMs) │                                         │ Spectacle   │  │
│  └─────────────┘                                         └─────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Module Responsibilities

### 1. World Kernel
- **Tick Controller**: Advances simulation time in discrete ticks. Processes all pending actions deterministically.
- **Seeded RNG**: Mulberry32 PRNG for scenario events (demand shocks, etc). Never used for action ordering.
- **Event Emitter**: Creates immutable event records with hash chain.
- **State Manager**: Maintains canonical world state (agents, balances, orders, positions).

### 2. Market Mechanism (CDA)
- **Order Book**: Price-time priority. Separate bid/ask sides as sorted arrays.
- **Matching Engine**: Pure function: (book, order) → (new_book, trades). No side effects.
- **Settlement**: Updates agent balances atomically. Enforces sufficient funds.

### 3. Incentive Field
- **Fees**: 10 bps per trade (configurable). Deducted from trade proceeds.
- **Capital Decay**: 0.01% of CASH balance deducted every 100 ticks (configurable).
- **Bankruptcy**: Agent marked inactive when CASH < 0. Cannot place orders. Recorded permanently.
- **Rate Limits**: Max 10 actions per agent per tick. Excess rejected with `RATE_LIMITED` code.

### 4. Agent API
- Capability-scoped: agents can only see/modify their own state.
- All mutations via action submission with idempotency keys.
- Market data is aggregated (order book depth, not individual agent orders).

### 5. Event Store (Postgres)
- Append-only `events` table with hash chain.
- Indexed by run_id, tick_id, event_seq.
- Supports replay: read events in order, reconstruct state.

### 6. Telemetry
- Periodic snapshots (every N ticks): PnL, equity, drawdown per agent.
- Export: JSONL events + metrics CSV.

### 7. Dashboard (Spectacle Layer)
- Read-only derived views.
- Cannot affect kernel state.
- Shows: price chart, leaderboard, event feed.

## Key Invariants

1. **Determinism**: Given (scenario_version, seed, ordered_actions), output is identical.
2. **Immutability**: Events are never modified after creation.
3. **Isolation**: Agents cannot access other agents' private state.
4. **Conservation**: ASSET and CASH are conserved (minus fees to house).
5. **Hash Chain**: Each event includes hash of previous event.
