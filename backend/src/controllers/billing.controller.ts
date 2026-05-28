import { Request, Response } from 'express';
import { query, execute, pool } from '../database/db';
import * as XLSX from 'xlsx';
import { cityMatchesFilter } from '../utils/cityNormalize';

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

const MESES_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];
const DIAS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Parsea `YYYY-MM-DD` o Date sin sufrir corrimiento de zona horaria. */
function dateFromYmd(value: any): Date | null {
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const ymd = normalizeDate(value);
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return null;
}

/** "20/05/2026" */
function formatDateEsShort(value: any): string {
  const d = dateFromYmd(value);
  if (!d) return String(value ?? '');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yy = d.getUTCFullYear();
  return `${dd}/${mm}/${yy}`;
}

/** "Miércoles 20 de mayo de 2026" */
function formatDateEsLong(value: any): string {
  const d = dateFromYmd(value);
  if (!d) return String(value ?? '');
  const diaSemana = DIAS_ES[d.getUTCDay()];
  const dia = d.getUTCDate();
  const mes = MESES_ES[d.getUTCMonth()];
  const yy = d.getUTCFullYear();
  return `${diaSemana.charAt(0).toUpperCase()}${diaSemana.slice(1)} ${dia} de ${mes} de ${yy}`;
}

function escapeHtml(value: any): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtMoneyArs(amount: any): string {
  const n = Number(amount) || 0;
  return n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 });
}

function formatAmountFixed(amount: number, intLen = 13): string {
  const n = Math.round((Number(amount) || 0) * 100) / 100;
  const [ints, decs] = n.toFixed(2).split('.');
  return `${ints.padStart(intLen, '0')},${decs}`;
}
function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Filtro ciudad para export RetPer (alineado con Facturación: CABA = Capital Federal). */
function customerMatchesProvinceFilter(city: unknown, province: string): boolean {
  const p = String(province || '').trim();
  if (!p || p === 'ALL') return true;
  return cityMatchesFilter(String(city || ''), p);
}

function onlyDigits(v: any): string {
  return String(v || '').replace(/\D/g, '');
}

function txt(v: any, len: number): string {
  const ascii = String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .toUpperCase();
  return ascii.slice(0, len).padEnd(len, ' ');
}

/** Longitud de registro e-Arciba (AGIP, vigente 01/2022+). */
const ARCIBA_RECORD_LEN = 226;
/** Código de norma para percepciones (3 dígitos). Configurable por env. */
const AGIP_PERCEPCION_CODIGO_NORMA = (process.env.AGIP_PERCEPCION_CODIGO_NORMA || '029').padStart(3, '0').slice(-3);

function mapCondicionIvaArciba(condicion: unknown): string {
  const c = String(condicion || '').toLowerCase();
  if (c.includes('monotribut')) return '4';
  if (c.includes('exento')) return '3';
  if (c.includes('consumidor final')) return '4';
  if (c.includes('responsable inscripto')) return '1';
  return '1';
}

/** Letra de comprobante para percepción según condición IVA del cliente (agente RI). */
function letraComprobanteArciba(cbteTipo: number, condicionIva: unknown): string {
  if (Number(cbteTipo) === 6 || Number(cbteTipo) === 8) return 'B';
  const code = mapCondicionIvaArciba(condicionIva);
  if (code === '1') return 'A';
  return 'B';
}

/** Monto numérico Arciba: alineado a la derecha, coma decimal, ancho fijo. */
function formatArcibaNumber(amount: number, width: number): string {
  const capped = Math.min(9999999999999.99, Math.max(0, round2(amount)));
  const body = capped.toFixed(2).replace('.', ',');
  return body.length > width ? body.slice(-width) : body.padStart(width, '0');
}

function formatArcibaAlicuota(alicuota: number): string {
  const n = Math.min(99.99, Math.max(0, Number(alicuota) || 0));
  const intPart = Math.floor(n);
  const dec = Math.round((n - intPart) * 100);
  return `${String(intPart).padStart(2, '0')},${String(dec).padStart(2, '0')}`;
}

function formatArcibaComprobanteNumero(puntoVta: number, cbteDesde: number): string {
  const pv = String(Number(puntoVta) || 0).padStart(5, '0');
  const num = String(Number(cbteDesde) || 0).padStart(8, '0');
  return (pv + num).padStart(16, '0');
}

/** Arma un registro de percepción (tipo op. 2) según diseño AGIP e-Arciba. */
function buildArcibaPerceptionRecord(row: {
  fecha: any;
  cbte_tipo: number;
  punto_venta: number;
  cbte_desde: number;
  neto: number;
  agip_ret_per: number;
  cuit: string;
  razon_social: string;
  alicuota: number;
  condicion_iva?: string | null;
}): string {
  const rec = Array(ARCIBA_RECORD_LEN).fill(' ');
  const put = (from: number, to: number, val: string, align: 'left' | 'right' = 'left') => {
    const len = to - from + 1;
    let v = String(val).slice(0, len);
    v = align === 'right' ? v.padStart(len, '0') : v.padEnd(len, ' ');
    for (let i = 0; i < len; i++) rec[from - 1 + i] = v[i];
  };

  const fecha = formatDateEsShort(row.fecha);
  const letra = letraComprobanteArciba(Number(row.cbte_tipo), row.condicion_iva);
  const cuit = onlyDigits(row.cuit).slice(0, 11);
  const neto = round2(Math.abs(Number(row.neto) || 0));
  const iva = letra === 'A' || letra === 'M' ? round2(neto * 0.21) : 0;
  const otros = 0;
  const montoComprobante = round2(neto + iva);
  const montoSujeto = round2(montoComprobante - iva - otros);
  const alicuota = Math.max(0, Number(row.alicuota) || 0);
  const retPercStored = Math.abs(Number(row.agip_ret_per) || 0);
  const retPerc =
    retPercStored > 0.005 ? round2(retPercStored) : alicuota > 0 ? round2(montoSujeto * (alicuota / 100)) : 0;
  const situacionIva = mapCondicionIvaArciba(row.condicion_iva);

  put(1, 1, '2');
  put(2, 4, AGIP_PERCEPCION_CODIGO_NORMA, 'right');
  put(5, 14, fecha);
  put(15, 16, '01');
  put(17, 17, letra);
  put(18, 33, formatArcibaComprobanteNumero(row.punto_venta, row.cbte_desde), 'right');
  put(34, 43, fecha);
  put(44, 59, formatArcibaNumber(montoComprobante, 16), 'right');
  put(60, 75, '');
  put(76, 76, '3');
  put(77, 87, cuit, 'right');
  put(88, 88, '1');
  put(89, 99, cuit, 'right');
  put(100, 100, situacionIva);
  put(101, 130, txt(row.razon_social, 30));
  put(131, 146, formatArcibaNumber(otros, 16), 'right');
  put(147, 162, formatArcibaNumber(iva, 16), 'right');
  put(163, 178, formatArcibaNumber(montoSujeto, 16), 'right');
  put(179, 183, formatArcibaAlicuota(alicuota), 'right');
  put(184, 199, formatArcibaNumber(retPerc, 16), 'right');
  put(200, 215, formatArcibaNumber(retPerc, 16), 'right');
  put(216, 216, ' ');
  put(217, 226, '          ');

  return rec.join('');
}

