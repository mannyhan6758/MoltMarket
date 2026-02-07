/** DTO types for MoltMarket UI. Decoupled from kernel internals. */

export interface RunStatus {
  run_id: string;
  status: 'running' | 'stopped';
  current_tick: number;
  agent_count: number;
  active_agent_count: number;
  bankrupt_count: number;
  total_trades: number;
  started_at: string | null;
}

export interface BookLevel {
  price: string;
  quantity: string;
}

export interface OrderBook {
  tick_id: number;
  instrument: string;
  bids: BookLevel[];
  asks: BookLevel[];
  spread: string | null;
  mid_price: string | null;
}

export interface Trade {
  trade_id: string;
  tick_id: number;
  price: string;
  quantity: string;
  aggressor_side: string;
}

export interface TradesResponse {
  tick_id: number;
  trades: Trade[];
}

export interface LeaderboardEntry {
  rank: number;
  agent_name: string;
  value: string;
  pnl_pct: string;
}

export interface Leaderboard {
  tick_id: number;
  metric: string;
  rankings: LeaderboardEntry[];
}

export interface WsMessage {
  type: string;
  tick_id?: number;
  agent_id?: string | null;
  channels?: string[];
  // Event data fields (flexible)
  [key: string]: unknown;
}
