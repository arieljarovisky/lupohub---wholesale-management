"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const integrations_controller_1 = require("../controllers/integrations.controller");
const router = (0, express_1.Router)();
router.get('/status', integrations_controller_1.getIntegrationStatus);
// Mercado Libre
router.get('/mercadolibre/auth', integrations_controller_1.getMercadoLibreAuthUrl);
router.get('/mercadolibre/callback', integrations_controller_1.handleMercadoLibreCallback);
router.get('/mercadolibre/test', integrations_controller_1.testMercadoLibreConnection);
router.get('/mercadolibre/debug', integrations_controller_1.debugMercadoLibreItem);
router.get('/mercadolibre/orders', integrations_controller_1.getMercadoLibreOrders);
router.get('/mercadolibre/stock', integrations_controller_1.getMercadoLibreStock);
router.get('/mercadolibre/auto-message', integrations_controller_1.getMLAutoMessageConfig);
router.post('/mercadolibre/auto-message', integrations_controller_1.saveMLAutoMessageConfig);
router.post('/mercadolibre/sync', integrations_controller_1.syncProductsFromMercadoLibre);
router.post('/mercadolibre/sync-stock', integrations_controller_1.syncAllStockToMercadoLibre);
router.post('/mercadolibre/import-stock', integrations_controller_1.importStockFromMercadoLibre);
router.post('/mercadolibre/webhook', integrations_controller_1.handleMercadoLibreWebhook);
// Tienda Nube
router.get('/tiendanube/auth', integrations_controller_1.getTiendaNubeAuthUrl);
router.get('/tiendanube/callback', integrations_controller_1.handleTiendaNubeCallback);
router.get('/tiendanube/orders', integrations_controller_1.getTiendaNubeOrders);
router.post('/tiendanube/sync', integrations_controller_1.syncProductsFromTiendaNube);
router.post('/tiendanube/sync-stock', integrations_controller_1.syncAllStockToTiendaNube);
router.post('/tiendanube/normalize-sizes', integrations_controller_1.normalizeSizesInTiendaNube);
router.post('/tiendanube/webhook', integrations_controller_1.handleTiendaNubeWebhook);
router.delete('/:platform/disconnect', integrations_controller_1.disconnectIntegration);
exports.default = router;
