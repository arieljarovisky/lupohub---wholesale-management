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
Object.defineProperty(exports, "__esModule", { value: true });
exports.nameEmbedsOwnSkuCode = nameEmbedsOwnSkuCode;
exports.mergeTwoVariants = mergeTwoVariants;
exports.mergeManualVariantPair = mergeManualVariantPair;
exports.mergeManualIntoKeeper = mergeManualIntoKeeper;
exports.runMergeDuplicateProductsBySku = runMergeDuplicateProductsBySku;
/**
 * Fusiona productos duplicados que representan el mismo artículo (mismo “núcleo” de SKU:
 * guiones/espacios distintos, ceros a la izquierda, prefijo numérico común sin los últimos 2 dígitos
 * cuando el núcleo tiene ≥6 dígitos — p. ej. 0322389 y 3223-89 comparten 32238 **solo si** en cada artículo
 * el nombre/descripción incluye el código del propio SKU (no se fusionan solo por coincidencia de dígitos).
 *
 * Uso: script `npm run merge-duplicate-products` o POST /products/merge-duplicate-by-sku
 */
const db_1 = require("../database/db");
const colorCodeCanonical_1 = require("../utils/colorCodeCanonical");
const stock_controller_1 = require("../controllers/stock.controller");
/** Texto de color comparable: minúsculas, sin acentos, espacios colapsados. */
function normalizeColorNameForMatch(raw) {
    return String(raw !== null && raw !== void 0 ? raw : '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ');
}
/**
 * Mismo color “de catálogo”: coincide nombre o código entre ambos registros
 * (ej. name "Blanco" con name "BLANCO", o code "111" con name "111").
 */
