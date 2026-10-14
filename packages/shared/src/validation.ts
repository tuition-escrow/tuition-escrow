export interface ValidationLimits {
  minAmount: number;
  maxAmount: number;
  maxExpiryHours: number;
}

export const DEFAULT_LIMITS: ValidationLimits = {
  minAmount: 10,
  maxAmount: 1000000,
  maxExpiryHours: 8760, // 1 year
};

export function validateAmount(
  amount: number,
  limits: ValidationLimits = DEFAULT_LIMITS
): { valid: boolean; error?: string } {
  if (amount <= 0) {
    return { valid: false, error: 'Amount must be positive' };
  }
  if (amount < limits.minAmount) {
    return {
      valid: false,
      error: `Amount must be >= ${limits.minAmount}`,
    };
  }
  if (amount > limits.maxAmount) {
    return {
      valid: false,
      error: `Amount must be <= ${limits.maxAmount}`,
    };
  }
  return { valid: true };
}

export function validateExpiry(
  expiresAt: number,
  now: number = Date.now() / 1000,
  limits: ValidationLimits = DEFAULT_LIMITS
): { valid: boolean; error?: string } {
  if (expiresAt <= now) {
    return { valid: false, error: 'Expiry must be in the future' };
  }
  const maxExpiry = now + limits.maxExpiryHours * 3600;
  if (expiresAt > maxExpiry) {
    return {
      valid: false,
      error: `Expiry exceeds maximum of ${limits.maxExpiryHours} hours`,
    };
  }
  return { valid: true };
}

export function isValidCategoryCode(code: number): boolean {
  return code >= 0 && code <= 4;
}
