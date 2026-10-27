/**
 * Fee-category helpers for the UI.
 * Only the five README-defined categories exist here.
 * No other categories may be added without a README change.
 */

import { FeeCategory, FeeCategoryCode } from '@tuition-escrow/shared';

export const CATEGORY_OPTIONS = [
  { value: FeeCategoryCode[FeeCategory.TUITION],       label: 'Tuition' },
  { value: FeeCategoryCode[FeeCategory.BOARDING],      label: 'Boarding' },
  { value: FeeCategoryCode[FeeCategory.EXAM_FEES],     label: 'Exam Fees' },
  { value: FeeCategoryCode[FeeCategory.UNIFORM_BOOKS], label: 'Uniform & Books' },
  { value: FeeCategoryCode[FeeCategory.TRANSPORT],     label: 'Transport' },
] as const;

export function categoryLabel(code: number): string {
  return CATEGORY_OPTIONS.find((o) => o.value === code)?.label ?? `Category ${code}`;
}
