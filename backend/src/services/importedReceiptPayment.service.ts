import { v4 as uuidv4 } from 'uuid';
import { execute, get, query } from '../database/db';

function normalizeReceiptNumberStrict(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function parseImportedAmount(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.abs(v) : 0;
  const s = String(v).trim().replace(/\s/g, '').replace(/\$/g, '');
  if (!s) return 0;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  let n = 0;
  if (hasComma && hasDot) {
    n = Number(s.replace(/\./g, '').replace(',', '.'));
  } else if (hasComma) {
    n = Number(s.replace(',', '.'));
  } else {
    n = Number(s);
  }
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

function toSqlDate(value: unknown): string {
  if (typeof value === 'string') {
    const raw = value.trim();
    const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
  }
  const d = new Date(value as string | number | Date);
  if (Number.isNaN(d.getTime())) return String(value || '').slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export type ImportedReceiptEntry = {
  customer_id: string;
  line_order: number;
  line_date: string;
  numero: string | null;
  importe: number | string;
  detalle: string | null;
  seller_id?: string | null;
};

export async function getImportedReceiptEntry(
  customerId: string,
  lineOrder: number
): Promise<ImportedReceiptEntry | null> {
  const entry = (await get(
    `SELECT e.customer_id, e.line_order, e.line_date, e.numero, e.importe, e.detalle, e.tipo, c.seller_id
     FROM customer_multimedia_entries e
     JOIN customers c ON c.id = e.customer_id
     WHERE e.customer_id = ? AND e.line_order = ?
     LIMIT 1`,
    [customerId, lineOrder]
  )) as (ImportedReceiptEntry & { tipo?: string }) | undefined;
  if (!entry) return null;
  const t = String(entry.tipo || '').trim().toUpperCase();
  if (!t.startsWith('REC')) {
    throw Object.assign(new Error('La línea indicada no es un recibo importado'), { statusCode: 400 });
  }
  return entry;
}

export async function findExistingPaymentIdForImportedEntry(
  entry: ImportedReceiptEntry
): Promise<string | null> {
  const customerId = entry.customer_id;
  const amount = Math.round(parseImportedAmount(entry.importe) * 100) / 100;
  const date = toSqlDate(entry.line_date);
  const receiptNumber = String(entry.numero || '').trim();
  const receiptStrict = normalizeReceiptNumberStrict(receiptNumber);

  const row = (await get(
    `SELECT id FROM payments
     WHERE customer_id = ?
       AND ABS(amount - ?) < 0.01
       AND (
         (receipt_number = ? AND DATE(date) = DATE(?))
         OR (
           UPPER(
             REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(receipt_number, '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
           ) = ?
           AND ABS(DATEDIFF(DATE(date), DATE(?))) <= 1
         )
       )
     LIMIT 1`,
    [customerId, amount, receiptNumber, date, receiptStrict, date]
  )) as { id?: string } | undefined;
  return row?.id ? String(row.id) : null;
}

/** Crea fila en \`payments\` a partir del recibo Tango si aún no existe (misma clave fecha+nro+importe). */
export async function findOrCreatePaymentFromImportedReceipt(
  customerId: string,
  lineOrder: number,
  sellerIdForInsert: string | null
): Promise<string> {
  const entry = await getImportedReceiptEntry(customerId, lineOrder);
  if (!entry) {
    throw Object.assign(new Error('Recibo importado no encontrado'), { statusCode: 404 });
  }

  const existingId = await findExistingPaymentIdForImportedEntry(entry);
  if (existingId) return existingId;

  const amount = Math.round(parseImportedAmount(entry.importe) * 100) / 100;
  const date = toSqlDate(entry.line_date);
  const receiptNumber = String(entry.numero || '').trim() || `IMPORT-${lineOrder}`;
  const notes = entry.detalle ? `Importado Tango: ${entry.detalle}` : 'Importado Tango';
  const sellerId = sellerIdForInsert ?? entry.seller_id ?? null;

  const id = uuidv4();
  await execute(
    `INSERT INTO payments (id, customer_id, seller_id, order_id, invoice_id, receipt_number, date, amount, notes)
     VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    [id, customerId, sellerId, receiptNumber, date, amount, notes]
  );
  return id;
}

export async function getPaymentAllocationIds(paymentId: string): Promise<{
  invoiceIds: string[];
  orderIds: string[];
}> {
  let invoiceIds: string[] = [];
  let orderIds: string[] = [];

  try {
    const invRows = (await query(`SELECT invoice_id FROM payment_invoices WHERE payment_id = ?`, [
      paymentId,
    ])) as Array<{ invoice_id: string }>;
    invoiceIds = invRows.map((r) => String(r.invoice_id)).filter(Boolean);
  } catch {
    /* tabla payment_invoices puede no existir en esquemas viejos */
  }

  try {
    const ordRows = (await query(`SELECT order_id FROM payment_orders WHERE payment_id = ?`, [
      paymentId,
    ])) as Array<{ order_id: string }>;
    orderIds = ordRows.map((r) => String(r.order_id)).filter(Boolean);
  } catch {
    /* tabla payment_orders puede no existir en esquemas viejos */
  }

  const legacy = (await get(`SELECT invoice_id, order_id FROM payments WHERE id = ?`, [paymentId])) as
    | { invoice_id?: string; order_id?: string }
    | undefined;
  if (legacy?.invoice_id && !invoiceIds.includes(legacy.invoice_id)) {
    invoiceIds.unshift(legacy.invoice_id);
  }
  if (legacy?.order_id && !orderIds.includes(legacy.order_id)) {
    orderIds.unshift(legacy.order_id);
  }

  return { invoiceIds, orderIds };
}
