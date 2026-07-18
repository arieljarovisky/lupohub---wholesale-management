import { Request, Response } from 'express';
import axios from 'axios';
import { execute, query, get } from '../database/db';
import { v4 as uuidv4 } from 'uuid';
import { deleteProductById } from './products.controller';
import { tnPostWithRetry, tnPutWithRetry } from '../utils/tiendanubeClient';
import * as mlQuestionsAi from '../services/mlQuestionsAi.service';
import {
  fetchAllTiendaNubeProductVariants,
  mergeTiendaNubeDuplicateVariants,
} from '../services/tiendanubeVariantMerge.service';
import { normalizeColorNameToStandard, shouldUpdateColorValue } from '../utils/colorNameStandard';
import { skuToCanonicalString } from '../utils/skuString';
import { normalizeSizeToStandard } from '../utils/talleStandard';
import {
  expressTrackingStatusLabel,
  isExpressTrackingStatus,
  type ExpressTrackingStatus,
} from '../services/tiendanubeExpressTracking.service';
import {
  loadExpressTrackingPageConfig,
  syncExpressTrackingPageToStore,
} from '../services/tiendanubeExpressTrackingPage.service';
import {
  matchMlVariationForVariantLink,
  mlVariationColorSizeFromApi,
  mlVariationSkuFromApi,
  normSkuForMlStockMatch,
  normTextForMlStockMatch,
  resolveMlStockForVariantLink,
  type MlVariantMatchLink,
} from '../utils/mlVariationMatch';
const ML_AUTH_URL = 'https://auth.mercadolibre.com.ar/authorization';
const ML_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';

const TN_AUTH_URL = 'https://www.tiendanube.com/apps/authorize';
const TN_TOKEN_URL = 'https://www.tiendanube.com/apps/authorize/token';
const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';

/** Pausa entre requests a Tienda Nube para no superar el límite de solicitudes (configurable con TN_RATE_LIMIT_DELAY_MS, default 800ms). */
const TN_RATE_LIMIT_DELAY_MS = Math.max(0, parseInt(process.env.TN_RATE_LIMIT_DELAY_MS || '800', 10));
/** Máximo de publicaciones a traer al sincronizar con Mercado Libre (evitar timeout). Configurable con ML_SYNC_MAX_ITEMS (default 5000). */
const ML_SYNC_MAX_ITEMS = Math.max(100, parseInt(process.env.ML_SYNC_MAX_ITEMS || '5000', 10));
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Normaliza entradas de publicación ML (ID directo, URL o formato con guion, ej. MLAU-123). */
export function normalizeMercadoLibreItemId(raw: unknown): string {
  let s = (raw ?? '').toString().trim();
  if (!s) return '';
  try { s = decodeURIComponent(s); } catch {}
  s = s.replace(/\s+/g, '');

  // Si pegan URL: priorizar ID de catálogo /p/MLA... (todos los colores/talles)
  if (/^https?:\/\//i.test(s)) {
    const catalog = s.match(/\/p\/(ML[A-Z]{0,5}-?\d+)/i);
    if (catalog?.[1]) {
      s = catalog[1];
    } else {
      const m = s.match(/\/(ML[A-Z]{0,5}-?\d+)(?:[/?#]|$)/i);
      if (m?.[1]) s = m[1];
    }
  }

  s = s.toUpperCase();
  // Permitir "MLAU-123456" -> "MLAU123456"
  const mDash = s.match(/^(ML[A-Z]{0,5})-(\d+)$/);
  if (mDash) s = `${mDash[1]}${mDash[2]}`;
  // Compat histórico: "ML-123456" -> "MLA123456"
  const legacy = s.match(/^ML-(\d+)$/);
  if (legacy) s = `MLA${legacy[1]}`;
  // Solo números: se resolverá en candidates con múltiples sitios.

  return s;
}

/** Genera candidatos de itemId para tolerar formatos no estándar (ej. MLAU... -> MLA...). */
export function mercadoLibreItemIdCandidates(raw: unknown): string[] {
  const base = normalizeMercadoLibreItemId(raw);
  if (!base) return [];
  // Si llega solo el número, intentar los sitios más comunes.
  if (/^\d+$/.test(base)) {
    const sites = ['MLU', 'MLA', 'MLB', 'MLM', 'MCO', 'MLC', 'MPE', 'MEC', 'MLV'];
    return sites.map((site) => `${site}${base}`);
  }
  const out: string[] = [base];
  const m = base.match(/^(ML[A-Z]{2,6})(\d+)$/);
  if (m) {
    const prefix = m[1];
    const num = m[2];
    // Formato canónico ML + 1 letra de sitio (MLA, MLB, MLU, ...)
    if (prefix.length > 3) out.push(`${prefix.slice(0, 3)}${num}`);
    // Si vino con un prefijo "expandido" de 4+ letras, probar también ML + última letra.
    // Ej: MLAU123 -> MLU123 (caso real detectado en producción).
    if (prefix.length > 3) out.push(`ML${prefix[prefix.length - 1]}${num}`);
    // Caso visto en producción: MLAU######## -> MLA########
    if (prefix === 'MLAU') out.push(`MLA${num}`);
  }
  return Array.from(new Set(out.filter(Boolean)));
}

/** Normaliza SKU para matching flexible entre canales (quita separadores y mayúsculas). */
function normalizeSkuForMatch(raw: unknown): string {
  return (raw ?? '')
    .toString()
    .trim()
    .toUpperCase()
    .replace(/[\s\-\/]/g, '');
}

/** Obtiene SKU desde la API de ML cuando en la orden no viene claro. */
async function resolveMlOrderItemSku(
  accessToken: string,
  mlItemId?: string | number,
  mlVariationId?: string | number
): Promise<string> {
  try {
    if (!mlItemId) return '';
    const itemRes = await axios.get(
      `https://api.mercadolibre.com/items/${encodeURIComponent(String(mlItemId))}?include_attributes=all`,
      { headers: { 'Authorization': `Bearer ${accessToken}` }, validateStatus: () => true }
    );
    if (itemRes.status !== 200 || !itemRes.data) return '';
    const item = itemRes.data;

    // 1) Si hay variación, priorizar SKU de esa variación
    if (mlVariationId && Array.isArray(item.variations)) {
      const v = item.variations.find((x: any) => String(x?.id) === String(mlVariationId));
      if (v) {
        const skuAttr = Array.isArray(v.attributes)
          ? v.attributes.find((a: any) => (a?.id || '').toString().toUpperCase() === 'SELLER_SKU')
          : null;
        const fromVariation = (skuAttr ? (skuAttr.value_name ?? skuAttr.value ?? '') : (v.seller_sku ?? v.seller_custom_field ?? ''))
          .toString()
          .trim();
        if (fromVariation) return fromVariation;
      }
    }

    // 2) SKU a nivel item
    let sku = (item.seller_sku ?? item.seller_custom_field ?? '').toString().trim();
    if (sku) return sku;

    // 3) SELLER_SKU en attributes del item
    if (Array.isArray(item.attributes)) {
      const skuAttr = item.attributes.find((a: any) => (a?.id || '').toString().toUpperCase() === 'SELLER_SKU');
      sku = (skuAttr ? (skuAttr.value_name ?? skuAttr.value ?? '') : '').toString().trim();
      if (sku) return sku;
    }
  } catch {
    // ignore: se mantiene fallback actual
  }
  return '';
}

/** Referencia por línea de orden ML (evita omitir ítems restantes si falló el procesamiento parcial). */
function mlOrderLineReference(
  orderId: string,
  mlItemId: string | number | undefined,
  mlVariationId: string | number | undefined,
  itemIndex: number
): string {
  const item = mlItemId != null && String(mlItemId).trim() !== '' ? String(mlItemId).trim() : 'item';
  const variation =
    mlVariationId != null && String(mlVariationId).trim() !== '' ? String(mlVariationId).trim() : '0';
  return `Orden ML: ${orderId} · ${item}:${variation}:${itemIndex}`;
}

/** True si la línea ya generó movimiento (formato nuevo por línea o legacy por variante). */
async function isMlOrderLineAlreadyProcessed(
  orderId: string,
  lineRef: string,
  variantId?: string
): Promise<boolean> {
  const byLine = await get(
    `SELECT id FROM stock_movements WHERE movement_type = 'VENTA_MERCADO_LIBRE' AND reference = ? LIMIT 1`,
    [lineRef]
  );
  if (byLine) return true;

  if (variantId) {
    const legacyRef = `Orden ML: ${orderId}`;
    const byLegacyVariant = await get(
      `SELECT id FROM stock_movements WHERE movement_type = 'VENTA_MERCADO_LIBRE' AND reference = ? AND variant_id = ? LIMIT 1`,
      [legacyRef, variantId]
    );
    if (byLegacyVariant) return true;
  }

  return false;
}

/** Si llega un ID de catálogo (ej. URL /p/MLAU...), intentar resolver a item IDs reales. */
export async function resolveMercadoLibreCatalogProductItems(
  productId: string,
  accessToken: string
): Promise<string[]> {
  try {
    const res = await axios.get(
      `https://api.mercadolibre.com/products/${encodeURIComponent(productId)}/items`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        validateStatus: () => true
      }
    );
    if (res.status >= 400 || !res.data) return [];

    const data = res.data as any;
    const rows: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.results)
        ? data.results
        : Array.isArray(data?.items)
          ? data.items
          : [];

    const itemIds = rows
      .map((row: any) => {
        if (typeof row === 'string') return row;
        if (row?.id) return row.id;
        if (row?.item_id) return row.item_id;
        if (row?.item?.id) return row.item.id;
        return '';
      })
      .filter(Boolean);

    return Array.from(new Set(itemIds.flatMap((id: string) => mercadoLibreItemIdCandidates(id))));
  } catch {
    return [];
  }
}

/** Resuelve IDs de item a partir de un user_product_id (ej. MLAU...). */
export async function resolveMercadoLibreUserProductItems(
  userProductId: string,
  sellerId: string | number,
  accessToken: string
): Promise<{
  itemCandidates: string[];
  debug: {
    requestedUserProductId: string;
    sellerId: string;
    perStatus: Record<string, { hits: number; pages: number; failedRequests: number }>;
    rawItemIds: string[];
    candidateItemIds: string[];
  };
}> {
  const up = (userProductId || '').toString().trim();
  const perStatus: Record<string, { hits: number; pages: number; failedRequests: number }> = {
    active: { hits: 0, pages: 0, failedRequests: 0 },
    paused: { hits: 0, pages: 0, failedRequests: 0 },
    closed: { hits: 0, pages: 0, failedRequests: 0 },
  };
  if (!up) {
    return {
      itemCandidates: [],
      debug: {
        requestedUserProductId: up,
        sellerId: String(sellerId),
        perStatus,
        rawItemIds: [],
        candidateItemIds: [],
      },
    };
  }
  try {
    const allIds: string[] = [];
    const seen = new Set<string>();
    const statuses = ['active', 'paused', 'closed'] as const;
    const pageLimit = 100;
    for (const st of statuses) {
      let offset = 0;
      while (offset < 5000) {
        const res = await axios.get(
          `https://api.mercadolibre.com/users/${encodeURIComponent(String(sellerId))}/items/search`,
          {
            headers: { 'Authorization': `Bearer ${accessToken}` },
            params: { user_product_id: up, status: st, limit: pageLimit, offset },
            validateStatus: () => true
          }
        );
        perStatus[st].pages += 1;
        if (res.status >= 400 || !res.data) {
          perStatus[st].failedRequests += 1;
          break;
        }
        const rows: any[] = Array.isArray(res.data?.results) ? res.data.results : [];
        perStatus[st].hits += rows.length;
        for (const x of rows) {
          const id = String(x || '').trim();
          if (!id || seen.has(id)) continue;
          seen.add(id);
          allIds.push(id);
        }
        if (rows.length < pageLimit) break;
        offset += pageLimit;
      }
    }
    const itemCandidates = Array.from(new Set(allIds.flatMap((id: string) => mercadoLibreItemIdCandidates(id))));
    return {
      itemCandidates,
      debug: {
        requestedUserProductId: up,
        sellerId: String(sellerId),
        perStatus,
        rawItemIds: allIds,
        candidateItemIds: itemCandidates,
      },
    };
  } catch {
    return {
      itemCandidates: [],
      debug: {
        requestedUserProductId: up,
        sellerId: String(sellerId),
        perStatus,
        rawItemIds: [],
        candidateItemIds: [],
      },
    };
  }
}

type MlVariationRow = { variationId: string; itemId?: string; sku: string; color: string; size: string; stock: number };

/** Una fila por SKU (o color+talle); evita duplicados al agregar varios ítems ML. */
function dedupeMlVariationRows(rows: MlVariationRow[]): MlVariationRow[] {
  const byKey = new Map<string, MlVariationRow>();
  for (const row of rows) {
    // normSkuForMlStockMatch devuelve '0' como centinela cuando el SKU está vacío o no
    // tiene dígitos: usarlo directo como clave colapsaba todas las variaciones sin SKU
    // numérico (muy común en ML) en una sola fila, perdiendo el resto de las variantes.
    const rawSku = String(row.sku ?? '').trim();
    const skuKey = rawSku ? normSkuForMlStockMatch(rawSku) : '';
    const colorN = normTextForMlStockMatch(row.color);
    const sizeN = normTextForMlStockMatch(row.size);
    const attrKey = colorN || sizeN ? `${colorN}|${sizeN}` : '';
    const key = skuKey || attrKey || `${row.itemId || ''}#${String(row.variationId || '').trim()}`;
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, row);
      continue;
    }
    if (!prev.sku && row.sku) byKey.set(key, row);
  }
  return Array.from(byKey.values());
}

/** Extrae filas de variación desde un ítem ML (con o sin array item.variations). */
function extractMlVariationsFromItemData(it: any): MlVariationRow[] {
  if (!it || it.error) return [];
  const out: MlVariationRow[] = [];
  if (Array.isArray(it.variations) && it.variations.length > 0) {
    for (const v of it.variations) {
      out.push(mlVariationRowFromApiVariation(v, it));
    }
    return dedupeMlVariationRows(out);
  }
  const attrs = Array.isArray(it.attributes) ? it.attributes : [];
  const skuAttr = attrs.find((a: any) => (a?.id || '').toString().toUpperCase() === 'SELLER_SKU');
  const sku = (it.seller_sku ?? it.seller_custom_field ?? (skuAttr ? (skuAttr.value_name ?? skuAttr.value ?? '') : '')).toString().trim();
  const colorAttr = attrs.find((a: any) => ['COLOR', 'COLOUR', 'COR'].includes((a?.id || '').toString().toUpperCase()));
  const sizeAttr = attrs.find((a: any) => ['SIZE', 'SIZE_TYPE', 'TALLE', 'TALLA'].includes((a?.id || '').toString().toUpperCase()));
  const parsed = mlColorSizeFromTitle((it.title || '').toString().trim());
  out.push({
    variationId: String(it.id),
    itemId: String(it.id || ''),
    sku,
    color: (colorAttr ? (colorAttr.value_name ?? colorAttr.value ?? '') : parsed.color).toString().trim(),
    size: (sizeAttr ? (sizeAttr.value_name ?? sizeAttr.value ?? '') : parsed.size).toString().trim(),
    stock: it.available_quantity || 0
  });
  return dedupeMlVariationRows(out);
}

type VariantMlStockLink = MlVariantMatchLink & {
  variantId: string;
  variationId: string | null;
  sku: string;
  color: string;
  size: string;
};

function mlVariationRowFromApiVariation(v: any, item: any): MlVariationRow {
  const { color, size } = mlVariationColorSizeFromApi(v);
  const sku = mlVariationSkuFromApi(v);
  const title = (item?.title || '').toString().trim();
  const parsed = !color && !size && title ? mlColorSizeFromTitle(title) : { color: '', size: '' };
  return {
    variationId: String(v.id),
    itemId: String(item?.id || ''),
    sku,
    color: color || parsed.color,
    size: size || parsed.size,
    stock: v.available_quantity || 0
  };
}

/** El GET /items/{id} suele devolver variaciones sin attribute_combinations; completar con GET /variations/{vid}. */
async function enrichMercadoLibreItemVariationsForCatalog(item: any, accessToken: string): Promise<any> {
  const itemId = String(item?.id || '').trim();
  const variations = Array.isArray(item?.variations) ? item.variations : [];
  if (!itemId || variations.length === 0) return item;

  const needsEnrich = (v: any) => {
    const ac = v?.attribute_combinations;
    if (!Array.isArray(ac) || ac.length === 0) return true;
    const { color, size } = mlVariationColorSizeFromApi(v);
    return !mlVariationSkuFromApi(v) && !color && !size;
  };

  if (!variations.some(needsEnrich)) return item;

  const headers = { Authorization: `Bearer ${accessToken}` };
  const enriched = await Promise.all(
    variations.map(async (v: any) => {
      if (!needsEnrich(v)) return v;
      const vid = v?.id;
      if (vid == null) return v;
      try {
        const r = await axios.get(`https://api.mercadolibre.com/items/${itemId}/variations/${vid}`, {
          headers,
          validateStatus: () => true
        });
        if (r.status === 200 && r.data) {
          return {
            ...v,
            ...r.data,
            id: v.id,
            available_quantity: v.available_quantity ?? r.data.available_quantity,
            attribute_combinations: r.data.attribute_combinations ?? v.attribute_combinations,
            attributes: r.data.attributes ?? v.attributes
          };
        }
      } catch {
        /* ignorar variación inválida */
      }
      return v;
    })
  );
  return { ...item, variations: enriched };
}

/** ID de producto de catálogo (/p/MLA...) desde el permalink del ítem. */
function catalogProductIdFromMercadoLibreItem(item: any): string {
  const link = (item?.permalink ?? '').toString();
  const m = link.match(/\/p\/(ML[A-Z]{0,5}-?\d+)/i);
  return m?.[1] ? normalizeMercadoLibreItemId(m[1]) : '';
}

/** Reúne IDs de publicaciones ML asociadas (UP, catálogo /p/MLA..., ítem resuelto). */
async function gatherMercadoLibreItemIdsForAllVariations(opts: {
  requestedRaw: string;
  requestedNormalized: string;
  shouldResolveAsUserProduct: boolean;
  resolvedItemId: string;
  item: any | null;
  sellerId: string | number;
  accessToken: string;
  preloadedCatalogIds?: string[];
  preloadedUserProductIds?: string[];
}): Promise<string[]> {
  const seen = new Set<string>();
  const add = (id: unknown) => {
    const s = String(id || '').trim();
    if (!s) return;
    for (const c of mercadoLibreItemIdCandidates(s)) seen.add(c);
  };

  if (opts.resolvedItemId) add(opts.resolvedItemId);
  for (const id of opts.preloadedCatalogIds || []) add(id);
  for (const id of opts.preloadedUserProductIds || []) add(id);

  const catalogProductIds = new Set<string>();
  catalogProductIds.add(opts.requestedRaw);
  catalogProductIds.add(opts.requestedNormalized);
  const catalogFromItem = opts.item ? catalogProductIdFromMercadoLibreItem(opts.item) : '';
  if (catalogFromItem) catalogProductIds.add(catalogFromItem);
  for (const c of mercadoLibreItemIdCandidates(opts.requestedRaw)) {
    if (/^MLA\d+$/i.test(c)) catalogProductIds.add(c);
  }
  const mUp = opts.requestedNormalized.match(/^MLAU(\d+)$/i);
  if (mUp) catalogProductIds.add(`MLA${mUp[1]}`);
  const mLa = opts.requestedNormalized.match(/^MLA(\d+)$/i);
  if (mLa) catalogProductIds.add(`MLAU${mLa[1]}`);

  for (const pid of catalogProductIds) {
    const catIds = await resolveMercadoLibreCatalogProductItems(pid, opts.accessToken);
    for (const id of catIds) add(id);
  }

  const userProductIds = new Set<string>();
  if (opts.shouldResolveAsUserProduct) userProductIds.add(opts.requestedNormalized);
  const upFromItem = (opts.item?.user_product_id ?? '').toString().trim();
  if (/^MLAU\d+$/i.test(upFromItem)) userProductIds.add(upFromItem);
  if (mLa) userProductIds.add(`MLAU${mLa[1]}`);
  if (mUp) userProductIds.add(opts.requestedNormalized);

  for (const upId of userProductIds) {
    const upResolved = await resolveMercadoLibreUserProductItems(upId, opts.sellerId, opts.accessToken);
    for (const id of upResolved.itemCandidates) add(id);
  }

  if (opts.item) {
    const siblingIds = await findMercadoLibreSiblingListingIds(opts.item, opts.sellerId, opts.accessToken);
    for (const id of siblingIds) add(id);

    const familyName = mlFamilyNameFromItem(opts.item);
    if (familyName) {
      const familyIds = await resolveMercadoLibreItemsByFamilyName(familyName, opts.sellerId, opts.accessToken);
      for (const id of familyIds) add(id);
    }

    const skuPrefixes = new Set<string>();
    for (const sku of collectMercadoLibreItemSkus(opts.item)) {
      const prefix = extractArticlePrefixFromMlSku(sku);
      if (prefix) skuPrefixes.add(prefix);
    }
    for (const prefix of skuPrefixes) {
      const skuIds = await resolveMercadoLibreItemsByArticlePrefix(prefix, opts.sellerId, opts.accessToken);
      for (const id of skuIds) add(id);
    }
  }

  return Array.from(seen).slice(0, 120);
}

/** Agrega variaciones de varias publicaciones ML (todos los colores/talles). */
async function aggregateMercadoLibreVariationsFromItemIds(
  itemIds: string[],
  accessToken: string
): Promise<MlVariationRow[]> {
  const merged: MlVariationRow[] = [];
  for (const candidate of itemIds) {
    try {
      const itemRes = await axios.get(`https://api.mercadolibre.com/items/${candidate}?include_attributes=all`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const enriched = await enrichMercadoLibreItemVariationsForCatalog(itemRes?.data, accessToken);
      merged.push(...extractMlVariationsFromItemData(enriched));
    } catch {
      // ignorar ítem inválido
    }
  }
  return dedupeMlVariationRows(merged);
}

/** Publicaciones del mismo vendedor con el mismo título base (un listing por talle/color). */
async function findMercadoLibreSiblingListingIds(
  item: any,
  sellerId: string | number,
  accessToken: string
): Promise<string[]> {
  const baseTitle = mlBaseTitle((item?.title || '').toString().trim());
  const baseTitleLoose = mlStripTrailingPublicationIndex(baseTitle);
  if (!baseTitle) return [];
  const siblingIds: string[] = [];
  const seen = new Set<string>();
  const pageLimit = 50;
  for (const status of ['active', 'paused'] as const) {
    let offset = 0;
    while (offset < 500) {
      const searchRes = await axios.get(
        `https://api.mercadolibre.com/users/${encodeURIComponent(String(sellerId))}/items/search`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { q: baseTitleLoose || baseTitle, limit: pageLimit, offset, status },
          validateStatus: () => true
        }
      );
      const rows: string[] =
        searchRes.status === 200 && Array.isArray(searchRes.data?.results)
          ? searchRes.data.results.map((x: any) => String(x || '').trim()).filter(Boolean)
          : [];
      for (const id of rows) {
        if (!seen.has(id)) {
          seen.add(id);
          siblingIds.push(id);
        }
      }
      if (rows.length < pageLimit) break;
      offset += pageLimit;
    }
  }
  const unique = Array.from(new Set(siblingIds));
  return unique.filter((sid) => {
    // Se valida título al extraer variaciones; aquí solo limitamos cantidad.
    return sid && sid !== String(item?.id || '');
  }).slice(0, 120);
}

function mlFamilyNameFromItem(item: any): string {
  return String(item?.family_name ?? '').trim();
}

/** Prefijo de artículo Lupo/Tango desde SKU (ej. 24650150542 → 24650, 24650-130-280 → 24650). */
function extractArticlePrefixFromMlSku(sku: string): string | null {
  const s = String(sku || '').trim();
  if (!s) return null;
  const dashHead = s.split('-')[0];
  if (/^\d{4,7}$/.test(dashHead)) return dashHead;
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 11) return digits.slice(0, 5);
  if (digits.length >= 8) return digits.slice(0, 5);
  if (/^\d{4,7}$/.test(digits)) return digits;
  return null;
}

function collectMercadoLibreItemSkus(it: any): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => {
    const t = String(v ?? '').trim();
    if (t) out.add(t);
  };
  add(it?.seller_sku);
  add(it?.seller_custom_field);
  const attrs = Array.isArray(it?.attributes) ? it.attributes : [];
  const skuAttr = attrs.find((a: any) => (a?.id || '').toString().toUpperCase() === 'SELLER_SKU');
  if (skuAttr) add(skuAttr.value_name ?? skuAttr.value);
  if (Array.isArray(it?.variations)) {
    for (const v of it.variations) {
      add(v?.seller_sku);
      add(v?.seller_custom_field);
      const vAttr = Array.isArray(v?.attributes) && v.attributes.find((a: any) => (a.id || '').toUpperCase() === 'SELLER_SKU');
      if (vAttr) add(vAttr.value_name ?? vAttr.value);
    }
  }
  return [...out];
}

/** Busca publicaciones del vendedor paginando /items/search. */
async function searchMercadoLibreSellerItems(
  sellerId: string | number,
  accessToken: string,
  params: Record<string, string | number>,
  maxResults = 200
): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];
  const pageLimit = 50;
  let offset = 0;
  while (out.length < maxResults && offset < 5000) {
    const res = await axios.get(
      `https://api.mercadolibre.com/users/${encodeURIComponent(String(sellerId))}/items/search`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { ...params, limit: pageLimit, offset },
        validateStatus: () => true
      }
    );
    if (res.status >= 400 || !res.data) break;
    const rows: any[] = Array.isArray(res.data?.results) ? res.data.results : [];
    for (const x of rows) {
      const id = String(x || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    if (rows.length < pageLimit) break;
    offset += pageLimit;
  }
  return out;
}

/** Publicaciones hermanas por family_name (User Product / catálogo ML). */
async function resolveMercadoLibreItemsByFamilyName(
  familyName: string,
  sellerId: string | number,
  accessToken: string
): Promise<string[]> {
  const fn = String(familyName || '').trim();
  if (!fn) return [];
  const statuses = ['active', 'paused'] as const;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const st of statuses) {
    const ids = await searchMercadoLibreSellerItems(sellerId, accessToken, { q: fn, status: st }, 120);
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out.slice(0, 120);
}

/** Publicaciones del mismo artículo por prefijo de SKU (24650 → 24650130542, 24650140542…). */
async function resolveMercadoLibreItemsByArticlePrefix(
  prefix: string,
  sellerId: string | number,
  accessToken: string
): Promise<string[]> {
  const p = String(prefix || '').trim().replace(/\D/g, '');
  if (!p || p.length < 4) return [];
  const searchIds = await searchMercadoLibreSellerItems(sellerId, accessToken, { q: p, status: 'active' }, 200);
  const prefixLoose = p.replace(/^0+/, '') || p;
  const matched: string[] = [];
  const seen = new Set<string>();
  for (const id of searchIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    try {
      const r = await axios.get(`https://api.mercadolibre.com/items/${id}?include_attributes=all`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true
      });
      const it = r.data;
      if (!it?.id) continue;
      const skus = collectMercadoLibreItemSkus(it);
      const hit = skus.some((s) => {
        const d = s.replace(/\D/g, '');
        return d.startsWith(p) || d.startsWith(prefixLoose) || s.startsWith(p) || s.startsWith(prefixLoose);
      });
      if (hit) matched.push(String(it.id));
    } catch {
      // ignorar ítem inválido
    }
  }
  return matched.slice(0, 120);
}

/** PUT a Tienda Nube con reintentos ante 429 (Too Many Requests). */
async function putTnVariantWithRetry(
  url: string,
  body: { stock: number },
  headers: Record<string, string>,
  maxRetries = 2
): Promise<void> {
  await tnPutWithRetry(
    axios,
    url,
    body,
    { headers },
    {
      maxRetries: Math.max(0, maxRetries),
      // minIntervalMs se resuelve dentro del helper desde env TN_RATE_LIMIT_DELAY_MS
    }
  );
}

/** URL del frontend para redirigir después del OAuth (producción: tu dominio Vercel). */
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

// Función para obtener un token válido de Mercado Libre (refresca automáticamente si expiró)
export async function getValidMLToken(): Promise<{ access_token: string; user_id: string } | null> {
  const integration = await get(`SELECT access_token, refresh_token, expires_at, user_id FROM integrations WHERE platform = 'mercadolibre'`);
  
  if (!integration) {
    return null;
  }

  const now = new Date();
  const expiresAt = new Date(integration.expires_at);
  
  // Si el token expira en menos de 10 minutos, refrescarlo
  const bufferTime = 10 * 60 * 1000; // 10 minutos
  if (expiresAt.getTime() - now.getTime() < bufferTime) {
    console.log('[ML Token] Token expirando pronto, refrescando...');
    
    const appId = process.env.MERCADO_LIBRE_APP_ID;
    const clientSecret = process.env.MERCADO_LIBRE_CLIENT_SECRET;
    
    if (!appId || !clientSecret || !integration.refresh_token) {
      console.error('[ML Token] No se puede refrescar: faltan credenciales o refresh_token');
      return null;
    }

    try {
      const response = await axios.post(ML_TOKEN_URL, {
        grant_type: 'refresh_token',
        client_id: appId,
        client_secret: clientSecret,
        refresh_token: integration.refresh_token
      });

      const { access_token, refresh_token, expires_in } = response.data;
      const newExpiresAt = new Date(Date.now() + expires_in * 1000);

      // Actualizar en la base de datos
      await execute(`
        UPDATE integrations 
        SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE platform = 'mercadolibre'
      `, [access_token, refresh_token, newExpiresAt]);

      console.log('[ML Token] Token refrescado exitosamente, expira:', newExpiresAt);
      
      return { access_token, user_id: integration.user_id };
    } catch (error: any) {
      console.error('[ML Token] Error refrescando token:', error.response?.data || error.message);
      return null;
    }
  }

  return { access_token: integration.access_token, user_id: integration.user_id };
}

export const getIntegrationStatus = async (req: Request, res: Response) => {
  try {
    const integrations = await query('SELECT platform, store_id, user_id FROM integrations');
    const tn = integrations.find((i: any) => i.platform === 'tiendanube');
    const metaAds = integrations.find((i: any) => i.platform === 'meta_ads');
    const googleAds = integrations.find((i: any) => i.platform === 'google_ads');
    const status = {
      mercadolibre: integrations.find((i: any) => i.platform === 'mercadolibre') ? true : false,
      tiendanube: !!tn,
      tiendanubeStoreId: (tn?.store_id || tn?.user_id) || null,
      metaAds: !!(metaAds?.access_token && metaAds?.user_id) || !!(process.env.META_ADS_ACCESS_TOKEN && process.env.META_ADS_ACCOUNT_ID),
      googleAds: !!(googleAds?.refresh_token && googleAds?.user_id) || !!(process.env.GOOGLE_ADS_REFRESH_TOKEN && process.env.GOOGLE_ADS_CUSTOMER_ID),
    };
    res.json(status);
  } catch (error) {
    console.error('Error getting integration status:', error);
    res.status(500).json({ message: 'Error getting integration status' });
  }
};

// Mercado Libre
export const getMercadoLibreAuthUrl = (req: Request, res: Response) => {
  const appId = process.env.MERCADO_LIBRE_APP_ID;
  // Use HTTPS for ngrok or production, but allow env override
  const redirectUri = process.env.MERCADO_LIBRE_REDIRECT_URI || 'https://dignifiedly-overgifted-ellsworth.ngrok-free.dev/api/integrations/mercadolibre/callback';
  
  if (!appId) {
    return res.status(500).json({ message: 'Mercado Libre App ID not configured' });
  }

  const url = `${ML_AUTH_URL}?response_type=code&client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  res.json({ url });
};

export const handleMercadoLibreCallback = async (req: Request, res: Response) => {
  const { code } = req.query;
  const appId = process.env.MERCADO_LIBRE_APP_ID;
  const clientSecret = process.env.MERCADO_LIBRE_CLIENT_SECRET;
  const redirectUri = process.env.MERCADO_LIBRE_REDIRECT_URI || 'https://dignifiedly-overgifted-ellsworth.ngrok-free.dev/api/integrations/mercadolibre/callback';

  if (!code || !appId || !clientSecret) {
    return res.status(400).send('Missing code or configuration');
  }

  try {
    const response = await axios.post(ML_TOKEN_URL, {
      grant_type: 'authorization_code',
      client_id: appId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    });

    const { access_token, refresh_token, expires_in, user_id } = response.data;
    
    // Calculate expiration time
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // Save or update token
    await execute(`
      INSERT INTO integrations (platform, access_token, refresh_token, expires_at, user_id)
      VALUES ('mercadolibre', ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      access_token = VALUES(access_token),
      refresh_token = VALUES(refresh_token),
      expires_at = VALUES(expires_at),
      user_id = VALUES(user_id),
      updated_at = CURRENT_TIMESTAMP
    `, [access_token, refresh_token, expiresAt, user_id]);

    // Redirect to frontend settings page with success
    res.redirect(`${FRONTEND_URL}/#settings?status=success&platform=mercadolibre`);
  } catch (error: any) {
    console.error('Error in Mercado Libre callback:', error.response?.data || error.message);
    res.redirect(`${FRONTEND_URL}/#settings?status=error&platform=mercadolibre`);
  }
};

// Tienda Nube
export const getTiendaNubeAuthUrl = (req: Request, res: Response) => {
  const appId = process.env.TIENDA_NUBE_APP_ID;
  
  if (!appId) {
    return res.status(500).json({ message: 'Tienda Nube App ID not configured' });
  }

  // Scope read_orders es necesario para poder obtener el detalle de la orden cuando llega el webhook order/paid y descontar stock
  const redirectUri = process.env.TIENDA_NUBE_REDIRECT_URI || 'http://localhost:3010/api/integrations/tiendanube/callback';
  const url = `https://www.tiendanube.com/apps/${appId}/authorize?response_type=code&scope=write_products,read_products,read_orders,write_scripts,write_content&redirect_uri=${encodeURIComponent(redirectUri)}`;
  res.json({ url });
};

export const handleTiendaNubeCallback = async (req: Request, res: Response) => {
  const { code } = req.query;
  const appId = process.env.TIENDA_NUBE_APP_ID;
  const clientSecret = process.env.TIENDA_NUBE_CLIENT_SECRET;
  const redirectUri = process.env.TIENDA_NUBE_REDIRECT_URI || 'http://localhost:3010/api/integrations/tiendanube/callback';

  if (!code || !appId || !clientSecret) {
    return res.status(400).send('Missing code or configuration');
  }

  try {
    const response = await axios.post(TN_TOKEN_URL, {
      client_id: appId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    });

    const { access_token, user_id, scope } = response.data;
    
    // Tienda Nube tokens might not expire in the same way, or they might. The response usually has expires_in.
    // If not provided, we assume it's long-lived or handled differently.
    // Let's assume standard OAuth 2.0.
    const expires_in = response.data.expires_in || 31536000; // Default to 1 year if not provided
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // En Tienda Nube, user_id es el store_id
    await execute(`
      INSERT INTO integrations (platform, access_token, refresh_token, expires_at, user_id, store_id)
      VALUES ('tiendanube', ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      access_token = VALUES(access_token),
      refresh_token = VALUES(refresh_token),
      expires_at = VALUES(expires_at),
      user_id = VALUES(user_id),
      store_id = VALUES(store_id),
      updated_at = CURRENT_TIMESTAMP
    `, [access_token, response.data.refresh_token || null, expiresAt, user_id, user_id]);

    // Registrar webhooks: order/paid (descontar stock) y order/cancelled (restaurar stock)
    const backendUrl = (process.env.BACKEND_URL || process.env.API_URL || '').replace(/\/$/, '');
    if (backendUrl && backendUrl.startsWith('https://')) {
      const webhookUrl = `${backendUrl}/api/integrations/tiendanube/webhook`;
      const webhookEvents = ['order/paid', 'order/cancelled'] as const;
      for (const ev of webhookEvents) {
        try {
          await axios.post(
            `https://api.tiendanube.com/v1/${user_id}/webhooks`,
            { event: ev, url: webhookUrl },
            { headers: { 'Authentication': `bearer ${access_token}`, 'User-Agent': TN_USER_AGENT } }
          );
          console.log(`[TN] Webhook ${ev} registrado:`, webhookUrl);
        } catch (whErr: any) {
          const msg = whErr.response?.data?.url?.[0] || whErr.response?.data?.event?.[0] || whErr.message;
          console.warn(`[TN] No se pudo registrar webhook ${ev} (puede existir ya):`, msg);
        }
      }
    } else {
      console.warn('[TN] Configure BACKEND_URL (HTTPS) en .env para activar descuento de stock automático por ventas.');
    }

    try {
      const pageCfg = await loadExpressTrackingPageConfig();
      if (pageCfg.enabled) {
        await syncExpressTrackingPageToStore({ enabled: true });
        console.log('[TN] Página de seguimiento express sincronizada tras reconexión OAuth.');
      }
    } catch (pageErr: any) {
      console.warn('[TN] No se pudo sincronizar página de seguimiento tras OAuth:', pageErr?.message || pageErr);
    }

    res.redirect(`${FRONTEND_URL}/#settings?status=success&platform=tiendanube`);
  } catch (error: any) {
    console.error('Error in Tienda Nube callback:', error.response?.data || error.message);
    res.redirect(`${FRONTEND_URL}/#settings?status=error&platform=tiendanube`);
  }
};

