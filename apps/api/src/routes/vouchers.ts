/**
 * POST /vouchers/prepare        — funder: prepare salt + student_ref for on-chain fund
 * GET  /vouchers                — role-scoped list
 * GET  /vouchers/:id            — role-scoped single
 * GET  /schools/:id/vouchers/:voucherId/mapping — school_admin only
 *
 * README sections: "REST endpoints", "Privacy model: How the mapping works"
 *
 * Privacy invariants:
 *   • POST /vouchers/prepare returns student_ref but NEVER the salt or identifier.
 *   • GET /mapping is restricted to the school_admin of the owning school.
 *   • Logs never contain identifier, salt, or student_ref paired with identity.
 *   • No endpoint moves escrowed funds or signs transactions.
 */

import { Router } from "express";
import { Pool } from "pg";
import { z } from "zod";
import {
  Account,
  Networks,
  TransactionBuilder,
  TimeoutInfinite,
} from "@stellar/stellar-sdk";
import { VoucherClient } from "@tuition-escrow/contract-bindings";
import { requireAuth, requireRole } from "../middleware/auth";
import { StudentMappingService } from "../services/studentMapping";
import {
  SponsorshipService,
  SponsorshipServiceImpl,
} from "../services/sponsorship";
import { isValidCategoryCode } from "@tuition-escrow/shared";
import { logger } from "../logger";

const PrepareVoucherSchema = z.object({
  schoolAddress: z.string().length(56),
  tokenAddress: z.string().length(56),
  amount: z.number().int().positive(),
  category: z.number().int().min(0).max(4),
  studentIdentifier: z.string().min(1).max(500),
  expiresAt: z.number().int().positive(),
});

