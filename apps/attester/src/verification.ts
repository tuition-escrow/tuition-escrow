/**
 * VerificationProvider interface and implementations.
 *
 * README section: "Attester service responsibilities"
 *   "Authenticate the school's record system (API, signed export, or
 *    manual review queue). Check the voucher's condition."
 *
 * Two implementations this sprint:
 *   1. ManualReviewQueueProvider — an authorized human approves/rejects via
 *      the attester service admin endpoint.
 *   2. SignedExportProvider — accepts a signed JSON export for testing.
 *
 * The attester NEVER publishes underlying school records.  The provider
 * only returns ok/reason; it does not expose student data to the caller.
 */

import type { Pool } from 'pg';
import { logger } from './logger';

// ─── Interface ────────────────────────────────────────────────────────────

export interface SchoolRecordsContext {
  /**
   * Opaque school-context token.  Could be a signed JWT from the school's
   * records system or a reference to a pending manual review.
   * MUST NOT contain student names, IDs, or grades.
   */
  token: string;
}

export interface VerificationResult {
  ok: boolean;
  reason: string;
}

export interface VerificationProvider {
  /**
   * Returns whether the conditions for the given voucher have been met.
   * Does NOT submit the confirm transaction — that is the caller's job.
   */
  verify(
    voucherId: bigint,
    context: SchoolRecordsContext,
  ): Promise<VerificationResult>;
}

// ─── ManualReviewQueueProvider ────────────────────────────────────────────

/**
 * ManualReviewQueueProvider
 *
 * Places a pending review record in the database.  An authorized human
 * approves or rejects via the admin endpoint (POST /admin/reviews/:id/approve).
 * verify() polls (or waits) for the decision.
 *
 * Schema:
 *   manual_reviews (id UUID PK, voucher_id BIGINT, status TEXT, reason TEXT,
 *                   created_at TIMESTAMPTZ, decided_at TIMESTAMPTZ)
 *
 * Privacy: manual_reviews contains only voucher_id, not student data.
 */
export class ManualReviewQueueProvider implements VerificationProvider {
  constructor(private readonly pool: Pool) {}

  async verify(voucherId: bigint, context: SchoolRecordsContext): Promise<VerificationResult> {
    // Upsert a pending review row
    await this.pool.query(
      `INSERT INTO manual_reviews (voucher_id, status, context_token)
       VALUES ($1, 'pending', $2)
       ON CONFLICT (voucher_id) DO UPDATE
         SET status = EXCLUDED.status,
             context_token = EXCLUDED.context_token,
             decided_at = NULL,
             reason = NULL`,
      [voucherId.toString(), context.token],
    );

    logger.info({ voucherId: voucherId.toString() }, 'Manual review queued');

    // Poll for decision (up to MANUAL_REVIEW_TIMEOUT_MS, default 30s for tests)
    const timeoutMs = parseInt(process.env.MANUAL_REVIEW_TIMEOUT_MS ?? '30000', 10);
    const pollIntervalMs = 500;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const { rows } = await this.pool.query<{
        status: string;
        reason: string | null;
      }>(
        `SELECT status, reason FROM manual_reviews WHERE voucher_id = $1`,
        [voucherId.toString()],
      );

      const row = rows[0];
      if (!row || row.status === 'pending') {
        await sleep(pollIntervalMs);
        continue;
      }

      if (row.status === 'approved') {
        return { ok: true, reason: row.reason ?? 'Manually approved' };
      } else {
        return { ok: false, reason: row.reason ?? 'Manually rejected' };
      }
    }

    return { ok: false, reason: 'Manual review timed out' };
  }

  /** Called by admin endpoint to record a human decision. */
  async decide(
    voucherId: bigint,
    approved: boolean,
    reason: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE manual_reviews
       SET status = $1, reason = $2, decided_at = now()
       WHERE voucher_id = $3`,
      [approved ? 'approved' : 'rejected', reason, voucherId.toString()],
    );
    logger.info(
      { voucherId: voucherId.toString(), approved, reason },
      'Manual review decided',
    );
  }
}

// ─── SignedExportProvider ─────────────────────────────────────────────────

/**
 * SignedExportProvider — for testing.
 *
 * Accepts a context.token that is a JSON string with shape:
 *   { voucherId: string, approved: boolean, reason: string, sig: string }
 *
 * The sig is a HMAC-SHA256 of (voucherId + ':' + approved + ':' + reason)
 * using the SIGNED_EXPORT_SECRET environment variable.
 *
 * ⚠️  This provider is for integration testing only.
 *    Set VERIFICATION_PROVIDER=signed-export to use it.
 */
import { createHmac } from 'crypto';

export class SignedExportProvider implements VerificationProvider {
  private readonly secret: string;

  constructor(secret?: string) {
    this.secret = secret ?? process.env.SIGNED_EXPORT_SECRET ?? 'test-secret';
  }

  async verify(voucherId: bigint, context: SchoolRecordsContext): Promise<VerificationResult> {
    let payload: { voucherId: string; approved: boolean; reason: string; sig: string };
    try {
      payload = JSON.parse(context.token);
    } catch {
      return { ok: false, reason: 'Invalid export token: not valid JSON' };
    }

    const expected = createHmac('sha256', this.secret)
      .update(`${payload.voucherId}:${payload.approved}:${payload.reason}`)
      .digest('hex');

    if (expected !== payload.sig) {
      logger.warn({ voucherId: voucherId.toString() }, 'SignedExportProvider: invalid signature');
      return { ok: false, reason: 'Invalid export token: signature mismatch' };
    }

    if (payload.voucherId !== voucherId.toString()) {
      return { ok: false, reason: 'Export token voucher_id mismatch' };
    }

    return { ok: payload.approved, reason: payload.reason };
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────

export function createVerificationProvider(pool: Pool): VerificationProvider {
  const kind = process.env.VERIFICATION_PROVIDER ?? 'manual';
  switch (kind) {
    case 'manual':
      return new ManualReviewQueueProvider(pool);
    case 'signed-export':
      return new SignedExportProvider();
    default:
      throw new Error(`Unknown VERIFICATION_PROVIDER: ${kind}`);
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
