import { Router, Request, Response } from 'express';
import { getDb } from '../db/setup';
import { requireAdmin } from '../lib/auth';

const router = Router();

router.use(requireAdmin);

// ─── Daily Sales Report ───
router.get('/daily', async (req: Request, res: Response) => {
  const db = getDb();
  const date = req.query.date || new Date().toISOString().slice(0, 10);

  const invoices = await db.prepare(`
    SELECT i.invoice_number, i.total, i.status, i.issued_date,
      COALESCE(c.name, 'Walk-in') AS customer_name,
      COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id), 0) AS paid
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    WHERE date(i.issued_date) = ?
    ORDER BY i.created_at DESC
  `).all(date) as any[];

  const totals = await db.prepare(`
    SELECT
      COALESCE(SUM(i.total), 0) AS gross_sales,
      COALESCE(SUM(i.tax_amount), 0) AS tax_collected,
      COUNT(*) AS invoice_count
    FROM invoices i
    WHERE date(i.issued_date) = ?
  `).get(date) as any;

  const profit = await db.prepare(`
    SELECT COALESCE(SUM(ii.total - (ii.quantity * COALESCE(m.cost_price, 0))), 0) AS profit
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    LEFT JOIN materials m ON m.id = ii.material_id
    WHERE date(i.issued_date) = ?
  `).get(date) as any;

  const methods = await db.prepare(`
    SELECT p.method, SUM(p.amount) AS total
    FROM payments p
    JOIN invoices i ON i.id = p.invoice_id
    WHERE date(p.payment_date) = ?
    GROUP BY p.method
    ORDER BY total DESC
  `).all(date) as any[];

  res.json({
    date,
    invoices: invoices.map(inv => ({ ...inv, total: Math.round(inv.total * 100) / 100, paid: Math.round(inv.paid * 100) / 100 })),
    totals: {
      gross_sales: Math.round(totals.gross_sales * 100) / 100,
      tax_collected: Math.round(totals.tax_collected * 100) / 100,
      profit: Math.round(profit.profit * 100) / 100,
      invoice_count: totals.invoice_count,
    },
    paymentMethods: methods.map(m => ({ ...m, total: Math.round(m.total * 100) / 100 })),
  });
});

