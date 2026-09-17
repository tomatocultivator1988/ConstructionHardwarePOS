import { Router, Request, Response, NextFunction } from 'express';
import { getDb } from '../db/setup';

const router = Router();

function requireIntegrationKey(req: Request, res: Response, next: NextFunction) {
  if (req.path === '/public-reports') return next();
  const configuredKey = process.env.REPORTS_API_KEY;
  const suppliedKey = req.header('x-api-key') || (req.header('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!configuredKey) return res.status(503).json({ error: 'Reports integration is not configured' });
  if (!suppliedKey || suppliedKey !== configuredKey) return res.status(401).json({ error: 'Invalid integration API key' });
  next();
}

const dateParam = (value: unknown, fallback: string) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
const businessDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());

router.use(requireIntegrationKey);

router.get(['/reports', '/public-reports'], async (req: Request, res: Response) => {
  const db = getDb();
  const today = businessDate();
  const from = dateParam(req.query.from, today);
  const to = dateParam(req.query.to, from);
  if (from > to) return res.status(400).json({ error: 'from must be before or equal to to' });

  const [sales, payments, expenses, receivables, inventory, deliveries] = await Promise.all([
    db.prepare(`SELECT f.invoice_number, f.issued_date, COALESCE(c.name,'Walk-in') buyer, f.status,
      f.net_sales, f.adjusted_tax tax, f.adjusted_total total, f.net_collections paid,
      f.adjusted_total-f.net_collections balance
      FROM v_invoice_financials f LEFT JOIN customers c ON c.id=f.customer_id
      WHERE f.status <> 'voided' AND date(f.issued_date,'+8 hours') BETWEEN ? AND ? ORDER BY f.issued_date, f.invoice_number`).all(from, to),
    db.prepare(`SELECT p.payment_date, i.invoice_number, COALESCE(c.name,'Walk-in') buyer,
      p.method, p.amount, p.notes
      FROM payments p JOIN invoices i ON i.id=p.invoice_id LEFT JOIN customers c ON c.id=i.customer_id
      WHERE i.status <> 'voided' AND date(p.payment_date,'+8 hours') BETWEEN ? AND ? ORDER BY p.payment_date`).all(from, to),
    db.prepare(`SELECT expense_date, category, vendor, payment_method, description, amount
      FROM expenses WHERE date(expense_date,'+8 hours') BETWEEN ? AND ? ORDER BY expense_date`).all(from, to),
    db.prepare(`SELECT f.invoice_number, f.issued_date, COALESCE(c.name,'Walk-in') buyer,
      f.adjusted_total total, f.net_collections paid, f.adjusted_total-f.net_collections balance
      FROM v_invoice_financials f LEFT JOIN customers c ON c.id=f.customer_id
      WHERE f.status <> 'voided' AND f.adjusted_total > f.net_collections ORDER BY f.issued_date`).all(),
    db.prepare(`SELECT id, name, unit, stock, cost_price, price_per_unit, wholesale_price, reorder_point, category, supplier_id
      FROM materials ORDER BY name`).all(),
    db.prepare(`SELECT i.invoice_number, i.issued_date, COALESCE(c.name,'Walk-in') buyer,
      i.delivery_status, i.delivery_person, i.buyer_address delivery_address
      FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id
      WHERE i.status <> 'voided' AND i.delivery_status IS NOT NULL
        AND date(i.issued_date,'+8 hours') BETWEEN ? AND ? ORDER BY i.issued_date`).all(from, to),
  ]);

  res.json({
    generated_at: new Date().toISOString(),
    period: { from, to },
    sales, payments, expenses, receivables, inventory, deliveries,
  });
});

router.get('/health', (_req, res) => res.json({ status: 'ok', integration: 'reports', read_only: true }));

export default router;
