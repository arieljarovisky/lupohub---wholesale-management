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
exports.SQL_ORDER_IN_SALDO_SCOPE = exports.SQL_ORDER_CARTERA_NET = exports.SQL_ORDER_CARGO_REINVOICE_NET = exports.SQL_ORDER_HAS_SUPERSEDED_REINVOICE = exports.SQL_ORDER_SALDO_RESIDUAL = exports.SQL_ORDER_CARGO_SALDO = exports.SQL_ORDER_NETO_AFIP = exports.SQL_ORDER_BASE_MINUS_NC = exports.SQL_INVOICE_AGIP_RET_PER = exports.SQL_CN_TOTAL_SUBQUERY = exports.SQL_ORDER_PAID_ON_ORDER = exports.SQL_PAYMENT_EXCLUDE_COMMISSION_P = exports.SQL_ORDER_NETO_GRAVADO = exports.SQL_PAYMENT_SALDO_CONTRIBUTION_AMOUNT = exports.SQL_PAYMENT_EXCLUDE_SUPERSEDED_REINVOICE_CARGO = exports.SQL_PAYMENT_IS_UNALLOCATED = void 0;
exports.backfillPaymentOrdersFromLegacy = backfillPaymentOrdersFromLegacy;
exports.getInvoiceOutstandingConIva = getInvoiceOutstandingConIva;
exports.getOrderOutstandingSinFactura = getOrderOutstandingSinFactura;
exports.allocatePaymentToInvoices = allocatePaymentToInvoices;
exports.allocatePaymentToOrders = allocatePaymentToOrders;
exports.allocatePayment = allocatePayment;
exports.previewPaymentAllocation = previewPaymentAllocation;
exports.getInvoicesOutstanding = getInvoicesOutstanding;
exports.getOrdersOutstanding = getOrdersOutstanding;
exports.validateOrdersForPayment = validateOrdersForPayment;
exports.relinkPaymentToInvoices = relinkPaymentToInvoices;
exports.syncOrderPaymentStatus = syncOrderPaymentStatus;
exports.syncAllOrderPaymentStatusForCustomer = syncAllOrderPaymentStatusForCustomer;
exports.listUnallocatedPayments = listUnallocatedPayments;
exports.getCustomerOutstandingInvoiceIds = getCustomerOutstandingInvoiceIds;
exports.getCustomerOutstandingOrderIds = getCustomerOutstandingOrderIds;
exports.autoAllocatePaymentByFifo = autoAllocatePaymentByFifo;
exports.autoAllocateAllUnallocatedPayments = autoAllocateAllUnallocatedPayments;
const db_1 = require("../database/db");
const orderPricing_1 = require("../config/orderPricing");
exports.SQL_PAYMENT_IS_UNALLOCATED = `(
  NOT EXISTS (SELECT 1 FROM payment_orders po_u WHERE po_u.payment_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM payment_invoices pi_u WHERE pi_u.payment_id = p.id)
  AND (p.invoice_id IS NULL OR TRIM(COALESCE(p.invoice_id, '')) = '')
  AND (p.order_id IS NULL OR TRIM(COALESCE(p.order_id, '')) = '')
)`;
/**
 * Recibo que cubre el cargo previo a una reemisión IIBB (mismo importe que la NC fiscal).
 * La NC ya reemplazó ese cargo; el recibo no debe restar otra vez del saldo actual.
 */
