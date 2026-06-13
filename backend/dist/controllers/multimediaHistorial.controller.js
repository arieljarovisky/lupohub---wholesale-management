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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMultimediaSaldosSummary = exports.getCustomerMultimediaLedger = exports.importMultimediaHistorial = exports.exportMultimediaHistorial = void 0;
const XLSX = __importStar(require("xlsx"));
const uuid_1 = require("uuid");
const db_1 = require("../database/db");
const multimediaHistorialExcel_1 = require("../utils/multimediaHistorialExcel");
const carteraImportedSql_1 = require("../sql/carteraImportedSql");
const orderPricing_1 = require("../config/orderPricing");
const customerOpeningBalance_1 = require("../sql/customerOpeningBalance");
const orderPaymentBalance_service_1 = require("../services/orderPaymentBalance.service");
const ledgerDocType_1 = require("../utils/ledgerDocType");
const ledgerRunningSaldo_1 = require("../utils/ledgerRunningSaldo");
const SQL_ORDER_ACTIVE_COND = `o.status NOT IN ('Cancelado', 'Borrador') AND (o.archived = 0 OR o.archived IS NULL)`;
function normalizeNameForMatch(v) {
    return String(v !== null && v !== void 0 ? v : '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}
function canManage(role) {
    return role === 'ADMIN' || role === 'SELLER' || role === 'WAREHOUSE' || role === 'DEPOSITO';
}
/** Número AFIP al estilo Tango/Multimedias: A00021000000006 (sin guiones). */
function formatLedgerAfipNumero(cbteTipo, puntoVta, cbteDesde) {
    const letra = cbteTipo === 1 || cbteTipo === 3
        ? 'A'
        : cbteTipo === 6 || cbteTipo === 8
            ? 'B'
            : cbteTipo === 11 || cbteTipo === 13
                ? 'C'
                : 'X';
    return `${letra}${String(puntoVta || 0).padStart(5, '0')}${String(cbteDesde || 0).padStart(8, '0')}`;
}
/** Mismo formato que el listado AFIP: 00021-00000012 */
function formatAfipComprobanteNumero(puntoVta, cbteDesde) {
    return `${String(puntoVta || 0).padStart(5, '0')}-${String(cbteDesde || 0).padStart(8, '0')}`;
}
function orderIdFromLedgerDetalle(detalle) {
    const m = String(detalle || '').match(/Pedido\s+(\S+)/i);
    return (m === null || m === void 0 ? void 0 : m[1]) || '';
}
/** Visible si alguna fecha del movimiento cae en o después del saldo inicial. */
function ledgerMovementVisibleAfterOpening(openingYmd, ...dates) {
    if (!openingYmd)
        return true;
    for (const d of dates) {
        if ((0, customerOpeningBalance_1.movementOnOrAfterOpeningDate)(d, openingYmd))
            return true;
    }
    return false;
}
/** Evita que un FAC importado de Tango pise la factura LupoHub del mismo pedido. */
function lupoHubLedgerDedupeExtra(row) {
    if (!String(row.detalle || '').includes('AFIP LupoHub'))
        return '';
    const oid = orderIdFromLedgerDetalle(row.detalle);
    return oid ? `|LH|${oid}` : '';
}
function tryFuzzyNameMatch(normSheet, customerByNorm) {
    if (!normSheet || normSheet.length < 5)
        return null;
    if (customerByNorm.has(normSheet))
        return customerByNorm.get(normSheet);
    for (const [k, v] of customerByNorm) {
        if (k.length < 5)
            continue;
        if (normSheet === k)
            return v;
        if (normSheet.startsWith(k) || k.startsWith(normSheet))
            return v;
        if (k.length >= 8 && normSheet.includes(k))
            return v;
        if (normSheet.length >= 8 && k.includes(normSheet))
            return v;
    }
    return null;
}
function resolveCustomerForSheet(sheetName, parsed, customerByLegacy, customerByNorm, customerByCuit, resumenByCode) {
    return __awaiter(this, void 0, void 0, function* () {
        const fromName = (0, multimediaHistorialExcel_1.parseSheetName)(sheetName);
        const codeCandidates = new Set();
        if (parsed === null || parsed === void 0 ? void 0 : parsed.code)
            codeCandidates.add((0, multimediaHistorialExcel_1.padLegacyCode)(parsed.code));
        if (fromName === null || fromName === void 0 ? void 0 : fromName.code)
            codeCandidates.add((0, multimediaHistorialExcel_1.padLegacyCode)(fromName.code));
        for (const c of codeCandidates) {
            const hit = customerByLegacy.get(c) || customerByLegacy.get(c.replace(/^0+/, '') || '0');
            if (hit)
                return hit;
        }
        const cuitParsed = (0, multimediaHistorialExcel_1.normalizeCuitDigits)((parsed === null || parsed === void 0 ? void 0 : parsed.cuitFromSheet) || '');
        if (cuitParsed.length >= 8) {
            const byCuit = customerByCuit.get(cuitParsed);
            if (byCuit)
                return byCuit;
        }
        for (const c of codeCandidates) {
            const resumenCliente = resumenByCode.get(c);
            if (resumenCliente) {
                const nr = normalizeNameForMatch(resumenCliente);
                if (nr && customerByNorm.has(nr))
                    return customerByNorm.get(nr);
                const fuzzyR = tryFuzzyNameMatch(nr, customerByNorm);
                if (fuzzyR)
                    return fuzzyR;
            }
        }
        const normTitle = normalizeNameForMatch((parsed === null || parsed === void 0 ? void 0 : parsed.businessNameFromTitle) || '');
        if (normTitle && customerByNorm.has(normTitle))
            return customerByNorm.get(normTitle);
        const fuzzyTitle = tryFuzzyNameMatch(normTitle, customerByNorm);
        if (fuzzyTitle)
            return fuzzyTitle;
        if (fromName === null || fromName === void 0 ? void 0 : fromName.restName) {
            const n = normalizeNameForMatch(fromName.restName);
            if (n && customerByNorm.has(n))
                return customerByNorm.get(n);
            const fuzzyN = tryFuzzyNameMatch(n, customerByNorm);
            if (fuzzyN)
                return fuzzyN;
        }
        return null;
    });
}
function movementToSqlDates(m) {
    const lineDate = (0, multimediaHistorialExcel_1.parseArgentineDateDisplay)(m.fecha);
    const vtoRaw = m.vto.trim();
    const vto = vtoRaw ? (0, multimediaHistorialExcel_1.parseArgentineDateDisplay)(vtoRaw) : null;
    return { lineDate, vto };
}
/** GET → Excel mismo formato que historial Multimedias */
const exportMultimediaHistorial = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const user = req.user;
        if (!user || !canManage(user.role)) {
            return res.status(403).json({ message: 'Sin permiso' });
        }
        const sellerFilter = user.role === 'SELLER' ? ' WHERE c.seller_id = ?' : '';
        const params = user.role === 'SELLER' ? [user.id] : [];
        const custRows = (yield (0, db_1.query)(`SELECT c.id, c.legacy_code, c.business_name, c.name, c.account_zone, c.account_seller_label,
              c.seller_id, u.name AS seller_name
       FROM customers c
       LEFT JOIN users u ON u.id = c.seller_id
       ${sellerFilter}
       ORDER BY COALESCE(c.legacy_code, c.business_name, c.name) ASC`, params));
        const resumenRows = [
            ['Código', 'Cliente', 'Vendedor habitual', 'Zona', 'Saldo final', 'Movimientos', 'Hoja'],
        ];
        const sheetsOut = [];
        const usedSheetNames = new Set();
        for (const c of custRows) {
            const code = (c.legacy_code && String(c.legacy_code).trim()) ||
                (String(c.id).replace(/-/g, '').slice(0, 6) || '000000');
            const displayName = (c.business_name || c.name || 'Cliente').trim();
            const baseTitle = (0, multimediaHistorialExcel_1.excelSheetName)(code, displayName);
            let sheetNm = baseTitle.slice(0, 31);
            let dup = 1;
            while (usedSheetNames.has(sheetNm)) {
                const extra = ` (${dup++})`;
                sheetNm = (baseTitle.slice(0, Math.max(1, 31 - extra.length)) + extra).slice(0, 31);
            }
            usedSheetNames.add(sheetNm);
            const entries = (yield (0, db_1.query)(`SELECT line_order, line_date, tipo, numero, edc, vto, importe, saldo, detalle, pagina_pdf
         FROM customer_multimedia_entries
         WHERE customer_id = ?
         ORDER BY line_order ASC, line_date ASC`, [c.id]));
            const vendedor = (c.account_seller_label && String(c.account_seller_label).trim()) ||
                (c.seller_id && c.seller_name ? `${String(c.seller_id).slice(0, 8)} - ${c.seller_name}` : '');
            const zona = (c.account_zone && String(c.account_zone).trim()) || '';
            let saldoFinal = 0;
            let movCount = entries.length;
            if (entries.length > 0) {
                const last = entries[entries.length - 1];
                saldoFinal = Number(last.saldo) || 0;
            }
            resumenRows.push([code, displayName, vendedor, zona, saldoFinal, movCount, sheetNm]);
            const grid = [];
            grid.push([`Cliente ${code} - ${displayName}`, '', '', '', '', '', '', '', '']);
            grid.push([
                'Código',
                code,
                'Vendedor habitual',
                vendedor,
                'Zona',
                zona,
                'Saldo final',
                saldoFinal,
                '',
            ]);
            grid.push(['', '', '', '', '', '', '', '', '']);
            grid.push(['Fecha', 'Tipo', 'Número', 'EDC', 'Vto.', 'Importe', 'Saldo', 'Vendedor / detalle', 'Página PDF']);
            if (entries.length === 0) {
                grid.push(['31/12/2014', 'SALDO AL', '', '', '', '', 0, 'Saldo inicial', 1]);
            }
            else {
                for (const e of entries) {
                    grid.push([
                        (0, multimediaHistorialExcel_1.sqlDateToDisplay)(e.line_date),
                        (_a = e.tipo) !== null && _a !== void 0 ? _a : '',
                        (_b = e.numero) !== null && _b !== void 0 ? _b : '',
                        (_c = e.edc) !== null && _c !== void 0 ? _c : '',
                        e.vto ? (0, multimediaHistorialExcel_1.sqlDateToDisplay)(e.vto) : '',
                        e.importe != null ? Number(e.importe) : '',
                        e.saldo != null ? Number(e.saldo) : '',
                        (_d = e.detalle) !== null && _d !== void 0 ? _d : '',
                        e.pagina_pdf != null && e.pagina_pdf !== '' ? Number(e.pagina_pdf) || e.pagina_pdf : '',
                    ]);
                }
            }
            sheetsOut.push({ name: sheetNm.slice(0, 31), data: grid });
        }
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumenRows), 'Resumen');
        for (const s of sheetsOut) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.data), s.name);
        }
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="historial_clientes_multimedias.xlsx"');
        res.send(buf);
    }
    catch (e) {
        console.error('exportMultimediaHistorial:', e);
        res.status(500).json({ message: 'Error exportando historial', detail: e === null || e === void 0 ? void 0 : e.message });
    }
});
exports.exportMultimediaHistorial = exportMultimediaHistorial;
/** POST multipart file → importa movimientos por cliente */
const importMultimediaHistorial = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    try {
        const user = req.user;
        if (!user || !canManage(user.role)) {
            return res.status(403).json({ message: 'Sin permiso' });
        }
        const file = req.file;
        if (!(file === null || file === void 0 ? void 0 : file.buffer)) {
            return res.status(400).json({ message: 'Subí un archivo .xlsx (campo file)' });
        }
        const wb = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });
        let resumenByCode = new Map();
        const resumenWs = wb.Sheets['Resumen'];
        if (resumenWs) {
            const resumenMatrix = XLSX.utils.sheet_to_json(resumenWs, { header: 1, defval: '' });
            resumenByCode = (0, multimediaHistorialExcel_1.parseResumenCodeToCliente)(resumenMatrix);
        }
        const customers = (yield (0, db_1.query)(`SELECT id, business_name, name, seller_id, legacy_code, cuit FROM customers`));
        const customerByLegacy = new Map();
        const customerByNorm = new Map();
        const customerByCuit = new Map();
        for (const c of customers) {
            if (c.legacy_code) {
                const lc = String(c.legacy_code).trim();
                if (lc) {
                    customerByLegacy.set(lc, { id: c.id, seller_id: (_a = c.seller_id) !== null && _a !== void 0 ? _a : null });
                    customerByLegacy.set((0, multimediaHistorialExcel_1.padLegacyCode)(lc), { id: c.id, seller_id: (_b = c.seller_id) !== null && _b !== void 0 ? _b : null });
                }
            }
            const k1 = normalizeNameForMatch(c.business_name);
            const k2 = normalizeNameForMatch(c.name);
            if (k1 && !customerByNorm.has(k1))
                customerByNorm.set(k1, { id: c.id, seller_id: (_c = c.seller_id) !== null && _c !== void 0 ? _c : null });
            if (k2 && !customerByNorm.has(k2))
                customerByNorm.set(k2, { id: c.id, seller_id: (_d = c.seller_id) !== null && _d !== void 0 ? _d : null });
            const cu = (0, multimediaHistorialExcel_1.normalizeCuitDigits)(c.cuit);
            if (cu.length >= 8 && !customerByCuit.has(cu)) {
                customerByCuit.set(cu, { id: c.id, seller_id: (_e = c.seller_id) !== null && _e !== void 0 ? _e : null });
            }
        }
        let sheetsProcessed = 0;
        let customersUpdated = 0;
        let rowsInserted = 0;
        const notFound = [];
        const skippedSeller = [];
        for (const sheetName of wb.SheetNames) {
            if (sheetName === 'Resumen')
                continue;
            const ws = wb.Sheets[sheetName];
            if (!ws)
                continue;
            const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
            const parsed = (0, multimediaHistorialExcel_1.parseCustomerSheetRows)(matrix);
            if (!parsed)
                continue;
            const cust = yield resolveCustomerForSheet(sheetName, parsed, customerByLegacy, customerByNorm, customerByCuit, resumenByCode);
            if (!cust) {
                notFound.push(sheetName);
                continue;
            }
            if (user.role === 'SELLER' && cust.seller_id !== user.id) {
                skippedSeller.push(sheetName);
                continue;
            }
            sheetsProcessed++;
            const legacy = (0, multimediaHistorialExcel_1.padLegacyCode)(parsed.code || ((_f = (0, multimediaHistorialExcel_1.parseSheetName)(sheetName)) === null || _f === void 0 ? void 0 : _f.code) || '');
            yield (0, db_1.execute)(`UPDATE customers SET legacy_code = ?, account_zone = ?, account_seller_label = ? WHERE id = ?`, [legacy || null, ((_g = parsed.zona) === null || _g === void 0 ? void 0 : _g.trim()) || null, ((_h = parsed.vendedorHabitual) === null || _h === void 0 ? void 0 : _h.trim()) || null, cust.id]);
            customersUpdated++;
            yield (0, db_1.execute)(`DELETE FROM customer_multimedia_entries WHERE customer_id = ?`, [cust.id]);
            let order = 0;
            for (const m of parsed.movements) {
                const { lineDate, vto } = movementToSqlDates(m);
                if (!lineDate)
                    continue;
                const tipo = (m.tipo || '').trim();
                if (!tipo)
                    continue;
                yield (0, db_1.execute)(`INSERT INTO customer_multimedia_entries
           (id, customer_id, line_order, line_date, tipo, numero, edc, vto, importe, saldo, detalle, pagina_pdf)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                    (0, uuid_1.v4)(),
                    cust.id,
                    order++,
                    lineDate,
                    tipo,
                    ((_j = m.numero) === null || _j === void 0 ? void 0 : _j.trim()) || null,
                    ((_k = m.edc) === null || _k === void 0 ? void 0 : _k.trim()) || null,
                    vto,
                    m.importe,
                    m.saldo,
                    ((_l = m.detalle) === null || _l === void 0 ? void 0 : _l.trim()) || null,
                    ((_m = m.paginaPdf) === null || _m === void 0 ? void 0 : _m.trim()) || null,
                ]);
                rowsInserted++;
            }
            if (legacy) {
                customerByLegacy.set(legacy, cust);
                customerByLegacy.set((0, multimediaHistorialExcel_1.padLegacyCode)(legacy), cust);
            }
        }
        res.json({
            message: 'Importación de historial Multimedias finalizada',
            sheetsProcessed,
            customersUpdated,
            rowsInserted,
            notFoundSheets: notFound.slice(0, 50),
            notFoundCount: notFound.length,
            skippedNotYourCustomer: skippedSeller.slice(0, 20),
            skippedCount: skippedSeller.length,
        });
    }
    catch (e) {
        console.error('importMultimediaHistorial:', e);
        res.status(500).json({ message: 'Error importando historial', detail: e === null || e === void 0 ? void 0 : e.message });
    }
});
exports.importMultimediaHistorial = importMultimediaHistorial;
/** GET /customers/:id/multimedia-ledger — movimientos importados (Excel Tango/Multimedias) para la ficha del cliente. */
const getCustomerMultimediaLedger = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    try {
        const user = req.user;
        if (!user || !canManage(user.role)) {
            return res.status(403).json({ message: 'Sin permiso' });
        }
        const { id } = req.params;
        const cust = (yield (0, db_1.get)(`SELECT id, seller_id, business_name, legacy_code, account_zone, account_seller_label, opening_balance, opening_balance_date FROM customers WHERE id = ?`, [id]));
        if (!cust)
            return res.status(404).json({ message: 'Cliente no encontrado' });
        if (user.role === 'SELLER' && cust.seller_id !== user.id) {
            return res.status(403).json({ message: 'No autorizado' });
        }
        const openingBalance = cust.opening_balance != null && cust.opening_balance !== ''
            ? Math.round(Number(cust.opening_balance) * 100) / 100
            : 0;
        const openingBalanceDate = (0, customerOpeningBalance_1.normalizeYmdDate)(cust.opening_balance_date);
        const movementOnOrAfterOpening = (lineDate) => (0, customerOpeningBalance_1.movementOnOrAfterOpeningDate)(lineDate, openingBalanceDate);
        yield (0, orderPaymentBalance_service_1.backfillPaymentOrdersFromLegacy)();
        const entries = carteraImportedSql_1.INCLUDE_TANGO_IMPORT_IN_SYSTEM
            ? (yield (0, db_1.query)(`SELECT line_order, line_date, tipo, numero, edc, vto, importe, saldo, detalle, pagina_pdf
       FROM customer_multimedia_entries WHERE customer_id = ? ORDER BY line_order ASC, line_date ASC`, [id]))
            : [];
        const paymentEntries = (yield (0, db_1.query)(`SELECT
         p.id,
         p.date,
         p.created_at,
         p.receipt_number,
         p.amount,
         p.notes,
         p.invoice_id,
         p.order_id,
         GROUP_CONCAT(DISTINCT pi.invoice_id) AS invoice_ids,
         GROUP_CONCAT(DISTINCT pir.invoice_ref) AS invoice_refs,
         GROUP_CONCAT(DISTINCT po.order_id) AS payment_order_ids,
         GROUP_CONCAT(DISTINCT CONCAT(
           LPAD(COALESCE(i_pi.punto_venta, 0), 5, '0'),
           '-',
           LPAD(COALESCE(i_pi.cbte_desde, 0), 8, '0')
         ) SEPARATOR ' | ') AS invoice_comprobantes,
         GROUP_CONCAT(DISTINCT CONCAT(
           LPAD(COALESCE(i_legacy.punto_venta, 0), 5, '0'),
           '-',
           LPAD(COALESCE(i_legacy.cbte_desde, 0), 8, '0')
         ) SEPARATOR ' | ') AS legacy_invoice_comprobantes
       FROM payments p
       LEFT JOIN payment_invoices pi ON pi.payment_id = p.id
       LEFT JOIN invoices i_pi ON i_pi.id = pi.invoice_id
       LEFT JOIN invoices i_legacy ON i_legacy.id = p.invoice_id
       LEFT JOIN payment_invoice_refs pir ON pir.payment_id = p.id
       LEFT JOIN payment_orders po ON po.payment_id = p.id
       WHERE p.customer_id = ?
       GROUP BY p.id, p.date, p.created_at, p.receipt_number, p.amount, p.notes, p.invoice_id, p.order_id
       ORDER BY p.created_at ASC, p.date ASC`, [id]));
        const orderSaldoRows = (yield (0, db_1.query)(`SELECT
         o.id AS order_id,
         o.date AS order_date,
         o.remito_number,
         (${orderPaymentBalance_service_1.SQL_ORDER_SALDO_RESIDUAL}) AS residual
       FROM orders o
       LEFT JOIN (
         SELECT order_id, SUM(amount_credited) AS cn_total
         FROM credit_notes
         WHERE COALESCE(superseded_by_reinvoice, 0) = 0
         GROUP BY order_id
       ) cn ON cn.order_id = o.id
       LEFT JOIN invoices i ON i.order_id = o.id
       WHERE o.customer_id = ?
         AND ${SQL_ORDER_ACTIVE_COND}
         AND ${orderPaymentBalance_service_1.SQL_ORDER_IN_SALDO_SCOPE}
         AND i.id IS NULL
         AND (${orderPaymentBalance_service_1.SQL_ORDER_SALDO_RESIDUAL}) > 0.005
       ORDER BY o.date ASC, o.id ASC`, [id]));
        const invoiceRows = (yield (0, db_1.query)(`SELECT
         i.id,
         i.order_id,
         i.cbte_tipo,
         i.punto_venta,
         i.cbte_desde,
         i.created_at AS invoice_created_at,
         COALESCE(DATE(i.created_at), o.date) AS line_date,
         i.agip_ret_per,
         i.agip_alicuota,
         o.total,
         o.date AS order_date
       FROM invoices i
       JOIN orders o ON o.id = i.order_id
       WHERE o.customer_id = ?
       ORDER BY i.created_at ASC, i.id ASC`, [id]));
        const creditNoteRows = (yield (0, db_1.query)(`SELECT
         cn.id,
         cn.order_id,
         cn.cbte_tipo,
         cn.punto_venta,
         cn.cbte_desde,
         cn.created_at,
         cn.amount_credited,
         COALESCE(cn.superseded_by_reinvoice, 0) AS superseded_by_reinvoice,
         cn.voided_invoice_cbte_tipo,
         cn.voided_invoice_punto_venta,
         cn.voided_invoice_cbte_desde,
         o.date AS order_date
       FROM credit_notes cn
       JOIN orders o ON o.id = cn.order_id
       WHERE o.customer_id = ?
       ORDER BY cn.created_at ASC, cn.id ASC`, [id]));
        let manualComprobanteRows = [];
        try {
            manualComprobanteRows = (yield (0, db_1.query)(`SELECT id, tipo, fecha, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, importe_neto, agip_ret_per, notes, ref_order_id, sin_detalle, pdf_path, created_at
         FROM customer_manual_comprobantes
         WHERE customer_id = ?
         ORDER BY fecha ASC, created_at ASC`, [id]));
        }
        catch (_f) {
            manualComprobanteRows = (yield (0, db_1.query)(`SELECT id, tipo, fecha, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, importe_neto, agip_ret_per, notes, ref_order_id, created_at
         FROM customer_manual_comprobantes
         WHERE customer_id = ?
         ORDER BY fecha ASC, created_at ASC`, [id]));
        }
        const normalizeDocType = (tipo, detalle) => (0, ledgerDocType_1.normalizeLedgerDocType)(tipo, detalle);
        const maxLineOrder = entries.reduce((m, e) => Math.max(m, Number(e.line_order || 0)), 0);
        const invoiceByOrderId = new Map();
        for (const inv of invoiceRows) {
            const orderId = String(inv.order_id || '');
            if (!orderId)
                continue;
            const agipRet = Number(inv.agip_ret_per || 0);
            invoiceByOrderId.set(orderId, {
                invoiceId: String(inv.id || ''),
                numero: formatAfipComprobanteNumero(Number(inv.punto_venta || 0), Number(inv.cbte_desde || 0)),
                agipRetPer: agipRet,
                importeConIibb: (0, orderPricing_1.invoiceLedgerImporte)(Number(inv.total || 0), agipRet)
            });
        }
        const orderSaldoAsEntries = orderSaldoRows.filter((ord) => movementOnOrAfterOpening(ord.order_date)).map((ord, idx) => {
            const residual = Math.round(Number(ord.residual || 0) * 100) / 100;
            const orderId = String(ord.order_id || '');
            const numero = ord.remito_number != null && Number(ord.remito_number) > 0
                ? String(Number(ord.remito_number))
                : orderId.slice(0, 12);
            return {
                lineOrder: maxLineOrder + 50000 + idx,
                lineDate: ord.order_date,
                tipo: 'PED',
                numero,
                edc: null,
                vto: null,
                importe: residual > 0 ? residual : null,
                saldo: null,
                detalle: `Pedido ${orderId} · Saldo pendiente (sin factura)`,
                paginaPdf: null,
                orderId: orderId || null,
                source: 'system'
            };
        });
        const invoiceAsEntries = invoiceRows
            .filter((inv) => ledgerMovementVisibleAfterOpening(openingBalanceDate, inv.invoice_created_at, inv.line_date, inv.order_date))
            .map((inv, idx) => {
            const agipRet = Number(inv.agip_ret_per || 0);
            const importe = (0, orderPricing_1.invoiceLedgerImporte)(Number(inv.total || 0), agipRet);
            const numero = formatAfipComprobanteNumero(Number(inv.punto_venta || 0), Number(inv.cbte_desde || 0));
            const lineDate = inv.invoice_created_at || inv.line_date || inv.order_date;
            const orderId = String(inv.order_id || '');
            return {
                lineOrder: maxLineOrder + 60000 + idx,
                lineDate,
                tipo: 'FAC',
                numero,
                edc: null,
                vto: null,
                importe: importe > 0 ? importe : null,
                saldo: null,
                detalle: `Pedido ${orderId} · Factura AFIP LupoHub`,
                paginaPdf: null,
                orderId: orderId || null,
                invoiceId: String(inv.id || '') || null,
                facLinks: {
                    orderId: orderId || null,
                    invoiceId: String(inv.id || '') || null,
                    invoiceNumero: numero,
                    agipRetPer: agipRet > 0.005 ? Math.round(agipRet * 100) / 100 : null,
                    importeConIibb: importe > 0 ? importe : null,
                    voidedForReinvoice: false
                },
                source: 'system'
            };
        });
        /** Factura AFIP que la NC anuló (mismo nº/importe que en AFIP; no suma al saldo porque la NC ya resta). */
        const voidedInvoiceAsEntries = creditNoteRows
            .filter((cn) => cn.voided_invoice_cbte_desde != null &&
            Number(cn.voided_invoice_cbte_desde) > 0 &&
            ledgerMovementVisibleAfterOpening(openingBalanceDate, cn.order_date, cn.created_at))
            .map((cn, idx) => {
            var _a, _b, _c;
            const importe = (0, orderPricing_1.ncLedgerImporte)(Number(cn.amount_credited || 0));
            const numero = formatAfipComprobanteNumero(Number(cn.voided_invoice_punto_venta || 0), Number(cn.voided_invoice_cbte_desde || 0));
            const pedidoFecha = cn.order_date ? (0, multimediaHistorialExcel_1.sqlDateToDisplay)(cn.order_date) : '';
            const detallePedido = pedidoFecha ? ` · pedido ${pedidoFecha}` : '';
            const orderId = String(cn.order_id || '');
            const issuedInv = orderId ? invoiceByOrderId.get(orderId) : undefined;
            return {
                lineOrder: maxLineOrder + 54500 + idx,
                /** Misma fecha que la NC/reemisión para agrupar arriba en el historial (no la fecha del pedido). */
                lineDate: cn.created_at,
                tipo: 'FAC',
                numero,
                edc: null,
                vto: null,
                importe: importe > 0 ? importe : null,
                saldo: null,
                detalle: `Pedido ${orderId} · Factura anulada ${numero} (reemisión IIBB${detallePedido})`,
                excluirDeSaldo: true,
                voidedForReinvoice: true,
                orderId: orderId || null,
                facLinks: {
                    orderId: orderId || null,
                    invoiceId: (_a = issuedInv === null || issuedInv === void 0 ? void 0 : issuedInv.invoiceId) !== null && _a !== void 0 ? _a : null,
                    invoiceNumero: (_b = issuedInv === null || issuedInv === void 0 ? void 0 : issuedInv.numero) !== null && _b !== void 0 ? _b : null,
                    voidedInvoiceNumero: numero,
                    agipRetPer: issuedInv && issuedInv.agipRetPer > 0.005
                        ? Math.round(issuedInv.agipRetPer * 100) / 100
                        : null,
                    importeConIibb: (_c = issuedInv === null || issuedInv === void 0 ? void 0 : issuedInv.importeConIibb) !== null && _c !== void 0 ? _c : null,
                    voidedForReinvoice: true
                },
                paginaPdf: null,
                source: 'system'
            };
        });
        const creditNoteAsEntries = creditNoteRows
            .filter((cn) => ledgerMovementVisibleAfterOpening(openingBalanceDate, cn.created_at))
            .map((cn, idx) => {
            var _a, _b, _c;
            const importe = (0, orderPricing_1.ncLedgerImporte)(Number(cn.amount_credited || 0));
            const reemision = !!Number(cn.superseded_by_reinvoice);
            const numero = formatAfipComprobanteNumero(Number(cn.punto_venta || 0), Number(cn.cbte_desde || 0));
            const voidedInvoiceNumero = cn.voided_invoice_cbte_desde != null && Number(cn.voided_invoice_cbte_desde) > 0
                ? formatAfipComprobanteNumero(Number(cn.voided_invoice_punto_venta || 0), Number(cn.voided_invoice_cbte_desde))
                : null;
            const issuedInv = cn.order_id ? invoiceByOrderId.get(String(cn.order_id)) : undefined;
            const ncLinks = voidedInvoiceNumero || issuedInv
                ? {
                    voidedInvoiceNumero,
                    issuedInvoiceNumero: (_a = issuedInv === null || issuedInv === void 0 ? void 0 : issuedInv.numero) !== null && _a !== void 0 ? _a : null,
                    issuedInvoiceIibb: issuedInv && issuedInv.agipRetPer > 0.005
                        ? Math.round(issuedInv.agipRetPer * 100) / 100
                        : null,
                    issuedInvoiceImporte: (_b = issuedInv === null || issuedInv === void 0 ? void 0 : issuedInv.importeConIibb) !== null && _b !== void 0 ? _b : null,
                    reissueWithIibb: reemision,
                    orderId: (_c = cn.order_id) !== null && _c !== void 0 ? _c : null
                }
                : undefined;
            return {
                lineOrder: maxLineOrder + 55000 + idx,
                lineDate: cn.created_at,
                tipo: 'NC',
                numero,
                edc: null,
                vto: null,
                importe: importe > 0 ? importe : null,
                saldo: null,
                detalle: reemision
                    ? `Pedido ${cn.order_id || ''} · NC AFIP LupoHub (reemisión IIBB)`
                    : `Pedido ${cn.order_id || ''} · NC AFIP LupoHub`,
                paginaPdf: null,
                orderId: cn.order_id ? String(cn.order_id) : null,
                ncLinks,
                source: 'system'
            };
        });
        const manualComprobanteAsEntries = manualComprobanteRows.filter((m) => movementOnOrAfterOpening(m.fecha || m.created_at)).map((m, idx) => {
            const importe = m.tipo === 'FACTURA'
                ? Math.round((Number(m.importe_neto || 0) + Number(m.agip_ret_per || 0)) * 100) / 100
                : Math.round(Number(m.importe_neto || 0) * 100) / 100;
            const sinDetalle = !!Number(m.sin_detalle);
            const numero = sinDetalle
                ? 'Sin nº AFIP'
                : formatAfipComprobanteNumero(Number(m.punto_venta || 0), Number(m.cbte_desde || 0));
            const tipoLabel = m.tipo === 'NC' ? 'NC' : 'FAC';
            const detalleExtra = m.notes ? String(m.notes).trim() : '';
            const pdfNote = m.pdf_path ? ' · PDF adjunto' : '';
            const pedidoRef = m.ref_order_id ? `Pedido ${m.ref_order_id}` : 'Sin pedido';
            const orderId = m.ref_order_id ? String(m.ref_order_id) : null;
            return {
                lineOrder: maxLineOrder + 70000 + idx,
                lineDate: m.fecha || m.created_at,
                tipo: tipoLabel,
                numero,
                edc: null,
                vto: null,
                importe: importe > 0 ? importe : null,
                saldo: null,
                detalle: `${pedidoRef} · Comprobante manual${pdfNote}${detalleExtra ? ` · ${detalleExtra}` : ''}`,
                paginaPdf: null,
                manualComprobanteId: m.id,
                orderId,
                source: 'system'
            };
        });
        const paymentAsEntries = paymentEntries
            .filter((p) => ledgerMovementVisibleAfterOpening(openingBalanceDate, p.date))
            .map((p, idx) => {
            const comprobantes = Array.from(new Set([
                ...String(p.invoice_comprobantes || '').split('|'),
                ...String(p.legacy_invoice_comprobantes || '').split('|'),
                ...String(p.invoice_refs || '').split(','),
            ]
                .map((x) => x.trim())
                .filter(Boolean)));
            const orderRefs = Array.from(new Set([
                ...String(p.payment_order_ids || '').split(',').map((x) => x.trim()).filter(Boolean),
                ...(p.order_id ? [String(p.order_id).trim()] : []),
            ])).filter((oid) => oid && !oid.startsWith('mm-'));
            const parts = [];
            if (comprobantes.length)
                parts.push(`Factura(s) AFIP: ${comprobantes.join(' | ')}`);
            if (orderRefs.length)
                parts.push(`Pedido(s): ${orderRefs.join(' | ')}`);
            const refsText = parts.length ? parts.join(' · ') : 'Sin imputar';
            const detail = `${refsText}${p.notes ? ` | ${String(p.notes).trim()}` : ''}`;
            return {
                lineOrder: maxLineOrder + 100000 + idx,
                lineDate: p.date,
                tipo: 'REC',
                numero: p.receipt_number || '',
                edc: null,
                vto: null,
                importe: p.amount != null ? Number(p.amount) : null,
                saldo: null,
                detalle: detail,
                paginaPdf: null,
                source: 'system'
            };
        });
        const mergedEntries = [
            ...(carteraImportedSql_1.INCLUDE_TANGO_IMPORT_IN_SYSTEM
                ? entries.filter((e) => movementOnOrAfterOpening(e.line_date)).map((e) => ({
                    lineOrder: e.line_order,
                    lineDate: e.line_date,
                    tipo: e.tipo,
                    numero: e.numero,
                    edc: e.edc,
                    vto: e.vto,
                    importe: e.importe != null ? Number(e.importe) : null,
                    saldo: e.saldo != null ? Number(e.saldo) : null,
                    detalle: e.detalle,
                    paginaPdf: e.pagina_pdf,
                    source: 'imported'
                }))
                : []),
            ...orderSaldoAsEntries,
            ...voidedInvoiceAsEntries,
            ...creditNoteAsEntries,
            ...invoiceAsEntries,
            ...manualComprobanteAsEntries,
            ...paymentAsEntries
        ];
        // Unificación real: evitar duplicados entre importado y sistema.
        const deduped = [];
        const movementByKey = new Map();
        for (const row of mergedEntries) {
            const tipoNorm = normalizeDocType(row.tipo, row.detalle);
            if (!['REC', 'FAC', 'NC', 'ND', 'PED'].includes(tipoNorm)) {
                deduped.push(row);
                continue;
            }
            const key = (0, ledgerRunningSaldo_1.ledgerMovementDedupeKey)({
                tipo: row.tipo,
                detalle: row.detalle,
                lineDate: row.lineDate,
                numero: row.numero,
                importe: row.importe,
            }) + lupoHubLedgerDedupeExtra(row);
            const prev = movementByKey.get(key);
            if (!prev) {
                movementByKey.set(key, row);
            }
            else {
                // Priorizar registro del sistema actual sobre importado al detectar duplicado.
                const prevSystem = prev.source === 'system';
                const rowSystem = row.source === 'system';
                if (!prevSystem && rowSystem)
                    movementByKey.set(key, row);
            }
        }
        deduped.push(...Array.from(movementByKey.values()));
        const unified = (0, ledgerRunningSaldo_1.filterSystemDuplicatesAgainstImport)(deduped);
        const ledgerTipoSortRank = (row) => {
            const t = (0, ledgerDocType_1.normalizeLedgerDocType)(row.tipo, row.detalle);
            if (t === 'SALDO')
                return 0;
            if (t === 'FAC' || t === 'ND') {
                if (row.excluirDeSaldo)
                    return 1;
                return 3;
            }
            if (t === 'NC')
                return 2;
            if (t === 'PED')
                return 4;
            if (t === 'REC')
                return 5;
            return 6;
        };
        unified.sort((a, b) => {
            const da = new Date(a.lineDate || 0).getTime() || 0;
            const db = new Date(b.lineDate || 0).getTime() || 0;
            if (da !== db)
                return da - db;
            const ra = ledgerTipoSortRank(a);
            const rb = ledgerTipoSortRank(b);
            if (ra !== rb)
                return ra - rb;
            return Number(a.lineOrder || 0) - Number(b.lineOrder || 0);
        });
        if (Math.abs(openingBalance) > 0.005) {
            const fechaLabel = openingBalanceDate
                ? openingBalanceDate.split('-').reverse().join('/')
                : '';
            unified.unshift({
                lineOrder: -1,
                lineDate: openingBalanceDate || null,
                tipo: 'SALDO',
                numero: 'INICIAL',
                edc: null,
                vto: null,
                importe: openingBalance,
                saldo: null,
                detalle: fechaLabel
                    ? `Saldo inicial manual al ${fechaLabel}`
                    : 'Saldo inicial manual',
                paginaPdf: null,
                source: 'system'
            });
        }
        (0, ledgerRunningSaldo_1.applyLedgerRunningSaldo)(unified);
        const lastSaldoHistorial = (0, ledgerRunningSaldo_1.applyLedgerRunningSaldoSimple)(unified);
        for (const row of unified) {
            row.saldo = (_a = row.saldoCorrido) !== null && _a !== void 0 ? _a : null;
        }
        const { queryCarteraTotalsForCustomer } = yield Promise.resolve().then(() => __importStar(require('./customers.controller')));
        const carteraTotals = yield queryCarteraTotalsForCustomer(id, {
            id: String(user.id),
            role: String(user.role)
        });
        const saldoPendienteUnificado = (_b = carteraTotals === null || carteraTotals === void 0 ? void 0 : carteraTotals.saldoPendienteUnificado) !== null && _b !== void 0 ? _b : lastSaldoHistorial;
        res.json({
            customerId: id,
            legacyCode: (_c = cust.legacy_code) !== null && _c !== void 0 ? _c : null,
            accountZone: (_d = cust.account_zone) !== null && _d !== void 0 ? _d : null,
            accountSellerLabel: (_e = cust.account_seller_label) !== null && _e !== void 0 ? _e : null,
            movementCount: unified.length,
            lastSaldo: saldoPendienteUnificado,
            lastSaldoHistorial,
            saldoPendienteUnificado,
            openingBalance,
            carteraTotals,
            entries: unified
        });
    }
    catch (e) {
        console.error('getCustomerMultimediaLedger:', e);
        res.status(500).json({ message: 'Error leyendo historial importado', detail: e === null || e === void 0 ? void 0 : e.message });
    }
});
exports.getCustomerMultimediaLedger = getCustomerMultimediaLedger;
/** GET /customers/multimedia-saldos-summary — último saldo por cliente (Excel importado) para las cards de cartera. */
const getMultimediaSaldosSummary = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        if (!user || !canManage(user.role)) {
            return res.status(403).json({ message: 'Sin permiso' });
        }
        if (!carteraImportedSql_1.INCLUDE_TANGO_IMPORT_IN_SYSTEM) {
            return res.json([]);
        }
        const sellerFilter = user.role === 'SELLER' ? ' AND c.seller_id = ?' : '';
        const params = user.role === 'SELLER' ? [user.id] : [];
        const rows = (yield (0, db_1.query)(`SELECT
         agg.customer_id AS customerId,
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
         agg.cnt AS movementCount
       FROM (
         SELECT customer_id, COUNT(*) AS cnt
         FROM customer_multimedia_entries
         GROUP BY customer_id
       ) agg
       INNER JOIN customers c ON c.id = agg.customer_id
       WHERE 1=1${sellerFilter}`, params));
        res.json((rows || []).map((r) => ({
            customerId: r.customerId,
            lastSaldo: Number(r.lastSaldo) || 0,
            movementCount: Number(r.movementCount) || 0
        })));
    }
    catch (e) {
        console.error('getMultimediaSaldosSummary:', e);
        res.status(500).json({ message: 'Error leyendo saldos importados', detail: e === null || e === void 0 ? void 0 : e.message });
    }
});
exports.getMultimediaSaldosSummary = getMultimediaSaldosSummary;
