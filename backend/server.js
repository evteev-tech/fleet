import 'dotenv/config';
import express from 'express';
import { requireAuth } from './auth.js';
import authRoutes    from './routes/auth.js';
import fleetRoutes   from './routes/fleet.js';
import driversRoutes from './routes/drivers.js';
import rentalsRoutes    from './routes/rentals.js';
import operationsRoutes from './routes/operations.js';
import depositsRoutes   from './routes/deposits.js';
import kassasRoutes     from './routes/kassas.js';

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const allowed = ['https://keyautotrans.ru','https://www.keyautotrans.ru','http://localhost','http://127.0.0.1'];
  if (allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use('/api', authRoutes);
app.get('/api/ping', (req, res) => res.json({ status: 'ok', message: 'pong', ts: new Date().toISOString() }));
app.use('/api', requireAuth, fleetRoutes);
app.use('/api', requireAuth, driversRoutes);
app.use('/api/rentals', requireAuth, rentalsRoutes);

app.use('/api/operations', requireAuth, operationsRoutes);
app.use('/api/deposits',   requireAuth, depositsRoutes);
app.use('/api/kassas',     requireAuth, kassasRoutes);
app.use((req, res) => res.status(404).json({ status: 'error', message: 'NOT_FOUND' }));
app.use((err, req, res, next) => { console.error('[error]', err); res.status(500).json({ status: 'error', message: 'INTERNAL_ERROR' }); });
app.listen(PORT, () => console.log(`[server] Matizi запущен на порту ${PORT}`));
