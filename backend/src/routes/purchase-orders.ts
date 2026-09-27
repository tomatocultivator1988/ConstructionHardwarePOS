import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/setup';
import { requireAdmin } from '../lib/auth';
import { logAudit } from '../lib/audit';

const router = Router();
router.use(requireAdmin);

function validateItems(items: any[]): string | null {
  if (!Array.isArray(items) || !items.length) return 'At least one item is required';
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item.description !== 'string' || !item.description.trim()) return `Item ${i + 1}: description is required`;
    if (typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0) return `Item ${i + 1}: quantity must be greater than 0`;
    if (typeof item.unit_cost !== 'number' || !Number.isFinite(item.unit_cost) || item.unit_cost < 0) return `Item ${i + 1}: unit cost must be >= 0`;
    if (item.selling_price !== undefined && (typeof item.selling_price !== 'number' || !Number.isFinite(item.selling_price) || item.selling_price < 0)) return `Item ${i + 1}: selling price must be >= 0`;
    if (item.average_price !== undefined && (typeof item.average_price !== 'number' || !Number.isFinite(item.average_price) || item.average_price < 0)) return `Item ${i + 1}: average price must be >= 0`;
  }
  return null;
}

router.get('/', async (_req: Request, res: Response) => {
  const db = getDb();
  const pos = await db.prepare(`
    SELECT po.*, s.name AS supplier_name,
      CASE 
        WHEN lower(trim(COALESCE(po.mode_of_payment, ''))) = 'credit' THEN COALESCE((SELECT SUM(amount) FROM po_payments WHERE po_id = po.id), 0)
        ELSE po.total
      END AS paid_amount,
      CASE 
        WHEN lower(trim(COALESCE(po.mode_of_payment, ''))) = 'credit' THEN MAX(0, po.total - COALESCE((SELECT SUM(amount) FROM po_payments WHERE po_id = po.id), 0))
        ELSE 0
      END AS balance,
      CASE 
        WHEN lower(trim(COALESCE(po.mode_of_payment, ''))) != 'credit' THEN 'paid'
        WHEN (po.total - COALESCE((SELECT SUM(amount) FROM po_payments WHERE po_id = po.id), 0)) <= 0.005 THEN 'paid'
        WHEN COALESCE((SELECT SUM(amount) FROM po_payments WHERE po_id = po.id), 0) > 0.005 THEN 'partial'
        ELSE 'unpaid'
      END AS payment_status
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    ORDER BY po.created_at DESC
  `).all();
  res.json(pos);
});

router.get('/:id', async (req: Request, res: Response) => {
  const db = getDb();
  const po = await db.prepare(`
    SELECT po.*, s.name AS supplier_name,
      CASE 
        WHEN lower(trim(COALESCE(po.mode_of_payment, ''))) = 'credit' THEN COALESCE((SELECT SUM(amount) FROM po_payments WHERE po_id = po.id), 0)
        ELSE po.total
      END AS paid_amount,
      CASE 
        WHEN lower(trim(COALESCE(po.mode_of_payment, ''))) = 'credit' THEN MAX(0, po.total - COALESCE((SELECT SUM(amount) FROM po_payments WHERE po_id = po.id), 0))
        ELSE 0
      END AS balance,
      CASE 
        WHEN lower(trim(COALESCE(po.mode_of_payment, ''))) != 'credit' THEN 'paid'
        WHEN (po.total - COALESCE((SELECT SUM(amount) FROM po_payments WHERE po_id = po.id), 0)) <= 0.005 THEN 'paid'
        WHEN COALESCE((SELECT SUM(amount) FROM po_payments WHERE po_id = po.id), 0) > 0.005 THEN 'partial'
        ELSE 'unpaid'
      END AS payment_status
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.id = ?
  `).get(req.params.id);
  if (!po) { res.status(404).json({ error: 'Purchase order not found' }); return; }
  const items = await db.prepare(`
    SELECT pi.*, COALESCE(m.name, pi.description) AS material_name, m.unit, m.price_per_unit
    FROM po_items pi
    LEFT JOIN materials m ON m.id = pi.material_id
    WHERE pi.po_id = ?
  `).all(req.params.id);
  const payments = await db.prepare(`
    SELECT pop.*, u.username AS created_by_name
    FROM po_payments pop
    LEFT JOIN users u ON u.id = pop.created_by
    WHERE pop.po_id = ?
    ORDER BY pop.payment_date DESC, pop.created_at DESC
  `).all(req.params.id);
  res.json({ ...po as any, items, payments });
});