function colorLabelsMatch(a, b) {
    const tokensA = [normalizeColorNameForMatch(a.name), normalizeColorNameForMatch(a.code)].filter((t) => t.length > 0);
    const tokensB = [normalizeColorNameForMatch(b.name), normalizeColorNameForMatch(b.code)].filter((t) => t.length > 0);
    for (const ta of tokensA) {
        for (const tb of tokensB) {
            if (ta === tb)
                return true;
        }
    }
    return false;
}
function skuNormCompactKey(s) {
    return String(s !== null && s !== void 0 ? s : '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\s_-]/g, '');
}
function digitCore(s) {
    const d = String(s !== null && s !== void 0 ? s : '').replace(/\D/g, '');
    if (!d)
        return '';
    return d.replace(/^0+/, '') || '0';
}
/**
 * True si el nombre/descripción del artículo incluye el código del propio SKU (núcleo numérico o forma compacta).
 * Requisito para fusionar candidatos por prefijo `dpre:` (evita unir dos artículos que solo comparten dígitos al azar).
 */
function nameEmbedsOwnSkuCode(name, sku) {
    const skuDc = digitCore(sku);
    if (skuDc.length < 4 || skuDc === '0')
        return false;
    const nameDigits = String(name !== null && name !== void 0 ? name : '').replace(/\D/g, '');
    const nameDc = nameDigits.replace(/^0+/, '') || '';
    if (!nameDc)
        return false;
    if (nameDc === skuDc)
        return true;
    if (nameDc.includes(skuDc) || skuDc.includes(nameDc))
        return true;
    const nc = skuNormCompactKey(name);
    const sc = skuNormCompactKey(sku);
    if (sc.length >= 4 && (nc.includes(sc) || sc.includes(nc)))
        return true;
    return false;
}
/** Misma lógica que el import Tango: agrupa por núcleo numérico o por SKU compacto. */
function mergeGroupKey(sku) {
    const keys = mergeGroupKeysForProduct(sku);
    return keys.length ? keys[0] : null;
}
/**
 * Varias claves por producto; si dos artículos comparten cualquiera, van al mismo grupo (union-find).
 * Incluye `dpre:` = núcleo sin los últimos 2 dígitos (mín. 4 dígitos en el prefijo) para casos tipo
 * `0127501` → 127501 y `1275-11` → 127511 (mismo artículo, sufijos distintos).
 */
function mergeGroupKeysForProduct(sku) {
    const out = new Set();
    const dc = digitCore(sku);
    if (dc.length >= 4)
        out.add(`d:${dc}`);
    if (dc.length >= 6) {
        const pre = dc.slice(0, -2);
        if (pre.length >= 4)
            out.add(`dpre:${pre}`);
    }
    const c = skuNormCompactKey(sku);
    if (c.length >= 4)
        out.add(`c:${c}`);
    return [...out];
}
class SkuMergeDsu {
    constructor(n) {
        this.parent = Array.from({ length: n }, (_, i) => i);
    }
    find(i) {
        if (this.parent[i] !== i)
            this.parent[i] = this.find(this.parent[i]);
        return this.parent[i];
    }
    union(a, b) {
        const ra = this.find(a);
        const rb = this.find(b);
        if (ra !== rb)
            this.parent[ra] = rb;
    }
}
function isTrivialProductName(p) {
    const nn = skuNormCompactKey(p.name || '');
    const sn = skuNormCompactKey(p.sku || '');
    return !nn || nn === sn;
}
function tableExists(table) {
    return __awaiter(this, void 0, void 0, function* () {
        const r = yield (0, db_1.get)(`SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`, [table]);
        return Number((r === null || r === void 0 ? void 0 : r.n) || 0) > 0;
    });
}
let cachedVariantHasExternalSku = null;
function variantTableHasExternalSku() {
    return __awaiter(this, void 0, void 0, function* () {
        if (cachedVariantHasExternalSku !== null)
            return cachedVariantHasExternalSku;
        const r = yield (0, db_1.get)(`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_variants' AND COLUMN_NAME = 'external_sku'`, []);
        cachedVariantHasExternalSku = Number((r === null || r === void 0 ? void 0 : r.n) || 0) > 0;
        return cachedVariantHasExternalSku;
    });
}
/**
 * Une `fromVariantId` en `toVariantId`: stock, pedidos, despachos, movimientos, publicaciones, luposhop; borra la variante origen.
 */
function mergeTwoVariants(fromVariantId, toVariantId, keeperProductId) {
    return __awaiter(this, void 0, void 0, function* () {
        if (fromVariantId === toVariantId)
            return;
        const sFrom = yield (0, db_1.get)(`SELECT COALESCE(stock,0) AS s FROM stocks WHERE variant_id = ?`, [fromVariantId]);
        const sTo = yield (0, db_1.get)(`SELECT COALESCE(stock,0) AS s FROM stocks WHERE variant_id = ?`, [toVariantId]);
        const sumStock = Number((sFrom === null || sFrom === void 0 ? void 0 : sFrom.s) || 0) + Number((sTo === null || sTo === void 0 ? void 0 : sTo.s) || 0);
        if (sTo) {
            yield (0, db_1.execute)(`UPDATE stocks SET stock = ? WHERE variant_id = ?`, [sumStock, toVariantId]);
        }
        else {
            yield (0, db_1.execute)(`INSERT INTO stocks (variant_id, stock) VALUES (?, ?)`, [toVariantId, sumStock]);
        }
        yield (0, db_1.execute)(`DELETE FROM stocks WHERE variant_id = ?`, [fromVariantId]);
        yield (0, db_1.execute)(`UPDATE order_items SET variant_id = ? WHERE variant_id = ?`, [toVariantId, fromVariantId]);
        const dupDis = (yield (0, db_1.query)(`SELECT id, despacho_id, cantidad FROM despacho_items WHERE variant_id = ?`, [
            fromVariantId,
        ]));
        for (const di of dupDis) {
            const twin = yield (0, db_1.get)(`SELECT id, cantidad FROM despacho_items WHERE despacho_id = ? AND variant_id = ? LIMIT 1`, [di.despacho_id, toVariantId]);
            if (twin === null || twin === void 0 ? void 0 : twin.id) {
                const newQty = Number(twin.cantidad || 0) + Number(di.cantidad || 0);
                yield (0, db_1.execute)(`UPDATE despacho_items SET cantidad = ?, product_id = ? WHERE id = ?`, [
                    newQty,
                    keeperProductId,
                    twin.id,
                ]);
                yield (0, db_1.execute)(`DELETE FROM despacho_items WHERE id = ?`, [di.id]);
            }
            else {
                yield (0, db_1.execute)(`UPDATE despacho_items SET variant_id = ?, product_id = ? WHERE id = ?`, [
                    toVariantId,
                    keeperProductId,
                    di.id,
                ]);
            }
        }
        if (yield tableExists('stock_movements')) {
            yield (0, db_1.execute)(`UPDATE stock_movements SET variant_id = ? WHERE variant_id = ?`, [toVariantId, fromVariantId]);
        }
        if (yield tableExists('variant_publications')) {
            const pubs = (yield (0, db_1.query)(`SELECT id, platform, external_product_id, external_variant_id, pack_size FROM variant_publications WHERE variant_id = ?`, [fromVariantId]));
            for (const pub of pubs) {
                const extV = pub.external_variant_id != null ? String(pub.external_variant_id) : '';
                const ex = yield (0, db_1.get)(`SELECT id FROM variant_publications WHERE variant_id = ? AND platform = ? AND external_product_id = ? AND COALESCE(external_variant_id,'') = ? LIMIT 1`, [toVariantId, pub.platform, String(pub.external_product_id), extV]);
                if (ex === null || ex === void 0 ? void 0 : ex.id) {
                    yield (0, db_1.execute)(`DELETE FROM variant_publications WHERE id = ?`, [pub.id]);
                }
                else {
                    yield (0, db_1.execute)(`UPDATE variant_publications SET variant_id = ? WHERE id = ?`, [toVariantId, pub.id]);
                }
            }
        }
        if (yield tableExists('variant_luposhop_stock')) {
            const lsFrom = yield (0, db_1.get)(`SELECT stock FROM variant_luposhop_stock WHERE variant_id = ?`, [fromVariantId]);
            const lsTo = yield (0, db_1.get)(`SELECT stock FROM variant_luposhop_stock WHERE variant_id = ?`, [toVariantId]);
            if (lsFrom || lsTo) {
                const lsum = Number((lsFrom === null || lsFrom === void 0 ? void 0 : lsFrom.stock) || 0) + Number((lsTo === null || lsTo === void 0 ? void 0 : lsTo.stock) || 0);
                if (lsTo) {
                    yield (0, db_1.execute)(`UPDATE variant_luposhop_stock SET stock = ? WHERE variant_id = ?`, [lsum, toVariantId]);
                }
                else {
                    yield (0, db_1.execute)(`INSERT INTO variant_luposhop_stock (variant_id, stock) VALUES (?, ?)`, [toVariantId, lsum]);
                }
                yield (0, db_1.execute)(`DELETE FROM variant_luposhop_stock WHERE variant_id = ?`, [fromVariantId]);
            }
        }
        const vf = yield (0, db_1.get)(`SELECT * FROM product_variants WHERE id = ?`, [fromVariantId]);
        const vt = yield (0, db_1.get)(`SELECT * FROM product_variants WHERE id = ?`, [toVariantId]);
        if (vf && vt) {
            const tn = vt.tienda_nube_variant_id || vf.tienda_nube_variant_id || null;
            const mlv = vt.mercado_libre_variant_id || vf.mercado_libre_variant_id || null;
            const mli = vt.mercado_libre_item_id || vf.mercado_libre_item_id || null;
            const skuP = vt.sku || vf.sku || null;
            const useExt = yield variantTableHasExternalSku();
            if (useExt) {
                const extSku = vt.external_sku || vf.external_sku || null;
                yield (0, db_1.execute)(`UPDATE product_variants SET 
           tienda_nube_variant_id = COALESCE(?, tienda_nube_variant_id),
           mercado_libre_variant_id = COALESCE(?, mercado_libre_variant_id),
           mercado_libre_item_id = COALESCE(?, mercado_libre_item_id),
           sku = COALESCE(NULLIF(?, ''), sku),
           external_sku = COALESCE(NULLIF(?, ''), external_sku)
         WHERE id = ?`, [tn, mlv, mli, String(skuP || ''), String(extSku || ''), toVariantId]);
            }
            else {
                yield (0, db_1.execute)(`UPDATE product_variants SET 
           tienda_nube_variant_id = COALESCE(?, tienda_nube_variant_id),
           mercado_libre_variant_id = COALESCE(?, mercado_libre_variant_id),
           mercado_libre_item_id = COALESCE(?, mercado_libre_item_id),
           sku = COALESCE(NULLIF(?, ''), sku)
         WHERE id = ?`, [tn, mlv, mli, String(skuP || ''), toVariantId]);
            }
        }
        yield (0, db_1.execute)(`DELETE FROM product_variants WHERE id = ?`, [fromVariantId]);
        yield (0, stock_controller_1.syncStockToExternalPlatforms)(toVariantId, sumStock);
    });
}
/**
 * Une la variante `absorbVariantId` en `keeperVariantId` (mismo producto, mismo talle, mismo color por nombre/código/id).
 */
function mergeManualVariantPair(keeperVariantId, absorbVariantId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        if (!keeperVariantId || !absorbVariantId || keeperVariantId === absorbVariantId) {
            throw new Error('Indicá dos variantes distintas.');
        }
        const rowSql = `SELECT pv.id AS variant_id, pc.product_id, pv.size_id, pc.color_id,
         c.name AS color_name, c.code AS color_code
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN colors c ON c.id = pc.color_id
     WHERE pv.id = ?`;
        const k = (yield (0, db_1.get)(rowSql, [keeperVariantId]));
        const a = (yield (0, db_1.get)(rowSql, [absorbVariantId]));
        if (!(k === null || k === void 0 ? void 0 : k.product_id))
            throw new Error('Variante destino no encontrada.');
        if (!(a === null || a === void 0 ? void 0 : a.product_id))
            throw new Error('Variante a absorber no encontrada.');
        if (String(k.product_id) !== String(a.product_id)) {
            throw new Error('Las variantes deben ser del mismo artículo (producto).');
        }
        if (String(k.size_id) !== String(a.size_id)) {
            throw new Error('Los talles deben coincidir para unificar variantes.');
        }
        if (String(k.color_id) !== String(a.color_id)) {
            const kc = { name: k.color_name, code: k.color_code };
            const ac = { name: a.color_name, code: a.color_code };
            const canonK = (0, colorCodeCanonical_1.normalizeColorCodeForImportValue)((_b = (_a = k.color_code) !== null && _a !== void 0 ? _a : k.color_name) !== null && _b !== void 0 ? _b : '');
            const canonA = (0, colorCodeCanonical_1.normalizeColorCodeForImportValue)((_d = (_c = a.color_code) !== null && _c !== void 0 ? _c : a.color_name) !== null && _d !== void 0 ? _d : '');
            const sameCanon = Boolean(canonK && canonA && canonK === canonA);
            if (!colorLabelsMatch(kc, ac) && !sameCanon) {
                const kn = normalizeColorNameForMatch(k.color_name) || String(k.color_code || '').trim() || '?';
                const an = normalizeColorNameForMatch(a.color_name) || String(a.color_code || '').trim() || '?';
                throw new Error(`Los colores no coinciden (“${kn}” vs “${an}”). Solo se unifica si es el mismo color (mismo nombre o código equivalente).`);
            }
        }
        yield mergeTwoVariants(absorbVariantId, keeperVariantId, k.product_id);
    });
}
function mergePriceListItems(keeperId, duplicateId) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!(yield tableExists('price_list_items')))
            return;
        const items = (yield (0, db_1.query)(`SELECT id, price_list_id, price FROM price_list_items WHERE product_id = ?`, [
            duplicateId,
        ]));
        for (const it of items) {
            const ex = yield (0, db_1.get)(`SELECT id FROM price_list_items WHERE price_list_id = ? AND product_id = ? LIMIT 1`, [it.price_list_id, keeperId]);
            if (ex === null || ex === void 0 ? void 0 : ex.id) {
                yield (0, db_1.execute)(`DELETE FROM price_list_items WHERE id = ?`, [it.id]);
            }
            else {
                yield (0, db_1.execute)(`UPDATE price_list_items SET product_id = ? WHERE id = ?`, [keeperId, it.id]);
            }
        }
    });
}
/** Color equivalente en el keeper: mismo color_id, mismo nombre/código cruzado (name↔code), o código canónico 3 dígitos. */
function findKeeperProductColorSemMatch(keeperProductId, dupColorId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const exact = yield (0, db_1.get)(`SELECT id FROM product_colors WHERE product_id = ? AND color_id = ? LIMIT 1`, [
            keeperProductId,
            dupColorId,
        ]);
        if (exact === null || exact === void 0 ? void 0 : exact.id)
            return { id: exact.id };
        const dupC = (yield (0, db_1.get)(`SELECT id, code, name FROM colors WHERE id = ?`, [dupColorId]));
        if (!dupC)
            return undefined;
        const dupCodeCanon = (0, colorCodeCanonical_1.normalizeColorCodeForImportValue)((_b = (_a = dupC.code) !== null && _a !== void 0 ? _a : dupC.name) !== null && _b !== void 0 ? _b : '');
        const rows = (yield (0, db_1.query)(`SELECT pc.id, c.code, c.name FROM product_colors pc
     JOIN colors c ON c.id = pc.color_id
     WHERE pc.product_id = ?`, [keeperProductId]));
        for (const row of rows) {
            if (colorLabelsMatch(dupC, row))
                return { id: row.id };
        }
        if (dupCodeCanon) {
            for (const row of rows) {
                const cc = (0, colorCodeCanonical_1.normalizeColorCodeForImportValue)((_d = (_c = row.code) !== null && _c !== void 0 ? _c : row.name) !== null && _d !== void 0 ? _d : '');
                if (cc && cc === dupCodeCanon)
                    return { id: row.id };
            }
        }
        return undefined;
    });
}
function mergeOneDuplicateProduct(keeper, duplicate, dryRun) {
    return __awaiter(this, void 0, void 0, function* () {
        let variantsMerged = 0;
        if (dryRun) {
            const n = yield (0, db_1.get)(`SELECT COUNT(*) AS n FROM product_variants pv JOIN product_colors pc ON pc.id = pv.product_color_id WHERE pc.product_id = ?`, [duplicate.id]);
            return { variantsMerged: Number((n === null || n === void 0 ? void 0 : n.n) || 0) };
        }
        yield mergePriceListItems(keeper.id, duplicate.id);
        const dupPcs = (yield (0, db_1.query)(`SELECT id, color_id FROM product_colors WHERE product_id = ?`, [duplicate.id]));
        for (const opc of dupPcs) {
            let keeperPcId = null;
            const keeperExact = yield (0, db_1.get)(`SELECT id FROM product_colors WHERE product_id = ? AND color_id = ? LIMIT 1`, [keeper.id, opc.color_id]);
            if (keeperExact === null || keeperExact === void 0 ? void 0 : keeperExact.id)
                keeperPcId = keeperExact.id;
            else {
                const sem = yield findKeeperProductColorSemMatch(keeper.id, opc.color_id);
                if (sem === null || sem === void 0 ? void 0 : sem.id)
                    keeperPcId = sem.id;
            }
            if (!keeperPcId) {
                yield (0, db_1.execute)(`UPDATE product_colors SET product_id = ? WHERE id = ?`, [keeper.id, opc.id]);
                const moved = yield (0, db_1.get)(`SELECT COUNT(*) AS n FROM product_variants WHERE product_color_id = ?`, [opc.id]);
                variantsMerged += Number((moved === null || moved === void 0 ? void 0 : moved.n) || 0);
                continue;
            }
            const vars = (yield (0, db_1.query)(`SELECT id, size_id FROM product_variants WHERE product_color_id = ?`, [
                opc.id,
            ]));
            for (const v of vars) {
                const twin = yield (0, db_1.get)(`SELECT id FROM product_variants WHERE product_color_id = ? AND size_id = ? LIMIT 1`, [keeperPcId, v.size_id]);
                if (twin === null || twin === void 0 ? void 0 : twin.id) {
                    yield mergeTwoVariants(v.id, twin.id, keeper.id);
                    variantsMerged++;
                }
                else {
                    yield (0, db_1.execute)(`UPDATE product_variants SET product_color_id = ? WHERE id = ?`, [keeperPcId, v.id]);
                    variantsMerged++;
                }
            }
            const left = yield (0, db_1.get)(`SELECT COUNT(*) AS n FROM product_variants WHERE product_color_id = ?`, [opc.id]);
            if (Number((left === null || left === void 0 ? void 0 : left.n) || 0) === 0) {
                yield (0, db_1.execute)(`DELETE FROM product_colors WHERE id = ?`, [opc.id]);
            }
        }
        yield (0, db_1.execute)(`UPDATE despacho_items SET product_id = ? WHERE product_id = ?`, [keeper.id, duplicate.id]);
        const dupMeta = yield (0, db_1.get)(`SELECT tienda_nube_id, mercado_libre_id, base_price FROM products WHERE id = ?`, [duplicate.id]);
        if (dupMeta) {
            yield (0, db_1.execute)(`UPDATE products SET 
         tienda_nube_id = COALESCE(tienda_nube_id, ?),
         mercado_libre_id = COALESCE(mercado_libre_id, ?),
         base_price = CASE WHEN (base_price IS NULL OR base_price = 0) AND ? > 0 THEN ? ELSE base_price END
       WHERE id = ?`, [
                dupMeta.tienda_nube_id || null,
                dupMeta.mercado_libre_id || null,
                Number(dupMeta.base_price) || 0,
                Number(dupMeta.base_price) || 0,
                keeper.id,
            ]);
        }
        const leftoverPc = yield (0, db_1.query)(`SELECT id FROM product_colors WHERE product_id = ?`, [duplicate.id]);
        for (const row of leftoverPc) {
            const n = yield (0, db_1.get)(`SELECT COUNT(*) AS n FROM product_variants WHERE product_color_id = ?`, [row.id]);
            if (Number((n === null || n === void 0 ? void 0 : n.n) || 0) === 0) {
                yield (0, db_1.execute)(`DELETE FROM product_colors WHERE id = ?`, [row.id]);
            }
        }
        yield (0, db_1.execute)(`DELETE FROM products WHERE id = ?`, [duplicate.id]);
        return { variantsMerged };
    });
}
/**
 * Fusiona uno o más artículos (productos padre) en un keeper elegido por el usuario.
 * Reutiliza la misma lógica que el merge automático por SKU (stock, pedidos, publicaciones, etc.).
 */