// ─── Monthly Profit & Loss ───
router.get('/monthly', async (req: Request, res: Response) => {
  const db = getDb();
  const month = req.query.month || new Date().toISOString().slice(0, 7);

  const revenue = await db.prepare(`
    SELECT COALESCE(SUM(p.amount), 0) AS total
    FROM payments p
    WHERE strftime('%Y-%m', p.payment_date) = ?
  `).get(month) as any;

  const cogs = await db.prepare(`
    SELECT COALESCE(SUM(ii.quantity * COALESCE(m.cost_price, 0)), 0) AS total
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    LEFT JOIN materials m ON m.id = ii.material_id
    WHERE strftime('%Y-%m', i.issued_date) = ?
  `).get(month) as any;

  const expenses = await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM expenses
    WHERE strftime('%Y-%m', expense_date) = ?
  `).get(month) as any;

  const expenseByCategory = await db.prepare(`
    SELECT category, SUM(amount) AS total
    FROM expenses
    WHERE strftime('%Y-%m', expense_date) = ?
    GROUP BY category
    ORDER BY total DESC
  `).all(month) as any[];

  const lastMonth = await db.prepare(`
    SELECT COALESCE(SUM(p.amount), 0) AS total
    FROM payments p
    WHERE strftime('%Y-%m', p.payment_date) = strftime('%Y-%m', 'now', '-1 month')
  `).get() as any;

  const rev = Math.round(revenue.total * 100) / 100;
  const cogsVal = Math.round(cogs.total * 100) / 100;
  const grossProfit = Math.round((rev - cogsVal) * 100) / 100;
  const expenseTotal = Math.round(expenses.total * 100) / 100;
  const netProfit = Math.round((grossProfit - expenseTotal) * 100) / 100;
  const lastRev = Math.round(lastMonth.total * 100) / 100;
  const momChange = lastRev > 0 ? Math.round(((rev - lastRev) / lastRev) * 1000) / 10 : 0;

  res.json({
    month,
    revenue: rev,
    cogs: cogsVal,
    gross_profit: grossProfit,
    expenses: expenseTotal,
    net_profit: netProfit,
    expense_by_category: expenseByCategory.map(e => ({ ...e, total: Math.round(e.total * 100) / 100 })),
    last_month_revenue: lastRev,
    mom_change: momChange,
  });
});

// ─── Monthly Tax Summary ───
router.get('/tax', async (req: Request, res: Response) => {
  const db = getDb();
  const month = req.query.month || new Date().toISOString().slice(0, 7);

  const summary = await db.prepare(`
    SELECT
      COUNT(*) AS invoice_count,
      COALESCE(SUM(subtotal), 0) AS vatable_sales,
      COALESCE(SUM(tax_amount), 0) AS vat_collected,
      COALESCE(SUM(CASE WHEN tax_rate > 0 THEN subtotal ELSE 0 END), 0) AS taxable_amount,
      COALESCE(SUM(CASE WHEN tax_rate = 0 THEN subtotal ELSE 0 END), 0) AS exempt_sales
    FROM invoices
    WHERE strftime('%Y-%m', issued_date) = ?
  `).get(month) as any;

  const taxRates = await db.prepare(`
    SELECT tax_rate, COUNT(*) AS cnt, COALESCE(SUM(subtotal), 0) AS subtotal, COALESCE(SUM(tax_amount), 0) AS tax
    FROM invoices
    WHERE strftime('%Y-%m', issued_date) = ?
    GROUP BY tax_rate
    ORDER BY tax_rate DESC
  `).all(month) as any[];

  res.json({
    month,
    invoice_count: summary.invoice_count,
    vatable_sales: Math.round(summary.vatable_sales * 100) / 100,
    vat_collected: Math.round(summary.vat_collected * 100) / 100,
    taxable_amount: Math.round(summary.taxable_amount * 100) / 100,
    exempt_sales: Math.round(summary.exempt_sales * 100) / 100,
    by_rate: taxRates.map(r => ({
      tax_rate: r.tax_rate,
      count: r.cnt,
      subtotal: Math.round(r.subtotal * 100) / 100,
      tax: Math.round(r.tax * 100) / 100,
    })),
  });
});

// ─── Date Range Report ───
router.get('/range', async (req: Request, res: Response) => {
  const db = getDb();
  const from = (req.query.from as string) || new Date().toISOString().slice(0, 10);
  const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);
  const type = (req.query.type as string) || 'sales';

  if (type === 'sales') {
    const invoices = await db.prepare(`
      SELECT i.invoice_number, i.total, i.tax_amount, i.status, i.issued_date,
        COALESCE(c.name, 'Walk-in') AS customer_name,
        COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id), 0) AS paid
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id
      WHERE date(i.issued_date) >= ? AND date(i.issued_date) <= ?
      ORDER BY i.issued_date DESC
    `).all(from, to) as any[];

    const totals = await db.prepare(`
      SELECT COALESCE(SUM(total), 0) AS gross, COALESCE(SUM(tax_amount), 0) AS tax, COUNT(*) AS cnt
      FROM invoices WHERE date(issued_date) >= ? AND date(issued_date) <= ?
    `).get(from, to) as any;

    const profit = await db.prepare(`
      SELECT COALESCE(SUM(ii.total - (ii.quantity * COALESCE(m.cost_price, 0))), 0) AS profit
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      LEFT JOIN materials m ON m.id = ii.material_id
      WHERE date(i.issued_date) >= ? AND date(i.issued_date) <= ?
    `).get(from, to) as any;

    res.json({
      from, to, type,
      invoices: invoices.map(inv => ({ ...inv, total: Math.round(inv.total * 100) / 100, paid: Math.round(inv.paid * 100) / 100 })),
      totals: {
        gross_sales: Math.round(totals.gross * 100) / 100,
        tax_collected: Math.round(totals.tax * 100) / 100,
        profit: Math.round(profit.profit * 100) / 100,
        invoice_count: totals.cnt,
      },
    });
    return;
  }

  if (type === 'profit') {
    const revenue = await db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total FROM payments
      WHERE date(payment_date) >= ? AND date(payment_date) <= ?
    `).get(from, to) as any;

    const cogs = await db.prepare(`
      SELECT COALESCE(SUM(ii.quantity * COALESCE(m.cost_price, 0)), 0) AS total
      FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
      LEFT JOIN materials m ON m.id = ii.material_id
      WHERE date(i.issued_date) >= ? AND date(i.issued_date) <= ?
    `).get(from, to) as any;

    const expenses = await db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
      WHERE date(expense_date) >= ? AND date(expense_date) <= ?
    `).get(from, to) as any;

    const r = Math.round(revenue.total * 100) / 100;
    const c = Math.round(cogs.total * 100) / 100;
    const e = Math.round(expenses.total * 100) / 100;

    res.json({
      from, to, type,
      revenue: r, cogs: c,
      gross_profit: Math.round((r - c) * 100) / 100,
      expenses: e,
      net_profit: Math.round((r - c - e) * 100) / 100,
    });
    return;
  }

  res.status(400).json({ error: 'Invalid report type. Use sales, profit, or tax.' });
});

export default router;
