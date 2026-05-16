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
const ML_LINKED = `(
  NULLIF(TRIM(pv.mercado_libre_item_id), '') IS NOT NULL
  OR NULLIF(TRIM(p.mercado_libre_id), '') IS NOT NULL
  OR NULLIF(TRIM(pv.mercado_libre_variant_id), '') IS NOT NULL
  OR EXISTS (SELECT 1 FROM variant_publications vp WHERE vp.variant_id = pv.id AND vp.platform = 'mercadolibre')
)`;
const TN_LINKED = `(
  (NULLIF(TRIM(p.tienda_nube_id), '') IS NOT NULL AND NULLIF(TRIM(pv.tienda_nube_variant_id), '') IS NOT NULL)
  OR EXISTS (SELECT 1 FROM variant_publications vp WHERE vp.variant_id = pv.id AND vp.platform = 'tiendanube')
)`;
function variantChannelWhere(channel) {
    if (channel === 'ml')
        return `AND ${ML_LINKED}`;
    if (channel === 'tn')
        return `AND ${TN_LINKED}`;
    return `AND (${ML_LINKED} OR ${TN_LINKED})`;
}
function trimId(v) {
    return v != null ? String(v).trim() : '';
}
function resolveVariantLinks(v, pubs) {
    const pub = pubs.get(v.variant_id);
    const mlItemId = trimId(v.mercado_libre_item_id) || trimId(v.mercado_libre_id) || trimId(pub === null || pub === void 0 ? void 0 : pub.mlProductId);
    const mlVariationId = trimId(v.mercado_libre_variant_id) || trimId(pub === null || pub === void 0 ? void 0 : pub.mlVariantId) || null;
    const tnProductId = trimId(v.tienda_nube_id) || trimId(pub === null || pub === void 0 ? void 0 : pub.tnProductId);
    const tnVariantId = trimId(v.tienda_nube_variant_id) || trimId(pub === null || pub === void 0 ? void 0 : pub.tnVariantId);
    return {
        mlItemId: mlItemId || null,
        mlVariationId: mlVariationId || null,
        hasMl: !!mlItemId,
        tnProductId: tnProductId || null,
        tnVariantId: tnVariantId || null,
        hasTn: !!(tnProductId && tnVariantId),
    };
}
function loadPublicationLinks(variantIds) {
    return __awaiter(this, void 0, void 0, function* () {
        const map = new Map();
        if (variantIds.length === 0)
            return map;
        const placeholders = variantIds.map(() => '?').join(',');
        const rows = (yield (0, db_1.query)(`SELECT variant_id, platform, external_product_id, external_variant_id
     FROM variant_publications
     WHERE variant_id IN (${placeholders})`, variantIds));
        for (const r of rows || []) {
            if (!map.has(r.variant_id))
                map.set(r.variant_id, {});
            const entry = map.get(r.variant_id);
            const prod = trimId(r.external_product_id);
            const vari = trimId(r.external_variant_id);
            if (r.platform === 'mercadolibre' && prod && !entry.mlProductId) {
                entry.mlProductId = prod;
                entry.mlVariantId = vari;
            }
            if (r.platform === 'tiendanube' && prod && vari && !entry.tnProductId) {
                entry.tnProductId = prod;
                entry.tnVariantId = vari;
            }
        }
        return map;
    });
}
/** GET /integrations/channel-margins — una fila por artículo (producto padre). */
const getChannelMargins = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
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
              COUNT(DISTINCT pv.id) AS variant_count
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
        const linkedVariantRows = (yield (0, db_1.query)(`SELECT pv.id AS variant_id, p.id AS product_id, pv.sku,
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
        const allVariantRows = (yield (0, db_1.query)(`SELECT pv.id AS variant_id, p.id AS product_id
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       WHERE p.id IN (${placeholders})
       ORDER BY p.id, pv.sku`, productIds));
        const allVariantIdsByProduct = new Map();
        for (const v of allVariantRows) {
            if (!allVariantIdsByProduct.has(v.product_id))
                allVariantIdsByProduct.set(v.product_id, []);
            allVariantIdsByProduct.get(v.product_id).push(v.variant_id);
        }
        const pubLinks = yield loadPublicationLinks(linkedVariantRows.map((v) => v.variant_id));
        const mlPaymentCptPercent = (0, channelMarginUtils_1.getMlPaymentCptPercent)();
        const variantsByProduct = new Map();
        for (const v of linkedVariantRows) {
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
        for (const v of linkedVariantRows) {
            prices[v.variant_id] = {};
            const links = resolveVariantLinks(v, pubLinks);
            if (links.mlItemId && (mlToken === null || mlToken === void 0 ? void 0 : mlToken.access_token)) {
                if (!mlItemIds.has(links.mlItemId))
                    mlItemIds.set(links.mlItemId, []);
                mlItemIds.get(links.mlItemId).push({
                    variantId: v.variant_id,
                    variationId: links.mlVariationId,
                });
            }
            if (links.tnProductId && links.tnVariantId) {
                if (!tnProductIds.has(links.tnProductId))
                    tnProductIds.set(links.tnProductId, []);
                tnProductIds.get(links.tnProductId).push({
                    variantId: v.variant_id,
                    tnVariantId: links.tnVariantId,
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
                catch (_l) {
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
            for (const [tnProductId, entries] of tnProductIds) {
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
                    for (const { variantId, tnVariantId } of entries) {
                        const tv = tnVariants.find((x) => String(x.id) === String(tnVariantId));
                        if (tv != null && prices[variantId]) {
                            const raw = (_j = tv.price) !== null && _j !== void 0 ? _j : tv.promotional_price;
                            prices[variantId].priceTN = Number(raw) || 0;
                        }
                    }
                }
                catch (_m) {
                    /* ignore */
                }
            }
        }
        const outRows = [];
        for (const pr of productRows) {
            const vars = variantsByProduct.get(pr.product_id) || [];
            const variantIds = allVariantIdsByProduct.get(pr.product_id) || vars.map((v) => v.variant_id);
            const totalVariants = ((_k = allVariantIdsByProduct.get(pr.product_id)) === null || _k === void 0 ? void 0 : _k.length) ||
                Number(pr.variant_count) ||
                variantIds.length;
            const fobRaw = fobInfo.byProductId.get(pr.product_id);
            const fob = fobRaw != null && Number.isFinite(fobRaw) ? Number(fobRaw) : null;
            const repMl = vars.find((v) => resolveVariantLinks(v, pubLinks).hasMl);
            const repTn = vars.find((v) => {
                const links = resolveVariantLinks(v, pubLinks);
                if (!links.hasTn)
                    return false;
                const p = prices[v.variant_id];
                return (p === null || p === void 0 ? void 0 : p.priceTN) != null && p.priceTN > 0;
            }) || vars.find((v) => resolveVariantLinks(v, pubLinks).hasTn);
            let mlSlice = null;
            if (repMl) {
                const p = prices[repMl.variant_id] || {};
                if (p.priceML != null && p.priceML > 0) {
                    const mlItemId = resolveVariantLinks(repMl, pubLinks).mlItemId;
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
                variantCount: totalVariants,
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
