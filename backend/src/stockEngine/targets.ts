/**
 * ¿A qué publicaciones de ML/TN hay que mandar el stock de una variante?
 *
 * Fuentes (en este orden, sin duplicados):
 *  1. variant_publications (vínculos explícitos, cada uno con su pack).
 *  2. Columnas viejas de producto/variante (tienda_nube_variant_id, mercado_libre_*), si no hay vínculo explícito.
 *  3. Packs multicolor (publication_stock_bundles) que incluyen la variante.
 */
import { get, query } from '../database/db';
import {
  filterMlPublicationsForSync,
  filterTnPublicationsForSync,
  loadVariantMlLinkContext,
} from '../services/variantPublicationFilter';
import type { MlMatchHints } from './pushers';

export type SyncTarget = {
  key: string;
  platform: 'tiendanube' | 'mercadolibre';
  productId: string;
  externalVariantId: string;
  /** Unidades por venta en esa publicación (pack x2 → se publica stock/2). */
  pack: number;
  label: string;
  /** Si es un pack multicolor, el stock se calcula con todas sus variantes. */
  bundleId?: string;
  hints?: MlMatchHints;
};

const trim = (v: unknown) => (v == null ? '' : String(v).trim());

export function unitsForListing(stock: number, pack: number): number {
  const p = Math.max(1, Math.floor(Number(pack) || 1));
  return Math.max(0, Math.floor(Math.max(0, Number(stock) || 0) / p));
}

export async function resolveTargets(variantId: string): Promise<SyncTarget[]> {
  const meta = await get(
    `SELECT pv.id, COALESCE(pv.external_sku, pv.sku) AS sku, c.name AS color_name, sz.size_code,
            pv.tienda_nube_variant_id, pv.mercado_libre_variant_id, pv.mercado_libre_item_id,
            p.tienda_nube_id, p.mercado_libre_id,
            COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack,
            COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN products p ON p.id = pc.product_id
     LEFT JOIN colors c ON c.id = pc.color_id
     LEFT JOIN sizes sz ON sz.id = pv.size_id
     WHERE pv.id = ?`,
    [variantId]
  );
  if (!meta) return [];

  const hints: MlMatchHints = {
    sku: trim(meta.sku) || null,
    color: trim(meta.color_name) || null,
    size: trim(meta.size_code) || null,
  };
  const targets: SyncTarget[] = [];
  // Vínculos quitados a mano por el usuario: se saltean siempre.
  const excluded = (await query(`SELECT target_key FROM stock_sync_exclusions WHERE variant_id = ?`, [variantId]).catch(
    () => []
  )) as any[];
  const seen = new Set<string>(excluded.map((r) => String(r.target_key)));
  const add = (t: SyncTarget) => {
    if (seen.has(t.key)) return;
    seen.add(t.key);
    targets.push(t);
  };

  const pubs = (await query(
    `SELECT platform, external_product_id, external_variant_id, pack_size
     FROM variant_publications WHERE variant_id = ?`,
    [variantId]
  )) as any[];

  if (pubs.length) {
    const ctx = await loadVariantMlLinkContext(variantId);
    const tnPubs = ctx ? filterTnPublicationsForSync(pubs, ctx) : pubs.filter((p) => p.platform === 'tiendanube');
    const mlPubs = ctx ? filterMlPublicationsForSync(pubs, ctx) : pubs.filter((p) => p.platform === 'mercadolibre');
    for (const p of tnPubs) {
      const prod = trim(p.external_product_id);
      const v = trim(p.external_variant_id);
      if (!prod || !v) continue;
      add({
        key: `tn:${prod}/${v}`,
        platform: 'tiendanube',
        productId: prod,
        externalVariantId: v,
        pack: Math.max(1, Number(p.pack_size) || 1),
        label: `Tienda Nube ${prod}/${v}`,
      });
    }
    for (const p of mlPubs) {
      const item = trim(p.external_product_id);
      const v = trim(p.external_variant_id);
      if (!item) continue;
      add({
        key: `ml:${item}/${v || '-'}`,
        platform: 'mercadolibre',
        productId: item,
        externalVariantId: v,
        pack: Math.max(1, Number(p.pack_size) || 1),
        label: v ? `Mercado Libre ${item} (variación ${v})` : `Mercado Libre ${item}`,
        hints,
      });
    }
  }

  // Vínculos viejos (columnas). TN siempre se considera; ML solo si no hay vínculo explícito de ML.
  const tnProd = trim(meta.tienda_nube_id);
  const tnVar = trim(meta.tienda_nube_variant_id);
  if (tnProd && tnVar) {
    add({
      key: `tn:${tnProd}/${tnVar}`,
      platform: 'tiendanube',
      productId: tnProd,
      externalVariantId: tnVar,
      pack: Number(meta.tn_pack) || 1,
      label: `Tienda Nube ${tnProd}/${tnVar}`,
    });
  }
  const hasMl = targets.some((t) => t.platform === 'mercadolibre');
  if (!hasMl) {
    const ownItem = trim(meta.mercado_libre_item_id);
    const parentItem = trim(meta.mercado_libre_id);
    const mlVar = trim(meta.mercado_libre_variant_id);
    const item = ownItem || parentItem;
    if (item) {
      add({
        key: `ml:${item}/${mlVar || '-'}`,
        platform: 'mercadolibre',
        productId: item,
        externalVariantId: mlVar,
        pack: Number(meta.ml_pack) || 1,
        label: mlVar ? `Mercado Libre ${item} (variación ${mlVar})` : `Mercado Libre ${item}`,
        hints,
      });
    }
  }

  // Packs multicolor que contienen esta variante.
  const bundles = (await query(
    `SELECT b.id, b.platform, b.external_product_id, b.external_variant_id, b.label
     FROM publication_stock_bundle_items bi
     JOIN publication_stock_bundles b ON b.id = bi.bundle_id
     WHERE bi.variant_id = ?`,
    [variantId]
  ).catch(() => [])) as any[];
  for (const b of bundles) {
    const prod = trim(b.external_product_id);
    const v = trim(b.external_variant_id);
    if (!prod) continue;
    if (b.platform === 'tiendanube' && !v) continue;
    const platform = b.platform === 'tiendanube' ? 'tiendanube' : 'mercadolibre';
    add({
      key: `bundle:${b.id}`,
      platform,
      productId: prod,
      externalVariantId: v,
      pack: 1,
      label: `Pack ${trim(b.label) || prod} (${platform === 'tiendanube' ? 'Tienda Nube' : 'Mercado Libre'})`,
      bundleId: String(b.id),
    });
  }

  return targets;
}

/** Stock a publicar en un pack multicolor = cuántos packs completos se pueden armar. */
export async function bundleAvailableUnits(bundleId: string): Promise<number> {
  const rows = (await query(
    `SELECT bi.units_per_sale, COALESCE(s.stock, 0) AS stock
     FROM publication_stock_bundle_items bi
     LEFT JOIN stocks s ON s.variant_id = bi.variant_id
     WHERE bi.bundle_id = ?`,
    [bundleId]
  )) as any[];
  if (!rows.length) return 0;
  let min = Infinity;
  for (const r of rows) {
    min = Math.min(min, unitsForListing(Number(r.stock), Number(r.units_per_sale)));
  }
  return Number.isFinite(min) ? min : 0;
}
