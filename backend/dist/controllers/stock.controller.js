"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.importSalesHistory = exports.createStockSnapshot = exports.updateVariantStockEndpoint = exports.forceSyncStock = exports.getStockMovements = exports.updateMercadoLibreStockByVariant = exports.updateTiendaNubeStock = exports.syncStockToExternalPlatforms = exports.restoreStockForOrder = exports.deductStockForOrder = exports.updateVariantStock = exports.logStockMovement = void 0;
const db_1 = require("../database/db");
const axios_1 = __importDefault(require("axios"));
const integrations_controller_1 = require("./integrations.controller");
// Registrar movimiento de stock en historial
const logStockMovement = (variantId, previousStock, newStock, movementType, reference) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield (0, db_1.execute)(`INSERT INTO stock_movements (id, variant_id, previous_stock, new_stock, quantity_change, movement_type, reference, created_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, NOW())`, [variantId, previousStock, newStock, newStock - previousStock, movementType, reference || null]);
    }
    catch (error) {
        console.error('Error logging stock movement:', error);
    }
});
exports.logStockMovement = logStockMovement;
// Actualizar stock de una variante
const updateVariantStock = (variantId_1, newStock_1, movementType_1, reference_1, ...args_1) => __awaiter(void 0, [variantId_1, newStock_1, movementType_1, reference_1, ...args_1], void 0, function* (variantId, newStock, movementType, reference, syncExternal = true) {
    try {
        const currentStockRow = yield (0, db_1.get)(`SELECT stock FROM stocks WHERE variant_id = ?`, [variantId]);
        const previousStock = (currentStockRow === null || currentStockRow === void 0 ? void 0 : currentStockRow.stock) || 0;
        yield (0, db_1.execute)(`INSERT INTO stocks (variant_id, stock) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE stock = ?`, [variantId, newStock, newStock]);
        yield (0, exports.logStockMovement)(variantId, previousStock, newStock, movementType, reference);
        if (syncExternal) {
            yield (0, exports.syncStockToExternalPlatforms)(variantId, newStock);
        }
        return true;
    }
    catch (error) {
        console.error('Error updating variant stock:', error);
        return false;
    }
});
exports.updateVariantStock = updateVariantStock;
// Descontar stock por pedido mayorista
const deductStockForOrder = (orderId) => __awaiter(void 0, void 0, void 0, function* () {
    const errors = [];
    try {
        const items = yield (0, db_1.query)(`SELECT oi.variant_id, oi.quantity, pv.sku, s.stock as current_stock
       FROM order_items oi
       JOIN product_variants pv ON pv.id = oi.variant_id
       LEFT JOIN stocks s ON s.variant_id = oi.variant_id
       WHERE oi.order_id = ?`, [orderId]);
        for (const item of items) {
            const currentStock = item.current_stock || 0;
            const newStock = Math.max(0, currentStock - item.quantity);
            const success = yield (0, exports.updateVariantStock)(item.variant_id, newStock, 'PEDIDO_MAYORISTA', `Pedido: ${orderId}`);
            if (!success) {
                errors.push(`Error actualizando stock para variante ${item.sku || item.variant_id}`);
            }
        }
        return { success: errors.length === 0, errors };
    }
    catch (error) {
        console.error('Error deducting stock for order:', error);
        return { success: false, errors: [error.message] };
    }
});
exports.deductStockForOrder = deductStockForOrder;
// Restaurar stock cuando se cancela un pedido
const restoreStockForOrder = (orderId) => __awaiter(void 0, void 0, void 0, function* () {
    const errors = [];
    try {
        const items = yield (0, db_1.query)(`SELECT oi.variant_id, oi.quantity, pv.sku, s.stock as current_stock
       FROM order_items oi
       JOIN product_variants pv ON pv.id = oi.variant_id
       LEFT JOIN stocks s ON s.variant_id = oi.variant_id
       WHERE oi.order_id = ?`, [orderId]);
        for (const item of items) {
            const currentStock = item.current_stock || 0;
            const newStock = currentStock + item.quantity;
            const success = yield (0, exports.updateVariantStock)(item.variant_id, newStock, 'DEVOLUCION', `Cancelación pedido: ${orderId}`);
            if (!success) {
                errors.push(`Error restaurando stock para variante ${item.sku || item.variant_id}`);
            }
        }
        return { success: errors.length === 0, errors };
    }
    catch (error) {
        console.error('Error restoring stock for order:', error);
        return { success: false, errors: [error.message] };
    }
});
exports.restoreStockForOrder = restoreStockForOrder;
// Aplicar pack size: stock en app es por unidad; en ML/TN puede ser por pack (ej. pack x2 → enviar stock/2).
function stockForPlatform(localStock, packSize) {
    const n = Math.max(0, Number(packSize) || 1);
    return n <= 0 ? localStock : Math.floor(localStock / n);
}
// Sincronizar stock a plataformas externas (TN y ML). Aplica pack size si el producto está en packs (x2, x3, etc.).
const syncStockToExternalPlatforms = (variantId, newStock) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const variant = yield (0, db_1.get)(`SELECT pv.id, pv.tienda_nube_variant_id, pv.mercado_libre_variant_id, 
              p.tienda_nube_id, p.mercado_libre_id, pv.sku, pv.external_sku,
              COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack,
              COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       WHERE pv.id = ?`, [variantId]);
        if (!variant)
            return;
        const stockTN = stockForPlatform(newStock, variant.tn_pack);
        const stockML = stockForPlatform(newStock, variant.ml_pack);
        const skuMLTN = variant.external_sku || variant.sku;
        // Sincronizar con Tienda Nube
        if (variant.tienda_nube_id && variant.tienda_nube_variant_id) {
            yield (0, exports.updateTiendaNubeStock)(variant.tienda_nube_id, variant.tienda_nube_variant_id, stockTN);
        }
        // Sincronizar con Mercado Libre (SKU externo = mismo que TN)
        if (variant.mercado_libre_id && variant.mercado_libre_variant_id) {
            yield (0, exports.updateMercadoLibreStockByVariant)(variant.mercado_libre_id, variant.mercado_libre_variant_id, stockML);
        }
        else if (skuMLTN) {
            yield (0, integrations_controller_1.updateMercadoLibreStock)(skuMLTN, stockML);
        }
    }
    catch (error) {
        console.error('Error syncing stock to external platforms:', error);
    }
});
exports.syncStockToExternalPlatforms = syncStockToExternalPlatforms;
// Actualizar stock en Tienda Nube
const updateTiendaNubeStock = (productId, variantId, stock) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const integration = yield (0, db_1.get)(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);
        if (!(integration === null || integration === void 0 ? void 0 : integration.access_token) || !(integration === null || integration === void 0 ? void 0 : integration.store_id)) {
            console.log('[TN Stock] No hay integración configurada');
            return false;
        }
        const response = yield axios_1.default.put(`https://api.tiendanube.com/v1/${integration.store_id}/products/${productId}/variants/${variantId}`, { stock }, {
            headers: {
                'Authentication': `bearer ${integration.access_token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'LupoHub (lupohub@example.com)'
            }
        });
        console.log(`[TN Stock] Actualizado producto ${productId} variante ${variantId} a ${stock} unidades`);
        return true;
    }
    catch (error) {
        console.error('[TN Stock] Error:', ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
        return false;
    }
});
exports.updateTiendaNubeStock = updateTiendaNubeStock;
// Actualizar stock en Mercado Libre por variante.
// Prueba primero PUT a la subrecurso; si ML devuelve error, usa GET item + PUT item con array variations (formato que exige la API en muchos casos).
const updateMercadoLibreStockByVariant = (itemId, variationId, stock) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const integration = yield (0, db_1.get)(`SELECT access_token FROM integrations WHERE platform = 'mercadolibre'`);
    if (!(integration === null || integration === void 0 ? void 0 : integration.access_token)) {
        console.log('[ML Stock] No hay integración configurada');
        return false;
    }
    const headers = {
        'Authorization': `Bearer ${integration.access_token}`,
        'Content-Type': 'application/json'
    };
    // 1) Intentar actualización por subrecurso (algunas cuentas lo aceptan)
    try {
        yield axios_1.default.put(`https://api.mercadolibre.com/items/${itemId}/variations/${variationId}`, { available_quantity: stock }, { headers });
        console.log(`[ML Stock] Actualizado item ${itemId} variación ${variationId} a ${stock} unidades`);
        return true;
    }
    catch (subError) {
        const status = (_a = subError.response) === null || _a === void 0 ? void 0 : _a.status;
        const data = (_b = subError.response) === null || _b === void 0 ? void 0 : _b.data;
        // Si es 400/404/405, probar método completo (GET + PUT con todas las variaciones)
        if (status === 400 || status === 404 || status === 405 || (status >= 400 && status < 500)) {
            try {
                return yield updateMercadoLibreStockByItemUpdate(itemId, variationId, stock, integration.access_token);
            }
            catch (fullError) {
                console.error('[ML Stock] Error método completo:', ((_c = fullError.response) === null || _c === void 0 ? void 0 : _c.data) || fullError.message);
                return false;
            }
        }
        console.error('[ML Stock] Error:', data || subError.message);
        return false;
    }
});
exports.updateMercadoLibreStockByVariant = updateMercadoLibreStockByVariant;
// Fallback: obtener ítem de ML, actualizar solo la variación indicada y enviar PUT con todas las variaciones (requerido por la API).
function updateMercadoLibreStockByItemUpdate(itemId, variationId, newStock, accessToken) {
    return __awaiter(this, void 0, void 0, function* () {
        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        };
        const getRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${itemId}`, { headers });
        const item = getRes.data;
        const variations = item.variations || [];
        if (variations.length === 0) {
            // Ítem sin variaciones: ML usa available_quantity a nivel ítem
            yield axios_1.default.put(`https://api.mercadolibre.com/items/${itemId}`, { available_quantity: newStock }, { headers });
            console.log(`[ML Stock] Actualizado item ${itemId} (sin variaciones) a ${newStock} unidades`);
            return true;
        }
        const variationsPayload = variations.map((v) => {
            var _a;
            const isTarget = String(v.id) === String(variationId);
            const qty = isTarget ? newStock : ((_a = v.available_quantity) !== null && _a !== void 0 ? _a : 0);
            return { id: v.id, available_quantity: Math.max(0, qty) };
        });
        yield axios_1.default.put(`https://api.mercadolibre.com/items/${itemId}`, { variations: variationsPayload }, { headers });
        console.log(`[ML Stock] Actualizado item ${itemId} variación ${variationId} a ${newStock} unidades (vía PUT item)`);
        return true;
    });
}
// Endpoint: Obtener historial de movimientos de stock
const getStockMovements = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { variantId, type, from, to, limit = '50' } = req.query;
        let whereClause = '1=1';
        const params = [];
        if (variantId) {
            whereClause += ' AND sm.variant_id = ?';
            params.push(variantId);
        }
        if (type) {
            whereClause += ' AND sm.movement_type = ?';
            params.push(type);
        }
        if (from) {
            whereClause += ' AND sm.created_at >= ?';
            params.push(from);
        }
        if (to) {
            whereClause += ' AND sm.created_at <= ?';
            params.push(to);
        }
        const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 50));
        params.push(limitNum);
        const movements = yield (0, db_1.query)(`SELECT sm.*, pv.sku, p.name as product_name
       FROM stock_movements sm
       JOIN product_variants pv ON pv.id = sm.variant_id
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       WHERE ${whereClause}
       ORDER BY sm.created_at DESC
       LIMIT ?`, params);
        res.json(movements);
    }
    catch (error) {
        console.error('Error fetching stock movements:', error);
        res.status(500).json({ message: 'Error obteniendo movimientos de stock' });
    }
});
exports.getStockMovements = getStockMovements;
// Endpoint: Forzar sincronización de stock a plataformas externas
const forceSyncStock = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { variantId } = req.params;
        const stockRow = yield (0, db_1.get)(`SELECT stock FROM stocks WHERE variant_id = ?`, [variantId]);
        if (!stockRow)
            return res.status(404).json({ message: 'Variante no encontrada' });
        yield (0, exports.syncStockToExternalPlatforms)(variantId, stockRow.stock);
        res.json({ message: 'Sincronización iniciada', variantId, stock: stockRow.stock });
    }
    catch (error) {
        console.error('Error forcing stock sync:', error);
        res.status(500).json({ message: 'Error sincronizando stock' });
    }
});
exports.forceSyncStock = forceSyncStock;
// Endpoint: Ajuste manual de stock (Admin o Depósito)
const updateVariantStockEndpoint = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { variantId } = req.params;
        const { stock } = req.body;
        const user = req.user;
        const userId = (user === null || user === void 0 ? void 0 : user.id) || 'sistema';
        if (typeof stock !== 'number' || stock < 0) {
            return res.status(400).json({ message: 'stock debe ser un número >= 0' });
        }
        const ok = yield (0, exports.updateVariantStock)(variantId, Math.floor(stock), 'AJUSTE_MANUAL', `Ajuste por usuario ${userId}`, true);
        if (!ok)
            return res.status(500).json({ message: 'Error actualizando stock' });
        res.json({ variantId, stock: Math.floor(stock) });
    }
    catch (error) {
        console.error('Error updating variant stock:', error);
        res.status(500).json({ message: 'Error actualizando stock' });
    }
});
exports.updateVariantStockEndpoint = updateVariantStockEndpoint;
// Endpoint: Crear snapshot inicial de todo el stock actual
const createStockSnapshot = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Verificar si ya existe un snapshot inicial
        const existingSnapshot = yield (0, db_1.get)(`SELECT COUNT(*) as count FROM stock_movements WHERE movement_type = 'SNAPSHOT_INICIAL'`);
        if ((existingSnapshot === null || existingSnapshot === void 0 ? void 0 : existingSnapshot.count) > 0) {
            return res.status(400).json({
                message: 'Ya existe un snapshot inicial. Elimínalo primero si querés crear uno nuevo.',
                existingCount: existingSnapshot.count
            });
        }
        // Obtener todo el stock actual
        const allStock = yield (0, db_1.query)(`
      SELECT 
        s.variant_id,
        s.stock,
        pv.sku,
        p.name as product_name
      FROM stocks s
      JOIN product_variants pv ON pv.id = s.variant_id
      JOIN product_colors pc ON pc.id = pv.product_color_id
      JOIN products p ON p.id = pc.product_id
      WHERE s.stock > 0
    `);
        let created = 0;
        for (const item of allStock) {
            yield (0, db_1.execute)(`INSERT INTO stock_movements (id, variant_id, previous_stock, new_stock, quantity_change, movement_type, reference, created_at)
         VALUES (UUID(), ?, 0, ?, ?, 'SNAPSHOT_INICIAL', ?, NOW())`, [item.variant_id, item.stock, item.stock, `Stock inicial: ${item.sku || item.product_name}`]);
            created++;
        }
        res.json({
            message: 'Snapshot inicial creado',
            variantsProcessed: created
        });
    }
    catch (error) {
        console.error('Error creating stock snapshot:', error);
        res.status(500).json({ message: 'Error creando snapshot', error: error.message });
    }
});
exports.createStockSnapshot = createStockSnapshot;
// Endpoint: Importar historial de ventas de TN y ML
const importSalesHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { days = 60 } = req.body;
        const logs = [];
        let imported = 0;
        // Calcular fecha desde
        const dateFrom = new Date();
        dateFrom.setDate(dateFrom.getDate() - days);
        const dateFromStr = dateFrom.toISOString().split('T')[0];
        logs.push(`Importando ventas de los últimos ${days} días (desde ${dateFromStr})`);
        // Importar de Tienda Nube
        const tnIntegration = yield (0, db_1.get)(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);
        if (tnIntegration === null || tnIntegration === void 0 ? void 0 : tnIntegration.access_token) {
            try {
                const axios = (yield Promise.resolve().then(() => __importStar(require('axios')))).default;
                let page = 1;
                let hasMore = true;
                while (hasMore && page <= 10) {
                    const ordersRes = yield axios.get(`https://api.tiendanube.com/v1/${tnIntegration.store_id}/orders?created_at_min=${dateFromStr}&per_page=50&page=${page}&status=paid`, {
                        headers: {
                            'Authentication': `bearer ${tnIntegration.access_token}`,
                            'User-Agent': 'LupoHub (lupohub@example.com)'
                        }
                    });
                    const orders = ordersRes.data || [];
                    if (orders.length === 0) {
                        hasMore = false;
                        break;
                    }
                    for (const order of orders) {
                        // Verificar si ya existe este movimiento
                        const exists = yield (0, db_1.get)(`SELECT id FROM stock_movements WHERE reference LIKE ? AND movement_type = 'VENTA_TIENDA_NUBE'`, [`%TN-${order.id}%`]);
                        if (exists)
                            continue;
                        for (const product of order.products || []) {
                            const tnVariantId = product.variant_id;
                            const qty = product.quantity || 1;
                            const itemSku = (product.sku || product.variant_sku || '').toString().trim();
                            let variant = yield (0, db_1.get)(`SELECT pv.id FROM product_variants pv WHERE pv.tienda_nube_variant_id = ?`, [tnVariantId]);
                            if (!(variant === null || variant === void 0 ? void 0 : variant.id) && itemSku) {
                                variant = yield (0, db_1.get)(`SELECT pv.id FROM product_variants pv WHERE COALESCE(pv.external_sku, pv.sku) = ? OR pv.sku = ?`, [itemSku, itemSku]);
                            }
                            if (!(variant === null || variant === void 0 ? void 0 : variant.id) && itemSku) {
                                variant = yield (0, db_1.get)(`SELECT pv.id FROM product_variants pv
                   JOIN product_colors pc ON pc.id = pv.product_color_id
                   JOIN products p ON p.id = pc.product_id
                   WHERE p.sku = ? OR pv.sku LIKE ? OR pv.external_sku = ? LIMIT 1`, [itemSku, `${itemSku}%`, itemSku]);
                            }
                            if (variant === null || variant === void 0 ? void 0 : variant.id) {
                                yield (0, db_1.execute)(`INSERT INTO stock_movements (id, variant_id, previous_stock, new_stock, quantity_change, movement_type, reference, created_at)
                   VALUES (UUID(), ?, 0, 0, ?, 'VENTA_TIENDA_NUBE', ?, ?)`, [variant.id, -qty, `Orden TN-${order.id} (histórico)`, order.created_at]);
                                imported++;
                            }
                        }
                    }
                    page++;
                    if (orders.length < 50)
                        hasMore = false;
                }
                logs.push(`✓ Tienda Nube: ${imported} movimientos importados`);
            }
            catch (e) {
                logs.push(`✗ Error Tienda Nube: ${e.message}`);
            }
        }
        // Importar de Mercado Libre
        const mlIntegration = yield (0, db_1.get)(`SELECT access_token, user_id FROM integrations WHERE platform = 'mercadolibre'`);
        if (mlIntegration === null || mlIntegration === void 0 ? void 0 : mlIntegration.access_token) {
            try {
                const axios = (yield Promise.resolve().then(() => __importStar(require('axios')))).default;
                let offset = 0;
                let mlImported = 0;
                while (offset < 500) {
                    const ordersRes = yield axios.get(`https://api.mercadolibre.com/orders/search?seller=${mlIntegration.user_id}&order.status=paid&order.date_created.from=${dateFromStr}T00:00:00.000-03:00&offset=${offset}&limit=50&sort=date_desc`, {
                        headers: { 'Authorization': `Bearer ${mlIntegration.access_token}` }
                    });
                    const orders = ordersRes.data.results || [];
                    if (orders.length === 0)
                        break;
                    for (const order of orders) {
                        // Verificar si ya existe
                        const exists = yield (0, db_1.get)(`SELECT id FROM stock_movements WHERE reference LIKE ? AND movement_type = 'VENTA_MERCADO_LIBRE'`, [`%ML-${order.id}%`]);
                        if (exists)
                            continue;
                        for (const item of order.order_items || []) {
                            const mlVariationId = (_a = item.item) === null || _a === void 0 ? void 0 : _a.variation_id;
                            const qty = item.quantity || 1;
                            const itemSku = (((_b = item.item) === null || _b === void 0 ? void 0 : _b.sku) || item.sku || '').toString().trim();
                            let variant = null;
                            if (mlVariationId) {
                                variant = yield (0, db_1.get)(`SELECT pv.id FROM product_variants pv WHERE pv.mercado_libre_variant_id = ?`, [mlVariationId]);
                            }
                            if (!(variant === null || variant === void 0 ? void 0 : variant.id) && itemSku) {
                                variant = yield (0, db_1.get)(`SELECT pv.id FROM product_variants pv WHERE COALESCE(pv.external_sku, pv.sku) = ? OR pv.sku = ?`, [itemSku, itemSku]);
                            }
                            if (!(variant === null || variant === void 0 ? void 0 : variant.id) && itemSku) {
                                variant = yield (0, db_1.get)(`SELECT pv.id FROM product_variants pv
                   JOIN product_colors pc ON pc.id = pv.product_color_id
                   JOIN products p ON p.id = pc.product_id
                   WHERE p.sku = ? OR pv.sku LIKE ? OR pv.external_sku = ? LIMIT 1`, [itemSku, `${itemSku}%`, itemSku]);
                            }
                            if (variant === null || variant === void 0 ? void 0 : variant.id) {
                                yield (0, db_1.execute)(`INSERT INTO stock_movements (id, variant_id, previous_stock, new_stock, quantity_change, movement_type, reference, created_at)
                   VALUES (UUID(), ?, 0, 0, ?, 'VENTA_MERCADO_LIBRE', ?, ?)`, [variant.id, -qty, `Orden ML-${order.id} (histórico)`, order.date_created]);
                                mlImported++;
                            }
                        }
                    }
                    offset += 50;
                    if (orders.length < 50)
                        break;
                }
                imported += mlImported;
                logs.push(`✓ Mercado Libre: ${mlImported} movimientos importados`);
            }
            catch (e) {
                logs.push(`✗ Error Mercado Libre: ${e.message}`);
            }
        }
        res.json({
            message: 'Importación completada',
            totalImported: imported,
            logs
        });
    }
    catch (error) {
        console.error('Error importing sales history:', error);
        res.status(500).json({ message: 'Error importando historial', error: error.message });
    }
});
exports.importSalesHistory = importSalesHistory;
