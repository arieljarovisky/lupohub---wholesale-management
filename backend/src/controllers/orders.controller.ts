import { Request, Response } from 'express';
import { query, execute, get, pool } from '../database/db';
import { Order, OrderStatus } from '../types';
import ExcelJS from 'exceljs';
import {
  restoreStockForOrder,
  restoreStockForOrderItem,
  deductStockForOrder,
  isMayoristaStockDeductedForWholesale,
  isWholesaleStockRestoredForOrder,
  wholesaleOrderStockManualRestoreReference,
  resolveVariantIdForGridCell,
} from './stock.controller';
import { v4 as uuidv4 } from 'uuid';
import { normalizeMatrixImportArticleSku } from '../utils/matrixImportSku';
import {
  SQL_ORDER_IN_SALDO_SCOPE,
  SQL_ORDER_SALDO_RESIDUAL,
  syncAllOrderPaymentStatusForCustomer,
  syncOrderPaymentStatus,
} from '../services/orderPaymentBalance.service';

/** Evita dos POST simultáneos al mismo pedido; el segundo espera el mismo resultado AFIP. */
const emitFacturaInFlight = new Map<string, Promise<Record<string, unknown>>>();

async function getProductIdForVariant(variantId: string): Promise<string | null> {
  const row = await get(
    `SELECT pc.product_id AS product_id
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     WHERE pv.id = ?
     LIMIT 1`,
    [variantId]
  );
  return (row?.product_id as string) || null;
}

function normalizeOrderNotes(raw: unknown): string | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  return t.slice(0, 200);
}

/** ¿La factura vigente del pedido sigue siendo la misma que anuló esta NC total? (snapshot voided_* = invoice actual). */
function totalCreditNoteStillVoidsCurrentInvoice(invoice: any | undefined, cn: any): boolean {
  if (!cn?.voided_invoice_cae) return true;
  if (!invoice) return true;
  const pvInv = Number(invoice.puntoVta ?? 0);
  const pvV = Number(cn.voided_invoice_punto_venta ?? 0);
  return (
    String(cn.voided_invoice_cae) === String(invoice.cae) &&
    Number(cn.voided_invoice_cbte_desde) === Number(invoice.cbteDesde) &&
    pvInv === pvV &&
    Number(cn.voided_invoice_cbte_tipo) === Number(invoice.cbteTipo)
  );
}

/** NC totales que siguen “anulando” el comprobante actual (sin reemplazo o datos legacy sin snapshot). */
function countActiveTotalCreditNoteVoid(invoice: any | undefined, totalCnList: any[]): number {
  let n = 0;
  for (const cn of totalCnList) {
    if (Number(cn.superseded_by_reinvoice)) continue;
    if (!cn.voided_invoice_cae) {
      n++;
      continue;
    }
    if (totalCreditNoteStillVoidsCurrentInvoice(invoice, cn)) n++;
  }
  return n;
}

function buildLastTotalCreditNoteFiscalPayload(lastCn: any | undefined) {
  if (!lastCn) return undefined;
  return {
    voidedInvoice: lastCn.voided_invoice_cae
      ? {
          cae: String(lastCn.voided_invoice_cae),
          puntoVta:
            lastCn.voided_invoice_punto_venta != null ? Number(lastCn.voided_invoice_punto_venta) : undefined,
          cbteTipo:
            lastCn.voided_invoice_cbte_tipo != null ? Number(lastCn.voided_invoice_cbte_tipo) : undefined,
          cbteDesde: Number(lastCn.voided_invoice_cbte_desde),
        }
      : undefined,
    creditNote: {
      cae: String(lastCn.cae),
      puntoVta: Number(lastCn.punto_venta),
      cbteTipo: Number(lastCn.cbte_tipo),
      cbteDesde: Number(lastCn.cbte_desde),
    },
    supersededByReinvoice: !!Number(lastCn.superseded_by_reinvoice),
  };
}

/**
 * Percepción IIBB para la NC en AFIP según `invoices.agip_*` (misma lógica que la factura).
 * En NC parcial se prorratea el importe de percepción según neto creditado / neto total del pedido.
 */
function iibbPercepcionForOrderCreditNote(
  invAgipAlicuota: number,
  invAgipRetPer: number,
  netAmountCredited: number,
  invoiceFullNet: number
): { baseImp: number; alicuota: number; importe: number } | undefined {
  const retFull = Math.round((Number(invAgipRetPer) || 0) * 100) / 100;
  if (!(retFull > 0.005)) return undefined;
  const full = Math.max(Math.round((Number(invoiceFullNet) || 0) * 100) / 100, 0.01);
  const netCred = Math.round((Number(netAmountCredited) || 0) * 100) / 100;
  const ratio = Math.min(1, Math.max(0, netCred / full));
  const importe = Math.round(retFull * ratio * 100) / 100;
  if (!(importe > 0.005)) return undefined;
  return {
    baseImp: netCred,
    alicuota: Math.round((Number(invAgipAlicuota) || 0) * 100) / 100,
    importe,
  };
}

async function allocateOldestDespachosForVariant(variantId: string, requestedQty: number): Promise<Array<{ despachoId: string | null; quantity: number }>> {
  const qty = Math.max(0, Math.floor(Number(requestedQty) || 0));
  if (qty <= 0) return [];
  const productId = await getProductIdForVariant(variantId);
  if (!productId) return [{ despachoId: null, quantity: qty }];

  const variantRows = await query(
    `SELECT
       di.despacho_id AS despachoId,
       COALESCE(di.cantidad, 0) AS totalIngresado,
       COALESCE(used.totalAsignado, 0) AS totalAsignado
     FROM despacho_items di
     JOIN despachos d ON d.id = di.despacho_id
     LEFT JOIN (
       SELECT oi.despacho_id, oi.variant_id, SUM(oi.quantity) AS totalAsignado
       FROM order_items oi
       WHERE oi.despacho_id IS NOT NULL
       GROUP BY oi.despacho_id, oi.variant_id
     ) used ON used.despacho_id = di.despacho_id AND used.variant_id = di.variant_id
     WHERE di.variant_id = ?
     ORDER BY d.fecha_despacho ASC, d.created_at ASC, di.created_at ASC`,
    [variantId]
  ) as Array<{ despachoId: string; totalIngresado: number; totalAsignado: number }>;

  const rows = variantRows.length > 0 ? variantRows : await query(
    `SELECT
       di.despacho_id AS despachoId,
       COALESCE(di.cantidad, 0) AS totalIngresado,
       COALESCE(used.totalAsignado, 0) AS totalAsignado
     FROM despacho_items di
     JOIN despachos d ON d.id = di.despacho_id
     LEFT JOIN (
       SELECT oi.despacho_id, pc.product_id, SUM(oi.quantity) AS totalAsignado
       FROM order_items oi
       JOIN product_variants pv ON pv.id = oi.variant_id
       JOIN product_colors pc ON pc.id = pv.product_color_id
       WHERE oi.despacho_id IS NOT NULL
       GROUP BY oi.despacho_id, pc.product_id
     ) used ON used.despacho_id = di.despacho_id AND used.product_id = di.product_id
     WHERE di.product_id = ? AND di.variant_id IS NULL
     ORDER BY d.fecha_despacho ASC, d.created_at ASC, di.created_at ASC`,
    [productId]
  ) as Array<{ despachoId: string; totalIngresado: number; totalAsignado: number }>;

  const out: Array<{ despachoId: string | null; quantity: number }> = [];
  let remaining = qty;
  for (const r of rows) {
    if (remaining <= 0) break;
    const available = Math.max(0, Number(r.totalIngresado || 0) - Number(r.totalAsignado || 0));
    if (available <= 0) continue;
    const take = Math.min(remaining, available);
    out.push({ despachoId: r.despachoId, quantity: take });
    remaining -= take;
  }
  if (remaining > 0) {
    out.push({ despachoId: null, quantity: remaining });
  }
  return out;
}

async function resolveDespachoIdForItem(item: any, variantId?: string): Promise<string | null> {
  const raw = item?.despachoId ?? item?.despacho_id;
  if (raw != null && raw !== '') {
    const id = String(raw).trim();
    if (id) {
      const row = await get('SELECT id FROM despachos WHERE id = ?', [id]);
      if (row?.id) return row.id;
    }
  }

  // Fallback automático: si no viene despacho explícito, usar el último despacho del producto de la variante.
  if (!variantId) return null;
  const fallback = await get(
    `SELECT p.ultimo_despacho_id AS despacho_id
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN products p ON p.id = pc.product_id
     WHERE pv.id = ?
     LIMIT 1`,
    [variantId]
  );
  const fallbackId = fallback?.despacho_id;
  if (!fallbackId) return null;
  const exists = await get('SELECT id FROM despachos WHERE id = ?', [fallbackId]);
  return exists?.id ?? null;
}

function mapPaymentStatus(row: any): 'pendiente' | 'pagado' {
  return row?.payment_status === 'pendiente' ? 'pendiente' : 'pagado';
}

function mapIncludeInSaldo(row: any): boolean {
  return !!(row?.include_in_saldo);
}

/**
 * Devuelve una descripción legible de un artículo (nombre + talle + color + SKU) para mostrar
 * en avisos al usuario. Si el item ya trae `sku`/`productName` desde el frontend se usan,
 * y si faltan campos los completa consultando la variante por `variantId`.
 */
async function getItemLabelForWarning(item: any, variantId: string): Promise<string> {
  const fromItemName = String(item?.productName || '').trim();
  const fromItemSku = String(item?.sku || '').trim();
  const fromItemSize = String(item?.sizeCode || '').trim();
  const fromItemColor = String(item?.colorName || item?.colorCode || '').trim();

  let name = fromItemName;
  let sku = fromItemSku;
  let size = fromItemSize;
  let color = fromItemColor;

  if (!name || !sku || !size || !color) {
    const row = await get(
      `SELECT p.name AS productName,
              COALESCE(pv.sku, p.sku) AS sku,
              s.size_code AS sizeCode,
              c.name AS colorName,
              c.code AS colorCode
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       LEFT JOIN sizes s ON s.id = pv.size_id
       LEFT JOIN colors c ON c.id = pc.color_id
       WHERE pv.id = ?
       LIMIT 1`,
      [variantId]
    );
    if (row) {
      if (!name) name = String(row.productName || '').trim();
      if (!sku) sku = String(row.sku || '').trim();
      if (!size) size = String(row.sizeCode || '').trim();
      if (!color) color = String(row.colorName || '').trim();
    }
  }

  const base = name || sku;
  if (!base) return variantId;
  const extras = [size, color].filter(Boolean).join(' / ');
  const skuSuffix = sku && sku !== base ? ` [${sku}]` : '';
  return extras ? `${base} (${extras})${skuSuffix}` : `${base}${skuSuffix}`;
}

/** Estados en los que el pedido ya pasó por picking: neto AFIP y stock usan cantidad pickeada por línea. */
const PICKING_DONE_STATUSES_AFIP = new Set(['Falta controlar', 'Controlado', 'Despachado']);

/** Neto gravado según líneas; tras picking (control/despacho) alinea con lo pickeado para factura AFIP. */
async function getOrderNetFromLineItems(orderId: string): Promise<number> {
  const meta = await get(
    `SELECT COALESCE(o.no_stock_impact, 0) AS no_stock_impact, o.status
     FROM orders o WHERE o.id = ? LIMIT 1`,
    [orderId]
  ) as { no_stock_impact?: number; status?: string } | undefined;
  const usePicked =
    !Number(meta?.no_stock_impact) && PICKING_DONE_STATUSES_AFIP.has(String(meta?.status || ''));
  const rows = await query(
    `SELECT quantity, picked, price_at_moment FROM order_items WHERE order_id = ? ORDER BY id`,
    [orderId]
  ) as { quantity: number; picked: number | null; price_at_moment: string | number }[];
  let sum = 0;
  for (const r of rows) {
    const q = Number(r.quantity) || 0;
    const p = Number(r.picked) || 0;
    const lineQty = usePicked ? Math.min(q, Math.max(0, p)) : q;
    const price = Number(r.price_at_moment) || 0;
    sum += Math.round(lineQty * price * 100) / 100;
  }
  return Math.round(sum * 100) / 100;
}

/** Neto para NC total: pickeado, o —si quedó en 0— lo facturado (IIBB / cantidades / total del pedido). */
async function getOrderNetForCreditNoteTotal(orderId: string): Promise<number> {
  const fromPicked = await getOrderNetFromLineItems(orderId);
  if (fromPicked > 0.005) return fromPicked;

  const invRow = await get(
    'SELECT agip_ret_per, agip_alicuota FROM invoices WHERE order_id = ? LIMIT 1',
    [orderId]
  ) as { agip_ret_per?: string | number; agip_alicuota?: string | number } | undefined;
  const retPer = Number(invRow?.agip_ret_per || 0);
  const alicuota = Number(invRow?.agip_alicuota || 0);
  if (retPer > 0.005 && alicuota > 0.005) {
    return Math.round((retPer / (alicuota / 100)) * 100) / 100;
  }

  const rows = await query(
    `SELECT quantity, price_at_moment FROM order_items WHERE order_id = ? ORDER BY id`,
    [orderId]
  ) as { quantity: number; price_at_moment: string | number }[];
  let sumQty = 0;
  for (const r of rows) {
    const q = Number(r.quantity) || 0;
    const price = Number(r.price_at_moment) || 0;
    sumQty += Math.round(q * price * 100) / 100;
  }
  sumQty = Math.round(sumQty * 100) / 100;
  if (sumQty > 0.005) return sumQty;

  const orderRow = await get('SELECT total FROM orders WHERE id = ?', [orderId]) as { total?: string | number } | undefined;
  return Math.round((Number(orderRow?.total) || 0) * 100) / 100;
}

/**
 * Período del padrón AGIP (YYYYMM) a partir de la fecha del pedido.
 * MySQL devuelve `DATE` como `Date` en node: `String(date)` no es ISO y rompía el cálculo IIBB al emitir.
 */
