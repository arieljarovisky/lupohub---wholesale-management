import { Request, Response } from 'express';
import { query, execute, get } from '../database/db';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';

const canManagePayments = (role?: string) =>
  role === 'ADMIN' || role === 'SELLER' || role === 'WAREHOUSE' || role === 'DEPOSITO';

let paymentInvoicesTableReady: boolean | null = null;
async function ensurePaymentInvoicesTable(): Promise<boolean> {
  if (paymentInvoicesTableReady === true) return true;
  try {
    await execute(`
      CREATE TABLE IF NOT EXISTS payment_invoices (
        payment_id VARCHAR(36) NOT NULL,
        invoice_id VARCHAR(36) NOT NULL,
        amount_applied DECIMAL(12,2) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (payment_id, invoice_id),
        INDEX idx_payment_invoices_invoice (invoice_id),
        CONSTRAINT fk_payment_invoices_payment
          FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
        CONSTRAINT fk_payment_invoices_invoice
          FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
      )
    `);
    await execute(`
      INSERT IGNORE INTO payment_invoices (payment_id, invoice_id)
      SELECT p.id, p.invoice_id
      FROM payments p
      WHERE p.invoice_id IS NOT NULL AND TRIM(p.invoice_id) <> ''
    `);
    paymentInvoicesTableReady = true;
    return true;
  } catch (e: any) {
    console.error('[payments] ensurePaymentInvoicesTable:', e?.message || e);
    paymentInvoicesTableReady = false;
    return false;
  }
}

