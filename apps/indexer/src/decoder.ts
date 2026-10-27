/**
 * Event decoder — translates raw RpcEvent topic/value XDR into typed
 * JavaScript objects matching the contract's event table in the README.
 *
 * README section: "Smart contract specification — Events"
 *
 * Event names (symbol_short values from the contract):
 *   funded    → (id, funder, school, token, amount, category, expires_at)
 *   attested  → (id, attester, count)
 *   released  → (id, school, amount)
 *   reclaimed → (id, funder, amount)
 *   cancelled → (id)
 *
 * XDR decoding strategy:
 *   Soroban events encode each topic/value as an XDR ScVal.
 *   We decode using the ScVal's discriminant:
 *     - ScValType.SCV_SYMBOL     → string
 *     - ScValType.SCV_U64        → bigint
 *     - ScValType.SCV_I128       → bigint (amount)
 *     - ScValType.SCV_ADDRESS    → Stellar address string
 *     - ScValType.SCV_U32        → number (count, category)
 *
 * Because we avoid the full @stellar/stellar-sdk here (version pinning
 * concerns) we use a manual base64→Buffer decode and read the XDR
 * discriminant.  For production use, replace the raw XDR parsing with
 * the stellar-sdk's xdr.ScVal.fromXDR() once the SDK version is pinned.
 *
 * IMPORTANT: If the Soroban SDK / CLI version in use changes the XDR
 * encoding, update the decoder and the fixture files accordingly.
 * Check: https://developers.stellar.org/docs/build/smart-contracts/overview
 */

import type { RpcEvent } from './rpc';

// ─── Typed decoded events ──────────────────────────────────────────────────

export type EventName =
  | 'funded'
  | 'attested'
  | 'released'
  | 'reclaimed'
  | 'cancelled';

export interface FundedEvent {
  name: 'funded';
  ledger: number;
  id: bigint;
  funder: string;
  school: string;
  token: string;
  amount: bigint;
  category: number;
  expiresAt: bigint;
}

export interface AttestedEvent {
  name: 'attested';
  ledger: number;
  id: bigint;
  attester: string;
  count: number;
}

export interface ReleasedEvent {
  name: 'released';
  ledger: number;
  id: bigint;
  school: string;
  amount: bigint;
}

export interface ReclaimedEvent {
  name: 'reclaimed';
  ledger: number;
  id: bigint;
  funder: string;
  amount: bigint;
}

export interface CancelledEvent {
  name: 'cancelled';
  ledger: number;
  id: bigint;
}

export type DecodedEvent =
  | FundedEvent
  | AttestedEvent
  | ReleasedEvent
  | ReclaimedEvent
  | CancelledEvent;

// ─── XDR discriminants ────────────────────────────────────────────────────
//
// ScValType values from Stellar XDR (stellar-xdr / Protocol 21).
// Keep in sync with the contract's SDK version.
// Full list: https://github.com/stellar/stellar-xdr/blob/curr/Stellar-types.x

const SCV_BOOL = 0;
const SCV_VOID = 1;
const SCV_ERROR = 2;
const SCV_U32 = 3;
const SCV_I32 = 4;
const SCV_U64 = 5;
const SCV_I64 = 6;
const SCV_TIMEPOINT = 7;
const SCV_DURATION = 8;
const SCV_U128 = 9;
const SCV_I128 = 10;
const SCV_U256 = 11;
const SCV_I256 = 12;
const SCV_BYTES = 13;
const SCV_STRING = 14;
const SCV_SYMBOL = 15;
const SCV_VEC = 16;
const SCV_MAP = 17;
const SCV_ADDRESS = 18;
const SCV_CONTRACT_INSTANCE = 19;
const SCV_LEDGER_KEY_CONTRACT_INSTANCE = 20;
const SCV_LEDGER_KEY_NONCE = 21;

// ─── Low-level XDR helpers ────────────────────────────────────────────────

function readUint32BE(buf: Buffer, offset: number): number {
  return (
    ((buf[offset] ?? 0) << 24) |
    ((buf[offset + 1] ?? 0) << 16) |
    ((buf[offset + 2] ?? 0) << 8) |
    (buf[offset + 3] ?? 0)
  ) >>> 0;
}

function readInt32BE(buf: Buffer, offset: number): number {
  return (
    (((buf[offset] ?? 0) << 24) |
      ((buf[offset + 1] ?? 0) << 16) |
      ((buf[offset + 2] ?? 0) << 8) |
      (buf[offset + 3] ?? 0)) |
    0
  );
}

/**
 * Decode a single XDR-encoded ScVal from a base64 string.
 * Returns a JavaScript primitive or string.
 *
 * This handles only the ScVal variants emitted by the voucher contract.
 * Unknown variants throw so we detect encoding changes early.
 */
