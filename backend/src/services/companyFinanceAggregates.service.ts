import axios from 'axios';
import { get, query } from '../database/db';
import { getValidMLToken } from '../controllers/integrations.controller';
import {
  calcMlPaymentCpt,
  calcTnSaleFeeFromPreset,
  fetchListingSaleFeeAmount,
  getMlPaymentCptPercent,
  resolveTnFeePreset,
} from '../utils/channelMarginUtils';

const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function orderDateInRange(isoDate: string | undefined, from: string, to: string): boolean {
  if (!isoDate) return false;
  const ymd = isoDate.slice(0, 10);
  return ymd >= from && ymd <= to;
}

function isTnOrderPaid(order: Record<string, unknown>): boolean {
  const rawPaymentStatus = String(order.payment_status ?? '').trim().toLowerCase();
  const paymentDetails = Array.isArray(order.payment_details) ? order.payment_details : [];
  const detailStates = paymentDetails
    .map((d: Record<string, unknown>) => String(d?.status ?? d?.state ?? '').trim().toLowerCase())
    .filter(Boolean);
  const looksRefunded =
    rawPaymentStatus === 'refunded' || detailStates.some((s) => s.includes('refund'));
  const looksVoided =
    rawPaymentStatus === 'voided' ||
    rawPaymentStatus === 'cancelled' ||
    detailStates.some((s) => s.includes('void') || s.includes('cancel'));
  if (looksRefunded || looksVoided) return false;
  return (
    rawPaymentStatus === 'paid' ||
    !!order.paid_at ||
    detailStates.some((s) => s === 'paid' || s === 'approved' || s === 'accredited' || s === 'captured')
  );
}

/**
 * Suma facturas AFIP emitidas en el rango (por `invoices.created_at`).
 * - `net`: suma de `orders.total - notas_credito` (neto sin IVA).
 * - `iva`: 21% sobre el neto.
 * - `total`: net + iva (importe del comprobante con IVA).
 * Misma fórmula que `listPendingInvoices` para consistencia.
 */
export async function sumInvoicedInRange(
  from: string,
  to: string
): Promise<{ total: number; net: number; iva: number; count: number }> {
  const row = (await get(
    `SELECT
       COALESCE(SUM(GREATEST(0, o.total - COALESCE(cn.cn_total, 0))), 0) AS net,
       COUNT(*) AS cnt
     FROM invoices i
     INNER JOIN orders o ON o.id = i.order_id
     LEFT JOIN (
       SELECT order_id, SUM(amount_credited) AS cn_total
       FROM credit_notes
       GROUP BY order_id
     ) cn ON cn.order_id = o.id
     WHERE DATE(i.created_at) >= ? AND DATE(i.created_at) <= ?`,
    [from, to]
  )) as { net: string | number; cnt: number } | undefined;
  const net = round2(Number(row?.net ?? 0));
  const total = round2(net * 1.21);
  const iva = round2(total - net);
  return { total, net, iva, count: Number(row?.cnt ?? 0) };
}

export async function sumReceiptsInRange(from: string, to: string): Promise<{ total: number; count: number }> {
  const row = (await get(
    `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
     FROM payments WHERE date >= ? AND date <= ?`,
    [from, to]
  )) as { total: string | number; cnt: number } | undefined;
  return { total: round2(Number(row?.total ?? 0)), count: Number(row?.cnt ?? 0) };
}

export async function sumDespachosCostInRange(from: string, to: string): Promise<{ total: number; count: number }> {
  const rows = (await query(
    `SELECT d.id, d.valor_cif, d.valor_fob
     FROM despachos d
     WHERE d.fecha_despacho >= ? AND d.fecha_despacho <= ?`,
    [from, to]
  )) as Array<{ id: string; valor_cif: string | number | null; valor_fob: string | number | null }>;

  let total = 0;
  for (const d of rows) {
    const cif = Number(d.valor_cif);
    const fob = Number(d.valor_fob);
    if (Number.isFinite(cif) && cif > 0) {
      total += cif;
      continue;
    }
    if (Number.isFinite(fob) && fob > 0) {
      total += fob;
      continue;
    }
    const itemsRow = (await get(
      `SELECT COALESCE(SUM(cantidad * COALESCE(costo_unitario, 0)), 0) AS sub
       FROM despacho_items WHERE despacho_id = ?`,
      [d.id]
    )) as { sub: string | number } | undefined;
    total += Number(itemsRow?.sub ?? 0);
  }
  return { total: round2(total), count: rows.length };
}

