/**
 * Crea una publicación de Mercado Libre a partir de un producto de Tienda Nube.
 * La categoría, la marca y la guía de talles se copian de una publicación ML modelo
 * (del mismo tipo de prenda). Título, fotos, precio y variantes salen de Tienda Nube.
 */
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { execute, get, query } from '../database/db';
import {
  getValidMLToken,
  normalizeMercadoLibreItemId
} from '../controllers/integrations.controller';
import { nombreTalleDesdeCodigo } from '../talles-tango';
import {
  fetchMercadoLibreItemResolved,
  mlCreateErrorRequiresUserProduct,
  mlFetchSizeGridRowForSize,
  mlItemUsesFamilyNameModel,
  mlPayloadForMercadoLibreApiPost
} from './packListingCreate.service';

const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';

const COLOR_ATTR_IDS = new Set(['COLOR', 'COLOUR', 'COR', 'MAIN_COLOR']);
const SIZE_ATTR_IDS = new Set(['SIZE', 'SIZE_TYPE', 'TALLE', 'TALLA']);
const ATTR_BLOCKLIST = new Set([
  'GIFTABLE',
  'FILTRABLE_GENDER',
  'IS_EMERGING_BRAND',
  'IS_HIGHLIGHT_BRAND',
  'IS_TOM_BRAND',
  'ITEM_CONDITION',
  'FAMILY_NAME',
  'SELLER_SKU'
]);

export class TnToMlPublishError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export type TnMlVariantPreview = {
  sku: string;
  color: string;
  size: string;
  stock: number;
  price: number;
};

export type TnMlSuggestion = {
  id: string;
  title: string;
  permalink: string;
  thumbnail: string;
  hasSizeGrid: boolean;
};

export type TnMlPreview = {
  productId: string;
  title: string;
  price: number;
  imageCount: number;
  variations: TnMlVariantPreview[];
  suggestions: TnMlSuggestion[];
  alreadyLinked: Array<{ sku: string; itemId: string }>;
};

type TnVariantRow = TnMlVariantPreview & { imageUrl?: string };

type PreparedVariant = TnVariantRow & {
  sizeName: string;
  sizeGridRowId?: string;
};

type CreatedListing = {
  itemId: string;
  permalink: string;
  sku: string;
  color: string;
  size: string;
  variationId?: string;
};

function tnText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (typeof value === 'object') {
    const o = value as { es?: string; pt?: string; en?: string };
    return String(o.es ?? o.pt ?? o.en ?? '').trim();
  }
  return '';
}

function plainDescription(raw: unknown): string {
  const text = tnText(raw)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, 50000);
}

function httpsUrl(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (s.startsWith('//')) return `https:${s}`;
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  return '';
}

function attrId(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase();
}

function isSizeAttrName(name: string): boolean {
  return /talle|talla|size|tamano|tamaño/i.test(name);
}

function isColorAttrName(name: string): boolean {
  return /color|colour|cor/i.test(name);
}

function sizeLetter(size: string): string {
  const raw = String(size || '').trim();
  if (!raw) return 'U';
  const letter = nombreTalleDesdeCodigo(raw);
  if (/^\d{2,3}$/.test(raw) && letter && letter !== raw) return letter;
  return raw;
}

function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return t.slice(0, max).trim();
}

async function tnIntegration(): Promise<{ accessToken: string; storeId: string }> {
  const integration = await get(
    `SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`
  );
  if (!integration?.access_token) {
    throw new TnToMlPublishError('No hay integración con Tienda Nube');
  }
  const storeId = String(integration.store_id || integration.user_id || '').trim();
  if (!storeId) throw new TnToMlPublishError('No se encontró store_id de Tienda Nube');
  return { accessToken: String(integration.access_token), storeId };
}

async function fetchAllTnVariants(storeId: string, accessToken: string, productId: string): Promise<any[]> {
  const headers = { Authentication: `bearer ${accessToken}`, 'User-Agent': TN_USER_AGENT };
  let variants: any[] = [];
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const res = await axios.get(
      `https://api.tiendanube.com/v1/${storeId}/products/${productId}/variants`,
      { headers, params: { page, per_page: 200 }, validateStatus: () => true }
    );
    const chunk = res.status === 200 && Array.isArray(res.data) ? res.data : [];
    variants = variants.concat(chunk);
    if (chunk.length < 200) hasMore = false;
    else page++;
    if (page > 50) hasMore = false;
  }
  return variants;
}

