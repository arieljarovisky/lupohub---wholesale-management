/** Variantes de Ciudad Autónoma de Buenos Aires → clave única `caba`. */
const CABA_PATTERNS: RegExp[] = [
  /^caba$/i,
  /^c\.?\s*a\.?\s*b\.?\s*a\.?$/i,
  /^capital\s*federal$/i,
  /^cap\.?\s*fed\.?$/i,
  /^ciudad\s*(autonoma|autónoma)\s*(de\s*)?buenos\s*aires$/i,
  /^ciudad\s*de\s*buenos\s*aires$/i,
  /^cdba$/i,
];

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Clave para comparar / filtrar (ej. caba, rosario). */
export function normalizeCityKey(city: string): string {
  const raw = stripAccents(String(city || '').trim().toLowerCase());
  if (!raw) return '';
  if (CABA_PATTERNS.some((rx) => rx.test(raw))) return 'caba';
  return raw;
}

export function isCabaCity(city: string): boolean {
  return normalizeCityKey(city) === 'caba';
}

/** Valor canónico al guardar (CABA para Capital Federal y variantes). */
export function canonicalizeCityInput(city: string): string {
  const trimmed = String(city || '').trim();
  if (!trimmed) return '';
  if (isCabaCity(trimmed)) return 'CABA';
  return trimmed;
}

/** Etiqueta unificada para listados y filtros. */
export function cityDisplayLabel(city: string): string {
  if (isCabaCity(city)) return 'CABA / Capital Federal';
  return String(city || '').trim() || '—';
}

export function cityMatchesFilter(city: string, filterKey: string): boolean {
  const f = String(filterKey || '').trim();
  if (!f || f === 'ALL') return true;
  const cityKey = normalizeCityKey(city);
  const filterNorm = normalizeCityKey(f);
  if (filterNorm === 'caba' || cityKey === 'caba') {
    return cityKey === 'caba' && filterNorm === 'caba';
  }
  if (filterNorm && cityKey === filterNorm) return true;
  return stripAccents(city).toLowerCase().includes(stripAccents(f).toLowerCase());
}

export type CityFilterOption = { value: string; label: string };

/** Agrupa ciudades equivalentes (CABA + Capital Federal → una opción). */
export function buildCityFilterOptions(cities: string[]): CityFilterOption[] {
  const byKey = new Map<string, Set<string>>();
  for (const c of cities) {
    const t = String(c || '').trim();
    if (!t) continue;
    const key = normalizeCityKey(t);
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key)!.add(t);
  }
  const opts: CityFilterOption[] = [];
  for (const [key, variants] of byKey) {
    if (key === 'caba') {
      opts.push({ value: 'caba', label: 'CABA / Capital Federal' });
    } else {
      const sorted = Array.from(variants).sort((a, b) => a.localeCompare(b, 'es'));
      opts.push({ value: key, label: sorted[0] });
    }
  }
  return opts.sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

export const CITY_QUICK_PICKS: { label: string; canonical: string }[] = [
  { label: 'CABA', canonical: 'CABA' },
  { label: 'Capital Federal', canonical: 'CABA' },
  { label: 'GBA', canonical: 'GBA' },
  { label: 'La Plata', canonical: 'La Plata' },
  { label: 'Rosario', canonical: 'Rosario' },
  { label: 'Córdoba', canonical: 'Córdoba' },
];
