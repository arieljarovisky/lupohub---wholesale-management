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
exports.exportCustomerDetailXlsx = exports.exportCustomerFinancialSummaryXlsx = exports.getCustomerFinancialSummary = exports.clearDispatchedPendingsForCustomer = exports.restoreAllLupohubInvoices = exports.restoreCustomerAfipInvoices = exports.adjustCustomerSaldo = exports.assignCustomerSellersFromResumen = exports.exportSaldosPendientesMultimediasXlsx = exports.exportSaldosPendientesByCustomerSheetsXlsx = exports.exportSaldosMovimientosSistemaXlsx = exports.exportSaldosPendientesDetalleXlsx = exports.exportSaldosPendientesCsv = exports.getCarteraTotals = exports.getSaldosPendientes = exports.bulkUpdateCustomerFields = exports.exportCustomersBulkUpdateXlsx = exports.bulkUpdateCuit = exports.importCustomers = exports.deleteCustomer = exports.attachUserToCustomer = exports.updateCustomer = exports.createCustomer = exports.exportCustomersBySheetsXlsx = exports.exportCustomersIndividualXlsx = exports.getCustomers = void 0;
exports.queryCarteraTotalsForCustomer = queryCarteraTotalsForCustomer;
const XLSX = __importStar(require("xlsx"));
const exceljs_1 = __importDefault(require("exceljs"));
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
const multimediaHistorialExcel_1 = require("../utils/multimediaHistorialExcel");
const cityNormalize_1 = require("../utils/cityNormalize");
const orderPaymentBalance_service_1 = require("../services/orderPaymentBalance.service");
const afip_service_1 = require("../services/afip.service");
const orderPricing_1 = require("../config/orderPricing");
const carteraImportedSql_1 = require("../sql/carteraImportedSql");
const customerOpeningBalance_1 = require("../sql/customerOpeningBalance");
function parseDeliveryAddressesFromRow(raw) {
    var _a, _b, _c;
    if (raw == null || raw === '')
        return [];
    try {
        const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!Array.isArray(arr))
            return [];
        const out = [];
        for (const it of arr) {
            if (!it || typeof it !== 'object')
                continue;
            const address = String((_a = it.address) !== null && _a !== void 0 ? _a : '').trim();
            if (!address)
                continue;
            const id = String((_b = it.id) !== null && _b !== void 0 ? _b : '').trim() || (0, uuid_1.v4)();
            out.push({
                id,
                label: (String((_c = it.label) !== null && _c !== void 0 ? _c : 'Sucursal').trim() || 'Sucursal'),
                address,
                city: (0, cityNormalize_1.canonicalizeCityInput)(it.city) || '',
            });
        }
        return out;
    }
    catch (_d) {
        return [];
    }
}
/** Serializa direcciones de sucursal para `customers.delivery_addresses` (TEXT JSON). */
function normalizeDeliveryAddressesForDb(input) {
    var _a, _b, _c;
    if (input === undefined || input === null)
        return null;
    if (!Array.isArray(input))
        return null;
    const cleaned = [];
    for (const raw of input) {
        if (!raw || typeof raw !== 'object')
            continue;
        const address = String((_a = raw.address) !== null && _a !== void 0 ? _a : '').trim();
        if (!address)
            continue;
        const id = String((_b = raw.id) !== null && _b !== void 0 ? _b : '').trim() || (0, uuid_1.v4)();
        cleaned.push({
            id,
            label: (String((_c = raw.label) !== null && _c !== void 0 ? _c : 'Sucursal').trim() || 'Sucursal'),
            address,
            city: (0, cityNormalize_1.canonicalizeCityInput)(raw.city) || '',
        });
    }
    return cleaned.length ? JSON.stringify(cleaned) : null;
}
/** Detecta NC por leyenda en el comprobante (import Tango, texto libre en recibo, etc.). */
function comprobanteIndicaNotaCredito(comp) {
    const u = String(comp !== null && comp !== void 0 ? comp : '')
        .trim()
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    if (!u)
        return false;
    if (u.includes('NOTA DE CREDITO'))
        return true;
    if (u.includes('N/C') || u.includes('N / C'))
        return true;
    // Comprobantes tipo AFIP: "NC A 00002-00001234", "NC B0002..."
    if (/^NC\s+[ABCM](\s|\d|-)/.test(u) || /\bNC\s+[ABCM]\s*\d/.test(u))
        return true;
    return false;
}
/**
 * Texto de columna "Tipo" en exports de saldos (Detalle clientes / Detalle).
 * Prioriza tipo explícito; si el comprobante describe una NC pero el tipo vino como RECIBO/FACTURA, corrige la etiqueta.
 */
function labelTipoSaldoExporter(m) {
    var _a, _b;
    const tipo = String((_a = m.tipo) !== null && _a !== void 0 ? _a : '').trim();
    const comp = String((_b = m.comprobante) !== null && _b !== void 0 ? _b : '');
    if (tipo === 'NOTA_CREDITO')
        return 'NOTA DE CREDITO';
    if (tipo === 'NOTA_CREDITO_IMPORTADA')
        return 'NOTA DE CREDITO (import.)';
    if (tipo === 'NOTA_DEBITO_IMPORTADA')
        return 'NOTA DE DEBITO (import.)';
    if (tipo === 'PEDIDO')
        return 'PEDIDO (sin factura)';
    if (comprobanteIndicaNotaCredito(comp)) {
        if (tipo === 'RECIBO_IMPORTADO' ||
            tipo === 'FACTURA_IMPORTADA' ||
            tipo === 'MOV_IMPORTADO') {
            return 'NOTA DE CREDITO (import.)';
        }
        if (tipo === 'RECIBO' || tipo === 'FACTURA') {
            return 'NOTA DE CREDITO';
        }
    }
    if (tipo === 'FACTURA_IMPORTADA')
        return 'FACTURA';
    if (tipo === 'RECIBO_IMPORTADO')
        return 'RECIBO';
    if (tipo === 'MOV_IMPORTADO')
        return 'MOV.';
    return tipo;
}
/**
 * Recorta el detalle desde la última vez que el saldo corrido quedó en ~0
 * (cliente al día). Si nunca llegó a cero, devuelve todo el historial.
 */
