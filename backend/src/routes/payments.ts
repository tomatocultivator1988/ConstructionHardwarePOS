import { Router, Request, Response } from 'express';
import { getDb } from '../db/setup';

const router = Router();

router.get('/summary', async (_req: Request, res: Response) => {
  const db = getDb();
  try {
    const daily = await db.prepare(`
      SELECT date(payment_date) as date, COALESCE(SUM(amount), 0) as total
      FROM payments
      WHERE payment_date >= datetime('now', '-7 days')
      GROUP BY date(payment_date)
      ORDER BY date ASC
    `).all();

    const today = await db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM payments
      WHERE date(payment_date) = date('now')
    `).get() as any;

    res.json({ daily, todayTotal: today.total });
  } catch (e: any) {
    console.error('Payments summary error:', e.message);
    res.json({ daily: [], todayTotal: 0 });
  }
});

export default router;
