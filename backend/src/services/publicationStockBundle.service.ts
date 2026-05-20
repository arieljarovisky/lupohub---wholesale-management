import { v4 as uuidv4 } from 'uuid';
import { query, get, execute } from '../database/db';

export type PublicationBundlePlatform = 'mercadolibre' | 'tiendanube';

export type PublicationBundleItem = {
  id: string;
  variantId: string;
  unitsPerSale: number;
  sortOrder: number;
  sku?: string;
  productName?: string;
  colorName?: string;
  sizeCode?: string;
  stock?: number;
};

export type PublicationBundle = {
  id: string;
  platform: PublicationBundlePlatform;
  externalProductId: string;
  externalVariantId: string;
  label: string | null;
  items: PublicationBundleItem[];
  availableStock?: number;
};

function normExtVariantId(v: unknown): string {
  return v != null && String(v).trim() !== '' ? String(v).trim() : '';
}

export async function findBundleByListing(
  platform: PublicationBundlePlatform,
  externalProductId: string,
  externalVariantId?: string
): Promise<PublicationBundle | null> {
  const extProd = String(externalProductId || '').trim();
  const extVar = normExtVariantId(externalVariantId);
  let row = await get(
    `SELECT id FROM publication_stock_bundles
     WHERE platform = ? AND external_product_id = ? AND external_variant_id = ?`,
    [platform, extProd, extVar]
  );
  if (!row?.id && extVar) {
    row = await get(
      `SELECT id FROM publication_stock_bundles
       WHERE platform = ? AND external_variant_id = ?`,
      [platform, extVar]
    );
  }
  if (!row?.id && !extVar) {
    const rows = await query(
      `SELECT id FROM publication_stock_bundles
       WHERE platform = ? AND external_product_id = ?`,
      [platform, extProd]
    );
    if ((rows as any[]).length === 1) {
      row = (rows as any[])[0];
    }
  }
  if (!row?.id) return null;
  return loadBundleById(row.id as string);
}

export async function findBundlesByProduct(
  platform: PublicationBundlePlatform,
  externalProductId: string
): Promise<PublicationBundle[]> {
  const extProd = String(externalProductId || '').trim();
  if (!extProd) return [];
  const rows = await query(
    `SELECT id FROM publication_stock_bundles
     WHERE platform = ? AND external_product_id = ?
     ORDER BY label, external_variant_id`,
    [platform, extProd]
  );
  const out: PublicationBundle[] = [];
  for (const r of rows as any[]) {
    const b = await loadBundleById(r.id);
    if (b) out.push(b);
  }
  return out;
}

export type PublicationBundleGroup = {
  platform: PublicationBundlePlatform;
  externalProductId: string;
  listingLabel: string | null;
  variants: PublicationBundle[];
};

export async function listPublicationBundleGroups(): Promise<PublicationBundleGroup[]> {
  const rows = await query(
    `SELECT platform, external_product_id FROM publication_stock_bundles
     GROUP BY platform, external_product_id
     ORDER BY platform, external_product_id`
  );
  const out: PublicationBundleGroup[] = [];
  for (const r of rows as any[]) {
    const variants = await findBundlesByProduct(r.platform, r.external_product_id);
    if (!variants.length) continue;
    out.push({
      platform: r.platform as PublicationBundlePlatform,
      externalProductId: r.external_product_id as string,
      listingLabel: variants.find((v) => v.label)?.label ?? null,
      variants
    });
  }
  return out;
}

export async function syncAllBundlesForProduct(
  platform: PublicationBundlePlatform,
  externalProductId: string
): Promise<void> {
  const bundles = await findBundlesByProduct(platform, externalProductId);
  for (const b of bundles) {
    try {
      await syncBundleListingStock(b.id);
    } catch (e: any) {
      console.warn(`[Bundle sync] ${b.id}:`, e?.message || e);
    }
  }
}

export async function savePublicationBundleGroup(input: {
  platform: PublicationBundlePlatform;
  externalProductId: string;
  listingLabel?: string | null;
  variants: Array<{
    id?: string;
    label?: string | null;
    externalVariantId?: string;
    items: Array<{ variantId: string; unitsPerSale?: number }>;
  }>;
}): Promise<PublicationBundleGroup> {
  const extProd = String(input.externalProductId || '').trim();
  if (!extProd) throw new Error('externalProductId es requerido');
  if (!input.variants?.length) throw new Error('Agregá al menos una variante de pack (combinación de colores)');

  const existing = await findBundlesByProduct(input.platform, extProd);
  const existingById = new Map(existing.map((b) => [b.id, b]));
  const keptIds = new Set<string>();

  for (const v of input.variants) {
    const items = v.items?.filter((it) => it.variantId?.trim()) || [];
    if (!items.length) continue;

    const label =
      v.label?.trim() ||
      input.listingLabel?.trim() ||
      null;
    const payload = {
      label,
      externalVariantId: v.externalVariantId,
      items
    };

    if (v.id && existingById.has(v.id)) {
      const updated = await updatePublicationBundle(v.id, payload);
      if (updated) keptIds.add(v.id);
    } else {
      const created = await createPublicationBundle({
        platform: input.platform,
        externalProductId: extProd,
        externalVariantId: v.externalVariantId,
        label: label ?? undefined,
        items
      });
      keptIds.add(created.id);
    }
  }

  for (const b of existing) {
    if (!keptIds.has(b.id)) await deletePublicationBundle(b.id);
  }

  await syncAllBundlesForProduct(input.platform, extProd);
  const variants = await findBundlesByProduct(input.platform, extProd);
  return {
    platform: input.platform,
    externalProductId: extProd,
    listingLabel: input.listingLabel?.trim() || variants[0]?.label || null,
    variants
  };
}

