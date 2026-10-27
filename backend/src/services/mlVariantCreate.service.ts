/**
 * Crea variantes de talle y color en una publicación de Mercado Libre
 * a partir de las variantes locales del artículo.
 *
 * - User Product (familia): POST /user-products-families/{id}/user-products y luego la condición de venta.
 * - Publicación clásica con variations: POST /items/{id}/variations.
 */
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { execute, get, query } from '../database/db';
import {
  getValidMLToken,
  mercadoLibreItemIdCandidates,
  normalizeMercadoLibreItemId,
  resolveMercadoLibreUserProductItems
} from '../controllers/integrations.controller';
import { colorsAreEquivalent } from '../utils/colorNameStandard';
import { sizesCompatible } from '../utils/mlVariationMatch';
import { nombreTalleDesdeCodigo } from '../talles-tango';
import { unitsForListing } from '../stockEngine/targets';
import { mlFetchSizeGridRowForSize } from './packListingCreate.service';

const COLOR_ATTRS = new Set(['COLOR', 'COLOUR', 'COR', 'MAIN_COLOR']);
const SIZE_ATTRS = new Set(['SIZE', 'SIZE_TYPE', 'TALLE', 'TALLA']);
const GRID_ROW_ATTRS = new Set(['SIZE_GRID_ROW_ID']);

export class MlVariantCreateError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

type LocalVariant = {
  variantId: string;
  sku: string;
  color: string;
  size: string;
  stock: number;
  listingStock: number;
  mlPack: number;
  basePrice: number;
  linkedItemId: string;
  linkedVariationId: string;
};

type RemoteCombo = {
  userProductId: string;
  itemId: string;
  variationId: string;
  color: string;
  size: string;
  colorValueId: string | null;
  sizeValueId: string | null;
  sizeName: string;
  rowId: string;
  pictureIds: string[];
};

type Axes = { color: boolean; size: boolean; gridRow: boolean };

type ListingContext = {
  anchorItemId: string;
  anchorTitle: string;
  mode: 'user_product' | 'classic';
  familyId: string;
  userProductId: string;
  childAttributeIds: string[];
  axes: Axes;
  combos: RemoteCombo[];
  pictureIds: string[];
  price: number;
  categoryId: string;
  currencyId: string;
  buyingMode: string;
  listingTypeId: string;
  shipping?: Record<string, unknown>;
  chartId: string;
  colorValueByName: Map<string, string>;
  accessToken: string;
  sellerId: string;
};

export type MlVariantPreviewRow = {
  variantId: string;
  sku: string;
  color: string;
  size: string;
  stock: number;
  listingStock: number;
  alreadyOnMl: boolean;
  linkedItemId: string | null;
};

export type MlVariantPreview = {
  productId: string;
  productName: string;
  anchorItemId: string;
  anchorTitle: string;
  mode: 'user_product' | 'classic';
  familyId: string | null;
  variesBy: { color: boolean; size: boolean };
  variants: MlVariantPreviewRow[];
};

function mlMessage(data: any, fallback: string): string {
  const causes = Array.isArray(data?.cause)
    ? data.cause.map((c: any) => c?.message || c?.code).filter(Boolean)
    : [];
  const base = String(data?.message || data?.error || fallback);
  return causes.length ? `${base}: ${causes.join('; ')}` : base;
}

function attrId(raw: unknown): string {
  return String(raw || '').trim().toUpperCase();
}

function isColorAttr(id: string): boolean {
  return COLOR_ATTRS.has(attrId(id));
}
function isSizeAttr(id: string): boolean {
  return SIZE_ATTRS.has(attrId(id));
}
function isGridRowAttr(id: string): boolean {
  return GRID_ROW_ATTRS.has(attrId(id));
}

function sameCombo(local: { color: string; size: string }, remote: { color: string; size: string }, axes: Axes): boolean {
  if (!axes.color && !axes.size) return false;
  if (axes.color && !colorsAreEquivalent(local.color, remote.color)) return false;
  if (axes.size && !sizesCompatible(local.size, remote.size)) return false;
  return true;
}

function pictureIdsFromItem(item: any): string[] {
  const ids: string[] = [];
  const push = (id: unknown) => {
    const s = String(id || '').trim();
    if (s && !ids.includes(s)) ids.push(s);
  };
  for (const p of Array.isArray(item?.pictures) ? item.pictures : []) push(p?.id);
  for (const v of Array.isArray(item?.variations) ? item.variations : []) {
    for (const pid of Array.isArray(v?.picture_ids) ? v.picture_ids : []) push(pid);
  }
  return ids.slice(0, 10);
}

