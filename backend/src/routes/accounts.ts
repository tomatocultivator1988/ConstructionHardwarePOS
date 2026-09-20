import { Router, Request, Response } from 'express';
import { getDb } from '../db/setup';
import { requireAdmin } from '../lib/auth';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const types = new Set(['asset','liability','equity','revenue','expense']);
router.use(requireAdmin);

router.get('/', async (req: Request, res: Response) => {
  const db = getDb();
  const type = String(req.query.type || '').trim();
  const where = type && types.has(type) ? 'WHERE type = ?' : '';
  const rows = await db.prepare(`SELECT id, code, name, type, description, is_active, created_at, updated_at FROM chart_accounts ${where} ORDER BY code`).all(...(where ? [type] : []));
  res.json(rows);
});

router.post('/', async (req: Request, res: Response) => {
  const db = getDb();
  const code = String(req.body?.code || '').trim();
  const name = String(req.body?.name || '').trim();
  const type = String(req.body?.type || '').trim();
  const description = String(req.body?.description || '').trim();
  if (!/^\d{3,6}$/.test(code) || !name || !types.has(type)) return res.status(400).json({ error: 'Code, name, and a valid account type are required' });
  try {
    await db.prepare('INSERT INTO chart_accounts (id,code,name,type,description) VALUES (?,?,?,?,?)').run(uuidv4(), code, name, type, description);
    res.status(201).json({ ok: true });
  } catch (e: any) { res.status(400).json({ error: e.message?.includes('UNIQUE') ? 'Account code already exists' : 'Unable to create account' }); }
});

router.put('/:id', async (req: Request, res: Response) => {
  const db = getDb();
  const code = String(req.body?.code || '').trim();
  const name = String(req.body?.name || '').trim();
  const type = String(req.body?.type || '').trim();
  const description = String(req.body?.description || '').trim();
  if (!/^\d{3,6}$/.test(code) || !name || !types.has(type)) return res.status(400).json({ error: 'Code, name, and a valid account type are required' });
  try { await db.prepare("UPDATE chart_accounts SET code=?, name=?, type=?, description=?, updated_at=datetime('now') WHERE id=?").run(code, name, type, description, req.params.id); res.json({ ok: true }); }
  catch (e: any) { res.status(400).json({ error: e.message?.includes('UNIQUE') ? 'Account code already exists' : 'Unable to update account' }); }
});

router.put('/:id/status', async (req: Request, res: Response) => {
  const db = getDb();
  await db.prepare("UPDATE chart_accounts SET is_active=?, updated_at=datetime('now') WHERE id=?").run(req.body?.is_active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

export default router;
