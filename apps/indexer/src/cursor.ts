/**
 * Cursor persistence layer.
 *
 * README section: "System architecture — Indexer"
 *   "Persist a cursor/last-processed ledger transactionally with the writes
 *    so restarts never skip or double-apply."
 *
 * The cursor row is upserted inside the SAME database transaction as the
 * event writes.  A restart therefore always resumes from the correct point.
 *
 * Schema (created here if not present — idempotent):
 *
 *   CREATE TABLE IF NOT EXISTS indexer_cursor (
 *     id              TEXT PRIMARY KEY DEFAULT 'singleton',
 *     last_ledger     BIGINT NOT NULL DEFAULT 0,
 *     last_event_id   TEXT,          -- RPC event cursor string (for pagination)
 *     updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
 *   );
 */

import type { PoolClient } from 'pg';

export interface Cursor {
  lastLedger: number;
  lastEventId: string | null;
}

export async function ensureCursorTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS indexer_cursor (
      id            TEXT PRIMARY KEY DEFAULT 'singleton',
      last_ledger   BIGINT NOT NULL DEFAULT 0,
      last_event_id TEXT,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  // Insert a default row if none exists
  await client.query(`
    INSERT INTO indexer_cursor (id, last_ledger)
    VALUES ('singleton', 0)
    ON CONFLICT (id) DO NOTHING
  `);
}

export async function readCursor(client: PoolClient): Promise<Cursor> {
  const { rows } = await client.query<{
    last_ledger: string;
    last_event_id: string | null;
  }>(`SELECT last_ledger, last_event_id FROM indexer_cursor WHERE id = 'singleton'`);

  if (rows.length === 0) {
    return { lastLedger: 0, lastEventId: null };
  }
  return {
    lastLedger: parseInt(rows[0].last_ledger, 10),
    lastEventId: rows[0].last_event_id,
  };
}

export async function writeCursor(
  client: PoolClient,
  lastLedger: number,
  lastEventId: string | null,
): Promise<void> {
  await client.query(
    `UPDATE indexer_cursor
     SET last_ledger = $1, last_event_id = $2, updated_at = now()
     WHERE id = 'singleton'`,
    [lastLedger, lastEventId],
  );
}
