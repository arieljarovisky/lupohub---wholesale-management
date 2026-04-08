import { api } from '../services/api';
import { fetchAllAdsForExport } from './productAdsExport';

export type RecRow = {
  itemId: string;
  title: string;
  permalink?: string;
  cost: number;
  clicks: number;
  prints: number;
  totalAmount: number;
  roas: number;
  acos: number;
  reason: string;
};

export type MlStockRow = {
  id: string;
  title: string;
  totalStock: number;
  soldTotal: number;
  permalink?: string;
  dateCreated?: string | null;
  /** Precio actual de la publicación (API ML), si viene en stock. */
  price?: number | null;
};

function toNum(v: unknown): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeMlItemId(raw: unknown): string {
  return (raw ?? '').toString().trim().toUpperCase();
}

function aggregateByItem(ads: any[]): Map<
  string,
  { title: string; permalink?: string; cost: number; clicks: number; prints: number; totalAmount: number }
> {
  const m = new Map<
    string,
    { title: string; permalink?: string; cost: number; clicks: number; prints: number; totalAmount: number }
  >();
  for (const row of ads) {
    const itemId = normalizeMlItemId(row.item_id);
    if (!itemId) continue;
    const met = row.metrics || {};
    const prev = m.get(itemId) ?? {
      title: '',
      permalink: undefined as string | undefined,
      cost: 0,
      clicks: 0,
      prints: 0,
      totalAmount: 0
    };
    if (!prev.title) prev.title = (row.title ?? '').toString();
    if (!prev.permalink && row.permalink) prev.permalink = row.permalink;
    prev.cost += toNum(met.cost);
    prev.clicks += toNum(met.clicks);
    prev.prints += toNum(met.prints);
    prev.totalAmount += toNum(met.total_amount);
    m.set(itemId, prev);
  }
  return m;
}

/** Agrupa anuncios por publicación y clasifica según ROAS, costo y clics. */
export function computeRecommendationsFromAds(
  ads: any[],
  opts?: { minCost?: number; minClicksScale?: number; roasGood?: number; roasBad?: number }
): {
  potenciar: RecRow[];
  revisar: RecRow[];
  advertisedIds: Set<string>;
} {
  const minCost = opts?.minCost ?? 200;
  const minClicksScale = opts?.minClicksScale ?? 3;
  const roasGood = opts?.roasGood ?? 2.2;
  const roasBad = opts?.roasBad ?? 1.3;

  const agg = aggregateByItem(ads);
  const rows: RecRow[] = [];
  for (const [itemId, v] of agg) {
    const roas = v.cost > 0 ? v.totalAmount / v.cost : 0;
    const acos = v.totalAmount > 0 ? (v.cost / v.totalAmount) * 100 : 0;
    rows.push({
      itemId,
      title: v.title || itemId,
      permalink: v.permalink,
      cost: v.cost,
      clicks: v.clicks,
      prints: v.prints,
      totalAmount: v.totalAmount,
      roas,
      acos,
      reason: ''
    });
  }

  let potenciar = rows
    .filter((r) => r.cost >= minCost && r.clicks >= minClicksScale && r.roas >= roasGood)
    .sort((a, b) => b.roas - a.roas)
    .slice(0, 15)
    .map((r) => ({
      ...r,
      reason: `ROAS ${r.roas.toFixed(2)}× con inversión y clics suficientes en el período.`
    }));

  let revisar = rows
    .filter((r) => r.cost >= minCost && (r.roas < roasBad || (r.clicks >= 15 && r.totalAmount === 0)))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 15)
    .map((r) => ({
      ...r,
      reason:
        r.totalAmount === 0 && r.clicks >= 15
          ? 'Muchos clics sin ventas atribuidas: revisá precio, ficha o pausá.'
          : `ROAS bajo (${r.roas.toFixed(2)}×): revisá puja, creatividad o pausá.`
    }));

  const potIds = new Set(potenciar.map((p) => p.itemId));
  revisar = revisar.filter((r) => !potIds.has(r.itemId));

  const advertisedIds = new Set(rows.map((r) => r.itemId));

  return { potenciar, revisar, advertisedIds };
}

export async function fetchMlStockForRecs(maxItems = 1500): Promise<MlStockRow[]> {
  const page = 50;
  const out: MlStockRow[] = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total && out.length < maxItems) {
    const r = await api.getMercadoLibreStock({ offset, limit: page, status: 'active' });
    total = r.total ?? 0;
    const batch = r.items || [];
    for (const it of batch) {
      out.push({
        id: normalizeMlItemId(it.id),
        title: (it.title ?? '').toString(),
        totalStock: toNum(it.totalStock),
        soldTotal: toNum(it.soldTotal),
        permalink: it.permalink,
        dateCreated: (it.dateCreated ?? it.date_created ?? null) as string | null,
        price: it.price != null ? toNum(it.price) : null
      });
    }
    offset += page;
    if (batch.length === 0) break;
  }
  return out.slice(0, maxItems);
}

