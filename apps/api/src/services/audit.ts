/**
 * Audit log service — append-only writes to the audit_log table.
 * No UPDATE or DELETE is ever issued against audit_log.
 */

import { Pool } from 'pg';

export interface AuditEntry {
  eventType: string;
  actorId?: string;
  resource: string;
  detail?: Record<string, unknown>;
}

export async function auditLog(pool: Pool, entry: AuditEntry): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log (event_type, actor_id, resource, detail)
     VALUES ($1, $2, $3, $4)`,
    [entry.eventType, entry.actorId ?? null, entry.resource, entry.detail ?? null],
  );
}
