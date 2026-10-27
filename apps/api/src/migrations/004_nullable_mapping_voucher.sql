-- Migration 004: fix student_mappings.voucher_id nullable
-- The prepareMapping() call inserts a row before the on-chain fund() call,
-- so voucher_id cannot be NOT NULL at insert time. It is populated by
-- confirmVoucherFunded() after the transaction is confirmed.

ALTER TABLE student_mappings
  ALTER COLUMN voucher_id DROP NOT NULL;

-- Drop the old FK (was NOT NULL REFERENCES vouchers ON DELETE RESTRICT)
-- and recreate it as nullable with the same referential action.
ALTER TABLE student_mappings
  DROP CONSTRAINT IF EXISTS student_mappings_voucher_id_fkey;

ALTER TABLE student_mappings
  ADD CONSTRAINT student_mappings_voucher_id_fkey
  FOREIGN KEY (voucher_id)
  REFERENCES vouchers(voucher_id)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

-- Update the unique constraint to allow multiple NULLs
-- (PostgreSQL treats NULLs as distinct in UNIQUE, so this is safe.)
