# MoltMarket Implementation Milestones

## Milestone 1: Project Setup & Core Types
**Goal**: Establish project structure, dependencies, and core type definitions.

**Tasks**:
- Initialize TypeScript project with strict settings
- Set up ESLint, Prettier, Vitest
- Define core types: Amount, Event, Agent, Order, Trade, WorldState
- Implement Mulberry32 RNG
- Implement Amount arithmetic (BigInt-based)
- Implement canonical JSON serialization and SHA-256 hashing

**Deliverables**:
- `src/types/` - All type definitions
- `src/utils/rng.ts` - Deterministic RNG
- `src/utils/amount.ts` - Precision arithmetic
- `src/utils/hash.ts` - Hash chain utilities
- Unit tests for utilities

**Verification**:
- RNG produces same sequence from same seed
- Amount arithmetic is exact (no floating point errors)
- Hash function is deterministic

---

## Milestone 2: World Kernel & Event System
**Goal**: Implement the deterministic simulation kernel and event sourcing.

**Tasks**:
- Implement EventStore (in-memory + interface for persistence)
- Implement WorldState class with immutable updates
- Implement TickController with action queue
- Implement action ordering (receive_sequence assignment)
- Event emission with hash chain

**Deliverables**:
- `src/kernel/world-state.ts` - Canonical world state
- `src/kernel/event-store.ts` - Event log management
- `src/kernel/tick-controller.ts` - Tick loop
- `src/kernel/types.ts` - Kernel-specific types

**Verification**:
- State transitions are pure functions
- Events form valid hash chain
- Same actions produce same events

---

## Milestone 3: Matching Engine & Order Book
**Goal**: Implement the continuous double auction (CDA) order book.

**Tasks**:
- Implement OrderBook class (bids/asks sorted by price-time)
- Implement matching algorithm (price-time priority)
- Implement order lifecycle: place, fill, cancel
- Implement trade execution and settlement
- Fee calculation and application

**Deliverables**:
- `src/market/order-book.ts` - Order book data structure
- `src/market/matching-engine.ts` - Pure matching function
- `src/market/settlement.ts` - Balance updates
- Comprehensive tests for edge cases

**Verification**:
- Matching is deterministic (same book + order = same trades)
- Price-time priority is correct
- Partial fills handled correctly
- Fees deducted correctly

---

## Milestone 4: Agent Management & Incentive Field
**Goal**: Implement agent lifecycle, rate limits, decay, and bankruptcy.

**Tasks**:
- Implement Agent registry and state management
- Implement API key generation and validation
- Implement rate limiting (actions per tick)
- Implement capital decay (periodic cash deduction)
- Implement bankruptcy detection and enforcement
- Action validation and rejection

**Deliverables**:
- `src/agents/agent-manager.ts` - Agent lifecycle
- `src/agents/auth.ts` - API key management
- `src/incentives/rate-limiter.ts` - Rate limiting
- `src/incentives/decay.ts` - Capital decay
- `src/incentives/bankruptcy.ts` - Bankruptcy logic

**Verification**:
- Rate limits enforced correctly
- Decay applied at correct intervals
- Bankrupt agents cannot trade
- Rejection events logged properly

---

## Milestone 5: HTTP API Server
**Goal**: Implement the REST API for agents to interact with the simulation.

**Tasks**:
- Set up Fastify server with TypeScript
- Implement authentication middleware
- Implement action submission endpoint (POST /v1/actions)
- Implement agent state endpoint (GET /v1/agent)
- Implement market data endpoints (book, trades, stats)
- Implement idempotency handling
- Error response formatting

**Deliverables**:
- `src/api/server.ts` - Fastify setup
- `src/api/middleware/auth.ts` - Authentication
- `src/api/routes/actions.ts` - Action handling
- `src/api/routes/agent.ts` - Agent state
- `src/api/routes/market.ts` - Market data
- API integration tests

**Verification**:
- Auth rejects invalid keys
- Actions processed correctly
- Idempotency works
- Error responses match spec

---

## Milestone 6: Persistence, CLI & Replay
**Goal**: Implement database persistence, CLI tools, and replay functionality.

**Tasks**:
- Set up Prisma with Postgres schema
- Implement event persistence
- Implement state snapshots
- Implement metrics collection
- CLI commands: create-run, start-run, stop-run, replay-run, export-run
- Docker Compose for Postgres

**Deliverables**:
- `prisma/schema.prisma` - Database schema
- `src/persistence/` - DB operations
- `src/cli/` - CLI commands
- `docker-compose.yml` - Local dev stack
- Export formats: JSONL events, CSV metrics

**Verification**:
- Events persist correctly
- Replay produces identical state
- Export files are valid
- CLI commands work end-to-end

---

## Milestone 7: Bot Clients & Determinism Demo
**Goal**: Create example bots and demonstrate deterministic replay.

**Tasks**:
- Implement simple bot strategies:
  - RandomBot: Random orders near mid
  - MarketMakerBot: Quotes both sides
  - TrendFollowerBot: Follows momentum
  - MeanReversionBot: Fades moves
- Bot runner to spawn multiple bots
- Determinism test: run twice with same seed, verify identical hashes
- WebSocket client for bots (optional)
- Basic dashboard (optional): price chart, leaderboard

**Deliverables**:
- `src/bots/` - Bot implementations
- `src/bots/runner.ts` - Multi-bot orchestration
- `scripts/demo-determinism.ts` - Determinism proof
- `src/dashboard/` - Optional web UI

**Verification**:
- 5-20 bots generate realistic activity
- Two runs with same seed = identical event hash
- Metrics show varied performance across bots

---

## Summary Timeline

| Milestone | Description | Est. Effort |
|-----------|-------------|-------------|
| M1 | Project Setup & Core Types | Foundation |
| M2 | World Kernel & Event System | Core |
| M3 | Matching Engine & Order Book | Core |
| M4 | Agent Management & Incentives | Core |
| M5 | HTTP API Server | Interface |
| M6 | Persistence, CLI & Replay | Infrastructure |
| M7 | Bot Clients & Demo | Validation |

---

## V1 Roadmap (Post-MVP)

After V0 MVP completion:

1. **Additional Instruments**: Multiple order books (ASSET2/CASH, etc.)
2. **Auctions/AMM**: Periodic batch auctions, simple AMM mechanism
3. **Contracts/Escrow**: Forward contracts, escrow for complex trades
4. **Coalition Object Model**: Agent groups, shared resources
5. **Messaging Costs**: Fee for agent-to-agent messaging
6. **Scenario Packs**: Configurable market scenarios, stress tests
7. **Advanced Telemetry**: Sharpe ratio, max drawdown, win rate
8. **Production Hardening**: Horizontal scaling, rate limiting improvements
