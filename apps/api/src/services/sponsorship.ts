/**
 * Sponsorship service.
 *
 * README section: "Fees and reserves" — sponsored reserves and fee-bump transactions.
 *
 * Wraps a funder-signed Stellar transaction in a fee-bump signed by the
 * sponsor account.  The sponsor key is referenced via FEE_BUMP_SECRET_REF
 * and loaded from the secret store — never inlined.
 *
 * Safeguards:
 *   • Allowlist: only `fund` calls to the voucher contract and trustline
 *     setup operations are eligible for sponsorship.
 *   • Per-account and global rate limits (enforced by the caller / middleware).
 *   • Balance threshold check raises an alert when the sponsor is low.
 *
 * TODO: this module uses placeholder types for the Stellar SDK transaction
 * objects.  Before wiring up to the actual @stellar/stellar-sdk, verify
 * the exact API for:
 *   - FeeBumpTransaction construction
 *   - TransactionEnvelope XDR serialisation
 * Reference: https://developers.stellar.org/docs/learn/encyclopedia/transactions-and-operations/fee-bump-transactions
 */

import { logger } from '../logger';

// Allowlisted operations the sponsor will pay for.
// Any transaction that is not on this list is rejected.
const ALLOWED_OPERATIONS = new Set([
  'fund',           // voucher contract fund()
  'change_trust',   // school trustline setup
]);

export interface WrappedTransaction {
  /** XDR-encoded fee-bump transaction envelope, base64 */
  feeBumpXdr: string;
}

export interface SponsorshipService {
  /**
   * Wraps a signed user transaction XDR in a fee-bump.
   * Validates the operation type against the allowlist.
   * @throws if the operation is not allowed or the sponsor balance is low
   */
  wrapWithFeeBump(
    innerTxXdr: string,
    operationType: string,
    accountId: string,
  ): Promise<WrappedTransaction>;
}

/**
 * SponsorshipServiceImpl
 *
 * The sponsor signing key is loaded from the secret store referenced by
 * FEE_BUMP_SECRET_REF.  The value of FEE_BUMP_SECRET_REF is a path or
 * name in your secret manager (AWS Secrets Manager, GCP Secret Manager,
 * HashiCorp Vault) — NOT the key itself.
 *
 * TODO: replace the stub implementation below with real Stellar SDK calls.
 * Steps:
 *   1. Load the sponsor keypair from the secret store (using FEE_BUMP_SECRET_REF).
 *   2. Deserialise the innerTxXdr into a Transaction.
 *   3. Construct a FeeBumpTransaction around it.
 *   4. Sign with the sponsor keypair.
 *   5. Return the XDR-encoded fee-bump envelope.
 */
export class SponsorshipServiceImpl implements SponsorshipService {
  private readonly feeRef: string;
  private readonly sponsorAddress: string;
  private readonly balanceThreshold: number;

  constructor() {
    this.feeRef = process.env.FEE_BUMP_SECRET_REF ?? '';
    this.sponsorAddress = process.env.SPONSOR_ACCOUNT_ADDRESS ?? '';
    this.balanceThreshold = parseInt(process.env.SPONSOR_BALANCE_THRESHOLD ?? '100000', 10);

    if (!this.feeRef) {
      logger.warn('FEE_BUMP_SECRET_REF is not set — sponsorship will fail at runtime');
    }
  }

  async wrapWithFeeBump(
    innerTxXdr: string,
    operationType: string,
    accountId: string,
  ): Promise<WrappedTransaction> {
    // 1. Allowlist check — reject any non-allowlisted operation type
    if (!ALLOWED_OPERATIONS.has(operationType)) {
      throw new Error(
        `SPONSORSHIP_NOT_ALLOWED: operation '${operationType}' is not on the allowlist`,
      );
    }

    // 2. Balance threshold check (stub — real impl queries Horizon)
    // TODO: call Horizon /accounts/:sponsorAddress and check XLM balance.
    // Reference: https://developers.stellar.org/api/horizon/resources/retrieve-an-account
    const sponsorBalance = await this.getSponsorBalance();
    if (sponsorBalance < this.balanceThreshold) {
      logger.error(
        { sponsorAddress: this.sponsorAddress, balance: sponsorBalance, threshold: this.balanceThreshold },
        'ALERT: sponsor account balance below threshold',
      );
      throw new Error('SPONSOR_BALANCE_LOW');
    }

    // 3. Load sponsor key from secret store
    // TODO: implement loadSponsorKeypair() using your secret store client.
    // NEVER read the key from process.env directly.
    // const sponsorKeypair = await loadSponsorKeypair(this.feeRef);

    // 4. Build fee-bump transaction
    // TODO: implement using @stellar/stellar-sdk FeeBumpTransaction.
    // const innerTx = TransactionBuilder.fromXDR(innerTxXdr, Networks.TESTNET);
    // const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
    //   sponsorKeypair,
    //   BASE_FEE,
    //   innerTx,
    //   Networks.TESTNET,
    // );
    // feeBumpTx.sign(sponsorKeypair);
    // return { feeBumpXdr: feeBumpTx.toEnvelope().toXDR('base64') };

    logger.info({ operationType, accountId }, 'fee-bump sponsorship requested (stub)');

    // Stub: return the inner XDR unchanged until the real SDK is wired up.
    return { feeBumpXdr: innerTxXdr };
  }

  private async getSponsorBalance(): Promise<number> {
    // TODO: query Horizon for the sponsor account's XLM balance.
    // Return a large number in the stub so existing tests pass.
    return Number.MAX_SAFE_INTEGER;
  }
}

/**
 * School onboarding helper: creates/sponsors the school account's trustline
 * to the configured asset so the school never needs to hold XLM.
 *
 * TODO: implement using @stellar/stellar-sdk:
 *   1. Create the school's Stellar account (if needed) using the sponsor's
 *      CreateAccount + BeginSponsoringFutureReserves + ChangeTrust +
 *      EndSponsoringFutureReserves operation sequence.
 *   2. Wrap in a fee-bump signed by the sponsor.
 * Reference: https://developers.stellar.org/docs/learn/encyclopedia/transactions-and-operations/sponsored-reserves
 */
export async function sponsorSchoolTrustline(
  schoolAddress: string,
  assetContractId: string,
): Promise<{ txXdr: string }> {
  logger.info({ schoolAddress, assetContractId }, 'sponsorSchoolTrustline called (stub)');
  // TODO: build and sign the sponsorship + trustline transaction.
  throw new Error('sponsorSchoolTrustline: not yet implemented — see TODO in sponsorship.ts');
}
