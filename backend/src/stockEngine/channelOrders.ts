/**
 * Ventas de Tienda Nube y Mercado Libre → stock del Hub.
 *
 * Reglas:
 *  - Cada venta se descuenta UNA sola vez (estado en channel_orders + clave de idempotencia por línea).
 *  - Si la venta se cancela, se devuelve exactamente lo que se había descontado.
 *  - Si no hay stock suficiente, se descuenta igual (queda negativo) y se deja un aviso.
 *  - Si no se sabe qué producto es, la línea queda "sin identificar" para que alguien la elija.
 *    Nunca se adivina con búsquedas aproximadas.
 *  - Las ventas anteriores al arranque del motor nuevo no se tocan (ya las manejó el sistema viejo).
 */
import axios from 'axios';
import { execute, get, query } from '../database/db';
import { applyEntriesInTx, LedgerEntry, MovementType, q, q1, withTransaction } from './ledger';
import { fetchMlItem, getMlAccessToken, mlItemIdCandidates, withMlRetry } from './mlClient';
import { getEngineState } from './schema';

export type Platform = 'tiendanube' | 'mercadolibre';

export type OrderLine = {
  lineKey: string;
  itemId: string;
  variantExtId: string;
  sku: string;
  title: string;
  quantity: number;
};

export type NormalizedOrder = {
  platform: Platform;
  externalOrderId: string;
  orderNumber: string | null;
  createdAt: Date | null;
  /** Cuándo se pagó (si la plataforma lo informa). Decide si la venta es anterior al motor nuevo. */
  paidAt: Date | null;
  remoteStatus: string;
  intent: 'apply' | 'revert' | 'ignore';
  buyer: string | null;
  lines: OrderLine[];
};

type Resolution =
  | { kind: 'variant'; variantId: string; pack: number }
  | { kind: 'bundle'; bundleId: string; items: Array<{ variantId: string; unitsPerSale: number }> }
  | { kind: 'unmatched'; reason: string };

const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';
const s = (v: unknown) => (v == null ? '' : String(v).trim());
const PLATFORM_LABEL: Record<Platform, string> = { tiendanube: 'Tienda Nube', mercadolibre: 'Mercado Libre' };

// ---------------------------------------------------------------------------
// Normalización de órdenes
// ---------------------------------------------------------------------------

function toDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

export function normalizeTiendaNubeOrder(order: any): NormalizedOrder {
  const status = s(order?.status).toLowerCase();
  const payment = s(order?.payment_status).toLowerCase();
  let intent: NormalizedOrder['intent'] = 'ignore';
  if (status === 'cancelled' || payment === 'refunded' || payment === 'voided') intent = 'revert';
  else if (payment === 'paid') intent = 'apply';

  const lines: OrderLine[] = (Array.isArray(order?.products) ? order.products : []).map((p: any, idx: number) => ({
    lineKey: `l${s(p?.id) || idx}`,
    itemId: s(p?.product_id),
    variantExtId: s(p?.variant_id),
    sku: s(p?.sku),
    title: [s(p?.name), Array.isArray(p?.variant_values) ? p.variant_values.join(' / ') : ''].filter(Boolean).join(' — '),
    quantity: Math.max(0, Math.floor(Number(p?.quantity) || 0)),
  }));

  return {
    platform: 'tiendanube',
    externalOrderId: s(order?.id),
    orderNumber: s(order?.number) || null,
    createdAt: toDate(order?.created_at),
    paidAt: toDate(order?.paid_at),
    remoteStatus: `${status || '-'} / ${payment || '-'}`,
    intent,
    buyer: s(order?.customer?.name || order?.contact_name) || null,
    lines,
  };
}

