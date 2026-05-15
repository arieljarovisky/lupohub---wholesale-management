/**
 * Parsea Excel tipo matriz para importación masiva de pedidos (ExcelJS, con soporte de color):
 * Cliente/Ref., Código, Color, columnas de talles, Precio opcional.
 * Si `splitByInvoiceGreen` es true en el parser, se separan líneas en
 * `importGroup`: NO_FACTURAR (cantidad con relleno verde, no se factura) y
 * PENDIENTE (sin verde: pedido del cliente no enviado / sin stock) → dos borradores por cliente.
 * Por defecto el parser lleva `splitByInvoiceGreen: false` (un solo pedido).
 * Sin columna de cliente se usa el nombre de la hoja como referencia de cliente.
 */
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { normalizeArticleCodeForMatrixImport } from './inventoryUtils';
import { codigoTalleParaSku } from './tallesTango';

export type MatrixImportGroup = 'NO_FACTURAR' | 'PENDIENTE';

export interface OrderMatrixImportLine {
  customerRef: string;
  codigo: string;
  color: string;
  sizeCode: string;
  quantity: number;
  unitPrice?: number | null;
  importGroup?: MatrixImportGroup;
}

function normHeader(h: string): string {
  return h
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCellDisplayValue(cell: ExcelJS.Cell): string {
  const v = cell.value as unknown;
  if (v == null || v === '') return '';
  if (typeof v === 'number' && !Number.isNaN(v)) return String(v);
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.result != null && o.result !== '') return String(o.result).trim();
    if (Array.isArray(o.richText))
      return (o.richText as { text?: string }[]).map((x) => x?.text ?? '').join('').trim();
    if (typeof o.text === 'string') return o.text.trim();
  }
  return String(v).trim();
}

function parseQtyFromCellValue(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number' && !Number.isNaN(v)) return Math.max(0, Math.floor(v));
  const s = String(v).trim();
  if (!s || s.toUpperCase() === 'X') return 0;
  return parseInt(s.replace(/\D/g, ''), 10) || 0;
}

