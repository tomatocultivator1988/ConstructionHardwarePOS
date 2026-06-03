import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { getDb } from '../db/setup';
import { requireAdmin } from '../lib/auth';
import { logAudit } from '../lib/audit';

const router = Router();

router.get('/', requireAdmin, (_req: Request, res: Response) => {
  const db = getDb();
  const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY created_at ASC').all();
  res.json(users);
});

router.post('/', requireAdmin, (req: Request, res: Response) => {
  const { username, pin, role } = req.body;
  if (!username || !username.trim()) { res.status(400).json({ error: 'Username required' }); return; }
  if (!pin || pin.length < 4 || pin.length > 6) { res.status(400).json({ error: 'PIN must be 4-6 digits' }); return; }
  if (role && !['admin', 'staff'].includes(role)) { res.status(400).json({ error: 'Role must be admin or staff' }); return; }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
  if (existing) { res.status(409).json({ error: 'Username already exists' }); return; }

  const id = uuidv4();
  const hash = bcrypt.hashSync(pin, 10);
  db.prepare('INSERT INTO users (id, username, pin_hash, role) VALUES (?, ?, ?, ?)').run(id, username.trim(), hash, role || 'staff');

  logAudit(req.user?.id || null, 'create', 'user', id, `Created user ${username}`);

  const user = db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(id);
  res.status(201).json(user);
});

router.put('/:id', requireAdmin, (req: Request, res: Response) => {
  const db = getDb();
  const uid = req.params.id as string;
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(uid) as any;
  if (!existing) { res.status(404).json({ error: 'User not found' }); return; }

  const { pin, role } = req.body;
  if (role && !['admin', 'staff'].includes(role)) { res.status(400).json({ error: 'Role must be admin or staff' }); return; }
  if (pin && (pin.length < 4 || pin.length > 6)) { res.status(400).json({ error: 'PIN must be 4-6 digits' }); return; }

  if (pin) {
    const hash = bcrypt.hashSync(pin, 10);
    db.prepare('UPDATE users SET pin_hash = ?, role = ? WHERE id = ?').run(hash, role || existing.role, uid);
  } else if (role) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, uid);
  }

  logAudit(req.user?.id || null, 'update', 'user', uid, role ? `Changed role to ${role}` : 'Changed PIN');

  res.json(db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(uid));
});

router.delete('/:id', requireAdmin, (req: Request, res: Response) => {
  const db = getDb();
  const uid = req.params.id as string;
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(uid) as any;
  if (!existing) { res.status(404).json({ error: 'User not found' }); return; }
  if (existing.role === 'admin') {
    const adminCount = (db.prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin'").get() as any).cnt;
    if (adminCount <= 1) { res.status(400).json({ error: 'Cannot delete the last admin' }); return; }
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(uid);
  logAudit(req.user?.id || null, 'delete', 'user', uid, `Deleted user ${existing.username}`);
  res.status(204).send();
});

router.get('/me', (req: Request, res: Response) => {
  if (!req.user) { res.json(null); return; }
  res.json(req.user);
});

export default router;
