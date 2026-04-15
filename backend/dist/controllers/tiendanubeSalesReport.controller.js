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
exports.exportTiendaNubeSalesReportXlsx = void 0;
const axios_1 = __importDefault(require("axios"));
const exceljs_1 = __importDefault(require("exceljs"));
const db_1 = require("../database/db");
const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';
function asYmd(raw) {
    const s = String(raw || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}
function asIsoBounds(fromYmd, toYmd) {
    // Mantener franja local Argentina para evitar recortes por timezone.
    return {
        minIso: `${fromYmd}T00:00:00-03:00`,
        maxIso: `${toYmd}T23:59:59-03:00`
    };
}
function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
function parseProductsFilter(raw) {
    const base = String(raw || '').trim();
    if (!base)
        return [];
    return base
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => x.toLowerCase());
}
const exportTiendaNubeSalesReportXlsx = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
    try {
        const integration = yield (0, db_1.get)(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
        if (!(integration === null || integration === void 0 ? void 0 : integration.access_token)) {
            return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
        }
        const storeId = integration.store_id || integration.user_id;
        if (!storeId) {
            return res.status(400).json({ message: 'No se encontró store_id de Tienda Nube' });
        }
        const from = asYmd(req.query.from || req.query.desde);
        const to = asYmd(req.query.to || req.query.hasta);
        if (!from || !to) {
            return res.status(400).json({ message: 'Parámetros requeridos: from y to en formato YYYY-MM-DD' });
        }
        if (from > to) {
            return res.status(400).json({ message: 'Rango inválido: from no puede ser mayor que to' });
        }
        const { minIso, maxIso } = asIsoBounds(from, to);
        const perPage = 200;
        let page = 1;
        const rawOrders = [];
        while (true) {
            const response = yield axios_1.default.get(`https://api.tiendanube.com/v1/${storeId}/orders`, {
                headers: {
                    Authentication: `bearer ${integration.access_token}`,
                    'User-Agent': TN_USER_AGENT
                },
                params: {
                    page,
                    per_page: perPage,
                    created_at_min: minIso,
                    created_at_max: maxIso
                },
                validateStatus: () => true
            });
            if (response.status !== 200) {
                const detail = ((_a = response.data) === null || _a === void 0 ? void 0 : _a.description) ||
                    ((_b = response.data) === null || _b === void 0 ? void 0 : _b.message) ||
                    ((_c = response.data) === null || _c === void 0 ? void 0 : _c.error) ||
                    response.statusText;
                return res.status(response.status >= 400 ? 502 : 500).json({
                    message: 'Error consultando órdenes de Tienda Nube',
                    detail
                });
            }
            const batch = Array.isArray(response.data) ? response.data : [];
            if (batch.length === 0)
                break;
            rawOrders.push(...batch);
            if (batch.length < perPage)
                break;
            page += 1;
            if (page > 400)
                break;
        }
        const selectedProducts = parseProductsFilter(req.query.products);
        const aggMap = new Map();
        let matchedLines = 0;
        for (const order of rawOrders) {
            const lines = Array.isArray(order === null || order === void 0 ? void 0 : order.products) ? order.products : [];
            for (const p of lines) {
                const productId = String((_e = (_d = p === null || p === void 0 ? void 0 : p.product_id) !== null && _d !== void 0 ? _d : p === null || p === void 0 ? void 0 : p.id) !== null && _e !== void 0 ? _e : '').trim();
                const sku = String((_g = (_f = p === null || p === void 0 ? void 0 : p.sku) !== null && _f !== void 0 ? _f : p === null || p === void 0 ? void 0 : p.variant_sku) !== null && _g !== void 0 ? _g : '').trim();
                const name = String((_k = (_j = (_h = p === null || p === void 0 ? void 0 : p.name) !== null && _h !== void 0 ? _h : p === null || p === void 0 ? void 0 : p.product_name) !== null && _j !== void 0 ? _j : p === null || p === void 0 ? void 0 : p.title) !== null && _k !== void 0 ? _k : '').trim() || 'Producto';
                const quantity = Math.max(0, toNum((_m = (_l = p === null || p === void 0 ? void 0 : p.quantity) !== null && _l !== void 0 ? _l : p === null || p === void 0 ? void 0 : p.qty) !== null && _m !== void 0 ? _m : 0));
                const unitPrice = toNum((_q = (_p = (_o = p === null || p === void 0 ? void 0 : p.price) !== null && _o !== void 0 ? _o : p === null || p === void 0 ? void 0 : p.price_per_unit) !== null && _p !== void 0 ? _p : p === null || p === void 0 ? void 0 : p.promotional_price) !== null && _q !== void 0 ? _q : 0);
                if (quantity <= 0)
                    continue;
                const idLower = productId.toLowerCase();
                const skuLower = sku.toLowerCase();
                const nameLower = name.toLowerCase();
                if (selectedProducts.length > 0 &&
                    !selectedProducts.some((term) => term === idLower || term === skuLower || nameLower.includes(term))) {
                    continue;
                }
                matchedLines += 1;
                const code = sku || productId || name;
                const key = `${productId}||${sku}||${name}`.toLowerCase();
                const prev = aggMap.get(key) || {
                    codigo: code,
                    producto: name,
                    cantidad: 0,
                    total: 0
                };
                prev.cantidad += quantity;
                prev.total += unitPrice * quantity;
                aggMap.set(key, prev);
            }
        }
        const productRows = Array.from(aggMap.values()).map((r) => ({
            codigo: r.codigo,
            producto: r.producto,
            cantidad: r.cantidad,
            precio: r.cantidad > 0 ? r.total / r.cantidad : 0
        }));
        productRows.sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
        const totalUnits = productRows.reduce((acc, r) => acc + r.cantidad, 0);
        const totalAmount = productRows.reduce((acc, r) => acc + r.precio * r.cantidad, 0);
        const wb = new exceljs_1.default.Workbook();
        wb.creator = 'LupoHub';
        wb.created = new Date();
        const wsResumen = wb.addWorksheet('Resumen');
        wsResumen.columns = [{ width: 36 }, { width: 24 }];
        wsResumen.addRow(['Reporte ventas Tienda Nube', '']);
        wsResumen.mergeCells(1, 1, 1, 2);
        wsResumen.addRow(['Período desde', from]);
        wsResumen.addRow(['Período hasta', to]);
        wsResumen.addRow(['Órdenes analizadas', rawOrders.length]);
        wsResumen.addRow(['Filtro productos', selectedProducts.length > 0 ? selectedProducts.join(', ') : 'Todos']);
        wsResumen.addRow(['Líneas que matchearon filtro', matchedLines]);
        wsResumen.addRow(['Productos en reporte', productRows.length]);
        wsResumen.addRow(['Unidades vendidas', totalUnits]);
        wsResumen.addRow(['Total vendido (aprox)', totalAmount]);
        wsResumen.getCell('A1').font = { bold: true, size: 13 };
        for (let r = 2; r <= 8; r++) {
            wsResumen.getCell(`A${r}`).font = { bold: true };
        }
        wsResumen.getCell('B7').numFmt = '#,##0';
        wsResumen.getCell('B8').numFmt = '#,##0.00';
        const ws = wb.addWorksheet('Productos');
        ws.views = [{ state: 'frozen', ySplit: 1 }];
        ws.columns = [
            { header: 'Código', key: 'codigo', width: 22 },
            { header: 'Producto', key: 'producto', width: 42 },
            { header: 'Cantidad vendida', key: 'cantidad', width: 18 },
            { header: 'Precio unitario promedio', key: 'precio', width: 24 }
        ];
        ws.getRow(1).font = { bold: true };
        productRows.forEach((row) => ws.addRow(row));
        for (let i = 2; i <= ws.rowCount; i++) {
            ws.getCell(`C${i}`).numFmt = '#,##0';
            ws.getCell(`D${i}`).numFmt = '#,##0.00';
        }
        const buf = yield wb.xlsx.writeBuffer();
        const filename = `reporte_ventas_tiendanube_${from}_a_${to}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(Buffer.from(buf));
    }
    catch (error) {
        console.error('exportTiendaNubeSalesReportXlsx:', error);
        res.status(500).json({ message: 'Error generando reporte de ventas Tienda Nube', error: error.message });
    }
});
exports.exportTiendaNubeSalesReportXlsx = exportTiendaNubeSalesReportXlsx;
