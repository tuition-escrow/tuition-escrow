-- Migration 002: indexer support
-- Adds indexer cursor table and attestation_count to vouchers.
-- README section: "System architecture — Indexer"

-- Cursor row persisted atomically with event writes
CREATE TABLE IF NOT EXISTS indexer_cursor (
  id            TEXT PRIMARY KEY DEFAULT 'singleton',
  last_ledger   BIGINT NOT NULL DEFAULT 0,
  last_event_id TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO indexer_cursor (id, last_ledger)
VALUES ('singleton', 0)
ON CONFLICT (id) DO NOTHING;

-- Track attestation count on the voucher row for convenience
-- (the attested event carries the authoritative count)
ALTER TABLE vouchers
  ADD COLUMN IF NOT EXISTS attestation_count SMALLINT NOT NULL DEFAULT 0;

-- Index for TTL job: find Funded vouchers near expiry quickly
CREATE INDEX IF NOT EXISTS idx_vouchers_funded_expiry
  ON vouchers(expires_at)
  WHERE status = 'Funded';