function trimMovementsSinceLastZeroBalance(movs, syntheticOpening = 0) {
    const sorted = [...movs].sort((a, b) => {
        const da = new Date(a.fecha || 0).getTime() || 0;
        const db = new Date(b.fecha || 0).getTime() || 0;
        if (da !== db)
            return da - db;
        return String(a.comprobante || '').localeCompare(String(b.comprobante || ''), 'es');
    });
    let running = Math.round((Number(syntheticOpening) || 0) * 100) / 100;
    /** Índice del movimiento tras el cual el saldo quedó en cero; -1 = ya estaba en cero al inicio. */
    let lastZeroAfterIdx = Math.abs(running) <= 0.005 ? -1 : Number.NaN;
    for (let i = 0; i < sorted.length; i += 1) {
        running = Math.round((running + Number(sorted[i].debe || 0) - Number(sorted[i].haber || 0)) * 100) / 100;
        if (Math.abs(running) <= 0.005)
            lastZeroAfterIdx = i;
    }
    if (!Number.isFinite(lastZeroAfterIdx)) {
        return { movs: sorted, startSaldo: Math.round((Number(syntheticOpening) || 0) * 100) / 100, cutAtZero: false };
    }
    if (lastZeroAfterIdx === sorted.length - 1) {
        return { movs: [], startSaldo: 0, cutAtZero: true };
    }
    return {
        movs: sorted.slice(lastZeroAfterIdx + 1),
        startSaldo: 0,
        cutAtZero: true
    };
}
function parseSellerCommissionPercentage(v) {
    if (v === null || v === undefined || v === '')
        return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100)
        return null;
    return Math.round(n * 100) / 100;
}
function toCustomer(row, transportes) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w;
    const sellerCommissionPct = row.seller_commission_percentage != null ? parseSellerCommissionPercentage(row.seller_commission_percentage) : null;
    return {
        id: row.id,
        sellerId: (_a = row.seller_id) !== null && _a !== void 0 ? _a : '',
        sellerCommissionPercentage: sellerCommissionPct !== null && sellerCommissionPct !== void 0 ? sellerCommissionPct : undefined,
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
        isExportClient: Number(row.is_export_client || 0) === 1,
        exportDstCmp: row.export_dst_cmp != null ? Number(row.export_dst_cmp) : undefined,
        exportCountryName: (_p = row.export_country_name) !== null && _p !== void 0 ? _p : undefined,
        foreignTaxId: (_q = row.foreign_tax_id) !== null && _q !== void 0 ? _q : undefined,
        exportCuitPaisCliente: row.export_cuit_pais_cliente != null ? Number(row.export_cuit_pais_cliente) : undefined,
        priceListId: (_r = row.price_list_id) !== null && _r !== void 0 ? _r : undefined,
        legacyCode: (_s = row.legacy_code) !== null && _s !== void 0 ? _s : undefined,
        accountZone: (_t = row.account_zone) !== null && _t !== void 0 ? _t : undefined,
        accountSellerLabel: (_u = row.account_seller_label) !== null && _u !== void 0 ? _u : undefined,
        shouldRetainIibb: Number(row.should_retain_iibb || 0) === 1,
        agipPadronPeriod: (_v = row.agip_padron_period) !== null && _v !== void 0 ? _v : undefined,
        iibbAlicuota: row.iibb_alicuota != null ? Number(row.iibb_alicuota) : undefined,
        transportes: transportes !== null && transportes !== void 0 ? transportes : [],
        deliveryAddresses: parseDeliveryAddressesFromRow(row.delivery_addresses),
        openingBalance: row.opening_balance != null && row.opening_balance !== ''
            ? Math.round(Number(row.opening_balance) * 100) / 100
            : undefined,
        openingBalanceDate: (_w = (0, customerOpeningBalance_1.normalizeYmdDate)(row.opening_balance_date)) !== null && _w !== void 0 ? _w : undefined
    };
}
/** Listar todos los clientes (camelCase para el frontend) con transportes asignados. */
const getCustomers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const authUser = req.user;
        const sellerFilter = (authUser === null || authUser === void 0 ? void 0 : authUser.role) === 'SELLER' ? ' WHERE seller_id = ?' : '';
        const params = (authUser === null || authUser === void 0 ? void 0 : authUser.role) === 'SELLER' ? [authUser.id] : [];
        const agipTable = yield (0, db_1.get)(`SELECT COUNT(*) AS cnt FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'agip_padron_alicuotas'`);
        const agipExists = Number((agipTable === null || agipTable === void 0 ? void 0 : agipTable.cnt) || 0) > 0;
        const agipSelect = agipExists
            ? `,
         CASE
           WHEN apc.cuit IS NULL THEN 0
           ELSE 1
         END AS should_retain_iibb,
         apm.period_yyyymm AS agip_padron_period,
         apc.alicuota AS iibb_alicuota`
            : `,
         0 AS should_retain_iibb,
         NULL AS agip_padron_period,
         NULL AS iibb_alicuota`;
        const agipJoin = agipExists
            ? `
       LEFT JOIN (
         SELECT MAX(period_yyyymm) AS period_yyyymm
         FROM agip_padron_alicuotas
       ) apm ON 1=1
       LEFT JOIN agip_padron_alicuotas apc
         ON apc.period_yyyymm = apm.period_yyyymm
        AND apc.cuit = REPLACE(REPLACE(REPLACE(COALESCE(c.cuit, ''), '-', ''), '.', ''), ' ', '')`
            : '';
        const rows = yield (0, db_1.query)(`SELECT c.id, c.seller_id, c.seller_commission_percentage, c.user_id, c.name, c.business_name, c.email, c.address, c.city, c.cuit, c.phone, c.transport_number, c.remito_number, c.sale_condition, c.condicion_iva, c.price_list_id,
              c.legacy_code, c.account_zone, c.account_seller_label, c.delivery_addresses,
              c.opening_balance, c.opening_balance_date,
              c.is_export_client, c.export_dst_cmp, c.export_country_name, c.foreign_tax_id, c.export_cuit_pais_cliente
              ${agipSelect}
       FROM customers c
       ${agipJoin}
       ${sellerFilter} ORDER BY c.business_name ASC, c.name ASC`, params);
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
             ${(0, orderPricing_1.sqlInvoiceAmountFromOrderTotal)()} AS importe
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
                ws.getCell(`B${rowCursor}`).value = (0, customerOpeningBalance_1.ymdToExcelDate)(o.date);
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
                ws.getCell(`A${rowCursor}`).value = (0, customerOpeningBalance_1.ymdToExcelDate)(b.fecha);
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
                ws.getCell(`A${rowCursor}`).value = (0, customerOpeningBalance_1.ymdToExcelDate)(p.date);
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
    try {
        const body = req.body;
        const name = ((_a = body.name) !== null && _a !== void 0 ? _a : '').toString().trim();
        const businessName = ((_b = body.businessName) !== null && _b !== void 0 ? _b : '').toString().trim();
        let email = ((_c = body.email) !== null && _c !== void 0 ? _c : '').toString().trim();
        if (!businessName && !name) {
            return res.status(400).json({ message: 'Razón social o nombre de contacto es requerido' });
        }
        const id = body.id && body.id.trim() ? body.id.trim() : (0, uuid_1.v4)();
        // Cliente ocasional / sin ficha previa: email sintético si no se informa
        if (!email) {
            email = `ocasional+${id.replace(/-/g, '').slice(0, 12)}@lupohub.local`;
        }
        const sellerId = ((_d = body.sellerId) === null || _d === void 0 ? void 0 : _d.trim()) || null;
        const address = ((_e = body.address) !== null && _e !== void 0 ? _e : '').toString().trim() || null;
        const city = (0, cityNormalize_1.canonicalizeCityInput)(body.city);
        const cuit = ((_f = body.cuit) !== null && _f !== void 0 ? _f : '').toString().trim() || null;
        const phone = ((_g = body.phone) !== null && _g !== void 0 ? _g : '').toString().trim() || null;
        const transportNumber = ((_h = body.transportNumber) !== null && _h !== void 0 ? _h : '').toString().trim() || null;
        const remitoNumber = ((_j = body.remitoNumber) !== null && _j !== void 0 ? _j : '').toString().trim() || null;
        const saleCondition = ((_k = body.saleCondition) !== null && _k !== void 0 ? _k : '').toString().trim() || null;
        const condicionIva = ((_l = body.condicionIva) !== null && _l !== void 0 ? _l : '').toString().trim() || null;
        const priceListId = ((_m = body.priceListId) === null || _m === void 0 ? void 0 : _m.trim()) || null;
        const legacyCode = ((_o = body.legacyCode) !== null && _o !== void 0 ? _o : '').toString().trim() || null;
        const accountZone = ((_p = body.accountZone) !== null && _p !== void 0 ? _p : '').toString().trim() || null;
        const accountSellerLabel = ((_q = body.accountSellerLabel) !== null && _q !== void 0 ? _q : '').toString().trim() || null;
        const deliveryJson = normalizeDeliveryAddressesForDb(body.deliveryAddresses);
        // Guardar nombre de contacto y razón social en columnas separadas.
        // `customers.name` es NOT NULL en schema: si solo hay razón social, replicarla en name.
        const sqlBusinessName = businessName || name || 'Sin nombre';
        const sqlName = name || sqlBusinessName;
        const sellerCommissionPct = body.sellerCommissionPercentage !== undefined
            ? parseSellerCommissionPercentage(body.sellerCommissionPercentage)
            : null;
        yield (0, db_1.execute)(`INSERT INTO customers (id, seller_id, seller_commission_percentage, name, business_name, email, address, city, cuit, phone, transport_number, remito_number, sale_condition, condicion_iva, price_list_id, legacy_code, account_zone, account_seller_label, delivery_addresses)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, sellerId, sellerCommissionPct, sqlName, sqlBusinessName, email, address, city, cuit, phone, transportNumber, remitoNumber, saleCondition, condicionIva, priceListId, legacyCode, accountZone, accountSellerLabel, deliveryJson]);
        const created = yield (0, db_1.get)(`SELECT id, seller_id, seller_commission_percentage, user_id, name, business_name, email, address, city, cuit, phone, transport_number, remito_number, sale_condition, condicion_iva, price_list_id, legacy_code, account_zone, account_seller_label, delivery_addresses FROM customers WHERE id = ?`, [id]);
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
        const detail = (error === null || error === void 0 ? void 0 : error.sqlMessage) || (error === null || error === void 0 ? void 0 : error.message);
        res.status(500).json({
            message: detail ? `Error creando cliente: ${detail}` : 'Error creando cliente'
        });
    }
});
exports.createCustomer = createCustomer;
/** Actualizar cliente (ej. vendedor, razón social, price_list_id, etc.). */
const updateCustomer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
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
            params.push(body.city != null && String(body.city).trim() ? (0, cityNormalize_1.canonicalizeCityInput)(body.city) : null);
        }
        if (body.cuit !== undefined) {
            updates.push('cuit = ?');
            params.push(((_d = body.cuit) === null || _d === void 0 ? void 0 : _d.trim()) || null);
        }
        if (body.phone !== undefined) {
            updates.push('phone = ?');
            params.push(((_e = body.phone) === null || _e === void 0 ? void 0 : _e.trim()) || null);
        }
        if (body.transportNumber !== undefined) {
            updates.push('transport_number = ?');
            params.push(((_f = body.transportNumber) === null || _f === void 0 ? void 0 : _f.trim()) || null);
        }
        if (body.remitoNumber !== undefined) {
            updates.push('remito_number = ?');
            params.push(((_g = body.remitoNumber) === null || _g === void 0 ? void 0 : _g.trim()) || null);
        }
        if (body.saleCondition !== undefined) {
            updates.push('sale_condition = ?');
            params.push(((_h = body.saleCondition) === null || _h === void 0 ? void 0 : _h.trim()) || null);
        }
        if (body.condicionIva !== undefined) {
            updates.push('condicion_iva = ?');
            params.push(((_j = body.condicionIva) === null || _j === void 0 ? void 0 : _j.trim()) || null);
        }
        if (body.isExportClient !== undefined) {
            updates.push('is_export_client = ?');
            params.push(body.isExportClient ? 1 : 0);
        }
        if (body.exportDstCmp !== undefined) {
            const dst = body.exportDstCmp == null ? null : Number(body.exportDstCmp);
            updates.push('export_dst_cmp = ?');
            params.push(Number.isFinite(dst) ? dst : null);
        }
        if (body.exportCountryName !== undefined) {
            updates.push('export_country_name = ?');
            params.push(((_k = body.exportCountryName) === null || _k === void 0 ? void 0 : _k.trim()) || null);
        }
        if (body.foreignTaxId !== undefined) {
            updates.push('foreign_tax_id = ?');
            params.push(((_l = body.foreignTaxId) === null || _l === void 0 ? void 0 : _l.trim()) || null);
        }
        if (body.exportCuitPaisCliente !== undefined) {
            const cp = body.exportCuitPaisCliente == null ? null : Number(body.exportCuitPaisCliente);
            updates.push('export_cuit_pais_cliente = ?');
            params.push(Number.isFinite(cp) ? cp : null);
        }
        if (body.sellerId !== undefined) {
            updates.push('seller_id = ?');
            params.push(((_m = body.sellerId) === null || _m === void 0 ? void 0 : _m.trim()) || null);
        }
        if (body.sellerCommissionPercentage !== undefined) {
            const pct = parseSellerCommissionPercentage(body.sellerCommissionPercentage);
            if (body.sellerCommissionPercentage != null && pct === null) {
                return res.status(400).json({ message: 'sellerCommissionPercentage debe estar entre 0 y 100' });
            }
            updates.push('seller_commission_percentage = ?');
            params.push(pct);
        }
        if (body.priceListId !== undefined) {
            updates.push('price_list_id = ?');
            params.push(body.priceListId && body.priceListId.trim() ? body.priceListId.trim() : null);
        }
        if (body.legacyCode !== undefined) {
            updates.push('legacy_code = ?');
            params.push(((_o = body.legacyCode) === null || _o === void 0 ? void 0 : _o.trim()) || null);
        }
        if (body.accountZone !== undefined) {
            updates.push('account_zone = ?');
            params.push(((_p = body.accountZone) === null || _p === void 0 ? void 0 : _p.trim()) || null);
        }
        if (body.accountSellerLabel !== undefined) {
            updates.push('account_seller_label = ?');
            params.push(((_q = body.accountSellerLabel) === null || _q === void 0 ? void 0 : _q.trim()) || null);
        }
        if (body.deliveryAddresses !== undefined) {
            updates.push('delivery_addresses = ?');
            params.push(normalizeDeliveryAddressesForDb(body.deliveryAddresses));
        }
        if (body.openingBalance !== undefined || body.openingBalanceDate !== undefined) {
            const user = req.user;
            if (!user || user.role !== 'ADMIN') {
                return res.status(403).json({ message: 'Solo administradores pueden modificar el saldo inicial' });
            }
        }
        if (body.openingBalance !== undefined) {
            const ob = (0, customerOpeningBalance_1.parseOpeningBalanceInput)(body.openingBalance);
            if (body.openingBalance != null && String(body.openingBalance).trim() !== '' && ob === null) {
                return res.status(400).json({ message: 'openingBalance debe ser un importe válido' });
            }
            updates.push('opening_balance = ?');
            params.push(ob);
        }
        if (body.openingBalanceDate !== undefined) {
            const obd = (0, customerOpeningBalance_1.parseOpeningBalanceDateInput)(body.openingBalanceDate);
            if (body.openingBalanceDate != null && body.openingBalanceDate !== '' && obd === null) {
                return res.status(400).json({ message: 'openingBalanceDate debe ser YYYY-MM-DD o DD/MM/YYYY' });
            }
            updates.push('opening_balance_date = ?');
            params.push(obd);
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
        const updated = yield (0, db_1.get)(`SELECT id, seller_id, seller_commission_percentage, user_id, name, business_name, email, address, city, cuit, phone, transport_number, remito_number, sale_condition, condicion_iva, price_list_id, legacy_code, account_zone, account_seller_label, delivery_addresses, opening_balance, opening_balance_date, is_export_client, export_dst_cmp, export_country_name, foreign_tax_id, export_cuit_pais_cliente FROM customers WHERE id = ?`, [id]);
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
        const updated = yield (0, db_1.get)(`SELECT id, seller_id, user_id, name, business_name, email, address, city, cuit, phone, transport_number, remito_number, sale_condition, condicion_iva, price_list_id, legacy_code, account_zone, account_seller_label, delivery_addresses FROM customers WHERE id = ?`, [id]);
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
    var _a, _b, _c, _d, _e, _f, _g, _h;
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
            const city = (0, cityNormalize_1.canonicalizeCityInput)(r.city);
            const cuit = ((_f = r.cuit) !== null && _f !== void 0 ? _f : '').toString().trim() || null;
            const cuitSolo = (cuit || '').replace(/\D/g, '');
            const phone = ((_g = r.phone) !== null && _g !== void 0 ? _g : '').toString().trim() || null;
            const condicionIva = ((_h = r.condicionIva) !== null && _h !== void 0 ? _h : '').toString().trim() || null;
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
/** Busca cliente por CUIT, código legacy, email o razón social (opcionalmente acotado a vendedor). */
function findCustomerIdForBulkImport(identifiers) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const sellerWhere = identifiers.sellerId ? ' AND seller_id = ?' : '';
        const sellerParam = identifiers.sellerId ? [identifiers.sellerId] : [];
        const cuitDigits = ((_a = identifiers.cuit) !== null && _a !== void 0 ? _a : '').toString().replace(/\D/g, '');
        if (cuitDigits) {
            const row = yield (0, db_1.get)(`SELECT id FROM customers
       WHERE REPLACE(REPLACE(REPLACE(COALESCE(cuit, ''), '-', ''), '.', ''), ' ', '') = ?
       ${sellerWhere}
       LIMIT 1`, [cuitDigits, ...sellerParam]);
            if (row)
                return row.id;
        }
        const legacyCode = ((_b = identifiers.legacyCode) !== null && _b !== void 0 ? _b : '').toString().trim();
        if (legacyCode) {
            const padded = (0, multimediaHistorialExcel_1.padLegacyCode)(legacyCode);
            const row = yield (0, db_1.get)(`SELECT id FROM customers WHERE legacy_code = ? OR legacy_code = ?${sellerWhere} LIMIT 1`, [legacyCode, padded, ...sellerParam]);
            if (row)
                return row.id;
        }
        const email = ((_c = identifiers.email) !== null && _c !== void 0 ? _c : '').toString().trim();
        if (email) {
            const row = yield (0, db_1.get)(`SELECT id FROM customers WHERE LOWER(TRIM(email)) = LOWER(?)${sellerWhere} LIMIT 1`, [email, ...sellerParam]);
            if (row)
                return row.id;
        }
        const businessName = ((_d = identifiers.businessName) !== null && _d !== void 0 ? _d : '').toString().trim();
        if (businessName) {
            const row = yield (0, db_1.get)(`SELECT id FROM customers WHERE TRIM(business_name) = ?${sellerWhere} LIMIT 1`, [businessName, ...sellerParam]);
            if (row)
                return row.id;
        }
        return null;
    });
}
const PRICE_LIST_CLEAR_VALUES = new Set(['sin lista', '(ninguna)', 'ninguna', '-', '—', 'n/a', 'na']);
function resolvePriceListIdFromImport(input, cache) {
    return __awaiter(this, void 0, void 0, function* () {
        const raw = input.trim();
        const cacheKey = raw.toLowerCase();
        if (cache.has(cacheKey))
            return cache.get(cacheKey);
        if (PRICE_LIST_CLEAR_VALUES.has(cacheKey)) {
            cache.set(cacheKey, null);
            return null;
        }
        const byId = yield (0, db_1.get)('SELECT id FROM price_lists WHERE id = ? LIMIT 1', [raw]);
        if (byId) {
            cache.set(cacheKey, byId.id);
            return byId.id;
        }
        const byName = yield (0, db_1.get)('SELECT id FROM price_lists WHERE LOWER(TRIM(name)) = LOWER(?) LIMIT 1', [raw]);
        if (byName) {
            cache.set(cacheKey, byName.id);
            return byName.id;
        }
        cache.set(cacheKey, 'NOT_FOUND');
        return 'NOT_FOUND';
    });
}
/** Exportar Excel para actualización masiva: condición IVA, lista de precios y saldo inicial. */
const exportCustomersBulkUpdateXlsx = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g;
    try {
        const authUser = req.user;
        const isAdmin = (authUser === null || authUser === void 0 ? void 0 : authUser.role) === 'ADMIN';
        const sellerFilter = (authUser === null || authUser === void 0 ? void 0 : authUser.role) === 'SELLER' ? ' WHERE c.seller_id = ?' : '';
        const params = (authUser === null || authUser === void 0 ? void 0 : authUser.role) === 'SELLER' ? [authUser.id] : [];
        const rows = yield (0, db_1.query)(`SELECT
         c.legacy_code,
         c.business_name,
         c.email,
         c.cuit,
         c.condicion_iva,
         pl.name AS price_list_name,
         c.opening_balance,
         c.opening_balance_date
       FROM customers c
       LEFT JOIN price_lists pl ON pl.id = c.price_list_id
       ${sellerFilter}
       ORDER BY c.business_name ASC, c.name ASC`, params);
        const workbook = new exceljs_1.default.Workbook();
        workbook.creator = 'LupoHub';
        workbook.created = new Date();
        const ws = workbook.addWorksheet('Actualización clientes');
        const columns = [
            { header: 'Código legacy', key: 'legacy_code', width: 16 },
            { header: 'Razón social', key: 'business_name', width: 34 },
            { header: 'Email', key: 'email', width: 32 },
            { header: 'CUIT', key: 'cuit', width: 16 },
            { header: 'Condición IVA', key: 'condicion_iva', width: 28 },
            { header: 'Lista de precios', key: 'price_list_name', width: 24 },
        ];
        if (isAdmin) {
            columns.push({ header: 'Saldo inicio', key: 'opening_balance', width: 16 }, { header: 'Fecha saldo inicio', key: 'opening_balance_date', width: 18 });
        }
        ws.columns = columns;
        ws.getRow(1).font = { bold: true };
        ws.views = [{ state: 'frozen', ySplit: 1 }];
        for (const r of rows) {
            const rowData = {
                legacy_code: (_a = r.legacy_code) !== null && _a !== void 0 ? _a : '',
                business_name: (_b = r.business_name) !== null && _b !== void 0 ? _b : '',
                email: (_c = r.email) !== null && _c !== void 0 ? _c : '',
                cuit: (_d = r.cuit) !== null && _d !== void 0 ? _d : '',
                condicion_iva: (_e = r.condicion_iva) !== null && _e !== void 0 ? _e : '',
                price_list_name: (_f = r.price_list_name) !== null && _f !== void 0 ? _f : '',
            };
            if (isAdmin) {
                rowData.opening_balance =
                    r.opening_balance != null && r.opening_balance !== ''
                        ? Math.round(Number(r.opening_balance) * 100) / 100
                        : '';
                rowData.opening_balance_date = (_g = (0, customerOpeningBalance_1.normalizeYmdDate)(r.opening_balance_date)) !== null && _g !== void 0 ? _g : '';
            }
            ws.addRow(rowData);
        }
        const out = yield workbook.xlsx.writeBuffer();
        const buf = Buffer.from(out instanceof ArrayBuffer ? new Uint8Array(out) : new Uint8Array(out));
        const filename = `clientes_actualizacion_masiva_${new Date().toISOString().slice(0, 10)}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(buf);
    }
    catch (error) {
        console.error('exportCustomersBulkUpdateXlsx:', error);
        return res.status(500).json({ message: 'Error exportando plantilla de actualización masiva' });
    }
});
exports.exportCustomersBulkUpdateXlsx = exportCustomersBulkUpdateXlsx;
/** Actualizar condición IVA, lista de precios y saldo inicial en lote (identificador: CUIT, código, email o razón social). */
const bulkUpdateCustomerFields = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    try {
        const authUser = req.user;
        const isAdmin = (authUser === null || authUser === void 0 ? void 0 : authUser.role) === 'ADMIN';
        const sellerScope = (authUser === null || authUser === void 0 ? void 0 : authUser.role) === 'SELLER' ? authUser.id : null;
        const body = req.body;
        const updates = Array.isArray(body.updates) ? body.updates : [];
        let updated = 0;
        let notFound = 0;
        let skipped = 0;
        const errors = [];
        const priceListCache = new Map();
        for (let i = 0; i < updates.length; i++) {
            const u = updates[i];
            const rowNum = i + 1;
            const cuit = ((_a = u.cuit) !== null && _a !== void 0 ? _a : '').toString().trim() || undefined;
            const email = ((_b = u.email) !== null && _b !== void 0 ? _b : '').toString().trim() || undefined;
            const businessName = ((_c = u.businessName) !== null && _c !== void 0 ? _c : '').toString().trim() || undefined;
            const legacyCode = ((_d = u.legacyCode) !== null && _d !== void 0 ? _d : '').toString().trim() || undefined;
            if (!cuit && !email && !businessName && !legacyCode) {
                errors.push({ row: rowNum, message: 'Falta identificador (CUIT, código legacy, email o razón social)' });
                continue;
            }
            const hasCondicionIva = u.condicionIva !== undefined;
            const hasPriceList = u.priceList !== undefined;
            const hasOpeningBalance = u.openingBalance !== undefined;
            const hasOpeningBalanceDate = u.openingBalanceDate !== undefined;
            if (!hasCondicionIva && !hasPriceList && !hasOpeningBalance && !hasOpeningBalanceDate) {
                skipped++;
                continue;
            }
            if ((hasOpeningBalance || hasOpeningBalanceDate) && !isAdmin) {
                errors.push({ row: rowNum, message: 'Solo administradores pueden modificar el saldo inicial' });
                continue;
            }
            const customerId = yield findCustomerIdForBulkImport({
                cuit,
                email,
                businessName,
                legacyCode,
                sellerId: sellerScope,
            });
            if (!customerId) {
                notFound++;
                continue;
            }
            const setClauses = [];
            const params = [];
            if (hasCondicionIva) {
                setClauses.push('condicion_iva = ?');
                params.push(((_e = u.condicionIva) !== null && _e !== void 0 ? _e : '').toString().trim() || null);
            }
            if (hasPriceList) {
                const plRaw = ((_f = u.priceList) !== null && _f !== void 0 ? _f : '').toString().trim();
                if (!plRaw) {
                    setClauses.push('price_list_id = ?');
                    params.push(null);
                }
                else {
                    const plId = yield resolvePriceListIdFromImport(plRaw, priceListCache);
                    if (plId === 'NOT_FOUND') {
                        errors.push({ row: rowNum, message: `Lista de precios no encontrada: "${plRaw}"` });
                        continue;
                    }
                    setClauses.push('price_list_id = ?');
                    params.push(plId);
                }
            }
            if (hasOpeningBalance) {
                const ob = (0, customerOpeningBalance_1.parseOpeningBalanceInput)(u.openingBalance);
                if (u.openingBalance != null && String(u.openingBalance).trim() !== '' && ob === null) {
                    errors.push({ row: rowNum, message: 'Saldo inicio inválido' });
                    continue;
                }
                setClauses.push('opening_balance = ?');
                params.push(ob);
            }
            if (hasOpeningBalanceDate) {
                const obd = (0, customerOpeningBalance_1.parseOpeningBalanceDateInput)(u.openingBalanceDate);
                if (u.openingBalanceDate != null && u.openingBalanceDate !== '' && obd === null) {
                    errors.push({ row: rowNum, message: 'Fecha saldo inicio inválida (use YYYY-MM-DD o DD/MM/YYYY)' });
                    continue;
                }
                setClauses.push('opening_balance_date = ?');
                params.push(obd);
            }
            if (setClauses.length === 0) {
                skipped++;
                continue;
            }
            params.push(customerId);
            yield (0, db_1.execute)(`UPDATE customers SET ${setClauses.join(', ')} WHERE id = ?`, params);
            updated++;
        }
        res.json({ updated, notFound, skipped, errors });
    }
    catch (error) {
        console.error('bulkUpdateCustomerFields:', error);
        res.status(500).json({ message: 'Error actualizando clientes en lote' });
    }
});
exports.bulkUpdateCustomerFields = bulkUpdateCustomerFields;
function roleCanViewSaldos(role) {
    return role === 'ADMIN' || role === 'SELLER' || role === 'WAREHOUSE' || role === 'DEPOSITO';
}
function parseSaldoNumero(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
/** Último saldo de columna en import Multimedia/Tango (arrastre de cuenta). */
/**
 * Pagos cargados por import-seller-commissions (PDF de comisiones): no son cobranza del cliente.
 * Si entran en el saldo, el cliente figura con saldo a favor erróneo.
 */
const SQL_PAYMENT_EXCLUDE_COMMISSION_IMPORT = `(
  (
    COALESCE(p.notes, '') NOT LIKE '%comisión vendedor%'
    AND COALESCE(p.notes, '') NOT LIKE '%comision vendedor%'
  )
  OR EXISTS (SELECT 1 FROM payment_invoices pi_comm WHERE pi_comm.payment_id = p.id)
  OR EXISTS (SELECT 1 FROM payment_orders po_comm WHERE po_comm.payment_id = p.id)
  OR (p.invoice_id IS NOT NULL AND TRIM(COALESCE(p.invoice_id, '')) <> '')
  OR (p.order_id IS NOT NULL AND TRIM(COALESCE(p.order_id, '')) <> '')
)`;
const SQL_PAYMENT_EXCLUDE_COMMISSION_IMPORT_PLAIN = SQL_PAYMENT_EXCLUDE_COMMISSION_IMPORT;
const CARTERA_MM_LAST_SALDO_SUBQUERY = `
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
/**
 * Pagos en Facturación que coinciden con un REC importado (se excluyen de pay deduplicado).
 * Si el arrastre importado (last_saldo) es 0, hay que restarlos igual para no quedar en saldo 0.
 */
function sqlCarteraPagosMatchedImportSubquery(sellerScoped) {
    const sellerWhere = sellerScoped ? ' AND (p.seller_id = ? OR c2.seller_id = ?)' : '';
    return `
    SELECT d.customer_id, SUM(d.amount) AS total_matched
    FROM (
      SELECT
        p.customer_id,
        ROUND(COALESCE(p.amount, 0), 2) AS amount
      FROM payments p
      ${sellerScoped ? 'INNER JOIN customers c2 ON c2.id = p.customer_id' : ''}
      INNER JOIN (
        SELECT
          e.customer_id,
          DATE(e.line_date) AS line_date,
          ROUND(COALESCE(e.importe, 0), 2) AS amount,
          UPPER(
            REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
          ) AS receipt_norm
        FROM customer_multimedia_entries e
        WHERE UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('REC', 'RECIBO', 'PAGO', 'COBRO', 'INGRESO')
          AND TRIM(COALESCE(e.numero, '')) <> ''
        GROUP BY
          e.customer_id,
          DATE(e.line_date),
          ROUND(COALESCE(e.importe, 0), 2),
          UPPER(
            REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
          )
      ) me_rec
        ON me_rec.customer_id = p.customer_id
       AND me_rec.line_date = DATE(p.date)
       AND me_rec.amount = ROUND(COALESCE(p.amount, 0), 2)
       AND me_rec.receipt_norm = CASE
         WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
         ELSE UPPER(
           REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
         )
       END
      WHERE 1=1${sellerWhere}
        AND ${SQL_PAYMENT_EXCLUDE_COMMISSION_IMPORT}
      GROUP BY
        p.customer_id,
        DATE(p.date),
        ROUND(COALESCE(p.amount, 0), 2),
        CASE
          WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
          ELSE UPPER(
            REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
          )
        END
    ) d
    GROUP BY d.customer_id`;
}
/** REC importados sin pago equivalente en Facturación (solo si last_saldo importado es 0). */
const SQL_CARTERA_MM_REC_SIN_PAGO = `
  SELECT e.customer_id, SUM(ROUND(ABS(COALESCE(e.importe, 0)), 2)) AS total_orphan
  FROM customer_multimedia_entries e
  WHERE UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('REC', 'RECIBO', 'PAGO', 'COBRO', 'INGRESO')
    AND TRIM(COALESCE(e.numero, '')) <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM payments p
      WHERE p.customer_id = e.customer_id
        AND DATE(p.date) = DATE(e.line_date)
        AND ROUND(COALESCE(p.amount, 0), 2) = ROUND(ABS(COALESCE(e.importe, 0)), 2)
        AND ${SQL_PAYMENT_EXCLUDE_COMMISSION_IMPORT}
        AND UPPER(
          REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
        ) = CASE
          WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
          ELSE UPPER(
            REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
          )
        END
    )
  GROUP BY e.customer_id`;
/**
 * Neto gravado del pedido (alias `o`): usa `orders.total` o suma de ítems si el total quedó en 0.
 * Tras picking: pickeado si hay; si no, cantidad pedida (alineado con factura AFIP / NC).
 */
const SQL_ORDER_NETO_GRAVADO = `GREATEST(
  COALESCE(o.total, 0),
  COALESCE((
    SELECT SUM(
      ROUND(
        (
          CASE
            WHEN NOT COALESCE(o.no_stock_impact, 0)
              AND o.status IN ('Falta controlar', 'Controlado', 'Despachado')
            THEN
              CASE
                WHEN COALESCE(oi.picked, 0) > 0 THEN LEAST(COALESCE(oi.quantity, 0), COALESCE(oi.picked, 0))
                ELSE COALESCE(oi.quantity, 0)
              END
            ELSE COALESCE(oi.quantity, 0)
          END
        ) * COALESCE(oi.price_at_moment, 0),
        2
      )
    )
    FROM order_items oi
    WHERE oi.order_id = o.id
  ), 0)
)`;
const SQL_ORDER_CARGO_CON_IVA = (0, orderPricing_1.sqlAmountWithIvaFromOrderLines)(SQL_ORDER_NETO_GRAVADO);
const SQL_ORDER_CARGO_PENDIENTE_SUM = `SUM(ROUND((${orderPaymentBalance_service_1.SQL_ORDER_BASE_MINUS_NC})${orderPricing_1.ORDER_PRICES_INCLUDE_IVA ? '' : ` * ${orderPricing_1.IVA_MULTIPLIER}`}, 2))`;
const SQL_ORDER_NC_CREDIT_EXPR = (0, orderPricing_1.sqlNetoAfipToAmountWithIva)(`LEAST(COALESCE(cn.cn_total, 0), (${orderPaymentBalance_service_1.SQL_ORDER_NETO_AFIP}))`);
const SQL_ORDER_NC_CREDIT_SUM = `SUM(${SQL_ORDER_NC_CREDIT_EXPR})`;
const SQL_ORDER_ACTIVE_COND = `o.status NOT IN ('Cancelado', 'Borrador') AND (o.archived = 0 OR o.archived IS NULL)`;
/** Facturas AFIP emitidas (total con IVA + IIBB), desde saldo inicial. Solo punto de venta 21. */
const SQL_CARTERA_AFIP_INVOICES_SUBQUERY = `
  SELECT
    o.customer_id,
    SUM(${(0, orderPricing_1.sqlInvoiceAmountFromOrderTotal)()}) AS fac_iva
  FROM invoices i
  INNER JOIN orders o ON o.id = i.order_id
  INNER JOIN customers co ON co.id = o.customer_id
  WHERE i.punto_venta = 21
    AND ${customerOpeningBalance_1.SQL_OPENING_AFIP_INVOICE_DATE_WHERE}
  GROUP BY o.customer_id
`;
/**
 * NC AFIP (× IVA) que restan del saldo. Solo punto de venta 21.
 * Excluye NC de reemisión IIBB (superseded_by_reinvoice): la factura anterior no figura en cartera
 * porque se actualiza en el mismo registro; solo cuenta la factura nueva.
 */
const SQL_CARTERA_AFIP_NC_SUBQUERY = `
  SELECT
    o.customer_id,
    SUM(${(0, orderPricing_1.sqlNetoAfipToAmountWithIva)('COALESCE(cn.amount_credited, 0)')}) AS nc_iva
  FROM credit_notes cn
  INNER JOIN orders o ON o.id = cn.order_id
  INNER JOIN customers co ON co.id = o.customer_id
  WHERE cn.punto_venta = 21
    AND COALESCE(cn.superseded_by_reinvoice, 0) = 0
    AND ${customerOpeningBalance_1.SQL_OPENING_AFIP_CN_DATE_WHERE}
  GROUP BY o.customer_id
`;
/** Pedidos sin factura con saldo pendiente (desde saldo inicial). */
const SQL_CARTERA_PEDIDOS_SF_SUBQUERY = `
  SELECT
    o.customer_id,
    SUM((${orderPaymentBalance_service_1.SQL_ORDER_SALDO_RESIDUAL})) AS pedidos
  FROM orders o
  INNER JOIN customers co ON co.id = o.customer_id
  LEFT JOIN (${orderPaymentBalance_service_1.SQL_CN_TOTAL_SUBQUERY}) cn ON cn.order_id = o.id
  WHERE ${SQL_ORDER_ACTIVE_COND}
    AND ${orderPaymentBalance_service_1.SQL_ORDER_IN_SALDO_SCOPE}
    AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id)
    AND (${orderPaymentBalance_service_1.SQL_ORDER_SALDO_RESIDUAL}) > 0.005
    AND ${customerOpeningBalance_1.SQL_OPENING_ORDER_DATE_WHERE}
  GROUP BY o.customer_id
