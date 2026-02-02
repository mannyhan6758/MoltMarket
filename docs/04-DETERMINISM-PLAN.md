# MoltMarket Determinism & Replay Plan

## Determinism Model

### Core Principle
Given identical inputs `(scenario_version, seed, ordered_actions)`, the system produces identical outputs (state, events, hashes).

### What is Deterministic

| Component | Source of Determinism |
|-----------|----------------------|
| Tick progression | Sequential integer counter |
| Action ordering | (tick_id, receive_sequence) assigned by server |
| Order matching | Price-time priority using (price, sequence_num) |
| RNG for scenarios | Mulberry32 PRNG seeded once per run |
| Fee calculation | Fixed formulas, no floating point |
| Decay calculation | Fixed formulas, applied at specific tick intervals |
| Event hashing | Canonical JSON serialization + SHA-256 |

### What is NOT Deterministic (and how we handle it)

| Source of Non-determinism | Mitigation |
|---------------------------|------------|
| Wall-clock time | Not used for ordering; only stored as metadata |
| Network arrival order | Server assigns monotonic `receive_sequence` |
| Floating point | Use integer arithmetic (amounts in smallest units) or Decimal.js |
| Hash map iteration order | Use sorted arrays or Maps with explicit ordering |
| Async/Promise ordering | Kernel is synchronous within a tick |

### Determinism Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│                    DETERMINISTIC ZONE                        │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  World Kernel                                        │    │
│  │  - State transitions                                 │    │
│  │  - Matching engine                                   │    │
│  │  - Event emission                                    │    │
│  │  - RNG (seeded Mulberry32)                          │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                 NON-DETERMINISTIC (External)                 │
│  - Network I/O (API server)                                 │
│  - Database writes (Postgres)                               │
│  - Wall clock timestamps                                    │
│  - Agent behavior                                           │
└─────────────────────────────────────────────────────────────┘
```

## Numeric Precision

All monetary amounts stored as integers representing the smallest unit:
- 1 CASH = 100,000,000 units (8 decimal places)
- All calculations use BigInt or integer arithmetic
- Division rounds toward zero (truncation)
- Display layer converts to decimal strings

```typescript
// Internal representation
type Amount = bigint; // in smallest units

// Example: 100.50 CASH = 10050000000n
const PRECISION = 8n;
const UNIT = 10n ** PRECISION; // 100000000n

function toAmount(decimal: string): Amount {
  // Parse "100.50" -> 10050000000n
}

