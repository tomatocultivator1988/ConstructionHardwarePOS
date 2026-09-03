import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/setup';
import { logAudit } from '../lib/audit';
import { requireAdmin } from '../lib/auth';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get('/', async (_req: Request, res: Response) => {
  const db = getDb();
  const customers = await db.prepare('SELECT * FROM customers ORDER BY created_at DESC').all();
  res.json(customers);
});

router.get('/:id', async (req: Request, res: Response) => {
  const db = getDb();
  const customer = await db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) {
    res.status(404).json({ error: 'Customer not found' });
    return;
  }
  res.json(customer);
});

// Customer Statement of Account
router.get('/:id/statement', async (req: Request, res: Response) => {
  const db = getDb();
  const customer = await db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id) as any;
  if (!customer) { res.status(404).json({ error: 'Customer not found' }); return; }

  const from = (req.query.from as string) || '';
  const to = (req.query.to as string) || '';

  let query = `
    SELECT i.id, i.invoice_number, i.total, i.status, i.issued_date, i.due_date,
      COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id), 0) AS paid
    FROM invoices i
    WHERE i.customer_id = ?
  `;
  const params: any[] = [req.params.id];

  if (from) { query += ' AND date(i.issued_date) >= ?'; params.push(from); }
  if (to) { query += ' AND date(i.issued_date) <= ?'; params.push(to); }
  query += ' ORDER BY i.issued_date ASC';

  const invoices = await db.prepare(query).all(...params) as any[];

  let balance = 0;
  const statements = invoices.map(inv => {
    balance += inv.total - inv.paid;
    return {
      ...inv,
      total: Math.round(inv.total * 100) / 100,
      paid: Math.round(inv.paid * 100) / 100,
      balance: Math.round(balance * 100) / 100,
    };
  });

  const totalOwed = Math.round(invoices.reduce((s, i) => s + i.total - i.paid, 0) * 100) / 100;

  res.json({ customer: { name: customer.name, address: customer.address, phone: customer.phone }, statements, total_owed: totalOwed, from, to });
});

router.post('/', async (req: Request, res: Response) => {
  const db = getDb();
  const { name, phone, email, address, tin, is_wholesale } = req.body;
  if (!name || !name.trim()) {
    res.status(400).json({ error: 'Name is required' });
    return;
  }
  if (email && !EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'Invalid email format' });
    return;
  }
  if (phone !== undefined && phone !== null && phone !== '' && !/^\d{7,13}$/.test(String(phone))) {
    res.status(400).json({ error: 'Phone must be 7-13 digits' }); return;
  }
  const id = uuidv4();
  await db.prepare(
    'INSERT INTO customers (id, name, phone, email, address, tin, is_wholesale) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, name.trim(), phone || null, email || null, address || null, tin || null, is_wholesale ? 1 : 0);
  const customer = await db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  await logAudit((req as any).user?.id || null, 'create', 'customer', id, name.trim());
  res.status(201).json(customer);
});

router.put('/:id', async (req: Request, res: Response) => {
  const db = getDb();
  const { name, phone, email, address, tin, is_wholesale } = req.body;
  const existing = await db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id) as any;
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
  if (phone !== undefined && phone !== null && phone !== '' && !/^\d{7,13}$/.test(String(phone))) {
    res.status(400).json({ error: 'Phone must be 7-13 digits' }); return;
  }
  const customerId = req.params.id as string;
  await db.prepare(
    `UPDATE customers SET name = ?, phone = ?, email = ?, address = ?, tin = ?, is_wholesale = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(
    (name !== undefined ? name.trim() : existing.name),
    phone ?? existing.phone,
    email ?? existing.email,
    address ?? existing.address,
    tin ?? existing.tin,
    is_wholesale !== undefined ? (is_wholesale ? 1 : 0) : existing.is_wholesale,
    customerId
  );
  const customer = await db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  await logAudit((req as any).user?.id || null, 'update', 'customer', customerId);
  res.json(customer);
});

router.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  const db = getDb();
  const existing = await db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Customer not found' });
    return;
  }
  const used = await db.prepare('SELECT COUNT(*) as cnt FROM invoices WHERE customer_id = ?').get(req.params.id) as any;
  if (used.cnt > 0) {
    res.status(409).json({ error: 'Cannot delete customer with existing invoices' });
    return;
  }
  const custId = req.params.id as string;
  await db.prepare('DELETE FROM customers WHERE id = ?').run(custId);
  await logAudit((req as any).user?.id || null, 'delete', 'customer', custId);
  res.status(204).send();
});

export default router;
