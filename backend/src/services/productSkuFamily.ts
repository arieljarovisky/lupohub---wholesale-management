import { query, get } from '../database/db';
import { mergeGroupKeysForProduct, nameEmbedsOwnSkuCode, digitCore } from './mergeDuplicateProductsBySku';

const PRODUCT_SELECT = `p.id, p.sku, p.name, p.category, p.base_price, p.tienda_nube_id, p.mercado_libre_id,
  COALESCE(p.mercado_libre_pack_size, 1) AS mercado_libre_pack_size,
  COALESCE(p.tienda_nube_pack_size, 1) AS tienda_nube_pack_size,
  COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS mayorista_pack_size`;

function digitsOnly(s: string): string {
  return String(s ?? '').replace(/\D/g, '');
}

/** SQL: solo dígitos de un texto (MySQL sin REGEXP_REPLACE). */
const SQL_DIGITS = `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(%s,'-',''),' ',''),'.',''),'_',''),'/','')`;

function sqlDigits(expr: string): string {
  return SQL_DIGITS.replace('%s', expr);
}

export function skuLookupCandidates(sku: string): string[] {
  const t = String(sku ?? '').trim();
  const out = new Set<string>();
  if (t) {
    out.add(t);
    const base = t.split('-')[0];
    if (base && base !== t) out.add(base);
  }
  const digits = digitsOnly(t);
  const looksNumericOnly = digits.length > 0 && !/[A-Za-z]/.test(t);
  if (digits && looksNumericOnly) {
    out.add(digits);
    const stripped = digits.replace(/^0+/, '') || '0';
    out.add(stripped);
    if (digits.length <= 7) out.add(digits.padStart(7, '0'));
    if (stripped.length <= 7) out.add(stripped.padStart(7, '0'));
  }
  return [...out];
}

type ProductRow = Record<string, unknown> & { id: string; sku: string };

async function findProductExact(sku: string): Promise<ProductRow | null> {
  return (await get(`SELECT ${PRODUCT_SELECT} FROM products p WHERE p.sku = ?`, [sku])) as ProductRow | null;
}

async function findProductLikePrefix(sku: string): Promise<ProductRow | null> {
  return (await get(
    `SELECT ${PRODUCT_SELECT} FROM products p WHERE p.sku LIKE ? ORDER BY p.sku LIMIT 1`,
    [`${sku}-%`]
  )) as ProductRow | null;
}

async function findProductByVariantPrefix(sku: string): Promise<ProductRow | null> {
  return (await get(
    `SELECT ${PRODUCT_SELECT} FROM products p WHERE ? LIKE CONCAT(p.sku, '-%') ORDER BY CHAR_LENGTH(p.sku) DESC LIMIT 1`,
    [sku]
  )) as ProductRow | null;
}

/** Busca por núcleo numérico en SKU de producto o variantes (ej. 0127501 → registro 1275111 con variantes 0127501-170-111). */
async function findProductByArticleDigits(skuInput: string): Promise<ProductRow | null> {
  const reqDc = digitCore(skuInput);
  const padded7 = digitsOnly(skuInput).length <= 7 ? digitsOnly(skuInput).padStart(7, '0') : '';
  const needles = [...new Set([reqDc, padded7, digitsOnly(skuInput)].filter((n) => n.length >= 4))];
  if (!needles.length) return null;

  const blobExpr = sqlDigits(`CONCAT(COALESCE(p.sku,''), COALESCE(pv.sku,''), COALESCE(pv.external_sku,''))`);
  for (const needle of needles) {
    const row = (await get(
      `SELECT ${PRODUCT_SELECT}
       FROM products p
       JOIN product_colors pc ON pc.product_id = p.id
       JOIN product_variants pv ON pv.product_color_id = pc.id
       WHERE ${blobExpr} LIKE CONCAT('%', ?, '%')
       ORDER BY CHAR_LENGTH(p.sku) ASC
       LIMIT 1`,
      [needle]
    )) as ProductRow | null;
    if (row) return row;
  }
  return null;
}

/**
 * Resuelve el producto padre a partir del código que ingresa el usuario (con o sin ceros / guiones).
 */
export async function resolveProductByArticleSku(skuInput: string): Promise<ProductRow | null> {
  const trimmed = String(skuInput ?? '').trim();
  if (!trimmed) return null;

  for (const candidate of skuLookupCandidates(trimmed)) {
    let row = await findProductExact(candidate);
    if (row) return row;
    row = await findProductLikePrefix(candidate);
    if (row) return row;
    row = await findProductByVariantPrefix(candidate);
    if (row) return row;
  }

  return findProductByArticleDigits(trimmed);
}

/** Productos relacionados (duplicados / variantes con el mismo artículo en el SKU). */
export async function findRelatedProductIdsForArticleSku(requestedSku: string, primaryProductId: string): Promise<string[]> {
  const ids = new Set<string>([primaryProductId]);
  const reqKeys = new Set(mergeGroupKeysForProduct(requestedSku));
  const reqDc = digitCore(requestedSku);
  const padded7 = digitsOnly(requestedSku).length <= 7 ? digitsOnly(requestedSku).padStart(7, '0') : '';
  const needles = [...new Set([reqDc, padded7].filter((n) => n.length >= 4))];
  if (!needles.length) return [...ids];

  const primary = (await get('SELECT id, sku, name FROM products WHERE id = ?', [primaryProductId])) as {
    id: string;
    sku: string;
    name: string;
  } | null;
  if (!primary) return [...ids];

  const skuDigitsExpr = sqlDigits('p.sku');
  if (reqDc.length >= 6) {
    const pre = reqDc.slice(0, -2);
    if (pre.length >= 4) {
      const dpreMatches = (await query(
        `SELECT p.id, p.sku, p.name FROM products p
         WHERE p.id != ?
           AND CHAR_LENGTH(${skuDigitsExpr}) >= 6
           AND LEFT(${skuDigitsExpr}, CHAR_LENGTH(${skuDigitsExpr}) - 2) = ?`,
        [primaryProductId, pre]
      )) as Array<{ id: string; sku: string; name: string }>;
      for (const p of dpreMatches) {
        const pKeys = mergeGroupKeysForProduct(p.sku);
        if (!pKeys.some((k) => reqKeys.has(k))) continue;
        if (nameEmbedsOwnSkuCode(p.name, p.sku) && nameEmbedsOwnSkuCode(primary.name, primary.sku)) {
          ids.add(p.id);
        }
      }
    }
  }

  const blobExpr = sqlDigits(`CONCAT(COALESCE(p.sku,''), COALESCE(pv.sku,''), COALESCE(pv.external_sku,''))`);
  for (const needle of needles) {
    const rows = (await query(
      `SELECT DISTINCT p.id AS product_id
       FROM products p
       LEFT JOIN product_colors pc ON pc.product_id = p.id
       LEFT JOIN product_variants pv ON pv.product_color_id = pc.id
       WHERE ${blobExpr} LIKE CONCAT('%', ?, '%')`,
      [needle]
    )) as Array<{ product_id: string }>;
    for (const r of rows) {
      if (r.product_id) ids.add(r.product_id);
    }
  }

  return [...ids];
}
