import axios from 'axios';
import { query, get } from '../database/db';
import {
  getTiendaNubeIntegration,
  fetchAllTnCategories,
  TnCategory,
} from './tiendanubeCategoryImages.service';

const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';
const TN_BASE = 'https://api.tiendanube.com/v1';

/** Variante de color con la foto asignada en Tienda Nube (por image_id de la variante). */
export type CatalogColorVariant = {
  name: string;
  sourceImage: string | null;
};

/** Producto completo de catálogo, ya normalizado para el frontend. */
export type CatalogProduct = {
  id: number;
  name: string;
  description: string;
  images: string[];
  sizes: string[];
  colors: string[];
  /** Colores con la imagen que TN ya asignó a cada variante. */
  colorVariants: CatalogColorVariant[];
  price: number | null;
  promotionalPrice: number | null;
  permalink: string | null;
  totalStock: number;
  categoryIds: number[];
  /** Código de artículo (derivado del SKU de la primera variante, ej. 40306-001). */
  articleCode: string;
  /** Composición de tela detectada en la descripción (ej. "Poliamida 93% Elastano 7%"). */
  composition: string;
};

/** Una sección del catálogo = una categoría de Tienda Nube con sus productos. */
export type CatalogSection = {
  id: number;
  name: string;
  parent: number | null;
  productCount: number;
  products: CatalogProduct[];
};

export type TiendaNubeCatalog = {
  storeId: string;
  generatedAt: string;
  productCount: number;
  sections: CatalogSection[];
  /** Presente si se aplicó una lista de precios mayorista. */
  priceListId?: string;
  priceListName?: string;
};

/** Devuelve el texto de un campo multi-idioma de TN (es > pt > en > primero disponible). */
function lang(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const v = obj.es ?? obj.pt ?? obj.en ?? Object.values(obj)[0];
    return v != null ? String(v) : '';
  }
  return String(value);
}

/** Quita etiquetas HTML de la descripción de TN y normaliza espacios. */
function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const isSizeAttr = (name: string) => /talle|talla|size|tamano|tamaño/i.test(name);
const isColorAttr = (name: string) => /color|colour|cor/i.test(name);

/** Deriva el código de artículo (ej. 40306-001) desde el SKU de la variante. */
function deriveArticleCode(sku: string): string {
  const s = (sku || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{3,6}-\d{2,3})/);
  if (m) return m[1];
  // fallback: primeros dos segmentos
  const parts = s.split('-');
  if (parts.length >= 2) return `${parts[0]}-${parts[1]}`;
  return s;
}

/** Intenta extraer la composición de tela desde la descripción (líneas con telas y %). */
function extractComposition(description: string): string {
  if (!description) return '';
  const fabricRe = /(poliamida|algod[oó]n|elastano|poli[eé]ster|lycra|microfibra|nylon|spandex|viscosa|modal)/i;
  const lines = description.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (fabricRe.test(line) && /\d{1,3}\s*%/.test(line) && line.length <= 90) {
      return line.replace(/\s+/g, ' ').trim();
    }
  }
  // buscar dentro de una sola línea larga
  const inline = description.match(
    /((?:poliamida|algod[oó]n|elastano|poli[eé]ster|lycra|microfibra|nylon|spandex|viscosa|modal)[^.]*?\d{1,3}\s*%[^.]*)/i
  );
  return inline ? inline[1].replace(/\s+/g, ' ').trim().slice(0, 90) : '';
}

/** Categorías a las que pertenece un producto (la API puede devolver ids o objetos). */
function productCategoryIds(p: any): number[] {
  const raw = Array.isArray(p?.categories) ? p.categories : [];
  const ids: number[] = [];
  for (const c of raw) {
    if (c == null) continue;
    if (typeof c === 'number') ids.push(c);
    else if (typeof c === 'object' && c.id != null) ids.push(Number(c.id));
  }
  return ids;
}

