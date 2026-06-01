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
exports.exportMercadolibrePublicationsXlsx = void 0;
const axios_1 = __importDefault(require("axios"));
const exceljs_1 = __importDefault(require("exceljs"));
const db_1 = require("../database/db");
const integrations_controller_1 = require("./integrations.controller");
const ML_SYNC_MAX_ITEMS = Math.max(100, parseInt(process.env.ML_SYNC_MAX_ITEMS || '5000', 10));
const ADS_LOOKBACK_DAYS = 30;
/** Misma lista que integrations (Product Ads). */
const ML_PADS_METRICS_DEFAULT = 'clicks,prints,ctr,cost,cpc,acos,cvr,roas,sov,direct_amount,indirect_amount,total_amount,units_quantity,direct_units_quantity,indirect_units_quantity,advertising_items_quantity,direct_items_quantity,indirect_items_quantity';
function asYmd(raw) {
    const s = String(raw || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}
/** Para Excel: si el código es un id de publicación ML (MLA…, MLU…), muestra solo la parte numérica; si no, deja el SKU/código tal cual. */
function excelCodigoSinPrefijoMl(raw) {
    const s = String(raw || '').trim();
    const m = s.match(/^ML[A-Z]{1,5}(\d+)$/i);
    if (m)
        return m[1];
    return s;
}
function normalizeSkuForMatch(raw) {
    return (raw !== null && raw !== void 0 ? raw : '')
        .toString()
        .trim()
        .toUpperCase()
        .replace(/[\s\-\/]/g, '');
}
function mlSkuFromVariation(v) {
    var _a, _b, _c, _d;
    const skuAttr = Array.isArray(v === null || v === void 0 ? void 0 : v.attributes)
        ? v.attributes.find((a) => ((a === null || a === void 0 ? void 0 : a.id) || '').toString().toUpperCase() === 'SELLER_SKU')
        : null;
    const fromAttr = skuAttr ? ((_b = (_a = skuAttr.value_name) !== null && _a !== void 0 ? _a : skuAttr.value) !== null && _b !== void 0 ? _b : '').toString().trim() : '';
    const fromFields = ((_d = (_c = v === null || v === void 0 ? void 0 : v.seller_sku) !== null && _c !== void 0 ? _c : v === null || v === void 0 ? void 0 : v.seller_custom_field) !== null && _d !== void 0 ? _d : '').toString().trim();
    return fromAttr || fromFields;
}
function mlSkuFromItem(item) {
    var _a, _b, _c, _d, _e;
    let s = ((_b = (_a = item === null || item === void 0 ? void 0 : item.seller_sku) !== null && _a !== void 0 ? _a : item === null || item === void 0 ? void 0 : item.seller_custom_field) !== null && _b !== void 0 ? _b : '').toString().trim();
    if (!s && Array.isArray(item === null || item === void 0 ? void 0 : item.attributes)) {
        const skuAttr = item.attributes.find((a) => ((a === null || a === void 0 ? void 0 : a.id) || '').toString().toUpperCase() === 'SELLER_SKU');
        s = (skuAttr ? ((_d = (_c = skuAttr.value_name) !== null && _c !== void 0 ? _c : skuAttr.value) !== null && _d !== void 0 ? _d : '') : '').toString().trim();
    }
    if (!s && ((_e = item === null || item === void 0 ? void 0 : item.variations) === null || _e === void 0 ? void 0 : _e.length) === 1) {
        return mlSkuFromVariation(item.variations[0]);
    }
    return s;
}
/** Comisión de venta (`sale_fee_amount`) según API listing_prices de ML; respuesta puede ser array u objeto único. */
function parseListingPricesSaleFee(data, listingTypeId) {
    const lt = (listingTypeId || '').trim();
    const rows = Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : [];
    const match = rows.find((r) => String((r === null || r === void 0 ? void 0 : r.listing_type_id) || '') === lt);
    const row = match !== null && match !== void 0 ? match : rows[0];
    const n = Number(row === null || row === void 0 ? void 0 : row.sale_fee_amount);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}
/**
 * Estima comisión por venta (ARS u otra moneda del ítem) vía GET /sites/{SITE}/listing_prices.
 * Incluye cargo variable de ML por categoría/tipo de publicación; no incluye IVA propio ni retenciones fuera de este cálculo.
 */
function fetchListingSaleFeeAmount(accessToken, item, price, cache) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const siteId = String((item === null || item === void 0 ? void 0 : item.site_id) || '').trim();
        const categoryId = String((item === null || item === void 0 ? void 0 : item.category_id) || '').trim();
        const listingTypeId = String((item === null || item === void 0 ? void 0 : item.listing_type_id) || '').trim();
        const currencyId = String((item === null || item === void 0 ? void 0 : item.currency_id) || '').trim() || 'ARS';
        const logisticType = ((_a = item === null || item === void 0 ? void 0 : item.shipping) === null || _a === void 0 ? void 0 : _a.logistic_type) != null ? String(item.shipping.logistic_type).trim() : '';
        if (!siteId || !listingTypeId || !Number.isFinite(price) || price <= 0)
            return 0;
        const priceRounded = Math.round(price * 100) / 100;
        const cacheKey = `${siteId}|${categoryId}|${listingTypeId}|${priceRounded}|${currencyId}|${logisticType}`;
        if (cache.has(cacheKey))
            return cache.get(cacheKey);
        const params = {
            price: priceRounded,
            listing_type_id: listingTypeId,
            currency_id: currencyId
        };
        if (categoryId)
            params.category_id = categoryId;
        if (logisticType)
            params.logistic_type = logisticType;
        try {
            const res = yield axios_1.default.get(`https://api.mercadolibre.com/sites/${encodeURIComponent(siteId)}/listing_prices`, {
                headers: { Authorization: `Bearer ${accessToken}` },
                params,
                validateStatus: () => true
            });
            if (res.status !== 200) {
                cache.set(cacheKey, 0);
                return 0;
            }
            const fee = parseListingPricesSaleFee(res.data, listingTypeId);
            cache.set(cacheKey, fee);
            return fee;
        }
        catch (_b) {
            cache.set(cacheKey, 0);
            return 0;
        }
    });
}
/**
 * Solo vínculos guardados en LupoHub (variant_publications, mercado_libre_item_id, mercado_libre_id + variación).
 * `itemIdNorm` = normalizeMercadoLibreItemId(id publicación ML).
 */
