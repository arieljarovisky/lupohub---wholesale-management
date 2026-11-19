/**
 * Exportación Excel de la lista de precios del showroom (transferencia / tarjeta).
 */
import ExcelJS from 'exceljs';
import type { ShowroomPriceItem, ShowroomPriceList } from '../services/api';
import { todayYmdArgentina } from './formatDate';

const BORDER_THIN = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } };
const BORDER_CELL = { top: BORDER_THIN, left: BORDER_THIN, bottom: BORDER_THIN, right: BORDER_THIN };
const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF065F46' } };
const TITLE_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF0F172A' } };
const ZEBRA_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFECFDF5' } };
const MONEY_FMT = '#,##0.00';

function formatPriceCell(min: number | null, max?: number | null): number | string {
  if (min == null || !Number.isFinite(min)) return '';
  if (max == null || !Number.isFinite(max) || Math.abs(max - min) < 0.009) return min;
  return `${min.toFixed(2)} – ${max.toFixed(2)}`;
}

async function downloadWorkbook(wb: ExcelJS.Workbook, filename: string) {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportShowroomPriceListExcel(
  list: ShowroomPriceList,
  items: ShowroomPriceItem[] = list.items
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LupoHub';
  wb.created = new Date();
  const ws = wb.addWorksheet('Showroom', {
    views: [{ state: 'frozen', ySplit: 3, showGridLines: true }],
  });

  const transferPct = list.transferDiscountPercent || 0;
  const cardPct = list.cardDiscountPercent || 0;
  const subtitle =
    transferPct > 0 || cardPct > 0
      ? `Descuento Pago Nube: transferencia ${transferPct}% · tarjeta ${cardPct}% (1 pago)`
      : 'Sin descuento extra por medio de pago';

  ws.mergeCells('A1:F1');
  const titleRow = ws.getRow(1);
  titleRow.height = 28;
  titleRow.getCell(1).value = `Lista de precios showroom — ${subtitle}`;
  titleRow.getCell(1).font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
  titleRow.getCell(1).fill = TITLE_FILL;
  titleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };

  const headers = ['Código', 'Descripción', 'Marca', 'Transferencia', 'Tarjeta 1 pago', 'Stock'];
  const headerRow = ws.getRow(2);
  headerRow.values = headers;
  headerRow.height = 24;
  headers.forEach((_, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: 'middle', horizontal: i >= 3 ? 'right' : 'left', wrapText: true };
    cell.border = {
      top: BORDER_THIN,
      left: BORDER_THIN,
      bottom: { style: 'medium', color: { argb: 'FF064E3B' } },
      right: BORDER_THIN,
    };
  });

  items.forEach((item, idx) => {
    const row = ws.getRow(idx + 3);
    const transfer = formatPriceCell(item.priceTransfer, item.priceTransferMax);
    const card = formatPriceCell(item.priceCard, item.priceCardMax);
    row.values = [
      item.articleCode || '',
      item.name || '',
      item.brand || '',
      transfer,
      card,
      item.stock == null ? '' : item.stock,
    ];
    for (let c = 1; c <= 6; c++) {
      const cell = row.getCell(c);
      cell.font = { name: 'Calibri', size: 11 };
      cell.border = BORDER_CELL;
      cell.alignment = { vertical: 'middle', horizontal: c >= 3 ? 'right' : 'left', wrapText: c === 2 };
      if (idx % 2 === 1) cell.fill = ZEBRA_FILL;
      if ((c === 4 || c === 5) && typeof cell.value === 'number') cell.numFmt = MONEY_FMT;
    }
  });

  ws.columns = [
    { width: 14 },
    { width: 48 },
    { width: 14 },
    { width: 16 },
    { width: 16 },
    { width: 10 },
  ];
  if (items.length > 0) {
    ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: items.length + 2, column: 6 } };
  }

  await downloadWorkbook(wb, `precios_showroom_${todayYmdArgentina()}.xlsx`);
}
