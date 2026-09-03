import { Router, Request, Response } from 'express';
import { getDb } from '../db/setup';
import { requireAdmin } from '../lib/auth';
import { logAudit } from '../lib/audit';

const router = Router();

router.get('/:key', async (req: Request, res: Response) => {
  const db = getDb();
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').get(req.params.key) as any;
  if (!row) {
    res.json({ key: req.params.key, value: null });
    return;
  }
  res.json({ key: req.params.key, value: row.value });
});

router.put('/:key', requireAdmin, async (req: Request, res: Response) => {
  const db = getDb();
  const { value } = req.body;
  if (value === undefined) {
    res.status(400).json({ error: 'value is required' });
    return;
  }
  const previous = await db.prepare('SELECT value FROM settings WHERE key = ?').get(req.params.key) as any;
  await db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(req.params.key, String(value));
  const settingKey = String(req.params.key);
  await logAudit(req.user?.id || null, 'update', 'setting', settingKey, `Updated setting ${settingKey}`, previous, { value: String(value) });
  res.json({ key: req.params.key, value: String(value) });
});

export default router;