function agipPeriodYyyymmFromOrderDate(orderDate: unknown): string | null {
  if (orderDate == null || orderDate === '') return null;
  if (orderDate instanceof Date && !isNaN(orderDate.getTime())) {
    const y = orderDate.getFullYear();
    const m = orderDate.getMonth() + 1;
    return `${y}${String(m).padStart(2, '0')}`;
  }
  const s = String(orderDate).trim();
  const mIso = s.match(/^(\d{4})-(\d{2})/);
  if (mIso) return `${mIso[1]}${mIso[2]}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  return null;
}

async function getAgipRetentionForOrder(args: {
  orderDate: string | Date | null | undefined;
  customerCuit?: string | null;
  netAmount: number;
}): Promise<{ alicuota: number; amount: number; periodUsed?: string } | null> {
  const cuit = String(args.customerCuit || '').replace(/\D/g, '').slice(0, 11);
  if (cuit.length !== 11) return null;
  const orderPeriod = agipPeriodYyyymmFromOrderDate(args.orderDate);
  if (!orderPeriod || !/^\d{6}$/.test(orderPeriod)) return null;

  const lookupPadron = async (periodYyyymm: string) => {
    const row = await get(
      `SELECT alicuota FROM agip_padron_alicuotas WHERE period_yyyymm = ? AND cuit = ? LIMIT 1`,
      [periodYyyymm, cuit]
    );
    const alicuota = Number((row as any)?.alicuota || 0);
    return alicuota > 0 ? { alicuota, periodUsed: periodYyyymm } : null;
  };

  let hit = await lookupPadron(orderPeriod);
  if (!hit) {
    const prior = (await get(
      `SELECT period_yyyymm AS periodUsed, alicuota
       FROM agip_padron_alicuotas
       WHERE cuit = ? AND period_yyyymm <= ? AND alicuota > 0
       ORDER BY period_yyyymm DESC
       LIMIT 1`,
      [cuit, orderPeriod]
    )) as { periodUsed?: string; alicuota?: number } | undefined;
    if (prior && Number(prior.alicuota) > 0) {
      hit = { alicuota: Number(prior.alicuota), periodUsed: String(prior.periodUsed) };
    }
  }
  if (!hit) {
    const latest = (await get(
      `SELECT period_yyyymm AS periodUsed, alicuota
       FROM agip_padron_alicuotas
       WHERE cuit = ? AND alicuota > 0
       ORDER BY period_yyyymm DESC
       LIMIT 1`,
      [cuit]
    )) as { periodUsed?: string; alicuota?: number } | undefined;
    if (latest && Number(latest.alicuota) > 0) {
      hit = { alicuota: Number(latest.alicuota), periodUsed: String(latest.periodUsed) };
    }
  }
  if (!hit) return null;

  const net = Math.max(0, Number(args.netAmount) || 0);
  const amount = Math.round(net * (hit.alicuota / 100) * 100) / 100;
  return { alicuota: hit.alicuota, amount, periodUsed: hit.periodUsed };
}

/** Pedidos sin factura que pueden imputarse a un recibo (misma lógica que saldo pendiente). */
export const getLinkableOrdersForPayment = async (req: any, res: Response) => {
  try {
    const user = req.user;
    if (!user || !['ADMIN', 'SELLER', 'WAREHOUSE', 'DEPOSITO'].includes(user.role)) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    const customerId = String(req.query.customerId || '').trim();
    if (!customerId) {
      return res.status(400).json({ message: 'Indicá customerId' });
    }
    const params: string[] = [customerId];
    let sellerScope = '';
    if (user.role === 'SELLER') {
      sellerScope = ' AND c.seller_id = ?';
      params.push(user.id);
    }
    const rows = (await query(
      `SELECT
         o.id,
         o.customer_id,
         o.date,
         o.total,
         o.remito_number,
         o.payment_status,
         COALESCE(o.include_in_saldo, 0) AS include_in_saldo,
         (${SQL_ORDER_SALDO_RESIDUAL}) AS outstanding
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       LEFT JOIN (
         SELECT order_id, SUM(amount_credited) AS cn_total
         FROM credit_notes
         WHERE COALESCE(superseded_by_reinvoice, 0) = 0
         GROUP BY order_id
       ) cn ON cn.order_id = o.id
       WHERE o.customer_id = ?
         ${sellerScope}
         AND o.status NOT IN ('Cancelado', 'Borrador')
         AND (o.archived = 0 OR o.archived IS NULL)
         AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id)
         AND ${SQL_ORDER_IN_SALDO_SCOPE}
       ORDER BY o.date DESC, o.id DESC
       LIMIT 200`,
      params
    )) as Array<{
      id: string;
      customer_id: string;
      date: string;
      total: number;
      remito_number?: number;
      payment_status: string;
      include_in_saldo: number;
      outstanding: number;
    }>;

    return res.json(
      rows.map((r) => ({
        orderId: r.id,
        customerId: r.customer_id,
        date: r.date,
        total: Number(r.total) || 0,
        remitoNumber: r.remito_number != null ? Number(r.remito_number) : undefined,
        paymentStatus: r.payment_status === 'pendiente' ? 'pendiente' : 'pagado',
        includeInSaldo: !!Number(r.include_in_saldo),
        outstanding: Math.max(0, Number(r.outstanding) || 0)
      }))
    );
  } catch (e: any) {
    console.error('getLinkableOrdersForPayment:', e);
    return res.status(500).json({ message: 'Error listando pedidos imputables', detail: e?.message });
  }
};

export const getOrders = async (req: any, res: any) => {
  try {
    const user = req.user;
    const includeArchived = req.query.includeArchived === 'true' || req.query.includeArchived === '1';
    const archivedOnly = req.query.archivedOnly === 'true' || req.query.archivedOnly === '1';
    let whereArchived = ' AND (o.archived = 0 OR o.archived IS NULL)';
    if (archivedOnly) whereArchived = ' AND o.archived = 1';
    else if (includeArchived) whereArchived = '';
    const whereUserScope = user?.role === 'SELLER' ? ' AND c.seller_id = ?' : '';
    const ordersParams: any[] = user?.role === 'SELLER' ? [user.id] : [];

    let whereCustomer = '';
    if (user?.role === 'CUSTOMER') {
      const { get } = await import('../database/db');
      const customer = await get('SELECT id FROM customers WHERE user_id = ?', [user.id]);
      if (!customer?.id) {
        return res.json([]);
      }
      whereCustomer = ' AND o.customer_id = ?';
      ordersParams.push(customer.id);
    }

    const orderId = req.query.orderId as string | undefined;
    if (orderId) {
      ordersParams.push(orderId);
    }
    const whereOrderId = orderId ? ' AND o.id = ?' : '';

    const ordersRow = await query(
      `SELECT o.*, c.business_name AS customer_business_name, c.name AS customer_name, c.cuit AS customer_cuit,
              cu.name AS created_by_name, cu.role AS created_by_role,
              su.name AS seller_name
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN users cu ON cu.id = o.created_by
       LEFT JOIN users su ON su.id = o.seller_id
       WHERE 1=1 ${whereArchived}${whereUserScope}${whereCustomer}${whereOrderId}
       ORDER BY o.date DESC`,
      ordersParams
    );

    if (ordersRow.length === 0) {
      return res.json([]);
    }

    const orderIds = ordersRow.map((o: any) => o.id);
    const placeholders = orderIds.map(() => '?').join(',');
    const itemsRows = await query(`
      SELECT i.order_id, i.variant_id AS variantId, i.despacho_id AS despachoId, i.quantity, i.picked, i.price_at_moment AS priceAtMoment,
             COALESCE(i.sell_as_pack, 0) AS sellAsPack,
             COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS mayoristaPackSize,
             pc.product_id AS productId,
             COALESCE(pv.sku, p.sku) AS sku,
             p.name AS productName,
             s.size_code AS sizeCode,
             c.name AS colorName,
             c.code AS colorCode,
             COALESCE(d_item.numero_despacho, d_prod.numero_despacho) AS numeroDespacho
      FROM order_items i
      JOIN product_variants pv ON pv.id = i.variant_id
      JOIN product_colors pc ON pc.id = pv.product_color_id
      JOIN products p ON p.id = pc.product_id
      LEFT JOIN sizes s ON s.id = pv.size_id
      LEFT JOIN colors c ON c.id = pc.color_id
      LEFT JOIN despachos d_item ON d_item.id = i.despacho_id
      LEFT JOIN despachos d_prod ON d_prod.id = p.ultimo_despacho_id
      WHERE i.order_id IN (${placeholders})
      ORDER BY i.order_id, i.id
    `, orderIds);

    const itemsByOrderId: Record<string, any[]> = {};
    for (const o of ordersRow) {
      itemsByOrderId[o.id] = [];
    }
    for (const row of itemsRows as any[]) {
      const items = itemsByOrderId[row.order_id];
      if (items) {
        items.push({
          variantId: row.variantId,
          productId: row.productId,
          despachoId: row.despachoId ?? undefined,
          quantity: row.quantity,
          picked: row.picked ?? 0,
          priceAtMoment: Number(row.priceAtMoment),
          sellAsPack: !!(row.sellAsPack),
          mayoristaPackSize: row.mayoristaPackSize != null ? Number(row.mayoristaPackSize) : 1,
          sku: row.sku ?? undefined,
          productName: row.productName ?? undefined,
          sizeCode: row.sizeCode ?? undefined,
          colorName: row.colorName ?? undefined,
          colorCode: row.colorCode ?? undefined,
          numeroDespacho: row.numeroDespacho ?? row.numero_despacho ?? undefined
        });
      }
    }

    const invoicesRows = await query(
      `SELECT order_id, cae, cae_fch_vto, punto_venta, cbte_desde, cbte_hasta, cbte_tipo, created_at, agip_alicuota, agip_ret_per
       FROM invoices
       WHERE order_id IN (${placeholders})`,
      orderIds
    );
    const invoiceByOrderId: Record<string, any> = {};
    for (const inv of invoicesRows as any[]) {
      invoiceByOrderId[inv.order_id] = {
        cae: inv.cae,
        caeFchVto: inv.cae_fch_vto ?? undefined,
        puntoVta: inv.punto_venta ?? undefined,
        cbteDesde: inv.cbte_desde,
        cbteHasta: inv.cbte_hasta,
        cbteTipo: inv.cbte_tipo,
        createdAt: inv.created_at ? new Date(inv.created_at).toISOString() : undefined,
        agipAlicuota: Number(inv.agip_alicuota || 0),
        agipRetPer: Number(inv.agip_ret_per || 0)
      };
    }
    // Fallback para facturas antiguas sin retención guardada:
    // recalcular con padrón AGIP del período del pedido para no perder la línea en impresión.
    const agipRecalcInputs: { inv: any; orderDate: any; customerCuit: string | null | undefined; netAmount: number }[] = [];
    for (const o of ordersRow as any[]) {
      const inv = invoiceByOrderId[o.id];
      if (!inv) continue;
      const hasStoredAgip = Number(inv.agipAlicuota || 0) > 0 || Number(inv.agipRetPer || 0) > 0;
      if (hasStoredAgip) continue;
      const lines = itemsByOrderId[o.id] || [];
      let netFromItems = 0;
      for (const it of lines) {
        const qty = Number(it.quantity || 0);
        const price = Number(it.priceAtMoment || 0);
        netFromItems += Math.round(qty * price * 100) / 100;
      }
      netFromItems = Math.round(netFromItems * 100) / 100;
      const netAmount = netFromItems > 0 ? netFromItems : Number(o.total || 0);
      agipRecalcInputs.push({
        inv,
        orderDate: o.date,
        customerCuit: o.customer_cuit,
        netAmount,
      });
    }
    const agipResults = await Promise.all(
      agipRecalcInputs.map((row) =>
        getAgipRetentionForOrder({
          orderDate: row.orderDate,
          customerCuit: row.customerCuit,
          netAmount: row.netAmount,
        }).then((calc) => ({ inv: row.inv, calc }))
      )
    );
    for (const { inv, calc } of agipResults) {
      if (calc) {
        inv.agipAlicuota = Number(calc.alicuota || 0);
        inv.agipRetPer = Number(calc.amount || 0);
      }
    }

    let creditNotesCountByOrderId: Record<string, number> = {};
    let creditNotesTotalByOrderId: Record<string, number> = {};
    let creditNotesItemByOrderId: Record<string, number> = {};
    let creditNotesNetoCreditedByOrderId: Record<string, number> = {};
    let debitNotesCountByOrderId: Record<string, number> = {};
    try {
      const cnRows = await query(
        `SELECT order_id,
                COUNT(*) AS cnt,
                SUM(CASE WHEN scope = 'total' THEN 1 ELSE 0 END) AS total_cnt,
                SUM(CASE WHEN scope = 'item' THEN 1 ELSE 0 END) AS item_cnt,
                COALESCE(SUM(amount_credited), 0) AS neto_credited_sum
         FROM credit_notes
         WHERE order_id IN (${placeholders})
         GROUP BY order_id`,
        orderIds
      );
      for (const r of cnRows as any[]) {
        creditNotesCountByOrderId[r.order_id] = Number(r.cnt) || 0;
        creditNotesTotalByOrderId[r.order_id] = Number(r.total_cnt) || 0;
        creditNotesItemByOrderId[r.order_id] = Number(r.item_cnt) || 0;
        creditNotesNetoCreditedByOrderId[r.order_id] = Math.round(Number(r.neto_credited_sum || 0) * 100) / 100;
      }
    } catch (_) {
      // Tabla credit_notes puede no existir en DB antiguas
    }

    try {
      const dnRows = await query(
        `SELECT order_id, COUNT(*) AS cnt
         FROM debit_notes
         WHERE order_id IN (${placeholders})
         GROUP BY order_id`,
        orderIds
      );
      for (const r of dnRows as any[]) {
        debitNotesCountByOrderId[r.order_id] = Number(r.cnt) || 0;
      }
    } catch (_) {
      // Tabla debit_notes puede no existir en DB antiguas
    }

    let totalCnsByOrderId: Record<string, any[]> = {};
    try {
      const cnTotalDetailRows = await query(
        `SELECT order_id, id, cae, punto_venta, cbte_tipo, cbte_desde, cbte_hasta,
                voided_invoice_cae, voided_invoice_punto_venta, voided_invoice_cbte_tipo, voided_invoice_cbte_desde,
                COALESCE(superseded_by_reinvoice, 0) AS superseded_by_reinvoice,
                created_at
         FROM credit_notes
         WHERE order_id IN (${placeholders}) AND scope = 'total'
         ORDER BY created_at ASC, id ASC`,
        orderIds
      );
      for (const r of cnTotalDetailRows as any[]) {
        if (!totalCnsByOrderId[r.order_id]) totalCnsByOrderId[r.order_id] = [];
        totalCnsByOrderId[r.order_id].push(r);
      }
    } catch (_) {
      totalCnsByOrderId = {};
    }

    let mayoristaStockLoaded = false;
    let mayoristaStockAppliedByOrder: Record<string, boolean> = {};
    let mayoristaStockRestoredByOrder: Record<string, boolean> = {};
    try {
      if (orderIds.length > 0) {
        const refs = orderIds.map((oid: string) => `Pedido: ${oid}`);
        const rph = refs.map(() => '?').join(',');
        const mRows = await query(
          `SELECT DISTINCT reference FROM stock_movements
           WHERE movement_type = 'PEDIDO_MAYORISTA' AND reference IN (${rph})`,
          refs
        );
        const appliedRefs = new Set((mRows as { reference: string }[]).map((r) => r.reference));
        for (const oid of orderIds) {
          mayoristaStockAppliedByOrder[oid] = appliedRefs.has(`Pedido: ${oid}`);
        }
        const restoreRefs = orderIds.flatMap((oid: string) => [
          wholesaleOrderStockManualRestoreReference(oid),
          `Cancelación pedido: ${oid}`,
        ]);
        const restorePh = restoreRefs.map(() => '?').join(',');
        const restoreRows = await query(
          `SELECT DISTINCT reference FROM stock_movements
           WHERE movement_type = 'DEVOLUCION' AND reference IN (${restorePh})`,
          restoreRefs
        );
        const restoredRefs = new Set((restoreRows as { reference: string }[]).map((r) => r.reference));
        for (const oid of orderIds) {
          mayoristaStockRestoredByOrder[oid] =
            restoredRefs.has(wholesaleOrderStockManualRestoreReference(oid)) ||
            restoredRefs.has(`Cancelación pedido: ${oid}`);
        }
        mayoristaStockLoaded = true;
      }
    } catch (_) {
      // stock_movements puede no existir en DB antiguas
    }

    const ordersFull = ordersRow.map((order: any) => {
      const inv = invoiceByOrderId[order.id];
      const totalCnList = totalCnsByOrderId[order.id] || [];
      const activeTotalVoid = countActiveTotalCreditNoteVoid(inv, totalCnList);
      const lastTotalCn = totalCnList.length ? totalCnList[totalCnList.length - 1] : undefined;
      const totalCnt = creditNotesTotalByOrderId[order.id] ?? 0;
      return {
      id: order.id,
      customerId: order.customer_id,
      customerBusinessName: order.customer_business_name ?? order.customer_name ?? undefined,
      sellerId: order.seller_id,
      createdBy: order.created_by ?? undefined,
      createdByName: order.created_by_name ?? undefined,
      createdByRole: order.created_by_role ?? undefined,
      sellerName: order.seller_name ?? undefined,
      date: order.date,
      status: order.status,
      total: Number(order.total),
      pickedBy: order.picked_by ?? undefined,
      dispatchedAt: order.dispatched_at ? new Date(order.dispatched_at).toISOString() : undefined,
      archived: !!(order.archived),
      remitoNumber: order.remito_number != null ? Number(order.remito_number) : undefined,
      matrixImportLabel: order.matrix_import_label ? String(order.matrix_import_label) : undefined,
      notes: order.notes ? String(order.notes) : undefined,
      items: itemsByOrderId[order.id] || [],
      invoice: inv ?? undefined,
      creditNotesCount: creditNotesCountByOrderId[order.id] ?? 0,
      creditNotesTotalCount: totalCnt,
      creditNotesItemCount: creditNotesItemByOrderId[order.id] ?? 0,
      /** NC total que sigue anulando el CAE actual del pedido (0 si ya hay factura nueva tras reemisión). */
      creditNotesActiveTotalVoidCount: activeTotalVoid,
      /** Última NC por el total: comprobante anulado + NC (para UI de secuencia fiscal). */
      lastTotalCreditNoteFiscal: totalCnt > 0 ? buildLastTotalCreditNoteFiscalPayload(lastTotalCn) : undefined,
      /** Suma de netos creditados (AFIP amount_credited, sin IVA) — útil p. ej. valor declarado en remito expreso. */
      creditNotesNetoCredited: creditNotesNetoCreditedByOrderId[order.id] ?? 0,
      debitNotesCount: debitNotesCountByOrderId[order.id] ?? 0,
      paymentStatus: mapPaymentStatus(order),
      includeInSaldo: mapIncludeInSaldo(order),
      noStockImpact: !!order.no_stock_impact,
      mayoristaStockApplied: mayoristaStockLoaded
        ? mayoristaStockAppliedByOrder[order.id] === true
        : undefined,
      mayoristaStockRestored: mayoristaStockLoaded
        ? mayoristaStockRestoredByOrder[order.id] === true
        : undefined
    };
    });

    res.json(ordersFull);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching orders" });
  }
};

async function buildPersistedOrderResponse(orderId: string, newOrder: Order, despachoWarnings: string[]): Promise<any> {
  const created = await get(
    `SELECT o.id, o.customer_id, o.seller_id, o.date, o.status, o.total, o.picked_by, o.dispatched_at, o.payment_status, o.no_stock_impact,
            o.created_by, o.matrix_import_label, o.notes, cu.name AS created_by_name, cu.role AS created_by_role, su.name AS seller_name
     FROM orders o
     LEFT JOIN users cu ON cu.id = o.created_by
     LEFT JOIN users su ON su.id = o.seller_id
     WHERE o.id = ?`,
    [orderId]
  );
  if (!created) {
    return {
      ...newOrder,
      id: orderId,
      paymentStatus: (newOrder as any).paymentStatus === 'pagado' ? 'pagado' : 'pendiente',
      despachoWarnings,
      items: newOrder.items,
    } as any;
  }
  const items = await query(
    `
    SELECT i.variant_id AS variantId, i.despacho_id AS despachoId, i.quantity, i.picked, i.price_at_moment AS priceAtMoment,
           COALESCE(i.sell_as_pack, 0) AS sellAsPack, COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS mayoristaPackSize,
           pc.product_id AS productId,
           COALESCE(pv.sku, p.sku) AS sku, p.name AS productName, s.size_code AS sizeCode, c.name AS colorName, c.code AS colorCode,
           COALESCE(d_item.numero_despacho, d_prod.numero_despacho) AS numeroDespacho
    FROM order_items i
    JOIN product_variants pv ON pv.id = i.variant_id
    JOIN product_colors pc ON pc.id = pv.product_color_id
    JOIN products p ON p.id = pc.product_id
    LEFT JOIN sizes s ON s.id = pv.size_id
    LEFT JOIN colors c ON c.id = pc.color_id
    LEFT JOIN despachos d_item ON d_item.id = i.despacho_id
    LEFT JOIN despachos d_prod ON d_prod.id = p.ultimo_despacho_id
    WHERE i.order_id = ?
    ORDER BY i.id
  `,
    [orderId]
  );
  const itemsMapped = (items as any[]).map((row: any) => ({
    variantId: row.variantId,
    productId: row.productId,
    despachoId: row.despachoId ?? undefined,
    quantity: row.quantity,
    picked: row.picked ?? 0,
    priceAtMoment: Number(row.priceAtMoment),
    sellAsPack: !!(row.sellAsPack),
    mayoristaPackSize: row.mayoristaPackSize != null ? Number(row.mayoristaPackSize) : 1,
    sku: row.sku ?? undefined,
    productName: row.productName ?? undefined,
    sizeCode: row.sizeCode ?? undefined,
    colorName: row.colorName ?? undefined,
    colorCode: row.colorCode ?? undefined,
    numeroDespacho: row.numeroDespacho ?? undefined,
  }));
  return {
    id: created.id,
    customerId: created.customer_id,
    sellerId: created.seller_id,
    createdBy: (created as any).created_by ?? undefined,
    createdByName: (created as any).created_by_name ?? undefined,
    createdByRole: (created as any).created_by_role ?? undefined,
    sellerName: (created as any).seller_name ?? undefined,
    date: created.date,
    status: created.status,
    total: Number(created.total),
    pickedBy: created.picked_by ?? undefined,
    dispatchedAt: created.dispatched_at ? new Date(created.dispatched_at).toISOString() : undefined,
    items: itemsMapped,
    paymentStatus: mapPaymentStatus(created),
    noStockImpact: !!created.no_stock_impact,
    matrixImportLabel: (created as any).matrix_import_label
      ? String((created as any).matrix_import_label)
      : undefined,
    notes: (created as any).notes ? String((created as any).notes) : undefined,
    despachoWarnings,
  };
}

async function persistNewWholesaleOrder(newOrder: Order, user: any, explicitOrderId?: string): Promise<any> {
  if (!newOrder.customerId || !newOrder.items?.length) {
    const err: any = new Error('Datos de pedido inválidos');
    err.statusCode = 400;
    throw err;
  }

  let sellerId = newOrder.sellerId ?? null;
  if (user?.role === 'CUSTOMER') {
    const customer = await get('SELECT id FROM customers WHERE user_id = ?', [user.id]);
    if (!customer || customer.id !== newOrder.customerId) {
      const err: any = new Error('Como cliente directo solo podés crear pedidos para tu propio perfil');
      err.statusCode = 403;
      throw err;
    }
    sellerId = null;
  }

  const orderId = explicitOrderId || newOrder.id || uuidv4();
  const alreadyExists = await get('SELECT id FROM orders WHERE id = ? LIMIT 1', [orderId]);
  if (alreadyExists?.id) {
    // Idempotencia: si llega un POST duplicado con el mismo id, devolver el mismo pedido.
    return buildPersistedOrderResponse(orderId, newOrder, []);
  }

  const toSqlDate = (d: string) => {
    try {
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return new Date().toISOString().slice(0, 10);
      return dt.toISOString().slice(0, 10);
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  };
  const sqlDate = toSqlDate(newOrder.date);
  const paymentStatus =
    (newOrder as any).paymentStatus === 'pagado' || (newOrder as any).paymentStatus === 'PAGADO' ? 'pagado' : 'pendiente';
  const noStockImpact = (newOrder as any).noStockImpact === true || (newOrder as any).no_stock_impact === 1 ? 1 : 0;
  const createdBy = user?.id ?? null;
  const requestedStatus = String(newOrder.status || 'Borrador');
  const shouldStayPendingAdmin =
    requestedStatus === 'Confirmado' && (user?.role === 'SELLER' || user?.role === 'CUSTOMER');
  const statusToSave = shouldStayPendingAdmin ? 'Pendiente confirmación admin' : requestedStatus;
  const matrixImportLabelRaw = (newOrder as any).matrixImportLabel ?? (newOrder as any).matrix_import_label;
  const matrixImportLabelForSql =
    matrixImportLabelRaw != null && String(matrixImportLabelRaw).trim()
      ? String(matrixImportLabelRaw).trim().slice(0, 120)
      : null;
  const notesForSql = normalizeOrderNotes((newOrder as any).notes);

  const skippedNoVariant: string[] = [];
  const despachoWarnings: string[] = [];
  type PreparedOrderItem = {
    item: any;
    variantId: string;
    allocations: Array<{ despachoId: string | null; quantity: number }>;
    sellAsPack: number;
  };
  const preparedRows: PreparedOrderItem[] = [];

  for (const item of newOrder.items as any[]) {
    let variantId = item.variantId;
    if (!variantId && item.sku && item.colorCode && item.sizeCode) {
      variantId =
        (await resolveVariantIdForGridCell(
          String(item.sku).trim(),
          String(item.colorCode).trim(),
          String(item.sizeCode).trim()
        )) || undefined;
    }
    if (!variantId) {
      const q = Math.max(0, Math.floor(Number(item.quantity) || 0));
      skippedNoVariant.push(
        `código ${item.sku}, color ${item.colorCode}, talle ${item.sizeCode}${q ? ` ×${q} u.` : ''}`
      );
      continue;
    }
    const sellAsPack = item.sellAsPack === true || item.sellAsPack === 1 ? 1 : 0;
    const explicitDespachoId = await resolveDespachoIdForItem(item, variantId);
    const allocations = explicitDespachoId
      ? [{ despachoId: explicitDespachoId, quantity: Math.max(0, Math.floor(Number(item.quantity) || 0)) }]
      : await allocateOldestDespachosForVariant(variantId, item.quantity);
    const allocQtySum = allocations.reduce(
      (sum, a) => sum + Math.max(0, Math.floor(Number(a.quantity) || 0)),
      0
    );
    if (allocQtySum <= 0) {
      skippedNoVariant.push(
        `código ${item.sku}, color ${item.colorCode}, talle ${item.sizeCode} (cantidad 0 o sin líneas de despacho)`
      );
      continue;
    }
    const unassignedQty = allocations
      .filter((a) => !a.despachoId)
      .reduce((sum, a) => sum + (Number(a.quantity) || 0), 0);
    if (unassignedQty > 0) {
      const itemLabel = await getItemLabelForWarning(item, variantId);
      despachoWarnings.push(`El artículo ${itemLabel} tiene ${unassignedQty} unidad(es) sin despacho.`);
    }
    preparedRows.push({ item, variantId, allocations, sellAsPack });
  }

  if (preparedRows.length === 0) {
    const err: any = new Error(
      skippedNoVariant.length
        ? `Ningún ítem coincide con el catálogo. Omitidos: ${skippedNoVariant.slice(0, 8).join('; ')}${
            skippedNoVariant.length > 8 ? '…' : ''
          }`
        : 'Datos de pedido inválidos'
    );
    err.statusCode = 400;
    throw err;
  }

  for (const s of skippedNoVariant) {
    despachoWarnings.push(`Sin variante en catálogo (omitido): ${s}`);
  }

  let totalRecalculated = 0;
  for (const pr of preparedRows) {
    const price = Number(pr.item.priceAtMoment ?? 0) || 0;
    for (const alloc of pr.allocations) {
      if (alloc.quantity > 0) totalRecalculated += alloc.quantity * price;
    }
  }
  totalRecalculated = Math.round(totalRecalculated * 100) / 100;

  let insertedItems = 0;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO orders (id, customer_id, seller_id, date, status, total, payment_status, no_stock_impact, created_by, matrix_import_label, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderId, newOrder.customerId, sellerId, sqlDate, statusToSave, totalRecalculated, paymentStatus, noStockImpact, createdBy, matrixImportLabelForSql, notesForSql]
    );
    for (const pr of preparedRows) {
      for (const alloc of pr.allocations) {
        if (!alloc.quantity || alloc.quantity <= 0) continue;
        await conn.execute(
          `INSERT INTO order_items (id, order_id, variant_id, quantity, picked, price_at_moment, sell_as_pack, despacho_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [uuidv4(), orderId, pr.variantId, alloc.quantity, 0, pr.item.priceAtMoment ?? 0, pr.sellAsPack, alloc.despachoId]
        );
        insertedItems += 1;
      }
    }
    if (insertedItems === 0) {
      await conn.rollback();
      const err: any = new Error(
        'No se pudo guardar ninguna línea del pedido (cantidades en cero o error al insertar ítems).'
      );
      err.statusCode = 400;
      throw err;
    }
    await conn.commit();
  } catch (e) {
    try {
      await conn.rollback();
    } catch {
      // ignore
    }
    throw e;
  } finally {
    conn.release();
  }

  // No descontar al confirmar: ahora se descuenta cuando finaliza picking.

  return buildPersistedOrderResponse(orderId, newOrder, despachoWarnings);
}

