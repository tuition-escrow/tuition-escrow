/**
 * Attester core flow.
 *
 * README section: "Attester service responsibilities"
 *   "For a voucher, check on-chain that it is Funded and not expired,
 *    verify the condition via the provider, then sign and submit `confirm`
 *    ONLY on success. Attest nothing else."
 *
 * The chain of custody:
 *   1. Caller provides voucherId + schoolRecordsContext.
 *   2. Check on-chain: Funded, not expired, attester in set.
 *   3. Verify condition via VerificationProvider.
 *   4. On success: build confirm() transaction, sign via Signer, submit.
 *   5. Log every decision (including rejections) to the tamper-evident audit log.
 *
 * Privacy: this module never receives or emits student identifiers, names,
 * or any personal data.  It only handles voucher IDs and addresses.
 *
 * The attester ONLY calls confirm().  It cannot call fund, reclaim, cancel,
 * or any admin function.
 */

import { logger } from './logger';
import type { VerificationProvider, SchoolRecordsContext } from './verification';
import type { Signer } from './signer';
import type { ChainChecker } from './chain';
import { isAttesterAuthorized } from './chain';
import type { Pool } from 'pg';
import { appendAuditEntry, ensureAuditTable } from './audit';

export interface AttestationResult {
  success: boolean;
  reason: string;
  txHash?: string;
}

export class AttesterService {
  constructor(
    private readonly pool: Pool,
    private readonly verifier: VerificationProvider,
    private readonly signer: Signer,
    private readonly checker: ChainChecker,
  ) {}

  async initialize(): Promise<void> {
    await ensureAuditTable(this.pool);
    logger.info({ attesterAddress: this.signer.address }, 'AttesterService initialized');
  }

  /**
   * Attempt to attest a voucher.
   *
   * Returns AttestationResult with success=true only if all checks pass
   * and the confirm transaction was submitted.
   *
   * Fail-closed: any error → reject + audit + return { success: false }.
   */
  async attest(
    voucherId: bigint,
    context: SchoolRecordsContext,
    requestedByUserId: string,
  ): Promise<AttestationResult> {
    logger.info(
      { voucherId: voucherId.toString(), requestedByUserId },
      'Attestation requested',
    );

    // ── Step 1: Authorization check ────────────────────────────────────────
    const authCheck = await isAttesterAuthorized(
      this.checker,
      voucherId,
      this.signer.address,
    ).catch((err) => {
      logger.error({ err, voucherId: voucherId.toString() }, 'Chain check error');
      return { authorized: false, reason: 'Chain check error', voucher: null };
    });

    if (!authCheck.authorized) {
      await appendAuditEntry(this.pool, {
        voucherId: voucherId.toString(),
        decision: 'skipped',
        reason: authCheck.reason,
        attesterAddress: this.signer.address,
      }).catch((e) => logger.error({ e }, 'Failed to write audit entry'));

      logger.warn(
        { voucherId: voucherId.toString(), reason: authCheck.reason },
        'Attestation skipped: not authorized',
      );

      return { success: false, reason: authCheck.reason };
    }

    // ── Step 2: Condition verification ─────────────────────────────────────
    let verificationResult;
    try {
      verificationResult = await this.verifier.verify(voucherId, context);
    } catch (err) {
      const reason = `Verification error: ${String(err)}`;
      await appendAuditEntry(this.pool, {
        voucherId: voucherId.toString(),
        decision: 'error',
        reason,
        attesterAddress: this.signer.address,
      }).catch((e) => logger.error({ e }, 'Failed to write audit entry'));

      logger.error({ voucherId: voucherId.toString(), err }, 'Verification threw error');
      return { success: false, reason };
    }

    if (!verificationResult.ok) {
      await appendAuditEntry(this.pool, {
        voucherId: voucherId.toString(),
        decision: 'rejected',
        reason: verificationResult.reason,
        attesterAddress: this.signer.address,
      }).catch((e) => logger.error({ e }, 'Failed to write audit entry'));

      logger.info(
        { voucherId: voucherId.toString(), reason: verificationResult.reason },
        'Attestation rejected by verification provider',
      );

      return { success: false, reason: verificationResult.reason };
    }

    // ── Step 3: Build + sign + submit confirm() ────────────────────────────
    let txHash: string;
    try {
      txHash = await this.buildAndSubmitConfirm(voucherId);
    } catch (err) {
      const reason = `Confirm submission failed: ${String(err)}`;
      await appendAuditEntry(this.pool, {
        voucherId: voucherId.toString(),
        decision: 'error',
        reason,
        attesterAddress: this.signer.address,
      }).catch((e) => logger.error({ e }, 'Failed to write audit entry'));

      logger.error({ voucherId: voucherId.toString(), err }, 'Confirm submission error');
      return { success: false, reason };
    }

    // ── Step 4: Audit success ──────────────────────────────────────────────
    await appendAuditEntry(this.pool, {
      voucherId: voucherId.toString(),
      decision: 'approved',
      reason: verificationResult.reason,
      attesterAddress: this.signer.address,
    }).catch((e) => logger.error({ e }, 'Failed to write audit entry'));

    logger.info(
      { voucherId: voucherId.toString(), txHash },
      'Attestation submitted successfully',
    );

    return { success: true, reason: verificationResult.reason, txHash };
  }

  /**
   * Build a confirm() transaction, sign via the Signer, and submit.
   *
   * TODO: replace stub with real @stellar/stellar-sdk transaction building.
   * Steps:
   *   1. Build a Soroban transaction calling confirm(voucherId, attesterAddress).
   *   2. Simulate to get resource fees.
   *   3. Sign via this.signer.sign(txXdr).
   *   4. Submit via sendTransaction RPC.
   *   5. Return the transaction hash.
   *
   * Reference: https://developers.stellar.org/docs/data/rpc/api-reference/methods/sendTransaction
   */
  private async buildAndSubmitConfirm(voucherId: bigint): Promise<string> {
    logger.info(
      { voucherId: voucherId.toString(), attesterAddress: this.signer.address },
      'buildAndSubmitConfirm: stub — implement with contract-bindings',
    );

    // Stub: build placeholder XDR, sign it (also a stub), return fake hash.
    const stubXdr = `confirm:${voucherId}:${this.signer.address}`;
    const signedXdr = await this.signer.sign(stubXdr);

    // In production: submit signedXdr via RPC and return the real tx hash.
    const stubHash = `stub_tx_${voucherId}_${Date.now()}`;
    logger.info({ stubHash, signedXdr: signedXdr.slice(0, 20) }, 'Confirm stub submitted');
    return stubHash;
  }
}
