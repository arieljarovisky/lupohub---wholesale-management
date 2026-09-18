import { Request, Response } from 'express';
import axios from 'axios';
import ExcelJS from 'exceljs';
import { query } from '../database/db';
import { getValidMLToken, normalizeMercadoLibreItemId } from './integrations.controller';

const ML_API = 'https://api.mercadolibre.com';
const ML_REVIEWS_MAX_ITEMS = Math.max(50, parseInt(process.env.ML_REVIEWS_MAX_ITEMS || '2000', 10));
const CONCURRENCY = Math.min(10, Math.max(2, parseInt(process.env.ML_REVIEWS_CONCURRENCY || '6', 10)));
const CACHE_TTL_MS = Math.max(60_000, parseInt(process.env.ML_REVIEWS_CACHE_TTL_MS || '300000', 10));

export type MlReviewRow = {
  id: string | number;
  title: string;
  content: string;
  rate: number | null;
  status: string;
  dateCreated: string | null;
  buyingDate: string | null;
  likes: number;
  dislikes: number;
  relevance: number | null;
  /** Nickname de Mercado Libre del comprador (cuando se puede resolver). */
  authorName: string | null;
  orderId: string | null;
  attributes: Array<{ id?: string; name?: string; value_id?: string; value_name?: string }>;
};

export type MlItemReviewsSummary = {
  itemId: string;
  title: string;
  permalink: string | null;
  status: string | null;
  thumbnail: string | null;
  catalogProductId: string | null;
  tiendaNubeProductId: string | null;
  tiendaNubeProductName: string | null;
  ratingAverage: number | null;
  reviewsCount: number;
  ratingLevels: {
    oneStar: number;
    twoStar: number;
    threeStar: number;
    fourStar: number;
    fiveStar: number;
  };
  reviews: MlReviewRow[];
};

type CacheEntry = { at: number; data: MlItemReviewsSummary[] };
const reviewsCache = new Map<string, CacheEntry>();

function cacheKey(userId: string, includeClosed: boolean, onlyWithReviews: boolean): string {
  return `${userId}|c:${includeClosed ? 1 : 0}|o:${onlyWithReviews ? 1 : 0}`;
}

function ymdKey(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})/);
  if (m?.[1]) return m[1];
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function extractOrderId(raw: any): string | null {
  const candidates = [raw?.order_id, raw?.order?.id, raw?.orderId, raw?.purchase?.order_id];
  for (const c of candidates) {
    if (c == null || c === '' || c === 0 || c === '0') continue;
    const s = String(c).trim();
    if (s && s !== '0') return s;
  }
  return null;
}

function mapReview(raw: any): MlReviewRow {
  const attrs = Array.isArray(raw?.attributes)
    ? raw.attributes.map((a: any) => ({
        id: a?.id != null ? String(a.id) : undefined,
        name: a?.name != null ? String(a.name) : undefined,
        value_id: a?.value_id != null ? String(a.value_id) : undefined,
        value_name: a?.value_name != null ? String(a.value_name) : undefined,
      }))
    : [];
  const rateNum = Number(raw?.rate);
  // Preferir siempre nickname de ML (usuario), no nombre real.
  const author =
    String(
      raw?.reviewer?.nickname ||
        raw?.user?.nickname ||
        raw?.buyer?.nickname ||
        raw?.from?.nickname ||
        raw?.author_nickname ||
        ''
    ).trim() || null;
  return {
    id: raw?.id ?? '',
    title: String(raw?.title ?? raw?.tittle ?? '').trim(),
    content: String(raw?.content ?? '').trim(),
    rate: Number.isFinite(rateNum) ? rateNum : null,
    status: String(raw?.status ?? '').trim(),
    dateCreated: raw?.date_created ? String(raw.date_created) : null,
    buyingDate: raw?.buying_date ? String(raw.buying_date) : null,
    likes: Number(raw?.likes) || 0,
    dislikes: Number(raw?.dislikes) || 0,
    relevance: Number.isFinite(Number(raw?.relevance)) ? Number(raw.relevance) : null,
    authorName: author,
    orderId: extractOrderId(raw),
    attributes: attrs,
  };
}

