import { describe, it, expect } from 'vitest';
import {
  sha256,
  canonicalJson,
  hashObject,
  computeEventHash,
  GENESIS_HASH,
  generateId,
  generateApiKey,
  hashApiKey,
} from './hash.js';

describe('Hash utilities', () => {
  describe('sha256', () => {
    it('produces consistent hash', () => {
      const input = 'hello world';
      const hash1 = sha256(input);
      const hash2 = sha256(input);
      expect(hash1).toBe(hash2);
    });

    it('produces correct hash for known input', () => {
      // Known SHA-256 hash for "hello world"
      const hash = sha256('hello world');
      expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    });

    it('produces different hash for different input', () => {
      const hash1 = sha256('input1');
      const hash2 = sha256('input2');
      expect(hash1).not.toBe(hash2);
    });

    it('returns 64 character hex string', () => {
      const hash = sha256('test');
      expect(hash).toHaveLength(64);
      expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
    });
  });

  describe('canonicalJson', () => {
    it('sorts object keys', () => {
      const obj = { z: 1, a: 2, m: 3 };
      const json = canonicalJson(obj);
      expect(json).toBe('{"a":2,"m":3,"z":1}');
    });

    it('sorts nested object keys', () => {
      const obj = { b: { z: 1, a: 2 }, a: 1 };
      const json = canonicalJson(obj);
      expect(json).toBe('{"a":1,"b":{"a":2,"z":1}}');
    });

    it('handles arrays', () => {
      const obj = { items: [3, 1, 2] };
      const json = canonicalJson(obj);
      expect(json).toBe('{"items":[3,1,2]}');
    });

    it('handles null values', () => {
      const obj = { a: null, b: 1 };
      const json = canonicalJson(obj);
      expect(json).toBe('{"a":null,"b":1}');
    });

    it('produces deterministic output regardless of key order', () => {
      const obj1 = { z: 1, a: 2 };
      const obj2 = { a: 2, z: 1 };
      expect(canonicalJson(obj1)).toBe(canonicalJson(obj2));
    });

    it('handles complex nested structures', () => {
      const obj = {
        users: [
          { name: 'Alice', age: 30 },
          { name: 'Bob', age: 25 },
        ],
        config: {
          version: 1,
          active: true,
        },
      };
      const json = canonicalJson(obj);
      // Verify it parses back correctly
      const parsed = JSON.parse(json);
      expect(parsed.config.version).toBe(1);
    });
  });

  describe('hashObject', () => {
    it('produces consistent hash for same object', () => {
      const obj = { a: 1, b: 2 };
      const hash1 = hashObject(obj);
      const hash2 = hashObject(obj);
      expect(hash1).toBe(hash2);
    });

    it('produces same hash regardless of key order', () => {
      const obj1 = { a: 1, b: 2 };
      const obj2 = { b: 2, a: 1 };
      expect(hashObject(obj1)).toBe(hashObject(obj2));
    });
  });

  describe('computeEventHash', () => {
    it('produces consistent hash for same event', () => {
      const event = {
        runId: 'run-1',
        tickId: 10,
        eventSeq: 5,
        eventType: 'ORDER_PLACED' as const,
        agentId: 'agent-1',
        payload: { orderId: 'order-1', price: '100.00' },
      };

      const hash1 = computeEventHash(event, GENESIS_HASH);
      const hash2 = computeEventHash(event, GENESIS_HASH);
      expect(hash1).toBe(hash2);
    });

    it('produces different hash with different prevHash', () => {
      const event = {
        runId: 'run-1',
        tickId: 10,
        eventSeq: 5,
        eventType: 'ORDER_PLACED' as const,
        agentId: 'agent-1',
        payload: { orderId: 'order-1' },
      };

      const hash1 = computeEventHash(event, 'prev-hash-1');
      const hash2 = computeEventHash(event, 'prev-hash-2');
      expect(hash1).not.toBe(hash2);
    });

    it('produces different hash for different event data', () => {
      const event1 = {
        runId: 'run-1',
        tickId: 10,
        eventSeq: 5,
        eventType: 'ORDER_PLACED' as const,
        agentId: 'agent-1',
        payload: { orderId: 'order-1' },
      };

      const event2 = {
        ...event1,
        eventSeq: 6, // Different sequence
      };

      const hash1 = computeEventHash(event1, GENESIS_HASH);
      const hash2 = computeEventHash(event2, GENESIS_HASH);
      expect(hash1).not.toBe(hash2);
    });

    it('includes agentId in hash', () => {
      const event1 = {
        runId: 'run-1',
        tickId: 10,
        eventSeq: 5,
        eventType: 'ORDER_PLACED' as const,
        agentId: 'agent-1',
        payload: {},
      };

      const event2 = {
        ...event1,
        agentId: 'agent-2',
      };

      const hash1 = computeEventHash(event1, GENESIS_HASH);
      const hash2 = computeEventHash(event2, GENESIS_HASH);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('generateId', () => {
    it('generates valid UUID format', () => {
      const id = generateId();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      expect(uuidRegex.test(id)).toBe(true);
    });

    it('generates unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        ids.add(generateId());
      }
      expect(ids.size).toBe(1000);
    });
  });

  describe('generateApiKey', () => {
    it('generates key with mm_ prefix', () => {
      const key = generateApiKey();
      expect(key.startsWith('mm_')).toBe(true);
    });

    it('generates 67 character keys', () => {
      const key = generateApiKey();
      expect(key).toHaveLength(67); // 'mm_' (3) + 64 hex chars
    });

    it('generates unique keys', () => {
      const keys = new Set<string>();
      for (let i = 0; i < 100; i++) {
        keys.add(generateApiKey());
      }
      expect(keys.size).toBe(100);
    });
  });

  describe('hashApiKey', () => {
    it('produces consistent hash', () => {
      const key = 'mm_test_key_12345';
      const hash1 = hashApiKey(key);
      const hash2 = hashApiKey(key);
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different keys', () => {
      const hash1 = hashApiKey('mm_key_1');
      const hash2 = hashApiKey('mm_key_2');
      expect(hash1).not.toBe(hash2);
    });
  });
});
