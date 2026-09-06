import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../db/setup';
import { signToken } from '../lib/auth';

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  const { username, pin } = req.body;
  if (!username || !pin) {
    res.status(400).json({ error: 'Username and PIN are required' });
    return;
  }

  const db = getDb();
  const user = await db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
  if (!user) {
    console.log('Login failed: user not found:', username);
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  if (!bcrypt.compareSync(pin, user.pin_hash)) {
    console.log('Login failed: wrong PIN for user:', username);
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  if (user.role === 'staff') {
    const shift = await db.prepare("SELECT id FROM cashier_shifts WHERE user_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1").get(user.id);
    if (!shift) { res.status(403).json({ error: 'Your shift has not been opened. Please contact the admin.' }); return; }
  }

  const token = signToken({ id: user.id, username: user.username, role: user.role });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

export default router;
