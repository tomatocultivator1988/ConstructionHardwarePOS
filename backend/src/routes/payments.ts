import { Router, Request, Response } from 'express';
import { getDb } from '../db/setup';

const router = Router();

router.get('/summary', (_req: Request, res: Response) => {
  const db = getDb();

  const daily = db.prepare(`
    SELECT date(payment_date) as date, COALESCE(SUM(amount), 0) as total
    FROM payments
    WHERE payment_date >= datetime('now', '-7 days')
    GROUP BY date(payment_date)
    ORDER BY date ASC
  `).all();

  const today = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM payments
    WHERE date(payment_date) = date('now')
  `).get() as any;

  res.json({ daily, todayTotal: today.total });
});

export default router;
