---
status: draft
last-reviewed: 2026-10-27
---

# Runbook: Indexer Replay and Recovery from a Gap

## Overview

Covers recovery when the indexer has fallen behind the RPC event-retention
window, or when a gap in event history is detected.

---

## Detection

- `IndexerLagCritical` alert fires.
- Indexer logs show: `Gap detected: startLedger outside RPC retention window`.
- DB voucher statuses do not match what you see in a block explorer.

---

## Automatic recovery

The indexer detects the gap automatically when the RPC returns error `-32602`
for a `startLedger` that is too old. It then:

1. Calls `recoverGap()` which reads current state for all Funded vouchers via
   `get_voucher` (once the stub is replaced with real contract-bindings).
2. Advances the cursor to the current ledger tip.
3. Resumes normal polling from there.

---

## Manual recovery procedure

If automatic recovery fails or the `get_voucher` stub is not yet implemented:

1. **Identify affected vouchers**: query the DB for Funded vouchers whose
   `updated_at` is older than the gap window.

2. **Read on-chain state** for each:
   ```bash
   stellar contract invoke \
     --id <VOUCHER_CONTRACT_ID> \
     --source admin \
     --network testnet \
     -- get_voucher --id <VOUCHER_ID>
   ```

3. **Manually update DB status** if the chain shows a terminal state:
   ```sql
   UPDATE vouchers SET status = '<Released|Reclaimed|Cancelled>',
     updated_at = now()
   WHERE voucher_id = <ID> AND status = 'Funded';
   ```

4. **Reset cursor** to the current ledger so the indexer resumes cleanly:
   ```sql
   UPDATE indexer_cursor
   SET last_ledger = <CURRENT_LEDGER>, last_event_id = NULL, updated_at = now()
   WHERE id = 'singleton';
   ```

5. Restart the indexer.

---

## Verification

Run `scripts/reconcile.ts` after recovery and confirm exit code 0.