async function loadBundleItems(bundleId: string): Promise<PublicationBundleItem[]> {
  const rows = await query(
    `
    SELECT
      bi.id,
      bi.variant_id,
      bi.units_per_sale,
      bi.sort_order,
      pv.sku,
      p.name AS product_name,
      pc.name AS color_name,
      sc.code AS size_code,
      COALESCE(s.stock, 0) AS stock
    FROM publication_stock_bundle_items bi
    JOIN product_variants pv ON pv.id = bi.variant_id
    JOIN product_colors pc ON pc.id = pv.product_color_id
    JOIN products p ON p.id = pc.product_id
    LEFT JOIN size_codes sc ON sc.id = pv.size_code_id
    LEFT JOIN stocks s ON s.variant_id = bi.variant_id
    WHERE bi.bundle_id = ?
    ORDER BY bi.sort_order ASC, bi.id ASC
    `,
    [bundleId]
  );
  return (rows as any[]).map((r) => ({
    id: r.id,
    variantId: r.variant_id,
    unitsPerSale: Math.max(1, Number(r.units_per_sale) || 1),
    sortOrder: Number(r.sort_order) || 0,
    sku: r.sku ?? '',
    productName: r.product_name ?? '',
    colorName: r.color_name ?? '',
    sizeCode: r.size_code ?? '',
    stock: Number(r.stock) || 0
  }));
}

export async function loadBundleById(bundleId: string): Promise<PublicationBundle | null> {
  const row = await get(
    `SELECT id, platform, external_product_id, external_variant_id, label FROM publication_stock_bundles WHERE id = ?`,
    [bundleId]
  );
  if (!row?.id) return null;
  const items = await loadBundleItems(bundleId);
  const availableStock = computeAvailableStockFromItems(items);
  return {
    id: row.id as string,
    platform: row.platform as PublicationBundlePlatform,
    externalProductId: row.external_product_id as string,
    externalVariantId: (row.external_variant_id as string) ?? '',
    label: row.label != null ? String(row.label) : null,
    items,
    availableStock
  };
}

export function computeAvailableStockFromItems(items: PublicationBundleItem[]): number {
  if (!items.length) return 0;
  let minPacks = Infinity;
  for (const it of items) {
    const u = Math.max(1, it.unitsPerSale);
    const stock = Math.max(0, Number(it.stock) || 0);
    minPacks = Math.min(minPacks, Math.floor(stock / u));
  }
  return minPacks === Infinity ? 0 : Math.max(0, minPacks);
}

/** Descuenta stock de cada componente al vender `quantitySold` packs de la publicación. */
export async function deductStockForBundleListing(
  bundle: PublicationBundle,
  quantitySold: number,
  movementType: import('../controllers/stock.controller').StockMovementType,
  reference: string
): Promise<{ ok: boolean; lines: string[] }> {
  const qty = Math.max(0, Math.floor(Number(quantitySold) || 0));
  if (qty <= 0 || !bundle.items.length) return { ok: true, lines: [] };

  const { updateVariantStock } = await import('../controllers/stock.controller');
  const lines: string[] = [];
  let allOk = true;

  for (const it of bundle.items) {
    const units = qty * Math.max(1, it.unitsPerSale);
    const row = await get(`SELECT COALESCE(stock, 0) AS stock FROM stocks WHERE variant_id = ?`, [it.variantId]);
    const current = Number(row?.stock) || 0;
    const newStock = Math.max(0, current - units);
    const ok = await updateVariantStock(it.variantId, newStock, movementType, reference, true);
    if (!ok) allOk = false;
    lines.push(
      `${it.sku || it.variantId}: -${units} (${qty} pack × ${it.unitsPerSale} ${it.colorName || ''}) ${current}→${newStock}`
    );
  }

  return { ok: allOk, lines };
}

