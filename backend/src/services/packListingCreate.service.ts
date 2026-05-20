import axios from 'axios';
import { get, query } from '../database/db';
import {
  getValidMLToken,
  mercadoLibreItemIdCandidates,
  mlColorSizeFromTitle,
  normalizeMercadoLibreItemId
} from '../controllers/integrations.controller';
import { tnPostWithRetry } from '../utils/tiendanubeClient';
import {
  computeAvailableStockFromItems,
  createPublicationBundle,
  findBundlesByProduct,
  savePublicationBundleGroup,
  type PublicationBundleGroup,
  type PublicationBundlePlatform,
  type PublicationBundleItem
} from './publicationStockBundle.service';

const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';

function appendTitleSuffix(title: string, suffix: string): string {
  const t = (title || '').trim();
  const s = (suffix || '').trim();
  if (!s) return t;
  if (t.toLowerCase().includes(s.toLowerCase())) return t;
  return `${t}${s}`;
}

export type PreviewImageDto = { url: string; pictureId?: string };

export type PackListingPublicationContent = {
  title?: string;
  description?: string;
  price?: number;
  pictures?: Array<{ url?: string; pictureId?: string; selected?: boolean }>;
};

/** URL de mejor calidad para mostrar y publicar (ML suele entregar -I; usamos -O). */
export function mlBestPictureUrl(p: any): string {
  const candidates: unknown[] = [p?.secure_url, p?.url, p?.max_size];
  if (p?.size && typeof p.size === 'object') {
    candidates.push(...Object.values(p.size));
  }
  for (const raw of candidates) {
    let u = String(raw ?? '').trim();
    if (!u.startsWith('http')) continue;
    if (/mlstatic\.com/i.test(u)) {
      u = u.replace(/-([A-Z])\.(jpe?g|png|webp)/gi, '-O.$2');
    }
    return u;
  }
  return '';
}

function collectMlPicturesFromItem(item: any): PreviewImageDto[] {
  const seen = new Set<string>();
  const out: PreviewImageDto[] = [];
  for (const p of Array.isArray(item?.pictures) ? item.pictures : []) {
    const url = mlBestPictureUrl(p);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, pictureId: p?.id != null ? String(p.id) : undefined });
  }
  return out;
}

function mlPicturesPayload(
  content?: PackListingPublicationContent,
  fallbackItem?: any
): Array<{ id?: string; source?: string }> {
  if (content?.pictures?.length) {
    const selected = content.pictures.filter((p) => p.selected !== false);
    const payload = selected
      .map((p) => {
        if (p.pictureId?.trim()) return { id: p.pictureId.trim() };
        const url = String(p.url || '').trim();
        if (url.startsWith('http')) return { source: url };
        return null;
      })
      .filter(Boolean) as Array<{ id?: string; source?: string }>;
    if (payload.length) return payload;
  }
  if (fallbackItem) return mlPicturesFromItem(fallbackItem);
  return [];
}

function mlPicturesFromItem(item: any): Array<{ id?: string; source?: string }> {
  return collectMlPicturesFromItem(item)
    .map((p) => {
      if (p.pictureId) return { id: p.pictureId };
      return { source: p.url };
    })
    .filter((x) => x.id || x.source);
}

async function applyMlItemDescription(
  itemId: string,
  description: string,
  accessToken: string
): Promise<void> {
  const text = String(description || '').trim();
  if (!text) return;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  };
  await axios.post(
    `https://api.mercadolibre.com/items/${itemId}/description`,
    { plain_text: text },
    { headers, validateStatus: () => true }
  );
}

function mlSkuFromItem(item: any): string {
  let s = (item?.seller_sku ?? item?.seller_custom_field ?? '').toString().trim();
  if (!s && Array.isArray(item?.attributes)) {
    const skuAttr = item.attributes.find((a: any) => (a?.id || '').toString().toUpperCase() === 'SELLER_SKU');
    s = (skuAttr ? (skuAttr.value_name ?? skuAttr.value ?? '') : '').toString().trim();
  }
  return s;
}

const ML_COLOR_ATTR_IDS = new Set(['COLOR', 'COLOUR', 'COR']);
const ML_SIZE_ATTR_IDS = new Set(['SIZE', 'SIZE_TYPE', 'TALLE', 'TALLA']);

function mlAttrIdUpper(id: unknown): string {
  return String(id || '').trim().toUpperCase();
}

function mlColorSizeFromVariation(v: any, fallbackTitle?: string): { color: string; size: string } {
  let color = '';
  let size = '';
  (v?.attribute_combinations || []).forEach((attr: any) => {
    const id = mlAttrIdUpper(attr?.id);
    const name = (attr?.value_name || attr?.name || '').toString().trim();
    if (ML_COLOR_ATTR_IDS.has(id)) color = name;
    if (ML_SIZE_ATTR_IDS.has(id)) size = name;
  });
  if ((!color || !size) && fallbackTitle) {
    const parsed = mlColorSizeFromTitle(fallbackTitle);
    if (!color) color = parsed.color;
    if (!size) size = parsed.size;
  }
  return { color: color || 'Único', size: size || 'U' };
}