export const updateMercadoLibreStock = async (sku: string, newStock: number) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) return;

    const { access_token, user_id } = mlToken;

    // 1. Search item by SKU (seller_custom_field)
    // ML API to search items by SKU is tricky, usually we search by item_id.
    // Assuming we don't have item_id mapped in DB yet, we might need to search.
    // Or if we have mapped it, use it.
    
    // For now, let's assume we need to search or we rely on 'mercadolibre_id' in products table if it was mapped.
    // But stock is per variant.
    // We need to know the ML Variation ID.
    
    // Simplification: Log that we would update ML here.
    // To do this properly we need to store ML Item ID and Variation ID in product_variants.
    console.log(`[ML Sync] Would update SKU ${sku} to stock ${newStock}`);
    
    // Actual implementation requires:
    // 1. GET /users/{user_id}/items/search?seller_sku={sku} -> Get Item ID
    // 2. GET /items/{item_id} -> Find Variation ID matching SKU
    // 3. PUT /items/{item_id}/variations/{variation_id} { available_quantity: newStock }
    
    // Since we don't have this mapping fully robust yet, we'll implement a best-effort search.
    const searchRes = await axios.get(`https://api.mercadolibre.com/users/${user_id}/items/search`, {
        headers: { Authorization: `Bearer ${access_token}` },
        params: { seller_sku: sku }
    });
    
    if (searchRes.data.results && searchRes.data.results.length > 0) {
        const itemId = searchRes.data.results[0];
        // Fetch item details to find variation
        const itemRes = await axios.get(`https://api.mercadolibre.com/items/${itemId}?include_attributes=all`, {
            headers: { Authorization: `Bearer ${access_token}` }
        });
        
        const variations = itemRes.data.variations;
        let variationId = null;
        
        const matchVariationBySku = (v: any) => {
          const vSku = (v.seller_sku ?? v.seller_custom_field ?? '').toString().trim();
          if (vSku === sku) return true;
          const attr = Array.isArray(v.attributes) && v.attributes.find((a: any) => (a.id || '').toString().toUpperCase() === 'SELLER_SKU');
          const attrVal = attr ? (attr.value_name ?? attr.value ?? '').toString().trim() : '';
          return attrVal === sku;
        };
        if (variations && variations.length > 0) {
            const targetVar = variations.find((v: any) => matchVariationBySku(v));
            if (targetVar) variationId = targetVar.id;
        }
        
        if (variationId) {
            // Update Variation Stock
            await axios.put(`https://api.mercadolibre.com/items/${itemId}/variations/${variationId}`, {
                available_quantity: newStock
            }, {
                headers: { Authorization: `Bearer ${access_token}` }
            });
            console.log(`[ML Sync] Updated Item ${itemId} Variation ${variationId} to ${newStock}`);
        } else if (!variations || variations.length === 0) {
            // Update Item Stock (if no variations)
            await axios.put(`https://api.mercadolibre.com/items/${itemId}`, {
                available_quantity: newStock
            }, {
                headers: { Authorization: `Bearer ${access_token}` }
            });
            console.log(`[ML Sync] Updated Item ${itemId} to ${newStock}`);
        }
    }
    
  } catch (error: any) {
    console.error(`[ML Sync Error] SKU ${sku}:`, error.response?.data || error.message);
  }
};

export const syncProductsFromTiendaNube = async (req: Request, res: Response) => {
  try {
    // 1. Get Access Token
    const integration = await get(`SELECT * FROM integrations WHERE platform = 'tiendanube'`);
    if (!integration || !integration.access_token) {
      return res.status(400).json({ message: 'No estás conectado a Tienda Nube' });
    }

    const { access_token, user_id: store_id } = integration;

    // 2. Fetch Products from Tienda Nube
    // Pagination loop
    let page = 1;
    let hasMore = true;
    let productCount = 0;
    let variantCount = 0;
    const logs: string[] = [];
    const log = (msg: string) => {
      console.log(msg);
      logs.push(msg);
    };

    // Los productos de TN/ML no se guardan en la BD; solo se consulta la API para reportar.
    const perPage = 200;
    while (hasMore) {
      try {
        const response = await axios.get(`https://api.tiendanube.com/v1/${store_id}/products`, {
          headers: {
            'Authentication': `bearer ${access_token}`,
            'User-Agent': TN_USER_AGENT
          },
          params: { page, per_page: perPage }
        });

        const products = response.data;
        if (products.length === 0) {
          hasMore = false;
          break;
        }
        log(`[TN] Página ${page}: ${products.length} productos`);
        if (products.length < perPage) hasMore = false;

        for (const tnProduct of products) {
          productCount++;
          const variants = tnProduct.variants || [];
          variantCount += variants.length;
          log(`  ${tnProduct.name?.es || tnProduct.name} (ID: ${tnProduct.id}): ${variants.length} variantes`);
        }

        page++;
        // Safety break (hasta 200 páginas = 40.000 productos)
        if (page > 200) hasMore = false; 
      } catch (error: any) {
        // If 404, likely means page out of range or end of list
        if (error.response?.status === 404) {
          hasMore = false;
        } else {
          throw error;
        }
      }
    }

    log('');
    log('Los productos de Tienda Nube no se guardan en la base de datos. Usá la vista "Vista Tienda Nube" en Inventario para ver el stock.');
    res.json({
      message: 'Consulta completada. Los productos de Tienda Nube no se guardan en la BD.',
      imported: 0,
      updated: 0,
      productCount,
      variantCount,
      logs
    });

  } catch (error: any) {
    console.error('Error syncing products:', error.response?.data || error.message);
    res.status(500).json({ message: 'Error sincronizando productos', error: error.message });
  }
};

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

type TnNormalizeResume = { page: number; productIndex: number; variantIndex: number };

function getTiendaNubeStoreId(integration: { store_id?: string | null; user_id?: string | null }): string | null {
  const id = String(integration.store_id ?? integration.user_id ?? '').trim();
  return id || null;
}

function parseTnNormalizeBatchBody(req: Request): {
  startPage: number;
  maxPages: number;
  maxUpdates: number;
  resume?: TnNormalizeResume;
} {
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const startPage = Math.max(1, parseInt(String(body.startPage ?? 1), 10) || 1);
  const maxPages = Math.min(10, Math.max(1, parseInt(String(body.maxPages ?? 2), 10) || 2));
  const maxUpdates = Math.min(200, Math.max(1, parseInt(String(body.maxUpdates ?? 25), 10) || 25));
  const raw = body.resume;
  let resume: TnNormalizeResume | undefined;
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    resume = {
      page: Math.max(1, parseInt(String(r.page ?? startPage), 10) || startPage),
      productIndex: Math.max(0, parseInt(String(r.productIndex ?? 0), 10) || 0),
      variantIndex: Math.max(0, parseInt(String(r.variantIndex ?? 0), 10) || 0),
    };
  }
  return { startPage, maxPages, maxUpdates, resume };
}

function tnAttributeLabel(attr: unknown): string {
  return (
    (attr as { es?: string; en?: string; pt?: string })?.es
    ?? (attr as { es?: string; en?: string; pt?: string })?.en
    ?? (attr as { es?: string; en?: string; pt?: string })?.pt
    ?? (typeof attr === 'string' ? attr : '')
  ).toString();
}

function tnVariantValueText(val: unknown): string {
  return (
    (val as { es?: string; en?: string; pt?: string })?.es
    ?? (val as { es?: string; en?: string; pt?: string })?.pt
    ?? (val as { es?: string; en?: string; pt?: string })?.en
    ?? val
  )?.toString().trim() || '';
}

/** Clave única Color+Talle+… para detectar variantes repetidas en Tienda Nube. */
function tnVariantComboKey(values: unknown[], attrIndex: number, replaceAtAttr?: string): string {
  const parts: string[] = [];
  for (let i = 0; i < values.length; i++) {
    const text =
      i === attrIndex && replaceAtAttr !== undefined ? replaceAtAttr : tnVariantValueText(values[i]);
    parts.push(
      text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
    );
  }
  return parts.join('||');
}

type TnVariantNormalizePlan = {
  variant: {
    id: number | string;
    values?: unknown[];
    stock?: number | string | null;
    stock_management?: boolean;
  };
  vi: number;
  current: string;
  normalized: string;
  willUpdate: boolean;
  newKey: string;
};

async function normalizeTiendaNubeVariantAttribute(options: {
  access_token: string;
  store_id: string;
  isTargetAttribute: (attrName: string) => boolean;
  normalizeValue: (raw: string) => string;
  shouldUpdate?: (current: string, normalized: string) => boolean;
  completedMessage: string;
  startPage?: number;
  maxPages?: number;
  maxUpdates?: number;
  resume?: TnNormalizeResume;
}): Promise<{
  updatedVariants: number;
  skippedProducts: number;
  skippedDuplicates: number;
  mergedVariants: number;
  logs: string[];
  hasMore: boolean;
  nextPage?: number;
  resume?: TnNormalizeResume;
}> {
  const { access_token, store_id, isTargetAttribute, normalizeValue, completedMessage } = options;
  const shouldUpdate = options.shouldUpdate ?? ((c, n) => c !== n);
  const maxPages = options.maxPages ?? 2;
  const maxUpdates = options.maxUpdates ?? 40;
  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };
  let updatedVariants = 0;
  let skippedProducts = 0;
  let skippedDuplicates = 0;
  let mergedVariants = 0;
  let updatesThisBatch = 0;
  let page = options.resume?.page ?? options.startPage ?? 1;
  let productStart = options.resume?.productIndex ?? 0;
  let variantStart = options.resume?.variantIndex ?? 0;
  let pagesProcessed = 0;
  let stoppedByCap = false;
  let lastPageFull = false;
  const perPage = 50;
  const tnHeaders = { Authentication: `bearer ${access_token}`, 'User-Agent': TN_USER_AGENT };

  while (pagesProcessed < maxPages && updatesThisBatch < maxUpdates) {
    let products: unknown[] = [];
    try {
      const response = await axios.get(`https://api.tiendanube.com/v1/${store_id}/products`, {
        headers: tnHeaders,
        params: { page, per_page: perPage },
      });
      products = Array.isArray(response.data) ? response.data : [];
    } catch (err: unknown) {
      const ax = err as { response?: { status?: number; data?: unknown }; message?: string };
      if (ax.response?.status === 404) {
        break;
      }
      throw err;
    }

    if (!products.length) break;
    lastPageFull = products.length >= perPage;
    log(`[TN] Página ${page}: ${products.length} productos`);

    for (let pi = productStart; pi < products.length; pi++) {
      const tnProduct = products[pi] as {
        id: number | string;
        attributes?: unknown[];
        variants?: Array<{
          id: number | string;
          values?: unknown[];
          stock?: number | string | null;
          stock_management?: boolean;
        }>;
      };
      const productAttributes = tnProduct.attributes || [];
      let attrIndex = -1;
      for (let i = 0; i < productAttributes.length; i++) {
        if (isTargetAttribute(tnAttributeLabel(productAttributes[i]))) {
          attrIndex = i;
          break;
        }
      }
      if (attrIndex === -1) {
        skippedProducts++;
        variantStart = 0;
        continue;
      }

      let variants = tnProduct.variants || [];
      try {
        const allVariants = await fetchAllTiendaNubeProductVariants(store_id, tnProduct.id, tnHeaders);
        if (allVariants.length > 0) variants = allVariants;
      } catch (fetchErr: unknown) {
        const m = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        log(`  [WARN] Producto ${tnProduct.id}: no se pudieron listar todas las variantes (${m})`);
      }

      const plans: TnVariantNormalizePlan[] = [];
      for (let vi = 0; vi < variants.length; vi++) {
        const variant = variants[vi];
        const values = variant.values || [];
        if (attrIndex >= values.length) continue;
        let current = '';
        let normalized = '';
        try {
          current = tnVariantValueText(values[attrIndex]);
          normalized = normalizeValue(current);
        } catch (normErr: unknown) {
          const m = normErr instanceof Error ? normErr.message : String(normErr);
          log(`  [ERROR] Variante ${variant.id}: normalización falló (${m})`);
          continue;
        }
        const willUpdate = shouldUpdate(current, normalized);
        plans.push({
          variant,
          vi,
          current,
          normalized,
          willUpdate,
          newKey: tnVariantComboKey(values, attrIndex, normalized),
        });
      }

      const groupsByEffectiveKey = new Map<string, TnVariantNormalizePlan[]>();
      for (const p of plans) {
        const values = p.variant.values || [];
        const key = p.willUpdate ? p.newKey : tnVariantComboKey(values, attrIndex);
        if (!groupsByEffectiveKey.has(key)) groupsByEffectiveKey.set(key, []);
        groupsByEffectiveKey.get(key)!.push(p);
      }

      const mergedKeys = new Set<string>();

      for (let pi2 = 0; pi2 < plans.length; pi2++) {
        const p = plans[pi2];
        if (pi === productStart && p.vi < variantStart) continue;
        if (updatesThisBatch >= maxUpdates) {
          stoppedByCap = true;
          return {
            updatedVariants,
            skippedProducts,
            skippedDuplicates,
            mergedVariants,
            logs,
            hasMore: true,
            resume: { page, productIndex: pi, variantIndex: p.vi },
          };
        }

        const values = p.variant.values || [];
        const effKey = p.willUpdate ? p.newKey : tnVariantComboKey(values, attrIndex);
        const group = groupsByEffectiveKey.get(effKey) || [];

        if (group.length > 1) {
          if (mergedKeys.has(effKey)) continue;
          mergedKeys.add(effKey);
          try {
            const { mergedCount } = await mergeTiendaNubeDuplicateVariants({
              storeId: store_id,
              productId: tnProduct.id,
              attrIndex,
              group: group.map((g) => ({
                variant: g.variant,
                current: g.current,
                normalized: g.normalized,
                willUpdate: g.willUpdate,
              })),
              headers: tnHeaders,
              log,
            });
            mergedVariants += mergedCount;
            updatedVariants += 1;
            updatesThisBatch++;
          } catch (err: unknown) {
            skippedDuplicates++;
            const m = err instanceof Error ? err.message : String(err);
            log(`  [ERROR] Producto ${tnProduct.id} fusión (${effKey}): ${m}`);
          }
          continue;
        }

        if (!p.willUpdate) continue;

        const newValues = values.map((obj: unknown, i: number) => {
          if (i !== attrIndex) return obj;
          const langKeys = obj && typeof obj === 'object' ? Object.keys(obj as object) : ['es'];
          const next: Record<string, string> = {};
          for (const lang of langKeys) next[lang] = p.normalized;
          return next;
        });

        try {
          await tnPutWithRetry(
            axios,
            `https://api.tiendanube.com/v1/${store_id}/products/${tnProduct.id}/variants/${p.variant.id}`,
            { values: newValues },
            { headers: tnHeaders }
          );
          updatedVariants++;
          updatesThisBatch++;
          log(`  [TN] Producto ${tnProduct.id} variante ${p.variant.id}: "${p.current}" → "${p.normalized}"`);
        } catch (err: unknown) {
          const ax = err as { response?: { data?: { description?: string } }; message?: string };
          const desc = ax.response?.data?.description || ax.message || '';
          if (/cannot be repeated|no pueden repetirse|variantes.*repetid/i.test(desc)) {
            skippedDuplicates++;
            log(`  [SKIP] Variante ${p.variant.id}: combinación ya existe (${desc})`);
          } else {
            log(`  [ERROR] Variante ${p.variant.id}: ${desc}`);
          }
        }
      }
      variantStart = 0;
    }

    productStart = 0;
    page++;
    pagesProcessed++;
    if (!lastPageFull) break;
    if (page > 300) break;
  }

  const hasMore = stoppedByCap || (lastPageFull && pagesProcessed >= maxPages);
  if (!hasMore) log(completedMessage);

  return {
    updatedVariants,
    skippedProducts,
    skippedDuplicates,
    mergedVariants,
    logs,
    hasMore,
    nextPage: hasMore && !stoppedByCap ? page : undefined,
  };
}

export const normalizeSizesInTiendaNube = async (req: Request, res: Response) => {
  try {
    const integration = await get(`SELECT * FROM integrations WHERE platform = 'tiendanube'`);
    if (!integration?.access_token) {
      return res.status(400).json({ message: 'No estás conectado a Tienda Nube' });
    }
    const store_id = getTiendaNubeStoreId(integration);
    if (!store_id) {
      return res.status(400).json({ message: 'Integración Tienda Nube sin ID de tienda (store_id)' });
    }
    const batch = parseTnNormalizeBatchBody(req);
    const result = await normalizeTiendaNubeVariantAttribute({
      access_token: integration.access_token,
      store_id,
      isTargetAttribute: (name) => /talle|talla|size|tamano|tamaño/i.test(name),
      normalizeValue: normalizeSizeToStandard,
      completedMessage: 'Normalización de talles en Tienda Nube completada',
      ...batch,
    });
    res.json({
      message: result.hasMore
        ? 'Lote de talles procesado; hay más productos pendientes'
        : 'Normalización de talles en Tienda Nube completada',
      ...result,
    });
  } catch (error: unknown) {
    const ax = error as { response?: { data?: unknown }; message?: string };
    console.error('Error normalizing sizes:', ax.response?.data || ax.message);
    res.status(500).json({
      message: 'Error normalizando talles en Tienda Nube',
      error: ax.message,
      detail: ax.response?.data,
    });
  }
};

export const normalizeColorsInTiendaNube = async (req: Request, res: Response) => {
  try {
    const integration = await get(`SELECT * FROM integrations WHERE platform = 'tiendanube'`);
    if (!integration?.access_token) {
      return res.status(400).json({ message: 'No estás conectado a Tienda Nube' });
    }
    const store_id = getTiendaNubeStoreId(integration);
    if (!store_id) {
      return res.status(400).json({ message: 'Integración Tienda Nube sin ID de tienda (store_id)' });
    }
    const batch = parseTnNormalizeBatchBody(req);
    const result = await normalizeTiendaNubeVariantAttribute({
      access_token: integration.access_token,
      store_id,
      isTargetAttribute: (name) =>
        /color|colour|colore|cor\b|colores/i.test(name) && !/talle|talla|size|tamano|tamaño/i.test(name),
      normalizeValue: normalizeColorNameToStandard,
      shouldUpdate: shouldUpdateColorValue,
      completedMessage: 'Normalización de colores en Tienda Nube completada',
      ...batch,
    });
    res.json({
      message: result.hasMore
        ? 'Lote de colores procesado; hay más productos pendientes'
        : 'Normalización de colores en Tienda Nube completada',
      ...result,
    });
  } catch (error: unknown) {
    const ax = error as { response?: { data?: unknown }; message?: string };
    console.error('Error normalizing colors:', ax.response?.data || ax.message);
    res.status(500).json({
      message: 'Error normalizando colores en Tienda Nube',
      error: ax.message,
      detail: ax.response?.data,
    });
  }
};

/** Envía a Tienda Nube el SKU de LupoHub (base-talle-color) en todas las variantes vinculadas. */
export const syncSkusToTiendaNube = async (req: Request, res: Response) => {
  try {
    const integration = await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
    if (!integration?.access_token) {
      return res.status(400).json({ message: 'No estás conectado a Tienda Nube' });
    }
    const store_id = getTiendaNubeStoreId(integration);
    if (!store_id) {
      return res.status(400).json({ message: 'Integración Tienda Nube sin ID de tienda (store_id)' });
    }

    const rows = await query(
      `SELECT pv.id AS variant_id, pv.sku, pv.tienda_nube_variant_id, p.tienda_nube_id
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       WHERE pv.tienda_nube_variant_id IS NOT NULL
         AND p.tienda_nube_id IS NOT NULL
         AND pv.sku IS NOT NULL
         AND TRIM(pv.sku) <> ''`
    );

    const headers = {
      Authentication: `bearer ${integration.access_token}`,
      'User-Agent': TN_USER_AGENT,
      'Content-Type': 'application/json',
    };
    const logs: string[] = [];
    let updated = 0;
    let errors = 0;
    let skipped = 0;

    for (const r of rows as Array<{
      variant_id: string;
      sku: string;
      tienda_nube_variant_id: string;
      tienda_nube_id: string;
    }>) {
      const lupoSku = skuToCanonicalString(r.sku);
      if (!lupoSku) {
        skipped++;
        continue;
      }
      try {
        await tnPutWithRetry(
          axios,
          `https://api.tiendanube.com/v1/${store_id}/products/${r.tienda_nube_id}/variants/${r.tienda_nube_variant_id}`,
          { sku: lupoSku },
          { headers }
        );
        updated++;
        if (logs.length < 200) logs.push(`[OK] ${lupoSku} (variante ${r.tienda_nube_variant_id})`);
      } catch (err: unknown) {
        errors++;
        const ax = err as { response?: { data?: { description?: string } }; message?: string };
        if (logs.length < 200) {
          logs.push(`[ERROR] ${lupoSku}: ${ax.response?.data?.description || ax.message}`);
        }
      }
      if (TN_RATE_LIMIT_DELAY_MS > 0) await sleep(TN_RATE_LIMIT_DELAY_MS);
    }

    res.json({
      message: 'Sincronización de SKU a Tienda Nube completada',
      total: rows.length,
      updated,
      errors,
      skipped,
      logs,
    });
  } catch (error: unknown) {
    const ax = error as { response?: { data?: unknown }; message?: string };
    console.error('Error syncing SKUs to TN:', ax.response?.data || ax.message);
    res.status(500).json({ message: 'Error sincronizando SKU a Tienda Nube', error: ax.message });
  }
};

export const disconnectIntegration = async (req: Request, res: Response) => {
  const { platform } = req.params as { platform: 'mercadolibre' | 'tiendanube' };
  if (!platform || !['mercadolibre', 'tiendanube'].includes(platform)) {
    return res.status(400).json({ message: 'Plataforma inválida' });
  }
  try {
    await execute(`DELETE FROM integrations WHERE platform = ?`, [platform]);
    return res.json({ message: 'Desconectado', platform });
  } catch (error: any) {
    return res.status(500).json({ message: 'Error desconectando', error: error.message });
  }
};

export const testMercadoLibreConnection = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ 
        success: false, 
        message: 'No estás conectado a Mercado Libre o el token no se pudo refrescar',
        details: 'No se encontró token de acceso válido'
      });
    }
    
    const { access_token, user_id } = mlToken;
    
    // Obtener fecha de expiración actual
    const integration = await get(`SELECT expires_at FROM integrations WHERE platform = 'mercadolibre'`);
    
    // Probar la conexión obteniendo información del usuario
    const userRes = await axios.get(`https://api.mercadolibre.com/users/${user_id}`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    
    // Obtener cantidad de publicaciones
    const itemsRes = await axios.get(`https://api.mercadolibre.com/users/${user_id}/items/search`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    
    res.json({ 
      success: true, 
      message: 'Conexión exitosa (token auto-renovable)',
      details: {
        userId: user_id,
        nickname: userRes.data.nickname,
        email: userRes.data.email,
        country: userRes.data.country_id,
        totalItems: itemsRes.data.paging?.total || itemsRes.data.results?.length || 0,
        expiresAt: integration?.expires_at ? new Date(integration.expires_at).toLocaleString() : 'N/A'
      }
    });
  } catch (error: any) {
    console.error('Error testing ML connection:', error.response?.data || error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Error de conexión',
      details: error.response?.data?.message || error.message
    });
  }
};

export const debugMercadoLibreItem = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ error: 'No hay integración con ML o token inválido' });
    }
    
    const { access_token, user_id } = mlToken;
    
    // Obtener el primer item
    const searchRes = await axios.get(`https://api.mercadolibre.com/users/${user_id}/items/search?limit=1`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    
    const itemId = searchRes.data.results?.[0];
    if (!itemId) {
      return res.json({ message: 'No hay publicaciones' });
    }
    
    // Obtener detalles del item
    const itemRes = await axios.get(`https://api.mercadolibre.com/items/${itemId}?include_attributes=all`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    
    const item = itemRes.data;
    const firstVariation = item.variations?.[0];
    
    res.json({
      itemId: item.id,
      title: item.title,
      seller_custom_field: item.seller_custom_field,
      seller_sku: item.seller_sku,
      variation_count: item.variations?.length || 0,
      first_variation: firstVariation ? {
        id: firstVariation.id,
        seller_custom_field: firstVariation.seller_custom_field,
        seller_sku: firstVariation.seller_sku,
        attributes: firstVariation.attributes,
        attribute_combinations: firstVariation.attribute_combinations,
        all_keys: Object.keys(firstVariation)
      } : null,
      item_attributes: item.attributes?.filter((a: any) => 
        a.id?.includes('SKU') || a.id?.includes('GTIN') || a.id?.includes('CODE')
      )
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message, details: error.response?.data });
  }
};

export const syncProductsFromMercadoLibre = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No estás conectado a Mercado Libre o el token expiró' });
    }
    const { access_token, user_id } = mlToken;
    const logs: string[] = [];
    let linkedVariants = 0;
    let linkedProducts = 0;
    let notFound = 0;
    
    logs.push(`[ML] User ID: ${user_id}`);
    logs.push(`[ML] Token válido (auto-refrescado si necesario)`);
    
    let realUserId = user_id;
    
    // Obtener todos los items del usuario
    let searchRes;
    let allItems: string[] = [];
    let offset = 0;
    const limit = 50;
    
    try {
      // Paginar para obtener todos los items
      do {
        searchRes = await axios.get(`https://api.mercadolibre.com/users/${realUserId}/items/search?limit=${limit}&offset=${offset}`, {
          headers: { Authorization: `Bearer ${access_token}` }
        });
        const results = searchRes.data.results || [];
        allItems = allItems.concat(results);
        logs.push(`[ML] Página ${Math.floor(offset/limit) + 1}: ${results.length} items (total acumulado: ${allItems.length})`);
        offset += limit;
        
        // Continuar si hay más items (respetar total de la API y límite configurable)
        const total = searchRes.data.paging?.total || 0;
        if (offset >= total || results.length === 0) break;
        if (allItems.length >= ML_SYNC_MAX_ITEMS) break;
      } while (true);
      
    } catch (searchError: any) {
      logs.push(`[ML ERROR] Error buscando items: ${searchError.response?.data?.message || searchError.message}`);
      logs.push(`[ML ERROR] Status: ${searchError.response?.status}`);
      logs.push(`[ML ERROR] URL: https://api.mercadolibre.com/users/${realUserId}/items/search`);
      return res.json({ 
        message: 'Error obteniendo publicaciones de ML', 
        linkedVariants: 0, 
        linkedProducts: 0,
        notFound: 0,
        totalItems: 0,
        logs 
      });
    }
    
    const items: string[] = allItems;
    logs.push(`[ML] Total encontradas: ${items.length} publicaciones en Mercado Libre`);
    
    // Procesar items en lotes usando multiget para mayor velocidad
    const batchSize = 20;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      logs.push(`\n[ML] Procesando lote ${Math.floor(i/batchSize) + 1}/${Math.ceil(items.length/batchSize)} (${batch.length} items)`);
      
      try {
        // Usar multiget para obtener varios items a la vez
        const multigetRes = await axios.get(`https://api.mercadolibre.com/items?ids=${batch.join(',')}&include_attributes=all`, {
          headers: { Authorization: `Bearer ${access_token}` }
        });
        
        const itemsData = multigetRes.data || [];
        
        for (const itemWrapper of itemsData) {
          if (itemWrapper.code !== 200 || !itemWrapper.body) {
            logs.push(`  [Error] Item ${itemWrapper.id || 'desconocido'}: código ${itemWrapper.code}`);
            continue;
          }
          
          const mlItem = itemWrapper.body;
          const variations = mlItem.variations || [];
          const itemTitle = mlItem.title || mlItem.id;
          
          if (variations.length > 0) {
            // Item con variaciones
            let variantesVinculadas = 0;
            let variantesNoEncontradas = 0;
            
            // Extraer número de artículo del título (ej: "Art.5690" -> "5690")
            const artMatch = itemTitle.match(/Art\.?\s*(\d+)/i) || itemTitle.match(/Modelo?\s*(\d+)/i) || itemTitle.match(/(\d{3,})/);
            const artNumber = artMatch ? artMatch[1] : null;
            
            // Buscar producto por número de artículo en el nombre o SKU
            let productMatch: any = null;
            if (artNumber) {
              productMatch = await get(
                `SELECT id, sku, name FROM products WHERE sku LIKE ? OR name LIKE ? LIMIT 1`,
                [`%${artNumber}%`, `%${artNumber}%`]
              );
            }
            
            for (const v of variations) {
              // SKU en ML: atributo SELLER_SKU en variación (/items con include_attributes=all)
              const skuAttr = Array.isArray(v.attributes) && v.attributes.find((a: any) => (a.id || '').toString().toUpperCase() === 'SELLER_SKU');
              const mlSku = (skuAttr ? (skuAttr.value_name ?? skuAttr.value ?? '').toString().trim() : '')
                || (v.seller_sku ?? v.seller_custom_field ?? '').toString().trim();
              
              // Extraer color y talle de attribute_combinations
              const attrCombs = v.attribute_combinations || [];
              const mlColor = attrCombs.find((a: any) => a.id === 'COLOR')?.value_name || '';
              const mlSize = attrCombs.find((a: any) => a.id === 'SIZE')?.value_name || '';
              
              let row: any = null;
              
              // Método 1: Buscar por SKU si existe
              if (mlSku) {
                row = await get(
                  `SELECT pv.id AS variant_id, pc.product_id AS product_id 
                   FROM product_variants pv 
                   JOIN product_colors pc ON pv.product_color_id = pc.id 
                   WHERE pv.sku = ?`,
                  [mlSku]
                );
              }
              
              // Método 2: Buscar por producto + color + talle
              if (!row && productMatch?.id && (mlColor || mlSize)) {
                row = await get(
                  `SELECT pv.id AS variant_id, pc.product_id AS product_id 
                   FROM product_variants pv 
                   JOIN product_colors pc ON pv.product_color_id = pc.id 
                   JOIN colors c ON pc.color_id = c.id
                   JOIN sizes s ON pv.size_id = s.id
                   WHERE pc.product_id = ? 
                     AND (UPPER(c.name) LIKE ? OR UPPER(c.code) LIKE ?)
                     AND UPPER(s.size_code) = ?
                   LIMIT 1`,
                  [productMatch.id, `%${mlColor.toUpperCase()}%`, `%${mlColor.toUpperCase()}%`, mlSize.toUpperCase()]
                );
              }
              
              // Método 3: Buscar solo por producto + talle (si el color no matchea)
              if (!row && productMatch?.id && mlSize) {
                row = await get(
                  `SELECT pv.id AS variant_id, pc.product_id AS product_id 
                   FROM product_variants pv 
                   JOIN product_colors pc ON pv.product_color_id = pc.id 
                   JOIN sizes s ON pv.size_id = s.id
                   WHERE pc.product_id = ? AND UPPER(s.size_code) = ?
                   LIMIT 1`,
                  [productMatch.id, mlSize.toUpperCase()]
                );
              }
              
              if (row?.variant_id) {
                // No se guardan vínculos en la BD; solo se cuenta para el reporte
                linkedVariants++;
                variantesVinculadas++;
              } else {
                notFound++;
                variantesNoEncontradas++;
              }
            }
            
            // Log resumido por item
            if (variantesVinculadas > 0) {
              logs.push(`  [OK] ${itemTitle}: ${variantesVinculadas}/${variations.length} variantes vinculadas`);
            } else if (artNumber) {
              logs.push(`  [?] ${itemTitle}: Art.${artNumber} no encontrado en BD local`);
            } else {
              logs.push(`  [X] ${itemTitle}: No se pudo extraer número de artículo`);
            }
          } else {
            // Item sin variaciones
            const mlSku = mlItem.seller_custom_field || mlItem.seller_sku || '';
            
            // Extraer número de artículo del título
            const artMatch = itemTitle.match(/Art\.?\s*(\d+)/i) || itemTitle.match(/Modelo?\s*(\d+)/i) || itemTitle.match(/(\d{3,})/);
            const artNumber = artMatch ? artMatch[1] : null;
            
            let prod: any = null;
            
            // Buscar por SKU si existe
            if (mlSku) {
              prod = await get(`SELECT id FROM products WHERE sku = ?`, [mlSku]);
              if (!prod) {
                prod = await get(`SELECT id FROM products WHERE sku LIKE ?`, [`%${mlSku}%`]);
              }
            }
            
            // Si no hay SKU, buscar por número de artículo
            if (!prod && artNumber) {
              prod = await get(
                `SELECT id FROM products WHERE sku LIKE ? OR name LIKE ? LIMIT 1`,
                [`%${artNumber}%`, `%${artNumber}%`]
              );
            }
            
            if (prod?.id) {
              // No se guardan vínculos en la BD; solo se cuenta para el reporte
              linkedProducts++;
              logs.push(`  [OK] ${itemTitle} (no se guarda en BD)`);
            } else {
              notFound++;
              logs.push(`  [X] ${itemTitle} - no encontrado`);
            }
          }
        }
      } catch (e: any) {
        logs.push(`[ML Lote Error]: ${e?.response?.data?.message || e?.message || 'Error'}`);
      }
    }
    
    logs.push(`\n========== RESUMEN ==========`);
    logs.push(`Publicaciones ML procesadas: ${items.length}`);
    logs.push(`Coincidencias encontradas (variantes): ${linkedVariants}`);
    logs.push(`Coincidencias encontradas (productos sin variantes): ${linkedProducts}`);
    logs.push(`No encontrados/Sin SKU: ${notFound}`);
    logs.push(``);
    logs.push(`Los datos de Mercado Libre no se guardan en la base de datos. Usá la vista "Vista Mercado Libre" en Inventario para ver el stock.`);
    
    res.json({ 
      message: 'Consulta completada. Los productos de Mercado Libre no se guardan en la BD.', 
      linkedVariants, 
      linkedProducts,
      notFound,
      totalItems: items.length,
      logs 
    });
  } catch (error: any) {
    console.error('Error sincronizando ML:', error);
    res.status(500).json({ message: 'Error sincronizando Mercado Libre', error: error.message });
  }
};

// ==================== WEBHOOKS ====================

// Webhook de Tienda Nube para órdenes/ventas
export const handleTiendaNubeWebhook = async (req: Request, res: Response) => {
  try {
    const event = (req.body?.event ?? req.headers['x-linkedstore-topic'] ?? req.headers['x-tiendanube-topic'] ?? '').toString();
    const storeIdFromReq = (req.body?.store_id ?? req.headers['x-linkedstore-id'] ?? req.headers['x-tiendanube-store-id'] ?? '').toString();
    console.log(`[TN Webhook] Evento: ${event}, Store: ${storeIdFromReq || '-'}`);
    
    // Verificar store_id solo cuando viene en el webhook.
    // En algunos eventos/proveedores no llega este dato y antes se ignoraba todo por error.
    const integration = await get(`SELECT store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
    const storedStoreId = (integration?.store_id ?? integration?.user_id)?.toString();
    if (!integration) {
      console.log('[TN Webhook] No hay integración de Tienda Nube, ignorando');
      return res.status(200).json({ received: true, ignored: true });
    }
    if (storeIdFromReq && storedStoreId && storedStoreId !== storeIdFromReq) {
      console.log('[TN Webhook] Store ID no coincide (recibido:', storeIdFromReq, ', guardado:', storedStoreId, '), ignorando');
      return res.status(200).json({ received: true, ignored: true });
    }

    // Procesar solo cuando la orden se paga (descontar stock). Responder 200 enseguida: TN tiene timeout de 3s y reintentos si no hay 2XX.
    if (event === 'order/paid') {
      const orderId = req.body.id ?? req.body.order_id ?? req.body.order?.id ?? req.body.data?.id ?? req.body.data?.order_id;
      if (orderId) {
        processTiendaNubeOrder(String(orderId)).catch((err: any) =>
          console.error('[TN Order] Error procesando orden en background:', err?.message || err)
        );
      } else {
        console.warn('[TN Webhook] order/paid sin id de orden en body:', JSON.stringify(req.body));
      }
    }

    // Al cancelar una orden, restaurar el stock que se había descontado
    if (event === 'order/cancelled') {
      const orderId = req.body.id ?? req.body.order_id ?? req.body.order?.id ?? req.body.data?.id ?? req.body.data?.order_id;
      if (orderId) {
        processTiendaNubeOrderCancelled(String(orderId)).catch((err: any) =>
          console.error('[TN Order] Error restaurando stock por cancelación:', err?.message || err)
        );
      } else {
        console.warn('[TN Webhook] order/cancelled sin id de orden en body:', JSON.stringify(req.body));
      }
    }

    res.status(200).json({ received: true });
  } catch (error: any) {
    console.error('[TN Webhook] Error:', error.message);
    res.status(200).json({ received: true, error: error.message });
  }
};

// Procesar orden de Tienda Nube y descontar stock
const processTiendaNubeOrder = async (orderId: string) => {
  try {
    const integration = await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
    if (!integration?.access_token) return;

    const storeId = integration.store_id || integration.user_id;
    if (!storeId) {
      console.error('[TN Order] No hay store_id ni user_id en la integración');
      return;
    }

    // Idempotencia: no descontar dos veces la misma orden (p. ej. si TN reenvía el webhook)
    const alreadyProcessed = await get(
      `SELECT id FROM stock_movements WHERE movement_type = 'VENTA_TIENDA_NUBE' AND reference = ? LIMIT 1`,
      [`Orden TN: ${orderId}`]
    );
    if (alreadyProcessed) {
      console.log(`[TN Order] Orden ${orderId} ya procesada, omitiendo`);
      return;
    }

    const headers = {
      'Authentication': `bearer ${integration.access_token}`,
      'User-Agent': TN_USER_AGENT
    };

    let orderRes = await axios.get(
      `https://api.tiendanube.com/v1/${storeId}/orders/${orderId}`,
      { headers, validateStatus: () => true }
    );

    // Si 404, puede que el webhook haya enviado el "number" (ej. 1909) en vez del "id" interno; buscar por q
    if (orderRes.status === 404) {
      const searchRes = await axios.get(
        `https://api.tiendanube.com/v1/${storeId}/orders`,
        { params: { q: orderId, per_page: 1 }, headers, validateStatus: () => true }
      );
      if (searchRes.status === 200 && Array.isArray(searchRes.data) && searchRes.data.length > 0) {
        const foundId = searchRes.data[0].id;
        console.log(`[TN Order] Orden encontrada por número: ${orderId} -> id ${foundId}`);
        orderRes = await axios.get(
          `https://api.tiendanube.com/v1/${storeId}/orders/${foundId}`,
          { headers }
        );
      }
    }

    if (orderRes.status !== 200) {
      const errBody = orderRes.data && typeof orderRes.data === 'object' ? JSON.stringify(orderRes.data) : orderRes.data;
      console.error(`[TN Order] Error al obtener orden ${orderId}: HTTP ${orderRes.status}. Si es 403, reconectá Tienda Nube (falta scope read_orders). Respuesta:`, errBody);
      return;
    }

    const order = orderRes.data;
    const productCount = Array.isArray(order.products) ? order.products.length : 0;
    console.log(`[TN Order] Procesando orden ${orderId}, payment_status: ${order.payment_status}, productos: ${productCount}`);

    // Solo descontar cuando la venta está pagada
    if (order.payment_status !== 'paid') {
      console.log(`[TN Order] Orden ${orderId} no está pagada (${order.payment_status}), ignorando`);
      return;
    }

    const { deductVariantStockForChannelSale } = await import('./stock.controller');

    let discountedCount = 0;
    for (const item of order.products || []) {
      const tnVariantIdRaw = item.variant_id ?? item.variantId;
      const tnVariantId = tnVariantIdRaw != null ? String(tnVariantIdRaw) : null;
      const tnProductId = item.product_id != null ? String(item.product_id) : '';
      const quantity = Math.max(0, parseInt(String(item.quantity ?? 0), 10) || 0);
      const itemSku = (item.sku || item.variant_sku || '').toString().trim();

      if (quantity === 0) continue;

      if (tnProductId || tnVariantId) {
        const { findBundleByListing, deductStockForBundleListing } = await import(
          '../services/publicationStockBundle.service'
        );
        const bundle = await findBundleByListing(
          'tiendanube',
          tnProductId || tnVariantId || '',
          tnVariantId || ''
        );
        if (bundle?.items?.length) {
          const { ok, blocked, lines } = await deductStockForBundleListing(
            bundle,
            quantity,
            'VENTA_TIENDA_NUBE',
            `Orden TN: ${orderId}`
          );
          if (blocked) {
            console.warn(
              `[TN Order] Pack multicolor BLOQUEADO (stock insuficiente) "${bundle.label || bundle.externalProductId}": ${lines.join('; ')}`
            );
          } else if (ok) {
            discountedCount++;
            console.log(
              `[TN Order] Pack multicolor "${bundle.label || bundle.externalProductId}": ${lines.join('; ')}`
            );
          }
          continue;
        }
      }

      let variant: { id: string; current_stock: number; tn_pack?: number } | null = null;
      if (tnVariantId) {
        const fromPub = await get(
          `SELECT vp.variant_id AS id, COALESCE(vp.pack_size, 1) AS tn_pack FROM variant_publications vp WHERE vp.platform = 'tiendanube' AND vp.external_variant_id = ? LIMIT 1`,
          [tnVariantId]
        );
        if (fromPub?.id) {
          const row = await get(`SELECT stock AS current_stock FROM stocks WHERE variant_id = ?`, [fromPub.id]);
          variant = { id: fromPub.id, current_stock: Number(row?.current_stock ?? 0), tn_pack: Math.max(1, Number(fromPub.tn_pack) || 1) };
        }
      }
      if (!variant?.id && tnVariantId) {
        variant = await get(
          `SELECT pv.id, s.stock AS current_stock, COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack
           FROM product_variants pv
           JOIN product_colors pc ON pc.id = pv.product_color_id
           JOIN products p ON p.id = pc.product_id
           LEFT JOIN stocks s ON s.variant_id = pv.id
           WHERE pv.tienda_nube_variant_id = ?`,
          [tnVariantId]
        );
      }
      if (!variant?.id && itemSku) {
        variant = await get(
          `SELECT pv.id, s.stock AS current_stock, COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack
           FROM product_variants pv
           JOIN product_colors pc ON pc.id = pv.product_color_id
           JOIN products p ON p.id = pc.product_id
           LEFT JOIN stocks s ON s.variant_id = pv.id
           WHERE COALESCE(pv.external_sku, pv.sku) = ? OR pv.sku = ?`,
          [itemSku, itemSku]
        );
      }
      if (!variant?.id && itemSku) {
        variant = await get(
          `SELECT pv.id, s.stock AS current_stock, COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack
           FROM product_variants pv
           LEFT JOIN stocks s ON s.variant_id = pv.id
           JOIN product_colors pc ON pc.id = pv.product_color_id
           JOIN products p ON p.id = pc.product_id
           WHERE p.sku = ? OR pv.sku LIKE ? OR pv.external_sku = ?`,
          [itemSku, `${itemSku}%`, itemSku]
        );
      }
      if (!variant?.id && itemSku) {
        const skuNorm = normalizeSkuForMatch(itemSku);
        const skuNormNoZero = skuNorm.replace(/^0+/, '');
        if (skuNorm) {
          variant = await get(
            `SELECT pv.id, s.stock AS current_stock, COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack
             FROM product_variants pv
             LEFT JOIN stocks s ON s.variant_id = pv.id
             JOIN product_colors pc ON pc.id = pv.product_color_id
             JOIN products p ON p.id = pc.product_id
             WHERE (
               REPLACE(REPLACE(REPLACE(UPPER(TRIM(COALESCE(pv.external_sku, pv.sku))), '-', ''), '/', ''), ' ', '') = ?
               OR TRIM(LEADING '0' FROM REPLACE(REPLACE(REPLACE(UPPER(TRIM(COALESCE(pv.external_sku, pv.sku))), '-', ''), '/', ''), ' ', '')) = ?
               OR REPLACE(REPLACE(REPLACE(UPPER(TRIM(p.sku)), '-', ''), '/', ''), ' ', '') = ?
               OR TRIM(LEADING '0' FROM REPLACE(REPLACE(REPLACE(UPPER(TRIM(p.sku)), '-', ''), '/', ''), ' ', '')) = ?
             )
             LIMIT 1`,
            [skuNorm, skuNormNoZero, skuNorm, skuNormNoZero]
          );
        }
      }

      if (variant?.id) {
        const tnPack = Math.max(1, Number(variant.tn_pack) || 1);
        const unitsToDeduct = quantity * tnPack;
        const result = await deductVariantStockForChannelSale(
          variant.id,
          unitsToDeduct,
          'VENTA_TIENDA_NUBE',
          `Orden TN: ${orderId}`,
          true
        );
        if (result.blocked) {
          console.warn(
            `[TN Order] BLOQUEADO: stock insuficiente variante ${variant.id} (tiene ${result.previousStock}, pide ${result.unitsToDeduct}) orden ${orderId}`
          );
        } else if (result.ok) {
          discountedCount++;
          console.log(
            `[TN Order] Descontado ${result.unitsToDeduct} un. (${quantity} × pack x${tnPack}) variante ${variant.id}, stock: ${result.previousStock} -> ${result.newStock}; actualizado ML y TN`
          );
        } else {
          console.error(`[TN Order] No se pudo actualizar stock para variante ${variant.id}`);
        }
      } else {
        console.warn(`[TN Order] Variante no encontrada: variant_id=${tnVariantId} sku=${itemSku}. Vinculá la variante en Inventario (IDs de Tienda Nube) para que el stock se descuente.`);
      }
    }
    if (discountedCount === 0 && productCount > 0) {
      console.warn(`[TN Order] Orden ${orderId}: no se descontó stock de ningún ítem (variantes no vinculadas o no encontradas).`);
    } else if (discountedCount > 0) {
      console.log(`[TN Order] Orden ${orderId}: descontado stock de ${discountedCount} ítem(s).`);
    }
  } catch (error: any) {
    console.error('[TN Order] Error procesando orden:', error.message);
  }
};