exports.SQL_PAYMENT_EXCLUDE_SUPERSEDED_REINVOICE_CARGO = `EXISTS (
  SELECT 1
  FROM credit_notes cn_r
  INNER JOIN orders o_r ON o_r.id = cn_r.order_id
  WHERE COALESCE(cn_r.superseded_by_reinvoice, 0) = 1
    AND o_r.customer_id = p.customer_id
    AND ROUND(ABS(COALESCE(p.amount, 0)), 2) = ${(0, orderPricing_1.sqlNetoAfipToAmountWithIva)('COALESCE(cn_r.amount_credited, 0)')}
    AND (
      p.order_id = cn_r.order_id
      OR EXISTS (
        SELECT 1 FROM payment_orders po_sr
        WHERE po_sr.payment_id = p.id AND po_sr.order_id = cn_r.order_id
      )
      OR EXISTS (
        SELECT 1 FROM payment_invoices pi_sr
        INNER JOIN invoices i_sr ON i_sr.id = pi_sr.invoice_id
        WHERE pi_sr.payment_id = p.id AND i_sr.order_id = cn_r.order_id
      )
      OR EXISTS (
        SELECT 1 FROM invoices i_ld
        WHERE i_ld.id = p.invoice_id AND i_ld.order_id = cn_r.order_id
      )
      OR ${exports.SQL_PAYMENT_IS_UNALLOCATED}
    )
)`;
/** Importe del recibo que impacta saldo cartera/historial (0 si cubre cargo previo a reemisión IIBB). */
exports.SQL_PAYMENT_SALDO_CONTRIBUTION_AMOUNT = `ROUND(
  CASE
    WHEN (${exports.SQL_PAYMENT_EXCLUDE_SUPERSEDED_REINVOICE_CARGO}) THEN 0
    ELSE COALESCE(p.amount, 0)
  END,
  2
)`;
exports.SQL_ORDER_NETO_GRAVADO = `GREATEST(
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
/** Comisión importada: no es cobranza hasta que se imputa a facturas/pedidos. */
exports.SQL_PAYMENT_EXCLUDE_COMMISSION_P = `(
  (
    COALESCE(p.notes, '') NOT LIKE '%comisión vendedor%'
    AND COALESCE(p.notes, '') NOT LIKE '%comision vendedor%'
  )
  OR EXISTS (SELECT 1 FROM payment_invoices pi_comm WHERE pi_comm.payment_id = p.id)
  OR EXISTS (SELECT 1 FROM payment_orders po_comm WHERE po_comm.payment_id = p.id)
  OR (p.invoice_id IS NOT NULL AND TRIM(COALESCE(p.invoice_id, '')) <> '')
  OR (p.order_id IS NOT NULL AND TRIM(COALESCE(p.order_id, '')) <> '')
)`;
/** Pagos imputados a este pedido: payment_orders, payment_invoices, o legacy order_id/invoice_id. */
exports.SQL_ORDER_PAID_ON_ORDER = `COALESCE((
  SELECT SUM(ROUND(per_payment.applied, 2))
  FROM (
    SELECT
      p.id,
      COALESCE(
        NULLIF((
          SELECT SUM(
            CASE
              WHEN po.amount_applied IS NOT NULL AND po.amount_applied > 0 THEN po.amount_applied
              ELSE 0
            END
          )
          FROM payment_orders po
          WHERE po.payment_id = p.id AND po.order_id = o.id
        ), 0),
        NULLIF((
          SELECT SUM(
            CASE
              WHEN pi2.amount_applied IS NOT NULL AND pi2.amount_applied > 0 THEN pi2.amount_applied
              ELSE 0
            END
          )
          FROM payment_invoices pi2
          INNER JOIN invoices i2 ON i2.id = pi2.invoice_id
          WHERE pi2.payment_id = p.id AND i2.order_id = o.id
        ), 0),
        CASE
          WHEN EXISTS (SELECT 1 FROM invoices i3 WHERE i3.id = p.invoice_id AND i3.order_id = o.id)
            THEN ROUND(COALESCE(p.amount, 0), 2)
          WHEN p.order_id = o.id
            AND NOT EXISTS (SELECT 1 FROM payment_orders po2 WHERE po2.payment_id = p.id)
            THEN ROUND(COALESCE(p.amount, 0), 2)
          ELSE 0
        END
      ) AS applied
    FROM payments p
    WHERE ${exports.SQL_PAYMENT_EXCLUDE_COMMISSION_P}
      AND (
        EXISTS (SELECT 1 FROM payment_orders po WHERE po.payment_id = p.id AND po.order_id = o.id)
        OR EXISTS (
          SELECT 1 FROM payment_invoices pi
          INNER JOIN invoices i ON i.id = pi.invoice_id
          WHERE pi.payment_id = p.id AND i.order_id = o.id
        )
        OR EXISTS (SELECT 1 FROM invoices i WHERE i.id = p.invoice_id AND i.order_id = o.id)
        OR p.order_id = o.id
      )
  ) per_payment
), 0)`;
/** NC activas por pedido (excluye NC anuladas al reemitir factura con IIBB). */
exports.SQL_CN_TOTAL_SUBQUERY = `
  SELECT order_id, SUM(amount_credited) AS cn_total
  FROM credit_notes
  WHERE COALESCE(superseded_by_reinvoice, 0) = 0
  GROUP BY order_id
`;
exports.SQL_INVOICE_AGIP_RET_PER = `COALESCE((
  SELECT i.agip_ret_per FROM invoices i WHERE i.order_id = o.id LIMIT 1
), 0)`;
exports.SQL_ORDER_BASE_MINUS_NC = orderPricing_1.ORDER_PRICES_INCLUDE_IVA
    ? `GREATEST(0, (${exports.SQL_ORDER_NETO_GRAVADO}) - ROUND(COALESCE(cn.cn_total, 0) * ${orderPricing_1.IVA_MULTIPLIER}, 2))`
    : `GREATEST(0, (${exports.SQL_ORDER_NETO_GRAVADO}) - COALESCE(cn.cn_total, 0))`;
/** Neto AFIP equivalente al total de líneas del pedido. */
exports.SQL_ORDER_NETO_AFIP = orderPricing_1.ORDER_PRICES_INCLUDE_IVA
    ? `ROUND((${exports.SQL_ORDER_NETO_GRAVADO}) / ${orderPricing_1.IVA_MULTIPLIER}, 2)`
    : `(${exports.SQL_ORDER_NETO_GRAVADO})`;
/** Cargo del pedido (líneas con IVA incluido o neto+IVA según config; NC en neto AFIP). */
exports.SQL_ORDER_CARGO_SALDO = `CASE
  WHEN EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id)
    THEN ROUND(
      (${exports.SQL_ORDER_BASE_MINUS_NC})${orderPricing_1.ORDER_PRICES_INCLUDE_IVA ? '' : ` * ${orderPricing_1.IVA_MULTIPLIER}`} + (${exports.SQL_INVOICE_AGIP_RET_PER}),
    2)
  ELSE ROUND((${exports.SQL_ORDER_BASE_MINUS_NC}), 2)
