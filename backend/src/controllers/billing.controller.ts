import { Request, Response } from 'express';
import { query } from '../database/db';

function parseMoney(value: any): number {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const s = String(value).trim().replace(/\s/g, '').replace(/\$/g, '');
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

function normalizeDate(value: any): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value || '').slice(0, 10);
  return d.toISOString().slice(0, 10);
}

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

    // Integrar facturas importadas desde Tango/Multimedias en la misma vista de facturación.
    // Solo aplica cuando el filtro de tipo incluye facturas.
    if (tipo !== 'NC') {
      const importedWhere: string[] = [`UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'FAC%'`];
      const importedParams: any[] = [];
      if (desde) { importedWhere.push('e.line_date >= ?'); importedParams.push(desde); }
      if (hasta) { importedWhere.push('e.line_date <= ?'); importedParams.push(hasta); }
      if (customerId) { importedWhere.push('e.customer_id = ?'); importedParams.push(customerId); }
      if (authUser?.role === 'SELLER') {
        importedWhere.push('c.seller_id = ?');
        importedParams.push(authUser.id);
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
          c.name AS customer_name
        FROM customer_multimedia_entries e
        JOIN customers c ON c.id = e.customer_id
        WHERE ${importedWhere.join(' AND ')}
        ORDER BY e.line_date DESC, e.line_order DESC
        `,
        importedParams
      ) as any[];

      const existingKeys = new Set(
        result
          .filter((r) => r.tipo === 'FACTURA')
          .map((r) => [
            normalizeDate(r.fecha),
            String(r.numeroDesde ?? '').trim().toUpperCase(),
            Number(r.importe || 0).toFixed(2),
            r.customerId
          ].join('|'))
      );

      const importedMapped = importedRows
        .map((r) => {
          const fecha = normalizeDate(r.line_date);
          const numero = String(r.numero || '').trim();
          const importe = parseMoney(r.importe);
          const dedupeKey = [
            fecha,
            numero.toUpperCase(),
            importe.toFixed(2),
            r.customer_id
          ].join('|');
          return {
            dedupeKey,
            row: {
              id: `mm-fac-${r.customer_id}-${String(r.line_order ?? 'x')}-${fecha}-${numero.replace(/[^A-Za-z0-9]/g, '')}`,
              tipo: 'FACTURA',
              cbteTipo: null,
              puntoVta: null,
              numeroDesde: numero,
              numeroHasta: numero,
              orderId: null,
              fecha,
              importe,
              customerId: r.customer_id,
              customerBusinessName: r.customer_business_name ?? r.customer_name ?? '',
              cae: null,
              caeFchVto: null,
              createdAt: null
            }
          };
        })
        .filter(({ dedupeKey }) => {
          if (existingKeys.has(dedupeKey)) return false;
          existingKeys.add(dedupeKey);
          return true;
        })
        .map(({ row }) => row);

      result.push(...importedMapped);
      result.sort((a, b) => {
        const da = new Date(a.fecha).getTime() || 0;
        const db = new Date(b.fecha).getTime() || 0;
        if (db !== da) return db - da;
        const ca = new Date(a.createdAt || 0).getTime() || 0;
        const cb = new Date(b.createdAt || 0).getTime() || 0;
        return cb - ca;
      });
    }

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

    // Exportar también facturas importadas cuando el filtro de tipo no sea NC.
    if (tipo !== 'NC') {
      const authUser = (req as any).user;
      const importedWhere: string[] = [`UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'FAC%'`];
      const importedParams: any[] = [];
      if (desde) { importedWhere.push('e.line_date >= ?'); importedParams.push(desde); }
      if (hasta) { importedWhere.push('e.line_date <= ?'); importedParams.push(hasta); }
      if (customerId) { importedWhere.push('e.customer_id = ?'); importedParams.push(customerId); }
      if (authUser?.role === 'SELLER') {
        importedWhere.push('c.seller_id = ?');
        importedParams.push(authUser.id);
      }

      const importedRows = await query(
        `
        SELECT
          e.customer_id,
          e.line_date,
          e.numero,
          e.importe,
          c.business_name AS customer_business_name
        FROM customer_multimedia_entries e
        JOIN customers c ON c.id = e.customer_id
        WHERE ${importedWhere.join(' AND ')}
        ORDER BY e.line_date DESC, e.line_order DESC
        `,
        importedParams
      ) as any[];

      const existingKeys = new Set(
        (rows as any[])
          .filter((r: any) => r.tipo === 'FACTURA')
          .map((r: any) => [
            normalizeDate(r.fecha),
            String(r.numero_desde ?? '').trim().toUpperCase(),
            Number(r.importe || 0).toFixed(2),
            r.customer_id
          ].join('|'))
      );

      for (const r of importedRows) {
        const fecha = normalizeDate(r.line_date);
        const numero = String(r.numero || '').trim();
        const importe = parseMoney(r.importe);
        const key = [fecha, numero.toUpperCase(), importe.toFixed(2), r.customer_id].join('|');
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        const line = [
          fecha,
          'FACTURA',
          '',
          '',
          `"${numero.replace(/"/g, '""')}"`,
          `"${numero.replace(/"/g, '""')}"`,
          '',
          `"${(r.customer_business_name || '').replace(/"/g, '""')}"`,
          importe,
          '',
          ''
        ].join(',');
        lines.push(line);
      }
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

