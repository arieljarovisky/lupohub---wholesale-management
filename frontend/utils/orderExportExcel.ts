/**
 * Exportación de pedidos mayorista a Excel (formato cliente: Artículo, Descripción, Unidades, Precio, Total + resumen).
 */
import ExcelJS from 'exceljs';
import type { Order, OrderItem, Product } from '../types';
import { enrichOrderItem, sortOrderItemsForPrint } from './wholesaleInvoiceHtml';
import { nombreTalleDesdeCodigo } from './tallesTango';

const BORDER = { style: 'thin' as const, color: { argb: 'FF000000' } };
const ALL_BORDERS = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };
const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFD9D9D9' } };
/** Separador decimal coma (planilla cliente AR). */
const MONEY_FMT = '#.##0,00';
const QTY_FMT = '#.##0';

function stripLeadingZeros(s: string): string {
  const t = String(s || '').trim();
  const digits = t.replace(/\D/g, '');
  if (!digits) return t;
  return digits.replace(/^0+/, '') || '0';
}

function normalizeArticleCodeForExport(code: string): string {
  const raw = String(code || '').trim();
  if (!raw) return '';
  // Si tiene letras, conservarlo tal cual (no convertir a solo dígitos).
  if (/[A-Za-z]/.test(raw)) return raw;
  return stripLeadingZeros(raw);
}

/** Código de artículo sin ceros a la izquierda (ej. 0127501 → 127501 o 41300). */
export function articleCodeForExport(skuRaw: string): string {
  const sku = String(skuRaw || '').trim();
  if (!sku) return '';
  const parts = sku.split('-').filter(Boolean);
  if (parts.length >= 3) return normalizeArticleCodeForExport(parts[0]);
  if (/[A-Za-z]/.test(sku)) return normalizeArticleCodeForExport(sku);
  const digits = sku.replace(/\D/g, '');
  if (!digits) return sku;
  if (digits.length > 9) return stripLeadingZeros(digits.slice(0, -6));
  return stripLeadingZeros(digits);
}

function sizeLabelForExport(sizeCode: string): string {
  const code = String(sizeCode || '').trim().toUpperCase();
  if (!code) return '';
  const letter = nombreTalleDesdeCodigo(code);
  if (letter && letter !== code) return letter;
  const map: Record<string, string> = {
    '170': 'U',
    '130': 'P',
    '140': 'M',
    '150': 'G',
    '160': 'GG',
    '180': 'XG',
    '200': 'XXG',
    '250': 'XXXG',
  };
  return map[code] || code;
}

/** Descripción tipo planilla: "Top M NATURAL". */
function descriptionForExport(item: OrderItem): string {
  const name = String(item.productName || '').trim();
  const size = sizeLabelForExport(String(item.sizeCode || ''));
  const color = String(item.colorName || '').trim().toUpperCase();
  const parts: string[] = [];
  if (name) parts.push(name);
  if (size) parts.push(size);
  if (color) parts.push(color);
  return parts.join(' ') || '—';
}

function lineQuantity(item: OrderItem, order: Order): number {
  const q = Number(item.quantity) || 0;
  const postPicking =
    !order.noStockImpact &&
    ['Falta controlar', 'Controlado', 'Despachado'].includes(String(order.status || ''));
  if (!postPicking) return q;
  return Math.min(q, Math.max(0, Number(item.picked) || 0));
}

function formatShortDateHeader(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const year = String(d.getFullYear()).slice(-2);
  return `${day}/${month}/${year}`;
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = HEADER_FILL;
    cell.border = ALL_BORDERS;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
}

function styleDataRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.border = ALL_BORDERS;
    cell.alignment = { vertical: 'middle' };
  });
}

function styleSummaryRow(row: ExcelJS.Row, bold = false) {
  row.eachCell((cell, col) => {
    cell.border = ALL_BORDERS;
    if (col === 4) {
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'right' };
    }
    if (col === 5) {
      cell.numFmt = MONEY_FMT;
      cell.alignment = { horizontal: 'right' };
      if (bold) cell.font = { bold: true };
    }
  });
}