END`;
/** Saldo pendiente del pedido menos cobros imputados (neto sin factura; con IVA si está facturado). */
exports.SQL_ORDER_SALDO_RESIDUAL = `GREATEST(0,
  (${exports.SQL_ORDER_CARGO_SALDO})
  - (${exports.SQL_ORDER_PAID_ON_ORDER})
)`;
/** Pedido con NC de reemisión (NC + factura nueva con IIBB); no se descuenta el recibo imputado al cargo viejo. */
exports.SQL_ORDER_HAS_SUPERSEDED_REINVOICE = `EXISTS (
  SELECT 1 FROM credit_notes cn_r
  WHERE cn_r.order_id = o.id AND COALESCE(cn_r.superseded_by_reinvoice, 0) = 1
)`;
/** Cargo de la factura reemitida (sin IIBB en saldo; el IIBB queda en AFIP). */
exports.SQL_ORDER_CARGO_REINVOICE_NET = orderPricing_1.ORDER_PRICES_INCLUDE_IVA
    ? `ROUND((${exports.SQL_ORDER_BASE_MINUS_NC}), 2)`
    : `ROUND((${exports.SQL_ORDER_BASE_MINUS_NC}) * ${orderPricing_1.IVA_MULTIPLIER}, 2)`;
/** Contribución al saldo de cartera por pedido (reemisión = cargo completo sin restar cobros). */
exports.SQL_ORDER_CARTERA_NET = `CASE
  WHEN ${exports.SQL_ORDER_HAS_SUPERSEDED_REINVOICE}
    THEN (${exports.SQL_ORDER_CARGO_REINVOICE_NET})
  ELSE (${exports.SQL_ORDER_SALDO_RESIDUAL})