/** Relleno verde tipo Excel (acento 6) y variantes habituales (marcar cantidad que no se factura en este flujo). */
function cellFillSuggestsMatrixGreen(fill: ExcelJS.Cell['fill']): boolean {
  if (!fill || (fill as { type?: string }).type !== 'pattern') return false;
  const fg = (fill as { fgColor?: { argb?: string } }).fgColor;
  if (!fg) return false;
  const raw = String((fg as { argb?: string }).argb ?? '')
    .replace(/^#/, '')
    .toUpperCase();
  const hex = raw.length === 8 ? raw.slice(2) : raw;
  const known = ['92D050', '00B050', '548235', '70AD47', '375623', 'A9D08E', 'C6E0B4', '63BE7B'];
  for (const k of known) {
    if (hex.endsWith(k) || hex.includes(k)) return true;
  }
  if (raw.length === 8) {
    const r = parseInt(raw.slice(2, 4), 16);
    const g = parseInt(raw.slice(4, 6), 16);
    const b = parseInt(raw.slice(6, 8), 16);
    if (g >= 130 && g > r + 20 && g > b + 20) return true;
  }
  return false;
}

function resolveColumns(originalHeaders: string[], normHeaders: string[]) {
  /** Sin "REF" suelto: suele ser ref. interna del artículo, no el cliente (evita columna mal tomada como cliente). */
  const customerCandidates = [
    'CLIENTE / REF.',
    'CLIENTE / REF',
    'CLIENTE',
    'REFERENCIA',
    'RAZON SOCIAL',
    'RAZON',
    'CLIENTE REF',
  ];
  let customerCol = -1;
  for (const cand of customerCandidates) {
    const idx = normHeaders.findIndex((h) => h === cand || h.startsWith(cand + ' '));
    if (idx >= 0) {
      customerCol = idx;
      break;
    }
  }

  const codigoCandidates = ['CODIGO', 'COD', 'ARTICULO', 'MODELO', 'SKU BASE', 'SKU'];
  let codigoCol = -1;
  for (const cand of codigoCandidates) {
    const idx = normHeaders.findIndex((h) => h === cand);
    if (idx >= 0) {
      codigoCol = idx;
      break;
    }
  }

  const colorCandidates = ['COLOR', 'COL', 'CODIGO COLOR', 'COD. COLOR', 'COD COLOR'];
  let colorCol = -1;
  for (const cand of colorCandidates) {
    const idx = normHeaders.findIndex((h) => h === cand || h.startsWith(cand + ' '));
    if (idx >= 0) {
      colorCol = idx;
      break;
    }
  }

  if (codigoCol < 0 || colorCol < 0) return null;

  let precioCol = -1;
  for (let i = 0; i < normHeaders.length; i++) {
    const nh = normHeaders[i];
    if (nh === 'PRECIO' || nh.startsWith('PRECIO ') || nh === 'PRECIO UNITARIO' || nh === 'IMPORTE') {
      precioCol = i;
      break;
    }
  }

  const metaExclude = new Set(
    [
      'DESCRIPCION',
      'MODELO',
      'TOTAL',
      'SUBTOTAL',
      'STOCK',
      'DEPOSITO',
      'NOTAS',
      'OBSERVACIONES',
      'CATEGORIA',
      'PROVEEDOR',
      'MARCA',
      'FECHA',
      'DESPACHO',
      'NOMBRE',
      'PRODUCTO',
      'ARTICULO',
      'CODIGO',
      'COLOR',
      'COL',
      'COD',
      'CANTIDAD',
      'CLIENTE',
      'REF',
      'REFERENCIA',
      'PRECIO',
      'IMPORTE',
    ].map((x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
  );

  const sizeColsDynamic: { header: string; index: number }[] = [];
  for (let i = 0; i < originalHeaders.length; i++) {
    if (i === codigoCol || i === colorCol) continue;
    if (customerCol >= 0 && i === customerCol) continue;
    if (precioCol >= 0 && i === precioCol) continue;
    const orig = originalHeaders[i];
    if (!orig) continue;
    const nh = normHeaders[i];
    if (!nh) continue;
    const nhPlain = nh.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (metaExclude.has(nhPlain) || nh.startsWith('PRECIO') || nh.startsWith('OBS')) continue;
    sizeColsDynamic.push({ header: orig, index: i });
  }

  const legacySizeNames = ['U', 'P', 'M', 'G', 'GG', 'XG', 'XXG', 'XXXG'];
  let sizeCols: { key: string; index: number }[] = [];
  if (sizeColsDynamic.length > 0) {
    sizeCols = sizeColsDynamic.map((s) => ({ key: s.header, index: s.index }));
  } else {
    for (const name of legacySizeNames) {
      const idx = normHeaders.findIndex((h) => h === name);
      if (idx >= 0) sizeCols.push({ key: name, index: idx });
    }
  }

  if (sizeCols.length === 0) return null;

  return { customerCol, codigoCol, colorCol, precioCol, sizeCols };
}

function parseWorksheet(
  ws: ExcelJS.Worksheet,
  sheetName: string,
  opts?: ParseOrderMatrixExcelOptions
): OrderMatrixImportLine[] {
  const maxCol = Math.max(ws.actualColumnCount || 0, ws.columnCount || 0, 1);
  const headerRow = ws.getRow(1);
  const originalHeaders: string[] = [];
  const normHeaders: string[] = [];
  for (let c = 1; c <= maxCol; c++) {
    const t = getCellDisplayValue(headerRow.getCell(c));
    originalHeaders.push(t);
    normHeaders.push(normHeader(t));
  }

  const layout = resolveColumns(originalHeaders, normHeaders);
  if (!layout) return [];

  const { customerCol, codigoCol, colorCol, precioCol, sizeCols } = layout;
  const col1 = (idx: number) => idx + 1;

  const splitByGreen = opts?.splitByInvoiceGreen === true;
  let hasGreenOnQuantity = false;
  const lastRow = ws.rowCount || 1;
  if (splitByGreen) {
    for (let r = 2; r <= lastRow; r++) {
      const row = ws.getRow(r);
      for (const { index } of sizeCols) {
        const cell = row.getCell(col1(index));
        const qty = parseQtyFromCellValue(cell.value);
        if (qty > 0 && cellFillSuggestsMatrixGreen(cell.fill)) {
          hasGreenOnQuantity = true;
          break;
        }
      }
      if (hasGreenOnQuantity) break;
    }
  }

  const sheetFallback = String(sheetName ?? '').trim();
  let lastCodigo = '';
  let lastCustomer = layout.customerCol < 0 && sheetFallback ? sheetFallback : '';

  const out: OrderMatrixImportLine[] = [];
  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const rawCodigo = getCellDisplayValue(row.getCell(col1(codigoCol)));
    const codigo = rawCodigo ? rawCodigo : lastCodigo;
    if (rawCodigo) lastCodigo = rawCodigo;

    let customerRef = lastCustomer;
    if (customerCol >= 0) {
      const cStr = getCellDisplayValue(row.getCell(col1(customerCol)));
      if (cStr) {
        customerRef = cStr;
        lastCustomer = cStr;
      }
    } else if (sheetFallback) {
      customerRef = sheetFallback;
      lastCustomer = sheetFallback;
    }

    const color = getCellDisplayValue(row.getCell(col1(colorCol)));
    if (!customerRef || !codigo || !color) continue;

    let rowPrice: number | null = null;
    if (precioCol >= 0) {
      const pv = row.getCell(col1(precioCol)).value;
      if (pv != null && pv !== '') {
        const n = typeof pv === 'number' ? pv : parseFloat(String(pv).replace(',', '.'));
        if (Number.isFinite(n) && n > 0) rowPrice = n;
      }
    }

    const skuPad = normalizeArticleCodeForMatrixImport(codigo);
    for (const { key, index } of sizeCols) {
      const cell = row.getCell(col1(index));
      const qty = parseQtyFromCellValue(cell.value);
      if (qty <= 0) continue;
      const green = splitByGreen && cellFillSuggestsMatrixGreen(cell.fill);
      const importGroup: MatrixImportGroup | undefined = hasGreenOnQuantity
        ? green
          ? 'NO_FACTURAR'
          : 'PENDIENTE'
        : undefined;
      const sizeCode = codigoTalleParaSku(String(key).trim()) || String(key).trim().toUpperCase();
      if (!sizeCode) continue;
      out.push({
        customerRef,
        codigo: skuPad,
        color,
        sizeCode,
        quantity: qty,
        unitPrice: rowPrice,
        importGroup,
      });
    }
  }
  return out;
}

/** Sin lectura de estilos (archivos .xls o fallback): mismo layout de matriz, sin separar por color. */
function parseSheetToLinesLegacy(
  rows: (string | number)[][],
  sheetName: string,
  _opts?: ParseOrderMatrixExcelOptions
): OrderMatrixImportLine[] {
  if (rows.length < 2) return [];

  const originalHeaders = (rows[0] || []).map((h) => String(h ?? '').trim());
  const normHeaders = originalHeaders.map((h) => normHeader(h));
  const layout = resolveColumns(originalHeaders, normHeaders);
  if (!layout) return [];

  const { customerCol, codigoCol, colorCol, precioCol, sizeCols } = layout;

  const sheetFallback = String(sheetName ?? '').trim();
  let lastCodigo = '';
  let lastCustomer = layout.customerCol < 0 && sheetFallback ? sheetFallback : '';

  const out: OrderMatrixImportLine[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const rawCodigo = row[codigoCol];
    const codigo = rawCodigo != null && String(rawCodigo).trim() !== '' ? String(rawCodigo).trim() : lastCodigo;
    if (codigo) lastCodigo = codigo;

    let customerRef = lastCustomer;
    if (customerCol >= 0) {
      const rawC = row[customerCol];
      const cStr = rawC != null ? String(rawC).trim() : '';
      if (cStr) {
        customerRef = cStr;
        lastCustomer = cStr;
      }
    } else if (sheetFallback) {
      customerRef = sheetFallback;
      lastCustomer = sheetFallback;
    }

    const rawColor = row[colorCol];
    const color = rawColor != null ? String(rawColor).trim() : '';
    if (!customerRef || !codigo || !color) continue;

    let rowPrice: number | null = null;
    if (precioCol >= 0) {
      const pv = row[precioCol];
      if (pv != null && pv !== '') {
        const n = typeof pv === 'number' ? pv : parseFloat(String(pv).replace(',', '.'));
        if (Number.isFinite(n) && n > 0) rowPrice = n;
      }
    }

    const skuPad = normalizeArticleCodeForMatrixImport(codigo);
    for (const { key, index } of sizeCols) {
      const v = row[index];
      let qty = 0;
      if (v === null || v === undefined || v === '') qty = 0;
      else if (typeof v === 'number' && !Number.isNaN(v)) qty = Math.max(0, Math.floor(v));
      else if (String(v).trim().toUpperCase() === 'X') qty = 0;
      else qty = parseInt(String(v).replace(/\D/g, ''), 10) || 0;
      if (qty <= 0) continue;
      const sizeCode = codigoTalleParaSku(String(key).trim()) || String(key).trim().toUpperCase();
      if (!sizeCode) continue;
      out.push({
        customerRef,
        codigo: skuPad,
        color,
        sizeCode,
        quantity: qty,
        unitPrice: rowPrice,
      });
    }
  }
  return out;
}

export type ParseOrderMatrixExcelOptions = {
  /**
   * Si es true, se concatenan todas las hojas (comportamiento antiguo).
   * Por defecto false: solo la primera hoja que tenga al menos una fila válida,
   * para no generar decenas de pedidos duplicados cuando el libro trae muchas hojas copiadas.
   */
  importAllSheets?: boolean;
  /**
   * Si es true y el .xlsx tiene celdas de cantidad con relleno verde, se marcan líneas NO_FACTURAR (verde) vs PENDIENTE (sin verde)
   * (dos borradores por cliente). Por defecto false: un solo pedido por cliente.
   */
  splitByInvoiceGreen?: boolean;
};

function parseOrderMatrixExcelLegacy(data: Uint8Array, opts?: ParseOrderMatrixExcelOptions): OrderMatrixImportLine[] {
  const workbook = XLSX.read(data, { type: 'array' });
  const importAllSheets = opts?.importAllSheets === true;
  if (!importAllSheets) {
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as (string | number)[][];
      const lines = parseSheetToLinesLegacy(rows, sheetName, opts);
      if (lines.length > 0) return lines;
    }
    return [];
  }
  const all: OrderMatrixImportLine[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as (string | number)[][];
    all.push(...parseSheetToLinesLegacy(rows, sheetName, opts));
  }
  return all;
}

/**
 * Lee .xlsx con ExcelJS. Opcional: verde = no facturar, sin verde = pendiente sin stock (`splitByInvoiceGreen: true`).
 * @param opts.importAllSheets Por defecto false: solo la primera hoja con datos válidos.
 */
export async function parseOrderMatrixExcel(
  file: File,
  opts?: ParseOrderMatrixExcelOptions
): Promise<OrderMatrixImportLine[]> {
  const buf = await file.arrayBuffer();
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.xls') && !lower.endsWith('.xlsx')) {
    return parseOrderMatrixExcelLegacy(new Uint8Array(buf), opts);
  }
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const importAllSheets = opts?.importAllSheets === true;
    if (!importAllSheets) {
      for (const ws of wb.worksheets) {
        const lines = parseWorksheet(ws, ws.name, opts);
        if (lines.length > 0) return lines;
      }
      return [];
    }
    const all: OrderMatrixImportLine[] = [];
    wb.eachSheet((ws) => {
      all.push(...parseWorksheet(ws, ws.name, opts));
    });
    return all;
  } catch {
    return parseOrderMatrixExcelLegacy(new Uint8Array(buf), opts);
  }
}
