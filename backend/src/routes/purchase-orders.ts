import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/setup';
import { requireAdmin } from '../lib/auth';
import { logAudit } from '../lib/audit';

const router = Router();

function validateItems(items: any[]): string | null {
  if (!Array.isArray(items) || !items.length) return 'At least one item is required';
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item.description !== 'string' || !item.description.trim()) return `Item ${i + 1}: description is required`;
    if (typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0) return `Item ${i + 1}: quantity must be greater than 0`;
    if (typeof item.unit_cost !== 'number' || !Number.isFinite(item.unit_cost) || item.unit_cost < 0) return `Item ${i + 1}: unit cost must be >= 0`;
  }
  return null;
}

router.get('/', async (_req: Request, res: Response) => {
  const db = getDb();
  const pos = await db.prepare(`
    SELECT po.*, s.name AS supplier_name
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    ORDER BY po.created_at DESC
  `).all();
  res.json(pos);
});

router.get('/:id', async (req: Request, res: Response) => {
  const db = getDb();
  const po = await db.prepare(`
    SELECT po.*, s.name AS supplier_name
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.id = ?
  `).get(req.params.id);
  if (!po) { res.status(404).json({ error: 'Purchase order not found' }); return; }
  const items = await db.prepare(`
    SELECT pi.*, COALESCE(m.name, pi.description) AS material_name, m.unit
    FROM po_items pi
    LEFT JOIN materials m ON m.id = pi.material_id
    WHERE pi.po_id = ?
  `).all(req.params.id);
  res.json({ ...po as any, items });
});

router.post('/', async (req: Request, res: Response) => {
  const db = getDb();
  const { supplier_id, items, order_date } = req.body;

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
    'INSERT INTO po_items (id, po_id, material_id, description, quantity, unit_cost, total) VALUES (?, ?, ?, ?, ?, ?, ?)'
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
      'INSERT INTO purchase_orders (id, supplier_id, po_number, status, total, order_date) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(poId, supplier_id, poNumber, 'pending', total, order_date);

    for (const item of items) {
      const lineTotal = Math.round((item.quantity * item.unit_cost) * 100) / 100;
      await insertItem.run(uuidv4(), poId, item.material_id || null, item.description.trim(), item.quantity, item.unit_cost, lineTotal);
    }
  });

  await txn();

  const po = await db.prepare(`
    SELECT po.*, s.name AS supplier_name
    FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?
  `).get(poId);
  const poItems = await db.prepare('SELECT * FROM po_items WHERE po_id = ?').all(poId);
  await logAudit((req as any).user?.id || null, 'create', 'purchase_order', poId, poNumber);
  res.status(201).json({ ...po as any, items: poItems });
});

router.put('/:id', async (req: Request, res: Response) => {
  const db = getDb();
  const existing = await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Purchase order not found' }); return; }
  if (existing.status !== 'pending') {
    res.status(400).json({ error: 'Only pending purchase orders can be edited' }); return;
  }

  const { supplier_id, items, order_date } = req.body;

  if (order_date !== undefined && (typeof order_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(order_date))) { res.status(400).json({ error: 'Invalid order date' }); return; }
  if (items !== undefined) { const itemError = validateItems(items); if (itemError) { res.status(400).json({ error: itemError }); return; } }

  if (supplier_id) {
  const supplier = await db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplier_id);
    if (!supplier) { res.status(404).json({ error: 'Supplier not found' }); return; }
  }

  const txn = db.transaction(async () => {
    if (supplier_id) {
      await db.prepare('UPDATE purchase_orders SET supplier_id = ?, order_date = ? WHERE id = ?')
        .run(supplier_id, order_date || existing.order_date, req.params.id);
    } else if (order_date) {
      await db.prepare('UPDATE purchase_orders SET order_date = ? WHERE id = ?').run(order_date, req.params.id);
    }

    if (items && items.length) {
      await db.prepare('DELETE FROM po_items WHERE po_id = ?').run(req.params.id);
      let total = 0;
      for (const item of items) {
        const lineTotal = Math.round((item.quantity * item.unit_cost) * 100) / 100;
        total += lineTotal;
        await db.prepare(
          'INSERT INTO po_items (id, po_id, material_id, description, quantity, unit_cost, total) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), req.params.id, item.material_id || null, item.description.trim(), item.quantity, item.unit_cost, lineTotal);
      }
      total = Math.round(total * 100) / 100;
      await db.prepare('UPDATE purchase_orders SET total = ? WHERE id = ?').run(total, req.params.id);
    }
  });

  await txn();
  res.json(await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id));
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
  const updateStock = db.prepare('UPDATE materials SET stock = stock + ? WHERE id = ?');
  const insertMovement = db.prepare(
    'INSERT INTO stock_movements (id, material_id, type, quantity, reference_id, reference_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  const txn = db.transaction(async () => {
    for (const item of poItems) {
      if (item.material_id) {
        await updateStock.run(item.quantity, item.material_id);
        await insertMovement.run(uuidv4(), item.material_id, 'po', item.quantity, req.params.id, 'purchase_order', `Received from PO ${existing.po_number}`);
      }
    }
    await db.prepare("UPDATE purchase_orders SET status = 'received', received_date = datetime('now') WHERE id = ?").run(req.params.id);
  });

  await txn();
  await logAudit((req as any).user?.id || null, 'update', 'purchase_order', req.params.id as string, `Received ${existing.po_number}`);
  res.json(await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id));
});

router.put('/:id/cancel', requireAdmin, async (req: Request, res: Response) => {
  const db = getDb();
  const existing = await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Purchase order not found' }); return; }
  if (existing.status !== 'pending') {
    res.status(400).json({ error: 'Only pending purchase orders can be cancelled' }); return;
  }
  await db.prepare("UPDATE purchase_orders SET status = 'cancelled' WHERE id = ?").run(req.params.id);
  await logAudit((req as any).user?.id || null, 'update', 'purchase_order', req.params.id as string, `Cancelled ${existing.po_number}`);
  res.json(await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id));
});

router.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  const db = getDb();
  const existing = await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Purchase order not found' }); return; }
  if (existing.status !== 'pending') {
    res.status(400).json({ error: 'Only pending purchase orders can be deleted' }); return;
  }
  const txn = db.transaction(async () => {
    await db.prepare('DELETE FROM po_items WHERE po_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(req.params.id);
  });
  await txn();
  await logAudit((req as any).user?.id || null, 'delete', 'purchase_order', req.params.id as string, existing.po_number);
  res.status(204).send();
});

export default router;
