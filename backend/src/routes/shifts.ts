import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/setup';
import { requireAdmin } from '../lib/auth';
import { logAudit } from '../lib/audit';

const router = Router();

router.get('/current', async (req: Request, res: Response) => {
  const db = getDb();
  const shift = await db.prepare("SELECT * FROM cashier_shifts WHERE user_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1").get(req.user!.id);
  res.json(shift || null);
});

router.post('/open', async (req: Request, res: Response) => {
  const db = getDb();
  const openingCash = Number(req.body?.opening_cash);
  if (!Number.isFinite(openingCash) || openingCash < 0) { res.status(400).json({ error: 'Opening cash must be zero or greater' }); return; }
  const open = await db.prepare("SELECT id FROM cashier_shifts WHERE user_id = ? AND status = 'open'").get(req.user!.id);
  if (open) { res.status(409).json({ error: 'You already have an open shift' }); return; }
  const id = uuidv4();
  await db.prepare('INSERT INTO cashier_shifts (id, user_id, opening_cash) VALUES (?, ?, ?)').run(id, req.user!.id, openingCash);
  await logAudit(req.user!.id, 'open', 'cashier_shift', id, `Opening cash ${openingCash}`);
  res.status(201).json(await db.prepare('SELECT * FROM cashier_shifts WHERE id = ?').get(id));
});

router.post('/:id/close', async (req: Request, res: Response) => {
  const db = getDb();
  const closingCash = Number(req.body?.closing_cash);
  if (!Number.isFinite(closingCash) || closingCash < 0) { res.status(400).json({ error: 'Closing cash must be zero or greater' }); return; }
  const shift = await db.prepare("SELECT * FROM cashier_shifts WHERE id = ? AND status = 'open'").get(req.params.id) as any;
  if (!shift) { res.status(404).json({ error: 'Open shift not found' }); return; }
  if (shift.user_id !== req.user!.id && req.user!.role !== 'admin') { res.status(403).json({ error: 'You can only close your own shift' }); return; }
  const cash = await db.prepare("SELECT COALESCE(SUM(p.amount),0) total FROM payments p WHERE p.payment_date >= ? AND p.method = 'cash' AND NOT EXISTS (SELECT 1 FROM cashier_shifts s WHERE s.id = ? AND s.opened_at > p.payment_date)").get(shift.opened_at, shift.id) as any;
  const expected = Number(shift.opening_cash) + Number(cash.total || 0);
  await db.prepare("UPDATE cashier_shifts SET closed_at = datetime('now'), expected_cash = ?, closing_cash = ?, variance = ?, status = 'closed', notes = ? WHERE id = ?")
    .run(expected, closingCash, closingCash - expected, req.body?.notes || null, shift.id);
  await logAudit(req.user!.id, 'close', 'cashier_shift', shift.id, `Expected ${expected}; counted ${closingCash}`);
  res.json(await db.prepare('SELECT * FROM cashier_shifts WHERE id = ?').get(shift.id));
});

router.get('/', requireAdmin, async (_req: Request, res: Response) => {
  res.json(await getDb().prepare('SELECT s.*, u.username FROM cashier_shifts s LEFT JOIN users u ON u.id = s.user_id ORDER BY s.opened_at DESC LIMIT 100').all());
});

export default router;
