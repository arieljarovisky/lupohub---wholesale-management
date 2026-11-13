/** Zona horaria de todo el sistema: Argentina, sin horario de verano. */
export const AR_TIME_ZONE = 'America/Argentina/Buenos_Aires';

/** Fecha civil Argentina de un instante, YYYY-MM-DD. */
export function todayYmdArgentina(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: AR_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function argentinaCalendar(now: Date = new Date()): { y: number; m: number; d: number } {
  const ymd = todayYmdArgentina(now);
  const [y, m, d] = ymd.split('-').map(Number);
  return { y, m, d };
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
 * Un `YYYY-MM-DD` no se corre. Un instante con zona pasa a la fecha de Argentina.
 * Un DATETIME sin zona se toma como reloj de Argentina.
 */
export function tryYmdArgentina(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    if (isUtcMidnight(value)) return utcYmd(value);
    return todayYmdArgentina(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 20000 && value < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
      return Number.isNaN(d.getTime()) ? null : utcYmd(d);
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    if (isUtcMidnight(d)) return utcYmd(d);
    return todayYmdArgentina(d);
  }
  const s = String(value).trim();
  if (!s) return null;
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s);
  if (ymd && !hasZone) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return ymd ? `${ymd[1]}-${ymd[2]}-${ymd[3]}` : null;
  if (isUtcMidnight(d)) return utcYmd(d);
  return todayYmdArgentina(d);
}

export function ymdArgentina(value: unknown = new Date()): string {
  return tryYmdArgentina(value) ?? todayYmdArgentina();
}

/** Instante para mostrar. Fechas sueltas se anclan al mediodía de Argentina para no correr el día. */
export function toArgentinaInstant(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 20000 && value < 80000) {
      return new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(value ?? '').trim();
  if (!s) return null;
  if (/^\d{8}$/.test(s)) return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T12:00:00-03:00`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T12:00:00-03:00`);
  const naive = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)?$/);
  if (naive && naive[2]) {
    const time = naive[2].length === 5 ? `${naive[2]}:00` : naive[2];
    return new Date(`${naive[1]}T${time}-03:00`);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s) && !/[T ]\d{2}:\d{2}/.test(s) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    return new Date(`${s.slice(0, 10)}T12:00:00-03:00`);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Fecha u hora siempre en Argentina, aunque la PC esté en otra zona. */
export function formatDateAr(
  value: unknown,
  options: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' }
): string {
  const d = toArgentinaInstant(value);
  if (!d) return '';
  return new Intl.DateTimeFormat('es-AR', { ...options, timeZone: AR_TIME_ZONE }).format(d);
}

/** Fecha de pedido / listado: DD/MM/YYYY sin hora. */
export function formatOrderDate(dateStr: string | null | undefined): string {
  if (dateStr == null || String(dateStr).trim() === '') return '';
  const formatted = formatDateAr(dateStr, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return formatted || String(dateStr).slice(0, 10);
}

export function formatDateTimeAr(
  value: unknown,
  options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }
): string {
  return formatDateAr(value, options);
}
