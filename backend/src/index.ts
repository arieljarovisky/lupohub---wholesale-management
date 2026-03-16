import express, { RequestHandler } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import productRoutes from './routes/products.routes';
import orderRoutes from './routes/orders.routes';
import authRoutes from './routes/auth.routes';
import colorRoutes from './routes/colors.routes';
import sizeRoutes from './routes/sizes.routes';
import integrationRoutes from './routes/integrations.routes';
import stockRoutes from './routes/stock.routes';
import despachosRoutes from './routes/despachos.routes';
import usersRoutes from './routes/users.routes';
import customersRoutes from './routes/customers.routes';
import transportesRoutes from './routes/transportes.routes';
import priceListsRoutes from './routes/price_lists.routes';
import catalogsRoutes from './routes/catalogs.routes';
import afipRoutes from './routes/afip.routes';
import { authMiddleware } from './middleware/auth';
import { addStockMovementsTable } from './database/add_stock_movements_table';
import { addDispatchedAtToOrders } from './database/add_dispatched_at_orders';
import { fixIntegrationsTable } from './database/fix_integrations_table';
import { addDespachosTable } from './database/add_despachos_table';
import { addPackSizeToProducts } from './database/add_pack_size_products';
import { addExternalSkuToVariants } from './database/add_external_sku';
import { addMercadoLibreItemIdToVariants } from './database/add_mercado_libre_item_id';
import { addCustomerDirect } from './database/add_customer_direct';
import { addCustomerCuit } from './database/add_customer_cuit';
import { addCustomerPhoneIva } from './database/add_customer_phone_iva';
import { addTransportesTables } from './database/add_transportes_tables';
import { addInvoicesTable } from './database/add_invoices_table';
import { addPriceLists } from './database/add_price_lists';
import { addCatalogsTable } from './database/add_catalogs_table';
import { initSchema } from './database/init_schema';
import { ensureAdminUser } from './database/ensure_admin_user';
import { testConnection } from './database/db';
import { runAutoSyncMLtoTN } from './controllers/integrations.controller';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// CORS: con credentials (cookies) no se puede usar '*'; hay que devolver el origen concreto
const allowedOrigins: string[] = [
  'https://lupohub-wholesale-management.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000'
];
const frontendUrl = process.env.FRONTEND_URL?.replace(/\/$/, '');
if (frontendUrl && !allowedOrigins.includes(frontendUrl)) allowedOrigins.push(frontendUrl);

const corsOpts: cors.CorsOptions = {
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(null, false);
  },
  credentials: true
};
app.use(cors(corsOpts) as RequestHandler);
app.use(express.json() as any);
app.use((req, res, next) => {
  console.log('[backend]', req.method, req.path);
  next();
});

// Routes
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/colors', colorRoutes);
app.use('/api/sizes', sizeRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/despachos', despachosRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/transportes', transportesRoutes);
app.use('/api/price-lists', priceListsRoutes);
app.use('/api/catalogs', catalogsRoutes);
app.use('/api/afip', afipRoutes);

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'LupoHub Backend', db: 'MySQL' });
});

// Initialize database tables (con reintentos por si MySQL tarda en Railway)
async function initDatabase() {
  const maxAttempts = 5;
  const delayMs = 3000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[DB] Intento ${attempt}/${maxAttempts} de conectar a MySQL...`);
      await testConnection();
      console.log('[DB] Conexión OK, creando/verificando tablas...');
      await initSchema();
      await ensureAdminUser();
      await addStockMovementsTable();
      await addDispatchedAtToOrders();
      await fixIntegrationsTable();
      await addDespachosTable();
      await addPackSizeToProducts();
      await addExternalSkuToVariants();
      await addMercadoLibreItemIdToVariants();
      await addCustomerDirect();
      await addCustomerCuit();
      await addCustomerPhoneIva();
      await addTransportesTables();
      await addInvoicesTable();
      await addPriceLists();
      await addCatalogsTable();
      console.log('[DB] Tablas inicializadas correctamente');
      return;
    } catch (err: any) {
      console.error(`[DB] Intento ${attempt} fallido:`, err?.code || err?.message);
      if (attempt < maxAttempts) {
        console.log(`[DB] Reintento en ${delayMs / 1000}s...`);
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        console.error('[DB] No se pudo conectar después de', maxAttempts, 'intentos. Revisá que MYSQL_URL esté definida (Variable Reference al servicio MySQL) y que ambos servicios estén en el mismo proyecto.');
      }
    }
  }
}

initDatabase().catch(console.error);

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  const intervalMin = Math.max(1, parseInt(process.env.SYNC_ML_TN_INTERVAL_MINUTES || '30', 10));
  const intervalMs = intervalMin * 60 * 1000;
  if (process.env.SYNC_ML_TN_AUTO !== '0' && process.env.SYNC_ML_TN_AUTO !== 'false') {
    runAutoSyncMLtoTN().catch(() => {});
    setInterval(() => runAutoSyncMLtoTN().catch(() => {}), intervalMs);
    console.log(`[AutoSync] ML → TN cada ${intervalMin} min`);
  }
});
