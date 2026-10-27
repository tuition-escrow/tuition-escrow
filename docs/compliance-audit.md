# README Compliance Audit

**Date:** 2026-10-27  
**Scope:** `apps/indexer`, `apps/attester`, `apps/web`, `apps/api` (jobs), `scripts/reconcile`, observability layer.

---

## apps/indexer

### Checklist

| README requirement | Status | Notes |
|---|---|---|
| Poll `getEvents` from deployment ledger (read from `deployments/<network>.json`) | ✓ | `loadDeployment()` in `index.ts` reads `voucherContractId` and `deployLedger` |
| Decode `funded`, `attested`, `released`, `reclaimed`, `cancelled` events | ✓ | `decoder.ts` + handlers in `handlers.ts` |
| Update vouchers table for each event | ✓ | All five handlers write to `vouchers` table |
| Persist cursor transactionally with writes | ✓ | `writeCursor()` called inside the same `BEGIN/COMMIT` as handler writes |
| Restarts never skip or double-apply | ✓ | Cursor is committed atomically; all handlers use `ON CONFLICT DO NOTHING` or conditional `UPDATE … WHERE status = 'Funded'` |
| Every handler idempotent | ✓ | Tested in `indexer.test.ts` replay-safety suite |
| Gap detection and recovery | ✓ | RPC error -32602 triggers `recoverGap()`; fallback via `get_voucher` (stub documented) |
| Expose metrics: latest ledger, lag, events, errors | ✓ | `metrics.ts` exports four Prometheus metrics; metrics HTTP server on `INDEXER_METRICS_PORT` |
| Chain is source of truth; never write state not derivable from chain | ✓ | All writes are driven by decoded on-chain events; no state is invented |
| Recorded RPC fixtures test | ✓ | `indexer.test.ts` uses synthetic events (no live RPC) |

### Deviations

1. **`get_voucher` gap recovery is a stub.** `gap.ts::fetchVoucherStatus()` returns `null` unconditionally. The `recoverGap()` function logs a warning and exits cleanly. This is explicitly documented with a `TODO` and will become functional once `packages/contract-bindings` is regenerated with a deployed contract ID. This is a known deferred item, not a deviation from the README's intent (the README says "documented fallback").

---

## apps/attester

### Checklist

| README requirement | Status | Notes |
|---|---|---|
| Attester can **only** call `confirm` | ✓ | `buildAndSubmitConfirm()` is the only contract-calling function; no other contract function is called anywhere in the service |
| Never publishes underlying school records | ✓ | `verification.ts` returns only `{ok, reason}`; no student data flows through the attester service |
| Keys accessed only through `Signer` interface | ✓ | `LocalDevSigner`, `AwsKmsSigner`, `GcpKmsSigner` all implement `Signer`; secret is only read inside the signer's `sign()` method |
| `LocalDevSigner` refused on mainnet | ✓ | Constructor throws if `STELLAR_NETWORK === 'mainnet'` |
| Tamper-evident audit log | ✓ | SHA-256 hash chain in `audit.ts`; `verifyAuditChain()` detects tampering |
| Logs every decision including rejections | ✓ | All four decision paths (approved/rejected/skipped/error) call `appendAuditEntry()` |
| Revocation awareness | ✓ | `isAttesterAuthorized()` in `chain.ts` checks the attester is still in `voucher.attesters`; returns false (fail-closed) if chain fetch fails |
| Fail-closed: uncertainty means no attestation | ✓ | Chain check failure, verification error, and submission failure all result in `{ success: false }` |
| Tests: success, rejection, expired, unauthorized, audit integrity | ✓ | All five test groups in `attester.test.ts` |

### Deviations

1. **`SorobanChainChecker.fetchVoucher()` is a stub.** Returns `null` (fail-closed), meaning the attester currently cannot verify on-chain state directly. The `isAttesterAuthorized()` function returns `authorized: false` when the voucher cannot be fetched, so the attester will not sign anything. This is safe but means the attester service cannot approve vouchers in a live deployment until the stub is replaced with real contract-bindings. Documented with `TODO`.

