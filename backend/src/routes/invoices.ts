import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/setup';
import { requireAdmin } from '../lib/auth';
import { logAudit } from '../lib/audit';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const db = getDb();
  const invoices = await db.prepare(`
    SELECT i.*, COALESCE(c.name, 'Walk-in') AS customer_name
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    ORDER BY i.created_at DESC
  `).all();
  res.json(invoices);
});

router.get('/:id', async (req: Request, res: Response) => {
  const db = getDb();
  const invoice = await db.prepare(`
    SELECT i.*, COALESCE(c.name, 'Walk-in') AS customer_name
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    WHERE i.id = ?
  `).get(req.params.id);
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }
  const items = await db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(req.params.id);
  const payments = await db.prepare('SELECT * FROM payments WHERE invoice_id = ?').all(req.params.id);
  res.json({ ...invoice as any, items, payments });
});

router.post('/', async (req: Request, res: Response) => {
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
    const customer = await db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
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
  let invoice_number = '';
  const insertMovement = db.prepare(
    'INSERT INTO stock_movements (id, material_id, type, quantity, reference_id, reference_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  const txn = db.transaction(async () => {
    const seq = await getSeq.get() as any;
    const num = seq.next_number;
    await updateSeq.run();
    invoice_number = `INV-${String(num).padStart(4, '0')}`;

    for (const materialId of usedMaterialIds) {
      const mat = await checkStock.get(materialId) as any;
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

    await db.prepare(
      'INSERT INTO invoices (id, customer_id, invoice_number, subtotal, tax_rate, total, due_date, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(invoiceId, customer_id || null, invoice_number, 0, tax_rate ?? 0, 0, due_date || null, (req as any).user?.id || null);

    let subtotal = 0;
    for (const item of items) {
      const lineTotal = item.quantity * item.unit_price;
      subtotal += lineTotal;
      await insertItem.run(uuidv4(), invoiceId, item.material_id || null, item.description.trim(), item.quantity, item.unit_price, Math.round(lineTotal * 100) / 100);
    }

    const appliedTaxRate = tax_rate ?? Number((await db.prepare("SELECT value FROM settings WHERE key = 'default_tax_rate'").get() as any)?.value ?? 0);
    const roundedSubtotal = Math.round(subtotal * 100) / 100;
    const taxAmount = Math.round(roundedSubtotal * Number(appliedTaxRate) * 100) / 100;
    const total = Math.round((roundedSubtotal + taxAmount) * 100) / 100;

    await db.prepare('UPDATE invoices SET subtotal = ?, tax_rate = ?, tax_amount = ?, total = ? WHERE id = ?')
      .run(roundedSubtotal, appliedTaxRate, taxAmount, total, invoiceId);

    for (const materialId of usedMaterialIds) {
      const qtyNeeded = items
        .filter((it: any) => it.material_id === materialId)
        .reduce((s: number, it: any) => s + it.quantity, 0);
      await deductStock.run(qtyNeeded, materialId);
      await insertMovement.run(uuidv4(), materialId, 'sale', -qtyNeeded, invoiceId, 'invoice', `Sold in ${invoice_number}`);
    }
  });

  try {
    await txn();
    await logAudit((req as any).user?.id || null, 'create', 'invoice', invoiceId, `Created ${invoice_number}`);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
    return;
  }

  const invoice = await db.prepare(`
    SELECT i.*, COALESCE(c.name, 'Walk-in') AS customer_name
    FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.id = ?
  `).get(invoiceId);
  const invoiceItems = await db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(invoiceId);
  res.status(201).json({ ...invoice as any, items: invoiceItems, payments: [] });
});

router.post('/:id/pay', async (req: Request, res: Response) => {
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

  const insertPayment = db.prepare(
    'INSERT INTO payments (id, invoice_id, amount, method, notes) VALUES (?, ?, ?, ?, ?)'
  );
  const getTotalPaid = db.prepare(
    'SELECT COALESCE(SUM(amount), 0) as paid FROM payments WHERE invoice_id = ?'
  );
  const updateStatusPaid = db.prepare(
    "UPDATE invoices SET status = 'paid', paid_date = datetime('now') WHERE id = ?"
  );
  const updateStatusPartial = db.prepare(
    "UPDATE invoices SET status = 'partial' WHERE id = ?"
  );
  const getInvoice = db.prepare('SELECT * FROM invoices WHERE id = ?');

  const paymentId = uuidv4();

  try {
    const txn = db.transaction(async () => {
      const invoice = await getInvoice.get(req.params.id) as any;
      if (!invoice) throw new Error('Invoice not found');

      const existingPaid = (await getTotalPaid.get(req.params.id) as any).paid;
      const remainingBalance = invoice.total - existingPaid;
      if (amount > remainingBalance) {
        throw new Error(`Payment of ${amount} exceeds remaining balance of ${remainingBalance}`);
      }

      await insertPayment.run(paymentId, req.params.id, amount, method, notes || null);
      const totalPaid = existingPaid + amount;

      if (totalPaid >= invoice.total) {
        await updateStatusPaid.run(req.params.id);
      } else if (totalPaid > 0) {
        await updateStatusPartial.run(req.params.id);
      }
    });
    await txn();
    await logAudit((req as any).user?.id || null, 'update', 'invoice', req.params.id as string, `Payment of ${amount} via ${method}`);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
    return;
  }

  res.status(201).json(await db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId));
});

