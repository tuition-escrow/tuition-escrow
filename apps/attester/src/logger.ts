/**
 * Structured logger for the attester service.
 * README section: "Operations and monitoring" — structured JSON logging.
 *
 * NEVER log student identifiers, school record details, or private data.
 */

import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: ['studentIdentifier', 'salt', '*.studentIdentifier'],
    censor: '[REDACTED]',
  },
});
