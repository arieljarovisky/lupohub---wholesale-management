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

export function canonicalizeCityInput(city: unknown): string | null {
  const trimmed = String(city ?? '').trim();
  if (!trimmed) return null;
  const raw = stripAccents(trimmed).toLowerCase();
  if (CABA_PATTERNS.some((rx) => rx.test(raw))) return 'CABA';
  return trimmed;
}
