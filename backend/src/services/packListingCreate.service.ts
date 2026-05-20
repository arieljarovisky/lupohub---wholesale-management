import axios from 'axios';
import { get } from '../database/db';
import {
  getValidMLToken,
  mercadoLibreItemIdCandidates,
  normalizeMercadoLibreItemId
} from '../controllers/integrations.controller';
import { tnPostWithRetry } from '../utils/tiendanubeClient';
import {
  computeAvailableStockFromItems,
  createPublicationBundle,
  type PublicationBundle,
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

function mlPicturesFromItem(item: any): Array<{ id?: string; source?: string }> {
  return (Array.isArray(item?.pictures) ? item.pictures : [])
    .slice(0, 12)
    .map((p: any) => {
      if (p?.id) return { id: String(p.id) };
      const url = p?.secure_url || p?.url;
      if (url && String(url).startsWith('http')) return { source: String(url) };
      return null;
    })
    .filter(Boolean) as Array<{ id?: string; source?: string }>;
}

function mlSkuFromItem(item: any): string {
  let s = (item?.seller_sku ?? item?.seller_custom_field ?? '').toString().trim();
  if (!s && Array.isArray(item?.attributes)) {
    const skuAttr = item.attributes.find((a: any) => (a?.id || '').toString().toUpperCase() === 'SELLER_SKU');
    s = (skuAttr ? (skuAttr.value_name ?? skuAttr.value ?? '') : '').toString().trim();
  }
  return s;
}

function mlAttributesForDuplicate(item: any, skuSuffix: string): any[] {
  if (!Array.isArray(item?.attributes)) return [];
  const baseSku = mlSkuFromItem(item);
  const newSku = baseSku ? `${baseSku}${skuSuffix}` : '';
  return item.attributes.map((a: any) => {
    const id = (a?.id || '').toString().toUpperCase();
    if (id === 'SELLER_SKU' && newSku) {
      return { ...a, value_name: newSku, value: newSku };
    }
    return { ...a };
  });
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
  opts: { titleSuffix: string; skuSuffix: string; availableQuantity: number; status?: 'active' | 'paused' }
): Promise<{ itemId: string; item: any }> {
  const mlToken = await getValidMLToken();
  if (!mlToken) throw new Error('No hay integración con Mercado Libre');

  const pictures = mlPicturesFromItem(sourceItem);
  if (!pictures.length) {
    throw new Error('La publicación origen no tiene fotos para copiar');
  }

  const title = appendTitleSuffix(String(sourceItem.title || 'Pack'), opts.titleSuffix);
  const body: Record<string, unknown> = {
    title,
    category_id: sourceItem.category_id,
    price: Number(sourceItem.price) || 0,
    currency_id: sourceItem.currency_id || 'ARS',
    available_quantity: Math.max(0, Math.floor(opts.availableQuantity)),
    buying_mode: sourceItem.buying_mode || 'buy_it_now',
    listing_type_id: sourceItem.listing_type_id || 'gold_special',
    condition: sourceItem.condition || 'new',
    pictures
  };

  const attrs = mlAttributesForDuplicate(sourceItem, opts.skuSuffix);
  if (attrs.length) body.attributes = attrs;

  const sku = mlSkuFromItem(sourceItem);
  if (sku) body.seller_custom_field = `${sku}${opts.skuSuffix}`;

  if (sourceItem.video_id) body.video_id = sourceItem.video_id;
  if (Array.isArray(sourceItem.sale_terms) && sourceItem.sale_terms.length) {
    body.sale_terms = sourceItem.sale_terms;
  }
  if (sourceItem.shipping && typeof sourceItem.shipping === 'object') {
    body.shipping = sourceItem.shipping;
  }
  if (opts.status === 'paused') body.status = 'paused';

  const headers = {
    Authorization: `Bearer ${mlToken.access_token}`,
    'Content-Type': 'application/json'
  };
  const postRes = await axios.post('https://api.mercadolibre.com/items', body, {
    headers,
    validateStatus: () => true
  });

  if (postRes.status !== 201 && postRes.status !== 200) {
    const msg =
      postRes.data?.message ||
      postRes.data?.error ||
      (Array.isArray(postRes.data?.cause) ? postRes.data.cause.map((c: any) => c.message).join('; ') : null) ||
      postRes.statusText;
    throw new Error(`Mercado Libre rechazó la creación: ${msg}`);
  }

  const newItem = postRes.data;
  const itemId = String(newItem?.id || '');
  if (!itemId) throw new Error('Mercado Libre no devolvió el ID de la nueva publicación');

  try {
    const descRes = await axios.get(`https://api.mercadolibre.com/items/${sourceItem.id}/description`, {
      headers: { Authorization: `Bearer ${mlToken.access_token}` },
      validateStatus: () => true
    });
    if (descRes.status === 200 && descRes.data?.plain_text) {
      await axios.post(
        `https://api.mercadolibre.com/items/${itemId}/description`,
        { plain_text: descRes.data.plain_text },
        { headers, validateStatus: () => true }
      );
    }
  } catch {
    /* descripción opcional */
  }

  return { itemId, item: newItem };
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
  opts: { titleSuffix: string; skuSuffix: string; availableQuantity: number; published: boolean }
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

  const body: any = {
    name: appendSuffixToLocalizedName(p.name, opts.titleSuffix),
    description: p.description ?? { es: '', en: '', pt: '' },
    attributes: Array.isArray(p.attributes) ? p.attributes : [],
    categories: tiendaNubeCategoryIdsOnly(p.categories),
    published: opts.published,
    free_shipping: !!p.free_shipping,
    tags: typeof p.tags === 'string' ? p.tags : '',
    variants: [packVariant]
  };
  if (p.brand != null && String(p.brand).trim() !== '') body.brand = p.brand;
  if (p.video_url && String(p.video_url).startsWith('https://')) body.video_url = p.video_url;
  const imgs = (Array.isArray(p.images) ? p.images : [])
    .slice(0, 9)
    .map((im: any) => (im?.src ? { src: im.src } : null))
    .filter(Boolean);
  if (imgs.length > 0) body.images = imgs;
  else throw new Error('El producto origen no tiene imágenes para copiar');

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

export async function createPackListingAndBundle(input: {
  platform: PublicationBundlePlatform;
  sourceExternalProductId: string;
  titleSuffix?: string;
  skuSuffix?: string;
  label?: string;
  published?: boolean;
  items: Array<{ variantId: string; unitsPerSale?: number }>;
}): Promise<{
  bundle: PublicationBundle;
  newExternalProductId: string;
  newExternalVariantId: string;
  sourceExternalProductId: string;
  message: string;
}> {
  if (!input.items?.length) throw new Error('Agregá al menos una variante al pack');

  const titleSuffix = (input.titleSuffix ?? ' (Pack)').toString();
  const skuSuffix = (input.skuSuffix ?? '-PACK').toString();
  const sourceId = String(input.sourceExternalProductId || '').trim();
  if (!sourceId) throw new Error('Indicá la publicación individual de origen (ID o link)');

  const draftItems = await bundleItemsWithStock(input.items);
  const packStock = computeAvailableStockFromItems(draftItems);

  let newProductId = '';
  let newVariantId = '';

  if (input.platform === 'mercadolibre') {
    const resolved = await fetchMercadoLibreItemResolved(sourceId);
    if (!resolved) throw new Error('Publicación origen no encontrada en Mercado Libre');
    const created = await createMercadoLibrePackListingFromItem(resolved.item, {
      titleSuffix,
      skuSuffix,
      availableQuantity: packStock,
      status: input.published === false ? 'paused' : 'active'
    });
    newProductId = created.itemId;
    newVariantId = '';
  } else {
    const tnSourceId = sourceId.replace(/\D/g, '') || sourceId;
    const created = await createTiendaNubePackListingFromProduct(tnSourceId, {
      titleSuffix,
      skuSuffix,
      availableQuantity: packStock,
      published: input.published !== false
    });
    newProductId = String(created.productId);
    newVariantId = String(created.variantId);
  }

  const bundle = await createPublicationBundle({
    platform: input.platform,
    externalProductId: newProductId,
    externalVariantId: newVariantId || undefined,
    label: input.label?.trim() || undefined,
    items: input.items
  });

  return {
    bundle,
    newExternalProductId: newProductId,
    newExternalVariantId: newVariantId,
    sourceExternalProductId: normalizeMercadoLibreItemId(sourceId) || sourceId,
    message:
      input.platform === 'mercadolibre'
        ? `Publicación pack creada en ML (${newProductId}) con las mismas fotos`
        : `Producto pack creado en TN (${newProductId}) con las mismas imágenes`
  };
}
