import { get, query } from '../database/db';
import { round2 } from '../utils/companyFinanceFixed';
import { resolveFobPriceList, type FobPriceListInfo } from '../utils/channelMarginUtils';
import { lookupDespachoItemFobArs } from '../utils/despachoFob';

const WHOLESALE_STATUSES = [
  'Confirmado',
  'Preparando',
  'Falta controlar',
  'Controlado',
  'Despachado',
];

const SQL_PAYMENT_EXCLUDE_COMMISSION_IMPORT = `(
  (
    COALESCE(p.notes, '') NOT LIKE '%comisión vendedor%'
    AND COALESCE(p.notes, '') NOT LIKE '%comision vendedor%'
  )
  OR EXISTS (SELECT 1 FROM payment_invoices pi_comm WHERE pi_comm.payment_id = p.id)
  OR EXISTS (SELECT 1 FROM payment_orders po_comm WHERE po_comm.payment_id = p.id)
  OR (p.invoice_id IS NOT NULL AND TRIM(COALESCE(p.invoice_id, '')) <> '')
  OR (p.order_id IS NOT NULL AND TRIM(COALESCE(p.order_id, '')) <> '')
)`;

export type ChannelEconomics = {
  revenue: number;
  cogs: number;
  fees: number;
  units: number;
  unitsWithFob: number;
  orderCount: number;
  grossProfit: number;
  contribution: number;
  grossMarginPct: number | null;
  contributionMarginPct: number | null;
};

export function finishChannelEconomics(partial: {
  revenue: number;
  cogs: number;
  fees?: number;
  units?: number;
  unitsWithFob?: number;
  orderCount?: number;
}): ChannelEconomics {
  const revenue = round2(partial.revenue);
  const cogs = round2(partial.cogs);
  const fees = round2(partial.fees ?? 0);
  const grossProfit = round2(revenue - cogs);
  const contribution = round2(grossProfit - fees);
  return {
    revenue,
    cogs,
    fees,
    units: Math.round(partial.units ?? 0),
    unitsWithFob: Math.round(partial.unitsWithFob ?? 0),
    orderCount: Math.round(partial.orderCount ?? 0),
    grossProfit,
    contribution,
    grossMarginPct: revenue > 0 ? round2((grossProfit / revenue) * 100) : null,
    contributionMarginPct: revenue > 0 ? round2((contribution / revenue) * 100) : null,
  };
}

export function fobForItem(
  info: FobPriceListInfo,
  productId?: string | null,
  productSku?: string | null,
  variantSku?: string | null
): number | null {
  return lookupDespachoItemFobArs(info, {
    product_id: productId,
    product_sku: productSku,
    variant_sku: variantSku,
  });
}

export async function loadCompanyFobList(): Promise<FobPriceListInfo> {
  return resolveFobPriceList();
}

export type MlProductIndex = Map<string, { productId: string; sku: string }>;

export async function loadMlItemProductIndex(): Promise<MlProductIndex> {
  const rows = (await query(
    `SELECT p.id AS productId, p.sku AS sku,
            NULLIF(TRIM(p.mercado_libre_id), '') AS mlId,
            NULLIF(TRIM(pv.mercado_libre_item_id), '') AS mlItemId
     FROM products p
     LEFT JOIN product_colors pc ON pc.product_id = p.id
     LEFT JOIN product_variants pv ON pv.product_color_id = pc.id
     WHERE NULLIF(TRIM(p.mercado_libre_id), '') IS NOT NULL
        OR NULLIF(TRIM(pv.mercado_libre_item_id), '') IS NOT NULL`
  )) as Array<{ productId: string; sku: string | null; mlId: string | null; mlItemId: string | null }>;

  const map: MlProductIndex = new Map();
  for (const r of rows) {
    const value = { productId: String(r.productId), sku: String(r.sku || '') };
    if (r.mlId) map.set(String(r.mlId).trim().toUpperCase(), value);
    if (r.mlItemId) map.set(String(r.mlItemId).trim().toUpperCase(), value);
  }
  return map;
}

export function skuFromMlItem(item: Record<string, unknown> | undefined): string {
  if (!item) return '';
  const attrs = Array.isArray(item.attributes) ? item.attributes : [];
  const skuAttr = attrs.find(
    (a: { id?: string }) => String(a?.id || '').toUpperCase() === 'SELLER_SKU'
  ) as { value_name?: string; value?: string } | undefined;
  return String(
    item.seller_sku ?? item.seller_custom_field ?? skuAttr?.value_name ?? skuAttr?.value ?? ''
  ).trim();
}

