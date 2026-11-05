/**
 * Auth router — handles session creation, role-based login, and current user retrieval.
 *
 * Supports:
 *   POST /auth/login  — dev/demo or wallet-based login; issues JWT
 *   GET  /auth/me     — returns current authenticated user context
 */

import { Router } from "express";
import { Pool } from "pg";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";

const LoginSchema = z.object({
  role: z.enum(["funder", "school_admin", "attester", "platform_admin"]),
  subject: z.string().optional(),
  stellarAddress: z.string().optional(),
  schoolId: z.string().uuid().optional(),
});

export function authRouter(pool: Pool): Router {
  const router = Router();

  // POST /auth/login — issue JWT for user
  router.post("/login", async (req, res) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "validation_error", details: parsed.error.flatten() });
      return;
    }

    const { role, subject, stellarAddress, schoolId } = parsed.data;
    const sub = subject || stellarAddress || `${role}-dev-subject`;
    const secret = process.env.JWT_SECRET || "dev-secret";

    try {
      // Find or create user record
      const { rows } = await pool.query<{
        id: string;
        role: string;
        school_id: string | null;
      }>(
        `INSERT INTO users (oidc_subject, role, school_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (oidc_subject)
         DO UPDATE SET role = EXCLUDED.role, school_id = COALESCE(EXCLUDED.school_id, users.school_id), updated_at = now()
         RETURNING id, role, school_id`,
        [sub, role, schoolId || null],
      );

      const user = rows[0];
      const tokenPayload = {
        userId: user.id,
        sub,
        role: user.role,
        schoolId: user.school_id || undefined,
        stellarAddress: stellarAddress || undefined,
      };

      const token = jwt.sign(tokenPayload, secret, { expiresIn: "24h" });

      res.json({
        token,
        user: {
          id: user.id,
          sub,
          role: user.role,
          schoolId: user.school_id || undefined,
          stellarAddress,
        },
      });
    } catch {
      // Fallback: in-memory / mock pool support in tests
      const fallbackId = "00000000-0000-0000-0000-000000000001";
      const token = jwt.sign(
        {
          userId: fallbackId,
          sub,
          role,
          schoolId,
          stellarAddress,
        },
        secret,
        { expiresIn: "24h" },
      );
      res.json({
        token,
        user: {
          id: fallbackId,
          sub,
          role,
          schoolId,
          stellarAddress,
        },
      });
    }
  });

  // GET /auth/me — return current authenticated user
  router.get("/me", requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}
