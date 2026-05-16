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
exports.getChannelMargins = void 0;
const axios_1 = __importDefault(require("axios"));
const db_1 = require("../database/db");
const integrations_controller_1 = require("./integrations.controller");
const channelMarginUtils_1 = require("../utils/channelMarginUtils");
const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';
function buildChannelSlice(price, fee, fob) {
    const margin = (0, channelMarginUtils_1.calcMargin)(price, fee, fob);
    return {
        price: Math.round(price * 100) / 100,
        fee: Math.round(fee * 100) / 100,
        margin,
        marginPercent: margin != null ? (0, channelMarginUtils_1.calcMarginPercent)(margin, price) : null,
    };
}
function variantChannelWhere(channel) {
    if (channel === 'ml') {
        return `AND (pv.mercado_libre_item_id IS NOT NULL OR p.mercado_libre_id IS NOT NULL OR pv.mercado_libre_variant_id IS NOT NULL)`;
    }
    if (channel === 'tn') {
        return `AND p.tienda_nube_id IS NOT NULL AND pv.tienda_nube_variant_id IS NOT NULL`;
    }
    return `AND (
    pv.mercado_libre_item_id IS NOT NULL OR p.mercado_libre_id IS NOT NULL OR pv.mercado_libre_variant_id IS NOT NULL
    OR (p.tienda_nube_id IS NOT NULL AND pv.tienda_nube_variant_id IS NOT NULL)
  )`;
}
/** GET /integrations/channel-margins — una fila por artículo (producto padre). */
const getChannelMargins = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    try {
        const search = String(req.query.search || '').trim();
        const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
        const limit = Math.min(100, Math.max(10, parseInt(String(req.query.limit || '50'), 10) || 50));
        const channel = String(req.query.channel || 'all').toLowerCase();
        const offset = (page - 1) * limit;
        const channelWhere = variantChannelWhere(channel);
        const searchWhere = search
            ? `AND (p.name LIKE ? OR p.sku LIKE ? OR pv.sku LIKE ? OR c.name LIKE ?)`
            : '';
        const searchParams = search ? [`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`] : [];
        const joinFrom = `
       FROM products p
       INNER JOIN product_colors pc ON pc.product_id = p.id
       INNER JOIN product_variants pv ON pv.product_color_id = pc.id
       INNER JOIN colors c ON c.id = pc.color_id
       INNER JOIN sizes s ON s.id = pv.size_id
       WHERE 1=1 ${channelWhere} ${searchWhere}`;
        const countRow = (yield (0, db_1.get)(`SELECT COUNT(DISTINCT p.id) AS total ${joinFrom}`, searchParams));
        const total = Number((_a = countRow === null || countRow === void 0 ? void 0 : countRow.total) !== null && _a !== void 0 ? _a : 0);
        const productRows = (yield (0, db_1.query)(`SELECT p.id AS product_id, p.name AS product_name, p.sku AS base_sku,
              COUNT(pv.id) AS variant_count
       ${joinFrom}
       GROUP BY p.id, p.name, p.sku
       ORDER BY p.name
       LIMIT ? OFFSET ?`, [...searchParams, limit, offset]));
        const fobInfo = yield (0, channelMarginUtils_1.resolveFobPriceList)();
        const tnPreset = (0, channelMarginUtils_1.resolveTnFeePreset)(String(req.query.tnFeePreset || ''));
        if (productRows.length === 0) {
            return res.json({
                config: buildConfigResponse(fobInfo, tnPreset),
                total,
                page,
                limit,
                rows: [],
            });
        }
        const productIds = productRows.map((p) => p.product_id);
        const placeholders = productIds.map(() => '?').join(',');
        const variantRows = (yield (0, db_1.query)(`SELECT pv.id AS variant_id, p.id AS product_id, pv.sku,
              c.name AS color_name, s.size_code,
              p.mercado_libre_id, pv.mercado_libre_item_id, pv.mercado_libre_variant_id,
              p.tienda_nube_id, pv.tienda_nube_variant_id
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       JOIN colors c ON c.id = pc.color_id
       JOIN sizes s ON s.id = pv.size_id
       WHERE p.id IN (${placeholders}) ${channelWhere}
       ORDER BY p.id, s.size_code, c.name`, productIds));
        const mlPaymentCptPercent = (0, channelMarginUtils_1.getMlPaymentCptPercent)();
        const variantsByProduct = new Map();
        for (const v of variantRows) {
            if (!variantsByProduct.has(v.product_id))
                variantsByProduct.set(v.product_id, []);
            variantsByProduct.get(v.product_id).push(v);
        }
        const mlToken = yield (0, integrations_controller_1.getValidMLToken)();
        const feeCache = new Map();
        const mlItemCache = new Map();
        const prices = {};
        const mlItemIds = new Map();
        const tnProductIds = new Map();
        for (const v of variantRows) {
            prices[v.variant_id] = {};
            const mlItemId = v.mercado_libre_item_id || v.mercado_libre_id;
            if (mlItemId && (mlToken === null || mlToken === void 0 ? void 0 : mlToken.access_token)) {
                const variationId = v.mercado_libre_variant_id ? String(v.mercado_libre_variant_id) : null;
                if (!mlItemIds.has(mlItemId))
                    mlItemIds.set(mlItemId, []);
                mlItemIds.get(mlItemId).push({ variantId: v.variant_id, variationId });
            }
            if (v.tienda_nube_id && v.tienda_nube_variant_id && !tnProductIds.has(v.product_id)) {
                tnProductIds.set(v.product_id, {
                    variantId: v.variant_id,
                    tnVariantId: String(v.tienda_nube_variant_id),
                });
            }
        }
        if (mlToken === null || mlToken === void 0 ? void 0 : mlToken.access_token) {
            const headers = { Authorization: `Bearer ${mlToken.access_token}` };
            for (const [itemId, vars] of mlItemIds) {
                try {
                    const itemRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${itemId}`, {
                        headers,
                        validateStatus: () => true,
                    });
                    if (itemRes.status !== 200 || !itemRes.data)
                        continue;
                    const item = itemRes.data;
                    mlItemCache.set(itemId, item);
                    const variations = item.variations || [];
                    for (const { variantId, variationId } of vars) {
                        if (!prices[variantId])
                            continue;
                        let priceML = 0;
                        if (variations.length === 0) {
                            priceML = Number((_b = item.price) !== null && _b !== void 0 ? _b : 0);
                        }
                        else if (variationId) {
                            const vr = variations.find((x) => String(x.id) === String(variationId));
                            priceML = Number((_d = (_c = vr === null || vr === void 0 ? void 0 : vr.price) !== null && _c !== void 0 ? _c : item.price) !== null && _d !== void 0 ? _d : 0);
                        }
                        else if (variations.length === 1) {
                            priceML = Number((_g = (_f = (_e = variations[0]) === null || _e === void 0 ? void 0 : _e.price) !== null && _f !== void 0 ? _f : item.price) !== null && _g !== void 0 ? _g : 0);
                        }
                        else {
                            priceML = Number((_h = item.price) !== null && _h !== void 0 ? _h : 0);
                        }
                        prices[variantId].priceML = priceML;
                        prices[variantId].mlItem = item;
                    }
                }
                catch (_k) {
                    /* ignore */
                }
            }
        }
        const tnIntegration = yield (0, db_1.get)(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);
        if ((tnIntegration === null || tnIntegration === void 0 ? void 0 : tnIntegration.access_token) && (tnIntegration === null || tnIntegration === void 0 ? void 0 : tnIntegration.store_id)) {
            const tnHeaders = {
                Authentication: `bearer ${tnIntegration.access_token}`,
                'User-Agent': TN_USER_AGENT,
            };
            for (const [tnProductId, { variantId, tnVariantId }] of tnProductIds) {
                try {
                    let tnVariants = [];
                    let tnPage = 1;
                    let hasMore = true;
                    while (hasMore) {
                        const varRes = yield axios_1.default.get(`https://api.tiendanube.com/v1/${tnIntegration.store_id}/products/${tnProductId}/variants`, { headers: tnHeaders, params: { page: tnPage, per_page: 200 }, validateStatus: () => true });
                        const chunk = varRes.status === 200 && Array.isArray(varRes.data) ? varRes.data : [];
                        tnVariants = tnVariants.concat(chunk);
                        if (chunk.length < 200)
                            hasMore = false;
                        else
                            tnPage++;
                        if (tnPage > 50)
                            hasMore = false;
                    }
                    const tv = tnVariants.find((v) => String(v.id) === String(tnVariantId));
                    if (tv != null && prices[variantId]) {
                        prices[variantId].priceTN = Number((_j = tv.price) !== null && _j !== void 0 ? _j : tv.promotional_price) || 0;
                    }
                }
                catch (_l) {
                    /* ignore */
                }
            }
        }
        const outRows = [];
        for (const pr of productRows) {
            const vars = variantsByProduct.get(pr.product_id) || [];
            const variantIds = vars.map((v) => v.variant_id);
            const fobRaw = fobInfo.byProductId.get(pr.product_id);
            const fob = fobRaw != null && Number.isFinite(fobRaw) ? Number(fobRaw) : null;
            const repMl = vars.find((v) => v.mercado_libre_item_id || v.mercado_libre_id || v.mercado_libre_variant_id);
            const repTn = vars.find((v) => v.tienda_nube_id && v.tienda_nube_variant_id);
            let mlSlice = null;
            if (repMl) {
                const p = prices[repMl.variant_id] || {};
                if (p.priceML != null && p.priceML > 0) {
                    const mlItemId = repMl.mercado_libre_item_id || repMl.mercado_libre_id;
                    const item = (mlItemId && mlItemCache.get(String(mlItemId))) || p.mlItem || {};
                    let listingFee = 0;
                    if (mlToken === null || mlToken === void 0 ? void 0 : mlToken.access_token) {
                        listingFee = yield (0, channelMarginUtils_1.fetchListingSaleFeeAmount)(mlToken.access_token, item, p.priceML, feeCache);
                    }
                    const paymentCpt = (0, channelMarginUtils_1.calcMlPaymentCpt)(p.priceML, mlPaymentCptPercent);
                    const totalMlFee = Math.round((listingFee + paymentCpt) * 100) / 100;
                    mlSlice = Object.assign(Object.assign({}, buildChannelSlice(p.priceML, totalMlFee, fob)), { feeListing: listingFee, feePayment: paymentCpt, linked: true });
                }
                else {
                    mlSlice = { price: 0, fee: 0, margin: null, marginPercent: null, linked: true };
                }
            }
            let tnSlice = null;
            if (repTn) {
                const p = prices[repTn.variant_id] || {};
                if (p.priceTN != null && p.priceTN > 0) {
                    const tnParts = (0, channelMarginUtils_1.calcTnSaleFeeFromPreset)(p.priceTN, tnPreset);
                    tnSlice = Object.assign(Object.assign({}, buildChannelSlice(p.priceTN, tnParts.total, fob)), { feeRate: tnParts.ratePart, feeCpt: tnParts.cptPart, linked: true });
                }
                else {
                    tnSlice = { price: 0, fee: 0, margin: null, marginPercent: null, linked: true };
                }
            }
            outRows.push({
                productId: pr.product_id,
                productName: pr.product_name || '',
                baseSku: pr.base_sku || '',
                variantCount: Number(pr.variant_count) || variantIds.length,
                variantIds,
                fob,
                ml: mlSlice,
                tn: tnSlice,
            });
        }
        res.json({
            config: buildConfigResponse(fobInfo, tnPreset),
            total,
            page,
            limit,
            rows: outRows,
        });
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[getChannelMargins]', msg);
        res.status(500).json({ message: 'Error calculando márgenes', detail: msg });
    }
});
exports.getChannelMargins = getChannelMargins;
function buildConfigResponse(fobInfo, tnPreset) {
    const ivaPercent = Math.round(((0, channelMarginUtils_1.getIvaMultiplier)() - 1) * 10000) / 100;
    return {
        fobListId: fobInfo.id,
        fobListName: fobInfo.name || null,
        ivaPercent,
        tnFeePresetId: tnPreset.id,
        tnFeePresetLabel: tnPreset.label,
        tnFeePresets: (0, channelMarginUtils_1.listTnFeePresets)(),
        mlListingFeeSource: 'API Mercado Libre listing_prices (comisión por vender)',
        mlPaymentCptPercent: (0, channelMarginUtils_1.getMlPaymentCptPercent)(),
        mlPaymentCptSource: 'CPT cobro (Personalizado / transferencia, configurable con LUPOHUB_ML_PAYMENT_CPT_PERCENT)',
    };
}