/** Normaliza un producto crudo de TN al formato de catálogo. */
function mapProduct(p: any): CatalogProduct {
  const name = lang(p?.name);
  const description = stripHtml(lang(p?.description));

  const rawImages = Array.isArray(p?.images) ? [...p.images] : [];
  const imageById = new Map<number, string>();
  const images = rawImages
    .sort((a: any, b: any) => (a?.position ?? 0) - (b?.position ?? 0))
    .map((img: any) => {
      const id = Number(img?.id);
      const src = String(img?.src || img?.url || '').trim();
      if (Number.isFinite(id) && id > 0 && src.startsWith('http')) imageById.set(id, src);
      return src;
    })
    .filter((src: string) => src.startsWith('http'));

  const attrs = Array.isArray(p?.attributes) ? p.attributes : [];
  let sizeIdx = -1;
  let colorIdx = -1;
  attrs.forEach((a: any, i: number) => {
    const n = lang(a);
    if (sizeIdx < 0 && isSizeAttr(n)) sizeIdx = i;
    if (colorIdx < 0 && isColorAttr(n)) colorIdx = i;
  });

  const sizesSet = new Set<string>();
  const colorsSet = new Set<string>();
  const colorImageByName = new Map<string, string>();
  let totalStock = 0;
  let price: number | null = null;
  let promotionalPrice: number | null = null;
  let firstSku = '';

  const variants = Array.isArray(p?.variants) ? p.variants : [];
  variants.forEach((v: any, vi: number) => {
    const values = Array.isArray(v?.values) ? v.values : [];
    if (sizeIdx >= 0 && sizeIdx < values.length) {
      const s = lang(values[sizeIdx]).trim();
      if (s) sizesSet.add(s);
    }
    if (colorIdx >= 0 && colorIdx < values.length) {
      const c = lang(values[colorIdx]).trim();
      if (c) {
        colorsSet.add(c);
        const imageId = Number(v?.image_id);
        if (!colorImageByName.has(c) && Number.isFinite(imageId) && imageId > 0) {
          const src = imageById.get(imageId);
          if (src) colorImageByName.set(c, src);
        }
      }
    }
    totalStock += Number(v?.stock) || 0;
    if (!firstSku && v?.sku) firstSku = String(v.sku).trim();
    if (vi === 0) {
      const pr = v?.price != null ? Number(v.price) : NaN;
      price = Number.isFinite(pr) ? pr : null;
      const promo = v?.promotional_price != null ? Number(v.promotional_price) : NaN;
      promotionalPrice = Number.isFinite(promo) && promo > 0 ? promo : null;
    }
  });

  const permalink = p?.canonical_url || p?.url || null;
  const colorVariants: CatalogColorVariant[] = Array.from(colorsSet).map((name) => ({
    name,
    sourceImage: colorImageByName.get(name) ?? null,
  }));

  return {
    id: Number(p?.id),
    name,
    description,
    images,
    sizes: Array.from(sizesSet),
    colors: Array.from(colorsSet),
    colorVariants,
    price,
    promotionalPrice,
    permalink: permalink ? String(permalink) : null,
    totalStock,
    categoryIds: productCategoryIds(p),
    articleCode: deriveArticleCode(firstSku),
    composition: extractComposition(description),
  };
}

function sleepTn() {
  const ms = Math.max(0, parseInt(process.env.TN_RATE_LIMIT_DELAY_MS || '350', 10));
  return new Promise((r) => setTimeout(r, ms));
}

/** Trae todos los productos de la tienda (paginado), con variantes, imágenes y atributos. */
async function fetchAllProducts(
  storeId: string,
  accessToken: string,
  onLog?: (msg: string) => void
): Promise<any[]> {
  const headers = {
    Authentication: `bearer ${accessToken}`,
    'User-Agent': TN_USER_AGENT,
  };
  const all: any[] = [];
  let page = 1;
  while (page <= 500) {
    const res = await axios.get(`${TN_BASE}/${storeId}/products`, {
      headers,
      params: { page, per_page: 200, published: true },
      validateStatus: () => true,
    });
    if (res.status !== 200) {
      if (page === 1) {
        throw new Error(`Error listando productos de Tienda Nube (HTTP ${res.status})`);
      }
      onLog?.(`[WARN] productos página ${page}: HTTP ${res.status}`);
      break;
    }
    const chunk = Array.isArray(res.data) ? res.data : [];
    all.push(...chunk);
    onLog?.(`  Página ${page}: ${chunk.length} productos (acumulado ${all.length})`);
    if (chunk.length < 200) break;
    page++;
    await sleepTn();
  }
  return all;
}

function normalizeSkuKey(sku: string): string {
  return String(sku || '')
    .trim()
    .replace(/[-/\s]/g, '')
    .toUpperCase();
}

