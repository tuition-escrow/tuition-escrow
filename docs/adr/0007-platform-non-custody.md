# ADR 7: Platform Non-Custody Architecture

- **Status:** Accepted
- **Deciders:** Tuition Escrow Core Architecture
- **Date:** 2026-10-14

## Context

Operating a custodial escrow or remittance platform triggers extensive money transmitter, payment institution, and custodial licensing regimes across jurisdictions, introduces massive honeypot risks, and creates counterparty risk for funders and schools.

## Decision

Design the platform to be strictly non-custodial. Neither platform servers, operators, nor admin accounts hold or custody escrowed funds at any time.

## Rationale

1. **Direct Smart Contract Escrow:** Tokens are transferred directly from the funder's Stellar account into the Soroban contract, and transferred directly from the contract to the school upon release, or back to the funder upon reclaim or cancel.
2. **Narrow Admin Powers:** Contract admin keys have no administrative function to withdraw escrowed tokens or redirect payees to arbitrary addresses.
3. **No Key Storage on API:** The API server, databases, and background workers hold no private signing keys capable of transferring tokens.
4. **Regulatory Clarity:** Clear non-custodial boundaries protect users and ensure the platform acts as software infrastructure rather than a financial custodian.

## Consequences

- Users interact with the smart contract using non-custodial wallets (e.g., Freighter, LOBSTR, xBull) with fee-bump sponsorships where needed.
- If a user loses their wallet keys, the platform cannot recover their funds; recovery is governed strictly by the smart contract's expiry and mutual cancellation mechanisms.