`;
/** Recibos sin imputar (solo usado en imputación de pagos, no en saldo cartera). */
const SQL_PAYMENT_UNALLOCATED_COND = `NOT EXISTS (
  SELECT 1 FROM payment_invoices pi WHERE pi.payment_id = p.id
)
AND NOT EXISTS (
  SELECT 1 FROM payment_orders po WHERE po.payment_id = p.id
)
AND TRIM(COALESCE(p.invoice_id, '')) = ''
AND TRIM(COALESCE(p.order_id, '')) = ''`;
/**
 * Saldo = saldo inicial + facturas/pedidos LupoHub − NC − todos los recibos (+ import Tango si aplica).
 * Misma lógica que el saldo corrido del historial (FAC/NC/REC completos, no solo recibos sin imputar).
 */
function carteraSaldoSqlExpr() {
    return `ROUND(
    ${customerOpeningBalance_1.SQL_CUSTOMER_OPENING_BALANCE_EXPR}
    + COALESCE(afip.fac_iva, 0)
    + COALESCE(ped.pedidos, 0)
    + COALESCE(mfac.manual_fac, 0)
    + ${carteraImportedSql_1.SQL_CARTERA_IMPORT_DEBE_EXPR}
    - COALESCE(afipnc.nc_iva, 0)
    - COALESCE(mnc.manual_nc, 0)
    - ${carteraImportedSql_1.SQL_CARTERA_IMPORT_NC_EXPR}
    - COALESCE(pay.total_pagos, 0)
    - ${carteraImportedSql_1.SQL_CARTERA_IMPORT_REC_EXPR},
    2
  )`;
}
function carteraTotalFacturasSql() {
    return `ROUND(
    COALESCE(afip.fac_iva, 0) + COALESCE(ped.pedidos, 0) + COALESCE(mfac.manual_fac, 0) + ${carteraImportedSql_1.SQL_CARTERA_IMPORT_DEBE_EXPR},
    2
  )`;
}
function carteraTotalNcSql() {
    return `ROUND(
    COALESCE(afipnc.nc_iva, 0) + COALESCE(mnc.manual_nc, 0) + ${carteraImportedSql_1.SQL_CARTERA_IMPORT_NC_EXPR},
    2
  )`;
}
function carteraTotalRecibosSql() {
    return `ROUND(COALESCE(pay.total_pagos, 0) + ${carteraImportedSql_1.SQL_CARTERA_IMPORT_REC_EXPR}, 2)`;
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
      SELECT p.customer_id, SUM(${orderPaymentBalance_service_1.SQL_PAYMENT_SALDO_CONTRIBUTION_AMOUNT}) AS total_pagos
      FROM payments p
      INNER JOIN customers c2 ON c2.id = p.customer_id
      WHERE (p.seller_id = ? OR c2.seller_id = ?)
      GROUP BY p.customer_id
    ) pay ON pay.customer_id = t.customerId`
        : `LEFT JOIN (
      SELECT customer_id, SUM(saldo_amount) AS total_pagos
      FROM (
        SELECT p.customer_id, ${orderPaymentBalance_service_1.SQL_PAYMENT_SALDO_CONTRIBUTION_AMOUNT} AS saldo_amount
        FROM payments p
      ) pay_inner
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
            saldoPendiente: parseSaldoNumero(r.saldoPendiente),
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
      ROUND(t.cargosPendientes - COALESCE(pay.total_pagos, 0), 2) AS saldoPendiente,
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
        ${SQL_ORDER_CARGO_PENDIENTE_SUM} AS cargosPendientes,
        COUNT(DISTINCT o.id) AS pedidosPendientes
      FROM customers c
      INNER JOIN orders o ON o.customer_id = c.id
      LEFT JOIN (
        SELECT order_id, SUM(amount_credited) AS cn_total
        FROM credit_notes
        WHERE COALESCE(superseded_by_reinvoice, 0) = 0
        GROUP BY order_id
      ) cn ON cn.order_id = o.id
      WHERE ${SQL_ORDER_ACTIVE_COND}
        AND ${orderPaymentBalance_service_1.SQL_ORDER_IN_SALDO_SCOPE}
        AND ${SQL_ORDER_ACTIVE_COND}
        ${sellerFilter}
      GROUP BY c.id, c.business_name, c.name, c.cuit, c.city, c.email
    ) t
    ${paymentsJoin}
    WHERE ABS(ROUND(t.cargosPendientes - COALESCE(pay.total_pagos, 0), 2)) > 0.01
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
      ROUND(t.cargosPendientes - COALESCE(pay.total_pagos, 0), 2) AS saldoPendiente,
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
        SUM(${SQL_ORDER_CARGO_CON_IVA}) AS cargosPendientes,
        COUNT(DISTINCT o.id) AS pedidosPendientes
      FROM customers c
      INNER JOIN orders o ON o.customer_id = c.id
      WHERE ${SQL_ORDER_ACTIVE_COND}
        AND ${orderPaymentBalance_service_1.SQL_ORDER_IN_SALDO_SCOPE}
        AND ${SQL_ORDER_ACTIVE_COND}
        ${sellerFilter}
      GROUP BY c.id, c.business_name, c.name, c.cuit, c.city, c.email
    ) t
    ${paymentsJoin}
    WHERE ABS(ROUND(t.cargosPendientes - COALESCE(pay.total_pagos, 0), 2)) > 0.01
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
 * Cartera unificada por cliente: saldo inicial + facturas AFIP + pedidos sin factura − NC − recibos.
 * Alineado con el historial (saldo corrido): importes de factura con IVA, todas las NC AFIP y todos los recibos LupoHub.
 */
const getCarteraTotals = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const user = req.user;
    if (!user || !roleCanViewSaldos(user.role)) {
        return res.status(403).json({ message: 'Sin permiso para ver saldos' });
    }
    yield (0, orderPaymentBalance_service_1.backfillPaymentOrdersFromLegacy)();
    const sellerFilter = user.role === 'SELLER' ? ' AND c.seller_id = ?' : '';
    const baseParams = user.role === 'SELLER' ? [user.id] : [];
    const paymentsSubquery = user.role === 'SELLER'
        ? `SELECT d.customer_id, SUM(d.saldo_amount) AS total_pagos
         FROM (
           SELECT
             p.customer_id,
             ROUND(COALESCE(p.amount, 0), 2) AS amount,
             SUM(${orderPaymentBalance_service_1.SQL_PAYMENT_SALDO_CONTRIBUTION_AMOUNT}) AS saldo_amount,
             CASE
               WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
               ELSE UPPER(
                 REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
               )
             END AS receipt_norm
           FROM payments p
           INNER JOIN customers c2 ON c2.id = p.customer_id
           LEFT JOIN (
             SELECT
               e.customer_id,
               DATE(e.line_date) AS line_date,
               ROUND(COALESCE(e.importe, 0), 2) AS amount,
               UPPER(
                 REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
               ) AS receipt_norm
             FROM customer_multimedia_entries e
             WHERE UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('REC', 'RECIBO', 'PAGO', 'COBRO', 'INGRESO')
               AND TRIM(COALESCE(e.numero, '')) <> ''
             GROUP BY
               e.customer_id,
               DATE(e.line_date),
               ROUND(COALESCE(e.importe, 0), 2),
               UPPER(
                 REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
               )
           ) me_rec
             ON me_rec.customer_id = p.customer_id
            AND me_rec.line_date = DATE(p.date)
            AND me_rec.amount = ROUND(COALESCE(p.amount, 0), 2)
            AND me_rec.receipt_norm = CASE
              WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
              ELSE UPPER(
                REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
              )
            END
           WHERE (p.seller_id = ? OR c2.seller_id = ?)
             AND me_rec.customer_id IS NULL
             AND ${carteraImportedSql_1.SQL_WHERE_PAYMENT_SOLO_LUPOHUB}
             AND ${(0, customerOpeningBalance_1.sqlOpeningPaymentDateWhere)('c2')}
             AND ${SQL_PAYMENT_EXCLUDE_COMMISSION_IMPORT}
           GROUP BY
             p.customer_id,
             DATE(p.date),
             ROUND(COALESCE(p.amount, 0), 2),
             CASE
               WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
               ELSE UPPER(
                 REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
               )
             END
         ) d
         GROUP BY d.customer_id`
        : `SELECT d.customer_id, SUM(d.saldo_amount) AS total_pagos
         FROM (
           SELECT
             p.customer_id,
             ROUND(COALESCE(p.amount, 0), 2) AS amount,
             SUM(${orderPaymentBalance_service_1.SQL_PAYMENT_SALDO_CONTRIBUTION_AMOUNT}) AS saldo_amount,
             CASE
               WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
               ELSE UPPER(
                 REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
               )
             END AS receipt_norm
           FROM payments p
           INNER JOIN customers cp ON cp.id = p.customer_id
           LEFT JOIN (
             SELECT
               e.customer_id,
               DATE(e.line_date) AS line_date,
               ROUND(COALESCE(e.importe, 0), 2) AS amount,
               UPPER(
                 REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
               ) AS receipt_norm
             FROM customer_multimedia_entries e
             WHERE UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('REC', 'RECIBO', 'PAGO', 'COBRO', 'INGRESO')
               AND TRIM(COALESCE(e.numero, '')) <> ''
             GROUP BY
               e.customer_id,
               DATE(e.line_date),
               ROUND(COALESCE(e.importe, 0), 2),
               UPPER(
                 REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
               )
           ) me_rec
             ON me_rec.customer_id = p.customer_id
            AND me_rec.line_date = DATE(p.date)
            AND me_rec.amount = ROUND(COALESCE(p.amount, 0), 2)
            AND me_rec.receipt_norm = CASE
              WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
              ELSE UPPER(
                REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
              )
            END
           WHERE me_rec.customer_id IS NULL
             AND ${carteraImportedSql_1.SQL_WHERE_PAYMENT_SOLO_LUPOHUB}
             AND ${(0, customerOpeningBalance_1.sqlOpeningPaymentDateWhere)('cp')}
             AND ${SQL_PAYMENT_EXCLUDE_COMMISSION_IMPORT}
           GROUP BY
             p.customer_id,
             DATE(p.date),
             ROUND(COALESCE(p.amount, 0), 2),
             CASE
               WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
               ELSE UPPER(
                 REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
               )
             END
         ) d
         GROUP BY d.customer_id`;
    const payParams = user.role === 'SELLER' ? [user.id, user.id] : [];
    const paramsWithNc = [...baseParams, ...payParams];
    const paramsSimple = [...baseParams, ...payParams];
    const saldoExpr = carteraSaldoSqlExpr();
    const sqlWithNc = `
    SELECT
      c.id AS customerId,
      ${carteraTotalFacturasSql()} AS orderCargosPendientes,
      ${carteraTotalNcSql()} AS totalNotasCredito,
      ${carteraImportedSql_1.SQL_CARTERA_MULTIMEDIA_SALDO_EXPR} AS multimediaSaldo,
      ${carteraTotalRecibosSql()} AS totalPagos,
      ${saldoExpr} AS saldoPendienteUnificado
    FROM customers c
    LEFT JOIN (${SQL_CARTERA_AFIP_INVOICES_SUBQUERY}) afip ON afip.customer_id = c.id
    LEFT JOIN (${SQL_CARTERA_PEDIDOS_SF_SUBQUERY}) ped ON ped.customer_id = c.id
    LEFT JOIN (${SQL_CARTERA_AFIP_NC_SUBQUERY}) afipnc ON afipnc.customer_id = c.id
    LEFT JOIN (
      SELECT m.customer_id, SUM(ROUND(m.importe_neto + COALESCE(m.agip_ret_per, 0), 2)) AS manual_fac
      FROM customer_manual_comprobantes m
      INNER JOIN customers co ON co.id = m.customer_id
      WHERE m.tipo = 'FACTURA' AND ${customerOpeningBalance_1.SQL_OPENING_MANUAL_DATE_WHERE}
      GROUP BY m.customer_id
    ) mfac ON mfac.customer_id = c.id
    LEFT JOIN (
      SELECT m.customer_id, SUM(ROUND(m.importe_neto, 2)) AS manual_nc
      FROM customer_manual_comprobantes m
      INNER JOIN customers co ON co.id = m.customer_id
      WHERE m.tipo = 'NC' AND ${customerOpeningBalance_1.SQL_OPENING_MANUAL_DATE_WHERE}
      GROUP BY m.customer_id
    ) mnc ON mnc.customer_id = c.id
    ${carteraImportedSql_1.SQL_CARTERA_IMPORT_JOIN}
    LEFT JOIN (${paymentsSubquery}) pay ON pay.customer_id = c.id
    WHERE 1=1 ${sellerFilter}
      AND ABS(${saldoExpr}) > 0.005
    ORDER BY c.business_name ASC, c.name ASC
  `;
    /** Misma lógica que sqlWithNc; reintento si la consulta anterior falla (p. ej. esquema antiguo). */
    const sqlSimple = sqlWithNc;
    try {
        const rows = yield (0, db_1.query)(sqlWithNc, paramsWithNc);
        return res.json(rows.map((r) => ({
            customerId: r.customerId,
            orderCargosPendientes: parseSaldoNumero(r.orderCargosPendientes),
            totalNotasCredito: parseSaldoNumero(r.totalNotasCredito),
            multimediaSaldo: parseSaldoNumero(r.multimediaSaldo),
            totalPagos: parseSaldoNumero(r.totalPagos),
            saldoPendienteUnificado: parseSaldoNumero(r.saldoPendienteUnificado)
        })));
    }
    catch (e) {
        console.warn('[cartera-totals] consulta con NC falló, reintentando sin NC:', e === null || e === void 0 ? void 0 : e.message);
        try {
            const rows = yield (0, db_1.query)(sqlSimple, paramsSimple);
            return res.json(rows.map((r) => ({
                customerId: r.customerId,
                orderCargosPendientes: parseSaldoNumero(r.orderCargosPendientes),
                totalNotasCredito: parseSaldoNumero(r.totalNotasCredito),
                multimediaSaldo: parseSaldoNumero(r.multimediaSaldo),
                totalPagos: parseSaldoNumero(r.totalPagos),
                saldoPendienteUnificado: parseSaldoNumero(r.saldoPendienteUnificado)
            })));
        }
        catch (e2) {
            console.error('getCarteraTotals:', e2);
            return res.status(500).json({ message: 'Error listando totales de cartera' });
        }
    }
});
exports.getCarteraTotals = getCarteraTotals;
/** Totales de cartera de un cliente (misma consulta que GET /cartera-totals). */
function queryCarteraTotalsForCustomer(customerId, user) {
    return __awaiter(this, void 0, void 0, function* () {
        yield (0, orderPaymentBalance_service_1.backfillPaymentOrdersFromLegacy)();
        const sellerFilter = user.role === 'SELLER' ? ' AND c.seller_id = ?' : '';
        const paymentsSubquery = user.role === 'SELLER'
            ? `SELECT d.customer_id, SUM(d.saldo_amount) AS total_pagos
         FROM (
           SELECT p.customer_id, ROUND(COALESCE(p.amount, 0), 2) AS amount, SUM(${orderPaymentBalance_service_1.SQL_PAYMENT_SALDO_CONTRIBUTION_AMOUNT}) AS saldo_amount,
             CASE WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
             ELSE UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')) END AS receipt_norm
           FROM payments p
           INNER JOIN customers c2 ON c2.id = p.customer_id
           LEFT JOIN (
             SELECT e.customer_id, DATE(e.line_date) AS line_date, ROUND(COALESCE(e.importe, 0), 2) AS amount,
               UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')) AS receipt_norm
             FROM customer_multimedia_entries e
             WHERE UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('REC', 'RECIBO', 'PAGO', 'COBRO', 'INGRESO') AND TRIM(COALESCE(e.numero, '')) <> ''
             GROUP BY e.customer_id, DATE(e.line_date), ROUND(COALESCE(e.importe, 0), 2),
               UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', ''))
           ) me_rec ON me_rec.customer_id = p.customer_id AND me_rec.line_date = DATE(p.date)
             AND me_rec.amount = ROUND(COALESCE(p.amount, 0), 2)
             AND me_rec.receipt_norm = CASE WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
             ELSE UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')) END
           WHERE (p.seller_id = ? OR c2.seller_id = ?) AND me_rec.customer_id IS NULL
             AND ${carteraImportedSql_1.SQL_WHERE_PAYMENT_SOLO_LUPOHUB}
             AND ${(0, customerOpeningBalance_1.sqlOpeningPaymentDateWhere)('c2')} AND ${SQL_PAYMENT_EXCLUDE_COMMISSION_IMPORT}
           GROUP BY p.customer_id, DATE(p.date), ROUND(COALESCE(p.amount, 0), 2),
             CASE WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
             ELSE UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')) END
         ) d GROUP BY d.customer_id`
            : `SELECT d.customer_id, SUM(d.saldo_amount) AS total_pagos
         FROM (
           SELECT p.customer_id, ROUND(COALESCE(p.amount, 0), 2) AS amount, SUM(${orderPaymentBalance_service_1.SQL_PAYMENT_SALDO_CONTRIBUTION_AMOUNT}) AS saldo_amount,
             CASE WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
             ELSE UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')) END AS receipt_norm
           FROM payments p
           INNER JOIN customers cp ON cp.id = p.customer_id
           LEFT JOIN (
             SELECT e.customer_id, DATE(e.line_date) AS line_date, ROUND(COALESCE(e.importe, 0), 2) AS amount,
               UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')) AS receipt_norm
             FROM customer_multimedia_entries e
             WHERE UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('REC', 'RECIBO', 'PAGO', 'COBRO', 'INGRESO') AND TRIM(COALESCE(e.numero, '')) <> ''
             GROUP BY e.customer_id, DATE(e.line_date), ROUND(COALESCE(e.importe, 0), 2),
               UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', ''))
           ) me_rec ON me_rec.customer_id = p.customer_id AND me_rec.line_date = DATE(p.date)
             AND me_rec.amount = ROUND(COALESCE(p.amount, 0), 2)
             AND me_rec.receipt_norm = CASE WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
             ELSE UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')) END
           WHERE me_rec.customer_id IS NULL AND ${carteraImportedSql_1.SQL_WHERE_PAYMENT_SOLO_LUPOHUB} AND ${(0, customerOpeningBalance_1.sqlOpeningPaymentDateWhere)('cp')} AND ${SQL_PAYMENT_EXCLUDE_COMMISSION_IMPORT}
           GROUP BY p.customer_id, DATE(p.date), ROUND(COALESCE(p.amount, 0), 2),
             CASE WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
             ELSE UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')) END
         ) d GROUP BY d.customer_id`;
        const saldoExpr = carteraSaldoSqlExpr();
        const sql = `
    SELECT
      ${carteraTotalFacturasSql()} AS orderCargosPendientes,
      ${carteraTotalNcSql()} AS totalNotasCredito,
      ${carteraTotalRecibosSql()} AS totalPagos,
      ${saldoExpr} AS saldoPendienteUnificado,
      ROUND(COALESCE(c.opening_balance, 0), 2) AS openingBalance
    FROM customers c
    LEFT JOIN (${SQL_CARTERA_AFIP_INVOICES_SUBQUERY}) afip ON afip.customer_id = c.id
    LEFT JOIN (${SQL_CARTERA_PEDIDOS_SF_SUBQUERY}) ped ON ped.customer_id = c.id
    LEFT JOIN (${SQL_CARTERA_AFIP_NC_SUBQUERY}) afipnc ON afipnc.customer_id = c.id
    LEFT JOIN (
      SELECT m.customer_id, SUM(ROUND(m.importe_neto + COALESCE(m.agip_ret_per, 0), 2)) AS manual_fac
      FROM customer_manual_comprobantes m
      INNER JOIN customers co ON co.id = m.customer_id
      WHERE m.tipo = 'FACTURA' AND ${customerOpeningBalance_1.SQL_OPENING_MANUAL_DATE_WHERE}
      GROUP BY m.customer_id
    ) mfac ON mfac.customer_id = c.id
    LEFT JOIN (
      SELECT m.customer_id, SUM(ROUND(m.importe_neto, 2)) AS manual_nc
      FROM customer_manual_comprobantes m
      INNER JOIN customers co ON co.id = m.customer_id
      WHERE m.tipo = 'NC' AND ${customerOpeningBalance_1.SQL_OPENING_MANUAL_DATE_WHERE}
      GROUP BY m.customer_id
    ) mnc ON mnc.customer_id = c.id
    ${carteraImportedSql_1.SQL_CARTERA_IMPORT_JOIN}
    LEFT JOIN (${paymentsSubquery}) pay ON pay.customer_id = c.id
    WHERE c.id = ?${sellerFilter}
  `;
        const params = user.role === 'SELLER' ? [user.id, user.id, customerId, user.id] : [customerId];
        const row = (yield (0, db_1.get)(sql, params));
        if (!row)
            return null;
        return {
            orderCargosPendientes: parseSaldoNumero(row.orderCargosPendientes),
            totalNotasCredito: parseSaldoNumero(row.totalNotasCredito),
            totalPagos: parseSaldoNumero(row.totalPagos),
            saldoPendienteUnificado: parseSaldoNumero(row.saldoPendienteUnificado),
            openingBalance: parseSaldoNumero(row.openingBalance)
        };
    });
}
/** Saldo unificado por cliente (misma fórmula que getCarteraTotals), sin filtrar por saldo > 0. */
function fetchCarteraSaldoUnificadoMap(sellerIdFilter, user) {
    return __awaiter(this, void 0, void 0, function* () {
        yield (0, orderPaymentBalance_service_1.backfillPaymentOrdersFromLegacy)();
        const sellerFilter = sellerIdFilter ? ' AND c.seller_id = ?' : user.role === 'SELLER' ? ' AND c.seller_id = ?' : '';
        const baseParams = sellerIdFilter ? [sellerIdFilter] : user.role === 'SELLER' ? [user.id] : [];
        const sellerScoped = !!sellerIdFilter || user.role === 'SELLER';
        const paymentsSubquery = sellerScoped
            ? `SELECT d.customer_id, SUM(d.saldo_amount) AS total_pagos
         FROM (
           SELECT p.customer_id, ROUND(COALESCE(p.amount, 0), 2) AS amount, SUM(${orderPaymentBalance_service_1.SQL_PAYMENT_SALDO_CONTRIBUTION_AMOUNT}) AS saldo_amount,
             CASE WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
             ELSE UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')) END AS receipt_norm
           FROM payments p
           INNER JOIN customers c2 ON c2.id = p.customer_id
           LEFT JOIN (
             SELECT e.customer_id, DATE(e.line_date) AS line_date, ROUND(COALESCE(e.importe, 0), 2) AS amount,
               UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')) AS receipt_norm
             FROM customer_multimedia_entries e
             WHERE UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('REC', 'RECIBO', 'PAGO', 'COBRO', 'INGRESO') AND TRIM(COALESCE(e.numero, '')) <> ''
             GROUP BY e.customer_id, DATE(e.line_date), ROUND(COALESCE(e.importe, 0), 2),
               UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', ''))
           ) me_rec ON me_rec.customer_id = p.customer_id AND me_rec.line_date = DATE(p.date)
             AND me_rec.amount = ROUND(COALESCE(p.amount, 0), 2)
             AND me_rec.receipt_norm = CASE WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
             ELSE UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')) END
           WHERE (p.seller_id = ? OR c2.seller_id = ?) AND me_rec.customer_id IS NULL
             AND ${carteraImportedSql_1.SQL_WHERE_PAYMENT_SOLO_LUPOHUB}
             AND ${(0, customerOpeningBalance_1.sqlOpeningPaymentDateWhere)('c2')}
             AND ${SQL_PAYMENT_EXCLUDE_COMMISSION_IMPORT}
           GROUP BY p.customer_id, DATE(p.date), ROUND(COALESCE(p.amount, 0), 2),
             CASE WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
             ELSE UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')) END
         ) d GROUP BY d.customer_id`
            : `SELECT d.customer_id, SUM(d.saldo_amount) AS total_pagos
         FROM (
           SELECT p.customer_id, ROUND(COALESCE(p.amount, 0), 2) AS amount, SUM(${orderPaymentBalance_service_1.SQL_PAYMENT_SALDO_CONTRIBUTION_AMOUNT}) AS saldo_amount,
             CASE WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
             ELSE UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')) END AS receipt_norm
           FROM payments p
           INNER JOIN customers cp ON cp.id = p.customer_id
           LEFT JOIN (
             SELECT e.customer_id, DATE(e.line_date) AS line_date, ROUND(COALESCE(e.importe, 0), 2) AS amount,
               UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')) AS receipt_norm
             FROM customer_multimedia_entries e
             WHERE UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('REC', 'RECIBO', 'PAGO', 'COBRO', 'INGRESO') AND TRIM(COALESCE(e.numero, '')) <> ''
             GROUP BY e.customer_id, DATE(e.line_date), ROUND(COALESCE(e.importe, 0), 2),
               UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', ''))
           ) me_rec ON me_rec.customer_id = p.customer_id AND me_rec.line_date = DATE(p.date)
             AND me_rec.amount = ROUND(COALESCE(p.amount, 0), 2)
             AND me_rec.receipt_norm = CASE WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
             ELSE UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')) END
           WHERE me_rec.customer_id IS NULL
             AND ${carteraImportedSql_1.SQL_WHERE_PAYMENT_SOLO_LUPOHUB}
             AND ${(0, customerOpeningBalance_1.sqlOpeningPaymentDateWhere)('cp')}
             AND ${SQL_PAYMENT_EXCLUDE_COMMISSION_IMPORT}
           GROUP BY p.customer_id, DATE(p.date), ROUND(COALESCE(p.amount, 0), 2),
             CASE WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
             ELSE UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')) END
         ) d GROUP BY d.customer_id`;
        const paySellerId = sellerIdFilter || (user.role === 'SELLER' ? user.id : '');
        const payParams = sellerScoped ? [paySellerId, paySellerId] : [];
        const params = [...baseParams, ...payParams];
        const saldoExpr = carteraSaldoSqlExpr();
        const sql = `
    SELECT c.id AS customerId, ${saldoExpr} AS saldoPendienteUnificado
    FROM customers c
    LEFT JOIN (${SQL_CARTERA_AFIP_INVOICES_SUBQUERY}) afip ON afip.customer_id = c.id
    LEFT JOIN (${SQL_CARTERA_PEDIDOS_SF_SUBQUERY}) ped ON ped.customer_id = c.id
    LEFT JOIN (${SQL_CARTERA_AFIP_NC_SUBQUERY}) afipnc ON afipnc.customer_id = c.id
    LEFT JOIN (
      SELECT m.customer_id, SUM(ROUND(m.importe_neto + COALESCE(m.agip_ret_per, 0), 2)) AS manual_fac
      FROM customer_manual_comprobantes m
      INNER JOIN customers co ON co.id = m.customer_id
      WHERE m.tipo = 'FACTURA' AND ${customerOpeningBalance_1.SQL_OPENING_MANUAL_DATE_WHERE}
      GROUP BY m.customer_id
    ) mfac ON mfac.customer_id = c.id
    LEFT JOIN (
      SELECT m.customer_id, SUM(ROUND(m.importe_neto, 2)) AS manual_nc
      FROM customer_manual_comprobantes m
      INNER JOIN customers co ON co.id = m.customer_id
      WHERE m.tipo = 'NC' AND ${customerOpeningBalance_1.SQL_OPENING_MANUAL_DATE_WHERE}
      GROUP BY m.customer_id
    ) mnc ON mnc.customer_id = c.id
    ${carteraImportedSql_1.SQL_CARTERA_IMPORT_JOIN}
    LEFT JOIN (${paymentsSubquery}) pay ON pay.customer_id = c.id
    WHERE 1=1 ${sellerFilter}
  `;
        const rows = (yield (0, db_1.query)(sql, params));
        const map = new Map();
        for (const r of rows)
            map.set(r.customerId, parseSaldoNumero(r.saldoPendienteUnificado));
        return map;
    });
}
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
      SELECT d.customer_id, SUM(d.saldo_amount) AS total_pagos
      FROM (
        SELECT
          p.customer_id,
          ROUND(COALESCE(p.amount, 0), 2) AS amount,
          SUM(${orderPaymentBalance_service_1.SQL_PAYMENT_SALDO_CONTRIBUTION_AMOUNT}) AS saldo_amount,
          CASE
            WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
            ELSE UPPER(
              REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
            )
          END AS receipt_norm,
          DATE(p.date) AS pay_date
        FROM payments p
        INNER JOIN customers c2 ON c2.id = p.customer_id
        WHERE (p.seller_id = ? OR c2.seller_id = ?)
        GROUP BY
          p.customer_id,
          DATE(p.date),
          ROUND(COALESCE(p.amount, 0), 2),
          CASE
            WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
            ELSE UPPER(
              REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
            )
          END
      ) d
      GROUP BY d.customer_id
    ) pay ON pay.customer_id = t.customerId`
        : `LEFT JOIN (
      SELECT d.customer_id, SUM(d.saldo_amount) AS total_pagos
      FROM (
        SELECT
          p.customer_id,
          ROUND(COALESCE(p.amount, 0), 2) AS amount,
          SUM(${orderPaymentBalance_service_1.SQL_PAYMENT_SALDO_CONTRIBUTION_AMOUNT}) AS saldo_amount,
          CASE
            WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
            ELSE UPPER(
              REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
            )
          END AS receipt_norm,
          DATE(p.date) AS pay_date
        FROM payments p
        GROUP BY
          p.customer_id,
          DATE(p.date),
          ROUND(COALESCE(p.amount, 0), 2),
          CASE
            WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
            ELSE UPPER(
              REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
            )
          END
      ) d
      GROUP BY d.customer_id
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
      ROUND(t.cargosPendientes - COALESCE(pay.total_pagos, 0), 2) AS saldoPendiente,
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
        ${SQL_ORDER_CARGO_PENDIENTE_SUM} AS cargosPendientes,
        COUNT(DISTINCT o.id) AS pedidosPendientes
      FROM customers c
      INNER JOIN orders o ON o.customer_id = c.id
      LEFT JOIN (
        SELECT order_id, SUM(amount_credited) AS cn_total
        FROM credit_notes
        WHERE COALESCE(superseded_by_reinvoice, 0) = 0
        GROUP BY order_id
      ) cn ON cn.order_id = o.id
      WHERE ${SQL_ORDER_ACTIVE_COND}
        AND ${orderPaymentBalance_service_1.SQL_ORDER_IN_SALDO_SCOPE}
        AND ${SQL_ORDER_ACTIVE_COND}
        ${sellerFilter}
      GROUP BY c.id, c.business_name, c.name, c.cuit, c.city, c.email
    ) t
    ${paymentsJoin}
    WHERE ABS(ROUND(t.cargosPendientes - COALESCE(pay.total_pagos, 0), 2)) > 0.01
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
      ROUND(t.cargosPendientes - COALESCE(pay.total_pagos, 0), 2) AS saldoPendiente,
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
        SUM(${SQL_ORDER_CARGO_CON_IVA}) AS cargosPendientes,
        COUNT(DISTINCT o.id) AS pedidosPendientes
      FROM customers c
      INNER JOIN orders o ON o.customer_id = c.id
      WHERE ${SQL_ORDER_ACTIVE_COND}
        AND ${orderPaymentBalance_service_1.SQL_ORDER_IN_SALDO_SCOPE}
        AND ${SQL_ORDER_ACTIVE_COND}
        ${sellerFilter}
      GROUP BY c.id, c.business_name, c.name, c.cuit, c.city, c.email
    ) t
    ${paymentsJoin}
    WHERE ABS(ROUND(t.cargosPendientes - COALESCE(pay.total_pagos, 0), 2)) > 0.01
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
    var _a, _b, _c, _d, _e, _f;
    const user = req.user;
    if (!user || !roleCanViewSaldos(user.role)) {
        return res.status(403).json({ message: 'Sin permiso para exportar saldos' });
    }
    try {
        const sellerWhere = user.role === 'SELLER' ? 'WHERE c.seller_id = ?' : '';
        const sellerParams = user.role === 'SELLER' ? [user.id] : [];
        const branchNcImportadaTango = `
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          e.line_date AS fecha,
          'NOTA_CREDITO_IMPORTADA' AS tipo,
          COALESCE(NULLIF(TRIM(e.numero), ''), 'NC importada') AS comprobante,
          NULL AS order_id,
          0 AS debe,
          ROUND(ABS(COALESCE(e.importe, 0)), 2) AS haber
        FROM customer_multimedia_entries e
        JOIN customers c ON c.id = e.customer_id
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE (
          UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('NC', 'N/C', 'NOTA CREDITO', 'NOTA DE CREDITO', 'NOTA DE CRÉDITO')
          OR UPPER(COALESCE(e.detalle, '')) LIKE '%NOTA%CREDITO%'
          OR UPPER(COALESCE(e.detalle, '')) LIKE '%NOTA%CRÉDITO%'
          OR UPPER(COALESCE(e.detalle, '')) LIKE '%N/C%'
        )`;
        const detalleUnionBranches = [
            `SELECT
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
          ${(0, orderPricing_1.sqlInvoiceAmountFromOrderTotal)()} AS debe,
          0 AS haber
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN users u ON u.id = c.seller_id`,
            `SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          COALESCE(cn.created_at, inv.created_at, o.date) AS fecha,
          'NOTA_CREDITO' AS tipo,
          CONCAT(
            CASE
              WHEN cn.cbte_tipo = 3 THEN 'NC A '
              WHEN cn.cbte_tipo = 8 THEN 'NC B '
              WHEN cn.cbte_tipo = 13 THEN 'NC C '
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
        LEFT JOIN invoices inv ON inv.id = cn.invoice_id
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN users u ON u.id = c.seller_id`,
            `SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          COALESCE(ecn.created_at, ei.created_at) AS fecha,
          'NOTA_CREDITO' AS tipo,
          CONCAT(
            CASE
              WHEN ecn.cbte_tipo = 3 THEN 'NC A '
              WHEN ecn.cbte_tipo = 8 THEN 'NC B '
              WHEN ecn.cbte_tipo = 13 THEN 'NC C '
              ELSE 'NC '
            END,
            LPAD(COALESCE(ecn.punto_venta, 0), 5, '0'),
            '-',
            LPAD(COALESCE(ecn.cbte_desde, 0), 8, '0')
          ) AS comprobante,
          ecn.external_order_id AS order_id,
          0 AS debe,
          ROUND(COALESCE(ecn.amount_credited, 0) * 1.21, 2) AS haber
        FROM external_credit_notes ecn
        JOIN external_invoices ei ON ei.id = ecn.external_invoice_id
        JOIN customers c
          ON REPLACE(REPLACE(REPLACE(COALESCE(c.cuit, ''), '-', ''), '.', ''), ' ', '') =
             REPLACE(REPLACE(REPLACE(COALESCE(ei.customer_cuit, ''), '-', ''), '.', ''), ' ', '')
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE REPLACE(REPLACE(REPLACE(COALESCE(ei.customer_cuit, ''), '-', ''), '.', ''), ' ', '') <> ''`,
            ...(carteraImportedSql_1.INCLUDE_TANGO_IMPORT_IN_SYSTEM ? [branchNcImportadaTango] : []),
            `SELECT
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
        LEFT JOIN users u ON u.id = c.seller_id`
        ];
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
        ${detalleUnionBranches.join('\n\n        UNION ALL\n\n')}
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
                else if (m.tipo === 'NOTA_CREDITO' || m.tipo === 'NOTA_CREDITO_IMPORTADA')
                    totalNc += haber;
                else if (comprobanteIndicaNotaCredito(String((_a = m.comprobante) !== null && _a !== void 0 ? _a : '')) &&
                    Number(m.haber || 0) > 0.001 &&
                    Number(m.debe || 0) <= 0.001) {
                    totalNc += haber;
                }
                else
                    totalRecibos += haber;
                wsDetail.addRow({
                    cliente: c.customer_name,
                    vendedor: (_c = (_b = c.seller_name) !== null && _b !== void 0 ? _b : c.seller_id) !== null && _c !== void 0 ? _c : '',
                    fecha: (0, customerOpeningBalance_1.ymdToExcelDate)(m.fecha),
                    tipo: labelTipoSaldoExporter(m),
                    comprobante: m.comprobante,
                    pedido: (_d = m.order_id) !== null && _d !== void 0 ? _d : '',
                    debe,
                    haber,
                    saldo: running
                });
            }
            const saldoPendiente = Math.round(running * 100) / 100;
            if (Math.abs(saldoPendiente) > 0.01) {
                wsSummary.addRow({
                    cliente: c.customer_name,
                    vendedor: (_f = (_e = c.seller_name) !== null && _e !== void 0 ? _e : c.seller_id) !== null && _f !== void 0 ? _f : '',
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
 * Excel con movimientos cargados solo en LupoHub: facturas AFIP, notas de crédito y recibos.
 * Excluye importaciones Multimedia/Tango y comprobantes externos por CUIT.
 */
const exportSaldosMovimientosSistemaXlsx = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
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
          ${(0, orderPricing_1.sqlInvoiceAmountFromOrderTotal)()} AS debe,
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
          COALESCE(cn.created_at, inv.created_at, o.date) AS fecha,
          'NOTA_CREDITO' AS tipo,
          CONCAT(
            CASE
              WHEN cn.cbte_tipo = 3 THEN 'NC A '
              WHEN cn.cbte_tipo = 8 THEN 'NC B '
              WHEN cn.cbte_tipo = 13 THEN 'NC C '
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
        LEFT JOIN invoices inv ON inv.id = cn.invoice_id
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
            { header: 'Tipo', key: 'tipo', width: 22 },
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
                else if (comprobanteIndicaNotaCredito(String((_a = m.comprobante) !== null && _a !== void 0 ? _a : '')) &&
                    Number(m.haber || 0) > 0.001 &&
                    Number(m.debe || 0) <= 0.001) {
                    totalNc += haber;
                }
                else
                    totalRecibos += haber;
                wsDetail.addRow({
                    cliente: c.customer_name,
                    vendedor: (_c = (_b = c.seller_name) !== null && _b !== void 0 ? _b : c.seller_id) !== null && _c !== void 0 ? _c : '',
                    fecha: (0, customerOpeningBalance_1.ymdToExcelDate)(m.fecha),
                    tipo: labelTipoSaldoExporter(m),
                    comprobante: m.comprobante,
                    pedido: (_d = m.order_id) !== null && _d !== void 0 ? _d : '',
                    debe,
                    haber,
                    saldo: running
                });
            }
            const saldoPendiente = Math.round(running * 100) / 100;
            if (Math.abs(saldoPendiente) > 0.01) {
                wsSummary.addRow({
                    cliente: c.customer_name,
                    vendedor: (_f = (_e = c.seller_name) !== null && _e !== void 0 ? _e : c.seller_id) !== null && _f !== void 0 ? _f : '',
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
        const filename = `movimientos_sistema_${new Date().toISOString().slice(0, 10)}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(buf);
    }
    catch (error) {
        console.error('exportSaldosMovimientosSistemaXlsx:', error);
        return res.status(500).json({ message: 'Error exportando movimientos del sistema' });
    }
});
exports.exportSaldosMovimientosSistemaXlsx = exportSaldosMovimientosSistemaXlsx;
/**
 * Exporta saldos pendientes en Excel con una hoja por cliente.
 * Opcional: ?sellerId=... para ADMIN/WAREHOUSE (filtra por vendedor específico).
 */
