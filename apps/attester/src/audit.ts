/**
 * Tamper-evident audit log (hash-chained entries).
 *
 * README section: "Attester service responsibilities"
 *   "Keep a tamper-evident audit log of every decision, including rejections."
 *
 * Each entry contains:
 *   - id: auto-increment
 *   - voucherId
 *   - decision: 'approved' | 'rejected' | 'skipped' (e.g., expired)
 *   - reason: string
 *   - attesterAddress
 *   - timestamp (ISO-8601)
 *   - prevHash: SHA-256 of the previous entry's canonical form
 *   - entryHash: SHA-256 of this entry's canonical form
 *
 * The chain can be verified by replaying all entries in order and
 * checking that each entry's prevHash matches the previous entry's
 * entryHash.  Any tampering breaks the chain.
 *
 * Storage: Postgres table attester_audit_log.
 * The schema is created on first use (idempotent).
 */

import { createHash } from 'crypto';
import type { Pool } from 'pg';
import { logger } from './logger';

export type AuditDecision = 'approved' | 'rejected' | 'skipped' | 'error';

export interface AuditEntry {
  id: number;
  voucherId: string;
  decision: AuditDecision;
  reason: string;
  attesterAddress: string;
  timestamp: string;
  prevHash: string;
  entryHash: string;
}

export interface NewAuditEntry {
  voucherId: string;
  decision: AuditDecision;
  reason: string;
  attesterAddress: string;
}

// ─── Schema ───────────────────────────────────────────────────────────────

export async function ensureAuditTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS attester_audit_log (
      id               BIGSERIAL PRIMARY KEY,
      voucher_id       TEXT NOT NULL,
      decision         TEXT NOT NULL CHECK (decision IN ('approved','rejected','skipped','error')),
      reason           TEXT NOT NULL,
      attester_address TEXT NOT NULL,
      timestamp        TIMESTAMPTZ NOT NULL DEFAULT now(),
      prev_hash        TEXT NOT NULL,
      entry_hash       TEXT NOT NULL
    )
  `);
}

// ─── Hash helpers ─────────────────────────────────────────────────────────

/**
 * Canonical JSON for hashing — deterministic field order.
 * MUST remain stable; changing the order breaks historical chain verification.
 */
function canonical(entry: Omit<AuditEntry, 'id'>): string {
  return JSON.stringify({
    voucherId: entry.voucherId,
    decision: entry.decision,
    reason: entry.reason,
    attesterAddress: entry.attesterAddress,
    timestamp: entry.timestamp,
    prevHash: entry.prevHash,
  });
}

function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

// ─── Write ────────────────────────────────────────────────────────────────

/**
 * Appends a new entry to the audit log, chaining it to the previous entry.
 * Returns the stored entry including id and hashes.
 *
 * The write uses a serialized transaction to prevent concurrent appends from
 * breaking the chain.  In a distributed deployment, use an advisory lock or
 * a dedicated audit-log service.
 */
export async function appendAuditEntry(
  pool: Pool,
  entry: NewAuditEntry,
): Promise<AuditEntry> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch the last entry's hash (or use genesis hash if none exists)
    const { rows: lastRows } = await client.query<{ entry_hash: string }>(
      `SELECT entry_hash FROM attester_audit_log ORDER BY id DESC LIMIT 1`,
    );
    const prevHash = lastRows.length > 0 ? lastRows[0].entry_hash : sha256('GENESIS');

    const timestamp = new Date().toISOString();

    const partial: Omit<AuditEntry, 'id'> = {
      voucherId: entry.voucherId,
      decision: entry.decision,
      reason: entry.reason,
      attesterAddress: entry.attesterAddress,
      timestamp,
      prevHash,
      entryHash: '', // computed below
    };

    const entryHash = sha256(canonical(partial));
    partial.entryHash = entryHash;

    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO attester_audit_log
         (voucher_id, decision, reason, attester_address, timestamp, prev_hash, entry_hash)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7)
       RETURNING id`,
      [
        partial.voucherId,
        partial.decision,
        partial.reason,
        partial.attesterAddress,
        partial.timestamp,
        partial.prevHash,
        partial.entryHash,
      ],
    );

    await client.query('COMMIT');

    const stored: AuditEntry = { id: rows[0].id, ...partial };
    logger.info(
      {
        auditId: stored.id,
        voucherId: stored.voucherId,
        decision: stored.decision,
      },
      'Audit entry appended',
    );
    return stored;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Verify ───────────────────────────────────────────────────────────────

/**
 * Verifies the hash chain integrity for all entries belonging to the given
 * attesterAddress (or all entries if no address given).
 *
 * Returns { valid: true } or { valid: false, firstBrokenId: number }.
 */
export async function verifyAuditChain(
  pool: Pool,
  attesterAddress?: string,
): Promise<{ valid: boolean; firstBrokenId?: number; count: number }> {
  const { rows } = await pool.query<{
    id: number;
    voucher_id: string;
    decision: string;
    reason: string;
    attester_address: string;
    timestamp: Date;
    prev_hash: string;
    entry_hash: string;
  }>(
    attesterAddress
      ? `SELECT * FROM attester_audit_log WHERE attester_address = $1 ORDER BY id ASC`
      : `SELECT * FROM attester_audit_log ORDER BY id ASC`,
    attesterAddress ? [attesterAddress] : [],
  );

  if (rows.length === 0) {
    return { valid: true, count: 0 };
  }

  let expectedPrevHash = sha256('GENESIS');

  for (const row of rows) {
    const partial: Omit<AuditEntry, 'id'> = {
      voucherId: row.voucher_id,
      decision: row.decision as AuditDecision,
      reason: row.reason,
      attesterAddress: row.attester_address,
      timestamp: row.timestamp.toISOString(),
      prevHash: row.prev_hash,
      entryHash: '',
    };

    if (row.prev_hash !== expectedPrevHash) {
      return { valid: false, firstBrokenId: row.id, count: rows.length };
    }

    const computed = sha256(canonical(partial));
    if (computed !== row.entry_hash) {
      return { valid: false, firstBrokenId: row.id, count: rows.length };
    }

    expectedPrevHash = row.entry_hash;
  }

  return { valid: true, count: rows.length };
}

// ─── Query ────────────────────────────────────────────────────────────────

export async function getAuditEntriesForAttester(
  pool: Pool,
  attesterAddress: string,
  limit = 100,
): Promise<AuditEntry[]> {
  const { rows } = await pool.query<{
    id: number;
    voucher_id: string;
    decision: string;
    reason: string;
    attester_address: string;
    timestamp: Date;
    prev_hash: string;
    entry_hash: string;
  }>(
    `SELECT * FROM attester_audit_log
     WHERE attester_address = $1
     ORDER BY id DESC
     LIMIT $2`,
    [attesterAddress, limit],
  );

  return rows.map((row) => ({
    id: row.id,
    voucherId: row.voucher_id,
    decision: row.decision as AuditDecision,
    reason: row.reason,
    attesterAddress: row.attester_address,
    timestamp: row.timestamp.toISOString(),
    prevHash: row.prev_hash,
    entryHash: row.entry_hash,
  }));
}
