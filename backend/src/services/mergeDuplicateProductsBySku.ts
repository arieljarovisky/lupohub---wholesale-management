/**
 * Fusiona productos duplicados que representan el mismo artículo (mismo “núcleo” de SKU:
 * guiones/espacios distintos, ceros a la izquierda, etc.).
 *
 * Uso: script `npm run merge-duplicate-products` o POST /products/merge-duplicate-by-sku
 */
import { query, execute, get } from '../database/db';
import { v4 as uuidv4 } from 'uuid';

export type MergeDuplicateProductsOptions = {
  dryRun?: boolean;
};

export type MergeDuplicateProductsResult = {
  dryRun: boolean;
  groupsFound: number;
  productsRemoved: number;
  variantsMerged: number;
  details: Array<{ groupKey: string; keeperSku: string; keeperId: string; removedSkus: string[] }>;
  errors: string[];
};

function skuNormCompactKey(s: string): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_-]/g, '');
}

function digitCore(s: string): string {
  const d = String(s ?? '').replace(/\D/g, '');
  if (!d) return '';
  return d.replace(/^0+/, '') || '0';
}

/** Misma lógica que el import Tango: agrupa por núcleo numérico o por SKU compacto. */
function mergeGroupKey(sku: string): string | null {
  const dc = digitCore(sku);
  if (dc.length >= 4) return `d:${dc}`;
  const c = skuNormCompactKey(sku);
  if (c.length >= 4) return `c:${c}`;
  return null;
}

function isTrivialProductName(p: { sku: string; name: string }): boolean {
  const nn = skuNormCompactKey(p.name || '');
  const sn = skuNormCompactKey(p.sku || '');
  return !nn || nn === sn;
}

async function tableExists(table: string): Promise<boolean> {
  const r = await get(
    `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`,
    [table]
  );
  return Number((r as any)?.n || 0) > 0;
}

let cachedVariantHasExternalSku: boolean | null = null;
async function variantTableHasExternalSku(): Promise<boolean> {
  if (cachedVariantHasExternalSku !== null) return cachedVariantHasExternalSku;
  const r = await get(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_variants' AND COLUMN_NAME = 'external_sku'`,
    []
  );
  cachedVariantHasExternalSku = Number((r as any)?.n || 0) > 0;
  return cachedVariantHasExternalSku;
}

/**
 * Une `fromVariantId` en `toVariantId`: stock, pedidos, despachos, movimientos, publicaciones, luposhop; borra la variante origen.
 */