/** Atributos de variación que exige la publicación origen (p. ej. Color + Talle). */
function mlVariationAttrTemplates(sourceItem: any): Array<{ id: string; name?: string }> {
  const seen = new Set<string>();
  const out: Array<{ id: string; name?: string }> = [];
  for (const v of Array.isArray(sourceItem?.variations) ? sourceItem.variations : []) {
    for (const ac of Array.isArray(v?.attribute_combinations) ? v.attribute_combinations : []) {
      const id = String(ac?.id || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, name: ac?.name });
    }
  }
  if (!out.length) {
    out.push({ id: 'COLOR', name: 'Color' }, { id: 'SIZE', name: 'Talle' });
  }
  return out;
}

function mlValueForVariationAttr(
  attrId: string,
  opts: { color: string; size: string; label: string }
): string {
  const id = mlAttrIdUpper(attrId);
  if (ML_COLOR_ATTR_IDS.has(id)) return opts.color || opts.label || 'Único';
  if (ML_SIZE_ATTR_IDS.has(id)) return opts.size || 'U';
  return opts.label || opts.color || 'Único';
}

function buildMlVariationAttributeCombinations(
  templates: Array<{ id: string; name?: string }>,
  opts: { color: string; size: string; label: string }
): Array<{ id: string; name?: string; value_name: string }> {
  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    value_name: mlValueForVariationAttr(t.id, opts)
  }));
}

/** COLOR + Talle en el formato que exige ML al crear publicaciones pack. */
function buildMlPackVariationAttributeCombinations(opts: {
  color: string;
  size: string;
}): Array<{ id: string; value_name: string }> {
  const colorName = String(opts.color || '').trim() || 'Único';
  const sizeName = String(opts.size || '').trim() || 'U';
  return [
    { id: 'COLOR', value_name: colorName },
    { id: 'SIZE', value_name: sizeName }
  ];
}

function assertValidMlPackVariations(
  variations: Array<Record<string, unknown>>,
  packLabels: string[]
): void {
  if (!variations.length) {
    throw new Error('El pack debe generar al menos una variación de Mercado Libre con COLOR y Talle');
  }
  for (let i = 0; i < variations.length; i++) {
    const label = packLabels[i] || `Combo ${i + 1}`;
    const v = variations[i];
    const price = Number(v.price);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`La variante "${label}" necesita price > 0 para Mercado Libre`);
    }
    const qty = Number(v.available_quantity);
    if (!Number.isFinite(qty) || qty < 0) {
      throw new Error(`La variante "${label}" necesita available_quantity válido`);
    }
    const ac = v.attribute_combinations;
    if (!Array.isArray(ac) || ac.length < 2) {
      throw new Error(
        `La variante "${label}" debe incluir attribute_combinations COLOR y SIZE (no solo el nombre del combo)`
      );
    }
    let hasColor = false;
    let hasSize = false;
    for (const a of ac) {
      const id = mlAttrIdUpper((a as any)?.id);
      const vn = String((a as any)?.value_name ?? '').trim();
      if (ML_COLOR_ATTR_IDS.has(id)) {
        hasColor = true;
        if (!vn) throw new Error(`La variante "${label}" necesita value_name en COLOR`);
      }
      if (ML_SIZE_ATTR_IDS.has(id)) {
        hasSize = true;
        if (!vn) throw new Error(`La variante "${label}" necesita value_name en SIZE/Talle`);
      }
    }
    if (!hasColor || !hasSize) {
      throw new Error(`La variante "${label}" debe incluir COLOR y SIZE en attribute_combinations`);
    }
    if (!String(v.seller_custom_field ?? '').trim()) {
      throw new Error(`La variante "${label}" necesita seller_custom_field (SKU del pack)`);
    }
  }
}

function formatMlCreateError(postRes: { data?: any; statusText?: string }): string {
  const causes = Array.isArray(postRes.data?.cause)
    ? postRes.data.cause.map((c: any) => c.message || c.code || JSON.stringify(c)).filter(Boolean)
    : [];
  const base =
    postRes.data?.message ||
    postRes.data?.error ||
    causes.join('; ') ||
    postRes.statusText ||
    'error desconocido';
  return causes.length ? `${base} (${causes.join('; ')})` : String(base);
}

/** JSON legible para logs/errores (sin volcar URLs de fotos). */
export function summarizeMlItemCreateBody(body: Record<string, unknown>): Record<string, unknown> {
  const pics = Array.isArray(body.pictures) ? body.pictures : [];
  const variations = Array.isArray(body.variations) ? body.variations : [];
  return {
    title: body.title,
    family_name: body.family_name,
    category_id: body.category_id,
    price: body.price,
    available_quantity: body.available_quantity,
    currency_id: body.currency_id,
    buying_mode: body.buying_mode,
    listing_type_id: body.listing_type_id,
    condition: body.condition,
    status: body.status,
    seller_custom_field: body.seller_custom_field,
    pictures: pics.map((p: any) => (p?.id ? { id: p.id } : { source: p?.source ? '(url)' : '?' })),
    attributes: Array.isArray(body.attributes)
      ? body.attributes.map((a: any) => ({ id: a?.id, value_name: a?.value_name }))
      : undefined,
    variations: variations.map((v: any) => ({
      price: v?.price,
      available_quantity: v?.available_quantity,
      seller_custom_field: v?.seller_custom_field,
      attribute_combinations: v?.attribute_combinations
    })),
    _flags: {
      uses_family_name_field: Boolean(String(body.family_name ?? '').trim()),
      has_item_price: body.price != null,
      has_item_stock: body.available_quantity != null,
      variation_count: variations.length
    }
  };
}

