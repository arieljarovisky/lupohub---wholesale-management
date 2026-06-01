"use strict";
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
exports.bulkUpdateChannelPrices = exports.getVariantChannelPrices = void 0;
const axios_1 = __importDefault(require("axios"));
const db_1 = require("../database/db");
const integrations_controller_1 = require("./integrations.controller");
const tiendanubeClient_1 = require("../utils/tiendanubeClient");
const channelMarginFetch_1 = require("../utils/channelMarginFetch");
const touchProductUpdatedAt_1 = require("../utils/touchProductUpdatedAt");
const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';
const TN_RATE_LIMIT_DELAY_MS = Math.max(0, parseInt(process.env.TN_RATE_LIMIT_DELAY_MS || '800', 10));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fetchMlPricesForItem(accessToken, itemId, variants, prices) {
    var _a, _b, _c, _d, _e, _f;
    return __awaiter(this, void 0, void 0, function* () {
        const headers = { Authorization: `Bearer ${accessToken}` };
        try {
            const itemRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${itemId}`, {
                headers,
                validateStatus: () => true,
            });
            if (itemRes.status !== 200 || !itemRes.data)
                return;
            const item = itemRes.data;
            const variations = item.variations || [];
            for (const { variantId, variationId } of variants) {
                if (!prices[variantId])
                    continue;
                if (variations.length === 0) {
                    prices[variantId].priceML = Number((_a = item.price) !== null && _a !== void 0 ? _a : 0);
                }
                else if (variationId) {
                    const v = variations.find((x) => String(x.id) === String(variationId));
                    if (v)
                        prices[variantId].priceML = Number((_c = (_b = v.price) !== null && _b !== void 0 ? _b : item.price) !== null && _c !== void 0 ? _c : 0);
                }
                else if (variations.length === 1) {
                    prices[variantId].priceML = Number((_e = (_d = variations[0].price) !== null && _d !== void 0 ? _d : item.price) !== null && _e !== void 0 ? _e : 0);
                }
                else {
                    prices[variantId].priceML = Number((_f = item.price) !== null && _f !== void 0 ? _f : 0);
                }
            }
        }
        catch (_g) {
            /* ignore */
        }
    });
}
function updateMlPrice(accessToken, mlItemId, mlVariationId, price) {
    return __awaiter(this, void 0, void 0, function* () {
        const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
        const p = Math.max(0, Number(price));
        try {
            const itemRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${mlItemId}`, {
                headers,
                validateStatus: () => true,
            });
            if (itemRes.status !== 200 || !itemRes.data)
                return false;
            const item = itemRes.data;
            const variations = item.variations || [];
            if (variations.length === 0) {
                const r = yield axios_1.default.put(`https://api.mercadolibre.com/items/${mlItemId}`, { price: p }, { headers, validateStatus: () => true });
                return r.status >= 200 && r.status < 300;
            }
            const varId = mlVariationId || (variations.length === 1 ? String(variations[0].id) : null);
            if (!varId)
                return false;
            const r = yield axios_1.default.put(`https://api.mercadolibre.com/items/${mlItemId}`, { variations: [{ id: varId, price: p }] }, { headers, validateStatus: () => true });
            return r.status >= 200 && r.status < 300;
        }
        catch (_a) {
            return false;
        }
    });
}
function updateTnPrice(storeId, accessToken, tnProductId, tnVariantId, price) {
    return __awaiter(this, void 0, void 0, function* () {
        const p = Math.max(0, Number(price));
        const url = `https://api.tiendanube.com/v1/${storeId}/products/${tnProductId}/variants/${tnVariantId}`;
        const headers = {
            Authentication: `bearer ${accessToken}`,
            'User-Agent': TN_USER_AGENT,
            'Content-Type': 'application/json',
        };
        try {
            yield (0, tiendanubeClient_1.tnPutWithRetry)(axios_1.default, url, { price: String(p) }, { headers, validateStatus: () => true });
            return true;
        }
        catch (_a) {
            return false;
        }
    });
}
/** POST { variantIds: string[] } → precios local / ML / TN por variante. */
const getVariantChannelPrices = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const variantIds = Array.isArray((_a = req.body) === null || _a === void 0 ? void 0 : _a.variantIds)
            ? req.body.variantIds.filter((id) => typeof id === 'string' && id.length > 0).slice(0, 100)
            : [];
        if (variantIds.length === 0)
            return res.json({ prices: {} });
        const placeholders = variantIds.map(() => '?').join(',');
        const rows = (yield (0, db_1.query)(`SELECT pv.id AS variant_id, pv.sku,
              p.id AS product_id, p.base_price,
              p.mercado_libre_id, pv.mercado_libre_variant_id, pv.mercado_libre_item_id,
              p.tienda_nube_id, pv.tienda_nube_variant_id
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       WHERE pv.id IN (${placeholders})`, variantIds));
        const prices = {};
        for (const id of variantIds) {
            prices[id] = { hasML: false, hasTN: false, productId: '' };
        }
        for (const r of rows || []) {
            const vid = r.variant_id;
            if (!prices[vid])
                continue;
            prices[vid] = {
                productId: r.product_id,
                sku: (_b = r.sku) !== null && _b !== void 0 ? _b : undefined,
                priceLocal: Number((_c = r.base_price) !== null && _c !== void 0 ? _c : 0),
                hasML: !!(r.mercado_libre_item_id || r.mercado_libre_id || r.mercado_libre_variant_id),
                hasTN: !!(r.tienda_nube_id && r.tienda_nube_variant_id),
            };
        }
        const mlToken = yield (0, integrations_controller_1.getValidMLToken)();
        if (mlToken === null || mlToken === void 0 ? void 0 : mlToken.access_token) {
            const mlItemIds = new Map();
            for (const r of rows || []) {
                const variantId = r.variant_id;
                const mlItemId = r.mercado_libre_item_id || r.mercado_libre_id;
                const variationId = r.mercado_libre_variant_id ? String(r.mercado_libre_variant_id) : null;
                if (!mlItemId)
                    continue;
                if (!mlItemIds.has(mlItemId))
                    mlItemIds.set(mlItemId, []);
                mlItemIds.get(mlItemId).push({ variantId, variationId });
            }
            for (const [itemId, vars] of mlItemIds) {
                yield fetchMlPricesForItem(mlToken.access_token, itemId, vars, prices);
            }
        }
        const tnIntegration = yield (0, db_1.get)(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
        const tnStoreId = (0, channelMarginFetch_1.resolveTnStoreId)(tnIntegration);
        if ((tnIntegration === null || tnIntegration === void 0 ? void 0 : tnIntegration.access_token) && tnStoreId) {
            const tnProductIds = new Map();
            for (const r of rows || []) {
                if (!r.tienda_nube_id || !r.tienda_nube_variant_id)
                    continue;
                const pid = String(r.tienda_nube_id);
                if (!tnProductIds.has(pid))
                    tnProductIds.set(pid, []);
                tnProductIds.get(pid).push({
                    variantId: r.variant_id,
                    tnVariantId: String(r.tienda_nube_variant_id),
                });
            }
            if (tnProductIds.size > 0) {
                yield (0, channelMarginFetch_1.fetchTnProductsBatched)(tnStoreId, tnIntegration.access_token, tnProductIds, prices);
            }
        }
        res.json({ prices });
    }
    catch (error) {
        console.error('[getVariantChannelPrices]', (error === null || error === void 0 ? void 0 : error.message) || error);
        res.status(500).json({ message: 'Error obteniendo precios de canales', detail: error === null || error === void 0 ? void 0 : error.message });
    }
});
exports.getVariantChannelPrices = getVariantChannelPrices;
/** POST { updates, applyLocal?, applyML?, applyTN? } */
const bulkUpdateChannelPrices = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _d, _e, _f, _g;
    try {
        const updates = Array.isArray((_d = req.body) === null || _d === void 0 ? void 0 : _d.updates) ? req.body.updates.slice(0, 50) : [];
        const applyLocal = ((_e = req.body) === null || _e === void 0 ? void 0 : _e.applyLocal) !== false;
        const applyML = ((_f = req.body) === null || _f === void 0 ? void 0 : _f.applyML) !== false;
        const applyTN = ((_g = req.body) === null || _g === void 0 ? void 0 : _g.applyTN) !== false;
        if (updates.length === 0) {
            return res.status(400).json({ message: 'Indicá al menos una variante en updates' });
        }
        const mlToken = applyML ? yield (0, integrations_controller_1.getValidMLToken)() : null;
        const tnIntegration = applyTN
            ? yield (0, db_1.get)(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`)
            : null;
        let updatedLocal = 0;
        let updatedML = 0;
        let updatedTN = 0;
        const errors = [];
        const productLocalUpdated = new Set();
        for (const u of updates) {
            const variantId = String((u === null || u === void 0 ? void 0 : u.variantId) || '').trim();
            if (!variantId)
                continue;
            const row = (yield (0, db_1.get)(`SELECT pv.id, p.id AS product_id, p.base_price,
                p.mercado_libre_id, pv.mercado_libre_variant_id, pv.mercado_libre_item_id,
                p.tienda_nube_id, pv.tienda_nube_variant_id, pv.sku
         FROM product_variants pv
         JOIN product_colors pc ON pc.id = pv.product_color_id
         JOIN products p ON p.id = pc.product_id
         WHERE pv.id = ?`, [variantId]));
            if (!(row === null || row === void 0 ? void 0 : row.variant_id)) {
                errors.push(`${variantId}: variante no encontrada`);
                continue;
            }
            if (applyLocal && u.priceLocal != null && Number.isFinite(Number(u.priceLocal))) {
                const p = Math.max(0, Number(u.priceLocal));
                if (!productLocalUpdated.has(row.product_id)) {
                    yield (0, db_1.execute)(`UPDATE products SET base_price = ? WHERE id = ?`, [p, row.product_id]);
                    productLocalUpdated.add(row.product_id);
                    updatedLocal++;
                }
                yield (0, touchProductUpdatedAt_1.touchProductUpdatedAtByVariantId)(variantId);
            }
            if (applyML && u.priceML != null && Number.isFinite(Number(u.priceML)) && (mlToken === null || mlToken === void 0 ? void 0 : mlToken.access_token)) {
                const mlItemId = row.mercado_libre_item_id || row.mercado_libre_id;
                if (!mlItemId) {
                    errors.push(`${row.sku || variantId}: sin vínculo ML`);
                }
                else {
                    const ok = yield updateMlPrice(mlToken.access_token, String(mlItemId), row.mercado_libre_variant_id ? String(row.mercado_libre_variant_id) : null, Number(u.priceML));
                    if (ok)
                        updatedML++;
                    else
                        errors.push(`${row.sku || variantId}: ML no aceptó el precio`);
                }
                if (TN_RATE_LIMIT_DELAY_MS > 0)
                    yield sleep(TN_RATE_LIMIT_DELAY_MS);
            }
            if (applyTN && u.priceTN != null && Number.isFinite(Number(u.priceTN)) && (tnIntegration === null || tnIntegration === void 0 ? void 0 : tnIntegration.access_token) && (tnIntegration === null || tnIntegration === void 0 ? void 0 : tnIntegration.store_id)) {
                if (!row.tienda_nube_id || !row.tienda_nube_variant_id) {
                    errors.push(`${row.sku || variantId}: sin vínculo TN`);
                }
                else {
                    const ok = yield updateTnPrice(String(tnIntegration.store_id), tnIntegration.access_token, String(row.tienda_nube_id), String(row.tienda_nube_variant_id), Number(u.priceTN));
                    if (ok)
                        updatedTN++;
                    else
                        errors.push(`${row.sku || variantId}: TN no aceptó el precio`);
                }
                if (TN_RATE_LIMIT_DELAY_MS > 0)
                    yield sleep(TN_RATE_LIMIT_DELAY_MS);
            }
        }
        res.json({
            message: 'Actualización de precios procesada',
            updatedLocal,
            updatedML,
            updatedTN,
            errors: errors.slice(0, 30),
        });
    }
    catch (error) {
        console.error('[bulkUpdateChannelPrices]', (error === null || error === void 0 ? void 0 : error.message) || error);
        res.status(500).json({ message: 'Error actualizando precios', detail: error === null || error === void 0 ? void 0 : error.message });
    }
});
exports.bulkUpdateChannelPrices = bulkUpdateChannelPrices;
