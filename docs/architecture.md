# Tuition Escrow — System Architecture

This document describes the technical architecture, component interactions, scenario data flows, and trust boundaries of Tuition Escrow, based strictly on the specification in `README.md`.

---

## 1. System Overview

Tuition Escrow enables purpose-bound school fee payments on Stellar. Escrowed tokens are locked in a Soroban smart contract and released to a school only when authorized attesters confirm the condition (such as enrollment) has been met. If conditions are not met, the funder recovers their funds after expiry.

### Architecture Diagram

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

```mermaid
flowchart TD
    subgraph StellarNetwork ["Stellar Network / Soroban"]
        VC["Voucher Contract (WASM)"]
        SAC["USDC / Stablecoin (SAC)"]
        VC -- "Token transfers" --> SAC
    end

    subgraph ClientsServices ["Client & Off-Chain Services"]
        WEB["Next.js Web PWA\n(Funder, School, Attester)"]
        API["API Server (Node/Express)\n+ Postgres DB"]
        IDX["Indexer Worker\n(Event Poller)"]
        ATT["Attester Service\n(KMS Signing)"]
    end

    subgraph ExternalSystems ["External & Partner Systems"]
        KMS["Cloud KMS / HSM\n(Salts & Attester Keys)"]
        ANCHOR["Stellar Anchors\n(SEP-10/12/24/31)"]
        SCHOOL_SYS["School Student Records\n(Off-chain SIS)"]
    end

    WEB -- "RPC Simulation & Submit" --> VC
    ATT -- "confirm() via KMS sign" --> VC
    VC -- "Events (funded, attested, etc.)" --> IDX
    IDX -- "Transactional writes" --> API
    WEB -- "REST / Auth" --> API
    API -- "Envelope encryption" --> KMS
    ATT -- "Sign transaction" --> KMS
    ATT -- "Verify condition" --> SCHOOL_SYS
    API -- "Fiat off-ramp" --> ANCHOR
```

---

## 2. Core Architectural Principles

1. **The chain enforces rules, not facts:** The smart contract guarantees that funds are held securely and released only upon valid attestation or returned to the funder after expiry. It does not inspect off-chain school records directly; trust lives in the independent attester model.
2. **Minimize on-chain data:** No student personal identifiable information (PII) ever touches the ledger. Vouchers contain only an opaque 32-byte salted hash (`student_ref`) and a coarse fee category code.
3. **Small, auditable contract:** Escrow state transitions are minimal and fail-closed. Off-chain services handle indexing, attestation workflow, and UI.
4. **Funds never rest with the platform:** Platform operators hold no custody of escrowed funds. Tokens are held directly by the Soroban contract.
5. **Fail-closed operations:** At the exact second of voucher expiry, attestation fails (`AlreadyExpired`) and funder reclaim succeeds. If an attester service or indexer is unavailable, funders reclaim unreleased funds.

---

## 3. Data Flow per Scenario

### Scenario 1: Setup & Happy Path (Fund → Threshold Attestations → Release)

```mermaid
sequenceDiagram
    autonumber
    actor Funder
    participant Web as Web App (PWA)
    participant API as API Server + DB
    participant Contract as Voucher Contract
    participant SAC as SAC Token (USDC)
    participant Attester as Attester Service
    actor School

    Note over Funder,School: Setup: School registered with M-of-N attester set and threshold
    Funder->>API: POST /vouchers/prepare (student_identifier, school_id)
    API->>API: Generate random salt, compute student_ref = SHA-256(salt || identifier)
    API->>API: Store encrypted salt in DB (envelope encryption via KMS)
    API-->>Web: Return student_ref
    Funder->>Contract: fund(funder, school, token, amount, category, student_ref, expires_at)
    Contract->>SAC: transfer_from(funder, contract, amount)
    Contract-->>Contract: Status: Funded
    Contract-->>Web: Voucher funded event emitted

    Note over Attester,School: Term begins — Attestation phase
    Attester->>Attester: Verify enrollment against school records
    Attester->>Contract: confirm(voucher_id, attester_1)
    Contract-->>Contract: Record attestation (count = 1 < threshold)
    Attester->>Contract: confirm(voucher_id, attester_2)
    Contract-->>Contract: Threshold met (count = 2) -> Status: Released
    Contract->>SAC: transfer(contract, school, amount)
    School->>School: Balance increases by voucher amount
```

### Scenario 2: Expiry Path (Fund → No Attestation → Expiry → Reclaim)

```mermaid
sequenceDiagram
    autonumber
    actor Funder
    participant Contract as Voucher Contract
    participant SAC as SAC Token (USDC)

    Funder->>Contract: fund(...) -> Status: Funded
    Note over Contract: Ledger time advances past expires_at without threshold confirmation
    Funder->>Contract: reclaim(voucher_id)
    Note over Contract: Verify: ledger_timestamp >= expires_at AND status == Funded
    Contract-->>Contract: Status: Reclaimed
    Contract->>SAC: transfer(contract, funder, amount)
    Funder->>Funder: Escrowed funds fully refunded
```

### Scenario 3: Cancel Path (Mutual Cancellation Before Expiry)

```mermaid
sequenceDiagram
    autonumber
    actor Funder
    actor School
    participant Contract as Voucher Contract
    participant SAC as SAC Token (USDC)

    Note over Funder,School: Plans change early before expiry
    Funder->>Contract: Authorize cancel(voucher_id)
    School->>Contract: Authorize cancel(voucher_id)
    Contract->>Contract: Verify both funder and school authenticated
    Contract-->>Contract: Status: Cancelled
    Contract->>SAC: transfer(contract, funder, amount)
    Funder->>Funder: Funder receives complete refund
```