function resolveHubVariantFromSync(itemIdNorm, variationId, hubByMlItem, hubByMlProduct, pubMap) {
    const vKey = variationId != null && variationId !== '' ? `${itemIdNorm}|${variationId}` : `${itemIdNorm}|`;
    const pub = pubMap.get(vKey);
    if (pub)
        return pub;
    if (variationId != null && variationId !== '') {
        const pub2 = pubMap.get(`${itemIdNorm}|${String(variationId)}`);
        if (pub2)
            return pub2;
    }
    const listItem = hubByMlItem.get(itemIdNorm);
    if ((listItem === null || listItem === void 0 ? void 0 : listItem.length) === 1) {
        const only = listItem[0];
        if (!variationId || !only.mercado_libre_variant_id || String(only.mercado_libre_variant_id) === String(variationId)) {
            return only;
        }
    }
    if (listItem && variationId) {
        const byVar = listItem.find((h) => h.mercado_libre_variant_id && String(h.mercado_libre_variant_id) === String(variationId));
        if (byVar)
            return byVar;
    }
    const listProd = hubByMlProduct.get(itemIdNorm);
    if ((listProd === null || listProd === void 0 ? void 0 : listProd.length) === 1)
        return listProd[0];
    if (listProd && variationId) {
        const byVar = listProd.find((h) => h.mercado_libre_variant_id && String(h.mercado_libre_variant_id) === String(variationId));
        if (byVar)
            return byVar;
    }
    return null;
}
/** Sync primero; si no hay match, intenta por SKU de ML = variante LupoHub. */
function resolveHubVariantFull(itemIdNorm, variationId, skuMlNorm, hubBySku, hubByMlItem, hubByMlProduct, pubMap) {
    const fromSync = resolveHubVariantFromSync(itemIdNorm, variationId, hubByMlItem, hubByMlProduct, pubMap);
    if (fromSync)
        return fromSync;
    if (skuMlNorm) {
        const bySku = hubBySku.get(skuMlNorm);
        if (bySku)
            return bySku;
    }
    return null;
}
/** Suma costo Product Ads por ítem ML, solo campañas con estado active en el período. */
function fetchActiveCampaignProductAdsCostByItem(accessToken, dateFrom, dateTo) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const costByItem = new Map();
        try {
            const advRes = yield axios_1.default.get('https://api.mercadolibre.com/advertising/advertisers', {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'Api-Version': '1'
                },
                params: { product_id: 'PADS' },
                validateStatus: () => true
            });
            if (advRes.status !== 200 || !Array.isArray((_a = advRes.data) === null || _a === void 0 ? void 0 : _a.advertisers)) {
                return costByItem;
            }
            for (const adv of advRes.data.advertisers) {
                const siteId = String(adv.site_id || '').trim();
                const advertiserId = adv.advertiser_id;
                if (!siteId || advertiserId == null)
                    continue;
                const campaigns = [];
                let cOff = 0;
                const cLim = 50;
                while (true) {
                    const url = `https://api.mercadolibre.com/marketplace/advertising/${encodeURIComponent(siteId)}/advertisers/${encodeURIComponent(String(advertiserId))}/product_ads/campaigns/search`;
                    const cr = yield axios_1.default.get(url, {
                        headers: { Authorization: `Bearer ${accessToken}`, 'api-version': '2' },
                        params: {
                            date_from: dateFrom,
                            date_to: dateTo,
                            limit: cLim,
                            offset: cOff,
                            metrics: ML_PADS_METRICS_DEFAULT
                        },
                        validateStatus: () => true
                    });
                    if (cr.status !== 200)
                        break;
                    const batch = ((_b = cr.data) === null || _b === void 0 ? void 0 : _b.results) || [];
                    campaigns.push(...batch);
                    if (batch.length < cLim)
                        break;
                    cOff += cLim;
                    if (cOff > 5000)
                        break;
                }
                const active = campaigns.filter((c) => String(c.status || '').toLowerCase() === 'active');
                for (const camp of active) {
                    const cid = camp.id;
                    let aOff = 0;
                    const aLim = 50;
                    while (true) {
                        const adsUrl = `https://api.mercadolibre.com/marketplace/advertising/${encodeURIComponent(siteId)}/advertisers/${encodeURIComponent(String(advertiserId))}/product_ads/ads/search`;
                        const ar = yield axios_1.default.get(adsUrl, {
                            headers: { Authorization: `Bearer ${accessToken}`, 'api-version': '2' },
                            params: {
                                date_from: dateFrom,
                                date_to: dateTo,
                                limit: aLim,
                                offset: aOff,
                                channel: 'marketplace',
                                metrics: ML_PADS_METRICS_DEFAULT,
                                'filters[campaign_id]': String(cid)
                            },
                            validateStatus: () => true
                        });
                        if (ar.status !== 200)
                            break;
                        const results = ((_c = ar.data) === null || _c === void 0 ? void 0 : _c.results) || [];
                        for (const row of results) {
                            const iid = (0, integrations_controller_1.normalizeMercadoLibreItemId)(row.item_id);
                            const cost = Number((_d = row.metrics) === null || _d === void 0 ? void 0 : _d.cost) || 0;
                            if (!iid)
                                continue;
                            costByItem.set(iid, (costByItem.get(iid) || 0) + cost);
                        }
                        if (results.length < aLim)
                            break;
                        aOff += aLim;
                        if (aOff > 10000)
                            break;
                    }
                }
            }
        }
        catch (e) {
            console.warn('[publications-export] Product Ads costos:', e);
        }
        return costByItem;
    });
}
/** Campañas Product Ads del período (todas) con métricas agregadas por campaña. */
function fetchProductAdsCampaignRows(accessToken, dateFrom, dateTo) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const out = [];
        try {
            const advRes = yield axios_1.default.get('https://api.mercadolibre.com/advertising/advertisers', {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'Api-Version': '1'
                },
                params: { product_id: 'PADS' },
                validateStatus: () => true
            });
            if (advRes.status !== 200 || !Array.isArray((_a = advRes.data) === null || _a === void 0 ? void 0 : _a.advertisers))
                return out;
            for (const adv of advRes.data.advertisers) {
                const siteId = String(adv.site_id || '').trim();
                const advertiserId = String(adv.advertiser_id || '').trim();
                if (!siteId || !advertiserId)
                    continue;
                let offset = 0;
                const limit = 50;
                while (offset < 5000) {
                    const url = `https://api.mercadolibre.com/marketplace/advertising/${encodeURIComponent(siteId)}/advertisers/${encodeURIComponent(advertiserId)}/product_ads/campaigns/search`;
                    const r = yield axios_1.default.get(url, {
                        headers: { Authorization: `Bearer ${accessToken}`, 'api-version': '2' },
                        params: {
                            date_from: dateFrom,
                            date_to: dateTo,
                            limit,
                            offset,
                            metrics: ML_PADS_METRICS_DEFAULT
                        },
                        validateStatus: () => true
                    });
                    if (r.status !== 200)
                        break;
                    const batch = Array.isArray((_b = r.data) === null || _b === void 0 ? void 0 : _b.results) ? r.data.results : [];
                    for (const c of batch) {
                        const m = (c === null || c === void 0 ? void 0 : c.metrics) || {};
                        out.push({
                            site_id: siteId,
                            advertiser_id: advertiserId,
                            campaign_id: String((c === null || c === void 0 ? void 0 : c.id) || ''),
                            campaign_name: String((c === null || c === void 0 ? void 0 : c.name) || ''),
                            status: String((c === null || c === void 0 ? void 0 : c.status) || ''),
                            cost: Number(m.cost) || 0,
                            total_amount: Number(m.total_amount) || 0,
                            roas: Number(m.roas) || 0,
                            acos: Number(m.acos) || 0,
                            clicks: Number(m.clicks) || 0,
                            prints: Number(m.prints) || 0
                        });
                    }
                    if (batch.length < limit)
                        break;
                    offset += limit;
                }
            }
        }
        catch (e) {
            console.warn('[publications-export] Product Ads campañas:', e);
        }
        return out;
    });
}
/**
 * Cuenta ventas (órdenes) por publicación/variación ML en órdenes con estado `paid`
 * creadas en el rango [dateFromYmd, dateToYmd] (inclusive, horario -03:00 como en el resto del backend).
 * Cada orden cuenta 1 por item/variación, aunque quantity sea mayor a 1.
 * Clave: `normalizeMercadoLibreItemId(itemId)|variationId` (variationId vacío si la publicación no tiene variaciones).
 */
