import { Router, Request, Response } from 'express';
import { getDb } from '../db/setup';
import { requireAdmin } from '../lib/auth';

const router = Router();

router.get('/', requireAdmin, (_req: Request, res: Response) => {
  const db = getDb();
  const logs = db.prepare(`
    SELECT al.*, COALESCE(u.username, 'System') AS username
    FROM audit_log al
    LEFT JOIN users u ON u.id = al.user_id
    ORDER BY al.created_at DESC
    LIMIT 200
  `).all();
  res.json(logs);
});

export default router;