/** Restaurar stock cuando se cancela una orden de Tienda Nube (revierte los movimientos VENTA_TIENDA_NUBE de esa orden). */
const processTiendaNubeOrderCancelled = async (orderId: string) => {
  try {
    const ref = `Orden TN: ${orderId}`;
    const cancelRef = `Cancelación orden TN: ${orderId}`;

    const alreadyRestored = await get(
      `SELECT id FROM stock_movements WHERE movement_type = 'CANCEL_VENTA_TIENDA_NUBE' AND reference = ? LIMIT 1`,
      [cancelRef]
    );
    if (alreadyRestored) {
      console.log(`[TN Order] Cancelación orden ${orderId} ya procesada, omitiendo`);
      return;
    }

    const movements = await query(
      `SELECT variant_id, quantity_change FROM stock_movements
       WHERE movement_type = 'VENTA_TIENDA_NUBE' AND reference = ?
       ORDER BY created_at`,
      [ref]
    );
    if (!movements?.length) {
      console.log(`[TN Order] No hay movimientos de venta para orden ${orderId} (no se había descontado o orden distinta)`);
      return;
    }

    const { updateVariantStock } = await import('./stock.controller');
    let restoredCount = 0;
    for (const m of movements) {
      const amountToRestore = Math.abs(Number(m.quantity_change) || 0);
      if (amountToRestore <= 0) continue;

      const row = await get(`SELECT stock FROM stocks WHERE variant_id = ?`, [m.variant_id]);
      const currentStock = Number(row?.stock ?? 0);
      const newStock = currentStock + amountToRestore;

      const ok = await updateVariantStock(
        m.variant_id,
        newStock,
        'CANCEL_VENTA_TIENDA_NUBE',
        cancelRef,
        true
      );
      if (ok) {
        restoredCount++;
        console.log(`[TN Order] Restaurado ${amountToRestore} para variante ${m.variant_id}, stock: ${currentStock} -> ${newStock}`);
      }
    }
    if (restoredCount > 0) {
      console.log(`[TN Order] Orden ${orderId} cancelada: restaurado stock de ${restoredCount} ítem(s).`);
    }
  } catch (error: any) {
    console.error('[TN Order] Error restaurando stock por cancelación:', error.message);
  }
};

/** Prueba manual: procesar una orden de Tienda Nube por ID (mismo flujo que el webhook). Útil para verificar que el stock se descuenta. */
export const testTiendaNubeOrder = async (req: Request, res: Response) => {
  try {
    const orderId = (req.body?.orderId ?? req.query?.orderId ?? '').toString().trim();
    if (!orderId) {
      return res.status(400).json({
        message: 'Falta orderId. Ejemplo: POST con body { "orderId": "12345" } o GET ?orderId=12345',
        hint: 'El ID es el de la orden en Tienda Nube (no el número de orden). Lo ves en la URL al abrir la orden en el panel de TN.',
      });
    }
    await processTiendaNubeOrder(orderId);
    res.json({
      message: 'Procesamiento finalizado. Revisá los logs del backend y el Historial de stock para ver si se descontó.',
      orderId,
    });
  } catch (error: any) {
    console.error('[TN Test Order]', error?.message);
    res.status(500).json({ message: error?.message || 'Error al procesar orden de prueba' });
  }
};

/** Descontar stock de todas las ventas pagadas de Tienda Nube desde una fecha (ej. para sincronizar ventas que no se descontaron). Idempotente: órdenes ya procesadas se omiten. */
export const syncTiendaNubeOrdersFromDate = async (req: Request, res: Response) => {
  try {
    const fromParam = (req.body?.fromDate ?? req.query?.fromDate ?? '2026-03-09').toString().trim();
    const fromDate = fromParam.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
      return res.status(400).json({ message: 'fromDate debe ser YYYY-MM-DD (ej. 2026-03-09)' });
    }

    const integration = await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
    if (!integration?.access_token) {
      return res.status(400).json({ message: 'No estás conectado a Tienda Nube' });
    }
    const storeId = integration.store_id || integration.user_id;
    if (!storeId) {
      return res.status(400).json({ message: 'Falta store_id en la integración de Tienda Nube' });
    }

    const headers = {
      'Authentication': `bearer ${integration.access_token}`,
      'User-Agent': TN_USER_AGENT
    };

    let totalOrders = 0;
    let page = 1;
    const perPage = 50;
    let hasMore = true;

    while (hasMore && page <= 20) {
      const listRes = await axios.get(
        `https://api.tiendanube.com/v1/${storeId}/orders`,
        {
          params: {
            page,
            per_page: perPage,
            payment_status: 'paid',
            created_at_min: `${fromDate}T00:00:00`
          },
          headers,
          validateStatus: () => true
        }
      );

      if (listRes.status !== 200) {
        const errMsg = listRes.data?.message || listRes.data?.error || JSON.stringify(listRes.data);
        return res.status(listRes.status === 403 ? 403 : 500).json({
          message: `Error al listar órdenes de Tienda Nube: ${errMsg}`,
          hint: listRes.status === 403 ? 'Reconectá Tienda Nube (scope read_orders).' : undefined
        });
      }

      const orders = Array.isArray(listRes.data) ? listRes.data : [];
      for (const order of orders) {
        const orderId = order.id != null ? String(order.id) : '';
        if (orderId) {
          await processTiendaNubeOrder(orderId);
          totalOrders++;
        }
      }

      if (orders.length < perPage) hasMore = false;
      else page++;
    }

    res.json({
      message: `Se procesaron las órdenes pagadas de Tienda Nube desde el ${fromDate}. Las que ya tenían stock descontado se omitieron.`,
      fromDate,
      totalOrders,
    });
  } catch (error: any) {
    console.error('[TN Sync From Date]', error?.message);
    res.status(500).json({ message: error?.message || 'Error al sincronizar órdenes desde fecha' });
  }
};

/** Descontar stock de todas las ventas pagadas de Mercado Libre desde una fecha.
 * Idempotente: órdenes ya procesadas se omiten por movimiento VENTA_MERCADO_LIBRE.
 */
export const syncMercadoLibreOrdersFromDate = async (req: Request, res: Response) => {
  try {
    const fromParam = (req.body?.fromDate ?? req.query?.fromDate ?? '2026-03-09').toString().trim();
    const fromDate = fromParam.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
      return res.status(400).json({ message: 'fromDate debe ser YYYY-MM-DD (ej. 2026-03-09)' });
    }

    const mlToken = await getValidMLToken();
    if (!mlToken?.access_token || !mlToken?.user_id) {
      return res.status(400).json({ message: 'No estás conectado a Mercado Libre' });
    }

    let totalOrders = 0;
    let offset = 0;
    const limit = 50;
    let keepGoing = true;

    while (keepGoing && offset < 5000) {
      const searchRes = await axios.get(
        `https://api.mercadolibre.com/orders/search?seller=${mlToken.user_id}&order.status=paid&order.date_created.from=${fromDate}T00:00:00.000-03:00&offset=${offset}&limit=${limit}&sort=date_desc`,
        { headers: { 'Authorization': `Bearer ${mlToken.access_token}` }, validateStatus: () => true }
      );

      if (searchRes.status !== 200) {
        const errMsg =
          searchRes.data?.message ||
          searchRes.data?.error ||
          JSON.stringify(searchRes.data);
        return res.status(searchRes.status === 403 ? 403 : 500).json({
          message: `Error al listar órdenes de Mercado Libre: ${errMsg}`,
          hint: searchRes.status === 403 ? 'Reconectá Mercado Libre.' : undefined
        });
      }

      const results = Array.isArray(searchRes.data?.results) ? searchRes.data.results : [];
      for (const row of results) {
        const orderId = row?.id != null ? String(row.id) : '';
        if (!orderId) continue;
        await processMercadoLibreOrder(orderId);
        totalOrders++;
      }

      if (results.length < limit) keepGoing = false;
      else offset += limit;
    }

    res.json({
      message: `Se procesaron las órdenes pagadas de Mercado Libre desde el ${fromDate}. Las que ya tenían stock descontado se omitieron.`,
      fromDate,
      totalOrders,
    });
  } catch (error: any) {
    console.error('[ML Sync From Date]', error?.message);
    res.status(500).json({ message: error?.message || 'Error al sincronizar órdenes de Mercado Libre desde fecha' });
  }
};

/** Prueba manual: procesar una orden de Mercado Libre por ID (mismo flujo que el webhook). */
export const testMercadoLibreOrder = async (req: Request, res: Response) => {
  try {
    const orderId = (req.body?.orderId ?? req.query?.orderId ?? '').toString().trim();
    if (!orderId) {
      return res.status(400).json({
        message: 'Falta orderId. Ejemplo: POST con body { "orderId": "2000015720058034" } o GET ?orderId=2000015720058034'
      });
    }

    const refPrefix = `Orden ML: ${orderId}%`;
    const before = await get(
      `SELECT COUNT(*) AS n FROM stock_movements WHERE movement_type = 'VENTA_MERCADO_LIBRE' AND reference LIKE ?`,
      [refPrefix]
    );

    await processMercadoLibreOrder(orderId);

    const after = await get(
      `SELECT COUNT(*) AS n FROM stock_movements WHERE movement_type = 'VENTA_MERCADO_LIBRE' AND reference LIKE ?`,
      [refPrefix]
    );

    const beforeN = Number((before as any)?.n ?? 0);
    const afterN = Number((after as any)?.n ?? 0);
    const created = Math.max(0, afterN - beforeN);

    return res.json({
      orderId,
      movementReferencePattern: refPrefix,
      movementsBefore: beforeN,
      movementsAfter: afterN,
      createdMovements: created,
      message: created > 0
        ? `OK: se crearon ${created} movimiento(s) VENTA_MERCADO_LIBRE.`
        : 'No se crearon movimientos nuevos. Revisá vínculos de la variante (item_id/variation_id/SKU) y logs de backend para este orderId.'
    });
  } catch (error: any) {
    console.error('[ML Test Order]', error?.message);
    res.status(500).json({ message: error?.message || 'Error al procesar orden de prueba de Mercado Libre' });
  }
};

// Webhook de Mercado Libre para órdenes/ventas
export const handleMercadoLibreWebhook = async (req: Request, res: Response) => {
  try {
    const topic = (req.body?.topic ?? req.query?.topic ?? '').toString();
    const resourceRaw = (req.body?.resource ?? req.query?.resource ?? '').toString();
    const userIdRaw = (req.body?.user_id ?? req.query?.user_id ?? '').toString();
    console.log(`[ML Webhook] Topic: ${topic}, Resource: ${resourceRaw}, User: ${userIdRaw || '-'}`);

    // Verificar user_id solo cuando viene en el webhook.
    // Mercado Libre a veces no lo envía y eso hacía que nunca se procese la orden.
    const integration = await get(`SELECT user_id FROM integrations WHERE platform = 'mercadolibre'`);
    const storedUserId = integration?.user_id?.toString();
    if (!integration) {
      console.log('[ML Webhook] No hay integración de Mercado Libre, ignorando');
      return res.status(200).json({ received: true, ignored: true });
    }
    if (userIdRaw && storedUserId && storedUserId !== userIdRaw) {
      console.log('[ML Webhook] User ID no coincide, ignorando');
      return res.status(200).json({ received: true, ignored: true });
    }

    // Procesar según el tipo de notificación
    if (topic === 'orders_v2' || topic === 'orders') {
      const orderId = (() => {
        if (!resourceRaw) return '';
        const m = resourceRaw.match(/\/orders\/(\d+)/);
        if (m?.[1]) return m[1];
        const parts = resourceRaw.split('/').filter(Boolean);
        return parts.length > 0 ? parts[parts.length - 1] : '';
      })();
      if (orderId) {
        await processMercadoLibreOrder(orderId);
      } else {
        console.warn('[ML Webhook] No se pudo extraer orderId desde resource:', resourceRaw);
      }
    }

    /** Preguntas: IA según modo (sugerencia o auto-respuesta). */
    if (topic === 'questions') {
      const qm = resourceRaw.match(/questions\/(\d+)/);
      const questionId = qm?.[1];
      if (questionId) {
        setImmediate(() => {
          (async () => {
            try {
              const cfg = await mlQuestionsAi.getMlQuestionsAiConfigRow();
              if (cfg.mode === 'off' || !mlQuestionsAi.openAiConfigured()) return;
              const t = await getValidMLToken();
              if (!t) return;
              const r = await mlQuestionsAi.processOneQuestion(t.access_token, questionId, {
                extraSystemPrompt: cfg.extraSystemPrompt,
                mode: cfg.mode
              });
              console.log(`[ML Questions AI] Pregunta ${questionId}: ${r.status}`);
            } catch (e: any) {
              console.error('[ML Questions AI] Error:', e?.response?.data || e?.message || e);
            }
          })();
        });
      }
    }

    res.status(200).json({ received: true });
  } catch (error: any) {
    console.error('[ML Webhook] Error:', error.message);
    res.status(200).json({ received: true, error: error.message });
  }
};

// Procesar orden de Mercado Libre y descontar stock
const processMercadoLibreOrder = async (orderId: string) => {
  // Lock efímero para evitar doble procesamiento concurrente del mismo orderId (MySQL en prod).
  await execute(
    `CREATE TABLE IF NOT EXISTS integration_order_locks (
      platform VARCHAR(64) NOT NULL,
      external_order_id VARCHAR(191) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (platform, external_order_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  const lockPlatform = 'mercadolibre';
  let lockAcquired = false;
  try {
    try {
      await execute(
        `INSERT INTO integration_order_locks (platform, external_order_id) VALUES (?, ?)`,
        [lockPlatform, orderId]
      );
      lockAcquired = true;
    } catch (e: any) {
      const msg = String(e?.message || '');
      const dup =
        msg.includes('UNIQUE constraint failed') ||
        msg.includes('SQLITE_CONSTRAINT') ||
        e?.code === 'ER_DUP_ENTRY' ||
        msg.includes('Duplicate entry');
      if (dup) {
        console.log(`[ML Order] Orden ${orderId} en procesamiento concurrente, omitiendo`);
        return;
      }
      throw e;
    }

    const mlToken = await getValidMLToken();
    if (!mlToken) return;

    const orderRes = await axios.get(
      `https://api.mercadolibre.com/orders/${orderId}`,
      {
        headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
      }
    );

    const order = orderRes.data;
    console.log(`[ML Order] Procesando orden ${orderId}, estado: ${order.status}`);

    // Solo procesar órdenes pagadas
    if (order.status !== 'paid') {
      console.log(`[ML Order] Orden ${orderId} no está pagada, ignorando`);
      return;
    }

    // Enviar mensaje de agradecimiento al comprador
    await sendThankYouMessage(orderId, order, mlToken.access_token);

    const { deductVariantStockForChannelSale } = await import('./stock.controller');

    for (const [itemIndex, item] of (order.order_items || []).entries()) {
      const mlItemId = item.item?.id;
      const mlVariationId = item.item?.variation_id;
      const quantity = item.quantity;
      const lineRef = mlOrderLineReference(orderId, mlItemId, mlVariationId, itemIndex);
      let itemSku = (item.item?.sku || item.sku || '').toString().trim();
      if (!itemSku) {
        itemSku = await resolveMlOrderItemSku(mlToken.access_token, mlItemId, mlVariationId);
      }

      if (mlItemId) {
        const { findBundleByListing, deductStockForBundleListing } = await import(
          '../services/publicationStockBundle.service'
        );
        const extVar = (mlVariationId && String(mlVariationId).trim()) || '';
        const bundle = await findBundleByListing('mercadolibre', mlItemId, extVar);
        if (bundle?.items?.length) {
          if (await isMlOrderLineAlreadyProcessed(orderId, lineRef)) {
            console.log(`[ML Order] Línea ${itemIndex + 1} de orden ${orderId} ya procesada (pack), omitiendo`);
            continue;
          }
          const { ok, blocked, lines } = await deductStockForBundleListing(
            bundle,
            quantity,
            'VENTA_MERCADO_LIBRE',
            lineRef
          );
          if (blocked) {
            console.warn(
              `[ML Order] Pack multicolor BLOQUEADO (stock insuficiente) "${bundle.label || bundle.externalProductId}": ${lines.join('; ')}`
            );
          } else if (ok) {
            console.log(
              `[ML Order] Pack multicolor "${bundle.label || bundle.externalProductId}": ${lines.join('; ')}`
            );
          }
          continue;
        }
      }

      let variant: { id: string; current_stock: number; ml_pack?: number } | null = null;
      if (mlItemId) {
        const extVariantId = (mlVariationId && String(mlVariationId).trim()) || '';
        const fromPub = await get(
          `SELECT vp.variant_id AS id, COALESCE(vp.pack_size, 1) AS ml_pack FROM variant_publications vp WHERE vp.platform = 'mercadolibre' AND vp.external_product_id = ? AND vp.external_variant_id = ? LIMIT 1`,
          [mlItemId, extVariantId]
        );
        if (fromPub?.id) {
          const row = await get(`SELECT stock AS current_stock FROM stocks WHERE variant_id = ?`, [fromPub.id]);
          variant = { id: fromPub.id, current_stock: Number(row?.current_stock ?? 0), ml_pack: Math.max(1, Number(fromPub.ml_pack) || 1) };
        }
      }
      // Priorizar variation_id antes que item_id suelto (publicación con variaciones).
      if (!variant?.id && mlVariationId) {
        variant = await get(
          `SELECT pv.id, s.stock AS current_stock, COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack
           FROM product_variants pv
           JOIN product_colors pc ON pc.id = pv.product_color_id
           JOIN products p ON p.id = pc.product_id
           LEFT JOIN stocks s ON s.variant_id = pv.id
           WHERE pv.mercado_libre_variant_id = ?`,
          [mlVariationId]
        );
      }
      // Fallback legacy: publicación propia por variante (sin variation_id en ML).
      if (!variant?.id && mlItemId && !mlVariationId) {
        variant = await get(
          `SELECT pv.id, s.stock AS current_stock, COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack
           FROM product_variants pv
           JOIN product_colors pc ON pc.id = pv.product_color_id
           JOIN products p ON p.id = pc.product_id
           LEFT JOIN stocks s ON s.variant_id = pv.id
           WHERE pv.mercado_libre_item_id = ?
           LIMIT 1`,
          [mlItemId]
        );
      }
      // Fallback por producto padre ML: cuando el vínculo está en products.mercado_libre_id
      // y la venta viene sin variation_id.
      if (!variant?.id && mlItemId) {
        if (itemSku) {
          const skuNorm = normalizeSkuForMatch(itemSku);
          const skuNormNoZero = skuNorm.replace(/^0+/, '');
          variant = await get(
            `SELECT pv.id, s.stock AS current_stock, COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack
             FROM products p
             JOIN product_colors pc ON pc.product_id = p.id
             JOIN product_variants pv ON pv.product_color_id = pc.id
             LEFT JOIN stocks s ON s.variant_id = pv.id
             WHERE p.mercado_libre_id = ?
               AND (
                 REPLACE(REPLACE(REPLACE(UPPER(TRIM(COALESCE(pv.external_sku, pv.sku))), '-', ''), '/', ''), ' ', '') = ?
                 OR TRIM(LEADING '0' FROM REPLACE(REPLACE(REPLACE(UPPER(TRIM(COALESCE(pv.external_sku, pv.sku))), '-', ''), '/', ''), ' ', '')) = ?
               )
             LIMIT 1`,
            [mlItemId, skuNorm, skuNormNoZero]
          );
        }
        // Si sigue sin match y el artículo local tiene una sola variante, usarla
        if (!variant?.id) {
          variant = await get(
            `SELECT pv.id, s.stock AS current_stock, COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack
             FROM products p
             JOIN product_colors pc ON pc.product_id = p.id
             JOIN product_variants pv ON pv.product_color_id = pc.id
             LEFT JOIN stocks s ON s.variant_id = pv.id
             WHERE p.mercado_libre_id = ?
             GROUP BY pv.id, s.stock, p.mercado_libre_pack_size
             ORDER BY pv.id
             LIMIT 1`,
            [mlItemId]
          );
          const countRow = await get(
            `SELECT COUNT(*) AS n
             FROM products p
             JOIN product_colors pc ON pc.product_id = p.id
             JOIN product_variants pv ON pv.product_color_id = pc.id
             WHERE p.mercado_libre_id = ?`,
            [mlItemId]
          );
          if (Number(countRow?.n || 0) !== 1) {
            variant = null;
          }
        }
      }
      if (!variant?.id && itemSku) {
        variant = await get(
          `SELECT pv.id, s.stock AS current_stock, COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack
           FROM product_variants pv
           JOIN product_colors pc ON pc.id = pv.product_color_id
           JOIN products p ON p.id = pc.product_id
           LEFT JOIN stocks s ON s.variant_id = pv.id
           WHERE COALESCE(pv.external_sku, pv.sku) = ? OR pv.sku = ?`,
          [itemSku, itemSku]
        );
      }
      if (!variant?.id && itemSku) {
        variant = await get(
          `SELECT pv.id, s.stock AS current_stock, COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack
           FROM product_variants pv
           LEFT JOIN stocks s ON s.variant_id = pv.id
           JOIN product_colors pc ON pc.id = pv.product_color_id
           JOIN products p ON p.id = pc.product_id
           WHERE p.sku = ? OR pv.sku LIKE ? OR pv.external_sku = ?`,
          [itemSku, `${itemSku}%`, itemSku]
        );
      }
      if (!variant?.id && itemSku) {
        const skuNorm = normalizeSkuForMatch(itemSku);
        const skuNormNoZero = skuNorm.replace(/^0+/, '');
        if (skuNorm) {
          variant = await get(
            `SELECT pv.id, s.stock AS current_stock, COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack
             FROM product_variants pv
             LEFT JOIN stocks s ON s.variant_id = pv.id
             JOIN product_colors pc ON pc.id = pv.product_color_id
             JOIN products p ON p.id = pc.product_id
             WHERE (
               REPLACE(REPLACE(REPLACE(UPPER(TRIM(COALESCE(pv.external_sku, pv.sku))), '-', ''), '/', ''), ' ', '') = ?
               OR TRIM(LEADING '0' FROM REPLACE(REPLACE(REPLACE(UPPER(TRIM(COALESCE(pv.external_sku, pv.sku))), '-', ''), '/', ''), ' ', '')) = ?
               OR REPLACE(REPLACE(REPLACE(UPPER(TRIM(p.sku)), '-', ''), '/', ''), ' ', '') = ?
               OR TRIM(LEADING '0' FROM REPLACE(REPLACE(REPLACE(UPPER(TRIM(p.sku)), '-', ''), '/', ''), ' ', '')) = ?
             )
             LIMIT 1`,
            [skuNorm, skuNormNoZero, skuNorm, skuNormNoZero]
          );
        }
      }

      if (variant?.id) {
        if (await isMlOrderLineAlreadyProcessed(orderId, lineRef, variant.id)) {
          console.log(`[ML Order] Línea ${itemIndex + 1} de orden ${orderId} ya procesada, omitiendo variante ${variant.id}`);
          continue;
        }
        const mlPack = Math.max(1, Number(variant.ml_pack) || 1);
        const unitsToDeduct = quantity * mlPack;
        const result = await deductVariantStockForChannelSale(
          variant.id,
          unitsToDeduct,
          'VENTA_MERCADO_LIBRE',
          lineRef,
          true
        );
        if (result.blocked) {
          console.warn(
            `[ML Order] BLOQUEADO: stock insuficiente variante ${variant.id} (tiene ${result.previousStock}, pide ${result.unitsToDeduct}) orden ${orderId}`
          );
        } else if (result.ok) {
          console.log(
            `[ML Order] Descontado ${result.unitsToDeduct} un. (${quantity} × pack x${mlPack}) variante ${variant.id}, stock: ${result.previousStock} -> ${result.newStock}; actualizado ML y TN`
          );
        } else {
          console.error(`[ML Order] No se pudo actualizar stock para variante ${variant.id} orden ${orderId}`);
        }
      } else if (mlVariationId || itemSku) {
        console.log(`[ML Order] Variante no encontrada para ML item_id=${mlItemId} variation_id=${mlVariationId} sku=${itemSku}`);
      }
    }
  } catch (error: any) {
    console.error('[ML Order] Error procesando orden:', error.message);
  } finally {
    if (lockAcquired) {
      try {
        await execute(
          `DELETE FROM integration_order_locks WHERE platform = ? AND external_order_id = ?`,
          [lockPlatform, orderId]
        );
      } catch {
        // No romper flujo por falla al limpiar lock efimero.
      }
    }
  }
};

