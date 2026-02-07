import { useEffect, useRef, useState, useCallback } from 'react';
import { connectStream } from '../api.js';

export interface StreamEvent {
  id: number;
  timestamp: number;
  data: Record<string, unknown>;
}

let nextId = 0;

/**
 * Connect to the WS event stream. Returns accumulated events and connection status.
 * maxEvents caps the buffer to prevent memory growth.
 */
export function useEventStream(maxEvents = 200): {
  events: StreamEvent[];
  connected: boolean;
  clear: () => void;
} {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const connRef = useRef<{ close: () => void } | null>(null);

  useEffect(() => {
    connRef.current = connectStream(
      (data) => {
        const event: StreamEvent = {
          id: nextId++,
          timestamp: Date.now(),
          data: data as Record<string, unknown>,
        };
        setEvents((prev) => {
          const next = [event, ...prev];
          return next.length > maxEvents ? next.slice(0, maxEvents) : next;
        });
      },
      setConnected,
    );

    return () => {
      connRef.current?.close();
    };
  }, [maxEvents]);

  const clear = useCallback(() => setEvents([]), []);

  return { events, connected, clear };
}
