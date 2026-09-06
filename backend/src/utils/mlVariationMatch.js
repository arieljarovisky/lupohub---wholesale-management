"use strict";
/** Empareja variaciones de un ítem ML por variationId / SKU / color+talle (con guardas). */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normSkuForMlStockMatch = normSkuForMlStockMatch;
exports.articleDigitsFromSku = articleDigitsFromSku;
exports.sameArticleSku = sameArticleSku;
exports.normTextForMlStockMatch = normTextForMlStockMatch;
exports.mlVariationSkuFromApi = mlVariationSkuFromApi;
exports.mlVariationColorSizeFromApi = mlVariationColorSizeFromApi;
exports.sizeMatchKeys = sizeMatchKeys;
exports.sizesCompatible = sizesCompatible;
exports.skusCompatible = skusCompatible;
exports.reconcileMlColorSizeWithLupoSku = reconcileMlColorSizeWithLupoSku;
exports.matchMlVariationForVariantLink = matchMlVariationForVariantLink;
exports.resolveMlStockForVariantLink = resolveMlStockForVariantLink;
exports.enrichMlItemVariationsForMatch = enrichMlItemVariationsForMatch;
const talles_tango_1 = require("../talles-tango");
const colorNameStandard_1 = require("./colorNameStandard");
function normSkuForMlStockMatch(s) {
    const d = String(s !== null && s !== void 0 ? s : '').replace(/\D/g, '');
    return (d.replace(/^0+/, '') || '0').toUpperCase();
}
/**
 * Prefijo de artículo comparable entre `0069102-140-280` y `0069102140280`.
 * Evita cruces entre artículos distintos en el mismo MLA.
 */
