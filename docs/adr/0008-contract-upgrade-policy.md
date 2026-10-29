# ADR 8: Smart Contract Upgrade Policy

- **Status:** Undecided (see README section "Contract upgrades")
- **Deciders:** Tuition Escrow Core Architecture
- **Date:** 2026-10-14

## Context

Soroban smart contracts can be deployed as immutable code or equipped with an upgrade mechanism to replace contract WASM code in place. Choosing an upgrade strategy involves fundamental trade-offs between trust guarantees and bug patchability.

## Decision Status

**Undecided.** As noted in `README.md` (section _Contract upgrades_), this decision is explicitly deferred until pilot scoping and external security audits are conducted. Below are the options and trade-offs under consideration:

### Option A: Fully Immutable Contract

- **Description:** No upgrade entry point is included in the contract code. The contract code bytecode cannot be altered once deployed.
- **Trade-offs:**
  - _Pros:_ Maximum trust guarantee for funders and schools. Guarantees that neither admins nor compromised keys can alter escrow rules or logic.
  - _Cons:_ Logic bugs or vulnerabilities cannot be patched in place. Any bug fix requires deploying a new contract and migrating new activity, leaving existing vouchers on the older contract.

### Option B: Upgradeable behind Multi-Sig and Time-Lock

- **Description:** An administrative upgrade mechanism (`upgrade(new_wasm_hash)`) controlled by a multi-sig threshold of keys with a mandatory on-chain time-lock delay.
- **Trade-offs:**
  - _Pros:_ Allows patching zero-day security vulnerabilities or adapting to Stellar protocol upgrades without stranding open vouchers.
  - _Cons:_ Introduces governance and admin key risk. Funders and schools must trust the upgrade signers. Requires strict policy prohibiting upgrades that alter existing voucher rules.

### Option C: Migration-Based Versioning (Conservative v1)

- **Description:** Deploy a conservative, volume-capped v1 contract. If improvements or fixes are required, deploy v2 for new vouchers, allowing open v1 vouchers to settle or expire naturally.
- **Trade-offs:**
  - _Pros:_ Balances immutability of active funds with software evolution.
  - _Cons:_ Off-chain services (indexer, API, frontend) must support multiple contract versions simultaneously during transition periods.

## Next Steps

Before any mainnet deployment, formalize the upgrade policy based on the completed external contract audit and legal review findings.
