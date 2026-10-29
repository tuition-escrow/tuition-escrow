# Security Policy

Tuition Escrow handles financial remittances and student privacy safeguards. We take vulnerabilities seriously and appreciate the security community's assistance in identifying and disclosing security flaws responsibly.

---

## Reporting a Vulnerability

**Please DO NOT report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

If you discover a potential vulnerability, please report it privately:

1. **Email:** Send your report to `security@tuition-escrow.org`.
2. **Details:** Include a comprehensive explanation of the issue, including:
   - Component affected (contract, API, attester service, indexer, or web dashboard).
   - Clear steps to reproduce the vulnerability (proof-of-concept scripts or transaction hashes are appreciated).
   - Potential impact and threat scenario.
   - Any suggested mitigations or patches.
3. **Response SLA:** We aim to acknowledge receipt of vulnerability reports within **72 hours** with an initial triage assessment.

---

## Coordinated Disclosure Process

1. **Initial Review:** The core engineering team validates the report and determines severity (Critical, High, Medium, Low).
2. **Remediation:** A confidential fix is developed and tested against local and testnet environments.
3. **Release:** Patches are deployed and tagged in a security advisory.
4. **Public Disclosure:** Once downstream operators and attesters have updated their infrastructure, a coordinated public disclosure will be published crediting the researcher (unless anonymity is requested).

---

## Scope

### In-Scope

- **Smart Contracts** (`contracts/`): Soroban contract logic, invariant safety (conservation of funds, single release, fail-closed expiry), state authorization, storage TTL expiration handling.
- **Attester Signing Service** (`apps/attester/`): Key isolation, signature generation, authorization checks, and replay protection.
- **API and Cryptographic Key Management** (`apps/api/`): Ed25519 authentication, salt derivation, KMS/HSM secret handling, role-based access control.
- **Data Privacy & PII Leakage**: Any transmission of unhashed or unsalted student identifiers to the ledger or untrusted endpoints.

### Out-of-Scope

- Vulnerabilities requiring root/physical access to local testing developer machines.
- Denial-of-service attacks on public testnet infrastructure (Stellar Testnet RPC/Horizon).
- Social engineering attacks against maintainers or testnet school accounts.

---

## Bug Bounty Program

A formal bug bounty program with financial rewards will be published before mainnet launch as outlined in the project roadmap (Phase 2).