function mlAttributesForPackCreate(item: any, skuSuffix: string, opts?: { omitFamilyName?: boolean }): any[] {
  const raw = mlAttributesForDuplicate(item, skuSuffix);
  if (!opts?.omitFamilyName) return raw;
  return raw.filter((a: any) => mlAttrIdUpper(a?.id) !== 'FAMILY_NAME');
}

async function resolvePackVariantColorSize(
  packItems: PublicationBundleItem[],
  sourceItem: any,
  label: string
): Promise<{ color: string; size: string }> {
  let color = '';
  let size = '';
  const ids = packItems.map((i) => i.variantId).filter(Boolean);
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const rows = (await query(
      `SELECT pv.id, c.name AS color_name, s.size_code AS size_code
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN colors c ON c.id = pc.color_id
       JOIN sizes s ON s.id = pv.size_id
       WHERE pv.id IN (${placeholders})`,
      ids
    )) as Array<{ color_name?: string; size_code?: string }>;
    if (rows.length) {
      const sizes = [...new Set(rows.map((r) => String(r.size_code || '').trim()).filter(Boolean))];
      if (sizes.length === 1) size = sizes[0];
      else if (sizes.length > 1) size = sizes[0];
      const colors = rows.map((r) => String(r.color_name || '').trim()).filter(Boolean);
      if (colors.length === 1) color = colors[0];
      else if (colors.length > 1) color = colors.join(' - ');
    }
  }
  const title = String(sourceItem?.title || '').trim();
  const fromSource = mlColorSizeFromVariation(sourceItem?.variations?.[0], title);
  if (!size) size = fromSource.size;
  if (!color) color = label.trim() || fromSource.color;
  return { color: color || 'Único', size: size || 'U' };
}

function mlFamilyNameForPackListing(sourceItem: any): string {
  const fn = mlFamilyNameFromItem(sourceItem);
  if (fn) return fn;
  const title = String(sourceItem?.title || '').trim();
  if (title) return title;
  throw new Error(
    'No se pudo obtener family_name de la publicación origen. Usá una publicación individual del mismo producto.'
  );
}

function mlAttributesForDuplicate(item: any, skuSuffix: string): any[] {
  if (!Array.isArray(item?.attributes)) return [];
  const baseSku = mlSkuFromItem(item);
  const newSku = baseSku ? `${baseSku}${skuSuffix}` : '';
  return item.attributes.map((a: any) => {
    const id = (a?.id || '').toUpperCase();
    if (id === 'SELLER_SKU' && newSku) {
      return { ...a, value_name: newSku, value: newSku };
    }
    return { ...a };
  });
}

/** Publicaciones catalogadas / User Products: exigen family_name + price + available_quantity y variations con COLOR/Talle. */
export function mlItemUsesFamilyNameModel(item: any): boolean {
  if (mlFamilyNameFromItem(item)) return true;
  const up = item?.user_product_id;
  if (up != null && String(up).trim() !== '') return true;
  if (item?.catalog_listing === true) return true;
  return false;
}

function mlFamilyNameFromItem(item: any): string {
  const direct = String(item?.family_name ?? '').trim();
  if (direct) return direct;
  const attr = (Array.isArray(item?.attributes) ? item.attributes : []).find(
    (a: any) => mlAttrIdUpper(a?.id) === 'FAMILY_NAME'
  );
  const fromAttr = (attr?.value_name ?? attr?.value ?? '').toString().trim();
  if (fromAttr) return fromAttr;
  if (item?.user_product_id != null && String(item.user_product_id).trim()) {
    const title = String(item?.title || '').trim();
    if (title) return title;
  }
  return '';
}

function mlCommonItemFields(
  sourceItem: any,
  pictures: Array<{ id?: string; source?: string }>
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    category_id: sourceItem.category_id,
    currency_id: sourceItem.currency_id || 'ARS',
    buying_mode: sourceItem.buying_mode || 'buy_it_now',
    listing_type_id: sourceItem.listing_type_id || 'gold_special',
    condition: sourceItem.condition || 'new',
    pictures
  };
  if (sourceItem.video_id) out.video_id = sourceItem.video_id;
  if (Array.isArray(sourceItem.sale_terms) && sourceItem.sale_terms.length) {
    out.sale_terms = sourceItem.sale_terms;
  }
  if (sourceItem.shipping && typeof sourceItem.shipping === 'object') {
    out.shipping = sourceItem.shipping;
  }
  return out;
}

async function postMercadoLibreNewItem(
  accessToken: string,
  body: Record<string, unknown>,
  debugContext?: string
): Promise<any> {
  const payloadPreview = summarizeMlItemCreateBody(body);
  const ctx = debugContext ? ` (${debugContext})` : '';
  console.log(`[ML POST /items]${ctx}`, JSON.stringify(payloadPreview, null, 2));

  const postRes = await axios.post('https://api.mercadolibre.com/items', body, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    validateStatus: () => true
  });
  if (postRes.status !== 201 && postRes.status !== 200) {
    const preview = JSON.stringify(payloadPreview);
    throw new Error(
      `Mercado Libre rechazó la creación: ${formatMlCreateError(postRes)}. Payload enviado: ${preview}`
    );
  }
  const newItem = postRes.data;
  const itemId = String(newItem?.id || '');
  if (!itemId) throw new Error('Mercado Libre no devolvió el ID de la nueva publicación');
  return newItem;
}

