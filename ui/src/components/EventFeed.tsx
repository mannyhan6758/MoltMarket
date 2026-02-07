import { useState } from 'react';
import type { StreamEvent } from '../state/useEventStream.js';

interface Props {
  events: StreamEvent[];
  connected: boolean;
  clear: () => void;
}

const EVENT_TYPES = ['all', 'connected', 'subscribed', 'trade', 'book', 'tick', 'bankrupt'] as const;

export function EventFeed({ events, connected, clear }: Props) {
  const [filter, setFilter] = useState<string>('all');

  const filtered = filter === 'all'
    ? events
    : events.filter((e) => {
        const type = String(e.data.type ?? '').toLowerCase();
        return type.includes(filter);
      });

  return (
    <section className="panel event-feed">
      <h2>
        Event Feed{' '}
        <span className={connected ? 'status-running' : 'status-stopped'}>
          {connected ? 'LIVE' : 'DISCONNECTED'}
        </span>
      </h2>
      <div className="feed-controls">
        {EVENT_TYPES.map((t) => (
          <button
            key={t}
            className={`filter-btn ${filter === t ? 'active' : ''}`}
            onClick={() => setFilter(t)}
          >
            {t}
          </button>
        ))}
        <button className="filter-btn clear-btn" onClick={clear}>Clear</button>
      </div>
      <div className="feed-list">
        {filtered.length === 0 && (
          <div className="muted">
            {connected ? 'Waiting for events...' : 'WebSocket not connected. Events will appear when connected.'}
          </div>
        )}
        {filtered.slice(0, 100).map((ev) => (
          <div key={ev.id} className="feed-item">
            <span className="feed-time">{new Date(ev.timestamp).toLocaleTimeString()}</span>
            <span className="feed-type">{String(ev.data.type ?? 'unknown')}</span>
            <span className="feed-data mono">{JSON.stringify(ev.data, null, 0)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
