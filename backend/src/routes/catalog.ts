import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/setup';
import { requireAdmin } from '../lib/auth';
import { logAudit } from '../lib/audit';

const router = Router();
const TYPES = ['category', 'unit', 'expense_category'];

// GET /api/catalog - dropdown options for products and expenses
router.get('/', async (_req: Request, res: Response) => {
  const db = getDb();
  const rows = await db.prepare('SELECT type, name FROM catalog_options ORDER BY type, name COLLATE NOCASE').all() as any[];
  const result: Record<string, string[]> = {};
  for (const type of TYPES) result[type] = rows.filter(r => r.type === type).map(r => r.name);
  res.json(result);
});

// GET /api/catalog/details - admin list with usage counts
router.get('/details', requireAdmin, async (_req: Request, res: Response) => {
  const db = getDb();
  const rows = await db.prepare(`
    SELECT 
      id, 
      type, 
      name,
      CASE 
        WHEN type = 'category' THEN (SELECT COUNT(*) FROM materials WHERE category = catalog_options.name)
        WHEN type = 'unit' THEN (SELECT COUNT(*) FROM materials WHERE unit = catalog_options.name)
        WHEN type = 'expense_category' THEN (SELECT COUNT(*) FROM expenses WHERE category = catalog_options.name)
        ELSE 0
      END AS usage_count
    FROM catalog_options
    ORDER BY type, name COLLATE NOCASE
  `).all() as any[];
  res.json(rows);
});

// POST /api/catalog - add new catalog option
router.post('/', requireAdmin, async (req: Request, res: Response) => {
  const type = typeof req.body?.type === 'string' ? req.body.type.trim() : '';
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!TYPES.includes(type) || name.length < 1 || name.length > 60) {
    res.status(422).json({ error: 'Valid catalog type and name (1-60 characters) are required' });
    return;
  }
  const db = getDb();
  const existing = await db.prepare('SELECT id, type, name FROM catalog_options WHERE type = ? AND lower(trim(name)) = lower(?)').get(type, name) as any;
  if (existing) {
    res.status(200).json(existing);
    return;
  }
  const id = uuidv4();
  await db.prepare('INSERT INTO catalog_options (id, type, name) VALUES (?, ?, ?)').run(id, type, name);
  const created = { id, type, name };
  await logAudit(req.user?.id || null, 'create', 'catalog_option', id, `Created ${type}: ${name}`, null, created);
  res.status(201).json(created);
});

// PUT /api/catalog/:id - edit / rename catalog option
router.put('/:id', requireAdmin, async (req: Request, res: Response) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (name.length < 1 || name.length > 60) {
    res.status(422).json({ error: 'Name must be between 1 and 60 characters' });
    return;
  }
  const db = getDb();
  const existing = await db.prepare('SELECT id, type, name FROM catalog_options WHERE id = ?').get(req.params.id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Catalog option not found' });
    return;
  }
  if (existing.name === name) {
    res.json(existing);
    return;
  }

  // Check if target name conflicts with another item of the same type
  const duplicate = await db.prepare('SELECT id FROM catalog_options WHERE type = ? AND lower(trim(name)) = lower(?) AND id <> ?').get(existing.type, name, req.params.id) as any;
  if (duplicate) {
    res.status(400).json({ error: `A ${existing.type.replace('_', ' ')} with the name "${name}" already exists` });
    return;
  }

  const oldName = existing.name;
  const newName = name;

  // Cascade rename across referencing tables
  if (existing.type === 'category') {
    await db.prepare('UPDATE materials SET category = ? WHERE category = ?').run(newName, oldName);
  } else if (existing.type === 'unit') {
    await db.prepare('UPDATE materials SET unit = ? WHERE unit = ?').run(newName, oldName);
  } else if (existing.type === 'expense_category') {
    await db.prepare('UPDATE expenses SET category = ? WHERE category = ?').run(newName, oldName);
  }

  await db.prepare('UPDATE catalog_options SET name = ? WHERE id = ?').run(newName, req.params.id);
  const updated = { id: req.params.id, type: existing.type, name: newName };
  await logAudit(req.user?.id || null, 'update', 'catalog_option', req.params.id as string, `Renamed ${existing.type}: "${oldName}" -> "${newName}"`, existing, updated);
  res.json(updated);
});

// DELETE /api/catalog/:id - delete catalog option
router.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  const db = getDb();
  const existing = await db.prepare('SELECT id, type, name FROM catalog_options WHERE id = ?').get(req.params.id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Catalog option not found' });
    return;
  }

  // Check if any materials or expenses are currently using this option
  let usageCount = 0;
  if (existing.type === 'category') {
    const r = await db.prepare('SELECT COUNT(*) as count FROM materials WHERE category = ?').get(existing.name) as any;
    usageCount = Number(r?.count || 0);
    if (usageCount > 0) {
      await db.prepare("UPDATE materials SET category = '' WHERE category = ?").run(existing.name);
    }
  } else if (existing.type === 'unit') {
    const r = await db.prepare('SELECT COUNT(*) as count FROM materials WHERE unit = ?').get(existing.name) as any;
    usageCount = Number(r?.count || 0);
  } else if (existing.type === 'expense_category') {
    const r = await db.prepare('SELECT COUNT(*) as count FROM expenses WHERE category = ?').get(existing.name) as any;
    usageCount = Number(r?.count || 0);
  }

  await db.prepare('DELETE FROM catalog_options WHERE id = ?').run(req.params.id);
  await logAudit(req.user?.id || null, 'delete', 'catalog_option', req.params.id as string, `Deleted ${existing.type}: ${existing.name}`, existing, null);
  res.json({ ok: true, deleted: existing, affected_items: usageCount });
});

export default router;