// Enviar mensaje de agradecimiento al comprador de ML
const sendThankYouMessage = async (orderId: string, order: any, accessToken: string) => {
  try {
    // Verificar si el mensaje automático está habilitado
    const config = await get(`SELECT enabled, message_template FROM ml_auto_message_config WHERE id = 1`);
    if (config && !config.enabled) {
      console.log(`[ML Message] Mensaje automático deshabilitado, omitiendo orden ${orderId}`);
      return;
    }

    const buyerId = order.buyer?.id;
    if (!buyerId) {
      console.log(`[ML Message] No se encontró buyer_id para orden ${orderId}`);
      return;
    }

    // Verificar si ya enviamos mensaje para esta orden (evitar duplicados)
    const alreadySent = await get(
      `SELECT id FROM ml_messages_sent WHERE order_id = ?`,
      [orderId]
    );

    if (alreadySent) {
      console.log(`[ML Message] Ya se envió mensaje para orden ${orderId}, omitiendo`);
      return;
    }

    // Obtener el nombre del comprador
    const buyerName = order.buyer?.first_name || order.buyer?.nickname || 'Cliente';
    
    // Obtener los productos comprados para personalizar el mensaje
    const productNames = (order.order_items || [])
      .map((item: any) => item.item?.title)
      .filter(Boolean)
      .slice(0, 2) // Máximo 2 productos en el mensaje
      .join(' y ');

    // Usar plantilla personalizada o mensaje por defecto
    let message: string;
    if (config?.message_template) {
      message = config.message_template
        .replace('{nombre}', buyerName)
        .replace('{productos}', productNames ? ` de ${productNames}` : '');
    } else {
      message = `¡Hola ${buyerName}! 🙌

Muchas gracias por tu compra${productNames ? ` de ${productNames}` : ''}. 

Tu pedido ya está siendo preparado con mucho cuidado. Te avisaremos apenas lo despachemos.

Si tenés alguna consulta, no dudes en escribirnos. ¡Gracias por confiar en nosotros!

Saludos,
Equipo Lupo`;
    }

    // Enviar mensaje usando la API de mensajes de ML
    // La API de mensajes usa el pack_id (si existe) o el order_id
    const packId = order.pack_id || orderId;
    
    await axios.post(
      `https://api.mercadolibre.com/messages/packs/${packId}/sellers/${order.seller?.id || (await getValidMLToken())?.user_id}`,
      {
        from: {
          user_id: order.seller?.id
        },
        to: {
          user_id: buyerId
        },
        text: message
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Registrar que ya enviamos el mensaje
    await execute(
      `INSERT INTO ml_messages_sent (order_id, buyer_id, sent_at) VALUES (?, ?, NOW())`,
      [orderId, buyerId]
    );

    console.log(`[ML Message] ✓ Mensaje de agradecimiento enviado para orden ${orderId} a ${buyerName}`);
  } catch (error: any) {
    // Si la tabla no existe, crearla
    if (error.message?.includes('ml_messages_sent') || error.code === 'ER_NO_SUCH_TABLE') {
      try {
        await execute(`
          CREATE TABLE IF NOT EXISTS ml_messages_sent (
            id INT AUTO_INCREMENT PRIMARY KEY,
            order_id VARCHAR(50) NOT NULL UNIQUE,
            buyer_id VARCHAR(50),
            sent_at DATETIME,
            INDEX idx_order_id (order_id)
          )
        `);
        console.log('[ML Message] Tabla ml_messages_sent creada');
      } catch (tableError) {
        console.error('[ML Message] Error creando tabla:', tableError);
      }
    }
    
    // Log del error pero no fallar el proceso principal
    const errData = error.response?.data || {};
    const isNotFound = error.response?.status === 404 || (errData.error === 'resource not found');
    if (isNotFound) {
      console.warn(`[ML Message] Mensaje automático no disponible para orden ${orderId} (API ML: recurso no encontrado). El pedido y el stock se procesaron correctamente.`);
    } else {
      console.error(`[ML Message] Error enviando mensaje para orden ${orderId}:`, errData.error ? { error: errData.error, message: errData.message } : error.message);
    }
  }
};

/** Sincronización automática ML → TN (sin tocar inventario local). ML = fuente de verdad para canales. Incluye variantes con publicación padre (mercado_libre_id + variant_id) y variantes con publicación propia (mercado_libre_item_id). */
export async function runAutoSyncMLtoTN(): Promise<{ updated: number; errors: number }> {
  const mlToken = await getValidMLToken();
  const tnIntegration = await get(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);
  if (!mlToken || !tnIntegration?.access_token || !tnIntegration?.store_id) {
    return { updated: 0, errors: 0 };
  }
  let updated = 0;
  let errors = 0;

  // 1) Variantes con publicación padre ML (una publicación con varias variaciones)
  const rows = await query(`
    SELECT p.mercado_libre_id AS ml_id, pv.mercado_libre_variant_id AS ml_variant_id,
           p.tienda_nube_id AS tn_id, pv.tienda_nube_variant_id AS tn_variant_id,
           COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack,
           COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack
    FROM product_variants pv
    JOIN product_colors pc ON pc.id = pv.product_color_id
    JOIN products p ON p.id = pc.product_id
    WHERE p.mercado_libre_id IS NOT NULL AND pv.mercado_libre_variant_id IS NOT NULL
      AND p.tienda_nube_id IS NOT NULL AND pv.tienda_nube_variant_id IS NOT NULL
  `);
  if (rows?.length) {
    const byMlId = new Map<string, typeof rows>();
    for (const r of rows) {
      const id = (r as any).ml_id;
      if (!byMlId.has(id)) byMlId.set(id, []);
      byMlId.get(id)!.push(r);
    }
    const mlIds = Array.from(byMlId.keys());
    const batchSize = 10;
    for (let i = 0; i < mlIds.length; i += batchSize) {
      const batch = mlIds.slice(i, i + batchSize);
      const itemPromises = batch.map((id: string) =>
        axios.get(`https://api.mercadolibre.com/items/${id}?include_attributes=all`, {
          headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
        }).then(r => r.data).catch(() => null)
      );
      const items = await Promise.all(itemPromises);
      for (let j = 0; j < batch.length; j++) {
        const item = items[j];
        const mlId = batch[j];
        const variantRows = byMlId.get(mlId) || [];
        if (!item) { errors += variantRows.length; continue; }
        const variations = item.variations || [];
        for (const vr of variantRows) {
          const r = vr as any;
          const v = variations.find((x: any) => String(x.id) === String(r.ml_variant_id));
          if (!v && variations.length > 0) {
            console.warn(
              `[AutoSync ML→TN] Omitido: no se encontró variación ML ${r.ml_variant_id} en item ${mlId}. Se evita enviar 0 a TN.`
            );
            continue;
          }
          const mlQty = v ? (v.available_quantity ?? 0) : (item.available_quantity ?? 0);
          const mlPack = Math.max(1, Number(r.ml_pack) || 1);
          const tnPack = Math.max(1, Number(r.tn_pack) || 1);
          const tnStock = Math.floor((Number(mlQty) * mlPack) / tnPack);
          try {
            await putTnVariantWithRetry(
              `https://api.tiendanube.com/v1/${tnIntegration.store_id}/products/${r.tn_id}/variants/${r.tn_variant_id}`,
              { stock: tnStock },
              { 'Authentication': `bearer ${tnIntegration.access_token}`, 'Content-Type': 'application/json', 'User-Agent': TN_USER_AGENT }
            );
            updated++;
          } catch (e: any) {
            errors++;
            console.warn(`[AutoSync ML→TN] Error TN PUT variante ml_variant=${r.ml_variant_id} tn=${r.tn_id}/${r.tn_variant_id}:`, e.response?.data?.message || e.message);
          }
          if (TN_RATE_LIMIT_DELAY_MS > 0) await sleep(TN_RATE_LIMIT_DELAY_MS);
        }
      }
    }
  }

  // 2) Variantes con mercado_libre_item_id (publicación propia o ítem multi-variación mal vinculado).
  // Empareja por ml_variant_id / SKU / color+talle; no omitir solo porque el ítem tenga varias variaciones.
  const rowsByItem = await query(`
    SELECT pv.id AS variant_id,
           pv.mercado_libre_item_id AS ml_item_id,
           pv.mercado_libre_variant_id AS ml_variant_id,
           p.tienda_nube_id AS tn_id, pv.tienda_nube_variant_id AS tn_variant_id,
           COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack,
           COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack,
           COALESCE(pv.external_sku, pv.sku) AS sku,
           c.name AS color_name,
           sz.size_code AS size_code
    FROM product_variants pv
    JOIN product_colors pc ON pc.id = pv.product_color_id
    JOIN products p ON p.id = pc.product_id
    LEFT JOIN colors c ON c.id = pc.color_id
    LEFT JOIN sizes sz ON sz.id = pv.size_id
    WHERE pv.mercado_libre_item_id IS NOT NULL
      AND p.tienda_nube_id IS NOT NULL AND pv.tienda_nube_variant_id IS NOT NULL
      AND NOT (p.mercado_libre_id IS NOT NULL AND pv.mercado_libre_variant_id IS NOT NULL)
  `);
  if (rowsByItem?.length) {
    const batchSize = 10;
    for (let i = 0; i < rowsByItem.length; i += batchSize) {
      const batch = rowsByItem.slice(i, i + batchSize) as any[];
      const itemPromises = batch.map((row: any) =>
        axios.get(`https://api.mercadolibre.com/items/${row.ml_item_id}?include_attributes=all`, {
          headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
        }).then(r => r.data).catch(() => null)
      );
      const items = await Promise.all(itemPromises);
      for (let j = 0; j < batch.length; j++) {
        const item = items[j];
        const r = batch[j];
        if (!item) {
          errors++;
          console.warn(`[AutoSync ML→TN] No se pudo obtener ítem ML ${r.ml_item_id} (SKU ${r.sku})`);
          continue;
        }
        const variations = item.variations || [];
        let mlQty: number;
        if (variations.length === 0) {
          mlQty = item.available_quantity ?? 0;
        } else if (variations.length === 1) {
          mlQty = variations[0].available_quantity ?? 0;
        } else {
          const matched = matchMlVariationForVariantLink(variations, {
            variationId: r.ml_variant_id,
            sku: r.sku,
            color: r.color_name,
            size: r.size_code,
          });
          if (!matched) {
            console.warn(
              `[AutoSync ML→TN] Omitido ml_item ${r.ml_item_id} (SKU ${r.sku}): ${variations.length} variaciones y no se pudo emparejar por id/SKU/atributos.`
            );
            continue;
          }
          mlQty = matched.available_quantity ?? 0;
          const matchedVarId = String(matched.id);
          if (
            r.variant_id &&
            matchedVarId &&
            (!r.ml_variant_id || String(r.ml_variant_id).trim() === '')
          ) {
            try {
              await execute(
                `UPDATE product_variants
                 SET mercado_libre_variant_id = ?
                 WHERE id = ? AND (mercado_libre_variant_id IS NULL OR TRIM(mercado_libre_variant_id) = '')`,
                [matchedVarId, r.variant_id]
              );
            } catch {
              /* backfill best-effort */
            }
          }
        }
        const mlPack = Math.max(1, Number(r.ml_pack) || 1);
        const tnPack = Math.max(1, Number(r.tn_pack) || 1);
        const tnStock = Math.floor((Number(mlQty) * mlPack) / tnPack);
        try {
          await putTnVariantWithRetry(
            `https://api.tiendanube.com/v1/${tnIntegration.store_id}/products/${r.tn_id}/variants/${r.tn_variant_id}`,
            { stock: tnStock },
            { 'Authentication': `bearer ${tnIntegration.access_token}`, 'Content-Type': 'application/json', 'User-Agent': TN_USER_AGENT }
          );
          updated++;
        } catch (e: any) {
          errors++;
          console.warn(`[AutoSync ML→TN] Error TN PUT ítem propio ml_item=${r.ml_item_id} tn=${r.tn_id}/${r.tn_variant_id} (SKU ${r.sku}):`, e.response?.data?.message || e.message);
        }
        if (TN_RATE_LIMIT_DELAY_MS > 0) await sleep(TN_RATE_LIMIT_DELAY_MS);
      }
    }
  }

  if (updated > 0 || errors > 0) {
    console.log(`[AutoSync ML→TN] Actualizados: ${updated}, errores: ${errors}`);
  }
  return { updated, errors };
}

export type MlTnSyncIssueRow = {
  variant_id: string;
  variant_sku: string;
  product_sku: string;
  product_name: string;
  color_name: string;
  size_code: string;
  stock_lupohub: number;
  sync_mode: string;
  ml_id: string;
  ml_variant_id: string;
  ml_item_id: string;
  tn_product_id: string;
  tn_variant_id: string;
  issue_type: string;
  issue_message: string;
};

function hasCompleteMlLink(r: { ml_id?: string | null; ml_variant_id?: string | null; ml_item_id?: string | null }): boolean {
  const itemId = r.ml_item_id != null && String(r.ml_item_id).trim() !== '';
  const parent = r.ml_id != null && String(r.ml_id).trim() !== '' && r.ml_variant_id != null && String(r.ml_variant_id).trim() !== '';
  return itemId || parent;
}

function hasCompleteTnLink(r: { tn_id?: string | null; tn_variant_id?: string | null }): boolean {
  return r.tn_id != null && String(r.tn_id).trim() !== '' && r.tn_variant_id != null && String(r.tn_variant_id).trim() !== '';
}

function hasPartialChannelLink(r: {
  ml_id?: string | null;
  ml_variant_id?: string | null;
  ml_item_id?: string | null;
  tn_id?: string | null;
  tn_variant_id?: string | null;
}): boolean {
  return !!(
    (r.ml_id && String(r.ml_id).trim()) ||
    (r.ml_variant_id && String(r.ml_variant_id).trim()) ||
    (r.ml_item_id && String(r.ml_item_id).trim()) ||
    (r.tn_id && String(r.tn_id).trim()) ||
    (r.tn_variant_id && String(r.tn_variant_id).trim())
  );
}

/** Diagnóstico de sincronización ML→TN (sin modificar stock). Misma lógica que runAutoSyncMLtoTN. */
export async function diagnoseMlTnSyncIssues(): Promise<MlTnSyncIssueRow[]> {
  const issues: MlTnSyncIssueRow[] = [];
  const pushIssue = (
    r: any,
    syncMode: string,
    issueType: string,
    issueMessage: string
  ) => {
    issues.push({
      variant_id: String(r.variant_id),
      variant_sku: String(r.variant_sku || ''),
      product_sku: String(r.product_sku || ''),
      product_name: String(r.product_name || ''),
      color_name: String(r.color_name || ''),
      size_code: String(r.size_code || ''),
      stock_lupohub: Number(r.stock_lupohub ?? 0),
      sync_mode: syncMode,
      ml_id: r.ml_id != null ? String(r.ml_id) : '',
      ml_variant_id: r.ml_variant_id != null ? String(r.ml_variant_id) : '',
      ml_item_id: r.ml_item_id != null ? String(r.ml_item_id) : '',
      tn_product_id: r.tn_id != null ? String(r.tn_id) : '',
      tn_variant_id: r.tn_variant_id != null ? String(r.tn_variant_id) : '',
      issue_type: issueType,
      issue_message: issueMessage,
    });
  };

  const rows = await query(`
    SELECT pv.id AS variant_id, pv.sku AS variant_sku,
           p.sku AS product_sku, p.name AS product_name,
           c.name AS color_name, sz.size_code AS size_code,
           COALESCE(st.stock, 0) AS stock_lupohub,
           p.mercado_libre_id AS ml_id,
           pv.mercado_libre_variant_id AS ml_variant_id,
           pv.mercado_libre_item_id AS ml_item_id,
           p.tienda_nube_id AS tn_id,
           pv.tienda_nube_variant_id AS tn_variant_id
    FROM product_variants pv
    JOIN product_colors pc ON pc.id = pv.product_color_id
    JOIN products p ON p.id = pc.product_id
    LEFT JOIN colors c ON c.id = pc.color_id
    LEFT JOIN sizes sz ON sz.id = pv.size_id
    LEFT JOIN stocks st ON st.variant_id = pv.id
    WHERE (
      (p.mercado_libre_id IS NOT NULL AND TRIM(p.mercado_libre_id) != '')
      OR (pv.mercado_libre_variant_id IS NOT NULL AND TRIM(pv.mercado_libre_variant_id) != '')
      OR (pv.mercado_libre_item_id IS NOT NULL AND TRIM(pv.mercado_libre_item_id) != '')
      OR (p.tienda_nube_id IS NOT NULL AND TRIM(CAST(p.tienda_nube_id AS CHAR)) != '')
      OR (pv.tienda_nube_variant_id IS NOT NULL AND TRIM(CAST(pv.tienda_nube_variant_id AS CHAR)) != '')
    )
    ORDER BY p.sku, pv.sku
  `);
  if (!rows?.length) return issues;

  const mlToken = await getValidMLToken();
  const tnIntegration = await get(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);
  const tnHeaders = tnIntegration?.access_token
    ? { Authentication: `bearer ${tnIntegration.access_token}`, 'User-Agent': TN_USER_AGENT }
    : null;
  const tnStoreId = tnIntegration?.store_id ? String(tnIntegration.store_id) : '';

  const mlItemCache = new Map<string, any | null>();
  const fetchMlItem = async (id: string): Promise<any | null> => {
    if (!id || !mlToken?.access_token) return null;
    if (mlItemCache.has(id)) return mlItemCache.get(id) ?? null;
    try {
      const data = await axios.get(`https://api.mercadolibre.com/items/${id}?include_attributes=all`, {
        headers: { Authorization: `Bearer ${mlToken.access_token}` },
      }).then((res) => res.data);
      mlItemCache.set(id, data);
      return data;
    } catch {
      mlItemCache.set(id, null);
      return null;
    }
  };

  const tnProductCache = new Map<string, any | null>();
  const fetchTnProduct = async (productId: string): Promise<any | null> => {
    if (!productId || !tnHeaders || !tnStoreId) return null;
    if (tnProductCache.has(productId)) return tnProductCache.get(productId) ?? null;
    try {
      const data = await axios.get(
        `https://api.tiendanube.com/v1/${tnStoreId}/products/${productId}`,
        { headers: tnHeaders }
      ).then((res) => res.data);
      tnProductCache.set(productId, data);
      if (TN_RATE_LIMIT_DELAY_MS > 0) await sleep(TN_RATE_LIMIT_DELAY_MS);
      return data;
    } catch {
      tnProductCache.set(productId, null);
      if (TN_RATE_LIMIT_DELAY_MS > 0) await sleep(TN_RATE_LIMIT_DELAY_MS);
      return null;
    }
  };

  const tnVariantExists = async (productId: string, variantId: string): Promise<boolean | null> => {
    if (!tnHeaders || !tnStoreId) return null;
    const product = await fetchTnProduct(productId);
    if (!product) return false;
    const variants = product.variants || [];
    return variants.some((v: any) => String(v.id) === String(variantId));
  };

  const pendingMlParent: any[] = [];
  const pendingMlOwn: any[] = [];

  for (const row of rows as any[]) {
    const mlComplete = hasCompleteMlLink(row);
    const tnComplete = hasCompleteTnLink(row);
    if (!hasPartialChannelLink(row)) continue;

    const syncMode = row.ml_item_id
      ? 'publicacion_propia'
      : row.ml_id && row.ml_variant_id
        ? 'publicacion_padre'
        : 'vinculo_incompleto';

    if (!mlComplete && !tnComplete) {
      pushIssue(row, syncMode, 'SIN_VINCULOS', 'Faltan vínculos completos con Mercado Libre y Tienda Nube.');
      continue;
    }
    if (!mlComplete && tnComplete) {
      const missing: string[] = [];
      if (!row.ml_item_id && !row.ml_id) missing.push('publicación ML');
      if (!row.ml_item_id && !row.ml_variant_id) missing.push('variación ML');
      if (row.ml_item_id == null && !row.ml_id && !row.ml_variant_id) missing.push('ítem ML propio');
      pushIssue(row, syncMode, 'SIN_ML', `Tiene Tienda Nube pero falta vínculo ML (${missing.join(', ') || 'incompleto'}).`);
      continue;
    }
    if (mlComplete && !tnComplete) {
      const missing: string[] = [];
      if (!row.tn_id) missing.push('producto TN');
      if (!row.tn_variant_id) missing.push('variante TN');
      pushIssue(row, syncMode, 'SIN_TN', `Tiene Mercado Libre pero falta vínculo TN (${missing.join(', ') || 'incompleto'}).`);
      continue;
    }

    if (row.ml_item_id) pendingMlOwn.push(row);
    else if (row.ml_id && row.ml_variant_id) pendingMlParent.push(row);
  }

  const mlParentIds = Array.from(new Set(pendingMlParent.map((r) => String(r.ml_id))));
  for (let i = 0; i < mlParentIds.length; i += 10) {
    await Promise.all(mlParentIds.slice(i, i + 10).map((id) => fetchMlItem(id)));
  }

  for (const r of pendingMlParent) {
    const item = await fetchMlItem(String(r.ml_id));
    const syncMode = 'publicacion_padre';
    if (!item) {
      pushIssue(r, syncMode, 'ML_NO_ENCONTRADO', `No se pudo obtener la publicación ML ${r.ml_id}. Puede estar pausada, finalizada o eliminada.`);
      continue;
    }
    const variations = item.variations || [];
    const v = variations.find((x: any) => String(x.id) === String(r.ml_variant_id));
    if (!v && variations.length > 0) {
      pushIssue(
        r,
        syncMode,
        'ML_VARIACION_NO_ENCONTRADA',
        `La variación ML ${r.ml_variant_id} no existe en la publicación ${r.ml_id}. Se evita enviar stock incorrecto a TN.`
      );
      continue;
    }
    const tnOk = await tnVariantExists(String(r.tn_id), String(r.tn_variant_id));
    if (tnOk === false) {
      pushIssue(
        r,
        syncMode,
        'TN_NO_ENCONTRADO',
        `Producto/variante TN ${r.tn_id}/${r.tn_variant_id} no encontrado (404). Revisá o limpiá el vínculo en LupoHub.`
      );
    } else if (tnOk === null) {
      pushIssue(r, syncMode, 'TN_NO_VERIFICADO', 'No hay integración activa con Tienda Nube para verificar el vínculo.');
    }
  }

  const mlOwnIds = Array.from(new Set(pendingMlOwn.map((r) => String(r.ml_item_id))));
  for (let i = 0; i < mlOwnIds.length; i += 10) {
    await Promise.all(mlOwnIds.slice(i, i + 10).map((id) => fetchMlItem(id)));
  }

  for (const r of pendingMlOwn) {
    const item = await fetchMlItem(String(r.ml_item_id));
    const syncMode = 'publicacion_propia';
    if (!item) {
      pushIssue(
        r,
        syncMode,
        'ML_NO_ENCONTRADO',
        `No se pudo obtener el ítem ML ${r.ml_item_id} (SKU ${r.variant_sku}). Puede estar pausado, finalizado o eliminado.`
      );
      continue;
    }
    const variations = item.variations || [];
    if (variations.length > 1) {
      const matched = matchMlVariationForVariantLink(variations, {
        variationId: r.ml_variant_id,
        sku: r.variant_sku,
        color: r.color_name,
        size: r.size_code,
      });
      if (!matched) {
        pushIssue(
          r,
          syncMode,
          'ML_MULTI_VARIACIONES',
          `El ítem ML ${r.ml_item_id} tiene ${variations.length} variaciones y no se pudo emparejar por id/SKU/atributos para sincronizar stock a TN.`
        );
        continue;
      }
    }
    const tnOk = await tnVariantExists(String(r.tn_id), String(r.tn_variant_id));
    if (tnOk === false) {
      pushIssue(
        r,
        syncMode,
        'TN_NO_ENCONTRADO',
        `Producto/variante TN ${r.tn_id}/${r.tn_variant_id} no encontrado (404). Revisá o limpiá el vínculo en LupoHub.`
      );
    } else if (tnOk === null) {
      pushIssue(r, syncMode, 'TN_NO_VERIFICADO', 'No hay integración activa con Tienda Nube para verificar el vínculo.');
    }
  }

  return issues;
}

export const getMlTnSyncIssues = async (req: Request, res: Response) => {
  try {
    const rows = await diagnoseMlTnSyncIssues();
    res.json({ rows, count: rows.length });
  } catch (error: any) {
    console.error('[ML→TN Sync Issues]', error);
    res.status(500).json({ message: error?.message || 'Error al diagnosticar sincronización ML→TN' });
  }
};

// Sincronizar todo el stock local a Tienda Nube
export const syncAllStockToTiendaNube = async (req: Request, res: Response) => {
  try {
    const integration = await get(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);
    if (!integration?.access_token || !integration?.store_id) {
      return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
    }

    const variants = await query(`
      SELECT pv.id, pv.tienda_nube_variant_id, p.tienda_nube_id, s.stock, pv.sku,
             COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack
      FROM product_variants pv
      JOIN product_colors pc ON pc.id = pv.product_color_id
      JOIN products p ON p.id = pc.product_id
      LEFT JOIN stocks s ON s.variant_id = pv.id
      WHERE pv.tienda_nube_variant_id IS NOT NULL AND p.tienda_nube_id IS NOT NULL
    `);

    let updated = 0;
    let errors = 0;
    const logs: string[] = [];

    for (const v of variants) {
      try {
        const pack = Math.max(1, Number((v as any).tn_pack) || 1);
        const stockToSend = Math.floor(Number(v.stock || 0) / pack);
        await axios.put(
          `https://api.tiendanube.com/v1/${integration.store_id}/products/${v.tienda_nube_id}/variants/${v.tienda_nube_variant_id}`,
          { stock: stockToSend },
          {
            headers: {
              'Authentication': `bearer ${integration.access_token}`,
              'Content-Type': 'application/json',
              'User-Agent': TN_USER_AGENT
            }
          }
        );
        updated++;
        logs.push(`[OK] ${v.sku}: ${v.stock || 0} un. → ${stockToSend} (pack x${pack})`);
      } catch (e: any) {
        errors++;
        logs.push(`[ERROR] ${v.sku}: ${e.response?.data?.description || e.message}`);
      }
      if (TN_RATE_LIMIT_DELAY_MS > 0) await sleep(TN_RATE_LIMIT_DELAY_MS);
    }

    res.json({
      message: 'Sincronización completada',
      updated,
      errors,
      total: variants.length,
      logs
    });
  } catch (error: any) {
    console.error('Error syncing stock to TN:', error);
    res.status(500).json({ message: 'Error sincronizando stock', error: error.message });
  }
};

// Enviar stock solo de variantes seleccionadas a Tienda Nube
export const syncSelectedStockToTiendaNube = async (req: Request, res: Response) => {
  try {
    const variantIds = Array.isArray(req.body?.variantIds) ? req.body.variantIds.filter((id: unknown) => typeof id === 'string' && id.length > 0) : [];
    if (variantIds.length === 0) {
      return res.status(400).json({ message: 'Indicá al menos una variante (variantIds)' });
    }

    const integration = await get(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);
    if (!integration?.access_token || !integration?.store_id) {
      return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
    }

    const placeholders = variantIds.map(() => '?').join(',');
    const variants = await query(
      `SELECT pv.id, pv.tienda_nube_variant_id, p.tienda_nube_id, s.stock, pv.sku,
              COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       LEFT JOIN stocks s ON s.variant_id = pv.id
       WHERE pv.id IN (${placeholders})
         AND pv.tienda_nube_variant_id IS NOT NULL AND p.tienda_nube_id IS NOT NULL`,
      variantIds
    );

    let updated = 0;
    let errors = 0;
    const logs: string[] = [];

    for (const v of variants) {
      try {
        const pack = Math.max(1, Number((v as any).tn_pack) || 1);
        const stockToSend = Math.floor(Number(v.stock || 0) / pack);
        await axios.put(
          `https://api.tiendanube.com/v1/${integration.store_id}/products/${v.tienda_nube_id}/variants/${v.tienda_nube_variant_id}`,
          { stock: stockToSend },
          {
            headers: {
              'Authentication': `bearer ${integration.access_token}`,
              'Content-Type': 'application/json',
              'User-Agent': TN_USER_AGENT
            }
          }
        );
        updated++;
        logs.push(`[OK] ${v.sku}: ${v.stock || 0} un. → ${stockToSend} (pack x${pack})`);
      } catch (e: any) {
        errors++;
        logs.push(`[ERROR] ${v.sku}: ${e.response?.data?.description || e.message}`);
      }
      if (TN_RATE_LIMIT_DELAY_MS > 0) await sleep(TN_RATE_LIMIT_DELAY_MS);
    }

    const skipped = variantIds.length - variants.length;
    if (skipped > 0) logs.push(`[INFO] ${skipped} variante(s) sin vínculo TN o no encontradas, omitidas.`);

    res.json({
      message: 'Stock enviado a Tienda Nube (selección)',
      updated,
      errors,
      total: variants.length,
      logs
    });
  } catch (error: any) {
    console.error('Error syncing selected stock to TN:', error);
    res.status(500).json({ message: 'Error sincronizando stock', error: error.message });
  }
};

// Sincronizar stock de la app hacia Mercado Libre (app = fuente de verdad). Usa la misma lógica que updateMercadoLibreStockByVariant (subrecurso + fallback PUT item).
export const syncAllStockToMercadoLibre = async (req: Request, res: Response) => {
  try {
    const { updateMercadoLibreStockByVariant, updateMercadoLibreStockByItem } = await import('./stock.controller');
    const variants = await query(`
      SELECT pv.id, pv.mercado_libre_variant_id, pv.mercado_libre_item_id, p.mercado_libre_id, s.stock,
             COALESCE(pv.external_sku, pv.sku) AS sku,
             c.name AS color_name, sz.size_code AS size_code,
             COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack
      FROM product_variants pv
      JOIN product_colors pc ON pc.id = pv.product_color_id
      JOIN products p ON p.id = pc.product_id
      LEFT JOIN colors c ON c.id = pc.color_id
      LEFT JOIN sizes sz ON sz.id = pv.size_id
      LEFT JOIN stocks s ON s.variant_id = pv.id
      WHERE (pv.mercado_libre_item_id IS NOT NULL)
         OR (pv.mercado_libre_variant_id IS NOT NULL AND p.mercado_libre_id IS NOT NULL)
    `);

    let updated = 0;
    let errors = 0;
    const logs: string[] = [];

    for (const v of variants) {
      const pack = Math.max(1, Number((v as any).ml_pack) || 1);
      const stockToSend = Math.floor(Number(v.stock || 0) / pack);
      let ok = false;
      if (v.mercado_libre_item_id && v.mercado_libre_variant_id) {
        ok = await updateMercadoLibreStockByVariant(
          v.mercado_libre_item_id,
          v.mercado_libre_variant_id,
          stockToSend
        );
      } else if (v.mercado_libre_id && v.mercado_libre_variant_id) {
        ok = await updateMercadoLibreStockByVariant(
          v.mercado_libre_id,
          v.mercado_libre_variant_id,
          stockToSend
        );
      } else if (v.mercado_libre_item_id) {
        ok = await updateMercadoLibreStockByItem(v.mercado_libre_item_id, stockToSend, {
          sku: (v as any).sku,
          color: (v as any).color_name,
          size: (v as any).size_code,
          variantId: String(v.id),
        });
      }
      if (ok) {
        updated++;
        logs.push(`[OK] ${v.sku}: ${v.stock || 0} un. → ${stockToSend} (pack x${pack})`);
      } else {
        errors++;
        const mlRef = v.mercado_libre_item_id || (v.mercado_libre_id ? `${v.mercado_libre_id}/${v.mercado_libre_variant_id}` : 'sin vínculo');
        logs.push(`[ERROR] ${v.sku}: no se pudo actualizar ML ${mlRef}`);
        console.warn(`[Sync→ML] Falló variante SKU=${v.sku} ML=${mlRef}`);
      }
    }

    res.json({
      message: 'Stock sincronizado a Mercado Libre',
      updated,
      errors,
      total: variants.length,
      logs
    });
  } catch (error: any) {
    console.error('Error syncing stock to ML:', error);
    res.status(500).json({ message: 'Error sincronizando stock a Mercado Libre', error: error.message });
  }
};

// Enviar stock solo de variantes seleccionadas a Mercado Libre
export const syncSelectedStockToMercadoLibre = async (req: Request, res: Response) => {
  try {
    const variantIds = Array.isArray(req.body?.variantIds) ? req.body.variantIds.filter((id: unknown) => typeof id === 'string' && id.length > 0) : [];
    if (variantIds.length === 0) {
      return res.status(400).json({ message: 'Indicá al menos una variante (variantIds)' });
    }

    const { updateMercadoLibreStockByVariant, updateMercadoLibreStockByItem } = await import('./stock.controller');
    const placeholders = variantIds.map(() => '?').join(',');
    const variants = await query(
      `SELECT pv.id, pv.mercado_libre_variant_id, pv.mercado_libre_item_id, p.mercado_libre_id, s.stock,
              COALESCE(pv.external_sku, pv.sku) AS sku,
              c.name AS color_name, sz.size_code AS size_code,
              COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       LEFT JOIN colors c ON c.id = pc.color_id
       LEFT JOIN sizes sz ON sz.id = pv.size_id
       LEFT JOIN stocks s ON s.variant_id = pv.id
       WHERE pv.id IN (${placeholders})
         AND ((pv.mercado_libre_item_id IS NOT NULL)
              OR (pv.mercado_libre_variant_id IS NOT NULL AND p.mercado_libre_id IS NOT NULL))`,
      variantIds
    );

    let updated = 0;
    let errors = 0;
    const logs: string[] = [];

    for (const v of variants) {
      const pack = Math.max(1, Number((v as any).ml_pack) || 1);
      const stockToSend = Math.floor(Number(v.stock || 0) / pack);
      let ok = false;
      if (v.mercado_libre_item_id && v.mercado_libre_variant_id) {
        ok = await updateMercadoLibreStockByVariant(
          v.mercado_libre_item_id,
          v.mercado_libre_variant_id,
          stockToSend
        );
      } else if (v.mercado_libre_id && v.mercado_libre_variant_id) {
        ok = await updateMercadoLibreStockByVariant(
          v.mercado_libre_id,
          v.mercado_libre_variant_id,
          stockToSend
        );
      } else if (v.mercado_libre_item_id) {
        ok = await updateMercadoLibreStockByItem(v.mercado_libre_item_id, stockToSend, {
          sku: (v as any).sku,
          color: (v as any).color_name,
          size: (v as any).size_code,
          variantId: String(v.id),
        });
      }
      if (ok) {
        updated++;
        logs.push(`[OK] ${v.sku}: ${v.stock || 0} un. → ${stockToSend} (pack x${pack})`);
      } else {
        errors++;
        logs.push(`[ERROR] ${v.sku}: no se pudo actualizar`);
      }
    }

    const skipped = variantIds.length - variants.length;
    if (skipped > 0) logs.push(`[INFO] ${skipped} variante(s) sin vínculo ML o no encontradas, omitidas.`);

    res.json({
      message: 'Stock enviado a Mercado Libre (selección)',
      updated,
      errors,
      total: variants.length,
      logs
    });
  } catch (error: any) {
    console.error('Error syncing selected stock to ML:', error);
    res.status(500).json({ message: 'Error sincronizando stock a Mercado Libre', error: error.message });
  }
};

/** Obtener stock en ML y TN por variantes (para mostrar en inventario). */
export const getVariantExternalStocks = async (req: Request, res: Response) => {
  try {
    const variantIds = Array.isArray(req.body?.variantIds) ? req.body.variantIds.filter((id: unknown) => typeof id === 'string' && id.length > 0).slice(0, 100) : [];
    if (variantIds.length === 0) {
      return res.json({ stocks: {} });
    }

    const placeholders = variantIds.map(() => '?').join(',');
    const rows = await query(
      `SELECT pv.id AS variant_id,
              pc.product_id,
              COALESCE(pv.external_sku, pv.sku) AS sku,
              c.code AS color_code, c.name AS color_name,
              s.size_code,
              p.mercado_libre_id, pv.mercado_libre_variant_id, pv.mercado_libre_item_id,
              p.tienda_nube_id, pv.tienda_nube_variant_id
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN colors c ON c.id = pc.color_id
       JOIN products p ON p.id = pc.product_id
       LEFT JOIN sizes s ON s.id = pv.size_id
       WHERE pv.id IN (${placeholders})`,
      variantIds
    );

    const { shouldSyncMlPublication } = await import('../services/variantPublicationFilter');
    const mlItemsByProduct = new Map<string, Set<string>>();
    const variantLinkMeta = new Map<
      string,
      {
        productId: string;
        ownItemId: string | null;
        ownVarId: string | null;
        parentItemId: string | null;
        siblingOwnItemIds: Set<string>;
      }
    >();
    for (const r of rows || []) {
      const variantId = String((r as any).variant_id || '');
      const productId = String((r as any).product_id || '');
      if (!variantId || !productId) continue;
      const ownItemId =
        (r as any).mercado_libre_item_id != null && String((r as any).mercado_libre_item_id).trim() !== ''
          ? String((r as any).mercado_libre_item_id).trim()
          : null;
      if (ownItemId) {
        if (!mlItemsByProduct.has(productId)) mlItemsByProduct.set(productId, new Set());
        mlItemsByProduct.get(productId)!.add(ownItemId);
      }
      variantLinkMeta.set(variantId, {
        productId,
        ownItemId,
        ownVarId:
          (r as any).mercado_libre_variant_id != null && String((r as any).mercado_libre_variant_id).trim() !== ''
            ? String((r as any).mercado_libre_variant_id).trim()
            : null,
        parentItemId:
          (r as any).mercado_libre_id != null && String((r as any).mercado_libre_id).trim() !== ''
            ? String((r as any).mercado_libre_id).trim()
            : null,
        siblingOwnItemIds: new Set()
      });
    }
    for (const [variantId, meta] of variantLinkMeta) {
      const productItems = mlItemsByProduct.get(meta.productId);
      if (!productItems) continue;
      meta.siblingOwnItemIds = new Set(
        [...productItems].filter((itemId) => itemId !== meta.ownItemId)
      );
      variantLinkMeta.set(variantId, meta);
    }

    const pubsByVariant = new Map<string, Array<{ itemId: string; variationId: string | null }>>();
    try {
      const pubRows = await query(
        `SELECT variant_id, external_product_id, external_variant_id
         FROM variant_publications
         WHERE platform = 'mercadolibre' AND variant_id IN (${placeholders})`,
        variantIds
      );
      for (const pr of pubRows || []) {
        const vid = String((pr as any).variant_id || '');
        const itemId = String((pr as any).external_product_id || '').trim();
        if (!vid || !itemId) continue;
        if (!pubsByVariant.has(vid)) pubsByVariant.set(vid, []);
        const extVar = (pr as any).external_variant_id;
        pubsByVariant.get(vid)!.push({
          itemId,
          variationId: extVar != null && String(extVar).trim() !== '' ? String(extVar).trim() : null
        });
      }
    } catch {
      /* variant_publications opcional */
    }

    const stocks: Record<string, { stockML?: number; stockTN?: number }> = {};
    for (const id of variantIds) stocks[id] = {};

    const mlToken = await getValidMLToken();
    const tnIntegration = await get(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);

    if (mlToken?.access_token) {
      const mlHeaders = { Authorization: `Bearer ${mlToken.access_token}` };
      const mlItemLinks = new Map<string, VariantMlStockLink[]>();

      const pushMlLink = (itemId: string, link: VariantMlStockLink) => {
        const id = String(itemId || '').trim();
        if (!id) return;
        if (!mlItemLinks.has(id)) mlItemLinks.set(id, []);
        mlItemLinks.get(id)!.push(link);
      };

      for (const r of rows || []) {
        const variantId = String((r as any).variant_id || '');
        if (!variantId) continue;
        const baseLink: VariantMlStockLink = {
          variantId,
          variationId: null,
          sku: String((r as any).sku || '').trim(),
          color: String((r as any).color_name || (r as any).color_code || '').trim(),
          size: String((r as any).size_code || '').trim()
        };

        const pubs = pubsByVariant.get(variantId) || [];
        const linkCtx = variantLinkMeta.get(variantId);
        for (const pub of pubs) {
          if (
            linkCtx &&
            !shouldSyncMlPublication(
              { external_product_id: pub.itemId, external_variant_id: pub.variationId },
              {
                variantId,
                ownItemId: linkCtx.ownItemId,
                ownVarId: linkCtx.ownVarId,
                parentItemId: linkCtx.parentItemId,
                ownTnVariantId: null,
                siblingOwnItemIds: linkCtx.siblingOwnItemIds,
                siblingTnVariantIds: new Set()
              }
            )
          ) {
            continue;
          }
          pushMlLink(pub.itemId, { ...baseLink, variationId: pub.variationId });
        }

        if (pubs.length === 0) {
          const ownItemId =
            (r as any).mercado_libre_item_id != null && String((r as any).mercado_libre_item_id).trim() !== ''
              ? String((r as any).mercado_libre_item_id).trim()
              : null;
          const mlItemId = ownItemId || String((r as any).mercado_libre_id || '').trim();
          const mlVarId =
            (r as any).mercado_libre_variant_id != null && String((r as any).mercado_libre_variant_id).trim() !== ''
              ? String((r as any).mercado_libre_variant_id).trim()
              : null;
          if (mlItemId) {
            pushMlLink(mlItemId, { ...baseLink, variationId: mlVarId });
          }
        }
      }

      for (const [itemId, links] of mlItemLinks) {
        try {
          const itemRes = await axios.get(
            `https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}?include_attributes=all`,
            { headers: mlHeaders, validateStatus: () => true }
          );
          if (itemRes.status !== 200 || !itemRes.data) continue;
          const item = itemRes.data;
          for (const link of links) {
            const qty = resolveMlStockForVariantLink(item, link);
            if (qty !== undefined) stocks[link.variantId].stockML = qty;
          }
        } catch {
          // ignore per-item errors
        }
      }
    }

    if (tnIntegration?.access_token && tnIntegration?.store_id) {
      const tnHeaders = {
        'Authentication': `bearer ${tnIntegration.access_token}`,
        'Content-Type': 'application/json',
        'User-Agent': TN_USER_AGENT
      };
      const tnProductIds = new Map<string, string[]>();
      for (const r of rows || []) {
        const variantId = (r as any).variant_id;
        const tnProductId = (r as any).tienda_nube_id;
        const tnVariantId = (r as any).tienda_nube_variant_id;
        if (!tnProductId || !tnVariantId) continue;
        if (!tnProductIds.has(tnProductId)) tnProductIds.set(tnProductId, []);
        tnProductIds.get(tnProductId)!.push(variantId);
      }
      const variantToTnVariant = new Map<string, string>();
      for (const r of rows || []) {
        const variantId = (r as any).variant_id;
        const tnVariantId = (r as any).tienda_nube_variant_id;
        if (tnVariantId) variantToTnVariant.set(variantId, String(tnVariantId));
      }
      for (const [productId, variantIdsInProduct] of tnProductIds) {
        try {
          // Paginar variantes de TN para traer todas (la API devuelve por defecto una cantidad limitada por página)
          let tnVariants: any[] = [];
          const tnPerPage = 200;
          let tnPage = 1;
          let hasMoreTn = true;
          while (hasMoreTn) {
            const varRes = await axios.get(
              `https://api.tiendanube.com/v1/${tnIntegration.store_id}/products/${productId}/variants`,
              { headers: tnHeaders, params: { page: tnPage, per_page: tnPerPage } }
            );
            const chunk = Array.isArray(varRes.data) ? varRes.data : [];
            tnVariants = tnVariants.concat(chunk);
            if (chunk.length < tnPerPage) hasMoreTn = false;
            else tnPage++;
            if (tnPage > 50) hasMoreTn = false;
          }
          for (const variantId of variantIdsInProduct) {
            const tnVid = variantToTnVariant.get(variantId);
            const tv = tnVariants.find((v: any) => String(v.id) === String(tnVid));
            if (tv != null && typeof tv.stock === 'number') stocks[variantId].stockTN = tv.stock;
          }
        } catch {
          // ignore per-product errors
        }
      }
    }

    res.json({ stocks });
  } catch (error: any) {
    console.error('Error getting variant external stocks:', error);
    res.status(500).json({ message: 'Error obteniendo stock externo', error: error.message });
  }
};

/** Opcional: sincronizar con Mercado Libre como fuente (ML → LupoHub → Tienda Nube). Para el flujo normal, LupoHub es la fuente de verdad y se envía a ML con syncAllStockToMercadoLibre. */
export const syncAllStockFromMercadoLibre = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
    }
    const tnIntegration = await get(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);
    const hasTN = !!(tnIntegration?.access_token && tnIntegration?.store_id);

    const { updateVariantStock } = await import('./stock.controller');
    const logs: string[] = [];
    let updated = 0;
    let errors = 0;
    const limit = 50;
    let offset = 0;

    logs.push('[1/2] Importando stock desde Mercado Libre (opcional; por SKU local)...');
    while (true) {
      const itemsRes = await axios.get(
        `https://api.mercadolibre.com/users/${mlToken.user_id}/items/search?status=active&offset=${offset}&limit=${limit}`,
        { headers: { 'Authorization': `Bearer ${mlToken.access_token}` } }
      );
      const itemIds: string[] = itemsRes.data.results || [];
      if (itemIds.length === 0) break;

      const batchSize = 10;
      for (let i = 0; i < itemIds.length; i += batchSize) {
        const batch = itemIds.slice(i, i + batchSize);
        const itemPromises = batch.map((itemId: string) =>
          axios.get(`https://api.mercadolibre.com/items/${itemId}?include_attributes=all`, {
            headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
          }).then(r => r.data).catch(() => null)
        );
        const items = await Promise.all(itemPromises);

        for (const item of items) {
          if (!item) continue;
          if (item.variations && item.variations.length > 0) {
            for (const v of item.variations) {
              const sellerCustom = (v.seller_custom_field ?? '').toString().trim();
              const sellerSku = (v.seller_sku ?? '').toString().trim();
              const mlSku = sellerCustom || sellerSku;
              if (!mlSku) {
                logs.push(`[SKU ML] variación id=${v.id}: seller_custom_field="${sellerCustom}" seller_sku="${sellerSku}" → omitido (vacío)`);
                continue;
              }
              const mlSkuNorm = mlSku.replace(/-/g, '').replace(/\s/g, '');
              logs.push(`[SKU ML] variación id=${v.id}: seller_custom_field="${sellerCustom}" seller_sku="${sellerSku}" → usando="${mlSku}" normalizado="${mlSkuNorm}"`);
              const row = await get(
                `SELECT pv.id as variant_id FROM product_variants pv
                 WHERE REPLACE(REPLACE(TRIM(COALESCE(pv.external_sku, pv.sku)), '-', ''), ' ', '') = ?
                 LIMIT 1`,
                [mlSkuNorm]
              );
              if (!row?.variant_id) {
                logs.push(`[SKU ML] sin variante local para "${mlSku}" (normalizado: ${mlSkuNorm})`);
                continue;
              }
              const mlQty = v.available_quantity ?? 0;
              const ok = await updateVariantStock(row.variant_id, mlQty, 'IMPORTACION_ML', 'ML = fuente de verdad', false);
              if (ok) { updated++; logs.push(`[OK] ${mlSku}: ${mlQty}`); }
              else { errors++; logs.push(`[ERROR] ${mlSku}`); }
            }
          } else {
            const sellerCustom = (item.seller_custom_field ?? '').toString().trim();
            const sellerSku = (item.seller_sku ?? '').toString().trim();
            const mlSku = sellerCustom || sellerSku;
            if (!mlSku) {
              logs.push(`[SKU ML] ítem id=${item.id}: seller_custom_field="${sellerCustom}" seller_sku="${sellerSku}" → omitido (vacío)`);
              continue;
            }
            const mlSkuNorm = mlSku.replace(/-/g, '').replace(/\s/g, '');
            logs.push(`[SKU ML] ítem id=${item.id}: seller_custom_field="${sellerCustom}" seller_sku="${sellerSku}" → usando="${mlSku}" normalizado="${mlSkuNorm}"`);
            const variantRow = await get(
              `SELECT pv.id as variant_id FROM product_variants pv
               WHERE REPLACE(REPLACE(TRIM(COALESCE(pv.external_sku, pv.sku)), '-', ''), ' ', '') = ?
               LIMIT 1`,
              [mlSkuNorm]
            );
            if (!variantRow?.variant_id) {
              logs.push(`[SKU ML] sin variante local para ítem "${mlSku}" (normalizado: ${mlSkuNorm})`);
              continue;
            }
            const mlQty = item.available_quantity ?? 0;
            const ok = await updateVariantStock(variantRow.variant_id, mlQty, 'IMPORTACION_ML', 'ML = fuente de verdad', false);
            if (ok) { updated++; logs.push(`[OK] ${mlSku}: ${mlQty}`); }
            else { errors++; logs.push(`[ERROR] ${mlSku}`); }
          }
        }
      }
      if (itemIds.length < limit) break;
      offset += limit;
    }

    let tnUpdated = 0;
    let tnErrors = 0;
    if (hasTN) {
      logs.push('[2/2] Enviando stock a Tienda Nube...');
      const variants = await query(`
        SELECT pv.id, pv.tienda_nube_variant_id, p.tienda_nube_id, s.stock, pv.sku,
               COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack
        FROM product_variants pv
        JOIN product_colors pc ON pc.id = pv.product_color_id
        JOIN products p ON p.id = pc.product_id
        LEFT JOIN stocks s ON s.variant_id = pv.id
        WHERE pv.tienda_nube_variant_id IS NOT NULL AND p.tienda_nube_id IS NOT NULL
      `);
      for (const v of variants) {
        try {
          const pack = Math.max(1, Number((v as any).tn_pack) || 1);
          const stockToSend = Math.floor(Number(v.stock || 0) / pack);
          await axios.put(
            `https://api.tiendanube.com/v1/${tnIntegration.store_id}/products/${v.tienda_nube_id}/variants/${v.tienda_nube_variant_id}`,
            { stock: stockToSend },
            {
              headers: {
                'Authentication': `bearer ${tnIntegration.access_token}`,
                'Content-Type': 'application/json',
                'User-Agent': TN_USER_AGENT
              }
            }
          );
          tnUpdated++;
          logs.push(`[TN] ${v.sku}: ${stockToSend}`);
        } catch (e: any) {
          tnErrors++;
          logs.push(`[TN ERROR] ${v.sku}: ${e.response?.data?.description || e.message}`);
        }
        if (TN_RATE_LIMIT_DELAY_MS > 0) await sleep(TN_RATE_LIMIT_DELAY_MS);
      }
    } else {
      logs.push('[2/2] Tienda Nube no conectada, se omitió el envío.');
    }

    res.json({
      message: 'Stock sincronizado: Mercado Libre → LupoHub → Tienda Nube',
      importedFromML: updated,
      errorsFromML: errors,
      sentToTN: tnUpdated,
      errorsToTN: tnErrors,
      logs
    });
  } catch (error: any) {
    console.error('Error sync from ML:', error);
    res.status(500).json({ message: 'Error sincronizando desde Mercado Libre', error: error.message });
  }
};

