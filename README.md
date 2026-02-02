# MoltMarket

**Deterministic, replayable multi-agent market simulation**

MoltMarket is a "truth server" for agent-based market simulations. It provides:

- **Determinism**: Every run is reproducible from `(seed, scenario_version, agent_actions)`
- **Event Sourcing**: All state changes are recorded in an append-only log with hash chain integrity
- **Hard Constraints**: Rate limits, fees, capital decay, and bankruptcy enforcement
- **Agent API**: HTTP + WebSocket interface for external agents to participate

## Quick Start

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run determinism demo
npm run demo

# Start CLI demo server
npm run cli demo
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      MoltMarket                              │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  CLI        │  │  HTTP API   │  │  WebSocket  │         │
│  │  Commands   │  │  (Fastify)  │  │  Stream     │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                │                │                 │
│         └────────────────┼────────────────┘                 │
│                          ▼                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │               WORLD KERNEL (Deterministic)            │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐           │  │
│  │  │ Tick     │  │ Seeded   │  │ Event    │           │  │
│  │  │ Loop     │──│ RNG      │──│ Store    │           │  │
│  │  └──────────┘  └──────────┘  └──────────┘           │  │
│  │       │                                               │  │
│  │       ▼                                               │  │
│  │  ┌──────────────────────────────────────────────┐    │  │
│  │  │         MARKET (CDA Order Book)               │    │  │
│  │  │  • Price-time priority matching               │    │  │
│  │  │  • Atomic settlement                          │    │  │
│  │  │  • Trading fees (basis points)                │    │  │
│  │  └──────────────────────────────────────────────┘    │  │
│  │       │                                               │  │
│  │       ▼                                               │  │
│  │  ┌──────────────────────────────────────────────┐    │  │
│  │  │         INCENTIVE FIELD                       │    │  │
│  │  │  • Rate limits (actions/tick)                 │    │  │
│  │  │  • Capital decay                              │    │  │
│  │  │  • Bankruptcy enforcement                     │    │  │
│  │  └──────────────────────────────────────────────┘    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## API Reference

### Agent Endpoints (Authenticated)

```http
POST /v1/actions
Authorization: Bearer <api_key>

{
  "idempotency_key": "unique-key",
  "actions": [
    {"type": "place_limit_order", "side": "bid", "price": "100.00", "quantity": "10.0"},
    {"type": "cancel_order", "order_id": "uuid"}
  ]
}
```

```http
GET /v1/agent
Authorization: Bearer <api_key>

Response:
{
  "agent_id": "uuid",
  "name": "MyBot",
  "status": "active",
  "balances": {"cash": "10000.00", "asset": "100.00"},
  "open_orders": [...],
  "current_tick": 1234
}
```

### Market Data (Public)

```http
GET /v1/market/book?depth=10

{
  "tick_id": 1234,
  "bids": [{"price": "99.50", "quantity": "50.0"}],
  "asks": [{"price": "100.50", "quantity": "30.0"}],
  "mid_price": "100.00"
}
```

```http
GET /v1/market/trades?limit=100
GET /v1/market/stats
GET /v1/run/status
GET /v1/leaderboard
```

### WebSocket

```javascript
const ws = new WebSocket('ws://localhost:3000/v1/stream?api_key=<key>');
ws.send(JSON.stringify({ type: 'subscribe', channels: ['trades', 'book', 'agent'] }));
```

## CLI Commands

```bash
npm run cli create-run --seed=42 --scenario=v1.0.0
npm run cli start-run --port=3000 --auto-tick
npm run cli status
npm run cli tick          # Advance one tick
npm run cli verify        # Verify event chain
npm run cli export        # Export events as JSONL
npm run cli demo          # Run demo with bots
```

## Determinism

MoltMarket guarantees deterministic execution:

1. **Seeded RNG**: Mulberry32 PRNG for scenario events
2. **Deterministic IDs**: UUIDs derived from seed + counter
3. **Ordered Actions**: Actions processed by receive sequence
4. **Price-Time Priority**: Matching uses (price, sequence_num)
5. **Integer Arithmetic**: No floating point in core calculations

Verify determinism:

```bash
npm run demo
# Runs simulation twice with same seed, verifies identical hashes
```

## Event Hash Chain

Every event includes:
- `prev_hash`: Hash of previous event
- `event_hash`: SHA-256 of canonical JSON + prev_hash

```typescript
const chain = kernel.getEventStore().verifyChain();
// { valid: true }
```

## Configuration

```typescript
const config: RunConfig = {
  initialCash: parseAmount('10000.00'),
  initialAsset: parseAmount('100.00'),
  tradingFeeBps: 10,        // 0.1% per trade
  decayRateBps: 1,          // 0.01% per interval
  decayIntervalTicks: 100,
  maxActionsPerTick: 10,
  maxPrice: parseAmount('1000000.00'),
  minPrice: parseAmount('0.00000001'),
  minQuantity: parseAmount('0.00000001'),
};
```

## Bot Strategies

Built-in bot implementations:

- **RandomBot**: Random orders near mid price
- **MarketMakerBot**: Two-sided quotes, inventory management
- **TrendFollowerBot**: Momentum-based trading
- **MeanReversionBot**: Fades price moves
- **AggressiveTakerBot**: Takes liquidity

```typescript
import { createBotFleet, runSimulation } from './src/bots';

const bots = createBotFleet(kernel, seed, 10);
const result = runSimulation(kernel, bots, 500);
```

## Database Schema

See `prisma/schema.prisma` for PostgreSQL schema:

- `runs`: Simulation metadata
- `agents`: Agent state
- `events`: Append-only event log
- `orders`: Order book
- `trades`: Trade history
- `metrics_snapshots`: Agent performance metrics

## Docker

```bash
docker-compose up
# Starts PostgreSQL + MoltMarket demo
```

## Project Structure

```
MoltMarket/
├── src/
│   ├── types/           # Core type definitions
│   ├── utils/           # RNG, hashing, amount arithmetic
│   ├── kernel/          # World state, event store, tick controller
│   ├── market/          # Matching engine, order book
│   ├── api/             # HTTP/WebSocket server
│   ├── bots/            # Bot strategies and runner
│   └── cli/             # Command-line interface
├── scripts/
│   └── demo-determinism.ts
├── prisma/
│   └── schema.prisma
├── docs/
│   ├── 01-ARCHITECTURE.md
│   ├── 02-DATA-SCHEMA.md
│   ├── 03-API-SPEC.md
│   ├── 04-DETERMINISM-PLAN.md
│   └── 05-MILESTONE-PLAN.md
└── docker-compose.yml
```

## V1 Roadmap

- [ ] Additional instruments (multiple markets)
- [ ] Batch auctions / AMM mechanism
- [ ] Smart contracts / escrow
- [ ] Coalition object model
- [ ] Agent-to-agent messaging (with costs)
- [ ] Scenario packs & sampling strategy
- [ ] Production persistence layer
- [ ] Horizontal scaling

## License

MIT
