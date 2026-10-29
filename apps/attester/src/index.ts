/**
 * Attester HTTP service.
 *
 * README sections: "Attester model", "Attester service responsibilities"
 *
 * Endpoints:
 *   POST /attest            — request attestation for a voucher (attester role)
 *   POST /admin/reviews/:id/approve  — approve a manual review (admin role)
 *   POST /admin/reviews/:id/reject   — reject a manual review (admin role)
 *   GET  /audit             — get audit log for this attester address
 *   GET  /health            — liveness check
 *   GET  /metrics           — Prometheus metrics
 *
 * Auth: Bearer JWT (same shape as apps/api).
 * The attester service is only accessible to authorised attesters and admins.
 *
 * ONLY confirm() is ever called on-chain.  No other contract functions.
 */

import express, { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { Pool } from "pg";
import * as http from "http";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { logger } from "./logger";
import {
  createVerificationProvider,
  ManualReviewQueueProvider,
} from "./verification";
import { createSigner } from "./signer";
import { SorobanChainChecker } from "./chain";
import { AttesterService } from "./service";
import {
  getAuditEntriesForAttester,
  verifyAuditChain,
  ensureAuditTable,
} from "./audit";
import { metricsRegistry } from "./metrics";

// ─── JWT auth ─────────────────────────────────────────────────────────────

function requireAuth(
  req: Request,
  res: Response,
  next: express.NextFunction,
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "missing_token" });
    return;
  }
  const token = header.slice(7);
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: "auth_misconfigured" });
    return;
  }
  try {
    const payload = jwt.verify(token, secret) as jwt.JwtPayload;
    (req as Request & { user: unknown }).user = payload;
    next();
  } catch {
    res.status(401).json({ error: "invalid_token" });
  }
}

function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: express.NextFunction): void => {
    const user = (req as Request & { user?: { role?: string } }).user;
    if (!user || !roles.includes(user.role ?? "")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
}

// ─── App factory ──────────────────────────────────────────────────────────

const AttestSchema = z.object({
  voucherId: z.string().regex(/^\d+$/, "voucherId must be a numeric string"),
  contextToken: z.string().min(1),
});

const ReviewDecisionSchema = z.object({
  reason: z.string().min(1).max(500),
});

export function createAttesterApp(
  pool: Pool,
  service: AttesterService,
): express.Application {
  const app = express();
  app.use(express.json());
  app.use(
    rateLimit({
      windowMs: 60_000,
      max: 60,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  // POST /attest — attester or platform_admin
  app.post(
    "/attest",
    requireAuth,
    requireRole("attester", "platform_admin"),
    async (req: Request, res: Response) => {
      const parsed = AttestSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "validation_error", details: parsed.error.flatten() });
        return;
      }
      const { voucherId, contextToken } = parsed.data;
      const user = (req as Request & { user?: { id?: string } }).user;

      const result = await service.attest(
        BigInt(voucherId),
        { token: contextToken },
        user?.id ?? "unknown",
      );

      res.status(result.success ? 200 : 422).json(result);
    },
  );

  // POST /admin/reviews/:id/approve
  app.post(
    "/admin/reviews/:id/approve",
    requireAuth,
    requireRole("platform_admin"),
    async (req: Request, res: Response) => {
      const parsed = ReviewDecisionSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "validation_error", details: parsed.error.flatten() });
        return;
      }
      const voucherId = BigInt(req.params["id"] ?? "0");
      const provider = createVerificationProvider(pool);
      if (!(provider instanceof ManualReviewQueueProvider)) {
        res.status(400).json({ error: "manual_review_not_active" });
        return;
      }
      await provider.decide(voucherId, true, parsed.data.reason);
      res.json({ ok: true });
    },
  );

  // POST /admin/reviews/:id/reject
  app.post(
    "/admin/reviews/:id/reject",
    requireAuth,
    requireRole("platform_admin"),
    async (req: Request, res: Response) => {
      const parsed = ReviewDecisionSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "validation_error", details: parsed.error.flatten() });
        return;
      }
      const voucherId = BigInt(req.params["id"] ?? "0");
      const provider = createVerificationProvider(pool);
      if (!(provider instanceof ManualReviewQueueProvider)) {
        res.status(400).json({ error: "manual_review_not_active" });
        return;
      }
      await provider.decide(voucherId, false, parsed.data.reason);
      res.json({ ok: true });
    },
  );

  // GET /audit — attester sees own log; admin sees all
  app.get(
    "/audit",
    requireAuth,
    requireRole("attester", "platform_admin"),
    async (req: Request, res: Response) => {
      const user = (
        req as Request & { user?: { role?: string; attesterAddress?: string } }
      ).user;
      const address =
        user?.role === "platform_admin"
          ? (req.query["address"] as string | undefined)
          : user?.attesterAddress;

      if (!address) {
        res.status(400).json({ error: "attester_address_required" });
        return;
      }

      const entries = await getAuditEntriesForAttester(pool, address);
      res.json({ entries });
    },
  );

  // GET /audit/verify — check chain integrity
  app.get(
    "/audit/verify",
    requireAuth,
    requireRole("platform_admin"),
    async (req: Request, res: Response) => {
      const address = req.query["address"] as string | undefined;
      const result = await verifyAuditChain(pool, address);
      res.json(result);
    },
  );

  // GET /health
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  return app;
}

// ─── Entry point ─────────────────────────────────────────────────────────

import { initSentry } from "@tuition-escrow/shared";

async function main(): Promise<void> {
  initSentry("attester");
  const databaseUrl = process.env.DATABASE_URL;
  const rpcUrl = process.env.STELLAR_RPC_URL;
  const contractId = process.env.VOUCHER_CONTRACT_ID;
  const port = parseInt(process.env.ATTESTER_PORT ?? "3002", 10);
  const metricsPort = parseInt(process.env.ATTESTER_METRICS_PORT ?? "9102", 10);

  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!rpcUrl) throw new Error("STELLAR_RPC_URL is required");
  if (!contractId) throw new Error("VOUCHER_CONTRACT_ID is required");

  const pool = new Pool({ connectionString: databaseUrl });
  const signer = createSigner();
  const verifier = createVerificationProvider(pool);
  const checker = new SorobanChainChecker(rpcUrl, contractId);
  const service = new AttesterService(pool, verifier, signer, checker);

  await ensureAuditTable(pool);
  await service.initialize();

  const app = createAttesterApp(pool, service);
  app.listen(port, () => {
    logger.info({ port }, "Attester service started");
  });

  // Metrics server
  const metricsServer = http.createServer(async (_req, res) => {
    res.setHeader("Content-Type", metricsRegistry.contentType);
    res.end(await metricsRegistry.metrics());
  });
  metricsServer.listen(metricsPort, () => {
    logger.info({ metricsPort }, "Attester metrics server started");
  });
}

if (require.main === module) {
  main().catch((err) => {
    logger.error({ err }, "Fatal attester error");
    process.exit(1);
  });
}
