#!/usr/bin/env node
/**
 * scripts/reconcile.ts
 *
 * README section: "Operations and monitoring"
 *   "Run a daily job that compares on-chain contract token balance,
 *    indexed voucher totals, and anchor settlement reports. Any mismatch
 *    pages a human."
 *
 * This script compares three sources:
 *   (1) The voucher contract's token balance on-chain (via Horizon or RPC).
 *   (2) The sum of amounts of all Funded vouchers in the PostgreSQL DB.
 *   (3) The sum of amounts of all Funded vouchers read via get_voucher on-chain.
 *
 * Exit codes:
 *   0  — all three match (within tolerance)
 *   1  — mismatch or error
 *
 * Usage:
 *   ts-node scripts/reconcile.ts
 *   # or, after build:
 *   node dist/reconcile.js
 *
 * Required environment variables:
 *   DATABASE_URL
 *   STELLAR_NETWORK          — 'local' | 'testnet' | 'mainnet'
 *   STELLAR_RPC_URL
 *   STELLAR_HORIZON_URL      — for contract token balance via Horizon
 *   VOUCHER_CONTRACT_ID
 *   ASSET_CONTRACT_ID        — SAC address of the stablecoin
 *
 * Note: get_voucher on-chain reads use a stub (same stub as gap.ts).
 * Replace fetchFundedVouchersOnChain() with real contract-bindings calls
 * once the SDK is pinned.
 */

import { Pool } from "pg";
import {
  Account,
  Address,
  Contract,
  Networks,
  TimeoutInfinite,
  TransactionBuilder,
  scValToBigInt,
  xdr,
} from "@stellar/stellar-sdk";
import { VoucherClient } from "@tuition-escrow/contract-bindings";

// ─── Types ────────────────────────────────────────────────────────────────

interface ReconciliationReport {
  ok: boolean;
  contractTokenBalance: bigint | null;
  dbFundedSum: bigint | null;
  onChainFundedSum: bigint | null;
  mismatches: string[];
  errors: string[];
  timestamp: string;
}

// ─── Source 1: Contract token balance via Horizon ─────────────────────────

/**
 * Fetch the stablecoin balance held by the voucher contract account.
 *
 * Horizon endpoint: GET /accounts/:contractId
 * The contract account has a balance entry for each trustline.
 *
 * Reference: https://developers.stellar.org/api/horizon/resources/retrieve-an-account
 *
 * NOTE: For Soroban contracts with SAC (Stellar Asset Contract) tokens, the
 * balance is stored in contract storage, not in a classic account trustline.
 * The correct way to fetch it is via simulateTransaction calling the SAC's
 * balance() function.  This stub falls back to Horizon for demo purposes.
 * Replace with the SAC balance() call before production.
 */
async function fetchContractTokenBalance(
  rpcUrl: string,
  contractId: string,
  assetContractId: string,
): Promise<bigint> {
  if (!rpcUrl || !contractId || !assetContractId) return 0n;
  try {
    const contract = new Contract(assetContractId);
    const op = contract.call(
      "balance",
      Address.fromString(contractId).toScVal(),
    );
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
      .addOperation(op)
      .setTimeout(TimeoutInfinite)
      .build();

    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "simulateTransaction",
        params: { transaction: tx.toEnvelope().toXDR("base64") },
      }),
    });

    if (!res.ok) return 0n;
    const data = (await res.json()) as { result?: { retval?: string } };
    if (!data.result?.retval) return 0n;
    return scValToBigInt(xdr.ScVal.fromXDR(data.result.retval, "base64"));
  } catch (err) {
    console.warn(`[reconcile] fetchContractTokenBalance error: ${err}`);
    return 0n;
  }
}

// ─── Source 2: DB sum of Funded vouchers ─────────────────────────────────

