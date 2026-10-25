import { query } from '../database/db';
import { nombreTalleDesdeCodigo } from '../talles-tango';
import { LUPO_CATALOG_SOURCES, matchCurrentCatalog } from '../data/lupoCurrentCatalog';

export type BrazilSuggestionPriority = 'agotado' | 'critico' | 'pedir' | 'ok' | 'sin_venta';

export type BrazilSuggestionParams = {
  periodDays: number;
  leadTimeDays: number;
  coverageDays: number;
};

export type BrazilSuggestionVariant = {
  variantId: string;
  colorName: string;
  colorCode: string;
  sizeCode: string;
  sizeLabel: string;
  stock: number;
  incoming: number;
  available: number;
  soldTn: number;
  soldMl: number;
  soldMay: number;
  sold: number;
  dailyRate: number;
  daysOfCover: number | null;
  suggestedQty: number;
  priority: BrazilSuggestionPriority;
};

export type BrazilSuggestionArticle = {
  productId: string;
  sku: string;
  name: string;
  category: string;
  packSize: number;
  stock: number;
  incoming: number;
  available: number;
  soldTn: number;
  soldMl: number;
  soldMay: number;
  sold: number;
  dailyRate: number;
  daysOfCover: number | null;
  suggestedQty: number;
  priority: BrazilSuggestionPriority;
  inCatalog: boolean;
  catalogLabel: string | null;
  catalogCode: string | null;
  variants: BrazilSuggestionVariant[];
};

export type BrazilSuggestionResult = {
  periodDays: number;
  leadTimeDays: number;
  coverageDays: number;
  from: string;
  to: string;
  summary: {
    articles: number;
    articlesToOrder: number;
    unitsToOrder: number;
    urgent: number;
    soldInPeriod: number;
    stockUnits: number;
    incomingUnits: number;
    discontinuedWithDemand: number;
  };
  catalogSources: string[];
  articles: BrazilSuggestionArticle[];
};

const PRIORITY_RANK: Record<BrazilSuggestionPriority, number> = {
  agotado: 0,
  critico: 1,
  pedir: 2,
  ok: 3,
  sin_venta: 4
};

const SIZE_ORDER = ['4', '6', '8', '10', '12', '14', 'P', 'M', 'G', 'GG', 'U', 'XG', 'XXG', 'XXXG', 'S', 'L', 'XL'];

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function parseBrazilSuggestionParams(queryParams: Record<string, unknown>): BrazilSuggestionParams {
  return {
    periodDays: clampInt(queryParams.periodDays ?? queryParams.period, 90, 7, 365),
    leadTimeDays: clampInt(queryParams.leadTimeDays ?? queryParams.leadTime, 45, 7, 180),
    coverageDays: clampInt(queryParams.coverageDays ?? queryParams.coverage, 60, 7, 365)
  };
}

export function sizeSortKey(label: string): string {
  const i = SIZE_ORDER.indexOf(label.toUpperCase());
  return i >= 0 ? String(i).padStart(3, '0') : `9${label}`;
}

export function compareSizes(a: string, b: string): number {
  return sizeSortKey(a).localeCompare(sizeSortKey(b), undefined, { numeric: true });
}

function roundRate(n: number): number {
  return Math.round(n * 100) / 100;
}

function computePriority(
  sold: number,
  available: number,
  daysOfCover: number | null,
  suggestedQty: number,
  leadTimeDays: number
): BrazilSuggestionPriority {
  if (sold <= 0) return 'sin_venta';
  if (available <= 0) return 'agotado';
  if (daysOfCover != null && daysOfCover < leadTimeDays) return 'critico';
  if (suggestedQty > 0) return 'pedir';
  return 'ok';
}

function worstPriority(list: BrazilSuggestionPriority[]): BrazilSuggestionPriority {
  return list.reduce((best, cur) => (PRIORITY_RANK[cur] < PRIORITY_RANK[best] ? cur : best), 'sin_venta');
}

function suggestUnits(dailyRate: number, available: number, horizonDays: number): number {
  if (dailyRate <= 0) return 0;
  const target = dailyRate * horizonDays;
  return Math.max(0, Math.ceil(target - available));
}

function daysOfCover(available: number, dailyRate: number): number | null {
  if (dailyRate <= 0) return null;
  return roundRate(Math.max(0, available) / dailyRate);
}

type CatalogRow = {
  variant_id: string;
  product_id: string;
  product_sku: string | null;
  product_name: string;
  category: string | null;
  pack_size: string | number | null;
  color_name: string | null;
  color_code: string | null;
  size_code: string | null;
  size_name: string | null;
  stock: string | number | null;
};

type QtyRow = { variant_id: string; units: string | number | null };
type ChannelQtyRow = QtyRow & { channel: string };

