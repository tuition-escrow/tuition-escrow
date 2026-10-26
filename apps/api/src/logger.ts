/**
 * Structured logger (pino).
 * Logs must never contain student identifiers, salts, or student_refs
 * paired with identifying information.  This is enforced by convention in
 * each service — this module provides the shared logger instance.
 */

import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    // Redact any field named 'studentIdentifier', 'salt', or 'studentRef'
    // that accidentally reaches the logger.
    paths: ['studentIdentifier', 'salt', 'studentRef', '*.studentIdentifier', '*.salt'],
    censor: '[REDACTED]',
  },
});
