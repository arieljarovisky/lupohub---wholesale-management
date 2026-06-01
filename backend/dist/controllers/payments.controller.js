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
exports.importPaymentsFromExcel = exports.updatePaymentDate = exports.postPaymentAllocatePreview = exports.patchPaymentInvoices = exports.getImportedReceiptLinkInfo = exports.getOrdersOutstandingHandler = exports.getInvoicesOutstandingHandler = exports.createPayment = exports.deletePayment = exports.updateImportedPaymentDate = exports.listPayments = void 0;
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
const XLSX = __importStar(require("xlsx"));
const orderPaymentBalance_service_1 = require("../services/orderPaymentBalance.service");
const importedReceiptPayment_service_1 = require("../services/importedReceiptPayment.service");
function formatAllocationNote(alloc, paymentAmount) {
    const allTargets = [
        ...alloc.invoiceAllocations.map((a) => (Object.assign({ kind: 'factura' }, a))),
        ...alloc.orderAllocations.map((a) => (Object.assign({ kind: 'pedido' }, a)))
    ];
    const parts = [];
    if (alloc.invoiceAllocations.length > 1) {
        parts.push(`Repartido en ${alloc.invoiceAllocations.length} facturas ($${alloc.appliedTotal.toLocaleString('es-AR')}).`);
    }
    else if (alloc.orderAllocations.length > 1 && alloc.invoiceAllocations.length === 0) {
        parts.push(`Repartido en ${alloc.orderAllocations.length} pedidos ($${alloc.appliedTotal.toLocaleString('es-AR')}).`);
    }
    else if (alloc.invoiceAllocations.length === 1 && alloc.orderAllocations.length === 0) {
        if (alloc.invoiceAllocations[0].outstandingAfter <= 0.01) {
            parts.push('Factura cobrada en su totalidad.');
        }
    }
    else if (alloc.orderAllocations.length === 1 && alloc.invoiceAllocations.length === 0) {
        if (alloc.orderAllocations[0].outstandingAfter <= 0.01) {
            parts.push('Pedido cobrado en su totalidad.');
        }
    }
    const withBalance = allTargets.filter((a) => a.outstandingAfter > 0.01);
    if (withBalance.length === 1 && parts.length === 0) {
        parts.push(`Queda pendiente $${withBalance[0].outstandingAfter.toLocaleString('es-AR')} en un ${withBalance[0].kind}.`);
    }
    else if (withBalance.length > 1) {
        const sum = withBalance.reduce((s, a) => s + a.outstandingAfter, 0);
        parts.push(`Queda pendiente $${sum.toLocaleString('es-AR')} en ${withBalance.length} comprobantes.`);
    }
    if (alloc.remainingUnallocated > 0.01) {
        parts.push(`Del recibo sobran $${alloc.remainingUnallocated.toLocaleString('es-AR')} sin imputar a lo elegido.`);
    }
    if (parts.length === 0 && alloc.appliedTotal + 0.01 < paymentAmount) {
        return `Imputados $${alloc.appliedTotal.toLocaleString('es-AR')}.`;
    }
    return parts.length ? parts.join(' ') : undefined;
}
const canManagePayments = (role) => role === 'ADMIN' || role === 'SELLER' || role === 'WAREHOUSE' || role === 'DEPOSITO';
let paymentInvoicesTableReady = null;
let paymentOrdersTableReady = null;
let paymentInvoiceRefsTableReady = null;
function ensurePaymentInvoicesTable() {
    return __awaiter(this, void 0, void 0, function* () {
        if (paymentInvoicesTableReady === true)
            return true;
        try {
            yield (0, db_1.execute)(`
      CREATE TABLE IF NOT EXISTS payment_invoices (
        payment_id VARCHAR(36) NOT NULL,
        invoice_id VARCHAR(36) NOT NULL,
        amount_applied DECIMAL(12,2) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (payment_id, invoice_id),
        INDEX idx_payment_invoices_invoice (invoice_id),
        CONSTRAINT fk_payment_invoices_payment
          FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
        CONSTRAINT fk_payment_invoices_invoice
          FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
      )
    `);
            yield (0, db_1.execute)(`
      INSERT IGNORE INTO payment_invoices (payment_id, invoice_id)
      SELECT p.id, p.invoice_id
      FROM payments p
      WHERE p.invoice_id IS NOT NULL AND TRIM(p.invoice_id) <> ''
    `);
            paymentInvoicesTableReady = true;
            return true;
        }
        catch (e) {
            console.error('[payments] ensurePaymentInvoicesTable:', (e === null || e === void 0 ? void 0 : e.message) || e);
            paymentInvoicesTableReady = false;
            return false;
        }
    });
}
function ensurePaymentOrdersTable() {
    return __awaiter(this, void 0, void 0, function* () {
        if (paymentOrdersTableReady === true)
            return true;
        try {
            yield (0, db_1.execute)(`
      CREATE TABLE IF NOT EXISTS payment_orders (
        payment_id VARCHAR(36) NOT NULL,
        order_id VARCHAR(36) NOT NULL,
        amount_applied DECIMAL(12,2) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (payment_id, order_id),
        INDEX idx_payment_orders_order (order_id),
        CONSTRAINT fk_payment_orders_payment
          FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
        CONSTRAINT fk_payment_orders_order
          FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
      )
    `);
            yield (0, db_1.execute)(`
      INSERT IGNORE INTO payment_orders (payment_id, order_id, amount_applied)
      SELECT p.id, p.order_id, ROUND(COALESCE(p.amount, 0), 2)
      FROM payments p
      WHERE p.order_id IS NOT NULL AND TRIM(p.order_id) <> ''
        AND (p.invoice_id IS NULL OR TRIM(p.invoice_id) = '')
        AND NOT EXISTS (SELECT 1 FROM payment_invoices pi WHERE pi.payment_id = p.id)
    `);
            paymentOrdersTableReady = true;
            return true;
        }
        catch (e) {
            console.error('[payments] ensurePaymentOrdersTable:', (e === null || e === void 0 ? void 0 : e.message) || e);
            paymentOrdersTableReady = false;
            return false;
        }
    });
}
function ensurePaymentInvoiceRefsTable() {
    return __awaiter(this, void 0, void 0, function* () {
        if (paymentInvoiceRefsTableReady === true)
            return true;
        try {
            yield (0, db_1.execute)(`
      CREATE TABLE IF NOT EXISTS payment_invoice_refs (
        payment_id VARCHAR(36) NOT NULL,
        invoice_ref VARCHAR(255) NOT NULL,
        source VARCHAR(40) NOT NULL DEFAULT 'IMPORTED',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (payment_id, invoice_ref),
        INDEX idx_payment_invoice_refs_ref (invoice_ref),
        CONSTRAINT fk_payment_invoice_refs_payment
          FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE
      )
    `);
            paymentInvoiceRefsTableReady = true;
            return true;
        }
        catch (e) {
            console.error('[payments] ensurePaymentInvoiceRefsTable:', (e === null || e === void 0 ? void 0 : e.message) || e);
            paymentInvoiceRefsTableReady = false;
            return false;
        }
    });
}
/** Listar pagos con filtros opcionales (cliente, factura, pedido, desde/hasta). */
const listPayments = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        if (!user || !canManagePayments(user.role)) {
            return res.status(403).json({ message: 'No autorizado' });
        }
        const paymentInvoicesEnabled = yield ensurePaymentInvoicesTable();
        const paymentOrdersEnabled = yield ensurePaymentOrdersTable();
        const paymentInvoiceRefsEnabled = yield ensurePaymentInvoiceRefsTable();
        const { customerId, invoiceId, orderId, desde, hasta, province } = req.query;
        const where = [];
        const params = [];
        if (customerId) {
            where.push('p.customer_id = ?');
            params.push(customerId);
        }
        if (invoiceId && paymentInvoicesEnabled) {
            where.push(`(
        p.invoice_id = ?
        OR EXISTS (
          SELECT 1
          FROM payment_invoices pi2
          WHERE pi2.payment_id = p.id AND pi2.invoice_id = ?
        )
      )`);
            params.push(invoiceId, invoiceId);
        }
        else if (invoiceId) {
            where.push('p.invoice_id = ?');
            params.push(invoiceId);
        }
        if (orderId) {
            where.push(`(
        p.order_id = ?
        ${paymentOrdersEnabled ? `OR EXISTS (
          SELECT 1 FROM payment_orders po2 WHERE po2.payment_id = p.id AND po2.order_id = ?
        )` : ''}
      )`);
            params.push(orderId);
            if (paymentOrdersEnabled)
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
        if (province && String(province).trim()) {
            where.push('LOWER(COALESCE(c.city, \'\')) LIKE ?');
            params.push(`%${String(province).trim().toLowerCase()}%`);
        }
        // Para SELLER: solo pagos de clientes asignados a ese vendedor
        if (user.role === 'SELLER') {
            where.push('c.seller_id = ?');
            params.push(user.id);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const rows = yield (0, db_1.query)(paymentInvoicesEnabled
            ? `
      SELECT
        p.id, p.customer_id, p.seller_id, p.order_id, p.invoice_id,
        p.receipt_number, p.date, p.amount, p.notes, p.created_at,
        c.business_name AS customer_business_name, c.name AS customer_name,
        u.name AS seller_name,
        i.punto_venta AS invoice_punto_venta, i.cbte_tipo AS invoice_cbte_tipo, i.cbte_desde AS invoice_cbte_desde,
        GROUP_CONCAT(DISTINCT pi.invoice_id) AS invoice_ids,
        ${paymentOrdersEnabled ? `GROUP_CONCAT(DISTINCT po.order_id) AS order_ids` : `NULL AS order_ids`},
        ${paymentInvoiceRefsEnabled ? `GROUP_CONCAT(DISTINCT pir.invoice_ref) AS invoice_refs` : `NULL AS invoice_refs`}
      FROM payments p
      JOIN customers c ON c.id = p.customer_id
      LEFT JOIN users u ON u.id = p.seller_id
      LEFT JOIN invoices i ON i.id = p.invoice_id
      LEFT JOIN payment_invoices pi ON pi.payment_id = p.id
      ${paymentOrdersEnabled ? `LEFT JOIN payment_orders po ON po.payment_id = p.id` : ``}
      ${paymentInvoiceRefsEnabled ? `LEFT JOIN payment_invoice_refs pir ON pir.payment_id = p.id` : ``}
      ${whereSql}
      GROUP BY p.id, p.customer_id, p.seller_id, p.order_id, p.invoice_id,
               p.receipt_number, p.date, p.amount, p.notes, p.created_at,
               c.business_name, c.name, u.name,
               i.punto_venta, i.cbte_tipo, i.cbte_desde
      ORDER BY p.created_at DESC, p.date DESC
      `
            : `
      SELECT
        p.id, p.customer_id, p.seller_id, p.order_id, p.invoice_id,
        p.receipt_number, p.date, p.amount, p.notes, p.created_at,
        c.business_name AS customer_business_name, c.name AS customer_name,
        u.name AS seller_name,
        i.punto_venta AS invoice_punto_venta, i.cbte_tipo AS invoice_cbte_tipo, i.cbte_desde AS invoice_cbte_desde,
        NULL AS invoice_ids,
        ${paymentInvoiceRefsEnabled ? `(SELECT GROUP_CONCAT(DISTINCT pir.invoice_ref) FROM payment_invoice_refs pir WHERE pir.payment_id = p.id) AS invoice_refs` : `NULL AS invoice_refs`}
      FROM payments p
      JOIN customers c ON c.id = p.customer_id
      LEFT JOIN users u ON u.id = p.seller_id
      LEFT JOIN invoices i ON i.id = p.invoice_id
      ${whereSql}
      ORDER BY p.created_at DESC, p.date DESC
      `, params);
        const systemPayments = (rows || []).map((r) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
            return ({
                id: r.id,
                customerId: r.customer_id,
                sellerId: (_a = r.seller_id) !== null && _a !== void 0 ? _a : undefined,
                sellerName: (_b = r.seller_name) !== null && _b !== void 0 ? _b : undefined,
                orderId: (_c = r.order_id) !== null && _c !== void 0 ? _c : undefined,
                orderIds: String(r.order_ids || r.order_id || '')
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean),
                invoiceId: (_d = r.invoice_id) !== null && _d !== void 0 ? _d : undefined,
                invoiceIds: Array.from(new Set([
                    ...String(r.invoice_ids || r.invoice_id || '')
                        .split(',')
                        .map((x) => x.trim())
                        .filter(Boolean),
                    ...String(r.invoice_refs || '')
                        .split(',')
                        .map((x) => x.trim())
                        .filter(Boolean),
                ])),
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
            const d = normalizeDate(r.line_date);
            if (desde && d < String(desde))
                return false;
            if (hasta && d > String(hasta))
                return false;
            const key = [
                d,
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
                source: 'imported',
                importedLineOrder: Number(r.line_order) || 0,
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
            const ca = a.createdAt ? (new Date(a.createdAt).getTime() || 0) : 0;
            const cb = b.createdAt ? (new Date(b.createdAt).getTime() || 0) : 0;
            if (cb !== ca)
                return cb - ca;
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
/** Editar fecha de un recibo histórico importado (customer_multimedia_entries tipo REC*). */
const updateImportedPaymentDate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const user = req.user;
        if (!user || !canManagePayments(user.role)) {
            return res.status(403).json({ message: 'No autorizado' });
        }
        const customerId = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.customerId) || '').trim();
        const importedLineOrder = Number((_b = req.body) === null || _b === void 0 ? void 0 : _b.importedLineOrder);
        const nextDate = String(((_c = req.body) === null || _c === void 0 ? void 0 : _c.date) || '').trim();
        if (!customerId)
            return res.status(400).json({ message: 'Falta customerId' });
        if (!Number.isFinite(importedLineOrder) || importedLineOrder <= 0) {
            return res.status(400).json({ message: 'Falta importedLineOrder válido' });
        }
        if (!nextDate || !/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
            return res.status(400).json({ message: 'Fecha inválida. Formato esperado: YYYY-MM-DD' });
        }
        const cust = yield (0, db_1.get)('SELECT id, seller_id FROM customers WHERE id = ? LIMIT 1', [customerId]);
        if (!cust)
            return res.status(404).json({ message: 'Cliente no encontrado' });
        if (user.role === 'SELLER' && cust.seller_id !== user.id) {
            return res.status(403).json({ message: 'Solo podés editar recibos de tus clientes' });
        }
        const entry = yield (0, db_1.get)(`SELECT customer_id, line_order, tipo
       FROM customer_multimedia_entries
       WHERE customer_id = ? AND line_order = ?
       LIMIT 1`, [customerId, importedLineOrder]);
        if (!entry)
            return res.status(404).json({ message: 'Recibo importado no encontrado' });
        if (!String(entry.tipo || '').trim().toUpperCase().startsWith('REC')) {
            return res.status(400).json({ message: 'La línea indicada no es un recibo importado' });
        }
        yield (0, db_1.execute)(`UPDATE customer_multimedia_entries
       SET line_date = ?
       WHERE customer_id = ? AND line_order = ?`, [nextDate, customerId, importedLineOrder]);
        return res.json({ ok: true, customerId, importedLineOrder, date: nextDate });
    }
    catch (e) {
        console.error('updateImportedPaymentDate:', e);
        return res.status(500).json({ message: 'Error actualizando fecha del recibo importado', detail: e === null || e === void 0 ? void 0 : e.message });
    }
});
exports.updateImportedPaymentDate = updateImportedPaymentDate;
/** Elimina un recibo del sistema o una línea REC importada de Tango. */
const deletePayment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const user = req.user;
        if (!user || !canManagePayments(user.role)) {
            return res.status(403).json({ message: 'No autorizado' });
        }
        const routeId = String(((_a = req.params) === null || _a === void 0 ? void 0 : _a.id) || '').trim();
        const customerId = String(((_b = req.body) === null || _b === void 0 ? void 0 : _b.customerId) || '').trim();
        const importedLineOrder = Number((_c = req.body) === null || _c === void 0 ? void 0 : _c.importedLineOrder);
        if (routeId.startsWith('mm-') || (Number.isFinite(importedLineOrder) && importedLineOrder > 0)) {
            if (!customerId || !Number.isFinite(importedLineOrder) || importedLineOrder <= 0) {
                return res.status(400).json({
                    message: 'Para un recibo importado de Tango indicá customerId e importedLineOrder',
                });
            }
            const cust = (yield (0, db_1.get)('SELECT id, seller_id FROM customers WHERE id = ? LIMIT 1', [
                customerId,
            ]));
            if (!cust)
                return res.status(404).json({ message: 'Cliente no encontrado' });
            if (user.role === 'SELLER' && cust.seller_id !== user.id) {
                return res.status(403).json({ message: 'Solo podés eliminar recibos de tus clientes' });
            }
            const entry = yield (0, importedReceiptPayment_service_1.getImportedReceiptEntry)(customerId, importedLineOrder);
            if (!entry)
                return res.status(404).json({ message: 'Recibo importado no encontrado' });
            const linkedPaymentId = yield (0, importedReceiptPayment_service_1.findExistingPaymentIdForImportedEntry)(entry);
            if (linkedPaymentId) {
                const orderRows = (yield (0, db_1.query)(`SELECT DISTINCT COALESCE(i.order_id, po.order_id, p.order_id) AS order_id
           FROM payments p
           LEFT JOIN payment_invoices pi ON pi.payment_id = p.id
           LEFT JOIN payment_orders po ON po.payment_id = p.id
           LEFT JOIN invoices i ON i.id = COALESCE(pi.invoice_id, p.invoice_id)
           WHERE p.id = ?
             AND COALESCE(i.order_id, po.order_id, p.order_id) IS NOT NULL`, [linkedPaymentId]));
                yield (0, db_1.execute)('DELETE FROM payment_invoices WHERE payment_id = ?', [linkedPaymentId]);
                try {
                    yield (0, db_1.execute)('DELETE FROM payment_orders WHERE payment_id = ?', [linkedPaymentId]);
                }
                catch (_d) {
                    /* tabla opcional */
                }
                try {
                    yield (0, db_1.execute)('DELETE FROM payment_invoice_refs WHERE payment_id = ?', [linkedPaymentId]);
                }
                catch (_e) {
                    /* tabla opcional */
                }
                yield (0, db_1.execute)('DELETE FROM payments WHERE id = ?', [linkedPaymentId]);
                for (const r of orderRows) {
                    if (r.order_id)
                        yield (0, orderPaymentBalance_service_1.syncOrderPaymentStatus)(r.order_id);
                }
            }
            yield (0, db_1.execute)(`DELETE FROM customer_multimedia_entries WHERE customer_id = ? AND line_order = ?`, [customerId, importedLineOrder]);
            yield (0, orderPaymentBalance_service_1.syncAllOrderPaymentStatusForCustomer)(customerId);
            return res.json({ ok: true, customerId, importedLineOrder });
        }
        const paymentId = routeId;
        if (!paymentId)
            return res.status(400).json({ message: 'ID de recibo requerido' });
        const payment = (yield (0, db_1.get)(`SELECT p.id, p.customer_id, c.seller_id
       FROM payments p
       JOIN customers c ON c.id = p.customer_id
       WHERE p.id = ?`, [paymentId]));
        if (!payment)
            return res.status(404).json({ message: 'Recibo no encontrado' });
        if (user.role === 'SELLER' && payment.seller_id !== user.id) {
            return res.status(403).json({ message: 'Solo podés eliminar recibos de tus clientes' });
        }
        const orderRows = (yield (0, db_1.query)(`SELECT DISTINCT COALESCE(i.order_id, po.order_id, p.order_id) AS order_id
       FROM payments p
       LEFT JOIN payment_invoices pi ON pi.payment_id = p.id
       LEFT JOIN payment_orders po ON po.payment_id = p.id
       LEFT JOIN invoices i ON i.id = COALESCE(pi.invoice_id, p.invoice_id)
       WHERE p.id = ?
         AND COALESCE(i.order_id, po.order_id, p.order_id) IS NOT NULL`, [paymentId]));
        yield (0, db_1.execute)('DELETE FROM payment_invoices WHERE payment_id = ?', [paymentId]);
        try {
            yield (0, db_1.execute)('DELETE FROM payment_orders WHERE payment_id = ?', [paymentId]);
        }
        catch (_f) {
            /* tabla opcional */
        }
        try {
            yield (0, db_1.execute)('DELETE FROM payment_invoice_refs WHERE payment_id = ?', [paymentId]);
        }
        catch (_g) {
            /* tabla opcional */
        }
        yield (0, db_1.execute)('DELETE FROM payments WHERE id = ?', [paymentId]);
        const orderIds = new Set(orderRows.map((r) => r.order_id).filter(Boolean));
        for (const oid of orderIds) {
            yield (0, orderPaymentBalance_service_1.syncOrderPaymentStatus)(oid);
        }
        yield (0, orderPaymentBalance_service_1.syncAllOrderPaymentStatusForCustomer)(payment.customer_id);
        return res.json({ ok: true, id: paymentId });
    }
    catch (e) {
        console.error('deletePayment:', e);
        return res.status(500).json({ message: 'Error eliminando recibo', detail: e === null || e === void 0 ? void 0 : e.message });
    }
});
exports.deletePayment = deletePayment;
/** Crear pago/recibo. */
const createPayment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    try {
        const user = req.user;
        if (!user || !canManagePayments(user.role)) {
            return res.status(403).json({ message: 'No autorizado' });
        }
        const paymentInvoicesEnabled = yield ensurePaymentInvoicesTable();
        const paymentOrdersEnabled = yield ensurePaymentOrdersTable();
        const paymentInvoiceRefsEnabled = yield ensurePaymentInvoiceRefsTable();
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
        const orderIds = Array.isArray(body.orderIds)
            ? Array.from(new Set(body.orderIds
                .map((x) => String(x || '').trim())
                .filter((s) => s.length > 0)))
            : [];
        if (orderId && !orderIds.includes(orderId))
            orderIds.unshift(orderId);
        const invoiceId = body.invoiceId ? String(body.invoiceId).trim() : null;
        const invoiceIds = Array.isArray(body.invoiceIds)
            ? Array.from(new Set(body.invoiceIds
                .map((x) => String(x || '').trim())
                .filter((s) => s.length > 0)))
            : [];
        const notes = body.notes != null && String(body.notes).trim() ? String(body.notes).trim() : null;
        if (invoiceId && !invoiceIds.includes(invoiceId))
            invoiceIds.unshift(invoiceId);
        const systemInvoiceIds = invoiceIds.filter((id) => !id.startsWith('mm-fac-'));
        const systemOrderIds = orderIds.filter((id) => id && !id.startsWith('mm-'));
        const importedInvoiceRefs = invoiceIds.filter((id) => id.startsWith('mm-fac-'));
        const primaryInvoiceId = systemInvoiceIds[0] || null;
        const primaryOrderId = systemOrderIds[0] || orderId || null;
        if (systemInvoiceIds.length > 0) {
            const rows = yield (0, db_1.query)(`SELECT i.id, o.customer_id
         FROM invoices i
         JOIN orders o ON o.id = i.order_id
         WHERE i.id IN (${systemInvoiceIds.map(() => '?').join(',')})`, systemInvoiceIds);
            if (rows.length !== systemInvoiceIds.length) {
                return res.status(400).json({ message: 'Hay facturas inválidas en la selección del recibo' });
            }
            const invalidByCustomer = rows.find((r) => r.customer_id !== customerId);
            if (invalidByCustomer) {
                return res.status(400).json({ message: 'Solo podés relacionar facturas del mismo cliente del recibo' });
            }
        }
        try {
            yield (0, orderPaymentBalance_service_1.validateOrdersForPayment)(systemOrderIds, customerId);
        }
        catch (e) {
            return res.status((e === null || e === void 0 ? void 0 : e.statusCode) || 400).json({ message: e.message });
        }
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
                invoiceIds: row.invoice_id ? [row.invoice_id] : [],
                receiptNumber: row.receipt_number,
                date: row.date,
                amount: Number(row.amount) || 0,
                notes: (_d = row.notes) !== null && _d !== void 0 ? _d : undefined,
                createdAt: row.created_at
            });
        }
        const id = (0, uuid_1.v4)();
        let allocationResult = null;
        try {
            yield (0, db_1.execute)(`INSERT INTO payments (id, customer_id, seller_id, order_id, invoice_id, receipt_number, date, amount, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, customerId, sellerId, primaryOrderId, primaryInvoiceId, receiptNumber, date, amount, notes]);
            let resolvedOrderId = primaryOrderId;
            if (systemInvoiceIds.length > 0) {
                const invRow = (yield (0, db_1.get)('SELECT order_id FROM invoices WHERE id = ? LIMIT 1', [
                    systemInvoiceIds[0]
                ]));
                if (invRow === null || invRow === void 0 ? void 0 : invRow.order_id)
                    resolvedOrderId = invRow.order_id;
                if (resolvedOrderId && resolvedOrderId !== primaryOrderId) {
                    yield (0, db_1.execute)('UPDATE payments SET order_id = ? WHERE id = ?', [resolvedOrderId, id]);
                }
            }
            if ((systemInvoiceIds.length > 0 || systemOrderIds.length > 0) &&
                (paymentInvoicesEnabled || paymentOrdersEnabled)) {
                allocationResult = yield (0, orderPaymentBalance_service_1.allocatePayment)(id, amount, systemInvoiceIds, systemOrderIds);
            }
            else if (resolvedOrderId) {
                yield (0, orderPaymentBalance_service_1.syncOrderPaymentStatus)(resolvedOrderId);
            }
            else {
                yield (0, orderPaymentBalance_service_1.syncAllOrderPaymentStatusForCustomer)(customerId);
            }
            if (importedInvoiceRefs.length > 0 && paymentInvoiceRefsEnabled) {
                for (const invRef of importedInvoiceRefs) {
                    yield (0, db_1.execute)(`INSERT IGNORE INTO payment_invoice_refs (payment_id, invoice_ref, source) VALUES (?, ?, 'IMPORTED')`, [id, invRef]);
                }
            }
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
                        invoiceIds: rowDup.invoice_id ? [rowDup.invoice_id] : [],
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
        const row = yield (0, db_1.get)(paymentInvoicesEnabled
            ? `SELECT
         p.id, p.customer_id, p.seller_id, p.order_id, p.invoice_id, p.receipt_number, p.date, p.amount, p.notes, p.created_at,
         GROUP_CONCAT(DISTINCT pi.invoice_id) AS invoice_ids,
         ${paymentOrdersEnabled ? `GROUP_CONCAT(DISTINCT po.order_id) AS order_ids` : `NULL AS order_ids`},
         ${paymentInvoiceRefsEnabled ? `GROUP_CONCAT(DISTINCT pir.invoice_ref) AS invoice_refs` : `NULL AS invoice_refs`}
       FROM payments p
       LEFT JOIN payment_invoices pi ON pi.payment_id = p.id
       ${paymentOrdersEnabled ? `LEFT JOIN payment_orders po ON po.payment_id = p.id` : ``}
       ${paymentInvoiceRefsEnabled ? `LEFT JOIN payment_invoice_refs pir ON pir.payment_id = p.id` : ``}
       WHERE p.id = ?
       GROUP BY p.id, p.customer_id, p.seller_id, p.order_id, p.invoice_id, p.receipt_number, p.date, p.amount, p.notes, p.created_at`
            : `SELECT
         p.id, p.customer_id, p.seller_id, p.order_id, p.invoice_id, p.receipt_number, p.date, p.amount, p.notes, p.created_at,
         NULL AS invoice_ids,
         ${paymentInvoiceRefsEnabled ? `(SELECT GROUP_CONCAT(DISTINCT pir.invoice_ref) FROM payment_invoice_refs pir WHERE pir.payment_id = p.id) AS invoice_refs` : `NULL AS invoice_refs`}
       FROM payments p
       WHERE p.id = ?`, [id]);
        const allocationNote = allocationResult
            ? formatAllocationNote(allocationResult, amount)
            : undefined;
        res.status(201).json({
            id: row.id,
            customerId: row.customer_id,
            sellerId: (_j = row.seller_id) !== null && _j !== void 0 ? _j : undefined,
            orderId: (_k = row.order_id) !== null && _k !== void 0 ? _k : undefined,
            orderIds: String(row.order_ids || row.order_id || '')
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean),
            invoiceId: (_l = row.invoice_id) !== null && _l !== void 0 ? _l : undefined,
            invoiceIds: Array.from(new Set([
                ...String(row.invoice_ids || row.invoice_id || '')
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean),
                ...String(row.invoice_refs || '')
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean),
            ])),
            receiptNumber: row.receipt_number,
            date: row.date,
            amount: Number(row.amount) || 0,
            notes: (_m = row.notes) !== null && _m !== void 0 ? _m : undefined,
            createdAt: row.created_at,
            allocationNote,
            invoiceAllocations: (_o = allocationResult === null || allocationResult === void 0 ? void 0 : allocationResult.invoiceAllocations) !== null && _o !== void 0 ? _o : [],
            orderAllocations: (_p = allocationResult === null || allocationResult === void 0 ? void 0 : allocationResult.orderAllocations) !== null && _p !== void 0 ? _p : []
        });
    }
    catch (e) {
        console.error('createPayment:', e);
        res.status(500).json({ message: 'Error creando pago', detail: e === null || e === void 0 ? void 0 : e.message });
    }
});
exports.createPayment = createPayment;
/** Saldo pendiente por factura (permite varios recibos sobre la misma). */
const getInvoicesOutstandingHandler = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        if (!user || !canManagePayments(user.role)) {
            return res.status(403).json({ message: 'No autorizado' });
        }
        const raw = String(req.query.invoiceIds || req.query.invoiceId || '').trim();
        const invoiceIds = raw.split(',').map((x) => x.trim()).filter(Boolean);
        const excludePaymentId = String(req.query.excludePaymentId || '').trim() || undefined;
        if (!invoiceIds.length) {
            return res.status(400).json({ message: 'Indicá invoiceIds (separados por coma)' });
        }
        const rows = yield (0, orderPaymentBalance_service_1.getInvoicesOutstanding)(invoiceIds, excludePaymentId);
        return res.json(rows);
    }
    catch (e) {
        console.error('getInvoicesOutstanding:', e);
        return res.status(500).json({ message: 'Error consultando saldos de facturas' });
    }
});
exports.getInvoicesOutstandingHandler = getInvoicesOutstandingHandler;
/** Saldo pendiente por pedido sin factura. */
const getOrdersOutstandingHandler = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        if (!user || !canManagePayments(user.role)) {
            return res.status(403).json({ message: 'No autorizado' });
        }
        const raw = String(req.query.orderIds || req.query.orderId || '').trim();
        const orderIds = raw.split(',').map((x) => x.trim()).filter(Boolean);
        const excludePaymentId = String(req.query.excludePaymentId || '').trim() || undefined;
        if (!orderIds.length) {
            return res.status(400).json({ message: 'Indicá orderIds (separados por coma)' });
        }
        const rows = yield (0, orderPaymentBalance_service_1.getOrdersOutstanding)(orderIds, excludePaymentId);
        return res.json(rows);
    }
    catch (e) {
        console.error('getOrdersOutstanding:', e);
        return res.status(500).json({ message: 'Error consultando saldos de pedidos' });
    }
});
exports.getOrdersOutstandingHandler = getOrdersOutstandingHandler;
/** Datos previos para asociar un recibo importado de Tango (sin crear el pago hasta guardar). */
const getImportedReceiptLinkInfo = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const user = req.user;
        if (!user || !canManagePayments(user.role)) {
            return res.status(403).json({ message: 'No autorizado' });
        }
        const customerId = String(((_a = req.query) === null || _a === void 0 ? void 0 : _a.customerId) || '').trim();
        const importedLineOrder = Number((_b = req.query) === null || _b === void 0 ? void 0 : _b.importedLineOrder);
        if (!customerId)
            return res.status(400).json({ message: 'Falta customerId' });
        if (!Number.isFinite(importedLineOrder) || importedLineOrder <= 0) {
            return res.status(400).json({ message: 'Falta importedLineOrder válido' });
        }
        const cust = yield (0, db_1.get)('SELECT id, seller_id FROM customers WHERE id = ? LIMIT 1', [customerId]);
        if (!cust)
            return res.status(404).json({ message: 'Cliente no encontrado' });
        if (user.role === 'SELLER' && cust.seller_id !== user.id) {
            return res.status(403).json({ message: 'Solo podés ver recibos de tus clientes' });
        }
        const entry = yield (0, importedReceiptPayment_service_1.getImportedReceiptEntry)(customerId, importedLineOrder);
        if (!entry)
            return res.status(404).json({ message: 'Recibo importado no encontrado' });
        const paymentId = yield (0, importedReceiptPayment_service_1.findExistingPaymentIdForImportedEntry)(entry);
        const { invoiceIds, orderIds } = paymentId
            ? yield (0, importedReceiptPayment_service_1.getPaymentAllocationIds)(paymentId)
            : { invoiceIds: [], orderIds: [] };
        return res.json({
            customerId,
            importedLineOrder,
            paymentId: paymentId !== null && paymentId !== void 0 ? paymentId : undefined,
            receiptNumber: String(entry.numero || ''),
            date: toSqlDate(entry.line_date),
            amount: Math.round(parseImportedAmountForApi(entry.importe) * 100) / 100,
            invoiceIds,
            orderIds,
        });
    }
    catch (e) {
        const code = e === null || e === void 0 ? void 0 : e.statusCode;
        if (code === 400 || code === 404) {
            return res.status(code).json({ message: e.message });
        }
        console.error('getImportedReceiptLinkInfo:', e);
        return res.status(500).json({ message: 'Error consultando recibo importado', detail: e === null || e === void 0 ? void 0 : e.message });
    }
});
exports.getImportedReceiptLinkInfo = getImportedReceiptLinkInfo;
function parseImportedAmountForApi(v) {
    if (v == null)
        return 0;
    if (typeof v === 'number')
        return Number.isFinite(v) ? Math.abs(v) : 0;
    const s = String(v).trim().replace(/\s/g, '').replace(/\$/g, '');
    if (!s)
        return 0;
    const hasComma = s.includes(',');
    const hasDot = s.includes('.');
    let n = 0;
    if (hasComma && hasDot)
        n = Number(s.replace(/\./g, '').replace(',', '.'));
    else if (hasComma)
        n = Number(s.replace(',', '.'));
    else
        n = Number(s);
    return Number.isFinite(n) ? Math.abs(n) : 0;
}
/** Asocia un recibo ya cargado a facturas y/o pedidos sin factura del mismo cliente. */
const patchPaymentInvoices = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    try {
        const user = req.user;
        if (!user || !canManagePayments(user.role)) {
            return res.status(403).json({ message: 'No autorizado' });
        }
        const routePaymentId = String(((_a = req.params) === null || _a === void 0 ? void 0 : _a.id) || '').trim();
        if (!routePaymentId)
            return res.status(400).json({ message: 'ID de recibo requerido' });
        const invoiceIds = Array.isArray((_b = req.body) === null || _b === void 0 ? void 0 : _b.invoiceIds)
            ? req.body.invoiceIds
                .map((x) => String(x || '').trim())
                .filter((s) => s.length > 0)
            : [];
        const orderIds = Array.isArray((_c = req.body) === null || _c === void 0 ? void 0 : _c.orderIds)
            ? req.body.orderIds
                .map((x) => String(x || '').trim())
                .filter((s) => s.length > 0)
            : [];
        const importedInvoiceRefs = invoiceIds.filter((id) => id.startsWith('mm-fac-'));
        const systemInvoiceIds = invoiceIds.filter((id) => id && !id.startsWith('mm-'));
        const systemOrderIds = orderIds.filter((id) => id && !id.startsWith('mm-'));
        let paymentId = routePaymentId;
        if (routePaymentId.startsWith('mm-') || Number((_d = req.body) === null || _d === void 0 ? void 0 : _d.importedLineOrder) > 0) {
            const customerId = String(((_e = req.body) === null || _e === void 0 ? void 0 : _e.customerId) || '').trim();
            const importedLineOrder = Number((_f = req.body) === null || _f === void 0 ? void 0 : _f.importedLineOrder);
            if (!customerId || !Number.isFinite(importedLineOrder) || importedLineOrder <= 0) {
                return res.status(400).json({
                    message: 'Para un recibo importado de Tango indicá customerId e importedLineOrder al guardar la asociación.',
                });
            }
            const cust = (yield (0, db_1.get)('SELECT id, seller_id FROM customers WHERE id = ? LIMIT 1', [
                customerId,
            ]));
            if (!cust)
                return res.status(404).json({ message: 'Cliente no encontrado' });
            if (user.role === 'SELLER' && cust.seller_id !== user.id) {
                return res.status(403).json({ message: 'Solo podés modificar recibos de tus clientes' });
            }
            const sellerId = user.role === 'SELLER' ? user.id : (_g = cust.seller_id) !== null && _g !== void 0 ? _g : null;
            paymentId = yield (0, importedReceiptPayment_service_1.findOrCreatePaymentFromImportedReceipt)(customerId, importedLineOrder, sellerId);
        }
        const paymentOrdersEnabled = yield ensurePaymentOrdersTable();
        const paymentInvoiceRefsEnabled = yield ensurePaymentInvoiceRefsTable();
        const payment = (yield (0, db_1.get)(`SELECT p.id, p.customer_id, c.seller_id
       FROM payments p
       JOIN customers c ON c.id = p.customer_id
       WHERE p.id = ?`, [paymentId]));
        if (!payment)
            return res.status(404).json({ message: 'Recibo no encontrado' });
        if (user.role === 'SELLER' && payment.seller_id !== user.id) {
            return res.status(403).json({ message: 'Solo podés modificar recibos de tus clientes' });
        }
        const result = yield (0, orderPaymentBalance_service_1.relinkPaymentToInvoices)(paymentId, systemInvoiceIds, systemOrderIds);
        if (paymentInvoiceRefsEnabled) {
            yield (0, db_1.execute)('DELETE FROM payment_invoice_refs WHERE payment_id = ?', [paymentId]);
            if (importedInvoiceRefs.length > 0) {
                for (const invRef of importedInvoiceRefs) {
                    yield (0, db_1.execute)(`INSERT IGNORE INTO payment_invoice_refs (payment_id, invoice_ref, source) VALUES (?, ?, 'IMPORTED')`, [paymentId, invRef]);
                }
            }
        }
        const row = (yield (0, db_1.get)(`SELECT
         p.id, p.customer_id, p.seller_id, p.order_id, p.invoice_id,
         p.receipt_number, p.date, p.amount, p.notes, p.created_at,
         GROUP_CONCAT(DISTINCT pi.invoice_id) AS invoice_ids,
         ${paymentOrdersEnabled ? `GROUP_CONCAT(DISTINCT po.order_id) AS order_ids` : `NULL AS order_ids`},
         ${paymentInvoiceRefsEnabled ? `GROUP_CONCAT(DISTINCT pir.invoice_ref) AS invoice_refs` : `NULL AS invoice_refs`}
       FROM payments p
       LEFT JOIN payment_invoices pi ON pi.payment_id = p.id
       ${paymentOrdersEnabled ? `LEFT JOIN payment_orders po ON po.payment_id = p.id` : ``}
       ${paymentInvoiceRefsEnabled ? `LEFT JOIN payment_invoice_refs pir ON pir.payment_id = p.id` : ``}
       WHERE p.id = ?
       GROUP BY p.id, p.customer_id, p.seller_id, p.order_id, p.invoice_id,
         p.receipt_number, p.date, p.amount, p.notes, p.created_at`, [paymentId]));
        const allocationNote = formatAllocationNote(result, Number((row === null || row === void 0 ? void 0 : row.amount) || 0));
        return res.json({
            id: row.id,
            customerId: row.customer_id,
            orderId: (_h = row.order_id) !== null && _h !== void 0 ? _h : undefined,
            orderIds: String(row.order_ids || row.order_id || '')
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean),
            invoiceId: (_j = row.invoice_id) !== null && _j !== void 0 ? _j : undefined,
            invoiceIds: [
                ...String(row.invoice_ids || row.invoice_id || '')
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean),
                ...String(row.invoice_refs || '')
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean)
            ],
            receiptNumber: row.receipt_number,
            date: row.date,
            amount: Number(row.amount) || 0,
            notes: (_k = row.notes) !== null && _k !== void 0 ? _k : undefined,
            allocationNote,
            invoiceAllocations: result.invoiceAllocations,
            orderAllocations: result.orderAllocations
        });
    }
    catch (e) {
        const code = e === null || e === void 0 ? void 0 : e.statusCode;
        if (code === 400 || code === 404) {
            return res.status(code).json({ message: e.message });
        }
        console.error('patchPaymentInvoices:', e);
        return res.status(500).json({ message: 'Error asociando comprobantes al recibo', detail: e === null || e === void 0 ? void 0 : e.message });
    }
});
exports.patchPaymentInvoices = patchPaymentInvoices;
/** Vista previa: un recibo repartido en varias facturas (sin guardar). */
const postPaymentAllocatePreview = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const user = req.user;
        if (!user || !canManagePayments(user.role)) {
            return res.status(403).json({ message: 'No autorizado' });
        }
        const amount = Number((_a = req.body) === null || _a === void 0 ? void 0 : _a.amount);
        const invoiceIds = Array.isArray((_b = req.body) === null || _b === void 0 ? void 0 : _b.invoiceIds)
            ? req.body.invoiceIds.map((x) => String(x || '').trim()).filter(Boolean)
            : [];
        const orderIds = Array.isArray((_c = req.body) === null || _c === void 0 ? void 0 : _c.orderIds)
            ? req.body.orderIds.map((x) => String(x || '').trim()).filter(Boolean)
            : [];
        if (!invoiceIds.length && !orderIds.length) {
            return res.status(400).json({ message: 'Seleccioná al menos una factura o un pedido sin factura' });
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ message: 'Importe inválido' });
        }
        const excludePaymentId = String(((_d = req.body) === null || _d === void 0 ? void 0 : _d.excludePaymentId) || '').trim() || undefined;
        const preview = yield (0, orderPaymentBalance_service_1.previewPaymentAllocation)(amount, invoiceIds, orderIds, excludePaymentId);
        return res.json(preview);
    }
    catch (e) {
        console.error('postPaymentAllocatePreview:', e);
        return res.status(500).json({ message: 'Error en vista previa de imputación' });
    }
});
exports.postPaymentAllocatePreview = postPaymentAllocatePreview;
/** Editar fecha de un recibo/pago cargado en el sistema. */
const updatePaymentDate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    try {
        const user = req.user;
        if (!user || !canManagePayments(user.role)) {
            return res.status(403).json({ message: 'No autorizado' });
        }
        const paymentId = String(((_a = req.params) === null || _a === void 0 ? void 0 : _a.id) || '').trim();
        const nextDate = String(((_b = req.body) === null || _b === void 0 ? void 0 : _b.date) || '').trim();
        if (!paymentId)
            return res.status(400).json({ message: 'Falta ID de pago' });
        if (!nextDate)
            return res.status(400).json({ message: 'Falta fecha' });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
            return res.status(400).json({ message: 'Fecha inválida. Formato esperado: YYYY-MM-DD' });
        }
        const row = yield (0, db_1.get)(`SELECT p.id, p.customer_id, p.seller_id
       FROM payments p
       WHERE p.id = ?`, [paymentId]);
        if (!row)
            return res.status(404).json({ message: 'Recibo no encontrado' });
        if (user.role === 'SELLER') {
            const cust = yield (0, db_1.get)('SELECT seller_id FROM customers WHERE id = ? LIMIT 1', [row.customer_id]);
            if (!cust || cust.seller_id !== user.id) {
                return res.status(403).json({ message: 'Solo podés editar recibos de tus clientes' });
            }
        }
        try {
            yield (0, db_1.execute)(`UPDATE payments SET date = ? WHERE id = ?`, [nextDate, paymentId]);
        }
        catch (e) {
            const dup = (e === null || e === void 0 ? void 0 : e.code) === 'ER_DUP_ENTRY' || String((e === null || e === void 0 ? void 0 : e.message) || '').includes('Duplicate entry');
            if (dup) {
                return res.status(409).json({
                    message: 'Ya existe un recibo con mismo cliente, número, fecha e importe'
                });
            }
            throw e;
        }
        const updated = yield (0, db_1.get)(`SELECT id, customer_id, seller_id, order_id, invoice_id, receipt_number, date, amount, notes, created_at
       FROM payments
       WHERE id = ?`, [paymentId]);
        return res.json({
            id: updated.id,
            customerId: updated.customer_id,
            sellerId: (_c = updated.seller_id) !== null && _c !== void 0 ? _c : undefined,
            orderId: (_d = updated.order_id) !== null && _d !== void 0 ? _d : undefined,
            invoiceId: (_e = updated.invoice_id) !== null && _e !== void 0 ? _e : undefined,
            invoiceIds: updated.invoice_id ? [updated.invoice_id] : [],
            receiptNumber: updated.receipt_number,
            date: updated.date,
            amount: Number(updated.amount) || 0,
            notes: (_f = updated.notes) !== null && _f !== void 0 ? _f : undefined,
            createdAt: updated.created_at
        });
    }
    catch (e) {
        console.error('updatePaymentDate:', e);
        return res.status(500).json({ message: 'Error actualizando fecha del recibo', detail: e === null || e === void 0 ? void 0 : e.message });
    }
});
exports.updatePaymentDate = updatePaymentDate;
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
