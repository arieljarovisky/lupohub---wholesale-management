/**
 * Nombres de color estándar para filtros en Tienda Nube.
 */
export const STANDARD_COLOR_NAMES = [
  'Negro',
  'Blanco',
  'Gris',
  'Azul',
  'Verde',
  'Rojo',
  'Rosa',
  'Beige',
  'Natural',
  'Nude',
  'Celeste',
  'Violeta',
  'Lila',
  'Bordó',
  'Marino',
  'Marrón',
  'Fucsia',
  'Estampado',
  'Surtido',
  'Tricolor',
  'Rayada',
] as const;

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normKey(s: string): string {
  return stripAccents(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Alias exacto (clave normalizada sin acentos) → nombre canónico. */
const ALIASES: Record<string, string> = {
  negro: 'Negro',
  blanco: 'Blanco',
  gris: 'Gris',
  azul: 'Azul',
  verde: 'Verde',
  rojo: 'Rojo',
  rosa: 'Rosa',
  beige: 'Beige',
  natural: 'Natural',
  natutal: 'Natural',
  nude: 'Nude',
  celeste: 'Celeste',
  violeta: 'Violeta',
  lila: 'Lila',
  bordo: 'Bordó',
  borde: 'Bordó',
  marino: 'Marino',
  marron: 'Marrón',
  'marron claro': 'Marrón',
  cafe: 'Marrón',
  fucsia: 'Fucsia',
  fucsi: 'Fucsia',
  guayaba: 'Rosa',
  estampado: 'Estampado',
  surtido: 'Surtido',
  tricolor: 'Tricolor',
  rayada: 'Rayada',
  'azul marino': 'Marino',
  'azul acero': 'Azul',
  'azul claro': 'Azul',
  'azul oscuro': 'Azul',
  'gris claro': 'Gris',
  'gris oscuro': 'Gris',
  'verde agua': 'Verde',
  'verde oscuro': 'Verde',
  'rosa claro': 'Rosa',
  'blanco y natural': 'Blanco',
  'negro y gris': 'Negro',
  'negro y natural': 'Negro',
  'negro y natutal': 'Negro',
  'negro - gris': 'Negro',
  'gris-negro-blanco': 'Gris',
  'gris blanco negro c/puntos': 'Gris',
  'rosa gris blanco c/puntos': 'Rosa',
  'fucsia y negro': 'Fucsia',
  'fucsia negro gris': 'Fucsia',
  'fucsia negro-gris-fucsia': 'Fucsia',
  'fucsi y negro 570': 'Fucsia',
  'azul marino - blanco': 'Marino',
  'gris oscuro y gris claro': 'Gris',
  'b-g-n': 'Negro',
};

/** Frases a buscar dentro del texto (más largas primero). */
const PHRASE_MATCHES: Array<{ needle: string; canon: string }> = [
  { needle: 'azul marino', canon: 'Marino' },
  { needle: 'marron claro', canon: 'Marrón' },
  { needle: 'gris oscuro', canon: 'Gris' },
  { needle: 'gris claro', canon: 'Gris' },
  { needle: 'verde oscuro', canon: 'Verde' },
  { needle: 'verde agua', canon: 'Verde' },
  { needle: 'rosa claro', canon: 'Rosa' },
  { needle: 'azul acero', canon: 'Azul' },
  { needle: 'azul claro', canon: 'Azul' },
  { needle: 'azul oscuro', canon: 'Azul' },
  { needle: 'fucsia', canon: 'Fucsia' },
  { needle: 'fucsi', canon: 'Fucsia' },
  { needle: 'bordo', canon: 'Bordó' },
  { needle: 'marron', canon: 'Marrón' },
  { needle: 'negro', canon: 'Negro' },
  { needle: 'blanco', canon: 'Blanco' },
  { needle: 'gris', canon: 'Gris' },
  { needle: 'azul', canon: 'Azul' },
  { needle: 'verde', canon: 'Verde' },
  { needle: 'rojo', canon: 'Rojo' },
  { needle: 'rosa', canon: 'Rosa' },
  { needle: 'beige', canon: 'Beige' },
  { needle: 'natural', canon: 'Natural' },
  { needle: 'nude', canon: 'Nude' },
  { needle: 'celeste', canon: 'Celeste' },
  { needle: 'violeta', canon: 'Violeta' },
  { needle: 'lila', canon: 'Lila' },
  { needle: 'marino', canon: 'Marino' },
  { needle: 'cafe', canon: 'Marrón' },
  { needle: 'guayaba', canon: 'Rosa' },
  { needle: 'estampado', canon: 'Estampado' },
  { needle: 'surtido', canon: 'Surtido' },
  { needle: 'tricolor', canon: 'Tricolor' },
  { needle: 'rayada', canon: 'Rayada' },
];

function cleanRaw(raw: string): string {
  let v = String(raw ?? '').trim();
  if (!v) return v;
  // Sufijos de código: "Gris - 823", "Verde - 402", "Negro - 999"
  v = v.replace(/\s*[-–—]\s*\d+\s*$/i, '').trim();
  v = v.replace(/\s*[-–—]\s*\d{2,4}\s*$/i, '').trim();
  v = v.replace(/\s+\d{3,4}\s*$/i, '').trim();
  v = v.replace(/\s+/g, ' ');
  return v;
}

/** Si el texto empieza por un color de catálogo, devuelve el nombre canónico. */
function canonicalFromLeadingColorWord(cleaned: string): string | null {
  const first = normKey(cleaned.split(/\s+/)[0] ?? '');
  if (!first) return null;
  if (ALIASES[first]) return ALIASES[first];
  for (const name of STANDARD_COLOR_NAMES) {
    if (normKey(name) === first) return name;
  }
  return null;
}

/**
 * Convierte el valor del atributo Color en Tienda Nube a un nombre de catálogo estándar.
 */
export function normalizeColorNameToStandard(raw: string): string {
  const cleaned = cleanRaw(raw);
  if (!cleaned) return cleaned;

  const key = normKey(cleaned);
  if (ALIASES[key]) return ALIASES[key];

  for (const name of STANDARD_COLOR_NAMES) {
    if (normKey(name) === key) return name;
  }

  const fromFirst = canonicalFromLeadingColorWord(cleaned);
  if (fromFirst) return fromFirst;

  for (const { needle, canon } of PHRASE_MATCHES) {
    if (key.includes(needle)) return canon;
  }

  return cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** true si el valor en TN aún no está en catálogo (código, sin acento, etc.). */
export function colorValueNeedsNormalization(raw: string): boolean {
  const current = String(raw ?? '').trim();
  if (!current) return false;
  const normalized = normalizeColorNameToStandard(current);
  return normKey(current) !== normKey(normalized) || current !== normalized;
}

export function shouldUpdateColorValue(current: string, normalized: string): boolean {
  if (!normalized) return false;
  if (colorValueNeedsNormalization(current)) return true;
  if (current === normalized) return false;
  if (normKey(current) === normKey(normalized)) return current !== normalized;
  return true;
}

export function isStandardColorName(value: string): boolean {
  const n = normalizeColorNameToStandard(value);
  return (STANDARD_COLOR_NAMES as readonly string[]).includes(n);
}