/** Sincroniza stock de la publicación del pack según el mínimo de sus componentes. */
export async function syncBundleListingStock(bundleId: string): Promise<void> {
  const bundle = await loadBundleById(bundleId);
  if (!bundle || bundle.items.length === 0) return;

  const stockToSend = computeAvailableStockFromItems(bundle.items);
  const {
    updateMercadoLibreStockByItem,
    updateMercadoLibreStockByVariant,
    updateTiendaNubeStock
  } = await import('../controllers/stock.controller');

  const itemId = bundle.externalProductId;
  const variationId = normExtVariantId(bundle.externalVariantId);

  if (bundle.platform === 'mercadolibre') {
    if (variationId) {
      await updateMercadoLibreStockByVariant(itemId, variationId, stockToSend);
    } else {
      await updateMercadoLibreStockByItem(itemId, stockToSend);
    }
  } else if (bundle.platform === 'tiendanube' && variationId) {
    await updateTiendaNubeStock(itemId, variationId, stockToSend);
  }
}

/** Tras cambiar stock de una variante, actualizar publicaciones pack que la incluyen. */
export async function syncBundlesContainingVariant(variantId: string): Promise<void> {
  const bundles = await query(
    `SELECT DISTINCT bundle_id AS id FROM publication_stock_bundle_items WHERE variant_id = ?`,
    [variantId]
  );
  for (const b of bundles as any[]) {
    if (b?.id) {
      try {
        await syncBundleListingStock(b.id);
      } catch (e: any) {
        console.warn(`[Bundle sync] bundle ${b.id}:`, e?.message || e);
      }
    }
  }
}

export async function listPublicationBundles(): Promise<PublicationBundle[]> {
  const rows = await query(
    `SELECT id FROM publication_stock_bundles ORDER BY platform, label, external_product_id`
  );
  const out: PublicationBundle[] = [];
  for (const r of rows as any[]) {
    const b = await loadBundleById(r.id);
    if (b) out.push(b);
  }
  return out;
}

export async function createPublicationBundle(input: {
  platform: PublicationBundlePlatform;
  externalProductId: string;
  externalVariantId?: string;
  label?: string;
  items: Array<{ variantId: string; unitsPerSale?: number }>;
}): Promise<PublicationBundle> {
  const id = uuidv4();
  const extVar = normExtVariantId(input.externalVariantId);
  await execute(
    `INSERT INTO publication_stock_bundles (id, platform, external_product_id, external_variant_id, label)
     VALUES (?, ?, ?, ?, ?)`,
    [id, input.platform, String(input.externalProductId).trim(), extVar, input.label?.trim() || null]
  );
  let order = 0;
  for (const it of input.items) {
    if (!it.variantId?.trim()) continue;
    await execute(
      `INSERT INTO publication_stock_bundle_items (id, bundle_id, variant_id, units_per_sale, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), id, it.variantId.trim(), Math.max(1, Math.floor(Number(it.unitsPerSale) || 1)), order++]
    );
  }
  const bundle = (await loadBundleById(id))!;
  await syncBundleListingStock(id);
  return bundle;
}

export async function updatePublicationBundle(
  bundleId: string,
  input: {
    label?: string | null;
    externalProductId?: string;
    externalVariantId?: string;
    items?: Array<{ variantId: string; unitsPerSale?: number }>;
  }
): Promise<PublicationBundle | null> {
  const existing = await get(`SELECT id FROM publication_stock_bundles WHERE id = ?`, [bundleId]);
  if (!existing) return null;

  if (input.label !== undefined) {
    await execute(`UPDATE publication_stock_bundles SET label = ? WHERE id = ?`, [
      input.label?.trim() || null,
      bundleId
    ]);
  }
  if (input.externalProductId !== undefined) {
    await execute(`UPDATE publication_stock_bundles SET external_product_id = ? WHERE id = ?`, [
      String(input.externalProductId).trim(),
      bundleId
    ]);
  }
  if (input.externalVariantId !== undefined) {
    await execute(`UPDATE publication_stock_bundles SET external_variant_id = ? WHERE id = ?`, [
      normExtVariantId(input.externalVariantId),
      bundleId
    ]);
  }

  if (input.items !== undefined) {
    await execute(`DELETE FROM publication_stock_bundle_items WHERE bundle_id = ?`, [bundleId]);
    let order = 0;
    for (const it of input.items) {
      if (!it.variantId?.trim()) continue;
      await execute(
        `INSERT INTO publication_stock_bundle_items (id, bundle_id, variant_id, units_per_sale, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [uuidv4(), bundleId, it.variantId.trim(), Math.max(1, Math.floor(Number(it.unitsPerSale) || 1)), order++]
      );
    }
  }

  const bundle = await loadBundleById(bundleId);
  if (bundle) await syncBundleListingStock(bundleId);
  return bundle;
}

export async function deletePublicationBundle(bundleId: string): Promise<boolean> {
  const r = await execute(`DELETE FROM publication_stock_bundles WHERE id = ?`, [bundleId]);
  return ((r as any)?.affectedRows || 0) > 0;
}