function mergeManualIntoKeeper(keeperProductId, duplicateProductIds, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        const dryRun = (opts === null || opts === void 0 ? void 0 : opts.dryRun) === true;
        const errors = [];
        let variantsMerged = 0;
        let productsRemoved = 0;
        const keeperRow = (yield (0, db_1.get)(`SELECT id, sku, name FROM products WHERE id = ?`, [keeperProductId]));
        if (!(keeperRow === null || keeperRow === void 0 ? void 0 : keeperRow.id)) {
            return {
                dryRun,
                keeperProductId,
                variantsMerged: 0,
                productsRemoved: 0,
                errors: ['El artículo principal no existe.'],
            };
        }
        const keeper = Object.assign({}, keeperRow);
        const seen = new Set();
        const dups = duplicateProductIds
            .map((id) => String(id || '').trim())
            .filter((id) => {
            if (!id || id === keeperProductId)
                return false;
            if (seen.has(id))
                return false;
            seen.add(id);
            return true;
        });
        for (const dupId of dups) {
            const dupRow = (yield (0, db_1.get)(`SELECT id, sku, name FROM products WHERE id = ?`, [dupId]));
            if (!(dupRow === null || dupRow === void 0 ? void 0 : dupRow.id)) {
                errors.push(`Artículo no encontrado (${dupId}).`);
                continue;
            }
            try {
                const r = yield mergeOneDuplicateProduct(keeper, dupRow, dryRun);
                variantsMerged += r.variantsMerged;
                if (!dryRun)
                    productsRemoved++;
            }
            catch (e) {
                errors.push(`${dupRow.sku}: ${(e === null || e === void 0 ? void 0 : e.message) || String(e)}`);
            }
        }
        return { dryRun, keeperProductId: keeper.id, variantsMerged, productsRemoved, errors };
    });
}
function pickKeeper(products) {
    const sorted = [...products].sort((a, b) => {
        const ta = isTrivialProductName(a);
        const tb = isTrivialProductName(b);
        if (ta !== tb)
            return ta ? 1 : -1;
        const la = String(a.name || '').trim().length;
        const lb = String(b.name || '').trim().length;
        if (lb !== la)
            return lb - la;
        return String(a.sku).localeCompare(String(b.sku));
    });
    return sorted[0];
}
function runMergeDuplicateProductsBySku() {
    return __awaiter(this, arguments, void 0, function* (opts = {}) {
        const dryRun = opts.dryRun === true;
        const details = [];
        const errors = [];
        let productsRemoved = 0;
        let variantsMerged = 0;
        const all = (yield (0, db_1.query)(`SELECT id, sku, name FROM products`));
        const keyToIndices = new Map();
        for (let i = 0; i < all.length; i++) {
            const keys = mergeGroupKeysForProduct(all[i].sku);
            for (const k of keys) {
                if (!keyToIndices.has(k))
                    keyToIndices.set(k, []);
                keyToIndices.get(k).push(i);
            }
        }
        const dsu = new SkuMergeDsu(all.length);
        for (const [key, indices] of keyToIndices.entries()) {
            if (indices.length < 2)
                continue;
            if (key.startsWith('dpre:')) {
                for (let a = 0; a < indices.length; a++) {
                    for (let b = a + 1; b < indices.length; b++) {
                        const ia = indices[a];
                        const ib = indices[b];
                        const pa = all[ia];
                        const pb = all[ib];
                        if (!nameEmbedsOwnSkuCode(pa.name, pa.sku) || !nameEmbedsOwnSkuCode(pb.name, pb.sku))
                            continue;
                        dsu.union(ia, ib);
                    }
                }
            }
            else {
                const head = indices[0];
                for (let j = 1; j < indices.length; j++)
                    dsu.union(head, indices[j]);
            }
        }
        const rootToProducts = new Map();
        for (let i = 0; i < all.length; i++) {
            const r = dsu.find(i);
            if (!rootToProducts.has(r))
                rootToProducts.set(r, []);
            rootToProducts.get(r).push(all[i]);
        }
        const groups = [...rootToProducts.values()].filter((list) => list.length > 1);
        const groupLabel = (list) => {
            const dcs = list.map((p) => digitCore(p.sku)).filter((d) => d.length > 0);
            const withPre = dcs.filter((d) => d.length >= 6);
            if (withPre.length >= 2) {
                const pres = new Set(withPre.map((d) => d.slice(0, -2)));
                if (pres.size === 1)
                    return `dpre:${[...pres][0]}`;
            }
            const uniqD = new Set(dcs);
            if (uniqD.size === 1)
                return `d:${[...uniqD][0]}`;
            return `grp:${list.map((p) => p.sku).sort().join('|')}`;
        };
        if (dryRun) {
            for (const list of groups) {
                const groupKey = groupLabel(list);
                const keeper = pickKeeper(list);
                const removed = list.filter((p) => p.id !== keeper.id).map((p) => p.sku);
                details.push({ groupKey, keeperSku: keeper.sku, keeperId: keeper.id, removedSkus: removed });
                productsRemoved += removed.length;
                for (const dup of list.filter((p) => p.id !== keeper.id)) {
                    const n = yield (0, db_1.get)(`SELECT COUNT(*) AS n FROM product_variants pv JOIN product_colors pc ON pc.id = pv.product_color_id WHERE pc.product_id = ?`, [dup.id]);
                    variantsMerged += Number((n === null || n === void 0 ? void 0 : n.n) || 0);
                }
            }
            return {
                dryRun,
                groupsFound: groups.length,
                productsRemoved,
                variantsMerged,
                details: details.slice(0, 500),
                errors,
            };
        }
        for (const list of groups) {
            const groupKey = groupLabel(list);
            const keeper = pickKeeper(list);
            const duplicates = list.filter((p) => p.id !== keeper.id);
            const removedSkus = [];
            try {
                for (const dup of duplicates) {
                    const r = yield mergeOneDuplicateProduct(keeper, dup, false);
                    variantsMerged += r.variantsMerged;
                    productsRemoved++;
                    removedSkus.push(dup.sku);
                }
                details.push({ groupKey, keeperSku: keeper.sku, keeperId: keeper.id, removedSkus });
            }
            catch (e) {
                errors.push(`${groupKey} (${keeper.sku}): ${(e === null || e === void 0 ? void 0 : e.message) || e}`);
            }
        }
        return {
            dryRun,
            groupsFound: groups.length,
            productsRemoved,
            variantsMerged,
            details: details.slice(0, 500),
            errors,
        };
    });
}
