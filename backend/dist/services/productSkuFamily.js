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
exports.skuLookupCandidates = skuLookupCandidates;
exports.resolveProductByArticleSku = resolveProductByArticleSku;
exports.findRelatedProductIdsForArticleSku = findRelatedProductIdsForArticleSku;
const db_1 = require("../database/db");
const mergeDuplicateProductsBySku_1 = require("./mergeDuplicateProductsBySku");
const PRODUCT_SELECT = `p.id, p.sku, p.name, p.category, p.base_price, p.tienda_nube_id, p.mercado_libre_id,
  COALESCE(p.mercado_libre_pack_size, 1) AS mercado_libre_pack_size,
  COALESCE(p.tienda_nube_pack_size, 1) AS tienda_nube_pack_size,
  COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS mayorista_pack_size`;
function digitsOnly(s) {
    return String(s !== null && s !== void 0 ? s : '').replace(/\D/g, '');
}
/** SQL: solo dígitos de un texto (MySQL sin REGEXP_REPLACE). */
const SQL_DIGITS = `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(%s,'-',''),' ',''),'.',''),'_',''),'/','')`;
function sqlDigits(expr) {
    return SQL_DIGITS.replace('%s', expr);
}
function skuLookupCandidates(sku) {
    const t = String(sku !== null && sku !== void 0 ? sku : '').trim();
    const out = new Set();
    if (t) {
        out.add(t);
        const base = t.split('-')[0];
        if (base && base !== t)
            out.add(base);
    }
    const digits = digitsOnly(t);
    if (digits) {
        out.add(digits);
        const stripped = digits.replace(/^0+/, '') || '0';
        out.add(stripped);
        if (digits.length <= 7)
            out.add(digits.padStart(7, '0'));
        if (stripped.length <= 7)
            out.add(stripped.padStart(7, '0'));
    }
    return [...out];
}
function findProductExact(sku) {
    return __awaiter(this, void 0, void 0, function* () {
        return (yield (0, db_1.get)(`SELECT ${PRODUCT_SELECT} FROM products p WHERE p.sku = ?`, [sku]));
    });
}
function findProductLikePrefix(sku) {
    return __awaiter(this, void 0, void 0, function* () {
        return (yield (0, db_1.get)(`SELECT ${PRODUCT_SELECT} FROM products p WHERE p.sku LIKE ? ORDER BY p.sku LIMIT 1`, [`${sku}-%`]));
    });
}
function findProductByVariantPrefix(sku) {
    return __awaiter(this, void 0, void 0, function* () {
        return (yield (0, db_1.get)(`SELECT ${PRODUCT_SELECT} FROM products p WHERE ? LIKE CONCAT(p.sku, '-%') ORDER BY CHAR_LENGTH(p.sku) DESC LIMIT 1`, [sku]));
    });
}
/** Busca por núcleo numérico en SKU de producto o variantes (ej. 0127501 → registro 1275111 con variantes 0127501-170-111). */
function findProductByArticleDigits(skuInput) {
    return __awaiter(this, void 0, void 0, function* () {
        const reqDc = (0, mergeDuplicateProductsBySku_1.digitCore)(skuInput);
        const padded7 = digitsOnly(skuInput).length <= 7 ? digitsOnly(skuInput).padStart(7, '0') : '';
        const needles = [...new Set([reqDc, padded7, digitsOnly(skuInput)].filter((n) => n.length >= 4))];
        if (!needles.length)
            return null;
        const blobExpr = sqlDigits(`CONCAT(COALESCE(p.sku,''), COALESCE(pv.sku,''), COALESCE(pv.external_sku,''))`);
        for (const needle of needles) {
            const row = (yield (0, db_1.get)(`SELECT ${PRODUCT_SELECT}
       FROM products p
       JOIN product_colors pc ON pc.product_id = p.id
       JOIN product_variants pv ON pv.product_color_id = pc.id
       WHERE ${blobExpr} LIKE CONCAT('%', ?, '%')
       ORDER BY CHAR_LENGTH(p.sku) ASC
       LIMIT 1`, [needle]));
            if (row)
                return row;
        }
        return null;
    });
}
/**
 * Resuelve el producto padre a partir del código que ingresa el usuario (con o sin ceros / guiones).
 */
function resolveProductByArticleSku(skuInput) {
    return __awaiter(this, void 0, void 0, function* () {
        const trimmed = String(skuInput !== null && skuInput !== void 0 ? skuInput : '').trim();
        if (!trimmed)
            return null;
        for (const candidate of skuLookupCandidates(trimmed)) {
            let row = yield findProductExact(candidate);
            if (row)
                return row;
            row = yield findProductLikePrefix(candidate);
            if (row)
                return row;
            row = yield findProductByVariantPrefix(candidate);
            if (row)
                return row;
        }
        return findProductByArticleDigits(trimmed);
    });
}
/** Productos relacionados (duplicados / variantes con el mismo artículo en el SKU). */
function findRelatedProductIdsForArticleSku(requestedSku, primaryProductId) {
    return __awaiter(this, void 0, void 0, function* () {
        const ids = new Set([primaryProductId]);
        const reqKeys = new Set((0, mergeDuplicateProductsBySku_1.mergeGroupKeysForProduct)(requestedSku));
        const reqDc = (0, mergeDuplicateProductsBySku_1.digitCore)(requestedSku);
        const padded7 = digitsOnly(requestedSku).length <= 7 ? digitsOnly(requestedSku).padStart(7, '0') : '';
        const needles = [...new Set([reqDc, padded7].filter((n) => n.length >= 4))];
        if (!needles.length)
            return [...ids];
        const primary = (yield (0, db_1.get)('SELECT id, sku, name FROM products WHERE id = ?', [primaryProductId]));
        if (!primary)
            return [...ids];
        const skuDigitsExpr = sqlDigits('p.sku');
        if (reqDc.length >= 6) {
            const pre = reqDc.slice(0, -2);
            if (pre.length >= 4) {
                const dpreMatches = (yield (0, db_1.query)(`SELECT p.id, p.sku, p.name FROM products p
         WHERE p.id != ?
           AND CHAR_LENGTH(${skuDigitsExpr}) >= 6
           AND LEFT(${skuDigitsExpr}, CHAR_LENGTH(${skuDigitsExpr}) - 2) = ?`, [primaryProductId, pre]));
                for (const p of dpreMatches) {
                    const pKeys = (0, mergeDuplicateProductsBySku_1.mergeGroupKeysForProduct)(p.sku);
                    if (!pKeys.some((k) => reqKeys.has(k)))
                        continue;
                    if ((0, mergeDuplicateProductsBySku_1.nameEmbedsOwnSkuCode)(p.name, p.sku) && (0, mergeDuplicateProductsBySku_1.nameEmbedsOwnSkuCode)(primary.name, primary.sku)) {
                        ids.add(p.id);
                    }
                }
            }
        }
        const blobExpr = sqlDigits(`CONCAT(COALESCE(p.sku,''), COALESCE(pv.sku,''), COALESCE(pv.external_sku,''))`);
        for (const needle of needles) {
            const rows = (yield (0, db_1.query)(`SELECT DISTINCT p.id AS product_id
       FROM products p
       LEFT JOIN product_colors pc ON pc.product_id = p.id
       LEFT JOIN product_variants pv ON pv.product_color_id = pc.id
       WHERE ${blobExpr} LIKE CONCAT('%', ?, '%')`, [needle]));
            for (const r of rows) {
                if (r.product_id)
                    ids.add(r.product_id);
            }
        }
        return [...ids];
    });
}
