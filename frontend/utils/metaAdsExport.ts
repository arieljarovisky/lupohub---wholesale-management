import ExcelJS from 'exceljs';
import { api } from '../services/api';

export type MetaRow = {
  id: string;
  name: string;
  status: string;
  objective?: string;
  dailyBudget: number | null;
  impressions: number;
  clicks: number;
  spend: number;
  cpc: number;
  ctr: number;
  reach: number;
  frequency: number;
  conversions: number;
  purchaseValue: number;
  roas: number;
  cpa: number;
};

function safePart(s: string): string {
  return s.replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, '_');
}

function metricColumns(): { key: keyof MetaRow; header: string }[] {
  return [
    { key: 'name', header: 'Nombre' },
    { key: 'id', header: 'ID' },
    { key: 'status', header: 'Estado' },
    { key: 'objective', header: 'Objetivo' },
    { key: 'dailyBudget', header: 'Presupuesto diario' },
    { key: 'spend', header: 'Inversión' },
    { key: 'purchaseValue', header: 'Valor ventas' },
    { key: 'roas', header: 'ROAS' },
    { key: 'cpa', header: 'CPA' },
    { key: 'conversions', header: 'Conversiones' },
    { key: 'impressions', header: 'Impresiones' },
    { key: 'clicks', header: 'Clics' },
    { key: 'ctr', header: 'CTR %' },
    { key: 'cpc', header: 'CPC' },
    { key: 'reach', header: 'Alcance' },
    { key: 'frequency', header: 'Frecuencia' }
  ];
}

function rowToCells(row: MetaRow, cols: { key: keyof MetaRow; header: string }[]): (string | number)[] {
  return cols.map((c) => {
    const v = row[c.key];
    if (v == null || v === '') return '';
    if (typeof v === 'number') return Math.round(v * 10000) / 10000;
    return String(v);
  });
}

async function downloadWorkbook(wb: ExcelJS.Workbook, filename: string) {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function addSheet(wb: ExcelJS.Workbook, name: string, rows: MetaRow[], includeObjective = false) {
  const ws = wb.addWorksheet(name.slice(0, 31));
  const cols = metricColumns().filter((c) => includeObjective || c.key !== 'objective');
  ws.addRow(cols.map((c) => c.header));
  rows.forEach((r) => ws.addRow(rowToCells(r, cols)));
  ws.getRow(1).font = { bold: true };
}

export async function fetchMetaFullExport(dateFrom: string, dateTo: string) {
  const root = await api.getMetaAdsCampaigns({ date_from: dateFrom, date_to: dateTo });
  const campaigns = root.campaigns || [];
  const adsets: (MetaRow & { campaignId: string; campaignName: string })[] = [];
  const ads: (MetaRow & { campaignId: string; adsetId: string; adsetName: string })[] = [];

  for (const camp of campaigns) {
    try {
      const asRes = await api.getMetaAdSets(camp.id, { date_from: dateFrom, date_to: dateTo });
      for (const as of asRes.adsets || []) {
        adsets.push({ ...as, campaignId: camp.id, campaignName: camp.name });
        try {
          const adsRes = await api.getMetaAdsForAdSet(as.id, { date_from: dateFrom, date_to: dateTo });
          for (const ad of adsRes.ads || []) {
            ads.push({ ...ad, campaignId: camp.id, adsetId: as.id, adsetName: as.name });
          }
        } catch {
          /* skip adset ads on error */
        }
      }
    } catch {
      /* skip campaign adsets on error */
    }
  }

  return { accountId: root.accountId, campaigns, adsets, ads, summary: root.summary };
}

export async function downloadMetaAdsExcel(params: {
  dateFrom: string;
  dateTo: string;
  accountId?: string;
  campaigns: MetaRow[];
  adsets?: (MetaRow & { campaignId: string; campaignName: string })[];
  ads?: (MetaRow & { campaignId: string; adsetId: string; adsetName: string })[];
  summary?: Record<string, number>;
}) {
  const wb = new ExcelJS.Workbook();
  const info = wb.addWorksheet('Resumen');
  info.addRow(['Reporte Meta Ads — Lupo Hub']);
  info.addRow(['Período desde', params.dateFrom]);
  info.addRow(['Período hasta', params.dateTo]);
  info.addRow(['Exportado', new Date().toLocaleString('es-AR')]);
  if (params.accountId) info.addRow(['Cuenta act_', params.accountId]);
  if (params.summary) {
    info.addRow([]);
    info.addRow(['Inversión total', params.summary.spend ?? 0]);
    info.addRow(['Valor ventas', params.summary.purchaseValue ?? 0]);
    info.addRow(['ROAS', params.summary.roas ?? 0]);
    info.addRow(['Conversiones', params.summary.conversions ?? 0]);
  }

  addSheet(wb, 'Campañas', params.campaigns, true);

  if (params.adsets?.length) {
    const ws = wb.addWorksheet('Conjuntos');
    const cols = ['Campaña', 'ID campaña', ...metricColumns().map((c) => c.header)];
    ws.addRow(cols);
    ws.getRow(1).font = { bold: true };
    const mcols = metricColumns();
    params.adsets.forEach((r) => {
      ws.addRow([r.campaignName, r.campaignId, ...rowToCells(r, mcols)]);
    });
  }

  if (params.ads?.length) {
    const ws = wb.addWorksheet('Anuncios');
    ws.addRow(['Conjunto', 'ID conjunto', ...metricColumns().map((c) => c.header)]);
    ws.getRow(1).font = { bold: true };
    const mcols = metricColumns();
    params.ads.forEach((r) => {
      ws.addRow([r.adsetName, r.adsetId, ...rowToCells(r, mcols)]);
    });
  }

  const fname = `MetaAds_${safePart(params.accountId || 'cuenta')}_${params.dateFrom}_${params.dateTo}.xlsx`;
  await downloadWorkbook(wb, fname);
}

export function metaManagerUrl(
  accountId: string,
  opts?: { campaignId?: string; adsetId?: string; adId?: string }
): string {
  const act = accountId.replace(/^act_/i, '');
  const q = new URLSearchParams({ act });
  if (opts?.campaignId) q.set('selected_campaign_ids', opts.campaignId);
  if (opts?.adsetId) q.set('selected_adset_ids', opts.adsetId);
  if (opts?.adId) q.set('selected_ad_ids', opts.adId);
  return `https://www.facebook.com/adsmanager/manage/campaigns?${q.toString()}`;
}
