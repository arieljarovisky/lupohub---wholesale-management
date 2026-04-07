import * as XLSX from 'xlsx';
import { api } from '../services/api';

export type ProductAdsExportMeta = {
  siteId: string;
  advertiserId: number;
  accountLabel: string;
  dateFrom: string;
  dateTo: string;
  exportedAt: string;
  scopeNote: string;
};

const PAGE = 50;

function toNum(v: unknown): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sumMetrics(rows: any[], key: string): number {
  return rows.reduce((acc, r) => acc + toNum(r?.metrics?.[key]), 0);
}

/** KPIs coherentes con la pantalla Product Ads (resumen API o suma de campañas). */
export function computeProductAdsTotals(
  metricsSummary: Record<string, number> | null,
  campaigns: any[]
) {
  const base = metricsSummary || {};
  const cost = toNum(base.cost) || sumMetrics(campaigns, 'cost');
  const clicks = toNum(base.clicks) || sumMetrics(campaigns, 'clicks');
  const prints = toNum(base.prints) || sumMetrics(campaigns, 'prints');
  const totalAmount = toNum(base.total_amount) || sumMetrics(campaigns, 'total_amount');
  const roasApi = toNum(base.roas);
  const acosApi = toNum(base.acos);
  const ctrApi = toNum(base.ctr);
  const roas = cost > 0 && totalAmount > 0 ? totalAmount / cost : roasApi;
  const acos = totalAmount > 0 ? (cost / totalAmount) * 100 : acosApi;
  const ctr = prints > 0 ? (clicks / prints) * 100 : ctrApi;
  return { cost, clicks, prints, totalAmount, roas, acos, ctr };
}

function safeFilenamePart(s: string): string {
  return s.replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, '_');
}

