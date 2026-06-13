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
exports.exportChannelMarginsXlsx = exports.getChannelMargins = void 0;
const exceljs_1 = __importDefault(require("exceljs"));
const db_1 = require("../database/db");
const integrations_controller_1 = require("./integrations.controller");
const channelMarginUtils_1 = require("../utils/channelMarginUtils");
const channelMarginFetch_1 = require("../utils/channelMarginFetch");
function buildChannelSlice(price, fee, fob) {
    const margin = (0, channelMarginUtils_1.calcMargin)(price, fee, fob);
    return {
        price: Math.round(price * 100) / 100,
        fee: Math.round(fee * 100) / 100,
        margin,
        marginPercent: margin != null ? (0, channelMarginUtils_1.calcMarginPercent)(margin, price) : null,
    };
}
const ML_LINKED = `(
  NULLIF(TRIM(pv.mercado_libre_item_id), '') IS NOT NULL
  OR NULLIF(TRIM(p.mercado_libre_id), '') IS NOT NULL
  OR NULLIF(TRIM(pv.mercado_libre_variant_id), '') IS NOT NULL
  OR EXISTS (SELECT 1 FROM variant_publications vp WHERE vp.variant_id = pv.id AND vp.platform = 'mercadolibre')
)`;
const TN_LINKED = `(
  (NULLIF(TRIM(p.tienda_nube_id), '') IS NOT NULL AND NULLIF(TRIM(pv.tienda_nube_variant_id), '') IS NOT NULL)
  OR EXISTS (SELECT 1 FROM variant_publications vp WHERE vp.variant_id = pv.id AND vp.platform = 'tiendanube')
)`;
function variantChannelWhere(channel) {
    if (channel === 'ml')
        return `AND ${ML_LINKED}`;
    if (channel === 'tn')
        return `AND ${TN_LINKED}`;
    return `AND (${ML_LINKED} OR ${TN_LINKED})`;
}
function trimId(v) {
    return v != null ? String(v).trim() : '';
}
function resolveVariantLinks(v, pubs) {
    const pub = pubs.get(v.variant_id);
    const mlItemId = trimId(v.mercado_libre_item_id) || trimId(v.mercado_libre_id) || trimId(pub === null || pub === void 0 ? void 0 : pub.mlProductId);
    const mlVariationId = trimId(v.mercado_libre_variant_id) || trimId(pub === null || pub === void 0 ? void 0 : pub.mlVariantId) || null;
    const tnProductId = trimId(v.tienda_nube_id) || trimId(pub === null || pub === void 0 ? void 0 : pub.tnProductId);
    const tnVariantId = trimId(v.tienda_nube_variant_id) || trimId(pub === null || pub === void 0 ? void 0 : pub.tnVariantId);
    return {
        mlItemId: mlItemId || null,
        mlVariationId: mlVariationId || null,
        hasMl: !!mlItemId,
        tnProductId: tnProductId || null,
        tnVariantId: tnVariantId || null,
        hasTn: !!(tnProductId && tnVariantId),
    };
}
function loadPublicationLinks(variantIds) {
    return __awaiter(this, void 0, void 0, function* () {
        const map = new Map();
        if (variantIds.length === 0)
            return map;
        const placeholders = variantIds.map(() => '?').join(',');
        const rows = (yield (0, db_1.query)(`SELECT variant_id, platform, external_product_id, external_variant_id
     FROM variant_publications
     WHERE variant_id IN (${placeholders})`, variantIds));
        for (const r of rows || []) {
            if (!map.has(r.variant_id))
                map.set(r.variant_id, {});
            const entry = map.get(r.variant_id);
            const prod = trimId(r.external_product_id);
            const vari = trimId(r.external_variant_id);
            if (r.platform === 'mercadolibre' && prod && !entry.mlProductId) {
                entry.mlProductId = prod;
                entry.mlVariantId = vari;
            }
            if (r.platform === 'tiendanube' && prod && vari && !entry.tnProductId) {
                entry.tnProductId = prod;
                entry.tnVariantId = vari;
            }
        }
        return map;
    });
}
function computeChannelMargins() {
    return __awaiter(this, arguments, void 0, function* (opts = {}) {
        var _a, _b, _c, _d;
        const search = String(opts.search || '').trim();
        const page = Math.max(1, parseInt(String(opts.page || '1'), 10) || 1);
        const limit = Math.min(100, Math.max(10, parseInt(String(opts.limit || '50'), 10) || 50));
        const channel = String(opts.channel || 'all').toLowerCase();
        const paginate = opts.paginate !== false;
        const offset = (page - 1) * limit;
        const channelWhere = variantChannelWhere(channel);
        const searchWhere = search
            ? `AND (p.name LIKE ? OR p.sku LIKE ? OR pv.sku LIKE ? OR c.name LIKE ?)`
            : '';
        const searchParams = search ? [`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`] : [];
        const joinFrom = `
       FROM products p
       INNER JOIN product_colors pc ON pc.product_id = p.id
       INNER JOIN product_variants pv ON pv.product_color_id = pc.id
       INNER JOIN colors c ON c.id = pc.color_id
       INNER JOIN sizes s ON s.id = pv.size_id
       WHERE 1=1 ${channelWhere} ${searchWhere}`;
        const countRow = (yield (0, db_1.get)(`SELECT COUNT(DISTINCT p.id) AS total ${joinFrom}`, searchParams));
        const total = Number((_a = countRow === null || countRow === void 0 ? void 0 : countRow.total) !== null && _a !== void 0 ? _a : 0);
        const productQuery = `SELECT p.id AS product_id, p.name AS product_name, p.sku AS base_sku,
              COUNT(DISTINCT pv.id) AS variant_count
       ${joinFrom}
       GROUP BY p.id, p.name, p.sku
       ORDER BY p.name${paginate ? ' LIMIT ? OFFSET ?' : ''}`;
        const productRows = (yield (0, db_1.query)(productQuery, paginate ? [...searchParams, limit, offset] : searchParams));
        const fobInfo = yield (0, channelMarginUtils_1.resolveFobPriceList)();
        const tnPreset = (0, channelMarginUtils_1.resolveTnFeePreset)(String(opts.tnFeePreset || ''));
        if (productRows.length === 0) {
            return {
                config: buildConfigResponse(fobInfo, tnPreset),
                total,
                page: paginate ? page : 1,
                limit: paginate ? limit : total,
                rows: [],
            };
        }
        const productIds = productRows.map((p) => p.product_id);
        const placeholders = productIds.map(() => '?').join(',');
        const linkedVariantRows = (yield (0, db_1.query)(`SELECT pv.id AS variant_id, p.id AS product_id, pv.sku,
            c.name AS color_name, s.size_code,
            p.mercado_libre_id, pv.mercado_libre_item_id, pv.mercado_libre_variant_id,
            p.tienda_nube_id, pv.tienda_nube_variant_id
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN products p ON p.id = pc.product_id
     JOIN colors c ON c.id = pc.color_id
     JOIN sizes s ON s.id = pv.size_id
     WHERE p.id IN (${placeholders}) ${channelWhere}
     ORDER BY p.id, s.size_code, c.name`, productIds));
        const allVariantRows = (yield (0, db_1.query)(`SELECT pv.id AS variant_id, p.id AS product_id
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN products p ON p.id = pc.product_id
     WHERE p.id IN (${placeholders})
     ORDER BY p.id, pv.sku`, productIds));
        const allVariantIdsByProduct = new Map();
        for (const v of allVariantRows) {
            if (!allVariantIdsByProduct.has(v.product_id))
                allVariantIdsByProduct.set(v.product_id, []);
            allVariantIdsByProduct.get(v.product_id).push(v.variant_id);
        }
        const pubLinks = yield loadPublicationLinks(linkedVariantRows.map((v) => v.variant_id));
        const mlPaymentCptPercent = (0, channelMarginUtils_1.getMlPaymentCptPercent)();
        const variantsByProduct = new Map();
        for (const v of linkedVariantRows) {
            if (!variantsByProduct.has(v.product_id))
                variantsByProduct.set(v.product_id, []);
            variantsByProduct.get(v.product_id).push(v);
        }
        const mlToken = yield (0, integrations_controller_1.getValidMLToken)();
        const feeCache = new Map();
        const mlItemCache = new Map();
        const prices = {};
        const mlItemIds = new Map();
        const tnProductIds = new Map();
        for (const v of linkedVariantRows) {
            prices[v.variant_id] = {};
            const links = resolveVariantLinks(v, pubLinks);
            if (links.mlItemId && (mlToken === null || mlToken === void 0 ? void 0 : mlToken.access_token)) {
                if (!mlItemIds.has(links.mlItemId))
                    mlItemIds.set(links.mlItemId, []);
                mlItemIds.get(links.mlItemId).push({
                    variantId: v.variant_id,
                    variationId: links.mlVariationId,
                });
            }
            if (links.tnProductId && links.tnVariantId) {
                if (!tnProductIds.has(links.tnProductId))
                    tnProductIds.set(links.tnProductId, []);
                tnProductIds.get(links.tnProductId).push({
                    variantId: v.variant_id,
                    tnVariantId: links.tnVariantId,
                });
            }
        }
        if ((mlToken === null || mlToken === void 0 ? void 0 : mlToken.access_token) && mlItemIds.size > 0) {
            yield (0, channelMarginFetch_1.fetchMlItemsMultiget)(mlToken.access_token, mlItemIds, prices, mlItemCache);
        }
        const tnIntegration = yield (0, db_1.get)(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
        const tnStoreId = (0, channelMarginFetch_1.resolveTnStoreId)(tnIntegration);
        if ((tnIntegration === null || tnIntegration === void 0 ? void 0 : tnIntegration.access_token) && tnStoreId && tnProductIds.size > 0) {
            yield (0, channelMarginFetch_1.fetchTnProductsBatched)(tnStoreId, tnIntegration.access_token, tnProductIds, prices);
        }
        const mlMarginJobs = [];
        const outRows = [];
        for (const pr of productRows) {
            const vars = variantsByProduct.get(pr.product_id) || [];
            const variantIds = allVariantIdsByProduct.get(pr.product_id) || vars.map((v) => v.variant_id);
            const totalVariants = ((_b = allVariantIdsByProduct.get(pr.product_id)) === null || _b === void 0 ? void 0 : _b.length) ||
                Number(pr.variant_count) ||
                variantIds.length;
            const fobRaw = fobInfo.byProductId.get(pr.product_id);
            const fob = fobRaw != null && Number.isFinite(fobRaw) ? Number(fobRaw) : null;
            const repMl = vars.find((v) => resolveVariantLinks(v, pubLinks).hasMl);
            const hasTnLink = vars.some((v) => resolveVariantLinks(v, pubLinks).hasTn);
            let priceTN = 0;
            for (const v of vars) {
                const pt = (_c = prices[v.variant_id]) === null || _c === void 0 ? void 0 : _c.priceTN;
                if (pt != null && pt > 0) {
                    priceTN = pt;
                    break;
                }
            }
            let mlSlice = null;
            if (repMl) {
                const p = prices[repMl.variant_id] || {};
                if (p.priceML != null && p.priceML > 0) {
                    const mlItemId = resolveVariantLinks(repMl, pubLinks).mlItemId || '';
                    const item = (mlItemId && mlItemCache.get(String(mlItemId))) || p.mlItem || {};
                    if ((mlToken === null || mlToken === void 0 ? void 0 : mlToken.access_token) && mlItemId) {
                        mlMarginJobs.push({
                            productId: pr.product_id,
                            priceML: p.priceML,
                            mlItemId,
                            item,
                        });
                    }
                    else {
                        const paymentCpt = (0, channelMarginUtils_1.calcMlPaymentCpt)(p.priceML, mlPaymentCptPercent);
                        mlSlice = Object.assign(Object.assign({}, buildChannelSlice(p.priceML, paymentCpt, fob)), { feeListing: 0, feePayment: paymentCpt, linked: true });
                    }
                }
                else {
                    mlSlice = { price: 0, fee: 0, margin: null, marginPercent: null, linked: true };
                }
            }
            let tnSlice = null;
            if (hasTnLink) {
                if (priceTN > 0) {
                    const tnParts = (0, channelMarginUtils_1.calcTnSaleFeeFromPreset)(priceTN, tnPreset);
                    tnSlice = Object.assign(Object.assign({}, buildChannelSlice(priceTN, tnParts.total, fob)), { feeRate: tnParts.ratePart, feeCpt: tnParts.cptPart, linked: true });
                }
                else {
                    tnSlice = { price: 0, fee: 0, margin: null, marginPercent: null, linked: true };
                }
            }
            outRows.push({
                productId: pr.product_id,
                productName: pr.product_name || '',
                baseSku: pr.base_sku || '',
                variantCount: totalVariants,
                variantIds,
                fob,
                ml: mlSlice,
                tn: tnSlice,
            });
        }
        const mlListingFees = new Map();
        if ((mlToken === null || mlToken === void 0 ? void 0 : mlToken.access_token) && mlMarginJobs.length > 0) {
            yield (0, channelMarginFetch_1.runPool)(mlMarginJobs, 8, (job) => __awaiter(this, void 0, void 0, function* () {
                const fee = yield (0, channelMarginUtils_1.fetchListingSaleFeeAmount)(mlToken.access_token, job.item, job.priceML, feeCache);
                mlListingFees.set(job.productId, fee);
            }));
            for (const job of mlMarginJobs) {
                const row = outRows.find((r) => r.productId === job.productId);
                if (!row)
                    continue;
                const listingFee = (_d = mlListingFees.get(job.productId)) !== null && _d !== void 0 ? _d : 0;
                const paymentCpt = (0, channelMarginUtils_1.calcMlPaymentCpt)(job.priceML, mlPaymentCptPercent);
                const totalMlFee = Math.round((listingFee + paymentCpt) * 100) / 100;
                row.ml = Object.assign(Object.assign({}, buildChannelSlice(job.priceML, totalMlFee, row.fob)), { feeListing: listingFee, feePayment: paymentCpt, linked: true });
            }
        }
        return {
            config: buildConfigResponse(fobInfo, tnPreset),
            total,
            page: paginate ? page : 1,
            limit: paginate ? limit : total,
            rows: outRows,
        };
    });
}
function numOrBlank(v) {
    return v != null && Number.isFinite(v) ? v : '';
}
/** GET /integrations/channel-margins â€” una fila por artÃ­culo (producto padre). */
const getChannelMargins = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield computeChannelMargins({
            search: String(req.query.search || ''),
            channel: String(req.query.channel || 'all'),
            tnFeePreset: String(req.query.tnFeePreset || ''),
            page: parseInt(String(req.query.page || '1'), 10) || 1,
            limit: parseInt(String(req.query.limit || '50'), 10) || 50,
            paginate: true,
        });
        res.json(result);
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[getChannelMargins]', msg);
        res.status(500).json({ message: 'Error calculando márgenes', detail: msg });
    }
});
exports.getChannelMargins = getChannelMargins;
/** GET /integrations/channel-margins/export â€” Excel con todos los artÃ­culos (respeta filtros). */
const exportChannelMarginsXlsx = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    try {
        const result = yield computeChannelMargins({
            search: String(req.query.search || ''),
            channel: String(req.query.channel || 'all'),
            tnFeePreset: String(req.query.tnFeePreset || ''),
            paginate: false,
        });
        const wb = new exceljs_1.default.Workbook();
        wb.creator = 'LupoHub';
        wb.created = new Date();
        const ws = wb.addWorksheet('Margenes', {
            views: [{ state: 'frozen', ySplit: 3 }],
        });
        ws.mergeCells('A1:P1');
        ws.getCell('A1').value = 'Margenes por canal - LupoHub';
        ws.getCell('A1').font = { bold: true, size: 14 };
        ws.mergeCells('A2:P2');
        ws.getCell('A2').value =
            `FOB: ${result.config.fobListName || 'sin lista'} | TN: ${result.config.tnFeePresetLabel} | ML CPT: ${result.config.mlPaymentCptPercent}% | Generado: ${new Date().toLocaleString('es-AR')}`;
        const headers = [
            'SKU',
            'Artículo',
            'Variantes',
            'FOB',
            'ML Precio',
            'ML Comisión',
            'ML Com. venta',
            'ML CPT cobro',
            'ML Ganancia',
            'ML Margen %',
            'TN Precio',
            'TN Comisión',
            'TN Tasas',
            'TN CPT',
            'TN Ganancia',
            'TN Margen %',
        ];
        const headerRow = ws.getRow(3);
        headers.forEach((h, i) => {
            const cell = headerRow.getCell(i + 1);
            cell.value = h;
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        });
        headerRow.height = 22;
        for (const r of result.rows) {
            ws.addRow([
                r.baseSku,
                r.productName,
                r.variantCount,
                numOrBlank(r.fob),
                ((_a = r.ml) === null || _a === void 0 ? void 0 : _a.linked) && r.ml.price > 0 ? r.ml.price : '',
                ((_b = r.ml) === null || _b === void 0 ? void 0 : _b.linked) && r.ml.price > 0 ? r.ml.fee : '',
                ((_c = r.ml) === null || _c === void 0 ? void 0 : _c.feeListing) != null ? r.ml.feeListing : '',
                ((_d = r.ml) === null || _d === void 0 ? void 0 : _d.feePayment) != null ? r.ml.feePayment : '',
                numOrBlank((_e = r.ml) === null || _e === void 0 ? void 0 : _e.margin),
                numOrBlank((_f = r.ml) === null || _f === void 0 ? void 0 : _f.marginPercent),
                ((_g = r.tn) === null || _g === void 0 ? void 0 : _g.linked) && r.tn.price > 0 ? r.tn.price : '',
                ((_h = r.tn) === null || _h === void 0 ? void 0 : _h.linked) && r.tn.price > 0 ? r.tn.fee : '',
                ((_j = r.tn) === null || _j === void 0 ? void 0 : _j.feeRate) != null ? r.tn.feeRate : '',
                ((_k = r.tn) === null || _k === void 0 ? void 0 : _k.feeCpt) != null ? r.tn.feeCpt : '',
                numOrBlank((_l = r.tn) === null || _l === void 0 ? void 0 : _l.margin),
                numOrBlank((_m = r.tn) === null || _m === void 0 ? void 0 : _m.marginPercent),
            ]);
        }
        ws.columns = [
            { width: 14 },
            { width: 36 },
            { width: 10 },
            { width: 12 },
            { width: 12 },
            { width: 12 },
            { width: 12 },
            { width: 12 },
            { width: 12 },
            { width: 11 },
            { width: 12 },
            { width: 12 },
            { width: 12 },
            { width: 10 },
            { width: 12 },
            { width: 11 },
        ];
        const moneyCols = [4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15];
        for (let rowIdx = 4; rowIdx <= ws.rowCount; rowIdx++) {
            for (const col of moneyCols) {
                const cell = ws.getRow(rowIdx).getCell(col);
                if (typeof cell.value === 'number') {
                    cell.numFmt = '#,##0.00';
                }
            }
            const pctCell = ws.getRow(rowIdx).getCell(10);
            if (typeof pctCell.value === 'number')
                pctCell.numFmt = '0.0"%"';
            const pctTnCell = ws.getRow(rowIdx).getCell(16);
            if (typeof pctTnCell.value === 'number')
                pctTnCell.numFmt = '0.0"%"';
        }
        const buf = yield wb.xlsx.writeBuffer();
        const dateTag = new Date().toISOString().slice(0, 10);
        const filename = `margenes_precios_${dateTag}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(Buffer.from(buf));
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[exportChannelMarginsXlsx]', msg);
        res.status(500).json({ message: 'Error exportando márgenes', detail: msg });
    }
});
exports.exportChannelMarginsXlsx = exportChannelMarginsXlsx;
function buildConfigResponse(fobInfo, tnPreset) {
    const ivaPercent = Math.round(((0, channelMarginUtils_1.getIvaMultiplier)() - 1) * 10000) / 100;
    return {
        fobListId: fobInfo.id,
        fobListName: fobInfo.name || null,
        ivaPercent,
        tnFeePresetId: tnPreset.id,
        tnFeePresetLabel: tnPreset.label,
        tnFeePresets: (0, channelMarginUtils_1.listTnFeePresets)(),
        mlListingFeeSource: 'API Mercado Libre listing_prices (comisión por vender)',
        mlPaymentCptPercent: (0, channelMarginUtils_1.getMlPaymentCptPercent)(),
        mlPaymentCptSource: 'CPT cobro (Personalizado / transferencia, configurable con LUPOHUB_ML_PAYMENT_CPT_PERCENT)',
    };
}
