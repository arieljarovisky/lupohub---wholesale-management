import { Request, Response } from 'express';
import { query, execute, get } from '../database/db';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';

const canManagePayments = (role?: string) =>
  role === 'ADMIN' || role === 'SELLER' || role === 'WAREHOUSE' || role === 'DEPOSITO';

/** Listar pagos con filtros opcionales (cliente, factura, pedido, desde/hasta). */
export const listPayments = async (req: any, res: Response) => {
  try {
    const user = req.user;
    if (!user || !canManagePayments(user.role)) {
      return res.status(403).json({ message: 'No autorizado' });
    }

    const { customerId, invoiceId, orderId, desde, hasta } = req.query as any;
    const where: string[] = [];
    const params: any[] = [];
    if (customerId) { where.push('p.customer_id = ?'); params.push(customerId); }
    if (invoiceId) { where.push('p.invoice_id = ?'); params.push(invoiceId); }
    if (orderId) { where.push('p.order_id = ?'); params.push(orderId); }
    if (desde) { where.push('p.date >= ?'); params.push(desde); }
    if (hasta) { where.push('p.date <= ?'); params.push(hasta); }

    // Para SELLER: solo pagos de sus clientes (seller_id = user.id) o pagos donde él es el vendedor del recibo
    if (user.role === 'SELLER') {
      where.push('(p.seller_id = ? OR c.seller_id = ?)');
      params.push(user.id, user.id);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await query(
      `
      SELECT
        p.id, p.customer_id, p.seller_id, p.order_id, p.invoice_id,
        p.receipt_number, p.date, p.amount, p.notes, p.created_at,
        c.business_name AS customer_business_name, c.name AS customer_name,
        u.name AS seller_name,
        i.punto_venta AS invoice_punto_venta, i.cbte_tipo AS invoice_cbte_tipo, i.cbte_desde AS invoice_cbte_desde
      FROM payments p
      JOIN customers c ON c.id = p.customer_id
      LEFT JOIN users u ON u.id = p.seller_id
      LEFT JOIN invoices i ON i.id = p.invoice_id
      ${whereSql}
      ORDER BY p.date DESC, p.created_at DESC
      `,
      params
    );

    res.json((rows || []).map((r: any) => ({
      id: r.id,
      customerId: r.customer_id,
      sellerId: r.seller_id ?? undefined,
      sellerName: r.seller_name ?? undefined,
      orderId: r.order_id ?? undefined,
      invoiceId: r.invoice_id ?? undefined,
      receiptNumber: r.receipt_number,
      date: r.date,
      amount: Number(r.amount) || 0,
      notes: r.notes ?? undefined,
      createdAt: r.created_at,
      customerBusinessName: r.customer_business_name ?? r.customer_name ?? '',
      invoice: r.invoice_id ? {
        puntoVta: r.invoice_punto_venta ?? undefined,
        cbteTipo: r.invoice_cbte_tipo ?? undefined,
        cbteDesde: r.invoice_cbte_desde ?? undefined
      } : undefined
    })));
  } catch (e: any) {
    console.error('listPayments:', e);
    res.status(500).json({ message: 'Error listando pagos', detail: e?.message });
  }
};

/** Crear pago/recibo. */
export const createPayment = async (req: any, res: Response) => {
  try {
    const user = req.user;
    if (!user || !canManagePayments(user.role)) {
      return res.status(403).json({ message: 'No autorizado' });
    }

    const body = req.body as {
      customerId?: string;
      sellerId?: string | null;
      orderId?: string | null;
      invoiceId?: string | null;
      receiptNumber?: string;
      date?: string;
      amount?: number;
      notes?: string;
    };

    const customerId = (body.customerId || '').toString().trim();
    const receiptNumber = (body.receiptNumber || '').toString().trim();
    const date = (body.date || '').toString().trim();
    const amount = body.amount != null ? Number(body.amount) : 0;

    if (!customerId) return res.status(400).json({ message: 'Falta customerId' });
    if (!receiptNumber) return res.status(400).json({ message: 'Falta número de recibo' });
    if (!date) return res.status(400).json({ message: 'Falta fecha' });
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ message: 'Monto inválido' });

    const cust = await get('SELECT id FROM customers WHERE id = ?', [customerId]);
    if (!cust) return res.status(404).json({ message: 'Cliente no encontrado' });

    const sellerId = body.sellerId ? String(body.sellerId).trim() : null;
    const orderId = body.orderId ? String(body.orderId).trim() : null;
    const invoiceId = body.invoiceId ? String(body.invoiceId).trim() : null;
    const notes = body.notes != null && String(body.notes).trim() ? String(body.notes).trim() : null;

    const receiptStrict = normalizeReceiptNumberStrict(receiptNumber);
    const existing = await get(
      `SELECT id, customer_id, seller_id, order_id, invoice_id, receipt_number, date, amount, notes, created_at
       FROM payments
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
      [customerId, amount, receiptNumber, date, receiptStrict, date]
    );
    if (existing) {
      const row = existing;
      return res.status(200).json({
        id: row.id,
        customerId: row.customer_id,
        sellerId: row.seller_id ?? undefined,
        orderId: row.order_id ?? undefined,
        invoiceId: row.invoice_id ?? undefined,
        receiptNumber: row.receipt_number,
        date: row.date,
        amount: Number(row.amount) || 0,
        notes: row.notes ?? undefined,
        createdAt: row.created_at
      });
    }

    const id = uuidv4();
    try {
      await execute(
        `INSERT INTO payments (id, customer_id, seller_id, order_id, invoice_id, receipt_number, date, amount, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, customerId, sellerId, orderId, invoiceId, receiptNumber, date, amount, notes]
      );
    } catch (e: any) {
      const dup =
        e?.code === 'ER_DUP_ENTRY' || String(e?.message || '').includes('Duplicate entry');
      if (dup) {
        const rowDup = await get(
          `SELECT id, customer_id, seller_id, order_id, invoice_id, receipt_number, date, amount, notes, created_at
           FROM payments
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
          [customerId, amount, receiptNumber, date, receiptStrict, date]
        );
        if (rowDup) {
          return res.status(200).json({
            id: rowDup.id,
            customerId: rowDup.customer_id,
            sellerId: rowDup.seller_id ?? undefined,
            orderId: rowDup.order_id ?? undefined,
            invoiceId: rowDup.invoice_id ?? undefined,
            receiptNumber: rowDup.receipt_number,
            date: rowDup.date,
            amount: Number(rowDup.amount) || 0,
            notes: rowDup.notes ?? undefined,
            createdAt: rowDup.created_at
          });
        }
      }
      throw e;
    }

    const row = await get(
      `SELECT id, customer_id, seller_id, order_id, invoice_id, receipt_number, date, amount, notes, created_at
       FROM payments WHERE id = ?`,
      [id]
    );
    res.status(201).json({
      id: row.id,
      customerId: row.customer_id,
      sellerId: row.seller_id ?? undefined,
      orderId: row.order_id ?? undefined,
      invoiceId: row.invoice_id ?? undefined,
      receiptNumber: row.receipt_number,
      date: row.date,
      amount: Number(row.amount) || 0,
      notes: row.notes ?? undefined,
      createdAt: row.created_at
    });
  } catch (e: any) {
    console.error('createPayment:', e);
    res.status(500).json({ message: 'Error creando pago', detail: e?.message });
  }
};

function normalizeNameForMatch(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeReceiptNumber(v: unknown): string {
  return String(v ?? '').trim().replace(/\s+/g, '');
}

function normalizeReceiptNumberStrict(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function toSqlDate(value: any): string | null {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Importar pagos desde uno o más Excel (filas REC). */
export const importPaymentsFromExcel = async (req: any, res: Response) => {
  try {
    const user = req.user;
    if (!user || !canManagePayments(user.role)) {
      return res.status(403).json({ message: 'No autorizado' });
    }

    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) {
      return res.status(400).json({ message: 'Subí al menos un archivo Excel (.xlsx/.xls)' });
    }

    const customers = (await query(
      `SELECT id, business_name, name, seller_id FROM customers`
    )) as { id: string; business_name?: string | null; name?: string | null; seller_id?: string | null }[];

    const customerByNorm = new Map<string, { id: string; seller_id?: string | null }>();
    for (const c of customers) {
      const k1 = normalizeNameForMatch(c.business_name);
      const k2 = normalizeNameForMatch(c.name);
      if (k1 && !customerByNorm.has(k1)) customerByNorm.set(k1, { id: c.id, seller_id: c.seller_id ?? null });
      if (k2 && !customerByNorm.has(k2)) customerByNorm.set(k2, { id: c.id, seller_id: c.seller_id ?? null });
    }

    let candidates = 0;
    let imported = 0;
    let duplicated = 0;
    const notFoundNames = new Map<string, number>();

    for (const f of files) {
      const wb = XLSX.read(f.buffer, { type: 'buffer', cellDates: true });
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: null });
        for (const r of rows) {
          const tComp = String(r.T_COMP ?? '').trim().toUpperCase();
          if (tComp !== 'REC') continue;
          candidates++;

          const customerName = String(r.RAZON_SOC ?? '').trim();
          const customer = customerByNorm.get(normalizeNameForMatch(customerName));
          if (!customer) {
            notFoundNames.set(customerName, (notFoundNames.get(customerName) || 0) + 1);
            continue;
          }

          const receiptNumber = normalizeReceiptNumber(r.N_COMP);
          const date = toSqlDate(r.FECHA_EMIS ?? r.FECHA_APL ?? r.FECHA);
          const amountRaw = Number(r.HABER) || Number(r.IMPORTE) || 0;
          const amount = Math.round(Math.abs(amountRaw) * 100) / 100;

          if (!receiptNumber || !date || !Number.isFinite(amount) || amount <= 0) continue;

          const receiptStrict = normalizeReceiptNumberStrict(receiptNumber);
          const exists = await get(
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
            [customer.id, amount, receiptNumber, date, receiptStrict, date]
          );
          if (exists) {
            duplicated++;
            continue;
          }

          await execute(
            `INSERT INTO payments (id, customer_id, seller_id, order_id, invoice_id, receipt_number, date, amount, notes)
             VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
            [
              uuidv4(),
              customer.id,
              customer.seller_id ?? null,
              receiptNumber,
              date,
              amount,
              `Importado desde Excel (${f.originalname})`,
            ]
          );
          imported++;
        }
      }
    }

    return res.json({
      message: 'Importación de pagos finalizada',
      files: files.length,
      candidates,
      imported,
      duplicated,
      notFound: Array.from(notFoundNames.entries()).map(([customerName, count]) => ({ customerName, count })),
    });
  } catch (e: any) {
    console.error('importPaymentsFromExcel:', e);
    res.status(500).json({ message: 'Error importando pagos desde Excel', detail: e?.message });
  }
};