function escCsv(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** CSV con separador `;` (Excel en español). */
export function buildCsv(rows: Record<string, unknown>[], columns: { key: string; header: string }[]): string {
  const header = columns.map((c) => escCsv(c.header)).join(';');
  const lines = rows.map((row) => columns.map((c) => escCsv(row[c.key])).join(';'));
  return '\uFEFF' + [header, ...lines].join('\r\n');
}

export function downloadTextFile(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function campaignRow(c: any): Record<string, unknown> {
  const m = c.metrics || {};
  return {
    'ID campaña': c.id,
    Nombre: c.name ?? '',
    Estado: c.status ?? '',
    Estrategia: c.strategy ?? '',
    Canal: c.channel ?? '',
    'Presupuesto diario': c.budget ?? '',
    Costo: m.cost ?? '',
    Clicks: m.clicks ?? '',
    Impresiones: m.prints ?? '',
    CTR: m.ctr ?? '',
    CPC: m.cpc ?? '',
    'Ventas total': m.total_amount ?? '',
    'Ventas directas': m.direct_amount ?? '',
    'Ventas indirectas': m.indirect_amount ?? '',
    ROAS: m.roas ?? '',
    ACOS: m.acos ?? '',
    CVR: m.cvr ?? '',
    Unidades: m.units_quantity ?? '',
    SOV: m.sov ?? ''
  };
}

function adRow(row: any): Record<string, unknown> {
  const m = row.metrics || {};
  const description =
    row.description ??
    row.item_description ??
    row.item?.description ??
    '';
  return {
    'Item ID': row.item_id ?? '',
    Título: row.title ?? '',
    Descripción: description,
    Estado: row.status ?? '',
    'ID campaña': row.campaign_id ?? '',
    Precio: row.price ?? '',
    URL: row.permalink ?? '',
    Costo: m.cost ?? '',
    Clicks: m.clicks ?? '',
    Impresiones: m.prints ?? '',
    'Ventas total': m.total_amount ?? '',
    ROAS: m.roas ?? '',
    ACOS: m.acos ?? '',
    CVR: m.cvr ?? '',
    CPC: m.cpc ?? ''
  };
}

const CAMPAIGN_CSV_COLS: { key: string; header: string }[] = [
  { key: 'ID campaña', header: 'ID campaña' },
  { key: 'Nombre', header: 'Nombre' },
  { key: 'Estado', header: 'Estado' },
  { key: 'Estrategia', header: 'Estrategia' },
  { key: 'Canal', header: 'Canal' },
  { key: 'Presupuesto diario', header: 'Presupuesto diario' },
  { key: 'Costo', header: 'Costo' },
  { key: 'Clicks', header: 'Clicks' },
  { key: 'Impresiones', header: 'Impresiones' },
  { key: 'CTR', header: 'CTR' },
  { key: 'CPC', header: 'CPC' },
  { key: 'Ventas total', header: 'Ventas total' },
  { key: 'Ventas directas', header: 'Ventas directas' },
  { key: 'Ventas indirectas', header: 'Ventas indirectas' },
  { key: 'ROAS', header: 'ROAS' },
  { key: 'ACOS', header: 'ACOS' },
  { key: 'CVR', header: 'CVR' },
  { key: 'Unidades', header: 'Unidades' },
  { key: 'SOV', header: 'SOV' }
];

const ADS_CSV_COLS: { key: string; header: string }[] = [
  { key: 'Item ID', header: 'Item ID' },
  { key: 'Título', header: 'Título' },
  { key: 'Descripción', header: 'Descripción' },
  { key: 'Estado', header: 'Estado' },
  { key: 'ID campaña', header: 'ID campaña' },
  { key: 'Precio', header: 'Precio' },
  { key: 'URL', header: 'URL' },
  { key: 'Costo', header: 'Costo' },
  { key: 'Clicks', header: 'Clicks' },
  { key: 'Impresiones', header: 'Impresiones' },
  { key: 'Ventas total', header: 'Ventas total' },
  { key: 'ROAS', header: 'ROAS' },
  { key: 'ACOS', header: 'ACOS' },
  { key: 'CVR', header: 'CVR' },
  { key: 'CPC', header: 'CPC' }
];

export function downloadCampaignsCsv(campaigns: any[], baseName: string) {
  const rows = campaigns.map(campaignRow);
  downloadTextFile(buildCsv(rows, CAMPAIGN_CSV_COLS), `${baseName}_campañas.csv`);
}

export function downloadAdsCsv(ads: any[], baseName: string) {
  const rows = ads.map(adRow);
  downloadTextFile(buildCsv(rows, ADS_CSV_COLS), `${baseName}_publicaciones.csv`);
}

/** Todas las publicaciones/anuncios con métricas de una campaña (paginado, Product Ads). */
export async function fetchAllAdsForSingleCampaignExport(
  siteId: string,
  advertiserId: number,
  campaignId: string | number,
  dateFrom: string,
  dateTo: string
): Promise<any[]> {
  const first = await api.getMercadoLibreProductAdsAds({
    site_id: siteId,
    advertiser_id: advertiserId,
    date_from: dateFrom,
    date_to: dateTo,
    limit: PAGE,
    offset: 0,
    channel: 'marketplace',
    campaign_id: campaignId
  });
  const list = [...(first.results || [])];
  const total = first.paging?.total ?? list.length;
  let offset = PAGE;
  while (offset < total) {
    const r = await api.getMercadoLibreProductAdsAds({
      site_id: siteId,
      advertiser_id: advertiserId,
      date_from: dateFrom,
      date_to: dateTo,
      limit: PAGE,
      offset,
      channel: 'marketplace',
      campaign_id: campaignId
    });
    const batch = r.results || [];
    if (batch.length === 0) break;
    list.push(...batch);
    offset += PAGE;
  }
  return list;
}

/** Una sola campaña: CSV de la campaña + CSV de cada anuncio/publicación de esa campaña. */
export async function downloadSingleCampaignCsv(
  campaign: any,
  opts: { dateFrom: string; dateTo: string; siteId: string; advertiserId: number }
) {
  const id = safeFilenamePart(String(campaign?.id ?? 'campaña'));
  const base = `Campaña_${id}_${opts.dateFrom}_${opts.dateTo}`;
  downloadTextFile(buildCsv([campaignRow(campaign)], CAMPAIGN_CSV_COLS), `${base}_campaña.csv`);
  const ads = await fetchAllAdsForSingleCampaignExport(
    opts.siteId,
    opts.advertiserId,
    campaign?.id,
    opts.dateFrom,
    opts.dateTo
  );
  if (ads.length > 0) {
    downloadAdsCsv(ads, base);
  }
}

/** Una sola campaña: Excel con resumen, métricas de campaña y hoja de anuncios por publicación. */
export async function downloadSingleCampaignExcel(
  campaign: any,
  opts: {
    accountLabel: string;
    siteId: string;
    advertiserId: number;
    dateFrom: string;
    dateTo: string;
  }
) {
  const ads = await fetchAllAdsForSingleCampaignExport(
    opts.siteId,
    opts.advertiserId,
    campaign?.id,
    opts.dateFrom,
    opts.dateTo
  );
  const wb = XLSX.utils.book_new();
  const id = campaign?.id ?? '';
  const name = (campaign?.name ?? '').toString();
  const resumen: (string | number)[][] = [
    ['Campaña individual — Product Ads'],
    ['ID campaña', id],
    ['Nombre', name],
    ['Período desde', opts.dateFrom],
    ['Período hasta', opts.dateTo],
    ['Cuenta', opts.accountLabel],
    ['Site', opts.siteId],
    ['ID anunciante', opts.advertiserId],
    ['Anuncios / publicaciones en el archivo', ads.length],
    [],
    ['Exportado', new Date().toLocaleString('es-AR')],
    [],
    [
      'Nota',
      'Hoja Campaña: totales de la campaña. Hoja Anuncios: una fila por publicación con métricas del período (misma API que la tabla de publicaciones).'
    ]
  ];
  const ws0 = XLSX.utils.aoa_to_sheet(resumen);
  XLSX.utils.book_append_sheet(wb, ws0, 'Resumen');
  const row = campaignRow(campaign);
  const ws1 = XLSX.utils.json_to_sheet([row]);
  XLSX.utils.book_append_sheet(wb, ws1, 'Campaña');
  const adsData = ads.map(adRow);
  const ws2 =
    adsData.length > 0
      ? XLSX.utils.json_to_sheet(adsData)
      : XLSX.utils.aoa_to_sheet([['Sin publicaciones con métricas en el período para esta campaña.']]);
  XLSX.utils.book_append_sheet(wb, ws2, 'Anuncios');
  const fname = `Campaña_${safeFilenamePart(String(id))}_${opts.dateFrom}_${opts.dateTo}.xlsx`;
  XLSX.writeFile(wb, fname);
}

export function downloadProductAdsExcel(params: {
  meta: ProductAdsExportMeta;
  metricsSummary: Record<string, number> | null;
  totals: {
    cost: number;
    clicks: number;
    prints: number;
    totalAmount: number;
    roas: number;
    acos: number;
    ctr: number;
  };
  campaigns: any[];
  ads: any[];
}) {
  const { meta, metricsSummary, totals, campaigns, ads } = params;
  const wb = XLSX.utils.book_new();

  const resumen: (string | number)[][] = [
    ['Reporte Product Ads — Lupo Hub'],
    ['Hoja Campañas', 'Métricas por campaña de Product Ads (una fila por campaña).'],
    ['Hoja Publicaciones', 'Métricas por publicación promocionada (una fila por ítem / anuncio).'],
    [],
    ['Cuenta', meta.accountLabel],
    ['Site', meta.siteId],
    ['ID anunciante', meta.advertiserId],
    ['Período desde', meta.dateFrom],
    ['Período hasta', meta.dateTo],
    ['Exportado', meta.exportedAt],
    ['Alcance del archivo', meta.scopeNote],
    [],
    ['KPIs (panel)'],
    ['Inversión (costo)', totals.cost],
    ['Ventas atribuidas (importe)', totals.totalAmount],
    ['ROAS', totals.roas],
    ['ACOS %', totals.acos],
    ['CTR %', totals.ctr],
    ['Clicks', totals.clicks],
    ['Impresiones', totals.prints]
  ];

  if (metricsSummary && Object.keys(metricsSummary).length > 0) {
    resumen.push([], ['Métricas agregadas (API / resumen)']);
    for (const [k, v] of Object.entries(metricsSummary)) {
      resumen.push([k, v]);
    }
  }

  const ws0 = XLSX.utils.aoa_to_sheet(resumen);
  XLSX.utils.book_append_sheet(wb, ws0, 'Resumen');

  const campData = campaigns.map(campaignRow);
  const ws1 = XLSX.utils.json_to_sheet(campData);
  XLSX.utils.book_append_sheet(wb, ws1, 'Campañas');

  const adsData = ads.map(adRow);
  const ws2 = XLSX.utils.json_to_sheet(adsData);
  XLSX.utils.book_append_sheet(wb, ws2, 'Publicaciones');

  const fname = `ProductAds_${safeFilenamePart(meta.siteId)}_${meta.dateFrom}_${meta.dateTo}.xlsx`;
  XLSX.writeFile(wb, fname);
}

/** Descarga todas las campañas del período (paginado). Devuelve filas y resumen de la primera respuesta. */
export async function fetchAllCampaignsForExport(
  siteId: string,
  advertiserId: number,
  dateFrom: string,
  dateTo: string
): Promise<{ campaigns: any[]; metricsSummary: Record<string, number> | null }> {
  const first = await api.getMercadoLibreProductAdsCampaigns({
    site_id: siteId,
    advertiser_id: advertiserId,
    date_from: dateFrom,
    date_to: dateTo,
    limit: PAGE,
    offset: 0,
    metrics_summary: true
  });
  const list = [...(first.results || [])];
  const total = first.paging?.total ?? list.length;
  let offset = PAGE;
  while (offset < total) {
    const r = await api.getMercadoLibreProductAdsCampaigns({
      site_id: siteId,
      advertiser_id: advertiserId,
      date_from: dateFrom,
      date_to: dateTo,
      limit: PAGE,
      offset,
      metrics_summary: false
    });
    const batch = r.results || [];
    if (batch.length === 0) break;
    list.push(...batch);
    offset += PAGE;
  }
  const ms = first.metrics_summary;
  const metricsSummary =
    ms && typeof ms === 'object' && !Array.isArray(ms) ? (ms as Record<string, number>) : null;
  return { campaigns: list, metricsSummary };
}

/** Descarga todas las publicaciones con métricas del período. */
export async function fetchAllAdsForExport(
  siteId: string,
  advertiserId: number,
  dateFrom: string,
  dateTo: string
): Promise<any[]> {
  const first = await api.getMercadoLibreProductAdsAds({
    site_id: siteId,
    advertiser_id: advertiserId,
    date_from: dateFrom,
    date_to: dateTo,
    limit: PAGE,
    offset: 0,
    channel: 'marketplace'
  });
  const list = [...(first.results || [])];
  const total = first.paging?.total ?? list.length;
  let offset = PAGE;
  while (offset < total) {
    const r = await api.getMercadoLibreProductAdsAds({
      site_id: siteId,
      advertiser_id: advertiserId,
      date_from: dateFrom,
      date_to: dateTo,
      limit: PAGE,
      offset,
      channel: 'marketplace'
    });
    const batch = r.results || [];
    if (batch.length === 0) break;
    list.push(...batch);
    offset += PAGE;
  }
  return list;
}

export function buildExportBaseName(siteId: string, dateFrom: string, dateTo: string): string {
  return `ProductAds_${safeFilenamePart(siteId)}_${dateFrom}_${dateTo}`;
}
