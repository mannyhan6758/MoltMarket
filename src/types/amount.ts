/**
 * Amount type for precise financial calculations.
 * Uses BigInt internally with 8 decimal places of precision.
 * 1.00000000 = 100_000_000n internal units
 */

export const PRECISION = 8;
export const UNIT = BigInt(10 ** PRECISION); // 100_000_000n

export type Amount = bigint;

/**
 * Parse a decimal string to Amount.
 * Supports up to 8 decimal places.
 */
export function parseAmount(value: string): Amount {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid amount format: ${value}`);
  }

  const negative = trimmed.startsWith('-');
  const absolute = negative ? trimmed.slice(1) : trimmed;
  const [intPart, decPart = ''] = absolute.split('.');

  if (decPart.length > PRECISION) {
    throw new Error(`Amount exceeds ${PRECISION} decimal places: ${value}`);
  }

  const paddedDec = decPart.padEnd(PRECISION, '0');
  const combined = BigInt(intPart + paddedDec);

  return negative ? -combined : combined;
}

/**
 * Format Amount to decimal string with full precision.
 */
export function formatAmount(amount: Amount): string {
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const str = absolute.toString().padStart(PRECISION + 1, '0');

  const intPart = str.slice(0, -PRECISION) || '0';
  const decPart = str.slice(-PRECISION);

  return `${negative ? '-' : ''}${intPart}.${decPart}`;
}

/**
 * Format Amount with trimmed trailing zeros for display.
 */
export function formatAmountDisplay(amount: Amount, minDecimals = 2): string {
  const full = formatAmount(amount);
  const [intPart, decPart] = full.split('.');

  // Remove trailing zeros but keep at least minDecimals
  let trimmed = decPart!.replace(/0+$/, '');
  if (trimmed.length < minDecimals) {
    trimmed = trimmed.padEnd(minDecimals, '0');
  }

  return `${intPart}.${trimmed}`;
}

/**
 * Add two amounts.
 */
export function addAmount(a: Amount, b: Amount): Amount {
  return a + b;
}

/**
 * Subtract two amounts.
 */
export function subAmount(a: Amount, b: Amount): Amount {
  return a - b;
}

/**
 * Multiply amount by another amount (for price * quantity).
 * Result is divided by UNIT to maintain precision.
 */
export function mulAmount(a: Amount, b: Amount): Amount {
  return (a * b) / UNIT;
}

/**
 * Divide amount by another amount.
 * Result is multiplied by UNIT to maintain precision.
 */
export function divAmount(a: Amount, b: Amount): Amount {
  if (b === 0n) {
    throw new Error('Division by zero');
  }
  return (a * UNIT) / b;
}

/**
 * Multiply amount by a basis points value (1 bp = 0.01% = 0.0001).
 * Used for fee calculations.
 */
export function mulBasisPoints(amount: Amount, basisPoints: number): Amount {
  return (amount * BigInt(basisPoints)) / 10000n;
}

/**
 * Compare two amounts.
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 */
export function compareAmount(a: Amount, b: Amount): -1 | 0 | 1 {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Check if amount is zero.
 */
export function isZero(amount: Amount): boolean {
  return amount === 0n;
}

/**
 * Check if amount is positive.
 */
export function isPositive(amount: Amount): boolean {
  return amount > 0n;
}

/**
 * Check if amount is negative.
 */
export function isNegative(amount: Amount): boolean {
  return amount < 0n;
}

/**
 * Get minimum of two amounts.
 */
export function minAmount(a: Amount, b: Amount): Amount {
  return a < b ? a : b;
}

/**
 * Get maximum of two amounts.
 */
export function maxAmount(a: Amount, b: Amount): Amount {
  return a > b ? a : b;
}

/**
 * Get absolute value of amount.
 */
export function absAmount(amount: Amount): Amount {
  return amount < 0n ? -amount : amount;
}

/**
 * Zero amount constant.
 */
export const ZERO: Amount = 0n;

/**
 * Common amounts for convenience.
 */
export const ONE = UNIT;
export const HUNDRED = 100n * UNIT;
export const THOUSAND = 1000n * UNIT;