export async function mergeTwoVariants(
  fromVariantId: string,
  toVariantId: string,
  keeperProductId: string
): Promise<void> {
  if (fromVariantId === toVariantId) return;

  const sFrom = await get(`SELECT COALESCE(stock,0) AS s FROM stocks WHERE variant_id = ?`, [fromVariantId]);
  const sTo = await get(`SELECT COALESCE(stock,0) AS s FROM stocks WHERE variant_id = ?`, [toVariantId]);
  const sumStock = Number((sFrom as any)?.s || 0) + Number((sTo as any)?.s || 0);
  if (sTo) {
    await execute(`UPDATE stocks SET stock = ? WHERE variant_id = ?`, [sumStock, toVariantId]);
  } else {
    await execute(`INSERT INTO stocks (variant_id, stock) VALUES (?, ?)`, [toVariantId, sumStock]);
  }
  await execute(`DELETE FROM stocks WHERE variant_id = ?`, [fromVariantId]);

  await execute(`UPDATE order_items SET variant_id = ? WHERE variant_id = ?`, [toVariantId, fromVariantId]);

  const dupDis = (await query(`SELECT id, despacho_id, cantidad FROM despacho_items WHERE variant_id = ?`, [
    fromVariantId,
  ])) as any[];
  for (const di of dupDis) {
    const twin = await get(
      `SELECT id, cantidad FROM despacho_items WHERE despacho_id = ? AND variant_id = ? LIMIT 1`,
      [di.despacho_id, toVariantId]
    );
    if (twin?.id) {
      const newQty = Number((twin as any).cantidad || 0) + Number(di.cantidad || 0);
      await execute(`UPDATE despacho_items SET cantidad = ?, product_id = ? WHERE id = ?`, [
        newQty,
        keeperProductId,
        twin.id,
      ]);
      await execute(`DELETE FROM despacho_items WHERE id = ?`, [di.id]);
    } else {
      await execute(`UPDATE despacho_items SET variant_id = ?, product_id = ? WHERE id = ?`, [
        toVariantId,
        keeperProductId,
        di.id,
      ]);
    }
  }

  if (await tableExists('stock_movements')) {
    await execute(`UPDATE stock_movements SET variant_id = ? WHERE variant_id = ?`, [toVariantId, fromVariantId]);
  }

  if (await tableExists('variant_publications')) {
    const pubs = (await query(
      `SELECT id, platform, external_product_id, external_variant_id, pack_size FROM variant_publications WHERE variant_id = ?`,
      [fromVariantId]
    )) as any[];
    for (const pub of pubs) {
      const extV = pub.external_variant_id != null ? String(pub.external_variant_id) : '';
      const ex = await get(
        `SELECT id FROM variant_publications WHERE variant_id = ? AND platform = ? AND external_product_id = ? AND COALESCE(external_variant_id,'') = ? LIMIT 1`,
        [toVariantId, pub.platform, String(pub.external_product_id), extV]
      );
      if (ex?.id) {
        await execute(`DELETE FROM variant_publications WHERE id = ?`, [pub.id]);
      } else {
        await execute(`UPDATE variant_publications SET variant_id = ? WHERE id = ?`, [toVariantId, pub.id]);
      }
    }
  }

  if (await tableExists('variant_luposhop_stock')) {
    const lsFrom = await get(`SELECT stock FROM variant_luposhop_stock WHERE variant_id = ?`, [fromVariantId]);
    const lsTo = await get(`SELECT stock FROM variant_luposhop_stock WHERE variant_id = ?`, [toVariantId]);
    if (lsFrom || lsTo) {
      const lsum = Number((lsFrom as any)?.stock || 0) + Number((lsTo as any)?.stock || 0);
      if (lsTo) {
        await execute(`UPDATE variant_luposhop_stock SET stock = ? WHERE variant_id = ?`, [lsum, toVariantId]);
      } else {
        await execute(`INSERT INTO variant_luposhop_stock (variant_id, stock) VALUES (?, ?)`, [toVariantId, lsum]);
      }
      await execute(`DELETE FROM variant_luposhop_stock WHERE variant_id = ?`, [fromVariantId]);
    }
  }

  const vf = await get(`SELECT * FROM product_variants WHERE id = ?`, [fromVariantId]);
  const vt = await get(`SELECT * FROM product_variants WHERE id = ?`, [toVariantId]);
  if (vf && vt) {
    const tn = (vt as any).tienda_nube_variant_id || (vf as any).tienda_nube_variant_id || null;
    const mlv = (vt as any).mercado_libre_variant_id || (vf as any).mercado_libre_variant_id || null;
    const mli = (vt as any).mercado_libre_item_id || (vf as any).mercado_libre_item_id || null;
    const skuP = (vt as any).sku || (vf as any).sku || null;
    const useExt = await variantTableHasExternalSku();
    if (useExt) {
      const extSku = (vt as any).external_sku || (vf as any).external_sku || null;
      await execute(
        `UPDATE product_variants SET 
           tienda_nube_variant_id = COALESCE(?, tienda_nube_variant_id),
           mercado_libre_variant_id = COALESCE(?, mercado_libre_variant_id),
           mercado_libre_item_id = COALESCE(?, mercado_libre_item_id),
           sku = COALESCE(NULLIF(?, ''), sku),
           external_sku = COALESCE(NULLIF(?, ''), external_sku)
         WHERE id = ?`,
        [tn, mlv, mli, String(skuP || ''), String(extSku || ''), toVariantId]
      );
    } else {
      await execute(
        `UPDATE product_variants SET 
           tienda_nube_variant_id = COALESCE(?, tienda_nube_variant_id),
           mercado_libre_variant_id = COALESCE(?, mercado_libre_variant_id),
           mercado_libre_item_id = COALESCE(?, mercado_libre_item_id),
           sku = COALESCE(NULLIF(?, ''), sku)
         WHERE id = ?`,
        [tn, mlv, mli, String(skuP || ''), toVariantId]
      );
    }
  }

  await execute(`DELETE FROM product_variants WHERE id = ?`, [fromVariantId]);
}

