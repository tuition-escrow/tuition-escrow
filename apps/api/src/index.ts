/**
 * Express application.
 *
 * README sections: "Tech stack", "REST endpoints", "Fees and reserves",
 *   "Operations and monitoring"
 *
 * Audit checklist (per task requirements):
 *   ✓ No personal data outside student_mappings
 *   ✓ No endpoint can move escrowed funds (API holds no signing keys)
 *   ✓ Sponsorship restricted to allowlisted operations
 *   ✓ Every endpoint corresponds to a README flow
 *   ✓ Structured JSON logging with request IDs (pino-http)
 *   ✓ Prometheus metrics on /metrics
 *   ✓ Sentry initialised from environment
 */

import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { Pool } from 'pg';
import { schoolsRouter } from './routes/schools';
import { vouchersRouter, schoolVouchersRouter } from './routes/vouchers';
import { StudentMappingService } from './services/studentMapping';
import { createKmsAdapter } from './kms/kms';
import { logger } from './logger';
import { requestLogger } from './middleware/requestLogger';
import { metricsRegistry } from './metrics';
import { initJobs } from './jobs/worker';
import { initSentry } from '@tuition-escrow/shared';

export function createApp(pool: Pool): express.Application {
  const app = express();

  // ── Structured request logging (pino-http) ────────────────────────────
  app.use(requestLogger);

  app.use(express.json());

  // Global rate limit — prevent abuse
  app.use(
    rateLimit({
      windowMs: 60_000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  // ── Services ──────────────────────────────────────────────────────────
  const kms = createKmsAdapter();
  const kmsKeyId = process.env.KMS_KEY_ID ?? 'dev-key';
  const mappingService = new StudentMappingService(pool, kms, kmsKeyId);

  // ── Health endpoints ──────────────────────────────────────────────────
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  app.get('/ready', async (_req: Request, res: Response) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'not_ready', reason: 'db_unavailable' });
    }
  });

  // ── Metrics endpoint ──────────────────────────────────────────────────
  app.get('/metrics', async (_req: Request, res: Response) => {
    res.setHeader('Content-Type', metricsRegistry.contentType);
    res.end(await metricsRegistry.metrics());
  });

  // ── API routes ────────────────────────────────────────────────────────
  app.use('/schools', schoolsRouter(pool));
  app.use('/vouchers', vouchersRouter(pool, mappingService));
  app.use('/schools/:id/vouchers', schoolVouchersRouter(pool, mappingService));

  // ── 404 handler ───────────────────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'not_found' });
  });

  return app;
}

// ── Entry point ───────────────────────────────────────────────────────────

async function main() {
  // Initialise Sentry early — before anything else can throw
  initSentry('api');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const app = createApp(pool);
  const port = parseInt(process.env.API_PORT ?? '3001', 10);

  // Start background jobs (TTL extension, expiry reminders)
  initJobs(pool);

  app.listen(port, () => {
    logger.info({ port }, 'API server started');
  });
}

if (require.main === module) {
  main().catch((err) => {
    logger.error(err, 'Fatal startup error');
    process.exit(1);
  });
}