router.post('/', async (req: Request, res: Response) => {
  const db = getDb();
  const { supplier_id, items, order_date, notes, mode_of_payment } = req.body;

  if (!supplier_id) { res.status(400).json({ error: 'Supplier is required' }); return; }
  if (!items || !items.length) { res.status(400).json({ error: 'At least one item is required' }); return; }
  if (!order_date) { res.status(400).json({ error: 'Order date is required' }); return; }

    const supplier = await db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplier_id);
  if (!supplier) { res.status(404).json({ error: 'Supplier not found' }); return; }

  const itemError = validateItems(items);
  if (itemError) { res.status(400).json({ error: itemError }); return; }
  const materialIds = [...new Set(items.filter((item: any) => item.material_id).map((item: any) => item.material_id))];
  if (materialIds.length) {
    const placeholders = materialIds.map(() => '?').join(',');
    const existingMaterials = await db.prepare(`SELECT id FROM materials WHERE id IN (${placeholders})`).all(...materialIds) as any[];
    if (existingMaterials.length !== materialIds.length) { res.status(400).json({ error: 'One or more materials do not exist' }); return; }
  }

  const poId = uuidv4();
  const insertItem = db.prepare(
    'INSERT INTO po_items (id, po_id, material_id, description, quantity, unit_cost, selling_price, average_price, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const getSeq = db.prepare('SELECT next_number FROM po_sequence WHERE id = 1');
  const updateSeq = db.prepare('UPDATE po_sequence SET next_number = next_number + 1 WHERE id = 1');
  let poNumber = '';

  const txn = db.transaction(async () => {
    const seq = await getSeq.get() as any;
    const num = seq.next_number;
    await updateSeq.run();
    poNumber = `PO-${String(num).padStart(4, '0')}`;

    let total = 0;
    for (const item of items) {
      const lineTotal = item.quantity * item.unit_cost;
      total += lineTotal;
    }
    total = Math.round(total * 100) / 100;

    await db.prepare(
      'INSERT INTO purchase_orders (id, supplier_id, po_number, status, total, order_date, notes, mode_of_payment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(poId, supplier_id, poNumber, 'pending', total, order_date, notes?.trim() || null, mode_of_payment?.trim() || null);

    for (const item of items) {
      const lineTotal = Math.round((item.quantity * item.unit_cost) * 100) / 100;
      await insertItem.run(uuidv4(), poId, item.material_id || null, item.description.trim(), item.quantity, item.unit_cost, item.selling_price ?? null, item.average_price ?? null, lineTotal);
    }
  });

  await txn();

  const po = await db.prepare(`
    SELECT po.*, s.name AS supplier_name
    FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?
  `).get(poId);
  const poItems = await db.prepare('SELECT * FROM po_items WHERE po_id = ?').all(poId);
  const created = { ...po as any, items: poItems };
  await logAudit((req as any).user?.id || null, 'create', 'purchase_order', poId, poNumber, null, created);
  res.status(201).json(created);
});

router.put('/:id', async (req: Request, res: Response) => {
  const db = getDb();
  const existing = await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Purchase order not found' }); return; }
  if (existing.status === 'cancelled') {
    res.status(400).json({ error: 'Cancelled purchase orders cannot be edited' }); return;
  }

  const { supplier_id, items, order_date, notes, mode_of_payment } = req.body;

  if (order_date !== undefined && (typeof order_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(order_date))) { res.status(400).json({ error: 'Invalid order date' }); return; }
  if (items !== undefined) {
    const itemError = validateItems(items);
    if (itemError) { res.status(400).json({ error: itemError }); return; }
    const materialIds = [...new Set(items.filter((item: any) => item.material_id).map((item: any) => item.material_id))];
    if (materialIds.length) {
      const placeholders = materialIds.map(() => '?').join(',');
      const existingMaterials = await db.prepare(`SELECT id FROM materials WHERE id IN (${placeholders})`).all(...materialIds) as any[];
      if (existingMaterials.length !== materialIds.length) { res.status(400).json({ error: 'One or more materials do not exist' }); return; }
    }
  }

  if (supplier_id) {
  const supplier = await db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplier_id);
    if (!supplier) { res.status(404).json({ error: 'Supplier not found' }); return; }
  }

  const txn = db.transaction(async () => {
    const oldItems = await db.prepare('SELECT material_id, quantity FROM po_items WHERE po_id = ?').all(req.params.id) as any[];
    const oldQty = new Map<string, number>();
    oldItems.forEach((item: any) => { if (item.material_id) oldQty.set(item.material_id, (oldQty.get(item.material_id) || 0) + Number(item.quantity || 0)); });
    if (supplier_id) {
      await db.prepare('UPDATE purchase_orders SET supplier_id = ?, order_date = ?, notes = ?, mode_of_payment = ? WHERE id = ?')
        .run(supplier_id, order_date || existing.order_date, notes !== undefined ? (String(notes).trim() || null) : existing.notes, mode_of_payment !== undefined ? (String(mode_of_payment).trim() || null) : existing.mode_of_payment, req.params.id);
    } else if (order_date) {
      await db.prepare('UPDATE purchase_orders SET order_date = ?, notes = ?, mode_of_payment = ? WHERE id = ?').run(order_date, notes !== undefined ? (String(notes).trim() || null) : existing.notes, mode_of_payment !== undefined ? (String(mode_of_payment).trim() || null) : existing.mode_of_payment, req.params.id);
    } else if (notes !== undefined) {
      await db.prepare('UPDATE purchase_orders SET notes = ? WHERE id = ?').run(String(notes).trim() || null, req.params.id);
    } else if (mode_of_payment !== undefined) {
      await db.prepare('UPDATE purchase_orders SET mode_of_payment = ? WHERE id = ?').run(String(mode_of_payment).trim() || null, req.params.id);
    }

    if (items && items.length) {
      await db.prepare('DELETE FROM po_items WHERE po_id = ?').run(req.params.id);
      let total = 0;
      for (const item of items) {
        const lineTotal = Math.round((item.quantity * item.unit_cost) * 100) / 100;
        total += lineTotal;
        await db.prepare(
          'INSERT INTO po_items (id, po_id, material_id, description, quantity, unit_cost, selling_price, average_price, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), req.params.id, item.material_id || null, item.description.trim(), item.quantity, item.unit_cost, item.selling_price ?? null, item.average_price ?? null, lineTotal);
      }
      total = Math.round(total * 100) / 100;
      await db.prepare('UPDATE purchase_orders SET total = ? WHERE id = ?').run(total, req.params.id);

      if (existing.status === 'received') {
        const newQty = new Map<string, number>();
        items.forEach((item: any) => { if (item.material_id) newQty.set(item.material_id, (newQty.get(item.material_id) || 0) + Number(item.quantity || 0)); });
        const ids = new Set([...oldQty.keys(), ...newQty.keys()]);
        const adjustStock = db.prepare('UPDATE materials SET stock = stock + ?, cost_price = ?, price_per_unit = COALESCE(?, price_per_unit), updated_at = datetime(\'now\') WHERE id = ?');
        const insertAdjustment = db.prepare('INSERT INTO stock_movements (id, material_id, type, quantity, reference_id, reference_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?)');
        for (const materialId of ids) {
          const delta = (newQty.get(materialId) || 0) - (oldQty.get(materialId) || 0);
          const latest = items.find((item: any) => item.material_id === materialId);
          if (!latest) {
            const current = await db.prepare('SELECT cost_price FROM materials WHERE id = ?').get(materialId) as any;
            await db.prepare('UPDATE materials SET stock = stock + ?, updated_at = datetime(\'now\') WHERE id = ?').run(delta, materialId);
            await insertAdjustment.run(uuidv4(), materialId, 'po_adjustment', delta, req.params.id, 'purchase_order', `Adjusted received PO ${existing.po_number}`);
            continue;
          }
          await adjustStock.run(delta, latest.unit_cost, latest.selling_price, materialId);
          if (Math.abs(delta) > 0.000001) await insertAdjustment.run(uuidv4(), materialId, 'po_adjustment', delta, req.params.id, 'purchase_order', `Adjusted received PO ${existing.po_number}`);
        }
      }
    }
  });

  await txn();
  const updated = await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  await logAudit((req as any).user?.id || null, 'update', 'purchase_order', req.params.id as string, `Updated ${existing.po_number}`, existing, updated);
  res.json(updated);
});

router.put('/:id/receive', requireAdmin, async (req: Request, res: Response) => {
  const db = getDb();
  const existing = await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Purchase order not found' }); return; }
  if (existing.status !== 'pending') {
    res.status(400).json({ error: 'Only pending purchase orders can be received' }); return;
  }

  const poItems = await db.prepare('SELECT * FROM po_items WHERE po_id = ?').all(req.params.id) as any[];
  const materialIds = [...new Set(poItems.filter((item: any) => item.material_id).map((item: any) => item.material_id))];
  if (materialIds.length) {
    const placeholders = materialIds.map(() => '?').join(',');
    const existingMaterials = await db.prepare(`SELECT id FROM materials WHERE id IN (${placeholders})`).all(...materialIds) as any[];
    if (existingMaterials.length !== materialIds.length) { res.status(409).json({ error: 'Purchase order contains a missing material' }); return; }
  }
  const updateStock = db.prepare('UPDATE materials SET stock = stock + ?, cost_price = ?, price_per_unit = COALESCE(?, price_per_unit), updated_at = datetime(\'now\') WHERE id = ?');
  const insertMovement = db.prepare(
    'INSERT INTO stock_movements (id, material_id, type, quantity, reference_id, reference_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  const txn = db.transaction(async () => {
    for (const item of poItems) {
      if (item.material_id) {
        await updateStock.run(item.quantity, item.unit_cost, item.selling_price, item.material_id);
        await insertMovement.run(uuidv4(), item.material_id, 'po', item.quantity, req.params.id, 'purchase_order', `Received from PO ${existing.po_number}`);
      }
    }
    await db.prepare("UPDATE purchase_orders SET status = 'received', received_date = datetime('now') WHERE id = ?").run(req.params.id);
  });

  await txn();
  const received = await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  await logAudit((req as any).user?.id || null, 'update', 'purchase_order', req.params.id as string, `Received ${existing.po_number}`, existing, received);
  res.json(received);
});

