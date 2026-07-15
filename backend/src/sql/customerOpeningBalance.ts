/** Saldo inicial manual en `customers` (no import Tango). */

export const SQL_CUSTOMER_OPENING_BALANCE_EXPR = 'COALESCE(c.opening_balance, 0)';

/** Con `orders` alias `o` y `customers` alias `co` con `co.id = o.customer_id`. */
export const SQL_OPENING_ORDER_DATE_WHERE = `(
  co.opening_balance_date IS NULL
  OR DATE(o.date) >= co.opening_balance_date
)`;

/** Con `payments` alias `p` y `customers` alias `cp` con `cp.id = p.customer_id`. */
export const SQL_OPENING_PAYMENT_DATE_WHERE = `(
  cp.opening_balance_date IS NULL
  OR DATE(p.date) >= cp.opening_balance_date
)`;

/** Con `customer_manual_comprobantes` alias `m` y `customers` alias `co`. */
export const SQL_OPENING_MANUAL_DATE_WHERE = `(
  co.opening_balance_date IS NULL
  OR DATE(m.fecha) >= co.opening_balance_date
)`;

/**
 * Factura AFIP en cartera: misma regla que el historial (cualquier fecha del movimiento
 * en o después del saldo inicial). Requiere `invoices i`, `orders o`, `customers co`.
 */
export const SQL_OPENING_AFIP_INVOICE_DATE_WHERE = `(
  co.opening_balance_date IS NULL
  OR DATE(o.date) >= co.opening_balance_date
  OR (i.created_at IS NOT NULL AND DATE(i.created_at) >= co.opening_balance_date)
)`;

/** NC AFIP en cartera (`credit_notes cn`, `orders o`, `customers co`). */
export const SQL_OPENING_AFIP_CN_DATE_WHERE = `(
  co.opening_balance_date IS NULL
  OR DATE(o.date) >= co.opening_balance_date
  OR DATE(cn.created_at) >= co.opening_balance_date
)`;

export function parseOpeningBalanceInput(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

/** Alias de tabla `customers` en consultas de `payments p`. */
export function sqlOpeningPaymentDateWhere(customerAlias: string): string {
  return `(
  ${customerAlias}.opening_balance_date IS NULL
  OR DATE(p.date) >= ${customerAlias}.opening_balance_date
)`;
}

/** Fecha a YYYY-MM-DD (comparaciones en JS; evita "Tue Mar 31" de `Date#toString`). */
export function normalizeYmdDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // Usar componentes UTC: MySQL DATE / strings ISO suelen venir como medianoche UTC.
    // Con getDate() local en AR (UTC-3) el día baja uno.
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseOpeningBalanceDateInput(v: unknown): string | null {
  return normalizeYmdDate(v);
}

/**
 * Date para celdas ExcelJS: día civil en zona local (mediodía).
 * Evita el desfase de un día de `new Date('YYYY-MM-DD')` (medianoche UTC) en AR.
 */
export function ymdToExcelDate(v: unknown): Date | null {
  const ymd = normalizeYmdDate(v);
  if (!ymd) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12, 0, 0);
}

/** true si `lineDate` es el mismo día o posterior a `openingYmd` (ambos YYYY-MM-DD). */
export function movementOnOrAfterOpeningDate(lineDate: unknown, openingYmd: string | null): boolean {
  if (!openingYmd) return true;
  const d = normalizeYmdDate(lineDate);
  if (!d) return true;
  return d >= openingYmd;
}
