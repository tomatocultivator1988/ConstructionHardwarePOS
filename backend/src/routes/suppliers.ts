import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/setup';
import { requireAdmin } from '../lib/auth';
import { logAudit } from '../lib/audit';

const router = Router();

function validateSupplier(body: any, existing?: any) {
  const errors: string[] = [];
  const name = body.name ?? existing?.name;

  if (body.name !== undefined && (!body.name || !body.name.trim())) {
    errors.push('Name is required');
  }
  if (body.phone !== undefined && body.phone && !/^\d{7,13}$/.test(body.phone)) {
    errors.push('Phone must be 7-13 digits');
  }
  if (body.email !== undefined && body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    errors.push('Invalid email format');
  }
  return {
    name: name,
    contact_person: body.contact_person ?? existing?.contact_person ?? null,
    phone: body.phone !== undefined ? body.phone || null : existing?.phone ?? null,
    email: body.email !== undefined ? body.email || null : existing?.email ?? null,
    address: body.address !== undefined ? body.address || null : existing?.address ?? null,
    tin: body.tin !== undefined ? body.tin || null : existing?.tin ?? null,
    notes: body.notes !== undefined ? body.notes || null : existing?.notes ?? null,
    errors
  };
}

router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const suppliers = db.prepare('SELECT * FROM suppliers ORDER BY name ASC').all();
  res.json(suppliers);
});

router.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!supplier) { res.status(404).json({ error: 'Supplier not found' }); return; }
  res.json(supplier);
});

router.post('/', (req: Request, res: Response) => {
  const db = getDb();
  const v = validateSupplier(req.body);
  if (v.errors.length) {
    res.status(400).json({ error: v.errors.join('; ') });
    return;
  }
  const id = uuidv4();
  db.prepare(
    'INSERT INTO suppliers (id, name, contact_person, phone, email, address, tin, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, v.name.trim(), v.contact_person, v.phone, v.email, v.address, v.tin, v.notes);
  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  logAudit((req as any).user?.id || null, 'create', 'supplier', id, v.name);
  res.status(201).json(supplier);
});

router.put('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Supplier not found' }); return; }
  const v = validateSupplier(req.body, existing);
  if (v.errors.length) {
    res.status(400).json({ error: v.errors.join('; ') });
    return;
  }
  db.prepare(
    'UPDATE suppliers SET name=?, contact_person=?, phone=?, email=?, address=?, tin=?, notes=? WHERE id=?'
  ).run(v.name.trim(), v.contact_person, v.phone, v.email, v.address, v.tin, v.notes, req.params.id);
  const updated = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  logAudit((req as any).user?.id || null, 'update', 'supplier', req.params.id as string);
  res.json(updated);
});

router.delete('/:id', requireAdmin, (req: Request, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'Supplier not found' }); return; }
  const name = (existing as any).name;
  db.prepare('DELETE FROM suppliers WHERE id = ?').run(req.params.id);
  logAudit((req as any).user?.id || null, 'delete', 'supplier', req.params.id as string, name);
  res.status(204).send();
});

export default router;
