import { describe, it, expect } from 'vitest';
import { ErrorCode, ErrorCodeNumber, createError } from '../errors';

describe('Error codes', () => {
  it('has correct numeric codes', () => {
    expect(ErrorCodeNumber[ErrorCode.NotAuthorized]).toBe(1);
    expect(ErrorCodeNumber[ErrorCode.VoucherNotFound]).toBe(2);
    expect(ErrorCodeNumber[ErrorCode.InvalidStatus]).toBe(3);
    expect(ErrorCodeNumber[ErrorCode.NotExpired]).toBe(4);
    expect(ErrorCodeNumber[ErrorCode.AlreadyExpired]).toBe(5);
    expect(ErrorCodeNumber[ErrorCode.InvalidAmount]).toBe(6);
    expect(ErrorCodeNumber[ErrorCode.SchoolNotRegistered]).toBe(7);
    expect(ErrorCodeNumber[ErrorCode.TokenNotAllowed]).toBe(8);
    expect(ErrorCodeNumber[ErrorCode.DuplicateAttestation]).toBe(9);
    expect(ErrorCodeNumber[ErrorCode.ThresholdNotMet]).toBe(10);
  });

  it('creates error with default message', () => {
    const error = createError(ErrorCode.NotAuthorized);
    expect(error.code).toBe(ErrorCode.NotAuthorized);
    expect(error.message).toBe('Not authorized to perform this action');
  });

  it('creates error with custom message', () => {
    const error = createError(ErrorCode.InvalidAmount, 'Custom message');
    expect(error.message).toBe('Custom message');
  });
});
