# Threat Model

**Source of truth:** README.md § Security model  
**Last updated:** 2026-10-26  
**Status:** Pre-alpha — no audit completed. See README § Security.

This document expands each threat from the README security table with:
assets at risk, attacker capability, existing code mitigation (with file
references), residual risk, and the test(s) covering it.

Threats marked **"proposed addition"** are not in the README security table;
they are flagged separately and must not be acted on without a README update.

---

## 1. Attester colludes with school to falsely confirm

| Field | Detail |
|---|---|
| **Assets at risk** | Escrowed tokens for the target voucher |
| **Attacker capability** | Attester key holder and school act together; school receives released funds even though the condition (e.g., enrollment) was not met |
| **Existing mitigation in code** | M-of-N threshold enforced in `confirm()` — `contracts/voucher/src/lib.rs`. Default `register_school` call in `scripts/deploy-testnet.sh` uses threshold=1 for the demo only; production README recommends 2-of-3 with an independent verifier. `confirmed_by` vec prevents one attester from satisfying multiple threshold slots. |
| **Residual risk** | High if only school self-attests (threshold=1). Risk decreases with independent attesters. No slashing or staking yet (Phase 3). |
| **Tests** | `test::test_happy_path_fund_confirm_release` (positive), `test::test_duplicate_attestation_rejected` (regression: single attester cannot count twice), `test::prop_no_duplicate_attestation_counts` |

---

## 2. Attester key theft

| Field | Detail |
|---|---|
| **Assets at risk** | All vouchers where the stolen key is an attester with sufficient threshold to act alone |
| **Attacker capability** | Attacker acquires attester signing key (env file, CI secret, memory scrape) and submits `confirm` transactions |
| **Existing mitigation in code** | `apps/attester/` (stub) — KMS-backed signing architecture described in README. Key is referenced by `ATTESTER_KMS_KEY_ID`, never embedded. Admin can call `register_school` with an updated attester set to remove a compromised key; new vouchers will use the new set. |
| **Residual risk** | Vouchers already attested (but not yet at threshold) are unaffected if the stolen key provided only one signature. Vouchers where the key could complete the threshold alone are at risk until the admin updates the attester set. Existing released vouchers cannot be reversed. |
| **Tests** | `test::test_attester_from_different_school_rejected` (key from wrong school is rejected), `test::test_unknown_attester_rejected` |

---

## 3. Funder reclaims after service was delivered

| Field | Detail |
|---|---|
| **Assets at risk** | School's earned payment |
| **Attacker capability** | Funder calls `reclaim` after the school has provided the service but before the attester has submitted `confirm` |
| **Existing mitigation in code** | `reclaim` is gated on `ledger_timestamp >= expires_at` — `contracts/voucher/src/lib.rs`. The expiry window is set by the funder at fund time but capped by `max_expiry_hours` from config. `confirm` succeeds until the last second before expiry (`< expires_at`). |
| **Residual risk** | If the attester is slow and misses the window, the funder can reclaim. Operational mitigation: configure a realistic expiry (e.g., 30 days past term start) and monitor for approaching-expiry vouchers (README § Operations). |
| **Tests** | `test::test_expiry_boundary_confirm_fails_reclaim_succeeds`, `test::test_one_second_before_expiry`, `test::prop_reclaim_boundary_exhaustive` |

---

## 4. Contract bug drains escrow

| Field | Detail |
|---|---|
| **Assets at risk** | All escrowed tokens across all open vouchers |
| **Attacker capability** | Exploits a logic error (e.g., re-entrancy, integer overflow, double-release) to move tokens to an arbitrary address |
| **Existing mitigation in code** | Status checked before every transfer — `contracts/voucher/src/lib.rs`. Rust overflow-checks enabled in release profile (`Cargo.toml`, `overflow-checks = true`). Checked arithmetic used for expiry calculation (`checked_add`, `checked_mul`). Minimal contract surface: no arbitrary-value transfer, no upgrade path in this version. |
| **Residual risk** | No external audit yet (required before mainnet — README § Deployment checklist). Per-voucher and aggregate funding caps (`min_amount`, `max_amount`) limit blast radius. |
| **Tests** | `test::test_double_release_impossible`, `test::test_double_reclaim_impossible`, `test::test_double_cancel_impossible`, `test::prop_at_most_one_terminal_transition`, `test::prop_funds_conservation_exhaustive`, `test::test_i128_min_rejected`, `test::prop_invalid_amounts_rejected` |

---

## 5. Admin key abuse

| Field | Detail |
|---|---|
| **Assets at risk** | All future vouchers (via attester set manipulation), contract config |
| **Attacker capability** | Admin private key compromised; attacker calls `register_school` to inject a malicious attester, or calls `initialize` with permissive limits |
| **Existing mitigation in code** | Admin cannot move escrowed funds — there is no admin function that calls `token.transfer` to an arbitrary address. `initialize` can only be called once (`storage::get_config` guard). `register_school` only affects new vouchers; existing vouchers carry their own attester snapshot (`Voucher.attesters`). |
| **Residual risk** | A compromised admin could register a school with a malicious attester, enabling future fraudulent releases. Multi-sig admin key is a production requirement (README § Deployment checklist). |
| **Tests** | `test::test_double_initialize_rejected`, `test_unauthorized_register_school` pattern in test.rs |

---

## 6. Replay or double release

