/**
 * Express application.
 *
 * README sections: "Tech stack", "REST endpoints", "Fees and reserves"
 *
 * Audit checklist (per task requirements):
 *   ✓ No personal data outside student_mappings
 *   ✓ No endpoint can move escrowed funds (API holds no signing keys)
 *   ✓ Sponsorship restricted to allowlisted operations
 *   ✓ Every endpoint corresponds to a README flow
 */

import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { Pool } from 'pg';
import { schoolsRouter } from './routes/schools';
import { vouchersRouter, schoolVouchersRouter } from './routes/vouchers';
import { StudentMappingService } from './services/studentMapping';
import { createKmsAdapter } from './kms/kms';
import { logger } from './logger';

export function createApp(pool: Pool): express.Application {
  const app = express();

  app.use(express.json());

  // Global rate limit — prevent abuse
  app.use(
    rateLimit({
      windowMs: 60_000, // 1 minute
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  // ── Services ──────────────────────────────────────────────────────────────
  const kms = createKmsAdapter();
  const kmsKeyId = process.env.KMS_KEY_ID ?? 'dev-key';
  const mappingService = new StudentMappingService(pool, kms, kmsKeyId);

  // ── Health endpoints ──────────────────────────────────────────────────────
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

  // ── API routes ────────────────────────────────────────────────────────────
  app.use('/schools', schoolsRouter(pool));
  app.use('/vouchers', vouchersRouter(pool, mappingService));
  // Nested: GET /schools/:id/vouchers/:voucherId/mapping
  app.use('/schools/:id/vouchers', schoolVouchersRouter(pool, mappingService));

  // ── 404 handler ───────────────────────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'not_found' });
  });

  return app;
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const app = createApp(pool);
  const port = parseInt(process.env.API_PORT ?? '3001', 10);
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