async function loadTiendaNubeProduct(productId: string): Promise<{
  title: string;
  description: string;
  price: number;
  images: Array<{ id: string; src: string }>;
  variations: TnVariantRow[];
}> {
  const { accessToken, storeId } = await tnIntegration();
  const headers = { Authentication: `bearer ${accessToken}`, 'User-Agent': TN_USER_AGENT };
  const productRes = await axios.get(`https://api.tiendanube.com/v1/${storeId}/products/${productId}`, {
    headers,
    validateStatus: () => true
  });
  if (productRes.status !== 200 || !productRes.data) {
    throw new TnToMlPublishError('Producto no encontrado en Tienda Nube', 404);
  }
  const product = productRes.data;
  const variants = await fetchAllTnVariants(storeId, accessToken, productId);
  const attrs = Array.isArray(product.attributes) ? product.attributes : [];
  let sizeIdx = -1;
  let colorIdx = -1;
  attrs.forEach((a: any, i: number) => {
    const name = tnText(a);
    if (isSizeAttrName(name)) sizeIdx = i;
    if (isColorAttrName(name)) colorIdx = i;
  });

  const images = (Array.isArray(product.images) ? product.images : [])
    .map((im: any) => ({
      id: String(im?.id ?? ''),
      src: httpsUrl(im?.src || im?.url),
      position: Number(im?.position ?? 0)
    }))
    .filter((im: { src: string }) => im.src.startsWith('http'))
    .sort((a: { position: number }, b: { position: number }) => a.position - b.position);

  const imageById = new Map(images.map((im: { id: string; src: string }) => [im.id, im.src]));

  const variantSource = variants.length
    ? variants
    : Array.isArray(product.variants)
      ? product.variants
      : [];

  const variations: TnVariantRow[] = variantSource.map((v: any, idx: number) => {
    const values = Array.isArray(v?.values) ? v.values : [];
    const size = sizeIdx >= 0 ? tnText(values[sizeIdx]) : '';
    const color = colorIdx >= 0 ? tnText(values[colorIdx]) : '';
    const price = Number(v?.price ?? 0);
    const ownImage = imageById.get(String(v?.image_id ?? '')) || '';
    return {
      sku: String(v?.sku || '').trim() || `TN-${productId}-${idx + 1}`,
      color: color || 'Único',
      size: size || 'U',
      stock: Math.max(0, Math.floor(Number(v?.stock) || 0)),
      price: Number.isFinite(price) ? price : 0,
      imageUrl: ownImage || undefined
    };
  });

  if (!variations.length) {
    const price = Number(product?.variants?.[0]?.price ?? 0);
    variations.push({
      sku: `TN-${productId}`,
      color: 'Único',
      size: 'U',
      stock: 0,
      price: Number.isFinite(price) ? price : 0
    });
  }

  const title = tnText(product.name) || 'Producto';
  const price = variations.find((v) => v.price > 0)?.price ?? 0;
  return {
    title,
    description: plainDescription(product.description),
    price,
    images: images.map((im: { id: string; src: string }) => ({ id: im.id, src: im.src })),
    variations
  };
}

function searchQueries(title: string): string[] {
  const queries: string[] = [];
  const model = title.match(/(\d{4,8})\s*$/)?.[1];
  if (model) queries.push(model);
  const words = title
    .replace(/\b(lupo|con|sin|para|del|de|la|el|los|las|una|un|y)\b/gi, ' ')
    .replace(/\d+/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 3)
    .slice(0, 3)
    .join(' ');
  if (words) queries.push(words);
  return queries.slice(0, 2);
}

async function suggestTemplates(
  accessToken: string,
  sellerId: string,
  title: string
): Promise<TnMlSuggestion[]> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const ids: string[] = [];
  for (const q of searchQueries(title)) {
    try {
      const res = await axios.get(
        `https://api.mercadolibre.com/users/${encodeURIComponent(sellerId)}/items/search`,
        {
          headers,
          params: { status: 'active', limit: 8, q },
          validateStatus: () => true,
          timeout: 20000
        }
      );
      const found = Array.isArray(res.data?.results) ? res.data.results : [];
      for (const id of found) {
        const s = String(id || '').trim();
        if (s && !ids.includes(s)) ids.push(s);
      }
      if (ids.length >= 6) break;
    } catch {
      /* la sugerencia es opcional */
    }
  }
  if (!ids.length) return [];

  try {
    const multi = await axios.get(
      `https://api.mercadolibre.com/items?ids=${ids.slice(0, 8).join(',')}`,
      { headers, validateStatus: () => true, timeout: 20000 }
    );
    const rows = Array.isArray(multi.data) ? multi.data : [];
    const out: TnMlSuggestion[] = [];
    for (const row of rows) {
      const body = row?.body && row.code === 200 ? row.body : row?.id ? row : null;
      if (!body?.id) continue;
      const attrs = Array.isArray(body.attributes) ? body.attributes : [];
      const hasSizeGrid = attrs.some((a: any) => attrId(a?.id) === 'SIZE_GRID_ID');
      out.push({
        id: String(body.id),
        title: String(body.title || body.family_name || body.id),
        permalink: String(body.permalink || ''),
        thumbnail: httpsUrl(body.thumbnail || body.secure_thumbnail),
        hasSizeGrid
      });
      if (out.length >= 6) break;
    }
    return out;
  } catch {
    return [];
  }
}