/** Aplica precios de una lista mayorista al catálogo (match por tienda_nube_id o código de artículo). */
async function applyPriceListToCatalog(catalog: TiendaNubeCatalog, priceListId: string): Promise<TiendaNubeCatalog> {
  const listRow = await get(`SELECT id, name FROM price_lists WHERE id = ? LIMIT 1`, [priceListId]);
  if (!listRow?.id) return catalog;

  const rows = (await query(
    `SELECT p.tienda_nube_id AS tnId, p.sku, pli.price
     FROM price_list_items pli
     INNER JOIN products p ON p.id = pli.product_id
     WHERE pli.price_list_id = ?`,
    [priceListId]
  )) as Array<{ tnId?: string | null; sku?: string | null; price?: number | null }>;

  const byTnId = new Map<string, number>();
  const bySku = new Map<string, number>();
  const bySkuNorm = new Map<string, number>();

  for (const row of rows || []) {
    const price = Number(row.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const tnId = row.tnId != null ? String(row.tnId).trim() : '';
    if (tnId) byTnId.set(tnId, price);
    const sku = row.sku != null ? String(row.sku).trim() : '';
    if (sku) {
      bySku.set(sku, price);
      bySkuNorm.set(normalizeSkuKey(sku), price);
    }
  }

  const resolvePrice = (tnProductId: number, articleCode: string): number | null => {
    const tnKey = String(tnProductId);
    if (byTnId.has(tnKey)) return byTnId.get(tnKey)!;

    const code = (articleCode || '').trim();
    if (code) {
      if (bySku.has(code)) return bySku.get(code)!;
      const codeNorm = normalizeSkuKey(code);
      if (bySkuNorm.has(codeNorm)) return bySkuNorm.get(codeNorm)!;
      for (const [sku, price] of bySku.entries()) {
        if (sku.startsWith(`${code}-`) || sku.startsWith(code)) return price;
      }
      for (const [norm, price] of bySkuNorm.entries()) {
        if (norm.startsWith(codeNorm)) return price;
      }
    }
    return null;
  };

  for (const section of catalog.sections) {
    for (const product of section.products) {
      const listPrice = resolvePrice(product.id, product.articleCode);
      if (listPrice != null) {
        product.price = listPrice;
        product.promotionalPrice = null;
      }
    }
  }

  return {
    ...catalog,
    priceListId: String(listRow.id),
    priceListName: String(listRow.name || ''),
  };
}

function categoryLabel(c: TnCategory): string {
  return lang(c.name) || `Categoría ${c.id}`;
}

/**
 * Arma el catálogo completo agrupado por cada sección (categoría) de Tienda Nube.
 * Un producto puede aparecer en varias secciones si pertenece a varias categorías.
 */
export async function buildTiendaNubeCatalog(
  opts?: { categoryIds?: number[]; priceListId?: string; onLog?: (msg: string) => void }
): Promise<TiendaNubeCatalog> {
  const log = opts?.onLog;
  const { accessToken, storeId } = await getTiendaNubeIntegration();

  log?.(`Tienda Nube store_id=${storeId}`);
  const categories = await fetchAllTnCategories(storeId, accessToken);
  log?.(`Categorías: ${categories.length}`);

  const rawProducts = await fetchAllProducts(storeId, accessToken, log);
  log?.(`Productos: ${rawProducts.length}`);

  const products = rawProducts.map(mapProduct).filter((p) => Number.isFinite(p.id));

  const wanted = opts?.categoryIds && opts.categoryIds.length > 0 ? new Set(opts.categoryIds) : null;

  // Index de categoría -> producto
  const byCategory = new Map<number, CatalogProduct[]>();
  const uncategorized: CatalogProduct[] = [];

  for (const product of products) {
    const cats = product.categoryIds.filter((id) => !wanted || wanted.has(id));
    if (cats.length === 0) {
      if (!wanted && product.categoryIds.length === 0) uncategorized.push(product);
      continue;
    }
    for (const catId of cats) {
      if (!byCategory.has(catId)) byCategory.set(catId, []);
      byCategory.get(catId)!.push(product);
    }
  }

  // Construir secciones respetando el orden en que TN devuelve las categorías
  const sections: CatalogSection[] = [];
  for (const cat of categories) {
    const prods = byCategory.get(cat.id);
    if (!prods || prods.length === 0) continue;
    if (wanted && !wanted.has(cat.id)) continue;
    sections.push({
      id: cat.id,
      name: categoryLabel(cat),
      parent: cat.parent ?? null,
      productCount: prods.length,
      products: prods.sort((a, b) => a.name.localeCompare(b.name, 'es')),
    });
  }

  if (uncategorized.length > 0) {
    sections.push({
      id: 0,
      name: 'Sin categoría',
      parent: null,
      productCount: uncategorized.length,
      products: uncategorized.sort((a, b) => a.name.localeCompare(b.name, 'es')),
    });
  }

  let catalog: TiendaNubeCatalog = {
    storeId,
    generatedAt: new Date().toISOString(),
    productCount: products.length,
    sections,
  };

  const priceListId = opts?.priceListId?.trim();
  if (priceListId) {
    catalog = await applyPriceListToCatalog(catalog, priceListId);
  }

  return catalog;
}