export const createOrder = async (req: any, res: any) => {
  const newOrder: Order = req.body;
  const user = req.user;
  try {
    const orderResponse = await persistNewWholesaleOrder(newOrder, user);
    res.status(201).json(orderResponse);
  } catch (error: any) {
    console.error(error);
    const code = error?.statusCode;
    if (code === 400) return res.status(400).json({ message: error.message || 'Solicitud inválida' });
    if (code === 403) return res.status(403).json({ message: error.message || 'Prohibido' });
    res.status(500).json({ message: 'Error creating order' });
  }
};

function normalizeMatrixCustomerRefKey(ref: string): string {
  return String(ref ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export interface MatrixImportLineInput {
  customerRef: string;
  codigo: string;
  color: string;
  sizeCode: string;
  quantity: number;
  unitPrice?: number | null;
}

/** Candidatos de SKU de artículo para cruzar `products.sku` con lista de precios / base (misma idea que import matriz + prefijos Tango). */
function matrixImportSkuLookupCandidates(raw: string): string[] {
  const t = String(raw ?? '').trim();
  if (!t) return [];
  const out: string[] = [];
  const add = (x: string) => {
    const s = String(x ?? '').trim();
    if (s && !out.includes(s)) out.push(s);
  };
  add(t);
  if (/^\d+$/.test(t)) {
    const digits = t;
    const noLead = digits.replace(/^0+/, '') || '0';
    add(digits);
    add(noLead);
    if (noLead.length <= 7) {
      add(noLead.padStart(7, '0'));
      add(digits.padStart(7, '0'));
    }
    for (let w = Math.max(4, noLead.length); w <= 7; w++) {
      add(noLead.padStart(w, '0'));
    }
    const p7 = noLead.length <= 7 ? noLead.padStart(7, '0') : noLead;
    for (const pref of ['Q', 'C', 'P'] as const) {
      add(pref + noLead);
      add(pref.toLowerCase() + noLead);
      add(pref + p7);
      add(pref.toLowerCase() + p7);
      if (digits !== noLead) {
        add(pref + digits);
        add(pref.toLowerCase() + digits);
      }
    }
  } else {
    const digits = t.replace(/\D/g, '');
    if (digits) {
      const noLead = digits.replace(/^0+/, '') || '0';
      add(noLead);
      if (noLead.length <= 7) add(noLead.padStart(7, '0'));
    }
    const m = t.match(/^([A-Za-z]{1,3})(\d[\d\s-]*)$/);
    if (m) {
      const num = m[2].replace(/\D/g, '');
      if (num) {
        const nl = num.replace(/^0+/, '') || '0';
        add(nl);
        if (nl.length <= 7) add(nl.padStart(7, '0'));
      }
    }
  }
  return out;
}

async function resolveMatrixImportLinePrice(
  priceListId: string | null,
  skuPad: string,
  excelUnitPrice: unknown
): Promise<number> {
  const ep = Number(excelUnitPrice);
  if (Number.isFinite(ep) && ep > 0) return Math.round(ep * 100) / 100;

  const tries = matrixImportSkuLookupCandidates(skuPad);
  const normSet = [...new Set(tries.map((x) => x.replace(/[-/\s]/g, '').toUpperCase()).filter(Boolean))];

  if (priceListId) {
    const listRow = await get('SELECT id FROM price_lists WHERE id = ? LIMIT 1', [priceListId]);
    if (listRow?.id) {
      for (const skuTry of tries) {
        const pli = await get(
          `SELECT pli.price FROM price_list_items pli
           INNER JOIN products p ON p.id = pli.product_id
           WHERE pli.price_list_id = ? AND TRIM(p.sku) = TRIM(?)
           LIMIT 1`,
          [priceListId, skuTry]
        );
        if (pli != null && Number((pli as any).price) > 0) {
          return Math.round(Number((pli as any).price) * 100) / 100;
        }
      }
      for (const norm of normSet) {
        const pli = await get(
          `SELECT pli.price FROM price_list_items pli
           INNER JOIN products p ON p.id = pli.product_id
           WHERE pli.price_list_id = ?
             AND REPLACE(REPLACE(REPLACE(UPPER(TRIM(p.sku)), '-', ''), '/', ''), ' ', '') = ?
           LIMIT 1`,
          [priceListId, norm]
        );
        if (pli != null && Number((pli as any).price) > 0) {
          return Math.round(Number((pli as any).price) * 100) / 100;
        }
      }
    }
  }

  for (const skuTry of tries) {
    const row = await get(`SELECT base_price FROM products WHERE TRIM(sku) = TRIM(?) LIMIT 1`, [skuTry]);
    if (row != null && Number((row as any).base_price) > 0) {
      return Math.round(Number((row as any).base_price) * 100) / 100;
    }
  }
  for (const norm of normSet) {
    const row = await get(
      `SELECT base_price FROM products WHERE REPLACE(REPLACE(REPLACE(UPPER(TRIM(sku)), '-', ''), '/', ''), ' ', '') = ? LIMIT 1`,
      [norm]
    );
    if (row != null && Number((row as any).base_price) > 0) {
      return Math.round(Number((row as any).base_price) * 100) / 100;
    }
  }
  return 0;
}

/** Crea un borrador por cada cliente distinto a partir de líneas ya aplanadas (código+color+talle+cantidad). */
export const importOrdersFromMatrix = async (req: any, res: any) => {
  const user = req.user;
  if (!user || !['ADMIN', 'WAREHOUSE', 'DEPOSITO', 'SELLER'].includes(user.role)) {
    return res.status(403).json({ message: 'Sin permiso para importar pedidos' });
  }

  const padSku = (s: string) => normalizeMatrixImportArticleSku(String(s ?? ''));

  const findCustomer = async (customerRef: string): Promise<{ id: string; seller_id: string | null } | null> => {
    const ref = String(customerRef ?? '').trim();
    if (!ref) return null;
    const lower = ref.toLowerCase();
    const params: any[] = [lower, lower];
    let sql = `SELECT id, seller_id FROM customers 
      WHERE LOWER(TRIM(COALESCE(business_name,''))) = ? 
         OR LOWER(TRIM(COALESCE(name,''))) = ?`;
    if (user.role === 'SELLER') {
      sql += ` AND seller_id = ?`;
      params.push(user.id);
    }
    sql += ` LIMIT 1`;
    let c = await get(sql, params);
    const safe = ref.replace(/%/g, '').replace(/_/g, '').trim();
    if (!c && safe.length >= 10) {
      const needle = `%${safe}%`;
      const p2: any[] = [needle, needle];
      let sql2 = `SELECT id, seller_id FROM customers WHERE business_name LIKE ? OR name LIKE ?`;
      if (user.role === 'SELLER') {
        sql2 += ` AND seller_id = ?`;
        p2.push(user.id);
      }
      sql2 += ` LIMIT 1`;
      c = await get(sql2, p2);
    }
    return c ? { id: (c as any).id, seller_id: (c as any).seller_id ?? null } : null;
  };

  try {
    const body = req.body || {};
    const linesRaw = body.lines as MatrixImportLineInput[] | undefined;
    const dateStr =
      typeof body.date === 'string' && body.date.trim() ? body.date.trim() : new Date().toISOString().slice(0, 10);
    if (!Array.isArray(linesRaw) || linesRaw.length === 0) {
      return res.status(400).json({ message: 'Se requiere body.lines: array no vacío' });
    }

    const bodyPriceListRaw = (body as any).priceListId ?? (body as any).price_list_id;
    const bodyPriceListId =
      bodyPriceListRaw != null && String(bodyPriceListRaw).trim() !== '' ? String(bodyPriceListRaw).trim() : null;

    const byRefKey = new Map<string, MatrixImportLineInput[]>();
    for (const ln of linesRaw) {
      const refTrim = String(ln.customerRef ?? '').trim();
      if (!refTrim) continue;
      const refKey = normalizeMatrixCustomerRefKey(refTrim);
      if (!byRefKey.has(refKey)) byRefKey.set(refKey, []);
      byRefKey.get(refKey)!.push({ ...ln, customerRef: refTrim });
    }

    const created: any[] = [];
    const errors: { customerRef: string; message: string }[] = [];

    type MatrixImportMergeBucket = {
      customer: { id: string; seller_id: string | null };
      lines: MatrixImportLineInput[];
      displayRef: string;
    };
    const byCustomerMerged = new Map<string, MatrixImportMergeBucket>();

    for (const [, refGroupLines] of byRefKey) {
      if (!refGroupLines.length) continue;
      const ref0 = String(refGroupLines[0]?.customerRef ?? '').trim();
      const customer = await findCustomer(ref0);
      if (!customer) {
        errors.push({
          customerRef: ref0,
          message: 'Cliente no encontrado',
        });
        continue;
      }
      const mergeKey = customer.id;
      let bucket = byCustomerMerged.get(mergeKey);
      if (!bucket) {
        bucket = { customer, lines: [], displayRef: ref0 };
        byCustomerMerged.set(mergeKey, bucket);
      }
      bucket.lines.push(...refGroupLines);
    }

    for (const [, bucket] of byCustomerMerged) {
      const groupLines = bucket.lines;
      const customerRef = bucket.displayRef;
      const customer = bucket.customer;
      try {
        const custPlRow = await get('SELECT price_list_id FROM customers WHERE id = ? LIMIT 1', [customer.id]);
        const customerListId =
          custPlRow?.price_list_id != null && String(custPlRow.price_list_id).trim()
            ? String(custPlRow.price_list_id).trim()
            : null;
        const priceListIdForImport = bodyPriceListId || customerListId;

        type AggRow = {
          codigo: string;
          color: string;
          sizeCode: string;
          qty: number;
          unitPrice?: number | null;
        };
        const aggMap = new Map<string, AggRow>();
        for (const ln of groupLines) {
          const qty = Math.max(0, Math.floor(Number(ln.quantity) || 0));
          if (qty <= 0) continue;
          const codigo = padSku(String(ln.codigo ?? '').trim());
          const color = String(ln.color ?? '').trim();
          const sizeCode = String(ln.sizeCode ?? '').trim();
          if (!codigo || !color || !sizeCode) continue;
          const k = `${codigo}\t${color}\t${sizeCode}`;
          const prev = aggMap.get(k);
          if (!prev) {
            aggMap.set(k, { codigo, color, sizeCode, qty, unitPrice: ln.unitPrice });
          } else {
            prev.qty += qty;
            const ep = Number(ln.unitPrice);
            const hasGood = Number.isFinite(ep) && ep > 0;
            const prevEp = Number(prev.unitPrice);
            if (hasGood && !(Number.isFinite(prevEp) && prevEp > 0)) {
              prev.unitPrice = ln.unitPrice;
            }
          }
        }
        const items: any[] = [];
        for (const row of aggMap.values()) {
          const priceAtMoment = await resolveMatrixImportLinePrice(priceListIdForImport, row.codigo, row.unitPrice);
          items.push({
            sku: row.codigo,
            colorCode: row.color,
            sizeCode: row.sizeCode,
            quantity: row.qty,
            priceAtMoment,
          });
        }
        if (items.length === 0) {
          errors.push({ customerRef, message: 'Sin líneas con cantidad > 0' });
          continue;
        }
        let total = 0;
        for (const it of items) total += it.quantity * it.priceAtMoment;
        const newOrder: Order = {
          id: uuidv4(),
          customerId: customer.id,
          sellerId: customer.seller_id,
          items: items as any,
          total,
          status: OrderStatus.DRAFT,
          date: dateStr,
        };
        const saved = await persistNewWholesaleOrder(newOrder, user, newOrder.id);
        created.push(saved);
      } catch (e: any) {
        console.error(e);
        errors.push({
          customerRef,
          message: e?.statusCode === 400 ? e.message : e?.message || 'Error al crear pedido',
        });
      }
    }

    res.status(201).json({
      created,
      errors,
      counts: { created: created.length, errors: errors.length },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Error importando pedidos' });
  }
};

export const updateOrderStatus = async (req: any, res: any) => {
  const { id } = req.params;
  const { status, pickedBy } = req.body;
  const user = req.user;

  try {
    // Obtener estado anterior
    const currentOrder = await get("SELECT status, no_stock_impact FROM orders WHERE id = ?", [id]);
    const previousStatus = currentOrder?.status;
    const noStockImpact = !!currentOrder?.no_stock_impact;
    if (!previousStatus) return res.status(404).json({ message: 'Pedido no encontrado' });

    const isAdmin = user?.role === 'ADMIN';
    const requestedStatus = String(status || previousStatus);
    const nextStatus =
      requestedStatus === 'Confirmado' && !isAdmin
        ? 'Pendiente confirmación admin'
        : requestedStatus;

    // Mientras esté pendiente de admin, solo puede cancelarse o confirmarse por ADMIN.
    if (
      previousStatus === 'Pendiente confirmación admin' &&
      !['Pendiente confirmación admin', 'Confirmado', 'Cancelado'].includes(nextStatus)
    ) {
      return res.status(400).json({
        message: 'El pedido está pendiente de confirmación de admin.'
      });
    }

    // Descontar stock cuando finaliza picking (Falta controlar / Controlado / Despachado).
    const pickingDoneStatuses = ['Falta controlar', 'Controlado', 'Despachado'];
    const entersPickingDone =
      !pickingDoneStatuses.includes(previousStatus) &&
      pickingDoneStatuses.includes(nextStatus);
    if (
      entersPickingDone &&
      !noStockImpact &&
      !(await isMayoristaStockDeductedForWholesale(id))
    ) {
      const { deductStockForOrder } = await import('./stock.controller');
      const result = await deductStockForOrder(id);
      
      if (!result.success) {
        console.error('Errores descontando stock:', result.errors);
      }
    }

    // Si se cancela y el stock ya estaba descontado de verdad, restaurar.
    const hadStockDeducted =
      !noStockImpact && (await isMayoristaStockDeductedForWholesale(id));
    if (nextStatus === 'Cancelado' && hadStockDeducted && !(await isWholesaleStockRestoredForOrder(id))) {
      const { restoreStockForOrder } = await import('./stock.controller');
      const result = await restoreStockForOrder(id);
      
      if (!result.success) {
        console.error('Errores restaurando stock:', result.errors);
      }
    }

    // Documentar quién prepara/despacha y cuándo
    if ((nextStatus === 'Preparando' || nextStatus === 'Preparación') && pickedBy) {
      await execute("UPDATE orders SET status = ?, picked_by = ? WHERE id = ?", [nextStatus, pickedBy, id]);
    } else if (nextStatus === 'Despachado') {
      await execute(
        "UPDATE orders SET status = ?, picked_by = COALESCE(?, picked_by), dispatched_at = NOW() WHERE id = ?",
        [nextStatus, pickedBy || null, id]
      );
    } else {
      await execute("UPDATE orders SET status = ? WHERE id = ?", [nextStatus, id]);
    }
    res.json({ id, status: nextStatus, previousStatus });
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ message: "Error updating order status" });
  }
};

export const updateOrder = async (req: any, res: any) => {
  const { id } = req.params;
  const updated: Order = req.body;
  if (!id || !updated || !updated.items?.length) {
    return res.status(400).json({ message: "Datos de pedido inválidos" });
  }
  try {
    const despachoWarnings: string[] = [];
    const toSqlDate = (d: string) => {
      try {
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return new Date().toISOString().slice(0, 10);
        return dt.toISOString().slice(0, 10);
      } catch {
        return new Date().toISOString().slice(0, 10);
      }
    };
    const sqlDate = toSqlDate(updated.date);
    const sellerId = updated.sellerId ?? null;
    const paymentStatus =
      (updated as any).paymentStatus === 'pagado' || (updated as any).paymentStatus === 'PAGADO' ? 'pagado' : 'pendiente';
    const noStockImpact = (updated as any).noStockImpact === true || (updated as any).no_stock_impact === 1 ? 1 : 0;
    const notesForSql = normalizeOrderNotes((updated as any).notes);
    await execute(
      'UPDATE orders SET customer_id = ?, seller_id = ?, date = ?, status = ?, total = ?, payment_status = ?, no_stock_impact = ?, notes = ? WHERE id = ?',
      [updated.customerId, sellerId, sqlDate, updated.status, updated.total, paymentStatus, noStockImpact, notesForSql, id]
    );
    await execute("DELETE FROM order_items WHERE order_id = ?", [id]);
    for (const item of updated.items as any[]) {
      let variantId = item.variantId;
      if (!variantId && item.sku && item.colorCode && item.sizeCode) {
        const row = await get(
          `SELECT pv.id AS variant_id 
           FROM products p 
           JOIN product_colors pc ON pc.product_id = p.id 
           JOIN colors c ON c.id = pc.color_id 
           JOIN product_variants pv ON pv.product_color_id = pc.id 
           JOIN sizes s ON s.id = pv.size_id 
           WHERE p.sku = ? AND c.code = ? AND s.size_code = ?`,
          [item.sku, item.colorCode, item.sizeCode]
        );
        variantId = row?.variant_id;
      }
      if (!variantId) {
        return res.status(400).json({ message: "Falta variantId o sku+colorCode+sizeCode en item" });
      }
      const sellAsPack = item.sellAsPack === true || item.sellAsPack === 1 ? 1 : 0;
      const explicitDespachoId = await resolveDespachoIdForItem(item, variantId);
      const allocations = explicitDespachoId
        ? [{ despachoId: explicitDespachoId, quantity: Math.max(0, Math.floor(Number(item.quantity) || 0)) }]
        : await allocateOldestDespachosForVariant(variantId, item.quantity);
      const unassignedQty = allocations
        .filter((a) => !a.despachoId)
        .reduce((sum, a) => sum + (Number(a.quantity) || 0), 0);
      if (unassignedQty > 0) {
        const itemLabel = await getItemLabelForWarning(item, variantId);
        despachoWarnings.push(`El artículo ${itemLabel} tiene ${unassignedQty} unidad(es) sin despacho.`);
      }
      let pickedRemaining = Math.max(0, Math.floor(Number(item.picked) || 0));
      for (const alloc of allocations) {
        if (!alloc.quantity || alloc.quantity <= 0) continue;
        const pickedForLine = Math.min(pickedRemaining, alloc.quantity);
        pickedRemaining -= pickedForLine;
        await execute(
          "INSERT INTO order_items (id, order_id, variant_id, quantity, picked, price_at_moment, sell_as_pack, despacho_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [uuidv4(), id, variantId, alloc.quantity, pickedForLine, item.priceAtMoment, sellAsPack, alloc.despachoId]
        );
      }
    }
    const created = await get(
      `SELECT o.id, o.customer_id, o.seller_id, o.date, o.status, o.total, o.picked_by, o.dispatched_at, o.payment_status, o.no_stock_impact,
              o.created_by, o.notes, cu.name AS created_by_name, cu.role AS created_by_role, su.name AS seller_name
       FROM orders o
       LEFT JOIN users cu ON cu.id = o.created_by
       LEFT JOIN users su ON su.id = o.seller_id
       WHERE o.id = ?`,
      [id]
    );
    if (!created) return res.json({ ...updated, id, despachoWarnings });
    const itemsRows = await query(`
      SELECT i.variant_id AS variantId, i.despacho_id AS despachoId, i.quantity, i.picked, i.price_at_moment AS priceAtMoment,
             COALESCE(i.sell_as_pack, 0) AS sellAsPack, COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS mayoristaPackSize,
             pc.product_id AS productId,
             COALESCE(pv.sku, p.sku) AS sku, p.name AS productName, s.size_code AS sizeCode, c.name AS colorName, c.code AS colorCode,
             COALESCE(d_item.numero_despacho, d_prod.numero_despacho) AS numeroDespacho
      FROM order_items i
      JOIN product_variants pv ON pv.id = i.variant_id
      JOIN product_colors pc ON pc.id = pv.product_color_id
      JOIN products p ON p.id = pc.product_id
      LEFT JOIN sizes s ON s.id = pv.size_id
      LEFT JOIN colors c ON c.id = pc.color_id
      LEFT JOIN despachos d_item ON d_item.id = i.despacho_id
      LEFT JOIN despachos d_prod ON d_prod.id = p.ultimo_despacho_id
      WHERE i.order_id = ?
      ORDER BY i.id
    `, [id]);
    const itemsMapped = (itemsRows as any[]).map((row: any) => ({
      variantId: row.variantId,
      productId: row.productId,
      despachoId: row.despachoId ?? undefined,
      quantity: row.quantity,
      picked: row.picked ?? 0,
      priceAtMoment: Number(row.priceAtMoment),
      sellAsPack: !!(row.sellAsPack),
      mayoristaPackSize: row.mayoristaPackSize != null ? Number(row.mayoristaPackSize) : 1,
      sku: row.sku ?? undefined,
      productName: row.productName ?? undefined,
      sizeCode: row.sizeCode ?? undefined,
      colorName: row.colorName ?? undefined,
      colorCode: row.colorCode ?? undefined,
      numeroDespacho: row.numeroDespacho ?? undefined
    }));
    res.json({
      id: created.id,
      customerId: created.customer_id,
      sellerId: created.seller_id,
      createdBy: (created as any).created_by ?? undefined,
      createdByName: (created as any).created_by_name ?? undefined,
      createdByRole: (created as any).created_by_role ?? undefined,
      sellerName: (created as any).seller_name ?? undefined,
      date: created.date,
      status: created.status,
      total: Number(created.total),
      pickedBy: created.picked_by ?? undefined,
      dispatchedAt: created.dispatched_at ? new Date(created.dispatched_at).toISOString() : undefined,
      items: itemsMapped,
      paymentStatus: mapPaymentStatus(created),
      noStockImpact: !!created.no_stock_impact,
      notes: (created as any).notes ? String((created as any).notes) : undefined,
      despachoWarnings
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error actualizando pedido" });
  }
}

/** Marca si un pedido sin factura (o cualquier pedido) suma al saldo pendiente del cliente. */
export const patchOrderIncludeInSaldo = async (req: any, res: any) => {
  const { id } = req.params;
  const user = req.user;
  if (!user || !['ADMIN', 'SELLER', 'WAREHOUSE', 'DEPOSITO'].includes(user.role)) {
    return res.status(403).json({ message: 'Sin permiso para modificar saldo del pedido' });
  }
  const raw = req.body?.includeInSaldo ?? req.body?.include_in_saldo;
  const includeInSaldo = raw === true || raw === 1 || raw === '1' || raw === 'true';
  if (!id) return res.status(400).json({ message: 'ID inválido' });
  try {
    const row = await get('SELECT id, customer_id FROM orders WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ message: 'Pedido no encontrado' });
    if (user.role === 'SELLER') {
      const cust = row.customer_id
        ? await get('SELECT seller_id FROM customers WHERE id = ?', [row.customer_id])
        : null;
      if (cust?.seller_id && cust.seller_id !== user.id) {
        return res.status(403).json({ message: 'Solo podés modificar pedidos de tus clientes' });
      }
    }
    if (includeInSaldo) {
      await execute(
        'UPDATE orders SET include_in_saldo = 1, payment_status = ? WHERE id = ?',
        ['pendiente', id]
      );
    } else {
      const hasInv = await get('SELECT 1 AS ok FROM invoices WHERE order_id = ? LIMIT 1', [id]);
      if (hasInv?.ok) {
        await execute('UPDATE orders SET include_in_saldo = 0 WHERE id = ?', [id]);
      } else {
        await execute(
          'UPDATE orders SET include_in_saldo = 0, payment_status = ? WHERE id = ?',
          ['pagado', id]
        );
      }
    }
    const updated = await get(
      'SELECT payment_status, include_in_saldo FROM orders WHERE id = ?',
      [id]
    );
    res.json({
      id,
      includeInSaldo: mapIncludeInSaldo(updated),
      paymentStatus: mapPaymentStatus(updated)
    });
  } catch (error) {
    console.error('patchOrderIncludeInSaldo:', error);
    res.status(500).json({ message: 'Error actualizando saldo del pedido' });
  }
};

/** Marca cobro del pedido (pendiente / pagado) sin reenviar ítems. */
export const patchOrderPaymentStatus = async (req: any, res: any) => {
  const { id } = req.params;
  const user = req.user;
  if (!user || !['ADMIN', 'SELLER', 'WAREHOUSE', 'DEPOSITO'].includes(user.role)) {
    return res.status(403).json({ message: 'Sin permiso para modificar cobranza' });
  }
  const raw = req.body?.paymentStatus ?? req.body?.payment_status;
  const paymentStatus = raw === 'pagado' || raw === 'PAGADO' ? 'pagado' : 'pendiente';
  if (!id) return res.status(400).json({ message: 'ID inválido' });
  try {
    const row = await get('SELECT id FROM orders WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ message: 'Pedido no encontrado' });
    if (user.role === 'SELLER') {
      const ord = await get('SELECT customer_id FROM orders WHERE id = ?', [id]);
      const cust = ord?.customer_id
        ? await get('SELECT seller_id FROM customers WHERE id = ?', [ord.customer_id])
        : null;
      if (cust?.seller_id && cust.seller_id !== user.id) {
        return res.status(403).json({ message: 'Solo podés modificar pedidos de tus clientes' });
      }
    }
    if (paymentStatus === 'pagado') {
      await execute('UPDATE orders SET payment_status = ?, include_in_saldo = 0 WHERE id = ?', [paymentStatus, id]);
    } else {
      await execute('UPDATE orders SET payment_status = ? WHERE id = ?', [paymentStatus, id]);
    }
    const updated = await get('SELECT payment_status, include_in_saldo FROM orders WHERE id = ?', [id]);
    res.json({
      id,
      paymentStatus: mapPaymentStatus(updated),
      includeInSaldo: mapIncludeInSaldo(updated)
    });
  } catch (error) {
    console.error('patchOrderPaymentStatus:', error);
    res.status(500).json({ message: 'Error actualizando estado de cobro' });
  }
};

/**
 * Aplica el descuento de stock del pedido mayorista de una (idempotente).
 * Si el pedido está en Borrador, pasa a Confirmado y luego desconta (mismo criterio que al confirmar).
 */
export const applyMayoristaStockDeduction = async (req: any, res: any) => {
  const { id } = req.params;
  const user = req.user;
  if (!user || !['ADMIN', 'SELLER', 'WAREHOUSE', 'DEPOSITO'].includes(user.role)) {
    return res.status(403).json({ message: 'Sin permiso' });
  }
  if (!id) return res.status(400).json({ message: 'ID inválido' });
  try {
    const order = await get(
      'SELECT id, status, no_stock_impact, customer_id FROM orders WHERE id = ?',
      [id]
    );
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' });
    if (user.role === 'SELLER') {
      const cust = order.customer_id
        ? await get('SELECT seller_id FROM customers WHERE id = ?', [order.customer_id])
        : null;
      if (cust?.seller_id && cust.seller_id !== user.id) {
        return res.status(403).json({ message: 'Solo podés modificar pedidos de tus clientes' });
      }
    }
    if (order.no_stock_impact) {
      return res.status(400).json({ message: 'Este pedido está marcado sin impacto en stock.' });
    }
    if (order.status === 'Cancelado') {
      return res.status(400).json({ message: 'No aplica a pedidos cancelados.' });
    }
    if (await isMayoristaStockDeductedForWholesale(id)) {
      return res.json({
        id,
        alreadyApplied: true,
        message: 'El stock de este pedido ya estaba descontado.',
      });
    }
    if (order.status === 'Borrador') {
      await execute("UPDATE orders SET status = 'Confirmado' WHERE id = ?", [id]);
    }
    const result = await deductStockForOrder(id);
    if (!result.success) {
      return res.status(500).json({
        message: 'Error al descontar stock: ' + (result.errors?.join(', ') || 'desconocido'),
        errors: result.errors
      });
    }
    res.json({ id, success: true, message: 'Stock descontado correctamente.' });
  } catch (error: any) {
    console.error('applyMayoristaStockDeduction:', error);
    res.status(500).json({ message: error?.message || 'Error al descontar stock' });
  }
};

/**
 * Devuelve al inventario el stock descontado por este pedido, sin cancelarlo ni modificar su estado.
 */
export const restoreMayoristaStockDeduction = async (req: any, res: any) => {
  const { id } = req.params;
  const user = req.user;
  if (!user || !['ADMIN', 'SELLER', 'WAREHOUSE', 'DEPOSITO'].includes(user.role)) {
    return res.status(403).json({ message: 'Sin permiso' });
  }
  if (!id) return res.status(400).json({ message: 'ID inválido' });
  try {
    const order = await get(
      'SELECT id, status, no_stock_impact, customer_id FROM orders WHERE id = ?',
      [id]
    );
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' });
    if (user.role === 'SELLER') {
      const cust = order.customer_id
        ? await get('SELECT seller_id FROM customers WHERE id = ?', [order.customer_id])
        : null;
      if (cust?.seller_id && cust.seller_id !== user.id) {
        return res.status(403).json({ message: 'Solo podés modificar pedidos de tus clientes' });
      }
    }
    if (order.no_stock_impact) {
      return res.status(400).json({ message: 'Este pedido está marcado sin impacto en stock.' });
    }
    if (order.status === 'Cancelado') {
      return res.status(400).json({ message: 'No aplica a pedidos cancelados.' });
    }
    if (!(await isMayoristaStockDeductedForWholesale(id))) {
      return res.status(400).json({ message: 'Este pedido no tiene stock descontado en inventario.' });
    }
    if (await isWholesaleStockRestoredForOrder(id)) {
      return res.json({
        id,
        alreadyRestored: true,
        message: 'El stock de este pedido ya fue restaurado.',
      });
    }
    const result = await restoreStockForOrder(id, wholesaleOrderStockManualRestoreReference(id));
    if (!result.success) {
      return res.status(500).json({
        message: 'Error al restaurar stock: ' + (result.errors?.join(', ') || 'desconocido'),
        errors: result.errors,
      });
    }
    res.json({ id, success: true, message: 'Stock restaurado al inventario. El pedido no fue modificado.' });
  } catch (error: any) {
    console.error('restoreMayoristaStockDeduction:', error);
    res.status(500).json({ message: error?.message || 'Error al restaurar stock' });
  }
};

/** Archiva o desarchiva un pedido (ocultar/mostrar en lista). */
export const archiveOrder = async (req: any, res: any) => {
  const { id } = req.params;
  const archived = req.body?.archived === true || req.body?.archived === 1;
  if (!id) return res.status(400).json({ message: "ID de pedido inválido" });
  try {
    const row = await get("SELECT id FROM orders WHERE id = ?", [id]);
    if (!row) return res.status(404).json({ message: "Pedido no encontrado" });
    await execute("UPDATE orders SET archived = ? WHERE id = ?", [archived ? 1 : 0, id]);
    res.json({ id, archived });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error actualizando archivado del pedido" });
  }
};

export const deleteOrder = async (req: any, res: any) => {
  const { id } = req.params;
  const user = req.user;
  if (!user) return res.status(401).json({ message: 'Tenés que iniciar sesión' });
  if (!['ADMIN', 'WAREHOUSE', 'DEPOSITO', 'SELLER'].includes(user.role)) {
    return res.status(403).json({ message: 'Sin permiso para eliminar pedidos' });
  }
  if (!id) return res.status(400).json({ message: "ID inválido" });
  try {
    if (user.role === 'SELLER') {
      const ord = await get('SELECT seller_id, status FROM orders WHERE id = ?', [id]);
      if (!ord) return res.status(404).json({ message: 'Pedido no encontrado' });
      if (String(ord.seller_id || '') !== String(user.id)) {
        return res.status(403).json({ message: 'Solo podés eliminar pedidos asignados a vos' });
      }
      if (String(ord.status || '') !== 'Borrador') {
        return res.status(400).json({ message: 'Solo podés eliminar pedidos en borrador' });
      }
    }
    const hasInvoice = await get("SELECT id FROM invoices WHERE order_id = ?", [id]);
    if (hasInvoice) {
      return res.status(400).json({
        message: "No se puede eliminar un pedido que tiene factura emitida. La factura sigue vigente en AFIP. Para anular el efecto fiscal emití una nota de crédito."
      });
    }
    const currentOrder = await get("SELECT status, no_stock_impact FROM orders WHERE id = ?", [id]);
    const hadStockDeducted =
      !currentOrder?.no_stock_impact &&
      (await isMayoristaStockDeductedForWholesale(id));
    if (hadStockDeducted && !(await isWholesaleStockRestoredForOrder(id))) {
      const { restoreStockForOrder } = await import('./stock.controller');
      const result = await restoreStockForOrder(id);
      if (!result.success) {
        console.error('Errores restaurando stock al eliminar pedido:', result.errors);
        return res.status(500).json({ message: 'Error restaurando stock: ' + (result.errors?.join(', ') || 'desconocido') });
      }
    }
    await execute("DELETE FROM orders WHERE id = ?", [id]);
    res.json({ id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error eliminando pedido" });
  }
};

/**
 * Recalcula la percepción IIBB (padrón AGIP) y la guarda en `invoices` para un pedido **ya facturado**.
 * Sirve para corregir el PDF interno cuando la factura salió con AGIP en cero (p. ej. bug de fecha).
 *
 * **No modifica el comprobante en AFIP** (el CAE y el total registrado en ARCA no cambian).
 */
export const recalculateStoredInvoiceAgip = async (req: any, res: any) => {
  const { id } = req.params;
  const user = req.user;
  if (!user || (user.role !== 'ADMIN' && user.role !== 'WAREHOUSE' && user.role !== 'DEPOSITO')) {
    return res.status(403).json({ message: 'Solo ADMIN o Depósito pueden actualizar la percepción IIBB' });
  }
  if (!id) return res.status(400).json({ message: 'ID de pedido inválido' });
  try {
    const invRow = await get('SELECT id FROM invoices WHERE order_id = ?', [id]);
    if (!invRow) return res.status(404).json({ message: 'Este pedido no tiene factura guardada en el sistema' });

    const orderRow = await get(
      'SELECT id, customer_id, date, total FROM orders WHERE id = ?',
      [id]
    );
    if (!orderRow) return res.status(404).json({ message: 'Pedido no encontrado' });

    const customerRow = await get('SELECT cuit FROM customers WHERE id = ?', [orderRow.customer_id]);
    const netFromItems = await getOrderNetFromLineItems(id);
    const netAmount = netFromItems > 0 ? netFromItems : Number(orderRow.total || 0);

    const agip = await getAgipRetentionForOrder({
      orderDate: orderRow.date,
      customerCuit: customerRow?.cuit,
      netAmount
    });

    if (!agip || !(agip.amount > 0.005)) {
      return res.status(400).json({
        message:
          'No hay percepción IIBB calculable (CUIT del cliente incompleto, sin alícuota en el padrón AGIP del mes del pedido, o importe redondeado a cero).'
      });
    }

    await execute(
      `UPDATE invoices SET agip_alicuota = ?, agip_ret_per = ? WHERE order_id = ?`,
      [agip.alicuota, agip.amount, id]
    );

    res.json({
      orderId: id,
      agipAlicuota: agip.alicuota,
      agipRetPer: agip.amount,
      message:
        'Percepción IIBB guardada. Volvé a abrir el PDF de la factura. El CAE en AFIP no se modifica; si necesitás registrar el tributo en ARCA, consultá a tu contador (p. ej. nota de débito u otro esquema).'
    });
  } catch (error: any) {
    console.error('recalculateStoredInvoiceAgip:', error);
    res.status(500).json({ message: 'Error actualizando percepción IIBB', detail: error?.message });
  }
};

/**
 * Anula la factura actual en AFIP con una **NC total** solo con neto + IVA (sin percepción IIBB en la NC; sin tocar stock)
 * y emite una **nueva factura** con percepción IIBB informada en WSFE. Actualiza la fila `invoices` con el nuevo CAE.
 *
 * Requisitos: el pedido tiene factura, **no** tiene notas de crédito previas, y el padrón AGIP
 * devuelve percepción > 0 para el neto del pedido.
 */
export const reemitirFacturaConAgip = async (req: any, res: any) => {
  const { id } = req.params;
  const user = req.user;
  if (!user || (user.role !== 'ADMIN' && user.role !== 'WAREHOUSE' && user.role !== 'DEPOSITO')) {
    return res.status(403).json({ message: 'Solo ADMIN o Depósito pueden reemitir la factura con IIBB' });
  }
  if (!id) return res.status(400).json({ message: 'ID de pedido inválido' });

  try {
    const invRow = await get(
      `SELECT id, order_id, punto_venta, cbte_tipo, cbte_desde, cae, agip_alicuota, agip_ret_per FROM invoices WHERE order_id = ?`,
      [id]
    );
    if (!invRow) {
      return res.status(400).json({ message: 'Este pedido no tiene factura emitida.' });
    }

    const cnCountRow = await get(
      `SELECT COUNT(*) AS c FROM credit_notes WHERE order_id = ?`,
      [id]
    );
    if (Number((cnCountRow as any)?.c || 0) > 0) {
      return res.status(400).json({
        message:
          'No se puede reemitir: el pedido ya tiene notas de crédito. Si necesitás corregir la facturación, coordiná con el contador o emití manualmente en AFIP.'
      });
    }

    const orderRow = await get(
      'SELECT id, customer_id, date, total, no_stock_impact FROM orders WHERE id = ?',
      [id]
    );
    if (!orderRow) return res.status(404).json({ message: 'Pedido no encontrado' });

    const customerRow = await get(
      'SELECT id, business_name, cuit, condicion_iva FROM customers WHERE id = ?',
      [orderRow.customer_id]
    );
    if (!customerRow) return res.status(400).json({ message: 'Cliente del pedido no encontrado' });

    const netFromItems = await getOrderNetFromLineItems(id);
    const totalForAfip = netFromItems > 0 ? netFromItems : Number(orderRow.total) || 0;
    if (totalForAfip <= 0) {
      return res.status(400).json({ message: 'El neto del pedido debe ser mayor a 0 para reemitir.' });
    }

    const agip = await getAgipRetentionForOrder({
      orderDate: orderRow.date,
      customerCuit: customerRow.cuit,
      netAmount: totalForAfip
    });
    if (!agip || !(agip.amount > 0.005)) {
      const orderPeriod = agipPeriodYyyymmFromOrderDate(orderRow.date);
      return res.status(400).json({
        message:
          `No hay percepción IIBB calculable para reemitir (CUIT incompleto o sin alícuota en padrón AGIP${orderPeriod ? ` para ${orderPeriod}` : ''}). Cargá el padrón del mes o usá “Guardar IIBB” si solo querés actualizar el PDF sin nuevo CAE.`
      });
    }

    const cbteTipoFromBody = req.body?.cbteTipo;
    const forceCbteTipo =
      cbteTipoFromBody === 1 || cbteTipoFromBody === 6 ? (cbteTipoFromBody as 1 | 6) : undefined;

    const { emitirNotaCredito: emitirNCAfip, emitirFactura: emitirAfip } = await import('../services/afip.service');

    // NC total de reemisión: solo neto + IVA en AFIP (sin percepción IIBB). El IIBB se informa en la factura nueva.
    const ncResult = await emitirNCAfip(
      {
        puntoVta: invRow.punto_venta,
        cbteTipo: invRow.cbte_tipo,
        cbteDesde: invRow.cbte_desde
      },
      {
        id: customerRow.id,
        businessName: customerRow.business_name ?? '',
        cuit: customerRow.cuit,
        condicionIva: customerRow.condicion_iva ?? undefined
      },
      totalForAfip,
      undefined
    );

    const creditNoteId = uuidv4();
    await execute(
      `INSERT INTO credit_notes (id, order_id, invoice_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, amount_credited, scope, item_index,
        voided_invoice_cae, voided_invoice_punto_venta, voided_invoice_cbte_tipo, voided_invoice_cbte_desde, superseded_by_reinvoice)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        creditNoteId,
        id,
        invRow.id,
        ncResult.cae,
        ncResult.caeFchVto || null,
        ncResult.puntoVta,
        ncResult.cbteTipo,
        ncResult.cbteDesde,
        ncResult.cbteHasta,
        totalForAfip,
        'total',
        null,
        invRow.cae,
        invRow.punto_venta,
        invRow.cbte_tipo,
        invRow.cbte_desde,
        0,
      ]
    );

    const iibbPercepcion = {
      baseImp: totalForAfip,
      alicuota: agip.alicuota,
      importe: agip.amount
    };

    try {
      const faResult = await emitirAfip(
        {
          id: orderRow.id,
          date: orderRow.date,
          total: totalForAfip,
          customerId: orderRow.customer_id,
          iibbPercepcion
        },
        {
          id: customerRow.id,
          businessName: customerRow.business_name ?? '',
          cuit: customerRow.cuit,
          condicionIva: customerRow.condicion_iva ?? null
        },
        forceCbteTipo
      );

      const { nowMysqlArgentina } = await import('../utils/argentinaDate');
      await execute(
        `UPDATE invoices SET cae = ?, cae_fch_vto = ?, punto_venta = ?, cbte_tipo = ?, cbte_desde = ?, cbte_hasta = ?, agip_alicuota = ?, agip_ret_per = ?, created_at = ?
         WHERE order_id = ?`,
        [
          faResult.cae,
          faResult.caeFchVto || null,
          faResult.puntoVta,
          faResult.cbteTipo,
          faResult.cbteDesde,
          faResult.cbteHasta,
          agip.alicuota,
          agip.amount,
          nowMysqlArgentina(),
          id
        ]
      );

      await execute(`UPDATE credit_notes SET superseded_by_reinvoice = 1 WHERE id = ?`, [creditNoteId]);

      await syncOrderPaymentStatus(id);
      await syncAllOrderPaymentStatusForCustomer(String(orderRow.customer_id));

      const padronHint =
        agip.periodUsed && agipPeriodYyyymmFromOrderDate(orderRow.date) !== agip.periodUsed
          ? ` (padrón AGIP ${agip.periodUsed})`
          : '';
      res.status(201).json({
        message:
          `Se emitió nota de crédito total (neto + IVA, sin IIBB en la NC) y una nueva factura con percepción IIBB${padronHint}. El stock del pedido no se modificó.`,
        creditNote: {
          id: creditNoteId,
          orderId: id,
          cae: ncResult.cae,
          caeFchVto: ncResult.caeFchVto,
          puntoVta: ncResult.puntoVta,
          cbteTipo: ncResult.cbteTipo,
          cbteDesde: ncResult.cbteDesde,
          cbteHasta: ncResult.cbteHasta,
          amountCredited: totalForAfip
        },
        invoice: {
          id: invRow.id,
          orderId: id,
          cae: faResult.cae,
          caeFchVto: faResult.caeFchVto,
          puntoVta: faResult.puntoVta,
          cbteTipo: faResult.cbteTipo,
          cbteDesde: faResult.cbteDesde,
          cbteHasta: faResult.cbteHasta,
          agipAlicuota: agip.alicuota,
          agipRetPer: agip.amount
        }
      });
    } catch (faErr: any) {
      console.error('reemitirFacturaConAgip: nueva factura falló tras NC:', faErr);
      res.status(500).json({
        message:
          'Se emitió la nota de crédito en AFIP pero falló la nueva factura. Completá la factura en AFIP con percepción IIBB y actualizá manualmente la fila en `invoices`, o contactá soporte con el CAE de la NC.',
        creditNoteEmitted: true,
        creditNote: {
          id: creditNoteId,
          cae: ncResult.cae,
          puntoVta: ncResult.puntoVta,
          cbteTipo: ncResult.cbteTipo,
          cbteDesde: ncResult.cbteDesde,
          cbteHasta: ncResult.cbteHasta
        },
        detail: faErr?.message || String(faErr)
      });
    }
  } catch (error: any) {
    console.error('reemitirFacturaConAgip:', error);
    const msg = error?.message || 'Error reemitiendo factura con IIBB';
    const { afipEmitHttpStatusFromMessage } = await import('../services/afip.service');
    res.status(afipEmitHttpStatusFromMessage(msg)).json({ message: msg });
  }
};

/** Obtiene la factura AFIP asociada a un pedido (si existe). */
export const getOrderInvoice = async (req: any, res: any) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ message: 'ID de pedido inválido' });
  try {
    const inv = await get(
      `SELECT i.id, i.order_id, i.cae, i.cae_fch_vto, i.punto_venta, i.cbte_tipo, i.cbte_desde, i.cbte_hasta, i.created_at,
              i.agip_alicuota, i.agip_ret_per,
              o.total AS order_total, o.date AS order_date, c.cuit AS customer_cuit
       FROM invoices i
       JOIN orders o ON o.id = i.order_id
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE i.order_id = ?`,
      [id]
    );
    if (!inv) return res.status(404).json({ message: 'Este pedido no tiene factura emitida' });
    const hasStoredAgip = Number(inv.agip_alicuota || 0) > 0 || Number(inv.agip_ret_per || 0) > 0;
    let agip = { alicuota: Number(inv.agip_alicuota || 0), amount: Number(inv.agip_ret_per || 0) };
    if (!hasStoredAgip) {
      const netFromItems = await getOrderNetFromLineItems(id);
      const netAmount = netFromItems > 0 ? netFromItems : Number(inv.order_total || 0);
      const calc = await getAgipRetentionForOrder({
        orderDate: inv.order_date || inv.created_at || '',
        customerCuit: inv.customer_cuit,
        netAmount
      });
      agip = { alicuota: calc?.alicuota ?? 0, amount: calc?.amount ?? 0 };
    }
    res.json({
      id: inv.id,
      orderId: inv.order_id,
      cae: inv.cae,
      caeFchVto: inv.cae_fch_vto ?? undefined,
      puntoVta: inv.punto_venta,
      cbteTipo: inv.cbte_tipo,
      cbteDesde: inv.cbte_desde,
      cbteHasta: inv.cbte_hasta,
      createdAt: inv.created_at,
      agipAlicuota: agip.alicuota,
      agipRetPer: agip.amount
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error obteniendo factura' });
  }
};

/** Emite factura electrónica AFIP para un pedido. Solo ADMIN o WAREHOUSE. */
export const emitirFactura = async (req: any, res: any) => {
  const { id } = req.params;
  const user = req.user;
  if (!user || (user.role !== 'ADMIN' && user.role !== 'WAREHOUSE' && user.role !== 'DEPOSITO')) {
    return res.status(403).json({ message: 'Solo ADMIN o Depósito pueden emitir facturas' });
  }
  if (!id) return res.status(400).json({ message: 'ID de pedido inválido' });
  try {
    const orderRow = await get(
      'SELECT id, customer_id, date, total, no_stock_impact, status FROM orders WHERE id = ?',
      [id]
    );
    if (!orderRow) return res.status(404).json({ message: 'Pedido no encontrado' });
    const wantsNoStockImpact = req.body?.noStockImpact === true || req.body?.no_stock_impact === 1;
    if (wantsNoStockImpact) {
      return res.status(400).json({
        message:
          'Ya no se puede facturar sin picking. Completá el picking, pasá el pedido a control y emití la factura desde ahí.',
      });
    }
    const existingInv = await get('SELECT id FROM invoices WHERE order_id = ?', [id]);
    if (existingInv) return res.status(409).json({ message: 'Este pedido ya tiene una factura emitida', invoiceId: existingInv.id });

    const customerRow = await get(
      'SELECT id, business_name, cuit, condicion_iva FROM customers WHERE id = ?',
      [orderRow.customer_id]
    );
    if (!customerRow) return res.status(400).json({ message: 'Cliente del pedido no encontrado' });

    const cbteTipoFromBody = req.body?.cbteTipo;
    const forceCbteTipo = (cbteTipoFromBody === 1 || cbteTipoFromBody === 6) ? (cbteTipoFromBody as 1 | 6) : undefined;

    const netFromItems = await getOrderNetFromLineItems(id);
    if (!PICKING_DONE_STATUSES_AFIP.has(String(orderRow.status || ''))) {
      return res.status(400).json({
        message:
          'Completá el picking y pasá el pedido a «Falta controlar» (o controlado / despachado) antes de emitir la factura AFIP. Solo se factura lo indicado en picking.',
      });
    }
    if (!(netFromItems > 0.005)) {
      return res.status(400).json({
        message:
          'El importe neto a facturar es cero. Revisá las cantidades en picking: debe haber al menos una unidad pickeada con precio.',
      });
    }
    const { orderGrossToAfipNeto, ORDER_PRICES_INCLUDE_IVA } = await import('../config/orderPricing');
    const grossFromItems = netFromItems > 0 ? netFromItems : Number(orderRow.total);
    const totalForAfip = orderGrossToAfipNeto(grossFromItems);

    const agip = await getAgipRetentionForOrder({
      orderDate: orderRow.date,
      customerCuit: customerRow.cuit,
      netAmount: totalForAfip
    });
    const iibbPercepcion =
      agip && agip.amount > 0.005
        ? { baseImp: totalForAfip, alicuota: agip.alicuota, importe: agip.amount }
        : undefined;

    const routeTimeoutMs = Math.min(
      115_000,
      Math.max(60_000, parseInt(process.env.AFIP_ROUTE_TIMEOUT_MS || '110000', 10) || 110_000)
    );
    const timeoutMsg =
      'La emisión en AFIP está tardando más de lo habitual (ARCA congestionado). No pulses de nuevo de inmediato: si el pedido aún no tiene factura en LupoHub, esperá 1–2 minutos y verificá en AFIP antes de reintentar.';

    let work = emitFacturaInFlight.get(id);
    if (!work) {
      work = (async () => {
        const { emitirFactura: emitirAfip } = await import('../services/afip.service');
        const result = await emitirAfip(
          {
            id: orderRow.id,
            date: orderRow.date,
            total: totalForAfip,
            customerId: orderRow.customer_id,
            iibbPercepcion: iibbPercepcion ?? null
          },
          {
            id: customerRow.id,
            businessName: customerRow.business_name ?? '',
            cuit: customerRow.cuit,
            condicionIva: customerRow.condicion_iva ?? null
          },
          forceCbteTipo
        );
        const invCheck = await get('SELECT id FROM invoices WHERE order_id = ?', [id]);
        if (invCheck) {
          throw Object.assign(new Error('Este pedido ya tiene una factura emitida'), { status: 409 });
        }
        const invoiceId = uuidv4();
        await execute(
          `INSERT INTO invoices (id, order_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, agip_alicuota, agip_ret_per)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            invoiceId,
            id,
            result.cae,
            result.caeFchVto || null,
            result.puntoVta,
            result.cbteTipo,
            result.cbteDesde,
            result.cbteHasta,
            agip?.alicuota ?? 0,
            agip?.amount ?? 0
          ]
        );
        await execute('UPDATE orders SET total = ? WHERE id = ?', [
          ORDER_PRICES_INCLUDE_IVA ? grossFromItems : totalForAfip,
          id
        ]);
        await syncOrderPaymentStatus(id);
        await syncAllOrderPaymentStatusForCustomer(String(orderRow.customer_id));
        return {
          id: invoiceId,
          orderId: id,
          cae: result.cae,
          caeFchVto: result.caeFchVto,
          puntoVta: result.puntoVta,
          cbteTipo: result.cbteTipo,
          cbteDesde: result.cbteDesde,
          cbteHasta: result.cbteHasta,
          agipAlicuota: agip?.alicuota ?? 0,
          agipRetPer: agip?.amount ?? 0
        };
      })();
      emitFacturaInFlight.set(id, work);
      work.finally(() => {
        if (emitFacturaInFlight.get(id) === work) emitFacturaInFlight.delete(id);
      });
    }

    const { withRequestTimeout } = await import('../utils/requestTimeout');
    const payload = await withRequestTimeout(routeTimeoutMs, () => work!, timeoutMsg);
    res.status(201).json(payload);
  } catch (error: any) {
    console.error('emitirFactura:', error);
    const msg = error?.message || 'Error emitiendo factura AFIP';
    const { afipEmitHttpStatusFromMessage } = await import('../services/afip.service');
    const status =
      error?.status === 409
        ? 409
        : error?.status === 504 || error?.code === 'REQUEST_TIMEOUT'
          ? 504
          : afipEmitHttpStatusFromMessage(msg);
    res.status(status).json({ message: msg });
  }
};

/** Lista las notas de crédito emitidas para un pedido.
 *  Una misma NC AFIP puede haberse guardado como N filas (una por ítem creditado),
 *  todas con el mismo (cae, punto_venta, cbte_tipo, cbte_desde, cbte_hasta).
 *  Devolvemos UNA entrada por comprobante, consolidando el detalle por ítem
 *  para que el PDF muestre todos los renglones (no solo el primero).
 */
export const getOrderCreditNotes = async (req: any, res: any) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ message: 'ID de pedido inválido' });
  try {
    const rows = (await query(
      `SELECT id, order_id, invoice_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, amount_credited, scope, item_index, created_at,
              voided_invoice_cae, voided_invoice_punto_venta, voided_invoice_cbte_tipo, voided_invoice_cbte_desde,
              COALESCE(superseded_by_reinvoice, 0) AS superseded_by_reinvoice
       FROM credit_notes WHERE order_id = ? ORDER BY created_at DESC, id ASC`,
      [id]
    )) as any[];

    // Necesitamos los precios de los ítems para inferir cantidades por línea.
    const itemRows = (await query(
      `SELECT quantity, price_at_moment FROM order_items WHERE order_id = ? ORDER BY id ASC`,
      [id]
    )) as { quantity: number; price_at_moment: string }[];
    const itemPriceByIndex = new Map<number, number>();
    itemRows.forEach((it, idx) => itemPriceByIndex.set(idx, Number(it.price_at_moment) || 0));

    type Grouped = {
      id: string;
      orderId: string;
      invoiceId: string | null;
      cae: string;
      caeFchVto?: string;
      puntoVta: number;
      cbteTipo: number;
      cbteDesde: number;
      cbteHasta: number;
      amountCredited: number;
      scope: 'total' | 'item';
      itemIndex?: number;
      itemIndexes: number[];
      amountByItemIndex: Record<number, number>;
      quantityByItemIndex: Record<number, number>;
      createdAt: string | null;
      voidedInvoice?: {
        cae: string;
        puntoVta?: number;
        cbteTipo?: number;
        cbteDesde: number;
      };
      supersededByReinvoice?: boolean;
    };

    const groups = new Map<string, Grouped>();
    for (const r of rows) {
      const key = `${r.cae ?? ''}|${r.punto_venta ?? ''}|${r.cbte_tipo ?? ''}|${r.cbte_desde ?? ''}|${r.cbte_hasta ?? ''}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          id: r.id,
          orderId: r.order_id,
          invoiceId: r.invoice_id ?? null,
          cae: r.cae,
          caeFchVto: r.cae_fch_vto ?? undefined,
          puntoVta: r.punto_venta,
          cbteTipo: r.cbte_tipo,
          cbteDesde: r.cbte_desde,
          cbteHasta: r.cbte_hasta,
          amountCredited: 0,
          scope: (r.scope ?? 'total') as 'total' | 'item',
          itemIndex: r.item_index ?? undefined,
          itemIndexes: [],
          amountByItemIndex: {},
          quantityByItemIndex: {},
          createdAt: r.created_at ?? null,
          voidedInvoice: r.voided_invoice_cae
            ? {
                cae: String(r.voided_invoice_cae),
                puntoVta:
                  r.voided_invoice_punto_venta != null ? Number(r.voided_invoice_punto_venta) : undefined,
                cbteTipo:
                  r.voided_invoice_cbte_tipo != null ? Number(r.voided_invoice_cbte_tipo) : undefined,
                cbteDesde: Number(r.voided_invoice_cbte_desde),
              }
            : undefined,
          supersededByReinvoice: !!Number(r.superseded_by_reinvoice),
        };
        groups.set(key, g);
      }
      const amount = Number(r.amount_credited || 0);
      g.amountCredited = Math.round((g.amountCredited + amount) * 100) / 100;
      // Si al menos una fila es 'item' o tiene item_index, considerar el grupo como 'item'.
      if ((r.scope ?? 'total') === 'item' || r.item_index != null) {
        g.scope = 'item';
        const idx = Number(r.item_index);
        if (Number.isInteger(idx) && idx >= 0) {
          if (!g.itemIndexes.includes(idx)) g.itemIndexes.push(idx);
          g.amountByItemIndex[idx] = Math.round(((g.amountByItemIndex[idx] || 0) + amount) * 100) / 100;
          const price = itemPriceByIndex.get(idx) || 0;
          if (price > 0) {
            const q = amount / price;
            g.quantityByItemIndex[idx] = Math.round(((g.quantityByItemIndex[idx] || 0) + q) * 1000) / 1000;
          }
        }
      }
    }

    // Ordenar grupos por fecha desc (los más recientes primero).
    const out = Array.from(groups.values()).sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return db - da;
    });
    res.json(out);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error listando notas de crédito' });
  }
};

/** Emite una Nota de Crédito AFIP: todo el pedido o un ítem. Solo ADMIN/WAREHOUSE/DEPOSITO. */
export const emitirNotaCredito = async (req: any, res: any) => {
  const { id } = req.params;
  const user = req.user;
  if (!user || (user.role !== 'ADMIN' && user.role !== 'WAREHOUSE' && user.role !== 'DEPOSITO')) {
    return res.status(403).json({ message: 'Solo ADMIN o Depósito pueden emitir notas de crédito' });
  }
  if (!id) return res.status(400).json({ message: 'ID de pedido inválido' });
  const { tipo, itemIndex, quantity, items, restoreStock: restoreStockRaw } = req.body || {};
  if (!tipo || (tipo !== 'total' && tipo !== 'item' && tipo !== 'items')) {
    return res.status(400).json({ message: 'Body debe incluir tipo: "total", "item" o "items"' });
  }
  const restoreStock =
    restoreStockRaw === false ||
    restoreStockRaw === 0 ||
    restoreStockRaw === '0' ||
    restoreStockRaw === 'false'
      ? false
      : true;

  try {
    const orderRow = await get('SELECT id, customer_id, total FROM orders WHERE id = ?', [id]);
    if (!orderRow) return res.status(404).json({ message: 'Pedido no encontrado' });

    const invRow = await get(
      'SELECT id, punto_venta, cbte_tipo, cbte_desde, cae, agip_alicuota, agip_ret_per FROM invoices WHERE order_id = ?',
      [id]
    );
    if (!invRow) return res.status(400).json({ message: 'Este pedido no tiene factura; primero emití la factura.' });

    const customerRow = await get(
      'SELECT id, business_name, cuit, condicion_iva FROM customers WHERE id = ?',
      [orderRow.customer_id]
    );
    if (!customerRow) return res.status(400).json({ message: 'Cliente del pedido no encontrado' });

    // Validar: si ya existe NC por el total, no se permite ninguna NC más (ni total ni por ítem)
    const existingNCs = await query(
      `SELECT scope, item_index, amount_credited FROM credit_notes WHERE order_id = ?`,
      [id]
    ) as { scope?: string; item_index?: number | null; amount_credited: string }[];

    const yaExisteNCTotal = existingNCs.some(
      (r) => (r.scope || 'total') === 'total'
    );
    if (yaExisteNCTotal) {
      return res.status(400).json({
        message: 'Ya existe una nota de crédito por el total de este pedido. No se pueden emitir más notas de crédito.',
      });
    }

    let amountToCredit: number;
    let creditNoteItemQuantity: number | null = null;
    let itemsToCredit: Array<{ itemIndex: number; quantity: number; amount: number }> = [];

    if (tipo === 'total') {
      amountToCredit = await getOrderNetForCreditNoteTotal(id);
      if (amountToCredit <= 0) return res.status(400).json({ message: 'El total del pedido debe ser mayor a 0.' });
    } else if (tipo === 'item') {
      const itemsRows = await query(
        `SELECT quantity, price_at_moment FROM order_items WHERE order_id = ? ORDER BY id`,
        [id]
      );
      const items = itemsRows as { quantity: number; price_at_moment: string }[];
      if (!items.length) return res.status(400).json({ message: 'El pedido no tiene ítems.' });
      const idx = typeof itemIndex === 'number' ? itemIndex : parseInt(String(itemIndex), 10);
      if (isNaN(idx) || idx < 0 || idx >= items.length) {
        return res.status(400).json({ message: `itemIndex debe ser entre 0 y ${items.length - 1}` });
      }
      const item = items[idx];
      const qty = quantity != null ? (typeof quantity === 'number' ? quantity : parseInt(String(quantity), 10)) : item.quantity;
      if (isNaN(qty) || qty <= 0 || qty > item.quantity) {
        return res.status(400).json({ message: `quantity debe ser entre 1 y ${item.quantity} para este ítem` });
      }
      creditNoteItemQuantity = qty;
      const price = Number(item.price_at_moment) || 0;
      amountToCredit = Math.round(qty * price * 100) / 100;
      if (amountToCredit <= 0) return res.status(400).json({ message: 'El monto a creditar del ítem es 0.' });
      const itemLineTotal = Math.round(Number(item.quantity) * price * 100) / 100;
      const yaCreditadoItem = existingNCs
        .filter((r) => (r.scope || '') === 'item' && r.item_index === idx)
        .reduce((sum, r) => sum + Number(r.amount_credited || 0), 0);
      if (yaCreditadoItem + amountToCredit > itemLineTotal + 0.01) {
        return res.status(400).json({
          message: `No se puede creditar más de lo facturado para este artículo. Ya creditado: $${yaCreditadoItem.toFixed(2)}. Máximo a creditar para este ítem: $${(itemLineTotal - yaCreditadoItem).toFixed(2)}.`,
        });
      }
      itemsToCredit = [{ itemIndex: idx, quantity: qty, amount: amountToCredit }];
    } else {
      const itemsRows = await query(
        `SELECT quantity, price_at_moment FROM order_items WHERE order_id = ? ORDER BY id`,
        [id]
      );
      const orderItems = itemsRows as { quantity: number; price_at_moment: string }[];
      if (!orderItems.length) return res.status(400).json({ message: 'El pedido no tiene ítems.' });
      const rawItems = Array.isArray(items) ? items : [];
      if (rawItems.length === 0) {
        return res.status(400).json({ message: 'Para tipo "items" debés enviar al menos un artículo con su cantidad.' });
      }
      const byIndex = new Map<number, number>();
      for (const it of rawItems) {
        const idx = typeof it?.itemIndex === 'number' ? it.itemIndex : parseInt(String(it?.itemIndex), 10);
        const qty = typeof it?.quantity === 'number' ? it.quantity : parseInt(String(it?.quantity), 10);
        if (isNaN(idx) || idx < 0 || idx >= orderItems.length) {
          return res.status(400).json({ message: `itemIndex inválido en selección múltiple: ${String(it?.itemIndex ?? '')}` });
        }
        if (isNaN(qty) || qty <= 0) {
          return res.status(400).json({ message: `quantity inválida para itemIndex ${idx}. Debe ser mayor a 0.` });
        }
        byIndex.set(idx, (byIndex.get(idx) || 0) + qty);
      }
      itemsToCredit = [];
      for (const [idx, qty] of byIndex.entries()) {
        const item = orderItems[idx];
        if (qty > item.quantity) {
          return res.status(400).json({ message: `quantity debe ser entre 1 y ${item.quantity} para itemIndex ${idx}` });
        }
        const price = Number(item.price_at_moment) || 0;
        const lineAmount = Math.round(qty * price * 100) / 100;
        if (lineAmount <= 0) {
          return res.status(400).json({ message: `El monto a creditar del itemIndex ${idx} es 0.` });
        }
        const itemLineTotal = Math.round(Number(item.quantity) * price * 100) / 100;
        const yaCreditadoItem = existingNCs
          .filter((r) => (r.scope || '') === 'item' && r.item_index === idx)
          .reduce((sum, r) => sum + Number(r.amount_credited || 0), 0);
        if (yaCreditadoItem + lineAmount > itemLineTotal + 0.01) {
          return res.status(400).json({
            message: `No se puede creditar más de lo facturado para el artículo ${idx + 1}. Ya creditado: $${yaCreditadoItem.toFixed(2)}. Máximo a creditar: $${(itemLineTotal - yaCreditadoItem).toFixed(2)}.`,
          });
        }
        itemsToCredit.push({ itemIndex: idx, quantity: qty, amount: lineAmount });
      }
      amountToCredit = Math.round(itemsToCredit.reduce((sum, i) => sum + i.amount, 0) * 100) / 100;
      if (amountToCredit <= 0) {
        return res.status(400).json({ message: 'El monto total a creditar debe ser mayor a 0.' });
      }
    }

    const netFromOrder = await getOrderNetFromLineItems(id);
    const netOrderTotal = netFromOrder > 0 ? netFromOrder : Number(orderRow.total) || 0;
    const iibbNc = iibbPercepcionForOrderCreditNote(
      Number(invRow.agip_alicuota || 0),
      Number(invRow.agip_ret_per || 0),
      amountToCredit,
      netOrderTotal
    );

    const { emitirNotaCredito: emitirNCAfip } = await import('../services/afip.service');
    const result = await emitirNCAfip(
      { puntoVta: invRow.punto_venta, cbteTipo: invRow.cbte_tipo, cbteDesde: invRow.cbte_desde },
      { id: customerRow.id, businessName: customerRow.business_name ?? '', cuit: customerRow.cuit, condicionIva: customerRow.condicion_iva ?? undefined },
      amountToCredit,
      iibbNc
    );

    const scope = tipo === 'items' ? 'item' : tipo;
    const itemIndexVal = tipo === 'item' ? (typeof itemIndex === 'number' ? itemIndex : parseInt(String(itemIndex), 10)) : null;
    const firstCreditNoteId = uuidv4();
    if (tipo === 'items') {
      for (let i = 0; i < itemsToCredit.length; i++) {
        const it = itemsToCredit[i];
        await execute(
          `INSERT INTO credit_notes (id, order_id, invoice_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, amount_credited, scope, item_index,
            voided_invoice_cae, voided_invoice_punto_venta, voided_invoice_cbte_tipo, voided_invoice_cbte_desde, superseded_by_reinvoice)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 0)`,
          [
            i === 0 ? firstCreditNoteId : uuidv4(),
            id,
            invRow.id,
            result.cae,
            result.caeFchVto || null,
            result.puntoVta,
            result.cbteTipo,
            result.cbteDesde,
            result.cbteHasta,
            it.amount,
            'item',
            it.itemIndex,
          ]
        );
      }
    } else {
      if (tipo === 'total') {
        await execute(
          `INSERT INTO credit_notes (id, order_id, invoice_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, amount_credited, scope, item_index,
            voided_invoice_cae, voided_invoice_punto_venta, voided_invoice_cbte_tipo, voided_invoice_cbte_desde, superseded_by_reinvoice)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            firstCreditNoteId,
            id,
            invRow.id,
            result.cae,
            result.caeFchVto || null,
            result.puntoVta,
            result.cbteTipo,
            result.cbteDesde,
            result.cbteHasta,
            amountToCredit,
            scope,
            itemIndexVal,
            invRow.cae,
            invRow.punto_venta,
            invRow.cbte_tipo,
            invRow.cbte_desde,
            0,
          ]
        );
      } else {
        await execute(
          `INSERT INTO credit_notes (id, order_id, invoice_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, amount_credited, scope, item_index,
            voided_invoice_cae, voided_invoice_punto_venta, voided_invoice_cbte_tipo, voided_invoice_cbte_desde, superseded_by_reinvoice)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 0)`,
          [
            firstCreditNoteId,
            id,
            invRow.id,
            result.cae,
            result.caeFchVto || null,
            result.puntoVta,
            result.cbteTipo,
            result.cbteDesde,
            result.cbteHasta,
            amountToCredit,
            scope,
            itemIndexVal,
          ]
        );
      }
    }

    if (restoreStock) {
      if (scope === 'total') {
        const stockResult = await restoreStockForOrder(id);
        if (!stockResult.success) {
          return res.status(500).json({ message: 'Error actualizando stock después de la nota de crédito total', errors: stockResult.errors });
        }
      } else if (tipo === 'item' && typeof itemIndexVal === 'number') {
        const stockResult = await restoreStockForOrderItem(id, itemIndexVal, creditNoteItemQuantity ?? undefined);
        if (!stockResult.success) {
          return res.status(500).json({ message: 'Error actualizando stock después de la nota de crédito parcial', errors: stockResult.errors });
        }
      } else if (tipo === 'items') {
        for (const it of itemsToCredit) {
          const stockResult = await restoreStockForOrderItem(id, it.itemIndex, it.quantity);
          if (!stockResult.success) {
            return res.status(500).json({ message: 'Error actualizando stock después de la nota de crédito parcial múltiple', errors: stockResult.errors });
          }
        }
      }
    }

    res.status(201).json({
      id: firstCreditNoteId,
      orderId: id,
      invoiceId: invRow.id,
      cae: result.cae,
      caeFchVto: result.caeFchVto,
      puntoVta: result.puntoVta,
      cbteTipo: result.cbteTipo,
      cbteDesde: result.cbteDesde,
      cbteHasta: result.cbteHasta,
      amountCredited: amountToCredit,
      stockRestored: restoreStock,
    });
  } catch (error: any) {
    console.error('emitirNotaCredito:', error);
    const msg = error?.message || 'Error emitiendo nota de crédito AFIP';
    const { afipEmitHttpStatusFromMessage } = await import('../services/afip.service');
    res.status(afipEmitHttpStatusFromMessage(msg)).json({ message: msg });
  }
};

