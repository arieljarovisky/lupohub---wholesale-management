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
exports.DESPACHO_FOB_ARS_PER_USD = exports.DESPACHO_FOB_PRICE_LIST_NAME = void 0;
exports.lookupDespachoItemFobArs = lookupDespachoItemFobArs;
exports.lookupDespachoItemFob = lookupDespachoItemFob;
exports.loadDespachoFobList = loadDespachoFobList;
exports.persistDespachoFobFromList = persistDespachoFobFromList;
exports.applyFobToDespachoItems = applyFobToDespachoItems;
exports.sumItemsFob = sumItemsFob;
const db_1 = require("../database/db");
const channelMarginUtils_1 = require("./channelMarginUtils");
/** Lista de precios FOB usada en despachos de importación. */
exports.DESPACHO_FOB_PRICE_LIST_NAME = 'Precios Fob Marzo';
/** La lista está cargada en pesos; el FOB de despachos se expresa en USD. */
exports.DESPACHO_FOB_ARS_PER_USD = 1500;
function roundMoney(v) {
    return Math.round(v * 100) / 100;
}
function fobArsToUsd(priceArs) {
    if (priceArs == null || !Number.isFinite(priceArs))
        return null;
    if (exports.DESPACHO_FOB_ARS_PER_USD <= 0)
        return roundMoney(priceArs);
    return roundMoney(priceArs / exports.DESPACHO_FOB_ARS_PER_USD);
}
function lookupDespachoItemFobArs(info, item) {
    var _a;
    const fromProduct = (0, channelMarginUtils_1.lookupFobPrice)(info, item.product_id, item.product_sku);
    if (fromProduct != null)
        return fromProduct;
    const variantSku = String(item.variant_sku || '').trim();
    if (!variantSku)
        return null;
    const base = variantSku.includes('-') ? variantSku.split('-')[0] : variantSku;
    return (_a = (0, channelMarginUtils_1.lookupFobPrice)(info, null, base)) !== null && _a !== void 0 ? _a : (0, channelMarginUtils_1.lookupFobPrice)(info, null, variantSku);
}
/** FOB unitario en USD (lista en pesos ÷ 1500). Usar en despachos. */
function lookupDespachoItemFob(info, item) {
    return fobArsToUsd(lookupDespachoItemFobArs(info, item));
}
function loadDespachoFobList() {
    return __awaiter(this, void 0, void 0, function* () {
        return (0, channelMarginUtils_1.resolveFobPriceListByName)(exports.DESPACHO_FOB_PRICE_LIST_NAME);
    });
}
function loadItems(despachoIds) {
    return __awaiter(this, void 0, void 0, function* () {
        const where = despachoIds && despachoIds.length > 0
            ? `WHERE di.despacho_id IN (${despachoIds.map(() => '?').join(',')})`
            : '';
        return (yield (0, db_1.query)(`SELECT di.id, di.despacho_id, di.cantidad, di.product_id, p.sku AS product_sku, pv.sku AS variant_sku
     FROM despacho_items di
     LEFT JOIN products p ON p.id = di.product_id
     LEFT JOIN product_variants pv ON pv.id = di.variant_id
     ${where}`, despachoIds && despachoIds.length > 0 ? despachoIds : []));
    });
}
function totalsFromItems(items, info) {
    const totals = new Map();
    for (const item of items) {
        const fob = lookupDespachoItemFob(info, item);
        if (fob == null)
            continue;
        const qty = Number(item.cantidad) || 0;
        if (qty <= 0)
            continue;
        const despachoId = String(item.despacho_id);
        totals.set(despachoId, roundMoney((totals.get(despachoId) || 0) + fob * qty));
    }
    return totals;
}
/** Recalcula y persiste valor_fob de uno o todos los despachos según Precios Fob Marzo. */
function persistDespachoFobFromList(despachoId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const info = yield loadDespachoFobList();
        const items = yield loadItems(despachoId ? [despachoId] : undefined);
        const totals = totalsFromItems(items, info);
        if (despachoId) {
            yield (0, db_1.execute)(`UPDATE despachos SET valor_fob = ? WHERE id = ?`, [(_a = totals.get(despachoId)) !== null && _a !== void 0 ? _a : 0, despachoId]);
            return info;
        }
        const allIds = (yield (0, db_1.query)(`SELECT id FROM despachos`));
        for (const row of allIds) {
            yield (0, db_1.execute)(`UPDATE despachos SET valor_fob = ? WHERE id = ?`, [(_b = totals.get(String(row.id))) !== null && _b !== void 0 ? _b : 0, row.id]);
        }
        return info;
    });
}
function applyFobToDespachoItems(items, info) {
    return items.map((item) => {
        const fob = lookupDespachoItemFob(info, {
            product_id: item.product_id || null,
            product_sku: item.product_sku || null,
            variant_sku: item.variant_sku || null
        });
        const qty = Number(item.cantidad) || 0;
        const costoUnitario = fob !== null && fob !== void 0 ? fob : (item.costo_unitario != null ? Number(item.costo_unitario) : null);
        const costoLinea = costoUnitario != null && Number.isFinite(costoUnitario) ? roundMoney(costoUnitario * qty) : null;
        return Object.assign(Object.assign({}, item), { precio_fob: fob, costo_unitario: costoUnitario, costo_linea: costoLinea });
    });
}
function sumItemsFob(items) {
    return roundMoney(items.reduce((acc, item) => {
        if (item.costo_linea != null && Number.isFinite(item.costo_linea))
            return acc + item.costo_linea;
        const fob = item.precio_fob;
        const qty = Number(item.cantidad) || 0;
        if (fob != null && Number.isFinite(fob) && qty > 0)
            return acc + fob * qty;
        return acc;
    }, 0));
}
