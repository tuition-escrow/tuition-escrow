## Description

<!-- Provide a concise summary of the changes and motivation. -->

## Related Issues / Roadmap Reference

- Resolves #
- **README.md Section / ADR Reference**: <!-- e.g., README.md Section 7, ADR 0005 -->

---

## Anti-Drift & Scope Checklist

- [ ] **README Alignment:** This change strictly implements or refines behavior described in `README.md` or an approved ADR without unauthorized scope creep.
- [ ] **No Personal Data On-Chain:** Verified that no student names, grades, IDs, raw salts, or PII touch smart contract storage, events, or public APIs.
- [ ] **Non-Custodial Invariants Preserved:** Platform does not hold user or school custody; fail-closed refund rules are preserved.
- [ ] **Tests Added / Updated:**
  - [ ] Rust contract unit/integration tests (`cargo test`)
  - [ ] TypeScript package unit/integration tests (`pnpm test`)
  - [ ] E2E scenario regression tests (`pnpm test:e2e`) if user flows are touched.
- [ ] **Documentation Updated:** `README.md`, `docs/architecture.md`, or relevant ADRs updated to reflect modifications.

---

## Sensitive Area Review (Two-Approval Rule)

Does this PR touch any of the following sensitive subsystems?

- [ ] Smart Contracts (`contracts/`)
- [ ] Attester Service & Signing Logic (`apps/attester/`)
- [ ] Cryptographic Key Management & Salt Generation (`apps/api/src/kms/`, `apps/attester/src/signer.ts`)
- [ ] Authentication & Role Boundary Middleware (`apps/api/src/middleware/`)

> [!IMPORTANT]
> If any box above is checked, this PR **requires two independent approvals** before merge. Contract changes also require regenerated TypeScript bindings and updated integration suites.

---

## Verification Commands Run

```bash
cargo fmt --check
cargo clippy -- -D warnings
cargo test
pnpm lint
pnpm test
pnpm build
```
