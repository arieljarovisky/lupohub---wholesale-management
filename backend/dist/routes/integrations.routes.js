"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const integrations_controller_1 = require("../controllers/integrations.controller");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.get('/status', integrations_controller_1.getIntegrationStatus);
// Mercado Libre
router.get('/mercadolibre/auth', integrations_controller_1.getMercadoLibreAuthUrl);
router.get('/mercadolibre/callback', integrations_controller_1.handleMercadoLibreCallback);
router.get('/mercadolibre/test', integrations_controller_1.testMercadoLibreConnection);
router.get('/mercadolibre/debug', integrations_controller_1.debugMercadoLibreItem);
router.get('/mercadolibre/orders', integrations_controller_1.getMercadoLibreOrders);
router.get('/mercadolibre/stock', integrations_controller_1.getMercadoLibreStock);
router.get('/mercadolibre/stock/totals', integrations_controller_1.getMercadoLibreStockTotals);
router.get('/mercadolibre/items/:itemId/variations', integrations_controller_1.getMercadoLibreItemVariations);
router.post('/variant-external-stocks', integrations_controller_1.getVariantExternalStocks);
router.get('/mercadolibre/auto-message', integrations_controller_1.getMLAutoMessageConfig);
router.post('/mercadolibre/auto-message', integrations_controller_1.saveMLAutoMessageConfig);
router.post('/mercadolibre/sync', integrations_controller_1.syncProductsFromMercadoLibre);
router.post('/mercadolibre/sync-stock', integrations_controller_1.syncAllStockToMercadoLibre);
router.post('/mercadolibre/sync-stock-selected', integrations_controller_1.syncSelectedStockToMercadoLibre);
router.post('/mercadolibre/sync-from-ml', integrations_controller_1.syncAllStockFromMercadoLibre);
router.post('/mercadolibre/import-stock', integrations_controller_1.importStockFromMercadoLibre);
router.post('/mercadolibre/import-product', integrations_controller_1.importProductFromMercadoLibre);
router.post('/mercadolibre/sync-ml-to-tn', (req, res) => (0, integrations_controller_1.runAutoSyncMLtoTN)().then(r => res.json(Object.assign({ message: 'ML → TN ejecutado' }, r))).catch(e => res.status(500).json({ message: e.message })));
router.post('/mercadolibre/webhook', integrations_controller_1.handleMercadoLibreWebhook);
/** Descontar stock de ventas ML desde una fecha (ej. fromDate=2026-03-09). Idempotente. */
router.post('/mercadolibre/sync-orders-from-date', auth_1.authMiddleware, integrations_controller_1.syncMercadoLibreOrdersFromDate);
router.get('/mercadolibre/sync-orders-from-date', auth_1.authMiddleware, integrations_controller_1.syncMercadoLibreOrdersFromDate);
/** Probar descuento de stock por una orden ML: POST { "orderId": "200..." } o GET ?orderId=200... (requiere login) */
router.post('/mercadolibre/test-order', auth_1.authMiddleware, integrations_controller_1.testMercadoLibreOrder);
router.get('/mercadolibre/test-order', auth_1.authMiddleware, integrations_controller_1.testMercadoLibreOrder);
router.post('/mercadolibre/invoice-bulk', auth_1.authMiddleware, integrations_controller_1.invoiceMercadoLibreOrdersBulk);
// Tienda Nube
router.get('/tiendanube/auth', integrations_controller_1.getTiendaNubeAuthUrl);
router.get('/tiendanube/callback', integrations_controller_1.handleTiendaNubeCallback);
router.get('/tiendanube/orders', integrations_controller_1.getTiendaNubeOrders);
router.get('/tiendanube/stock', integrations_controller_1.getTiendaNubeStock);
router.get('/tiendanube/stock/totals', integrations_controller_1.getTiendaNubeStockTotals);
router.get('/tiendanube/products/:productId/variants', integrations_controller_1.getTiendaNubeProductVariants);
router.post('/tiendanube/sync', integrations_controller_1.syncProductsFromTiendaNube);
router.post('/tiendanube/sync-stock', integrations_controller_1.syncAllStockToTiendaNube);
router.post('/tiendanube/sync-stock-selected', integrations_controller_1.syncSelectedStockToTiendaNube);
router.post('/tiendanube/import-product', integrations_controller_1.importProductFromTiendaNube);
router.post('/tiendanube/normalize-sizes', integrations_controller_1.normalizeSizesInTiendaNube);
router.post('/tiendanube/webhook', integrations_controller_1.handleTiendaNubeWebhook);
/** Probar descuento de stock por una orden TN: POST { "orderId": "123" } o GET ?orderId=123 (requiere login) */
router.post('/tiendanube/test-order', auth_1.authMiddleware, integrations_controller_1.testTiendaNubeOrder);
router.get('/tiendanube/test-order', auth_1.authMiddleware, integrations_controller_1.testTiendaNubeOrder);
/** Descontar stock de ventas TN desde una fecha (ej. fromDate=2026-03-09). Idempotente. */
router.post('/tiendanube/sync-orders-from-date', auth_1.authMiddleware, integrations_controller_1.syncTiendaNubeOrdersFromDate);
router.get('/tiendanube/sync-orders-from-date', auth_1.authMiddleware, integrations_controller_1.syncTiendaNubeOrdersFromDate);
router.post('/tiendanube/invoice-bulk', auth_1.authMiddleware, integrations_controller_1.invoiceTiendaNubeOrdersBulk);
router.get('/invoices/external', auth_1.authMiddleware, integrations_controller_1.getExternalInvoicesHistory);
router.post('/invoices/external/:id/credit-note', auth_1.authMiddleware, integrations_controller_1.emitirNotaCreditoExternalInvoice);
router.delete('/:platform/disconnect', integrations_controller_1.disconnectIntegration);
exports.default = router;
