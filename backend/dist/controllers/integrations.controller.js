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
exports.saveMLAutoMessageConfig = exports.getMLAutoMessageConfig = exports.getMercadoLibreStock = exports.getMercadoLibreOrders = exports.getTiendaNubeOrders = exports.importStockFromMercadoLibre = exports.syncAllStockToMercadoLibre = exports.syncAllStockToTiendaNube = exports.handleMercadoLibreWebhook = exports.handleTiendaNubeWebhook = exports.syncProductsFromMercadoLibre = exports.debugMercadoLibreItem = exports.testMercadoLibreConnection = exports.disconnectIntegration = exports.normalizeSizesInTiendaNube = exports.syncProductsFromTiendaNube = exports.updateMercadoLibreStock = exports.handleTiendaNubeCallback = exports.getTiendaNubeAuthUrl = exports.handleMercadoLibreCallback = exports.getMercadoLibreAuthUrl = exports.getIntegrationStatus = void 0;
const axios_1 = __importDefault(require("axios"));
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
const ML_AUTH_URL = 'https://auth.mercadolibre.com.ar/authorization';
const ML_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const TN_AUTH_URL = 'https://www.tiendanube.com/apps/authorize';
const TN_TOKEN_URL = 'https://www.tiendanube.com/apps/authorize/token';
const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';
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
        const integrations = yield (0, db_1.query)('SELECT platform, updated_at FROM integrations');
        const status = {
            mercadolibre: integrations.find((i) => i.platform === 'mercadolibre') ? true : false,
            tiendanube: integrations.find((i) => i.platform === 'tiendanube') ? true : false,
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
    // https://www.tiendanube.com/apps/<app_id>/authorize?response_type=code&scope=write_products,read_products
    const redirectUri = process.env.TIENDA_NUBE_REDIRECT_URI || 'http://localhost:3010/api/integrations/tiendanube/callback';
    const url = `https://www.tiendanube.com/apps/${appId}/authorize?response_type=code&scope=write_products,read_products&redirect_uri=${encodeURIComponent(redirectUri)}`;
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
        // Registrar webhook para order/paid y descontar stock automáticamente al vender
        const backendUrl = (process.env.BACKEND_URL || process.env.API_URL || '').replace(/\/$/, '');
        if (backendUrl && backendUrl.startsWith('https://')) {
            const webhookUrl = `${backendUrl}/api/integrations/tiendanube/webhook`;
            try {
                yield axios_1.default.post(`https://api.tiendanube.com/v1/${user_id}/webhooks`, { event: 'order/paid', url: webhookUrl }, { headers: { 'Authentication': `bearer ${access_token}`, 'User-Agent': TN_USER_AGENT } });
                console.log('[TN] Webhook order/paid registrado:', webhookUrl);
            }
            catch (whErr) {
                const msg = ((_c = (_b = (_a = whErr.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.url) === null || _c === void 0 ? void 0 : _c[0]) || ((_f = (_e = (_d = whErr.response) === null || _d === void 0 ? void 0 : _d.data) === null || _e === void 0 ? void 0 : _e.event) === null || _f === void 0 ? void 0 : _f[0]) || whErr.message;
                console.warn('[TN] No se pudo registrar webhook (puede existir ya):', msg);
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
            const itemRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${itemId}`, {
                headers: { Authorization: `Bearer ${access_token}` }
            });
            const variations = itemRes.data.variations;
            let variationId = null;
            if (variations && variations.length > 0) {
                const targetVar = variations.find((v) => v.seller_custom_field === sku);
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x;
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
        let importedCount = 0;
        let updatedCount = 0;
        // Log array to return to frontend
        const logs = [];
        const log = (msg) => {
            console.log(msg);
            logs.push(msg);
        };
        while (hasMore) {
            try {
                const response = yield axios_1.default.get(`https://api.tiendanube.com/v1/${store_id}/products`, {
                    headers: {
                        'Authentication': `bearer ${access_token}`,
                        'User-Agent': TN_USER_AGENT
                    },
                    params: {
                        page,
                        per_page: 50 // Max allowed usually
                    }
                });
                const products = response.data;
                if (products.length === 0) {
                    hasMore = false;
                    break;
                }
                // Process each product
                for (const tnProduct of products) {
                    try {
                        log(`[Sync] Processing Product: ${tnProduct.name.es || tnProduct.name} (ID: ${tnProduct.id})`);
                        const sku = ((_b = (_a = tnProduct.variants) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.sku) || `TN-${tnProduct.id}`;
                        let existingProduct = yield (0, db_1.get)(`SELECT * FROM products WHERE tienda_nube_id = ?`, [tnProduct.id]);
                        if (!existingProduct && sku) {
                            existingProduct = yield (0, db_1.get)(`SELECT * FROM products WHERE sku = ?`, [sku]);
                        }
                        let productId = existingProduct === null || existingProduct === void 0 ? void 0 : existingProduct.id;
                        if (existingProduct) {
                            yield (0, db_1.execute)(`
                UPDATE products SET 
                name = ?, 
                tienda_nube_id = ?,
                description = COALESCE(?, description)
                WHERE id = ?
              `, [tnProduct.name.es || tnProduct.name.pt || tnProduct.name, tnProduct.id, ((_c = tnProduct.description) === null || _c === void 0 ? void 0 : _c.es) || '', productId]);
                            updatedCount++;
                        }
                        else {
                            productId = (0, uuid_1.v4)();
                            yield (0, db_1.execute)(`
                INSERT INTO products (id, sku, name, category, base_price, description, tienda_nube_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
              `, [
                                productId,
                                sku,
                                tnProduct.name.es || tnProduct.name.pt || tnProduct.name,
                                'General',
                                Number(((_e = (_d = tnProduct.variants) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.price) || 0),
                                ((_f = tnProduct.description) === null || _f === void 0 ? void 0 : _f.es) || '',
                                tnProduct.id
                            ]);
                            importedCount++;
                        }
                        // Atributos del producto en Tienda Nube: cada índice corresponde a variant.values[i]
                        // e.g. attributes: [{ es: "Color" }, { es: "Talle" }] -> values[0]=color, values[1]=talle
                        const productAttributes = tnProduct.attributes || [];
                        const isSizeAttr = (name) => /talle|talla|size|tamano|tamaño/i.test(name);
                        const isColorAttr = (name) => /color|colour|cor/i.test(name);
                        // Detectar si un valor parece ser un talle típico
                        const looksLikeSize = (val) => {
                            const v = val.trim().toUpperCase();
                            // Talles comunes: U, P, M, G, GG, XG, XXG, XXXG, S, L, XL, XXL, números
                            return /^(U|P|M|G|GG|XG|XXG|XXXG|S|L|XL|XXL|XXXL|\d+)$/i.test(v);
                        };
                        const processedVariantIds = [];
                        for (const variant of tnProduct.variants) {
                            try {
                                const values = variant.values || [];
                                log(`  [Variant] ID: ${variant.id}, SKU: ${variant.sku}, Stock: ${variant.stock}, Values: ${JSON.stringify(values)}`);
                                let sizeName = 'U';
                                let colorName = 'Único';
                                if (values.length > 0) {
                                    const sizeParts = [];
                                    const colorParts = [];
                                    for (let i = 0; i < values.length; i++) {
                                        const attr = productAttributes[i];
                                        const attrName = ((_g = (attr && (attr.es || attr.en || attr.pt || (typeof attr === 'string' ? attr : '')))) === null || _g === void 0 ? void 0 : _g.toString().trim()) || '';
                                        const val = ((_p = ((_o = (_l = (_j = (_h = values[i]) === null || _h === void 0 ? void 0 : _h.es) !== null && _j !== void 0 ? _j : (_k = values[i]) === null || _k === void 0 ? void 0 : _k.pt) !== null && _l !== void 0 ? _l : (_m = values[i]) === null || _m === void 0 ? void 0 : _m.en) !== null && _o !== void 0 ? _o : values[i])) === null || _p === void 0 ? void 0 : _p.toString().trim()) || '';
                                        if (!val)
                                            continue;
                                        if (isSizeAttr(attrName)) {
                                            sizeParts.push(val);
                                        }
                                        else if (isColorAttr(attrName)) {
                                            colorParts.push(val);
                                        }
                                        else {
                                            // Sin nombre de atributo reconocido: detectar por el valor
                                            if (looksLikeSize(val)) {
                                                sizeParts.push(val);
                                            }
                                            else {
                                                colorParts.push(val);
                                            }
                                        }
                                    }
                                    if (sizeParts.length > 0)
                                        sizeName = sizeParts.join(' ');
                                    if (colorParts.length > 0)
                                        colorName = colorParts.join(' ');
                                    // Si no se detectó nada, usar el primer valor como color y 'U' como talle
                                    if (sizeName === 'U' && colorName === 'Único' && values.length > 0) {
                                        const firstVal = ((_q = values[0]) === null || _q === void 0 ? void 0 : _q.es) || ((_r = values[0]) === null || _r === void 0 ? void 0 : _r.pt) || values[0];
                                        if (firstVal) {
                                            if (looksLikeSize(firstVal)) {
                                                sizeName = firstVal;
                                            }
                                            else {
                                                colorName = firstVal;
                                            }
                                        }
                                    }
                                }
                                let colorId = null;
                                let colorRow = yield (0, db_1.get)(`SELECT id FROM colors WHERE name = ?`, [colorName]);
                                if (!colorRow) {
                                    colorId = `c-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                                    let code = colorName.substring(0, 50).toUpperCase();
                                    try {
                                        yield (0, db_1.execute)(`INSERT INTO colors (id, name, code, hex) VALUES (?, ?, ?, ?)`, [colorId, colorName, code, '#000000']);
                                    }
                                    catch (e) {
                                        if (e.code === 'ER_DUP_ENTRY') {
                                            code = code.substring(0, 45) + Math.floor(Math.random() * 1000);
                                            try {
                                                yield (0, db_1.execute)(`INSERT INTO colors (id, name, code, hex) VALUES (?, ?, ?, ?)`, [colorId, colorName, code, '#000000']);
                                            }
                                            catch (e2) {
                                                console.error(`Failed to insert color ${colorName}`, e2);
                                            }
                                        }
                                        else if (e.code === 'ER_BAD_FIELD_ERROR') {
                                            yield (0, db_1.execute)(`INSERT INTO colors (id, name, code) VALUES (?, ?, ?)`, [colorId, colorName, code]);
                                        }
                                        else {
                                            throw e;
                                        }
                                    }
                                }
                                else {
                                    colorId = colorRow.id;
                                }
                                let sizeId = null;
                                const safeSizeCode = sizeName.substring(0, 100);
                                let sizeRow = yield (0, db_1.get)(`SELECT id FROM sizes WHERE size_code = ?`, [safeSizeCode]);
                                if (!sizeRow) {
                                    sizeId = `s-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                                    try {
                                        yield (0, db_1.execute)(`INSERT INTO sizes (id, size_code, name) VALUES (?, ?, ?)`, [sizeId, safeSizeCode, sizeName]);
                                    }
                                    catch (e) {
                                        if (e.code === 'ER_BAD_FIELD_ERROR') {
                                            yield (0, db_1.execute)(`INSERT INTO sizes (id, size_code) VALUES (?, ?)`, [sizeId, safeSizeCode]);
                                        }
                                        else if (e.code === 'ER_DUP_ENTRY') {
                                            const existing = yield (0, db_1.get)(`SELECT id FROM sizes WHERE size_code = ?`, [safeSizeCode]);
                                            sizeId = existing === null || existing === void 0 ? void 0 : existing.id;
                                        }
                                        else {
                                            throw e;
                                        }
                                    }
                                }
                                else {
                                    sizeId = sizeRow.id;
                                }
                                let productColorRow = yield (0, db_1.get)(`SELECT id FROM product_colors WHERE product_id = ? AND color_id = ?`, [productId, colorId]);
                                let productColorId = productColorRow === null || productColorRow === void 0 ? void 0 : productColorRow.id;
                                if (!productColorId) {
                                    productColorId = (0, uuid_1.v4)();
                                    yield (0, db_1.execute)(`INSERT INTO product_colors (id, product_id, color_id) VALUES (?, ?, ?)`, [productColorId, productId, colorId]);
                                }
                                let variantRow = yield (0, db_1.get)(`SELECT id FROM product_variants WHERE product_color_id = ? AND size_id = ?`, [productColorId, sizeId]);
                                let localVariantId = variantRow === null || variantRow === void 0 ? void 0 : variantRow.id;
                                if (!localVariantId) {
                                    localVariantId = (0, uuid_1.v4)();
                                    yield (0, db_1.execute)(`
                    INSERT INTO product_variants (id, product_color_id, size_id, tienda_nube_variant_id, sku) 
                    VALUES (?, ?, ?, ?, ?)
                  `, [localVariantId, productColorId, sizeId, variant.id, variant.sku || null]);
                                }
                                else {
                                    yield (0, db_1.execute)(`UPDATE product_variants SET tienda_nube_variant_id = ?, sku = ? WHERE id = ?`, [variant.id, variant.sku || null, localVariantId]);
                                }
                                processedVariantIds.push(localVariantId);
                                const stock = variant.stock !== null && variant.stock !== undefined ? Number(variant.stock) : 0;
                                yield (0, db_1.execute)(`
                  INSERT INTO stocks (variant_id, stock) VALUES (?, ?)
                  ON DUPLICATE KEY UPDATE stock = VALUES(stock)
                `, [localVariantId, stock]);
                                if (variant.sku) {
                                    (0, exports.updateMercadoLibreStock)(variant.sku, stock).catch(e => console.error(e));
                                }
                            }
                            catch (variantErr) {
                                log(`[ERROR] Variant ${variant.id}: ${((_t = (_s = variantErr === null || variantErr === void 0 ? void 0 : variantErr.response) === null || _s === void 0 ? void 0 : _s.data) === null || _t === void 0 ? void 0 : _t.message) || (variantErr === null || variantErr === void 0 ? void 0 : variantErr.message) || 'Error desconocido'}`);
                            }
                        }
                        if (processedVariantIds.length > 0 && productId) {
                            try {
                                yield (0, db_1.execute)(`
                  DELETE st FROM stocks st
                  JOIN product_variants pv ON st.variant_id = pv.id
                  JOIN product_colors pc ON pv.product_color_id = pc.id
                  WHERE pc.product_id = ? AND pv.id NOT IN (${processedVariantIds.map(() => '?').join(',')})
                `, [productId, ...processedVariantIds]);
                                yield (0, db_1.execute)(`
                  DELETE pv FROM product_variants pv
                  JOIN product_colors pc ON pv.product_color_id = pc.id
                  WHERE pc.product_id = ? AND pv.id NOT IN (${processedVariantIds.map(() => '?').join(',')})
                `, [productId, ...processedVariantIds]);
                                yield (0, db_1.execute)(`
                  DELETE pc FROM product_colors pc
                  LEFT JOIN product_variants pv ON pv.product_color_id = pc.id
                  WHERE pc.product_id = ? AND pv.id IS NULL
                `, [productId]);
                                log(`  [Cleanup] Eliminadas variantes locales no presentes en Tienda Nube para producto ${tnProduct.id}`);
                            }
                            catch (cleanupErr) {
                                log(`[ERROR] Cleanup producto ${tnProduct.id}: ${(cleanupErr === null || cleanupErr === void 0 ? void 0 : cleanupErr.message) || 'Error desconocido'}`);
                            }
                        }
                    }
                    catch (prodErr) {
                        log(`[ERROR] Product ${tnProduct === null || tnProduct === void 0 ? void 0 : tnProduct.id}: ${((_v = (_u = prodErr === null || prodErr === void 0 ? void 0 : prodErr.response) === null || _u === void 0 ? void 0 : _u.data) === null || _v === void 0 ? void 0 : _v.message) || (prodErr === null || prodErr === void 0 ? void 0 : prodErr.message) || 'Error desconocido'}`);
                    }
                }
                page++;
                // Safety break
                if (page > 50)
                    hasMore = false;
            }
            catch (error) {
                // If 404, likely means page out of range or end of list
                if (((_w = error.response) === null || _w === void 0 ? void 0 : _w.status) === 404) {
                    hasMore = false;
                }
                else {
                    throw error;
                }
            }
        }
        res.json({ message: 'Sincronización completada', imported: importedCount, updated: updatedCount, logs });
    }
    catch (error) {
        console.error('Error syncing products:', ((_x = error.response) === null || _x === void 0 ? void 0 : _x.data) || error.message);
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
            if (page > 100)
                hasMore = false;
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
        const itemRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${itemId}`, {
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
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
                // Continuar si hay más items
                const total = ((_a = searchRes.data.paging) === null || _a === void 0 ? void 0 : _a.total) || 0;
                if (offset >= total || results.length === 0)
                    break;
            } while (offset < 500); // Máximo 500 items para evitar timeout
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
                const multigetRes = yield axios_1.default.get(`https://api.mercadolibre.com/items?ids=${batch.join(',')}`, {
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
                            // Buscar SKU en múltiples campos posibles de ML
                            const mlSku = v.seller_custom_field
                                || v.seller_sku
                                || ((_f = (_e = v.attributes) === null || _e === void 0 ? void 0 : _e.find((a) => a.id === 'SELLER_SKU')) === null || _f === void 0 ? void 0 : _f.value_name)
                                || '';
                            // Extraer color y talle de attribute_combinations
                            const attrCombs = v.attribute_combinations || [];
                            const mlColor = ((_g = attrCombs.find((a) => a.id === 'COLOR')) === null || _g === void 0 ? void 0 : _g.value_name) || '';
                            const mlSize = ((_h = attrCombs.find((a) => a.id === 'SIZE')) === null || _h === void 0 ? void 0 : _h.value_name) || '';
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
                                yield (0, db_1.execute)(`UPDATE product_variants SET mercado_libre_variant_id = ? WHERE id = ?`, [v.id, row.variant_id]);
                                yield (0, db_1.execute)(`UPDATE products SET mercado_libre_id = COALESCE(?, mercado_libre_id) WHERE id = ?`, [mlItem.id, row.product_id]);
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
                            yield (0, db_1.execute)(`UPDATE products SET mercado_libre_id = ? WHERE id = ?`, [mlItem.id, prod.id]);
                            linkedProducts++;
                            logs.push(`  [OK] ${itemTitle} vinculado`);
                        }
                        else {
                            notFound++;
                            logs.push(`  [X] ${itemTitle} - no encontrado`);
                        }
                    }
                }
            }
            catch (e) {
                logs.push(`[ML Lote Error]: ${((_k = (_j = e === null || e === void 0 ? void 0 : e.response) === null || _j === void 0 ? void 0 : _j.data) === null || _k === void 0 ? void 0 : _k.message) || (e === null || e === void 0 ? void 0 : e.message) || 'Error'}`);
            }
        }
        logs.push(`\n========== RESUMEN ==========`);
        logs.push(`Publicaciones ML procesadas: ${items.length}`);
        logs.push(`Variantes vinculadas: ${linkedVariants}`);
        logs.push(`Productos vinculados (sin variantes): ${linkedProducts}`);
        logs.push(`No encontrados/Sin SKU: ${notFound}`);
        logs.push(``);
        logs.push(`NOTA: Si "No encontrados" es alto, verifica que:`);
        logs.push(`1. Las variantes en ML tengan el campo "SKU del vendedor" configurado`);
        logs.push(`2. Los SKUs en ML coincidan EXACTAMENTE con los de Tienda Nube`);
        logs.push(`3. Hayas importado primero los productos desde Tienda Nube`);
        res.json({
            message: 'Sincronización ML completada',
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
    var _a, _b, _c;
    try {
        const { event, store_id } = req.body;
        console.log(`[TN Webhook] Evento: ${event}, Store: ${store_id}`);
        // Verificar que el store_id coincide
        const integration = yield (0, db_1.get)(`SELECT store_id FROM integrations WHERE platform = 'tiendanube'`);
        if (!integration || integration.store_id !== (store_id === null || store_id === void 0 ? void 0 : store_id.toString())) {
            console.log('[TN Webhook] Store ID no coincide, ignorando');
            return res.status(200).json({ received: true, ignored: true });
        }
        // Procesar solo cuando la orden se paga (descontar stock una sola vez)
        if (event === 'order/paid') {
            const orderId = (_b = (_a = req.body.id) !== null && _a !== void 0 ? _a : req.body.order_id) !== null && _b !== void 0 ? _b : (_c = req.body.order) === null || _c === void 0 ? void 0 : _c.id;
            if (orderId)
                yield processTiendaNubeOrder(String(orderId));
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
    try {
        const integration = yield (0, db_1.get)(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);
        if (!(integration === null || integration === void 0 ? void 0 : integration.access_token))
            return;
        // Idempotencia: no descontar dos veces la misma orden (p. ej. si TN reenvía el webhook)
        const alreadyProcessed = yield (0, db_1.get)(`SELECT id FROM stock_movements WHERE movement_type = 'VENTA_TIENDA_NUBE' AND reference = ? LIMIT 1`, [`Orden TN: ${orderId}`]);
        if (alreadyProcessed) {
            console.log(`[TN Order] Orden ${orderId} ya procesada, omitiendo`);
            return;
        }
        const orderRes = yield axios_1.default.get(`https://api.tiendanube.com/v1/${integration.store_id}/orders/${orderId}`, {
            headers: {
                'Authentication': `bearer ${integration.access_token}`,
                'User-Agent': TN_USER_AGENT
            }
        });
        const order = orderRes.data;
        console.log(`[TN Order] Procesando orden ${orderId}, payment_status: ${order.payment_status}`);
        // Solo descontar cuando la venta está pagada
        if (order.payment_status !== 'paid') {
            console.log(`[TN Order] Orden ${orderId} no está pagada (${order.payment_status}), ignorando`);
            return;
        }
        const { updateVariantStock } = yield Promise.resolve().then(() => __importStar(require('./stock.controller')));
        for (const item of order.products || []) {
            const tnVariantId = item.variant_id;
            const quantity = item.quantity;
            const itemSku = (item.sku || item.variant_sku || '').toString().trim();
            let variant = null;
            if (tnVariantId) {
                variant = yield (0, db_1.get)(`SELECT pv.id, s.stock as current_stock
           FROM product_variants pv
           LEFT JOIN stocks s ON s.variant_id = pv.id
           WHERE pv.tienda_nube_variant_id = ?`, [tnVariantId]);
            }
            if (!(variant === null || variant === void 0 ? void 0 : variant.id) && itemSku) {
                variant = yield (0, db_1.get)(`SELECT pv.id, s.stock as current_stock
           FROM product_variants pv
           LEFT JOIN stocks s ON s.variant_id = pv.id
           WHERE pv.sku = ?`, [itemSku]);
            }
            if (!(variant === null || variant === void 0 ? void 0 : variant.id) && itemSku) {
                variant = yield (0, db_1.get)(`SELECT pv.id, s.stock as current_stock
           FROM product_variants pv
           LEFT JOIN stocks s ON s.variant_id = pv.id
           JOIN products p ON p.id = (SELECT product_id FROM product_colors WHERE id = pv.product_color_id)
           WHERE p.sku = ? OR pv.sku LIKE ?`, [itemSku, `${itemSku}%`]);
            }
            if (variant === null || variant === void 0 ? void 0 : variant.id) {
                const currentStock = variant.current_stock || 0;
                const newStock = Math.max(0, currentStock - quantity);
                yield updateVariantStock(variant.id, newStock, 'VENTA_TIENDA_NUBE', `Orden TN: ${orderId}`, false);
                console.log(`[TN Order] Descontado ${quantity} de variante ${variant.id}, stock: ${currentStock} -> ${newStock}`);
            }
            else {
                console.log(`[TN Order] Variante no encontrada para TN variant_id=${tnVariantId} sku=${itemSku}`);
            }
        }
    }
    catch (error) {
        console.error('[TN Order] Error procesando orden:', error.message);
    }
});
// Webhook de Mercado Libre para órdenes/ventas
const handleMercadoLibreWebhook = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { topic, resource, user_id } = req.body;
        console.log(`[ML Webhook] Topic: ${topic}, Resource: ${resource}`);
        // Verificar que el user_id coincide
        const integration = yield (0, db_1.get)(`SELECT user_id FROM integrations WHERE platform = 'mercadolibre'`);
        if (!integration || integration.user_id !== (user_id === null || user_id === void 0 ? void 0 : user_id.toString())) {
            console.log('[ML Webhook] User ID no coincide, ignorando');
            return res.status(200).json({ received: true, ignored: true });
        }
        // Procesar según el tipo de notificación
        if (topic === 'orders_v2') {
            const orderId = resource.replace('/orders/', '');
            yield processMercadoLibreOrder(orderId);
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
    var _a, _b;
    try {
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
            const mlVariationId = (_a = item.item) === null || _a === void 0 ? void 0 : _a.variation_id;
            const quantity = item.quantity;
            const itemSku = (((_b = item.item) === null || _b === void 0 ? void 0 : _b.sku) || item.sku || '').toString().trim();
            let variant = null;
            if (mlVariationId) {
                variant = yield (0, db_1.get)(`SELECT pv.id, s.stock as current_stock
           FROM product_variants pv
           LEFT JOIN stocks s ON s.variant_id = pv.id
           WHERE pv.mercado_libre_variant_id = ?`, [mlVariationId]);
            }
            if (!(variant === null || variant === void 0 ? void 0 : variant.id) && itemSku) {
                variant = yield (0, db_1.get)(`SELECT pv.id, s.stock as current_stock
           FROM product_variants pv
           LEFT JOIN stocks s ON s.variant_id = pv.id
           WHERE pv.sku = ?`, [itemSku]);
            }
            if (!(variant === null || variant === void 0 ? void 0 : variant.id) && itemSku) {
                variant = yield (0, db_1.get)(`SELECT pv.id, s.stock as current_stock
           FROM product_variants pv
           LEFT JOIN stocks s ON s.variant_id = pv.id
           JOIN product_colors pc ON pc.id = pv.product_color_id
           JOIN products p ON p.id = pc.product_id
           WHERE p.sku = ? OR pv.sku LIKE ?`, [itemSku, `${itemSku}%`]);
            }
            if (variant === null || variant === void 0 ? void 0 : variant.id) {
                const currentStock = variant.current_stock || 0;
                const newStock = Math.max(0, currentStock - quantity);
                yield updateVariantStock(variant.id, newStock, 'VENTA_MERCADO_LIBRE', `Orden ML: ${orderId}`, false);
                console.log(`[ML Order] Descontado ${quantity} de variante ${variant.id}, stock: ${currentStock} -> ${newStock}`);
            }
            else if (mlVariationId || itemSku) {
                console.log(`[ML Order] Variante no encontrada para ML variation_id=${mlVariationId} sku=${itemSku}`);
            }
        }
    }
    catch (error) {
        console.error('[ML Order] Error procesando orden:', error.message);
    }
});
// Enviar mensaje de agradecimiento al comprador de ML
const sendThankYouMessage = (orderId, order, accessToken) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h;
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
        console.error(`[ML Message] Error enviando mensaje para orden ${orderId}:`, ((_h = error.response) === null || _h === void 0 ? void 0 : _h.data) || error.message);
    }
});
// Sincronizar todo el stock local a Tienda Nube
const syncAllStockToTiendaNube = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const integration = yield (0, db_1.get)(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);
        if (!(integration === null || integration === void 0 ? void 0 : integration.access_token) || !(integration === null || integration === void 0 ? void 0 : integration.store_id)) {
            return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
        }
        const variants = yield (0, db_1.query)(`
      SELECT pv.id, pv.tienda_nube_variant_id, p.tienda_nube_id, s.stock, pv.sku
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
                yield axios_1.default.put(`https://api.tiendanube.com/v1/${integration.store_id}/products/${v.tienda_nube_id}/variants/${v.tienda_nube_variant_id}`, { stock: v.stock || 0 }, {
                    headers: {
                        'Authentication': `bearer ${integration.access_token}`,
                        'Content-Type': 'application/json',
                        'User-Agent': TN_USER_AGENT
                    }
                });
                updated++;
                logs.push(`[OK] ${v.sku}: ${v.stock || 0} unidades`);
            }
            catch (e) {
                errors++;
                logs.push(`[ERROR] ${v.sku}: ${((_b = (_a = e.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.description) || e.message}`);
            }
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
// Sincronizar stock de la app hacia Mercado Libre (app = fuente de verdad). Usa la misma lógica que updateMercadoLibreStockByVariant (subrecurso + fallback PUT item).
const syncAllStockToMercadoLibre = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { updateMercadoLibreStockByVariant } = yield Promise.resolve().then(() => __importStar(require('./stock.controller')));
        const variants = yield (0, db_1.query)(`
      SELECT pv.id, pv.mercado_libre_variant_id, p.mercado_libre_id, s.stock, pv.sku
      FROM product_variants pv
      JOIN product_colors pc ON pc.id = pv.product_color_id
      JOIN products p ON p.id = pc.product_id
      LEFT JOIN stocks s ON s.variant_id = pv.id
      WHERE pv.mercado_libre_variant_id IS NOT NULL AND p.mercado_libre_id IS NOT NULL
    `);
        let updated = 0;
        let errors = 0;
        const logs = [];
        for (const v of variants) {
            const ok = yield updateMercadoLibreStockByVariant(v.mercado_libre_id, v.mercado_libre_variant_id, v.stock || 0);
            if (ok) {
                updated++;
                logs.push(`[OK] ${v.sku}: ${v.stock || 0} unidades`);
            }
            else {
                errors++;
                logs.push(`[ERROR] ${v.sku}: no se pudo actualizar`);
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
// Opcional: importar stock desde Mercado Libre a la app (útil para alinear una vez o si ML fue actualizado fuera de la app)
const importStockFromMercadoLibre = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const mlToken = yield getValidMLToken();
        if (!mlToken) {
            return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
        }
        const { updateVariantStock } = yield Promise.resolve().then(() => __importStar(require('./stock.controller')));
        let updated = 0;
        let errors = 0;
        const logs = [];
        const limit = 50;
        let offset = 0;
        while (true) {
            const itemsRes = yield axios_1.default.get(`https://api.mercadolibre.com/users/${mlToken.user_id}/items/search?status=active&offset=${offset}&limit=${limit}`, { headers: { 'Authorization': `Bearer ${mlToken.access_token}` } });
            const itemIds = itemsRes.data.results || [];
            if (itemIds.length === 0)
                break;
            const batchSize = 10;
            for (let i = 0; i < itemIds.length; i += batchSize) {
                const batch = itemIds.slice(i, i + batchSize);
                const itemPromises = batch.map((itemId) => axios_1.default.get(`https://api.mercadolibre.com/items/${itemId}`, {
                    headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
                }).then(r => r.data).catch(() => null));
                const items = yield Promise.all(itemPromises);
                for (const item of items) {
                    if (!item)
                        continue;
                    if (item.variations && item.variations.length > 0) {
                        for (const v of item.variations) {
                            const mlQty = (_a = v.available_quantity) !== null && _a !== void 0 ? _a : 0;
                            const row = yield (0, db_1.get)(`SELECT pv.id as variant_id FROM product_variants pv
                 JOIN product_colors pc ON pc.id = pv.product_color_id
                 JOIN products p ON p.id = pc.product_id
                 WHERE p.mercado_libre_id = ? AND pv.mercado_libre_variant_id = ?`, [item.id, v.id]);
                            if (row === null || row === void 0 ? void 0 : row.variant_id) {
                                const ok = yield updateVariantStock(row.variant_id, mlQty, 'IMPORTACION_ML', 'Importación desde ML', false);
                                if (ok) {
                                    updated++;
                                    logs.push(`[OK] ${v.seller_custom_field || v.id}: ${mlQty}`);
                                }
                                else {
                                    errors++;
                                    logs.push(`[ERROR] ${v.seller_custom_field || v.id}`);
                                }
                            }
                        }
                    }
                    else {
                        const mlQty = (_b = item.available_quantity) !== null && _b !== void 0 ? _b : 0;
                        const variantRow = yield (0, db_1.get)(`SELECT pv.id as variant_id FROM product_variants pv
               JOIN product_colors pc ON pc.id = pv.product_color_id
               JOIN products p ON p.id = pc.product_id
               WHERE p.mercado_libre_id = ? LIMIT 1`, [item.id]);
                        if (variantRow === null || variantRow === void 0 ? void 0 : variantRow.variant_id) {
                            const ok = yield updateVariantStock(variantRow.variant_id, mlQty, 'IMPORTACION_ML', 'Importación desde ML', false);
                            if (ok) {
                                updated++;
                                logs.push(`[OK] ${item.id}: ${mlQty}`);
                            }
                            else {
                                errors++;
                                logs.push(`[ERROR] ${item.id}`);
                            }
                        }
                    }
                }
            }
            if (itemIds.length < limit)
                break;
            offset += limit;
        }
        res.json({
            message: 'Stock importado desde Mercado Libre',
            updated,
            errors,
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
            var _a, _b, _c;
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
            if (customerName === 'Sin nombre' && ((_a = order.shipping_address) === null || _a === void 0 ? void 0 : _a.name)) {
                customerName = order.shipping_address.name;
            }
            return {
                id: order.id,
                number: order.number,
                status: order.status,
                paymentStatus: order.payment_status,
                shippingStatus: order.shipping_status,
                total: order.total,
                currency: order.currency,
                customer: {
                    name: customerName,
                    email: ((_b = order.customer) === null || _b === void 0 ? void 0 : _b.email) || order.contact_email || '',
                    phone: ((_c = order.customer) === null || _c === void 0 ? void 0 : _c.phone) || order.contact_phone || ''
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
                    zipcode: order.shipping_address.zipcode
                } : null,
                createdAt: order.created_at,
                updatedAt: order.updated_at
            };
        });
        if (only_paid_pending_shipment === '1' || only_paid_pending_shipment === 'true') {
            orders = orders.filter((o) => o.paymentStatus === 'paid' &&
                o.shippingStatus !== 'shipped' &&
                o.shippingStatus !== 'delivered');
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
// Obtener stock de Mercado Libre
const getMercadoLibreStock = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
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
        const items = [];
        // Procesar en paralelo pero limitado a 10 concurrent requests
        const batchSize = 10;
        for (let i = 0; i < itemIds.length; i += batchSize) {
            const batch = itemIds.slice(i, i + batchSize);
            const itemPromises = batch.map((itemId) => __awaiter(void 0, void 0, void 0, function* () {
                try {
                    const itemRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${itemId}`, {
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
                // Si tiene variaciones, obtener stock por variación
                if (item.variations && item.variations.length > 0) {
                    let totalStock = 0;
                    const variations = item.variations.map((v) => {
                        totalStock += v.available_quantity || 0;
                        // Extraer color y talle de los atributos
                        let color = '';
                        let size = '';
                        (v.attribute_combinations || []).forEach((attr) => {
                            if (attr.id === 'COLOR')
                                color = attr.value_name;
                            if (attr.id === 'SIZE')
                                size = attr.value_name;
                        });
                        return {
                            variationId: v.id,
                            sku: v.seller_custom_field || '',
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
                        thumbnail: item.thumbnail,
                        permalink: item.permalink,
                        hasVariations: true,
                        variations
                    });
                }
                else {
                    // Sin variaciones
                    items.push({
                        id: item.id,
                        title: item.title,
                        status: item.status,
                        price: item.price,
                        totalStock: item.available_quantity || 0,
                        soldTotal: item.sold_quantity || 0,
                        thumbnail: item.thumbnail,
                        permalink: item.permalink,
                        hasVariations: false,
                        variations: []
                    });
                }
            }
        }
        res.json({
            items,
            total: ((_a = itemsRes.data.paging) === null || _a === void 0 ? void 0 : _a.total) || items.length,
            offset: parseInt(offset),
            limit: parseInt(limit)
        });
    }
    catch (error) {
        console.error('Error fetching ML stock:', ((_b = error.response) === null || _b === void 0 ? void 0 : _b.data) || error.message);
        res.status(500).json({ message: 'Error obteniendo stock de Mercado Libre', error: error.message });
    }
});
exports.getMercadoLibreStock = getMercadoLibreStock;
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
