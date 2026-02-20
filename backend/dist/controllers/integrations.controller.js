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
exports.disconnectIntegration = exports.syncProductsFromTiendaNube = exports.updateMercadoLibreStock = exports.handleTiendaNubeCallback = exports.getTiendaNubeAuthUrl = exports.handleMercadoLibreCallback = exports.getMercadoLibreAuthUrl = exports.getIntegrationStatus = void 0;
const axios_1 = __importDefault(require("axios"));
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
const ML_AUTH_URL = 'https://auth.mercadolibre.com.ar/authorization';
const ML_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const TN_AUTH_URL = 'https://www.tiendanube.com/apps/authorize';
const TN_TOKEN_URL = 'https://www.tiendanube.com/apps/authorize/token';
const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';
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
        res.redirect('http://localhost:3000/#settings?status=success&platform=mercadolibre');
    }
    catch (error) {
        console.error('Error in Mercado Libre callback:', ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
        res.redirect('http://localhost:3000/#settings?status=error&platform=mercadolibre');
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
    var _a;
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
        yield (0, db_1.execute)(`
      INSERT INTO integrations (platform, access_token, refresh_token, expires_at, user_id)
      VALUES ('tiendanube', ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      access_token = VALUES(access_token),
      refresh_token = VALUES(refresh_token),
      expires_at = VALUES(expires_at),
      user_id = VALUES(user_id),
      updated_at = CURRENT_TIMESTAMP
    `, [access_token, response.data.refresh_token || null, expiresAt, user_id]);
        res.redirect('http://localhost:3000/#settings?status=success&platform=tiendanube');
    }
    catch (error) {
        console.error('Error in Tienda Nube callback:', ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
        res.redirect('http://localhost:3000/#settings?status=error&platform=tiendanube');
    }
});
exports.handleTiendaNubeCallback = handleTiendaNubeCallback;
const updateMercadoLibreStock = (sku, newStock) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const integration = yield (0, db_1.get)(`SELECT * FROM integrations WHERE platform = 'mercadolibre'`);
        if (!integration || !integration.access_token)
            return;
        const { access_token, user_id } = integration;
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
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
                        const processedVariantIds = [];
                        for (const variant of tnProduct.variants) {
                            try {
                                const values = variant.values || [];
                                log(`  [Variant] ID: ${variant.id}, SKU: ${variant.sku}, Stock: ${variant.stock}, Values: ${JSON.stringify(values)}`);
                                let sizeName = 'U';
                                let colorName = 'Único';
                                if (values.length > 0) {
                                    const lastVal = values[values.length - 1];
                                    const extractedSize = (lastVal === null || lastVal === void 0 ? void 0 : lastVal.es) || (lastVal === null || lastVal === void 0 ? void 0 : lastVal.pt) || lastVal;
                                    if (extractedSize)
                                        sizeName = extractedSize;
                                    if (values.length > 1) {
                                        const colorParts = values.slice(0, values.length - 1);
                                        const extractedColor = colorParts.map((v) => v.es || v.pt || v).join(' ');
                                        if (extractedColor)
                                            colorName = extractedColor;
                                    }
                                    else {
                                        const firstVal = values[0];
                                        const val = (firstVal === null || firstVal === void 0 ? void 0 : firstVal.es) || (firstVal === null || firstVal === void 0 ? void 0 : firstVal.pt) || firstVal;
                                        if (val)
                                            colorName = val;
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
                    INSERT INTO product_variants (id, product_color_id, size_id, tienda_nube_variant_id) 
                    VALUES (?, ?, ?, ?)
                  `, [localVariantId, productColorId, sizeId, variant.id]);
                                }
                                else {
                                    yield (0, db_1.execute)(`UPDATE product_variants SET tienda_nube_variant_id = ? WHERE id = ?`, [variant.id, localVariantId]);
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
                                log(`[ERROR] Variant ${variant.id}: ${((_h = (_g = variantErr === null || variantErr === void 0 ? void 0 : variantErr.response) === null || _g === void 0 ? void 0 : _g.data) === null || _h === void 0 ? void 0 : _h.message) || (variantErr === null || variantErr === void 0 ? void 0 : variantErr.message) || 'Error desconocido'}`);
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
                        log(`[ERROR] Product ${tnProduct === null || tnProduct === void 0 ? void 0 : tnProduct.id}: ${((_k = (_j = prodErr === null || prodErr === void 0 ? void 0 : prodErr.response) === null || _j === void 0 ? void 0 : _j.data) === null || _k === void 0 ? void 0 : _k.message) || (prodErr === null || prodErr === void 0 ? void 0 : prodErr.message) || 'Error desconocido'}`);
                    }
                }
                page++;
                // Safety break
                if (page > 50)
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
        res.json({ message: 'Sincronización completada', imported: importedCount, updated: updatedCount, logs });
    }
    catch (error) {
        console.error('Error syncing products:', ((_m = error.response) === null || _m === void 0 ? void 0 : _m.data) || error.message);
        res.status(500).json({ message: 'Error sincronizando productos', error: error.message });
    }
});
exports.syncProductsFromTiendaNube = syncProductsFromTiendaNube;
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
