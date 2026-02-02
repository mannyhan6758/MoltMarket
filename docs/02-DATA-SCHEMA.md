# MoltMarket Data Schema

## Database Tables

### 1. `runs`
Simulation run metadata.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| seed | BIGINT | RNG seed for reproducibility |
| scenario_version | VARCHAR(64) | Scenario configuration identifier |
| status | ENUM | 'created', 'running', 'stopped', 'completed' |
| config | JSONB | Full configuration snapshot |
| current_tick | BIGINT | Latest processed tick |
| event_count | BIGINT | Total events emitted |
| last_event_hash | VARCHAR(64) | Hash of most recent event |
| created_at | TIMESTAMP | |
| started_at | TIMESTAMP | |
| stopped_at | TIMESTAMP | |

### 2. `agents`
Agent registry and state.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| run_id | UUID | FK to runs |
| api_key_hash | VARCHAR(64) | SHA-256 of API key |
| name | VARCHAR(128) | Display name |
| cash_balance | DECIMAL(20,8) | Current CASH holdings |
| asset_balance | DECIMAL(20,8) | Current ASSET holdings |
| status | ENUM | 'active', 'bankrupt', 'inactive' |
| actions_this_tick | INT | Counter for rate limiting |
| created_at | TIMESTAMP | |
| bankrupted_at_tick | BIGINT | Tick when bankrupted (null if active) |

**Index**: (run_id, api_key_hash)

### 3. `events`
Append-only event log with hash chain.

| Column | Type | Description |
|--------|------|-------------|
| id | BIGSERIAL | Primary key (monotonic) |
| run_id | UUID | FK to runs |
| tick_id | BIGINT | Simulation tick |
| event_seq | BIGINT | Sequence within tick |
| event_type | VARCHAR(64) | Event type code |
| agent_id | UUID | Related agent (nullable) |
| payload | JSONB | Event-specific data |
| prev_hash | VARCHAR(64) | Hash of previous event |
| event_hash | VARCHAR(64) | SHA-256(prev_hash + canonical_json(event)) |
| created_at | TIMESTAMP | Server timestamp (informational only) |

**Index**: (run_id, tick_id, event_seq), (run_id, event_type), (run_id, agent_id)

### 4. `orders`
Active order book state (mutable, can be reconstructed from events).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Order ID |
| run_id | UUID | FK to runs |
| agent_id | UUID | FK to agents |
| side | ENUM | 'bid', 'ask' |
| price | DECIMAL(20,8) | Limit price |
| quantity | DECIMAL(20,8) | Original quantity |
| filled_quantity | DECIMAL(20,8) | Amount filled |
| status | ENUM | 'open', 'filled', 'cancelled', 'expired' |
| tick_created | BIGINT | Tick when order was placed |
| sequence_num | BIGINT | Global sequence for time priority |
| created_at | TIMESTAMP | |

**Index**: (run_id, side, price, sequence_num), (run_id, agent_id, status)

### 5. `trades`
Executed trades (derived from events, for fast querying).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Trade ID |
| run_id | UUID | FK to runs |
| tick_id | BIGINT | Execution tick |
| price | DECIMAL(20,8) | Execution price |
| quantity | DECIMAL(20,8) | Trade size |
| bid_order_id | UUID | Buyer's order |
| ask_order_id | UUID | Seller's order |
| bid_agent_id | UUID | Buyer agent |
| ask_agent_id | UUID | Seller agent |
| fee_total | DECIMAL(20,8) | Total fees collected |
| created_at | TIMESTAMP | |

**Index**: (run_id, tick_id), (run_id, bid_agent_id), (run_id, ask_agent_id)

### 6. `metrics_snapshots`
Periodic agent metrics.

| Column | Type | Description |
|--------|------|-------------|
| id | BIGSERIAL | Primary key |
| run_id | UUID | FK to runs |
| agent_id | UUID | FK to agents |
| tick_id | BIGINT | Snapshot tick |
| cash_balance | DECIMAL(20,8) | |
| asset_balance | DECIMAL(20,8) | |
| equity | DECIMAL(20,8) | cash + asset * mid_price |
| pnl | DECIMAL(20,8) | Equity - initial_equity |
| pnl_pct | DECIMAL(10,6) | PnL percentage |
| max_equity | DECIMAL(20,8) | High water mark |
| drawdown | DECIMAL(10,6) | (max_equity - equity) / max_equity |
| trade_count | INT | Cumulative trades |
| order_count | INT | Cumulative orders |
| reject_count | INT | Cumulative rejections |
| created_at | TIMESTAMP | |

**Index**: (run_id, tick_id), (run_id, agent_id, tick_id)

## Event Types

| Event Type | Payload Fields |
|------------|----------------|
| `RUN_CREATED` | config |
| `RUN_STARTED` | |
| `RUN_STOPPED` | reason |
| `TICK_START` | tick_id |
| `TICK_END` | tick_id, orders_processed, trades_executed |
| `AGENT_CREATED` | agent_id, name, initial_cash, initial_asset |
| `AGENT_BANKRUPT` | agent_id, final_cash, final_asset |
| `ORDER_PLACED` | order_id, agent_id, side, price, quantity |
| `ORDER_CANCELLED` | order_id, agent_id, reason |
| `ORDER_REJECTED` | agent_id, reason_code, details |
| `TRADE_EXECUTED` | trade_id, price, quantity, bid_order_id, ask_order_id, bid_agent_id, ask_agent_id, fee |
| `BALANCE_UPDATED` | agent_id, cash_delta, asset_delta, new_cash, new_asset, reason |
| `DECAY_APPLIED` | agent_id, amount, new_cash |
| `RATE_LIMIT_HIT` | agent_id, actions_attempted, limit |
| `SCENARIO_EVENT` | event_type, params |

## Constraints

1. `events.event_hash` must be unique per run (no duplicate events)
2. `orders.sequence_num` is globally unique per run
3. `agents.cash_balance` >= 0 enforced by bankruptcy logic (not DB constraint)
4. All DECIMAL fields use (20,8) for precision