router.post('/:id/return', async (req: Request, res: Response) => {
  const db = getDb();
  const { items } = req.body;
  if (!items || !items.length) {
    res.status(400).json({ error: 'At least one return item is required' });
    return;
  }

  const invoiceId = req.params.id as string;
    const inv = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as any;
  if (!inv) { res.status(404).json({ error: 'Invoice not found' }); return; }
  if (inv.status === 'pending') {
    res.status(400).json({ error: 'Cannot return items on an unpaid invoice — delete it instead' });
    return;
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.material_id) { res.status(400).json({ error: `Return item ${i + 1}: material is required` }); return; }
    if (!item.quantity || item.quantity <= 0) { res.status(400).json({ error: `Return item ${i + 1}: quantity must be > 0` }); return; }

      const lineItem = await db.prepare(
        'SELECT * FROM invoice_items WHERE invoice_id = ? AND material_id = ?'
      ).get(invoiceId, item.material_id) as any;
    if (!lineItem) { res.status(400).json({ error: `Material not found on this invoice` }); return; }
    if (item.quantity > lineItem.quantity) {
      res.status(400).json({ error: `Cannot return more than purchased (${lineItem.quantity})` });
      return;
    }
  }

  const restoreStock = db.prepare('UPDATE materials SET stock = stock + ? WHERE id = ?');
  const insertMovement = db.prepare(
    'INSERT INTO stock_movements (id, material_id, type, quantity, reference_id, reference_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  const txn = db.transaction(async () => {
    for (const item of items) {
      await restoreStock.run(item.quantity, item.material_id);
      await insertMovement.run(uuidv4(), item.material_id, 'return', item.quantity, invoiceId, 'invoice', `Returned from ${inv.invoice_number}`);
    }

    // Recalculate invoice balance
    const totalPaid = (await db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE invoice_id = ?').get(invoiceId) as any).total;
    const remainingBalance = inv.total - totalPaid;

    if (remainingBalance > 0) {
      await db.prepare("UPDATE invoices SET status = 'partial' WHERE id = ?").run(invoiceId);
    } else if (remainingBalance <= 0) {
      await db.prepare("UPDATE invoices SET status = 'paid', paid_date = datetime('now') WHERE id = ?").run(invoiceId);
    }
  });

  await txn();
  res.json(await db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId));
});

router.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  const db = getDb();
  const existing = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Invoice not found' }); return; }

  const insertMovement = db.prepare(
    'INSERT INTO stock_movements (id, material_id, type, quantity, reference_id, reference_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  const txn = db.transaction(async () => {
    const items = await db.prepare('SELECT material_id, quantity FROM invoice_items WHERE invoice_id = ?').all(req.params.id) as any[];
    for (const item of items) {
      if (item.material_id) {
        await db.prepare('UPDATE materials SET stock = stock + ? WHERE id = ?').run(item.quantity, item.material_id);
        await insertMovement.run(uuidv4(), item.material_id, 'sale', item.quantity, req.params.id, 'invoice', `Restored from deleted invoice ${existing.invoice_number}`);
      }
    }
    await db.prepare('DELETE FROM payments WHERE invoice_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM invoices WHERE id = ?').run(req.params.id);
  });
  await txn();
  await logAudit((req as any).user?.id || null, 'delete', 'invoice', req.params.id as string, `Deleted ${existing.invoice_number}`);
  res.status(204).end();
});

export default router;
