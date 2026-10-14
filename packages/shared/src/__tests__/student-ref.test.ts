import { describe, it, expect } from 'vitest';
import { generateSalt, computeStudentRef, constantTimeCompare } from '../student-ref';

describe('student-ref helpers', () => {
  it('generates salt of correct length', () => {
    const salt = generateSalt();
    expect(salt.length).toBe(64); // 32 bytes * 2 hex chars
  });

  it('generates unique salts', () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    expect(salt1).not.toBe(salt2);
  });

  it('computes student ref as SHA-256 hex', () => {
    const salt = 'a'.repeat(64);
    const ref = computeStudentRef(salt, 'student123');
    expect(ref.length).toBe(64); // SHA-256 hex
    expect(ref).toMatch(/^[0-9a-f]{64}$/);
  });

  it('computes consistent hash', () => {
    const salt = 'b'.repeat(64);
    const ref1 = computeStudentRef(salt, 'student123');
    const ref2 = computeStudentRef(salt, 'student123');
    expect(ref1).toBe(ref2);
  });

  it('produces different hashes for different salts', () => {
    const ref1 = computeStudentRef('a'.repeat(64), 'student123');
    const ref2 = computeStudentRef('b'.repeat(64), 'student123');
    expect(ref1).not.toBe(ref2);
  });

  it('constant time compare works correctly', () => {
    expect(constantTimeCompare('abc', 'abc')).toBe(true);
    expect(constantTimeCompare('abc', 'abd')).toBe(false);
    expect(constantTimeCompare('abc', 'ab')).toBe(false);
  });
});
