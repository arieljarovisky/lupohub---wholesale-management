import { execute, get, query } from '../database/db';

export const SQL_ORDER_NETO_GRAVADO = `GREATEST(
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
export const SQL_PAYMENT_EXCLUDE_COMMISSION_P = `(
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
export const SQL_ORDER_PAID_ON_ORDER = `COALESCE((
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
    WHERE ${SQL_PAYMENT_EXCLUDE_COMMISSION_P}
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

/** Cargo neto de NC (sin IVA en pedidos sin factura; con IVA 21% si hay factura AFIP). */
export const SQL_ORDER_CARGO_SALDO = `CASE
  WHEN EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id)
    THEN ROUND(GREATEST(0, (${SQL_ORDER_NETO_GRAVADO}) - COALESCE(cn.cn_total, 0)) * 1.21, 2)
  ELSE ROUND(GREATEST(0, (${SQL_ORDER_NETO_GRAVADO}) - COALESCE(cn.cn_total, 0)), 2)
END`;

/** Saldo pendiente del pedido menos cobros imputados (neto sin factura; con IVA si está facturado). */
export const SQL_ORDER_SALDO_RESIDUAL = `GREATEST(0,
  (${SQL_ORDER_CARGO_SALDO})
  - (${SQL_ORDER_PAID_ON_ORDER})
)`;

export const SQL_ORDER_IN_SALDO_SCOPE = `(
  COALESCE(o.include_in_saldo, 0) = 1
  OR (${SQL_ORDER_SALDO_RESIDUAL}) > 0.005
)`;

/** Repone vínculos payment_orders desde payments.order_id legacy (una sola vez por recibo). */
export async function backfillPaymentOrdersFromLegacy(): Promise<void> {
  try {
    await execute(`
      INSERT IGNORE INTO payment_orders (payment_id, order_id, amount_applied)
      SELECT p.id, p.order_id, ROUND(COALESCE(p.amount, 0), 2)
      FROM payments p
      WHERE p.order_id IS NOT NULL AND TRIM(p.order_id) <> ''
        AND (p.invoice_id IS NULL OR TRIM(p.invoice_id) = '')
        AND NOT EXISTS (SELECT 1 FROM payment_invoices pi WHERE pi.payment_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM payment_orders po WHERE po.payment_id = p.id)
    `);
  } catch {
    // Tabla payment_orders puede no existir aún en despliegues parciales.
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Saldo pendiente de una factura (con IVA) antes de imputar un pago nuevo. */
export async function getInvoiceOutstandingConIva(
  invoiceId: string,
  excludePaymentId?: string
): Promise<number> {
  const excl = excludePaymentId ? ' AND p.id <> ?' : '';
  const params: string[] = excludePaymentId ? [excludePaymentId, invoiceId] : [invoiceId];

  const row = (await get(
    `SELECT
       ROUND(GREATEST(0, (${SQL_ORDER_NETO_GRAVADO}) - COALESCE(cn.cn_total, 0)) * 1.21, 2) AS cargo_iva,
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
             AND ${SQL_PAYMENT_EXCLUDE_COMMISSION_P}
             ${excl}
         ) per_pay
       ), 0) AS paid
     FROM invoices i
     JOIN orders o ON o.id = i.order_id
     LEFT JOIN (
       SELECT order_id, SUM(amount_credited) AS cn_total
       FROM credit_notes
       GROUP BY order_id
     ) cn ON cn.order_id = o.id
     WHERE i.id = ?`,
    params
  )) as { cargo_iva: number; paid: number } | undefined;
  if (!row) return 0;
  return round2(Math.max(0, Number(row.cargo_iva || 0) - Number(row.paid || 0)));
}

export type PaymentInvoiceAllocation = {
  invoiceId: string;
  applied: number;
  outstandingBefore: number;
  outstandingAfter: number;
};

export type PaymentOrderAllocation = {
  orderId: string;
  applied: number;
  outstandingBefore: number;
  outstandingAfter: number;
};

export type PaymentAllocationResult = {
  appliedTotal: number;
  remainingUnallocated: number;
  invoiceAllocations: PaymentInvoiceAllocation[];
  orderAllocations: PaymentOrderAllocation[];
};

async function getPaymentAppliedToOrder(paymentId: string, orderId: string): Promise<number> {
  const row = (await get(
    `SELECT
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
     WHERE p.id = ?`,
    [paymentId, orderId, paymentId, orderId, orderId, orderId, paymentId]
  )) as { applied: number } | undefined;
  return round2(Number(row?.applied ?? 0));
}

/** Saldo pendiente de un pedido sin factura (con IVA, neto de NC). */
export async function getOrderOutstandingSinFactura(
  orderId: string,
  excludePaymentId?: string
): Promise<number> {
  const row = (await get(
    `SELECT (${SQL_ORDER_SALDO_RESIDUAL}) AS residual
     FROM orders o
     LEFT JOIN (
       SELECT order_id, SUM(amount_credited) AS cn_total
       FROM credit_notes
       GROUP BY order_id
     ) cn ON cn.order_id = o.id
     WHERE o.id = ?`,
    [orderId]
  )) as { residual: number } | undefined;
  let out = round2(Math.max(0, Number(row?.residual ?? 0)));
  if (excludePaymentId && out >= 0) {
    const applied = await getPaymentAppliedToOrder(excludePaymentId, orderId);
    out = round2(out + applied);
  }
  return out;
}

/** Reparte un recibo entre varias facturas (orden de la lista) y permite varios recibos por factura. */
export async function allocatePaymentToInvoices(
  paymentId: string,
  totalAmount: number,
  invoiceIds: string[]
): Promise<{
  appliedTotal: number;
  remainingUnallocated: number;
  allocations: PaymentInvoiceAllocation[];
}> {
  let remaining = round2(totalAmount);
  let appliedTotal = 0;
  const orderIds = new Set<string>();
  const allocations: PaymentInvoiceAllocation[] = [];

  for (const invoiceId of invoiceIds) {
    if (remaining <= 0.005) break;
    const outstandingBefore = await getInvoiceOutstandingConIva(invoiceId, paymentId);
    if (outstandingBefore <= 0.005) continue;
    const applied = round2(Math.min(remaining, outstandingBefore));
    await execute(
      `INSERT INTO payment_invoices (payment_id, invoice_id, amount_applied)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE amount_applied = VALUES(amount_applied)`,
      [paymentId, invoiceId, applied]
    );
    remaining = round2(remaining - applied);
    appliedTotal = round2(appliedTotal + applied);
    allocations.push({
      invoiceId,
      applied,
      outstandingBefore,
      outstandingAfter: round2(Math.max(0, outstandingBefore - applied))
    });

    const ord = (await get('SELECT order_id FROM invoices WHERE id = ?', [invoiceId])) as
      | { order_id: string }
      | undefined;
    if (ord?.order_id) orderIds.add(ord.order_id);
  }

  for (const orderId of orderIds) {
    await syncOrderPaymentStatus(orderId);
  }

  return { appliedTotal, remainingUnallocated: remaining, allocations };
}

/** Reparte un recibo entre pedidos sin factura (orden de la lista). */
export async function allocatePaymentToOrders(
  paymentId: string,
  totalAmount: number,
  orderIds: string[]
): Promise<{
  appliedTotal: number;
  remainingUnallocated: number;
  allocations: PaymentOrderAllocation[];
}> {
  let remaining = round2(totalAmount);
  let appliedTotal = 0;
  const allocations: PaymentOrderAllocation[] = [];

  for (const orderId of orderIds) {
    if (remaining <= 0.005) break;
    const outstandingBefore = await getOrderOutstandingSinFactura(orderId, paymentId);
    if (outstandingBefore <= 0.005) continue;
    const applied = round2(Math.min(remaining, outstandingBefore));
    await execute(
      `INSERT INTO payment_orders (payment_id, order_id, amount_applied)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE amount_applied = VALUES(amount_applied)`,
      [paymentId, orderId, applied]
    );
    remaining = round2(remaining - applied);
    appliedTotal = round2(appliedTotal + applied);
    allocations.push({
      orderId,
      applied,
      outstandingBefore,
      outstandingAfter: round2(Math.max(0, outstandingBefore - applied))
    });
    await execute(
      `UPDATE orders SET include_in_saldo = 1 WHERE id = ? AND COALESCE(include_in_saldo, 0) = 0`,
      [orderId]
    );
    await syncOrderPaymentStatus(orderId);
  }

  return { appliedTotal, remainingUnallocated: remaining, allocations };
}

/** Imputa recibo: primero facturas, luego pedidos sin factura. */
export async function allocatePayment(
  paymentId: string,
  totalAmount: number,
  invoiceIds: string[],
  orderIds: string[]
): Promise<PaymentAllocationResult> {
  const invResult = await allocatePaymentToInvoices(paymentId, totalAmount, invoiceIds);
  const orderResult = await allocatePaymentToOrders(
    paymentId,
    invResult.remainingUnallocated,
    orderIds
  );
  return {
    appliedTotal: round2(invResult.appliedTotal + orderResult.appliedTotal),
    remainingUnallocated: orderResult.remainingUnallocated,
    invoiceAllocations: invResult.allocations,
    orderAllocations: orderResult.allocations
  };
}

/** Vista previa de imputación (misma lógica que allocatePayment, sin grabar). */
export async function previewPaymentAllocation(
  totalAmount: number,
  invoiceIds: string[],
  orderIds: string[] = [],
  excludePaymentId?: string
): Promise<PaymentAllocationResult> {
  let remaining = round2(totalAmount);
  let appliedTotal = 0;
  const invoiceAllocations: PaymentInvoiceAllocation[] = [];
  const orderAllocations: PaymentOrderAllocation[] = [];

  for (const invoiceId of invoiceIds) {
    if (remaining <= 0.005) break;
    const outstandingBefore = await getInvoiceOutstandingConIva(invoiceId, excludePaymentId);
    if (outstandingBefore <= 0.005) continue;
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
    if (remaining <= 0.005) break;
    const outstandingBefore = await getOrderOutstandingSinFactura(orderId, excludePaymentId);
    if (outstandingBefore <= 0.005) continue;
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
}

/** Saldo pendiente por factura (varios recibos acumulados). */
export async function getInvoicesOutstanding(
  invoiceIds: string[],
  excludePaymentId?: string
): Promise<Array<{ invoiceId: string; outstanding: number }>> {
  const out: Array<{ invoiceId: string; outstanding: number }> = [];
  for (const invoiceId of invoiceIds) {
    out.push({
      invoiceId,
      outstanding: await getInvoiceOutstandingConIva(invoiceId, excludePaymentId)
    });
  }
  return out;
}

/** Saldo pendiente por pedido sin factura. */
export async function getOrdersOutstanding(
  orderIds: string[],
  excludePaymentId?: string
): Promise<Array<{ orderId: string; outstanding: number }>> {
  const out: Array<{ orderId: string; outstanding: number }> = [];
  for (const orderId of orderIds) {
    out.push({
      orderId,
      outstanding: await getOrderOutstandingSinFactura(orderId, excludePaymentId)
    });
  }
  return out;
}

/** Valida pedidos sin factura para imputación de recibo. */
export async function validateOrdersForPayment(
  orderIds: string[],
  customerId: string
): Promise<void> {
  if (orderIds.length === 0) return;
  const rows = (await query(
    `SELECT o.id, o.customer_id,
            EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id) AS has_invoice
     FROM orders o
     WHERE o.id IN (${orderIds.map(() => '?').join(',')})`,
    orderIds
  )) as Array<{ id: string; customer_id: string; has_invoice: number }>;
  if (rows.length !== orderIds.length) {
    const err: any = new Error('Hay pedidos inválidos en la selección');
    err.statusCode = 400;
    throw err;
  }
  const invalidCustomer = rows.find((r) => r.customer_id !== customerId);
  if (invalidCustomer) {
    const err: any = new Error('Todos los pedidos deben ser del mismo cliente que el recibo');
    err.statusCode = 400;
    throw err;
  }
  const invoiced = rows.find((r) => Number(r.has_invoice) === 1);
  if (invoiced) {
    const err: any = new Error(
      'Un pedido facturado se imputa por su factura, no directamente al pedido'
    );
    err.statusCode = 400;
    throw err;
  }
}

/** Reasocia un recibo ya cargado a facturas y/o pedidos sin factura. */
export async function relinkPaymentToInvoices(
  paymentId: string,
  invoiceIds: string[],
  orderIds: string[] = []
): Promise<PaymentAllocationResult> {
  const payment = (await get(
    `SELECT id, customer_id, amount, notes FROM payments WHERE id = ?`,
    [paymentId]
  )) as { id: string; customer_id: string; amount: number; notes?: string } | undefined;
  if (!payment) {
    const err: any = new Error('Recibo no encontrado');
    err.statusCode = 404;
    throw err;
  }
  const amount = round2(Number(payment.amount) || 0);
  const systemInvoiceIds = invoiceIds.filter((id) => id && !id.startsWith('mm-'));
  const systemOrderIds = orderIds.filter((id) => id && !id.startsWith('mm-'));

  await backfillPaymentOrdersFromLegacy();

  const oldOrderRows = (await query(
    `SELECT DISTINCT COALESCE(i.order_id, po.order_id, p.order_id) AS order_id
     FROM payments p
     LEFT JOIN payment_invoices pi ON pi.payment_id = p.id
     LEFT JOIN payment_orders po ON po.payment_id = p.id
     LEFT JOIN invoices i ON i.id = COALESCE(pi.invoice_id, p.invoice_id)
     WHERE p.id = ?
       AND COALESCE(i.order_id, po.order_id, p.order_id) IS NOT NULL`,
    [paymentId]
  )) as Array<{ order_id: string }>;

  await execute('DELETE FROM payment_invoices WHERE payment_id = ?', [paymentId]);
  await execute('DELETE FROM payment_orders WHERE payment_id = ?', [paymentId]);

  if (systemInvoiceIds.length === 0 && systemOrderIds.length === 0) {
    await execute('UPDATE payments SET invoice_id = NULL, order_id = NULL WHERE id = ?', [paymentId]);
    for (const r of oldOrderRows) {
      if (r.order_id) await syncOrderPaymentStatus(r.order_id);
    }
    await syncAllOrderPaymentStatusForCustomer(payment.customer_id);
    return {
      appliedTotal: 0,
      remainingUnallocated: amount,
      invoiceAllocations: [],
      orderAllocations: []
    };
  }

  if (systemInvoiceIds.length > 0) {
    const rows = (await query(
      `SELECT i.id, o.customer_id
       FROM invoices i
       JOIN orders o ON o.id = i.order_id
       WHERE i.id IN (${systemInvoiceIds.map(() => '?').join(',')})`,
      systemInvoiceIds
    )) as Array<{ id: string; customer_id: string }>;
    if (rows.length !== systemInvoiceIds.length) {
      const err: any = new Error('Hay facturas inválidas en la selección');
      err.statusCode = 400;
      throw err;
    }
    const invalid = rows.find((r) => r.customer_id !== payment.customer_id);
    if (invalid) {
      const err: any = new Error('Todas las facturas deben ser del mismo cliente que el recibo');
      err.statusCode = 400;
      throw err;
    }
  }

  await validateOrdersForPayment(systemOrderIds, payment.customer_id);

  const primaryInvoiceId = systemInvoiceIds[0] || null;
  let primaryOrderId: string | null = null;
  if (primaryInvoiceId) {
    const ord = (await get('SELECT order_id FROM invoices WHERE id = ?', [primaryInvoiceId])) as
      | { order_id: string }
      | undefined;
    primaryOrderId = ord?.order_id ?? null;
  } else if (systemOrderIds.length > 0) {
    primaryOrderId = systemOrderIds[0];
  }

  await execute('UPDATE payments SET invoice_id = ?, order_id = ? WHERE id = ?', [
    primaryInvoiceId,
    primaryOrderId,
    paymentId
  ]);

  const result = await allocatePayment(paymentId, amount, systemInvoiceIds, systemOrderIds);

  const orderIdsToSync = new Set<string>();
  for (const r of oldOrderRows) {
    if (r.order_id) orderIdsToSync.add(r.order_id);
  }
  for (const invId of systemInvoiceIds) {
    const o = (await get('SELECT order_id FROM invoices WHERE id = ?', [invId])) as
      | { order_id: string }
      | undefined;
    if (o?.order_id) orderIdsToSync.add(o.order_id);
  }
  for (const oid of systemOrderIds) {
    orderIdsToSync.add(oid);
  }
  for (const oid of orderIdsToSync) {
    await syncOrderPaymentStatus(oid);
  }

  return result;
}

/** Marca pedido pagado solo si el saldo residual (post-NC y cobros) es cero. */
export async function syncOrderPaymentStatus(orderId: string): Promise<void> {
  const row = (await get(
    `SELECT (${SQL_ORDER_SALDO_RESIDUAL}) AS residual
     FROM orders o
     LEFT JOIN (
       SELECT order_id, SUM(amount_credited) AS cn_total
       FROM credit_notes
       GROUP BY order_id
     ) cn ON cn.order_id = o.id
     WHERE o.id = ?`,
    [orderId]
  )) as { residual: number } | undefined;
  const residual = Number(row?.residual ?? 0);
  if (residual <= 0.01) {
    await execute(
      `UPDATE orders SET payment_status = 'pagado', include_in_saldo = 0 WHERE id = ?`,
      [orderId]
    );
  } else {
    await execute(`UPDATE orders SET payment_status = 'pendiente' WHERE id = ?`, [orderId]);
  }
}

/** Recalcula cobro de todos los pedidos del cliente con factura. */
export async function syncAllOrderPaymentStatusForCustomer(customerId: string): Promise<void> {
  const rows = (await query(
    `SELECT DISTINCT o.id
     FROM orders o
     WHERE o.customer_id = ?
       AND o.status NOT IN ('Cancelado', 'Borrador')
       AND (o.archived = 0 OR o.archived IS NULL)
       AND (
         EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id)
         OR COALESCE(o.include_in_saldo, 0) = 1
       )`,
    [customerId]
  )) as Array<{ id: string }>;
  for (const r of rows) {
    await syncOrderPaymentStatus(r.id);
  }
}