/** Lista las notas de débito emitidas para un pedido (agrupadas por comprobante AFIP). */
export const getOrderDebitNotes = async (req: any, res: any) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ message: 'ID de pedido inválido' });
  try {
    const rows = (await query(
      `SELECT id, order_id, invoice_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta,
              amount_debited, agip_alicuota, agip_ret_per, scope, item_index, description, created_at
       FROM debit_notes WHERE order_id = ? ORDER BY created_at DESC, id ASC`,
      [id]
    )) as any[];

    const itemRows = (await query(
      `SELECT quantity, price_at_moment FROM order_items WHERE order_id = ? ORDER BY id ASC`,
      [id]
    )) as { quantity: number; price_at_moment: string }[];
    const itemPriceByIndex = new Map<number, number>();
    itemRows.forEach((it, idx) => itemPriceByIndex.set(idx, Number(it.price_at_moment) || 0));

    type Grouped = {
      id: string;
      orderId: string;
      invoiceId: string | null;
      cae: string;
      caeFchVto?: string;
      puntoVta: number;
      cbteTipo: number;
      cbteDesde: number;
      cbteHasta: number;
      amountDebited: number;
      agipAlicuota?: number;
      agipRetPer?: number;
      scope: string;
      itemIndex?: number;
      itemIndexes: number[];
      amountByItemIndex: Record<number, number>;
      quantityByItemIndex: Record<number, number>;
      description?: string;
      createdAt: string | null;
    };

    const groups = new Map<string, Grouped>();
    for (const r of rows) {
      const key = `${r.cae ?? ''}|${r.punto_venta ?? ''}|${r.cbte_tipo ?? ''}|${r.cbte_desde ?? ''}|${r.cbte_hasta ?? ''}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          id: r.id,
          orderId: r.order_id,
          invoiceId: r.invoice_id ?? null,
          cae: r.cae,
          caeFchVto: r.cae_fch_vto ?? undefined,
          puntoVta: r.punto_venta,
          cbteTipo: r.cbte_tipo,
          cbteDesde: r.cbte_desde,
          cbteHasta: r.cbte_hasta,
          amountDebited: 0,
          agipAlicuota: r.agip_alicuota != null ? Number(r.agip_alicuota) : undefined,
          agipRetPer: r.agip_ret_per != null ? Number(r.agip_ret_per) : undefined,
          scope: r.scope ?? 'total',
          itemIndex: r.item_index ?? undefined,
          itemIndexes: [],
          amountByItemIndex: {},
          quantityByItemIndex: {},
          description: r.description ? String(r.description) : undefined,
          createdAt: r.created_at ?? null,
        };
        groups.set(key, g);
      }
      const amount = Number(r.amount_debited || 0);
      g.amountDebited = Math.round((g.amountDebited + amount) * 100) / 100;
      if ((r.scope ?? 'total') === 'item' || r.item_index != null) {
        g.scope = 'item';
        const idx = Number(r.item_index);
        if (Number.isInteger(idx) && idx >= 0) {
          if (!g.itemIndexes.includes(idx)) g.itemIndexes.push(idx);
          g.amountByItemIndex[idx] = Math.round(((g.amountByItemIndex[idx] || 0) + amount) * 100) / 100;
          const price = itemPriceByIndex.get(idx) || 0;
          if (price > 0) {
            const q = amount / price;
            g.quantityByItemIndex[idx] = Math.round(((g.quantityByItemIndex[idx] || 0) + q) * 1000) / 1000;
          }
        }
      }
    }

    const out = Array.from(groups.values()).sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return db - da;
    });
    res.json(out);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error listando notas de débito' });
  }
};

/** Emite una Nota de Débito AFIP asociada a la factura del pedido. */
export const emitirNotaDebito = async (req: any, res: any) => {
  const { id } = req.params;
  const user = req.user;
  if (!user || (user.role !== 'ADMIN' && user.role !== 'WAREHOUSE' && user.role !== 'DEPOSITO')) {
    return res.status(403).json({ message: 'Solo ADMIN o Depósito pueden emitir notas de débito' });
  }
  if (!id) return res.status(400).json({ message: 'ID de pedido inválido' });
  const { tipo, itemIndex, quantity, items, netAmount, description } = req.body || {};
  if (!tipo || !['iibb', 'monto', 'total', 'item', 'items'].includes(tipo)) {
    return res.status(400).json({
      message: 'Body debe incluir tipo: "iibb", "monto", "total", "item" o "items"',
    });
  }

  try {
    const orderRow = await get('SELECT id, customer_id, total, date FROM orders WHERE id = ?', [id]);
    if (!orderRow) return res.status(404).json({ message: 'Pedido no encontrado' });

    const invRow = await get(
      'SELECT id, punto_venta, cbte_tipo, cbte_desde, cae, agip_alicuota, agip_ret_per FROM invoices WHERE order_id = ?',
      [id]
    );
    if (!invRow) return res.status(400).json({ message: 'Este pedido no tiene factura; primero emití la factura.' });

    const customerRow = await get(
      'SELECT id, business_name, cuit, condicion_iva FROM customers WHERE id = ?',
      [orderRow.customer_id]
    );
    if (!customerRow) return res.status(400).json({ message: 'Cliente del pedido no encontrado' });

    const netFromOrder = await getOrderNetFromLineItems(id);
    const netOrderTotal = netFromOrder > 0 ? netFromOrder : Number(orderRow.total) || 0;

    let amountToDebit = 0;
    let iibbNd: { baseImp: number; alicuota: number; importe: number } | undefined;
    let scope = tipo === 'items' ? 'item' : tipo === 'iibb' ? 'iibb' : tipo === 'monto' ? 'monto' : tipo;
    let itemIndexVal: number | null = null;
    let itemsToDebit: Array<{ itemIndex: number; quantity: number; amount: number }> = [];
    let agipAlicuotaStored: number | null = null;
    let agipRetPerStored: number | null = null;
    const descStored = description != null && String(description).trim() ? String(description).trim().slice(0, 255) : null;

    if (tipo === 'iibb') {
      const invAgip = Number(invRow.agip_ret_per || 0);
      if (invAgip > 0.005) {
        return res.status(400).json({
          message:
            'La factura ya tiene percepción IIBB registrada en AFIP. No hace falta emitir una ND por IIBB.',
        });
      }
      const existingIibbNd = await get(
        `SELECT id FROM debit_notes WHERE order_id = ? AND scope = 'iibb' LIMIT 1`,
        [id]
      );
      if (existingIibbNd) {
        return res.status(400).json({ message: 'Ya existe una nota de débito por percepción IIBB para este pedido.' });
      }
      const agip = await getAgipRetentionForOrder({
        orderDate: orderRow.date,
        customerCuit: customerRow.cuit,
        netAmount: netOrderTotal,
      });
      if (!agip || !(agip.amount > 0.005)) {
        return res.status(400).json({
          message: 'No hay percepción IIBB calculable para este pedido (CUIT incompleto o sin alícuota en padrón AGIP).',
        });
      }
      amountToDebit = 0;
      iibbNd = {
        baseImp: netOrderTotal,
        alicuota: agip.alicuota,
        importe: agip.amount,
      };
      agipAlicuotaStored = agip.alicuota;
      agipRetPerStored = agip.amount;
    } else if (tipo === 'monto') {
      const raw = netAmount != null ? Number(netAmount) : NaN;
      amountToDebit = Math.round((Number.isFinite(raw) ? raw : 0) * 100) / 100;
      if (!(amountToDebit > 0)) {
        return res.status(400).json({ message: 'Para tipo "monto" debés enviar netAmount mayor a 0.' });
      }
      const iibbFromInv = iibbPercepcionForOrderCreditNote(
        Number(invRow.agip_alicuota || 0),
        Number(invRow.agip_ret_per || 0),
        amountToDebit,
        netOrderTotal
      );
      iibbNd = iibbFromInv;
      if (iibbFromInv) {
        agipAlicuotaStored = iibbFromInv.alicuota;
        agipRetPerStored = iibbFromInv.importe;
      }
    } else if (tipo === 'total') {
      amountToDebit = await getOrderNetForCreditNoteTotal(id);
      if (amountToDebit <= 0) return res.status(400).json({ message: 'El total del pedido debe ser mayor a 0.' });
      iibbNd = iibbPercepcionForOrderCreditNote(
        Number(invRow.agip_alicuota || 0),
        Number(invRow.agip_ret_per || 0),
        amountToDebit,
        netOrderTotal
      );
      if (iibbNd) {
        agipAlicuotaStored = iibbNd.alicuota;
        agipRetPerStored = iibbNd.importe;
      }
    } else if (tipo === 'item') {
      const itemsRows = await query(
        `SELECT quantity, price_at_moment FROM order_items WHERE order_id = ? ORDER BY id`,
        [id]
      );
      const orderItems = itemsRows as { quantity: number; price_at_moment: string }[];
      if (!orderItems.length) return res.status(400).json({ message: 'El pedido no tiene ítems.' });
      const idx = typeof itemIndex === 'number' ? itemIndex : parseInt(String(itemIndex), 10);
      if (isNaN(idx) || idx < 0 || idx >= orderItems.length) {
        return res.status(400).json({ message: `itemIndex debe ser entre 0 y ${orderItems.length - 1}` });
      }
      const item = orderItems[idx];
      const qty = quantity != null ? (typeof quantity === 'number' ? quantity : parseInt(String(quantity), 10)) : item.quantity;
      if (isNaN(qty) || qty <= 0 || qty > item.quantity) {
        return res.status(400).json({ message: `quantity debe ser entre 1 y ${item.quantity} para este ítem` });
      }
      const price = Number(item.price_at_moment) || 0;
      amountToDebit = Math.round(qty * price * 100) / 100;
      if (amountToDebit <= 0) return res.status(400).json({ message: 'El monto a debitar del ítem es 0.' });
      itemIndexVal = idx;
      itemsToDebit = [{ itemIndex: idx, quantity: qty, amount: amountToDebit }];
      iibbNd = iibbPercepcionForOrderCreditNote(
        Number(invRow.agip_alicuota || 0),
        Number(invRow.agip_ret_per || 0),
        amountToDebit,
        netOrderTotal
      );
      if (iibbNd) {
        agipAlicuotaStored = iibbNd.alicuota;
        agipRetPerStored = iibbNd.importe;
      }
    } else {
      const itemsRows = await query(
        `SELECT quantity, price_at_moment FROM order_items WHERE order_id = ? ORDER BY id`,
        [id]
      );
      const orderItems = itemsRows as { quantity: number; price_at_moment: string }[];
      if (!orderItems.length) return res.status(400).json({ message: 'El pedido no tiene ítems.' });
      const rawItems = Array.isArray(items) ? items : [];
      if (rawItems.length === 0) {
        return res.status(400).json({ message: 'Para tipo "items" debés enviar al menos un artículo con su cantidad.' });
      }
      const byIndex = new Map<number, number>();
      for (const it of rawItems) {
        const idx = typeof it?.itemIndex === 'number' ? it.itemIndex : parseInt(String(it?.itemIndex), 10);
        const qty = typeof it?.quantity === 'number' ? it.quantity : parseInt(String(it?.quantity), 10);
        if (isNaN(idx) || idx < 0 || idx >= orderItems.length) {
          return res.status(400).json({ message: `itemIndex inválido en selección múltiple: ${String(it?.itemIndex ?? '')}` });
        }
        if (isNaN(qty) || qty <= 0) {
          return res.status(400).json({ message: `quantity inválida para itemIndex ${idx}. Debe ser mayor a 0.` });
        }
        byIndex.set(idx, (byIndex.get(idx) || 0) + qty);
      }
      for (const [idx, qty] of byIndex.entries()) {
        const item = orderItems[idx];
        if (qty > item.quantity) {
          return res.status(400).json({ message: `quantity debe ser entre 1 y ${item.quantity} para itemIndex ${idx}` });
        }
        const price = Number(item.price_at_moment) || 0;
        const lineAmount = Math.round(qty * price * 100) / 100;
        if (lineAmount <= 0) {
          return res.status(400).json({ message: `El monto a debitar del itemIndex ${idx} es 0.` });
        }
        itemsToDebit.push({ itemIndex: idx, quantity: qty, amount: lineAmount });
      }
      amountToDebit = Math.round(itemsToDebit.reduce((sum, i) => sum + i.amount, 0) * 100) / 100;
      if (amountToDebit <= 0) {
        return res.status(400).json({ message: 'El monto total a debitar debe ser mayor a 0.' });
      }
      iibbNd = iibbPercepcionForOrderCreditNote(
        Number(invRow.agip_alicuota || 0),
        Number(invRow.agip_ret_per || 0),
        amountToDebit,
        netOrderTotal
      );
      if (iibbNd) {
        agipAlicuotaStored = iibbNd.alicuota;
        agipRetPerStored = iibbNd.importe;
      }
    }

    const { emitirNotaDebito: emitirNDAfip } = await import('../services/afip.service');
    const result = await emitirNDAfip(
      { puntoVta: invRow.punto_venta, cbteTipo: invRow.cbte_tipo, cbteDesde: invRow.cbte_desde },
      {
        id: customerRow.id,
        businessName: customerRow.business_name ?? '',
        cuit: customerRow.cuit,
        condicionIva: customerRow.condicion_iva ?? undefined,
      },
      amountToDebit,
      iibbNd
    );

    const firstDebitNoteId = uuidv4();
    if (tipo === 'items') {
      for (let i = 0; i < itemsToDebit.length; i++) {
        const it = itemsToDebit[i];
        await execute(
          `INSERT INTO debit_notes (id, order_id, invoice_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta,
            amount_debited, agip_alicuota, agip_ret_per, scope, item_index, description)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            i === 0 ? firstDebitNoteId : uuidv4(),
            id,
            invRow.id,
            result.cae,
            result.caeFchVto || null,
            result.puntoVta,
            result.cbteTipo,
            result.cbteDesde,
            result.cbteHasta,
            it.amount,
            i === 0 ? agipAlicuotaStored : null,
            i === 0 ? agipRetPerStored : null,
            'item',
            it.itemIndex,
            descStored,
          ]
        );
      }
    } else {
      await execute(
        `INSERT INTO debit_notes (id, order_id, invoice_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta,
          amount_debited, agip_alicuota, agip_ret_per, scope, item_index, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          firstDebitNoteId,
          id,
          invRow.id,
          result.cae,
          result.caeFchVto || null,
          result.puntoVta,
          result.cbteTipo,
          result.cbteDesde,
          result.cbteHasta,
          amountToDebit,
          agipAlicuotaStored,
          agipRetPerStored,
          scope,
          itemIndexVal,
          descStored,
        ]
      );
    }

    if (tipo === 'iibb' && agipAlicuotaStored != null && agipRetPerStored != null) {
      await execute(`UPDATE invoices SET agip_alicuota = ?, agip_ret_per = ? WHERE order_id = ?`, [
        agipAlicuotaStored,
        agipRetPerStored,
        id,
      ]);
    }

    res.status(201).json({
      id: firstDebitNoteId,
      orderId: id,
      invoiceId: invRow.id,
      cae: result.cae,
      caeFchVto: result.caeFchVto,
      puntoVta: result.puntoVta,
      cbteTipo: result.cbteTipo,
      cbteDesde: result.cbteDesde,
      cbteHasta: result.cbteHasta,
      amountDebited: amountToDebit,
      agipRetPer: agipRetPerStored ?? undefined,
      scope,
    });
  } catch (error: any) {
    console.error('emitirNotaDebito:', error);
    const msg = error?.message || 'Error emitiendo nota de débito AFIP';
    const { afipEmitHttpStatusFromMessage } = await import('../services/afip.service');
    res.status(afipEmitHttpStatusFromMessage(msg)).json({ message: msg });
  }
};

/** Exporta métricas mayoristas: artículos más pedidos (ranking). */
export const exportTopWholesaleProductsMetricsXlsx = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user || !['ADMIN', 'SELLER', 'WAREHOUSE', 'DEPOSITO'].includes(user.role)) {
      return res.status(403).json({ message: 'Sin permiso' });
    }

    const where: string[] = [`o.status NOT IN ('Cancelado', 'Borrador')`];
    const params: any[] = [];
    const from = (req.query?.from as string | undefined)?.trim();
    const to = (req.query?.to as string | undefined)?.trim();
    if (from) {
      where.push('o.date >= ?');
      params.push(from);
    }
    if (to) {
      where.push('o.date <= ?');
      params.push(to);
    }
    if (user.role === 'SELLER') {
      where.push('c.seller_id = ?');
      params.push(user.id);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await query(
      `
      SELECT
        p.id AS product_id,
        p.sku AS product_code,
        p.name AS product_name,
        SUM(oi.quantity) AS units_ordered,
        COUNT(DISTINCT o.id) AS orders_count,
        COUNT(DISTINCT o.customer_id) AS customers_count,
        ROUND(SUM(oi.quantity * oi.price_at_moment), 2) AS subtotal
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN customers c ON c.id = o.customer_id
      JOIN product_variants pv ON pv.id = oi.variant_id
      JOIN product_colors pc ON pc.id = pv.product_color_id
      JOIN products p ON p.id = pc.product_id
      ${whereSql}
      GROUP BY p.id, p.sku, p.name
      ORDER BY units_ordered DESC, orders_count DESC, subtotal DESC
      `,
      params
    ) as Array<{
      product_id: string;
      product_code: string;
      product_name: string;
      units_ordered: number;
      orders_count: number;
      customers_count: number;
      subtotal: number;
    }>;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'LupoHub';
    wb.created = new Date();
    const ws = wb.addWorksheet('Top pedidos mayorista');
    ws.columns = [
      { header: 'Ranking', key: 'rank', width: 10 },
      { header: 'Código', key: 'code', width: 18 },
      { header: 'Artículo', key: 'name', width: 40 },
      { header: 'Unidades pedidas', key: 'units', width: 18 },
      { header: 'Pedidos', key: 'orders', width: 12 },
      { header: 'Clientes', key: 'customers', width: 12 },
      { header: 'Subtotal', key: 'subtotal', width: 16 }
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    rows.forEach((r, idx) => {
      ws.addRow({
        rank: idx + 1,
        code: r.product_code ?? '',
        name: r.product_name ?? '',
        units: Number(r.units_ordered || 0),
        orders: Number(r.orders_count || 0),
        customers: Number(r.customers_count || 0),
        subtotal: Number(r.subtotal || 0)
      });
    });
    ws.getColumn('D').numFmt = '#,##0';
    ws.getColumn('E').numFmt = '#,##0';
    ws.getColumn('F').numFmt = '#,##0';
    ws.getColumn('G').numFmt = '#,##0.00';

    const out = await wb.xlsx.writeBuffer();
    const buf = Buffer.from(out instanceof ArrayBuffer ? new Uint8Array(out) : new Uint8Array(out as ArrayBufferLike));
    const filename = `metricas_mayorista_top_articulos_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buf);
  } catch (error: any) {
    console.error('exportTopWholesaleProductsMetricsXlsx:', error);
    return res.status(500).json({ message: 'Error exportando métricas mayoristas' });
  }
};

