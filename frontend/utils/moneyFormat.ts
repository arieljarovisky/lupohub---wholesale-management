/** Importes en pesos AR: siempre 2 decimales (ej. enteros como 10.785,00). */
export function formatMoneyAr(value: number): string {
  const n = Number(value);
  if (Number.isNaN(n)) return '0,00';
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Parsea importes tipados en formato AR (1.234.567,89 / 1234,56) o US (1234.56).
 * No borra la coma decimal: la convierte a punto para Number().
 */
export function parseMoneyAr(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim().replace(/\s/g, '').replace(/\$/g, '');
  if (!s) return null;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  let n: number;
  if (hasComma && hasDot) {
    // AR: 1.234.567,89
    n = Number(s.replace(/\./g, '').replace(',', '.'));
  } else if (hasComma) {
    // AR: 1234,56
    n = Number(s.replace(',', '.'));
  } else if (hasDot && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    // AR miles sin decimales: 1.500 / 1.228.093
    n = Number(s.replace(/\./g, ''));
  } else {
    // US / valor ya normalizado: 1234.56
    n = Number(s);
  }
  return Number.isFinite(n) ? n : null;
}
