/**
 * Fusiona productos duplicados que representan el mismo artículo (mismo “núcleo” de SKU:
 * guiones/espacios distintos, ceros a la izquierda, prefijo numérico común sin los últimos 2 dígitos
 * cuando el núcleo tiene ≥6 dígitos — p. ej. 0322389 y 3223-89 comparten 32238 **solo si** en cada artículo
 * el nombre/descripción incluye el código del propio SKU (no se fusionan solo por coincidencia de dígitos).
 *
 * Uso: script `npm run merge-duplicate-products` o POST /products/merge-duplicate-by-sku
 */
import { query, execute, get } from '../database/db';
import { v4 as uuidv4 } from 'uuid';
import { normalizeColorCodeForImportValue } from '../utils/colorCodeCanonical';
import { syncStockToExternalPlatforms } from '../controllers/stock.controller';

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

/** Texto de color comparable: minúsculas, sin acentos, espacios colapsados. */
function normalizeColorNameForMatch(raw: string | null | undefined): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Mismo color “de catálogo”: coincide nombre o código entre ambos registros
 * (ej. name "Blanco" con name "BLANCO", o code "111" con name "111").
 */
function colorLabelsMatch(
  a: { name: string | null | undefined; code: string | null | undefined },
  b: { name: string | null | undefined; code: string | null | undefined }
): boolean {
  const tokensA = [normalizeColorNameForMatch(a.name), normalizeColorNameForMatch(a.code)].filter((t) => t.length > 0);
  const tokensB = [normalizeColorNameForMatch(b.name), normalizeColorNameForMatch(b.code)].filter((t) => t.length > 0);
  for (const ta of tokensA) {
    for (const tb of tokensB) {
      if (ta === tb) return true;
    }
  }
  return false;
}

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

/**
 * True si el nombre/descripción del artículo incluye el código del propio SKU (núcleo numérico o forma compacta).
 * Requisito para fusionar candidatos por prefijo `dpre:` (evita unir dos artículos que solo comparten dígitos al azar).
 */
export function nameEmbedsOwnSkuCode(name: string, sku: string): boolean {
  const skuDc = digitCore(sku);
  if (skuDc.length < 4 || skuDc === '0') return false;
  const nameDigits = String(name ?? '').replace(/\D/g, '');
  const nameDc = nameDigits.replace(/^0+/, '') || '';
  if (!nameDc) return false;
  if (nameDc === skuDc) return true;
  if (nameDc.includes(skuDc) || skuDc.includes(nameDc)) return true;
  const nc = skuNormCompactKey(name);
  const sc = skuNormCompactKey(sku);
  if (sc.length >= 4 && (nc.includes(sc) || sc.includes(nc))) return true;
  return false;
}

/** Misma lógica que el import Tango: agrupa por núcleo numérico o por SKU compacto. */
function mergeGroupKey(sku: string): string | null {
  const keys = mergeGroupKeysForProduct(sku);
  return keys.length ? keys[0] : null;
}

/**
 * Varias claves por producto; si dos artículos comparten cualquiera, van al mismo grupo (union-find).
 * Incluye `dpre:` = núcleo sin los últimos 2 dígitos (mín. 4 dígitos en el prefijo) para casos tipo
 * `0127501` → 127501 y `1275-11` → 127511 (mismo artículo, sufijos distintos).
 */
function mergeGroupKeysForProduct(sku: string): string[] {
  const out = new Set<string>();
  const dc = digitCore(sku);
  if (dc.length >= 4) out.add(`d:${dc}`);
  if (dc.length >= 6) {
    const pre = dc.slice(0, -2);
    if (pre.length >= 4) out.add(`dpre:${pre}`);
  }
  const c = skuNormCompactKey(sku);
  if (c.length >= 4) out.add(`c:${c}`);
  return [...out];
}

class SkuMergeDsu {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    if (this.parent[i] !== i) this.parent[i] = this.find(this.parent[i]);
    return this.parent[i];
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
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

  await syncStockToExternalPlatforms(toVariantId, sumStock);
}

/**
 * Une la variante `absorbVariantId` en `keeperVariantId` (mismo producto, mismo talle, mismo color por nombre/código/id).
 */
