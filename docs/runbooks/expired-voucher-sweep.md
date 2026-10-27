---
status: draft
last-reviewed: 2026-10-27
---

# Runbook: Expired-Voucher Sweep and Reclaim Assistance

## Overview

After a voucher expires (ledger timestamp ≥ `expires_at`) without attestation,
the funder may call `reclaim()`. This runbook covers monitoring and assisting
funders with reclaims.

---

## Monitoring

- `VouchersNearingExpiryUnconfirmed` alert fires 24 hours before expiry.
- Check the expiry-reminders job logs for confirmation that funder notifications
  were sent.

---

## After expiry

1. **Funder self-service**: the web UI shows a "Reclaim" button for expired
   Funded vouchers. The funder connects their wallet and clicks it.

2. **Assisted reclaim** (if funder cannot access the UI):
   ```bash
   stellar contract invoke \
     --id <VOUCHER_CONTRACT_ID> \
     --source <FUNDER_KEY> \
     --network testnet \
     -- reclaim --voucher_id <ID>
   ```

3. **Verify** the indexer has picked up the `reclaimed` event:
   ```sql
   SELECT status FROM vouchers WHERE voucher_id = <ID>;
   -- Should be 'Reclaimed'
   ```

---

## If TTL archival has occurred

If the Soroban storage entry was archived (TTL expired), the entry must be
restored before `reclaim()` can be called. This requires a `restoreFootprint`
operation. See Stellar documentation:
https://developers.stellar.org/docs/build/smart-contracts/storage/restore

After restoration, the funder can call `reclaim()` normally.

---

## Bulk sweep (operator-initiated)

For funders who have not reclaimed after 90 days past expiry, consider
sending a follow-up notification and providing direct support. Do not call
`reclaim()` on behalf of a funder without their explicit authorization.