// Opcional: importar stock desde Mercado Libre a la app (solo por SKU: seller_custom_field = SKU local; si no existe variante, se ignora).
// Después de actualizar LupoHub, también envía el stock a Tienda Nube (variantes vinculadas).
export const importStockFromMercadoLibre = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
    }
    const tnIntegration = await get(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);
    const hasTN = !!(tnIntegration?.access_token && tnIntegration?.store_id);

    const { updateVariantStock } = await import('./stock.controller');

    let updated = 0;
    let errors = 0;
    const logs: string[] = [];
    const limit = 50;
    let offset = 0;

    logs.push('[1/2] Importando stock desde Mercado Libre (opcional; por SKU local)...');
    while (true) {
      const itemsRes = await axios.get(
        `https://api.mercadolibre.com/users/${mlToken.user_id}/items/search?status=active&offset=${offset}&limit=${limit}`,
        { headers: { 'Authorization': `Bearer ${mlToken.access_token}` } }
      );
      const itemIds: string[] = itemsRes.data.results || [];
      if (itemIds.length === 0) break;

      const batchSize = 10;
      for (let i = 0; i < itemIds.length; i += batchSize) {
        const batch = itemIds.slice(i, i + batchSize);
        const itemPromises = batch.map((itemId: string) =>
          axios.get(`https://api.mercadolibre.com/items/${itemId}?include_attributes=all`, {
            headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
          }).then(r => r.data).catch(() => null)
        );
        const items = await Promise.all(itemPromises);

        for (const item of items) {
          if (!item) continue;
          if (item.variations && item.variations.length > 0) {
            for (const v of item.variations) {
              const sellerCustom = (v.seller_custom_field ?? '').toString().trim();
              const sellerSku = (v.seller_sku ?? '').toString().trim();
              const mlSku = sellerCustom || sellerSku;
              if (!mlSku) {
                logs.push(`[SKU ML] variación id=${v.id}: seller_custom_field="${sellerCustom}" seller_sku="${sellerSku}" → omitido (vacío)`);
                continue;
              }
              const mlSkuNorm = mlSku.replace(/-/g, '').replace(/\s/g, '');
              logs.push(`[SKU ML] variación id=${v.id}: seller_custom_field="${sellerCustom}" seller_sku="${sellerSku}" → usando="${mlSku}" normalizado="${mlSkuNorm}"`);
              const row = await get(
                `SELECT pv.id as variant_id FROM product_variants pv
                 WHERE REPLACE(REPLACE(TRIM(COALESCE(pv.external_sku, pv.sku)), '-', ''), ' ', '') = ?
                 LIMIT 1`,
                [mlSkuNorm]
              );
              if (!row?.variant_id) {
                logs.push(`[SKU ML] sin variante local para "${mlSku}" (normalizado: ${mlSkuNorm})`);
                continue;
              }
              const mlQty = v.available_quantity ?? 0;
              const ok = await updateVariantStock(row.variant_id, mlQty, 'IMPORTACION_ML', 'Importación desde ML', false);
              if (ok) { updated++; logs.push(`[OK] ${mlSku}: ${mlQty}`); }
              else { errors++; logs.push(`[ERROR] ${mlSku}`); }
            }
          } else {
            const sellerCustom = (item.seller_custom_field ?? '').toString().trim();
            const sellerSku = (item.seller_sku ?? '').toString().trim();
            const mlSku = sellerCustom || sellerSku;
            if (!mlSku) {
              logs.push(`[SKU ML] ítem id=${item.id}: seller_custom_field="${sellerCustom}" seller_sku="${sellerSku}" → omitido (vacío)`);
              continue;
            }
            const mlSkuNorm = mlSku.replace(/-/g, '').replace(/\s/g, '');
            logs.push(`[SKU ML] ítem id=${item.id}: seller_custom_field="${sellerCustom}" seller_sku="${sellerSku}" → usando="${mlSku}" normalizado="${mlSkuNorm}"`);
            const variantRow = await get(
              `SELECT pv.id as variant_id FROM product_variants pv
               WHERE REPLACE(REPLACE(TRIM(COALESCE(pv.external_sku, pv.sku)), '-', ''), ' ', '') = ?
               LIMIT 1`,
              [mlSkuNorm]
            );
            if (!variantRow?.variant_id) {
              logs.push(`[SKU ML] sin variante local para ítem "${mlSku}" (normalizado: ${mlSkuNorm})`);
              continue;
            }
            const mlQty = item.available_quantity ?? 0;
            const ok = await updateVariantStock(variantRow.variant_id, mlQty, 'IMPORTACION_ML', 'Importación desde ML', false);
            if (ok) { updated++; logs.push(`[OK] ${mlSku}: ${mlQty}`); }
            else { errors++; logs.push(`[ERROR] ${mlSku}`); }
          }
        }
      }
      if (itemIds.length < limit) break;
      offset += limit;
    }

    let tnUpdated = 0;
    let tnErrors = 0;
    if (hasTN) {
      logs.push('[2/2] Enviando stock a Tienda Nube...');
      const variants = await query(`
        SELECT pv.id, pv.tienda_nube_variant_id, p.tienda_nube_id, s.stock, pv.sku,
               COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack
        FROM product_variants pv
        JOIN product_colors pc ON pc.id = pv.product_color_id
        JOIN products p ON p.id = pc.product_id
        LEFT JOIN stocks s ON s.variant_id = pv.id
        WHERE pv.tienda_nube_variant_id IS NOT NULL AND p.tienda_nube_id IS NOT NULL
      `);
      for (const v of variants) {
        try {
          const pack = Math.max(1, Number((v as any).tn_pack) || 1);
          const stockToSend = Math.floor(Number(v.stock || 0) / pack);
          await axios.put(
            `https://api.tiendanube.com/v1/${tnIntegration.store_id}/products/${v.tienda_nube_id}/variants/${v.tienda_nube_variant_id}`,
            { stock: stockToSend },
            {
              headers: {
                'Authentication': `bearer ${tnIntegration.access_token}`,
                'Content-Type': 'application/json',
                'User-Agent': TN_USER_AGENT
              }
            }
          );
          tnUpdated++;
          logs.push(`[TN] ${v.sku}: ${stockToSend}`);
        } catch (e: any) {
          tnErrors++;
          logs.push(`[TN ERROR] ${v.sku}: ${e.response?.data?.description || e.message}`);
        }
        if (TN_RATE_LIMIT_DELAY_MS > 0) await sleep(TN_RATE_LIMIT_DELAY_MS);
      }
    } else {
      logs.push('[2/2] Tienda Nube no conectada, se omitió el envío.');
    }

    res.json({
      message: hasTN ? 'Stock importado desde Mercado Libre y enviado a Tienda Nube' : 'Stock importado desde Mercado Libre (solo variantes existentes por SKU)',
      updated,
      errors,
      sentToTN: tnUpdated,
      errorsToTN: tnErrors,
      logs
    });
  } catch (error: any) {
    console.error('Error importing stock from ML:', error);
    res.status(500).json({ message: 'Error importando stock desde Mercado Libre', error: error.message });
  }
};

// ==================== ÓRDENES EXTERNAS ====================

// Obtener órdenes de Tienda Nube
// Obtener stock/publicaciones de Tienda Nube (igual que getMercadoLibreStock pero para TN)
export const getTiendaNubeStock = async (req: Request, res: Response) => {
  try {
    const integration = await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
    if (!integration?.access_token) {
      return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
    }
    const storeId = integration.store_id || integration.user_id;
    if (!storeId) {
      return res.status(400).json({ message: 'No se encontró store_id de Tienda Nube' });
    }

    const { offset = '0', limit = '50' } = req.query;
    const page = Math.floor(Number(offset) / Number(limit)) + 1;
    const perPage = Math.min(200, Math.max(1, parseInt(limit as string) || 50)); // API TN permite hasta 200 por página

    const response = await axios.get(`https://api.tiendanube.com/v1/${storeId}/products`, {
      headers: {
        'Authentication': `bearer ${integration.access_token}`,
        'User-Agent': TN_USER_AGENT
      },
      params: { page, per_page: perPage },
      validateStatus: () => true
    });
    if (response.status !== 200) {
      const errMsg = (response.data && (response.data.description || response.data.message || response.data.error)) || response.statusText || 'Tienda Nube no respondió OK';
      return res.status(response.status >= 400 ? 502 : 500).json({ message: 'Error obteniendo stock de Tienda Nube', detail: errMsg });
    }
    const raw = response.data;
    const products = Array.isArray(raw) ? raw : [];
    const isSizeAttr = (name: string) => /talle|talla|size|tamano|tamaño/i.test(name);
    const isColorAttr = (name: string) => /color|colour|cor/i.test(name);

    const items: any[] = [];
    for (const p of products) {
      try {
        if (!p || typeof p !== 'object') continue;
        const title = p.name?.es || p.name?.pt || p.name?.en || p.name || '';
        const attrs = Array.isArray(p.attributes) ? p.attributes : [];
        let sizeIdx = -1;
        let colorIdx = -1;
        attrs.forEach((a: any, i: number) => {
          const n = (a?.es ?? a?.en ?? a?.pt ?? '').toString();
          if (isSizeAttr(n)) sizeIdx = i;
          if (isColorAttr(n)) colorIdx = i;
        });
        let totalStock = 0;
        const variantsList = Array.isArray(p.variants) ? p.variants : [];
        const variations = variantsList.map((v: any) => {
          const stock = Number(v?.stock) || 0;
          totalStock += stock;
          const values = Array.isArray(v?.values) ? v.values : [];
          const sizeVal = sizeIdx >= 0 && sizeIdx < values.length ? (values[sizeIdx]?.es ?? values[sizeIdx]?.pt ?? values[sizeIdx]?.en ?? values[sizeIdx]) : '';
          const colorVal = colorIdx >= 0 && colorIdx < values.length ? (values[colorIdx]?.es ?? values[colorIdx]?.pt ?? values[colorIdx]?.en ?? values[colorIdx]) : '';
          const toStr = (x: any) => (x != null && typeof x === 'object' ? (x.es ?? x.pt ?? x.en) : x) ?? '';
          return {
            variationId: v?.id,
            sku: v?.sku || '',
            size: String(toStr(sizeVal)),
            color: String(toStr(colorVal)),
            stock,
            sold: 0
          };
        });
        const img = (p.images && p.images[0]) ? (p.images[0].src || p.images[0].url) : '';
        items.push({
          id: String(p.id),
          title,
          status: 'active',
          price: variantsList[0]?.price ?? 0,
          totalStock,
          soldTotal: 0,
          thumbnail: img,
          permalink: p.url || 'https://tiendanube.com',
          hasVariations: variations.length > 1,
          variations
        });
      } catch (e) {
        console.warn('[TN Stock] Producto omitido por formato inesperado:', p?.id, (e as Error)?.message);
      }
    }

    const totalHeader = response.headers['x-total-count'] || response.headers['x-total'];
    const total = totalHeader ? parseInt(String(totalHeader), 10) : items.length;
    res.json({
      items,
      total: typeof total === 'number' && !isNaN(total) ? total : items.length,
      offset: parseInt(offset as string),
      limit: perPage
    });
  } catch (error: any) {
    const detail = error.response?.data?.description || error.response?.data?.message || error.message;
    console.error('Error fetching TN stock:', error.response?.data || error.message);
    res.status(500).json({ message: 'Error obteniendo stock de Tienda Nube', detail: detail || 'Error de conexión' });
  }
};

// Totales de stock Tienda Nube (todos los productos, para las cards)
export const getTiendaNubeStockTotals = async (req: Request, res: Response) => {
  try {
    const integration = await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
    if (!integration?.access_token) {
      return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
    }
    const storeId = integration.store_id || integration.user_id;
    if (!storeId) {
      return res.status(400).json({ message: 'No se encontró store_id de Tienda Nube' });
    }
    const perPage = 200;
    let page = 1;
    let hasMore = true;
    let totalProducts = 0;
    let totalStock = 0;
    let lowStockCount = 0;
    let noStockCount = 0;
    while (hasMore) {
      const response = await axios.get(`https://api.tiendanube.com/v1/${storeId}/products`, {
        headers: {
          'Authentication': `bearer ${integration.access_token}`,
          'User-Agent': TN_USER_AGENT
        },
        params: { page, per_page: perPage },
        validateStatus: () => true
      });
      if (response.status !== 200) {
        const errMsg = (response.data && (response.data.description || response.data.message || response.data.error)) || response.statusText || 'Tienda Nube no respondió OK';
        return res.status(response.status >= 400 ? 502 : 500).json({ message: 'Error obteniendo totales de Tienda Nube', detail: errMsg });
      }
      const raw = response.data;
      const products = Array.isArray(raw) ? raw : [];
      if (products.length === 0) {
        hasMore = false;
        break;
      }
      for (const p of products) {
        let productStock = 0;
        for (const v of p.variants || []) {
          productStock += Number(v.stock) || 0;
        }
        totalProducts += 1;
        totalStock += productStock;
        if (productStock === 0) noStockCount += 1;
        else if (productStock < 5) lowStockCount += 1;
      }
      if (products.length < perPage) hasMore = false;
      else page++;
      if (page > 200) hasMore = false;
    }
    res.json({
      totalProducts,
      totalStock,
      lowStockCount,
      noStockCount
    });
  } catch (error: any) {
    const detail = error.response?.data?.description || error.response?.data?.message || error.message;
    console.error('Error fetching TN stock totals:', error.response?.data || error.message);
    res.status(500).json({ message: 'Error obteniendo totales de Tienda Nube', detail: detail || 'Error de conexión' });
  }
};

export const getTiendaNubeOrders = async (req: Request, res: Response) => {
  try {
    const integration = await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
    if (!integration?.access_token) {
      return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
    }
    
    // En TN, store_id es igual a user_id
    const storeId = integration.store_id || integration.user_id;
    if (!storeId) {
      return res.status(400).json({ message: 'No se encontró el store_id de Tienda Nube' });
    }

    const { page = '1', per_page = '20', status, created_at_min, created_at_max, only_paid_pending_shipment } = req.query;
    const perPageNum = Math.min(100, Math.max(1, parseInt(per_page as string) || 20));
    const pageNum = Math.max(1, parseInt(page as string) || 1);

    let url = `https://api.tiendanube.com/v1/${storeId}/orders?page=${pageNum}&per_page=${perPageNum}`;
    if (status) {
      url += `&status=${status}`;
    }
    if (created_at_min) {
      url += `&created_at_min=${created_at_min}`;
    }
    if (created_at_max) {
      url += `&created_at_max=${created_at_max}`;
    }

    const ordersRes = await axios.get(url, {
      headers: {
        'Authentication': `bearer ${integration.access_token}`,
        'User-Agent': TN_USER_AGENT
      }
    });

    let orders = ordersRes.data.map((order: any) => {
      const rawPaymentStatus = (order.payment_status ?? '').toString().trim().toLowerCase();
      const normalizedPaymentStatus = normalizeTnPaymentStatus(order);
      const originalTotal = parseTnMoney(order.total) ?? 0;
      const billableTotal = getTnOrderBillableTotal(order);
      const hasPartialRefund = tnOrderHasPartialRefund(order);

      // Extraer nombre del cliente de diferentes fuentes
      let customerName = 'Sin nombre';
      if (order.customer) {
        if (order.customer.name) {
          customerName = order.customer.name;
        } else if (order.customer.first_name || order.customer.last_name) {
          customerName = `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim();
        }
      }
      // También intentar desde contact o billing_address
      if (customerName === 'Sin nombre' && order.contact_name) {
        customerName = order.contact_name;
      }
      if (customerName === 'Sin nombre' && order.billing_name) {
        customerName = order.billing_name;
      }
      if (customerName === 'Sin nombre' && order.shipping_address?.name) {
        customerName = order.shipping_address.name;
      }

      const shippingCandidates = [
        order.shipping_option,
        order.shipping_option_name,
        order.shipping_method,
        order.shipping_method_name,
        order.shipping_name,
        order.shipping_type,
        order.shipping_mode,
        order.shipping_service,
        order.shipping_status,
        order.gateway_name
      ]
        .map((v: any) => (v == null ? '' : String(v).trim()))
        .filter(Boolean);
      const shippingMethod = shippingCandidates[0] || '';
      const expressBlob = shippingCandidates.join(' ').toLowerCase();
      const hasExpressShipping = /\bexpress\b|\bexpr[eé]s\b|\bflash\b|\bsame\s*day\b|\benv[ií]o\s+en\s+el\s+d[ií]a\b|\br[aá]pido\b|\br[aá]pida\b/.test(expressBlob);

      return {
      id: order.id,
      number: order.number,
      status: order.status,
      paymentStatus: normalizedPaymentStatus,
      paymentStatusRaw: rawPaymentStatus || null,
      isPaid: tnPaymentStatusIsBillable(normalizedPaymentStatus),
      hasPartialRefund,
      originalTotal,
      billableTotal,
      shippingStatus: order.shipping_status,
      shippingMethod,
      hasExpressShipping,
      total: String(billableTotal > 0 ? billableTotal : originalTotal),
      currency: order.currency,
      customer: {
        name: customerName,
        email: order.customer?.email || order.contact_email || '',
        phone: order.customer?.phone || order.contact_phone || ''
      },
      products: (order.products || []).map((p: any) => ({
        id: p.product_id,
        variantId: p.variant_id,
        name: p.name,
        sku: p.sku,
        quantity: p.quantity,
        price: p.price
      })),
      shippingAddress: order.shipping_address ? {
        address: order.shipping_address.address,
        city: order.shipping_address.city,
        province: order.shipping_address.province,
        zipcode: order.shipping_address.zipcode,
        number: order.shipping_address.number,
        floor: order.shipping_address.floor,
        apartment: order.shipping_address.apartment,
        locality: order.shipping_address.locality,
        country: order.shipping_address.country,
        betweenStreets: order.shipping_address.between_streets
      } : null,
      createdAt: order.created_at,
      updatedAt: order.updated_at
    }});

    if (only_paid_pending_shipment === '1' || only_paid_pending_shipment === 'true') {
      orders = orders.filter((o: any) =>
        o.isPaid === true &&
        o.shippingStatus !== 'shipped' &&
        o.shippingStatus !== 'delivered'
      );
    }

    // Marcar si cada orden TN ya fue facturada en facturación masiva externa.
    const tnExternalIds = Array.from(new Set((orders as any[]).map((o: any) => String(o.id)).filter(Boolean)));
    if (tnExternalIds.length > 0) {
      const placeholders = tnExternalIds.map(() => '?').join(', ');
      const invoicedRows = await query(
        `SELECT id, external_order_id, cae, cbte_tipo, cbte_desde, created_at
         FROM external_invoices
         WHERE source = 'TIENDANUBE' AND external_order_id IN (${placeholders})`,
        tnExternalIds
      ) as any[];
      const byExternalId = new Map<string, any>();
      for (const row of invoicedRows) byExternalId.set(String(row.external_order_id), row);
      orders = (orders as any[]).map((o: any) => {
        const inv = byExternalId.get(String(o.id));
        return {
          ...o,
          invoiced: !!inv,
          invoice: inv ? {
            id: inv.id,
            cae: inv.cae,
            cbteTipo: inv.cbte_tipo,
            cbteDesde: inv.cbte_desde,
            createdAt: inv.created_at
          } : undefined
        };
      });
    }

    // Códigos de seguimiento express ya asignados.
    const orderIdsForTracking = Array.from(new Set((orders as any[]).map((o: any) => String(o.id)).filter(Boolean)));
    if (orderIdsForTracking.length > 0) {
      try {
        const trPlaceholders = orderIdsForTracking.map(() => '?').join(', ');
        const trackingRows = await query(
          `SELECT external_order_id, tracking_code, manual_status, manual_status_updated_at, created_at
           FROM tiendanube_express_tracking
           WHERE external_order_id IN (${trPlaceholders})`,
          orderIdsForTracking
        ) as any[];
        const trackingByOrderId = new Map<string, any>();
        for (const row of trackingRows) trackingByOrderId.set(String(row.external_order_id), row);
        orders = (orders as any[]).map((o: any) => {
          const tr = trackingByOrderId.get(String(o.id));
          return {
            ...o,
            trackingCode: tr?.tracking_code || null,
            trackingAssignedAt: tr?.created_at || null,
            trackingStatus: tr?.manual_status || null,
            trackingStatusUpdatedAt: tr?.manual_status_updated_at || null,
          };
        });
      } catch (trackingErr: any) {
        console.warn('[getTiendaNubeOrders] No se pudieron cargar códigos express:', trackingErr?.message || trackingErr);
      }
    }

    res.json({
      orders,
      page: pageNum,
      per_page: perPageNum,
      total: (only_paid_pending_shipment === '1' || only_paid_pending_shipment === 'true') ? orders.length : (ordersRes.headers['x-total-count'] || orders.length)
    });
  } catch (error: any) {
    console.error('Error fetching TN orders:', error.response?.data || error.message);
    res.status(500).json({ message: 'Error obteniendo órdenes de Tienda Nube', error: error.message });
  }
};

const TN_EXPRESS_TRACKING_PREFIX = 'LHE';

async function ensureTnExpressTrackingSequence(): Promise<void> {
  await execute(
    `INSERT IGNORE INTO tiendanube_express_tracking_sequence (id, next_value) VALUES (1, 100001)`
  );
}

function formatTnExpressTrackingCode(seq: number): string {
  return `${TN_EXPRESS_TRACKING_PREFIX}${String(seq).padStart(8, '0')}`;
}

/**
 * Asigna (o devuelve si ya existía) un código de seguimiento único para un envío express de Tienda Nube.
 * Idempotente: reimprimir etiqueta/recibo conserva el mismo código.
 */
export const assignTiendaNubeExpressTracking = async (req: Request, res: Response) => {
  const orderId = String(req.params.orderId || '').trim();
  const orderNumber = String((req.body as any)?.orderNumber || '').trim() || null;
  if (!orderId) return res.status(400).json({ message: 'ID de orden inválido' });

  try {
    const existing = await get(
      `SELECT external_order_id, order_number, tracking_code, manual_status, manual_status_updated_at, created_at
       FROM tiendanube_express_tracking WHERE external_order_id = ?`,
      [orderId]
    );
    if (existing?.tracking_code) {
      return res.json({
        orderId,
        orderNumber: existing.order_number || orderNumber,
        trackingCode: existing.tracking_code,
        trackingStatus: existing.manual_status || null,
        trackingStatusUpdatedAt: existing.manual_status_updated_at || null,
        assigned: false,
        createdAt: existing.created_at
      });
    }

    await ensureTnExpressTrackingSequence();
    const inc = await execute(
      `UPDATE tiendanube_express_tracking_sequence SET next_value = LAST_INSERT_ID(next_value) + 1 WHERE id = 1`
    );
    const seq = Number((inc as any)?.insertId || 0);
    if (!seq) {
      return res.status(500).json({ message: 'No se pudo obtener el próximo código de seguimiento express.' });
    }
    const trackingCode = formatTnExpressTrackingCode(seq);

    try {
      await execute(
        `INSERT INTO tiendanube_express_tracking (external_order_id, order_number, tracking_code, manual_status, manual_status_updated_at)
         VALUES (?, ?, ?, 'preparing', NOW())`,
        [orderId, orderNumber, trackingCode]
      );
      return res.json({
        orderId,
        orderNumber,
        trackingCode,
        trackingStatus: 'preparing',
        assigned: true
      });
    } catch (insertErr: any) {
      if (insertErr?.code === 'ER_DUP_ENTRY') {
        const raced = await get(
          `SELECT external_order_id, order_number, tracking_code, manual_status, manual_status_updated_at, created_at
           FROM tiendanube_express_tracking WHERE external_order_id = ?`,
          [orderId]
        );
        if (raced?.tracking_code) {
          return res.json({
            orderId,
            orderNumber: raced.order_number || orderNumber,
            trackingCode: raced.tracking_code,
            trackingStatus: raced.manual_status || null,
            trackingStatusUpdatedAt: raced.manual_status_updated_at || null,
            assigned: false,
            createdAt: raced.created_at
          });
        }
      }
      throw insertErr;
    }
  } catch (error: any) {
    console.error('assignTiendaNubeExpressTracking:', error);
    return res.status(500).json({ message: 'Error asignando código de seguimiento express' });
  }
};

/**
 * Actualiza el estado manual de seguimiento express (visible en la página pública de tracking).
 * PATCH /api/integrations/tiendanube/orders/:orderId/express-tracking/status
 */
export const updateTiendaNubeExpressTrackingStatus = async (req: Request, res: Response) => {
  const orderId = String(req.params.orderId || '').trim();
  const statusRaw = (req.body as any)?.status;
  if (!orderId) return res.status(400).json({ message: 'ID de orden inválido' });
  if (!isExpressTrackingStatus(statusRaw)) {
    return res.status(400).json({ message: 'Estado de seguimiento inválido' });
  }
  const status = statusRaw as ExpressTrackingStatus;

  try {
    const existing = await get(
      `SELECT external_order_id, order_number, tracking_code, manual_status
       FROM tiendanube_express_tracking WHERE external_order_id = ?`,
      [orderId]
    );
    if (!existing?.tracking_code) {
      return res.status(404).json({
        message: 'Este pedido aún no tiene código de seguimiento. Generá la etiqueta o el recibo express primero.',
      });
    }

    await execute(
      `UPDATE tiendanube_express_tracking
       SET manual_status = ?, manual_status_updated_at = NOW()
       WHERE external_order_id = ?`,
      [status, orderId]
    );

    const updated = await get(
      `SELECT external_order_id, order_number, tracking_code, manual_status, manual_status_updated_at, created_at
       FROM tiendanube_express_tracking WHERE external_order_id = ?`,
      [orderId]
    );

    return res.json({
      orderId,
      orderNumber: updated?.order_number || null,
      trackingCode: updated?.tracking_code,
      trackingStatus: updated?.manual_status,
      trackingStatusLabel: expressTrackingStatusLabel(status),
      trackingStatusUpdatedAt: updated?.manual_status_updated_at || null,
      createdAt: updated?.created_at || null,
    });
  } catch (error: any) {
    console.error('updateTiendaNubeExpressTrackingStatus:', error);
    return res.status(500).json({ message: 'Error actualizando estado de seguimiento' });
  }
};

function parseTnMoney(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

/** Monto neto a facturar: lo que el cliente pagó efectivamente (después de reembolsos parciales). */
function getTnOrderBillableTotal(order: any): number {
  const orderTotal = parseTnMoney(order?.total) ?? 0;
  const paidByCustomer = parseTnMoney(
    order?.total_paid_by_customer
      ?? order?.total_paid_by_customer_including_fees
      ?? order?.total_paid
  );
  if (paidByCustomer != null && paidByCustomer > 0) {
    return paidByCustomer <= orderTotal + 0.01 ? paidByCustomer : orderTotal;
  }
  return orderTotal;
}

function tnOrderHasPartialRefund(order: any): boolean {
  const raw = (order?.payment_status ?? '').toString().trim().toLowerCase();
  if (raw === 'partially_refunded') return true;
  const orderTotal = parseTnMoney(order?.total) ?? 0;
  const billable = getTnOrderBillableTotal(order);
  return orderTotal > 0.005 && billable + 0.01 < orderTotal;
}

function extractTnCustomerCuit(order: any): string | undefined {
  const rawDoc = String(
    order?.contact_identification
      ?? order?.billing_address?.doc_number
      ?? order?.customer?.identification
      ?? order?.customer?.doc_number
      ?? ''
  ).replace(/\D/g, '');
  return rawDoc.length >= 10 ? rawDoc : undefined;
}

function normalizeTnPaymentStatus(order: any): 'paid' | 'partially_refunded' | 'pending' | 'refunded' | 'voided' {
  const rawPaymentStatus = (order?.payment_status ?? '').toString().trim().toLowerCase();
  const paymentDetails = Array.isArray(order?.payment_details) ? order.payment_details : [];
  const detailStates = paymentDetails
    .map((d: any) => (d?.status ?? d?.state ?? '').toString().trim().toLowerCase())
    .filter(Boolean);
  const looksPartiallyRefunded =
    rawPaymentStatus === 'partially_refunded' || detailStates.some((s: string) => s === 'partially_refunded');
  const looksFullyRefunded =
    rawPaymentStatus === 'refunded' || detailStates.some((s: string) => s === 'refunded');
  const looksVoided =
    rawPaymentStatus === 'voided'
    || rawPaymentStatus === 'cancelled'
    || detailStates.some((s: string) => s.includes('void') || s === 'cancelled' || s === 'canceled');
  const looksPaid =
    rawPaymentStatus === 'paid'
    || rawPaymentStatus === 'partially_paid'
    || !!order?.paid_at
    || detailStates.some((s: string) => s === 'paid' || s === 'approved' || s === 'accredited' || s === 'captured');
  if (looksFullyRefunded) return 'refunded';
  if (looksVoided) return 'voided';
  if (looksPartiallyRefunded) return 'partially_refunded';
  return looksPaid ? 'paid' : 'pending';
}

function tnPaymentStatusIsBillable(status: ReturnType<typeof normalizeTnPaymentStatus>): boolean {
  return status === 'paid' || status === 'partially_refunded';
}

/** Emite facturas AFIP masivas para órdenes de Tienda Nube (solo pagadas). */
export const invoiceTiendaNubeOrdersBulk = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).user;
    if (!authUser || !['ADMIN', 'WAREHOUSE', 'DEPOSITO'].includes(authUser.role)) {
      return res.status(403).json({ message: 'Solo ADMIN o Depósito pueden emitir facturas' });
    }

    const orderIdsRaw = Array.isArray(req.body?.orderIds) ? req.body.orderIds : [];
    const orderIds: string[] = Array.from(new Set(orderIdsRaw.map((x: any) => String(x).trim()).filter(Boolean)));
    const cbteTipoFromBody = req.body?.cbteTipo;
    const forceCbteTipo = (cbteTipoFromBody === 1 || cbteTipoFromBody === 6) ? (cbteTipoFromBody as 1 | 6) : undefined;

    if (!orderIds.length) return res.status(400).json({ message: 'Debes enviar orderIds con al menos una orden' });
    if (orderIds.length > 100) return res.status(400).json({ message: 'Máximo 100 órdenes por lote' });

    const integration = await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
    if (!integration?.access_token) {
      return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
    }
    const storeId = integration.store_id || integration.user_id;
    if (!storeId) {
      return res.status(400).json({ message: 'No se encontró el store_id de Tienda Nube' });
    }

    const { emitirFactura: emitirAfip } = await import('../services/afip.service');
    const results: any[] = [];

    for (const orderId of orderIds) {
      const orderIdStr = String(orderId);
      try {
        const existing = await get(
          `SELECT id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta
           FROM external_invoices
           WHERE source = 'TIENDANUBE' AND external_order_id = ?`,
          [orderIdStr]
        );
        if (existing) {
          results.push({
            orderId,
            status: 'already_invoiced',
            invoiceId: existing.id,
            cae: existing.cae,
            cbteTipo: existing.cbte_tipo,
            cbteDesde: existing.cbte_desde,
            cbteHasta: existing.cbte_hasta
          });
          continue;
        }

        const orderRes = await axios.get(`https://api.tiendanube.com/v1/${storeId}/orders/${encodeURIComponent(orderIdStr)}`, {
          headers: {
            'Authentication': `bearer ${integration.access_token}`,
            'User-Agent': TN_USER_AGENT
          },
          validateStatus: () => true
        });
        if (orderRes.status !== 200 || !orderRes.data) {
          results.push({ orderId: orderIdStr, status: 'error', message: 'No se pudo obtener la orden de Tienda Nube' });
          continue;
        }

        const order = orderRes.data;
        const paymentStatus = normalizeTnPaymentStatus(order);
        if (!tnPaymentStatusIsBillable(paymentStatus)) {
          results.push({ orderId: orderIdStr, status: 'skipped_unpaid', message: `La orden no está pagada (estado: ${paymentStatus})` });
          continue;
        }

        const billableTotal = getTnOrderBillableTotal(order);
        if (!Number.isFinite(billableTotal) || billableTotal <= 0) {
          results.push({
            orderId: orderIdStr,
            status: 'error',
            message: paymentStatus === 'partially_refunded'
              ? 'El importe neto a facturar es cero tras el reembolso parcial'
              : 'La orden tiene total inválido para facturar'
          });
          continue;
        }

        const customerName =
          order?.customer?.name
          || `${order?.customer?.first_name || ''} ${order?.customer?.last_name || ''}`.trim()
          || order?.contact_name
          || order?.billing_name
          || 'Consumidor Final';
        const maybeCuit = extractTnCustomerCuit(order);
        const condicionIvaRaw = (
          order?.billing_fiscal_regime
          || order?.billing_address?.fiscal_regime
          || order?.customer?.fiscal_regime
          || order?.customer?.iva_condition
          || 'Consumidor Final'
        ).toString();
        const customerId = `TN-${order?.customer?.id || order.id}`;

        const afipResult = await emitirAfip(
          {
            id: `TN-${order.id}`,
            date: String(order?.created_at || new Date().toISOString().slice(0, 10)),
            total: billableTotal,
            customerId
          },
          {
            id: customerId,
            businessName: customerName,
            cuit: maybeCuit,
            condicionIva: condicionIvaRaw || 'Consumidor Final'
          },
          forceCbteTipo
        );

        const invoiceId = uuidv4();
        await execute(
          `INSERT INTO external_invoices
           (id, source, external_order_id, order_number, customer_name, customer_cuit, customer_condicion_iva, total, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta)
           VALUES (?, 'TIENDANUBE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            invoiceId,
            String(order.id),
            String(order.number ?? order.id),
            customerName,
            maybeCuit || null,
            condicionIvaRaw || null,
            billableTotal,
            afipResult.cae,
            afipResult.caeFchVto || null,
            afipResult.puntoVta,
            afipResult.cbteTipo,
            afipResult.cbteDesde,
            afipResult.cbteHasta
          ]
        );
        results.push({
          orderId: orderIdStr,
          status: 'invoiced',
          invoiceId,
          cae: afipResult.cae,
          cbteTipo: afipResult.cbteTipo,
          cbteDesde: afipResult.cbteDesde,
          cbteHasta: afipResult.cbteHasta,
          billableTotal,
          hasPartialRefund: tnOrderHasPartialRefund(order)
        });
      } catch (e: any) {
        results.push({
          orderId: orderIdStr,
          status: 'error',
          message: e?.message || 'Error emitiendo factura'
        });
      }
    }

    const summary = {
      total: results.length,
      invoiced: results.filter(r => r.status === 'invoiced').length,
      alreadyInvoiced: results.filter(r => r.status === 'already_invoiced').length,
      skippedUnpaid: results.filter(r => r.status === 'skipped_unpaid').length,
      errors: results.filter(r => r.status === 'error').length
    };

    res.json({ message: 'Facturación masiva de Tienda Nube finalizada', summary, results });
  } catch (error: any) {
    console.error('invoiceTiendaNubeOrdersBulk:', error);
    const msg = error?.message || 'Error en facturación masiva de Tienda Nube';
    const status = msg.includes('no configurado') ? 503 : 500;
    res.status(status).json({ message: msg });
  }
};

/** Emite facturas AFIP masivas para órdenes de Mercado Libre (solo pagadas). */
export const invoiceMercadoLibreOrdersBulk = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).user;
    if (!authUser || !['ADMIN', 'WAREHOUSE', 'DEPOSITO'].includes(authUser.role)) {
      return res.status(403).json({ message: 'Solo ADMIN o Depósito pueden emitir facturas' });
    }

    const orderIdsRaw = Array.isArray(req.body?.orderIds) ? req.body.orderIds : [];
    const orderIds: string[] = Array.from(new Set(orderIdsRaw.map((x: any) => String(x).trim()).filter(Boolean)));
    const cbteTipoFromBody = req.body?.cbteTipo;
    const forceCbteTipo = (cbteTipoFromBody === 1 || cbteTipoFromBody === 6) ? (cbteTipoFromBody as 1 | 6) : undefined;

    if (!orderIds.length) return res.status(400).json({ message: 'Debes enviar orderIds con al menos una orden' });
    if (orderIds.length > 100) return res.status(400).json({ message: 'Máximo 100 órdenes por lote' });

    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
    }

    const { emitirFactura: emitirAfip } = await import('../services/afip.service');
    const results: any[] = [];
    const payableOrders: Array<{
      orderId: string;
      total: number;
      date: string;
      customerId: string;
      customerName: string;
    }> = [];

    for (const orderId of orderIds) {
      const orderIdStr = String(orderId);
      try {
        const existing = await get(
          `SELECT id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta
           FROM external_invoices
           WHERE source = 'MERCADOLIBRE' AND external_order_id = ?`,
          [orderIdStr]
        );
        if (existing) {
          results.push({
            orderId,
            status: 'already_invoiced',
            invoiceId: existing.id,
            cae: existing.cae,
            cbteTipo: existing.cbte_tipo,
            cbteDesde: existing.cbte_desde,
            cbteHasta: existing.cbte_hasta
          });
          continue;
        }

        const orderRes = await axios.get(
          `https://api.mercadolibre.com/orders/${encodeURIComponent(orderIdStr)}`,
          { headers: { 'Authorization': `Bearer ${mlToken.access_token}` }, validateStatus: () => true }
        );
        if (orderRes.status !== 200 || !orderRes.data) {
          results.push({ orderId: orderIdStr, status: 'error', message: 'No se pudo obtener la orden de Mercado Libre' });
          continue;
        }

        const order = orderRes.data;
        if ((order?.status || '').toString().toLowerCase() !== 'paid') {
          results.push({ orderId: orderIdStr, status: 'skipped_unpaid', message: `La orden no está pagada (estado: ${order?.status || 'desconocido'})` });
          continue;
        }

        const total = Number(order?.total_amount ?? 0);
        if (!Number.isFinite(total) || total <= 0) {
          results.push({ orderId: orderIdStr, status: 'error', message: 'La orden tiene total inválido para facturar' });
          continue;
        }

        const buyerFirst = (order?.buyer?.first_name || '').toString().trim();
        const buyerLast = (order?.buyer?.last_name || '').toString().trim();
        const customerName = `${buyerFirst} ${buyerLast}`.trim()
          || (order?.buyer?.nickname || '').toString().trim()
          || 'Consumidor Final';

        payableOrders.push({
          orderId: String(order.id),
          total,
          date: String(order?.date_created || new Date().toISOString().slice(0, 10)),
          customerId: `ML-${order?.buyer?.id || order.id}`,
          customerName
        });
      } catch (e: any) {
        results.push({
          orderId: orderIdStr,
          status: 'error',
          message: e?.message || 'Error emitiendo factura'
        });
      }
    }

    if (payableOrders.length > 0) {
      const totalLote = payableOrders.reduce((acc, o) => acc + o.total, 0);
      const base = payableOrders[0];
      const sameCustomer = payableOrders.every((o) => o.customerId === base.customerId);
      const afipResult = await emitirAfip(
        {
          id: `ML-BULK-${Date.now()}`,
          date: base.date,
          total: totalLote,
          customerId: sameCustomer ? base.customerId : 'ML-BULK-CF'
        },
        {
          id: sameCustomer ? base.customerId : 'ML-BULK-CF',
          businessName: sameCustomer ? base.customerName : 'Consumidor Final',
          cuit: undefined,
          condicionIva: 'Consumidor Final'
        },
        forceCbteTipo
      );

      for (const o of payableOrders) {
        const invoiceId = uuidv4();
        await execute(
          `INSERT INTO external_invoices
           (id, source, external_order_id, order_number, customer_name, customer_cuit, customer_condicion_iva, total, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta)
           VALUES (?, 'MERCADOLIBRE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            invoiceId,
            o.orderId,
            o.orderId,
            o.customerName,
            null,
            'Consumidor Final',
            o.total,
            afipResult.cae,
            afipResult.caeFchVto || null,
            afipResult.puntoVta,
            afipResult.cbteTipo,
            afipResult.cbteDesde,
            afipResult.cbteHasta
          ]
        );
        results.push({
          orderId: o.orderId,
          status: 'invoiced',
          invoiceId,
          cae: afipResult.cae,
          cbteTipo: afipResult.cbteTipo,
          cbteDesde: afipResult.cbteDesde,
          cbteHasta: afipResult.cbteHasta
        });
      }
    }

    const summary = {
      total: results.length,
      invoiced: results.filter(r => r.status === 'invoiced').length,
      alreadyInvoiced: results.filter(r => r.status === 'already_invoiced').length,
      skippedUnpaid: results.filter(r => r.status === 'skipped_unpaid').length,
      errors: results.filter(r => r.status === 'error').length
    };

    res.json({ message: 'Facturación masiva de Mercado Libre finalizada', summary, results });
  } catch (error: any) {
    console.error('invoiceMercadoLibreOrdersBulk:', error);
    const msg = error?.message || 'Error en facturación masiva de Mercado Libre';
    const status = msg.includes('no configurado') ? 503 : 500;
    res.status(status).json({ message: msg });
  }
};

/** Historial unificado de facturación masiva externa (Tienda Nube / Mercado Libre). */
export const getExternalInvoicesHistory = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).user;
    if (!authUser || !['ADMIN', 'WAREHOUSE', 'DEPOSITO'].includes(authUser.role)) {
      return res.status(403).json({ message: 'Sin permisos para ver historial de facturación externa' });
    }
    const sourceRaw = String(req.query?.source || '').trim().toUpperCase();
    const source = sourceRaw === 'TIENDANUBE' || sourceRaw === 'MERCADOLIBRE' ? sourceRaw : '';
    const limitNum = Math.min(500, Math.max(1, parseInt(String(req.query?.limit || '50'), 10) || 50));
    const offsetNum = Math.max(0, parseInt(String(req.query?.offset || '0'), 10) || 0);

    const where: string[] = [];
    const params: any[] = [];
    if (source) {
      where.push('source = ?');
      params.push(source);
    }

    const countRow = await get(
      `SELECT COUNT(*) AS cnt
       FROM external_invoices
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
      params
    ) as any;
    const total = Number(countRow?.cnt || 0);

    const rows = await query(
      `SELECT ei.id, ei.source, ei.external_order_id, ei.order_number, ei.customer_name, ei.total,
              ei.cae, ei.cae_fch_vto, ei.punto_venta, ei.cbte_tipo, ei.cbte_desde, ei.cbte_hasta, ei.created_at,
              ecn.id AS credit_note_id, ecn.cae AS credit_note_cae, ecn.cbte_tipo AS credit_note_cbte_tipo, ecn.cbte_desde AS credit_note_cbte_desde
       FROM external_invoices ei
       LEFT JOIN external_credit_notes ecn ON ecn.external_invoice_id = ei.id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ei.created_at DESC
       LIMIT ${limitNum} OFFSET ${offsetNum}`,
      params
    ) as any[];

    // Totales globales (sin filtro de source) para el resumen del historial.
    const totalsRow = await get(
      `SELECT
         COUNT(*) AS total_all,
         SUM(CASE WHEN source = 'TIENDANUBE' THEN 1 ELSE 0 END) AS total_tn,
         SUM(CASE WHEN source = 'MERCADOLIBRE' THEN 1 ELSE 0 END) AS total_ml
       FROM external_invoices`
    ) as any;

    res.json({
      total,
      offset: offsetNum,
      limit: limitNum,
      totals: {
        all: Number(totalsRow?.total_all || 0),
        tn: Number(totalsRow?.total_tn || 0),
        ml: Number(totalsRow?.total_ml || 0)
      },
      invoices: rows.map((r) => ({
        id: r.id,
        source: r.source,
        externalOrderId: r.external_order_id,
        orderNumber: r.order_number,
        customerName: r.customer_name,
        total: Number(r.total || 0),
        cae: r.cae,
        caeFchVto: r.cae_fch_vto ?? undefined,
        puntoVta: r.punto_venta,
        cbteTipo: r.cbte_tipo,
        cbteDesde: r.cbte_desde,
        cbteHasta: r.cbte_hasta,
        createdAt: r.created_at,
        hasCreditNote: !!r.credit_note_id,
        creditNote: r.credit_note_id ? {
          id: r.credit_note_id,
          cae: r.credit_note_cae,
          cbteTipo: r.credit_note_cbte_tipo,
          cbteDesde: r.credit_note_cbte_desde
        } : undefined
      }))
    });
  } catch (error: any) {
    console.error('getExternalInvoicesHistory:', error);
    res.status(500).json({ message: 'Error obteniendo historial de facturación externa' });
  }
};

function scaleExternalLineItemsToTotal(
  items: Array<{ name: string; sku?: string; quantity: number; unitPrice: number; numeroDespacho?: string }>,
  targetTotal: number
): Array<{ name: string; sku?: string; quantity: number; unitPrice: number; numeroDespacho?: string }> {
  if (!items.length || !(targetTotal > 0)) return items;
  const sum = items.reduce((acc, it) => acc + Math.round(it.quantity * it.unitPrice * 100) / 100, 0);
  if (sum <= 0 || Math.abs(sum - targetTotal) <= 0.02) return items;
  const factor = targetTotal / sum;
  return items.map((it) => ({
    ...it,
    unitPrice: Math.round(it.unitPrice * factor * 100) / 100,
  }));
}

async function lookupNumeroDespachoForExternalProduct(args: {
  sku?: string;
  variantId?: string | number;
}): Promise<string | undefined> {
  const sku = String(args.sku || '').trim();
  const variantId = args.variantId != null ? String(args.variantId).trim() : '';
  if (!sku && !variantId) return undefined;

  const params: string[] = [];
  const orParts: string[] = [];
  if (variantId) {
    orParts.push('pv.tienda_nube_variant_id = ?');
    params.push(variantId);
  }
  if (sku) {
    orParts.push('pv.sku = ?', 'pv.external_sku = ?', 'p.sku = ?', "REPLACE(pv.sku, '-', '') = REPLACE(?, '-', '')");
    params.push(sku, sku, sku, sku);
  }
  if (!orParts.length) return undefined;

  const row = (await get(
    `SELECT COALESCE(d.numero_despacho) AS numero_despacho
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN products p ON p.id = pc.product_id
     LEFT JOIN despachos d ON d.id = p.ultimo_despacho_id
     WHERE ${orParts.join(' OR ')}
     LIMIT 1`,
    params
  )) as { numero_despacho?: string } | undefined;

  const n = String(row?.numero_despacho || '').trim();
  return n || undefined;
}

async function enrichExternalProductsWithDespacho(
  products: Array<{ name: string; sku?: string; quantity: number; unitPrice: number; variantId?: string }>
): Promise<Array<{ name: string; sku?: string; quantity: number; unitPrice: number; numeroDespacho?: string }>> {
  const out: Array<{ name: string; sku?: string; quantity: number; unitPrice: number; numeroDespacho?: string }> = [];
  for (const p of products) {
    const numeroDespacho = await lookupNumeroDespachoForExternalProduct({
      sku: p.sku,
      variantId: p.variantId,
    });
    out.push({
      name: p.name,
      sku: p.sku,
      quantity: p.quantity,
      unitPrice: p.unitPrice,
      numeroDespacho,
    });
  }
  return out;
}

/** Datos para imprimir / descargar PDF de una factura externa (TN / ML). */
export const getExternalInvoicePrintData = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).user;
    if (!authUser || !['ADMIN', 'WAREHOUSE', 'DEPOSITO'].includes(authUser.role)) {
      return res.status(403).json({ message: 'Sin permisos para ver facturas externas' });
    }
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'ID de factura externa requerido' });

    const inv = (await get(
      `SELECT id, source, external_order_id, order_number, customer_name, customer_cuit, customer_condicion_iva,
              total, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, created_at
       FROM external_invoices WHERE id = ?`,
      [id]
    )) as any;
    if (!inv) return res.status(404).json({ message: 'Factura externa no encontrada' });

    let products: Array<{ name: string; sku?: string; quantity: number; unitPrice: number; variantId?: string }> = [];
    let customerAddress = '';
    let customerCity = '';

    if (inv.source === 'TIENDANUBE') {
      const integration = await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
      const storeId = integration?.store_id || integration?.user_id;
      if (integration?.access_token && storeId) {
        const orderRes = await axios.get(
          `https://api.tiendanube.com/v1/${storeId}/orders/${encodeURIComponent(String(inv.external_order_id))}`,
          {
            headers: {
              Authentication: `bearer ${integration.access_token}`,
              'User-Agent': TN_USER_AGENT,
            },
            validateStatus: () => true,
          }
        );
        if (orderRes.status === 200 && orderRes.data) {
          const order = orderRes.data;
          products = (order.products || []).map((p: any) => ({
            name: String(p.name || 'Producto').trim(),
            sku: String(p.sku || '').trim() || undefined,
            variantId: p.variant_id != null ? String(p.variant_id) : undefined,
            quantity: Math.max(0, Number(p.quantity) || 0),
            unitPrice: Math.max(0, Number(p.price) || 0),
          })).filter((p: { quantity: number }) => p.quantity > 0);
          const ship = order.shipping_address || {};
          customerAddress = [ship.address, ship.number].filter(Boolean).join(' ').trim();
          customerCity = [ship.city, ship.province].filter(Boolean).join(', ').trim();
        }
      }
    } else if (inv.source === 'MERCADOLIBRE') {
      const mlToken = await getValidMLToken();
      if (mlToken) {
        const orderRes = await axios.get(
          `https://api.mercadolibre.com/orders/${encodeURIComponent(String(inv.external_order_id))}`,
          { headers: { Authorization: `Bearer ${mlToken}` }, validateStatus: () => true }
        );
        if (orderRes.status === 200 && orderRes.data) {
          const order = orderRes.data;
          products = (order.order_items || []).map((item: any) => ({
            name: String(item.item?.title || 'Producto').trim(),
            sku: String(item.item?.seller_sku || item.item?.seller_custom_field || '').trim() || undefined,
            quantity: Math.max(0, Number(item.quantity) || 0),
            unitPrice: Math.max(0, Number(item.unit_price) || 0),
          })).filter((p: { quantity: number }) => p.quantity > 0);
        }
      }
    }

    const invoiceTotal = Number(inv.total || 0);
    products = scaleExternalLineItemsToTotal(products, invoiceTotal);
    products = await enrichExternalProductsWithDespacho(products);
    if (!products.length && invoiceTotal > 0) {
      const canal = inv.source === 'TIENDANUBE' ? 'Tienda Nube' : 'Mercado Libre';
      products = [{
        name: `Venta ${canal} #${inv.order_number || inv.external_order_id}`,
        quantity: 1,
        unitPrice: invoiceTotal,
      }];
    }

    res.json({
      invoice: {
        id: inv.id,
        source: inv.source,
        externalOrderId: inv.external_order_id,
        orderNumber: inv.order_number ?? undefined,
        customerName: inv.customer_name ?? undefined,
        customerCuit: inv.customer_cuit ?? undefined,
        customerCondicionIva: inv.customer_condicion_iva ?? undefined,
        customerAddress: customerAddress || undefined,
        customerCity: customerCity || undefined,
        total: invoiceTotal,
        cae: inv.cae,
        caeFchVto: inv.cae_fch_vto ?? undefined,
        puntoVta: Number(inv.punto_venta),
        cbteTipo: Number(inv.cbte_tipo),
        cbteDesde: Number(inv.cbte_desde),
        cbteHasta: Number(inv.cbte_hasta ?? inv.cbte_desde),
        createdAt: inv.created_at ?? undefined,
      },
      products,
    });
  } catch (error: any) {
    console.error('getExternalInvoicePrintData:', error);
    res.status(500).json({ message: 'Error obteniendo datos para imprimir la factura' });
  }
};

