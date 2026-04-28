"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.exportCustomerDetailXlsx = exports.exportCustomerFinancialSummaryXlsx = exports.getCustomerFinancialSummary = exports.clearDispatchedPendingsForCustomer = exports.assignCustomerSellersFromResumen = exports.exportSaldosPendientesMultimediasXlsx = exports.exportSaldosPendientesDetalleXlsx = exports.exportSaldosPendientesCsv = exports.getCarteraTotals = exports.getSaldosPendientes = exports.bulkUpdateCuit = exports.importCustomers = exports.deleteCustomer = exports.attachUserToCustomer = exports.updateCustomer = exports.createCustomer = exports.exportCustomersBySheetsXlsx = exports.exportCustomersIndividualXlsx = exports.getCustomers = void 0;
const XLSX = __importStar(require("xlsx"));
const exceljs_1 = __importDefault(require("exceljs"));
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
const multimediaHistorialExcel_1 = require("../utils/multimediaHistorialExcel");
function toCustomer(row, transportes) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
    return {
        id: row.id,
        sellerId: (_a = row.seller_id) !== null && _a !== void 0 ? _a : '',
        userId: (_b = row.user_id) !== null && _b !== void 0 ? _b : undefined,
        name: (_c = row.name) !== null && _c !== void 0 ? _c : '',
        businessName: (_d = row.business_name) !== null && _d !== void 0 ? _d : '',
        email: (_e = row.email) !== null && _e !== void 0 ? _e : '',
        address: (_f = row.address) !== null && _f !== void 0 ? _f : '',
        city: (_g = row.city) !== null && _g !== void 0 ? _g : '',
        cuit: (_h = row.cuit) !== null && _h !== void 0 ? _h : undefined,
        phone: (_j = row.phone) !== null && _j !== void 0 ? _j : undefined,
        transportNumber: (_k = row.transport_number) !== null && _k !== void 0 ? _k : undefined,
        remitoNumber: (_l = row.remito_number) !== null && _l !== void 0 ? _l : undefined,
        saleCondition: (_m = row.sale_condition) !== null && _m !== void 0 ? _m : undefined,
        condicionIva: (_o = row.condicion_iva) !== null && _o !== void 0 ? _o : undefined,
        priceListId: (_p = row.price_list_id) !== null && _p !== void 0 ? _p : undefined,
        legacyCode: (_q = row.legacy_code) !== null && _q !== void 0 ? _q : undefined,
        accountZone: (_r = row.account_zone) !== null && _r !== void 0 ? _r : undefined,
        accountSellerLabel: (_s = row.account_seller_label) !== null && _s !== void 0 ? _s : undefined,
        transportes: transportes !== null && transportes !== void 0 ? transportes : []
    };
}
/** Listar todos los clientes (camelCase para el frontend) con transportes asignados. */
const getCustomers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const authUser = req.user;
        const sellerFilter = (authUser === null || authUser === void 0 ? void 0 : authUser.role) === 'SELLER' ? ' WHERE seller_id = ?' : '';
        const params = (authUser === null || authUser === void 0 ? void 0 : authUser.role) === 'SELLER' ? [authUser.id] : [];
        const rows = yield (0, db_1.query)(`SELECT id, seller_id, user_id, name, business_name, email, address, city, cuit, phone, transport_number, remito_number, sale_condition, condicion_iva, price_list_id,
              legacy_code, account_zone, account_seller_label
       FROM customers${sellerFilter} ORDER BY business_name ASC, name ASC`, params);
        const customers = (rows || []).map((r) => toCustomer(r));
        const ids = customers.map((c) => c.id);
        if (ids.length === 0)
            return res.json(customers);
        const placeholders = ids.map(() => '?').join(',');
        const links = yield (0, db_1.query)(`SELECT ct.customer_id AS customerId, t.id AS transporteId, t.name AS transporteName, t.address AS transporteAddress
       FROM customer_transportes ct
       JOIN transportes t ON t.id = ct.transporte_id
       WHERE ct.customer_id IN (${placeholders})
       ORDER BY t.name ASC`, ids);
        const transportesByCustomer = {};
        for (const c of customers)
            transportesByCustomer[c.id] = [];
        for (const link of (links || [])) {
            const custId = link.customerId;
            if (transportesByCustomer[custId])
                transportesByCustomer[custId].push({ id: link.transporteId, name: (_a = link.transporteName) !== null && _a !== void 0 ? _a : link.transporteId, address: (_b = link.transporteAddress) !== null && _b !== void 0 ? _b : undefined });
        }
        const result = customers.map((c) => { var _a; return (Object.assign(Object.assign({}, c), { transportes: (_a = transportesByCustomer[c.id]) !== null && _a !== void 0 ? _a : [] })); });
        res.json(result);
    }
    catch (error) {
        console.error('getCustomers:', error);
        res.status(500).json({ message: 'Error listando clientes' });
    }
});
exports.getCustomers = getCustomers;
/** Exportar clientes individuales (1 fila por cliente) en Excel (.xlsx). */
const exportCustomersIndividualXlsx = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
    try {
        const authUser = req.user;
        const sellerFilter = (authUser === null || authUser === void 0 ? void 0 : authUser.role) === 'SELLER' ? ' WHERE c.seller_id = ?' : '';
        const params = (authUser === null || authUser === void 0 ? void 0 : authUser.role) === 'SELLER' ? [authUser.id] : [];
        const rows = yield (0, db_1.query)(`SELECT
         c.id,
         c.legacy_code,
         c.business_name,
         c.name,
         c.email,
         c.phone,
         c.cuit,
         c.city,
         c.address,
         c.sale_condition,
         c.condicion_iva,
         c.transport_number,
         c.remito_number,
         c.account_zone,
         c.account_seller_label,
         c.seller_id,
         u.name AS seller_name
       FROM customers c
       LEFT JOIN users u ON u.id = c.seller_id
       ${sellerFilter}
       ORDER BY c.business_name ASC, c.name ASC`, params);
        const workbook = new exceljs_1.default.Workbook();
        workbook.creator = 'LupoHub';
        workbook.created = new Date();
        const ws = workbook.addWorksheet('Clientes');
        ws.columns = [
            { header: 'ID', key: 'id', width: 38 },
            { header: 'Código legacy', key: 'legacy_code', width: 16 },
            { header: 'Razón social', key: 'business_name', width: 34 },
            { header: 'Contacto', key: 'name', width: 28 },
            { header: 'Email', key: 'email', width: 32 },
            { header: 'Teléfono', key: 'phone', width: 18 },
            { header: 'CUIT', key: 'cuit', width: 16 },
            { header: 'Ciudad', key: 'city', width: 20 },
            { header: 'Dirección', key: 'address', width: 32 },
            { header: 'Condición venta', key: 'sale_condition', width: 20 },
            { header: 'Condición IVA', key: 'condicion_iva', width: 20 },
            { header: 'N° transporte', key: 'transport_number', width: 16 },
            { header: 'N° remito', key: 'remito_number', width: 14 },
            { header: 'Zona', key: 'account_zone', width: 18 },
            { header: 'Vendedor habitual', key: 'account_seller_label', width: 28 },
            { header: 'Seller ID', key: 'seller_id', width: 38 },
            { header: 'Seller name', key: 'seller_name', width: 24 }
        ];
        ws.getRow(1).font = { bold: true };
        ws.views = [{ state: 'frozen', ySplit: 1 }];
        for (const r of rows) {
            ws.addRow({
                id: (_a = r.id) !== null && _a !== void 0 ? _a : '',
                legacy_code: (_b = r.legacy_code) !== null && _b !== void 0 ? _b : '',
                business_name: (_c = r.business_name) !== null && _c !== void 0 ? _c : '',
                name: (_d = r.name) !== null && _d !== void 0 ? _d : '',
                email: (_e = r.email) !== null && _e !== void 0 ? _e : '',
                phone: (_f = r.phone) !== null && _f !== void 0 ? _f : '',
                cuit: (_g = r.cuit) !== null && _g !== void 0 ? _g : '',
                city: (_h = r.city) !== null && _h !== void 0 ? _h : '',
                address: (_j = r.address) !== null && _j !== void 0 ? _j : '',
                sale_condition: (_k = r.sale_condition) !== null && _k !== void 0 ? _k : '',
                condicion_iva: (_l = r.condicion_iva) !== null && _l !== void 0 ? _l : '',
                transport_number: (_m = r.transport_number) !== null && _m !== void 0 ? _m : '',
                remito_number: (_o = r.remito_number) !== null && _o !== void 0 ? _o : '',
                account_zone: (_p = r.account_zone) !== null && _p !== void 0 ? _p : '',
                account_seller_label: (_q = r.account_seller_label) !== null && _q !== void 0 ? _q : '',
                seller_id: (_r = r.seller_id) !== null && _r !== void 0 ? _r : '',
                seller_name: (_s = r.seller_name) !== null && _s !== void 0 ? _s : ''
            });
        }
        const out = yield workbook.xlsx.writeBuffer();
        const buf = Buffer.from(out instanceof ArrayBuffer ? new Uint8Array(out) : new Uint8Array(out));
        const filename = `clientes_individuales_${new Date().toISOString().slice(0, 10)}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(buf);
    }
    catch (error) {
        console.error('exportCustomersIndividualXlsx:', error);
        return res.status(500).json({ message: 'Error exportando clientes individuales' });
    }
});
exports.exportCustomersIndividualXlsx = exportCustomersIndividualXlsx;
/** Exportar clientes en un Excel con una hoja por cliente. */
const exportCustomersBySheetsXlsx = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9;
    try {
        const authUser = req.user;
        const requestedIds = Array.isArray((_a = req.body) === null || _a === void 0 ? void 0 : _a.customerIds)
            ? req.body.customerIds
                .filter((x) => typeof x === 'string' && x.trim().length > 0)
                .map((x) => String(x).trim())
            : [];
        const whereParts = [];
        const params = [];
        if ((authUser === null || authUser === void 0 ? void 0 : authUser.role) === 'SELLER') {
            whereParts.push('c.seller_id = ?');
            params.push(authUser.id);
        }
        if (requestedIds.length > 0) {
            whereParts.push(`c.id IN (${requestedIds.map(() => '?').join(',')})`);
            params.push(...requestedIds);
        }
        const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
        const rows = yield (0, db_1.query)(`SELECT
         c.id,
         c.legacy_code,
         c.business_name,
         c.name,
         c.email,
         c.phone,
         c.cuit,
         c.city,
         c.address,
         c.sale_condition,
         c.condicion_iva,
         c.transport_number,
         c.remito_number,
         c.account_zone,
         c.account_seller_label,
         c.seller_id,
         u.name AS seller_name,
         GROUP_CONCAT(DISTINCT t.name ORDER BY t.name SEPARATOR ', ') AS transportes
       FROM customers c
       LEFT JOIN users u ON u.id = c.seller_id
       LEFT JOIN customer_transportes ct ON ct.customer_id = c.id
       LEFT JOIN transportes t ON t.id = ct.transporte_id
       ${whereSql}
       GROUP BY
         c.id, c.legacy_code, c.business_name, c.name, c.email, c.phone, c.cuit, c.city, c.address,
         c.sale_condition, c.condicion_iva, c.transport_number, c.remito_number,
         c.account_zone, c.account_seller_label, c.seller_id, u.name
       ORDER BY c.business_name ASC, c.name ASC`, params);
        if (!rows.length) {
            return res.status(404).json({ message: 'No hay clientes para exportar' });
        }
        const workbook = new exceljs_1.default.Workbook();
        workbook.creator = 'LupoHub';
        workbook.created = new Date();
        const wsSummary = workbook.addWorksheet('Resumen');
        wsSummary.columns = [
            { header: 'Cliente', key: 'cliente', width: 40 },
            { header: 'Contacto', key: 'contacto', width: 28 },
            { header: 'CUIT', key: 'cuit', width: 16 },
            { header: 'Email', key: 'email', width: 30 },
            { header: 'Vendedor', key: 'vendedor', width: 24 }
        ];
        wsSummary.getRow(1).font = { bold: true };
        wsSummary.views = [{ state: 'frozen', ySplit: 1 }];
        const usedNames = new Set(['Resumen']);
        const uniqueSheetName = (raw, fallback) => {
            const baseRaw = (raw || fallback || 'Cliente').replace(/[:\\/?*\[\]]/g, ' ').trim();
            const base = (baseRaw || 'Cliente').slice(0, 31);
            let name = base;
            let i = 2;
            while (usedNames.has(name)) {
                const suffix = ` (${i})`;
                name = base.slice(0, Math.max(1, 31 - suffix.length)) + suffix;
                i++;
            }
            usedNames.add(name);
            return name;
        };
        for (const r of rows) {
            const customerName = String((_c = (_b = r.business_name) !== null && _b !== void 0 ? _b : r.name) !== null && _c !== void 0 ? _c : 'Cliente');
            wsSummary.addRow({
                cliente: customerName,
                contacto: (_d = r.name) !== null && _d !== void 0 ? _d : '',
                cuit: (_e = r.cuit) !== null && _e !== void 0 ? _e : '',
                email: (_f = r.email) !== null && _f !== void 0 ? _f : '',
                vendedor: (_h = (_g = r.seller_name) !== null && _g !== void 0 ? _g : r.seller_id) !== null && _h !== void 0 ? _h : ''
            });
            const ws = workbook.addWorksheet(uniqueSheetName(customerName, String(r.id)));
            ws.columns = [
                { header: 'Campo', key: 'campo', width: 24 },
                { header: 'Valor', key: 'valor', width: 58 }
            ];
            ws.getRow(1).font = { bold: true };
            ws.views = [{ state: 'frozen', ySplit: 1 }];
            ws.addRows([
                { campo: 'ID', valor: (_j = r.id) !== null && _j !== void 0 ? _j : '' },
                { campo: 'Código legacy', valor: (_k = r.legacy_code) !== null && _k !== void 0 ? _k : '' },
                { campo: 'Razón social', valor: (_l = r.business_name) !== null && _l !== void 0 ? _l : '' },
                { campo: 'Contacto', valor: (_m = r.name) !== null && _m !== void 0 ? _m : '' },
                { campo: 'Email', valor: (_o = r.email) !== null && _o !== void 0 ? _o : '' },
                { campo: 'Teléfono', valor: (_p = r.phone) !== null && _p !== void 0 ? _p : '' },
                { campo: 'CUIT', valor: (_q = r.cuit) !== null && _q !== void 0 ? _q : '' },
                { campo: 'Ciudad', valor: (_r = r.city) !== null && _r !== void 0 ? _r : '' },
                { campo: 'Dirección', valor: (_s = r.address) !== null && _s !== void 0 ? _s : '' },
                { campo: 'Condición de venta', valor: (_t = r.sale_condition) !== null && _t !== void 0 ? _t : '' },
                { campo: 'Condición IVA', valor: (_u = r.condicion_iva) !== null && _u !== void 0 ? _u : '' },
                { campo: 'N° transporte', valor: (_v = r.transport_number) !== null && _v !== void 0 ? _v : '' },
                { campo: 'N° remito', valor: (_w = r.remito_number) !== null && _w !== void 0 ? _w : '' },
                { campo: 'Transportes', valor: (_x = r.transportes) !== null && _x !== void 0 ? _x : '' },
                { campo: 'Zona', valor: (_y = r.account_zone) !== null && _y !== void 0 ? _y : '' },
                { campo: 'Vendedor habitual', valor: (_z = r.account_seller_label) !== null && _z !== void 0 ? _z : '' },
                { campo: 'Seller ID', valor: (_0 = r.seller_id) !== null && _0 !== void 0 ? _0 : '' },
                { campo: 'Seller Name', valor: (_1 = r.seller_name) !== null && _1 !== void 0 ? _1 : '' }
            ]);
            const customerOrders = yield (0, db_1.query)(`SELECT id, date, status, total, payment_status
         FROM orders
         WHERE customer_id = ?
         ORDER BY date DESC, id DESC`, [r.id]);
            const customerBilling = yield (0, db_1.query)(`SELECT *
         FROM (
           SELECT
             i.created_at AS fecha,
             'FACTURA' AS tipo,
             CONCAT(
               CASE WHEN i.cbte_tipo = 1 THEN 'A ' WHEN i.cbte_tipo = 6 THEN 'B ' ELSE '' END,
               LPAD(COALESCE(i.punto_venta, 0), 5, '0'),
               '-',
               LPAD(COALESCE(i.cbte_desde, 0), 8, '0')
             ) AS comprobante,
             o.id AS order_id,
             ROUND(COALESCE(o.total, 0) * 1.21, 2) AS importe
           FROM invoices i
           JOIN orders o ON o.id = i.order_id
           WHERE o.customer_id = ?

           UNION ALL

           SELECT
             cn.created_at AS fecha,
             'NC' AS tipo,
             CONCAT(
               CASE WHEN cn.cbte_tipo = 3 THEN 'NC A ' WHEN cn.cbte_tipo = 8 THEN 'NC B ' ELSE 'NC ' END,
               LPAD(COALESCE(cn.punto_venta, 0), 5, '0'),
               '-',
               LPAD(COALESCE(cn.cbte_desde, 0), 8, '0')
             ) AS comprobante,
             cn.order_id AS order_id,
             ROUND(COALESCE(cn.amount_credited, 0) * 1.21, 2) AS importe
           FROM credit_notes cn
           JOIN orders o ON o.id = cn.order_id
           WHERE o.customer_id = ?
         ) b
         ORDER BY b.fecha DESC`, [r.id, r.id]);
            const customerPayments = yield (0, db_1.query)(`SELECT date, receipt_number, amount, notes
         FROM payments
         WHERE customer_id = ?
         ORDER BY date DESC, created_at DESC`, [r.id]);
            let rowCursor = ws.rowCount + 2;
            ws.getCell(`A${rowCursor}`).value = 'PEDIDOS';
            ws.getCell(`A${rowCursor}`).font = { bold: true };
            rowCursor += 1;
            ws.getCell(`A${rowCursor}`).value = 'ID';
            ws.getCell(`B${rowCursor}`).value = 'Fecha';
            ws.getCell(`C${rowCursor}`).value = 'Estado';
            ws.getCell(`D${rowCursor}`).value = 'Cobro';
            ws.getCell(`E${rowCursor}`).value = 'Total';
            ws.getRow(rowCursor).font = { bold: true };
            rowCursor += 1;
            for (const o of customerOrders) {
                ws.getCell(`A${rowCursor}`).value = (_2 = o.id) !== null && _2 !== void 0 ? _2 : '';
                ws.getCell(`B${rowCursor}`).value = o.date ? new Date(o.date) : null;
                ws.getCell(`C${rowCursor}`).value = (_3 = o.status) !== null && _3 !== void 0 ? _3 : '';
                ws.getCell(`D${rowCursor}`).value = (_4 = o.payment_status) !== null && _4 !== void 0 ? _4 : '';
                ws.getCell(`E${rowCursor}`).value = Number(o.total || 0);
                rowCursor += 1;
            }
            rowCursor += 1;
            ws.getCell(`A${rowCursor}`).value = 'FACTURAS / NC';
            ws.getCell(`A${rowCursor}`).font = { bold: true };
            rowCursor += 1;
            ws.getCell(`A${rowCursor}`).value = 'Fecha';
            ws.getCell(`B${rowCursor}`).value = 'Tipo';
            ws.getCell(`C${rowCursor}`).value = 'Comprobante';
            ws.getCell(`D${rowCursor}`).value = 'Pedido';
            ws.getCell(`E${rowCursor}`).value = 'Importe';
            ws.getRow(rowCursor).font = { bold: true };
            rowCursor += 1;
            for (const b of customerBilling) {
                ws.getCell(`A${rowCursor}`).value = b.fecha ? new Date(b.fecha) : null;
                ws.getCell(`B${rowCursor}`).value = (_5 = b.tipo) !== null && _5 !== void 0 ? _5 : '';
                ws.getCell(`C${rowCursor}`).value = (_6 = b.comprobante) !== null && _6 !== void 0 ? _6 : '';
                ws.getCell(`D${rowCursor}`).value = (_7 = b.order_id) !== null && _7 !== void 0 ? _7 : '';
                ws.getCell(`E${rowCursor}`).value = Number(b.importe || 0);
                rowCursor += 1;
            }
            rowCursor += 1;
            ws.getCell(`A${rowCursor}`).value = 'RECIBOS';
            ws.getCell(`A${rowCursor}`).font = { bold: true };
            rowCursor += 1;
            ws.getCell(`A${rowCursor}`).value = 'Fecha';
            ws.getCell(`B${rowCursor}`).value = 'Recibo';
            ws.getCell(`C${rowCursor}`).value = 'Importe';
            ws.getCell(`D${rowCursor}`).value = 'Observaciones';
            ws.getRow(rowCursor).font = { bold: true };
            rowCursor += 1;
            for (const p of customerPayments) {
                ws.getCell(`A${rowCursor}`).value = p.date ? new Date(p.date) : null;
                ws.getCell(`B${rowCursor}`).value = (_8 = p.receipt_number) !== null && _8 !== void 0 ? _8 : '';
                ws.getCell(`C${rowCursor}`).value = Number(p.amount || 0);
                ws.getCell(`D${rowCursor}`).value = (_9 = p.notes) !== null && _9 !== void 0 ? _9 : '';
                rowCursor += 1;
            }
            ws.getColumn('B').numFmt = 'dd/mm/yyyy';
            ws.getColumn('C').numFmt = '#,##0.00';
            ws.getColumn('E').numFmt = '#,##0.00';
        }
        const out = yield workbook.xlsx.writeBuffer();
        const buf = Buffer.from(out instanceof ArrayBuffer ? new Uint8Array(out) : new Uint8Array(out));
        const filename = `clientes_por_hoja_${new Date().toISOString().slice(0, 10)}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(buf);
    }
    catch (error) {
        console.error('exportCustomersBySheetsXlsx:', error);
        return res.status(500).json({ message: 'Error exportando clientes por hoja' });
    }
});
exports.exportCustomersBySheetsXlsx = exportCustomersBySheetsXlsx;
/** Crear cliente. */
const createCustomer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
    try {
        const body = req.body;
        const name = ((_a = body.name) !== null && _a !== void 0 ? _a : '').toString().trim();
        const businessName = ((_b = body.businessName) !== null && _b !== void 0 ? _b : '').toString().trim();
        const email = ((_c = body.email) !== null && _c !== void 0 ? _c : '').toString().trim();
        if (!businessName && !name) {
            return res.status(400).json({ message: 'Razón social o nombre de contacto es requerido' });
        }
        if (!email) {
            return res.status(400).json({ message: 'El email es requerido' });
        }
        const id = body.id && body.id.trim() ? body.id.trim() : (0, uuid_1.v4)();
        const sellerId = ((_d = body.sellerId) === null || _d === void 0 ? void 0 : _d.trim()) || null;
        const address = ((_e = body.address) !== null && _e !== void 0 ? _e : '').toString().trim() || null;
        const city = ((_f = body.city) !== null && _f !== void 0 ? _f : '').toString().trim() || null;
        const cuit = ((_g = body.cuit) !== null && _g !== void 0 ? _g : '').toString().trim() || null;
        const phone = ((_h = body.phone) !== null && _h !== void 0 ? _h : '').toString().trim() || null;
        const transportNumber = ((_j = body.transportNumber) !== null && _j !== void 0 ? _j : '').toString().trim() || null;
        const remitoNumber = ((_k = body.remitoNumber) !== null && _k !== void 0 ? _k : '').toString().trim() || null;
        const saleCondition = ((_l = body.saleCondition) !== null && _l !== void 0 ? _l : '').toString().trim() || null;
        const condicionIva = ((_m = body.condicionIva) !== null && _m !== void 0 ? _m : '').toString().trim() || null;
        const priceListId = ((_o = body.priceListId) === null || _o === void 0 ? void 0 : _o.trim()) || null;
        const legacyCode = ((_p = body.legacyCode) !== null && _p !== void 0 ? _p : '').toString().trim() || null;
        const accountZone = ((_q = body.accountZone) !== null && _q !== void 0 ? _q : '').toString().trim() || null;
        const accountSellerLabel = ((_r = body.accountSellerLabel) !== null && _r !== void 0 ? _r : '').toString().trim() || null;
        // Guardar nombre de contacto y razón social en columnas separadas:
        // - Si solo se carga razón social, "name" queda NULL y "business_name" tiene el valor.
        // - Si solo se carga nombre de contacto, "business_name" toma ese valor.
        const sqlName = name || null;
        const sqlBusinessName = businessName || name || null;
        yield (0, db_1.execute)(`INSERT INTO customers (id, seller_id, name, business_name, email, address, city, cuit, phone, transport_number, remito_number, sale_condition, condicion_iva, price_list_id, legacy_code, account_zone, account_seller_label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, sellerId, sqlName, sqlBusinessName, email, address, city, cuit, phone, transportNumber, remitoNumber, saleCondition, condicionIva, priceListId, legacyCode, accountZone, accountSellerLabel]);
        const created = yield (0, db_1.get)(`SELECT id, seller_id, user_id, name, business_name, email, address, city, cuit, phone, transport_number, remito_number, sale_condition, condicion_iva, price_list_id, legacy_code, account_zone, account_seller_label FROM customers WHERE id = ?`, [id]);
        const transporteIds = Array.isArray(body.transporteIds) ? body.transporteIds.filter((x) => x && typeof x === 'string') : [];
        for (const tid of transporteIds) {
            yield (0, db_1.execute)(`INSERT IGNORE INTO customer_transportes (customer_id, transporte_id) VALUES (?, ?)`, [id, tid]);
        }
        const links = yield (0, db_1.query)(`SELECT t.id AS transporteId, t.name AS transporteName, t.address AS transporteAddress FROM customer_transportes ct JOIN transportes t ON t.id = ct.transporte_id WHERE ct.customer_id = ? ORDER BY t.name`, [id]);
        const transportes = (links || []).map((l) => { var _a, _b; return ({ id: l.transporteId, name: (_a = l.transporteName) !== null && _a !== void 0 ? _a : l.transporteId, address: (_b = l.transporteAddress) !== null && _b !== void 0 ? _b : undefined }); });
        res.status(201).json(toCustomer(created, transportes));
    }
    catch (error) {
        console.error('createCustomer:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'Ya existe un cliente con ese ID' });
        }
        res.status(500).json({ message: 'Error creando cliente' });
    }
});
exports.createCustomer = createCustomer;
/** Actualizar cliente (ej. vendedor, razón social, price_list_id, etc.). */
const updateCustomer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    try {
        const { id } = req.params;
        const body = req.body;
        const existing = yield (0, db_1.get)('SELECT id FROM customers WHERE id = ?', [id]);
        if (!existing)
            return res.status(404).json({ message: 'Cliente no encontrado' });
        const updates = [];
        const params = [];
        if (body.name !== undefined) {
            updates.push('name = ?');
            params.push(body.name.trim());
        }
        if (body.businessName !== undefined) {
            updates.push('business_name = ?');
            params.push(((_a = body.businessName) === null || _a === void 0 ? void 0 : _a.trim()) || null);
        }
        if (body.email !== undefined) {
            updates.push('email = ?');
            params.push(((_b = body.email) === null || _b === void 0 ? void 0 : _b.trim()) || null);
        }
        if (body.address !== undefined) {
            updates.push('address = ?');
            params.push(((_c = body.address) === null || _c === void 0 ? void 0 : _c.trim()) || null);
        }
        if (body.city !== undefined) {
            updates.push('city = ?');
            params.push(((_d = body.city) === null || _d === void 0 ? void 0 : _d.trim()) || null);
        }
        if (body.cuit !== undefined) {
            updates.push('cuit = ?');
            params.push(((_e = body.cuit) === null || _e === void 0 ? void 0 : _e.trim()) || null);
        }
        if (body.phone !== undefined) {
            updates.push('phone = ?');
            params.push(((_f = body.phone) === null || _f === void 0 ? void 0 : _f.trim()) || null);
        }
        if (body.transportNumber !== undefined) {
            updates.push('transport_number = ?');
            params.push(((_g = body.transportNumber) === null || _g === void 0 ? void 0 : _g.trim()) || null);
        }
        if (body.remitoNumber !== undefined) {
            updates.push('remito_number = ?');
            params.push(((_h = body.remitoNumber) === null || _h === void 0 ? void 0 : _h.trim()) || null);
        }
        if (body.saleCondition !== undefined) {
            updates.push('sale_condition = ?');
            params.push(((_j = body.saleCondition) === null || _j === void 0 ? void 0 : _j.trim()) || null);
        }
        if (body.condicionIva !== undefined) {
            updates.push('condicion_iva = ?');
            params.push(((_k = body.condicionIva) === null || _k === void 0 ? void 0 : _k.trim()) || null);
        }
        if (body.sellerId !== undefined) {
            updates.push('seller_id = ?');
            params.push(((_l = body.sellerId) === null || _l === void 0 ? void 0 : _l.trim()) || null);
        }
        if (body.priceListId !== undefined) {
            updates.push('price_list_id = ?');
            params.push(body.priceListId && body.priceListId.trim() ? body.priceListId.trim() : null);
        }
        if (body.legacyCode !== undefined) {
            updates.push('legacy_code = ?');
            params.push(((_m = body.legacyCode) === null || _m === void 0 ? void 0 : _m.trim()) || null);
        }
        if (body.accountZone !== undefined) {
            updates.push('account_zone = ?');
            params.push(((_o = body.accountZone) === null || _o === void 0 ? void 0 : _o.trim()) || null);
        }
        if (body.accountSellerLabel !== undefined) {
            updates.push('account_seller_label = ?');
            params.push(((_p = body.accountSellerLabel) === null || _p === void 0 ? void 0 : _p.trim()) || null);
        }
        if (updates.length > 0) {
            params.push(id);
            yield (0, db_1.execute)(`UPDATE customers SET ${updates.join(', ')} WHERE id = ?`, params);
        }
        if (body.transporteIds !== undefined) {
            yield (0, db_1.execute)(`DELETE FROM customer_transportes WHERE customer_id = ?`, [id]);
            const transporteIds = Array.isArray(body.transporteIds) ? body.transporteIds.filter((x) => x && typeof x === 'string') : [];
            for (const tid of transporteIds) {
                yield (0, db_1.execute)(`INSERT IGNORE INTO customer_transportes (customer_id, transporte_id) VALUES (?, ?)`, [id, tid]);
            }
        }
        const updated = yield (0, db_1.get)(`SELECT id, seller_id, user_id, name, business_name, email, address, city, cuit, phone, transport_number, remito_number, sale_condition, condicion_iva, price_list_id, legacy_code, account_zone, account_seller_label FROM customers WHERE id = ?`, [id]);
        const links = yield (0, db_1.query)(`SELECT t.id AS transporteId, t.name AS transporteName, t.address AS transporteAddress FROM customer_transportes ct JOIN transportes t ON t.id = ct.transporte_id WHERE ct.customer_id = ? ORDER BY t.name`, [id]);
        const transportes = (links || []).map((l) => { var _a, _b; return ({ id: l.transporteId, name: (_a = l.transporteName) !== null && _a !== void 0 ? _a : l.transporteId, address: (_b = l.transporteAddress) !== null && _b !== void 0 ? _b : undefined }); });
        res.json(toCustomer(updated, transportes));
    }
    catch (error) {
        console.error('updateCustomer:', error);
        res.status(500).json({ message: 'Error actualizando cliente' });
    }
});
exports.updateCustomer = updateCustomer;
/** Crear o vincular usuario de acceso directo a un cliente (rol CUSTOMER). Solo ADMIN. */
const attachUserToCustomer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const authUser = req.user;
        if (!authUser || authUser.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden asignar usuarios a clientes' });
        }
        const { id } = req.params;
        if (!id)
            return res.status(400).json({ message: 'ID de cliente requerido' });
        const body = req.body;
        const name = ((_a = body.name) !== null && _a !== void 0 ? _a : '').toString().trim();
        const email = ((_b = body.email) !== null && _b !== void 0 ? _b : '').toString().trim();
        const password = ((_c = body.password) !== null && _c !== void 0 ? _c : '').toString();
        if (!email || !password) {
            return res.status(400).json({ message: 'Email y contraseña son requeridos para crear el usuario del cliente' });
        }
        const existingCustomer = yield (0, db_1.get)('SELECT id, user_id, business_name, name, email FROM customers WHERE id = ?', [id]);
        if (!existingCustomer) {
            return res.status(404).json({ message: 'Cliente no encontrado' });
        }
        // Si ya tiene user_id asociado, no creamos otro usuario
        if (existingCustomer.user_id) {
            return res.status(400).json({ message: 'Este cliente ya tiene un usuario asignado' });
        }
        // ¿Ya existe un usuario con ese email?
        const existingUser = yield (0, db_1.get)('SELECT id, name, email, role FROM users WHERE email = ?', [email]);
        let userId;
        if (existingUser) {
            // Solo permitimos vincular usuarios de rol CUSTOMER
            if (existingUser.role !== 'CUSTOMER') {
                return res.status(400).json({ message: 'Ya existe un usuario con ese email y no es de tipo CLIENTE' });
            }
            userId = existingUser.id;
        }
        else {
            // Crear usuario nuevo con rol CUSTOMER
            userId = (0, uuid_1.v4)();
            const displayName = name ||
                existingCustomer.business_name ||
                existingCustomer.name ||
                email;
            yield (0, db_1.execute)('INSERT INTO users (id, name, email, password, role, commission_percentage) VALUES (?, ?, ?, ?, ?, ?)', [userId, displayName, email, password, 'CUSTOMER', 0]);
        }
        // Vincular usuario al cliente
        yield (0, db_1.execute)('UPDATE customers SET user_id = ? WHERE id = ?', [userId, id]);
        const updated = yield (0, db_1.get)(`SELECT id, seller_id, user_id, name, business_name, email, address, city, cuit, phone, transport_number, remito_number, sale_condition, condicion_iva, price_list_id, legacy_code, account_zone, account_seller_label FROM customers WHERE id = ?`, [id]);
        const links = yield (0, db_1.query)(`SELECT t.id AS transporteId, t.name AS transporteName, t.address AS transporteAddress FROM customer_transportes ct JOIN transportes t ON t.id = ct.transporte_id WHERE ct.customer_id = ? ORDER BY t.name`, [id]);
        const transportes = (links || []).map((l) => {
            var _a, _b;
            return ({
                id: l.transporteId,
                name: (_a = l.transporteName) !== null && _a !== void 0 ? _a : l.transporteId,
                address: (_b = l.transporteAddress) !== null && _b !== void 0 ? _b : undefined
            });
        });
        return res.status(200).json(toCustomer(updated, transportes));
    }
    catch (error) {
        console.error('attachUserToCustomer:', error);
        res.status(500).json({ message: 'Error asignando usuario al cliente', detail: error === null || error === void 0 ? void 0 : error.message });
    }
});
exports.attachUserToCustomer = attachUserToCustomer;
/** Eliminar cliente. No se permite si tiene pedidos asociados. */
const deleteCustomer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const existing = yield (0, db_1.get)('SELECT id FROM customers WHERE id = ?', [id]);
        if (!existing)
            return res.status(404).json({ message: 'Cliente no encontrado' });
        const orderRow = yield (0, db_1.get)('SELECT 1 FROM orders WHERE customer_id = ? LIMIT 1', [id]);
        if (orderRow) {
            return res.status(400).json({
                message: 'No se puede eliminar el cliente porque tiene pedidos asociados. Eliminá o reassigná los pedidos primero.'
            });
        }
        yield (0, db_1.execute)('DELETE FROM customers WHERE id = ?', [id]);
        res.status(204).send();
    }
    catch (error) {
        console.error('deleteCustomer:', error);
        res.status(500).json({ message: 'Error eliminando cliente' });
    }
});
exports.deleteCustomer = deleteCustomer;
/** Importar clientes en lote. Se exige razón social y CUIT. No duplica por CUIT ni por email. */
const importCustomers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    try {
        const body = req.body;
        const rows = Array.isArray(body.customers) ? body.customers : [];
        const sellerId = ((_a = body.sellerId) === null || _a === void 0 ? void 0 : _a.trim()) || null;
        let created = 0;
        let skipped = 0;
        const errors = [];
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const name = ((_b = r.name) !== null && _b !== void 0 ? _b : '').toString().trim();
            const businessName = ((_c = r.businessName) !== null && _c !== void 0 ? _c : '').toString().trim();
            let email = ((_d = r.email) !== null && _d !== void 0 ? _d : '').toString().trim();
            const address = ((_e = r.address) !== null && _e !== void 0 ? _e : '').toString().trim() || null;
            const city = ((_f = r.city) !== null && _f !== void 0 ? _f : '').toString().trim() || null;
            const cuit = ((_g = r.cuit) !== null && _g !== void 0 ? _g : '').toString().trim() || null;
            const cuitSolo = (cuit || '').replace(/\D/g, '');
            const phone = ((_h = r.phone) !== null && _h !== void 0 ? _h : '').toString().trim() || null;
            const condicionIva = ((_j = r.condicionIva) !== null && _j !== void 0 ? _j : '').toString().trim() || null;
            const rowNum = i + 1;
            if (!businessName && !name) {
                errors.push({ row: rowNum, message: 'Falta razón social' });
                continue;
            }
            if (!cuit || !cuitSolo) {
                errors.push({ row: rowNum, message: 'Falta CUIT' });
                continue;
            }
            if (!email) {
                email = `importado-${cuitSolo}@sin-email.local`;
            }
            const existingByCuit = cuit ? yield (0, db_1.get)(`SELECT id FROM customers WHERE cuit = ? LIMIT 1`, [cuit]) : null;
            if (existingByCuit) {
                skipped++;
                continue;
            }
            const existingByEmail = yield (0, db_1.get)(`SELECT id FROM customers WHERE email = ? LIMIT 1`, [email]);
            if (existingByEmail) {
                skipped++;
                continue;
            }
            const id = (0, uuid_1.v4)();
            const nameVal = name || businessName;
            const businessNameVal = businessName || name;
            try {
                yield (0, db_1.execute)(`INSERT INTO customers (id, seller_id, name, business_name, email, address, city, cuit, phone, condicion_iva, price_list_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, sellerId, nameVal, businessNameVal, email, address, city, cuit, phone, condicionIva, null]);
                created++;
            }
            catch (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    skipped++;
                }
                else {
                    errors.push({ row: rowNum, email, message: err.message || 'Error al crear' });
                }
            }
        }
        res.json({ created, skipped, errors });
    }
    catch (error) {
        console.error('importCustomers:', error);
        res.status(500).json({ message: 'Error importando clientes' });
    }
});
exports.importCustomers = importCustomers;
/** Actualizar CUIT en lote. Recibe lista con identificador (email o razón social) + CUIT; actualiza solo el campo cuit. */
const bulkUpdateCuit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    try {
        const body = req.body;
        const updates = Array.isArray(body.updates) ? body.updates : [];
        let updated = 0;
        let notFound = 0;
        const errors = [];
        for (let i = 0; i < updates.length; i++) {
            const u = updates[i];
            const cuit = ((_a = u.cuit) !== null && _a !== void 0 ? _a : '').toString().trim().replace(/\D/g, '').slice(0, 11);
            const email = ((_b = u.email) !== null && _b !== void 0 ? _b : '').toString().trim() || null;
            const businessName = ((_c = u.businessName) !== null && _c !== void 0 ? _c : '').toString().trim() || null;
            const newBusinessName = ((_d = u.newBusinessName) !== null && _d !== void 0 ? _d : '').toString().trim() || null;
            const condicionIva = ((_e = u.condicionIva) !== null && _e !== void 0 ? _e : '').toString().trim() || null;
            if (!cuit) {
                errors.push({ row: i + 1, message: 'CUIT vacío' });
                continue;
            }
            if (!email && !businessName) {
                errors.push({ row: i + 1, message: 'Falta email o razón social' });
                continue;
            }
            let customer = null;
            if (email) {
                customer = yield (0, db_1.get)('SELECT id FROM customers WHERE LOWER(TRIM(email)) = LOWER(?) LIMIT 1', [email]);
            }
            if (!customer && businessName) {
                customer = yield (0, db_1.get)('SELECT id, business_name, condicion_iva FROM customers WHERE TRIM(business_name) = ? LIMIT 1', [businessName]);
            }
            if (!customer) {
                notFound++;
                continue;
            }
            const setClauses = ['cuit = ?'];
            const params = [cuit];
            if (newBusinessName) {
                setClauses.push('business_name = ?');
                params.push(newBusinessName);
            }
            if (condicionIva) {
                setClauses.push('condicion_iva = ?');
                params.push(condicionIva);
            }
            params.push(customer.id);
            yield (0, db_1.execute)(`UPDATE customers SET ${setClauses.join(', ')} WHERE id = ?`, params);
            updated++;
        }
        res.json({ updated, notFound, errors });
    }
    catch (error) {
        console.error('bulkUpdateCuit:', error);
        res.status(500).json({ message: 'Error actualizando CUIT en lote' });
    }
});
exports.bulkUpdateCuit = bulkUpdateCuit;
function roleCanViewSaldos(role) {
    return role === 'ADMIN' || role === 'SELLER' || role === 'WAREHOUSE' || role === 'DEPOSITO';
}
/** Saldos: pedidos con cobro pendiente (IVA 21% sobre neto, neto de NC) menos pagos/recibos en `payments`. */
const getSaldosPendientes = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const user = req.user;
    if (!user || !roleCanViewSaldos(user.role)) {
        return res.status(403).json({ message: 'Sin permiso para ver saldos' });
    }
    const sellerFilter = user.role === 'SELLER' ? ' AND c.seller_id = ?' : '';
    const baseParams = user.role === 'SELLER' ? [user.id] : [];
    const paymentsJoin = user.role === 'SELLER'
        ? `LEFT JOIN (
      SELECT p.customer_id, SUM(p.amount) AS total_pagos
      FROM payments p
      INNER JOIN customers c2 ON c2.id = p.customer_id
      WHERE (p.seller_id = ? OR c2.seller_id = ?)
      GROUP BY p.customer_id
    ) pay ON pay.customer_id = t.customerId`
        : `LEFT JOIN (
      SELECT customer_id, SUM(amount) AS total_pagos
      FROM payments
      GROUP BY customer_id
    ) pay ON pay.customer_id = t.customerId`;
    const payParams = user.role === 'SELLER' ? [user.id, user.id] : [];
    const paramsWithNc = [...baseParams, ...payParams];
    const paramsSimple = [...baseParams, ...payParams];
    const mapRows = (rows) => rows.map((r) => {
        var _a, _b, _c, _d, _e;
        return ({
            customerId: r.customerId,
            businessName: (_a = r.businessName) !== null && _a !== void 0 ? _a : '',
            contactName: (_b = r.contactName) !== null && _b !== void 0 ? _b : '',
            cuit: (_c = r.cuit) !== null && _c !== void 0 ? _c : '',
            city: (_d = r.city) !== null && _d !== void 0 ? _d : '',
            email: (_e = r.email) !== null && _e !== void 0 ? _e : '',
            saldoPendiente: Number(r.saldoPendiente) || 0,
            totalCargosPendiente: Number(r.totalCargosPendiente) || 0,
            totalPagos: Number(r.totalPagos) || 0,
            pedidosPendientes: Number(r.pedidosPendientes) || 0
        });
    });
    const sqlWithNc = `
    SELECT
      t.customerId,
      t.businessName,
      t.contactName,
      t.cuit,
      t.city,
      t.email,
      ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) AS saldoPendiente,
      ROUND(t.cargosPendientes, 2) AS totalCargosPendiente,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      t.pedidosPendientes
    FROM (
      SELECT
        c.id AS customerId,
        c.business_name AS businessName,
        c.name AS contactName,
        c.cuit,
        c.city,
        c.email,
        SUM(ROUND(GREATEST(0, o.total - COALESCE(cn.cn_total, 0)) * 1.21, 2)) AS cargosPendientes,
        COUNT(DISTINCT o.id) AS pedidosPendientes
      FROM customers c
      INNER JOIN orders o ON o.customer_id = c.id
      LEFT JOIN (
        SELECT order_id, SUM(amount_credited) AS cn_total
        FROM credit_notes
        GROUP BY order_id
      ) cn ON cn.order_id = o.id
      WHERE o.payment_status = 'pendiente'
        AND o.status NOT IN ('Cancelado', 'Borrador')
        AND (o.archived = 0 OR o.archived IS NULL)
        ${sellerFilter}
      GROUP BY c.id, c.business_name, c.name, c.cuit, c.city, c.email
    ) t
    ${paymentsJoin}
    WHERE ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) > 0.01
    ORDER BY t.businessName ASC, t.contactName ASC
  `;
    const sqlSimple = `
    SELECT
      t.customerId,
      t.businessName,
      t.contactName,
      t.cuit,
      t.city,
      t.email,
      ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) AS saldoPendiente,
      ROUND(t.cargosPendientes, 2) AS totalCargosPendiente,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      t.pedidosPendientes
    FROM (
      SELECT
        c.id AS customerId,
        c.business_name AS businessName,
        c.name AS contactName,
        c.cuit,
        c.city,
        c.email,
        SUM(ROUND(o.total * 1.21, 2)) AS cargosPendientes,
        COUNT(DISTINCT o.id) AS pedidosPendientes
      FROM customers c
      INNER JOIN orders o ON o.customer_id = c.id
      WHERE o.payment_status = 'pendiente'
        AND o.status NOT IN ('Cancelado', 'Borrador')
        AND (o.archived = 0 OR o.archived IS NULL)
        ${sellerFilter}
      GROUP BY c.id, c.business_name, c.name, c.cuit, c.city, c.email
    ) t
    ${paymentsJoin}
    WHERE ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) > 0.01
    ORDER BY t.businessName ASC, t.contactName ASC
  `;
    try {
        const rows = yield (0, db_1.query)(sqlWithNc, paramsWithNc);
        return res.json(mapRows(rows));
    }
    catch (e) {
        console.warn('[saldos] consulta con NC falló, reintentando sin NC:', e === null || e === void 0 ? void 0 : e.message);
        try {
            const rows = yield (0, db_1.query)(sqlSimple, paramsSimple);
            return res.json(mapRows(rows));
        }
        catch (e2) {
            console.error('getSaldosPendientes:', e2);
            return res.status(500).json({ message: 'Error listando saldos pendientes' });
        }
    }
});
exports.getSaldosPendientes = getSaldosPendientes;
/**
 * Cartera unificada por cliente: max(0, C + M − P).
 * C = suma pedidos con cobro pendiente (IVA incl.), M = último saldo cuenta importada (Tango/Multimedias), P = recibos en Facturación.
 * Los pagos se aplican al total (no solo a pedidos LupoHub), para que un recibo descuente también de la cuenta importada.
 */
