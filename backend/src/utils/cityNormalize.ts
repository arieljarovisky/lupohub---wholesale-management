const CABA_PATTERNS: RegExp[] = [
  /^caba$/i,
  /^c\.?\s*a\.?\s*b\.?\s*a\.?$/i,
  /^capital\s*federal$/i,
  /^cap\.?\s*fed\.?$/i,
  /^ciudad\s*(autonoma|autónoma)\s*(de\s*)?buenos\s*aires$/i,
  /^ciudad\s*de\s*buenos\s*aires$/i,
];

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeCityKey(city: string): string {
  const raw = stripAccents(String(city || '').trim().toLowerCase());
  if (!raw) return '';
  if (CABA_PATTERNS.some((rx) => rx.test(raw))) return 'caba';
  return raw;
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

export function canonicalizeCityInput(city: unknown): string | null {
  const trimmed = String(city ?? '').trim();
  if (!trimmed) return null;
  if (normalizeCityKey(trimmed) === 'caba') return 'CABA';
  return trimmed;
}
