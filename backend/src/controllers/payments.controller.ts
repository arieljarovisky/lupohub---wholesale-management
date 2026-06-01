import { Request, Response } from 'express';
import { query, execute, get } from '../database/db';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';
import {
  allocatePayment,
  getInvoicesOutstanding,
  getOrdersOutstanding,
  previewPaymentAllocation,
  relinkPaymentToInvoices,
  syncAllOrderPaymentStatusForCustomer,
  syncOrderPaymentStatus,
  validateOrdersForPayment,
  type PaymentAllocationResult
} from '../services/orderPaymentBalance.service';

function formatAllocationNote(
  alloc: PaymentAllocationResult,
  paymentAmount: number
): string | undefined {
  const allTargets = [
    ...alloc.invoiceAllocations.map((a) => ({ kind: 'factura' as const, ...a })),
    ...alloc.orderAllocations.map((a) => ({ kind: 'pedido' as const, ...a }))
  ];
  const parts: string[] = [];
  if (alloc.invoiceAllocations.length > 1) {
    parts.push(
      `Repartido en ${alloc.invoiceAllocations.length} facturas ($${alloc.appliedTotal.toLocaleString('es-AR')}).`
    );
  } else if (alloc.orderAllocations.length > 1 && alloc.invoiceAllocations.length === 0) {
    parts.push(
      `Repartido en ${alloc.orderAllocations.length} pedidos ($${alloc.appliedTotal.toLocaleString('es-AR')}).`
    );
  } else if (alloc.invoiceAllocations.length === 1 && alloc.orderAllocations.length === 0) {
    if (alloc.invoiceAllocations[0].outstandingAfter <= 0.01) {
      parts.push('Factura cobrada en su totalidad.');
    }
  } else if (alloc.orderAllocations.length === 1 && alloc.invoiceAllocations.length === 0) {
    if (alloc.orderAllocations[0].outstandingAfter <= 0.01) {
      parts.push('Pedido cobrado en su totalidad.');
    }
  }
  const withBalance = allTargets.filter((a) => a.outstandingAfter > 0.01);
  if (withBalance.length === 1 && parts.length === 0) {
    parts.push(
      `Queda pendiente $${withBalance[0].outstandingAfter.toLocaleString('es-AR')} en un ${withBalance[0].kind}.`
    );
  } else if (withBalance.length > 1) {
    const sum = withBalance.reduce((s, a) => s + a.outstandingAfter, 0);
    parts.push(`Queda pendiente $${sum.toLocaleString('es-AR')} en ${withBalance.length} comprobantes.`);
  }
  if (alloc.remainingUnallocated > 0.01) {
    parts.push(
      `Del recibo sobran $${alloc.remainingUnallocated.toLocaleString('es-AR')} sin imputar a lo elegido.`
    );
  }
  if (parts.length === 0 && alloc.appliedTotal + 0.01 < paymentAmount) {
    return `Imputados $${alloc.appliedTotal.toLocaleString('es-AR')}.`;
  }
  return parts.length ? parts.join(' ') : undefined;
}

const canManagePayments = (role?: string) =>
  role === 'ADMIN' || role === 'SELLER' || role === 'WAREHOUSE' || role === 'DEPOSITO';

let paymentInvoicesTableReady: boolean | null = null;
let paymentOrdersTableReady: boolean | null = null;
let paymentInvoiceRefsTableReady: boolean | null = null;
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

