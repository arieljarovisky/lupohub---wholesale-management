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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
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
exports.importStockGridToDespacho = exports.importStockFromExcel = exports.resolveVariantIdForGridCell = exports.importSalesHistory = exports.createStockSnapshot = exports.deleteStockSnapshot = exports.updateVariantStockEndpoint = exports.forceSyncStock = exports.getStockMovements = exports.updateTiendaNubeSku = exports.updateMercadoLibreSku = exports.updateMercadoLibreStockByVariant = exports.updateMercadoLibreStockByItem = exports.updateTiendaNubeStock = exports.syncStockToExternalPlatforms = exports.restoreStockForOrderItem = exports.restoreStockForOrder = exports.deductStockForOrder = exports.isWholesaleStockRestoredForOrder = exports.wholesaleOrderStockCancelRestoreReference = exports.wholesaleOrderStockManualRestoreReference = exports.isMayoristaStockDeductedForWholesale = exports.wholesaleOrderStockReference = exports.updateVariantStock = exports.logStockMovement = void 0;
const db_1 = require("../database/db");
const touchProductUpdatedAt_1 = require("../utils/touchProductUpdatedAt");
const axios_1 = __importDefault(require("axios"));
const uuid_1 = require("uuid");
const integrations_controller_1 = require("./integrations.controller");
const tiendanubeClient_1 = require("../utils/tiendanubeClient");
const skuString_1 = require("../utils/skuString");
const lupoStockWebhook_service_1 = require("../services/lupoStockWebhook.service");
const talles_tango_1 = require("../talles-tango");
const colorCodeCanonical_1 = require("../utils/colorCodeCanonical");
const SYNC_DEBOUNCE_MS = 2800;
const pendingSyncByVariant = {};
/** Cancela el sync diferido de una variante (evita que un debounce viejo pise un ajuste manual recién hecho). */
function flushPendingExternalSync(variantId) {
    const prev = pendingSyncByVariant[variantId];
    if (prev) {
        clearTimeout(prev.timeout);
        delete pendingSyncByVariant[variantId];
    }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
/** Normaliza IDs de publicación ML y genera candidatos tolerantes (ej: MLAU123 -> MLA123 / MLU123). */
function mlNormalizeItemId(raw) {
    let s = (raw !== null && raw !== void 0 ? raw : '').toString().trim();
    if (!s)
        return '';
    try {
        s = decodeURIComponent(s);
    }
    catch (_a) { }
    s = s.replace(/\s+/g, '').toUpperCase();
    if (/^https?:\/\//i.test(s)) {
        const m = s.match(/\/(ML[A-Z]{0,5}-?\d+)(?:[/?#]|$)/i);
        if (m === null || m === void 0 ? void 0 : m[1])
            s = m[1].toUpperCase();
    }
    const mDash = s.match(/^(ML[A-Z]{0,5})-(\d+)$/);
    if (mDash)
        s = `${mDash[1]}${mDash[2]}`;
    const legacy = s.match(/^ML-(\d+)$/);
    if (legacy)
        s = `MLA${legacy[1]}`;
    return s;
}
function mlItemIdCandidates(raw) {
    const base = mlNormalizeItemId(raw);
    if (!base)
        return [];
    if (/^\d+$/.test(base)) {
        const sites = ['MLU', 'MLA', 'MLB', 'MLM', 'MCO', 'MLC', 'MPE', 'MEC', 'MLV'];
        return sites.map((site) => `${site}${base}`);
    }
    const out = [base];
    const m = base.match(/^(ML[A-Z]{2,6})(\d+)$/);
    if (m) {
        const prefix = m[1];
        const num = m[2];
        if (prefix.length > 3)
            out.push(`${prefix.slice(0, 3)}${num}`);
        if (prefix.length > 3)
            out.push(`ML${prefix[prefix.length - 1]}${num}`);
        if (prefix === 'MLAU')
            out.push(`MLA${num}`);
    }
    return Array.from(new Set(out.filter(Boolean)));
}
function resolveMlUserProductItemCandidates(rawUserProductId, headers) {
    var _a, _b, _c, _d;
    return __awaiter(this, void 0, void 0, function* () {
        const up = mlNormalizeItemId(rawUserProductId);
        if (!/^MLAU\d+$/i.test(up))
            return [];
        try {
            const meRes = yield axios_1.default.get('https://api.mercadolibre.com/users/me', {
                headers,
                validateStatus: () => true
            });
            const sellerId = meRes.status === 200 ? ((_b = (_a = meRes.data) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : (_c = meRes.data) === null || _c === void 0 ? void 0 : _c.user_id) : null;
            if (!sellerId)
                return [];
            const allIds = [];
            const seen = new Set();
            const statuses = ['active', 'paused', 'closed'];
            const pageLimit = 100;
            for (const st of statuses) {
                let offset = 0;
                while (offset < 5000) {
                    const res = yield axios_1.default.get(`https://api.mercadolibre.com/users/${encodeURIComponent(String(sellerId))}/items/search`, {
                        headers,
                        params: { user_product_id: up, status: st, limit: pageLimit, offset },
                        validateStatus: () => true
                    });
                    if (res.status >= 400 || !res.data)
                        break;
                    const rows = Array.isArray((_d = res.data) === null || _d === void 0 ? void 0 : _d.results) ? res.data.results : [];
                    for (const x of rows) {
                        const id = String(x || '').trim();
                        if (!id || seen.has(id))
                            continue;
                        seen.add(id);
                        allIds.push(id);
                    }
                    if (rows.length < pageLimit)
                        break;
                    offset += pageLimit;
                }
            }
            return Array.from(new Set(allIds.flatMap((id) => mlItemIdCandidates(id))));
        }
        catch (_e) {
            return [];
        }
    });
}
function resolveReachableMlItemId(rawItemId, headers, expectedVariationId) {
    return __awaiter(this, void 0, void 0, function* () {
        const tryCandidates = (candidates) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            for (const c of candidates) {
                try {
                    const r = yield axios_1.default.get(`https://api.mercadolibre.com/items/${encodeURIComponent(c)}`, {
                        headers,
                        validateStatus: () => true
                    });
                    if (r.status !== 200 || !r.data || r.data.error)
                        continue;
                    if (expectedVariationId) {
                        const variations = Array.isArray((_a = r.data) === null || _a === void 0 ? void 0 : _a.variations) ? r.data.variations : [];
                        if (variations.length > 0 && !variations.some((v) => String(v === null || v === void 0 ? void 0 : v.id) === String(expectedVariationId))) {
                            continue;
                        }
                    }
                    return c;
                }
                catch (_b) {
                    // probar siguiente candidato
                }
            }
            return null;
        });
        const direct = yield tryCandidates(mlItemIdCandidates(rawItemId));
        if (direct)
            return direct;
        const upCandidates = yield resolveMlUserProductItemCandidates(rawItemId, headers);
        if (upCandidates.length > 0) {
            const fromUp = yield tryCandidates(upCandidates);
            if (fromUp)
                return fromUp;
        }
        return null;
    });
}
function withRetry429409(fn, retries = 2) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        try {
            return yield fn();
        }
        catch (e) {
            const status = (_a = e.response) === null || _a === void 0 ? void 0 : _a.status;
            if (retries > 0 && (status === 429 || status === 409)) {
                const delayMs = status === 429 ? 2500 : 1200;
                yield sleep(delayMs);
                return withRetry429409(fn, retries - 1);
            }
            throw e;
        }
    });
}
// Registrar movimiento de stock en historial
const logStockMovement = (variantId, previousStock, newStock, movementType, reference) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield (0, db_1.execute)(`INSERT INTO stock_movements (id, variant_id, previous_stock, new_stock, quantity_change, movement_type, reference, created_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, NOW())`, [variantId, previousStock, newStock, newStock - previousStock, movementType, reference || null]);
    }
    catch (error) {
        console.error('Error logging stock movement:', error);
        throw error;
    }
});
exports.logStockMovement = logStockMovement;
// Actualizar stock de una variante
const updateVariantStock = (variantId, newStock, movementType, reference, syncExternal = true) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const currentStockRow = yield (0, db_1.get)(`SELECT stock FROM stocks WHERE variant_id = ?`, [variantId]);
        const previousStock = (currentStockRow === null || currentStockRow === void 0 ? void 0 : currentStockRow.stock) || 0;
        yield (0, db_1.execute)(`INSERT INTO stocks (variant_id, stock) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE stock = ?`, [variantId, newStock, newStock]);
        yield (0, exports.logStockMovement)(variantId, previousStock, newStock, movementType, reference);
        yield (0, touchProductUpdatedAt_1.touchProductUpdatedAtByVariantId)(variantId);
        if (syncExternal) {
            // Ajuste desde inventario: sin debounce de 2,8s (TN parecía no actualizar hasta el 2º cambio).
            // Pedidos/importaciones masivas siguen con debounce para no saturar APIs.
            if (movementType === 'AJUSTE_MANUAL') {
                flushPendingExternalSync(variantId);
                const toSync = newStock;
                void (0, exports.syncStockToExternalPlatforms)(variantId, toSync).catch(err => console.error('[Sync AJUSTE_MANUAL] Error:', (err === null || err === void 0 ? void 0 : err.message) || err));
            }
            else {
                scheduleSyncToExternalPlatforms(variantId, newStock);
            }
        }
        void Promise.resolve().then(() => __importStar(require('../services/publicationStockBundle.service'))).then((m) => m.syncBundlesContainingVariant(variantId))
            .catch((err) => console.warn('[Bundle sync]', (err === null || err === void 0 ? void 0 : err.message) || err));
        return true;
    }
    catch (error) {
        console.error('Error updating variant stock:', error);
        return false;
    }
});
exports.updateVariantStock = updateVariantStock;
// Unidades a descontar por ítem: si sell_as_pack=1, quantity está en packs → multiplicar por mayorista_pack_size
function unitsToDeductForOrderItem(quantity, sellAsPack, mayoristaPackSize) {
    const packSize = Math.max(1, Number(mayoristaPackSize) || 1);
    return sellAsPack ? quantity * packSize : quantity;
}
/** Texto de referencia en `stock_movements` para el descuento de un pedido mayorista. */
const wholesaleOrderStockReference = (orderId) => `Pedido: ${orderId}`;
exports.wholesaleOrderStockReference = wholesaleOrderStockReference;
/** Indica si ya se registró al menos un movimiento PEDIDO_MAYORISTA para este pedido (idempotencia). */
const isMayoristaStockDeductedForWholesale = (orderId) => __awaiter(void 0, void 0, void 0, function* () {
    const ref = (0, exports.wholesaleOrderStockReference)(orderId);
    const row = yield (0, db_1.get)(`SELECT 1 AS ok FROM stock_movements WHERE movement_type = 'PEDIDO_MAYORISTA' AND reference = ? LIMIT 1`, [ref]);
    return !!row;
});
exports.isMayoristaStockDeductedForWholesale = isMayoristaStockDeductedForWholesale;
/** Referencia DEVOLUCION al restaurar stock sin cancelar el pedido. */
const wholesaleOrderStockManualRestoreReference = (orderId) => `Restauración pedido: ${orderId}`;
exports.wholesaleOrderStockManualRestoreReference = wholesaleOrderStockManualRestoreReference;
/** Referencia DEVOLUCION al cancelar/eliminar pedido. */
const wholesaleOrderStockCancelRestoreReference = (orderId) => `Cancelación pedido: ${orderId}`;
exports.wholesaleOrderStockCancelRestoreReference = wholesaleOrderStockCancelRestoreReference;
/** True si el stock de este pedido ya fue devuelto al inventario (manual o por cancelación). */
const isWholesaleStockRestoredForOrder = (orderId) => __awaiter(void 0, void 0, void 0, function* () {
    const refs = [
        (0, exports.wholesaleOrderStockManualRestoreReference)(orderId),
        (0, exports.wholesaleOrderStockCancelRestoreReference)(orderId),
    ];
    const row = yield (0, db_1.get)(`SELECT 1 AS ok FROM stock_movements
     WHERE movement_type = 'DEVOLUCION' AND reference IN (?, ?) LIMIT 1`, refs);
    return !!row;
});
exports.isWholesaleStockRestoredForOrder = isWholesaleStockRestoredForOrder;
// Descontar stock por pedido mayorista
const deductStockForOrder = (orderId) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const errors = [];
    try {
        const meta = yield (0, db_1.get)(`SELECT COALESCE(no_stock_impact, 0) AS no_stock_impact, status FROM orders WHERE id = ?`, [orderId]);
        const usePicked = !Number(meta === null || meta === void 0 ? void 0 : meta.no_stock_impact) &&
            ['Falta controlar', 'Controlado', 'Despachado'].includes(String((meta === null || meta === void 0 ? void 0 : meta.status) || ''));
        const items = yield (0, db_1.query)(`SELECT oi.variant_id, oi.quantity, COALESCE(oi.picked, 0) AS picked, COALESCE(oi.sell_as_pack, 0) AS sell_as_pack, pv.sku,
              COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS mayorista_pack_size,
              s.stock AS current_stock
       FROM order_items oi
       JOIN product_variants pv ON pv.id = oi.variant_id
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       LEFT JOIN stocks s ON s.variant_id = oi.variant_id
       WHERE oi.order_id = ?`, [orderId]);
        const unitsByVariant = new Map();
        for (const item of items) {
            const rawQ = Math.max(0, Math.floor(Number(item.quantity) || 0));
            const p = Math.max(0, Math.floor(Number(item.picked) || 0));
            const baseQty = usePicked ? Math.min(rawQ, p) : rawQ;
            const units = unitsToDeductForOrderItem(baseQty, item.sell_as_pack, item.mayorista_pack_size);
            const vid = item.variant_id;
            const prev = unitsByVariant.get(vid);
            if (prev)
                prev.units += units;
            else
                unitsByVariant.set(vid, { units, sku: item.sku || vid });
        }
        for (const [variantId, { units, sku }] of unitsByVariant) {
            const stockRow = yield (0, db_1.get)(`SELECT stock FROM stocks WHERE variant_id = ?`, [variantId]);
            const currentStock = (_a = stockRow === null || stockRow === void 0 ? void 0 : stockRow.stock) !== null && _a !== void 0 ? _a : 0;
            const newStock = Math.max(0, Number(currentStock) - units);
            const success = yield (0, exports.updateVariantStock)(variantId, newStock, 'PEDIDO_MAYORISTA', `Pedido: ${orderId}`);
            if (!success) {
                errors.push(`Error actualizando stock para variante ${sku || variantId}`);
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
// Restaurar stock de un pedido mayorista (cancelación, NC o restauración manual).
const restoreStockForOrder = (orderId, referenceNote) => __awaiter(void 0, void 0, void 0, function* () {
    var _b;
    const devolucionRef = (referenceNote === null || referenceNote === void 0 ? void 0 : referenceNote.trim()) || (0, exports.wholesaleOrderStockCancelRestoreReference)(orderId);
    const errors = [];
    try {
        const meta = yield (0, db_1.get)(`SELECT COALESCE(no_stock_impact, 0) AS no_stock_impact, status FROM orders WHERE id = ?`, [orderId]);
        const usePicked = !Number(meta === null || meta === void 0 ? void 0 : meta.no_stock_impact) &&
            ['Falta controlar', 'Controlado', 'Despachado'].includes(String((meta === null || meta === void 0 ? void 0 : meta.status) || ''));
        const items = yield (0, db_1.query)(`SELECT oi.variant_id, oi.quantity, COALESCE(oi.picked, 0) AS picked, COALESCE(oi.sell_as_pack, 0) AS sell_as_pack, pv.sku,
              COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS mayorista_pack_size,
              s.stock AS current_stock
       FROM order_items oi
       JOIN product_variants pv ON pv.id = oi.variant_id
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       LEFT JOIN stocks s ON s.variant_id = oi.variant_id
       WHERE oi.order_id = ?`, [orderId]);
        const unitsByVariant = new Map();
        for (const item of items) {
            const rawQ = Math.max(0, Math.floor(Number(item.quantity) || 0));
            const p = Math.max(0, Math.floor(Number(item.picked) || 0));
            const baseQty = usePicked ? Math.min(rawQ, p) : rawQ;
            const units = unitsToDeductForOrderItem(baseQty, item.sell_as_pack, item.mayorista_pack_size);
            const vid = item.variant_id;
            const prev = unitsByVariant.get(vid);
            if (prev)
                prev.units += units;
            else
                unitsByVariant.set(vid, { units, sku: item.sku || vid });
        }
        for (const [variantId, { units, sku }] of unitsByVariant) {
            const stockRow = yield (0, db_1.get)(`SELECT stock FROM stocks WHERE variant_id = ?`, [variantId]);
            const currentStock = (_b = stockRow === null || stockRow === void 0 ? void 0 : stockRow.stock) !== null && _b !== void 0 ? _b : 0;
            const newStock = Number(currentStock) + units;
            const success = yield (0, exports.updateVariantStock)(variantId, newStock, 'DEVOLUCION', devolucionRef);
            if (!success) {
                errors.push(`Error restaurando stock para variante ${sku || variantId}`);
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
// Restaurar stock para un item particular del pedido (NC parcial)
const restoreStockForOrderItem = (orderId, itemIndex, quantity) => __awaiter(void 0, void 0, void 0, function* () {
    const errors = [];
    try {
        const items = yield (0, db_1.query)(`SELECT oi.variant_id, oi.quantity, COALESCE(oi.sell_as_pack, 0) AS sell_as_pack, pv.sku,
              COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS mayorista_pack_size,
              s.stock AS current_stock
       FROM order_items oi
       JOIN product_variants pv ON pv.id = oi.variant_id
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       LEFT JOIN stocks s ON s.variant_id = oi.variant_id
       WHERE oi.order_id = ?
       ORDER BY oi.id`, [orderId]);
        if (!items || items.length === 0) {
            return { success: false, errors: ['No hay ítems para este pedido.'] };
        }
        if (itemIndex < 0 || itemIndex >= items.length) {
            return { success: false, errors: ['itemIndex inválido para este pedido.'] };
        }
        const item = items[itemIndex];
        const qty = quantity != null ? quantity : Number(item.quantity || 0);
        if (isNaN(qty) || qty <= 0 || qty > Number(item.quantity || 0)) {
            return { success: false, errors: [`quantity inválida. Debe ser 1..${item.quantity}`] };
        }
        const units = unitsToDeductForOrderItem(qty, item.sell_as_pack, item.mayorista_pack_size);
        const currentStock = Number(item.current_stock || 0);
        const newStock = currentStock + units;
        const success = yield (0, exports.updateVariantStock)(item.variant_id, newStock, 'DEVOLUCION', `Nota de crédito pedido: ${orderId}`);
        if (!success) {
            errors.push(`Error restaurando stock para variante ${item.sku || item.variant_id}`);
        }
        return { success: errors.length === 0, errors };
    }
    catch (error) {
        console.error('Error restoring stock for order item:', error);
        return { success: false, errors: [error.message] };
    }
});
exports.restoreStockForOrderItem = restoreStockForOrderItem;
// Aplicar pack size: stock en app es por unidad; en ML/TN puede ser por pack (ej. pack x2 → enviar stock/2).
function stockForPlatform(localStock, packSize) {
    const n = Math.max(0, Number(packSize) || 1);
    return n <= 0 ? localStock : Math.floor(localStock / n);
}
// Programar sincronización con debounce para evitar demasiadas llamadas a ML/TN (429 / conflict).
function scheduleSyncToExternalPlatforms(variantId, newStock) {
    const prev = pendingSyncByVariant[variantId];
    if (prev)
        clearTimeout(prev.timeout);
    pendingSyncByVariant[variantId] = {
        stock: newStock,
        timeout: setTimeout(() => {
            var _a;
            const entry = pendingSyncByVariant[variantId];
            const stockToSync = (_a = entry === null || entry === void 0 ? void 0 : entry.stock) !== null && _a !== void 0 ? _a : newStock;
            delete pendingSyncByVariant[variantId];
            (0, exports.syncStockToExternalPlatforms)(variantId, stockToSync).catch(err => console.error('[Sync debounced] Error:', (err === null || err === void 0 ? void 0 : err.message) || err));
        }, SYNC_DEBOUNCE_MS)
    };
}
function runExternalSyncWithRetries(label, run, attempts = 3) {
    return __awaiter(this, void 0, void 0, function* () {
        let lastOk = false;
        for (let i = 1; i <= attempts; i++) {
            try {
                lastOk = yield run();
                if (lastOk)
                    return true;
            }
            catch (error) {
                console.warn(`[Sync] ${label} intento ${i}/${attempts} con excepción:`, (error === null || error === void 0 ? void 0 : error.message) || error);
            }
            if (i < attempts)
                yield sleep(1200 * i);
        }
        console.warn(`[Sync] ${label} no se pudo sincronizar tras ${attempts} intentos.`);
        return false;
    });
}
// Sincronizar stock a todas las publicaciones vinculadas (variant_publications). Si no hay ninguna, fallback a columnas legacy.
const syncStockToExternalPlatforms = (variantId, newStock) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const publications = yield (0, db_1.query)(`SELECT id, platform, external_product_id, external_variant_id, pack_size FROM variant_publications WHERE variant_id = ?`, [variantId]);
        if (publications && publications.length > 0) {
            const tasks = [];
            for (const pub of publications) {
                const pack = Math.max(1, Number(pub.pack_size) || 1);
                const stockToSend = stockForPlatform(newStock, pack);
                if (pub.platform === 'tiendanube' && pub.external_variant_id) {
                    const label = `TN pub=${pub.external_product_id}/${pub.external_variant_id} variant=${variantId}`;
                    tasks.push(runExternalSyncWithRetries(label, () => (0, exports.updateTiendaNubeStock)(pub.external_product_id, pub.external_variant_id, stockToSend)));
                }
                else if (pub.platform === 'mercadolibre') {
                    const itemId = pub.external_product_id;
                    const variationId = (pub.external_variant_id && String(pub.external_variant_id).trim()) || null;
                    if (variationId) {
                        const label = `ML item=${itemId} var=${variationId} variant=${variantId}`;
                        tasks.push(runExternalSyncWithRetries(label, () => (0, exports.updateMercadoLibreStockByVariant)(itemId, variationId, stockToSend)));
                    }
                    else {
                        const label = `ML item=${itemId} variant=${variantId}`;
                        tasks.push(runExternalSyncWithRetries(label, () => (0, exports.updateMercadoLibreStockByItem)(itemId, stockToSend)));
                    }
                }
            }
            // Paralelo: ML y TN reciben el mismo stock casi a la vez (menos “ML ya actualizó y TN no”).
            yield Promise.all(tasks);
        }
        else {
            // Fallback: enlaces legacy en product_variants + products
            const variant = yield (0, db_1.get)(`SELECT pv.id, pv.tienda_nube_variant_id, pv.mercado_libre_variant_id, pv.mercado_libre_item_id,
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
            if (variant.tienda_nube_id && variant.tienda_nube_variant_id) {
                yield runExternalSyncWithRetries(`TN legacy=${variant.tienda_nube_id}/${variant.tienda_nube_variant_id} variant=${variantId}`, () => (0, exports.updateTiendaNubeStock)(variant.tienda_nube_id, variant.tienda_nube_variant_id, stockTN));
            }
            // Publicación propia por variante (mercado_libre_item_id) tiene prioridad sobre el ítem
            // padre del producto (mercado_libre_id). Si no, una variante puede poner stock en 6 y otra
            // pisarlo a 0 usando el mismo MLA vía variación del catálogo padre.
            const ownMlItemId = variant.mercado_libre_item_id != null && String(variant.mercado_libre_item_id).trim() !== ''
                ? String(variant.mercado_libre_item_id).trim()
                : null;
            const ownMlVarId = variant.mercado_libre_variant_id != null && String(variant.mercado_libre_variant_id).trim() !== ''
                ? String(variant.mercado_libre_variant_id).trim()
                : null;
            if (ownMlItemId) {
                if (ownMlVarId) {
                    yield runExternalSyncWithRetries(`ML legacy item=${ownMlItemId} var=${ownMlVarId} variant=${variantId}`, () => (0, exports.updateMercadoLibreStockByVariant)(ownMlItemId, ownMlVarId, stockML));
                }
                else {
                    yield runExternalSyncWithRetries(`ML legacy item=${ownMlItemId} variant=${variantId}`, () => (0, exports.updateMercadoLibreStockByItem)(ownMlItemId, stockML));
                }
            }
            else if (variant.mercado_libre_id && ownMlVarId) {
                yield runExternalSyncWithRetries(`ML legacy=${variant.mercado_libre_id}/${ownMlVarId} variant=${variantId}`, () => (0, exports.updateMercadoLibreStockByVariant)(variant.mercado_libre_id, ownMlVarId, stockML));
            }
            else if (skuMLTN) {
                yield runExternalSyncWithRetries(`ML legacy sku=${skuMLTN} variant=${variantId}`, () => __awaiter(void 0, void 0, void 0, function* () {
                    yield (0, integrations_controller_1.updateMercadoLibreStock)(skuMLTN, stockML);
                    return true;
                }));
            }
        }
    }
    catch (error) {
        console.error('Error syncing stock to external platforms:', error);
    }
    finally {
        // Lupo shop: siempre encolar evento firmado por variante (si hay config).
        yield (0, lupoStockWebhook_service_1.enqueueStockWebhookForVariant)(variantId, newStock);
    }
});
exports.syncStockToExternalPlatforms = syncStockToExternalPlatforms;
// Actualizar stock en Tienda Nube
const updateTiendaNubeStock = (productId, variantId, stock) => __awaiter(void 0, void 0, void 0, function* () {
    var _c;
    try {
        const integration = yield (0, db_1.get)(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);
        if (!(integration === null || integration === void 0 ? void 0 : integration.access_token) || !(integration === null || integration === void 0 ? void 0 : integration.store_id)) {
            console.log('[TN Stock] No hay integración configurada');
            return false;
        }
        yield (0, tiendanubeClient_1.tnPutWithRetry)(axios_1.default, `https://api.tiendanube.com/v1/${integration.store_id}/products/${productId}/variants/${variantId}`, { stock }, {
            headers: {
                'Authentication': `bearer ${integration.access_token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'LupoHub (lupohub@example.com)'
            }
        }, { maxRetries: 4 });
        console.log(`[TN Stock] Actualizado producto ${productId} variante ${variantId} a ${stock} unidades`);
        return true;
    }
    catch (error) {
        console.error('[TN Stock] Error:', ((_c = error.response) === null || _c === void 0 ? void 0 : _c.data) || error.message);
        return false;
    }
});
exports.updateTiendaNubeStock = updateTiendaNubeStock;
// Actualizar stock en Mercado Libre cuando la variante tiene su propia publicación (ítem sin variaciones o con una sola).
const updateMercadoLibreStockByItem = (itemId, stock) => __awaiter(void 0, void 0, void 0, function* () {
    var _d;
    const integration = yield (0, db_1.get)(`SELECT access_token FROM integrations WHERE platform = 'mercadolibre'`);
    if (!(integration === null || integration === void 0 ? void 0 : integration.access_token)) {
        console.log('[ML Stock] No hay integración configurada');
        return false;
    }
    const headers = {
        'Authorization': `Bearer ${integration.access_token}`,
        'Content-Type': 'application/json'
    };
    try {
        const resolvedItemId = yield resolveReachableMlItemId(itemId, headers);
        if (!resolvedItemId) {
            console.warn(`[ML Stock] No se pudo resolver itemId válido desde "${itemId}"`);
            return false;
        }
        const getRes = yield withRetry429409(() => axios_1.default.get(`https://api.mercadolibre.com/items/${resolvedItemId}`, { headers }));
        const item = getRes.data;
        const variations = item.variations || [];
        if (variations.length === 0) {
            yield withRetry429409(() => axios_1.default.put(`https://api.mercadolibre.com/items/${resolvedItemId}`, { available_quantity: stock }, { headers }));
            console.log(`[ML Stock] Actualizado publicación única ${resolvedItemId} a ${stock} unidades`);
            return true;
        }
        if (variations.length === 1) {
            yield withRetry429409(() => axios_1.default.put(`https://api.mercadolibre.com/items/${resolvedItemId}`, { variations: [{ id: variations[0].id, available_quantity: stock }] }, { headers }));
            console.log(`[ML Stock] Actualizado publicación única (1 variación) ${resolvedItemId} a ${stock} unidades`);
            return true;
        }
        console.log(`[ML Stock] Item ${resolvedItemId} tiene ${variations.length} variaciones; usar publicación con variaciones en su lugar`);
        return false;
    }
    catch (e) {
        console.error(`[ML Stock] Error actualizando publicación única ${itemId}:`, ((_d = e.response) === null || _d === void 0 ? void 0 : _d.data) || e.message);
        return false;
    }
});
exports.updateMercadoLibreStockByItem = updateMercadoLibreStockByItem;
// Actualizar stock en Mercado Libre por variante.
// Prueba primero PUT a la subrecurso; si ML devuelve error, usa GET item + PUT item con array variations (formato que exige la API en muchos casos).
const updateMercadoLibreStockByVariant = (itemId, variationId, stock) => __awaiter(void 0, void 0, void 0, function* () {
    var _e, _f, _g;
    const integration = yield (0, db_1.get)(`SELECT access_token FROM integrations WHERE platform = 'mercadolibre'`);
    if (!(integration === null || integration === void 0 ? void 0 : integration.access_token)) {
        console.log('[ML Stock] No hay integración configurada');
        return false;
    }
    const headers = {
        'Authorization': `Bearer ${integration.access_token}`,
        'Content-Type': 'application/json'
    };
    const resolvedItemId = yield resolveReachableMlItemId(itemId, headers, variationId);
    if (!resolvedItemId) {
        console.warn(`[ML Stock] No se pudo resolver itemId válido desde "${itemId}" (variación ${variationId})`);
        return false;
    }
    // 1) Intentar actualización por subrecurso (algunas cuentas lo aceptan)
    try {
        yield withRetry429409(() => axios_1.default.put(`https://api.mercadolibre.com/items/${resolvedItemId}/variations/${variationId}`, { available_quantity: stock }, { headers }));
        console.log(`[ML Stock] Actualizado item ${resolvedItemId} variación ${variationId} a ${stock} unidades`);
        return true;
    }
    catch (subError) {
        const status = (_e = subError.response) === null || _e === void 0 ? void 0 : _e.status;
        const data = (_f = subError.response) === null || _f === void 0 ? void 0 : _f.data;
        // Si es 400/404/405, probar método completo (GET + PUT con todas las variaciones)
        if (status === 400 || status === 404 || status === 405 || (status >= 400 && status < 500)) {
            try {
                return yield updateMercadoLibreStockByItemUpdate(resolvedItemId, variationId, stock, integration.access_token);
            }
            catch (fullError) {
                console.error('[ML Stock] Error método completo:', ((_g = fullError.response) === null || _g === void 0 ? void 0 : _g.data) || fullError.message);
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
        const getRes = yield withRetry429409(() => axios_1.default.get(`https://api.mercadolibre.com/items/${itemId}`, { headers }));
        const item = getRes.data;
        const variations = item.variations || [];
        if (variations.length === 0) {
            yield withRetry429409(() => axios_1.default.put(`https://api.mercadolibre.com/items/${itemId}`, { available_quantity: newStock }, { headers }));
            console.log(`[ML Stock] Actualizado item ${itemId} (sin variaciones) a ${newStock} unidades`);
            return true;
        }
        const variationsPayload = variations.map((v) => {
            var _a;
            const isTarget = String(v.id) === String(variationId);
            const qty = isTarget ? newStock : ((_a = v.available_quantity) !== null && _a !== void 0 ? _a : 0);
            return { id: v.id, available_quantity: Math.max(0, qty) };
        });
        yield withRetry429409(() => axios_1.default.put(`https://api.mercadolibre.com/items/${itemId}`, { variations: variationsPayload }, { headers }));
        console.log(`[ML Stock] Actualizado item ${itemId} variación ${variationId} a ${newStock} unidades (vía PUT item)`);
        return true;
    });
}
/** Obtener el seller_sku actual de una variación (desde attributes o campos directos). */
function getMlVariationSku(v) {
    var _a, _b, _c, _d;
    const skuAttr = Array.isArray(v.attributes) && v.attributes.find((a) => (a.id || '').toString().toUpperCase() === 'SELLER_SKU');
    const fromAttr = skuAttr ? ((_b = (_a = skuAttr.value_name) !== null && _a !== void 0 ? _a : skuAttr.value) !== null && _b !== void 0 ? _b : '').toString().trim() : '';
    return fromAttr || ((_d = (_c = v.seller_sku) !== null && _c !== void 0 ? _c : v.seller_custom_field) !== null && _d !== void 0 ? _d : '').toString().trim() || '';
}
/** Enviar el SKU de tu inventario a Mercado Libre (actualiza seller_sku de la variación). */
const updateMercadoLibreSku = (itemId, variationId, newSku) => __awaiter(void 0, void 0, void 0, function* () {
    var _h;
    const integration = yield (0, db_1.get)(`SELECT access_token FROM integrations WHERE platform = 'mercadolibre'`);
    if (!(integration === null || integration === void 0 ? void 0 : integration.access_token)) {
        console.log('[ML SKU] No hay integración configurada');
        return false;
    }
    const headers = {
        'Authorization': `Bearer ${integration.access_token}`,
        'Content-Type': 'application/json'
    };
    try {
        const getRes = yield withRetry429409(() => axios_1.default.get(`https://api.mercadolibre.com/items/${itemId}`, { headers }));
        const item = getRes.data;
        const variations = item.variations || [];
        if (variations.length === 0) {
            yield withRetry429409(() => axios_1.default.put(`https://api.mercadolibre.com/items/${itemId}`, { seller_custom_field: newSku }, { headers }));
            console.log(`[ML SKU] Actualizado ítem ${itemId} seller_custom_field a "${newSku}"`);
            return true;
        }
        const variationsPayload = variations.map((v) => {
            var _a;
            const isTarget = String(v.id) === String(variationId);
            const sku = isTarget ? newSku : getMlVariationSku(v);
            return { id: v.id, available_quantity: Math.max(0, (_a = v.available_quantity) !== null && _a !== void 0 ? _a : 0), seller_sku: sku || undefined };
        });
        yield withRetry429409(() => axios_1.default.put(`https://api.mercadolibre.com/items/${itemId}`, { variations: variationsPayload }, { headers }));
        console.log(`[ML SKU] Actualizado ítem ${itemId} variación ${variationId} seller_sku a "${newSku}"`);
        return true;
    }
    catch (e) {
        console.error('[ML SKU] Error:', ((_h = e.response) === null || _h === void 0 ? void 0 : _h.data) || e.message);
        return false;
    }
});
exports.updateMercadoLibreSku = updateMercadoLibreSku;
/** Enviar el SKU de tu inventario a Tienda Nube (actualiza sku de la variante). */
const updateTiendaNubeSku = (productId, variantId, newSku) => __awaiter(void 0, void 0, void 0, function* () {
    var _j;
    const integration = yield (0, db_1.get)(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);
    if (!(integration === null || integration === void 0 ? void 0 : integration.access_token) || !(integration === null || integration === void 0 ? void 0 : integration.store_id)) {
        console.log('[TN SKU] No hay integración configurada');
        return false;
    }
    const sku = (0, skuString_1.skuToCanonicalString)(newSku);
    if (!sku) {
        console.log('[TN SKU] SKU vacío, omitido');
        return false;
    }
    try {
        yield (0, tiendanubeClient_1.tnPutWithRetry)(axios_1.default, `https://api.tiendanube.com/v1/${integration.store_id}/products/${productId}/variants/${variantId}`, { sku }, {
            headers: {
                'Authentication': `bearer ${integration.access_token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'LupoHub (lupohub@example.com)'
            }
        }, { maxRetries: 4 });
        console.log(`[TN SKU] Actualizado producto ${productId} variante ${variantId} sku a "${sku}"`);
        return true;
    }
    catch (e) {
        console.error('[TN SKU] Error:', ((_j = e.response) === null || _j === void 0 ? void 0 : _j.data) || e.message);
        return false;
    }
});
exports.updateTiendaNubeSku = updateTiendaNubeSku;
// Endpoint: Obtener historial de movimientos de stock
const getStockMovements = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { variantId, variantIds, productId, type, from, to, limit = '50' } = req.query;
        let whereClause = '1=1';
        const params = [];
        if (variantId) {
            whereClause += ' AND sm.variant_id = ?';
            params.push(variantId);
        }
        if (variantIds) {
            const ids = String(variantIds)
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean);
            if (ids.length > 0) {
                whereClause += ` AND sm.variant_id IN (${ids.map(() => '?').join(',')})`;
                params.push(...ids);
            }
        }
        if (productId) {
            whereClause += ' AND p.id = ?';
            params.push(productId);
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
        const movements = yield (0, db_1.query)(`SELECT
         sm.*,
         pv.sku,
         p.name as product_name,
         o.id as order_id,
         c.business_name as customer_name,
         ua.name as adjust_user_name
       FROM stock_movements sm
       JOIN product_variants pv ON pv.id = sm.variant_id
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       LEFT JOIN orders o
         ON sm.movement_type = 'PEDIDO_MAYORISTA'
        AND o.id = TRIM(SUBSTRING_INDEX(sm.reference, ':', -1))
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN users ua
         ON sm.movement_type = 'AJUSTE_MANUAL'
        AND ua.id = TRIM(REPLACE(sm.reference, 'Ajuste por usuario', ''))
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
// Endpoint: Eliminar el snapshot inicial (todos los movimientos SNAPSHOT_INICIAL) para poder crear uno nuevo
const deleteStockSnapshot = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield (0, db_1.execute)(`DELETE FROM stock_movements WHERE movement_type = 'SNAPSHOT_INICIAL'`);
        const deleted = Number(result === null || result === void 0 ? void 0 : result.affectedRows) || 0;
        res.json({
            message: deleted > 0 ? `Snapshot inicial eliminado (${deleted} registros).` : 'No había snapshot inicial para eliminar.',
            deleted
        });
    }
    catch (error) {
        console.error('Error deleting stock snapshot:', error);
        res.status(500).json({ message: 'Error eliminando snapshot', error: error.message });
    }
});
exports.deleteStockSnapshot = deleteStockSnapshot;
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
    var _k, _l;
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
                            const mlVariationId = (_k = item.item) === null || _k === void 0 ? void 0 : _k.variation_id;
                            const qty = item.quantity || 1;
                            const itemSku = (((_l = item.item) === null || _l === void 0 ? void 0 : _l.sku) || item.sku || '').toString().trim();
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
/** Normaliza código/SKU para búsqueda: quitar guiones, barras y espacios. */
function normalizeCodigo(s) {
    return String(s !== null && s !== void 0 ? s : '')
        .trim()
        .replace(/[-/\s]/g, '')
        .toUpperCase();
}
/** Código de artículo a 7 dígitos con ceros adelante (ej. 52302 → 0052302). */
function padArticleCodeTo7(s) {
    const digits = String(s !== null && s !== void 0 ? s : '').replace(/\D/g, '');
    if (!digits)
        return '';
    return digits.length <= 7 ? digits.padStart(7, '0') : digits;
}
/** Prefijos de artículo habituales (Tango/Lupo): planilla "24605" vs catálogo "Q024605". */
const ARTICLE_SKU_LETTER_PREFIXES = ['Q', 'C', 'P'];
/**
 * Variantes de SKU solo-numérico para cruzar con `products.sku`:
 * el import suele forzar 7 dígitos (22684 → 0022684) pero el catálogo puede tener 022684, 22684, etc.
 * Incluye prefijos letra como en `buildProductSkuLookupCandidates` del import Tango.
 */
function articleSkuCandidates(raw) {
    const t = String(raw !== null && raw !== void 0 ? raw : '').trim();
    if (!t)
        return [];
    const out = [];
    const add = (x) => {
        const s = String(x !== null && x !== void 0 ? x : '').trim();
        if (s && !out.includes(s))
            out.push(s);
    };
    add(t);
    if (/^\d+$/.test(t)) {
        const digits = t;
        const noLead = digits.replace(/^0+/, '') || '0';
        add(digits);
        add(noLead);
        add(padArticleCodeTo7(digits));
        add(padArticleCodeTo7(noLead));
        for (let w = Math.max(4, noLead.length); w <= 7; w++) {
            add(noLead.padStart(w, '0'));
        }
        const p7nl = padArticleCodeTo7(noLead);
        for (const pref of ARTICLE_SKU_LETTER_PREFIXES) {
            add(pref + noLead);
            add(pref.toLowerCase() + noLead);
            if (p7nl) {
                add(pref + p7nl);
                add(pref.toLowerCase() + p7nl);
            }
            if (digits !== noLead) {
                add(pref + digits);
                add(pref.toLowerCase() + digits);
                const p7d = padArticleCodeTo7(digits);
                if (p7d && p7d !== p7nl) {
                    add(pref + p7d);
                    add(pref.toLowerCase() + p7d);
                }
            }
        }
    }
    else {
        const digits = t.replace(/\D/g, '');
        if (digits) {
            const p = padArticleCodeTo7(digits);
            if (p)
                add(p);
            const noLead = digits.replace(/^0+/, '') || '0';
            if (noLead !== digits) {
                add(noLead);
                add(padArticleCodeTo7(noLead));
            }
        }
        const m = t.match(/^([A-Za-z]{1,3})(\d[\d\s-]*)$/);
        if (m) {
            const num = m[2].replace(/\D/g, '');
            if (num) {
                const nl = num.replace(/^0+/, '') || '0';
                add(nl);
                add(padArticleCodeTo7(nl));
            }
        }
    }
    return out;
}
/** Tallas equivalentes: `sizes.size_code` puede ser "170" (Tango) o "U" según origen de datos. */
function sizeLookupCodes(sizeCode) {
    const s = String(sizeCode !== null && sizeCode !== void 0 ? sizeCode : '').trim();
    if (!s)
        return [];
    const out = [];
    const add = (x) => {
        const t = String(x !== null && x !== void 0 ? x : '').trim();
        if (t && !out.includes(t))
            out.push(t);
    };
    add(s);
    const u = s.toUpperCase();
    if (u !== s)
        add(u);
    if (/^\d{1,3}$/.test(s)) {
        const letter = (0, talles_tango_1.nombreTalleDesdeCodigo)(s);
        if (letter && letter !== s)
            add(letter);
    }
    else if (/^[A-Z]{1,4}$/.test(u)) {
        const num = (0, talles_tango_1.codigoTalleParaSku)(u);
        if (num && num !== s)
            add(num);
    }
    return out;
}
function sizeLookupNameLowerSet(sizeCode) {
    const seen = new Set();
    const out = [];
    const add = (x) => {
        const t = String(x !== null && x !== void 0 ? x : '').trim().toLowerCase();
        if (!t || seen.has(t))
            return;
        seen.add(t);
        out.push(t);
    };
    for (const c of sizeLookupCodes(sizeCode)) {
        add(c);
        if (/^\d{1,3}$/.test(c))
            add((0, talles_tango_1.nombreTalleDesdeCodigo)(c));
    }
    return out;
}
/** Escapa % y _ para uso en LIKE. */
function escapeLike(s) {
    return String(s !== null && s !== void 0 ? s : '').replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
/** Candidatos de color para matchear `colors.code` / nombre (Excel 4 dígitos vs catálogo 3, ceros a la izquierda, etc.). */
function colorLookupCandidates(colorRaw) {
    const s = String(colorRaw !== null && colorRaw !== void 0 ? colorRaw : '').trim();
    if (!s)
        return [];
    const out = [];
    const add = (x) => {
        const t = String(x !== null && x !== void 0 ? x : '').trim();
        if (t && !out.includes(t))
            out.push(t);
    };
    add(s);
    const normImp = (0, colorCodeCanonical_1.normalizeColorCodeForImportValue)(s);
    if (normImp)
        add(normImp);
    const digits = (0, colorCodeCanonical_1.digitsOnlyColorCode)(s);
    if (digits) {
        add(digits);
        const stripped = digits.replace(/^0+/, '') || '0';
        if (stripped !== digits)
            add(stripped);
        const canD = (0, colorCodeCanonical_1.canonicalNumericColorCode)(digits);
        if (canD)
            add(canD);
        const canS = (0, colorCodeCanonical_1.canonicalNumericColorCode)(stripped);
        if (canS)
            add(canS);
    }
    return out;
}
/** Resuelve variant_id por código de producto (base SKU), código de color y código de talle. Prueba exacto, normalizado y "empieza con". */
function getVariantIdByCodigoColorSize(codigo, colorCode, sizeCode) {
    return __awaiter(this, void 0, void 0, function* () {
        const codigoTrim = (codigo !== null && codigo !== void 0 ? codigo : '').toString().trim();
        const sizeStr = (sizeCode !== null && sizeCode !== void 0 ? sizeCode : '').toString().trim();
        if (!codigoTrim || !sizeStr)
            return null;
        const colorCandidates = colorLookupCandidates((colorCode !== null && colorCode !== void 0 ? colorCode : '').toString().trim());
        if (!colorCandidates.length)
            return null;
        const skuList = articleSkuCandidates(codigoTrim);
        if (!skuList.length)
            return null;
        const sizeInList = sizeLookupCodes(sizeStr);
        const nameInList = sizeLookupNameLowerSet(sizeStr);
        const sizePlaceholders = sizeInList.map(() => '?').join(', ');
        const namePlaceholders = nameInList.map(() => '?').join(', ');
        const sizeMatchSql = `(
    TRIM(CAST(s.size_code AS CHAR)) IN (${sizePlaceholders})
    OR LOWER(TRIM(COALESCE(s.name, ''))) IN (${namePlaceholders})
  )`;
        const sizeParamsTail = [...sizeInList, ...nameInList];
        const colorMatchSql = `(TRIM(CAST(c.code AS CHAR)) = TRIM(?) OR LOWER(TRIM(COALESCE(c.name, ''))) = LOWER(TRIM(?)))`;
        const tryWhere = (skuWhereSql, skuParams, opts) => __awaiter(this, void 0, void 0, function* () {
            const lim = (opts === null || opts === void 0 ? void 0 : opts.limitOne) ? ' LIMIT 1' : '';
            for (const colorTry of colorCandidates) {
                const row = yield (0, db_1.get)(`SELECT pv.id AS variant_id
         FROM products p
         JOIN product_colors pc ON pc.product_id = p.id
         JOIN colors c ON c.id = pc.color_id
         JOIN product_variants pv ON pv.product_color_id = pc.id
         JOIN sizes s ON s.id = pv.size_id
         WHERE ${skuWhereSql} AND ${colorMatchSql} AND ${sizeMatchSql}${lim}`, [...skuParams, colorTry, colorTry, ...sizeParamsTail]);
                if (row === null || row === void 0 ? void 0 : row.variant_id)
                    return row.variant_id;
            }
            return null;
        });
        for (const skuTry of skuList) {
            const id = yield tryWhere('p.sku = ?', [skuTry]);
            if (id)
                return id;
        }
        const normSet = new Set();
        for (const skuTry of skuList) {
            const n = normalizeCodigo(skuTry);
            if (n)
                normSet.add(n);
        }
        for (const norm of normSet) {
            const id = yield tryWhere(`REPLACE(REPLACE(REPLACE(p.sku, '-', ''), '/', ''), CHAR(32), '') = ?`, [norm]);
            if (id)
                return id;
        }
        for (const norm of normSet) {
            const pattern = escapeLike(norm) + '%';
            const id = yield tryWhere(`REPLACE(REPLACE(REPLACE(p.sku, '-', ''), '/', ''), CHAR(32), '') LIKE ?`, [pattern], { limitOne: true });
            if (id)
                return id;
        }
        return null;
    });
}
const EXCEL_SIZE_COLUMNS = ['P', 'M', 'G', 'GG', 'U', 'XG', 'XXG', 'XXXG'];
function sizeCandidatesFromGridKey(gridKey) {
    const raw = String(gridKey !== null && gridKey !== void 0 ? gridKey : '').trim();
    if (!raw)
        return [];
    const u = raw.toUpperCase().replace(/\s+/g, ' ');
    const out = new Set();
    const add = (x) => {
        const t = String(x).trim();
        if (t)
            out.add(t);
    };
    add(raw);
    add(u);
    const dash = u.match(/^(\d{2,4})\s*[-–]\s*(.+)$/);
    if (dash) {
        add(dash[1]);
        add((0, talles_tango_1.codigoTalleParaSku)(dash[1]));
        add(dash[2].trim());
        add((0, talles_tango_1.codigoTalleParaSku)(dash[2].trim()));
    }
    add((0, talles_tango_1.codigoTalleParaSku)(u));
    add((0, talles_tango_1.codigoTalleParaSku)(raw));
    /** Códigos Tango 130–180 en planilla vs `sizes.size_code` en letra (U, XG, …). */
    const letterFromTango = talles_tango_1.TALLE_CODIGO_A_NOMBRE[u] || talles_tango_1.TALLE_CODIGO_A_NOMBRE[raw.trim()];
    if (letterFromTango)
        add(letterFromTango);
    return [...out];
}
function resolveVariantIdForGridCell(codigo, colorStr, gridSizeKey) {
    return __awaiter(this, void 0, void 0, function* () {
        for (const sc of sizeCandidatesFromGridKey(gridSizeKey)) {
            const id = yield getVariantIdByCodigoColorSize(codigo, colorStr, sc);
            if (id)
                return id;
        }
        return null;
    });
}
exports.resolveVariantIdForGridCell = resolveVariantIdForGridCell;
const GRID_RESERVED_KEYS = new Set([
    'codigo',
    'código',
    'color',
    'col',
    'descripcion',
    'descripción',
    'modelo',
    'precio',
    'total',
    'subtotal',
    'importe',
    'sku',
    'articulo',
    'artículo',
    'nombre',
    'producto',
    'stock',
    'deposito',
    'depósito',
    'categoria',
    'categoría',
    'proveedor',
    'cod',
    'notas',
    'obs',
    'observaciones',
    'marca',
    'cantidad',
].map((k) => k.normalize('NFD').replace(/[\u0300-\u036f]/g, '')));
function isGridReservedKey(key) {
    const k = key
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    if (!k)
        return true;
    if (GRID_RESERVED_KEYS.has(k))
        return true;
    if (k.startsWith('_'))
        return true;
    return false;
}
function parseStockValue(v) {
    if (v === null || v === undefined || v === '')
        return 0;
    if (typeof v === 'number' && !Number.isNaN(v))
        return Math.max(0, Math.floor(v));
    const s = String(v).trim().toUpperCase();
    if (s === 'X' || s === '-' || s === 'N/A')
        return 0;
    const n = parseFloat(s.replace(/[^\d.,-]/g, '').replace(',', '.'));
    return Number.isNaN(n) ? 0 : Math.max(0, Math.floor(n));
}
const importStockFromExcel = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _m, _o, _p, _q, _r, _s;
    try {
        const { rows: rawRows } = req.body;
        if (!Array.isArray(rawRows) || rawRows.length === 0) {
            return res.status(400).json({
                message: 'Se requiere un array "rows" con las filas del Excel (columnas CODIGO, COLOR y tallas P, M, G, etc.).'
            });
        }
        const notFound = [];
        const errors = [];
        let updated = 0;
        for (const row of rawRows) {
            const codigo = ((_p = (_o = (_m = row.codigo) !== null && _m !== void 0 ? _m : row.CODIGO) !== null && _o !== void 0 ? _o : row.Codigo) !== null && _p !== void 0 ? _p : '').toString().trim();
            const colorRaw = (_r = (_q = row.color) !== null && _q !== void 0 ? _q : row.COLOR) !== null && _r !== void 0 ? _r : row.Color;
            const colorStr = colorRaw != null ? String(colorRaw).trim() : '';
            if (!codigo || !colorStr)
                continue;
            for (const sizeCode of EXCEL_SIZE_COLUMNS) {
                const rawVal = (_s = row[sizeCode]) !== null && _s !== void 0 ? _s : row[sizeCode.toLowerCase()];
                const stock = parseStockValue(rawVal);
                const variantId = yield getVariantIdByCodigoColorSize(codigo, colorStr, sizeCode);
                if (!variantId) {
                    const key = `${codigo}-${colorStr}-${sizeCode}`;
                    if (!notFound.includes(key))
                        notFound.push(key);
                    continue;
                }
                const ok = yield (0, exports.updateVariantStock)(variantId, stock, 'IMPORTACION_EXCEL', 'Importación Excel', true);
                if (ok)
                    updated++;
                else
                    errors.push(`Error actualizando ${codigo} color ${colorStr} talle ${sizeCode}`);
            }
        }
        res.json({
            message: 'Importación de stock completada',
            updated,
            notFound: notFound.slice(0, 200),
            notFoundCount: notFound.length,
            errors: errors.length > 0 ? errors.slice(0, 50) : undefined
        });
    }
    catch (error) {
        console.error('Error importing stock from Excel:', error);
        res.status(500).json({ message: 'Error importando stock desde Excel', error: error.message });
    }
});
exports.importStockFromExcel = importStockFromExcel;
/**
 * Planilla tipo inventario Lupo (CODIGO + COLOR + columnas de talles: P, 10, 130 - P, etc.):
 * actualiza stock del depósito y vincula ítems al despacho indicado.
 */
const importStockGridToDespacho = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5;
    try {
        const { despachoId, rows: rawRows, updateDepotStock = true } = req.body;
        const despId = despachoId != null ? String(despachoId).trim() : '';
        if (!despId) {
            return res.status(400).json({ message: 'despachoId es requerido' });
        }
        if (!Array.isArray(rawRows) || rawRows.length === 0) {
            return res.status(400).json({
                message: 'Se requiere un array "rows" (planilla CODIGO + COLOR + columnas de talles).',
            });
        }
        const despacho = yield (0, db_1.get)(`SELECT id, pais_origen, numero_despacho FROM despachos WHERE id = ?`, [despId]);
        if (!(despacho === null || despacho === void 0 ? void 0 : despacho.id)) {
            return res.status(400).json({ message: 'Despacho no encontrado' });
        }
        const pais = despacho.pais_origen && String(despacho.pais_origen).trim()
            ? String(despacho.pais_origen).trim()
            : 'Brasil';
        const ref = `Despacho ${despacho.numero_despacho || despacho.id}`;
        let updatedStock = 0;
        let despachoItemsInserted = 0;
        let despachoItemsUpdated = 0;
        const notFound = [];
        const errors = [];
        const taggedProducts = new Set();
        const doStock = updateDepotStock !== false;
        for (const row of rawRows) {
            const codigoRaw = ((_z = (_y = (_x = (_w = (_v = (_u = (_t = row.codigo) !== null && _t !== void 0 ? _t : row.CODIGO) !== null && _u !== void 0 ? _u : row.Codigo) !== null && _v !== void 0 ? _v : row.articulo) !== null && _w !== void 0 ? _w : row.ARTICULO) !== null && _x !== void 0 ? _x : row.MODELO) !== null && _y !== void 0 ? _y : row.modelo) !== null && _z !== void 0 ? _z : '')
                .toString()
                .trim();
            const colorRaw = (_3 = (_2 = (_1 = (_0 = row.color) !== null && _0 !== void 0 ? _0 : row.COLOR) !== null && _1 !== void 0 ? _1 : row.Color) !== null && _2 !== void 0 ? _2 : row['CODIGO COLOR']) !== null && _3 !== void 0 ? _3 : row['COD. COLOR'];
            const colorStr = colorRaw != null ? String(colorRaw).trim() : '';
            const codigo = padArticleCodeTo7(codigoRaw) || codigoRaw;
            if (!codigo || !colorStr)
                continue;
            for (const [gridKey, val] of Object.entries(row)) {
                if (isGridReservedKey(gridKey))
                    continue;
                const qty = parseStockValue(val);
                const variantId = yield resolveVariantIdForGridCell(codigo, colorStr, gridKey);
                if (!variantId) {
                    const key = `${codigo}-${colorStr}-${gridKey}`;
                    if (!notFound.includes(key))
                        notFound.push(key);
                    continue;
                }
                const productRow = yield (0, db_1.get)(`SELECT pc.product_id AS product_id, p.name AS name, pv.sku AS sku
           FROM product_variants pv
           JOIN product_colors pc ON pc.id = pv.product_color_id
           JOIN products p ON p.id = pc.product_id
           WHERE pv.id = ?`, [variantId]);
                const productId = productRow === null || productRow === void 0 ? void 0 : productRow.product_id;
                if (!productId) {
                    errors.push(`Sin producto para variante ${variantId}`);
                    continue;
                }
                const prodName = String((_4 = productRow === null || productRow === void 0 ? void 0 : productRow.name) !== null && _4 !== void 0 ? _4 : '').trim();
                const varSku = String((_5 = productRow === null || productRow === void 0 ? void 0 : productRow.sku) !== null && _5 !== void 0 ? _5 : '').trim();
                const descripcionItem = `${prodName || codigo} - ${varSku || gridKey}`.trim();
                if (doStock) {
                    const ok = yield (0, exports.updateVariantStock)(variantId, qty, 'IMPORTACION_DESPACHO_GRID', ref, true);
                    if (ok)
                        updatedStock++;
                    else
                        errors.push(`Stock ${codigo} ${gridKey}`);
                }
                if (qty > 0) {
                    const di = yield (0, db_1.get)(`SELECT id FROM despacho_items WHERE despacho_id = ? AND variant_id = ? LIMIT 1`, [despacho.id, variantId]);
                    if (di === null || di === void 0 ? void 0 : di.id) {
                        yield (0, db_1.execute)(`UPDATE despacho_items SET cantidad = ?, product_id = ?, descripcion_item = ? WHERE id = ?`, [qty, productId, descripcionItem, di.id]);
                        despachoItemsUpdated++;
                    }
                    else {
                        yield (0, db_1.execute)(`INSERT INTO despacho_items (id, despacho_id, product_id, variant_id, cantidad, costo_unitario, descripcion_item) VALUES (?, ?, ?, ?, ?, NULL, ?)`, [(0, uuid_1.v4)(), despacho.id, productId, variantId, qty, descripcionItem]);
                        despachoItemsInserted++;
                    }
                }
                yield (0, db_1.execute)(`UPDATE products SET ultimo_despacho_id = ?, pais_origen = ? WHERE id = ?`, [
                    despacho.id,
                    pais,
                    productId,
                ]);
                taggedProducts.add(productId);
            }
        }
        res.json({
            message: 'Importación de planilla al despacho completada',
            updatedStock,
            despachoItemsInserted,
            despachoItemsUpdated,
            productsTagged: taggedProducts.size,
            notFound: notFound.slice(0, 200),
            notFoundCount: notFound.length,
            errors: errors.length > 0 ? errors.slice(0, 50) : undefined,
        });
    }
    catch (error) {
        console.error('importStockGridToDespacho:', error);
        res.status(500).json({ message: 'Error importando planilla al despacho', error: error.message });
    }
});
exports.importStockGridToDespacho = importStockGridToDespacho;
