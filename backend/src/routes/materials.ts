import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/setup';

const router = Router();

function validateMaterial(body: any, existing?: any) {
  const errors: string[] = [];
  const name = body.name ?? existing?.name;
  const unit = body.unit ?? existing?.unit;
  const stock = body.stock ?? existing?.stock;
  const cost_price = body.cost_price ?? existing?.cost_price;
  const price_per_unit = body.price_per_unit ?? existing?.price_per_unit;
  const reorder_point = body.reorder_point ?? existing?.reorder_point;

  if (body.name !== undefined && (!body.name || !body.name.trim())) {
    errors.push('Name is required');
  }
  if (body.unit !== undefined && !body.unit) {
    errors.push('Unit is required');
  }
  if (body.cost_price !== undefined) {
    if (isNaN(body.cost_price) || body.cost_price < 0) {
      errors.push('Cost price cannot be negative');
    }
  }
  if (body.price_per_unit !== undefined) {
    if (isNaN(body.price_per_unit) || body.price_per_unit <= 0) {
      errors.push('Price per unit must be greater than 0');
    }
  }
  if (body.stock !== undefined) {
    if (isNaN(body.stock) || body.stock < 0) {
      errors.push('Stock cannot be negative');
    }
  }
  if (body.reorder_point !== undefined) {
    if (isNaN(body.reorder_point) || body.reorder_point < 0) {
      errors.push('Reorder point cannot be negative');
    }
  }
  return { name, unit, stock, cost_price, price_per_unit, reorder_point, errors };
}

router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const materials = db.prepare('SELECT * FROM materials ORDER BY created_at DESC').all();
  res.json(materials);
});

router.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id);
  if (!material) { res.status(404).json({ error: 'Material not found' }); return; }
  res.json(material);
});

router.post('/', (req: Request, res: Response) => {
  const db = getDb();
  const { name, unit, stock, cost_price, price_per_unit, reorder_point } = req.body;
  const validation = validateMaterial({ name, unit, stock, cost_price, price_per_unit, reorder_point });
  if (validation.errors.length) {
    res.status(400).json({ error: validation.errors.join('; ') });
    return;
  }
  const id = uuidv4();
  db.prepare(
    'INSERT INTO materials (id, name, unit, stock, cost_price, price_per_unit, reorder_point) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, validation.name.trim(), validation.unit, validation.stock ?? 0, validation.cost_price ?? 0, validation.price_per_unit, validation.reorder_point ?? 10);
  const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
  res.status(201).json(material);
});

router.put('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'Material not found' }); return; }
  const { name, unit, stock, cost_price, price_per_unit, reorder_point } = req.body;
  const validation = validateMaterial({ name, unit, stock, cost_price, price_per_unit, reorder_point }, existing);
  if (validation.errors.length) {
    res.status(400).json({ error: validation.errors.join('; ') });
    return;
  }
  db.prepare(
    `UPDATE materials SET name=?, unit=?, stock=?, cost_price=?, price_per_unit=?, reorder_point=?, updated_at=datetime('now') WHERE id=?`
  ).run(
    validation.name,
    validation.unit,
    validation.stock,
    validation.cost_price ?? 0,
    validation.price_per_unit,
    validation.reorder_point,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'Material not found' }); return; }
  const used = db.prepare('SELECT COUNT(*) as cnt FROM invoice_items WHERE material_id = ?').get(req.params.id) as any;
  if (used.cnt > 0) {
    res.status(409).json({ error: 'Cannot delete material that appears in invoice items' });
    return;
  }
  db.prepare('DELETE FROM materials WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

export default router;
