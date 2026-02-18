import express, { RequestHandler } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import productRoutes from './routes/products.routes';
import orderRoutes from './routes/orders.routes';
import authRoutes from './routes/auth.routes';
import colorRoutes from './routes/colors.routes';
import sizeRoutes from './routes/sizes.routes';
import integrationRoutes from './routes/integrations.routes';
import { authMiddleware } from './middleware/auth';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors() as any);
app.use(express.json() as any);
app.use((req, res, next) => {
  console.log('[backend]', req.method, req.path);
  next();
});

// Routes
app.use('/api/products', productRoutes); // Disabled auth for demo/debugging purposes, or fix frontend token
app.use('/api/orders', orderRoutes);
app.use('/api/colors', colorRoutes);
app.use('/api/sizes', sizeRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/integrations', integrationRoutes);

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'LupoHub Backend', db: 'MySQL' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
