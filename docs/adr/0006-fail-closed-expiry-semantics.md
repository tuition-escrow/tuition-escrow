# ADR 6: Fail-Closed Expiry Boundary Semantics

- **Status:** Accepted
- **Deciders:** Tuition Escrow Core Architecture
- **Date:** 2026-10-14

## Context

Distributed systems and blockchains experience timestamp discretization and potential race conditions near expiry deadlines. If a confirmation transaction and a reclaim transaction arrive in the same ledger close to `expires_at`, deterministic boundary rules are required to prevent conflicting outcomes or double spends.

## Decision

Adopt strict _fail-closed_ expiry semantics at the exact ledger second:

- `confirm` succeeds strictly **before** expiry: `ledger_timestamp < expires_at`.
- `reclaim` succeeds at expiry **or after**: `ledger_timestamp >= expires_at`.

At the boundary second where `ledger_timestamp == expires_at`:

- `confirm` **fails** with error `AlreadyExpired`.
- `reclaim` **succeeds**.

## Rationale

1. **Protect Funder Capital:** When there is ambiguity at the deadline, the fail-closed choice safely returns money to the funder rather than risking an unauthorized or tardy payout to a school.
2. **Definitive State Machine:** Eliminates grey zones where both operations could be simultaneously valid.
3. **Incentive Alignment:** Schools and attesters have strong incentives to verify and submit confirmations well in advance of the deadline.

## Consequences

- Attesters must account for block inclusion delays and submit `confirm` transactions with adequate time before `expires_at`.
- Any unconfirmed voucher at or past expiry is guaranteed to be reclaimable by the funder.