export function normalizeMercadoLibreOrder(order: any): NormalizedOrder {
  const status = s(order?.status).toLowerCase();
  let intent: NormalizedOrder['intent'] = 'ignore';
  if (status === 'cancelled' || status === 'invalid') intent = 'revert';
  else if (status === 'paid') intent = 'apply';

  const lines: OrderLine[] = (Array.isArray(order?.order_items) ? order.order_items : []).map((oi: any, idx: number) => {
    const itemId = s(oi?.item?.id);
    const variation = s(oi?.item?.variation_id);
    const attrs = Array.isArray(oi?.item?.variation_attributes)
      ? oi.item.variation_attributes.map((a: any) => s(a?.value_name)).filter(Boolean).join(' / ')
      : '';
    return {
      lineKey: `${idx}:${itemId || 'item'}:${variation || '0'}`,
      itemId,
      variantExtId: variation,
      sku: s(oi?.item?.seller_sku || oi?.item?.seller_custom_field),
      title: [s(oi?.item?.title), attrs].filter(Boolean).join(' — '),
      quantity: Math.max(0, Math.floor(Number(oi?.quantity) || 0)),
    };
  });

  const approved = (Array.isArray(order?.payments) ? order.payments : [])
    .map((p: any) => toDate(p?.date_approved))
    .filter((d: Date | null): d is Date => !!d)
    .sort((a: Date, b: Date) => b.getTime() - a.getTime());
  return {
    platform: 'mercadolibre',
    externalOrderId: s(order?.id),
    orderNumber: s(order?.pack_id) || null,
    createdAt: toDate(order?.date_created),
    paidAt: approved[0] ?? toDate(order?.date_closed),
    remoteStatus: status || '-',
    intent,
    buyer: s(order?.buyer?.nickname) || null,
    lines,
  };
}

// ---------------------------------------------------------------------------
// Identificación de producto (estricta)
// ---------------------------------------------------------------------------

function normSku(raw: string): string {
  return raw.toUpperCase().replace(/[\s\-\/]/g, '').replace(/^0+/, '');
}

async function variantsBySku(sku: string, packColumn: 'tienda_nube_pack_size' | 'mercado_libre_pack_size'): Promise<Array<{ id: string; pack: number }>> {
  if (!sku) return [];
  const exact = (await query(
    `SELECT DISTINCT pv.id, COALESCE(NULLIF(p.${packColumn}, 0), 1) AS pack
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN products p ON p.id = pc.product_id
     WHERE pv.external_sku = ? OR pv.sku = ?`,
    [sku, sku]
  )) as any[];
  if (exact.length) return exact.map((r) => ({ id: String(r.id), pack: Number(r.pack) || 1 }));
  const n = normSku(sku);
  if (!n) return [];
  const loose = (await query(
    `SELECT DISTINCT pv.id, COALESCE(NULLIF(p.${packColumn}, 0), 1) AS pack
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN products p ON p.id = pc.product_id
     WHERE TRIM(LEADING '0' FROM REPLACE(REPLACE(REPLACE(UPPER(TRIM(COALESCE(pv.external_sku, ''))), '-', ''), '/', ''), ' ', '')) = ?
        OR TRIM(LEADING '0' FROM REPLACE(REPLACE(REPLACE(UPPER(TRIM(COALESCE(pv.sku, ''))), '-', ''), '/', ''), ' ', '')) = ?`,
    [n, n]
  )) as any[];
  return loose.map((r) => ({ id: String(r.id), pack: Number(r.pack) || 1 }));
}

async function loadBundle(bundleId: string): Promise<Resolution> {
  const items = (await query(
    `SELECT variant_id, units_per_sale FROM publication_stock_bundle_items WHERE bundle_id = ? ORDER BY sort_order, id`,
    [bundleId]
  )) as any[];
  if (!items.length) return { kind: 'unmatched', reason: 'El pack multicolor no tiene productos cargados' };
  return {
    kind: 'bundle',
    bundleId,
    items: items.map((r) => ({ variantId: String(r.variant_id), unitsPerSale: Math.max(1, Number(r.units_per_sale) || 1) })),
  };
}

function uniqueVariant(rows: Array<{ id: string; pack: number }>, what: string): Resolution | null {
  const ids = Array.from(new Set(rows.map((r) => r.id)));
  if (ids.length === 1) return { kind: 'variant', variantId: ids[0], pack: Math.max(1, rows[0].pack) };
  if (ids.length > 1) return { kind: 'unmatched', reason: `${what} coincide con ${ids.length} productos distintos` };
  return null;
}