async function fetchTnOrdersInRange(from: string, to: string): Promise<Record<string, unknown>[]> {
  const integration = await get(
    `SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`
  );
  if (!integration?.access_token) return [];
  const storeId = integration.store_id || integration.user_id;
  if (!storeId) return [];

  const minIso = `${from}T00:00:00-03:00`;
  const maxIso = `${to}T23:59:59-03:00`;
  const perPage = 200;
  let page = 1;
  const rawOrders: Record<string, unknown>[] = [];

  while (page <= 400) {
    const response = await axios.get(`https://api.tiendanube.com/v1/${storeId}/orders`, {
      headers: {
        Authentication: `bearer ${integration.access_token}`,
        'User-Agent': TN_USER_AGENT,
      },
      params: { page, per_page: perPage, created_at_min: minIso, created_at_max: maxIso },
      validateStatus: () => true,
    });
    if (response.status !== 200) break;
    const batch = Array.isArray(response.data) ? response.data : [];
    if (batch.length === 0) break;
    rawOrders.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }
  return rawOrders;
}

export async function aggregateTiendaNubeInRange(
  from: string,
  to: string
): Promise<{ sales: number; fees: number; orderCount: number; connected: boolean; note?: string }> {
  const orders = await fetchTnOrdersInRange(from, to);
  if (orders.length === 0) {
    const integration = await get(`SELECT id FROM integrations WHERE platform = 'tiendanube' LIMIT 1`);
    return { sales: 0, fees: 0, orderCount: 0, connected: !!integration };
  }

  const preset = resolveTnFeePreset();
  let sales = 0;
  let fees = 0;
  let orderCount = 0;

  for (const order of orders) {
    if (!isTnOrderPaid(order)) continue;
    const created = String(order.created_at ?? order.paid_at ?? '');
    if (!orderDateInRange(created, from, to)) continue;
    const total = Math.max(0, Number(order.total) || 0);
    if (total <= 0) continue;
    sales += total;
    fees += calcTnSaleFeeFromPreset(total, preset).total;
    orderCount += 1;
  }

  return {
    sales: round2(sales),
    fees: round2(fees),
    orderCount,
    connected: true,
    note: `Comisiones TN estimadas (${preset.label})`,
  };
}

