export enum ErrorCode {
  NotAuthorized = 'NotAuthorized',
  VoucherNotFound = 'VoucherNotFound',
  InvalidStatus = 'InvalidStatus',
  NotExpired = 'NotExpired',
  AlreadyExpired = 'AlreadyExpired',
  InvalidAmount = 'InvalidAmount',
  SchoolNotRegistered = 'SchoolNotRegistered',
  TokenNotAllowed = 'TokenNotAllowed',
  DuplicateAttestation = 'DuplicateAttestation',
  ThresholdNotMet = 'ThresholdNotMet',
}

export const ErrorCodeNumber: Record<ErrorCode, number> = {
  [ErrorCode.NotAuthorized]: 1,
  [ErrorCode.VoucherNotFound]: 2,
  [ErrorCode.InvalidStatus]: 3,
  [ErrorCode.NotExpired]: 4,
  [ErrorCode.AlreadyExpired]: 5,
  [ErrorCode.InvalidAmount]: 6,
  [ErrorCode.SchoolNotRegistered]: 7,
  [ErrorCode.TokenNotAllowed]: 8,
  [ErrorCode.DuplicateAttestation]: 9,
  [ErrorCode.ThresholdNotMet]: 10,
};

export interface AppError {
  code: ErrorCode;
  message: string;
}

export function createError(code: ErrorCode, message?: string): AppError {
  const defaultMessages: Record<ErrorCode, string> = {
    [ErrorCode.NotAuthorized]: 'Not authorized to perform this action',
    [ErrorCode.VoucherNotFound]: 'Voucher not found',
    [ErrorCode.InvalidStatus]: 'Invalid voucher status',
    [ErrorCode.NotExpired]: 'Voucher has not expired',
    [ErrorCode.AlreadyExpired]: 'Voucher has already expired',
    [ErrorCode.InvalidAmount]: 'Invalid amount',
    [ErrorCode.SchoolNotRegistered]: 'School not registered',
    [ErrorCode.TokenNotAllowed]: 'Token not allowed',
    [ErrorCode.DuplicateAttestation]: 'Duplicate attestation',
    [ErrorCode.ThresholdNotMet]: 'Attestation threshold not met',
  };
  return {
    code,
    message: message || defaultMessages[code],
  };
}
