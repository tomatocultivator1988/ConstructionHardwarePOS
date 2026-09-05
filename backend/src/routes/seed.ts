import { Router, Request, Response } from 'express';
import { getDb } from '../db/setup';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { requireAdmin } from '../lib/auth';

const router = Router();

// Small, idempotent demo set for testing the Receivables screen. It is separate
// from the larger random seed so it cannot silently flood a production database.
router.post('/receivables', requireAdmin, async (_req: Request, res: Response) => {
  const db = getDb();
  const names = ['TEST CREDIT - Unpaid', 'TEST CREDIT - Partial', 'TEST CREDIT - Paid'];
  const existing = await db.prepare(`SELECT invoice_number FROM invoices WHERE credit_account_name IN (?,?,?)`).all(...names) as any[];
  if (existing.length === names.length) { res.json({ ok: true, created: 0, message: 'Receivables demo records already exist' }); return; }
  const materials = await db.prepare('SELECT id, name, unit, stock, cost_price, price_per_unit FROM materials WHERE stock >= 5 ORDER BY name LIMIT 3').all() as any[];
  if (materials.length < 3) { res.status(400).json({ error: 'At least 3 products with stock of 5 or more are needed' }); return; }
  const adminId = ((await db.prepare("SELECT id FROM users WHERE username='admin'").get()) as any)?.id || null;
  const usedNames = new Set(existing.map(row => row.invoice_number));
  const getSeq = db.prepare('SELECT next_number FROM invoice_sequence WHERE id=1');
  const bumpSeq = db.prepare('UPDATE invoice_sequence SET next_number=next_number+1 WHERE id=1');
  const insertInvoice = db.prepare('INSERT INTO invoices (id,customer_id,invoice_number,subtotal,tax_rate,tax_amount,total,status,credit_account_name,user_id) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const insertItem = db.prepare('INSERT INTO invoice_items (id,invoice_id,material_id,description,quantity,unit_price,cost_price,total) VALUES (?,?,?,?,?,?,?,?)');
  const insertPayment = db.prepare('INSERT INTO payments (id,invoice_id,amount,method,notes) VALUES (?,?,?,?,?)');
  const reduceStock = db.prepare('UPDATE materials SET stock=stock-? WHERE id=?');
  const insertMovement = db.prepare('INSERT INTO stock_movements (id,material_id,type,quantity,reference_id,reference_type,notes) VALUES (?,?,?,?,?,?,?)');
  const created: string[] = [];
  const txn = db.transaction(async () => {
    for (let index = 0; index < names.length; index++) {
      if (usedNames.has(names[index])) continue;
      const material = materials[index];
      const quantity = index + 1;
      const total = Math.round(quantity * Number(material.price_per_unit) * 100) / 100;
      const invoiceId = uuidv4();
      const seq = await getSeq.get() as any;
      const invoiceNumber = `INV-${String(seq.next_number).padStart(4, '0')}`;
      await bumpSeq.run();
      await insertInvoice.run(invoiceId, null, invoiceNumber, total, 0, 0, total, index === 2 ? 'paid' : index === 1 ? 'partial' : 'pending', names[index], adminId);
      await insertItem.run(uuidv4(), invoiceId, material.id, material.name, quantity, material.price_per_unit, material.cost_price || 0, total);
      await reduceStock.run(quantity, material.id);
      await insertMovement.run(uuidv4(), material.id, 'sale', -quantity, invoiceId, 'invoice', `Demo receivable ${invoiceNumber}`);
      if (index === 1) await insertPayment.run(uuidv4(), invoiceId, Math.round(total / 2 * 100) / 100, 'cash', 'Demo partial payment');
      if (index === 2) await insertPayment.run(uuidv4(), invoiceId, total, 'cash', 'Demo paid credit sale');
      created.push(invoiceNumber);
    }
  });
  await txn();
  res.status(201).json({ ok: true, created: created.length, invoices: created, message: 'Clearly labelled demo receivables created' });
});

router.post('/', requireAdmin, async (_req: Request, res: Response) => {
  const db = getDb();

  // --- Staff user ---
  const existingStaff = await db.prepare("SELECT id FROM users WHERE username='juan'").get() as any;
  if (!existingStaff) {
    await db.prepare('INSERT INTO users (id, username, pin_hash, role) VALUES (?, ?, ?, ?)').run(uuidv4(), 'juan', bcrypt.hashSync('1234', 10), 'staff');
  }

  // --- Materials ---
  const mats = [
    {n:'Portland Cement',u:'Bag',s:500,c:195,p:250,r:50,ct:'Cement',w:230},
    {n:'Steel Rebar 10mm',u:'Piece',s:300,c:120,p:165,r:30,ct:'Steel/Rebar',w:150},
    {n:'Steel Rebar 12mm',u:'Piece',s:250,c:160,p:210,r:25,ct:'Steel/Rebar',w:190},
    {n:'Marine Plywood 1/2',u:'Piece',s:150,c:450,p:580,r:20,ct:'Lumber/Wood',w:530},
    {n:'Marine Plywood 3/4',u:'Piece',s:120,c:620,p:780,r:15,ct:'Lumber/Wood',w:720},
    {n:'PVC Pipe 1/2',u:'Piece',s:400,c:45,p:65,r:40,ct:'Plumbing',w:58},
    {n:'PVC Pipe 3/4',u:'Piece',s:350,c:60,p:85,r:35,ct:'Plumbing',w:75},
    {n:'GI Pipe 1/2',u:'Piece',s:200,c:180,p:240,r:20,ct:'Plumbing',w:220},
    {n:'Electrical Wire #12',u:'Roll',s:100,c:850,p:1100,r:10,ct:'Electrical',w:1000},
    {n:'Electrical Wire #14',u:'Roll',s:120,c:650,p:850,r:10,ct:'Electrical',w:780},
    {n:'Latex Paint White',u:'Gallon',s:80,c:320,p:450,r:10,ct:'Paint',w:400},
    {n:'Flat Latex Paint',u:'Gallon',s:60,c:380,p:520,r:8,ct:'Paint',w:470},
    {n:'Concrete Nails 2inch',u:'Box',s:500,c:25,p:40,r:50,ct:'Hardware',w:35},
    {n:'Sand (per cu.m)',u:'Cubic Meter',s:200,c:350,p:480,r:20,ct:'Sand/Gravel',w:420},
    {n:'Gravel 3/4',u:'Cubic Meter',s:180,c:420,p:580,r:20,ct:'Sand/Gravel',w:520},
    {n:'Roofing Sheet GI',u:'Piece',s:100,c:280,p:380,r:15,ct:'Roofing',w:340},
    {n:'Angle Bar 1x1',u:'Piece',s:200,c:150,p:210,r:20,ct:'Hardware',w:190},
    {n:'Hollow Blocks #4',u:'Piece',s:1000,c:12,p:18,r:200,ct:'Hardware',w:15},
    {n:'Tile Adhesive 25kg',u:'Bag',s:80,c:180,p:250,r:10,ct:'Hardware',w:225},
    {n:'Plywood 1/4',u:'Piece',s:200,c:250,p:340,r:25,ct:'Lumber/Wood',w:310},
  ];
  const matIds: string[] = [];
  for (const m of mats) {
    const id = uuidv4();
    await db.prepare('INSERT OR IGNORE INTO materials (id,name,unit,stock,cost_price,price_per_unit,reorder_point,category,wholesale_price) VALUES (?,?,?,?,?,?,?,?,?)').run(id,m.n,m.u,m.s,m.c,m.p,m.r,m.ct,m.w);
    matIds.push(id);
  }

  // --- Customers ---
  const customers = [
    {n:'Juan Dela Cruz',p:'09171234567',a:'123 Rizal St, Iloilo City',w:0},
    {n:'Maria Santos',p:'09182345678',a:'456 Mabini Ave, Iloilo City',w:0},
    {n:'Pedro Reyes Const.',p:'09193456789',a:'789 Bonifacio Dr, Iloilo City',w:1},
    {n:'Ana Gonzales',p:'09204567890',a:'321 Aguinaldo St, Iloilo City',w:0},
    {n:'Rico Builders Inc',p:'09215678901',a:'654 Quezon Blvd, Iloilo City',w:1},
    {n:'Lorna Villanueva',p:'09226789012',a:'987 Roxas Ave, Iloilo City',w:0},
    {n:'Tony Mercado',p:'09237890123',a:'147 Del Pilar St, Iloilo City',w:0},
    {n:'Grace Padilla',p:'09248901234',a:'258 Luna St, Iloilo City',w:0},
  ];
  const custIds: string[] = [];
  for (const c of customers) {
    const id = uuidv4();
    await db.prepare('INSERT OR IGNORE INTO customers (id,name,phone,address,is_wholesale) VALUES (?,?,?,?,?)').run(id,c.n,c.p,c.a,c.w);
    custIds.push(id);
  }

  // --- Suppliers ---
  const suppliers = ['Cebu Cement Corp','Manila Steel Trading','Davao Hardware Supply'];
  const supIds: string[] = [];
  for (const s of suppliers) {
    const id = uuidv4();
    await db.prepare('INSERT OR IGNORE INTO suppliers (id,name) VALUES (?,?)').run(id,s);
    supIds.push(id);
  }

  // --- Generate invoices (accepts batch param for days) ---
  const days = Math.min(parseInt((_req as any).query?.days) || 7, 15);
  const offset = Math.max(parseInt((_req as any).query?.offset) || 0, 0);
  const today = new Date();
  const getSeq = db.prepare('SELECT next_number FROM invoice_sequence WHERE id = 1');
  const upSeq = db.prepare('UPDATE invoice_sequence SET next_number = next_number + 1 WHERE id = 1');
  const insInv = db.prepare('INSERT INTO invoices (id,customer_id,invoice_number,subtotal,tax_rate,tax_amount,total,status,issued_date,paid_date,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const insItem = db.prepare('INSERT INTO invoice_items (id,invoice_id,material_id,description,quantity,unit_price,total) VALUES (?,?,?,?,?,?,?)');
  const insPay = db.prepare('INSERT INTO payments (id,invoice_id,amount,method,payment_date) VALUES (?,?,?,?,?)');
  const updStock = db.prepare('UPDATE materials SET stock = stock - ? WHERE id = ?');
  const insMv = db.prepare('INSERT INTO stock_movements (id,material_id,type,quantity,reference_id,reference_type,notes) VALUES (?,?,?,?,?,?,?)');
  const insExp = db.prepare('INSERT INTO expenses (id,category,amount,description,expense_date) VALUES (?,?,?,?,?)');

  let invoiceCount = 0;
  const adminId = ((await db.prepare("SELECT id FROM users WHERE username='admin'").get()) as any)?.id || null;

  for (let d = days - 1 + offset; d >= offset; d--) {
    const date = new Date(today);
    date.setDate(date.getDate() - d);
    const dateStr = date.toISOString().slice(0, 10);
    const daySales = 10 + Math.floor(Math.random() * 8);

    for (let i = 0; i < daySales; i++) {
      const useCust = Math.random() < 0.7;
      const custId = useCust ? custIds[Math.floor(Math.random() * custIds.length)] : null;
      const itemCount = 1 + Math.floor(Math.random() * 3);
      let subtotal = 0;

      const seq = (await getSeq.get()) as any;
      const num = seq.next_number;
      await upSeq.run();
      const invNum = `INV-${String(num).padStart(4,'0')}`;
      const invId = uuidv4();

      await insInv.run(invId, custId, invNum, 0, 0, 0, 0, 'pending', `${dateStr}T${String(8+Math.floor(Math.random()*10)).padStart(2,'0')}:${String(Math.floor(Math.random()*60)).padStart(2,'0')}:00`, null, adminId);

      for (let j = 0; j < itemCount; j++) {
        const mi = Math.floor(Math.random() * mats.length);
        const m = mats[mi];
        const qty = 1 + Math.floor(Math.random() * 5);
        const price = m.p;
        const lineTotal = Math.round(qty * price * 100) / 100;
        subtotal += lineTotal;
        await insItem.run(uuidv4(), invId, matIds[mi], m.n, qty, price, lineTotal);
        await updStock.run(qty, matIds[mi]);
        await insMv.run(uuidv4(), matIds[mi], 'sale', -qty, invId, 'invoice', `Sold in ${invNum}`);
      }

      const sub = Math.round(subtotal * 100) / 100;
      const tax = Math.round(sub * 0 * 100) / 100;
      const total = Math.round((sub + tax) * 100) / 100;
      await db.prepare('UPDATE invoices SET subtotal=?,tax_rate=?,tax_amount=?,total=? WHERE id=?').run(sub,0,tax,total,invId);

      // Auto-pay most invoices (80%)
      if (Math.random() < 0.8) {
        const payAmt = Math.round(total * 100) / 100;
        const method = ['cash','cash','cash','card','bank'][Math.floor(Math.random()*5)];
        await insPay.run(uuidv4(), invId, payAmt, method, `${dateStr}T${String(14+Math.floor(Math.random()*6)).padStart(2,'0')}:00:00`);
        await db.prepare("UPDATE invoices SET status='paid',paid_date=? WHERE id=?").run(`${dateStr}T${String(14+Math.floor(Math.random()*6)).padStart(2,'0')}:00:00`,invId);
      }
      invoiceCount++;
    }

    // Daily expenses
    const expCount = 1 + Math.floor(Math.random() * 2);
    const expCats = ['Utilities','Labor/Salary','Delivery/Transport','Supplies','Maintenance','Rent'];
    for (let e = 0; e < expCount; e++) {
      await insExp.run(uuidv4(), expCats[Math.floor(Math.random()*expCats.length)], 100+Math.floor(Math.random()*2000), 'Daily expense', dateStr);
    }
  }

  res.json({ ok: true, invoices: invoiceCount, materials: mats.length, customers: customers.length, suppliers: suppliers.length });
});

export default router;
