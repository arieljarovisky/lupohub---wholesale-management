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
exports.mergeTwoVariants = mergeTwoVariants;
exports.runMergeDuplicateProductsBySku = runMergeDuplicateProductsBySku;
/**
 * Fusiona productos duplicados que representan el mismo artículo (mismo “núcleo” de SKU:
 * guiones/espacios distintos, ceros a la izquierda, etc.).
 *
 * Uso: script `npm run merge-duplicate-products` o POST /products/merge-duplicate-by-sku
 */
const db_1 = require("../database/db");
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
/** Misma lógica que el import Tango: agrupa por núcleo numérico o por SKU compacto. */
function mergeGroupKey(sku) {
    const dc = digitCore(sku);
    if (dc.length >= 4)
        return `d:${dc}`;
    const c = skuNormCompactKey(sku);
    if (c.length >= 4)
        return `c:${c}`;
    return null;
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
            const keeperPc = yield (0, db_1.get)(`SELECT id FROM product_colors WHERE product_id = ? AND color_id = ? LIMIT 1`, [keeper.id, opc.color_id]);
            if (!(keeperPc === null || keeperPc === void 0 ? void 0 : keeperPc.id)) {
                yield (0, db_1.execute)(`UPDATE product_colors SET product_id = ? WHERE id = ?`, [keeper.id, opc.id]);
                const moved = yield (0, db_1.get)(`SELECT COUNT(*) AS n FROM product_variants WHERE product_color_id = ?`, [opc.id]);
                variantsMerged += Number((moved === null || moved === void 0 ? void 0 : moved.n) || 0);
                continue;
            }
            const keeperPcId = keeperPc.id;
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
        const byKey = new Map();
        for (const p of all) {
            const key = mergeGroupKey(p.sku);
            if (!key)
                continue;
            if (!byKey.has(key))
                byKey.set(key, []);
            byKey.get(key).push(p);
        }
        const groups = [...byKey.entries()].filter(([, list]) => list.length > 1);
        if (dryRun) {
            for (const [groupKey, list] of groups) {
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
        for (const [groupKey, list] of groups) {
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
