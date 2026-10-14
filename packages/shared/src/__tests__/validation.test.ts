import { describe, it, expect } from 'vitest';
import {
  validateAmount,
  validateExpiry,
  isValidCategoryCode,
  DEFAULT_LIMITS,
} from '../validation';

describe('validateAmount', () => {
  it('rejects zero', () => {
    const result = validateAmount(0);
    expect(result.valid).toBe(false);
  });

  it('rejects negative', () => {
    const result = validateAmount(-10);
    expect(result.valid).toBe(false);
  });

  it('rejects below min', () => {
    const result = validateAmount(5);
    expect(result.valid).toBe(false);
  });

  it('accepts valid amount', () => {
    const result = validateAmount(100);
    expect(result.valid).toBe(true);
  });

  it('rejects above max', () => {
    const result = validateAmount(2000000);
    expect(result.valid).toBe(false);
  });
});

describe('validateExpiry', () => {
  it('rejects past expiry', () => {
    const now = 1000000;
    const result = validateExpiry(900000, now);
    expect(result.valid).toBe(false);
  });

  it('rejects current time', () => {
    const now = 1000000;
    const result = validateExpiry(1000000, now);
    expect(result.valid).toBe(false);
  });

  it('accepts future expiry', () => {
    const now = 1000000;
    const result = validateExpiry(2000000, now);
    expect(result.valid).toBe(true);
  });

  it('rejects expiry too far in future', () => {
    const now = 1000000;
    const farFuture = now + DEFAULT_LIMITS.maxExpiryHours * 3600 + 1000;
    const result = validateExpiry(farFuture, now);
    expect(result.valid).toBe(false);
  });
});

describe('isValidCategoryCode', () => {
  it('accepts valid codes', () => {
    expect(isValidCategoryCode(0)).toBe(true);
    expect(isValidCategoryCode(4)).toBe(true);
  });

  it('rejects invalid codes', () => {
    expect(isValidCategoryCode(-1)).toBe(false);
    expect(isValidCategoryCode(5)).toBe(false);
  });
});