/**
 * Candidatas a Oferta Relámpago: buen equilibrio rotación + stock para soportar cupo y descuento.
 * La postulación y reglas finales se configuran en Mercado Libre.
 */
export function computeRelampagoCandidates(
  stock: MlStockRow[],
  potenciar: RecRow[],
  opts?: { minStock?: number; minSold?: number; limit?: number }
): RecRow[] {
  const minStock = opts?.minStock ?? 4;
  const minSold = opts?.minSold ?? 2;
  const limit = opts?.limit ?? 12;

  const roasById = new Map<string, number>();
  for (const p of potenciar) {
    roasById.set(normalizeMlItemId(p.itemId), p.roas);
  }

  const scored = stock
    .filter((s) => s.totalStock >= minStock && s.soldTotal >= minSold)
    .map((s) => {
      const roas = roasById.get(s.id) ?? 0;
      const score = s.soldTotal * 15 + Math.min(s.totalStock, 80) * 2 + (roas >= 2.2 ? 40 : 0);
      return { s, score, roas };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ s, roas }) => {
    const priceHint =
      s.price != null && s.price > 0
        ? ` Precio actual ~$${Math.round(s.price).toLocaleString('es-AR')}; probá un descuento agresivo respetando tu piso.`
        : '';
    const adsHint =
      roas >= 2.2
        ? ' Rinde bien en Product Ads: suele aguantar una promo fuerte si el margen lo permite.'
        : '';
    return {
      itemId: s.id,
      title: s.title,
      permalink: s.permalink,
      cost: 0,
      clicks: 0,
      prints: 0,
      totalAmount: 0,
      roas: 0,
      acos: 0,
      reason: `Oferta Relámpago: ${s.soldTotal} ventas históricas y stock ${s.totalStock} unidades.${adsHint}${priceHint} Postulá desde la herramienta de promociones en Mercado Libre.`
    };
  });
}

function isCreatedInLastDays(rawDate: string | null | undefined, days: number): boolean {
  if (!rawDate) return false;
  const d = new Date(rawDate);
  if (Number.isNaN(d.getTime())) return false;
  const now = Date.now();
  const diffMs = now - d.getTime();
  return diffMs >= 0 && diffMs <= days * 24 * 60 * 60 * 1000;
}

/** Publicaciones con demanda orgánica y stock que no aparecen en métricas de Product Ads del período. */
export function computeStockCandidates(
  stock: MlStockRow[],
  advertisedIds: Set<string>,
  opts?: { minStock?: number; minSold?: number; limit?: number }
): RecRow[] {
  const minStock = opts?.minStock ?? 2;
  const minSold = opts?.minSold ?? 1;
  const limit = opts?.limit ?? 15;

  const candidates = stock
    .filter((s) => !advertisedIds.has(s.id) && s.totalStock >= minStock && s.soldTotal >= minSold)
    .sort((a, b) => b.soldTotal - a.soldTotal || b.totalStock - a.totalStock)
    .slice(0, limit);

  return candidates.map((s) => ({
    itemId: s.id,
    title: s.title,
    permalink: s.permalink,
    cost: 0,
    clicks: 0,
    prints: 0,
    totalAmount: 0,
    roas: 0,
    acos: 0,
    reason: `Vendió ${s.soldTotal} u. con stock ${s.totalStock}: conviene probarlo en Product Ads si aún no está en campaña.`
  }));
}

export async function loadProductAdsRecommendations(
  siteId: string,
  advertiserId: number,
  dateFrom: string,
  dateTo: string
): Promise<{
  potenciar: RecRow[];
  revisar: RecRow[];
  sumar: RecRow[];
  lanzamientos: RecRow[];
  relampago: RecRow[];
  stats: { adsAnalyzed: number; stockFetched: number };
}> {
  const [ads, stock] = await Promise.all([
    fetchAllAdsForExport(siteId, advertiserId, dateFrom, dateTo),
    fetchMlStockForRecs(1500)
  ]);
  const { potenciar, revisar, advertisedIds } = computeRecommendationsFromAds(ads);
  const sumar = computeStockCandidates(stock, advertisedIds);
  const relampago = computeRelampagoCandidates(stock, potenciar);
  const lanzamientos = stock
    .filter((s) => isCreatedInLastDays(s.dateCreated, 30))
    .sort((a, b) => b.soldTotal - a.soldTotal || b.totalStock - a.totalStock)
    .slice(0, 15)
    .map((s) => ({
      itemId: s.id,
      title: s.title,
      permalink: s.permalink,
      cost: 0,
      clicks: 0,
      prints: 0,
      totalAmount: 0,
      roas: 0,
      acos: 0,
      reason: `Lanzamiento (creado en últimos 30 días) con stock ${s.totalStock} y ${s.soldTotal} ventas.`
    }));
  return {
    potenciar,
    revisar,
    sumar,
    lanzamientos,
    relampago,
    stats: { adsAnalyzed: ads.length, stockFetched: stock.length }
  };
}