async function applyDescriptionFromSource(
  newItemId: string,
  sourceItem: any,
  accessToken: string,
  descriptionOverride?: string
): Promise<void> {
  let description = descriptionOverride?.trim() || '';
  if (!description) {
    try {
      const descRes = await axios.get(`https://api.mercadolibre.com/items/${sourceItem.id}/description`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true
      });
      if (descRes.status === 200) description = String(descRes.data?.plain_text || '').trim();
    } catch {
      /* opcional */
    }
  }
  await applyMlItemDescription(newItemId, description, accessToken);
}

/** Convierte variantes internas (label + items) al array `variations` de ML. */
async function buildMlPackVariations(
  sourceItem: any,
  packVariants: Array<{ label: string; items: PublicationBundleItem[] }>,
  opts: { skuSuffix: string; price: number }
): Promise<Array<Record<string, unknown>>> {
  if (!Number.isFinite(opts.price) || opts.price <= 0) {
    throw new Error('Indicá un precio válido para la publicación pack');
  }

  const baseSku = mlSkuFromItem(sourceItem);
  const rows = await Promise.all(
    packVariants.map(async (pv, idx) => {
      const stock = computeAvailableStockFromItems(pv.items);
      const comboLabel = (pv.label || `Combo ${idx + 1}`).trim();
      const { color, size } = await resolvePackVariantColorSize(pv.items, sourceItem, comboLabel);
      const varSku =
        baseSku && packVariants.length > 1
          ? `${baseSku}${opts.skuSuffix}-${idx + 1}`
          : baseSku
            ? `${baseSku}${opts.skuSuffix}`
            : `PACK${opts.skuSuffix}-${idx + 1}`;
      return {
        price: opts.price,
        available_quantity: Math.max(0, Math.floor(stock)),
        attribute_combinations: buildMlPackVariationAttributeCombinations({ color, size }),
        seller_custom_field: varSku
      };
    })
  );

  assertValidMlPackVariations(
    rows,
    packVariants.map((pv, i) => (pv.label || `Combo ${i + 1}`).trim())
  );
  return rows;
}

async function buildMercadoLibrePackListingBody(
  sourceItem: any,
  packVariants: Array<{ label: string; items: PublicationBundleItem[] }>,
  opts: {
    titleSuffix: string;
    skuSuffix: string;
    status?: 'active' | 'paused';
    content?: PackListingPublicationContent;
  }
): Promise<Record<string, unknown>> {
  if (!packVariants.length) throw new Error('Agregá al menos una combinación de colores');

  const pictures = mlPicturesPayload(opts.content, sourceItem);
  if (!pictures.length) throw new Error('Seleccioná al menos una foto para la publicación');

  const title =
    opts.content?.title?.trim() ||
    appendTitleSuffix(String(sourceItem.title || 'Pack'), opts.titleSuffix);
  const price =
    opts.content?.price != null && Number.isFinite(Number(opts.content.price))
      ? Number(opts.content.price)
      : Number(sourceItem.price) || 0;

  const familyName = mlFamilyNameForPackListing(sourceItem);
  const variations = await buildMlPackVariations(sourceItem, packVariants, {
    skuSuffix: opts.skuSuffix,
    price
  });

  const itemQty = variations.reduce(
    (sum, v) => sum + Math.max(0, Number(v.available_quantity) || 0),
    0
  );

  const body: Record<string, unknown> = {
    title,
    family_name: familyName,
    price,
    available_quantity: itemQty,
    ...mlCommonItemFields(sourceItem, pictures),
    variations
  };

  const attrs = mlAttributesForPackCreate(sourceItem, opts.skuSuffix, { omitFamilyName: true });
  if (attrs.length) body.attributes = attrs;
  if (opts.status === 'paused') body.status = 'paused';

  return body;
}

export type PublicationSourcePreview = {
  platform: PublicationBundlePlatform;
  resolvedId: string;
  title: string;
  description: string;
  images: PreviewImageDto[];
  price?: number;
};

