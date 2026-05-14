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
// Eliminar snapshot inicial para poder crear uno nuevo
router.delete('/snapshot', stock_controller_1.deleteStockSnapshot);
// Importar historial de ventas de TN y ML
router.post('/import-history', stock_controller_1.importSalesHistory);
// Importar stock desde Excel (CODIGO, COLOR, columnas P, M, G, GG, XG, XXG, XXXG)
router.post('/import-excel', auth_1.authMiddleware, stock_controller_1.importStockFromExcel);
// Planilla CODIGO + COLOR + talles dinámicos → stock + ítems del despacho
router.post('/import-grid-to-despacho', auth_1.authMiddleware, stock_controller_1.importStockGridToDespacho);
exports.default = router;