async function fetchOrderBuyerNickname(accessToken: string, orderId: string): Promise<string | null> {
  try {
    const res = await axios.get(`${ML_API}/orders/${encodeURIComponent(orderId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15000,
    });
    const nick = String(res.data?.buyer?.nickname || '').trim();
    return nick || null;
  } catch (e: any) {
    if (e?.response?.status !== 404) {
      console.warn(`[ML Reviews] order ${orderId}:`, e?.response?.status || e?.message);
    }
    return null;
  }
}

/** Órdenes de un ítem → nickname por fecha de compra (YYYY-MM-DD). */
async function fetchItemBuyerNicknamesByDate(
  accessToken: string,
  sellerId: string,
  itemId: string
): Promise<Map<string, string[]>> {
  const byDate = new Map<string, string[]>();
  const addOrder = (order: any) => {
    const nick = String(order?.buyer?.nickname || '').trim();
    if (!nick) return;
    const items: any[] = Array.isArray(order?.order_items) ? order.order_items : [];
    const matchesItem =
      items.length === 0 ||
      items.some((oi) => {
        const id = normalizeMercadoLibreItemId(oi?.item?.id) || String(oi?.item?.id || '');
        return id && (id === itemId || mercadoLibreItemIdsLooseMatch(id, itemId));
      });
    if (!matchesItem) return;
    const key = ymdKey(order?.date_created || order?.date_closed);
    if (!key) return;
    const list = byDate.get(key) || [];
    list.push(nick);
    byDate.set(key, list);
  };

  let offset = 0;
  const limit = 50;
  const maxPages = 4;
  for (let page = 0; page < maxPages; page++) {
    try {
      const res = await axios.get(`${ML_API}/orders/search`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          seller: sellerId,
          q: itemId,
          offset,
          limit,
          sort: 'date_desc',
        },
        timeout: 20000,
      });
      const rows: any[] = Array.isArray(res.data?.results) ? res.data.results : [];
      if (rows.length === 0) break;
      for (const order of rows) addOrder(order);
      if (rows.length < limit) break;
      offset += limit;
    } catch (e: any) {
      console.warn(`[ML Reviews] orders/search ${itemId}:`, e?.response?.status || e?.message);
      break;
    }
  }
  return byDate;
}

function mercadoLibreItemIdsLooseMatch(a: string, b: string): boolean {
  const na = normalizeMercadoLibreItemId(a) || a;
  const nb = normalizeMercadoLibreItemId(b) || b;
  return !!na && !!nb && na === nb;
}

/**
 * La API de opiniones ofusca reviewer_id. Resolvemos el usuario ML (nickname)
 * desde la orden asociada o por coincidencia ítem + fecha de compra.
 */
async function enrichReviewAuthors(
  accessToken: string,
  sellerId: string,
  list: MlItemReviewsSummary[]
): Promise<void> {
  const orderIds = new Set<string>();
  for (const s of list) {
    for (const r of s.reviews) {
      if (!r.authorName && r.orderId) orderIds.add(r.orderId);
    }
  }

  const nickByOrder = new Map<string, string>();
  if (orderIds.size > 0) {
    const ids = [...orderIds];
    await mapPool(ids, CONCURRENCY, async (orderId) => {
      const nick = await fetchOrderBuyerNickname(accessToken, orderId);
      if (nick) nickByOrder.set(orderId, nick);
      return nick;
    });
  }

  const itemsNeedingDateMatch = new Set<string>();
  for (const s of list) {
    for (const r of s.reviews) {
      if (r.authorName) continue;
      if (r.orderId && nickByOrder.has(r.orderId)) {
        r.authorName = nickByOrder.get(r.orderId)!;
        continue;
      }
      if (r.buyingDate) itemsNeedingDateMatch.add(s.itemId);
    }
  }

  const nickByItemDate = new Map<string, Map<string, string[]>>();
  if (itemsNeedingDateMatch.size > 0) {
    const itemIds = [...itemsNeedingDateMatch];
    await mapPool(itemIds, Math.min(4, CONCURRENCY), async (itemId) => {
      const map = await fetchItemBuyerNicknamesByDate(accessToken, sellerId, itemId);
      nickByItemDate.set(itemId, map);
      return map;
    });
  }

  for (const s of list) {
    const used = new Set<string>();
    for (const r of s.reviews) {
      if (r.authorName) continue;
      if (r.orderId && nickByOrder.has(r.orderId)) {
        r.authorName = nickByOrder.get(r.orderId)!;
        continue;
      }
      const day = ymdKey(r.buyingDate);
      if (!day) continue;
      const pool = nickByItemDate.get(s.itemId)?.get(day);
      if (!pool?.length) continue;
      const available = pool.find((n) => !used.has(`${day}:${n}`)) || pool[0];
      if (available) {
        r.authorName = available;
        used.add(`${day}:${available}`);
      }
    }
  }
}

type TnLink = { productId: string; productName: string };

function setMlTnLink(map: Map<string, TnLink>, mlRaw: unknown, tnId: unknown, name: unknown) {
  const ml = normalizeMercadoLibreItemId(mlRaw);
  const tn = tnId != null ? String(tnId).trim() : '';
  if (!ml || !tn) return;
  if (map.has(ml)) return;
  map.set(ml, { productId: tn, productName: String(name || '').trim() });
}

/** MLA / publicación ML → ID de producto de Tienda Nube si hay vínculo en LupoHub. */
async function loadMlItemToTiendaNubeMap(): Promise<Map<string, TnLink>> {
  const map = new Map<string, TnLink>();
  try {
    const productRows = (await query(
      `SELECT mercado_libre_id, tienda_nube_id, name FROM products
       WHERE mercado_libre_id IS NOT NULL AND TRIM(mercado_libre_id) != ''
         AND tienda_nube_id IS NOT NULL AND TRIM(tienda_nube_id) != ''`
    )) as Array<{ mercado_libre_id: string; tienda_nube_id: string; name: string }>;
    for (const r of productRows || []) {
      setMlTnLink(map, r.mercado_libre_id, r.tienda_nube_id, r.name);
    }

    const variantRows = (await query(
      `SELECT pv.mercado_libre_item_id AS ml_id, p.tienda_nube_id, p.name
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       WHERE pv.mercado_libre_item_id IS NOT NULL AND TRIM(pv.mercado_libre_item_id) != ''
         AND p.tienda_nube_id IS NOT NULL AND TRIM(p.tienda_nube_id) != ''`
    )) as Array<{ ml_id: string; tienda_nube_id: string; name: string }>;
    for (const r of variantRows || []) {
      setMlTnLink(map, r.ml_id, r.tienda_nube_id, r.name);
    }

    const pubRows = (await query(
      `SELECT vp.external_product_id AS ml_id,
              COALESCE(NULLIF(TRIM(p.tienda_nube_id), ''), NULLIF(TRIM(vp_tn.external_product_id), '')) AS tn_id,
              p.name
       FROM variant_publications vp
       JOIN product_variants pv ON pv.id = vp.variant_id
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       LEFT JOIN variant_publications vp_tn
         ON vp_tn.variant_id = vp.variant_id AND vp_tn.platform = 'tiendanube'
       WHERE vp.platform = 'mercadolibre'`
    )) as Array<{ ml_id: string; tn_id: string | null; name: string }>;
    for (const r of pubRows || []) {
      setMlTnLink(map, r.ml_id, r.tn_id, r.name);
    }
  } catch (e: any) {
    console.warn('[ML Reviews] no se pudo armar el mapa ML → Tienda Nube:', e?.message || e);
  }
  return map;
}

async function attachTiendaNubeLinks(list: MlItemReviewsSummary[]): Promise<MlItemReviewsSummary[]> {
  const map = await loadMlItemToTiendaNubeMap();
  return list.map((s) => {
    const link = map.get(normalizeMercadoLibreItemId(s.itemId) || s.itemId);
    return {
      ...s,
      tiendaNubeProductId: link?.productId || null,
      tiendaNubeProductName: link?.productName || null,
    };
  });
}

function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toYmd(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})/);
    return m?.[1] || '';
  }
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

function reviewContentForTn(r: MlReviewRow): string {
  return [r.title, r.content].filter((x) => x && x.trim()).join('\n').trim();
}

function tnImportStatus(mlStatus: string): string {
  const s = (mlStatus || '').toLowerCase();
  if (s === 'rejected' || s === 'moderated' || s === 'blocked') return 'rejected';
  if (s === 'pending' || s === 'waiting') return 'pending';
  return 'published';
}

function emptyLevels() {
  return { oneStar: 0, twoStar: 0, threeStar: 0, fourStar: 0, fiveStar: 0 };
}

function mapLevels(levels: any) {
  if (!levels || typeof levels !== 'object') return emptyLevels();
  return {
    oneStar: Number(levels.one_star) || 0,
    twoStar: Number(levels.two_star) || 0,
    threeStar: Number(levels.three_star) || 0,
    fourStar: Number(levels.four_star) || 0,
    fiveStar: Number(levels.five_star) || 0,
  };
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function listSellerItemIds(accessToken: string, userId: string, statuses: string[]): Promise<string[]> {
  const seen = new Set<string>();
  const all: string[] = [];
  for (const st of statuses) {
    let offset = 0;
    const limit = 100;
    while (all.length < ML_REVIEWS_MAX_ITEMS) {
      const res = await axios.get(`${ML_API}/users/${userId}/items/search`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { status: st, offset, limit },
      });
      const ids: string[] = Array.isArray(res.data?.results) ? res.data.results : [];
      if (ids.length === 0) break;
      for (const id of ids) {
        const norm = normalizeMercadoLibreItemId(id) || String(id);
        if (!norm || seen.has(norm)) continue;
        seen.add(norm);
        all.push(norm);
        if (all.length >= ML_REVIEWS_MAX_ITEMS) break;
      }
      if (all.length >= ML_REVIEWS_MAX_ITEMS) break;
      if (ids.length < limit) break;
      offset += limit;
    }
  }
  return all;
}

async function multigetItems(
  accessToken: string,
  itemIds: string[]
): Promise<Map<string, { title: string; permalink: string | null; status: string | null; thumbnail: string | null; catalogProductId: string | null }>> {
  const map = new Map<
    string,
    { title: string; permalink: string | null; status: string | null; thumbnail: string | null; catalogProductId: string | null }
  >();
  const batchSize = 20;
  for (let i = 0; i < itemIds.length; i += batchSize) {
    const chunk = itemIds.slice(i, i + batchSize);
    try {
      const res = await axios.get(`${ML_API}/items`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { ids: chunk.join(',') },
      });
      const rows = Array.isArray(res.data) ? res.data : [];
      for (const row of rows) {
        const body = row?.body || row;
        const code = row?.code;
        if (code != null && code !== 200) continue;
        const id = normalizeMercadoLibreItemId(body?.id) || String(body?.id || '');
        if (!id) continue;
        map.set(id, {
          title: String(body?.title || '').trim() || id,
          permalink: body?.permalink ? String(body.permalink) : null,
          status: body?.status != null ? String(body.status) : null,
          thumbnail: body?.secure_thumbnail || body?.thumbnail || null,
          catalogProductId: body?.catalog_product_id != null ? String(body.catalog_product_id) : null,
        });
      }
    } catch (e: any) {
      console.warn('[ML Reviews] multiget falló:', e?.response?.status || e?.message);
    }
  }
  return map;
}

async function fetchItemReviews(
  accessToken: string,
  itemId: string,
  catalogProductId?: string | null
): Promise<{
  ratingAverage: number | null;
  ratingLevels: ReturnType<typeof mapLevels>;
  reviews: MlReviewRow[];
  reviewsCount: number;
}> {
  const params: Record<string, string> = {};
  if (catalogProductId) params.catalog_product_id = catalogProductId;
  try {
    const res = await axios.get(`${ML_API}/reviews/item/${encodeURIComponent(itemId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params,
      timeout: 25000,
    });
    const data = res.data || {};
    const rawReviews = Array.isArray(data.reviews) ? data.reviews : [];
    const reviews = rawReviews.filter(Boolean).map(mapReview);
    const levels = mapLevels(data.rating_levels);
    const avg = Number(data.rating_average);
    const countFromLevels =
      levels.oneStar + levels.twoStar + levels.threeStar + levels.fourStar + levels.fiveStar;
    return {
      ratingAverage: Number.isFinite(avg) ? avg : null,
      ratingLevels: levels,
      reviews,
      reviewsCount: countFromLevels > 0 ? countFromLevels : reviews.length,
    };
  } catch (e: any) {
    const status = e?.response?.status;
    // 404 / sin opiniones: no es error fatal
    if (status === 404 || status === 400) {
      return { ratingAverage: null, ratingLevels: emptyLevels(), reviews: [], reviewsCount: 0 };
    }
    console.warn(`[ML Reviews] item ${itemId}:`, status || e?.message, e?.response?.data || '');
    return { ratingAverage: null, ratingLevels: emptyLevels(), reviews: [], reviewsCount: 0 };
  }
}

async function collectAllItemReviews(
  accessToken: string,
  userId: string,
  opts?: { includeClosed?: boolean; onlyWithReviews?: boolean }
): Promise<MlItemReviewsSummary[]> {
  const statuses = opts?.includeClosed ? ['active', 'paused', 'closed'] : ['active', 'paused'];
  const itemIds = await listSellerItemIds(accessToken, userId, statuses);
  const meta = await multigetItems(accessToken, itemIds);

  const summaries = await mapPool(itemIds, CONCURRENCY, async (itemId) => {
    const info = meta.get(itemId);
    const rev = await fetchItemReviews(accessToken, itemId, info?.catalogProductId);
    const summary: MlItemReviewsSummary = {
      itemId,
      title: info?.title || itemId,
      permalink: info?.permalink || null,
      status: info?.status || null,
      thumbnail: info?.thumbnail || null,
      catalogProductId: info?.catalogProductId || null,
      tiendaNubeProductId: null,
      tiendaNubeProductName: null,
      ratingAverage: rev.ratingAverage,
      reviewsCount: rev.reviewsCount,
      ratingLevels: rev.ratingLevels,
      reviews: rev.reviews,
    };
    return summary;
  });

  let list = summaries;
  if (opts?.onlyWithReviews !== false) {
    list = summaries.filter((s) => s.reviewsCount > 0 || (s.reviews && s.reviews.length > 0));
  }
  await enrichReviewAuthors(accessToken, userId, list);
  list.sort((a, b) => {
    const da = a.ratingAverage ?? -1;
    const db = b.ratingAverage ?? -1;
    if (db !== da) return db - da;
    return (b.reviewsCount || 0) - (a.reviewsCount || 0);
  });
  return list;
}

async function collectAllItemReviewsCached(
  accessToken: string,
  userId: string,
  opts?: { includeClosed?: boolean; onlyWithReviews?: boolean; forceRefresh?: boolean }
): Promise<MlItemReviewsSummary[]> {
  const includeClosed = !!opts?.includeClosed;
  const onlyWithReviews = opts?.onlyWithReviews !== false;
  const key = cacheKey(userId, includeClosed, onlyWithReviews);
  const hit = reviewsCache.get(key);
  if (!opts?.forceRefresh && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.data;
  }
  const data = await collectAllItemReviews(accessToken, userId, { includeClosed, onlyWithReviews });
  reviewsCache.set(key, { at: Date.now(), data });
  return data;
}

/**
 * Lista reseñas/opiniones de publicaciones ML del vendedor.
 * Query: offset, limit, q, min_rate, include_closed, only_with_reviews, refresh
 */
export const getMercadoLibreReviews = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
    }

    const offsetNum = Math.max(0, parseInt((req.query.offset as string) || '0', 10) || 0);
    const limitNum = Math.min(50, Math.max(1, parseInt((req.query.limit as string) || '20', 10) || 20));
    const q = String(req.query.q || '')
      .trim()
      .toLowerCase();
    const minRateRaw = parseFloat(String(req.query.min_rate || ''));
    const minRate = Number.isFinite(minRateRaw) ? minRateRaw : null;
    const includeClosed = String(req.query.include_closed || '') === '1' || String(req.query.include_closed || '') === 'true';
    const onlyWithReviews =
      String(req.query.only_with_reviews || '1') !== '0' && String(req.query.only_with_reviews || '') !== 'false';
    const forceRefresh =
      String(req.query.refresh || '') === '1' || String(req.query.refresh || '') === 'true';

    const all = await attachTiendaNubeLinks(
      await collectAllItemReviewsCached(mlToken.access_token, String(mlToken.user_id), {
        includeClosed,
        onlyWithReviews,
        forceRefresh,
      })
    );

    let filtered = all;
    if (q) {
      filtered = filtered.filter(
        (s) =>
          s.itemId.toLowerCase().includes(q) ||
          s.title.toLowerCase().includes(q) ||
          (s.tiendaNubeProductId && s.tiendaNubeProductId.toLowerCase().includes(q)) ||
          (s.tiendaNubeProductName && s.tiendaNubeProductName.toLowerCase().includes(q)) ||
          s.reviews.some(
            (r) =>
              r.title.toLowerCase().includes(q) ||
              r.content.toLowerCase().includes(q) ||
              (r.authorName && r.authorName.toLowerCase().includes(q))
          )
      );
    }
    if (minRate != null) {
      filtered = filtered.filter((s) => (s.ratingAverage ?? 0) >= minRate);
    }

    const page = filtered.slice(offsetNum, offsetNum + limitNum);
    const totalReviews = filtered.reduce((acc, s) => acc + (s.reviews?.length || 0), 0);
    const rated = filtered.filter((s) => s.ratingAverage != null);
    const avgGlobal =
      rated.length > 0
        ? Math.round((rated.reduce((a, s) => a + (s.ratingAverage || 0), 0) / rated.length) * 10) / 10
        : null;

    const linkedToTn = filtered.filter((s) => !!s.tiendaNubeProductId).length;

    res.json({
      items: page,
      total: filtered.length,
      offset: offsetNum,
      limit: limitNum,
      summary: {
        publicationsWithReviews: filtered.length,
        reviewsReturned: totalReviews,
        ratingAverageGlobal: avgGlobal,
        linkedToTiendaNube: linkedToTn,
        scannedUpTo: ML_REVIEWS_MAX_ITEMS,
      },
    });
  } catch (error: any) {
    const errData = error.response?.data;
    console.error('[ML Reviews]', errData || error.message);
    const msg =
      (typeof errData?.message === 'string' && errData.message) ||
      (typeof errData?.error === 'string' && errData.error) ||
      error.message ||
      'Error al obtener reseñas de Mercado Libre';
    res.status(error.response?.status || 500).json({ message: msg });
  }
};

