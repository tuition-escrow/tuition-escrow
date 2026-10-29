# Contributing to Tuition Escrow

Thank you for your interest in contributing to Tuition Escrow! We welcome contributions to help make school fee remittances transparent, purpose-bound, and secure.

---

## 1. Getting Started & Local Setup

### Prerequisites

- **Rust** (stable) with `wasm32-unknown-unknown` target:
  ```bash
  rustup update stable
  rustup target add wasm32-unknown-unknown
  ```
- **Stellar CLI**:
  ```bash
  cargo install --locked stellar-cli
  ```
- **Node.js** (20+) and **pnpm** (8.15+ or 9+):
  ```bash
  corepack enable
  corepack prepare pnpm@8.15.0 --activate
  ```
- **Docker** and Docker Compose (for Postgres and Redis dependencies).

### Installation & Verification

1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/<your-org>/tuition-escrow.git
   cd tuition-escrow
   pnpm install
   ```
2. Verify all local checks pass:
   ```bash
   cargo fmt --check
   cargo clippy -- -D warnings
   cargo test
   pnpm lint
   pnpm test
   pnpm build
   ```

---

## 2. Development Workflow

We follow a **trunk-based development workflow** with short-lived feature branches:

1. Open an issue to discuss significant changes before starting work.
2. Create a branch off `main` with a descriptive name (e.g., `feat/sponsor-service` or `fix/reclaim-boundary`).
3. Commit using **Conventional Commits** (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
4. Run formatting, linting, and tests before pushing.
5. Submit a Pull Request targeting `main`.

---

## 3. Two-Approval Rule for Sensitive Areas

Changes touching sensitive security or financial code require heightened scrutiny and **must receive two independent approvals** before merging:

- **Smart contracts** (`contracts/`)
- **Attester signing service & verification logic** (`apps/attester/`)
- **KMS / HSM key handling adapters & salt encryption** (`apps/api/src/kms/`, `apps/attester/src/signer.ts`)
- **Authentication & role boundary middleware** (`apps/api/src/middleware/`)

---

## 4. Contract-Change Checklist

Any modification to a public smart contract function, type, error code, or event requires the following in the **same pull request**:

- [ ] Contract unit tests updated and passing in `contracts/voucher/src/test.rs`.
- [ ] Contract integration tests updated and passing in `contracts/integration/src/lib.rs`.
- [ ] TypeScript contract bindings regenerated (`pnpm contract:bindings` or `./scripts/generate-bindings.sh`).
- [ ] Shared enums and type definitions updated in `packages/shared/src/`.
- [ ] Corresponding section updated in `README.md` or `docs/`.

---

## 5. Pull Request Checklist

Every PR must meet the following criteria before merge:

- [ ] **Tests with the feature:** Unit and integration tests added or updated.
- [ ] **No personal data on-chain:** Strict compliance with privacy rules; only `student_ref` (salted hash) and coarse category codes touch the ledger.
- [ ] **Quality gates clean:**
  - `cargo fmt --check`
  - `cargo clippy -- -D warnings`
  - `cargo test`
  - `pnpm lint`
  - `pnpm test`
  - `pnpm build`
- [ ] **Documentation updated:** Relevant README or `docs/` sections updated if behaviour or interfaces change.

---

## 6. Code of Conduct

Please note that this project is released with a Contributor Code of Conduct. By participating in this project you agree to abide by its terms. See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
