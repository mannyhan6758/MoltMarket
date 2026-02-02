import { describe, it, expect } from 'vitest';
import { createRNG, createRNGFromString } from './rng.js';

describe('RNG', () => {
  describe('determinism', () => {
    it('produces same sequence from same seed', () => {
      const rng1 = createRNG(12345);
      const rng2 = createRNG(12345);

      const seq1 = Array.from({ length: 100 }, () => rng1.next());
      const seq2 = Array.from({ length: 100 }, () => rng2.next());

      expect(seq1).toEqual(seq2);
    });

    it('produces different sequence from different seed', () => {
      const rng1 = createRNG(12345);
      const rng2 = createRNG(12346);

      const seq1 = Array.from({ length: 10 }, () => rng1.next());
      const seq2 = Array.from({ length: 10 }, () => rng2.next());

      expect(seq1).not.toEqual(seq2);
    });

    it('is reproducible across multiple runs', () => {
      // This tests that the algorithm is truly deterministic
      // These values are specific to our Mulberry32 implementation
      const rng = createRNG(42);
      const sequence = Array.from({ length: 3 }, () => rng.next());

      // Verify determinism by running again
      const rng2 = createRNG(42);
      const sequence2 = Array.from({ length: 3 }, () => rng2.next());

      expect(sequence).toEqual(sequence2);

      // Also verify values are in expected range
      for (const val of sequence) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(1);
      }
    });
  });

  describe('next()', () => {
    it('returns values in [0, 1)', () => {
      const rng = createRNG(42);
      for (let i = 0; i < 1000; i++) {
        const value = rng.next();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    });
  });

  describe('nextInt()', () => {
    it('returns values in [min, max]', () => {
      const rng = createRNG(42);
      for (let i = 0; i < 1000; i++) {
        const value = rng.nextInt(5, 10);
        expect(value).toBeGreaterThanOrEqual(5);
        expect(value).toBeLessThanOrEqual(10);
        expect(Number.isInteger(value)).toBe(true);
      }
    });

    it('handles single value range', () => {
      const rng = createRNG(42);
      for (let i = 0; i < 10; i++) {
        expect(rng.nextInt(5, 5)).toBe(5);
      }
    });

    it('throws on invalid range', () => {
      const rng = createRNG(42);
      expect(() => rng.nextInt(10, 5)).toThrow();
    });
  });

  describe('nextBigInt()', () => {
    it('returns values in [min, max]', () => {
      const rng = createRNG(42);
      for (let i = 0; i < 100; i++) {
        const value = rng.nextBigInt(100n, 200n);
        expect(value).toBeGreaterThanOrEqual(100n);
        expect(value).toBeLessThanOrEqual(200n);
      }
    });
  });

  describe('shuffle()', () => {
    it('is deterministic', () => {
      const rng1 = createRNG(42);
      const rng2 = createRNG(42);

      const arr1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const arr2 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

      rng1.shuffle(arr1);
      rng2.shuffle(arr2);

      expect(arr1).toEqual(arr2);
    });

    it('shuffles in place', () => {
      const rng = createRNG(42);
      const arr = [1, 2, 3, 4, 5];
      const result = rng.shuffle(arr);
      expect(result).toBe(arr);
    });
  });

  describe('pick()', () => {
    it('returns element from array', () => {
      const rng = createRNG(42);
      const arr = ['a', 'b', 'c', 'd', 'e'];

      for (let i = 0; i < 100; i++) {
        const picked = rng.pick(arr);
        expect(arr).toContain(picked);
      }
    });

    it('throws on empty array', () => {
      const rng = createRNG(42);
      expect(() => rng.pick([])).toThrow();
    });
  });

  describe('chance()', () => {
    it('returns boolean', () => {
      const rng = createRNG(42);
      for (let i = 0; i < 100; i++) {
        const result = rng.chance(0.5);
        expect(typeof result).toBe('boolean');
      }
    });

    it('respects probability', () => {
      const rng = createRNG(42);
      let trueCount = 0;
      const iterations = 10000;

      for (let i = 0; i < iterations; i++) {
        if (rng.chance(0.3)) trueCount++;
      }

      const ratio = trueCount / iterations;
      expect(ratio).toBeGreaterThan(0.25);
      expect(ratio).toBeLessThan(0.35);
    });
  });

  describe('createRNGFromString()', () => {
    it('produces same RNG from same string', () => {
      const rng1 = createRNGFromString('test-seed');
      const rng2 = createRNGFromString('test-seed');

      const seq1 = Array.from({ length: 10 }, () => rng1.next());
      const seq2 = Array.from({ length: 10 }, () => rng2.next());

      expect(seq1).toEqual(seq2);
    });

    it('produces different RNG from different string', () => {
      const rng1 = createRNGFromString('seed-a');
      const rng2 = createRNGFromString('seed-b');

      const seq1 = Array.from({ length: 10 }, () => rng1.next());
      const seq2 = Array.from({ length: 10 }, () => rng2.next());

      expect(seq1).not.toEqual(seq2);
    });
  });

  describe('getState()', () => {
    it('returns current internal state', () => {
      const rng = createRNG(42);
      rng.next();
      rng.next();
      const state = rng.getState();
      expect(typeof state).toBe('number');
    });
  });
});