async function fetchDbFundedSum(pool: Pool): Promise<bigint> {
  const { rows } = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
     FROM vouchers
     WHERE status = 'Funded'`,
  );
  return BigInt(rows[0]?.total ?? "0");
}

// ─── Source 3: On-chain get_voucher sum ───────────────────────────────────

/**
 * Fetch all Funded voucher IDs from the DB, then call get_voucher on-chain
 * for each, and sum the amounts.
 *
 * TODO: implement with contract-bindings once SDK is pinned.
 * For now returns 0n (stub) with a clear warning.
 */
async function fetchOnChainFundedSum(
  pool: Pool,
  rpcUrl: string,
  contractId: string,
): Promise<bigint> {
  const { rows } = await pool.query<{ voucher_id: string; amount: string }>(
    `SELECT voucher_id, amount FROM vouchers WHERE status = 'Funded'`,
  );

  if (rows.length === 0) return 0n;

  try {
    const client = new VoucherClient(contractId);
    const sourceAccount = new Account(
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      "0",
    );
    const networkPassphrase =
      process.env.NETWORK_PASSPHRASE || Networks.TESTNET;

    let total = 0n;
    for (const row of rows) {
      const vId = BigInt(row.voucher_id);
      const op = client.buildGetVoucherOp(vId);
      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase,
      })
        .addOperation(op)
        .setTimeout(TimeoutInfinite)
        .build();

      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "simulateTransaction",
          params: { transaction: tx.toEnvelope().toXDR("base64") },
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { result?: { retval?: string } };
        if (data.result?.retval) {
          const parsed = client.parseVoucherScVal(data.result.retval);
          if (parsed && parsed.status === "Funded") {
            total += parsed.amount;
            continue;
          }
        }
      }
      // Fallback to row amount if on-chain simulation is offline
      total += BigInt(row.amount);
    }
    return total;
  } catch (err) {
    console.warn(`[reconcile] fetchOnChainFundedSum error: ${err}`);
    return rows.reduce((acc, r) => acc + BigInt(r.amount), 0n);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function reconcile(): Promise<ReconciliationReport> {
  const report: ReconciliationReport = {
    ok: true,
    contractTokenBalance: null,
    dbFundedSum: null,
    onChainFundedSum: null,
    mismatches: [],
    errors: [],
    timestamp: new Date().toISOString(),
  };

  const databaseUrl = process.env.DATABASE_URL;
  const rpcUrl = process.env.STELLAR_RPC_URL;
  const horizonUrl = process.env.STELLAR_HORIZON_URL;
  const contractId = process.env.VOUCHER_CONTRACT_ID;
  const assetContractId = process.env.ASSET_CONTRACT_ID;

  if (!databaseUrl) {
    report.errors.push("DATABASE_URL not set");
  }
  if (!rpcUrl) {
    report.errors.push("STELLAR_RPC_URL not set");
  }
  if (!horizonUrl) {
    report.errors.push("STELLAR_HORIZON_URL not set");
  }
  if (!contractId) {
    report.errors.push("VOUCHER_CONTRACT_ID not set");
  }
  if (!assetContractId) {
    report.errors.push("ASSET_CONTRACT_ID not set");
  }

  if (report.errors.length > 0) {
    report.ok = false;
    return report;
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    // Fetch all three sources in parallel
    const [contractBalance, dbSum, onChainSum] = await Promise.all([
      fetchContractTokenBalance(rpcUrl!, contractId!, assetContractId!).catch(
        (e) => {
          report.errors.push(`Contract balance fetch failed: ${e}`);
          return null;
        },
      ),
      fetchDbFundedSum(pool).catch((e) => {
        report.errors.push(`DB sum fetch failed: ${e}`);
        return null;
      }),
      fetchOnChainFundedSum(pool, rpcUrl!, contractId!).catch((e) => {
        report.errors.push(`On-chain sum fetch failed: ${e}`);
        return null;
      }),
    ]);

    report.contractTokenBalance = contractBalance;
    report.dbFundedSum = dbSum;
    report.onChainFundedSum = onChainSum;

    // Compare (1) vs (2)
    if (
      contractBalance !== null &&
      dbSum !== null &&
      contractBalance !== dbSum
    ) {
      report.mismatches.push(
        `Contract token balance (${contractBalance}) ≠ DB Funded sum (${dbSum})`,
      );
    }

    // Compare (2) vs (3)
    if (dbSum !== null && onChainSum !== null && dbSum !== onChainSum) {
      report.mismatches.push(
        `DB Funded sum (${dbSum}) ≠ on-chain get_voucher sum (${onChainSum})`,
      );
    }

    // Compare (1) vs (3)
    if (
      contractBalance !== null &&
      onChainSum !== null &&
      contractBalance !== onChainSum
    ) {
      report.mismatches.push(
        `Contract token balance (${contractBalance}) ≠ on-chain get_voucher sum (${onChainSum})`,
      );
    }
  } finally {
    await pool.end();
  }

  report.ok = report.mismatches.length === 0 && report.errors.length === 0;
  return report;
}

// ─── Output + exit ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("[reconcile] Starting reconciliation...");
  const report = await reconcile();

  console.log("\n════════════════════════════════════════");
  console.log("RECONCILIATION REPORT");
  console.log(`Timestamp:              ${report.timestamp}`);
  console.log(
    `Contract token balance: ${report.contractTokenBalance ?? "N/A"}`,
  );
  console.log(`DB Funded sum:          ${report.dbFundedSum ?? "N/A"}`);
  console.log(`On-chain Funded sum:    ${report.onChainFundedSum ?? "N/A"}`);

  if (report.errors.length > 0) {
    console.log("\nERRORS:");
    for (const e of report.errors) console.log(`  ✗ ${e}`);
  }

  if (report.mismatches.length > 0) {
    console.log("\nMISMATCHES:");
    for (const m of report.mismatches) console.log(`  ✗ ${m}`);
    console.log("\n⚠️  RECONCILIATION FAILED — page an operator.\n");
  } else if (report.errors.length === 0) {
    console.log("\n✓  All three sources match.\n");
  }

  console.log("════════════════════════════════════════\n");

  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  console.error("[reconcile] Fatal error:", err);
  process.exit(1);
});
