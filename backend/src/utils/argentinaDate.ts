const AR_TZ = 'America/Argentina/Buenos_Aires';

/** Fecha local Argentina YYYY-MM-DD (emisión AFIP / “hoy”). */
export function todayYmdArgentina(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: AR_TZ }).format(new Date());
}

/** Timestamp MySQL `YYYY-MM-DD HH:mm:ss` en hora Argentina. */
export function nowMysqlArgentina(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: AR_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}