async function alreadyLinkedSkus(variations: TnVariantRow[]): Promise<Array<{ sku: string; itemId: string }>> {
  const skus = [...new Set(variations.map((v) => v.sku.trim()).filter(Boolean))];
  if (!skus.length) return [];
  const placeholders = skus.map(() => '?').join(',');
  const rows = (await query(
    `SELECT sku, mercado_libre_item_id AS item_id
     FROM product_variants
     WHERE UPPER(TRIM(sku)) IN (${placeholders})
       AND mercado_libre_item_id IS NOT NULL
       AND TRIM(mercado_libre_item_id) != ''`,
    skus.map((s) => s.toUpperCase())
  )) as Array<{ sku?: string; item_id?: string }>;
  return (rows || [])
    .map((r) => ({ sku: String(r.sku || ''), itemId: String(r.item_id || '') }))
    .filter((r) => r.sku && r.itemId);
}

export async function previewTiendaNubeMercadoLibrePublish(productId: string): Promise<TnMlPreview> {
  const id = String(productId || '').trim();
  if (!id) throw new TnToMlPublishError('Falta el producto de Tienda Nube');
  const mlToken = await getValidMLToken();
  if (!mlToken) throw new TnToMlPublishError('No hay integración con Mercado Libre');

  const product = await loadTiendaNubeProduct(id);
  const [suggestions, linked] = await Promise.all([
    suggestTemplates(mlToken.access_token, String(mlToken.user_id), product.title),
    alreadyLinkedSkus(product.variations)
  ]);

  return {
    productId: id,
    title: product.title,
    price: product.price,
    imageCount: product.images.length,
    variations: product.variations.map(({ sku, color, size, stock, price }) => ({
      sku,
      color,
      size,
      stock,
      price
    })),
    suggestions,
    alreadyLinked: linked
  };
}

function sizeGridIdFromItem(item: any): string {
  const pools = [item?.attributes];
  for (const v of Array.isArray(item?.variations) ? item.variations : []) pools.push(v?.attributes);
  for (const pool of pools) {
    if (!Array.isArray(pool)) continue;
    for (const a of pool) {
      if (attrId(a?.id) !== 'SIZE_GRID_ID') continue;
      const id = String(a?.value_id ?? a?.value_name ?? '').trim();
      if (/^\d+$/.test(id)) return id;
    }
  }
  return '';
}

function gridRowValue(chartId: string, rowId: string): string {
  const rid = String(rowId || '').trim();
  if (!rid) return '';
  if (rid.includes(':')) return rid;
  return `${chartId}:${rid}`;
}

function sizeNameFromChartRow(row: any, fallback: string): string {
  const attrs = Array.isArray(row?.attributes) ? row.attributes : [];
  for (const att of attrs) {
    const id = attrId(att?.id ?? att?.name);
    if (id !== 'SIZE' && !SIZE_ATTR_IDS.has(id)) continue;
    const vals = Array.isArray(att?.values) ? att.values : [];
    const name = String(vals[0]?.name ?? vals[0]?.value_name ?? '').trim();
    if (name) return name;
  }
  return fallback;
}

function colorAttrIdFromSource(item: any): string {
  const pools = [
    ...(Array.isArray(item?.variations) ? item.variations : []).flatMap((v: any) =>
      Array.isArray(v?.attribute_combinations) ? v.attribute_combinations : []
    ),
    ...(Array.isArray(item?.attributes) ? item.attributes : [])
  ];
  for (const a of pools) {
    const id = attrId(a?.id);
    if (COLOR_ATTR_IDS.has(id)) return id;
  }
  return 'COLOR';
}

function listingFields(item: any): Record<string, unknown> {
  return {
    category_id: String(item?.category_id || '').trim(),
    currency_id: String(item?.currency_id || 'ARS'),
    buying_mode: String(item?.buying_mode || 'buy_it_now'),
    listing_type_id: String(item?.listing_type_id || 'gold_special'),
    condition: String(item?.condition || 'new')
  };
}

