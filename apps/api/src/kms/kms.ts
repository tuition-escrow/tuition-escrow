/**
 * KMS adapter interface and implementations.
 *
 * README section: "Privacy model: How the mapping works"
 *   "Envelope-encrypt salt and identifier with a data key wrapped by a KMS adapter."
 *
 * Envelope encryption:
 *   1. Generate a random AES-256 data key.
 *   2. Encrypt the plaintext with the data key (AES-256-GCM).
 *   3. Wrap (encrypt) the data key with the KMS master key.
 *   4. Store: wrapped_key || iv || ciphertext (base64-encoded).
 *
 * On decrypt:
 *   1. Unwrap the data key via KMS.
 *   2. Decrypt the ciphertext with the data key.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Interface
// ─────────────────────────────────────────────────────────────────────────────

export interface KmsAdapter {
  /** Encrypt plaintext using envelope encryption. Returns a single opaque blob. */
  encrypt(keyId: string, plaintext: string): Promise<string>;
  /** Decrypt a blob produced by encrypt(). */
  decrypt(keyId: string, cipherblob: string): Promise<string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Local development implementation
// ⚠️  NOT FOR PRODUCTION — uses a static wrapping key from the environment.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * LocalKmsAdapter — for local development and tests only.
 *
 * Uses AES-256-GCM throughout.  The "wrapping key" is read from the
 * KMS_WRAPPING_KEY environment variable (must be ≥32 UTF-8 bytes).
 *
 * Cipherblob format (base64):
 *   <12-byte iv for data key><32-byte wrapped data key><12-byte iv for payload><payload ciphertext><16-byte auth tag>
 * All concatenated and base64url-encoded.
 */
export class LocalKmsAdapter implements KmsAdapter {
  private readonly wrappingKey: Buffer;

  constructor(wrappingKey?: string) {
    const raw = wrappingKey ?? process.env.KMS_WRAPPING_KEY ?? '';
    if (raw.length < 32) {
      throw new Error(
        'LocalKmsAdapter: KMS_WRAPPING_KEY must be at least 32 bytes. ' +
          'This adapter is NOT for production.',
      );
    }
    // Derive a 32-byte key from the first 32 bytes of the configured value.
    this.wrappingKey = Buffer.from(raw.slice(0, 32), 'utf8');
  }

  async encrypt(_keyId: string, plaintext: string): Promise<string> {
    // 1. Generate random AES-256 data key
    const dataKey = randomBytes(32);

    // 2. Encrypt the plaintext with the data key
    const payloadIv = randomBytes(12);
    const payloadCipher = createCipheriv('aes-256-gcm', dataKey, payloadIv);
    const payloadCt = Buffer.concat([
      payloadCipher.update(plaintext, 'utf8'),
      payloadCipher.final(),
    ]);
    const payloadTag = payloadCipher.getAuthTag();

    // 3. Wrap the data key with the wrapping key
    const wrapIv = randomBytes(12);
    const wrapCipher = createCipheriv('aes-256-gcm', this.wrappingKey, wrapIv);
    const wrappedKey = Buffer.concat([
      wrapCipher.update(dataKey),
      wrapCipher.final(),
    ]);
    const wrapTag = wrapCipher.getAuthTag();

    // 4. Encode: wrapIv(12) | wrappedKey(32) | wrapTag(16) | payloadIv(12) | payloadCt | payloadTag(16)
    const blob = Buffer.concat([
      wrapIv,
      wrappedKey,
      wrapTag,
      payloadIv,
      payloadCt,
      payloadTag,
    ]);
    return blob.toString('base64');
  }

  async decrypt(_keyId: string, cipherblob: string): Promise<string> {
    const buf = Buffer.from(cipherblob, 'base64');
    let offset = 0;

    const wrapIv = buf.subarray(offset, (offset += 12));
    const wrappedKey = buf.subarray(offset, (offset += 32));
    const wrapTag = buf.subarray(offset, (offset += 16));
    const payloadIv = buf.subarray(offset, (offset += 12));
    // remaining: ciphertext + 16-byte tag
    const remaining = buf.subarray(offset);
    const payloadCt = remaining.subarray(0, remaining.length - 16);
    const payloadTag = remaining.subarray(remaining.length - 16);

    // Unwrap data key
    const wrapDecipher = createDecipheriv('aes-256-gcm', this.wrappingKey, wrapIv);
    wrapDecipher.setAuthTag(wrapTag);
    const dataKey = Buffer.concat([
      wrapDecipher.update(wrappedKey),
      wrapDecipher.final(),
    ]);

    // Decrypt payload
    const payloadDecipher = createDecipheriv('aes-256-gcm', dataKey, payloadIv);
    payloadDecipher.setAuthTag(payloadTag);
    const plaintext = Buffer.concat([
      payloadDecipher.update(payloadCt),
      payloadDecipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AWS KMS stub  (TODO: implement before production)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AwsKmsAdapter — stub for AWS KMS integration.
 *
 * TODO: implement using @aws-sdk/client-kms GenerateDataKey + Decrypt.
 * Reference: https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html#enveloping
 *
 * To enable: set KMS_PROVIDER=aws and KMS_KEY_ID=<arn> in environment.
 */
export class AwsKmsAdapter implements KmsAdapter {
  async encrypt(_keyId: string, _plaintext: string): Promise<string> {
    throw new Error(
      'AwsKmsAdapter is not yet implemented. ' +
        'See TODO in apps/api/src/kms/kms.ts.',
    );
  }

  async decrypt(_keyId: string, _cipherblob: string): Promise<string> {
    throw new Error(
      'AwsKmsAdapter is not yet implemented. ' +
        'See TODO in apps/api/src/kms/kms.ts.',
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Cloud KMS stub  (TODO: implement before production)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GcpKmsAdapter — stub for Google Cloud KMS integration.
 *
 * TODO: implement using @google-cloud/kms encryptSymmetric + decryptSymmetric
 * with the symmetric key wrapping a locally-generated data key.
 * Reference: https://cloud.google.com/kms/docs/encrypt-decrypt
 *
 * To enable: set KMS_PROVIDER=gcp and KMS_KEY_ID=<resource-name> in environment.
 */
export class GcpKmsAdapter implements KmsAdapter {
  async encrypt(_keyId: string, _plaintext: string): Promise<string> {
    throw new Error(
      'GcpKmsAdapter is not yet implemented. ' +
        'See TODO in apps/api/src/kms/kms.ts.',
    );
  }

  async decrypt(_keyId: string, _cipherblob: string): Promise<string> {
    throw new Error(
      'GcpKmsAdapter is not yet implemented. ' +
        'See TODO in apps/api/src/kms/kms.ts.',
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createKmsAdapter(): KmsAdapter {
  const provider = process.env.KMS_PROVIDER ?? 'local';
  switch (provider) {
    case 'local':
      return new LocalKmsAdapter();
    case 'aws':
      return new AwsKmsAdapter();
    case 'gcp':
      return new GcpKmsAdapter();
    default:
      throw new Error(`Unknown KMS_PROVIDER: ${provider}`);
  }
}
