import { Request, Response } from 'express';
import { query, execute } from '../database/db';

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
  if (typeof value === 'string') {
    const raw = value.trim();
    const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const dd = m[1].padStart(2, '0');
      const mm = m[2].padStart(2, '0');
      const yyyy = m[3];
      return `${yyyy}-${mm}-${dd}`;
    }
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value || '').slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function ddmmyyyy(value: any): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '01011900';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear());
  return `${dd}${mm}${yy}`;
}

function formatAmountFixed(amount: number, intLen = 13): string {
  const n = Math.round((Number(amount) || 0) * 100) / 100;
  const [ints, decs] = n.toFixed(2).split('.');
  return `${ints.padStart(intLen, '0')},${decs}`;
}

function onlyDigits(v: any): string {
  return String(v || '').replace(/\D/g, '');
}

function txt(v: any, len: number): string {
  return String(v || '').slice(0, len).padEnd(len, ' ');
}

async function ensureAgipPadronTable(): Promise<void> {
  await execute(`
    CREATE TABLE IF NOT EXISTS agip_padron_alicuotas (
      id VARCHAR(36) PRIMARY KEY,
      period_yyyymm VARCHAR(6) NOT NULL,
      cuit VARCHAR(11) NOT NULL,
      alicuota DECIMAL(8,2) NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_period_cuit (period_yyyymm, cuit),
      KEY idx_period (period_yyyymm),
      KEY idx_cuit (cuit)
    )
  `);
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
        .filter(({ row, dedupeKey }) => {
          if (desde && row.fecha < String(desde)) return false;
          if (hasta && row.fecha > String(hasta)) return false;
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
        if (desde && fecha < String(desde)) continue;
        if (hasta && fecha > String(hasta)) continue;
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

/** Exporta TXT "RetPer_YYYYMM.txt" con layout fijo compatible con estudio (AGIP). */
export const exportRetPerTxt = async (req: Request, res: Response) => {
  try {
    const { desde, hasta, customerId } = req.query as { desde?: string; hasta?: string; customerId?: string };
    const where: string[] = [];
    const params: any[] = [];
    if (desde) {
      where.push('o.date >= ?');
      params.push(desde);
    }
    if (hasta) {
      where.push('o.date <= ?');
      params.push(hasta);
    }
    if (customerId) {
      where.push('o.customer_id = ?');
      params.push(customerId);
    }
    const authUser = (req as any).user;
    if (authUser?.role === 'SELLER') {
      where.push('c.seller_id = ?');
      params.push(authUser.id);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    await ensureAgipPadronTable();
    const period = String((hasta || desde || new Date().toISOString().slice(0, 10)).replace(/-/g, '')).slice(0, 6);

    const rows = await query(
      `
      SELECT
        o.date AS fecha,
        i.cbte_tipo,
        i.punto_venta,
        i.cbte_desde,
        o.total AS importe,
        c.cuit,
        COALESCE(c.business_name, c.name, '') AS razon_social,
        COALESCE(ap.alicuota, 0) AS alicuota
      FROM invoices i
      JOIN orders o ON o.id = i.order_id
      JOIN customers c ON c.id = o.customer_id
      LEFT JOIN agip_padron_alicuotas ap ON ap.period_yyyymm = ? AND ap.cuit = REPLACE(REPLACE(REPLACE(COALESCE(c.cuit,''),'-',''),'.',''),' ','')
      ${whereSql}
      UNION ALL
      SELECT
        o.date AS fecha,
        cn.cbte_tipo,
        cn.punto_venta,
        cn.cbte_desde,
        cn.amount_credited AS importe,
        c.cuit,
        COALESCE(c.business_name, c.name, '') AS razon_social,
        COALESCE(ap.alicuota, 0) AS alicuota
      FROM credit_notes cn
      JOIN orders o ON o.id = cn.order_id
      JOIN customers c ON c.id = o.customer_id
      LEFT JOIN agip_padron_alicuotas ap ON ap.period_yyyymm = ? AND ap.cuit = REPLACE(REPLACE(REPLACE(COALESCE(c.cuit,''),'-',''),'.',''),' ','')
      ${whereSql}
      ORDER BY fecha ASC, punto_venta ASC, cbte_desde ASC
      `,
      [period, ...params, period, ...params]
    ) as any[];

    const lines = rows.map((r) => {
      const fecha = ddmmyyyy(r.fecha);
      const tipoComp = Number(r.cbte_tipo) === 1 || Number(r.cbte_tipo) === 3 ? '01A' : '01B';
      const pv = String(Number(r.punto_venta) || 0).padStart(5, '0');
      const nro = String(Number(r.cbte_desde) || 0).padStart(8, '0');
      const importe = formatAmountFixed(Math.abs(Number(r.importe) || 0));
      const cuit = onlyDigits(r.cuit).padStart(11, '0').slice(0, 11);
      const razon = txt(r.razon_social, 30);
      const alicuota = Math.max(0, Number(r.alicuota || 0));
      const aliStr = `${String(Math.floor(alicuota)).padStart(2, '0')},${String(Math.round((alicuota % 1) * 100)).padStart(2, '0')}`;
      const retPerc = Math.abs(Number(r.importe) || 0) * (alicuota / 100);

      // Layout fijo (alineado con muestra): campos no modelados quedan con defaults.
      return [
        '2029', // tipo/agente (fijo por layout legacy)
        `${fecha.slice(0, 2)}/${fecha.slice(2, 4)}/${fecha.slice(4, 8)}`,
        tipoComp,
        pv,
        nro,
        `${fecha.slice(0, 2)}/${fecha.slice(2, 4)}/${fecha.slice(4, 8)}`,
        importe,
        ' '.repeat(16),
        '3',
        cuit,
        '4000000000001', // condición por defecto legacy
        razon,
        formatAmountFixed(Math.abs(Number(r.importe) || 0) * 0.3, 13), // base presunta
        formatAmountFixed(Math.abs(Number(r.importe) || 0) * 0.05, 13), // ajuste presunto
        formatAmountFixed(Math.abs(Number(r.importe) || 0) * 0.24, 13), // neto presunto
        `3301${aliStr}`, // régimen default + alícuota por CUIT en padrón
        formatAmountFixed(retPerc, 13), // ret/perc calculada
        formatAmountFixed(retPerc, 13),
        ' '.repeat(11)
      ].join('');
    });

    const monthTag = (hasta || desde || new Date().toISOString().slice(0, 10)).replace(/-/g, '').slice(0, 6);
    const filename = `RetPer_${monthTag}.txt`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(lines.join('\n'));
  } catch (error: any) {
    console.error('exportRetPerTxt:', error);
    res.status(500).json({ message: 'Error exportando TXT Ret/Per' });
  }
};

/** Importa padrón AGIP resumido (CUIT + alícuota) para un período YYYYMM. */
export const importAgipPadron = async (req: Request, res: Response) => {
  try {
    const period = String(req.body?.period || '').trim();
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!/^\d{6}$/.test(period)) {
      return res.status(400).json({ message: 'period inválido (usar YYYYMM)' });
    }
    await ensureAgipPadronTable();
    await execute(`DELETE FROM agip_padron_alicuotas WHERE period_yyyymm = ?`, [period]);
    let imported = 0;
    for (const r of rows) {
      const cuit = onlyDigits(r?.cuit).slice(0, 11);
      const alicuota = Number(String(r?.alicuota || '0').replace(',', '.')) || 0;
      if (cuit.length !== 11) continue;
      await execute(
        `INSERT INTO agip_padron_alicuotas (id, period_yyyymm, cuit, alicuota)
         VALUES (UUID(), ?, ?, ?)`,
        [period, cuit, alicuota]
      );
      imported += 1;
    }
    res.json({ message: 'Padrón AGIP importado', period, imported });
  } catch (error: any) {
    console.error('importAgipPadron:', error);
    res.status(500).json({ message: 'Error importando padrón AGIP' });
  }
};

