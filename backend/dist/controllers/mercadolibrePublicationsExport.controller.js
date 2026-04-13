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
const exportMercadolibrePublicationsXlsx = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    try {
        const mlToken = yield (0, integrations_controller_1.getValidMLToken)();
        if (!mlToken) {
            return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
        }
        const toYmd = (d) => d.toISOString().slice(0, 10);
        const dateTo = new Date();
        const dateFrom = new Date(dateTo);
        dateFrom.setDate(dateFrom.getDate() - ADS_LOOKBACK_DAYS);
        const dateFromStr = toYmd(dateFrom);
        const dateToStr = toYmd(dateTo);
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
                    ventas_ml_suma: 0,
                    variant_ids: new Set(),
                    ml_item_ids: new Set(),
                    permalinks: new Set()
                };
                buckets.set(key, b);
            }
            return b;
        }
        const listingSaleFeeCache = new Map();
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
                const bump = (variationId, skuMl, price, soldQty) => __awaiter(void 0, void 0, void 0, function* () {
                    var _a, _b, _c;
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
                        const soldN = Math.max(0, Math.floor(Number(soldQty) || 0));
                        b.ventas_ml_suma += soldN;
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
                        const sold = Number((_f = v.sold_quantity) !== null && _f !== void 0 ? _f : 0) || 0;
                        yield bump(String(v.id), skuMl, price, sold);
                    }
                }
                else {
                    const skuMl = mlSkuFromItem(item);
                    const price = Number((_g = item.price) !== null && _g !== void 0 ? _g : 0) || 0;
                    const sold = Number((_h = item.sold_quantity) !== null && _h !== void 0 ? _h : 0) || 0;
                    yield bump(null, skuMl, price, sold);
                }
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
            /** Margen neto: precio público ML − comisión venta (listing_prices) − FOB − Product Ads. */
            let ganancia = null;
            if (fobCost != null && Number.isFinite(fobCost)) {
                const g = precioMlProm - comisionMlProm - Number(fobCost) - inversion;
                ganancia = Number.isFinite(g) ? Math.round(g * 100) / 100 : null;
            }
            const linksText = Array.from(agg.permalinks)
                .filter(Boolean)
                .join('; ');
            rowsOut.push({
                codigo: excelCodigoSinPrefijoMl(agg.codigo),
                links_ml: linksText,
                fob: fobCost,
                precio_ml_prom: precioMlProm,
                ventas_ml: agg.ventas_ml_suma,
                comision_ml_prom: comisionMlProm,
                inversion,
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
            'Ventas acumuladas (unid., ML)',
            'Comisión venta ML estimada (ARS, prom.)',
            `Inversión campaña activa (ARS, Product Ads ${dateFromStr}–${dateToStr})`,
            'Margen neto (ARS)'
        ]);
        const noteText = `Solo productos del catálogo con código de artículo (SKU) cargado; publicaciones sin código o sin vínculo con el inventario no se listan. Hasta ${ML_SYNC_MAX_ITEMS} publicaciones ML del vendedor. Código: referencia interna. FOB: lista ` +
            (fobListName ? `"${fobListName}"` : 'con "fob" en el nombre') +
            (fobListIdEnv ? ' (LUPOHUB_FOB_PRICE_LIST_ID).' : '.') +
            ' Ventas: suma de sold_quantity de Mercado Libre por cada publicación/variación vinculada al artículo (histórico acumulado en ML). Comisión venta: API listing_prices (sale_fee_amount). Margen neto = precio ML − comisión ML − FOB − inversión Product Ads. Cargá el FOB en la lista; si falta FOB, el margen queda vacío.';
        ws.addRow([noteText, '', '', '', '', '', '', '']);
        ws.mergeCells(2, 1, 2, 8);
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
                (_j = row.fob) !== null && _j !== void 0 ? _j : '',
                row.precio_ml_prom,
                row.ventas_ml,
                row.comision_ml_prom,
                row.inversion,
                (_k = row.ganancia) !== null && _k !== void 0 ? _k : ''
            ]);
            dataRow.eachCell((cell, colNumber) => {
                cell.font = { name: 'Calibri', size: 11 };
                if (colNumber === 5)
                    cell.numFmt = '#,##0';
                else if ([3, 4, 6, 7, 8].includes(colNumber))
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
            { width: 18 }
        ];
        const buf = yield workbook.xlsx.writeBuffer();
        const filename = `publicaciones_ml_por_articulo_${new Date().toISOString().slice(0, 10)}.xlsx`;
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
