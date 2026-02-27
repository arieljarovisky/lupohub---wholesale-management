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
  getTiendaNubeOrders,
  getMercadoLibreOrders,
  getMercadoLibreStock
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
router.post('/mercadolibre/sync', syncProductsFromMercadoLibre);
router.post('/mercadolibre/sync-stock', syncAllStockToMercadoLibre);
router.post('/mercadolibre/webhook', handleMercadoLibreWebhook);

// Tienda Nube
router.get('/tiendanube/auth', getTiendaNubeAuthUrl);
router.get('/tiendanube/callback', handleTiendaNubeCallback);
router.get('/tiendanube/orders', getTiendaNubeOrders);
router.post('/tiendanube/sync', syncProductsFromTiendaNube);
router.post('/tiendanube/sync-stock', syncAllStockToTiendaNube);
router.post('/tiendanube/normalize-sizes', normalizeSizesInTiendaNube);
router.post('/tiendanube/webhook', handleTiendaNubeWebhook);

router.delete('/:platform/disconnect', disconnectIntegration);

export default router;
