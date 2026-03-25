import { Request, Response } from 'express';
import { query, execute, get } from '../database/db';
import { v4 as uuidv4 } from 'uuid';

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

    const id = uuidv4();
    await execute(
      `INSERT INTO payments (id, customer_id, seller_id, order_id, invoice_id, receipt_number, date, amount, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, customerId, sellerId, orderId, invoiceId, receiptNumber, date, amount, notes]
    );

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

