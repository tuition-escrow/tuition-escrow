# Quickstart: First 30 Minutes from a Clean Clone

This guide walks through configuring, building, testing, and running the **Tuition Escrow** stack from a fresh repository clone within 30 minutes.

---

> [!CAUTION]
> **Known Limitations of v0.1.0-alpha:**
>
> 1. **Unaudited Code:** This software has not completed an independent third-party security audit. Do not use with real funds.
> 2. **Testnet Only:** Designed and configured exclusively for Stellar Testnet and local development networks.
> 3. **No Fiat Anchor Integration:** SEP-24 / SEP-31 on-ramp and off-ramp rails are scheduled for the Phase 2 Pilot and are currently stubbed.

---

## Prerequisites (Estimated time: 5 minutes)

Ensure your development machine has the following installed:

- **Node.js** (v20+) and **pnpm** (v8.15+ or v9+):
  ```bash
  corepack enable
  corepack prepare pnpm@8.15.0 --activate
  ```
- **Rust** (stable toolchain) with the `wasm32-unknown-unknown` compilation target:
  ```bash
  rustup update stable
  rustup target add wasm32-unknown-unknown
  ```
- **Stellar CLI**:
  ```bash
  cargo install --locked stellar-cli
  stellar --version
  ```
- **Docker** and Docker Compose (for PostgreSQL and Redis).

---

## Step 1: Clone and Install (Estimated time: 3 minutes)

Clone the repository and install all workspace dependencies:

```bash
git clone https://github.com/cyberdocs120/tuition-escrow.git
cd tuition-escrow
pnpm install
```

Verify that formatting and linters pass cleanly:

```bash
cargo fmt --check
pnpm lint
```

---

## Step 2: Build and Test Smart Contracts (Estimated time: 5 minutes)

1. Run the comprehensive unit and invariant property test suites:

   ```bash
   cargo test
   ```

   _Expected outcome:_ 43 voucher tests and 11 integration tests pass with 0 failures.

2. Compile the Soroban contract to optimized WebAssembly:

   ```bash
   cargo build --target wasm32-unknown-unknown --release -p voucher
   ```

3. Verify the generated WASM hash matches `deployments/testnet.json`:
   ```bash
   sha256sum target/wasm32-unknown-unknown/release/voucher.wasm
   # Expected: 78a70104597658b044477467fca880de322781a257a5116e9caa3250949b682b
   ```

---

## Step 3: Local Services Setup (Estimated time: 4 minutes)

1. Start Postgres and Redis containers:

   ```bash
   docker compose -f infra/docker/docker-compose.yml up -d
   ```

2. Initialize your local environment file:

   ```bash
   cp .env.example .env
   ```

3. Run database migrations:
   ```bash
   pnpm db:migrate
   ```

---

## Step 4: Verify Testnet Deployment Artifacts (Estimated time: 3 minutes)

The repository comes pre-configured with canonical testnet deployment records in `deployments/testnet.json`:

- **Voucher Contract ID:** `CAESCW4K257N6WNJLMYXWZX7H77S4M6H35437C77E2A2H3K6VOUCHER1`
- **Asset SAC Contract ID:** `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`
- **Initial Deploy Ledger:** `1024500`

If deploying your own contract instance:

```bash
scripts/create-identities.sh
source .env && ./scripts/deploy-testnet.sh
```

---

## Step 5: Start the Full Local Stack (Estimated time: 5 minutes)

Launch all microservices and web applications simultaneously using Turborepo:

```bash
pnpm dev
```

This starts:

- **Web App (PWA):** `http://localhost:3000`
- **API Backend:** `http://localhost:4000`
- **Indexer Service:** Polling Soroban RPC with Prometheus metrics on port `9101`
- **Attester Signing Daemon:** Port `3001` with KMS key abstraction and SHA-256 audit log

---

## Step 6: Run End-to-End Test Suite (Estimated time: 5 minutes)

Execute the end-to-end Playwright tests covering all 6 README scenarios:

```bash
pnpm test:e2e
```

**Scenario Matrix Verified:**

1. Happy path: fund → threshold attestations → release to school.
2. Expiry path: fund → no attestation → expiry → funder reclaim.
3. Cancel path: fund → funder/school cancel → refund.
4. Security attacks: unauthorized confirm, double attestation, early reclaim, release diversion.
5. Indexer recovery: mid-flow restart with transactional cursor convergence.
6. Privacy scan: zero on-chain student identifiers, salts, or unhashed records.

---

## Next Steps

- Consult [docs/architecture.md](./architecture.md) for data flows and trust boundaries.
- Read [docs/attester-playbook.md](./attester-playbook.md) for operational key handling procedures.
- Refer to [CONTRIBUTING.md](../CONTRIBUTING.md) to submit patches or join the development effort.
