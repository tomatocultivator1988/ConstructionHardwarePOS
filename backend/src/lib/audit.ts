import { getDb } from '../db/setup';
import { v4 as uuidv4 } from 'uuid';

export async function logAudit(userId: string | null, action: string, entity: string, entityId?: string, details?: string, oldValues?: unknown, newValues?: unknown, ipAddress?: string) {
  const db = getDb();
  await db.prepare(
    'INSERT INTO audit_log (id, user_id, action, entity, entity_id, details, old_values, new_values, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(uuidv4(), userId || null, action, entity, entityId || null, details || null,
    oldValues == null ? null : JSON.stringify(oldValues), newValues == null ? null : JSON.stringify(newValues), ipAddress || null);
}
