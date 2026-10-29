# Attester Playbook: Onboarding, Key Operations, and Security

This playbook establishes the operational and security procedures for independent attesters operating on the Tuition Escrow network.

---

## 1. Overview of the Attester Role

An **attester** is an independent, authorized verifier responsible for confirming that the conditions attached to an escrow voucher (e.g. proof of student enrollment, term registration, fee assessment) have been satisfied before funds are released to a school.

Under the default configuration:

- A school operates with an **$M$-of-$N$ threshold** (recommended: **2-of-3** quorums across school registrar, accredited educational verifier, and platform cross-check).
- Attesters never custody escrowed funds.
- Attesters only sign and submit Soroban `confirm` transactions when verified against independent source-of-truth records.

---

## 2. Onboarding Procedure

### Step 2.1: Identity and Role Verification

1. The prospective attester organization (e.g., district education board, independent auditor, or verification service) must be vetted and authorized by platform administrators.
2. The attester designates a technical operator responsible for key infrastructure.

### Step 2.2: Cryptographic Key Provisioning (KMS / HSM)

Attesters must generate and manage Ed25519 signing keys exclusively using hardware security modules or managed cloud KMS providers:

- **AWS KMS**: Asymmetric signing key pair (`ECC_ED25519`).
- **Google Cloud KMS**: Asymmetric signing key pair (`ED25519_VERIFY`).
- **HashiCorp Vault / HSM**: Transit engine with Ed25519 signing enabled.
- **Strict Rule:** Raw private keys must **never** be exported, written to disk, passed via plaintext environment variables, or committed to source control.

### Step 2.3: Attester Registration

1. Derive the Stellar public key address (`G...`) from the KMS public key.
2. Register the address in the school's configured attester roster via the admin API or smart contract initialization script:
   ```bash
   pnpm --filter @tuition-escrow/api cli register-attester \
     --school <SCHOOL_ID> \
     --address <ATTESTER_PUBLIC_KEY> \
     --name "District Education Auditor"
   ```
3. Fund the attester account with minimum XLM reserves or ensure fee sponsorship is configured via the relayer service.

---

## 3. Key Handling and Security Standards

1. **Access Control:** IAM policies must restrict KMS `crypto:sign` permissions strictly to the automated attester service execution role or designated operators.
2. **Key Rotation:**
   - Operational keys should be rotated annually or upon employee departure.
   - Key rotation generates a new public key `G_new` and updates the school's attester set. Pre-existing vouchers remain protected due to threshold snapshots.
3. **Auditability:** Enable AWS CloudTrail, GCP Cloud Audit Logs, or Vault audit logging on all signing operations.

---

## 4. Verification Procedure

When a confirmation request is received (via webhook, message queue, or automated polling):

### Step 4.1: Fetch On-Chain State

Query the voucher state from Soroban RPC or the local verified indexer:

- Check that status is `Funded`.
- Confirm current ledger timestamp is well before `expiry`.
- Confirm the attester's public key is present in the voucher's snapshotted `attesters` vector.
- Confirm the attester has not already confirmed the voucher (`confirmations` bitmask / address list).

### Step 4.2: Verify Off-Chain Proof

The attester service queries the school's record system:

1. Fetch the student's salted reference hash from the school verification endpoint using the authorized integration key:
   $$\text{student\_ref} = \text{SHA-256}(\text{salt} \parallel \text{student\_id})$$
2. Compare the derived `student_ref` and `category` code against the voucher record.
3. Confirm that the student is active, in good standing, and enrolled for the academic period corresponding to the voucher.

### Step 4.3: Submit Confirmation

If and only if all checks pass:

1. Construct the Soroban invocation: `voucher.confirm(caller: attester_address, voucher_id: id)`.
2. Sign the transaction envelope inside the KMS / HSM.
3. Submit the transaction to Stellar RPC via the relayer / sponsored fee queue.
4. Record the confirmation outcome, timestamp, and transaction hash in the tamper-evident audit log.

If verification fails or data does not match:

- Log the discrepancy as a security alert.
- Do not sign. Allow voucher to fail closed towards funder reclamation upon expiry.

---

## 5. Emergency Revocation Procedure

In the event of key compromise, suspected credential exposure, or service termination:

1. **Immediate Revocation Alert:**
   Notify the platform security team at `security@tuition-escrow.org` with subject `[EMERGENCY] Attester Key Revocation: <ATTESTER_ADDRESS>`.
2. **Remove from School Set:**
   The school admin immediately submits an update transaction or API call removing the compromised public key from the school's active attester roster.
3. **In-Flight Voucher Protection:**
   Because vouchers require an $M$-of-$N$ threshold (e.g. 2-of-3), a single compromised attester cannot unilaterally release funds or divert payouts.
4. **Decommission KMS Key:**
   Schedule the compromised KMS key for immediate deletion or disable signing permissions in the cloud provider IAM console.