const exportSaldosPendientesByCustomerSheetsXlsx = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g;
    const user = req.user;
    if (!user || !roleCanViewSaldos(user.role)) {
        return res.status(403).json({ message: 'Sin permiso para exportar saldos' });
    }
    try {
        const requestedSellerId = String(req.query.sellerId || '').trim();
        const fromRaw = String(req.query.from || '').trim();
        const toRaw = String(req.query.to || '').trim();
        const sinceZeroRaw = String(req.query.sinceZero || req.query.desdeCero || '').trim().toLowerCase();
        const sinceZero = sinceZeroRaw === '1' ||
            sinceZeroRaw === 'true' ||
            sinceZeroRaw === 'yes' ||
            sinceZeroRaw === 'desde-cero' ||
            sinceZeroRaw === 'since-zero';
        const sellerIdFilter = user.role === 'SELLER'
            ? user.id
            : (user.role === 'ADMIN' || user.role === 'WAREHOUSE') && requestedSellerId
                ? requestedSellerId
                : '';
        const source = String(req.query.source || '').trim().toLowerCase();
        const mode = source === 'tango'
            ? 'tango'
            : source === 'sistema' || source === 'solo-sistema'
                ? 'sistema'
                : source === 'historial'
                    ? 'historial'
                    : carteraImportedSql_1.INCLUDE_TANGO_IMPORT_IN_SYSTEM
                        ? 'historial'
                        : 'sistema';
        const includeTangoInHistorial = true; // Excel historial: siempre listar import Multimedia (aunque la cartera LupoHub no lo sume)
        /**
         * Modo Tango / Historial / desde-cero: necesitamos el ledger completo para recortar
         * o listar import Multimedia (años atrás). Un filtro de mes ocultaría las FAC.
         */
        const from = mode === 'tango' || mode === 'historial' || sinceZero ? '' : fromRaw;
        const to = mode === 'tango' || mode === 'historial' || sinceZero ? '' : toRaw;
        const sellerWhere = sellerIdFilter ? 'WHERE c.seller_id = ?' : '';
        const sellerParams = sellerIdFilter ? [sellerIdFilter] : [];
        /**
         * Detalle del Excel: solo movimientos entre `from` y `to` (si vienen; historial/tango ignoran el rango).
         * El saldo corrido arranca en «Saldo al inicio del período» y cierra en saldo pendiente (cartera).
         */
        const invoiceRangeFilter = `${from ? ' AND DATE(COALESCE(i.created_at, o.date)) >= ?' : ''}${to ? ' AND DATE(COALESCE(i.created_at, o.date)) <= ?' : ''}`;
        const invoiceOpeningFilter = ' AND DATE(COALESCE(i.created_at, o.date)) < ?';
        const pedidoRangeFilter = `${from ? ' AND DATE(o.date) >= ?' : ''}${to ? ' AND DATE(o.date) <= ?' : ''}`;
        const pedidoOpeningFilter = ' AND DATE(o.date) < ?';
        const ncRangeFilter = `${from ? ' AND DATE(COALESCE(cn.created_at, inv.created_at, o.date)) >= ?' : ''}${to ? ' AND DATE(COALESCE(cn.created_at, inv.created_at, o.date)) <= ?' : ''}`;
        const ncOpeningFilter = ' AND DATE(COALESCE(cn.created_at, inv.created_at, o.date)) < ?';
        const externalNcRangeFilter = `${from ? ' AND DATE(COALESCE(ecn.created_at, ei.created_at)) >= ?' : ''}${to ? ' AND DATE(COALESCE(ecn.created_at, ei.created_at)) <= ?' : ''}`;
        const externalNcOpeningFilter = ' AND DATE(COALESCE(ecn.created_at, ei.created_at)) < ?';
        const receiptRangeFilter = `${from ? ' AND DATE(p.date) >= ?' : ''}${to ? ' AND DATE(p.date) <= ?' : ''}`;
        const receiptOpeningFilter = ' AND DATE(p.date) < ?';
        const importedRangeFilter = `${from ? ' AND DATE(e.line_date) >= ?' : ''}${to ? ' AND DATE(e.line_date) <= ?' : ''}`;
        const importedOpeningFilter = ' AND DATE(e.line_date) < ?';
        const manualRangeFilter = `${from ? ' AND DATE(m.fecha) >= ?' : ''}${to ? ' AND DATE(m.fecha) <= ?' : ''}`;
        const manualOpeningFilter = ' AND DATE(m.fecha) < ?';
        const branchFacturaSistema = `
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
          ${(0, orderPricing_1.sqlInvoiceAmountFromOrderTotal)()} AS debe,
          0 AS haber
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE 1=1 ${invoiceRangeFilter}`;
        const branchFacturaSistemaOpening = `
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
          ${(0, orderPricing_1.sqlInvoiceAmountFromOrderTotal)()} AS debe,
          0 AS haber
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE 1=1 ${invoiceOpeningFilter}`;
        /** Pedidos con saldo pendiente sin factura AFIP (misma lógica que el historial del cliente). */
        const branchPedidoSinFactura = `
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          o.date AS fecha,
          'PEDIDO' AS tipo,
          o.id AS comprobante,
          o.id AS order_id,
          (${orderPaymentBalance_service_1.SQL_ORDER_SALDO_RESIDUAL}) AS debe,
          0 AS haber
        FROM orders o
        LEFT JOIN (${orderPaymentBalance_service_1.SQL_CN_TOTAL_SUBQUERY}) cn ON cn.order_id = o.id
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE ${SQL_ORDER_ACTIVE_COND}
          AND ${orderPaymentBalance_service_1.SQL_ORDER_IN_SALDO_SCOPE}
          AND (${orderPaymentBalance_service_1.SQL_ORDER_SALDO_RESIDUAL}) > 0.005
          AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id)
          ${pedidoRangeFilter}`;
        const branchPedidoSinFacturaOpening = `
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          o.date AS fecha,
          'PEDIDO' AS tipo,
          o.id AS comprobante,
          o.id AS order_id,
          (${orderPaymentBalance_service_1.SQL_ORDER_SALDO_RESIDUAL}) AS debe,
          0 AS haber
        FROM orders o
        LEFT JOIN (${orderPaymentBalance_service_1.SQL_CN_TOTAL_SUBQUERY}) cn ON cn.order_id = o.id
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE ${SQL_ORDER_ACTIVE_COND}
          AND ${orderPaymentBalance_service_1.SQL_ORDER_IN_SALDO_SCOPE}
          AND (${orderPaymentBalance_service_1.SQL_ORDER_SALDO_RESIDUAL}) > 0.005
          AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id)
          ${pedidoOpeningFilter}`;
        const branchNcSistema = `
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          COALESCE(cn.created_at, inv.created_at, o.date) AS fecha,
          'NOTA_CREDITO' AS tipo,
          CONCAT(
            CASE
              WHEN cn.cbte_tipo = 3 THEN 'NC A '
              WHEN cn.cbte_tipo = 8 THEN 'NC B '
              WHEN cn.cbte_tipo = 13 THEN 'NC C '
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
        LEFT JOIN invoices inv ON inv.id = cn.invoice_id
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE 1=1 ${ncRangeFilter}`;
        const branchNcSistemaOpening = `
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          COALESCE(cn.created_at, inv.created_at, o.date) AS fecha,
          'NOTA_CREDITO' AS tipo,
          CONCAT(
            CASE
              WHEN cn.cbte_tipo = 3 THEN 'NC A '
              WHEN cn.cbte_tipo = 8 THEN 'NC B '
              WHEN cn.cbte_tipo = 13 THEN 'NC C '
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
        LEFT JOIN invoices inv ON inv.id = cn.invoice_id
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE 1=1 ${ncOpeningFilter}`;
        const branchNcExterna = `
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          COALESCE(ecn.created_at, ei.created_at) AS fecha,
          'NOTA_CREDITO' AS tipo,
          CONCAT(
            CASE
              WHEN ecn.cbte_tipo = 3 THEN 'NC A '
              WHEN ecn.cbte_tipo = 8 THEN 'NC B '
              WHEN ecn.cbte_tipo = 13 THEN 'NC C '
              ELSE 'NC '
            END,
            LPAD(COALESCE(ecn.punto_venta, 0), 5, '0'),
            '-',
            LPAD(COALESCE(ecn.cbte_desde, 0), 8, '0')
          ) AS comprobante,
          ecn.external_order_id AS order_id,
          0 AS debe,
          ROUND(COALESCE(ecn.amount_credited, 0) * 1.21, 2) AS haber
        FROM external_credit_notes ecn
        JOIN external_invoices ei ON ei.id = ecn.external_invoice_id
        JOIN customers c
          ON REPLACE(REPLACE(REPLACE(COALESCE(c.cuit, ''), '-', ''), '.', ''), ' ', '') =
             REPLACE(REPLACE(REPLACE(COALESCE(ei.customer_cuit, ''), '-', ''), '.', ''), ' ', '')
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE REPLACE(REPLACE(REPLACE(COALESCE(ei.customer_cuit, ''), '-', ''), '.', ''), ' ', '') <> ''
          ${externalNcRangeFilter}`;
        const branchNcExternaOpening = `
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          COALESCE(ecn.created_at, ei.created_at) AS fecha,
          'NOTA_CREDITO' AS tipo,
          CONCAT(
            CASE
              WHEN ecn.cbte_tipo = 3 THEN 'NC A '
              WHEN ecn.cbte_tipo = 8 THEN 'NC B '
              WHEN ecn.cbte_tipo = 13 THEN 'NC C '
              ELSE 'NC '
            END,
            LPAD(COALESCE(ecn.punto_venta, 0), 5, '0'),
            '-',
            LPAD(COALESCE(ecn.cbte_desde, 0), 8, '0')
          ) AS comprobante,
          ecn.external_order_id AS order_id,
          0 AS debe,
          ROUND(COALESCE(ecn.amount_credited, 0) * 1.21, 2) AS haber
        FROM external_credit_notes ecn
        JOIN external_invoices ei ON ei.id = ecn.external_invoice_id
        JOIN customers c
          ON REPLACE(REPLACE(REPLACE(COALESCE(c.cuit, ''), '-', ''), '.', ''), ' ', '') =
             REPLACE(REPLACE(REPLACE(COALESCE(ei.customer_cuit, ''), '-', ''), '.', ''), ' ', '')
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE REPLACE(REPLACE(REPLACE(COALESCE(ei.customer_cuit, ''), '-', ''), '.', ''), ' ', '') <> ''
          ${externalNcOpeningFilter}`;
        const branchReciboSistema = `
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
        WHERE 1=1 ${receiptRangeFilter}`;
        const branchReciboSistemaOpening = `
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
        WHERE 1=1 ${receiptOpeningFilter}`;
        const branchManualComprobante = `
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          m.fecha AS fecha,
          CASE WHEN m.tipo = 'NC' THEN 'NOTA_CREDITO' ELSE 'FACTURA' END AS tipo,
          CONCAT(
            CASE
              WHEN m.cbte_tipo IN (1, 3) THEN 'A '
              WHEN m.cbte_tipo IN (6, 8) THEN 'B '
              ELSE ''
            END,
            LPAD(COALESCE(m.punto_venta, 0), 5, '0'),
            '-',
            LPAD(COALESCE(m.cbte_desde, 0), 8, '0')
          ) AS comprobante,
          m.ref_order_id AS order_id,
          CASE
            WHEN m.tipo = 'FACTURA' THEN ROUND(COALESCE(m.importe_neto, 0) + COALESCE(m.agip_ret_per, 0), 2)
            ELSE 0
          END AS debe,
          CASE
            WHEN m.tipo = 'NC' THEN ROUND(COALESCE(m.importe_neto, 0), 2)
            ELSE 0
          END AS haber
        FROM customer_manual_comprobantes m
        JOIN customers c ON c.id = m.customer_id
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE 1=1 ${manualRangeFilter}`;
        const branchManualComprobanteOpening = `
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          m.fecha AS fecha,
          CASE WHEN m.tipo = 'NC' THEN 'NOTA_CREDITO' ELSE 'FACTURA' END AS tipo,
          CONCAT(
            CASE
              WHEN m.cbte_tipo IN (1, 3) THEN 'A '
              WHEN m.cbte_tipo IN (6, 8) THEN 'B '
              ELSE ''
            END,
            LPAD(COALESCE(m.punto_venta, 0), 5, '0'),
            '-',
            LPAD(COALESCE(m.cbte_desde, 0), 8, '0')
          ) AS comprobante,
          m.ref_order_id AS order_id,
          CASE
            WHEN m.tipo = 'FACTURA' THEN ROUND(COALESCE(m.importe_neto, 0) + COALESCE(m.agip_ret_per, 0), 2)
            ELSE 0
          END AS debe,
          CASE
            WHEN m.tipo = 'NC' THEN ROUND(COALESCE(m.importe_neto, 0), 2)
            ELSE 0
          END AS haber
        FROM customer_manual_comprobantes m
        JOIN customers c ON c.id = m.customer_id
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE 1=1 ${manualOpeningFilter}`;
        /**
         * Rama de importados Multimedia (Tango). En modo `tango` no se deduplican recibos
         * contra `payments` porque por definición el export es solo lo importado.
         */
        const dedupeReciboPagos = mode === 'tango'
            ? ''
            : `
          AND NOT (
            UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('REC', 'RECIBO', 'PAGO', 'COBRO', 'INGRESO')
            AND TRIM(COALESCE(e.numero, '')) <> ''
            AND EXISTS (
              SELECT 1
              FROM payments p
              WHERE p.customer_id = e.customer_id
                AND DATE(p.date) = DATE(e.line_date)
                AND ROUND(COALESCE(p.amount, 0), 2) = ROUND(ABS(COALESCE(e.importe, 0)), 2)
                AND UPPER(
                  REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
                ) = CASE
                  WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
                  ELSE UPPER(
                    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
                  )
                END
            )
          )`;
        /**
         * Patrones permisivos para detectar NC importadas de Tango.
         * Tango exporta el "Tipo" tal cual: NC, NCA, NCB, NCC, NCE, N/C, N/CR, CRE, CRED, NOTA CRED,
         * y en muchas instalaciones aparece como CDE (Crédito) o CRÉ. Detectamos por prefijo.
         */
        const isNcImportado = `(
      UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'NC%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'N/C%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'N.C%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'CDE%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'CRE%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'CRÉ%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'NOTA%CRED%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'NOTA%CRÉD%'
      OR UPPER(COALESCE(e.detalle, '')) LIKE '%NOTA%CRED%'
      OR UPPER(COALESCE(e.detalle, '')) LIKE '%NOTA%CRÉD%'
      OR UPPER(COALESCE(e.detalle, '')) LIKE '%N/C%'
      OR UPPER(COALESCE(e.numero, '')) LIKE 'NC %'
      OR UPPER(COALESCE(e.numero, '')) LIKE 'N/C%'
    )`;
        /**
         * Notas de débito. Las dejamos identificadas para que sumen al saldo (DEBE)
         * en lugar de quedar como MOV_IMPORTADO con 0.
         */
        const isNdImportado = `(
      UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'ND%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'N/D%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'DEB%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'DBE%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'DÉB%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'NOTA%DEB%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'NOTA%DÉB%'
      OR UPPER(COALESCE(e.detalle, '')) LIKE '%NOTA%DEB%'
      OR UPPER(COALESCE(e.detalle, '')) LIKE '%NOTA%DÉB%'
    )`;
        const isFacturaImportada = `(
      UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'FAC%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'FC%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'F/A%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('COMP', 'COMPROBANTE')
      OR UPPER(COALESCE(e.detalle, '')) LIKE '%FACTURA%'
      OR UPPER(COALESCE(e.detalle, '')) LIKE '%COMPROBANTE%'
    )`;
        const isReciboImportado = `(
      UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'REC%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('PAGO', 'COBRO', 'INGRESO', 'R/C')
      OR UPPER(COALESCE(e.detalle, '')) LIKE '%RECIBO%'
      OR UPPER(COALESCE(e.detalle, '')) LIKE '%PAGO%'
      OR UPPER(COALESCE(e.detalle, '')) LIKE '%COBRO%'
    )`;
        const branchImportado = `
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          e.line_date AS fecha,
          CASE
            WHEN ${isNcImportado} THEN 'NOTA_CREDITO_IMPORTADA'
            WHEN ${isNdImportado} THEN 'NOTA_DEBITO_IMPORTADA'
            WHEN ${isFacturaImportada} THEN 'FACTURA_IMPORTADA'
            WHEN ${isReciboImportado} THEN 'RECIBO_IMPORTADO'
            ELSE 'MOV_IMPORTADO'
          END AS tipo,
          TRIM(CONCAT(
            COALESCE(NULLIF(TRIM(e.numero), ''), ''),
            CASE WHEN TRIM(COALESCE(e.detalle, '')) <> '' THEN CONCAT(' — ', LEFT(TRIM(e.detalle), 120)) ELSE '' END
          )) AS comprobante,
          NULL AS order_id,
          CASE
            WHEN ${isNcImportado} THEN 0
            WHEN ${isFacturaImportada} THEN ROUND(ABS(COALESCE(e.importe, 0)), 2)
            WHEN ${isNdImportado} THEN ROUND(ABS(COALESCE(e.importe, 0)), 2)
            ELSE 0
          END AS debe,
          CASE
            WHEN ${isNcImportado} THEN ROUND(ABS(COALESCE(e.importe, 0)), 2)
            WHEN ${isReciboImportado} THEN ROUND(ABS(COALESCE(e.importe, 0)), 2)
            ELSE 0
          END AS haber
        FROM customer_multimedia_entries e
        JOIN customers c ON c.id = e.customer_id
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE e.importe IS NOT NULL
          AND ABS(COALESCE(e.importe, 0)) > 0.001
          ${importedRangeFilter}
          AND UPPER(TRIM(COALESCE(e.tipo, ''))) NOT IN ('SALDO AL', 'SALDO_INICIAL', 'SALDO')
          AND (${isNcImportado} OR ${isNdImportado} OR ${isFacturaImportada} OR ${isReciboImportado})${dedupeReciboPagos}`;
        const branchImportadoOpening = `
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          e.line_date AS fecha,
          CASE
            WHEN ${isNcImportado} THEN 'NOTA_CREDITO_IMPORTADA'
            WHEN ${isNdImportado} THEN 'NOTA_DEBITO_IMPORTADA'
            WHEN ${isFacturaImportada} THEN 'FACTURA_IMPORTADA'
            WHEN ${isReciboImportado} THEN 'RECIBO_IMPORTADO'
            ELSE 'MOV_IMPORTADO'
          END AS tipo,
          TRIM(CONCAT(
            COALESCE(NULLIF(TRIM(e.numero), ''), ''),
            CASE WHEN TRIM(COALESCE(e.detalle, '')) <> '' THEN CONCAT(' — ', LEFT(TRIM(e.detalle), 120)) ELSE '' END
          )) AS comprobante,
          NULL AS order_id,
          CASE
            WHEN ${isNcImportado} THEN 0
            WHEN ${isFacturaImportada} THEN ROUND(ABS(COALESCE(e.importe, 0)), 2)
            WHEN ${isNdImportado} THEN ROUND(ABS(COALESCE(e.importe, 0)), 2)
            ELSE 0
          END AS debe,
          CASE
            WHEN ${isNcImportado} THEN ROUND(ABS(COALESCE(e.importe, 0)), 2)
            WHEN ${isReciboImportado} THEN ROUND(ABS(COALESCE(e.importe, 0)), 2)
            ELSE 0
          END AS haber
        FROM customer_multimedia_entries e
        JOIN customers c ON c.id = e.customer_id
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE e.importe IS NOT NULL
          AND ABS(COALESCE(e.importe, 0)) > 0.001
          ${importedOpeningFilter}
          AND UPPER(TRIM(COALESCE(e.tipo, ''))) NOT IN ('SALDO AL', 'SALDO_INICIAL', 'SALDO')
          AND (${isNcImportado} OR ${isNdImportado} OR ${isFacturaImportada} OR ${isReciboImportado})${dedupeReciboPagos}`;
        /**
         * Cada rama aporta los placeholders from/to (si los hay) en este orden.
         * Mantener este array sincronizado con `branchesByMode` define `movementParams`.
         */
        const branchesByMode = {
            historial: [
                branchFacturaSistema,
                branchPedidoSinFactura,
                branchNcSistema,
                branchNcExterna,
                branchReciboSistema,
                branchManualComprobante,
                ...(includeTangoInHistorial ? [branchImportado] : [])
            ],
            sistema: [
                branchFacturaSistema,
                branchPedidoSinFactura,
                branchNcSistema,
                branchReciboSistema,
                branchManualComprobante
            ],
            tango: [branchImportado]
        };
        const branchesOpeningByMode = {
            historial: [
                branchFacturaSistemaOpening,
                branchPedidoSinFacturaOpening,
                branchNcSistemaOpening,
                branchNcExternaOpening,
                branchReciboSistemaOpening,
                branchManualComprobanteOpening,
                ...(includeTangoInHistorial ? [branchImportadoOpening] : [])
            ],
            sistema: [
                branchFacturaSistemaOpening,
                branchPedidoSinFacturaOpening,
                branchNcSistemaOpening,
                branchReciboSistemaOpening,
                branchManualComprobanteOpening
            ],
            tango: [branchImportadoOpening]
        };
        const branches = branchesByMode[mode];
        const openingByCustomer = new Map();
        if (from) {
            const openingBranches = branchesOpeningByMode[mode];
            const openingParams = [];
            for (let b = 0; b < openingBranches.length; b += 1) {
                openingParams.push(from);
            }
            if (sellerIdFilter)
                openingParams.push(sellerIdFilter);
            const openingRows = (yield (0, db_1.query)(`
        SELECT m.customer_id, ROUND(SUM(m.debe - m.haber), 2) AS opening
        FROM (
          ${openingBranches.join('\n          UNION ALL\n')}
        ) m
        ${sellerIdFilter ? 'WHERE m.seller_id = ?' : ''}
        GROUP BY m.customer_id
        `, openingParams));
            for (const r of openingRows) {
                openingByCustomer.set(r.customer_id, Number(r.opening) || 0);
            }
        }
        const movementParams = [];
        for (let b = 0; b < branches.length; b += 1) {
            if (from)
                movementParams.push(from);
            if (to)
                movementParams.push(to);
        }
        if (sellerIdFilter)
            movementParams.push(sellerIdFilter);
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
        ${branches.join('\n        UNION ALL\n')}
      ) m
      ${sellerIdFilter ? 'WHERE m.seller_id = ?' : ''}
      ORDER BY m.customer_name ASC, m.fecha ASC, m.tipo ASC
      `, movementParams);
        const customers = yield (0, db_1.query)(`SELECT c.id, COALESCE(c.business_name, c.name, 'Cliente') AS customer_name, c.seller_id, u.name AS seller_name
       FROM customers c
       LEFT JOIN users u ON u.id = c.seller_id
       ${sellerWhere}
       ORDER BY customer_name ASC`, sellerParams);
        const carteraByCustomerId = yield fetchCarteraSaldoUnificadoMap(sellerIdFilter, user);
        const byCustomer = new Map();
        for (const m of movements) {
            if (!byCustomer.has(m.customer_id))
                byCustomer.set(m.customer_id, []);
            byCustomer.get(m.customer_id).push(m);
        }
        const workbook = new exceljs_1.default.Workbook();
        workbook.creator = 'LupoHub';
        workbook.created = new Date();
        const wsSummary = workbook.addWorksheet('Resumen');
        wsSummary.columns = [
            { header: 'Cliente', key: 'cliente', width: 40 },
            { header: 'Vendedor', key: 'vendedor', width: 28 },
            { header: 'Saldo pendiente', key: 'saldo', width: 18 }
        ];
        wsSummary.getRow(1).font = { bold: true };
        wsSummary.views = [{ state: 'frozen', ySplit: 1 }];
        wsSummary.getColumn('C').numFmt = '#,##0.00';
        const wsDetalle = workbook.addWorksheet('Detalle clientes');
        wsDetalle.columns = [
            { header: 'Fecha', key: 'fecha', width: 14 },
            { header: 'Tipo', key: 'tipo', width: 22 },
            { header: 'Comprobante', key: 'comprobante', width: 36 },
            { header: 'Pedido', key: 'pedido', width: 16 },
            { header: 'Debe', key: 'debe', width: 14 },
            { header: 'Haber', key: 'haber', width: 14 },
            { header: 'Saldo', key: 'saldo', width: 16 }
        ];
        wsDetalle.views = [{ state: 'frozen', ySplit: 1 }];
        wsDetalle.getColumn('A').numFmt = 'dd/mm/yyyy';
        wsDetalle.getColumn('E').numFmt = '#,##0.00';
        wsDetalle.getColumn('F').numFmt = '#,##0.00';
        wsDetalle.getColumn('G').numFmt = '#,##0.00';
        for (const col of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
            wsDetalle.getColumn(col).alignment = { horizontal: 'left', vertical: 'middle' };
        }
        const customersOrdered = [...customers].sort((a, b) => String(a.seller_name || a.seller_id || '').localeCompare(String(b.seller_name || b.seller_id || ''), 'es') ||
            String(a.customer_name || '').localeCompare(String(b.customer_name || ''), 'es'));
        let lastSellerGroup = '';
        for (const c of customersOrdered) {
            const movsRaw = byCustomer.get(c.id) || [];
            const openingBalance = from ? Math.round((openingByCustomer.get(c.id) || 0) * 100) / 100 : 0;
            let movsOrdenados = [...movsRaw].sort((a, b) => {
                const da = new Date(a.fecha || 0).getTime() || 0;
                const db = new Date(b.fecha || 0).getTime() || 0;
                if (da !== db)
                    return da - db;
                return String(a.comprobante || '').localeCompare(String(b.comprobante || ''), 'es');
            });
            let netoAll = 0;
            for (const m of movsOrdenados) {
                netoAll = Math.round((netoAll + Number(m.debe || 0) - Number(m.haber || 0)) * 100) / 100;
            }
            const saldoPeriodoFull = Math.round((openingBalance + netoAll) * 100) / 100;
            const saldoCartera = (_a = carteraByCustomerId.get(c.id)) !== null && _a !== void 0 ? _a : saldoPeriodoFull;
            /** Arranque sintético (saldo inicial LupoHub / diferencia vs cartera) antes de recortar. */
            const syntheticOpening = mode === 'tango' ? 0 : Math.round((saldoCartera - netoAll) * 100) / 100;
            let startSaldo = mode === 'tango' ? 0 : syntheticOpening;
            let cutAtZero = false;
            if (sinceZero) {
                const trimmed = trimMovementsSinceLastZeroBalance(movsOrdenados, mode === 'tango' ? 0 : syntheticOpening);
                movsOrdenados = trimmed.movs;
                startSaldo = trimmed.startSaldo;
                cutAtZero = trimmed.cutAtZero;
            }
            let netoTabla = 0;
            for (const m of movsOrdenados) {
                netoTabla = Math.round((netoTabla + Number(m.debe || 0) - Number(m.haber || 0)) * 100) / 100;
            }
            const saldoPeriodo = Math.round((startSaldo + netoTabla) * 100) / 100;
            // Solo Tango: saldo = neto de movimientos importados (la cartera LupoHub no incluye Tango).
            const saldoExcel = mode === 'tango' ? saldoPeriodo : saldoCartera;
            if (mode === 'tango') {
                if (movsOrdenados.length === 0 && Math.abs(saldoPeriodo) <= 0.005)
                    continue;
            }
            else if (Math.abs(saldoCartera) <= 0.005) {
                continue;
            }
            wsSummary.addRow({
                cliente: c.customer_name,
                vendedor: (_c = (_b = c.seller_name) !== null && _b !== void 0 ? _b : c.seller_id) !== null && _c !== void 0 ? _c : '',
                saldo: saldoExcel
            });
            // Bloque por cliente dentro de una sola hoja para ahorrar páginas al imprimir.
            if (!sellerIdFilter) {
                const sellerGroup = String(c.seller_name || c.seller_id || 'Sin vendedor');
                if (sellerGroup !== lastSellerGroup) {
                    const sellerRow = wsDetalle.addRow([`VENDEDOR: ${sellerGroup}`, '', '', '', '', '', '']);
                    wsDetalle.mergeCells(sellerRow.number, 1, sellerRow.number, 7);
                    sellerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                    sellerRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
                    sellerRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
                    wsDetalle.addRow(['', '', '', '', '', '', '']);
                    lastSellerGroup = sellerGroup;
                }
            }
            const saldoTituloLabel = saldoExcel.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const titleRow = wsDetalle.addRow([
                `CLIENTE: ${c.customer_name}`,
                `VENDEDOR: ${(_e = (_d = c.seller_name) !== null && _d !== void 0 ? _d : c.seller_id) !== null && _e !== void 0 ? _e : '-'}`,
                '',
                '',
                '',
                '',
                `SALDO A COBRAR: ${saldoTituloLabel}`,
            ]);
            wsDetalle.mergeCells(titleRow.number, 1, titleRow.number, 3);
            wsDetalle.mergeCells(titleRow.number, 4, titleRow.number, 6);
            titleRow.font = { bold: true, color: { argb: 'FF0F172A' } };
            titleRow.eachCell((cell) => {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
                cell.alignment = { horizontal: 'left', vertical: 'middle' };
            });
            const blockHeader = wsDetalle.addRow(['Fecha', 'Tipo', 'Comprobante', 'Pedido', 'Debe', 'Haber', 'Saldo']);
            blockHeader.font = { bold: true, color: { argb: 'FF1E293B' } };
            blockHeader.eachCell((cell) => {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
                cell.alignment = { horizontal: 'left', vertical: 'middle' };
            });
            let saldoCorrido = startSaldo;
            // Con desde-cero: arrancamos en 0 (sin «Saldo inicial» opaco). Sino, lógica previa.
            const showSaldoInicioPeriodo = !sinceZero &&
                mode !== 'tango' &&
                ((Boolean(from) && Math.abs(saldoCorrido) > 0.005) ||
                    (movsOrdenados.length > 0 && Math.abs(saldoCorrido) > 0.005));
            if (showSaldoInicioPeriodo) {
                const saldoIniRow = wsDetalle.addRow({
                    fecha: from
                        ? (0, customerOpeningBalance_1.ymdToExcelDate)(from)
                        : movsOrdenados.length > 0
                            ? (0, customerOpeningBalance_1.ymdToExcelDate)(movsOrdenados[0].fecha)
                            : null,
                    tipo: from ? 'Saldo al inicio del período' : 'Saldo inicial',
                    comprobante: '',
                    pedido: '',
                    debe: 0,
                    haber: 0,
                    saldo: saldoCorrido,
                });
                saldoIniRow.font = { italic: true, color: { argb: 'FF64748B' } };
            }
            else if (sinceZero && cutAtZero && movsOrdenados.length > 0) {
                const ceroRow = wsDetalle.addRow({
                    fecha: (0, customerOpeningBalance_1.ymdToExcelDate)(movsOrdenados[0].fecha),
                    tipo: 'Desde saldo en cero',
                    comprobante: '',
                    pedido: '',
                    debe: 0,
                    haber: 0,
                    saldo: 0,
                });
                ceroRow.font = { italic: true, color: { argb: 'FF64748B' } };
            }
            else if (sinceZero && movsOrdenados.length === 0 && Math.abs(saldoExcel) > 0.005) {
                const saldoIniRow = wsDetalle.addRow({
                    fecha: null,
                    tipo: 'Saldo pendiente (sin movimientos posteriores al último cero)',
                    comprobante: '',
                    pedido: '',
                    debe: 0,
                    haber: 0,
                    saldo: saldoExcel,
                });
                saldoIniRow.font = { italic: true, color: { argb: 'FF64748B' } };
            }
            for (let i = 0; i < movsOrdenados.length; i += 1) {
                const m = movsOrdenados[i];
                const debe = Number(m.debe || 0);
                const haber = Number(m.haber || 0);
                saldoCorrido = Math.round((saldoCorrido + debe - haber) * 100) / 100;
                // Sistema/historial sin desde-cero: forzar cierre en cartera LupoHub.
                if (i === movsOrdenados.length - 1 && mode !== 'tango' && !sinceZero) {
                    saldoCorrido = Math.round(saldoCartera * 100) / 100;
                }
                if (i === movsOrdenados.length - 1 && sinceZero && mode !== 'tango') {
                    // Con desde-cero el corrido debe cerrar en la deuda actual.
                    saldoCorrido = Math.round(saldoCartera * 100) / 100;
                }
                wsDetalle.addRow({
                    fecha: (0, customerOpeningBalance_1.ymdToExcelDate)(m.fecha),
                    tipo: labelTipoSaldoExporter(m),
                    comprobante: m.comprobante,
                    pedido: (_f = m.order_id) !== null && _f !== void 0 ? _f : '',
                    debe,
                    haber,
                    saldo: saldoCorrido,
                });
            }
            const saldoResumen = mode === 'tango' ? saldoExcel : saldoCartera;
            const resumenLabelRow = wsDetalle.addRow(['RESUMEN', '', '', '', '', '', '']);
            const mainSaldoRow = wsDetalle.addRow(['Saldo pendiente', '', '', '', '', '', saldoResumen]);
            resumenLabelRow.font = { bold: true };
            mainSaldoRow.getCell(1).font = { bold: true, size: 11 };
            mainSaldoRow.getCell(7).font = { bold: true, size: 12 };
            mainSaldoRow.getCell(7).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFD1FAE5' },
            };
            wsDetalle.mergeCells(resumenLabelRow.number, 1, resumenLabelRow.number, 6);
            wsDetalle.mergeCells(mainSaldoRow.number, 1, mainSaldoRow.number, 6);
            resumenLabelRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
            mainSaldoRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
            wsDetalle.addRow(['', '', '', '', '', '', '']);
        }
        const out = yield workbook.xlsx.writeBuffer();
        const buf = Buffer.from(out instanceof ArrayBuffer ? new Uint8Array(out) : new Uint8Array(out));
        const datePart = new Date().toISOString().slice(0, 10);
        const sellerNameFromFilter = sellerIdFilter && customers.length > 0
            ? String(((_g = customers.find((x) => String(x.seller_id || '') === sellerIdFilter)) === null || _g === void 0 ? void 0 : _g.seller_name) || '').trim()
            : '';
        const sellerLabelRaw = (user.role === 'SELLER' ? String(user.name || '').trim() : '') ||
            sellerNameFromFilter ||
            (sellerIdFilter ? String(sellerIdFilter).trim() : 'todos');
        const sellerLabelSafe = sellerLabelRaw
            .replace(/[\\/:*?"<>|]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const modoLabel = sinceZero ? `${mode}-desde-cero` : mode;
        const filename = `saldos ${modoLabel} - ${sellerLabelSafe || 'todos'} - ${datePart}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(buf);
    }
    catch (error) {
        console.error('exportSaldosPendientesByCustomerSheetsXlsx:', (error === null || error === void 0 ? void 0 : error.message) || error, error === null || error === void 0 ? void 0 : error.sqlMessage);
        return res.status(500).json({
            message: 'Error exportando saldos pendientes por cliente',
            detail: process.env.NODE_ENV === 'production' ? undefined : String((error === null || error === void 0 ? void 0 : error.sqlMessage) || (error === null || error === void 0 ? void 0 : error.message) || error)
        });
    }
});
exports.exportSaldosPendientesByCustomerSheetsXlsx = exportSaldosPendientesByCustomerSheetsXlsx;
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
      SELECT p.customer_id, SUM(${orderPaymentBalance_service_1.SQL_PAYMENT_SALDO_CONTRIBUTION_AMOUNT}) AS total_pagos
      FROM payments p
      INNER JOIN customers c2 ON c2.id = p.customer_id
      WHERE (p.seller_id = ? OR c2.seller_id = ?)
      GROUP BY p.customer_id
    ) pay ON pay.customer_id = t.customerId`
        : `LEFT JOIN (
      SELECT customer_id, SUM(saldo_amount) AS total_pagos
      FROM (
        SELECT p.customer_id, ${orderPaymentBalance_service_1.SQL_PAYMENT_SALDO_CONTRIBUTION_AMOUNT} AS saldo_amount
        FROM payments p
      ) pay_inner
      GROUP BY customer_id
    ) pay ON pay.customer_id = t.customerId`;
    const payParams = user.role === 'SELLER' ? [user.id, user.id] : [];
    const paramsWithNc = [...baseParams, ...payParams];
    const paramsSimple = [...baseParams, ...payParams];
    const payMmJoin = user.role === 'SELLER'
        ? `LEFT JOIN (
      SELECT p.customer_id, SUM(${orderPaymentBalance_service_1.SQL_PAYMENT_SALDO_CONTRIBUTION_AMOUNT}) AS total_pagos
      FROM payments p
      INNER JOIN customers c2 ON c2.id = p.customer_id
      WHERE (p.seller_id = ? OR c2.seller_id = ?)
      GROUP BY p.customer_id
    ) pay_mm ON pay_mm.customer_id = c.id`
        : `LEFT JOIN (
      SELECT customer_id, SUM(saldo_amount) AS total_pagos
      FROM (
        SELECT p.customer_id, ${orderPaymentBalance_service_1.SQL_PAYMENT_SALDO_CONTRIBUTION_AMOUNT} AS saldo_amount
        FROM payments p
      ) pay_inner
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
      ROUND(t.cargosPendientes - COALESCE(pay.total_pagos, 0), 2) AS saldoPendiente,
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
        ${SQL_ORDER_CARGO_PENDIENTE_SUM} AS cargosPendientes,
        COUNT(DISTINCT o.id) AS pedidosPendientes
      FROM customers c
      INNER JOIN orders o ON o.customer_id = c.id
      LEFT JOIN (
        SELECT order_id, SUM(amount_credited) AS cn_total
        FROM credit_notes
        WHERE COALESCE(superseded_by_reinvoice, 0) = 0
        GROUP BY order_id
      ) cn ON cn.order_id = o.id
      WHERE ${SQL_ORDER_ACTIVE_COND}
        AND ${orderPaymentBalance_service_1.SQL_ORDER_IN_SALDO_SCOPE}
        AND ${SQL_ORDER_ACTIVE_COND}
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
      ROUND(t.cargosPendientes - COALESCE(pay.total_pagos, 0), 2) AS saldoPendiente,
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
        SUM(${SQL_ORDER_CARGO_CON_IVA}) AS cargosPendientes,
        COUNT(DISTINCT o.id) AS pedidosPendientes
      FROM customers c
      INNER JOIN orders o ON o.customer_id = c.id
      WHERE ${SQL_ORDER_ACTIVE_COND}
        AND ${orderPaymentBalance_service_1.SQL_ORDER_IN_SALDO_SCOPE}
        AND ${SQL_ORDER_ACTIVE_COND}
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
            saldoPendiente: Math.round((C + 0 - P) * 100) / 100,
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
        const unified = Math.round((C + excelSaldo - P) * 100) / 100;
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
                saldoPendiente: Math.round((0 + excelSaldo - Pmm) * 100) / 100,
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
    const borderSoft = {
        style: 'thin',
        color: { argb: 'FFE2E8F0' }
    };
    const sellerSummary = new Map();
    for (const r of mergedList) {
        const vendedorLabel = (r.account_seller_label != null && String(r.account_seller_label).trim() !== ''
            ? String(r.account_seller_label).trim()
            : '') ||
            (r.seller_id && r.seller_name ? `${String(r.seller_id).slice(0, 8)} - ${r.seller_name}` : '') ||
            'Sin vendedor';
        const zona = r.account_zone != null ? String(r.account_zone).trim() : '';
        const key = `${vendedorLabel}|${zona}`;
        const prev = sellerSummary.get(key) || {
            vendedor: vendedorLabel,
            zonaPrincipal: zona || 'Sin zona',
            clientes: 0,
            pedidos: 0,
            importada: 0,
            recibos: 0,
            saldo: 0,
            movimientos: 0
        };
        prev.clientes += 1;
        prev.pedidos += Number(r.totalCargosPendiente) || 0;
        prev.importada += Number(r.multimediaSaldo) || 0;
        prev.recibos += Number(r.totalPagos) || 0;
        prev.saldo += Number(r.saldoPendiente) || 0;
        prev.movimientos += (Number(r.movementCountExcel) || 0) + (Number(r.pedidosPendientes) || 0);
        sellerSummary.set(key, prev);
    }
    const workbook = new exceljs_1.default.Workbook();
    workbook.creator = 'LupoHub';
    workbook.created = new Date();
    const ws = workbook.addWorksheet('Resumen', {
        views: [{ state: 'frozen', ySplit: 2 }],
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
    const reportDate = new Date().toISOString().slice(0, 10);
    const infoText = `Saldos pendientes por cliente y vendedor | Clientes: ${mergedList.length} | Fecha: ${reportDate}`;
    ws.addRow([infoText, '', '', '', '', '', '', '', '']);
    ws.mergeCells(1, 1, 1, 9);
    const infoCell = ws.getCell('A1');
    infoCell.font = { bold: true, color: { argb: 'FF334155' }, size: 11, name: 'Calibri' };
    infoCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    infoCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEFF6FF' }
    };
    infoCell.border = {
        top: borderSoft,
        left: borderSoft,
        right: borderSoft,
        bottom: borderSoft
    };
    ws.getRow(1).height = 22;
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
    let rowNum = 3;
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
            from: { row: 2, column: 1 },
            to: { row: mergedList.length + 2, column: 9 }
        };
    }
    const wsSeller = workbook.addWorksheet('Resumen por vendedor', {
        views: [{ state: 'frozen', ySplit: 2 }],
        properties: { defaultRowHeight: 19 }
    });
    wsSeller.columns = [
        { key: 'vendedor', width: 28 },
        { key: 'zona', width: 18 },
        { key: 'clientes', width: 12 },
        { key: 'pedidos', width: 16 },
        { key: 'importada', width: 18 },
        { key: 'recibos', width: 16 },
        { key: 'saldo', width: 16 },
        { key: 'movimientos', width: 14 }
    ];
    wsSeller.addRow([`Resumen agrupado por vendedor | Fecha: ${reportDate}`, '', '', '', '', '', '', '']);
    wsSeller.mergeCells(1, 1, 1, 8);
    wsSeller.getCell('A1').font = { bold: true, color: { argb: 'FF334155' }, size: 11, name: 'Calibri' };
    wsSeller.getCell('A1').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEFF6FF' }
    };
    wsSeller.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    wsSeller.getRow(1).height = 22;
    const sellerHeader = wsSeller.addRow([
        'Vendedor habitual',
        'Zona',
        'Clientes',
        'Pedidos',
        'Cuenta importada',
        'Recibos sistema',
        'Saldo final',
        'Movimientos'
    ]);
    sellerHeader.height = 24;
    sellerHeader.eachCell((cell, colNumber) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
        cell.alignment = { vertical: 'middle', horizontal: colNumber >= 3 ? 'right' : 'left', wrapText: true };
        cell.border = {
            top: borderThin,
            left: borderThin,
            bottom: { style: 'medium', color: { argb: 'FF1E3A8A' } },
            right: borderThin
        };
    });
    const sellerRows = [...sellerSummary.values()].sort((a, b) => b.saldo - a.saldo || a.vendedor.localeCompare(b.vendedor, 'es'));
    let sellerRowNum = 3;
    for (const s of sellerRows) {
        const row = wsSeller.addRow([
            s.vendedor,
            s.zonaPrincipal,
            s.clientes,
            Math.round(s.pedidos * 100) / 100,
            Math.round(s.importada * 100) / 100,
            Math.round(s.recibos * 100) / 100,
            Math.round(s.saldo * 100) / 100,
            s.movimientos
        ]);
        const zebra = sellerRowNum % 2 === 0;
        row.eachCell((cell, colNumber) => {
            cell.font = { size: 11, name: 'Calibri', color: { argb: 'FF0F172A' } };
            if (zebra)
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
            cell.border = { top: borderThin, left: borderThin, bottom: borderThin, right: borderThin };
            cell.alignment = { vertical: 'middle', horizontal: colNumber >= 3 ? 'right' : 'left' };
            if ([4, 5, 6, 7].includes(colNumber))
                cell.numFmt = '#,##0.00';
            if ([3, 8].includes(colNumber))
                cell.numFmt = '0';
        });
        sellerRowNum++;
    }
    if (sellerRows.length > 0) {
        wsSeller.autoFilter = {
            from: { row: 2, column: 1 },
            to: { row: sellerRows.length + 2, column: 8 }
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
 *  - Si quantity > picked y picked > 0, deja quantity = picked (solo lo enviado)
 *  - Elimina solo renglones que ya estaban en 0 (nunca pedidos)
 *  - No toca pedidos ya facturados en AFIP
 *  - Recalcula total del pedido
 */
/**
 * Ajusta el saldo pendiente unificado de un cliente modificando solo el saldo inicial.
 * No elimina facturas ni comprobantes: el historial queda intacto.
 */
const adjustCustomerSaldo = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const authUser = req.user;
        if (!authUser || authUser.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden ajustar saldos' });
        }
        const { id: customerId } = req.params;
        if (!customerId)
            return res.status(400).json({ message: 'ID de cliente requerido' });
        const customer = yield (0, db_1.get)('SELECT id FROM customers WHERE id = ?', [customerId]);
        if (!customer)
            return res.status(404).json({ message: 'Cliente no encontrado' });
        const rawTarget = (_a = req.body) === null || _a === void 0 ? void 0 : _a.targetSaldo;
        if (rawTarget === undefined || rawTarget === null || String(rawTarget).trim() === '') {
            return res.status(400).json({ message: 'Indicá targetSaldo (importe objetivo)' });
        }
        const parsedTarget = (0, customerOpeningBalance_1.parseOpeningBalanceInput)(rawTarget);
        if (parsedTarget === null) {
            return res.status(400).json({ message: 'targetSaldo debe ser un importe válido' });
        }
        const targetSaldo = Math.round(parsedTarget * 100) / 100;
        const before = yield queryCarteraTotalsForCustomer(customerId, authUser);
        if (!before)
            return res.status(404).json({ message: 'Cliente no encontrado' });
        const movementSaldo = Math.round((before.orderCargosPendientes - before.totalNotasCredito - before.totalPagos) * 100) / 100;
        const newOpeningBalance = Math.round((targetSaldo - movementSaldo) * 100) / 100;
        yield (0, db_1.execute)(`UPDATE customers SET opening_balance = ? WHERE id = ?`, [
            newOpeningBalance,
            customerId
        ]);
        const after = yield queryCarteraTotalsForCustomer(customerId, authUser);
        return res.json({
            ok: true,
            customerId,
            targetSaldo,
            previousSaldo: before.saldoPendienteUnificado,
            previousOpeningBalance: before.openingBalance,
            newSaldo: (_b = after === null || after === void 0 ? void 0 : after.saldoPendienteUnificado) !== null && _b !== void 0 ? _b : targetSaldo,
            newOpeningBalance
        });
    }
    catch (error) {
        console.error('adjustCustomerSaldo:', error);
        return res.status(500).json({ message: 'Error ajustando saldo del cliente' });
    }
});
exports.adjustCustomerSaldo = adjustCustomerSaldo;
function parseAfipCbteFchToYmd(v) {
    const s = String(v !== null && v !== void 0 ? v : '').replace(/\D/g, '');
    if (s.length !== 8)
        return null;
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
function orderDateToYmd(v) {
    if (!v)
        return null;
    if (v instanceof Date && !Number.isNaN(v.getTime()))
        return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso)
        return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const ar = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (ar)
        return `${ar[3]}-${ar[2].padStart(2, '0')}-${ar[1].padStart(2, '0')}`;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
function ymdToMysqlDatetime(ymd) {
    if (!ymd)
        return null;
    return `${ymd} 12:00:00`;
}
function daysBetweenYmd(a, b) {
    const ta = new Date(`${a}T12:00:00Z`).getTime();
    const tb = new Date(`${b}T12:00:00Z`).getTime();
    return Math.round(Math.abs(ta - tb) / 86400000);
}
function extractAgipFromAfipVoucher(r) {
    var _a, _b, _c, _d, _e, _f;
    const impTrib = Number((_b = (_a = r.ImpTrib) !== null && _a !== void 0 ? _a : r.impTrib) !== null && _b !== void 0 ? _b : 0);
    if (impTrib > 0.005)
        return Math.round(impTrib * 100) / 100;
    const raw = (_d = (_c = r.Tributos) === null || _c === void 0 ? void 0 : _c.Tributo) !== null && _d !== void 0 ? _d : r.tributos;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    let sum = 0;
    for (const t of list) {
        const row = t;
        sum += Number((_f = (_e = row.Importe) !== null && _e !== void 0 ? _e : row.importe) !== null && _f !== void 0 ? _f : 0);
    }
    return Math.round(sum * 100) / 100;
}
function voucherDocNro(r) {
    var _a, _b;
    return (0, multimediaHistorialExcel_1.normalizeCuitDigits)(String((_b = (_a = r.DocNro) !== null && _a !== void 0 ? _a : r.docNro) !== null && _b !== void 0 ? _b : ''));
}
/** Punto de venta 21 es el usado en cartera LupoHub; se suma el configurado en AFIP_PTO_VTA. */
function lupohubPuntosDeVenta() {
    const fromEnv = (0, afip_service_1.getAfipPuntoVenta)();
    return Array.from(new Set([21, fromEnv].filter((n) => Number.isFinite(n) && n > 0)));
}
function preferCbteTipoForCustomer(condicionIva) {
    const c = String(condicionIva || '').toUpperCase();
    if (c.includes('RESPONSABLE') && c.includes('INSCRIPT'))
        return 1;
    if (/\bRI\b/.test(c) || c.includes('INSCRIPTO'))
        return 1;
    return 6;
}
function parseComprobanteRef(ref) {
    const raw = String(ref || '').trim().toUpperCase();
    if (!raw)
        return null;
    let cbteTipo;
    if (raw.startsWith('NC A') || raw.startsWith('A '))
        cbteTipo = 1;
    else if (raw.startsWith('NC B') || raw.startsWith('B '))
        cbteTipo = 6;
    const m = raw.match(/(\d{4,5})\s*[-/]\s*(\d{1,8})/);
    if (!m)
        return null;
    const puntoVta = Number(m[1]);
    const cbteDesde = Number(m[2]);
    if (!Number.isFinite(puntoVta) || !Number.isFinite(cbteDesde) || cbteDesde <= 0)
        return null;
    return { puntoVta, cbteDesde, cbteTipo };
}
function invoiceComprobanteExists(puntoVta, cbteTipo, cbteDesde) {
    return __awaiter(this, void 0, void 0, function* () {
        return (yield (0, db_1.get)(`SELECT id, order_id FROM invoices
     WHERE punto_venta = ? AND cbte_tipo = ? AND cbte_desde = ?
     LIMIT 1`, [puntoVta, cbteTipo, cbteDesde]));
    });
}
function insertRestoredLupohubInvoice(params) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const existing = yield (0, db_1.get)(`SELECT id FROM invoices WHERE order_id = ? LIMIT 1`, [params.orderId]);
        if (existing)
            return;
        const invoiceId = (0, uuid_1.v4)();
        const createdAt = params.invoiceCreatedAt && String(params.invoiceCreatedAt).trim()
            ? String(params.invoiceCreatedAt).trim()
            : null;
        yield (0, db_1.execute)(`INSERT INTO invoices (id, order_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, agip_alicuota, agip_ret_per${createdAt ? ', created_at' : ''})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?${createdAt ? ', ?' : ''})`, [
            invoiceId,
            params.orderId,
            params.cae,
            params.caeFchVto,
            params.puntoVta,
            params.cbteTipo,
            params.cbteDesde,
            params.cbteHasta,
            (_a = params.agipAlicuota) !== null && _a !== void 0 ? _a : 0,
            params.agipRetPer,
            ...(createdAt ? [createdAt] : [])
        ]);
        yield (0, orderPaymentBalance_service_1.syncOrderPaymentStatus)(params.orderId);
    });
}
/** Corrige facturas restauradas cuya created_at quedó en la fecha de restauración en lugar de la del pedido. */
function fixRestoredInvoiceDatesForCustomer(customerId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const result = yield (0, db_1.execute)(`UPDATE invoices i
     INNER JOIN orders o ON o.id = i.order_id
     SET i.created_at = o.date
     WHERE o.customer_id = ?
       AND o.date IS NOT NULL
       AND DATE(i.created_at) > DATE_ADD(o.date, INTERVAL 3 DAY)`, [customerId]);
        return Number((_a = result === null || result === void 0 ? void 0 : result.affectedRows) !== null && _a !== void 0 ? _a : 0);
    });
}
function restoreLupohubInvoiceFromAfipVoucher(orderId, puntoVta, cbteTipo, cbteDesde, knownCae) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        const linked = yield invoiceComprobanteExists(puntoVta, cbteTipo, cbteDesde);
        if (linked)
            return null;
        if (yield (0, db_1.get)(`SELECT id FROM invoices WHERE order_id = ? LIMIT 1`, [orderId]))
            return null;
        let cae = String(knownCae || '').trim();
        let caeFchVto = null;
        let cbteHasta = cbteDesde;
        let agip = 0;
        let invoiceDateYmd = null;
        const orderRow = (yield (0, db_1.get)(`SELECT date FROM orders WHERE id = ?`, [orderId]));
        invoiceDateYmd = orderDateToYmd(orderRow === null || orderRow === void 0 ? void 0 : orderRow.date);
        if ((0, afip_service_1.isAfipConfigured)()) {
            try {
                const consulta = yield (0, afip_service_1.consultarComprobanteAfip)(puntoVta, cbteTipo, cbteDesde);
                if (consulta.existe && consulta.resultado) {
                    const r = consulta.resultado;
                    cae = String((_b = (_a = r.CodAutorizacion) !== null && _a !== void 0 ? _a : r.codAutorizacion) !== null && _b !== void 0 ? _b : cae).trim();
                    const caeFchVtoRaw = (_f = (_e = (_d = (_c = r.FchVto) !== null && _c !== void 0 ? _c : r.fchVto) !== null && _d !== void 0 ? _d : r.CaeFchVto) !== null && _e !== void 0 ? _e : r.caeFchVto) !== null && _f !== void 0 ? _f : null;
                    caeFchVto =
                        caeFchVtoRaw != null && String(caeFchVtoRaw).trim() !== ''
                            ? String(caeFchVtoRaw).trim()
                            : null;
                    cbteHasta = Number((_h = (_g = r.CbteHasta) !== null && _g !== void 0 ? _g : r.cbteHasta) !== null && _h !== void 0 ? _h : cbteDesde) || cbteDesde;
                    agip = extractAgipFromAfipVoucher(r);
                    const cbteFch = parseAfipCbteFchToYmd((_j = r.CbteFch) !== null && _j !== void 0 ? _j : r.cbteFch);
                    if (cbteFch)
                        invoiceDateYmd = cbteFch;
                }
            }
            catch (_k) {
                // Si AFIP no responde pero tenemos CAE del snapshot interno, igual insertamos.
            }
        }
        if (!cae)
            return null;
        yield insertRestoredLupohubInvoice({
            orderId,
            cae,
            caeFchVto,
            puntoVta,
            cbteTipo,
            cbteDesde,
            cbteHasta,
            agipRetPer: agip,
            invoiceCreatedAt: ymdToMysqlDatetime(invoiceDateYmd)
        });
        return { orderId, cbteTipo, cbteDesde, puntoVenta: puntoVta, cae, source: knownCae ? 'credit_note_snapshot' : 'afip' };
    });
}
function fetchPendingLupohubOrders(customerId) {
    return __awaiter(this, void 0, void 0, function* () {
        const rows = (yield (0, db_1.query)(`SELECT o.id, o.date, ROUND((${SQL_ORDER_NETO_GRAVADO}), 2) AS order_neto
     FROM orders o
     WHERE o.customer_id = ?
       AND o.status NOT IN ('Cancelado', 'Borrador')
       AND (o.archived = 0 OR o.archived IS NULL)
       AND o.status IN ('Falta controlar', 'Controlado', 'Despachado', 'En camino', 'Entregado')
       AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id)
     ORDER BY o.date ASC, o.id ASC`, [customerId]));
        return rows.map((o) => ({
            id: o.id,
            dateYmd: orderDateToYmd(o.date),
            orderNeto: Number(o.order_neto || 0)
        }));
    });
}
function restoreFromCreditNoteSnapshots(customerId) {
    return __awaiter(this, void 0, void 0, function* () {
        const rows = (yield (0, db_1.query)(`SELECT
       cn.order_id,
       cn.voided_invoice_cae,
       cn.voided_invoice_punto_venta,
       cn.voided_invoice_cbte_tipo,
       cn.voided_invoice_cbte_desde
     FROM credit_notes cn
     INNER JOIN orders o ON o.id = cn.order_id
     WHERE o.customer_id = ?
       AND cn.voided_invoice_cae IS NOT NULL
       AND TRIM(cn.voided_invoice_cae) <> ''
       AND cn.voided_invoice_cbte_desde IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = cn.order_id)
     GROUP BY cn.order_id, cn.voided_invoice_cae, cn.voided_invoice_punto_venta,
              cn.voided_invoice_cbte_tipo, cn.voided_invoice_cbte_desde`, [customerId]));
        const restored = [];
        for (const row of rows) {
            const puntoVta = Number(row.voided_invoice_punto_venta) || 21;
            const cbteTipo = Number(row.voided_invoice_cbte_tipo) || 6;
            const cbteDesde = Number(row.voided_invoice_cbte_desde);
            if (!Number.isFinite(cbteDesde) || cbteDesde <= 0)
                continue;
            const hit = yield restoreLupohubInvoiceFromAfipVoucher(row.order_id, puntoVta, cbteTipo, cbteDesde, row.voided_invoice_cae);
            if (hit)
                restored.push(Object.assign(Object.assign({}, hit), { source: 'credit_note_snapshot' }));
        }
        return restored;
    });
}
function restoreFromPaymentInvoiceRefs(customerId, unmatched) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const rows = (yield (0, db_1.query)(`SELECT p.order_id, pir.invoice_ref
     FROM payments p
     INNER JOIN payment_invoice_refs pir ON pir.payment_id = p.id
     WHERE p.customer_id = ?
       AND TRIM(COALESCE(pir.invoice_ref, '')) <> ''`, [customerId]));
        const restored = [];
        for (const row of rows) {
            const parsed = parseComprobanteRef(row.invoice_ref);
            if (!parsed)
                continue;
            const cbteTipo = (_a = parsed.cbteTipo) !== null && _a !== void 0 ? _a : 6;
            let orderId = row.order_id ? String(row.order_id) : '';
            if (!orderId || !unmatched.has(orderId)) {
                // Sin pedido explícito: no adivinamos comprobante solo por ref de cobro importado.
                continue;
            }
            const hit = yield restoreLupohubInvoiceFromAfipVoucher(orderId, parsed.puntoVta, cbteTipo, parsed.cbteDesde);
            if (hit) {
                restored.push(Object.assign(Object.assign({}, hit), { source: 'payment_ref' }));
                unmatched.delete(orderId);
            }
        }
        return restored;
    });
}
function restoreFromAfipScan(customerCuit, unmatched, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
        const restored = [];
        let scanned = 0;
        const puntosVenta = lupohubPuntosDeVenta();
        for (const puntoVta of puntosVenta) {
            for (const cbteTipo of opts.cbteTipos) {
                let last = 0;
                try {
                    last = yield (0, afip_service_1.getLastAfipVoucherNumber)(puntoVta, cbteTipo);
                }
                catch (err) {
                    console.warn(`restoreFromAfipScan getLastVoucher ${puntoVta}/${cbteTipo}:`, (err === null || err === void 0 ? void 0 : err.message) || err);
                    continue;
                }
                const minNro = Math.max(1, last - opts.maxScan + 1);
                for (let cbteNro = last; cbteNro >= minNro; cbteNro -= 1) {
                    if (unmatched.size === 0)
                        break;
                    scanned += 1;
                    let consulta;
                    try {
                        consulta = yield (0, afip_service_1.consultarComprobanteAfip)(puntoVta, cbteTipo, cbteNro);
                    }
                    catch (_m) {
                        continue;
                    }
                    if (!consulta.existe || !consulta.resultado)
                        continue;
                    const r = consulta.resultado;
                    if (voucherDocNro(r) !== customerCuit)
                        continue;
                    const linked = yield invoiceComprobanteExists(puntoVta, cbteTipo, cbteNro);
                    if (linked) {
                        unmatched.delete(linked.order_id);
                        continue;
                    }
                    const cbteFch = parseAfipCbteFchToYmd((_a = r.CbteFch) !== null && _a !== void 0 ? _a : r.cbteFch);
                    const impTotal = Math.round(Number((_c = (_b = r.ImpTotal) !== null && _b !== void 0 ? _b : r.impTotal) !== null && _c !== void 0 ? _c : 0) * 100) / 100;
                    const agip = extractAgipFromAfipVoucher(r);
                    let bestOrderId = null;
                    let bestScore = Number.POSITIVE_INFINITY;
                    for (const [orderId, ord] of unmatched) {
                        if (!ord.dateYmd || !cbteFch)
                            continue;
                        const dayDiff = daysBetweenYmd(ord.dateYmd, cbteFch);
                        if (dayDiff > 60)
                            continue;
                        const expected = (0, orderPricing_1.invoiceLedgerImporte)(ord.orderNeto, agip);
                        const amountDiff = Math.abs(expected - impTotal);
                        if (amountDiff > 5)
                            continue;
                        const score = dayDiff * 100 + amountDiff;
                        if (score < bestScore) {
                            bestScore = score;
                            bestOrderId = orderId;
                        }
                    }
                    if (!bestOrderId)
                        continue;
                    const cae = String((_e = (_d = r.CodAutorizacion) !== null && _d !== void 0 ? _d : r.codAutorizacion) !== null && _e !== void 0 ? _e : '').trim();
                    if (!cae)
                        continue;
                    const caeFchVtoRaw = (_j = (_h = (_g = (_f = r.FchVto) !== null && _f !== void 0 ? _f : r.fchVto) !== null && _g !== void 0 ? _g : r.CaeFchVto) !== null && _h !== void 0 ? _h : r.caeFchVto) !== null && _j !== void 0 ? _j : null;
                    const caeFchVto = caeFchVtoRaw != null && String(caeFchVtoRaw).trim() !== ''
                        ? String(caeFchVtoRaw).trim()
                        : null;
                    const cbteHasta = Number((_l = (_k = r.CbteHasta) !== null && _k !== void 0 ? _k : r.cbteHasta) !== null && _l !== void 0 ? _l : cbteNro) || cbteNro;
                    yield insertRestoredLupohubInvoice({
                        orderId: bestOrderId,
                        cae,
                        caeFchVto,
                        puntoVta,
                        cbteTipo,
                        cbteDesde: cbteNro,
                        cbteHasta,
                        agipRetPer: agip,
                        invoiceCreatedAt: ymdToMysqlDatetime(cbteFch)
                    });
                    unmatched.delete(bestOrderId);
                    restored.push({
                        orderId: bestOrderId,
                        cbteTipo,
                        cbteDesde: cbteNro,
                        puntoVenta: puntoVta,
                        cae,
                        source: 'afip'
                    });
                }
            }
        }
        return { restored, scanned };
    });
}
function restoreLupohubInvoicesForCustomerId(customerId, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        const customer = (yield (0, db_1.get)(`SELECT id, cuit, business_name, name, condicion_iva FROM customers WHERE id = ?`, [customerId]));
        if (!customer) {
            throw Object.assign(new Error('Cliente no encontrado'), { status: 404 });
        }
        const customerCuit = (0, multimediaHistorialExcel_1.normalizeCuitDigits)(customer.cuit || '');
        if (!customerCuit) {
            throw Object.assign(new Error('El cliente no tiene CUIT cargado'), { status: 400 });
        }
        const maxScan = Math.min(2500, Math.max(100, Number(opts === null || opts === void 0 ? void 0 : opts.maxScan) || 1200));
        const pendingOrders = yield fetchPendingLupohubOrders(customerId);
        if (pendingOrders.length === 0) {
            const invoiceDatesFixed = yield fixRestoredInvoiceDatesForCustomer(customerId);
            return {
                customerId,
                customerName: customer.business_name || customer.name || customerId,
                restored: 0,
                pendingOrders: 0,
                stillPending: 0,
                scanned: 0,
                details: [],
                invoiceDatesFixed,
                message: invoiceDatesFixed > 0
                    ? `Se corrigieron ${invoiceDatesFixed} fecha(s) de factura restaurada(s)`
                    : 'No hay pedidos LupoHub sin factura para restaurar'
            };
        }
        const unmatched = new Map(pendingOrders.map((o) => [o.id, o]));
        const details = [];
        for (const row of yield restoreFromCreditNoteSnapshots(customerId)) {
            details.push(row);
            unmatched.delete(row.orderId);
        }
        for (const row of yield restoreFromPaymentInvoiceRefs(customerId, unmatched)) {
            details.push(row);
        }
        let scanned = 0;
        if (unmatched.size > 0 && (0, afip_service_1.isAfipConfigured)()) {
            const preferred = preferCbteTipoForCustomer(customer.condicion_iva);
            const cbteTipos = preferred === 1 ? [1, 6] : [6, 1];
            const afip = yield restoreFromAfipScan(customerCuit, unmatched, { maxScan, cbteTipos });
            details.push(...afip.restored);
            scanned = afip.scanned;
        }
        const invoiceDatesFixed = yield fixRestoredInvoiceDatesForCustomer(customerId);
        return {
            customerId,
            customerName: customer.business_name || customer.name || customerId,
            restored: details.length,
            pendingOrders: pendingOrders.length,
            stillPending: unmatched.size,
            scanned,
            details,
            invoiceDatesFixed
        };
    });
}
/**
 * Restaura facturas emitidas en LupoHub (pedidos sin registro en `invoices`) desde datos internos y AFIP.
 */