export async function mergeManualVariantPair(keeperVariantId: string, absorbVariantId: string): Promise<void> {
  if (!keeperVariantId || !absorbVariantId || keeperVariantId === absorbVariantId) {
    throw new Error('Indicá dos variantes distintas.');
  }
  const rowSql = `SELECT pv.id AS variant_id, pc.product_id, pv.size_id, pc.color_id,
         c.name AS color_name, c.code AS color_code
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN colors c ON c.id = pc.color_id
     WHERE pv.id = ?`;
  const k = (await get(rowSql, [keeperVariantId])) as
    | {
        variant_id: string;
        product_id: string;
        size_id: string;
        color_id: string;
        color_name: string | null;
        color_code: string | null;
      }
    | undefined;
  const a = (await get(rowSql, [absorbVariantId])) as
    | {
        variant_id: string;
        product_id: string;
        size_id: string;
        color_id: string;
        color_name: string | null;
        color_code: string | null;
      }
    | undefined;
  if (!k?.product_id) throw new Error('Variante destino no encontrada.');
  if (!a?.product_id) throw new Error('Variante a absorber no encontrada.');
  if (String(k.product_id) !== String(a.product_id)) {
    throw new Error('Las variantes deben ser del mismo artículo (producto).');
  }
  if (String(k.size_id) !== String(a.size_id)) {
    throw new Error('Los talles deben coincidir para unificar variantes.');
  }
  if (String(k.color_id) !== String(a.color_id)) {
    const kc = { name: k.color_name, code: k.color_code };
    const ac = { name: a.color_name, code: a.color_code };
    const canonK = normalizeColorCodeForImportValue(k.color_code ?? k.color_name ?? '');
    const canonA = normalizeColorCodeForImportValue(a.color_code ?? a.color_name ?? '');
    const sameCanon = Boolean(canonK && canonA && canonK === canonA);
    if (!colorLabelsMatch(kc, ac) && !sameCanon) {
      const kn = normalizeColorNameForMatch(k.color_name) || String(k.color_code || '').trim() || '?';
      const an = normalizeColorNameForMatch(a.color_name) || String(a.color_code || '').trim() || '?';
      throw new Error(
        `Los colores no coinciden (“${kn}” vs “${an}”). Solo se unifica si es el mismo color (mismo nombre o código equivalente).`
      );
    }
  }
  await mergeTwoVariants(absorbVariantId, keeperVariantId, k.product_id);
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

/** Color equivalente en el keeper: mismo color_id, mismo nombre/código cruzado (name↔code), o código canónico 3 dígitos. */
async function findKeeperProductColorSemMatch(
  keeperProductId: string,
  dupColorId: string
): Promise<{ id: string } | undefined> {
  const exact = await get(`SELECT id FROM product_colors WHERE product_id = ? AND color_id = ? LIMIT 1`, [
    keeperProductId,
    dupColorId,
  ]);
  if ((exact as any)?.id) return { id: (exact as any).id as string };

  const dupC = (await get(`SELECT id, code, name FROM colors WHERE id = ?`, [dupColorId])) as
    | { id: string; code: string | null; name: string | null }
    | undefined;
  if (!dupC) return undefined;

  const dupCodeCanon = normalizeColorCodeForImportValue(dupC.code ?? dupC.name ?? '');

  const rows = (await query(
    `SELECT pc.id, c.code, c.name FROM product_colors pc
     JOIN colors c ON c.id = pc.color_id
     WHERE pc.product_id = ?`,
    [keeperProductId]
  )) as { id: string; code: string | null; name: string | null }[];

  for (const row of rows) {
    if (colorLabelsMatch(dupC, row)) return { id: row.id };
  }
  if (dupCodeCanon) {
    for (const row of rows) {
      const cc = normalizeColorCodeForImportValue(row.code ?? row.name ?? '');
      if (cc && cc === dupCodeCanon) return { id: row.id };
    }
  }
  return undefined;
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
    let keeperPcId: string | null = null;
    const keeperExact = await get(
      `SELECT id FROM product_colors WHERE product_id = ? AND color_id = ? LIMIT 1`,
      [keeper.id, opc.color_id]
    );
    if (keeperExact?.id) keeperPcId = keeperExact.id as string;
    else {
      const sem = await findKeeperProductColorSemMatch(keeper.id, opc.color_id);
      if (sem?.id) keeperPcId = sem.id;
    }

    if (!keeperPcId) {
      await execute(`UPDATE product_colors SET product_id = ? WHERE id = ?`, [keeper.id, opc.id]);
      const moved = await get(
        `SELECT COUNT(*) AS n FROM product_variants WHERE product_color_id = ?`,
        [opc.id]
      );
      variantsMerged += Number((moved as any)?.n || 0);
      continue;
    }

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

export type MergeManualIntoKeeperResult = {
  dryRun: boolean;
  keeperProductId: string;
  variantsMerged: number;
  productsRemoved: number;
  errors: string[];
};

/**
 * Fusiona uno o más artículos (productos padre) en un keeper elegido por el usuario.
 * Reutiliza la misma lógica que el merge automático por SKU (stock, pedidos, publicaciones, etc.).
 */
export async function mergeManualIntoKeeper(
  keeperProductId: string,
  duplicateProductIds: string[],
  opts?: { dryRun?: boolean }
): Promise<MergeManualIntoKeeperResult> {
  const dryRun = opts?.dryRun === true;
  const errors: string[] = [];
  let variantsMerged = 0;
  let productsRemoved = 0;

  const keeperRow = (await get(`SELECT id, sku, name FROM products WHERE id = ?`, [keeperProductId])) as
    | { id: string; sku: string; name: string }
    | undefined;
  if (!keeperRow?.id) {
    return {
      dryRun,
      keeperProductId,
      variantsMerged: 0,
      productsRemoved: 0,
      errors: ['El artículo principal no existe.'],
    };
  }
  const keeper: { id: string; sku: string; name: string } = { ...keeperRow };

  const seen = new Set<string>();
  const dups = duplicateProductIds
    .map((id) => String(id || '').trim())
    .filter((id) => {
      if (!id || id === keeperProductId) return false;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

  for (const dupId of dups) {
    const dupRow = (await get(`SELECT id, sku, name FROM products WHERE id = ?`, [dupId])) as
      | { id: string; sku: string; name: string }
      | undefined;
    if (!dupRow?.id) {
      errors.push(`Artículo no encontrado (${dupId}).`);
      continue;
    }
    try {
      const r = await mergeOneDuplicateProduct(keeper, dupRow, dryRun);
      variantsMerged += r.variantsMerged;
      if (!dryRun) productsRemoved++;
    } catch (e: any) {
      errors.push(`${dupRow.sku}: ${e?.message || String(e)}`);
    }
  }

  return { dryRun, keeperProductId: keeper.id, variantsMerged, productsRemoved, errors };
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
  const keyToIndices = new Map<string, number[]>();
  for (let i = 0; i < all.length; i++) {
    const keys = mergeGroupKeysForProduct(all[i].sku);
    for (const k of keys) {
      if (!keyToIndices.has(k)) keyToIndices.set(k, []);
      keyToIndices.get(k)!.push(i);
    }
  }
  const dsu = new SkuMergeDsu(all.length);
  for (const [key, indices] of keyToIndices.entries()) {
    if (indices.length < 2) continue;
    if (key.startsWith('dpre:')) {
      for (let a = 0; a < indices.length; a++) {
        for (let b = a + 1; b < indices.length; b++) {
          const ia = indices[a];
          const ib = indices[b];
          const pa = all[ia];
          const pb = all[ib];
          if (!nameEmbedsOwnSkuCode(pa.name, pa.sku) || !nameEmbedsOwnSkuCode(pb.name, pb.sku)) continue;
          dsu.union(ia, ib);
        }
      }
    } else {
      const head = indices[0];
      for (let j = 1; j < indices.length; j++) dsu.union(head, indices[j]);
    }
  }
  const rootToProducts = new Map<number, { id: string; sku: string; name: string }[]>();
  for (let i = 0; i < all.length; i++) {
    const r = dsu.find(i);
    if (!rootToProducts.has(r)) rootToProducts.set(r, []);
    rootToProducts.get(r)!.push(all[i]);
  }
  const groups = [...rootToProducts.values()].filter((list) => list.length > 1);

  const groupLabel = (list: { sku: string }[]): string => {
    const dcs = list.map((p) => digitCore(p.sku)).filter((d) => d.length > 0);
    const withPre = dcs.filter((d) => d.length >= 6);
    if (withPre.length >= 2) {
      const pres = new Set(withPre.map((d) => d.slice(0, -2)));
      if (pres.size === 1) return `dpre:${[...pres][0]}`;
    }
    const uniqD = new Set(dcs);
    if (uniqD.size === 1) return `d:${[...uniqD][0]}`;
    return `grp:${list.map((p) => p.sku).sort().join('|')}`;
  };

  if (dryRun) {
    for (const list of groups) {
      const groupKey = groupLabel(list);
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

  for (const list of groups) {
    const groupKey = groupLabel(list);
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