export function decodeScVal(b64: string): bigint | number | string | boolean | null {
  const buf = Buffer.from(b64, 'base64');
  const discriminant = readInt32BE(buf, 0);

  switch (discriminant) {
    case SCV_BOOL: {
      const v = readUint32BE(buf, 4);
      return v !== 0;
    }

    case SCV_VOID:
      return null;

    case SCV_U32:
      return readUint32BE(buf, 4);

    case SCV_I32:
      return readInt32BE(buf, 4);

    case SCV_U64:
    case SCV_TIMEPOINT:
    case SCV_DURATION: {
      // 8 bytes big-endian unsigned
      const hi = readUint32BE(buf, 4);
      const lo = readUint32BE(buf, 8);
      return (BigInt(hi) << 32n) | BigInt(lo);
    }

    case SCV_I64: {
      const hi = readInt32BE(buf, 4);
      const lo = readUint32BE(buf, 8);
      return (BigInt(hi) << 32n) | BigInt(lo);
    }

    case SCV_U128: {
      // XDR: uint64 hi, uint64 lo
      const hiHi = readUint32BE(buf, 4);
      const hiLo = readUint32BE(buf, 8);
      const loHi = readUint32BE(buf, 12);
      const loLo = readUint32BE(buf, 16);
      const hi = (BigInt(hiHi) << 32n) | BigInt(hiLo);
      const lo = (BigInt(loHi) << 32n) | BigInt(loLo);
      return (hi << 64n) | lo;
    }

    case SCV_I128: {
      // XDR: int64 hi, uint64 lo
      const hiHi = readInt32BE(buf, 4);
      const hiLo = readUint32BE(buf, 8);
      const loHi = readUint32BE(buf, 12);
      const loLo = readUint32BE(buf, 16);
      const hi = (BigInt(hiHi) << 32n) | BigInt(hiLo);
      const lo = (BigInt(loHi) << 32n) | BigInt(loLo);
      return (hi << 64n) | lo;
    }

    case SCV_BYTES:
    case SCV_STRING:
    case SCV_SYMBOL: {
      // 4-byte length prefix, then raw bytes (padded to 4-byte boundary)
      const len = readUint32BE(buf, 4);
      return buf.subarray(8, 8 + len).toString(discriminant === SCV_BYTES ? 'hex' : 'utf8');
    }

    case SCV_ADDRESS: {
      // ScAddress: discriminant(4) + then either AccountID or ContractID
      // AccountID: type=0 + 4-byte key type + 32-byte public key
      // ContractID: type=1 + 32-byte hash
      // We return a base64 representation of the raw bytes for now;
      // the caller that needs the string form should use the stellar SDK.
      // For our purposes, we extract a hex-ish representation for DB storage.
      const addressType = readInt32BE(buf, 4);
      if (addressType === 0) {
        // AccountID: pubkey starts at offset 12 (4 discriminant, 4 address type, 4 key type)
        const pubkey = buf.subarray(12, 44);
        return 'account:' + pubkey.toString('hex');
      } else {
        // ContractID: 32-byte hash at offset 8
        const hash = buf.subarray(8, 40);
        return 'contract:' + hash.toString('hex');
      }
    }

    default:
      throw new Error(`decodeScVal: unsupported ScValType discriminant ${discriminant}`);
  }
}

// ─── Event decoder ────────────────────────────────────────────────────────

/**
 * Decode a raw RpcEvent into a typed DecodedEvent.
 * Returns null if the event name is not one we handle (e.g., future events).
 *
 * IMPORTANT: The contract emits events as:
 *   topics: [(symbol_short!("eventname"),)]
 *   value:  (field1, field2, ...)
 *
 * The SDK encodes tuples in value as a VEC ScVal; each element is an
 * individually encoded ScVal.  We parse the outer tuple here.
 */
export function decodeEvent(event: RpcEvent): DecodedEvent | null {
  if (event.type !== 'contract') return null;

  const [nameTopic] = event.topic;
  if (!nameTopic) return null;

  let eventName: string;
  try {
    eventName = decodeScVal(nameTopic) as string;
  } catch {
    return null;
  }

  if (!['funded', 'attested', 'released', 'reclaimed', 'cancelled'].includes(eventName)) {
    return null;
  }

  // Decode the value tuple.  The contract uses a VEC-wrapped tuple.
  // We parse the VEC manually: skip discriminant(4) + length(4) + item count(4),
  // then iterate items.
  const valueBuf = Buffer.from(event.value.xdr, 'base64');
  const valueFields = decodeVecScVal(valueBuf);

  const ledger = event.ledger;

  switch (eventName) {
    case 'funded': {
      // (id:u64, funder:Address, school:Address, token:Address, amount:i128, category:u32, expires_at:u64)
      return {
        name: 'funded',
        ledger,
        id: valueFields[0] as bigint,
        funder: valueFields[1] as string,
        school: valueFields[2] as string,
        token: valueFields[3] as string,
        amount: valueFields[4] as bigint,
        category: valueFields[5] as number,
        expiresAt: valueFields[6] as bigint,
      };
    }
    case 'attested': {
      // (voucher_id:u64, attester:Address, count:u32)
      return {
        name: 'attested',
        ledger,
        id: valueFields[0] as bigint,
        attester: valueFields[1] as string,
        count: valueFields[2] as number,
      };
    }
    case 'released': {
      // (voucher_id:u64, school:Address, amount:i128)
      return {
        name: 'released',
        ledger,
        id: valueFields[0] as bigint,
        school: valueFields[1] as string,
        amount: valueFields[2] as bigint,
      };
    }
    case 'reclaimed': {
      // (voucher_id:u64, funder:Address, amount:i128)
      return {
        name: 'reclaimed',
        ledger,
        id: valueFields[0] as bigint,
        funder: valueFields[1] as string,
        amount: valueFields[2] as bigint,
      };
    }
    case 'cancelled': {
      // (voucher_id:u64)
      return {
        name: 'cancelled',
        ledger,
        id: valueFields[0] as bigint,
      };
    }
    default:
      return null;
  }
}

