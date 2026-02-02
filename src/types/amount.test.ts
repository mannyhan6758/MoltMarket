import { describe, it, expect } from 'vitest';
import {
  parseAmount,
  formatAmount,
  formatAmountDisplay,
  addAmount,
  subAmount,
  mulAmount,
  divAmount,
  mulBasisPoints,
  compareAmount,
  UNIT,
  ZERO,
} from './amount.js';

describe('Amount', () => {
  describe('parseAmount', () => {
    it('parses integer', () => {
      expect(parseAmount('100')).toBe(100n * UNIT);
    });

    it('parses decimal', () => {
      expect(parseAmount('100.5')).toBe(10050000000n);
    });

    it('parses full precision', () => {
      expect(parseAmount('100.12345678')).toBe(10012345678n);
    });

    it('parses negative', () => {
      expect(parseAmount('-50.25')).toBe(-5025000000n);
    });

    it('parses zero', () => {
      expect(parseAmount('0')).toBe(0n);
      expect(parseAmount('0.00')).toBe(0n);
    });

    it('throws on invalid format', () => {
      expect(() => parseAmount('abc')).toThrow();
      expect(() => parseAmount('100.123456789')).toThrow(); // Too many decimals
    });
  });

  describe('formatAmount', () => {
    it('formats integer', () => {
      expect(formatAmount(100n * UNIT)).toBe('100.00000000');
    });

    it('formats decimal', () => {
      expect(formatAmount(10050000000n)).toBe('100.50000000');
    });

    it('formats negative', () => {
      expect(formatAmount(-5025000000n)).toBe('-50.25000000');
    });

    it('formats zero', () => {
      expect(formatAmount(0n)).toBe('0.00000000');
    });

    it('formats small amounts', () => {
      expect(formatAmount(1n)).toBe('0.00000001');
    });
  });

  describe('formatAmountDisplay', () => {
    it('trims trailing zeros', () => {
      expect(formatAmountDisplay(100n * UNIT)).toBe('100.00');
    });

    it('keeps significant decimals', () => {
      expect(formatAmountDisplay(10050000000n)).toBe('100.50');
    });
  });

  describe('arithmetic', () => {
    it('adds correctly', () => {
      const a = parseAmount('100.50');
      const b = parseAmount('50.25');
      expect(formatAmount(addAmount(a, b))).toBe('150.75000000');
    });

    it('subtracts correctly', () => {
      const a = parseAmount('100.50');
      const b = parseAmount('50.25');
      expect(formatAmount(subAmount(a, b))).toBe('50.25000000');
    });

    it('multiplies correctly (price * quantity)', () => {
      const price = parseAmount('100.00');
      const quantity = parseAmount('10.00');
      const value = mulAmount(price, quantity);
      expect(formatAmount(value)).toBe('1000.00000000');
    });

    it('divides correctly', () => {
      const value = parseAmount('1000.00');
      const divisor = parseAmount('4.00');
      const result = divAmount(value, divisor);
      expect(formatAmount(result)).toBe('250.00000000');
    });

    it('calculates basis points', () => {
      const amount = parseAmount('10000.00');
      const fee = mulBasisPoints(amount, 10); // 10 bps = 0.1%
      expect(formatAmount(fee)).toBe('10.00000000');
    });
  });

  describe('comparison', () => {
    it('compares correctly', () => {
      const a = parseAmount('100.00');
      const b = parseAmount('50.00');
      const c = parseAmount('100.00');

      expect(compareAmount(a, b)).toBe(1);
      expect(compareAmount(b, a)).toBe(-1);
      expect(compareAmount(a, c)).toBe(0);
    });
  });

  describe('determinism', () => {
    it('produces consistent results across runs', () => {
      // Same operations should produce identical results
      const results: string[] = [];

      for (let i = 0; i < 3; i++) {
        const a = parseAmount('123.456');
        const b = parseAmount('78.901');
        const sum = addAmount(a, b);
        const product = mulAmount(a, b);
        const quotient = divAmount(a, b);
        results.push(`${formatAmount(sum)}|${formatAmount(product)}|${formatAmount(quotient)}`);
      }

      expect(results[0]).toBe(results[1]);
      expect(results[1]).toBe(results[2]);
    });
  });
});
