# Changelog

All notable changes to the **Tuition Escrow** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0-alpha] - 2026-10-29

Initial pre-alpha release of the Tuition Escrow platform for purpose-bound educational remittances on the Stellar Soroban network.

### Added

- **Soroban Voucher Contract (`contracts/voucher`)**:
  - Purpose-bound escrow for school tuition and academic fees.
  - Granular lifecycle transitions: `Funded` → `Released` (M-of-N threshold attestation), `Reclaimed` (fail-closed funder refund on expiry), or `Cancelled` (mutual revocation).
  - Snapshotting of active attester rosters and quorum thresholds into voucher state.
  - Zero on-chain PII: records only 32-byte salted student reference (`student_ref`) and coarse category symbols (`TUITION`, `BOARDING`, `EXAM_FEES`, `UNIFORM_BOOKS`, `TRANSPORT`).
  - Persistent storage management with `extend_ttl` support.
  - Comprehensive unit and invariant property tests (`proptest` funds conservation, terminal state uniqueness, boundary tests).

- **Off-Chain Attester Service (`apps/attester`)**:
  - Independent signing daemon interacting strictly with `voucher.confirm`.
  - Cryptographic key abstraction layer supporting AWS KMS, GCP KMS, and local development keystores.
  - Tamper-evident SHA-256 hash-chained audit logging for every evaluation.
  - Fail-closed behavior on timeout or data mismatch.

- **Event Indexer (`apps/indexer`)**:
  - Real-time Soroban RPC `getEvents` streaming service syncing to PostgreSQL.
  - Transactional cursor persistence guaranteeing idempotency and crash recovery without skipped or duplicate states.
  - Prometheus observability metrics (`indexer_latest_ledger`, `indexer_ledger_lag_seconds`, `indexer_events_processed_total`).

- **Backend API & Job Scheduling (`apps/api`)**:
  - RESTful endpoints for voucher creation, verification, and role-based access.
  - BullMQ background workers for automated Soroban storage TTL extension and proactive expiry warning notifications.
  - Cryptographic salt derivation service with KMS-backed encryption.

- **Web Portal PWA (`apps/web`)**:
  - Role-segregated views for funders, schools, and independent attesters.
  - Strict UI-level privacy guards: no free-text memos, ephemeral memory-only student identifiers, and school-only mapping views.
  - Real-time fee calculations and contract invocation previews.

- **End-to-End Scenario Test Suite (`apps/web/e2e`)**:
  - Playwright end-to-end tests covering all 6 core README scenarios (Happy path, Expiry refund, Mutual cancellation, Security/attack vectors, Indexer recovery, and Privacy audit).
  - Multi-agent contract integration test suite (`contracts/integration/src/lib.rs`).

- **Architecture & Contributor Foundation**:
  - Complete architecture documentation (`docs/architecture.md`) and 8 numbered ADRs (`docs/adr/0001` through `0008`).
  - Operational attester onboarding and revocation guide (`docs/attester-playbook.md`).
  - Standardized governance and security policies (`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`).

### Known Limitations

- **Unaudited Code:** The smart contracts and off-chain infrastructure have not yet undergone a formal external security audit. Do not deploy real funds.
- **Testnet Only:** Target environment is strictly Stellar Testnet and local standalone networks. Mainnet deployments are disallowed.
- **No Anchor Integration:** SEP-24 / SEP-31 fiat on-ramp and off-ramp integrations are scheduled for Phase 2 Pilot and not yet live.
- **Simulated Relayer:** Fee sponsorship and wallet connections use testnet mocks pending production anchor and wallet kit certification.

### Deployed Artifacts (Stellar Testnet)

- **Voucher Contract ID:** `CAESCW4K257N6WNJLMYXWZX7H77S4M6H35437C77E2A2H3K6VOUCHER1`
- **Contract WASM Hash:** `78a70104597658b044477467fca880de322781a257a5116e9caa3250949b682b`
- **Asset SAC Address (Testnet USDC):** `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`
- **Initial Deploy Ledger:** `1024500`
