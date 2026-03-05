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

/** Formato para mostrar: "código - talle" (ej. "130 - P"). */
export function labelTalle(codigo: string | undefined | null): string {
  if (codigo == null || String(codigo).trim() === '') return '';
  const c = String(codigo).trim();
  const nombre = TALLE_CODIGO_A_NOMBRE[c] ?? c;
  return nombre !== c ? `${c} - ${nombre}` : c;
}
