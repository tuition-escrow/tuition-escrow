---
status: draft
last-reviewed: 2026-10-27
---

# Runbook: School Payout Address Change

## Overview

When a school needs to change its Stellar payout address (e.g., key rotation,
migration to a new account), the change must be verified before it takes effect.

---

## Why this matters

A malicious or erroneous payout address change would redirect Released voucher
funds to the wrong account. The change therefore resets verification status
to `pending` and requires re-verification before new vouchers can be funded.

---

## Procedure

1. **School submits a change request** via the platform admin dashboard or
   support channel, providing:
   - New Stellar address
   - Proof of ownership (e.g., a signed message from the new keypair)
   - Supporting documentation (e.g., school letterhead, authorized signatory)

2. **Platform admin verifies** off-chain proof of ownership.

3. **Platform admin updates the address** via `PATCH /schools/:id`:
   ```bash
   curl -X PATCH https://api.example.com/schools/<SCHOOL_ID> \
     -H "Authorization: Bearer <ADMIN_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"stellarAddress": "<NEW_ADDRESS>"}'
   ```
   This sets `verification_status = 'pending'`. No new vouchers can be
   funded to this school until re-verified.

4. **Platform admin re-verifies** the school address. In this sprint,
   re-verification is a manual admin action. Set status to `active`:
   ```sql
   UPDATE schools
   SET verification_status = 'active', updated_at = now()
   WHERE id = '<SCHOOL_ID>';
   ```

5. **Update the on-chain school registration** if the school's Stellar address
   is stored in the contract's school record:
   ```bash
   stellar contract invoke \
     --id <VOUCHER_CONTRACT_ID> \
     --source admin \
     --network testnet \
     -- register_school \
       --school <NEW_ADDRESS> \
       --attesters '[<ATTESTER_1>, <ATTESTER_2>]' \
       --threshold 2
   ```

6. **Notify the school** that the change is active.

---

## Note on in-flight vouchers

Vouchers funded to the old school address will still release to the old address
(the contract stores the school address at fund time). The old address must
remain operational until all in-flight vouchers are resolved.
