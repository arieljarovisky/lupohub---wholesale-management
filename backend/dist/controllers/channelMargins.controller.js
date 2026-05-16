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
/** GET /integrations/channel-margins?search=&page=1&limit=50&channel=all|ml|tn */
const getChannelMargins = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    try {
        const search = String(req.query.search || '').trim();
        const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
        const limit = Math.min(100, Math.max(10, parseInt(String(req.query.limit || '50'), 10) || 50));
        const channel = String(req.query.channel || 'all').toLowerCase();
        const offset = (page - 1) * limit;
        const channelWhere = channel === 'ml'
            ? `AND (pv.mercado_libre_item_id IS NOT NULL OR p.mercado_libre_id IS NOT NULL OR pv.mercado_libre_variant_id IS NOT NULL)`
            : channel === 'tn'
                ? `AND p.tienda_nube_id IS NOT NULL AND pv.tienda_nube_variant_id IS NOT NULL`
                : `AND (
              pv.mercado_libre_item_id IS NOT NULL OR p.mercado_libre_id IS NOT NULL OR pv.mercado_libre_variant_id IS NOT NULL
              OR (p.tienda_nube_id IS NOT NULL AND pv.tienda_nube_variant_id IS NOT NULL)
            )`;
        const searchWhere = search
            ? `AND (pv.sku LIKE ? OR p.name LIKE ? OR p.sku LIKE ? OR c.name LIKE ?)`
            : '';
        const searchParams = search ? [`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`] : [];
        const countRow = (yield (0, db_1.get)(`SELECT COUNT(*) AS total
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       JOIN colors c ON c.id = pc.color_id
       JOIN sizes s ON s.id = pv.size_id
       WHERE 1=1 ${channelWhere} ${searchWhere}`, searchParams));
        const total = Number((_a = countRow === null || countRow === void 0 ? void 0 : countRow.total) !== null && _a !== void 0 ? _a : 0);
        const rows = (yield (0, db_1.query)(`SELECT pv.id AS variant_id, p.id AS product_id, pv.sku,
              p.name AS product_name, c.name AS color_name, s.size_code,
              p.mercado_libre_id, pv.mercado_libre_item_id, pv.mercado_libre_variant_id,
              p.tienda_nube_id, pv.tienda_nube_variant_id
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       JOIN colors c ON c.id = pc.color_id
       JOIN sizes s ON s.id = pv.size_id
       WHERE 1=1 ${channelWhere} ${searchWhere}
       ORDER BY p.name, pv.sku
       LIMIT ? OFFSET ?`, [...searchParams, limit, offset]));
        const fobInfo = yield (0, channelMarginUtils_1.resolveFobPriceList)();
        const tnPreset = (0, channelMarginUtils_1.resolveTnFeePreset)(String(req.query.tnFeePreset || ''));
        const mlPaymentCptPercent = (0, channelMarginUtils_1.getMlPaymentCptPercent)();
        const ivaPercent = Math.round(((0, channelMarginUtils_1.getIvaMultiplier)() - 1) * 10000) / 100;
        const mlToken = yield (0, integrations_controller_1.getValidMLToken)();
        const feeCache = new Map();
        const mlItemCache = new Map();
        const mlItemIds = new Map();
        const tnProductIds = new Map();
        const variantToTnVariant = new Map();
        const prices = {};
        for (const r of rows) {
            prices[r.variant_id] = {};
            const mlItemId = r.mercado_libre_item_id || r.mercado_libre_id;
            if (mlItemId && (mlToken === null || mlToken === void 0 ? void 0 : mlToken.access_token)) {
                const variationId = r.mercado_libre_variant_id ? String(r.mercado_libre_variant_id) : null;
                if (!mlItemIds.has(mlItemId))
                    mlItemIds.set(mlItemId, []);
                mlItemIds.get(mlItemId).push({ variantId: r.variant_id, variationId });
            }
            if (r.tienda_nube_id && r.tienda_nube_variant_id) {
                if (!tnProductIds.has(r.tienda_nube_id))
                    tnProductIds.set(r.tienda_nube_id, []);
                tnProductIds.get(r.tienda_nube_id).push(r.variant_id);
                variantToTnVariant.set(r.variant_id, String(r.tienda_nube_variant_id));
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
                            const v = variations.find((x) => String(x.id) === String(variationId));
                            priceML = Number((_d = (_c = v === null || v === void 0 ? void 0 : v.price) !== null && _c !== void 0 ? _c : item.price) !== null && _d !== void 0 ? _d : 0);
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
            for (const [productId, vIds] of tnProductIds) {
                try {
                    let tnVariants = [];
                    let tnPage = 1;
                    let hasMore = true;
                    while (hasMore) {
                        const varRes = yield axios_1.default.get(`https://api.tiendanube.com/v1/${tnIntegration.store_id}/products/${productId}/variants`, { headers: tnHeaders, params: { page: tnPage, per_page: 200 }, validateStatus: () => true });
                        const chunk = varRes.status === 200 && Array.isArray(varRes.data) ? varRes.data : [];
                        tnVariants = tnVariants.concat(chunk);
                        if (chunk.length < 200)
                            hasMore = false;
                        else
                            tnPage++;
                        if (tnPage > 50)
                            hasMore = false;
                    }
                    for (const variantId of vIds) {
                        const tnVid = variantToTnVariant.get(variantId);
                        const tv = tnVariants.find((v) => String(v.id) === String(tnVid));
                        if (tv != null && prices[variantId]) {
                            prices[variantId].priceTN = Number((_j = tv.price) !== null && _j !== void 0 ? _j : tv.promotional_price) || 0;
                        }
                    }
                }
                catch (_l) {
                    /* ignore */
                }
            }
        }
        const outRows = [];
        for (const r of rows) {
            const fobRaw = fobInfo.byProductId.get(r.product_id);
            const fob = fobRaw != null && Number.isFinite(fobRaw) ? Number(fobRaw) : null;
            const p = prices[r.variant_id] || {};
            let mlSlice = null;
            const hasMl = !!(r.mercado_libre_item_id || r.mercado_libre_id || r.mercado_libre_variant_id);
            if (hasMl && p.priceML != null && p.priceML > 0) {
                const mlItemId = r.mercado_libre_item_id || r.mercado_libre_id;
                const item = (mlItemId && mlItemCache.get(String(mlItemId))) || p.mlItem || {};
                let listingFee = 0;
                if (mlToken === null || mlToken === void 0 ? void 0 : mlToken.access_token) {
                    listingFee = yield (0, channelMarginUtils_1.fetchListingSaleFeeAmount)(mlToken.access_token, item, p.priceML, feeCache);
                }
                const paymentCpt = (0, channelMarginUtils_1.calcMlPaymentCpt)(p.priceML, mlPaymentCptPercent);
                const totalMlFee = Math.round((listingFee + paymentCpt) * 100) / 100;
                mlSlice = Object.assign(Object.assign({}, buildChannelSlice(p.priceML, totalMlFee, fob)), { feeListing: listingFee, feePayment: paymentCpt, linked: true });
            }
            else if (hasMl) {
                mlSlice = { price: 0, fee: 0, margin: null, marginPercent: null, linked: true };
            }
            let tnSlice = null;
            const hasTn = !!(r.tienda_nube_id && r.tienda_nube_variant_id);
            if (hasTn && p.priceTN != null && p.priceTN > 0) {
                const tnParts = (0, channelMarginUtils_1.calcTnSaleFeeFromPreset)(p.priceTN, tnPreset);
                tnSlice = Object.assign(Object.assign({}, buildChannelSlice(p.priceTN, tnParts.total, fob)), { feeRate: tnParts.ratePart, feeCpt: tnParts.cptPart, linked: true });
            }
            else if (hasTn) {
                tnSlice = { price: 0, fee: 0, margin: null, marginPercent: null, linked: true };
            }
            outRows.push({
                variantId: r.variant_id,
                sku: r.sku || '',
                productId: r.product_id,
                productName: r.product_name || '',
                color: r.color_name || '',
                size: r.size_code || '',
                fob,
                ml: mlSlice,
                tn: tnSlice,
            });
        }
        res.json({
            config: {
                fobListId: fobInfo.id,
                fobListName: fobInfo.name || null,
                ivaPercent,
                tnFeePresetId: tnPreset.id,
                tnFeePresetLabel: tnPreset.label,
                tnFeePresets: (0, channelMarginUtils_1.listTnFeePresets)(),
                mlListingFeeSource: 'API Mercado Libre listing_prices (comisión por vender)',
                mlPaymentCptPercent,
                mlPaymentCptSource: 'CPT cobro (Personalizado / transferencia, configurable con LUPOHUB_ML_PAYMENT_CPT_PERCENT)',
            },
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
