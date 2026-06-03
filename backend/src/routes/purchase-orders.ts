import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/setup';
import { requireAdmin } from '../lib/auth';
import { logAudit } from '../lib/audit';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const pos = db.prepare(`
    SELECT po.*, s.name AS supplier_name
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    ORDER BY po.created_at DESC
  `).all();
  res.json(pos);
});

router.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const po = db.prepare(`
    SELECT po.*, s.name AS supplier_name
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.id = ?
  `).get(req.params.id);
  if (!po) { res.status(404).json({ error: 'Purchase order not found' }); return; }
  const items = db.prepare(`
    SELECT pi.*, COALESCE(m.name, pi.description) AS material_name, m.unit
    FROM po_items pi
    LEFT JOIN materials m ON m.id = pi.material_id
    WHERE pi.po_id = ?
  `).all(req.params.id);
  res.json({ ...po as any, items });
});

router.post('/', (req: Request, res: Response) => {
  const db = getDb();
  const { supplier_id, items, order_date } = req.body;

  if (!supplier_id) { res.status(400).json({ error: 'Supplier is required' }); return; }
  if (!items || !items.length) { res.status(400).json({ error: 'At least one item is required' }); return; }
  if (!order_date) { res.status(400).json({ error: 'Order date is required' }); return; }

  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplier_id);
  if (!supplier) { res.status(404).json({ error: 'Supplier not found' }); return; }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.description || !item.description.trim()) {
      res.status(400).json({ error: `Item ${i + 1}: description is required` }); return;
    }
    if (!item.quantity || item.quantity <= 0) {
      res.status(400).json({ error: `Item ${i + 1}: quantity must be greater than 0` }); return;
    }
    if (!item.unit_cost || item.unit_cost < 0) {
      res.status(400).json({ error: `Item ${i + 1}: unit cost must be >= 0` }); return;
    }
  }

  const poId = uuidv4();
  const insertItem = db.prepare(
    'INSERT INTO po_items (id, po_id, material_id, description, quantity, unit_cost, total) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const getSeq = db.prepare('SELECT next_number FROM po_sequence WHERE id = 1');
  const updateSeq = db.prepare('UPDATE po_sequence SET next_number = next_number + 1 WHERE id = 1');
  let poNumber = '';

  const txn = db.transaction(() => {
    const seq = getSeq.get() as any;
    const num = seq.next_number;
    updateSeq.run();
    poNumber = `PO-${String(num).padStart(4, '0')}`;

    let total = 0;
    for (const item of items) {
      const lineTotal = item.quantity * item.unit_cost;
      total += lineTotal;
    }
    total = Math.round(total * 100) / 100;

    db.prepare(
      'INSERT INTO purchase_orders (id, supplier_id, po_number, status, total, order_date) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(poId, supplier_id, poNumber, 'pending', total, order_date);

    for (const item of items) {
      const lineTotal = Math.round((item.quantity * item.unit_cost) * 100) / 100;
      insertItem.run(uuidv4(), poId, item.material_id || null, item.description.trim(), item.quantity, item.unit_cost, lineTotal);
    }
  });

  txn();

  const po = db.prepare(`
    SELECT po.*, s.name AS supplier_name
    FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?
  `).get(poId);
  const poItems = db.prepare('SELECT * FROM po_items WHERE po_id = ?').all(poId);
  logAudit((req as any).user?.id || null, 'create', 'purchase_order', poId, poNumber);
  res.status(201).json({ ...po as any, items: poItems });
});

router.put('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Purchase order not found' }); return; }
  if (existing.status !== 'pending') {
    res.status(400).json({ error: 'Only pending purchase orders can be edited' }); return;
  }

  const { supplier_id, items, order_date } = req.body;

  if (supplier_id) {
    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplier_id);
    if (!supplier) { res.status(404).json({ error: 'Supplier not found' }); return; }
  }

  const txn = db.transaction(() => {
    if (supplier_id) {
      db.prepare('UPDATE purchase_orders SET supplier_id = ?, order_date = ? WHERE id = ?')
        .run(supplier_id, order_date || existing.order_date, req.params.id);
    } else if (order_date) {
      db.prepare('UPDATE purchase_orders SET order_date = ? WHERE id = ?').run(order_date, req.params.id);
    }

    if (items && items.length) {
      db.prepare('DELETE FROM po_items WHERE po_id = ?').run(req.params.id);
      const insertItem = db.prepare(
        'INSERT INTO po_items (id, po_id, material_id, description, quantity, unit_cost, total) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      let total = 0;
      for (const item of items) {
        const lineTotal = Math.round((item.quantity * item.unit_cost) * 100) / 100;
        total += lineTotal;
        insertItem.run(uuidv4(), req.params.id, item.material_id || null, item.description.trim(), item.quantity, item.unit_cost, lineTotal);
      }
      total = Math.round(total * 100) / 100;
      db.prepare('UPDATE purchase_orders SET total = ? WHERE id = ?').run(total, req.params.id);
    }
  });

  txn();
  res.json(db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id));
});

router.put('/:id/receive', requireAdmin, (req: Request, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Purchase order not found' }); return; }
  if (existing.status !== 'pending') {
    res.status(400).json({ error: 'Only pending purchase orders can be received' }); return;
  }

  const poItems = db.prepare('SELECT * FROM po_items WHERE po_id = ?').all(req.params.id) as any[];
  const updateStock = db.prepare('UPDATE materials SET stock = stock + ? WHERE id = ?');
  const insertMovement = db.prepare(
    'INSERT INTO stock_movements (id, material_id, type, quantity, reference_id, reference_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  const txn = db.transaction(() => {
    for (const item of poItems) {
      if (item.material_id) {
        updateStock.run(item.quantity, item.material_id);
        insertMovement.run(uuidv4(), item.material_id, 'po', item.quantity, req.params.id, 'purchase_order', `Received from PO ${existing.po_number}`);
      }
    }
    db.prepare("UPDATE purchase_orders SET status = 'received', received_date = datetime('now') WHERE id = ?").run(req.params.id);
  });

  txn();
  logAudit((req as any).user?.id || null, 'update', 'purchase_order', req.params.id as string, `Received ${existing.po_number}`);
  res.json(db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id));
});

router.put('/:id/cancel', requireAdmin, (req: Request, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Purchase order not found' }); return; }
  if (existing.status !== 'pending') {
    res.status(400).json({ error: 'Only pending purchase orders can be cancelled' }); return;
  }
  db.prepare("UPDATE purchase_orders SET status = 'cancelled' WHERE id = ?").run(req.params.id);
  logAudit((req as any).user?.id || null, 'update', 'purchase_order', req.params.id as string, `Cancelled ${existing.po_number}`);
  res.json(db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id));
});

router.delete('/:id', requireAdmin, (req: Request, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Purchase order not found' }); return; }
  if (existing.status !== 'pending') {
    res.status(400).json({ error: 'Only pending purchase orders can be deleted' }); return;
  }
  const txn = db.transaction(() => {
    db.prepare('DELETE FROM po_items WHERE po_id = ?').run(req.params.id);
    db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(req.params.id);
  });
  txn();
  logAudit((req as any).user?.id || null, 'delete', 'purchase_order', req.params.id as string, existing.po_number);
  res.status(204).send();
});

export default router;
