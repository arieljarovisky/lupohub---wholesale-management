import fs from 'fs';
import path from 'path';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import { execute, get, query } from '../src/database/db';
import { v4 as uuidv4 } from 'uuid';

type CustomerRow = {
  id: string;
  business_name?: string | null;
  name?: string | null;
  seller_id?: string | null;
};

type SellerUser = {
  id: string;
  name: string;
  email?: string | null;
};

type Candidate = {
  sellerCode: string;
  sellerName: string;
  customerName: string;
  receiptNumber: string;
  date: string;
  amount: number;
};

function normalizeText(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function parseAmount(v: string): number {
  const clean = String(v || '').trim().replace(/,/g, '');
  const n = Number(clean);
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) / 100 : 0;
}

function toSqlDateFromAr(v: string): string | null {
  const m = String(v || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const dd = m[1];
  const mm = m[2];
  const yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}

function parseSellerMapArg(args: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const raw = args.find((a) => a.startsWith('--seller-map='))?.split('=')[1] ?? '';
  if (!raw) return out;
  for (const pair of raw.split(',').map((x) => x.trim()).filter(Boolean)) {
    const [code, userId] = pair.split(':');
    if (!code || !userId) continue;
    out.set(code.trim(), userId.trim());
  }
  return out;
}

/** Normaliza espacios (Word suele meter saltos raros). */
function normalizeReportLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function parseCandidatesFromReportText(text: string): Candidate[] {
  const lines = text.split(/\r?\n/);
  const out: Candidate[] = [];
  let currentSellerCode = '';
  let currentSellerName = '';

  const sellerHeaderRe = /^VENDEDOR\s*:\s*(\d+)\s+(.+?)\s*$/i;
  // 02/03/2026 REC 0000100025515  CLIENTE ...   120,000.10  (número de recibo puede ser alfanumérico)
  const recLineRe =
    /^(\d{2}\/\d{2}\/\d{4})\s+REC\s+(\S+)\s+(.+?)\s+([0-9][0-9,]*\.[0-9]{2})\s*$/i;

  for (const rawLine of lines) {
    const line = normalizeReportLine(rawLine);
    if (!line) continue;

    const h = line.match(sellerHeaderRe);
    if (h) {
      currentSellerCode = h[1].trim();
      currentSellerName = h[2].trim();
      continue;
    }

    const r = line.match(recLineRe);
    if (r && currentSellerCode) {
      const date = toSqlDateFromAr(r[1]);
      const receiptNumber = r[2].trim();
      const customerName = r[3].trim();
      const amount = parseAmount(r[4]);
      if (!date || !receiptNumber || !customerName || amount <= 0) continue;
      out.push({
        sellerCode: currentSellerCode,
        sellerName: currentSellerName,
        customerName,
        receiptNumber,
        date,
        amount,
      });
    }
  }

  return out;
}

async function extractTextFromFile(absPath: string): Promise<string> {
  const ext = path.extname(absPath).toLowerCase();
  const buf = fs.readFileSync(absPath);

  if (ext === '.pdf') {
    const parser = new PDFParse({ data: buf });
    const parsed = await parser.getText();
    await parser.destroy();
    return parsed.text || '';
  }

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer: buf });
    return result.value || '';
  }

  throw new Error(`Formato no soportado: ${ext}. Usá .pdf o .docx`);
}

