import { describe, it, expect } from 'vitest';
import {
  FeeCategory,
  FeeCategoryCode,
  FeeCategoryFromCode,
  VoucherStatus,
} from '../types';

describe('FeeCategory', () => {
  it('has exactly 5 categories', () => {
    expect(Object.keys(FeeCategory).length).toBe(5);
  });

  it('has correct codes', () => {
    expect(FeeCategoryCode[FeeCategory.TUITION]).toBe(0);
    expect(FeeCategoryCode[FeeCategory.BOARDING]).toBe(1);
    expect(FeeCategoryCode[FeeCategory.EXAM_FEES]).toBe(2);
    expect(FeeCategoryCode[FeeCategory.UNIFORM_BOOKS]).toBe(3);
    expect(FeeCategoryCode[FeeCategory.TRANSPORT]).toBe(4);
  });

  it('maps codes back correctly', () => {
    expect(FeeCategoryFromCode[0]).toBe(FeeCategory.TUITION);
    expect(FeeCategoryFromCode[1]).toBe(FeeCategory.BOARDING);
    expect(FeeCategoryFromCode[4]).toBe(FeeCategory.TRANSPORT);
  });
});

describe('VoucherStatus', () => {
  it('includes reserved statuses', () => {
    expect(VoucherStatus.Disputed).toBe('Disputed');
    expect(VoucherStatus.Refunded).toBe('Refunded');
  });
});
