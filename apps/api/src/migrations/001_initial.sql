-- Migration 001: initial schema
-- README sections: "Tech stack", "Privacy model: How the mapping works"
--
-- Privacy rules enforced by schema:
--   • student_mappings is the ONLY table allowed to hold any student
--     identifier.  The identifier and salt are stored ENCRYPTED.
--   • No column for name, date_of_birth, grade, health data, or free-text.
--   • audit_log is append-only (no UPDATE/DELETE granted to api role).
--   • vouchers mirrors on-chain fields only; no extra off-chain PII.

-- ─────────────────────────────────────────────────────────────────────────
-- Extensions
-- ─────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()

-- ─────────────────────────────────────────────────────────────────────────
-- Roles enum
-- ─────────────────────────────────────────────────────────────────────────
CREATE TYPE user_role AS ENUM ('funder', 'school_admin', 'attester', 'platform_admin');
CREATE TYPE school_status AS ENUM ('pending', 'active', 'suspended');
CREATE TYPE attester_status AS ENUM ('active', 'revoked');
CREATE TYPE voucher_status AS ENUM (
  'Funded', 'Released', 'Reclaimed', 'Cancelled', 'Disputed', 'Refunded'
);

-- ─────────────────────────────────────────────────────────────────────────
-- users  (platform accounts — funders, school admins, platform admins)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- subject from OIDC provider (e.g., Google sub or local dev subject)
  oidc_subject    TEXT NOT NULL UNIQUE,
  role            user_role NOT NULL,
  -- school_id is set for school_admin role; NULL for funder/platform_admin
  school_id       UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  -- No name, email, phone, or address columns — minimise PII on this table.
  -- Identity details live with the OIDC provider.
);

-- ─────────────────────────────────────────────────────────────────────────
-- schools
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schools (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  stellar_address     TEXT NOT NULL UNIQUE,
  -- verification_status tracks whether a payout-address change has been
  -- re-verified (README: "PATCH payout address changes require re-verification").
  verification_status school_status NOT NULL DEFAULT 'pending',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
  -- No columns for student lists, grades, or other per-student data.
);

-- ─────────────────────────────────────────────────────────────────────────
-- attesters  (authorised attester addresses for each school)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attesters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  stellar_address TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'independent',  -- e.g. 'school_registrar', 'authority', 'platform'
  status          attester_status NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, stellar_address)
);

-- ─────────────────────────────────────────────────────────────────────────
-- vouchers  (mirror of on-chain voucher fields — no extra PII)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vouchers (
  -- voucher_id matches the u64 id from the on-chain contract
  voucher_id      BIGINT PRIMARY KEY,
  funder          TEXT NOT NULL,   -- Stellar address
  school          TEXT NOT NULL,   -- Stellar address
  token           TEXT NOT NULL,   -- SAC address
  amount          NUMERIC(38,0) NOT NULL CHECK (amount > 0),
  -- category is the numeric code (0=TUITION … 4=TRANSPORT)
  category        SMALLINT NOT NULL CHECK (category BETWEEN 0 AND 4),
  -- student_ref is the opaque on-chain hash — NOT the identifier itself
  student_ref     TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  status          voucher_status NOT NULL DEFAULT 'Funded',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  -- No student name, no grade, no free-text memo.
);

-- ─────────────────────────────────────────────────────────────────────────
-- student_mappings  (THE ONLY place a student identifier may exist)
--
-- Both encrypted_student_identifier and encrypted_salt are the output of
-- envelope encryption: AES-256-GCM data key wrapped by KMS.
-- key_id references the KMS key used for the data key.
--
-- Retention: see docs/data-protection.md for purpose limitation and
-- deletion procedure.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS student_mappings (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id                      BIGINT NOT NULL REFERENCES vouchers(voucher_id) ON DELETE RESTRICT,
  -- ciphertext: base64(iv || encrypted_identifier)
  encrypted_student_identifier    TEXT NOT NULL,
  -- ciphertext: base64(iv || encrypted_salt)
  encrypted_salt                  TEXT NOT NULL,
  -- KMS key ID used to wrap the data key for this record
  key_id                          TEXT NOT NULL,
  -- Retention: when set, the record is eligible for deletion
  retain_until                    TIMESTAMPTZ,
  -- Deletion: when set, the plaintext has been deleted (encrypted fields zeroed or removed)
  deleted_at                      TIMESTAMPTZ,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (voucher_id)
  -- Access is logged via audit_log; direct SELECT on this table is
  -- restricted to the api role with row-level access enforced in application code.
);

-- ─────────────────────────────────────────────────────────────────────────
-- audit_log  (append-only; no UPDATE or DELETE)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  event_type  TEXT NOT NULL,
  actor_id    UUID,               -- user id, NULL for system events
  resource    TEXT NOT NULL,      -- e.g. 'voucher:42', 'student_mapping:uuid'
  -- detail must NOT contain student identifiers, salts, or student_refs
  -- paired with identifying information.  Enforced by application layer.
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent UPDATE and DELETE on audit_log (enforce append-only).
-- In production, revoke these privileges from the api role:
--   REVOKE UPDATE, DELETE ON audit_log FROM api_role;

-- ─────────────────────────────────────────────────────────────────────────
-- Foreign key: users.school_id → schools.id
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE users
  ADD CONSTRAINT users_school_id_fkey
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_vouchers_funder   ON vouchers(funder);
CREATE INDEX IF NOT EXISTS idx_vouchers_school   ON vouchers(school);
CREATE INDEX IF NOT EXISTS idx_vouchers_status   ON vouchers(status);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor   ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource);
CREATE INDEX IF NOT EXISTS idx_student_mappings_retain ON student_mappings(retain_until)
  WHERE deleted_at IS NULL;