/**
 * Excel con todas las opiniones de publicaciones ML.
 * Query: include_closed, only_with_reviews
 */
export const exportMercadoLibreReviewsXlsx = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
    }

    const includeClosed = String(req.query.include_closed || '') === '1' || String(req.query.include_closed || '') === 'true';
    const onlyWithReviews =
      String(req.query.only_with_reviews || '1') !== '0' && String(req.query.only_with_reviews || '') !== 'false';

    const all = await attachTiendaNubeLinks(
      await collectAllItemReviewsCached(mlToken.access_token, String(mlToken.user_id), {
        includeClosed,
        onlyWithReviews,
        forceRefresh: true,
      })
    );

    const wb = new ExcelJS.Workbook();
    wb.creator = 'LupoHub';
    wb.created = new Date();

    const wsSummary = wb.addWorksheet('Resumen publicaciones');
    wsSummary.columns = [
      { header: 'Item ID', key: 'itemId', width: 16 },
      { header: 'Título', key: 'title', width: 48 },
      { header: 'Estado', key: 'status', width: 12 },
      { header: 'ID Tienda Nube', key: 'tnId', width: 16 },
      { header: 'Producto Tienda Nube', key: 'tnName', width: 40 },
      { header: 'Promedio', key: 'avg', width: 10 },
      { header: 'Opiniones (total)', key: 'count', width: 16 },
      { header: '1★', key: 's1', width: 8 },
      { header: '2★', key: 's2', width: 8 },
      { header: '3★', key: 's3', width: 8 },
      { header: '4★', key: 's4', width: 8 },
      { header: '5★', key: 's5', width: 8 },
      { header: 'Link', key: 'link', width: 40 },
    ];
    wsSummary.getRow(1).font = { bold: true };
    for (const s of all) {
      wsSummary.addRow({
        itemId: s.itemId,
        title: s.title,
        status: s.status || '',
        tnId: s.tiendaNubeProductId || '',
        tnName: s.tiendaNubeProductName || '',
        avg: s.ratingAverage ?? '',
        count: s.reviewsCount,
        s1: s.ratingLevels.oneStar,
        s2: s.ratingLevels.twoStar,
        s3: s.ratingLevels.threeStar,
        s4: s.ratingLevels.fourStar,
        s5: s.ratingLevels.fiveStar,
        link: s.permalink || '',
      });
    }

    const wsReviews = wb.addWorksheet('Opiniones');
    wsReviews.columns = [
      { header: 'Item ID', key: 'itemId', width: 16 },
      { header: 'Publicación', key: 'title', width: 40 },
      { header: 'ID Tienda Nube', key: 'tnId', width: 16 },
      { header: 'Producto Tienda Nube', key: 'tnName', width: 40 },
      { header: 'Review ID', key: 'reviewId', width: 14 },
      { header: 'Usuario ML', key: 'author', width: 22 },
      { header: 'Estrellas', key: 'rate', width: 10 },
      { header: 'Título opinión', key: 'revTitle', width: 28 },
      { header: 'Contenido', key: 'content', width: 60 },
      { header: 'Estado', key: 'status', width: 12 },
      { header: 'Fecha opinión', key: 'dateCreated', width: 20 },
      { header: 'Fecha compra', key: 'buyingDate', width: 20 },
      { header: 'Likes', key: 'likes', width: 8 },
      { header: 'Dislikes', key: 'dislikes', width: 10 },
      { header: 'Atributos', key: 'attrs', width: 30 },
      { header: 'Link', key: 'link', width: 40 },
    ];
    wsReviews.getRow(1).font = { bold: true };

    const wsTn = wb.addWorksheet('Importar Tienda Nube');
    wsTn.columns = [
      { header: 'author_name', key: 'author_name', width: 24 },
      { header: 'rating', key: 'rating', width: 10 },
      { header: 'content', key: 'content', width: 60 },
      { header: 'product_id', key: 'product_id', width: 14 },
      { header: 'product_name', key: 'product_name', width: 40 },
      { header: 'photo_url', key: 'photo_url', width: 12 },
      { header: 'video_url', key: 'video_url', width: 12 },
      { header: 'voice_url', key: 'voice_url', width: 12 },
      { header: 'status', key: 'status', width: 12 },
      { header: 'created_at', key: 'created_at', width: 14 },
      { header: 'order_id', key: 'order_id', width: 12 },
    ];
    wsTn.getRow(1).font = { bold: true };

    for (const s of all) {
      if (!s.reviews.length) {
        if (!onlyWithReviews) {
          wsReviews.addRow({
            itemId: s.itemId,
            title: s.title,
            tnId: s.tiendaNubeProductId || '',
            tnName: s.tiendaNubeProductName || '',
            reviewId: '',
            author: '',
            rate: '',
            revTitle: '',
            content: '(sin opiniones detalladas en API)',
            status: '',
            dateCreated: '',
            buyingDate: '',
            likes: '',
            dislikes: '',
            attrs: '',
            link: s.permalink || '',
          });
        }
        continue;
      }
      for (const r of s.reviews) {
        const attrs = r.attributes
          .map((a) => [a.name || a.id, a.value_name || a.value_id].filter(Boolean).join(': '))
          .filter(Boolean)
          .join(' | ');
        wsReviews.addRow({
          itemId: s.itemId,
          title: s.title,
          tnId: s.tiendaNubeProductId || '',
          tnName: s.tiendaNubeProductName || '',
          reviewId: r.id,
          author: r.authorName || '',
          rate: r.rate ?? '',
          revTitle: r.title,
          content: r.content,
          status: r.status,
          dateCreated: r.dateCreated || '',
          buyingDate: r.buyingDate || '',
          likes: r.likes,
          dislikes: r.dislikes,
          attrs,
          link: s.permalink || '',
        });

        if (s.tiendaNubeProductId && r.rate != null) {
          wsTn.addRow({
            author_name: r.authorName || 'Comprador Mercado Libre',
            rating: r.rate,
            content: reviewContentForTn(r),
            product_id: s.tiendaNubeProductId,
            product_name: s.tiendaNubeProductName || s.title,
            photo_url: '',
            video_url: '',
            voice_url: '',
            status: tnImportStatus(r.status),
            created_at: toYmd(r.dateCreated),
            order_id: '',
          });
        }
      }
    }

    const buffer = await wb.xlsx.writeBuffer();
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="opiniones_mercadolibre_${stamp}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (error: any) {
    console.error('exportMercadoLibreReviewsXlsx:', error?.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      message: error.message || 'Error al exportar reseñas de Mercado Libre',
    });
  }
};

