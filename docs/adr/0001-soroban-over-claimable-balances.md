# ADR 1: Soroban Smart Contract over Claimable Balances

- **Status:** Accepted
- **Deciders:** Tuition Escrow Core Architecture
- **Date:** 2026-10-14 (Kickoff)

## Context

Families, diaspora members, and scholarship sponsors need to lock tuition funds that are released to schools only upon verified student enrollment, or returned to the funder if conditions are not met.

Stellar native Claimable Balances support time-based predicates, which could handle simple time-locked refunds.

## Decision

Use a Soroban smart contract (Rust/WASM) rather than Stellar native Claimable Balances.

## Rationale

Claimable Balances cannot express arbitrary conditional logic or programmatic multi-party authorization:

1. Claimable Balances cannot enforce "release funds only when an authorized attester (or M-of-N threshold of attesters) signs a confirmation."
2. Claimable Balances cannot maintain voucher-specific state transitions (such as joint mutual cancellation, attestation counts, or fee category enforcement).
3. Soroban provides programmable escrow logic, typed status transitions, event emissions for indexers, and direct interoperability with Stellar Asset Contract (SAC) tokens.

## Consequences

- Requires deploying and maintaining a Soroban Rust contract.
- Contract storage entries require TTL management.
- Guarantees full programmability for M-of-N attestation, fail-closed expiry, and mutual cancellations.