function shippingFromItem(item: any): Record<string, unknown> | undefined {
  const s = item?.shipping;
  if (!s || typeof s !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  if (s.mode != null) out.mode = s.mode;
  if (s.local_pick_up != null) out.local_pick_up = s.local_pick_up;
  if (s.free_shipping != null) out.free_shipping = s.free_shipping;
  if (s.logistic_type != null) out.logistic_type = s.logistic_type;
  return Object.keys(out).length ? out : undefined;
}

/** Condiciones que ML devuelve en la publicación modelo y rechaza al crear otra. */
const SALE_TERM_BLOCK = /CAMPAIGN|LOYALTY_LEVEL|CHECKOUT_EXCHANGE_RATE/i;

function saleTermsFromItem(item: any): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(item?.sale_terms)) return undefined;
  const out = item.sale_terms
    .map((st: any) => {
      const id = String(st?.id || '').trim();
      if (!id || SALE_TERM_BLOCK.test(id)) return null;
      const row: Record<string, unknown> = { id };
      if (st?.value_id != null && String(st.value_id).trim() !== '') row.value_id = st.value_id;
      const name = String(st?.value_name ?? '').trim();
      if (name) row.value_name = name;
      return row.value_id != null || row.value_name ? row : null;
    })
    .filter(Boolean) as Array<Record<string, unknown>>;
  return out.length ? out : undefined;
}

function commercialAttributes(item: any): any[] {
  const raw = Array.isArray(item?.attributes) ? item.attributes : [];
  return raw.filter((a: any) => {
    const id = attrId(a?.id);
    if (!id || ATTR_BLOCKLIST.has(id)) return false;
    if (id === 'SIZE_GRID_ID' || id === 'SIZE_GRID_ROW_ID' || id === 'SIZE') return false;
    if (COLOR_ATTR_IDS.has(id) || SIZE_ATTR_IDS.has(id)) return false;
    if (id === 'SALE_FORMAT' || id === 'UNITS_PER_PACK') return false;
    return true;
  });
}

function unitFormatAttributes(item: any): any[] {
  const raw = Array.isArray(item?.attributes) ? item.attributes : [];
  const out: any[] = [];
  if (raw.some((a: any) => attrId(a?.id) === 'SALE_FORMAT')) {
    out.push({ id: 'SALE_FORMAT', value_name: 'Unidad' });
  }
  if (raw.some((a: any) => attrId(a?.id) === 'UNITS_PER_PACK')) {
    out.push({ id: 'UNITS_PER_PACK', value_name: '1' });
  }
  return out;
}

type CategoryRules = {
  required: Set<string>;
  /** Atributos que la categoría deja escribir. null si no se pudo leer la ficha. */
  writable: Set<string> | null;
};

async function loadCategoryRules(accessToken: string, categoryId: string): Promise<CategoryRules> {
  const required = new Set<string>();
  if (!categoryId) return { required, writable: null };
  try {
    const res = await axios.get(
      `https://api.mercadolibre.com/categories/${encodeURIComponent(categoryId)}/attributes`,
      { headers: { Authorization: `Bearer ${accessToken}` }, validateStatus: () => true, timeout: 20000 }
    );
    if (res.status !== 200 || !Array.isArray(res.data)) return { required, writable: null };
    const writable = new Set<string>();
    for (const a of res.data) {
      const id = attrId(a?.id);
      if (!id) continue;
      const tags = a?.tags || {};
      if (tags.required || tags.catalog_required || tags.new_required) required.add(id);
      if (!tags.read_only && !tags.fixed) writable.add(id);
    }
    return { required, writable };
  } catch {
    return { required, writable: null };
  }
}

function categoryAllows(rules: CategoryRules, attributeId: string): boolean {
  if (!rules.writable) return true;
  return rules.writable.has(attributeId);
}

function stripSizeGridAttributes(payload: Record<string, unknown>): void {
  if (!Array.isArray(payload.attributes)) return;
  payload.attributes = (payload.attributes as any[]).filter((a) => {
    const id = attrId(a?.id);
    return id !== 'SIZE_GRID_ID' && id !== 'SIZE_GRID_ROW_ID';
  });
}

function stripBlockedSaleTerms(payload: Record<string, unknown>): void {
  if (!Array.isArray(payload.sale_terms)) return;
  const kept = (payload.sale_terms as any[]).filter((st) => {
    const id = String(st?.id || '').trim();
    return id && !SALE_TERM_BLOCK.test(id);
  });
  if (kept.length) payload.sale_terms = kept;
  else delete payload.sale_terms;
}

