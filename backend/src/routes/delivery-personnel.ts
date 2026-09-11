import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/setup';
import { requireAdmin } from '../lib/auth';
import { logAudit } from '../lib/audit';

const router = Router();
router.use(requireAdmin);

router.get('/', async (_req: Request, res: Response) => {
  const rows = await getDb().prepare('SELECT id, name, phone, active, created_at, updated_at FROM delivery_personnel ORDER BY active DESC, name ASC').all();
  res.json(rows);
});

router.post('/', async (req: Request, res: Response) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
  if (!name || name.length > 120) { res.status(400).json({ error: 'Delivery person name is required and must be 120 characters or fewer' }); return; }
  if (phone.length > 40) { res.status(400).json({ error: 'Phone number must be 40 characters or fewer' }); return; }
  const db = getDb();
  const duplicate = await db.prepare('SELECT id FROM delivery_personnel WHERE lower(name)=lower(?)').get(name);
  if (duplicate) { res.status(409).json({ error: 'This delivery person is already registered' }); return; }
  const id = uuidv4();
  await db.prepare('INSERT INTO delivery_personnel (id, name, phone, active) VALUES (?, ?, ?, 1)').run(id, name, phone || null);
  const created = await db.prepare('SELECT id, name, phone, active, created_at, updated_at FROM delivery_personnel WHERE id=?').get(id);
  await logAudit(req.user?.id || null, 'create', 'delivery_personnel', id, `Registered delivery person ${name}`, null, created);
  res.status(201).json(created);
});

router.put('/:id', async (req: Request, res: Response) => {
  const db = getDb();
  const personId = String(req.params.id);
  const existing = await db.prepare('SELECT * FROM delivery_personnel WHERE id=?').get(personId) as any;
  if (!existing) { res.status(404).json({ error: 'Delivery person not found' }); return; }
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : existing.name;
  const phone = req.body?.phone === null ? null : (typeof req.body?.phone === 'string' ? req.body.phone.trim() : existing.phone);
  const active = req.body?.active === undefined ? Number(existing.active) : (req.body.active ? 1 : 0);
  if (!name || name.length > 120 || (phone && phone.length > 40)) { res.status(400).json({ error: 'Invalid delivery person details' }); return; }
  const duplicate = await db.prepare('SELECT id FROM delivery_personnel WHERE lower(name)=lower(?) AND id<>?').get(name, personId);
  if (duplicate) { res.status(409).json({ error: 'This delivery person is already registered' }); return; }
  await db.prepare("UPDATE delivery_personnel SET name=?, phone=?, active=?, updated_at=datetime('now') WHERE id=?").run(name, phone || null, active, personId);
  const updated = await db.prepare('SELECT id, name, phone, active, created_at, updated_at FROM delivery_personnel WHERE id=?').get(personId);
  await logAudit(req.user?.id || null, 'update', 'delivery_personnel', personId, `Updated delivery person ${name}`, existing, updated);
  res.json(updated);
});

export default router;
