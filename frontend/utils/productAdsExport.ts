import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
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

function downloadExcelBuffer(buffer: ArrayBuffer | Uint8Array | ReadonlyArray<number>, filename: string) {
  const u8 =
    buffer instanceof Uint8Array
      ? buffer
      : buffer instanceof ArrayBuffer
        ? new Uint8Array(buffer)
        : Uint8Array.from(buffer as number[]);
  const blob = new Blob([u8], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const ST_BORDER = {
  style: 'thin' as const,
  color: { argb: 'FF94A3B8' }
};

/** Relleno sólido compatible con Excel (fg + bg iguales evita lectores que “pierden” el color). */
function solidFill(argb: string): ExcelJS.Fill {
  return {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb },
    bgColor: { argb }
  };
}

function styleHeaderRow(row: ExcelJS.Row, colCount: number) {
  row.height = 24;
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
    cell.fill = solidFill('FF1E40AF');
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    cell.border = {
      top: ST_BORDER,
      left: ST_BORDER,
      bottom: { style: 'medium', color: { argb: 'FF1E3A8A' } },
      right: ST_BORDER
    };
  }
}

/** Título de sección en 2 columnas (sin merge obligatorio: pintamos A y B). */
function styleSectionHeaderRow(row: ExcelJS.Row) {
  row.height = 22;
  for (const c of [1, 2]) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
    cell.fill = solidFill('FF2563EB');
    cell.alignment = { vertical: 'middle', horizontal: c === 1 ? 'left' : 'right', wrapText: true };
    cell.border = {
      top: ST_BORDER,
      left: ST_BORDER,
      bottom: { style: 'thin', color: { argb: 'FF1E3A8A' } },
      right: ST_BORDER
    };
  }
}

function styleDataCell(cell: ExcelJS.Cell, alt: boolean) {
  cell.border = {
    top: ST_BORDER,
    left: ST_BORDER,
    bottom: ST_BORDER,
    right: ST_BORDER
  };
  cell.alignment = { vertical: 'middle', wrapText: true };
  if (alt) {
    cell.fill = solidFill('FFF1F5F9');
  }
}

function styleLabelValueRow(row: ExcelJS.Row, alt: boolean) {
  const c1 = row.getCell(1);
  const c2 = row.getCell(2);
  c1.font = { bold: true, size: 11, name: 'Calibri', color: { argb: 'FF334155' } };
  styleDataCell(c1, alt);
  c2.font = { size: 11, name: 'Calibri', color: { argb: 'FF0F172A' } };
  styleDataCell(c2, alt);
  c2.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
}

function coerceCellValue(v: unknown): string | number {
  if (v === '' || v == null) return '';
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return '';
    const n = Number(t.replace(/\s/g, '').replace(',', '.'));
    if (!Number.isNaN(n) && /^[-+\d.,\sEe]+$/.test(t)) return n;
  }
  return String(v);
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
  const want = String(campaignId);
  return list.filter((ad) => String(ad?.campaign_id ?? '') === want);
}

/** Una sola campaña: un solo CSV con sección general (campaña) y sección detalle (publicaciones). */
export async function downloadSingleCampaignCsv(
  campaign: any,
  opts: { dateFrom: string; dateTo: string; siteId: string; advertiserId: number }
) {
  const id = safeFilenamePart(String(campaign?.id ?? 'campaña'));
  const base = `Campaña_${id}_${opts.dateFrom}_${opts.dateTo}`;
  const ads = await fetchAllAdsForSingleCampaignExport(
    opts.siteId,
    opts.advertiserId,
    campaign?.id,
    opts.dateFrom,
    opts.dateTo
  );
  const stripBom = (s: string) => s.replace(/^\uFEFF/, '');
  const generalBlock = stripBom(buildCsv([campaignRow(campaign)], CAMPAIGN_CSV_COLS));
  const detailBlock =
    ads.length > 0 ? stripBom(buildCsv(ads.map(adRow), ADS_CSV_COLS)) : 'Sin publicaciones con métricas en el período para esta campaña.';
  const combined =
    '\uFEFF' +
    'SECCIÓN: GENERAL (campaña)\r\n' +
    generalBlock +
    '\r\n\r\nSECCIÓN: DETALLE (publicaciones)\r\n' +
    detailBlock;
  downloadTextFile(combined, `${base}.csv`);
}

