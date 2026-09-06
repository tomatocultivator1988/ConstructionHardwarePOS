import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? (() => { throw new Error('JWT_SECRET is required in production'); })() : 'buildpro-jwt-secret-change-in-env');

export interface AuthUser {
  id: string;
  username: string;
  role: 'admin' | 'staff';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const skipAuth = req.path === '/health' || req.path === '/auth/login';
  if (skipAuth) return next();

  // If no users exist yet (first run), skip auth
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

export function requireAdminOrPOS(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role === 'admin') return next();
  const method = req.method;
  const path = req.path;
  const allowed = method === 'GET' ||
    (path.endsWith('/pay') && method === 'POST') ||
    (path === '/me' && method === 'GET');
  if (allowed) return next();
  res.status(403).json({ error: 'Staff accounts can access POS only' });
}

export function signToken(user: { id: string; username: string; role: string }): string {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
}