function itemAttr(item: any, id: string): { valueId: string | null; name: string } {
  const list = Array.isArray(item?.attributes) ? item.attributes : [];
  const hit = list.find((a: any) => attrId(a?.id) === attrId(id));
  if (!hit) return { valueId: null, name: '' };
  const valueId = hit.value_id != null && String(hit.value_id).trim() !== '' ? String(hit.value_id).trim() : null;
  const name = String(hit.value_name ?? hit.value ?? '').trim();
  return { valueId, name };
}

function upAttr(up: any, id: string): { valueId: string | null; name: string } {
  const list = Array.isArray(up?.attributes) ? up.attributes : [];
  const hit = list.find((a: any) => attrId(a?.id) === attrId(id));
  if (!hit) return { valueId: null, name: '' };
  const values = Array.isArray(hit.values) ? hit.values : [];
  const v0 = values[0] || {};
  const rawId = v0.id ?? hit.value_id;
  const valueId = rawId != null && String(rawId).trim() !== '' && String(rawId) !== 'null' ? String(rawId).trim() : null;
  const name = String(v0.name ?? v0.value_name ?? hit.value_name ?? hit.name ?? '').trim();
  return { valueId, name };
}

function variationColorSize(v: any): { color: string; size: string; colorValueId: string | null; sizeValueId: string | null } {
  let color = '';
  let size = '';
  let colorValueId: string | null = null;
  let sizeValueId: string | null = null;
  for (const a of Array.isArray(v?.attribute_combinations) ? v.attribute_combinations : []) {
    const id = attrId(a?.id);
    const name = String(a?.value_name ?? a?.name ?? '').trim();
    const vid = a?.value_id != null && String(a.value_id).trim() !== '' ? String(a.value_id).trim() : null;
    if (isColorAttr(id)) {
      color = color || name;
      colorValueId = colorValueId || vid;
    }
    if (isSizeAttr(id)) {
      size = size || name;
      sizeValueId = sizeValueId || vid;
    }
  }
  return { color, size, colorValueId, sizeValueId };
}

async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    out.push(...(await Promise.all(chunk.map(fn))));
  }
  return out;
}

async function loadLocalVariants(productId: string): Promise<{ productName: string; variants: LocalVariant[] }> {
  const rows = (await query(
    `SELECT pv.id, COALESCE(NULLIF(pv.external_sku, ''), pv.sku) AS sku,
            c.name AS color_name, s.size_code,
            COALESCE(st.stock, 0) AS stock,
            pv.mercado_libre_item_id, pv.mercado_libre_variant_id,
            p.name AS product_name, p.base_price,
            COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN products p ON p.id = pc.product_id
     LEFT JOIN colors c ON c.id = pc.color_id
     LEFT JOIN sizes s ON s.id = pv.size_id
     LEFT JOIN stocks st ON st.variant_id = pv.id
     WHERE pc.product_id = ?
     ORDER BY s.size_code, c.name`,
    [productId]
  )) as any[];
  if (!rows.length) throw new MlVariantCreateError('El artículo no tiene variantes locales');
  const variants: LocalVariant[] = rows.map((r) => {
    const stock = Math.max(0, Math.floor(Number(r.stock) || 0));
    const mlPack = Math.max(1, Math.floor(Number(r.ml_pack) || 1));
    return {
      variantId: String(r.id),
      sku: String(r.sku || '').trim(),
      color: String(r.color_name || '').trim() || 'Único',
      size: String(r.size_code || '').trim() || 'U',
      stock,
      listingStock: unitsForListing(stock, mlPack),
      mlPack,
      basePrice: Number(r.base_price) || 0,
      linkedItemId: String(r.mercado_libre_item_id || '').trim(),
      linkedVariationId: String(r.mercado_libre_variant_id || '').trim()
    };
  });
  return { productName: String(rows[0].product_name || '').trim(), variants };
}

