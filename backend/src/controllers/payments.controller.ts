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

    // Para SELLER: solo pagos de clientes asignados a ese vendedor
    if (user.role === 'SELLER') {
      where.push('c.seller_id = ?');
      params.push(user.id);
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
    const systemPayments = (rows || []).map((r: any) => ({
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
    }));

    // Integrar recibos importados desde Tango/Multimedias como parte del mismo "sistema".
    // Se omiten si ya existe pago equivalente en tabla payments (fecha + nro + importe).
    const includeImportedReceipts = !invoiceId && !orderId;
    if (!includeImportedReceipts) {
      return res.json(systemPayments);
    }

    const mmWhere: string[] = [`UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('REC', 'RECIBO')`];
    const mmParams: any[] = [];
    if (customerId) { mmWhere.push('e.customer_id = ?'); mmParams.push(customerId); }
    if (desde) { mmWhere.push('e.line_date >= ?'); mmParams.push(desde); }
    if (hasta) { mmWhere.push('e.line_date <= ?'); mmParams.push(hasta); }
    if (user.role === 'SELLER') {
      mmWhere.push('c.seller_id = ?');
      mmParams.push(user.id);
    }

    const importedRows = await query(
      `
      SELECT
        e.customer_id,
        e.line_order,
        e.line_date,
        e.numero,
        e.importe,
        e.detalle,
        c.business_name AS customer_business_name,
        c.name AS customer_name,
        c.seller_id,
        u.name AS seller_name
      FROM customer_multimedia_entries e
      JOIN customers c ON c.id = e.customer_id
      LEFT JOIN users u ON u.id = c.seller_id
      WHERE ${mmWhere.join(' AND ')}
      ORDER BY e.line_date DESC, e.line_order DESC
      `,
      mmParams
    ) as any[];

    const normalizeDate = (v: any) => {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return String(v || '').slice(0, 10);
      return d.toISOString().slice(0, 10);
    };
    const normalizeNumber = (v: any) => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const normalizeAmount = (v: any) => Number(v || 0).toFixed(2);

    const existingKeys = new Set(
      systemPayments.map((p) => [
        normalizeDate(p.date),
        normalizeNumber(p.receiptNumber),
        normalizeAmount(p.amount),
        p.customerId
      ].join('|'))
    );

    const importedAsPayments = importedRows
      .filter((r) => {
        const key = [
          normalizeDate(r.line_date),
          normalizeNumber(r.numero),
          normalizeAmount(r.importe),
          r.customer_id
        ].join('|');
        if (existingKeys.has(key)) return false;
        existingKeys.add(key);
        return true;
      })
      .map((r) => ({
        id: `mm-${r.customer_id}-${r.line_order}`,
        customerId: r.customer_id,
        sellerId: r.seller_id ?? undefined,
        sellerName: r.seller_name ?? undefined,
        orderId: undefined,
        invoiceId: undefined,
        receiptNumber: String(r.numero || ''),
        date: normalizeDate(r.line_date),
        amount: Number(r.importe) || 0,
        notes: r.detalle ? `Importado Tango: ${r.detalle}` : 'Importado Tango',
        createdAt: undefined,
        customerBusinessName: r.customer_business_name ?? r.customer_name ?? '',
        invoice: undefined
      }));

    const allPayments = [...systemPayments, ...importedAsPayments].sort((a, b) => {
      const da = new Date(a.date).getTime() || 0;
      const db = new Date(b.date).getTime() || 0;
      return db - da;
    });

    res.json(allPayments);
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

    const cust = await get('SELECT id, seller_id FROM customers WHERE id = ?', [customerId]);
    if (!cust) return res.status(404).json({ message: 'Cliente no encontrado' });
    if (user.role === 'SELLER' && cust.seller_id !== user.id) {
      return res.status(403).json({ message: 'Solo podés cargar pagos para tus clientes' });
    }

    const sellerId = user.role === 'SELLER'
      ? user.id
      : (body.sellerId ? String(body.sellerId).trim() : null);
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

