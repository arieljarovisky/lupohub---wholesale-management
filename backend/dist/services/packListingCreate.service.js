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
exports.mlBestPictureUrl = mlBestPictureUrl;
exports.mlItemUsesFamilyNameModel = mlItemUsesFamilyNameModel;
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
/** URL de mejor calidad para mostrar y publicar (ML suele entregar -I; usamos -O). */
function mlBestPictureUrl(p) {
    const candidates = [p === null || p === void 0 ? void 0 : p.secure_url, p === null || p === void 0 ? void 0 : p.url, p === null || p === void 0 ? void 0 : p.max_size];
    if ((p === null || p === void 0 ? void 0 : p.size) && typeof p.size === 'object') {
        candidates.push(...Object.values(p.size));
    }
    for (const raw of candidates) {
        let u = String(raw !== null && raw !== void 0 ? raw : '').trim();
        if (!u.startsWith('http'))
            continue;
        if (/mlstatic\.com/i.test(u)) {
            u = u.replace(/-([A-Z])\.(jpe?g|png|webp)/gi, '-O.$2');
        }
        return u;
    }
    return '';
}
function collectMlPicturesFromItem(item) {
    const seen = new Set();
    const out = [];
    for (const p of Array.isArray(item === null || item === void 0 ? void 0 : item.pictures) ? item.pictures : []) {
        const url = mlBestPictureUrl(p);
        if (!url || seen.has(url))
            continue;
        seen.add(url);
        out.push({ url, pictureId: (p === null || p === void 0 ? void 0 : p.id) != null ? String(p.id) : undefined });
    }
    return out;
}
function mlPicturesPayload(content, fallbackItem) {
    var _a;
    if ((_a = content === null || content === void 0 ? void 0 : content.pictures) === null || _a === void 0 ? void 0 : _a.length) {
        const selected = content.pictures.filter((p) => p.selected !== false);
        const payload = selected
            .map((p) => {
            var _a;
            if ((_a = p.pictureId) === null || _a === void 0 ? void 0 : _a.trim())
                return { id: p.pictureId.trim() };
            const url = String(p.url || '').trim();
            if (url.startsWith('http'))
                return { source: url };
            return null;
        })
            .filter(Boolean);
        if (payload.length)
            return payload;
    }
    if (fallbackItem)
        return mlPicturesFromItem(fallbackItem);
    return [];
}
function mlPicturesFromItem(item) {
    return collectMlPicturesFromItem(item)
        .map((p) => {
        if (p.pictureId)
            return { id: p.pictureId };
        return { source: p.url };
    })
        .filter((x) => x.id || x.source);
}
function applyMlItemDescription(itemId, description, accessToken) {
    return __awaiter(this, void 0, void 0, function* () {
        const text = String(description || '').trim();
        if (!text)
            return;
        const headers = {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        };
        yield axios_1.default.post(`https://api.mercadolibre.com/items/${itemId}/description`, { plain_text: text }, { headers, validateStatus: () => true });
    });
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
const ML_COLOR_ATTR_IDS = new Set(['COLOR', 'COLOUR', 'COR']);
const ML_SIZE_ATTR_IDS = new Set(['SIZE', 'SIZE_TYPE', 'TALLE', 'TALLA']);
function mlAttrIdUpper(id) {
    return String(id || '').trim().toUpperCase();
}
function mlColorSizeFromVariation(v, fallbackTitle) {
    let color = '';
    let size = '';
    ((v === null || v === void 0 ? void 0 : v.attribute_combinations) || []).forEach((attr) => {
        const id = mlAttrIdUpper(attr === null || attr === void 0 ? void 0 : attr.id);
        const name = ((attr === null || attr === void 0 ? void 0 : attr.value_name) || (attr === null || attr === void 0 ? void 0 : attr.name) || '').toString().trim();
        if (ML_COLOR_ATTR_IDS.has(id))
            color = name;
        if (ML_SIZE_ATTR_IDS.has(id))
            size = name;
    });
    if ((!color || !size) && fallbackTitle) {
        const parsed = (0, integrations_controller_1.mlColorSizeFromTitle)(fallbackTitle);
        if (!color)
            color = parsed.color;
        if (!size)
            size = parsed.size;
    }
    return { color: color || 'Único', size: size || 'U' };
}
/** Atributos de variación que exige la publicación origen (p. ej. Color + Talle). */
function mlVariationAttrTemplates(sourceItem) {
    const seen = new Set();
    const out = [];
    for (const v of Array.isArray(sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.variations) ? sourceItem.variations : []) {
        for (const ac of Array.isArray(v === null || v === void 0 ? void 0 : v.attribute_combinations) ? v.attribute_combinations : []) {
            const id = String((ac === null || ac === void 0 ? void 0 : ac.id) || '').trim();
            if (!id || seen.has(id))
                continue;
            seen.add(id);
            out.push({ id, name: ac === null || ac === void 0 ? void 0 : ac.name });
        }
    }
    if (!out.length) {
        out.push({ id: 'COLOR', name: 'Color' }, { id: 'SIZE', name: 'Talle' });
    }
    return out;
}
function mlValueForVariationAttr(attrId, opts) {
    const id = mlAttrIdUpper(attrId);
    if (ML_COLOR_ATTR_IDS.has(id))
        return opts.color || opts.label || 'Único';
    if (ML_SIZE_ATTR_IDS.has(id))
        return opts.size || 'U';
    return opts.label || opts.color || 'Único';
}
function buildMlVariationAttributeCombinations(templates, opts) {
    return templates.map((t) => ({
        id: t.id,
        name: t.name,
        value_name: mlValueForVariationAttr(t.id, opts)
    }));
}
function formatMlCreateError(postRes) {
    var _a, _b, _c;
    const causes = Array.isArray((_a = postRes.data) === null || _a === void 0 ? void 0 : _a.cause)
        ? postRes.data.cause.map((c) => c.message || c.code || JSON.stringify(c)).filter(Boolean)
        : [];
    const base = ((_b = postRes.data) === null || _b === void 0 ? void 0 : _b.message) ||
        ((_c = postRes.data) === null || _c === void 0 ? void 0 : _c.error) ||
        causes.join('; ') ||
        postRes.statusText ||
        'error desconocido';
    return causes.length ? `${base} (${causes.join('; ')})` : String(base);
}
function resolvePackVariantColorSize(packItems, sourceItem, label) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        let color = '';
        let size = '';
        const ids = packItems.map((i) => i.variantId).filter(Boolean);
        if (ids.length) {
            const placeholders = ids.map(() => '?').join(',');
            const rows = (yield (0, db_1.query)(`SELECT pv.id, c.name AS color_name, s.size_code AS size_code
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN colors c ON c.id = pc.color_id
       JOIN sizes s ON s.id = pv.size_id
       WHERE pv.id IN (${placeholders})`, ids));
            if (rows.length) {
                const sizes = [...new Set(rows.map((r) => String(r.size_code || '').trim()).filter(Boolean))];
                if (sizes.length === 1)
                    size = sizes[0];
                else if (sizes.length > 1)
                    size = sizes[0];
                const colors = rows.map((r) => String(r.color_name || '').trim()).filter(Boolean);
                if (colors.length === 1)
                    color = colors[0];
                else if (colors.length > 1)
                    color = label.trim() || colors.join(' / ');
            }
        }
        const title = String((sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.title) || '').trim();
        const fromSource = mlColorSizeFromVariation((_a = sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.variations) === null || _a === void 0 ? void 0 : _a[0], title);
        if (!size)
            size = fromSource.size;
        if (!color)
            color = label.trim() || fromSource.color;
        return { color: color || 'Único', size: size || 'U' };
    });
}
function mlAttributesForDuplicate(item, skuSuffix) {
    if (!Array.isArray(item === null || item === void 0 ? void 0 : item.attributes))
        return [];
    const baseSku = mlSkuFromItem(item);
    const newSku = baseSku ? `${baseSku}${skuSuffix}` : '';
    return item.attributes.map((a) => {
        const id = ((a === null || a === void 0 ? void 0 : a.id) || '').toUpperCase();
        if (id === 'SELLER_SKU' && newSku) {
            return Object.assign(Object.assign({}, a), { value_name: newSku, value: newSku });
        }
        return Object.assign({}, a);
    });
}
/** Publicaciones catalogadas / User Products: exigen family_name + price + available_quantity y variations con COLOR/Talle. */
function mlItemUsesFamilyNameModel(item) {
    if (mlFamilyNameFromItem(item))
        return true;
    const up = item === null || item === void 0 ? void 0 : item.user_product_id;
    if (up != null && String(up).trim() !== '')
        return true;
    if ((item === null || item === void 0 ? void 0 : item.catalog_listing) === true)
        return true;
    return false;
}
function mlFamilyNameFromItem(item) {
    var _a, _b, _c;
    const direct = String((_a = item === null || item === void 0 ? void 0 : item.family_name) !== null && _a !== void 0 ? _a : '').trim();
    if (direct)
        return direct;
    const attr = (Array.isArray(item === null || item === void 0 ? void 0 : item.attributes) ? item.attributes : []).find((a) => String((a === null || a === void 0 ? void 0 : a.id) || '').toUpperCase() === 'FAMILY_NAME');
    return ((_c = (_b = attr === null || attr === void 0 ? void 0 : attr.value_name) !== null && _b !== void 0 ? _b : attr === null || attr === void 0 ? void 0 : attr.value) !== null && _c !== void 0 ? _c : '').toString().trim();
}
function mlCommonItemFields(sourceItem, pictures) {
    const out = {
        category_id: sourceItem.category_id,
        currency_id: sourceItem.currency_id || 'ARS',
        buying_mode: sourceItem.buying_mode || 'buy_it_now',
        listing_type_id: sourceItem.listing_type_id || 'gold_special',
        condition: sourceItem.condition || 'new',
        pictures
    };
    if (sourceItem.video_id)
        out.video_id = sourceItem.video_id;
    if (Array.isArray(sourceItem.sale_terms) && sourceItem.sale_terms.length) {
        out.sale_terms = sourceItem.sale_terms;
    }
    if (sourceItem.shipping && typeof sourceItem.shipping === 'object') {
        out.shipping = sourceItem.shipping;
    }
    return out;
}
function postMercadoLibreNewItem(accessToken, body) {
    return __awaiter(this, void 0, void 0, function* () {
        const postRes = yield axios_1.default.post('https://api.mercadolibre.com/items', body, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            validateStatus: () => true
        });
        if (postRes.status !== 201 && postRes.status !== 200) {
            throw new Error(`Mercado Libre rechazó la creación: ${formatMlCreateError(postRes)}`);
        }
        const newItem = postRes.data;
        const itemId = String((newItem === null || newItem === void 0 ? void 0 : newItem.id) || '');
        if (!itemId)
            throw new Error('Mercado Libre no devolvió el ID de la nueva publicación');
        return newItem;
    });
}
function applyDescriptionFromSource(newItemId, sourceItem, accessToken, descriptionOverride) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        let description = (descriptionOverride === null || descriptionOverride === void 0 ? void 0 : descriptionOverride.trim()) || '';
        if (!description) {
            try {
                const descRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${sourceItem.id}/description`, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    validateStatus: () => true
                });
                if (descRes.status === 200)
                    description = String(((_a = descRes.data) === null || _a === void 0 ? void 0 : _a.plain_text) || '').trim();
            }
            catch (_b) {
                /* opcional */
            }
        }
        yield applyMlItemDescription(newItemId, description, accessToken);
    });
}
/** Plantilla COLOR + Talle para family_name (ML catalogado). */
function mlPackVariationAttrTemplates(sourceItem, useFamilyName) {
    if (useFamilyName) {
        return [
            { id: 'COLOR', name: 'Color' },
            { id: 'SIZE', name: 'Talle' }
        ];
    }
    return mlVariationAttrTemplates(sourceItem);
}
function buildMlPackVariations(sourceItem, packVariants, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        const attrTemplates = mlPackVariationAttrTemplates(sourceItem, opts.useFamilyName);
        const baseSku = mlSkuFromItem(sourceItem);
        return Promise.all(packVariants.map((pv, idx) => __awaiter(this, void 0, void 0, function* () {
            const stock = (0, publicationStockBundle_service_1.computeAvailableStockFromItems)(pv.items);
            const comboLabel = (pv.label || `Combo ${idx + 1}`).trim();
            const { color, size } = yield resolvePackVariantColorSize(pv.items, sourceItem, comboLabel);
            const colorForMl = opts.useFamilyName ? comboLabel || color : color;
            const varSku = baseSku && packVariants.length > 1
                ? `${baseSku}${opts.skuSuffix}-${idx + 1}`
                : baseSku
                    ? `${baseSku}${opts.skuSuffix}`
                    : `${opts.skuSuffix}-${idx + 1}`;
            const row = {
                attribute_combinations: buildMlVariationAttributeCombinations(attrTemplates, {
                    color: colorForMl,
                    size,
                    label: comboLabel
                }),
                available_quantity: Math.max(0, Math.floor(stock)),
                price: opts.price
            };
            if (varSku)
                row.seller_custom_field = varSku;
            return row;
        })));
    });
}
function createMercadoLibrePackListingWithFamilyName(sourceItem, packVariants, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const mlToken = yield (0, integrations_controller_1.getValidMLToken)();
        if (!mlToken)
            throw new Error('No hay integración con Mercado Libre');
        if (!packVariants.length)
            throw new Error('Agregá al menos una combinación de colores');
        const familyName = mlFamilyNameFromItem(sourceItem);
        if (!familyName) {
            throw new Error('Esta publicación en ML usa family_name. La publicación origen no trae family_name; elegí una publicación individual del mismo producto como base.');
        }
        const pictures = mlPicturesPayload(opts.content, sourceItem);
        if (!pictures.length)
            throw new Error('Seleccioná al menos una foto para la publicación');
        const title = ((_b = (_a = opts.content) === null || _a === void 0 ? void 0 : _a.title) === null || _b === void 0 ? void 0 : _b.trim()) ||
            appendTitleSuffix(String(sourceItem.title || 'Pack'), opts.titleSuffix);
        const price = ((_c = opts.content) === null || _c === void 0 ? void 0 : _c.price) != null && Number.isFinite(Number(opts.content.price))
            ? Number(opts.content.price)
            : Number(sourceItem.price) || 0;
        const variations = yield buildMlPackVariations(sourceItem, packVariants, {
            skuSuffix: opts.skuSuffix,
            price,
            useFamilyName: true
        });
        const variationQty = variations.reduce((sum, v) => sum + Math.max(0, Number(v.available_quantity) || 0), 0);
        const itemQty = Math.max(0, packVariants.length === 1
            ? (0, publicationStockBundle_service_1.computeAvailableStockFromItems)(packVariants[0].items)
            : variationQty);
        const body = Object.assign(Object.assign({ title, family_name: familyName, price, available_quantity: itemQty }, mlCommonItemFields(sourceItem, pictures)), { variations });
        const attrs = mlAttributesForDuplicate(sourceItem, opts.skuSuffix);
        if (attrs.length)
            body.attributes = attrs;
        if (opts.status === 'paused')
            body.status = 'paused';
        const newItem = yield postMercadoLibreNewItem(mlToken.access_token, body);
        const itemId = String(newItem.id);
        const variationIds = (Array.isArray(newItem.variations) ? newItem.variations : []).map((v) => String((v === null || v === void 0 ? void 0 : v.id) || ''));
        yield applyDescriptionFromSource(itemId, sourceItem, mlToken.access_token, (_d = opts.content) === null || _d === void 0 ? void 0 : _d.description);
        return { itemId, item: newItem, variationIds };
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
            const images = collectMlPicturesFromItem(item);
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
            .map((im) => {
            const url = (im === null || im === void 0 ? void 0 : im.src) ? String(im.src).trim() : '';
            return url.startsWith('http') ? { url, pictureId: (im === null || im === void 0 ? void 0 : im.id) != null ? String(im.id) : undefined } : null;
        })
            .filter(Boolean);
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
        const pictures = mlPicturesPayload(opts.content, sourceItem);
        if (!pictures.length) {
            throw new Error('Seleccioná al menos una foto para la publicación');
        }
        const title = ((_b = (_a = opts.content) === null || _a === void 0 ? void 0 : _a.title) === null || _b === void 0 ? void 0 : _b.trim()) ||
            appendTitleSuffix(String(sourceItem.title || 'Pack'), opts.titleSuffix);
        const price = ((_c = opts.content) === null || _c === void 0 ? void 0 : _c.price) != null && Number.isFinite(Number(opts.content.price))
            ? Number(opts.content.price)
            : Number(sourceItem.price) || 0;
        if (mlItemUsesFamilyNameModel(sourceItem)) {
            const created = yield createMercadoLibrePackListingWithFamilyName(sourceItem, [
                {
                    label: (opts.packLabel || '').trim(),
                    items: opts.packItems || []
                }
            ], {
                titleSuffix: opts.titleSuffix,
                skuSuffix: opts.skuSuffix,
                status: opts.status,
                content: opts.content
            });
            return { itemId: created.itemId, item: created.item };
        }
        const attrTemplates = mlVariationAttrTemplates(sourceItem);
        const sourceHasVariations = Array.isArray(sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.variations) && sourceItem.variations.length > 0;
        const useVariations = sourceHasVariations && attrTemplates.length > 0;
        const body = Object.assign({ title }, mlCommonItemFields(sourceItem, pictures));
        const attrs = mlAttributesForDuplicate(sourceItem, opts.skuSuffix);
        if (attrs.length)
            body.attributes = attrs;
        const sku = mlSkuFromItem(sourceItem);
        const packLabel = (opts.packLabel || '').trim();
        const packItems = opts.packItems || [];
        if (useVariations) {
            const { color, size } = yield resolvePackVariantColorSize(packItems, sourceItem, packLabel);
            body.variations = [
                {
                    attribute_combinations: buildMlVariationAttributeCombinations(attrTemplates, {
                        color,
                        size,
                        label: packLabel || title
                    }),
                    available_quantity: Math.max(0, Math.floor(opts.availableQuantity)),
                    price,
                    seller_custom_field: sku ? `${sku}${opts.skuSuffix}` : `${opts.skuSuffix}`
                }
            ];
        }
        else {
            body.price = price;
            body.available_quantity = Math.max(0, Math.floor(opts.availableQuantity));
            if (sku)
                body.seller_custom_field = `${sku}${opts.skuSuffix}`;
        }
        if (opts.status === 'paused')
            body.status = 'paused';
        const newItem = yield postMercadoLibreNewItem(mlToken.access_token, body);
        const itemId = String(newItem.id);
        yield applyDescriptionFromSource(itemId, sourceItem, mlToken.access_token, (_d = opts.content) === null || _d === void 0 ? void 0 : _d.description);
        return { itemId, item: newItem };
    });
}
function createMercadoLibrePackListingWithVariants(sourceItem, packVariants, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const mlToken = yield (0, integrations_controller_1.getValidMLToken)();
        if (!mlToken)
            throw new Error('No hay integración con Mercado Libre');
        const pictures = mlPicturesPayload(opts.content, sourceItem);
        if (!pictures.length)
            throw new Error('Seleccioná al menos una foto para la publicación');
        if (!packVariants.length)
            throw new Error('Agregá al menos una combinación de colores');
        const basePrice = ((_a = opts.content) === null || _a === void 0 ? void 0 : _a.price) != null && Number.isFinite(Number(opts.content.price))
            ? Number(opts.content.price)
            : Number(sourceItem.price) || 0;
        if (mlItemUsesFamilyNameModel(sourceItem)) {
            return createMercadoLibrePackListingWithFamilyName(sourceItem, packVariants, {
                titleSuffix: opts.titleSuffix,
                skuSuffix: opts.skuSuffix,
                status: opts.status,
                content: opts.content
            });
        }
        const variations = yield buildMlPackVariations(sourceItem, packVariants, {
            skuSuffix: opts.skuSuffix,
            price: basePrice,
            useFamilyName: false
        });
        const title = ((_c = (_b = opts.content) === null || _b === void 0 ? void 0 : _b.title) === null || _c === void 0 ? void 0 : _c.trim()) ||
            appendTitleSuffix(String(sourceItem.title || 'Pack'), opts.titleSuffix);
        const body = Object.assign(Object.assign({ title }, mlCommonItemFields(sourceItem, pictures)), { variations });
        const attrs = mlAttributesForDuplicate(sourceItem, opts.skuSuffix);
        if (attrs.length)
            body.attributes = attrs;
        if (opts.status === 'paused')
            body.status = 'paused';
        const newItem = yield postMercadoLibreNewItem(mlToken.access_token, body);
        const itemId = String(newItem.id);
        const variationIds = (Array.isArray(newItem.variations) ? newItem.variations : []).map((v) => String((v === null || v === void 0 ? void 0 : v.id) || ''));
        yield applyDescriptionFromSource(itemId, sourceItem, mlToken.access_token, (_d = opts.content) === null || _d === void 0 ? void 0 : _d.description);
        return { itemId, item: newItem, variationIds };
    });
}
function tnImagesFromContent(content, product) {
    var _a;
    if ((_a = content === null || content === void 0 ? void 0 : content.pictures) === null || _a === void 0 ? void 0 : _a.length) {
        const imgs = content.pictures
            .filter((p) => p.selected !== false)
            .map((p) => String(p.url || '').trim())
            .filter((u) => u.startsWith('http'))
            .map((src) => ({ src }));
        if (imgs.length)
            return imgs;
    }
    return (Array.isArray(product === null || product === void 0 ? void 0 : product.images) ? product.images : [])
        .map((im) => ((im === null || im === void 0 ? void 0 : im.src) ? { src: String(im.src) } : null))
        .filter(Boolean);
}
function tnDescriptionFromContent(content, product) {
    var _a;
    const text = (_a = content === null || content === void 0 ? void 0 : content.description) === null || _a === void 0 ? void 0 : _a.trim();
    if (text)
        return { es: text, en: text, pt: text };
    const base = product === null || product === void 0 ? void 0 : product.description;
    if (base && typeof base === 'object')
        return Object.assign({}, base);
    if (typeof base === 'string' && base.trim())
        return { es: base.trim(), en: '', pt: '' };
    return { es: '', en: '', pt: '' };
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
        var _a, _b, _c, _d, _e, _f, _g;
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
        if (((_a = opts.content) === null || _a === void 0 ? void 0 : _a.price) != null && Number.isFinite(Number(opts.content.price))) {
            packVariant.price = String(opts.content.price);
        }
        const tnName = ((_c = (_b = opts.content) === null || _b === void 0 ? void 0 : _b.title) === null || _c === void 0 ? void 0 : _c.trim())
            ? { es: opts.content.title.trim(), en: opts.content.title.trim(), pt: opts.content.title.trim() }
            : appendSuffixToLocalizedName(p.name, opts.titleSuffix);
        const body = {
            name: tnName,
            description: tnDescriptionFromContent(opts.content, p),
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
        const imgs = tnImagesFromContent(opts.content, p);
        if (imgs.length > 0)
            body.images = imgs.slice(0, 250);
        else
            throw new Error('Seleccioná al menos una imagen para la publicación');
        const url = `https://api.tiendanube.com/v1/${storeId}/products`;
        const postHeaders = Object.assign(Object.assign({}, headers), { 'Content-Type': 'application/json' });
        const r = yield (0, tiendanubeClient_1.tnPostWithRetry)(axios_1.default, url, body, { headers: postHeaders, validateStatus: () => true });
        if (r.status !== 201) {
            const detail = ((_d = r.data) === null || _d === void 0 ? void 0 : _d.description) || ((_e = r.data) === null || _e === void 0 ? void 0 : _e.message) || r.statusText;
            throw new Error(`Tienda Nube rechazó la creación: ${detail}`);
        }
        const newId = Number((_f = r.data) === null || _f === void 0 ? void 0 : _f.id);
        if (!Number.isFinite(newId))
            throw new Error('Tienda Nube no devolvió el ID del nuevo producto');
        const newVariants = yield fetchAllTnVariants(storeId, integration.access_token, String(newId));
        const variantId = Number((_g = newVariants[0]) === null || _g === void 0 ? void 0 : _g.id);
        if (!Number.isFinite(variantId)) {
            throw new Error('No se pudo obtener la variante del nuevo producto en Tienda Nube');
        }
        return { productId: newId, variantId };
    });
}
function createTiendaNubePackListingWithVariants(sourceProductId, packVariants, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
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
        const basePrice = ((_a = opts.content) === null || _a === void 0 ? void 0 : _a.price) != null && Number.isFinite(Number(opts.content.price))
            ? String(opts.content.price)
            : null;
        const attrNames = (Array.isArray(p.attributes) ? p.attributes : []).map((a) => localizedTnText(a).toLowerCase());
        const tnVariants = yield Promise.all(packVariants.map((pv, idx) => __awaiter(this, void 0, void 0, function* () {
            const stock = (0, publicationStockBundle_service_1.computeAvailableStockFromItems)(pv.items);
            const comboLabel = (pv.label || `Combo ${idx + 1}`).trim();
            const { color, size } = yield resolvePackVariantColorSize(pv.items, {}, comboLabel);
            const values = valueTemplate.length > 0
                ? valueTemplate.map((val, i) => {
                    const attrLabel = attrNames[i] || '';
                    let text = comboLabel;
                    if (/color/i.test(attrLabel))
                        text = color;
                    else if (/talle|talla|size/i.test(attrLabel))
                        text = size;
                    else if (i === 0)
                        text = color;
                    else if (i === 1)
                        text = size;
                    return Object.assign(Object.assign({}, val), { es: text, en: text, pt: text });
                })
                : [
                    { es: color, en: color, pt: color },
                    { es: size, en: size, pt: size }
                ];
            const row = Object.assign(Object.assign({}, stripVariantForTiendaNubeCreate(baseVariant, `${opts.skuSuffix}-${idx + 1}`, idx, stock)), { values });
            if (basePrice)
                row.price = basePrice;
            return row;
        })));
        const tnName = ((_c = (_b = opts.content) === null || _b === void 0 ? void 0 : _b.title) === null || _c === void 0 ? void 0 : _c.trim())
            ? { es: opts.content.title.trim(), en: opts.content.title.trim(), pt: opts.content.title.trim() }
            : appendSuffixToLocalizedName(p.name, opts.titleSuffix);
        const body = {
            name: tnName,
            description: tnDescriptionFromContent(opts.content, p),
            attributes: Array.isArray(p.attributes) ? p.attributes : [],
            categories: tiendaNubeCategoryIdsOnly(p.categories),
            published: opts.published,
            free_shipping: !!p.free_shipping,
            tags: typeof p.tags === 'string' ? p.tags : '',
            variants: tnVariants
        };
        if (p.brand != null && String(p.brand).trim() !== '')
            body.brand = p.brand;
        const imgs = tnImagesFromContent(opts.content, p);
        if (imgs.length > 0)
            body.images = imgs.slice(0, 250);
        else
            throw new Error('Seleccioná al menos una imagen para la publicación');
        const url = `https://api.tiendanube.com/v1/${storeId}/products`;
        const postHeaders = Object.assign(Object.assign({}, headers), { 'Content-Type': 'application/json' });
        const r = yield (0, tiendanubeClient_1.tnPostWithRetry)(axios_1.default, url, body, { headers: postHeaders, validateStatus: () => true });
        if (r.status !== 201) {
            const detail = ((_d = r.data) === null || _d === void 0 ? void 0 : _d.description) || ((_e = r.data) === null || _e === void 0 ? void 0 : _e.message) || r.statusText;
            throw new Error(`Tienda Nube rechazó la creación: ${detail}`);
        }
        const newId = Number((_f = r.data) === null || _f === void 0 ? void 0 : _f.id);
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
                    status: input.published === false ? 'paused' : 'active',
                    content: input.publicationContent,
                    packItems: packVariants[0].items,
                    packLabel: packVariants[0].label
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
                    status: input.published === false ? 'paused' : 'active',
                    content: input.publicationContent
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
                    published: input.published !== false,
                    content: input.publicationContent
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
                    published: input.published !== false,
                    content: input.publicationContent
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
