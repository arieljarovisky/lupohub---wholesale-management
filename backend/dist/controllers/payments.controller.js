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
exports.importPaymentsFromExcel = exports.createPayment = exports.listPayments = void 0;
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
        // Para SELLER: solo pagos de clientes asignados a ese vendedor
        if (user.role === 'SELLER') {
            where.push('c.seller_id = ?');
            params.push(user.id);
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
        const systemPayments = (rows || []).map((r) => {
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
        });
        // Integrar recibos importados desde Tango/Multimedias como parte del mismo "sistema".
        // Se omiten si ya existe pago equivalente en tabla payments (fecha + nro + importe).
        const includeImportedReceipts = !invoiceId && !orderId;
        if (!includeImportedReceipts) {
            return res.json(systemPayments);
        }
        const mmWhere = [`UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'REC%'`];
        const mmParams = [];
        if (customerId) {
            mmWhere.push('e.customer_id = ?');
            mmParams.push(customerId);
        }
        if (desde) {
            mmWhere.push('e.line_date >= ?');
            mmParams.push(desde);
        }
        if (hasta) {
            mmWhere.push('e.line_date <= ?');
            mmParams.push(hasta);
        }
        if (user.role === 'SELLER') {
            mmWhere.push('c.seller_id = ?');
            mmParams.push(user.id);
        }
        const importedRows = yield (0, db_1.query)(`
      SELECT
        e.customer_id,
        e.line_order,
        e.line_date,
        e.numero,
        e.importe,
        e.detalle,
        c.business_name AS customer_business_name,
        c.name AS customer_name,
        c.seller_id,
        u.name AS seller_name
      FROM customer_multimedia_entries e
      JOIN customers c ON c.id = e.customer_id
      LEFT JOIN users u ON u.id = c.seller_id
      WHERE ${mmWhere.join(' AND ')}
      ORDER BY e.line_date DESC, e.line_order DESC
      `, mmParams);
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
            const d = new Date(v);
            if (Number.isNaN(d.getTime()))
                return String(v || '').slice(0, 10);
            return d.toISOString().slice(0, 10);
        };
        const normalizeNumber = (v) => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        const normalizeAmount = (v) => parseMoney(v).toFixed(2);
        const existingKeys = new Set(systemPayments.map((p) => [
            normalizeDate(p.date),
            normalizeNumber(p.receiptNumber),
            normalizeAmount(p.amount),
            p.customerId
        ].join('|')));
        const importedAsPayments = importedRows
            .filter((r) => {
            const key = [
                normalizeDate(r.line_date),
                normalizeNumber(r.numero),
                normalizeAmount(r.importe),
                r.customer_id
            ].join('|');
            if (existingKeys.has(key))
                return false;
            existingKeys.add(key);
            return true;
        })
            .map((r) => {
            var _a, _b, _c, _d, _e;
            return ({
                id: `mm-${r.customer_id}-${String((_a = r.line_order) !== null && _a !== void 0 ? _a : 'x')}-${normalizeDate(r.line_date)}-${normalizeNumber(r.numero)}`,
                customerId: r.customer_id,
                sellerId: (_b = r.seller_id) !== null && _b !== void 0 ? _b : undefined,
                sellerName: (_c = r.seller_name) !== null && _c !== void 0 ? _c : undefined,
                orderId: undefined,
                invoiceId: undefined,
                receiptNumber: String(r.numero || ''),
                date: normalizeDate(r.line_date),
                amount: parseMoney(r.importe),
                notes: r.detalle ? `Importado Tango: ${r.detalle}` : 'Importado Tango',
                createdAt: undefined,
                customerBusinessName: (_e = (_d = r.customer_business_name) !== null && _d !== void 0 ? _d : r.customer_name) !== null && _e !== void 0 ? _e : '',
                invoice: undefined
            });
        });
        const allPayments = [...systemPayments, ...importedAsPayments].sort((a, b) => {
            const da = new Date(a.date).getTime() || 0;
            const db = new Date(b.date).getTime() || 0;
            return db - da;
        });
        res.json(allPayments);
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
        const cust = yield (0, db_1.get)('SELECT id, seller_id FROM customers WHERE id = ?', [customerId]);
        if (!cust)
            return res.status(404).json({ message: 'Cliente no encontrado' });
        if (user.role === 'SELLER' && cust.seller_id !== user.id) {
            return res.status(403).json({ message: 'Solo podés cargar pagos para tus clientes' });
        }
        const sellerId = user.role === 'SELLER'
            ? user.id
            : (body.sellerId ? String(body.sellerId).trim() : null);
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
