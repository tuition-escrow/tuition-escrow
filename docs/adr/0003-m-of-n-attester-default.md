# ADR 3: M-of-N Attester Threshold Default

- **Status:** Accepted
- **Deciders:** Tuition Escrow Core Architecture
- **Date:** 2026-10-14

## Context

The blockchain cannot directly verify whether a student is enrolled in school or attending classes. Trust resides in the parties authorized to submit attestations (`confirm`).
A single self-attesting school registrar presents a conflict of interest (the payee confirms its own release). A single external attester presents a single point of failure or compromise.

## Decision

Adopt an M-of-N threshold (recommended default: 2-of-3) consisting of:

1. The school registrar,
2. An independent verifier (education authority or accredited auditor), and
3. A platform-operated verification service that cross-checks records.

## Rationale

1. **Collusion Resistance:** No single entity can unilaterally release escrowed funds without independent corroboration.
2. **Operational Resilience:** If any one attester is temporarily offline or unreachable, remaining attesters meeting threshold $M$ can still resolve vouchers without trapping funds.
3. **Graceful Failure:** If threshold cannot be met, the voucher expires and funds return to the funder.

## Consequences

- Increased coordination and operational overhead for attester keys and services.
- The smart contract must track distinct attesters per voucher and prevent duplicate votes by the same attester.
