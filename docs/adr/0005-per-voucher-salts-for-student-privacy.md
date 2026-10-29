# ADR 5: Per-Voucher Random Salts for Student Privacy

- **Status:** Accepted
- **Deciders:** Tuition Escrow Core Architecture
- **Date:** 2026-10-14

## Context

On-chain data is globally visible and permanent. Students are frequently minors. Placing raw student identifiers, student names, or even static hashes on-chain violates privacy principles and legal frameworks (such as GDPR, NDPR, COPPA).
A static hash of a student identifier (such as `SHA-256(student_id)`) allows dictionary attacks, rainbow table precomputation, and cross-voucher linkage of a student's entire educational history.

## Decision

Compute `student_ref` as `SHA-256(salt || student_identifier)` using a fresh, cryptographically random 32-byte salt generated per voucher. The salt is stored off-chain in Postgres using envelope encryption with KMS-managed keys.

## Rationale

1. **Unlinkability:** Two vouchers funded for the exact same student produce completely distinct, uncorrelated 32-byte hashes on-chain.
2. **Dictionary & Rainbow Table Protection:** 256 bits of high-entropy random salt prevent brute-force identification of known student ID numbering formats.
3. **Right to Be Forgotten / Data Retention:** When off-chain data retention expires or deletion is requested, deleting the salt permanently and mathematically severs any link between the on-chain reference and the student's identity.

## Consequences

- The API and database must securely store the mapping `{voucher_id, student_identifier, salt}` off-chain.
- The school must query the authenticated API endpoint to decrypt and map the voucher to their student records.