END`;
exports.SQL_ORDER_IN_SALDO_SCOPE = `(
  COALESCE(o.include_in_saldo, 0) = 1
  OR (${exports.SQL_ORDER_SALDO_RESIDUAL}) > 0.005
)`;
/** Repone vínculos payment_orders desde payments.order_id legacy (una sola vez por recibo). */
function backfillPaymentOrdersFromLegacy() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield (0, db_1.execute)(`
      INSERT IGNORE INTO payment_orders (payment_id, order_id, amount_applied)
      SELECT p.id, p.order_id, ROUND(COALESCE(p.amount, 0), 2)
      FROM payments p
      WHERE p.order_id IS NOT NULL AND TRIM(p.order_id) <> ''
        AND (p.invoice_id IS NULL OR TRIM(p.invoice_id) = '')
        AND NOT EXISTS (SELECT 1 FROM payment_invoices pi WHERE pi.payment_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM payment_orders po WHERE po.payment_id = p.id)
    `);
        }
        catch (_a) {
            // Tabla payment_orders puede no existir aún en despliegues parciales.
        }
    });
}
function round2(n) {
    return Math.round(n * 100) / 100;
}
/** Saldo pendiente de una factura (con IVA) antes de imputar un pago nuevo. */
function getInvoiceOutstandingConIva(invoiceId, excludePaymentId) {
    return __awaiter(this, void 0, void 0, function* () {
        const excl = excludePaymentId ? ' AND p.id <> ?' : '';
        const params = excludePaymentId ? [excludePaymentId, invoiceId] : [invoiceId];
        const row = (yield (0, db_1.get)(`SELECT
       ROUND(
         GREATEST(0, (${exports.SQL_ORDER_NETO_GRAVADO}) - COALESCE(cn.cn_total, 0)) * 1.21
         + COALESCE(i.agip_ret_per, 0),
       2) AS cargo_iva,
       COALESCE((
         SELECT SUM(ROUND(per_pay.applied, 2))
         FROM (
           SELECT
             p.id,
             COALESCE(
               (
                 SELECT pi1.amount_applied
                 FROM payment_invoices pi1
                 WHERE pi1.payment_id = p.id AND pi1.invoice_id = i.id
                   AND pi1.amount_applied IS NOT NULL AND pi1.amount_applied > 0
                 LIMIT 1
               ),
               CASE WHEN p.invoice_id = i.id THEN ROUND(COALESCE(p.amount, 0), 2) ELSE 0 END
             ) AS applied
           FROM payments p
           WHERE (
             EXISTS (SELECT 1 FROM payment_invoices pi0 WHERE pi0.payment_id = p.id AND pi0.invoice_id = i.id)
             OR p.invoice_id = i.id
           )
             AND ${exports.SQL_PAYMENT_EXCLUDE_COMMISSION_P}
             ${excl}
         ) per_pay
       ), 0) AS paid
     FROM invoices i
     JOIN orders o ON o.id = i.order_id
     LEFT JOIN (${exports.SQL_CN_TOTAL_SUBQUERY}) cn ON cn.order_id = o.id
     WHERE i.id = ?`, params));
        if (!row)
            return 0;
        return round2(Math.max(0, Number(row.cargo_iva || 0) - Number(row.paid || 0)));
    });
}
function getPaymentAppliedToOrder(paymentId, orderId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const row = (yield (0, db_1.get)(`SELECT
       COALESCE(
         NULLIF((
           SELECT po.amount_applied FROM payment_orders po
           WHERE po.payment_id = ? AND po.order_id = ?
             AND po.amount_applied IS NOT NULL AND po.amount_applied > 0
           LIMIT 1
         ), 0),
         NULLIF((
           SELECT SUM(pi.amount_applied)
           FROM payment_invoices pi
           INNER JOIN invoices i ON i.id = pi.invoice_id
           WHERE pi.payment_id = ? AND i.order_id = ?
             AND pi.amount_applied IS NOT NULL AND pi.amount_applied > 0
         ), 0),
         CASE
           WHEN EXISTS (SELECT 1 FROM invoices i WHERE i.id = p.invoice_id AND i.order_id = ?)
             THEN ROUND(COALESCE(p.amount, 0), 2)
           WHEN p.order_id = ?
             AND NOT EXISTS (SELECT 1 FROM payment_orders po2 WHERE po2.payment_id = p.id)
             THEN ROUND(COALESCE(p.amount, 0), 2)
           ELSE 0
         END
       ) AS applied
     FROM payments p
     WHERE p.id = ?`, [paymentId, orderId, paymentId, orderId, orderId, orderId, paymentId]));
        return round2(Number((_a = row === null || row === void 0 ? void 0 : row.applied) !== null && _a !== void 0 ? _a : 0));
    });
}
/** Saldo pendiente de un pedido sin factura (con IVA, neto de NC). */
function getOrderOutstandingSinFactura(orderId, excludePaymentId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const row = (yield (0, db_1.get)(`SELECT (${exports.SQL_ORDER_SALDO_RESIDUAL}) AS residual
     FROM orders o
     LEFT JOIN (${exports.SQL_CN_TOTAL_SUBQUERY}) cn ON cn.order_id = o.id
     WHERE o.id = ?`, [orderId]));
        let out = round2(Math.max(0, Number((_a = row === null || row === void 0 ? void 0 : row.residual) !== null && _a !== void 0 ? _a : 0)));
        if (excludePaymentId && out >= 0) {
            const applied = yield getPaymentAppliedToOrder(excludePaymentId, orderId);
            out = round2(out + applied);
        }
        return out;
    });
}
/** Reparte un recibo entre varias facturas (orden de la lista) y permite varios recibos por factura. */
function allocatePaymentToInvoices(paymentId, totalAmount, invoiceIds) {
    return __awaiter(this, void 0, void 0, function* () {
        let remaining = round2(totalAmount);
        let appliedTotal = 0;
        const orderIds = new Set();
        const allocations = [];
        for (const invoiceId of invoiceIds) {
            if (remaining <= 0.005)
                break;
            const outstandingBefore = yield getInvoiceOutstandingConIva(invoiceId, paymentId);
            if (outstandingBefore <= 0.005)
                continue;
            const applied = round2(Math.min(remaining, outstandingBefore));
            yield (0, db_1.execute)(`INSERT INTO payment_invoices (payment_id, invoice_id, amount_applied)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE amount_applied = VALUES(amount_applied)`, [paymentId, invoiceId, applied]);
            remaining = round2(remaining - applied);
            appliedTotal = round2(appliedTotal + applied);
            allocations.push({
                invoiceId,
                applied,
                outstandingBefore,
                outstandingAfter: round2(Math.max(0, outstandingBefore - applied))
            });
            const ord = (yield (0, db_1.get)('SELECT order_id FROM invoices WHERE id = ?', [invoiceId]));
            if (ord === null || ord === void 0 ? void 0 : ord.order_id)
                orderIds.add(ord.order_id);
        }
        for (const orderId of orderIds) {
            yield syncOrderPaymentStatus(orderId);
        }
        return { appliedTotal, remainingUnallocated: remaining, allocations };
    });
}
/** Reparte un recibo entre pedidos sin factura (orden de la lista). */
function allocatePaymentToOrders(paymentId, totalAmount, orderIds) {
    return __awaiter(this, void 0, void 0, function* () {
        let remaining = round2(totalAmount);
        let appliedTotal = 0;
        const allocations = [];
        for (const orderId of orderIds) {
            if (remaining <= 0.005)
                break;
            const outstandingBefore = yield getOrderOutstandingSinFactura(orderId, paymentId);
            if (outstandingBefore <= 0.005)
                continue;
            const applied = round2(Math.min(remaining, outstandingBefore));
            yield (0, db_1.execute)(`INSERT INTO payment_orders (payment_id, order_id, amount_applied)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE amount_applied = VALUES(amount_applied)`, [paymentId, orderId, applied]);
            remaining = round2(remaining - applied);
            appliedTotal = round2(appliedTotal + applied);
            allocations.push({
                orderId,
                applied,
                outstandingBefore,
                outstandingAfter: round2(Math.max(0, outstandingBefore - applied))
            });
            yield (0, db_1.execute)(`UPDATE orders SET include_in_saldo = 1 WHERE id = ? AND COALESCE(include_in_saldo, 0) = 0`, [orderId]);
            yield syncOrderPaymentStatus(orderId);
        }
        return { appliedTotal, remainingUnallocated: remaining, allocations };
    });
}
/** Imputa recibo: primero facturas, luego pedidos sin factura. */
function allocatePayment(paymentId, totalAmount, invoiceIds, orderIds) {
    return __awaiter(this, void 0, void 0, function* () {
        const invResult = yield allocatePaymentToInvoices(paymentId, totalAmount, invoiceIds);
        const orderResult = yield allocatePaymentToOrders(paymentId, invResult.remainingUnallocated, orderIds);
        return {
            appliedTotal: round2(invResult.appliedTotal + orderResult.appliedTotal),
            remainingUnallocated: orderResult.remainingUnallocated,
            invoiceAllocations: invResult.allocations,
            orderAllocations: orderResult.allocations
        };
    });
}
/** Vista previa de imputación (misma lógica que allocatePayment, sin grabar). */
function previewPaymentAllocation(totalAmount_1, invoiceIds_1) {
    return __awaiter(this, arguments, void 0, function* (totalAmount, invoiceIds, orderIds = [], excludePaymentId) {
        let remaining = round2(totalAmount);
        let appliedTotal = 0;
        const invoiceAllocations = [];
        const orderAllocations = [];
        for (const invoiceId of invoiceIds) {
            if (remaining <= 0.005)
                break;
            const outstandingBefore = yield getInvoiceOutstandingConIva(invoiceId, excludePaymentId);
            if (outstandingBefore <= 0.005)
                continue;
            const applied = round2(Math.min(remaining, outstandingBefore));
            remaining = round2(remaining - applied);
            appliedTotal = round2(appliedTotal + applied);
            invoiceAllocations.push({
                invoiceId,
                applied,
                outstandingBefore,
                outstandingAfter: round2(Math.max(0, outstandingBefore - applied))
            });
        }
        for (const orderId of orderIds) {
            if (remaining <= 0.005)
                break;
            const outstandingBefore = yield getOrderOutstandingSinFactura(orderId, excludePaymentId);
            if (outstandingBefore <= 0.005)
                continue;
            const applied = round2(Math.min(remaining, outstandingBefore));
            remaining = round2(remaining - applied);
            appliedTotal = round2(appliedTotal + applied);
            orderAllocations.push({
                orderId,
                applied,
                outstandingBefore,
                outstandingAfter: round2(Math.max(0, outstandingBefore - applied))
            });
        }
        return {
            appliedTotal,
            remainingUnallocated: remaining,
            invoiceAllocations,
            orderAllocations
        };
    });
}
/** Saldo pendiente por factura (varios recibos acumulados). */
function getInvoicesOutstanding(invoiceIds, excludePaymentId) {
    return __awaiter(this, void 0, void 0, function* () {
        const out = [];
        for (const invoiceId of invoiceIds) {
            out.push({
                invoiceId,
                outstanding: yield getInvoiceOutstandingConIva(invoiceId, excludePaymentId)
            });
        }
        return out;
    });
}
/** Saldo pendiente por pedido sin factura. */
function getOrdersOutstanding(orderIds, excludePaymentId) {
    return __awaiter(this, void 0, void 0, function* () {
        const out = [];
        for (const orderId of orderIds) {
            out.push({
                orderId,
                outstanding: yield getOrderOutstandingSinFactura(orderId, excludePaymentId)
            });
        }
        return out;
    });
}
/** Valida pedidos sin factura para imputación de recibo. */
function validateOrdersForPayment(orderIds, customerId) {
    return __awaiter(this, void 0, void 0, function* () {
        if (orderIds.length === 0)
            return;
        const rows = (yield (0, db_1.query)(`SELECT o.id, o.customer_id,
            EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id) AS has_invoice
     FROM orders o
     WHERE o.id IN (${orderIds.map(() => '?').join(',')})`, orderIds));
        if (rows.length !== orderIds.length) {
            const err = new Error('Hay pedidos inválidos en la selección');
            err.statusCode = 400;
            throw err;
        }
        const invalidCustomer = rows.find((r) => r.customer_id !== customerId);
        if (invalidCustomer) {
            const err = new Error('Todos los pedidos deben ser del mismo cliente que el recibo');
            err.statusCode = 400;
            throw err;
        }
        const invoiced = rows.find((r) => Number(r.has_invoice) === 1);
        if (invoiced) {
            const err = new Error('Un pedido facturado se imputa por su factura, no directamente al pedido');
            err.statusCode = 400;
            throw err;
        }
    });
}
/** Reasocia un recibo ya cargado a facturas y/o pedidos sin factura. */
function relinkPaymentToInvoices(paymentId_1, invoiceIds_1) {
    return __awaiter(this, arguments, void 0, function* (paymentId, invoiceIds, orderIds = []) {
        var _a;
        const payment = (yield (0, db_1.get)(`SELECT id, customer_id, amount, notes FROM payments WHERE id = ?`, [paymentId]));
        if (!payment) {
            const err = new Error('Recibo no encontrado');
            err.statusCode = 404;
            throw err;
        }
        const amount = round2(Number(payment.amount) || 0);
        const systemInvoiceIds = invoiceIds.filter((id) => id && !id.startsWith('mm-'));
        const systemOrderIds = orderIds.filter((id) => id && !id.startsWith('mm-'));
        yield backfillPaymentOrdersFromLegacy();
        const oldOrderRows = (yield (0, db_1.query)(`SELECT DISTINCT COALESCE(i.order_id, po.order_id, p.order_id) AS order_id
     FROM payments p
     LEFT JOIN payment_invoices pi ON pi.payment_id = p.id
     LEFT JOIN payment_orders po ON po.payment_id = p.id
     LEFT JOIN invoices i ON i.id = COALESCE(pi.invoice_id, p.invoice_id)
     WHERE p.id = ?
       AND COALESCE(i.order_id, po.order_id, p.order_id) IS NOT NULL`, [paymentId]));
        yield (0, db_1.execute)('DELETE FROM payment_invoices WHERE payment_id = ?', [paymentId]);
        yield (0, db_1.execute)('DELETE FROM payment_orders WHERE payment_id = ?', [paymentId]);
        if (systemInvoiceIds.length === 0 && systemOrderIds.length === 0) {
            yield (0, db_1.execute)('UPDATE payments SET invoice_id = NULL, order_id = NULL WHERE id = ?', [paymentId]);
            for (const r of oldOrderRows) {
                if (r.order_id)
                    yield syncOrderPaymentStatus(r.order_id);
            }
            yield syncAllOrderPaymentStatusForCustomer(payment.customer_id);
            return {
                appliedTotal: 0,
                remainingUnallocated: amount,
                invoiceAllocations: [],
                orderAllocations: []
            };
        }
        if (systemInvoiceIds.length > 0) {
            const rows = (yield (0, db_1.query)(`SELECT i.id, o.customer_id
       FROM invoices i
       JOIN orders o ON o.id = i.order_id
       WHERE i.id IN (${systemInvoiceIds.map(() => '?').join(',')})`, systemInvoiceIds));
            if (rows.length !== systemInvoiceIds.length) {
                const err = new Error('Hay facturas inválidas en la selección');
                err.statusCode = 400;
                throw err;
            }
            const invalid = rows.find((r) => r.customer_id !== payment.customer_id);
            if (invalid) {
                const err = new Error('Todas las facturas deben ser del mismo cliente que el recibo');
                err.statusCode = 400;
                throw err;
            }
        }
        yield validateOrdersForPayment(systemOrderIds, payment.customer_id);
        const primaryInvoiceId = systemInvoiceIds[0] || null;
        let primaryOrderId = null;
        if (primaryInvoiceId) {
            const ord = (yield (0, db_1.get)('SELECT order_id FROM invoices WHERE id = ?', [primaryInvoiceId]));
            primaryOrderId = (_a = ord === null || ord === void 0 ? void 0 : ord.order_id) !== null && _a !== void 0 ? _a : null;
        }
        else if (systemOrderIds.length > 0) {
            primaryOrderId = systemOrderIds[0];
        }
        yield (0, db_1.execute)('UPDATE payments SET invoice_id = ?, order_id = ? WHERE id = ?', [
            primaryInvoiceId,
            primaryOrderId,
            paymentId
        ]);
        const result = yield allocatePayment(paymentId, amount, systemInvoiceIds, systemOrderIds);
        const orderIdsToSync = new Set();
        for (const r of oldOrderRows) {
            if (r.order_id)
                orderIdsToSync.add(r.order_id);
        }
        for (const invId of systemInvoiceIds) {
            const o = (yield (0, db_1.get)('SELECT order_id FROM invoices WHERE id = ?', [invId]));
            if (o === null || o === void 0 ? void 0 : o.order_id)
                orderIdsToSync.add(o.order_id);
        }
        for (const oid of systemOrderIds) {
            orderIdsToSync.add(oid);
        }
        for (const oid of orderIdsToSync) {
            yield syncOrderPaymentStatus(oid);
        }
        return result;
    });
}
/** Marca pedido pagado solo si el saldo residual (post-NC y cobros) es cero. */
function syncOrderPaymentStatus(orderId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const row = (yield (0, db_1.get)(`SELECT (${exports.SQL_ORDER_SALDO_RESIDUAL}) AS residual
     FROM orders o
     LEFT JOIN (${exports.SQL_CN_TOTAL_SUBQUERY}) cn ON cn.order_id = o.id
     WHERE o.id = ?`, [orderId]));
        const residual = Number((_a = row === null || row === void 0 ? void 0 : row.residual) !== null && _a !== void 0 ? _a : 0);
        if (residual <= 0.01) {
            yield (0, db_1.execute)(`UPDATE orders SET payment_status = 'pagado', include_in_saldo = 0 WHERE id = ?`, [orderId]);
        }
        else {
            yield (0, db_1.execute)(`UPDATE orders SET payment_status = 'pendiente' WHERE id = ?`, [orderId]);
        }
    });
}
/** Recalcula cobro de todos los pedidos del cliente con factura. */
function syncAllOrderPaymentStatusForCustomer(customerId) {
    return __awaiter(this, void 0, void 0, function* () {
        const rows = (yield (0, db_1.query)(`SELECT DISTINCT o.id
     FROM orders o
     WHERE o.customer_id = ?
       AND o.status NOT IN ('Cancelado', 'Borrador')
       AND (o.archived = 0 OR o.archived IS NULL)
       AND (
         EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id)
         OR COALESCE(o.include_in_saldo, 0) = 1
       )`, [customerId]));
        for (const r of rows) {
            yield syncOrderPaymentStatus(r.id);
        }
    });
}
function isCommissionImportPayment(notes) {
    const n = String(notes || '').toLowerCase();
    return n.includes('comisión vendedor') || n.includes('comision vendedor');
}
/** Recibos sin filas en payment_invoices ni payment_orders (misma regla que “Sin imputar” en historial). */
function listUnallocatedPayments() {
    return __awaiter(this, void 0, void 0, function* () {
        yield backfillPaymentOrdersFromLegacy();
        const rows = (yield (0, db_1.query)(`SELECT p.id, p.customer_id, p.amount, p.date, p.receipt_number, p.notes
     FROM payments p
     WHERE COALESCE(p.amount, 0) > 0.005
       AND NOT EXISTS (SELECT 1 FROM payment_invoices pi WHERE pi.payment_id = p.id)
       AND NOT EXISTS (SELECT 1 FROM payment_orders po WHERE po.payment_id = p.id)
     ORDER BY p.date ASC, p.created_at ASC`));
        return rows.map((r) => (Object.assign(Object.assign({}, r), { amount: round2(Number(r.amount) || 0) })));
    });
}
/** Facturas con saldo pendiente del cliente (más antiguas primero). */
function getCustomerOutstandingInvoiceIds(customerId, excludePaymentId) {
    return __awaiter(this, void 0, void 0, function* () {
        const rows = (yield (0, db_1.query)(`SELECT i.id
     FROM invoices i
     JOIN orders o ON o.id = i.order_id
     WHERE o.customer_id = ?
       AND o.status NOT IN ('Cancelado', 'Borrador')
       AND (o.archived = 0 OR o.archived IS NULL)
     ORDER BY i.created_at ASC, i.id ASC`, [customerId]));
        const out = [];
        for (const r of rows) {
            const outstanding = yield getInvoiceOutstandingConIva(r.id, excludePaymentId);
            if (outstanding > 0.005)
                out.push(r.id);
        }
        return out;
    });
}
/** Pedidos sin factura con saldo pendiente (más antiguos primero). */
function getCustomerOutstandingOrderIds(customerId, excludePaymentId) {
    return __awaiter(this, void 0, void 0, function* () {
        const rows = (yield (0, db_1.query)(`SELECT o.id
     FROM orders o
     LEFT JOIN (${exports.SQL_CN_TOTAL_SUBQUERY}) cn ON cn.order_id = o.id
     WHERE o.customer_id = ?
       AND o.status NOT IN ('Cancelado', 'Borrador')
       AND (o.archived = 0 OR o.archived IS NULL)
       AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id)
       AND (${exports.SQL_ORDER_SALDO_RESIDUAL}) > 0.005
     ORDER BY o.date ASC, o.id ASC`, [customerId]));
        const out = [];
        for (const r of rows) {
            const outstanding = yield getOrderOutstandingSinFactura(r.id, excludePaymentId);
            if (outstanding > 0.005)
                out.push(r.id);
        }
        return out;
    });
}
/** Imputa un recibo sin asignar a deuda pendiente del cliente (facturas, luego pedidos). */
function autoAllocatePaymentByFifo(paymentId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const payment = (yield (0, db_1.get)(`SELECT id, customer_id, amount, notes FROM payments WHERE id = ?`, [paymentId]));
        if (!payment) {
            const err = new Error('Recibo no encontrado');
            err.statusCode = 404;
            throw err;
        }
        if (isCommissionImportPayment(payment.notes)) {
            return {
                paymentId,
                customerId: payment.customer_id,
                appliedTotal: 0,
                remainingUnallocated: round2(Number(payment.amount) || 0),
                invoiceAllocations: [],
                orderAllocations: [],
                skipped: 'comisión vendedor (no se imputa a facturas del cliente)'
            };
        }
        const hasLinks = (yield (0, db_1.get)(`SELECT 1 AS x FROM payment_invoices WHERE payment_id = ? LIMIT 1`, [paymentId]));
        const hasOrderLinks = (yield (0, db_1.get)(`SELECT 1 AS x FROM payment_orders WHERE payment_id = ? LIMIT 1`, [paymentId]));
        if (hasLinks || hasOrderLinks) {
            return {
                paymentId,
                customerId: payment.customer_id,
                appliedTotal: 0,
                remainingUnallocated: round2(Number(payment.amount) || 0),
                invoiceAllocations: [],
                orderAllocations: [],
                skipped: 'ya imputado'
            };
        }
        const amount = round2(Number(payment.amount) || 0);
        const invoiceIds = yield getCustomerOutstandingInvoiceIds(payment.customer_id, paymentId);
        const orderIds = yield getCustomerOutstandingOrderIds(payment.customer_id, paymentId);
        if (invoiceIds.length === 0 && orderIds.length === 0) {
            return {
                paymentId,
                customerId: payment.customer_id,
                appliedTotal: 0,
                remainingUnallocated: amount,
                invoiceAllocations: [],
                orderAllocations: [],
                skipped: 'sin facturas ni pedidos con saldo pendiente'
            };
        }
        const result = yield allocatePayment(paymentId, amount, invoiceIds, orderIds);
        const primaryInvoiceId = invoiceIds[0] || null;
        let primaryOrderId = null;
        if (primaryInvoiceId) {
            const ord = (yield (0, db_1.get)('SELECT order_id FROM invoices WHERE id = ?', [primaryInvoiceId]));
            primaryOrderId = (_a = ord === null || ord === void 0 ? void 0 : ord.order_id) !== null && _a !== void 0 ? _a : null;
        }
        else if (orderIds.length > 0) {
            primaryOrderId = orderIds[0];
        }
        yield (0, db_1.execute)('UPDATE payments SET invoice_id = ?, order_id = ? WHERE id = ?', [
            primaryInvoiceId,
            primaryOrderId,
            paymentId
        ]);
        yield syncAllOrderPaymentStatusForCustomer(payment.customer_id);
        return Object.assign({ paymentId, customerId: payment.customer_id }, result);
    });
}
/** Imputa todos los recibos sin asignar de todos los clientes. */
function autoAllocateAllUnallocatedPayments() {
    return __awaiter(this, arguments, void 0, function* (dryRun = false) {
        const payments = yield listUnallocatedPayments();
        const details = [];
        let allocated = 0;
        let skipped = 0;
        let partial = 0;
        let remainingTotal = 0;
        for (const p of payments) {
            if (dryRun) {
                if (isCommissionImportPayment(p.notes)) {
                    details.push({
                        paymentId: p.id,
                        customerId: p.customer_id,
                        receiptNumber: p.receipt_number,
                        amount: p.amount,
                        appliedTotal: 0,
                        remainingUnallocated: p.amount,
                        skipped: 'comisión vendedor'
                    });
                    skipped++;
                    continue;
                }
                const invoiceIds = yield getCustomerOutstandingInvoiceIds(p.customer_id, p.id);
                const orderIds = yield getCustomerOutstandingOrderIds(p.customer_id, p.id);
                if (invoiceIds.length === 0 && orderIds.length === 0) {
                    details.push({
                        paymentId: p.id,
                        customerId: p.customer_id,
                        receiptNumber: p.receipt_number,
                        amount: p.amount,
                        appliedTotal: 0,
                        remainingUnallocated: p.amount,
                        skipped: 'sin deuda imputable'
                    });
                    skipped++;
                    continue;
                }
                const preview = yield previewPaymentAllocation(p.amount, invoiceIds, orderIds, p.id);
                details.push({
                    paymentId: p.id,
                    customerId: p.customer_id,
                    receiptNumber: p.receipt_number,
                    amount: p.amount,
                    appliedTotal: preview.appliedTotal,
                    remainingUnallocated: preview.remainingUnallocated
                });
                if (preview.remainingUnallocated > 0.005)
                    partial++;
                else
                    allocated++;
                remainingTotal = round2(remainingTotal + preview.remainingUnallocated);
                continue;
            }
            const result = yield autoAllocatePaymentByFifo(p.id);
            details.push({
                paymentId: p.id,
                customerId: p.customer_id,
                receiptNumber: p.receipt_number,
                amount: p.amount,
                appliedTotal: result.appliedTotal,
                remainingUnallocated: result.remainingUnallocated,
                skipped: result.skipped
            });
            if (result.skipped) {
                skipped++;
                remainingTotal = round2(remainingTotal + result.remainingUnallocated);
            }
            else if (result.remainingUnallocated > 0.005) {
                partial++;
                remainingTotal = round2(remainingTotal + result.remainingUnallocated);
            }
            else {
                allocated++;
            }
        }
        return {
            dryRun,
            total: payments.length,
            allocated,
            skipped,
            partial,
            remainingTotal,
            details
        };
    });
}
