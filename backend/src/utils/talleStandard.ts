/**
 * Talles estándar en Tienda Nube (filtros y variantes).
 * Letras: P, M, G, GG, XG, XXG, XXXG, U. Numéricos infantiles: 4, 6, 8, 10, 12, 14.
 */
export const STANDARD_SIZES = [
  'P', 'M', 'G', 'GG', 'XG', 'XXG', 'XXXG', 'U',
  '4', '6', '8', '10', '12', '14',
] as const;

const LETTER_SIZES = new Set(['P', 'M', 'G', 'GG', 'XG', 'XXG', 'XXXG', 'U']);
const KIDS_NUMERIC = new Set(['4', '6', '8', '10', '12', '14']);

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Quita sufijos de código (ej. "Negro - 999" no aplica aquí; "Verde - 402" → base). */
function stripTrailingCodeSuffix(v: string): string {
  return v.replace(/\s*-\s*\d+\s*$/i, '').trim();
}

function letterFromPrefix(v: string): string | null {
  const m = v.match(/^(XXXG|XXG|XG|GG|EG|P|M|G)\b/i);
  if (!m) return null;
  const p = m[1].toUpperCase();
  if (p === 'EG') return 'GG';
  if (LETTER_SIZES.has(p)) return p;
  if (p === 'G') return 'G';
  return null;
}

/**
 * Convierte el valor de atributo Talle/Size de Tienda Nube al catálogo estándar.
 * Si no hay regla clara, devuelve el valor limpio (sin cambiar).
 */
export function normalizeSizeToStandard(raw: string): string {
  let v = stripAccents(String(raw ?? '').trim().toUpperCase()).replace(/\s+/g, ' ');
  if (!v) return 'U';

  v = stripTrailingCodeSuffix(v);
  if (!v) return 'U';

  if (KIDS_NUMERIC.has(v)) return v;
  if (LETTER_SIZES.has(v)) return v;

  if (/^U$|^UNICO$|^UNICA$|^LISO$|^SURTIDO$/i.test(v)) return 'U';
  if (/^EG$/i.test(v)) return 'GG';
  if (/^L$/i.test(v)) return 'G';
  if (/^S$/i.test(v)) return 'P';
  if (/^PLUS$/i.test(v) || /\bPLUS\b/i.test(v)) return 'XXXG';

  const fromPrefix = letterFromPrefix(v);
  if (fromPrefix) return fromPrefix;

  // Rangos y formatos habituales en TN (calzado, medias, etc.)
  if (
    /^P\b|^P\s*[-/]|^P\s+\d|PEQUE|SMALL|\b33\b.*\b36\b|\b85\b.*\b90\b/i.test(v)
  ) return 'P';
  if (
    /^M\b|^M\s*[-/]|^M\s+\d|MEDIAN|MEDIUM|\b37\b.*\b40\b|\b38\b.*\b40\b|\b90\b.*\b95\b/i.test(v)
  ) return 'M';
  if (
    /^GG\b|^GG\s|GG\s*[-/]|\b45\b.*\b48\b|\b95\b.*\b100\b/i.test(v)
  ) return 'GG';
  if (
    !/^GRIS/i.test(v) &&
    /^G\b|^G\s|^G\s*[-/]|^G\/|GRANDE|LARGE|\b41\b.*\b44\b|\b42\b.*\b44\b|\b44\b.*\b46\b/i.test(v)
  ) return 'G';
  if (/^XXXG|^XXXL|TRIPLE\s*EXTRA|TRIPLE/i.test(v)) return 'XXXG';
  if (/^XXG|^XXL|^XX\s*G|EXTRA\s*GRANDE/i.test(v) && !/XXX/i.test(v)) return 'XXG';
  if (/^XG\b|^XL\b|EXTRA\s*LARGE/i.test(v)) return 'XG';

  // Talles numéricos de calzado adulto (no infantiles)
  if (/^34$|^35$|^36$|^XXS$|^XS$|^PP$|^1$|^2$|^S$/i.test(v)) return 'P';
  if (/^38$|^40$|^3$|^4$/.test(v) && v !== '4') return 'M';
  if (/^42$|^44$|^5$|^6$/.test(v) && v !== '6') return 'G';
  if (/^46$|^7$|^8$/.test(v) && v !== '8') return 'GG';
  if (/^48$|^9$/.test(v)) return 'XG';
  if (/^50$|^11$/.test(v)) return 'XXG';
  if (/^52$|^13$/.test(v)) return 'XXXG';

  if (/PEQUEÑO|PEQUENO/i.test(v)) return 'P';
  if (/MEDIANO/i.test(v)) return 'M';
  if (/GRANDE/i.test(v) && !/EXTRA/i.test(v)) return 'G';

  return v;
}

export function isStandardSize(value: string): boolean {
  const n = normalizeSizeToStandard(value);
  return (STANDARD_SIZES as readonly string[]).includes(n);
}