async function fetchMlItem(accessToken: string, sellerId: string, rawId: string): Promise<any | null> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const candidates = mercadoLibreItemIdCandidates(rawId);
  for (const id of candidates) {
    const res = await axios.get(`https://api.mercadolibre.com/items/${encodeURIComponent(id)}?include_attributes=all`, {
      headers,
      validateStatus: () => true
    });
    if (res.status === 200 && res.data && !res.data.error) return res.data;
  }
  const normalized = normalizeMercadoLibreItemId(rawId);
  if (/^MLAU\d+$/i.test(normalized)) {
    const resolved = await resolveMercadoLibreUserProductItems(normalized, sellerId, accessToken);
    for (const id of resolved.itemCandidates.slice(0, 5)) {
      const res = await axios.get(`https://api.mercadolibre.com/items/${encodeURIComponent(id)}?include_attributes=all`, {
        headers,
        validateStatus: () => true
      });
      if (res.status === 200 && res.data && !res.data.error) return res.data;
    }
  }
  return null;
}

async function fetchJson(url: string, accessToken: string): Promise<{ status: number; data: any }> {
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    validateStatus: () => true
  });
  return { status: res.status, data: res.data };
}

async function loadColorValueIds(categoryId: string, accessToken: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!categoryId) return map;
  const res = await fetchJson(`https://api.mercadolibre.com/categories/${encodeURIComponent(categoryId)}/attributes`, accessToken);
  if (res.status !== 200 || !Array.isArray(res.data)) return map;
  const colorAttr = res.data.find((a: any) => isColorAttr(String(a?.id || '')));
  for (const v of Array.isArray(colorAttr?.values) ? colorAttr.values : []) {
    const name = String(v?.name || '').trim();
    const id = v?.id != null ? String(v.id).trim() : '';
    if (name && id) map.set(name.toLowerCase(), id);
  }
  return map;
}

function lookupColorValueId(map: Map<string, string>, color: string): string | null {
  const direct = map.get(color.trim().toLowerCase());
  if (direct) return direct;
  for (const [name, id] of map) {
    if (colorsAreEquivalent(name, color)) return id;
  }
  return null;
}

async function loadUserProductContext(anchor: any, accessToken: string): Promise<{
  familyId: string;
  childAttributeIds: string[];
  combos: RemoteCombo[];
  chartId: string;
}> {
  const userProductId = String(anchor?.user_product_id || '').trim();
  const upRes = await fetchJson(`https://api.mercadolibre.com/user-products/${encodeURIComponent(userProductId)}`, accessToken);
  if (upRes.status !== 200) {
    throw new MlVariantCreateError(
      mlMessage(upRes.data, 'No se pudo leer el User Product de la publicación modelo')
    );
  }
  const familyId = String(upRes.data?.family_id || '').trim();
  if (!familyId) throw new MlVariantCreateError('La publicación modelo no tiene familia de variantes en Mercado Libre');

  let family = await fetchJson(
    `https://api.mercadolibre.com/user-products-families/${encodeURIComponent(familyId)}`,
    accessToken
  );
  if (family.status !== 200) {
    const site = String(upRes.data?.site_id || 'MLA').trim() || 'MLA';
    family = await fetchJson(
      `https://api.mercadolibre.com/sites/${encodeURIComponent(site)}/user-products-families/${encodeURIComponent(familyId)}`,
      accessToken
    );
  }
  const childAttributeIds = (
    Array.isArray(family.data?.child_attributes_ids) ? family.data.child_attributes_ids : ['COLOR', 'SIZE']
  )
    .map((id: unknown) => attrId(id))
    .filter(Boolean);

  const list = await fetchJson(
    `https://api.mercadolibre.com/user-products-families/${encodeURIComponent(familyId)}/user-products`,
    accessToken
  );
  const rawIds = [
    ...(Array.isArray(list.data?.user_products_ids) ? list.data.user_products_ids : []),
    ...(Array.isArray(list.data?.user_products) ? list.data.user_products : []),
    ...(Array.isArray(list.data?.results) ? list.data.results : []),
    ...(Array.isArray(list.data) ? list.data : [])
  ];
  const seenUp = new Set<string>();
  const upIds: string[] = [];
  const pushUp = (id: string) => {
    const s = String(id || '').trim();
    if (!s || seenUp.has(s) || upIds.length >= 80) return;
    seenUp.add(s);
    upIds.push(s);
  };
  pushUp(userProductId);
  for (const entry of rawIds) {
    if (typeof entry === 'string') pushUp(entry);
    else if (entry && typeof entry === 'object') {
      const o = entry as { id?: unknown; user_product_id?: unknown };
      pushUp(String(o.id || o.user_product_id || ''));
    }
  }

  const ups = await mapPool(upIds, 6, async (id) => {
    const r = await fetchJson(`https://api.mercadolibre.com/user-products/${encodeURIComponent(id)}`, accessToken);
    return r.status === 200 ? r.data : null;
  });

  const chartFromAnchor =
    itemAttr(anchor, 'SIZE_GRID_ID').valueId ||
    upAttr(upRes.data, 'SIZE_GRID_ID').valueId ||
    upAttr(upRes.data, 'SIZE_GRID_ID').name;

  const combos: RemoteCombo[] = [];
  for (const up of ups) {
    if (!up) continue;
    const color = childAttributeIds.filter(isColorAttr).map((id) => upAttr(up, id))[0] || upAttr(up, 'COLOR');
    const size = childAttributeIds.filter(isSizeAttr).map((id) => upAttr(up, id))[0] || upAttr(up, 'SIZE');
    const row = childAttributeIds.filter(isGridRowAttr).map((id) => upAttr(up, id))[0] || upAttr(up, 'SIZE_GRID_ROW_ID');
    const pics = (Array.isArray(up.pictures) ? up.pictures : []).map((p: any) => String(p?.id || '').trim()).filter(Boolean);
    combos.push({
      userProductId: String(up.id || ''),
      itemId: '',
      variationId: '',
      color: color.name,
      size: size.name,
      colorValueId: color.valueId,
      sizeValueId: size.valueId,
      sizeName: size.name,
      rowId: row.valueId || row.name,
      pictureIds: pics
    });
  }

  return {
    familyId,
    childAttributeIds: childAttributeIds.length ? childAttributeIds : ['COLOR', 'SIZE'],
    combos,
    chartId: String(chartFromAnchor || '').trim()
  };
}

