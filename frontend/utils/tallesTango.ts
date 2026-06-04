/**
 * Mapeo código de talle Tango (3 dígitos) → nombre real del talle.
 * Debe coincidir con el backend (talles-tango.ts).
 */
const TALLE_CODIGO_A_NOMBRE: Record<string, string> = {
  '130': 'P',
  '140': 'M',
  '150': 'G',
  '160': 'GG',
  '170': 'U',
  '180': 'XG',
  '200': 'XXG',
  '240': 'XXG',
  '250': 'XXXG',
};

export function nombreTalleDesdeCodigo(codigo: string | undefined | null): string {
  if (codigo == null) return '';
  const c = String(codigo).trim();
  return TALLE_CODIGO_A_NOMBRE[c] ?? c;
}

/** Inverso: nombre o abreviatura → código Tango (3 dígitos). Para armar SKU base-talle-color. */
const TALLE_NOMBRE_A_CODIGO: Record<string, string> = {
  'P': '130', 'M': '140', 'G': '150', 'GG': '160', 'U': '170',
  'XG': '180', 'XXG': '200', 'XXXG': '250',
  '130': '130', '140': '140', '150': '150', '160': '160', '170': '170',
  '180': '180', '200': '200', '240': '240', '250': '250',
};

export function codigoTalleParaSku(nameOrCode: string | undefined | null): string {
  if (nameOrCode == null) return '';
  const s = String(nameOrCode).trim().toUpperCase();
  if (/^\d{1,3}$/.test(s)) return s;
  return TALLE_NOMBRE_A_CODIGO[s] ?? s;
}

/** Orden de columnas en la matriz de pedidos (guía de talles). */
export const ORDER_FORM_SIZE_CODES = [
  '4', '6', '8', '10', '12', '14',
  '130', '140', '150', '160', '170', '180', '200', '250',
] as const;

export function sortOrderFormSizeCodes(a: string, b: string): number {
  const ia = ORDER_FORM_SIZE_CODES.indexOf(a as (typeof ORDER_FORM_SIZE_CODES)[number]);
  const ib = ORDER_FORM_SIZE_CODES.indexOf(b as (typeof ORDER_FORM_SIZE_CODES)[number]);
  if (ia >= 0 && ib >= 0) return ia - ib;
  if (ia >= 0) return -1;
  if (ib >= 0) return 1;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/** Formato para mostrar: "código - talle" (ej. "130 - P"). */
export function labelTalle(codigo: string | undefined | null): string {
  if (codigo == null || String(codigo).trim() === '') return '';
  const c = String(codigo).trim();
  const nombre = TALLE_CODIGO_A_NOMBRE[c] ?? c;
  return nombre !== c ? `${c} - ${nombre}` : c;
}