/**
 * Asigna (o devuelve, si ya existía) el N° de remito único para el pedido.
 *
 * - Es **idempotente**: si el pedido ya tiene `remito_number`, devuelve el mismo valor (sin consumir
 *   uno nuevo de la secuencia). Esto garantiza que reimprimir un remito muestre siempre el mismo número.
 * - Es **atómico**: usa el truco de `LAST_INSERT_ID(expr)` para incrementar la secuencia sin necesidad
 *   de transacciones explícitas con conexión dedicada.
 * - **Único**: la columna `orders.remito_number` tiene constraint UNIQUE, por lo que aún en caso de
 *   carrera el segundo proceso obtiene 0 affectedRows y lee el número que efectivamente quedó.
 */
export const assignRemitoNumber = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ message: 'ID de pedido inválido' });
  try {
    const order = await get('SELECT id, remito_number FROM orders WHERE id = ?', [id]);
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' });
    if (order.remito_number != null) {
      return res.json({
        orderId: id,
        remitoNumber: Number(order.remito_number),
        assigned: false
      });
    }

    // Inicialización defensiva (idempotente) por si la migración no llegó a correr aún.
    await execute(`INSERT IGNORE INTO remito_sequence (id, next_value) VALUES (1, 31457)`);

    // Atómico: setea LAST_INSERT_ID al valor actual y deja next_value+1 para el próximo.
    const inc = await execute(
      `UPDATE remito_sequence SET next_value = LAST_INSERT_ID(next_value) + 1 WHERE id = 1`
    );
    const candidate = Number((inc as any)?.insertId || 0);
    if (!candidate) {
      return res.status(500).json({ message: 'No se pudo obtener el próximo N° de remito (secuencia vacía).' });
    }

    const upd = await execute(
      `UPDATE orders SET remito_number = ? WHERE id = ? AND remito_number IS NULL`,
      [candidate, id]
    );
    const affected = Number((upd as any)?.affectedRows || 0);
    if (affected === 1) {
      return res.json({ orderId: id, remitoNumber: candidate, assigned: true });
    }

    // Race condition: otro request asignó antes. Devolver el valor que quedó persistido.
    const reread = await get('SELECT remito_number FROM orders WHERE id = ?', [id]);
    return res.json({
      orderId: id,
      remitoNumber: Number(reread?.remito_number || 0),
      assigned: false
    });
  } catch (error: any) {
    console.error('assignRemitoNumber:', error);
    return res.status(500).json({ message: 'Error asignando N° de remito' });
  }
};