function loadClassicContext(anchor: any): { childAttributeIds: string[]; combos: RemoteCombo[] } {
  const variations = Array.isArray(anchor?.variations) ? anchor.variations : [];
  if (!variations.length) {
    throw new MlVariantCreateError(
      'Esta publicación no tiene variantes ni familia de User Product. Elegí una MLA que ya tenga talles o colores, o un MLAU de la familia.'
    );
  }
  const templateIds: string[] = [];
  for (const a of Array.isArray(variations[0]?.attribute_combinations) ? variations[0].attribute_combinations : []) {
    const id = attrId(a?.id);
    if (id && !templateIds.includes(id)) templateIds.push(id);
  }
  if (!templateIds.some((id) => isColorAttr(id) || isSizeAttr(id))) {
    throw new MlVariantCreateError('La publicación modelo no varía por color ni por talle');
  }
  const combos: RemoteCombo[] = variations.map((v: any) => {
    const cs = variationColorSize(v);
    const row = (Array.isArray(v?.attributes) ? v.attributes : []).find((a: any) => isGridRowAttr(a?.id));
    const rowId = row?.value_id != null ? String(row.value_id).trim() : String(row?.value_name || '').trim();
    const pics = (Array.isArray(v?.picture_ids) ? v.picture_ids : []).map((id: unknown) => String(id || '').trim()).filter(Boolean);
    return {
      userProductId: String(v?.user_product_id || ''),
      itemId: String(anchor.id || ''),
      variationId: String(v?.id || ''),
      color: cs.color,
      size: cs.size,
      colorValueId: cs.colorValueId,
      sizeValueId: cs.sizeValueId,
      sizeName: cs.size,
      rowId,
      pictureIds: pics
    };
  });
  return { childAttributeIds: templateIds, combos };
}

function axesFrom(ids: string[]): Axes {
  return {
    color: ids.some(isColorAttr),
    size: ids.some(isSizeAttr),
    gridRow: ids.some(isGridRowAttr)
  };
}

async function resolveAnchorId(productId: string, explicit?: string): Promise<string> {
  const raw = String(explicit || '').trim();
  if (raw) return raw;
  const row = await get(
    `SELECT pv.mercado_libre_item_id
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     WHERE pc.product_id = ? AND pv.mercado_libre_item_id IS NOT NULL AND pv.mercado_libre_item_id <> ''
     LIMIT 1`,
    [productId]
  );
  const id = String(row?.mercado_libre_item_id || '').trim();
  if (!id) {
    throw new MlVariantCreateError(
      'Indicá la publicación de Mercado Libre (MLA o MLAU) que ya tiene este artículo, para sumar ahí los talles y colores'
    );
  }
  return id;
}

