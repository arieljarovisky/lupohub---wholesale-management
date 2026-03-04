"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const stock_controller_1 = require("../controllers/stock.controller");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// Historial de movimientos de stock
router.get('/movements', stock_controller_1.getStockMovements);
// Ajuste manual de stock (Admin o Depósito) — requiere auth
router.put('/variant/:variantId', auth_1.authMiddleware, stock_controller_1.updateVariantStockEndpoint);
// Forzar sincronización de una variante a TN y ML
router.post('/sync/:variantId', stock_controller_1.forceSyncStock);
// Crear snapshot inicial del stock actual
router.post('/snapshot', stock_controller_1.createStockSnapshot);
// Importar historial de ventas de TN y ML
router.post('/import-history', stock_controller_1.importSalesHistory);
exports.default = router;
