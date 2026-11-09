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

/**
 * CABA, GBA y partidos del AMBA: el reparto llega al domicilio.
 * El resto del país se despacha en la dirección del transporte.
 */
const LOCAL_DELIVERY_KEYS = new Set([
  'caba',
  'gba',
  'amba',
  'conurbano',
  'gran buenos aires',
  'buenos aires',
  'capital',
  'capital federal',
  'zona norte',
  'zona sur',
  'zona oeste',
  'almirante brown',
  'avellaneda',
  'berazategui',
  'berisso',
  'campana',
  'canuelas',
  'caseros',
  'castelar',
  'ciudadel',
  'ciudadela',
  'dock sud',
  'don torcuato',
  'ensenada',
  'escobar',
  'esteban echeverria',
  'ezeiza',
  'florencio varela',
  'florida',
  'general rodriguez',
  'general san martin',
  'haedo',
  'hurlingham',
  'ituzaingo',
  'jose c paz',
  'jose c. paz',
  'la matanza',
  'la plata',
  'lanus',
  'lomas de zamora',
  'lujan',
  'malvinas argentinas',
  'marcos paz',
  'martinez',
  'merlo',
  'moreno',
  'moron',
  'munro',
  'olivos',
  'pilar',
  'presidente peron',
  'quilmes',
  'ramos mejia',
  'san fernando',
  'san isidro',
  'san justo',
  'san martin',
  'san miguel',
  'san vicente',
  'temperley',
  'tigre',
  'tres de febrero',
  'vicente lopez',
  'wilde',
  'zarate',
  'adrogue',
  'banfield',
  'beccar',
  'bernal',
  'boulogne',
  'burzaco',
  'canning',
  'claypole',
  'gerli',
  'glew',
  'gonzalez catan',
  'grand bourg',
  'guernica',
  'isidro casanova',
  'laferrere',
  'lanus este',
  'lanus oeste',
  'llavallol',
  'lomas del mirador',
  'longchamps',
  'los polvorines',
  'luis guillon',
  'monte grande',
  'nordelta',
  'paso del rey',
  'pineyro',
  'pontevedra',
  'rafael castillo',
  'ranelagh',
  'remedios de escalada',
  'san francisco solano',
  'sarandi',
  'tapiales',
  'tristan suarez',
  'valentin alsina',
  'villa adelina',
  'villa ballester',
  'virreyes',
]);

export function isLocalDeliveryCity(place: string): boolean {
  const key = normalizeCityKey(place);
  if (!key) return false;
  if (key === 'caba' || LOCAL_DELIVERY_KEYS.has(key)) return true;
  return /\bcaba\b|\bcapital federal\b|\bcap\.?\s*fed\b|\bgba\b|\bamba\b|\bconurbano\b|\bgran buenos aires\b|\bbs\.?\s*as\.?\b|\bbsas\b/.test(key);
}

/** Ciudad o zona fuera de CABA/GBA. Sin dato, no se asume interior. */
export function isInteriorDeliveryPlace(city?: string, accountZone?: string): boolean {
  const cityTrim = String(city || '').trim();
  if (cityTrim) return !isLocalDeliveryCity(cityTrim);
  const zoneTrim = String(accountZone || '').trim();
  if (zoneTrim) return !isLocalDeliveryCity(zoneTrim);
  return false;
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
