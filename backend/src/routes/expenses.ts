import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/setup';
import { requireAdmin } from '../lib/auth';
import { logAudit } from '../lib/audit';

const router = Router();

const EXPENSE_CATEGORIES = [
  'Rent', 'Utilities', 'Labor/Salary', 'Delivery/Transport',
  'Tools & Equipment', 'Maintenance', 'Supplies', 'Other'
];

function validateExpense(body: any, existing?: any) {
  const errors: string[] = [];
  const category = body.category ?? existing?.category;
  const amount = body.amount !== undefined ? body.amount : existing?.amount;
  const expense_date = body.expense_date ?? existing?.expense_date;
  const description = body.description !== undefined ? body.description : existing?.description;
  const vendor = body.vendor !== undefined ? body.vendor : existing?.vendor;

  if (body.category !== undefined && (!category || !EXPENSE_CATEGORIES.includes(category))) {
    errors.push('Valid category is required');
  }
  if (body.amount !== undefined && (isNaN(amount) || amount <= 0)) {
    errors.push('Amount must be greater than 0');
  }
  if (body.expense_date !== undefined && !expense_date) {
    errors.push('Date is required');
  }
  return { category, amount, description, vendor, expense_date, errors };
}

router.get('/', (req: Request, res: Response) => {
  const db = getDb();
  let query = 'SELECT * FROM expenses';
  const params: any[] = [];
  const conditions: string[] = [];

  if (req.query.category) {
    conditions.push('category = ?');
    params.push(req.query.category);
  }
  if (req.query.from) {
    conditions.push('expense_date >= ?');
    params.push(req.query.from);
  }
  if (req.query.to) {
    conditions.push('expense_date <= ?');
    params.push(req.query.to);
  }

  if (conditions.length) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY expense_date DESC, created_at DESC';

  const expenses = db.prepare(query).all(...params);
  res.json(expenses);
});

router.get('/summary', (req: Request, res: Response) => {
  const db = getDb();
  let query = "SELECT category, SUM(amount) AS total FROM expenses";
  const params: any[] = [];
  const conditions: string[] = [];

  if (req.query.from) {
    conditions.push('expense_date >= ?');
    params.push(req.query.from);
  }
  if (req.query.to) {
    conditions.push('expense_date <= ?');
    params.push(req.query.to);
  }

  if (conditions.length) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' GROUP BY category ORDER BY total DESC';

  res.json(db.prepare(query).all(...params));
});

router.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!expense) { res.status(404).json({ error: 'Expense not found' }); return; }
  res.json(expense);
});

router.post('/', (req: Request, res: Response) => {
  const db = getDb();
  const validation = validateExpense(req.body);
  if (validation.errors.length) {
    res.status(400).json({ error: validation.errors.join('; ') });
    return;
  }
  const id = uuidv4();
  db.prepare(
    'INSERT INTO expenses (id, category, amount, description, vendor, expense_date) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, validation.category, validation.amount, validation.description || null, validation.vendor || null, validation.expense_date);
  const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
  logAudit((req as any).user?.id || null, 'create', 'expense', id, `${validation.category} — ${validation.amount}`);
  res.status(201).json(expense);
});

router.put('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id) as any;
  if (!existing) { res.status(404).json({ error: 'Expense not found' }); return; }
  const validation = validateExpense(req.body, existing);
  if (validation.errors.length) {
    res.status(400).json({ error: validation.errors.join('; ') });
    return;
  }
  db.prepare(
    'UPDATE expenses SET category=?, amount=?, description=?, vendor=?, expense_date=? WHERE id=?'
  ).run(validation.category, validation.amount, validation.description || null, validation.vendor || null, validation.expense_date, req.params.id);
  const updated = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  logAudit((req as any).user?.id || null, 'update', 'expense', req.params.id as string);
  res.json(updated);
});

router.delete('/:id', requireAdmin, (req: Request, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'Expense not found' }); return; }
  const name = (existing as any).category + ' ' + (existing as any).amount;
  db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  logAudit((req as any).user?.id || null, 'delete', 'expense', req.params.id as string, name);
  res.status(204).send();
});

export { EXPENSE_CATEGORIES };
export default router;
