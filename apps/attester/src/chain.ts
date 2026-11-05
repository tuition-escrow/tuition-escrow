/**
 * On-chain voucher state checker.
 *
 * README section: "Attester service responsibilities"
 *   "For a voucher, check on-chain that it is Funded and not expired"
 *   "Support attester address revocation awareness (do not sign if the
 *    address is no longer in the voucher's attester set)."
 *
 * NOTE: Real implementation requires the @stellar/stellar-sdk and a pinned
 * contract binding.  This module provides the interface and a stub.
 * Replace fetchVoucher() with the typed contract client once the SDK is pinned.
 */

import { logger } from "./logger";
import {
  Account,
  Networks,
  TransactionBuilder,
  TimeoutInfinite,
} from "@stellar/stellar-sdk";
import { VoucherClient } from "@tuition-escrow/contract-bindings";

export interface OnChainVoucher {
  id: bigint;
  funder: string;
  school: string;
  token: string;
  amount: bigint;
  category: number;
  expiresAt: bigint; // Unix seconds
  status:
    "Funded" | "Released" | "Reclaimed" | "Cancelled" | "Disputed" | "Refunded";
  attesters: string[];
  threshold: number;
  attestationCount: number;
}

export interface ChainChecker {
  fetchVoucher(voucherId: bigint): Promise<OnChainVoucher | null>;
}

/**
 * SorobanChainChecker — calls get_voucher via simulateTransaction.
 *
 * TODO: implement using the typed contract client from
 * packages/contract-bindings once the SDK is pinned.
 */
export class SorobanChainChecker implements ChainChecker {
  constructor(
    private readonly rpcUrl: string,
    private readonly contractId: string,
  ) {}

  async fetchVoucher(voucherId: bigint): Promise<OnChainVoucher | null> {
    if (!this.rpcUrl || !this.contractId) {
      return null;
    }

    try {
      const client = new VoucherClient(this.contractId);
      const getOp = client.buildGetVoucherOp(voucherId);
      const sourceAccount = new Account(
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        "0",
      );
      const networkPassphrase =
        process.env.NETWORK_PASSPHRASE || Networks.TESTNET;
      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase,
      })
        .addOperation(getOp)
        .setTimeout(TimeoutInfinite)
        .build();

      const res = await fetch(this.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "simulateTransaction",
          params: { transaction: tx.toEnvelope().toXDR("base64") },
        }),
      });

      if (!res.ok) return null;
      const data = (await res.json()) as {
        result?: { retval?: string };
      };
      if (!data.result?.retval) return null;

      const parsed = client.parseVoucherScVal(data.result.retval);
      if (!parsed) return null;

      return {
        id: voucherId,
        funder: parsed.funder,
        school: parsed.school,
        token: parsed.token,
        amount: parsed.amount,
        category: parsed.category,
        expiresAt: parsed.expires_at,
        status: parsed.status,
        attesters: parsed.attesters,
        threshold: parsed.threshold,
        attestationCount: parsed.attestation_count,
      };
    } catch (err) {
      logger.error(
        { err, voucherId: voucherId.toString() },
        "fetchVoucher error",
      );
      return null;
    }
  }
}

/**
 * Check whether a given attester address is still in the voucher's attester set.
 * Returns false (fail-closed) if the voucher cannot be fetched.
 */
export async function isAttesterAuthorized(
  checker: ChainChecker,
  voucherId: bigint,
  attesterAddress: string,
): Promise<{
  authorized: boolean;
  reason: string;
  voucher: OnChainVoucher | null;
}> {
  const voucher = await checker.fetchVoucher(voucherId);
  if (!voucher) {
    return {
      authorized: false,
      reason: "Could not fetch on-chain voucher",
      voucher: null,
    };
  }

  if (voucher.status !== "Funded") {
    return {
      authorized: false,
      reason: `Voucher status is ${voucher.status}, not Funded`,
      voucher,
    };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec >= Number(voucher.expiresAt)) {
    return { authorized: false, reason: "Voucher has expired", voucher };
  }

  const inSet = voucher.attesters.some(
    (a) => a.toLowerCase() === attesterAddress.toLowerCase(),
  );
  if (!inSet) {
    return {
      authorized: false,
      reason: `Attester address ${attesterAddress} is not in the voucher's attester set`,
      voucher,
    };
  }

  return { authorized: true, reason: "Authorized", voucher };
}