function normalizeNameForMatch(v: any): string {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensForNameMatch(v: string): string[] {
  return normalizeNameForMatch(v)
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

/** Lista pegada: un CUIT por línea o separados por coma/punto y coma/tab. Ignora encabezado "CUIT". */
function parseCuitsFromText(raw: string): { valid: string[]; invalid: string[] } {
  const tokens = raw
    .split(/[\r\n,;\t]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const validSet = new Set<string>();
  const invalid: string[] = [];
  for (const t of tokens) {
    if (/^cuit$/i.test(t)) continue;
    const d = onlyDigits(t);
    if (d.length === 11) validSet.add(d);
    else if (d.length > 0) invalid.push(t);
  }
  return { valid: Array.from(validSet), invalid };
}

function extractCuitCandidates(raw: any): string[] {
  const s = String(raw ?? '');
  const compact = s.replace(/[\s.\-_/]/g, '');
  const out = new Set<string>();
  const mCompact = compact.match(/\d{11}/g) || [];
  for (const m of mCompact) out.add(m);
  const mWithSep = s.match(/\d{2}[-\s]?\d{8}[-\s]?\d/g) || [];
  for (const m of mWithSep) {
    const d = onlyDigits(m);
    if (d.length === 11) out.add(d);
  }
  return Array.from(out);
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
    const { desde, hasta, customerId, province, tipo } = req.query as {
      desde?: string;
      hasta?: string;
      customerId?: string;
      province?: string;
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
    if (province && String(province).trim()) {
      whereParts.push('b.customer_id IN (SELECT id FROM customers WHERE LOWER(COALESCE(city, \'\')) LIKE ?)');
      params.push(`%${String(province).trim().toLowerCase()}%`);
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
          COALESCE(DATE(i.created_at), o.date) AS fecha,
          ROUND(o.total * 1.21 + COALESCE(i.agip_ret_per, 0), 2) AS importe,
          c.id AS customer_id,
          c.business_name AS customer_business_name,
          c.name AS customer_name,
          i.cae,
          i.cae_fch_vto AS cae_fch_vto,
          i.created_at,
          i.agip_alicuota,
          i.agip_ret_per,
          (SELECT COUNT(*) FROM credit_notes cn_cnt WHERE cn_cnt.order_id = o.id) AS credit_notes_count
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN customers c ON c.id = o.customer_id

        UNION ALL

        -- Las NC por ítems insertan UNA fila por ítem creditado, pero todas comparten el mismo
        -- comprobante AFIP (mismo CAE / punto_venta / cbte_tipo / cbte_desde). Agrupamos por
        -- comprobante para mostrar una sola línea por NC real, con el importe sumado.
        SELECT
          MIN(cn.id) AS id,
          'NC' AS tipo,
          cn.cbte_tipo,
          cn.punto_venta,
          cn.cbte_desde AS numero_desde,
          cn.cbte_hasta AS numero_hasta,
          cn.order_id AS order_id,
          COALESCE(DATE(MIN(cn.created_at)), MAX(o.date)) AS fecha,
          ROUND(SUM(cn.amount_credited) * 1.21, 2) AS importe,
          c.id AS customer_id,
          c.business_name AS customer_business_name,
          c.name AS customer_name,
          cn.cae,
          cn.cae_fch_vto AS cae_fch_vto,
          MIN(cn.created_at) AS created_at,
          0 AS agip_alicuota,
          0 AS agip_ret_per,
          (SELECT COUNT(*) FROM credit_notes cn_tot WHERE cn_tot.order_id = cn.order_id) AS credit_notes_count
        FROM credit_notes cn
        JOIN orders o ON o.id = cn.order_id
        JOIN customers c ON c.id = o.customer_id
        WHERE COALESCE(cn.superseded_by_reinvoice, 0) = 0
        GROUP BY cn.cae, cn.punto_venta, cn.cbte_tipo, cn.cbte_desde, cn.cbte_hasta,
                 cn.cae_fch_vto, cn.order_id, c.id, c.business_name, c.name
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
      createdAt: r.created_at,
      creditNotesCount: Number(r.credit_notes_count) || 0,
      agipAlicuota: Number(r.agip_alicuota) || 0,
      agipRetPer: Number(r.agip_ret_per) || 0
    }));

    // Integrar facturas importadas desde Tango/Multimedias en la misma vista de facturación.
    // Solo aplica cuando el filtro de tipo incluye facturas.
    if (tipo !== 'NC') {
      const importedWhere: string[] = [`UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'FAC%'`];
      const importedParams: any[] = [];
      if (customerId) { importedWhere.push('e.customer_id = ?'); importedParams.push(customerId); }
      if (province && String(province).trim()) {
        importedWhere.push('LOWER(COALESCE(c.city, \'\')) LIKE ?');
        importedParams.push(`%${String(province).trim().toLowerCase()}%`);
      }
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
              createdAt: null,
              creditNotesCount: 0,
              agipAlicuota: 0,
              agipRetPer: 0
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
    const { desde, hasta, customerId, province, tipo } = req.query as {
      desde?: string;
      hasta?: string;
      customerId?: string;
      province?: string;
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
    if (province && String(province).trim()) {
      whereParts.push('b.customer_id IN (SELECT id FROM customers WHERE LOWER(COALESCE(city, \'\')) LIKE ?)');
      params.push(`%${String(province).trim().toLowerCase()}%`);
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
          COALESCE(DATE(i.created_at), o.date) AS fecha,
          ROUND(o.total * 1.21 + COALESCE(i.agip_ret_per, 0), 2) AS importe,
          c.id AS customer_id,
          c.business_name AS customer_business_name,
          c.cuit AS customer_cuit,
          i.cae,
          i.cae_fch_vto AS cae_fch_vto,
          i.created_at
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN customers c ON c.id = o.customer_id

        UNION ALL

        -- Agrupamos por comprobante AFIP para evitar mostrar una fila por ítem creditado
        -- cuando la NC es parcial por ítems (todas comparten mismo CAE).
        SELECT
          MIN(cn.id) AS id,
          'NC' AS tipo,
          cn.cbte_tipo,
          cn.punto_venta,
          cn.cbte_desde AS numero_desde,
          cn.cbte_hasta AS numero_hasta,
          cn.order_id AS order_id,
          COALESCE(DATE(MIN(cn.created_at)), MAX(o.date)) AS fecha,
          ROUND(SUM(cn.amount_credited) * 1.21, 2) AS importe,
          c.id AS customer_id,
          c.business_name AS customer_business_name,
          c.cuit AS customer_cuit,
          cn.cae,
          cn.cae_fch_vto AS cae_fch_vto,
          MIN(cn.created_at) AS created_at
        FROM credit_notes cn
        JOIN orders o ON o.id = cn.order_id
        JOIN customers c ON c.id = o.customer_id
        WHERE COALESCE(cn.superseded_by_reinvoice, 0) = 0
        GROUP BY cn.cae, cn.punto_venta, cn.cbte_tipo, cn.cbte_desde, cn.cbte_hasta,
                 cn.cae_fch_vto, cn.order_id, c.id, c.business_name, c.name, c.cuit
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
      'cuit',
      'origen',
      'importe',
      'cae',
      'cae_fch_vto'
    ];

    const lines = [header.join(',')];
    for (const r of rows as any[]) {
      const line = [
        formatDateEsShort(r.fecha),
        r.tipo,
        r.cbte_tipo,
        r.punto_venta,
        r.numero_desde,
        r.numero_hasta,
        r.order_id,
        `"${(r.customer_business_name || '').replace(/"/g, '""')}"`,
        `"${String(r.customer_cuit ?? '').replace(/"/g, '""')}"`,
        '"Sistema (AFIP)"',
        Number(r.importe) || 0,
        r.cae,
        r.cae_fch_vto ? formatDateEsShort(r.cae_fch_vto) : ''
      ].join(',');
      lines.push(line);
    }

    // Exportar también facturas importadas cuando el filtro de tipo no sea NC.
    if (tipo !== 'NC') {
      const authUser = (req as any).user;
      const importedWhere: string[] = [`UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'FAC%'`];
      const importedParams: any[] = [];
      if (customerId) { importedWhere.push('e.customer_id = ?'); importedParams.push(customerId); }
      if (province && String(province).trim()) {
        importedWhere.push('LOWER(COALESCE(c.city, \'\')) LIKE ?');
        importedParams.push(`%${String(province).trim().toLowerCase()}%`);
      }
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
          c.business_name AS customer_business_name,
          c.cuit AS customer_cuit
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
          formatDateEsShort(fecha),
          'FACTURA',
          '',
          '',
          `"${numero.replace(/"/g, '""')}"`,
          `"${numero.replace(/"/g, '""')}"`,
          '',
          `"${(r.customer_business_name || '').replace(/"/g, '""')}"`,
          `"${String(r.customer_cuit ?? '').replace(/"/g, '""')}"`,
          '"Tango / Multimedias"',
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

/**
 * Devuelve una vista HTML imprimible con el listado de facturas y NC del rango.
 * Pensada para abrir en una pestaña nueva y disparar `window.print()` automáticamente.
 * Fechas en español (corto en la tabla, largo en el encabezado del período).
 */
export const printBilling = async (req: Request, res: Response) => {
  try {
    const { desde, hasta, customerId, province, tipo } = req.query as {
      desde?: string;
      hasta?: string;
      customerId?: string;
      province?: string;
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
    if (province && String(province).trim()) {
      whereParts.push(
        "b.customer_id IN (SELECT id FROM customers WHERE LOWER(COALESCE(city, '')) LIKE ?)"
      );
      params.push(`%${String(province).trim().toLowerCase()}%`);
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
          COALESCE(DATE(i.created_at), o.date) AS fecha,
          ROUND(o.total * 1.21 + COALESCE(i.agip_ret_per, 0), 2) AS importe,
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, '') AS cliente,
          c.cuit AS cuit,
          i.cae,
          i.created_at
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN customers c ON c.id = o.customer_id

        UNION ALL

        SELECT
          MIN(cn.id) AS id,
          'NC' AS tipo,
          cn.cbte_tipo,
          cn.punto_venta,
          cn.cbte_desde AS numero_desde,
          cn.cbte_hasta AS numero_hasta,
          COALESCE(DATE(MIN(cn.created_at)), MAX(o.date)) AS fecha,
          ROUND(SUM(cn.amount_credited) * 1.21, 2) AS importe,
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, '') AS cliente,
          c.cuit AS cuit,
          cn.cae,
          MIN(cn.created_at) AS created_at
        FROM credit_notes cn
        JOIN orders o ON o.id = cn.order_id
        JOIN customers c ON c.id = o.customer_id
        WHERE COALESCE(cn.superseded_by_reinvoice, 0) = 0
        GROUP BY cn.cae, cn.punto_venta, cn.cbte_tipo, cn.cbte_desde, cn.cbte_hasta,
                 cn.order_id, c.id, c.business_name, c.name, c.cuit
      ) AS b
      ${whereSql}
      ORDER BY b.fecha ASC, b.created_at ASC
    `;

    const rows = (await query(sql, params)) as any[];

    let totalFacturas = 0;
    let totalNC = 0;
    let countFacturas = 0;
    let countNC = 0;

    const tableRows = (rows || [])
      .map((r) => {
        const importe = Number(r.importe) || 0;
        const esNC = String(r.tipo) === 'NC';
        if (esNC) {
          totalNC += importe;
          countNC += 1;
        } else {
          totalFacturas += importe;
          countFacturas += 1;
        }
        const letra = letraFromCbteTipo(r.cbte_tipo);
        const pv = String(Number(r.punto_venta) || 0).padStart(4, '0');
        const nro = String(Number(r.numero_desde) || 0).padStart(8, '0');
        const comprobante = letra && r.punto_venta ? `${letra}${pv}-${nro}` : '—';
        const importeStr = fmtMoneyArs(esNC ? -importe : importe);
        const tipoChip = esNC
          ? '<span class="chip chip-nc">NC</span>'
          : '<span class="chip chip-fac">FACTURA</span>';
        return `
          <tr class="${esNC ? 'row-nc' : ''}">
            <td class="col-fecha">${escapeHtml(formatDateEsShort(r.fecha))}</td>
            <td>${tipoChip}</td>
            <td class="mono">${escapeHtml(comprobante)}</td>
            <td>${escapeHtml(r.cliente || '')}</td>
            <td class="mono">${escapeHtml(r.cuit || '')}</td>
            <td class="mono num">${escapeHtml(importeStr)}</td>
            <td class="mono small">${escapeHtml(r.cae || '')}</td>
          </tr>
        `;
      })
      .join('');

    const periodoTexto = (() => {
      if (desde && hasta) {
        return `Del ${formatDateEsLong(desde)} al ${formatDateEsLong(hasta)}`;
      }
      if (desde) return `Desde ${formatDateEsLong(desde)}`;
      if (hasta) return `Hasta ${formatDateEsLong(hasta)}`;
      return 'Período: todos los comprobantes';
    })();

    const tipoFiltroTexto = tipo === 'FACTURA' ? 'Solo facturas' : tipo === 'NC' ? 'Solo notas de crédito' : null;
    const totalNeto = totalFacturas - totalNC;
    const emitidoEn = formatDateEsLong(new Date().toISOString().slice(0, 10));

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Listado de facturación · ${escapeHtml(periodoTexto)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #1a202c;
    margin: 24px 32px;
    font-size: 12px;
    line-height: 1.4;
  }
  header { border-bottom: 2px solid #2d3748; padding-bottom: 12px; margin-bottom: 18px; }
  h1 { margin: 0 0 4px; font-size: 20px; font-weight: 800; }
  .periodo { font-size: 14px; color: #2d3748; font-weight: 600; }
  .meta { color: #4a5568; font-size: 11px; margin-top: 6px; }
  .filtros { color: #2c5282; font-size: 11px; margin-top: 4px; font-style: italic; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  thead th {
    background: #edf2f7;
    text-align: left;
    padding: 6px 8px;
    border-bottom: 2px solid #2d3748;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #2d3748;
  }
  tbody td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  tbody tr:nth-child(even) { background: #f7fafc; }
  tbody tr.row-nc { background: #fffaf0; }
  .mono { font-family: "SFMono-Regular", Menlo, Consolas, monospace; font-size: 11px; }
  .small { font-size: 10px; color: #4a5568; }
  .num { text-align: right; white-space: nowrap; }
  .col-fecha { white-space: nowrap; }
  .chip { display: inline-block; padding: 1px 6px; border-radius: 8px; font-size: 10px; font-weight: 700; letter-spacing: 0.02em; }
  .chip-fac { background: #c6f6d5; color: #22543d; }
  .chip-nc { background: #fed7d7; color: #742a2a; }
  .totales { margin-top: 18px; display: flex; flex-wrap: wrap; gap: 12px; }
  .total-card { border: 1px solid #cbd5e0; border-radius: 8px; padding: 10px 14px; flex: 1; min-width: 180px; background: #f7fafc; }
  .total-card .label { font-size: 10px; text-transform: uppercase; color: #4a5568; font-weight: 700; }
  .total-card .value { font-size: 16px; font-weight: 800; margin-top: 2px; color: #1a202c; font-family: "SFMono-Regular", Menlo, Consolas, monospace; }
  .total-card.neto { border-color: #2b6cb0; background: #ebf8ff; }
  .total-card.neto .value { color: #2b6cb0; }
  .footer { margin-top: 18px; color: #718096; font-size: 10px; text-align: right; }
  .actions { margin-bottom: 14px; }
  .actions button {
    padding: 8px 14px; font-size: 12px; font-weight: 700;
    background: #2b6cb0; color: white; border: none; border-radius: 6px;
    cursor: pointer; margin-right: 8px;
  }
  .actions button.secondary { background: #718096; }
  .empty { padding: 32px; text-align: center; color: #718096; font-style: italic; }
  @media print {
    body { margin: 12mm; font-size: 10px; }
    .actions { display: none; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="actions">
    <button onclick="window.print()">Imprimir</button>
    <button class="secondary" onclick="window.close()">Cerrar</button>
  </div>
  <header>
    <h1>Listado de facturación</h1>
    <div class="periodo">${escapeHtml(periodoTexto)}</div>
    <div class="meta">Emitido el ${escapeHtml(emitidoEn)}${authUser?.email ? ` · ${escapeHtml(authUser.email)}` : ''}</div>
    ${tipoFiltroTexto ? `<div class="filtros">${escapeHtml(tipoFiltroTexto)}</div>` : ''}
  </header>
  ${rows.length === 0
    ? '<div class="empty">No hay comprobantes para los filtros seleccionados.</div>'
    : `<table>
        <thead>
          <tr>
            <th class="col-fecha">Fecha</th>
            <th>Tipo</th>
            <th>Comprobante</th>
            <th>Cliente</th>
            <th>CUIT</th>
            <th class="num">Importe</th>
            <th>CAE</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>`}
  <div class="totales">
    <div class="total-card">
      <div class="label">Facturas (${countFacturas})</div>
      <div class="value">${escapeHtml(fmtMoneyArs(totalFacturas))}</div>
    </div>
    <div class="total-card">
      <div class="label">Notas de crédito (${countNC})</div>
      <div class="value">- ${escapeHtml(fmtMoneyArs(totalNC))}</div>
    </div>
    <div class="total-card neto">
      <div class="label">Neto facturado</div>
      <div class="value">${escapeHtml(fmtMoneyArs(totalNeto))}</div>
    </div>
  </div>
  <div class="footer">LupoHub · Facturación AFIP</div>
  <script>
    window.addEventListener('load', function () {
      if (!window.location.hash.includes('noprint')) {
        setTimeout(function () { window.print(); }, 300);
      }
    });
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error: any) {
    console.error('printBilling:', error);
    res.status(500).send(
      `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:24px"><h1>Error generando el listado</h1><p>${escapeHtml(error?.message || 'Error desconocido')}</p></body>`
    );
  }
};

/** Detecta provincia a partir del campo `city` (y opcionalmente `address`) del cliente. */
function detectProvincia(city: string, address: string = ''): { code: string; name: string } {
  const haystack = `${city || ''} ${address || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (!haystack.trim()) return { code: '', name: '' };

  /** Códigos conocidos según Excel modelo del estudio contable (Tango). El resto va vacío y se completa manual. */
  const PROVINCIAS: Array<{ code: string; name: string; patterns: RegExp[] }> = [
    { code: '01', name: 'CAPITAL', patterns: [/capital\s*federal/, /\bcaba\b/, /ciudad\s*autonoma/, /^capital$/] },
    { code: '02', name: 'BUENOS AIRES', patterns: [/buenos\s*aires/, /\bbs\s*\.?\s*as\b/, /provincia\s*de\s*buenos\s*aires/] },
    { code: '',   name: 'CATAMARCA', patterns: [/catamarca/] },
    { code: '',   name: 'CHACO', patterns: [/\bchaco\b/, /resistencia/] },
    { code: '',   name: 'CHUBUT', patterns: [/chubut/, /comodoro\s*rivadavia/, /trelew/, /puerto\s*madryn/, /rawson/] },
    { code: '',   name: 'CORDOBA', patterns: [/cordoba/, /\bcba\b/] },
    { code: '',   name: 'CORRIENTES', patterns: [/corrientes/] },
    { code: '09', name: 'ENTRE RIOS', patterns: [/entre\s*rios/, /\bparana\b/, /concordia/, /gualeguaychu/] },
    { code: '',   name: 'FORMOSA', patterns: [/formosa/] },
    { code: '',   name: 'JUJUY', patterns: [/jujuy/, /san\s*salvador\s*de\s*jujuy/] },
    { code: '',   name: 'LA PAMPA', patterns: [/la\s*pampa/, /santa\s*rosa/] },
    { code: '',   name: 'LA RIOJA', patterns: [/la\s*rioja/] },
    { code: '05', name: 'MENDOZA', patterns: [/mendoza/, /godoy\s*cruz/, /malargue/, /san\s*rafael/] },
    { code: '',   name: 'MISIONES', patterns: [/misiones/, /posadas/, /obera/, /eldorado/] },
    { code: '',   name: 'NEUQUEN', patterns: [/neuquen/] },
    { code: '',   name: 'RIO NEGRO', patterns: [/rio\s*negro/, /bariloche/, /viedma/, /general\s*roca/] },
    { code: '',   name: 'SALTA', patterns: [/\bsalta\b/] },
    { code: '',   name: 'SAN JUAN', patterns: [/san\s*juan/] },
    { code: '',   name: 'SAN LUIS', patterns: [/san\s*luis/] },
    { code: '',   name: 'SANTA CRUZ', patterns: [/santa\s*cruz/, /rio\s*gallegos/, /\bcaleta\s*olivia\b/] },
    { code: '10', name: 'SANTA FE', patterns: [/santa\s*fe/, /\brosario\b/, /rafaela/, /reconquista/, /venado\s*tuerto/] },
    { code: '',   name: 'SANTIAGO DEL ESTERO', patterns: [/santiago\s*del\s*estero/] },
    { code: '24', name: 'Tierra del Fuego', patterns: [/tierra\s*del\s*fuego/, /ushuaia/, /rio\s*grande/] },
    { code: '',   name: 'TUCUMAN', patterns: [/tucuman/, /san\s*miguel\s*de\s*tucuman/] }
  ];
  // Buscar CAPITAL antes que BUENOS AIRES para resolver ambigüedad (CAPITAL FEDERAL contiene "buenos aires" en algunos formatos).
  for (const p of PROVINCIAS) {
    if (p.patterns.some((rx) => rx.test(haystack))) {
      return { code: p.code, name: p.name };
    }
  }
  return { code: '', name: '' };
}

/** Convierte 'YYYY-MM-DD' (o Date) al serial de Excel (días desde 1899-12-30, con bug del año bisiesto 1900). */
function toExcelSerialDate(value: any): number {
  const s = typeof value === 'string' ? value : value instanceof Date ? value.toISOString().slice(0, 10) : '';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return 0;
  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  const utc = Date.UTC(yyyy, mm - 1, dd);
  return Math.floor(utc / 86400000) + 25569;
}

/** Letra del comprobante AFIP a partir de `cbte_tipo`. 1/3 = A, 6/8 = B, 11/13 = C. */
function letraFromCbteTipo(t: any): string {
  const n = Number(t);
  if (n === 1 || n === 3) return 'A';
  if (n === 6 || n === 8) return 'B';
  if (n === 11 || n === 13) return 'C';
  if (n === 51) return 'M';
  return 'A';
}

/**
 * Exporta el Excel "Ventas por Jurisdicción" con el formato esperado por el estudio contable.
 * Columnas: COD_PROVI, NOM_PROVI, FECHA_EMI (serial), T_COMP (FAC/CDE), N_COMP (A0002000012131),
 *           RAZON_SOC, SIN_IVA, IMP_IVA, IMPUEST, IMPORTE, COD_TRANSP, NOM_TRANSP.
 * NC va con montos en negativo y sin transporte.
 */
export const exportVentasJurisdiccionXlsx = async (req: Request, res: Response) => {
  try {
    const { desde, hasta } = req.query as { desde?: string; hasta?: string };
    if (!desde || !hasta) {
      return res.status(400).json({ message: 'Faltan parámetros desde / hasta (YYYY-MM-DD)' });
    }

    const authUser = (req as any).user;
    const sellerJoinSql = authUser?.role === 'SELLER' ? ' AND c.seller_id = ?' : '';
    const sellerParam = authUser?.role === 'SELLER' ? [authUser.id] : [];

    const rows = await query(
      `
      SELECT *
      FROM (
        SELECT
          'FAC' AS tipo,
          COALESCE(DATE(i.created_at), o.date) AS fecha,
          i.cbte_tipo,
          i.punto_venta,
          i.cbte_desde,
          i.cbte_hasta,
          o.total AS neto,
          COALESCE(i.agip_ret_per, 0) AS otros_impuestos,
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, '') AS razon_social,
          COALESCE(c.city, '') AS city,
          COALESCE(c.address, '') AS address
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN customers c ON c.id = o.customer_id
        WHERE o.date >= ? AND o.date <= ?${sellerJoinSql}

        UNION ALL

        -- Agrupamos por comprobante AFIP: una NC parcial por ítems genera N filas en credit_notes
        -- pero corresponde a UN solo comprobante (mismo CAE / pv / nro). Sumamos importes para el reporte.
        SELECT
          'CDE' AS tipo,
          MAX(o.date) AS fecha,
          cn.cbte_tipo,
          cn.punto_venta,
          cn.cbte_desde,
          cn.cbte_hasta,
          SUM(cn.amount_credited) AS neto,
          0 AS otros_impuestos,
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, '') AS razon_social,
          COALESCE(c.city, '') AS city,
          COALESCE(c.address, '') AS address
        FROM credit_notes cn
        JOIN orders o ON o.id = cn.order_id
        JOIN customers c ON c.id = o.customer_id
        WHERE o.date >= ? AND o.date <= ?${sellerJoinSql}
        GROUP BY cn.cae, cn.punto_venta, cn.cbte_tipo, cn.cbte_desde, cn.cbte_hasta,
                 c.id, c.business_name, c.name, c.city, c.address
      ) AS x
      ORDER BY x.fecha ASC, x.punto_venta ASC, x.cbte_desde ASC
      `,
      [desde, hasta, ...sellerParam, desde, hasta, ...sellerParam]
    ) as any[];

    // Primer transporte por cliente (fallback a customers.transport_number).
    const customerIds = Array.from(new Set(rows.map((r) => String(r.customer_id || '')))).filter(Boolean);
    const transportesByCustomer = new Map<string, { code: string; name: string }>();
    if (customerIds.length > 0) {
      const placeholders = customerIds.map(() => '?').join(',');
      const ct = await query(
        `
        SELECT ct.customer_id, t.name, t.id
        FROM customer_transportes ct
        JOIN transportes t ON t.id = ct.transporte_id
        WHERE ct.customer_id IN (${placeholders})
        ORDER BY ct.customer_id ASC, LOWER(t.name) ASC, t.id ASC
        `,
        customerIds
      ) as any[];
      for (const t of ct) {
        const k = String(t.customer_id);
        if (!transportesByCustomer.has(k)) {
          transportesByCustomer.set(k, { code: '', name: String(t.name || '').trim() });
        }
      }
      // Fallback: si el cliente no tiene transporte asignado en customer_transportes, usar `transport_number` del cliente.
      const missing = customerIds.filter((id) => !transportesByCustomer.has(id));
      if (missing.length > 0) {
        const ph = missing.map(() => '?').join(',');
        const fallbackRows = await query(
          `SELECT id, transport_number FROM customers WHERE id IN (${ph})`,
          missing
        ) as any[];
        for (const r of fallbackRows) {
          const raw = String(r.transport_number || '').trim();
          if (!raw) continue;
          // Formato esperable "código - nombre"; si no aplica, se deja todo en NOM_TRANSP.
          const sep = raw.split(/\s*-\s*/);
          if (sep.length >= 2 && /^\d+$/.test(sep[0].trim())) {
            transportesByCustomer.set(String(r.id), { code: sep[0].trim(), name: sep.slice(1).join(' - ').trim() });
          } else {
            transportesByCustomer.set(String(r.id), { code: '', name: raw });
          }
        }
      }
    }

    const data: any[][] = [];
    for (const r of rows) {
      const tipo = String(r.tipo); // 'FAC' o 'CDE'
      const signo = tipo === 'CDE' ? -1 : 1;
      const sinIva = round2((Number(r.neto) || 0) * signo);
      const iva = round2(sinIva * 0.21);
      const otros = round2((Number(r.otros_impuestos) || 0) * signo);
      const importe = round2(sinIva + iva + otros);

      const letra = letraFromCbteTipo(r.cbte_tipo);
      const pv = String(Number(r.punto_venta) || 0).padStart(4, '0');
      const nro = String(Number(r.cbte_desde) || 0).padStart(8, '0');
      const nComp = `${letra}${pv}${nro}`;

      const prov = detectProvincia(String(r.city || ''), String(r.address || ''));
      const fechaSerial = toExcelSerialDate(r.fecha);

      // Para NC: sin transporte, igual que el modelo del estudio.
      const transp = tipo === 'CDE'
        ? { code: '', name: '' }
        : (transportesByCustomer.get(String(r.customer_id)) || { code: '', name: '' });

      data.push([
        prov.code,
        prov.name,
        fechaSerial,
        tipo,
        nComp,
        String(r.razon_social || '').trim(),
        sinIva,
        iva,
        otros,
        importe,
        transp.code,
        transp.name,
        ''
      ]);
    }

    const headers = [
      'COD_PROVI', 'NOM_PROVI', 'FECHA_EMI', 'T_COMP', 'N_COMP',
      'RAZON_SOC', 'SIN_IVA', 'IMP_IVA', 'IMPUEST', 'IMPORTE',
      'COD_TRANSP', 'NOM_TRANSP', ''
    ];

    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Hoja1');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const yyyymm = (desde || '').slice(0, 7).replace('-', '');
    const filename = `VENTAS_JURISDICCION_${yyyymm || 'rango'}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (error: any) {
    console.error('exportVentasJurisdiccionXlsx:', error);
    return res.status(500).json({ message: 'Error exportando ventas por jurisdicción' });
  }
};

/** Exporta TXT "RetPer_YYYYMM.txt" con layout fijo compatible con estudio (AGIP). */
export const exportRetPerTxt = async (req: Request, res: Response) => {
  try {
    const { desde, hasta, customerId, province, month } = req.query as {
      desde?: string;
      hasta?: string;
      customerId?: string;
      province?: string;
      month?: string;
    };
    const monthMatch = String(month || '').match(/^(\d{4})-(\d{2})$/);
    let fromDate = desde;
    let toDate = hasta;
    if (monthMatch) {
      const yy = Number(monthMatch[1]);
      const mm = Number(monthMatch[2]);
      const lastDay = new Date(yy, mm, 0).getDate();
      fromDate = `${monthMatch[1]}-${monthMatch[2]}-01`;
      toDate = `${monthMatch[1]}-${monthMatch[2]}-${String(lastDay).padStart(2, '0')}`;
    }
    const whereFac: string[] = [];
    const paramsFac: any[] = [];
    if (fromDate && toDate) {
      // Emisión en el mes, o pedido del mes con IIBB ya guardado (reemisión posterior).
      whereFac.push(`(
        (COALESCE(DATE(i.created_at), o.date) >= ? AND COALESCE(DATE(i.created_at), o.date) <= ?)
        OR (o.date >= ? AND o.date <= ? AND COALESCE(i.agip_ret_per, 0) > 0.005)
      )`);
      paramsFac.push(fromDate, toDate, fromDate, toDate);
    } else {
      if (fromDate) {
        whereFac.push('COALESCE(DATE(i.created_at), o.date) >= ?');
        paramsFac.push(fromDate);
      }
      if (toDate) {
        whereFac.push('COALESCE(DATE(i.created_at), o.date) <= ?');
        paramsFac.push(toDate);
      }
    }
    if (customerId) {
      whereFac.push('o.customer_id = ?');
      paramsFac.push(customerId);
    }
    const authUser = (req as any).user;
    if (authUser?.role === 'SELLER') {
      whereFac.push('c.seller_id = ?');
      paramsFac.push(authUser.id);
    }
    // Facturas con IIBB guardado en LupoHub o alícuota en padrón del período.
    whereFac.push(
      '(COALESCE(i.agip_ret_per, 0) > 0.005 OR COALESCE(i.agip_alicuota, 0) > 0 OR COALESCE(ap.alicuota, 0) > 0)'
    );
    const whereFacSql = whereFac.length ? `WHERE ${whereFac.join(' AND ')}` : '';

    await ensureAgipPadronTable();
    const period = String((toDate || fromDate || new Date().toISOString().slice(0, 10)).replace(/-/g, '')).slice(0, 6);

    const rowsRaw = await query(
      `
      SELECT
        COALESCE(DATE(i.created_at), o.date) AS fecha,
        i.cbte_tipo,
        i.punto_venta,
        i.cbte_desde,
        o.total AS neto,
        COALESCE(i.agip_ret_per, 0) AS agip_ret_per,
        c.cuit,
        c.city AS customer_city,
        c.condicion_iva,
        COALESCE(c.business_name, c.name, '') AS razon_social,
        COALESCE(NULLIF(i.agip_alicuota, 0), ap.alicuota, 0) AS alicuota
      FROM invoices i
      JOIN orders o ON o.id = i.order_id
      JOIN customers c ON c.id = o.customer_id
      LEFT JOIN agip_padron_alicuotas ap ON ap.period_yyyymm = ? AND ap.cuit = REPLACE(REPLACE(REPLACE(COALESCE(c.cuit,''),'-',''),'.',''),' ','')
      ${whereFacSql}
      ORDER BY fecha ASC, i.punto_venta ASC, i.cbte_desde ASC
      `,
      [period, ...paramsFac]
    ) as any[];

    const provinceKey = String(province || '').trim();
    const rows = rowsRaw.filter((r) => {
      if (!customerMatchesProvinceFilter(r.customer_city, provinceKey)) return false;
      return onlyDigits(r.cuit).length === 11;
    });

    const lines = rows.map((r) => buildArcibaPerceptionRecord(r));

    if (!lines.length) {
      const periodHint = period ? ` (${period})` : '';
      return res.status(400).json({
        message:
          `No hay comprobantes con IIBB para exportar${periodHint}. ` +
          'Verificá Mes RetPer, que las facturas tengan percepción guardada o CUIT en el padrón AGIP, y el filtro de ciudad/cliente.'
      });
    }

    const monthTag = (toDate || fromDate || new Date().toISOString().slice(0, 10)).replace(/-/g, '').slice(0, 6);
    const filename = `RetPer_${monthTag}.txt`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // Compatibilidad e-Arciba: CRLF entre registros y un único salto final, sin línea vacía extra.
    res.send(`${lines.join('\r\n')}\r\n`);
  } catch (error: any) {
    console.error('exportRetPerTxt:', error);
    res.status(500).json({ message: 'Error exportando TXT Ret/Per' });
  }
};

/** Importa padrón AGIP resumido (CUIT + alícuota) para un período YYYYMM. */
export const importAgipPadronStart = async (req: Request, res: Response) => {
  try {
    const period = String(req.body?.period || '').trim();
    if (!/^\d{6}$/.test(period)) {
      return res.status(400).json({ message: 'period inválido (usar YYYYMM)' });
    }
    await ensureAgipPadronTable();
    await execute(`DELETE FROM agip_padron_alicuotas WHERE period_yyyymm = ?`, [period]);
    return res.json({ message: 'Importación inicializada', period });
  } catch (error: any) {
    console.error('importAgipPadronStart:', error);
    const detail = String(error?.sqlMessage || error?.message || '').trim();
    return res.status(500).json({
      message: detail ? `Error inicializando importación AGIP: ${detail}` : 'Error inicializando importación AGIP'
    });
  }
};

export const importAgipPadronChunk = async (req: Request, res: Response) => {
  try {
    const period = String(req.body?.period || '').trim();
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!/^\d{6}$/.test(period)) {
      return res.status(400).json({ message: 'period inválido (usar YYYYMM)' });
    }
    if (!rows.length) {
      return res.json({ message: 'Chunk vacío', period, imported: 0 });
    }
    await ensureAgipPadronTable();
    const byCuit = new Map<string, number>();
    for (const r of rows) {
      const cuit = onlyDigits(r?.cuit).slice(0, 11);
      const alicuota = Number(String(r?.alicuota || '0').replace(',', '.')) || 0;
      if (cuit.length !== 11) continue;
      byCuit.set(cuit, alicuota);
    }
    const entries = Array.from(byCuit.entries());
    if (!entries.length) return res.json({ message: 'Chunk sin CUIT válidos', period, imported: 0 });
    const DB_BATCH = 500;
    for (let i = 0; i < entries.length; i += DB_BATCH) {
      const slice = entries.slice(i, i + DB_BATCH);
      const placeholders = slice.map(() => `(UUID(), ?, ?, ?)`).join(', ');
      const params: any[] = [];
      for (const [cuit, alicuota] of slice) params.push(period, cuit, alicuota);
      await execute(
        `INSERT INTO agip_padron_alicuotas (id, period_yyyymm, cuit, alicuota)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE alicuota = VALUES(alicuota)`,
        params
      );
    }
    return res.json({ message: 'Chunk importado', period, imported: entries.length });
  } catch (error: any) {
    console.error('importAgipPadronChunk:', error);
    const detail = String(error?.sqlMessage || error?.message || '').trim();
    return res.status(500).json({
      message: detail ? `Error importando chunk AGIP: ${detail}` : 'Error importando chunk AGIP'
    });
  }
};

export const importAgipPadron = async (req: Request, res: Response) => {
  try {
    const parsePeriodFromFilename = (nameRaw: string): string => {
      const name = String(nameRaw || '');
      const mMyyyy = name.match(/(\d{2})(\d{4})(?!\d)/); // ej: ...052026.txt
      if (mMyyyy) return `${mMyyyy[2]}${mMyyyy[1]}`;
      const yyyymm = name.match(/(20\d{2})(0[1-9]|1[0-2])(?!\d)/);
      if (yyyymm) return `${yyyymm[1]}${yyyymm[2]}`;
      return '';
    };
    const file = (req as any).file as { buffer?: Buffer; originalname?: string } | undefined;
    const period = String(req.body?.period || parsePeriodFromFilename(file?.originalname || '')).trim();
    let rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if ((!rows || rows.length === 0) && file?.buffer) {
      const content = file.buffer.toString('utf8');
      const parsed: Array<{ cuit: string; alicuota: number }> = [];
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        const cols = line.split(';');
        if (cols.length < 9) continue;
        const cuit = onlyDigits(cols[3]).slice(0, 11);
        if (cuit.length !== 11) continue;
        const a1 = Number(String(cols[7] || '0').replace(',', '.')) || 0;
        const a2 = Number(String(cols[8] || '0').replace(',', '.')) || 0;
        parsed.push({ cuit, alicuota: Math.max(a1, a2) });
      }
      rows = parsed;
    }
    if ((!rows || rows.length === 0) && !file?.buffer) {
      return res.status(400).json({ message: 'Falta el archivo del padrón (campo file).' });
    }
    if (!/^\d{6}$/.test(period)) {
      return res.status(400).json({ message: 'period inválido (usar YYYYMM)' });
    }
    await ensureAgipPadronTable();
    // Deduplicar por CUIT (última alícuota recibida para ese CUIT)
    const byCuit = new Map<string, number>();
    for (const r of rows) {
      const cuit = onlyDigits(r?.cuit).slice(0, 11);
      const alicuota = Number(String(r?.alicuota || '0').replace(',', '.')) || 0;
      if (cuit.length !== 11) continue;
      byCuit.set(cuit, alicuota);
    }

    const entries = Array.from(byCuit.entries());
    /*
     * IMPORTANTE: el pool puede asignar conexiones distintas entre llamadas, así que `START TRANSACTION`
     * por `execute()` (a) falla con ER_UNSUPPORTED_PS porque execute usa prepared statements y
     * (b) aunque funcionara, no garantizaría atomicidad. Tomamos una conexión dedicada.
     */
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`DELETE FROM agip_padron_alicuotas WHERE period_yyyymm = ?`, [period]);

      const CHUNK = 1000;
      for (let i = 0; i < entries.length; i += CHUNK) {
        const slice = entries.slice(i, i + CHUNK);
        const placeholders = slice.map(() => `(UUID(), ?, ?, ?)`).join(', ');
        const params: any[] = [];
        for (const [cuit, alicuota] of slice) {
          params.push(period, cuit, alicuota);
        }
        await conn.query(
          `INSERT INTO agip_padron_alicuotas (id, period_yyyymm, cuit, alicuota)
           VALUES ${placeholders}`,
          params
        );
      }

      await conn.commit();
    } catch (e) {
      try { await conn.rollback(); } catch { /* ignore */ }
      throw e;
    } finally {
      conn.release();
    }
    res.json({ message: 'Padrón AGIP importado', period, imported: entries.length });
  } catch (error: any) {
    console.error('importAgipPadron:', error);
    const detail = String(error?.sqlMessage || error?.message || '').trim();
    res.status(500).json({
      message: detail ? `Error importando padrón AGIP: ${detail}` : 'Error importando padrón AGIP'
    });
  }
};