/** Una sola campaña: hoja 1 solo datos generales (clave–valor); hoja 2 solo detalle (publicaciones); estilos visibles en Excel. */
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
  const id = campaign?.id ?? '';
  const name = (campaign?.name ?? '').toString();
  const cr = campaignRow(campaign);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'LupoHub';
  workbook.created = new Date();

  // Hoja 1 — únicamente generales (sin tabla horizontal de métricas)
  const wsGen = workbook.addWorksheet('Datos generales', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { defaultRowHeight: 20 }
  });
  wsGen.getColumn(1).width = 30;
  wsGen.getColumn(2).width = 56;

  let r = 1;
  const titleRow = wsGen.getRow(r);
  wsGen.mergeCells(r, 1, r, 2);
  const titleCell = titleRow.getCell(1);
  titleCell.value = 'Product Ads — datos generales de la campaña';
  titleCell.font = { bold: true, size: 14, name: 'Calibri', color: { argb: 'FF0F172A' } };
  titleCell.fill = solidFill('FFE2E8F0');
  titleCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  titleCell.border = {
    top: ST_BORDER,
    left: ST_BORDER,
    bottom: ST_BORDER,
    right: ST_BORDER
  };
  titleRow.height = 28;
  r += 2;

  const contextSection = wsGen.getRow(r);
  contextSection.getCell(1).value = 'Información del reporte';
  contextSection.getCell(2).value = '';
  styleSectionHeaderRow(contextSection);
  r++;

  const contextPairs: [string, string | number][] = [
    ['ID campaña', id],
    ['Nombre', name],
    ['Período desde', opts.dateFrom],
    ['Período hasta', opts.dateTo],
    ['Cuenta', opts.accountLabel],
    ['Site', opts.siteId],
    ['ID anunciante', opts.advertiserId],
    ['Cantidad de publicaciones (hoja Detalle)', ads.length],
    ['Exportado', new Date().toLocaleString('es-AR')]
  ];
  contextPairs.forEach(([label, val], idx) => {
    const row = wsGen.getRow(r);
    row.getCell(1).value = label;
    row.getCell(2).value = val;
    styleLabelValueRow(row, idx % 2 === 1);
    r++;
  });

  r += 1;
  const metricsSection = wsGen.getRow(r);
  metricsSection.getCell(1).value = 'Métricas de la campaña (período seleccionado)';
  metricsSection.getCell(2).value = '';
  styleSectionHeaderRow(metricsSection);
  r++;

  CAMPAIGN_CSV_COLS.forEach((col, idx) => {
    const row = wsGen.getRow(r);
    row.getCell(1).value = col.header;
    const v = coerceCellValue(cr[col.key]);
    const c2 = row.getCell(2);
    c2.value = v;
    styleLabelValueRow(row, idx % 2 === 1);
    if (typeof v === 'number') {
      const intKeys = new Set(['Clicks', 'Impresiones', 'Unidades']);
      c2.numFmt = intKeys.has(col.key) ? '#,##0' : '#,##0.00';
    }
    r++;
  });

  // Hoja 2 — únicamente detalle (tabla de publicaciones)
  const wsDet = workbook.addWorksheet('Detalle', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { defaultRowHeight: 20 }
  });
  const adHeaders = ADS_CSV_COLS.map((c) => c.header);
  const detHeader = wsDet.getRow(1);
  adHeaders.forEach((h, i) => {
    detHeader.getCell(i + 1).value = h;
  });
  styleHeaderRow(detHeader, adHeaders.length);

  const colW = [14, 36, 28, 12, 14, 10, 40, 12, 10, 12, 14, 10, 10, 10, 10];
  adHeaders.forEach((_, i) => {
    wsDet.getColumn(i + 1).width = colW[i] ?? 14;
  });

  const numFmt2 = '#,##0.00';
  const numFmt0 = '#,##0';
  // Columnas 1-based según ADS_CSV_COLS: Precio=6, Costo=7, Clicks=8, Impresiones=9, Ventas=10, ROAS=11, ACOS=12, CVR=13, CPC=14
  const detailDecimals = new Set([6, 7, 10, 11, 12, 13, 14]);
  const detailIntegers = new Set([8, 9]);

  if (ads.length === 0) {
    const row = wsDet.getRow(2);
    wsDet.mergeCells(2, 1, 2, adHeaders.length);
    const c = row.getCell(1);
    c.value = 'Sin publicaciones con métricas en el período para esta campaña.';
    c.font = { italic: true, size: 11, name: 'Calibri', color: { argb: 'FF64748B' } };
    c.fill = solidFill('FFF8FAFC');
    c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    c.border = {
      top: ST_BORDER,
      left: ST_BORDER,
      bottom: ST_BORDER,
      right: ST_BORDER
    };
  } else {
    const adsData = ads.map(adRow);
    wsDet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: adHeaders.length }
    };
    adsData.forEach((ar, idx) => {
      const row = wsDet.getRow(2 + idx);
      ADS_CSV_COLS.forEach((col, i) => {
        const colIdx = i + 1;
        const cell = row.getCell(colIdx);
        cell.value = coerceCellValue(ar[col.key]);
        styleDataCell(cell, idx % 2 === 1);
        if (typeof cell.value === 'number') {
          if (detailDecimals.has(colIdx)) cell.numFmt = numFmt2;
          else if (detailIntegers.has(colIdx)) cell.numFmt = numFmt0;
        }
      });
    });
  }

  const buf = await workbook.xlsx.writeBuffer();
  const fname = `Campaña_${safeFilenamePart(String(id))}_${opts.dateFrom}_${opts.dateTo}.xlsx`;
  downloadExcelBuffer(buf, fname);
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