/**
 * Decode an XDR VEC ScVal into an array of decoded values.
 * Format: discriminant(4:SCV_VEC) + item_count(4) + [ScVal...]
 */
function decodeVecScVal(buf: Buffer): (bigint | number | string | boolean | null)[] {
  const discriminant = readInt32BE(buf, 0);
  if (discriminant !== SCV_VEC) {
    // If the value is not a VEC, treat it as a single-element tuple
    const single = decodeScValFromBuffer(buf);
    return [single];
  }

  const count = readUint32BE(buf, 4);
  const items: (bigint | number | string | boolean | null)[] = [];
  let offset = 8;

  for (let i = 0; i < count; i++) {
    const { value, bytesRead } = decodeScValAtOffset(buf, offset);
    items.push(value);
    offset += bytesRead;
  }

  return items;
}

function decodeScValFromBuffer(buf: Buffer): bigint | number | string | boolean | null {
  return decodeScVal(buf.toString('base64'));
}

/**
 * Decode one ScVal at a byte offset in a buffer, returning the value and
 * the number of bytes consumed.
 *
 * Each ScVal starts with a 4-byte discriminant, followed by variant-specific
 * data.  The length of the data depends on the variant.
 */
function decodeScValAtOffset(
  buf: Buffer,
  offset: number,
): { value: bigint | number | string | boolean | null; bytesRead: number } {
  const discriminant = readInt32BE(buf, offset);

  switch (discriminant) {
    case SCV_BOOL:
      return { value: readUint32BE(buf, offset + 4) !== 0, bytesRead: 8 };

    case SCV_VOID:
      return { value: null, bytesRead: 4 };

    case SCV_U32:
    case SCV_I32:
      return {
        value: discriminant === SCV_U32 ? readUint32BE(buf, offset + 4) : readInt32BE(buf, offset + 4),
        bytesRead: 8,
      };

    case SCV_U64:
    case SCV_TIMEPOINT:
    case SCV_DURATION: {
      const hi = readUint32BE(buf, offset + 4);
      const lo = readUint32BE(buf, offset + 8);
      return { value: (BigInt(hi) << 32n) | BigInt(lo), bytesRead: 12 };
    }

    case SCV_I64: {
      const hi = readInt32BE(buf, offset + 4);
      const lo = readUint32BE(buf, offset + 8);
      return { value: (BigInt(hi) << 32n) | BigInt(lo), bytesRead: 12 };
    }

    case SCV_U128:
    case SCV_I128: {
      const hiHi = discriminant === SCV_I128 ? readInt32BE(buf, offset + 4) : readUint32BE(buf, offset + 4);
      const hiLo = readUint32BE(buf, offset + 8);
      const loHi = readUint32BE(buf, offset + 12);
      const loLo = readUint32BE(buf, offset + 16);
      const hi = (BigInt(hiHi) << 32n) | BigInt(hiLo);
      const lo = (BigInt(loHi) << 32n) | BigInt(loLo);
      return { value: (hi << 64n) | lo, bytesRead: 20 };
    }

    case SCV_BYTES:
    case SCV_STRING:
    case SCV_SYMBOL: {
      const len = readUint32BE(buf, offset + 4);
      const padded = Math.ceil(len / 4) * 4;
      const str = buf
        .subarray(offset + 8, offset + 8 + len)
        .toString(discriminant === SCV_BYTES ? 'hex' : 'utf8');
      return { value: str, bytesRead: 8 + padded };
    }

    case SCV_ADDRESS: {
      // 4 (disc) + 4 (addr type) + either 4+32 (account) or 32 (contract)
      const addressType = readInt32BE(buf, offset + 4);
      if (addressType === 0) {
        // AccountID: 4 disc + 4 addr type + 4 key type + 32 bytes = 44
        const pubkey = buf.subarray(offset + 12, offset + 44);
        return { value: 'account:' + pubkey.toString('hex'), bytesRead: 44 };
      } else {
        // ContractID: 4 disc + 4 addr type + 32 bytes = 40
        const hash = buf.subarray(offset + 8, offset + 40);
        return { value: 'contract:' + hash.toString('hex'), bytesRead: 40 };
      }
    }

    default:
      throw new Error(
        `decodeScValAtOffset: unsupported discriminant ${discriminant} at offset ${offset}`,
      );
  }
}
