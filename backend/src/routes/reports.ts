import { Router, Request, Response } from 'express';
import { getDb } from '../db/setup';
import { requireAdmin } from '../lib/auth';

const router = Router();

const businessDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());
const businessMonth = () => businessDate().slice(0, 7);

router.use(requireAdmin);

router.get('/export', async (req: Request, res: Response) => {
  const db = getDb();
  const from = (req.query.from as string) || businessDate();
  const to = (req.query.to as string) || from;
  const rows = await db.prepare(`SELECT i.invoice_number, i.issued_date, COALESCE(c.name,'Walk-in') customer_name,
    COALESCE(c.tin,'') customer_tin, f.subtotal, f.tax_rate, f.adjusted_tax tax_amount, f.adjusted_total total, f.status,
    f.net_collections paid
    FROM v_invoice_financials f JOIN invoices i ON i.id=f.invoice_id LEFT JOIN customers c ON c.id=i.customer_id
    WHERE date(i.issued_date) BETWEEN ? AND ? ORDER BY i.issued_date, i.invoice_number`).all(from, to) as any[];
  const cell = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = ['Invoice Number,Date,Buyer,Buyer TIN,Subtotal,Tax Rate,Tax Amount,Total,Status,Paid', ...rows.map(r =>
    [r.invoice_number,r.issued_date,r.customer_name,r.customer_tin,r.subtotal,r.tax_rate,r.tax_amount,r.total,r.status,r.paid].map(cell).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sales-${from}-${to}.csv"`);
  res.send('\ufeff' + csv);
});

// Books-oriented summaries: sales journal, cash receipts, purchases/expenses and receivables.
router.get('/books', async (req: Request, res: Response) => {
  const db = getDb();
  const from = (req.query.from as string) || businessDate();
  const to = (req.query.to as string) || from;
  const [sales, receipts, expenses, receivables] = await Promise.all([
    db.prepare(`SELECT f.invoice_number, f.issued_date, COALESCE(c.name,'Walk-in') buyer, f.net_sales, f.adjusted_tax, f.adjusted_total, f.status FROM v_invoice_financials f LEFT JOIN customers c ON c.id=f.customer_id WHERE date(f.issued_date) BETWEEN ? AND ? ORDER BY f.issued_date`).all(from,to),
    db.prepare(`SELECT p.payment_date, i.invoice_number, p.method, p.amount FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.status <> 'voided' AND date(p.payment_date) BETWEEN ? AND ? ORDER BY p.payment_date`).all(from,to),
    db.prepare(`SELECT expense_date, category, vendor, description, amount, payment_method FROM expenses WHERE date(expense_date) BETWEEN ? AND ? ORDER BY expense_date`).all(from,to),
    db.prepare(`SELECT f.invoice_number, COALESCE(c.name,'Walk-in') buyer, f.adjusted_total, f.net_collections paid, f.adjusted_total-f.net_collections balance FROM v_invoice_financials f LEFT JOIN customers c ON c.id=f.customer_id WHERE f.status <> 'voided' AND f.adjusted_total > f.net_collections ORDER BY f.issued_date`).all(),
  ]);
  res.json({ from, to, sales, receipts, expenses, receivables });
});

router.get('/cash-flow', async (req: Request, res: Response) => {
  const db = getDb();
  const from = (req.query.from as string) || businessDate();
  const to = (req.query.to as string) || from;
  const [receipts, refunds, expenses] = await Promise.all([
    db.prepare("SELECT COALESCE(SUM(p.amount),0) total FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.method='cash' AND i.status <> 'voided' AND date(p.payment_date) BETWEEN ? AND ?").get(from,to),
    db.prepare("SELECT COALESCE(SUM(r.amount),0) total FROM refunds r JOIN invoices i ON i.id=r.invoice_id WHERE r.method='cash' AND i.status <> 'voided' AND date(r.created_at) BETWEEN ? AND ?").get(from,to),
    db.prepare("SELECT COALESCE(SUM(amount),0) total FROM expenses WHERE payment_method='cash' AND date(expense_date) BETWEEN ? AND ?").get(from,to),
  ]);
  const cashReceipts = Number((receipts as any).total || 0);
  const cashRefunds = Number((refunds as any).total || 0);
  const cashExpenses = Number((expenses as any).total || 0);
  res.json({ from, to, cash_receipts: cashReceipts, cash_refunds: cashRefunds, cash_expenses: cashExpenses, net_cash_change: cashReceipts - cashRefunds - cashExpenses });
});

// Single accounting summary used for reconciliation and accountant review.
router.get('/financial-summary', async (req: Request, res: Response) => {
  const db = getDb();
  const from = (req.query.from as string) || businessDate();
  const to = (req.query.to as string) || from;
  const row = await db.prepare(`
    SELECT
      COALESCE(SUM(f.net_sales),0) AS net_sales,
      COALESCE(SUM(f.adjusted_tax),0) AS tax_payable,
      COALESCE(SUM(f.payments_total),0) AS collections,
      COALESCE(SUM(f.refunds_total),0) AS refunds,
      COALESCE(SUM(f.adjusted_total - f.net_collections),0) AS accounts_receivable,
      COALESCE((SELECT SUM((ii.quantity - COALESCE((SELECT SUM(ir.quantity) FROM invoice_returns ir WHERE ir.invoice_item_id=ii.id),0)) * COALESCE(ii.cost_price,0)) FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE i.status <> 'voided' AND date(i.issued_date) BETWEEN ? AND ?),0) AS cogs,
      COALESCE((SELECT SUM(amount) FROM expenses WHERE date(expense_date) BETWEEN ? AND ?),0) AS expenses
    FROM v_invoice_financials f WHERE f.status <> 'voided' AND date(f.issued_date) BETWEEN ? AND ?
  `).get(from,to,from,to,from,to) as any;
  const netSales = Number(row.net_sales || 0), cogs = Number(row.cogs || 0), expenses = Number(row.expenses || 0);
  res.json({ from, to, net_sales: netSales, tax_payable: Number(row.tax_payable || 0), collections: Number(row.collections || 0), refunds: Number(row.refunds || 0), accounts_receivable: Number(row.accounts_receivable || 0), cogs, gross_profit: netSales - cogs, expenses, net_profit: netSales - cogs - expenses });
});

// ─── Daily Sales Report ───
router.get('/daily', async (req: Request, res: Response) => {
  const db = getDb();
  const date = req.query.date || businessDate();

  const [invoices, totals, profit, methods] = await Promise.all([
    db.prepare(`
      SELECT i.invoice_number, i.total - COALESCE((SELECT SUM(amount) FROM credit_memos cm WHERE cm.invoice_id=i.id AND cm.status='issued'),0) - COALESCE((SELECT SUM(total_credit) FROM invoice_returns ir WHERE ir.invoice_id=i.id),0) AS total, i.status, i.issued_date,
        COALESCE(c.name, 'Walk-in') AS customer_name,
        COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id), 0) - COALESCE((SELECT SUM(amount) FROM refunds WHERE invoice_id=i.id),0) AS paid
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id
      WHERE date(i.issued_date) = ?
      ORDER BY i.created_at DESC
    `).all(date) as Promise<any[]>,
    db.prepare(`
      SELECT COALESCE(SUM(i.total - COALESCE((SELECT SUM(amount) FROM credit_memos cm WHERE cm.invoice_id=i.id AND cm.status='issued'),0) - COALESCE((SELECT SUM(total_credit) FROM invoice_returns ir WHERE ir.invoice_id=i.id),0)), 0) AS gross_sales,
        COALESCE(SUM(i.tax_amount - COALESCE((SELECT SUM(tax_amount) FROM credit_memos cm WHERE cm.invoice_id=i.id AND cm.status='issued'),0) - CASE WHEN i.tax_rate > 0 THEN COALESCE((SELECT SUM(total_credit) FROM invoice_returns ir WHERE ir.invoice_id=i.id),0) * i.tax_rate / (1+i.tax_rate) ELSE 0 END), 0) AS tax_collected,
        COUNT(*) AS invoice_count
      FROM invoices i WHERE date(i.issued_date) = ?
    `).get(date) as Promise<any>,
    db.prepare(`
      SELECT COALESCE(SUM(f.net_sales),0) - COALESCE((SELECT SUM((ii.quantity - COALESCE((SELECT SUM(ir.quantity) FROM invoice_returns ir WHERE ir.invoice_item_id=ii.id),0)) * COALESCE(ii.cost_price, m.cost_price, 0)) FROM invoice_items ii JOIN invoices i2 ON i2.id=ii.invoice_id LEFT JOIN materials m ON m.id=ii.material_id WHERE i2.status <> 'voided' AND date(i2.issued_date)=?),0) AS profit
      FROM v_invoice_financials f WHERE f.status <> 'voided' AND date(f.issued_date)=?
    `).get(date, date) as Promise<any>,
    db.prepare(`
      SELECT p.method, SUM(p.amount) AS total
      FROM payments p JOIN invoices i ON i.id = p.invoice_id
      WHERE i.status <> 'voided' AND date(p.payment_date) = ?
      GROUP BY p.method ORDER BY total DESC
    `).all(date) as Promise<any[]>,
  ]);

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
  const month = req.query.month || businessMonth();

  const [revenue, cogs, expenses, expenseByCategory, lastMonth] = await Promise.all([
    db.prepare(`
      SELECT COALESCE(SUM(net_sales), 0) AS total
      FROM v_invoice_financials WHERE status <> 'voided' AND strftime('%Y-%m', issued_date) = ?
    `).get(month) as Promise<any>,
    db.prepare(`
      SELECT COALESCE(SUM((ii.quantity - COALESCE((SELECT SUM(ir.quantity) FROM invoice_returns ir WHERE ir.invoice_item_id=ii.id),0)) * COALESCE(ii.cost_price, m.cost_price, 0)), 0) AS total
      FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
      LEFT JOIN materials m ON m.id = ii.material_id
      WHERE i.status <> 'voided' AND strftime('%Y-%m', i.issued_date) = ?
    `).get(month) as Promise<any>,
    db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM expenses WHERE strftime('%Y-%m', expense_date) = ?
    `).get(month) as Promise<any>,
    db.prepare(`
      SELECT category, SUM(amount) AS total
      FROM expenses WHERE strftime('%Y-%m', expense_date) = ?
      GROUP BY category ORDER BY total DESC
    `).all(month) as Promise<any[]>,
    db.prepare(`
      SELECT COALESCE(SUM(net_sales), 0) AS total
      FROM v_invoice_financials WHERE status <> 'voided' AND strftime('%Y-%m', issued_date, '+8 hours') = strftime('%Y-%m', 'now', '+8 hours', '-1 month')
    `).get() as Promise<any>,
  ]);

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
  const month = req.query.month || businessMonth();

  const [summary, taxRates] = await Promise.all([
    db.prepare(`
      SELECT COUNT(*) AS invoice_count,
        COALESCE(SUM(net_sales), 0) AS vatable_sales,
        COALESCE(SUM(adjusted_tax), 0) AS vat_collected,
        COALESCE(SUM(CASE WHEN tax_rate > 0 THEN net_sales ELSE 0 END), 0) AS taxable_amount,
        COALESCE(SUM(CASE WHEN tax_rate = 0 THEN net_sales ELSE 0 END), 0) AS exempt_sales
      FROM v_invoice_financials WHERE status <> 'voided' AND strftime('%Y-%m', issued_date) = ?
    `).get(month) as Promise<any>,
    db.prepare(`
      SELECT tax_rate, COUNT(*) AS cnt, COALESCE(SUM(net_sales), 0) AS subtotal, COALESCE(SUM(adjusted_tax), 0) AS tax
      FROM v_invoice_financials WHERE status <> 'voided' AND strftime('%Y-%m', issued_date) = ?
      GROUP BY tax_rate ORDER BY tax_rate DESC
    `).all(month) as Promise<any[]>,
  ]);

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
  const from = (req.query.from as string) || businessDate();
  const to = (req.query.to as string) || businessDate();
  const type = (req.query.type as string) || 'sales';

  if (type === 'sales') {
    const [invoices, totals, profit] = await Promise.all([
      db.prepare(`
          SELECT i.invoice_number, i.total - COALESCE((SELECT SUM(amount) FROM credit_memos cm WHERE cm.invoice_id=i.id AND cm.status='issued'),0) - COALESCE((SELECT SUM(total_credit) FROM invoice_returns ir WHERE ir.invoice_id=i.id),0) AS total, i.tax_amount, i.status, i.issued_date,
          COALESCE(c.name, 'Walk-in') AS customer_name,
          COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id), 0) - COALESCE((SELECT SUM(amount) FROM refunds WHERE invoice_id=i.id),0) AS paid
        FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
        WHERE date(i.issued_date) >= ? AND date(i.issued_date) <= ?
        ORDER BY i.issued_date DESC
      `).all(from, to) as Promise<any[]>,
      db.prepare(`
        SELECT COALESCE(SUM(net_sales), 0) AS gross, COALESCE(SUM(adjusted_tax), 0) AS tax, COUNT(*) AS cnt
      FROM v_invoice_financials WHERE status <> 'voided' AND date(issued_date) >= ? AND date(issued_date) <= ?
      `).get(from, to) as Promise<any>,
      db.prepare(`
        SELECT COALESCE(SUM(ii.total - (ii.quantity * COALESCE(ii.cost_price, m.cost_price, 0))), 0) AS profit
        FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
        LEFT JOIN materials m ON m.id = ii.material_id
        WHERE date(i.issued_date) >= ? AND date(i.issued_date) <= ?
      `).get(from, to) as Promise<any>,
    ]);

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
    const [revenue, cogs, expenses] = await Promise.all([
      db.prepare(`
        SELECT COALESCE(SUM(net_sales), 0) AS total FROM v_invoice_financials
        WHERE status <> 'voided' AND date(issued_date) >= ? AND date(issued_date) <= ?
      `).get(from, to) as Promise<any>,
      db.prepare(`
        SELECT COALESCE(SUM((ii.quantity - COALESCE((SELECT SUM(ir.quantity) FROM invoice_returns ir WHERE ir.invoice_item_id=ii.id),0)) * COALESCE(ii.cost_price, m.cost_price, 0)), 0) AS total
        FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
        LEFT JOIN materials m ON m.id = ii.material_id
        WHERE i.status <> 'voided' AND date(i.issued_date) >= ? AND date(i.issued_date) <= ?
      `).get(from, to) as Promise<any>,
      db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
        WHERE date(expense_date) >= ? AND date(expense_date) <= ?
      `).get(from, to) as Promise<any>,
    ]);

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
