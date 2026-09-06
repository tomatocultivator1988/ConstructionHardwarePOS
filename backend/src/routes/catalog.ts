import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/setup';
import { requireAdmin } from '../lib/auth';

const router = Router();
router.use(requireAdmin);
const TYPES = ['category', 'unit', 'expense_category'];
const DEFAULTS: Record<string, string[]> = {
  category: ['Cement', 'Steel/Rebar', 'Lumber/Wood', 'Plumbing', 'Electrical', 'Paint', 'Hardware', 'Sand/Gravel', 'Roofing', 'Tools', 'Other'],
  unit: ['Each', 'Kilogram', 'Meter', 'Roll', 'Gallon', 'Pieces', 'Liter', 'Box', 'Set', 'Bag', 'Pair', 'Sack', 'Bottle', 'Pack'],
  expense_category: ['Rent', 'Utilities', 'Labor/Salary', 'Delivery/Transport', 'Tools & Equipment', 'Maintenance', 'Supplies', 'Other'],
};

router.get('/', async (_req: Request, res: Response) => {
  const db = getDb();
  const rows = await db.prepare('SELECT type,name FROM catalog_options ORDER BY type,name').all() as any[];
  const result: Record<string, string[]> = {};
  for (const type of TYPES) result[type] = rows.filter(r => r.type === type).map(r => r.name);
  res.json(result);
});

router.post('/', requireAdmin, async (req: Request, res: Response) => {
  const type = typeof req.body?.type === 'string' ? req.body.type.trim() : '';
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!TYPES.includes(type) || name.length < 2 || name.length > 60) { res.status(422).json({ error: 'Valid catalog type and name are required' }); return; }
  const db = getDb();
  const existing = await db.prepare('SELECT id,name FROM catalog_options WHERE type=? AND lower(name)=lower(?)').get(type, name);
  if (existing) { res.json(existing); return; }
  const id = uuidv4();
  await db.prepare('INSERT INTO catalog_options (id,type,name) VALUES (?,?,?)').run(id, type, name);
  res.status(201).json({ id, type, name });
});

export default router;
