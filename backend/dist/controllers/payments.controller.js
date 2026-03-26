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
exports.createPayment = exports.listPayments = void 0;
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
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
    var _a, _b, _c, _d;
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
        const id = (0, uuid_1.v4)();
        yield (0, db_1.execute)(`INSERT INTO payments (id, customer_id, seller_id, order_id, invoice_id, receipt_number, date, amount, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, customerId, sellerId, orderId, invoiceId, receiptNumber, date, amount, notes]);
        const row = yield (0, db_1.get)(`SELECT id, customer_id, seller_id, order_id, invoice_id, receipt_number, date, amount, notes, created_at
       FROM payments WHERE id = ?`, [id]);
        res.status(201).json({
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
    catch (e) {
        console.error('createPayment:', e);
        res.status(500).json({ message: 'Error creando pago', detail: e === null || e === void 0 ? void 0 : e.message });
    }
});
exports.createPayment = createPayment;