/** Crea el ítem. Si ML rechaza la guía o una condición de solo lectura, reintenta sin esos campos. */
async function postNewMercadoLibreItem(
  accessToken: string,
  payload: Record<string, unknown>
): Promise<any> {
  const send = (body: Record<string, unknown>) =>
    axios.post('https://api.mercadolibre.com/items', body, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      validateStatus: () => true,
      timeout: 40000
    });

  const body = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  stripBlockedSaleTerms(body);
  let res = await send(body);
  if (res.status === 201 || res.status === 200) return res.data;

  const message = mlErrorText(res.data);
  const dropGrid = /SIZE_GRID_ID|SIZE_GRID_ROW_ID/i.test(message);
  const dropTerms = /sale term|INSTALLMENTS_CAMPAIGN/i.test(message);
  if (!dropGrid && !dropTerms) {
    throw new TnToMlPublishError(`Mercado Libre rechazó la publicación: ${message}`);
  }
  if (dropGrid) stripSizeGridAttributes(body);
  if (dropTerms) delete body.sale_terms;
  res = await send(body);
  if (res.status !== 201 && res.status !== 200) {
    throw new TnToMlPublishError(`Mercado Libre rechazó la publicación: ${mlErrorText(res.data)}`);
  }
  return res.data;
}

function attributeValue(entry: any): { value_name?: string; value_id?: string } {
  const value_name = String(entry?.value_name ?? entry?.value ?? '').trim();
  const value_id =
    entry?.value_id != null && String(entry.value_id).trim() !== ''
      ? String(entry.value_id).trim()
      : '';
  const out: { value_name?: string; value_id?: string } = {};
  if (value_name && value_name !== 'null') out.value_name = value_name;
  if (value_id) out.value_id = value_id;
  if (!out.value_name && Array.isArray(entry?.values) && entry.values[0]) {
    const name = String(entry.values[0].name ?? entry.values[0].value_name ?? '').trim();
    if (name) out.value_name = name;
  }
  return out;
}

function appendMissingRequired(
  payload: Record<string, unknown>,
  sourceItem: any,
  required: Set<string>
): void {
  const attrs = Array.isArray(payload.attributes) ? [...(payload.attributes as any[])] : [];
  const have = new Set(attrs.map((a) => attrId(a?.id)));
  const source = Array.isArray(sourceItem?.attributes) ? sourceItem.attributes : [];
  for (const id of required) {
    if (have.has(id)) continue;
    if (COLOR_ATTR_IDS.has(id) || SIZE_ATTR_IDS.has(id)) continue;
    if (id === 'SIZE_GRID_ID' || id === 'SIZE_GRID_ROW_ID') continue;
    if (ATTR_BLOCKLIST.has(id)) continue;
    const src = source.find((a: any) => attrId(a?.id) === id);
    if (!src) continue;
    const value = attributeValue(src);
    if (!value.value_name && !value.value_id) continue;
    attrs.push({ id, ...value });
    have.add(id);
  }
  payload.attributes = attrs;
}

function mlErrorText(data: any): string {
  const causes = Array.isArray(data?.cause)
    ? data.cause.map((c: any) => c?.message || c?.code).filter(Boolean)
    : [];
  const base = String(data?.message || data?.error || 'Mercado Libre rechazó la publicación');
  const text = causes.length ? `${base}: ${causes.join('; ')}` : base;
  return text.length > 700 ? `${text.slice(0, 700)}…` : text;
}