const getCarteraTotals = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const user = req.user;
    if (!user || !roleCanViewSaldos(user.role)) {
        return res.status(403).json({ message: 'Sin permiso para ver saldos' });
    }
    const sellerFilter = user.role === 'SELLER' ? ' AND c.seller_id = ?' : '';
    const baseParams = user.role === 'SELLER' ? [user.id] : [];
    const paymentsSubquery = user.role === 'SELLER'
        ? `SELECT p.customer_id, SUM(p.amount) AS total_pagos
         FROM payments p
         INNER JOIN customers c2 ON c2.id = p.customer_id
         WHERE (p.seller_id = ? OR c2.seller_id = ?)
         GROUP BY p.customer_id`
        : `SELECT customer_id, SUM(amount) AS total_pagos
         FROM payments
         GROUP BY customer_id`;
    const payParams = user.role === 'SELLER' ? [user.id, user.id] : [];
    const paramsWithNc = [...baseParams, ...payParams];
    const paramsSimple = [...baseParams, ...payParams];
    /** Preferir saldo de la última fila (import PDF escribe ahí SALDO DEL CLIENTE); si NULL, último saldo intermedio. */
    const mmSubquery = `
    SELECT
      agg.customer_id,
      CAST(COALESCE(
        (SELECT CAST(e_lo.saldo AS DECIMAL(16,2))
         FROM customer_multimedia_entries e_lo
         WHERE e_lo.customer_id = agg.customer_id
         ORDER BY e_lo.line_order DESC
         LIMIT 1),
        (SELECT CAST(e2.saldo AS DECIMAL(16,2))
         FROM customer_multimedia_entries e2
         WHERE e2.customer_id = agg.customer_id AND e2.saldo IS NOT NULL
         ORDER BY e2.line_order DESC
         LIMIT 1),
        0
      ) AS DECIMAL(16,2)) AS last_saldo
    FROM (
      SELECT customer_id
      FROM customer_multimedia_entries
      GROUP BY customer_id
    ) agg`;
    const sqlWithNc = `
    SELECT
      c.id AS customerId,
      ROUND(COALESCE(oc.cargos, 0), 2) AS orderCargosPendientes,
      ROUND(COALESCE(mm.last_saldo, 0), 2) AS multimediaSaldo,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      ROUND(GREATEST(0, COALESCE(oc.cargos, 0) + COALESCE(mm.last_saldo, 0) - COALESCE(pay.total_pagos, 0)), 2) AS saldoPendienteUnificado
    FROM customers c
    LEFT JOIN (
      SELECT
        o.customer_id,
        SUM(ROUND(GREATEST(0, o.total - COALESCE(cn.cn_total, 0)) * 1.21, 2)) AS cargos
      FROM orders o
      LEFT JOIN (
        SELECT order_id, SUM(amount_credited) AS cn_total
        FROM credit_notes
        GROUP BY order_id
      ) cn ON cn.order_id = o.id
      WHERE o.payment_status = 'pendiente'
        AND o.status NOT IN ('Cancelado', 'Borrador')
        AND (o.archived = 0 OR o.archived IS NULL)
      GROUP BY o.customer_id
    ) oc ON oc.customer_id = c.id
    LEFT JOIN (${mmSubquery}) mm ON mm.customer_id = c.id
    LEFT JOIN (${paymentsSubquery}) pay ON pay.customer_id = c.id
    WHERE 1=1 ${sellerFilter}
      AND (
        COALESCE(oc.cargos, 0) > 0.005
        OR COALESCE(mm.last_saldo, 0) > 0.005
        OR COALESCE(pay.total_pagos, 0) > 0.005
      )
    ORDER BY c.business_name ASC, c.name ASC
  `;
    const sqlSimple = `
    SELECT
      c.id AS customerId,
      ROUND(COALESCE(oc.cargos, 0), 2) AS orderCargosPendientes,
      ROUND(COALESCE(mm.last_saldo, 0), 2) AS multimediaSaldo,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      ROUND(GREATEST(0, COALESCE(oc.cargos, 0) + COALESCE(mm.last_saldo, 0) - COALESCE(pay.total_pagos, 0)), 2) AS saldoPendienteUnificado
    FROM customers c
    LEFT JOIN (
      SELECT
        o.customer_id,
        SUM(ROUND(o.total * 1.21, 2)) AS cargos
      FROM orders o
      WHERE o.payment_status = 'pendiente'
        AND o.status NOT IN ('Cancelado', 'Borrador')
        AND (o.archived = 0 OR o.archived IS NULL)
      GROUP BY o.customer_id
    ) oc ON oc.customer_id = c.id
    LEFT JOIN (${mmSubquery}) mm ON mm.customer_id = c.id
    LEFT JOIN (${paymentsSubquery}) pay ON pay.customer_id = c.id
    WHERE 1=1 ${sellerFilter}
      AND (
        COALESCE(oc.cargos, 0) > 0.005
        OR COALESCE(mm.last_saldo, 0) > 0.005
        OR COALESCE(pay.total_pagos, 0) > 0.005
      )
    ORDER BY c.business_name ASC, c.name ASC
  `;
    try {
        const rows = yield (0, db_1.query)(sqlWithNc, paramsWithNc);
        return res.json(rows.map((r) => ({
            customerId: r.customerId,
            orderCargosPendientes: Number(r.orderCargosPendientes) || 0,
            multimediaSaldo: Number(r.multimediaSaldo) || 0,
            totalPagos: Number(r.totalPagos) || 0,
            saldoPendienteUnificado: Number(r.saldoPendienteUnificado) || 0
        })));
    }
    catch (e) {
        console.warn('[cartera-totals] consulta con NC falló, reintentando sin NC:', e === null || e === void 0 ? void 0 : e.message);
        try {
            const rows = yield (0, db_1.query)(sqlSimple, paramsSimple);
            return res.json(rows.map((r) => ({
                customerId: r.customerId,
                orderCargosPendientes: Number(r.orderCargosPendientes) || 0,
                multimediaSaldo: Number(r.multimediaSaldo) || 0,
                totalPagos: Number(r.totalPagos) || 0,
                saldoPendienteUnificado: Number(r.saldoPendienteUnificado) || 0
            })));
        }
        catch (e2) {
            console.error('getCarteraTotals:', e2);
            return res.status(500).json({ message: 'Error listando totales de cartera' });
        }
    }
});
exports.getCarteraTotals = getCarteraTotals;
/** Exporta saldos pendientes en CSV (UTF-8 con BOM para Excel). */
const exportSaldosPendientesCsv = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    const user = req.user;
    if (!user || !roleCanViewSaldos(user.role)) {
        return res.status(403).json({ message: 'Sin permiso para exportar saldos' });
    }
    const sellerFilter = user.role === 'SELLER' ? ' AND c.seller_id = ?' : '';
    const baseParams = user.role === 'SELLER' ? [user.id] : [];
    const paymentsJoin = user.role === 'SELLER'
        ? `LEFT JOIN (
      SELECT p.customer_id, SUM(p.amount) AS total_pagos
      FROM payments p
      INNER JOIN customers c2 ON c2.id = p.customer_id
      WHERE (p.seller_id = ? OR c2.seller_id = ?)
      GROUP BY p.customer_id
    ) pay ON pay.customer_id = t.customerId`
        : `LEFT JOIN (
      SELECT customer_id, SUM(amount) AS total_pagos
      FROM payments
      GROUP BY customer_id
    ) pay ON pay.customer_id = t.customerId`;
    const payParams = user.role === 'SELLER' ? [user.id, user.id] : [];
    const paramsWithNc = [...baseParams, ...payParams];
    const paramsSimple = [...baseParams, ...payParams];
    const sqlWithNc = `
    SELECT
      t.customerId,
      t.businessName,
      t.contactName,
      t.cuit,
      t.city,
      t.email,
      ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) AS saldoPendiente,
      ROUND(t.cargosPendientes, 2) AS totalCargosPendiente,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      t.pedidosPendientes
    FROM (
      SELECT
        c.id AS customerId,
        c.business_name AS businessName,
        c.name AS contactName,
        c.cuit,
        c.city,
        c.email,
        SUM(ROUND(GREATEST(0, o.total - COALESCE(cn.cn_total, 0)) * 1.21, 2)) AS cargosPendientes,
        COUNT(DISTINCT o.id) AS pedidosPendientes
      FROM customers c
      INNER JOIN orders o ON o.customer_id = c.id
      LEFT JOIN (
        SELECT order_id, SUM(amount_credited) AS cn_total
        FROM credit_notes
        GROUP BY order_id
      ) cn ON cn.order_id = o.id
      WHERE o.payment_status = 'pendiente'
        AND o.status NOT IN ('Cancelado', 'Borrador')
        AND (o.archived = 0 OR o.archived IS NULL)
        ${sellerFilter}
      GROUP BY c.id, c.business_name, c.name, c.cuit, c.city, c.email
    ) t
    ${paymentsJoin}
    WHERE ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) > 0.01
    ORDER BY t.businessName ASC, t.contactName ASC
  `;
    const sqlSimple = `
    SELECT
      t.customerId,
      t.businessName,
      t.contactName,
      t.cuit,
      t.city,
      t.email,
      ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) AS saldoPendiente,
      ROUND(t.cargosPendientes, 2) AS totalCargosPendiente,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      t.pedidosPendientes
    FROM (
      SELECT
        c.id AS customerId,
        c.business_name AS businessName,
        c.name AS contactName,
        c.cuit,
        c.city,
        c.email,
        SUM(ROUND(o.total * 1.21, 2)) AS cargosPendientes,
        COUNT(DISTINCT o.id) AS pedidosPendientes
      FROM customers c
      INNER JOIN orders o ON o.customer_id = c.id
      WHERE o.payment_status = 'pendiente'
        AND o.status NOT IN ('Cancelado', 'Borrador')
        AND (o.archived = 0 OR o.archived IS NULL)
        ${sellerFilter}
      GROUP BY c.id, c.business_name, c.name, c.cuit, c.city, c.email
    ) t
    ${paymentsJoin}
    WHERE ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) > 0.01
    ORDER BY t.businessName ASC, t.contactName ASC
  `;
    let rows;
    try {
        rows = (yield (0, db_1.query)(sqlWithNc, paramsWithNc));
    }
    catch (_f) {
        rows = (yield (0, db_1.query)(sqlSimple, paramsSimple));
    }
    const header = [
        'id_cliente',
        'razon_social',
        'contacto',
        'cuit',
        'ciudad',
        'email',
        'pedidos_impagos',
        'total_cargos_iva',
        'pagos_registrados',
        'saldo_pendiente'
    ];
    const lines = [header.join(';')];
    for (const r of rows) {
        const esc = (s) => `"${String(s !== null && s !== void 0 ? s : '').replace(/"/g, '""')}"`;
        lines.push([
            r.customerId,
            esc((_a = r.businessName) !== null && _a !== void 0 ? _a : ''),
            esc((_b = r.contactName) !== null && _b !== void 0 ? _b : ''),
            (_c = r.cuit) !== null && _c !== void 0 ? _c : '',
            esc((_d = r.city) !== null && _d !== void 0 ? _d : ''),
            esc((_e = r.email) !== null && _e !== void 0 ? _e : ''),
            Number(r.pedidosPendientes) || 0,
            (Number(r.totalCargosPendiente) || 0).toFixed(2).replace('.', ','),
            (Number(r.totalPagos) || 0).toFixed(2).replace('.', ','),
            (Number(r.saldoPendiente) || 0).toFixed(2).replace('.', ',')
        ].join(';'));
    }
    const csv = lines.join('\r\n');
    const filename = `saldos_pendientes_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv);
});
exports.exportSaldosPendientesCsv = exportSaldosPendientesCsv;
/**
 * Exporta saldos pendientes con detalle de movimientos (facturas/NC/recibos) en Excel.
 * Hoja 1: resumen por cliente + vendedor.
 * Hoja 2: detalle de comprobantes y recibos por cliente.
 */
const exportSaldosPendientesDetalleXlsx = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    const user = req.user;
    if (!user || !roleCanViewSaldos(user.role)) {
        return res.status(403).json({ message: 'Sin permiso para exportar saldos' });
    }
    try {
        const sellerWhere = user.role === 'SELLER' ? 'WHERE c.seller_id = ?' : '';
        const sellerParams = user.role === 'SELLER' ? [user.id] : [];
        const movements = yield (0, db_1.query)(`
      SELECT
        m.customer_id,
        m.customer_name,
        m.seller_id,
        m.seller_name,
        m.fecha,
        m.tipo,
        m.comprobante,
        m.order_id,
        m.debe,
        m.haber
      FROM (
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          COALESCE(i.created_at, o.date) AS fecha,
          'FACTURA' AS tipo,
          CONCAT(
            CASE
              WHEN i.cbte_tipo = 1 THEN 'A '
              WHEN i.cbte_tipo = 6 THEN 'B '
              ELSE ''
            END,
            LPAD(COALESCE(i.punto_venta, 0), 5, '0'),
            '-',
            LPAD(COALESCE(i.cbte_desde, 0), 8, '0')
          ) AS comprobante,
          o.id AS order_id,
          ROUND(COALESCE(o.total, 0) * 1.21, 2) AS debe,
          0 AS haber
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN users u ON u.id = c.seller_id

        UNION ALL

        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          cn.created_at AS fecha,
          'NOTA_CREDITO' AS tipo,
          CONCAT(
            CASE
              WHEN cn.cbte_tipo = 3 THEN 'NC A '
              WHEN cn.cbte_tipo = 8 THEN 'NC B '
              ELSE 'NC '
            END,
            LPAD(COALESCE(cn.punto_venta, 0), 5, '0'),
            '-',
            LPAD(COALESCE(cn.cbte_desde, 0), 8, '0')
          ) AS comprobante,
          cn.order_id AS order_id,
          0 AS debe,
          ROUND(COALESCE(cn.amount_credited, 0) * 1.21, 2) AS haber
        FROM credit_notes cn
        JOIN orders o ON o.id = cn.order_id
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN users u ON u.id = c.seller_id

        UNION ALL

        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          p.date AS fecha,
          'RECIBO' AS tipo,
          p.receipt_number AS comprobante,
          p.order_id AS order_id,
          0 AS debe,
          ROUND(COALESCE(p.amount, 0), 2) AS haber
        FROM payments p
        JOIN customers c ON c.id = p.customer_id
        LEFT JOIN users u ON u.id = c.seller_id
      ) m
      ${user.role === 'SELLER' ? 'WHERE m.seller_id = ?' : ''}
      ORDER BY m.customer_name ASC, m.fecha ASC, m.tipo ASC
      `, sellerParams);
        const customers = yield (0, db_1.query)(`SELECT c.id, COALESCE(c.business_name, c.name, 'Cliente') AS customer_name, c.seller_id, u.name AS seller_name
       FROM customers c
       LEFT JOIN users u ON u.id = c.seller_id
       ${sellerWhere}
       ORDER BY customer_name ASC`, sellerParams);
        const workbook = new exceljs_1.default.Workbook();
        workbook.creator = 'LupoHub';
        workbook.created = new Date();
        const wsSummary = workbook.addWorksheet('Resumen');
        wsSummary.columns = [
            { header: 'Cliente', key: 'cliente', width: 40 },
            { header: 'Vendedor', key: 'vendedor', width: 28 },
            { header: 'Total Facturas', key: 'facturas', width: 16 },
            { header: 'Total NC', key: 'nc', width: 14 },
            { header: 'Total Recibos', key: 'recibos', width: 16 },
            { header: 'Saldo Pendiente', key: 'saldo', width: 18 }
        ];
        const wsDetail = workbook.addWorksheet('Detalle');
        wsDetail.columns = [
            { header: 'Cliente', key: 'cliente', width: 40 },
            { header: 'Vendedor', key: 'vendedor', width: 28 },
            { header: 'Fecha', key: 'fecha', width: 14 },
            { header: 'Tipo', key: 'tipo', width: 14 },
            { header: 'Comprobante', key: 'comprobante', width: 24 },
            { header: 'Pedido', key: 'pedido', width: 16 },
            { header: 'Debe', key: 'debe', width: 14 },
            { header: 'Haber', key: 'haber', width: 14 },
            { header: 'Saldo Cliente', key: 'saldo', width: 16 }
        ];
        const byCustomer = new Map();
        for (const m of movements) {
            if (!byCustomer.has(m.customer_id))
                byCustomer.set(m.customer_id, []);
            byCustomer.get(m.customer_id).push(m);
        }
        for (const c of customers) {
            const movs = byCustomer.get(c.id) || [];
            let totalFacturas = 0;
            let totalNc = 0;
            let totalRecibos = 0;
            let running = 0;
            for (const m of movs) {
                const debe = Number(m.debe || 0);
                const haber = Number(m.haber || 0);
                running = Math.round((running + debe - haber) * 100) / 100;
                if (m.tipo === 'FACTURA')
                    totalFacturas += debe;
                else if (m.tipo === 'NOTA_CREDITO')
                    totalNc += haber;
                else
                    totalRecibos += haber;
                wsDetail.addRow({
                    cliente: c.customer_name,
                    vendedor: (_b = (_a = c.seller_name) !== null && _a !== void 0 ? _a : c.seller_id) !== null && _b !== void 0 ? _b : '',
                    fecha: m.fecha ? new Date(m.fecha) : null,
                    tipo: m.tipo === 'NOTA_CREDITO' ? 'NC' : m.tipo,
                    comprobante: m.comprobante,
                    pedido: (_c = m.order_id) !== null && _c !== void 0 ? _c : '',
                    debe,
                    haber,
                    saldo: running
                });
            }
            const saldoPendiente = Math.round(Math.max(0, running) * 100) / 100;
            if (saldoPendiente > 0.01) {
                wsSummary.addRow({
                    cliente: c.customer_name,
                    vendedor: (_e = (_d = c.seller_name) !== null && _d !== void 0 ? _d : c.seller_id) !== null && _e !== void 0 ? _e : '',
                    facturas: totalFacturas,
                    nc: totalNc,
                    recibos: totalRecibos,
                    saldo: saldoPendiente
                });
            }
        }
        const moneyColsSummary = ['C', 'D', 'E', 'F'];
        for (const col of moneyColsSummary)
            wsSummary.getColumn(col).numFmt = '#,##0.00';
        wsSummary.getRow(1).font = { bold: true };
        wsSummary.views = [{ state: 'frozen', ySplit: 1 }];
        wsDetail.getColumn('C').numFmt = 'dd/mm/yyyy';
        wsDetail.getColumn('G').numFmt = '#,##0.00';
        wsDetail.getColumn('H').numFmt = '#,##0.00';
        wsDetail.getColumn('I').numFmt = '#,##0.00';
        wsDetail.getRow(1).font = { bold: true };
        wsDetail.views = [{ state: 'frozen', ySplit: 1 }];
        const out = yield workbook.xlsx.writeBuffer();
        const buf = Buffer.from(out instanceof ArrayBuffer ? new Uint8Array(out) : new Uint8Array(out));
        const filename = `saldos_pendientes_detalle_${new Date().toISOString().slice(0, 10)}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(buf);
    }
    catch (error) {
        console.error('exportSaldosPendientesDetalleXlsx:', error);
        return res.status(500).json({ message: 'Error exportando saldos pendientes detallados' });
    }
});
exports.exportSaldosPendientesDetalleXlsx = exportSaldosPendientesDetalleXlsx;
/**
 * Excel una sola hoja "Resumen" estilizada: Código, Cliente, Vendedor habitual, Zona, Saldo final, Movimientos.
 * Saldo final = max(0, C + M − P): pedidos pendientes IVA + último saldo cuenta importada − pagos registrados.
 * Movimientos = líneas en historial importado + cantidad de pedidos pendientes (misma idea que cartera unificada).
 * Incluye clientes con saldo solo en cuenta importada aunque no tengan pedidos pendientes en LupoHub.
 */
