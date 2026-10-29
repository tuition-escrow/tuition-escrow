/**
 * BullMQ worker — registers and runs background jobs.
 *
 * README sections:
 *   "Tech stack" — "Redis/BullMQ"
 *   "Operations and monitoring" — TTL extension, expiry reminders
 *
 * Jobs:
 *   ttl-extension    — every 6h; extends Soroban storage TTL for long-running vouchers
 *   expiry-reminders — every 1h; sends expiry notifications at 72h/24h/6h thresholds
 *
 * Retry policy (both jobs):
 *   - Up to 3 attempts with exponential backoff (1s → 2s → 4s).
 *   - Failed jobs are moved to the BullMQ failed queue for inspection.
 *
 * Safety:
 *   - Job handlers are idempotent: running the same job twice has no side
 *     effects beyond extra log lines.
 *   - No signing keys are loaded in this file.  The TTL job calls the
 *     contract via the stub in jobs/ttl.ts (real impl deferred).
 */

import { Worker, Queue } from "bullmq";
import { Pool } from "pg";
import { logger } from "../logger";
import { runTtlExtensionJob } from "./ttl";
import { runExpiryRemindersJob } from "./expiry";

// ─── Job names ────────────────────────────────────────────────────────────

export const JOB_TTL_EXTENSION = "ttl-extension";
export const JOB_EXPIRY_REMINDERS = "expiry-reminders";
export const QUEUE_NAME = "background-jobs";

// ─── Schedule (cron) ──────────────────────────────────────────────────────

/**
 * Job schedule:
 *   ttl-extension    — every 6 hours  ("0 *\/6 * * *")
 *   expiry-reminders — every 1 hour   ("0 * * * *")
 *
 * Documented here per task requirement ("document job schedule and safety margins").
 * Safety margin for TTL: TTL_SAFETY_MARGIN_DAYS (default 30 days) — see jobs/ttl.ts.
 * Safety margin for expiry reminders: tiers 72h, 24h, 6h — see jobs/expiry.ts.
 */
export const JOB_SCHEDULES: Record<string, string> = {
  [JOB_TTL_EXTENSION]: "0 */6 * * *",
  [JOB_EXPIRY_REMINDERS]: "0 * * * *",
};

// ─── Worker factory ───────────────────────────────────────────────────────

export function startJobWorker(pool: Pool, redisUrl: string): Worker {
  const connection = { url: redisUrl };

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      logger.info({ jobName: job.name, jobId: job.id }, "Job started");

      switch (job.name) {
        case JOB_TTL_EXTENSION:
          await runTtlExtensionJob(pool);
          break;
        case JOB_EXPIRY_REMINDERS:
          await runExpiryRemindersJob(pool);
          break;
        default:
          logger.warn({ jobName: job.name }, "Unknown job name — skipping");
      }

      logger.info({ jobName: job.name, jobId: job.id }, "Job completed");
    },
    {
      connection,
      concurrency: 1, // serialize jobs to avoid double-processing
    },
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobName: job?.name, jobId: job?.id, err }, "Job failed");
  });

  worker.on("error", (err) => {
    logger.error({ err }, "Worker error");
  });

  return worker;
}

// ─── Queue / scheduler factory ────────────────────────────────────────────

export function startJobScheduler(redisUrl: string): void {
  const connection = { url: redisUrl };

  // QueueScheduler is needed for delayed and repeatable jobs in BullMQ v4/v5
  // (removed in BullMQ v5 — check your version).
  // If using BullMQ v5+, remove QueueScheduler and use Queue.upsertJobScheduler.
  const queue = new Queue(QUEUE_NAME, { connection });

  const defaultJobOptions = {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: 100,
    removeOnFail: 200,
  };

  // Add repeatable jobs (idempotent — BullMQ deduplicates by key)
  queue.add(
    JOB_TTL_EXTENSION,
    {},
    {
      ...defaultJobOptions,
      repeat: { pattern: JOB_SCHEDULES[JOB_TTL_EXTENSION] },
      jobId: JOB_TTL_EXTENSION,
    },
  );

  queue.add(
    JOB_EXPIRY_REMINDERS,
    {},
    {
      ...defaultJobOptions,
      repeat: { pattern: JOB_SCHEDULES[JOB_EXPIRY_REMINDERS] },
      jobId: JOB_EXPIRY_REMINDERS,
    },
  );

  logger.info({ schedules: JOB_SCHEDULES }, "Job scheduler started");
}

// ─── Entry point (called from apps/api/src/index.ts) ─────────────────────

export function initJobs(pool: Pool): void {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    logger.warn("REDIS_URL not set — background jobs will not start");
    return;
  }

  startJobScheduler(redisUrl);
  startJobWorker(pool, redisUrl);
  logger.info("Background jobs initialized");
}
