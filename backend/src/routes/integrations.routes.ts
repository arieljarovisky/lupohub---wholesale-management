import { Router } from 'express';
import {
  getIntegrationStatus,
  getMercadoLibreAuthUrl,
  handleMercadoLibreCallback,
  getTiendaNubeAuthUrl,
  handleTiendaNubeCallback,
  syncProductsFromTiendaNube,
  normalizeSizesInTiendaNube,
  normalizeColorsInTiendaNube,
  syncSkusToTiendaNube,
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
  getMercadoLibreQuestions,
  getMercadoLibreStock,
  getMercadoLibreStockTotals,
  getMercadoLibreItemVariations,
  getVariantExternalStocks,
  getMLAutoMessageConfig,
  saveMLAutoMessageConfig,
  getMLQuestionsAiConfig,
  saveMLQuestionsAiConfig,
  processMLQuestionsAi,
  importProductFromMercadoLibre,
  importProductFromTiendaNube,
  createTiendaNubeProduct,
  duplicateTiendaNubeProduct,
  testTiendaNubeOrder,
  syncTiendaNubeOrdersFromDate,
  syncMercadoLibreOrdersFromDate,
  testMercadoLibreOrder,
  invoiceTiendaNubeOrdersBulk,
  invoiceMercadoLibreOrdersBulk,
  getExternalInvoicesHistory,
  emitirNotaCreditoExternalInvoice,
  getMercadoLibreProductAdsAdvertisers,
  getMercadoLibreProductAdsCampaigns,
  getMercadoLibreProductAdsAds,
  getMercadoLibreBrandAdsAdvertisers,
  getMercadoLibreBrandAdsCampaigns,
  getMercadoLibreDisplayAdsAdvertisers,
  getMercadoLibreDisplayAdsCampaigns
} from '../controllers/integrations.controller';
import { exportMercadolibrePublicationsXlsx } from '../controllers/mercadolibrePublicationsExport.controller';
import { exportMercadoLibreToTiendaNube } from '../controllers/mlToTiendaNubeExport.controller';
import { getVariantChannelPrices, bulkUpdateChannelPrices } from '../controllers/channelPrices.controller';
import { getChannelMargins } from '../controllers/channelMargins.controller';
import { exportTiendaNubeSalesReportXlsx } from '../controllers/tiendanubeSalesReport.controller';
import {
  listTiendaNubeCategoryMatches,
  downloadTiendaNubeCategoryImagesZip,
} from '../controllers/tiendanubeCategoryImages.controller';
import { getTiendaNubeCatalog } from '../controllers/tiendanubeCatalog.controller';
import {
  getTiendaNubeCatalogConfig,
  saveTiendaNubeCatalogConfig,
} from '../controllers/tiendanubeCatalogConfig.controller';
import { authMiddleware } from '../middleware/auth';
import {
  getLupoWebhookConfigEndpoint,
  saveLupoWebhookConfigEndpoint,
  testLupoWebhookEndpoint,
  syncLupoShopMlStockBulkEndpoint
} from '../controllers/lupoWebhookSettings.controller';

const router = Router();

router.get('/status', getIntegrationStatus);
router.get('/luposhop/webhook-config', authMiddleware, getLupoWebhookConfigEndpoint);
router.post('/luposhop/webhook-config', authMiddleware, saveLupoWebhookConfigEndpoint);
router.post('/luposhop/webhook-test', authMiddleware, testLupoWebhookEndpoint);
router.post('/luposhop/sync-ml-stock-to-shop', authMiddleware, syncLupoShopMlStockBulkEndpoint);

