import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/setup';
import { requireAdmin, requireAdminOrPOS } from '../lib/auth';
import { logAudit } from '../lib/audit';

const router = Router();
router.use(requireAdminOrPOS);

function validateMaterial(body: any, existing?: any) {
  const errors: string[] = [];
  const name = body.name ?? existing?.name;
  const unit = body.unit ?? existing?.unit;
  const stock = body.stock ?? existing?.stock;
  const cost_price = body.cost_price ?? existing?.cost_price;
  const price_per_unit = body.price_per_unit ?? existing?.price_per_unit;
  const reorder_point = body.reorder_point ?? existing?.reorder_point;
  const category = body.category !== undefined ? body.category : (existing?.category ?? '');
  const supplier_id = body.supplier_id !== undefined ? body.supplier_id : (existing?.supplier_id ?? null);
  const barcode = body.barcode !== undefined ? String(body.barcode || '').trim() : (existing?.barcode ?? '');
  const wholesale_price = body.wholesale_price != null ? body.wholesale_price : (existing?.wholesale_price ?? 0);

  if (typeof name !== 'string' || !name.trim()) errors.push('Name is required');
  if (typeof unit !== 'string' || !unit.trim()) errors.push('Unit is required');
  for (const [label, value] of [['stock', stock], ['cost price', cost_price], ['retail price', price_per_unit], ['wholesale price', wholesale_price], ['reorder point', reorder_point]] as const) {
    if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${label} must be a valid number`);
  }
  if (Number(stock) < 0) errors.push('Stock cannot be negative');
  if (Number(cost_price) < 0) errors.push('Cost price cannot be negative');
  if (Number(price_per_unit) <= 0) errors.push('Retail price must be greater than 0');
  if (Number(wholesale_price) < 0) errors.push('Wholesale price cannot be negative');
  if (Number(reorder_point) < 0) errors.push('Reorder point cannot be negative');

  if (barcode.length > 100) errors.push('Barcode must be 100 characters or fewer');
  return { name, unit, stock, cost_price, price_per_unit, reorder_point, category, wholesale_price, supplier_id, barcode, errors };
}

router.get('/', async (req: Request, res: Response) => {
  const db = getDb();
  let query = 'SELECT * FROM materials';
  const params: any[] = [];
  const conditions: string[] = [];
  if (req.query.search && String(req.query.search).trim()) { conditions.push('(name LIKE ? OR category LIKE ? OR unit LIKE ?)'); const q = `%${String(req.query.search).trim()}%`; params.push(q, q, q); }
  if (req.query.category && req.query.category !== '') {
    conditions.push('category = ?');
    params.push(req.query.category);
  }
  if (req.query.lowStock === '1' || req.query.lowStock === 'true') conditions.push('stock <= reorder_point');
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY created_at DESC';
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 15));
  if (req.query.page !== undefined) {
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) AS total');
    const total = Number((await db.prepare(countQuery).get(...params) as any).total);
    query += ' LIMIT ? OFFSET ?';
    const rows = await db.prepare(query).all(...params, pageSize, (page - 1) * pageSize);
    res.json({ data: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
    return;
  }
  res.json(await db.prepare(query).all(...params));
});

router.get('/:id', async (req: Request, res: Response) => {
  const db = getDb();
  const material = await db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id);
  if (!material) { res.status(404).json({ error: 'Material not found' }); return; }
  res.json(material);
});

router.post('/', async (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
  const db = getDb();
  const { name, unit, stock, cost_price, price_per_unit, reorder_point, barcode } = req.body;
  const validation = validateMaterial({ name, unit, stock, cost_price, price_per_unit, reorder_point, barcode, category: req.body.category, supplier_id: req.body.supplier_id });
  if (validation.errors.length) {
    res.status(400).json({ error: validation.errors.join('; ') });
    return;
  }
  if (validation.supplier_id && !(await db.prepare('SELECT id FROM suppliers WHERE id=?').get(validation.supplier_id))) {
    res.status(404).json({ error: 'Supplier not found' }); return;
  }
  if (validation.barcode && (await db.prepare('SELECT id FROM materials WHERE barcode=?').get(validation.barcode))) { res.status(409).json({ error: 'Barcode is already assigned to another product' }); return; }
  const id = uuidv4();
  await db.prepare(
    'INSERT INTO materials (id, name, unit, stock, cost_price, price_per_unit, wholesale_price, reorder_point, category, supplier_id, barcode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, validation.name.trim(), validation.unit, validation.stock ?? 0, validation.cost_price ?? 0, validation.price_per_unit, validation.wholesale_price, validation.reorder_point ?? 10, validation.category, validation.supplier_id || null, validation.barcode || null);
  const material = await db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
  await logAudit((req as any).user?.id || null, 'create', 'material', id, validation.name.trim(), null, material);
  res.status(201).json(material);
});

router.put('/:id', async (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
  const db = getDb();
  const existing = await db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'Material not found' }); return; }
  const { name, unit, stock, cost_price, price_per_unit, reorder_point, barcode } = req.body;
  const validation = validateMaterial({ name, unit, stock, cost_price, price_per_unit, reorder_point, barcode, category: req.body.category, supplier_id: req.body.supplier_id }, existing);
  if (validation.errors.length) {
    res.status(400).json({ error: validation.errors.join('; ') });
    return;
  }
  if (validation.supplier_id && !(await db.prepare('SELECT id FROM suppliers WHERE id=?').get(validation.supplier_id))) {
    res.status(404).json({ error: 'Supplier not found' }); return;
  }
  if (validation.barcode && (await db.prepare('SELECT id FROM materials WHERE barcode=? AND id<>?').get(validation.barcode, req.params.id))) { res.status(409).json({ error: 'Barcode is already assigned to another product' }); return; }
  await db.prepare(
    `UPDATE materials SET name=?, unit=?, stock=?, cost_price=?, price_per_unit=?, wholesale_price=?, reorder_point=?, category=?, supplier_id=?, barcode=?, updated_at=datetime('now') WHERE id=?`
  ).run(
    validation.name,
    validation.unit,
    validation.stock,
    validation.cost_price ?? 0,
    validation.price_per_unit,
    validation.wholesale_price,
    validation.reorder_point,
    validation.category,
    validation.supplier_id || null,
    validation.barcode || null,
    req.params.id
  );
  const oldStock = Number((existing as any).stock);
  const newStock = Number(validation.stock);
  if (oldStock !== newStock) {
    await db.prepare('INSERT INTO stock_movements (id, material_id, type, quantity, reference_type, notes) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uuidv4(), req.params.id, 'adjustment', newStock - oldStock, 'manual', 'Manual stock adjustment');
  }
  const updated = await db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id);
  await logAudit((req as any).user?.id || null, 'update', 'material', req.params.id as string, undefined, existing, updated);
  res.json(updated);
});

router.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  const db = getDb();
  const existing = await db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'Material not found' }); return; }
  const used = await db.prepare('SELECT COUNT(*) as cnt FROM invoice_items WHERE material_id = ?').get(req.params.id) as any;
  if (used.cnt > 0) {
    res.status(409).json({ error: 'Cannot delete material that appears in invoice items' });
    return;
  }
  const name = (existing as any).name;
  await db.prepare('DELETE FROM materials WHERE id = ?').run(req.params.id);
  await logAudit((req as any).user?.id || null, 'delete', 'material', req.params.id as string, name, existing, null);
  res.status(204).send();
});

export default router;
