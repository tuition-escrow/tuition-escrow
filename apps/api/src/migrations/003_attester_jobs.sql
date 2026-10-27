-- Migration 003: attester manual reviews, expiry reminders, TTL tracking
-- README sections: "Attester model", "Operations and monitoring"

-- Manual review queue (ManualReviewQueueProvider in apps/attester)
CREATE TABLE IF NOT EXISTS manual_reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id      BIGINT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
  context_token   TEXT NOT NULL DEFAULT '',
  reason          TEXT,
  decided_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  -- No student data. voucher_id is the only reference.
);

-- Expiry reminder tracking (runExpiryRemindersJob in apps/api)
CREATE TABLE IF NOT EXISTS expiry_reminders (
  voucher_id  BIGINT NOT NULL,
  tier_hours  INT NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (voucher_id, tier_hours)
);

-- TTL extension tracking on vouchers table
ALTER TABLE vouchers
  ADD COLUMN IF NOT EXISTS last_ttl_extended_at TIMESTAMPTZ;

-- Attester audit log (apps/attester)
CREATE TABLE IF NOT EXISTS attester_audit_log (
  id               BIGSERIAL PRIMARY KEY,
  voucher_id       TEXT NOT NULL,
  decision         TEXT NOT NULL CHECK (decision IN ('approved','rejected','skipped','error')),
  reason           TEXT NOT NULL,
  attester_address TEXT NOT NULL,
  timestamp        TIMESTAMPTZ NOT NULL DEFAULT now(),
  prev_hash        TEXT NOT NULL,
  entry_hash       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attester_audit_log_attester
  ON attester_audit_log(attester_address);

CREATE INDEX IF NOT EXISTS idx_attester_audit_log_voucher
  ON attester_audit_log(voucher_id);
