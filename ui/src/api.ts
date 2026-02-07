/** API client for MoltMarket. Read-only: never calls /v1/actions. */

import type { RunStatus, OrderBook, TradesResponse, Leaderboard } from './types.js';

const BASE = '';  // Same origin in production, proxy in dev

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export function fetchRunStatus(): Promise<RunStatus> {
  return get<RunStatus>('/v1/run/status');
}

export function fetchOrderBook(depth = 10): Promise<OrderBook> {
  return get<OrderBook>(`/v1/market/book?depth=${depth}`);
}

export function fetchTrades(limit = 100): Promise<TradesResponse> {
  return get<TradesResponse>(`/v1/market/trades?limit=${limit}`);
}

export function fetchLeaderboard(metric = 'pnl', limit = 20): Promise<Leaderboard> {
  return get<Leaderboard>(`/v1/leaderboard?metric=${metric}&limit=${limit}`);
}

/** WebSocket client with auto-reconnect. */
export function connectStream(
  onMessage: (data: unknown) => void,
  onStatus: (connected: boolean) => void,
): { close: () => void } {
  let ws: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    if (closed) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/v1/stream`);

    ws.onopen = () => {
      onStatus(true);
      ws?.send(JSON.stringify({ type: 'subscribe', channels: ['trades', 'book', 'agent'] }));
    };

    ws.onmessage = (ev) => {
      try {
        onMessage(JSON.parse(ev.data as string));
      } catch { /* ignore parse errors */ }
    };

    ws.onclose = () => {
      onStatus(false);
      if (!closed) {
        reconnectTimer = setTimeout(connect, 2000);
      }
    };

    ws.onerror = () => {
      ws?.close();
    };
  }

  connect();

  return {
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
