import { Router, Request, Response } from 'express';
import { getDb } from '../db/setup';
import { getCached, setCache } from '../lib/cache';

const router = Router();

router.get('/dashboard', async (_req: Request, res: Response) => {
  const CACHE_KEY = 'analytics:dashboard';
  const cached = getCached<any>(CACHE_KEY);
  if (cached) { res.json(cached); return; }

  const db = getDb();

  try {
    const [
      topMaterials,
      profitTrend,
      stockValue,
      materialMargins,
      todayProfit,
      weekRevenue,
      monthRevenue,
      lastMonthRevenue,
      yearRevenue,
      overallRevenue,
      monthlyTrend,
      topCustomers,
      expenseByCategory,
      pnlTrend,
      paymentMethodTotals,
    ] = await Promise.all([
      db.prepare(`
        SELECT ii.material_id, m.name, m.unit, m.cost_price,
          SUM(ii.quantity) AS total_qty,
          SUM(ii.total) AS total_revenue,
          SUM(ii.quantity * COALESCE(ii.cost_price, m.cost_price, 0)) AS total_cost
        FROM invoice_items ii
        JOIN materials m ON m.id = ii.material_id
        WHERE ii.material_id IS NOT NULL AND EXISTS (SELECT 1 FROM invoices i WHERE i.id=ii.invoice_id AND i.status <> 'voided')
        GROUP BY ii.material_id
        ORDER BY total_qty DESC
        LIMIT 5
      `).all() as Promise<any[]>,
      db.prepare(`
        WITH dates AS (
          SELECT date('now', '+8 hours', '-' || (6 - t) || ' days') AS d
          FROM (SELECT 0 AS t UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6)
        )
        SELECT dates.d AS date,
          COALESCE(SUM(f.adjusted_total), 0) AS revenue,
          COALESCE(SUM(f.net_sales * COALESCE(v.profit_ratio, 0)), 0) AS profit
        FROM dates
        LEFT JOIN v_invoice_financials f ON date(f.issued_date, '+8 hours') = dates.d AND f.status <> 'voided'
        LEFT JOIN v_invoice_profit_margin v ON v.invoice_id = f.invoice_id
        GROUP BY dates.d
        ORDER BY dates.d
      `).all() as Promise<any[]>,
      db.prepare(`
        SELECT SUM(stock * COALESCE(cost_price, 0)) AS total_cost,
          SUM(stock * price_per_unit) AS total_retail,
          COUNT(*) AS material_count
        FROM materials
      `).get() as Promise<any>,
      db.prepare(`
        SELECT name, unit, cost_price, price_per_unit, stock,
          (price_per_unit - cost_price) AS profit_per_unit,
          CASE WHEN price_per_unit > 0
            THEN ROUND(((price_per_unit - cost_price) / price_per_unit) * 100, 1)
            ELSE 0 END AS margin_pct
        FROM materials ORDER BY margin_pct DESC
      `).all() as Promise<any[]>,
      db.prepare(`
        SELECT COALESCE(SUM(f.net_sales * COALESCE(v.profit_ratio, 0)), 0) AS profit
        FROM v_invoice_financials f LEFT JOIN v_invoice_profit_margin v ON v.invoice_id = f.invoice_id
        WHERE f.status <> 'voided' AND date(f.issued_date, '+8 hours') = date('now', '+8 hours')
      `).get() as Promise<any>,
      db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.status <> 'voided' AND p.payment_date >= datetime('now', '-7 days')
      `).get() as Promise<any>,
      db.prepare(`
        SELECT COALESCE(SUM(f.adjusted_total), 0) AS revenue,
          COALESCE(SUM(f.net_sales * COALESCE(v.profit_ratio, 0)), 0) AS profit
        FROM v_invoice_financials f LEFT JOIN v_invoice_profit_margin v ON v.invoice_id = f.invoice_id
        WHERE f.status <> 'voided' AND strftime('%Y-%m', f.issued_date, '+8 hours') = strftime('%Y-%m', 'now', '+8 hours')
      `).get() as Promise<any>,
      db.prepare(`
        SELECT COALESCE(SUM(f.adjusted_total), 0) AS revenue,
          COALESCE(SUM(f.net_sales * COALESCE(v.profit_ratio, 0)), 0) AS profit
        FROM v_invoice_financials f LEFT JOIN v_invoice_profit_margin v ON v.invoice_id = f.invoice_id
        WHERE f.status <> 'voided' AND strftime('%Y-%m', f.issued_date, '+8 hours') = strftime('%Y-%m', 'now', '+8 hours', '-1 month')
      `).get() as Promise<any>,
      db.prepare(`
        SELECT COALESCE(SUM(f.adjusted_total), 0) AS revenue,
          COALESCE(SUM(f.net_sales * COALESCE(v.profit_ratio, 0)), 0) AS profit
        FROM v_invoice_financials f LEFT JOIN v_invoice_profit_margin v ON v.invoice_id = f.invoice_id
        WHERE f.status <> 'voided' AND strftime('%Y', f.issued_date, '+8 hours') = strftime('%Y', 'now', '+8 hours')
      `).get() as Promise<any>,
      db.prepare(`
        SELECT COALESCE(SUM(f.adjusted_total), 0) AS revenue,
          COALESCE(SUM(f.net_sales * COALESCE(v.profit_ratio, 0)), 0) AS profit
        FROM v_invoice_financials f LEFT JOIN v_invoice_profit_margin v ON v.invoice_id = f.invoice_id
        WHERE f.status <> 'voided'
      `).get() as Promise<any>,
      db.prepare(`
        WITH months AS (
          SELECT strftime('%Y-%m', 'now', '+8 hours', '-' || (5 - t) || ' months') AS m
          FROM (SELECT 0 AS t UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5)
        )
        SELECT months.m AS month,
          COALESCE(SUM(f.adjusted_total), 0) AS revenue,
          COALESCE(SUM(f.net_sales * COALESCE(v.profit_ratio, 0)), 0) AS profit
        FROM months LEFT JOIN v_invoice_financials f ON strftime('%Y-%m', f.issued_date, '+8 hours') = months.m AND f.status <> 'voided'
        LEFT JOIN v_invoice_profit_margin v ON v.invoice_id = f.invoice_id
        GROUP BY months.m ORDER BY months.m
      `).all() as Promise<any[]>,
      db.prepare(`
        SELECT COALESCE(c.name, 'Walk-in') AS name,
          COUNT(DISTINCT i.id) AS invoice_count, SUM(p.amount) - COALESCE(SUM((SELECT COALESCE(SUM(r.amount),0) FROM refunds r WHERE r.invoice_id=i.id)),0) AS total_paid
        FROM payments p JOIN invoices i ON i.id = p.invoice_id
        LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.status <> 'voided'
        GROUP BY i.customer_id ORDER BY total_paid DESC LIMIT 5
      `).all() as Promise<any[]>,
      db.prepare(`SELECT category, COALESCE(SUM(amount),0) total FROM expenses GROUP BY category ORDER BY total DESC`).all() as Promise<any[]>,
      db.prepare(`
        WITH months AS (
          SELECT strftime('%Y-%m', 'now', '+8 hours', '-' || (5 - t) || ' months') AS month
          FROM (SELECT 0 AS t UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5)
        )
        SELECT months.month,
          COALESCE((SELECT SUM(f.net_sales) FROM v_invoice_financials f WHERE f.status <> 'voided' AND strftime('%Y-%m', f.issued_date, '+8 hours')=months.month),0) income,
          COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE strftime('%Y-%m', e.expense_date)=months.month),0) expenses
        FROM months ORDER BY months.month
      `).all() as Promise<any[]>,
      db.prepare(`
        SELECT p.method, COALESCE(SUM(p.amount),0) total
        FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.status <> 'voided'
        GROUP BY p.method ORDER BY total DESC
      `).all() as Promise<any[]>,
    ]);

    const result = {
      topMaterials: topMaterials.map(m => ({
        ...m,
        total_revenue: Math.round(m.total_revenue * 100) / 100,
        total_cost: Math.round(m.total_cost * 100) / 100,
        profit: Math.round((m.total_revenue - m.total_cost) * 100) / 100,
      })),
      profitTrend,
      stockValue: {
        total_cost: Math.round(stockValue.total_cost * 100) / 100,
        total_retail: Math.round(stockValue.total_retail * 100) / 100,
        material_count: stockValue.material_count,
      },
      materialMargins,
      todayProfit: Math.round(todayProfit.profit * 100) / 100,
      weekRevenue: Math.round(weekRevenue.total * 100) / 100,
      monthRevenue: {
        revenue: Math.round(monthRevenue.revenue * 100) / 100,
        profit: Math.round(monthRevenue.profit * 100) / 100,
      },
      lastMonthRevenue: {
        revenue: Math.round(lastMonthRevenue.revenue * 100) / 100,
        profit: Math.round(lastMonthRevenue.profit * 100) / 100,
      },
      yearRevenue: {
        revenue: Math.round(yearRevenue.revenue * 100) / 100,
        profit: Math.round(yearRevenue.profit * 100) / 100,
      },
      overallRevenue: {
        revenue: Math.round(overallRevenue.revenue * 100) / 100,
        profit: Math.round(overallRevenue.profit * 100) / 100,
      },
      monthlyTrend,
      topCustomers,
      expenseByCategory,
      pnlTrend,
      paymentMethodTotals,
    };

    setCache(CACHE_KEY, result);
    res.json(result);
  } catch (e: any) {
    console.error('Analytics error:', e.message);
    res.json({
      topMaterials: [], profitTrend: [],
      stockValue: { total_cost: 0, total_retail: 0, material_count: 0 },
      materialMargins: [], todayProfit: 0, weekRevenue: 0,
      monthRevenue: { revenue: 0, profit: 0 },
      lastMonthRevenue: { revenue: 0, profit: 0 },
      yearRevenue: { revenue: 0, profit: 0 },
      overallRevenue: { revenue: 0, profit: 0 },
      monthlyTrend: [], topCustomers: [],
      expenseByCategory: [], pnlTrend: [], paymentMethodTotals: [],
      error: e.message
    });
  }
});

export default router;