| Field | Detail |
|---|---|
| **Assets at risk** | Tokens in a specific voucher |
| **Attacker capability** | Replays a previously valid `confirm` transaction, or finds a path to move funds twice |
| **Existing mitigation in code** | `Voucher.status` is checked at the start of every state-changing function and transitions are one-way. `confirmed_by` vec prevents the same attester address from counting twice — `contracts/voucher/src/lib.rs`. Soroban's sequence-number model prevents transaction replay at the network level. |
| **Residual risk** | Low; enforced in contract logic. |
| **Tests** | `test::test_double_release_impossible`, `test::test_duplicate_attestation_rejected`, `test::prop_at_most_one_terminal_transition` |

---

## 7. Fake school registration

| Field | Detail |
|---|---|
| **Assets at risk** | Funds released to a fraudulent school address |
| **Attacker capability** | Attacker convinces admin to register a fake school address (social engineering, impersonation) |
| **Existing mitigation in code** | Admin-only `register_school` — `contracts/voucher/src/lib.rs`. Off-chain: verified onboarding documented in README § Attester model. `active` flag allows deactivating a school. |
| **Residual risk** | Entirely depends on the off-chain onboarding and admin key security. No on-chain legal-entity verification is possible. |
| **Tests** | `test::test_fund_unregistered_school` (negative: unregistered schools are rejected by `fund`) |

---

## 8. Phishing or fake front-ends

| Field | Detail |
|---|---|
| **Assets at risk** | Funder's tokens (directed to a different contract) |
| **Attacker capability** | Hosts a fake web UI pointing at a different contract ID; funder signs a transaction believing it is for the legitimate contract |
| **Existing mitigation in code** | Contract ID is pinned in `deployments/testnet.json` and surfaced via `NEXT_PUBLIC_CONTRACT_ID`. Wallet (Freighter / LOBSTR) shows the exact contract address being called for user confirmation. |
| **Residual risk** | UX mitigation only; users must verify the contract ID. Published contract IDs (README § Deployment checklist) help. |
| **Tests** | No automated test covers phishing (UX concern). Integration test verifies correct contract ID is used end-to-end. |

---

## 9. Student re-identification

| Field | Detail |
|---|---|
| **Assets at risk** | Student privacy (sensitive personal data) |
| **Attacker capability** | On-chain observer correlates `student_ref` across vouchers to infer the student's identity or attendance pattern |
| **Existing mitigation in code** | Per-voucher random salt: `packages/shared/src/student-ref.ts` (`generateSalt()`). `student_ref = SHA-256(salt || identifier)` — different salt per voucher means the same student produces different `student_ref` values. No names, DOBs, or free-text on-chain (`contracts/voucher/src/types.rs`). |
| **Residual risk** | Timing and amount patterns can still correlate vouchers for small schools. Amount bucketing is a Phase 3 mitigation. The salt is currently generated client-side in the shared package — apps/api will generate it server-side with KMS-wrapped storage (see commit 6). |
| **Tests** | `packages/shared/src/__tests__/student-ref.test.ts` covers salt generation and hash computation |

---

## 10. Indexer or API compromise

| Field | Detail |
|---|---|
| **Assets at risk** | Data confidentiality; no fund movement possible |
| **Attacker capability** | Attacker gains write access to the API/indexer Postgres database or the API process |
| **Existing mitigation in code** | The on-chain contract is the source of truth for fund movements; the API holds no signing keys capable of moving escrowed funds. Student mappings are envelope-encrypted (`apps/api/src/kms/`, commit 6). Audit log is append-only. |
| **Residual risk** | A compromised API could leak encrypted student mappings; decryption requires KMS access. Data classification: high. Encryption key rotation and access logging are required before production. |
| **Tests** | Authorization boundary tests in `apps/api/src/__tests__/` (commit 6) |

---

## 11. Dependency compromise

| Field | Detail |
|---|---|
| **Assets at risk** | Any — supply-chain attack could introduce backdoors |
| **Attacker capability** | Malicious package published to crates.io or npm, or existing package compromised |
| **Existing mitigation in code** | Lockfiles committed (`Cargo.lock`, `pnpm-lock.yaml`). CI runs `cargo audit` and `pnpm audit` (`.github/workflows/ci.yml`). `ed25519-dalek` pinned to exact version `2.2.0` in `Cargo.toml` workspace deps. |
| **Residual risk** | Lockfile pinning prevents accidental upgrades but not a compromise of an already-locked version. Periodic audit runs and Dependabot (if enabled) mitigate this. |
| **Tests** | CI security job in `.github/workflows/ci.yml` (audit steps) |

---

## Proposed additions (not in README — flagged, not implemented)

These are potential threats identified during this analysis that fall outside
the current README scope. They are listed here for discussion; any mitigation
requires a README update first per the project's hard constraints.

| Threat | Note |
|---|---|
| Fee-sponsor account drained | If the sponsor's XLM balance falls below threshold, all funded transactions fail. README mentions a balance-threshold alert (§ Operations) but the threat is not in the security table. |
| Anchor failure / depeg | Stablecoin issuer suspends redemptions or the peg breaks. README § Legal notes this as issuer/depeg risk but it is not in the security threat table. |
| Ledger timestamp manipulation | A rogue validator could submit a crafted timestamp to force expiry early or late. Soroban uses the ledger close time which requires quorum; individual validator manipulation is not feasible on a healthy network. |
