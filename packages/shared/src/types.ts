export enum FeeCategory {
  TUITION = 'TUITION',
  BOARDING = 'BOARDING',
  EXAM_FEES = 'EXAM_FEES',
  UNIFORM_BOOKS = 'UNIFORM_BOOKS',
  TRANSPORT = 'TRANSPORT',
}

export const FeeCategoryCode: Record<FeeCategory, number> = {
  [FeeCategory.TUITION]: 0,
  [FeeCategory.BOARDING]: 1,
  [FeeCategory.EXAM_FEES]: 2,
  [FeeCategory.UNIFORM_BOOKS]: 3,
  [FeeCategory.TRANSPORT]: 4,
};

export const FeeCategoryFromCode: Record<number, FeeCategory> = {
  0: FeeCategory.TUITION,
  1: FeeCategory.BOARDING,
  2: FeeCategory.EXAM_FEES,
  3: FeeCategory.UNIFORM_BOOKS,
  4: FeeCategory.TRANSPORT,
};

export enum VoucherStatus {
  Funded = 'Funded',
  Released = 'Released',
  Reclaimed = 'Reclaimed',
  Cancelled = 'Cancelled',
  Disputed = 'Disputed', // reserved, not implemented
  Refunded = 'Refunded', // reserved, not implemented
}

export const VoucherStatusCode: Record<VoucherStatus, number> = {
  [VoucherStatus.Funded]: 0,
  [VoucherStatus.Released]: 1,
  [VoucherStatus.Reclaimed]: 2,
  [VoucherStatus.Cancelled]: 3,
  [VoucherStatus.Disputed]: 4, // reserved, not implemented
  [VoucherStatus.Refunded]: 5, // reserved, not implemented
};