export async function sumWholesaleSalesAndCogs(
  from: string,
  to: string,
  fobInfo: FobPriceListInfo
): Promise<{
  economics: ChannelEconomics;
  revenueNet: number;
  revenueWithIva: number;
  creditNotes: number;
}> {
  const ordersRow = (await get(
    `SELECT
       COALESCE(SUM(o.total), 0) AS revenue,
       COUNT(*) AS cnt,
       COALESCE(SUM(COALESCE(cn.cn_total, 0)), 0) AS creditNotes
     FROM orders o
     LEFT JOIN (
       SELECT order_id, SUM(amount_credited) AS cn_total
       FROM credit_notes
       GROUP BY order_id
     ) cn ON cn.order_id = o.id
     WHERE o.date >= ? AND o.date <= ?
       AND o.status IN (${WHOLESALE_STATUSES.map(() => '?').join(',')})
       AND (o.archived IS NULL OR o.archived = 0)`,
    [from, to, ...WHOLESALE_STATUSES]
  )) as { revenue: string | number; cnt: number; creditNotes: string | number } | undefined;

  const revenue = Number(ordersRow?.revenue ?? 0);
  const creditNotes = Number(ordersRow?.creditNotes ?? 0);
  const orderCount = Number(ordersRow?.cnt ?? 0);
  const revenueNet = round2(Math.max(0, revenue - creditNotes));

  const items = (await query(
    `SELECT
       oi.quantity,
       COALESCE(oi.sell_as_pack, 0) AS sellAsPack,
       COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS packSize,
       COALESCE(o.no_stock_impact, 0) AS noStockImpact,
       p.id AS productId,
       p.sku AS productSku,
       pv.sku AS variantSku
     FROM order_items oi
     INNER JOIN orders o ON o.id = oi.order_id
     INNER JOIN product_variants pv ON pv.id = oi.variant_id
     INNER JOIN product_colors pc ON pc.id = pv.product_color_id
     INNER JOIN products p ON p.id = pc.product_id
     WHERE o.date >= ? AND o.date <= ?
       AND o.status IN (${WHOLESALE_STATUSES.map(() => '?').join(',')})
       AND (o.archived IS NULL OR o.archived = 0)`,
    [from, to, ...WHOLESALE_STATUSES]
  )) as Array<{
    quantity: number;
    sellAsPack: number;
    packSize: number;
    noStockImpact: number;
    productId: string;
    productSku: string | null;
    variantSku: string | null;
  }>;

  let units = 0;
  let unitsWithFob = 0;
  let cogs = 0;
  for (const row of items) {
    const qty = Math.max(0, Number(row.quantity) || 0);
    if (qty <= 0) continue;
    const packSize = Math.max(1, Number(row.packSize) || 1);
    const actualUnits = Number(row.sellAsPack) ? qty * packSize : qty;
    units += actualUnits;
    if (Number(row.noStockImpact)) continue;
    const fob = fobForItem(fobInfo, row.productId, row.productSku, row.variantSku);
    if (fob == null) continue;
    unitsWithFob += actualUnits;
    cogs += fob * actualUnits;
  }

  return {
    economics: finishChannelEconomics({
      revenue: revenueNet,
      cogs,
      units,
      unitsWithFob,
      orderCount,
    }),
    revenueNet,
    revenueWithIva: round2(revenueNet * 1.21),
    creditNotes: round2(creditNotes),
  };
}

export async function sumSellerCommissionsInRange(
  from: string,
  to: string
): Promise<{ total: number; receiptCount: number; receiptsBase: number }> {
  const rows = (await query(
    `SELECT
       p.amount,
       CASE
         WHEN c.seller_commission_percentage IS NOT NULL THEN c.seller_commission_percentage
         ELSE COALESCE(u.commission_percentage, 0)
       END AS rate
     FROM payments p
     LEFT JOIN customers c ON c.id = p.customer_id
     LEFT JOIN users u ON u.id = COALESCE(NULLIF(p.seller_id, ''), c.seller_id)
     WHERE p.date >= ? AND p.date <= ?
       AND ${SQL_PAYMENT_EXCLUDE_COMMISSION_IMPORT}`,
    [from, to]
  )) as Array<{ amount: string | number; rate: string | number }>;

  let total = 0;
  let receiptsBase = 0;
  for (const r of rows) {
    const amount = Number(r.amount) || 0;
    const rate = Math.min(100, Math.max(0, Number(r.rate) || 0));
    if (amount <= 0) continue;
    receiptsBase += amount;
    total += (amount / 1.21) * (rate / 100);
  }
  return {
    total: round2(total),
    receiptCount: rows.length,
    receiptsBase: round2(receiptsBase),
  };
}

export async function sumInventoryAtFob(fobInfo: FobPriceListInfo): Promise<{
  units: number;
  unitsWithFob: number;
  value: number;
  skuCount: number;
}> {
  const rows = (await query(
    `SELECT
       COALESCE(s.stock, 0) AS stock,
       p.id AS productId,
       p.sku AS productSku,
       pv.sku AS variantSku
     FROM stocks s
     INNER JOIN product_variants pv ON pv.id = s.variant_id
     INNER JOIN product_colors pc ON pc.id = pv.product_color_id
     INNER JOIN products p ON p.id = pc.product_id
     WHERE COALESCE(s.stock, 0) > 0`
  )) as Array<{
    stock: number;
    productId: string;
    productSku: string | null;
    variantSku: string | null;
  }>;

  let units = 0;
  let unitsWithFob = 0;
  let value = 0;
  const skus = new Set<string>();
  for (const r of rows) {
    const qty = Math.max(0, Number(r.stock) || 0);
    if (qty <= 0) continue;
    units += qty;
    const sku = String(r.productSku || r.variantSku || r.productId);
    skus.add(sku);
    const fob = fobForItem(fobInfo, r.productId, r.productSku, r.variantSku);
    if (fob == null) continue;
    unitsWithFob += qty;
    value += fob * qty;
  }
  return {
    units: Math.round(units),
    unitsWithFob: Math.round(unitsWithFob),
    value: round2(value),
    skuCount: skus.size,
  };
}

export function coveragePct(withFob: number, total: number): number | null {
  if (total <= 0) return null;
  return round2((withFob / total) * 100);
}