const restoreCustomerAfipInvoices = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const authUser = req.user;
        if (!authUser || authUser.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden restaurar facturas' });
        }
        const customerId = String(((_a = req.params) === null || _a === void 0 ? void 0 : _a.id) || '').trim();
        if (!customerId)
            return res.status(400).json({ message: 'ID de cliente requerido' });
        const maxScan = Number((_b = req.body) === null || _b === void 0 ? void 0 : _b.maxScan) || undefined;
        const result = yield restoreLupohubInvoicesForCustomerId(customerId, { maxScan });
        return res.json(Object.assign({ ok: true }, result));
    }
    catch (error) {
        const status = Number(error === null || error === void 0 ? void 0 : error.status) || 500;
        if (status !== 500) {
            return res.status(status).json({ message: (error === null || error === void 0 ? void 0 : error.message) || 'No se pudieron restaurar las facturas' });
        }
        console.error('restoreCustomerAfipInvoices:', error);
        return res.status(500).json({ message: (error === null || error === void 0 ? void 0 : error.message) || 'Error restaurando facturas LupoHub' });
    }
});
exports.restoreCustomerAfipInvoices = restoreCustomerAfipInvoices;
/** Restaura facturas LupoHub para todos los clientes con pedidos facturables sin registro en `invoices`. */
const restoreAllLupohubInvoices = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const authUser = req.user;
        if (!authUser || authUser.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden restaurar facturas' });
        }
        if (!(0, afip_service_1.isAfipConfigured)()) {
            return res.status(503).json({ message: 'AFIP no está configurado en el servidor' });
        }
        const maxScan = Math.min(2500, Math.max(100, Number((_a = req.body) === null || _a === void 0 ? void 0 : _a.maxScan) || 800));
        const customerRows = (yield (0, db_1.query)(`SELECT DISTINCT o.customer_id AS customerId
       FROM orders o
       INNER JOIN customers c ON c.id = o.customer_id
       WHERE o.status NOT IN ('Cancelado', 'Borrador')
         AND (o.archived = 0 OR o.archived IS NULL)
         AND o.status IN ('Falta controlar', 'Controlado', 'Despachado', 'En camino', 'Entregado')
         AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id)
         AND TRIM(COALESCE(c.cuit, '')) <> ''
       ORDER BY o.customer_id ASC`));
        const results = [];
        let totalRestored = 0;
        for (const row of customerRows) {
            const r = yield restoreLupohubInvoicesForCustomerId(row.customerId, { maxScan });
            results.push(r);
            totalRestored += r.restored;
        }
        return res.json({
            ok: true,
            customersProcessed: results.length,
            totalRestored,
            results
        });
    }
    catch (error) {
        console.error('restoreAllLupohubInvoices:', error);
        return res.status(500).json({ message: (error === null || error === void 0 ? void 0 : error.message) || 'Error restaurando facturas LupoHub' });
    }
});
exports.restoreAllLupohubInvoices = restoreAllLupohubInvoices;
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
        const dispatchedOrders = yield (0, db_1.query)(`SELECT o.id FROM orders o
       WHERE o.customer_id = ?
         AND o.status IN ('Despachado', 'DISPATCHED')
         AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id)`, [customerId]);
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
           WHERE order_id = ?
             AND COALESCE(picked, 0) > 0
             AND quantity > COALESCE(picked, 0)`, [orderId]);
                itemsAdjusted += toAdjust;
            }
            const beforeDelete = yield (0, db_1.get)(`SELECT COUNT(*) AS cnt
         FROM order_items
         WHERE order_id = ?
           AND COALESCE(quantity, 0) <= 0
           AND COALESCE(picked, 0) <= 0`, [orderId]);
            const toDelete = Number((beforeDelete === null || beforeDelete === void 0 ? void 0 : beforeDelete.cnt) || 0);
            if (toDelete > 0) {
                yield (0, db_1.execute)(`DELETE FROM order_items
           WHERE order_id = ?
             AND COALESCE(quantity, 0) <= 0
             AND COALESCE(picked, 0) <= 0`, [orderId]);
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
function buildCustomerFinancialSummary(customerId, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const includeTangoImport = (_a = opts === null || opts === void 0 ? void 0 : opts.includeTangoImport) !== null && _a !== void 0 ? _a : carteraImportedSql_1.INCLUDE_TANGO_IMPORT_IN_SYSTEM;
        const custOpening = (yield (0, db_1.get)(`SELECT opening_balance, opening_balance_date FROM customers WHERE id = ?`, [customerId]));
        const openingBalance = (custOpening === null || custOpening === void 0 ? void 0 : custOpening.opening_balance) != null && custOpening.opening_balance !== ''
            ? Math.round(Number(custOpening.opening_balance) * 100) / 100
            : 0;
        const openingBalanceDate = (0, customerOpeningBalance_1.normalizeYmdDate)(custOpening === null || custOpening === void 0 ? void 0 : custOpening.opening_balance_date);
        const movements = (yield (0, db_1.query)(`
    SELECT
      m.fecha,
      m.tipo,
      m.comprobante,
      m.order_id AS orderId,
      m.debe,
      m.haber,
      m.detalle,
      m.superseded_by_reinvoice
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
        ${(0, orderPricing_1.sqlInvoiceAmountFromOrderTotal)()} AS debe,
        0 AS haber,
        CONCAT('Pedido ', COALESCE(o.id, '')) AS detalle,
        0 AS superseded_by_reinvoice
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
        ROUND(COALESCE(cn.amount_credited, 0) * 1.21, 2) AS haber,
        CONCAT('NC sobre pedido ', COALESCE(cn.order_id, '')) AS detalle,
        COALESCE(cn.superseded_by_reinvoice, 0) AS superseded_by_reinvoice
      FROM credit_notes cn
      JOIN orders o ON o.id = cn.order_id
      WHERE o.customer_id = ?

      UNION ALL

      SELECT
        m.fecha AS fecha,
        m.tipo AS tipo,
        CONCAT(
          CASE
            WHEN m.cbte_tipo IN (1, 3) THEN CASE WHEN m.tipo = 'NC' THEN 'NC A ' ELSE 'A ' END
            WHEN m.cbte_tipo IN (6, 8) THEN CASE WHEN m.tipo = 'NC' THEN 'NC B ' ELSE 'B ' END
            ELSE ''
          END,
          LPAD(COALESCE(m.punto_venta, 0), 5, '0'),
          '-',
          LPAD(COALESCE(m.cbte_desde, 0), 8, '0')
        ) AS comprobante,
        m.ref_order_id AS order_id,
        CASE WHEN m.tipo = 'FACTURA' THEN ROUND(m.importe_neto + COALESCE(m.agip_ret_per, 0), 2) ELSE 0 END AS debe,
        CASE WHEN m.tipo = 'NC' THEN ROUND(m.importe_neto, 2) ELSE 0 END AS haber,
        CONCAT('Comprobante manual', COALESCE(CONCAT(' · ', m.notes), '')) AS detalle,
        0 AS superseded_by_reinvoice
      FROM customer_manual_comprobantes m
      WHERE m.customer_id = ?

      UNION ALL

      SELECT
        o.date AS fecha,
        'PEDIDO' AS tipo,
        o.id AS comprobante,
        o.id AS order_id,
        (${orderPaymentBalance_service_1.SQL_ORDER_SALDO_RESIDUAL}) AS debe,
        0 AS haber,
        'Saldo pendiente del pedido' AS detalle,
        0 AS superseded_by_reinvoice
      FROM orders o
      LEFT JOIN (
        SELECT order_id, SUM(amount_credited) AS cn_total
        FROM credit_notes
        WHERE COALESCE(superseded_by_reinvoice, 0) = 0
        GROUP BY order_id
      ) cn ON cn.order_id = o.id
      WHERE o.customer_id = ?
        AND ${SQL_ORDER_ACTIVE_COND}
        AND ${orderPaymentBalance_service_1.SQL_ORDER_IN_SALDO_SCOPE}
        AND (${orderPaymentBalance_service_1.SQL_ORDER_SALDO_RESIDUAL}) > 0.005
        AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id)

      UNION ALL

      SELECT
        p.date AS fecha,
        'RECIBO' AS tipo,
        COALESCE(p.receipt_number, '') AS comprobante,
        p.order_id AS order_id,
        0 AS debe,
        ${orderPaymentBalance_service_1.SQL_PAYMENT_SALDO_CONTRIBUTION_AMOUNT} AS haber,
        COALESCE(p.notes, '') AS detalle,
        0 AS superseded_by_reinvoice
      FROM payments p
      LEFT JOIN (
        SELECT
          e.customer_id,
          DATE(e.line_date) AS line_date,
          ROUND(COALESCE(e.importe, 0), 2) AS amount,
          UPPER(
            REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
          ) AS receipt_norm
        FROM customer_multimedia_entries e
        WHERE UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('REC', 'RECIBO', 'PAGO', 'COBRO', 'INGRESO')
          AND TRIM(COALESCE(e.numero, '')) <> ''
        GROUP BY
          e.customer_id,
          DATE(e.line_date),
          ROUND(COALESCE(e.importe, 0), 2),
          UPPER(
            REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
          )
      ) me_rec
        ON me_rec.customer_id = p.customer_id
       AND me_rec.line_date = DATE(p.date)
       AND me_rec.amount = ROUND(COALESCE(p.amount, 0), 2)
       AND me_rec.receipt_norm = CASE
         WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
         ELSE UPPER(
           REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
         )
       END
      WHERE p.customer_id = ?
        AND me_rec.customer_id IS NULL
        AND ${carteraImportedSql_1.SQL_WHERE_PAYMENT_SOLO_LUPOHUB}
        AND ${SQL_PAYMENT_EXCLUDE_COMMISSION_IMPORT}
    ) m
    ORDER BY m.fecha ASC, m.tipo ASC, m.comprobante ASC
    `, [customerId, customerId, customerId, customerId, customerId]));
        const importedEntries = includeTangoImport
            ? (yield (0, db_1.query)(`
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
    `, [customerId]))
            : [];
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
            const tipo = String(tipoRaw || '').toUpperCase().trim();
            const detalle = String(detalleRaw || '').toUpperCase();
            const raw = `${tipo} ${detalle}`;
            if (tipo === 'N/C' || tipo === 'NC' || /NOTA\s*CRED|N\/C\b/.test(raw))
                return 'NC';
            if (tipo === 'REC' || /RECIBO|COBRO|PAGO|INGRESO|^REC$|^RC\b/.test(raw))
                return 'RECIBO';
            if (tipo === 'FAC' || /FACT|FCA|FCE|DEBITO|COMPROBANTE|^FAC\b/.test(raw))
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
        if (includeTangoImport) {
            for (const e of importedEntries) {
                const tipo = classifyImportedEntry(String(e.tipo_raw || ''), String(e.detalle || ''));
                if (!tipo)
                    continue;
                const importe = Math.round(Math.abs(parseMoney(e.importe)) * 100) / 100;
                if (importe <= 0)
                    continue;
                const debe = tipo === 'FACTURA' ? importe : 0;
                const haber = tipo === 'RECIBO' || tipo === 'NC' ? importe : 0;
                const key = toKey(tipo, e.fecha, e.comprobante, debe, haber);
                if (existingKeys.has(key))
                    continue;
                existingKeys.add(key);
                movements.push({
                    fecha: normalizeDate(e.fecha),
                    tipo,
                    comprobante: (_b = e.comprobante) !== null && _b !== void 0 ? _b : '',
                    orderId: null,
                    debe,
                    haber,
                    detalle: e.detalle ? `Importado: ${e.detalle}` : 'Importado'
                });
            }
        }
        const mapped = movements.map((m) => {
            var _a, _b, _c, _d;
            const debe = Number(m.debe || 0);
            const haber = Number(m.haber || 0);
            const supersededByReinvoice = Number(m.superseded_by_reinvoice || 0) === 1;
            return {
                fecha: (_a = m.fecha) !== null && _a !== void 0 ? _a : null,
                tipo: m.tipo,
                comprobante: (_b = m.comprobante) !== null && _b !== void 0 ? _b : '',
                orderId: (_c = m.orderId) !== null && _c !== void 0 ? _c : null,
                debe,
                haber,
                detalle: (_d = m.detalle) !== null && _d !== void 0 ? _d : '',
                supersededByReinvoice: supersededByReinvoice || undefined
            };
        });
        mapped.sort((a, b) => {
            const da = a.fecha ? new Date(a.fecha).getTime() : 0;
            const db = b.fecha ? new Date(b.fecha).getTime() : 0;
            if (da !== db)
                return da - db;
            return String(a.comprobante || '').localeCompare(String(b.comprobante || ''), 'es');
        });
        // Con Tango: historial completo importado, sin saldo inicial manual de LupoHub
        // (evita mezclar ambas bases y fechas distintas).
        const openingForLedger = includeTangoImport ? 0 : openingBalance;
        const openingDateForLedger = includeTangoImport ? null : openingBalanceDate;
        const periodMovements = mapped.filter((m) => (0, customerOpeningBalance_1.movementOnOrAfterOpeningDate)(m.fecha, openingDateForLedger));
        let totalFacturas = 0;
        let totalNc = 0;
        let totalRecibos = 0;
        for (const m of periodMovements) {
            if (m.tipo === 'FACTURA' || m.tipo === 'PEDIDO')
                totalFacturas += m.debe;
            if (m.tipo === 'NC' && !m.supersededByReinvoice)
                totalNc += m.haber;
            if (m.tipo === 'RECIBO')
                totalRecibos += m.haber;
        }
        totalFacturas = Math.round(totalFacturas * 100) / 100;
        totalNc = Math.round(totalNc * 100) / 100;
        totalRecibos = Math.round(totalRecibos * 100) / 100;
        const saldoPendiente = Math.round((openingForLedger + totalFacturas - totalNc - totalRecibos) * 100) / 100;
        const outMovements = [...periodMovements];
        if (Math.abs(openingForLedger) > 0.005) {
            outMovements.unshift({
                fecha: openingDateForLedger,
                tipo: 'FACTURA',
                comprobante: 'SALDO INICIAL',
                orderId: null,
                debe: openingForLedger > 0 ? openingForLedger : 0,
                haber: openingForLedger < 0 ? Math.abs(openingForLedger) : 0,
                detalle: openingDateForLedger
                    ? `Saldo inicial manual al ${openingDateForLedger.split('-').reverse().join('/')}`
                    : 'Saldo inicial manual'
            });
        }
        return {
            totalFacturas,
            totalNc,
            totalRecibos,
            saldoPendiente,
            movements: outMovements
        };
    });
}
/** Detalle por comprobante: LupoHub + líneas FAC/REC/N/C importadas (deduplicadas). El saldo de cartera usa además el último saldo de cuenta importada. */
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
        const includeTango = String(req.query.includeTango || '')
            .trim()
            .toLowerCase() === '1' ||
            ['true', 'yes', 'si', 'sí'].includes(String(req.query.includeTango || '')
                .trim()
                .toLowerCase());
        const summary = yield buildCustomerFinancialSummary(customerId, { includeTangoImport: includeTango });
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
            detalle: `Facturas: ${summary.totalFacturas.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | NC: ${summary.totalNc.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | Recibos: ${summary.totalRecibos.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${includeTango ? ' | Incluye import Tango' : ' | Solo LupoHub'}`
        });
        ws.addRow({});
        let running = 0;
        for (const m of summary.movements) {
            running = Math.round((running + m.debe - m.haber) * 100) / 100;
            ws.addRow({
                section: 'MOVIMIENTO',
                fecha: (0, customerOpeningBalance_1.ymdToExcelDate)(m.fecha),
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
        const filename = `saldo_facturas_recibos_${includeTango ? 'con_tango_' : ''}${(customer.business_name || customer.name || customer.id).toString().replace(/[^\w\-]+/g, '_').slice(0, 40)}_${new Date().toISOString().slice(0, 10)}.xlsx`;
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
        const entries = carteraImportedSql_1.INCLUDE_TANGO_IMPORT_IN_SYSTEM
            ? (yield (0, db_1.query)(`SELECT e.line_order, e.line_date, e.tipo, e.numero, e.importe, e.saldo, e.detalle
       FROM customer_multimedia_entries e
       WHERE ${entriesWhere.join(' AND ')}
       ORDER BY e.line_date ASC, e.line_order ASC`, entriesParams))
            : [];
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
        const paymentsRows = yield (0, db_1.query)(`SELECT
         p.date,
         p.created_at,
         p.receipt_number,
         p.amount,
         p.notes,
         p.invoice_id,
         p.order_id,
         GROUP_CONCAT(DISTINCT i.cae) AS invoice_caes,
         GROUP_CONCAT(DISTINCT pi.invoice_id) AS invoice_ids,
         GROUP_CONCAT(DISTINCT pir.invoice_ref) AS invoice_refs
       FROM payments p
       LEFT JOIN payment_invoices pi ON pi.payment_id = p.id
       LEFT JOIN payment_invoice_refs pir ON pir.payment_id = p.id
       LEFT JOIN invoices i ON i.id = COALESCE(pi.invoice_id, p.invoice_id)
       WHERE ${paymentsWhere.join(' AND ')}
       GROUP BY p.id, p.date, p.created_at, p.receipt_number, p.amount, p.notes, p.invoice_id, p.order_id
       ORDER BY p.created_at DESC, p.date DESC`, paymentsParams);
        // Mismo criterio de la tarjeta "Saldo pendiente unificado" (sin filtro por fecha).
        const orderAgg = yield (0, db_1.get)(`SELECT
         ROUND(COALESCE(SUM(${orderPaymentBalance_service_1.SQL_ORDER_SALDO_RESIDUAL}), 0), 2) AS facturas_bruto,
         ROUND(COALESCE(SUM(${SQL_ORDER_NC_CREDIT_EXPR}), 0), 2) AS nc_iva
       FROM orders o
       LEFT JOIN (
         SELECT order_id, SUM(amount_credited) AS cn_total
         FROM credit_notes
         GROUP BY order_id
       ) cn ON cn.order_id = o.id
       WHERE o.customer_id = ?
         AND ${SQL_ORDER_ACTIVE_COND}
         AND ${orderPaymentBalance_service_1.SQL_ORDER_IN_SALDO_SCOPE}`, [customerId]);
        const multimediaAgg = carteraImportedSql_1.INCLUDE_TANGO_IMPORT_IN_SYSTEM
            ? (yield (0, db_1.get)(`SELECT CAST(COALESCE(
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
       ) AS DECIMAL(16,2)) AS multimediaSaldo`, [customerId, customerId]))
            : { multimediaSaldo: 0 };
        const paymentsAgg = yield (0, db_1.get)(`SELECT ROUND(COALESCE(SUM(d.amount), 0), 2) AS totalPagos
       FROM (
         SELECT
           p.customer_id,
           ROUND(COALESCE(p.amount, 0), 2) AS amount,
           DATE(p.date) AS pay_date,
           CASE
             WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
             ELSE UPPER(
               REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
             )
           END AS receipt_norm
         FROM payments p
         LEFT JOIN (
           SELECT
             e.customer_id,
             DATE(e.line_date) AS line_date,
             ROUND(COALESCE(e.importe, 0), 2) AS amount,
             UPPER(
               REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
             ) AS receipt_norm
           FROM customer_multimedia_entries e
           WHERE UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('REC', 'RECIBO', 'PAGO', 'COBRO', 'INGRESO')
             AND TRIM(COALESCE(e.numero, '')) <> ''
           GROUP BY
             e.customer_id,
             DATE(e.line_date),
             ROUND(COALESCE(e.importe, 0), 2),
             UPPER(
               REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
             )
         ) me_rec
           ON me_rec.customer_id = p.customer_id
          AND me_rec.line_date = DATE(p.date)
          AND me_rec.amount = ROUND(COALESCE(p.amount, 0), 2)
          AND me_rec.receipt_norm = CASE
            WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
            ELSE UPPER(
              REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
            )
          END
         WHERE p.customer_id = ?
           AND me_rec.customer_id IS NULL
             AND ${carteraImportedSql_1.SQL_WHERE_PAYMENT_SOLO_LUPOHUB}
           AND ${SQL_PAYMENT_UNALLOCATED_COND}
           AND ${SQL_PAYMENT_EXCLUDE_COMMISSION_IMPORT}
         GROUP BY
           p.customer_id,
           DATE(p.date),
           ROUND(COALESCE(p.amount, 0), 2),
           CASE
             WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
             ELSE UPPER(
               REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
             )
           END
       ) d`, [customerId]);
        const manualAgg = yield (0, db_1.get)(`SELECT
         ROUND(COALESCE(SUM(CASE WHEN tipo = 'FACTURA' THEN importe_neto + COALESCE(agip_ret_per, 0) ELSE 0 END), 0), 2) AS manual_fac,
         ROUND(COALESCE(SUM(CASE WHEN tipo = 'NC' THEN importe_neto ELSE 0 END), 0), 2) AS manual_nc
       FROM customer_manual_comprobantes
       WHERE customer_id = ?`, [customerId]);
        const facturasBruto = Number((orderAgg === null || orderAgg === void 0 ? void 0 : orderAgg.facturas_bruto) || 0) + Number((manualAgg === null || manualAgg === void 0 ? void 0 : manualAgg.manual_fac) || 0);
        const ncIva = Number((orderAgg === null || orderAgg === void 0 ? void 0 : orderAgg.nc_iva) || 0) + Number((manualAgg === null || manualAgg === void 0 ? void 0 : manualAgg.manual_nc) || 0);
        const multimediaSaldo = Number((multimediaAgg === null || multimediaAgg === void 0 ? void 0 : multimediaAgg.multimediaSaldo) || 0);
        const totalPagos = Number((paymentsAgg === null || paymentsAgg === void 0 ? void 0 : paymentsAgg.totalPagos) || 0);
        const saldoUnificado = Math.round((multimediaSaldo + facturasBruto - ncIva - totalPagos) * 100) / 100;
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
            detalle: ''
        });
        ws.addRow({ section: '', fecha: '', tipo: '', numero: '', importe: '', detalle: '' });
        const timelineRows = [];
        const normalizeDateKey = (d) => { var _a; return (_a = (0, customerOpeningBalance_1.normalizeYmdDate)(d)) !== null && _a !== void 0 ? _a : ''; };
        const normalizeNumberKey = (v) => String(v || '').trim().toUpperCase();
        const normalizeAmountKey = (v) => Number(v || 0).toFixed(2);
        const normalizeUnifiedType = (tipo) => {
            const t = String(tipo || '').trim().toUpperCase();
            if (t === 'NC' || t === 'NOTA DE CREDITO' || t === 'NOTA DE CRÉDITO')
                return 'NC';
            if (t === 'REC' || t === 'RECIBO' || t === 'PAGO' || t === 'COBRO' || t === 'INGRESO')
                return 'REC';
            if (t === 'FAC' || t === 'FACTURA' || t === 'CARGO')
                return 'FAC';
            return t || '';
        };
        for (const e of entries) {
            const fecha = (0, customerOpeningBalance_1.ymdToExcelDate)(e.line_date);
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
            const fecha = (0, customerOpeningBalance_1.ymdToExcelDate)(o.date);
            const ts = fecha && !Number.isNaN(fecha.getTime()) ? fecha.getTime() : Number.MAX_SAFE_INTEGER;
            timelineRows.push({
                section: 'SISTEMA',
                fecha,
                tipo: 'FAC',
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
            const fecha = (0, customerOpeningBalance_1.ymdToExcelDate)(p.date);
            const ts = fecha && !Number.isNaN(fecha.getTime()) ? fecha.getTime() : Number.MAX_SAFE_INTEGER;
            const caes = Array.from(new Set(String(p.invoice_caes || '').split(',').map((x) => x.trim()).filter(Boolean)));
            const caeFromNumero = String(p.receipt_number || '').trim();
            timelineRows.push({
                section: 'SISTEMA',
                fecha,
                tipo: 'REC',
                numero: (_j = p.receipt_number) !== null && _j !== void 0 ? _j : '',
                importe: Number(p.amount || 0),
                saldo: null,
                detalle: `Factura (CAE): ${caeFromNumero || (caes.length ? caes.join(' | ') : '-')}${p.notes ? ` | ${p.notes}` : ''}`,
                sortTs: ts,
                sortSeq: 2000000,
                sortNumero: String(p.receipt_number || '')
            });
        }
        // Evitar duplicados de REC (importado + sistema) por misma fecha/número/importe.
        // Se prioriza el registro del sistema (sortSeq mayor, detalle más trazable).
        const paymentByKey = new Map();
        const nonPaymentRows = [];
        for (const row of timelineRows) {
            if (row.tipo !== 'REC') {
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