/**
 * CSV listo para importar opiniones en Tienda Nube (solo publicaciones vinculadas).
 * Query: include_closed, only_with_reviews
 */
export const exportMercadoLibreReviewsTiendaNubeCsv = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
    }

    const includeClosed = String(req.query.include_closed || '') === '1' || String(req.query.include_closed || '') === 'true';
    const onlyWithReviews =
      String(req.query.only_with_reviews || '1') !== '0' && String(req.query.only_with_reviews || '') !== 'false';

    const all = await attachTiendaNubeLinks(
      await collectAllItemReviewsCached(mlToken.access_token, String(mlToken.user_id), {
        includeClosed,
        onlyWithReviews,
        forceRefresh: true,
      })
    );

    const header = [
      'author_name',
      'rating',
      'content',
      'product_id',
      'product_name',
      'photo_url',
      'video_url',
      'voice_url',
      'status',
      'created_at',
      'order_id',
    ];
    const lines = [header.map(csvCell).join(',')];
    for (const s of all) {
      if (!s.tiendaNubeProductId) continue;
      for (const r of s.reviews) {
        if (r.rate == null) continue;
        lines.push(
          [
            r.authorName || 'Comprador Mercado Libre',
            r.rate,
            reviewContentForTn(r),
            s.tiendaNubeProductId,
            s.tiendaNubeProductName || s.title,
            '',
            '',
            '',
            tnImportStatus(r.status),
            toYmd(r.dateCreated),
            '',
          ]
            .map(csvCell)
            .join(',')
        );
      }
    }

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="opiniones_tiendanube_${stamp}.csv"`);
    res.send(`\uFEFF${lines.join('\r\n')}`);
  } catch (error: any) {
    console.error('exportMercadoLibreReviewsTiendaNubeCsv:', error?.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      message: error.message || 'Error al exportar reseñas para Tienda Nube',
    });
  }
};
