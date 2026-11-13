const AR_TZ = 'America/Argentina/Buenos_Aires';

export const AR_TIME_ZONE = AR_TZ;

const MONTHS_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

/** Fecha civil Argentina de un instante, YYYY-MM-DD. */
export function formatYmdInArgentina(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: AR_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Fecha local Argentina YYYY-MM-DD (emisión AFIP / “hoy”). */
export function todayYmdArgentina(now: Date = new Date()): string {
  return formatYmdInArgentina(now);
}

/** Nombre del mes actual en español (hora Argentina), p. ej. «agosto». */
export function currentMonthNameEs(): string {
  const mm = Number(todayYmdArgentina().slice(5, 7));
  return MONTHS_ES[mm - 1] ?? '';
}

function part(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((p) => p.type === type)?.value ?? '00';
}

/** Timestamp MySQL `YYYY-MM-DD HH:mm:ss` en hora Argentina. */
export function nowMysqlArgentina(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: AR_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  let hour = part(parts, 'hour');
  if (hour === '24') hour = '00';
  return `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')} ${hour}:${part(parts, 'minute')}:${part(parts, 'second')}`;
}

function isUtcMidnight(d: Date): boolean {
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
}

function utcYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Día civil.
 * - `YYYY-MM-DD` y `DD/MM/YYYY` se respetan.
 * - Una columna DATE de MySQL llega como medianoche UTC: se conserva ese día.
 * - Un instante (ISO con zona) pasa a la fecha de Argentina.
 * - Un DATETIME sin zona se toma como reloj de Argentina.
 */
export function tryYmdArgentina(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    if (isUtcMidnight(value)) return utcYmd(value);
    return formatYmdInArgentina(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 20000 && value < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
      return Number.isNaN(d.getTime()) ? null : utcYmd(d);
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    if (isUtcMidnight(d)) return utcYmd(d);
    return formatYmdInArgentina(d);
  }
  const s = String(value).trim();
  if (!s) return null;
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const hasTime = /[T ]\d{2}:\d{2}/.test(s);
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s);
  if (ymd && !hasZone) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return ymd ? `${ymd[1]}-${ymd[2]}-${ymd[3]}` : null;
  if (!hasTime || isUtcMidnight(d)) return isUtcMidnight(d) ? utcYmd(d) : ymd ? `${ymd[1]}-${ymd[2]}-${ymd[3]}` : null;
  return formatYmdInArgentina(d);
}

/** Igual que `tryYmdArgentina`, y si no se puede leer devuelve hoy en Argentina. */
export function ymdArgentina(value: unknown = new Date()): string {
  return tryYmdArgentina(value) ?? todayYmdArgentina();
}

/**
 * Un DATETIME guardado con reloj de Argentina (sin zona) → instante ISO UTC.
 * Los componentes UTC del Date que devuelve el driver son esos dígitos.
 */
export function argentinaWallToIso(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    const hh = String(value.getUTCHours()).padStart(2, '0');
    const mm = String(value.getUTCMinutes()).padStart(2, '0');
    const ss = String(value.getUTCSeconds()).padStart(2, '0');
    const instant = new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}-03:00`);
    return Number.isNaN(instant.getTime()) ? undefined : instant.toISOString();
  }
  const s = String(value).trim();
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  if (!m) {
    const day = tryYmdArgentina(s);
    return day ? new Date(`${day}T12:00:00-03:00`).toISOString() : undefined;
  }
  const instant = new Date(`${m[1]}T${m[2]}-03:00`);
  return Number.isNaN(instant.getTime()) ? undefined : instant.toISOString();
}

export function formatDateTimeArgentina(
  value: Date | string | number = new Date(),
  options: Intl.DateTimeFormatOptions = {}
): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('es-AR', { timeZone: AR_TZ, ...options }).format(d);
}