function localizedTnText(field: unknown): string {
  if (field == null) return '';
  if (typeof field === 'string') return field.trim();
  if (typeof field === 'object') {
    const o = field as Record<string, unknown>;
    for (const k of ['es', 'es_AR', 'en', 'pt']) {
      const v = o[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    const first = Object.values(o).find((v) => typeof v === 'string' && String(v).trim());
    if (typeof first === 'string') return first.trim();
  }
  return '';
}

export async function fetchPublicationSourcePreview(
  platform: PublicationBundlePlatform,
  rawId: string
): Promise<PublicationSourcePreview | null> {
  const id = String(rawId || '').trim();
  if (!id) return null;

  if (platform === 'mercadolibre') {
    const resolved = await fetchMercadoLibreItemResolved(id);
    if (!resolved) return null;
    const { item, itemId } = resolved;
    let description = '';
    const mlToken = await getValidMLToken();
    if (mlToken) {
      try {
        const descRes = await axios.get(`https://api.mercadolibre.com/items/${itemId}/description`, {
          headers: { Authorization: `Bearer ${mlToken.access_token}` },
          validateStatus: () => true
        });
        if (descRes.status === 200) {
          description = (descRes.data?.plain_text ?? descRes.data?.text ?? '').toString().trim();
        }
      } catch {
        /* sin descripción */
      }
    }
    if (!description && item.subtitle) description = String(item.subtitle).trim();
    const images = collectMlPicturesFromItem(item);
    return {
      platform: 'mercadolibre',
      resolvedId: itemId,
      title: String(item.title || '').trim(),
      description,
      images,
      price: Number(item.price) || undefined
    };
  }

  const integration = await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
  if (!integration?.access_token) return null;
  const storeId = integration.store_id || integration.user_id;
  if (!storeId) return null;
  const tnId = id.replace(/\D/g, '') || id;
  const headers = { Authentication: `bearer ${integration.access_token}`, 'User-Agent': TN_USER_AGENT };
  const productRes = await axios.get(`https://api.tiendanube.com/v1/${storeId}/products/${tnId}`, {
    headers,
    validateStatus: () => true
  });
  if (productRes.status !== 200 || !productRes.data) return null;
  const p = productRes.data;
  const description = localizedTnText(p.description) || localizedTnText(p.seo_description);
  const images: PreviewImageDto[] = (Array.isArray(p.images) ? p.images : [])
    .map((im: any) => {
      const url = im?.src ? String(im.src).trim() : '';
      return url.startsWith('http') ? { url, pictureId: im?.id != null ? String(im.id) : undefined } : null;
    })
    .filter(Boolean) as PreviewImageDto[];
  const variants = await fetchAllTnVariants(storeId, integration.access_token, String(tnId));
  const price = variants[0]?.price != null ? Number(variants[0].price) : undefined;
  return {
    platform: 'tiendanube',
    resolvedId: String(p.id ?? tnId),
    title: localizedTnText(p.name),
    description,
    images,
    price: Number.isFinite(price) ? price : undefined
  };
}

export async function fetchMercadoLibreItemResolved(rawItemId: string): Promise<{ item: any; itemId: string } | null> {
  const mlToken = await getValidMLToken();
  if (!mlToken) return null;
  const candidates = mercadoLibreItemIdCandidates(rawItemId);
  if (!candidates.length) return null;
  const headers = { Authorization: `Bearer ${mlToken.access_token}` };
  for (const candidate of candidates) {
    try {
      const r = await axios.get(`https://api.mercadolibre.com/items/${candidate}?include_attributes=all`, {
        headers,
        validateStatus: () => true
      });
      if (r.status === 200 && r.data && !r.data.error) {
        return { item: r.data, itemId: String(r.data.id || candidate) };
      }
    } catch {
      /* siguiente candidato */
    }
  }
  return null;
}

export async function createMercadoLibrePackListingFromItem(
  sourceItem: any,
  opts: {
    titleSuffix: string;
    skuSuffix: string;
    availableQuantity: number;
    status?: 'active' | 'paused';
    content?: PackListingPublicationContent;
    packItems?: PublicationBundleItem[];
    packLabel?: string;
  }
): Promise<{ itemId: string; item: any }> {
  const created = await createMercadoLibrePackListingWithVariants(
    sourceItem,
    [{ label: (opts.packLabel || '').trim(), items: opts.packItems || [] }],
    {
      titleSuffix: opts.titleSuffix,
      skuSuffix: opts.skuSuffix,
      status: opts.status,
      content: opts.content
    }
  );
  return { itemId: created.itemId, item: created.item };
}

export async function createMercadoLibrePackListingWithVariants(
  sourceItem: any,
  packVariants: Array<{ label: string; items: PublicationBundleItem[] }>,
  opts: {
    titleSuffix: string;
    skuSuffix: string;
    status?: 'active' | 'paused';
    content?: PackListingPublicationContent;
  }
): Promise<{ itemId: string; item: any; variationIds: string[] }> {
  const mlToken = await getValidMLToken();
  if (!mlToken) throw new Error('No hay integración con Mercado Libre');

  const body = await buildMercadoLibrePackListingBody(sourceItem, packVariants, opts);

  const newItem = await postMercadoLibreNewItem(
    mlToken.access_token,
    body,
    `pack listing variants=${packVariants.length}`
  );
  const itemId = String(newItem.id);

  const variationIds = (Array.isArray(newItem.variations) ? newItem.variations : []).map((v: any) =>
    String(v?.id || '')
  );

  await applyDescriptionFromSource(itemId, sourceItem, mlToken.access_token, opts.content?.description);

  return { itemId, item: newItem, variationIds };
}

function tnImagesFromContent(
  content?: PackListingPublicationContent,
  product?: any
): Array<{ src: string }> {
  if (content?.pictures?.length) {
    const imgs = content.pictures
      .filter((p) => p.selected !== false)
      .map((p) => String(p.url || '').trim())
      .filter((u) => u.startsWith('http'))
      .map((src) => ({ src }));
    if (imgs.length) return imgs;
  }
  return (Array.isArray(product?.images) ? product.images : [])
    .map((im: any) => (im?.src ? { src: String(im.src) } : null))
    .filter(Boolean) as Array<{ src: string }>;
}

function tnDescriptionFromContent(content?: PackListingPublicationContent, product?: any): Record<string, string> {
  const text = content?.description?.trim();
  if (text) return { es: text, en: text, pt: text };
  const base = product?.description;
  if (base && typeof base === 'object') return { ...base };
  if (typeof base === 'string' && base.trim()) return { es: base.trim(), en: '', pt: '' };
  return { es: '', en: '', pt: '' };
}

function appendSuffixToLocalizedName(field: any, suffix: string): any {
  if (!suffix) return field;
  if (field == null) return field;
  if (typeof field === 'string') return `${field}${suffix}`;
  if (typeof field === 'object') {
    const out: Record<string, string> = { ...field };
    for (const k of Object.keys(out)) {
      const v = out[k];
      if (typeof v === 'string' && v.trim()) out[k] = `${v}${suffix}`;
    }
    return out;
  }
  return field;
}

function tiendaNubeCategoryIdsOnly(raw: any): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c: any) => (typeof c === 'object' && c != null ? c.id : c))
    .filter((id: any) => id != null && String(id).trim() !== '')
    .map((id: any) => Number(id))
    .filter((n: number) => Number.isFinite(n));
}