/** Emite NC total para una factura externa (una por factura). */
export const emitirNotaCreditoExternalInvoice = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).user;
    if (!authUser || !['ADMIN', 'WAREHOUSE', 'DEPOSITO'].includes(authUser.role)) {
      return res.status(403).json({ message: 'Solo ADMIN o Depósito pueden emitir notas de crédito' });
    }
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'ID de factura externa requerido' });

    const inv = await get(
      `SELECT id, source, external_order_id, customer_name, customer_cuit, customer_condicion_iva,
              total, punto_venta, cbte_tipo, cbte_desde
       FROM external_invoices WHERE id = ?`,
      [id]
    ) as any;
    if (!inv) return res.status(404).json({ message: 'Factura externa no encontrada' });

    const existingNc = await get(`SELECT id FROM external_credit_notes WHERE external_invoice_id = ?`, [id]);
    if (existingNc) return res.status(409).json({ message: 'Esta factura externa ya tiene nota de crédito emitida' });

    const amount = Number(inv.total || 0);
    if (amount <= 0) return res.status(400).json({ message: 'Monto inválido para emitir nota de crédito' });

    const { emitirNotaCredito } = await import('../services/afip.service');
    const result = await emitirNotaCredito(
      { puntoVta: Number(inv.punto_venta), cbteTipo: Number(inv.cbte_tipo), cbteDesde: Number(inv.cbte_desde) },
      {
        id: `EXT-${inv.id}`,
        businessName: String(inv.customer_name || 'Consumidor Final'),
        cuit: inv.customer_cuit ? String(inv.customer_cuit) : undefined,
        condicionIva: inv.customer_condicion_iva ? String(inv.customer_condicion_iva) : 'Consumidor Final'
      },
      amount
    );

    const ncId = uuidv4();
    await execute(
      `INSERT INTO external_credit_notes
       (id, external_invoice_id, source, external_order_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, amount_credited)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ncId, inv.id, inv.source, inv.external_order_id, result.cae, result.caeFchVto || null, result.puntoVta, result.cbteTipo, result.cbteDesde, result.cbteHasta, amount]
    );

    res.status(201).json({
      id: ncId,
      externalInvoiceId: inv.id,
      source: inv.source,
      externalOrderId: inv.external_order_id,
      cae: result.cae,
      cbteTipo: result.cbteTipo,
      cbteDesde: result.cbteDesde,
      cbteHasta: result.cbteHasta
    });
  } catch (error: any) {
    console.error('emitirNotaCreditoExternalInvoice:', error);
    const msg = error?.message || 'Error emitiendo nota de crédito externa';
    const status = msg.includes('ya tiene') ? 409 : msg.includes('no configurado') ? 503 : 500;
    res.status(status).json({ message: msg });
  }
};

/** Listado de preguntas del vendedor (historial desde la API de Mercado Libre). */
export const getMercadoLibreQuestions = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
    }

    const offsetNum = Math.max(0, parseInt((req.query.offset as string) || '0', 10) || 0);
    const limitNum = Math.min(50, Math.max(1, parseInt((req.query.limit as string) || '20', 10) || 20));
    const statusFilter = ((req.query.status as string) || '').toString().trim().toUpperCase();
    const allowedStatus = ['ANSWERED', 'UNANSWERED', 'BANNED', 'CLOSED_UNANSWERED', 'UNDER_REVIEW'];
    let dateFromRaw = ((req.query.date_from as string) || '').toString().trim();
    let dateToRaw = ((req.query.date_to as string) || '').toString().trim();
    const ymd = /^\d{4}-\d{2}-\d{2}$/;
    if (dateFromRaw && dateToRaw && ymd.test(dateFromRaw) && ymd.test(dateToRaw) && dateFromRaw > dateToRaw) {
      const t = dateFromRaw;
      dateFromRaw = dateToRaw;
      dateToRaw = t;
    }

    const params = new URLSearchParams({
      seller_id: String(mlToken.user_id),
      limit: String(limitNum),
      offset: String(offsetNum),
      /** Últimas primero (API ML) */
      sort_fields: 'date_created',
      sort_types: 'DESC',
    });
    if (statusFilter && allowedStatus.includes(statusFilter)) {
      params.set('status', statusFilter);
    }

    if (dateFromRaw && ymd.test(dateFromRaw)) {
      params.set('from', `${dateFromRaw}T00:00:00.000-03:00`);
    }
    if (dateToRaw && ymd.test(dateToRaw)) {
      params.set('to', `${dateToRaw}T23:59:59.999-03:00`);
    }

    const baseQs = params.toString();
    let r;
    try {
      r = await axios.get(`https://api.mercadolibre.com/questions/search?${baseQs}`, {
        headers: { Authorization: `Bearer ${mlToken.access_token}` },
      });
    } catch (first: any) {
      if (first?.response?.status === 400 && baseQs.includes('sort_fields')) {
        const fallback = new URLSearchParams(baseQs);
        fallback.delete('sort_fields');
        fallback.delete('sort_types');
        r = await axios.get(`https://api.mercadolibre.com/questions/search?${fallback.toString()}`, {
          headers: { Authorization: `Bearer ${mlToken.access_token}` },
        });
      } else {
        throw first;
      }
    }

    const data = r.data || {};
    const raw = Array.isArray(data.questions) ? data.questions : Array.isArray(data.results) ? data.results : [];

    const questions = raw
      .map((q: any) => ({
        id: q.id,
        text: q.text ?? '',
        status: q.status ?? '',
        itemId: q.item_id != null ? String(q.item_id) : null,
        itemTitle: q.item?.title ?? q.item_title ?? null,
        dateCreated: q.date_created ?? null,
        buyerNickname: q.buyer?.nickname ?? q.from?.nickname ?? null,
        answerText: q.answer?.text ?? null,
        answerDate: q.answer?.date_created ?? null,
      }))
      .sort((a: { dateCreated: string | null }, b: { dateCreated: string | null }) => {
        const ta = a.dateCreated ? new Date(a.dateCreated).getTime() : 0;
        const tb = b.dateCreated ? new Date(b.dateCreated).getTime() : 0;
        return tb - ta;
      });

    const ids = questions.map((q: { id: string | number }) => String(q.id));
    const suggestions = await mlQuestionsAi.getSuggestionsByQuestionIds(ids);
    const enriched = questions.map((q: { id: string | number }) => {
      const s = suggestions.get(String(q.id));
      if (!s || s.status !== 'pending') return q;
      return {
        ...q,
        aiSuggestion: {
          text: s.suggestionText,
          status: s.status,
          provider: s.llmProvider,
          updatedAt: s.updatedAt
        }
      };
    });

    res.json({
      questions: enriched,
      total: typeof data.total === 'number' ? data.total : questions.length,
      offset: typeof data.offset === 'number' ? data.offset : offsetNum,
      limit: typeof data.limit === 'number' ? data.limit : limitNum,
    });
  } catch (error: any) {
    const errData = error.response?.data;
    console.error('[ML Questions]', errData || error.message);
    const msg =
      (typeof errData?.message === 'string' && errData.message) ||
      (typeof errData?.error === 'string' && errData.error) ||
      error.message ||
      'Error al obtener preguntas de Mercado Libre';
    res.status(error.response?.status || 500).json({ message: msg });
  }
};

// Obtener órdenes de Mercado Libre
export const getMercadoLibreOrders = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
    }

    const { offset = '0', limit = '20', status, date_from, date_to, only_pending_shipment_and_cancelled } = req.query;
    const limitNum = Math.min(Math.max(1, parseInt(limit as string) || 20), 50);
    const offsetNum = Math.max(0, parseInt(offset as string) || 0);
    const onlyPendingAndCancelled = only_pending_shipment_and_cancelled === '1' || only_pending_shipment_and_cancelled === 'true';

    const mapOrder = (order: any) => {
      let shippingStatus = order._shipment_status ?? null;
      if (!shippingStatus && order.shipping) {
        shippingStatus = order.shipping.status || order.shipping.substatus || null;
        if (!shippingStatus && order.status === 'paid' && order.shipping.id) {
          shippingStatus = 'ready_to_ship';
        }
      }
      const statusMap: Record<string, string> = {
        'to_be_agreed': 'pending', 'pending': 'pending', 'handling': 'handling',
        'ready_to_ship': 'ready_to_ship', 'shipped': 'shipped', 'delivered': 'delivered',
        'not_delivered': 'not_delivered', 'cancelled': 'cancelled'
      };
      const logisticType = order.shipping?.logistic_type || null;
      const isFlex = logisticType === 'self_service';
      return {
        id: order.id,
        status: order.status,
        statusDetail: order.status_detail,
        total: order.total_amount,
        currency: order.currency_id,
        buyer: {
          id: order.buyer?.id,
          nickname: order.buyer?.nickname,
          firstName: order.buyer?.first_name,
          lastName: order.buyer?.last_name
        },
        items: (order.order_items || []).map((item: any) => ({
          id: item.item?.id,
          title: item.item?.title,
          sku: item.item?.seller_sku || item.item?.seller_custom_field,
          quantity: item.quantity,
          unitPrice: item.unit_price,
          variationId: item.item?.variation_id
        })),
        shipping: order.shipping ? {
          id: order.shipping.id,
          status: statusMap[shippingStatus] || shippingStatus || 'pending'
        } : null,
        isFlex,
        dateCreated: order.date_created,
        dateClosed: order.date_closed
      };
    };

    const groupMlOrdersByPurchase = (rows: any[]): any[] => {
      const groupKey = (o: any) => {
        const packId = String(o?.pack_id ?? '').trim();
        if (packId) return `pack:${packId}`;
        const buyerId = String(o?.buyer?.id ?? '').trim();
        const minute = String(o?.date_created || '').slice(0, 16);
        return `fallback:${buyerId}:${minute}`;
      };
      const groups = new Map<string, any[]>();
      for (const o of rows || []) {
        const key = groupKey(o);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(o);
      }
      return Array.from(groups.values()).map((group) => {
        const first = group[0];
        const orderIds = group.map((o: any) => o.id);
        const allItems = group.flatMap((o: any) => o.order_items || []);
        const totalAmount = group.reduce((acc: number, o: any) => acc + (Number(o?.total_amount) || 0), 0);
        const merged = {
          ...first,
          total_amount: totalAmount,
          order_ids: orderIds,
          order_items: allItems
        };
        if (first?._shipment_status) merged._shipment_status = first._shipment_status;
        return merged;
      });
    };

    let orders: any[];
    let total: number;

    if (onlyPendingAndCancelled) {
      // Solo "por enviar": órdenes pagadas cuyo shipment está en handling o ready_to_ship (API de Shipments)
      const baseParams = `seller=${mlToken.user_id}&limit=50&sort=date_desc`;
      const dateFrom = date_from ? `&order.date_created.from=${date_from}T00:00:00.000-03:00` : '';
      const dateTo = date_to ? `&order.date_created.to=${date_to}T23:59:59.999-03:00` : '';
      const paidRes = await axios.get(
        `https://api.mercadolibre.com/orders/search?${baseParams}&order.status=paid${dateFrom}${dateTo}`,
        { headers: { 'Authorization': `Bearer ${mlToken.access_token}` } }
      );
      const paid = paidRes.data.results || [];

      const POR_ENVIAR_STATUSES = ['handling', 'ready_to_ship'];
      const authHeader = { 'Authorization': `Bearer ${mlToken.access_token}`, 'x-format-new': 'true' };

      const getShipmentId = async (order: any): Promise<number | null> => {
        const ship = order.shipping || order.shipment;
        if (ship?.id) return ship.id;
        try {
          const det = await axios.get(`https://api.mercadolibre.com/orders/${order.id}`, {
            headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
          });
          const s = det.data?.shipping || det.data?.shipment;
          return s?.id ?? null;
        } catch {
          return null;
        }
      };

      const getShipmentStatus = async (shipmentId: number): Promise<string | null> => {
        try {
          const res = await axios.get(`https://api.mercadolibre.com/shipments/${shipmentId}`, {
            headers: authHeader
          });
          const data = res.data || {};
          const st = (data.status ?? data.substatus ?? '').toString().trim().toLowerCase();
          return st || null;
        } catch {
          try {
            const res = await axios.get(`https://api.mercadolibre.com/marketplace/shipments/${shipmentId}`, {
              headers: authHeader
            });
            const data = res.data || {};
            const st = (data.status ?? data.substatus ?? '').toString().trim().toLowerCase();
            return st || null;
          } catch {
            return null;
          }
        }
      };

      const BATCH = 5;
      const ordersPorEnviar: any[] = [];
      for (let i = 0; i < paid.length; i += BATCH) {
        const batch = paid.slice(i, i + BATCH);
        const shipmentIds = await Promise.all(batch.map(getShipmentId));
        const statuses = await Promise.all(
          shipmentIds.map((id) => (id ? getShipmentStatus(id) : Promise.resolve(null)))
        );
        batch.forEach((order: any, idx: number) => {
          const st = statuses[idx];
          if (st && POR_ENVIAR_STATUSES.includes(st)) {
            order._shipment_status = st;
            ordersPorEnviar.push(order);
          }
        });
      }

      ordersPorEnviar.sort((a, b) => new Date(b.date_created).getTime() - new Date(a.date_created).getTime());

      const groupedOrders = groupMlOrdersByPurchase(ordersPorEnviar);

      total = groupedOrders.length;
      orders = groupedOrders.slice(offsetNum, offsetNum + limitNum).map((o: any) => {
        const mapped = mapOrder(o);
        if (o.order_ids && o.order_ids.length > 1) {
          (mapped as any).orderIds = o.order_ids;
        }
        return mapped;
      });
    } else {
      const allRaw: any[] = [];
      const fetchLimit = 50;
      let fetchOffset = 0;
      while (fetchOffset <= 5000) {
        let url = `https://api.mercadolibre.com/orders/search?seller=${mlToken.user_id}&offset=${fetchOffset}&limit=${fetchLimit}&sort=date_desc`;
        if (status) url += `&order.status=${status}`;
        if (date_from) url += `&order.date_created.from=${date_from}T00:00:00.000-03:00`;
        if (date_to) url += `&order.date_created.to=${date_to}T23:59:59.999-03:00`;
        const ordersRes = await axios.get(url, {
          headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
        });
        const batch = ordersRes.data.results || [];
        if (!batch.length) break;
        allRaw.push(...batch);
        if (batch.length < fetchLimit) break;
        fetchOffset += fetchLimit;
      }

      const grouped = groupMlOrdersByPurchase(allRaw);
      total = grouped.length;
      orders = grouped.slice(offsetNum, offsetNum + limitNum).map((o: any) => {
        const mapped = mapOrder(o);
        if (o.order_ids && o.order_ids.length > 1) {
          (mapped as any).orderIds = o.order_ids;
        }
        return mapped;
      });
    }

    // Marcar si las órdenes ML del response ya están facturadas.
    const externalIdsFlat = Array.from(new Set((orders as any[]).flatMap((o: any) => {
      const ids = Array.isArray(o.orderIds) && o.orderIds.length > 0 ? o.orderIds : [o.id];
      return (ids || []).map((id: any) => String(id)).filter(Boolean);
    })));
    if (externalIdsFlat.length > 0) {
      const placeholders = externalIdsFlat.map(() => '?').join(', ');
      const invoicedRows = await query(
        `SELECT id, external_order_id, cae, cbte_tipo, cbte_desde, created_at
         FROM external_invoices
         WHERE source = 'MERCADOLIBRE' AND external_order_id IN (${placeholders})`,
        externalIdsFlat
      ) as any[];
      const byExternalId = new Map<string, any>();
      for (const row of invoicedRows) byExternalId.set(String(row.external_order_id), row);
      orders = (orders as any[]).map((o: any) => {
        const ids = Array.isArray(o.orderIds) && o.orderIds.length > 0 ? o.orderIds : [o.id];
        const invMatches = ids.map((id: any) => byExternalId.get(String(id))).filter(Boolean);
        const fullyInvoiced = ids.length > 0 && invMatches.length === ids.length;
        const inv = invMatches[0];
        return {
          ...o,
          invoiced: fullyInvoiced,
          invoicedCount: invMatches.length,
          totalOrderIds: ids.length,
          invoice: inv ? {
            id: inv.id,
            cae: inv.cae,
            cbteTipo: inv.cbte_tipo,
            cbteDesde: inv.cbte_desde,
            createdAt: inv.created_at
          } : undefined
        };
      });
    }

    res.json({
      orders,
      offset: offsetNum,
      limit: limitNum,
      total
    });
  } catch (error: any) {
    console.error('Error fetching ML orders:', error.response?.data || error.message);
    res.status(500).json({ message: 'Error obteniendo órdenes de Mercado Libre', error: error.message });
  }
};

// Totales de stock Mercado Libre (todas las publicaciones, para las cards)
export const getMercadoLibreStockTotals = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
    }
    const limit = 50;
    let offset = 0;
    let totalProducts = 0;
    let totalStock = 0;
    let lowStockCount = 0;
    let noStockCount = 0;
    while (true) {
      const itemsRes = await axios.get(
        `https://api.mercadolibre.com/users/${mlToken.user_id}/items/search?status=active&offset=${offset}&limit=${limit}`,
        { headers: { 'Authorization': `Bearer ${mlToken.access_token}` } }
      );
      const itemIds: string[] = itemsRes.data.results || [];
      if (itemIds.length === 0) break;
      const batchSize = 10;
      for (let i = 0; i < itemIds.length; i += batchSize) {
        const batch = itemIds.slice(i, i + batchSize);
        const results = await Promise.all(batch.map((id: string) =>
          axios.get(`https://api.mercadolibre.com/items/${id}?include_attributes=all`, { headers: { 'Authorization': `Bearer ${mlToken.access_token}` } }).then(r => r.data).catch(() => null)
        ));
        for (const item of results) {
          if (!item) continue;
          let productStock = 0;
          if (item.variations?.length) {
            productStock = (item.variations as any[]).reduce((s, v) => s + (v.available_quantity || 0), 0);
          } else {
            productStock = item.available_quantity || 0;
          }
          totalProducts += 1;
          totalStock += productStock;
          if (productStock === 0) noStockCount += 1;
          else if (productStock < 5) lowStockCount += 1;
        }
      }
      if (itemIds.length < limit) break;
      offset += limit;
      if (offset >= 10000) break;
    }
    res.json({ totalProducts, totalStock, lowStockCount, noStockCount });
  } catch (error: any) {
    console.error('Error fetching ML stock totals:', error.response?.data || error.message);
    res.status(500).json({ message: 'Error obteniendo totales de Mercado Libre', error: error.message });
  }
};

// Obtener stock de Mercado Libre
/** Normaliza título para agrupar: quita espacios de más y unifica. */
function mlNormalizeTitle(title: string): string {
  return (title || '').trim().replace(/\s+/g, ' ');
}

/** Registra una publicación ML en variant_publications (sincronización de stock). */
async function registerMercadoLibrePublication(
  variantId: string,
  mlItemId: string,
  mlVariationId: string | number | null = null,
  mlPack = 1
): Promise<void> {
  const productId = String(mlItemId || '').trim();
  if (!productId || !variantId) return;
  const extVarId = mlVariationId != null && String(mlVariationId).trim() !== '' ? String(mlVariationId).trim() : '';
  await execute(
    `INSERT INTO variant_publications (id, variant_id, platform, external_product_id, external_variant_id, pack_size)
     VALUES (?, ?, 'mercadolibre', ?, ?, ?)
     ON DUPLICATE KEY UPDATE pack_size = VALUES(pack_size)`,
    [uuidv4(), variantId, productId, extVarId, Math.max(1, mlPack)]
  );
}

/** Crea o reutiliza variante local y vincula una o más publicaciones ML del mismo color/talle. */
async function upsertLocalVariantFromMlEntries(
  productId: string,
  baseSku: string,
  entries: { sku: string; color: string; size: string; stock: number; mlItemId?: string | null; variationId?: string | number | null }[]
): Promise<{ variantId: string; created: boolean }> {
  const v = entries[0];
  const sizeCode = (v.size || 'U').toString().trim() || 'U';
  const colorCode = (v.color || 'Único').toString().trim() || 'Único';
  const sizeId = await ensureSize(sizeCode);
  const colorId = await ensureColor(colorCode);
  let productColorId = (await get(`SELECT id FROM product_colors WHERE product_id = ? AND color_id = ?`, [productId, colorId]))?.id;
  if (!productColorId) {
    productColorId = uuidv4();
    await execute(`INSERT INTO product_colors (id, product_id, color_id) VALUES (?, ?, ?)`, [productColorId, productId, colorId]);
  }
  const existingVariant = await get(`SELECT id FROM product_variants WHERE product_color_id = ? AND size_id = ?`, [productColorId, sizeId]);
  let variantId = existingVariant?.id as string | undefined;
  let created = false;
  if (!variantId) {
    variantId = uuidv4();
    const variantSku = v.sku || `${baseSku}-${sizeCode}-${colorCode}`;
    const primary = entries.find((e) => e.mlItemId) || v;
    const mlItemId = primary.mlItemId ? String(primary.mlItemId).trim() : null;
    const mlVarId = primary.variationId != null && String(primary.variationId) !== String(mlItemId || '')
      ? String(primary.variationId)
      : null;
    await execute(
      `INSERT INTO product_variants (id, product_color_id, size_id, sku, mercado_libre_variant_id, mercado_libre_item_id) VALUES (?, ?, ?, ?, ?, ?)`,
      [variantId, productColorId, sizeId, variantSku, mlVarId, mlItemId]
    );
    await execute(
      `INSERT INTO stocks (variant_id, stock) VALUES (?, ?) ON DUPLICATE KEY UPDATE stock = VALUES(stock)`,
      [variantId, v.stock]
    );
    created = true;
  }
  for (const e of entries) {
    const itemId = e.mlItemId ? String(e.mlItemId).trim() : '';
    if (!itemId) continue;
    const varId = e.variationId != null && String(e.variationId) !== itemId ? e.variationId : null;
    await registerMercadoLibrePublication(variantId, itemId, varId);
  }
  return { variantId, created };
}

/** Extrae título base para agrupar: quita las últimas 1–2 palabras (talle y opcionalmente color). */
export function mlBaseTitle(title: string): string {
  let t = mlStripTrailingPublicationIndex(mlNormalizeTitle(title));
  // Algunos títulos traen sufijos de publicación (p.ej. "Sin cuotas") que rompen el
  // agrupado por color/talle. Esto los elimina para recuperar el "título base".
  t = t
    .replace(/(?:^|\s)(?:sin|s\/c)\s*[-]?\s*cuotas?\s*[.,;:]?\s*$/i, '')
    .replace(/(?:^|\s)con\s*[-]?\s*cuotas?\s*[.,;:]?\s*$/i, '')
    .replace(/(?:^|\s)\d+\s*[-]?\s*cuotas?\s*[.,;:]?\s*$/i, '')
    .trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return t;
  const last = words[words.length - 1];
  const secondLast = words[words.length - 2];
  const sizeLike = /^(P|M|G|GG|XG|XXG|XXXG|U|Único|\d{2,3})$/i;
  const colorLike = /^(blanco|negro|rojo|azul|verde|gris|rosa|nude|beige|celeste|amarillo|bordo|marron|multicolor)$/i;
  if (sizeLike.test(last) && words.length >= 2) {
    if (colorLike.test(secondLast)) return words.slice(0, -2).join(' ');
    return words.slice(0, -1).join(' ');
  }
  // Si el último no es talle, puede ser solo color (ej. "... Nude") o título sin variante al final
  if (colorLike.test(last) && words.length >= 1) return words.slice(0, -1).join(' ');
  return t;
}

