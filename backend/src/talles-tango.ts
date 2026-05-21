/**
 * Mapeo código de talle Tango (3 dígitos) → nombre real del talle.
 * Usado en importación Tango y al listar talles para mostrar el talle verdadero.
 */
export const TALLE_CODIGO_A_NOMBRE: Record<string, string> = {
  '130': 'P',
  '140': 'M',
  '150': 'G',
  '160': 'GG',
  '170': 'U',
  '180': 'XG',
  '200': 'XXG',
  '220': 'XXXG',
  '240': 'XXG',
  '250': 'XXXG',
};

export function nombreTalleDesdeCodigo(codigo: string): string {
  const c = (codigo || '').trim();
  return TALLE_CODIGO_A_NOMBRE[c] ?? c;
}

/** Letra o código numérico → código Tango de 3 dígitos (para SKU / sizes). */
const TALLE_NOMBRE_A_CODIGO: Record<string, string> = {
  P: '130',
  M: '140',
  G: '150',
  GG: '160',
  U: '170',
  XG: '180',
  XXG: '200',
  XXXG: '220',
  S: '130',
  EG: '160',
  UNICO: '170',
  ÚNICO: '170',
  '130': '130',
  '140': '140',
  '150': '150',
  '160': '160',
  '170': '170',
  '180': '180',
  '200': '200',
  '220': '220',
  '240': '240',
  '250': '250',
};

/** Sinónimos de letra para matchear guías ML (ej. 130 → P o S). */
export const TALLE_LETRAS_EQUIVALENTES: Record<string, string[]> = {
  '130': ['P', 'S'],
  '140': ['M'],
  '150': ['G'],
  '160': ['GG', 'EG'],
  '170': ['U', 'UNICO', 'ÚNICO'],
  '180': ['XG'],
  '200': ['XXG'],
  '220': ['XXXG'],
  '250': ['XXXG'],
};

export function codigoTalleParaSku(nameOrCode: string | undefined | null): string {
  if (nameOrCode == null) return '';
  const s = String(nameOrCode).trim().toUpperCase();
  if (/^\d{1,3}$/.test(s)) return s;
  return TALLE_NOMBRE_A_CODIGO[s] ?? s;
}
