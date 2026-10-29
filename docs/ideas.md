# Out-of-Scope Ideas & Proposals

This document tracks proposals, exploratory concepts, and extensions that have been considered but are currently **out of scope** for the core v0.1.x Tuition Escrow architecture.

---

## 1. Staked Attesters and Slashing Protocols

- **Concept:** Requiring independent attesters to post economic collateral (stake) on-chain that is subject to programmatic slashing if an attestation is proven fraudulent.
- **Why Out of Scope:** Introduces significant game-theoretic and protocol complexity (e.g. who judges fraud, dispute time-locks, griefing attack vectors). The current $M$-of-$N$ threshold model and institutional vetting provide adequate trust guarantees for initial deployment phases.

---

## 2. Milestone and Installment Escrow Schedules

- **Concept:** Splitting a single voucher into multi-tranche disbursements based on mid-term attendance checkpoints or quarterly academic milestones.
- **Why Out of Scope:** Vouchers in v0.1.x are atomic, single-release instruments to keep smart contract invariants verifiable and transaction costs minimal. Multi-term support can be modeled by creating discrete vouchers per term.

---

## 3. Pooled Scholarship and DAOs

- **Concept:** Permitting an organization or donor pool to deposit into a generalized escrow fund that programmatically issues vouchers to dynamic cohorts of students.
- **Why Out of Scope:** Out of scope for early releases; requires complex allocation governance, fund accounting, and multi-tenant ledger state. The platform currently supports individual sponsor vouchers.

---

## 4. Student QR Code Redemption & Zero-Knowledge Attestations

- **Concept:** Students redeeming vouchers via mobile QR scans at school cashier desks or presenting Zero-Knowledge Proofs (ZKPs) of enrollment directly to Soroban contracts.
- **Why Out of Scope:** Introduces unnecessary end-user technical friction, specialized cryptographic circuits, and client key custody burdens for students and families. The current architecture places the attestation responsibility on trusted verifiers off-chain.

---

## 5. Secondary Markets or Voucher Transfers

- **Concept:** Allowing vouchers to be transferred, sold, or borrowed against.
- **Why Out of Scope:** Vouchers are strictly non-transferable purpose-bound remittance escrows. Secondary trading violates educational intent, funder intent, and regulatory compliance.
