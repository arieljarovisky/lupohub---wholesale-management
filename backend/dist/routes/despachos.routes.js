"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const despachos_controller_1 = require("../controllers/despachos.controller");
const router = (0, express_1.Router)();
// Estadísticas
router.get('/stats', despachos_controller_1.getDespachoStats);
// Productos sin despacho
router.get('/productos-sin-despacho', despachos_controller_1.getProductosSinDespacho);
// CRUD de despachos
router.get('/', despachos_controller_1.getDespachos);
router.get('/:id', despachos_controller_1.getDespachoById);
router.post('/', despachos_controller_1.createDespacho);
router.put('/:id', despachos_controller_1.updateDespacho);
router.delete('/:id', despachos_controller_1.deleteDespacho);
// Items de despacho
router.post('/:id/items', despachos_controller_1.addDespachoItem);
router.delete('/:id/items/:itemId', despachos_controller_1.removeDespachoItem);
exports.default = router;
