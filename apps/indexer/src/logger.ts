/**
 * Structured logger for the indexer.
 * README section: "Operations and monitoring" — structured JSON logging.
 *
 * Logs must NEVER contain student identifiers, salts, or student_refs
 * paired with identifying information.
 */

import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: ['studentIdentifier', 'salt', 'studentRef', '*.studentIdentifier', '*.salt'],
    censor: '[REDACTED]',
  },
});