async function mergePriceListItems(keeperId: string, duplicateId: string): Promise<void> {
  if (!(await tableExists('price_list_items'))) return;
  const items = (await query(`SELECT id, price_list_id, price FROM price_list_items WHERE product_id = ?`, [
    duplicateId,
  ])) as any[];
  for (const it of items) {
    const ex = await get(
      `SELECT id FROM price_list_items WHERE price_list_id = ? AND product_id = ? LIMIT 1`,
      [it.price_list_id, keeperId]
    );
    if (ex?.id) {
      await execute(`DELETE FROM price_list_items WHERE id = ?`, [it.id]);
    } else {
      await execute(`UPDATE price_list_items SET product_id = ? WHERE id = ?`, [keeperId, it.id]);
    }
  }
}

async function mergeOneDuplicateProduct(
  keeper: { id: string; sku: string; name: string },
  duplicate: { id: string; sku: string; name: string },
  dryRun: boolean
): Promise<{ variantsMerged: number }> {
  let variantsMerged = 0;
  if (dryRun) {
    const n = await get(
      `SELECT COUNT(*) AS n FROM product_variants pv JOIN product_colors pc ON pc.id = pv.product_color_id WHERE pc.product_id = ?`,
      [duplicate.id]
    );
    return { variantsMerged: Number((n as any)?.n || 0) };
  }

  await mergePriceListItems(keeper.id, duplicate.id);

  const dupPcs = (await query(`SELECT id, color_id FROM product_colors WHERE product_id = ?`, [duplicate.id])) as any[];

  for (const opc of dupPcs) {
    const keeperPc = await get(
      `SELECT id FROM product_colors WHERE product_id = ? AND color_id = ? LIMIT 1`,
      [keeper.id, opc.color_id]
    );

    if (!keeperPc?.id) {
      await execute(`UPDATE product_colors SET product_id = ? WHERE id = ?`, [keeper.id, opc.id]);
      const moved = await get(
        `SELECT COUNT(*) AS n FROM product_variants WHERE product_color_id = ?`,
        [opc.id]
      );
      variantsMerged += Number((moved as any)?.n || 0);
      continue;
    }

    const keeperPcId = keeperPc.id as string;
    const vars = (await query(`SELECT id, size_id FROM product_variants WHERE product_color_id = ?`, [
      opc.id,
    ])) as any[];

    for (const v of vars) {
      const twin = await get(
        `SELECT id FROM product_variants WHERE product_color_id = ? AND size_id = ? LIMIT 1`,
        [keeperPcId, v.size_id]
      );
      if (twin?.id) {
        await mergeTwoVariants(v.id, twin.id as string, keeper.id);
        variantsMerged++;
      } else {
        await execute(`UPDATE product_variants SET product_color_id = ? WHERE id = ?`, [keeperPcId, v.id]);
        variantsMerged++;
      }
    }

    const left = await get(`SELECT COUNT(*) AS n FROM product_variants WHERE product_color_id = ?`, [opc.id]);
    if (Number((left as any)?.n || 0) === 0) {
      await execute(`DELETE FROM product_colors WHERE id = ?`, [opc.id]);
    }
  }

  await execute(`UPDATE despacho_items SET product_id = ? WHERE product_id = ?`, [keeper.id, duplicate.id]);

  const dupMeta = await get(
    `SELECT tienda_nube_id, mercado_libre_id, base_price FROM products WHERE id = ?`,
    [duplicate.id]
  );
  if (dupMeta) {
    await execute(
      `UPDATE products SET 
         tienda_nube_id = COALESCE(tienda_nube_id, ?),
         mercado_libre_id = COALESCE(mercado_libre_id, ?),
         base_price = CASE WHEN (base_price IS NULL OR base_price = 0) AND ? > 0 THEN ? ELSE base_price END
       WHERE id = ?`,
      [
        (dupMeta as any).tienda_nube_id || null,
        (dupMeta as any).mercado_libre_id || null,
        Number((dupMeta as any).base_price) || 0,
        Number((dupMeta as any).base_price) || 0,
        keeper.id,
      ]
    );
  }

  const leftoverPc = await query(`SELECT id FROM product_colors WHERE product_id = ?`, [duplicate.id]);
  for (const row of leftoverPc as any[]) {
    const n = await get(`SELECT COUNT(*) AS n FROM product_variants WHERE product_color_id = ?`, [row.id]);
    if (Number((n as any)?.n || 0) === 0) {
      await execute(`DELETE FROM product_colors WHERE id = ?`, [row.id]);
    }
  }

  await execute(`DELETE FROM products WHERE id = ?`, [duplicate.id]);
  return { variantsMerged };
}

