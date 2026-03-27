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
  syncSelectedStockToTiendaNube,
  syncSelectedStockToMercadoLibre,
  syncAllStockFromMercadoLibre,
  runAutoSyncMLtoTN,
  importStockFromMercadoLibre,
  getTiendaNubeOrders,
  getTiendaNubeStock,
  getTiendaNubeStockTotals,
  getTiendaNubeProductVariants,
  getMercadoLibreOrders,
  getMercadoLibreStock,
  getMercadoLibreStockTotals,
  getMercadoLibreItemVariations,
  getVariantExternalStocks,
  getMLAutoMessageConfig,
  saveMLAutoMessageConfig,
  importProductFromMercadoLibre,
  importProductFromTiendaNube,
  testTiendaNubeOrder,
  syncTiendaNubeOrdersFromDate,
  syncMercadoLibreOrdersFromDate
} from '../controllers/integrations.controller';
import { authMiddleware } from '../middleware/auth';

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
router.get('/mercadolibre/items/:itemId/variations', getMercadoLibreItemVariations);
router.post('/variant-external-stocks', getVariantExternalStocks);
router.get('/mercadolibre/auto-message', getMLAutoMessageConfig);
router.post('/mercadolibre/auto-message', saveMLAutoMessageConfig);
router.post('/mercadolibre/sync', syncProductsFromMercadoLibre);
router.post('/mercadolibre/sync-stock', syncAllStockToMercadoLibre);
router.post('/mercadolibre/sync-stock-selected', syncSelectedStockToMercadoLibre);
router.post('/mercadolibre/sync-from-ml', syncAllStockFromMercadoLibre);
router.post('/mercadolibre/import-stock', importStockFromMercadoLibre);
router.post('/mercadolibre/import-product', importProductFromMercadoLibre);
router.post('/mercadolibre/sync-ml-to-tn', (req, res) => runAutoSyncMLtoTN().then(r => res.json({ message: 'ML → TN ejecutado', ...r })).catch(e => res.status(500).json({ message: e.message })));
router.post('/mercadolibre/webhook', handleMercadoLibreWebhook);
/** Descontar stock de ventas ML desde una fecha (ej. fromDate=2026-03-09). Idempotente. */
router.post('/mercadolibre/sync-orders-from-date', authMiddleware, syncMercadoLibreOrdersFromDate);
router.get('/mercadolibre/sync-orders-from-date', authMiddleware, syncMercadoLibreOrdersFromDate);

// Tienda Nube
router.get('/tiendanube/auth', getTiendaNubeAuthUrl);
router.get('/tiendanube/callback', handleTiendaNubeCallback);
router.get('/tiendanube/orders', getTiendaNubeOrders);
router.get('/tiendanube/stock', getTiendaNubeStock);
router.get('/tiendanube/stock/totals', getTiendaNubeStockTotals);
router.get('/tiendanube/products/:productId/variants', getTiendaNubeProductVariants);
router.post('/tiendanube/sync', syncProductsFromTiendaNube);
router.post('/tiendanube/sync-stock', syncAllStockToTiendaNube);
router.post('/tiendanube/sync-stock-selected', syncSelectedStockToTiendaNube);
router.post('/tiendanube/import-product', importProductFromTiendaNube);
router.post('/tiendanube/normalize-sizes', normalizeSizesInTiendaNube);
router.post('/tiendanube/webhook', handleTiendaNubeWebhook);
/** Probar descuento de stock por una orden TN: POST { "orderId": "123" } o GET ?orderId=123 (requiere login) */
router.post('/tiendanube/test-order', authMiddleware, testTiendaNubeOrder);
router.get('/tiendanube/test-order', authMiddleware, testTiendaNubeOrder);
/** Descontar stock de ventas TN desde una fecha (ej. fromDate=2026-03-09). Idempotente. */
router.post('/tiendanube/sync-orders-from-date', authMiddleware, syncTiendaNubeOrdersFromDate);
router.get('/tiendanube/sync-orders-from-date', authMiddleware, syncTiendaNubeOrdersFromDate);

router.delete('/:platform/disconnect', disconnectIntegration);

export default router;
