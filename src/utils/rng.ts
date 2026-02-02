/**
 * Deterministic random number generator using Mulberry32 algorithm.
 * 32-bit PRNG - simple, fast, and deterministic.
 */

export interface RNG {
  /** Get next random number in [0, 1) */
  next(): number;
  /** Get next random integer in [min, max] inclusive */
  nextInt(min: number, max: number): number;
  /** Get next random bigint in [min, max] inclusive */
  nextBigInt(min: bigint, max: bigint): bigint;
  /** Get current internal state for saving */
  getState(): number;
  /** Shuffle an array in place deterministically */
  shuffle<T>(array: T[]): T[];
  /** Pick a random element from array */
  pick<T>(array: readonly T[]): T;
  /** Return true with given probability */
  chance(probability: number): boolean;
}

/**
 * Create a new Mulberry32 RNG from a seed.
 */
export function createRNG(seed: number): RNG {
  let state = seed >>> 0; // Ensure 32-bit unsigned

  function next(): number {
    let t = (state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function nextInt(min: number, max: number): number {
    if (min > max) {
      throw new Error(`Invalid range: min ${min} > max ${max}`);
    }
    const range = max - min + 1;
    return Math.floor(next() * range) + min;
  }

  function nextBigInt(min: bigint, max: bigint): bigint {
    if (min > max) {
      throw new Error(`Invalid range: min ${min} > max ${max}`);
    }
    const range = max - min + 1n;
    // Use multiple random calls for large ranges
    if (range <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return min + BigInt(Math.floor(next() * Number(range)));
    }
    // For very large ranges, combine multiple 32-bit values
    const bits = range.toString(2).length;
    const chunks = Math.ceil(bits / 32);
    let result = 0n;
    for (let i = 0; i < chunks; i++) {
      result = (result << 32n) | BigInt(Math.floor(next() * 4294967296));
    }
    return min + (result % range);
  }

  function getState(): number {
    return state;
  }

  function shuffle<T>(array: T[]): T[] {
    // Fisher-Yates shuffle
    for (let i = array.length - 1; i > 0; i--) {
      const j = nextInt(0, i);
      [array[i], array[j]] = [array[j]!, array[i]!];
    }
    return array;
  }

  function pick<T>(array: readonly T[]): T {
    if (array.length === 0) {
      throw new Error('Cannot pick from empty array');
    }
    return array[nextInt(0, array.length - 1)]!;
  }

  function chance(probability: number): boolean {
    return next() < probability;
  }

  return {
    next,
    nextInt,
    nextBigInt,
    getState,
    shuffle,
    pick,
    chance,
  };
}

/**
 * Create RNG from a string seed (hashes the string).
 */
export function createRNGFromString(seed: string): RNG {
  // Simple hash function to convert string to number
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return createRNG(hash >>> 0);
}