export type BuildOrderExportSheetOptions = {
  products: Product[];
  orderNetoFromItems: (order: Order) => number;
  /** IVA 21% sobre el neto después del descuento (como planilla cliente). */
  ivaRate?: number;
};

export async function addOrderExportWorksheet(
  workbook: ExcelJS.Workbook,
  order: Order,
  sheetName: string,
  options: BuildOrderExportSheetOptions
): Promise<void> {
  const { products, orderNetoFromItems, ivaRate = 0.21 } = options;
  const ws = workbook.addWorksheet(sheetName.slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.columns = [
    { width: 12 },
    { width: 42 },
    { width: 10 },
    { width: 14 },
    { width: 14 },
    { width: 10 },
  ];

  const dateLabel = formatShortDateHeader(order.date);
  const header = ws.addRow(['Artículo', 'Descripción', 'Unidades', 'Precio', 'Total', dateLabel]);
  styleHeaderRow(header);

  const items = sortOrderItemsForPrint(
    order.items.map((i) => enrichOrderItem(i, products)),
    products
  );

  let subtotal = 0;
  for (const item of items) {
    const qty = lineQuantity(item, order);
    if (qty <= 0) continue;
    const price = Math.round((Number(item.priceAtMoment) || 0) * 100) / 100;
    const lineTotal = Math.round(qty * price * 100) / 100;
    subtotal += lineTotal;

    const row = ws.addRow([
      articleCodeForExport(String(item.sku || '')),
      descriptionForExport(item),
      qty,
      price,
      lineTotal,
      '',
    ]);
    row.getCell(3).numFmt = QTY_FMT;
    row.getCell(4).numFmt = MONEY_FMT;
    row.getCell(5).numFmt = MONEY_FMT;
    row.getCell(3).alignment = { horizontal: 'center' };
    row.getCell(4).alignment = { horizontal: 'right' };
    row.getCell(5).alignment = { horizontal: 'right' };
    styleDataRow(row);
  }

  subtotal = Math.round(subtotal * 100) / 100;
  const netTotal = Math.round((orderNetoFromItems(order) || order.total || subtotal) * 100) / 100;
  const discountAmount = Math.max(0, Math.round((subtotal - netTotal) * 100) / 100);
  const discountPct =
    subtotal > 0 && discountAmount > 0.005
      ? Math.round((discountAmount / subtotal) * 1000) / 10
      : 0;
  const iva = Math.round(netTotal * ivaRate * 100) / 100;

  ws.addRow([]);
  const subRow = ws.addRow(['', '', '', 'SUBTOTAL', subtotal, '']);
  styleSummaryRow(subRow, true);

  if (discountAmount > 0.005) {
    const discLabel = discountPct > 0 ? `${discountPct}%DESCUENTO` : 'DESCUENTO';
    const discRow = ws.addRow(['', '', '', discLabel, discountAmount, '']);
    styleSummaryRow(discRow);
  }

  const totalRow = ws.addRow(['', '', '', 'TOTAL', netTotal, '']);
  styleSummaryRow(totalRow, true);

  const ivaRow = ws.addRow(['', '', '', 'IVA', iva, '']);
  styleSummaryRow(ivaRow);
}

async function downloadWorkbook(workbook: ExcelJS.Workbook, filename: string): Promise<void> {
  const buffer = await workbook.xlsx.writeBuffer();
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

export async function downloadOneOrderExcel(
  order: Order,
  options: BuildOrderExportSheetOptions & { sheetName: string; filename: string }
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  await addOrderExportWorksheet(wb, order, options.sheetName, options);
  await downloadWorkbook(wb, options.filename);
}

export async function downloadOrdersExcel(
  orders: Order[],
  options: BuildOrderExportSheetOptions & {
    sheetNameForOrder: (order: Order, index: number) => string;
    filename: string;
  }
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const used = new Set<string>();
  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    let name = options.sheetNameForOrder(order, i).slice(0, 31);
    if (used.has(name)) name = `${name.slice(0, 28)}_${i}`.slice(0, 31);
    used.add(name);
    await addOrderExportWorksheet(wb, order, name, options);
  }
  await downloadWorkbook(wb, options.filename);
}
