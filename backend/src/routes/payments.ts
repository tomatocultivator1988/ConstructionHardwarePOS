import { Router, Request, Response } from 'express';
import { getDb } from '../db/setup';

const router = Router();

router.get('/summary', async (_req: Request, res: Response) => {
  const db = getDb();
  try {
    const daily = await db.prepare(`
      SELECT date(payment_date) as date, COALESCE(SUM(amount), 0) as total
      FROM payments p JOIN invoices i ON i.id=p.invoice_id
      WHERE i.status <> 'voided' AND
      p.payment_date >= datetime('now', '-7 days')
      GROUP BY date(payment_date)
      ORDER BY date ASC
    `).all();

    const today = await db.prepare(`
      SELECT COALESCE(SUM(p.amount), 0) - COALESCE((SELECT SUM(r.amount) FROM refunds r JOIN invoices ri ON ri.id=r.invoice_id WHERE ri.status <> 'voided' AND date(r.created_at, '+8 hours') = date('now', '+8 hours')), 0) as total
      FROM payments p JOIN invoices i ON i.id=p.invoice_id
      WHERE i.status <> 'voided' AND date(p.payment_date, '+8 hours') = date('now', '+8 hours')
    `).get() as any;

    res.json({ daily, todayTotal: today.total });
  } catch (e: any) {
    console.error('Payments summary error:', e.message);
    res.json({ daily: [], todayTotal: 0 });
  }
});

export default router;
