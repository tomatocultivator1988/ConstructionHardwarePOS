import express from 'express';
import cors from 'cors';
import customerRoutes from './routes/customers';
import materialRoutes from './routes/materials';
import invoiceRoutes from './routes/invoices';
import settingsRoutes from './routes/settings';
import paymentRoutes from './routes/payments';
import analyticsRoutes from './routes/analytics';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/api/customers', customerRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/analytics', analyticsRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/{*path}', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
