import { Router } from 'express';
import { 
  getIntegrationStatus, 
  getMercadoLibreAuthUrl, 
  handleMercadoLibreCallback,
  getTiendaNubeAuthUrl,
  handleTiendaNubeCallback,
  syncProductsFromTiendaNube,
  normalizeSizesInTiendaNube,
  disconnectIntegration,
  testMercadoLibreConnection,
  syncProductsFromMercadoLibre,
  debugMercadoLibreItem,
  handleTiendaNubeWebhook,
  handleMercadoLibreWebhook,
  syncAllStockToTiendaNube,
  syncAllStockToMercadoLibre,
  syncAllStockFromMercadoLibre,
  runAutoSyncMLtoTN,
  importStockFromMercadoLibre,
  getTiendaNubeOrders,
  getTiendaNubeStock,
  getTiendaNubeStockTotals,
  getMercadoLibreOrders,
  getMercadoLibreStock,
  getMercadoLibreStockTotals,
  getMLAutoMessageConfig,
  saveMLAutoMessageConfig
} from '../controllers/integrations.controller';

const router = Router();

router.get('/status', getIntegrationStatus);

// Mercado Libre
router.get('/mercadolibre/auth', getMercadoLibreAuthUrl);
router.get('/mercadolibre/callback', handleMercadoLibreCallback);
router.get('/mercadolibre/test', testMercadoLibreConnection);
router.get('/mercadolibre/debug', debugMercadoLibreItem);
router.get('/mercadolibre/orders', getMercadoLibreOrders);
router.get('/mercadolibre/stock', getMercadoLibreStock);
router.get('/mercadolibre/stock/totals', getMercadoLibreStockTotals);
router.get('/mercadolibre/auto-message', getMLAutoMessageConfig);
router.post('/mercadolibre/auto-message', saveMLAutoMessageConfig);
router.post('/mercadolibre/sync', syncProductsFromMercadoLibre);
router.post('/mercadolibre/sync-stock', syncAllStockToMercadoLibre);
router.post('/mercadolibre/sync-from-ml', syncAllStockFromMercadoLibre);
router.post('/mercadolibre/import-stock', importStockFromMercadoLibre);
router.post('/mercadolibre/sync-ml-to-tn', (req, res) => runAutoSyncMLtoTN().then(r => res.json({ message: 'ML → TN ejecutado', ...r })).catch(e => res.status(500).json({ message: e.message })));
router.post('/mercadolibre/webhook', handleMercadoLibreWebhook);

// Tienda Nube
router.get('/tiendanube/auth', getTiendaNubeAuthUrl);
router.get('/tiendanube/callback', handleTiendaNubeCallback);
router.get('/tiendanube/orders', getTiendaNubeOrders);
router.get('/tiendanube/stock', getTiendaNubeStock);
router.get('/tiendanube/stock/totals', getTiendaNubeStockTotals);
router.post('/tiendanube/sync', syncProductsFromTiendaNube);
router.post('/tiendanube/sync-stock', syncAllStockToTiendaNube);
router.post('/tiendanube/normalize-sizes', normalizeSizesInTiendaNube);
router.post('/tiendanube/webhook', handleTiendaNubeWebhook);

router.delete('/:platform/disconnect', disconnectIntegration);

export default router;