async function buildContext(productId: string, anchorRaw: string | undefined): Promise<{
  ctx: ListingContext;
  locals: LocalVariant[];
  productName: string;
}> {
  const token = await getValidMLToken();
  if (!token) throw new MlVariantCreateError('No hay integración con Mercado Libre', 400);
  const { productName, variants } = await loadLocalVariants(productId);
  const anchorId = await resolveAnchorId(productId, anchorRaw);
  const anchor = await fetchMlItem(token.access_token, String(token.user_id || ''), anchorId);
  if (!anchor) throw new MlVariantCreateError('No se encontró esa publicación en Mercado Libre', 404);

  const userProductId = String(anchor.user_product_id || '').trim();
  const classic = !userProductId;
  const loaded = classic
    ? { ...loadClassicContext(anchor), familyId: '', chartId: itemAttr(anchor, 'SIZE_GRID_ID').valueId || '' }
    : await loadUserProductContext(anchor, token.access_token);

  const price =
    Number(anchor.price) ||
    Number(anchor.variations?.[0]?.price) ||
    variants[0]?.basePrice ||
    0;
  if (!Number.isFinite(price) || price <= 0) {
    throw new MlVariantCreateError('La publicación modelo no tiene un precio válido');
  }

  const shippingSrc = anchor.shipping || {};
  const shipping: Record<string, unknown> = {};
  if (shippingSrc.mode) shipping.mode = shippingSrc.mode;
  if (shippingSrc.local_pick_up != null) shipping.local_pick_up = shippingSrc.local_pick_up;
  if (shippingSrc.free_shipping != null) shipping.free_shipping = shippingSrc.free_shipping;

  const colorValueByName = await loadColorValueIds(String(anchor.category_id || ''), token.access_token);

  const ctx: ListingContext = {
    anchorItemId: String(anchor.id),
    anchorTitle: String(anchor.title || anchor.family_name || '').trim(),
    mode: classic ? 'classic' : 'user_product',
    familyId: loaded.familyId,
    userProductId,
    childAttributeIds: loaded.childAttributeIds,
    axes: axesFrom(loaded.childAttributeIds),
    combos: loaded.combos,
    pictureIds: pictureIdsFromItem(anchor),
    price,
    categoryId: String(anchor.category_id || ''),
    currencyId: String(anchor.currency_id || 'ARS'),
    buyingMode: String(anchor.buying_mode || 'buy_it_now'),
    listingTypeId: String(anchor.listing_type_id || 'gold_special'),
    shipping: Object.keys(shipping).length ? shipping : undefined,
    chartId: loaded.chartId,
    colorValueByName,
    accessToken: token.access_token,
    sellerId: String(token.user_id || '')
  };
  return { ctx, locals: variants, productName };
}

function findCombo(ctx: ListingContext, local: { color: string; size: string }): RemoteCombo | undefined {
  return ctx.combos.find((c) => sameCombo(local, c, ctx.axes));
}

function sizeNameFor(ctx: ListingContext, size: string): { name: string; valueId: string | null } {
  const sibling = ctx.combos.find((c) => c.size && sizesCompatible(c.size, size) && c.sizeName);
  if (sibling?.sizeName) return { name: sibling.sizeName, valueId: sibling.sizeValueId };
  const letter = nombreTalleDesdeCodigo(size);
  return { name: letter && letter !== size ? letter : size, valueId: null };
}

function colorNameFor(ctx: ListingContext, color: string): { name: string; valueId: string | null } {
  const sibling = ctx.combos.find((c) => c.color && colorsAreEquivalent(c.color, color));
  if (sibling?.color) return { name: sibling.color, valueId: sibling.colorValueId };
  return { name: color, valueId: lookupColorValueId(ctx.colorValueByName, color) };
}

function picturesFor(ctx: ListingContext, color: string): string[] {
  const sibling = ctx.combos.find((c) => c.pictureIds.length && colorsAreEquivalent(c.color, color));
  const ids = sibling?.pictureIds?.length ? sibling.pictureIds : ctx.pictureIds;
  return ids.slice(0, 10);
}

