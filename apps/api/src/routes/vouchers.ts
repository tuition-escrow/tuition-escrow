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

import { Router } from 'express';
import { Pool } from 'pg';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { StudentMappingService } from '../services/studentMapping';
import { isValidCategoryCode } from '@tuition-escrow/shared';

const PrepareVoucherSchema = z.object({
  schoolAddress: z.string().length(56),
  tokenAddress: z.string().length(56),
  amount: z.number().int().positive(),
  category: z.number().int().min(0).max(4),
  studentIdentifier: z.string().min(1).max(500),
  expiresAt: z.number().int().positive(),
});

export function vouchersRouter(pool: Pool, mappingService: StudentMappingService): Router {
  const router = Router();

  // POST /vouchers/prepare — funder only
  // Generates salt, computes student_ref, stores encrypted mapping.
  // Returns parameters for the client to sign the on-chain `fund` call.
  // Does NOT sign or submit any transaction.
  router.post('/prepare', requireAuth, requireRole('funder'), async (req, res) => {
    const parsed = PrepareVoucherSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', details: parsed.error.flatten() });
      return;
    }
    const { schoolAddress, tokenAddress, amount, category, studentIdentifier, expiresAt } =
      parsed.data;

    if (!isValidCategoryCode(category)) {
      res.status(400).json({ error: 'invalid_category' });
      return;
    }

    // Verify the school is active
    const { rows: schoolRows } = await pool.query(
      `SELECT id FROM schools WHERE stellar_address = $1 AND verification_status = 'active'`,
      [schoolAddress],
    );
    if (schoolRows.length === 0) {
      res.status(400).json({ error: 'school_not_active' });
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    if (expiresAt <= now) {
      res.status(400).json({ error: 'expiry_in_past' });
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
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // GET /vouchers — role-scoped
  router.get('/', requireAuth, async (req, res) => {
    const user = req.user!;
    let query: string;
    let params: unknown[];

    if (user.role === 'platform_admin') {
      query = `SELECT * FROM vouchers ORDER BY created_at DESC LIMIT 100`;
      params = [];
    } else if (user.role === 'funder') {
      // Funders see only their own vouchers
      // Note: funder address is a Stellar address; the API must know it.
      // TODO: store funder's Stellar address in the users table or derive from JWT.
      query = `SELECT * FROM vouchers WHERE funder = $1 ORDER BY created_at DESC`;
      params = [req.query['funderAddress']];
    } else if (user.role === 'school_admin' && user.schoolId) {
      const { rows: schoolRows } = await pool.query(
        `SELECT stellar_address FROM schools WHERE id = $1`,
        [user.schoolId],
      );
      const addr = schoolRows[0]?.stellar_address;
      query = `SELECT * FROM vouchers WHERE school = $1 ORDER BY created_at DESC`;
      params = [addr];
    } else {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    try {
      const { rows } = await pool.query(query, params);
      res.json({ vouchers: rows });
    } catch {
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // GET /vouchers/:id — role-scoped
  router.get('/:id', requireAuth, async (req, res) => {
    const user = req.user!;
    const voucherId = parseInt(req.params['id'] ?? '', 10);
    if (isNaN(voucherId)) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }

    try {
      const { rows } = await pool.query(
        `SELECT * FROM vouchers WHERE voucher_id = $1`,
        [voucherId],
      );
      if (rows.length === 0) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const voucher = rows[0];

      // Enforce role-scoped access
      if (user.role === 'platform_admin') {
        // full access
      } else if (user.role === 'school_admin' && user.schoolId) {
        const { rows: schoolRows } = await pool.query(
          `SELECT stellar_address FROM schools WHERE id = $1`,
          [user.schoolId],
        );
        if (schoolRows[0]?.stellar_address !== voucher.school) {
          res.status(403).json({ error: 'forbidden' });
          return;
        }
      } else if (user.role === 'funder') {
        // Funder can only see their own vouchers.
        // funderAddress must match — checked via query param or JWT claim.
        const funderAddr = req.query['funderAddress'] as string;
        if (voucher.funder !== funderAddr) {
          res.status(403).json({ error: 'forbidden' });
          return;
        }
      } else {
        res.status(403).json({ error: 'forbidden' });
        return;
      }

      res.json({ voucher });
    } catch {
      res.status(500).json({ error: 'internal_error' });
    }
  });

  return router;
}

// Separate router for the school-scoped mapping endpoint
export function schoolVouchersRouter(pool: Pool, mappingService: StudentMappingService): Router {
  const router = Router({ mergeParams: true });

  // GET /schools/:id/vouchers/:voucherId/mapping — school_admin only
  router.get(
    '/:voucherId/mapping',
    requireAuth,
    requireRole('school_admin'),
    async (req, res) => {
      const user = req.user!;
      const voucherId = parseInt(req.params['voucherId'] ?? '', 10);
      if (isNaN(voucherId)) {
        res.status(400).json({ error: 'invalid_id' });
        return;
      }

      // Verify the voucher belongs to the requesting school_admin's school
      const { rows: schoolRows } = await pool.query(
        `SELECT stellar_address FROM schools WHERE id = $1`,
        [user.schoolId],
      );
      if (schoolRows.length === 0) {
        res.status(403).json({ error: 'forbidden' });
        return;
      }
      const schoolAddress = schoolRows[0].stellar_address;

      const { rows: voucherRows } = await pool.query(
        `SELECT school FROM vouchers WHERE voucher_id = $1`,
        [voucherId],
      );
      if (voucherRows.length === 0) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (voucherRows[0].school !== schoolAddress) {
        res.status(403).json({ error: 'forbidden' });
        return;
      }

      try {
        const mapping = await mappingService.getMappingForSchool(voucherId, user.id);
        // Return identifier and salt to the school admin only.
        // This endpoint is school_admin-only (enforced above).
        res.json({ mapping });
      } catch (err: unknown) {
        const msg = (err as Error).message;
        if (msg === 'MAPPING_NOT_FOUND') {
          res.status(404).json({ error: 'not_found' });
        } else if (msg === 'MAPPING_DELETED') {
          res.status(410).json({ error: 'mapping_deleted' });
        } else {
          res.status(500).json({ error: 'internal_error' });
        }
      }
    },
  );

  return router;
}
