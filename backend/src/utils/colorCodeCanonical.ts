/**
 * Códigos de color de catálogo: 3 dígitos (111–999).
 * En Excel/ERP suelen venir 4 dígitos (ej. 2021, 9990) donde los primeros 3 coinciden con el color real (202, 999).
 */
export function digitsOnlyColorCode(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  return s.replace(/\D/g, '');
}

/** Canon numérico para `colors.code` e importaciones: si hay más de 3 dígitos, solo los primeros 3. */
export function canonicalNumericColorCode(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 3) return d;
  return d.slice(0, 3);
}

export function normalizeColorCodeForImportValue(val: unknown): string {
  return canonicalNumericColorCode(digitsOnlyColorCode(val));
}
