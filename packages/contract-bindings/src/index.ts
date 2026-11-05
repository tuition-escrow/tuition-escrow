/**
 * VoucherContract client and bindings.
 *
 * Implements typed Soroban contract interactions for the Tuition Escrow contract.
 */

import {
  Address,
  Contract,
  Operation,
  xdr,
  scValToNative,
  nativeToScVal,
} from "@stellar/stellar-sdk";

export interface OnChainVoucher {
  funder: string;
  school: string;
  token: string;
  amount: bigint;
  category: number;
  student_ref: string;
  expires_at: bigint;
  status:
    "Funded" | "Released" | "Reclaimed" | "Cancelled" | "Disputed" | "Refunded";
  attesters: string[];
  threshold: number;
  attestation_count: number;
  confirmed_by: string[];
  created_at: bigint;
}

export interface FundArgs {
  funder: string;
  school: string;
  token: string;
  amount: bigint | number;
  category: number;
  studentRef: string; // 32-byte hex string
  expiresAt: bigint | number;
}

export class VoucherClient {
  public readonly contract: Contract;
  public readonly contractId: string;

  constructor(contractId: string) {
    this.contractId = contractId;
    this.contract = new Contract(contractId);
  }

  /**
   * Helper to convert 32-byte hex studentRef to ScVal BytesN<32>
   */
  private studentRefToScVal(hexStr: string): xdr.ScVal {
    const cleanHex = hexStr.replace(/^0x/, "");
    const buf = Buffer.from(cleanHex.padEnd(64, "0").slice(0, 64), "hex");
    return xdr.ScVal.scvBytes(buf);
  }

  /**
   * Builds an Operation for `fund`
   */
  public buildFundOp(args: FundArgs): xdr.Operation {
    const funderScVal = new Address(args.funder).toScVal();
    const schoolScVal = new Address(args.school).toScVal();
    const tokenScVal = new Address(args.token).toScVal();
    const amountScVal = nativeToScVal(BigInt(args.amount), { type: "i128" });
    const categoryScVal = xdr.ScVal.scvU32(args.category);
    const studentRefScVal = this.studentRefToScVal(args.studentRef);
    const expiresAtScVal = nativeToScVal(BigInt(args.expiresAt), {
      type: "u64",
    });

    return this.contract.call(
      "fund",
      funderScVal,
      schoolScVal,
      tokenScVal,
      amountScVal,
      categoryScVal,
      studentRefScVal,
      expiresAtScVal,
    );
  }

  /**
   * Builds an Operation for `confirm`
   */
  public buildConfirmOp(
    voucherId: bigint | number,
    attester: string,
  ): xdr.Operation {
    const idScVal = nativeToScVal(BigInt(voucherId), { type: "u64" });
    const attesterScVal = new Address(attester).toScVal();
    return this.contract.call("confirm", idScVal, attesterScVal);
  }

  /**
   * Builds an Operation for `reclaim`
   */
  public buildReclaimOp(voucherId: bigint | number): xdr.Operation {
    const idScVal = nativeToScVal(BigInt(voucherId), { type: "u64" });
    return this.contract.call("reclaim", idScVal);
  }

  /**
   * Builds an Operation for `cancel`
   */
  public buildCancelOp(voucherId: bigint | number): xdr.Operation {
    const idScVal = nativeToScVal(BigInt(voucherId), { type: "u64" });
    return this.contract.call("cancel", idScVal);
  }

  /**
   * Builds an Operation for `extend_ttl`
   */
  public buildExtendTtlOp(voucherId: bigint | number): xdr.Operation {
    const idScVal = nativeToScVal(BigInt(voucherId), { type: "u64" });
    return this.contract.call("extend_ttl", idScVal);
  }

  /**
   * Builds an Operation for `get_voucher`
   */
  public buildGetVoucherOp(voucherId: bigint | number): xdr.Operation {
    const idScVal = nativeToScVal(BigInt(voucherId), { type: "u64" });
    return this.contract.call("get_voucher", idScVal);
  }

  /**
   * Builds an Operation for `register_school`
   */
  public buildRegisterSchoolOp(
    school: string,
    attesters: string[],
    threshold: number,
  ): xdr.Operation {
    const schoolScVal = new Address(school).toScVal();
    const attestersScVal = xdr.ScVal.scvVec(
      attesters.map((a) => new Address(a).toScVal()),
    );
    const thresholdScVal = xdr.ScVal.scvU32(threshold);
    return this.contract.call(
      "register_school",
      schoolScVal,
      attestersScVal,
      thresholdScVal,
    );
  }

  /**
   * Parses the return ScVal from `get_voucher` into typed OnChainVoucher
   */
  public parseVoucherScVal(retval: xdr.ScVal | string): OnChainVoucher | null {
    try {
      const val =
        typeof retval === "string"
          ? xdr.ScVal.fromXDR(retval, "base64")
          : retval;
      const raw = scValToNative(val);
      if (!raw || typeof raw !== "object") return null;

      const statusMap: Record<number, OnChainVoucher["status"]> = {
        0: "Funded",
        1: "Released",
        2: "Reclaimed",
        3: "Cancelled",
        4: "Disputed",
        5: "Refunded",
      };

      const status =
        typeof raw.status === "number"
          ? (statusMap[raw.status] ?? "Funded")
          : raw.status;

      let studentRef = "";
      if (raw.student_ref) {
        if (Buffer.isBuffer(raw.student_ref)) {
          studentRef = raw.student_ref.toString("hex");
        } else if (typeof raw.student_ref === "string") {
          studentRef = raw.student_ref;
        }
      }

      return {
        funder: String(raw.funder ?? ""),
        school: String(raw.school ?? ""),
        token: String(raw.token ?? ""),
        amount: BigInt(raw.amount ?? 0),
        category: Number(raw.category ?? 0),
        student_ref: studentRef,
        expires_at: BigInt(raw.expires_at ?? 0),
        status,
        attesters: Array.isArray(raw.attesters)
          ? raw.attesters.map(String)
          : [],
        threshold: Number(raw.threshold ?? 1),
        attestation_count: Number(raw.attestation_count ?? 0),
        confirmed_by: Array.isArray(raw.confirmed_by)
          ? raw.confirmed_by.map(String)
          : [],
        created_at: BigInt(raw.created_at ?? 0),
      };
    } catch {
      return null;
    }
  }
}

export interface VoucherContractBindings {
  fund: (args: any) => any;
  confirm: (args: any) => any;
  reclaim: (args: any) => any;
  cancel: (args: any) => any;
  getVoucher: (args: any) => any;
  extendTtl: (args: any) => any;
  initialize: (args: any) => any;
  registerSchool: (args: any) => any;
}
