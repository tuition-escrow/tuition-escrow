/**
 * Expiry reminder job.
 *
 * README section: "Operations and monitoring"
 *   "Expiry reminders: notify funders (and schools) as expiry approaches"
 *
 * Logic:
 *   For each Funded voucher whose expiry falls within REMINDER_THRESHOLDS_HOURS,
 *   and that has not already had a reminder sent at that tier, send a
 *   notification via the NotificationProvider.
 *
 * Reminder tiers (configurable via env; defaults follow README spirit):
 *   72h, 24h, 6h before expiry
 *
 * Idempotency:
 *   We record sent reminders in the expiry_reminders table so we never
 *   send the same tier twice per voucher.
 *
 * Schema (added to migration 002 / added here on first run):
 *   CREATE TABLE IF NOT EXISTS expiry_reminders (
 *     voucher_id  BIGINT NOT NULL,
 *     tier_hours  INT NOT NULL,
 *     sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
 *     PRIMARY KEY (voucher_id, tier_hours)
 *   );
 */

import { Pool } from 'pg';
import { logger } from '../logger';
import { createNotificationProvider, type NotificationProvider } from './notifications';

export const REMINDER_THRESHOLDS_HOURS: number[] = (
  process.env.EXPIRY_REMINDER_HOURS ?? '72,24,6'
)
  .split(',')
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => !isNaN(n));

export async function ensureExpiryRemindersTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS expiry_reminders (
      voucher_id  BIGINT NOT NULL,
      tier_hours  INT NOT NULL,
      sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (voucher_id, tier_hours)
    )
  `);
}

interface VoucherForReminder {
  voucher_id: string;
  funder: string;
  school: string;
  expires_at: Date;
}

async function findVouchersForReminder(
  pool: Pool,
  tierHours: number,
): Promise<VoucherForReminder[]> {
  // Find Funded vouchers expiring within the tier window that have not
  // yet had a reminder sent for this tier.
  const { rows } = await pool.query<VoucherForReminder>(
    `SELECT v.voucher_id, v.funder, v.school, v.expires_at
     FROM vouchers v
     WHERE v.status = 'Funded'
       AND v.expires_at > now()
       AND v.expires_at <= now() + ($1 || ' hours')::interval
       AND NOT EXISTS (
         SELECT 1 FROM expiry_reminders er
         WHERE er.voucher_id = v.voucher_id::bigint
           AND er.tier_hours = $2
       )
     ORDER BY v.expires_at ASC`,
    [tierHours, tierHours],
  );
  return rows;
}

async function recordReminderSent(
  pool: Pool,
  voucherId: string,
  tierHours: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO expiry_reminders (voucher_id, tier_hours)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [voucherId, tierHours],
  );
}

export async function runExpiryRemindersJob(
  pool: Pool,
  provider?: NotificationProvider,
): Promise<void> {
  await ensureExpiryRemindersTable(pool);
  const notifier = provider ?? createNotificationProvider();

  logger.info({ tiers: REMINDER_THRESHOLDS_HOURS }, 'Expiry reminder job started');

  let totalSent = 0;

  for (const tierHours of REMINDER_THRESHOLDS_HOURS) {
    const vouchers = await findVouchersForReminder(pool, tierHours);

    for (const v of vouchers) {
      const expiresAtIso = v.expires_at.toISOString();
      const hoursRemaining = Math.round(
        (v.expires_at.getTime() - Date.now()) / 3_600_000,
      );

      // Notify funder
      await notifier.send({
        voucherId: v.voucher_id,
        expiresAt: expiresAtIso,
        recipientAddress: v.funder,
        role: 'funder',
        hoursRemaining,
      });

      // Notify school
      await notifier.send({
        voucherId: v.voucher_id,
        expiresAt: expiresAtIso,
        recipientAddress: v.school,
        role: 'school',
        hoursRemaining,
      });

      await recordReminderSent(pool, v.voucher_id, tierHours);
      totalSent += 2;
    }

    logger.info({ tier: tierHours, count: vouchers.length }, 'Reminder tier processed');
  }

  logger.info({ totalSent }, 'Expiry reminder job complete');
}
