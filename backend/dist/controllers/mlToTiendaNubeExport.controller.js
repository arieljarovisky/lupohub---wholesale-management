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
exports.exportMercadoLibreToTiendaNube = void 0;
const axios_1 = __importDefault(require("axios"));
const uuid_1 = require("uuid");
const db_1 = require("../database/db");
const integrations_controller_1 = require("./integrations.controller");
const tiendanubeClient_1 = require("../utils/tiendanubeClient");
const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';
const TN_RATE_LIMIT_DELAY_MS = Math.max(0, parseInt(process.env.TN_RATE_LIMIT_DELAY_MS || '800', 10));
const ML_EXPORT_MAX_ITEMS = Math.max(10, parseInt(process.env.ML_EXPORT_TO_TN_MAX_ITEMS || '100', 10));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fetchAllTnProductVariants(storeId, accessToken, productId) {
    return __awaiter(this, void 0, void 0, function* () {
        const headers = { Authentication: `bearer ${accessToken}`, 'User-Agent': TN_USER_AGENT };
        let variantsList = [];
        let vPage = 1;
        let hasMore = true;
        while (hasMore) {
            const variantsRes = yield axios_1.default.get(`https://api.tiendanube.com/v1/${storeId}/products/${productId}/variants`, { headers, params: { page: vPage, per_page: 200 }, validateStatus: () => true });
            const chunk = variantsRes.status === 200 && Array.isArray(variantsRes.data) ? variantsRes.data : [];
            variantsList = variantsList.concat(chunk);
            if (chunk.length < 200)
                hasMore = false;
            else
                vPage++;
            if (vPage > 50)
                hasMore = false;
        }
        return variantsList;
    });
}
/** TN a veces devuelve 201 con cuerpo mínimo; el id puede venir en data, product o header Location. */
function parseTnCreateResponse(r) {
    var _a, _b, _c;
    const data = r.data;
    const product = data && typeof data === 'object' && data.product && typeof data.product === 'object'
        ? data.product
        : data;
    let productId = null;
    const rawId = (_a = product === null || product === void 0 ? void 0 : product.id) !== null && _a !== void 0 ? _a : data === null || data === void 0 ? void 0 : data.id;
    if (rawId != null && String(rawId).trim() !== '') {
        const n = Number(rawId);
        if (Number.isFinite(n))
            productId = n;
    }
    if (productId == null && r.headers) {
        const loc = String((_c = (_b = r.headers.location) !== null && _b !== void 0 ? _b : r.headers.Location) !== null && _c !== void 0 ? _c : '').trim();
        const m = loc.match(/\/products\/(\d+)/i);
        if (m)
            productId = Number(m[1]);
    }
    const embedded = Array.isArray(product === null || product === void 0 ? void 0 : product.variants)
        ? product.variants
        : Array.isArray(data === null || data === void 0 ? void 0 : data.variants)
            ? data.variants
            : [];
    return { productId, product: product !== null && product !== void 0 ? product : data, variants: embedded };
}
function mlSkuFromVariation(v) {
    var _a, _b, _c, _d;
    const skuAttr = Array.isArray(v === null || v === void 0 ? void 0 : v.attributes)
        ? v.attributes.find((a) => ((a === null || a === void 0 ? void 0 : a.id) || '').toString().toUpperCase() === 'SELLER_SKU')
        : null;
    const fromAttr = skuAttr ? ((_b = (_a = skuAttr.value_name) !== null && _a !== void 0 ? _a : skuAttr.value) !== null && _b !== void 0 ? _b : '').toString().trim() : '';
    return fromAttr || ((_d = (_c = v === null || v === void 0 ? void 0 : v.seller_sku) !== null && _c !== void 0 ? _c : v === null || v === void 0 ? void 0 : v.seller_custom_field) !== null && _d !== void 0 ? _d : '').toString().trim();
}
function mlSkuFromItem(item) {
    var _a, _b, _c, _d, _e;
    let s = ((_b = (_a = item === null || item === void 0 ? void 0 : item.seller_sku) !== null && _a !== void 0 ? _a : item === null || item === void 0 ? void 0 : item.seller_custom_field) !== null && _b !== void 0 ? _b : '').toString().trim();
    if (!s && Array.isArray(item === null || item === void 0 ? void 0 : item.attributes)) {
        const skuAttr = item.attributes.find((a) => ((a === null || a === void 0 ? void 0 : a.id) || '').toString().toUpperCase() === 'SELLER_SKU');
        s = (skuAttr ? ((_d = (_c = skuAttr.value_name) !== null && _c !== void 0 ? _c : skuAttr.value) !== null && _d !== void 0 ? _d : '') : '').toString().trim();
    }
    if (!s && ((_e = item === null || item === void 0 ? void 0 : item.variations) === null || _e === void 0 ? void 0 : _e.length) === 1)
        return mlSkuFromVariation(item.variations[0]);
    return s;
}
function attrsFromMlVariation(v, fallbackTitle) {
    let color = '';
    let size = '';
    ((v === null || v === void 0 ? void 0 : v.attribute_combinations) || []).forEach((attr) => {
        const id = ((attr === null || attr === void 0 ? void 0 : attr.id) || '').toString().toUpperCase();
        const name = ((attr === null || attr === void 0 ? void 0 : attr.value_name) || (attr === null || attr === void 0 ? void 0 : attr.name) || '').toString().trim();
        if (id === 'COLOR' || id === 'COLOUR' || id === 'COR')
            color = name;
        if (id === 'SIZE' || id === 'SIZE_TYPE' || id === 'TALLE' || id === 'TALLA')
            size = name;
    });
    if (!color && !size && fallbackTitle) {
        const parsed = (0, integrations_controller_1.mlColorSizeFromTitle)(fallbackTitle);
        color = parsed.color;
        size = parsed.size;
    }
    return { color: color || 'Único', size: size || 'U' };
}
function variantRowsFromMlItem(item) {
    var _a, _b, _c;
    const mlItemId = String((item === null || item === void 0 ? void 0 : item.id) || '').trim();
    const title = ((item === null || item === void 0 ? void 0 : item.title) || '').toString().trim();
    if (((_a = item === null || item === void 0 ? void 0 : item.variations) === null || _a === void 0 ? void 0 : _a.length) > 0) {
        return item.variations.map((v) => {
            var _a, _b, _c;
            const { color, size } = attrsFromMlVariation(v, title);
            const sku = mlSkuFromVariation(v) || `ML-${mlItemId}-${v.id}`;
            return {
                sku,
                color,
                size,
                price: Number((_b = (_a = v.price) !== null && _a !== void 0 ? _a : item.price) !== null && _b !== void 0 ? _b : 0),
                stock: Math.max(0, Number((_c = v.available_quantity) !== null && _c !== void 0 ? _c : 0)),
                mlItemId,
                mlVariationId: v.id != null ? String(v.id) : null,
            };
        });
    }
    const { color, size } = (0, integrations_controller_1.mlColorSizeFromTitle)(title);
    const sku = mlSkuFromItem(item) || `ML-${mlItemId}`;
    return [
        {
            sku,
            color: color || 'Único',
            size: size || 'U',
            price: Number((_b = item === null || item === void 0 ? void 0 : item.price) !== null && _b !== void 0 ? _b : 0),
            stock: Math.max(0, Number((_c = item === null || item === void 0 ? void 0 : item.available_quantity) !== null && _c !== void 0 ? _c : 0)),
            mlItemId,
            mlVariationId: null,
        },
    ];
}
function localizedText(text) {
    const t = (text || '').trim() || 'Sin título';
    return { es: t, en: t, pt: t };
}
function mlPicturesToTnImages(item) {
    const pics = Array.isArray(item === null || item === void 0 ? void 0 : item.pictures) ? item.pictures : [];
    return pics
        .map((p) => ((p === null || p === void 0 ? void 0 : p.secure_url) || (p === null || p === void 0 ? void 0 : p.url) || '').toString().trim())
        .filter((u) => u.startsWith('http'))
        .slice(0, 9)
        .map((src) => ({ src }));
}
function buildTiendaNubeBodyFromMlItems(items, published) {
    var _a, _b, _c;
    const first = items[0];
    const title = (0, integrations_controller_1.mlBaseTitle)(((first === null || first === void 0 ? void 0 : first.title) || '').toString().trim()) ||
        ((first === null || first === void 0 ? void 0 : first.title) || '').toString().trim() ||
        'Producto';
    const descRaw = ((_c = (_b = (_a = first === null || first === void 0 ? void 0 : first.description) === null || _a === void 0 ? void 0 : _a.plain_text) !== null && _b !== void 0 ? _b : first === null || first === void 0 ? void 0 : first.description) !== null && _c !== void 0 ? _c : '').toString().trim() ||
        title;
    const rowMap = new Map();
    for (const item of items) {
        for (const row of variantRowsFromMlItem(item)) {
            const key = `${row.color.toLowerCase()}|${row.size.toUpperCase()}`;
            if (!rowMap.has(key))
                rowMap.set(key, row);
        }
    }
    const rows = [...rowMap.values()];
    if (rows.length === 0) {
        throw new Error('No se pudieron armar variantes desde Mercado Libre');
    }
    const hasColor = rows.some((r) => r.color && r.color !== 'Único');
    const hasSize = rows.some((r) => r.size && r.size !== 'U');
    const attributes = [];
    if (hasColor)
        attributes.push({ es: 'Color' });
    if (hasSize)
        attributes.push({ es: 'Talle' });
    const variants = rows.map((r) => {
        var _a;
        const values = [];
        if (hasColor)
            values.push({ es: r.color });
        if (hasSize)
            values.push({ es: r.size });
        return {
            price: String(r.price > 0 ? r.price : (_a = first === null || first === void 0 ? void 0 : first.price) !== null && _a !== void 0 ? _a : 0),
            stock_management: true,
            stock: r.stock,
            sku: r.sku,
            values,
        };
    });
    const body = {
        name: localizedText(title),
        description: localizedText(descRaw),
        published,
        variants,
    };
    if (attributes.length > 0)
        body.attributes = attributes;
    const images = mlPicturesToTnImages(first);
    for (const item of items) {
        if (images.length >= 9)
            break;
        for (const im of mlPicturesToTnImages(item)) {
            if (images.length >= 9)
                break;
            if (!images.some((x) => x.src === im.src))
                images.push(im);
        }
    }
    if (images.length > 0)
        body.images = images;
    return body;
}
/** Publicaciones hermanas (mismo modelo, distinto color/talle en títulos separados). */
function findSiblingMlItems(accessToken, sellerUserId, seedItem) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!seedItem || (seedItem.variations && seedItem.variations.length > 0)) {
            return seedItem ? [seedItem] : [];
        }
        const baseTitle = (0, integrations_controller_1.mlBaseTitle)((seedItem.title || '').toString().trim());
        const baseTitleLoose = (0, integrations_controller_1.mlStripTrailingPublicationIndex)(baseTitle);
        if (!baseTitle)
            return [seedItem];
        const searchRes = yield axios_1.default.get(`https://api.mercadolibre.com/users/${sellerUserId}/items/search`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            params: { q: baseTitleLoose || baseTitle, limit: 50, offset: 0 },
            validateStatus: () => true,
        });
        const siblingIds = searchRes.status === 200 && Array.isArray((_a = searchRes.data) === null || _a === void 0 ? void 0 : _a.results)
            ? searchRes.data.results.map((x) => String(x || '').trim()).filter(Boolean)
            : [];
        const uniqueSiblingIds = Array.from(new Set([String(seedItem.id), ...siblingIds])).slice(0, 50);
        if (uniqueSiblingIds.length <= 1)
            return [seedItem];
        const siblings = yield Promise.all(uniqueSiblingIds.map((sid) => __awaiter(this, void 0, void 0, function* () { return fetchMlItem(accessToken, sid); })));
        const matched = (siblings || []).filter((it) => {
            if (!it || it.error)
                return false;
            if (it.variations && it.variations.length > 0)
                return false;
            const siblingBase = (0, integrations_controller_1.mlBaseTitle)((it.title || '').toString().trim());
            const siblingLoose = (0, integrations_controller_1.mlStripTrailingPublicationIndex)(siblingBase);
            return siblingBase === baseTitle || (baseTitleLoose && siblingLoose === baseTitleLoose);
        });
        return matched.length > 0 ? matched : [seedItem];
    });
}
/**
 * Resuelve ítems ML a exportar: un itemId + hermanas automáticas, o lista explícita itemIds.
 */
