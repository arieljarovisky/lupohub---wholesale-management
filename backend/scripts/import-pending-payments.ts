import path from 'path';
import * as XLSX from 'xlsx';
import { execute, query } from '../src/database/db';
import { v4 as uuidv4 } from 'uuid';

type CustomerRow = {
  id: string;
  business_name?: string | null;
  name?: string | null;
  seller_id?: string | null;
};

type PaymentCandidate = {
  customerName: string;
  receiptNumber: string;
  date: string;
  amount: number;
  notes: string;
};

function normalizeText(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeReceipt(v: unknown): string {
  return String(v ?? '').trim().replace(/\s+/g, '');
}

function normalizeReceiptStrict(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function toSqlDate(value: any): string | null {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function extractCandidatesFromWorkbook(filePath: string): PaymentCandidate[] {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const out: PaymentCandidate[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: null });
    for (const r of rows) {
      const tComp = String(r.T_COMP ?? '').trim().toUpperCase();
      if (tComp !== 'REC') continue;

      const receiptNumber = normalizeReceipt(r.N_COMP);
      const customerName = String(r.RAZON_SOC ?? '').trim();
      const date = toSqlDate(r.FECHA_EMIS ?? r.FECHA_APL ?? r.FECHA);
      const amount = Math.abs(toNumber(r.HABER) || toNumber(r.IMPORTE));

      if (!receiptNumber || !customerName || !date || amount <= 0) continue;

      out.push({
        customerName,
        receiptNumber,
        date,
        amount: Math.round(amount * 100) / 100,
        notes: `Importado desde Excel pendiente pagos (${path.basename(filePath)})`,
      });
    }
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const files = args.filter((a) => !a.startsWith('--'));
  if (files.length === 0) {
    throw new Error('Uso: ts-node scripts/import-pending-payments.ts <archivo1.xlsx> [archivo2.xlsx] [--apply]');
  }

  const customerRows = (await query(
    `SELECT id, business_name, name, seller_id FROM customers`
  )) as CustomerRow[];

  const customerByNorm = new Map<string, CustomerRow>();
  for (const c of customerRows) {
    const keys = [c.business_name, c.name].map((k) => normalizeText(k)).filter(Boolean);
    for (const k of keys) {
      if (!customerByNorm.has(k)) customerByNorm.set(k, c);
    }
  }

  const candidates = files.flatMap((f) => extractCandidatesFromWorkbook(f));

  let imported = 0;
  let duplicate = 0;
  let notFound = 0;
  const notFoundNames = new Map<string, number>();

  for (const c of candidates) {
    const norm = normalizeText(c.customerName);
    const customer = customerByNorm.get(norm);
    if (!customer) {
      notFound++;
      notFoundNames.set(c.customerName, (notFoundNames.get(c.customerName) || 0) + 1);
      continue;
    }

    const receiptStrict = normalizeReceiptStrict(c.receiptNumber);
    const exists = await query(
      `SELECT id FROM payments
       WHERE customer_id = ?
         AND ABS(amount - ?) < 0.01
         AND (
           (receipt_number = ? AND date = ?)
           OR (
             UPPER(
               REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(receipt_number, '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
             ) = ?
             AND ABS(DATEDIFF(date, ?)) <= 1
           )
         )
       LIMIT 1`,
      [customer.id, c.amount, c.receiptNumber, c.date, receiptStrict, c.date]
    );
    if ((exists as any[]).length > 0) {
      duplicate++;
      continue;
    }

    if (!dryRun) {
      await execute(
        `INSERT INTO payments (id, customer_id, seller_id, order_id, invoice_id, receipt_number, date, amount, notes)
         VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
        [uuidv4(), customer.id, customer.seller_id ?? null, c.receiptNumber, c.date, c.amount, c.notes]
      );
    }
    imported++;
  }

  console.log('---------------------------------------');
  console.log(`Modo: ${dryRun ? 'DRY RUN (sin grabar)' : 'APPLY (grabando en DB)'}`);
  console.log(`Archivos: ${files.length}`);
  console.log(`Candidatos REC: ${candidates.length}`);
  console.log(`Importados: ${imported}`);
  console.log(`Duplicados omitidos: ${duplicate}`);
  console.log(`Sin cliente match: ${notFound}`);
  if (notFoundNames.size > 0) {
    console.log('Clientes no encontrados (top 20):');
    Array.from(notFoundNames.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .forEach(([name, n]) => console.log(`- ${name}: ${n}`));
  }
}

main().catch((e) => {
  console.error('[import-pending-payments] Error:', e?.message || e);
  process.exit(1);
});