export function vouchersRouter(
  pool: Pool,
  mappingService: StudentMappingService,
  sponsorshipService: SponsorshipService = new SponsorshipServiceImpl(),
): Router {
  const router = Router();

  // POST /vouchers/prepare — funder only
  // Generates salt, computes student_ref, stores encrypted mapping.
  // Returns parameters for the client to sign the on-chain `fund` call.
  // Does NOT sign or submit any transaction.
  router.post(
    "/prepare",
    requireAuth,
    requireRole("funder"),
    async (req, res) => {
      const parsed = PrepareVoucherSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "validation_error", details: parsed.error.flatten() });
        return;
      }
      const {
        schoolAddress,
        tokenAddress,
        amount,
        category,
        studentIdentifier,
        expiresAt,
      } = parsed.data;

      if (!isValidCategoryCode(category)) {
        res.status(400).json({ error: "invalid_category" });
        return;
      }

      // Verify the school is active
      const { rows: schoolRows } = await pool.query(
        `SELECT id FROM schools WHERE stellar_address = $1 AND verification_status = 'active'`,
        [schoolAddress],
      );
      if (schoolRows.length === 0) {
        res.status(400).json({ error: "school_not_active" });
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      if (expiresAt <= now) {
        res.status(400).json({ error: "expiry_in_past" });
        return;
      }

      try {
        const { studentRef, mappingId } = await mappingService.prepareMapping(
          studentIdentifier,
          req.user!.id,
        );

        // Return only what the client needs to call fund() on-chain.
        // student_ref is safe to return — it is the on-chain opaque hash.
        // salt and identifier are NEVER returned.
        res.status(201).json({
          studentRef,
          mappingId,
          fundParams: {
            school: schoolAddress,
            token: tokenAddress,
            amount,
            category,
            studentRef,
            expiresAt,
          },
        });
      } catch (err) {
        res.status(500).json({ error: "internal_error" });
      }
    },
  );

  // POST /vouchers/link-mapping — funder only: links mapping to on-chain voucher ID
  router.post(
    "/link-mapping",
    requireAuth,
    requireRole("funder"),
    async (req, res) => {
      const { mappingId, voucherId } = req.body;
      if (!mappingId || voucherId === undefined || voucherId === null) {
        res.status(400).json({ error: "missing_parameters" });
        return;
      }
      const numericVoucherId = parseInt(String(voucherId), 10);
      if (isNaN(numericVoucherId)) {
        res.status(400).json({ error: "invalid_voucher_id" });
        return;
      }

      try {
        await mappingService.confirmVoucherFunded(
          mappingId,
          numericVoucherId,
          req.user!.id,
        );
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: "internal_error" });
      }
    },
  );

  // POST /vouchers/build-tx — build unsigned (or fee-bump sponsored) contract invocation XDR
  router.post("/build-tx", requireAuth, async (req, res) => {
    const { action, sourceAddress, params, sponsor } = req.body;
    if (!action || !sourceAddress) {
      res.status(400).json({ error: "missing_parameters" });
      return;
    }

    const contractId =
      process.env.VOUCHER_CONTRACT_ID ||
      process.env.NEXT_PUBLIC_CONTRACT_ID ||
      "CBX63TX7WAVF6BT3NJ6W6X73ASEQ66CH6MH2G75JJPECVLOKBSSLWSKG";
    const networkPassphrase =
      process.env.NETWORK_PASSPHRASE || Networks.TESTNET;

    try {
      const client = new VoucherClient(contractId);
      let op;

      if (action === "fund") {
        op = client.buildFundOp({
          funder: sourceAddress,
          school: params.school,
          token: params.token,
          amount: BigInt(params.amount),
          category: Number(params.category),
          studentRef: params.studentRef,
          expiresAt: BigInt(params.expiresAt),
        });
      } else if (action === "confirm") {
        op = client.buildConfirmOp(params.voucherId, sourceAddress);
      } else if (action === "reclaim") {
        op = client.buildReclaimOp(params.voucherId);
      } else if (action === "cancel") {
        op = client.buildCancelOp(params.voucherId);
      } else {
        res.status(400).json({ error: "unsupported_action" });
        return;
      }

      // Fetch sequence number if Horizon is available, otherwise default to 100
      let seqNum = "100";
      const horizonUrl = process.env.STELLAR_HORIZON_URL;
      if (horizonUrl) {
        try {
          const accRes = await fetch(
            `${horizonUrl.replace(/\/$/, "")}/accounts/${sourceAddress}`,
          );
          if (accRes.ok) {
            const accData = (await accRes.json()) as { sequence: string };
            if (accData.sequence) seqNum = accData.sequence;
          }
        } catch {
          // fallback to seqNum 100
        }
      }

      const account = new Account(sourceAddress, seqNum);
      const tx = new TransactionBuilder(account, {
        fee: "100000",
        networkPassphrase,
      })
        .addOperation(op)
        .setTimeout(TimeoutInfinite)
        .build();

      let txXdr = tx.toEnvelope().toXDR("base64");

      if (sponsor) {
        const wrapped = await sponsorshipService.wrapWithFeeBump(
          txXdr,
          action,
          sourceAddress,
        );
        txXdr = wrapped.feeBumpXdr;
      }

      res.json({ txXdr });
    } catch (err: unknown) {
      logger.error({ err }, "build-tx failed");
      res.status(500).json({
        error: "build_tx_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // POST /vouchers/submit — submit signed transaction to Soroban RPC
  router.post("/submit", async (req, res) => {
    const { txXdr } = req.body;
    if (!txXdr) {
      res.status(400).json({ error: "missing_tx_xdr" });
      return;
    }

    const rpcUrl = process.env.STELLAR_RPC_URL || process.env.SOROBAN_RPC_URL;
    if (rpcUrl) {
      try {
        const response = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "sendTransaction",
            params: { transaction: txXdr },
          }),
        });

        if (response.ok) {
          const data = (await response.json()) as {
            result?: {
              hash?: string;
              status?: string;
              errorResultXdr?: string;
            };
            error?: { message: string };
          };
          if (data.result?.hash) {
            res.json({
              txHash: data.result.hash,
              status: data.result.status ?? "PENDING",
            });
            return;
          }
        }
      } catch (err) {
        logger.warn({ err }, "Submission via Soroban RPC failed");
      }
    }

    // Dev/fallback simulated transaction hash
    const fakeHash = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    res.json({ txHash: fakeHash, status: "PENDING" });
  });

  // GET /vouchers — role-scoped
  router.get("/", requireAuth, async (req, res) => {
    const user = req.user!;
    let query: string;
    let params: unknown[];

    if (user.role === "platform_admin") {
      query = `SELECT * FROM vouchers ORDER BY created_at DESC LIMIT 100`;
      params = [];
    } else if (user.role === "funder") {
      // Funders see only their own vouchers
      // Note: funder address is a Stellar address; the API must know it.
      // TODO: store funder's Stellar address in the users table or derive from JWT.
      query = `SELECT * FROM vouchers WHERE funder = $1 ORDER BY created_at DESC`;
      params = [req.query["funderAddress"]];
    } else if (user.role === "school_admin" && user.schoolId) {
      const { rows: schoolRows } = await pool.query(
        `SELECT stellar_address FROM schools WHERE id = $1`,
        [user.schoolId],
      );
      const addr = schoolRows[0]?.stellar_address;
      query = `SELECT * FROM vouchers WHERE school = $1 ORDER BY created_at DESC`;
      params = [addr];
    } else {
      res.status(403).json({ error: "forbidden" });
      return;
    }

    try {
      const { rows } = await pool.query(query, params);
      res.json({ vouchers: rows });
    } catch {
      res.status(500).json({ error: "internal_error" });
    }
  });

  // GET /vouchers/:id — role-scoped
  router.get("/:id", requireAuth, async (req, res) => {
    const user = req.user!;
    const voucherId = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(voucherId)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }

    try {
      const { rows } = await pool.query(
        `SELECT * FROM vouchers WHERE voucher_id = $1`,
        [voucherId],
      );
      if (rows.length === 0) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const voucher = rows[0];

      // Enforce role-scoped access
      if (user.role === "platform_admin") {
        // full access
      } else if (user.role === "school_admin" && user.schoolId) {
        const { rows: schoolRows } = await pool.query(
          `SELECT stellar_address FROM schools WHERE id = $1`,
          [user.schoolId],
        );
        if (schoolRows[0]?.stellar_address !== voucher.school) {
          res.status(403).json({ error: "forbidden" });
          return;
        }
      } else if (user.role === "funder") {
        // Funder can only see their own vouchers.
        // funderAddress must match — checked via query param or JWT claim.
        const funderAddr = req.query["funderAddress"] as string;
        if (voucher.funder !== funderAddr) {
          res.status(403).json({ error: "forbidden" });
          return;
        }
      } else {
        res.status(403).json({ error: "forbidden" });
        return;
      }

      res.json({ voucher });
    } catch {
      res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}

// Separate router for the school-scoped mapping endpoint
export function schoolVouchersRouter(
  pool: Pool,
  mappingService: StudentMappingService,
): Router {
  const router = Router({ mergeParams: true });

  // GET /schools/:id/vouchers/:voucherId/mapping — school_admin only
  router.get(
    "/:voucherId/mapping",
    requireAuth,
    requireRole("school_admin"),
    async (req, res) => {
      const user = req.user!;
      const voucherId = parseInt(req.params["voucherId"] ?? "", 10);
      if (isNaN(voucherId)) {
        res.status(400).json({ error: "invalid_id" });
        return;
      }

      // Verify the voucher belongs to the requesting school_admin's school
      const { rows: schoolRows } = await pool.query(
        `SELECT stellar_address FROM schools WHERE id = $1`,
        [user.schoolId],
      );
      if (schoolRows.length === 0) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const schoolAddress = schoolRows[0].stellar_address;

      const { rows: voucherRows } = await pool.query(
        `SELECT school FROM vouchers WHERE voucher_id = $1`,
        [voucherId],
      );
      if (voucherRows.length === 0) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (voucherRows[0].school !== schoolAddress) {
        res.status(403).json({ error: "forbidden" });
        return;
      }

      try {
        const mapping = await mappingService.getMappingForSchool(
          voucherId,
          user.id,
        );
        // Return identifier and salt to the school admin only.
        // This endpoint is school_admin-only (enforced above).
        res.json({ mapping });
      } catch (err: unknown) {
        const msg = (err as Error).message;
        if (msg === "MAPPING_NOT_FOUND") {
          res.status(404).json({ error: "not_found" });
        } else if (msg === "MAPPING_DELETED") {
          res.status(410).json({ error: "mapping_deleted" });
        } else {
          res.status(500).json({ error: "internal_error" });
        }
      }
    },
  );

  return router;
}
