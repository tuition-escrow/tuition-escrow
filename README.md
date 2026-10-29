# Tuition Escrow

**Purpose-bound school-fee payments on Stellar.**

A funder (a parent, a relative abroad, a sponsor, a scholarship fund) locks money into an on-chain voucher for a **specific school** and a **specific fee category**. The money sits in escrow and is released to the school only when an **independent attester** confirms the condition was met (for example, that the student is enrolled for the term). If it never happens, the funder gets the money back.

The funder does not have to be the student's family. A relative sending money from abroad uses exactly the same path, which is the point: **a remittance that can only be spent on the education it was sent for.**

> No student personal information ever touches the ledger. Vouchers carry a coarse fee category and an opaque student reference, never a name, a grade, an ID number, or a disciplinary or medical record.

> **Status:** Early design / pre-alpha. Nothing in this repository has been audited. Do not use with real funds until a security audit and legal review are complete. See [Security](#security-model) and [Legal and regulatory notes](#legal-and-regulatory-notes).

---

## Project status

Tuition Escrow is currently at **v0.1.0-alpha** (Testnet Pre-Alpha).

### Current Completion (70.0% Weighted Roadmap Completion)

- **Phase 0: Foundations (100% complete):** Soroban voucher contracts with unit, boundary, and invariant property tests (`proptest`), TypeScript contract bindings, monorepo with pnpm workspaces and Turborepo, and CI pipeline.
- **Phase 1: Testnet MVP (100% complete):** Next.js PWA with role-segregated portals (funder, school, attester), REST API with BullMQ worker for TTL extensions, PostgreSQL event indexer with transactional replay protection, standalone KMS-backed attester service with SHA-256 tamper-evident audit logs, and comprehensive Playwright end-to-end tests covering all 6 core README scenarios.
- **Phase 2: Pilot (~40% complete):** $M$-of-$N$ threshold attestation logic (default 2-of-3) implemented and tested on local standalone and Stellar Testnet. (See [`Plan.md`](./Plan.md) for full arithmetic breakdown).

### Excluded from v0.1.0-alpha

The following components are intentionally excluded from this pre-alpha release:

- **Mainnet Deployments & Real Funds:** Code is unaudited. Strictly intended for Stellar Testnet and local development networks.
- **Fiat Anchor Rails:** Live SEP-24 / SEP-31 anchor integrations for on-ramps and off-ramps are scheduled for Phase 2 Pilot and currently stubbed.
- **Dispute & Staking Modules:** Tranches, milestone-based installment payouts, pooled scholarship DAOs, and attester economic staking/slashing are deferred to Phase 3 Expansion (see [`docs/ideas.md`](./docs/ideas.md)).

---

## Table of contents

0. [Project status](#project-status)
1. [Why this exists](#why-this-exists)
2. [Core concepts](#core-concepts)
3. [How it works](#how-it-works)
4. [System architecture](#system-architecture)
5. [Voucher lifecycle](#voucher-lifecycle)
6. [Smart contract specification](#smart-contract-specification)
7. [Privacy model](#privacy-model)
8. [Attester model](#attester-model)
9. [Tech stack](#tech-stack)
10. [Repository structure](#repository-structure)
11. [Getting started](#getting-started)
12. [Configuration](#configuration)
13. [Development workflow](#development-workflow)
14. [Testing strategy](#testing-strategy)
15. [Deployment](#deployment)
16. [Fiat on-ramps and off-ramps](#fiat-on-ramps-and-off-ramps)
17. [Operations and monitoring](#operations-and-monitoring)
18. [Security model](#security-model)
19. [Legal and regulatory notes](#legal-and-regulatory-notes)
20. [Roadmap](#roadmap)
21. [FAQ](#faq)
22. [Contributing](#contributing)
23. [License](#license)

---

## Why this exists

Families, diaspora members, and sponsors send large amounts of money to pay for schooling. Today that usually means one of the following:

- **Cash or bank transfers to the family.** The money may be spent on something else, which is a real concern for the sender and a source of friction and mistrust.
- **Direct payment to a school.** This is often slow, expensive, or impossible across borders, and the sender gets no proof the student was actually enrolled.
- **Informal channels.** These carry fraud risk, no audit trail, and no recourse.

Tuition Escrow offers a third path:

| Problem                                      | How this project addresses it                                      |
| -------------------------------------------- | ------------------------------------------------------------------ |
| Sender cannot control how money is spent     | Funds are locked to one school and one fee category                |
| Sender cannot verify the outcome             | Release requires an independent attestation, recorded on-chain     |
| Sender loses money if the plan falls through | Funds return to the sender after expiry                            |
| Cross-border fees are high and slow          | Stellar settles in seconds at a fraction of a cent per transaction |
| Student privacy                              | Only a category code and an opaque reference are stored on-chain   |

---

## Core concepts

| Term                  | Meaning                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Funder**            | The party that deposits money. May be a parent, relative, sponsor, employer, or charity. Need not be related to the student.            |
| **School (payee)**    | The institution that receives payment on successful attestation.                                                                        |
| **Attester**          | An independent party authorized to confirm that the voucher's condition has been met (e.g., enrollment, attendance, term start).        |
| **Voucher**           | An on-chain record of a single escrowed payment: funder, school, amount, category, student reference, attester set, expiry, and status. |
| **Fee category**      | A coarse code such as `TUITION`, `BOARDING`, `EXAM_FEES`, `UNIFORM_BOOKS`, `TRANSPORT`. Never anything more specific.                   |
| **Student reference** | An opaque identifier (a salted hash) that the school can map back to a student off-chain. Meaningless to anyone else.                   |
| **Escrow**            | The Soroban contract holding funds until release, reclaim, or cancellation.                                                             |
| **Expiry**            | A ledger-time deadline after which the funder may reclaim unreleased funds.                                                             |

---

## How it works

### Happy path

1. **Setup.** The school is onboarded and registered, with its payout address and its approved attester(s).
2. **Fund.** The funder selects a school, fee category, amount, and student reference, then signs a `fund` transaction. The contract pulls the tokens from the funder and creates the voucher with status `Funded`.
3. **Attest.** At the relevant point (e.g., term start), the attester verifies the condition against the school's records and signs a `confirm` transaction.
4. **Release.** The contract transfers the escrowed tokens to the school's address. Status becomes `Released`.
5. **Off-ramp.** The school withdraws to local currency through a Stellar anchor, or holds the stablecoin.

### Unhappy paths

- **Condition never met.** After expiry, the funder calls `reclaim` and the tokens return to them. Status becomes `Reclaimed`.
- **Plans change early.** Funder and school can jointly `cancel` before expiry. Status becomes `Cancelled`.
- **Disagreement.** Either the funder or the school can raise a `dispute` (optional module) which freezes the voucher until an arbiter resolves it.

### Example

> Amara lives in Manchester. Her younger brother attends a secondary school in Lagos. She funds a voucher for 400 USDC, category `TUITION`, school "Example College", expiring 30 days after term start. The school registrar's attester service confirms enrollment on the first day of term. The contract releases 400 USDC to the school. Amara can see on-chain that the payment was released for the stated purpose, and nobody except the school and the attester knows which student it was for.

---

## System architecture

```
                   ┌─────────────────────────────────────────────┐
                   │                  Stellar network            │
                   │                                             │
                   │   ┌───────────────────────────────────┐     │
                   │   │  Voucher contract (Soroban/WASM)  │     │
                   │   │  fund · confirm · reclaim · cancel│     │
                   │   └───────────────┬───────────────────┘     │
                   │                   │ token interface (SAC)   │
                   │   ┌───────────────▼───────────────────┐     │
                   │   │  USDC / stablecoin (Stellar asset)│     │
                   │   └───────────────────────────────────┘     │
                   └───────▲─────────────────▲──────────▲────────┘
                           │ RPC             │ events   │ RPC
          ┌────────────────┴───┐    ┌────────┴─────┐   ┌┴─────────────────┐
          │      Web app       │    │   Indexer    │   │ Attester service │
          │ (funder/school/    │    │ (getEvents → │   │ (KMS-backed      │
          │  attester views)   │    │  Postgres)   │   │  signing)        │
          └─────────┬──────────┘    └──────┬───────┘   └────────┬─────────┘
                    │ REST/GraphQL         │                    │
                    └──────────┬───────────┴────────────────────┘
                               │
                       ┌───────▼────────┐        ┌──────────────────────┐
                       │   API server   │◄──────►│  School records (off │
                       │   + Postgres   │        │  chain, per school)  │
                       └───────┬────────┘        └──────────────────────┘
                               │
                    ┌──────────▼───────────┐
                    │  Anchors (SEP-10/12/ │
                    │  24/31) fiat ramps   │
                    └──────────────────────┘
```

### Design principles

1. **The chain enforces rules, not facts.** The contract guarantees that only the right party can release funds and that the funder can recover them. It cannot know whether a student is really enrolled. That trust lives in the attester model.
2. **Minimize on-chain data.** Everything sensitive stays off-chain with the school.
3. **Small, auditable contract.** Keep the escrow logic minimal. Put policy, reputation, and UX in off-chain services or separate contracts.
4. **Funds never rest with us.** The platform operators hold no custody of escrowed funds. The contract does.
5. **Works on weak connections.** The web app is a PWA, and flows are designed for low-bandwidth, mobile-first use.

---

## Voucher lifecycle

```
                        fund()
          (none) ─────────────────────► Funded
                                          │
              ┌───────────────┬───────────┼────────────────┬───────────────┐
              │ confirm()     │ cancel()  │ reclaim()      │ dispute()     │
              │ (attesters,   │ (funder + │ (funder, after │ (funder or    │
              │  threshold)   │  school)  │  expiry)       │  school)      │
              ▼               ▼           ▼                ▼               │
          Released        Cancelled    Reclaimed        Disputed ──────────┘
        (school paid)   (funder refund) (funder refund)      │ resolve()
                                                             ▼
                                                  Released or Refunded
```

| Status      | Terminal? | Funds went to                         |
| ----------- | --------- | ------------------------------------- |
| `Funded`    | No        | Held in escrow                        |
| `Released`  | Yes       | School                                |
| `Reclaimed` | Yes       | Funder (after expiry)                 |
| `Cancelled` | Yes       | Funder (mutual agreement)             |
| `Disputed`  | No        | Held until resolved (optional module) |
| `Refunded`  | Yes       | Funder (dispute outcome)              |

**Invariants the contract must always preserve:**

- Funds can leave escrow exactly once per voucher.
- Only the voucher's school can ever receive a release.
- `reclaim` is impossible before expiry and impossible once `Released`.
- `confirm` is impossible after expiry (or, as a configurable policy, within a grace window).
- The sum of tokens held by the contract equals the sum of amounts of all non-terminal vouchers.

---

## Smart contract specification

The contract is written in Rust with the Soroban SDK. This section describes the intended interface; the source in `contracts/voucher` is authoritative.

### Data types

```rust
pub enum Status { Funded, Released, Reclaimed, Cancelled, Disputed, Refunded }

pub struct Voucher {
    pub id: u64,
    pub funder: Address,
    pub school: Address,           // payee
    pub token: Address,            // SAC address of the asset
    pub amount: i128,
    pub category: u32,             // coarse code, see shared enum
    pub student_ref: BytesN<32>,   // opaque salted hash
    pub attesters: Vec<Address>,   // authorized attesters
    pub threshold: u32,            // signatures required to confirm
    pub created_at: u64,           // ledger timestamp
    pub expires_at: u64,           // ledger timestamp
    pub status: Status,
}
```

### Public functions

| Function                                                                        | Caller             | Behavior                                                                                                |
| ------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------- |
| `initialize(admin, config)`                                                     | Deployer, once     | Sets admin, allowed tokens, protocol fee (if any), limits                                               |
| `register_school(school, attesters, threshold)`                                 | Admin or registrar | Whitelists a school and its default attester set                                                        |
| `fund(funder, school, token, amount, category, student_ref, expires_at) -> u64` | Funder             | Requires auth from funder, transfers tokens into the contract, creates a voucher                        |
| `confirm(voucher_id, attester)`                                                 | Attester           | Records one attestation; when `threshold` is reached, transfers funds to the school and sets `Released` |
| `reclaim(voucher_id)`                                                           | Funder             | Allowed only after `expires_at` and only if `Funded`; returns funds                                     |
| `cancel(voucher_id)`                                                            | Funder and school  | Both must authorize; returns funds to funder before expiry                                              |
| `dispute(voucher_id)`                                                           | Funder or school   | _(Optional)_ freezes the voucher                                                                        |
| `resolve(voucher_id, outcome)`                                                  | Arbiter            | _(Optional)_ releases or refunds a disputed voucher                                                     |
| `get_voucher(id)`                                                               | Anyone             | Read-only                                                                                               |
| `extend_ttl(id)`                                                                | Anyone             | Extends storage lifetime for long-running vouchers                                                      |

### Expiry boundary semantics

The contract resolves races at the exact expiry instant as follows:

| Operation | Condition for success                                        |
| --------- | ------------------------------------------------------------ |
| `confirm` | `ledger_timestamp < expires_at` (strictly **before** expiry) |
| `reclaim` | `ledger_timestamp >= expires_at` (at expiry **or after**)    |

At the exact ledger second where `ledger_timestamp == expires_at`:

- `confirm` **fails** with `AlreadyExpired`
- `reclaim` **succeeds**

This is a deliberate _fail-closed_ choice: when the clock is ambiguous, return the money to the funder rather than risk a late release to the school.

### Events

Events are the source of truth for the indexer. Emit one for every state change, containing only non-sensitive fields.

| Event                   | Fields                                                    |
| ----------------------- | --------------------------------------------------------- |
| `funded`                | `id, funder, school, token, amount, category, expires_at` |
| `attested`              | `id, attester, count`                                     |
| `released`              | `id, school, amount`                                      |
| `reclaimed`             | `id, funder, amount`                                      |
| `cancelled`             | `id`                                                      |
| `disputed` / `resolved` | `id, outcome` _(deferred to Phase 3 dispute module)_      |

### Errors

Use a typed error enum with stable codes, mirrored in `packages/shared` so every client shows consistent messages: `NotAuthorized`, `VoucherNotFound`, `InvalidStatus`, `NotExpired`, `AlreadyExpired`, `InvalidAmount`, `SchoolNotRegistered`, `TokenNotAllowed`, `DuplicateAttestation`, `ThresholdNotMet`.

### Storage and TTL

Soroban storage entries expire unless their TTL is extended. Voucher entries live in persistent storage, and the contract extends TTL on every write. A background job in the API extends TTL for vouchers approaching expiry so that long-running vouchers are never archived before they resolve. Archived entries can be restored, but it is better never to rely on that.

---

## Privacy model

**What goes on-chain**

- Funder address, school address, token, amount
- Fee category code
- `student_ref`: `SHA-256(salt || student_identifier)` with a **per-voucher random salt**
- Attester addresses, status, timestamps

**What never goes on-chain**

- Student names, dates of birth, national IDs
- Grades, attendance records, disciplinary or medical information
- Parent or guardian details
- Any free-text memo supplied by a user

**How the mapping works**

1. The backend generates a random salt per voucher.
2. It computes `student_ref` and stores `{voucher_id, student_identifier, salt}` in Postgres, with the salt encrypted using envelope encryption (keys held in KMS).
3. The school (and only the school) is given the salt and identifier mapping through an authenticated channel, so it can recognize which student a voucher belongs to.
4. The attester signs only the statement "conditions for voucher #X are met." It does not publish the underlying records.

**Honest limits**

- Funder and school addresses are public on-chain, and amounts are visible. Someone who knows both a funder and a school can see that a payment happened. Use fresh addresses per funder where practical.
- Opaque references protect the student's identity, but timing and amount patterns can still leak information about small schools. Consider amount bucketing or batching for small cohorts.
- Students are frequently minors. Treat the off-chain mapping as personal data under applicable law (GDPR, NDPR, COPPA, etc.), with data minimization, retention limits, and deletion procedures.

---

## Attester model

The chain cannot verify enrollment. It can only enforce that the right party said so. The attester design is therefore the most important trust decision in the system.

### Options, from simplest to strongest

| Model                           | Description                                                       | Trade-off                                          |
| ------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| **School self-attestation**     | The school registrar confirms                                     | Simple, but the payee confirms its own payment     |
| **Single independent attester** | An education authority or auditor confirms                        | Better separation, single point of failure         |
| **M-of-N threshold**            | e.g., 2 of {school, authority, platform auditor}                  | Strong, more operational overhead                  |
| **Staked attesters**            | Attesters post a bond that is slashed on proven false attestation | Strongest incentives, needs dispute infrastructure |

**Recommended default:** 2-of-3 threshold with the school registrar, an independent verifier (education authority or accredited auditor), and a platform-operated service that cross-checks records.

### Attester service responsibilities

- Authenticate the school's record system (API, signed export, or manual review queue).
- Check the voucher's condition (e.g., "student with this reference is enrolled for Term 1").
- Sign and submit `confirm` only on success.
- Keep a tamper-evident audit log of every decision.
- Hold keys in a KMS or HSM, never in environment files or source control.
- Rotate keys and support emergency revocation of an attester address.

### Failure handling

- If the attester is unavailable, vouchers simply expire and funders are refunded. The default failure mode is "return the money."
- If an attester is compromised, the admin can remove it from the school's attester set. Vouchers already `Released` cannot be undone, which is why thresholds matter.

---

## Tech stack

> Versions move quickly. Check [developers.stellar.org](https://developers.stellar.org) before pinning anything.

| Layer            | Technology                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| Smart contract   | Rust, Soroban SDK (WASM), Stellar CLI                                                                     |
| Asset            | USDC or another Stellar-issued stablecoin through the Stellar Asset Contract (SAC)                        |
| Network access   | Soroban RPC (simulate, submit, `getEvents`); Horizon for classic account and payment history              |
| Frontend         | TypeScript, React / Next.js (PWA), `@stellar/stellar-sdk`, Stellar Wallets Kit (Freighter, LOBSTR, xBull) |
| Backend          | Node.js + TypeScript (NestJS or Express), PostgreSQL, Redis, BullMQ                                       |
| Indexer          | Node.js worker polling Soroban RPC events into Postgres                                                   |
| Attester service | Node.js service with KMS-backed signing (AWS KMS, Google Cloud KMS, or HashiCorp Vault)                   |
| Fiat ramps       | Stellar anchors via SEP-10, SEP-12, SEP-24, SEP-31; optionally the Stellar Anchor Platform                |
| Tooling          | pnpm workspaces, Turborepo, Cargo workspace                                                               |
| Infra            | Docker, GitHub Actions, Terraform, Sentry, Prometheus/Grafana                                             |

### Fees and reserves

- Transaction fees on Stellar are very small, and Soroban adds resource fees for contract execution and storage. Estimate with RPC simulation rather than hard-coding.
- The school's account needs a **trustline** to the asset and a minimum XLM reserve. Use **sponsored reserves** and **fee-bump transactions** so schools and funders never need to hold XLM.

---

## Repository structure

```
tuition-escrow/
├── contracts/
│   └── voucher/              # Soroban contract (Rust) + unit tests
│       ├── src/
│       │   ├── lib.rs
│       │   ├── types.rs
│       │   ├── errors.rs
│       │   └── test.rs
│       └── Cargo.toml
├── packages/
│   ├── contract-bindings/    # Generated TypeScript client (do not hand-edit)
│   ├── shared/               # Category codes, status enums, error codes, validation
│   └── config/               # Shared ESLint, tsconfig, prettier
├── apps/
│   ├── web/                  # Next.js PWA: funder, school, attester views
│   ├── api/                  # REST/GraphQL API, Postgres access, auth
│   ├── indexer/              # Soroban event poller → Postgres
│   └── attester/             # KMS-backed attester signing service
├── infra/
│   ├── docker/               # Dockerfiles, docker-compose for local dev
│   └── terraform/            # Cloud infrastructure
├── deployments/
│   ├── testnet.json          # Deployed contract IDs and asset addresses
│   └── mainnet.json
├── docs/
│   ├── architecture.md
│   ├── threat-model.md
│   ├── attester-playbook.md
│   └── data-protection.md
├── scripts/                  # Build, deploy, seed, bindings generation
├── .github/workflows/        # CI/CD
├── Cargo.toml                # Cargo workspace
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

---

## Getting started

### Prerequisites

- **Rust** (stable) with the `wasm32v1-none` or `wasm32-unknown-unknown` target, depending on your Stellar CLI version
- **Stellar CLI** (`stellar`)
- **Node.js** 20+ and **pnpm** 9+
- **Docker** and Docker Compose
- **PostgreSQL** 15+ and **Redis** 7+ (provided by Docker Compose for local development)

### 1. Clone and install

```bash
git clone https://github.com/cyberdocs120/tuition-escrow.git
cd tuition-escrow
pnpm install
```

### 2. Install the Rust toolchain and Stellar CLI

```bash
rustup update stable
rustup target add wasm32-unknown-unknown   # check current Stellar docs for the right target
cargo install --locked stellar-cli
stellar --version
```

### 3. Start local infrastructure

```bash
docker compose -f infra/docker/docker-compose.yml up -d
# Starts Postgres, Redis, and a local Stellar Quickstart node (check current docs
# for the recommended Quickstart command for your CLI version)
```

### 4. Create and fund test identities

```bash
stellar keys generate --global admin --network testnet --fund
stellar keys generate --global funder --network testnet --fund
stellar keys generate --global school --network testnet --fund
stellar keys generate --global attester --network testnet --fund
```

### 5. Build, test, and deploy the contract to testnet

```bash
cd contracts/voucher
cargo test
stellar contract build

stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/voucher.wasm \
  --source admin \
  --network testnet
# Save the printed contract ID into deployments/testnet.json
```

### 6. Generate TypeScript bindings

```bash
stellar contract bindings typescript \
  --network testnet \
  --contract-id CAESCW4K257N6WNJLMYXWZX7H77S4M6H35437C77E2A2H3K6VOUCHER1 \
  --output-dir packages/contract-bindings
pnpm --filter contract-bindings build
```

### 7. Configure and run the apps

```bash
cp .env.example .env              # fill in values, see Configuration
pnpm db:migrate
pnpm dev                          # runs web, api, indexer, attester via Turborepo
```

Open `http://localhost:3000` and walk through the demo flow: register a school, fund a voucher as `funder`, confirm as `attester`, and watch the school balance update.

---

## Configuration

All configuration is environment-driven. Never commit real secrets.

| Variable              | Description                                                           |
| --------------------- | --------------------------------------------------------------------- |
| `STELLAR_NETWORK`     | `local`, `testnet`, or `mainnet`                                      |
| `SOROBAN_RPC_URL`     | Soroban RPC endpoint                                                  |
| `HORIZON_URL`         | Horizon endpoint (if used)                                            |
| `NETWORK_PASSPHRASE`  | Passphrase for the selected network                                   |
| `VOUCHER_CONTRACT_ID` | Deployed voucher contract ID                                          |
| `ASSET_CONTRACT_ID`   | SAC address of the stablecoin                                         |
| `DATABASE_URL`        | Postgres connection string                                            |
| `REDIS_URL`           | Redis connection string                                               |
| `KMS_KEY_ID`          | Key ID for envelope encryption of salts                               |
| `ATTESTER_KMS_KEY_ID` | KMS key backing the attester signing account                          |
| `FEE_BUMP_SECRET_REF` | Reference (not the value) to the fee-sponsor key in your secret store |
| `ANCHOR_HOME_DOMAIN`  | Anchor domain for SEP flows                                           |
| `JWT_SECRET_REF`      | Reference to the auth signing secret                                  |
| `SENTRY_DSN`          | Error reporting                                                       |

Frontend variables must be prefixed `NEXT_PUBLIC_` and must never contain secrets.

---

## Development workflow

- **Branching:** trunk-based with short-lived feature branches and pull requests.
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`).
- **Contract changes:** any change to a public function, type, event, or error requires, in the same PR:
  1. Updated unit tests
  2. Regenerated bindings
  3. Updated `packages/shared` enums where relevant
  4. Updated section in this README or `docs/`
- **Code style:** `cargo fmt` and `cargo clippy -- -D warnings` for Rust; ESLint and Prettier for TypeScript.
- **Useful scripts:**

```bash
pnpm build            # build everything in dependency order
pnpm test             # run all TypeScript tests
pnpm lint             # lint everything
pnpm bindings         # rebuild the contract and regenerate TS bindings
pnpm db:migrate       # run database migrations
pnpm db:seed          # seed local demo data
```

---

## Testing strategy

| Level                      | What                                                                           | Tooling                                          |
| -------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------ |
| Contract unit tests        | Every function, every error path, every status transition                      | Soroban test utilities (`cargo test`)            |
| Property / invariant tests | Funds conservation, single-release, no reclaim before expiry                   | `proptest` or fuzzing                            |
| Contract integration       | Real token (SAC) transfers on a local network                                  | Quickstart + CLI scripts                         |
| Backend                    | API, auth, encryption, salt handling                                           | Vitest/Jest + Testcontainers                     |
| Indexer                    | Event decoding, replay safety, idempotency, reorg-free recovery after downtime | Vitest + recorded RPC fixtures                   |
| End-to-end                 | Fund → attest → release, fund → expire → reclaim                               | Playwright against local stack                   |
| Security                   | Static analysis, dependency audit, external contract audit                     | `cargo audit`, `pnpm audit`, third-party auditor |

**Minimum scenarios that must pass before any mainnet deployment:**

1. Unauthorized caller cannot `confirm`, `cancel`, or `reclaim`.
2. Double `confirm` by the same attester does not count twice.
3. `reclaim` before expiry fails; after expiry succeeds exactly once.
4. `confirm` after release or reclaim fails.
5. Funds held by the contract always equal the sum of open vouchers.
6. Archived-and-restored voucher state behaves identically.
7. Malformed amounts (zero, negative, overflow) are rejected.

---

## Deployment

### Environments

| Environment | Purpose                              | Network                |
| ----------- | ------------------------------------ | ---------------------- |
| `local`     | Development                          | Quickstart container   |
| `testnet`   | Integration, demos, pilot rehearsals | Stellar testnet        |
| `mainnet`   | Production                           | Stellar public network |

### Release checklist (mainnet)

- [ ] External contract audit completed, findings resolved
- [ ] Legal and regulatory review completed for each launch jurisdiction
- [ ] Attesters onboarded, contracted, and keys provisioned in KMS/HSM
- [ ] Admin and upgrade keys secured with multi-sig and offline storage
- [ ] Monitoring, alerting, and on-call rotation in place
- [ ] Incident response and key-compromise runbooks tested
- [ ] Funding caps set for the initial pilot (per voucher and in aggregate)
- [ ] Contract ID, WASM hash, and release tag recorded in `deployments/mainnet.json`

### Contract upgrades

Deployed contracts can be upgraded only if you build that capability in. Decide deliberately:

- **Immutable:** strongest trust guarantee for funders, but bugs cannot be patched.
- **Upgradeable behind multi-sig and a time lock:** allows fixes, but funders must trust the admin. If you choose this, publish upgrade policy, announce upgrades ahead of time, and never allow an upgrade to change the payee or release rules of existing vouchers.

A common approach is to ship a conservative, capped v1 and migrate to a new contract version for new vouchers, leaving existing vouchers to settle on the old contract.

---

## Fiat on-ramps and off-ramps

The contract is the easy part. Moving real money in and out is where most of the real-world work lies.

- **Funder on-ramp:** the funder pays by card, bank transfer, or mobile money. An anchor converts that to the stablecoin and delivers it to the funder's Stellar account.
- **School off-ramp:** the school withdraws the stablecoin to a local bank account or mobile wallet through an anchor.
- **Relevant standards:**
  - **SEP-10:** authentication with an anchor
  - **SEP-12:** KYC data exchange
  - **SEP-24:** interactive deposit and withdrawal
  - **SEP-31:** cross-border payments between anchors
- **Practical advice:**
  - Check which anchors operate in your target corridors before choosing a launch market.
  - Start on testnet with test USDC, then add a single anchor integration.
  - If no suitable anchor exists, the open-source Stellar Anchor Platform can help you build one, but that brings licensing and compliance obligations.

---

## Operations and monitoring

**Alert on:**

- Vouchers approaching expiry without confirmation
- Vouchers whose storage TTL is within a safety margin of archival
- Failed or repeatedly retried `confirm` submissions
- Indexer lag behind the latest ledger
- Attester service errors or unusual approval rates
- Fee-sponsor account balance below threshold
- Any admin-function invocation

**Runbooks (in `docs/`)**

- Attester key compromise
- Indexer replay and recovery from a gap
- Expired-voucher sweep and reclaim assistance
- School payout address change (requires re-verification)
- Anchor outage

**Reconciliation:** run a daily job that compares on-chain contract token balance, indexed voucher totals, and anchor settlement reports. Any mismatch pages a human.

---

## Security model

### Threats and mitigations

| Threat                                           | Mitigation                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Attester colludes with school to falsely confirm | M-of-N thresholds, independent attester, audit logs, optional staking and slashing         |
| Attester key theft                               | KMS/HSM storage, per-environment keys, rotation, revocation by admin                       |
| Funder reclaims after service was delivered      | `reclaim` only after expiry; `confirm` window and grace period configured to prevent races |
| Contract bug drains escrow                       | Minimal contract, property tests, external audit, funding caps in early releases           |
| Admin key abuse                                  | Multi-sig admin, time-locked upgrades, narrow admin powers (cannot move escrowed funds)    |
| Replay or double release                         | Status checks and single-use transitions enforced in contract                              |
| Fake school registration                         | Verified onboarding, documented checks, payout address change controls                     |
| Phishing or fake front-ends                      | Pinned contract IDs, published addresses, wallet confirmation of exact contract call       |
| Student re-identification                        | Salted hashes, no free text, minimal metadata, amount bucketing for small cohorts          |
| Indexer or API compromise                        | The chain is the source of truth; the API cannot move funds; keys stay in KMS              |
| Dependency compromise                            | Pinned and audited dependencies, lockfiles, CI audit steps                                 |

### Principles

- The platform never takes custody of escrowed funds.
- Admin keys cannot move funds out of escrow to arbitrary destinations.
- Fail closed: if anything is uncertain, the voucher expires and the funder is refunded.
- Least privilege for every service and every human.

### Reporting a vulnerability

Please **do not** open a public issue for security problems. Email `security@tuition-escrow.org` with details and reproduction steps. We aim to acknowledge reports within 72 hours. A bug bounty program will be published before mainnet launch.

---

## Legal and regulatory notes

This is not legal advice, and the project operators must obtain their own.

- Accepting, holding, converting, or transmitting funds on behalf of others may require **money transmitter, payment institution, or e-money licenses**, or a licensed partner, depending on jurisdiction.
- **KYC/AML and sanctions screening** obligations may apply to funders, schools, and anchors.
- **Data protection laws** apply to the off-chain student mapping. Students are often minors, so apply strict minimization, purpose limitation, retention limits, and deletion rights. Consider the practical effects of the immutability of on-chain data: never place personal data on-chain, even hashed, without a clear legal basis and a salting strategy that prevents linkage.
- **Education regulation:** some jurisdictions regulate how school fees may be collected or paid.
- **Tax and reporting:** cross-border remittances may trigger reporting obligations for funders and recipients.
- Using a stablecoin introduces **issuer and depeg risk**. Disclose it to users.

---

## Roadmap

**Phase 0: Foundations**

- [x] Finalize contract interface and state machine
- [x] Soroban contract with `fund`, `confirm`, `reclaim`, `cancel`
- [x] Unit tests and invariant tests
- [x] Monorepo scaffolding and CI

**Phase 1: Testnet MVP**

- [x] Next.js PWA with Freighter for funder, school, and attester views
- [x] API, Postgres, and event indexer
- [x] Manual attester flow with KMS-backed signing
- [x] Sponsored reserves and fee-bump transactions

**Phase 2: Pilot**

- [x] One corridor, a handful of schools, capped volumes (testnet validation)
- [ ] Anchor integration (SEP-24 / SEP-31)
- [x] 2-of-3 attester thresholds
- [ ] External security audit
- [ ] Legal review and licensing or partner arrangement

**Phase 3: Expansion**

- [ ] Milestone-based and installment vouchers (per term, per semester)
- [ ] Pooled scholarship funds with per-student allocations
- [ ] Dispute resolution module
- [ ] Attester staking and reputation
- [ ] Beneficiary-first redemption (QR / one-time code) for low-connectivity settings
- [ ] Multi-language, mobile-money, and WhatsApp/SMS notifications
- [ ] Support for additional purposes beyond tuition (exam fees, books, boarding, rent)

---

## FAQ

**Can this really be built on Stellar?**
Yes. Soroban smart contracts are live on Stellar mainnet, and Stellar's token interface, low fees, and anchor ecosystem fit this use case well.

**Why not use Claimable Balances instead of a contract?**
Claimable Balances support time-based conditions, which covers the refund path. They cannot express "released only when a specific attester confirms," which is why a Soroban contract is the better fit.

**Does the school need to understand crypto?**
No. The school's account is created and sponsored for it, and it receives funds through a simple dashboard, with withdrawal to local currency through an anchor.

**Does the funder need to hold XLM?**
No. Fee-bump transactions and sponsored reserves cover network costs.

**What stops a school from confirming its own payment?**
Using a single self-attesting school is the weakest configuration. The recommended default is an M-of-N threshold including an independent verifier.

**What happens if the attester never responds?**
The voucher expires and the funder reclaims the money.

**Can the funder see which student the money was for?**
Only if they supplied the student identifier themselves. The chain stores an opaque reference, and the school holds the mapping.

**Is the contract upgradeable?**
That is a deliberate design decision, covered in [Contract upgrades](#contract-upgrades).

---

## Contributing

Contributions are welcome.

1. Open an issue to discuss significant changes before starting.
2. Fork the repository and create a feature branch.
3. Follow the [development workflow](#development-workflow), including tests and regenerated bindings.
4. Ensure `pnpm lint`, `pnpm test`, `cargo fmt --check`, `cargo clippy`, and `cargo test` all pass.
5. Open a pull request describing the change, the motivation, and any security implications.

Changes touching the contract, attester service, or key handling receive extra review and require two approvals.

Please read `CODE_OF_CONDUCT.md` before participating.

---

## License

Released under the [MIT License](./LICENSE) unless you choose otherwise.

---

## Acknowledgements

Built on the [Stellar network](https://stellar.org) and [Soroban](https://developers.stellar.org/docs/build/smart-contracts/overview). Inspired by the idea that money sent across borders should be able to carry its purpose with it.
