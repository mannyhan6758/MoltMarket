/**
 * Event Store - Append-only event log with hash chain integrity.
 */

import { computeEventHash, GENESIS_HASH, generateId } from '../utils/hash.js';
import type { Event, EventType } from '../types/domain.js';

export interface EventData {
  runId: string;
  tickId: number;
  eventType: EventType;
  agentId: string | null;
  payload: Record<string, unknown>;
}

export interface EventStore {
  /** Append a new event and return it with computed hash */
  append(data: EventData): Event;
  /** Get all events for a run */
  getAll(): Event[];
  /** Get events by type */
  getByType(eventType: EventType): Event[];
  /** Get events for an agent */
  getByAgent(agentId: string): Event[];
  /** Get events in a tick */
  getByTick(tickId: number): Event[];
  /** Get last event hash */
  getLastHash(): string;
  /** Get event count */
  getCount(): number;
  /** Clear all events (for testing) */
  clear(): void;
  /** Export events as JSONL */
  exportJsonl(): string;
  /** Verify hash chain integrity */
  verifyChain(): { valid: boolean; errorAt?: number };
}

/**
 * Create an in-memory event store.
 */
export function createEventStore(runId: string): EventStore {
  const events: Event[] = [];
  let eventSeq = 0;
  let lastHash = GENESIS_HASH;

  function append(data: EventData): Event {
    const eventHash = computeEventHash(
      {
        runId: data.runId,
        tickId: data.tickId,
        eventSeq,
        eventType: data.eventType,
        agentId: data.agentId,
        payload: data.payload,
      },
      lastHash
    );

    const event: Event = {
      id: events.length + 1,
      runId: data.runId,
      tickId: data.tickId,
      eventSeq,
      eventType: data.eventType,
      agentId: data.agentId,
      payload: data.payload,
      prevHash: lastHash,
      eventHash,
      createdAt: new Date(),
    } as Event;

    events.push(event);
    lastHash = eventHash;
    eventSeq++;

    return event;
  }

  function getAll(): Event[] {
    return [...events];
  }

  function getByType(eventType: EventType): Event[] {
    return events.filter((e) => e.eventType === eventType);
  }

  function getByAgent(agentId: string): Event[] {
    return events.filter((e) => e.agentId === agentId);
  }

  function getByTick(tickId: number): Event[] {
    return events.filter((e) => e.tickId === tickId);
  }

  function getLastHash(): string {
    return lastHash;
  }

  function getCount(): number {
    return events.length;
  }

  function clear(): void {
    events.length = 0;
    eventSeq = 0;
    lastHash = GENESIS_HASH;
  }

  function exportJsonl(): string {
    return events.map((e) => JSON.stringify(e)).join('\n');
  }

  function verifyChain(): { valid: boolean; errorAt?: number } {
    let prevHash = GENESIS_HASH;

    for (let i = 0; i < events.length; i++) {
      const event = events[i]!;

      // Verify prevHash matches
      if (event.prevHash !== prevHash) {
        return { valid: false, errorAt: i };
      }

      // Recompute hash and verify
      const expectedHash = computeEventHash(
        {
          runId: event.runId,
          tickId: event.tickId,
          eventSeq: event.eventSeq,
          eventType: event.eventType,
          agentId: event.agentId,
          payload: event.payload,
        },
        prevHash
      );

      if (event.eventHash !== expectedHash) {
        return { valid: false, errorAt: i };
      }

      prevHash = event.eventHash;
    }

    return { valid: true };
  }

  return {
    append,
    getAll,
    getByType,
    getByAgent,
    getByTick,
    getLastHash,
    getCount,
    clear,
    exportJsonl,
    verifyChain,
  };
}
