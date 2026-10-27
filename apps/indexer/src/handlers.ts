/**
 * Event handlers — apply decoded events to the database.
 *
 * README sections:
 *   "System architecture — Indexer"
 *   "Smart contract specification — Events"
 *   "Operations and monitoring — The chain is the source of truth"
 *
 * Design invariants enforced here:
 *   1. Every handler is IDEMPOTENT: replaying the same event produces the
 *      same state (ON CONFLICT DO NOTHING or conditional UPDATE).
 *   2. Handlers NEVER create state that contradicts the contract:
 *      - Only status transitions that the contract allows are applied.
 *      - The handler for 'attested' increments a counter but does NOT
 *        release funds — that is done by 'released'.
 *   3. Handlers run inside a caller-supplied database transaction so the
 *      cursor update is atomic with the state change.
 *   4. No student identifiers, salts, or personal data are written here.
 *      The voucher row mirrors only the on-chain fields.
 *
 * Gap recovery (README: "Detect and recover from gaps"):
 *   If the RPC event retention window has been exceeded (the node no longer
 *   holds the events we need), the indexer falls back to get_voucher reads
 *   via the fallback module.  Handlers here handle the normal event path.
 */

import type { PoolClient } from 'pg';
import type {
  FundedEvent,
  AttestedEvent,
  ReleasedEvent,
  ReclaimedEvent,
  CancelledEvent,
} from './decoder';
import { logger } from './logger';
import { eventsCounter } from './metrics';

// ─── funded ───────────────────────────────────────────────────────────────

/**
 * Insert a new voucher row from the 'funded' event.
 * ON CONFLICT DO NOTHING ensures idempotency.
 *
 * NOTE: expires_at from the contract is a Unix timestamp (u64 seconds).
 * We convert to a TIMESTAMPTZ via to_timestamp().
 */
export async function handleFunded(client: PoolClient, ev: FundedEvent): Promise<void> {
  await client.query(
    `INSERT INTO vouchers
       (voucher_id, funder, school, token, amount, category, student_ref, expires_at, status, created_at)
     VALUES
       ($1, $2, $3, $4, $5::numeric, $6, '', to_timestamp($7), 'Funded', now())
     ON CONFLICT (voucher_id) DO NOTHING`,
    [
      ev.id.toString(),
      ev.funder,
      ev.school,
      ev.token,
      ev.amount.toString(),
      ev.category,
      Number(ev.expiresAt),
    ],
  );

  // Track attestation_count in a separate column if not already present.
  // The column is added by a migration; if it doesn't exist yet, this is a no-op.
  await client.query(
    `UPDATE vouchers
     SET attestation_count = COALESCE(attestation_count, 0)
     WHERE voucher_id = $1 AND attestation_count IS NULL`,
    [ev.id.toString()],
  ).catch(() => {
    // Column may not exist in older migrations — ignore gracefully.
  });

  eventsCounter.inc({ event_type: 'funded' });
  logger.info({ voucherId: ev.id.toString(), ledger: ev.ledger }, 'indexed: funded');
}

// ─── attested ─────────────────────────────────────────────────────────────

/**
 * Record an attestation.
 * Idempotent: we track the count from the event itself (not by incrementing).
 * The 'released' event is authoritative for the Released status change.
 */
export async function handleAttested(client: PoolClient, ev: AttestedEvent): Promise<void> {
  // Only update if the new count is higher (safe against replays that arrive
  // out of order or are duplicated).
  await client.query(
    `UPDATE vouchers
     SET attestation_count = GREATEST(COALESCE(attestation_count, 0), $2),
         updated_at = now()
     WHERE voucher_id = $1
       AND status = 'Funded'`,
    [ev.id.toString(), ev.count],
  ).catch(() => {
    // attestation_count column may not exist in older schema — ignore.
  });

  eventsCounter.inc({ event_type: 'attested' });
  logger.info(
    { voucherId: ev.id.toString(), attester: ev.attester, count: ev.count, ledger: ev.ledger },
    'indexed: attested',
  );
}

// ─── released ─────────────────────────────────────────────────────────────

/**
 * Mark voucher as Released.
 * Only applies if currently Funded (idempotent if already Released).
 */
export async function handleReleased(client: PoolClient, ev: ReleasedEvent): Promise<void> {
  await client.query(
    `UPDATE vouchers
     SET status = 'Released', updated_at = now()
     WHERE voucher_id = $1
       AND status = 'Funded'`,
    [ev.id.toString()],
  );

  eventsCounter.inc({ event_type: 'released' });
  logger.info(
    { voucherId: ev.id.toString(), school: ev.school, amount: ev.amount.toString(), ledger: ev.ledger },
    'indexed: released',
  );
}

// ─── reclaimed ────────────────────────────────────────────────────────────

/**
 * Mark voucher as Reclaimed.
 * Only applies if currently Funded (idempotent if already Reclaimed).
 */
export async function handleReclaimed(client: PoolClient, ev: ReclaimedEvent): Promise<void> {
  await client.query(
    `UPDATE vouchers
     SET status = 'Reclaimed', updated_at = now()
     WHERE voucher_id = $1
       AND status = 'Funded'`,
    [ev.id.toString()],
  );

  eventsCounter.inc({ event_type: 'reclaimed' });
  logger.info(
    { voucherId: ev.id.toString(), funder: ev.funder, amount: ev.amount.toString(), ledger: ev.ledger },
    'indexed: reclaimed',
  );
}

// ─── cancelled ────────────────────────────────────────────────────────────

/**
 * Mark voucher as Cancelled.
 * Only applies if currently Funded (idempotent if already Cancelled).
 */
export async function handleCancelled(client: PoolClient, ev: CancelledEvent): Promise<void> {
  await client.query(
    `UPDATE vouchers
     SET status = 'Cancelled', updated_at = now()
     WHERE voucher_id = $1
       AND status = 'Funded'`,
    [ev.id.toString()],
  );

  eventsCounter.inc({ event_type: 'cancelled' });
  logger.info(
    { voucherId: ev.id.toString(), ledger: ev.ledger },
    'indexed: cancelled',
  );
}