export async function resolveTiendaNubeLine(line: OrderLine): Promise<Resolution> {
  if (line.itemId && line.variantExtId) {
    const b = await get(
      `SELECT id FROM publication_stock_bundles WHERE platform = 'tiendanube' AND external_product_id = ? AND external_variant_id = ?`,
      [line.itemId, line.variantExtId]
    ).catch(() => null);
    if (b?.id) return loadBundle(String(b.id));
  }
  if (line.variantExtId) {
    const pubs = (await query(
      `SELECT variant_id AS id, COALESCE(NULLIF(pack_size, 0), 1) AS pack
       FROM variant_publications WHERE platform = 'tiendanube' AND external_variant_id = ?`,
      [line.variantExtId]
    )) as any[];
    const r = uniqueVariant(pubs.map((p) => ({ id: String(p.id), pack: Number(p.pack) })), 'El vínculo de Tienda Nube');
    if (r) return r;
    const legacy = (await query(
      `SELECT pv.id, COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS pack
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       WHERE pv.tienda_nube_variant_id = ?`,
      [line.variantExtId]
    )) as any[];
    const r2 = uniqueVariant(legacy.map((p) => ({ id: String(p.id), pack: Number(p.pack) })), 'El vínculo de Tienda Nube');
    if (r2) return r2;
  }
  const bySku = uniqueVariant(await variantsBySku(line.sku, 'tienda_nube_pack_size'), `El SKU "${line.sku}"`);
  if (bySku) return bySku;
  return {
    kind: 'unmatched',
    reason: line.sku ? `No hay ningún producto con SKU "${line.sku}" ni vinculado a esta publicación` : 'La publicación no está vinculada y no tiene SKU',
  };
}

export async function resolveMercadoLibreLine(line: OrderLine): Promise<Resolution> {
  const items = mlItemIdCandidates(line.itemId);
  const v = line.variantExtId;
  if (items.length) {
    const b = await get(
      `SELECT id FROM publication_stock_bundles WHERE platform = 'mercadolibre' AND external_product_id IN (?) AND external_variant_id = ? LIMIT 1`,
      [items, v]
    ).catch(() => null);
    if (b?.id) return loadBundle(String(b.id));

    const pubs = (await query(
      `SELECT variant_id AS id, COALESCE(NULLIF(pack_size, 0), 1) AS pack
       FROM variant_publications WHERE platform = 'mercadolibre' AND external_product_id IN (?) AND external_variant_id = ?`,
      [items, v]
    )) as any[];
    const r = uniqueVariant(pubs.map((p) => ({ id: String(p.id), pack: Number(p.pack) })), 'El vínculo de Mercado Libre');
    if (r) return r;
  }
  if (v) {
    const legacy = (await query(
      `SELECT pv.id, COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS pack
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       WHERE pv.mercado_libre_variant_id = ?`,
      [v]
    )) as any[];
    const r = uniqueVariant(legacy.map((p) => ({ id: String(p.id), pack: Number(p.pack) })), 'La variación de Mercado Libre');
    if (r) return r;
  } else if (items.length) {
    const legacy = (await query(
      `SELECT pv.id, COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS pack
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       WHERE pv.mercado_libre_item_id IN (?)`,
      [items]
    )) as any[];
    const r = uniqueVariant(legacy.map((p) => ({ id: String(p.id), pack: Number(p.pack) })), 'La publicación de Mercado Libre');
    if (r) return r;
  }

  let sku = line.sku;
  if (!sku && line.itemId) sku = await mlSkuFromItem(line.itemId, v);
  const bySku = uniqueVariant(await variantsBySku(sku, 'mercado_libre_pack_size'), `El SKU "${sku}"`);
  if (bySku) return bySku;
  return {
    kind: 'unmatched',
    reason: sku ? `No hay ningún producto con SKU "${sku}" ni vinculado a esta publicación` : 'La publicación no está vinculada y no tiene SKU',
  };
}

