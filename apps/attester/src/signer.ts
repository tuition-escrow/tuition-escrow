/**
 * Signer interface and implementations.
 *
 * README section: "Attester service responsibilities"
 *   "Hold keys in a KMS or HSM, never in environment files or source control."
 *   "Support emergency revocation of an attester address."
 *
 * Implementations:
 *   LocalDevSigner   — ⚠️ testnet only, key from env. NOT for production.
 *   AwsKmsSigner     — stub; replace before production.
 *   GcpKmsSigner     — stub; replace before production.
 *
 * The Signer produces a signed Stellar transaction XDR.  It never loads
 * a key into plain memory in non-dev modes.
 *
 * NOTE: We do NOT use @stellar/stellar-sdk here because the SDK version
 * is not yet pinned.  Transaction building is stub-only.  Replace with
 * the real SDK before production.
 * Reference: https://developers.stellar.org/docs/build/apps/wallet/stellar-expert
 */

import { logger } from './logger';

// ─── Interface ────────────────────────────────────────────────────────────

export interface Signer {
  /**
   * Signs a pre-built transaction XDR and returns the signed XDR.
   * The caller constructs the transaction; the Signer only signs.
   */
  sign(txXdr: string): Promise<string>;

  /** The Stellar address corresponding to this signer's key. */
  readonly address: string;
}

// ─── LocalDevSigner ───────────────────────────────────────────────────────

/**
 * LocalDevSigner — ⚠️  NOT FOR PRODUCTION.
 *
 * Reads the attester secret key from ATTESTER_SECRET environment variable.
 * Only allowed when STELLAR_NETWORK=local or testnet.
 *
 * TODO: replace sign() with real @stellar/stellar-sdk Keypair.sign() once
 * the SDK is pinned.
 */
export class LocalDevSigner implements Signer {
  readonly address: string;
  private readonly secret: string;

  constructor() {
    const network = process.env.STELLAR_NETWORK ?? 'testnet';
    if (network === 'mainnet') {
      throw new Error(
        'LocalDevSigner MUST NOT be used on mainnet. ' +
          'Set KMS_PROVIDER to aws or gcp.',
      );
    }

    this.secret = process.env.ATTESTER_SECRET ?? '';
    this.address = process.env.ATTESTER_ADDRESS ?? '';

    if (!this.secret || !this.address) {
      logger.warn(
        'ATTESTER_SECRET or ATTESTER_ADDRESS not set — LocalDevSigner will fail at sign()',
      );
    }

    logger.warn(
      { address: this.address },
      '⚠️  LocalDevSigner is active — NOT FOR PRODUCTION',
    );
  }

  async sign(txXdr: string): Promise<string> {
    if (!this.secret) {
      throw new Error('LocalDevSigner: ATTESTER_SECRET not set');
    }

    // TODO: replace with:
    //   const keypair = Keypair.fromSecret(this.secret);
    //   const tx = TransactionBuilder.fromXDR(txXdr, networkPassphrase);
    //   tx.sign(keypair);
    //   return tx.toEnvelope().toXDR('base64');
    //
    // Reference: https://developers.stellar.org/docs/learn/encyclopedia/transactions-and-operations/transactions

    logger.info({ address: this.address }, 'LocalDevSigner.sign (stub)');
    return txXdr; // stub: return unsigned XDR until SDK is wired up
  }
}

// ─── AwsKmsSigner ─────────────────────────────────────────────────────────

/**
 * AwsKmsSigner — stub for AWS KMS signing.
 *
 * TODO: implement using @aws-sdk/client-kms SignCommand with the
 * ATTESTER_KMS_KEY_ID environment variable.
 * Reference: https://docs.aws.amazon.com/kms/latest/developerguide/asymmetric-key-specs.html
 *
 * To enable: set ATTESTER_KMS_PROVIDER=aws and ATTESTER_KMS_KEY_ID=<arn>.
 */
export class AwsKmsSigner implements Signer {
  readonly address: string;

  constructor() {
    this.address = process.env.ATTESTER_ADDRESS ?? '';
    if (!process.env.ATTESTER_KMS_KEY_ID) {
      throw new Error('AwsKmsSigner: ATTESTER_KMS_KEY_ID is required');
    }
  }

  async sign(_txXdr: string): Promise<string> {
    throw new Error(
      'AwsKmsSigner is not yet implemented. ' +
        'See TODO in apps/attester/src/signer.ts.',
    );
  }
}

// ─── GcpKmsSigner ─────────────────────────────────────────────────────────

/**
 * GcpKmsSigner — stub for Google Cloud KMS signing.
 *
 * TODO: implement using @google-cloud/kms asymmetricSign.
 * Reference: https://cloud.google.com/kms/docs/digital-signatures
 *
 * To enable: set ATTESTER_KMS_PROVIDER=gcp and ATTESTER_KMS_KEY_ID=<resource-name>.
 */
export class GcpKmsSigner implements Signer {
  readonly address: string;

  constructor() {
    this.address = process.env.ATTESTER_ADDRESS ?? '';
    if (!process.env.ATTESTER_KMS_KEY_ID) {
      throw new Error('GcpKmsSigner: ATTESTER_KMS_KEY_ID is required');
    }
  }

  async sign(_txXdr: string): Promise<string> {
    throw new Error(
      'GcpKmsSigner is not yet implemented. ' +
        'See TODO in apps/attester/src/signer.ts.',
    );
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────

export function createSigner(): Signer {
  const provider = process.env.ATTESTER_KMS_PROVIDER ?? 'local';
  switch (provider) {
    case 'local':
      return new LocalDevSigner();
    case 'aws':
      return new AwsKmsSigner();
    case 'gcp':
      return new GcpKmsSigner();
    default:
      throw new Error(`Unknown ATTESTER_KMS_PROVIDER: ${provider}`);
  }
}
