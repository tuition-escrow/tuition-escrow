/**
 * TTL extension job.
 *
 * README sections:
 *   "Storage and TTL" — "A background job in the API extends TTL for
 *    vouchers approaching expiry so that long-running vouchers are never
 *    archived before they resolve."
 *   "Operations and monitoring" — alert: "Vouchers whose storage TTL is
 *    within a safety margin of archival."
 *
 * Strategy:
 *   - Find all Funded vouchers whose last_ttl_extended_at is older than
 *     TTL_REFRESH_INTERVAL_HOURS, or that have never been extended.
 *   - Call extend_ttl(id) on the contract via a sponsored transaction.
 *   - Back off exponentially on failure; retry up to MAX_RETRIES.
 *
 * Safety margin:
 *   Soroban persistent storage entries expire after a network-defined
 *   maximum TTL (currently ~365 days, but subject to protocol changes).
 *   We extend when the voucher has not been touched in TTL_SAFETY_MARGIN_DAYS.
 *   This is conservative enough to never lose a voucher entry.
 *
 * Sponsored call:
 *   The extend_ttl contract function reads the current storage entry and
 *   re-writes it (triggering a TTL bump).  This costs a tiny resource fee.
 *   We use a fee-bump so the job account pays, not the funder.
 *
 * TODO: replace stub transaction building with real @stellar/stellar-sdk
 *   calls once the SDK version is pinned.  See sponsorship.ts for the
 *   fee-bump pattern.
 *
 * Job schedule: run every TTL_CHECK_INTERVAL_HOURS hours.
 * Safety margin: extend if not refreshed in TTL_SAFETY_MARGIN_DAYS days.
 */

import { Pool } from 'pg';
import { logger } from '../logger';

// ─── Configuration ────────────────────────────────────────────────────────

/** How many days without a TTL touch before we extend. */
export const TTL_SAFETY_MARGIN_DAYS = parseInt(
  process.env.TTL_SAFETY_MARGIN_DAYS ?? '30',
  10,
);

/** How many times to retry a failed extend_ttl submission before giving up. */
export const MAX_TTL_RETRIES = 3;

// ─── Database helpers ─────────────────────────────────────────────────────

export interface VoucherTtlRow {
  voucher_id: string;
  expires_at: Date;
  last_ttl_extended_at: Date | null;
}

export async function findVouchersNeedingTtlExtension(
  pool: Pool,
  safetyMarginDays: number,
): Promise<VoucherTtlRow[]> {
  const { rows } = await pool.query<VoucherTtlRow>(
    `SELECT voucher_id, expires_at, last_ttl_extended_at
     FROM vouchers
     WHERE status = 'Funded'
       AND (
         last_ttl_extended_at IS NULL
         OR last_ttl_extended_at < now() - ($1 || ' days')::interval
       )
     ORDER BY expires_at ASC`,
    [safetyMarginDays],
  );
  return rows;
}

export async function markTtlExtended(pool: Pool, voucherId: string): Promise<void> {
  await pool.query(
    `UPDATE vouchers SET last_ttl_extended_at = now() WHERE voucher_id = $1`,
    [voucherId],
  );
}

// ─── Stub: on-chain extend_ttl call ──────────────────────────────────────

/**
 * Calls extend_ttl(id) on the contract.
 *
 * TODO: implement using the typed contract client from
 * packages/contract-bindings once the SDK is pinned.
 * Steps:
 *   1. Build a transaction calling extend_ttl(voucherId).
 *   2. Simulate to get resource fees.
 *   3. Wrap in a fee-bump (sponsored by FEE_BUMP_SECRET_REF account).
 *   4. Submit and wait for confirmation.
 *
 * Reference: https://developers.stellar.org/docs/data/rpc/api-reference/methods/sendTransaction
 */
async function callExtendTtl(voucherId: string): Promise<void> {
  logger.info({ voucherId }, 'extend_ttl: stub — real SDK call deferred (see TTL job TODO)');
  // In production: throw if the submission fails so the retry logic fires.
}

// ─── Job function ─────────────────────────────────────────────────────────

/**
 * Runs the TTL extension sweep.
 * Called by the BullMQ worker (see jobs/worker.ts) on a schedule.
 */
export async function runTtlExtensionJob(pool: Pool): Promise<void> {
  logger.info({ safetyMarginDays: TTL_SAFETY_MARGIN_DAYS }, 'TTL extension job started');

  const vouchers = await findVouchersNeedingTtlExtension(pool, TTL_SAFETY_MARGIN_DAYS);
  logger.info({ count: vouchers.length }, 'TTL extension: vouchers to extend');

  let success = 0;
  let failed = 0;

  for (const v of vouchers) {
    let attempt = 0;
    let extended = false;

    while (attempt < MAX_TTL_RETRIES && !extended) {
      attempt++;
      try {
        await callExtendTtl(v.voucher_id);
        await markTtlExtended(pool, v.voucher_id);
        extended = true;
        success++;
      } catch (err) {
        const backoffMs = Math.pow(2, attempt) * 1000;
        logger.warn(
          { voucherId: v.voucher_id, attempt, nextRetryMs: backoffMs, err },
          'TTL extension failed — will retry',
        );
        if (attempt < MAX_TTL_RETRIES) {
          await new Promise((r) => setTimeout(r, backoffMs));
        }
      }
    }

    if (!extended) {
      failed++;
      logger.error(
        { voucherId: v.voucher_id },
        'TTL extension failed after max retries — manual intervention may be required',
      );
    }
  }

  logger.info({ success, failed, total: vouchers.length }, 'TTL extension job complete');
}