async function multigetMlItems(
  accessToken: string,
  itemIds: string[]
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  const unique = [...new Set(itemIds.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 20) {
    const chunk = unique.slice(i, i + 20);
    try {
      const res = await axios.get('https://api.mercadolibre.com/items', {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { ids: chunk.join(',') },
        validateStatus: () => true,
      });
      if (res.status !== 200 || !Array.isArray(res.data)) continue;
      for (const entry of res.data) {
        const body = (entry as { body?: Record<string, unknown> })?.body;
        const id = String(body?.id ?? '');
        if (id && body) map.set(id, body);
      }
    } catch {
      /* omitir lote */
    }
  }
  return map;
}

export async function aggregateMercadoLibreInRange(
  from: string,
  to: string
): Promise<{ sales: number; fees: number; orderCount: number; connected: boolean; note?: string }> {
  const mlToken = await getValidMLToken();
  if (!mlToken?.access_token || !mlToken?.user_id) {
    return { sales: 0, fees: 0, orderCount: 0, connected: false };
  }

  const cptPercent = getMlPaymentCptPercent();
  const feeCache = new Map<string, number>();
  const itemIds: string[] = [];
  type Line = { itemId: string; unitPrice: number; qty: number };
  const lines: Line[] = [];

  let offset = 0;
  const limit = 50;
  let orderCount = 0;

  while (offset < 5000) {
    const searchRes = await axios.get('https://api.mercadolibre.com/orders/search', {
      headers: { Authorization: `Bearer ${mlToken.access_token}` },
      params: {
        seller: mlToken.user_id,
        'order.status': 'paid',
        'order.date_created.from': `${from}T00:00:00.000-03:00`,
        'order.date_created.to': `${to}T23:59:59.999-03:00`,
        offset,
        limit,
        sort: 'date_desc',
      },
      validateStatus: () => true,
    });
    if (searchRes.status !== 200) break;
    const results = Array.isArray(searchRes.data?.results) ? searchRes.data.results : [];
    if (results.length === 0) break;

    for (const order of results) {
      const created = String(order?.date_created ?? order?.date_closed ?? '');
      if (!orderDateInRange(created, from, to)) continue;
      orderCount += 1;
      const items = Array.isArray(order?.order_items) ? order.order_items : [];
      for (const oi of items) {
        const itemId = String(oi?.item?.id ?? '');
        const qty = Math.max(0, Number(oi?.quantity) || 0);
        const unitPrice = Math.max(0, Number(oi?.unit_price) || 0);
        if (!itemId || qty <= 0 || unitPrice <= 0) continue;
        itemIds.push(itemId);
        lines.push({ itemId, unitPrice, qty });
      }
    }

    if (results.length < limit) break;
    offset += limit;
  }

  const itemsMap = await multigetMlItems(mlToken.access_token, itemIds);
  let sales = 0;
  let fees = 0;

  for (const line of lines) {
    const subtotal = line.unitPrice * line.qty;
    sales += subtotal;
    const item = itemsMap.get(line.itemId);
    if (item) {
      const listingFee = await fetchListingSaleFeeAmount(
        mlToken.access_token,
        item,
        line.unitPrice,
        feeCache
      );
      fees += listingFee * line.qty;
    }
    fees += calcMlPaymentCpt(subtotal, cptPercent);
  }

  return {
    sales: round2(sales),
    fees: round2(fees),
    orderCount,
    connected: true,
    note: `Comisiones ML estimadas (listing_prices + CPT ${cptPercent}%)`,
  };
}

export type PendingInvoiceRow = {
  orderId: string;
  orderDate: string;
  customerName: string;
  invoiceLabel: string;
  amountWithIva: number;
  orderStatus: string;
};

export async function listPendingInvoices(limit = 200): Promise<{
  items: PendingInvoiceRow[];
  totalPending: number;
}> {
  const rows = (await query(
    `SELECT
       o.id AS orderId,
       DATE_FORMAT(o.date, '%Y-%m-%d') AS orderDate,
       COALESCE(c.business_name, c.name, '') AS customerName,
       i.punto_venta AS puntoVenta,
       i.cbte_tipo AS cbteTipo,
       i.cbte_desde AS cbteDesde,
       o.status AS orderStatus,
       ROUND(GREATEST(0, o.total - COALESCE(cn.cn_total, 0)) * 1.21, 2) AS amountWithIva
     FROM orders o
     INNER JOIN customers c ON c.id = o.customer_id
     INNER JOIN invoices i ON i.order_id = o.id
     LEFT JOIN (
       SELECT order_id, SUM(amount_credited) AS cn_total
       FROM credit_notes
       GROUP BY order_id
     ) cn ON cn.order_id = o.id
     WHERE o.payment_status = 'pendiente'
       AND o.status NOT IN ('Cancelado', 'Borrador')
       AND (o.archived = 0 OR o.archived IS NULL)
     ORDER BY o.date ASC
     LIMIT ?`,
    [Math.min(500, Math.max(1, limit))]
  )) as Array<{
    orderId: string;
    orderDate: string;
    customerName: string;
    puntoVenta: number;
    cbteTipo: number;
    cbteDesde: number;
    orderStatus: string;
    amountWithIva: string | number;
  }>;

  const items: PendingInvoiceRow[] = rows.map((r) => ({
    orderId: r.orderId,
    orderDate: r.orderDate,
    customerName: r.customerName,
    invoiceLabel: `${r.puntoVenta}-${String(r.cbteTipo).padStart(2, '0')}-${r.cbteDesde}`,
    amountWithIva: round2(Number(r.amountWithIva)),
    orderStatus: r.orderStatus,
  }));

  const totalPending = round2(items.reduce((acc, r) => acc + r.amountWithIva, 0));
  return { items, totalPending };
}
