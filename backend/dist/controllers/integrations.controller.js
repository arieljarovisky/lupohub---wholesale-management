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
exports.getMercadoLibreBrandAdsCampaigns = exports.getMercadoLibreBrandAdsAdvertisers = exports.getMercadoLibreProductAdsAds = exports.getMercadoLibreProductAdsCampaigns = exports.getMercadoLibreProductAdsAdvertisers = exports.processMLQuestionsAi = exports.saveMLQuestionsAiConfig = exports.getMLQuestionsAiConfig = exports.saveMLAutoMessageConfig = exports.getMLAutoMessageConfig = exports.importProductFromTiendaNube = exports.importProductFromMercadoLibre = exports.getTiendaNubeProductVariants = exports.getMercadoLibreItemVariations = exports.getMercadoLibreStock = exports.getMercadoLibreStockTotals = exports.getMercadoLibreOrders = exports.getMercadoLibreQuestions = exports.emitirNotaCreditoExternalInvoice = exports.getExternalInvoicesHistory = exports.invoiceMercadoLibreOrdersBulk = exports.invoiceTiendaNubeOrdersBulk = exports.getTiendaNubeOrders = exports.getTiendaNubeStockTotals = exports.getTiendaNubeStock = exports.importStockFromMercadoLibre = exports.syncAllStockFromMercadoLibre = exports.getVariantExternalStocks = exports.syncSelectedStockToMercadoLibre = exports.syncAllStockToMercadoLibre = exports.syncSelectedStockToTiendaNube = exports.syncAllStockToTiendaNube = exports.handleMercadoLibreWebhook = exports.testMercadoLibreOrder = exports.syncMercadoLibreOrdersFromDate = exports.syncTiendaNubeOrdersFromDate = exports.testTiendaNubeOrder = exports.handleTiendaNubeWebhook = exports.syncProductsFromMercadoLibre = exports.debugMercadoLibreItem = exports.testMercadoLibreConnection = exports.disconnectIntegration = exports.normalizeSizesInTiendaNube = exports.syncProductsFromTiendaNube = exports.updateMercadoLibreStock = exports.handleTiendaNubeCallback = exports.getTiendaNubeAuthUrl = exports.handleMercadoLibreCallback = exports.getMercadoLibreAuthUrl = exports.getIntegrationStatus = void 0;
exports.getMercadoLibreDisplayAdsCampaigns = exports.getMercadoLibreDisplayAdsAdvertisers = void 0;
exports.normalizeMercadoLibreItemId = normalizeMercadoLibreItemId;
exports.mercadoLibreItemIdCandidates = mercadoLibreItemIdCandidates;
exports.getValidMLToken = getValidMLToken;
exports.runAutoSyncMLtoTN = runAutoSyncMLtoTN;
const axios_1 = __importDefault(require("axios"));
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
const products_controller_1 = require("./products.controller");
const tiendanubeClient_1 = require("../utils/tiendanubeClient");
const mlQuestionsAi = __importStar(require("../services/mlQuestionsAi.service"));
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
    // Si pegan URL, extraer token tipo MLA123 / MLAU-123
    if (/^https?:\/\//i.test(s)) {
        const m = s.match(/\/(ML[A-Z]{0,5}-?\d+)(?:[/?#]|$)/i);
        if (m === null || m === void 0 ? void 0 : m[1])
            s = m[1];
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
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h;
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
/** Resuelve IDs de item a partir de un user_product_id (ej. MLAU...). */
function resolveMercadoLibreUserProductItems(userProductId, sellerId, accessToken) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
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
/** PUT a Tienda Nube con reintentos ante 429 (Too Many Requests). */
function putTnVariantWithRetry(url_1, body_1, headers_1) {
    return __awaiter(this, arguments, void 0, function* (url, body, headers, maxRetries = 2) {
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
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
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
    var _a, _b, _c, _d, _e, _f, _g;
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
                    const msg = ((_c = (_b = (_a = whErr.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.url) === null || _c === void 0 ? void 0 : _c[0]) || ((_f = (_e = (_d = whErr.response) === null || _d === void 0 ? void 0 : _d.data) === null || _e === void 0 ? void 0 : _e.event) === null || _f === void 0 ? void 0 : _f[0]) || whErr.message;
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
        console.error('Error in Tienda Nube callback:', ((_g = error.response) === null || _g === void 0 ? void 0 : _g.data) || error.message);
        res.redirect(`${FRONTEND_URL}/#settings?status=error&platform=tiendanube`);
    }
});
exports.handleTiendaNubeCallback = handleTiendaNubeCallback;
const updateMercadoLibreStock = (sku, newStock) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
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
        console.error(`[ML Sync Error] SKU ${sku}:`, ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
    }
});
exports.updateMercadoLibreStock = updateMercadoLibreStock;
const syncProductsFromTiendaNube = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
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
                    log(`  ${((_a = tnProduct.name) === null || _a === void 0 ? void 0 : _a.es) || tnProduct.name} (ID: ${tnProduct.id}): ${variants.length} variantes`);
                }
                page++;
                // Safety break (hasta 200 páginas = 40.000 productos)
                if (page > 200)
                    hasMore = false;
            }
            catch (error) {
                // If 404, likely means page out of range or end of list
                if (((_b = error.response) === null || _b === void 0 ? void 0 : _b.status) === 404) {
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
        console.error('Error syncing products:', ((_c = error.response) === null || _c === void 0 ? void 0 : _c.data) || error.message);
        res.status(500).json({ message: 'Error sincronizando productos', error: error.message });
    }
});
exports.syncProductsFromTiendaNube = syncProductsFromTiendaNube;
/** Talles estándar para el público: P, M, G, GG, XG, XXG, XXXG (+ U para único) */
const STANDARD_SIZES = ['P', 'M', 'G', 'GG', 'XG', 'XXG', 'XXXG', 'U'];
/** Mapeo de nombres comunes a talle estándar (clave en mayúsculas/normalizada) */
function normalizeSizeToStandard(raw) {
    const v = raw.trim().toUpperCase().replace(/\s+/g, ' ');
    if (!v)
        return 'U';
    // Ya estándar
    if (STANDARD_SIZES.includes(v))
        return v;
    // Único / sin talla
    if (/^U$|UNICO|ÚNICO|LISO|UNICA|ÚNICA/i.test(v))
        return 'U';
    // Pequeño
    if (/^P$|^S$|^PP$|^XS$|^1$|^2$|^34$|^36$|^35$|^XXS$/i.test(v))
        return 'P';
    // Mediano
    if (/^M$|^3$|^4$|^38$|^40$/i.test(v))
        return 'M';
    // Grande
    if (/^G$|^L$|^5$|^6$|^42$|^44$/i.test(v))
        return 'G';
    if (/^GG$|^7$|^8$|^46$/i.test(v))
        return 'GG';
    // Extra grande
    if (/^XG$|^XL$|^9$|^10$|^48$/i.test(v))
        return 'XG';
    if (/^XXG$|^XXL$|^11$|^12$|^50$/i.test(v))
        return 'XXG';
    if (/^XXXG$|^XXXL$|^13$|^52$/i.test(v))
        return 'XXXG';
    // Por texto
    if (/EXTRA\s*GRANDE|XXL|XX\s*L/i.test(v) && !/XXX/i.test(v))
        return 'XXG';
    if (/XXX|TRIPLE/i.test(v))
        return 'XXXG';
    if (/XL|EXTRA\s*LARGE/i.test(v))
        return 'XG';
    if (/GRANDE|LARGE|^L$/i.test(v))
        return 'G';
    if (/MEDIANO|MEDIUM|^M$/i.test(v))
        return 'M';
    if (/PEQUEÑO|SMALL|^S$|^P$/i.test(v))
        return 'P';
    return v; // dejar como está si no hay match
}
const delay = (ms) => new Promise(r => setTimeout(r, ms));
const normalizeSizesInTiendaNube = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    try {
        const integration = yield (0, db_1.get)(`SELECT * FROM integrations WHERE platform = 'tiendanube'`);
        if (!integration || !integration.access_token) {
            return res.status(400).json({ message: 'No estás conectado a Tienda Nube' });
        }
        const { access_token, user_id: store_id } = integration;
        const logs = [];
        const log = (msg) => {
            console.log(msg);
            logs.push(msg);
        };
        let updatedVariants = 0;
        let skippedProducts = 0;
        let page = 1;
        let hasMore = true;
        const isSizeAttr = (name) => /talle|talla|size|tamano|tamaño/i.test(name);
        while (hasMore) {
            const response = yield axios_1.default.get(`https://api.tiendanube.com/v1/${store_id}/products`, {
                headers: { 'Authentication': `bearer ${access_token}`, 'User-Agent': TN_USER_AGENT },
                params: { page, per_page: 50 }
            });
            const products = response.data;
            if (!(products === null || products === void 0 ? void 0 : products.length)) {
                hasMore = false;
                break;
            }
            for (const tnProduct of products) {
                const productAttributes = tnProduct.attributes || [];
                let sizeAttrIndex = -1;
                for (let i = 0; i < productAttributes.length; i++) {
                    const attr = productAttributes[i];
                    const name = ((_c = (_b = (_a = attr === null || attr === void 0 ? void 0 : attr.es) !== null && _a !== void 0 ? _a : attr === null || attr === void 0 ? void 0 : attr.en) !== null && _b !== void 0 ? _b : attr === null || attr === void 0 ? void 0 : attr.pt) !== null && _c !== void 0 ? _c : (typeof attr === 'string' ? attr : '')).toString();
                    if (isSizeAttr(name)) {
                        sizeAttrIndex = i;
                        break;
                    }
                }
                if (sizeAttrIndex === -1) {
                    skippedProducts++;
                    continue;
                }
                for (const variant of tnProduct.variants || []) {
                    const values = variant.values || [];
                    if (sizeAttrIndex >= values.length)
                        continue;
                    const sizeVal = values[sizeAttrIndex];
                    const current = ((_g = ((_f = (_e = (_d = sizeVal === null || sizeVal === void 0 ? void 0 : sizeVal.es) !== null && _d !== void 0 ? _d : sizeVal === null || sizeVal === void 0 ? void 0 : sizeVal.pt) !== null && _e !== void 0 ? _e : sizeVal === null || sizeVal === void 0 ? void 0 : sizeVal.en) !== null && _f !== void 0 ? _f : sizeVal)) === null || _g === void 0 ? void 0 : _g.toString().trim()) || '';
                    const normalized = normalizeSizeToStandard(current);
                    if (normalized === current)
                        continue;
                    const newValues = values.map((obj, i) => {
                        if (i !== sizeAttrIndex)
                            return obj;
                        const langKeys = obj && typeof obj === 'object' ? Object.keys(obj) : ['es'];
                        const next = {};
                        for (const lang of langKeys)
                            next[lang] = normalized;
                        return next;
                    });
                    try {
                        yield axios_1.default.put(`https://api.tiendanube.com/v1/${store_id}/products/${tnProduct.id}/variants/${variant.id}`, { values: newValues }, { headers: { 'Authentication': `bearer ${access_token}`, 'User-Agent': TN_USER_AGENT } });
                        updatedVariants++;
                        log(`  [TN] Producto ${tnProduct.id} variante ${variant.id}: "${current}" → "${normalized}"`);
                        yield delay(250);
                    }
                    catch (err) {
                        log(`  [ERROR] Variante ${variant.id}: ${((_j = (_h = err.response) === null || _h === void 0 ? void 0 : _h.data) === null || _j === void 0 ? void 0 : _j.description) || err.message}`);
                    }
                }
            }
            page++;
            if (page > 300)
                hasMore = false; // hasta 300 páginas × 50 = 15.000 productos
        }
        res.json({
            message: 'Normalización de talles en Tienda Nube completada',
            updatedVariants,
            skippedProducts,
            logs
        });
    }
    catch (error) {
        console.error('Error normalizing sizes:', ((_k = error.response) === null || _k === void 0 ? void 0 : _k.data) || error.message);
        res.status(500).json({ message: 'Error normalizando talles en Tienda Nube', error: error.message });
    }
});
exports.normalizeSizesInTiendaNube = normalizeSizesInTiendaNube;
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
    var _a, _b, _c, _d, _e;
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
                totalItems: ((_a = itemsRes.data.paging) === null || _a === void 0 ? void 0 : _a.total) || ((_b = itemsRes.data.results) === null || _b === void 0 ? void 0 : _b.length) || 0,
                expiresAt: (integration === null || integration === void 0 ? void 0 : integration.expires_at) ? new Date(integration.expires_at).toLocaleString() : 'N/A'
            }
        });
    }
    catch (error) {
        console.error('Error testing ML connection:', ((_c = error.response) === null || _c === void 0 ? void 0 : _c.data) || error.message);
        res.status(500).json({
            success: false,
            message: 'Error de conexión',
            details: ((_e = (_d = error.response) === null || _d === void 0 ? void 0 : _d.data) === null || _e === void 0 ? void 0 : _e.message) || error.message
        });
    }
});
exports.testMercadoLibreConnection = testMercadoLibreConnection;
const debugMercadoLibreItem = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
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
        const itemId = (_a = searchRes.data.results) === null || _a === void 0 ? void 0 : _a[0];
        if (!itemId) {
            return res.json({ message: 'No hay publicaciones' });
        }
        // Obtener detalles del item
        const itemRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${itemId}?include_attributes=all`, {
            headers: { Authorization: `Bearer ${access_token}` }
        });
        const item = itemRes.data;
        const firstVariation = (_b = item.variations) === null || _b === void 0 ? void 0 : _b[0];
        res.json({
            itemId: item.id,
            title: item.title,
            seller_custom_field: item.seller_custom_field,
            seller_sku: item.seller_sku,
            variation_count: ((_c = item.variations) === null || _c === void 0 ? void 0 : _c.length) || 0,
            first_variation: firstVariation ? {
                id: firstVariation.id,
                seller_custom_field: firstVariation.seller_custom_field,
                seller_sku: firstVariation.seller_sku,
                attributes: firstVariation.attributes,
                attribute_combinations: firstVariation.attribute_combinations,
                all_keys: Object.keys(firstVariation)
            } : null,
            item_attributes: (_d = item.attributes) === null || _d === void 0 ? void 0 : _d.filter((a) => { var _a, _b, _c; return ((_a = a.id) === null || _a === void 0 ? void 0 : _a.includes('SKU')) || ((_b = a.id) === null || _b === void 0 ? void 0 : _b.includes('GTIN')) || ((_c = a.id) === null || _c === void 0 ? void 0 : _c.includes('CODE')); })
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message, details: (_e = error.response) === null || _e === void 0 ? void 0 : _e.data });
    }
});
exports.debugMercadoLibreItem = debugMercadoLibreItem;
const syncProductsFromMercadoLibre = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
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
                const total = ((_a = searchRes.data.paging) === null || _a === void 0 ? void 0 : _a.total) || 0;
                if (offset >= total || results.length === 0)
                    break;
                if (allItems.length >= ML_SYNC_MAX_ITEMS)
                    break;
            } while (true);
        }
        catch (searchError) {
            logs.push(`[ML ERROR] Error buscando items: ${((_c = (_b = searchError.response) === null || _b === void 0 ? void 0 : _b.data) === null || _c === void 0 ? void 0 : _c.message) || searchError.message}`);
            logs.push(`[ML ERROR] Status: ${(_d = searchError.response) === null || _d === void 0 ? void 0 : _d.status}`);
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
                            const mlSku = (skuAttr ? ((_f = (_e = skuAttr.value_name) !== null && _e !== void 0 ? _e : skuAttr.value) !== null && _f !== void 0 ? _f : '').toString().trim() : '')
                                || ((_h = (_g = v.seller_sku) !== null && _g !== void 0 ? _g : v.seller_custom_field) !== null && _h !== void 0 ? _h : '').toString().trim();
                            // Extraer color y talle de attribute_combinations
                            const attrCombs = v.attribute_combinations || [];
                            const mlColor = ((_j = attrCombs.find((a) => a.id === 'COLOR')) === null || _j === void 0 ? void 0 : _j.value_name) || '';
                            const mlSize = ((_k = attrCombs.find((a) => a.id === 'SIZE')) === null || _k === void 0 ? void 0 : _k.value_name) || '';
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
                logs.push(`[ML Lote Error]: ${((_m = (_l = e === null || e === void 0 ? void 0 : e.response) === null || _l === void 0 ? void 0 : _l.data) === null || _m === void 0 ? void 0 : _m.message) || (e === null || e === void 0 ? void 0 : e.message) || 'Error'}`);
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z;
    try {
        const event = ((_d = (_c = (_b = (_a = req.body) === null || _a === void 0 ? void 0 : _a.event) !== null && _b !== void 0 ? _b : req.headers['x-linkedstore-topic']) !== null && _c !== void 0 ? _c : req.headers['x-tiendanube-topic']) !== null && _d !== void 0 ? _d : '').toString();
        const storeIdFromReq = ((_h = (_g = (_f = (_e = req.body) === null || _e === void 0 ? void 0 : _e.store_id) !== null && _f !== void 0 ? _f : req.headers['x-linkedstore-id']) !== null && _g !== void 0 ? _g : req.headers['x-tiendanube-store-id']) !== null && _h !== void 0 ? _h : '').toString();
        console.log(`[TN Webhook] Evento: ${event}, Store: ${storeIdFromReq || '-'}`);
        // Verificar store_id solo cuando viene en el webhook.
        // En algunos eventos/proveedores no llega este dato y antes se ignoraba todo por error.
        const integration = yield (0, db_1.get)(`SELECT store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
        const storedStoreId = (_k = ((_j = integration === null || integration === void 0 ? void 0 : integration.store_id) !== null && _j !== void 0 ? _j : integration === null || integration === void 0 ? void 0 : integration.user_id)) === null || _k === void 0 ? void 0 : _k.toString();
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
            const orderId = (_r = (_p = (_m = (_l = req.body.id) !== null && _l !== void 0 ? _l : req.body.order_id) !== null && _m !== void 0 ? _m : (_o = req.body.order) === null || _o === void 0 ? void 0 : _o.id) !== null && _p !== void 0 ? _p : (_q = req.body.data) === null || _q === void 0 ? void 0 : _q.id) !== null && _r !== void 0 ? _r : (_s = req.body.data) === null || _s === void 0 ? void 0 : _s.order_id;
            if (orderId) {
                processTiendaNubeOrder(String(orderId)).catch((err) => console.error('[TN Order] Error procesando orden en background:', (err === null || err === void 0 ? void 0 : err.message) || err));
            }
            else {
                console.warn('[TN Webhook] order/paid sin id de orden en body:', JSON.stringify(req.body));
            }
        }
        // Al cancelar una orden, restaurar el stock que se había descontado
        if (event === 'order/cancelled') {
            const orderId = (_y = (_w = (_u = (_t = req.body.id) !== null && _t !== void 0 ? _t : req.body.order_id) !== null && _u !== void 0 ? _u : (_v = req.body.order) === null || _v === void 0 ? void 0 : _v.id) !== null && _w !== void 0 ? _w : (_x = req.body.data) === null || _x === void 0 ? void 0 : _x.id) !== null && _y !== void 0 ? _y : (_z = req.body.data) === null || _z === void 0 ? void 0 : _z.order_id;
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
    var _a, _b, _c;
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
            const tnVariantIdRaw = (_a = item.variant_id) !== null && _a !== void 0 ? _a : item.variantId;
            const tnVariantId = tnVariantIdRaw != null ? String(tnVariantIdRaw) : null;
            const quantity = Math.max(0, parseInt(String((_b = item.quantity) !== null && _b !== void 0 ? _b : 0), 10) || 0);
            const itemSku = (item.sku || item.variant_sku || '').toString().trim();
            if (quantity === 0)
                continue;
            let variant = null;
            if (tnVariantId) {
                const fromPub = yield (0, db_1.get)(`SELECT vp.variant_id AS id, COALESCE(vp.pack_size, 1) AS tn_pack FROM variant_publications vp WHERE vp.platform = 'tiendanube' AND vp.external_variant_id = ? LIMIT 1`, [tnVariantId]);
                if (fromPub === null || fromPub === void 0 ? void 0 : fromPub.id) {
                    const row = yield (0, db_1.get)(`SELECT stock AS current_stock FROM stocks WHERE variant_id = ?`, [fromPub.id]);
                    variant = { id: fromPub.id, current_stock: Number((_c = row === null || row === void 0 ? void 0 : row.current_stock) !== null && _c !== void 0 ? _c : 0), tn_pack: Math.max(1, Number(fromPub.tn_pack) || 1) };
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
    var _a;
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
            const currentStock = Number((_a = row === null || row === void 0 ? void 0 : row.stock) !== null && _a !== void 0 ? _a : 0);
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
    var _a, _b, _c, _d;
    try {
        const orderId = ((_d = (_b = (_a = req.body) === null || _a === void 0 ? void 0 : _a.orderId) !== null && _b !== void 0 ? _b : (_c = req.query) === null || _c === void 0 ? void 0 : _c.orderId) !== null && _d !== void 0 ? _d : '').toString().trim();
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
    var _a, _b, _c, _d, _e, _f;
    try {
        const fromParam = ((_d = (_b = (_a = req.body) === null || _a === void 0 ? void 0 : _a.fromDate) !== null && _b !== void 0 ? _b : (_c = req.query) === null || _c === void 0 ? void 0 : _c.fromDate) !== null && _d !== void 0 ? _d : '2026-03-09').toString().trim();
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
                const errMsg = ((_e = listRes.data) === null || _e === void 0 ? void 0 : _e.message) || ((_f = listRes.data) === null || _f === void 0 ? void 0 : _f.error) || JSON.stringify(listRes.data);
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
    var _a, _b, _c, _d, _e, _f, _g;
    try {
        const fromParam = ((_d = (_b = (_a = req.body) === null || _a === void 0 ? void 0 : _a.fromDate) !== null && _b !== void 0 ? _b : (_c = req.query) === null || _c === void 0 ? void 0 : _c.fromDate) !== null && _d !== void 0 ? _d : '2026-03-09').toString().trim();
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
                const errMsg = ((_e = searchRes.data) === null || _e === void 0 ? void 0 : _e.message) ||
                    ((_f = searchRes.data) === null || _f === void 0 ? void 0 : _f.error) ||
                    JSON.stringify(searchRes.data);
                return res.status(searchRes.status === 403 ? 403 : 500).json({
                    message: `Error al listar órdenes de Mercado Libre: ${errMsg}`,
                    hint: searchRes.status === 403 ? 'Reconectá Mercado Libre.' : undefined
                });
            }
            const results = Array.isArray((_g = searchRes.data) === null || _g === void 0 ? void 0 : _g.results) ? searchRes.data.results : [];
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
    var _a, _b, _c, _d, _e, _f;
    try {
        const orderId = ((_d = (_b = (_a = req.body) === null || _a === void 0 ? void 0 : _a.orderId) !== null && _b !== void 0 ? _b : (_c = req.query) === null || _c === void 0 ? void 0 : _c.orderId) !== null && _d !== void 0 ? _d : '').toString().trim();
        if (!orderId) {
            return res.status(400).json({
                message: 'Falta orderId. Ejemplo: POST con body { "orderId": "2000015720058034" } o GET ?orderId=2000015720058034'
            });
        }
        const ref = `Orden ML: ${orderId}`;
        const before = yield (0, db_1.get)(`SELECT COUNT(*) AS n FROM stock_movements WHERE movement_type = 'VENTA_MERCADO_LIBRE' AND reference = ?`, [ref]);
        yield processMercadoLibreOrder(orderId);
        const after = yield (0, db_1.get)(`SELECT COUNT(*) AS n FROM stock_movements WHERE movement_type = 'VENTA_MERCADO_LIBRE' AND reference = ?`, [ref]);
        const beforeN = Number((_e = before === null || before === void 0 ? void 0 : before.n) !== null && _e !== void 0 ? _e : 0);
        const afterN = Number((_f = after === null || after === void 0 ? void 0 : after.n) !== null && _f !== void 0 ? _f : 0);
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    try {
        const topic = ((_d = (_b = (_a = req.body) === null || _a === void 0 ? void 0 : _a.topic) !== null && _b !== void 0 ? _b : (_c = req.query) === null || _c === void 0 ? void 0 : _c.topic) !== null && _d !== void 0 ? _d : '').toString();
        const resourceRaw = ((_h = (_f = (_e = req.body) === null || _e === void 0 ? void 0 : _e.resource) !== null && _f !== void 0 ? _f : (_g = req.query) === null || _g === void 0 ? void 0 : _g.resource) !== null && _h !== void 0 ? _h : '').toString();
        const userIdRaw = ((_m = (_k = (_j = req.body) === null || _j === void 0 ? void 0 : _j.user_id) !== null && _k !== void 0 ? _k : (_l = req.query) === null || _l === void 0 ? void 0 : _l.user_id) !== null && _m !== void 0 ? _m : '').toString();
        console.log(`[ML Webhook] Topic: ${topic}, Resource: ${resourceRaw}, User: ${userIdRaw || '-'}`);
        // Verificar user_id solo cuando viene en el webhook.
        // Mercado Libre a veces no lo envía y eso hacía que nunca se procese la orden.
        const integration = yield (0, db_1.get)(`SELECT user_id FROM integrations WHERE platform = 'mercadolibre'`);
        const storedUserId = (_o = integration === null || integration === void 0 ? void 0 : integration.user_id) === null || _o === void 0 ? void 0 : _o.toString();
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
    var _a, _b, _c, _d;
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
            const mlItemId = (_a = item.item) === null || _a === void 0 ? void 0 : _a.id;
            const mlVariationId = (_b = item.item) === null || _b === void 0 ? void 0 : _b.variation_id;
            const quantity = item.quantity;
            let itemSku = (((_c = item.item) === null || _c === void 0 ? void 0 : _c.sku) || item.sku || '').toString().trim();
            if (!itemSku) {
                itemSku = yield resolveMlOrderItemSku(mlToken.access_token, mlItemId, mlVariationId);
            }
            let variant = null;
            if (mlItemId) {
                const extVariantId = (mlVariationId && String(mlVariationId).trim()) || '';
                const fromPub = yield (0, db_1.get)(`SELECT vp.variant_id AS id, COALESCE(vp.pack_size, 1) AS ml_pack FROM variant_publications vp WHERE vp.platform = 'mercadolibre' AND vp.external_product_id = ? AND vp.external_variant_id = ? LIMIT 1`, [mlItemId, extVariantId]);
                if (fromPub === null || fromPub === void 0 ? void 0 : fromPub.id) {
                    const row = yield (0, db_1.get)(`SELECT stock AS current_stock FROM stocks WHERE variant_id = ?`, [fromPub.id]);
                    variant = { id: fromPub.id, current_stock: Number((_d = row === null || row === void 0 ? void 0 : row.current_stock) !== null && _d !== void 0 ? _d : 0), ml_pack: Math.max(1, Number(fromPub.ml_pack) || 1) };
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
            catch (_e) {
                // No romper flujo por falla al limpiar lock efimero.
            }
        }
    }
});
// Enviar mensaje de agradecimiento al comprador de ML
const sendThankYouMessage = (orderId, order, accessToken) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    try {
        // Verificar si el mensaje automático está habilitado
        const config = yield (0, db_1.get)(`SELECT enabled, message_template FROM ml_auto_message_config WHERE id = 1`);
        if (config && !config.enabled) {
            console.log(`[ML Message] Mensaje automático deshabilitado, omitiendo orden ${orderId}`);
            return;
        }
        const buyerId = (_a = order.buyer) === null || _a === void 0 ? void 0 : _a.id;
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
        const buyerName = ((_b = order.buyer) === null || _b === void 0 ? void 0 : _b.first_name) || ((_c = order.buyer) === null || _c === void 0 ? void 0 : _c.nickname) || 'Cliente';
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
        yield axios_1.default.post(`https://api.mercadolibre.com/messages/packs/${packId}/sellers/${((_d = order.seller) === null || _d === void 0 ? void 0 : _d.id) || ((_e = (yield getValidMLToken())) === null || _e === void 0 ? void 0 : _e.user_id)}`, {
            from: {
                user_id: (_f = order.seller) === null || _f === void 0 ? void 0 : _f.id
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
        if (((_g = error.message) === null || _g === void 0 ? void 0 : _g.includes('ml_messages_sent')) || error.code === 'ER_NO_SUCH_TABLE') {
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
        const errData = ((_h = error.response) === null || _h === void 0 ? void 0 : _h.data) || {};
        const isNotFound = ((_j = error.response) === null || _j === void 0 ? void 0 : _j.status) === 404 || (errData.error === 'resource not found');
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
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h;
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
// Sincronizar todo el stock local a Tienda Nube
const syncAllStockToTiendaNube = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
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
                logs.push(`[ERROR] ${v.sku}: ${((_b = (_a = e.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.description) || e.message}`);
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
    var _a, _b, _c;
    try {
        const variantIds = Array.isArray((_a = req.body) === null || _a === void 0 ? void 0 : _a.variantIds) ? req.body.variantIds.filter((id) => typeof id === 'string' && id.length > 0) : [];
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
                logs.push(`[ERROR] ${v.sku}: ${((_c = (_b = e.response) === null || _b === void 0 ? void 0 : _b.data) === null || _c === void 0 ? void 0 : _c.description) || e.message}`);
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
    var _a;
    try {
        const variantIds = Array.isArray((_a = req.body) === null || _a === void 0 ? void 0 : _a.variantIds) ? req.body.variantIds.filter((id) => typeof id === 'string' && id.length > 0) : [];
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
    var _a, _b, _c, _d, _e, _f;
    try {
        const variantIds = Array.isArray((_a = req.body) === null || _a === void 0 ? void 0 : _a.variantIds) ? req.body.variantIds.filter((id) => typeof id === 'string' && id.length > 0).slice(0, 100) : [];
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
                    stocks[vid].stockLupoShop = Number((_b = r.stock) !== null && _b !== void 0 ? _b : 0);
            }
            // Valor inicial para no mostrar "Tienda: -" hasta el primer webhook exitoso.
            const localRows = yield (0, db_1.query)(`SELECT variant_id, stock FROM stocks WHERE variant_id IN (${placeholders})`, variantIds);
            for (const r of localRows || []) {
                const vid = r.variant_id;
                if (!vid || !stocks[vid])
                    continue;
                if (stocks[vid].stockLupoShop === undefined) {
                    stocks[vid].stockLupoShop = Number((_c = r.stock) !== null && _c !== void 0 ? _c : 0);
                }
            }
        }
        catch (_g) {
            // tabla aún no existe o error puntual: no rompe ML/TN
        }
        const mlToken = yield getValidMLToken();
        const tnIntegration = yield (0, db_1.get)(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);
        if (mlToken === null || mlToken === void 0 ? void 0 : mlToken.access_token) {
            const mlHeaders = { 'Authorization': `Bearer ${mlToken.access_token}` };
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
            for (const [itemId, variants] of mlItemIds) {
                try {
                    const itemRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${itemId}`, { headers: mlHeaders });
                    const item = itemRes.data;
                    const variations = item.variations || [];
                    for (const { variantId, variationId } of variants) {
                        if (variations.length === 0) {
                            stocks[variantId].stockML = (_d = item.available_quantity) !== null && _d !== void 0 ? _d : 0;
                        }
                        else if (variationId) {
                            const v = variations.find((x) => String(x.id) === String(variationId));
                            stocks[variantId].stockML = v ? ((_e = v.available_quantity) !== null && _e !== void 0 ? _e : 0) : undefined;
                        }
                        else if (variations.length === 1) {
                            stocks[variantId].stockML = (_f = variations[0].available_quantity) !== null && _f !== void 0 ? _f : 0;
                        }
                    }
                }
                catch (_h) {
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
                catch (_j) {
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
    var _a, _b, _c, _d, _e, _f, _g, _h;
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
                            const sellerCustom = ((_a = v.seller_custom_field) !== null && _a !== void 0 ? _a : '').toString().trim();
                            const sellerSku = ((_b = v.seller_sku) !== null && _b !== void 0 ? _b : '').toString().trim();
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
                            const mlQty = (_c = v.available_quantity) !== null && _c !== void 0 ? _c : 0;
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
                        const sellerCustom = ((_d = item.seller_custom_field) !== null && _d !== void 0 ? _d : '').toString().trim();
                        const sellerSku = ((_e = item.seller_sku) !== null && _e !== void 0 ? _e : '').toString().trim();
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
                        const mlQty = (_f = item.available_quantity) !== null && _f !== void 0 ? _f : 0;
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
                    logs.push(`[TN ERROR] ${v.sku}: ${((_h = (_g = e.response) === null || _g === void 0 ? void 0 : _g.data) === null || _h === void 0 ? void 0 : _h.description) || e.message}`);
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
    var _a, _b, _c, _d, _e, _f, _g, _h;
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
                            const sellerCustom = ((_a = v.seller_custom_field) !== null && _a !== void 0 ? _a : '').toString().trim();
                            const sellerSku = ((_b = v.seller_sku) !== null && _b !== void 0 ? _b : '').toString().trim();
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
                            const mlQty = (_c = v.available_quantity) !== null && _c !== void 0 ? _c : 0;
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
                        const sellerCustom = ((_d = item.seller_custom_field) !== null && _d !== void 0 ? _d : '').toString().trim();
                        const sellerSku = ((_e = item.seller_sku) !== null && _e !== void 0 ? _e : '').toString().trim();
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
                        const mlQty = (_f = item.available_quantity) !== null && _f !== void 0 ? _f : 0;
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
                    logs.push(`[TN ERROR] ${v.sku}: ${((_h = (_g = e.response) === null || _g === void 0 ? void 0 : _g.data) === null || _h === void 0 ? void 0 : _h.description) || e.message}`);
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
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
                const title = ((_a = p.name) === null || _a === void 0 ? void 0 : _a.es) || ((_b = p.name) === null || _b === void 0 ? void 0 : _b.pt) || ((_c = p.name) === null || _c === void 0 ? void 0 : _c.en) || p.name || '';
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
                    price: (_e = (_d = variantsList[0]) === null || _d === void 0 ? void 0 : _d.price) !== null && _e !== void 0 ? _e : 0,
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
        const detail = ((_g = (_f = error.response) === null || _f === void 0 ? void 0 : _f.data) === null || _g === void 0 ? void 0 : _g.description) || ((_j = (_h = error.response) === null || _h === void 0 ? void 0 : _h.data) === null || _j === void 0 ? void 0 : _j.message) || error.message;
        console.error('Error fetching TN stock:', ((_k = error.response) === null || _k === void 0 ? void 0 : _k.data) || error.message);
        res.status(500).json({ message: 'Error obteniendo stock de Tienda Nube', detail: detail || 'Error de conexión' });
    }
});
exports.getTiendaNubeStock = getTiendaNubeStock;
// Totales de stock Tienda Nube (todos los productos, para las cards)
const getTiendaNubeStockTotals = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
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
        const detail = ((_b = (_a = error.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.description) || ((_d = (_c = error.response) === null || _c === void 0 ? void 0 : _c.data) === null || _d === void 0 ? void 0 : _d.message) || error.message;
        console.error('Error fetching TN stock totals:', ((_e = error.response) === null || _e === void 0 ? void 0 : _e.data) || error.message);
        res.status(500).json({ message: 'Error obteniendo totales de Tienda Nube', detail: detail || 'Error de conexión' });
    }
});
exports.getTiendaNubeStockTotals = getTiendaNubeStockTotals;
const getTiendaNubeOrders = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
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
            const hasExpressShipping = /\bexpress\b|\bexpr[eé]s\b/.test(expressBlob);
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
        console.error('Error fetching TN orders:', ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
    try {
        const authUser = req.user;
        if (!authUser || !['ADMIN', 'WAREHOUSE', 'DEPOSITO'].includes(authUser.role)) {
            return res.status(403).json({ message: 'Solo ADMIN o Depósito pueden emitir facturas' });
        }
        const orderIdsRaw = Array.isArray((_a = req.body) === null || _a === void 0 ? void 0 : _a.orderIds) ? req.body.orderIds : [];
        const orderIds = Array.from(new Set(orderIdsRaw.map((x) => String(x).trim()).filter(Boolean)));
        const cbteTipoFromBody = (_b = req.body) === null || _b === void 0 ? void 0 : _b.cbteTipo;
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
                const total = Number((_c = order === null || order === void 0 ? void 0 : order.total) !== null && _c !== void 0 ? _c : 0);
                if (!Number.isFinite(total) || total <= 0) {
                    results.push({ orderId: orderIdStr, status: 'error', message: 'La orden tiene total inválido para facturar' });
                    continue;
                }
                const customerName = ((_d = order === null || order === void 0 ? void 0 : order.customer) === null || _d === void 0 ? void 0 : _d.name)
                    || `${((_e = order === null || order === void 0 ? void 0 : order.customer) === null || _e === void 0 ? void 0 : _e.first_name) || ''} ${((_f = order === null || order === void 0 ? void 0 : order.customer) === null || _f === void 0 ? void 0 : _f.last_name) || ''}`.trim()
                    || (order === null || order === void 0 ? void 0 : order.contact_name)
                    || (order === null || order === void 0 ? void 0 : order.billing_name)
                    || 'Consumidor Final';
                const rawDoc = String((_k = (_h = (_g = order === null || order === void 0 ? void 0 : order.billing_address) === null || _g === void 0 ? void 0 : _g.doc_number) !== null && _h !== void 0 ? _h : (_j = order === null || order === void 0 ? void 0 : order.customer) === null || _j === void 0 ? void 0 : _j.doc_number) !== null && _k !== void 0 ? _k : '').replace(/\D/g, '');
                const maybeCuit = rawDoc.length >= 10 ? rawDoc : undefined;
                const condicionIvaRaw = (((_l = order === null || order === void 0 ? void 0 : order.billing_address) === null || _l === void 0 ? void 0 : _l.fiscal_regime)
                    || ((_m = order === null || order === void 0 ? void 0 : order.customer) === null || _m === void 0 ? void 0 : _m.fiscal_regime)
                    || ((_o = order === null || order === void 0 ? void 0 : order.customer) === null || _o === void 0 ? void 0 : _o.iva_condition)
                    || 'Consumidor Final').toString();
                const afipResult = yield emitirAfip({
                    id: `TN-${order.id}`,
                    date: (order === null || order === void 0 ? void 0 : order.created_at) || new Date().toISOString().slice(0, 10),
                    total,
                    customerId: `TN-${((_p = order === null || order === void 0 ? void 0 : order.customer) === null || _p === void 0 ? void 0 : _p.id) || order.id}`
                }, {
                    id: `TN-${((_q = order === null || order === void 0 ? void 0 : order.customer) === null || _q === void 0 ? void 0 : _q.id) || order.id}`,
                    businessName: customerName,
                    cuit: maybeCuit,
                    condicionIva: condicionIvaRaw
                }, forceCbteTipo);
                const invoiceId = (0, uuid_1.v4)();
                yield (0, db_1.execute)(`INSERT INTO external_invoices
           (id, source, external_order_id, order_number, customer_name, customer_cuit, customer_condicion_iva, total, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta)
           VALUES (?, 'TIENDANUBE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                    invoiceId,
                    String(order.id),
                    String((_r = order.number) !== null && _r !== void 0 ? _r : order.id),
                    customerName,
                    maybeCuit || null,
                    condicionIvaRaw || null,
                    total,
                    afipResult.cae,
                    afipResult.caeFchVto || null,
                    afipResult.puntoVta,
                    afipResult.cbteTipo,
                    afipResult.cbteDesde,
                    afipResult.cbteHasta
                ]);
                results.push({
                    orderId: String(order.id),
                    status: 'invoiced',
                    invoiceId,
                    cae: afipResult.cae,
                    cbteTipo: afipResult.cbteTipo,
                    cbteDesde: afipResult.cbteDesde,
                    cbteHasta: afipResult.cbteHasta
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
    var _a, _b, _c, _d, _e, _f, _g, _h;
    try {
        const authUser = req.user;
        if (!authUser || !['ADMIN', 'WAREHOUSE', 'DEPOSITO'].includes(authUser.role)) {
            return res.status(403).json({ message: 'Solo ADMIN o Depósito pueden emitir facturas' });
        }
        const orderIdsRaw = Array.isArray((_a = req.body) === null || _a === void 0 ? void 0 : _a.orderIds) ? req.body.orderIds : [];
        const orderIds = Array.from(new Set(orderIdsRaw.map((x) => String(x).trim()).filter(Boolean)));
        const cbteTipoFromBody = (_b = req.body) === null || _b === void 0 ? void 0 : _b.cbteTipo;
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
                const total = Number((_c = order === null || order === void 0 ? void 0 : order.total_amount) !== null && _c !== void 0 ? _c : 0);
                if (!Number.isFinite(total) || total <= 0) {
                    results.push({ orderId: orderIdStr, status: 'error', message: 'La orden tiene total inválido para facturar' });
                    continue;
                }
                const buyerFirst = (((_d = order === null || order === void 0 ? void 0 : order.buyer) === null || _d === void 0 ? void 0 : _d.first_name) || '').toString().trim();
                const buyerLast = (((_e = order === null || order === void 0 ? void 0 : order.buyer) === null || _e === void 0 ? void 0 : _e.last_name) || '').toString().trim();
                const customerName = `${buyerFirst} ${buyerLast}`.trim()
                    || (((_f = order === null || order === void 0 ? void 0 : order.buyer) === null || _f === void 0 ? void 0 : _f.nickname) || '').toString().trim()
                    || 'Consumidor Final';
                const afipResult = yield emitirAfip({
                    id: `ML-${order.id}`,
                    date: (order === null || order === void 0 ? void 0 : order.date_created) || new Date().toISOString().slice(0, 10),
                    total,
                    customerId: `ML-${((_g = order === null || order === void 0 ? void 0 : order.buyer) === null || _g === void 0 ? void 0 : _g.id) || order.id}`
                }, {
                    id: `ML-${((_h = order === null || order === void 0 ? void 0 : order.buyer) === null || _h === void 0 ? void 0 : _h.id) || order.id}`,
                    businessName: customerName,
                    cuit: undefined,
                    condicionIva: 'Consumidor Final'
                }, forceCbteTipo);
                const invoiceId = (0, uuid_1.v4)();
                yield (0, db_1.execute)(`INSERT INTO external_invoices
           (id, source, external_order_id, order_number, customer_name, customer_cuit, customer_condicion_iva, total, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta)
           VALUES (?, 'MERCADOLIBRE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                    invoiceId,
                    String(order.id),
                    String(order.id),
                    customerName,
                    null,
                    'Consumidor Final',
                    total,
                    afipResult.cae,
                    afipResult.caeFchVto || null,
                    afipResult.puntoVta,
                    afipResult.cbteTipo,
                    afipResult.cbteDesde,
                    afipResult.cbteHasta
                ]);
                results.push({
                    orderId: String(order.id),
                    status: 'invoiced',
                    invoiceId,
                    cae: afipResult.cae,
                    cbteTipo: afipResult.cbteTipo,
                    cbteDesde: afipResult.cbteDesde,
                    cbteHasta: afipResult.cbteHasta
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
    var _a, _b, _c;
    try {
        const authUser = req.user;
        if (!authUser || !['ADMIN', 'WAREHOUSE', 'DEPOSITO'].includes(authUser.role)) {
            return res.status(403).json({ message: 'Sin permisos para ver historial de facturación externa' });
        }
        const sourceRaw = String(((_a = req.query) === null || _a === void 0 ? void 0 : _a.source) || '').trim().toUpperCase();
        const source = sourceRaw === 'TIENDANUBE' || sourceRaw === 'MERCADOLIBRE' ? sourceRaw : '';
        const limitNum = Math.min(500, Math.max(1, parseInt(String(((_b = req.query) === null || _b === void 0 ? void 0 : _b.limit) || '50'), 10) || 50));
        const offsetNum = Math.max(0, parseInt(String(((_c = req.query) === null || _c === void 0 ? void 0 : _c.offset) || '0'), 10) || 0);
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
    var _a, _b, _c;
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
            if (((_a = first === null || first === void 0 ? void 0 : first.response) === null || _a === void 0 ? void 0 : _a.status) === 400 && baseQs.includes('sort_fields')) {
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
        const errData = (_b = error.response) === null || _b === void 0 ? void 0 : _b.data;
        console.error('[ML Questions]', errData || error.message);
        const msg = (typeof (errData === null || errData === void 0 ? void 0 : errData.message) === 'string' && errData.message) ||
            (typeof (errData === null || errData === void 0 ? void 0 : errData.error) === 'string' && errData.error) ||
            error.message ||
            'Error al obtener preguntas de Mercado Libre';
        res.status(((_c = error.response) === null || _c === void 0 ? void 0 : _c.status) || 500).json({ message: msg });
    }
});
exports.getMercadoLibreQuestions = getMercadoLibreQuestions;
// Obtener órdenes de Mercado Libre
const getMercadoLibreOrders = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
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
                var _a, _b, _c;
                const ship = order.shipping || order.shipment;
                if (ship === null || ship === void 0 ? void 0 : ship.id)
                    return ship.id;
                try {
                    const det = yield axios_1.default.get(`https://api.mercadolibre.com/orders/${order.id}`, {
                        headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
                    });
                    const s = ((_a = det.data) === null || _a === void 0 ? void 0 : _a.shipping) || ((_b = det.data) === null || _b === void 0 ? void 0 : _b.shipment);
                    return (_c = s === null || s === void 0 ? void 0 : s.id) !== null && _c !== void 0 ? _c : null;
                }
                catch (_d) {
                    return null;
                }
            });
            const getShipmentStatus = (shipmentId) => __awaiter(void 0, void 0, void 0, function* () {
                var _a, _b, _c, _d;
                try {
                    const res = yield axios_1.default.get(`https://api.mercadolibre.com/shipments/${shipmentId}`, {
                        headers: authHeader
                    });
                    const data = res.data || {};
                    const st = ((_b = (_a = data.status) !== null && _a !== void 0 ? _a : data.substatus) !== null && _b !== void 0 ? _b : '').toString().trim().toLowerCase();
                    return st || null;
                }
                catch (_e) {
                    try {
                        const res = yield axios_1.default.get(`https://api.mercadolibre.com/marketplace/shipments/${shipmentId}`, {
                            headers: authHeader
                        });
                        const data = res.data || {};
                        const st = ((_d = (_c = data.status) !== null && _c !== void 0 ? _c : data.substatus) !== null && _d !== void 0 ? _d : '').toString().trim().toLowerCase();
                        return st || null;
                    }
                    catch (_f) {
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
            // Agrupar misma compra: mismo comprador + misma fecha/hora (al minuto) = una sola fila
            const groupKey = (o) => {
                var _a, _b;
                const buyerId = (_b = (_a = o.buyer) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : '';
                const dateStr = (o.date_created || '').toString();
                const toMinute = dateStr.slice(0, 16);
                return `${buyerId}-${toMinute}`;
            };
            const groups = new Map();
            for (const o of ordersPorEnviar) {
                const key = groupKey(o);
                if (!groups.has(key))
                    groups.set(key, []);
                groups.get(key).push(o);
            }
            const groupedOrders = Array.from(groups.values()).map((group) => {
                const first = group[0];
                const orderIds = group.map((o) => o.id);
                const allItems = group.flatMap((o) => o.order_items || []);
                const merged = Object.assign(Object.assign({}, first), { order_ids: orderIds, order_items: allItems });
                merged._shipment_status = first._shipment_status;
                return merged;
            });
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
            let url = `https://api.mercadolibre.com/orders/search?seller=${mlToken.user_id}&offset=${offsetNum}&limit=${limitNum}&sort=date_desc`;
            if (status)
                url += `&order.status=${status}`;
            if (date_from)
                url += `&order.date_created.from=${date_from}T00:00:00.000-03:00`;
            if (date_to)
                url += `&order.date_created.to=${date_to}T23:59:59.999-03:00`;
            const ordersRes = yield axios_1.default.get(url, {
                headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
            });
            const raw = ordersRes.data.results || [];
            total = (_b = (_a = ordersRes.data.paging) === null || _a === void 0 ? void 0 : _a.total) !== null && _b !== void 0 ? _b : raw.length;
            orders = raw.map(mapOrder);
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
        console.error('Error fetching ML orders:', ((_c = error.response) === null || _c === void 0 ? void 0 : _c.data) || error.message);
        res.status(500).json({ message: 'Error obteniendo órdenes de Mercado Libre', error: error.message });
    }
});
exports.getMercadoLibreOrders = getMercadoLibreOrders;
// Totales de stock Mercado Libre (todas las publicaciones, para las cards)
const getMercadoLibreStockTotals = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
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
                    if ((_a = item.variations) === null || _a === void 0 ? void 0 : _a.length) {
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
        console.error('Error fetching ML stock totals:', ((_b = error.response) === null || _b === void 0 ? void 0 : _b.data) || error.message);
        res.status(500).json({ message: 'Error obteniendo totales de Mercado Libre', error: error.message });
    }
});
exports.getMercadoLibreStockTotals = getMercadoLibreStockTotals;
// Obtener stock de Mercado Libre
/** Normaliza título para agrupar: quita espacios de más y unifica. */
function mlNormalizeTitle(title) {
    return (title || '').trim().replace(/\s+/g, ' ');
}
/** Extrae título base para agrupar: quita las últimas 1–2 palabras (talle y opcionalmente color). */
function mlBaseTitle(title) {
    let t = mlNormalizeTitle(title);
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
/** Quita sufijos de numeración de publicación (ej. "... Negro 1", "... #2", "... N° 3"). */
function mlStripTrailingPublicationIndex(title) {
    return (title || '')
        .replace(/\s*(?:#|N°|Nº)?\s*\d{1,2}\s*$/i, '')
        .trim();
}
/** Extrae color y talle del final del título (ej. "... Blanco G" -> color: Blanco, size: G). */
function mlColorSizeFromTitle(title) {
    let t = mlNormalizeTitle(title);
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
const getMercadoLibreStock = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
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
                    let itemSku = ((_b = (_a = item.seller_sku) !== null && _a !== void 0 ? _a : item.seller_custom_field) !== null && _b !== void 0 ? _b : '').toString().trim();
                    if (!itemSku && Array.isArray(item.attributes)) {
                        const skuAttr = item.attributes.find((a) => (a.id || '').toString().toUpperCase() === 'SELLER_SKU');
                        if (skuAttr)
                            itemSku = ((_d = (_c = skuAttr.value_name) !== null && _c !== void 0 ? _c : skuAttr.value) !== null && _d !== void 0 ? _d : '').toString().trim();
                    }
                    if (!itemSku && item.variations && item.variations.length === 1) {
                        const v0 = item.variations[0];
                        const skuAttr = Array.isArray(v0.attributes) && v0.attributes.find((a) => (a.id || '').toString().toUpperCase() === 'SELLER_SKU');
                        itemSku = (skuAttr ? ((_f = (_e = skuAttr.value_name) !== null && _e !== void 0 ? _e : skuAttr.value) !== null && _f !== void 0 ? _f : '') : ((_h = (_g = v0.seller_sku) !== null && _g !== void 0 ? _g : v0.seller_custom_field) !== null && _h !== void 0 ? _h : '')).toString().trim();
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
            total: (_k = (_j = itemsRes.data.paging) === null || _j === void 0 ? void 0 : _j.total) !== null && _k !== void 0 ? _k : items.length,
            offset: parseInt(offset),
            limit: parseInt(limit)
        });
    }
    catch (error) {
        console.error('Error fetching ML stock:', ((_l = error.response) === null || _l === void 0 ? void 0 : _l.data) || error.message);
        res.status(500).json({ message: 'Error obteniendo stock de Mercado Libre', error: error.message });
    }
});
exports.getMercadoLibreStock = getMercadoLibreStock;
// Obtener variaciones de un ítem de Mercado Libre por ID (para vincular por ID padre)
const getMercadoLibreItemVariations = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v;
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
            catch (_w) {
                // probar siguiente candidato
            }
        }
        // Si no se encontró como item directo, intentar tratarlo como product/catalog ID (/p/MLA...).
        if (!item || item.error) {
            catalogItemCandidates = yield resolveMercadoLibreCatalogProductItems(String(req.params.itemId || ''), mlToken.access_token);
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
                catch (_x) {
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
                catch (_y) {
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
        // Caso UP (MLAU...): devolver TODAS las variantes de todos los items del user_product_id.
        if ((shouldResolveAsUserProduct && userProductItemCandidates.length > 0) || userProductItemCandidates.length > 1) {
            const byVariationId = {};
            for (const candidate of userProductItemCandidates.slice(0, 120)) {
                try {
                    const itemRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${candidate}?include_attributes=all`, {
                        headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
                    });
                    const it = itemRes === null || itemRes === void 0 ? void 0 : itemRes.data;
                    if (!it || it.error)
                        continue;
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
                            byVariationId[String(v.id)] = {
                                variationId: String(v.id),
                                sku,
                                color,
                                size,
                                stock: v.available_quantity || 0
                            };
                        }
                    }
                    else {
                        const attrs = Array.isArray(it.attributes) ? it.attributes : [];
                        const skuAttr = attrs.find((a) => ((a === null || a === void 0 ? void 0 : a.id) || '').toString().toUpperCase() === 'SELLER_SKU');
                        const sku = ((_f = (_e = it.seller_sku) !== null && _e !== void 0 ? _e : it.seller_custom_field) !== null && _f !== void 0 ? _f : (skuAttr ? ((_h = (_g = skuAttr.value_name) !== null && _g !== void 0 ? _g : skuAttr.value) !== null && _h !== void 0 ? _h : '') : '')).toString().trim();
                        const colorAttr = attrs.find((a) => ['COLOR', 'COLOUR', 'COR'].includes(((a === null || a === void 0 ? void 0 : a.id) || '').toString().toUpperCase()));
                        const sizeAttr = attrs.find((a) => ['SIZE', 'SIZE_TYPE', 'TALLE', 'TALLA'].includes(((a === null || a === void 0 ? void 0 : a.id) || '').toString().toUpperCase()));
                        const parsed = mlColorSizeFromTitle((it.title || '').toString().trim());
                        byVariationId[String(it.id)] = {
                            variationId: String(it.id),
                            sku,
                            color: (colorAttr ? ((_k = (_j = colorAttr.value_name) !== null && _j !== void 0 ? _j : colorAttr.value) !== null && _k !== void 0 ? _k : '') : parsed.color).toString().trim(),
                            size: (sizeAttr ? ((_m = (_l = sizeAttr.value_name) !== null && _l !== void 0 ? _l : sizeAttr.value) !== null && _m !== void 0 ? _m : '') : parsed.size).toString().trim(),
                            stock: it.available_quantity || 0
                        };
                    }
                }
                catch (_z) {
                    // ignorar ítem inválido y continuar
                }
            }
            const upVariations = Object.values(byVariationId);
            if (upVariations.length > 1) {
                return res.json({
                    variations: upVariations,
                    singleProduct: false,
                    itemId: item.id,
                    requestedItemId: String(req.params.itemId || ''),
                    resolvedItemId,
                    resolvedFromUserProduct: true,
                    debug: {
                        userProduct: userProductResolveDebug,
                        upCandidatesCount: userProductItemCandidates.length,
                        upVariationCount: upVariations.length
                    }
                });
            }
        }
        if (item.variations && item.variations.length > 0) {
            const variations = item.variations.map((v) => {
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
                    color,
                    size,
                    stock: v.available_quantity || 0
                };
            });
            return res.json({ variations, singleProduct: false, itemId: item.id, requestedItemId: String(req.params.itemId || ''), resolvedItemId });
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
                catch (_0) {
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
        // Caso "una publicación por variante" sin catálogo explícito:
        // buscar publicaciones hermanas del mismo vendedor por título base.
        if (!item.variations || item.variations.length === 0) {
            const baseTitle = mlBaseTitle((item.title || '').toString().trim());
            const baseTitleLoose = mlStripTrailingPublicationIndex(baseTitle);
            if (baseTitle) {
                const searchRes = yield axios_1.default.get(`https://api.mercadolibre.com/users/${mlToken.user_id}/items/search`, {
                    headers: { 'Authorization': `Bearer ${mlToken.access_token}` },
                    params: { q: baseTitleLoose || baseTitle, limit: 50, offset: 0 },
                    validateStatus: () => true
                });
                const siblingIds = searchRes.status === 200 && Array.isArray((_o = searchRes.data) === null || _o === void 0 ? void 0 : _o.results)
                    ? searchRes.data.results.map((x) => String(x || '').trim()).filter(Boolean)
                    : [];
                const uniqueSiblingIds = Array.from(new Set(siblingIds)).slice(0, 50);
                if (uniqueSiblingIds.length > 1) {
                    const siblings = yield Promise.all(uniqueSiblingIds.map((sid) => __awaiter(void 0, void 0, void 0, function* () {
                        try {
                            const r = yield axios_1.default.get(`https://api.mercadolibre.com/items/${sid}?include_attributes=all`, {
                                headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
                            });
                            return r.data;
                        }
                        catch (_a) {
                            return null;
                        }
                    })));
                    const siblingVariations = (siblings || [])
                        .filter((it) => it && !it.error && (!it.variations || it.variations.length === 0))
                        .filter((it) => {
                        const siblingBase = mlBaseTitle((it.title || '').toString().trim());
                        const siblingLoose = mlStripTrailingPublicationIndex(siblingBase);
                        return siblingBase === baseTitle || (baseTitleLoose && siblingLoose === baseTitleLoose);
                    })
                        .map((it) => {
                        var _a, _b, _c, _d, _e, _f, _g, _h;
                        const attrs = Array.isArray(it.attributes) ? it.attributes : [];
                        const skuAttr = attrs.find((a) => ((a === null || a === void 0 ? void 0 : a.id) || '').toString().toUpperCase() === 'SELLER_SKU');
                        const sku = ((_b = (_a = it.seller_sku) !== null && _a !== void 0 ? _a : it.seller_custom_field) !== null && _b !== void 0 ? _b : (skuAttr ? ((_d = (_c = skuAttr.value_name) !== null && _c !== void 0 ? _c : skuAttr.value) !== null && _d !== void 0 ? _d : '') : '')).toString().trim();
                        const colorAttr = attrs.find((a) => ['COLOR', 'COLOUR', 'COR'].includes(((a === null || a === void 0 ? void 0 : a.id) || '').toString().toUpperCase()));
                        const sizeAttr = attrs.find((a) => ['SIZE', 'SIZE_TYPE', 'TALLE', 'TALLA'].includes(((a === null || a === void 0 ? void 0 : a.id) || '').toString().toUpperCase()));
                        const parsed = mlColorSizeFromTitle((it.title || '').toString().trim());
                        return {
                            variationId: it.id,
                            sku,
                            color: (colorAttr ? ((_f = (_e = colorAttr.value_name) !== null && _e !== void 0 ? _e : colorAttr.value) !== null && _f !== void 0 ? _f : '') : parsed.color).toString().trim(),
                            size: (sizeAttr ? ((_h = (_g = sizeAttr.value_name) !== null && _g !== void 0 ? _g : sizeAttr.value) !== null && _h !== void 0 ? _h : '') : parsed.size).toString().trim(),
                            stock: it.available_quantity || 0
                        };
                    });
                    if (siblingVariations.length > 1) {
                        return res.json({
                            variations: siblingVariations,
                            singleProduct: false,
                            itemId: item.id,
                            requestedItemId: String(req.params.itemId || ''),
                            resolvedItemId,
                            resolvedFromSiblingSearch: true
                        });
                    }
                }
            }
        }
        // Sin variaciones: producto único
        const parsed = mlColorSizeFromTitle((item.title || '').toString().trim());
        let singleSku = ((_q = (_p = item.seller_sku) !== null && _p !== void 0 ? _p : item.seller_custom_field) !== null && _q !== void 0 ? _q : '').toString().trim();
        if (!singleSku && Array.isArray(item.attributes)) {
            const skuAttr = item.attributes.find((a) => ((a === null || a === void 0 ? void 0 : a.id) || '').toString().toUpperCase() === 'SELLER_SKU');
            singleSku = (skuAttr ? ((_s = (_r = skuAttr.value_name) !== null && _r !== void 0 ? _r : skuAttr.value) !== null && _s !== void 0 ? _s : '') : '').toString().trim();
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
        const status = (_t = error.response) === null || _t === void 0 ? void 0 : _t.status;
        const detail = ((_v = (_u = error.response) === null || _u === void 0 ? void 0 : _u.data) === null || _v === void 0 ? void 0 : _v.message) || error.message;
        console.error('Error fetching ML item variations:', detail);
        res.status(status === 404 ? 404 : 500).json({ message: 'Error obteniendo variaciones de Mercado Libre', detail });
    }
});
exports.getMercadoLibreItemVariations = getMercadoLibreItemVariations;
// Obtener variantes de un producto de Tienda Nube por ID (para vincular por ID padre)
const getTiendaNubeProductVariants = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
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
        const detail = ((_b = (_a = error.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.description) || ((_d = (_c = error.response) === null || _c === void 0 ? void 0 : _c.data) === null || _d === void 0 ? void 0 : _d.message) || error.message;
        console.error('Error fetching TN product variants:', detail);
        res.status(500).json({ message: 'Error obteniendo variantes de Tienda Nube', detail });
    }
});
exports.getTiendaNubeProductVariants = getTiendaNubeProductVariants;
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2;
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
                let sku = ((_b = (_a = item.seller_sku) !== null && _a !== void 0 ? _a : item.seller_custom_field) !== null && _b !== void 0 ? _b : '').toString().trim();
                if (!sku && item.variations && item.variations.length === 1) {
                    const v0 = item.variations[0];
                    const skuAttr = Array.isArray(v0.attributes) && v0.attributes.find((a) => (a.id || '').toString().toUpperCase() === 'SELLER_SKU');
                    sku = (skuAttr ? ((_d = (_c = skuAttr.value_name) !== null && _c !== void 0 ? _c : skuAttr.value) !== null && _d !== void 0 ? _d : '') : ((_f = (_e = v0.seller_sku) !== null && _e !== void 0 ? _e : v0.seller_custom_field) !== null && _f !== void 0 ? _f : '')).toString().trim();
                }
                if (!sku)
                    sku = `ML-${mlItemId}`;
                const { color, size } = mlColorSizeFromTitle((item.title || '').toString().trim());
                variations.push({
                    variationId: mlItemId,
                    sku,
                    color: color || 'Único',
                    size: size || 'U',
                    stock: (_g = item.available_quantity) !== null && _g !== void 0 ? _g : ((_k = (_j = (_h = item.variations) === null || _h === void 0 ? void 0 : _h[0]) === null || _j === void 0 ? void 0 : _j.available_quantity) !== null && _k !== void 0 ? _k : 0),
                    mlItemId
                });
            }
            const firstSku = ((_l = variations[0]) === null || _l === void 0 ? void 0 : _l.sku) || '';
            const baseSku = firstSku.includes('-') ? firstSku.split('-').slice(0, -2).join('-') || firstSku : (firstSku || `ML-${validItems[0].id}`);
            const existingBySku = yield (0, db_1.get)(`SELECT id FROM products WHERE sku = ?`, [baseSku]);
            if (existingBySku) {
                const del = yield (0, products_controller_1.deleteProductById)(existingBySku.id);
                if (!del.deleted && del.error === 'in_orders') {
                    return res.status(400).json({ message: 'No se puede reemplazar: el artículo ya está en pedidos.' });
                }
            }
            const productId = (0, uuid_1.v4)();
            yield (0, db_1.execute)(`INSERT INTO products (id, sku, name, category, base_price, description, mercado_libre_id) VALUES (?, ?, ?, ?, ?, ?, ?)`, [productId, baseSku, title, 'General', first.price || 0, ((_m = first.description) === null || _m === void 0 ? void 0 : _m.plain_text) || null, null]);
            let variantsCreated = 0;
            for (const v of variations) {
                const sizeCode = (v.size || 'U').toString().trim() || 'U';
                const colorCode = (v.color || 'Único').toString().trim() || 'Único';
                const sizeId = yield ensureSize(sizeCode);
                const colorId = yield ensureColor(colorCode);
                let productColorId = (_o = (yield (0, db_1.get)(`SELECT id FROM product_colors WHERE product_id = ? AND color_id = ?`, [productId, colorId]))) === null || _o === void 0 ? void 0 : _o.id;
                if (!productColorId) {
                    productColorId = (0, uuid_1.v4)();
                    yield (0, db_1.execute)(`INSERT INTO product_colors (id, product_id, color_id) VALUES (?, ?, ?)`, [productColorId, productId, colorId]);
                }
                const existingVariant = yield (0, db_1.get)(`SELECT id FROM product_variants WHERE product_color_id = ? AND size_id = ?`, [productColorId, sizeId]);
                if (existingVariant)
                    continue;
                const variantSku = v.sku || `${baseSku}-${sizeCode}-${colorCode}`;
                const variantId = (0, uuid_1.v4)();
                yield (0, db_1.execute)(`INSERT INTO product_variants (id, product_color_id, size_id, sku, mercado_libre_variant_id, mercado_libre_item_id) VALUES (?, ?, ?, ?, ?, ?)`, [variantId, productColorId, sizeId, variantSku, null, v.mlItemId]);
                yield (0, db_1.execute)(`INSERT INTO stocks (variant_id, stock) VALUES (?, ?) ON DUPLICATE KEY UPDATE stock = VALUES(stock)`, [variantId, v.stock]);
                variantsCreated++;
            }
            return res.status(201).json({
                productId,
                baseSku,
                name: title,
                variantsCreated,
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
            let sku = ((_q = (_p = item.seller_sku) !== null && _p !== void 0 ? _p : item.seller_custom_field) !== null && _q !== void 0 ? _q : '').toString().trim();
            if (!sku && item.variations && item.variations.length === 1) {
                const v0 = item.variations[0];
                const skuAttr = Array.isArray(v0.attributes) && v0.attributes.find((a) => (a.id || '').toString().toUpperCase() === 'SELLER_SKU');
                sku = (skuAttr ? ((_s = (_r = skuAttr.value_name) !== null && _r !== void 0 ? _r : skuAttr.value) !== null && _s !== void 0 ? _s : '') : ((_u = (_t = v0.seller_sku) !== null && _t !== void 0 ? _t : v0.seller_custom_field) !== null && _u !== void 0 ? _u : '')).toString().trim();
            }
            if (!sku)
                sku = ((_v = item.id) !== null && _v !== void 0 ? _v : itemIdToFetch).toString();
            variations = [{
                    variationId: item.id,
                    sku: sku || `ML-${item.id}`,
                    color: 'Único',
                    size: 'U',
                    stock: item.available_quantity || 0,
                    mlItemId: (item.id || '').toString()
                }];
        }
        const firstSku = ((_w = variations[0]) === null || _w === void 0 ? void 0 : _w.sku) || '';
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
        yield (0, db_1.execute)(`INSERT INTO products (id, sku, name, category, base_price, description, mercado_libre_id) VALUES (?, ?, ?, ?, ?, ?, ?)`, [productId, baseSku, title, 'General', item.price || 0, ((_x = item.description) === null || _x === void 0 ? void 0 : _x.plain_text) || null, itemIdToFetch]);
        let variantsCreated = 0;
        for (const v of variations) {
            const sizeCode = (v.size || 'U').toString().trim() || 'U';
            const colorCode = (v.color || 'Único').toString().trim() || 'Único';
            const sizeId = yield ensureSize(sizeCode);
            const colorId = yield ensureColor(colorCode);
            let productColorId = (_y = (yield (0, db_1.get)(`SELECT id FROM product_colors WHERE product_id = ? AND color_id = ?`, [productId, colorId]))) === null || _y === void 0 ? void 0 : _y.id;
            if (!productColorId) {
                productColorId = (0, uuid_1.v4)();
                yield (0, db_1.execute)(`INSERT INTO product_colors (id, product_id, color_id) VALUES (?, ?, ?)`, [productColorId, productId, colorId]);
            }
            const existingVariant = yield (0, db_1.get)(`SELECT id FROM product_variants WHERE product_color_id = ? AND size_id = ?`, [productColorId, sizeId]);
            if (existingVariant)
                continue;
            const variantSku = v.sku || `${baseSku}-${sizeCode}-${colorCode}`;
            const variantId = (0, uuid_1.v4)();
            const mlVariantId = v.variationId != null ? String(v.variationId) : null;
            const mlItemId = (_z = v.mlItemId) !== null && _z !== void 0 ? _z : null;
            yield (0, db_1.execute)(`INSERT INTO product_variants (id, product_color_id, size_id, sku, mercado_libre_variant_id, mercado_libre_item_id) VALUES (?, ?, ?, ?, ?, ?)`, [variantId, productColorId, sizeId, variantSku, mlVariantId, mlItemId]);
            yield (0, db_1.execute)(`INSERT INTO stocks (variant_id, stock) VALUES (?, ?) ON DUPLICATE KEY UPDATE stock = VALUES(stock)`, [variantId, v.stock]);
            variantsCreated++;
        }
        res.status(201).json({
            productId,
            baseSku,
            name: title,
            variantsCreated,
            message: 'Producto importado de Mercado Libre'
        });
    }
    catch (error) {
        const status = (_0 = error.response) === null || _0 === void 0 ? void 0 : _0.status;
        const code = error.code;
        const detail = ((_2 = (_1 = error.response) === null || _1 === void 0 ? void 0 : _1.data) === null || _2 === void 0 ? void 0 : _2.message) || error.message;
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
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
        const title = ((_g = (_f = (_d = (_b = (_a = p.name) === null || _a === void 0 ? void 0 : _a.es) !== null && _b !== void 0 ? _b : (_c = p.name) === null || _c === void 0 ? void 0 : _c.pt) !== null && _d !== void 0 ? _d : (_e = p.name) === null || _e === void 0 ? void 0 : _e.en) !== null && _f !== void 0 ? _f : p.name) !== null && _g !== void 0 ? _g : '').toString().trim() || 'Sin título';
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
        const baseSku = ((_j = (_h = variations[0]) === null || _h === void 0 ? void 0 : _h.sku) === null || _j === void 0 ? void 0 : _j.replace(/-[^-]+-[^-]+$/, '')) || `TN-${tnProductId}`;
        const productId = (0, uuid_1.v4)();
        yield (0, db_1.execute)(`INSERT INTO products (id, sku, name, category, base_price, description, tienda_nube_id) VALUES (?, ?, ?, ?, ?, ?, ?)`, [productId, baseSku, title, 'General', ((_k = variations[0]) === null || _k === void 0 ? void 0 : _k.stock) ? 0 : 0, null, String(tnProductId)]);
        let variantsCreated = 0;
        for (const v of variations) {
            const sizeId = yield ensureSize(v.size);
            const colorId = yield ensureColor(v.color);
            let productColorId = (_l = (yield (0, db_1.get)(`SELECT id FROM product_colors WHERE product_id = ? AND color_id = ?`, [productId, colorId]))) === null || _l === void 0 ? void 0 : _l.id;
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
        const detail = ((_o = (_m = error.response) === null || _m === void 0 ? void 0 : _m.data) === null || _o === void 0 ? void 0 : _o.description) || ((_q = (_p = error.response) === null || _p === void 0 ? void 0 : _p.data) === null || _q === void 0 ? void 0 : _q.message) || error.message;
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
    var _a, _b, _c, _d, _e;
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
        const rawLimit = (_b = (_a = req.body) === null || _a === void 0 ? void 0 : _a.limit) !== null && _b !== void 0 ? _b : (_c = req.query) === null || _c === void 0 ? void 0 : _c.limit;
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
        const detail = (_e = (_d = error === null || error === void 0 ? void 0 : error.response) === null || _d === void 0 ? void 0 : _d.data) !== null && _e !== void 0 ? _e : error === null || error === void 0 ? void 0 : error.message;
        console.error('processMLQuestionsAi:', detail);
        res.status(500).json({ message: (error === null || error === void 0 ? void 0 : error.message) || 'Error procesando preguntas', detail });
    }
});
exports.processMLQuestionsAi = processMLQuestionsAi;
/** Métricas por defecto para Product Ads (Mercado Ads API). */
const ML_PADS_METRICS_DEFAULT = 'clicks,prints,ctr,cost,cpc,acos,cvr,roas,sov,direct_amount,indirect_amount,total_amount,units_quantity,direct_units_quantity,indirect_units_quantity,advertising_items_quantity,direct_items_quantity,indirect_items_quantity';
/** Listado de anunciantes con acceso a Product Ads (PADS). */
const getMercadoLibreProductAdsAdvertisers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
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
            const detail = ((_a = r.data) === null || _a === void 0 ? void 0 : _a.message) || ((_c = (_b = r.data) === null || _b === void 0 ? void 0 : _b.cause) === null || _c === void 0 ? void 0 : _c.message) || ((_d = r.data) === null || _d === void 0 ? void 0 : _d.error) || r.statusText;
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
        console.error('getMercadoLibreProductAdsAdvertisers:', ((_e = error.response) === null || _e === void 0 ? void 0 : _e.data) || error.message);
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
    var _a, _b, _c, _d, _e, _f, _g;
    try {
        const mlToken = yield getValidMLToken();
        if (!mlToken) {
            return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
        }
        const siteId = (_a = req.query.site_id) === null || _a === void 0 ? void 0 : _a.trim();
        const advertiserId = (_b = req.query.advertiser_id) === null || _b === void 0 ? void 0 : _b.trim();
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
            const detail = ((_c = r.data) === null || _c === void 0 ? void 0 : _c.message) || ((_e = (_d = r.data) === null || _d === void 0 ? void 0 : _d.cause) === null || _e === void 0 ? void 0 : _e.message) || ((_f = r.data) === null || _f === void 0 ? void 0 : _f.error) || r.statusText;
            return res.status(r.status >= 400 && r.status < 500 ? r.status : 502).json({
                message: 'Error obteniendo campañas de Product Ads',
                detail
            });
        }
        res.json(r.data);
    }
    catch (error) {
        console.error('getMercadoLibreProductAdsCampaigns:', ((_g = error.response) === null || _g === void 0 ? void 0 : _g.data) || error.message);
        res.status(500).json({ message: 'Error obteniendo campañas de Product Ads', error: error.message });
    }
});
exports.getMercadoLibreProductAdsCampaigns = getMercadoLibreProductAdsCampaigns;
/** Anuncios por publicación con métricas (proxy). Requiere site_id y advertiser_id. */
const getMercadoLibreProductAdsAds = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g;
    try {
        const mlToken = yield getValidMLToken();
        if (!mlToken) {
            return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
        }
        const siteId = (_a = req.query.site_id) === null || _a === void 0 ? void 0 : _a.trim();
        const advertiserId = (_b = req.query.advertiser_id) === null || _b === void 0 ? void 0 : _b.trim();
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
            const detail = ((_c = r.data) === null || _c === void 0 ? void 0 : _c.message) || ((_e = (_d = r.data) === null || _d === void 0 ? void 0 : _d.cause) === null || _e === void 0 ? void 0 : _e.message) || ((_f = r.data) === null || _f === void 0 ? void 0 : _f.error) || r.statusText;
            return res.status(r.status >= 400 && r.status < 500 ? r.status : 502).json({
                message: 'Error obteniendo anuncios de Product Ads',
                detail
            });
        }
        res.json(r.data);
    }
    catch (error) {
        console.error('getMercadoLibreProductAdsAds:', ((_g = error.response) === null || _g === void 0 ? void 0 : _g.data) || error.message);
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
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
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
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
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
    var _a, _b, _c, _d, _e;
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
            const detail = ((_a = r.data) === null || _a === void 0 ? void 0 : _a.message) || ((_c = (_b = r.data) === null || _b === void 0 ? void 0 : _b.cause) === null || _c === void 0 ? void 0 : _c.message) || ((_d = r.data) === null || _d === void 0 ? void 0 : _d.error) || r.statusText;
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
        console.error('getMercadoLibreBrandAdsAdvertisers:', ((_e = error.response) === null || _e === void 0 ? void 0 : _e.data) || error.message);
        res.status(500).json({ message: 'Error consultando Brand Ads', error: error.message });
    }
});
exports.getMercadoLibreBrandAdsAdvertisers = getMercadoLibreBrandAdsAdvertisers;
/**
 * Campañas Brand Ads con métricas por fila + resumen global del anunciante (misma API).
 * Query: advertiser_id, date_from, date_to, limit, offset
 */
const getMercadoLibreBrandAdsCampaigns = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
    try {
        const mlToken = yield getValidMLToken();
        if (!mlToken) {
            return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
        }
        const advertiserId = (_a = req.query.advertiser_id) === null || _a === void 0 ? void 0 : _a.trim();
        const dateFrom = (_b = req.query.date_from) === null || _b === void 0 ? void 0 : _b.trim();
        const dateTo = (_c = req.query.date_to) === null || _c === void 0 ? void 0 : _c.trim();
        const limit = Math.min(Math.max(parseInt(String((_d = req.query.limit) !== null && _d !== void 0 ? _d : '50'), 10) || 50, 1), 100);
        const offset = Math.max(parseInt(String((_e = req.query.offset) !== null && _e !== void 0 ? _e : '0'), 10) || 0, 0);
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
            const detail = ((_f = listR.data) === null || _f === void 0 ? void 0 : _f.message) || ((_h = (_g = listR.data) === null || _g === void 0 ? void 0 : _g.cause) === null || _h === void 0 ? void 0 : _h.message) || ((_j = listR.data) === null || _j === void 0 ? void 0 : _j.error) || listR.statusText;
            return res.status(listR.status >= 400 && listR.status < 500 ? listR.status : 502).json({
                message: 'Error obteniendo campañas Brand Ads',
                detail
            });
        }
        const rawCampaigns = Array.isArray((_k = listR.data) === null || _k === void 0 ? void 0 : _k.campaigns) ? listR.data.campaigns : [];
        const paging = ((_l = listR.data) === null || _l === void 0 ? void 0 : _l.paging) || { total: rawCampaigns.length, offset, limit };
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
            paging: { total: (_m = paging.total) !== null && _m !== void 0 ? _m : results.length, offset: (_o = paging.offset) !== null && _o !== void 0 ? _o : offset, limit: (_p = paging.limit) !== null && _p !== void 0 ? _p : limit },
            results,
            metrics_summary: metricsSummary
        });
    }
    catch (error) {
        console.error('getMercadoLibreBrandAdsCampaigns:', ((_q = error.response) === null || _q === void 0 ? void 0 : _q.data) || error.message);
        res.status(500).json({ message: 'Error obteniendo campañas Brand Ads', error: error.message });
    }
});
exports.getMercadoLibreBrandAdsCampaigns = getMercadoLibreBrandAdsCampaigns;
/** Anunciantes con acceso a Display Ads (DISPLAY). */
const getMercadoLibreDisplayAdsAdvertisers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
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
            const detail = ((_a = r.data) === null || _a === void 0 ? void 0 : _a.message) || ((_c = (_b = r.data) === null || _b === void 0 ? void 0 : _b.cause) === null || _c === void 0 ? void 0 : _c.message) || ((_d = r.data) === null || _d === void 0 ? void 0 : _d.error) || r.statusText;
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
        console.error('getMercadoLibreDisplayAdsAdvertisers:', ((_e = error.response) === null || _e === void 0 ? void 0 : _e.data) || error.message);
        res.status(500).json({ message: 'Error consultando Display Ads', error: error.message });
    }
});
exports.getMercadoLibreDisplayAdsAdvertisers = getMercadoLibreDisplayAdsAdvertisers;
function fetchDisplayCampaignMetricsRaw(accessToken, advertiserId, campaignId, dateFrom, dateTo) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
    try {
        const mlToken = yield getValidMLToken();
        if (!mlToken) {
            return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
        }
        const advertiserId = (_a = req.query.advertiser_id) === null || _a === void 0 ? void 0 : _a.trim();
        const dateFrom = (_b = req.query.date_from) === null || _b === void 0 ? void 0 : _b.trim();
        const dateTo = (_c = req.query.date_to) === null || _c === void 0 ? void 0 : _c.trim();
        const limit = Math.min(Math.max(parseInt(String((_d = req.query.limit) !== null && _d !== void 0 ? _d : '50'), 10) || 50, 1), 100);
        const offset = Math.max(parseInt(String((_e = req.query.offset) !== null && _e !== void 0 ? _e : '0'), 10) || 0, 0);
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
                const detail = ((_f = listR.data) === null || _f === void 0 ? void 0 : _f.message) || ((_h = (_g = listR.data) === null || _g === void 0 ? void 0 : _g.cause) === null || _h === void 0 ? void 0 : _h.message) || ((_j = listR.data) === null || _j === void 0 ? void 0 : _j.error) || listR.statusText;
                return res.status(listR.status >= 400 && listR.status < 500 ? listR.status : 502).json({
                    message: 'Error obteniendo campañas Display Ads',
                    detail
                });
            }
            const batch = Array.isArray((_k = listR.data) === null || _k === void 0 ? void 0 : _k.results) ? listR.data.results : [];
            totalFromApi = (_q = (_o = (_m = (_l = listR.data) === null || _l === void 0 ? void 0 : _l.paging) === null || _m === void 0 ? void 0 : _m.total) !== null && _o !== void 0 ? _o : (_p = listR.data) === null || _p === void 0 ? void 0 : _p.total) !== null && _q !== void 0 ? _q : batch.length + listOffset;
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
        console.error('getMercadoLibreDisplayAdsCampaigns:', ((_r = error.response) === null || _r === void 0 ? void 0 : _r.data) || error.message);
        res.status(500).json({ message: 'Error obteniendo campañas Display Ads', error: error.message });
    }
});
exports.getMercadoLibreDisplayAdsCampaigns = getMercadoLibreDisplayAdsCampaigns;
