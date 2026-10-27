---
status: draft
last-reviewed: 2026-10-27
---

# Runbook: Attester Key Compromise

## Overview

This runbook covers the response to a suspected or confirmed compromise of
an attester signing key.

---

## Detection

- Unusual volume of `confirm` transactions from the attester address.
- Attestations for vouchers that have no corresponding manual review decision.
- `AttesterConfirmErrors` or `AttesterUnusualApprovalRate` alert fires.
- KMS audit trail shows unexpected key usage.

---

## Immediate response

1. **Revoke the attester address** from all affected school registrations.
   - Call `register_school(school, new_attesters_without_compromised, threshold)`
     from the admin key to update the school's attester set.
   - The compromised address can no longer contribute attestations.

2. **Freeze new attestations** from the attester service by setting
   `ATTESTER_REVOKED=true` in the service configuration and restarting.

3. **Disable the KMS key** for the compromised attester in your KMS console.
   - AWS KMS: `aws kms disable-key --key-id <ATTESTER_KMS_KEY_ID>`
   - GCP KMS: `gcloud kms keys versions disable ...`

4. **Assess impact**: review the attester audit log (`GET /audit/verify`) to
   identify any false attestations. Any `Released` voucher cannot be reversed
   by the contract; escalate to legal/operations for off-chain resolution.

---

## Recovery

1. Generate a new attester key in KMS.
2. Derive the new Stellar address from the public key.
3. Update `ATTESTER_ADDRESS` and `ATTESTER_KMS_KEY_ID` in the attester service.
4. Call `register_school` to add the new address.
5. Restart the attester service.
6. Verify the new address appears in `get_voucher` attester sets.

---

## Post-incident

- Write an incident report.
- Review whether threshold was sufficient (consider raising M-of-N).
- Rotate any other keys that may have been exposed in the same environment.
