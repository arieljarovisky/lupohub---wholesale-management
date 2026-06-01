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
exports.createPackListingAndBundle = exports.createTiendaNubePackListingWithVariants = exports.createTiendaNubePackListingFromProduct = exports.createMercadoLibrePackListingWithVariants = exports.createMercadoLibrePackListingFromItem = exports.fetchMercadoLibreItemResolved = exports.fetchListingPackVariations = exports.splitColorComboLabel = exports.fetchPublicationSourcePreview = exports.buildMlFashionGridPreview = exports.mlItemUsesFamilyNameModel = exports.mlCreateErrorRequiresUserProduct = exports.summarizeMlItemCreateBody = exports.mlPayloadForMercadoLibreApiPost = exports.sanitizeMercadoLibreItemCreateBody = exports.validateMlPayload = exports.buildMercadoLibreItemPayload = exports.mlBestPictureUrl = void 0;
const axios_1 = __importDefault(require("axios"));
const db_1 = require("../database/db");
const integrations_controller_1 = require("../controllers/integrations.controller");
const tiendanubeClient_1 = require("../utils/tiendanubeClient");
const talles_tango_1 = require("../talles-tango");
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
exports.mlBestPictureUrl = mlBestPictureUrl;
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
/** ID de foto ML (ej. 760054-MLA109651780820_042026), no IDs de atributos BRAND/COLOR. */
function looksLikeMlPictureId(id) {
    const s = String(id || '').trim();
    if (!s || /^https?:\/\//i.test(s))
        return false;
    if (/^[A-Z][A-Z0-9_]{2,}$/.test(s) && !/-MLA/i.test(s))
        return false;
    return /-MLA/i.test(s) || /^\d{4,}-/.test(s);
}
function sanitizeMlPicturesForApi(raw) {
    var _a, _b, _c, _d;
    if (!Array.isArray(raw))
        return [];
    const out = [];
    const seen = new Set();
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object')
            continue;
        const e = entry;
        if (e.value_name != null && e.id != null && !looksLikeMlPictureId(String(e.id)))
            continue;
        const id = String((_a = e.id) !== null && _a !== void 0 ? _a : '').trim();
        const source = String((_d = (_c = (_b = e.source) !== null && _b !== void 0 ? _b : e.secure_url) !== null && _c !== void 0 ? _c : e.url) !== null && _d !== void 0 ? _d : '').trim();
        if (id && looksLikeMlPictureId(id)) {
            const key = `id:${id}`;
            if (!seen.has(key)) {
                seen.add(key);
                out.push({ id });
            }
            continue;
        }
        if (source.startsWith('http')) {
            const key = `src:${source}`;
            if (!seen.has(key)) {
                seen.add(key);
                out.push({ source });
            }
        }
    }
    return out;
}
function mlNormalizeSizeLabel(size) {
    return String(size || '')
        .trim()
        .toLowerCase()
        .replace(/^talle\s+/i, '')
        .replace(/único/g, 'unico');
}
/** Código numérico (130) + letra Tango (P) + alias ML (S, EG…) para buscar variación / guía. */
function mlSizeLabelsForMatch(size) {
    var _a;
    const raw = String(size || '').trim();
    const out = new Set();
    const push = (s) => {
        const t = mlNormalizeSizeLabel(s);
        if (t)
            out.add(t);
    };
    push(raw);
    if (/^\d{2,3}$/.test(raw)) {
        const letter = (0, talles_tango_1.nombreTalleDesdeCodigo)(raw);
        push(letter);
        for (const alias of talles_tango_1.TALLE_LETRAS_EQUIVALENTES[raw] || [])
            push(alias);
        const range = talles_tango_1.TALLE_CODIGO_A_RANGO_ML[raw];
        if (range) {
            push(range);
            push(range.replace(/-/g, ' '));
            const parts = range.split('-').map((p) => p.trim()).filter(Boolean);
            for (const p of parts)
                push(p);
            push(`${letter} ${range}`);
            push(`talle ${letter} ${range}`);
        }
    }
    else {
        push((0, talles_tango_1.nombreTalleDesdeCodigo)(raw));
        const code = (_a = Object.entries(talles_tango_1.TALLE_CODIGO_A_NOMBRE).find(([, name]) => name.toLowerCase() === raw.toLowerCase())) === null || _a === void 0 ? void 0 : _a[0];
        if (code && talles_tango_1.TALLE_CODIGO_A_RANGO_ML[code]) {
            const range = talles_tango_1.TALLE_CODIGO_A_RANGO_ML[code];
            push(range);
            push(`${raw} ${range}`);
        }
    }
    return [...out];
}
function mlLabelMatchesChartToken(label, token) {
    if (!label || !token)
        return false;
    if (label === token)
        return true;
    if (token.includes(label) || label.includes(token))
        return true;
    if (label.length >= 1 && (token.startsWith(`${label} `) || token.startsWith(`${label}-`)))
        return true;
    return false;
}
function mlChartRowTextTokens(row) {
    const tokens = new Set();
    const visit = (node, depth = 0) => {
        if (depth > 10 || node == null)
            return;
        if (typeof node === 'string' || typeof node === 'number') {
            const raw = String(node).trim();
            if (!raw || raw.length > 120)
                return;
            const norm = mlNormalizeSizeLabel(raw);
            if (norm)
                tokens.add(norm);
            for (const part of raw.split(/[\s,;/\-–—]+/)) {
                const p = mlNormalizeSizeLabel(part);
                if (p)
                    tokens.add(p);
            }
            return;
        }
        if (Array.isArray(node)) {
            for (const entry of node)
                visit(entry, depth + 1);
            return;
        }
        if (typeof node === 'object') {
            for (const value of Object.values(node))
                visit(value, depth + 1);
        }
    };
    visit(row);
    return tokens;
}
function mlSizeValueFromChartRow(row, sizeLabel) {
    var _a, _b, _c;
    const attrs = Array.isArray(row === null || row === void 0 ? void 0 : row.attributes) ? row.attributes : [];
    for (const att of attrs) {
        const attId = mlAttrIdUpper((_a = att === null || att === void 0 ? void 0 : att.id) !== null && _a !== void 0 ? _a : att === null || att === void 0 ? void 0 : att.name);
        if (attId !== 'SIZE' && !ML_SIZE_ATTR_IDS.has(attId))
            continue;
        const vals = Array.isArray(att === null || att === void 0 ? void 0 : att.values) ? att.values : [];
        for (const v of vals) {
            const name = String((_c = (_b = v === null || v === void 0 ? void 0 : v.name) !== null && _b !== void 0 ? _b : v === null || v === void 0 ? void 0 : v.value_name) !== null && _c !== void 0 ? _c : '').trim();
            if (name)
                return name;
        }
    }
    return mlSizeValueNameForMercadoLibre(sizeLabel);
}
/** Valor SIZE para POST ML: letra de catálogo (M), no código Tango (140). */
function mlSizeValueNameForMercadoLibre(sizeCode) {
    const raw = String(sizeCode || '').trim();
    if (!raw)
        return 'U';
    const letter = (0, talles_tango_1.nombreTalleDesdeCodigo)(raw);
    if (/^\d{2,3}$/.test(raw) && letter && letter !== raw)
        return letter;
    return raw;
}
function mlExtractAttributeValueName(entry) {
    var _a, _b, _c, _d, _e, _f, _g;
    let value_name = String((_a = entry.value_name) !== null && _a !== void 0 ? _a : '').trim();
    if (!value_name || value_name === 'null') {
        const valueId = entry.value_id;
        if (valueId != null && String(valueId).trim() !== '')
            value_name = String(valueId).trim();
    }
    if (!value_name)
        value_name = String((_b = entry.value) !== null && _b !== void 0 ? _b : '').trim();
    if (!value_name && Array.isArray(entry.values) && entry.values.length) {
        const v0 = entry.values[0];
        if (v0 && typeof v0 === 'object') {
            value_name = String((_g = (_f = (_d = (_c = v0.name) !== null && _c !== void 0 ? _c : v0.value_name) !== null && _d !== void 0 ? _d : (_e = v0.struct) === null || _e === void 0 ? void 0 : _e.number) !== null && _f !== void 0 ? _f : v0.id) !== null && _g !== void 0 ? _g : '').trim();
        }
    }
    const struct = entry.value_struct;
    if (!value_name && struct && struct.number != null) {
        value_name = String(struct.number).trim();
    }
    return value_name;
}
function mlRawEntryToCreateAttribute(entry) {
    var _a;
    if (!entry || typeof entry !== 'object')
        return null;
    const e = entry;
    const id = String((_a = e.id) !== null && _a !== void 0 ? _a : '').trim();
    if (!id || looksLikeMlPictureId(id))
        return null;
    const upper = mlAttrIdUpper(id);
    const value_name = mlExtractAttributeValueName(e);
    let value_id;
    const rawVid = e.value_id;
    if (rawVid != null && String(rawVid).trim() !== '') {
        const s = String(rawVid).trim();
        // ML exige value_id como string en POST /items (ej. SIZE_GRID_ID "2484883").
        value_id = s;
    }
    if (!value_name && value_id == null)
        return null;
    const out = { id: upper };
    if (value_name)
        out.value_name = value_name;
    if (value_id != null)
        out.value_id = value_id;
    if (upper === 'SIZE_GRID_ID' && out.value_id == null && value_name && /^\d+$/.test(value_name)) {
        out.value_id = value_name;
    }
    if (upper === 'SIZE_GRID_ROW_ID') {
        const rid = out.value_id != null && String(out.value_id).includes(':')
            ? String(out.value_id).trim()
            : value_name.includes(':')
                ? value_name
                : '';
        if (rid) {
            out.value_id = rid;
            delete out.value_name;
        }
    }
    return out;
}
function sanitizeMlCreateAttributes(raw) {
    if (!Array.isArray(raw))
        return [];
    const seen = new Set();
    const out = [];
    for (const entry of raw) {
        const attr = mlRawEntryToCreateAttribute(entry);
        if (!attr)
            continue;
        const key = mlAttrIdUpper(attr.id);
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(attr);
    }
    return out;
}
function sanitizeMlAttributesForApi(raw) {
    return sanitizeMlCreateAttributes(raw)
        .filter((a) => Boolean(a.value_name))
        .map((a) => ({ id: a.id, value_name: a.value_name }));
}
/** Formato que exige ML en POST /items (SIZE_GRID_ID y SIZE_GRID_ROW_ID con value_id). */
function mlAttributesForPostPayload(attrs) {
    return attrs
        .map((a) => {
        const id = mlAttrIdUpper(a.id);
        const row = { id };
        if (id === 'SIZE_GRID_ID' && a.value_id != null) {
            row.value_id = String(a.value_id);
            return row;
        }
        if (id === 'SIZE_GRID_ROW_ID') {
            const rowId = mlSizeGridRowIdValue(a);
            if (rowId)
                row.value_id = rowId;
            return row;
        }
        if (a.value_name)
            row.value_name = a.value_name;
        else if (a.value_id != null)
            row.value_id = a.value_id;
        return row;
    })
        .filter((row) => row.value_name != null || row.value_id != null);
}
function normalizeMlVariationAttributeCombinations(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw
        .map((a) => {
        var _a, _b;
        return ({
            id: String((_a = a === null || a === void 0 ? void 0 : a.id) !== null && _a !== void 0 ? _a : '').trim(),
            value_name: String((_b = a === null || a === void 0 ? void 0 : a.value_name) !== null && _b !== void 0 ? _b : '').trim()
        });
    })
        .filter((a) => a.id && a.value_name);
}
/** Clave única COLOR + SIZE para deduplicar variaciones. */
function mlVariationCombinationKey(attributeCombinations) {
    let color = '';
    let size = '';
    for (const a of attributeCombinations) {
        const id = mlAttrIdUpper(a.id);
        if (ML_COLOR_ATTR_IDS.has(id))
            color = a.value_name;
        if (ML_SIZE_ATTR_IDS.has(id))
            size = a.value_name;
    }
    return `${color}||${size}`;
}
function dedupeMlPackVariations(variations) {
    const byKey = new Map();
    const skippedKeys = [];
    for (const row of variations) {
        const ac = normalizeMlVariationAttributeCombinations(row.attribute_combinations);
        const key = mlVariationCombinationKey(ac);
        const existing = byKey.get(key);
        if (existing) {
            skippedKeys.push(key);
            const mergedQty = Math.max(0, Number(existing.available_quantity) || 0) +
                Math.max(0, Number(row.available_quantity) || 0);
            existing.available_quantity = mergedQty;
            continue;
        }
        byKey.set(key, Object.assign(Object.assign({}, row), { attribute_combinations: ac }));
    }
    return { variations: [...byKey.values()], skippedKeys };
}
function sanitizeMlVariationsForApi(raw) {
    if (!Array.isArray(raw) || !raw.length)
        return undefined;
    const mapped = raw.map((entry) => {
        var _a;
        const row = entry;
        const ac = normalizeMlVariationAttributeCombinations(row.attribute_combinations);
        const out = {
            price: Number(row.price),
            available_quantity: Math.max(0, Math.floor(Number(row.available_quantity) || 0)),
            attribute_combinations: ac
        };
        const sku = String((_a = row.seller_custom_field) !== null && _a !== void 0 ? _a : '').trim();
        if (sku)
            out.seller_custom_field = sku;
        return out;
    });
    return dedupeMlPackVariations(mapped).variations;
}
/** Atributos comerciales permitidos en POST /items (publicación clásica con variations). */
const ML_ITEM_CREATE_ATTR_ALLOWLIST_CLASSIC = new Set([
    'BRAND',
    'AGE_GROUP',
    'GENDER',
    'COMPOSITION',
    'MAIN_MATERIAL',
    'MALE_UNDERWEAR_TYPE',
    'MODEL',
    'SALE_FORMAT',
    'UNITS_PER_PACK'
]);
/** User Product (family_name, sin variations): solo atributos comerciales seguros. */
const ML_ITEM_CREATE_ATTR_ALLOWLIST_USER_PRODUCT = new Set([
    'BRAND',
    'COMPOSITION',
    'GENDER',
    'MAIN_MATERIAL',
    'MALE_UNDERWEAR_TYPE',
    'MODEL',
    'SALE_FORMAT',
    'UNITS_PER_PACK'
]);
/** Nunca enviar al crear (metadatos ML / flags internos). */
const ML_ITEM_CREATE_ATTR_BLOCKLIST = new Set([
    'GIFTABLE',
    'FILTRABLE_GENDER',
    'IS_EMERGING_BRAND',
    'IS_HIGHLIGHT_BRAND',
    'IS_TOM_BRAND',
    'ITEM_CONDITION'
]);
/** User Product: COLOR es de variación; SIZE/guía van a nivel ítem (una MLA por talle). */
const ML_USER_PRODUCT_ATTR_NEVER_SEND = new Set(['COLOR', ...ML_ITEM_CREATE_ATTR_BLOCKLIST]);
/** Guía de talles + SIZE en User Product (MLA429740). */
const ML_USER_PRODUCT_FASHION_ATTR_IDS = new Set(['SIZE_GRID_ID', 'SIZE_GRID_ROW_ID', 'SIZE']);
/** Impuestos y paquete obligatorios en MLA429740 (sin SIZE_GRID_ID fijo). */
const ML_MANDATORY_CATEGORY_ATTRIBUTE_IDS = new Set([
    'VALUE_ADDED_TAX',
    'IMPORT_DUTY',
    'SELLER_PACKAGE_HEIGHT',
    'SELLER_PACKAGE_WIDTH',
    'SELLER_PACKAGE_LENGTH',
    'SELLER_PACKAGE_WEIGHT'
]);
const ML_MANDATORY_CATEGORY_ATTRIBUTE_DEFAULTS = {
    VALUE_ADDED_TAX: { id: 'VALUE_ADDED_TAX', value_name: '21 %' },
    IMPORT_DUTY: { id: 'IMPORT_DUTY', value_name: '0 %' },
    SELLER_PACKAGE_HEIGHT: { id: 'SELLER_PACKAGE_HEIGHT', value_name: '25 cm' },
    SELLER_PACKAGE_WIDTH: { id: 'SELLER_PACKAGE_WIDTH', value_name: '18 cm' },
    SELLER_PACKAGE_LENGTH: { id: 'SELLER_PACKAGE_LENGTH', value_name: '5 cm' },
    SELLER_PACKAGE_WEIGHT: { id: 'SELLER_PACKAGE_WEIGHT', value_name: '59 g' }
};
/** Categorías que publican solo como User Product (family_name, sin variations). */
const ML_USER_PRODUCT_CATEGORY_IDS = new Set(['MLA429740']);
/** Claves solo para logs/debug; nunca deben ir al POST de ML. */
const ML_ITEM_BODY_INTERNAL_KEYS = new Set(['_flags', '_meta', '__debug']);
function stripMlInternalBodyKeys(body) {
    const out = {};
    for (const [key, value] of Object.entries(body)) {
        if (ML_ITEM_BODY_INTERNAL_KEYS.has(key) || key.startsWith('_'))
            continue;
        out[key] = value;
    }
    return out;
}
function sanitizeMlSaleTermsForApi(raw) {
    if (!Array.isArray(raw) || !raw.length)
        return undefined;
    const out = raw
        .map((st) => {
        var _a, _b;
        if (!st || typeof st !== 'object')
            return null;
        const id = String((_a = st.id) !== null && _a !== void 0 ? _a : '').trim();
        if (!id)
            return null;
        const row = { id };
        const valueId = st.value_id;
        if (valueId != null && String(valueId).trim() !== '')
            row.value_id = valueId;
        const valueName = String((_b = st.value_name) !== null && _b !== void 0 ? _b : '').trim();
        if (valueName)
            row.value_name = valueName;
        return row;
    })
        .filter(Boolean);
    return out.length ? out : undefined;
}
/** Solo atributos permitidos para el tipo de publicación; sin duplicados. */
function filterMlItemAttributesForCreatePost(attrs, opts) {
    const allowlist = (opts === null || opts === void 0 ? void 0 : opts.userProduct)
        ? ML_ITEM_CREATE_ATTR_ALLOWLIST_USER_PRODUCT
        : ML_ITEM_CREATE_ATTR_ALLOWLIST_CLASSIC;
    const seen = new Set();
    const out = [];
    for (const a of attrs) {
        const upper = mlAttrIdUpper(a.id);
        if (ML_MANDATORY_CATEGORY_ATTRIBUTE_IDS.has(upper)) {
            if (!a.value_name && a.value_id == null)
                continue;
            if (seen.has(upper))
                continue;
            seen.add(upper);
            out.push({ id: upper, value_name: a.value_name, value_id: a.value_id });
            continue;
        }
        if ((opts === null || opts === void 0 ? void 0 : opts.userProduct) && ML_USER_PRODUCT_FASHION_ATTR_IDS.has(upper)) {
            if (!a.value_name && a.value_id == null)
                continue;
            if (seen.has(upper))
                continue;
            seen.add(upper);
            out.push({ id: upper, value_name: a.value_name, value_id: a.value_id });
            continue;
        }
        if (opts === null || opts === void 0 ? void 0 : opts.userProduct) {
            if (ML_USER_PRODUCT_ATTR_NEVER_SEND.has(upper))
                continue;
            if (!allowlist.has(upper))
                continue;
        }
        else {
            if (ML_ITEM_CREATE_ATTR_BLOCKLIST.has(upper))
                continue;
            if (!allowlist.has(upper))
                continue;
        }
        if (!a.value_name && a.value_id == null)
            continue;
        if (seen.has(upper))
            continue;
        seen.add(upper);
        out.push({ id: upper, value_name: a.value_name, value_id: a.value_id });
    }
    return out;
}
/** Preserva atributos obligatorios de categoría desde el ítem origen o defaults. */
function mlMergeMandatoryCategoryAttributes(attrs, sourceRaw, categoryId) {
    const cat = String(categoryId || '').trim();
    if (!cat || !ML_USER_PRODUCT_CATEGORY_IDS.has(cat))
        return attrs;
    const sourceAttrs = sanitizeMlCreateAttributes(sourceRaw);
    let out = [...attrs];
    for (const attrId of ML_MANDATORY_CATEGORY_ATTRIBUTE_IDS) {
        const fromSource = sourceAttrs.find((a) => mlAttrIdUpper(a.id) === attrId);
        const hasSourceValue = fromSource && (fromSource.value_name || fromSource.value_id != null);
        const pick = hasSourceValue ? fromSource : ML_MANDATORY_CATEGORY_ATTRIBUTE_DEFAULTS[attrId];
        if (pick)
            out = upsertMlCreateAttribute(out, pick);
    }
    return out;
}
function logMlPayloadAttributeIds(payload, debugContext) {
    const attrs = Array.isArray(payload.attributes) ? payload.attributes : [];
    const ids = attrs.map((a) => { var _a; return String((_a = a === null || a === void 0 ? void 0 : a.id) !== null && _a !== void 0 ? _a : ''); }).filter(Boolean);
    const ctx = debugContext ? ` ${debugContext}` : '';
    console.log(`[ML] attribute ids before POST${ctx}`, ids);
}
function mlPickCreateAttributeFromList(attrs, attrId) {
    if (!Array.isArray(attrs))
        return null;
    for (const entry of attrs) {
        const attr = mlRawEntryToCreateAttribute(entry);
        if (attr && mlAttrIdUpper(attr.id) === mlAttrIdUpper(attrId))
            return attr;
    }
    return null;
}
function mlSizeGridRowIdValue(row) {
    var _a;
    if (!row)
        return '';
    const vid = row.value_id != null ? String(row.value_id).trim() : '';
    if (vid.includes(':'))
        return vid;
    const vn = String((_a = row.value_name) !== null && _a !== void 0 ? _a : '').trim();
    if (vn.includes(':'))
        return vn;
    return '';
}
function mlNormalizeSizeGridRowAttr(row) {
    const rowId = mlSizeGridRowIdValue(row);
    if (!rowId)
        return row;
    return { id: 'SIZE_GRID_ROW_ID', value_id: rowId };
}
function mlMakeSizeGridRowAttr(rowId) {
    return { id: 'SIZE_GRID_ROW_ID', value_id: String(rowId).trim() };
}
function mlVariationSizeMatchesLabels(varSizeName, labels) {
    const norm = mlNormalizeSizeLabel(varSizeName);
    if (!norm)
        return false;
    return labels.some((l) => l === norm);
}
function mlFindSourceVariationBySize(sourceItem, size) {
    var _a;
    const labels = mlSizeLabelsForMatch(size);
    if (!labels.length)
        return null;
    for (const v of Array.isArray(sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.variations) ? sourceItem.variations : []) {
        const ac = Array.isArray(v === null || v === void 0 ? void 0 : v.attribute_combinations) ? v.attribute_combinations : [];
        const varSize = ac.find((a) => ML_SIZE_ATTR_IDS.has(mlAttrIdUpper(a === null || a === void 0 ? void 0 : a.id)));
        if (mlVariationSizeMatchesLabels(String((_a = varSize === null || varSize === void 0 ? void 0 : varSize.value_name) !== null && _a !== void 0 ? _a : ''), labels))
            return v;
    }
    return null;
}
function mlSourceSizeGridId(sourceItem) {
    var _a, _b, _c, _d;
    const fromItem = mlPickCreateAttributeFromList(sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.attributes, 'SIZE_GRID_ID');
    const id = String((_b = (_a = fromItem === null || fromItem === void 0 ? void 0 : fromItem.value_id) !== null && _a !== void 0 ? _a : fromItem === null || fromItem === void 0 ? void 0 : fromItem.value_name) !== null && _b !== void 0 ? _b : '').trim();
    if (id && /^\d+$/.test(id))
        return id;
    for (const v of Array.isArray(sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.variations) ? sourceItem.variations : []) {
        const fromVar = mlPickCreateAttributeFromList(v === null || v === void 0 ? void 0 : v.attributes, 'SIZE_GRID_ID');
        const vid = String((_d = (_c = fromVar === null || fromVar === void 0 ? void 0 : fromVar.value_id) !== null && _c !== void 0 ? _c : fromVar === null || fromVar === void 0 ? void 0 : fromVar.value_name) !== null && _d !== void 0 ? _d : '').trim();
        if (vid && /^\d+$/.test(vid))
            return vid;
    }
    return '';
}
function mlSizeGridRowFromSourceItem(sourceItem, size) {
    const variation = mlFindSourceVariationBySize(sourceItem, size);
    if (variation) {
        const fromVar = mlPickCreateAttributeFromList(variation.attributes, 'SIZE_GRID_ROW_ID');
        if (fromVar)
            return mlNormalizeSizeGridRowAttr(fromVar);
    }
    const fromItem = mlPickCreateAttributeFromList(sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.attributes, 'SIZE_GRID_ROW_ID');
    if (fromItem)
        return mlNormalizeSizeGridRowAttr(fromItem);
    return null;
}
function mlSizeAttrFromSourceVariation(sourceItem, sizeLabel) {
    var _a;
    const variation = mlFindSourceVariationBySize(sourceItem, sizeLabel);
    if (!variation)
        return null;
    const fromVar = mlPickCreateAttributeFromList(variation.attributes, 'SIZE');
    if (fromVar === null || fromVar === void 0 ? void 0 : fromVar.value_name)
        return { id: 'SIZE', value_name: String(fromVar.value_name) };
    const ac = Array.isArray(variation.attribute_combinations) ? variation.attribute_combinations : [];
    for (const a of ac) {
        if (!ML_SIZE_ATTR_IDS.has(mlAttrIdUpper(a === null || a === void 0 ? void 0 : a.id)))
            continue;
        const vn = String((_a = a === null || a === void 0 ? void 0 : a.value_name) !== null && _a !== void 0 ? _a : '').trim();
        if (vn)
            return { id: 'SIZE', value_name: vn };
    }
    return null;
}
/** Solo SIZE (letra); SIZE_GRID_ID/ROW se resuelven en mlUserProductFashionAttrsFromSource. */
function mlSizeAttrForUserProduct(size) {
    const targetSize = String(size || '').trim();
    if (!targetSize)
        return null;
    return { id: 'SIZE', value_name: mlSizeValueNameForMercadoLibre(targetSize) };
}
function mlCollectGridTemplateRequiredAttrIds(specs) {
    const ids = new Set();
    const walk = (node) => {
        var _a;
        if (!node || typeof node !== 'object')
            return;
        if (Array.isArray(node)) {
            for (const entry of node)
                walk(entry);
            return;
        }
        const o = node;
        const tags = Array.isArray(o.tags) ? o.tags.map((t) => String(t)) : [];
        const id = String((_a = o.id) !== null && _a !== void 0 ? _a : '').trim();
        if (id && tags.includes('grid_template_required'))
            ids.add(mlAttrIdUpper(id));
        for (const value of Object.values(o))
            walk(value);
    };
    walk(specs);
    return [...ids];
}
function mlFetchGridTemplateRequiredAttrIds(accessToken, domainId) {
    return __awaiter(this, void 0, void 0, function* () {
        const id = String(domainId || '').trim();
        if (!id)
            return [];
        try {
            const res = yield axios_1.default.get(`https://api.mercadolibre.com/domains/${encodeURIComponent(id)}/technical_specs`, {
                params: { section: 'grids' },
                headers: { Authorization: `Bearer ${accessToken}` },
                validateStatus: () => true
            });
            if (res.status === 200 && res.data) {
                const found = mlCollectGridTemplateRequiredAttrIds(res.data);
                if (found.length) {
                    console.log('[ML pack] grid_template_required attrs', { domainId: id, attrs: found });
                    return found;
                }
            }
            const resAll = yield axios_1.default.get(`https://api.mercadolibre.com/domains/${encodeURIComponent(id)}/technical_specs`, {
                headers: { Authorization: `Bearer ${accessToken}` },
                validateStatus: () => true
            });
            if (resAll.status === 200 && resAll.data) {
                return mlCollectGridTemplateRequiredAttrIds(resAll.data);
            }
        }
        catch (err) {
            console.warn('[ML pack] technical_specs grids error', id, (err === null || err === void 0 ? void 0 : err.message) || err);
        }
        return [];
    });
}
function mlChartSearchAttributesForDomain(accessToken, domainId, sourceItem) {
    return __awaiter(this, void 0, void 0, function* () {
        const requiredIds = yield mlFetchGridTemplateRequiredAttrIds(accessToken, domainId);
        const filterIdSet = new Set(requiredIds.length ? requiredIds : ['GENDER', 'BRAND']);
        // ML suele exigir BRAND+GENDER en charts/search aunque solo GENDER sea grid_template_required.
        filterIdSet.add('GENDER');
        filterIdSet.add('BRAND');
        const fromItem = sanitizeMlCreateAttributes(sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.attributes);
        const out = [];
        for (const fid of filterIdSet) {
            const a = fromItem.find((x) => mlAttrIdUpper(x.id) === fid);
            if (!(a === null || a === void 0 ? void 0 : a.value_name))
                continue;
            out.push({ id: fid, values: [{ name: a.value_name }] });
        }
        if (!out.length) {
            console.warn('[ML pack] charts/search sin filtros (faltan attrs en origen)', [...filterIdSet]);
        }
        return out;
    });
}
function mlChartSizeCandidates(v) {
    const out = [];
    const push = (s) => {
        const t = String(s !== null && s !== void 0 ? s : '').trim();
        if (t)
            out.push(mlNormalizeSizeLabel(t));
    };
    push(v === null || v === void 0 ? void 0 : v.name);
    push(v === null || v === void 0 ? void 0 : v.value_name);
    if ((v === null || v === void 0 ? void 0 : v.struct) && typeof v.struct === 'object')
        push(v.struct.number);
    push(v === null || v === void 0 ? void 0 : v.id);
    return out;
}
function mlChartRowMatchesSizeLabel(row, sizeLabel) {
    var _a;
    const labels = mlSizeLabelsForMatch(sizeLabel);
    if (!labels.length)
        return false;
    const rowTokens = mlChartRowTextTokens(row);
    for (const label of labels) {
        for (const token of rowTokens) {
            if (mlLabelMatchesChartToken(label, token))
                return true;
        }
    }
    const attrs = Array.isArray(row === null || row === void 0 ? void 0 : row.attributes) ? row.attributes : [];
    for (const att of attrs) {
        const attId = mlAttrIdUpper((_a = att === null || att === void 0 ? void 0 : att.id) !== null && _a !== void 0 ? _a : att === null || att === void 0 ? void 0 : att.name);
        if (attId !== 'SIZE' && !ML_SIZE_ATTR_IDS.has(attId))
            continue;
        const vals = Array.isArray(att === null || att === void 0 ? void 0 : att.values) ? att.values : [];
        for (const v of vals) {
            for (const candidate of mlChartSizeCandidates(v)) {
                for (const label of labels) {
                    if (mlLabelMatchesChartToken(label, candidate))
                        return true;
                }
            }
        }
    }
    return false;
}
function mlFetchSizeGridRowForSize(accessToken, chartId, sizeLabel) {
    var _a, _b, _c;
    return __awaiter(this, void 0, void 0, function* () {
        const chartKey = String(chartId !== null && chartId !== void 0 ? chartId : '').trim();
        if (!chartKey)
            return null;
        try {
            const res = yield axios_1.default.get(`https://api.mercadolibre.com/catalog/charts/${encodeURIComponent(chartKey)}`, {
                headers: { Authorization: `Bearer ${accessToken}` },
                validateStatus: () => true
            });
            if (res.status !== 200 || !res.data) {
                console.warn('[ML pack] Guía de talles HTTP', chartKey, res.status, ((_a = res.data) === null || _a === void 0 ? void 0 : _a.message) || ((_b = res.data) === null || _b === void 0 ? void 0 : _b.error));
                return null;
            }
            const rows = Array.isArray(res.data.rows) ? res.data.rows : [];
            for (const row of rows) {
                if (!mlChartRowMatchesSizeLabel(row, sizeLabel))
                    continue;
                const rowId = String((_c = row.id) !== null && _c !== void 0 ? _c : '').trim();
                if (rowId)
                    return { rowId, row };
            }
            const wanted = mlSizeLabelsForMatch(sizeLabel);
            const summaries = rows.slice(0, 12).map((row) => ({
                id: row.id,
                tokens: [...mlChartRowTextTokens(row)].slice(0, 10)
            }));
            console.warn('[ML pack] Guía sin fila para talle', {
                chartKey,
                sizeLabel,
                wanted,
                rowCount: rows.length,
                rows: summaries
            });
        }
        catch (err) {
            console.warn('[ML pack] No se pudo leer guía de talles', chartKey, (err === null || err === void 0 ? void 0 : err.message) || err);
        }
        return null;
    });
}
function mlFetchSizeGridRowIdForSize(accessToken, chartId, sizeLabel) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const found = yield mlFetchSizeGridRowForSize(accessToken, chartId, sizeLabel);
        return (_a = found === null || found === void 0 ? void 0 : found.rowId) !== null && _a !== void 0 ? _a : '';
    });
}
function mlSiteIdFromItem(sourceItem) {
    const cat = String((sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.category_id) || 'MLA');
    const m = cat.match(/^([A-Z]{3})/);
    return m ? m[1] : 'MLA';
}
function mlDomainIdForChartSearch(domainId) {
    const d = String(domainId || '').trim();
    const m = d.match(/^[A-Z]{3}-(.+)$/);
    return m ? m[1] : d;
}
function mlDiscoverDomainId(accessToken, siteId, query, categoryId) {
    var _a, _b, _c;
    return __awaiter(this, void 0, void 0, function* () {
        const q = String(query || '').trim();
        if (q) {
            try {
                const res = yield axios_1.default.get(`https://api.mercadolibre.com/sites/${siteId}/domain_discovery/search`, {
                    params: { q, limit: 1 },
                    headers: { Authorization: `Bearer ${accessToken}` },
                    validateStatus: () => true
                });
                if (res.status === 200 && Array.isArray(res.data) && ((_a = res.data[0]) === null || _a === void 0 ? void 0 : _a.domain_id)) {
                    const domainId = String(res.data[0].domain_id).trim();
                    console.log('[ML pack] domain_discovery', { q, domain_id: domainId, category_id: (_b = res.data[0]) === null || _b === void 0 ? void 0 : _b.category_id });
                    return domainId;
                }
            }
            catch (err) {
                console.warn('[ML pack] domain_discovery error', (err === null || err === void 0 ? void 0 : err.message) || err);
            }
        }
        const cat = String(categoryId || '').trim();
        if (cat) {
            try {
                const res = yield axios_1.default.get(`https://api.mercadolibre.com/categories/${cat}`, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    validateStatus: () => true
                });
                const settings = (_c = res.data) === null || _c === void 0 ? void 0 : _c.settings;
                const fromSettings = String((settings === null || settings === void 0 ? void 0 : settings.catalog_domain) || (settings === null || settings === void 0 ? void 0 : settings.domain) || '').trim();
                if (fromSettings)
                    return fromSettings.includes('-') ? fromSettings : `${siteId}-${fromSettings}`;
            }
            catch (_d) {
                /* opcional */
            }
        }
        return '';
    });
}
function mlDomainSupportsSizeGrid(accessToken, domainId) {
    return __awaiter(this, void 0, void 0, function* () {
        const id = String(domainId || '').trim();
        if (!id)
            return false;
        try {
            const res = yield axios_1.default.get(`https://api.mercadolibre.com/domains/${encodeURIComponent(id)}/technical_specs`, {
                headers: { Authorization: `Bearer ${accessToken}` },
                validateStatus: () => true
            });
            if (res.status !== 200)
                return true;
            const blob = JSON.stringify(res.data || {});
            return /grid_id|SIZE_GRID_ID|grid_row_id|SIZE_GRID_ROW_ID/i.test(blob);
        }
        catch (_a) {
            return true;
        }
    });
}
function mlChartSummariesFromSearchResponse(data) {
    var _a;
    const charts = Array.isArray(data === null || data === void 0 ? void 0 : data.charts) ? data.charts : [];
    const out = [];
    for (const c of charts) {
        const id = String((_a = c === null || c === void 0 ? void 0 : c.id) !== null && _a !== void 0 ? _a : '').trim();
        if (!id || !/^\d+$/.test(id))
            continue;
        out.push({ id, type: String((c === null || c === void 0 ? void 0 : c.type) || '').toUpperCase() });
    }
    return out;
}
/** Solo chart_id devueltos por POST /catalog/charts/search (válidos para POST /items del vendedor). */
function mlPickChartIdFromSearchResponse(data, preferredChartId) {
    var _a, _b;
    const charts = mlChartSummariesFromSearchResponse(data);
    const preferred = String(preferredChartId !== null && preferredChartId !== void 0 ? preferredChartId : '').trim();
    if (preferred && charts.some((c) => c.id === preferred))
        return preferred;
    const pickType = (type) => { var _a, _b; return (_b = (_a = charts.find((c) => c.type === type)) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : ''; };
    const brand = pickType('BRAND');
    if (brand)
        return brand;
    const specific = pickType('SPECIFIC');
    if (specific)
        return specific;
    const standard = pickType('STANDARD');
    if (standard)
        return standard;
    return (_b = (_a = charts[0]) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : '';
}
function mlSearchCatalogChartId(accessToken, opts) {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function* () {
        const sellerNum = Number(opts.sellerId);
        if (!Number.isFinite(sellerNum) || sellerNum <= 0)
            return '';
        const fullDomain = String(opts.domainId || '').trim();
        const shortDomain = mlDomainIdForChartSearch(fullDomain);
        const domainCandidates = [shortDomain, fullDomain].filter((d, i, arr) => d && arr.indexOf(d) === i);
        const attrSets = [];
        if (opts.searchAttributes.length)
            attrSets.push(opts.searchAttributes);
        const genderBrand = opts.searchAttributes.filter((a) => ['GENDER', 'BRAND'].includes(mlAttrIdUpper(a.id)));
        if (genderBrand.length && genderBrand.length !== opts.searchAttributes.length) {
            attrSets.push(genderBrand);
        }
        attrSets.push([]);
        const headers = {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'x-caller-id': String(sellerNum)
        };
        for (const domain_id of domainCandidates) {
            for (const attributes of attrSets) {
                for (const type of ['BRAND', 'SPECIFIC', undefined]) {
                    const body = {
                        domain_id,
                        site_id: opts.siteId,
                        seller_id: sellerNum,
                        attributes
                    };
                    if (type)
                        body.type = type;
                    try {
                        const res = yield axios_1.default.post('https://api.mercadolibre.com/catalog/charts/search', body, {
                            headers,
                            validateStatus: () => true
                        });
                        if (res.status !== 200 || !res.data) {
                            console.warn('[ML pack] charts/search HTTP', res.status, domain_id, type || 'all', `attrs=${attributes.length}`, ((_a = res.data) === null || _a === void 0 ? void 0 : _a.message) || ((_b = res.data) === null || _b === void 0 ? void 0 : _b.error));
                            continue;
                        }
                        const chartId = mlPickChartIdFromSearchResponse(res.data, opts.preferredChartId);
                        if (chartId) {
                            const available = mlChartSummariesFromSearchResponse(res.data).map((c) => `${c.id}:${c.type}`);
                            console.log('[ML pack] charts/search OK', {
                                chartId,
                                domain_id,
                                type: type || 'all',
                                attrCount: attributes.length,
                                preferred: opts.preferredChartId || undefined,
                                availableCharts: available.slice(0, 12)
                            });
                            return chartId;
                        }
                    }
                    catch (err) {
                        console.warn('[ML pack] charts/search error', domain_id, (err === null || err === void 0 ? void 0 : err.message) || err);
                    }
                }
            }
        }
        return '';
    });
}
function mlResolveFashionGridViaMercadoLibreApi(sourceItem, size, accessToken, sellerId, familyName) {
    var _a, _b, _c;
    return __awaiter(this, void 0, void 0, function* () {
        const siteId = mlSiteIdFromItem(sourceItem);
        const query = String(familyName || (sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.family_name) || (sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.title) || '').trim();
        const domainId = yield mlDiscoverDomainId(accessToken, siteId, query, String((sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.category_id) || ''));
        if (!domainId) {
            console.warn('[ML pack] Sin domain_id (domain_discovery)');
            return null;
        }
        const supportsGrid = yield mlDomainSupportsSizeGrid(accessToken, domainId);
        if (!supportsGrid) {
            console.warn('[ML pack] Dominio sin guía de talles en technical_specs', domainId);
            return null;
        }
        const searchAttributes = yield mlChartSearchAttributesForDomain(accessToken, domainId, sourceItem);
        const sourceChartId = String((_b = (_a = mlPickCreateAttributeFromList(sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.attributes, 'SIZE_GRID_ID')) === null || _a === void 0 ? void 0 : _a.value_id) !== null && _b !== void 0 ? _b : '').trim();
        const chartId = yield mlSearchCatalogChartId(accessToken, {
            domainId,
            siteId,
            sellerId,
            searchAttributes,
            preferredChartId: sourceChartId || undefined
        });
        if (!chartId) {
            console.warn('[ML pack] charts/search sin chart_id', { domainId, searchAttributes });
            return { domainId };
        }
        const sizeLabel = String(size || '').trim();
        const rowMatch = sizeLabel ? yield mlFetchSizeGridRowForSize(accessToken, chartId, sizeLabel) : null;
        const rowId = (_c = rowMatch === null || rowMatch === void 0 ? void 0 : rowMatch.rowId) !== null && _c !== void 0 ? _c : '';
        const sizeName = (rowMatch === null || rowMatch === void 0 ? void 0 : rowMatch.row)
            ? mlSizeValueFromChartRow(rowMatch.row, sizeLabel)
            : mlSizeValueNameForMercadoLibre(sizeLabel);
        return {
            domainId,
            chartId,
            grid: { id: 'SIZE_GRID_ID', value_id: String(chartId) },
            row: rowId ? mlMakeSizeGridRowAttr(rowId) : undefined,
            size: sizeLabel ? { id: 'SIZE', value_name: sizeName } : undefined
        };
    });
}
function mlSizeGridRowMatchesChart(row, chartId) {
    var _a, _b;
    if (!row || !chartId)
        return false;
    const rowName = String((_b = (_a = row.value_name) !== null && _a !== void 0 ? _a : row.value_id) !== null && _b !== void 0 ? _b : '').trim();
    return rowName.startsWith(`${chartId}:`);
}
function mlFashionSizeAttrForPack(sourceItem, sizeLabel, chartRow) {
    var _a;
    if (chartRow) {
        return { id: 'SIZE', value_name: mlSizeValueFromChartRow(chartRow, sizeLabel) };
    }
    const variation = mlFindSourceVariationBySize(sourceItem, sizeLabel);
    const fromVar = mlPickCreateAttributeFromList(variation === null || variation === void 0 ? void 0 : variation.attributes, 'SIZE');
    if (fromVar === null || fromVar === void 0 ? void 0 : fromVar.value_name) {
        return { id: 'SIZE', value_name: String(fromVar.value_name) };
    }
    return ((_a = mlSizeAttrForUserProduct(sizeLabel)) !== null && _a !== void 0 ? _a : {
        id: 'SIZE',
        value_name: mlSizeValueNameForMercadoLibre(sizeLabel)
    });
}
/**
 * Guía de talles idéntica a la publicación MLA origen (SIZE_GRID_ID + fila + SIZE del talle).
 * No sustituye por charts/search: el pack debe compartir la misma guía que el ítem modelo.
 */
function mlFashionAttrsFromSourcePublication(sourceItem, sizeLabel, accessToken) {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function* () {
        const chartId = mlSourceSizeGridId(sourceItem);
        if (!chartId) {
            throw new Error('La publicación origen no tiene SIZE_GRID_ID (guía de talles). ' +
                'Usá como modelo una publicación MLA individual con guía configurada en Mercado Libre.');
        }
        let row;
        const fromSource = mlSizeGridRowFromSourceItem(sourceItem, sizeLabel);
        if (fromSource && mlSizeGridRowMatchesChart(fromSource, chartId)) {
            row = mlNormalizeSizeGridRowAttr(fromSource);
        }
        if (!mlSizeGridRowIdValue(row) && sizeLabel) {
            const rowMatch = yield mlFetchSizeGridRowForSize(accessToken, chartId, sizeLabel);
            if (rowMatch === null || rowMatch === void 0 ? void 0 : rowMatch.rowId) {
                row = mlMakeSizeGridRowAttr(rowMatch.rowId);
            }
        }
        const rowIdFinal = mlSizeGridRowIdValue(row);
        if (!rowIdFinal) {
            const letter = mlSizeValueNameForMercadoLibre(sizeLabel);
            throw new Error(`La publicación origen (guía ${chartId}) no tiene fila para el talle ${sizeLabel} (${letter}). ` +
                'Verificá que la MLA modelo tenga variación con ese talle y SIZE_GRID_ROW_ID, o elegí otra publicación origen.');
        }
        const rowAttr = mlMakeSizeGridRowAttr(rowIdFinal);
        const sizeAttr = (_a = mlSizeAttrFromSourceVariation(sourceItem, sizeLabel)) !== null && _a !== void 0 ? _a : mlFashionSizeAttrForPack(sourceItem, sizeLabel, null);
        console.log('[ML pack] fashion grid = publicación origen', {
            sourceItemId: String((_b = sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.id) !== null && _b !== void 0 ? _b : ''),
            chartId,
            sizeCode: sizeLabel,
            row: rowIdFinal,
            sizeName: sizeAttr.value_name
        });
        return [{ id: 'SIZE_GRID_ID', value_id: chartId }, rowAttr, sizeAttr];
    });
}
function mlAssertSourceItemSameSeller(sourceItem, integrationSellerId) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const sourceSeller = String((_a = sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.seller_id) !== null && _a !== void 0 ? _a : '').trim();
        const tokenSeller = String(integrationSellerId !== null && integrationSellerId !== void 0 ? integrationSellerId : '').trim();
        if (!sourceSeller || !tokenSeller || sourceSeller === tokenSeller)
            return;
        throw new Error(`La publicación origen (MLA ${sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.id}) pertenece al vendedor ${sourceSeller}, ` +
            `pero la cuenta conectada en LupoHub es ${tokenSeller}. ` +
            'La guía de talles solo es válida si el pack se crea con la misma cuenta ML que la publicación modelo.');
    });
}
function mlUserProductFashionAttrsFromSource(sourceItem, size, accessToken, sellerId, _familyName) {
    return __awaiter(this, void 0, void 0, function* () {
        const sizeLabel = String(size || '').trim();
        yield mlAssertSourceItemSameSeller(sourceItem, sellerId);
        return mlFashionAttrsFromSourcePublication(sourceItem, sizeLabel, accessToken);
    });
}
function sanitizeMlShippingForApi(raw) {
    if (!raw || typeof raw !== 'object')
        return undefined;
    const s = raw;
    const out = {};
    if (s.mode != null)
        out.mode = s.mode;
    if (s.local_pick_up != null)
        out.local_pick_up = s.local_pick_up;
    if (s.free_shipping != null)
        out.free_shipping = s.free_shipping;
    if (s.logistic_type != null)
        out.logistic_type = s.logistic_type;
    return Object.keys(out).length ? out : undefined;
}
function mlPictureIdForPayload(id) {
    const s = String(id !== null && id !== void 0 ? id : '').trim();
    if (!s)
        return null;
    if (looksLikeMlPictureId(s))
        return s;
    if (s.includes('MLA'))
        return s;
    return null;
}
function mlAttributesForPayloadInput(raw, opts) {
    var _a, _b;
    const normalized = [];
    if (Array.isArray(raw)) {
        for (const entry of raw) {
            const attr = mlRawEntryToCreateAttribute(entry);
            if (attr)
                normalized.push(attr);
        }
    }
    let filtered = filterMlItemAttributesForCreatePost(normalized, { userProduct: opts === null || opts === void 0 ? void 0 : opts.userProduct });
    const categoryId = String((_a = opts === null || opts === void 0 ? void 0 : opts.categoryId) !== null && _a !== void 0 ? _a : '').trim();
    if (categoryId) {
        filtered = mlMergeMandatoryCategoryAttributes(filtered, (_b = opts === null || opts === void 0 ? void 0 : opts.sourceAttributes) !== null && _b !== void 0 ? _b : raw, categoryId);
    }
    return filtered;
}
/** Arma payload POST /items sin mutar ni mezclar objetos de ML. */
function buildMercadoLibreItemPayload(input) {
    var _a, _b, _c, _d;
    const userProduct = Boolean(input.userProduct);
    const pictures = (input.pictures || [])
        .map((p) => mlPictureIdForPayload(p === null || p === void 0 ? void 0 : p.id))
        .filter((id) => Boolean(id))
        .map((id) => ({ id }));
    const categoryId = String(input.category_id || '').trim();
    const attrModels = mlAttributesForPayloadInput(input.attributes, {
        userProduct,
        categoryId,
        sourceAttributes: input.sourceAttributes
    });
    const attributes = mlAttributesForPostPayload(attrModels);
    const payload = {
        category_id: String(input.category_id || '').trim(),
        price: Number(input.price),
        available_quantity: Math.max(0, Math.floor(Number(input.available_quantity) || 0)),
        currency_id: input.currency_id || 'ARS',
        buying_mode: input.buying_mode || 'buy_it_now',
        listing_type_id: input.listing_type_id || 'gold_special',
        condition: input.condition || 'new',
        pictures,
        attributes
    };
    const familyName = String((_a = input.family_name) !== null && _a !== void 0 ? _a : '').trim();
    if (familyName)
        payload.family_name = familyName;
    const title = String((_b = input.title) !== null && _b !== void 0 ? _b : '').trim();
    if (title && !userProduct)
        payload.title = title;
    const sku = String((_c = input.seller_custom_field) !== null && _c !== void 0 ? _c : '').trim();
    if (sku)
        payload.seller_custom_field = sku;
    if (input.status === 'paused')
        payload.status = 'paused';
    const videoId = String((_d = input.video_id) !== null && _d !== void 0 ? _d : '').trim();
    if (videoId)
        payload.video_id = videoId;
    const saleTerms = sanitizeMlSaleTermsForApi(input.sale_terms);
    if (saleTerms === null || saleTerms === void 0 ? void 0 : saleTerms.length)
        payload.sale_terms = saleTerms;
    const shipping = sanitizeMlShippingForApi(input.shipping);
    if (shipping)
        payload.shipping = shipping;
    return JSON.parse(JSON.stringify(payload));
}
exports.buildMercadoLibreItemPayload = buildMercadoLibreItemPayload;
function validateMlPayload(payload, opts) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const categoryId = String((_a = payload.category_id) !== null && _a !== void 0 ? _a : '').trim();
    if (!categoryId)
        throw new Error('Missing category_id');
    const price = Number(payload.price);
    if (!Number.isFinite(price) || price <= 0)
        throw new Error('Missing price');
    const qty = Number(payload.available_quantity);
    if (!Number.isFinite(qty) || qty < 0)
        throw new Error('Missing available_quantity');
    if (opts === null || opts === void 0 ? void 0 : opts.userProduct) {
        if (!String((_b = payload.family_name) !== null && _b !== void 0 ? _b : '').trim())
            throw new Error('Missing family_name');
        if (payload.title != null && String(payload.title).trim() !== '') {
            throw new Error('User Product payload must not include title');
        }
        if (Array.isArray(payload.variations) && payload.variations.length > 0) {
            throw new Error('User Product payload must not include variations');
        }
    }
    else {
        if (!String((_c = payload.title) !== null && _c !== void 0 ? _c : '').trim())
            throw new Error('Missing title');
    }
    for (const p of Array.isArray(payload.pictures) ? payload.pictures : []) {
        const pic = p;
        const id = String((_d = pic.id) !== null && _d !== void 0 ? _d : '').trim();
        if (!id || !id.includes('MLA')) {
            throw new Error(`Invalid picture object: ${JSON.stringify(p)}`);
        }
        if (Object.keys(pic).some((k) => k !== 'id')) {
            throw new Error(`Picture must only have id: ${JSON.stringify(p)}`);
        }
    }
    const attrs = Array.isArray(payload.attributes) ? payload.attributes : [];
    for (const a of attrs) {
        const attr = a;
        const id = String((_e = attr.id) !== null && _e !== void 0 ? _e : '').trim();
        if (!id || id.includes('MLA')) {
            throw new Error(`Invalid attribute object: ${JSON.stringify(a)}`);
        }
        const keys = Object.keys(attr);
        if (id === 'SIZE_GRID_ID') {
            if (!keys.includes('id') || attr.value_id == null) {
                throw new Error(`SIZE_GRID_ID requires value_id: ${JSON.stringify(a)}`);
            }
            if (keys.some((k) => !['id', 'value_id'].includes(k))) {
                throw new Error(`Invalid SIZE_GRID_ID shape: ${JSON.stringify(a)}`);
            }
            continue;
        }
        if (id === 'SIZE_GRID_ROW_ID') {
            const rid = String((_g = (_f = attr.value_id) !== null && _f !== void 0 ? _f : attr.value_name) !== null && _g !== void 0 ? _g : '').trim();
            if (!rid || !rid.includes(':')) {
                throw new Error(`SIZE_GRID_ROW_ID requires value_id grid:row: ${JSON.stringify(a)}`);
            }
            if (keys.some((k) => !['id', 'value_id'].includes(k))) {
                throw new Error(`Invalid SIZE_GRID_ROW_ID shape: ${JSON.stringify(a)}`);
            }
            const gridAttr = attrs.find((x) => { var _a; return mlAttrIdUpper(String((_a = x.id) !== null && _a !== void 0 ? _a : '')) === 'SIZE_GRID_ID'; });
            const gridId = String((_h = gridAttr === null || gridAttr === void 0 ? void 0 : gridAttr.value_id) !== null && _h !== void 0 ? _h : '').trim();
            if (gridId && !rid.startsWith(`${gridId}:`)) {
                throw new Error(`SIZE_GRID_ROW_ID ${rid} no coincide con SIZE_GRID_ID ${gridId}`);
            }
            continue;
        }
        if (keys.length !== 2 || !keys.includes('id') || !keys.includes('value_name')) {
            throw new Error(`Attribute must only have id and value_name: ${JSON.stringify(a)}`);
        }
        const vn = attr.value_name;
        if (vn === null || vn === undefined || String(vn).trim() === '') {
            throw new Error(`Invalid attribute value: ${JSON.stringify(a)}`);
        }
    }
    if ((opts === null || opts === void 0 ? void 0 : opts.userProduct) && ML_USER_PRODUCT_CATEGORY_IDS.has(categoryId)) {
        for (const mandatoryId of ML_MANDATORY_CATEGORY_ATTRIBUTE_IDS) {
            const found = attrs.some((a) => { var _a; return mlAttrIdUpper(String((_a = a === null || a === void 0 ? void 0 : a.id) !== null && _a !== void 0 ? _a : '')) === mandatoryId; });
            if (!found)
                throw new Error(`Missing mandatory attribute: ${mandatoryId}`);
        }
        for (const fashionId of ML_USER_PRODUCT_FASHION_ATTR_IDS) {
            const found = attrs.some((a) => { var _a; return mlAttrIdUpper(String((_a = a === null || a === void 0 ? void 0 : a.id) !== null && _a !== void 0 ? _a : '')) === fashionId; });
            if (!found)
                throw new Error(`Missing fashion attribute: ${fashionId}`);
        }
    }
    const forbiddenRootInArray = ['_flags', 'user_product_mode', 'publishing_size', 'removed_variations'];
    for (const key of forbiddenRootInArray) {
        if (key in payload && Array.isArray(payload[key])) {
            throw new Error(`Internal field leaked into payload: ${key}`);
        }
    }
}
exports.validateMlPayload = validateMlPayload;
function mlDraftToPayloadInput(draft, opts) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const pictures = [];
    if (Array.isArray(draft.pictures)) {
        for (const p of draft.pictures) {
            if (!p || typeof p !== 'object')
                continue;
            const row = p;
            pictures.push({
                id: row.id != null ? String(row.id) : undefined,
                source: row.source != null ? String(row.source) : undefined
            });
        }
    }
    return {
        title: String((_a = draft.title) !== null && _a !== void 0 ? _a : '').trim() || undefined,
        family_name: String((_b = draft.family_name) !== null && _b !== void 0 ? _b : '').trim() || undefined,
        category_id: String((_c = draft.category_id) !== null && _c !== void 0 ? _c : ''),
        price: Number(draft.price),
        available_quantity: Number(draft.available_quantity),
        currency_id: String((_d = draft.currency_id) !== null && _d !== void 0 ? _d : 'ARS'),
        buying_mode: String((_e = draft.buying_mode) !== null && _e !== void 0 ? _e : 'buy_it_now'),
        listing_type_id: String((_f = draft.listing_type_id) !== null && _f !== void 0 ? _f : 'gold_special'),
        condition: String((_g = draft.condition) !== null && _g !== void 0 ? _g : 'new'),
        pictures,
        attributes: draft.attributes,
        seller_custom_field: String((_h = draft.seller_custom_field) !== null && _h !== void 0 ? _h : '').trim() || undefined,
        sale_terms: draft.sale_terms,
        shipping: draft.shipping,
        status: draft.status != null ? String(draft.status) : undefined,
        video_id: draft.video_id != null ? String(draft.video_id) : undefined,
        userProduct: opts.userProduct,
        sourceAttributes: draft.sourceAttributes
    };
}
function mlListingFieldsFromSourceItem(sourceItem) {
    var _a;
    return {
        category_id: String((_a = sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.category_id) !== null && _a !== void 0 ? _a : ''),
        currency_id: String((sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.currency_id) || 'ARS'),
        buying_mode: String((sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.buying_mode) || 'buy_it_now'),
        listing_type_id: String((sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.listing_type_id) || 'gold_special'),
        condition: String((sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.condition) || 'new'),
        sale_terms: sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.sale_terms,
        shipping: sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.shipping,
        video_id: (sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.video_id) != null ? String(sourceItem.video_id) : undefined
    };
}
/** Body limpio para POST /items: pictures y attributes separados y sin campos extra de la API origen. */
function sanitizeMercadoLibreItemCreateBody(body) {
    var _a, _b, _c, _d;
    const pictures = sanitizeMlPicturesForApi(body.pictures);
    const attributes = sanitizeMlAttributesForApi(body.attributes);
    const variations = sanitizeMlVariationsForApi(body.variations);
    const out = {
        category_id: body.category_id,
        currency_id: body.currency_id || 'ARS',
        buying_mode: body.buying_mode || 'buy_it_now',
        listing_type_id: body.listing_type_id || 'gold_special',
        condition: body.condition || 'new',
        price: Number(body.price),
        available_quantity: Math.max(0, Math.floor(Number(body.available_quantity) || 0)),
        pictures,
        attributes
    };
    const familyName = String((_a = body.family_name) !== null && _a !== void 0 ? _a : '').trim();
    if (variations === null || variations === void 0 ? void 0 : variations.length) {
        out.variations = variations;
        // ML rechaza family_name + variations en el mismo POST.
        delete out.family_name;
        const title = String((_b = body.title) !== null && _b !== void 0 ? _b : '').trim();
        if (title)
            out.title = title;
    }
    else if (familyName) {
        // User Product: solo family_name (sin title).
        out.family_name = familyName;
    }
    else {
        const title = String((_c = body.title) !== null && _c !== void 0 ? _c : '').trim();
        if (title)
            out.title = title;
    }
    const sku = String((_d = body.seller_custom_field) !== null && _d !== void 0 ? _d : '').trim();
    if (sku)
        out.seller_custom_field = sku;
    if (body.status)
        out.status = body.status;
    if (body.video_id)
        out.video_id = body.video_id;
    const saleTerms = sanitizeMlSaleTermsForApi(body.sale_terms);
    if (saleTerms === null || saleTerms === void 0 ? void 0 : saleTerms.length)
        out.sale_terms = saleTerms;
    const shipping = sanitizeMlShippingForApi(body.shipping);
    if (shipping)
        out.shipping = shipping;
    return stripMlInternalBodyKeys(out);
}
exports.sanitizeMercadoLibreItemCreateBody = sanitizeMercadoLibreItemCreateBody;
function mlIsUserProductPostPayload(body) {
    var _a;
    const hasFamilyName = Boolean(String((_a = body.family_name) !== null && _a !== void 0 ? _a : '').trim());
    const variations = Array.isArray(body.variations) ? body.variations : [];
    return hasFamilyName && variations.length === 0;
}
/** Payload final exclusivo para POST /items (sin _flags ni claves internas). */
function mlPayloadForMercadoLibreApiPost(body) {
    var _a;
    const draftVariations = Array.isArray(body.variations) ? body.variations : [];
    const userProduct = body.userProduct === true ||
        (Boolean(String((_a = body.family_name) !== null && _a !== void 0 ? _a : '').trim()) && draftVariations.length === 0);
    const input = mlDraftToPayloadInput(body, { userProduct });
    const payload = buildMercadoLibreItemPayload(input);
    if (!userProduct && draftVariations.length > 0) {
        const variations = sanitizeMlVariationsForApi(draftVariations);
        if (variations === null || variations === void 0 ? void 0 : variations.length) {
            const classic = JSON.parse(JSON.stringify(payload));
            delete classic.family_name;
            classic.variations = variations;
            validateMlPayload(classic, { userProduct: false });
            logMlPayloadAttributeIds(classic);
            console.log('[ML PAYLOAD CLEAN]', JSON.stringify(classic, null, 2));
            return classic;
        }
    }
    if (userProduct) {
        delete payload.title;
        const attrs = Array.isArray(payload.attributes) ? payload.attributes : [];
        const findAttr = (attrId) => attrs.find((a) => { var _a; return mlAttrIdUpper(String((_a = a.id) !== null && _a !== void 0 ? _a : '')) === attrId; });
        console.log('[ML USER PRODUCT FINAL]', {
            hasTitle: payload.title != null && String(payload.title).trim() !== '',
            family_name: payload.family_name,
            user_product_mode: userProduct,
            sizeGridId: findAttr('SIZE_GRID_ID'),
            sizeGridRowId: findAttr('SIZE_GRID_ROW_ID')
        });
    }
    validateMlPayload(payload, { userProduct });
    logMlPayloadAttributeIds(payload);
    console.log('[ML PAYLOAD CLEAN]', JSON.stringify(payload, null, 2));
    return payload;
}
exports.mlPayloadForMercadoLibreApiPost = mlPayloadForMercadoLibreApiPost;
function buildMlItemCreateDebugFlags(safe) {
    var _a, _b;
    const variations = Array.isArray(safe.variations) ? safe.variations : [];
    const hasFamilyName = Boolean(String((_a = safe.family_name) !== null && _a !== void 0 ? _a : '').trim());
    const hasTitle = Boolean(String((_b = safe.title) !== null && _b !== void 0 ? _b : '').trim());
    const userProductMode = hasFamilyName && variations.length === 0;
    return {
        user_product_mode: userProductMode,
        uses_family_name_field: hasFamilyName,
        removed_family_name_because_variations: variations.length > 0,
        removed_variations_for_user_product: userProductMode,
        removed_title_for_user_product: userProductMode,
        has_item_price: safe.price != null,
        has_item_stock: safe.available_quantity != null,
        variation_count: variations.length,
        picture_count: Array.isArray(safe.pictures) ? safe.pictures.length : 0,
        attribute_count: Array.isArray(safe.attributes) ? safe.attributes.length : 0
    };
}
function mlPicturesPayload(content, fallbackItem) {
    var _a;
    if ((_a = content === null || content === void 0 ? void 0 : content.pictures) === null || _a === void 0 ? void 0 : _a.length) {
        const selected = content.pictures.filter((p) => p.selected !== false);
        const payload = selected
            .map((p) => {
            var _a;
            const pictureId = String((_a = p.pictureId) !== null && _a !== void 0 ? _a : '').trim();
            if (pictureId && looksLikeMlPictureId(pictureId))
                return { id: pictureId };
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
    var _a;
    const out = [];
    for (const p of collectMlPicturesFromItem(item)) {
        if (p.pictureId && looksLikeMlPictureId(p.pictureId)) {
            out.push({ id: p.pictureId });
        }
        else if ((_a = p.url) === null || _a === void 0 ? void 0 : _a.startsWith('http')) {
            out.push({ source: p.url });
        }
    }
    return out;
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
function packColorNameForMlVariation(color) {
    const c = String(color || '').trim();
    if (!c)
        return 'Surtido';
    if (c.includes(' - '))
        return 'Surtido';
    return c;
}
function buildMlPackVariationAttributeCombinations(opts) {
    const colorName = packColorNameForMlVariation(opts.color);
    const sizeName = mlSizeValueNameForMercadoLibre(String(opts.size || '').trim() || 'U');
    return [
        { id: 'COLOR', value_name: colorName },
        { id: 'SIZE', value_name: sizeName }
    ];
}
function inferPackUnitsPerSale(title, packItems) {
    const t = String(title || '');
    const m = t.match(/pack\s*x\s*(\d+)/i) ||
        t.match(/pack\s+(\d+)/i) ||
        t.match(/x\s*(\d+)(?:\s|$|[^0-9])/i);
    if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n >= 1 && n <= 99)
            return n;
    }
    if (packItems === null || packItems === void 0 ? void 0 : packItems.length) {
        const perItem = packItems.map((it) => Math.max(1, Math.floor(Number(it.unitsPerSale) || 1)));
        const maxUnits = Math.max(...perItem);
        if (maxUnits > 1)
            return maxUnits;
    }
    return 3;
}
function applyPackProductAttributeOverrides(attrs, title, packItems) {
    const skip = new Set(['UNDERPANTS_RISE', 'FAMILY_NAME']);
    let out = attrs.filter((a) => !skip.has(mlAttrIdUpper(a.id)));
    out = upsertMlItemAttribute(out, 'SALE_FORMAT', 'Pack');
    out = upsertMlItemAttribute(out, 'UNITS_PER_PACK', String(inferPackUnitsPerSale(title, packItems)));
    return out;
}
function mlItemAttributesForPackListing(sourceItem, skuSuffix, title, packItems, opts) {
    let attrs = mlAttributesForPackCreate(sourceItem, skuSuffix, { omitFamilyName: true });
    if (opts === null || opts === void 0 ? void 0 : opts.withVariations) {
        attrs = attrs.filter((a) => !ML_COLOR_ATTR_IDS.has(mlAttrIdUpper(a.id)) && !ML_SIZE_ATTR_IDS.has(mlAttrIdUpper(a.id)));
    }
    return applyPackProductAttributeOverrides(attrs, title, packItems);
}
function assertValidMlPackVariations(variations, packLabels) {
    var _a;
    if (!variations.length) {
        throw new Error('El pack debe generar al menos una variación de Mercado Libre');
    }
    const comboKeys = new Set();
    for (let i = 0; i < variations.length; i++) {
        const label = packLabels[i] || `Combo ${i + 1}`;
        const v = variations[i];
        const price = Number(v.price);
        if (!Number.isFinite(price) || price <= 0) {
            throw new Error(`La variante "${label}" necesita price > 0 para Mercado Libre`);
        }
        const qty = Number(v.available_quantity);
        if (!Number.isFinite(qty) || qty < 0) {
            throw new Error(`La variante "${label}" necesita available_quantity válido`);
        }
        const ac = normalizeMlVariationAttributeCombinations(v.attribute_combinations);
        if (!ac.length) {
            throw new Error(`La variante "${label}" debe incluir attribute_combinations (COLOR y SIZE)`);
        }
        let hasColor = false;
        let hasSize = false;
        for (const a of ac) {
            const id = mlAttrIdUpper(a.id);
            if (ML_COLOR_ATTR_IDS.has(id))
                hasColor = true;
            if (ML_SIZE_ATTR_IDS.has(id))
                hasSize = true;
        }
        if (!hasColor || !hasSize) {
            throw new Error(`La variante "${label}" debe incluir COLOR y SIZE en attribute_combinations`);
        }
        const key = mlVariationCombinationKey(ac);
        if (comboKeys.has(key)) {
            throw new Error(`Hay variaciones duplicadas con la misma combinación COLOR/SIZE (${key})`);
        }
        comboKeys.add(key);
        if (!String((_a = v.seller_custom_field) !== null && _a !== void 0 ? _a : '').trim()) {
            throw new Error(`La variante "${label}" necesita seller_custom_field (SKU del pack)`);
        }
    }
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
/** Vista para logs/errores: payload real + _flags aparte (no mezclar en el POST). */
function summarizeMlItemCreateBody(body) {
    const payload = mlPayloadForMercadoLibreApiPost(body);
    return {
        payload,
        _flags: buildMlItemCreateDebugFlags(payload)
    };
}
exports.summarizeMlItemCreateBody = summarizeMlItemCreateBody;
/** Error ML que exige User Product (family_name sin variations en el mismo body). */
function mlCreateErrorRequiresUserProduct(message) {
    const m = String(message || '').toLowerCase();
    return (m.includes('variations is invalid with family name') ||
        m.includes('invalid with family name') ||
        (m.includes('family_name') && m.includes('required_fields')) ||
        (m.includes('family_name') && m.includes('does not contains')));
}
exports.mlCreateErrorRequiresUserProduct = mlCreateErrorRequiresUserProduct;
function mlPostPayloadFashionFields(payload) {
    var _a, _b;
    const attrs = Array.isArray(payload.attributes) ? payload.attributes : [];
    const pick = (attrId) => {
        const row = attrs.find((a) => { var _a; return mlAttrIdUpper(String((_a = a.id) !== null && _a !== void 0 ? _a : '')) === attrId; });
        if (!row)
            return undefined;
        if (attrId === 'SIZE_GRID_ID')
            return { value_id: row.value_id };
        if (attrId === 'SIZE_GRID_ROW_ID')
            return { value_id: row.value_id };
        return { value_name: row.value_name };
    };
    return {
        title: String((_a = payload.title) !== null && _a !== void 0 ? _a : '').trim() || undefined,
        family_name: String((_b = payload.family_name) !== null && _b !== void 0 ? _b : '').trim() || undefined,
        SIZE_GRID_ID: pick('SIZE_GRID_ID'),
        SIZE_GRID_ROW_ID: pick('SIZE_GRID_ROW_ID'),
        SIZE: pick('SIZE')
    };
}
function logMlItemCreateBeforePost(draftBody, payloadToSend, debugContext, extra) {
    var _a, _b;
    const ctx = debugContext ? ` ${debugContext}` : '';
    console.log(`[ML POST /items] campos pack${ctx}`, mlPostPayloadFashionFields(payloadToSend));
    const hadFamilyName = Boolean(String((_a = draftBody.family_name) !== null && _a !== void 0 ? _a : '').trim());
    const draftVariations = Array.isArray(draftBody.variations) ? draftBody.variations : [];
    const postedVariations = Array.isArray(payloadToSend.variations) ? payloadToSend.variations : [];
    const removedFamilyName = hadFamilyName && postedVariations.length > 0;
    const removedVariations = draftVariations.length > 0 && postedVariations.length === 0 && Boolean(payloadToSend.family_name);
    const strippedInternalKeys = Object.keys(draftBody).filter((k) => k.startsWith('_') || ML_ITEM_BODY_INTERNAL_KEYS.has(k));
    const combinations = postedVariations.map((v) => ({
        price: v === null || v === void 0 ? void 0 : v.price,
        available_quantity: v === null || v === void 0 ? void 0 : v.available_quantity,
        seller_custom_field: v === null || v === void 0 ? void 0 : v.seller_custom_field,
        attribute_combinations: v === null || v === void 0 ? void 0 : v.attribute_combinations
    }));
    console.log(`[ML POST /items]${ctx}`, JSON.stringify(Object.assign(Object.assign({ user_product_mode: (_b = extra === null || extra === void 0 ? void 0 : extra.user_product_mode) !== null && _b !== void 0 ? _b : Boolean(payloadToSend.family_name && !postedVariations.length), publishing_size: extra === null || extra === void 0 ? void 0 : extra.publishing_size, removed_variations: removedVariations || (extra === null || extra === void 0 ? void 0 : extra.removed_variations) === true, removed_family_name: removedFamilyName, stripped_internal_keys: strippedInternalKeys, had_family_name_in_draft: hadFamilyName, variation_count: postedVariations.length, combinations }, extra), { payload: payloadToSend, _flags: buildMlItemCreateDebugFlags(payloadToSend) }), null, 2));
}
function mlAttributesForPackCreate(item, skuSuffix, opts) {
    const raw = mlAttributesForDuplicate(item, skuSuffix);
    const filtered = (opts === null || opts === void 0 ? void 0 : opts.omitFamilyName)
        ? raw.filter((a) => mlAttrIdUpper(a.id) !== 'FAMILY_NAME')
        : raw;
    return sanitizeMlCreateAttributes(filtered);
}
function upsertMlCreateAttribute(attrs, entry) {
    const upper = mlAttrIdUpper(entry.id);
    if (!upper)
        return attrs;
    const rest = attrs.filter((a) => mlAttrIdUpper(a.id) !== upper);
    return [...rest, { id: upper, value_name: entry.value_name, value_id: entry.value_id }];
}
function upsertMlItemAttribute(attrs, attrId, valueName) {
    const value = String(valueName || '').trim();
    if (!value)
        return attrs;
    return upsertMlCreateAttribute(attrs, { id: attrId, value_name: value });
}
function resolvePackVariantColorSize(packItems, sourceItem, label) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
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
                    color = colors.join(' - ');
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
    const out = [];
    for (const a of item.attributes) {
        const attr = mlRawEntryToCreateAttribute(a);
        if (!attr)
            continue;
        if (mlAttrIdUpper(attr.id) === 'SELLER_SKU' && newSku)
            attr.value_name = newSku;
        out.push(attr);
    }
    return out;
}
/** User Product: exige family_name; no admite `variations` en el mismo POST. */
function mlItemUsesFamilyNameModel(item) {
    var _a;
    if (mlFamilyNameFromItem(item))
        return true;
    const up = item === null || item === void 0 ? void 0 : item.user_product_id;
    if (up != null && String(up).trim() !== '')
        return true;
    if ((item === null || item === void 0 ? void 0 : item.catalog_listing) === true)
        return true;
    const categoryId = String((_a = item === null || item === void 0 ? void 0 : item.category_id) !== null && _a !== void 0 ? _a : '').trim();
    if (categoryId && ML_USER_PRODUCT_CATEGORY_IDS.has(categoryId))
        return true;
    return false;
}
exports.mlItemUsesFamilyNameModel = mlItemUsesFamilyNameModel;
function packListingBaseTitle(sourceItem, opts) {
    var _a, _b;
    const raw = ((_b = (_a = opts.content) === null || _a === void 0 ? void 0 : _a.title) === null || _b === void 0 ? void 0 : _b.trim()) ||
        appendTitleSuffix(String(sourceItem.title || 'Pack'), opts.titleSuffix);
    return raw
        .replace(/\s*Talle\s+[\w\d]+.*$/i, '')
        .replace(/\s*\(Pack\)\s*$/i, '')
        .trim();
}
function packListingTitleForSize(baseTitle, size) {
    const base = String(baseTitle || '').trim() || 'Pack';
    const sz = String(size || '').trim() || 'U';
    if (base.toLowerCase().includes(`talle ${sz.toLowerCase()}`))
        return base;
    return `${base} Talle ${sz}`;
}
/** family_name del pack (no el de la unidad origen): "Base Pack X3". */
function mlPackFamilyNameForListing(baseTitle, packItems, titleForInfer) {
    const clean = String(baseTitle || '')
        .trim()
        .replace(/\s*Talle\s+.+$/i, '')
        .replace(/\s*\(Pack\)\s*$/i, '')
        .replace(/\s*Pack\s*X\d+\s*$/i, '')
        .trim();
    const units = inferPackUnitsPerSale(titleForInfer || clean, packItems);
    return `${clean || 'Pack'} Pack X${units}`;
}
function buildPackListingSellerCustomField(sourceItem, _skuSuffix, size) {
    var _a, _b;
    let core = mlSkuFromItem(sourceItem);
    if (!core && Array.isArray(sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.attributes)) {
        const modelAttr = sourceItem.attributes.find((a) => mlAttrIdUpper(a === null || a === void 0 ? void 0 : a.id) === 'MODEL');
        core = String((_b = (_a = modelAttr === null || modelAttr === void 0 ? void 0 : modelAttr.value_name) !== null && _a !== void 0 ? _a : modelAttr === null || modelAttr === void 0 ? void 0 : modelAttr.value) !== null && _b !== void 0 ? _b : '').trim();
    }
    core = (core || 'item')
        .replace(/[^a-zA-Z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    const sizeCode = String(size || 'U')
        .trim()
        .replace(/[^a-zA-Z0-9]/g, '');
    return `PACK-${core}-${sizeCode}`;
}
function mlFamilyNameFromItem(item) {
    var _a, _b, _c;
    const direct = String((_a = item === null || item === void 0 ? void 0 : item.family_name) !== null && _a !== void 0 ? _a : '').trim();
    if (direct)
        return direct;
    const attr = (Array.isArray(item === null || item === void 0 ? void 0 : item.attributes) ? item.attributes : []).find((a) => mlAttrIdUpper(a === null || a === void 0 ? void 0 : a.id) === 'FAMILY_NAME');
    const fromAttr = ((_c = (_b = attr === null || attr === void 0 ? void 0 : attr.value_name) !== null && _b !== void 0 ? _b : attr === null || attr === void 0 ? void 0 : attr.value) !== null && _c !== void 0 ? _c : '').toString().trim();
    if (fromAttr)
        return fromAttr;
    if ((item === null || item === void 0 ? void 0 : item.user_product_id) != null && String(item.user_product_id).trim()) {
        const title = String((item === null || item === void 0 ? void 0 : item.title) || '').trim();
        if (title)
            return title;
    }
    return '';
}
function postMercadoLibreNewItem(accessToken, body, debugContext, logExtra) {
    var _a, _b, _c;
    return __awaiter(this, void 0, void 0, function* () {
        const payloadToSend = mlPayloadForMercadoLibreApiPost(body);
        const pics = payloadToSend.pictures;
        if (!Array.isArray(pics) || !pics.length) {
            throw new Error('No hay fotos válidas para Mercado Libre (revisá que pictureId sea de imagen ML, no un atributo)');
        }
        logMlItemCreateBeforePost(body, payloadToSend, debugContext, logExtra);
        const postRes = yield axios_1.default.post('https://api.mercadolibre.com/items', payloadToSend, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            validateStatus: () => true
        });
        if (postRes.status !== 201 && postRes.status !== 200) {
            const cause = (_a = postRes.data) === null || _a === void 0 ? void 0 : _a.cause;
            console.error('[ML] POST /items rechazado', {
                status: postRes.status,
                debugContext,
                message: (_b = postRes.data) === null || _b === void 0 ? void 0 : _b.message,
                error: (_c = postRes.data) === null || _c === void 0 ? void 0 : _c.error,
                data: postRes.data
            });
            console.error('[ML] POST /items cause', JSON.stringify(cause, null, 2));
            const preview = JSON.stringify(payloadToSend);
            throw new Error(`Mercado Libre rechazó la creación: ${formatMlCreateError(postRes)}. Payload enviado a ML: ${preview}`);
        }
        const newItem = postRes.data;
        const itemId = String((newItem === null || newItem === void 0 ? void 0 : newItem.id) || '');
        if (!itemId)
            throw new Error('Mercado Libre no devolvió el ID de la nueva publicación');
        return newItem;
    });
}
function applyDescriptionFromSource(newItemId, sourceItem, accessToken, descriptionOverride) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
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
/** Convierte variantes internas (label + items) al array `variations` de ML. */
function buildMlPackVariations(sourceItem, packVariants, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!Number.isFinite(opts.price) || opts.price <= 0) {
            throw new Error('Indicá un precio válido para la publicación pack');
        }
        const rows = yield Promise.all(packVariants.map((pv, idx) => __awaiter(this, void 0, void 0, function* () {
            const stock = (0, publicationStockBundle_service_1.computeAvailableStockFromItems)(pv.items);
            const comboLabel = (pv.label || `Combo ${idx + 1}`).trim();
            const { color, size } = yield resolvePackVariantColorSize(pv.items, sourceItem, comboLabel);
            const varSku = buildPackListingSellerCustomField(sourceItem, opts.skuSuffix, size);
            return {
                price: opts.price,
                available_quantity: Math.max(0, Math.floor(stock)),
                attribute_combinations: buildMlPackVariationAttributeCombinations({ color, size }),
                seller_custom_field: varSku
            };
        })));
        const { variations: deduped, skippedKeys } = dedupeMlPackVariations(rows);
        if (skippedKeys.length) {
            console.warn(`[ML pack] Variaciones duplicadas COLOR/SIZE omitidas o fusionadas: ${skippedKeys.join(', ')}`);
        }
        assertValidMlPackVariations(deduped, packVariants.map((pv, i) => (pv.label || `Combo ${i + 1}`).trim()));
        return deduped;
    });
}
function buildMercadoLibrePackListingBodyClassic(sourceItem, packVariants, opts) {
    var _a, _b, _c;
    return __awaiter(this, void 0, void 0, function* () {
        if (!packVariants.length)
            throw new Error('Agregá al menos una combinación de colores');
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
            price
        });
        const itemQty = variations.reduce((sum, v) => sum + Math.max(0, Number(v.available_quantity) || 0), 0);
        const allPackItems = packVariants.flatMap((pv) => pv.items);
        const attrs = mlItemAttributesForPackListing(sourceItem, opts.skuSuffix, title, allPackItems, {
            withVariations: true
        });
        const listing = mlListingFieldsFromSourceItem(sourceItem);
        const pictureRows = sanitizeMlPicturesForApi(pictures);
        const draft = {
            category_id: listing.category_id,
            currency_id: listing.currency_id,
            buying_mode: listing.buying_mode,
            listing_type_id: listing.listing_type_id,
            condition: listing.condition,
            title,
            price,
            available_quantity: itemQty,
            pictures: pictureRows,
            attributes: attrs,
            sourceAttributes: sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.attributes,
            variations
        };
        if (listing.video_id)
            draft.video_id = listing.video_id;
        if (listing.sale_terms)
            draft.sale_terms = listing.sale_terms;
        if (listing.shipping)
            draft.shipping = listing.shipping;
        if (opts.status === 'paused')
            draft.status = 'paused';
        return draft;
    });
}
/** User Product: una publicación por talle, con family_name y sin variations. */
function mlMercadoLibreSellerId(sourceItem, accessToken) {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function* () {
        const fromItem = String((_a = sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.seller_id) !== null && _a !== void 0 ? _a : '').trim();
        if (fromItem)
            return fromItem;
        try {
            const res = yield axios_1.default.get('https://api.mercadolibre.com/users/me', {
                headers: { Authorization: `Bearer ${accessToken}` },
                validateStatus: () => true
            });
            if (res.status === 200 && ((_b = res.data) === null || _b === void 0 ? void 0 : _b.id) != null)
                return String(res.data.id);
        }
        catch (_c) {
            /* opcional */
        }
        return '';
    });
}
function buildMercadoLibrePackListingBodyUserProductSingle(sourceItem, packVariant, opts) {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function* () {
        const pictures = mlPicturesPayload(opts.content, sourceItem);
        if (!pictures.length)
            throw new Error('Seleccioná al menos una foto para la publicación');
        const price = ((_a = opts.content) === null || _a === void 0 ? void 0 : _a.price) != null && Number.isFinite(Number(opts.content.price))
            ? Number(opts.content.price)
            : Number(sourceItem.price) || 0;
        if (!Number.isFinite(price) || price <= 0) {
            throw new Error('Indicá un precio válido para la publicación pack');
        }
        const comboLabel = (packVariant.label || '').trim();
        const { size } = yield resolvePackVariantColorSize(packVariant.items, sourceItem, comboLabel);
        const itemQty = Math.max(0, Math.floor((0, publicationStockBundle_service_1.computeAvailableStockFromItems)(packVariant.items)));
        const sellerField = buildPackListingSellerCustomField(sourceItem, opts.skuSuffix, size);
        let attrs = mlItemAttributesForPackListing(sourceItem, opts.skuSuffix, opts.baseTitle, packVariant.items, { withVariations: false });
        const sellerId = String((_b = opts.sellerId) !== null && _b !== void 0 ? _b : '').trim() ||
            (yield mlMercadoLibreSellerId(sourceItem, opts.accessToken));
        const fashionAttrs = yield mlUserProductFashionAttrsFromSource(sourceItem, size, opts.accessToken, sellerId, opts.packFamilyName);
        for (const fa of fashionAttrs) {
            attrs = upsertMlCreateAttribute(attrs, fa);
        }
        const listing = mlListingFieldsFromSourceItem(sourceItem);
        const pictureRows = sanitizeMlPicturesForApi(pictures);
        const draft = {
            category_id: listing.category_id,
            currency_id: listing.currency_id,
            buying_mode: listing.buying_mode,
            listing_type_id: listing.listing_type_id,
            condition: listing.condition,
            family_name: opts.packFamilyName,
            price,
            available_quantity: itemQty,
            pictures: pictureRows,
            attributes: attrs,
            sourceAttributes: sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.attributes,
            seller_custom_field: sellerField,
            userProduct: true
        };
        if (listing.video_id)
            draft.video_id = listing.video_id;
        if (listing.sale_terms)
            draft.sale_terms = listing.sale_terms;
        if (listing.shipping)
            draft.shipping = listing.shipping;
        if (opts.status === 'paused')
            draft.status = 'paused';
        return draft;
    });
}
function createMercadoLibrePackListingUserProduct(sourceItem, packVariants, opts) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const mlToken = yield (0, integrations_controller_1.getValidMLToken)();
        if (!mlToken)
            throw new Error('No hay integración con Mercado Libre');
        if (!packVariants.length)
            throw new Error('Agregá al menos una combinación de colores');
        const baseTitle = packListingBaseTitle(sourceItem, opts);
        const allPackItems = packVariants.flatMap((pv) => pv.items);
        const packFamilyName = mlPackFamilyNameForListing(baseTitle, allPackItems, baseTitle);
        const sellerId = yield mlMercadoLibreSellerId(sourceItem, mlToken.access_token);
        const listingIds = [];
        let lastItem = null;
        console.log(`[ML pack User Product] Creando ${packVariants.length} publicación(es) separada(s) (sin variations). pack family_name="${packFamilyName}"`);
        for (let idx = 0; idx < packVariants.length; idx++) {
            const pv = packVariants[idx];
            const comboLabel = (pv.label || `Combo ${idx + 1}`).trim();
            const { size } = yield resolvePackVariantColorSize(pv.items, sourceItem, comboLabel);
            const body = yield buildMercadoLibrePackListingBodyUserProductSingle(sourceItem, pv, Object.assign(Object.assign({}, opts), { baseTitle,
                packFamilyName, accessToken: mlToken.access_token, sellerId }));
            const newItem = yield postMercadoLibreNewItem(mlToken.access_token, body, `user_product pack ${idx + 1}/${packVariants.length}`, {
                user_product_mode: true,
                removed_variations: true,
                removed_title_for_user_product: true,
                publishing_size: size,
                pack_combo_label: comboLabel
            });
            const itemId = String(newItem.id);
            listingIds.push(itemId);
            lastItem = newItem;
            yield applyDescriptionFromSource(itemId, sourceItem, mlToken.access_token, (_a = opts.content) === null || _a === void 0 ? void 0 : _a.description);
        }
        return { itemId: listingIds[0], item: lastItem, variationIds: listingIds };
    });
}
/** Vista previa de guía de talles que se copiará al crear el pack (misma MLA origen). */
function buildMlFashionGridPreview(sourceItem, integrationSellerId) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const sizeGridId = mlSourceSizeGridId(sourceItem);
    if (!sizeGridId)
        return null;
    const sourceSellerId = String((_a = sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.seller_id) !== null && _a !== void 0 ? _a : '').trim();
    const tokenSeller = String(integrationSellerId !== null && integrationSellerId !== void 0 ? integrationSellerId : '').trim();
    const sellerMatchesIntegration = !sourceSellerId || !tokenSeller || sourceSellerId === tokenSeller;
    const rows = [];
    const variations = Array.isArray(sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.variations) ? sourceItem.variations : [];
    for (const v of variations) {
        const rowAttr = mlPickCreateAttributeFromList(v === null || v === void 0 ? void 0 : v.attributes, 'SIZE_GRID_ROW_ID');
        const rowId = String((_c = (_b = rowAttr === null || rowAttr === void 0 ? void 0 : rowAttr.value_name) !== null && _b !== void 0 ? _b : rowAttr === null || rowAttr === void 0 ? void 0 : rowAttr.value_id) !== null && _c !== void 0 ? _c : '').trim();
        if (!rowId)
            continue;
        const sizeAttr = mlPickCreateAttributeFromList(v === null || v === void 0 ? void 0 : v.attributes, 'SIZE');
        const ac = Array.isArray(v === null || v === void 0 ? void 0 : v.attribute_combinations) ? v.attribute_combinations : [];
        const sizeAc = ac.find((a) => ML_SIZE_ATTR_IDS.has(mlAttrIdUpper(a === null || a === void 0 ? void 0 : a.id)));
        const sizeDisplay = String((_e = (_d = sizeAc === null || sizeAc === void 0 ? void 0 : sizeAc.value_name) !== null && _d !== void 0 ? _d : sizeAttr === null || sizeAttr === void 0 ? void 0 : sizeAttr.value_name) !== null && _e !== void 0 ? _e : '').trim() || '—';
        rows.push({
            variationId: (v === null || v === void 0 ? void 0 : v.id) != null ? String(v.id) : undefined,
            sizeDisplay,
            sizeGridRowId: rowId,
            sizeAttribute: String((_f = sizeAttr === null || sizeAttr === void 0 ? void 0 : sizeAttr.value_name) !== null && _f !== void 0 ? _f : sizeDisplay)
        });
    }
    if (!rows.length) {
        const rowAttr = mlPickCreateAttributeFromList(sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.attributes, 'SIZE_GRID_ROW_ID');
        const sizeAttr = mlPickCreateAttributeFromList(sourceItem === null || sourceItem === void 0 ? void 0 : sourceItem.attributes, 'SIZE');
        const rowId = String((_h = (_g = rowAttr === null || rowAttr === void 0 ? void 0 : rowAttr.value_name) !== null && _g !== void 0 ? _g : rowAttr === null || rowAttr === void 0 ? void 0 : rowAttr.value_id) !== null && _h !== void 0 ? _h : '').trim();
        if (rowId) {
            rows.push({
                sizeDisplay: String((_j = sizeAttr === null || sizeAttr === void 0 ? void 0 : sizeAttr.value_name) !== null && _j !== void 0 ? _j : '—'),
                sizeGridRowId: rowId,
                sizeAttribute: String((_k = sizeAttr === null || sizeAttr === void 0 ? void 0 : sizeAttr.value_name) !== null && _k !== void 0 ? _k : '—')
            });
        }
    }
    return {
        sizeGridId,
        familyName: mlFamilyNameFromItem(sourceItem) || undefined,
        sourceSellerId: sourceSellerId || undefined,
        integrationSellerId: tokenSeller || undefined,
        sellerMatchesIntegration,
        sellerWarning: sellerMatchesIntegration
            ? undefined
            : `La publicación origen es del vendedor ${sourceSellerId} y la cuenta conectada es ${tokenSeller}. La guía puede fallar al publicar.`,
        rows
    };
}
exports.buildMlFashionGridPreview = buildMlFashionGridPreview;
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
    var _a, _b, _c, _d, _e, _f;
    return __awaiter(this, void 0, void 0, function* () {
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
            const fashionGrid = buildMlFashionGridPreview(item, mlToken === null || mlToken === void 0 ? void 0 : mlToken.user_id);
            return {
                platform: 'mercadolibre',
                resolvedId: itemId,
                title: String(item.title || '').trim(),
                description,
                images,
                price: Number(item.price) || undefined,
                fashionGrid: fashionGrid !== null && fashionGrid !== void 0 ? fashionGrid : undefined
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
exports.fetchPublicationSourcePreview = fetchPublicationSourcePreview;
const COLOR_COMBO_SEPARATORS = /\s*(?:[-/·,+|\\]| y | e | x |\s\+\s)\s*/gi;
const ASSORTED_COLOR_PATTERN = /^(?:surtido|surtidos|variado|variados|varios|mix|combo|multicolor|assorted|aleatorio)$/i;
/** Parte un nombre de variación como "Negro-Gris-Blanco" en colores individuales. */
function splitColorComboLabel(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed)
        return [];
    if (ASSORTED_COLOR_PATTERN.test(trimmed))
        return [];
    const parts = trimmed
        .split(COLOR_COMBO_SEPARATORS)
        .map((p) => p.trim())
        .filter(Boolean);
    if (parts.length <= 1)
        return [trimmed];
    return parts;
}
exports.splitColorComboLabel = splitColorComboLabel;
function tnVariantColorSize(variant) {
    const values = Array.isArray(variant === null || variant === void 0 ? void 0 : variant.values) ? variant.values : [];
    if (values.length === 0)
        return { color: '', size: '' };
    const labels = values.map((v) => localizedTnText(v));
    const color = labels[0] || '';
    const size = labels[1] || '';
    return { color, size };
}
function fetchListingPackVariations(platform, rawId) {
    var _a, _b, _c;
    return __awaiter(this, void 0, void 0, function* () {
        const id = String(rawId || '').trim();
        if (!id)
            return null;
        if (platform === 'mercadolibre') {
            const resolved = yield fetchMercadoLibreItemResolved(id);
            if (!resolved)
                return null;
            const { item, itemId } = resolved;
            const variations = Array.isArray(item === null || item === void 0 ? void 0 : item.variations) ? item.variations : [];
            const out = variations.map((v) => {
                const { color, size } = mlColorSizeFromVariation(v, String((item === null || item === void 0 ? void 0 : item.title) || ''));
                const rawColor = String(color || '').trim();
                const parsed = splitColorComboLabel(rawColor);
                const isAssorted = parsed.length === 0 && rawColor.length > 0;
                return {
                    variationId: (v === null || v === void 0 ? void 0 : v.id) != null ? String(v.id) : '',
                    colorValueName: rawColor,
                    sizeValueName: String(size || '').trim(),
                    parsedColors: parsed,
                    isAssorted,
                    sku: (v === null || v === void 0 ? void 0 : v.seller_custom_field) ? String(v.seller_custom_field).trim() : undefined,
                    availableQuantity: (v === null || v === void 0 ? void 0 : v.available_quantity) != null ? Number(v.available_quantity) : undefined,
                    pictureIds: Array.isArray(v === null || v === void 0 ? void 0 : v.picture_ids)
                        ? v.picture_ids.map((p) => String(p)).filter(Boolean)
                        : undefined
                };
            });
            return {
                platform: 'mercadolibre',
                resolvedId: itemId,
                title: String((item === null || item === void 0 ? void 0 : item.title) || '').trim(),
                variations: out.filter((v) => v.variationId)
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
        const tnVariants = yield fetchAllTnVariants(storeId, integration.access_token, String(tnId));
        const out = tnVariants.map((v) => {
            const { color, size } = tnVariantColorSize(v);
            const parsed = splitColorComboLabel(color);
            const isAssorted = parsed.length === 0 && color.length > 0;
            return {
                variationId: (v === null || v === void 0 ? void 0 : v.id) != null ? String(v.id) : '',
                colorValueName: color,
                sizeValueName: size,
                parsedColors: parsed,
                isAssorted,
                sku: (v === null || v === void 0 ? void 0 : v.sku) ? String(v.sku).trim() : undefined,
                availableQuantity: (v === null || v === void 0 ? void 0 : v.stock) != null ? Number(v.stock) : undefined
            };
        });
        return {
            platform: 'tiendanube',
            resolvedId: String((_b = (_a = productRes.data) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : tnId),
            title: localizedTnText((_c = productRes.data) === null || _c === void 0 ? void 0 : _c.name),
            variations: out.filter((v) => v.variationId)
        };
    });
}
exports.fetchListingPackVariations = fetchListingPackVariations;
/** Completa attributes de cada variación (el GET del ítem a veces no los trae). */
function enrichMercadoLibreItemVariations(item, accessToken) {
    return __awaiter(this, void 0, void 0, function* () {
        const itemId = String((item === null || item === void 0 ? void 0 : item.id) || '').trim();
        const variations = Array.isArray(item === null || item === void 0 ? void 0 : item.variations) ? item.variations : [];
        if (!itemId || variations.length < 1)
            return item;
        const headers = { Authorization: `Bearer ${accessToken}` };
        let changed = false;
        const enriched = yield Promise.all(variations.map((v) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const hasRow = mlPickCreateAttributeFromList(v === null || v === void 0 ? void 0 : v.attributes, 'SIZE_GRID_ROW_ID');
            const rowOk = Boolean(hasRow === null || hasRow === void 0 ? void 0 : hasRow.value_name) ||
                ((hasRow === null || hasRow === void 0 ? void 0 : hasRow.value_id) != null && String(hasRow.value_id).includes(':'));
            if (rowOk)
                return v;
            const vid = v === null || v === void 0 ? void 0 : v.id;
            if (vid == null)
                return v;
            try {
                const r = yield axios_1.default.get(`https://api.mercadolibre.com/items/${itemId}/variations/${vid}`, {
                    headers,
                    validateStatus: () => true
                });
                if (r.status === 200 && r.data) {
                    changed = true;
                    return Object.assign(Object.assign({}, v), { attribute_combinations: (_a = v.attribute_combinations) !== null && _a !== void 0 ? _a : r.data.attribute_combinations, attributes: (_b = r.data.attributes) !== null && _b !== void 0 ? _b : v.attributes });
                }
            }
            catch (_c) {
                /* opcional */
            }
            return v;
        })));
        return changed ? Object.assign(Object.assign({}, item), { variations: enriched }) : item;
    });
}
function fetchMercadoLibreItemById(candidate, accessToken) {
    return __awaiter(this, void 0, void 0, function* () {
        const id = String(candidate || '').trim();
        if (!id)
            return null;
        try {
            const r = yield axios_1.default.get(`https://api.mercadolibre.com/items/${encodeURIComponent(id)}`, {
                params: { include_attributes: 'all' },
                headers: { Authorization: `Bearer ${accessToken}` },
                validateStatus: () => true
            });
            if (r.status === 200 && r.data && !r.data.error)
                return r.data;
        }
        catch (_a) {
            /* siguiente candidato */
        }
        return null;
    });
}
function fetchMercadoLibreItemResolved(rawItemId) {
    return __awaiter(this, void 0, void 0, function* () {
        const mlToken = yield (0, integrations_controller_1.getValidMLToken)();
        if (!mlToken)
            return null;
        const normalized = (0, integrations_controller_1.normalizeMercadoLibreItemId)(rawItemId);
        const candidates = (0, integrations_controller_1.mercadoLibreItemIdCandidates)(rawItemId);
        if (!normalized && !candidates.length)
            return null;
        const accessToken = mlToken.access_token;
        const sellerId = mlToken.user_id;
        const finish = (raw, candidate, userProductId) => __awaiter(this, void 0, void 0, function* () {
            if (!raw)
                return null;
            const item = yield enrichMercadoLibreItemVariations(raw, accessToken);
            return {
                item,
                itemId: String(item.id || candidate),
                userProductId: userProductId || undefined
            };
        });
        const tryCandidates = (ids, userProductId) => __awaiter(this, void 0, void 0, function* () {
            const seen = new Set();
            for (const candidate of ids) {
                const c = String(candidate || '').trim();
                if (!c || seen.has(c))
                    continue;
                seen.add(c);
                const raw = yield fetchMercadoLibreItemById(c, accessToken);
                const done = yield finish(raw, c, userProductId);
                if (done)
                    return done;
            }
            return null;
        });
        // MLAU = user_product_id: buscar ítems del vendedor (GET /items/MLAU... suele fallar).
        if (/^MLAU\d+$/i.test(normalized)) {
            const upResolved = yield (0, integrations_controller_1.resolveMercadoLibreUserProductItems)(normalized, sellerId, accessToken);
            console.log('[ML pack] Resolviendo MLAU', {
                userProductId: normalized,
                itemCandidates: upResolved.itemCandidates.length,
                debug: upResolved.debug
            });
            const fromUp = yield tryCandidates(upResolved.itemCandidates, normalized);
            if (fromUp)
                return fromUp;
        }
        const direct = yield tryCandidates(candidates);
        if (direct)
            return direct;
        const catalogIds = yield (0, integrations_controller_1.resolveMercadoLibreCatalogProductItems)(String(rawItemId || ''), accessToken);
        const fromCatalog = yield tryCandidates(catalogIds);
        if (fromCatalog)
            return fromCatalog;
        if (normalized && !/^MLAU\d+$/i.test(normalized)) {
            const upResolved = yield (0, integrations_controller_1.resolveMercadoLibreUserProductItems)(normalized, sellerId, accessToken);
            const fromUp = yield tryCandidates(upResolved.itemCandidates, /^MLAU/i.test(normalized) ? normalized : undefined);
            if (fromUp)
                return fromUp;
        }
        return null;
    });
}
exports.fetchMercadoLibreItemResolved = fetchMercadoLibreItemResolved;
function createMercadoLibrePackListingFromItem(sourceItem, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        const created = yield createMercadoLibrePackListingWithVariants(sourceItem, [{ label: (opts.packLabel || '').trim(), items: opts.packItems || [] }], {
            titleSuffix: opts.titleSuffix,
            skuSuffix: opts.skuSuffix,
            status: opts.status,
            content: opts.content
        });
        return { itemId: created.itemId, item: created.item };
    });
}
exports.createMercadoLibrePackListingFromItem = createMercadoLibrePackListingFromItem;
function createMercadoLibrePackListingWithVariants(sourceItem, packVariants, opts) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const mlToken = yield (0, integrations_controller_1.getValidMLToken)();
        if (!mlToken)
            throw new Error('No hay integración con Mercado Libre');
        if (!packVariants.length)
            throw new Error('Agregá al menos una combinación de colores');
        if (mlItemUsesFamilyNameModel(sourceItem)) {
            return createMercadoLibrePackListingUserProduct(sourceItem, packVariants, opts);
        }
        try {
            const body = yield buildMercadoLibrePackListingBodyClassic(sourceItem, packVariants, opts);
            const newItem = yield postMercadoLibreNewItem(mlToken.access_token, body, `pack classic variations=${packVariants.length}`, { user_product_mode: false, removed_variations: false });
            const itemId = String(newItem.id);
            const variationIds = (Array.isArray(newItem.variations) ? newItem.variations : []).map((v) => String((v === null || v === void 0 ? void 0 : v.id) || ''));
            yield applyDescriptionFromSource(itemId, sourceItem, mlToken.access_token, (_a = opts.content) === null || _a === void 0 ? void 0 : _a.description);
            return { itemId, item: newItem, variationIds };
        }
        catch (err) {
            const msg = String((err === null || err === void 0 ? void 0 : err.message) || '');
            if (!mlCreateErrorRequiresUserProduct(msg))
                throw err;
            console.warn('[ML pack] ML exigió User Product (family_name sin variations). Reintentando una publicación por talle.');
            return createMercadoLibrePackListingUserProduct(sourceItem, packVariants, opts);
        }
    });
}
exports.createMercadoLibrePackListingWithVariants = createMercadoLibrePackListingWithVariants;
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
    var _a, _b, _c, _d, _e, _f, _g;
    return __awaiter(this, void 0, void 0, function* () {
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
exports.createTiendaNubePackListingFromProduct = createTiendaNubePackListingFromProduct;
function createTiendaNubePackListingWithVariants(sourceProductId, packVariants, opts) {
    var _a, _b, _c, _d, _e, _f;
    return __awaiter(this, void 0, void 0, function* () {
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
exports.createTiendaNubePackListingWithVariants = createTiendaNubePackListingWithVariants;
function bundleItemsWithStock(items) {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function* () {
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
    var _a, _b, _c, _d, _e, _f;
    return __awaiter(this, void 0, void 0, function* () {
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
                const userProductMulti = mlItemUsesFamilyNameModel(resolved.item) && created.variationIds.length > 1;
                if (userProductMulti) {
                    for (let idx = 0; idx < packVariants.length; idx++) {
                        const mlaId = created.variationIds[idx];
                        if (!mlaId)
                            continue;
                        yield (0, publicationStockBundle_service_1.createPublicationBundle)({
                            platform: 'mercadolibre',
                            externalProductId: mlaId,
                            externalVariantId: '',
                            label: packVariants[idx].label,
                            items: packVariants[idx].rawItems
                        });
                    }
                    const allBundles = [];
                    for (const mlaId of created.variationIds) {
                        allBundles.push(...(yield (0, publicationStockBundle_service_1.findBundlesByProduct)('mercadolibre', mlaId)));
                    }
                    return {
                        group: {
                            platform: 'mercadolibre',
                            externalProductId: created.itemId,
                            listingLabel: ((_e = input.label) === null || _e === void 0 ? void 0 : _e.trim()) || null,
                            variants: allBundles
                        },
                        newExternalProductId: created.itemId,
                        sourceExternalProductId: (0, integrations_controller_1.normalizeMercadoLibreItemId)(sourceId) || sourceId,
                        message: `Se crearon ${packVariants.length} publicaciones ML (User Product, un talle por MLA): ${created.variationIds.join(', ')}`
                    };
                }
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
            listingLabel: ((_f = input.label) === null || _f === void 0 ? void 0 : _f.trim()) || null,
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
exports.createPackListingAndBundle = createPackListingAndBundle;
