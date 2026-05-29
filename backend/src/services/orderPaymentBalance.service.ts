import { execute, get, query } from '../database/db';

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

export const SQL_PAYMENT_EXCLUDE_COMMISSION_P = `(
  COALESCE(p.notes, '') NOT LIKE '%comisión vendedor%'
  AND COALESCE(p.notes, '') NOT LIKE '%comision vendedor%'
)`;

/** Pagos imputados a este pedido: suma amount_applied por factura; si no hay, el importe total del recibo (legacy). */
export const SQL_ORDER_PAID_ON_ORDER = `COALESCE((
  SELECT SUM(ROUND(per_payment.applied, 2))
  FROM (
    SELECT
      p.id,
      COALESCE(
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
          WHEN p.order_id = o.id THEN ROUND(COALESCE(p.amount, 0), 2)
          ELSE 0
        END
      ) AS applied
    FROM payments p
    WHERE ${SQL_PAYMENT_EXCLUDE_COMMISSION_P}
      AND (
        EXISTS (
          SELECT 1 FROM payment_invoices pi
          INNER JOIN invoices i ON i.id = pi.invoice_id
          WHERE pi.payment_id = p.id AND i.order_id = o.id
        )
        OR EXISTS (SELECT 1 FROM invoices i WHERE i.id = p.invoice_id AND i.order_id = o.id)
        OR p.order_id = o.id
      )
  ) per_payment
), 0)`;

/** Cargo con IVA neto de NC menos cobros imputados al pedido. */
export const SQL_ORDER_SALDO_RESIDUAL = `GREATEST(0,
  ROUND(GREATEST(0, (${SQL_ORDER_NETO_GRAVADO}) - COALESCE(cn.cn_total, 0)) * 1.21, 2)
  - (${SQL_ORDER_PAID_ON_ORDER})
)`;

export const SQL_ORDER_IN_SALDO_SCOPE = `(
  COALESCE(o.include_in_saldo, 0) = 1
  OR (${SQL_ORDER_SALDO_RESIDUAL}) > 0.005
)`;

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

/** Vista previa de imputación (misma lógica que allocatePaymentToInvoices, sin grabar). */
export async function previewPaymentAllocation(
  totalAmount: number,
  invoiceIds: string[],
  excludePaymentId?: string
): Promise<{
  appliedTotal: number;
  remainingUnallocated: number;
  allocations: PaymentInvoiceAllocation[];
}> {
  let remaining = round2(totalAmount);
  let appliedTotal = 0;
  const allocations: PaymentInvoiceAllocation[] = [];

  for (const invoiceId of invoiceIds) {
    if (remaining <= 0.005) break;
    const outstandingBefore = await getInvoiceOutstandingConIva(invoiceId, excludePaymentId);
    if (outstandingBefore <= 0.005) continue;
    const applied = round2(Math.min(remaining, outstandingBefore));
    remaining = round2(remaining - applied);
    appliedTotal = round2(appliedTotal + applied);
    allocations.push({
      invoiceId,
      applied,
      outstandingBefore,
      outstandingAfter: round2(Math.max(0, outstandingBefore - applied))
    });
  }

  return { appliedTotal, remainingUnallocated: remaining, allocations };
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

/** Reasocia un recibo ya cargado a facturas (reemplaza vínculos anteriores). */
export async function relinkPaymentToInvoices(
  paymentId: string,
  invoiceIds: string[]
): Promise<{
  appliedTotal: number;
  remainingUnallocated: number;
  allocations: PaymentInvoiceAllocation[];
}> {
  const payment = (await get(
    `SELECT id, customer_id, amount, notes FROM payments WHERE id = ?`,
    [paymentId]
  )) as { id: string; customer_id: string; amount: number; notes?: string } | undefined;
  if (!payment) {
    const err: any = new Error('Recibo no encontrado');
    err.statusCode = 404;
    throw err;
  }
  const notes = String(payment.notes || '');
  if (notes.includes('comisión vendedor') || notes.includes('comision vendedor')) {
    const err: any = new Error('Este recibo es una comisión de vendedor y no se puede asociar a facturas');
    err.statusCode = 400;
    throw err;
  }

  const amount = round2(Number(payment.amount) || 0);
  const systemInvoiceIds = invoiceIds.filter((id) => id && !id.startsWith('mm-'));

  const oldOrderRows = (await query(
    `SELECT DISTINCT COALESCE(i.order_id, p.order_id) AS order_id
     FROM payments p
     LEFT JOIN payment_invoices pi ON pi.payment_id = p.id
     LEFT JOIN invoices i ON i.id = COALESCE(pi.invoice_id, p.invoice_id)
     WHERE p.id = ?
       AND COALESCE(i.order_id, p.order_id) IS NOT NULL`,
    [paymentId]
  )) as Array<{ order_id: string }>;

  await execute('DELETE FROM payment_invoices WHERE payment_id = ?', [paymentId]);

  if (systemInvoiceIds.length === 0) {
    await execute('UPDATE payments SET invoice_id = NULL, order_id = NULL WHERE id = ?', [paymentId]);
    for (const r of oldOrderRows) {
      if (r.order_id) await syncOrderPaymentStatus(r.order_id);
    }
    await syncAllOrderPaymentStatusForCustomer(payment.customer_id);
    return { appliedTotal: 0, remainingUnallocated: amount, allocations: [] };
  }

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

  const primaryInvoiceId = systemInvoiceIds[0];
  const ord = (await get('SELECT order_id FROM invoices WHERE id = ?', [primaryInvoiceId])) as
    | { order_id: string }
    | undefined;
  await execute('UPDATE payments SET invoice_id = ?, order_id = ? WHERE id = ?', [
    primaryInvoiceId,
    ord?.order_id ?? null,
    paymentId
  ]);

  const result = await allocatePaymentToInvoices(paymentId, amount, systemInvoiceIds);

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
