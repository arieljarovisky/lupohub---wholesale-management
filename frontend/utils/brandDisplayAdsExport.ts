import * as XLSX from 'xlsx';
import { api } from '../services/api';
import {
  buildCsv,
  computeProductAdsTotals,
  downloadTextFile,
  ProductAdsExportMeta
} from './productAdsExport';

const PAGE = 50;

function safeFilenamePart(s: string): string {
  return s.replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, '_');
}

export function brandDisplayCampaignRow(c: any): Record<string, unknown> {
  const m = c.metrics || {};
  return {
    'ID campaña': c.id,
    Nombre: c.name ?? '',
    Estado: c.status ?? '',
    'Tipo / objetivo': c.strategy ?? c.goal ?? '',
    Canal: c.channel ?? '',
    'Presupuesto diario': c.budget ?? '',
    Costo: m.cost ?? '',
    Clicks: m.clicks ?? '',
    Impresiones: m.prints ?? '',
    CTR: m.ctr ?? '',
    CPC: m.cpc ?? '',
    'Ventas (importe atrib.)': m.total_amount ?? '',
    ROAS: m.roas ?? '',
    ACOS: m.acos ?? '',
    CVR: m.cvr ?? ''
  };
}

const CAMPAIGN_COLS: { key: string; header: string }[] = [
  { key: 'ID campaña', header: 'ID campaña' },
  { key: 'Nombre', header: 'Nombre' },
  { key: 'Estado', header: 'Estado' },
  { key: 'Tipo / objetivo', header: 'Tipo / objetivo' },
  { key: 'Canal', header: 'Canal' },
  { key: 'Presupuesto diario', header: 'Presupuesto diario' },
  { key: 'Costo', header: 'Costo' },
  { key: 'Clicks', header: 'Clicks' },
  { key: 'Impresiones', header: 'Impresiones' },
  { key: 'CTR', header: 'CTR' },
  { key: 'CPC', header: 'CPC' },
  { key: 'Ventas (importe atrib.)', header: 'Ventas (importe atrib.)' },
  { key: 'ROAS', header: 'ROAS' },
  { key: 'ACOS', header: 'ACOS' },
  { key: 'CVR', header: 'CVR' }
];

export function downloadBrandDisplayCampaignsCsv(campaigns: any[], baseName: string) {
  const rows = campaigns.map(brandDisplayCampaignRow);
  downloadTextFile(buildCsv(rows, CAMPAIGN_COLS), `${baseName}_campañas.csv`);
}

export function downloadSingleBrandDisplayCampaignCsv(campaign: any, opts: { dateFrom: string; dateTo: string }) {
  const id = safeFilenamePart(String(campaign?.id ?? 'campaña'));
  const base = `Campaña_${id}_${opts.dateFrom}_${opts.dateTo}`;
  downloadTextFile(buildCsv([brandDisplayCampaignRow(campaign)], CAMPAIGN_COLS), `${base}.csv`);
}

export function downloadSingleBrandDisplayCampaignExcel(
  campaign: any,
  opts: {
    accountLabel: string;
    siteId: string;
    advertiserId: number;
    dateFrom: string;
    dateTo: string;
    productTitle: string;
  }
) {
  const wb = XLSX.utils.book_new();
  const id = campaign?.id ?? '';
  const name = (campaign?.name ?? '').toString();
  const resumen: (string | number)[][] = [
    [`Campaña individual — ${opts.productTitle}`],
    ['ID campaña', id],
    ['Nombre', name],
    ['Período desde', opts.dateFrom],
    ['Período hasta', opts.dateTo],
    ['Cuenta', opts.accountLabel],
    ['Site', opts.siteId],
    ['ID anunciante', opts.advertiserId],
    [],
    ['Exportado', new Date().toLocaleString('es-AR')],
    [],
    ['Nota', 'Métricas del período seleccionado solo para esta campaña.']
  ];
  const ws0 = XLSX.utils.aoa_to_sheet(resumen);
  XLSX.utils.book_append_sheet(wb, ws0, 'Resumen');
  const row = brandDisplayCampaignRow(campaign);
  const ws1 = XLSX.utils.json_to_sheet([row]);
  XLSX.utils.book_append_sheet(wb, ws1, 'Métricas');
  const fname = `Campaña_${safeFilenamePart(String(id))}_${opts.dateFrom}_${opts.dateTo}.xlsx`;
  XLSX.writeFile(wb, fname);
}

export function downloadBrandDisplayExcel(params: {
  meta: ProductAdsExportMeta & { productTitle: string };
  metricsSummary: Record<string, number> | null;
  totals: ReturnType<typeof computeProductAdsTotals>;
  campaigns: any[];
}) {
  const { meta, metricsSummary, totals, campaigns } = params;
  const wb = XLSX.utils.book_new();

  const resumen: (string | number)[][] = [
    [`Reporte ${meta.productTitle} — Lupo Hub`],
    ['Hoja Campañas', 'Métricas por campaña (una fila por campaña).'],
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

  const campData = campaigns.map(brandDisplayCampaignRow);
  const ws1 = XLSX.utils.json_to_sheet(campData);
  XLSX.utils.book_append_sheet(wb, ws1, 'Campañas');

  const fname = `${meta.productTitle.replace(/\s+/g, '_')}_${safeFilenamePart(meta.siteId)}_${meta.dateFrom}_${meta.dateTo}.xlsx`;
  XLSX.writeFile(wb, fname);
}

export async function fetchAllBrandCampaignsForExport(
  advertiserId: number,
  dateFrom: string,
  dateTo: string
): Promise<{ campaigns: any[]; metricsSummary: Record<string, number> | null }> {
  const first = await api.getMercadoLibreBrandAdsCampaigns({
    advertiser_id: advertiserId,
    date_from: dateFrom,
    date_to: dateTo,
    limit: PAGE,
    offset: 0
  });
  const list = [...(first.results || [])];
  const total = first.paging?.total ?? list.length;
  let offset = PAGE;
  while (offset < total) {
    const r = await api.getMercadoLibreBrandAdsCampaigns({
      advertiser_id: advertiserId,
      date_from: dateFrom,
      date_to: dateTo,
      limit: PAGE,
      offset
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

export async function fetchAllDisplayCampaignsForExport(
  advertiserId: number,
  dateFrom: string,
  dateTo: string
): Promise<{ campaigns: any[]; metricsSummary: Record<string, number> | null; summary_partial?: boolean }> {
  const first = await api.getMercadoLibreDisplayAdsCampaigns({
    advertiser_id: advertiserId,
    date_from: dateFrom,
    date_to: dateTo,
    limit: PAGE,
    offset: 0
  });
  const list = [...(first.results || [])];
  const total = first.paging?.total ?? list.length;
  let offset = PAGE;
  while (offset < total) {
    const r = await api.getMercadoLibreDisplayAdsCampaigns({
      advertiser_id: advertiserId,
      date_from: dateFrom,
      date_to: dateTo,
      limit: PAGE,
      offset
    });
    const batch = r.results || [];
    if (batch.length === 0) break;
    list.push(...batch);
    offset += PAGE;
  }
  const ms = first.metrics_summary;
  const metricsSummary =
    ms && typeof ms === 'object' && !Array.isArray(ms) ? (ms as Record<string, number>) : null;
  return { campaigns: list, metricsSummary, summary_partial: first.summary_partial };
}

export function buildBrandDisplayBaseName(prefix: string, siteId: string, dateFrom: string, dateTo: string): string {
  return `${prefix}_${safeFilenamePart(siteId)}_${dateFrom}_${dateTo}`;
}
