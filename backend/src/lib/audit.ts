import { getDb } from '../db/setup';
import { v4 as uuidv4 } from 'uuid';

export async function logAudit(userId: string | null, action: string, entity: string, entityId?: string, details?: string) {
  const db = getDb();
  await db.prepare(
    'INSERT INTO audit_log (id, user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(uuidv4(), userId || null, action, entity, entityId || null, details || null);
}
