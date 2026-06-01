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
exports.createTiendaNubeProduct = exports.getTiendaNubeProductVariants = exports.getMercadoLibreItemVariations = exports.getMercadoLibreStock = exports.mlColorSizeFromTitle = exports.mlStripTrailingPublicationIndex = exports.mlBaseTitle = exports.getMercadoLibreStockTotals = exports.getMercadoLibreOrders = exports.getMercadoLibreQuestions = exports.emitirNotaCreditoExternalInvoice = exports.getExternalInvoicesHistory = exports.invoiceMercadoLibreOrdersBulk = exports.invoiceTiendaNubeOrdersBulk = exports.getTiendaNubeOrders = exports.getTiendaNubeStockTotals = exports.getTiendaNubeStock = exports.importStockFromMercadoLibre = exports.syncAllStockFromMercadoLibre = exports.getVariantExternalStocks = exports.syncSelectedStockToMercadoLibre = exports.syncAllStockToMercadoLibre = exports.syncSelectedStockToTiendaNube = exports.syncAllStockToTiendaNube = exports.runAutoSyncMLtoTN = exports.handleMercadoLibreWebhook = exports.testMercadoLibreOrder = exports.syncMercadoLibreOrdersFromDate = exports.syncTiendaNubeOrdersFromDate = exports.testTiendaNubeOrder = exports.handleTiendaNubeWebhook = exports.syncProductsFromMercadoLibre = exports.debugMercadoLibreItem = exports.testMercadoLibreConnection = exports.disconnectIntegration = exports.syncSkusToTiendaNube = exports.normalizeColorsInTiendaNube = exports.normalizeSizesInTiendaNube = exports.syncProductsFromTiendaNube = exports.updateMercadoLibreStock = exports.handleTiendaNubeCallback = exports.getTiendaNubeAuthUrl = exports.handleMercadoLibreCallback = exports.getMercadoLibreAuthUrl = exports.getIntegrationStatus = exports.getValidMLToken = exports.resolveMercadoLibreUserProductItems = exports.resolveMercadoLibreCatalogProductItems = exports.mercadoLibreItemIdCandidates = exports.normalizeMercadoLibreItemId = void 0;
exports.getMercadoLibreDisplayAdsCampaigns = exports.getMercadoLibreDisplayAdsAdvertisers = exports.getMercadoLibreBrandAdsCampaigns = exports.getMercadoLibreBrandAdsAdvertisers = exports.getMercadoLibreProductAdsAds = exports.getMercadoLibreProductAdsCampaigns = exports.getMercadoLibreProductAdsAdvertisers = exports.processMLQuestionsAi = exports.saveMLQuestionsAiConfig = exports.getMLQuestionsAiConfig = exports.saveMLAutoMessageConfig = exports.getMLAutoMessageConfig = exports.importProductFromTiendaNube = exports.importProductFromMercadoLibre = exports.duplicateTiendaNubeProduct = void 0;
const axios_1 = __importDefault(require("axios"));
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
const products_controller_1 = require("./products.controller");
const tiendanubeClient_1 = require("../utils/tiendanubeClient");
const mlQuestionsAi = __importStar(require("../services/mlQuestionsAi.service"));
const tiendanubeVariantMerge_service_1 = require("../services/tiendanubeVariantMerge.service");
const colorNameStandard_1 = require("../utils/colorNameStandard");
const skuString_1 = require("../utils/skuString");
const talleStandard_1 = require("../utils/talleStandard");
const ML_AUTH_URL = 'https://auth.mercadolibre.com.ar/authorization';
const ML_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const TN_AUTH_URL = 'https://www.tiendanube.com/apps/authorize';
const TN_TOKEN_URL = 'https://www.tiendanube.com/apps/authorize/token';
const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';
/** Pausa entre requests a Tienda Nube para no superar el límite de solicitudes (configurable con TN_RATE_LIMIT_DELAY_MS, default 800ms). */
const TN_RATE_LIMIT_DELAY_MS = Math.max(0, parseInt(process.env.TN_RATE_LIMIT_DELAY_MS || '800', 10));
/** Máximo de publicaciones a traer al sincronizar con Mercado Libre (evitar timeout). Configurable con ML_SYNC_MAX_ITEMS (default 5000). */
const ML_SYNC_MAX_ITEMS = Math.max(100, parseInt(process.env.ML_SYNC_MAX_ITEMS || '5000', 10));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
/** Normaliza entradas de publicación ML (ID directo, URL o formato con guion, ej. MLAU-123). */
function normalizeMercadoLibreItemId(raw) {
    let s = (raw !== null && raw !== void 0 ? raw : '').toString().trim();
    if (!s)
        return '';
    try {
        s = decodeURIComponent(s);
    }
    catch (_a) { }
    s = s.replace(/\s+/g, '');
    // Si pegan URL: priorizar ID de catálogo /p/MLA... (todos los colores/talles)
    if (/^https?:\/\//i.test(s)) {
        const catalog = s.match(/\/p\/(ML[A-Z]{0,5}-?\d+)/i);
        if (catalog === null || catalog === void 0 ? void 0 : catalog[1]) {
            s = catalog[1];
        }
        else {
            const m = s.match(/\/(ML[A-Z]{0,5}-?\d+)(?:[/?#]|$)/i);
            if (m === null || m === void 0 ? void 0 : m[1])
                s = m[1];
        }
    }
    s = s.toUpperCase();
    // Permitir "MLAU-123456" -> "MLAU123456"
    const mDash = s.match(/^(ML[A-Z]{0,5})-(\d+)$/);
    if (mDash)
        s = `${mDash[1]}${mDash[2]}`;
    // Compat histórico: "ML-123456" -> "MLA123456"
    const legacy = s.match(/^ML-(\d+)$/);
    if (legacy)
        s = `MLA${legacy[1]}`;
    // Solo números: se resolverá en candidates con múltiples sitios.
    return s;
}
exports.normalizeMercadoLibreItemId = normalizeMercadoLibreItemId;
/** Genera candidatos de itemId para tolerar formatos no estándar (ej. MLAU... -> MLA...). */
function mercadoLibreItemIdCandidates(raw) {
    const base = normalizeMercadoLibreItemId(raw);
    if (!base)
        return [];
    // Si llega solo el número, intentar los sitios más comunes.
    if (/^\d+$/.test(base)) {
        const sites = ['MLU', 'MLA', 'MLB', 'MLM', 'MCO', 'MLC', 'MPE', 'MEC', 'MLV'];
        return sites.map((site) => `${site}${base}`);
    }
    const out = [base];
    const m = base.match(/^(ML[A-Z]{2,6})(\d+)$/);
    if (m) {
        const prefix = m[1];
        const num = m[2];
        // Formato canónico ML + 1 letra de sitio (MLA, MLB, MLU, ...)
        if (prefix.length > 3)
            out.push(`${prefix.slice(0, 3)}${num}`);
        // Si vino con un prefijo "expandido" de 4+ letras, probar también ML + última letra.
        // Ej: MLAU123 -> MLU123 (caso real detectado en producción).
        if (prefix.length > 3)
            out.push(`ML${prefix[prefix.length - 1]}${num}`);
        // Caso visto en producción: MLAU######## -> MLA########
        if (prefix === 'MLAU')
            out.push(`MLA${num}`);
    }
    return Array.from(new Set(out.filter(Boolean)));
}
exports.mercadoLibreItemIdCandidates = mercadoLibreItemIdCandidates;
/** Normaliza SKU para matching flexible entre canales (quita separadores y mayúsculas). */
function normalizeSkuForMatch(raw) {
    return (raw !== null && raw !== void 0 ? raw : '')
        .toString()
        .trim()
        .toUpperCase()
        .replace(/[\s\-\/]/g, '');
}
/** Obtiene SKU desde la API de ML cuando en la orden no viene claro. */
function resolveMlOrderItemSku(accessToken, mlItemId, mlVariationId) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    return __awaiter(this, void 0, void 0, function* () {
        try {
            if (!mlItemId)
                return '';
            const itemRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${encodeURIComponent(String(mlItemId))}?include_attributes=all`, { headers: { 'Authorization': `Bearer ${accessToken}` }, validateStatus: () => true });
            if (itemRes.status !== 200 || !itemRes.data)
                return '';
            const item = itemRes.data;
            // 1) Si hay variación, priorizar SKU de esa variación
            if (mlVariationId && Array.isArray(item.variations)) {
                const v = item.variations.find((x) => String(x === null || x === void 0 ? void 0 : x.id) === String(mlVariationId));
                if (v) {
                    const skuAttr = Array.isArray(v.attributes)
                        ? v.attributes.find((a) => ((a === null || a === void 0 ? void 0 : a.id) || '').toString().toUpperCase() === 'SELLER_SKU')
                        : null;
                    const fromVariation = (skuAttr ? ((_b = (_a = skuAttr.value_name) !== null && _a !== void 0 ? _a : skuAttr.value) !== null && _b !== void 0 ? _b : '') : ((_d = (_c = v.seller_sku) !== null && _c !== void 0 ? _c : v.seller_custom_field) !== null && _d !== void 0 ? _d : ''))
                        .toString()
                        .trim();
                    if (fromVariation)
                        return fromVariation;
                }
            }
            // 2) SKU a nivel item
            let sku = ((_f = (_e = item.seller_sku) !== null && _e !== void 0 ? _e : item.seller_custom_field) !== null && _f !== void 0 ? _f : '').toString().trim();
            if (sku)
                return sku;
            // 3) SELLER_SKU en attributes del item
            if (Array.isArray(item.attributes)) {
                const skuAttr = item.attributes.find((a) => ((a === null || a === void 0 ? void 0 : a.id) || '').toString().toUpperCase() === 'SELLER_SKU');
                sku = (skuAttr ? ((_h = (_g = skuAttr.value_name) !== null && _g !== void 0 ? _g : skuAttr.value) !== null && _h !== void 0 ? _h : '') : '').toString().trim();
                if (sku)
                    return sku;
            }
        }
        catch (_j) {
            // ignore: se mantiene fallback actual
        }
        return '';
    });
}
/** Si llega un ID de catálogo (ej. URL /p/MLAU...), intentar resolver a item IDs reales. */
function resolveMercadoLibreCatalogProductItems(productId, accessToken) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const res = yield axios_1.default.get(`https://api.mercadolibre.com/products/${encodeURIComponent(productId)}/items`, {
                headers: { 'Authorization': `Bearer ${accessToken}` },
                validateStatus: () => true
            });
            if (res.status >= 400 || !res.data)
                return [];
            const data = res.data;
            const rows = Array.isArray(data)
                ? data
                : Array.isArray(data === null || data === void 0 ? void 0 : data.results)
                    ? data.results
                    : Array.isArray(data === null || data === void 0 ? void 0 : data.items)
                        ? data.items
                        : [];
            const itemIds = rows
                .map((row) => {
                var _a;
                if (typeof row === 'string')
                    return row;
                if (row === null || row === void 0 ? void 0 : row.id)
                    return row.id;
                if (row === null || row === void 0 ? void 0 : row.item_id)
                    return row.item_id;
                if ((_a = row === null || row === void 0 ? void 0 : row.item) === null || _a === void 0 ? void 0 : _a.id)
                    return row.item.id;
                return '';
            })
                .filter(Boolean);
            return Array.from(new Set(itemIds.flatMap((id) => mercadoLibreItemIdCandidates(id))));
        }
        catch (_a) {
            return [];
        }
    });
}
exports.resolveMercadoLibreCatalogProductItems = resolveMercadoLibreCatalogProductItems;
/** Resuelve IDs de item a partir de un user_product_id (ej. MLAU...). */
function resolveMercadoLibreUserProductItems(userProductId, sellerId, accessToken) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const up = (userProductId || '').toString().trim();
        const perStatus = {
            active: { hits: 0, pages: 0, failedRequests: 0 },
            paused: { hits: 0, pages: 0, failedRequests: 0 },
            closed: { hits: 0, pages: 0, failedRequests: 0 },
        };
        if (!up) {
            return {
                itemCandidates: [],
                debug: {
                    requestedUserProductId: up,
                    sellerId: String(sellerId),
                    perStatus,
                    rawItemIds: [],
                    candidateItemIds: [],
                },
            };
        }
        try {
            const allIds = [];
            const seen = new Set();
            const statuses = ['active', 'paused', 'closed'];
            const pageLimit = 100;
            for (const st of statuses) {
                let offset = 0;
                while (offset < 5000) {
                    const res = yield axios_1.default.get(`https://api.mercadolibre.com/users/${encodeURIComponent(String(sellerId))}/items/search`, {
                        headers: { 'Authorization': `Bearer ${accessToken}` },
                        params: { user_product_id: up, status: st, limit: pageLimit, offset },
                        validateStatus: () => true
                    });
                    perStatus[st].pages += 1;
                    if (res.status >= 400 || !res.data) {
                        perStatus[st].failedRequests += 1;
                        break;
                    }
                    const rows = Array.isArray((_a = res.data) === null || _a === void 0 ? void 0 : _a.results) ? res.data.results : [];
                    perStatus[st].hits += rows.length;
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
            const itemCandidates = Array.from(new Set(allIds.flatMap((id) => mercadoLibreItemIdCandidates(id))));
            return {
                itemCandidates,
                debug: {
                    requestedUserProductId: up,
                    sellerId: String(sellerId),
                    perStatus,
                    rawItemIds: allIds,
                    candidateItemIds: itemCandidates,
                },
            };
        }
        catch (_b) {
            return {
                itemCandidates: [],
                debug: {
                    requestedUserProductId: up,
                    sellerId: String(sellerId),
                    perStatus,
                    rawItemIds: [],
                    candidateItemIds: [],
                },
            };
        }
    });
}
exports.resolveMercadoLibreUserProductItems = resolveMercadoLibreUserProductItems;
/** Extrae filas de variación desde un ítem ML (con o sin array item.variations). */
function extractMlVariationsFromItemData(it) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    if (!it || it.error)
        return [];
    const out = [];
    if (Array.isArray(it.variations) && it.variations.length > 0) {
        for (const v of it.variations) {
            const skuAttr = Array.isArray(v.attributes) && v.attributes.find((a) => (a.id || '').toString().toUpperCase() === 'SELLER_SKU');
            const skuFromAttr = skuAttr ? ((_b = (_a = skuAttr.value_name) !== null && _a !== void 0 ? _a : skuAttr.value) !== null && _b !== void 0 ? _b : '').toString().trim() : '';
            const sku = skuFromAttr || ((_d = (_c = v.seller_sku) !== null && _c !== void 0 ? _c : v.seller_custom_field) !== null && _d !== void 0 ? _d : '').toString().trim();
            let color = '';
            let size = '';
            (v.attribute_combinations || []).forEach((attr) => {
                const id = (attr.id || '').toString().toUpperCase();
                const name = (attr.value_name || attr.name || '').toString().trim();
                if (id === 'COLOR' || id === 'COLOUR' || id === 'COR')
                    color = name;
                if (id === 'SIZE' || id === 'SIZE_TYPE' || id === 'TALLE' || id === 'Talla')
                    size = name;
            });
            out.push({
                variationId: String(v.id),
                sku,
                color,
                size,
                stock: v.available_quantity || 0
            });
        }
        return out;
    }
    const attrs = Array.isArray(it.attributes) ? it.attributes : [];
    const skuAttr = attrs.find((a) => ((a === null || a === void 0 ? void 0 : a.id) || '').toString().toUpperCase() === 'SELLER_SKU');
    const sku = ((_f = (_e = it.seller_sku) !== null && _e !== void 0 ? _e : it.seller_custom_field) !== null && _f !== void 0 ? _f : (skuAttr ? ((_h = (_g = skuAttr.value_name) !== null && _g !== void 0 ? _g : skuAttr.value) !== null && _h !== void 0 ? _h : '') : '')).toString().trim();
    const colorAttr = attrs.find((a) => ['COLOR', 'COLOUR', 'COR'].includes(((a === null || a === void 0 ? void 0 : a.id) || '').toString().toUpperCase()));
    const sizeAttr = attrs.find((a) => ['SIZE', 'SIZE_TYPE', 'TALLE', 'TALLA'].includes(((a === null || a === void 0 ? void 0 : a.id) || '').toString().toUpperCase()));
    const parsed = mlColorSizeFromTitle((it.title || '').toString().trim());
    out.push({
        variationId: String(it.id),
        sku,
        color: (colorAttr ? ((_k = (_j = colorAttr.value_name) !== null && _j !== void 0 ? _j : colorAttr.value) !== null && _k !== void 0 ? _k : '') : parsed.color).toString().trim(),
        size: (sizeAttr ? ((_m = (_l = sizeAttr.value_name) !== null && _l !== void 0 ? _l : sizeAttr.value) !== null && _m !== void 0 ? _m : '') : parsed.size).toString().trim(),
        stock: it.available_quantity || 0
    });
    return out;
}
/** ID de producto de catálogo (/p/MLA...) desde el permalink del ítem. */
function catalogProductIdFromMercadoLibreItem(item) {
    var _a;
    const link = ((_a = item === null || item === void 0 ? void 0 : item.permalink) !== null && _a !== void 0 ? _a : '').toString();
    const m = link.match(/\/p\/(ML[A-Z]{0,5}-?\d+)/i);
    return (m === null || m === void 0 ? void 0 : m[1]) ? normalizeMercadoLibreItemId(m[1]) : '';
}
/** Reúne IDs de publicaciones ML asociadas (UP, catálogo /p/MLA..., ítem resuelto). */
function gatherMercadoLibreItemIdsForAllVariations(opts) {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function* () {
        const seen = new Set();
        const add = (id) => {
            const s = String(id || '').trim();
            if (!s)
                return;
            for (const c of mercadoLibreItemIdCandidates(s))
                seen.add(c);
        };
        if (opts.resolvedItemId)
            add(opts.resolvedItemId);
        for (const id of opts.preloadedCatalogIds || [])
            add(id);
        for (const id of opts.preloadedUserProductIds || [])
            add(id);
        const catalogProductIds = new Set();
        catalogProductIds.add(opts.requestedRaw);
        catalogProductIds.add(opts.requestedNormalized);
        const catalogFromItem = opts.item ? catalogProductIdFromMercadoLibreItem(opts.item) : '';
        if (catalogFromItem)
            catalogProductIds.add(catalogFromItem);
        for (const c of mercadoLibreItemIdCandidates(opts.requestedRaw)) {
            if (/^MLA\d+$/i.test(c))
                catalogProductIds.add(c);
        }
        const mUp = opts.requestedNormalized.match(/^MLAU(\d+)$/i);
        if (mUp)
            catalogProductIds.add(`MLA${mUp[1]}`);
        const mLa = opts.requestedNormalized.match(/^MLA(\d+)$/i);
        if (mLa)
            catalogProductIds.add(`MLAU${mLa[1]}`);
        for (const pid of catalogProductIds) {
            const catIds = yield resolveMercadoLibreCatalogProductItems(pid, opts.accessToken);
            for (const id of catIds)
                add(id);
        }
        const userProductIds = new Set();
        if (opts.shouldResolveAsUserProduct)
            userProductIds.add(opts.requestedNormalized);
        const upFromItem = ((_b = (_a = opts.item) === null || _a === void 0 ? void 0 : _a.user_product_id) !== null && _b !== void 0 ? _b : '').toString().trim();
        if (/^MLAU\d+$/i.test(upFromItem))
            userProductIds.add(upFromItem);
        if (mLa)
            userProductIds.add(`MLAU${mLa[1]}`);
        if (mUp)
            userProductIds.add(opts.requestedNormalized);
        for (const upId of userProductIds) {
            const upResolved = yield resolveMercadoLibreUserProductItems(upId, opts.sellerId, opts.accessToken);
            for (const id of upResolved.itemCandidates)
                add(id);
        }
        if (opts.item) {
            const siblingIds = yield findMercadoLibreSiblingListingIds(opts.item, opts.sellerId, opts.accessToken);
            for (const id of siblingIds)
                add(id);
            const familyName = mlFamilyNameFromItem(opts.item);
            if (familyName) {
                const familyIds = yield resolveMercadoLibreItemsByFamilyName(familyName, opts.sellerId, opts.accessToken);
                for (const id of familyIds)
                    add(id);
            }
            const skuPrefixes = new Set();
            for (const sku of collectMercadoLibreItemSkus(opts.item)) {
                const prefix = extractArticlePrefixFromMlSku(sku);
                if (prefix)
                    skuPrefixes.add(prefix);
            }
            for (const prefix of skuPrefixes) {
                const skuIds = yield resolveMercadoLibreItemsByArticlePrefix(prefix, opts.sellerId, opts.accessToken);
                for (const id of skuIds)
                    add(id);
            }
        }
        return Array.from(seen).slice(0, 120);
    });
}
/** Agrega variaciones de varias publicaciones ML (todos los colores/talles). */
function aggregateMercadoLibreVariationsFromItemIds(itemIds, accessToken) {
    return __awaiter(this, void 0, void 0, function* () {
        const byVariationId = {};
        for (const candidate of itemIds) {
            try {
                const itemRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${candidate}?include_attributes=all`, {
                    headers: { Authorization: `Bearer ${accessToken}` }
                });
                for (const row of extractMlVariationsFromItemData(itemRes === null || itemRes === void 0 ? void 0 : itemRes.data)) {
                    byVariationId[row.variationId] = row;
                }
            }
            catch (_a) {
                // ignorar ítem inválido
            }
        }
        return Object.values(byVariationId);
    });
}
/** Publicaciones del mismo vendedor con el mismo título base (un listing por talle/color). */
function findMercadoLibreSiblingListingIds(item, sellerId, accessToken) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const baseTitle = mlBaseTitle(((item === null || item === void 0 ? void 0 : item.title) || '').toString().trim());
        const baseTitleLoose = mlStripTrailingPublicationIndex(baseTitle);
        if (!baseTitle)
            return [];
        const siblingIds = [];
        const seen = new Set();
        const pageLimit = 50;
        for (const status of ['active', 'paused']) {
            let offset = 0;
            while (offset < 500) {
                const searchRes = yield axios_1.default.get(`https://api.mercadolibre.com/users/${encodeURIComponent(String(sellerId))}/items/search`, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    params: { q: baseTitleLoose || baseTitle, limit: pageLimit, offset, status },
                    validateStatus: () => true
                });
                const rows = searchRes.status === 200 && Array.isArray((_a = searchRes.data) === null || _a === void 0 ? void 0 : _a.results)
                    ? searchRes.data.results.map((x) => String(x || '').trim()).filter(Boolean)
                    : [];
                for (const id of rows) {
                    if (!seen.has(id)) {
                        seen.add(id);
                        siblingIds.push(id);
                    }
                }
                if (rows.length < pageLimit)
                    break;
                offset += pageLimit;
            }
        }
        const unique = Array.from(new Set(siblingIds));
        return unique.filter((sid) => {
            // Se valida título al extraer variaciones; aquí solo limitamos cantidad.
            return sid && sid !== String((item === null || item === void 0 ? void 0 : item.id) || '');
        }).slice(0, 120);
    });
}
function mlFamilyNameFromItem(item) {
    var _a;
    return String((_a = item === null || item === void 0 ? void 0 : item.family_name) !== null && _a !== void 0 ? _a : '').trim();
}
/** Prefijo de artículo Lupo/Tango desde SKU (ej. 24650150542 → 24650, 24650-130-280 → 24650). */
function extractArticlePrefixFromMlSku(sku) {
    const s = String(sku || '').trim();
    if (!s)
        return null;
    const dashHead = s.split('-')[0];
    if (/^\d{4,7}$/.test(dashHead))
        return dashHead;
    const digits = s.replace(/\D/g, '');
    if (digits.length >= 11)
        return digits.slice(0, 5);
    if (digits.length >= 8)
        return digits.slice(0, 5);
    if (/^\d{4,7}$/.test(digits))
        return digits;
    return null;
}
function collectMercadoLibreItemSkus(it) {
    var _a, _b;
    const out = new Set();
    const add = (v) => {
        const t = String(v !== null && v !== void 0 ? v : '').trim();
        if (t)
            out.add(t);
    };
    add(it === null || it === void 0 ? void 0 : it.seller_sku);
    add(it === null || it === void 0 ? void 0 : it.seller_custom_field);
    const attrs = Array.isArray(it === null || it === void 0 ? void 0 : it.attributes) ? it.attributes : [];
    const skuAttr = attrs.find((a) => ((a === null || a === void 0 ? void 0 : a.id) || '').toString().toUpperCase() === 'SELLER_SKU');
    if (skuAttr)
        add((_a = skuAttr.value_name) !== null && _a !== void 0 ? _a : skuAttr.value);
    if (Array.isArray(it === null || it === void 0 ? void 0 : it.variations)) {
        for (const v of it.variations) {
            add(v === null || v === void 0 ? void 0 : v.seller_sku);
            add(v === null || v === void 0 ? void 0 : v.seller_custom_field);
            const vAttr = Array.isArray(v === null || v === void 0 ? void 0 : v.attributes) && v.attributes.find((a) => (a.id || '').toUpperCase() === 'SELLER_SKU');
            if (vAttr)
                add((_b = vAttr.value_name) !== null && _b !== void 0 ? _b : vAttr.value);
        }
    }
    return [...out];
}
/** Busca publicaciones del vendedor paginando /items/search. */
function searchMercadoLibreSellerItems(sellerId, accessToken, params, maxResults = 200) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const seen = new Set();
        const out = [];
        const pageLimit = 50;
        let offset = 0;
        while (out.length < maxResults && offset < 5000) {
            const res = yield axios_1.default.get(`https://api.mercadolibre.com/users/${encodeURIComponent(String(sellerId))}/items/search`, {
                headers: { Authorization: `Bearer ${accessToken}` },
                params: Object.assign(Object.assign({}, params), { limit: pageLimit, offset }),
                validateStatus: () => true
            });
            if (res.status >= 400 || !res.data)
                break;
            const rows = Array.isArray((_a = res.data) === null || _a === void 0 ? void 0 : _a.results) ? res.data.results : [];
            for (const x of rows) {
                const id = String(x || '').trim();
                if (!id || seen.has(id))
                    continue;
                seen.add(id);
                out.push(id);
            }
            if (rows.length < pageLimit)
                break;
            offset += pageLimit;
        }
        return out;
    });
}
/** Publicaciones hermanas por family_name (User Product / catálogo ML). */
function resolveMercadoLibreItemsByFamilyName(familyName, sellerId, accessToken) {
    return __awaiter(this, void 0, void 0, function* () {
        const fn = String(familyName || '').trim();
        if (!fn)
            return [];
        const statuses = ['active', 'paused'];
        const seen = new Set();
        const out = [];
        for (const st of statuses) {
            const ids = yield searchMercadoLibreSellerItems(sellerId, accessToken, { q: fn, status: st }, 120);
            for (const id of ids) {
                if (seen.has(id))
                    continue;
                seen.add(id);
                out.push(id);
            }
        }
        return out.slice(0, 120);
    });
}
/** Publicaciones del mismo artículo por prefijo de SKU (24650 → 24650130542, 24650140542…). */
function resolveMercadoLibreItemsByArticlePrefix(prefix, sellerId, accessToken) {
    return __awaiter(this, void 0, void 0, function* () {
        const p = String(prefix || '').trim().replace(/\D/g, '');
        if (!p || p.length < 4)
            return [];
        const searchIds = yield searchMercadoLibreSellerItems(sellerId, accessToken, { q: p, status: 'active' }, 200);
        const prefixLoose = p.replace(/^0+/, '') || p;
        const matched = [];
        const seen = new Set();
        for (const id of searchIds) {
            if (seen.has(id))
                continue;
            seen.add(id);
            try {
                const r = yield axios_1.default.get(`https://api.mercadolibre.com/items/${id}?include_attributes=all`, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    validateStatus: () => true
                });
                const it = r.data;
                if (!(it === null || it === void 0 ? void 0 : it.id))
                    continue;
                const skus = collectMercadoLibreItemSkus(it);
                const hit = skus.some((s) => {
                    const d = s.replace(/\D/g, '');
                    return d.startsWith(p) || d.startsWith(prefixLoose) || s.startsWith(p) || s.startsWith(prefixLoose);
                });
                if (hit)
                    matched.push(String(it.id));
            }
            catch (_a) {
                // ignorar ítem inválido
            }
        }
        return matched.slice(0, 120);
    });
}
/** PUT a Tienda Nube con reintentos ante 429 (Too Many Requests). */
function putTnVariantWithRetry(url, body, headers, maxRetries = 2) {
    return __awaiter(this, void 0, void 0, function* () {
        yield (0, tiendanubeClient_1.tnPutWithRetry)(axios_1.default, url, body, { headers }, {
            maxRetries: Math.max(0, maxRetries),
            // minIntervalMs se resuelve dentro del helper desde env TN_RATE_LIMIT_DELAY_MS
        });
    });
}
/** URL del frontend para redirigir después del OAuth (producción: tu dominio Vercel). */
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
// Función para obtener un token válido de Mercado Libre (refresca automáticamente si expiró)
function getValidMLToken() {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const integration = yield (0, db_1.get)(`SELECT access_token, refresh_token, expires_at, user_id FROM integrations WHERE platform = 'mercadolibre'`);
        if (!integration) {
            return null;
        }
        const now = new Date();
        const expiresAt = new Date(integration.expires_at);
        // Si el token expira en menos de 10 minutos, refrescarlo
        const bufferTime = 10 * 60 * 1000; // 10 minutos
        if (expiresAt.getTime() - now.getTime() < bufferTime) {
            console.log('[ML Token] Token expirando pronto, refrescando...');
            const appId = process.env.MERCADO_LIBRE_APP_ID;
            const clientSecret = process.env.MERCADO_LIBRE_CLIENT_SECRET;
            if (!appId || !clientSecret || !integration.refresh_token) {
                console.error('[ML Token] No se puede refrescar: faltan credenciales o refresh_token');
                return null;
            }
            try {
                const response = yield axios_1.default.post(ML_TOKEN_URL, {
                    grant_type: 'refresh_token',
                    client_id: appId,
                    client_secret: clientSecret,
                    refresh_token: integration.refresh_token
                });
                const { access_token, refresh_token, expires_in } = response.data;
                const newExpiresAt = new Date(Date.now() + expires_in * 1000);
                // Actualizar en la base de datos
                yield (0, db_1.execute)(`
        UPDATE integrations 
        SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE platform = 'mercadolibre'
      `, [access_token, refresh_token, newExpiresAt]);
                console.log('[ML Token] Token refrescado exitosamente, expira:', newExpiresAt);
                return { access_token, user_id: integration.user_id };
            }
            catch (error) {
                console.error('[ML Token] Error refrescando token:', ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
                return null;
            }
        }
        return { access_token: integration.access_token, user_id: integration.user_id };
    });
}
exports.getValidMLToken = getValidMLToken;
const getIntegrationStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const integrations = yield (0, db_1.query)('SELECT platform, store_id, user_id FROM integrations');
        const tn = integrations.find((i) => i.platform === 'tiendanube');
        const status = {
            mercadolibre: integrations.find((i) => i.platform === 'mercadolibre') ? true : false,
            tiendanube: !!tn,
            tiendanubeStoreId: ((tn === null || tn === void 0 ? void 0 : tn.store_id) || (tn === null || tn === void 0 ? void 0 : tn.user_id)) || null,
        };
        res.json(status);
    }
    catch (error) {
        console.error('Error getting integration status:', error);
        res.status(500).json({ message: 'Error getting integration status' });
    }
});
exports.getIntegrationStatus = getIntegrationStatus;
// Mercado Libre
const getMercadoLibreAuthUrl = (req, res) => {
    const appId = process.env.MERCADO_LIBRE_APP_ID;
    // Use HTTPS for ngrok or production, but allow env override
    const redirectUri = process.env.MERCADO_LIBRE_REDIRECT_URI || 'https://dignifiedly-overgifted-ellsworth.ngrok-free.dev/api/integrations/mercadolibre/callback';
    if (!appId) {
        return res.status(500).json({ message: 'Mercado Libre App ID not configured' });
    }
    const url = `${ML_AUTH_URL}?response_type=code&client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}`;
    res.json({ url });
};
exports.getMercadoLibreAuthUrl = getMercadoLibreAuthUrl;
const handleMercadoLibreCallback = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const { code } = req.query;
    const appId = process.env.MERCADO_LIBRE_APP_ID;
    const clientSecret = process.env.MERCADO_LIBRE_CLIENT_SECRET;
    const redirectUri = process.env.MERCADO_LIBRE_REDIRECT_URI || 'https://dignifiedly-overgifted-ellsworth.ngrok-free.dev/api/integrations/mercadolibre/callback';
    if (!code || !appId || !clientSecret) {
        return res.status(400).send('Missing code or configuration');
    }
    try {
        const response = yield axios_1.default.post(ML_TOKEN_URL, {
            grant_type: 'authorization_code',
            client_id: appId,
            client_secret: clientSecret,
            code,
            redirect_uri: redirectUri,
        });
        const { access_token, refresh_token, expires_in, user_id } = response.data;
        // Calculate expiration time
        const expiresAt = new Date(Date.now() + expires_in * 1000);
        // Save or update token
        yield (0, db_1.execute)(`
      INSERT INTO integrations (platform, access_token, refresh_token, expires_at, user_id)
      VALUES ('mercadolibre', ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      access_token = VALUES(access_token),
      refresh_token = VALUES(refresh_token),
      expires_at = VALUES(expires_at),
      user_id = VALUES(user_id),
      updated_at = CURRENT_TIMESTAMP
    `, [access_token, refresh_token, expiresAt, user_id]);
        // Redirect to frontend settings page with success
        res.redirect(`${FRONTEND_URL}/#settings?status=success&platform=mercadolibre`);
    }
    catch (error) {
        console.error('Error in Mercado Libre callback:', ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
        res.redirect(`${FRONTEND_URL}/#settings?status=error&platform=mercadolibre`);
    }
});
exports.handleMercadoLibreCallback = handleMercadoLibreCallback;
// Tienda Nube
const getTiendaNubeAuthUrl = (req, res) => {
    const appId = process.env.TIENDA_NUBE_APP_ID;
    if (!appId) {
        return res.status(500).json({ message: 'Tienda Nube App ID not configured' });
    }
    // Scope read_orders es necesario para poder obtener el detalle de la orden cuando llega el webhook order/paid y descontar stock
    const redirectUri = process.env.TIENDA_NUBE_REDIRECT_URI || 'http://localhost:3010/api/integrations/tiendanube/callback';
    const url = `https://www.tiendanube.com/apps/${appId}/authorize?response_type=code&scope=write_products,read_products,read_orders&redirect_uri=${encodeURIComponent(redirectUri)}`;
    res.json({ url });
};
exports.getTiendaNubeAuthUrl = getTiendaNubeAuthUrl;
const handleTiendaNubeCallback = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _b, _c, _d, _e, _f, _g, _h;
    const { code } = req.query;
    const appId = process.env.TIENDA_NUBE_APP_ID;
    const clientSecret = process.env.TIENDA_NUBE_CLIENT_SECRET;
    const redirectUri = process.env.TIENDA_NUBE_REDIRECT_URI || 'http://localhost:3010/api/integrations/tiendanube/callback';
    if (!code || !appId || !clientSecret) {
        return res.status(400).send('Missing code or configuration');
    }
    try {
        const response = yield axios_1.default.post(TN_TOKEN_URL, {
            client_id: appId,
            client_secret: clientSecret,
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri
        });
        const { access_token, user_id, scope } = response.data;
        // Tienda Nube tokens might not expire in the same way, or they might. The response usually has expires_in.
        // If not provided, we assume it's long-lived or handled differently.
        // Let's assume standard OAuth 2.0.
        const expires_in = response.data.expires_in || 31536000; // Default to 1 year if not provided
        const expiresAt = new Date(Date.now() + expires_in * 1000);
        // En Tienda Nube, user_id es el store_id
        yield (0, db_1.execute)(`
      INSERT INTO integrations (platform, access_token, refresh_token, expires_at, user_id, store_id)
      VALUES ('tiendanube', ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      access_token = VALUES(access_token),
      refresh_token = VALUES(refresh_token),
      expires_at = VALUES(expires_at),
      user_id = VALUES(user_id),
      store_id = VALUES(store_id),
      updated_at = CURRENT_TIMESTAMP
    `, [access_token, response.data.refresh_token || null, expiresAt, user_id, user_id]);
        // Registrar webhooks: order/paid (descontar stock) y order/cancelled (restaurar stock)
        const backendUrl = (process.env.BACKEND_URL || process.env.API_URL || '').replace(/\/$/, '');
        if (backendUrl && backendUrl.startsWith('https://')) {
            const webhookUrl = `${backendUrl}/api/integrations/tiendanube/webhook`;
            const webhookEvents = ['order/paid', 'order/cancelled'];
            for (const ev of webhookEvents) {
                try {
                    yield axios_1.default.post(`https://api.tiendanube.com/v1/${user_id}/webhooks`, { event: ev, url: webhookUrl }, { headers: { 'Authentication': `bearer ${access_token}`, 'User-Agent': TN_USER_AGENT } });
                    console.log(`[TN] Webhook ${ev} registrado:`, webhookUrl);
                }
                catch (whErr) {
                    const msg = ((_d = (_c = (_b = whErr.response) === null || _b === void 0 ? void 0 : _b.data) === null || _c === void 0 ? void 0 : _c.url) === null || _d === void 0 ? void 0 : _d[0]) || ((_g = (_f = (_e = whErr.response) === null || _e === void 0 ? void 0 : _e.data) === null || _f === void 0 ? void 0 : _f.event) === null || _g === void 0 ? void 0 : _g[0]) || whErr.message;
                    console.warn(`[TN] No se pudo registrar webhook ${ev} (puede existir ya):`, msg);
                }
            }
        }
        else {
            console.warn('[TN] Configure BACKEND_URL (HTTPS) en .env para activar descuento de stock automático por ventas.');
        }
        res.redirect(`${FRONTEND_URL}/#settings?status=success&platform=tiendanube`);
    }
    catch (error) {
        console.error('Error in Tienda Nube callback:', ((_h = error.response) === null || _h === void 0 ? void 0 : _h.data) || error.message);
        res.redirect(`${FRONTEND_URL}/#settings?status=error&platform=tiendanube`);
    }
});
exports.handleTiendaNubeCallback = handleTiendaNubeCallback;
const updateMercadoLibreStock = (sku, newStock) => __awaiter(void 0, void 0, void 0, function* () {
    var _j;
    try {
        const mlToken = yield getValidMLToken();
        if (!mlToken)
            return;
        const { access_token, user_id } = mlToken;
        // 1. Search item by SKU (seller_custom_field)
        // ML API to search items by SKU is tricky, usually we search by item_id.
        // Assuming we don't have item_id mapped in DB yet, we might need to search.
        // Or if we have mapped it, use it.
        // For now, let's assume we need to search or we rely on 'mercadolibre_id' in products table if it was mapped.
        // But stock is per variant.
        // We need to know the ML Variation ID.
        // Simplification: Log that we would update ML here.
        // To do this properly we need to store ML Item ID and Variation ID in product_variants.
        console.log(`[ML Sync] Would update SKU ${sku} to stock ${newStock}`);
        // Actual implementation requires:
        // 1. GET /users/{user_id}/items/search?seller_sku={sku} -> Get Item ID
        // 2. GET /items/{item_id} -> Find Variation ID matching SKU
        // 3. PUT /items/{item_id}/variations/{variation_id} { available_quantity: newStock }
        // Since we don't have this mapping fully robust yet, we'll implement a best-effort search.
        const searchRes = yield axios_1.default.get(`https://api.mercadolibre.com/users/${user_id}/items/search`, {
            headers: { Authorization: `Bearer ${access_token}` },
            params: { seller_sku: sku }
        });
        if (searchRes.data.results && searchRes.data.results.length > 0) {
            const itemId = searchRes.data.results[0];
            // Fetch item details to find variation
            const itemRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${itemId}?include_attributes=all`, {
                headers: { Authorization: `Bearer ${access_token}` }
            });
            const variations = itemRes.data.variations;
            let variationId = null;
            const matchVariationBySku = (v) => {
                var _a, _b, _c, _d;
                const vSku = ((_b = (_a = v.seller_sku) !== null && _a !== void 0 ? _a : v.seller_custom_field) !== null && _b !== void 0 ? _b : '').toString().trim();
                if (vSku === sku)
                    return true;
                const attr = Array.isArray(v.attributes) && v.attributes.find((a) => (a.id || '').toString().toUpperCase() === 'SELLER_SKU');
                const attrVal = attr ? ((_d = (_c = attr.value_name) !== null && _c !== void 0 ? _c : attr.value) !== null && _d !== void 0 ? _d : '').toString().trim() : '';
                return attrVal === sku;
            };
            if (variations && variations.length > 0) {
                const targetVar = variations.find((v) => matchVariationBySku(v));
                if (targetVar)
                    variationId = targetVar.id;
            }
            if (variationId) {
                // Update Variation Stock
                yield axios_1.default.put(`https://api.mercadolibre.com/items/${itemId}/variations/${variationId}`, {
                    available_quantity: newStock
                }, {
                    headers: { Authorization: `Bearer ${access_token}` }
                });
                console.log(`[ML Sync] Updated Item ${itemId} Variation ${variationId} to ${newStock}`);
            }
            else if (!variations || variations.length === 0) {
                // Update Item Stock (if no variations)
                yield axios_1.default.put(`https://api.mercadolibre.com/items/${itemId}`, {
                    available_quantity: newStock
                }, {
                    headers: { Authorization: `Bearer ${access_token}` }
                });
                console.log(`[ML Sync] Updated Item ${itemId} to ${newStock}`);
            }
        }
    }
    catch (error) {
        console.error(`[ML Sync Error] SKU ${sku}:`, ((_j = error.response) === null || _j === void 0 ? void 0 : _j.data) || error.message);
    }
});
exports.updateMercadoLibreStock = updateMercadoLibreStock;
const syncProductsFromTiendaNube = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _k, _l, _m;
    try {
        // 1. Get Access Token
        const integration = yield (0, db_1.get)(`SELECT * FROM integrations WHERE platform = 'tiendanube'`);
        if (!integration || !integration.access_token) {
            return res.status(400).json({ message: 'No estás conectado a Tienda Nube' });
        }
        const { access_token, user_id: store_id } = integration;
        // 2. Fetch Products from Tienda Nube
        // Pagination loop
        let page = 1;
        let hasMore = true;
        let productCount = 0;
        let variantCount = 0;
        const logs = [];
        const log = (msg) => {
            console.log(msg);
            logs.push(msg);
        };
        // Los productos de TN/ML no se guardan en la BD; solo se consulta la API para reportar.
        const perPage = 200;
        while (hasMore) {
            try {
                const response = yield axios_1.default.get(`https://api.tiendanube.com/v1/${store_id}/products`, {
                    headers: {
                        'Authentication': `bearer ${access_token}`,
                        'User-Agent': TN_USER_AGENT
                    },
                    params: { page, per_page: perPage }
                });
                const products = response.data;
                if (products.length === 0) {
                    hasMore = false;
                    break;
                }
                log(`[TN] Página ${page}: ${products.length} productos`);
                if (products.length < perPage)
                    hasMore = false;
                for (const tnProduct of products) {
                    productCount++;
                    const variants = tnProduct.variants || [];
                    variantCount += variants.length;
                    log(`  ${((_k = tnProduct.name) === null || _k === void 0 ? void 0 : _k.es) || tnProduct.name} (ID: ${tnProduct.id}): ${variants.length} variantes`);
                }
                page++;
                // Safety break (hasta 200 páginas = 40.000 productos)
                if (page > 200)
                    hasMore = false;
            }
            catch (error) {
                // If 404, likely means page out of range or end of list
                if (((_l = error.response) === null || _l === void 0 ? void 0 : _l.status) === 404) {
                    hasMore = false;
                }
                else {
                    throw error;
                }
            }
        }
        log('');
        log('Los productos de Tienda Nube no se guardan en la base de datos. Usá la vista "Vista Tienda Nube" en Inventario para ver el stock.');
        res.json({
            message: 'Consulta completada. Los productos de Tienda Nube no se guardan en la BD.',
            imported: 0,
            updated: 0,
            productCount,
            variantCount,
            logs
        });
    }
    catch (error) {
        console.error('Error syncing products:', ((_m = error.response) === null || _m === void 0 ? void 0 : _m.data) || error.message);
        res.status(500).json({ message: 'Error sincronizando productos', error: error.message });
    }
});
exports.syncProductsFromTiendaNube = syncProductsFromTiendaNube;
const delay = (ms) => new Promise(r => setTimeout(r, ms));
function getTiendaNubeStoreId(integration) {
    var _a, _b;
    const id = String((_b = (_a = integration.store_id) !== null && _a !== void 0 ? _a : integration.user_id) !== null && _b !== void 0 ? _b : '').trim();
    return id || null;
}
function parseTnNormalizeBatchBody(req) {
    var _a, _b, _c, _d, _e, _f;
    const body = (req.body && typeof req.body === 'object' ? req.body : {});
    const startPage = Math.max(1, parseInt(String((_a = body.startPage) !== null && _a !== void 0 ? _a : 1), 10) || 1);
    const maxPages = Math.min(10, Math.max(1, parseInt(String((_b = body.maxPages) !== null && _b !== void 0 ? _b : 2), 10) || 2));
    const maxUpdates = Math.min(200, Math.max(1, parseInt(String((_c = body.maxUpdates) !== null && _c !== void 0 ? _c : 25), 10) || 25));
    const raw = body.resume;
    let resume;
    if (raw && typeof raw === 'object') {
        const r = raw;
        resume = {
            page: Math.max(1, parseInt(String((_d = r.page) !== null && _d !== void 0 ? _d : startPage), 10) || startPage),
            productIndex: Math.max(0, parseInt(String((_e = r.productIndex) !== null && _e !== void 0 ? _e : 0), 10) || 0),
            variantIndex: Math.max(0, parseInt(String((_f = r.variantIndex) !== null && _f !== void 0 ? _f : 0), 10) || 0),
        };
    }
    return { startPage, maxPages, maxUpdates, resume };
}
function tnAttributeLabel(attr) {
    var _a, _b, _c;
    return ((_c = (_b = (_a = attr === null || attr === void 0 ? void 0 : attr.es) !== null && _a !== void 0 ? _a : attr === null || attr === void 0 ? void 0 : attr.en) !== null && _b !== void 0 ? _b : attr === null || attr === void 0 ? void 0 : attr.pt) !== null && _c !== void 0 ? _c : (typeof attr === 'string' ? attr : '')).toString();
}
function tnVariantValueText(val) {
    var _a, _b, _c, _d;
    return ((_d = ((_c = (_b = (_a = val === null || val === void 0 ? void 0 : val.es) !== null && _a !== void 0 ? _a : val === null || val === void 0 ? void 0 : val.pt) !== null && _b !== void 0 ? _b : val === null || val === void 0 ? void 0 : val.en) !== null && _c !== void 0 ? _c : val)) === null || _d === void 0 ? void 0 : _d.toString().trim()) || '';
}
/** Clave única Color+Talle+… para detectar variantes repetidas en Tienda Nube. */
function tnVariantComboKey(values, attrIndex, replaceAtAttr) {
    const parts = [];
    for (let i = 0; i < values.length; i++) {
        const text = i === attrIndex && replaceAtAttr !== undefined ? replaceAtAttr : tnVariantValueText(values[i]);
        parts.push(text
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim());
    }
    return parts.join('||');
}
function normalizeTiendaNubeVariantAttribute(options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    return __awaiter(this, void 0, void 0, function* () {
        const { access_token, store_id, isTargetAttribute, normalizeValue, completedMessage } = options;
        const shouldUpdate = (_a = options.shouldUpdate) !== null && _a !== void 0 ? _a : ((c, n) => c !== n);
        const maxPages = (_b = options.maxPages) !== null && _b !== void 0 ? _b : 2;
        const maxUpdates = (_c = options.maxUpdates) !== null && _c !== void 0 ? _c : 40;
        const logs = [];
        const log = (msg) => {
            console.log(msg);
            logs.push(msg);
        };
        let updatedVariants = 0;
        let skippedProducts = 0;
        let skippedDuplicates = 0;
        let mergedVariants = 0;
        let updatesThisBatch = 0;
        let page = (_f = (_e = (_d = options.resume) === null || _d === void 0 ? void 0 : _d.page) !== null && _e !== void 0 ? _e : options.startPage) !== null && _f !== void 0 ? _f : 1;
        let productStart = (_h = (_g = options.resume) === null || _g === void 0 ? void 0 : _g.productIndex) !== null && _h !== void 0 ? _h : 0;
        let variantStart = (_k = (_j = options.resume) === null || _j === void 0 ? void 0 : _j.variantIndex) !== null && _k !== void 0 ? _k : 0;
        let pagesProcessed = 0;
        let stoppedByCap = false;
        let lastPageFull = false;
        const perPage = 50;
        const tnHeaders = { Authentication: `bearer ${access_token}`, 'User-Agent': TN_USER_AGENT };
        while (pagesProcessed < maxPages && updatesThisBatch < maxUpdates) {
            let products = [];
            try {
                const response = yield axios_1.default.get(`https://api.tiendanube.com/v1/${store_id}/products`, {
                    headers: tnHeaders,
                    params: { page, per_page: perPage },
                });
                products = Array.isArray(response.data) ? response.data : [];
            }
            catch (err) {
                const ax = err;
                if (((_l = ax.response) === null || _l === void 0 ? void 0 : _l.status) === 404) {
                    break;
                }
                throw err;
            }
            if (!products.length)
                break;
            lastPageFull = products.length >= perPage;
            log(`[TN] Página ${page}: ${products.length} productos`);
            for (let pi = productStart; pi < products.length; pi++) {
                const tnProduct = products[pi];
                const productAttributes = tnProduct.attributes || [];
                let attrIndex = -1;
                for (let i = 0; i < productAttributes.length; i++) {
                    if (isTargetAttribute(tnAttributeLabel(productAttributes[i]))) {
                        attrIndex = i;
                        break;
                    }
                }
                if (attrIndex === -1) {
                    skippedProducts++;
                    variantStart = 0;
                    continue;
                }
                let variants = tnProduct.variants || [];
                try {
                    const allVariants = yield (0, tiendanubeVariantMerge_service_1.fetchAllTiendaNubeProductVariants)(store_id, tnProduct.id, tnHeaders);
                    if (allVariants.length > 0)
                        variants = allVariants;
                }
                catch (fetchErr) {
                    const m = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
                    log(`  [WARN] Producto ${tnProduct.id}: no se pudieron listar todas las variantes (${m})`);
                }
                const plans = [];
                for (let vi = 0; vi < variants.length; vi++) {
                    const variant = variants[vi];
                    const values = variant.values || [];
                    if (attrIndex >= values.length)
                        continue;
                    let current = '';
                    let normalized = '';
                    try {
                        current = tnVariantValueText(values[attrIndex]);
                        normalized = normalizeValue(current);
                    }
                    catch (normErr) {
                        const m = normErr instanceof Error ? normErr.message : String(normErr);
                        log(`  [ERROR] Variante ${variant.id}: normalización falló (${m})`);
                        continue;
                    }
                    const willUpdate = shouldUpdate(current, normalized);
                    plans.push({
                        variant,
                        vi,
                        current,
                        normalized,
                        willUpdate,
                        newKey: tnVariantComboKey(values, attrIndex, normalized),
                    });
                }
                const groupsByEffectiveKey = new Map();
                for (const p of plans) {
                    const values = p.variant.values || [];
                    const key = p.willUpdate ? p.newKey : tnVariantComboKey(values, attrIndex);
                    if (!groupsByEffectiveKey.has(key))
                        groupsByEffectiveKey.set(key, []);
                    groupsByEffectiveKey.get(key).push(p);
                }
                const mergedKeys = new Set();
                for (let pi2 = 0; pi2 < plans.length; pi2++) {
                    const p = plans[pi2];
                    if (pi === productStart && p.vi < variantStart)
                        continue;
                    if (updatesThisBatch >= maxUpdates) {
                        stoppedByCap = true;
                        return {
                            updatedVariants,
                            skippedProducts,
                            skippedDuplicates,
                            mergedVariants,
                            logs,
                            hasMore: true,
                            resume: { page, productIndex: pi, variantIndex: p.vi },
                        };
                    }
                    const values = p.variant.values || [];
                    const effKey = p.willUpdate ? p.newKey : tnVariantComboKey(values, attrIndex);
                    const group = groupsByEffectiveKey.get(effKey) || [];
                    if (group.length > 1) {
                        if (mergedKeys.has(effKey))
                            continue;
                        mergedKeys.add(effKey);
                        try {
                            const { mergedCount } = yield (0, tiendanubeVariantMerge_service_1.mergeTiendaNubeDuplicateVariants)({
                                storeId: store_id,
                                productId: tnProduct.id,
                                attrIndex,
                                group: group.map((g) => ({
                                    variant: g.variant,
                                    current: g.current,
                                    normalized: g.normalized,
                                    willUpdate: g.willUpdate,
                                })),
                                headers: tnHeaders,
                                log,
                            });
                            mergedVariants += mergedCount;
                            updatedVariants += 1;
                            updatesThisBatch++;
                        }
                        catch (err) {
                            skippedDuplicates++;
                            const m = err instanceof Error ? err.message : String(err);
                            log(`  [ERROR] Producto ${tnProduct.id} fusión (${effKey}): ${m}`);
                        }
                        continue;
                    }
                    if (!p.willUpdate)
                        continue;
                    const newValues = values.map((obj, i) => {
                        if (i !== attrIndex)
                            return obj;
                        const langKeys = obj && typeof obj === 'object' ? Object.keys(obj) : ['es'];
                        const next = {};
                        for (const lang of langKeys)
                            next[lang] = p.normalized;
                        return next;
                    });
                    try {
                        yield (0, tiendanubeClient_1.tnPutWithRetry)(axios_1.default, `https://api.tiendanube.com/v1/${store_id}/products/${tnProduct.id}/variants/${p.variant.id}`, { values: newValues }, { headers: tnHeaders });
                        updatedVariants++;
                        updatesThisBatch++;
                        log(`  [TN] Producto ${tnProduct.id} variante ${p.variant.id}: "${p.current}" → "${p.normalized}"`);
                    }
                    catch (err) {
                        const ax = err;
                        const desc = ((_o = (_m = ax.response) === null || _m === void 0 ? void 0 : _m.data) === null || _o === void 0 ? void 0 : _o.description) || ax.message || '';
                        if (/cannot be repeated|no pueden repetirse|variantes.*repetid/i.test(desc)) {
                            skippedDuplicates++;
                            log(`  [SKIP] Variante ${p.variant.id}: combinación ya existe (${desc})`);
                        }
                        else {
                            log(`  [ERROR] Variante ${p.variant.id}: ${desc}`);
                        }
                    }
                }
                variantStart = 0;
            }
            productStart = 0;
            page++;
            pagesProcessed++;
            if (!lastPageFull)
                break;
            if (page > 300)
                break;
        }
        const hasMore = stoppedByCap || (lastPageFull && pagesProcessed >= maxPages);
        if (!hasMore)
            log(completedMessage);
        return {
            updatedVariants,
            skippedProducts,
            skippedDuplicates,
            mergedVariants,
            logs,
            hasMore,
            nextPage: hasMore && !stoppedByCap ? page : undefined,
        };
    });
}
const normalizeSizesInTiendaNube = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _o, _p;
    try {
        const integration = yield (0, db_1.get)(`SELECT * FROM integrations WHERE platform = 'tiendanube'`);
        if (!(integration === null || integration === void 0 ? void 0 : integration.access_token)) {
            return res.status(400).json({ message: 'No estás conectado a Tienda Nube' });
        }
        const store_id = getTiendaNubeStoreId(integration);
        if (!store_id) {
            return res.status(400).json({ message: 'Integración Tienda Nube sin ID de tienda (store_id)' });
        }
        const batch = parseTnNormalizeBatchBody(req);
        const result = yield normalizeTiendaNubeVariantAttribute(Object.assign({ access_token: integration.access_token, store_id, isTargetAttribute: (name) => /talle|talla|size|tamano|tamaño/i.test(name), normalizeValue: talleStandard_1.normalizeSizeToStandard, completedMessage: 'Normalización de talles en Tienda Nube completada' }, batch));
        res.json(Object.assign({ message: result.hasMore
                ? 'Lote de talles procesado; hay más productos pendientes'
                : 'Normalización de talles en Tienda Nube completada' }, result));
    }
    catch (error) {
        const ax = error;
        console.error('Error normalizing sizes:', ((_o = ax.response) === null || _o === void 0 ? void 0 : _o.data) || ax.message);
        res.status(500).json({
            message: 'Error normalizando talles en Tienda Nube',
            error: ax.message,
            detail: (_p = ax.response) === null || _p === void 0 ? void 0 : _p.data,
        });
    }
});
exports.normalizeSizesInTiendaNube = normalizeSizesInTiendaNube;
const normalizeColorsInTiendaNube = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _q, _r;
    try {
        const integration = yield (0, db_1.get)(`SELECT * FROM integrations WHERE platform = 'tiendanube'`);
        if (!(integration === null || integration === void 0 ? void 0 : integration.access_token)) {
            return res.status(400).json({ message: 'No estás conectado a Tienda Nube' });
        }
        const store_id = getTiendaNubeStoreId(integration);
        if (!store_id) {
            return res.status(400).json({ message: 'Integración Tienda Nube sin ID de tienda (store_id)' });
        }
        const batch = parseTnNormalizeBatchBody(req);
        const result = yield normalizeTiendaNubeVariantAttribute(Object.assign({ access_token: integration.access_token, store_id, isTargetAttribute: (name) => /color|colour|colore|cor\b|colores/i.test(name) && !/talle|talla|size|tamano|tamaño/i.test(name), normalizeValue: colorNameStandard_1.normalizeColorNameToStandard, shouldUpdate: colorNameStandard_1.shouldUpdateColorValue, completedMessage: 'Normalización de colores en Tienda Nube completada' }, batch));
        res.json(Object.assign({ message: result.hasMore
                ? 'Lote de colores procesado; hay más productos pendientes'
                : 'Normalización de colores en Tienda Nube completada' }, result));
    }
    catch (error) {
        const ax = error;
        console.error('Error normalizing colors:', ((_q = ax.response) === null || _q === void 0 ? void 0 : _q.data) || ax.message);
        res.status(500).json({
            message: 'Error normalizando colores en Tienda Nube',
            error: ax.message,
            detail: (_r = ax.response) === null || _r === void 0 ? void 0 : _r.data,
        });
    }
});
exports.normalizeColorsInTiendaNube = normalizeColorsInTiendaNube;
/** Envía a Tienda Nube el SKU de LupoHub (base-talle-color) en todas las variantes vinculadas. */
const syncSkusToTiendaNube = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _s, _t, _u;
    try {
        const integration = yield (0, db_1.get)(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
        if (!(integration === null || integration === void 0 ? void 0 : integration.access_token)) {
            return res.status(400).json({ message: 'No estás conectado a Tienda Nube' });
        }
        const store_id = getTiendaNubeStoreId(integration);
        if (!store_id) {
            return res.status(400).json({ message: 'Integración Tienda Nube sin ID de tienda (store_id)' });
        }
        const rows = yield (0, db_1.query)(`SELECT pv.id AS variant_id, pv.sku, pv.tienda_nube_variant_id, p.tienda_nube_id
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       WHERE pv.tienda_nube_variant_id IS NOT NULL
         AND p.tienda_nube_id IS NOT NULL
         AND pv.sku IS NOT NULL
         AND TRIM(pv.sku) <> ''`);
        const headers = {
            Authentication: `bearer ${integration.access_token}`,
            'User-Agent': TN_USER_AGENT,
            'Content-Type': 'application/json',
        };
        const logs = [];
        let updated = 0;
        let errors = 0;
        let skipped = 0;
        for (const r of rows) {
            const lupoSku = (0, skuString_1.skuToCanonicalString)(r.sku);
            if (!lupoSku) {
                skipped++;
                continue;
            }
            try {
                yield (0, tiendanubeClient_1.tnPutWithRetry)(axios_1.default, `https://api.tiendanube.com/v1/${store_id}/products/${r.tienda_nube_id}/variants/${r.tienda_nube_variant_id}`, { sku: lupoSku }, { headers });
                updated++;
                if (logs.length < 200)
                    logs.push(`[OK] ${lupoSku} (variante ${r.tienda_nube_variant_id})`);
            }
            catch (err) {
                errors++;
                const ax = err;
                if (logs.length < 200) {
                    logs.push(`[ERROR] ${lupoSku}: ${((_t = (_s = ax.response) === null || _s === void 0 ? void 0 : _s.data) === null || _t === void 0 ? void 0 : _t.description) || ax.message}`);
                }
            }
            if (TN_RATE_LIMIT_DELAY_MS > 0)
                yield sleep(TN_RATE_LIMIT_DELAY_MS);
        }
        res.json({
            message: 'Sincronización de SKU a Tienda Nube completada',
            total: rows.length,
            updated,
            errors,
            skipped,
            logs,
        });
    }
    catch (error) {
        const ax = error;
        console.error('Error syncing SKUs to TN:', ((_u = ax.response) === null || _u === void 0 ? void 0 : _u.data) || ax.message);
        res.status(500).json({ message: 'Error sincronizando SKU a Tienda Nube', error: ax.message });
    }
});
exports.syncSkusToTiendaNube = syncSkusToTiendaNube;
const disconnectIntegration = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { platform } = req.params;
    if (!platform || !['mercadolibre', 'tiendanube'].includes(platform)) {
        return res.status(400).json({ message: 'Plataforma inválida' });
    }
    try {
        yield (0, db_1.execute)(`DELETE FROM integrations WHERE platform = ?`, [platform]);
        return res.json({ message: 'Desconectado', platform });
    }
    catch (error) {
        return res.status(500).json({ message: 'Error desconectando', error: error.message });
    }
});
exports.disconnectIntegration = disconnectIntegration;
const testMercadoLibreConnection = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _v, _w, _x, _y, _z;
    try {
        const mlToken = yield getValidMLToken();
        if (!mlToken) {
            return res.status(400).json({
                success: false,
                message: 'No estás conectado a Mercado Libre o el token no se pudo refrescar',
                details: 'No se encontró token de acceso válido'
            });
        }
        const { access_token, user_id } = mlToken;
        // Obtener fecha de expiración actual
        const integration = yield (0, db_1.get)(`SELECT expires_at FROM integrations WHERE platform = 'mercadolibre'`);
        // Probar la conexión obteniendo información del usuario
        const userRes = yield axios_1.default.get(`https://api.mercadolibre.com/users/${user_id}`, {
            headers: { Authorization: `Bearer ${access_token}` }
        });
        // Obtener cantidad de publicaciones
        const itemsRes = yield axios_1.default.get(`https://api.mercadolibre.com/users/${user_id}/items/search`, {
            headers: { Authorization: `Bearer ${access_token}` }
        });
        res.json({
            success: true,
            message: 'Conexión exitosa (token auto-renovable)',
            details: {
                userId: user_id,
                nickname: userRes.data.nickname,
                email: userRes.data.email,
                country: userRes.data.country_id,
                totalItems: ((_v = itemsRes.data.paging) === null || _v === void 0 ? void 0 : _v.total) || ((_w = itemsRes.data.results) === null || _w === void 0 ? void 0 : _w.length) || 0,
                expiresAt: (integration === null || integration === void 0 ? void 0 : integration.expires_at) ? new Date(integration.expires_at).toLocaleString() : 'N/A'
            }
        });
    }
    catch (error) {
        console.error('Error testing ML connection:', ((_x = error.response) === null || _x === void 0 ? void 0 : _x.data) || error.message);
        res.status(500).json({
            success: false,
            message: 'Error de conexión',
            details: ((_z = (_y = error.response) === null || _y === void 0 ? void 0 : _y.data) === null || _z === void 0 ? void 0 : _z.message) || error.message
        });
    }
});
exports.testMercadoLibreConnection = testMercadoLibreConnection;
const debugMercadoLibreItem = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _0, _1, _2, _3, _4;
    try {
        const mlToken = yield getValidMLToken();
        if (!mlToken) {
            return res.status(400).json({ error: 'No hay integración con ML o token inválido' });
        }
        const { access_token, user_id } = mlToken;
        // Obtener el primer item
        const searchRes = yield axios_1.default.get(`https://api.mercadolibre.com/users/${user_id}/items/search?limit=1`, {
            headers: { Authorization: `Bearer ${access_token}` }
        });
        const itemId = (_0 = searchRes.data.results) === null || _0 === void 0 ? void 0 : _0[0];
        if (!itemId) {
            return res.json({ message: 'No hay publicaciones' });
        }
        // Obtener detalles del item
        const itemRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${itemId}?include_attributes=all`, {
            headers: { Authorization: `Bearer ${access_token}` }
        });
        const item = itemRes.data;
        const firstVariation = (_1 = item.variations) === null || _1 === void 0 ? void 0 : _1[0];
        res.json({
            itemId: item.id,
            title: item.title,
            seller_custom_field: item.seller_custom_field,
            seller_sku: item.seller_sku,
            variation_count: ((_2 = item.variations) === null || _2 === void 0 ? void 0 : _2.length) || 0,
            first_variation: firstVariation ? {
                id: firstVariation.id,
                seller_custom_field: firstVariation.seller_custom_field,
                seller_sku: firstVariation.seller_sku,
                attributes: firstVariation.attributes,
                attribute_combinations: firstVariation.attribute_combinations,
                all_keys: Object.keys(firstVariation)
            } : null,
            item_attributes: (_3 = item.attributes) === null || _3 === void 0 ? void 0 : _3.filter((a) => { var _a, _b, _c; return ((_a = a.id) === null || _a === void 0 ? void 0 : _a.includes('SKU')) || ((_b = a.id) === null || _b === void 0 ? void 0 : _b.includes('GTIN')) || ((_c = a.id) === null || _c === void 0 ? void 0 : _c.includes('CODE')); })
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message, details: (_4 = error.response) === null || _4 === void 0 ? void 0 : _4.data });
    }
});
exports.debugMercadoLibreItem = debugMercadoLibreItem;
const syncProductsFromMercadoLibre = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16;
    try {
        const mlToken = yield getValidMLToken();
        if (!mlToken) {
            return res.status(400).json({ message: 'No estás conectado a Mercado Libre o el token expiró' });
        }
        const { access_token, user_id } = mlToken;
        const logs = [];
        let linkedVariants = 0;
        let linkedProducts = 0;
        let notFound = 0;
        logs.push(`[ML] User ID: ${user_id}`);
        logs.push(`[ML] Token válido (auto-refrescado si necesario)`);
        let realUserId = user_id;
        // Obtener todos los items del usuario
        let searchRes;
        let allItems = [];
        let offset = 0;
        const limit = 50;
        try {
            // Paginar para obtener todos los items
            do {
                searchRes = yield axios_1.default.get(`https://api.mercadolibre.com/users/${realUserId}/items/search?limit=${limit}&offset=${offset}`, {
                    headers: { Authorization: `Bearer ${access_token}` }
                });
                const results = searchRes.data.results || [];
                allItems = allItems.concat(results);
                logs.push(`[ML] Página ${Math.floor(offset / limit) + 1}: ${results.length} items (total acumulado: ${allItems.length})`);
                offset += limit;
                // Continuar si hay más items (respetar total de la API y límite configurable)
                const total = ((_5 = searchRes.data.paging) === null || _5 === void 0 ? void 0 : _5.total) || 0;
                if (offset >= total || results.length === 0)
                    break;
                if (allItems.length >= ML_SYNC_MAX_ITEMS)
                    break;
            } while (true);
        }
        catch (searchError) {
            logs.push(`[ML ERROR] Error buscando items: ${((_7 = (_6 = searchError.response) === null || _6 === void 0 ? void 0 : _6.data) === null || _7 === void 0 ? void 0 : _7.message) || searchError.message}`);
            logs.push(`[ML ERROR] Status: ${(_8 = searchError.response) === null || _8 === void 0 ? void 0 : _8.status}`);
            logs.push(`[ML ERROR] URL: https://api.mercadolibre.com/users/${realUserId}/items/search`);
            return res.json({
                message: 'Error obteniendo publicaciones de ML',
                linkedVariants: 0,
                linkedProducts: 0,
                notFound: 0,
                totalItems: 0,
                logs
            });
        }
        const items = allItems;
        logs.push(`[ML] Total encontradas: ${items.length} publicaciones en Mercado Libre`);
        // Procesar items en lotes usando multiget para mayor velocidad
        const batchSize = 20;
        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            logs.push(`\n[ML] Procesando lote ${Math.floor(i / batchSize) + 1}/${Math.ceil(items.length / batchSize)} (${batch.length} items)`);
            try {
                // Usar multiget para obtener varios items a la vez
                const multigetRes = yield axios_1.default.get(`https://api.mercadolibre.com/items?ids=${batch.join(',')}&include_attributes=all`, {
                    headers: { Authorization: `Bearer ${access_token}` }
                });
                const itemsData = multigetRes.data || [];
                for (const itemWrapper of itemsData) {
                    if (itemWrapper.code !== 200 || !itemWrapper.body) {
                        logs.push(`  [Error] Item ${itemWrapper.id || 'desconocido'}: código ${itemWrapper.code}`);
                        continue;
                    }
                    const mlItem = itemWrapper.body;
                    const variations = mlItem.variations || [];
                    const itemTitle = mlItem.title || mlItem.id;
                    if (variations.length > 0) {
                        // Item con variaciones
                        let variantesVinculadas = 0;
                        let variantesNoEncontradas = 0;
                        // Extraer número de artículo del título (ej: "Art.5690" -> "5690")
                        const artMatch = itemTitle.match(/Art\.?\s*(\d+)/i) || itemTitle.match(/Modelo?\s*(\d+)/i) || itemTitle.match(/(\d{3,})/);
                        const artNumber = artMatch ? artMatch[1] : null;
                        // Buscar producto por número de artículo en el nombre o SKU
                        let productMatch = null;
                        if (artNumber) {
                            productMatch = yield (0, db_1.get)(`SELECT id, sku, name FROM products WHERE sku LIKE ? OR name LIKE ? LIMIT 1`, [`%${artNumber}%`, `%${artNumber}%`]);
                        }
                        for (const v of variations) {
                            // SKU en ML: atributo SELLER_SKU en variación (/items con include_attributes=all)
                            const skuAttr = Array.isArray(v.attributes) && v.attributes.find((a) => (a.id || '').toString().toUpperCase() === 'SELLER_SKU');
                            const mlSku = (skuAttr ? ((_10 = (_9 = skuAttr.value_name) !== null && _9 !== void 0 ? _9 : skuAttr.value) !== null && _10 !== void 0 ? _10 : '').toString().trim() : '')
                                || ((_12 = (_11 = v.seller_sku) !== null && _11 !== void 0 ? _11 : v.seller_custom_field) !== null && _12 !== void 0 ? _12 : '').toString().trim();
                            // Extraer color y talle de attribute_combinations
                            const attrCombs = v.attribute_combinations || [];
                            const mlColor = ((_13 = attrCombs.find((a) => a.id === 'COLOR')) === null || _13 === void 0 ? void 0 : _13.value_name) || '';
                            const mlSize = ((_14 = attrCombs.find((a) => a.id === 'SIZE')) === null || _14 === void 0 ? void 0 : _14.value_name) || '';
                            let row = null;
                            // Método 1: Buscar por SKU si existe
                            if (mlSku) {
                                row = yield (0, db_1.get)(`SELECT pv.id AS variant_id, pc.product_id AS product_id 
                   FROM product_variants pv 
                   JOIN product_colors pc ON pv.product_color_id = pc.id 
                   WHERE pv.sku = ?`, [mlSku]);
                            }
                            // Método 2: Buscar por producto + color + talle
                            if (!row && (productMatch === null || productMatch === void 0 ? void 0 : productMatch.id) && (mlColor || mlSize)) {
                                row = yield (0, db_1.get)(`SELECT pv.id AS variant_id, pc.product_id AS product_id 
                   FROM product_variants pv 
                   JOIN product_colors pc ON pv.product_color_id = pc.id 
                   JOIN colors c ON pc.color_id = c.id
                   JOIN sizes s ON pv.size_id = s.id
                   WHERE pc.product_id = ? 
                     AND (UPPER(c.name) LIKE ? OR UPPER(c.code) LIKE ?)
                     AND UPPER(s.size_code) = ?
                   LIMIT 1`, [productMatch.id, `%${mlColor.toUpperCase()}%`, `%${mlColor.toUpperCase()}%`, mlSize.toUpperCase()]);
                            }
                            // Método 3: Buscar solo por producto + talle (si el color no matchea)
                            if (!row && (productMatch === null || productMatch === void 0 ? void 0 : productMatch.id) && mlSize) {
                                row = yield (0, db_1.get)(`SELECT pv.id AS variant_id, pc.product_id AS product_id 
                   FROM product_variants pv 
                   JOIN product_colors pc ON pv.product_color_id = pc.id 
                   JOIN sizes s ON pv.size_id = s.id
                   WHERE pc.product_id = ? AND UPPER(s.size_code) = ?
                   LIMIT 1`, [productMatch.id, mlSize.toUpperCase()]);
                            }
                            if (row === null || row === void 0 ? void 0 : row.variant_id) {
                                // No se guardan vínculos en la BD; solo se cuenta para el reporte
                                linkedVariants++;
                                variantesVinculadas++;
                            }
                            else {
                                notFound++;
                                variantesNoEncontradas++;
                            }
                        }
                        // Log resumido por item
                        if (variantesVinculadas > 0) {
                            logs.push(`  [OK] ${itemTitle}: ${variantesVinculadas}/${variations.length} variantes vinculadas`);
                        }
                        else if (artNumber) {
                            logs.push(`  [?] ${itemTitle}: Art.${artNumber} no encontrado en BD local`);
                        }
                        else {
                            logs.push(`  [X] ${itemTitle}: No se pudo extraer número de artículo`);
                        }
                    }
                    else {
                        // Item sin variaciones
                        const mlSku = mlItem.seller_custom_field || mlItem.seller_sku || '';
                        // Extraer número de artículo del título
                        const artMatch = itemTitle.match(/Art\.?\s*(\d+)/i) || itemTitle.match(/Modelo?\s*(\d+)/i) || itemTitle.match(/(\d{3,})/);
                        const artNumber = artMatch ? artMatch[1] : null;
                        let prod = null;
                        // Buscar por SKU si existe
                        if (mlSku) {
                            prod = yield (0, db_1.get)(`SELECT id FROM products WHERE sku = ?`, [mlSku]);
                            if (!prod) {
                                prod = yield (0, db_1.get)(`SELECT id FROM products WHERE sku LIKE ?`, [`%${mlSku}%`]);
                            }
                        }
                        // Si no hay SKU, buscar por número de artículo
                        if (!prod && artNumber) {
                            prod = yield (0, db_1.get)(`SELECT id FROM products WHERE sku LIKE ? OR name LIKE ? LIMIT 1`, [`%${artNumber}%`, `%${artNumber}%`]);
                        }
                        if (prod === null || prod === void 0 ? void 0 : prod.id) {
                            // No se guardan vínculos en la BD; solo se cuenta para el reporte
                            linkedProducts++;
                            logs.push(`  [OK] ${itemTitle} (no se guarda en BD)`);
                        }
                        else {
                            notFound++;
                            logs.push(`  [X] ${itemTitle} - no encontrado`);
                        }
                    }
                }
            }
            catch (e) {
                logs.push(`[ML Lote Error]: ${((_16 = (_15 = e === null || e === void 0 ? void 0 : e.response) === null || _15 === void 0 ? void 0 : _15.data) === null || _16 === void 0 ? void 0 : _16.message) || (e === null || e === void 0 ? void 0 : e.message) || 'Error'}`);
            }
        }
        logs.push(`\n========== RESUMEN ==========`);
        logs.push(`Publicaciones ML procesadas: ${items.length}`);
        logs.push(`Coincidencias encontradas (variantes): ${linkedVariants}`);
        logs.push(`Coincidencias encontradas (productos sin variantes): ${linkedProducts}`);
        logs.push(`No encontrados/Sin SKU: ${notFound}`);
        logs.push(``);
        logs.push(`Los datos de Mercado Libre no se guardan en la base de datos. Usá la vista "Vista Mercado Libre" en Inventario para ver el stock.`);
        res.json({
            message: 'Consulta completada. Los productos de Mercado Libre no se guardan en la BD.',
            linkedVariants,
            linkedProducts,
            notFound,
            totalItems: items.length,
            logs
        });
    }
    catch (error) {
        console.error('Error sincronizando ML:', error);
        res.status(500).json({ message: 'Error sincronizando Mercado Libre', error: error.message });
    }
});
exports.syncProductsFromMercadoLibre = syncProductsFromMercadoLibre;
// ==================== WEBHOOKS ====================
// Webhook de Tienda Nube para órdenes/ventas
const handleTiendaNubeWebhook = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _17, _18, _19, _20, _21, _22, _23, _24, _25, _26, _27, _28, _29, _30, _31, _32, _33, _34, _35, _36, _37, _38, _39, _40;
    try {
        const event = ((_20 = (_19 = (_18 = (_17 = req.body) === null || _17 === void 0 ? void 0 : _17.event) !== null && _18 !== void 0 ? _18 : req.headers['x-linkedstore-topic']) !== null && _19 !== void 0 ? _19 : req.headers['x-tiendanube-topic']) !== null && _20 !== void 0 ? _20 : '').toString();
        const storeIdFromReq = ((_24 = (_23 = (_22 = (_21 = req.body) === null || _21 === void 0 ? void 0 : _21.store_id) !== null && _22 !== void 0 ? _22 : req.headers['x-linkedstore-id']) !== null && _23 !== void 0 ? _23 : req.headers['x-tiendanube-store-id']) !== null && _24 !== void 0 ? _24 : '').toString();
        console.log(`[TN Webhook] Evento: ${event}, Store: ${storeIdFromReq || '-'}`);
        // Verificar store_id solo cuando viene en el webhook.
        // En algunos eventos/proveedores no llega este dato y antes se ignoraba todo por error.
        const integration = yield (0, db_1.get)(`SELECT store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
        const storedStoreId = (_26 = ((_25 = integration === null || integration === void 0 ? void 0 : integration.store_id) !== null && _25 !== void 0 ? _25 : integration === null || integration === void 0 ? void 0 : integration.user_id)) === null || _26 === void 0 ? void 0 : _26.toString();
        if (!integration) {
            console.log('[TN Webhook] No hay integración de Tienda Nube, ignorando');
            return res.status(200).json({ received: true, ignored: true });
        }
        if (storeIdFromReq && storedStoreId && storedStoreId !== storeIdFromReq) {
            console.log('[TN Webhook] Store ID no coincide (recibido:', storeIdFromReq, ', guardado:', storedStoreId, '), ignorando');
            return res.status(200).json({ received: true, ignored: true });
        }
        // Procesar solo cuando la orden se paga (descontar stock). Responder 200 enseguida: TN tiene timeout de 3s y reintentos si no hay 2XX.
        if (event === 'order/paid') {
            const orderId = (_32 = (_30 = (_28 = (_27 = req.body.id) !== null && _27 !== void 0 ? _27 : req.body.order_id) !== null && _28 !== void 0 ? _28 : (_29 = req.body.order) === null || _29 === void 0 ? void 0 : _29.id) !== null && _30 !== void 0 ? _30 : (_31 = req.body.data) === null || _31 === void 0 ? void 0 : _31.id) !== null && _32 !== void 0 ? _32 : (_33 = req.body.data) === null || _33 === void 0 ? void 0 : _33.order_id;
            if (orderId) {
                processTiendaNubeOrder(String(orderId)).catch((err) => console.error('[TN Order] Error procesando orden en background:', (err === null || err === void 0 ? void 0 : err.message) || err));
            }
            else {
                console.warn('[TN Webhook] order/paid sin id de orden en body:', JSON.stringify(req.body));
            }
        }
        // Al cancelar una orden, restaurar el stock que se había descontado
        if (event === 'order/cancelled') {
            const orderId = (_39 = (_37 = (_35 = (_34 = req.body.id) !== null && _34 !== void 0 ? _34 : req.body.order_id) !== null && _35 !== void 0 ? _35 : (_36 = req.body.order) === null || _36 === void 0 ? void 0 : _36.id) !== null && _37 !== void 0 ? _37 : (_38 = req.body.data) === null || _38 === void 0 ? void 0 : _38.id) !== null && _39 !== void 0 ? _39 : (_40 = req.body.data) === null || _40 === void 0 ? void 0 : _40.order_id;
            if (orderId) {
                processTiendaNubeOrderCancelled(String(orderId)).catch((err) => console.error('[TN Order] Error restaurando stock por cancelación:', (err === null || err === void 0 ? void 0 : err.message) || err));
            }
            else {
                console.warn('[TN Webhook] order/cancelled sin id de orden en body:', JSON.stringify(req.body));
            }
        }
        res.status(200).json({ received: true });
    }
    catch (error) {
        console.error('[TN Webhook] Error:', error.message);
        res.status(200).json({ received: true, error: error.message });
    }
});
exports.handleTiendaNubeWebhook = handleTiendaNubeWebhook;
// Procesar orden de Tienda Nube y descontar stock
const processTiendaNubeOrder = (orderId) => __awaiter(void 0, void 0, void 0, function* () {
    var _41, _42, _43, _44;
    try {
        const integration = yield (0, db_1.get)(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
        if (!(integration === null || integration === void 0 ? void 0 : integration.access_token))
            return;
        const storeId = integration.store_id || integration.user_id;
        if (!storeId) {
            console.error('[TN Order] No hay store_id ni user_id en la integración');
            return;
        }
        // Idempotencia: no descontar dos veces la misma orden (p. ej. si TN reenvía el webhook)
        const alreadyProcessed = yield (0, db_1.get)(`SELECT id FROM stock_movements WHERE movement_type = 'VENTA_TIENDA_NUBE' AND reference = ? LIMIT 1`, [`Orden TN: ${orderId}`]);
        if (alreadyProcessed) {
            console.log(`[TN Order] Orden ${orderId} ya procesada, omitiendo`);
            return;
        }
        const headers = {
            'Authentication': `bearer ${integration.access_token}`,
            'User-Agent': TN_USER_AGENT
        };
        let orderRes = yield axios_1.default.get(`https://api.tiendanube.com/v1/${storeId}/orders/${orderId}`, { headers, validateStatus: () => true });
        // Si 404, puede que el webhook haya enviado el "number" (ej. 1909) en vez del "id" interno; buscar por q
        if (orderRes.status === 404) {
            const searchRes = yield axios_1.default.get(`https://api.tiendanube.com/v1/${storeId}/orders`, { params: { q: orderId, per_page: 1 }, headers, validateStatus: () => true });
            if (searchRes.status === 200 && Array.isArray(searchRes.data) && searchRes.data.length > 0) {
                const foundId = searchRes.data[0].id;
                console.log(`[TN Order] Orden encontrada por número: ${orderId} -> id ${foundId}`);
                orderRes = yield axios_1.default.get(`https://api.tiendanube.com/v1/${storeId}/orders/${foundId}`, { headers });
            }
        }
        if (orderRes.status !== 200) {
            const errBody = orderRes.data && typeof orderRes.data === 'object' ? JSON.stringify(orderRes.data) : orderRes.data;
            console.error(`[TN Order] Error al obtener orden ${orderId}: HTTP ${orderRes.status}. Si es 403, reconectá Tienda Nube (falta scope read_orders). Respuesta:`, errBody);
            return;
        }
        const order = orderRes.data;
        const productCount = Array.isArray(order.products) ? order.products.length : 0;
        console.log(`[TN Order] Procesando orden ${orderId}, payment_status: ${order.payment_status}, productos: ${productCount}`);
        // Solo descontar cuando la venta está pagada
        if (order.payment_status !== 'paid') {
            console.log(`[TN Order] Orden ${orderId} no está pagada (${order.payment_status}), ignorando`);
            return;
        }
        const { updateVariantStock } = yield Promise.resolve().then(() => __importStar(require('./stock.controller')));
        let discountedCount = 0;
        for (const item of order.products || []) {
            const tnVariantIdRaw = (_41 = item.variant_id) !== null && _41 !== void 0 ? _41 : item.variantId;
            const tnVariantId = tnVariantIdRaw != null ? String(tnVariantIdRaw) : null;
            const tnProductId = item.product_id != null ? String(item.product_id) : '';
            const quantity = Math.max(0, parseInt(String((_42 = item.quantity) !== null && _42 !== void 0 ? _42 : 0), 10) || 0);
            const itemSku = (item.sku || item.variant_sku || '').toString().trim();
            if (quantity === 0)
                continue;
            if (tnProductId || tnVariantId) {
                const { findBundleByListing, deductStockForBundleListing } = yield Promise.resolve().then(() => __importStar(require('../services/publicationStockBundle.service')));
                const bundle = yield findBundleByListing('tiendanube', tnProductId || tnVariantId || '', tnVariantId || '');
                if ((_43 = bundle === null || bundle === void 0 ? void 0 : bundle.items) === null || _43 === void 0 ? void 0 : _43.length) {
                    const { ok, lines } = yield deductStockForBundleListing(bundle, quantity, 'VENTA_TIENDA_NUBE', `Orden TN: ${orderId}`);
                    if (ok)
                        discountedCount++;
                    console.log(`[TN Order] Pack multicolor "${bundle.label || bundle.externalProductId}": ${lines.join('; ')}`);
                    continue;
                }
            }
            let variant = null;
            if (tnVariantId) {
                const fromPub = yield (0, db_1.get)(`SELECT vp.variant_id AS id, COALESCE(vp.pack_size, 1) AS tn_pack FROM variant_publications vp WHERE vp.platform = 'tiendanube' AND vp.external_variant_id = ? LIMIT 1`, [tnVariantId]);
                if (fromPub === null || fromPub === void 0 ? void 0 : fromPub.id) {
                    const row = yield (0, db_1.get)(`SELECT stock AS current_stock FROM stocks WHERE variant_id = ?`, [fromPub.id]);
                    variant = { id: fromPub.id, current_stock: Number((_44 = row === null || row === void 0 ? void 0 : row.current_stock) !== null && _44 !== void 0 ? _44 : 0), tn_pack: Math.max(1, Number(fromPub.tn_pack) || 1) };
                }
            }
            if (!(variant === null || variant === void 0 ? void 0 : variant.id) && tnVariantId) {
                variant = yield (0, db_1.get)(`SELECT pv.id, s.stock AS current_stock, COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack
           FROM product_variants pv
           JOIN product_colors pc ON pc.id = pv.product_color_id
           JOIN products p ON p.id = pc.product_id
           LEFT JOIN stocks s ON s.variant_id = pv.id
           WHERE pv.tienda_nube_variant_id = ?`, [tnVariantId]);
            }
            if (!(variant === null || variant === void 0 ? void 0 : variant.id) && itemSku) {
                variant = yield (0, db_1.get)(`SELECT pv.id, s.stock AS current_stock, COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack
           FROM product_variants pv
           JOIN product_colors pc ON pc.id = pv.product_color_id
           JOIN products p ON p.id = pc.product_id
           LEFT JOIN stocks s ON s.variant_id = pv.id
           WHERE COALESCE(pv.external_sku, pv.sku) = ? OR pv.sku = ?`, [itemSku, itemSku]);
            }
            if (!(variant === null || variant === void 0 ? void 0 : variant.id) && itemSku) {
                variant = yield (0, db_1.get)(`SELECT pv.id, s.stock AS current_stock, COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack
           FROM product_variants pv
           LEFT JOIN stocks s ON s.variant_id = pv.id
           JOIN product_colors pc ON pc.id = pv.product_color_id
           JOIN products p ON p.id = pc.product_id
           WHERE p.sku = ? OR pv.sku LIKE ? OR pv.external_sku = ?`, [itemSku, `${itemSku}%`, itemSku]);
            }
            if (!(variant === null || variant === void 0 ? void 0 : variant.id) && itemSku) {
                const skuNorm = normalizeSkuForMatch(itemSku);
                const skuNormNoZero = skuNorm.replace(/^0+/, '');
                if (skuNorm) {
                    variant = yield (0, db_1.get)(`SELECT pv.id, s.stock AS current_stock, COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack
             FROM product_variants pv
             LEFT JOIN stocks s ON s.variant_id = pv.id
             JOIN product_colors pc ON pc.id = pv.product_color_id
             JOIN products p ON p.id = pc.product_id
             WHERE (
               REPLACE(REPLACE(REPLACE(UPPER(TRIM(COALESCE(pv.external_sku, pv.sku))), '-', ''), '/', ''), ' ', '') = ?
               OR TRIM(LEADING '0' FROM REPLACE(REPLACE(REPLACE(UPPER(TRIM(COALESCE(pv.external_sku, pv.sku))), '-', ''), '/', ''), ' ', '')) = ?
               OR REPLACE(REPLACE(REPLACE(UPPER(TRIM(p.sku)), '-', ''), '/', ''), ' ', '') = ?
               OR TRIM(LEADING '0' FROM REPLACE(REPLACE(REPLACE(UPPER(TRIM(p.sku)), '-', ''), '/', ''), ' ', '')) = ?
             )
             LIMIT 1`, [skuNorm, skuNormNoZero, skuNorm, skuNormNoZero]);
                }
            }
            if (variant === null || variant === void 0 ? void 0 : variant.id) {
                const tnPack = Math.max(1, Number(variant.tn_pack) || 1);
                const unitsToDeduct = quantity * tnPack;
                const currentStock = Number(variant.current_stock) || 0;
                const newStock = Math.max(0, currentStock - unitsToDeduct);
                const ok = yield updateVariantStock(variant.id, newStock, 'VENTA_TIENDA_NUBE', `Orden TN: ${orderId}`, true);
                if (ok) {
                    discountedCount++;
                    console.log(`[TN Order] Descontado ${unitsToDeduct} un. (${quantity} × pack x${tnPack}) variante ${variant.id}, stock: ${currentStock} -> ${newStock}; actualizado ML y TN`);
                }
                else {
                    console.error(`[TN Order] No se pudo actualizar stock para variante ${variant.id}`);
                }
            }
            else {
                console.warn(`[TN Order] Variante no encontrada: variant_id=${tnVariantId} sku=${itemSku}. Vinculá la variante en Inventario (IDs de Tienda Nube) para que el stock se descuente.`);
            }
        }
        if (discountedCount === 0 && productCount > 0) {
            console.warn(`[TN Order] Orden ${orderId}: no se descontó stock de ningún ítem (variantes no vinculadas o no encontradas).`);
        }
        else if (discountedCount > 0) {
            console.log(`[TN Order] Orden ${orderId}: descontado stock de ${discountedCount} ítem(s).`);
        }
    }
    catch (error) {
        console.error('[TN Order] Error procesando orden:', error.message);
    }
});
/** Restaurar stock cuando se cancela una orden de Tienda Nube (revierte los movimientos VENTA_TIENDA_NUBE de esa orden). */
const processTiendaNubeOrderCancelled = (orderId) => __awaiter(void 0, void 0, void 0, function* () {
    var _45;
    try {
        const ref = `Orden TN: ${orderId}`;
        const cancelRef = `Cancelación orden TN: ${orderId}`;
        const alreadyRestored = yield (0, db_1.get)(`SELECT id FROM stock_movements WHERE movement_type = 'CANCEL_VENTA_TIENDA_NUBE' AND reference = ? LIMIT 1`, [cancelRef]);
        if (alreadyRestored) {
            console.log(`[TN Order] Cancelación orden ${orderId} ya procesada, omitiendo`);
            return;
        }
        const movements = yield (0, db_1.query)(`SELECT variant_id, quantity_change FROM stock_movements
       WHERE movement_type = 'VENTA_TIENDA_NUBE' AND reference = ?
       ORDER BY created_at`, [ref]);
        if (!(movements === null || movements === void 0 ? void 0 : movements.length)) {
            console.log(`[TN Order] No hay movimientos de venta para orden ${orderId} (no se había descontado o orden distinta)`);
            return;
        }
        const { updateVariantStock } = yield Promise.resolve().then(() => __importStar(require('./stock.controller')));
        let restoredCount = 0;
        for (const m of movements) {
            const amountToRestore = Math.abs(Number(m.quantity_change) || 0);
            if (amountToRestore <= 0)
                continue;
            const row = yield (0, db_1.get)(`SELECT stock FROM stocks WHERE variant_id = ?`, [m.variant_id]);
            const currentStock = Number((_45 = row === null || row === void 0 ? void 0 : row.stock) !== null && _45 !== void 0 ? _45 : 0);
            const newStock = currentStock + amountToRestore;
            const ok = yield updateVariantStock(m.variant_id, newStock, 'CANCEL_VENTA_TIENDA_NUBE', cancelRef, true);
            if (ok) {
                restoredCount++;
                console.log(`[TN Order] Restaurado ${amountToRestore} para variante ${m.variant_id}, stock: ${currentStock} -> ${newStock}`);
            }
        }
        if (restoredCount > 0) {
            console.log(`[TN Order] Orden ${orderId} cancelada: restaurado stock de ${restoredCount} ítem(s).`);
        }
    }
    catch (error) {
        console.error('[TN Order] Error restaurando stock por cancelación:', error.message);
    }
});
/** Prueba manual: procesar una orden de Tienda Nube por ID (mismo flujo que el webhook). Útil para verificar que el stock se descuenta. */
const testTiendaNubeOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _46, _47, _48, _49;
    try {
        const orderId = ((_49 = (_47 = (_46 = req.body) === null || _46 === void 0 ? void 0 : _46.orderId) !== null && _47 !== void 0 ? _47 : (_48 = req.query) === null || _48 === void 0 ? void 0 : _48.orderId) !== null && _49 !== void 0 ? _49 : '').toString().trim();
        if (!orderId) {
            return res.status(400).json({
                message: 'Falta orderId. Ejemplo: POST con body { "orderId": "12345" } o GET ?orderId=12345',
                hint: 'El ID es el de la orden en Tienda Nube (no el número de orden). Lo ves en la URL al abrir la orden en el panel de TN.',
            });
        }
        yield processTiendaNubeOrder(orderId);
        res.json({
            message: 'Procesamiento finalizado. Revisá los logs del backend y el Historial de stock para ver si se descontó.',
            orderId,
        });
    }
    catch (error) {
        console.error('[TN Test Order]', error === null || error === void 0 ? void 0 : error.message);
        res.status(500).json({ message: (error === null || error === void 0 ? void 0 : error.message) || 'Error al procesar orden de prueba' });
    }
});
exports.testTiendaNubeOrder = testTiendaNubeOrder;
/** Descontar stock de todas las ventas pagadas de Tienda Nube desde una fecha (ej. para sincronizar ventas que no se descontaron). Idempotente: órdenes ya procesadas se omiten. */
const syncTiendaNubeOrdersFromDate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _50, _51, _52, _53, _54, _55;
    try {
        const fromParam = ((_53 = (_51 = (_50 = req.body) === null || _50 === void 0 ? void 0 : _50.fromDate) !== null && _51 !== void 0 ? _51 : (_52 = req.query) === null || _52 === void 0 ? void 0 : _52.fromDate) !== null && _53 !== void 0 ? _53 : '2026-03-09').toString().trim();
        const fromDate = fromParam.slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
            return res.status(400).json({ message: 'fromDate debe ser YYYY-MM-DD (ej. 2026-03-09)' });
        }
        const integration = yield (0, db_1.get)(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
        if (!(integration === null || integration === void 0 ? void 0 : integration.access_token)) {
            return res.status(400).json({ message: 'No estás conectado a Tienda Nube' });
        }
        const storeId = integration.store_id || integration.user_id;
        if (!storeId) {
            return res.status(400).json({ message: 'Falta store_id en la integración de Tienda Nube' });
        }
        const headers = {
            'Authentication': `bearer ${integration.access_token}`,
            'User-Agent': TN_USER_AGENT
        };
        let totalOrders = 0;
        let page = 1;
        const perPage = 50;
        let hasMore = true;
        while (hasMore && page <= 20) {
            const listRes = yield axios_1.default.get(`https://api.tiendanube.com/v1/${storeId}/orders`, {
                params: {
                    page,
                    per_page: perPage,
                    payment_status: 'paid',
                    created_at_min: `${fromDate}T00:00:00`
                },
                headers,
                validateStatus: () => true
            });
            if (listRes.status !== 200) {
                const errMsg = ((_54 = listRes.data) === null || _54 === void 0 ? void 0 : _54.message) || ((_55 = listRes.data) === null || _55 === void 0 ? void 0 : _55.error) || JSON.stringify(listRes.data);
                return res.status(listRes.status === 403 ? 403 : 500).json({
                    message: `Error al listar órdenes de Tienda Nube: ${errMsg}`,
                    hint: listRes.status === 403 ? 'Reconectá Tienda Nube (scope read_orders).' : undefined
                });
            }
            const orders = Array.isArray(listRes.data) ? listRes.data : [];
            for (const order of orders) {
                const orderId = order.id != null ? String(order.id) : '';
                if (orderId) {
                    yield processTiendaNubeOrder(orderId);
                    totalOrders++;
                }
            }
            if (orders.length < perPage)
                hasMore = false;
            else
                page++;
        }
        res.json({
            message: `Se procesaron las órdenes pagadas de Tienda Nube desde el ${fromDate}. Las que ya tenían stock descontado se omitieron.`,
            fromDate,
            totalOrders,
        });
    }
    catch (error) {
        console.error('[TN Sync From Date]', error === null || error === void 0 ? void 0 : error.message);
        res.status(500).json({ message: (error === null || error === void 0 ? void 0 : error.message) || 'Error al sincronizar órdenes desde fecha' });
    }
});
exports.syncTiendaNubeOrdersFromDate = syncTiendaNubeOrdersFromDate;
/** Descontar stock de todas las ventas pagadas de Mercado Libre desde una fecha.
 * Idempotente: órdenes ya procesadas se omiten por movimiento VENTA_MERCADO_LIBRE.
 */
const syncMercadoLibreOrdersFromDate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _56, _57, _58, _59, _60, _61, _62;
    try {
        const fromParam = ((_59 = (_57 = (_56 = req.body) === null || _56 === void 0 ? void 0 : _56.fromDate) !== null && _57 !== void 0 ? _57 : (_58 = req.query) === null || _58 === void 0 ? void 0 : _58.fromDate) !== null && _59 !== void 0 ? _59 : '2026-03-09').toString().trim();
        const fromDate = fromParam.slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
            return res.status(400).json({ message: 'fromDate debe ser YYYY-MM-DD (ej. 2026-03-09)' });
        }
        const mlToken = yield getValidMLToken();
        if (!(mlToken === null || mlToken === void 0 ? void 0 : mlToken.access_token) || !(mlToken === null || mlToken === void 0 ? void 0 : mlToken.user_id)) {
            return res.status(400).json({ message: 'No estás conectado a Mercado Libre' });
        }
        let totalOrders = 0;
        let offset = 0;
        const limit = 50;
        let keepGoing = true;
        while (keepGoing && offset < 5000) {
            const searchRes = yield axios_1.default.get(`https://api.mercadolibre.com/orders/search?seller=${mlToken.user_id}&order.status=paid&order.date_created.from=${fromDate}T00:00:00.000-03:00&offset=${offset}&limit=${limit}&sort=date_desc`, { headers: { 'Authorization': `Bearer ${mlToken.access_token}` }, validateStatus: () => true });
            if (searchRes.status !== 200) {
                const errMsg = ((_60 = searchRes.data) === null || _60 === void 0 ? void 0 : _60.message) ||
                    ((_61 = searchRes.data) === null || _61 === void 0 ? void 0 : _61.error) ||
                    JSON.stringify(searchRes.data);
                return res.status(searchRes.status === 403 ? 403 : 500).json({
                    message: `Error al listar órdenes de Mercado Libre: ${errMsg}`,
                    hint: searchRes.status === 403 ? 'Reconectá Mercado Libre.' : undefined
                });
            }
            const results = Array.isArray((_62 = searchRes.data) === null || _62 === void 0 ? void 0 : _62.results) ? searchRes.data.results : [];
            for (const row of results) {
                const orderId = (row === null || row === void 0 ? void 0 : row.id) != null ? String(row.id) : '';
                if (!orderId)
                    continue;
                yield processMercadoLibreOrder(orderId);
                totalOrders++;
            }
            if (results.length < limit)
                keepGoing = false;
            else
                offset += limit;
        }
        res.json({
            message: `Se procesaron las órdenes pagadas de Mercado Libre desde el ${fromDate}. Las que ya tenían stock descontado se omitieron.`,
            fromDate,
            totalOrders,
        });
    }
    catch (error) {
        console.error('[ML Sync From Date]', error === null || error === void 0 ? void 0 : error.message);
        res.status(500).json({ message: (error === null || error === void 0 ? void 0 : error.message) || 'Error al sincronizar órdenes de Mercado Libre desde fecha' });
    }
});
exports.syncMercadoLibreOrdersFromDate = syncMercadoLibreOrdersFromDate;
/** Prueba manual: procesar una orden de Mercado Libre por ID (mismo flujo que el webhook). */
const testMercadoLibreOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _63, _64, _65, _66, _67, _68;
    try {
        const orderId = ((_66 = (_64 = (_63 = req.body) === null || _63 === void 0 ? void 0 : _63.orderId) !== null && _64 !== void 0 ? _64 : (_65 = req.query) === null || _65 === void 0 ? void 0 : _65.orderId) !== null && _66 !== void 0 ? _66 : '').toString().trim();
        if (!orderId) {
            return res.status(400).json({
                message: 'Falta orderId. Ejemplo: POST con body { "orderId": "2000015720058034" } o GET ?orderId=2000015720058034'
            });
        }
        const ref = `Orden ML: ${orderId}`;
        const before = yield (0, db_1.get)(`SELECT COUNT(*) AS n FROM stock_movements WHERE movement_type = 'VENTA_MERCADO_LIBRE' AND reference = ?`, [ref]);
        yield processMercadoLibreOrder(orderId);
        const after = yield (0, db_1.get)(`SELECT COUNT(*) AS n FROM stock_movements WHERE movement_type = 'VENTA_MERCADO_LIBRE' AND reference = ?`, [ref]);
        const beforeN = Number((_67 = before === null || before === void 0 ? void 0 : before.n) !== null && _67 !== void 0 ? _67 : 0);
        const afterN = Number((_68 = after === null || after === void 0 ? void 0 : after.n) !== null && _68 !== void 0 ? _68 : 0);
        const created = Math.max(0, afterN - beforeN);
        return res.json({
            orderId,
            movementReference: ref,
            movementsBefore: beforeN,
            movementsAfter: afterN,
            createdMovements: created,
            message: created > 0
                ? `OK: se crearon ${created} movimiento(s) VENTA_MERCADO_LIBRE.`
                : 'No se crearon movimientos nuevos. Revisá vínculos de la variante (item_id/variation_id/SKU) y logs de backend para este orderId.'
        });
    }
    catch (error) {
        console.error('[ML Test Order]', error === null || error === void 0 ? void 0 : error.message);
        res.status(500).json({ message: (error === null || error === void 0 ? void 0 : error.message) || 'Error al procesar orden de prueba de Mercado Libre' });
    }
});
exports.testMercadoLibreOrder = testMercadoLibreOrder;
// Webhook de Mercado Libre para órdenes/ventas
const handleMercadoLibreWebhook = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _69, _70, _71, _72, _73, _74, _75, _76, _77, _78, _79, _80, _81;
    try {
        const topic = ((_72 = (_70 = (_69 = req.body) === null || _69 === void 0 ? void 0 : _69.topic) !== null && _70 !== void 0 ? _70 : (_71 = req.query) === null || _71 === void 0 ? void 0 : _71.topic) !== null && _72 !== void 0 ? _72 : '').toString();
        const resourceRaw = ((_76 = (_74 = (_73 = req.body) === null || _73 === void 0 ? void 0 : _73.resource) !== null && _74 !== void 0 ? _74 : (_75 = req.query) === null || _75 === void 0 ? void 0 : _75.resource) !== null && _76 !== void 0 ? _76 : '').toString();
        const userIdRaw = ((_80 = (_78 = (_77 = req.body) === null || _77 === void 0 ? void 0 : _77.user_id) !== null && _78 !== void 0 ? _78 : (_79 = req.query) === null || _79 === void 0 ? void 0 : _79.user_id) !== null && _80 !== void 0 ? _80 : '').toString();
        console.log(`[ML Webhook] Topic: ${topic}, Resource: ${resourceRaw}, User: ${userIdRaw || '-'}`);
        // Verificar user_id solo cuando viene en el webhook.
        // Mercado Libre a veces no lo envía y eso hacía que nunca se procese la orden.
        const integration = yield (0, db_1.get)(`SELECT user_id FROM integrations WHERE platform = 'mercadolibre'`);
        const storedUserId = (_81 = integration === null || integration === void 0 ? void 0 : integration.user_id) === null || _81 === void 0 ? void 0 : _81.toString();
        if (!integration) {
            console.log('[ML Webhook] No hay integración de Mercado Libre, ignorando');
            return res.status(200).json({ received: true, ignored: true });
        }
        if (userIdRaw && storedUserId && storedUserId !== userIdRaw) {
            console.log('[ML Webhook] User ID no coincide, ignorando');
            return res.status(200).json({ received: true, ignored: true });
        }
        // Procesar según el tipo de notificación
        if (topic === 'orders_v2' || topic === 'orders') {
            const orderId = (() => {
                if (!resourceRaw)
                    return '';
                const m = resourceRaw.match(/\/orders\/(\d+)/);
                if (m === null || m === void 0 ? void 0 : m[1])
                    return m[1];
                const parts = resourceRaw.split('/').filter(Boolean);
                return parts.length > 0 ? parts[parts.length - 1] : '';
            })();
            if (orderId) {
                yield processMercadoLibreOrder(orderId);
            }
            else {
                console.warn('[ML Webhook] No se pudo extraer orderId desde resource:', resourceRaw);
            }
        }
        /** Preguntas: responder con IA si está habilitado (no bloquea la respuesta 200 al webhook). */
        if (topic === 'questions') {
            const qm = resourceRaw.match(/questions\/(\d+)/);
            const questionId = qm === null || qm === void 0 ? void 0 : qm[1];
            if (questionId) {
                setImmediate(() => {
                    (() => __awaiter(void 0, void 0, void 0, function* () {
                        var _a;
                        try {
                            const cfg = yield mlQuestionsAi.getMlQuestionsAiConfigRow();
                            if (!cfg.enabled || !mlQuestionsAi.openAiConfigured())
                                return;
                            const t = yield getValidMLToken();
                            if (!t)
                                return;
                            yield mlQuestionsAi.processOneQuestion(t.access_token, questionId, {
                                extraSystemPrompt: cfg.extraSystemPrompt
                            });
                            console.log(`[ML Questions AI] Procesada pregunta ${questionId}`);
                        }
                        catch (e) {
                            console.error('[ML Questions AI] Error:', ((_a = e === null || e === void 0 ? void 0 : e.response) === null || _a === void 0 ? void 0 : _a.data) || (e === null || e === void 0 ? void 0 : e.message) || e);
                        }
                    }))();
                });
            }
        }
        res.status(200).json({ received: true });
    }
    catch (error) {
        console.error('[ML Webhook] Error:', error.message);
        res.status(200).json({ received: true, error: error.message });
    }
});
exports.handleMercadoLibreWebhook = handleMercadoLibreWebhook;
// Procesar orden de Mercado Libre y descontar stock
const processMercadoLibreOrder = (orderId) => __awaiter(void 0, void 0, void 0, function* () {
    var _82, _83, _84, _85, _86;
    // Lock efímero para evitar doble procesamiento concurrente del mismo orderId (MySQL en prod).
    yield (0, db_1.execute)(`CREATE TABLE IF NOT EXISTS integration_order_locks (
      platform VARCHAR(64) NOT NULL,
      external_order_id VARCHAR(191) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (platform, external_order_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const lockPlatform = 'mercadolibre';
    let lockAcquired = false;
    try {
        try {
            yield (0, db_1.execute)(`INSERT INTO integration_order_locks (platform, external_order_id) VALUES (?, ?)`, [lockPlatform, orderId]);
            lockAcquired = true;
        }
        catch (e) {
            const msg = String((e === null || e === void 0 ? void 0 : e.message) || '');
            const dup = msg.includes('UNIQUE constraint failed') ||
                msg.includes('SQLITE_CONSTRAINT') ||
                (e === null || e === void 0 ? void 0 : e.code) === 'ER_DUP_ENTRY' ||
                msg.includes('Duplicate entry');
            if (dup) {
                console.log(`[ML Order] Orden ${orderId} en procesamiento concurrente, omitiendo`);
                return;
            }
            throw e;
        }
        // Idempotencia: evitar descontar dos veces por reintentos/notificaciones repetidas.
        const alreadyProcessed = yield (0, db_1.get)(`SELECT id FROM stock_movements WHERE movement_type = 'VENTA_MERCADO_LIBRE' AND reference = ? LIMIT 1`, [`Orden ML: ${orderId}`]);
        if (alreadyProcessed) {
            console.log(`[ML Order] Orden ${orderId} ya procesada, omitiendo`);
            return;
        }
        const mlToken = yield getValidMLToken();
        if (!mlToken)
            return;
        const orderRes = yield axios_1.default.get(`https://api.mercadolibre.com/orders/${orderId}`, {
            headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
        });
        const order = orderRes.data;
        console.log(`[ML Order] Procesando orden ${orderId}, estado: ${order.status}`);
        // Solo procesar órdenes pagadas
        if (order.status !== 'paid') {
            console.log(`[ML Order] Orden ${orderId} no está pagada, ignorando`);
            return;
        }
        // Enviar mensaje de agradecimiento al comprador
        yield sendThankYouMessage(orderId, order, mlToken.access_token);
        const { updateVariantStock } = yield Promise.resolve().then(() => __importStar(require('./stock.controller')));
        for (const item of order.order_items || []) {
            const mlItemId = (_82 = item.item) === null || _82 === void 0 ? void 0 : _82.id;
            const mlVariationId = (_83 = item.item) === null || _83 === void 0 ? void 0 : _83.variation_id;
            const quantity = item.quantity;
            let itemSku = (((_84 = item.item) === null || _84 === void 0 ? void 0 : _84.sku) || item.sku || '').toString().trim();
            if (!itemSku) {
                itemSku = yield resolveMlOrderItemSku(mlToken.access_token, mlItemId, mlVariationId);
            }
            if (mlItemId) {
                const { findBundleByListing, deductStockForBundleListing } = yield Promise.resolve().then(() => __importStar(require('../services/publicationStockBundle.service')));
                const extVar = (mlVariationId && String(mlVariationId).trim()) || '';
                const bundle = yield findBundleByListing('mercadolibre', mlItemId, extVar);
                if ((_85 = bundle === null || bundle === void 0 ? void 0 : bundle.items) === null || _85 === void 0 ? void 0 : _85.length) {
                    const { ok, lines } = yield deductStockForBundleListing(bundle, quantity, 'VENTA_MERCADO_LIBRE', `Orden ML: ${orderId}`);
                    console.log(`[ML Order] Pack multicolor "${bundle.label || bundle.externalProductId}": ${lines.join('; ')}`);
                    continue;
                }
            }
            let variant = null;
            if (mlItemId) {
                const extVariantId = (mlVariationId && String(mlVariationId).trim()) || '';
                const fromPub = yield (0, db_1.get)(`SELECT vp.variant_id AS id, COALESCE(vp.pack_size, 1) AS ml_pack FROM variant_publications vp WHERE vp.platform = 'mercadolibre' AND vp.external_product_id = ? AND vp.external_variant_id = ? LIMIT 1`, [mlItemId, extVariantId]);
                if (fromPub === null || fromPub === void 0 ? void 0 : fromPub.id) {
                    const row = yield (0, db_1.get)(`SELECT stock AS current_stock FROM stocks WHERE variant_id = ?`, [fromPub.id]);
                    variant = { id: fromPub.id, current_stock: Number((_86 = row === null || row === void 0 ? void 0 : row.current_stock) !== null && _86 !== void 0 ? _86 : 0), ml_pack: Math.max(1, Number(fromPub.ml_pack) || 1) };
                }
            }
            // Fallback legacy: variantes vinculadas por columna pv.mercado_libre_item_id
            if (!(variant === null || variant === void 0 ? void 0 : variant.id) && mlItemId) {
                variant = yield (0, db_1.get)(`SELECT pv.id, s.stock AS current_stock, COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack
           FROM product_variants pv
           JOIN product_colors pc ON pc.id = pv.product_color_id
           JOIN products p ON p.id = pc.product_id
           LEFT JOIN stocks s ON s.variant_id = pv.id
           WHERE pv.mercado_libre_item_id = ?
           LIMIT 1`, [mlItemId]);
            }
            // Fallback por producto padre ML: cuando el vínculo está en products.mercado_libre_id
            // y la venta viene sin variation_id.
            if (!(variant === null || variant === void 0 ? void 0 : variant.id) && mlItemId) {
                if (itemSku) {
                    const skuNorm = normalizeSkuForMatch(itemSku);
                    const skuNormNoZero = skuNorm.replace(/^0+/, '');
                    variant = yield (0, db_1.get)(`SELECT pv.id, s.stock AS current_stock, COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack
             FROM products p
             JOIN product_colors pc ON pc.product_id = p.id
             JOIN product_variants pv ON pv.product_color_id = pc.id
             LEFT JOIN stocks s ON s.variant_id = pv.id
             WHERE p.mercado_libre_id = ?
               AND (
                 REPLACE(REPLACE(REPLACE(UPPER(TRIM(COALESCE(pv.external_sku, pv.sku))), '-', ''), '/', ''), ' ', '') = ?
                 OR TRIM(LEADING '0' FROM REPLACE(REPLACE(REPLACE(UPPER(TRIM(COALESCE(pv.external_sku, pv.sku))), '-', ''), '/', ''), ' ', '')) = ?
               )
             LIMIT 1`, [mlItemId, skuNorm, skuNormNoZero]);
                }
                // Si sigue sin match y el artículo local tiene una sola variante, usarla
                if (!(variant === null || variant === void 0 ? void 0 : variant.id)) {
                    variant = yield (0, db_1.get)(`SELECT pv.id, s.stock AS current_stock, COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack
             FROM products p
             JOIN product_colors pc ON pc.product_id = p.id
             JOIN product_variants pv ON pv.product_color_id = pc.id
             LEFT JOIN stocks s ON s.variant_id = pv.id
             WHERE p.mercado_libre_id = ?
             GROUP BY pv.id, s.stock, p.mercado_libre_pack_size
             ORDER BY pv.id
             LIMIT 1`, [mlItemId]);
                    const countRow = yield (0, db_1.get)(`SELECT COUNT(*) AS n
             FROM products p
             JOIN product_colors pc ON pc.product_id = p.id
             JOIN product_variants pv ON pv.product_color_id = pc.id
             WHERE p.mercado_libre_id = ?`, [mlItemId]);
                    if (Number((countRow === null || countRow === void 0 ? void 0 : countRow.n) || 0) !== 1) {
                        variant = null;
                    }
                }
            }
            if (!(variant === null || variant === void 0 ? void 0 : variant.id) && mlVariationId) {
                variant = yield (0, db_1.get)(`SELECT pv.id, s.stock AS current_stock, COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack
           FROM product_variants pv
           JOIN product_colors pc ON pc.id = pv.product_color_id
           JOIN products p ON p.id = pc.product_id
           LEFT JOIN stocks s ON s.variant_id = pv.id
           WHERE pv.mercado_libre_variant_id = ?`, [mlVariationId]);
            }
            if (!(variant === null || variant === void 0 ? void 0 : variant.id) && itemSku) {
                variant = yield (0, db_1.get)(`SELECT pv.id, s.stock AS current_stock, COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack
           FROM product_variants pv
           JOIN product_colors pc ON pc.id = pv.product_color_id
           JOIN products p ON p.id = pc.product_id
           LEFT JOIN stocks s ON s.variant_id = pv.id
           WHERE COALESCE(pv.external_sku, pv.sku) = ? OR pv.sku = ?`, [itemSku, itemSku]);
            }
            if (!(variant === null || variant === void 0 ? void 0 : variant.id) && itemSku) {
                variant = yield (0, db_1.get)(`SELECT pv.id, s.stock AS current_stock, COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack
           FROM product_variants pv
           LEFT JOIN stocks s ON s.variant_id = pv.id
           JOIN product_colors pc ON pc.id = pv.product_color_id
           JOIN products p ON p.id = pc.product_id
           WHERE p.sku = ? OR pv.sku LIKE ? OR pv.external_sku = ?`, [itemSku, `${itemSku}%`, itemSku]);
            }
            if (!(variant === null || variant === void 0 ? void 0 : variant.id) && itemSku) {
                const skuNorm = normalizeSkuForMatch(itemSku);
                const skuNormNoZero = skuNorm.replace(/^0+/, '');
                if (skuNorm) {
                    variant = yield (0, db_1.get)(`SELECT pv.id, s.stock AS current_stock, COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack
             FROM product_variants pv
             LEFT JOIN stocks s ON s.variant_id = pv.id
             JOIN product_colors pc ON pc.id = pv.product_color_id
             JOIN products p ON p.id = pc.product_id
             WHERE (
               REPLACE(REPLACE(REPLACE(UPPER(TRIM(COALESCE(pv.external_sku, pv.sku))), '-', ''), '/', ''), ' ', '') = ?
               OR TRIM(LEADING '0' FROM REPLACE(REPLACE(REPLACE(UPPER(TRIM(COALESCE(pv.external_sku, pv.sku))), '-', ''), '/', ''), ' ', '')) = ?
               OR REPLACE(REPLACE(REPLACE(UPPER(TRIM(p.sku)), '-', ''), '/', ''), ' ', '') = ?
               OR TRIM(LEADING '0' FROM REPLACE(REPLACE(REPLACE(UPPER(TRIM(p.sku)), '-', ''), '/', ''), ' ', '')) = ?
             )
             LIMIT 1`, [skuNorm, skuNormNoZero, skuNorm, skuNormNoZero]);
                }
            }
            if (variant === null || variant === void 0 ? void 0 : variant.id) {
                const mlPack = Math.max(1, Number(variant.ml_pack) || 1);
                const unitsToDeduct = quantity * mlPack;
                const currentStock = Number(variant.current_stock) || 0;
                const newStock = Math.max(0, currentStock - unitsToDeduct);
                yield updateVariantStock(variant.id, newStock, 'VENTA_MERCADO_LIBRE', `Orden ML: ${orderId}`, true);
                console.log(`[ML Order] Descontado ${unitsToDeduct} un. (${quantity} × pack x${mlPack}) variante ${variant.id}, stock: ${currentStock} -> ${newStock}; actualizado ML y TN`);
            }
            else if (mlVariationId || itemSku) {
                console.log(`[ML Order] Variante no encontrada para ML item_id=${mlItemId} variation_id=${mlVariationId} sku=${itemSku}`);
            }
        }
    }
    catch (error) {
        console.error('[ML Order] Error procesando orden:', error.message);
    }
    finally {
        if (lockAcquired) {
            try {
                yield (0, db_1.execute)(`DELETE FROM integration_order_locks WHERE platform = ? AND external_order_id = ?`, [lockPlatform, orderId]);
            }
            catch (_87) {
                // No romper flujo por falla al limpiar lock efimero.
            }
        }
    }
});
// Enviar mensaje de agradecimiento al comprador de ML
const sendThankYouMessage = (orderId, order, accessToken) => __awaiter(void 0, void 0, void 0, function* () {
    var _88, _89, _90, _91, _92, _93, _94, _95, _96;
    try {
        // Verificar si el mensaje automático está habilitado
        const config = yield (0, db_1.get)(`SELECT enabled, message_template FROM ml_auto_message_config WHERE id = 1`);
        if (config && !config.enabled) {
            console.log(`[ML Message] Mensaje automático deshabilitado, omitiendo orden ${orderId}`);
            return;
        }
        const buyerId = (_88 = order.buyer) === null || _88 === void 0 ? void 0 : _88.id;
        if (!buyerId) {
            console.log(`[ML Message] No se encontró buyer_id para orden ${orderId}`);
            return;
        }
        // Verificar si ya enviamos mensaje para esta orden (evitar duplicados)
        const alreadySent = yield (0, db_1.get)(`SELECT id FROM ml_messages_sent WHERE order_id = ?`, [orderId]);
        if (alreadySent) {
            console.log(`[ML Message] Ya se envió mensaje para orden ${orderId}, omitiendo`);
            return;
        }
        // Obtener el nombre del comprador
        const buyerName = ((_89 = order.buyer) === null || _89 === void 0 ? void 0 : _89.first_name) || ((_90 = order.buyer) === null || _90 === void 0 ? void 0 : _90.nickname) || 'Cliente';
        // Obtener los productos comprados para personalizar el mensaje
        const productNames = (order.order_items || [])
            .map((item) => { var _a; return (_a = item.item) === null || _a === void 0 ? void 0 : _a.title; })
            .filter(Boolean)
            .slice(0, 2) // Máximo 2 productos en el mensaje
            .join(' y ');
        // Usar plantilla personalizada o mensaje por defecto
        let message;
        if (config === null || config === void 0 ? void 0 : config.message_template) {
            message = config.message_template
                .replace('{nombre}', buyerName)
                .replace('{productos}', productNames ? ` de ${productNames}` : '');
        }
        else {
            message = `¡Hola ${buyerName}! 🙌

Muchas gracias por tu compra${productNames ? ` de ${productNames}` : ''}. 

Tu pedido ya está siendo preparado con mucho cuidado. Te avisaremos apenas lo despachemos.

Si tenés alguna consulta, no dudes en escribirnos. ¡Gracias por confiar en nosotros!

Saludos,
Equipo Lupo`;
        }
        // Enviar mensaje usando la API de mensajes de ML
        // La API de mensajes usa el pack_id (si existe) o el order_id
        const packId = order.pack_id || orderId;
        yield axios_1.default.post(`https://api.mercadolibre.com/messages/packs/${packId}/sellers/${((_91 = order.seller) === null || _91 === void 0 ? void 0 : _91.id) || ((_92 = (yield getValidMLToken())) === null || _92 === void 0 ? void 0 : _92.user_id)}`, {
            from: {
                user_id: (_93 = order.seller) === null || _93 === void 0 ? void 0 : _93.id
            },
            to: {
                user_id: buyerId
            },
            text: message
        }, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        // Registrar que ya enviamos el mensaje
        yield (0, db_1.execute)(`INSERT INTO ml_messages_sent (order_id, buyer_id, sent_at) VALUES (?, ?, NOW())`, [orderId, buyerId]);
        console.log(`[ML Message] ✓ Mensaje de agradecimiento enviado para orden ${orderId} a ${buyerName}`);
    }
    catch (error) {
        // Si la tabla no existe, crearla
        if (((_94 = error.message) === null || _94 === void 0 ? void 0 : _94.includes('ml_messages_sent')) || error.code === 'ER_NO_SUCH_TABLE') {
            try {
                yield (0, db_1.execute)(`
          CREATE TABLE IF NOT EXISTS ml_messages_sent (
            id INT AUTO_INCREMENT PRIMARY KEY,
            order_id VARCHAR(50) NOT NULL UNIQUE,
            buyer_id VARCHAR(50),
            sent_at DATETIME,
            INDEX idx_order_id (order_id)
          )
        `);
                console.log('[ML Message] Tabla ml_messages_sent creada');
            }
            catch (tableError) {
                console.error('[ML Message] Error creando tabla:', tableError);
            }
        }
        // Log del error pero no fallar el proceso principal
        const errData = ((_95 = error.response) === null || _95 === void 0 ? void 0 : _95.data) || {};
        const isNotFound = ((_96 = error.response) === null || _96 === void 0 ? void 0 : _96.status) === 404 || (errData.error === 'resource not found');
        if (isNotFound) {
            console.warn(`[ML Message] Mensaje automático no disponible para orden ${orderId} (API ML: recurso no encontrado). El pedido y el stock se procesaron correctamente.`);
        }
        else {
            console.error(`[ML Message] Error enviando mensaje para orden ${orderId}:`, errData.error ? { error: errData.error, message: errData.message } : error.message);
        }
    }
});
/** Sincronización automática ML → TN (sin tocar inventario local). ML = fuente de verdad para canales. Incluye variantes con publicación padre (mercado_libre_id + variant_id) y variantes con publicación propia (mercado_libre_item_id). */
function runAutoSyncMLtoTN() {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    return __awaiter(this, void 0, void 0, function* () {
        const mlToken = yield getValidMLToken();
        const tnIntegration = yield (0, db_1.get)(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);
        if (!mlToken || !(tnIntegration === null || tnIntegration === void 0 ? void 0 : tnIntegration.access_token) || !(tnIntegration === null || tnIntegration === void 0 ? void 0 : tnIntegration.store_id)) {
            return { updated: 0, errors: 0 };
        }
        let updated = 0;
        let errors = 0;
        // 1) Variantes con publicación padre ML (una publicación con varias variaciones)
        const rows = yield (0, db_1.query)(`
    SELECT p.mercado_libre_id AS ml_id, pv.mercado_libre_variant_id AS ml_variant_id,
           p.tienda_nube_id AS tn_id, pv.tienda_nube_variant_id AS tn_variant_id,
           COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack,
           COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack
    FROM product_variants pv
    JOIN product_colors pc ON pc.id = pv.product_color_id
    JOIN products p ON p.id = pc.product_id
    WHERE p.mercado_libre_id IS NOT NULL AND pv.mercado_libre_variant_id IS NOT NULL
      AND p.tienda_nube_id IS NOT NULL AND pv.tienda_nube_variant_id IS NOT NULL
  `);
        if (rows === null || rows === void 0 ? void 0 : rows.length) {
            const byMlId = new Map();
            for (const r of rows) {
                const id = r.ml_id;
                if (!byMlId.has(id))
                    byMlId.set(id, []);
                byMlId.get(id).push(r);
            }
            const mlIds = Array.from(byMlId.keys());
            const batchSize = 10;
            for (let i = 0; i < mlIds.length; i += batchSize) {
                const batch = mlIds.slice(i, i + batchSize);
                const itemPromises = batch.map((id) => axios_1.default.get(`https://api.mercadolibre.com/items/${id}?include_attributes=all`, {
                    headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
                }).then(r => r.data).catch(() => null));
                const items = yield Promise.all(itemPromises);
                for (let j = 0; j < batch.length; j++) {
                    const item = items[j];
                    const mlId = batch[j];
                    const variantRows = byMlId.get(mlId) || [];
                    if (!item) {
                        errors += variantRows.length;
                        continue;
                    }
                    const variations = item.variations || [];
                    for (const vr of variantRows) {
                        const r = vr;
                        const v = variations.find((x) => String(x.id) === String(r.ml_variant_id));
                        if (!v && variations.length > 0) {
                            console.warn(`[AutoSync ML→TN] Omitido: no se encontró variación ML ${r.ml_variant_id} en item ${mlId}. Se evita enviar 0 a TN.`);
                            continue;
                        }
                        const mlQty = v ? ((_a = v.available_quantity) !== null && _a !== void 0 ? _a : 0) : ((_b = item.available_quantity) !== null && _b !== void 0 ? _b : 0);
                        const mlPack = Math.max(1, Number(r.ml_pack) || 1);
                        const tnPack = Math.max(1, Number(r.tn_pack) || 1);
                        const tnStock = Math.floor((Number(mlQty) * mlPack) / tnPack);
                        try {
                            yield putTnVariantWithRetry(`https://api.tiendanube.com/v1/${tnIntegration.store_id}/products/${r.tn_id}/variants/${r.tn_variant_id}`, { stock: tnStock }, { 'Authentication': `bearer ${tnIntegration.access_token}`, 'Content-Type': 'application/json', 'User-Agent': TN_USER_AGENT });
                            updated++;
                        }
                        catch (e) {
                            errors++;
                            console.warn(`[AutoSync ML→TN] Error TN PUT variante ml_variant=${r.ml_variant_id} tn=${r.tn_id}/${r.tn_variant_id}:`, ((_d = (_c = e.response) === null || _c === void 0 ? void 0 : _c.data) === null || _d === void 0 ? void 0 : _d.message) || e.message);
                        }
                        if (TN_RATE_LIMIT_DELAY_MS > 0)
                            yield sleep(TN_RATE_LIMIT_DELAY_MS);
                    }
                }
            }
        }
        // 2) Variantes con publicación propia en ML (cada variante = un ítem ML). Sincronizar stock ML → TN.
        const rowsByItem = yield (0, db_1.query)(`
    SELECT pv.mercado_libre_item_id AS ml_item_id,
           p.tienda_nube_id AS tn_id, pv.tienda_nube_variant_id AS tn_variant_id,
           COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack,
           COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack,
           pv.sku
    FROM product_variants pv
    JOIN product_colors pc ON pc.id = pv.product_color_id
    JOIN products p ON p.id = pc.product_id
    WHERE pv.mercado_libre_item_id IS NOT NULL
      AND p.tienda_nube_id IS NOT NULL AND pv.tienda_nube_variant_id IS NOT NULL
  `);
        if (rowsByItem === null || rowsByItem === void 0 ? void 0 : rowsByItem.length) {
            const batchSize = 10;
            for (let i = 0; i < rowsByItem.length; i += batchSize) {
                const batch = rowsByItem.slice(i, i + batchSize);
                const itemPromises = batch.map((row) => axios_1.default.get(`https://api.mercadolibre.com/items/${row.ml_item_id}`, {
                    headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
                }).then(r => r.data).catch(() => null));
                const items = yield Promise.all(itemPromises);
                for (let j = 0; j < batch.length; j++) {
                    const item = items[j];
                    const r = batch[j];
                    if (!item) {
                        errors++;
                        console.warn(`[AutoSync ML→TN] No se pudo obtener ítem ML ${r.ml_item_id} (SKU ${r.sku})`);
                        continue;
                    }
                    const variations = item.variations || [];
                    if (variations.length > 1) {
                        console.warn(`[AutoSync ML→TN] Omitido ml_item ${r.ml_item_id} (SKU ${r.sku}): tiene ${variations.length} variaciones y no se puede inferir una única.`);
                        continue;
                    }
                    const mlQty = variations.length === 0
                        ? ((_e = item.available_quantity) !== null && _e !== void 0 ? _e : 0)
                        : ((_f = variations[0].available_quantity) !== null && _f !== void 0 ? _f : 0);
                    const mlPack = Math.max(1, Number(r.ml_pack) || 1);
                    const tnPack = Math.max(1, Number(r.tn_pack) || 1);
                    const tnStock = Math.floor((Number(mlQty) * mlPack) / tnPack);
                    try {
                        yield putTnVariantWithRetry(`https://api.tiendanube.com/v1/${tnIntegration.store_id}/products/${r.tn_id}/variants/${r.tn_variant_id}`, { stock: tnStock }, { 'Authentication': `bearer ${tnIntegration.access_token}`, 'Content-Type': 'application/json', 'User-Agent': TN_USER_AGENT });
                        updated++;
                    }
                    catch (e) {
                        errors++;
                        console.warn(`[AutoSync ML→TN] Error TN PUT ítem propio ml_item=${r.ml_item_id} tn=${r.tn_id}/${r.tn_variant_id} (SKU ${r.sku}):`, ((_h = (_g = e.response) === null || _g === void 0 ? void 0 : _g.data) === null || _h === void 0 ? void 0 : _h.message) || e.message);
                    }
                    if (TN_RATE_LIMIT_DELAY_MS > 0)
                        yield sleep(TN_RATE_LIMIT_DELAY_MS);
                }
            }
        }
        if (updated > 0 || errors > 0) {
            console.log(`[AutoSync ML→TN] Actualizados: ${updated}, errores: ${errors}`);
        }
        return { updated, errors };
    });
}
exports.runAutoSyncMLtoTN = runAutoSyncMLtoTN;
// Sincronizar todo el stock local a Tienda Nube
const syncAllStockToTiendaNube = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _97, _98;
    try {
        const integration = yield (0, db_1.get)(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);
        if (!(integration === null || integration === void 0 ? void 0 : integration.access_token) || !(integration === null || integration === void 0 ? void 0 : integration.store_id)) {
            return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
        }
        const variants = yield (0, db_1.query)(`
      SELECT pv.id, pv.tienda_nube_variant_id, p.tienda_nube_id, s.stock, pv.sku,
             COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack
      FROM product_variants pv
      JOIN product_colors pc ON pc.id = pv.product_color_id
      JOIN products p ON p.id = pc.product_id
      LEFT JOIN stocks s ON s.variant_id = pv.id
      WHERE pv.tienda_nube_variant_id IS NOT NULL AND p.tienda_nube_id IS NOT NULL
    `);
        let updated = 0;
        let errors = 0;
        const logs = [];
        for (const v of variants) {
            try {
                const pack = Math.max(1, Number(v.tn_pack) || 1);
                const stockToSend = Math.floor(Number(v.stock || 0) / pack);
                yield axios_1.default.put(`https://api.tiendanube.com/v1/${integration.store_id}/products/${v.tienda_nube_id}/variants/${v.tienda_nube_variant_id}`, { stock: stockToSend }, {
                    headers: {
                        'Authentication': `bearer ${integration.access_token}`,
                        'Content-Type': 'application/json',
                        'User-Agent': TN_USER_AGENT
                    }
                });
                updated++;
                logs.push(`[OK] ${v.sku}: ${v.stock || 0} un. → ${stockToSend} (pack x${pack})`);
            }
            catch (e) {
                errors++;
                logs.push(`[ERROR] ${v.sku}: ${((_98 = (_97 = e.response) === null || _97 === void 0 ? void 0 : _97.data) === null || _98 === void 0 ? void 0 : _98.description) || e.message}`);
            }
            if (TN_RATE_LIMIT_DELAY_MS > 0)
                yield sleep(TN_RATE_LIMIT_DELAY_MS);
        }
        res.json({
            message: 'Sincronización completada',
            updated,
            errors,
            total: variants.length,
            logs
        });
    }
    catch (error) {
        console.error('Error syncing stock to TN:', error);
        res.status(500).json({ message: 'Error sincronizando stock', error: error.message });
    }
});
exports.syncAllStockToTiendaNube = syncAllStockToTiendaNube;
// Enviar stock solo de variantes seleccionadas a Tienda Nube
const syncSelectedStockToTiendaNube = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _99, _100, _101;
    try {
        const variantIds = Array.isArray((_99 = req.body) === null || _99 === void 0 ? void 0 : _99.variantIds) ? req.body.variantIds.filter((id) => typeof id === 'string' && id.length > 0) : [];
        if (variantIds.length === 0) {
            return res.status(400).json({ message: 'Indicá al menos una variante (variantIds)' });
        }
        const integration = yield (0, db_1.get)(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);
        if (!(integration === null || integration === void 0 ? void 0 : integration.access_token) || !(integration === null || integration === void 0 ? void 0 : integration.store_id)) {
            return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
        }
        const placeholders = variantIds.map(() => '?').join(',');
        const variants = yield (0, db_1.query)(`SELECT pv.id, pv.tienda_nube_variant_id, p.tienda_nube_id, s.stock, pv.sku,
              COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       LEFT JOIN stocks s ON s.variant_id = pv.id
       WHERE pv.id IN (${placeholders})
         AND pv.tienda_nube_variant_id IS NOT NULL AND p.tienda_nube_id IS NOT NULL`, variantIds);
        let updated = 0;
        let errors = 0;
        const logs = [];
        for (const v of variants) {
            try {
                const pack = Math.max(1, Number(v.tn_pack) || 1);
                const stockToSend = Math.floor(Number(v.stock || 0) / pack);
                yield axios_1.default.put(`https://api.tiendanube.com/v1/${integration.store_id}/products/${v.tienda_nube_id}/variants/${v.tienda_nube_variant_id}`, { stock: stockToSend }, {
                    headers: {
                        'Authentication': `bearer ${integration.access_token}`,
                        'Content-Type': 'application/json',
                        'User-Agent': TN_USER_AGENT
                    }
                });
                updated++;
                logs.push(`[OK] ${v.sku}: ${v.stock || 0} un. → ${stockToSend} (pack x${pack})`);
            }
            catch (e) {
                errors++;
                logs.push(`[ERROR] ${v.sku}: ${((_101 = (_100 = e.response) === null || _100 === void 0 ? void 0 : _100.data) === null || _101 === void 0 ? void 0 : _101.description) || e.message}`);
            }
            if (TN_RATE_LIMIT_DELAY_MS > 0)
                yield sleep(TN_RATE_LIMIT_DELAY_MS);
        }
        const skipped = variantIds.length - variants.length;
        if (skipped > 0)
            logs.push(`[INFO] ${skipped} variante(s) sin vínculo TN o no encontradas, omitidas.`);
        res.json({
            message: 'Stock enviado a Tienda Nube (selección)',
            updated,
            errors,
            total: variants.length,
            logs
        });
    }
    catch (error) {
        console.error('Error syncing selected stock to TN:', error);
        res.status(500).json({ message: 'Error sincronizando stock', error: error.message });
    }
});
exports.syncSelectedStockToTiendaNube = syncSelectedStockToTiendaNube;
// Sincronizar stock de la app hacia Mercado Libre (app = fuente de verdad). Usa la misma lógica que updateMercadoLibreStockByVariant (subrecurso + fallback PUT item).
const syncAllStockToMercadoLibre = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { updateMercadoLibreStockByVariant, updateMercadoLibreStockByItem } = yield Promise.resolve().then(() => __importStar(require('./stock.controller')));
        const variants = yield (0, db_1.query)(`
      SELECT pv.id, pv.mercado_libre_variant_id, pv.mercado_libre_item_id, p.mercado_libre_id, s.stock, pv.sku,
             COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack
      FROM product_variants pv
      JOIN product_colors pc ON pc.id = pv.product_color_id
      JOIN products p ON p.id = pc.product_id
      LEFT JOIN stocks s ON s.variant_id = pv.id
      WHERE (pv.mercado_libre_item_id IS NOT NULL)
         OR (pv.mercado_libre_variant_id IS NOT NULL AND p.mercado_libre_id IS NOT NULL)
    `);
        let updated = 0;
        let errors = 0;
        const logs = [];
        for (const v of variants) {
            const pack = Math.max(1, Number(v.ml_pack) || 1);
            const stockToSend = Math.floor(Number(v.stock || 0) / pack);
            let ok = false;
            if (v.mercado_libre_id && v.mercado_libre_variant_id) {
                ok = yield updateMercadoLibreStockByVariant(v.mercado_libre_id, v.mercado_libre_variant_id, stockToSend);
            }
            else if (v.mercado_libre_item_id) {
                ok = yield updateMercadoLibreStockByItem(v.mercado_libre_item_id, stockToSend);
            }
            if (ok) {
                updated++;
                logs.push(`[OK] ${v.sku}: ${v.stock || 0} un. → ${stockToSend} (pack x${pack})`);
            }
            else {
                errors++;
                const mlRef = v.mercado_libre_item_id || (v.mercado_libre_id ? `${v.mercado_libre_id}/${v.mercado_libre_variant_id}` : 'sin vínculo');
                logs.push(`[ERROR] ${v.sku}: no se pudo actualizar ML ${mlRef}`);
                console.warn(`[Sync→ML] Falló variante SKU=${v.sku} ML=${mlRef}`);
            }
        }
        res.json({
            message: 'Stock sincronizado a Mercado Libre',
            updated,
            errors,
            total: variants.length,
            logs
        });
    }
    catch (error) {
        console.error('Error syncing stock to ML:', error);
        res.status(500).json({ message: 'Error sincronizando stock a Mercado Libre', error: error.message });
    }
});
exports.syncAllStockToMercadoLibre = syncAllStockToMercadoLibre;
// Enviar stock solo de variantes seleccionadas a Mercado Libre
const syncSelectedStockToMercadoLibre = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _102;
    try {
        const variantIds = Array.isArray((_102 = req.body) === null || _102 === void 0 ? void 0 : _102.variantIds) ? req.body.variantIds.filter((id) => typeof id === 'string' && id.length > 0) : [];
        if (variantIds.length === 0) {
            return res.status(400).json({ message: 'Indicá al menos una variante (variantIds)' });
        }
        const { updateMercadoLibreStockByVariant, updateMercadoLibreStockByItem } = yield Promise.resolve().then(() => __importStar(require('./stock.controller')));
        const placeholders = variantIds.map(() => '?').join(',');
        const variants = yield (0, db_1.query)(`SELECT pv.id, pv.mercado_libre_variant_id, pv.mercado_libre_item_id, p.mercado_libre_id, s.stock, pv.sku,
              COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       LEFT JOIN stocks s ON s.variant_id = pv.id
       WHERE pv.id IN (${placeholders})
         AND ((pv.mercado_libre_item_id IS NOT NULL)
              OR (pv.mercado_libre_variant_id IS NOT NULL AND p.mercado_libre_id IS NOT NULL))`, variantIds);
        let updated = 0;
        let errors = 0;
        const logs = [];
        for (const v of variants) {
            const pack = Math.max(1, Number(v.ml_pack) || 1);
            const stockToSend = Math.floor(Number(v.stock || 0) / pack);
            let ok = false;
            if (v.mercado_libre_id && v.mercado_libre_variant_id) {
                ok = yield updateMercadoLibreStockByVariant(v.mercado_libre_id, v.mercado_libre_variant_id, stockToSend);
            }
            else if (v.mercado_libre_item_id) {
                ok = yield updateMercadoLibreStockByItem(v.mercado_libre_item_id, stockToSend);
            }
            if (ok) {
                updated++;
                logs.push(`[OK] ${v.sku}: ${v.stock || 0} un. → ${stockToSend} (pack x${pack})`);
            }
            else {
                errors++;
                logs.push(`[ERROR] ${v.sku}: no se pudo actualizar`);
            }
        }
        const skipped = variantIds.length - variants.length;
        if (skipped > 0)
            logs.push(`[INFO] ${skipped} variante(s) sin vínculo ML o no encontradas, omitidas.`);
        res.json({
            message: 'Stock enviado a Mercado Libre (selección)',
            updated,
            errors,
            total: variants.length,
            logs
        });
    }
    catch (error) {
        console.error('Error syncing selected stock to ML:', error);
        res.status(500).json({ message: 'Error sincronizando stock a Mercado Libre', error: error.message });
    }
});
exports.syncSelectedStockToMercadoLibre = syncSelectedStockToMercadoLibre;
/** Obtener stock en ML y TN por variantes (para mostrar en inventario). */
const getVariantExternalStocks = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _103, _104, _105, _106, _107, _108;
    try {
        const variantIds = Array.isArray((_103 = req.body) === null || _103 === void 0 ? void 0 : _103.variantIds) ? req.body.variantIds.filter((id) => typeof id === 'string' && id.length > 0).slice(0, 100) : [];
        if (variantIds.length === 0) {
            return res.json({ stocks: {} });
        }
        const placeholders = variantIds.map(() => '?').join(',');
        const rows = yield (0, db_1.query)(`SELECT pv.id AS variant_id,
              p.mercado_libre_id, pv.mercado_libre_variant_id, pv.mercado_libre_item_id,
              p.tienda_nube_id, pv.tienda_nube_variant_id
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       WHERE pv.id IN (${placeholders})`, variantIds);
        const stocks = {};
        for (const id of variantIds)
            stocks[id] = {};
        try {
            const snapRows = yield (0, db_1.query)(`SELECT variant_id, stock FROM variant_luposhop_stock WHERE variant_id IN (${placeholders})`, variantIds);
            for (const r of snapRows || []) {
                const vid = r.variant_id;
                if (vid && stocks[vid])
                    stocks[vid].stockLupoShop = Number((_104 = r.stock) !== null && _104 !== void 0 ? _104 : 0);
            }
            // Valor inicial para no mostrar "Tienda: -" hasta el primer webhook exitoso.
            const localRows = yield (0, db_1.query)(`SELECT variant_id, stock FROM stocks WHERE variant_id IN (${placeholders})`, variantIds);
            for (const r of localRows || []) {
                const vid = r.variant_id;
                if (!vid || !stocks[vid])
                    continue;
                if (stocks[vid].stockLupoShop === undefined) {
                    stocks[vid].stockLupoShop = Number((_105 = r.stock) !== null && _105 !== void 0 ? _105 : 0);
                }
            }
        }
        catch (_109) {
            // tabla aún no existe o error puntual: no rompe ML/TN
        }
        const mlToken = yield getValidMLToken();
        const tnIntegration = yield (0, db_1.get)(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);
        if (mlToken === null || mlToken === void 0 ? void 0 : mlToken.access_token) {
            const mlHeaders = { 'Authorization': `Bearer ${mlToken.access_token}` };
            const mlItemIds = new Map();
            for (const r of rows || []) {
                const variantId = r.variant_id;
                const ownItemId = r.mercado_libre_item_id != null && String(r.mercado_libre_item_id).trim() !== ''
                    ? String(r.mercado_libre_item_id).trim()
                    : null;
                const mlItemId = ownItemId || r.mercado_libre_id;
                const variationId = ownItemId
                    ? null
                    : r.mercado_libre_variant_id
                        ? String(r.mercado_libre_variant_id)
                        : null;
                if (!mlItemId)
                    continue;
                if (!mlItemIds.has(mlItemId))
                    mlItemIds.set(mlItemId, []);
                mlItemIds.get(mlItemId).push({ variantId, variationId });
            }
            for (const [itemId, variants] of mlItemIds) {
                try {
                    const itemRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${itemId}`, { headers: mlHeaders });
                    const item = itemRes.data;
                    const variations = item.variations || [];
                    for (const { variantId, variationId } of variants) {
                        if (variations.length === 0) {
                            stocks[variantId].stockML = (_106 = item.available_quantity) !== null && _106 !== void 0 ? _106 : 0;
                        }
                        else if (variationId) {
                            const v = variations.find((x) => String(x.id) === String(variationId));
                            stocks[variantId].stockML = v ? ((_107 = v.available_quantity) !== null && _107 !== void 0 ? _107 : 0) : undefined;
                        }
                        else {
                            stocks[variantId].stockML = (_108 = item.available_quantity) !== null && _108 !== void 0 ? _108 : 0;
                        }
                    }
                }
                catch (_110) {
                    // ignore per-item errors
                }
            }
        }
        if ((tnIntegration === null || tnIntegration === void 0 ? void 0 : tnIntegration.access_token) && (tnIntegration === null || tnIntegration === void 0 ? void 0 : tnIntegration.store_id)) {
            const tnHeaders = {
                'Authentication': `bearer ${tnIntegration.access_token}`,
                'Content-Type': 'application/json',
                'User-Agent': TN_USER_AGENT
            };
            const tnProductIds = new Map();
            for (const r of rows || []) {
                const variantId = r.variant_id;
                const tnProductId = r.tienda_nube_id;
                const tnVariantId = r.tienda_nube_variant_id;
                if (!tnProductId || !tnVariantId)
                    continue;
                if (!tnProductIds.has(tnProductId))
                    tnProductIds.set(tnProductId, []);
                tnProductIds.get(tnProductId).push(variantId);
            }
            const variantToTnVariant = new Map();
            for (const r of rows || []) {
                const variantId = r.variant_id;
                const tnVariantId = r.tienda_nube_variant_id;
                if (tnVariantId)
                    variantToTnVariant.set(variantId, String(tnVariantId));
            }
            for (const [productId, variantIdsInProduct] of tnProductIds) {
                try {
                    // Paginar variantes de TN para traer todas (la API devuelve por defecto una cantidad limitada por página)
                    let tnVariants = [];
                    const tnPerPage = 200;
                    let tnPage = 1;
                    let hasMoreTn = true;
                    while (hasMoreTn) {
                        const varRes = yield axios_1.default.get(`https://api.tiendanube.com/v1/${tnIntegration.store_id}/products/${productId}/variants`, { headers: tnHeaders, params: { page: tnPage, per_page: tnPerPage } });
                        const chunk = Array.isArray(varRes.data) ? varRes.data : [];
                        tnVariants = tnVariants.concat(chunk);
                        if (chunk.length < tnPerPage)
                            hasMoreTn = false;
                        else
                            tnPage++;
                        if (tnPage > 50)
                            hasMoreTn = false;
                    }
                    for (const variantId of variantIdsInProduct) {
                        const tnVid = variantToTnVariant.get(variantId);
                        const tv = tnVariants.find((v) => String(v.id) === String(tnVid));
                        if (tv != null && typeof tv.stock === 'number')
                            stocks[variantId].stockTN = tv.stock;
                    }
                }
                catch (_111) {
                    // ignore per-product errors
                }
            }
        }
        res.json({ stocks });
    }
    catch (error) {
        console.error('Error getting variant external stocks:', error);
        res.status(500).json({ message: 'Error obteniendo stock externo', error: error.message });
    }
});
exports.getVariantExternalStocks = getVariantExternalStocks;
/** Opcional: sincronizar con Mercado Libre como fuente (ML → LupoHub → Tienda Nube). Para el flujo normal, LupoHub es la fuente de verdad y se envía a ML con syncAllStockToMercadoLibre. */
const syncAllStockFromMercadoLibre = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _112, _113, _114, _115, _116, _117, _118, _119;
    try {
        const mlToken = yield getValidMLToken();
        if (!mlToken) {
            return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
        }
        const tnIntegration = yield (0, db_1.get)(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);
        const hasTN = !!((tnIntegration === null || tnIntegration === void 0 ? void 0 : tnIntegration.access_token) && (tnIntegration === null || tnIntegration === void 0 ? void 0 : tnIntegration.store_id));
        const { updateVariantStock } = yield Promise.resolve().then(() => __importStar(require('./stock.controller')));
        const logs = [];
        let updated = 0;
        let errors = 0;
        const limit = 50;
        let offset = 0;
        logs.push('[1/2] Importando stock desde Mercado Libre (opcional; por SKU local)...');
        while (true) {
            const itemsRes = yield axios_1.default.get(`https://api.mercadolibre.com/users/${mlToken.user_id}/items/search?status=active&offset=${offset}&limit=${limit}`, { headers: { 'Authorization': `Bearer ${mlToken.access_token}` } });
            const itemIds = itemsRes.data.results || [];
            if (itemIds.length === 0)
                break;
            const batchSize = 10;
            for (let i = 0; i < itemIds.length; i += batchSize) {
                const batch = itemIds.slice(i, i + batchSize);
                const itemPromises = batch.map((itemId) => axios_1.default.get(`https://api.mercadolibre.com/items/${itemId}?include_attributes=all`, {
                    headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
                }).then(r => r.data).catch(() => null));
                const items = yield Promise.all(itemPromises);
                for (const item of items) {
                    if (!item)
                        continue;
                    if (item.variations && item.variations.length > 0) {
                        for (const v of item.variations) {
                            const sellerCustom = ((_112 = v.seller_custom_field) !== null && _112 !== void 0 ? _112 : '').toString().trim();
                            const sellerSku = ((_113 = v.seller_sku) !== null && _113 !== void 0 ? _113 : '').toString().trim();
                            const mlSku = sellerCustom || sellerSku;
                            if (!mlSku) {
                                logs.push(`[SKU ML] variación id=${v.id}: seller_custom_field="${sellerCustom}" seller_sku="${sellerSku}" → omitido (vacío)`);
                                continue;
                            }
                            const mlSkuNorm = mlSku.replace(/-/g, '').replace(/\s/g, '');
                            logs.push(`[SKU ML] variación id=${v.id}: seller_custom_field="${sellerCustom}" seller_sku="${sellerSku}" → usando="${mlSku}" normalizado="${mlSkuNorm}"`);
                            const row = yield (0, db_1.get)(`SELECT pv.id as variant_id FROM product_variants pv
                 WHERE REPLACE(REPLACE(TRIM(COALESCE(pv.external_sku, pv.sku)), '-', ''), ' ', '') = ?
                 LIMIT 1`, [mlSkuNorm]);
                            if (!(row === null || row === void 0 ? void 0 : row.variant_id)) {
                                logs.push(`[SKU ML] sin variante local para "${mlSku}" (normalizado: ${mlSkuNorm})`);
                                continue;
                            }
                            const mlQty = (_114 = v.available_quantity) !== null && _114 !== void 0 ? _114 : 0;
                            const ok = yield updateVariantStock(row.variant_id, mlQty, 'IMPORTACION_ML', 'ML = fuente de verdad', false);
                            if (ok) {
                                updated++;
                                logs.push(`[OK] ${mlSku}: ${mlQty}`);
                            }
                            else {
                                errors++;
                                logs.push(`[ERROR] ${mlSku}`);
                            }
                        }
                    }
                    else {
                        const sellerCustom = ((_115 = item.seller_custom_field) !== null && _115 !== void 0 ? _115 : '').toString().trim();
                        const sellerSku = ((_116 = item.seller_sku) !== null && _116 !== void 0 ? _116 : '').toString().trim();
                        const mlSku = sellerCustom || sellerSku;
                        if (!mlSku) {
                            logs.push(`[SKU ML] ítem id=${item.id}: seller_custom_field="${sellerCustom}" seller_sku="${sellerSku}" → omitido (vacío)`);
                            continue;
                        }
                        const mlSkuNorm = mlSku.replace(/-/g, '').replace(/\s/g, '');
                        logs.push(`[SKU ML] ítem id=${item.id}: seller_custom_field="${sellerCustom}" seller_sku="${sellerSku}" → usando="${mlSku}" normalizado="${mlSkuNorm}"`);
                        const variantRow = yield (0, db_1.get)(`SELECT pv.id as variant_id FROM product_variants pv
               WHERE REPLACE(REPLACE(TRIM(COALESCE(pv.external_sku, pv.sku)), '-', ''), ' ', '') = ?
               LIMIT 1`, [mlSkuNorm]);
                        if (!(variantRow === null || variantRow === void 0 ? void 0 : variantRow.variant_id)) {
                            logs.push(`[SKU ML] sin variante local para ítem "${mlSku}" (normalizado: ${mlSkuNorm})`);
                            continue;
                        }
                        const mlQty = (_117 = item.available_quantity) !== null && _117 !== void 0 ? _117 : 0;
                        const ok = yield updateVariantStock(variantRow.variant_id, mlQty, 'IMPORTACION_ML', 'ML = fuente de verdad', false);
                        if (ok) {
                            updated++;
                            logs.push(`[OK] ${mlSku}: ${mlQty}`);
                        }
                        else {
                            errors++;
                            logs.push(`[ERROR] ${mlSku}`);
                        }
                    }
                }
            }
            if (itemIds.length < limit)
                break;
            offset += limit;
        }
        let tnUpdated = 0;
        let tnErrors = 0;
        if (hasTN) {
            logs.push('[2/2] Enviando stock a Tienda Nube...');
            const variants = yield (0, db_1.query)(`
        SELECT pv.id, pv.tienda_nube_variant_id, p.tienda_nube_id, s.stock, pv.sku,
               COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack
        FROM product_variants pv
        JOIN product_colors pc ON pc.id = pv.product_color_id
        JOIN products p ON p.id = pc.product_id
        LEFT JOIN stocks s ON s.variant_id = pv.id
        WHERE pv.tienda_nube_variant_id IS NOT NULL AND p.tienda_nube_id IS NOT NULL
      `);
            for (const v of variants) {
                try {
                    const pack = Math.max(1, Number(v.tn_pack) || 1);
                    const stockToSend = Math.floor(Number(v.stock || 0) / pack);
                    yield axios_1.default.put(`https://api.tiendanube.com/v1/${tnIntegration.store_id}/products/${v.tienda_nube_id}/variants/${v.tienda_nube_variant_id}`, { stock: stockToSend }, {
                        headers: {
                            'Authentication': `bearer ${tnIntegration.access_token}`,
                            'Content-Type': 'application/json',
                            'User-Agent': TN_USER_AGENT
                        }
                    });
                    tnUpdated++;
                    logs.push(`[TN] ${v.sku}: ${stockToSend}`);
                }
                catch (e) {
                    tnErrors++;
                    logs.push(`[TN ERROR] ${v.sku}: ${((_119 = (_118 = e.response) === null || _118 === void 0 ? void 0 : _118.data) === null || _119 === void 0 ? void 0 : _119.description) || e.message}`);
                }
                if (TN_RATE_LIMIT_DELAY_MS > 0)
                    yield sleep(TN_RATE_LIMIT_DELAY_MS);
            }
        }
        else {
            logs.push('[2/2] Tienda Nube no conectada, se omitió el envío.');
        }
        res.json({
            message: 'Stock sincronizado: Mercado Libre → LupoHub → Tienda Nube',
            importedFromML: updated,
            errorsFromML: errors,
            sentToTN: tnUpdated,
            errorsToTN: tnErrors,
            logs
        });
    }
    catch (error) {
        console.error('Error sync from ML:', error);
        res.status(500).json({ message: 'Error sincronizando desde Mercado Libre', error: error.message });
    }
});
exports.syncAllStockFromMercadoLibre = syncAllStockFromMercadoLibre;
// Opcional: importar stock desde Mercado Libre a la app (solo por SKU: seller_custom_field = SKU local; si no existe variante, se ignora).
// Después de actualizar LupoHub, también envía el stock a Tienda Nube (variantes vinculadas).
const importStockFromMercadoLibre = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _120, _121, _122, _123, _124, _125, _126, _127;
    try {
        const mlToken = yield getValidMLToken();
        if (!mlToken) {
            return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
        }
        const tnIntegration = yield (0, db_1.get)(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);
        const hasTN = !!((tnIntegration === null || tnIntegration === void 0 ? void 0 : tnIntegration.access_token) && (tnIntegration === null || tnIntegration === void 0 ? void 0 : tnIntegration.store_id));
        const { updateVariantStock } = yield Promise.resolve().then(() => __importStar(require('./stock.controller')));
        let updated = 0;
        let errors = 0;
        const logs = [];
        const limit = 50;
        let offset = 0;
        logs.push('[1/2] Importando stock desde Mercado Libre (opcional; por SKU local)...');
        while (true) {
            const itemsRes = yield axios_1.default.get(`https://api.mercadolibre.com/users/${mlToken.user_id}/items/search?status=active&offset=${offset}&limit=${limit}`, { headers: { 'Authorization': `Bearer ${mlToken.access_token}` } });
            const itemIds = itemsRes.data.results || [];
            if (itemIds.length === 0)
                break;
            const batchSize = 10;
            for (let i = 0; i < itemIds.length; i += batchSize) {
                const batch = itemIds.slice(i, i + batchSize);
                const itemPromises = batch.map((itemId) => axios_1.default.get(`https://api.mercadolibre.com/items/${itemId}?include_attributes=all`, {
                    headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
                }).then(r => r.data).catch(() => null));
                const items = yield Promise.all(itemPromises);
                for (const item of items) {
                    if (!item)
                        continue;
                    if (item.variations && item.variations.length > 0) {
                        for (const v of item.variations) {
                            const sellerCustom = ((_120 = v.seller_custom_field) !== null && _120 !== void 0 ? _120 : '').toString().trim();
                            const sellerSku = ((_121 = v.seller_sku) !== null && _121 !== void 0 ? _121 : '').toString().trim();
                            const mlSku = sellerCustom || sellerSku;
                            if (!mlSku) {
                                logs.push(`[SKU ML] variación id=${v.id}: seller_custom_field="${sellerCustom}" seller_sku="${sellerSku}" → omitido (vacío)`);
                                continue;
                            }
                            const mlSkuNorm = mlSku.replace(/-/g, '').replace(/\s/g, '');
                            logs.push(`[SKU ML] variación id=${v.id}: seller_custom_field="${sellerCustom}" seller_sku="${sellerSku}" → usando="${mlSku}" normalizado="${mlSkuNorm}"`);
                            const row = yield (0, db_1.get)(`SELECT pv.id as variant_id FROM product_variants pv
                 WHERE REPLACE(REPLACE(TRIM(COALESCE(pv.external_sku, pv.sku)), '-', ''), ' ', '') = ?
                 LIMIT 1`, [mlSkuNorm]);
                            if (!(row === null || row === void 0 ? void 0 : row.variant_id)) {
                                logs.push(`[SKU ML] sin variante local para "${mlSku}" (normalizado: ${mlSkuNorm})`);
                                continue;
                            }
                            const mlQty = (_122 = v.available_quantity) !== null && _122 !== void 0 ? _122 : 0;
                            const ok = yield updateVariantStock(row.variant_id, mlQty, 'IMPORTACION_ML', 'Importación desde ML', false);
                            if (ok) {
                                updated++;
                                logs.push(`[OK] ${mlSku}: ${mlQty}`);
                            }
                            else {
                                errors++;
                                logs.push(`[ERROR] ${mlSku}`);
                            }
                        }
                    }
                    else {
                        const sellerCustom = ((_123 = item.seller_custom_field) !== null && _123 !== void 0 ? _123 : '').toString().trim();
                        const sellerSku = ((_124 = item.seller_sku) !== null && _124 !== void 0 ? _124 : '').toString().trim();
                        const mlSku = sellerCustom || sellerSku;
                        if (!mlSku) {
                            logs.push(`[SKU ML] ítem id=${item.id}: seller_custom_field="${sellerCustom}" seller_sku="${sellerSku}" → omitido (vacío)`);
                            continue;
                        }
                        const mlSkuNorm = mlSku.replace(/-/g, '').replace(/\s/g, '');
                        logs.push(`[SKU ML] ítem id=${item.id}: seller_custom_field="${sellerCustom}" seller_sku="${sellerSku}" → usando="${mlSku}" normalizado="${mlSkuNorm}"`);
                        const variantRow = yield (0, db_1.get)(`SELECT pv.id as variant_id FROM product_variants pv
               WHERE REPLACE(REPLACE(TRIM(COALESCE(pv.external_sku, pv.sku)), '-', ''), ' ', '') = ?
               LIMIT 1`, [mlSkuNorm]);
                        if (!(variantRow === null || variantRow === void 0 ? void 0 : variantRow.variant_id)) {
                            logs.push(`[SKU ML] sin variante local para ítem "${mlSku}" (normalizado: ${mlSkuNorm})`);
                            continue;
                        }
                        const mlQty = (_125 = item.available_quantity) !== null && _125 !== void 0 ? _125 : 0;
                        const ok = yield updateVariantStock(variantRow.variant_id, mlQty, 'IMPORTACION_ML', 'Importación desde ML', false);
                        if (ok) {
                            updated++;
                            logs.push(`[OK] ${mlSku}: ${mlQty}`);
                        }
                        else {
                            errors++;
                            logs.push(`[ERROR] ${mlSku}`);
                        }
                    }
                }
            }
            if (itemIds.length < limit)
                break;
            offset += limit;
        }
        let tnUpdated = 0;
        let tnErrors = 0;
        if (hasTN) {
            logs.push('[2/2] Enviando stock a Tienda Nube...');
            const variants = yield (0, db_1.query)(`
        SELECT pv.id, pv.tienda_nube_variant_id, p.tienda_nube_id, s.stock, pv.sku,
               COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack
        FROM product_variants pv
        JOIN product_colors pc ON pc.id = pv.product_color_id
        JOIN products p ON p.id = pc.product_id
        LEFT JOIN stocks s ON s.variant_id = pv.id
        WHERE pv.tienda_nube_variant_id IS NOT NULL AND p.tienda_nube_id IS NOT NULL
      `);
            for (const v of variants) {
                try {
                    const pack = Math.max(1, Number(v.tn_pack) || 1);
                    const stockToSend = Math.floor(Number(v.stock || 0) / pack);
                    yield axios_1.default.put(`https://api.tiendanube.com/v1/${tnIntegration.store_id}/products/${v.tienda_nube_id}/variants/${v.tienda_nube_variant_id}`, { stock: stockToSend }, {
                        headers: {
                            'Authentication': `bearer ${tnIntegration.access_token}`,
                            'Content-Type': 'application/json',
                            'User-Agent': TN_USER_AGENT
                        }
                    });
                    tnUpdated++;
                    logs.push(`[TN] ${v.sku}: ${stockToSend}`);
                }
                catch (e) {
                    tnErrors++;
                    logs.push(`[TN ERROR] ${v.sku}: ${((_127 = (_126 = e.response) === null || _126 === void 0 ? void 0 : _126.data) === null || _127 === void 0 ? void 0 : _127.description) || e.message}`);
                }
                if (TN_RATE_LIMIT_DELAY_MS > 0)
                    yield sleep(TN_RATE_LIMIT_DELAY_MS);
            }
        }
        else {
            logs.push('[2/2] Tienda Nube no conectada, se omitió el envío.');
        }
        res.json({
            message: hasTN ? 'Stock importado desde Mercado Libre y enviado a Tienda Nube' : 'Stock importado desde Mercado Libre (solo variantes existentes por SKU)',
            updated,
            errors,
            sentToTN: tnUpdated,
            errorsToTN: tnErrors,
            logs
        });
    }
    catch (error) {
        console.error('Error importing stock from ML:', error);
        res.status(500).json({ message: 'Error importando stock desde Mercado Libre', error: error.message });
    }
});
exports.importStockFromMercadoLibre = importStockFromMercadoLibre;
// ==================== ÓRDENES EXTERNAS ====================
// Obtener órdenes de Tienda Nube
// Obtener stock/publicaciones de Tienda Nube (igual que getMercadoLibreStock pero para TN)
const getTiendaNubeStock = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _128, _129, _130, _131, _132, _133, _134, _135, _136, _137;
    try {
        const integration = yield (0, db_1.get)(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
        if (!(integration === null || integration === void 0 ? void 0 : integration.access_token)) {
            return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
        }
        const storeId = integration.store_id || integration.user_id;
        if (!storeId) {
            return res.status(400).json({ message: 'No se encontró store_id de Tienda Nube' });
        }
        const { offset = '0', limit = '50' } = req.query;
        const page = Math.floor(Number(offset) / Number(limit)) + 1;
        const perPage = Math.min(200, Math.max(1, parseInt(limit) || 50)); // API TN permite hasta 200 por página
        const response = yield axios_1.default.get(`https://api.tiendanube.com/v1/${storeId}/products`, {
            headers: {
                'Authentication': `bearer ${integration.access_token}`,
                'User-Agent': TN_USER_AGENT
            },
            params: { page, per_page: perPage },
            validateStatus: () => true
        });
        if (response.status !== 200) {
            const errMsg = (response.data && (response.data.description || response.data.message || response.data.error)) || response.statusText || 'Tienda Nube no respondió OK';
            return res.status(response.status >= 400 ? 502 : 500).json({ message: 'Error obteniendo stock de Tienda Nube', detail: errMsg });
        }
        const raw = response.data;
        const products = Array.isArray(raw) ? raw : [];
        const isSizeAttr = (name) => /talle|talla|size|tamano|tamaño/i.test(name);
        const isColorAttr = (name) => /color|colour|cor/i.test(name);
        const items = [];
        for (const p of products) {
            try {
                if (!p || typeof p !== 'object')
                    continue;
                const title = ((_128 = p.name) === null || _128 === void 0 ? void 0 : _128.es) || ((_129 = p.name) === null || _129 === void 0 ? void 0 : _129.pt) || ((_130 = p.name) === null || _130 === void 0 ? void 0 : _130.en) || p.name || '';
                const attrs = Array.isArray(p.attributes) ? p.attributes : [];
                let sizeIdx = -1;
                let colorIdx = -1;
                attrs.forEach((a, i) => {
                    var _a, _b, _c;
                    const n = ((_c = (_b = (_a = a === null || a === void 0 ? void 0 : a.es) !== null && _a !== void 0 ? _a : a === null || a === void 0 ? void 0 : a.en) !== null && _b !== void 0 ? _b : a === null || a === void 0 ? void 0 : a.pt) !== null && _c !== void 0 ? _c : '').toString();
                    if (isSizeAttr(n))
                        sizeIdx = i;
                    if (isColorAttr(n))
                        colorIdx = i;
                });
                let totalStock = 0;
                const variantsList = Array.isArray(p.variants) ? p.variants : [];
                const variations = variantsList.map((v) => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
                    const stock = Number(v === null || v === void 0 ? void 0 : v.stock) || 0;
                    totalStock += stock;
                    const values = Array.isArray(v === null || v === void 0 ? void 0 : v.values) ? v.values : [];
                    const sizeVal = sizeIdx >= 0 && sizeIdx < values.length ? ((_f = (_d = (_b = (_a = values[sizeIdx]) === null || _a === void 0 ? void 0 : _a.es) !== null && _b !== void 0 ? _b : (_c = values[sizeIdx]) === null || _c === void 0 ? void 0 : _c.pt) !== null && _d !== void 0 ? _d : (_e = values[sizeIdx]) === null || _e === void 0 ? void 0 : _e.en) !== null && _f !== void 0 ? _f : values[sizeIdx]) : '';
                    const colorVal = colorIdx >= 0 && colorIdx < values.length ? ((_m = (_k = (_h = (_g = values[colorIdx]) === null || _g === void 0 ? void 0 : _g.es) !== null && _h !== void 0 ? _h : (_j = values[colorIdx]) === null || _j === void 0 ? void 0 : _j.pt) !== null && _k !== void 0 ? _k : (_l = values[colorIdx]) === null || _l === void 0 ? void 0 : _l.en) !== null && _m !== void 0 ? _m : values[colorIdx]) : '';
                    const toStr = (x) => { var _a, _b, _c; return (_c = (x != null && typeof x === 'object' ? ((_b = (_a = x.es) !== null && _a !== void 0 ? _a : x.pt) !== null && _b !== void 0 ? _b : x.en) : x)) !== null && _c !== void 0 ? _c : ''; };
                    return {
                        variationId: v === null || v === void 0 ? void 0 : v.id,
                        sku: (v === null || v === void 0 ? void 0 : v.sku) || '',
                        size: String(toStr(sizeVal)),
                        color: String(toStr(colorVal)),
                        stock,
                        sold: 0
                    };
                });
                const img = (p.images && p.images[0]) ? (p.images[0].src || p.images[0].url) : '';
                items.push({
                    id: String(p.id),
                    title,
                    status: 'active',
                    price: (_132 = (_131 = variantsList[0]) === null || _131 === void 0 ? void 0 : _131.price) !== null && _132 !== void 0 ? _132 : 0,
                    totalStock,
                    soldTotal: 0,
                    thumbnail: img,
                    permalink: p.url || 'https://tiendanube.com',
                    hasVariations: variations.length > 1,
                    variations
                });
            }
            catch (e) {
                console.warn('[TN Stock] Producto omitido por formato inesperado:', p === null || p === void 0 ? void 0 : p.id, e === null || e === void 0 ? void 0 : e.message);
            }
        }
        const totalHeader = response.headers['x-total-count'] || response.headers['x-total'];
        const total = totalHeader ? parseInt(String(totalHeader), 10) : items.length;
        res.json({
            items,
            total: typeof total === 'number' && !isNaN(total) ? total : items.length,
            offset: parseInt(offset),
            limit: perPage
        });
    }
    catch (error) {
        const detail = ((_134 = (_133 = error.response) === null || _133 === void 0 ? void 0 : _133.data) === null || _134 === void 0 ? void 0 : _134.description) || ((_136 = (_135 = error.response) === null || _135 === void 0 ? void 0 : _135.data) === null || _136 === void 0 ? void 0 : _136.message) || error.message;
        console.error('Error fetching TN stock:', ((_137 = error.response) === null || _137 === void 0 ? void 0 : _137.data) || error.message);
        res.status(500).json({ message: 'Error obteniendo stock de Tienda Nube', detail: detail || 'Error de conexión' });
    }
});
exports.getTiendaNubeStock = getTiendaNubeStock;
// Totales de stock Tienda Nube (todos los productos, para las cards)
const getTiendaNubeStockTotals = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _138, _139, _140, _141, _142;
    try {
        const integration = yield (0, db_1.get)(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
        if (!(integration === null || integration === void 0 ? void 0 : integration.access_token)) {
            return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
        }
        const storeId = integration.store_id || integration.user_id;
        if (!storeId) {
            return res.status(400).json({ message: 'No se encontró store_id de Tienda Nube' });
        }
        const perPage = 200;
        let page = 1;
        let hasMore = true;
        let totalProducts = 0;
        let totalStock = 0;
        let lowStockCount = 0;
        let noStockCount = 0;
        while (hasMore) {
            const response = yield axios_1.default.get(`https://api.tiendanube.com/v1/${storeId}/products`, {
                headers: {
                    'Authentication': `bearer ${integration.access_token}`,
                    'User-Agent': TN_USER_AGENT
                },
                params: { page, per_page: perPage },
                validateStatus: () => true
            });
            if (response.status !== 200) {
                const errMsg = (response.data && (response.data.description || response.data.message || response.data.error)) || response.statusText || 'Tienda Nube no respondió OK';
                return res.status(response.status >= 400 ? 502 : 500).json({ message: 'Error obteniendo totales de Tienda Nube', detail: errMsg });
            }
            const raw = response.data;
            const products = Array.isArray(raw) ? raw : [];
            if (products.length === 0) {
                hasMore = false;
                break;
            }
            for (const p of products) {
                let productStock = 0;
                for (const v of p.variants || []) {
                    productStock += Number(v.stock) || 0;
                }
                totalProducts += 1;
                totalStock += productStock;
                if (productStock === 0)
                    noStockCount += 1;
                else if (productStock < 5)
                    lowStockCount += 1;
            }
            if (products.length < perPage)
                hasMore = false;
            else
                page++;
            if (page > 200)
                hasMore = false;
        }
        res.json({
            totalProducts,
            totalStock,
            lowStockCount,
            noStockCount
        });
    }
    catch (error) {
        const detail = ((_139 = (_138 = error.response) === null || _138 === void 0 ? void 0 : _138.data) === null || _139 === void 0 ? void 0 : _139.description) || ((_141 = (_140 = error.response) === null || _140 === void 0 ? void 0 : _140.data) === null || _141 === void 0 ? void 0 : _141.message) || error.message;
        console.error('Error fetching TN stock totals:', ((_142 = error.response) === null || _142 === void 0 ? void 0 : _142.data) || error.message);
        res.status(500).json({ message: 'Error obteniendo totales de Tienda Nube', detail: detail || 'Error de conexión' });
    }
});
exports.getTiendaNubeStockTotals = getTiendaNubeStockTotals;
const getTiendaNubeOrders = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _143;
    try {
        const integration = yield (0, db_1.get)(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
        if (!(integration === null || integration === void 0 ? void 0 : integration.access_token)) {
            return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
        }
        // En TN, store_id es igual a user_id
        const storeId = integration.store_id || integration.user_id;
        if (!storeId) {
            return res.status(400).json({ message: 'No se encontró el store_id de Tienda Nube' });
        }
        const { page = '1', per_page = '20', status, created_at_min, created_at_max, only_paid_pending_shipment } = req.query;
        const perPageNum = Math.min(100, Math.max(1, parseInt(per_page) || 20));
        const pageNum = Math.max(1, parseInt(page) || 1);
        let url = `https://api.tiendanube.com/v1/${storeId}/orders?page=${pageNum}&per_page=${perPageNum}`;
        if (status) {
            url += `&status=${status}`;
        }
        if (created_at_min) {
            url += `&created_at_min=${created_at_min}`;
        }
        if (created_at_max) {
            url += `&created_at_max=${created_at_max}`;
        }
        const ordersRes = yield axios_1.default.get(url, {
            headers: {
                'Authentication': `bearer ${integration.access_token}`,
                'User-Agent': TN_USER_AGENT
            }
        });
        let orders = ordersRes.data.map((order) => {
            var _a, _b, _c, _d;
            const rawPaymentStatus = ((_a = order.payment_status) !== null && _a !== void 0 ? _a : '').toString().trim().toLowerCase();
            const paymentDetails = Array.isArray(order.payment_details) ? order.payment_details : [];
            const detailStates = paymentDetails
                .map((d) => { var _a, _b; return ((_b = (_a = d === null || d === void 0 ? void 0 : d.status) !== null && _a !== void 0 ? _a : d === null || d === void 0 ? void 0 : d.state) !== null && _b !== void 0 ? _b : '').toString().trim().toLowerCase(); })
                .filter(Boolean);
            const looksRefunded = rawPaymentStatus === 'refunded' || detailStates.some((s) => s.includes('refund'));
            const looksVoided = rawPaymentStatus === 'voided' || rawPaymentStatus === 'cancelled' || detailStates.some((s) => s.includes('void') || s.includes('cancel'));
            const looksPaid = rawPaymentStatus === 'paid'
                || !!order.paid_at
                || detailStates.some((s) => s === 'paid' || s === 'approved' || s === 'accredited' || s === 'captured');
            const normalizedPaymentStatus = looksRefunded ? 'refunded' : looksVoided ? 'voided' : looksPaid ? 'paid' : 'pending';
            // Extraer nombre del cliente de diferentes fuentes
            let customerName = 'Sin nombre';
            if (order.customer) {
                if (order.customer.name) {
                    customerName = order.customer.name;
                }
                else if (order.customer.first_name || order.customer.last_name) {
                    customerName = `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim();
                }
            }
            // También intentar desde contact o billing_address
            if (customerName === 'Sin nombre' && order.contact_name) {
                customerName = order.contact_name;
            }
            if (customerName === 'Sin nombre' && order.billing_name) {
                customerName = order.billing_name;
            }
            if (customerName === 'Sin nombre' && ((_b = order.shipping_address) === null || _b === void 0 ? void 0 : _b.name)) {
                customerName = order.shipping_address.name;
            }
            const shippingCandidates = [
                order.shipping_option,
                order.shipping_option_name,
                order.shipping_method,
                order.shipping_method_name,
                order.shipping_name,
                order.shipping_type,
                order.shipping_mode,
                order.shipping_service,
                order.shipping_status,
                order.gateway_name
            ]
                .map((v) => (v == null ? '' : String(v).trim()))
                .filter(Boolean);
            const shippingMethod = shippingCandidates[0] || '';
            const expressBlob = shippingCandidates.join(' ').toLowerCase();
            const hasExpressShipping = /\bexpress\b|\bexpr[eé]s\b|\bflash\b|\bsame\s*day\b|\benv[ií]o\s+en\s+el\s+d[ií]a\b|\br[aá]pido\b|\br[aá]pida\b/.test(expressBlob);
            return {
                id: order.id,
                number: order.number,
                status: order.status,
                paymentStatus: normalizedPaymentStatus,
                paymentStatusRaw: rawPaymentStatus || null,
                isPaid: normalizedPaymentStatus === 'paid',
                shippingStatus: order.shipping_status,
                shippingMethod,
                hasExpressShipping,
                total: order.total,
                currency: order.currency,
                customer: {
                    name: customerName,
                    email: ((_c = order.customer) === null || _c === void 0 ? void 0 : _c.email) || order.contact_email || '',
                    phone: ((_d = order.customer) === null || _d === void 0 ? void 0 : _d.phone) || order.contact_phone || ''
                },
                products: (order.products || []).map((p) => ({
                    id: p.product_id,
                    variantId: p.variant_id,
                    name: p.name,
                    sku: p.sku,
                    quantity: p.quantity,
                    price: p.price
                })),
                shippingAddress: order.shipping_address ? {
                    address: order.shipping_address.address,
                    city: order.shipping_address.city,
                    province: order.shipping_address.province,
                    zipcode: order.shipping_address.zipcode,
                    number: order.shipping_address.number,
                    floor: order.shipping_address.floor,
                    apartment: order.shipping_address.apartment,
                    locality: order.shipping_address.locality,
                    country: order.shipping_address.country,
                    betweenStreets: order.shipping_address.between_streets
                } : null,
                createdAt: order.created_at,
                updatedAt: order.updated_at
            };
        });
        if (only_paid_pending_shipment === '1' || only_paid_pending_shipment === 'true') {
            orders = orders.filter((o) => o.isPaid === true &&
                o.shippingStatus !== 'shipped' &&
                o.shippingStatus !== 'delivered');
        }
        // Marcar si cada orden TN ya fue facturada en facturación masiva externa.
        const tnExternalIds = Array.from(new Set(orders.map((o) => String(o.id)).filter(Boolean)));
        if (tnExternalIds.length > 0) {
            const placeholders = tnExternalIds.map(() => '?').join(', ');
            const invoicedRows = yield (0, db_1.query)(`SELECT id, external_order_id, cae, cbte_tipo, cbte_desde, created_at
         FROM external_invoices
         WHERE source = 'TIENDANUBE' AND external_order_id IN (${placeholders})`, tnExternalIds);
            const byExternalId = new Map();
            for (const row of invoicedRows)
                byExternalId.set(String(row.external_order_id), row);
            orders = orders.map((o) => {
                const inv = byExternalId.get(String(o.id));
                return Object.assign(Object.assign({}, o), { invoiced: !!inv, invoice: inv ? {
                        id: inv.id,
                        cae: inv.cae,
                        cbteTipo: inv.cbte_tipo,
                        cbteDesde: inv.cbte_desde,
                        createdAt: inv.created_at
                    } : undefined });
            });
        }
        res.json({
            orders,
            page: pageNum,
            per_page: perPageNum,
            total: (only_paid_pending_shipment === '1' || only_paid_pending_shipment === 'true') ? orders.length : (ordersRes.headers['x-total-count'] || orders.length)
        });
    }
    catch (error) {
        console.error('Error fetching TN orders:', ((_143 = error.response) === null || _143 === void 0 ? void 0 : _143.data) || error.message);
        res.status(500).json({ message: 'Error obteniendo órdenes de Tienda Nube', error: error.message });
    }
});
exports.getTiendaNubeOrders = getTiendaNubeOrders;
function normalizeTnPaymentStatus(order) {
    var _a;
    const rawPaymentStatus = ((_a = order === null || order === void 0 ? void 0 : order.payment_status) !== null && _a !== void 0 ? _a : '').toString().trim().toLowerCase();
    const paymentDetails = Array.isArray(order === null || order === void 0 ? void 0 : order.payment_details) ? order.payment_details : [];
    const detailStates = paymentDetails
        .map((d) => { var _a, _b; return ((_b = (_a = d === null || d === void 0 ? void 0 : d.status) !== null && _a !== void 0 ? _a : d === null || d === void 0 ? void 0 : d.state) !== null && _b !== void 0 ? _b : '').toString().trim().toLowerCase(); })
        .filter(Boolean);
    const looksRefunded = rawPaymentStatus === 'refunded' || detailStates.some((s) => s.includes('refund'));
    const looksVoided = rawPaymentStatus === 'voided' || rawPaymentStatus === 'cancelled' || detailStates.some((s) => s.includes('void') || s.includes('cancel'));
    const looksPaid = rawPaymentStatus === 'paid'
        || !!(order === null || order === void 0 ? void 0 : order.paid_at)
        || detailStates.some((s) => s === 'paid' || s === 'approved' || s === 'accredited' || s === 'captured');
    return looksRefunded ? 'refunded' : looksVoided ? 'voided' : looksPaid ? 'paid' : 'pending';
}
/** Emite facturas AFIP masivas para órdenes de Tienda Nube (solo pagadas). */
const invoiceTiendaNubeOrdersBulk = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _144, _145, _146, _147, _148, _149, _150, _151, _152, _153, _154, _155, _156, _157, _158;
    try {
        const authUser = req.user;
        if (!authUser || !['ADMIN', 'WAREHOUSE', 'DEPOSITO'].includes(authUser.role)) {
            return res.status(403).json({ message: 'Solo ADMIN o Depósito pueden emitir facturas' });
        }
        const orderIdsRaw = Array.isArray((_144 = req.body) === null || _144 === void 0 ? void 0 : _144.orderIds) ? req.body.orderIds : [];
        const orderIds = Array.from(new Set(orderIdsRaw.map((x) => String(x).trim()).filter(Boolean)));
        const cbteTipoFromBody = (_145 = req.body) === null || _145 === void 0 ? void 0 : _145.cbteTipo;
        const forceCbteTipo = (cbteTipoFromBody === 1 || cbteTipoFromBody === 6) ? cbteTipoFromBody : undefined;
        if (!orderIds.length)
            return res.status(400).json({ message: 'Debes enviar orderIds con al menos una orden' });
        if (orderIds.length > 100)
            return res.status(400).json({ message: 'Máximo 100 órdenes por lote' });
        const integration = yield (0, db_1.get)(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
        if (!(integration === null || integration === void 0 ? void 0 : integration.access_token)) {
            return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
        }
        const storeId = integration.store_id || integration.user_id;
        if (!storeId) {
            return res.status(400).json({ message: 'No se encontró el store_id de Tienda Nube' });
        }
        const { emitirFactura: emitirAfip } = yield Promise.resolve().then(() => __importStar(require('../services/afip.service')));
        const results = [];
        const payableOrders = [];
        for (const orderId of orderIds) {
            const orderIdStr = String(orderId);
            try {
                const existing = yield (0, db_1.get)(`SELECT id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta
           FROM external_invoices
           WHERE source = 'TIENDANUBE' AND external_order_id = ?`, [orderIdStr]);
                if (existing) {
                    results.push({
                        orderId,
                        status: 'already_invoiced',
                        invoiceId: existing.id,
                        cae: existing.cae,
                        cbteTipo: existing.cbte_tipo,
                        cbteDesde: existing.cbte_desde,
                        cbteHasta: existing.cbte_hasta
                    });
                    continue;
                }
                const orderRes = yield axios_1.default.get(`https://api.tiendanube.com/v1/${storeId}/orders/${encodeURIComponent(orderIdStr)}`, {
                    headers: {
                        'Authentication': `bearer ${integration.access_token}`,
                        'User-Agent': TN_USER_AGENT
                    },
                    validateStatus: () => true
                });
                if (orderRes.status !== 200 || !orderRes.data) {
                    results.push({ orderId: orderIdStr, status: 'error', message: 'No se pudo obtener la orden de Tienda Nube' });
                    continue;
                }
                const order = orderRes.data;
                const paymentStatus = normalizeTnPaymentStatus(order);
                if (paymentStatus !== 'paid') {
                    results.push({ orderId: orderIdStr, status: 'skipped_unpaid', message: `La orden no está pagada (estado: ${paymentStatus})` });
                    continue;
                }
                const total = Number((_146 = order === null || order === void 0 ? void 0 : order.total) !== null && _146 !== void 0 ? _146 : 0);
                if (!Number.isFinite(total) || total <= 0) {
                    results.push({ orderId: orderIdStr, status: 'error', message: 'La orden tiene total inválido para facturar' });
                    continue;
                }
                const customerName = ((_147 = order === null || order === void 0 ? void 0 : order.customer) === null || _147 === void 0 ? void 0 : _147.name)
                    || `${((_148 = order === null || order === void 0 ? void 0 : order.customer) === null || _148 === void 0 ? void 0 : _148.first_name) || ''} ${((_149 = order === null || order === void 0 ? void 0 : order.customer) === null || _149 === void 0 ? void 0 : _149.last_name) || ''}`.trim()
                    || (order === null || order === void 0 ? void 0 : order.contact_name)
                    || (order === null || order === void 0 ? void 0 : order.billing_name)
                    || 'Consumidor Final';
                const rawDoc = String((_153 = (_151 = (_150 = order === null || order === void 0 ? void 0 : order.billing_address) === null || _150 === void 0 ? void 0 : _150.doc_number) !== null && _151 !== void 0 ? _151 : (_152 = order === null || order === void 0 ? void 0 : order.customer) === null || _152 === void 0 ? void 0 : _152.doc_number) !== null && _153 !== void 0 ? _153 : '').replace(/\D/g, '');
                const maybeCuit = rawDoc.length >= 10 ? rawDoc : undefined;
                const condicionIvaRaw = (((_154 = order === null || order === void 0 ? void 0 : order.billing_address) === null || _154 === void 0 ? void 0 : _154.fiscal_regime)
                    || ((_155 = order === null || order === void 0 ? void 0 : order.customer) === null || _155 === void 0 ? void 0 : _155.fiscal_regime)
                    || ((_156 = order === null || order === void 0 ? void 0 : order.customer) === null || _156 === void 0 ? void 0 : _156.iva_condition)
                    || 'Consumidor Final').toString();
                payableOrders.push({
                    orderId: String(order.id),
                    orderNumber: String((_157 = order.number) !== null && _157 !== void 0 ? _157 : order.id),
                    total,
                    date: String((order === null || order === void 0 ? void 0 : order.created_at) || new Date().toISOString().slice(0, 10)),
                    customerId: `TN-${((_158 = order === null || order === void 0 ? void 0 : order.customer) === null || _158 === void 0 ? void 0 : _158.id) || order.id}`,
                    customerName,
                    customerCuit: maybeCuit,
                    condicionIva: condicionIvaRaw || 'Consumidor Final'
                });
            }
            catch (e) {
                results.push({
                    orderId: orderIdStr,
                    status: 'error',
                    message: (e === null || e === void 0 ? void 0 : e.message) || 'Error emitiendo factura'
                });
            }
        }
        if (payableOrders.length > 0) {
            const totalLote = payableOrders.reduce((acc, o) => acc + o.total, 0);
            const base = payableOrders[0];
            const sameCustomer = payableOrders.every((o) => o.customerId === base.customerId);
            const afipResult = yield emitirAfip({
                id: `TN-BULK-${Date.now()}`,
                date: base.date,
                total: totalLote,
                customerId: sameCustomer ? base.customerId : 'TN-BULK-CF'
            }, {
                id: sameCustomer ? base.customerId : 'TN-BULK-CF',
                businessName: sameCustomer ? base.customerName : 'Consumidor Final',
                cuit: sameCustomer ? base.customerCuit : undefined,
                condicionIva: sameCustomer ? base.condicionIva : 'Consumidor Final'
            }, forceCbteTipo);
            for (const o of payableOrders) {
                const invoiceId = (0, uuid_1.v4)();
                yield (0, db_1.execute)(`INSERT INTO external_invoices
           (id, source, external_order_id, order_number, customer_name, customer_cuit, customer_condicion_iva, total, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta)
           VALUES (?, 'TIENDANUBE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                    invoiceId,
                    o.orderId,
                    o.orderNumber,
                    o.customerName,
                    o.customerCuit || null,
                    o.condicionIva || null,
                    o.total,
                    afipResult.cae,
                    afipResult.caeFchVto || null,
                    afipResult.puntoVta,
                    afipResult.cbteTipo,
                    afipResult.cbteDesde,
                    afipResult.cbteHasta
                ]);
                results.push({
                    orderId: o.orderId,
                    status: 'invoiced',
                    invoiceId,
                    cae: afipResult.cae,
                    cbteTipo: afipResult.cbteTipo,
                    cbteDesde: afipResult.cbteDesde,
                    cbteHasta: afipResult.cbteHasta
                });
            }
        }
        const summary = {
            total: results.length,
            invoiced: results.filter(r => r.status === 'invoiced').length,
            alreadyInvoiced: results.filter(r => r.status === 'already_invoiced').length,
            skippedUnpaid: results.filter(r => r.status === 'skipped_unpaid').length,
            errors: results.filter(r => r.status === 'error').length
        };
        res.json({ message: 'Facturación masiva de Tienda Nube finalizada', summary, results });
    }
    catch (error) {
        console.error('invoiceTiendaNubeOrdersBulk:', error);
        const msg = (error === null || error === void 0 ? void 0 : error.message) || 'Error en facturación masiva de Tienda Nube';
        const status = msg.includes('no configurado') ? 503 : 500;
        res.status(status).json({ message: msg });
    }
});
exports.invoiceTiendaNubeOrdersBulk = invoiceTiendaNubeOrdersBulk;
/** Emite facturas AFIP masivas para órdenes de Mercado Libre (solo pagadas). */
const invoiceMercadoLibreOrdersBulk = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _159, _160, _161, _162, _163, _164, _165;
    try {
        const authUser = req.user;
        if (!authUser || !['ADMIN', 'WAREHOUSE', 'DEPOSITO'].includes(authUser.role)) {
            return res.status(403).json({ message: 'Solo ADMIN o Depósito pueden emitir facturas' });
        }
        const orderIdsRaw = Array.isArray((_159 = req.body) === null || _159 === void 0 ? void 0 : _159.orderIds) ? req.body.orderIds : [];
        const orderIds = Array.from(new Set(orderIdsRaw.map((x) => String(x).trim()).filter(Boolean)));
        const cbteTipoFromBody = (_160 = req.body) === null || _160 === void 0 ? void 0 : _160.cbteTipo;
        const forceCbteTipo = (cbteTipoFromBody === 1 || cbteTipoFromBody === 6) ? cbteTipoFromBody : undefined;
        if (!orderIds.length)
            return res.status(400).json({ message: 'Debes enviar orderIds con al menos una orden' });
        if (orderIds.length > 100)
            return res.status(400).json({ message: 'Máximo 100 órdenes por lote' });
        const mlToken = yield getValidMLToken();
        if (!mlToken) {
            return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
        }
        const { emitirFactura: emitirAfip } = yield Promise.resolve().then(() => __importStar(require('../services/afip.service')));
        const results = [];
        const payableOrders = [];
        for (const orderId of orderIds) {
            const orderIdStr = String(orderId);
            try {
                const existing = yield (0, db_1.get)(`SELECT id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta
           FROM external_invoices
           WHERE source = 'MERCADOLIBRE' AND external_order_id = ?`, [orderIdStr]);
                if (existing) {
                    results.push({
                        orderId,
                        status: 'already_invoiced',
                        invoiceId: existing.id,
                        cae: existing.cae,
                        cbteTipo: existing.cbte_tipo,
                        cbteDesde: existing.cbte_desde,
                        cbteHasta: existing.cbte_hasta
                    });
                    continue;
                }
                const orderRes = yield axios_1.default.get(`https://api.mercadolibre.com/orders/${encodeURIComponent(orderIdStr)}`, { headers: { 'Authorization': `Bearer ${mlToken.access_token}` }, validateStatus: () => true });
                if (orderRes.status !== 200 || !orderRes.data) {
                    results.push({ orderId: orderIdStr, status: 'error', message: 'No se pudo obtener la orden de Mercado Libre' });
                    continue;
                }
                const order = orderRes.data;
                if (((order === null || order === void 0 ? void 0 : order.status) || '').toString().toLowerCase() !== 'paid') {
                    results.push({ orderId: orderIdStr, status: 'skipped_unpaid', message: `La orden no está pagada (estado: ${(order === null || order === void 0 ? void 0 : order.status) || 'desconocido'})` });
                    continue;
                }
                const total = Number((_161 = order === null || order === void 0 ? void 0 : order.total_amount) !== null && _161 !== void 0 ? _161 : 0);
                if (!Number.isFinite(total) || total <= 0) {
                    results.push({ orderId: orderIdStr, status: 'error', message: 'La orden tiene total inválido para facturar' });
                    continue;
                }
                const buyerFirst = (((_162 = order === null || order === void 0 ? void 0 : order.buyer) === null || _162 === void 0 ? void 0 : _162.first_name) || '').toString().trim();
                const buyerLast = (((_163 = order === null || order === void 0 ? void 0 : order.buyer) === null || _163 === void 0 ? void 0 : _163.last_name) || '').toString().trim();
                const customerName = `${buyerFirst} ${buyerLast}`.trim()
                    || (((_164 = order === null || order === void 0 ? void 0 : order.buyer) === null || _164 === void 0 ? void 0 : _164.nickname) || '').toString().trim()
                    || 'Consumidor Final';
                payableOrders.push({
                    orderId: String(order.id),
                    total,
                    date: String((order === null || order === void 0 ? void 0 : order.date_created) || new Date().toISOString().slice(0, 10)),
                    customerId: `ML-${((_165 = order === null || order === void 0 ? void 0 : order.buyer) === null || _165 === void 0 ? void 0 : _165.id) || order.id}`,
                    customerName
                });
            }
            catch (e) {
                results.push({
                    orderId: orderIdStr,
                    status: 'error',
                    message: (e === null || e === void 0 ? void 0 : e.message) || 'Error emitiendo factura'
                });
            }
        }
        if (payableOrders.length > 0) {
            const totalLote = payableOrders.reduce((acc, o) => acc + o.total, 0);
            const base = payableOrders[0];
            const sameCustomer = payableOrders.every((o) => o.customerId === base.customerId);
            const afipResult = yield emitirAfip({
                id: `ML-BULK-${Date.now()}`,
                date: base.date,
                total: totalLote,
                customerId: sameCustomer ? base.customerId : 'ML-BULK-CF'
            }, {
                id: sameCustomer ? base.customerId : 'ML-BULK-CF',
                businessName: sameCustomer ? base.customerName : 'Consumidor Final',
                cuit: undefined,
                condicionIva: 'Consumidor Final'
            }, forceCbteTipo);
            for (const o of payableOrders) {
                const invoiceId = (0, uuid_1.v4)();
                yield (0, db_1.execute)(`INSERT INTO external_invoices
           (id, source, external_order_id, order_number, customer_name, customer_cuit, customer_condicion_iva, total, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta)
           VALUES (?, 'MERCADOLIBRE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                    invoiceId,
                    o.orderId,
                    o.orderId,
                    o.customerName,
                    null,
                    'Consumidor Final',
                    o.total,
                    afipResult.cae,
                    afipResult.caeFchVto || null,
                    afipResult.puntoVta,
                    afipResult.cbteTipo,
                    afipResult.cbteDesde,
                    afipResult.cbteHasta
                ]);
                results.push({
                    orderId: o.orderId,
                    status: 'invoiced',
                    invoiceId,
                    cae: afipResult.cae,
                    cbteTipo: afipResult.cbteTipo,
                    cbteDesde: afipResult.cbteDesde,
                    cbteHasta: afipResult.cbteHasta
                });
            }
        }
        const summary = {
            total: results.length,
            invoiced: results.filter(r => r.status === 'invoiced').length,
            alreadyInvoiced: results.filter(r => r.status === 'already_invoiced').length,
            skippedUnpaid: results.filter(r => r.status === 'skipped_unpaid').length,
            errors: results.filter(r => r.status === 'error').length
        };
        res.json({ message: 'Facturación masiva de Mercado Libre finalizada', summary, results });
    }
    catch (error) {
        console.error('invoiceMercadoLibreOrdersBulk:', error);
        const msg = (error === null || error === void 0 ? void 0 : error.message) || 'Error en facturación masiva de Mercado Libre';
        const status = msg.includes('no configurado') ? 503 : 500;
        res.status(status).json({ message: msg });
    }
});
exports.invoiceMercadoLibreOrdersBulk = invoiceMercadoLibreOrdersBulk;
/** Historial unificado de facturación masiva externa (Tienda Nube / Mercado Libre). */
const getExternalInvoicesHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _166, _167, _168;
    try {
        const authUser = req.user;
        if (!authUser || !['ADMIN', 'WAREHOUSE', 'DEPOSITO'].includes(authUser.role)) {
            return res.status(403).json({ message: 'Sin permisos para ver historial de facturación externa' });
        }
        const sourceRaw = String(((_166 = req.query) === null || _166 === void 0 ? void 0 : _166.source) || '').trim().toUpperCase();
        const source = sourceRaw === 'TIENDANUBE' || sourceRaw === 'MERCADOLIBRE' ? sourceRaw : '';
        const limitNum = Math.min(500, Math.max(1, parseInt(String(((_167 = req.query) === null || _167 === void 0 ? void 0 : _167.limit) || '50'), 10) || 50));
        const offsetNum = Math.max(0, parseInt(String(((_168 = req.query) === null || _168 === void 0 ? void 0 : _168.offset) || '0'), 10) || 0);
        const where = [];
        const params = [];
        if (source) {
            where.push('source = ?');
            params.push(source);
        }
        const countRow = yield (0, db_1.get)(`SELECT COUNT(*) AS cnt
       FROM external_invoices
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`, params);
        const total = Number((countRow === null || countRow === void 0 ? void 0 : countRow.cnt) || 0);
        const rows = yield (0, db_1.query)(`SELECT ei.id, ei.source, ei.external_order_id, ei.order_number, ei.customer_name, ei.total,
              ei.cae, ei.cae_fch_vto, ei.punto_venta, ei.cbte_tipo, ei.cbte_desde, ei.cbte_hasta, ei.created_at,
              ecn.id AS credit_note_id, ecn.cae AS credit_note_cae, ecn.cbte_tipo AS credit_note_cbte_tipo, ecn.cbte_desde AS credit_note_cbte_desde
       FROM external_invoices ei
       LEFT JOIN external_credit_notes ecn ON ecn.external_invoice_id = ei.id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ei.created_at DESC
       LIMIT ${limitNum} OFFSET ${offsetNum}`, params);
        // Totales globales (sin filtro de source) para el resumen del historial.
        const totalsRow = yield (0, db_1.get)(`SELECT
         COUNT(*) AS total_all,
         SUM(CASE WHEN source = 'TIENDANUBE' THEN 1 ELSE 0 END) AS total_tn,
         SUM(CASE WHEN source = 'MERCADOLIBRE' THEN 1 ELSE 0 END) AS total_ml
       FROM external_invoices`);
        res.json({
            total,
            offset: offsetNum,
            limit: limitNum,
            totals: {
                all: Number((totalsRow === null || totalsRow === void 0 ? void 0 : totalsRow.total_all) || 0),
                tn: Number((totalsRow === null || totalsRow === void 0 ? void 0 : totalsRow.total_tn) || 0),
                ml: Number((totalsRow === null || totalsRow === void 0 ? void 0 : totalsRow.total_ml) || 0)
            },
            invoices: rows.map((r) => {
                var _a;
                return ({
                    id: r.id,
                    source: r.source,
                    externalOrderId: r.external_order_id,
                    orderNumber: r.order_number,
                    customerName: r.customer_name,
                    total: Number(r.total || 0),
                    cae: r.cae,
                    caeFchVto: (_a = r.cae_fch_vto) !== null && _a !== void 0 ? _a : undefined,
                    puntoVta: r.punto_venta,
                    cbteTipo: r.cbte_tipo,
                    cbteDesde: r.cbte_desde,
                    cbteHasta: r.cbte_hasta,
                    createdAt: r.created_at,
                    hasCreditNote: !!r.credit_note_id,
                    creditNote: r.credit_note_id ? {
                        id: r.credit_note_id,
                        cae: r.credit_note_cae,
                        cbteTipo: r.credit_note_cbte_tipo,
                        cbteDesde: r.credit_note_cbte_desde
                    } : undefined
                });
            })
        });
    }
    catch (error) {
        console.error('getExternalInvoicesHistory:', error);
        res.status(500).json({ message: 'Error obteniendo historial de facturación externa' });
    }
});
exports.getExternalInvoicesHistory = getExternalInvoicesHistory;
/** Emite NC total para una factura externa (una por factura). */
const emitirNotaCreditoExternalInvoice = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const authUser = req.user;
        if (!authUser || !['ADMIN', 'WAREHOUSE', 'DEPOSITO'].includes(authUser.role)) {
            return res.status(403).json({ message: 'Solo ADMIN o Depósito pueden emitir notas de crédito' });
        }
        const { id } = req.params;
        if (!id)
            return res.status(400).json({ message: 'ID de factura externa requerido' });
        const inv = yield (0, db_1.get)(`SELECT id, source, external_order_id, customer_name, customer_cuit, customer_condicion_iva,
              total, punto_venta, cbte_tipo, cbte_desde
       FROM external_invoices WHERE id = ?`, [id]);
        if (!inv)
            return res.status(404).json({ message: 'Factura externa no encontrada' });
        const existingNc = yield (0, db_1.get)(`SELECT id FROM external_credit_notes WHERE external_invoice_id = ?`, [id]);
        if (existingNc)
            return res.status(409).json({ message: 'Esta factura externa ya tiene nota de crédito emitida' });
        const amount = Number(inv.total || 0);
        if (amount <= 0)
            return res.status(400).json({ message: 'Monto inválido para emitir nota de crédito' });
        const { emitirNotaCredito } = yield Promise.resolve().then(() => __importStar(require('../services/afip.service')));
        const result = yield emitirNotaCredito({ puntoVta: Number(inv.punto_venta), cbteTipo: Number(inv.cbte_tipo), cbteDesde: Number(inv.cbte_desde) }, {
            id: `EXT-${inv.id}`,
            businessName: String(inv.customer_name || 'Consumidor Final'),
            cuit: inv.customer_cuit ? String(inv.customer_cuit) : undefined,
            condicionIva: inv.customer_condicion_iva ? String(inv.customer_condicion_iva) : 'Consumidor Final'
        }, amount);
        const ncId = (0, uuid_1.v4)();
        yield (0, db_1.execute)(`INSERT INTO external_credit_notes
       (id, external_invoice_id, source, external_order_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, amount_credited)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [ncId, inv.id, inv.source, inv.external_order_id, result.cae, result.caeFchVto || null, result.puntoVta, result.cbteTipo, result.cbteDesde, result.cbteHasta, amount]);
        res.status(201).json({
            id: ncId,
            externalInvoiceId: inv.id,
            source: inv.source,
            externalOrderId: inv.external_order_id,
            cae: result.cae,
            cbteTipo: result.cbteTipo,
            cbteDesde: result.cbteDesde,
            cbteHasta: result.cbteHasta
        });
    }
    catch (error) {
        console.error('emitirNotaCreditoExternalInvoice:', error);
        const msg = (error === null || error === void 0 ? void 0 : error.message) || 'Error emitiendo nota de crédito externa';
        const status = msg.includes('ya tiene') ? 409 : msg.includes('no configurado') ? 503 : 500;
        res.status(status).json({ message: msg });
    }
});
exports.emitirNotaCreditoExternalInvoice = emitirNotaCreditoExternalInvoice;
/** Listado de preguntas del vendedor (historial desde la API de Mercado Libre). */
const getMercadoLibreQuestions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _169, _170, _171;
    try {
        const mlToken = yield getValidMLToken();
        if (!mlToken) {
            return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
        }
        const offsetNum = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
        const limitNum = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10) || 20));
        const statusFilter = (req.query.status || '').toString().trim().toUpperCase();
        const allowedStatus = ['ANSWERED', 'UNANSWERED', 'BANNED', 'CLOSED_UNANSWERED', 'UNDER_REVIEW'];
        let dateFromRaw = (req.query.date_from || '').toString().trim();
        let dateToRaw = (req.query.date_to || '').toString().trim();
        const ymd = /^\d{4}-\d{2}-\d{2}$/;
        if (dateFromRaw && dateToRaw && ymd.test(dateFromRaw) && ymd.test(dateToRaw) && dateFromRaw > dateToRaw) {
            const t = dateFromRaw;
            dateFromRaw = dateToRaw;
            dateToRaw = t;
        }
        const params = new URLSearchParams({
            seller_id: String(mlToken.user_id),
            limit: String(limitNum),
            offset: String(offsetNum),
            /** Últimas primero (API ML) */
            sort_fields: 'date_created',
            sort_types: 'DESC',
        });
        if (statusFilter && allowedStatus.includes(statusFilter)) {
            params.set('status', statusFilter);
        }
        if (dateFromRaw && ymd.test(dateFromRaw)) {
            params.set('from', `${dateFromRaw}T00:00:00.000-03:00`);
        }
        if (dateToRaw && ymd.test(dateToRaw)) {
            params.set('to', `${dateToRaw}T23:59:59.999-03:00`);
        }
        const baseQs = params.toString();
        let r;
        try {
            r = yield axios_1.default.get(`https://api.mercadolibre.com/questions/search?${baseQs}`, {
                headers: { Authorization: `Bearer ${mlToken.access_token}` },
            });
        }
        catch (first) {
            if (((_169 = first === null || first === void 0 ? void 0 : first.response) === null || _169 === void 0 ? void 0 : _169.status) === 400 && baseQs.includes('sort_fields')) {
                const fallback = new URLSearchParams(baseQs);
                fallback.delete('sort_fields');
                fallback.delete('sort_types');
                r = yield axios_1.default.get(`https://api.mercadolibre.com/questions/search?${fallback.toString()}`, {
                    headers: { Authorization: `Bearer ${mlToken.access_token}` },
                });
            }
            else {
                throw first;
            }
        }
        const data = r.data || {};
        const raw = Array.isArray(data.questions) ? data.questions : Array.isArray(data.results) ? data.results : [];
        const questions = raw
            .map((q) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
            return ({
                id: q.id,
                text: (_a = q.text) !== null && _a !== void 0 ? _a : '',
                status: (_b = q.status) !== null && _b !== void 0 ? _b : '',
                itemId: q.item_id != null ? String(q.item_id) : null,
                itemTitle: (_e = (_d = (_c = q.item) === null || _c === void 0 ? void 0 : _c.title) !== null && _d !== void 0 ? _d : q.item_title) !== null && _e !== void 0 ? _e : null,
                dateCreated: (_f = q.date_created) !== null && _f !== void 0 ? _f : null,
                buyerNickname: (_k = (_h = (_g = q.buyer) === null || _g === void 0 ? void 0 : _g.nickname) !== null && _h !== void 0 ? _h : (_j = q.from) === null || _j === void 0 ? void 0 : _j.nickname) !== null && _k !== void 0 ? _k : null,
                answerText: (_m = (_l = q.answer) === null || _l === void 0 ? void 0 : _l.text) !== null && _m !== void 0 ? _m : null,
                answerDate: (_p = (_o = q.answer) === null || _o === void 0 ? void 0 : _o.date_created) !== null && _p !== void 0 ? _p : null,
            });
        })
            .sort((a, b) => {
            const ta = a.dateCreated ? new Date(a.dateCreated).getTime() : 0;
            const tb = b.dateCreated ? new Date(b.dateCreated).getTime() : 0;
            return tb - ta;
        });
        res.json({
            questions,
            total: typeof data.total === 'number' ? data.total : questions.length,
            offset: typeof data.offset === 'number' ? data.offset : offsetNum,
            limit: typeof data.limit === 'number' ? data.limit : limitNum,
        });
    }
    catch (error) {
        const errData = (_170 = error.response) === null || _170 === void 0 ? void 0 : _170.data;
        console.error('[ML Questions]', errData || error.message);
        const msg = (typeof (errData === null || errData === void 0 ? void 0 : errData.message) === 'string' && errData.message) ||
            (typeof (errData === null || errData === void 0 ? void 0 : errData.error) === 'string' && errData.error) ||
            error.message ||
            'Error al obtener preguntas de Mercado Libre';
        res.status(((_171 = error.response) === null || _171 === void 0 ? void 0 : _171.status) || 500).json({ message: msg });
    }
});
exports.getMercadoLibreQuestions = getMercadoLibreQuestions;
// Obtener órdenes de Mercado Libre
const getMercadoLibreOrders = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _172;
    try {
        const mlToken = yield getValidMLToken();
        if (!mlToken) {
            return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
        }
        const { offset = '0', limit = '20', status, date_from, date_to, only_pending_shipment_and_cancelled } = req.query;
        const limitNum = Math.min(Math.max(1, parseInt(limit) || 20), 50);
        const offsetNum = Math.max(0, parseInt(offset) || 0);
        const onlyPendingAndCancelled = only_pending_shipment_and_cancelled === '1' || only_pending_shipment_and_cancelled === 'true';
        const mapOrder = (order) => {
            var _a, _b, _c, _d, _e, _f;
            let shippingStatus = (_a = order._shipment_status) !== null && _a !== void 0 ? _a : null;
            if (!shippingStatus && order.shipping) {
                shippingStatus = order.shipping.status || order.shipping.substatus || null;
                if (!shippingStatus && order.status === 'paid' && order.shipping.id) {
                    shippingStatus = 'ready_to_ship';
                }
            }
            const statusMap = {
                'to_be_agreed': 'pending', 'pending': 'pending', 'handling': 'handling',
                'ready_to_ship': 'ready_to_ship', 'shipped': 'shipped', 'delivered': 'delivered',
                'not_delivered': 'not_delivered', 'cancelled': 'cancelled'
            };
            const logisticType = ((_b = order.shipping) === null || _b === void 0 ? void 0 : _b.logistic_type) || null;
            const isFlex = logisticType === 'self_service';
            return {
                id: order.id,
                status: order.status,
                statusDetail: order.status_detail,
                total: order.total_amount,
                currency: order.currency_id,
                buyer: {
                    id: (_c = order.buyer) === null || _c === void 0 ? void 0 : _c.id,
                    nickname: (_d = order.buyer) === null || _d === void 0 ? void 0 : _d.nickname,
                    firstName: (_e = order.buyer) === null || _e === void 0 ? void 0 : _e.first_name,
                    lastName: (_f = order.buyer) === null || _f === void 0 ? void 0 : _f.last_name
                },
                items: (order.order_items || []).map((item) => {
                    var _a, _b, _c, _d, _e;
                    return ({
                        id: (_a = item.item) === null || _a === void 0 ? void 0 : _a.id,
                        title: (_b = item.item) === null || _b === void 0 ? void 0 : _b.title,
                        sku: ((_c = item.item) === null || _c === void 0 ? void 0 : _c.seller_sku) || ((_d = item.item) === null || _d === void 0 ? void 0 : _d.seller_custom_field),
                        quantity: item.quantity,
                        unitPrice: item.unit_price,
                        variationId: (_e = item.item) === null || _e === void 0 ? void 0 : _e.variation_id
                    });
                }),
                shipping: order.shipping ? {
                    id: order.shipping.id,
                    status: statusMap[shippingStatus] || shippingStatus || 'pending'
                } : null,
                isFlex,
                dateCreated: order.date_created,
                dateClosed: order.date_closed
            };
        };
        const groupMlOrdersByPurchase = (rows) => {
            const groupKey = (o) => {
                var _a, _b, _c;
                const packId = String((_a = o === null || o === void 0 ? void 0 : o.pack_id) !== null && _a !== void 0 ? _a : '').trim();
                if (packId)
                    return `pack:${packId}`;
                const buyerId = String((_c = (_b = o === null || o === void 0 ? void 0 : o.buyer) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0 ? _c : '').trim();
                const minute = String((o === null || o === void 0 ? void 0 : o.date_created) || '').slice(0, 16);
                return `fallback:${buyerId}:${minute}`;
            };
            const groups = new Map();
            for (const o of rows || []) {
                const key = groupKey(o);
                if (!groups.has(key))
                    groups.set(key, []);
                groups.get(key).push(o);
            }
            return Array.from(groups.values()).map((group) => {
                const first = group[0];
                const orderIds = group.map((o) => o.id);
                const allItems = group.flatMap((o) => o.order_items || []);
                const totalAmount = group.reduce((acc, o) => acc + (Number(o === null || o === void 0 ? void 0 : o.total_amount) || 0), 0);
                const merged = Object.assign(Object.assign({}, first), { total_amount: totalAmount, order_ids: orderIds, order_items: allItems });
                if (first === null || first === void 0 ? void 0 : first._shipment_status)
                    merged._shipment_status = first._shipment_status;
                return merged;
            });
        };
        let orders;
        let total;
        if (onlyPendingAndCancelled) {
            // Solo "por enviar": órdenes pagadas cuyo shipment está en handling o ready_to_ship (API de Shipments)
            const baseParams = `seller=${mlToken.user_id}&limit=50&sort=date_desc`;
            const dateFrom = date_from ? `&order.date_created.from=${date_from}T00:00:00.000-03:00` : '';
            const dateTo = date_to ? `&order.date_created.to=${date_to}T23:59:59.999-03:00` : '';
            const paidRes = yield axios_1.default.get(`https://api.mercadolibre.com/orders/search?${baseParams}&order.status=paid${dateFrom}${dateTo}`, { headers: { 'Authorization': `Bearer ${mlToken.access_token}` } });
            const paid = paidRes.data.results || [];
            const POR_ENVIAR_STATUSES = ['handling', 'ready_to_ship'];
            const authHeader = { 'Authorization': `Bearer ${mlToken.access_token}`, 'x-format-new': 'true' };
            const getShipmentId = (order) => __awaiter(void 0, void 0, void 0, function* () {
                var _173, _174, _175;
                const ship = order.shipping || order.shipment;
                if (ship === null || ship === void 0 ? void 0 : ship.id)
                    return ship.id;
                try {
                    const det = yield axios_1.default.get(`https://api.mercadolibre.com/orders/${order.id}`, {
                        headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
                    });
                    const s = ((_173 = det.data) === null || _173 === void 0 ? void 0 : _173.shipping) || ((_174 = det.data) === null || _174 === void 0 ? void 0 : _174.shipment);
                    return (_175 = s === null || s === void 0 ? void 0 : s.id) !== null && _175 !== void 0 ? _175 : null;
                }
                catch (_176) {
                    return null;
                }
            });
            const getShipmentStatus = (shipmentId) => __awaiter(void 0, void 0, void 0, function* () {
                var _177, _178, _179, _180;
                try {
                    const res = yield axios_1.default.get(`https://api.mercadolibre.com/shipments/${shipmentId}`, {
                        headers: authHeader
                    });
                    const data = res.data || {};
                    const st = ((_178 = (_177 = data.status) !== null && _177 !== void 0 ? _177 : data.substatus) !== null && _178 !== void 0 ? _178 : '').toString().trim().toLowerCase();
                    return st || null;
                }
                catch (_181) {
                    try {
                        const res = yield axios_1.default.get(`https://api.mercadolibre.com/marketplace/shipments/${shipmentId}`, {
                            headers: authHeader
                        });
                        const data = res.data || {};
                        const st = ((_180 = (_179 = data.status) !== null && _179 !== void 0 ? _179 : data.substatus) !== null && _180 !== void 0 ? _180 : '').toString().trim().toLowerCase();
                        return st || null;
                    }
                    catch (_182) {
                        return null;
                    }
                }
            });
            const BATCH = 5;
            const ordersPorEnviar = [];
            for (let i = 0; i < paid.length; i += BATCH) {
                const batch = paid.slice(i, i + BATCH);
                const shipmentIds = yield Promise.all(batch.map(getShipmentId));
                const statuses = yield Promise.all(shipmentIds.map((id) => (id ? getShipmentStatus(id) : Promise.resolve(null))));
                batch.forEach((order, idx) => {
                    const st = statuses[idx];
                    if (st && POR_ENVIAR_STATUSES.includes(st)) {
                        order._shipment_status = st;
                        ordersPorEnviar.push(order);
                    }
                });
            }
            ordersPorEnviar.sort((a, b) => new Date(b.date_created).getTime() - new Date(a.date_created).getTime());
            const groupedOrders = groupMlOrdersByPurchase(ordersPorEnviar);
            total = groupedOrders.length;
            orders = groupedOrders.slice(offsetNum, offsetNum + limitNum).map((o) => {
                const mapped = mapOrder(o);
                if (o.order_ids && o.order_ids.length > 1) {
                    mapped.orderIds = o.order_ids;
                }
                return mapped;
            });
        }
        else {
            const allRaw = [];
            const fetchLimit = 50;
            let fetchOffset = 0;
            while (fetchOffset <= 5000) {
                let url = `https://api.mercadolibre.com/orders/search?seller=${mlToken.user_id}&offset=${fetchOffset}&limit=${fetchLimit}&sort=date_desc`;
                if (status)
                    url += `&order.status=${status}`;
                if (date_from)
                    url += `&order.date_created.from=${date_from}T00:00:00.000-03:00`;
                if (date_to)
                    url += `&order.date_created.to=${date_to}T23:59:59.999-03:00`;
                const ordersRes = yield axios_1.default.get(url, {
                    headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
                });
                const batch = ordersRes.data.results || [];
                if (!batch.length)
                    break;
                allRaw.push(...batch);
                if (batch.length < fetchLimit)
                    break;
                fetchOffset += fetchLimit;
            }
            const grouped = groupMlOrdersByPurchase(allRaw);
            total = grouped.length;
            orders = grouped.slice(offsetNum, offsetNum + limitNum).map((o) => {
                const mapped = mapOrder(o);
                if (o.order_ids && o.order_ids.length > 1) {
                    mapped.orderIds = o.order_ids;
                }
                return mapped;
            });
        }
        // Marcar si las órdenes ML del response ya están facturadas.
        const externalIdsFlat = Array.from(new Set(orders.flatMap((o) => {
            const ids = Array.isArray(o.orderIds) && o.orderIds.length > 0 ? o.orderIds : [o.id];
            return (ids || []).map((id) => String(id)).filter(Boolean);
        })));
        if (externalIdsFlat.length > 0) {
            const placeholders = externalIdsFlat.map(() => '?').join(', ');
            const invoicedRows = yield (0, db_1.query)(`SELECT id, external_order_id, cae, cbte_tipo, cbte_desde, created_at
         FROM external_invoices
         WHERE source = 'MERCADOLIBRE' AND external_order_id IN (${placeholders})`, externalIdsFlat);
            const byExternalId = new Map();
            for (const row of invoicedRows)
                byExternalId.set(String(row.external_order_id), row);
            orders = orders.map((o) => {
                const ids = Array.isArray(o.orderIds) && o.orderIds.length > 0 ? o.orderIds : [o.id];
                const invMatches = ids.map((id) => byExternalId.get(String(id))).filter(Boolean);
                const fullyInvoiced = ids.length > 0 && invMatches.length === ids.length;
                const inv = invMatches[0];
                return Object.assign(Object.assign({}, o), { invoiced: fullyInvoiced, invoicedCount: invMatches.length, totalOrderIds: ids.length, invoice: inv ? {
                        id: inv.id,
                        cae: inv.cae,
                        cbteTipo: inv.cbte_tipo,
                        cbteDesde: inv.cbte_desde,
                        createdAt: inv.created_at
                    } : undefined });
            });
        }
        res.json({
            orders,
            offset: offsetNum,
            limit: limitNum,
            total
        });
    }
    catch (error) {
        console.error('Error fetching ML orders:', ((_172 = error.response) === null || _172 === void 0 ? void 0 : _172.data) || error.message);
        res.status(500).json({ message: 'Error obteniendo órdenes de Mercado Libre', error: error.message });
    }
});
exports.getMercadoLibreOrders = getMercadoLibreOrders;
// Totales de stock Mercado Libre (todas las publicaciones, para las cards)
const getMercadoLibreStockTotals = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _183, _184;
    try {
        const mlToken = yield getValidMLToken();
        if (!mlToken) {
            return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
        }
        const limit = 50;
        let offset = 0;
        let totalProducts = 0;
        let totalStock = 0;
        let lowStockCount = 0;
        let noStockCount = 0;
        while (true) {
            const itemsRes = yield axios_1.default.get(`https://api.mercadolibre.com/users/${mlToken.user_id}/items/search?status=active&offset=${offset}&limit=${limit}`, { headers: { 'Authorization': `Bearer ${mlToken.access_token}` } });
            const itemIds = itemsRes.data.results || [];
            if (itemIds.length === 0)
                break;
            const batchSize = 10;
            for (let i = 0; i < itemIds.length; i += batchSize) {
                const batch = itemIds.slice(i, i + batchSize);
                const results = yield Promise.all(batch.map((id) => axios_1.default.get(`https://api.mercadolibre.com/items/${id}?include_attributes=all`, { headers: { 'Authorization': `Bearer ${mlToken.access_token}` } }).then(r => r.data).catch(() => null)));
                for (const item of results) {
                    if (!item)
                        continue;
                    let productStock = 0;
                    if ((_183 = item.variations) === null || _183 === void 0 ? void 0 : _183.length) {
                        productStock = item.variations.reduce((s, v) => s + (v.available_quantity || 0), 0);
                    }
                    else {
                        productStock = item.available_quantity || 0;
                    }
                    totalProducts += 1;
                    totalStock += productStock;
                    if (productStock === 0)
                        noStockCount += 1;
                    else if (productStock < 5)
                        lowStockCount += 1;
                }
            }
            if (itemIds.length < limit)
                break;
            offset += limit;
            if (offset >= 10000)
                break;
        }
        res.json({ totalProducts, totalStock, lowStockCount, noStockCount });
    }
    catch (error) {
        console.error('Error fetching ML stock totals:', ((_184 = error.response) === null || _184 === void 0 ? void 0 : _184.data) || error.message);
        res.status(500).json({ message: 'Error obteniendo totales de Mercado Libre', error: error.message });
    }
});
exports.getMercadoLibreStockTotals = getMercadoLibreStockTotals;
// Obtener stock de Mercado Libre
/** Normaliza título para agrupar: quita espacios de más y unifica. */
function mlNormalizeTitle(title) {
    return (title || '').trim().replace(/\s+/g, ' ');
}
/** Registra una publicación ML en variant_publications (sincronización de stock). */
function registerMercadoLibrePublication(variantId, mlItemId, mlVariationId = null, mlPack = 1) {
    return __awaiter(this, void 0, void 0, function* () {
        const productId = String(mlItemId || '').trim();
        if (!productId || !variantId)
            return;
        const extVarId = mlVariationId != null && String(mlVariationId).trim() !== '' ? String(mlVariationId).trim() : '';
        yield (0, db_1.execute)(`INSERT INTO variant_publications (id, variant_id, platform, external_product_id, external_variant_id, pack_size)
     VALUES (?, ?, 'mercadolibre', ?, ?, ?)
     ON DUPLICATE KEY UPDATE pack_size = VALUES(pack_size)`, [(0, uuid_1.v4)(), variantId, productId, extVarId, Math.max(1, mlPack)]);
    });
}
/** Crea o reutiliza variante local y vincula una o más publicaciones ML del mismo color/talle. */
function upsertLocalVariantFromMlEntries(productId, baseSku, entries) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const v = entries[0];
        const sizeCode = (v.size || 'U').toString().trim() || 'U';
        const colorCode = (v.color || 'Único').toString().trim() || 'Único';
        const sizeId = yield ensureSize(sizeCode);
        const colorId = yield ensureColor(colorCode);
        let productColorId = (_a = (yield (0, db_1.get)(`SELECT id FROM product_colors WHERE product_id = ? AND color_id = ?`, [productId, colorId]))) === null || _a === void 0 ? void 0 : _a.id;
        if (!productColorId) {
            productColorId = (0, uuid_1.v4)();
            yield (0, db_1.execute)(`INSERT INTO product_colors (id, product_id, color_id) VALUES (?, ?, ?)`, [productColorId, productId, colorId]);
        }
        const existingVariant = yield (0, db_1.get)(`SELECT id FROM product_variants WHERE product_color_id = ? AND size_id = ?`, [productColorId, sizeId]);
        let variantId = existingVariant === null || existingVariant === void 0 ? void 0 : existingVariant.id;
        let created = false;
        if (!variantId) {
            variantId = (0, uuid_1.v4)();
            const variantSku = v.sku || `${baseSku}-${sizeCode}-${colorCode}`;
            const primary = entries.find((e) => e.mlItemId) || v;
            const mlItemId = primary.mlItemId ? String(primary.mlItemId).trim() : null;
            const mlVarId = primary.variationId != null && String(primary.variationId) !== String(mlItemId || '')
                ? String(primary.variationId)
                : null;
            yield (0, db_1.execute)(`INSERT INTO product_variants (id, product_color_id, size_id, sku, mercado_libre_variant_id, mercado_libre_item_id) VALUES (?, ?, ?, ?, ?, ?)`, [variantId, productColorId, sizeId, variantSku, mlVarId, mlItemId]);
            yield (0, db_1.execute)(`INSERT INTO stocks (variant_id, stock) VALUES (?, ?) ON DUPLICATE KEY UPDATE stock = VALUES(stock)`, [variantId, v.stock]);
            created = true;
        }
        for (const e of entries) {
            const itemId = e.mlItemId ? String(e.mlItemId).trim() : '';
            if (!itemId)
                continue;
            const varId = e.variationId != null && String(e.variationId) !== itemId ? e.variationId : null;
            yield registerMercadoLibrePublication(variantId, itemId, varId);
        }
        return { variantId, created };
    });
}
/** Extrae título base para agrupar: quita las últimas 1–2 palabras (talle y opcionalmente color). */
function mlBaseTitle(title) {
    let t = mlStripTrailingPublicationIndex(mlNormalizeTitle(title));
    // Algunos títulos traen sufijos de publicación (p.ej. "Sin cuotas") que rompen el
    // agrupado por color/talle. Esto los elimina para recuperar el "título base".
    t = t
        .replace(/(?:^|\s)(?:sin|s\/c)\s*[-]?\s*cuotas?\s*[.,;:]?\s*$/i, '')
        .replace(/(?:^|\s)con\s*[-]?\s*cuotas?\s*[.,;:]?\s*$/i, '')
        .replace(/(?:^|\s)\d+\s*[-]?\s*cuotas?\s*[.,;:]?\s*$/i, '')
        .trim();
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length <= 1)
        return t;
    const last = words[words.length - 1];
    const secondLast = words[words.length - 2];
    const sizeLike = /^(P|M|G|GG|XG|XXG|XXXG|U|Único|\d{2,3})$/i;
    const colorLike = /^(blanco|negro|rojo|azul|verde|gris|rosa|nude|beige|celeste|amarillo|bordo|marron|multicolor)$/i;
    if (sizeLike.test(last) && words.length >= 2) {
        if (colorLike.test(secondLast))
            return words.slice(0, -2).join(' ');
        return words.slice(0, -1).join(' ');
    }
    // Si el último no es talle, puede ser solo color (ej. "... Nude") o título sin variante al final
    if (colorLike.test(last) && words.length >= 1)
        return words.slice(0, -1).join(' ');
    return t;
}
exports.mlBaseTitle = mlBaseTitle;
/** Quita sufijos de numeración de publicación (ej. "... Negro 1", "... #2", "... N° 3"). */
function mlStripTrailingPublicationIndex(title) {
    return (title || '')
        .replace(/\s*(?:#|N°|Nº)?\s*\d{1,2}\s*$/i, '')
        .trim();
}
exports.mlStripTrailingPublicationIndex = mlStripTrailingPublicationIndex;
/** Extrae color y talle del final del título (ej. "... Blanco G" -> color: Blanco, size: G). */
function mlColorSizeFromTitle(title) {
    let t = mlStripTrailingPublicationIndex(mlNormalizeTitle(title));
    t = t
        .replace(/(?:^|\s)(?:sin|s\/c)\s*[-]?\s*cuotas?\s*[.,;:]?\s*$/i, '')
        .replace(/(?:^|\s)con\s*[-]?\s*cuotas?\s*[.,;:]?\s*$/i, '')
        .replace(/(?:^|\s)\d+\s*[-]?\s*cuotas?\s*[.,;:]?\s*$/i, '')
        .trim();
    const words = t.split(/\s+/).filter(Boolean);
    const colorLike = /^(blanco|negro|rojo|azul|verde|gris|rosa|nude|beige|celeste|amarillo|bordo|marron|multicolor)$/i;
    const sizeLike = /^(P|M|G|GG|XG|XXG|XXXG|U|Único|\d{2,3})$/i;
    if (words.length >= 2 && sizeLike.test(words[words.length - 1])) {
        const size = words[words.length - 1];
        const color = colorLike.test(words[words.length - 2]) ? words[words.length - 2] : '';
        return { color, size };
    }
    // Si el último token es color pero no hay talle, devolver color y un talle vacío.
    if (words.length >= 1 && colorLike.test(words[words.length - 1])) {
        return { color: words[words.length - 1] || '', size: '' };
    }
    if (words.length >= 1)
        return { color: '', size: words[words.length - 1] || '' };
    return { color: '', size: '' };
}
exports.mlColorSizeFromTitle = mlColorSizeFromTitle;
const getMercadoLibreStock = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _185, _186, _187, _188, _189, _190, _191, _192, _193, _194, _195;
    try {
        const mlToken = yield getValidMLToken();
        if (!mlToken) {
            return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
        }
        const { status = 'active', offset = '0', limit = '50' } = req.query;
        // Obtener lista de items del vendedor
        const itemsUrl = `https://api.mercadolibre.com/users/${mlToken.user_id}/items/search?status=${status}&offset=${offset}&limit=${limit}`;
        const itemsRes = yield axios_1.default.get(itemsUrl, {
            headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
        });
        const itemIds = itemsRes.data.results || [];
        if (itemIds.length === 0) {
            return res.json({ items: [], total: 0 });
        }
        // Obtener detalles completos de cada item (necesario para variaciones con atributos)
        let items = [];
        // Procesar en paralelo pero limitado a 10 concurrent requests
        const batchSize = 10;
        for (let i = 0; i < itemIds.length; i += batchSize) {
            const batch = itemIds.slice(i, i + batchSize);
            const itemPromises = batch.map((itemId) => __awaiter(void 0, void 0, void 0, function* () {
                try {
                    const itemRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${itemId}?include_attributes=all`, {
                        headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
                    });
                    return itemRes.data;
                }
                catch (e) {
                    console.error(`Error fetching item ${itemId}:`, e);
                    return null;
                }
            }));
            const batchResults = yield Promise.all(itemPromises);
            for (const item of batchResults) {
                if (!item)
                    continue;
                // Si tiene variaciones, obtener stock por variación (una sola publicación con varias variantes)
                if (item.variations && item.variations.length > 0) {
                    let totalStock = 0;
                    const variations = item.variations.map((v) => {
                        var _a, _b, _c, _d;
                        totalStock += v.available_quantity || 0;
                        const skuAttr = Array.isArray(v.attributes) && v.attributes.find((a) => (a.id || '').toString().toUpperCase() === 'SELLER_SKU');
                        const skuFromAttr = skuAttr ? ((_b = (_a = skuAttr.value_name) !== null && _a !== void 0 ? _a : skuAttr.value) !== null && _b !== void 0 ? _b : '').toString().trim() : '';
                        const sku = skuFromAttr || ((_d = (_c = v.seller_sku) !== null && _c !== void 0 ? _c : v.seller_custom_field) !== null && _d !== void 0 ? _d : '').toString().trim();
                        let color = '';
                        let size = '';
                        (v.attribute_combinations || []).forEach((attr) => {
                            const id = (attr.id || '').toString().toUpperCase();
                            const name = (attr.value_name || attr.name || '').toString().trim();
                            if (id === 'COLOR' || id === 'COLOUR' || id === 'COR')
                                color = name;
                            if (id === 'SIZE' || id === 'SIZE_TYPE' || id === 'TALLE' || id === 'Talla')
                                size = name;
                        });
                        return {
                            variationId: v.id,
                            sku,
                            color,
                            size,
                            stock: v.available_quantity || 0,
                            sold: v.sold_quantity || 0
                        };
                    });
                    items.push({
                        id: item.id,
                        title: item.title,
                        status: item.status,
                        price: item.price,
                        totalStock,
                        soldTotal: item.sold_quantity || 0,
                        dateCreated: item.date_created || item.start_time || null,
                        thumbnail: item.thumbnail,
                        permalink: item.permalink,
                        hasVariations: true,
                        variations
                    });
                }
                else {
                    // Sin variaciones en la API: puede ser una publicación por variante (mismo producto, varios ítems). Se agrupa después.
                    let itemSku = ((_186 = (_185 = item.seller_sku) !== null && _185 !== void 0 ? _185 : item.seller_custom_field) !== null && _186 !== void 0 ? _186 : '').toString().trim();
                    if (!itemSku && Array.isArray(item.attributes)) {
                        const skuAttr = item.attributes.find((a) => (a.id || '').toString().toUpperCase() === 'SELLER_SKU');
                        if (skuAttr)
                            itemSku = ((_188 = (_187 = skuAttr.value_name) !== null && _187 !== void 0 ? _187 : skuAttr.value) !== null && _188 !== void 0 ? _188 : '').toString().trim();
                    }
                    if (!itemSku && item.variations && item.variations.length === 1) {
                        const v0 = item.variations[0];
                        const skuAttr = Array.isArray(v0.attributes) && v0.attributes.find((a) => (a.id || '').toString().toUpperCase() === 'SELLER_SKU');
                        itemSku = (skuAttr ? ((_190 = (_189 = skuAttr.value_name) !== null && _189 !== void 0 ? _189 : skuAttr.value) !== null && _190 !== void 0 ? _190 : '') : ((_192 = (_191 = v0.seller_sku) !== null && _191 !== void 0 ? _191 : v0.seller_custom_field) !== null && _192 !== void 0 ? _192 : '')).toString().trim();
                    }
                    items.push({
                        id: item.id,
                        title: item.title,
                        status: item.status,
                        price: item.price,
                        totalStock: item.available_quantity || 0,
                        soldTotal: item.sold_quantity || 0,
                        dateCreated: item.date_created || item.start_time || null,
                        thumbnail: item.thumbnail,
                        permalink: item.permalink,
                        hasVariations: false,
                        variations: [],
                        sku: itemSku || undefined
                    });
                }
            }
        }
        // Agrupar ítems que son la misma publicación por variante (mismo título base, ej. "... 40900 Blanco G" -> base "... 40900")
        const withVariations = items.filter((i) => i.hasVariations && i.variations && i.variations.length > 0);
        const withoutVariations = items.filter((i) => !i.hasVariations || !i.variations || i.variations.length === 0);
        const byBaseKey = {};
        for (const it of withoutVariations) {
            const baseTitle = mlBaseTitle(it.title);
            const key = baseTitle.toLowerCase().replace(/\s+/g, ' ').trim();
            if (!byBaseKey[key])
                byBaseKey[key] = { baseTitle, list: [] };
            byBaseKey[key].list.push(it);
        }
        const grouped = [];
        for (const _key of Object.keys(byBaseKey)) {
            const { baseTitle, list: group } = byBaseKey[_key];
            if (group.length === 0)
                continue;
            if (group.length === 1) {
                grouped.push(group[0]);
                continue;
            }
            const first = group[0];
            const variations = group.map((it) => {
                const { color, size } = mlColorSizeFromTitle(it.title);
                const sku = (it.sku != null && it.sku !== '') ? it.sku : '';
                return {
                    variationId: it.id,
                    sku,
                    color,
                    size,
                    stock: it.totalStock || 0,
                    sold: it.soldTotal || 0
                };
            });
            const totalStock = group.reduce((s, it) => s + (it.totalStock || 0), 0);
            const soldTotal = group.reduce((s, it) => s + (it.soldTotal || 0), 0);
            grouped.push({
                id: first.id,
                title: baseTitle,
                status: first.status,
                price: first.price,
                totalStock,
                soldTotal,
                dateCreated: first.dateCreated || null,
                thumbnail: first.thumbnail,
                permalink: first.permalink,
                hasVariations: true,
                variations
            });
        }
        items = [...withVariations, ...grouped];
        res.json({
            items,
            total: (_194 = (_193 = itemsRes.data.paging) === null || _193 === void 0 ? void 0 : _193.total) !== null && _194 !== void 0 ? _194 : items.length,
            offset: parseInt(offset),
            limit: parseInt(limit)
        });
    }
    catch (error) {
        console.error('Error fetching ML stock:', ((_195 = error.response) === null || _195 === void 0 ? void 0 : _195.data) || error.message);
        res.status(500).json({ message: 'Error obteniendo stock de Mercado Libre', error: error.message });
    }
});
exports.getMercadoLibreStock = getMercadoLibreStock;
// Obtener variaciones de un ítem de Mercado Libre por ID (para vincular por ID padre)
const getMercadoLibreItemVariations = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _196, _197, _198, _199, _200, _201, _202, _203;
    try {
        let { itemId } = req.params;
        if (!itemId) {
            return res.status(400).json({ message: 'Falta itemId' });
        }
        const requestedNormalized = normalizeMercadoLibreItemId(String(itemId || ''));
        const shouldResolveAsUserProduct = /^MLAU\d+$/i.test(requestedNormalized);
        const candidates = mercadoLibreItemIdCandidates(itemId);
        if (candidates.length === 0)
            return res.status(400).json({ message: 'ID de publicación ML inválido' });
        const mlToken = yield getValidMLToken();
        if (!mlToken) {
            return res.status(400).json({ message: 'No hay integración con Mercado Libre' });
        }
        let item = null;
        let resolvedItemId = '';
        let catalogItemCandidates = [];
        let userProductItemCandidates = [];
        let userProductResolveDebug = null;
        const triedCandidates = [...candidates];
        for (const candidate of candidates) {
            try {
                const itemRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${candidate}?include_attributes=all`, {
                    headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
                });
                if ((itemRes === null || itemRes === void 0 ? void 0 : itemRes.data) && !itemRes.data.error) {
                    item = itemRes.data;
                    resolvedItemId = candidate;
                    break;
                }
            }
            catch (_204) {
                // probar siguiente candidato
            }
        }
        // Catálogo /p/MLA...: siempre intentar listar todas las publicaciones hijas (cada color suele ser un ítem).
        catalogItemCandidates = yield resolveMercadoLibreCatalogProductItems(String(req.params.itemId || ''), mlToken.access_token);
        if (!item || item.error) {
            for (const candidate of catalogItemCandidates) {
                if (!triedCandidates.includes(candidate))
                    triedCandidates.push(candidate);
                try {
                    const itemRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${candidate}?include_attributes=all`, {
                        headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
                    });
                    if ((itemRes === null || itemRes === void 0 ? void 0 : itemRes.data) && !itemRes.data.error) {
                        item = itemRes.data;
                        resolvedItemId = candidate;
                        break;
                    }
                }
                catch (_205) {
                    // probar siguiente candidato
                }
            }
        }
        // Intentar resolver como user_product_id (UP), ej. MLAU...
        // Se ejecuta también cuando /items/{id} responde, porque para MLAU puede devolver
        // una vista incompleta y necesitamos expandir a todos los items reales asociados.
        if (!item || item.error || shouldResolveAsUserProduct) {
            const upResolved = yield resolveMercadoLibreUserProductItems(String(req.params.itemId || ''), mlToken.user_id, mlToken.access_token);
            userProductItemCandidates = upResolved.itemCandidates;
            userProductResolveDebug = upResolved.debug;
            for (const candidate of userProductItemCandidates) {
                if (!triedCandidates.includes(candidate))
                    triedCandidates.push(candidate);
                try {
                    const itemRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${candidate}?include_attributes=all`, {
                        headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
                    });
                    if ((itemRes === null || itemRes === void 0 ? void 0 : itemRes.data) && !itemRes.data.error) {
                        item = itemRes.data;
                        resolvedItemId = candidate;
                        break;
                    }
                }
                catch (_206) {
                    // probar siguiente candidato
                }
            }
        }
        if (!item || item.error) {
            return res.status(404).json({
                message: 'Publicación no encontrada en Mercado Libre',
                tried: triedCandidates,
                debug: shouldResolveAsUserProduct ? { userProduct: userProductResolveDebug } : undefined
            });
        }
        const catalogFromPermalink = catalogProductIdFromMercadoLibreItem(item);
        const itemUserProductId = ((_196 = item === null || item === void 0 ? void 0 : item.user_product_id) !== null && _196 !== void 0 ? _196 : '').toString().trim();
        if (catalogFromPermalink && catalogItemCandidates.length === 0) {
            catalogItemCandidates = yield resolveMercadoLibreCatalogProductItems(catalogFromPermalink, mlToken.access_token);
        }
        if (/^MLAU\d+$/i.test(itemUserProductId) && userProductItemCandidates.length === 0) {
            const upResolved = yield resolveMercadoLibreUserProductItems(itemUserProductId, mlToken.user_id, mlToken.access_token);
            userProductItemCandidates = upResolved.itemCandidates;
            userProductResolveDebug = upResolved.debug;
        }
        const singleItemVariations = extractMlVariationsFromItemData(item);
        const allItemIds = yield gatherMercadoLibreItemIdsForAllVariations({
            requestedRaw: String(req.params.itemId || ''),
            requestedNormalized,
            shouldResolveAsUserProduct,
            resolvedItemId,
            item,
            sellerId: mlToken.user_id,
            accessToken: mlToken.access_token,
            preloadedCatalogIds: catalogItemCandidates,
            preloadedUserProductIds: userProductItemCandidates
        });
        const distinctItemIds = new Set(allItemIds.map((id) => normalizeMercadoLibreItemId(id)));
        const familyNameOnItem = mlFamilyNameFromItem(item);
        const shouldAggregateMulti = shouldResolveAsUserProduct ||
            Boolean(catalogFromPermalink) ||
            /^MLAU\d+$/i.test(itemUserProductId) ||
            Boolean(familyNameOnItem) ||
            (item === null || item === void 0 ? void 0 : item.catalog_listing) === true ||
            distinctItemIds.size > 1 ||
            catalogItemCandidates.length > 1 ||
            userProductItemCandidates.length > 1;
        const buildAggregatedResponse = (aggregated, extraDebug = {}) => {
            const distinctColors = new Set(aggregated.map((v) => v.color.toLowerCase().trim()).filter(Boolean));
            return res.json({
                variations: aggregated,
                singleProduct: false,
                itemId: item.id,
                requestedItemId: String(req.params.itemId || ''),
                resolvedItemId,
                resolvedFromMultiListing: true,
                debug: Object.assign({ userProduct: userProductResolveDebug, itemIdsCount: distinctItemIds.size, variationCount: aggregated.length, colorCount: distinctColors.size, familyName: familyNameOnItem || undefined }, extraDebug)
            });
        };
        if (shouldAggregateMulti && allItemIds.length > 0) {
            let aggregated = yield aggregateMercadoLibreVariationsFromItemIds(allItemIds, mlToken.access_token);
            const distinctColors = new Set(aggregated.map((v) => v.color.toLowerCase().trim()).filter(Boolean));
            const distinctSizes = new Set(aggregated.map((v) => v.size.toLowerCase().trim()).filter(Boolean));
            // Si solo aparece un color, ampliar por family_name o prefijo SKU del artículo.
            if (distinctColors.size <= 1) {
                const extraIds = new Set(allItemIds.map((id) => normalizeMercadoLibreItemId(id)));
                if (familyNameOnItem) {
                    for (const id of yield resolveMercadoLibreItemsByFamilyName(familyNameOnItem, mlToken.user_id, mlToken.access_token)) {
                        extraIds.add(normalizeMercadoLibreItemId(id));
                    }
                }
                const skuPrefixes = new Set();
                for (const sku of collectMercadoLibreItemSkus(item)) {
                    const prefix = extractArticlePrefixFromMlSku(sku);
                    if (prefix)
                        skuPrefixes.add(prefix);
                }
                for (const row of aggregated) {
                    const prefix = extractArticlePrefixFromMlSku(row.sku);
                    if (prefix)
                        skuPrefixes.add(prefix);
                }
                for (const prefix of skuPrefixes) {
                    for (const id of yield resolveMercadoLibreItemsByArticlePrefix(prefix, mlToken.user_id, mlToken.access_token)) {
                        extraIds.add(normalizeMercadoLibreItemId(id));
                    }
                }
                if (extraIds.size > distinctItemIds.size) {
                    aggregated = yield aggregateMercadoLibreVariationsFromItemIds(Array.from(extraIds), mlToken.access_token);
                }
            }
            const finalColors = new Set(aggregated.map((v) => v.color.toLowerCase().trim()).filter(Boolean));
            const finalSizes = new Set(aggregated.map((v) => v.size.toLowerCase().trim()).filter(Boolean));
            const moreThanSingleItem = aggregated.length > singleItemVariations.length ||
                finalColors.size > 1 ||
                finalSizes.size > 1;
            if (aggregated.length > 0 && (moreThanSingleItem || distinctItemIds.size > 1 || finalColors.size > 1)) {
                return buildAggregatedResponse(aggregated);
            }
        }
        if (singleItemVariations.length > 0 &&
            distinctItemIds.size <= 1 &&
            catalogItemCandidates.length <= 1 &&
            !catalogFromPermalink &&
            !/^MLAU\d+$/i.test(itemUserProductId) &&
            !familyNameOnItem &&
            (item === null || item === void 0 ? void 0 : item.catalog_listing) !== true) {
            return res.json({
                variations: singleItemVariations,
                singleProduct: singleItemVariations.length === 1,
                itemId: item.id,
                requestedItemId: String(req.params.itemId || ''),
                resolvedItemId
            });
        }
        // Caso catálogo: no hay item.variations pero sí múltiples items hijos (cada uno una "variante").
        if (catalogItemCandidates.length > 1) {
            const toAttrArray = (x) => (Array.isArray(x) ? x : []);
            const fromAttrs = (attrs, ids) => {
                var _a, _b;
                const wanted = ids.map(v => v.toUpperCase());
                const hit = attrs.find((a) => wanted.includes(((a === null || a === void 0 ? void 0 : a.id) || '').toString().toUpperCase()));
                return ((_b = (_a = hit === null || hit === void 0 ? void 0 : hit.value_name) !== null && _a !== void 0 ? _a : hit === null || hit === void 0 ? void 0 : hit.value) !== null && _b !== void 0 ? _b : '').toString().trim();
            };
            const byItemId = {};
            for (const candidate of catalogItemCandidates.slice(0, 120)) {
                try {
                    const itemRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${candidate}?include_attributes=all`, {
                        headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
                    });
                    const d = itemRes === null || itemRes === void 0 ? void 0 : itemRes.data;
                    if ((d === null || d === void 0 ? void 0 : d.id) && !byItemId[d.id])
                        byItemId[d.id] = d;
                }
                catch (_207) {
                    // ignorar item inválido y seguir
                }
            }
            const catalogVariations = Object.values(byItemId).map((it) => {
                var _a, _b;
                const attrs = toAttrArray(it.attributes);
                const sku = ((_b = (_a = it.seller_sku) !== null && _a !== void 0 ? _a : it.seller_custom_field) !== null && _b !== void 0 ? _b : fromAttrs(attrs, ['SELLER_SKU'])).toString().trim();
                const colorFromAttr = fromAttrs(attrs, ['COLOR', 'COLOUR', 'COR']);
                const sizeFromAttr = fromAttrs(attrs, ['SIZE', 'SIZE_TYPE', 'TALLE', 'TALLA']);
                const titleParsed = mlColorSizeFromTitle((it.title || '').toString().trim());
                const color = colorFromAttr || titleParsed.color || '';
                const size = sizeFromAttr || titleParsed.size || '';
                return {
                    variationId: it.id,
                    sku,
                    color,
                    size,
                    stock: it.available_quantity || 0
                };
            });
            if (catalogVariations.length > 1) {
                return res.json({
                    variations: catalogVariations,
                    singleProduct: false,
                    itemId: item.id,
                    requestedItemId: String(req.params.itemId || ''),
                    resolvedItemId,
                    resolvedFromCatalog: true
                });
            }
        }
        // Fallback: publicaciones hermanas por título (cada talle/color en su propia MLA).
        {
            const baseTitle = mlBaseTitle((item.title || '').toString().trim());
            const baseTitleLoose = mlStripTrailingPublicationIndex(baseTitle);
            const siblingIds = yield findMercadoLibreSiblingListingIds(item, mlToken.user_id, mlToken.access_token);
            if (siblingIds.length > 0) {
                const siblingRows = [];
                const siblings = yield Promise.all(siblingIds.map((sid) => __awaiter(void 0, void 0, void 0, function* () {
                    try {
                        const r = yield axios_1.default.get(`https://api.mercadolibre.com/items/${sid}?include_attributes=all`, {
                            headers: { Authorization: `Bearer ${mlToken.access_token}` }
                        });
                        return r.data;
                    }
                    catch (_208) {
                        return null;
                    }
                })));
                for (const it of siblings) {
                    if (!it || it.error)
                        continue;
                    const siblingBase = mlBaseTitle((it.title || '').toString().trim());
                    const siblingLoose = mlStripTrailingPublicationIndex(siblingBase);
                    if (baseTitle && siblingBase !== baseTitle && baseTitleLoose && siblingLoose !== baseTitleLoose)
                        continue;
                    siblingRows.push(...extractMlVariationsFromItemData(it));
                }
                const merged = [...singleItemVariations];
                const seenVid = new Set(merged.map((v) => v.variationId));
                for (const row of siblingRows) {
                    if (!seenVid.has(row.variationId)) {
                        seenVid.add(row.variationId);
                        merged.push(row);
                    }
                }
                if (merged.length > singleItemVariations.length) {
                    return res.json({
                        variations: merged,
                        singleProduct: false,
                        itemId: item.id,
                        requestedItemId: String(req.params.itemId || ''),
                        resolvedItemId,
                        resolvedFromSiblingSearch: true
                    });
                }
            }
        }
        // Sin variaciones: producto único
        const parsed = mlColorSizeFromTitle((item.title || '').toString().trim());
        let singleSku = ((_198 = (_197 = item.seller_sku) !== null && _197 !== void 0 ? _197 : item.seller_custom_field) !== null && _198 !== void 0 ? _198 : '').toString().trim();
        if (!singleSku && Array.isArray(item.attributes)) {
            const skuAttr = item.attributes.find((a) => ((a === null || a === void 0 ? void 0 : a.id) || '').toString().toUpperCase() === 'SELLER_SKU');
            singleSku = (skuAttr ? ((_200 = (_199 = skuAttr.value_name) !== null && _199 !== void 0 ? _199 : skuAttr.value) !== null && _200 !== void 0 ? _200 : '') : '').toString().trim();
        }
        return res.json({
            variations: [{
                    variationId: item.id,
                    sku: singleSku,
                    color: parsed.color || '',
                    size: parsed.size || '',
                    stock: item.available_quantity || 0
                }],
            singleProduct: true,
            itemId: item.id,
            requestedItemId: String(req.params.itemId || ''),
            resolvedItemId
        });
    }
    catch (error) {
        const status = (_201 = error.response) === null || _201 === void 0 ? void 0 : _201.status;
        const detail = ((_203 = (_202 = error.response) === null || _202 === void 0 ? void 0 : _202.data) === null || _203 === void 0 ? void 0 : _203.message) || error.message;
        console.error('Error fetching ML item variations:', detail);
        res.status(status === 404 ? 404 : 500).json({ message: 'Error obteniendo variaciones de Mercado Libre', detail });
    }
});
exports.getMercadoLibreItemVariations = getMercadoLibreItemVariations;
// Obtener variantes de un producto de Tienda Nube por ID (para vincular por ID padre)
const getTiendaNubeProductVariants = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _209, _210, _211, _212;
    try {
        const { productId } = req.params;
        if (!productId) {
            return res.status(400).json({ message: 'Falta productId' });
        }
        const integration = yield (0, db_1.get)(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
        if (!(integration === null || integration === void 0 ? void 0 : integration.access_token)) {
            return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
        }
        const storeId = integration.store_id || integration.user_id;
        if (!storeId) {
            return res.status(400).json({ message: 'No se encontró store_id de Tienda Nube' });
        }
        const headers = {
            'Authentication': `bearer ${integration.access_token}`,
            'User-Agent': TN_USER_AGENT
        };
        const productRes = yield axios_1.default.get(`https://api.tiendanube.com/v1/${storeId}/products/${productId}`, { headers, validateStatus: () => true });
        if (productRes.status !== 200) {
            const errMsg = (productRes.data && (productRes.data.description || productRes.data.message)) || productRes.statusText;
            return res.status(productRes.status >= 400 ? 404 : 502).json({ message: 'Producto no encontrado en Tienda Nube', detail: errMsg });
        }
        const p = productRes.data;
        const attrs = Array.isArray(p === null || p === void 0 ? void 0 : p.attributes) ? p.attributes : [];
        const isSizeAttr = (name) => /talle|talla|size|tamano|tamaño/i.test(name);
        const isColorAttr = (name) => /color|colour|cor/i.test(name);
        let sizeIdx = -1;
        let colorIdx = -1;
        attrs.forEach((a, i) => {
            var _a, _b, _c;
            const n = ((_c = (_b = (_a = a === null || a === void 0 ? void 0 : a.es) !== null && _a !== void 0 ? _a : a === null || a === void 0 ? void 0 : a.en) !== null && _b !== void 0 ? _b : a === null || a === void 0 ? void 0 : a.pt) !== null && _c !== void 0 ? _c : '').toString();
            if (isSizeAttr(n))
                sizeIdx = i;
            if (isColorAttr(n))
                colorIdx = i;
        });
        // Paginar variantes: la API devuelve por defecto una cantidad limitada por página
        let variantsList = [];
        const perPage = 200;
        let vPage = 1;
        let hasMoreVariants = true;
        while (hasMoreVariants) {
            const variantsRes = yield axios_1.default.get(`https://api.tiendanube.com/v1/${storeId}/products/${productId}/variants`, { headers, params: { page: vPage, per_page: perPage }, validateStatus: () => true });
            const chunk = variantsRes.status === 200 && Array.isArray(variantsRes.data) ? variantsRes.data : [];
            variantsList = variantsList.concat(chunk);
            if (chunk.length < perPage)
                hasMoreVariants = false;
            else
                vPage++;
            if (vPage > 50)
                hasMoreVariants = false; // seguridad: máx 50 páginas = 10.000 variantes
        }
        if (variantsList.length === 0 && Array.isArray(p === null || p === void 0 ? void 0 : p.variants)) {
            variantsList = p.variants;
        }
        const toStr = (x) => { var _a, _b, _c; return (_c = (x != null && typeof x === 'object' ? ((_b = (_a = x.es) !== null && _a !== void 0 ? _a : x.pt) !== null && _b !== void 0 ? _b : x.en) : x)) !== null && _c !== void 0 ? _c : ''; };
        const variants = variantsList.map((v) => {
            const values = Array.isArray(v === null || v === void 0 ? void 0 : v.values) ? v.values : [];
            const sizeVal = sizeIdx >= 0 && sizeIdx < values.length ? values[sizeIdx] : '';
            const colorVal = colorIdx >= 0 && colorIdx < values.length ? values[colorIdx] : '';
            return {
                variantId: v === null || v === void 0 ? void 0 : v.id,
                sku: (v === null || v === void 0 ? void 0 : v.sku) || '',
                size: String(toStr(sizeVal)),
                color: String(toStr(colorVal)),
                stock: Number(v === null || v === void 0 ? void 0 : v.stock) || 0
            };
        });
        return res.json({ variants, productId: p.id });
    }
    catch (error) {
        const detail = ((_210 = (_209 = error.response) === null || _209 === void 0 ? void 0 : _209.data) === null || _210 === void 0 ? void 0 : _210.description) || ((_212 = (_211 = error.response) === null || _211 === void 0 ? void 0 : _211.data) === null || _212 === void 0 ? void 0 : _212.message) || error.message;
        console.error('Error fetching TN product variants:', detail);
        res.status(500).json({ message: 'Error obteniendo variantes de Tienda Nube', detail });
    }
});
exports.getTiendaNubeProductVariants = getTiendaNubeProductVariants;
function fetchAllTiendaNubeProductVariantsApi(storeId, accessToken, productId) {
    return __awaiter(this, void 0, void 0, function* () {
        const headers = { Authentication: `bearer ${accessToken}`, 'User-Agent': TN_USER_AGENT };
        let variantsList = [];
        const perPage = 200;
        let vPage = 1;
        let hasMoreVariants = true;
        while (hasMoreVariants) {
            const variantsRes = yield axios_1.default.get(`https://api.tiendanube.com/v1/${storeId}/products/${productId}/variants`, {
                headers,
                params: { page: vPage, per_page: perPage },
                validateStatus: () => true
            });
            const chunk = variantsRes.status === 200 && Array.isArray(variantsRes.data) ? variantsRes.data : [];
            variantsList = variantsList.concat(chunk);
            if (chunk.length < perPage)
                hasMoreVariants = false;
            else
                vPage++;
            if (vPage > 50)
                hasMoreVariants = false;
        }
        return variantsList;
    });
}
function appendSuffixToLocalizedName(field, suffix) {
    if (!suffix)
        return field;
    if (field == null)
        return field;
    if (typeof field === 'string')
        return `${field}${suffix}`;
    if (typeof field === 'object') {
        const out = Object.assign({}, field);
        for (const k of Object.keys(out)) {
            const v = out[k];
            if (typeof v === 'string' && v.trim())
                out[k] = `${v}${suffix}`;
        }
        return out;
    }
    return field;
}
function tiendaNubeCategoryIdsOnly(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw
        .map((c) => (typeof c === 'object' && c != null ? c.id : c))
        .filter((id) => id != null && String(id).trim() !== '')
        .map((id) => Number(id))
        .filter((n) => Number.isFinite(n));
}
function stripVariantForTiendaNubeCreate(v, skuSuffix, idx) {
    const baseSku = (v === null || v === void 0 ? void 0 : v.sku) != null && String(v.sku).trim() !== ''
        ? (0, skuString_1.skuToCanonicalString)(v.sku)
        : `VAR-${idx + 1}`;
    const out = {
        price: v.price != null ? String(v.price) : '0',
        stock_management: v.stock_management !== false,
        stock: Number(v.stock) || 0,
        sku: (0, skuString_1.skuToCanonicalString)(`${baseSku}${skuSuffix}`),
        values: Array.isArray(v.values) ? v.values : []
    };
    if (v.promotional_price != null && String(v.promotional_price).trim() !== '') {
        out.promotional_price = String(v.promotional_price);
    }
    if (v.weight != null && String(v.weight).trim() !== '')
        out.weight = v.weight;
    if (v.width != null && String(v.width).trim() !== '')
        out.width = v.width;
    if (v.height != null && String(v.height).trim() !== '')
        out.height = v.height;
    if (v.depth != null && String(v.depth).trim() !== '')
        out.depth = v.depth;
    if (v.cost != null && String(v.cost).trim() !== '')
        out.cost = v.cost;
    return out;
}
function buildTiendaNubeDuplicateCreateBody(product, variantsList, opts) {
    var _a;
    const titleSuffix = opts.titleSuffix;
    const skuSuffix = opts.skuSuffix;
    const variantSource = variantsList.length > 0 ? variantsList : Array.isArray(product === null || product === void 0 ? void 0 : product.variants) ? product.variants : [];
    let variants = variantSource.map((v, i) => stripVariantForTiendaNubeCreate(v, skuSuffix, i));
    if (variants.length === 0) {
        variants = [stripVariantForTiendaNubeCreate({ price: '0', stock: 0, stock_management: true, values: [] }, skuSuffix, 0)];
    }
    const body = {
        name: appendSuffixToLocalizedName(product.name, titleSuffix),
        description: (_a = product.description) !== null && _a !== void 0 ? _a : { es: '', en: '', pt: '' },
        attributes: Array.isArray(product.attributes) ? product.attributes : [],
        categories: tiendaNubeCategoryIdsOnly(product.categories),
        published: opts.published,
        free_shipping: !!product.free_shipping,
        tags: typeof product.tags === 'string' ? product.tags : '',
        variants
    };
    if (product.brand != null && String(product.brand).trim() !== '')
        body.brand = product.brand;
    if (product.video_url && String(product.video_url).startsWith('https://'))
        body.video_url = product.video_url;
    if (product.seo_title != null)
        body.seo_title = appendSuffixToLocalizedName(product.seo_title, titleSuffix);
    if (product.seo_description != null)
        body.seo_description = product.seo_description;
    if (product.requires_shipping === false)
        body.requires_shipping = false;
    const imgs = (Array.isArray(product.images) ? product.images : [])
        .slice(0, 9)
        .map((im) => ((im === null || im === void 0 ? void 0 : im.src) ? { src: im.src } : null))
        .filter(Boolean);
    if (imgs.length > 0)
        body.images = imgs;
    return body;
}
/** Crea un producto en Tienda Nube (payload según documentación POST /products). */
const createTiendaNubeProduct = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _213, _214, _215, _216, _217, _218, _219;
    try {
        const body = req.body;
        if (!body || typeof body !== 'object') {
            return res.status(400).json({ message: 'Enviá un objeto JSON con name y variants' });
        }
        if (!body.name)
            return res.status(400).json({ message: 'Falta name (objeto por idioma, ej. { es: "..." })' });
        if (!Array.isArray(body.variants) || body.variants.length === 0) {
            return res.status(400).json({ message: 'Falta variants: al menos una variante (price, stock, etc.)' });
        }
        const integration = yield (0, db_1.get)(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
        if (!(integration === null || integration === void 0 ? void 0 : integration.access_token))
            return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
        const storeId = integration.store_id || integration.user_id;
        if (!storeId)
            return res.status(400).json({ message: 'No se encontró store_id de Tienda Nube' });
        const url = `https://api.tiendanube.com/v1/${storeId}/products`;
        const headers = {
            Authentication: `bearer ${integration.access_token}`,
            'User-Agent': TN_USER_AGENT,
            'Content-Type': 'application/json'
        };
        const r = yield (0, tiendanubeClient_1.tnPostWithRetry)(axios_1.default, url, body, { headers, validateStatus: () => true });
        if (r.status === 201) {
            return res.status(201).json({
                product: r.data,
                id: (_213 = r.data) === null || _213 === void 0 ? void 0 : _213.id,
                message: 'Producto creado en Tienda Nube'
            });
        }
        const detail = ((_214 = r.data) === null || _214 === void 0 ? void 0 : _214.description) || ((_215 = r.data) === null || _215 === void 0 ? void 0 : _215.message) || r.statusText;
        return res.status(r.status >= 400 ? r.status : 502).json({
            message: ['Tienda Nube rechazó la creación del producto', detail].filter(Boolean).join(' — '),
            errors: r.data
        });
    }
    catch (error) {
        const detail = ((_217 = (_216 = error.response) === null || _216 === void 0 ? void 0 : _216.data) === null || _217 === void 0 ? void 0 : _217.description) || ((_219 = (_218 = error.response) === null || _218 === void 0 ? void 0 : _218.data) === null || _219 === void 0 ? void 0 : _219.message) || error.message;
        console.error('createTiendaNubeProduct:', detail);
        res.status(500).json({ message: 'Error creando producto en Tienda Nube', detail });
    }
});
exports.createTiendaNubeProduct = createTiendaNubeProduct;
/**
 * Duplica un producto existente en Tienda Nube (nueva publicación).
 * Útil para packs: mismo contenido con otro título y SKU (sufijos configurables).
 */
const duplicateTiendaNubeProduct = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _220, _221, _222, _223, _224, _225, _226, _227, _228, _229, _230, _231;
    try {
        const { productId } = req.params;
        if (!productId)
            return res.status(400).json({ message: 'Falta productId' });
        const titleSuffix = ((_221 = (_220 = req.body) === null || _220 === void 0 ? void 0 : _220.titleSuffix) !== null && _221 !== void 0 ? _221 : ' (pack)').toString();
        const skuSuffix = ((_223 = (_222 = req.body) === null || _222 === void 0 ? void 0 : _222.skuSuffix) !== null && _223 !== void 0 ? _223 : '-PACK').toString();
        const published = ((_224 = req.body) === null || _224 === void 0 ? void 0 : _224.published) !== false;
        const integration = yield (0, db_1.get)(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
        if (!(integration === null || integration === void 0 ? void 0 : integration.access_token))
            return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
        const storeId = integration.store_id || integration.user_id;
        if (!storeId)
            return res.status(400).json({ message: 'No se encontró store_id de Tienda Nube' });
        const headers = { Authentication: `bearer ${integration.access_token}`, 'User-Agent': TN_USER_AGENT };
        const productRes = yield axios_1.default.get(`https://api.tiendanube.com/v1/${storeId}/products/${productId}`, {
            headers,
            validateStatus: () => true
        });
        if (productRes.status !== 200) {
            const errMsg = (productRes.data && (productRes.data.description || productRes.data.message)) || productRes.statusText;
            return res.status(productRes.status >= 400 ? 404 : 502).json({
                message: 'Producto no encontrado en Tienda Nube',
                detail: errMsg
            });
        }
        const p = productRes.data;
        const variantsList = yield fetchAllTiendaNubeProductVariantsApi(storeId, integration.access_token, String(productId));
        const createBody = buildTiendaNubeDuplicateCreateBody(p, variantsList, { titleSuffix, skuSuffix, published });
        const url = `https://api.tiendanube.com/v1/${storeId}/products`;
        const postHeaders = Object.assign(Object.assign({}, headers), { 'Content-Type': 'application/json' });
        const r = yield (0, tiendanubeClient_1.tnPostWithRetry)(axios_1.default, url, createBody, { headers: postHeaders, validateStatus: () => true });
        if (r.status === 201) {
            return res.status(201).json({
                sourceProductId: productId,
                newProductId: (_225 = r.data) === null || _225 === void 0 ? void 0 : _225.id,
                product: r.data,
                message: 'Publicación duplicada en Tienda Nube'
            });
        }
        const detail = ((_226 = r.data) === null || _226 === void 0 ? void 0 : _226.description) || ((_227 = r.data) === null || _227 === void 0 ? void 0 : _227.message) || r.statusText;
        return res.status(r.status >= 400 ? r.status : 502).json({
            message: ['Tienda Nube rechazó la duplicación', detail].filter(Boolean).join(' — '),
            errors: r.data
        });
    }
    catch (error) {
        const detail = ((_229 = (_228 = error.response) === null || _228 === void 0 ? void 0 : _228.data) === null || _229 === void 0 ? void 0 : _229.description) || ((_231 = (_230 = error.response) === null || _230 === void 0 ? void 0 : _230.data) === null || _231 === void 0 ? void 0 : _231.message) || error.message;
        console.error('duplicateTiendaNubeProduct:', detail);
        res.status(500).json({ message: 'Error duplicando producto en Tienda Nube', detail });
    }
});
exports.duplicateTiendaNubeProduct = duplicateTiendaNubeProduct;
/** Asegurar que exista un talle; si no existe, crearlo. Devuelve id del size. */
function ensureSize(sizeCode) {
    return __awaiter(this, void 0, void 0, function* () {
        const code = (sizeCode || 'U').toString().trim() || 'U';
        let row = yield (0, db_1.get)(`SELECT id FROM sizes WHERE size_code = ?`, [code]);
        if (row === null || row === void 0 ? void 0 : row.id)
            return row.id;
        const id = (0, uuid_1.v4)();
        yield (0, db_1.execute)(`INSERT INTO sizes (id, size_code, name) VALUES (?, ?, ?)`, [id, code, code]);
        return id;
    });
}
/** Asegurar que exista un color; si no existe, crearlo. Devuelve id del color. */
function ensureColor(codeOrName) {
    return __awaiter(this, void 0, void 0, function* () {
        const name = (codeOrName || 'Único').toString().trim() || 'Único';
        const code = name.substring(0, 20).replace(/\s+/g, '_').toUpperCase() || 'UNI';
        let row = yield (0, db_1.get)(`SELECT id FROM colors WHERE code = ?`, [code]);
        if (row === null || row === void 0 ? void 0 : row.id)
            return row.id;
        row = yield (0, db_1.get)(`SELECT id FROM colors WHERE name = ?`, [name]);
        if (row === null || row === void 0 ? void 0 : row.id)
            return row.id;
        const id = (0, uuid_1.v4)();
        yield (0, db_1.execute)(`INSERT INTO colors (id, code, name) VALUES (?, ?, ?)`, [id, code, name]);
        return id;
    });
}
/** Importar un producto de Mercado Libre al inventario local: crea producto + variantes y vincula ML. Acepta itemId (una publicación) o itemIds (varias publicaciones agrupadas = una por variante). */
const importProductFromMercadoLibre = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _232, _233, _234, _235, _236, _237, _238, _239, _240, _241, _242, _243, _244, _245, _246, _247, _248, _249, _250, _251, _252, _253, _254, _255, _256;
    try {
        const { itemId, itemIds } = req.body || {};
        const idsToImport = Array.isArray(itemIds) && itemIds.length > 0
            ? itemIds.flatMap((id) => mercadoLibreItemIdCandidates(id)).filter(Boolean)
            : itemId != null && itemId !== '' ? mercadoLibreItemIdCandidates(itemId) : [];
        if (idsToImport.length === 0)
            return res.status(400).json({ message: 'Falta itemId o itemIds' });
        const mlToken = yield getValidMLToken();
        if (!mlToken)
            return res.status(400).json({ message: 'No hay integración con Mercado Libre' });
        const isMultiItem = idsToImport.length > 1;
        if (!isMultiItem) {
            const existing = yield (0, db_1.get)(`SELECT id FROM products WHERE mercado_libre_id = ?`, [idsToImport[0]]);
            if (existing) {
                const del = yield (0, products_controller_1.deleteProductById)(existing.id);
                if (!del.deleted && del.error === 'in_orders') {
                    return res.status(400).json({ message: 'No se puede reemplazar: el artículo ya está en pedidos.' });
                }
            }
        }
        const fetchOne = (rawItemId) => __awaiter(void 0, void 0, void 0, function* () {
            const candidates = mercadoLibreItemIdCandidates(rawItemId);
            for (const itemIdToFetch of candidates) {
                const itemRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${itemIdToFetch}?include_attributes=all`, {
                    headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
                }).catch(() => null);
                if (itemRes && itemRes.status === 200 && itemRes.data && !itemRes.data.error) {
                    return itemRes.data;
                }
            }
            return null;
        });
        if (isMultiItem) {
            const items = yield Promise.all(idsToImport.map(id => fetchOne(id)));
            const validItems = items.filter(Boolean);
            if (validItems.length === 0)
                return res.status(404).json({ message: 'No se encontró ninguna publicación en Mercado Libre' });
            const first = validItems[0];
            const title = mlBaseTitle((first.title || '').toString().trim()) || 'Sin título';
            const variations = [];
            for (const item of validItems) {
                const mlItemId = (item.id || '').toString().trim();
                let sku = ((_233 = (_232 = item.seller_sku) !== null && _232 !== void 0 ? _232 : item.seller_custom_field) !== null && _233 !== void 0 ? _233 : '').toString().trim();
                if (!sku && item.variations && item.variations.length === 1) {
                    const v0 = item.variations[0];
                    const skuAttr = Array.isArray(v0.attributes) && v0.attributes.find((a) => (a.id || '').toString().toUpperCase() === 'SELLER_SKU');
                    sku = (skuAttr ? ((_235 = (_234 = skuAttr.value_name) !== null && _234 !== void 0 ? _234 : skuAttr.value) !== null && _235 !== void 0 ? _235 : '') : ((_237 = (_236 = v0.seller_sku) !== null && _236 !== void 0 ? _236 : v0.seller_custom_field) !== null && _237 !== void 0 ? _237 : '')).toString().trim();
                }
                if (!sku)
                    sku = `ML-${mlItemId}`;
                const { color, size } = mlColorSizeFromTitle((item.title || '').toString().trim());
                variations.push({
                    variationId: mlItemId,
                    sku,
                    color: color || 'Único',
                    size: size || 'U',
                    stock: (_238 = item.available_quantity) !== null && _238 !== void 0 ? _238 : ((_241 = (_240 = (_239 = item.variations) === null || _239 === void 0 ? void 0 : _239[0]) === null || _240 === void 0 ? void 0 : _240.available_quantity) !== null && _241 !== void 0 ? _241 : 0),
                    mlItemId
                });
            }
            const firstSku = ((_242 = variations[0]) === null || _242 === void 0 ? void 0 : _242.sku) || '';
            const baseSku = firstSku.includes('-') ? firstSku.split('-').slice(0, -2).join('-') || firstSku : (firstSku || `ML-${validItems[0].id}`);
            const existingBySku = yield (0, db_1.get)(`SELECT id FROM products WHERE sku = ?`, [baseSku]);
            if (existingBySku) {
                const del = yield (0, products_controller_1.deleteProductById)(existingBySku.id);
                if (!del.deleted && del.error === 'in_orders') {
                    return res.status(400).json({ message: 'No se puede reemplazar: el artículo ya está en pedidos.' });
                }
            }
            const productId = (0, uuid_1.v4)();
            yield (0, db_1.execute)(`INSERT INTO products (id, sku, name, category, base_price, description, mercado_libre_id) VALUES (?, ?, ?, ?, ?, ?, ?)`, [productId, baseSku, title, 'General', first.price || 0, ((_243 = first.description) === null || _243 === void 0 ? void 0 : _243.plain_text) || null, null]);
            const byVariantKey = new Map();
            for (const v of variations) {
                const colorKey = (v.color || 'Único').toString().trim().toLowerCase() || 'único';
                const sizeKey = (v.size || 'U').toString().trim().toUpperCase() || 'U';
                const key = `${colorKey}|${sizeKey}`;
                if (!byVariantKey.has(key))
                    byVariantKey.set(key, []);
                byVariantKey.get(key).push(v);
            }
            let variantsCreated = 0;
            for (const group of byVariantKey.values()) {
                const { created } = yield upsertLocalVariantFromMlEntries(productId, baseSku, group);
                if (created)
                    variantsCreated++;
            }
            return res.status(201).json({
                productId,
                baseSku,
                name: title,
                variantsCreated,
                publicationsLinked: variations.length,
                message: 'Producto importado de Mercado Libre (variantes agrupadas)'
            });
        }
        let itemIdToFetch = idsToImport[0];
        const item = yield fetchOne(itemIdToFetch);
        if (!item)
            return res.status(404).json({ message: 'Publicación no encontrada en Mercado Libre. Si el ID es solo numérico (ej. 3270089), se intenta con MLA.' });
        if (item.id)
            itemIdToFetch = String(item.id);
        const existingByMlId = yield (0, db_1.get)(`SELECT id FROM products WHERE mercado_libre_id = ?`, [itemIdToFetch]);
        if (existingByMlId) {
            const del = yield (0, products_controller_1.deleteProductById)(existingByMlId.id);
            if (!del.deleted && del.error === 'in_orders') {
                return res.status(400).json({ message: 'No se puede reemplazar: el artículo ya está en pedidos.' });
            }
        }
        const title = (item.title || '').toString().trim() || 'Sin título';
        let variations = [];
        if (item.variations && item.variations.length > 0) {
            variations = item.variations.map((v) => {
                var _a, _b, _c, _d;
                const skuAttr = Array.isArray(v.attributes) && v.attributes.find((a) => (a.id || '').toString().toUpperCase() === 'SELLER_SKU');
                const skuFromAttr = skuAttr ? ((_b = (_a = skuAttr.value_name) !== null && _a !== void 0 ? _a : skuAttr.value) !== null && _b !== void 0 ? _b : '').toString().trim() : '';
                const sku = skuFromAttr || ((_d = (_c = v.seller_sku) !== null && _c !== void 0 ? _c : v.seller_custom_field) !== null && _d !== void 0 ? _d : '').toString().trim();
                let color = '';
                let size = '';
                (v.attribute_combinations || []).forEach((attr) => {
                    const id = (attr.id || '').toString().toUpperCase();
                    const name = (attr.value_name || attr.name || '').toString().trim();
                    if (id === 'COLOR' || id === 'COLOUR' || id === 'COR')
                        color = name;
                    if (id === 'SIZE' || id === 'SIZE_TYPE' || id === 'TALLE' || id === 'Talla')
                        size = name;
                });
                return {
                    variationId: v.id,
                    sku,
                    color: color || 'Único',
                    size: size || 'U',
                    stock: v.available_quantity || 0
                };
            });
        }
        if (variations.length === 0) {
            let sku = ((_245 = (_244 = item.seller_sku) !== null && _244 !== void 0 ? _244 : item.seller_custom_field) !== null && _245 !== void 0 ? _245 : '').toString().trim();
            if (!sku && item.variations && item.variations.length === 1) {
                const v0 = item.variations[0];
                const skuAttr = Array.isArray(v0.attributes) && v0.attributes.find((a) => (a.id || '').toString().toUpperCase() === 'SELLER_SKU');
                sku = (skuAttr ? ((_247 = (_246 = skuAttr.value_name) !== null && _246 !== void 0 ? _246 : skuAttr.value) !== null && _247 !== void 0 ? _247 : '') : ((_249 = (_248 = v0.seller_sku) !== null && _248 !== void 0 ? _248 : v0.seller_custom_field) !== null && _249 !== void 0 ? _249 : '')).toString().trim();
            }
            if (!sku)
                sku = ((_250 = item.id) !== null && _250 !== void 0 ? _250 : itemIdToFetch).toString();
            const parsed = mlColorSizeFromTitle(title);
            variations = [{
                    variationId: item.id,
                    sku: sku || `ML-${item.id}`,
                    color: parsed.color || 'Único',
                    size: parsed.size || 'U',
                    stock: item.available_quantity || 0,
                    mlItemId: (item.id || '').toString()
                }];
        }
        const firstSku = ((_251 = variations[0]) === null || _251 === void 0 ? void 0 : _251.sku) || '';
        const baseSku = firstSku.includes('-') ? firstSku.split('-').slice(0, -2).join('-') || firstSku : (firstSku || `ML-${itemIdToFetch}`);
        let productId;
        const existingBySku = yield (0, db_1.get)(`SELECT id FROM products WHERE sku = ?`, [baseSku]);
        if (existingBySku) {
            const del = yield (0, products_controller_1.deleteProductById)(existingBySku.id);
            if (!del.deleted && del.error === 'in_orders') {
                return res.status(400).json({ message: 'No se puede reemplazar: el artículo ya está en pedidos.' });
            }
        }
        productId = (0, uuid_1.v4)();
        const displayName = mlBaseTitle(title) || title;
        yield (0, db_1.execute)(`INSERT INTO products (id, sku, name, category, base_price, description, mercado_libre_id) VALUES (?, ?, ?, ?, ?, ?, ?)`, [productId, baseSku, displayName, 'General', item.price || 0, ((_252 = item.description) === null || _252 === void 0 ? void 0 : _252.plain_text) || null, itemIdToFetch]);
        const byVariantKey = new Map();
        for (const v of variations) {
            const colorKey = (v.color || 'Único').toString().trim().toLowerCase() || 'único';
            const sizeKey = (v.size || 'U').toString().trim().toUpperCase() || 'U';
            const key = `${colorKey}|${sizeKey}`;
            if (!byVariantKey.has(key))
                byVariantKey.set(key, []);
            byVariantKey.get(key).push(Object.assign(Object.assign({}, v), { mlItemId: (_253 = v.mlItemId) !== null && _253 !== void 0 ? _253 : itemIdToFetch }));
        }
        let variantsCreated = 0;
        for (const group of byVariantKey.values()) {
            const entries = group.map((v) => {
                var _a;
                return ({
                    sku: v.sku,
                    color: v.color,
                    size: v.size,
                    stock: v.stock,
                    mlItemId: (_a = v.mlItemId) !== null && _a !== void 0 ? _a : itemIdToFetch,
                    variationId: v.variationId
                });
            });
            const { created } = yield upsertLocalVariantFromMlEntries(productId, baseSku, entries);
            if (created)
                variantsCreated++;
        }
        res.status(201).json({
            productId,
            baseSku,
            name: displayName,
            variantsCreated,
            message: 'Producto importado de Mercado Libre'
        });
    }
    catch (error) {
        const status = (_254 = error.response) === null || _254 === void 0 ? void 0 : _254.status;
        const code = error.code;
        const detail = ((_256 = (_255 = error.response) === null || _255 === void 0 ? void 0 : _255.data) === null || _256 === void 0 ? void 0 : _256.message) || error.message;
        console.error('Error importing product from ML:', code || status, detail);
        if (code === 'ER_DUP_ENTRY' || (detail && String(detail).includes('Duplicate entry'))) {
            return res.status(409).json({ message: 'Ya existe un artículo con ese código (SKU). Editá el existente en Mi inventario para vincularlo con ML.', detail: String(detail) });
        }
        res.status(status === 404 ? 404 : 500).json({ message: 'Error importando producto de Mercado Libre', detail });
    }
});
exports.importProductFromMercadoLibre = importProductFromMercadoLibre;
/** Importar un producto de Tienda Nube al inventario local: crea producto + variantes y vincula TN. */
const importProductFromTiendaNube = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _257, _258, _259, _260, _261, _262, _263, _264, _265, _266, _267, _268, _269, _270, _271;
    try {
        const { productId: tnProductId } = req.body || {};
        if (tnProductId == null || tnProductId === '')
            return res.status(400).json({ message: 'Falta productId de Tienda Nube' });
        const integration = yield (0, db_1.get)(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
        if (!(integration === null || integration === void 0 ? void 0 : integration.access_token))
            return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
        const storeId = integration.store_id || integration.user_id;
        if (!storeId)
            return res.status(400).json({ message: 'No se encontró store_id de Tienda Nube' });
        const existing = yield (0, db_1.get)(`SELECT id FROM products WHERE tienda_nube_id = ?`, [String(tnProductId)]);
        if (existing)
            return res.status(409).json({ message: 'Este producto de Tienda Nube ya está en tu inventario', productId: existing.id });
        const headers = { 'Authentication': `bearer ${integration.access_token}`, 'User-Agent': TN_USER_AGENT };
        const [productRes, variantsRes] = yield Promise.all([
            axios_1.default.get(`https://api.tiendanube.com/v1/${storeId}/products/${tnProductId}`, { headers, validateStatus: () => true }),
            axios_1.default.get(`https://api.tiendanube.com/v1/${storeId}/products/${tnProductId}/variants`, { headers, validateStatus: () => true })
        ]);
        if (productRes.status !== 200) {
            const errMsg = (productRes.data && (productRes.data.description || productRes.data.message)) || productRes.statusText;
            return res.status(productRes.status >= 400 ? 404 : 502).json({ message: 'Producto no encontrado en Tienda Nube', detail: errMsg });
        }
        const p = productRes.data;
        const title = ((_263 = (_262 = (_260 = (_258 = (_257 = p.name) === null || _257 === void 0 ? void 0 : _257.es) !== null && _258 !== void 0 ? _258 : (_259 = p.name) === null || _259 === void 0 ? void 0 : _259.pt) !== null && _260 !== void 0 ? _260 : (_261 = p.name) === null || _261 === void 0 ? void 0 : _261.en) !== null && _262 !== void 0 ? _262 : p.name) !== null && _263 !== void 0 ? _263 : '').toString().trim() || 'Sin título';
        const attrs = Array.isArray(p === null || p === void 0 ? void 0 : p.attributes) ? p.attributes : [];
        const isSizeAttr = (n) => /talle|talla|size|tamano|tamaño/i.test(n);
        const isColorAttr = (n) => /color|colour|cor/i.test(n);
        let sizeIdx = -1, colorIdx = -1;
        attrs.forEach((a, i) => {
            var _a, _b, _c;
            const n = ((_c = (_b = (_a = a === null || a === void 0 ? void 0 : a.es) !== null && _a !== void 0 ? _a : a === null || a === void 0 ? void 0 : a.en) !== null && _b !== void 0 ? _b : a === null || a === void 0 ? void 0 : a.pt) !== null && _c !== void 0 ? _c : '').toString();
            if (isSizeAttr(n))
                sizeIdx = i;
            if (isColorAttr(n))
                colorIdx = i;
        });
        let variantsList = variantsRes.status === 200 && Array.isArray(variantsRes.data) ? variantsRes.data : (Array.isArray(p === null || p === void 0 ? void 0 : p.variants) ? p.variants : []);
        const toStr = (x) => { var _a, _b, _c; return (_c = (x != null && typeof x === 'object' ? ((_b = (_a = x.es) !== null && _a !== void 0 ? _a : x.pt) !== null && _b !== void 0 ? _b : x.en) : x)) !== null && _c !== void 0 ? _c : ''; };
        let variations = variantsList.map((v) => {
            const values = Array.isArray(v === null || v === void 0 ? void 0 : v.values) ? v.values : [];
            const sizeVal = sizeIdx >= 0 && sizeIdx < values.length ? values[sizeIdx] : '';
            const colorVal = colorIdx >= 0 && colorIdx < values.length ? values[colorIdx] : '';
            return {
                variantId: v === null || v === void 0 ? void 0 : v.id,
                sku: ((v === null || v === void 0 ? void 0 : v.sku) || '').toString().trim() || `TN-${v === null || v === void 0 ? void 0 : v.id}`,
                size: String(toStr(sizeVal)).trim() || 'U',
                color: String(toStr(colorVal)).trim() || 'Único',
                stock: Number(v === null || v === void 0 ? void 0 : v.stock) || 0
            };
        });
        if (variations.length === 0) {
            variations.push({
                variantId: p.id,
                sku: `TN-${p.id}`,
                size: 'U',
                color: 'Único',
                stock: 0
            });
        }
        const baseSku = ((_265 = (_264 = variations[0]) === null || _264 === void 0 ? void 0 : _264.sku) === null || _265 === void 0 ? void 0 : _265.replace(/-[^-]+-[^-]+$/, '')) || `TN-${tnProductId}`;
        const productId = (0, uuid_1.v4)();
        yield (0, db_1.execute)(`INSERT INTO products (id, sku, name, category, base_price, description, tienda_nube_id) VALUES (?, ?, ?, ?, ?, ?, ?)`, [productId, baseSku, title, 'General', ((_266 = variations[0]) === null || _266 === void 0 ? void 0 : _266.stock) ? 0 : 0, null, String(tnProductId)]);
        let variantsCreated = 0;
        for (const v of variations) {
            const sizeId = yield ensureSize(v.size);
            const colorId = yield ensureColor(v.color);
            let productColorId = (_267 = (yield (0, db_1.get)(`SELECT id FROM product_colors WHERE product_id = ? AND color_id = ?`, [productId, colorId]))) === null || _267 === void 0 ? void 0 : _267.id;
            if (!productColorId) {
                productColorId = (0, uuid_1.v4)();
                yield (0, db_1.execute)(`INSERT INTO product_colors (id, product_id, color_id) VALUES (?, ?, ?)`, [productColorId, productId, colorId]);
            }
            const existingVariant = yield (0, db_1.get)(`SELECT id FROM product_variants WHERE product_color_id = ? AND size_id = ?`, [productColorId, sizeId]);
            if (existingVariant)
                continue;
            const variantId = (0, uuid_1.v4)();
            yield (0, db_1.execute)(`INSERT INTO product_variants (id, product_color_id, size_id, sku, tienda_nube_variant_id) VALUES (?, ?, ?, ?, ?)`, [variantId, productColorId, sizeId, v.sku, String(v.variantId)]);
            yield (0, db_1.execute)(`INSERT INTO stocks (variant_id, stock) VALUES (?, ?) ON DUPLICATE KEY UPDATE stock = VALUES(stock)`, [variantId, v.stock]);
            variantsCreated++;
        }
        res.status(201).json({
            productId,
            baseSku,
            name: title,
            variantsCreated,
            message: 'Producto importado de Tienda Nube'
        });
    }
    catch (error) {
        const detail = ((_269 = (_268 = error.response) === null || _268 === void 0 ? void 0 : _268.data) === null || _269 === void 0 ? void 0 : _269.description) || ((_271 = (_270 = error.response) === null || _270 === void 0 ? void 0 : _270.data) === null || _271 === void 0 ? void 0 : _271.message) || error.message;
        console.error('Error importing product from TN:', detail);
        res.status(500).json({ message: 'Error importando producto de Tienda Nube', detail });
    }
});
exports.importProductFromTiendaNube = importProductFromTiendaNube;
// Obtener configuración de mensaje automático de ML
const getMLAutoMessageConfig = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Crear tabla si no existe
        yield (0, db_1.execute)(`
      CREATE TABLE IF NOT EXISTS ml_auto_message_config (
        id INT PRIMARY KEY DEFAULT 1,
        enabled BOOLEAN DEFAULT TRUE,
        message_template TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
        const config = yield (0, db_1.get)(`SELECT * FROM ml_auto_message_config WHERE id = 1`);
        if (!config) {
            // Insertar configuración por defecto
            const defaultMessage = `¡Hola {nombre}! 🙌

Muchas gracias por tu compra{productos}. 

Tu pedido ya está siendo preparado con mucho cuidado. Te avisaremos apenas lo despachemos.

Si tenés alguna consulta, no dudes en escribirnos. ¡Gracias por confiar en nosotros!

Saludos,
Equipo Lupo`;
            yield (0, db_1.execute)(`INSERT INTO ml_auto_message_config (id, enabled, message_template) VALUES (1, TRUE, ?)`, [defaultMessage]);
            return res.json({
                enabled: true,
                messageTemplate: defaultMessage
            });
        }
        res.json({
            enabled: config.enabled === 1,
            messageTemplate: config.message_template
        });
    }
    catch (error) {
        console.error('Error getting ML auto message config:', error.message);
        res.status(500).json({ message: 'Error obteniendo configuración', error: error.message });
    }
});
exports.getMLAutoMessageConfig = getMLAutoMessageConfig;
// Guardar configuración de mensaje automático de ML
const saveMLAutoMessageConfig = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { enabled, messageTemplate } = req.body;
        // Crear tabla si no existe
        yield (0, db_1.execute)(`
      CREATE TABLE IF NOT EXISTS ml_auto_message_config (
        id INT PRIMARY KEY DEFAULT 1,
        enabled BOOLEAN DEFAULT TRUE,
        message_template TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
        yield (0, db_1.execute)(`INSERT INTO ml_auto_message_config (id, enabled, message_template) 
       VALUES (1, ?, ?)
       ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), message_template = VALUES(message_template)`, [enabled ? 1 : 0, messageTemplate]);
        res.json({ success: true, message: 'Configuración guardada' });
    }
    catch (error) {
        console.error('Error saving ML auto message config:', error.message);
        res.status(500).json({ message: 'Error guardando configuración', error: error.message });
    }
});
exports.saveMLAutoMessageConfig = saveMLAutoMessageConfig;
/** Config de respuesta automática a preguntas ML (Gemini / Groq gratis u OpenAI). */
const getMLQuestionsAiConfig = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const cfg = yield mlQuestionsAi.getMlQuestionsAiConfigRow();
        const st = mlQuestionsAi.getLlmStatus();
        res.json({
            enabled: cfg.enabled,
            extraSystemPrompt: cfg.extraSystemPrompt || '',
            openAiConfigured: st.configured,
            llmProvider: st.provider,
            llmLabel: st.label
        });
    }
    catch (error) {
        console.error('getMLQuestionsAiConfig:', error);
        res.status(500).json({ message: 'Error obteniendo configuración', error: error.message });
    }
});
exports.getMLQuestionsAiConfig = getMLQuestionsAiConfig;
const saveMLQuestionsAiConfig = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { enabled, extraSystemPrompt } = req.body || {};
        yield mlQuestionsAi.saveMlQuestionsAiConfig(!!enabled, extraSystemPrompt != null ? String(extraSystemPrompt) : null);
        res.json({ success: true, message: 'Configuración guardada' });
    }
    catch (error) {
        console.error('saveMLQuestionsAiConfig:', error);
        res.status(500).json({ message: 'Error guardando configuración', error: error.message });
    }
});
exports.saveMLQuestionsAiConfig = saveMLQuestionsAiConfig;
/** Procesa preguntas sin responder (manual). Requiere ML + clave IA (Gemini/Groq/OpenAI). */
const processMLQuestionsAi = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _272, _273, _274, _275, _276;
    try {
        const user = req.user;
        if (!user || !['ADMIN', 'WAREHOUSE', 'DEPOSITO'].includes(user.role)) {
            return res.status(403).json({ message: 'Solo administradores o depósito pueden ejecutar esto' });
        }
        if (!mlQuestionsAi.llmConfigured()) {
            return res.status(503).json({
                message: 'Configurá una clave de IA en el servidor: GEMINI_API_KEY (gratis en Google AI Studio), GROQ_API_KEY (gratis) u OPENAI_API_KEY (de pago).'
            });
        }
        const rawLimit = (_273 = (_272 = req.body) === null || _272 === void 0 ? void 0 : _272.limit) !== null && _273 !== void 0 ? _273 : (_274 = req.query) === null || _274 === void 0 ? void 0 : _274.limit;
        const limit = Math.min(Math.max(parseInt(String(rawLimit !== null && rawLimit !== void 0 ? rawLimit : '10'), 10) || 10, 1), 25);
        const token = yield getValidMLToken();
        if (!token)
            return res.status(503).json({ message: 'Mercado Libre no conectado o token inválido' });
        const cfg = yield mlQuestionsAi.getMlQuestionsAiConfigRow();
        const { processed, results } = yield mlQuestionsAi.processUnansweredBatch(token, {
            limit,
            extraSystemPrompt: cfg.extraSystemPrompt
        });
        res.json({ processed, results });
    }
    catch (error) {
        const detail = (_276 = (_275 = error === null || error === void 0 ? void 0 : error.response) === null || _275 === void 0 ? void 0 : _275.data) !== null && _276 !== void 0 ? _276 : error === null || error === void 0 ? void 0 : error.message;
        console.error('processMLQuestionsAi:', detail);
        res.status(500).json({ message: (error === null || error === void 0 ? void 0 : error.message) || 'Error procesando preguntas', detail });
    }
});
exports.processMLQuestionsAi = processMLQuestionsAi;
/** Métricas por defecto para Product Ads (Mercado Ads API). */
const ML_PADS_METRICS_DEFAULT = 'clicks,prints,ctr,cost,cpc,acos,cvr,roas,sov,direct_amount,indirect_amount,total_amount,units_quantity,direct_units_quantity,indirect_units_quantity,advertising_items_quantity,direct_items_quantity,indirect_items_quantity';
/** Listado de anunciantes con acceso a Product Ads (PADS). */
const getMercadoLibreProductAdsAdvertisers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _277, _278, _279, _280, _281;
    try {
        const mlToken = yield getValidMLToken();
        if (!mlToken) {
            return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
        }
        const r = yield axios_1.default.get('https://api.mercadolibre.com/advertising/advertisers', {
            headers: {
                Authorization: `Bearer ${mlToken.access_token}`,
                'Content-Type': 'application/json',
                'Api-Version': '1'
            },
            params: { product_id: 'PADS' },
            validateStatus: () => true
        });
        if (r.status !== 200) {
            const detail = ((_277 = r.data) === null || _277 === void 0 ? void 0 : _277.message) || ((_279 = (_278 = r.data) === null || _278 === void 0 ? void 0 : _278.cause) === null || _279 === void 0 ? void 0 : _279.message) || ((_280 = r.data) === null || _280 === void 0 ? void 0 : _280.error) || r.statusText;
            return res.status(r.status >= 400 && r.status < 500 ? r.status : 502).json({
                message: r.status === 404
                    ? 'No hay permisos para Product Ads o no está activado. En Mercado Libre: Publicaciones → Campaña de publicidad (Product Ads).'
                    : 'Error consultando anunciantes de Mercado Ads',
                detail
            });
        }
        res.json(r.data);
    }
    catch (error) {
        console.error('getMercadoLibreProductAdsAdvertisers:', ((_281 = error.response) === null || _281 === void 0 ? void 0 : _281.data) || error.message);
        res.status(500).json({ message: 'Error consultando Product Ads', error: error.message });
    }
});
exports.getMercadoLibreProductAdsAdvertisers = getMercadoLibreProductAdsAdvertisers;
function mlProductAdsForwardQuery(req) {
    const params = {};
    const pass = [
        'date_from',
        'date_to',
        'metrics',
        'limit',
        'offset',
        'aggregation_type',
        'metrics_summary',
        'channel',
        'status',
        'campaign_id',
        'campaign_ids'
    ];
    for (const k of pass) {
        const v = req.query[k];
        if (v != null && v !== '')
            params[k] = String(v);
    }
    if (!params.metrics)
        params.metrics = ML_PADS_METRICS_DEFAULT;
    return params;
}
/** Campañas de Product Ads con métricas (proxy a API oficial). Requiere site_id y advertiser_id. */
const getMercadoLibreProductAdsCampaigns = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _282, _283, _284, _285, _286, _287, _288;
    try {
        const mlToken = yield getValidMLToken();
        if (!mlToken) {
            return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
        }
        const siteId = (_282 = req.query.site_id) === null || _282 === void 0 ? void 0 : _282.trim();
        const advertiserId = (_283 = req.query.advertiser_id) === null || _283 === void 0 ? void 0 : _283.trim();
        if (!siteId || !advertiserId) {
            return res.status(400).json({ message: 'Parámetros requeridos: site_id y advertiser_id (desde el listado de anunciantes).' });
        }
        const params = mlProductAdsForwardQuery(req);
        const url = `https://api.mercadolibre.com/marketplace/advertising/${encodeURIComponent(siteId)}/advertisers/${encodeURIComponent(advertiserId)}/product_ads/campaigns/search`;
        const r = yield axios_1.default.get(url, {
            headers: {
                Authorization: `Bearer ${mlToken.access_token}`,
                'api-version': '2'
            },
            params,
            validateStatus: () => true
        });
        if (r.status !== 200) {
            const detail = ((_284 = r.data) === null || _284 === void 0 ? void 0 : _284.message) || ((_286 = (_285 = r.data) === null || _285 === void 0 ? void 0 : _285.cause) === null || _286 === void 0 ? void 0 : _286.message) || ((_287 = r.data) === null || _287 === void 0 ? void 0 : _287.error) || r.statusText;
            return res.status(r.status >= 400 && r.status < 500 ? r.status : 502).json({
                message: 'Error obteniendo campañas de Product Ads',
                detail
            });
        }
        res.json(r.data);
    }
    catch (error) {
        console.error('getMercadoLibreProductAdsCampaigns:', ((_288 = error.response) === null || _288 === void 0 ? void 0 : _288.data) || error.message);
        res.status(500).json({ message: 'Error obteniendo campañas de Product Ads', error: error.message });
    }
});
exports.getMercadoLibreProductAdsCampaigns = getMercadoLibreProductAdsCampaigns;
/** Anuncios por publicación con métricas (proxy). Requiere site_id y advertiser_id. */
const getMercadoLibreProductAdsAds = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _289, _290, _291, _292, _293, _294, _295;
    try {
        const mlToken = yield getValidMLToken();
        if (!mlToken) {
            return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
        }
        const siteId = (_289 = req.query.site_id) === null || _289 === void 0 ? void 0 : _289.trim();
        const advertiserId = (_290 = req.query.advertiser_id) === null || _290 === void 0 ? void 0 : _290.trim();
        if (!siteId || !advertiserId) {
            return res.status(400).json({ message: 'Parámetros requeridos: site_id y advertiser_id.' });
        }
        const params = mlProductAdsForwardQuery(req);
        // Documentación Product Ads: los filtros van como filters[nombre], no como query suelta.
        // Sin esto, campaign_id se ignora y la búsqueda devuelve todos los anuncios (exportes por campaña incorrectos).
        if (params.campaign_id) {
            params['filters[campaign_id]'] = params.campaign_id;
            delete params.campaign_id;
        }
        if (params.campaign_ids) {
            params['filters[campaign_ids]'] = params.campaign_ids;
            delete params.campaign_ids;
        }
        const url = `https://api.mercadolibre.com/marketplace/advertising/${encodeURIComponent(siteId)}/advertisers/${encodeURIComponent(advertiserId)}/product_ads/ads/search`;
        const r = yield axios_1.default.get(url, {
            headers: {
                Authorization: `Bearer ${mlToken.access_token}`,
                'api-version': '2'
            },
            params,
            validateStatus: () => true
        });
        if (r.status !== 200) {
            const detail = ((_291 = r.data) === null || _291 === void 0 ? void 0 : _291.message) || ((_293 = (_292 = r.data) === null || _292 === void 0 ? void 0 : _292.cause) === null || _293 === void 0 ? void 0 : _293.message) || ((_294 = r.data) === null || _294 === void 0 ? void 0 : _294.error) || r.statusText;
            return res.status(r.status >= 400 && r.status < 500 ? r.status : 502).json({
                message: 'Error obteniendo anuncios de Product Ads',
                detail
            });
        }
        res.json(r.data);
    }
    catch (error) {
        console.error('getMercadoLibreProductAdsAds:', ((_295 = error.response) === null || _295 === void 0 ? void 0 : _295.data) || error.message);
        res.status(500).json({ message: 'Error obteniendo anuncios de Product Ads', error: error.message });
    }
});
exports.getMercadoLibreProductAdsAds = getMercadoLibreProductAdsAds;
const ML_ADS_V1_HEADERS = (accessToken) => ({
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Api-Version': '1'
});
function normalizeBrandSummary(summary) {
    if (!summary || typeof summary !== 'object')
        return {};
    const et = summary.event_time || {};
    const cost = Number(summary.consumed_budget) || 0;
    const totalAmount = Number(et.units_amount) || 0;
    const prints = Number(summary.prints) || 0;
    const clicks = Number(summary.clicks) || 0;
    const roas = cost > 0 && totalAmount > 0 ? totalAmount / cost : 0;
    const acos = Number(summary.acos) || 0;
    return {
        cost,
        prints,
        clicks,
        ctr: Number(summary.ctr) || 0,
        cpc: Number(summary.cpc) || 0,
        cvr: Number(summary.cvr) || 0,
        acos,
        total_amount: totalAmount,
        roas,
        units_quantity: Number(et.units_quantity) || 0
    };
}
function normalizeDisplaySummary(summary) {
    if (!summary || typeof summary !== 'object')
        return {};
    const et = summary.event_time || {};
    const cost = Number(summary.consumed_budget) || 0;
    const totalAmount = Number(et.direct_amount) || 0;
    const prints = Number(summary.prints) || 0;
    const clicks = Number(summary.clicks) || 0;
    const roasEt = Number(et.roas) || 0;
    const roas = roasEt > 0 ? roasEt : cost > 0 && totalAmount > 0 ? totalAmount / cost : 0;
    const acos = totalAmount > 0 ? (cost / totalAmount) * 100 : 0;
    return {
        cost,
        prints,
        clicks,
        ctr: Number(summary.ctr) || 0,
        cpc: Number(summary.cpc) || 0,
        cpm: Number(summary.cpm) || 0,
        acos,
        total_amount: totalAmount,
        roas
    };
}
function mergeSummaries(rows) {
    if (rows.length === 0)
        return {};
    const sums = {};
    const keys = new Set();
    rows.forEach((r) => Object.keys(r).forEach((k) => keys.add(k)));
    for (const k of keys) {
        sums[k] = rows.reduce((acc, r) => acc + (Number(r[k]) || 0), 0);
    }
    const cost = sums.cost || 0;
    const totalAmount = sums.total_amount || 0;
    if (cost > 0 && totalAmount > 0) {
        sums.roas = totalAmount / cost;
        sums.acos = (cost / totalAmount) * 100;
    }
    return sums;
}
function fetchBrandAdvertiserMetricsSummary(accessToken, advertiserId, dateFrom, dateTo) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const r = yield axios_1.default.get(`https://api.mercadolibre.com/advertising/advertisers/${encodeURIComponent(advertiserId)}/brand_ads/campaigns/metrics`, {
                headers: ML_ADS_V1_HEADERS(accessToken),
                params: { date_from: dateFrom, date_to: dateTo, aggregation_type: 'total' },
                validateStatus: () => true
            });
            if (r.status !== 200 || !((_a = r.data) === null || _a === void 0 ? void 0 : _a.summary))
                return null;
            return normalizeBrandSummary(r.data.summary);
        }
        catch (_b) {
            return null;
        }
    });
}
function fetchBrandCampaignMetricsRaw(accessToken, advertiserId, campaignId, dateFrom, dateTo) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const r = yield axios_1.default.get(`https://api.mercadolibre.com/advertising/advertisers/${encodeURIComponent(String(advertiserId))}/brand_ads/campaigns/${encodeURIComponent(String(campaignId))}/metrics`, {
                headers: ML_ADS_V1_HEADERS(accessToken),
                params: { date_from: dateFrom, date_to: dateTo, aggregation_type: 'total' },
                validateStatus: () => true
            });
            if (r.status !== 200 || !((_a = r.data) === null || _a === void 0 ? void 0 : _a.summary))
                return {};
            return normalizeBrandSummary(r.data.summary);
        }
        catch (_b) {
            return {};
        }
    });
}
/** Anunciantes con acceso a Brand Ads (BADS). */
const getMercadoLibreBrandAdsAdvertisers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _296, _297, _298, _299, _300;
    try {
        const mlToken = yield getValidMLToken();
        if (!mlToken) {
            return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
        }
        const r = yield axios_1.default.get('https://api.mercadolibre.com/advertising/advertisers', {
            headers: ML_ADS_V1_HEADERS(mlToken.access_token),
            params: { product_id: 'BADS' },
            validateStatus: () => true
        });
        if (r.status !== 200) {
            const detail = ((_296 = r.data) === null || _296 === void 0 ? void 0 : _296.message) || ((_298 = (_297 = r.data) === null || _297 === void 0 ? void 0 : _297.cause) === null || _298 === void 0 ? void 0 : _298.message) || ((_299 = r.data) === null || _299 === void 0 ? void 0 : _299.error) || r.statusText;
            return res.status(r.status >= 400 && r.status < 500 ? r.status : 502).json({
                message: r.status === 404
                    ? 'No hay permisos para Brand Ads o no está activado. Consultá con tu asesor comercial de Mercado Libre.'
                    : 'Error consultando anunciantes Brand Ads',
                detail
            });
        }
        res.json(r.data);
    }
    catch (error) {
        console.error('getMercadoLibreBrandAdsAdvertisers:', ((_300 = error.response) === null || _300 === void 0 ? void 0 : _300.data) || error.message);
        res.status(500).json({ message: 'Error consultando Brand Ads', error: error.message });
    }
});
exports.getMercadoLibreBrandAdsAdvertisers = getMercadoLibreBrandAdsAdvertisers;
/**
 * Campañas Brand Ads con métricas por fila + resumen global del anunciante (misma API).
 * Query: advertiser_id, date_from, date_to, limit, offset
 */
const getMercadoLibreBrandAdsCampaigns = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _301, _302, _303, _304, _305, _306, _307, _308, _309, _310, _311, _312, _313, _314, _315;
    try {
        const mlToken = yield getValidMLToken();
        if (!mlToken) {
            return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
        }
        const advertiserId = (_301 = req.query.advertiser_id) === null || _301 === void 0 ? void 0 : _301.trim();
        const dateFrom = (_302 = req.query.date_from) === null || _302 === void 0 ? void 0 : _302.trim();
        const dateTo = (_303 = req.query.date_to) === null || _303 === void 0 ? void 0 : _303.trim();
        const limit = Math.min(Math.max(parseInt(String((_304 = req.query.limit) !== null && _304 !== void 0 ? _304 : '50'), 10) || 50, 1), 100);
        const offset = Math.max(parseInt(String((_305 = req.query.offset) !== null && _305 !== void 0 ? _305 : '0'), 10) || 0, 0);
        if (!advertiserId || !dateFrom || !dateTo) {
            return res.status(400).json({ message: 'Parámetros requeridos: advertiser_id, date_from, date_to' });
        }
        const listUrl = `https://api.mercadolibre.com/advertising/advertisers/${encodeURIComponent(advertiserId)}/brand_ads/campaigns`;
        const listR = yield axios_1.default.get(listUrl, {
            headers: ML_ADS_V1_HEADERS(mlToken.access_token),
            params: { limit, offset },
            validateStatus: () => true
        });
        if (listR.status !== 200) {
            const detail = ((_306 = listR.data) === null || _306 === void 0 ? void 0 : _306.message) || ((_308 = (_307 = listR.data) === null || _307 === void 0 ? void 0 : _307.cause) === null || _308 === void 0 ? void 0 : _308.message) || ((_309 = listR.data) === null || _309 === void 0 ? void 0 : _309.error) || listR.statusText;
            return res.status(listR.status >= 400 && listR.status < 500 ? listR.status : 502).json({
                message: 'Error obteniendo campañas Brand Ads',
                detail
            });
        }
        const rawCampaigns = Array.isArray((_310 = listR.data) === null || _310 === void 0 ? void 0 : _310.campaigns) ? listR.data.campaigns : [];
        const paging = ((_311 = listR.data) === null || _311 === void 0 ? void 0 : _311.paging) || { total: rawCampaigns.length, offset, limit };
        const [metricsSummary, ...metricsRows] = yield Promise.all([
            fetchBrandAdvertiserMetricsSummary(mlToken.access_token, advertiserId, dateFrom, dateTo),
            ...rawCampaigns.map((c) => fetchBrandCampaignMetricsRaw(mlToken.access_token, advertiserId, c.campaign_id, dateFrom, dateTo))
        ]);
        const results = rawCampaigns.map((c, i) => {
            var _a;
            const m = metricsRows[i] || {};
            const budgetAmt = ((_a = c === null || c === void 0 ? void 0 : c.budget) === null || _a === void 0 ? void 0 : _a.amount) != null ? Number(c.budget.amount) : 0;
            return {
                id: c.campaign_id,
                name: c.name,
                status: c.status,
                site_id: c.site_id,
                strategy: c.campaign_type,
                channel: 'brand_ads',
                budget: budgetAmt,
                metrics: m
            };
        });
        res.json({
            paging: { total: (_312 = paging.total) !== null && _312 !== void 0 ? _312 : results.length, offset: (_313 = paging.offset) !== null && _313 !== void 0 ? _313 : offset, limit: (_314 = paging.limit) !== null && _314 !== void 0 ? _314 : limit },
            results,
            metrics_summary: metricsSummary
        });
    }
    catch (error) {
        console.error('getMercadoLibreBrandAdsCampaigns:', ((_315 = error.response) === null || _315 === void 0 ? void 0 : _315.data) || error.message);
        res.status(500).json({ message: 'Error obteniendo campañas Brand Ads', error: error.message });
    }
});
exports.getMercadoLibreBrandAdsCampaigns = getMercadoLibreBrandAdsCampaigns;
/** Anunciantes con acceso a Display Ads (DISPLAY). */
const getMercadoLibreDisplayAdsAdvertisers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _316, _317, _318, _319, _320;
    try {
        const mlToken = yield getValidMLToken();
        if (!mlToken) {
            return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
        }
        const r = yield axios_1.default.get('https://api.mercadolibre.com/advertising/advertisers', {
            headers: ML_ADS_V1_HEADERS(mlToken.access_token),
            params: { product_id: 'DISPLAY' },
            validateStatus: () => true
        });
        if (r.status !== 200) {
            const detail = ((_316 = r.data) === null || _316 === void 0 ? void 0 : _316.message) || ((_318 = (_317 = r.data) === null || _317 === void 0 ? void 0 : _317.cause) === null || _318 === void 0 ? void 0 : _318.message) || ((_319 = r.data) === null || _319 === void 0 ? void 0 : _319.error) || r.statusText;
            return res.status(r.status >= 400 && r.status < 500 ? r.status : 502).json({
                message: r.status === 404
                    ? 'No hay permisos para Display Ads o no está activado. Display se habilita vía asesor comercial de Mercado Libre.'
                    : 'Error consultando anunciantes Display Ads',
                detail
            });
        }
        res.json(r.data);
    }
    catch (error) {
        console.error('getMercadoLibreDisplayAdsAdvertisers:', ((_320 = error.response) === null || _320 === void 0 ? void 0 : _320.data) || error.message);
        res.status(500).json({ message: 'Error consultando Display Ads', error: error.message });
    }
});
exports.getMercadoLibreDisplayAdsAdvertisers = getMercadoLibreDisplayAdsAdvertisers;
function fetchDisplayCampaignMetricsRaw(accessToken, advertiserId, campaignId, dateFrom, dateTo) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const r = yield axios_1.default.get(`https://api.mercadolibre.com/advertising/advertisers/${encodeURIComponent(String(advertiserId))}/display/campaigns/${encodeURIComponent(String(campaignId))}/metrics`, {
                headers: ML_ADS_V1_HEADERS(accessToken),
                params: { date_from: dateFrom, date_to: dateTo },
                validateStatus: () => true
            });
            if (r.status !== 200 || !((_a = r.data) === null || _a === void 0 ? void 0 : _a.summary))
                return {};
            return normalizeDisplaySummary(r.data.summary);
        }
        catch (_b) {
            return {};
        }
    });
}
const DISPLAY_LIST_PAGE = 50;
const DISPLAY_METRICS_CONCURRENCY = 8;
/**
 * Campañas Display con métricas por fila. Query: advertiser_id, date_from, date_to, limit, offset
 * El resumen global suma todas las campañas del anunciante (hasta 200 campañas por petición).
 */
const getMercadoLibreDisplayAdsCampaigns = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _321, _322, _323, _324, _325, _326, _327, _328, _329, _330, _331, _332, _333, _334, _335, _336;
    try {
        const mlToken = yield getValidMLToken();
        if (!mlToken) {
            return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
        }
        const advertiserId = (_321 = req.query.advertiser_id) === null || _321 === void 0 ? void 0 : _321.trim();
        const dateFrom = (_322 = req.query.date_from) === null || _322 === void 0 ? void 0 : _322.trim();
        const dateTo = (_323 = req.query.date_to) === null || _323 === void 0 ? void 0 : _323.trim();
        const limit = Math.min(Math.max(parseInt(String((_324 = req.query.limit) !== null && _324 !== void 0 ? _324 : '50'), 10) || 50, 1), 100);
        const offset = Math.max(parseInt(String((_325 = req.query.offset) !== null && _325 !== void 0 ? _325 : '0'), 10) || 0, 0);
        if (!advertiserId || !dateFrom || !dateTo) {
            return res.status(400).json({ message: 'Parámetros requeridos: advertiser_id, date_from, date_to' });
        }
        const allRows = [];
        let listOffset = 0;
        let totalFromApi = 0;
        for (;;) {
            const listR = yield axios_1.default.get(`https://api.mercadolibre.com/advertising/advertisers/${encodeURIComponent(advertiserId)}/display/campaigns`, {
                headers: ML_ADS_V1_HEADERS(mlToken.access_token),
                params: { limit: DISPLAY_LIST_PAGE, offset: listOffset, sort_by: 'start_date', sort_order: 'desc' },
                validateStatus: () => true
            });
            if (listR.status !== 200) {
                const detail = ((_326 = listR.data) === null || _326 === void 0 ? void 0 : _326.message) || ((_328 = (_327 = listR.data) === null || _327 === void 0 ? void 0 : _327.cause) === null || _328 === void 0 ? void 0 : _328.message) || ((_329 = listR.data) === null || _329 === void 0 ? void 0 : _329.error) || listR.statusText;
                return res.status(listR.status >= 400 && listR.status < 500 ? listR.status : 502).json({
                    message: 'Error obteniendo campañas Display Ads',
                    detail
                });
            }
            const batch = Array.isArray((_330 = listR.data) === null || _330 === void 0 ? void 0 : _330.results) ? listR.data.results : [];
            totalFromApi = (_335 = (_333 = (_332 = (_331 = listR.data) === null || _331 === void 0 ? void 0 : _331.paging) === null || _332 === void 0 ? void 0 : _332.total) !== null && _333 !== void 0 ? _333 : (_334 = listR.data) === null || _334 === void 0 ? void 0 : _334.total) !== null && _335 !== void 0 ? _335 : batch.length + listOffset;
            allRows.push(...batch);
            if (batch.length < DISPLAY_LIST_PAGE)
                break;
            listOffset += DISPLAY_LIST_PAGE;
            if (listOffset > 10000)
                break;
        }
        const MAX_METRICS = 200;
        const idsForMetrics = allRows.slice(0, MAX_METRICS).map((r) => r.id);
        const metricsById = new Map();
        for (let i = 0; i < idsForMetrics.length; i += DISPLAY_METRICS_CONCURRENCY) {
            const chunk = idsForMetrics.slice(i, i + DISPLAY_METRICS_CONCURRENCY);
            const settled = yield Promise.all(chunk.map((cid) => fetchDisplayCampaignMetricsRaw(mlToken.access_token, advertiserId, cid, dateFrom, dateTo).then((m) => ({
                cid,
                m
            }))));
            settled.forEach(({ cid, m }) => metricsById.set(Number(cid), m));
        }
        const allSummaries = idsForMetrics.map((id) => metricsById.get(Number(id)) || {});
        const metrics_summary = mergeSummaries(allSummaries);
        const summary_partial = allRows.length > MAX_METRICS;
        const enriched = allRows.map((c) => ({
            id: c.id,
            name: c.name,
            status: c.status,
            site_id: c.site_id,
            strategy: c.type,
            channel: 'display',
            goal: c.goal,
            budget: 0,
            metrics: metricsById.get(Number(c.id)) || {}
        }));
        const pageSlice = enriched.slice(offset, offset + limit);
        const total = totalFromApi || enriched.length;
        res.json({
            paging: { total, offset, limit },
            results: pageSlice,
            metrics_summary,
            summary_partial
        });
    }
    catch (error) {
        console.error('getMercadoLibreDisplayAdsCampaigns:', ((_336 = error.response) === null || _336 === void 0 ? void 0 : _336.data) || error.message);
        res.status(500).json({ message: 'Error obteniendo campañas Display Ads', error: error.message });
    }
});
exports.getMercadoLibreDisplayAdsCampaigns = getMercadoLibreDisplayAdsCampaigns;