router.put('/:id/cancel', requireAdmin, async (req: Request, res: Response) => {
  const db = getDb();
  const existing = await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Purchase order not found' }); return; }
  if (existing.status !== 'pending') {
    res.status(400).json({ error: 'Only pending purchase orders can be cancelled' }); return;
  }
  await db.prepare("UPDATE purchase_orders SET status = 'cancelled' WHERE id = ?").run(req.params.id);
  const cancelled = await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  await logAudit((req as any).user?.id || null, 'update', 'purchase_order', req.params.id as string, `Cancelled ${existing.po_number}`, existing, cancelled);
  res.json(cancelled);
});

router.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  const db = getDb();
  const existing = await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Purchase order not found' }); return; }
  if (existing.status !== 'cancelled') {
    res.status(400).json({ error: 'Only cancelled purchase orders can be deleted' }); return;
  }
  const txn = db.transaction(async () => {
    await db.prepare('DELETE FROM po_items WHERE po_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(req.params.id);
  });
  await txn();
  await logAudit((req as any).user?.id || null, 'delete', 'purchase_order', req.params.id as string, existing.po_number, existing, null);
  res.status(204).send();
});

router.post('/:id/payments', requireAdmin, async (req: Request, res: Response) => {
  const db = getDb();
  const po = await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id) as any;
  if (!po) { res.status(404).json({ error: 'Purchase order not found' }); return; }
  if (po.status === 'cancelled') { res.status(400).json({ error: 'Cannot pay a cancelled purchase order' }); return; }

  const amount = Number(req.body.amount);
  const payment_method = String(req.body.payment_method || 'cash').trim().toLowerCase();
  const payment_date = req.body.payment_date ? String(req.body.payment_date).trim() : new Date().toISOString().slice(0, 10);
  const notes = req.body.notes !== undefined ? (String(req.body.notes).trim() || null) : null;
  const reference_number = req.body.reference_number !== undefined ? (String(req.body.reference_number).trim() || null) : null;

  if (isNaN(amount) || amount <= 0) {
    res.status(400).json({ error: 'Payment amount must be greater than 0' });
    return;
  }

  const currentPaid = await db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM po_payments WHERE po_id = ?').get(req.params.id) as any;
  const balance = Math.max(0, po.total - Number(currentPaid?.total || 0));

  if (amount > balance + 0.005) {
    res.status(400).json({ error: `Payment amount (${amount}) exceeds remaining balance (${balance.toFixed(2)})` });
    return;
  }

  const paymentId = uuidv4();
  const userId = (req as any).user?.id || null;

  await db.prepare(`
    INSERT INTO po_payments (id, po_id, amount, payment_method, payment_date, reference_number, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(paymentId, req.params.id, amount, payment_method, payment_date, reference_number, notes, userId);

  await logAudit(userId, 'create', 'po_payment', paymentId, `Payment of ₱${amount} for PO ${po.po_number}`, null, { amount, payment_method, payment_date, po_number: po.po_number });

  const updatedPaid = Number(currentPaid?.total || 0) + amount;
  const updatedBalance = Math.max(0, po.total - updatedPaid);
  const payment_status = updatedBalance <= 0.005 ? 'paid' : 'partial';

  res.status(201).json({
    ok: true,
    payment: { id: paymentId, po_id: req.params.id, amount, payment_method, payment_date, reference_number, notes },
    paid_amount: updatedPaid,
    balance: updatedBalance,
    payment_status
  });
});

router.delete('/:id/payments/:paymentId', requireAdmin, async (req: Request, res: Response) => {
  const db = getDb();
  const payment = await db.prepare('SELECT * FROM po_payments WHERE id = ? AND po_id = ?').get(req.params.paymentId, req.params.id) as any;
  if (!payment) { res.status(404).json({ error: 'Payment not found' }); return; }

  await db.prepare('DELETE FROM po_payments WHERE id = ?').run(req.params.paymentId);
  await logAudit((req as any).user?.id || null, 'delete', 'po_payment', String(req.params.paymentId), `Voided payment of ₱${payment.amount} for PO ${req.params.id}`, payment, null);

  res.json({ ok: true });
});

export default router;
