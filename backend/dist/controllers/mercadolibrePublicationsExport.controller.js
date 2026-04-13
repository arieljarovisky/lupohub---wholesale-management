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
exports.exportMercadolibrePublicationsXlsx = void 0;
const axios_1 = __importDefault(require("axios"));
const exceljs_1 = __importDefault(require("exceljs"));
const db_1 = require("../database/db");
const integrations_controller_1 = require("./integrations.controller");
const ML_SYNC_MAX_ITEMS = Math.max(100, parseInt(process.env.ML_SYNC_MAX_ITEMS || '5000', 10));
function normalizeSkuForMatch(raw) {
    return (raw !== null && raw !== void 0 ? raw : '')
        .toString()
        .trim()
        .toUpperCase()
        .replace(/[\s\-\/]/g, '');
}
function mlSkuFromVariation(v) {
    var _a, _b, _c, _d;
    const skuAttr = Array.isArray(v === null || v === void 0 ? void 0 : v.attributes)
        ? v.attributes.find((a) => ((a === null || a === void 0 ? void 0 : a.id) || '').toString().toUpperCase() === 'SELLER_SKU')
        : null;
    const fromAttr = skuAttr ? ((_b = (_a = skuAttr.value_name) !== null && _a !== void 0 ? _a : skuAttr.value) !== null && _b !== void 0 ? _b : '').toString().trim() : '';
    const fromFields = ((_d = (_c = v === null || v === void 0 ? void 0 : v.seller_sku) !== null && _c !== void 0 ? _c : v === null || v === void 0 ? void 0 : v.seller_custom_field) !== null && _d !== void 0 ? _d : '').toString().trim();
    return fromAttr || fromFields;
}
function mlSkuFromItem(item) {
    var _a, _b, _c, _d, _e;
    let s = ((_b = (_a = item === null || item === void 0 ? void 0 : item.seller_sku) !== null && _a !== void 0 ? _a : item === null || item === void 0 ? void 0 : item.seller_custom_field) !== null && _b !== void 0 ? _b : '').toString().trim();
    if (!s && Array.isArray(item === null || item === void 0 ? void 0 : item.attributes)) {
        const skuAttr = item.attributes.find((a) => ((a === null || a === void 0 ? void 0 : a.id) || '').toString().toUpperCase() === 'SELLER_SKU');
        s = (skuAttr ? ((_d = (_c = skuAttr.value_name) !== null && _c !== void 0 ? _c : skuAttr.value) !== null && _d !== void 0 ? _d : '') : '').toString().trim();
    }
    if (!s && ((_e = item === null || item === void 0 ? void 0 : item.variations) === null || _e === void 0 ? void 0 : _e.length) === 1) {
        return mlSkuFromVariation(item.variations[0]);
    }
    return s;
}
function pickLatestFob(rows) {
    const map = new Map();
    for (const r of rows) {
        if (!r.variant_id)
            continue;
        const fechaStr = r.fecha_despacho instanceof Date
            ? r.fecha_despacho.toISOString().slice(0, 10)
            : String(r.fecha_despacho || '').slice(0, 10);
        const prev = map.get(r.variant_id);
        if (!prev || fechaStr > prev.fecha) {
            map.set(r.variant_id, {
                cost: Number(r.costo_unitario) || 0,
                fecha: fechaStr || '',
                moneda: (r.moneda || 'USD').toString().trim() || 'USD'
            });
        }
    }
    return map;
}
function resolveHubVariant(itemId, variationId, skuMlNorm, hubBySku, hubByMlItem, hubByMlProduct, pubMap) {
    const vKey = variationId != null && variationId !== '' ? `${itemId}|${variationId}` : `${itemId}|`;
    const pub = pubMap.get(vKey);
    if (pub)
        return pub;
    if (variationId != null && variationId !== '') {
        const pub2 = pubMap.get(`${itemId}|${String(variationId)}`);
        if (pub2)
            return pub2;
    }
    if (skuMlNorm) {
        const bySku = hubBySku.get(skuMlNorm);
        if (bySku)
            return bySku;
    }
    const listItem = hubByMlItem.get(itemId);
    if ((listItem === null || listItem === void 0 ? void 0 : listItem.length) === 1) {
        const only = listItem[0];
        if (!variationId || !only.mercado_libre_variant_id || String(only.mercado_libre_variant_id) === String(variationId)) {
            return only;
        }
    }
    if (listItem && variationId) {
        const byVar = listItem.find((h) => h.mercado_libre_variant_id && String(h.mercado_libre_variant_id) === String(variationId));
        if (byVar)
            return byVar;
    }
    const listProd = hubByMlProduct.get(itemId);
    if ((listProd === null || listProd === void 0 ? void 0 : listProd.length) === 1)
        return listProd[0];
    if (listProd && variationId) {
        const byVar = listProd.find((h) => h.mercado_libre_variant_id && String(h.mercado_libre_variant_id) === String(variationId));
        if (byVar)
            return byVar;
    }
    return null;
}
const exportMercadolibrePublicationsXlsx = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    try {
        const mlToken = yield (0, integrations_controller_1.getValidMLToken)();
        if (!mlToken) {
            return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
        }
        const hubRows = (yield (0, db_1.query)(`
      SELECT pv.id AS variant_id,
             TRIM(COALESCE(pv.external_sku, pv.sku)) AS sku_raw,
             pv.mercado_libre_item_id,
             pv.mercado_libre_variant_id,
             p.id AS product_id,
             p.name AS product_name,
             p.base_price,
             COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS mayorista_pack_size,
             p.mercado_libre_id,
             COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack_default
      FROM product_variants pv
      JOIN product_colors pc ON pc.id = pv.product_color_id
      JOIN products p ON p.id = pc.product_id
    `));
        const hubBySku = new Map();
        const hubByMlItem = new Map();
        const hubByMlProduct = new Map();
        const variantById = new Map();
        for (const r of hubRows) {
            const skuRaw = (r.sku_raw || '').toString();
            const hv = {
                variant_id: r.variant_id,
                sku_raw: skuRaw,
                sku_norm: normalizeSkuForMatch(skuRaw),
                mercado_libre_item_id: r.mercado_libre_item_id,
                mercado_libre_variant_id: r.mercado_libre_variant_id,
                product_id: r.product_id,
                product_name: (r.product_name || '').toString(),
                base_price: Number((_a = r.base_price) !== null && _a !== void 0 ? _a : 0),
                mayorista_pack_size: Math.max(1, Number(r.mayorista_pack_size) || 1),
                mercado_libre_id: r.mercado_libre_id,
                ml_pack_default: Math.max(1, Number(r.ml_pack_default) || 1)
            };
            variantById.set(r.variant_id, hv);
            if (hv.sku_norm)
                hubBySku.set(hv.sku_norm, hv);
            if (r.mercado_libre_item_id) {
                const k = String(r.mercado_libre_item_id).trim();
                if (!hubByMlItem.has(k))
                    hubByMlItem.set(k, []);
                hubByMlItem.get(k).push(hv);
            }
            if (r.mercado_libre_id) {
                const k = String(r.mercado_libre_id).trim();
                if (!hubByMlProduct.has(k))
                    hubByMlProduct.set(k, []);
                hubByMlProduct.get(k).push(hv);
            }
        }
        const pubRows = (yield (0, db_1.query)(`SELECT variant_id, external_product_id, external_variant_id, pack_size
       FROM variant_publications WHERE platform = 'mercadolibre'`));
        const pubMap = new Map();
        for (const pr of pubRows) {
            const base = variantById.get(pr.variant_id);
            if (!base)
                continue;
            const extVar = pr.external_variant_id != null && String(pr.external_variant_id).trim() !== ''
                ? String(pr.external_variant_id).trim()
                : '';
            const key = `${String(pr.external_product_id).trim()}|${extVar}`;
            pubMap.set(key, Object.assign(Object.assign({}, base), { pub_pack: pr.pack_size != null ? Math.max(1, Number(pr.pack_size) || 1) : null }));
        }
        const fobRows = (yield (0, db_1.query)(`SELECT di.variant_id, di.costo_unitario, d.fecha_despacho, d.moneda
       FROM despacho_items di
       JOIN despachos d ON d.id = di.despacho_id
       WHERE di.variant_id IS NOT NULL AND di.costo_unitario IS NOT NULL`));
        const fobByVariant = pickLatestFob(fobRows.map((x) => ({
            variant_id: x.variant_id,
            costo_unitario: Number(x.costo_unitario) || 0,
            fecha_despacho: x.fecha_despacho,
            moneda: x.moneda
        })));
        const seen = new Set();
        const allItemIds = [];
        for (const st of ['active', 'paused', 'closed']) {
            let offset = 0;
            const limit = 100;
            while (allItemIds.length < ML_SYNC_MAX_ITEMS) {
                const itemsRes = yield axios_1.default.get(`https://api.mercadolibre.com/users/${mlToken.user_id}/items/search?status=${st}&offset=${offset}&limit=${limit}`, { headers: { Authorization: `Bearer ${mlToken.access_token}` } });
                const ids = ((_b = itemsRes.data) === null || _b === void 0 ? void 0 : _b.results) || [];
                if (ids.length === 0)
                    break;
                for (const id of ids) {
                    if (seen.has(id))
                        continue;
                    seen.add(id);
                    allItemIds.push(id);
                    if (allItemIds.length >= ML_SYNC_MAX_ITEMS)
                        break;
                }
                if (allItemIds.length >= ML_SYNC_MAX_ITEMS)
                    break;
                if (ids.length < limit)
                    break;
                offset += limit;
            }
        }
        const dataRows = [];
        const batchSize = 10;
        for (let i = 0; i < allItemIds.length; i += batchSize) {
            const batch = allItemIds.slice(i, i + batchSize);
            const itemPromises = batch.map((itemId) => axios_1.default
                .get(`https://api.mercadolibre.com/items/${itemId}?include_attributes=all`, {
                headers: { Authorization: `Bearer ${mlToken.access_token}` }
            })
                .then((r) => r.data)
                .catch(() => null));
            const items = yield Promise.all(itemPromises);
            for (const item of items) {
                if (!(item === null || item === void 0 ? void 0 : item.id))
                    continue;
                const currency = (item.currency_id || '').toString();
                const permalink = (item.permalink || '').toString();
                const title = (item.title || '').toString();
                const status = (item.status || '').toString();
                const pushRow = (opts) => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
                    const skuNorm = normalizeSkuForMatch(opts.skuMl);
                    const hub = resolveHubVariant(String(item.id), opts.variationId, skuNorm, hubBySku, hubByMlItem, hubByMlProduct, pubMap);
                    const packMayor = (_a = hub === null || hub === void 0 ? void 0 : hub.mayorista_pack_size) !== null && _a !== void 0 ? _a : 1;
                    const precioMayorista = (_b = hub === null || hub === void 0 ? void 0 : hub.base_price) !== null && _b !== void 0 ? _b : null;
                    const precioUnitMayorista = precioMayorista != null ? Number(precioMayorista) / Math.max(1, packMayor) : null;
                    const fob = hub ? fobByVariant.get(hub.variant_id) : undefined;
                    const margenPct = precioUnitMayorista != null && opts.price > 0
                        ? ((opts.price - precioUnitMayorista) / opts.price) * 100
                        : null;
                    dataRows.push({
                        item_id: String(item.id),
                        variation_id: (_c = opts.variationId) !== null && _c !== void 0 ? _c : '',
                        titulo: title,
                        estado: status,
                        moneda_ml: currency,
                        precio_ml: opts.price,
                        stock: opts.stock,
                        vendidos: opts.sold,
                        sku_ml: opts.skuMl,
                        color_talle: opts.attrText,
                        producto_lupo: (_d = hub === null || hub === void 0 ? void 0 : hub.product_name) !== null && _d !== void 0 ? _d : '',
                        sku_lupo: (_e = hub === null || hub === void 0 ? void 0 : hub.sku_raw) !== null && _e !== void 0 ? _e : '',
                        variant_id_lupo: (_f = hub === null || hub === void 0 ? void 0 : hub.variant_id) !== null && _f !== void 0 ? _f : '',
                        precio_mayorista_ars: precioMayorista,
                        pack_mayorista: packMayor,
                        precio_unidad_mayorista_ars: precioUnitMayorista,
                        pack_ml: (_h = (_g = hub === null || hub === void 0 ? void 0 : hub.pub_pack) !== null && _g !== void 0 ? _g : hub === null || hub === void 0 ? void 0 : hub.ml_pack_default) !== null && _h !== void 0 ? _h : '',
                        costo_fob: (_j = fob === null || fob === void 0 ? void 0 : fob.cost) !== null && _j !== void 0 ? _j : '',
                        moneda_fob: (_k = fob === null || fob === void 0 ? void 0 : fob.moneda) !== null && _k !== void 0 ? _k : '',
                        fecha_ultimo_despacho: (_l = fob === null || fob === void 0 ? void 0 : fob.fecha) !== null && _l !== void 0 ? _l : '',
                        margen_bruto_pct_ml_vs_mayorista: margenPct !== null ? Math.round(margenPct * 100) / 100 : '',
                        permalink
                    });
                };
                if (item.variations && item.variations.length > 0) {
                    for (const v of item.variations) {
                        const skuMl = mlSkuFromVariation(v);
                        const price = Number((_d = (_c = v.price) !== null && _c !== void 0 ? _c : item.price) !== null && _d !== void 0 ? _d : 0) || 0;
                        const stock = Number((_e = v.available_quantity) !== null && _e !== void 0 ? _e : 0) || 0;
                        const sold = Number((_f = v.sold_quantity) !== null && _f !== void 0 ? _f : 0) || 0;
                        const parts = [];
                        (v.attribute_combinations || []).forEach((attr) => {
                            const name = (attr.value_name || attr.name || '').toString().trim();
                            const id = (attr.id || '').toString();
                            if (name)
                                parts.push(`${id}:${name}`);
                        });
                        pushRow({
                            variationId: String(v.id),
                            skuMl,
                            price,
                            stock,
                            sold,
                            attrText: parts.join(' · ')
                        });
                    }
                }
                else {
                    const skuMl = mlSkuFromItem(item);
                    const price = Number((_g = item.price) !== null && _g !== void 0 ? _g : 0) || 0;
                    const stock = Number((_h = item.available_quantity) !== null && _h !== void 0 ? _h : 0) || 0;
                    const sold = Number((_j = item.sold_quantity) !== null && _j !== void 0 ? _j : 0) || 0;
                    pushRow({
                        variationId: null,
                        skuMl,
                        price,
                        stock,
                        sold,
                        attrText: ''
                    });
                }
            }
        }
        const workbook = new exceljs_1.default.Workbook();
        workbook.creator = 'LupoHub';
        workbook.created = new Date();
        const ws = workbook.addWorksheet('Publicaciones ML', {
            views: [{ state: 'frozen', ySplit: 1 }],
            properties: { defaultRowHeight: 18 }
        });
        const headers = [
            'ID publicación',
            'ID variación',
            'Título',
            'Estado',
            'Moneda ML',
            'Precio ML',
            'Stock',
            'Vendidos',
            'SKU ML',
            'Atributos variación',
            'Producto LupoHub',
            'SKU LupoHub',
            'Variante LupoHub (id)',
            'Precio mayorista ARS (lista)',
            'Pack mayorista (uds)',
            'Precio unidad mayorista ARS',
            'Pack ML (vinculación)',
            'Costo FOB último despacho',
            'Moneda FOB',
            'Fecha último despacho',
            'Margen bruto % (ML vs unidad mayorista)',
            'Permalink'
        ];
        ws.addRow(headers);
        const headerRow = ws.getRow(1);
        headerRow.font = { bold: true, name: 'Calibri', size: 11 };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF1E40AF' }
        };
        headerRow.eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri', size: 11 };
            cell.alignment = { vertical: 'middle', wrapText: true };
        });
        const colKeys = [
            'item_id',
            'variation_id',
            'titulo',
            'estado',
            'moneda_ml',
            'precio_ml',
            'stock',
            'vendidos',
            'sku_ml',
            'color_talle',
            'producto_lupo',
            'sku_lupo',
            'variant_id_lupo',
            'precio_mayorista_ars',
            'pack_mayorista',
            'precio_unidad_mayorista_ars',
            'pack_ml',
            'costo_fob',
            'moneda_fob',
            'fecha_ultimo_despacho',
            'margen_bruto_pct_ml_vs_mayorista',
            'permalink'
        ];
        let r = 2;
        for (const row of dataRows) {
            const values = colKeys.map((k) => { var _a; return (_a = row[k]) !== null && _a !== void 0 ? _a : ''; });
            const dataRow = ws.addRow(values);
            dataRow.eachCell((cell, colNumber) => {
                cell.font = { name: 'Calibri', size: 11 };
                if ([6, 14, 16, 18, 21].includes(colNumber))
                    cell.numFmt = '#,##0.00';
                if ([7, 8].includes(colNumber))
                    cell.numFmt = '0';
            });
            if (r % 2 === 0) {
                dataRow.eachCell((cell) => {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
                });
            }
            r++;
        }
        ws.columns = [
            { width: 14 },
            { width: 12 },
            { width: 42 },
            { width: 10 },
            { width: 10 },
            { width: 12 },
            { width: 8 },
            { width: 8 },
            { width: 16 },
            { width: 28 },
            { width: 28 },
            { width: 14 },
            { width: 36 },
            { width: 14 },
            { width: 12 },
            { width: 18 },
            { width: 14 },
            { width: 14 },
            { width: 10 },
            { width: 16 },
            { width: 18 },
            { width: 48 }
        ];
        const buf = yield workbook.xlsx.writeBuffer();
        const filename = `publicaciones_ml_${new Date().toISOString().slice(0, 10)}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(Buffer.from(buf));
    }
    catch (error) {
        console.error('exportMercadolibrePublicationsXlsx:', error);
        res.status(500).json({ message: 'Error generando exportación de Mercado Libre', error: error.message });
    }
});
exports.exportMercadolibrePublicationsXlsx = exportMercadolibrePublicationsXlsx;
