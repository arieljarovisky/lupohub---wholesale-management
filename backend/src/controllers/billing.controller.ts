import { Request, Response } from 'express';
import { query } from '../database/db';

/** Lista unificada de facturas y notas de crédito, con filtros opcionales. */
export const listBilling = async (req: Request, res: Response) => {
  try {
    const { desde, hasta, customerId, tipo } = req.query as {
      desde?: string;
      hasta?: string;
      customerId?: string;
      tipo?: 'FACTURA' | 'NC';
    };

    const whereParts: string[] = [];
    const params: any[] = [];

    if (desde) {
      whereParts.push('b.fecha >= ?');
      params.push(desde);
    }
    if (hasta) {
      whereParts.push('b.fecha <= ?');
      params.push(hasta);
    }
    if (customerId) {
      whereParts.push('b.customer_id = ?');
      params.push(customerId);
    }
    if (tipo === 'FACTURA' || tipo === 'NC') {
      whereParts.push('b.tipo = ?');
      params.push(tipo);
    }

    const authUser = (req as any).user;
    if (authUser?.role === 'SELLER') {
      whereParts.push('b.customer_id IN (SELECT id FROM customers WHERE seller_id = ?)');
      params.push(authUser.id);
    }

    const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    const sql = `
      SELECT *
      FROM (
        SELECT 
          i.id,
          'FACTURA' AS tipo,
          i.cbte_tipo,
          i.punto_venta,
          i.cbte_desde AS numero_desde,
          i.cbte_hasta AS numero_hasta,
          o.id AS order_id,
          o.date AS fecha,
          o.total AS importe,
          c.id AS customer_id,
          c.business_name AS customer_business_name,
          c.name AS customer_name,
          i.cae,
          i.cae_fch_vto AS cae_fch_vto,
          i.created_at
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN customers c ON c.id = o.customer_id

        UNION ALL

        SELECT
          cn.id,
          'NC' AS tipo,
          cn.cbte_tipo,
          cn.punto_venta,
          cn.cbte_desde AS numero_desde,
          cn.cbte_hasta AS numero_hasta,
          cn.order_id AS order_id,
          o.date AS fecha,
          cn.amount_credited AS importe,
          c.id AS customer_id,
          c.business_name AS customer_business_name,
          c.name AS customer_name,
          cn.cae,
          cn.cae_fch_vto AS cae_fch_vto,
          cn.created_at
        FROM credit_notes cn
        JOIN orders o ON o.id = cn.order_id
        JOIN customers c ON c.id = o.customer_id
      ) AS b
      ${whereSql}
      ORDER BY b.fecha DESC, b.created_at DESC
    `;

    const rows = await query(sql, params);

    const result = (rows || []).map((r: any) => ({
      id: r.id,
      tipo: r.tipo,
      cbteTipo: r.cbte_tipo,
      puntoVta: r.punto_venta,
      numeroDesde: r.numero_desde,
      numeroHasta: r.numero_hasta,
      orderId: r.order_id,
      fecha: r.fecha,
      importe: Number(r.importe) || 0,
      customerId: r.customer_id,
      customerBusinessName: r.customer_business_name ?? r.customer_name ?? '',
      cae: r.cae,
      caeFchVto: r.cae_fch_vto ?? null,
      createdAt: r.created_at
    }));

    res.json(result);
  } catch (error: any) {
    console.error('listBilling:', error);
    res.status(500).json({ message: 'Error listando facturación' });
  }
};

/** Exporta la lista de facturas y NC en CSV simple. */
export const exportBilling = async (req: Request, res: Response) => {
  try {
    // Reutilizar listBilling internamente sería ideal, pero aquí rearmamos consulta para evitar doble serialización
    const { desde, hasta, customerId, tipo } = req.query as {
      desde?: string;
      hasta?: string;
      customerId?: string;
      tipo?: 'FACTURA' | 'NC';
    };

    const whereParts: string[] = [];
    const params: any[] = [];

    if (desde) {
      whereParts.push('b.fecha >= ?');
      params.push(desde);
    }
    if (hasta) {
      whereParts.push('b.fecha <= ?');
      params.push(hasta);
    }
    if (customerId) {
      whereParts.push('b.customer_id = ?');
      params.push(customerId);
    }
    if (tipo === 'FACTURA' || tipo === 'NC') {
      whereParts.push('b.tipo = ?');
      params.push(tipo);
    }

    const authUser = (req as any).user;
    if (authUser?.role === 'SELLER') {
      whereParts.push('b.customer_id IN (SELECT id FROM customers WHERE seller_id = ?)');
      params.push(authUser.id);
    }

    const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    const sql = `
      SELECT *
      FROM (
        SELECT 
          i.id,
          'FACTURA' AS tipo,
          i.cbte_tipo,
          i.punto_venta,
          i.cbte_desde AS numero_desde,
          i.cbte_hasta AS numero_hasta,
          o.id AS order_id,
          o.date AS fecha,
          o.total AS importe,
          c.id AS customer_id,
          c.business_name AS customer_business_name,
          i.cae,
          i.cae_fch_vto AS cae_fch_vto,
          i.created_at
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN customers c ON c.id = o.customer_id

        UNION ALL

        SELECT
          cn.id,
          'NC' AS tipo,
          cn.cbte_tipo,
          cn.punto_venta,
          cn.cbte_desde AS numero_desde,
          cn.cbte_hasta AS numero_hasta,
          cn.order_id AS order_id,
          o.date AS fecha,
          cn.amount_credited AS importe,
          c.id AS customer_id,
          c.business_name AS customer_business_name,
          cn.cae,
          cn.cae_fch_vto AS cae_fch_vto,
          cn.created_at
        FROM credit_notes cn
        JOIN orders o ON o.id = cn.order_id
        JOIN customers c ON c.id = o.customer_id
      ) AS b
      ${whereSql}
      ORDER BY b.fecha DESC, b.created_at DESC
    `;

    const rows = await query(sql, params);

    const header = [
      'fecha',
      'tipo',
      'cbte_tipo',
      'punto_vta',
      'numero_desde',
      'numero_hasta',
      'pedido_id',
      'cliente',
      'importe',
      'cae',
      'cae_fch_vto'
    ];

    const lines = [header.join(',')];
    for (const r of rows as any[]) {
      const line = [
        r.fecha,
        r.tipo,
        r.cbte_tipo,
        r.punto_venta,
        r.numero_desde,
        r.numero_hasta,
        r.order_id,
        `"${(r.customer_business_name || '').replace(/"/g, '""')}"`,
        Number(r.importe) || 0,
        r.cae,
        r.cae_fch_vto || ''
      ].join(',');
      lines.push(line);
    }

    const csv = lines.join('\n');
    const filename = `facturacion_${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error: any) {
    console.error('exportBilling:', error);
    res.status(500).json({ message: 'Error exportando facturación' });
  }
}