function stripVariantForTiendaNubeCreate(v: any, skuSuffix: string, idx: number, stock: number): any {
  const baseSku =
    v?.sku != null && String(v.sku).trim() !== '' ? String(v.sku).trim() : `VAR-${idx + 1}`;
  return {
    price: v?.price != null ? String(v.price) : '0',
    stock_management: true,
    stock: Math.max(0, Math.floor(stock)),
    sku: `${baseSku}${skuSuffix}`,
    values: Array.isArray(v?.values) ? v.values : []
  };
}

async function fetchAllTnVariants(storeId: string, accessToken: string, productId: string): Promise<any[]> {
  const headers = { Authentication: `bearer ${accessToken}`, 'User-Agent': TN_USER_AGENT };
  let variantsList: any[] = [];
  let vPage = 1;
  let hasMore = true;
  while (hasMore) {
    const variantsRes = await axios.get(
      `https://api.tiendanube.com/v1/${storeId}/products/${productId}/variants`,
      { headers, params: { page: vPage, per_page: 200 }, validateStatus: () => true }
    );
    const chunk = variantsRes.status === 200 && Array.isArray(variantsRes.data) ? variantsRes.data : [];
    variantsList = variantsList.concat(chunk);
    if (chunk.length < 200) hasMore = false;
    else vPage++;
    if (vPage > 50) hasMore = false;
  }
  return variantsList;
}

export async function createTiendaNubePackListingFromProduct(
  sourceProductId: string,
  opts: {
    titleSuffix: string;
    skuSuffix: string;
    availableQuantity: number;
    published: boolean;
    content?: PackListingPublicationContent;
  }
): Promise<{ productId: number; variantId: number }> {
  const integration = await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
  if (!integration?.access_token) throw new Error('No hay integración con Tienda Nube');
  const storeId = integration.store_id || integration.user_id;
  if (!storeId) throw new Error('No se encontró store_id de Tienda Nube');

  const headers = { Authentication: `bearer ${integration.access_token}`, 'User-Agent': TN_USER_AGENT };
  const productRes = await axios.get(`https://api.tiendanube.com/v1/${storeId}/products/${sourceProductId}`, {
    headers,
    validateStatus: () => true
  });
  if (productRes.status !== 200) {
    throw new Error('Producto no encontrado en Tienda Nube');
  }

  const p = productRes.data;
  const variantsList = await fetchAllTnVariants(storeId, integration.access_token, String(sourceProductId));
  const baseVariant = variantsList[0] || { price: '0', values: [] };
  const packVariant = stripVariantForTiendaNubeCreate(
    baseVariant,
    opts.skuSuffix,
    0,
    opts.availableQuantity
  );
  if (opts.content?.price != null && Number.isFinite(Number(opts.content.price))) {
    packVariant.price = String(opts.content.price);
  }

  const tnName = opts.content?.title?.trim()
    ? { es: opts.content.title.trim(), en: opts.content.title.trim(), pt: opts.content.title.trim() }
    : appendSuffixToLocalizedName(p.name, opts.titleSuffix);

  const body: any = {
    name: tnName,
    description: tnDescriptionFromContent(opts.content, p),
    attributes: Array.isArray(p.attributes) ? p.attributes : [],
    categories: tiendaNubeCategoryIdsOnly(p.categories),
    published: opts.published,
    free_shipping: !!p.free_shipping,
    tags: typeof p.tags === 'string' ? p.tags : '',
    variants: [packVariant]
  };
  if (p.brand != null && String(p.brand).trim() !== '') body.brand = p.brand;
  if (p.video_url && String(p.video_url).startsWith('https://')) body.video_url = p.video_url;
  const imgs = tnImagesFromContent(opts.content, p);
  if (imgs.length > 0) body.images = imgs.slice(0, 250);
  else throw new Error('Seleccioná al menos una imagen para la publicación');

  const url = `https://api.tiendanube.com/v1/${storeId}/products`;
  const postHeaders = { ...headers, 'Content-Type': 'application/json' };
  const r = await tnPostWithRetry(axios, url, body, { headers: postHeaders, validateStatus: () => true });
  if (r.status !== 201) {
    const detail = r.data?.description || r.data?.message || r.statusText;
    throw new Error(`Tienda Nube rechazó la creación: ${detail}`);
  }

  const newId = Number(r.data?.id);
  if (!Number.isFinite(newId)) throw new Error('Tienda Nube no devolvió el ID del nuevo producto');

  const newVariants = await fetchAllTnVariants(storeId, integration.access_token, String(newId));
  const variantId = Number(newVariants[0]?.id);
  if (!Number.isFinite(variantId)) {
    throw new Error('No se pudo obtener la variante del nuevo producto en Tienda Nube');
  }

  return { productId: newId, variantId };
}