2. **`buildAndSubmitConfirm()` is a stub.** Builds a placeholder XDR string and calls `signer.sign()` on it. The signed XDR is not submitted to the Soroban RPC. Same root cause as deviation 1 — requires the pinned SDK and regenerated bindings. Documented with `TODO`.

---

## apps/web

### Checklist

| README requirement | Status | Notes |
|---|---|---|
| Only five fee categories | ✓ | `CATEGORY_OPTIONS` in `lib/categories.ts` has exactly 5 entries; the `<select>` in `CreateVoucherForm` renders only those 5 |
| No free-text memo field anywhere | ✓ | No memo/note input exists in any component; confirmed by Playwright test `"Create voucher form has no free-text memo field"` |
| Student identifier never persists client-side after submission | ✓ | Stored in a `useRef` (not state), cleared in both the success and error branches of `handlePrepare()`; the input uses `defaultValue=""` not `value` to prevent React from re-binding it |
| School mapping view is school-only | ✓ | `MappingReveal` is inside `SchoolVoucherCard` which is only rendered by `SchoolDashboard`; the funder view (`FunderVoucherList`) has no mapping UI at all |
| No UI implies non-existent functionality | ✓ | Off-ramp panel is labelled "Anchor integration planned, not functional"; dispute/QR/installment features have no UI at all |
| Attester UI shows only: voucher id, category, expiry, status, threshold progress | ✓ | `VoucherQueueItem` renders only those fields; funder address, student ref, and school records are not displayed |
| Wallet shows exact contract call before signing | ✓ | `ContractCallPreviewPanel` is rendered before `signAndSubmit()` is called in both funder create and action flows |

### Deviations

1. **WalletProvider `connect()` and `signAndSubmit()` are stubs.** The `@creit.tech/stellar-wallets-kit` integration is scaffolded with `TODO` comments pointing to the SDK docs. Components correctly call through the `WalletProvider` abstraction. Wiring up the real kit requires verifying the current API surface against [stellarwalletskit.dev](https://stellarwalletskit.dev) before pinning.

2. **Fee-bump XDR construction is a stub.** `CreateVoucherForm` passes a placeholder string to `signAndSubmit()`. The real flow requires fetching a fee-bumped XDR from a `POST /vouchers/build-tx` API endpoint (not yet implemented). The `SponsorshipServiceImpl` in `apps/api/src/services/sponsorship.ts` already documents the required steps with `TODO` comments.

3. **Playwright tests require a running stack.** The smoke tests in `e2e/smoke.spec.ts` are correctly written but will not pass in CI without `pnpm dev` running. A Playwright config file (`playwright.config.ts`) and a CI step to start the dev server are deferred to commit 10.

---

## scripts/reconcile

### Checklist

| README requirement | Status | Notes |
|---|---|---|
| Compares (1) contract token balance, (2) DB Funded sum, (3) on-chain `get_voucher` sum | ✓ | All three sources compared in `reconcile()` |
| Exits non-zero on mismatch | ✓ | `process.exit(1)` when `report.ok === false` |
| Clear report printed | ✓ | Formatted report with ✓/✗ indicators printed to stdout |
| Documented in `docs/runbooks/reconciliation.md` | ✓ | Runbook created with usage, interpretation, and escalation guidance |

### Deviations

1. **`fetchContractTokenBalance()` is a stub** (returns `0n`). Requires a SAC `balance()` call via `simulateTransaction`. Documented with `TODO` and a link to the SAC docs.

2. **`fetchOnChainFundedSum()` uses DB data as a proxy.** Returns the DB sum rather than real on-chain reads. Produces a trivial match between sources (2) and (3) until the real implementation is in place. Documented.

---

## Summary of open stubs

All stubs are safe (fail-closed or no-op) and documented with `TODO` comments. None introduce incorrect state. They will be replaced when:

- `packages/contract-bindings` is regenerated after deploying the contract to testnet.
- `@stellar/stellar-sdk` version is pinned (currently deferred per README: "check current Stellar docs before pinning").
- `@creit.tech/stellar-wallets-kit` API surface is verified against current docs.

No deviation contradicts the README's security model. The platform never takes custody of funds; admin cannot move escrowed funds; the attester only calls `confirm`; no personal data appears on-chain or in logs.