async function rowIdFor(ctx: ListingContext, size: string): Promise<string> {
  const sibling = ctx.combos.find((c) => c.rowId && sizesCompatible(c.size, size));
  if (sibling?.rowId) return sibling.rowId;
  if (!ctx.chartId) {
    throw new MlVariantCreateError(
      `La guía de talles de la publicación no tiene fila para el talle ${size}. Revisá la guía en Mercado Libre.`
    );
  }
  const found = await mlFetchSizeGridRowForSize(ctx.accessToken, ctx.chartId, size);
  if (!found?.rowId) {
    throw new MlVariantCreateError(
      `La guía ${ctx.chartId} no tiene una fila para el talle ${size} (${nombreTalleDesdeCodigo(size)}).`
    );
  }
  return found.rowId;
}

async function itemIdForUserProduct(ctx: ListingContext, userProductId: string): Promise<string> {
  if (!userProductId) return '';
  const resolved = await resolveMercadoLibreUserProductItems(userProductId, ctx.sellerId, ctx.accessToken);
  return String(resolved.itemCandidates[0] || '').trim();
}

async function publishSaleOnUserProduct(ctx: ListingContext, userProductId: string, local: LocalVariant): Promise<string> {
  const saleBody: Record<string, unknown> = {
    price: ctx.price,
    category_id: ctx.categoryId,
    currency_id: ctx.currencyId,
    buying_mode: ctx.buyingMode,
    listing_type_id: ctx.listingTypeId
  };
  if (ctx.shipping) saleBody.shipping = ctx.shipping;
  const sale = await axios.post(
    `https://api.mercadolibre.com/user-products/${encodeURIComponent(userProductId)}/items`,
    saleBody,
    {
      headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json' },
      validateStatus: () => true
    }
  );
  if (sale.status !== 201 && sale.status !== 200) {
    throw new MlVariantCreateError(mlMessage(sale.data, 'No se pudo publicar la variante en Mercado Libre'));
  }
  const itemId = String(sale.data?.id || '').trim();
  await putUserProductStock(userProductId, local.listingStock, ctx.accessToken);
  if (itemId) await trySetSku(itemId, local.sku, ctx.accessToken);
  return itemId;
}

async function linkVariant(
  local: LocalVariant,
  itemId: string,
  variationId: string
): Promise<void> {
  const current = local.linkedItemId;
  const varId = variationId || '';
  if (!current) {
    await execute(
      `UPDATE product_variants SET mercado_libre_item_id = ?, mercado_libre_variant_id = ? WHERE id = ?`,
      [itemId, varId || null, local.variantId]
    );
    local.linkedItemId = itemId;
    local.linkedVariationId = varId;
  }
  await execute(
    `INSERT INTO variant_publications (id, variant_id, platform, external_product_id, external_variant_id, pack_size)
     VALUES (?, ?, 'mercadolibre', ?, ?, ?)
     ON DUPLICATE KEY UPDATE pack_size = IF(pack_size > 1, pack_size, VALUES(pack_size))`,
    [uuidv4(), local.variantId, itemId, varId, local.mlPack]
  );
}

async function putUserProductStock(userProductId: string, qty: number, accessToken: string): Promise<void> {
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const url = `https://api.mercadolibre.com/user-products/${encodeURIComponent(userProductId)}/stock`;
  const got = await axios.get(url, { headers, validateStatus: () => true });
  if (got.status !== 200) return;
  const version = got.headers?.['x-version'] ?? got.headers?.['X-Version'];
  if (version == null || String(version).trim() === '') return;
  await axios.put(
    `${url}/type/selling_address`,
    { quantity: qty },
    { headers: { ...headers, 'x-version': String(version) }, validateStatus: () => true }
  );
}

async function trySetSku(itemId: string, sku: string, accessToken: string): Promise<void> {
  if (!sku) return;
  await axios.put(
    `https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}`,
    { seller_custom_field: sku },
    {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      validateStatus: () => true
    }
  );
}