async function uploadPicture(accessToken: string, url: string): Promise<string> {
  const img = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 30000,
    validateStatus: () => true,
    headers: { 'User-Agent': TN_USER_AGENT, Accept: 'image/*' },
    maxContentLength: 15 * 1024 * 1024
  });
  if (img.status !== 200 || !img.data) {
    throw new TnToMlPublishError(`No se pudo descargar una foto de Tienda Nube (${img.status})`);
  }
  const contentType = String(img.headers['content-type'] || 'image/jpeg').split(';')[0].trim() || 'image/jpeg';
  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
  const boundary = `LupoHub${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const bytes = Buffer.from(img.data);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="foto.${ext}"\r\nContent-Type: ${contentType}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, bytes, tail]);
  const res = await axios.post('https://api.mercadolibre.com/pictures/items/upload', body, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    },
    maxBodyLength: 20 * 1024 * 1024,
    validateStatus: () => true,
    timeout: 40000
  });
  const id = String(res.data?.id || '').trim();
  if ((res.status !== 201 && res.status !== 200) || !id) {
    throw new TnToMlPublishError(`Mercado Libre no aceptó una foto: ${mlErrorText(res.data)}`);
  }
  return id;
}

async function uploadPictures(accessToken: string, urls: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(urls.map((u) => httpsUrl(u)).filter((u) => u.startsWith('http')))].slice(0, 10);
  if (!unique.length) throw new TnToMlPublishError('La publicación de Tienda Nube no tiene fotos');
  const map = new Map<string, string>();
  let lastError = '';
  for (const url of unique) {
    try {
      const id = await uploadPicture(accessToken, url);
      map.set(url, id);
    } catch (err: any) {
      lastError = err?.message || String(err);
      console.warn('[TN→ML] Foto omitida', url, lastError);
    }
  }
  if (!map.size) {
    throw new TnToMlPublishError(lastError || 'No se pudieron subir las fotos a Mercado Libre');
  }
  return map;
}

function pictureIdsForVariant(
  uploaded: Map<string, string>,
  images: Array<{ src: string }>,
  variant: TnVariantRow
): Array<{ id: string }> {
  const ordered = images.map((im) => im.src);
  if (variant.imageUrl && ordered.includes(variant.imageUrl)) {
    ordered.splice(ordered.indexOf(variant.imageUrl), 1);
    ordered.unshift(variant.imageUrl);
  }
  const ids: Array<{ id: string }> = [];
  const seen = new Set<string>();
  for (const src of ordered) {
    const id = uploaded.get(src);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push({ id });
    if (ids.length >= 10) break;
  }
  return ids;
}

async function prepareVariants(
  sourceItem: any,
  variations: TnVariantRow[],
  accessToken: string,
  userProduct: boolean
): Promise<{ chartId: string; variants: PreparedVariant[] }> {
  const chartId = sizeGridIdFromItem(sourceItem);
  if (userProduct && !chartId) {
    throw new TnToMlPublishError(
      'La publicación modelo no tiene guía de talles (SIZE_GRID_ID). Elegí otra publicación del mismo tipo de prenda.'
    );
  }
  const prepared: PreparedVariant[] = [];
  for (const variant of variations) {
    const letter = sizeLetter(variant.size);
    if (!chartId) {
      prepared.push({ ...variant, sizeName: letter });
      continue;
    }
    const match = await mlFetchSizeGridRowForSize(accessToken, chartId, variant.size || letter);
    if (!match?.rowId) {
      throw new TnToMlPublishError(
        `La guía de talles ${chartId} de la publicación modelo no tiene el talle ${variant.size} (${letter}). Elegí un modelo del mismo tipo de prenda.`
      );
    }
    prepared.push({
      ...variant,
      sizeName: sizeNameFromChartRow(match.row, letter),
      sizeGridRowId: gridRowValue(chartId, match.rowId)
    });
  }
  return { chartId, variants: prepared };
}

async function applyDescription(itemId: string, description: string, accessToken: string): Promise<void> {
  const text = description.trim();
  if (!text) return;
  await axios.post(
    `https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}/description`,
    { plain_text: text },
    {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      validateStatus: () => true,
      timeout: 20000
    }
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function linkCreatedListings(created: CreatedListing[]): Promise<number> {
  let linked = 0;
  for (const row of created) {
    const local = await get(
      `SELECT pv.id AS variant_id, pc.product_id
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       WHERE UPPER(TRIM(pv.sku)) = ?
       LIMIT 1`,
      [row.sku.toUpperCase()]
    );
    if (!local?.variant_id) continue;
    const variantId = String(local.variant_id);
    const variationId = row.variationId || '';
    if (!variationId) {
      await execute(
        `UPDATE product_variants
         SET mercado_libre_item_id = COALESCE(NULLIF(TRIM(mercado_libre_item_id), ''), ?)
         WHERE id = ?`,
        [row.itemId, variantId]
      );
    } else {
      await execute(
        `UPDATE product_variants
         SET mercado_libre_variant_id = COALESCE(NULLIF(TRIM(mercado_libre_variant_id), ''), ?)
         WHERE id = ?`,
        [variationId, variantId]
      );
      await execute(
        `UPDATE products
         SET mercado_libre_id = COALESCE(NULLIF(TRIM(mercado_libre_id), ''), ?)
         WHERE id = ?`,
        [row.itemId, String(local.product_id)]
      );
    }
    await execute(
      `INSERT INTO variant_publications (id, variant_id, platform, external_product_id, external_variant_id, pack_size)
       VALUES (?, ?, 'mercadolibre', ?, ?, 1)
       ON DUPLICATE KEY UPDATE pack_size = VALUES(pack_size)`,
      [uuidv4(), variantId, row.itemId, variationId]
    );
    linked++;
  }
  return linked;
}

function withColor(payload: Record<string, unknown>, colorAttrId: string, color: string): Record<string, unknown> {
  const name = color.trim();
  if (!name) return payload;
  const attrs = Array.isArray(payload.attributes) ? [...(payload.attributes as any[])] : [];
  if (!attrs.some((a) => attrId(a?.id) === colorAttrId)) {
    attrs.push({ id: colorAttrId, value_name: name });
  }
  return { ...payload, attributes: attrs };
}

export async function publishTiendaNubeProductToMercadoLibre(
  productId: string,
  input: { sourceItemId: string; title?: string; price?: number; paused?: boolean; linkLocal?: boolean }
): Promise<{
  message: string;
  mode: 'user_product' | 'classic';
  paused: boolean;
  listings: CreatedListing[];
  variantsLinkedLocal: number;
  failed?: { sku: string; color: string; size: string; message: string };
}> {
  const sourceRaw = normalizeMercadoLibreItemId(input.sourceItemId);
  if (!sourceRaw || !/^ML[A-Z]/.test(sourceRaw)) {
    throw new TnToMlPublishError('Indicá una publicación modelo de Mercado Libre (MLA…)');
  }
  const mlToken = await getValidMLToken();
  if (!mlToken) throw new TnToMlPublishError('No hay integración con Mercado Libre');

  const resolved = await fetchMercadoLibreItemResolved(sourceRaw);
  if (!resolved?.item) {
    throw new TnToMlPublishError('No se encontró la publicación modelo en Mercado Libre', 404);
  }
  const sourceItem = resolved.item;
  const sellerId = String(sourceItem?.seller_id ?? '').trim();
  if (sellerId && String(mlToken.user_id) && sellerId !== String(mlToken.user_id)) {
    throw new TnToMlPublishError(
      'La publicación modelo es de otra cuenta de Mercado Libre. Elegí una publicación de la cuenta conectada.'
    );
  }

  const product = await loadTiendaNubeProduct(String(productId));
  const title = clip(String(input.title || product.title).trim() || product.title, 120);
  const priceInput = Number(input.price);
  const price = Number.isFinite(priceInput) && priceInput > 0 ? priceInput : product.price;
  if (!Number.isFinite(price) || price <= 0) {
    throw new TnToMlPublishError('El precio tiene que ser mayor a 0');
  }
  const paused = input.paused !== false;
  const userProduct = mlItemUsesFamilyNameModel(sourceItem);
  const { chartId, variants } = await prepareVariants(
    sourceItem,
    product.variations,
    mlToken.access_token,
    userProduct
  );

  const uploaded = await uploadPictures(
    mlToken.access_token,
    product.images.map((im) => im.src)
  );
  const sharedPictures = pictureIdsForVariant(uploaded, product.images, variants[0]);
  if (!sharedPictures.length) throw new TnToMlPublishError('No quedaron fotos válidas para Mercado Libre');

  const listing = listingFields(sourceItem);
  if (!listing.category_id) throw new TnToMlPublishError('La publicación modelo no tiene categoría');
  const categoryRules = await loadCategoryRules(mlToken.access_token, String(listing.category_id));
  const colorId = colorAttrIdFromSource(sourceItem);
  const baseAttrs = [
    ...commercialAttributes(sourceItem),
    ...unitFormatAttributes(sourceItem)
  ];
  const shipping = shippingFromItem(sourceItem);
  const saleTerms = saleTermsFromItem(sourceItem);

  const created: CreatedListing[] = [];

  const buildDraft = (variant: PreparedVariant, pictures: Array<{ id: string }>, asUserProduct: boolean) => {
    const qty = Math.max(0, variant.stock);
    const fashion: any[] = [];
    if (chartId) fashion.push({ id: 'SIZE_GRID_ID', value_id: chartId });
    if (variant.sizeGridRowId) fashion.push({ id: 'SIZE_GRID_ROW_ID', value_id: variant.sizeGridRowId });
    if (asUserProduct) fashion.push({ id: 'SIZE', value_name: variant.sizeName });

    const draft: Record<string, unknown> = {
      ...listing,
      price,
      available_quantity: qty,
      pictures,
      attributes: [...baseAttrs, ...fashion],
      sourceAttributes: sourceItem?.attributes,
      seller_custom_field: variant.sku
    };
    if (shipping) draft.shipping = shipping;
    if (saleTerms) draft.sale_terms = saleTerms;
    if (paused) draft.status = 'paused';
    if (asUserProduct) {
      draft.family_name = title;
      draft.userProduct = true;
    } else {
      draft.title = clip(title, 60);
    }
    return draft;
  };

  if (!userProduct) {
    const variations = variants.map((variant) => ({
      price,
      available_quantity: Math.max(0, variant.stock),
      seller_custom_field: variant.sku,
      attribute_combinations: [
        { id: colorId, value_name: variant.color || 'Único' },
        { id: 'SIZE', value_name: variant.sizeName }
      ]
    }));
    const draft = buildDraft(variants[0], sharedPictures, false);
    draft.variations = variations;
    draft.available_quantity = variations.reduce((sum, v) => sum + Number(v.available_quantity || 0), 0);
    delete draft.seller_custom_field;
    try {
      const payload = mlPayloadForMercadoLibreApiPost(draft);
      appendMissingRequired(payload, sourceItem, categoryRules.required);
      if (!categoryAllows(categoryRules, 'SIZE_GRID_ID')) stripSizeGridAttributes(payload);
      const createdItem = await postNewMercadoLibreItem(mlToken.access_token, payload);
      if (createdItem?.id) {
        const itemId = String(createdItem.id);
        await applyDescription(itemId, product.description, mlToken.access_token);
        const remoteVars = Array.isArray(createdItem.variations) ? createdItem.variations : [];
        variants.forEach((variant, idx) => {
          const remote = remoteVars.find(
            (v: any) => String(v?.seller_custom_field || '').trim() === variant.sku
          );
          created.push({
            itemId,
            permalink: String(createdItem.permalink || ''),
            sku: variant.sku,
            color: variant.color,
            size: variant.size,
            variationId: remote?.id != null ? String(remote.id) : remoteVars[idx]?.id != null ? String(remoteVars[idx].id) : undefined
          });
        });
      }
    } catch (err: any) {
      if (err instanceof TnToMlPublishError && !mlCreateErrorRequiresUserProduct(err.message)) throw err;
      if (!(err instanceof TnToMlPublishError) && !mlCreateErrorRequiresUserProduct(String(err?.message || ''))) {
        throw err;
      }
      console.warn('[TN→ML] La categoría exige una publicación por variante. Reintentando.');
    }
  }

  let failed: { sku: string; color: string; size: string; message: string } | undefined;
  if (!created.length) {
    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i];
      try {
        const pictures = pictureIdsForVariant(uploaded, product.images, variant);
        const draft = buildDraft(variant, pictures.length ? pictures : sharedPictures, true);
        const payload = withColor(
          mlPayloadForMercadoLibreApiPost(draft),
          colorId,
          variant.color || 'Único'
        );
        appendMissingRequired(payload, sourceItem, categoryRules.required);
        if (!categoryAllows(categoryRules, 'SIZE_GRID_ID')) stripSizeGridAttributes(payload);
        const createdItem = await postNewMercadoLibreItem(mlToken.access_token, payload);
        const itemId = String(createdItem?.id || '');
        if (!itemId) throw new TnToMlPublishError('Mercado Libre no devolvió el ID de la publicación');
        await applyDescription(itemId, product.description, mlToken.access_token);
        created.push({
          itemId,
          permalink: String(createdItem.permalink || ''),
          sku: variant.sku,
          color: variant.color,
          size: variant.size
        });
        if (i < variants.length - 1) await sleep(350);
      } catch (err: any) {
        failed = {
          sku: variant.sku,
          color: variant.color,
          size: variant.size,
          message: err?.message || 'No se pudo crear la variante'
        };
        break;
      }
    }
  }

  if (!created.length) {
    throw new TnToMlPublishError(failed?.message || 'No se pudo crear la publicación en Mercado Libre');
  }

  let variantsLinkedLocal = 0;
  if (input.linkLocal !== false) {
    try {
      variantsLinkedLocal = await linkCreatedListings(created);
    } catch (err: any) {
      console.warn('[TN→ML] No se pudo vincular el inventario local', err?.message || err);
    }
  }

  const mode: 'user_product' | 'classic' = created.length > 1 && new Set(created.map((c) => c.itemId)).size > 1
    ? 'user_product'
    : created[0]?.variationId
      ? 'classic'
      : 'user_product';
  const pauseNote = paused ? ' Quedó en pausa para que la revises en Mercado Libre.' : '';
  const failNote = failed
    ? ` No se pudo crear ${failed.color} / ${failed.size}: ${failed.message}`
    : '';
  const linkNote =
    variantsLinkedLocal > 0 ? ` ${variantsLinkedLocal} variante(s) vinculada(s) al inventario.` : '';

  return {
    message: `Se crearon ${new Set(created.map((c) => c.itemId)).size} publicación(es) en Mercado Libre.${pauseNote}${linkNote}${failNote}`,
    mode,
    paused,
    listings: created,
    variantsLinkedLocal,
    failed
  };
}
