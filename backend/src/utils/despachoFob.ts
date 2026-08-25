import { execute, query } from '../database/db';
import { lookupFobPrice, resolveFobPriceListByName, type FobPriceListInfo } from './channelMarginUtils';

/** Lista de precios FOB usada en despachos de importación. */
export const DESPACHO_FOB_PRICE_LIST_NAME = 'Precios Fob Marzo';

/** La lista está cargada en pesos; el FOB de despachos se expresa en USD. */
export const DESPACHO_FOB_ARS_PER_USD = 1500;

function roundMoney(v: number): number {
  return Math.round(v * 100) / 100;
}

function fobArsToUsd(priceArs: number | null): number | null {
  if (priceArs == null || !Number.isFinite(priceArs)) return null;
  if (DESPACHO_FOB_ARS_PER_USD <= 0) return roundMoney(priceArs);
  return roundMoney(priceArs / DESPACHO_FOB_ARS_PER_USD);
}

export function lookupDespachoItemFobArs(
  info: FobPriceListInfo,
  item: { product_id?: string | null; product_sku?: string | null; variant_sku?: string | null }
): number | null {
  const fromProduct = lookupFobPrice(info, item.product_id, item.product_sku);
  if (fromProduct != null) return fromProduct;
  const variantSku = String(item.variant_sku || '').trim();
  if (!variantSku) return null;
  const base = variantSku.includes('-') ? variantSku.split('-')[0] : variantSku;
  return lookupFobPrice(info, null, base) ?? lookupFobPrice(info, null, variantSku);
}

/** FOB unitario en USD (lista en pesos ÷ 1500). Usar en despachos. */
export function lookupDespachoItemFob(
  info: FobPriceListInfo,
  item: { product_id?: string | null; product_sku?: string | null; variant_sku?: string | null }
): number | null {
  return fobArsToUsd(lookupDespachoItemFobArs(info, item));
}

export async function loadDespachoFobList(): Promise<FobPriceListInfo> {
  return resolveFobPriceListByName(DESPACHO_FOB_PRICE_LIST_NAME);
}

type ItemRow = {
  id: string;
  despacho_id: string;
  cantidad: number | string | null;
  product_id: string | null;
  product_sku: string | null;
  variant_sku: string | null;
};

async function loadItems(despachoIds?: string[]): Promise<ItemRow[]> {
  const where =
    despachoIds && despachoIds.length > 0
      ? `WHERE di.despacho_id IN (${despachoIds.map(() => '?').join(',')})`
      : '';
  return (await query(
    `SELECT di.id, di.despacho_id, di.cantidad, di.product_id, p.sku AS product_sku, pv.sku AS variant_sku
     FROM despacho_items di
     LEFT JOIN products p ON p.id = di.product_id
     LEFT JOIN product_variants pv ON pv.id = di.variant_id
     ${where}`,
    despachoIds && despachoIds.length > 0 ? despachoIds : []
  )) as ItemRow[];
}

function totalsFromItems(items: ItemRow[], info: FobPriceListInfo): Map<string, number> {
  const totals = new Map<string, number>();
  for (const item of items) {
    const fob = lookupDespachoItemFob(info, item);
    if (fob == null) continue;
    const qty = Number(item.cantidad) || 0;
    if (qty <= 0) continue;
    const despachoId = String(item.despacho_id);
    totals.set(despachoId, roundMoney((totals.get(despachoId) || 0) + fob * qty));
  }
  return totals;
}

/** Recalcula y persiste valor_fob de uno o todos los despachos según Precios Fob Marzo. */
export async function persistDespachoFobFromList(despachoId?: string): Promise<FobPriceListInfo> {
  const info = await loadDespachoFobList();
  const items = await loadItems(despachoId ? [despachoId] : undefined);
  const totals = totalsFromItems(items, info);

  if (despachoId) {
    await execute(`UPDATE despachos SET valor_fob = ? WHERE id = ?`, [totals.get(despachoId) ?? 0, despachoId]);
    return info;
  }

  const allIds = (await query(`SELECT id FROM despachos`)) as Array<{ id: string }>;
  for (const row of allIds) {
    await execute(`UPDATE despachos SET valor_fob = ? WHERE id = ?`, [totals.get(String(row.id)) ?? 0, row.id]);
  }
  return info;
}

export function applyFobToDespachoItems<T extends Record<string, unknown>>(
  items: T[],
  info: FobPriceListInfo
): T[] {
  return items.map((item) => {
    const fob = lookupDespachoItemFob(info, {
      product_id: (item.product_id as string) || null,
      product_sku: (item.product_sku as string) || null,
      variant_sku: (item.variant_sku as string) || null
    });
    const qty = Number(item.cantidad) || 0;
    const costoUnitario = fob ?? (item.costo_unitario != null ? Number(item.costo_unitario) : null);
    const costoLinea =
      costoUnitario != null && Number.isFinite(costoUnitario) ? roundMoney(costoUnitario * qty) : null;
    return {
      ...item,
      precio_fob: fob,
      costo_unitario: costoUnitario,
      costo_linea: costoLinea
    };
  });
}

export function sumItemsFob(items: Array<{ costo_linea?: number | null; precio_fob?: number | null; cantidad?: number }>): number {
  return roundMoney(
    items.reduce((acc, item) => {
      if (item.costo_linea != null && Number.isFinite(item.costo_linea)) return acc + item.costo_linea;
      const fob = item.precio_fob;
      const qty = Number(item.cantidad) || 0;
      if (fob != null && Number.isFinite(fob) && qty > 0) return acc + fob * qty;
      return acc;
    }, 0)
  );
}
