-- Migration 005: add student_ref to student_mappings
-- This allows linking student_mappings to vouchers when on-chain funded events are indexed,
-- and ensures school admins can look up the encrypted mapping for their vouchers.

ALTER TABLE student_mappings
  ADD COLUMN IF NOT EXISTS student_ref TEXT;

CREATE INDEX IF NOT EXISTS idx_student_mappings_student_ref
  ON student_mappings (student_ref);
