---
status: production-ready
last-reviewed: 2026-10-27
---

# Runbook: Reconciliation

## Purpose

Compare (1) the voucher contract's on-chain token balance, (2) the sum of
Funded vouchers in the database, and (3) the sum of Funded vouchers read
directly from the chain via `get_voucher`.  Any discrepancy triggers an
alert and requires immediate investigation.

The reconciliation script is `scripts/reconcile.ts`.  Run it daily via a
cron job or a scheduled BullMQ task.

---

## Running manually

```bash
DATABASE_URL="..." \
STELLAR_NETWORK=testnet \
STELLAR_RPC_URL="https://soroban-testnet.stellar.org" \
STELLAR_HORIZON_URL="https://horizon-testnet.stellar.org" \
VOUCHER_CONTRACT_ID="..." \
ASSET_CONTRACT_ID="..." \
  ts-node scripts/reconcile.ts
```

Exit code `0` means all three sources match.  Exit code `1` means a
mismatch or a fatal error; the report is printed to stdout.

---

## Interpreting results

| Mismatch | Likely cause | Action |
|---|---|---|
| Contract balance ≠ DB sum | Indexer is behind; events not yet applied | Wait for indexer catch-up; re-run |
| Contract balance ≠ DB sum (persists) | Indexer gap or bug; manual DB write | Run gap recovery (`recoverGap()`); investigate handler logic |
| DB sum ≠ on-chain sum | DB row is in wrong status | Compare individual vouchers; reset from chain state |
| All three differ | Multiple issues | Page on-call; freeze new fundings pending investigation |

---

## Escalation

1. Any mismatch → create an incident in the on-call rotation.
2. If `contractBalance > dbFundedSum + terminalSum`: funds may have entered
   the contract without being indexed.  Investigate the indexer.
3. If `contractBalance < dbFundedSum`: funds have left the contract without
   being indexed as Released/Reclaimed/Cancelled.  This is a critical
   inconsistency.  Halt new fundings and audit the contract directly.

---

## Stubs to implement before production

- `fetchContractTokenBalance()` — replace stub with SAC `balance()` call
  via `simulateTransaction`.
- `fetchOnChainFundedSum()` — replace stub with real `get_voucher` reads
  from `packages/contract-bindings`.

Both stubs are documented with `TODO` comments and references in
`scripts/reconcile.ts`.
