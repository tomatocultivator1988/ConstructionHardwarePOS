import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import customerRoutes from './routes/customers';
import materialRoutes from './routes/materials';
import invoiceRoutes from './routes/invoices';
import settingsRoutes from './routes/settings';
import paymentRoutes from './routes/payments';
import analyticsRoutes from './routes/analytics';

const app = express();
const PORT = process.env.PORT || 3001;
const API_TOKEN = process.env.API_TOKEN || '';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
const NODE_ENV = process.env.NODE_ENV || ((process as any).pkg ? 'production' : 'development');

// Request logging
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// CORS — restrict to known origin
app.use(cors({
  origin: CORS_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-API-Token'],
}));

// Body parsing with size limit
app.use(express.json({ limit: '1mb' }));

// Rate limiting
import rateLimit from 'express-rate-limit';
app.use('/api', rateLimit({
  windowMs: 60000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health',
  message: { error: 'Too many requests, please try again later' },
}));

// API token authentication
app.use('/api', (req, res, next) => {
  if (!API_TOKEN) {
    console.warn('WARNING: API_TOKEN is not set. Authentication is DISABLED. Set API_TOKEN in your .env file.');
  }
  if (req.path === '/health') return next();
  if (API_TOKEN && req.headers['x-api-token'] !== API_TOKEN) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
});

// API routes
app.use('/api/customers', customerRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/analytics', analyticsRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', environment: NODE_ENV });
});

// In production, serve the built frontend
if (NODE_ENV === 'production') {
  const frontendDist = path.join(__dirname, 'frontend-dist');
  app.use(express.static(frontendDist));
  app.get('/{*path}', (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
} else {
  // Catch-all for unknown API routes (dev only)
  app.use((_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });
}

// Global error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} [${NODE_ENV}]`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