async function ensurePaymentOrdersTable(): Promise<boolean> {
  if (paymentOrdersTableReady === true) return true;
  try {
    await execute(`
      CREATE TABLE IF NOT EXISTS payment_orders (
        payment_id VARCHAR(36) NOT NULL,
        order_id VARCHAR(36) NOT NULL,
        amount_applied DECIMAL(12,2) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (payment_id, order_id),
        INDEX idx_payment_orders_order (order_id),
        CONSTRAINT fk_payment_orders_payment
          FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
        CONSTRAINT fk_payment_orders_order
          FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
      )
    `);
    await execute(`
      INSERT IGNORE INTO payment_orders (payment_id, order_id, amount_applied)
      SELECT p.id, p.order_id, ROUND(COALESCE(p.amount, 0), 2)
      FROM payments p
      WHERE p.order_id IS NOT NULL AND TRIM(p.order_id) <> ''
        AND (p.invoice_id IS NULL OR TRIM(p.invoice_id) = '')
        AND NOT EXISTS (SELECT 1 FROM payment_invoices pi WHERE pi.payment_id = p.id)
    `);
    paymentOrdersTableReady = true;
    return true;
  } catch (e: any) {
    console.error('[payments] ensurePaymentOrdersTable:', e?.message || e);
    paymentOrdersTableReady = false;
    return false;
  }
}

async function ensurePaymentInvoiceRefsTable(): Promise<boolean> {
  if (paymentInvoiceRefsTableReady === true) return true;
  try {
    await execute(`
      CREATE TABLE IF NOT EXISTS payment_invoice_refs (
        payment_id VARCHAR(36) NOT NULL,
        invoice_ref VARCHAR(255) NOT NULL,
        source VARCHAR(40) NOT NULL DEFAULT 'IMPORTED',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (payment_id, invoice_ref),
        INDEX idx_payment_invoice_refs_ref (invoice_ref),
        CONSTRAINT fk_payment_invoice_refs_payment
          FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE
      )
    `);
    paymentInvoiceRefsTableReady = true;
    return true;
  } catch (e: any) {
    console.error('[payments] ensurePaymentInvoiceRefsTable:', e?.message || e);
    paymentInvoiceRefsTableReady = false;
    return false;
  }
}

function parsePaymentMoney(v: unknown): number {
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
}