/** Quita sufijos de numeración de publicación (ej. "... Negro 1", "... #2", "... N° 3"). */
export function mlStripTrailingPublicationIndex(title: string): string {
  return (title || '')
    .replace(/\s*(?:#|N°|Nº)?\s*\d{1,2}\s*$/i, '')
    .trim();
}

/** Extrae color y talle del final del título (ej. "... Blanco G" -> color: Blanco, size: G). */
export function mlColorSizeFromTitle(title: string): { color: string; size: string } {
  let t = mlStripTrailingPublicationIndex(mlNormalizeTitle(title));
  t = t
    .replace(/(?:^|\s)(?:sin|s\/c)\s*[-]?\s*cuotas?\s*[.,;:]?\s*$/i, '')
    .replace(/(?:^|\s)con\s*[-]?\s*cuotas?\s*[.,;:]?\s*$/i, '')
    .replace(/(?:^|\s)\d+\s*[-]?\s*cuotas?\s*[.,;:]?\s*$/i, '')
    .trim();

  const words = t.split(/\s+/).filter(Boolean);
  const colorLike = /^(blanco|negro|rojo|azul|verde|gris|rosa|nude|beige|celeste|amarillo|bordo|marron|multicolor)$/i;
  const sizeLike = /^(P|M|G|GG|XG|XXG|XXXG|U|Único|\d{2,3})$/i;
  if (words.length >= 2 && sizeLike.test(words[words.length - 1])) {
    const size = words[words.length - 1];
    const color = colorLike.test(words[words.length - 2]) ? words[words.length - 2] : '';
    return { color, size };
  }
  // Si el último token es color pero no hay talle, devolver color y un talle vacío.
  if (words.length >= 1 && colorLike.test(words[words.length - 1])) {
    return { color: words[words.length - 1] || '', size: '' };
  }
  if (words.length >= 1) return { color: '', size: words[words.length - 1] || '' };
  return { color: '', size: '' };
}

export const getMercadoLibreStock = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
    }

    const { status = 'active', offset = '0', limit = '50' } = req.query;

    // Obtener lista de items del vendedor
    const itemsUrl = `https://api.mercadolibre.com/users/${mlToken.user_id}/items/search?status=${status}&offset=${offset}&limit=${limit}`;
    const itemsRes = await axios.get(itemsUrl, {
      headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
    });

    const itemIds = itemsRes.data.results || [];
    
    if (itemIds.length === 0) {
      return res.json({ items: [], total: 0 });
    }

    // Obtener detalles completos de cada item (necesario para variaciones con atributos)
    let items: any[] = [];
    
    // Procesar en paralelo pero limitado a 10 concurrent requests
    const batchSize = 10;
    for (let i = 0; i < itemIds.length; i += batchSize) {
      const batch = itemIds.slice(i, i + batchSize);
      
      const itemPromises = batch.map(async (itemId: string) => {
        try {
          const itemRes = await axios.get(`https://api.mercadolibre.com/items/${itemId}?include_attributes=all`, {
            headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
          });
          return itemRes.data;
        } catch (e) {
          console.error(`Error fetching item ${itemId}:`, e);
          return null;
        }
      });

      const batchResults = await Promise.all(itemPromises);
      
      for (const item of batchResults) {
        if (!item) continue;
        
        // Si tiene variaciones, obtener stock por variación (una sola publicación con varias variantes)
        if (item.variations && item.variations.length > 0) {
          let totalStock = 0;
          const variations = item.variations.map((v: any) => {
            totalStock += v.available_quantity || 0;
            const skuAttr = Array.isArray(v.attributes) && v.attributes.find((a: any) => (a.id || '').toString().toUpperCase() === 'SELLER_SKU');
            const skuFromAttr = skuAttr ? (skuAttr.value_name ?? skuAttr.value ?? '').toString().trim() : '';
            const sku = skuFromAttr || (v.seller_sku ?? v.seller_custom_field ?? '').toString().trim();
            let color = '';
            let size = '';
            (v.attribute_combinations || []).forEach((attr: any) => {
              const id = (attr.id || '').toString().toUpperCase();
              const name = (attr.value_name || attr.name || '').toString().trim();
              if (id === 'COLOR' || id === 'COLOUR' || id === 'COR') color = name;
              if (id === 'SIZE' || id === 'SIZE_TYPE' || id === 'TALLE' || id === 'Talla') size = name;
            });

            return {
              variationId: v.id,
              sku,
              color,
              size,
              stock: v.available_quantity || 0,
              sold: v.sold_quantity || 0
            };
          });

          items.push({
            id: item.id,
            title: item.title,
            status: item.status,
            price: item.price,
            totalStock,
            soldTotal: item.sold_quantity || 0,
            dateCreated: item.date_created || item.start_time || null,
            thumbnail: item.thumbnail,
            permalink: item.permalink,
            hasVariations: true,
            variations
          });
        } else {
          // Sin variaciones en la API: puede ser una publicación por variante (mismo producto, varios ítems). Se agrupa después.
          let itemSku = (item.seller_sku ?? item.seller_custom_field ?? '').toString().trim();
          if (!itemSku && Array.isArray(item.attributes)) {
            const skuAttr = item.attributes.find((a: any) => (a.id || '').toString().toUpperCase() === 'SELLER_SKU');
            if (skuAttr) itemSku = (skuAttr.value_name ?? skuAttr.value ?? '').toString().trim();
          }
          if (!itemSku && item.variations && item.variations.length === 1) {
            const v0 = item.variations[0];
            const skuAttr = Array.isArray(v0.attributes) && v0.attributes.find((a: any) => (a.id || '').toString().toUpperCase() === 'SELLER_SKU');
            itemSku = (skuAttr ? (skuAttr.value_name ?? skuAttr.value ?? '') : (v0.seller_sku ?? v0.seller_custom_field ?? '')).toString().trim();
          }
          items.push({
            id: item.id,
            title: item.title,
            status: item.status,
            price: item.price,
            totalStock: item.available_quantity || 0,
            soldTotal: item.sold_quantity || 0,
            dateCreated: item.date_created || item.start_time || null,
            thumbnail: item.thumbnail,
            permalink: item.permalink,
            hasVariations: false,
            variations: [],
            sku: itemSku || undefined
          });
        }
      }
    }

    // Agrupar ítems que son la misma publicación por variante (mismo título base, ej. "... 40900 Blanco G" -> base "... 40900")
    const withVariations = items.filter((i: any) => i.hasVariations && i.variations && i.variations.length > 0);
    const withoutVariations = items.filter((i: any) => !i.hasVariations || !i.variations || i.variations.length === 0);
    const byBaseKey: Record<string, { baseTitle: string; list: typeof withoutVariations }> = {};
    for (const it of withoutVariations) {
      const baseTitle = mlBaseTitle(it.title);
      const key = baseTitle.toLowerCase().replace(/\s+/g, ' ').trim();
      if (!byBaseKey[key]) byBaseKey[key] = { baseTitle, list: [] };
      byBaseKey[key].list.push(it);
    }
    const grouped: any[] = [];
    for (const _key of Object.keys(byBaseKey)) {
      const { baseTitle, list: group } = byBaseKey[_key];
      if (group.length === 0) continue;
      if (group.length === 1) {
        grouped.push(group[0]);
        continue;
      }
      const first = group[0];
      const variations = group.map((it: any) => {
        const { color, size } = mlColorSizeFromTitle(it.title);
        const sku = (it.sku != null && it.sku !== '') ? it.sku : '';
        return {
          variationId: it.id,
          sku,
          color,
          size,
          stock: it.totalStock || 0,
          sold: it.soldTotal || 0
        };
      });
      const totalStock = group.reduce((s: number, it: any) => s + (it.totalStock || 0), 0);
      const soldTotal = group.reduce((s: number, it: any) => s + (it.soldTotal || 0), 0);
      grouped.push({
        id: first.id,
        title: baseTitle,
        status: first.status,
        price: first.price,
        totalStock,
        soldTotal,
        dateCreated: first.dateCreated || null,
        thumbnail: first.thumbnail,
        permalink: first.permalink,
        hasVariations: true,
        variations
      });
    }
    items = [...withVariations, ...grouped];

    res.json({
      items,
      total: itemsRes.data.paging?.total ?? items.length,
      offset: parseInt(offset as string),
      limit: parseInt(limit as string)
    });
  } catch (error: any) {
    console.error('Error fetching ML stock:', error.response?.data || error.message);
    res.status(500).json({ message: 'Error obteniendo stock de Mercado Libre', error: error.message });
  }
};

// Obtener variaciones de un ítem de Mercado Libre por ID (para vincular por ID padre)
export const getMercadoLibreItemVariations = async (req: Request, res: Response) => {
  try {
    let { itemId } = req.params;
    if (!itemId) {
      return res.status(400).json({ message: 'Falta itemId' });
    }
    const requestedNormalized = normalizeMercadoLibreItemId(String(itemId || ''));
    const shouldResolveAsUserProduct = /^MLAU\d+$/i.test(requestedNormalized);
    const candidates = mercadoLibreItemIdCandidates(itemId);
    if (candidates.length === 0) return res.status(400).json({ message: 'ID de publicación ML inválido' });

    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre' });
    }
    let item: any = null;
    let resolvedItemId = '';
    let catalogItemCandidates: string[] = [];
    let userProductItemCandidates: string[] = [];
    let userProductResolveDebug: any = null;
    const triedCandidates = [...candidates];
    for (const candidate of candidates) {
      try {
        const itemRes = await axios.get(`https://api.mercadolibre.com/items/${candidate}?include_attributes=all`, {
          headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
        });
        if (itemRes?.data && !itemRes.data.error) {
          item = itemRes.data;
          resolvedItemId = candidate;
          break;
        }
      } catch {
        // probar siguiente candidato
      }
    }
    // Catálogo /p/MLA...: siempre intentar listar todas las publicaciones hijas (cada color suele ser un ítem).
    catalogItemCandidates = await resolveMercadoLibreCatalogProductItems(String(req.params.itemId || ''), mlToken.access_token);
    if (!item || item.error) {
      for (const candidate of catalogItemCandidates) {
        if (!triedCandidates.includes(candidate)) triedCandidates.push(candidate);
        try {
          const itemRes = await axios.get(`https://api.mercadolibre.com/items/${candidate}?include_attributes=all`, {
            headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
          });
          if (itemRes?.data && !itemRes.data.error) {
            item = itemRes.data;
            resolvedItemId = candidate;
            break;
          }
        } catch {
          // probar siguiente candidato
        }
      }
    }
    // Intentar resolver como user_product_id (UP), ej. MLAU...
    // Se ejecuta también cuando /items/{id} responde, porque para MLAU puede devolver
    // una vista incompleta y necesitamos expandir a todos los items reales asociados.
    if (!item || item.error || shouldResolveAsUserProduct) {
      const upResolved = await resolveMercadoLibreUserProductItems(
        String(req.params.itemId || ''),
        mlToken.user_id,
        mlToken.access_token
      );
      userProductItemCandidates = upResolved.itemCandidates;
      userProductResolveDebug = upResolved.debug;
      for (const candidate of userProductItemCandidates) {
        if (!triedCandidates.includes(candidate)) triedCandidates.push(candidate);
        try {
          const itemRes = await axios.get(`https://api.mercadolibre.com/items/${candidate}?include_attributes=all`, {
            headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
          });
          if (itemRes?.data && !itemRes.data.error) {
            item = itemRes.data;
            resolvedItemId = candidate;
            break;
          }
        } catch {
          // probar siguiente candidato
        }
      }
    }
    if (!item || item.error) {
      return res.status(404).json({
        message: 'Publicación no encontrada en Mercado Libre',
        tried: triedCandidates,
        debug: shouldResolveAsUserProduct ? { userProduct: userProductResolveDebug } : undefined
      });
    }

    const catalogFromPermalink = catalogProductIdFromMercadoLibreItem(item);
    const itemUserProductId = (item?.user_product_id ?? '').toString().trim();
    if (catalogFromPermalink && catalogItemCandidates.length === 0) {
      catalogItemCandidates = await resolveMercadoLibreCatalogProductItems(catalogFromPermalink, mlToken.access_token);
    }
    if (/^MLAU\d+$/i.test(itemUserProductId) && userProductItemCandidates.length === 0) {
      const upResolved = await resolveMercadoLibreUserProductItems(
        itemUserProductId,
        mlToken.user_id,
        mlToken.access_token
      );
      userProductItemCandidates = upResolved.itemCandidates;
      userProductResolveDebug = upResolved.debug;
    }

    const singleItemVariations = extractMlVariationsFromItemData(
      await enrichMercadoLibreItemVariationsForCatalog(item, mlToken.access_token)
    );
    const requestRaw = String(req.params.itemId || '');
    const requestLooksLikeCatalog =
      /\/p\/MLA/i.test(requestRaw) ||
      shouldResolveAsUserProduct ||
      /^MLAU\d+$/i.test(requestedNormalized);
    const itemHasVariationArray = Array.isArray(item.variations) && item.variations.length > 0;

    // Publicación única con item.variations: usar solo ese ítem (evita 4×N duplicados al mezclar hermanos/UP).
    if (itemHasVariationArray && singleItemVariations.length > 0 && !requestLooksLikeCatalog) {
      return res.json({
        variations: singleItemVariations,
        singleProduct: singleItemVariations.length === 1,
        itemId: item.id,
        requestedItemId: requestRaw,
        resolvedItemId,
        resolvedFromItemVariationsOnly: true
      });
    }

    const allItemIds = await gatherMercadoLibreItemIdsForAllVariations({
      requestedRaw: String(req.params.itemId || ''),
      requestedNormalized,
      shouldResolveAsUserProduct,
      resolvedItemId,
      item,
      sellerId: mlToken.user_id,
      accessToken: mlToken.access_token,
      preloadedCatalogIds: catalogItemCandidates,
      preloadedUserProductIds: userProductItemCandidates
    });
    const distinctItemIds = new Set(allItemIds.map((id) => normalizeMercadoLibreItemId(id)));
    const familyNameOnItem = mlFamilyNameFromItem(item);
    const shouldAggregateMulti =
      shouldResolveAsUserProduct ||
      Boolean(catalogFromPermalink) ||
      /^MLAU\d+$/i.test(itemUserProductId) ||
      Boolean(familyNameOnItem) ||
      item?.catalog_listing === true ||
      distinctItemIds.size > 1 ||
      catalogItemCandidates.length > 1 ||
      userProductItemCandidates.length > 1;

    const buildAggregatedResponse = (aggregated: MlVariationRow[], extraDebug: Record<string, unknown> = {}) => {
      const distinctColors = new Set(aggregated.map((v) => v.color.toLowerCase().trim()).filter(Boolean));
      return res.json({
        variations: aggregated,
        singleProduct: false,
        itemId: item.id,
        requestedItemId: String(req.params.itemId || ''),
        resolvedItemId,
        resolvedFromMultiListing: true,
        debug: {
          userProduct: userProductResolveDebug,
          itemIdsCount: distinctItemIds.size,
          variationCount: aggregated.length,
          colorCount: distinctColors.size,
          familyName: familyNameOnItem || undefined,
          ...extraDebug
        }
      });
    };

    if (shouldAggregateMulti && allItemIds.length > 0) {
      let aggregated = await aggregateMercadoLibreVariationsFromItemIds(allItemIds, mlToken.access_token);
      const distinctColors = new Set(aggregated.map((v) => v.color.toLowerCase().trim()).filter(Boolean));
      const distinctSizes = new Set(aggregated.map((v) => v.size.toLowerCase().trim()).filter(Boolean));

      // Si solo aparece un color, ampliar por family_name o prefijo SKU del artículo.
      if (distinctColors.size <= 1) {
        const extraIds = new Set(allItemIds.map((id) => normalizeMercadoLibreItemId(id)));
        if (familyNameOnItem) {
          for (const id of await resolveMercadoLibreItemsByFamilyName(familyNameOnItem, mlToken.user_id, mlToken.access_token)) {
            extraIds.add(normalizeMercadoLibreItemId(id));
          }
        }
        const skuPrefixes = new Set<string>();
        for (const sku of collectMercadoLibreItemSkus(item)) {
          const prefix = extractArticlePrefixFromMlSku(sku);
          if (prefix) skuPrefixes.add(prefix);
        }
        for (const row of aggregated) {
          const prefix = extractArticlePrefixFromMlSku(row.sku);
          if (prefix) skuPrefixes.add(prefix);
        }
        for (const prefix of skuPrefixes) {
          for (const id of await resolveMercadoLibreItemsByArticlePrefix(prefix, mlToken.user_id, mlToken.access_token)) {
            extraIds.add(normalizeMercadoLibreItemId(id));
          }
        }
        if (extraIds.size > distinctItemIds.size) {
          aggregated = await aggregateMercadoLibreVariationsFromItemIds(Array.from(extraIds), mlToken.access_token);
        }
      }

      const finalColors = new Set(aggregated.map((v) => v.color.toLowerCase().trim()).filter(Boolean));
      const finalSizes = new Set(aggregated.map((v) => v.size.toLowerCase().trim()).filter(Boolean));
      const moreThanSingleItem =
        aggregated.length > singleItemVariations.length ||
        finalColors.size > 1 ||
        finalSizes.size > 1;
      if (aggregated.length > 0 && (moreThanSingleItem || distinctItemIds.size > 1 || finalColors.size > 1)) {
        return buildAggregatedResponse(aggregated);
      }
    }

    if (
      singleItemVariations.length > 0 &&
      distinctItemIds.size <= 1 &&
      catalogItemCandidates.length <= 1 &&
      !catalogFromPermalink &&
      !/^MLAU\d+$/i.test(itemUserProductId) &&
      !familyNameOnItem &&
      item?.catalog_listing !== true
    ) {
      return res.json({
        variations: singleItemVariations,
        singleProduct: singleItemVariations.length === 1,
        itemId: item.id,
        requestedItemId: String(req.params.itemId || ''),
        resolvedItemId
      });
    }
    // Caso catálogo: no hay item.variations pero sí múltiples items hijos (cada uno una "variante").
    if (catalogItemCandidates.length > 1) {
      const toAttrArray = (x: any) => (Array.isArray(x) ? x : []);
      const fromAttrs = (attrs: any[], ids: string[]) => {
        const wanted = ids.map(v => v.toUpperCase());
        const hit = attrs.find((a: any) => wanted.includes((a?.id || '').toString().toUpperCase()));
        return (hit?.value_name ?? hit?.value ?? '').toString().trim();
      };
      const byItemId: Record<string, any> = {};
      for (const candidate of catalogItemCandidates.slice(0, 120)) {
        try {
          const itemRes = await axios.get(`https://api.mercadolibre.com/items/${candidate}?include_attributes=all`, {
            headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
          });
          const d = itemRes?.data;
          if (d?.id && !byItemId[d.id]) byItemId[d.id] = d;
        } catch {
          // ignorar item inválido y seguir
        }
      }
      const catalogVariations = Object.values(byItemId).map((it: any) => {
        const attrs = toAttrArray(it.attributes);
        const sku = (it.seller_sku ?? it.seller_custom_field ?? fromAttrs(attrs, ['SELLER_SKU'])).toString().trim();
        const colorFromAttr = fromAttrs(attrs, ['COLOR', 'COLOUR', 'COR']);
        const sizeFromAttr = fromAttrs(attrs, ['SIZE', 'SIZE_TYPE', 'TALLE', 'TALLA']);
        const titleParsed = mlColorSizeFromTitle((it.title || '').toString().trim());
        const color = colorFromAttr || titleParsed.color || '';
        const size = sizeFromAttr || titleParsed.size || '';
        return {
          variationId: it.id,
          itemId: String(it.id || ''),
          sku,
          color,
          size,
          stock: it.available_quantity || 0
        };
      });
      if (catalogVariations.length > 1) {
        return res.json({
          variations: dedupeMlVariationRows(catalogVariations),
          singleProduct: false,
          itemId: item.id,
          requestedItemId: String(req.params.itemId || ''),
          resolvedItemId,
          resolvedFromCatalog: true
        });
      }
    }
    // Fallback: publicaciones hermanas por título (cada talle/color en su propia MLA).
    {
      const baseTitle = mlBaseTitle((item.title || '').toString().trim());
      const baseTitleLoose = mlStripTrailingPublicationIndex(baseTitle);
      const siblingIds = await findMercadoLibreSiblingListingIds(item, mlToken.user_id, mlToken.access_token);
      if (siblingIds.length > 0) {
        const siblingRows: MlVariationRow[] = [];
        const siblings = await Promise.all(
          siblingIds.map(async (sid) => {
            try {
              const r = await axios.get(`https://api.mercadolibre.com/items/${sid}?include_attributes=all`, {
                headers: { Authorization: `Bearer ${mlToken.access_token}` }
              });
              return r.data;
            } catch {
              return null;
            }
          })
        );
        for (const it of siblings) {
          if (!it || it.error) continue;
          const siblingBase = mlBaseTitle((it.title || '').toString().trim());
          const siblingLoose = mlStripTrailingPublicationIndex(siblingBase);
          if (baseTitle && siblingBase !== baseTitle && baseTitleLoose && siblingLoose !== baseTitleLoose) continue;
          siblingRows.push(...extractMlVariationsFromItemData(it));
        }
        const merged = [...singleItemVariations];
        const seenVid = new Set(merged.map((v) => v.variationId));
        for (const row of siblingRows) {
          if (!seenVid.has(row.variationId)) {
            seenVid.add(row.variationId);
            merged.push(row);
          }
        }
        const mergedDeduped = dedupeMlVariationRows(merged);
        if (mergedDeduped.length > singleItemVariations.length) {
          return res.json({
            variations: mergedDeduped,
            singleProduct: false,
            itemId: item.id,
            requestedItemId: String(req.params.itemId || ''),
            resolvedItemId,
            resolvedFromSiblingSearch: true
          });
        }
      }
    }
    // Sin variaciones: producto único
    const parsed = mlColorSizeFromTitle((item.title || '').toString().trim());
    let singleSku = (item.seller_sku ?? item.seller_custom_field ?? '').toString().trim();
    if (!singleSku && Array.isArray(item.attributes)) {
      const skuAttr = item.attributes.find((a: any) => (a?.id || '').toString().toUpperCase() === 'SELLER_SKU');
      singleSku = (skuAttr ? (skuAttr.value_name ?? skuAttr.value ?? '') : '').toString().trim();
    }
    return res.json({
      variations: [{
        variationId: item.id,
        itemId: String(item.id || ''),
        sku: singleSku,
        color: parsed.color || '',
        size: parsed.size || '',
        stock: item.available_quantity || 0
      }],
      singleProduct: true,
      itemId: item.id,
      requestedItemId: String(req.params.itemId || ''),
      resolvedItemId
    });
  } catch (error: any) {
    const status = error.response?.status;
    const detail = error.response?.data?.message || error.message;
    console.error('Error fetching ML item variations:', detail);
    res.status(status === 404 ? 404 : 500).json({ message: 'Error obteniendo variaciones de Mercado Libre', detail });
  }
};

// Obtener variantes de un producto de Tienda Nube por ID (para vincular por ID padre)
export const getTiendaNubeProductVariants = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    if (!productId) {
      return res.status(400).json({ message: 'Falta productId' });
    }
    const integration = await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
    if (!integration?.access_token) {
      return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
    }
    const storeId = integration.store_id || integration.user_id;
    if (!storeId) {
      return res.status(400).json({ message: 'No se encontró store_id de Tienda Nube' });
    }
    const headers = {
      'Authentication': `bearer ${integration.access_token}`,
      'User-Agent': TN_USER_AGENT,
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    };
    const cacheBust = Date.now();

    const productRes = await axios.get(`https://api.tiendanube.com/v1/${storeId}/products/${productId}`, {
      headers,
      params: { _: cacheBust },
      validateStatus: () => true,
    });
    if (productRes.status !== 200) {
      const errMsg = (productRes.data && (productRes.data.description || productRes.data.message)) || productRes.statusText;
      return res.status(productRes.status >= 400 ? 404 : 502).json({ message: 'Producto no encontrado en Tienda Nube', detail: errMsg });
    }
    const p = productRes.data;
    const attrs = Array.isArray(p?.attributes) ? p.attributes : [];
    const isSizeAttr = (name: string) => /talle|talla|size|tamano|tamaño/i.test(name);
    const isColorAttr = (name: string) => /color|colour|cor/i.test(name);
    let sizeIdx = -1;
    let colorIdx = -1;
    attrs.forEach((a: any, i: number) => {
      const n = (a?.es ?? a?.en ?? a?.pt ?? '').toString();
      if (isSizeAttr(n)) sizeIdx = i;
      if (isColorAttr(n)) colorIdx = i;
    });

    // Paginar variantes: la API devuelve por defecto una cantidad limitada por página
    let variantsList: any[] = [];
    const perPage = 200;
    let vPage = 1;
    let hasMoreVariants = true;
    while (hasMoreVariants) {
      const variantsRes = await axios.get(
        `https://api.tiendanube.com/v1/${storeId}/products/${productId}/variants`,
        { headers, params: { page: vPage, per_page: perPage, _: cacheBust }, validateStatus: () => true }
      );
      const chunk = variantsRes.status === 200 && Array.isArray(variantsRes.data) ? variantsRes.data : [];
      variantsList = variantsList.concat(chunk);
      if (chunk.length < perPage) hasMoreVariants = false;
      else vPage++;
      if (vPage > 50) hasMoreVariants = false; // seguridad: máx 50 páginas = 10.000 variantes
    }
    if (variantsList.length === 0 && Array.isArray(p?.variants)) {
      variantsList = p.variants;
    }

    const toStr = (x: any) => (x != null && typeof x === 'object' ? (x.es ?? x.pt ?? x.en) : x) ?? '';
    const variants = variantsList.map((v: any) => {
      const values = Array.isArray(v?.values) ? v.values : [];
      const sizeVal = sizeIdx >= 0 && sizeIdx < values.length ? values[sizeIdx] : '';
      const colorVal = colorIdx >= 0 && colorIdx < values.length ? values[colorIdx] : '';
      return {
        variantId: v?.id,
        sku: v?.sku || '',
        size: String(toStr(sizeVal)),
        color: String(toStr(colorVal)),
        stock: Number(v?.stock) || 0
      };
    });
    return res.json({ variants, productId: p.id });
  } catch (error: any) {
    const detail = error.response?.data?.description || error.response?.data?.message || error.message;
    console.error('Error fetching TN product variants:', detail);
    res.status(500).json({ message: 'Error obteniendo variantes de Tienda Nube', detail });
  }
};

async function fetchAllTiendaNubeProductVariantsApi(
  storeId: string,
  accessToken: string,
  productId: string
): Promise<any[]> {
  const headers = { Authentication: `bearer ${accessToken}`, 'User-Agent': TN_USER_AGENT };
  let variantsList: any[] = [];
  const perPage = 200;
  let vPage = 1;
  let hasMoreVariants = true;
  while (hasMoreVariants) {
    const variantsRes = await axios.get(`https://api.tiendanube.com/v1/${storeId}/products/${productId}/variants`, {
      headers,
      params: { page: vPage, per_page: perPage },
      validateStatus: () => true
    });
    const chunk = variantsRes.status === 200 && Array.isArray(variantsRes.data) ? variantsRes.data : [];
    variantsList = variantsList.concat(chunk);
    if (chunk.length < perPage) hasMoreVariants = false;
    else vPage++;
    if (vPage > 50) hasMoreVariants = false;
  }
  return variantsList;
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

function stripVariantForTiendaNubeCreate(v: any, skuSuffix: string, idx: number): any {
  const baseSku =
    v?.sku != null && String(v.sku).trim() !== ''
      ? skuToCanonicalString(v.sku)
      : `VAR-${idx + 1}`;
  const out: any = {
    price: v.price != null ? String(v.price) : '0',
    stock_management: v.stock_management !== false,
    stock: Number(v.stock) || 0,
    sku: skuToCanonicalString(`${baseSku}${skuSuffix}`),
    values: Array.isArray(v.values) ? v.values : []
  };
  if (v.promotional_price != null && String(v.promotional_price).trim() !== '') {
    out.promotional_price = String(v.promotional_price);
  }
  if (v.weight != null && String(v.weight).trim() !== '') out.weight = v.weight;
  if (v.width != null && String(v.width).trim() !== '') out.width = v.width;
  if (v.height != null && String(v.height).trim() !== '') out.height = v.height;
  if (v.depth != null && String(v.depth).trim() !== '') out.depth = v.depth;
  if (v.cost != null && String(v.cost).trim() !== '') out.cost = v.cost;
  return out;
}

function buildTiendaNubeDuplicateCreateBody(
  product: any,
  variantsList: any[],
  opts: { titleSuffix: string; skuSuffix: string; published: boolean }
): any {
  const titleSuffix = opts.titleSuffix;
  const skuSuffix = opts.skuSuffix;
  const variantSource =
    variantsList.length > 0 ? variantsList : Array.isArray(product?.variants) ? product.variants : [];
  let variants = variantSource.map((v: any, i: number) => stripVariantForTiendaNubeCreate(v, skuSuffix, i));
  if (variants.length === 0) {
    variants = [stripVariantForTiendaNubeCreate({ price: '0', stock: 0, stock_management: true, values: [] }, skuSuffix, 0)];
  }

  const body: any = {
    name: appendSuffixToLocalizedName(product.name, titleSuffix),
    description: product.description ?? { es: '', en: '', pt: '' },
    attributes: Array.isArray(product.attributes) ? product.attributes : [],
    categories: tiendaNubeCategoryIdsOnly(product.categories),
    published: opts.published,
    free_shipping: !!product.free_shipping,
    tags: typeof product.tags === 'string' ? product.tags : '',
    variants
  };
  if (product.brand != null && String(product.brand).trim() !== '') body.brand = product.brand;
  if (product.video_url && String(product.video_url).startsWith('https://')) body.video_url = product.video_url;
  if (product.seo_title != null) body.seo_title = appendSuffixToLocalizedName(product.seo_title, titleSuffix);
  if (product.seo_description != null) body.seo_description = product.seo_description;
  if (product.requires_shipping === false) body.requires_shipping = false;
  const imgs = (Array.isArray(product.images) ? product.images : [])
    .slice(0, 9)
    .map((im: any) => (im?.src ? { src: im.src } : null))
    .filter(Boolean);
  if (imgs.length > 0) body.images = imgs;
  return body;
}

/** Crea un producto en Tienda Nube (payload según documentación POST /products). */
export const createTiendaNubeProduct = async (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ message: 'Enviá un objeto JSON con name y variants' });
    }
    if (!body.name) return res.status(400).json({ message: 'Falta name (objeto por idioma, ej. { es: "..." })' });
    if (!Array.isArray(body.variants) || body.variants.length === 0) {
      return res.status(400).json({ message: 'Falta variants: al menos una variante (price, stock, etc.)' });
    }

    const integration = await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
    if (!integration?.access_token) return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
    const storeId = integration.store_id || integration.user_id;
    if (!storeId) return res.status(400).json({ message: 'No se encontró store_id de Tienda Nube' });

    const url = `https://api.tiendanube.com/v1/${storeId}/products`;
    const headers = {
      Authentication: `bearer ${integration.access_token}`,
      'User-Agent': TN_USER_AGENT,
      'Content-Type': 'application/json'
    };
    const r = await tnPostWithRetry(axios, url, body, { headers, validateStatus: () => true });
    if (r.status === 201) {
      return res.status(201).json({
        product: r.data,
        id: r.data?.id,
        message: 'Producto creado en Tienda Nube'
      });
    }
    const detail = r.data?.description || r.data?.message || r.statusText;
    return res.status(r.status >= 400 ? r.status : 502).json({
      message: ['Tienda Nube rechazó la creación del producto', detail].filter(Boolean).join(' — '),
      errors: r.data
    });
  } catch (error: any) {
    const detail = error.response?.data?.description || error.response?.data?.message || error.message;
    console.error('createTiendaNubeProduct:', detail);
    res.status(500).json({ message: 'Error creando producto en Tienda Nube', detail });
  }
};

/**
 * Duplica un producto existente en Tienda Nube (nueva publicación).
 * Útil para packs: mismo contenido con otro título y SKU (sufijos configurables).
 */
export const duplicateTiendaNubeProduct = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    if (!productId) return res.status(400).json({ message: 'Falta productId' });

    const titleSuffix = (req.body?.titleSuffix ?? ' (pack)').toString();
    const skuSuffix = (req.body?.skuSuffix ?? '-PACK').toString();
    const published = req.body?.published !== false;

    const integration = await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
    if (!integration?.access_token) return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
    const storeId = integration.store_id || integration.user_id;
    if (!storeId) return res.status(400).json({ message: 'No se encontró store_id de Tienda Nube' });

    const headers = { Authentication: `bearer ${integration.access_token}`, 'User-Agent': TN_USER_AGENT };
    const productRes = await axios.get(`https://api.tiendanube.com/v1/${storeId}/products/${productId}`, {
      headers,
      validateStatus: () => true
    });
    if (productRes.status !== 200) {
      const errMsg =
        (productRes.data && (productRes.data.description || productRes.data.message)) || productRes.statusText;
      return res.status(productRes.status >= 400 ? 404 : 502).json({
        message: 'Producto no encontrado en Tienda Nube',
        detail: errMsg
      });
    }

    const p = productRes.data;
    const variantsList = await fetchAllTiendaNubeProductVariantsApi(storeId, integration.access_token, String(productId));
    const createBody = buildTiendaNubeDuplicateCreateBody(p, variantsList, { titleSuffix, skuSuffix, published });

    const url = `https://api.tiendanube.com/v1/${storeId}/products`;
    const postHeaders = {
      ...headers,
      'Content-Type': 'application/json'
    };
    const r = await tnPostWithRetry(axios, url, createBody, { headers: postHeaders, validateStatus: () => true });
    if (r.status === 201) {
      return res.status(201).json({
        sourceProductId: productId,
        newProductId: r.data?.id,
        product: r.data,
        message: 'Publicación duplicada en Tienda Nube'
      });
    }
    const detail = r.data?.description || r.data?.message || r.statusText;
    return res.status(r.status >= 400 ? r.status : 502).json({
      message: ['Tienda Nube rechazó la duplicación', detail].filter(Boolean).join(' — '),
      errors: r.data
    });
  } catch (error: any) {
    const detail = error.response?.data?.description || error.response?.data?.message || error.message;
    console.error('duplicateTiendaNubeProduct:', detail);
    res.status(500).json({ message: 'Error duplicando producto en Tienda Nube', detail });
  }
};

/** Asegurar que exista un talle; si no existe, crearlo. Devuelve id del size. */
async function ensureSize(sizeCode: string): Promise<string> {
  const code = (sizeCode || 'U').toString().trim() || 'U';
  let row = await get(`SELECT id FROM sizes WHERE size_code = ?`, [code]);
  if (row?.id) return row.id;
  const id = uuidv4();
  await execute(`INSERT INTO sizes (id, size_code, name) VALUES (?, ?, ?)`, [id, code, code]);
  return id;
}

/** Asegurar que exista un color; si no existe, crearlo. Devuelve id del color. */
async function ensureColor(codeOrName: string): Promise<string> {
  const name = (codeOrName || 'Único').toString().trim() || 'Único';
  const code = name.substring(0, 20).replace(/\s+/g, '_').toUpperCase() || 'UNI';
  let row = await get(`SELECT id FROM colors WHERE code = ?`, [code]);
  if (row?.id) return row.id;
  row = await get(`SELECT id FROM colors WHERE name = ?`, [name]);
  if (row?.id) return row.id;
  const id = uuidv4();
  await execute(`INSERT INTO colors (id, code, name) VALUES (?, ?, ?)`, [id, code, name]);
  return id;
}