const exportSaldosPendientesMultimediasXlsx = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const user = req.user;
    if (!user || !roleCanViewSaldos(user.role)) {
        return res.status(403).json({ message: 'Sin permiso para exportar saldos' });
    }
    const sellerFilter = user.role === 'SELLER' ? ' AND c.seller_id = ?' : '';
    const baseParams = user.role === 'SELLER' ? [user.id] : [];
    const paymentsJoin = user.role === 'SELLER'
        ? `LEFT JOIN (
      SELECT p.customer_id, SUM(p.amount) AS total_pagos
      FROM payments p
      INNER JOIN customers c2 ON c2.id = p.customer_id
      WHERE (p.seller_id = ? OR c2.seller_id = ?)
      GROUP BY p.customer_id
    ) pay ON pay.customer_id = t.customerId`
        : `LEFT JOIN (
      SELECT customer_id, SUM(amount) AS total_pagos
      FROM payments
      GROUP BY customer_id
    ) pay ON pay.customer_id = t.customerId`;
    const payParams = user.role === 'SELLER' ? [user.id, user.id] : [];
    const paramsWithNc = [...baseParams, ...payParams];
    const paramsSimple = [...baseParams, ...payParams];
    const payMmJoin = user.role === 'SELLER'
        ? `LEFT JOIN (
      SELECT p.customer_id, SUM(p.amount) AS total_pagos
      FROM payments p
      INNER JOIN customers c2 ON c2.id = p.customer_id
      WHERE (p.seller_id = ? OR c2.seller_id = ?)
      GROUP BY p.customer_id
    ) pay_mm ON pay_mm.customer_id = c.id`
        : `LEFT JOIN (
      SELECT customer_id, SUM(amount) AS total_pagos
      FROM payments
      GROUP BY customer_id
    ) pay_mm ON pay_mm.customer_id = c.id`;
    const mmParams = [...baseParams, ...payParams];
    const sqlWithNc = `
    SELECT
      t.customerId,
      t.legacy_code,
      t.account_zone,
      t.account_seller_label,
      t.seller_id,
      t.businessName,
      t.contactName,
      t.cuit,
      ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) AS saldoPendiente,
      ROUND(t.cargosPendientes, 2) AS totalCargosPendiente,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      t.pedidosPendientes,
      u.name AS seller_name
    FROM (
      SELECT
        c.id AS customerId,
        c.legacy_code,
        c.account_zone,
        c.account_seller_label,
        c.seller_id,
        c.business_name AS businessName,
        c.name AS contactName,
        c.cuit,
        SUM(ROUND(GREATEST(0, o.total - COALESCE(cn.cn_total, 0)) * 1.21, 2)) AS cargosPendientes,
        COUNT(DISTINCT o.id) AS pedidosPendientes
      FROM customers c
      INNER JOIN orders o ON o.customer_id = c.id
      LEFT JOIN (
        SELECT order_id, SUM(amount_credited) AS cn_total
        FROM credit_notes
        GROUP BY order_id
      ) cn ON cn.order_id = o.id
      WHERE o.payment_status = 'pendiente'
        AND o.status NOT IN ('Cancelado', 'Borrador')
        AND (o.archived = 0 OR o.archived IS NULL)
        ${sellerFilter}
      GROUP BY c.id, c.legacy_code, c.account_zone, c.account_seller_label, c.seller_id, c.business_name, c.name, c.cuit
    ) t
    LEFT JOIN users u ON u.id = t.seller_id
    ${paymentsJoin}
    ORDER BY t.businessName ASC, t.contactName ASC
  `;
    const sqlSimple = `
    SELECT
      t.customerId,
      t.legacy_code,
      t.account_zone,
      t.account_seller_label,
      t.seller_id,
      t.businessName,
      t.contactName,
      t.cuit,
      ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) AS saldoPendiente,
      ROUND(t.cargosPendientes, 2) AS totalCargosPendiente,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      t.pedidosPendientes,
      u.name AS seller_name
    FROM (
      SELECT
        c.id AS customerId,
        c.legacy_code,
        c.account_zone,
        c.account_seller_label,
        c.seller_id,
        c.business_name AS businessName,
        c.name AS contactName,
        c.cuit,
        SUM(ROUND(o.total * 1.21, 2)) AS cargosPendientes,
        COUNT(DISTINCT o.id) AS pedidosPendientes
      FROM customers c
      INNER JOIN orders o ON o.customer_id = c.id
      WHERE o.payment_status = 'pendiente'
        AND o.status NOT IN ('Cancelado', 'Borrador')
        AND (o.archived = 0 OR o.archived IS NULL)
        ${sellerFilter}
      GROUP BY c.id, c.legacy_code, c.account_zone, c.account_seller_label, c.seller_id, c.business_name, c.name, c.cuit
    ) t
    LEFT JOIN users u ON u.id = t.seller_id
    ${paymentsJoin}
    ORDER BY t.businessName ASC, t.contactName ASC
  `;
    let rows;
    try {
        rows = (yield (0, db_1.query)(sqlWithNc, paramsWithNc));
    }
    catch (_j) {
        rows = (yield (0, db_1.query)(sqlSimple, paramsSimple));
    }
    const sqlMultimediaSaldos = `
    SELECT
      c.id AS customerId,
      c.legacy_code,
      c.account_zone,
      c.account_seller_label,
      c.seller_id,
      c.business_name AS businessName,
      c.name AS contactName,
      c.cuit,
      CAST(COALESCE(
        (SELECT CAST(e_lo.saldo AS DECIMAL(16,2))
         FROM customer_multimedia_entries e_lo
         WHERE e_lo.customer_id = agg.customer_id
         ORDER BY e_lo.line_order DESC
         LIMIT 1),
        (SELECT CAST(e2.saldo AS DECIMAL(16,2))
         FROM customer_multimedia_entries e2
         WHERE e2.customer_id = agg.customer_id AND e2.saldo IS NOT NULL
         ORDER BY e2.line_order DESC
         LIMIT 1),
        0
      ) AS DECIMAL(16,2)) AS lastSaldo,
      agg.cnt AS movementCount,
      ROUND(COALESCE(pay_mm.total_pagos, 0), 2) AS totalPagos,
      u.name AS seller_name
    FROM (
      SELECT customer_id, COUNT(*) AS cnt
      FROM customer_multimedia_entries
      GROUP BY customer_id
    ) agg
    INNER JOIN customers c ON c.id = agg.customer_id
    LEFT JOIN users u ON u.id = c.seller_id
    ${payMmJoin}
    WHERE 1=1 ${sellerFilter}
  `;
    let mmRows = [];
    try {
        mmRows = (yield (0, db_1.query)(sqlMultimediaSaldos, mmParams));
    }
    catch (_k) {
        mmRows = [];
    }
    const byId = new Map();
    for (const r of rows) {
        const id = String(r.customerId);
        const C = Number(r.totalCargosPendiente) || 0;
        const P = Number(r.totalPagos) || 0;
        byId.set(id, {
            customerId: id,
            legacy_code: r.legacy_code,
            account_zone: r.account_zone,
            account_seller_label: r.account_seller_label,
            seller_id: r.seller_id,
            businessName: String((_a = r.businessName) !== null && _a !== void 0 ? _a : ''),
            contactName: String((_b = r.contactName) !== null && _b !== void 0 ? _b : ''),
            cuit: String((_c = r.cuit) !== null && _c !== void 0 ? _c : ''),
            totalCargosPendiente: C,
            totalPagos: P,
            multimediaSaldo: 0,
            saldoPendiente: Math.round(Math.max(0, C + 0 - P) * 100) / 100,
            pedidosPendientes: Number(r.pedidosPendientes) || 0,
            seller_name: r.seller_name,
            movementCountExcel: 0
        });
    }
    for (const m of mmRows) {
        const id = String(m.customerId);
        const excelSaldo = Number(m.lastSaldo) || 0;
        const mmCnt = Number(m.movementCount) || 0;
        const Pmm = Number(m.totalPagos) || 0;
        const existing = byId.get(id);
        const C = (_d = existing === null || existing === void 0 ? void 0 : existing.totalCargosPendiente) !== null && _d !== void 0 ? _d : 0;
        const P = (_e = existing === null || existing === void 0 ? void 0 : existing.totalPagos) !== null && _e !== void 0 ? _e : Pmm;
        const unified = Math.round(Math.max(0, C + excelSaldo - P) * 100) / 100;
        if (existing) {
            existing.multimediaSaldo = excelSaldo;
            existing.totalPagos = P;
            existing.saldoPendiente = unified;
            existing.movementCountExcel = mmCnt;
        }
        else {
            byId.set(id, {
                customerId: id,
                legacy_code: m.legacy_code,
                account_zone: m.account_zone,
                account_seller_label: m.account_seller_label,
                seller_id: m.seller_id,
                businessName: String((_f = m.businessName) !== null && _f !== void 0 ? _f : ''),
                contactName: String((_g = m.contactName) !== null && _g !== void 0 ? _g : ''),
                cuit: String((_h = m.cuit) !== null && _h !== void 0 ? _h : ''),
                totalCargosPendiente: 0,
                totalPagos: Pmm,
                multimediaSaldo: excelSaldo,
                saldoPendiente: Math.round(Math.max(0, 0 + excelSaldo - Pmm) * 100) / 100,
                pedidosPendientes: 0,
                seller_name: m.seller_name,
                movementCountExcel: mmCnt
            });
        }
    }
    const mergedList = [...byId.values()]
        .filter((r) => r.saldoPendiente > 0.01)
        .sort((a, b) => (a.businessName || '').localeCompare(b.businessName || '', 'es') ||
        (a.contactName || '').localeCompare(b.contactName || '', 'es'));
    const borderThin = {
        style: 'thin',
        color: { argb: 'FF94A3B8' }
    };
    const workbook = new exceljs_1.default.Workbook();
    workbook.creator = 'LupoHub';
    workbook.created = new Date();
    const ws = workbook.addWorksheet('Resumen', {
        views: [{ state: 'frozen', ySplit: 1 }],
        properties: { defaultRowHeight: 19 }
    });
    ws.columns = [
        { key: 'codigo', width: 14 },
        { key: 'cliente', width: 44 },
        { key: 'vendedor', width: 24 },
        { key: 'zona', width: 18 },
        { key: 'pedidos', width: 15 },
        { key: 'importada', width: 17 },
        { key: 'recibos', width: 17 },
        { key: 'saldo', width: 16 },
        { key: 'movs', width: 13 }
    ];
    const headerTitles = ['Código', 'Cliente', 'Vendedor habitual', 'Zona', 'Pedidos', 'Cuenta importada', 'Recibos sistema', 'Saldo final', 'Movimientos'];
    const headerRow = ws.addRow(headerTitles);
    headerRow.height = 26;
    headerRow.eachCell((cell, colNumber) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF1E40AF' }
        };
        cell.alignment = {
            vertical: 'middle',
            horizontal: colNumber >= 5 ? 'right' : 'left',
            wrapText: true
        };
        cell.border = {
            top: borderThin,
            left: borderThin,
            bottom: { style: 'medium', color: { argb: 'FF1E3A8A' } },
            right: borderThin
        };
    });
    let rowNum = 2;
    for (const r of mergedList) {
        const displayName = String(r.businessName || r.contactName || 'Cliente').trim();
        const legacyTrim = r.legacy_code != null ? String(r.legacy_code).trim() : '';
        const code = legacyTrim ||
            (0, multimediaHistorialExcel_1.padLegacyCode)(String(r.customerId || '').replace(/-/g, '').slice(0, 6) || '0');
        const vendedor = (r.account_seller_label != null && String(r.account_seller_label).trim() !== ''
            ? String(r.account_seller_label).trim()
            : '') ||
            (r.seller_id && r.seller_name ? `${String(r.seller_id).slice(0, 8)} - ${r.seller_name}` : '');
        const zona = r.account_zone != null ? String(r.account_zone).trim() : '';
        const pedidos = Number(r.totalCargosPendiente) || 0;
        const importada = Number(r.multimediaSaldo) || 0;
        const recibosSistema = Number(r.totalPagos) || 0;
        const saldoFinal = Number(r.saldoPendiente) || 0;
        const movs = (Number(r.movementCountExcel) || 0) + (Number(r.pedidosPendientes) || 0);
        const dataRow = ws.addRow([code, displayName, vendedor, zona, pedidos, importada, recibosSistema, saldoFinal, movs]);
        const zebra = rowNum % 2 === 0;
        dataRow.eachCell((cell, colNumber) => {
            cell.font = { size: 11, name: 'Calibri', color: { argb: 'FF0F172A' } };
            if (zebra) {
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFF1F5F9' }
                };
            }
            cell.border = {
                top: borderThin,
                left: borderThin,
                bottom: borderThin,
                right: borderThin
            };
            cell.alignment = {
                vertical: 'middle',
                horizontal: colNumber >= 5 ? 'right' : 'left',
                wrapText: colNumber === 2 || colNumber === 3
            };
            if ([5, 6, 7, 8].includes(colNumber)) {
                cell.numFmt = '#,##0.00';
            }
            if (colNumber === 9) {
                cell.numFmt = '0';
            }
        });
        rowNum++;
    }
    // Fila final: total general al pie de la hoja.
    const totalPedidos = mergedList.reduce((acc, r) => acc + (Number(r.totalCargosPendiente) || 0), 0);
    const totalImportada = mergedList.reduce((acc, r) => acc + (Number(r.multimediaSaldo) || 0), 0);
    const totalRecibosSistema = mergedList.reduce((acc, r) => acc + (Number(r.totalPagos) || 0), 0);
    const totalSaldoFinal = mergedList.reduce((acc, r) => acc + (Number(r.saldoPendiente) || 0), 0);
    const totalMovs = mergedList.reduce((acc, r) => acc + (Number(r.movementCountExcel) || 0) + (Number(r.pedidosPendientes) || 0), 0);
    const totalRow = ws.addRow([
        '',
        'TOTAL GENERAL',
        '',
        '',
        totalPedidos,
        totalImportada,
        totalRecibosSistema,
        totalSaldoFinal,
        totalMovs
    ]);
    totalRow.height = 24;
    totalRow.eachCell((cell, colNumber) => {
        cell.font = { bold: true, size: 11, name: 'Calibri', color: { argb: 'FF0F172A' } };
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE2E8F0' }
        };
        cell.border = {
            top: { style: 'medium', color: { argb: 'FF64748B' } },
            left: borderThin,
            bottom: { style: 'medium', color: { argb: 'FF64748B' } },
            right: borderThin
        };
        cell.alignment = {
            vertical: 'middle',
            horizontal: colNumber >= 5 ? 'right' : 'left'
        };
        if ([5, 6, 7, 8].includes(colNumber)) {
            cell.numFmt = '#,##0.00';
        }
        if (colNumber === 9) {
            cell.numFmt = '0';
        }
    });
    if (mergedList.length > 0) {
        ws.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: mergedList.length + 2, column: 9 }
        };
    }
    const out = yield workbook.xlsx.writeBuffer();
    const buf = Buffer.from(out instanceof ArrayBuffer ? new Uint8Array(out) : new Uint8Array(out));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="saldos_pendientes_resumen_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(buf);
});
exports.exportSaldosPendientesMultimediasXlsx = exportSaldosPendientesMultimediasXlsx;
function normResumenHeader(s) {
    return String(s !== null && s !== void 0 ? s : '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}
function normalizeNameForCustomerMatch(v) {
    return String(v !== null && v !== void 0 ? v : '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}
function cellStrResumenCell(v) {
    if (v == null || v === '')
        return '';
    if (typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v))
        return String(Math.trunc(v));
    return String(v).trim();
}
/**
 * POST multipart file — hoja Resumen Multimedias: asigna customers.seller_id según "Vendedor habitual"
 * (código numérico) vinculado al usuario vendedor.{codigo}@importado.lupohub.local.
 * Cliente: por legacy_code (columna Código) o por nombre (columna Cliente).
 */
const assignCustomerSellersFromResumen = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const authUser = req.user;
        if (!authUser || authUser.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden asignar vendedores en lote' });
        }
        const file = req.file;
        if (!(file === null || file === void 0 ? void 0 : file.buffer)) {
            return res.status(400).json({ message: 'Subí un archivo .xlsx (campo file)' });
        }
        const wb = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        if (!ws)
            return res.status(400).json({ message: 'El archivo no tiene hojas' });
        const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        let headerRow = -1;
        let codigoCol = -1;
        let vendCol = -1;
        let clienteCol = -1;
        for (let r = 0; r < Math.min(15, matrix.length); r++) {
            const h = matrix[r].map((c) => normResumenHeader(String(c !== null && c !== void 0 ? c : '')));
            const ci = h.findIndex((x) => x === 'codigo');
            const vi = h.findIndex((x) => x.includes('vendedor') && x.includes('habitual'));
            const cl = h.findIndex((x) => x.includes('cliente') && !x.includes('vendedor'));
            if (ci >= 0 && vi >= 0) {
                headerRow = r;
                codigoCol = ci;
                vendCol = vi;
                clienteCol = cl >= 0 ? cl : 1;
                break;
            }
        }
        if (headerRow < 0) {
            return res.status(400).json({
                message: 'No se encontró formato Resumen (columnas Código y Vendedor habitual). Usá el Excel historial Multimedias.',
            });
        }
        const custRows = (yield (0, db_1.query)(`SELECT id, legacy_code, business_name, name FROM customers`));
        const legacyToId = new Map();
        const normToId = new Map();
        for (const c of custRows) {
            const lc = (c.legacy_code && String(c.legacy_code).trim()) || '';
            if (lc) {
                legacyToId.set(lc, c.id);
                legacyToId.set((0, multimediaHistorialExcel_1.padLegacyCode)(lc), c.id);
                const strip = lc.replace(/^0+/, '') || '0';
                legacyToId.set(strip, c.id);
                const digits = lc.replace(/\D/g, '');
                if (digits && /^\d+$/.test(digits)) {
                    legacyToId.set(digits, c.id);
                    legacyToId.set((0, multimediaHistorialExcel_1.padLegacyCode)(digits), c.id);
                }
            }
            const bn = normalizeNameForCustomerMatch(c.business_name);
            if (bn)
                normToId.set(bn, c.id);
            const nm = normalizeNameForCustomerMatch(c.name);
            if (nm)
                normToId.set(nm, c.id);
        }
        let rowsProcessed = 0;
        let customersUpdated = 0;
        let skippedNoSeller = 0;
        let skippedNoCustomer = 0;
        let skippedNoVendedorCell = 0;
        for (let i = headerRow + 1; i < matrix.length; i++) {
            const row = matrix[i];
            const codigoRaw = cellStrResumenCell(row[codigoCol]);
            const vendRaw = cellStrResumenCell(row[vendCol]);
            const clienteRaw = clienteCol >= 0 ? cellStrResumenCell(row[clienteCol]) : '';
            if (!codigoRaw && !clienteRaw)
                continue;
            rowsProcessed++;
            if (!vendRaw) {
                skippedNoVendedorCell++;
                continue;
            }
            const vm = vendRaw.match(/^(\d+)\s*[-–—]\s*(.+)$/u);
            const vendCode = vm ? vm[1].trim().replace(/^0+/, '') || vm[1].trim() || '0' : null;
            if (!vendCode) {
                skippedNoSeller++;
                continue;
            }
            const sellerEmail = `vendedor.${vendCode}@importado.lupohub.local`;
            const sellerRow = yield (0, db_1.get)(`SELECT id FROM users WHERE email = ? AND role = 'SELLER'`, [sellerEmail]);
            if (!(sellerRow === null || sellerRow === void 0 ? void 0 : sellerRow.id)) {
                skippedNoSeller++;
                continue;
            }
            let customerId;
            if (codigoRaw) {
                const t = codigoRaw.trim();
                const tryKeys = new Set([t]);
                const digits = t.replace(/\D/g, '');
                if (digits) {
                    tryKeys.add(digits);
                    tryKeys.add((0, multimediaHistorialExcel_1.padLegacyCode)(digits));
                    tryKeys.add(digits.replace(/^0+/, '') || '0');
                }
                for (const k of tryKeys) {
                    const hit = legacyToId.get(k);
                    if (hit) {
                        customerId = hit;
                        break;
                    }
                }
            }
            if (!customerId && clienteRaw) {
                customerId = normToId.get(normalizeNameForCustomerMatch(clienteRaw));
            }
            if (!customerId) {
                skippedNoCustomer++;
                continue;
            }
            yield (0, db_1.execute)(`UPDATE customers SET seller_id = ? WHERE id = ?`, [sellerRow.id, customerId]);
            customersUpdated++;
        }
        res.json({
            message: 'Asignación de vendedores desde Resumen finalizada',
            rowsProcessed,
            customersUpdated,
            skippedNoSeller,
            skippedNoCustomer,
            skippedNoVendedorCell,
        });
    }
    catch (e) {
        console.error('assignCustomerSellersFromResumen:', e);
        res.status(500).json({ message: 'Error asignando vendedores', detail: e === null || e === void 0 ? void 0 : e.message });
    }
});
exports.assignCustomerSellersFromResumen = assignCustomerSellersFromResumen;
/** Quita pendientes de pedidos ya despachados para un cliente:
 *  - Si quantity > picked, deja quantity = picked (solo lo enviado)
 *  - Elimina renglones con quantity <= 0
 *  - Recalcula total del pedido
 */