export async function buildBrazilOrderSuggestion(params: BrazilSuggestionParams): Promise<BrazilSuggestionResult> {
  const { periodDays, leadTimeDays, coverageDays } = params;
  const horizonDays = leadTimeDays + coverageDays;
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - periodDays);
  const from = ymd(fromDate);
  const to = ymd(toDate);
  const fromDt = `${from} 00:00:00`;
  const toDt = `${to} 23:59:59`;

  const catalog = (await query(
    `
    SELECT
      pv.id AS variant_id,
      p.id AS product_id,
      p.sku AS product_sku,
      p.name AS product_name,
      p.category,
      COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS pack_size,
      c.name AS color_name,
      c.code AS color_code,
      s.size_code,
      s.name AS size_name,
      COALESCE(st.stock, 0) AS stock
    FROM product_variants pv
    JOIN product_colors pc ON pc.id = pv.product_color_id
    JOIN products p ON p.id = pc.product_id
    JOIN colors c ON c.id = pc.color_id
    JOIN sizes s ON s.id = pv.size_id
    LEFT JOIN stocks st ON st.variant_id = pv.id
    WHERE COALESCE(pv.inventory_hidden, 0) = 0
    `
  )) as CatalogRow[];

  const channelSales = (await query(
    `
    SELECT
      sm.variant_id,
      CASE
        WHEN sm.movement_type IN ('VENTA_TIENDA_NUBE', 'CANCEL_VENTA_TIENDA_NUBE') THEN 'tn'
        ELSE 'ml'
      END AS channel,
      SUM(-sm.quantity_change) AS units
    FROM stock_movements sm
    WHERE sm.created_at BETWEEN ? AND ?
      AND sm.movement_type IN (
        'VENTA_TIENDA_NUBE',
        'VENTA_MERCADO_LIBRE',
        'CANCEL_VENTA_TIENDA_NUBE',
        'CANCEL_VENTA_MERCADO_LIBRE'
      )
    GROUP BY sm.variant_id,
      CASE
        WHEN sm.movement_type IN ('VENTA_TIENDA_NUBE', 'CANCEL_VENTA_TIENDA_NUBE') THEN 'tn'
        ELSE 'ml'
      END
    `,
    [fromDt, toDt]
  )) as ChannelQtyRow[];

  const wholesaleSales = (await query(
    `
    SELECT
      oi.variant_id,
      SUM(
        CASE
          WHEN COALESCE(oi.sell_as_pack, 0) = 1
          THEN oi.quantity * COALESCE(NULLIF(p.mayorista_pack_size, 0), 1)
          ELSE oi.quantity
        END
      ) AS units
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN product_variants pv ON pv.id = oi.variant_id
    JOIN product_colors pc ON pc.id = pv.product_color_id
    JOIN products p ON p.id = pc.product_id
    WHERE o.status NOT IN ('Cancelado', 'Borrador')
      AND o.date BETWEEN ? AND ?
    GROUP BY oi.variant_id
    `,
    [from, to]
  )) as QtyRow[];

  let incomingRows: QtyRow[] = [];
  try {
    incomingRows = (await query(
      `
      SELECT di.variant_id, SUM(di.cantidad) AS units
      FROM despacho_items di
      JOIN despachos d ON d.id = di.despacho_id
      WHERE d.estado IN ('en_transito', 'en_aduana')
        AND di.variant_id IS NOT NULL
        AND di.variant_id <> ''
      GROUP BY di.variant_id
      `
    )) as QtyRow[];
  } catch (err) {
    console.warn('[brazil-order] No se pudo leer mercadería en camino:', (err as Error)?.message || err);
  }

  const soldTn = new Map<string, number>();
  const soldMl = new Map<string, number>();
  for (const row of channelSales) {
    const id = String(row.variant_id || '');
    if (!id) continue;
    const units = Math.max(0, toNum(row.units));
    if (row.channel === 'tn') soldTn.set(id, (soldTn.get(id) || 0) + units);
    else soldMl.set(id, (soldMl.get(id) || 0) + units);
  }

  const soldMay = new Map<string, number>();
  for (const row of wholesaleSales) {
    const id = String(row.variant_id || '');
    if (!id) continue;
    soldMay.set(id, Math.max(0, toNum(row.units)));
  }

  const incomingMap = new Map<string, number>();
  for (const row of incomingRows) {
    const id = String(row.variant_id || '');
    if (!id) continue;
    incomingMap.set(id, Math.max(0, toNum(row.units)));
  }

  const byProduct = new Map<
    string,
    {
      productId: string;
      sku: string;
      name: string;
      category: string;
      packSize: number;
      variants: BrazilSuggestionVariant[];
    }
  >();

  for (const row of catalog) {
    const variantId = String(row.variant_id);
    const productId = String(row.product_id);
    const sizeCode = String(row.size_code || '').trim();
    const sizeLabel = nombreTalleDesdeCodigo(sizeCode) || String(row.size_name || sizeCode || '').trim() || '—';
    const tn = soldTn.get(variantId) || 0;
    const ml = soldMl.get(variantId) || 0;
    const may = soldMay.get(variantId) || 0;
    const sold = tn + ml + may;
    const stock = toNum(row.stock);
    const incoming = incomingMap.get(variantId) || 0;
    const available = stock + incoming;
    const dailyRate = sold / periodDays;
    const cover = daysOfCover(available, dailyRate);
    const suggestedQty = suggestUnits(dailyRate, available, horizonDays);
    const variant: BrazilSuggestionVariant = {
      variantId,
      colorName: String(row.color_name || '').trim() || 'Sin color',
      colorCode: String(row.color_code || '').trim(),
      sizeCode,
      sizeLabel,
      stock,
      incoming,
      available,
      soldTn: tn,
      soldMl: ml,
      soldMay: may,
      sold,
      dailyRate: roundRate(dailyRate),
      daysOfCover: cover,
      suggestedQty,
      priority: computePriority(sold, available, cover, suggestedQty, leadTimeDays)
    };

    const existing = byProduct.get(productId);
    if (existing) {
      existing.variants.push(variant);
    } else {
      byProduct.set(productId, {
        productId,
        sku: String(row.product_sku || '').trim() || productId,
        name: String(row.product_name || '').trim() || 'Artículo',
        category: String(row.category || '').trim(),
        packSize: Math.max(1, toNum(row.pack_size) || 1),
        variants: [variant]
      });
    }
  }

  const articles: BrazilSuggestionArticle[] = Array.from(byProduct.values()).map((p) => {
    p.variants.sort((a, b) => {
      const colorCmp = a.colorName.localeCompare(b.colorName, 'es');
      if (colorCmp !== 0) return colorCmp;
      return compareSizes(a.sizeLabel, b.sizeLabel);
    });
    const stock = p.variants.reduce((s, v) => s + v.stock, 0);
    const incoming = p.variants.reduce((s, v) => s + v.incoming, 0);
    const available = stock + incoming;
    const soldTnTotal = p.variants.reduce((s, v) => s + v.soldTn, 0);
    const soldMlTotal = p.variants.reduce((s, v) => s + v.soldMl, 0);
    const soldMayTotal = p.variants.reduce((s, v) => s + v.soldMay, 0);
    const sold = soldTnTotal + soldMlTotal + soldMayTotal;
    const dailyRate = sold / periodDays;
    const cover = daysOfCover(available, dailyRate);
    const catalog = matchCurrentCatalog(p.sku);
    const suggestedQty = p.variants.reduce((s, v) => s + v.suggestedQty, 0);
    const soldVariants = p.variants.filter((v) => v.sold > 0);
    const priority = soldVariants.length
      ? worstPriority(soldVariants.map((v) => v.priority))
      : 'sin_venta';
    return {
      productId: p.productId,
      sku: p.sku,
      name: p.name,
      category: p.category,
      packSize: p.packSize,
      stock,
      incoming,
      available,
      soldTn: soldTnTotal,
      soldMl: soldMlTotal,
      soldMay: soldMayTotal,
      sold,
      dailyRate: roundRate(dailyRate),
      daysOfCover: cover,
      suggestedQty,
      priority,
      inCatalog: !!catalog,
      catalogLabel: catalog?.catalog ?? null,
      catalogCode: catalog?.code ?? null,
      variants: p.variants
    };
  });

  articles.sort((a, b) => {
    const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (pr !== 0) return pr;
    if (b.suggestedQty !== a.suggestedQty) return b.suggestedQty - a.suggestedQty;
    if (b.sold !== a.sold) return b.sold - a.sold;
    return a.name.localeCompare(b.name, 'es');
  });

  const catalogArticles = articles.filter((a) => a.inCatalog);
  const toOrder = catalogArticles.filter((a) => a.suggestedQty > 0);
  return {
    periodDays,
    leadTimeDays,
    coverageDays,
    from,
    to,
    catalogSources: [...LUPO_CATALOG_SOURCES],
    summary: {
      articles: catalogArticles.length,
      articlesToOrder: toOrder.length,
      unitsToOrder: toOrder.reduce((s, a) => s + a.suggestedQty, 0),
      urgent: catalogArticles.filter((a) => a.priority === 'agotado' || a.priority === 'critico').length,
      soldInPeriod: catalogArticles.reduce((s, a) => s + a.sold, 0),
      stockUnits: catalogArticles.reduce((s, a) => s + a.stock, 0),
      discontinuedWithDemand: articles.filter((a) => !a.inCatalog && a.sold > 0).length,
      incomingUnits: catalogArticles.reduce((s, a) => s + a.incoming, 0)
    },
    articles
  };
}
