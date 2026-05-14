/**
 * Parsea Excel tipo matriz para importación masiva de pedidos:
 * Cliente/Ref., Código (con arrastre hacia abajo), Color, columnas de talles, Precio opcional.
 * Si no hay columna de cliente, se usa el nombre de la hoja como referencia de cliente.
 */
import * as XLSX from 'xlsx';
import { padArticleCodeTo7 } from './inventoryUtils';
import { codigoTalleParaSku } from './tallesTango';

export interface OrderMatrixImportLine {
  customerRef: string;
  codigo: string;
  color: string;
  sizeCode: string;
  quantity: number;
  unitPrice?: number | null;
}

function normHeader(h: string): string {
  return h
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSheetToLines(
  rows: (string | number)[][],
  sheetName: string
): OrderMatrixImportLine[] {
  if (rows.length < 2) return [];

  const originalHeaders = (rows[0] || []).map((h) => String(h ?? '').trim());
  const normHeaders = originalHeaders.map((h) => normHeader(h));

  const customerCandidates = [
    'CLIENTE / REF.',
    'CLIENTE / REF',
    'CLIENTE',
    'REF',
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

  if (codigoCol < 0 || colorCol < 0) return [];

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

  if (sizeCols.length === 0) return [];

  const sheetFallback = String(sheetName ?? '').trim();
  let lastCodigo = '';
  let lastCustomer = customerCol < 0 && sheetFallback ? sheetFallback : '';

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

    const skuPad = padArticleCodeTo7(codigo);
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

/**
 * Lee un .xlsx/.xls: procesa **todas** las hojas que tengan cabecera válida (código + color + talles).
 * Si no hay columna de cliente, usa el nombre de cada hoja como `customerRef`.
 */
export async function parseOrderMatrixExcel(file: File): Promise<OrderMatrixImportLine[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const workbook = XLSX.read(data, { type: 'array' });
  const all: OrderMatrixImportLine[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as (string | number)[][];
    const part = parseSheetToLines(rows, sheetName);
    all.push(...part);
  }
  return all;
}