/** Exporta comprobantes (facturas + NC) de un mes para clientes en Excel y/o lista pegada de CUIT (campo `cuitsList`). */
export const exportBillingByCustomersFile = async (req: Request, res: Response) => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    const month = String(req.body?.month || req.query?.month || '').trim();
    const cuitsListRaw = String(req.body?.cuitsList || '').trim();

    if (!file && !cuitsListRaw) {
      return res.status(400).json({ message: 'Enviá un archivo Excel (campo file) y/o una lista de CUIT (campo cuitsList).' });
    }
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ message: 'month inválido (usar YYYY-MM).' });
    }

    const m = month.match(/^(\d{4})-(\d{2})$/)!;
    const yy = Number(m[1]);
    const mm = Number(m[2]);
    const lastDay = new Date(yy, mm, 0).getDate();
    const fromDate = `${m[1]}-${m[2]}-01`;
    const toDate = `${m[1]}-${m[2]}-${String(lastDay).padStart(2, '0')}`;

    const cuitSet = new Set<string>();
    const nameSet = new Set<string>();
    const norm = (s: any) => normalizeNameForMatch(s);
    const sourceRows: Array<{ sheet: string; row: number; rawName: string; rawCuit: string; nameNorm: string; cuitNorm: string }> = [];
    let invalidPasteCuits: string[] = [];

    if (cuitsListRaw) {
      const parsed = parseCuitsFromText(cuitsListRaw);
      invalidPasteCuits = parsed.invalid;
      let rowNum = 2;
      for (const c of parsed.valid) {
        cuitSet.add(c);
        sourceRows.push({
          sheet: 'Lista CUIT',
          row: rowNum++,
          rawName: '',
          rawCuit: c,
          nameNorm: '',
          cuitNorm: c
        });
      }
    }

    if (file) {
      const wb = XLSX.read(file.buffer, { type: 'buffer' });

      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        if (!ws) continue;
        const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });
        for (let idx = 0; idx < rows.length; idx++) {
          const row = rows[idx];
          const entries = Object.entries(row || {});
          let captured = false;
          let rowName = '';
          let rowCuit = '';
          for (const [k, v] of entries) {
            const key = norm(k);
            const val = String(v ?? '').trim();
            if (!val) continue;
            const extracted = extractCuitCandidates(val);
            for (const cuit of extracted) {
              cuitSet.add(cuit);
              if (!rowCuit) rowCuit = cuit;
            }
            if (key.includes('cuit') || key.includes('cuil') || key.includes('documento')) {
              const d = onlyDigits(val);
              if (d.length === 11) {
                cuitSet.add(d);
                if (!rowCuit) rowCuit = d;
              }
              captured = true;
            }
            if (key.includes('razon') || key.includes('cliente') || key === 'nombre' || key.includes('business')) {
              const n = norm(val);
              if (n.length >= 3) {
                nameSet.add(n);
                if (!rowName) rowName = val;
                captured = true;
              }
            }
          }
          if (!captured) {
            // fallback: si no hay headers claros, tomar celdas como posibles nombres/cuit
            for (const v of Object.values(row || {})) {
              const val = String(v ?? '').trim();
              if (!val) continue;
              const extracted = extractCuitCandidates(val);
              for (const cuit of extracted) {
                cuitSet.add(cuit);
                if (!rowCuit) rowCuit = cuit;
              }
              const d = onlyDigits(val);
              if (d.length === 11) {
                cuitSet.add(d);
                if (!rowCuit) rowCuit = d;
              }
              const n = norm(val);
              if (n.length >= 4) {
                nameSet.add(n);
                if (!rowName) rowName = val;
              }
            }
          }
          if (rowName || rowCuit) {
            sourceRows.push({
              sheet: sheetName,
              row: idx + 2,
              rawName: rowName,
              rawCuit: rowCuit,
              nameNorm: norm(rowName),
              cuitNorm: onlyDigits(rowCuit).slice(0, 11)
            });
          } else {
            // último fallback: fila completa como texto
            const joined = Object.values(row || {}).map((x) => String(x ?? '').trim()).filter(Boolean).join(' ');
            const n = norm(joined);
            const d = onlyDigits(joined).slice(0, 11);
            if (n || d) {
              sourceRows.push({
                sheet: sheetName,
                row: idx + 2,
                rawName: joined,
                rawCuit: d,
                nameNorm: n,
                cuitNorm: d
              });
            }
          }
        }
      }
    }

    if (cuitSet.size === 0 && nameSet.size === 0) {
      return res.status(400).json({
        message:
          'No se encontraron CUIT válidos (11 dígitos) ni nombres de clientes en el archivo ni en la lista pegada.'
      });
    }

    const customerIds = new Set<string>();
    const matchedCuits = new Set<string>();
    const matchedNames = new Set<string>();
    const foundByCuit = new Map<string, string[]>();
    const foundByName = new Map<string, string[]>();
    if (cuitSet.size > 0) {
      const cuits = Array.from(cuitSet);
      const rowsByCuit = await query(
        `SELECT id,
                COALESCE(business_name, name, '') AS customer_name,
                REPLACE(REPLACE(REPLACE(COALESCE(cuit,''),'-',''),'.',''),' ','') AS cuit_norm
         FROM customers
         WHERE REPLACE(REPLACE(REPLACE(COALESCE(cuit,''),'-',''),'.',''),' ','') IN (${cuits.map(() => '?').join(',')})`,
        cuits
      ) as any[];
      for (const r of rowsByCuit) {
        customerIds.add(String(r.id));
        if (r.cuit_norm) matchedCuits.add(String(r.cuit_norm));
        const key = String(r.cuit_norm || '');
        if (key) {
          const arr = foundByCuit.get(key) || [];
          arr.push(`${String(r.id)} | ${String(r.customer_name || '')}`);
          foundByCuit.set(key, arr);
        }
      }
    }
    if (nameSet.size > 0) {
      const names = Array.from(nameSet).filter((n) => n.length >= 4);
      const customersRows = await query(`SELECT id, business_name, name FROM customers`) as any[];
      const customerPrepared = customersRows.map((r: any) => {
        const bn = norm(r.business_name);
        const cn = norm(r.name);
        const all = `${bn} ${cn}`.trim();
        const tokenSet = new Set(tokensForNameMatch(all));
        return { r, bn, cn, all, tokenSet };
      });

      for (const n of names) {
        const nTokens = tokensForNameMatch(n);
        const nStrongTokens = nTokens.filter((t) => t.length >= 5);
        for (const c of customerPrepared) {
          const byContain =
            (c.bn && (c.bn.includes(n) || n.includes(c.bn))) ||
            (c.cn && (c.cn.includes(n) || n.includes(c.cn)));
          const byToken = nStrongTokens.some((t) => c.tokenSet.has(t));
          if (!byContain && !byToken) continue;
          customerIds.add(String(c.r.id));
          matchedNames.add(n);
          const arr = foundByName.get(n) || [];
          arr.push(`${String(c.r.id)} | ${String(c.r.business_name || c.r.name || '')}`);
          foundByName.set(n, arr);
        }
      }
    }

    const ids = Array.from(customerIds);
    if (ids.length === 0) {
      return res.status(404).json({ message: 'No se encontraron clientes del Excel en la base.' });
    }

    const authUser = (req as any).user;
    const params: any[] = [fromDate, toDate, ...ids];
    let sellerSql = '';
    if (authUser?.role === 'SELLER') {
      sellerSql = ' AND c.seller_id = ? ';
      params.push(authUser.id);
    }

    const rows = await query(
      `
      SELECT
        x.tipo,
        x.fecha,
        x.cliente,
        x.cliente_contacto,
        x.cuit,
        x.cbte_tipo,
        x.punto_venta,
        x.cbte_desde,
        x.cbte_hasta,
        x.importe,
        x.order_id,
        x.cae,
        x.cae_fch_vto,
        x.customer_id
      FROM (
        SELECT
          'FACTURA' AS tipo,
          COALESCE(DATE(i.created_at), o.date) AS fecha,
          c.business_name AS cliente,
          c.name AS cliente_contacto,
          c.cuit,
          i.cbte_tipo,
          i.punto_venta,
          i.cbte_desde,
          i.cbte_hasta,
          ROUND(o.total * 1.21 + COALESCE(i.agip_ret_per, 0), 2) AS importe,
          o.id AS order_id,
          i.cae,
          i.cae_fch_vto,
          c.id AS customer_id
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN customers c ON c.id = o.customer_id
        WHERE o.date >= ? AND o.date <= ?
          AND o.customer_id IN (${ids.map(() => '?').join(',')})
          ${sellerSql}

        UNION ALL

        -- Agrupamos por comprobante AFIP: una NC parcial por ítems = 1 sola fila para el export por cliente.
        SELECT
          'NC' AS tipo,
          COALESCE(DATE(MIN(cn.created_at)), MAX(o.date)) AS fecha,
          c.business_name AS cliente,
          c.name AS cliente_contacto,
          c.cuit,
          cn.cbte_tipo,
          cn.punto_venta,
          cn.cbte_desde,
          cn.cbte_hasta,
          ROUND(SUM(cn.amount_credited) * 1.21, 2) AS importe,
          cn.order_id AS order_id,
          cn.cae,
          cn.cae_fch_vto,
          c.id AS customer_id
        FROM credit_notes cn
        JOIN orders o ON o.id = cn.order_id
        JOIN customers c ON c.id = o.customer_id
        WHERE o.date >= ? AND o.date <= ?
          AND o.customer_id IN (${ids.map(() => '?').join(',')})
          ${sellerSql}
          AND COALESCE(cn.superseded_by_reinvoice, 0) = 0
        GROUP BY cn.cae, cn.punto_venta, cn.cbte_tipo, cn.cbte_desde, cn.cbte_hasta,
                 cn.cae_fch_vto, cn.order_id, c.id, c.business_name, c.name, c.cuit
      ) x
      ORDER BY x.fecha ASC, x.cliente ASC, x.punto_venta ASC, x.cbte_desde ASC
      `,
      [...params, ...params]
    ) as any[];

    const mmParams: any[] = [...ids, fromDate, toDate];
    if (authUser?.role === 'SELLER') {
      mmParams.push(authUser.id);
    }
    const mmRows = (await query(
      `
      SELECT
        e.id AS mm_id,
        e.customer_id,
        e.line_date,
        e.numero,
        e.importe,
        c.business_name AS cliente,
        c.name AS cliente_contacto,
        c.cuit
      FROM customer_multimedia_entries e
      JOIN customers c ON c.id = e.customer_id
      WHERE e.customer_id IN (${ids.map(() => '?').join(',')})
        AND e.line_date >= ? AND e.line_date <= ?
        AND UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'FAC%'
        ${sellerSql}
      `,
      mmParams
    )) as any[];

    const dedupeKeyAfip = (r: any) =>
      [
        normalizeDate(r.fecha),
        String(r.cbte_desde ?? '').trim().toUpperCase(),
        Number(r.importe || 0).toFixed(2),
        String(r.customer_id || '')
      ].join('|');

    const seenKeys = new Set<string>();
    for (const r of rows) {
      seenKeys.add(dedupeKeyAfip(r));
    }

    for (const m of mmRows) {
      const fechaN = normalizeDate(m.line_date);
      const num = String(m.numero || '').trim().toUpperCase();
      const imp = parseMoney(m.importe).toFixed(2);
      const key = [fechaN, num, imp, String(m.customer_id || '')].join('|');
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      rows.push({
        tipo: 'FACTURA',
        fecha: m.line_date,
        cliente: m.cliente,
        cliente_contacto: m.cliente_contacto,
        cuit: m.cuit,
        cbte_tipo: null,
        punto_venta: null,
        cbte_desde: m.numero,
        cbte_hasta: m.numero,
        importe: m.importe,
        order_id: `MM-${m.mm_id}`,
        cae: '',
        cae_fch_vto: '',
        customer_id: m.customer_id,
        origenExport: 'Tango / Multimedias'
      });
    }

    rows.sort((a: any, b: any) => {
      const da = new Date(normalizeDate(a.fecha)).getTime() || 0;
      const db = new Date(normalizeDate(b.fecha)).getTime() || 0;
      if (da !== db) return da - db;
      const ca = String(a.cliente || '').localeCompare(String(b.cliente || ''));
      if (ca !== 0) return ca;
      return String(a.order_id || '').localeCompare(String(b.order_id || ''));
    });

    if (!rows.length) {
      return res.status(400).json({ message: `No hay comprobantes para ${month} de los clientes del archivo.` });
    }

    const data = rows.map((r: any) => ({
      Origen: r.origenExport || 'Sistema (AFIP)',
      Tipo: r.tipo,
      Fecha: normalizeDate(r.fecha),
      Cliente: r.cliente || r.cliente_contacto || '',
      CUIT: r.cuit || '',
      TipoCbte: r.cbte_tipo,
      PuntoVta: r.punto_venta,
      NumeroDesde: r.cbte_desde,
      NumeroHasta: r.cbte_hasta,
      Importe: Number(r.importe || 0),
      PedidoId: r.order_id,
      CAE: r.cae || '',
      CAEVto: r.cae_fch_vto || ''
    }));

    const outWb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(outWb, ws, 'Comprobantes');

    // Hoja de auditoría: cómo matcheó cada fila del archivo
    const encontrados = sourceRows
      .map((r) => {
        const cuitMatches = r.cuitNorm ? (foundByCuit.get(r.cuitNorm) || []) : [];
        const nameMatches = r.nameNorm ? (foundByName.get(r.nameNorm) || []) : [];
        const criterion = cuitMatches.length > 0 ? 'CUIT' : (nameMatches.length > 0 ? 'NOMBRE' : 'NO');
        const dbMatched = cuitMatches.length > 0 ? cuitMatches : nameMatches;
        return {
          Hoja: r.sheet,
          Fila: r.row,
          ClienteArchivo: r.rawName || '',
          CUITArchivo: r.rawCuit || '',
          CriterioMatch: criterion,
          CoincidenciasDB: dbMatched.join(' || ') || ''
        };
      })
      .filter((r) => r.CriterioMatch !== 'NO');
    const wsFound = XLSX.utils.json_to_sheet(
      encontrados.length > 0
        ? encontrados
        : [{ Hoja: '-', Fila: '-', ClienteArchivo: '', CUITArchivo: '', CriterioMatch: 'SIN COINCIDENCIAS', CoincidenciasDB: '' }]
    );
    XLSX.utils.sheet_add_json(
      wsFound,
      [{ TotalEncontrados: encontrados.length }],
      { origin: 'H1' }
    );
    XLSX.utils.book_append_sheet(outWb, wsFound, 'Encontrados');

    if (invalidPasteCuits.length > 0) {
      const wsInv = XLSX.utils.json_to_sheet(
        invalidPasteCuits.map((v) => {
          const d = onlyDigits(v);
          const motivo =
            d.length === 0 ? 'Sin dígitos' : `Tiene ${d.length} dígitos (se esperan 11)`;
          return { ValorIngresado: v, Motivo: motivo };
        })
      );
      XLSX.utils.book_append_sheet(outWb, wsInv, 'CUIT invalidos');
    }

    // Hoja de control: filas del archivo que no pudieron vincularse a ningún cliente
    const notFound = sourceRows
      .filter((r) => {
        const hasCuit = !!r.cuitNorm;
        const hasName = !!r.nameNorm;
        if (!hasCuit && !hasName) return false;
        if (hasCuit && matchedCuits.has(r.cuitNorm)) return false;
        if (hasName && matchedNames.has(r.nameNorm)) return false;
        return true;
      })
      .map((r) => ({
        Hoja: r.sheet,
        Fila: r.row,
        ClienteArchivo: r.rawName || '',
        CUITArchivo: r.rawCuit || '',
        Estado: 'No encontrado en base'
      }));
    const notFoundRows = notFound.length > 0
      ? notFound
      : [{
          Hoja: '-',
          Fila: '-',
          ClienteArchivo: '',
          CUITArchivo: '',
          Estado: 'Sin registros no encontrados para este archivo'
        }];
    const wsNo = XLSX.utils.json_to_sheet(notFoundRows);
    // Bloque resumen arriba para que sea auditable
    XLSX.utils.sheet_add_json(
      wsNo,
      [{
        TotalFilasDetectadasArchivo: sourceRows.length,
        TotalClientesVinculados: ids.length,
        TotalNoEncontrados: notFound.length
      }],
      { origin: 'G1' }
    );
    XLSX.utils.book_append_sheet(outWb, wsNo, 'No encontrados');
    const buffer = XLSX.write(outWb, { type: 'buffer', bookType: 'xlsx' });

    const filename = `comprobantes_${month.replace('-', '')}_clientes_archivo.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (error: any) {
    console.error('exportBillingByCustomersFile:', error);
    return res.status(500).json({ message: 'Error exportando comprobantes por archivo de clientes' });
  }
};