// Mercado Libre
router.get('/mercadolibre/auth', getMercadoLibreAuthUrl);
router.get('/mercadolibre/callback', handleMercadoLibreCallback);
router.get('/mercadolibre/test', testMercadoLibreConnection);
router.get('/mercadolibre/debug', debugMercadoLibreItem);
router.get('/mercadolibre/orders', getMercadoLibreOrders);
router.get('/mercadolibre/questions', getMercadoLibreQuestions);
router.get('/mercadolibre/stock', getMercadoLibreStock);
router.get('/mercadolibre/stock/totals', getMercadoLibreStockTotals);
/** Métricas Mercado Ads (Product Ads): anunciantes, campañas y anuncios por publicación. */
router.get('/mercadolibre/product-ads/advertisers', getMercadoLibreProductAdsAdvertisers);
router.get('/mercadolibre/product-ads/campaigns', getMercadoLibreProductAdsCampaigns);
router.get('/mercadolibre/product-ads/ads', getMercadoLibreProductAdsAds);
router.get('/mercadolibre/brand-ads/advertisers', getMercadoLibreBrandAdsAdvertisers);
router.get('/mercadolibre/brand-ads/campaigns', getMercadoLibreBrandAdsCampaigns);
router.get('/mercadolibre/display-ads/advertisers', getMercadoLibreDisplayAdsAdvertisers);
router.get('/mercadolibre/display-ads/campaigns', getMercadoLibreDisplayAdsCampaigns);
/** Excel: publicaciones ML + precio mayorista + último FOB por variante (requiere login). */
router.get('/mercadolibre/publications-export', authMiddleware, exportMercadolibrePublicationsXlsx);
router.get('/mercadolibre/items/:itemId/variations', getMercadoLibreItemVariations);
router.post('/variant-external-stocks', getVariantExternalStocks);
router.post('/variant-channel-prices', authMiddleware, getVariantChannelPrices);
router.post('/variant-channel-prices/bulk', authMiddleware, bulkUpdateChannelPrices);
router.get('/channel-margins', authMiddleware, getChannelMargins);
router.get('/mercadolibre/auto-message', getMLAutoMessageConfig);
router.post('/mercadolibre/auto-message', saveMLAutoMessageConfig);
router.get('/mercadolibre/questions-ai', authMiddleware, getMLQuestionsAiConfig);
router.post('/mercadolibre/questions-ai', authMiddleware, saveMLQuestionsAiConfig);
router.post('/mercadolibre/questions-ai/process', authMiddleware, processMLQuestionsAi);
router.post('/mercadolibre/sync', syncProductsFromMercadoLibre);
router.post('/mercadolibre/sync-stock', syncAllStockToMercadoLibre);
router.post('/mercadolibre/sync-stock-selected', syncSelectedStockToMercadoLibre);
router.post('/mercadolibre/sync-from-ml', syncAllStockFromMercadoLibre);
router.post('/mercadolibre/import-stock', importStockFromMercadoLibre);
router.post('/mercadolibre/import-product', importProductFromMercadoLibre);
router.post('/mercadolibre/export-to-tiendanube', authMiddleware, exportMercadoLibreToTiendaNube);
router.post('/mercadolibre/sync-ml-to-tn', (req, res) => runAutoSyncMLtoTN().then(r => res.json({ message: 'ML → TN ejecutado', ...r })).catch(e => res.status(500).json({ message: e.message })));
router.post('/mercadolibre/webhook', handleMercadoLibreWebhook);
/** Descontar stock de ventas ML desde una fecha (ej. fromDate=2026-03-09). Idempotente. */
router.post('/mercadolibre/sync-orders-from-date', authMiddleware, syncMercadoLibreOrdersFromDate);
router.get('/mercadolibre/sync-orders-from-date', authMiddleware, syncMercadoLibreOrdersFromDate);
/** Probar descuento de stock por una orden ML: POST { "orderId": "200..." } o GET ?orderId=200... (requiere login) */
router.post('/mercadolibre/test-order', authMiddleware, testMercadoLibreOrder);
router.get('/mercadolibre/test-order', authMiddleware, testMercadoLibreOrder);
router.post('/mercadolibre/invoice-bulk', authMiddleware, invoiceMercadoLibreOrdersBulk);

// Tienda Nube
router.get('/tiendanube/auth', getTiendaNubeAuthUrl);
router.get('/tiendanube/callback', handleTiendaNubeCallback);
router.get('/tiendanube/orders', getTiendaNubeOrders);
router.get('/tiendanube/stock', getTiendaNubeStock);
router.get('/tiendanube/stock/totals', getTiendaNubeStockTotals);
router.get('/tiendanube/sales-report-export', authMiddleware, exportTiendaNubeSalesReportXlsx);
router.get('/tiendanube/category-images/preview', authMiddleware, listTiendaNubeCategoryMatches);
router.get('/tiendanube/category-images/download', authMiddleware, downloadTiendaNubeCategoryImagesZip);
router.get('/tiendanube/catalog', authMiddleware, getTiendaNubeCatalog);
router.get('/tiendanube/catalog/config', authMiddleware, getTiendaNubeCatalogConfig);
router.put('/tiendanube/catalog/config', authMiddleware, saveTiendaNubeCatalogConfig);
router.get('/tiendanube/products/:productId/variants', getTiendaNubeProductVariants);
router.post('/tiendanube/products', createTiendaNubeProduct);
router.post('/tiendanube/products/:productId/duplicate', duplicateTiendaNubeProduct);
router.post('/tiendanube/sync', syncProductsFromTiendaNube);
router.post('/tiendanube/sync-stock', syncAllStockToTiendaNube);
router.post('/tiendanube/sync-stock-selected', syncSelectedStockToTiendaNube);
router.post('/tiendanube/import-product', importProductFromTiendaNube);
router.post('/tiendanube/normalize-sizes', normalizeSizesInTiendaNube);
router.post('/tiendanube/normalize-colors', normalizeColorsInTiendaNube);
router.post('/tiendanube/sync-skus', syncSkusToTiendaNube);
router.post('/tiendanube/webhook', handleTiendaNubeWebhook);
/** Probar descuento de stock por una orden TN: POST { "orderId": "123" } o GET ?orderId=123 (requiere login) */
router.post('/tiendanube/test-order', authMiddleware, testTiendaNubeOrder);
router.get('/tiendanube/test-order', authMiddleware, testTiendaNubeOrder);
/** Descontar stock de ventas TN desde una fecha (ej. fromDate=2026-03-09). Idempotente. */
router.post('/tiendanube/sync-orders-from-date', authMiddleware, syncTiendaNubeOrdersFromDate);
router.get('/tiendanube/sync-orders-from-date', authMiddleware, syncTiendaNubeOrdersFromDate);
router.post('/tiendanube/invoice-bulk', authMiddleware, invoiceTiendaNubeOrdersBulk);
router.get('/invoices/external', authMiddleware, getExternalInvoicesHistory);
router.post('/invoices/external/:id/credit-note', authMiddleware, emitirNotaCreditoExternalInvoice);

router.delete('/:platform/disconnect', disconnectIntegration);

export default router;
