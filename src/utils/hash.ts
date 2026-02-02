/**
 * Hash utilities for event chain integrity.
 * Uses SHA-256 for tamper-evident event hashing.
 */

import { createHash } from 'crypto';

/**
 * Compute SHA-256 hash of input string.
 */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Sort object keys recursively for canonical JSON.
 */
function sortObject(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sortObject);
  }

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj as Record<string, unknown>).sort();

  for (const key of keys) {
    sorted[key] = sortObject((obj as Record<string, unknown>)[key]);
  }

  return sorted;
}

/**
 * Produce canonical JSON string with sorted keys and no whitespace.
 * Used for deterministic hashing.
 */
export function canonicalJson(obj: unknown): string {
  return JSON.stringify(sortObject(obj));
}

/**
 * Compute hash of an object using canonical JSON.
 */
export function hashObject(obj: unknown): string {
  return sha256(canonicalJson(obj));
}

/**
 * Compute event hash for the event chain.
 * Hash = SHA256(prevHash + canonicalJson(eventData))
 */
export function computeEventHash(
  eventData: {
    runId: string;
    tickId: number;
    eventSeq: number;
    eventType: string;
    agentId: string | null;
    payload: unknown;
  },
  prevHash: string
): string {
  const canonical = canonicalJson({
    runId: eventData.runId,
    tickId: eventData.tickId,
    eventSeq: eventData.eventSeq,
    eventType: eventData.eventType,
    agentId: eventData.agentId,
    payload: eventData.payload,
    prevHash: prevHash,
  });

  return sha256(canonical);
}

/**
 * Genesis hash constant for first event.
 */
export const GENESIS_HASH = 'GENESIS';

/**
 * Generate a random UUID v4 using crypto (for non-deterministic contexts).
 */
export function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Set version (4) and variant (10xx) bits
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * Create a deterministic ID generator from a seed.
 * Returns a function that generates sequential UUIDs deterministically.
 */
export function createDeterministicIdGenerator(seed: number): () => string {
  let counter = 0;

  return function generateDeterministicId(): string {
    // Create ID from seed + counter, hashed for uniformity
    const input = `${seed}-${counter++}`;
    const hash = sha256(input);

    // Format as UUID (using first 32 hex chars)
    return [
      hash.slice(0, 8),
      hash.slice(8, 12),
      '4' + hash.slice(13, 16), // Version 4
      ((parseInt(hash.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20), // Variant
      hash.slice(20, 32),
    ].join('-');
  };
}

/**
 * Generate an API key for an agent.
 */
export function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return 'mm_' + Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Hash an API key for storage.
 */
export function hashApiKey(apiKey: string): string {
  return sha256(apiKey);
}
