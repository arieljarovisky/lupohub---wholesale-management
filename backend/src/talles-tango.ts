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
  '240': 'XXG',
  '250': 'XXXG',
};

export function nombreTalleDesdeCodigo(codigo: string): string {
  const c = (codigo || '').trim();
  return TALLE_CODIGO_A_NOMBRE[c] ?? c;
}
