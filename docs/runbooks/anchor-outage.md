---
status: draft
last-reviewed: 2026-10-27
---

# Runbook: Anchor Outage

## Overview

If a Stellar anchor (used for funder on-ramp or school off-ramp) is unavailable,
funds in escrow are unaffected — they remain locked in the contract. This
runbook covers communication and recovery steps.

---

## Impact assessment

| Scenario | Impact |
|---|---|
| Funder on-ramp anchor down | Funders cannot deposit fiat to get stablecoin. Existing funded vouchers are unaffected. |
| School off-ramp anchor down | Schools cannot withdraw to local currency. Stablecoin remains in the school's Stellar account. |
| Both down | No new fundings possible; existing vouchers proceed normally. |

---

## Monitoring

- Watch the anchor's status page (bookmark it during onboarding).
- Monitor `anchor_withdrawal_errors_total` if the off-ramp is instrumented.
- Schools may report inability to withdraw — treat as anchor outage until confirmed.

---

## Response

1. **Confirm the outage**: check the anchor's status page and support channels.

2. **Notify affected users**:
   - Funders: note that deposits are temporarily unavailable; existing vouchers are safe.
   - Schools: note that withdrawals are temporarily unavailable; funds are safe in their account.

3. **No contract intervention required**: the escrow contract is unaffected by
   anchor availability. Do not pause, freeze, or modify the contract.

4. **For schools with urgent withdrawal needs**: advise them that the
   stablecoin is in their Stellar account and they may use a different anchor
   or DEX to convert it, subject to their own KYC/AML obligations.

5. **When the anchor recovers**: normal operations resume automatically.
   No action is needed on the contract or indexer.

---

## Longer outages

If the anchor is down for more than 72 hours:
- Consider whether funders should be advised to delay new vouchers.
- Assess whether an alternative anchor is available for the affected corridor.
- Update the platform status page.
