/**
 * Artículos vigentes para pedir a Brasil.
 * Fuente: catálogos Lupo subidos por el usuario (hombre 2024/25, lencería 2023/24,
 * medias deportivas 2023/24 y nuevos artículos 2025).
 * Si un artículo no está acá, se considera discontinuado y no se sugiere reponer.
 */
export type LupoCatalogArticle = {
  /** Código del catálogo, ej. 00691-002 */
  code: string;
  /** SKU compacto LupoHub / Tango, ej. 0069102 */
  sku: string;
  catalog: string;
};

export const LUPO_CATALOG_SOURCES = [
  'Hombre — bóxer, slip y medias (Verano 2024/25)',
  'Lencería y compresión (Verão 2023/24)',
  'Medias deportivas (Verão 2023/24)',
  'Nuevos artículos (2025)'
] as const;

/** Páginas de liquidación / reemplazados: no pedir a Brasil. */
export const LUPO_DISCONTINUED_CODES = [
  '03223-001', // entra solo como kit tripack
  '03235-001',
  '03240-023',
  '03265-034',
  '03270-001', // reemplazado por 03270-073
  '03350-02',
  '03360-01'
] as const;

const RAW_CURRENT: Array<{ code: string; catalog: string }> = [
  { code: '00136-001', catalog: 'Hombre' },
  { code: '00137-010', catalog: 'Hombre' },
  { code: '00141-003', catalog: 'Hombre' },
  { code: '00141-088', catalog: 'Hombre' },
  { code: '00523-003', catalog: 'Hombre' },
  { code: '00523-088', catalog: 'Hombre' },
  { code: '00524-002', catalog: 'Hombre' },
  { code: '00554-002', catalog: 'Hombre' },
  { code: '00554-003', catalog: 'Hombre' },
  { code: '00624-003', catalog: 'Hombre' },
  { code: '00661-001', catalog: 'Hombre' },
  { code: '00663-037', catalog: 'Hombre' },
  { code: '00671-002', catalog: 'Hombre' },
  { code: '00674-001', catalog: 'Hombre' },
  { code: '00691-002', catalog: 'Hombre' },
  { code: '00733-004', catalog: 'Hombre' },
  { code: '01100-011', catalog: 'Hombre' },
  { code: '01275-001', catalog: 'Hombre' },
  { code: '17800-001', catalog: 'Hombre' },
  { code: '1800-003', catalog: 'Hombre' },
  { code: '1810-001', catalog: 'Hombre' },
  { code: '00800-001', catalog: 'Lencería' },
  { code: '05510-001', catalog: 'Lencería' },
  { code: '05520-001', catalog: 'Lencería' },
  { code: '05530-001', catalog: 'Lencería' },
  { code: '05540-001', catalog: 'Lencería' },
  { code: '05690-003', catalog: 'Lencería' },
  { code: '05692-001', catalog: 'Lencería' },
  { code: '05694-001', catalog: 'Lencería' },
  { code: '05695-001', catalog: 'Lencería' },
  { code: '05696-001', catalog: 'Lencería' },
  { code: '05697-001', catalog: 'Lencería' },
  { code: '05913-001', catalog: 'Lencería' },
  { code: '40300-001', catalog: 'Lencería' },
  { code: '40306-001', catalog: 'Lencería' },
  { code: '40320-001', catalog: 'Lencería' },
  { code: '40351-001', catalog: 'Lencería' },
  { code: '40354-001', catalog: 'Lencería' },
  { code: '40355-001', catalog: 'Lencería' },
  { code: '40400-001', catalog: 'Lencería' },
  { code: '40450-001', catalog: 'Lencería' },
  { code: '40460-003', catalog: 'Lencería' },
  { code: '40500-001', catalog: 'Lencería' },
  { code: '40600-001', catalog: 'Lencería' },
  { code: '40800-001', catalog: 'Lencería' },
  { code: '40900-001', catalog: 'Lencería' },
  { code: '41000-001', catalog: 'Lencería' },
  { code: '41010-001', catalog: 'Lencería' },
  { code: '41027-001', catalog: 'Lencería' },
  { code: '41034-001', catalog: 'Lencería' },
  { code: '41050-001', catalog: 'Lencería' },
  { code: '41055-001', catalog: 'Lencería' },
  { code: '41060-001', catalog: 'Lencería' },
  { code: '41200-001', catalog: 'Lencería' },
  { code: '41216-001', catalog: 'Lencería' },
  { code: '41250-001', catalog: 'Lencería' },
  { code: '41260-003', catalog: 'Lencería' },
  { code: '41300-001', catalog: 'Lencería' },
  { code: '41800-001', catalog: 'Lencería' },
  { code: '41805-001', catalog: 'Lencería' },
  { code: '41806-001', catalog: 'Lencería' },
  { code: '41850-002', catalog: 'Lencería' },
  { code: '44000-001', catalog: 'Lencería' },
  { code: '45137-001', catalog: 'Lencería' },
  { code: '45143-001', catalog: 'Lencería' },
  { code: '47100-001', catalog: 'Lencería' },
  { code: '47120-001', catalog: 'Lencería' },
  { code: '47150-001', catalog: 'Lencería' },
  { code: '47160-001', catalog: 'Lencería' },
  { code: '47180-001', catalog: 'Lencería' },
  { code: '47182-001', catalog: 'Lencería' },
  { code: '47183-001', catalog: 'Lencería' },
  { code: '03223-089', catalog: 'Medias' },
  { code: '03225-070', catalog: 'Medias' },
  { code: '03225-089', catalog: 'Medias' },
  { code: '03235-002', catalog: 'Medias' },
  { code: '03270-073', catalog: 'Medias' },
  { code: '03270-089', catalog: 'Medias' },
  { code: '03271-089', catalog: 'Medias' },
  { code: '03286-002', catalog: 'Medias' },
  { code: '03310-003', catalog: 'Medias' },
  { code: '03350-001', catalog: 'Medias' },
  { code: '04421-003', catalog: 'Medias' },
  { code: '04575-004', catalog: 'Medias' },
  { code: '663-047', catalog: 'Nuevos' },
  { code: '663-048', catalog: 'Nuevos' },
  { code: '00663-048', catalog: 'Nuevos' },
  { code: '15424-001', catalog: 'Nuevos' },
  { code: '15570-001', catalog: 'Nuevos' }
];