/**
 * Lista los ítems de un pedido que no tienen número de despacho asignado.
 * Devuelve además detalle de producto/variante para mostrar en el modal de corrección.
 */
export const getOrderItemsMissingDespacho = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ message: 'ID de pedido inválido' });
  try {
    const order = await get('SELECT id FROM orders WHERE id = ?', [id]);
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' });

    const rows = await query(
      `SELECT
         i.id AS orderItemId,
         i.variant_id AS variantId,
         i.quantity,
         pc.product_id AS productId,
         COALESCE(pv.sku, p.sku) AS sku,
         p.name AS productName,
         s.size_code AS sizeCode,
         c.name AS colorName,
         p.ultimo_despacho_id AS productLastDespachoId,
         d_last.numero_despacho AS productLastDespachoNumero
       FROM order_items i
       JOIN product_variants pv ON pv.id = i.variant_id
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       LEFT JOIN sizes s ON s.id = pv.size_id
       LEFT JOIN colors c ON c.id = pc.color_id
       LEFT JOIN despachos d_last ON d_last.id = p.ultimo_despacho_id
       WHERE i.order_id = ? AND i.despacho_id IS NULL
       ORDER BY p.name ASC, i.id ASC`,
      [id]
    ) as any[];

    res.json(rows.map((r) => ({
      orderItemId: r.orderItemId,
      variantId: r.variantId,
      productId: r.productId,
      sku: r.sku ?? '',
      productName: r.productName ?? '',
      sizeCode: r.sizeCode ?? '',
      colorName: r.colorName ?? '',
      quantity: Number(r.quantity) || 0,
      productLastDespachoId: r.productLastDespachoId ?? null,
      productLastDespachoNumero: r.productLastDespachoNumero ?? null
    })));
  } catch (error: any) {
    console.error('getOrderItemsMissingDespacho:', error);
    res.status(500).json({ message: 'Error obteniendo ítems sin despacho del pedido' });
  }
};

