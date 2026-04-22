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
exports.importIibbRetPer = exports.importPaymentsFromExcel = exports.createPayment = exports.listPayments = void 0;
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
const XLSX = __importStar(require("xlsx"));
const canManagePayments = (role) => role === 'ADMIN' || role === 'SELLER' || role === 'WAREHOUSE' || role === 'DEPOSITO';
/** Listar pagos con filtros opcionales (cliente, factura, pedido, desde/hasta). */
const listPayments = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        if (!user || !canManagePayments(user.role)) {
            return res.status(403).json({ message: 'No autorizado' });
        }
        const { customerId, invoiceId, orderId, desde, hasta } = req.query;
        const where = [];
        const params = [];
        if (customerId) {
            where.push('p.customer_id = ?');
            params.push(customerId);
        }
        if (invoiceId) {
            where.push('p.invoice_id = ?');
            params.push(invoiceId);
        }
        if (orderId) {
            where.push('p.order_id = ?');
            params.push(orderId);
        }
        if (desde) {
            where.push('p.date >= ?');
            params.push(desde);
        }
        if (hasta) {
            where.push('p.date <= ?');
            params.push(hasta);
        }
        // Para SELLER: solo pagos de sus clientes (seller_id = user.id) o pagos donde él es el vendedor del recibo
        if (user.role === 'SELLER') {
            where.push('(p.seller_id = ? OR c.seller_id = ?)');
            params.push(user.id, user.id);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const rows = yield (0, db_1.query)(`
      SELECT
        p.id, p.customer_id, p.seller_id, p.order_id, p.invoice_id,
        p.receipt_number, p.date, p.amount, p.notes, p.created_at,
        c.business_name AS customer_business_name, c.name AS customer_name,
        u.name AS seller_name,
        i.punto_venta AS invoice_punto_venta, i.cbte_tipo AS invoice_cbte_tipo, i.cbte_desde AS invoice_cbte_desde
      FROM payments p
      JOIN customers c ON c.id = p.customer_id
      LEFT JOIN users u ON u.id = p.seller_id
      LEFT JOIN invoices i ON i.id = p.invoice_id
      ${whereSql}
      ORDER BY p.date DESC, p.created_at DESC
      `, params);
        res.json((rows || []).map((r) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
            return ({
                id: r.id,
                customerId: r.customer_id,
                sellerId: (_a = r.seller_id) !== null && _a !== void 0 ? _a : undefined,
                sellerName: (_b = r.seller_name) !== null && _b !== void 0 ? _b : undefined,
                orderId: (_c = r.order_id) !== null && _c !== void 0 ? _c : undefined,
                invoiceId: (_d = r.invoice_id) !== null && _d !== void 0 ? _d : undefined,
                receiptNumber: r.receipt_number,
                date: r.date,
                amount: Number(r.amount) || 0,
                notes: (_e = r.notes) !== null && _e !== void 0 ? _e : undefined,
                createdAt: r.created_at,
                customerBusinessName: (_g = (_f = r.customer_business_name) !== null && _f !== void 0 ? _f : r.customer_name) !== null && _g !== void 0 ? _g : '',
                invoice: r.invoice_id ? {
                    puntoVta: (_h = r.invoice_punto_venta) !== null && _h !== void 0 ? _h : undefined,
                    cbteTipo: (_j = r.invoice_cbte_tipo) !== null && _j !== void 0 ? _j : undefined,
                    cbteDesde: (_k = r.invoice_cbte_desde) !== null && _k !== void 0 ? _k : undefined
                } : undefined
            });
        }));
    }
    catch (e) {
        console.error('listPayments:', e);
        res.status(500).json({ message: 'Error listando pagos', detail: e === null || e === void 0 ? void 0 : e.message });
    }
});
exports.listPayments = listPayments;
/** Crear pago/recibo. */
const createPayment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    try {
        const user = req.user;
        if (!user || !canManagePayments(user.role)) {
            return res.status(403).json({ message: 'No autorizado' });
        }
        const body = req.body;
        const customerId = (body.customerId || '').toString().trim();
        const receiptNumber = (body.receiptNumber || '').toString().trim();
        const date = (body.date || '').toString().trim();
        const amount = body.amount != null ? Number(body.amount) : 0;
        if (!customerId)
            return res.status(400).json({ message: 'Falta customerId' });
        if (!receiptNumber)
            return res.status(400).json({ message: 'Falta número de recibo' });
        if (!date)
            return res.status(400).json({ message: 'Falta fecha' });
        if (!Number.isFinite(amount) || amount < 0)
            return res.status(400).json({ message: 'Monto inválido' });
        const cust = yield (0, db_1.get)('SELECT id FROM customers WHERE id = ?', [customerId]);
        if (!cust)
            return res.status(404).json({ message: 'Cliente no encontrado' });
        const sellerId = body.sellerId ? String(body.sellerId).trim() : null;
        const orderId = body.orderId ? String(body.orderId).trim() : null;
        const invoiceId = body.invoiceId ? String(body.invoiceId).trim() : null;
        const notes = body.notes != null && String(body.notes).trim() ? String(body.notes).trim() : null;
        const receiptStrict = normalizeReceiptNumberStrict(receiptNumber);
        const existing = yield (0, db_1.get)(`SELECT id, customer_id, seller_id, order_id, invoice_id, receipt_number, date, amount, notes, created_at
       FROM payments
       WHERE customer_id = ?
         AND ABS(amount - ?) < 0.01
         AND (
           (receipt_number = ? AND date = ?)
           OR (
             UPPER(
               REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(receipt_number, '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
             ) = ?
             AND ABS(DATEDIFF(date, ?)) <= 1
           )
         )
       LIMIT 1`, [customerId, amount, receiptNumber, date, receiptStrict, date]);
        if (existing) {
            const row = existing;
            return res.status(200).json({
                id: row.id,
                customerId: row.customer_id,
                sellerId: (_a = row.seller_id) !== null && _a !== void 0 ? _a : undefined,
                orderId: (_b = row.order_id) !== null && _b !== void 0 ? _b : undefined,
                invoiceId: (_c = row.invoice_id) !== null && _c !== void 0 ? _c : undefined,
                receiptNumber: row.receipt_number,
                date: row.date,
                amount: Number(row.amount) || 0,
                notes: (_d = row.notes) !== null && _d !== void 0 ? _d : undefined,
                createdAt: row.created_at
            });
        }
        const id = (0, uuid_1.v4)();
        try {
            yield (0, db_1.execute)(`INSERT INTO payments (id, customer_id, seller_id, order_id, invoice_id, receipt_number, date, amount, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, customerId, sellerId, orderId, invoiceId, receiptNumber, date, amount, notes]);
        }
        catch (e) {
            const dup = (e === null || e === void 0 ? void 0 : e.code) === 'ER_DUP_ENTRY' || String((e === null || e === void 0 ? void 0 : e.message) || '').includes('Duplicate entry');
            if (dup) {
                const rowDup = yield (0, db_1.get)(`SELECT id, customer_id, seller_id, order_id, invoice_id, receipt_number, date, amount, notes, created_at
           FROM payments
           WHERE customer_id = ?
             AND ABS(amount - ?) < 0.01
             AND (
               (receipt_number = ? AND date = ?)
               OR (
                 UPPER(
                   REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(receipt_number, '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
                 ) = ?
                 AND ABS(DATEDIFF(date, ?)) <= 1
               )
             )
           LIMIT 1`, [customerId, amount, receiptNumber, date, receiptStrict, date]);
                if (rowDup) {
                    return res.status(200).json({
                        id: rowDup.id,
                        customerId: rowDup.customer_id,
                        sellerId: (_e = rowDup.seller_id) !== null && _e !== void 0 ? _e : undefined,
                        orderId: (_f = rowDup.order_id) !== null && _f !== void 0 ? _f : undefined,
                        invoiceId: (_g = rowDup.invoice_id) !== null && _g !== void 0 ? _g : undefined,
                        receiptNumber: rowDup.receipt_number,
                        date: rowDup.date,
                        amount: Number(rowDup.amount) || 0,
                        notes: (_h = rowDup.notes) !== null && _h !== void 0 ? _h : undefined,
                        createdAt: rowDup.created_at
                    });
                }
            }
            throw e;
        }
        const row = yield (0, db_1.get)(`SELECT id, customer_id, seller_id, order_id, invoice_id, receipt_number, date, amount, notes, created_at
       FROM payments WHERE id = ?`, [id]);
        res.status(201).json({
            id: row.id,
            customerId: row.customer_id,
            sellerId: (_j = row.seller_id) !== null && _j !== void 0 ? _j : undefined,
            orderId: (_k = row.order_id) !== null && _k !== void 0 ? _k : undefined,
            invoiceId: (_l = row.invoice_id) !== null && _l !== void 0 ? _l : undefined,
            receiptNumber: row.receipt_number,
            date: row.date,
            amount: Number(row.amount) || 0,
            notes: (_m = row.notes) !== null && _m !== void 0 ? _m : undefined,
            createdAt: row.created_at
        });
    }
    catch (e) {
        console.error('createPayment:', e);
        res.status(500).json({ message: 'Error creando pago', detail: e === null || e === void 0 ? void 0 : e.message });
    }
});
exports.createPayment = createPayment;
function normalizeNameForMatch(v) {
    return String(v !== null && v !== void 0 ? v : '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}
function normalizeReceiptNumber(v) {
    return String(v !== null && v !== void 0 ? v : '').trim().replace(/\s+/g, '');
}
function normalizeReceiptNumberStrict(v) {
    return String(v !== null && v !== void 0 ? v : '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}
function toSqlDate(value) {
    if (!value)
        return null;
    if (value instanceof Date && !isNaN(value.getTime()))
        return value.toISOString().slice(0, 10);
    const d = new Date(value);
    if (isNaN(d.getTime()))
        return null;
    return d.toISOString().slice(0, 10);
}
/** Importar pagos desde uno o más Excel (filas REC). */
const importPaymentsFromExcel = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g;
    try {
        const user = req.user;
        if (!user || !canManagePayments(user.role)) {
            return res.status(403).json({ message: 'No autorizado' });
        }
        const files = req.files || [];
        if (!files.length) {
            return res.status(400).json({ message: 'Subí al menos un archivo Excel (.xlsx/.xls)' });
        }
        const customers = (yield (0, db_1.query)(`SELECT id, business_name, name, seller_id FROM customers`));
        const customerByNorm = new Map();
        for (const c of customers) {
            const k1 = normalizeNameForMatch(c.business_name);
            const k2 = normalizeNameForMatch(c.name);
            if (k1 && !customerByNorm.has(k1))
                customerByNorm.set(k1, { id: c.id, seller_id: (_a = c.seller_id) !== null && _a !== void 0 ? _a : null });
            if (k2 && !customerByNorm.has(k2))
                customerByNorm.set(k2, { id: c.id, seller_id: (_b = c.seller_id) !== null && _b !== void 0 ? _b : null });
        }
        let candidates = 0;
        let imported = 0;
        let duplicated = 0;
        const notFoundNames = new Map();
        for (const f of files) {
            const wb = XLSX.read(f.buffer, { type: 'buffer', cellDates: true });
            for (const sheetName of wb.SheetNames) {
                const ws = wb.Sheets[sheetName];
                const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
                for (const r of rows) {
                    const tComp = String((_c = r.T_COMP) !== null && _c !== void 0 ? _c : '').trim().toUpperCase();
                    if (tComp !== 'REC')
                        continue;
                    candidates++;
                    const customerName = String((_d = r.RAZON_SOC) !== null && _d !== void 0 ? _d : '').trim();
                    const customer = customerByNorm.get(normalizeNameForMatch(customerName));
                    if (!customer) {
                        notFoundNames.set(customerName, (notFoundNames.get(customerName) || 0) + 1);
                        continue;
                    }
                    const receiptNumber = normalizeReceiptNumber(r.N_COMP);
                    const date = toSqlDate((_f = (_e = r.FECHA_EMIS) !== null && _e !== void 0 ? _e : r.FECHA_APL) !== null && _f !== void 0 ? _f : r.FECHA);
                    const amountRaw = Number(r.HABER) || Number(r.IMPORTE) || 0;
                    const amount = Math.round(Math.abs(amountRaw) * 100) / 100;
                    if (!receiptNumber || !date || !Number.isFinite(amount) || amount <= 0)
                        continue;
                    const receiptStrict = normalizeReceiptNumberStrict(receiptNumber);
                    const exists = yield (0, db_1.get)(`SELECT id FROM payments
             WHERE customer_id = ?
               AND ABS(amount - ?) < 0.01
               AND (
                 (receipt_number = ? AND date = ?)
                 OR (
                   UPPER(
                     REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(receipt_number, '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
                   ) = ?
                   AND ABS(DATEDIFF(date, ?)) <= 1
                 )
               )
             LIMIT 1`, [customer.id, amount, receiptNumber, date, receiptStrict, date]);
                    if (exists) {
                        duplicated++;
                        continue;
                    }
                    yield (0, db_1.execute)(`INSERT INTO payments (id, customer_id, seller_id, order_id, invoice_id, receipt_number, date, amount, notes)
             VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?)`, [
                        (0, uuid_1.v4)(),
                        customer.id,
                        (_g = customer.seller_id) !== null && _g !== void 0 ? _g : null,
                        receiptNumber,
                        date,
                        amount,
                        `Importado desde Excel (${f.originalname})`,
                    ]);
                    imported++;
                }
            }
        }
        return res.json({
            message: 'Importación de pagos finalizada',
            files: files.length,
            candidates,
            imported,
            duplicated,
            notFound: Array.from(notFoundNames.entries()).map(([customerName, count]) => ({ customerName, count })),
        });
    }
    catch (e) {
        console.error('importPaymentsFromExcel:', e);
        res.status(500).json({ message: 'Error importando pagos desde Excel', detail: e === null || e === void 0 ? void 0 : e.message });
    }
});
exports.importPaymentsFromExcel = importPaymentsFromExcel;
function normalizeCuit(v) {
    return String(v !== null && v !== void 0 ? v : '').replace(/\D/g, '').trim();
}
function parseRetPerNumber(raw) {
    const s = String(raw !== null && raw !== void 0 ? raw : '').trim();
    if (!s)
        return NaN;
    const n = Number(s.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
}
function parseRetPerFixedWidthLine(line) {
    const raw = String(line !== null && line !== void 0 ? line : '');
    if (!raw.trim())
        return null;
    if (raw.length < 205)
        return null;
    const cuit = normalizeCuit(raw.slice(76, 87));
    const rateRaw = raw.slice(179, 185);
    const amountRaw = raw.slice(192, 202);
    const rate = parseRetPerNumber(rateRaw);
    const amount = parseRetPerNumber(amountRaw);
    if (!/^\d{11}$/.test(cuit) || !Number.isFinite(rate))
        return null;
    return {
        cuit,
        rate: Math.max(0, Math.round(rate * 10000) / 10000),
        amount: Number.isFinite(amount) ? Math.round(amount * 100) / 100 : undefined,
    };
}
function detectCsvDelimiter(headerLine) {
    var _a;
    const line = String(headerLine !== null && headerLine !== void 0 ? headerLine : '');
    const counts = [
        { d: ';', c: (line.match(/;/g) || []).length },
        { d: ',', c: (line.match(/,/g) || []).length },
        { d: '\t', c: (line.match(/\t/g) || []).length },
    ];
    counts.sort((a, b) => b.c - a.c);
    return ((_a = counts[0]) === null || _a === void 0 ? void 0 : _a.c) > 0 ? counts[0].d : ';';
}
function findColumnIndex(headers, aliases) {
    const normalized = headers.map((h) => normalizeNameForMatch(h));
    for (const alias of aliases) {
        const idx = normalized.findIndex((h) => h === normalizeNameForMatch(alias));
        if (idx >= 0)
            return idx;
    }
    return -1;
}
function parseRetPerCsv(content) {
    var _a, _b, _c;
    const lines = content
        .split(/\r?\n/)
        .map((l) => l.trimEnd())
        .filter(Boolean);
    if (lines.length < 2)
        return [];
    const delimiter = detectCsvDelimiter(lines[0]);
    const headers = lines[0].split(delimiter).map((s) => s.trim());
    const cuitIdx = findColumnIndex(headers, ['cuit', 'cuil', 'documento', 'nro_doc']);
    const rateIdx = findColumnIndex(headers, ['alicuota', 'aliquota', 'percepcion', 'perc_iibb', 'iibb']);
    if (cuitIdx < 0 || rateIdx < 0)
        return [];
    const amountIdx = findColumnIndex(headers, ['importe', 'importe_percepcion', 'monto', 'percepcion_importe']);
    const rows = [];
    for (const line of lines.slice(1)) {
        const cols = line.split(delimiter).map((s) => s.trim().replace(/^"|"$/g, ''));
        const cuit = normalizeCuit((_a = cols[cuitIdx]) !== null && _a !== void 0 ? _a : '');
        const rate = parseRetPerNumber((_b = cols[rateIdx]) !== null && _b !== void 0 ? _b : '');
        const amount = amountIdx >= 0 ? parseRetPerNumber((_c = cols[amountIdx]) !== null && _c !== void 0 ? _c : '') : NaN;
        if (!/^\d{11}$/.test(cuit) || !Number.isFinite(rate))
            continue;
        rows.push({
            cuit,
            rate: Math.max(0, Math.round(rate * 10000) / 10000),
            amount: Number.isFinite(amount) ? Math.round(amount * 100) / 100 : undefined,
        });
    }
    return rows;
}
function parseArdjuNoHeader(content) {
    var _a, _b, _c, _d;
    const lines = content
        .split(/\r?\n/)
        .map((l) => l.trimEnd())
        .filter(Boolean);
    const out = [];
    for (const line of lines) {
        const cols = line.split(';');
        if (cols.length < 9)
            continue;
        const cuit = normalizeCuit((_a = cols[3]) !== null && _a !== void 0 ? _a : '');
        // Formato ARDJU: col[8] suele ser alícuota de percepción; col[7] retención/fallback.
        const percepRate = parseRetPerNumber((_b = cols[8]) !== null && _b !== void 0 ? _b : '');
        const fallbackRate = parseRetPerNumber((_c = cols[7]) !== null && _c !== void 0 ? _c : '');
        const rate = Number.isFinite(percepRate) ? percepRate : fallbackRate;
        if (!/^\d{11}$/.test(cuit) || !Number.isFinite(rate))
            continue;
        const desde = String((_d = cols[1]) !== null && _d !== void 0 ? _d : '').replace(/\D/g, '');
        const period = /^\d{8}$/.test(desde) ? `${desde.slice(4, 8)}${desde.slice(2, 4)}` : undefined;
        out.push({
            cuit,
            rate: Math.max(0, Math.round(rate * 10000) / 10000),
            period,
        });
    }
    return out;
}
function parseRetPerFile(file) {
    const original = String(file.originalname || '').toLowerCase();
    const content = file.buffer.toString('utf8');
    if (original.includes('ardju')) {
        const ardjuRows = parseArdjuNoHeader(content);
        if (ardjuRows.length > 0)
            return ardjuRows;
    }
    if (original.endsWith('.csv'))
        return parseRetPerCsv(content);
    const fixedRows = content
        .split(/\r?\n/)
        .map((line) => parseRetPerFixedWidthLine(line))
        .filter((r) => !!r);
    if (fixedRows.length > 0)
        return fixedRows;
    return parseRetPerCsv(content);
}
function periodFromFileName(fileName) {
    const base = String(fileName || '');
    // RetPer_202603.txt => 202603
    const yyyymm = base.match(/(20\d{2})(0[1-9]|1[0-2])/);
    if (yyyymm)
        return `${yyyymm[1]}${yyyymm[2]}`;
    // ARDJU008042026.TXT => 202604
    const mmYYYY = base.match(/(0[1-9]|1[0-2])(20\d{2})/);
    if (mmYYYY)
        return `${mmYYYY[2]}${mmYYYY[1]}`;
    return null;
}
/** Importa padrón RetPer (TXT/CSV) y actualiza alícuota IIBB por CUIT en clientes. */
const importIibbRetPer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const user = req.user;
        if (!user || !canManagePayments(user.role)) {
            return res.status(403).json({ message: 'No autorizado' });
        }
        const files = req.files || [];
        if (!files.length) {
            return res.status(400).json({ message: 'Subí al menos un archivo RetPer (.txt o .csv)' });
        }
        const customers = (yield (0, db_1.query)(`SELECT id, cuit FROM customers WHERE cuit IS NOT NULL AND cuit <> ''`));
        const customerByCuit = new Map();
        for (const c of customers) {
            const cuit = normalizeCuit(c.cuit);
            if (/^\d{11}$/.test(cuit) && !customerByCuit.has(cuit))
                customerByCuit.set(cuit, { id: c.id });
        }
        let rowsRead = 0;
        let rowsValid = 0;
        let updatedCustomers = 0;
        let rowsWithoutCustomer = 0;
        let importedAmountTotal = 0;
        const unmatchedCuits = new Map();
        for (const file of files) {
            const rows = parseRetPerFile(file);
            rowsRead += rows.length;
            if (!rows.length)
                continue;
            const periodFromName = periodFromFileName(file.originalname);
            const bestByCuit = new Map();
            for (const row of rows) {
                if (!/^\d{11}$/.test(row.cuit) || !Number.isFinite(row.rate))
                    continue;
                rowsValid++;
                importedAmountTotal += Number.isFinite(row.amount) ? Number(row.amount) : 0;
                const prev = bestByCuit.get(row.cuit);
                if (!prev || row.rate > prev.rate)
                    bestByCuit.set(row.cuit, row);
            }
            for (const [cuit, row] of bestByCuit.entries()) {
                const customer = customerByCuit.get(cuit);
                if (!customer) {
                    rowsWithoutCustomer++;
                    unmatchedCuits.set(cuit, (unmatchedCuits.get(cuit) || 0) + 1);
                    continue;
                }
                yield (0, db_1.execute)(`UPDATE customers
           SET iibb_perception_rate = ?,
               iibb_padron_period = ?,
               iibb_padron_source = ?,
               iibb_padron_updated_at = NOW()
           WHERE id = ?`, [row.rate, (_a = row.period) !== null && _a !== void 0 ? _a : periodFromName, file.originalname, customer.id]);
                updatedCustomers++;
            }
        }
        return res.json({
            message: 'Importación RetPer finalizada',
            files: files.length,
            rowsRead,
            rowsValid,
            updatedCustomers,
            rowsWithoutCustomer,
            importedAmountTotal: Math.round(importedAmountTotal * 100) / 100,
            unmatchedCuits: Array.from(unmatchedCuits.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 30)
                .map(([cuit, count]) => ({ cuit, count })),
        });
    }
    catch (e) {
        console.error('importIibbRetPer:', e);
        res.status(500).json({ message: 'Error importando RetPer', detail: e === null || e === void 0 ? void 0 : e.message });
    }
});
exports.importIibbRetPer = importIibbRetPer;