### Scenario 4: Attack Attempts & Rejections

- **Non-Attester Confirm:** Unauthorized caller attempts `confirm(voucher_id)`. Contract verifies caller is in voucher's snapshotted attester set; fails immediately with `NotAuthorized`.
- **Early Reclaim:** Funder calls `reclaim(voucher_id)` while `ledger_timestamp < expires_at`. Contract rejects with `NotExpired`.
- **Double Attestation:** Attester attempts to call `confirm` twice. Contract rejects with `DuplicateAttestation`; vote is not counted twice.
- **Release to Wrong Party:** Contract release logic strictly transfers tokens to `voucher.school` (immutable payee). There is no parameter or code path allowing arbitrary destination addresses.

### Scenario 5: Indexer Ingestion & Recovery

```mermaid
sequenceDiagram
    autonumber
    participant Contract as Voucher Contract
    participant RPC as Soroban RPC
    participant Indexer as Indexer Poller
    participant DB as Postgres DB

    Contract-->>RPC: Emit events (funded, attested, released, etc.)
    Indexer->>RPC: getEvents(startLedger, cursor)
    RPC-->>Indexer: Return event batch [E1, E2, E3]
    Indexer->>DB: BEGIN TRANSACTION
    Indexer->>DB: Apply handlers (idempotent ON CONFLICT / status checks)
    Note over Indexer: Failure / crash occurs mid-batch
    Indexer-->>DB: ROLLBACK (cursor unchanged)
    Note over Indexer: Indexer restarts with last persisted cursor
    Indexer->>RPC: getEvents(lastSavedCursor)
    RPC-->>Indexer: Re-fetch [E1, E2, E3]
    Indexer->>DB: Re-apply handlers transactionally + UPDATE cursor
    Indexer-->>DB: COMMIT -> State converges cleanly
```

### Scenario 6: Student Privacy Mapping Flow

1. **Client Submission:** The funder enters the student identifier (e.g., student ID number) in browser memory.
2. **Envelope Encryption:** The API generates a cryptographically secure random 32-byte salt, calculates `student_ref = SHA-256(salt || identifier)`, and encrypts the salt using a KMS data key.
3. **On-chain Isolation:** Only `student_ref` and a coarse category code are submitted on-chain.
4. **School Authorization:** Only authenticated administrators belonging to the specific school can call `GET /schools/:id/vouchers/:id/mapping` to decrypt the student identifier. Public users and funders receive 403 Forbidden.

---

## 4. Trust Boundaries

```
┌────────────────────────────────────────────────────────────────────────┐
│ PUBLIC / UNTRUSTED ZONE                                                │
│ Web Browsers, Public Networks, External Funders                         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTPS / RPC (TLS)
┌───────────────────────────────────▼────────────────────────────────────┐
│ PLATFORM / OPERATIONAL BOUNDARY                                        │
│ API Server (Non-custodial, No signing keys, JWT Role Checks)            │
│ Indexer (Read-only event consumer, idempotent Postgres updates)        │
│ KMS (Holds envelope master keys; raw keys never leave hardware)        │
└──────────────────┬─────────────────────────────────┬───────────────────┘
                   │ Authenticated RPC               │ Pinned SDK / KMS
┌──────────────────▼───────────────────┐ ┌───────────▼───────────────────┐
│ SCHOOL TRUST BOUNDARY                │ │ ATTESTER TRUST BOUNDARY       │
│ - Owns student SIS records           │ │ - Independent signing account │
│ - Accesses decrypted student mapping │ │ - Authorized ONLY to confirm  │
│ - Destination of released tokens     │ │ - Tamper-evident audit logs   │
└──────────────────────────────────────┘ └───────────────────────────────┘
                   │                                 │
┌──────────────────▼─────────────────────────────────▼───────────────────┐
│ BLOCKCHAIN CONSENSUS BOUNDARY (Stellar Soroban)                        │
│ - Smart Contract holds tokens in escrow; enforces invariants           │
│ - Admin keys CANNOT withdraw escrowed funds to arbitrary addresses    │
│ - Released funds can ONLY go to voucher.school                         │
│ - Fail-closed: unconfirmed vouchers refund to funder on expiry         │
└────────────────────────────────────────────────────────────────────────┘
```

### Summary of Component Privileges

| Component            | Can Move Funds?                              | Can Decrypt Student Data?        | Holds Private Signing Keys? |
| -------------------- | -------------------------------------------- | -------------------------------- | --------------------------- |
| **Voucher Contract** | Yes (Escrow holder, strictly per code logic) | No (Never receives student data) | No (Executes on Soroban VM) |
| **Funder Client**    | Only deposit & reclaim after expiry          | No (Mapping belongs to school)   | Only funder wallet key      |
| **School Dashboard** | Receives release; co-signs cancel            | Yes (Only for its own students)  | School wallet key           |
| **Attester Service** | Only signs `confirm` if condition met        | No (Verifies boolean outcome)    | KMS-backed attester key     |
| **Platform API**     | **NO** (Zero custody, cannot move funds)     | Only encrypted blobs via KMS     | No wallet signing keys      |
| **Indexer**          | **NO** (Read-only event ingest)              | No                               | No                          |
