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
  if (/^\d{2,3}$/.test(s)) return s;
  return TALLE_NOMBRE_A_CODIGO[s] ?? s;
}

/** Formato para mostrar: "código - talle" (ej. "130 - P"). */
export function labelTalle(codigo: string | undefined | null): string {
  if (codigo == null || String(codigo).trim() === '') return '';
  const c = String(codigo).trim();
  const nombre = TALLE_CODIGO_A_NOMBRE[c] ?? c;
  return nombre !== c ? `${c} - ${nombre}` : c;
}
