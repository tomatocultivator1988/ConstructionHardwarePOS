import { Router, Request, Response } from 'express';
import { getDb } from '../db/setup';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const db = getDb();
  let query = `
    SELECT sm.*, m.name AS material_name, m.unit
    FROM stock_movements sm
    JOIN materials m ON m.id = sm.material_id
  `;
  const params: any[] = [];
  const conditions: string[] = [];

  if (req.query.material_id) {
    conditions.push('sm.material_id = ?');
    params.push(req.query.material_id);
  }
  if (req.query.type) {
    conditions.push('sm.type = ?');
    params.push(req.query.type);
  }
  if (req.query.from) {
    conditions.push('sm.created_at >= ?');
    params.push(req.query.from);
  }
  if (req.query.to) {
    conditions.push('sm.created_at <= ?');
    params.push(req.query.to);
  }

  if (conditions.length) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY sm.created_at DESC LIMIT 200';

  res.json(await db.prepare(query).all(...params));
});

export default router;