export async function createTiendaNubePackListingWithVariants(
  sourceProductId: string,
  packVariants: Array<{ label: string; items: PublicationBundleItem[] }>,
  opts: {
    titleSuffix: string;
    skuSuffix: string;
    published: boolean;
    content?: PackListingPublicationContent;
  }
): Promise<{ productId: number; variantIds: number[] }> {
  const integration = await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
  if (!integration?.access_token) throw new Error('No hay integración con Tienda Nube');
  const storeId = integration.store_id || integration.user_id;
  if (!storeId) throw new Error('No se encontró store_id de Tienda Nube');

  const headers = { Authentication: `bearer ${integration.access_token}`, 'User-Agent': TN_USER_AGENT };
  const productRes = await axios.get(`https://api.tiendanube.com/v1/${storeId}/products/${sourceProductId}`, {
    headers,
    validateStatus: () => true
  });
  if (productRes.status !== 200) throw new Error('Producto no encontrado en Tienda Nube');

  const p = productRes.data;
  const variantsList = await fetchAllTnVariants(storeId, integration.access_token, String(sourceProductId));
  const baseVariant = variantsList[0] || { price: '0', values: [] };
  const valueTemplate = Array.isArray(baseVariant.values) && baseVariant.values.length > 0 ? baseVariant.values : [];

  const basePrice =
    opts.content?.price != null && Number.isFinite(Number(opts.content.price))
      ? String(opts.content.price)
      : null;

  const attrNames = (Array.isArray(p.attributes) ? p.attributes : []).map((a: any) =>
    localizedTnText(a).toLowerCase()
  );
  const tnVariants = await Promise.all(
    packVariants.map(async (pv, idx) => {
      const stock = computeAvailableStockFromItems(pv.items);
      const comboLabel = (pv.label || `Combo ${idx + 1}`).trim();
      const { color, size } = await resolvePackVariantColorSize(pv.items, {}, comboLabel);
      const values =
        valueTemplate.length > 0
          ? valueTemplate.map((val: any, i: number) => {
              const attrLabel = attrNames[i] || '';
              let text = comboLabel;
              if (/color/i.test(attrLabel)) text = color;
              else if (/talle|talla|size/i.test(attrLabel)) text = size;
              else if (i === 0) text = color;
              else if (i === 1) text = size;
              return { ...val, es: text, en: text, pt: text };
            })
          : [
              { es: color, en: color, pt: color },
              { es: size, en: size, pt: size }
            ];
      const row = {
        ...stripVariantForTiendaNubeCreate(baseVariant, `${opts.skuSuffix}-${idx + 1}`, idx, stock),
        values
      };
      if (basePrice) row.price = basePrice;
      return row;
    })
  );

  const tnName = opts.content?.title?.trim()
    ? { es: opts.content.title.trim(), en: opts.content.title.trim(), pt: opts.content.title.trim() }
    : appendSuffixToLocalizedName(p.name, opts.titleSuffix);

  const body: any = {
    name: tnName,
    description: tnDescriptionFromContent(opts.content, p),
    attributes: Array.isArray(p.attributes) ? p.attributes : [],
    categories: tiendaNubeCategoryIdsOnly(p.categories),
    published: opts.published,
    free_shipping: !!p.free_shipping,
    tags: typeof p.tags === 'string' ? p.tags : '',
    variants: tnVariants
  };
  if (p.brand != null && String(p.brand).trim() !== '') body.brand = p.brand;
  const imgs = tnImagesFromContent(opts.content, p);
  if (imgs.length > 0) body.images = imgs.slice(0, 250);
  else throw new Error('Seleccioná al menos una imagen para la publicación');

  const url = `https://api.tiendanube.com/v1/${storeId}/products`;
  const postHeaders = { ...headers, 'Content-Type': 'application/json' };
  const r = await tnPostWithRetry(axios, url, body, { headers: postHeaders, validateStatus: () => true });
  if (r.status !== 201) {
    const detail = r.data?.description || r.data?.message || r.statusText;
    throw new Error(`Tienda Nube rechazó la creación: ${detail}`);
  }

  const newId = Number(r.data?.id);
  if (!Number.isFinite(newId)) throw new Error('Tienda Nube no devolvió el ID del nuevo producto');

  const newVariants = await fetchAllTnVariants(storeId, integration.access_token, String(newId));
  const variantIds = newVariants.map((v) => Number(v?.id)).filter((n) => Number.isFinite(n));
  return { productId: newId, variantIds };
}

async function bundleItemsWithStock(
  items: Array<{ variantId: string; unitsPerSale?: number }>
): Promise<PublicationBundleItem[]> {
  const out: PublicationBundleItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.variantId?.trim()) continue;
    const row = await get(
      `SELECT COALESCE(s.stock, 0) AS stock, pv.sku FROM product_variants pv
       LEFT JOIN stocks s ON s.variant_id = pv.id WHERE pv.id = ?`,
      [it.variantId.trim()]
    );
    out.push({
      id: '',
      variantId: it.variantId.trim(),
      unitsPerSale: Math.max(1, Math.floor(Number(it.unitsPerSale) || 1)),
      sortOrder: i,
      sku: row?.sku ?? '',
      stock: Number(row?.stock) || 0
    });
  }
  return out;
}