function fetchMercadoLibreSalesCountInDateRange(accessToken, sellerUserId, dateFromYmd, dateToYmd) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const map = new Map();
        let offset = 0;
        const limit = 50;
        while (offset < 20000) {
            const res = yield axios_1.default.get('https://api.mercadolibre.com/orders/search', {
                headers: { Authorization: `Bearer ${accessToken}` },
                params: {
                    seller: sellerUserId,
                    'order.status': 'paid',
                    'order.date_created.from': `${dateFromYmd}T00:00:00.000-03:00`,
                    'order.date_created.to': `${dateToYmd}T23:59:59.999-03:00`,
                    offset,
                    limit,
                    sort: 'date_desc'
                },
                validateStatus: () => true
            });
            if (res.status !== 200) {
                console.warn('[publications-export] orders/search ventas:', res.status, ((_a = res.data) === null || _a === void 0 ? void 0 : _a.message) || res.data);
                break;
            }
            const results = Array.isArray((_b = res.data) === null || _b === void 0 ? void 0 : _b.results) ? res.data.results : [];
            for (const order of results) {
                const seenInOrder = new Set();
                for (const line of order.order_items || []) {
                    const iid = (0, integrations_controller_1.normalizeMercadoLibreItemId)((_c = line === null || line === void 0 ? void 0 : line.item) === null || _c === void 0 ? void 0 : _c.id);
                    if (!iid)
                        continue;
                    const rawVid = (_d = line === null || line === void 0 ? void 0 : line.item) === null || _d === void 0 ? void 0 : _d.variation_id;
                    const vid = rawVid != null && String(rawVid).trim() !== '' ? String(rawVid).trim() : '';
                    const k = `${iid}|${vid}`;
                    if (seenInOrder.has(k))
                        continue;
                    seenInOrder.add(k);
                    map.set(k, (map.get(k) || 0) + 1);
                }
            }
            if (results.length < limit)
                break;
            offset += limit;
        }
        return map;
    });
}
const exportMercadolibrePublicationsXlsx = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
    try {
        const mlToken = yield (0, integrations_controller_1.getValidMLToken)();
        if (!mlToken) {
            return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
        }
        const toYmd = (d) => d.toISOString().slice(0, 10);
        const todayYmd = toYmd(new Date());
        const qFrom = asYmd(req.query.from || req.query.desde);
        const qTo = asYmd(req.query.to || req.query.hasta);
        const dateToStr = qTo || todayYmd;
        const dateFromStr = qFrom ||
            (() => {
                const d = new Date();
                d.setDate(d.getDate() - ADS_LOOKBACK_DAYS);
                return toYmd(d);
            })();
        if (dateFromStr > dateToStr) {
            return res.status(400).json({ message: 'Rango inválido: from no puede ser mayor que to' });
        }
        // Ventas usa el mismo período elegido por usuario.
        const salesFromStr = dateFromStr;
        const salesToStr = dateToStr;
        const hubRows = (yield (0, db_1.query)(`
      SELECT pv.id AS variant_id,
             TRIM(COALESCE(pv.external_sku, pv.sku)) AS sku_raw,
             pv.mercado_libre_item_id,
             pv.mercado_libre_variant_id,
             p.id AS product_id,
             p.sku AS product_sku,
             p.name AS product_name,
             p.base_price,
             COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS mayorista_pack_size,
             p.mercado_libre_id,
             COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack_default
      FROM product_variants pv
      JOIN product_colors pc ON pc.id = pv.product_color_id
      JOIN products p ON p.id = pc.product_id
    `));
        const hubBySku = new Map();
        const hubByMlItem = new Map();
        const hubByMlProduct = new Map();
        const variantById = new Map();
        for (const r of hubRows) {
            const skuRaw = (r.sku_raw || '').toString();
            const hv = {
                variant_id: r.variant_id,
                sku_raw: skuRaw,
                sku_norm: normalizeSkuForMatch(skuRaw),
                mercado_libre_item_id: r.mercado_libre_item_id,
                mercado_libre_variant_id: r.mercado_libre_variant_id,
                product_id: r.product_id,
                product_name: (r.product_name || '').toString(),
                base_price: Number((_a = r.base_price) !== null && _a !== void 0 ? _a : 0),
                mayorista_pack_size: Math.max(1, Number(r.mayorista_pack_size) || 1),
                mercado_libre_id: r.mercado_libre_id,
                ml_pack_default: Math.max(1, Number(r.ml_pack_default) || 1)
            };
            variantById.set(r.variant_id, hv);
            if (hv.sku_norm)
                hubBySku.set(hv.sku_norm, hv);
            if (r.mercado_libre_item_id) {
                const k = (0, integrations_controller_1.normalizeMercadoLibreItemId)(r.mercado_libre_item_id);
                if (k) {
                    if (!hubByMlItem.has(k))
                        hubByMlItem.set(k, []);
                    hubByMlItem.get(k).push(hv);
                }
            }
            if (r.mercado_libre_id) {
                const k = (0, integrations_controller_1.normalizeMercadoLibreItemId)(r.mercado_libre_id);
                if (k) {
                    if (!hubByMlProduct.has(k))
                        hubByMlProduct.set(k, []);
                    hubByMlProduct.get(k).push(hv);
                }
            }
        }
        const pubRows = (yield (0, db_1.query)(`SELECT variant_id, external_product_id, external_variant_id, pack_size
       FROM variant_publications WHERE platform = 'mercadolibre'`));
        const pubMap = new Map();
        for (const pr of pubRows) {
            const base = variantById.get(pr.variant_id);
            if (!base)
                continue;
            const extVar = pr.external_variant_id != null && String(pr.external_variant_id).trim() !== ''
                ? String(pr.external_variant_id).trim()
                : '';
            const ep = (0, integrations_controller_1.normalizeMercadoLibreItemId)(pr.external_product_id);
            if (!ep)
                continue;
            const key = `${ep}|${extVar}`;
            pubMap.set(key, Object.assign(Object.assign({}, base), { pub_pack: pr.pack_size != null ? Math.max(1, Number(pr.pack_size) || 1) : null }));
        }
        /** Precio FOB por producto: lista de precios cuyo nombre contiene "fob" (ej. "precios FOB") o env LUPOHUB_FOB_PRICE_LIST_ID. */
        let fobListName = '';
        const fobListIdEnv = (process.env.LUPOHUB_FOB_PRICE_LIST_ID || '').trim();
        let fobListId = null;
        if (fobListIdEnv) {
            const exists = yield (0, db_1.get)('SELECT id, name FROM price_lists WHERE id = ?', [fobListIdEnv]);
            if (exists === null || exists === void 0 ? void 0 : exists.id) {
                fobListId = String(exists.id);
                fobListName = exists.name || '';
            }
        }
        if (!fobListId) {
            const pl = yield (0, db_1.get)(`SELECT id, name FROM price_lists WHERE LOWER(TRIM(name)) LIKE '%fob%' ORDER BY CASE WHEN LOWER(TRIM(name)) = 'precios fob' THEN 0 ELSE 1 END, name LIMIT 1`);
            if (pl === null || pl === void 0 ? void 0 : pl.id) {
                fobListId = String(pl.id);
                fobListName = String(pl.name || '');
            }
        }
        const fobPriceRows = fobListId
            ? (yield (0, db_1.query)(`SELECT product_id, price FROM price_list_items WHERE price_list_id = ?`, [fobListId]))
            : [];
        const fobByProductId = new Map();
        for (const fr of fobPriceRows) {
            fobByProductId.set(String(fr.product_id), Number(fr.price) || 0);
        }
        const productMeta = new Map();
        for (const r of hubRows) {
            if (productMeta.has(r.product_id))
                continue;
            const skuTrim = (r.product_sku || '').trim();
            const codigo = skuTrim || r.product_id;
            productMeta.set(r.product_id, {
                codigo,
                nombre: (r.product_name || '').toString(),
                base_price: Number((_b = r.base_price) !== null && _b !== void 0 ? _b : 0),
                mayorista_pack: Math.max(1, Number(r.mayorista_pack_size) || 1),
                hasCodigo: skuTrim.length > 0
            });
        }
        const costByItemId = yield fetchActiveCampaignProductAdsCostByItem(mlToken.access_token, dateFromStr, dateToStr);
        const productAdsCampaignRows = yield fetchProductAdsCampaignRows(mlToken.access_token, dateFromStr, dateToStr);
        const salesCountByItemVariation = yield fetchMercadoLibreSalesCountInDateRange(mlToken.access_token, String(mlToken.user_id), salesFromStr, salesToStr);
        /** Todas las publicaciones del vendedor (activas, pausadas y cerradas), hasta ML_SYNC_MAX_ITEMS. */
        const seen = new Set();
        const allItemIds = [];
        for (const st of ['active', 'paused', 'closed']) {
            let offset = 0;
            const limit = 100;
            while (allItemIds.length < ML_SYNC_MAX_ITEMS) {
                const itemsRes = yield axios_1.default.get(`https://api.mercadolibre.com/users/${mlToken.user_id}/items/search?status=${st}&offset=${offset}&limit=${limit}`, { headers: { Authorization: `Bearer ${mlToken.access_token}` } });
                const ids = ((_c = itemsRes.data) === null || _c === void 0 ? void 0 : _c.results) || [];
                if (ids.length === 0)
                    break;
                for (const id of ids) {
                    if (seen.has(id))
                        continue;
                    seen.add(id);
                    allItemIds.push(id);
                    if (allItemIds.length >= ML_SYNC_MAX_ITEMS)
                        break;
                }
                if (allItemIds.length >= ML_SYNC_MAX_ITEMS)
                    break;
                if (ids.length < limit)
                    break;
                offset += limit;
            }
        }
        const buckets = new Map();
        function ensureBucket(key, init) {
            let b = buckets.get(key);
            if (!b) {
                b = {
                    codigo: init.codigo,
                    nombre: init.nombre,
                    base_price: init.base_price,
                    mayorista_pack: init.mayorista_pack,
                    ml_prices: [],
                    ml_sale_fees: [],
                    ventas_periodo_suma: 0,
                    variant_ids: new Set(),
                    ml_item_ids: new Set(),
                    permalinks: new Set()
                };
                buckets.set(key, b);
            }
            return b;
        }
        const listingSaleFeeCache = new Map();
        const publicationRows = [];
        const batchSize = 10;
        for (let i = 0; i < allItemIds.length; i += batchSize) {
            const batch = allItemIds.slice(i, i + batchSize);
            const itemPromises = batch.map((itemId) => axios_1.default
                .get(`https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}?include_attributes=all`, {
                headers: { Authorization: `Bearer ${mlToken.access_token}` }
            })
                .then((r) => r.data)
                .catch(() => null));
            const items = yield Promise.all(itemPromises);
            for (const item of items) {
                if (!(item === null || item === void 0 ? void 0 : item.id))
                    continue;
                const itemIdNorm = (0, integrations_controller_1.normalizeMercadoLibreItemId)(String(item.id));
                const bump = (variationId, skuMl, price) => __awaiter(void 0, void 0, void 0, function* () {
                    var _a, _b, _c, _d;
                    const skuNorm = normalizeSkuForMatch(skuMl);
                    const hub = resolveHubVariantFull(itemIdNorm, variationId, skuNorm, hubBySku, hubByMlItem, hubByMlProduct, pubMap);
                    if (hub) {
                        const meta = productMeta.get(hub.product_id);
                        if (!(meta === null || meta === void 0 ? void 0 : meta.hasCodigo))
                            return;
                        const codigo = meta.codigo;
                        const nombre = (_a = meta.nombre) !== null && _a !== void 0 ? _a : hub.product_name;
                        const bp = (_b = meta.base_price) !== null && _b !== void 0 ? _b : hub.base_price;
                        const pk = (_c = meta.mayorista_pack) !== null && _c !== void 0 ? _c : hub.mayorista_pack_size;
                        const key = `p:${hub.product_id}`;
                        const b = ensureBucket(key, {
                            codigo,
                            nombre,
                            base_price: bp,
                            mayorista_pack: pk
                        });
                        const saleFee = yield fetchListingSaleFeeAmount(mlToken.access_token, item, price, listingSaleFeeCache);
                        b.ml_prices.push(price);
                        b.ml_sale_fees.push(saleFee);
                        const vid = variationId != null && String(variationId).trim() !== '' ? String(variationId).trim() : '';
                        const soldKey = `${itemIdNorm}|${vid}`;
                        b.ventas_periodo_suma += (_d = salesCountByItemVariation.get(soldKey)) !== null && _d !== void 0 ? _d : 0;
                        b.variant_ids.add(hub.variant_id);
                        b.ml_item_ids.add(itemIdNorm);
                        const pl = (item.permalink || '').toString().trim();
                        if (pl)
                            b.permalinks.add(pl);
                    }
                });
                if (item.variations && item.variations.length > 0) {
                    for (const v of item.variations) {
                        const skuMl = mlSkuFromVariation(v);
                        const price = Number((_e = (_d = v.price) !== null && _d !== void 0 ? _d : item.price) !== null && _e !== void 0 ? _e : 0) || 0;
                        yield bump(String(v.id), skuMl, price);
                    }
                }
                else {
                    const skuMl = mlSkuFromItem(item);
                    const price = Number((_f = item.price) !== null && _f !== void 0 ? _f : 0) || 0;
                    yield bump(null, skuMl, price);
                }
                let ventasPeriodo = 0;
                let precioActual = Number((_g = item.price) !== null && _g !== void 0 ? _g : 0) || 0;
                if (Array.isArray(item.variations) && item.variations.length > 0) {
                    let sumPrice = 0;
                    for (const v of item.variations) {
                        const vid = String((_h = v === null || v === void 0 ? void 0 : v.id) !== null && _h !== void 0 ? _h : '').trim();
                        const soldKey = `${itemIdNorm}|${vid}`;
                        ventasPeriodo += (_j = salesCountByItemVariation.get(soldKey)) !== null && _j !== void 0 ? _j : 0;
                        sumPrice += Number((_l = (_k = v === null || v === void 0 ? void 0 : v.price) !== null && _k !== void 0 ? _k : item.price) !== null && _l !== void 0 ? _l : 0) || 0;
                    }
                    precioActual = sumPrice > 0 ? sumPrice / item.variations.length : precioActual;
                }
                else {
                    ventasPeriodo = (_m = salesCountByItemVariation.get(`${itemIdNorm}|`)) !== null && _m !== void 0 ? _m : 0;
                }
                const inversionItem = costByItemId.get(itemIdNorm) || 0;
                const comisionUnidad = yield fetchListingSaleFeeAmount(mlToken.access_token, item, precioActual, listingSaleFeeCache);
                const facturacionPeriodo = precioActual * ventasPeriodo;
                const comisionTotal = comisionUnidad * ventasPeriodo;
                const resultadoEstimado = facturacionPeriodo - comisionTotal - inversionItem;
                publicationRows.push({
                    item_id: itemIdNorm,
                    titulo: String(item.title || ''),
                    estado: String(item.status || ''),
                    link: String(item.permalink || ''),
                    precio_actual: Math.round(precioActual * 100) / 100,
                    ventas_unid_periodo: ventasPeriodo,
                    facturacion_periodo: Math.round(facturacionPeriodo * 100) / 100,
                    comision_unidad: Math.round(comisionUnidad * 100) / 100,
                    comision_total: Math.round(comisionTotal * 100) / 100,
                    inversion_ads: Math.round(inversionItem * 100) / 100,
                    resultado_estimado: Math.round(resultadoEstimado * 100) / 100
                });
            }
        }
        const rowsOut = [];
        for (const [key, agg] of buckets) {
            if (agg.ml_prices.length === 0)
                continue;
            const precioMlProm = agg.ml_prices.reduce((a, p) => a + p, 0) / agg.ml_prices.length;
            const comisionMlProm = agg.ml_sale_fees.length > 0 && agg.ml_sale_fees.length === agg.ml_prices.length
                ? agg.ml_sale_fees.reduce((a, f) => a + f, 0) / agg.ml_sale_fees.length
                : 0;
            let fobCost = null;
            if (key.startsWith('p:')) {
                const pid = key.slice(2);
                fobCost = fobByProductId.has(pid) ? fobByProductId.get(pid) : null;
            }
            else {
                fobCost = null;
            }
            let inversion = 0;
            for (const iid of agg.ml_item_ids) {
                inversion += costByItemId.get((0, integrations_controller_1.normalizeMercadoLibreItemId)(iid)) || 0;
            }
            let margenUnidad = null;
            let ganancia = null;
            if (fobCost != null && Number.isFinite(fobCost)) {
                const fobN = Number(fobCost);
                const margenRaw = precioMlProm - comisionMlProm - fobN;
                margenUnidad = Number.isFinite(margenRaw) ? Math.round(margenRaw * 100) / 100 : null;
                const ventasN = Math.max(0, Math.floor(Number(agg.ventas_periodo_suma) || 0));
                const gananciaRaw = margenRaw * ventasN - inversion;
                ganancia = Number.isFinite(gananciaRaw) ? Math.round(gananciaRaw * 100) / 100 : null;
            }
            const linksText = Array.from(agg.permalinks)
                .filter(Boolean)
                .join('; ');
            rowsOut.push({
                codigo: excelCodigoSinPrefijoMl(agg.codigo),
                links_ml: linksText,
                fob: fobCost,
                precio_ml_prom: precioMlProm,
                ventas_periodo: agg.ventas_periodo_suma,
                comision_ml_prom: comisionMlProm,
                inversion,
                margen_unidad: margenUnidad,
                ganancia
            });
        }
        rowsOut.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'es', { numeric: true }));
        const workbook = new exceljs_1.default.Workbook();
        workbook.creator = 'LupoHub';
        workbook.created = new Date();
        const ws = workbook.addWorksheet('Por artículo', {
            views: [{ state: 'frozen', ySplit: 2 }],
            properties: { defaultRowHeight: 18 }
        });
        const fobHeader = fobListName ? `Precio FOB (lista: ${fobListName})` : 'Precio FOB (lista de precios FOB)';
        ws.addRow([
            'Código artículo',
            'Link Mercado Libre',
            fobHeader,
            'Precio Mercado Libre (ARS, prom.)',
            `Ventas ${salesFromStr} a ${salesToStr} (cant. de órdenes pagadas ML)`,
            'Comisión venta ML estimada (ARS, prom.)',
            `Inversión campaña activa (ARS, Product Ads ${dateFromStr}–${dateToStr})`,
            'Margen por unidad (ARS)',
            `Ganancia (${salesFromStr} a ${salesToStr}, ARS)`
        ]);
        const noteText = `Solo productos del catálogo con código de artículo (SKU) cargado; publicaciones sin código o sin vínculo con el inventario no se listan. Hasta ${ML_SYNC_MAX_ITEMS} publicaciones ML del vendedor. Código: referencia interna. FOB: lista ` +
            (fobListName ? `"${fobListName}"` : 'con "fob" en el nombre') +
            (fobListIdEnv ? ' (LUPOHUB_FOB_PRICE_LIST_ID).' : '.') +
            ` Ventas: cantidad de órdenes pagadas entre ${salesFromStr} y ${salesToStr}. Comisión venta: API listing_prices (sale_fee_amount). Margen por unidad = precio ML (prom.) − comisión ML (prom.) − FOB. Ganancia del período = (margen por unidad × ventas del período) − inversión Product Ads. Si falta FOB, margen y ganancia quedan vacíos.`;
        ws.addRow([noteText, '', '', '', '', '', '', '', '']);
        ws.mergeCells(2, 1, 2, 9);
        const note = ws.getRow(2).getCell(1);
        note.font = { italic: true, size: 10, name: 'Calibri', color: { argb: 'FF64748B' } };
        note.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        const headerRow = ws.getRow(1);
        headerRow.font = { bold: true, name: 'Calibri', size: 11 };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF1E40AF' }
        };
        headerRow.eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri', size: 11 };
            cell.alignment = { vertical: 'middle', wrapText: true };
        });
        let rowIdx = 3;
        for (const row of rowsOut) {
            const dataRow = ws.addRow([
                row.codigo,
                row.links_ml,
                (_o = row.fob) !== null && _o !== void 0 ? _o : '',
                row.precio_ml_prom,
                row.ventas_periodo,
                row.comision_ml_prom,
                row.inversion,
                (_p = row.margen_unidad) !== null && _p !== void 0 ? _p : '',
                (_q = row.ganancia) !== null && _q !== void 0 ? _q : ''
            ]);
            dataRow.eachCell((cell, colNumber) => {
                cell.font = { name: 'Calibri', size: 11 };
                if (colNumber === 5)
                    cell.numFmt = '#,##0';
                else if ([3, 4, 6, 7, 8, 9].includes(colNumber))
                    cell.numFmt = '#,##0.00';
            });
            if (rowIdx % 2 === 0) {
                dataRow.eachCell((cell) => {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
                });
            }
            rowIdx++;
        }
        ws.columns = [
            { width: 18 },
            { width: 52 },
            { width: 28 },
            { width: 26 },
            { width: 22 },
            { width: 34 },
            { width: 36 },
            { width: 22 },
            { width: 22 }
        ];
        // Hoja 2: todas las publicaciones de la cuenta (sin exigir vínculo SKU/inventario)
        const wsPub = workbook.addWorksheet('Publicaciones');
        wsPub.views = [{ state: 'frozen', ySplit: 1 }];
        wsPub.columns = [
            { header: 'Item ID', key: 'item_id', width: 16 },
            { header: 'Título', key: 'titulo', width: 42 },
            { header: 'Estado', key: 'estado', width: 14 },
            { header: 'Link', key: 'link', width: 52 },
            { header: 'Precio actual', key: 'precio_actual', width: 16 },
            { header: 'Ventas (órdenes) período', key: 'ventas_unid_periodo', width: 22 },
            { header: 'Facturación período', key: 'facturacion_periodo', width: 18 },
            { header: 'Comisión unid. estimada', key: 'comision_unidad', width: 20 },
            { header: 'Comisión total estimada', key: 'comision_total', width: 20 },
            { header: 'Inversión Ads', key: 'inversion_ads', width: 16 },
            { header: 'Resultado estimado', key: 'resultado_estimado', width: 18 }
        ];
        wsPub.getRow(1).font = { bold: true };
        publicationRows.forEach((r) => wsPub.addRow(r));
        for (let i = 2; i <= wsPub.rowCount; i++) {
            wsPub.getCell(`E${i}`).numFmt = '#,##0.00';
            wsPub.getCell(`F${i}`).numFmt = '#,##0';
            wsPub.getCell(`G${i}`).numFmt = '#,##0.00';
            wsPub.getCell(`H${i}`).numFmt = '#,##0.00';
            wsPub.getCell(`I${i}`).numFmt = '#,##0.00';
            wsPub.getCell(`J${i}`).numFmt = '#,##0.00';
            wsPub.getCell(`K${i}`).numFmt = '#,##0.00';
        }
        // Hoja 3: campañas Product Ads (cuando la API devuelve anunciantes/permisos)
        const wsAds = workbook.addWorksheet('Ads campañas');
        wsAds.views = [{ state: 'frozen', ySplit: 1 }];
        wsAds.columns = [
            { header: 'Site', key: 'site_id', width: 10 },
            { header: 'Advertiser', key: 'advertiser_id', width: 14 },
            { header: 'Campaign ID', key: 'campaign_id', width: 14 },
            { header: 'Campaña', key: 'campaign_name', width: 34 },
            { header: 'Estado', key: 'status', width: 14 },
            { header: 'Inversión', key: 'cost', width: 14 },
            { header: 'Ventas atribuidas', key: 'total_amount', width: 18 },
            { header: 'ROAS', key: 'roas', width: 10 },
            { header: 'ACOS', key: 'acos', width: 10 },
            { header: 'Clicks', key: 'clicks', width: 10 },
            { header: 'Impresiones', key: 'prints', width: 12 }
        ];
        wsAds.getRow(1).font = { bold: true };
        productAdsCampaignRows.forEach((r) => wsAds.addRow(r));
        for (let i = 2; i <= wsAds.rowCount; i++) {
            wsAds.getCell(`F${i}`).numFmt = '#,##0.00';
            wsAds.getCell(`G${i}`).numFmt = '#,##0.00';
            wsAds.getCell(`H${i}`).numFmt = '#,##0.00';
            wsAds.getCell(`I${i}`).numFmt = '#,##0.00';
            wsAds.getCell(`J${i}`).numFmt = '#,##0';
            wsAds.getCell(`K${i}`).numFmt = '#,##0';
        }
        // Hoja 4: resumen ejecutivo de cuenta ML
        const totalFacturacionPub = publicationRows.reduce((acc, r) => acc + (r.facturacion_periodo || 0), 0);
        const totalInversionPub = publicationRows.reduce((acc, r) => acc + (r.inversion_ads || 0), 0);
        const totalResultadoPub = publicationRows.reduce((acc, r) => acc + (r.resultado_estimado || 0), 0);
        const totalVentasUnidPub = publicationRows.reduce((acc, r) => acc + (r.ventas_unid_periodo || 0), 0);
        const totalGananciaArticulos = rowsOut.reduce((acc, r) => acc + (r.ganancia || 0), 0);
        const totalInversionCampanas = productAdsCampaignRows.reduce((acc, r) => acc + (r.cost || 0), 0);
        const totalVentasAtribAds = productAdsCampaignRows.reduce((acc, r) => acc + (r.total_amount || 0), 0);
        const wsResumen = workbook.addWorksheet('Resumen cuenta');
        wsResumen.columns = [{ width: 44 }, { width: 24 }];
        wsResumen.addRow(['Reporte completo Mercado Libre', '']);
        wsResumen.mergeCells(1, 1, 1, 2);
        wsResumen.getCell('A1').font = { bold: true, size: 13 };
        wsResumen.addRow(['Período del reporte', `${dateFromStr} a ${dateToStr}`]);
        wsResumen.addRow(['Publicaciones consideradas', publicationRows.length]);
        wsResumen.addRow(['Ventas (cantidad de órdenes, publicaciones)', totalVentasUnidPub]);
        wsResumen.addRow(['Facturación estimada (publicaciones)', totalFacturacionPub]);
        wsResumen.addRow(['Inversión Ads detectada (publicaciones)', totalInversionPub]);
        wsResumen.addRow(['Resultado estimado (publicaciones)', totalResultadoPub]);
        wsResumen.addRow(['Ganancia estimada por artículo (con FOB)', totalGananciaArticulos]);
        wsResumen.addRow(['Campañas Product Ads', productAdsCampaignRows.length]);
        wsResumen.addRow(['Inversión Product Ads (campañas)', totalInversionCampanas]);
        wsResumen.addRow(['Ventas atribuidas Product Ads (campañas)', totalVentasAtribAds]);
        for (let r = 2; r <= wsResumen.rowCount; r++)
            wsResumen.getCell(`A${r}`).font = { bold: true };
        for (let r = 4; r <= wsResumen.rowCount; r++) {
            if (r === 4)
                wsResumen.getCell(`B${r}`).numFmt = '#,##0';
            else
                wsResumen.getCell(`B${r}`).numFmt = '#,##0.00';
        }
        const buf = yield workbook.xlsx.writeBuffer();
        const filename = `reporte_ml_completo_${dateFromStr}_a_${dateToStr}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(Buffer.from(buf));
    }
    catch (error) {
        console.error('exportMercadolibrePublicationsXlsx:', error);
        res.status(500).json({ message: 'Error generando exportación de Mercado Libre', error: error.message });
    }
});
exports.exportMercadolibrePublicationsXlsx = exportMercadolibrePublicationsXlsx;
