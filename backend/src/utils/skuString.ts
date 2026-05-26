/**
 * SKU siempre como texto legible (sin notación científica 4,16E+12).
 * LupoHub usa formato base-talle-color, ej. 0051003-130-280.
 */
export function skuToCanonicalString(raw: unknown): string {
  if (raw == null || raw === '') return '';

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return '';
    if (Math.abs(raw) >= 1e6 || Number.isInteger(raw)) {
      try {
        return BigInt(Math.trunc(raw)).toString();
      } catch {
        return raw.toLocaleString('fullwide', { useGrouping: false, maximumFractionDigits: 0 });
      }
    }
    return String(raw);
  }

  let s = String(raw).trim();
  if (!s) return '';

  if (/[eE]/.test(s)) {
    const forParse = s.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
    const n = Number(forParse);
    if (Number.isFinite(n)) return skuToCanonicalString(n);
  }

  return s;
}

/** true si el SKU en TN parece corrupto (notación científica o solo dígitos enormes sin guiones). */
export function tiendaNubeSkuLooksCorrupted(raw: unknown): boolean {
  const s = String(raw ?? '').trim();
  if (!s) return false;
  if (/[eE]/.test(s)) return true;
  if (/^[\d.,]+$/.test(s) && s.replace(/\D/g, '').length >= 10) return true;
  return false;
}