function normalizeCuit(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '').trim();
}

function parseRetPerNumber(raw: unknown): number {
  const s = String(raw ?? '').trim();
  if (!s) return NaN;
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

type RetPerRow = {
  cuit: string;
  rate: number;
  amount?: number;
  period?: string;
};

function parseRetPerFixedWidthLine(line: string): RetPerRow | null {
  const raw = String(line ?? '');
  if (!raw.trim()) return null;
  if (raw.length < 205) return null;

  const cuit = normalizeCuit(raw.slice(76, 87));
  const rateRaw = raw.slice(179, 185);
  const amountRaw = raw.slice(192, 202);
  const rate = parseRetPerNumber(rateRaw);
  const amount = parseRetPerNumber(amountRaw);
  if (!/^\d{11}$/.test(cuit) || !Number.isFinite(rate)) return null;

  return {
    cuit,
    rate: Math.max(0, Math.round(rate * 10000) / 10000),
    amount: Number.isFinite(amount) ? Math.round(amount * 100) / 100 : undefined,
  };
}

function detectCsvDelimiter(headerLine: string): ';' | ',' | '\t' {
  const line = String(headerLine ?? '');
  const counts = [
    { d: ';' as const, c: (line.match(/;/g) || []).length },
    { d: ',' as const, c: (line.match(/,/g) || []).length },
    { d: '\t' as const, c: (line.match(/\t/g) || []).length },
  ];
  counts.sort((a, b) => b.c - a.c);
  return counts[0]?.c > 0 ? counts[0].d : ';';
}

function findColumnIndex(headers: string[], aliases: string[]): number {
  const normalized = headers.map((h) => normalizeNameForMatch(h));
  for (const alias of aliases) {
    const idx = normalized.findIndex((h) => h === normalizeNameForMatch(alias));
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseRetPerCsv(content: string): RetPerRow[] {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const delimiter = detectCsvDelimiter(lines[0]);
  const headers = lines[0].split(delimiter).map((s) => s.trim());
  const cuitIdx = findColumnIndex(headers, ['cuit', 'cuil', 'documento', 'nro_doc']);
  const rateIdx = findColumnIndex(headers, ['alicuota', 'aliquota', 'percepcion', 'perc_iibb', 'iibb']);
  if (cuitIdx < 0 || rateIdx < 0) return [];

  const amountIdx = findColumnIndex(headers, ['importe', 'importe_percepcion', 'monto', 'percepcion_importe']);
  const rows: RetPerRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(delimiter).map((s) => s.trim().replace(/^"|"$/g, ''));
    const cuit = normalizeCuit(cols[cuitIdx] ?? '');
    const rate = parseRetPerNumber(cols[rateIdx] ?? '');
    const amount = amountIdx >= 0 ? parseRetPerNumber(cols[amountIdx] ?? '') : NaN;
    if (!/^\d{11}$/.test(cuit) || !Number.isFinite(rate)) continue;
    rows.push({
      cuit,
      rate: Math.max(0, Math.round(rate * 10000) / 10000),
      amount: Number.isFinite(amount) ? Math.round(amount * 100) / 100 : undefined,
    });
  }
  return rows;
}

function parseArdjuNoHeader(content: string): RetPerRow[] {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean);
  const out: RetPerRow[] = [];
  for (const line of lines) {
    const cols = line.split(';');
    if (cols.length < 9) continue;
    const cuit = normalizeCuit(cols[3] ?? '');
    // Formato ARDJU: col[8] suele ser alícuota de percepción; col[7] retención/fallback.
    const percepRate = parseRetPerNumber(cols[8] ?? '');
    const fallbackRate = parseRetPerNumber(cols[7] ?? '');
    const rate = Number.isFinite(percepRate) ? percepRate : fallbackRate;
    if (!/^\d{11}$/.test(cuit) || !Number.isFinite(rate)) continue;

    const desde = String(cols[1] ?? '').replace(/\D/g, '');
    const period = /^\d{8}$/.test(desde) ? `${desde.slice(4, 8)}${desde.slice(2, 4)}` : undefined;
    out.push({
      cuit,
      rate: Math.max(0, Math.round(rate * 10000) / 10000),
      period,
    });
  }
  return out;
}

function parseRetPerFile(file: Express.Multer.File): RetPerRow[] {
  const original = String(file.originalname || '').toLowerCase();
  const content = file.buffer.toString('utf8');
  if (original.includes('ardju')) {
    const ardjuRows = parseArdjuNoHeader(content);
    if (ardjuRows.length > 0) return ardjuRows;
  }

  if (original.endsWith('.csv')) return parseRetPerCsv(content);

  const fixedRows = content
    .split(/\r?\n/)
    .map((line) => parseRetPerFixedWidthLine(line))
    .filter((r): r is RetPerRow => !!r);
  if (fixedRows.length > 0) return fixedRows;

  return parseRetPerCsv(content);
}

function periodFromFileName(fileName: string): string | null {
  const base = String(fileName || '');
  // RetPer_202603.txt => 202603
  const yyyymm = base.match(/(20\d{2})(0[1-9]|1[0-2])/);
  if (yyyymm) return `${yyyymm[1]}${yyyymm[2]}`;
  // ARDJU008042026.TXT => 202604
  const mmYYYY = base.match(/(0[1-9]|1[0-2])(20\d{2})/);
  if (mmYYYY) return `${mmYYYY[2]}${mmYYYY[1]}`;
  return null;
}

/** Importa padrón RetPer (TXT/CSV) y actualiza alícuota IIBB por CUIT en clientes. */
export const importIibbRetPer = async (req: any, res: Response) => {
  try {
    const user = req.user;
    if (!user || !canManagePayments(user.role)) {
      return res.status(403).json({ message: 'No autorizado' });
    }

    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) {
      return res.status(400).json({ message: 'Subí al menos un archivo RetPer (.txt o .csv)' });
    }

    const customers = (await query(
      `SELECT id, cuit FROM customers WHERE cuit IS NOT NULL AND cuit <> ''`
    )) as Array<{ id: string; cuit: string }>;

    const customerByCuit = new Map<string, { id: string }>();
    for (const c of customers) {
      const cuit = normalizeCuit(c.cuit);
      if (/^\d{11}$/.test(cuit) && !customerByCuit.has(cuit)) customerByCuit.set(cuit, { id: c.id });
    }

    let rowsRead = 0;
    let rowsValid = 0;
    let updatedCustomers = 0;
    let rowsWithoutCustomer = 0;
    let importedAmountTotal = 0;
    const unmatchedCuits = new Map<string, number>();

    for (const file of files) {
      const rows = parseRetPerFile(file);
      rowsRead += rows.length;
      if (!rows.length) continue;
      const periodFromName = periodFromFileName(file.originalname);

      const bestByCuit = new Map<string, RetPerRow>();
      for (const row of rows) {
        if (!/^\d{11}$/.test(row.cuit) || !Number.isFinite(row.rate)) continue;
        rowsValid++;
        importedAmountTotal += Number.isFinite(row.amount) ? Number(row.amount) : 0;
        const prev = bestByCuit.get(row.cuit);
        if (!prev || row.rate > prev.rate) bestByCuit.set(row.cuit, row);
      }

      for (const [cuit, row] of bestByCuit.entries()) {
        const customer = customerByCuit.get(cuit);
        if (!customer) {
          rowsWithoutCustomer++;
          unmatchedCuits.set(cuit, (unmatchedCuits.get(cuit) || 0) + 1);
          continue;
        }

        await execute(
          `UPDATE customers
           SET iibb_perception_rate = ?,
               iibb_padron_period = ?,
               iibb_padron_source = ?,
               iibb_padron_updated_at = NOW()
           WHERE id = ?`,
          [row.rate, row.period ?? periodFromName, file.originalname, customer.id]
        );
        updatedCustomers++;
      }
    }

    return res.json({
      message: 'Importación RetPer finalizada',
      files: files.length,
      rowsRead,
      rowsValid,
      updatedCustomers,
      rowsWithoutCustomer,
      importedAmountTotal: Math.round(importedAmountTotal * 100) / 100,
      unmatchedCuits: Array.from(unmatchedCuits.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([cuit, count]) => ({ cuit, count })),
    });
  } catch (e: any) {
    console.error('importIibbRetPer:', e);
    res.status(500).json({ message: 'Error importando RetPer', detail: e?.message });
  }
};

