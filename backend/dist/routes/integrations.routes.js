"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const integrations_controller_1 = require("../controllers/integrations.controller");
const integrations_controller_2 = require("../controllers/integrations.controller");
const router = (0, express_1.Router)();
router.get('/status', integrations_controller_1.getIntegrationStatus);
// Mercado Libre
router.get('/mercadolibre/auth', integrations_controller_1.getMercadoLibreAuthUrl);
router.get('/mercadolibre/callback', integrations_controller_1.handleMercadoLibreCallback);
router.post('/mercadolibre/sync', integrations_controller_2.syncProductsFromMercadoLibre);
// Tienda Nube
router.get('/tiendanube/auth', integrations_controller_1.getTiendaNubeAuthUrl);
router.get('/tiendanube/callback', integrations_controller_1.handleTiendaNubeCallback);
router.post('/tiendanube/sync', integrations_controller_1.syncProductsFromTiendaNube);
router.delete('/:platform/disconnect', integrations_controller_1.disconnectIntegration);
exports.default = router;
