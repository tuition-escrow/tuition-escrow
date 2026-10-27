/**
 * Request-ID middleware.
 *
 * README section: "Operations and monitoring"
 *   "Structured JSON logging with request ids across api, indexer, attester."
 *
 * Attaches a `x-request-id` header (generated if absent) and binds a
 * child logger with that id to `req.log` via pino-http.
 */

import pinoHttp from 'pino-http';
import { randomUUID } from 'crypto';
import { logger } from '../logger';

export const requestLogger = pinoHttp({
  logger,
  genReqId: (req) => {
    const existing = req.headers['x-request-id'];
    return (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
  },
  // Never log Authorization headers or any field that could carry secrets.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
    ],
    censor: '[REDACTED]',
  },
  customLogLevel: (_req, res) => {
    if (res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
});