function pickKeeper(products: { id: string; sku: string; name: string }[]): { id: string; sku: string; name: string } {
  const sorted = [...products].sort((a, b) => {
    const ta = isTrivialProductName(a);
    const tb = isTrivialProductName(b);
    if (ta !== tb) return ta ? 1 : -1;
    const la = String(a.name || '').trim().length;
    const lb = String(b.name || '').trim().length;
    if (lb !== la) return lb - la;
    return String(a.sku).localeCompare(String(b.sku));
  });
  return sorted[0];
}

export async function runMergeDuplicateProductsBySku(
  opts: MergeDuplicateProductsOptions = {}
): Promise<MergeDuplicateProductsResult> {
  const dryRun = opts.dryRun === true;
  const details: MergeDuplicateProductsResult['details'] = [];
  const errors: string[] = [];
  let productsRemoved = 0;
  let variantsMerged = 0;

  const all = (await query(`SELECT id, sku, name FROM products`)) as { id: string; sku: string; name: string }[];
  const byKey = new Map<string, { id: string; sku: string; name: string }[]>();
  for (const p of all) {
    const key = mergeGroupKey(p.sku);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(p);
  }

  const groups = [...byKey.entries()].filter(([, list]) => list.length > 1);

  if (dryRun) {
    for (const [groupKey, list] of groups) {
      const keeper = pickKeeper(list);
      const removed = list.filter((p) => p.id !== keeper.id).map((p) => p.sku);
      details.push({ groupKey, keeperSku: keeper.sku, keeperId: keeper.id, removedSkus: removed });
      productsRemoved += removed.length;
      for (const dup of list.filter((p) => p.id !== keeper.id)) {
        const n = await get(
          `SELECT COUNT(*) AS n FROM product_variants pv JOIN product_colors pc ON pc.id = pv.product_color_id WHERE pc.product_id = ?`,
          [dup.id]
        );
        variantsMerged += Number((n as any)?.n || 0);
      }
    }
    return {
      dryRun,
      groupsFound: groups.length,
      productsRemoved,
      variantsMerged,
      details: details.slice(0, 500),
      errors,
    };
  }

  for (const [groupKey, list] of groups) {
    const keeper = pickKeeper(list);
    const duplicates = list.filter((p) => p.id !== keeper.id);
    const removedSkus: string[] = [];
    try {
      for (const dup of duplicates) {
        const r = await mergeOneDuplicateProduct(keeper, dup, false);
        variantsMerged += r.variantsMerged;
        productsRemoved++;
        removedSkus.push(dup.sku);
      }
      details.push({ groupKey, keeperSku: keeper.sku, keeperId: keeper.id, removedSkus });
    } catch (e: any) {
      errors.push(`${groupKey} (${keeper.sku}): ${e?.message || e}`);
    }
  }

  return {
    dryRun,
    groupsFound: groups.length,
    productsRemoved,
    variantsMerged,
    details: details.slice(0, 500),
    errors,
  };
}
