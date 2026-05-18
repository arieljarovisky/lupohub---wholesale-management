import { query, get } from '../database/db';
import { mergeGroupKeysForProduct, nameEmbedsOwnSkuCode, digitCore } from './mergeDuplicateProductsBySku';

function digitsOnly(s: string): string {
  return String(s ?? '').replace(/\D/g, '');
}

/** Productos cuyo SKU o variantes referencian el mismo artículo (núcleo numérico del código pedido). */
export async function findRelatedProductIdsForArticleSku(requestedSku: string, primaryProductId: string): Promise<string[]> {
  const ids = new Set<string>([primaryProductId]);
  const reqKeys = new Set(mergeGroupKeysForProduct(requestedSku));
  const reqDc = digitCore(requestedSku);
  if (reqDc.length < 4) return [...ids];

  const primary = await get(
    'SELECT id, sku, name FROM products WHERE id = ?',
    [primaryProductId]
  ) as { id: string; sku: string; name: string } | null;
  if (!primary) return [...ids];

  const all = (await query('SELECT id, sku, name FROM products')) as Array<{ id: string; sku: string; name: string }>;
  for (const p of all) {
    if (ids.has(p.id)) continue;
    const pKeys = mergeGroupKeysForProduct(p.sku);
    const mergeMatch = pKeys.some((k) => reqKeys.has(k));
    if (mergeMatch) {
      if (nameEmbedsOwnSkuCode(p.name, p.sku) && nameEmbedsOwnSkuCode(primary.name, primary.sku)) {
        ids.add(p.id);
      }
    }
  }

  const variantRows = (await query(
    `SELECT p.id AS product_id,
            CONCAT(COALESCE(p.sku,''), COALESCE(pv.sku,''), COALESCE(pv.external_sku,'')) AS blob
     FROM products p
     LEFT JOIN product_colors pc ON pc.product_id = p.id
     LEFT JOIN product_variants pv ON pv.product_color_id = pc.id`
  )) as Array<{ product_id: string; blob: string }>;
  const digitsByProduct = new Map<string, string>();
  for (const row of variantRows) {
    const prev = digitsByProduct.get(row.product_id) || '';
    digitsByProduct.set(row.product_id, prev + digitsOnly(row.blob));
  }
  for (const [pid, blob] of digitsByProduct) {
    if (ids.has(pid) || !blob) continue;
    if (blob.includes(reqDc)) ids.add(pid);
  }

  return [...ids];
}
