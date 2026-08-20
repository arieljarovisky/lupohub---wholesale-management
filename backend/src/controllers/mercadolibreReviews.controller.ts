import { Request, Response } from 'express';
import axios from 'axios';
import ExcelJS from 'exceljs';
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
  attributes: Array<{ id?: string; name?: string; value_id?: string; value_name?: string }>;
};

export type MlItemReviewsSummary = {
  itemId: string;
  title: string;
  permalink: string | null;
  status: string | null;
  thumbnail: string | null;
  catalogProductId: string | null;
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
    attributes: attrs,
  };
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

    const all = await collectAllItemReviewsCached(mlToken.access_token, String(mlToken.user_id), {
      includeClosed,
      onlyWithReviews,
      forceRefresh,
    });

    let filtered = all;
    if (q) {
      filtered = filtered.filter(
        (s) =>
          s.itemId.toLowerCase().includes(q) ||
          s.title.toLowerCase().includes(q) ||
          s.reviews.some((r) => r.title.toLowerCase().includes(q) || r.content.toLowerCase().includes(q))
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

    res.json({
      items: page,
      total: filtered.length,
      offset: offsetNum,
      limit: limitNum,
      summary: {
        publicationsWithReviews: filtered.length,
        reviewsReturned: totalReviews,
        ratingAverageGlobal: avgGlobal,
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

    const all = await collectAllItemReviewsCached(mlToken.access_token, String(mlToken.user_id), {
      includeClosed,
      onlyWithReviews,
      forceRefresh: true,
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'LupoHub';
    wb.created = new Date();

    const wsSummary = wb.addWorksheet('Resumen publicaciones');
    wsSummary.columns = [
      { header: 'Item ID', key: 'itemId', width: 16 },
      { header: 'Título', key: 'title', width: 48 },
      { header: 'Estado', key: 'status', width: 12 },
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
      { header: 'Review ID', key: 'reviewId', width: 14 },
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

    for (const s of all) {
      if (!s.reviews.length) {
        if (!onlyWithReviews) {
          wsReviews.addRow({
            itemId: s.itemId,
            title: s.title,
            reviewId: '',
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
          reviewId: r.id,
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