function toDecimal(amount: Amount): string {
  // Format 10050000000n -> "100.50000000"
}
```

## Random Number Generation

Using Mulberry32 - simple, fast, deterministic 32-bit PRNG:

```typescript
function mulberry32(seed: number): () => number {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Usage
const rng = mulberry32(runSeed);
const randomValue = rng(); // 0.0 to 1.0
```

RNG is ONLY used for:
- Scenario events (supply/demand shocks)
- Initial agent allocations (if randomized)

RNG is NEVER used for:
- Action ordering (use receive_sequence)
- Matching priority (use price + sequence_num)
- Tie-breaking (use deterministic rules)

## Event Hash Chain

Each event includes:
- `prev_hash`: Hash of the previous event (or "GENESIS" for first)
- `event_hash`: SHA-256 of canonical representation

```typescript
interface Event {
  run_id: string;
  tick_id: number;
  event_seq: number;
  event_type: string;
  payload: object;
  prev_hash: string;
  event_hash: string;
}

function computeEventHash(event: Omit<Event, 'event_hash'>, prevHash: string): string {
  const canonical = canonicalJson({
    run_id: event.run_id,
    tick_id: event.tick_id,
    event_seq: event.event_seq,
    event_type: event.event_type,
    payload: event.payload,
    prev_hash: prevHash,
  });
  return sha256(canonical);
}

function canonicalJson(obj: object): string {
  // Sort keys recursively, no whitespace
  return JSON.stringify(obj, Object.keys(obj).sort());
}
```

## Replay System

### Replay Modes

1. **Full Replay**: Reconstruct complete state from events
2. **Verification Replay**: Verify event hashes match
3. **Partial Replay**: Reconstruct to specific tick

### Replay Algorithm

```typescript
async function replayRun(runId: string, targetTick?: number): Promise<WorldState> {
  // 1. Load run configuration
  const run = await db.runs.findUnique({ where: { id: runId } });

  // 2. Initialize empty world state
  const world = new WorldState(run.config, run.seed);

  // 3. Load events in order
  const events = await db.events.findMany({
    where: {
      run_id: runId,
      ...(targetTick ? { tick_id: { lte: targetTick } } : {})
    },
    orderBy: [{ tick_id: 'asc' }, { event_seq: 'asc' }]
  });

  // 4. Apply events sequentially
  let prevHash = 'GENESIS';
  for (const event of events) {
    // Verify hash chain
    const expectedHash = computeEventHash(event, prevHash);
    if (event.event_hash !== expectedHash) {
      throw new ReplayError(`Hash mismatch at tick ${event.tick_id} seq ${event.event_seq}`);
    }

    // Apply event to state
    world.applyEvent(event);
    prevHash = event.event_hash;
  }

  return world;
}
```

### State Reconstruction from Events

| Event Type | State Change |
|------------|--------------|
| `AGENT_CREATED` | Add agent to registry |
| `ORDER_PLACED` | Add order to book |
| `ORDER_CANCELLED` | Remove order from book |
| `TRADE_EXECUTED` | Update balances, fill orders |
| `BALANCE_UPDATED` | Update agent balance |
| `AGENT_BANKRUPT` | Mark agent inactive |
| `TICK_START/END` | Update tick counter |

### Replay Verification

```typescript
async function verifyReplay(runId: string): Promise<VerificationResult> {
  // 1. Replay from events
  const replayedState = await replayRun(runId);

  // 2. Load stored final state
  const storedState = await loadStoredState(runId);

  // 3. Compare
  const match = deepEqual(replayedState, storedState);

  // 4. Return result with any differences
  return {
    valid: match,
    finalEventHash: replayedState.lastEventHash,
    storedEventHash: storedState.lastEventHash,
    differences: match ? [] : findDifferences(replayedState, storedState)
  };
}
```

## Cross-Run Reproducibility

To reproduce a run exactly:

1. Save `run_artifact.json`:
```json
{
  "scenario_version": "v1.0.0",
  "seed": 12345,
  "config": { /* full config */ },
  "agent_action_log": [
    {"tick": 1, "agent_id": "...", "actions": [...]},
    // ...
  ]
}
```

2. Replay tool reads artifact and re-submits actions in order
3. Resulting event hashes must match original

## Testing Determinism

```typescript
describe('Determinism', () => {
  it('produces identical events with same seed and actions', async () => {
    const config = { seed: 42, scenario: 'basic' };
    const actions = loadFixtureActions('test_actions.json');

    // Run 1
    const run1 = await createAndExecuteRun(config, actions);

    // Run 2 (identical inputs)
    const run2 = await createAndExecuteRun(config, actions);

    // Compare final event hashes
    expect(run1.finalEventHash).toBe(run2.finalEventHash);

    // Compare full event sequences
    expect(run1.events.map(e => e.event_hash))
      .toEqual(run2.events.map(e => e.event_hash));
  });

  it('produces different events with different seed', async () => {
    const actions = loadFixtureActions('test_actions.json');

    const run1 = await createAndExecuteRun({ seed: 42 }, actions);
    const run2 = await createAndExecuteRun({ seed: 43 }, actions);

    // Different scenario events = different hashes
    expect(run1.finalEventHash).not.toBe(run2.finalEventHash);
  });
});
```

## Invariants to Verify

1. **Hash Chain Integrity**: Each event_hash is correctly computed
2. **Balance Conservation**: Sum of all CASH/ASSET constant (minus fees)
3. **Order Book Consistency**: All open orders in book = orders with status 'open'
4. **Monotonic Sequences**: tick_id and event_seq always increase
5. **Bankruptcy Correctness**: Bankrupt agents have negative or zero cash trigger