function articleDigitsFromSku(sku) {
    const s = String(sku !== null && sku !== void 0 ? sku : '').trim();
    if (!s)
        return '';
    const dashed = s.match(/^([A-Za-z0-9]+)-(\d{2,4})-/);
    if (dashed)
        return normSkuForMlStockMatch(dashed[1]);
    const digits = s.replace(/\D/g, '');
    // artículo(7) + talle(3) + color(3) = 13, o artículo más corto + 6
    if (digits.length >= 13)
        return normSkuForMlStockMatch(digits.slice(0, -6));
    if (digits.length >= 10)
        return normSkuForMlStockMatch(digits.slice(0, -6));
    return normSkuForMlStockMatch(digits);
}
function sameArticleSku(localRaw, remoteRaw) {
    const a = articleDigitsFromSku(localRaw);
    const b = articleDigitsFromSku(remoteRaw);
    return !!a && !!b && a !== '0' && b !== '0' && a === b;
}
function normTextForMlStockMatch(s) {
    return String(s !== null && s !== void 0 ? s : '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}
function mlVariationSkuFromApi(v) {
    var _a, _b, _c, _d;
    const skuAttr = Array.isArray(v === null || v === void 0 ? void 0 : v.attributes) &&
        v.attributes.find((a) => ((a === null || a === void 0 ? void 0 : a.id) || '').toString().toUpperCase() === 'SELLER_SKU');
    const skuFromAttr = skuAttr ? ((_b = (_a = skuAttr.value_name) !== null && _a !== void 0 ? _a : skuAttr.value) !== null && _b !== void 0 ? _b : '').toString().trim() : '';
    return skuFromAttr || ((_d = (_c = v === null || v === void 0 ? void 0 : v.seller_sku) !== null && _c !== void 0 ? _c : v === null || v === void 0 ? void 0 : v.seller_custom_field) !== null && _d !== void 0 ? _d : '').toString().trim();
}
function mlVariationColorSizeFromApi(v) {
    let color = '';
    let size = '';
    const absorb = (attr) => {
        var _a, _b, _c;
        const id = ((attr === null || attr === void 0 ? void 0 : attr.id) || '').toString().toUpperCase();
        const name = ((_c = (_b = (_a = attr === null || attr === void 0 ? void 0 : attr.value_name) !== null && _a !== void 0 ? _a : attr === null || attr === void 0 ? void 0 : attr.value) !== null && _b !== void 0 ? _b : attr === null || attr === void 0 ? void 0 : attr.name) !== null && _c !== void 0 ? _c : '').toString().trim();
        if (!name)
            return;
        if (id === 'COLOR' || id === 'COLOUR' || id === 'COR')
            color = color || name;
        if (id === 'SIZE' || id === 'SIZE_TYPE' || id === 'TALLE' || id === 'TALLA')
            size = size || name;
    };
    ((v === null || v === void 0 ? void 0 : v.attribute_combinations) || []).forEach(absorb);
    (Array.isArray(v === null || v === void 0 ? void 0 : v.attributes) ? v.attributes : []).forEach(absorb);
    return { color, size };
}
/** Aliases de talle: "160", "GG", "160 - GG", "gg", etc. */
function sizeMatchKeys(size) {
    const keys = new Set();
    const add = (v) => {
        const n = normTextForMlStockMatch(String(v !== null && v !== void 0 ? v : ''));
        if (n)
            keys.add(n);
    };
    const raw = String(size !== null && size !== void 0 ? size : '').trim();
    if (!raw)
        return keys;
    add(raw);
    for (const part of raw.split(/[-–|/,\s]+/)) {
        if (part.trim())
            add(part.trim());
    }
    const digits = raw.replace(/\D/g, '');
    if (digits) {
        add(digits);
        add((0, talles_tango_1.nombreTalleDesdeCodigo)(digits));
        if (talles_tango_1.TALLE_CODIGO_A_NOMBRE[digits])
            add(talles_tango_1.TALLE_CODIGO_A_NOMBRE[digits]);
    }
    const codeFromLetter = (0, talles_tango_1.codigoTalleParaSku)(raw);
    if (codeFromLetter) {
        add(codeFromLetter);
        add((0, talles_tango_1.nombreTalleDesdeCodigo)(codeFromLetter));
    }
    return keys;
}
function sizesCompatible(a, b) {
    const A = sizeMatchKeys(a);
    const B = sizeMatchKeys(b);
    if (!A.size || !B.size)
        return false;
    for (const k of A) {
        if (B.has(k))
            return true;
    }
    return false;
}
/** Solo igualdad exacta del SKU normalizado (dígitos). Evita que 150-594 y 180-594 colisionen. */
function skusCompatible(localRaw, remoteRaw) {
    const local = normSkuForMlStockMatch(localRaw);
    const remote = normSkuForMlStockMatch(remoteRaw);
    if (!local || !remote || local === '0' || remote === '0')
        return false;
    return local === remote;
}
function colorCompatible(localColor, remoteColor) {
    return (0, colorNameStandard_1.colorsAreEquivalent)(localColor, remoteColor);
}
/**
 * Completa color/talle faltantes desde un SKU Lupo (artículo+talle+color).
 * Si ML ya trae COLOR y SIZE en atributos, esos mandan: en familias UP el seller_sku
 * a veces queda cruzado entre variantes (ej. Blanco G con SKU de Nude P).
 */
function reconcileMlColorSizeWithLupoSku(sku, color, size) {
    const mlColor = String(color || '').trim();
    const mlSize = String(size || '').trim();
    // Atributos completos de la publicación: no pisar con SKU (puede estar desfasado).
    if (mlColor && mlSize) {
        return { color: mlColor, size: mlSize };
    }
    const digits = String(sku || '').replace(/\D/g, '');
    if (digits.length < 13)
        return { color: mlColor, size: mlSize };
    const sizeCode = digits.slice(-6, -3);
    if (!sizeCode || (!talles_tango_1.TALLE_CODIGO_A_NOMBRE[sizeCode] && !/^\d{3}$/.test(sizeCode))) {
        return { color: mlColor, size: mlSize };
    }
    if (!mlSize)
        return { color: mlColor, size: sizeCode };
    if (sizesCompatible(mlSize, sizeCode))
        return { color: mlColor, size: mlSize };
    return { color: mlColor, size: mlSize };
}
/**
 * Empareja la variación ML correcta.
 * Prioridad: variationId guardado → SKU exacto → color+talle (con guardas de artículo).
 *
 * El ID que el usuario guardó al vincular manda.
 * color+talle se permite si ML no trae SKU usable, o si el SKU remoto es del mismo artículo
 * (evita el cruce 0067102↔0073304 en un MLA compartido, pero permite sync cuando
 * el SKU de ML está vacío / en otro formato y el vínculo no tiene variation_id).
 */
function matchMlVariationForVariantLink(variations, link) {
    var _a, _b, _c, _d, _e;
    if (!Array.isArray(variations) || variations.length === 0)
        return null;
    const rawLocalSku = String((_a = link.sku) !== null && _a !== void 0 ? _a : '').trim();
    const varId = link.variationId != null ? String(link.variationId).trim() : '';
    // 1) variationId explícito (vínculo guardado en LupoHub)
    if (varId) {
        const byId = variations.find((x) => String(x === null || x === void 0 ? void 0 : x.id) === varId);
        if (byId)
            return byId;
    }
    // 2) SKU exacto
    if (rawLocalSku) {
        const bySku = variations.filter((v) => {
            const rawRemoteSku = mlVariationSkuFromApi(v).trim();
            return rawRemoteSku && skusCompatible(rawLocalSku, rawRemoteSku);
        });
        if (bySku.length === 1)
            return bySku[0];
        if (bySku.length > 1) {
            const colorN = String((_b = link.color) !== null && _b !== void 0 ? _b : '').trim();
            const sizeRaw = String((_c = link.size) !== null && _c !== void 0 ? _c : '').trim();
            if (colorN || sizeRaw) {
                const narrowed = bySku.filter((v) => {
                    const { color, size } = mlVariationColorSizeFromApi(v);
                    const colorOk = !colorN || colorCompatible(colorN, color);
                    const sizeOk = !sizeRaw || sizesCompatible(sizeRaw, size);
                    return colorOk && sizeOk;
                });
                if (narrowed.length === 1)
                    return narrowed[0];
            }
            return null;
        }
    }
    // 3) color + talle
    const colorN = String((_d = link.color) !== null && _d !== void 0 ? _d : '').trim();
    const sizeRaw = String((_e = link.size) !== null && _e !== void 0 ? _e : '').trim();
    if (!colorN || !sizeRaw)
        return null;
    let pool = variations;
    if (rawLocalSku) {
        const remotesWithSku = variations.filter((v) => !!mlVariationSkuFromApi(v).trim());
        // Si hay SKUs remotos y ninguno matcheó en (2), solo considerar:
        // - variaciones sin SKU, o
        // - SKU del mismo artículo (formato distinto).
        // Si todas tienen SKU de otro artículo → abortar (evita pisar stock ajeno).
        if (remotesWithSku.length > 0) {
            pool = variations.filter((v) => {
                const remoteSku = mlVariationSkuFromApi(v).trim();
                if (!remoteSku)
                    return true;
                return sameArticleSku(rawLocalSku, remoteSku);
            });
            if (pool.length === 0)
                return null;
        }
    }
    const byAttrs = pool.filter((v) => {
        const { color, size } = mlVariationColorSizeFromApi(v);
        return colorCompatible(colorN, color) && sizesCompatible(sizeRaw, size);
    });
    if (byAttrs.length === 1)
        return byAttrs[0];
    return null;
}
function resolveMlStockForVariantLink(item, link) {
    var _a;
    const variations = Array.isArray(item === null || item === void 0 ? void 0 : item.variations) ? item.variations : [];
    if (!variations.length) {
        return typeof (item === null || item === void 0 ? void 0 : item.available_quantity) === 'number' ? Number(item.available_quantity) : undefined;
    }
    const matched = matchMlVariationForVariantLink(variations, link);
    if (!matched)
        return undefined;
    return Number((_a = matched.available_quantity) !== null && _a !== void 0 ? _a : 0);
}
/** Completa SKU/atributos de variaciones (GET /items a menudo los omite). */
function enrichMlItemVariationsForMatch(item, accessToken, axiosGet) {
    return __awaiter(this, void 0, void 0, function* () {
        const itemId = String((item === null || item === void 0 ? void 0 : item.id) || '').trim();
        const variations = Array.isArray(item === null || item === void 0 ? void 0 : item.variations) ? item.variations : [];
        if (!itemId || variations.length === 0)
            return item;
        const needsEnrich = (v) => {
            const ac = v === null || v === void 0 ? void 0 : v.attribute_combinations;
            if (!Array.isArray(ac) || ac.length === 0)
                return true;
            const { color, size } = mlVariationColorSizeFromApi(v);
            return !mlVariationSkuFromApi(v) || (!color && !size);
        };
        if (!variations.some(needsEnrich))
            return item;
        const headers = { Authorization: `Bearer ${accessToken}` };
        const enriched = yield Promise.all(variations.map((v) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e;
            if (!needsEnrich(v))
                return v;
            const vid = v === null || v === void 0 ? void 0 : v.id;
            if (vid == null)
                return v;
            try {
                const r = yield axiosGet(`https://api.mercadolibre.com/items/${itemId}/variations/${vid}`, {
                    headers,
                    validateStatus: () => true,
                });
                if (r.status === 200 && r.data) {
                    return Object.assign(Object.assign(Object.assign({}, v), r.data), { id: v.id, available_quantity: (_a = v.available_quantity) !== null && _a !== void 0 ? _a : r.data.available_quantity, attribute_combinations: (_b = r.data.attribute_combinations) !== null && _b !== void 0 ? _b : v.attribute_combinations, attributes: (_c = r.data.attributes) !== null && _c !== void 0 ? _c : v.attributes, seller_sku: (_d = r.data.seller_sku) !== null && _d !== void 0 ? _d : v.seller_sku, seller_custom_field: (_e = r.data.seller_custom_field) !== null && _e !== void 0 ? _e : v.seller_custom_field });
                }
            }
            catch (_f) {
                /* ignorar */
            }
            return v;
        })));
        return Object.assign(Object.assign({}, item), { variations: enriched });
    });
}
