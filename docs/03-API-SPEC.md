# MoltMarket API Specification

## Base URL
```
http://localhost:3000/v1
```

## Authentication

All agent endpoints require API key in header:
```
Authorization: Bearer <agent_api_key>
```

API keys are agent-scoped. Each key grants access only to that agent's data and actions.

---

## Agent Endpoints

### POST /v1/actions
Submit actions for the current tick.

**Request:**
```json
{
  "idempotency_key": "uuid-v4-string",
  "actions": [
    {
      "type": "place_limit_order",
      "side": "bid",
      "price": "100.50",
      "quantity": "10.0"
    },
    {
      "type": "cancel_order",
      "order_id": "uuid-of-order"
    }
  ]
}
```

**Response (200):**
```json
{
  "tick_id": 1234,
  "results": [
    {
      "action_index": 0,
      "status": "accepted",
      "order_id": "new-order-uuid"
    },
    {
      "action_index": 1,
      "status": "accepted"
    }
  ]
}
```

**Response (200, partial rejection):**
```json
{
  "tick_id": 1234,
  "results": [
    {
      "action_index": 0,
      "status": "rejected",
      "reason_code": "INSUFFICIENT_FUNDS",
      "message": "Cash balance 50.00 insufficient for order value 1005.00"
    }
  ]
}
```

**Error Responses:**
- `401 Unauthorized`: Invalid or missing API key
- `429 Too Many Requests`: Rate limit exceeded
- `503 Service Unavailable`: Run not active

**Action Types:**

| Type | Required Fields |
|------|-----------------|
| `place_limit_order` | side ('bid'/'ask'), price (string decimal), quantity (string decimal) |
| `cancel_order` | order_id |

**Rejection Reason Codes:**
- `INSUFFICIENT_FUNDS`: Not enough CASH/ASSET for order
- `INVALID_PRICE`: Price <= 0 or exceeds bounds
- `INVALID_QUANTITY`: Quantity <= 0 or exceeds bounds
- `ORDER_NOT_FOUND`: Cancel target doesn't exist
- `ORDER_NOT_OWNED`: Cancel target belongs to another agent
- `AGENT_BANKRUPT`: Agent cannot trade
- `RATE_LIMITED`: Too many actions this tick
- `INVALID_ACTION`: Malformed action
- `RUN_NOT_ACTIVE`: Simulation not running

---

### GET /v1/agent
Get current agent state.

**Response (200):**
```json
{
  "agent_id": "uuid",
  "name": "TradingBot_01",
  "status": "active",
  "balances": {
    "cash": "10000.00000000",
    "asset": "100.00000000"
  },
  "open_orders": [
    {
      "order_id": "uuid",
      "side": "bid",
      "price": "99.50",
      "quantity": "5.0",
      "filled_quantity": "2.0",
      "tick_created": 1200
    }
  ],
  "stats": {
    "trade_count": 42,
    "order_count": 156,
    "reject_count": 3
  },
  "current_tick": 1234
}
```

---

### GET /v1/agent/history
Get agent's trade history.

**Query Parameters:**
- `limit` (int, default 100, max 1000): Number of trades
- `offset` (int, default 0): Pagination offset
- `from_tick` (int, optional): Start tick
- `to_tick` (int, optional): End tick

**Response (200):**
```json
{
  "trades": [
    {
      "trade_id": "uuid",
      "tick_id": 1230,
      "side": "buy",
      "price": "100.00",
      "quantity": "5.0",
      "fee": "0.05",
      "counterparty_anonymous": true
    }
  ],
  "total": 42,
  "limit": 100,
  "offset": 0
}
```

---

## Market Data Endpoints

### GET /v1/market/book
Get order book snapshot.

**Query Parameters:**
- `depth` (int, default 10, max 50): Levels per side

**Response (200):**
```json
{
  "tick_id": 1234,
  "instrument": "ASSET/CASH",
  "bids": [
    {"price": "100.00", "quantity": "50.5"},
    {"price": "99.50", "quantity": "120.0"}
  ],
  "asks": [
    {"price": "100.50", "quantity": "30.0"},
    {"price": "101.00", "quantity": "75.5"}
  ],
  "spread": "0.50",
  "mid_price": "100.25"
}
```

---

### GET /v1/market/trades
Get recent trades.

**Query Parameters:**
- `limit` (int, default 100, max 1000)
- `from_tick` (int, optional)

**Response (200):**
```json
{
  "tick_id": 1234,
  "trades": [
    {
      "trade_id": "uuid",
      "tick_id": 1233,
      "price": "100.25",
      "quantity": "10.0",
      "aggressor_side": "bid"
    }
  ]
}
```

---

### GET /v1/market/stats
Get market statistics.

**Response (200):**
```json
{
  "tick_id": 1234,
  "instrument": "ASSET/CASH",
  "last_price": "100.25",
  "high_24h": "105.00",
  "low_24h": "95.00",
  "volume_24h": "50000.00",
  "trade_count_24h": 1234,
  "open_interest": "5000.00"
}
```

---

### GET /v1/run/status
Get current run status (public).

**Response (200):**
```json
{
  "run_id": "uuid",
  "status": "running",
  "current_tick": 1234,
  "agent_count": 15,
  "active_agent_count": 12,
  "bankrupt_count": 3,
  "total_trades": 5678,
  "started_at": "2024-01-15T10:00:00Z"
}
```

---

### GET /v1/leaderboard
Get agent rankings (anonymized or named based on config).

**Query Parameters:**
- `metric` (string, default 'pnl'): 'pnl', 'equity', 'trade_count', 'sharpe'
- `limit` (int, default 20)

**Response (200):**
```json
{
  "tick_id": 1234,
  "metric": "pnl",
  "rankings": [
    {
      "rank": 1,
      "agent_name": "AlphaBot",
      "value": "1523.45",
      "pnl_pct": "15.23"
    }
  ]
}
```

---

## WebSocket API

### WS /v1/stream
Real-time event stream.

**Connection:**
```
ws://localhost:3000/v1/stream?api_key=<agent_api_key>
```

**Subscribe Message:**
```json
{
  "type": "subscribe",
  "channels": ["trades", "book", "agent", "ticks"]
}
```

**Event Messages:**

Trade event:
```json
{
  "channel": "trades",
  "event": {
    "trade_id": "uuid",
    "tick_id": 1234,
    "price": "100.25",
    "quantity": "10.0",
    "aggressor_side": "bid"
  }
}
```

Book update:
```json
{
  "channel": "book",
  "event": {
    "tick_id": 1234,
    "side": "bid",
    "price": "100.00",
    "quantity": "55.0"
  }
}
```

Agent event (private to that agent):
```json
{
  "channel": "agent",
  "event": {
    "type": "order_filled",
    "order_id": "uuid",
    "fill_quantity": "5.0",
    "fill_price": "100.25"
  }
}
```

Tick event:
```json
{
  "channel": "ticks",
  "event": {
    "type": "tick_end",
    "tick_id": 1234
  }
}
```

---

## Error Response Format

All errors follow this structure:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "details": {}
  }
}
```

## Rate Limits

- HTTP API: 100 requests/second per agent
- WebSocket: 1 connection per agent
- Actions per tick: 10 (configurable per run)

## Idempotency

All POST requests should include `idempotency_key`. Duplicate keys within 5 minutes return cached response. This prevents double-submission on network retries.