const clearDispatchedPendingsForCustomer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const authUser = req.user;
        if (!authUser || !['ADMIN', 'SELLER', 'WAREHOUSE', 'DEPOSITO'].includes(authUser.role)) {
            return res.status(403).json({ message: 'Sin permisos para quitar pendientes' });
        }
        const { id: customerId } = req.params;
        if (!customerId)
            return res.status(400).json({ message: 'ID de cliente requerido' });
        const customer = yield (0, db_1.get)('SELECT id, seller_id FROM customers WHERE id = ?', [customerId]);
        if (!customer)
            return res.status(404).json({ message: 'Cliente no encontrado' });
        if (authUser.role === 'SELLER' && customer.seller_id && customer.seller_id !== authUser.id) {
            return res.status(403).json({ message: 'Solo podés operar sobre tus clientes' });
        }
        const dispatchedOrders = yield (0, db_1.query)(`SELECT id FROM orders
       WHERE customer_id = ?
         AND status IN ('Despachado', 'DISPATCHED')`, [customerId]);
        const orderIds = (dispatchedOrders || []).map((o) => o.id).filter(Boolean);
        if (orderIds.length === 0) {
            return res.json({ message: 'No hay pedidos despachados para ajustar', ordersUpdated: 0, itemsAdjusted: 0, itemsRemoved: 0 });
        }
        let itemsAdjusted = 0;
        let itemsRemoved = 0;
        let ordersUpdated = 0;
        for (const orderId of orderIds) {
            const beforeAdjust = yield (0, db_1.get)(`SELECT COUNT(*) AS cnt
         FROM order_items
         WHERE order_id = ? AND quantity > COALESCE(picked, 0)`, [orderId]);
            const toAdjust = Number((beforeAdjust === null || beforeAdjust === void 0 ? void 0 : beforeAdjust.cnt) || 0);
            if (toAdjust > 0) {
                yield (0, db_1.execute)(`UPDATE order_items
           SET quantity = COALESCE(picked, 0)
           WHERE order_id = ? AND quantity > COALESCE(picked, 0)`, [orderId]);
                itemsAdjusted += toAdjust;
            }
            const beforeDelete = yield (0, db_1.get)(`SELECT COUNT(*) AS cnt FROM order_items WHERE order_id = ? AND quantity <= 0`, [orderId]);
            const toDelete = Number((beforeDelete === null || beforeDelete === void 0 ? void 0 : beforeDelete.cnt) || 0);
            if (toDelete > 0) {
                yield (0, db_1.execute)(`DELETE FROM order_items WHERE order_id = ? AND quantity <= 0`, [orderId]);
                itemsRemoved += toDelete;
            }
            const totalRow = yield (0, db_1.get)(`SELECT COALESCE(SUM(quantity * price_at_moment), 0) AS total
         FROM order_items
         WHERE order_id = ?`, [orderId]);
            yield (0, db_1.execute)(`UPDATE orders SET total = ? WHERE id = ?`, [Number((totalRow === null || totalRow === void 0 ? void 0 : totalRow.total) || 0), orderId]);
            if (toAdjust > 0 || toDelete > 0)
                ordersUpdated++;
        }
        return res.json({
            message: 'Pendientes de pedidos despachados ajustados',
            ordersUpdated,
            itemsAdjusted,
            itemsRemoved
        });
    }
    catch (error) {
        console.error('clearDispatchedPendingsForCustomer:', error);
        res.status(500).json({ message: 'Error quitando pendientes de pedidos despachados' });
    }
});
exports.clearDispatchedPendingsForCustomer = clearDispatchedPendingsForCustomer;
function buildCustomerFinancialSummary(customerId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const movements = (yield (0, db_1.query)(`
    SELECT
      m.fecha,
      m.tipo,
      m.comprobante,
      m.order_id AS orderId,
      m.debe,
      m.haber,
      m.detalle
    FROM (
      SELECT
        COALESCE(i.created_at, o.date) AS fecha,
        'FACTURA' AS tipo,
        CONCAT(
          CASE
            WHEN i.cbte_tipo = 1 THEN 'A '
            WHEN i.cbte_tipo = 6 THEN 'B '
            ELSE ''
          END,
          LPAD(COALESCE(i.punto_venta, 0), 5, '0'),
          '-',
          LPAD(COALESCE(i.cbte_desde, 0), 8, '0')
        ) AS comprobante,
        o.id AS order_id,
        ROUND(COALESCE(o.total, 0), 2) AS debe,
        0 AS haber,
        CONCAT('Pedido ', COALESCE(o.id, '')) AS detalle
      FROM invoices i
      JOIN orders o ON o.id = i.order_id
      WHERE o.customer_id = ?

      UNION ALL

      SELECT
        cn.created_at AS fecha,
        'NC' AS tipo,
        CONCAT(
          CASE
            WHEN cn.cbte_tipo = 3 THEN 'NC A '
            WHEN cn.cbte_tipo = 8 THEN 'NC B '
            ELSE 'NC '
          END,
          LPAD(COALESCE(cn.punto_venta, 0), 5, '0'),
          '-',
          LPAD(COALESCE(cn.cbte_desde, 0), 8, '0')
        ) AS comprobante,
        cn.order_id AS order_id,
        0 AS debe,
        ROUND(COALESCE(cn.amount_credited, 0), 2) AS haber,
        CONCAT('NC sobre pedido ', COALESCE(cn.order_id, '')) AS detalle
      FROM credit_notes cn
      JOIN orders o ON o.id = cn.order_id
      WHERE o.customer_id = ?

      UNION ALL

      SELECT
        p.date AS fecha,
        'RECIBO' AS tipo,
        COALESCE(p.receipt_number, '') AS comprobante,
        p.order_id AS order_id,
        0 AS debe,
        ROUND(COALESCE(p.amount, 0), 2) AS haber,
        COALESCE(p.notes, '') AS detalle
      FROM payments p
      WHERE p.customer_id = ?
    ) m
    ORDER BY m.fecha ASC, m.tipo ASC, m.comprobante ASC
    `, [customerId, customerId, customerId]));
        const importedEntries = (yield (0, db_1.query)(`
    SELECT
      e.line_date AS fecha,
      UPPER(TRIM(COALESCE(e.tipo, ''))) AS tipo_raw,
      COALESCE(e.numero, '') AS comprobante,
      COALESCE(e.detalle, '') AS detalle,
      COALESCE(e.importe, 0) AS importe,
      e.line_order
    FROM customer_multimedia_entries e
    WHERE e.customer_id = ?
    ORDER BY e.line_date ASC, e.line_order ASC
    `, [customerId]));
        const parseMoney = (v) => {
            if (v == null)
                return 0;
            if (typeof v === 'number')
                return Number.isFinite(v) ? v : 0;
            const s = String(v).trim().replace(/\s/g, '').replace(/\$/g, '');
            if (!s)
                return 0;
            const hasComma = s.includes(',');
            const hasDot = s.includes('.');
            if (hasComma && hasDot) {
                const n = Number(s.replace(/\./g, '').replace(',', '.'));
                return Number.isFinite(n) ? n : 0;
            }
            if (hasComma) {
                const n = Number(s.replace(',', '.'));
                return Number.isFinite(n) ? n : 0;
            }
            const n = Number(s);
            return Number.isFinite(n) ? n : 0;
        };
        const normalizeDate = (v) => {
            if (typeof v === 'string') {
                const raw = v.trim();
                const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
                if (m) {
                    const dd = m[1].padStart(2, '0');
                    const mm = m[2].padStart(2, '0');
                    const yyyy = m[3];
                    return `${yyyy}-${mm}-${dd}`;
                }
            }
            const d = new Date(v);
            if (Number.isNaN(d.getTime()))
                return String(v || '').slice(0, 10);
            return d.toISOString().slice(0, 10);
        };
        const normalizeDoc = (v) => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        const classifyImportedEntry = (tipoRaw, detalleRaw) => {
            const tipo = String(tipoRaw || '').toUpperCase();
            const detalle = String(detalleRaw || '').toUpperCase();
            const raw = `${tipo} ${detalle}`;
            if (/RECIBO|COBRO|PAGO|INGRESO|REC\b|^RC\b|NC\s*A/.test(raw))
                return 'RECIBO';
            if (/FACT|FCA|FCE|DEBITO|COMPROBANTE|NC\s*D|FAC\b/.test(raw))
                return 'FACTURA';
            return null;
        };
        const existingKeys = new Set();
        const toKey = (tipo, fecha, comprobante, debe, haber) => [
            tipo,
            normalizeDate(fecha),
            normalizeDoc(comprobante),
            Number(debe || 0).toFixed(2),
            Number(haber || 0).toFixed(2)
        ].join('|');
        for (const m of movements) {
            const tipo = String(m.tipo || '').toUpperCase();
            existingKeys.add(toKey(tipo, m.fecha, m.comprobante, Number(m.debe || 0), Number(m.haber || 0)));
        }
        for (const e of importedEntries) {
            const tipo = classifyImportedEntry(String(e.tipo_raw || ''), String(e.detalle || ''));
            if (!tipo)
                continue;
            const importe = Math.round(Math.abs(parseMoney(e.importe)) * 100) / 100;
            if (importe <= 0)
                continue;
            const debe = tipo === 'FACTURA' ? importe : 0;
            const haber = tipo === 'RECIBO' ? importe : 0;
            const key = toKey(tipo, e.fecha, e.comprobante, debe, haber);
            if (existingKeys.has(key))
                continue;
            existingKeys.add(key);
            movements.push({
                fecha: normalizeDate(e.fecha),
                tipo,
                comprobante: (_a = e.comprobante) !== null && _a !== void 0 ? _a : '',
                orderId: null,
                debe,
                haber,
                detalle: e.detalle ? `Importado: ${e.detalle}` : 'Importado'
            });
        }
        let totalFacturas = 0;
        let totalNc = 0;
        let totalRecibos = 0;
        const mapped = movements.map((m) => {
            var _a, _b, _c, _d;
            const debe = Number(m.debe || 0);
            const haber = Number(m.haber || 0);
            if (m.tipo === 'FACTURA')
                totalFacturas += debe;
            if (m.tipo === 'NC')
                totalNc += haber;
            if (m.tipo === 'RECIBO')
                totalRecibos += haber;
            return {
                fecha: (_a = m.fecha) !== null && _a !== void 0 ? _a : null,
                tipo: m.tipo,
                comprobante: (_b = m.comprobante) !== null && _b !== void 0 ? _b : '',
                orderId: (_c = m.orderId) !== null && _c !== void 0 ? _c : null,
                debe,
                haber,
                detalle: (_d = m.detalle) !== null && _d !== void 0 ? _d : ''
            };
        });
        mapped.sort((a, b) => {
            const da = a.fecha ? new Date(a.fecha).getTime() : 0;
            const db = b.fecha ? new Date(b.fecha).getTime() : 0;
            if (da !== db)
                return da - db;
            return String(a.comprobante || '').localeCompare(String(b.comprobante || ''), 'es');
        });
        totalFacturas = Math.round(totalFacturas * 100) / 100;
        totalNc = Math.round(totalNc * 100) / 100;
        totalRecibos = Math.round(totalRecibos * 100) / 100;
        const saldoPendiente = Math.round(Math.max(0, totalFacturas - totalNc - totalRecibos) * 100) / 100;
        return {
            totalFacturas,
            totalNc,
            totalRecibos,
            saldoPendiente,
            movements: mapped
        };
    });
}
/** Saldo por cliente desde facturas/NC y recibos (sin cuenta importada). */
const getCustomerFinancialSummary = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    try {
        const authUser = req.user;
        if (!authUser || !roleCanViewSaldos(authUser.role)) {
            return res.status(403).json({ message: 'Sin permiso para ver saldos del cliente' });
        }
        const customerId = String(((_a = req.params) === null || _a === void 0 ? void 0 : _a.id) || '').trim();
        if (!customerId)
            return res.status(400).json({ message: 'ID de cliente requerido' });
        const customer = yield (0, db_1.get)(`SELECT c.id, c.business_name, c.name, c.seller_id, u.name AS seller_name
       FROM customers c
       LEFT JOIN users u ON u.id = c.seller_id
       WHERE c.id = ?`, [customerId]);
        if (!customer)
            return res.status(404).json({ message: 'Cliente no encontrado' });
        if (authUser.role === 'SELLER' && customer.seller_id !== authUser.id) {
            return res.status(403).json({ message: 'Solo podés ver clientes asignados a tu usuario' });
        }
        const summary = yield buildCustomerFinancialSummary(customerId);
        return res.json(Object.assign({ customerId: customer.id, customerName: (_c = (_b = customer.business_name) !== null && _b !== void 0 ? _b : customer.name) !== null && _c !== void 0 ? _c : 'Cliente', sellerName: (_e = (_d = customer.seller_name) !== null && _d !== void 0 ? _d : customer.seller_id) !== null && _e !== void 0 ? _e : null }, summary));
    }
    catch (error) {
        console.error('getCustomerFinancialSummary:', error);
        return res.status(500).json({ message: 'Error obteniendo saldo de facturas y recibos' });
    }
});
exports.getCustomerFinancialSummary = getCustomerFinancialSummary;
/** Exporta Excel del saldo por facturas/NC/recibos para un cliente. */
const exportCustomerFinancialSummaryXlsx = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const authUser = req.user;
        if (!authUser || !roleCanViewSaldos(authUser.role)) {
            return res.status(403).json({ message: 'Sin permiso para exportar saldo del cliente' });
        }
        const customerId = String(((_a = req.params) === null || _a === void 0 ? void 0 : _a.id) || '').trim();
        if (!customerId)
            return res.status(400).json({ message: 'ID de cliente requerido' });
        const customer = yield (0, db_1.get)(`SELECT c.id, c.business_name, c.name, c.seller_id, u.name AS seller_name
       FROM customers c
       LEFT JOIN users u ON u.id = c.seller_id
       WHERE c.id = ?`, [customerId]);
        if (!customer)
            return res.status(404).json({ message: 'Cliente no encontrado' });
        if (authUser.role === 'SELLER' && customer.seller_id !== authUser.id) {
            return res.status(403).json({ message: 'Solo podés exportar clientes asignados a tu usuario' });
        }
        const summary = yield buildCustomerFinancialSummary(customerId);
        const wb = new exceljs_1.default.Workbook();
        wb.creator = 'LupoHub';
        wb.created = new Date();
        const ws = wb.addWorksheet('Saldo cliente');
        ws.columns = [
            { header: 'Sección', key: 'section', width: 20 },
            { header: 'Fecha', key: 'fecha', width: 14 },
            { header: 'Tipo', key: 'tipo', width: 12 },
            { header: 'Comprobante', key: 'comprobante', width: 24 },
            { header: 'Pedido', key: 'orderId', width: 18 },
            { header: 'Debe', key: 'debe', width: 14 },
            { header: 'Haber', key: 'haber', width: 14 },
            { header: 'Saldo', key: 'saldo', width: 14 },
            { header: 'Detalle', key: 'detalle', width: 42 }
        ];
        ws.getRow(1).font = { bold: true };
        ws.views = [{ state: 'frozen', ySplit: 1 }];
        ws.addRow({
            section: 'CLIENTE',
            comprobante: customer.id,
            detalle: `${customer.business_name || customer.name || 'Cliente'} | Vendedor: ${customer.seller_name || customer.seller_id || 'N/A'}`
        });
        ws.addRow({
            section: 'RESUMEN',
            tipo: 'SALDO',
            debe: summary.totalFacturas,
            haber: summary.totalNc + summary.totalRecibos,
            saldo: summary.saldoPendiente,
            detalle: `Facturas: ${summary.totalFacturas.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | NC: ${summary.totalNc.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | Recibos: ${summary.totalRecibos.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        });
        ws.addRow({});
        let running = 0;
        for (const m of summary.movements) {
            running = Math.round((running + m.debe - m.haber) * 100) / 100;
            ws.addRow({
                section: 'MOVIMIENTO',
                fecha: m.fecha ? new Date(m.fecha) : null,
                tipo: m.tipo,
                comprobante: m.comprobante,
                orderId: (_b = m.orderId) !== null && _b !== void 0 ? _b : '',
                debe: m.debe,
                haber: m.haber,
                saldo: running,
                detalle: m.detalle
            });
        }
        ws.getColumn('B').numFmt = 'dd/mm/yyyy';
        ws.getColumn('F').numFmt = '#,##0.00';
        ws.getColumn('G').numFmt = '#,##0.00';
        ws.getColumn('H').numFmt = '#,##0.00';
        const out = yield wb.xlsx.writeBuffer();
        const buf = Buffer.from(out instanceof ArrayBuffer ? new Uint8Array(out) : new Uint8Array(out));
        const filename = `saldo_facturas_recibos_${(customer.business_name || customer.name || customer.id).toString().replace(/[^\w\-]+/g, '_').slice(0, 40)}_${new Date().toISOString().slice(0, 10)}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(buf);
    }
    catch (error) {
        console.error('exportCustomerFinancialSummaryXlsx:', error);
        return res.status(500).json({ message: 'Error exportando saldo de facturas y recibos' });
    }
});
exports.exportCustomerFinancialSummaryXlsx = exportCustomerFinancialSummaryXlsx;
/** Exporta en Excel el detalle del cliente como un único sistema de movimientos, filtrable por fecha. */
const exportCustomerDetailXlsx = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    try {
        const authUser = req.user;
        if (!authUser || !roleCanViewSaldos(authUser.role)) {
            return res.status(403).json({ message: 'Sin permiso para exportar detalle de cliente' });
        }
        const customerId = String(((_a = req.params) === null || _a === void 0 ? void 0 : _a.id) || '').trim();
        if (!customerId)
            return res.status(400).json({ message: 'ID de cliente requerido' });
        const customer = yield (0, db_1.get)(`SELECT c.id, c.business_name, c.name, c.seller_id, u.name AS seller_name
       FROM customers c
       LEFT JOIN users u ON u.id = c.seller_id
       WHERE c.id = ?`, [customerId]);
        if (!customer)
            return res.status(404).json({ message: 'Cliente no encontrado' });
        if (authUser.role === 'SELLER' && customer.seller_id !== authUser.id) {
            return res.status(403).json({ message: 'Solo podés exportar clientes asignados a tu usuario' });
        }
        const from = (_c = (_b = req.query) === null || _b === void 0 ? void 0 : _b.from) === null || _c === void 0 ? void 0 : _c.trim();
        const to = (_e = (_d = req.query) === null || _d === void 0 ? void 0 : _d.to) === null || _e === void 0 ? void 0 : _e.trim();
        const entriesWhere = ['e.customer_id = ?'];
        const entriesParams = [customerId];
        if (from) {
            entriesWhere.push('e.line_date >= ?');
            entriesParams.push(from);
        }
        if (to) {
            entriesWhere.push('e.line_date <= ?');
            entriesParams.push(to);
        }
        const entries = yield (0, db_1.query)(`SELECT e.line_order, e.line_date, e.tipo, e.numero, e.importe, e.saldo, e.detalle
       FROM customer_multimedia_entries e
       WHERE ${entriesWhere.join(' AND ')}
       ORDER BY e.line_date ASC, e.line_order ASC`, entriesParams);
        const ordersWhere = ['o.customer_id = ?'];
        const ordersParams = [customerId];
        if (from) {
            ordersWhere.push('o.date >= ?');
            ordersParams.push(from);
        }
        if (to) {
            ordersWhere.push('o.date <= ?');
            ordersParams.push(to);
        }
        const ordersRows = yield (0, db_1.query)(`SELECT o.id, o.date, o.status, o.total, o.payment_status
       FROM orders o
       WHERE ${ordersWhere.join(' AND ')}
       ORDER BY o.date DESC, o.id DESC`, ordersParams);
        const paymentsWhere = ['p.customer_id = ?'];
        const paymentsParams = [customerId];
        if (from) {
            paymentsWhere.push('p.date >= ?');
            paymentsParams.push(from);
        }
        if (to) {
            paymentsWhere.push('p.date <= ?');
            paymentsParams.push(to);
        }
        const paymentsRows = yield (0, db_1.query)(`SELECT p.date, p.receipt_number, p.amount, p.notes, p.invoice_id, p.order_id
       FROM payments p
       WHERE ${paymentsWhere.join(' AND ')}
       ORDER BY p.date DESC, p.created_at DESC`, paymentsParams);
        // Mismo criterio de la tarjeta "Saldo pendiente unificado" (sin filtro por fecha).
        const orderAgg = yield (0, db_1.get)(`SELECT ROUND(COALESCE(SUM(ROUND(GREATEST(0, o.total - COALESCE(cn.cn_total, 0)) * 1.21, 2)), 0), 2) AS cargos
       FROM orders o
       LEFT JOIN (
         SELECT order_id, SUM(amount_credited) AS cn_total
         FROM credit_notes
         GROUP BY order_id
       ) cn ON cn.order_id = o.id
       WHERE o.customer_id = ?
         AND o.payment_status = 'pendiente'
         AND o.status NOT IN ('Cancelado', 'Borrador')
         AND (o.archived = 0 OR o.archived IS NULL)`, [customerId]);
        const multimediaAgg = yield (0, db_1.get)(`SELECT CAST(COALESCE(
         (SELECT CAST(e_lo.saldo AS DECIMAL(16,2))
          FROM customer_multimedia_entries e_lo
          WHERE e_lo.customer_id = ?
          ORDER BY e_lo.line_order DESC
          LIMIT 1),
         (SELECT CAST(e2.saldo AS DECIMAL(16,2))
          FROM customer_multimedia_entries e2
          WHERE e2.customer_id = ? AND e2.saldo IS NOT NULL
          ORDER BY e2.line_order DESC
          LIMIT 1),
         0
       ) AS DECIMAL(16,2)) AS multimediaSaldo`, [customerId, customerId]);
        const paymentsAgg = yield (0, db_1.get)(`SELECT ROUND(COALESCE(SUM(amount), 0), 2) AS totalPagos
       FROM payments
       WHERE customer_id = ?`, [customerId]);
        const orderCargosPendientes = Number((orderAgg === null || orderAgg === void 0 ? void 0 : orderAgg.cargos) || 0);
        const multimediaSaldo = Number((multimediaAgg === null || multimediaAgg === void 0 ? void 0 : multimediaAgg.multimediaSaldo) || 0);
        const totalPagos = Number((paymentsAgg === null || paymentsAgg === void 0 ? void 0 : paymentsAgg.totalPagos) || 0);
        const saldoUnificado = Math.round(Math.max(0, orderCargosPendientes + multimediaSaldo - totalPagos) * 100) / 100;
        const wb = new exceljs_1.default.Workbook();
        wb.creator = 'LupoHub';
        wb.created = new Date();
        const ws = wb.addWorksheet('Detalle cliente');
        ws.columns = [
            { header: 'Sección', key: 'section', width: 20 },
            { header: 'Fecha', key: 'fecha', width: 14 },
            { header: 'Movimiento', key: 'tipo', width: 20 },
            { header: 'Referencia', key: 'numero', width: 22 },
            { header: 'Monto', key: 'importe', width: 16 },
            { header: 'Detalle', key: 'detalle', width: 42 }
        ];
        ws.getRow(1).font = { bold: true };
        ws.views = [{ state: 'frozen', ySplit: 1 }];
        ws.addRow({
            section: 'CLIENTE',
            fecha: '',
            tipo: '',
            numero: customer.id,
            importe: '',
            detalle: `${customer.business_name || customer.name || 'Cliente'} | Vendedor: ${customer.seller_name || customer.seller_id || 'N/A'}`
        });
        ws.addRow({ section: '', fecha: '', tipo: '', numero: '', importe: '', detalle: '' });
        ws.addRow({
            section: 'RESUMEN',
            fecha: '',
            tipo: 'SALDO UNIFICADO',
            numero: '',
            importe: saldoUnificado,
            detalle: `Pedidos: ${orderCargosPendientes.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | Cuenta importada: ${multimediaSaldo.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | Recibos: ${totalPagos.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | El detalle inferior muestra movimientos, no saldo histórico acumulado.`
        });
        ws.addRow({ section: '', fecha: '', tipo: '', numero: '', importe: '', detalle: '' });
        const timelineRows = [];
        const normalizeDateKey = (d) => {
            if (!d || Number.isNaN(d.getTime()))
                return '';
            return d.toISOString().slice(0, 10);
        };
        const normalizeNumberKey = (v) => String(v || '').trim().toUpperCase();
        const normalizeAmountKey = (v) => Number(v || 0).toFixed(2);
        const isReceiptType = (tipo) => {
            const t = String(tipo || '').trim().toUpperCase();
            return t === 'REC' || t === 'RECIBO';
        };
        const normalizeUnifiedType = (tipo) => {
            const t = String(tipo || '').trim().toUpperCase();
            if (t === 'FAC' || t === 'FACTURA')
                return 'CARGO';
            if (t === 'REC' || t === 'RECIBO')
                return 'PAGO';
            return t || '';
        };
        for (const e of entries) {
            const fecha = e.line_date ? new Date(e.line_date) : null;
            const ts = fecha && !Number.isNaN(fecha.getTime()) ? fecha.getTime() : Number.MAX_SAFE_INTEGER;
            timelineRows.push({
                section: 'SISTEMA',
                fecha,
                tipo: normalizeUnifiedType(e.tipo),
                numero: (_f = e.numero) !== null && _f !== void 0 ? _f : '',
                importe: e.importe != null ? Number(e.importe) : null,
                // En modo unificado no mostramos saldo histórico por línea importada.
                saldo: null,
                detalle: (_g = e.detalle) !== null && _g !== void 0 ? _g : '',
                sortTs: ts,
                sortSeq: Number(e.line_order || 0),
                sortNumero: String(e.numero || '')
            });
        }
        for (const o of ordersRows) {
            const fecha = o.date ? new Date(o.date) : null;
            const ts = fecha && !Number.isNaN(fecha.getTime()) ? fecha.getTime() : Number.MAX_SAFE_INTEGER;
            timelineRows.push({
                section: 'SISTEMA',
                fecha,
                tipo: `CARGO${o.status ? ` (${o.status})` : ''}`,
                numero: (_h = o.id) !== null && _h !== void 0 ? _h : '',
                importe: Number(o.total || 0),
                saldo: null,
                detalle: `Cobro: ${o.payment_status || 'pendiente'}`,
                sortTs: ts,
                sortSeq: 1000000,
                sortNumero: String(o.id || '')
            });
        }
        for (const p of paymentsRows) {
            const fecha = p.date ? new Date(p.date) : null;
            const ts = fecha && !Number.isNaN(fecha.getTime()) ? fecha.getTime() : Number.MAX_SAFE_INTEGER;
            timelineRows.push({
                section: 'SISTEMA',
                fecha,
                tipo: 'PAGO',
                numero: (_j = p.receipt_number) !== null && _j !== void 0 ? _j : '',
                importe: Number(p.amount || 0),
                saldo: null,
                detalle: `Factura: ${p.invoice_id || '-'} | Pedido: ${p.order_id || '-'}${p.notes ? ` | ${p.notes}` : ''}`,
                sortTs: ts,
                sortSeq: 2000000,
                sortNumero: String(p.receipt_number || '')
            });
        }
        // Evitar duplicados de PAGO (importado + sistema) por misma fecha/número/importe.
        // Se prioriza el registro del sistema (sortSeq mayor, detalle más trazable).
        const paymentByKey = new Map();
        const nonPaymentRows = [];
        for (const row of timelineRows) {
            if (row.tipo !== 'PAGO') {
                nonPaymentRows.push(row);
                continue;
            }
            const key = [
                normalizeDateKey(row.fecha),
                normalizeNumberKey(row.numero),
                normalizeAmountKey(row.importe)
            ].join('|');
            const existing = paymentByKey.get(key);
            if (!existing || row.sortSeq > existing.sortSeq) {
                paymentByKey.set(key, row);
            }
        }
        const dedupedPaymentRows = Array.from(paymentByKey.values());
        timelineRows.length = 0;
        timelineRows.push(...nonPaymentRows, ...dedupedPaymentRows);
        timelineRows.sort((a, b) => {
            if (a.sortTs !== b.sortTs)
                return a.sortTs - b.sortTs;
            if (a.sortSeq !== b.sortSeq)
                return a.sortSeq - b.sortSeq;
            return a.sortNumero.localeCompare(b.sortNumero);
        });
        for (const row of timelineRows) {
            ws.addRow({
                section: row.section,
                fecha: row.fecha,
                tipo: row.tipo,
                numero: row.numero,
                importe: row.importe,
                detalle: row.detalle
            });
        }
        ws.getColumn('B').numFmt = 'dd/mm/yyyy';
        ws.getColumn('E').numFmt = '#,##0.00';
        const out = yield wb.xlsx.writeBuffer();
        const buf = Buffer.from(out instanceof ArrayBuffer ? new Uint8Array(out) : new Uint8Array(out));
        const filename = `cliente_detalle_${(customer.business_name || customer.name || customer.id).toString().replace(/[^\w\-]+/g, '_').slice(0, 40)}_${new Date().toISOString().slice(0, 10)}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(buf);
    }
    catch (error) {
        console.error('exportCustomerDetailXlsx:', error);
        return res.status(500).json({ message: 'Error exportando detalle del cliente' });
    }
});
exports.exportCustomerDetailXlsx = exportCustomerDetailXlsx;