/** 00691-002 → 0069102 (5 dígitos de artículo + 2 últimos del sufijo). */
export function compactLupoSku(catalogCode: string): string {
  const raw = String(catalogCode || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  const m = raw.match(/^([A-Z]*)(\d{3,6})-(\d{2,3})$/);
  if (!m) {
    const digits = raw.replace(/\D/g, '');
    return digits.length <= 7 ? digits.padStart(7, '0') : digits.slice(0, 7);
  }
  const head5 = m[2].padStart(5, '0');
  return `${head5}${m[3].slice(-2)}`;
}

function addKey(set: Set<string>, value: string) {
  const v = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s]/g, '');
  if (!v) return;
  set.add(v);
  const digits = v.replace(/\D/g, '');
  if (digits) {
    set.add(digits);
    set.add(digits.replace(/^0+/, '') || '0');
    if (digits.length <= 7) set.add(digits.padStart(7, '0'));
  }
}

export function articleMatchKeys(skuOrCode: string): Set<string> {
  const keys = new Set<string>();
  const raw = String(skuOrCode || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (!raw) return keys;
  addKey(keys, raw);
  if (raw.includes('-')) {
    addKey(keys, compactLupoSku(raw));
    return keys;
  }
  const digits = raw.replace(/\D/g, '');
  if (digits) {
    addKey(keys, digits);
    if (digits.length >= 7) addKey(keys, digits.slice(0, 7));
  }
  return keys;
}

export const LUPO_CURRENT_CATALOG: LupoCatalogArticle[] = RAW_CURRENT.map((row) => ({
  ...row,
  sku: compactLupoSku(row.code)
}));

const CURRENT_BY_KEY = new Map<string, LupoCatalogArticle>();
for (const row of LUPO_CURRENT_CATALOG) {
  for (const k of articleMatchKeys(row.code)) CURRENT_BY_KEY.set(k, row);
  for (const k of articleMatchKeys(row.sku)) CURRENT_BY_KEY.set(k, row);
}

export function matchCurrentCatalog(productSku: string): LupoCatalogArticle | null {
  for (const k of articleMatchKeys(productSku)) {
    const hit = CURRENT_BY_KEY.get(k);
    if (hit) return hit;
  }
  return null;
}

export function isCurrentCatalogSku(productSku: string): boolean {
  return matchCurrentCatalog(productSku) != null;
}