async function createUserProductVariant(ctx: ListingContext, local: LocalVariant): Promise<{ itemId: string; userProductId: string }> {
  const pics = picturesFor(ctx, local.color);
  if (!pics.length) {
    throw new MlVariantCreateError('La publicación modelo no tiene fotos para copiar a la variante nueva');
  }
  const color = colorNameFor(ctx, local.color);
  const size = sizeNameFor(ctx, local.size);
  const attributes: Array<{ id: string; values: Array<{ id: string | null; name: string }> }> = [];
  for (const id of ctx.childAttributeIds) {
    if (isColorAttr(id)) {
      attributes.push({ id, values: [{ id: color.valueId, name: color.name }] });
      continue;
    }
    if (isSizeAttr(id)) {
      attributes.push({ id, values: [{ id: size.valueId, name: size.name }] });
      continue;
    }
    if (isGridRowAttr(id)) {
      const rowId = await rowIdFor(ctx, local.size);
      attributes.push({ id, values: [{ id: rowId, name: rowId }] });
      continue;
    }
    throw new MlVariantCreateError(
      `La familia de Mercado Libre pide el atributo ${id} en cada variante y LupoHub no puede completarlo desde talle y color`
    );
  }

  const created = await axios.post(
    `https://api.mercadolibre.com/user-products-families/${encodeURIComponent(ctx.familyId)}/user-products`,
    {
      attributes,
      pictures: pics.slice(0, 6).map((id) => ({ id }))
    },
    {
      headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json' },
      validateStatus: () => true
    }
  );
  if (created.status !== 201 && created.status !== 200) {
    throw new MlVariantCreateError(mlMessage(created.data, 'Mercado Libre rechazó la variante'));
  }
  const userProductId = String(created.data?.id || '').trim();
  if (!userProductId) throw new MlVariantCreateError('Mercado Libre no devolvió el id de la variante');

  let itemId = '';
  try {
    itemId = await publishSaleOnUserProduct(ctx, userProductId, local);
  } catch (e: any) {
    throw new MlVariantCreateError(
      `Se creó la variante ${color.name} / ${size.name} (${userProductId}) pero no la publicación: ${e?.message || 'error al publicar'}`
    );
  }
  if (!itemId) {
    throw new MlVariantCreateError(
      `Se creó la variante ${color.name} / ${size.name} (${userProductId}) pero Mercado Libre no devolvió la publicación`
    );
  }

  ctx.combos.push({
    userProductId,
    itemId,
    variationId: '',
    color: color.name,
    size: size.name,
    colorValueId: color.valueId,
    sizeValueId: size.valueId,
    sizeName: size.name,
    rowId: '',
    pictureIds: pics
  });
  return { itemId, userProductId };
}

async function createClassicVariation(ctx: ListingContext, local: LocalVariant): Promise<{ itemId: string; variationId: string }> {
  const pics = picturesFor(ctx, local.color);
  if (!pics.length) throw new MlVariantCreateError('La publicación modelo no tiene fotos para la variante nueva');
  const color = colorNameFor(ctx, local.color);
  const size = sizeNameFor(ctx, local.size);
  const combinations: Array<Record<string, unknown>> = [];
  const attributes: Array<Record<string, unknown>> = [];
  if (local.sku) attributes.push({ id: 'SELLER_SKU', value_name: local.sku });

  for (const id of ctx.childAttributeIds) {
    if (isColorAttr(id)) {
      const row: Record<string, unknown> = { id, value_name: color.name };
      if (color.valueId) row.value_id = color.valueId;
      combinations.push(row);
      continue;
    }
    if (isSizeAttr(id)) {
      const row: Record<string, unknown> = { id, value_name: size.name };
      if (size.valueId) row.value_id = size.valueId;
      combinations.push(row);
      continue;
    }
    if (isGridRowAttr(id)) {
      attributes.push({ id, value_id: await rowIdFor(ctx, local.size) });
      continue;
    }
  }
  if (!ctx.axes.gridRow && ctx.combos.some((c) => c.rowId)) {
    try {
      attributes.push({ id: 'SIZE_GRID_ROW_ID', value_id: await rowIdFor(ctx, local.size) });
    } catch {
      /* la guía es opcional si la publicación no la exige en la variación */
    }
  }

  const res = await axios.post(
    `https://api.mercadolibre.com/items/${encodeURIComponent(ctx.anchorItemId)}/variations`,
    {
      attribute_combinations: combinations,
      price: ctx.price,
      available_quantity: local.listingStock,
      picture_ids: pics.slice(0, 10),
      attributes
    },
    {
      headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json' },
      validateStatus: () => true
    }
  );
  if (res.status !== 201 && res.status !== 200) {
    throw new MlVariantCreateError(mlMessage(res.data, 'Mercado Libre rechazó la variación'));
  }
  const variationId = String(res.data?.id || '').trim();
  if (!variationId) throw new MlVariantCreateError('Mercado Libre no devolvió el id de la variación');
  ctx.combos.push({
    userProductId: '',
    itemId: ctx.anchorItemId,
    variationId,
    color: color.name,
    size: size.name,
    colorValueId: color.valueId,
    sizeValueId: size.valueId,
    sizeName: size.name,
    rowId: '',
    pictureIds: pics
  });
  return { itemId: ctx.anchorItemId, variationId };
}

