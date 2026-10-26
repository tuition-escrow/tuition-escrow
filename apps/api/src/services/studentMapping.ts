/**
 * Student mapping service.
 *
 * README section: "Privacy model: How the mapping works"
 *
 * Responsibilities:
 *   1. Generate a per-voucher random salt.
 *   2. Compute student_ref = SHA-256(salt || studentIdentifier).
 *   3. Envelope-encrypt both salt and identifier with KMS.
 *   4. Store the encrypted mapping in student_mappings.
 *   5. Return student_ref for the on-chain fund call.
 *   6. Allow the owning school to retrieve the decrypted mapping.
 *
 * Privacy invariants enforced here:
 *   • The raw salt and identifier are NEVER logged.
 *   • student_ref is NEVER paired with identifying information in logs.
 *   • The decrypted mapping is only accessible to the owning school.
 */

import { Pool } from 'pg';
import { generateSalt, computeStudentRef } from '@tuition-escrow/shared';
import { KmsAdapter } from '../kms/kms';
import { auditLog } from './audit';
import { logger } from '../logger';

export interface PreparedVoucherMapping {
  /** Hex-encoded SHA-256 hash — safe to put on-chain */
  studentRef: string;
  /** Internal mapping ID for later retrieval */
  mappingId: string;
}

export interface DecryptedMapping {
  studentIdentifier: string;
  salt: string;
}

export class StudentMappingService {
  constructor(
    private readonly pool: Pool,
    private readonly kms: KmsAdapter,
    private readonly kmsKeyId: string,
  ) {}

  /**
   * Creates an encrypted student mapping record and returns the on-chain
   * student_ref.  Called during POST /vouchers/prepare.
   *
   * The voucher_id is stored as a placeholder (0) until the on-chain fund
   * call completes; it is updated by confirmVoucherFunded().
   */
  async prepareMapping(
    studentIdentifier: string,
    actorId: string,
  ): Promise<PreparedVoucherMapping> {
    const salt = generateSalt();
    const studentRef = computeStudentRef(salt, studentIdentifier);

    // Encrypt both values independently so a single decrypt call cannot
    // expose both at once without two KMS calls.
    const encryptedIdentifier = await this.kms.encrypt(this.kmsKeyId, studentIdentifier);
    const encryptedSalt = await this.kms.encrypt(this.kmsKeyId, salt);

    // Insert with voucher_id = NULL (will be set after on-chain fund).
    // IMPORTANT: never log studentRef alongside identifier or salt.
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO student_mappings
         (encrypted_student_identifier, encrypted_salt, key_id)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [encryptedIdentifier, encryptedSalt, this.kmsKeyId],
    );

    const mappingId = rows[0].id;

    // Audit: log the event without the identifier or student_ref.
    await auditLog(this.pool, {
      eventType: 'student_mapping.prepared',
      actorId,
      resource: `student_mapping:${mappingId}`,
      detail: { keyId: this.kmsKeyId },
    });

    // Do NOT log studentRef or identifier here.
    logger.info({ mappingId, keyId: this.kmsKeyId }, 'student mapping prepared');

    return { studentRef, mappingId };
  }

  /**
   * Links the mapping to the on-chain voucher ID after fund() succeeds.
   */
  async confirmVoucherFunded(
    mappingId: string,
    voucherId: number,
    actorId: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE student_mappings SET voucher_id = $1 WHERE id = $2`,
      [voucherId, mappingId],
    );
    await auditLog(this.pool, {
      eventType: 'student_mapping.linked',
      actorId,
      resource: `student_mapping:${mappingId}`,
      detail: { voucherId },
    });
  }

  /**
   * Returns the decrypted mapping for a school_admin.
   * Access is logged. The caller MUST have already verified that the
   * requesting user is a school_admin for the school that owns this voucher.
   */
  async getMappingForSchool(
    voucherId: number,
    requestingUserId: string,
  ): Promise<DecryptedMapping> {
    const { rows } = await this.pool.query<{
      id: string;
      encrypted_student_identifier: string;
      encrypted_salt: string;
      key_id: string;
      deleted_at: Date | null;
    }>(
      `SELECT id, encrypted_student_identifier, encrypted_salt, key_id, deleted_at
       FROM student_mappings
       WHERE voucher_id = $1`,
      [voucherId],
    );

    if (rows.length === 0) {
      throw new Error('MAPPING_NOT_FOUND');
    }
    const row = rows[0];

    if (row.deleted_at !== null) {
      throw new Error('MAPPING_DELETED');
    }

    const studentIdentifier = await this.kms.decrypt(row.key_id, row.encrypted_student_identifier);
    const salt = await this.kms.decrypt(row.key_id, row.encrypted_salt);

    // Audit the access — log only the mapping ID, never the decrypted values.
    await auditLog(this.pool, {
      eventType: 'student_mapping.accessed',
      actorId: requestingUserId,
      resource: `student_mapping:${row.id}`,
      detail: { voucherId },
    });

    // Do NOT log studentIdentifier or salt.
    logger.info(
      { mappingId: row.id, requestingUserId },
      'student mapping accessed by school admin',
    );

    return { studentIdentifier, salt };
  }

  /**
   * Soft-delete (retention deletion): zeroes encrypted fields and marks
   * deleted_at.  Called by the retention job (docs/data-protection.md).
   */
  async deleteMapping(mappingId: string, actorId: string): Promise<void> {
    await this.pool.query(
      `UPDATE student_mappings
       SET encrypted_student_identifier = '',
           encrypted_salt = '',
           deleted_at = now()
       WHERE id = $1 AND deleted_at IS NULL`,
      [mappingId],
    );
    await auditLog(this.pool, {
      eventType: 'student_mapping.deleted',
      actorId,
      resource: `student_mapping:${mappingId}`,
      detail: {},
    });
    logger.info({ mappingId }, 'student mapping deleted (retention)');
  }
}