function resolveMlItemsForExport(accessToken, sellerUserId, seedIds, includeSiblings) {
    return __awaiter(this, void 0, void 0, function* () {
        const items = [];
        const missing = [];
        const seen = new Set();
        const pushItem = (item) => {
            const id = String((item === null || item === void 0 ? void 0 : item.id) || '').trim();
            if (!id || seen.has(id))
                return;
            seen.add(id);
            items.push(item);
        };
        const singleSeed = seedIds.length === 1;
        for (const rawId of seedIds) {
            const item = yield fetchMlItem(accessToken, rawId);
            if (!item) {
                missing.push(rawId);
                continue;
            }
            if (includeSiblings && singleSeed) {
                const group = yield findSiblingMlItems(accessToken, sellerUserId, item);
                for (const g of group)
                    pushItem(g);
            }
            else {
                pushItem(item);
            }
        }
        if (items.length > ML_EXPORT_MAX_ITEMS) {
            throw new Error(`Hay ${items.length} publicaciones ML para este artículo; el máximo por exportación es ${ML_EXPORT_MAX_ITEMS}. Exportá por partes o contactá soporte.`);
        }
        return { items, missing };
    });
}
function fetchMlItem(accessToken, rawId) {
    return __awaiter(this, void 0, void 0, function* () {
        for (const id of (0, integrations_controller_1.mercadoLibreItemIdCandidates)(rawId)) {
            try {
                const r = yield axios_1.default.get(`https://api.mercadolibre.com/items/${id}?include_attributes=all`, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    validateStatus: () => true,
                });
                if (r.status === 200 && r.data && !r.data.error)
                    return r.data;
            }
            catch (_a) {
                /* siguiente candidato */
            }
        }
        return null;
    });
}
function linkLocalInventoryToTn(tnProductId, tnVariants, mlRows) {
    return __awaiter(this, void 0, void 0, function* () {
        let linked = 0;
        const tnBySku = new Map();
        for (const tv of tnVariants) {
            const sku = ((tv === null || tv === void 0 ? void 0 : tv.sku) || '').toString().trim();
            if (sku)
                tnBySku.set(sku.toUpperCase(), tv);
        }
        for (const row of mlRows) {
            const skuKey = row.sku.toUpperCase();
            const tnVar = tnBySku.get(skuKey);
            if (!(tnVar === null || tnVar === void 0 ? void 0 : tnVar.id))
                continue;
            const local = yield (0, db_1.get)(`SELECT pv.id AS variant_id, pc.product_id,
              p.tienda_nube_id, pv.tienda_nube_variant_id
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       WHERE UPPER(pv.sku) = ? OR pv.mercado_libre_item_id = ?
       LIMIT 1`, [skuKey, row.mlItemId]);
            if (!(local === null || local === void 0 ? void 0 : local.variant_id))
                continue;
            const productId = local.product_id;
            const variantId = local.variant_id;
            yield (0, db_1.execute)(`UPDATE products SET tienda_nube_id = ? WHERE id = ?`, [String(tnProductId), productId]);
            yield (0, db_1.execute)(`UPDATE product_variants SET tienda_nube_variant_id = ? WHERE id = ?`, [
                String(tnVar.id),
                variantId,
            ]);
            if (row.mlItemId) {
                yield (0, db_1.execute)(`UPDATE product_variants SET mercado_libre_item_id = COALESCE(mercado_libre_item_id, ?) WHERE id = ?`, [row.mlItemId, variantId]);
            }
            if (row.mlVariationId) {
                yield (0, db_1.execute)(`UPDATE product_variants SET mercado_libre_variant_id = COALESCE(mercado_libre_variant_id, ?) WHERE id = ?`, [row.mlVariationId, variantId]);
            }
            const mlPack = 1;
            yield (0, db_1.execute)(`INSERT INTO variant_publications (id, variant_id, platform, external_product_id, external_variant_id, pack_size)
       VALUES (?, ?, 'mercadolibre', ?, ?, ?)
       ON DUPLICATE KEY UPDATE pack_size = VALUES(pack_size)`, [
                (0, uuid_1.v4)(),
                variantId,
                row.mlItemId,
                row.mlVariationId != null && row.mlVariationId !== row.mlItemId ? row.mlVariationId : '',
                mlPack,
            ]);
            yield (0, db_1.execute)(`INSERT INTO variant_publications (id, variant_id, platform, external_product_id, external_variant_id, pack_size)
       VALUES (?, ?, 'tiendanube', ?, ?, 1)
       ON DUPLICATE KEY UPDATE pack_size = VALUES(pack_size)`, [(0, uuid_1.v4)(), variantId, String(tnProductId), String(tnVar.id)]);
            linked++;
        }
        return linked;
    });
}
/** POST { itemId?, itemIds?, includeSiblings?, published?, linkLocal? } — crea producto en TN desde ML. */
const exportMercadoLibreToTiendaNube = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    try {
        const { itemId, itemIds, published = true, linkLocal = true } = req.body || {};
        const includeSiblings = ((_a = req.body) === null || _a === void 0 ? void 0 : _a.includeSiblings) !== false;
        const ids = Array.isArray(itemIds) && itemIds.length > 0
            ? itemIds.flatMap((id) => (0, integrations_controller_1.mercadoLibreItemIdCandidates)(id)).filter(Boolean)
            : itemId != null && itemId !== ''
                ? (0, integrations_controller_1.mercadoLibreItemIdCandidates)(itemId)
                : [];
        if (ids.length === 0) {
            return res.status(400).json({ message: 'Indicá itemId o itemIds (publicación/es de Mercado Libre)' });
        }
        const mlToken = yield (0, integrations_controller_1.getValidMLToken)();
        if (!mlToken)
            return res.status(400).json({ message: 'No hay integración con Mercado Libre' });
        const tnIntegration = yield (0, db_1.get)(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
        if (!(tnIntegration === null || tnIntegration === void 0 ? void 0 : tnIntegration.access_token))
            return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
        const storeId = tnIntegration.store_id || tnIntegration.user_id;
        if (!storeId)
            return res.status(400).json({ message: 'No se encontró store_id de Tienda Nube' });
        let items = [];
        let missing = [];
        try {
            const resolved = yield resolveMlItemsForExport(mlToken.access_token, String(mlToken.user_id), ids, includeSiblings);
            items = resolved.items;
            missing = resolved.missing;
        }
        catch (resolveErr) {
            return res.status(400).json({ message: (resolveErr === null || resolveErr === void 0 ? void 0 : resolveErr.message) || String(resolveErr) });
        }
        if (items.length === 0) {
            return res.status(404).json({ message: 'No se encontró ninguna publicación en Mercado Libre', missing });
        }
        const createBody = buildTiendaNubeBodyFromMlItems(items, published !== false);
        const url = `https://api.tiendanube.com/v1/${storeId}/products`;
        const headers = {
            Authentication: `bearer ${tnIntegration.access_token}`,
            'User-Agent': TN_USER_AGENT,
            'Content-Type': 'application/json',
        };
        const r = yield (0, tiendanubeClient_1.tnPostWithRetry)(axios_1.default, url, createBody, { headers, validateStatus: () => true });
        const okStatus = r.status === 201 || r.status === 200;
        if (!okStatus) {
            const detail = ((_b = r.data) === null || _b === void 0 ? void 0 : _b.description) || ((_c = r.data) === null || _c === void 0 ? void 0 : _c.message) || r.statusText;
            return res.status(r.status >= 400 ? r.status : 502).json({
                message: ['Tienda Nube rechazó la publicación', detail].filter(Boolean).join(' — '),
                errors: r.data,
                mlItemsLoaded: items.length,
                missing,
            });
        }
        const parsed = parseTnCreateResponse(r);
        let tnProductId = parsed.productId;
        let tnProduct = parsed.product;
        let tnVariants = parsed.variants;
        if (tnProductId == null) {
            return res.status(502).json({
                message: 'Tienda Nube aceptó la solicitud pero no devolvió el ID del producto. Revisá en el administrador de TN si se creó la publicación.',
                tnStatus: r.status,
                tnResponse: r.data,
                mlItemsLoaded: items.length,
                missing,
            });
        }
        if (tnVariants.length === 0) {
            tnVariants = yield fetchAllTnProductVariants(storeId, tnIntegration.access_token, tnProductId);
        }
        if (tnVariants.length === 0 && ((_d = createBody.variants) === null || _d === void 0 ? void 0 : _d.length) > 0) {
            console.warn(`[ML→TN export] Producto TN ${tnProductId} sin variantes en respuesta; se enviaron ${createBody.variants.length} en el POST`);
        }
        const allMlRows = [];
        const rowMap = new Map();
        for (const item of items) {
            for (const row of variantRowsFromMlItem(item)) {
                const key = `${row.color.toLowerCase()}|${row.size.toUpperCase()}`;
                if (!rowMap.has(key))
                    rowMap.set(key, row);
            }
        }
        allMlRows.push(...rowMap.values());
        let variantsLinked = 0;
        if (linkLocal !== false && tnProductId && tnVariants.length > 0) {
            try {
                variantsLinked = yield linkLocalInventoryToTn(tnProductId, tnVariants, allMlRows);
            }
            catch (linkErr) {
                console.warn('[ML→TN export] Error vinculando inventario local:', (linkErr === null || linkErr === void 0 ? void 0 : linkErr.message) || linkErr);
            }
        }
        if (TN_RATE_LIMIT_DELAY_MS > 0)
            yield sleep(TN_RATE_LIMIT_DELAY_MS);
        const variantCount = tnVariants.length || ((_e = createBody.variants) === null || _e === void 0 ? void 0 : _e.length) || 0;
        return res.status(201).json({
            message: 'Publicación creada en Tienda Nube desde Mercado Libre',
            tiendaNubeProductId: tnProductId,
            tiendaNubeVariantCount: variantCount,
            mlItemsUsed: items.map((i) => i.id),
            variantsInProduct: allMlRows.length,
            variantsLinkedLocal: variantsLinked,
            missing,
            product: tnProduct,
        });
    }
    catch (error) {
        const detail = (error === null || error === void 0 ? void 0 : error.message) || String(error);
        console.error('[exportMercadoLibreToTiendaNube]', detail);
        return res.status(500).json({ message: 'Error exportando a Tienda Nube', detail });
    }
});
exports.exportMercadoLibreToTiendaNube = exportMercadoLibreToTiendaNube;
