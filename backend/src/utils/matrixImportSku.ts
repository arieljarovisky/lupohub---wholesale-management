/**
 * Importación matriz de pedidos: no rellena a 7 dígitos.
 * Código solo numérico → sin ceros a la izquierda (ej. 22684, no 0022684).
 */
export function normalizeMatrixImportArticleSku(raw: string): string {
  const t = String(raw ?? '').trim();
  if (!t) return '';
  const digits = t.replace(/\D/g, '');
  if (!digits) return t;
  const onlyNum = /^\d+$/.test(t.replace(/\s/g, ''));
  if (onlyNum) {
    return digits.replace(/^0+/, '') || '0';
  }
  return t;
}