export async function previewMlVariantsFromLocal(productId: string, anchorItemId?: string): Promise<MlVariantPreview> {
  const { ctx, locals, productName } = await buildContext(productId, anchorItemId);
  return {
    productId,
    productName,
    anchorItemId: ctx.anchorItemId,
    anchorTitle: ctx.anchorTitle,
    mode: ctx.mode,
    familyId: ctx.familyId || null,
    variesBy: { color: ctx.axes.color, size: ctx.axes.size },
    variants: locals.map((v) => ({
      variantId: v.variantId,
      sku: v.sku,
      color: v.color,
      size: v.size,
      stock: v.stock,
      listingStock: v.listingStock,
      alreadyOnMl: Boolean(findCombo(ctx, v)),
      linkedItemId: v.linkedItemId || null
    }))
  };
}

export async function createMlVariantsFromLocal(
  productId: string,
  variantIds: string[],
  anchorItemId?: string
): Promise<{
  anchorItemId: string;
  mode: 'user_product' | 'classic';
  created: Array<{ variantId: string; color: string; size: string; itemId: string; variationId: string | null; userProductId: string | null }>;
  linkedExisting: Array<{ variantId: string; color: string; size: string; itemId: string }>;
  failed: Array<{ variantId: string; color: string; size: string; error: string }>;
}> {
  const ids = [...new Set(variantIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) throw new MlVariantCreateError('Elegí al menos una variante');
  if (ids.length > 40) throw new MlVariantCreateError('Creá hasta 40 variantes por vez');

  const { ctx, locals } = await buildContext(productId, anchorItemId);
  const byId = new Map(locals.map((v) => [v.variantId, v]));
  const created: Array<{ variantId: string; color: string; size: string; itemId: string; variationId: string | null; userProductId: string | null }> = [];
  const linkedExisting: Array<{ variantId: string; color: string; size: string; itemId: string }> = [];
  const failed: Array<{ variantId: string; color: string; size: string; error: string }> = [];

  for (const id of ids) {
    const local = byId.get(id);
    if (!local) {
      failed.push({ variantId: id, color: '', size: '', error: 'La variante no pertenece a este artículo' });
      continue;
    }
    try {
      const existing = findCombo(ctx, local);
      if (existing) {
        let itemId = existing.itemId;
        if (!itemId && existing.userProductId) itemId = await itemIdForUserProduct(ctx, existing.userProductId);
        if (!itemId && existing.userProductId) itemId = await publishSaleOnUserProduct(ctx, existing.userProductId, local);
        if (itemId) await linkVariant(local, itemId, existing.variationId);
        linkedExisting.push({ variantId: local.variantId, color: local.color, size: local.size, itemId });
        continue;
      }
      if (!ctx.axes.color && !ctx.axes.size) {
        throw new MlVariantCreateError('La publicación no acepta variantes de color ni de talle');
      }
      if (ctx.mode === 'user_product') {
        const made = await createUserProductVariant(ctx, local);
        await linkVariant(local, made.itemId, '');
        created.push({
          variantId: local.variantId,
          color: local.color,
          size: local.size,
          itemId: made.itemId,
          variationId: null,
          userProductId: made.userProductId
        });
      } else {
        const made = await createClassicVariation(ctx, local);
        await linkVariant(local, made.itemId, made.variationId);
        created.push({
          variantId: local.variantId,
          color: local.color,
          size: local.size,
          itemId: made.itemId,
          variationId: made.variationId,
          userProductId: null
        });
      }
    } catch (e: any) {
      failed.push({
        variantId: local.variantId,
        color: local.color,
        size: local.size,
        error: e?.message || 'No se pudo crear la variante'
      });
    }
  }

  return { anchorItemId: ctx.anchorItemId, mode: ctx.mode, created, linkedExisting, failed };
}