/** Listar pagos con filtros opcionales (cliente, factura, pedido, desde/hasta). */
export const listPayments = async (req: any, res: Response) => {
  try {
    const user = req.user;
    if (!user || !canManagePayments(user.role)) {
      return res.status(403).json({ message: 'No autorizado' });
    }

    const paymentInvoicesEnabled = await ensurePaymentInvoicesTable();
    const { customerId, invoiceId, orderId, desde, hasta } = req.query as any;
    const where: string[] = [];
    const params: any[] = [];
    if (customerId) { where.push('p.customer_id = ?'); params.push(customerId); }
    if (invoiceId && paymentInvoicesEnabled) {
      where.push(`(
        p.invoice_id = ?
        OR EXISTS (
          SELECT 1
          FROM payment_invoices pi2
          WHERE pi2.payment_id = p.id AND pi2.invoice_id = ?
        )
      )`);
      params.push(invoiceId, invoiceId);
    } else if (invoiceId) {
      where.push('p.invoice_id = ?');
      params.push(invoiceId);
    }
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
      paymentInvoicesEnabled
        ? `
      SELECT
        p.id, p.customer_id, p.seller_id, p.order_id, p.invoice_id,
        p.receipt_number, p.date, p.amount, p.notes, p.created_at,
        c.business_name AS customer_business_name, c.name AS customer_name,
        u.name AS seller_name,
        i.punto_venta AS invoice_punto_venta, i.cbte_tipo AS invoice_cbte_tipo, i.cbte_desde AS invoice_cbte_desde,
        GROUP_CONCAT(DISTINCT pi.invoice_id) AS invoice_ids
      FROM payments p
      JOIN customers c ON c.id = p.customer_id
      LEFT JOIN users u ON u.id = p.seller_id
      LEFT JOIN invoices i ON i.id = p.invoice_id
      LEFT JOIN payment_invoices pi ON pi.payment_id = p.id
      ${whereSql}
      GROUP BY p.id, p.customer_id, p.seller_id, p.order_id, p.invoice_id,
               p.receipt_number, p.date, p.amount, p.notes, p.created_at,
               c.business_name, c.name, u.name,
               i.punto_venta, i.cbte_tipo, i.cbte_desde
      ORDER BY p.date DESC, p.created_at DESC
      `
        : `
      SELECT
        p.id, p.customer_id, p.seller_id, p.order_id, p.invoice_id,
        p.receipt_number, p.date, p.amount, p.notes, p.created_at,
        c.business_name AS customer_business_name, c.name AS customer_name,
        u.name AS seller_name,
        i.punto_venta AS invoice_punto_venta, i.cbte_tipo AS invoice_cbte_tipo, i.cbte_desde AS invoice_cbte_desde,
        NULL AS invoice_ids
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
      invoiceIds: String(r.invoice_ids || r.invoice_id || '')
        .split(',')
        .map((x: string) => x.trim())
        .filter(Boolean),
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

    const mmWhere: string[] = [`UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'REC%'`];
    const mmParams: any[] = [];
    if (customerId) { mmWhere.push('e.customer_id = ?'); mmParams.push(customerId); }
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

    const parseMoney = (v: any): number => {
      if (v == null) return 0;
      if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
      const s = String(v).trim().replace(/\s/g, '').replace(/\$/g, '');
      if (!s) return 0;
      const hasComma = s.includes(',');
      const hasDot = s.includes('.');
      if (hasComma && hasDot) {
        const n = Number(s.replace(/\./g, '').replace(',', '.'));
        return Number.isFinite(n) ? n : 0;
      }
      if (hasComma) {
        const n = Number(s.replace(',', '.'));
        return Number.isFinite(n) ? n : 0;
      }
      const n = Number(s);
      return Number.isFinite(n) ? n : 0;
    };
    const normalizeDate = (v: any) => {
      if (typeof v === 'string') {
        const raw = v.trim();
        const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m) {
          const dd = m[1].padStart(2, '0');
          const mm = m[2].padStart(2, '0');
          const yyyy = m[3];
          return `${yyyy}-${mm}-${dd}`;
        }
      }
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return String(v || '').slice(0, 10);
      return d.toISOString().slice(0, 10);
    };
    const normalizeNumber = (v: any) => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const normalizeAmount = (v: any) => parseMoney(v).toFixed(2);

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
        const d = normalizeDate(r.line_date);
        if (desde && d < String(desde)) return false;
        if (hasta && d > String(hasta)) return false;
        const key = [
          d,
          normalizeNumber(r.numero),
          normalizeAmount(r.importe),
          r.customer_id
        ].join('|');
        if (existingKeys.has(key)) return false;
        existingKeys.add(key);
        return true;
      })
      .map((r) => ({
        id: `mm-${r.customer_id}-${String(r.line_order ?? 'x')}-${normalizeDate(r.line_date)}-${normalizeNumber(r.numero)}`,
        customerId: r.customer_id,
        source: 'imported',
        importedLineOrder: Number(r.line_order) || 0,
        sellerId: r.seller_id ?? undefined,
        sellerName: r.seller_name ?? undefined,
        orderId: undefined,
        invoiceId: undefined,
        receiptNumber: String(r.numero || ''),
        date: normalizeDate(r.line_date),
        amount: parseMoney(r.importe),
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

/** Editar fecha de un recibo histórico importado (customer_multimedia_entries tipo REC*). */
export const updateImportedPaymentDate = async (req: any, res: Response) => {
  try {
    const user = req.user;
    if (!user || !canManagePayments(user.role)) {
      return res.status(403).json({ message: 'No autorizado' });
    }

    const customerId = String(req.body?.customerId || '').trim();
    const importedLineOrder = Number(req.body?.importedLineOrder);
    const nextDate = String(req.body?.date || '').trim();

    if (!customerId) return res.status(400).json({ message: 'Falta customerId' });
    if (!Number.isFinite(importedLineOrder) || importedLineOrder <= 0) {
      return res.status(400).json({ message: 'Falta importedLineOrder válido' });
    }
    if (!nextDate || !/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
      return res.status(400).json({ message: 'Fecha inválida. Formato esperado: YYYY-MM-DD' });
    }

    const cust = await get('SELECT id, seller_id FROM customers WHERE id = ? LIMIT 1', [customerId]);
    if (!cust) return res.status(404).json({ message: 'Cliente no encontrado' });
    if (user.role === 'SELLER' && cust.seller_id !== user.id) {
      return res.status(403).json({ message: 'Solo podés editar recibos de tus clientes' });
    }

    const entry = await get(
      `SELECT customer_id, line_order, tipo
       FROM customer_multimedia_entries
       WHERE customer_id = ? AND line_order = ?
       LIMIT 1`,
      [customerId, importedLineOrder]
    );
    if (!entry) return res.status(404).json({ message: 'Recibo importado no encontrado' });
    if (!String(entry.tipo || '').trim().toUpperCase().startsWith('REC')) {
      return res.status(400).json({ message: 'La línea indicada no es un recibo importado' });
    }

    await execute(
      `UPDATE customer_multimedia_entries
       SET line_date = ?
       WHERE customer_id = ? AND line_order = ?`,
      [nextDate, customerId, importedLineOrder]
    );

    return res.json({ ok: true, customerId, importedLineOrder, date: nextDate });
  } catch (e: any) {
    console.error('updateImportedPaymentDate:', e);
    return res.status(500).json({ message: 'Error actualizando fecha del recibo importado', detail: e?.message });
  }
};

/** Crear pago/recibo. */
export const createPayment = async (req: any, res: Response) => {
  try {
    const user = req.user;
    if (!user || !canManagePayments(user.role)) {
      return res.status(403).json({ message: 'No autorizado' });
    }

    const paymentInvoicesEnabled = await ensurePaymentInvoicesTable();
    const body = req.body as {
      customerId?: string;
      sellerId?: string | null;
      orderId?: string | null;
      invoiceId?: string | null;
      invoiceIds?: string[];
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
    const invoiceIds = Array.isArray(body.invoiceIds)
      ? Array.from(new Set(body.invoiceIds.map((x) => String(x || '').trim()).filter(Boolean)))
      : [];
    const notes = body.notes != null && String(body.notes).trim() ? String(body.notes).trim() : null;

    if (invoiceId && !invoiceIds.includes(invoiceId)) invoiceIds.unshift(invoiceId);
    const hasImportedInvoiceId = invoiceIds.some((id) => id.startsWith('mm-fac-'));
    if (hasImportedInvoiceId) {
      return res.status(400).json({
        message: 'Las facturas importadas (Tango) no se pueden relacionar al recibo. Seleccioná facturas emitidas en LupoHub.'
      });
    }
    const primaryInvoiceId = invoiceIds[0] || null;

    if (invoiceIds.length > 0) {
      const rows = await query(
        `SELECT i.id, o.customer_id
         FROM invoices i
         JOIN orders o ON o.id = i.order_id
         WHERE i.id IN (${invoiceIds.map(() => '?').join(',')})`,
        invoiceIds
      ) as Array<{ id: string; customer_id: string }>;
      if (rows.length !== invoiceIds.length) {
        return res.status(400).json({ message: 'Hay facturas inválidas en la selección del recibo' });
      }
      const invalidByCustomer = rows.find((r) => r.customer_id !== customerId);
      if (invalidByCustomer) {
        return res.status(400).json({ message: 'Solo podés relacionar facturas del mismo cliente del recibo' });
      }
    }

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
        invoiceIds: row.invoice_id ? [row.invoice_id] : [],
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
        [id, customerId, sellerId, orderId, primaryInvoiceId, receiptNumber, date, amount, notes]
      );
      if (invoiceIds.length > 0 && paymentInvoicesEnabled) {
        for (const invId of invoiceIds) {
          await execute(
            `INSERT IGNORE INTO payment_invoices (payment_id, invoice_id) VALUES (?, ?)`,
            [id, invId]
          );
        }
      }
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
            invoiceIds: rowDup.invoice_id ? [rowDup.invoice_id] : [],
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
      paymentInvoicesEnabled
        ? `SELECT
         p.id, p.customer_id, p.seller_id, p.order_id, p.invoice_id, p.receipt_number, p.date, p.amount, p.notes, p.created_at,
         GROUP_CONCAT(DISTINCT pi.invoice_id) AS invoice_ids
       FROM payments p
       LEFT JOIN payment_invoices pi ON pi.payment_id = p.id
       WHERE p.id = ?
       GROUP BY p.id, p.customer_id, p.seller_id, p.order_id, p.invoice_id, p.receipt_number, p.date, p.amount, p.notes, p.created_at`
        : `SELECT
         p.id, p.customer_id, p.seller_id, p.order_id, p.invoice_id, p.receipt_number, p.date, p.amount, p.notes, p.created_at,
         NULL AS invoice_ids
       FROM payments p
       WHERE p.id = ?`,
      [id]
    );
    res.status(201).json({
      id: row.id,
      customerId: row.customer_id,
      sellerId: row.seller_id ?? undefined,
      orderId: row.order_id ?? undefined,
      invoiceId: row.invoice_id ?? undefined,
      invoiceIds: String(row.invoice_ids || row.invoice_id || '')
        .split(',')
        .map((x: string) => x.trim())
        .filter(Boolean),
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

/** Editar fecha de un recibo/pago cargado en el sistema. */
export const updatePaymentDate = async (req: any, res: Response) => {
  try {
    const user = req.user;
    if (!user || !canManagePayments(user.role)) {
      return res.status(403).json({ message: 'No autorizado' });
    }

    const paymentId = String(req.params?.id || '').trim();
    const nextDate = String(req.body?.date || '').trim();
    if (!paymentId) return res.status(400).json({ message: 'Falta ID de pago' });
    if (!nextDate) return res.status(400).json({ message: 'Falta fecha' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
      return res.status(400).json({ message: 'Fecha inválida. Formato esperado: YYYY-MM-DD' });
    }

    const row = await get(
      `SELECT p.id, p.customer_id, p.seller_id
       FROM payments p
       WHERE p.id = ?`,
      [paymentId]
    );
    if (!row) return res.status(404).json({ message: 'Recibo no encontrado' });

    if (user.role === 'SELLER') {
      const cust = await get('SELECT seller_id FROM customers WHERE id = ? LIMIT 1', [row.customer_id]);
      if (!cust || cust.seller_id !== user.id) {
        return res.status(403).json({ message: 'Solo podés editar recibos de tus clientes' });
      }
    }

    try {
      await execute(`UPDATE payments SET date = ? WHERE id = ?`, [nextDate, paymentId]);
    } catch (e: any) {
      const dup = e?.code === 'ER_DUP_ENTRY' || String(e?.message || '').includes('Duplicate entry');
      if (dup) {
        return res.status(409).json({
          message: 'Ya existe un recibo con mismo cliente, número, fecha e importe'
        });
      }
      throw e;
    }

    const updated = await get(
      `SELECT id, customer_id, seller_id, order_id, invoice_id, receipt_number, date, amount, notes, created_at
       FROM payments
       WHERE id = ?`,
      [paymentId]
    );

    return res.json({
      id: updated.id,
      customerId: updated.customer_id,
      sellerId: updated.seller_id ?? undefined,
      orderId: updated.order_id ?? undefined,
      invoiceId: updated.invoice_id ?? undefined,
      invoiceIds: updated.invoice_id ? [updated.invoice_id] : [],
      receiptNumber: updated.receipt_number,
      date: updated.date,
      amount: Number(updated.amount) || 0,
      notes: updated.notes ?? undefined,
      createdAt: updated.created_at
    });
  } catch (e: any) {
    console.error('updatePaymentDate:', e);
    return res.status(500).json({ message: 'Error actualizando fecha del recibo', detail: e?.message });
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

