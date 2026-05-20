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
exports.fetchPublicationSourcePreview = fetchPublicationSourcePreview;
exports.fetchMercadoLibreItemResolved = fetchMercadoLibreItemResolved;
exports.createMercadoLibrePackListingFromItem = createMercadoLibrePackListingFromItem;
exports.createMercadoLibrePackListingWithVariants = createMercadoLibrePackListingWithVariants;
exports.createTiendaNubePackListingFromProduct = createTiendaNubePackListingFromProduct;
exports.createTiendaNubePackListingWithVariants = createTiendaNubePackListingWithVariants;
exports.createPackListingAndBundle = createPackListingAndBundle;
const axios_1 = __importDefault(require("axios"));
const db_1 = require("../database/db");
const integrations_controller_1 = require("../controllers/integrations.controller");
const tiendanubeClient_1 = require("../utils/tiendanubeClient");
const publicationStockBundle_service_1 = require("./publicationStockBundle.service");
const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';
function appendTitleSuffix(title, suffix) {
    const t = (title || '').trim();
    const s = (suffix || '').trim();
    if (!s)
        return t;
    if (t.toLowerCase().includes(s.toLowerCase()))
        return t;
    return `${t}${s}`;
}
function mlPicturesFromItem(item) {
    return (Array.isArray(item === null || item === void 0 ? void 0 : item.pictures) ? item.pictures : [])
        .slice(0, 12)
        .map((p) => {
        if (p === null || p === void 0 ? void 0 : p.id)
            return { id: String(p.id) };
        const url = (p === null || p === void 0 ? void 0 : p.secure_url) || (p === null || p === void 0 ? void 0 : p.url);
        if (url && String(url).startsWith('http'))
            return { source: String(url) };
        return null;
    })
        .filter(Boolean);
}
function mlSkuFromItem(item) {
    var _a, _b, _c, _d;
    let s = ((_b = (_a = item === null || item === void 0 ? void 0 : item.seller_sku) !== null && _a !== void 0 ? _a : item === null || item === void 0 ? void 0 : item.seller_custom_field) !== null && _b !== void 0 ? _b : '').toString().trim();
    if (!s && Array.isArray(item === null || item === void 0 ? void 0 : item.attributes)) {
        const skuAttr = item.attributes.find((a) => ((a === null || a === void 0 ? void 0 : a.id) || '').toString().toUpperCase() === 'SELLER_SKU');
        s = (skuAttr ? ((_d = (_c = skuAttr.value_name) !== null && _c !== void 0 ? _c : skuAttr.value) !== null && _d !== void 0 ? _d : '') : '').toString().trim();
    }
    return s;
}
function mlAttributesForDuplicate(item, skuSuffix) {
    if (!Array.isArray(item === null || item === void 0 ? void 0 : item.attributes))
        return [];
    const baseSku = mlSkuFromItem(item);
    const newSku = baseSku ? `${baseSku}${skuSuffix}` : '';
    return item.attributes.map((a) => {
        const id = ((a === null || a === void 0 ? void 0 : a.id) || '').toString().toUpperCase();
        if (id === 'SELLER_SKU' && newSku) {
            return Object.assign(Object.assign({}, a), { value_name: newSku, value: newSku });
        }
        return Object.assign({}, a);
    });
}
function localizedTnText(field) {
    if (field == null)
        return '';
    if (typeof field === 'string')
        return field.trim();
    if (typeof field === 'object') {
        const o = field;
        for (const k of ['es', 'es_AR', 'en', 'pt']) {
            const v = o[k];
            if (typeof v === 'string' && v.trim())
                return v.trim();
        }
        const first = Object.values(o).find((v) => typeof v === 'string' && String(v).trim());
        if (typeof first === 'string')
            return first.trim();
    }
    return '';
}
function fetchPublicationSourcePreview(platform, rawId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        const id = String(rawId || '').trim();
        if (!id)
            return null;
        if (platform === 'mercadolibre') {
            const resolved = yield fetchMercadoLibreItemResolved(id);
            if (!resolved)
                return null;
            const { item, itemId } = resolved;
            let description = '';
            const mlToken = yield (0, integrations_controller_1.getValidMLToken)();
            if (mlToken) {
                try {
                    const descRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${itemId}/description`, {
                        headers: { Authorization: `Bearer ${mlToken.access_token}` },
                        validateStatus: () => true
                    });
                    if (descRes.status === 200) {
                        description = ((_d = (_b = (_a = descRes.data) === null || _a === void 0 ? void 0 : _a.plain_text) !== null && _b !== void 0 ? _b : (_c = descRes.data) === null || _c === void 0 ? void 0 : _c.text) !== null && _d !== void 0 ? _d : '').toString().trim();
                    }
                }
                catch (_g) {
                    /* sin descripción */
                }
            }
            if (!description && item.subtitle)
                description = String(item.subtitle).trim();
            const images = (Array.isArray(item.pictures) ? item.pictures : [])
                .map((p) => (p === null || p === void 0 ? void 0 : p.secure_url) || (p === null || p === void 0 ? void 0 : p.url))
                .filter((u) => typeof u === 'string' && String(u).startsWith('http'))
                .slice(0, 12);
            return {
                platform: 'mercadolibre',
                resolvedId: itemId,
                title: String(item.title || '').trim(),
                description,
                images,
                price: Number(item.price) || undefined
            };
        }
        const integration = yield (0, db_1.get)(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
        if (!(integration === null || integration === void 0 ? void 0 : integration.access_token))
            return null;
        const storeId = integration.store_id || integration.user_id;
        if (!storeId)
            return null;
        const tnId = id.replace(/\D/g, '') || id;
        const headers = { Authentication: `bearer ${integration.access_token}`, 'User-Agent': TN_USER_AGENT };
        const productRes = yield axios_1.default.get(`https://api.tiendanube.com/v1/${storeId}/products/${tnId}`, {
            headers,
            validateStatus: () => true
        });
        if (productRes.status !== 200 || !productRes.data)
            return null;
        const p = productRes.data;
        const description = localizedTnText(p.description) || localizedTnText(p.seo_description);
        const images = (Array.isArray(p.images) ? p.images : [])
            .map((im) => im === null || im === void 0 ? void 0 : im.src)
            .filter((u) => typeof u === 'string' && String(u).startsWith('http'))
            .slice(0, 12);
        const variants = yield fetchAllTnVariants(storeId, integration.access_token, String(tnId));
        const price = ((_e = variants[0]) === null || _e === void 0 ? void 0 : _e.price) != null ? Number(variants[0].price) : undefined;
        return {
            platform: 'tiendanube',
            resolvedId: String((_f = p.id) !== null && _f !== void 0 ? _f : tnId),
            title: localizedTnText(p.name),
            description,
            images,
            price: Number.isFinite(price) ? price : undefined
        };
    });
}
function fetchMercadoLibreItemResolved(rawItemId) {
    return __awaiter(this, void 0, void 0, function* () {
        const mlToken = yield (0, integrations_controller_1.getValidMLToken)();
        if (!mlToken)
            return null;
        const candidates = (0, integrations_controller_1.mercadoLibreItemIdCandidates)(rawItemId);
        if (!candidates.length)
            return null;
        const headers = { Authorization: `Bearer ${mlToken.access_token}` };
        for (const candidate of candidates) {
            try {
                const r = yield axios_1.default.get(`https://api.mercadolibre.com/items/${candidate}?include_attributes=all`, {
                    headers,
                    validateStatus: () => true
                });
                if (r.status === 200 && r.data && !r.data.error) {
                    return { item: r.data, itemId: String(r.data.id || candidate) };
                }
            }
            catch (_a) {
                /* siguiente candidato */
            }
        }
        return null;
    });
}
function createMercadoLibrePackListingFromItem(sourceItem, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const mlToken = yield (0, integrations_controller_1.getValidMLToken)();
        if (!mlToken)
            throw new Error('No hay integración con Mercado Libre');
        const pictures = mlPicturesFromItem(sourceItem);
        if (!pictures.length) {
            throw new Error('La publicación origen no tiene fotos para copiar');
        }
        const title = appendTitleSuffix(String(sourceItem.title || 'Pack'), opts.titleSuffix);
        const body = {
            title,
            category_id: sourceItem.category_id,
            price: Number(sourceItem.price) || 0,
            currency_id: sourceItem.currency_id || 'ARS',
            available_quantity: Math.max(0, Math.floor(opts.availableQuantity)),
            buying_mode: sourceItem.buying_mode || 'buy_it_now',
            listing_type_id: sourceItem.listing_type_id || 'gold_special',
            condition: sourceItem.condition || 'new',
            pictures
        };
        const attrs = mlAttributesForDuplicate(sourceItem, opts.skuSuffix);
        if (attrs.length)
            body.attributes = attrs;
        const sku = mlSkuFromItem(sourceItem);
        if (sku)
            body.seller_custom_field = `${sku}${opts.skuSuffix}`;
        if (sourceItem.video_id)
            body.video_id = sourceItem.video_id;
        if (Array.isArray(sourceItem.sale_terms) && sourceItem.sale_terms.length) {
            body.sale_terms = sourceItem.sale_terms;
        }
        if (sourceItem.shipping && typeof sourceItem.shipping === 'object') {
            body.shipping = sourceItem.shipping;
        }
        if (opts.status === 'paused')
            body.status = 'paused';
        const headers = {
            Authorization: `Bearer ${mlToken.access_token}`,
            'Content-Type': 'application/json'
        };
        const postRes = yield axios_1.default.post('https://api.mercadolibre.com/items', body, {
            headers,
            validateStatus: () => true
        });
        if (postRes.status !== 201 && postRes.status !== 200) {
            const msg = ((_a = postRes.data) === null || _a === void 0 ? void 0 : _a.message) ||
                ((_b = postRes.data) === null || _b === void 0 ? void 0 : _b.error) ||
                (Array.isArray((_c = postRes.data) === null || _c === void 0 ? void 0 : _c.cause) ? postRes.data.cause.map((c) => c.message).join('; ') : null) ||
                postRes.statusText;
            throw new Error(`Mercado Libre rechazó la creación: ${msg}`);
        }
        const newItem = postRes.data;
        const itemId = String((newItem === null || newItem === void 0 ? void 0 : newItem.id) || '');
        if (!itemId)
            throw new Error('Mercado Libre no devolvió el ID de la nueva publicación');
        try {
            const descRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${sourceItem.id}/description`, {
                headers: { Authorization: `Bearer ${mlToken.access_token}` },
                validateStatus: () => true
            });
            if (descRes.status === 200 && ((_d = descRes.data) === null || _d === void 0 ? void 0 : _d.plain_text)) {
                yield axios_1.default.post(`https://api.mercadolibre.com/items/${itemId}/description`, { plain_text: descRes.data.plain_text }, { headers, validateStatus: () => true });
            }
        }
        catch (_e) {
            /* descripción opcional */
        }
        return { itemId, item: newItem };
    });
}
function mlPrimaryVariationAttr(sourceItem) {
    var _a;
    const v0 = (_a = sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.variations) === null || _a === void 0 ? void 0 : _a[0];
    const combo = Array.isArray(v0 === null || v0 === void 0 ? void 0 : v0.attribute_combinations) ? v0.attribute_combinations[0] : null;
    if (combo === null || combo === void 0 ? void 0 : combo.id)
        return { id: String(combo.id), name: combo.name };
    return { id: 'COLOR', name: 'Color' };
}
function createMercadoLibrePackListingWithVariants(sourceItem, packVariants, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const mlToken = yield (0, integrations_controller_1.getValidMLToken)();
        if (!mlToken)
            throw new Error('No hay integración con Mercado Libre');
        const pictures = mlPicturesFromItem(sourceItem);
        if (!pictures.length)
            throw new Error('La publicación origen no tiene fotos para copiar');
        if (!packVariants.length)
            throw new Error('Agregá al menos una combinación de colores');
        const attr = mlPrimaryVariationAttr(sourceItem);
        const basePrice = Number(sourceItem.price) || 0;
        const baseSku = mlSkuFromItem(sourceItem);
        const variations = packVariants.map((pv, idx) => {
            const stock = (0, publicationStockBundle_service_1.computeAvailableStockFromItems)(pv.items);
            const comboLabel = (pv.label || `Combo ${idx + 1}`).trim();
            const varSku = baseSku ? `${baseSku}${opts.skuSuffix}-${idx + 1}` : `${opts.skuSuffix}-${idx + 1}`;
            return {
                attribute_combinations: [{ id: attr.id, name: attr.name, value_name: comboLabel }],
                available_quantity: stock,
                price: basePrice,
                seller_custom_field: varSku
            };
        });
        const title = appendTitleSuffix(String(sourceItem.title || 'Pack'), opts.titleSuffix);
        const body = {
            title,
            category_id: sourceItem.category_id,
            currency_id: sourceItem.currency_id || 'ARS',
            buying_mode: sourceItem.buying_mode || 'buy_it_now',
            listing_type_id: sourceItem.listing_type_id || 'gold_special',
            condition: sourceItem.condition || 'new',
            pictures,
            variations
        };
        const attrs = mlAttributesForDuplicate(sourceItem, opts.skuSuffix);
        if (attrs.length)
            body.attributes = attrs;
        if (sourceItem.video_id)
            body.video_id = sourceItem.video_id;
        if (Array.isArray(sourceItem.sale_terms) && sourceItem.sale_terms.length) {
            body.sale_terms = sourceItem.sale_terms;
        }
        if (sourceItem.shipping && typeof sourceItem.shipping === 'object') {
            body.shipping = sourceItem.shipping;
        }
        if (opts.status === 'paused')
            body.status = 'paused';
        const headers = {
            Authorization: `Bearer ${mlToken.access_token}`,
            'Content-Type': 'application/json'
        };
        const postRes = yield axios_1.default.post('https://api.mercadolibre.com/items', body, {
            headers,
            validateStatus: () => true
        });
        if (postRes.status !== 201 && postRes.status !== 200) {
            const msg = ((_a = postRes.data) === null || _a === void 0 ? void 0 : _a.message) ||
                ((_b = postRes.data) === null || _b === void 0 ? void 0 : _b.error) ||
                (Array.isArray((_c = postRes.data) === null || _c === void 0 ? void 0 : _c.cause) ? postRes.data.cause.map((c) => c.message).join('; ') : null) ||
                postRes.statusText;
            throw new Error(`Mercado Libre rechazó la creación: ${msg}`);
        }
        const newItem = postRes.data;
        const itemId = String((newItem === null || newItem === void 0 ? void 0 : newItem.id) || '');
        if (!itemId)
            throw new Error('Mercado Libre no devolvió el ID de la nueva publicación');
        const variationIds = (Array.isArray(newItem.variations) ? newItem.variations : []).map((v) => String((v === null || v === void 0 ? void 0 : v.id) || ''));
        try {
            const descRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${sourceItem.id}/description`, {
                headers: { Authorization: `Bearer ${mlToken.access_token}` },
                validateStatus: () => true
            });
            if (descRes.status === 200 && ((_d = descRes.data) === null || _d === void 0 ? void 0 : _d.plain_text)) {
                yield axios_1.default.post(`https://api.mercadolibre.com/items/${itemId}/description`, { plain_text: descRes.data.plain_text }, { headers, validateStatus: () => true });
            }
        }
        catch (_e) {
            /* opcional */
        }
        return { itemId, item: newItem, variationIds };
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
function stripVariantForTiendaNubeCreate(v, skuSuffix, idx, stock) {
    const baseSku = (v === null || v === void 0 ? void 0 : v.sku) != null && String(v.sku).trim() !== '' ? String(v.sku).trim() : `VAR-${idx + 1}`;
    return {
        price: (v === null || v === void 0 ? void 0 : v.price) != null ? String(v.price) : '0',
        stock_management: true,
        stock: Math.max(0, Math.floor(stock)),
        sku: `${baseSku}${skuSuffix}`,
        values: Array.isArray(v === null || v === void 0 ? void 0 : v.values) ? v.values : []
    };
}
function fetchAllTnVariants(storeId, accessToken, productId) {
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
function createTiendaNubePackListingFromProduct(sourceProductId, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        const integration = yield (0, db_1.get)(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
        if (!(integration === null || integration === void 0 ? void 0 : integration.access_token))
            throw new Error('No hay integración con Tienda Nube');
        const storeId = integration.store_id || integration.user_id;
        if (!storeId)
            throw new Error('No se encontró store_id de Tienda Nube');
        const headers = { Authentication: `bearer ${integration.access_token}`, 'User-Agent': TN_USER_AGENT };
        const productRes = yield axios_1.default.get(`https://api.tiendanube.com/v1/${storeId}/products/${sourceProductId}`, {
            headers,
            validateStatus: () => true
        });
        if (productRes.status !== 200) {
            throw new Error('Producto no encontrado en Tienda Nube');
        }
        const p = productRes.data;
        const variantsList = yield fetchAllTnVariants(storeId, integration.access_token, String(sourceProductId));
        const baseVariant = variantsList[0] || { price: '0', values: [] };
        const packVariant = stripVariantForTiendaNubeCreate(baseVariant, opts.skuSuffix, 0, opts.availableQuantity);
        const body = {
            name: appendSuffixToLocalizedName(p.name, opts.titleSuffix),
            description: (_a = p.description) !== null && _a !== void 0 ? _a : { es: '', en: '', pt: '' },
            attributes: Array.isArray(p.attributes) ? p.attributes : [],
            categories: tiendaNubeCategoryIdsOnly(p.categories),
            published: opts.published,
            free_shipping: !!p.free_shipping,
            tags: typeof p.tags === 'string' ? p.tags : '',
            variants: [packVariant]
        };
        if (p.brand != null && String(p.brand).trim() !== '')
            body.brand = p.brand;
        if (p.video_url && String(p.video_url).startsWith('https://'))
            body.video_url = p.video_url;
        const imgs = (Array.isArray(p.images) ? p.images : [])
            .slice(0, 9)
            .map((im) => ((im === null || im === void 0 ? void 0 : im.src) ? { src: im.src } : null))
            .filter(Boolean);
        if (imgs.length > 0)
            body.images = imgs;
        else
            throw new Error('El producto origen no tiene imágenes para copiar');
        const url = `https://api.tiendanube.com/v1/${storeId}/products`;
        const postHeaders = Object.assign(Object.assign({}, headers), { 'Content-Type': 'application/json' });
        const r = yield (0, tiendanubeClient_1.tnPostWithRetry)(axios_1.default, url, body, { headers: postHeaders, validateStatus: () => true });
        if (r.status !== 201) {
            const detail = ((_b = r.data) === null || _b === void 0 ? void 0 : _b.description) || ((_c = r.data) === null || _c === void 0 ? void 0 : _c.message) || r.statusText;
            throw new Error(`Tienda Nube rechazó la creación: ${detail}`);
        }
        const newId = Number((_d = r.data) === null || _d === void 0 ? void 0 : _d.id);
        if (!Number.isFinite(newId))
            throw new Error('Tienda Nube no devolvió el ID del nuevo producto');
        const newVariants = yield fetchAllTnVariants(storeId, integration.access_token, String(newId));
        const variantId = Number((_e = newVariants[0]) === null || _e === void 0 ? void 0 : _e.id);
        if (!Number.isFinite(variantId)) {
            throw new Error('No se pudo obtener la variante del nuevo producto en Tienda Nube');
        }
        return { productId: newId, variantId };
    });
}
function createTiendaNubePackListingWithVariants(sourceProductId, packVariants, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const integration = yield (0, db_1.get)(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
        if (!(integration === null || integration === void 0 ? void 0 : integration.access_token))
            throw new Error('No hay integración con Tienda Nube');
        const storeId = integration.store_id || integration.user_id;
        if (!storeId)
            throw new Error('No se encontró store_id de Tienda Nube');
        const headers = { Authentication: `bearer ${integration.access_token}`, 'User-Agent': TN_USER_AGENT };
        const productRes = yield axios_1.default.get(`https://api.tiendanube.com/v1/${storeId}/products/${sourceProductId}`, {
            headers,
            validateStatus: () => true
        });
        if (productRes.status !== 200)
            throw new Error('Producto no encontrado en Tienda Nube');
        const p = productRes.data;
        const variantsList = yield fetchAllTnVariants(storeId, integration.access_token, String(sourceProductId));
        const baseVariant = variantsList[0] || { price: '0', values: [] };
        const valueTemplate = Array.isArray(baseVariant.values) && baseVariant.values.length > 0 ? baseVariant.values : [];
        const tnVariants = packVariants.map((pv, idx) => {
            const stock = (0, publicationStockBundle_service_1.computeAvailableStockFromItems)(pv.items);
            const comboLabel = (pv.label || `Combo ${idx + 1}`).trim();
            const values = valueTemplate.length > 0
                ? valueTemplate.map((val, i) => i === 0
                    ? Object.assign(Object.assign({}, val), { es: comboLabel, en: comboLabel, pt: comboLabel }) : val)
                : [{ es: comboLabel }];
            return Object.assign(Object.assign({}, stripVariantForTiendaNubeCreate(baseVariant, `${opts.skuSuffix}-${idx + 1}`, idx, stock)), { values });
        });
        const body = {
            name: appendSuffixToLocalizedName(p.name, opts.titleSuffix),
            description: (_a = p.description) !== null && _a !== void 0 ? _a : { es: '', en: '', pt: '' },
            attributes: Array.isArray(p.attributes) ? p.attributes : [],
            categories: tiendaNubeCategoryIdsOnly(p.categories),
            published: opts.published,
            free_shipping: !!p.free_shipping,
            tags: typeof p.tags === 'string' ? p.tags : '',
            variants: tnVariants
        };
        if (p.brand != null && String(p.brand).trim() !== '')
            body.brand = p.brand;
        const imgs = (Array.isArray(p.images) ? p.images : [])
            .slice(0, 9)
            .map((im) => ((im === null || im === void 0 ? void 0 : im.src) ? { src: im.src } : null))
            .filter(Boolean);
        if (imgs.length > 0)
            body.images = imgs;
        else
            throw new Error('El producto origen no tiene imágenes para copiar');
        const url = `https://api.tiendanube.com/v1/${storeId}/products`;
        const postHeaders = Object.assign(Object.assign({}, headers), { 'Content-Type': 'application/json' });
        const r = yield (0, tiendanubeClient_1.tnPostWithRetry)(axios_1.default, url, body, { headers: postHeaders, validateStatus: () => true });
        if (r.status !== 201) {
            const detail = ((_b = r.data) === null || _b === void 0 ? void 0 : _b.description) || ((_c = r.data) === null || _c === void 0 ? void 0 : _c.message) || r.statusText;
            throw new Error(`Tienda Nube rechazó la creación: ${detail}`);
        }
        const newId = Number((_d = r.data) === null || _d === void 0 ? void 0 : _d.id);
        if (!Number.isFinite(newId))
            throw new Error('Tienda Nube no devolvió el ID del nuevo producto');
        const newVariants = yield fetchAllTnVariants(storeId, integration.access_token, String(newId));
        const variantIds = newVariants.map((v) => Number(v === null || v === void 0 ? void 0 : v.id)).filter((n) => Number.isFinite(n));
        return { productId: newId, variantIds };
    });
}
function bundleItemsWithStock(items) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const out = [];
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (!((_a = it.variantId) === null || _a === void 0 ? void 0 : _a.trim()))
                continue;
            const row = yield (0, db_1.get)(`SELECT COALESCE(s.stock, 0) AS stock, pv.sku FROM product_variants pv
       LEFT JOIN stocks s ON s.variant_id = pv.id WHERE pv.id = ?`, [it.variantId.trim()]);
            out.push({
                id: '',
                variantId: it.variantId.trim(),
                unitsPerSale: Math.max(1, Math.floor(Number(it.unitsPerSale) || 1)),
                sortOrder: i,
                sku: (_b = row === null || row === void 0 ? void 0 : row.sku) !== null && _b !== void 0 ? _b : '',
                stock: Number(row === null || row === void 0 ? void 0 : row.stock) || 0
            });
        }
        return out;
    });
}
function createPackListingAndBundle(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        const variantInputs = ((_a = input.variants) === null || _a === void 0 ? void 0 : _a.length)
            ? input.variants
            : ((_b = input.items) === null || _b === void 0 ? void 0 : _b.length)
                ? [{ label: input.label, items: input.items }]
                : [];
        if (!variantInputs.length) {
            throw new Error('Agregá al menos una combinación de colores (variante de pack)');
        }
        const titleSuffix = ((_c = input.titleSuffix) !== null && _c !== void 0 ? _c : ' (Pack)').toString();
        const skuSuffix = ((_d = input.skuSuffix) !== null && _d !== void 0 ? _d : '-PACK').toString();
        const sourceId = String(input.sourceExternalProductId || '').trim();
        if (!sourceId)
            throw new Error('Indicá la publicación individual de origen (ID o link)');
        const packVariants = [];
        for (let i = 0; i < variantInputs.length; i++) {
            const vi = variantInputs[i];
            const items = yield bundleItemsWithStock(vi.items || []);
            if (!items.length)
                continue;
            packVariants.push({
                label: (vi.label || `Combo ${i + 1}`).trim(),
                items,
                rawItems: vi.items
            });
        }
        if (!packVariants.length)
            throw new Error('Cada variante debe tener al menos un color/componente');
        let newProductId = '';
        const bundleVariants = [];
        if (input.platform === 'mercadolibre') {
            const resolved = yield fetchMercadoLibreItemResolved(sourceId);
            if (!resolved)
                throw new Error('Publicación origen no encontrada en Mercado Libre');
            if (packVariants.length === 1) {
                const created = yield createMercadoLibrePackListingFromItem(resolved.item, {
                    titleSuffix,
                    skuSuffix,
                    availableQuantity: (0, publicationStockBundle_service_1.computeAvailableStockFromItems)(packVariants[0].items),
                    status: input.published === false ? 'paused' : 'active'
                });
                newProductId = created.itemId;
                bundleVariants.push({
                    label: packVariants[0].label,
                    externalVariantId: '',
                    items: packVariants[0].rawItems
                });
            }
            else {
                const created = yield createMercadoLibrePackListingWithVariants(resolved.item, packVariants, {
                    titleSuffix,
                    skuSuffix,
                    status: input.published === false ? 'paused' : 'active'
                });
                newProductId = created.itemId;
                packVariants.forEach((pv, idx) => {
                    bundleVariants.push({
                        label: pv.label,
                        externalVariantId: created.variationIds[idx] || '',
                        items: pv.rawItems
                    });
                });
            }
        }
        else {
            const tnSourceId = sourceId.replace(/\D/g, '') || sourceId;
            if (packVariants.length === 1) {
                const created = yield createTiendaNubePackListingFromProduct(tnSourceId, {
                    titleSuffix,
                    skuSuffix,
                    availableQuantity: (0, publicationStockBundle_service_1.computeAvailableStockFromItems)(packVariants[0].items),
                    published: input.published !== false
                });
                newProductId = String(created.productId);
                bundleVariants.push({
                    label: packVariants[0].label,
                    externalVariantId: String(created.variantId),
                    items: packVariants[0].rawItems
                });
            }
            else {
                const created = yield createTiendaNubePackListingWithVariants(tnSourceId, packVariants, {
                    titleSuffix,
                    skuSuffix,
                    published: input.published !== false
                });
                newProductId = String(created.productId);
                packVariants.forEach((pv, idx) => {
                    bundleVariants.push({
                        label: pv.label,
                        externalVariantId: String(created.variantIds[idx] || ''),
                        items: pv.rawItems
                    });
                });
            }
        }
        const group = yield (0, publicationStockBundle_service_1.savePublicationBundleGroup)({
            platform: input.platform,
            externalProductId: newProductId,
            listingLabel: ((_e = input.label) === null || _e === void 0 ? void 0 : _e.trim()) || null,
            variants: bundleVariants.map((v) => ({
                label: v.label,
                externalVariantId: v.externalVariantId,
                items: v.items
            }))
        });
        const n = group.variants.length;
        return {
            group,
            newExternalProductId: newProductId,
            sourceExternalProductId: (0, integrations_controller_1.normalizeMercadoLibreItemId)(sourceId) || sourceId,
            message: input.platform === 'mercadolibre'
                ? `Publicación pack en ML (${newProductId}) con ${n} variante(s) de colores y mismas fotos`
                : `Producto pack en TN (${newProductId}) con ${n} variante(s) y mismas imágenes`
        };
    });
}
