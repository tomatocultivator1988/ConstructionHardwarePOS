import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/setup';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const invoices = db.prepare(`
    SELECT i.*, COALESCE(c.name, 'Walk-in') AS customer_name
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    ORDER BY i.created_at DESC
  `).all();
  res.json(invoices);
});

router.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const invoice = db.prepare(`
    SELECT i.*, COALESCE(c.name, 'Walk-in') AS customer_name
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    WHERE i.id = ?
  `).get(req.params.id);
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(req.params.id);
  const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ?').all(req.params.id);
  res.json({ ...invoice as any, items, payments });
});

router.post('/', (req: Request, res: Response) => {
  const db = getDb();
  const { customer_id, items, due_date, tax_rate } = req.body;

  if (!items || !items.length) {
    res.status(400).json({ error: 'At least one line item is required' });
    return;
  }

  const usedMaterialIds = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.description || !item.description.trim()) {
      res.status(400).json({ error: `Item ${i + 1}: description is required` });
      return;
    }
    if (!item.quantity || item.quantity <= 0) {
      res.status(400).json({ error: `Item ${i + 1}: quantity must be greater than 0` });
      return;
    }
    if (!item.unit_price || item.unit_price <= 0) {
      res.status(400).json({ error: `Item ${i + 1}: unit price must be greater than 0` });
      return;
    }
    if (item.material_id) {
      usedMaterialIds.add(item.material_id);
    }
  }

  if (customer_id) {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
    if (!customer) { res.status(404).json({ error: 'Customer not found' }); return; }
  }

  const invoiceId = uuidv4();

  const insertItem = db.prepare(
    'INSERT INTO invoice_items (id, invoice_id, material_id, description, quantity, unit_price, total) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const deductStock = db.prepare('UPDATE materials SET stock = stock - ? WHERE id = ?');
  const checkStock = db.prepare('SELECT id, name, stock, unit FROM materials WHERE id = ?');
  const getSeq = db.prepare('SELECT next_number FROM invoice_sequence WHERE id = 1');
  const updateSeq = db.prepare('UPDATE invoice_sequence SET next_number = next_number + 1 WHERE id = 1');

  const txn = db.transaction(() => {
    const seq = getSeq.get() as any;
    const num = seq.next_number;
    updateSeq.run();
    const invoice_number = `INV-${String(num).padStart(4, '0')}`;

    for (const materialId of usedMaterialIds) {
      const mat = checkStock.get(materialId) as any;
      if (!mat) {
        throw new Error(`Material ${materialId} not found`);
      }
      const qtyNeeded = items
        .filter((it: any) => it.material_id === materialId)
        .reduce((s: number, it: any) => s + it.quantity, 0);
      if (mat.stock < qtyNeeded) {
        throw new Error(`Insufficient stock for ${mat.name}: have ${mat.stock} ${mat.unit}, need ${qtyNeeded} ${mat.unit}`);
      }
    }

    db.prepare(
      'INSERT INTO invoices (id, customer_id, invoice_number, subtotal, tax_rate, total, due_date) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(invoiceId, customer_id || null, invoice_number, 0, tax_rate ?? 0, 0, due_date || null);

    let subtotal = 0;
    for (const item of items) {
      const lineTotal = Math.round(item.quantity * item.unit_price * 100) / 100;
      subtotal += lineTotal;
      insertItem.run(uuidv4(), invoiceId, item.material_id || null, item.description.trim(), item.quantity, item.unit_price, lineTotal);
    }
    subtotal = Math.round(subtotal * 100) / 100;

    const appliedTaxRate = tax_rate ?? Number((db.prepare("SELECT value FROM settings WHERE key = 'default_tax_rate'").get() as any)?.value ?? 0);
    const taxAmount = Math.round(subtotal * Number(appliedTaxRate) * 100) / 100;
    const total = Math.round((subtotal + taxAmount) * 100) / 100;

    db.prepare('UPDATE invoices SET subtotal = ?, tax_rate = ?, tax_amount = ?, total = ? WHERE id = ?')
      .run(subtotal, appliedTaxRate, taxAmount, total, invoiceId);

    for (const materialId of usedMaterialIds) {
      const qtyNeeded = items
        .filter((it: any) => it.material_id === materialId)
        .reduce((s: number, it: any) => s + it.quantity, 0);
      deductStock.run(qtyNeeded, materialId);
    }
  });

  try {
    txn();
  } catch (e: any) {
    res.status(400).json({ error: e.message });
    return;
  }

  const invoice = db.prepare(`
    SELECT i.*, COALESCE(c.name, 'Walk-in') AS customer_name
    FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.id = ?
  `).get(invoiceId);
  const invoiceItems = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(invoiceId);
  res.status(201).json({ ...invoice as any, items: invoiceItems, payments: [] });
});

router.post('/:id/pay', (req: Request, res: Response) => {
  const db = getDb();
  const { amount, method, notes } = req.body;
  if (!amount || amount <= 0) {
    res.status(400).json({ error: 'Amount must be greater than 0' });
    return;
  }
  if (!method) {
    res.status(400).json({ error: 'Payment method is required' });
    return;
  }
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const paymentId = uuidv4();
  db.prepare(
    'INSERT INTO payments (id, invoice_id, amount, method, notes) VALUES (?, ?, ?, ?, ?)'
  ).run(paymentId, req.params.id, amount, method, notes || null);

  const totalPaid = (db.prepare(
    'SELECT COALESCE(SUM(amount), 0) as paid FROM payments WHERE invoice_id = ?'
  ).get(req.params.id) as any).paid;

  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
  if (totalPaid >= inv.total) {
    db.prepare("UPDATE invoices SET status = 'paid', paid_date = datetime('now') WHERE id = ?")
      .run(req.params.id);
  } else if (totalPaid > 0) {
    db.prepare("UPDATE invoices SET status = 'partial' WHERE id = ?")
      .run(req.params.id);
  }

  res.status(201).json(db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId));
});

router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const txn = db.transaction(() => {
    const items = db.prepare('SELECT material_id, quantity FROM invoice_items WHERE invoice_id = ?').all(req.params.id) as any[];
    for (const item of items) {
      if (item.material_id) {
        db.prepare('UPDATE materials SET stock = stock + ? WHERE id = ?').run(item.quantity, item.material_id);
      }
    }
    db.prepare('DELETE FROM payments WHERE invoice_id = ?').run(req.params.id);
    db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(req.params.id);
    db.prepare('DELETE FROM invoices WHERE id = ?').run(req.params.id);
  });
  txn();
  res.status(204).end();
});

export default router;
