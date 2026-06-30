import { get, query } from '../database/db';

export type VariantMlLinkContext = {
  variantId: string;
  ownItemId: string | null;
  ownVarId: string | null;
  parentItemId: string | null;
  ownTnVariantId: string | null;
  siblingOwnItemIds: Set<string>;
  siblingTnVariantIds: Set<string>;
};

function trimOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/** Contexto de vínculos ML/TN de una variante y de sus hermanas (mismo producto). */
export async function loadVariantMlLinkContext(variantId: string): Promise<VariantMlLinkContext | null> {
  const variant = await get(
    `SELECT pv.id, pv.mercado_libre_item_id, pv.mercado_libre_variant_id, pv.tienda_nube_variant_id,
            p.mercado_libre_id
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN products p ON p.id = pc.product_id
     WHERE pv.id = ?`,
    [variantId]
  );
  if (!variant) return null;

  const siblings = await query(
    `SELECT pv2.mercado_libre_item_id, pv2.tienda_nube_variant_id
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN product_colors pc2 ON pc2.product_id = pc.product_id
     JOIN product_variants pv2 ON pv2.product_color_id = pc2.id
     WHERE pv.id = ? AND pv2.id <> pv.id`,
    [variantId]
  );

  const siblingOwnItemIds = new Set<string>();
  const siblingTnVariantIds = new Set<string>();
  for (const row of siblings as any[]) {
    const mlItem = trimOrNull(row.mercado_libre_item_id);
    if (mlItem) siblingOwnItemIds.add(mlItem);
    const tnVar = trimOrNull(row.tienda_nube_variant_id);
    if (tnVar) siblingTnVariantIds.add(tnVar);
  }

  return {
    variantId,
    ownItemId: trimOrNull(variant.mercado_libre_item_id),
    ownVarId: trimOrNull(variant.mercado_libre_variant_id),
    parentItemId: trimOrNull(variant.mercado_libre_id),
    ownTnVariantId: trimOrNull(variant.tienda_nube_variant_id),
    siblingOwnItemIds,
    siblingTnVariantIds
  };
}

export function isPrimaryMlPublication(
  pub: { external_product_id?: unknown; external_variant_id?: unknown },
  ctx: VariantMlLinkContext
): boolean {
  const itemId = trimOrNull(pub.external_product_id);
  const varId = trimOrNull(pub.external_variant_id);
  if (!itemId) return false;
  if (ctx.ownItemId && itemId === ctx.ownItemId) {
    return !ctx.ownVarId || !varId || varId === ctx.ownVarId;
  }
  if (!ctx.ownItemId && ctx.parentItemId && itemId === ctx.parentItemId && ctx.ownVarId && varId === ctx.ownVarId) {
    return true;
  }
  return false;
}

/** Evita enviar stock de una variante a publicaciones ML que pertenecen a otra variante del mismo artículo. */
export function shouldSyncMlPublication(
  pub: { external_product_id?: unknown; external_variant_id?: unknown },
  ctx: VariantMlLinkContext
): boolean {
  const itemId = trimOrNull(pub.external_product_id);
  if (!itemId) return false;
  if (isPrimaryMlPublication(pub, ctx)) return true;
  if (ctx.siblingOwnItemIds.has(itemId)) return false;
  return true;
}

export function filterMlPublicationsForSync<T extends { platform?: string; external_product_id?: unknown; external_variant_id?: unknown }>(
  publications: T[],
  ctx: VariantMlLinkContext
): T[] {
  const mlPubs = publications.filter((p) => p.platform === 'mercadolibre');
  if (mlPubs.length === 0) return [];
  const filtered = mlPubs.filter((p) => shouldSyncMlPublication(p, ctx));
  if (filtered.length > 0) return filtered;
  if (ctx.ownItemId) {
    const own = mlPubs.find((p) => trimOrNull(p.external_product_id) === ctx.ownItemId);
    if (own) return [own];
  }
  return mlPubs.slice(0, 1);
}

export function filterTnPublicationsForSync<T extends { platform?: string; external_variant_id?: unknown }>(
  publications: T[],
  ctx: VariantMlLinkContext
): T[] {
  const tnPubs = publications.filter((p) => p.platform === 'tiendanube');
  if (tnPubs.length === 0) return [];
  if (!ctx.ownTnVariantId) return tnPubs;
  const own = tnPubs.filter((p) => trimOrNull(p.external_variant_id) === ctx.ownTnVariantId);
  if (own.length > 0) return own;
  const withoutSiblings = tnPubs.filter((p) => {
    const vid = trimOrNull(p.external_variant_id);
    return !vid || !ctx.siblingTnVariantIds.has(vid);
  });
  return withoutSiblings.length > 0 ? withoutSiblings : tnPubs.slice(0, 1);
}
