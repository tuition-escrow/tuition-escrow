# Data Protection

**README section:** Privacy model  
**Last updated:** 2026-10-26  
**Applies to:** `student_mappings` table and all off-chain student data

Students are frequently minors. This document records the purpose, legal
basis, retention limits, deletion procedure, and access controls for the
only table that may hold a student identifier.

---

## What is stored and why

| Field | Content | Purpose |
|---|---|---|
| `encrypted_student_identifier` | AES-256-GCM ciphertext of the school's internal student ID | Allows the school to map a voucher back to a student off-chain |
| `encrypted_salt` | AES-256-GCM ciphertext of the per-voucher random salt | Allows recomputation of `student_ref` for verification |
| `key_id` | KMS key reference | Identifies the data key used; needed for decryption |
| `retain_until` | Timestamp | Drives the retention sweep job |
| `deleted_at` | Timestamp | Marks records where plaintext has been deleted |

**No other table may hold any student identifier, name, date of birth,
grade, health data, or free-text memo.** This is enforced by schema
(no such columns exist anywhere) and by code review policy.

---

## Legal basis and purpose limitation

- Data is processed solely to enable the school to identify which student a
  voucher relates to, and to allow recomputation of `student_ref` if needed.
- No secondary use (analytics, profiling, sharing with third parties) is
  permitted.
- Applicable laws: GDPR (EU), NDPR (Nigeria), COPPA (US minors), and any
  jurisdiction-specific education-data regulations in launch markets.
- Before going live in any jurisdiction, obtain legal advice on the applicable
  legal basis (likely: contract performance or legitimate interest with strict
  necessity test).

---

## Retention

| Event | Retention period |
|---|---|
| Voucher released or reclaimed | 90 days after terminal status (configurable) |
| Voucher cancelled | 30 days after cancellation |
| School requests deletion | Immediate (subject to any legal hold) |
| Maximum absolute retention | 7 years (adjust per jurisdiction) |

`retain_until` is set at voucher creation time based on the above rules.

A scheduled job (`apps/api` retention sweep, run daily) queries:

```sql
SELECT id FROM student_mappings
WHERE retain_until < now()
  AND deleted_at IS NULL;
```

For each result it calls `StudentMappingService.deleteMapping()`, which:

1. Overwrites `encrypted_student_identifier` and `encrypted_salt` with empty strings.
2. Sets `deleted_at = now()`.
3. Writes an `audit_log` entry (`student_mapping.deleted`).

The KMS data key is NOT destroyed automatically — KMS key rotation policy
governs that separately.

---

## Deletion procedure (manual / on request)

1. Identify the `student_mappings.id` for the affected voucher(s).
2. Call `StudentMappingService.deleteMapping(mappingId, actorId)`.
3. Verify `deleted_at` is set in the database.
4. Record the deletion in the audit log (automatic).
5. Confirm with the requester.

Note: the `student_ref` hash on-chain is **immutable** — it cannot be
deleted. Because it is a salted hash with a per-voucher random salt, it
is computationally unlinkable to the student identifier once the salt is
deleted. This is the primary reason for per-voucher salts.

---

## Access controls

| Role | Access |
|---|---|
| `school_admin` | May call `GET /schools/:id/vouchers/:voucherId/mapping` for their own school's vouchers only |
| `platform_admin` | May trigger retention deletion; may NOT read decrypted identifiers |
| `funder` | No access to mappings |
| API process | Read/write via parameterised queries only; no raw SQL access |
| Direct DB access | Restricted to DBA role with MFA; all access logged |

Every `getMappingForSchool` call writes an `audit_log` entry with:
- `event_type: 'student_mapping.accessed'`
- `actor_id`: the requesting user's UUID
- `resource`: `student_mapping:<id>`
- `detail`: `{ voucherId }`

The decrypted identifier and salt are **never written to any log**.
This is tested in `apps/api/src/__tests__/privacy.test.ts`.

---

## On-chain immutability note

`student_ref` (the salted hash) is stored permanently on the Stellar ledger.
It cannot be deleted. Legal advice must confirm that:

1. Publishing a salted SHA-256 hash of a student identifier constitutes
   processing of personal data under applicable law.
2. The per-voucher salt strategy is sufficient to prevent re-identification
   after salt deletion.
3. Any right-to-erasure obligation can be satisfied by salt deletion alone,
   given the hash remains on-chain.

Until legal confirmation is obtained, treat `student_ref` as personal data.

---

## Encryption key management

- Data keys are AES-256 random keys generated per encryption call.
- Data keys are wrapped (encrypted) by a KMS master key (`key_id`).
- In production, `KMS_PROVIDER` must be `aws` or `gcp` — never `local`.
- Key rotation: rotate the KMS master key annually or on suspected compromise.
  Re-encryption of existing records is required after rotation.
- Key compromise response: see `docs/attester-playbook.md` pattern for
  emergency key revocation; apply the same process to the KMS key.