type PackVariantInput = {
  label?: string;
  items: Array<{ variantId: string; unitsPerSale?: number }>;
};

export async function createPackListingAndBundle(input: {
  platform: PublicationBundlePlatform;
  sourceExternalProductId: string;
  titleSuffix?: string;
  skuSuffix?: string;
  label?: string;
  published?: boolean;
  items?: Array<{ variantId: string; unitsPerSale?: number }>;
  variants?: PackVariantInput[];
  publicationContent?: PackListingPublicationContent;
}): Promise<{
  group: PublicationBundleGroup;
  newExternalProductId: string;
  sourceExternalProductId: string;
  message: string;
}> {
  const variantInputs: PackVariantInput[] =
    input.variants?.length
      ? input.variants
      : input.items?.length
        ? [{ label: input.label, items: input.items }]
        : [];
  if (!variantInputs.length) {
    throw new Error('Agregá al menos una combinación de colores (variante de pack)');
  }

  const titleSuffix = (input.titleSuffix ?? ' (Pack)').toString();
  const skuSuffix = (input.skuSuffix ?? '-PACK').toString();
  const sourceId = String(input.sourceExternalProductId || '').trim();
  if (!sourceId) throw new Error('Indicá la publicación individual de origen (ID o link)');

  const packVariants: Array<{ label: string; items: PublicationBundleItem[]; rawItems: PackVariantInput['items'] }> =
    [];
  for (let i = 0; i < variantInputs.length; i++) {
    const vi = variantInputs[i];
    const items = await bundleItemsWithStock(vi.items || []);
    if (!items.length) continue;
    packVariants.push({
      label: (vi.label || `Combo ${i + 1}`).trim(),
      items,
      rawItems: vi.items
    });
  }
  if (!packVariants.length) throw new Error('Cada variante debe tener al menos un color/componente');

  let newProductId = '';
  const bundleVariants: Array<{
    label: string;
    externalVariantId?: string;
    items: PackVariantInput['items'];
  }> = [];

  if (input.platform === 'mercadolibre') {
    const resolved = await fetchMercadoLibreItemResolved(sourceId);
    if (!resolved) throw new Error('Publicación origen no encontrada en Mercado Libre');

    if (packVariants.length === 1) {
      const created = await createMercadoLibrePackListingFromItem(resolved.item, {
        titleSuffix,
        skuSuffix,
        availableQuantity: computeAvailableStockFromItems(packVariants[0].items),
        status: input.published === false ? 'paused' : 'active',
        content: input.publicationContent,
        packItems: packVariants[0].items,
        packLabel: packVariants[0].label
      });
      newProductId = created.itemId;
      bundleVariants.push({
        label: packVariants[0].label,
        externalVariantId: '',
        items: packVariants[0].rawItems
      });
    } else {
      const created = await createMercadoLibrePackListingWithVariants(resolved.item, packVariants, {
        titleSuffix,
        skuSuffix,
        status: input.published === false ? 'paused' : 'active',
        content: input.publicationContent
      });
      newProductId = created.itemId;
      packVariants.forEach((pv, idx) => {
        bundleVariants.push({
          label: pv.label,
          externalVariantId: created.variationIds[idx] || '',
          items: pv.rawItems
        });
      });
    }
  } else {
    const tnSourceId = sourceId.replace(/\D/g, '') || sourceId;
    if (packVariants.length === 1) {
      const created = await createTiendaNubePackListingFromProduct(tnSourceId, {
        titleSuffix,
        skuSuffix,
        availableQuantity: computeAvailableStockFromItems(packVariants[0].items),
        published: input.published !== false,
        content: input.publicationContent
      });
      newProductId = String(created.productId);
      bundleVariants.push({
        label: packVariants[0].label,
        externalVariantId: String(created.variantId),
        items: packVariants[0].rawItems
      });
    } else {
      const created = await createTiendaNubePackListingWithVariants(tnSourceId, packVariants, {
        titleSuffix,
        skuSuffix,
        published: input.published !== false,
        content: input.publicationContent
      });
      newProductId = String(created.productId);
      packVariants.forEach((pv, idx) => {
        bundleVariants.push({
          label: pv.label,
          externalVariantId: String(created.variantIds[idx] || ''),
          items: pv.rawItems
        });
      });
    }
  }

  const group = await savePublicationBundleGroup({
    platform: input.platform,
    externalProductId: newProductId,
    listingLabel: input.label?.trim() || null,
    variants: bundleVariants.map((v) => ({
      label: v.label,
      externalVariantId: v.externalVariantId,
      items: v.items
    }))
  });

  const n = group.variants.length;
  return {
    group,
    newExternalProductId: newProductId,
    sourceExternalProductId: normalizeMercadoLibreItemId(sourceId) || sourceId,
    message:
      input.platform === 'mercadolibre'
        ? `Publicación pack en ML (${newProductId}) con ${n} variante(s) de colores y mismas fotos`
        : `Producto pack en TN (${newProductId}) con ${n} variante(s) y mismas imágenes`
  };
}