/** Importar un producto de Mercado Libre al inventario local: crea producto + variantes y vincula ML. Acepta itemId (una publicación) o itemIds (varias publicaciones agrupadas = una por variante). */
export const importProductFromMercadoLibre = async (req: Request, res: Response) => {
  try {
    const { itemId, itemIds } = req.body || {};
    const idsToImport: string[] = Array.isArray(itemIds) && itemIds.length > 0
      ? itemIds.flatMap((id: any) => mercadoLibreItemIdCandidates(id)).filter(Boolean)
      : itemId != null && itemId !== '' ? mercadoLibreItemIdCandidates(itemId) : [];
    if (idsToImport.length === 0) return res.status(400).json({ message: 'Falta itemId o itemIds' });

    const mlToken = await getValidMLToken();
    if (!mlToken) return res.status(400).json({ message: 'No hay integración con Mercado Libre' });

    const isMultiItem = idsToImport.length > 1;

    if (!isMultiItem) {
      const existing = await get(`SELECT id FROM products WHERE mercado_libre_id = ?`, [idsToImport[0]]);
      if (existing) {
        const del = await deleteProductById(existing.id);
        if (!del.deleted && del.error === 'in_orders') {
          return res.status(400).json({ message: 'No se puede reemplazar: el artículo ya está en pedidos.' });
        }
      }
    }

    const fetchOne = async (rawItemId: string): Promise<any> => {
      const candidates = mercadoLibreItemIdCandidates(rawItemId);
      for (const itemIdToFetch of candidates) {
        const itemRes = await axios.get(`https://api.mercadolibre.com/items/${itemIdToFetch}?include_attributes=all`, {
          headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
        }).catch(() => null);
        if (itemRes && itemRes.status === 200 && itemRes.data && !itemRes.data.error) {
          return itemRes.data;
        }
      }
      return null;
    };

    if (isMultiItem) {
      const items = await Promise.all(idsToImport.map(id => fetchOne(id)));
      const validItems = items.filter(Boolean);
      if (validItems.length === 0) return res.status(404).json({ message: 'No se encontró ninguna publicación en Mercado Libre' });

      const first = validItems[0];
      const title = mlBaseTitle((first.title || '').toString().trim()) || 'Sin título';
      const variations: { variationId: string; sku: string; color: string; size: string; stock: number; mlItemId: string }[] = [];
      for (const item of validItems) {
        const mlItemId = (item.id || '').toString().trim();
        let sku = (item.seller_sku ?? item.seller_custom_field ?? '').toString().trim();
        if (!sku && item.variations && item.variations.length === 1) {
          const v0 = item.variations[0];
          const skuAttr = Array.isArray(v0.attributes) && v0.attributes.find((a: any) => (a.id || '').toString().toUpperCase() === 'SELLER_SKU');
          sku = (skuAttr ? (skuAttr.value_name ?? skuAttr.value ?? '') : (v0.seller_sku ?? v0.seller_custom_field ?? '')).toString().trim();
        }
        if (!sku) sku = `ML-${mlItemId}`;
        const { color, size } = mlColorSizeFromTitle((item.title || '').toString().trim());
        variations.push({
          variationId: mlItemId,
          sku,
          color: color || 'Único',
          size: size || 'U',
          stock: item.available_quantity ?? (item.variations?.[0]?.available_quantity ?? 0),
          mlItemId
        });
      }

      const firstSku = variations[0]?.sku || '';
      const baseSku = firstSku.includes('-') ? firstSku.split('-').slice(0, -2).join('-') || firstSku : (firstSku || `ML-${validItems[0].id}`);
      const existingBySku = await get(`SELECT id FROM products WHERE sku = ?`, [baseSku]);
      if (existingBySku) {
        const del = await deleteProductById(existingBySku.id);
        if (!del.deleted && del.error === 'in_orders') {
          return res.status(400).json({ message: 'No se puede reemplazar: el artículo ya está en pedidos.' });
        }
      }
      const productId = uuidv4();
      await execute(
        `INSERT INTO products (id, sku, name, category, base_price, description, mercado_libre_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [productId, baseSku, title, 'General', first.price || 0, first.description?.plain_text || null, null]
      );

      const byVariantKey = new Map<string, typeof variations>();
      for (const v of variations) {
        const colorKey = (v.color || 'Único').toString().trim().toLowerCase() || 'único';
        const sizeKey = (v.size || 'U').toString().trim().toUpperCase() || 'U';
        const key = `${colorKey}|${sizeKey}`;
        if (!byVariantKey.has(key)) byVariantKey.set(key, []);
        byVariantKey.get(key)!.push(v);
      }
      let variantsCreated = 0;
      for (const group of byVariantKey.values()) {
        const { created } = await upsertLocalVariantFromMlEntries(productId, baseSku, group);
        if (created) variantsCreated++;
      }
      return res.status(201).json({
        productId,
        baseSku,
        name: title,
        variantsCreated,
        publicationsLinked: variations.length,
        message: 'Producto importado de Mercado Libre (variantes agrupadas)'
      });
    }

    let itemIdToFetch = idsToImport[0];
    const item = await fetchOne(itemIdToFetch);
    if (!item) return res.status(404).json({ message: 'Publicación no encontrada en Mercado Libre. Si el ID es solo numérico (ej. 3270089), se intenta con MLA.' });
    if (item.id) itemIdToFetch = String(item.id);

    const existingByMlId = await get(`SELECT id FROM products WHERE mercado_libre_id = ?`, [itemIdToFetch]);
    if (existingByMlId) {
      const del = await deleteProductById(existingByMlId.id);
      if (!del.deleted && del.error === 'in_orders') {
        return res.status(400).json({ message: 'No se puede reemplazar: el artículo ya está en pedidos.' });
      }
    }

    const title = (item.title || '').toString().trim() || 'Sin título';
    let variations: { variationId: string | number; sku: string; color: string; size: string; stock: number; mlItemId?: string }[] = [];

    if (item.variations && item.variations.length > 0) {
      variations = item.variations.map((v: any) => {
        const skuAttr = Array.isArray(v.attributes) && v.attributes.find((a: any) => (a.id || '').toString().toUpperCase() === 'SELLER_SKU');
        const skuFromAttr = skuAttr ? (skuAttr.value_name ?? skuAttr.value ?? '').toString().trim() : '';
        const sku = skuFromAttr || (v.seller_sku ?? v.seller_custom_field ?? '').toString().trim();
        let color = '';
        let size = '';
        (v.attribute_combinations || []).forEach((attr: any) => {
          const id = (attr.id || '').toString().toUpperCase();
          const name = (attr.value_name || attr.name || '').toString().trim();
          if (id === 'COLOR' || id === 'COLOUR' || id === 'COR') color = name;
          if (id === 'SIZE' || id === 'SIZE_TYPE' || id === 'TALLE' || id === 'Talla') size = name;
        });
        return {
          variationId: v.id,
          sku,
          color: color || 'Único',
          size: size || 'U',
          stock: v.available_quantity || 0
        };
      });
    }
    if (variations.length === 0) {
      let sku = (item.seller_sku ?? item.seller_custom_field ?? '').toString().trim();
      if (!sku && item.variations && item.variations.length === 1) {
        const v0 = item.variations[0];
        const skuAttr = Array.isArray(v0.attributes) && v0.attributes.find((a: any) => (a.id || '').toString().toUpperCase() === 'SELLER_SKU');
        sku = (skuAttr ? (skuAttr.value_name ?? skuAttr.value ?? '') : (v0.seller_sku ?? v0.seller_custom_field ?? '')).toString().trim();
      }
      if (!sku) sku = (item.id ?? itemIdToFetch).toString();
      const parsed = mlColorSizeFromTitle(title);
      variations = [{
        variationId: item.id,
        sku: sku || `ML-${item.id}`,
        color: parsed.color || 'Único',
        size: parsed.size || 'U',
        stock: item.available_quantity || 0,
        mlItemId: (item.id || '').toString()
      }];
    }

    const firstSku = variations[0]?.sku || '';
    const baseSku = firstSku.includes('-') ? firstSku.split('-').slice(0, -2).join('-') || firstSku : (firstSku || `ML-${itemIdToFetch}`);
    let productId: string;

    const existingBySku = await get(`SELECT id FROM products WHERE sku = ?`, [baseSku]);
    if (existingBySku) {
      const del = await deleteProductById(existingBySku.id);
      if (!del.deleted && del.error === 'in_orders') {
        return res.status(400).json({ message: 'No se puede reemplazar: el artículo ya está en pedidos.' });
      }
    }
    productId = uuidv4();
    const displayName = mlBaseTitle(title) || title;
    await execute(
      `INSERT INTO products (id, sku, name, category, base_price, description, mercado_libre_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [productId, baseSku, displayName, 'General', item.price || 0, item.description?.plain_text || null, itemIdToFetch]
    );

    const byVariantKey = new Map<string, typeof variations>();
    for (const v of variations) {
      const colorKey = (v.color || 'Único').toString().trim().toLowerCase() || 'único';
      const sizeKey = (v.size || 'U').toString().trim().toUpperCase() || 'U';
      const key = `${colorKey}|${sizeKey}`;
      if (!byVariantKey.has(key)) byVariantKey.set(key, []);
      byVariantKey.get(key)!.push({ ...v, mlItemId: (v as any).mlItemId ?? itemIdToFetch });
    }
    let variantsCreated = 0;
    for (const group of byVariantKey.values()) {
      const entries = group.map((v) => ({
        sku: v.sku,
        color: v.color,
        size: v.size,
        stock: v.stock,
        mlItemId: (v as any).mlItemId ?? itemIdToFetch,
        variationId: v.variationId
      }));
      const { created } = await upsertLocalVariantFromMlEntries(productId, baseSku, entries);
      if (created) variantsCreated++;
    }

    res.status(201).json({
      productId,
      baseSku,
      name: displayName,
      variantsCreated,
      message: 'Producto importado de Mercado Libre'
    });
  } catch (error: any) {
    const status = error.response?.status;
    const code = error.code;
    const detail = error.response?.data?.message || error.message;
    console.error('Error importing product from ML:', code || status, detail);
    if (code === 'ER_DUP_ENTRY' || (detail && String(detail).includes('Duplicate entry'))) {
      return res.status(409).json({ message: 'Ya existe un artículo con ese código (SKU). Editá el existente en Mi inventario para vincularlo con ML.', detail: String(detail) });
    }
    res.status(status === 404 ? 404 : 500).json({ message: 'Error importando producto de Mercado Libre', detail });
  }
};

/** Importar un producto de Tienda Nube al inventario local: crea producto + variantes y vincula TN. */
export const importProductFromTiendaNube = async (req: Request, res: Response) => {
  try {
    const { productId: tnProductId } = req.body || {};
    if (tnProductId == null || tnProductId === '') return res.status(400).json({ message: 'Falta productId de Tienda Nube' });

    const integration = await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
    if (!integration?.access_token) return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
    const storeId = integration.store_id || integration.user_id;
    if (!storeId) return res.status(400).json({ message: 'No se encontró store_id de Tienda Nube' });

    const existing = await get(`SELECT id FROM products WHERE tienda_nube_id = ?`, [String(tnProductId)]);
    if (existing) return res.status(409).json({ message: 'Este producto de Tienda Nube ya está en tu inventario', productId: existing.id });

    const headers = { 'Authentication': `bearer ${integration.access_token}`, 'User-Agent': TN_USER_AGENT };
    const [productRes, variantsRes] = await Promise.all([
      axios.get(`https://api.tiendanube.com/v1/${storeId}/products/${tnProductId}`, { headers, validateStatus: () => true }),
      axios.get(`https://api.tiendanube.com/v1/${storeId}/products/${tnProductId}/variants`, { headers, validateStatus: () => true })
    ]);
    if (productRes.status !== 200) {
      const errMsg = (productRes.data && (productRes.data.description || productRes.data.message)) || productRes.statusText;
      return res.status(productRes.status >= 400 ? 404 : 502).json({ message: 'Producto no encontrado en Tienda Nube', detail: errMsg });
    }

    const p = productRes.data;
    const title = (p.name?.es ?? p.name?.pt ?? p.name?.en ?? p.name ?? '').toString().trim() || 'Sin título';
    const attrs = Array.isArray(p?.attributes) ? p.attributes : [];
    const isSizeAttr = (n: string) => /talle|talla|size|tamano|tamaño/i.test(n);
    const isColorAttr = (n: string) => /color|colour|cor/i.test(n);
    let sizeIdx = -1, colorIdx = -1;
    attrs.forEach((a: any, i: number) => {
      const n = (a?.es ?? a?.en ?? a?.pt ?? '').toString();
      if (isSizeAttr(n)) sizeIdx = i;
      if (isColorAttr(n)) colorIdx = i;
    });

    let variantsList: any[] = variantsRes.status === 200 && Array.isArray(variantsRes.data) ? variantsRes.data : (Array.isArray(p?.variants) ? p.variants : []);
    const toStr = (x: any) => (x != null && typeof x === 'object' ? (x.es ?? x.pt ?? x.en) : x) ?? '';
    let variations = variantsList.map((v: any) => {
      const values = Array.isArray(v?.values) ? v.values : [];
      const sizeVal = sizeIdx >= 0 && sizeIdx < values.length ? values[sizeIdx] : '';
      const colorVal = colorIdx >= 0 && colorIdx < values.length ? values[colorIdx] : '';
      return {
        variantId: v?.id,
        sku: (v?.sku || '').toString().trim() || `TN-${v?.id}`,
        size: String(toStr(sizeVal)).trim() || 'U',
        color: String(toStr(colorVal)).trim() || 'Único',
        stock: Number(v?.stock) || 0
      };
    });

    if (variations.length === 0) {
      variations.push({
        variantId: p.id,
        sku: `TN-${p.id}`,
        size: 'U',
        color: 'Único',
        stock: 0
      });
    }

    const baseSku = variations[0]?.sku?.replace(/-[^-]+-[^-]+$/, '') || `TN-${tnProductId}`;
    const productId = uuidv4();
    await execute(
      `INSERT INTO products (id, sku, name, category, base_price, description, tienda_nube_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [productId, baseSku, title, 'General', variations[0]?.stock ? 0 : 0, null, String(tnProductId)]
    );

    let variantsCreated = 0;
    for (const v of variations) {
      const sizeId = await ensureSize(v.size);
      const colorId = await ensureColor(v.color);

      let productColorId = (await get(`SELECT id FROM product_colors WHERE product_id = ? AND color_id = ?`, [productId, colorId]))?.id;
      if (!productColorId) {
        productColorId = uuidv4();
        await execute(`INSERT INTO product_colors (id, product_id, color_id) VALUES (?, ?, ?)`, [productColorId, productId, colorId]);
      }

      const existingVariant = await get(`SELECT id FROM product_variants WHERE product_color_id = ? AND size_id = ?`, [productColorId, sizeId]);
      if (existingVariant) continue;

      const variantId = uuidv4();
      await execute(
        `INSERT INTO product_variants (id, product_color_id, size_id, sku, tienda_nube_variant_id) VALUES (?, ?, ?, ?, ?)`,
        [variantId, productColorId, sizeId, v.sku, String(v.variantId)]
      );
      await execute(`INSERT INTO stocks (variant_id, stock) VALUES (?, ?) ON DUPLICATE KEY UPDATE stock = VALUES(stock)`, [variantId, v.stock]);
      variantsCreated++;
    }

    res.status(201).json({
      productId,
      baseSku,
      name: title,
      variantsCreated,
      message: 'Producto importado de Tienda Nube'
    });
  } catch (error: any) {
    const detail = error.response?.data?.description || error.response?.data?.message || error.message;
    console.error('Error importing product from TN:', detail);
    res.status(500).json({ message: 'Error importando producto de Tienda Nube', detail });
  }
};

// Obtener configuración de mensaje automático de ML
export const getMLAutoMessageConfig = async (req: Request, res: Response) => {
  try {
    // Crear tabla si no existe
    await execute(`
      CREATE TABLE IF NOT EXISTS ml_auto_message_config (
        id INT PRIMARY KEY DEFAULT 1,
        enabled BOOLEAN DEFAULT TRUE,
        message_template TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    const config = await get(`SELECT * FROM ml_auto_message_config WHERE id = 1`);
    
    if (!config) {
      // Insertar configuración por defecto
      const defaultMessage = `¡Hola {nombre}! 🙌

Muchas gracias por tu compra{productos}. 

Tu pedido ya está siendo preparado con mucho cuidado. Te avisaremos apenas lo despachemos.

Si tenés alguna consulta, no dudes en escribirnos. ¡Gracias por confiar en nosotros!

Saludos,
Equipo Lupo`;

      await execute(
        `INSERT INTO ml_auto_message_config (id, enabled, message_template) VALUES (1, TRUE, ?)`,
        [defaultMessage]
      );

      return res.json({
        enabled: true,
        messageTemplate: defaultMessage
      });
    }

    res.json({
      enabled: config.enabled === 1,
      messageTemplate: config.message_template
    });
  } catch (error: any) {
    console.error('Error getting ML auto message config:', error.message);
    res.status(500).json({ message: 'Error obteniendo configuración', error: error.message });
  }
};

// Guardar configuración de mensaje automático de ML
export const saveMLAutoMessageConfig = async (req: Request, res: Response) => {
  try {
    const { enabled, messageTemplate } = req.body;

    // Crear tabla si no existe
    await execute(`
      CREATE TABLE IF NOT EXISTS ml_auto_message_config (
        id INT PRIMARY KEY DEFAULT 1,
        enabled BOOLEAN DEFAULT TRUE,
        message_template TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await execute(
      `INSERT INTO ml_auto_message_config (id, enabled, message_template) 
       VALUES (1, ?, ?)
       ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), message_template = VALUES(message_template)`,
      [enabled ? 1 : 0, messageTemplate]
    );

    res.json({ success: true, message: 'Configuración guardada' });
  } catch (error: any) {
    console.error('Error saving ML auto message config:', error.message);
    res.status(500).json({ message: 'Error guardando configuración', error: error.message });
  }
};

/** Config de respuesta automática a preguntas ML (Gemini / Groq gratis u OpenAI). */
export const getMLQuestionsAiConfig = async (req: Request, res: Response) => {
  try {
    const cfg = await mlQuestionsAi.getMlQuestionsAiConfigRow();
    const st = mlQuestionsAi.getLlmStatus();
    res.json({
      enabled: cfg.enabled,
      mode: cfg.mode,
      extraSystemPrompt: cfg.extraSystemPrompt || '',
      openAiConfigured: st.configured,
      llmProvider: st.provider,
      llmLabel: st.label
    });
  } catch (error: any) {
    console.error('getMLQuestionsAiConfig:', error);
    res.status(500).json({ message: 'Error obteniendo configuración', error: error.message });
  }
};

export const saveMLQuestionsAiConfig = async (req: Request, res: Response) => {
  try {
    const { enabled, mode, extraSystemPrompt } = req.body || {};
    const modeNorm =
      mode === 'suggest' || mode === 'auto' || mode === 'off'
        ? mode
        : enabled === false
          ? 'off'
          : undefined;
    await mlQuestionsAi.saveMlQuestionsAiConfig({
      enabled: enabled != null ? !!enabled : undefined,
      mode: modeNorm,
      extraSystemPrompt: extraSystemPrompt != null ? String(extraSystemPrompt) : undefined
    });
    res.json({ success: true, message: 'Configuración guardada' });
  } catch (error: any) {
    console.error('saveMLQuestionsAiConfig:', error);
    res.status(500).json({ message: 'Error guardando configuración', error: error.message });
  }
};

function mlQuestionsAiRoleOk(req: Request): boolean {
  const user = (req as any).user;
  return !!user && ['ADMIN', 'WAREHOUSE', 'DEPOSITO'].includes(user.role);
}

/** Procesa preguntas sin responder (manual): sugerencias o auto-respuesta según modo. */
export const processMLQuestionsAi = async (req: Request, res: Response) => {
  try {
    if (!mlQuestionsAiRoleOk(req)) {
      return res.status(403).json({ message: 'Solo administradores o depósito pueden ejecutar esto' });
    }
    if (!mlQuestionsAi.llmConfigured()) {
      return res.status(503).json({
        message:
          'Configurá una clave de IA en el servidor: GEMINI_API_KEY (gratis en Google AI Studio), GROQ_API_KEY (gratis) u OPENAI_API_KEY (de pago).'
      });
    }
    const rawLimit = (req.body as any)?.limit ?? (req.query as any)?.limit;
    const limit = Math.min(Math.max(parseInt(String(rawLimit ?? '10'), 10) || 10, 1), 25);
    const token = await getValidMLToken();
    if (!token) return res.status(503).json({ message: 'Mercado Libre no conectado o token inválido' });
    const cfg = await mlQuestionsAi.getMlQuestionsAiConfigRow();
    if (cfg.mode === 'off') {
      return res.status(400).json({ message: 'La IA de preguntas está desactivada. Activá modo sugerencias o automático en Configuración.' });
    }
    const { processed, results } = await mlQuestionsAi.processUnansweredBatch(token, {
      limit,
      extraSystemPrompt: cfg.extraSystemPrompt,
      mode: cfg.mode
    });
    res.json({ processed, results, mode: cfg.mode });
  } catch (error: any) {
    const detail = error?.response?.data ?? error?.message;
    console.error('processMLQuestionsAi:', detail);
    res.status(500).json({ message: error?.message || 'Error procesando preguntas', detail });
  }
};

/** Genera sugerencia IA para una pregunta (sin publicar en ML). */
export const suggestMLQuestionAi = async (req: Request, res: Response) => {
  try {
    if (!mlQuestionsAiRoleOk(req)) {
      return res.status(403).json({ message: 'Sin permiso' });
    }
    if (!mlQuestionsAi.llmConfigured()) {
      return res.status(503).json({ message: 'Ninguna clave de IA configurada en el servidor' });
    }
    const questionId = String((req.body as any)?.questionId ?? (req.params as any)?.questionId ?? '').trim();
    if (!questionId) return res.status(400).json({ message: 'questionId requerido' });
    const token = await getValidMLToken();
    if (!token) return res.status(503).json({ message: 'Mercado Libre no conectado' });
    const cfg = await mlQuestionsAi.getMlQuestionsAiConfigRow();
    const forceRegenerate = !!(req.body as any)?.forceRegenerate;
    const result = await mlQuestionsAi.suggestForQuestion(token.access_token, questionId, {
      extraSystemPrompt: cfg.extraSystemPrompt,
      forceRegenerate
    });
    if (result.status === 'error') {
      return res.status(500).json({ message: result.message });
    }
    const suggestion = await mlQuestionsAi.getSuggestionByQuestionId(questionId);
    res.json({ result, suggestion });
  } catch (error: any) {
    console.error('suggestMLQuestionAi:', error?.response?.data || error.message);
    res.status(500).json({ message: error?.message || 'Error generando sugerencia' });
  }
};

/** Publica respuesta en ML (texto editado o sugerencia guardada). */
export const answerMLQuestion = async (req: Request, res: Response) => {
  try {
    if (!mlQuestionsAiRoleOk(req)) {
      return res.status(403).json({ message: 'Sin permiso' });
    }
    const questionId = String((req.body as any)?.questionId ?? '').trim();
    const text = (req.body as any)?.text != null ? String((req.body as any).text) : undefined;
    if (!questionId) return res.status(400).json({ message: 'questionId requerido' });
    const token = await getValidMLToken();
    if (!token) return res.status(503).json({ message: 'Mercado Libre no conectado' });
    const result = await mlQuestionsAi.approveAndSendSuggestion(token.access_token, questionId, text);
    if (result.status === 'error') {
      return res.status(500).json({ message: result.message });
    }
    if (result.status === 'skipped') {
      return res.status(409).json({ message: result.reason });
    }
    res.json({ success: true, result });
  } catch (error: any) {
    console.error('answerMLQuestion:', error?.response?.data || error.message);
    res.status(500).json({ message: error?.message || 'Error enviando respuesta' });
  }
};

/** Descarta sugerencia IA pendiente. */
export const rejectMLQuestionSuggestion = async (req: Request, res: Response) => {
  try {
    if (!mlQuestionsAiRoleOk(req)) {
      return res.status(403).json({ message: 'Sin permiso' });
    }
    const questionId = String((req.body as any)?.questionId ?? '').trim();
    if (!questionId) return res.status(400).json({ message: 'questionId requerido' });
    await mlQuestionsAi.rejectSuggestion(questionId);
    res.json({ success: true });
  } catch (error: any) {
    console.error('rejectMLQuestionSuggestion:', error.message);
    res.status(500).json({ message: error?.message || 'Error descartando sugerencia' });
  }
};

/** Métricas de calidad IA (envíos sin editar vs editados). */
export const getMLQuestionsAiMetrics = async (req: Request, res: Response) => {
  try {
    const metrics = await mlQuestionsAi.getMlQuestionsAiMetrics();
    res.json(metrics);
  } catch (error: any) {
    console.error('getMLQuestionsAiMetrics:', error.message);
    res.status(500).json({ message: error?.message || 'Error obteniendo métricas' });
  }
};

/** Métricas por defecto para Product Ads (Mercado Ads API). */
const ML_PADS_METRICS_DEFAULT =
  'clicks,prints,ctr,cost,cpc,acos,cvr,roas,sov,direct_amount,indirect_amount,total_amount,units_quantity,direct_units_quantity,indirect_units_quantity,advertising_items_quantity,direct_items_quantity,indirect_items_quantity';

/** Listado de anunciantes con acceso a Product Ads (PADS). */
export const getMercadoLibreProductAdsAdvertisers = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
    }
    const r = await axios.get('https://api.mercadolibre.com/advertising/advertisers', {
      headers: {
        Authorization: `Bearer ${mlToken.access_token}`,
        'Content-Type': 'application/json',
        'Api-Version': '1'
      },
      params: { product_id: 'PADS' },
      validateStatus: () => true
    });
    if (r.status !== 200) {
      const detail = r.data?.message || r.data?.cause?.message || r.data?.error || r.statusText;
      return res.status(r.status >= 400 && r.status < 500 ? r.status : 502).json({
        message:
          r.status === 404
            ? 'No hay permisos para Product Ads o no está activado. En Mercado Libre: Publicaciones → Campaña de publicidad (Product Ads).'
            : 'Error consultando anunciantes de Mercado Ads',
        detail
      });
    }
    res.json(r.data);
  } catch (error: any) {
    console.error('getMercadoLibreProductAdsAdvertisers:', error.response?.data || error.message);
    res.status(500).json({ message: 'Error consultando Product Ads', error: error.message });
  }
};

function mlProductAdsForwardQuery(req: Request): Record<string, string> {
  const params: Record<string, string> = {};
  const pass = [
    'date_from',
    'date_to',
    'metrics',
    'limit',
    'offset',
    'aggregation_type',
    'metrics_summary',
    'channel',
    'status',
    'campaign_id',
    'campaign_ids'
  ];
  for (const k of pass) {
    const v = req.query[k];
    if (v != null && v !== '') params[k] = String(v);
  }
  if (!params.metrics) params.metrics = ML_PADS_METRICS_DEFAULT;
  return params;
}

/** Campañas de Product Ads con métricas (proxy a API oficial). Requiere site_id y advertiser_id. */
export const getMercadoLibreProductAdsCampaigns = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
    }
    const siteId = (req.query.site_id as string)?.trim();
    const advertiserId = (req.query.advertiser_id as string)?.trim();
    if (!siteId || !advertiserId) {
      return res.status(400).json({ message: 'Parámetros requeridos: site_id y advertiser_id (desde el listado de anunciantes).' });
    }
    const params = mlProductAdsForwardQuery(req);
    const url = `https://api.mercadolibre.com/marketplace/advertising/${encodeURIComponent(siteId)}/advertisers/${encodeURIComponent(advertiserId)}/product_ads/campaigns/search`;
    const r = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${mlToken.access_token}`,
        'api-version': '2'
      },
      params,
      validateStatus: () => true
    });
    if (r.status !== 200) {
      const detail = r.data?.message || r.data?.cause?.message || r.data?.error || r.statusText;
      return res.status(r.status >= 400 && r.status < 500 ? r.status : 502).json({
        message: 'Error obteniendo campañas de Product Ads',
        detail
      });
    }
    res.json(r.data);
  } catch (error: any) {
    console.error('getMercadoLibreProductAdsCampaigns:', error.response?.data || error.message);
    res.status(500).json({ message: 'Error obteniendo campañas de Product Ads', error: error.message });
  }
};

/** Anuncios por publicación con métricas (proxy). Requiere site_id y advertiser_id. */
export const getMercadoLibreProductAdsAds = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
    }
    const siteId = (req.query.site_id as string)?.trim();
    const advertiserId = (req.query.advertiser_id as string)?.trim();
    if (!siteId || !advertiserId) {
      return res.status(400).json({ message: 'Parámetros requeridos: site_id y advertiser_id.' });
    }
    const params = mlProductAdsForwardQuery(req);
    // Documentación Product Ads: los filtros van como filters[nombre], no como query suelta.
    // Sin esto, campaign_id se ignora y la búsqueda devuelve todos los anuncios (exportes por campaña incorrectos).
    if (params.campaign_id) {
      params['filters[campaign_id]'] = params.campaign_id;
      delete params.campaign_id;
    }
    if (params.campaign_ids) {
      params['filters[campaign_ids]'] = params.campaign_ids;
      delete params.campaign_ids;
    }
    const url = `https://api.mercadolibre.com/marketplace/advertising/${encodeURIComponent(siteId)}/advertisers/${encodeURIComponent(advertiserId)}/product_ads/ads/search`;
    const r = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${mlToken.access_token}`,
        'api-version': '2'
      },
      params,
      validateStatus: () => true
    });
    if (r.status !== 200) {
      const detail = r.data?.message || r.data?.cause?.message || r.data?.error || r.statusText;
      return res.status(r.status >= 400 && r.status < 500 ? r.status : 502).json({
        message: 'Error obteniendo anuncios de Product Ads',
        detail
      });
    }
    res.json(r.data);
  } catch (error: any) {
    console.error('getMercadoLibreProductAdsAds:', error.response?.data || error.message);
    res.status(500).json({ message: 'Error obteniendo anuncios de Product Ads', error: error.message });
  }
};

const ML_ADS_V1_HEADERS = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
  'Api-Version': '1'
});

function normalizeBrandSummary(summary: any): Record<string, number> {
  if (!summary || typeof summary !== 'object') return {};
  const et = summary.event_time || {};
  const cost = Number(summary.consumed_budget) || 0;
  const totalAmount = Number(et.units_amount) || 0;
  const prints = Number(summary.prints) || 0;
  const clicks = Number(summary.clicks) || 0;
  const roas = cost > 0 && totalAmount > 0 ? totalAmount / cost : 0;
  const acos = Number(summary.acos) || 0;
  return {
    cost,
    prints,
    clicks,
    ctr: Number(summary.ctr) || 0,
    cpc: Number(summary.cpc) || 0,
    cvr: Number(summary.cvr) || 0,
    acos,
    total_amount: totalAmount,
    roas,
    units_quantity: Number(et.units_quantity) || 0
  };
}

function normalizeDisplaySummary(summary: any): Record<string, number> {
  if (!summary || typeof summary !== 'object') return {};
  const et = summary.event_time || {};
  const cost = Number(summary.consumed_budget) || 0;
  const totalAmount = Number(et.direct_amount) || 0;
  const prints = Number(summary.prints) || 0;
  const clicks = Number(summary.clicks) || 0;
  const roasEt = Number(et.roas) || 0;
  const roas = roasEt > 0 ? roasEt : cost > 0 && totalAmount > 0 ? totalAmount / cost : 0;
  const acos = totalAmount > 0 ? (cost / totalAmount) * 100 : 0;
  return {
    cost,
    prints,
    clicks,
    ctr: Number(summary.ctr) || 0,
    cpc: Number(summary.cpc) || 0,
    cpm: Number(summary.cpm) || 0,
    acos,
    total_amount: totalAmount,
    roas
  };
}

function mergeSummaries(rows: Record<string, number>[]): Record<string, number> {
  if (rows.length === 0) return {};
  const sums: Record<string, number> = {};
  const keys = new Set<string>();
  rows.forEach((r) => Object.keys(r).forEach((k) => keys.add(k)));
  for (const k of keys) {
    sums[k] = rows.reduce((acc, r) => acc + (Number(r[k]) || 0), 0);
  }
  const cost = sums.cost || 0;
  const totalAmount = sums.total_amount || 0;
  if (cost > 0 && totalAmount > 0) {
    sums.roas = totalAmount / cost;
    sums.acos = (cost / totalAmount) * 100;
  }
  return sums;
}

async function fetchBrandAdvertiserMetricsSummary(
  accessToken: string,
  advertiserId: string,
  dateFrom: string,
  dateTo: string
): Promise<Record<string, number> | null> {
  try {
    const r = await axios.get(
      `https://api.mercadolibre.com/advertising/advertisers/${encodeURIComponent(advertiserId)}/brand_ads/campaigns/metrics`,
      {
        headers: ML_ADS_V1_HEADERS(accessToken),
        params: { date_from: dateFrom, date_to: dateTo, aggregation_type: 'total' },
        validateStatus: () => true
      }
    );
    if (r.status !== 200 || !r.data?.summary) return null;
    return normalizeBrandSummary(r.data.summary);
  } catch {
    return null;
  }
}

async function fetchBrandCampaignMetricsRaw(
  accessToken: string,
  advertiserId: string,
  campaignId: string | number,
  dateFrom: string,
  dateTo: string
): Promise<Record<string, number>> {
  try {
    const r = await axios.get(
      `https://api.mercadolibre.com/advertising/advertisers/${encodeURIComponent(String(advertiserId))}/brand_ads/campaigns/${encodeURIComponent(String(campaignId))}/metrics`,
      {
        headers: ML_ADS_V1_HEADERS(accessToken),
        params: { date_from: dateFrom, date_to: dateTo, aggregation_type: 'total' },
        validateStatus: () => true
      }
    );
    if (r.status !== 200 || !r.data?.summary) return {};
    return normalizeBrandSummary(r.data.summary);
  } catch {
    return {};
  }
}

/** Anunciantes con acceso a Brand Ads (BADS). */
export const getMercadoLibreBrandAdsAdvertisers = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
    }
    const r = await axios.get('https://api.mercadolibre.com/advertising/advertisers', {
      headers: ML_ADS_V1_HEADERS(mlToken.access_token),
      params: { product_id: 'BADS' },
      validateStatus: () => true
    });
    if (r.status !== 200) {
      const detail = r.data?.message || r.data?.cause?.message || r.data?.error || r.statusText;
      return res.status(r.status >= 400 && r.status < 500 ? r.status : 502).json({
        message:
          r.status === 404
            ? 'No hay permisos para Brand Ads o no está activado. Consultá con tu asesor comercial de Mercado Libre.'
            : 'Error consultando anunciantes Brand Ads',
        detail
      });
    }
    res.json(r.data);
  } catch (error: any) {
    console.error('getMercadoLibreBrandAdsAdvertisers:', error.response?.data || error.message);
    res.status(500).json({ message: 'Error consultando Brand Ads', error: error.message });
  }
};

/**
 * Campañas Brand Ads con métricas por fila + resumen global del anunciante (misma API).
 * Query: advertiser_id, date_from, date_to, limit, offset
 */
export const getMercadoLibreBrandAdsCampaigns = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
    }
    const advertiserId = (req.query.advertiser_id as string)?.trim();
    const dateFrom = (req.query.date_from as string)?.trim();
    const dateTo = (req.query.date_to as string)?.trim();
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 100);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
    if (!advertiserId || !dateFrom || !dateTo) {
      return res.status(400).json({ message: 'Parámetros requeridos: advertiser_id, date_from, date_to' });
    }

    const listUrl = `https://api.mercadolibre.com/advertising/advertisers/${encodeURIComponent(advertiserId)}/brand_ads/campaigns`;
    const listR = await axios.get(listUrl, {
      headers: ML_ADS_V1_HEADERS(mlToken.access_token),
      params: { limit, offset },
      validateStatus: () => true
    });
    if (listR.status !== 200) {
      const detail = listR.data?.message || listR.data?.cause?.message || listR.data?.error || listR.statusText;
      return res.status(listR.status >= 400 && listR.status < 500 ? listR.status : 502).json({
        message: 'Error obteniendo campañas Brand Ads',
        detail
      });
    }
    const rawCampaigns = Array.isArray(listR.data?.campaigns) ? listR.data.campaigns : [];
    const paging = listR.data?.paging || { total: rawCampaigns.length, offset, limit };

    const [metricsSummary, ...metricsRows] = await Promise.all([
      fetchBrandAdvertiserMetricsSummary(mlToken.access_token, advertiserId, dateFrom, dateTo),
      ...rawCampaigns.map((c: any) =>
        fetchBrandCampaignMetricsRaw(mlToken.access_token, advertiserId, c.campaign_id, dateFrom, dateTo)
      )
    ]);

    const results = rawCampaigns.map((c: any, i: number) => {
      const m = metricsRows[i] || {};
      const budgetAmt = c?.budget?.amount != null ? Number(c.budget.amount) : 0;
      return {
        id: c.campaign_id,
        name: c.name,
        status: c.status,
        site_id: c.site_id,
        strategy: c.campaign_type,
        channel: 'brand_ads',
        budget: budgetAmt,
        metrics: m
      };
    });

    res.json({
      paging: { total: paging.total ?? results.length, offset: paging.offset ?? offset, limit: paging.limit ?? limit },
      results,
      metrics_summary: metricsSummary
    });
  } catch (error: any) {
    console.error('getMercadoLibreBrandAdsCampaigns:', error.response?.data || error.message);
    res.status(500).json({ message: 'Error obteniendo campañas Brand Ads', error: error.message });
  }
};

/** Anunciantes con acceso a Display Ads (DISPLAY). */
export const getMercadoLibreDisplayAdsAdvertisers = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
    }
    const r = await axios.get('https://api.mercadolibre.com/advertising/advertisers', {
      headers: ML_ADS_V1_HEADERS(mlToken.access_token),
      params: { product_id: 'DISPLAY' },
      validateStatus: () => true
    });
    if (r.status !== 200) {
      const detail = r.data?.message || r.data?.cause?.message || r.data?.error || r.statusText;
      return res.status(r.status >= 400 && r.status < 500 ? r.status : 502).json({
        message:
          r.status === 404
            ? 'No hay permisos para Display Ads o no está activado. Display se habilita vía asesor comercial de Mercado Libre.'
            : 'Error consultando anunciantes Display Ads',
        detail
      });
    }
    res.json(r.data);
  } catch (error: any) {
    console.error('getMercadoLibreDisplayAdsAdvertisers:', error.response?.data || error.message);
    res.status(500).json({ message: 'Error consultando Display Ads', error: error.message });
  }
};

async function fetchDisplayCampaignMetricsRaw(
  accessToken: string,
  advertiserId: string,
  campaignId: string | number,
  dateFrom: string,
  dateTo: string
): Promise<Record<string, number>> {
  try {
    const r = await axios.get(
      `https://api.mercadolibre.com/advertising/advertisers/${encodeURIComponent(String(advertiserId))}/display/campaigns/${encodeURIComponent(String(campaignId))}/metrics`,
      {
        headers: ML_ADS_V1_HEADERS(accessToken),
        params: { date_from: dateFrom, date_to: dateTo },
        validateStatus: () => true
      }
    );
    if (r.status !== 200 || !r.data?.summary) return {};
    return normalizeDisplaySummary(r.data.summary);
  } catch {
    return {};
  }
}

const DISPLAY_LIST_PAGE = 50;
const DISPLAY_METRICS_CONCURRENCY = 8;

/**
 * Campañas Display con métricas por fila. Query: advertiser_id, date_from, date_to, limit, offset
 * El resumen global suma todas las campañas del anunciante (hasta 200 campañas por petición).
 */
export const getMercadoLibreDisplayAdsCampaigns = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
    }
    const advertiserId = (req.query.advertiser_id as string)?.trim();
    const dateFrom = (req.query.date_from as string)?.trim();
    const dateTo = (req.query.date_to as string)?.trim();
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 100);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
    if (!advertiserId || !dateFrom || !dateTo) {
      return res.status(400).json({ message: 'Parámetros requeridos: advertiser_id, date_from, date_to' });
    }

    const allRows: any[] = [];
    let listOffset = 0;
    let totalFromApi = 0;
    for (;;) {
      const listR = await axios.get(
        `https://api.mercadolibre.com/advertising/advertisers/${encodeURIComponent(advertiserId)}/display/campaigns`,
        {
          headers: ML_ADS_V1_HEADERS(mlToken.access_token),
          params: { limit: DISPLAY_LIST_PAGE, offset: listOffset, sort_by: 'start_date', sort_order: 'desc' },
          validateStatus: () => true
        }
      );
      if (listR.status !== 200) {
        const detail = listR.data?.message || listR.data?.cause?.message || listR.data?.error || listR.statusText;
        return res.status(listR.status >= 400 && listR.status < 500 ? listR.status : 502).json({
          message: 'Error obteniendo campañas Display Ads',
          detail
        });
      }
      const batch = Array.isArray(listR.data?.results) ? listR.data.results : [];
      totalFromApi = listR.data?.paging?.total ?? listR.data?.total ?? batch.length + listOffset;
      allRows.push(...batch);
      if (batch.length < DISPLAY_LIST_PAGE) break;
      listOffset += DISPLAY_LIST_PAGE;
      if (listOffset > 10000) break;
    }

    const MAX_METRICS = 200;
    const idsForMetrics = allRows.slice(0, MAX_METRICS).map((r: any) => r.id);
    const metricsById = new Map<number, Record<string, number>>();

    for (let i = 0; i < idsForMetrics.length; i += DISPLAY_METRICS_CONCURRENCY) {
      const chunk = idsForMetrics.slice(i, i + DISPLAY_METRICS_CONCURRENCY);
      const settled = await Promise.all(
        chunk.map((cid) =>
          fetchDisplayCampaignMetricsRaw(mlToken.access_token, advertiserId, cid, dateFrom, dateTo).then((m) => ({
            cid,
            m
          }))
        )
      );
      settled.forEach(({ cid, m }) => metricsById.set(Number(cid), m));
    }

    const allSummaries = idsForMetrics.map((id) => metricsById.get(Number(id)) || {});
    const metrics_summary = mergeSummaries(allSummaries);
    const summary_partial = allRows.length > MAX_METRICS;

    const enriched = allRows.map((c: any) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      site_id: c.site_id,
      strategy: c.type,
      channel: 'display',
      goal: c.goal,
      budget: 0,
      metrics: metricsById.get(Number(c.id)) || {}
    }));

    const pageSlice = enriched.slice(offset, offset + limit);
    const total = totalFromApi || enriched.length;

    res.json({
      paging: { total, offset, limit },
      results: pageSlice,
      metrics_summary,
      summary_partial
    });
  } catch (error: any) {
    console.error('getMercadoLibreDisplayAdsCampaigns:', error.response?.data || error.message);
    res.status(500).json({ message: 'Error obteniendo campañas Display Ads', error: error.message });
  }
};
