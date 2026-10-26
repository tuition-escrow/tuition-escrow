/**
 * POST /schools        — platform_admin: onboard a school
 * GET  /schools        — public: list active schools
 * PATCH /schools/:id   — platform_admin: update payout address (resets verification)
 *
 * README section: "REST endpoints" + "Deployment" (school onboarding)
 *
 * Privacy: no student data is accepted or returned here.
 * Admin-only mutations do not move escrowed funds.
 */

import { Router } from 'express';
import { Pool } from 'pg';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';

const CreateSchoolSchema = z.object({
  name: z.string().min(1).max(200),
  stellarAddress: z.string().min(56).max(56),
});

const UpdateSchoolSchema = z.object({
  stellarAddress: z.string().min(56).max(56),
});

export function schoolsRouter(pool: Pool): Router {
  const router = Router();

  // GET /schools — public, active only
  router.get('/', async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, name, stellar_address, created_at
         FROM schools
         WHERE verification_status = 'active'
         ORDER BY name`,
      );
      res.json({ schools: rows });
    } catch (err) {
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // POST /schools — platform_admin only
  router.post('/', requireAuth, requireRole('platform_admin'), async (req, res) => {
    const parsed = CreateSchoolSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', details: parsed.error.flatten() });
      return;
    }
    const { name, stellarAddress } = parsed.data;
    try {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO schools (name, stellar_address)
         VALUES ($1, $2)
         RETURNING id, name, stellar_address, verification_status, created_at`,
        [name, stellarAddress],
      );
      res.status(201).json({ school: rows[0] });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === '23505') {
        res.status(409).json({ error: 'address_already_registered' });
        return;
      }
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // PATCH /schools/:id — platform_admin: payout address change resets to 'pending'
  router.patch('/:id', requireAuth, requireRole('platform_admin'), async (req, res) => {
    const parsed = UpdateSchoolSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', details: parsed.error.flatten() });
      return;
    }
    const { stellarAddress } = parsed.data;
    try {
      const { rows } = await pool.query(
        `UPDATE schools
         SET stellar_address = $1,
             verification_status = 'pending',
             updated_at = now()
         WHERE id = $2
         RETURNING id, name, stellar_address, verification_status`,
        [stellarAddress, req.params['id']],
      );
      if (rows.length === 0) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.json({ school: rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'internal_error' });
    }
  });

  return router;
}