/**
 * Asigna despachos (existentes o nuevos por número) a una lista de order_items de un pedido.
 * Body: { assignments: [{ orderItemId, despachoId?, numeroDespacho?, paisOrigen?, fechaDespacho? }] }
 * Si viene `numeroDespacho` y no existe, crea el despacho; si existe lo reutiliza.
 * Solo afecta a items del pedido indicado y, por seguridad, solo si actualmente tienen despacho_id NULL.
 */
export const assignDespachosToOrderItems = async (req: Request, res: Response) => {
  const { id } = req.params;
  const assignmentsRaw = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
  if (!id) return res.status(400).json({ message: 'ID de pedido inválido' });
  if (assignmentsRaw.length === 0) {
    return res.status(400).json({ message: 'No hay asignaciones para aplicar' });
  }

  try {
    const order = await get('SELECT id FROM orders WHERE id = ?', [id]);
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' });

    const orderItemIds: string[] = assignmentsRaw
      .map((a: any) => String(a?.orderItemId || '').trim())
      .filter(Boolean);
    if (orderItemIds.length === 0) {
      return res.status(400).json({ message: 'Las asignaciones no traen orderItemId válido' });
    }

    const placeholders = orderItemIds.map(() => '?').join(',');
    const itemsRows = await query(
      `SELECT i.id, i.variant_id, i.despacho_id, pc.product_id, p.ultimo_despacho_id AS productLastDespachoId
       FROM order_items i
       JOIN product_variants pv ON pv.id = i.variant_id
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       WHERE i.order_id = ? AND i.id IN (${placeholders})`,
      [id, ...orderItemIds]
    ) as any[];

    if (itemsRows.length === 0) {
      return res.status(404).json({ message: 'Ningún ítem coincide con el pedido' });
    }
    const itemsById = new Map<string, any>(itemsRows.map((r: any) => [String(r.id), r]));

    type ResolvedAssignment = {
      orderItemId: string;
      productId: string | null;
      despachoId: string;
      numeroDespacho: string;
      paisOrigen: string | null;
      created: boolean;
    };
    const resolved: ResolvedAssignment[] = [];
    const errors: string[] = [];

    for (const a of assignmentsRaw) {
      const orderItemId = String(a?.orderItemId || '').trim();
      const itemRow = itemsById.get(orderItemId);
      if (!orderItemId || !itemRow) {
        errors.push(`Ítem ${orderItemId || '(sin id)'} no pertenece al pedido o no existe`);
        continue;
      }
      if (itemRow.despacho_id) {
        errors.push(`El ítem ${orderItemId} ya tiene un despacho asignado; usá la edición del pedido para cambiarlo`);
        continue;
      }

      let despachoId = String(a?.despachoId || '').trim() || null;
      let numeroDespacho = String(a?.numeroDespacho || '').trim();
      const paisOrigen = String(a?.paisOrigen || '').trim() || null;
      const fechaDespachoRaw = String(a?.fechaDespacho || '').trim();

      if (!despachoId && !numeroDespacho) {
        errors.push(`El ítem ${orderItemId} no trae despachoId ni numeroDespacho`);
        continue;
      }

      let created = false;
      let resolvedNumero = '';
      let resolvedPais: string | null = paisOrigen;

      if (despachoId) {
        const row = await get('SELECT id, numero_despacho, pais_origen FROM despachos WHERE id = ?', [despachoId]);
        if (!row) {
          errors.push(`Despacho ${despachoId} no encontrado`);
          continue;
        }
        resolvedNumero = String(row.numero_despacho || '');
        resolvedPais = paisOrigen || row.pais_origen || null;
      } else {
        const existing = await get(
          'SELECT id, numero_despacho, pais_origen FROM despachos WHERE numero_despacho = ?',
          [numeroDespacho]
        );
        if (existing?.id) {
          despachoId = String(existing.id);
          resolvedNumero = String(existing.numero_despacho || numeroDespacho);
          resolvedPais = paisOrigen || existing.pais_origen || null;
        } else {
          const newId = uuidv4();
          const fecha = fechaDespachoRaw || new Date().toISOString().slice(0, 10);
          const pais = paisOrigen || 'Brasil';
          await execute(
            `INSERT INTO despachos (id, numero_despacho, fecha_despacho, pais_origen, estado, notas)
             VALUES (?, ?, ?, ?, 'despachado', ?)`,
            [newId, numeroDespacho, fecha, pais, 'Creado al asignar a items de pedido']
          );
          despachoId = newId;
          resolvedNumero = numeroDespacho;
          resolvedPais = pais;
          created = true;
        }
      }

      resolved.push({
        orderItemId,
        productId: itemRow.product_id ?? null,
        despachoId: despachoId!,
        numeroDespacho: resolvedNumero,
        paisOrigen: resolvedPais,
        created
      });
    }

    if (resolved.length === 0) {
      return res.status(400).json({
        message: 'No se pudo aplicar ninguna asignación',
        errors
      });
    }

    for (const r of resolved) {
      await execute(
        'UPDATE order_items SET despacho_id = ? WHERE id = ? AND order_id = ? AND despacho_id IS NULL',
        [r.despachoId, r.orderItemId, id]
      );
      if (r.productId) {
        await execute(
          `UPDATE products
             SET ultimo_despacho_id = ?,
                 pais_origen = COALESCE(?, pais_origen)
           WHERE id = ?`,
          [r.despachoId, r.paisOrigen, r.productId]
        );
      }
    }

    res.json({
      orderId: id,
      applied: resolved.map((r) => ({
        orderItemId: r.orderItemId,
        despachoId: r.despachoId,
        numeroDespacho: r.numeroDespacho,
        created: r.created
      })),
      errors
    });
  } catch (error: any) {
    console.error('assignDespachosToOrderItems:', error);
    res.status(500).json({ message: 'Error asignando despachos a los ítems del pedido' });
  }
};
