import { Router, Request, Response } from 'express';
import { getDb } from '../db/setup';

const router = Router();

router.get('/dashboard', async (_req: Request, res: Response) => {
  const db = getDb();

  // Top 5 selling materials by quantity
  const topMaterials = await db.prepare(`
    SELECT ii.material_id, m.name, m.unit, m.cost_price,
      SUM(ii.quantity) AS total_qty,
      SUM(ii.total) AS total_revenue,
      SUM(ii.quantity * COALESCE(m.cost_price, 0)) AS total_cost
    FROM invoice_items ii
    JOIN materials m ON m.id = ii.material_id
    WHERE ii.material_id IS NOT NULL
    GROUP BY ii.material_id
    ORDER BY total_qty DESC
    LIMIT 5
  `).all() as any[];

  // Profit trend for last 7 days (from payments)
  const profitTrend = await db.prepare(`
    WITH dates AS (
      SELECT date('now', '-' || (6 - t) || ' days') AS d
      FROM (SELECT 0 AS t UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6)
    )
    SELECT dates.d AS date,
      COALESCE(SUM(p.amount), 0) AS revenue,
      COALESCE(SUM(p.amount * COALESCE(v.profit_ratio, 0)), 0) AS profit
    FROM dates
    LEFT JOIN payments p ON date(p.payment_date) = dates.d
    LEFT JOIN v_invoice_profit_margin v ON v.invoice_id = p.invoice_id
    GROUP BY dates.d
    ORDER BY dates.d
  `).all() as any[];

  // Stock value
  const stockValue = await db.prepare(`
    SELECT
      SUM(stock * COALESCE(cost_price, 0)) AS total_cost,
      SUM(stock * price_per_unit) AS total_retail,
      COUNT(*) AS material_count
    FROM materials
  `).get() as any;

  // Material margins
  const materialMargins = await db.prepare(`
    SELECT name, unit, cost_price, price_per_unit, stock,
      (price_per_unit - cost_price) AS profit_per_unit,
      CASE WHEN price_per_unit > 0
        THEN ROUND(((price_per_unit - cost_price) / price_per_unit) * 100, 1)
        ELSE 0 END AS margin_pct
    FROM materials
    ORDER BY margin_pct DESC
  `).all() as any[];

  // Today's profit estimate
  const todayProfit = await db.prepare(`
    SELECT COALESCE(SUM(p.amount * COALESCE(v.profit_ratio, 0)), 0) AS profit
    FROM payments p
    LEFT JOIN v_invoice_profit_margin v ON v.invoice_id = p.invoice_id
    WHERE date(p.payment_date) = date('now')
  `).get() as any;

  // Weekly revenue (last 7 days sum)
  const weekRevenue = await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM payments
    WHERE payment_date >= datetime('now', '-7 days')
  `).get() as any;

  // Monthly revenue & profit
  const monthRevenue = await db.prepare(`
    SELECT COALESCE(SUM(p.amount), 0) AS revenue,
      COALESCE(SUM(p.amount * COALESCE(v.profit_ratio, 0)), 0) AS profit
    FROM payments p
    LEFT JOIN v_invoice_profit_margin v ON v.invoice_id = p.invoice_id
    WHERE strftime('%Y-%m', p.payment_date) = strftime('%Y-%m', 'now')
  `).get() as any;

  // Last month revenue & profit (for comparison)
  const lastMonthRevenue = await db.prepare(`
    SELECT COALESCE(SUM(p.amount), 0) AS revenue,
      COALESCE(SUM(p.amount * COALESCE(v.profit_ratio, 0)), 0) AS profit
    FROM payments p
    LEFT JOIN v_invoice_profit_margin v ON v.invoice_id = p.invoice_id
    WHERE strftime('%Y-%m', p.payment_date) = strftime('%Y-%m', 'now', '-1 month')
  `).get() as any;

  // Yearly revenue & profit
  const yearRevenue = await db.prepare(`
    SELECT COALESCE(SUM(p.amount), 0) AS revenue,
      COALESCE(SUM(p.amount * COALESCE(v.profit_ratio, 0)), 0) AS profit
    FROM payments p
    LEFT JOIN v_invoice_profit_margin v ON v.invoice_id = p.invoice_id
    WHERE strftime('%Y', p.payment_date) = strftime('%Y', 'now')
  `).get() as any;

  // Overall total revenue & profit
  const overallRevenue = await db.prepare(`
    SELECT COALESCE(SUM(p.amount), 0) AS revenue,
      COALESCE(SUM(p.amount * COALESCE(v.profit_ratio, 0)), 0) AS profit
    FROM payments p
    LEFT JOIN v_invoice_profit_margin v ON v.invoice_id = p.invoice_id
  `).get() as any;

  // Monthly trend (last 6 months)
  const monthlyTrend = await db.prepare(`
    WITH months AS (
      SELECT strftime('%Y-%m', 'now', '-' || (5 - t) || ' months') AS m
      FROM (SELECT 0 AS t UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5)
    )
    SELECT months.m AS month,
      COALESCE(SUM(p.amount), 0) AS revenue,
      COALESCE(SUM(p.amount * COALESCE(v.profit_ratio, 0)), 0) AS profit
    FROM months
    LEFT JOIN payments p ON strftime('%Y-%m', p.payment_date) = months.m
    LEFT JOIN v_invoice_profit_margin v ON v.invoice_id = p.invoice_id
    GROUP BY months.m
    ORDER BY months.m
  `).all() as any[];

  // Top customers by revenue
  const topCustomers = await db.prepare(`
    SELECT COALESCE(c.name, 'Walk-in') AS name,
      COUNT(DISTINCT i.id) AS invoice_count,
      SUM(p.amount) AS total_paid
    FROM payments p
    JOIN invoices i ON i.id = p.invoice_id
    LEFT JOIN customers c ON c.id = i.customer_id
    GROUP BY i.customer_id
    ORDER BY total_paid DESC
    LIMIT 5
  `).all() as any[];

  res.json({
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
  });
});

export default router;
