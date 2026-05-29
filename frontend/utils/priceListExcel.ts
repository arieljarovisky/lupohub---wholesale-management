/**
 * Exportación e importación de listas de precios con ExcelJS (estilos).
 */
import ExcelJS from 'exceljs';

export type PriceListExcelRow = {
  sku?: string;
  name?: string;
  price: number;
  productId: string;
};

const BORDER_THIN = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } };
const BORDER_CELL = { top: BORDER_THIN, left: BORDER_THIN, bottom: BORDER_THIN, right: BORDER_THIN };
const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF1E40AF' } };
const TITLE_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF0F172A' } };
const ZEBRA_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF1F5F9' } };
const MONEY_FMT = '#,##0.00';

function safeFileName(name: string): string {
  return (name || 'lista-precios').replace(/[^\w\s-áéíóúñÁÉÍÓÚÑ]/g, '').trim().slice(0, 40) || 'lista-precios';
}

function styleTitleRow(row: ExcelJS.Row) {
  row.height = 28;
  const cell = row.getCell(1);
  cell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
  cell.fill = TITLE_FILL;
  cell.alignment = { vertical: 'middle', horizontal: 'left' };
}

function styleHeaderRow(row: ExcelJS.Row, colCount: number) {
  row.height = 24;
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: 'middle', horizontal: c === 3 ? 'right' : 'left', wrapText: true };
    cell.border = {
      top: BORDER_THIN,
      left: BORDER_THIN,
      bottom: { style: 'medium', color: { argb: 'FF1E3A8A' } },
      right: BORDER_THIN,
    };
  }
}

function styleDataRow(row: ExcelJS.Row, colCount: number, zebra: boolean) {
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.font = { name: 'Calibri', size: 11 };
    cell.border = BORDER_CELL;
    cell.alignment = { vertical: 'middle', horizontal: c === 3 ? 'right' : 'left', wrapText: c === 2 };
    if (zebra) cell.fill = ZEBRA_FILL;
    if (c === 3) cell.numFmt = MONEY_FMT;
  }
}

async function buildStyledWorkbook(
  listName: string,
  rows: { codigo: string; descripcion: string; precio: number | '' }[]
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LupoHub';
  wb.created = new Date();
  const ws = wb.addWorksheet('Precios', {
    views: [{ state: 'frozen', ySplit: 3, showGridLines: true }],
  });

  ws.mergeCells('A1:C1');
  const titleRow = ws.getRow(1);
  titleRow.getCell(1).value = `Lista de precios — ${listName}`;
  styleTitleRow(titleRow);

  const headerRow = ws.getRow(2);
  headerRow.values = ['Código', 'Descripción', 'Precio'];
  styleHeaderRow(headerRow, 3);

  let r = 3;
  rows.forEach((row, idx) => {
    const dataRow = ws.getRow(r);
    dataRow.values = [row.codigo, row.descripcion, row.precio];
    styleDataRow(dataRow, 3, idx % 2 === 1);
    r++;
  });

  ws.columns = [{ width: 18 }, { width: 48 }, { width: 16 }];
  if (rows.length > 0) {
    ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: r - 1, column: 3 } };
  }

  return wb;
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

/** Descarga Excel con estilos (Código, Descripción, Precio). */
export async function exportPriceListExcelStyled(items: PriceListExcelRow[], listName: string) {
  const sorted = [...items].sort((a, b) =>
    String(a.sku || a.productId).localeCompare(String(b.sku || b.productId), 'es', { numeric: true })
  );
  const rows = sorted.map((i) => ({
    codigo: String(i.sku || i.productId),
    descripcion: String(i.name || ''),
    precio: Number(i.price) || 0,
  }));
  const wb = await buildStyledWorkbook(listName, rows);
  await downloadWorkbook(wb, `lista-precios-${safeFileName(listName)}.xlsx`);
}

/** Plantilla con todos los artículos y columna Precio vacía. */
export async function downloadPriceListTemplateStyled(products: { sku: string; name?: string }[]) {
  const rows = products.map((p) => ({
    codigo: p.sku,
    descripcion: p.name || '',
    precio: '' as const,
  }));
  const wb = await buildStyledWorkbook('Plantilla — completar precios', rows);
  await downloadWorkbook(wb, 'plantilla-lista-precios-todos-articulos.xlsx');
}
