# ADR 4: Snapshotting Attester Sets into Vouchers at Funding Time

- **Status:** Accepted
- **Deciders:** Tuition Escrow Core Architecture
- **Date:** 2026-10-14

## Context

Schools register their authorized attester sets and thresholds on-chain via `register_school`. Over time, a school's attester set may change (e.g., due to auditor rotation, key compromise, or contract renegotiation).

If a voucher evaluated attesters dynamically from the school's live registry:

- An admin or school could alter the attester set of existing in-flight vouchers retroactively.
- A compromise of the school registry could allow attackers to bypass the attester set agreed upon when the funder deposited tokens.

## Decision

Snapshot the school's approved attester list (`Vec<Address>`) and threshold (`u32`) directly into the `Voucher` state structure at the exact moment `fund()` is executed.

## Rationale

1. **Funder Certainty:** Funders enter into an immutable agreement with a specific, known set of attesters for that voucher.
2. **Immutability of In-Flight Escrows:** Changes to school attesters apply only to new vouchers created after the update, never altering the rules of open escrows.
3. **Deterministic Verification:** Contract validation checks `voucher.attesters` directly without cross-entry lookups that could be modified.

## Consequences

- Slightly higher storage footprint per voucher on-chain (`attesters` vector stored in voucher entry).
- If all snapshotted attesters become permanently unavailable for an active voucher, the voucher cannot be released and must safely expire and refund to the funder.
