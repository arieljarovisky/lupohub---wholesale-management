/**
 * Formato Excel "historial_clientes_multimedias": hoja Resumen + una hoja por cliente.
 */

export interface MultimediaMovementRow {
  fecha: string; // DD/MM/YYYY display
  tipo: string;
  numero: string;
  edc: string;
  vto: string;
  importe: number | null;
  saldo: number | null;
  detalle: string;
  paginaPdf: string;
}

export interface ParsedCustomerSheet {
  code: string;
  businessNameFromTitle: string;
  vendedorHabitual: string;
  zona: string;
  saldoFinalHeader: number | null;
  movements: MultimediaMovementRow[];
}

function cellStr(v: unknown): string {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    const d = v.getDate().toString().padStart(2, '0');
    const m = (v.getMonth() + 1).toString().padStart(2, '0');
    const y = v.getFullYear();
    return `${d}/${m}/${y}`;
  }
  return String(v).trim();
}

function cellNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v).replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** Parsea fechas tipo 31/12/2014, 13/04/15, 22/08/25 */
export function parseArgentineDateDisplay(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let d = parseInt(m[1], 10);
  let mo = parseInt(m[2], 10);
  let y = parseInt(m[3], 10);
  if (m[3].length === 2) y += y >= 70 ? 1900 : 2000;
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function sqlDateToDisplay(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Nombre de hoja: "000809 FERNANDEZ HNOS SRL" → código + razón */
export function parseSheetName(sheetName: string): { code: string; restName: string } | null {
  const t = sheetName.trim();
  if (!t || t === 'Resumen') return null;
  const sp = t.indexOf(' ');
  if (sp < 0) return { code: t, restName: '' };
  return { code: t.slice(0, sp).trim(), restName: t.slice(sp + 1).trim() };
}

/** Lee matriz de celdas de una hoja cliente (formato Multimedias). */
export function parseCustomerSheetRows(rows: (string | number | null | undefined)[][]): ParsedCustomerSheet | null {
  if (!rows?.length) return null;
  const r0 = rows[0]?.map(cellStr) || [];
  let businessNameFromTitle = '';
  const title = r0[0] || '';
  const titleM = title.match(/Cliente\s+(\S+)\s*-\s*(.+)/i);
  let code = '';
  if (titleM) {
    code = titleM[1].trim();
    businessNameFromTitle = titleM[2].trim();
  }

  let vendedorHabitual = '';
  let zona = '';
  let saldoFinalHeader: number | null = null;
  const r1 = rows[1] || [];
  for (let i = 0; i < r1.length; i += 2) {
    const label = cellStr(r1[i]).toLowerCase();
    const val = r1[i + 1];
    if (label.includes('código') || label === 'codigo') {
      const c = cellStr(val);
      if (c) code = c;
    } else if (label.includes('vendedor')) vendedorHabitual = cellStr(val);
    else if (label.includes('zona')) zona = cellStr(val);
    else if (label.includes('saldo final')) saldoFinalHeader = cellNum(val);
  }

  let headerRowIdx = -1;
  for (let r = 0; r < rows.length; r++) {
    const a = cellStr(rows[r]?.[0]);
    const b = cellStr(rows[r]?.[1]);
    if (a === 'Fecha' && b === 'Tipo') {
      headerRowIdx = r;
      break;
    }
  }
  if (headerRowIdx < 0) {
    return {
      code,
      businessNameFromTitle,
      vendedorHabitual,
      zona,
      saldoFinalHeader,
      movements: [],
    };
  }

  const movements: MultimediaMovementRow[] = [];
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const fecha = cellStr(row[0]);
    const tipo = cellStr(row[1]);
    if (!fecha && !tipo) continue;
    movements.push({
      fecha,
      tipo,
      numero: cellStr(row[2]),
      edc: cellStr(row[3]),
      vto: cellStr(row[4]),
      importe: cellNum(row[5]),
      saldo: cellNum(row[6]),
      detalle: cellStr(row[7]),
      paginaPdf: cellStr(row[8]),
    });
  }

  return {
    code,
    businessNameFromTitle,
    vendedorHabitual,
    zona,
    saldoFinalHeader,
    movements,
  };
}

export function excelSheetName(code: string, businessName: string, maxLen = 31): string {
  const name = (businessName || 'Cliente').trim() || 'Cliente';
  const base = `${code} ${name}`.trim();
  if (base.length <= maxLen) return base;
  return base.slice(0, maxLen);
}