function normalizePaymentDate(v: unknown): string {
  if (typeof v === 'string') {
    const raw = v.trim();
    const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
  }
  const d = new Date(v as string | number | Date);
  if (Number.isNaN(d.getTime())) return String(v || '').slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/** Crea o reutiliza un pago en `payments` para un REC importado de Tango/Multimedias. */
async function ensurePaymentFromMultimediaEntry(
  customerId: string,
  lineOrder: number
): Promise<string> {
  const entry = (await get(
    `SELECT e.numero, e.line_date, e.importe, e.detalle, c.seller_id
     FROM customer_multimedia_entries e
     JOIN customers c ON c.id = e.customer_id
     WHERE e.customer_id = ? AND e.line_order = ?
       AND UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'REC%'
     LIMIT 1`,
    [customerId, lineOrder]
  )) as
    | {
        numero?: string;
        line_date?: string;
        importe?: unknown;
        detalle?: string;
        seller_id?: string | null;
      }
    | undefined;
  if (!entry) {
    const err: any = new Error('Recibo importado de Tango no encontrado');
    err.statusCode = 404;
    throw err;
  }

  const receiptNumber = String(entry.numero || '').trim();
  const date = normalizePaymentDate(entry.line_date);
  const amount = parsePaymentMoney(entry.importe);
  const receiptStrict = normalizeReceiptNumberStrict(receiptNumber);
  const notes = entry.detalle ? `Importado Tango: ${entry.detalle}` : 'Importado Tango';

  const existing = (await get(
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
    [customerId, amount, receiptNumber, date, receiptStrict, date]
  )) as { id: string } | undefined;
  if (existing?.id) return existing.id;

  const id = uuidv4();
  await execute(
    `INSERT INTO payments (id, customer_id, seller_id, order_id, invoice_id, receipt_number, date, amount, notes)
     VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    [id, customerId, entry.seller_id ?? null, receiptNumber, date, amount, notes]
  );
  return id;
}

/** Listar pagos con filtros opcionales (cliente, factura, pedido, desde/hasta). */
export const listPayments = async (req: any, res: Response) => {
  try {
    const user = req.user;
    if (!user || !canManagePayments(user.role)) {
      return res.status(403).json({ message: 'No autorizado' });
    }

    const paymentInvoicesEnabled = await ensurePaymentInvoicesTable();
    const paymentOrdersEnabled = await ensurePaymentOrdersTable();
    const paymentInvoiceRefsEnabled = await ensurePaymentInvoiceRefsTable();
    const { customerId, invoiceId, orderId, desde, hasta, province } = req.query as any;
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
    if (orderId) {
      where.push(`(
        p.order_id = ?
        ${paymentOrdersEnabled ? `OR EXISTS (
          SELECT 1 FROM payment_orders po2 WHERE po2.payment_id = p.id AND po2.order_id = ?
        )` : ''}
      )`);
      params.push(orderId);
      if (paymentOrdersEnabled) params.push(orderId);
    }
    if (desde) { where.push('p.date >= ?'); params.push(desde); }
    if (hasta) { where.push('p.date <= ?'); params.push(hasta); }
    if (province && String(province).trim()) {
      where.push('LOWER(COALESCE(c.city, \'\')) LIKE ?');
      params.push(`%${String(province).trim().toLowerCase()}%`);
    }

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
        GROUP_CONCAT(DISTINCT pi.invoice_id) AS invoice_ids,
        ${paymentOrdersEnabled ? `GROUP_CONCAT(DISTINCT po.order_id) AS order_ids` : `NULL AS order_ids`},
        ${paymentInvoiceRefsEnabled ? `GROUP_CONCAT(DISTINCT pir.invoice_ref) AS invoice_refs` : `NULL AS invoice_refs`}
      FROM payments p
      JOIN customers c ON c.id = p.customer_id
      LEFT JOIN users u ON u.id = p.seller_id
      LEFT JOIN invoices i ON i.id = p.invoice_id
      LEFT JOIN payment_invoices pi ON pi.payment_id = p.id
      ${paymentOrdersEnabled ? `LEFT JOIN payment_orders po ON po.payment_id = p.id` : ``}
      ${paymentInvoiceRefsEnabled ? `LEFT JOIN payment_invoice_refs pir ON pir.payment_id = p.id` : ``}
      ${whereSql}
      GROUP BY p.id, p.customer_id, p.seller_id, p.order_id, p.invoice_id,
               p.receipt_number, p.date, p.amount, p.notes, p.created_at,
               c.business_name, c.name, u.name,
               i.punto_venta, i.cbte_tipo, i.cbte_desde
      ORDER BY p.created_at DESC, p.date DESC
      `
        : `
      SELECT
        p.id, p.customer_id, p.seller_id, p.order_id, p.invoice_id,
        p.receipt_number, p.date, p.amount, p.notes, p.created_at,
        c.business_name AS customer_business_name, c.name AS customer_name,
        u.name AS seller_name,
        i.punto_venta AS invoice_punto_venta, i.cbte_tipo AS invoice_cbte_tipo, i.cbte_desde AS invoice_cbte_desde,
        NULL AS invoice_ids,
        ${paymentInvoiceRefsEnabled ? `(SELECT GROUP_CONCAT(DISTINCT pir.invoice_ref) FROM payment_invoice_refs pir WHERE pir.payment_id = p.id) AS invoice_refs` : `NULL AS invoice_refs`}
      FROM payments p
      JOIN customers c ON c.id = p.customer_id
      LEFT JOIN users u ON u.id = p.seller_id
      LEFT JOIN invoices i ON i.id = p.invoice_id
      ${whereSql}
      ORDER BY p.created_at DESC, p.date DESC
      `,
      params
    );
    const systemPayments = (rows || []).map((r: any) => ({
      id: r.id,
      customerId: r.customer_id,
      sellerId: r.seller_id ?? undefined,
      sellerName: r.seller_name ?? undefined,
      orderId: r.order_id ?? undefined,
      orderIds: String(r.order_ids || r.order_id || '')
        .split(',')
        .map((x: string) => x.trim())
        .filter(Boolean),
      invoiceId: r.invoice_id ?? undefined,
      invoiceIds: Array.from(new Set([
        ...String(r.invoice_ids || r.invoice_id || '')
          .split(',')
          .map((x: string) => x.trim())
          .filter(Boolean),
        ...String(r.invoice_refs || '')
          .split(',')
          .map((x: string) => x.trim())
          .filter(Boolean),
      ])),
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
      const ca = a.createdAt ? (new Date(a.createdAt).getTime() || 0) : 0;
      const cb = b.createdAt ? (new Date(b.createdAt).getTime() || 0) : 0;
      if (cb !== ca) return cb - ca;
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
    const paymentOrdersEnabled = await ensurePaymentOrdersTable();
    const paymentInvoiceRefsEnabled = await ensurePaymentInvoiceRefsTable();
    const body = req.body as {
      customerId?: string;
      sellerId?: string | null;
      orderId?: string | null;
      orderIds?: string[];
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
    const orderIds = Array.isArray(body.orderIds)
      ? Array.from(new Set(body.orderIds.map((x) => String(x || '').trim()).filter(Boolean)))
      : [];
    if (orderId && !orderIds.includes(orderId)) orderIds.unshift(orderId);
    const invoiceId = body.invoiceId ? String(body.invoiceId).trim() : null;
    const invoiceIds = Array.isArray(body.invoiceIds)
      ? Array.from(new Set(body.invoiceIds.map((x) => String(x || '').trim()).filter(Boolean)))
      : [];
    const notes = body.notes != null && String(body.notes).trim() ? String(body.notes).trim() : null;

    if (invoiceId && !invoiceIds.includes(invoiceId)) invoiceIds.unshift(invoiceId);
    const systemInvoiceIds = invoiceIds.filter((id) => !id.startsWith('mm-fac-'));
    const systemOrderIds = orderIds.filter((id) => id && !id.startsWith('mm-'));
    const importedInvoiceRefs = invoiceIds.filter((id) => id.startsWith('mm-fac-'));
    const primaryInvoiceId = systemInvoiceIds[0] || null;
    const primaryOrderId = systemOrderIds[0] || orderId || null;

    if (systemInvoiceIds.length > 0) {
      const rows = await query(
        `SELECT i.id, o.customer_id
         FROM invoices i
         JOIN orders o ON o.id = i.order_id
         WHERE i.id IN (${systemInvoiceIds.map(() => '?').join(',')})`,
        systemInvoiceIds
      ) as Array<{ id: string; customer_id: string }>;
      if (rows.length !== systemInvoiceIds.length) {
        return res.status(400).json({ message: 'Hay facturas inválidas en la selección del recibo' });
      }
      const invalidByCustomer = rows.find((r) => r.customer_id !== customerId);
      if (invalidByCustomer) {
        return res.status(400).json({ message: 'Solo podés relacionar facturas del mismo cliente del recibo' });
      }
    }

    try {
      await validateOrdersForPayment(systemOrderIds, customerId);
    } catch (e: any) {
      return res.status(e?.statusCode || 400).json({ message: e.message });
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
    let allocationResult: PaymentAllocationResult | null = null;
    try {
      await execute(
        `INSERT INTO payments (id, customer_id, seller_id, order_id, invoice_id, receipt_number, date, amount, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, customerId, sellerId, primaryOrderId, primaryInvoiceId, receiptNumber, date, amount, notes]
      );
      let resolvedOrderId = primaryOrderId;
      if (systemInvoiceIds.length > 0) {
        const invRow = (await get('SELECT order_id FROM invoices WHERE id = ? LIMIT 1', [
          systemInvoiceIds[0]
        ])) as { order_id?: string } | undefined;
        if (invRow?.order_id) resolvedOrderId = invRow.order_id;
        if (resolvedOrderId && resolvedOrderId !== primaryOrderId) {
          await execute('UPDATE payments SET order_id = ? WHERE id = ?', [resolvedOrderId, id]);
        }
      }
      if (
        (systemInvoiceIds.length > 0 || systemOrderIds.length > 0) &&
        (paymentInvoicesEnabled || paymentOrdersEnabled)
      ) {
        allocationResult = await allocatePayment(id, amount, systemInvoiceIds, systemOrderIds);
      } else if (resolvedOrderId) {
        await syncOrderPaymentStatus(resolvedOrderId);
      } else {
        await syncAllOrderPaymentStatusForCustomer(customerId);
      }
      if (importedInvoiceRefs.length > 0 && paymentInvoiceRefsEnabled) {
        for (const invRef of importedInvoiceRefs) {
          await execute(
            `INSERT IGNORE INTO payment_invoice_refs (payment_id, invoice_ref, source) VALUES (?, ?, 'IMPORTED')`,
            [id, invRef]
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
         GROUP_CONCAT(DISTINCT pi.invoice_id) AS invoice_ids,
         ${paymentOrdersEnabled ? `GROUP_CONCAT(DISTINCT po.order_id) AS order_ids` : `NULL AS order_ids`},
         ${paymentInvoiceRefsEnabled ? `GROUP_CONCAT(DISTINCT pir.invoice_ref) AS invoice_refs` : `NULL AS invoice_refs`}
       FROM payments p
       LEFT JOIN payment_invoices pi ON pi.payment_id = p.id
       ${paymentOrdersEnabled ? `LEFT JOIN payment_orders po ON po.payment_id = p.id` : ``}
       ${paymentInvoiceRefsEnabled ? `LEFT JOIN payment_invoice_refs pir ON pir.payment_id = p.id` : ``}
       WHERE p.id = ?
       GROUP BY p.id, p.customer_id, p.seller_id, p.order_id, p.invoice_id, p.receipt_number, p.date, p.amount, p.notes, p.created_at`
        : `SELECT
         p.id, p.customer_id, p.seller_id, p.order_id, p.invoice_id, p.receipt_number, p.date, p.amount, p.notes, p.created_at,
         NULL AS invoice_ids,
         ${paymentInvoiceRefsEnabled ? `(SELECT GROUP_CONCAT(DISTINCT pir.invoice_ref) FROM payment_invoice_refs pir WHERE pir.payment_id = p.id) AS invoice_refs` : `NULL AS invoice_refs`}
       FROM payments p
       WHERE p.id = ?`,
      [id]
    );
    const allocationNote = allocationResult
      ? formatAllocationNote(allocationResult, amount)
      : undefined;

    res.status(201).json({
      id: row.id,
      customerId: row.customer_id,
      sellerId: row.seller_id ?? undefined,
      orderId: row.order_id ?? undefined,
      orderIds: String(row.order_ids || row.order_id || '')
        .split(',')
        .map((x: string) => x.trim())
        .filter(Boolean),
      invoiceId: row.invoice_id ?? undefined,
      invoiceIds: Array.from(new Set([
        ...String(row.invoice_ids || row.invoice_id || '')
          .split(',')
          .map((x: string) => x.trim())
          .filter(Boolean),
        ...String(row.invoice_refs || '')
          .split(',')
          .map((x: string) => x.trim())
          .filter(Boolean),
      ])),
      receiptNumber: row.receipt_number,
      date: row.date,
      amount: Number(row.amount) || 0,
      notes: row.notes ?? undefined,
      createdAt: row.created_at,
      allocationNote,
      invoiceAllocations: allocationResult?.invoiceAllocations ?? [],
      orderAllocations: allocationResult?.orderAllocations ?? []
    });
  } catch (e: any) {
    console.error('createPayment:', e);
    res.status(500).json({ message: 'Error creando pago', detail: e?.message });
  }
};

/** Saldo pendiente por factura (permite varios recibos sobre la misma). */
export const getInvoicesOutstandingHandler = async (req: any, res: Response) => {
  try {
    const user = req.user;
    if (!user || !canManagePayments(user.role)) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    const raw = String(req.query.invoiceIds || req.query.invoiceId || '').trim();
    const invoiceIds = raw.split(',').map((x) => x.trim()).filter(Boolean);
    const excludePaymentId = String(req.query.excludePaymentId || '').trim() || undefined;
    if (!invoiceIds.length) {
      return res.status(400).json({ message: 'Indicá invoiceIds (separados por coma)' });
    }
    const rows = await getInvoicesOutstanding(invoiceIds, excludePaymentId);
    return res.json(rows);
  } catch (e: any) {
    console.error('getInvoicesOutstanding:', e);
    return res.status(500).json({ message: 'Error consultando saldos de facturas' });
  }
};

/** Saldo pendiente por pedido sin factura. */
export const getOrdersOutstandingHandler = async (req: any, res: Response) => {
  try {
    const user = req.user;
    if (!user || !canManagePayments(user.role)) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    const raw = String(req.query.orderIds || req.query.orderId || '').trim();
    const orderIds = raw.split(',').map((x) => x.trim()).filter(Boolean);
    const excludePaymentId = String(req.query.excludePaymentId || '').trim() || undefined;
    if (!orderIds.length) {
      return res.status(400).json({ message: 'Indicá orderIds (separados por coma)' });
    }
    const rows = await getOrdersOutstanding(orderIds, excludePaymentId);
    return res.json(rows);
  } catch (e: any) {
    console.error('getOrdersOutstanding:', e);
    return res.status(500).json({ message: 'Error consultando saldos de pedidos' });
  }
};

/** Asocia un recibo ya cargado a facturas y/o pedidos sin factura del mismo cliente. */
export const patchPaymentInvoices = async (req: any, res: Response) => {
  try {
    const user = req.user;
    if (!user || !canManagePayments(user.role)) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    const routePaymentId = String(req.params?.id || '').trim();
    if (!routePaymentId) return res.status(400).json({ message: 'ID de recibo requerido' });

    const invoiceIds = Array.isArray(req.body?.invoiceIds)
      ? req.body.invoiceIds.map((x: unknown) => String(x || '').trim()).filter(Boolean)
      : [];
    const orderIds = Array.isArray(req.body?.orderIds)
      ? req.body.orderIds.map((x: unknown) => String(x || '').trim()).filter(Boolean)
      : [];
    const importedInvoiceRefs = invoiceIds.filter((id) => id.startsWith('mm-fac-'));
    const systemInvoiceIds = invoiceIds.filter((id) => id && !id.startsWith('mm-'));
    const systemOrderIds = orderIds.filter((id) => id && !id.startsWith('mm-'));

    const paymentOrdersEnabled = await ensurePaymentOrdersTable();
    const paymentInvoiceRefsEnabled = await ensurePaymentInvoiceRefsTable();

    let paymentId = routePaymentId;
    if (routePaymentId.startsWith('mm-')) {
      const customerId = String(req.body?.customerId || '').trim();
      const lineOrder = Number(req.body?.importedLineOrder);
      if (!customerId || !Number.isFinite(lineOrder)) {
        return res.status(400).json({
          message: 'Para recibos importados de Tango indicá customerId e importedLineOrder'
        });
      }
      paymentId = await ensurePaymentFromMultimediaEntry(customerId, lineOrder);
    }

    const payment = (await get(
      `SELECT p.id, p.customer_id, c.seller_id
       FROM payments p
       JOIN customers c ON c.id = p.customer_id
       WHERE p.id = ?`,
      [paymentId]
    )) as { id: string; customer_id: string; seller_id?: string } | undefined;
    if (!payment) return res.status(404).json({ message: 'Recibo no encontrado' });
    if (user.role === 'SELLER' && payment.seller_id !== user.id) {
      return res.status(403).json({ message: 'Solo podés modificar recibos de tus clientes' });
    }

    const result = await relinkPaymentToInvoices(paymentId, systemInvoiceIds, systemOrderIds);

    if (paymentInvoiceRefsEnabled) {
      await execute('DELETE FROM payment_invoice_refs WHERE payment_id = ?', [paymentId]);
      if (importedInvoiceRefs.length > 0) {
        for (const invRef of importedInvoiceRefs) {
          await execute(
            `INSERT IGNORE INTO payment_invoice_refs (payment_id, invoice_ref, source) VALUES (?, ?, 'IMPORTED')`,
            [paymentId, invRef]
          );
        }
      }
    }

    const row = (await get(
      `SELECT
         p.id, p.customer_id, p.seller_id, p.order_id, p.invoice_id,
         p.receipt_number, p.date, p.amount, p.notes, p.created_at,
         GROUP_CONCAT(DISTINCT pi.invoice_id) AS invoice_ids,
         ${paymentOrdersEnabled ? `GROUP_CONCAT(DISTINCT po.order_id) AS order_ids` : `NULL AS order_ids`},
         ${paymentInvoiceRefsEnabled ? `GROUP_CONCAT(DISTINCT pir.invoice_ref) AS invoice_refs` : `NULL AS invoice_refs`}
       FROM payments p
       LEFT JOIN payment_invoices pi ON pi.payment_id = p.id
       ${paymentOrdersEnabled ? `LEFT JOIN payment_orders po ON po.payment_id = p.id` : ``}
       ${paymentInvoiceRefsEnabled ? `LEFT JOIN payment_invoice_refs pir ON pir.payment_id = p.id` : ``}
       WHERE p.id = ?
       GROUP BY p.id, p.customer_id, p.seller_id, p.order_id, p.invoice_id,
         p.receipt_number, p.date, p.amount, p.notes, p.created_at`,
      [paymentId]
    )) as any;

    const allocationNote = formatAllocationNote(result, Number(row?.amount || 0));

    return res.json({
      id: row.id,
      customerId: row.customer_id,
      orderId: row.order_id ?? undefined,
      orderIds: String(row.order_ids || row.order_id || '')
        .split(',')
        .map((x: string) => x.trim())
        .filter(Boolean),
      invoiceId: row.invoice_id ?? undefined,
      invoiceIds: [
        ...String(row.invoice_ids || row.invoice_id || '')
          .split(',')
          .map((x: string) => x.trim())
          .filter(Boolean),
        ...String(row.invoice_refs || '')
          .split(',')
          .map((x: string) => x.trim())
          .filter(Boolean)
      ],
      receiptNumber: row.receipt_number,
      date: row.date,
      amount: Number(row.amount) || 0,
      notes: row.notes ?? undefined,
      allocationNote,
      invoiceAllocations: result.invoiceAllocations,
      orderAllocations: result.orderAllocations
    });
  } catch (e: any) {
    const code = e?.statusCode;
    if (code === 400 || code === 404) {
      return res.status(code).json({ message: e.message });
    }
    console.error('patchPaymentInvoices:', e);
    return res.status(500).json({ message: 'Error asociando comprobantes al recibo', detail: e?.message });
  }
};

/** Vista previa: un recibo repartido en varias facturas (sin guardar). */
export const postPaymentAllocatePreview = async (req: any, res: Response) => {
  try {
    const user = req.user;
    if (!user || !canManagePayments(user.role)) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    const amount = Number(req.body?.amount);
    const invoiceIds = Array.isArray(req.body?.invoiceIds)
      ? req.body.invoiceIds.map((x: unknown) => String(x || '').trim()).filter(Boolean)
      : [];
    const orderIds = Array.isArray(req.body?.orderIds)
      ? req.body.orderIds.map((x: unknown) => String(x || '').trim()).filter(Boolean)
      : [];
    if (!invoiceIds.length && !orderIds.length) {
      return res.status(400).json({ message: 'Seleccioná al menos una factura o un pedido sin factura' });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: 'Importe inválido' });
    }
    const excludePaymentId = String(req.body?.excludePaymentId || '').trim() || undefined;
    const preview = await previewPaymentAllocation(amount, invoiceIds, orderIds, excludePaymentId);
    return res.json(preview);
  } catch (e: any) {
    console.error('postPaymentAllocatePreview:', e);
    return res.status(500).json({ message: 'Error en vista previa de imputación' });
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