async function mlSkuFromItem(itemId: string, variationId: string): Promise<string> {
  try {
    const token = await getMlAccessToken();
    if (!token) return '';
    const fetched = await fetchMlItem(itemId, token, variationId || undefined);
    if (!fetched.ok) return '';
    const item = fetched.item;
    const skuOf = (x: any) => {
      const attr = Array.isArray(x?.attributes) ? x.attributes.find((a: any) => s(a?.id).toUpperCase() === 'SELLER_SKU') : null;
      return s(attr?.value_name ?? attr?.value) || s(x?.seller_sku ?? x?.seller_custom_field);
    };
    if (variationId && Array.isArray(item.variations)) {
      const vv = item.variations.find((x: any) => s(x?.id) === variationId);
      if (vv && skuOf(vv)) return skuOf(vv);
    }
    return skuOf(item);
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Procesamiento (máquina de estados)
// ---------------------------------------------------------------------------

export type IngestResult = {
  state: string;
  applied: number;
  reverted: number;
  unmatched: number;
  message: string;
};

function saleType(p: Platform): MovementType {
  return p === 'tiendanube' ? 'VENTA_TIENDA_NUBE' : 'VENTA_MERCADO_LIBRE';
}
function cancelType(p: Platform): MovementType {
  return p === 'tiendanube' ? 'CANCEL_VENTA_TIENDA_NUBE' : 'CANCEL_VENTA_MERCADO_LIBRE';
}
function orderRef(o: { platform: Platform; externalOrderId: string; orderNumber?: string | null }): string {
  const num = o.orderNumber && o.platform === 'tiendanube' ? ` (#${o.orderNumber})` : '';
  return o.platform === 'tiendanube' ? `Orden TN: ${o.externalOrderId}${num}` : `Orden ML: ${o.externalOrderId}`;
}

/** Movimientos que el sistema viejo hizo para esta orden (para no descontar dos veces). */
async function legacyNetByVariant(platform: Platform, orderId: string): Promise<{ sold: Map<string, number>; cancelled: boolean }> {
  const rows =
    platform === 'tiendanube'
      ? ((await query(
          `SELECT variant_id, movement_type, SUM(quantity_change) AS qty FROM stock_movements
           WHERE idempotency_key IS NULL
             AND ((movement_type = 'VENTA_TIENDA_NUBE' AND reference = ?)
               OR (movement_type = 'CANCEL_VENTA_TIENDA_NUBE' AND reference = ?))
           GROUP BY variant_id, movement_type`,
          [`Orden TN: ${orderId}`, `Cancelación orden TN: ${orderId}`]
        )) as any[])
      : ((await query(
          `SELECT variant_id, movement_type, SUM(quantity_change) AS qty FROM stock_movements
           WHERE idempotency_key IS NULL AND movement_type = 'VENTA_MERCADO_LIBRE'
             AND (reference = ? OR reference LIKE ?)
           GROUP BY variant_id, movement_type`,
          [`Orden ML: ${orderId}`, `Orden ML: ${orderId} · %`]
        )) as any[]);
  const sold = new Map<string, number>();
  let cancelled = false;
  for (const r of rows) {
    if (String(r.movement_type).startsWith('CANCEL_')) {
      cancelled = true;
      continue;
    }
    const units = Math.max(0, -Math.round(Number(r.qty) || 0));
    if (units > 0) sold.set(String(r.variant_id), (sold.get(String(r.variant_id)) ?? 0) + units);
  }
  return { sold, cancelled };
}

async function variantLabel(variantId: string): Promise<string> {
  const r = await get(
    `SELECT p.name, c.name AS color, sz.size_code
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN products p ON p.id = pc.product_id
     LEFT JOIN colors c ON c.id = pc.color_id
     LEFT JOIN sizes sz ON sz.id = pv.size_id
     WHERE pv.id = ?`,
    [variantId]
  );
  if (!r) return variantId;
  return [s(r.name), s(r.color), s(r.size_code) ? `talle ${s(r.size_code)}` : ''].filter(Boolean).join(' · ');
}

type PreparedLine = {
  line: OrderLine;
  rows: Array<{ lineKey: string; variantId: string | null; bundleId: string | null; pack: number; units: number; state: 'applied' | 'unmatched'; reason?: string }>;
};

async function prepareLines(order: NormalizedOrder): Promise<PreparedLine[]> {
  const out: PreparedLine[] = [];
  for (const line of order.lines) {
    if (line.quantity <= 0) continue;
    const res =
      order.platform === 'tiendanube' ? await resolveTiendaNubeLine(line) : await resolveMercadoLibreLine(line);
    if (res.kind === 'variant') {
      out.push({
        line,
        rows: [{ lineKey: line.lineKey, variantId: res.variantId, bundleId: null, pack: res.pack, units: line.quantity * res.pack, state: 'applied' }],
      });
    } else if (res.kind === 'bundle') {
      out.push({
        line,
        rows: res.items.map((it) => ({
          lineKey: `${line.lineKey}#${it.variantId}`,
          variantId: it.variantId,
          bundleId: res.bundleId,
          pack: it.unitsPerSale,
          units: line.quantity * it.unitsPerSale,
          state: 'applied' as const,
        })),
      });
    } else {
      out.push({ line, rows: [{ lineKey: line.lineKey, variantId: null, bundleId: null, pack: 1, units: 0, state: 'unmatched', reason: res.reason }] });
    }
  }
  return out;
}

/** Venta que el sistema viejo ya tuvo que haber manejado (pagada antes del corte). */
export function isBeforeCutover(order: Pick<NormalizedOrder, 'createdAt' | 'paidAt'>, cutover: Date): boolean {
  const decisive = order.paidAt ?? order.createdAt;
  return !!decisive && decisive.getTime() < cutover.getTime();
}

/** Procesa una orden ya descargada. Idempotente: se puede llamar mil veces con la misma orden. */
export async function ingestOrder(order: NormalizedOrder): Promise<IngestResult> {
  if (!order.externalOrderId) return { state: 'invalid', applied: 0, reverted: 0, unmatched: 0, message: 'Orden sin ID' };
  const { platform, externalOrderId } = order;

  // Crear la fila si no existe (fuera de la transacción) para poder bloquearla después.
  await execute(
    `INSERT IGNORE INTO channel_orders (platform, external_order_id, state) VALUES (?, ?, 'new')`,
    [platform, externalOrderId]
  );

  // Identificar productos antes de abrir la transacción (puede consultar la API de ML).
  // Si la venta ya estaba procesada no hace falta (ML manda muchos avisos por la misma venta).
  const pre = await get(`SELECT state FROM channel_orders WHERE platform = ? AND external_order_id = ?`, [platform, externalOrderId]);
  const needsLines = order.intent === 'apply' && ['new', 'pending'].includes(s(pre?.state) || 'new');
  const prepared = needsLines ? await prepareLines(order) : [];
  const labels = new Map<string, string>();
  for (const p of prepared) for (const r of p.rows) if (r.variantId && !labels.has(r.variantId)) labels.set(r.variantId, await variantLabel(r.variantId));
  const cutoverIso = await getEngineState('cutover_at');
  const cutover = cutoverIso ? new Date(cutoverIso) : null;
  const ref = orderRef(order);

  return withTransaction(async (conn) => {
    const row = await q1(conn, `SELECT state FROM channel_orders WHERE platform = ? AND external_order_id = ? FOR UPDATE`, [
      platform,
      externalOrderId,
    ]);
    let state = s(row?.state) || 'new';

    const touchMeta = async (newState: string, extra = '') => {
      await conn.query(
        `UPDATE channel_orders SET state = ?, remote_status = ?, order_number = COALESCE(?, order_number), buyer = COALESCE(?, buyer),
           order_created_at = COALESCE(?, order_created_at) ${extra}
         WHERE platform = ? AND external_order_id = ?`,
        [newState, order.remoteStatus.slice(0, 64), order.orderNumber?.slice(0, 64) ?? null, order.buyer?.slice(0, 255) ?? null, order.createdAt, platform, externalOrderId]
      );
      state = newState;
    };

    // Primera vez que vemos esta orden: ¿la manejó el sistema viejo?
    if (state === 'new') {
      const legacy = await legacyNetByVariant(platform, externalOrderId);
      if (legacy.sold.size > 0) {
        for (const [variantId, units] of legacy.sold) {
          await conn.query(
            `INSERT IGNORE INTO channel_order_lines (platform, external_order_id, line_key, quantity, pack_size, units, variant_id, state, title)
             VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'Venta procesada por el sistema anterior')`,
            [platform, externalOrderId, `legacy:${variantId}`, units, units, variantId, legacy.cancelled ? 'reverted' : 'applied']
          );
        }
        await touchMeta(legacy.cancelled ? 'reverted' : 'applied', ', applied_at = COALESCE(applied_at, NOW())');
      } else if (cutover && isBeforeCutover(order, cutover)) {
        await touchMeta('pre_cutover');
      }
    }

    if (state === 'pre_cutover') {
      await touchMeta('pre_cutover');
      return { state, applied: 0, reverted: 0, unmatched: 0, message: 'Venta anterior al sistema nuevo: no se toca' };
    }

    if (order.intent === 'apply') {
      if (state === 'applied' || state === 'reverted' || state === 'cancelled') {
        await touchMeta(state);
        return { state, applied: 0, reverted: 0, unmatched: 0, message: 'La venta ya estaba procesada' };
      }
      const entries: LedgerEntry[] = [];
      let unmatched = 0;
      for (const p of prepared) {
        for (const r of p.rows) {
          await conn.query(
            `INSERT INTO channel_order_lines
               (platform, external_order_id, line_key, external_item_id, external_variant_id, sku, title, quantity, pack_size, units, variant_id, bundle_id, state)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE line_key = line_key`,
            [
              platform,
              externalOrderId,
              r.lineKey,
              p.line.itemId.slice(0, 64) || null,
              p.line.variantExtId.slice(0, 64) || null,
              p.line.sku.slice(0, 128) || null,
              (r.reason ? `${p.line.title} ⚠ ${r.reason}` : p.line.title).slice(0, 255) || null,
              p.line.quantity,
              r.pack,
              r.units,
              r.variantId,
              r.bundleId,
              r.state,
            ]
          );
          if (r.state === 'unmatched') {
            unmatched++;
            continue;
          }
          entries.push({
            variantId: r.variantId!,
            delta: -r.units,
            type: saleType(platform),
            reference: ref,
            source: platform,
            sourceId: externalOrderId,
            idempotencyKey: `${platform}:${externalOrderId}:${r.lineKey}`,
            alertIfNegative: `Venta de ${PLATFORM_LABEL[platform]} sin stock suficiente: ${labels.get(r.variantId!) || r.variantId} (${r.units} u.). Revisá el stock real.`,
          });
        }
      }
      const results = await applyEntriesInTx(conn, entries);
      await touchMeta('applied', ', applied_at = NOW()');
      const applied = results.filter((x) => x.applied).length;
      return {
        state,
        applied,
        reverted: 0,
        unmatched,
        message: unmatched ? `Descontado. ${unmatched} producto(s) sin identificar` : 'Descontado',
      };
    }

    if (order.intent === 'revert') {
      if (state !== 'applied') {
        await touchMeta(state === 'reverted' ? 'reverted' : 'cancelled');
        return { state, applied: 0, reverted: 0, unmatched: 0, message: 'Cancelada (no había nada que devolver)' };
      }
      const lines = await q(
        conn,
        `SELECT line_key, variant_id, units, state FROM channel_order_lines WHERE platform = ? AND external_order_id = ? FOR UPDATE`,
        [platform, externalOrderId]
      );
      const lineVariantIds = (lines as any[]).map((l) => String(l.variant_id || '')).filter(Boolean);
      const alive = new Set(
        lineVariantIds.length
          ? ((await q(conn, `SELECT id FROM product_variants WHERE id IN (?)`, [lineVariantIds])) as any[]).map((r) => String(r.id))
          : []
      );
      const entries: LedgerEntry[] = [];
      for (const l of lines as any[]) {
        if (l.state !== 'applied' || !l.variant_id || !(Number(l.units) > 0)) continue;
        if (!alive.has(String(l.variant_id))) continue; // producto borrado: no hay a dónde devolver
        entries.push({
          variantId: String(l.variant_id),
          delta: Number(l.units),
          type: cancelType(platform),
          reference: `Cancelación ${ref}`,
          source: platform,
          sourceId: externalOrderId,
          idempotencyKey: `${platform}:${externalOrderId}:${l.line_key}:revert`,
        });
      }
      const results = await applyEntriesInTx(conn, entries);
      await conn.query(
        `UPDATE channel_order_lines SET state = CASE WHEN state = 'applied' THEN 'reverted' WHEN state = 'unmatched' THEN 'cancelled' ELSE state END
         WHERE platform = ? AND external_order_id = ?`,
        [platform, externalOrderId]
      );
      await touchMeta('reverted', ', reverted_at = NOW()');
      return { state, applied: 0, reverted: results.filter((x) => x.applied).length, unmatched: 0, message: 'Cancelada: stock devuelto' };
    }

    // Sin pagar todavía.
    if (state === 'new') await touchMeta('pending');
    else await touchMeta(state);
    return { state, applied: 0, reverted: 0, unmatched: 0, message: 'Todavía no está pagada' };
  });
}

// ---------------------------------------------------------------------------
// Descarga desde las APIs
// ---------------------------------------------------------------------------

async function tnIntegration(): Promise<{ token: string; storeId: string } | null> {
  const i = await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
  const storeId = s(i?.store_id || i?.user_id);
  if (!i?.access_token || !storeId) return null;
  return { token: String(i.access_token), storeId };
}

function tnHeaders(token: string) {
  return { Authentication: `bearer ${token}`, 'User-Agent': TN_USER_AGENT };
}

export async function fetchTiendaNubeOrder(orderIdOrNumber: string): Promise<any | null> {
  const tn = await tnIntegration();
  if (!tn) throw new Error('Tienda Nube no está conectada');
  const headers = tnHeaders(tn.token);
  const base = `https://api.tiendanube.com/v1/${tn.storeId}`;
  let r = await axios.get(`${base}/orders/${encodeURIComponent(orderIdOrNumber)}`, { headers, validateStatus: () => true });
  if (r.status === 404) {
    // A veces llega el número visible (ej. 1909) en lugar del ID interno.
    const search = await axios.get(`${base}/orders`, { headers, params: { q: orderIdOrNumber, per_page: 5 }, validateStatus: () => true });
    const hit = Array.isArray(search.data) ? search.data.find((o: any) => s(o?.number) === orderIdOrNumber || s(o?.id) === orderIdOrNumber) : null;
    if (!hit) return null;
    r = await axios.get(`${base}/orders/${hit.id}`, { headers, validateStatus: () => true });
  }
  if (r.status === 401 || r.status === 403) throw new Error('Tienda Nube rechazó el acceso a órdenes. Reconectá Tienda Nube.');
  if (r.status !== 200) throw new Error(`Tienda Nube respondió ${r.status} al pedir la orden ${orderIdOrNumber}`);
  return r.data;
}

export async function fetchMercadoLibreOrder(orderId: string): Promise<any | null> {
  const token = await getMlAccessToken();
  if (!token) throw new Error('Mercado Libre no está conectado');
  const r = await withMlRetry(() =>
    axios.get(`https://api.mercadolibre.com/orders/${encodeURIComponent(orderId)}`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
      validateStatus: (st) => st < 500 && st !== 429,
    })
  );
  if (r.status === 404) return null;
  if (r.status !== 200) throw new Error(`Mercado Libre respondió ${r.status} al pedir la orden ${orderId}`);
  return r.data;
}

export async function ingestTiendaNubeOrderById(orderId: string): Promise<IngestResult> {
  const raw = await fetchTiendaNubeOrder(orderId);
  if (!raw) return { state: 'not_found', applied: 0, reverted: 0, unmatched: 0, message: 'No existe en Tienda Nube' };
  return ingestOrder(normalizeTiendaNubeOrder(raw));
}

export async function ingestMercadoLibreOrderById(orderId: string): Promise<{ result: IngestResult; raw: any | null }> {
  const raw = await fetchMercadoLibreOrder(orderId);
  if (!raw) return { raw: null, result: { state: 'not_found', applied: 0, reverted: 0, unmatched: 0, message: 'No existe en Mercado Libre' } };
  return { raw, result: await ingestOrder(normalizeMercadoLibreOrder(raw)) };
}

// ---------------------------------------------------------------------------
// Red de seguridad: revisar periódicamente las órdenes recientes (por si se perdió un aviso)
// ---------------------------------------------------------------------------

export async function pollRecentOrders(sinceMs: number): Promise<{ tn: number; ml: number; errors: string[] }> {
  const since = new Date(sinceMs).toISOString();
  const errors: string[] = [];
  let tnCount = 0;
  let mlCount = 0;

  const tn = await tnIntegration();
  if (tn) {
    try {
      for (let page = 1; page <= 20; page++) {
        const r = await axios.get(`https://api.tiendanube.com/v1/${tn.storeId}/orders`, {
          headers: tnHeaders(tn.token),
          params: { updated_at_min: since, per_page: 50, page },
          validateStatus: () => true,
        });
        if (r.status === 404) break; // TN devuelve 404 cuando no hay más páginas
        if (r.status !== 200) {
          errors.push(`Tienda Nube respondió ${r.status} al listar órdenes`);
          break;
        }
        const list: any[] = Array.isArray(r.data) ? r.data : [];
        for (const o of list) {
          try {
            await ingestOrder(normalizeTiendaNubeOrder(o));
            tnCount++;
          } catch (e: any) {
            errors.push(`TN orden ${o?.id}: ${e?.message || e}`);
          }
        }
        if (list.length < 50) break;
      }
    } catch (e: any) {
      errors.push(`Tienda Nube: ${e?.message || e}`);
    }
  }

  const token = await getMlAccessToken().catch(() => null);
  if (token) {
    try {
      for (let offset = 0; offset < 1000; offset += 50) {
        const r = await withMlRetry(() =>
          axios.get(`https://api.mercadolibre.com/orders/search`, {
            headers: { Authorization: `Bearer ${token.access_token}` },
            params: { seller: token.user_id, 'order.date_last_updated.from': since, sort: 'date_desc', limit: 50, offset },
            validateStatus: (st) => st < 500 && st !== 429,
          })
        );
        if (r.status !== 200) {
          errors.push(`Mercado Libre respondió ${r.status} al listar órdenes`);
          break;
        }
        const list: any[] = Array.isArray(r.data?.results) ? r.data.results : [];
        for (const o of list) {
          try {
            await ingestOrder(normalizeMercadoLibreOrder(o));
            mlCount++;
          } catch (e: any) {
            errors.push(`ML orden ${o?.id}: ${e?.message || e}`);
          }
        }
        if (list.length < 50) break;
      }
    } catch (e: any) {
      errors.push(`Mercado Libre: ${e?.message || e}`);
    }
  }

  return { tn: tnCount, ml: mlCount, errors };
}

// ---------------------------------------------------------------------------
// Acciones del usuario sobre líneas sin identificar
// ---------------------------------------------------------------------------

/** El usuario eligió qué producto era. Descuenta y (opcional) recuerda el vínculo para la próxima. */
export async function resolveUnmatchedLine(
  lineId: number,
  variantId: string,
  pack: number,
  remember: boolean
): Promise<{ ok: boolean; message: string }> {
  const packSize = Math.max(1, Math.floor(Number(pack) || 1));
  const line = await get(`SELECT * FROM channel_order_lines WHERE id = ?`, [lineId]);
  if (!line) return { ok: false, message: 'No encontré esa venta' };
  const label = await variantLabel(variantId);

  return withTransaction(async (conn) => {
    const ord = await q1(conn, `SELECT state, order_number FROM channel_orders WHERE platform = ? AND external_order_id = ? FOR UPDATE`, [
      line.platform,
      line.external_order_id,
    ]);
    const l = await q1(conn, `SELECT * FROM channel_order_lines WHERE id = ? FOR UPDATE`, [lineId]);
    if (!l || l.state !== 'unmatched') return { ok: false, message: 'Esta venta ya fue resuelta' };
    if (ord?.state !== 'applied') {
      await conn.query(`UPDATE channel_order_lines SET state = 'cancelled' WHERE id = ?`, [lineId]);
      return { ok: false, message: 'La venta fue cancelada: no hay nada que descontar' };
    }
    const platform = String(l.platform) as Platform;
    const units = Math.max(0, Number(l.quantity) || 0) * packSize;
    await applyEntriesInTx(conn, [
      {
        variantId,
        delta: -units,
        type: saleType(platform),
        reference: orderRef({ platform, externalOrderId: String(l.external_order_id), orderNumber: ord?.order_number }),
        source: platform,
        sourceId: String(l.external_order_id),
        idempotencyKey: `${platform}:${l.external_order_id}:${l.line_key}`,
        alertIfNegative: `Venta de ${PLATFORM_LABEL[platform]} sin stock suficiente: ${label} (${units} u.). Revisá el stock real.`,
      },
    ]);
    await conn.query(
      `UPDATE channel_order_lines SET state = 'applied', variant_id = ?, pack_size = ?, units = ? WHERE id = ?`,
      [variantId, packSize, units, lineId]
    );
    if (remember && l.external_item_id) {
      const extVar = s(l.external_variant_id);
      if (platform === 'mercadolibre' || extVar) {
        await conn.query(
          `INSERT IGNORE INTO variant_publications (id, variant_id, platform, external_product_id, external_variant_id, pack_size)
           VALUES (UUID(), ?, ?, ?, ?, ?)`,
          [variantId, platform, String(l.external_item_id), extVar, packSize]
        );
      }
    }
    return { ok: true, message: `Listo: se descontaron ${units} u. de ${label}` };
  });
}

/** El usuario decide que esa línea no mueve stock (ej. producto que no se maneja en el Hub). */
export async function dismissUnmatchedLine(lineId: number): Promise<boolean> {
  const r = await execute(`UPDATE channel_order_lines SET state = 'dismissed' WHERE id = ? AND state = 'unmatched'`, [lineId]);
  return Number(r?.affectedRows || 0) > 0;
}