function pickSellerId(
  candidate: Candidate,
  sellerMap: Map<string, string>,
  sellers: SellerUser[],
  fallbackSellerId: string | null | undefined
): { sellerId: string | null; matchedBy: string } {
  const mapped = sellerMap.get(candidate.sellerCode);
  if (mapped) return { sellerId: mapped, matchedBy: `map:${candidate.sellerCode}` };

  const target = normalizeText(candidate.sellerName);
  if (target) {
    const exact = sellers.filter((s) => normalizeText(s.name) === target);
    if (exact.length === 1) return { sellerId: exact[0].id, matchedBy: 'seller-name-exact' };

    const fuzzy = sellers.filter((s) => {
      const n = normalizeText(s.name);
      return n.includes(target) || target.includes(n);
    });
    if (fuzzy.length === 1) return { sellerId: fuzzy[0].id, matchedBy: 'seller-name-fuzzy' };
  }

  if (fallbackSellerId) return { sellerId: fallbackSellerId, matchedBy: 'customer.seller_id' };
  return { sellerId: null, matchedBy: 'none' };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const sellerMap = parseSellerMapArg(args);
  const files = args.filter((a) => !a.startsWith('--'));
  if (files.length === 0) {
    throw new Error(
      'Uso: ts-node scripts/import-seller-commissions.ts <reporte.pdf|.docx> [otro...] [--apply] [--seller-map=14:uuid,19:uuid]'
    );
  }

  const customers = (await query(
    `SELECT id, business_name, name, seller_id FROM customers`
  )) as CustomerRow[];
  const sellers = (await query(
    `SELECT id, name, email FROM users WHERE role = 'SELLER'`
  )) as SellerUser[];

  const customerByNorm = new Map<string, CustomerRow>();
  for (const c of customers) {
    const keys = [c.business_name, c.name].map((k) => normalizeText(k)).filter(Boolean);
    for (const k of keys) {
      if (!customerByNorm.has(k)) customerByNorm.set(k, c);
    }
  }

  const allCandidates: Candidate[] = [];
  for (const f of files) {
    const abs = path.resolve(f);
    if (!fs.existsSync(abs)) {
      throw new Error(`No existe el archivo: ${abs}`);
    }
    const text = await extractTextFromFile(abs);
    const candidates = parseCandidatesFromReportText(text);
    allCandidates.push(...candidates);
  }

  let imported = 0;
  let duplicated = 0;
  let customerNotFound = 0;
  const customerNotFoundNames = new Map<string, number>();
  const sellerMatchCount = new Map<string, number>();

  for (const c of allCandidates) {
    const cust = customerByNorm.get(normalizeText(c.customerName));
    if (!cust) {
      customerNotFound++;
      customerNotFoundNames.set(c.customerName, (customerNotFoundNames.get(c.customerName) || 0) + 1);
      continue;
    }

    const exists = await get(
      `SELECT id FROM payments
       WHERE customer_id = ? AND receipt_number = ? AND date = ? AND ABS(amount - ?) < 0.01
       LIMIT 1`,
      [cust.id, c.receiptNumber, c.date, c.amount]
    );
    if (exists) {
      duplicated++;
      continue;
    }

    const sellerPick = pickSellerId(c, sellerMap, sellers, cust.seller_id);
    sellerMatchCount.set(sellerPick.matchedBy, (sellerMatchCount.get(sellerPick.matchedBy) || 0) + 1);
    const notes = `Importado comisión vendedor (${c.sellerCode} ${c.sellerName})`;

    if (!dryRun) {
      await execute(
        `INSERT INTO payments (id, customer_id, seller_id, order_id, invoice_id, receipt_number, date, amount, notes)
         VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
        [uuidv4(), cust.id, sellerPick.sellerId, c.receiptNumber, c.date, c.amount, notes]
      );
    }
    imported++;
  }

  console.log('---------------------------------------');
  console.log(`Modo: ${dryRun ? 'DRY RUN (sin grabar)' : 'APPLY (grabando en DB)'}`);
  console.log(`Archivos: ${files.length}`);
  console.log(`Candidatos REC del reporte: ${allCandidates.length}`);
  console.log(`Importados: ${imported}`);
  console.log(`Duplicados omitidos: ${duplicated}`);
  console.log(`Sin cliente match: ${customerNotFound}`);
  console.log('Match seller usado:');
  for (const [k, n] of Array.from(sellerMatchCount.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`- ${k}: ${n}`);
  }
  if (customerNotFoundNames.size > 0) {
    console.log('Clientes no encontrados (top 20):');
    Array.from(customerNotFoundNames.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .forEach(([name, n]) => console.log(`- ${name}: ${n}`));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('[import-seller-commissions] Error:', e?.message || e);
  process.exit(1);
});

