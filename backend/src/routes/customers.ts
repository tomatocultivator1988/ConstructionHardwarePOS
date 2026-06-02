import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/setup';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const customers = db.prepare('SELECT * FROM customers ORDER BY created_at DESC').all();
  res.json(customers);
});

router.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) {
    res.status(404).json({ error: 'Customer not found' });
    return;
  }
  res.json(customer);
});

router.post('/', (req: Request, res: Response) => {
  const db = getDb();
  const { name, phone, email, address } = req.body;
  if (!name || !name.trim()) {
    res.status(400).json({ error: 'Name is required' });
    return;
  }
  if (email && !EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'Invalid email format' });
    return;
  }
  const id = uuidv4();
  db.prepare(
    'INSERT INTO customers (id, name, phone, email, address) VALUES (?, ?, ?, ?, ?)'
  ).run(id, name.trim(), phone || null, email || null, address || null);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  res.status(201).json(customer);
});

router.put('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const { name, phone, email, address } = req.body;
  const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Customer not found' });
    return;
  }
  if (name !== undefined && (!name || !name.trim())) {
    res.status(400).json({ error: 'Name is required' });
    return;
  }
  if (email && !EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'Invalid email format' });
    return;
  }
  db.prepare(
    `UPDATE customers SET name = ?, phone = ?, email = ?, address = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(
    (name !== undefined ? name.trim() : (existing as any).name),
    phone ?? (existing as any).phone,
    email ?? (existing as any).email,
    address ?? (existing as any).address,
    req.params.id
  );
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  res.json(customer);
});

router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Customer not found' });
    return;
  }
  const used = db.prepare('SELECT COUNT(*) as cnt FROM invoices WHERE customer_id = ?').get(req.params.id) as any;
  if (used.cnt > 0) {
    res.status(409).json({ error: 'Cannot delete customer with existing invoices' });
    return;
  }
  db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

export default router;
