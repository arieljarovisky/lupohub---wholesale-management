import { Request, Response } from 'express';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { query, execute, get } from '../database/db';
import { v4 as uuidv4 } from 'uuid';
import { padLegacyCode } from '../utils/multimediaHistorialExcel';
import { canonicalizeCityInput } from '../utils/cityNormalize';
import {
  backfillPaymentOrdersFromLegacy,
  SQL_ORDER_IN_SALDO_SCOPE,
  SQL_ORDER_SALDO_RESIDUAL
} from '../services/orderPaymentBalance.service';
import { CARTERA_IMPORTED_MOVEMENTS_AGG_SUBQUERY } from '../sql/carteraImportedSql';

export type CustomerDeliveryAddressDto = { id: string; label: string; address: string; city: string };

function parseDeliveryAddressesFromRow(raw: unknown): CustomerDeliveryAddressDto[] {
  if (raw == null || raw === '') return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw as string) : raw;
    if (!Array.isArray(arr)) return [];
    const out: CustomerDeliveryAddressDto[] = [];
    for (const it of arr) {
      if (!it || typeof it !== 'object') continue;
      const address = String((it as any).address ?? '').trim();
      if (!address) continue;
      const id = String((it as any).id ?? '').trim() || uuidv4();
      out.push({
        id,
        label: (String((it as any).label ?? 'Sucursal').trim() || 'Sucursal') as string,
        address,
        city: canonicalizeCityInput((it as any).city) || '',
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Serializa direcciones de sucursal para `customers.delivery_addresses` (TEXT JSON). */
function normalizeDeliveryAddressesForDb(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  if (!Array.isArray(input)) return null;
  const cleaned: CustomerDeliveryAddressDto[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const address = String((raw as any).address ?? '').trim();
    if (!address) continue;
    const id = String((raw as any).id ?? '').trim() || uuidv4();
    cleaned.push({
      id,
      label: (String((raw as any).label ?? 'Sucursal').trim() || 'Sucursal') as string,
      address,
      city: canonicalizeCityInput((raw as any).city) || '',
    });
  }
  return cleaned.length ? JSON.stringify(cleaned) : null;
}

/** Detecta NC por leyenda en el comprobante (import Tango, texto libre en recibo, etc.). */
function comprobanteIndicaNotaCredito(comp: string | null | undefined): boolean {
  const u = String(comp ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!u) return false;
  if (u.includes('NOTA DE CREDITO')) return true;
  if (u.includes('N/C') || u.includes('N / C')) return true;
  // Comprobantes tipo AFIP: "NC A 00002-00001234", "NC B0002..."
  if (/^NC\s+[ABCM](\s|\d|-)/.test(u) || /\bNC\s+[ABCM]\s*\d/.test(u)) return true;
  return false;
}

/**
 * Texto de columna "Tipo" en exports de saldos (Detalle clientes / Detalle).
 * Prioriza tipo explícito; si el comprobante describe una NC pero el tipo vino como RECIBO/FACTURA, corrige la etiqueta.
 */
function labelTipoSaldoExporter(m: { tipo?: string | null; comprobante?: string | null }): string {
  const tipo = String(m.tipo ?? '').trim();
  const comp = String(m.comprobante ?? '');

  if (tipo === 'NOTA_CREDITO') return 'NOTA DE CREDITO';
  if (tipo === 'NOTA_CREDITO_IMPORTADA') return 'NOTA DE CREDITO (import.)';
  if (tipo === 'NOTA_DEBITO_IMPORTADA') return 'NOTA DE DEBITO (import.)';

  if (comprobanteIndicaNotaCredito(comp)) {
    if (
      tipo === 'RECIBO_IMPORTADO' ||
      tipo === 'FACTURA_IMPORTADA' ||
      tipo === 'MOV_IMPORTADO'
    ) {
      return 'NOTA DE CREDITO (import.)';
    }
    if (tipo === 'RECIBO' || tipo === 'FACTURA') {
      return 'NOTA DE CREDITO';
    }
  }

  if (tipo === 'FACTURA_IMPORTADA') return 'FACTURA';
  if (tipo === 'RECIBO_IMPORTADO') return 'RECIBO';
  if (tipo === 'MOV_IMPORTADO') return 'MOV.';
  return tipo;
}

function parseSellerCommissionPercentage(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

function toCustomer(row: any, transportes?: { id: string; name: string; address?: string }[]) {
  const sellerCommissionPct =
    row.seller_commission_percentage != null ? parseSellerCommissionPercentage(row.seller_commission_percentage) : null;
  return {
    id: row.id,
    sellerId: row.seller_id ?? '',
    sellerCommissionPercentage: sellerCommissionPct ?? undefined,
    userId: row.user_id ?? undefined,
    name: row.name ?? '',
    businessName: row.business_name ?? '',
    email: row.email ?? '',
    address: row.address ?? '',
    city: row.city ?? '',
    cuit: row.cuit ?? undefined,
    phone: row.phone ?? undefined,
    transportNumber: row.transport_number ?? undefined,
    remitoNumber: row.remito_number ?? undefined,
    saleCondition: row.sale_condition ?? undefined,
    condicionIva: row.condicion_iva ?? undefined,
    priceListId: row.price_list_id ?? undefined,
    legacyCode: row.legacy_code ?? undefined,
    accountZone: row.account_zone ?? undefined,
    accountSellerLabel: row.account_seller_label ?? undefined,
    shouldRetainIibb: Number(row.should_retain_iibb || 0) === 1,
    agipPadronPeriod: row.agip_padron_period ?? undefined,
    iibbAlicuota: row.iibb_alicuota != null ? Number(row.iibb_alicuota) : undefined,
    transportes: transportes ?? [],
    deliveryAddresses: parseDeliveryAddressesFromRow(row.delivery_addresses)
  };
}

/** Listar todos los clientes (camelCase para el frontend) con transportes asignados. */
export const getCustomers = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).user;
    const sellerFilter = authUser?.role === 'SELLER' ? ' WHERE seller_id = ?' : '';
    const params = authUser?.role === 'SELLER' ? [authUser.id] : [];
    const agipTable = await get(
      `SELECT COUNT(*) AS cnt FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'agip_padron_alicuotas'`
    );
    const agipExists = Number((agipTable as any)?.cnt || 0) > 0;
    const agipSelect = agipExists
      ? `,
         CASE
           WHEN apc.cuit IS NULL THEN 0
           ELSE 1
         END AS should_retain_iibb,
         apm.period_yyyymm AS agip_padron_period,
         apc.alicuota AS iibb_alicuota`
      : `,
         0 AS should_retain_iibb,
         NULL AS agip_padron_period,
         NULL AS iibb_alicuota`;
    const agipJoin = agipExists
      ? `
       LEFT JOIN (
         SELECT MAX(period_yyyymm) AS period_yyyymm
         FROM agip_padron_alicuotas
       ) apm ON 1=1
       LEFT JOIN agip_padron_alicuotas apc
         ON apc.period_yyyymm = apm.period_yyyymm
        AND apc.cuit = REPLACE(REPLACE(REPLACE(COALESCE(c.cuit, ''), '-', ''), '.', ''), ' ', '')`
      : '';
    const rows = await query(
      `SELECT c.id, c.seller_id, c.seller_commission_percentage, c.user_id, c.name, c.business_name, c.email, c.address, c.city, c.cuit, c.phone, c.transport_number, c.remito_number, c.sale_condition, c.condicion_iva, c.price_list_id,
              c.legacy_code, c.account_zone, c.account_seller_label, c.delivery_addresses
              ${agipSelect}
       FROM customers c
       ${agipJoin}
       ${sellerFilter} ORDER BY c.business_name ASC, c.name ASC`,
      params
    );
    const customers = (rows || []).map((r: any) => toCustomer(r));
    const ids = customers.map((c: any) => c.id);
    if (ids.length === 0) return res.json(customers);
    const placeholders = ids.map(() => '?').join(',');
    const links = await query(
      `SELECT ct.customer_id AS customerId, t.id AS transporteId, t.name AS transporteName, t.address AS transporteAddress
       FROM customer_transportes ct
       JOIN transportes t ON t.id = ct.transporte_id
       WHERE ct.customer_id IN (${placeholders})
       ORDER BY t.name ASC`,
      ids
    );
    const transportesByCustomer: Record<string, { id: string; name: string; address?: string }[]> = {};
    for (const c of customers) transportesByCustomer[c.id] = [];
    for (const link of (links || []) as any[]) {
      const custId = link.customerId;
      if (transportesByCustomer[custId])
        transportesByCustomer[custId].push({ id: link.transporteId, name: link.transporteName ?? link.transporteId, address: link.transporteAddress ?? undefined });
    }
    const result = customers.map((c: any) => ({ ...c, transportes: transportesByCustomer[c.id] ?? [] }));
    res.json(result);
  } catch (error: any) {
    console.error('getCustomers:', error);
    res.status(500).json({ message: 'Error listando clientes' });
  }
};

/** Exportar clientes individuales (1 fila por cliente) en Excel (.xlsx). */
export const exportCustomersIndividualXlsx = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).user;
    const sellerFilter = authUser?.role === 'SELLER' ? ' WHERE c.seller_id = ?' : '';
    const params = authUser?.role === 'SELLER' ? [authUser.id] : [];
    const rows = await query(
      `SELECT
         c.id,
         c.legacy_code,
         c.business_name,
         c.name,
         c.email,
         c.phone,
         c.cuit,
         c.city,
         c.address,
         c.sale_condition,
         c.condicion_iva,
         c.transport_number,
         c.remito_number,
         c.account_zone,
         c.account_seller_label,
         c.seller_id,
         u.name AS seller_name
       FROM customers c
       LEFT JOIN users u ON u.id = c.seller_id
       ${sellerFilter}
       ORDER BY c.business_name ASC, c.name ASC`,
      params
    );

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'LupoHub';
    workbook.created = new Date();
    const ws = workbook.addWorksheet('Clientes');
    ws.columns = [
      { header: 'ID', key: 'id', width: 38 },
      { header: 'Código legacy', key: 'legacy_code', width: 16 },
      { header: 'Razón social', key: 'business_name', width: 34 },
      { header: 'Contacto', key: 'name', width: 28 },
      { header: 'Email', key: 'email', width: 32 },
      { header: 'Teléfono', key: 'phone', width: 18 },
      { header: 'CUIT', key: 'cuit', width: 16 },
      { header: 'Ciudad', key: 'city', width: 20 },
      { header: 'Dirección', key: 'address', width: 32 },
      { header: 'Condición venta', key: 'sale_condition', width: 20 },
      { header: 'Condición IVA', key: 'condicion_iva', width: 20 },
      { header: 'N° transporte', key: 'transport_number', width: 16 },
      { header: 'N° remito', key: 'remito_number', width: 14 },
      { header: 'Zona', key: 'account_zone', width: 18 },
      { header: 'Vendedor habitual', key: 'account_seller_label', width: 28 },
      { header: 'Seller ID', key: 'seller_id', width: 38 },
      { header: 'Seller name', key: 'seller_name', width: 24 }
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    for (const r of rows as any[]) {
      ws.addRow({
        id: r.id ?? '',
        legacy_code: r.legacy_code ?? '',
        business_name: r.business_name ?? '',
        name: r.name ?? '',
        email: r.email ?? '',
        phone: r.phone ?? '',
        cuit: r.cuit ?? '',
        city: r.city ?? '',
        address: r.address ?? '',
        sale_condition: r.sale_condition ?? '',
        condicion_iva: r.condicion_iva ?? '',
        transport_number: r.transport_number ?? '',
        remito_number: r.remito_number ?? '',
        account_zone: r.account_zone ?? '',
        account_seller_label: r.account_seller_label ?? '',
        seller_id: r.seller_id ?? '',
        seller_name: r.seller_name ?? ''
      });
    }

    const out = await workbook.xlsx.writeBuffer();
    const buf = Buffer.from(out instanceof ArrayBuffer ? new Uint8Array(out) : new Uint8Array(out as ArrayBufferLike));
    const filename = `clientes_individuales_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buf);
  } catch (error: any) {
    console.error('exportCustomersIndividualXlsx:', error);
    return res.status(500).json({ message: 'Error exportando clientes individuales' });
  }
};

/** Exportar clientes en un Excel con una hoja por cliente. */
export const exportCustomersBySheetsXlsx = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).user;
    const requestedIds = Array.isArray((req.body as any)?.customerIds)
      ? ((req.body as any).customerIds as unknown[])
          .filter((x) => typeof x === 'string' && x.trim().length > 0)
          .map((x) => String(x).trim())
      : [];

    const whereParts: string[] = [];
    const params: any[] = [];
    if (authUser?.role === 'SELLER') {
      whereParts.push('c.seller_id = ?');
      params.push(authUser.id);
    }
    if (requestedIds.length > 0) {
      whereParts.push(`c.id IN (${requestedIds.map(() => '?').join(',')})`);
      params.push(...requestedIds);
    }

    const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
    const rows = await query(
      `SELECT
         c.id,
         c.legacy_code,
         c.business_name,
         c.name,
         c.email,
         c.phone,
         c.cuit,
         c.city,
         c.address,
         c.sale_condition,
         c.condicion_iva,
         c.transport_number,
         c.remito_number,
         c.account_zone,
         c.account_seller_label,
         c.seller_id,
         u.name AS seller_name,
         GROUP_CONCAT(DISTINCT t.name ORDER BY t.name SEPARATOR ', ') AS transportes
       FROM customers c
       LEFT JOIN users u ON u.id = c.seller_id
       LEFT JOIN customer_transportes ct ON ct.customer_id = c.id
       LEFT JOIN transportes t ON t.id = ct.transporte_id
       ${whereSql}
       GROUP BY
         c.id, c.legacy_code, c.business_name, c.name, c.email, c.phone, c.cuit, c.city, c.address,
         c.sale_condition, c.condicion_iva, c.transport_number, c.remito_number,
         c.account_zone, c.account_seller_label, c.seller_id, u.name
       ORDER BY c.business_name ASC, c.name ASC`,
      params
    ) as any[];

    if (!rows.length) {
      return res.status(404).json({ message: 'No hay clientes para exportar' });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'LupoHub';
    workbook.created = new Date();

    const wsSummary = workbook.addWorksheet('Resumen');
    wsSummary.columns = [
      { header: 'Cliente', key: 'cliente', width: 40 },
      { header: 'Contacto', key: 'contacto', width: 28 },
      { header: 'CUIT', key: 'cuit', width: 16 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Vendedor', key: 'vendedor', width: 24 }
    ];
    wsSummary.getRow(1).font = { bold: true };
    wsSummary.views = [{ state: 'frozen', ySplit: 1 }];

    const usedNames = new Set<string>(['Resumen']);
    const uniqueSheetName = (raw: string, fallback: string): string => {
      const baseRaw = (raw || fallback || 'Cliente').replace(/[:\\/?*\[\]]/g, ' ').trim();
      const base = (baseRaw || 'Cliente').slice(0, 31);
      let name = base;
      let i = 2;
      while (usedNames.has(name)) {
        const suffix = ` (${i})`;
        name = base.slice(0, Math.max(1, 31 - suffix.length)) + suffix;
        i++;
      }
      usedNames.add(name);
      return name;
    };

    for (const r of rows) {
      const customerName = String(r.business_name ?? r.name ?? 'Cliente');
      wsSummary.addRow({
        cliente: customerName,
        contacto: r.name ?? '',
        cuit: r.cuit ?? '',
        email: r.email ?? '',
        vendedor: r.seller_name ?? r.seller_id ?? ''
      });

      const ws = workbook.addWorksheet(uniqueSheetName(customerName, String(r.id)));
      ws.columns = [
        { header: 'Campo', key: 'campo', width: 24 },
        { header: 'Valor', key: 'valor', width: 58 }
      ];
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      ws.addRows([
        { campo: 'ID', valor: r.id ?? '' },
        { campo: 'Código legacy', valor: r.legacy_code ?? '' },
        { campo: 'Razón social', valor: r.business_name ?? '' },
        { campo: 'Contacto', valor: r.name ?? '' },
        { campo: 'Email', valor: r.email ?? '' },
        { campo: 'Teléfono', valor: r.phone ?? '' },
        { campo: 'CUIT', valor: r.cuit ?? '' },
        { campo: 'Ciudad', valor: r.city ?? '' },
        { campo: 'Dirección', valor: r.address ?? '' },
        { campo: 'Condición de venta', valor: r.sale_condition ?? '' },
        { campo: 'Condición IVA', valor: r.condicion_iva ?? '' },
        { campo: 'N° transporte', valor: r.transport_number ?? '' },
        { campo: 'N° remito', valor: r.remito_number ?? '' },
        { campo: 'Transportes', valor: r.transportes ?? '' },
        { campo: 'Zona', valor: r.account_zone ?? '' },
        { campo: 'Vendedor habitual', valor: r.account_seller_label ?? '' },
        { campo: 'Seller ID', valor: r.seller_id ?? '' },
        { campo: 'Seller Name', valor: r.seller_name ?? '' }
      ]);

      const customerOrders = await query(
        `SELECT id, date, status, total, payment_status
         FROM orders
         WHERE customer_id = ?
         ORDER BY date DESC, id DESC`,
        [r.id]
      ) as any[];
      const customerBilling = await query(
        `SELECT *
         FROM (
           SELECT
             i.created_at AS fecha,
             'FACTURA' AS tipo,
             CONCAT(
               CASE WHEN i.cbte_tipo = 1 THEN 'A ' WHEN i.cbte_tipo = 6 THEN 'B ' ELSE '' END,
               LPAD(COALESCE(i.punto_venta, 0), 5, '0'),
               '-',
               LPAD(COALESCE(i.cbte_desde, 0), 8, '0')
             ) AS comprobante,
             o.id AS order_id,
             ROUND(COALESCE(o.total, 0) * 1.21, 2) AS importe
           FROM invoices i
           JOIN orders o ON o.id = i.order_id
           WHERE o.customer_id = ?

           UNION ALL

           SELECT
             cn.created_at AS fecha,
             'NC' AS tipo,
             CONCAT(
               CASE WHEN cn.cbte_tipo = 3 THEN 'NC A ' WHEN cn.cbte_tipo = 8 THEN 'NC B ' ELSE 'NC ' END,
               LPAD(COALESCE(cn.punto_venta, 0), 5, '0'),
               '-',
               LPAD(COALESCE(cn.cbte_desde, 0), 8, '0')
             ) AS comprobante,
             cn.order_id AS order_id,
             ROUND(COALESCE(cn.amount_credited, 0) * 1.21, 2) AS importe
           FROM credit_notes cn
           JOIN orders o ON o.id = cn.order_id
           WHERE o.customer_id = ?
         ) b
         ORDER BY b.fecha DESC`,
        [r.id, r.id]
      ) as any[];
      const customerPayments = await query(
        `SELECT date, receipt_number, amount, notes
         FROM payments
         WHERE customer_id = ?
         ORDER BY date DESC, created_at DESC`,
        [r.id]
      ) as any[];

      let rowCursor = ws.rowCount + 2;
      ws.getCell(`A${rowCursor}`).value = 'PEDIDOS';
      ws.getCell(`A${rowCursor}`).font = { bold: true };
      rowCursor += 1;
      ws.getCell(`A${rowCursor}`).value = 'ID';
      ws.getCell(`B${rowCursor}`).value = 'Fecha';
      ws.getCell(`C${rowCursor}`).value = 'Estado';
      ws.getCell(`D${rowCursor}`).value = 'Cobro';
      ws.getCell(`E${rowCursor}`).value = 'Total';
      ws.getRow(rowCursor).font = { bold: true };
      rowCursor += 1;
      for (const o of customerOrders) {
        ws.getCell(`A${rowCursor}`).value = o.id ?? '';
        ws.getCell(`B${rowCursor}`).value = o.date ? new Date(o.date) : null;
        ws.getCell(`C${rowCursor}`).value = o.status ?? '';
        ws.getCell(`D${rowCursor}`).value = o.payment_status ?? '';
        ws.getCell(`E${rowCursor}`).value = Number(o.total || 0);
        rowCursor += 1;
      }

      rowCursor += 1;
      ws.getCell(`A${rowCursor}`).value = 'FACTURAS / NC';
      ws.getCell(`A${rowCursor}`).font = { bold: true };
      rowCursor += 1;
      ws.getCell(`A${rowCursor}`).value = 'Fecha';
      ws.getCell(`B${rowCursor}`).value = 'Tipo';
      ws.getCell(`C${rowCursor}`).value = 'Comprobante';
      ws.getCell(`D${rowCursor}`).value = 'Pedido';
      ws.getCell(`E${rowCursor}`).value = 'Importe';
      ws.getRow(rowCursor).font = { bold: true };
      rowCursor += 1;
      for (const b of customerBilling) {
        ws.getCell(`A${rowCursor}`).value = b.fecha ? new Date(b.fecha) : null;
        ws.getCell(`B${rowCursor}`).value = b.tipo ?? '';
        ws.getCell(`C${rowCursor}`).value = b.comprobante ?? '';
        ws.getCell(`D${rowCursor}`).value = b.order_id ?? '';
        ws.getCell(`E${rowCursor}`).value = Number(b.importe || 0);
        rowCursor += 1;
      }

      rowCursor += 1;
      ws.getCell(`A${rowCursor}`).value = 'RECIBOS';
      ws.getCell(`A${rowCursor}`).font = { bold: true };
      rowCursor += 1;
      ws.getCell(`A${rowCursor}`).value = 'Fecha';
      ws.getCell(`B${rowCursor}`).value = 'Recibo';
      ws.getCell(`C${rowCursor}`).value = 'Importe';
      ws.getCell(`D${rowCursor}`).value = 'Observaciones';
      ws.getRow(rowCursor).font = { bold: true };
      rowCursor += 1;
      for (const p of customerPayments) {
        ws.getCell(`A${rowCursor}`).value = p.date ? new Date(p.date) : null;
        ws.getCell(`B${rowCursor}`).value = p.receipt_number ?? '';
        ws.getCell(`C${rowCursor}`).value = Number(p.amount || 0);
        ws.getCell(`D${rowCursor}`).value = p.notes ?? '';
        rowCursor += 1;
      }

      ws.getColumn('B').numFmt = 'dd/mm/yyyy';
      ws.getColumn('C').numFmt = '#,##0.00';
      ws.getColumn('E').numFmt = '#,##0.00';
    }

    const out = await workbook.xlsx.writeBuffer();
    const buf = Buffer.from(out instanceof ArrayBuffer ? new Uint8Array(out) : new Uint8Array(out as ArrayBufferLike));
    const filename = `clientes_por_hoja_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buf);
  } catch (error: any) {
    console.error('exportCustomersBySheetsXlsx:', error);
    return res.status(500).json({ message: 'Error exportando clientes por hoja' });
  }
};

/** Crear cliente. */
export const createCustomer = async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      id?: string;
      sellerId?: string;
      name?: string;
      businessName?: string;
      email?: string;
      address?: string;
      city?: string;
      cuit?: string;
      phone?: string;
      transportNumber?: string;
      remitoNumber?: string;
      saleCondition?: string;
      condicionIva?: string;
      transporteIds?: string[];
      priceListId?: string;
      legacyCode?: string;
      accountZone?: string;
      accountSellerLabel?: string;
      deliveryAddresses?: unknown[];
      sellerCommissionPercentage?: number | null;
    };
    const name = (body.name ?? '').toString().trim();
    const businessName = (body.businessName ?? '').toString().trim();
    const email = (body.email ?? '').toString().trim();
    if (!businessName && !name) {
      return res.status(400).json({ message: 'Razón social o nombre de contacto es requerido' });
    }
    if (!email) {
      return res.status(400).json({ message: 'El email es requerido' });
    }

    const id = body.id && body.id.trim() ? body.id.trim() : uuidv4();
    const sellerId = body.sellerId?.trim() || null;
    const address = (body.address ?? '').toString().trim() || null;
    const city = canonicalizeCityInput(body.city);
    const cuit = (body.cuit ?? '').toString().trim() || null;
    const phone = (body.phone ?? '').toString().trim() || null;
    const transportNumber = (body.transportNumber ?? '').toString().trim() || null;
    const remitoNumber = (body.remitoNumber ?? '').toString().trim() || null;
    const saleCondition = (body.saleCondition ?? '').toString().trim() || null;
    const condicionIva = (body.condicionIva ?? '').toString().trim() || null;
    const priceListId = body.priceListId?.trim() || null;
    const legacyCode = (body.legacyCode ?? '').toString().trim() || null;
    const accountZone = (body.accountZone ?? '').toString().trim() || null;
    const accountSellerLabel = (body.accountSellerLabel ?? '').toString().trim() || null;
    const deliveryJson = normalizeDeliveryAddressesForDb(body.deliveryAddresses);

    // Guardar nombre de contacto y razón social en columnas separadas:
    // - Si solo se carga razón social, "name" queda NULL y "business_name" tiene el valor.
    // - Si solo se carga nombre de contacto, "business_name" toma ese valor.
    const sqlName = name || null;
    const sqlBusinessName = businessName || name || null;

    const sellerCommissionPct =
      body.sellerCommissionPercentage !== undefined
        ? parseSellerCommissionPercentage(body.sellerCommissionPercentage)
        : null;

    await execute(
      `INSERT INTO customers (id, seller_id, seller_commission_percentage, name, business_name, email, address, city, cuit, phone, transport_number, remito_number, sale_condition, condicion_iva, price_list_id, legacy_code, account_zone, account_seller_label, delivery_addresses)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, sellerId, sellerCommissionPct, sqlName, sqlBusinessName, email, address, city, cuit, phone, transportNumber, remitoNumber, saleCondition, condicionIva, priceListId, legacyCode, accountZone, accountSellerLabel, deliveryJson]
    );

    const created = await get(
      `SELECT id, seller_id, seller_commission_percentage, user_id, name, business_name, email, address, city, cuit, phone, transport_number, remito_number, sale_condition, condicion_iva, price_list_id, legacy_code, account_zone, account_seller_label, delivery_addresses FROM customers WHERE id = ?`,
      [id]
    );
    const transporteIds = Array.isArray(body.transporteIds) ? body.transporteIds.filter((x: string) => x && typeof x === 'string') : [];
    for (const tid of transporteIds) {
      await execute(`INSERT IGNORE INTO customer_transportes (customer_id, transporte_id) VALUES (?, ?)`, [id, tid]);
    }
    const links = await query(
      `SELECT t.id AS transporteId, t.name AS transporteName, t.address AS transporteAddress FROM customer_transportes ct JOIN transportes t ON t.id = ct.transporte_id WHERE ct.customer_id = ? ORDER BY t.name`,
      [id]
    );
    const transportes = (links || []).map((l: any) => ({ id: l.transporteId, name: l.transporteName ?? l.transporteId, address: l.transporteAddress ?? undefined }));
    res.status(201).json(toCustomer(created, transportes));
  } catch (error: any) {
    console.error('createCustomer:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Ya existe un cliente con ese ID' });
    }
    res.status(500).json({ message: 'Error creando cliente' });
  }
};

/** Actualizar cliente (ej. vendedor, razón social, price_list_id, etc.). */
export const updateCustomer = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as {
      name?: string;
      businessName?: string;
      email?: string;
      address?: string;
      city?: string;
      sellerId?: string;
      cuit?: string;
      phone?: string;
      transportNumber?: string;
      remitoNumber?: string;
      saleCondition?: string;
      condicionIva?: string;
      transporteIds?: string[];
      priceListId?: string | null;
      legacyCode?: string;
      accountZone?: string;
      accountSellerLabel?: string;
      deliveryAddresses?: unknown[] | null;
      sellerCommissionPercentage?: number | null;
    };
    const existing = await get('SELECT id FROM customers WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ message: 'Cliente no encontrado' });
    const updates: string[] = [];
    const params: any[] = [];
    if (body.name !== undefined) { updates.push('name = ?'); params.push(body.name.trim()); }
    if (body.businessName !== undefined) { updates.push('business_name = ?'); params.push(body.businessName?.trim() || null); }
    if (body.email !== undefined) { updates.push('email = ?'); params.push(body.email?.trim() || null); }
    if (body.address !== undefined) { updates.push('address = ?'); params.push(body.address?.trim() || null); }
    if (body.city !== undefined) {
      updates.push('city = ?');
      params.push(body.city != null && String(body.city).trim() ? canonicalizeCityInput(body.city) : null);
    }
    if (body.cuit !== undefined) { updates.push('cuit = ?'); params.push(body.cuit?.trim() || null); }
    if (body.phone !== undefined) { updates.push('phone = ?'); params.push(body.phone?.trim() || null); }
    if (body.transportNumber !== undefined) { updates.push('transport_number = ?'); params.push(body.transportNumber?.trim() || null); }
    if (body.remitoNumber !== undefined) { updates.push('remito_number = ?'); params.push(body.remitoNumber?.trim() || null); }
    if (body.saleCondition !== undefined) { updates.push('sale_condition = ?'); params.push(body.saleCondition?.trim() || null); }
    if (body.condicionIva !== undefined) { updates.push('condicion_iva = ?'); params.push(body.condicionIva?.trim() || null); }
    if (body.sellerId !== undefined) { updates.push('seller_id = ?'); params.push(body.sellerId?.trim() || null); }
    if (body.sellerCommissionPercentage !== undefined) {
      const pct = parseSellerCommissionPercentage(body.sellerCommissionPercentage);
      if (body.sellerCommissionPercentage != null && pct === null) {
        return res.status(400).json({ message: 'sellerCommissionPercentage debe estar entre 0 y 100' });
      }
      updates.push('seller_commission_percentage = ?');
      params.push(pct);
    }
    if (body.priceListId !== undefined) { updates.push('price_list_id = ?'); params.push(body.priceListId && body.priceListId.trim() ? body.priceListId.trim() : null); }
    if (body.legacyCode !== undefined) { updates.push('legacy_code = ?'); params.push(body.legacyCode?.trim() || null); }
    if (body.accountZone !== undefined) { updates.push('account_zone = ?'); params.push(body.accountZone?.trim() || null); }
    if (body.accountSellerLabel !== undefined) { updates.push('account_seller_label = ?'); params.push(body.accountSellerLabel?.trim() || null); }
    if (body.deliveryAddresses !== undefined) {
      updates.push('delivery_addresses = ?');
      params.push(normalizeDeliveryAddressesForDb(body.deliveryAddresses));
    }
    if (updates.length > 0) {
      params.push(id);
      await execute(`UPDATE customers SET ${updates.join(', ')} WHERE id = ?`, params);
    }
    if (body.transporteIds !== undefined) {
      await execute(`DELETE FROM customer_transportes WHERE customer_id = ?`, [id]);
      const transporteIds = Array.isArray(body.transporteIds) ? body.transporteIds.filter((x: string) => x && typeof x === 'string') : [];
      for (const tid of transporteIds) {
        await execute(`INSERT IGNORE INTO customer_transportes (customer_id, transporte_id) VALUES (?, ?)`, [id, tid]);
      }
    }
    const updated = await get(
      `SELECT id, seller_id, seller_commission_percentage, user_id, name, business_name, email, address, city, cuit, phone, transport_number, remito_number, sale_condition, condicion_iva, price_list_id, legacy_code, account_zone, account_seller_label, delivery_addresses FROM customers WHERE id = ?`,
      [id]
    );
    const links = await query(
      `SELECT t.id AS transporteId, t.name AS transporteName, t.address AS transporteAddress FROM customer_transportes ct JOIN transportes t ON t.id = ct.transporte_id WHERE ct.customer_id = ? ORDER BY t.name`,
      [id]
    );
    const transportes = (links || []).map((l: any) => ({ id: l.transporteId, name: l.transporteName ?? l.transporteId, address: l.transporteAddress ?? undefined }));
    res.json(toCustomer(updated, transportes));
  } catch (error: any) {
    console.error('updateCustomer:', error);
    res.status(500).json({ message: 'Error actualizando cliente' });
  }
};

/** Crear o vincular usuario de acceso directo a un cliente (rol CUSTOMER). Solo ADMIN. */
export const attachUserToCustomer = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).user;
    if (!authUser || authUser.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Solo administradores pueden asignar usuarios a clientes' });
    }

    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'ID de cliente requerido' });

    const body = req.body as { name?: string; email?: string; password?: string };
    const name = (body.name ?? '').toString().trim();
    const email = (body.email ?? '').toString().trim();
    const password = (body.password ?? '').toString();

    if (!email || !password) {
      return res.status(400).json({ message: 'Email y contraseña son requeridos para crear el usuario del cliente' });
    }

    const existingCustomer = await get(
      'SELECT id, user_id, business_name, name, email FROM customers WHERE id = ?',
      [id]
    );
    if (!existingCustomer) {
      return res.status(404).json({ message: 'Cliente no encontrado' });
    }

    // Si ya tiene user_id asociado, no creamos otro usuario
    if (existingCustomer.user_id) {
      return res.status(400).json({ message: 'Este cliente ya tiene un usuario asignado' });
    }

    // ¿Ya existe un usuario con ese email?
    const existingUser = await get(
      'SELECT id, name, email, role FROM users WHERE email = ?',
      [email]
    );

    let userId: string;
    if (existingUser) {
      // Solo permitimos vincular usuarios de rol CUSTOMER
      if (existingUser.role !== 'CUSTOMER') {
        return res.status(400).json({ message: 'Ya existe un usuario con ese email y no es de tipo CLIENTE' });
      }
      userId = existingUser.id;
    } else {
      // Crear usuario nuevo con rol CUSTOMER
      userId = uuidv4();
      const displayName =
        name ||
        existingCustomer.business_name ||
        existingCustomer.name ||
        email;
      await execute(
        'INSERT INTO users (id, name, email, password, role, commission_percentage) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, displayName, email, password, 'CUSTOMER', 0]
      );
    }

    // Vincular usuario al cliente
    await execute('UPDATE customers SET user_id = ? WHERE id = ?', [userId, id]);

    const updated = await get(
      `SELECT id, seller_id, user_id, name, business_name, email, address, city, cuit, phone, transport_number, remito_number, sale_condition, condicion_iva, price_list_id, legacy_code, account_zone, account_seller_label, delivery_addresses FROM customers WHERE id = ?`,
      [id]
    );
    const links = await query(
      `SELECT t.id AS transporteId, t.name AS transporteName, t.address AS transporteAddress FROM customer_transportes ct JOIN transportes t ON t.id = ct.transporte_id WHERE ct.customer_id = ? ORDER BY t.name`,
      [id]
    );
    const transportes = (links || []).map((l: any) => ({
      id: l.transporteId,
      name: l.transporteName ?? l.transporteId,
      address: l.transporteAddress ?? undefined
    }));

    return res.status(200).json(toCustomer(updated, transportes));
  } catch (error: any) {
    console.error('attachUserToCustomer:', error);
    res.status(500).json({ message: 'Error asignando usuario al cliente', detail: error?.message });
  }
};

/** Eliminar cliente. No se permite si tiene pedidos asociados. */
export const deleteCustomer = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await get('SELECT id FROM customers WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ message: 'Cliente no encontrado' });

    const orderRow = await get('SELECT 1 FROM orders WHERE customer_id = ? LIMIT 1', [id]);
    if (orderRow) {
      return res.status(400).json({
        message: 'No se puede eliminar el cliente porque tiene pedidos asociados. Eliminá o reassigná los pedidos primero.'
      });
    }

    await execute('DELETE FROM customers WHERE id = ?', [id]);
    res.status(204).send();
  } catch (error: any) {
    console.error('deleteCustomer:', error);
    res.status(500).json({ message: 'Error eliminando cliente' });
  }
};

/** Importar clientes en lote. Se exige razón social y CUIT. No duplica por CUIT ni por email. */
export const importCustomers = async (req: Request, res: Response) => {
  try {
    const body = req.body as { customers?: Array<{ name?: string; businessName?: string; email?: string; address?: string; city?: string; cuit?: string; phone?: string; condicionIva?: string }>; sellerId?: string };
    const rows = Array.isArray(body.customers) ? body.customers : [];
    const sellerId = body.sellerId?.trim() || null;
    let created = 0;
    let skipped = 0;
    const errors: { row: number; email?: string; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const name = (r.name ?? '').toString().trim();
      const businessName = (r.businessName ?? '').toString().trim();
      let email = (r.email ?? '').toString().trim();
      const address = (r.address ?? '').toString().trim() || null;
      const city = canonicalizeCityInput(r.city);
      const cuit = (r.cuit ?? '').toString().trim() || null;
      const cuitSolo = (cuit || '').replace(/\D/g, '');
      const phone = (r.phone ?? '').toString().trim() || null;
      const condicionIva = (r.condicionIva ?? '').toString().trim() || null;
      const rowNum = i + 1;

      if (!businessName && !name) {
        errors.push({ row: rowNum, message: 'Falta razón social' });
        continue;
      }
      if (!cuit || !cuitSolo) {
        errors.push({ row: rowNum, message: 'Falta CUIT' });
        continue;
      }

      if (!email) {
        email = `importado-${cuitSolo}@sin-email.local`;
      }

      const existingByCuit = cuit ? await get(`SELECT id FROM customers WHERE cuit = ? LIMIT 1`, [cuit]) : null;
      if (existingByCuit) {
        skipped++;
        continue;
      }
      const existingByEmail = await get(`SELECT id FROM customers WHERE email = ? LIMIT 1`, [email]);
      if (existingByEmail) {
        skipped++;
        continue;
      }

      const id = uuidv4();
      const nameVal = name || businessName;
      const businessNameVal = businessName || name;

      try {
        await execute(
          `INSERT INTO customers (id, seller_id, name, business_name, email, address, city, cuit, phone, condicion_iva, price_list_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, sellerId, nameVal, businessNameVal, email, address, city, cuit, phone, condicionIva, null]
        );
        created++;
      } catch (err: any) {
        if (err.code === 'ER_DUP_ENTRY') {
          skipped++;
        } else {
          errors.push({ row: rowNum, email, message: err.message || 'Error al crear' });
        }
      }
    }

    res.json({ created, skipped, errors });
  } catch (error: any) {
    console.error('importCustomers:', error);
    res.status(500).json({ message: 'Error importando clientes' });
  }
};

/** Actualizar CUIT en lote. Recibe lista con identificador (email o razón social) + CUIT; actualiza solo el campo cuit. */
export const bulkUpdateCuit = async (req: Request, res: Response) => {
  try {
    const body = req.body as { updates?: Array<{ email?: string; businessName?: string; cuit: string; newBusinessName?: string; condicionIva?: string }> };
    const updates = Array.isArray(body.updates) ? body.updates : [];
    let updated = 0;
    let notFound = 0;
    const errors: { row: number; message: string }[] = [];

    for (let i = 0; i < updates.length; i++) {
      const u = updates[i];
      const cuit = (u.cuit ?? '').toString().trim().replace(/\D/g, '').slice(0, 11);
      const email = (u.email ?? '').toString().trim() || null;
      const businessName = (u.businessName ?? '').toString().trim() || null;
      const newBusinessName = (u.newBusinessName ?? '').toString().trim() || null;
      const condicionIva = (u.condicionIva ?? '').toString().trim() || null;

      if (!cuit) {
        errors.push({ row: i + 1, message: 'CUIT vacío' });
        continue;
      }
      if (!email && !businessName) {
        errors.push({ row: i + 1, message: 'Falta email o razón social' });
        continue;
      }

      let customer: any = null;
      if (email) {
        customer = await get('SELECT id FROM customers WHERE LOWER(TRIM(email)) = LOWER(?) LIMIT 1', [email]);
      }
      if (!customer && businessName) {
        customer = await get('SELECT id, business_name, condicion_iva FROM customers WHERE TRIM(business_name) = ? LIMIT 1', [businessName]);
      }
      if (!customer) {
        notFound++;
        continue;
      }

      const setClauses: string[] = ['cuit = ?'];
      const params: any[] = [cuit];
      if (newBusinessName) {
        setClauses.push('business_name = ?');
        params.push(newBusinessName);
      }
      if (condicionIva) {
        setClauses.push('condicion_iva = ?');
        params.push(condicionIva);
      }
      params.push(customer.id);
      await execute(`UPDATE customers SET ${setClauses.join(', ')} WHERE id = ?`, params);
      updated++;
    }

    res.json({ updated, notFound, errors });
  } catch (error: any) {
    console.error('bulkUpdateCuit:', error);
    res.status(500).json({ message: 'Error actualizando CUIT en lote' });
  }
};

function roleCanViewSaldos(role: string | undefined): boolean {
  return role === 'ADMIN' || role === 'SELLER' || role === 'WAREHOUSE' || role === 'DEPOSITO';
}

function parseSaldoNumero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Último saldo de columna en import Multimedia/Tango (arrastre de cuenta). */
/**
 * Pagos cargados por import-seller-commissions (PDF de comisiones): no son cobranza del cliente.
 * Si entran en el saldo, el cliente figura con saldo a favor erróneo.
 */
const SQL_PAYMENT_EXCLUDE_COMMISSION_IMPORT = `(
  COALESCE(p.notes, '') NOT LIKE '%comisión vendedor%'
  AND COALESCE(p.notes, '') NOT LIKE '%comision vendedor%'
)`;
const SQL_PAYMENT_EXCLUDE_COMMISSION_IMPORT_PLAIN = `(
  COALESCE(notes, '') NOT LIKE '%comisión vendedor%'
  AND COALESCE(notes, '') NOT LIKE '%comision vendedor%'
)`;

const CARTERA_MM_LAST_SALDO_SUBQUERY = `
  SELECT
    agg.customer_id,
    CAST(COALESCE(
      (SELECT CAST(e_lo.saldo AS DECIMAL(16,2))
       FROM customer_multimedia_entries e_lo
       WHERE e_lo.customer_id = agg.customer_id
       ORDER BY e_lo.line_order DESC
       LIMIT 1),
      (SELECT CAST(e2.saldo AS DECIMAL(16,2))
       FROM customer_multimedia_entries e2
       WHERE e2.customer_id = agg.customer_id AND e2.saldo IS NOT NULL
       ORDER BY e2.line_order DESC
       LIMIT 1),
      0
    ) AS DECIMAL(16,2)) AS last_saldo
  FROM (
    SELECT customer_id
    FROM customer_multimedia_entries
    GROUP BY customer_id
  ) agg`;

/**
 * Pagos en Facturación que coinciden con un REC importado (se excluyen de pay deduplicado).
 * Si el arrastre importado (last_saldo) es 0, hay que restarlos igual para no quedar en saldo 0.
 */
function sqlCarteraPagosMatchedImportSubquery(sellerScoped: boolean): string {
  const sellerWhere = sellerScoped ? ' AND (p.seller_id = ? OR c2.seller_id = ?)' : '';
  return `
    SELECT d.customer_id, SUM(d.amount) AS total_matched
    FROM (
      SELECT
        p.customer_id,
        ROUND(COALESCE(p.amount, 0), 2) AS amount
      FROM payments p
      ${sellerScoped ? 'INNER JOIN customers c2 ON c2.id = p.customer_id' : ''}
      INNER JOIN (
        SELECT
          e.customer_id,
          DATE(e.line_date) AS line_date,
          ROUND(COALESCE(e.importe, 0), 2) AS amount,
          UPPER(
            REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
          ) AS receipt_norm
        FROM customer_multimedia_entries e
        WHERE UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('REC', 'RECIBO', 'PAGO', 'COBRO', 'INGRESO')
          AND TRIM(COALESCE(e.numero, '')) <> ''
        GROUP BY
          e.customer_id,
          DATE(e.line_date),
          ROUND(COALESCE(e.importe, 0), 2),
          UPPER(
            REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
          )
      ) me_rec
        ON me_rec.customer_id = p.customer_id
       AND me_rec.line_date = DATE(p.date)
       AND me_rec.amount = ROUND(COALESCE(p.amount, 0), 2)
       AND me_rec.receipt_norm = CASE
         WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
         ELSE UPPER(
           REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
         )
       END
      WHERE 1=1${sellerWhere}
        AND ${SQL_PAYMENT_EXCLUDE_COMMISSION_IMPORT}
      GROUP BY
        p.customer_id,
        DATE(p.date),
        ROUND(COALESCE(p.amount, 0), 2),
        CASE
          WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
          ELSE UPPER(
            REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
          )
        END
    ) d
    GROUP BY d.customer_id`;
}

/** REC importados sin pago equivalente en Facturación (solo si last_saldo importado es 0). */
const SQL_CARTERA_MM_REC_SIN_PAGO = `
  SELECT e.customer_id, SUM(ROUND(ABS(COALESCE(e.importe, 0)), 2)) AS total_orphan
  FROM customer_multimedia_entries e
  WHERE UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('REC', 'RECIBO', 'PAGO', 'COBRO', 'INGRESO')
    AND TRIM(COALESCE(e.numero, '')) <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM payments p
      WHERE p.customer_id = e.customer_id
        AND DATE(p.date) = DATE(e.line_date)
        AND ROUND(COALESCE(p.amount, 0), 2) = ROUND(ABS(COALESCE(e.importe, 0)), 2)
        AND ${SQL_PAYMENT_EXCLUDE_COMMISSION_IMPORT}
        AND UPPER(
          REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
        ) = CASE
          WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
          ELSE UPPER(
            REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
          )
        END
    )
  GROUP BY e.customer_id`;

/**
 * Neto gravado del pedido (alias `o`): usa `orders.total` o suma de ítems si el total quedó en 0.
 * Tras picking: pickeado si hay; si no, cantidad pedida (alineado con factura AFIP / NC).
 */
const SQL_ORDER_NETO_GRAVADO = `GREATEST(
  COALESCE(o.total, 0),
  COALESCE((
    SELECT SUM(
      ROUND(
        (
          CASE
            WHEN NOT COALESCE(o.no_stock_impact, 0)
              AND o.status IN ('Falta controlar', 'Controlado', 'Despachado')
            THEN
              CASE
                WHEN COALESCE(oi.picked, 0) > 0 THEN LEAST(COALESCE(oi.quantity, 0), COALESCE(oi.picked, 0))
                ELSE COALESCE(oi.quantity, 0)
              END
            ELSE COALESCE(oi.quantity, 0)
          END
        ) * COALESCE(oi.price_at_moment, 0),
        2
      )
    )
    FROM order_items oi
    WHERE oi.order_id = o.id
  ), 0)
)`;

const SQL_ORDER_CARGO_CON_IVA = `ROUND((${SQL_ORDER_NETO_GRAVADO}) * 1.21, 2)`;

const SQL_ORDER_ACTIVE_COND = `o.status NOT IN ('Cancelado', 'Borrador') AND (o.archived = 0 OR o.archived IS NULL)`;

/** Recibos sin imputar a factura/pedido (el resto se descuenta del cargo de cada pedido). */
const SQL_PAYMENT_UNALLOCATED_COND = `NOT EXISTS (
  SELECT 1 FROM payment_invoices pi WHERE pi.payment_id = p.id
)
AND NOT EXISTS (
  SELECT 1 FROM payment_orders po WHERE po.payment_id = p.id
)
AND TRIM(COALESCE(p.invoice_id, '')) = ''
AND TRIM(COALESCE(p.order_id, '')) = ''`;

/** Saldo = facturas/pedidos (LupoHub + import Tango) − NC − recibos. */
function carteraSaldoSqlExpr(): string {
  return `ROUND(
    COALESCE(ob.facturas_bruto, 0)
    + COALESCE(mfac.manual_fac, 0)
    + COALESCE(imp.import_debe, 0)
    - COALESCE(ncv.nc_iva, 0)
    - COALESCE(mnc.manual_nc, 0)
    - COALESCE(imp.import_nc, 0)
    - COALESCE(pay.total_pagos, 0)
    - COALESCE(imp.import_rec, 0),
    2
  )`;
}

function carteraTotalFacturasSql(): string {
  return `ROUND(
    COALESCE(ob.facturas_bruto, 0) + COALESCE(mfac.manual_fac, 0) + COALESCE(imp.import_debe, 0),
    2
  )`;
}

function carteraTotalNcSql(): string {
  return `ROUND(
    COALESCE(ncv.nc_iva, 0) + COALESCE(mnc.manual_nc, 0) + COALESCE(imp.import_nc, 0),
    2
  )`;
}

function carteraTotalRecibosSql(): string {
  return `ROUND(COALESCE(pay.total_pagos, 0) + COALESCE(imp.import_rec, 0), 2)`;
}

/** Saldos: pedidos con cobro pendiente (IVA 21% sobre neto, neto de NC) menos pagos/recibos en `payments`. */
export const getSaldosPendientes = async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user || !roleCanViewSaldos(user.role)) {
    return res.status(403).json({ message: 'Sin permiso para ver saldos' });
  }
  const sellerFilter = user.role === 'SELLER' ? ' AND c.seller_id = ?' : '';
  const baseParams: any[] = user.role === 'SELLER' ? [user.id] : [];

  const paymentsJoin =
    user.role === 'SELLER'
      ? `LEFT JOIN (
      SELECT p.customer_id, SUM(p.amount) AS total_pagos
      FROM payments p
      INNER JOIN customers c2 ON c2.id = p.customer_id
      WHERE (p.seller_id = ? OR c2.seller_id = ?)
      GROUP BY p.customer_id
    ) pay ON pay.customer_id = t.customerId`
      : `LEFT JOIN (
      SELECT customer_id, SUM(amount) AS total_pagos
      FROM payments
      GROUP BY customer_id
    ) pay ON pay.customer_id = t.customerId`;

  const payParams: any[] = user.role === 'SELLER' ? [user.id, user.id] : [];
  const paramsWithNc = [...baseParams, ...payParams];
  const paramsSimple = [...baseParams, ...payParams];

  const mapRows = (rows: any[]) =>
    rows.map((r) => ({
      customerId: r.customerId,
      businessName: r.businessName ?? '',
      contactName: r.contactName ?? '',
      cuit: r.cuit ?? '',
      city: r.city ?? '',
      email: r.email ?? '',
      saldoPendiente: parseSaldoNumero(r.saldoPendiente),
      totalCargosPendiente: Number(r.totalCargosPendiente) || 0,
      totalPagos: Number(r.totalPagos) || 0,
      pedidosPendientes: Number(r.pedidosPendientes) || 0
    }));

  const sqlWithNc = `
    SELECT
      t.customerId,
      t.businessName,
      t.contactName,
      t.cuit,
      t.city,
      t.email,
      ROUND(t.cargosPendientes - COALESCE(pay.total_pagos, 0), 2) AS saldoPendiente,
      ROUND(t.cargosPendientes, 2) AS totalCargosPendiente,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      t.pedidosPendientes
    FROM (
      SELECT
        c.id AS customerId,
        c.business_name AS businessName,
        c.name AS contactName,
        c.cuit,
        c.city,
        c.email,
        SUM(ROUND(GREATEST(0, (${SQL_ORDER_NETO_GRAVADO}) - COALESCE(cn.cn_total, 0)) * 1.21, 2)) AS cargosPendientes,
        COUNT(DISTINCT o.id) AS pedidosPendientes
      FROM customers c
      INNER JOIN orders o ON o.customer_id = c.id
      LEFT JOIN (
        SELECT order_id, SUM(amount_credited) AS cn_total
        FROM credit_notes
        GROUP BY order_id
      ) cn ON cn.order_id = o.id
      WHERE ${SQL_ORDER_ACTIVE_COND}
        AND ${SQL_ORDER_IN_SALDO_SCOPE}
        AND ${SQL_ORDER_ACTIVE_COND}
        ${sellerFilter}
      GROUP BY c.id, c.business_name, c.name, c.cuit, c.city, c.email
    ) t
    ${paymentsJoin}
    WHERE ABS(ROUND(t.cargosPendientes - COALESCE(pay.total_pagos, 0), 2)) > 0.01
    ORDER BY t.businessName ASC, t.contactName ASC
  `;

  const sqlSimple = `
    SELECT
      t.customerId,
      t.businessName,
      t.contactName,
      t.cuit,
      t.city,
      t.email,
      ROUND(t.cargosPendientes - COALESCE(pay.total_pagos, 0), 2) AS saldoPendiente,
      ROUND(t.cargosPendientes, 2) AS totalCargosPendiente,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      t.pedidosPendientes
    FROM (
      SELECT
        c.id AS customerId,
        c.business_name AS businessName,
        c.name AS contactName,
        c.cuit,
        c.city,
        c.email,
        SUM(${SQL_ORDER_CARGO_CON_IVA}) AS cargosPendientes,
        COUNT(DISTINCT o.id) AS pedidosPendientes
      FROM customers c
      INNER JOIN orders o ON o.customer_id = c.id
      WHERE ${SQL_ORDER_ACTIVE_COND}
        AND ${SQL_ORDER_IN_SALDO_SCOPE}
        AND ${SQL_ORDER_ACTIVE_COND}
        ${sellerFilter}
      GROUP BY c.id, c.business_name, c.name, c.cuit, c.city, c.email
    ) t
    ${paymentsJoin}
    WHERE ABS(ROUND(t.cargosPendientes - COALESCE(pay.total_pagos, 0), 2)) > 0.01
    ORDER BY t.businessName ASC, t.contactName ASC
  `;

  try {
    const rows = await query(sqlWithNc, paramsWithNc);
    return res.json(mapRows(rows as any[]));
  } catch (e: any) {
    console.warn('[saldos] consulta con NC falló, reintentando sin NC:', e?.message);
    try {
      const rows = await query(sqlSimple, paramsSimple);
      return res.json(mapRows(rows as any[]));
    } catch (e2: any) {
      console.error('getSaldosPendientes:', e2);
      return res.status(500).json({ message: 'Error listando saldos pendientes' });
    }
  }
};

/**
 * Cartera unificada por cliente: M + F − NC − P (mismo resultado que antes: F−NC = cargo neto por pedido).
 * M = último saldo cuenta importada (Tango/Multimedias).
 * F = suma de totales de pedidos pendientes × 1,21 (facturas/pedidos, IVA incl.).
 * NC = notas de crédito aplicadas a esos pedidos × 1,21, sin superar el total de cada pedido (LEST(cn_total, o.total)).
 * P = recibos en Facturación (deduplicados vs líneas REC importadas con mismo nº/importe/fecha).
 */
export const getCarteraTotals = async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user || !roleCanViewSaldos(user.role)) {
    return res.status(403).json({ message: 'Sin permiso para ver saldos' });
  }
  await backfillPaymentOrdersFromLegacy();
  const sellerFilter = user.role === 'SELLER' ? ' AND c.seller_id = ?' : '';
  const baseParams: any[] = user.role === 'SELLER' ? [user.id] : [];

  const paymentsSubquery =
    user.role === 'SELLER'
      ? `SELECT d.customer_id, SUM(d.amount) AS total_pagos
         FROM (
           SELECT
             p.customer_id,
             ROUND(COALESCE(p.amount, 0), 2) AS amount,
             CASE
               WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
               ELSE UPPER(
                 REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
               )
             END AS receipt_norm
           FROM payments p
           INNER JOIN customers c2 ON c2.id = p.customer_id
           LEFT JOIN (
             SELECT
               e.customer_id,
               DATE(e.line_date) AS line_date,
               ROUND(COALESCE(e.importe, 0), 2) AS amount,
               UPPER(
                 REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
               ) AS receipt_norm
             FROM customer_multimedia_entries e
             WHERE UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('REC', 'RECIBO', 'PAGO', 'COBRO', 'INGRESO')
               AND TRIM(COALESCE(e.numero, '')) <> ''
             GROUP BY
               e.customer_id,
               DATE(e.line_date),
               ROUND(COALESCE(e.importe, 0), 2),
               UPPER(
                 REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
               )
           ) me_rec
             ON me_rec.customer_id = p.customer_id
            AND me_rec.line_date = DATE(p.date)
            AND me_rec.amount = ROUND(COALESCE(p.amount, 0), 2)
            AND me_rec.receipt_norm = CASE
              WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
              ELSE UPPER(
                REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
              )
            END
           WHERE (p.seller_id = ? OR c2.seller_id = ?)
             AND me_rec.customer_id IS NULL
             AND ${SQL_PAYMENT_UNALLOCATED_COND}
             AND ${SQL_PAYMENT_EXCLUDE_COMMISSION_IMPORT}
           GROUP BY
             p.customer_id,
             DATE(p.date),
             ROUND(COALESCE(p.amount, 0), 2),
             CASE
               WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
               ELSE UPPER(
                 REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
               )
             END
         ) d
         GROUP BY d.customer_id`
      : `SELECT d.customer_id, SUM(d.amount) AS total_pagos
         FROM (
           SELECT
             p.customer_id,
             ROUND(COALESCE(p.amount, 0), 2) AS amount,
             CASE
               WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
               ELSE UPPER(
                 REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
               )
             END AS receipt_norm
           FROM payments p
           LEFT JOIN (
             SELECT
               e.customer_id,
               DATE(e.line_date) AS line_date,
               ROUND(COALESCE(e.importe, 0), 2) AS amount,
               UPPER(
                 REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
               ) AS receipt_norm
             FROM customer_multimedia_entries e
             WHERE UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('REC', 'RECIBO', 'PAGO', 'COBRO', 'INGRESO')
               AND TRIM(COALESCE(e.numero, '')) <> ''
             GROUP BY
               e.customer_id,
               DATE(e.line_date),
               ROUND(COALESCE(e.importe, 0), 2),
               UPPER(
                 REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
               )
           ) me_rec
             ON me_rec.customer_id = p.customer_id
            AND me_rec.line_date = DATE(p.date)
            AND me_rec.amount = ROUND(COALESCE(p.amount, 0), 2)
            AND me_rec.receipt_norm = CASE
              WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
              ELSE UPPER(
                REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
              )
            END
           WHERE me_rec.customer_id IS NULL
             AND ${SQL_PAYMENT_UNALLOCATED_COND}
             AND ${SQL_PAYMENT_EXCLUDE_COMMISSION_IMPORT}
           GROUP BY
             p.customer_id,
             DATE(p.date),
             ROUND(COALESCE(p.amount, 0), 2),
             CASE
               WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
               ELSE UPPER(
                 REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
               )
             END
         ) d
         GROUP BY d.customer_id`;
  const payParams: any[] = user.role === 'SELLER' ? [user.id, user.id] : [];
  const paramsWithNc = [...baseParams, ...payParams];
  const paramsSimple = [...baseParams, ...payParams];
  const saldoExpr = carteraSaldoSqlExpr();

  const sqlWithNc = `
    SELECT
      c.id AS customerId,
      ${carteraTotalFacturasSql()} AS orderCargosPendientes,
      ${carteraTotalNcSql()} AS totalNotasCredito,
      ROUND(COALESCE(imp.import_debe, 0) - COALESCE(imp.import_nc, 0) - COALESCE(imp.import_rec, 0), 2) AS multimediaSaldo,
      ${carteraTotalRecibosSql()} AS totalPagos,
      ${saldoExpr} AS saldoPendienteUnificado
    FROM customers c
    LEFT JOIN (
      SELECT
        o.customer_id,
        SUM(${SQL_ORDER_SALDO_RESIDUAL}) AS facturas_bruto
      FROM orders o
      LEFT JOIN (
        SELECT order_id, SUM(amount_credited) AS cn_total
        FROM credit_notes
        GROUP BY order_id
      ) cn ON cn.order_id = o.id
      WHERE ${SQL_ORDER_ACTIVE_COND}
        AND ${SQL_ORDER_IN_SALDO_SCOPE}
      GROUP BY o.customer_id
    ) ob ON ob.customer_id = c.id
    LEFT JOIN (
      SELECT customer_id, SUM(ROUND(importe_neto + COALESCE(agip_ret_per, 0), 2)) AS manual_fac
      FROM customer_manual_comprobantes
      WHERE tipo = 'FACTURA'
      GROUP BY customer_id
    ) mfac ON mfac.customer_id = c.id
    LEFT JOIN (
      SELECT customer_id, SUM(ROUND(importe_neto, 2)) AS manual_nc
      FROM customer_manual_comprobantes
      WHERE tipo = 'NC'
      GROUP BY customer_id
    ) mnc ON mnc.customer_id = c.id
    LEFT JOIN (
      SELECT
        o.customer_id,
        SUM(ROUND(LEAST(COALESCE(cn.cn_total, 0), (${SQL_ORDER_NETO_GRAVADO})) * 1.21, 2)) AS nc_iva
      FROM orders o
      LEFT JOIN (
        SELECT order_id, SUM(amount_credited) AS cn_total
        FROM credit_notes
        GROUP BY order_id
      ) cn ON cn.order_id = o.id
      WHERE ${SQL_ORDER_ACTIVE_COND}
        AND ${SQL_ORDER_IN_SALDO_SCOPE}
      GROUP BY o.customer_id
    ) ncv ON ncv.customer_id = c.id
    LEFT JOIN (${CARTERA_IMPORTED_MOVEMENTS_AGG_SUBQUERY}) imp ON imp.customer_id = c.id
    LEFT JOIN (${paymentsSubquery}) pay ON pay.customer_id = c.id
    WHERE 1=1 ${sellerFilter}
      AND ABS(${saldoExpr}) > 0.005
    ORDER BY c.business_name ASC, c.name ASC
  `;

  /** Misma lógica que sqlWithNc; reintento si la consulta anterior falla (p. ej. esquema antiguo). */
  const sqlSimple = `
    SELECT
      c.id AS customerId,
      ${carteraTotalFacturasSql()} AS orderCargosPendientes,
      ${carteraTotalNcSql()} AS totalNotasCredito,
      ROUND(COALESCE(imp.import_debe, 0) - COALESCE(imp.import_nc, 0) - COALESCE(imp.import_rec, 0), 2) AS multimediaSaldo,
      ${carteraTotalRecibosSql()} AS totalPagos,
      ${saldoExpr} AS saldoPendienteUnificado
    FROM customers c
    LEFT JOIN (
      SELECT
        o.customer_id,
        SUM(${SQL_ORDER_SALDO_RESIDUAL}) AS facturas_bruto
      FROM orders o
      LEFT JOIN (
        SELECT order_id, SUM(amount_credited) AS cn_total
        FROM credit_notes
        GROUP BY order_id
      ) cn ON cn.order_id = o.id
      WHERE ${SQL_ORDER_ACTIVE_COND}
        AND ${SQL_ORDER_IN_SALDO_SCOPE}
      GROUP BY o.customer_id
    ) ob ON ob.customer_id = c.id
    LEFT JOIN (
      SELECT customer_id, SUM(ROUND(importe_neto + COALESCE(agip_ret_per, 0), 2)) AS manual_fac
      FROM customer_manual_comprobantes
      WHERE tipo = 'FACTURA'
      GROUP BY customer_id
    ) mfac ON mfac.customer_id = c.id
    LEFT JOIN (
      SELECT customer_id, SUM(ROUND(importe_neto, 2)) AS manual_nc
      FROM customer_manual_comprobantes
      WHERE tipo = 'NC'
      GROUP BY customer_id
    ) mnc ON mnc.customer_id = c.id
    LEFT JOIN (
      SELECT
        o.customer_id,
        SUM(ROUND(LEAST(COALESCE(cn.cn_total, 0), (${SQL_ORDER_NETO_GRAVADO})) * 1.21, 2)) AS nc_iva
      FROM orders o
      LEFT JOIN (
        SELECT order_id, SUM(amount_credited) AS cn_total
        FROM credit_notes
        GROUP BY order_id
      ) cn ON cn.order_id = o.id
      WHERE ${SQL_ORDER_ACTIVE_COND}
        AND ${SQL_ORDER_IN_SALDO_SCOPE}
      GROUP BY o.customer_id
    ) ncv ON ncv.customer_id = c.id
    LEFT JOIN (${CARTERA_IMPORTED_MOVEMENTS_AGG_SUBQUERY}) imp ON imp.customer_id = c.id
    LEFT JOIN (${paymentsSubquery}) pay ON pay.customer_id = c.id
    WHERE 1=1 ${sellerFilter}
      AND ABS(${saldoExpr}) > 0.005
    ORDER BY c.business_name ASC, c.name ASC
  `;

  try {
    const rows = await query(sqlWithNc, paramsWithNc);
    return res.json(
      (rows as any[]).map((r) => ({
        customerId: r.customerId,
        orderCargosPendientes: parseSaldoNumero(r.orderCargosPendientes),
        totalNotasCredito: parseSaldoNumero(r.totalNotasCredito),
        multimediaSaldo: parseSaldoNumero(r.multimediaSaldo),
        totalPagos: parseSaldoNumero(r.totalPagos),
        saldoPendienteUnificado: parseSaldoNumero(r.saldoPendienteUnificado)
      }))
    );
  } catch (e: any) {
    console.warn('[cartera-totals] consulta con NC falló, reintentando sin NC:', e?.message);
    try {
      const rows = await query(sqlSimple, paramsSimple);
      return res.json(
        (rows as any[]).map((r) => ({
          customerId: r.customerId,
          orderCargosPendientes: parseSaldoNumero(r.orderCargosPendientes),
          totalNotasCredito: parseSaldoNumero(r.totalNotasCredito),
          multimediaSaldo: parseSaldoNumero(r.multimediaSaldo),
          totalPagos: parseSaldoNumero(r.totalPagos),
          saldoPendienteUnificado: parseSaldoNumero(r.saldoPendienteUnificado)
        }))
      );
    } catch (e2: any) {
      console.error('getCarteraTotals:', e2);
      return res.status(500).json({ message: 'Error listando totales de cartera' });
    }
  }
};

/** Saldo unificado por cliente (misma fórmula que getCarteraTotals), sin filtrar por saldo > 0. */
async function fetchCarteraSaldoUnificadoMap(
  sellerIdFilter: string,
  user: { id: string; role: string }
): Promise<Map<string, number>> {
  await backfillPaymentOrdersFromLegacy();
  const sellerFilter = sellerIdFilter ? ' AND c.seller_id = ?' : user.role === 'SELLER' ? ' AND c.seller_id = ?' : '';
  const baseParams: any[] = sellerIdFilter ? [sellerIdFilter] : user.role === 'SELLER' ? [user.id] : [];
  const sellerScoped = !!sellerIdFilter || user.role === 'SELLER';
  const paymentsSubquery = sellerScoped
    ? `SELECT d.customer_id, SUM(d.amount) AS total_pagos
         FROM (
           SELECT p.customer_id, ROUND(COALESCE(p.amount, 0), 2) AS amount,
             CASE WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
             ELSE UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')) END AS receipt_norm
           FROM payments p
           INNER JOIN customers c2 ON c2.id = p.customer_id
           LEFT JOIN (
             SELECT e.customer_id, DATE(e.line_date) AS line_date, ROUND(COALESCE(e.importe, 0), 2) AS amount,
               UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')) AS receipt_norm
             FROM customer_multimedia_entries e
             WHERE UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('REC', 'RECIBO', 'PAGO', 'COBRO', 'INGRESO') AND TRIM(COALESCE(e.numero, '')) <> ''
             GROUP BY e.customer_id, DATE(e.line_date), ROUND(COALESCE(e.importe, 0), 2),
               UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', ''))
           ) me_rec ON me_rec.customer_id = p.customer_id AND me_rec.line_date = DATE(p.date)
             AND me_rec.amount = ROUND(COALESCE(p.amount, 0), 2)
             AND me_rec.receipt_norm = CASE WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
             ELSE UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')) END
           WHERE (p.seller_id = ? OR c2.seller_id = ?) AND me_rec.customer_id IS NULL
             AND ${SQL_PAYMENT_UNALLOCATED_COND} AND ${SQL_PAYMENT_EXCLUDE_COMMISSION_IMPORT}
           GROUP BY p.customer_id, DATE(p.date), ROUND(COALESCE(p.amount, 0), 2),
             CASE WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
             ELSE UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')) END
         ) d GROUP BY d.customer_id`
    : `SELECT d.customer_id, SUM(d.amount) AS total_pagos
         FROM (
           SELECT p.customer_id, ROUND(COALESCE(p.amount, 0), 2) AS amount,
             CASE WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
             ELSE UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')) END AS receipt_norm
           FROM payments p
           LEFT JOIN (
             SELECT e.customer_id, DATE(e.line_date) AS line_date, ROUND(COALESCE(e.importe, 0), 2) AS amount,
               UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')) AS receipt_norm
             FROM customer_multimedia_entries e
             WHERE UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('REC', 'RECIBO', 'PAGO', 'COBRO', 'INGRESO') AND TRIM(COALESCE(e.numero, '')) <> ''
             GROUP BY e.customer_id, DATE(e.line_date), ROUND(COALESCE(e.importe, 0), 2),
               UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', ''))
           ) me_rec ON me_rec.customer_id = p.customer_id AND me_rec.line_date = DATE(p.date)
             AND me_rec.amount = ROUND(COALESCE(p.amount, 0), 2)
             AND me_rec.receipt_norm = CASE WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
             ELSE UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')) END
           WHERE me_rec.customer_id IS NULL AND ${SQL_PAYMENT_UNALLOCATED_COND} AND ${SQL_PAYMENT_EXCLUDE_COMMISSION_IMPORT}
           GROUP BY p.customer_id, DATE(p.date), ROUND(COALESCE(p.amount, 0), 2),
             CASE WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
             ELSE UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')) END
         ) d GROUP BY d.customer_id`;
  const paySellerId = sellerIdFilter || (user.role === 'SELLER' ? user.id : '');
  const payParams: any[] = sellerScoped ? [paySellerId, paySellerId] : [];
  const params = [...baseParams, ...payParams];
  const saldoExpr = carteraSaldoSqlExpr();
  const sql = `
    SELECT c.id AS customerId, ${saldoExpr} AS saldoPendienteUnificado
    FROM customers c
    LEFT JOIN (
      SELECT o.customer_id, SUM(${SQL_ORDER_SALDO_RESIDUAL}) AS facturas_bruto
      FROM orders o
      LEFT JOIN (SELECT order_id, SUM(amount_credited) AS cn_total FROM credit_notes GROUP BY order_id) cn ON cn.order_id = o.id
      WHERE ${SQL_ORDER_ACTIVE_COND} AND ${SQL_ORDER_IN_SALDO_SCOPE}
      GROUP BY o.customer_id
    ) ob ON ob.customer_id = c.id
    LEFT JOIN (
      SELECT customer_id, SUM(ROUND(importe_neto + COALESCE(agip_ret_per, 0), 2)) AS manual_fac
      FROM customer_manual_comprobantes WHERE tipo = 'FACTURA' GROUP BY customer_id
    ) mfac ON mfac.customer_id = c.id
    LEFT JOIN (
      SELECT customer_id, SUM(ROUND(importe_neto, 2)) AS manual_nc
      FROM customer_manual_comprobantes WHERE tipo = 'NC' GROUP BY customer_id
    ) mnc ON mnc.customer_id = c.id
    LEFT JOIN (
      SELECT o.customer_id,
        SUM(ROUND(LEAST(COALESCE(cn.cn_total, 0), (${SQL_ORDER_NETO_GRAVADO})) * 1.21, 2)) AS nc_iva
      FROM orders o
      LEFT JOIN (SELECT order_id, SUM(amount_credited) AS cn_total FROM credit_notes GROUP BY order_id) cn ON cn.order_id = o.id
      WHERE ${SQL_ORDER_ACTIVE_COND} AND ${SQL_ORDER_IN_SALDO_SCOPE}
      GROUP BY o.customer_id
    ) ncv ON ncv.customer_id = c.id
    LEFT JOIN (${CARTERA_IMPORTED_MOVEMENTS_AGG_SUBQUERY}) imp ON imp.customer_id = c.id
    LEFT JOIN (${paymentsSubquery}) pay ON pay.customer_id = c.id
    WHERE 1=1 ${sellerFilter}
  `;
  const rows = (await query(sql, params)) as Array<{ customerId: string; saldoPendienteUnificado: number }>;
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.customerId, parseSaldoNumero(r.saldoPendienteUnificado));
  return map;
}

/** Exporta saldos pendientes en CSV (UTF-8 con BOM para Excel). */
export const exportSaldosPendientesCsv = async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user || !roleCanViewSaldos(user.role)) {
    return res.status(403).json({ message: 'Sin permiso para exportar saldos' });
  }
  const sellerFilter = user.role === 'SELLER' ? ' AND c.seller_id = ?' : '';
  const baseParams: any[] = user.role === 'SELLER' ? [user.id] : [];
  const paymentsJoin =
    user.role === 'SELLER'
      ? `LEFT JOIN (
      SELECT d.customer_id, SUM(d.amount) AS total_pagos
      FROM (
        SELECT
          p.customer_id,
          ROUND(COALESCE(p.amount, 0), 2) AS amount,
          CASE
            WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
            ELSE UPPER(
              REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
            )
          END AS receipt_norm,
          DATE(p.date) AS pay_date
        FROM payments p
        INNER JOIN customers c2 ON c2.id = p.customer_id
        WHERE (p.seller_id = ? OR c2.seller_id = ?)
        GROUP BY
          p.customer_id,
          DATE(p.date),
          ROUND(COALESCE(p.amount, 0), 2),
          CASE
            WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
            ELSE UPPER(
              REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
            )
          END
      ) d
      GROUP BY d.customer_id
    ) pay ON pay.customer_id = t.customerId`
      : `LEFT JOIN (
      SELECT d.customer_id, SUM(d.amount) AS total_pagos
      FROM (
        SELECT
          p.customer_id,
          ROUND(COALESCE(p.amount, 0), 2) AS amount,
          CASE
            WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
            ELSE UPPER(
              REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
            )
          END AS receipt_norm,
          DATE(p.date) AS pay_date
        FROM payments p
        GROUP BY
          p.customer_id,
          DATE(p.date),
          ROUND(COALESCE(p.amount, 0), 2),
          CASE
            WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
            ELSE UPPER(
              REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
            )
          END
      ) d
      GROUP BY d.customer_id
    ) pay ON pay.customer_id = t.customerId`;
  const payParams: any[] = user.role === 'SELLER' ? [user.id, user.id] : [];
  const paramsWithNc = [...baseParams, ...payParams];
  const paramsSimple = [...baseParams, ...payParams];

  const sqlWithNc = `
    SELECT
      t.customerId,
      t.businessName,
      t.contactName,
      t.cuit,
      t.city,
      t.email,
      ROUND(t.cargosPendientes - COALESCE(pay.total_pagos, 0), 2) AS saldoPendiente,
      ROUND(t.cargosPendientes, 2) AS totalCargosPendiente,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      t.pedidosPendientes
    FROM (
      SELECT
        c.id AS customerId,
        c.business_name AS businessName,
        c.name AS contactName,
        c.cuit,
        c.city,
        c.email,
        SUM(ROUND(GREATEST(0, (${SQL_ORDER_NETO_GRAVADO}) - COALESCE(cn.cn_total, 0)) * 1.21, 2)) AS cargosPendientes,
        COUNT(DISTINCT o.id) AS pedidosPendientes
      FROM customers c
      INNER JOIN orders o ON o.customer_id = c.id
      LEFT JOIN (
        SELECT order_id, SUM(amount_credited) AS cn_total
        FROM credit_notes
        GROUP BY order_id
      ) cn ON cn.order_id = o.id
      WHERE ${SQL_ORDER_ACTIVE_COND}
        AND ${SQL_ORDER_IN_SALDO_SCOPE}
        AND ${SQL_ORDER_ACTIVE_COND}
        ${sellerFilter}
      GROUP BY c.id, c.business_name, c.name, c.cuit, c.city, c.email
    ) t
    ${paymentsJoin}
    WHERE ABS(ROUND(t.cargosPendientes - COALESCE(pay.total_pagos, 0), 2)) > 0.01
    ORDER BY t.businessName ASC, t.contactName ASC
  `;

  const sqlSimple = `
    SELECT
      t.customerId,
      t.businessName,
      t.contactName,
      t.cuit,
      t.city,
      t.email,
      ROUND(t.cargosPendientes - COALESCE(pay.total_pagos, 0), 2) AS saldoPendiente,
      ROUND(t.cargosPendientes, 2) AS totalCargosPendiente,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      t.pedidosPendientes
    FROM (
      SELECT
        c.id AS customerId,
        c.business_name AS businessName,
        c.name AS contactName,
        c.cuit,
        c.city,
        c.email,
        SUM(${SQL_ORDER_CARGO_CON_IVA}) AS cargosPendientes,
        COUNT(DISTINCT o.id) AS pedidosPendientes
      FROM customers c
      INNER JOIN orders o ON o.customer_id = c.id
      WHERE ${SQL_ORDER_ACTIVE_COND}
        AND ${SQL_ORDER_IN_SALDO_SCOPE}
        AND ${SQL_ORDER_ACTIVE_COND}
        ${sellerFilter}
      GROUP BY c.id, c.business_name, c.name, c.cuit, c.city, c.email
    ) t
    ${paymentsJoin}
    WHERE ABS(ROUND(t.cargosPendientes - COALESCE(pay.total_pagos, 0), 2)) > 0.01
    ORDER BY t.businessName ASC, t.contactName ASC
  `;

  let rows: any[];
  try {
    rows = (await query(sqlWithNc, paramsWithNc)) as any[];
  } catch {
    rows = (await query(sqlSimple, paramsSimple)) as any[];
  }

  const header = [
    'id_cliente',
    'razon_social',
    'contacto',
    'cuit',
    'ciudad',
    'email',
    'pedidos_impagos',
    'total_cargos_iva',
    'pagos_registrados',
    'saldo_pendiente'
  ];
  const lines = [header.join(';')];
  for (const r of rows) {
    const esc = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    lines.push(
      [
        r.customerId,
        esc(r.businessName ?? ''),
        esc(r.contactName ?? ''),
        r.cuit ?? '',
        esc(r.city ?? ''),
        esc(r.email ?? ''),
        Number(r.pedidosPendientes) || 0,
        (Number(r.totalCargosPendiente) || 0).toFixed(2).replace('.', ','),
        (Number(r.totalPagos) || 0).toFixed(2).replace('.', ','),
        (Number(r.saldoPendiente) || 0).toFixed(2).replace('.', ',')
      ].join(';')
    );
  }
  const csv = lines.join('\r\n');
  const filename = `saldos_pendientes_${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + csv);
};

/**
 * Exporta saldos pendientes con detalle de movimientos (facturas/NC/recibos) en Excel.
 * Hoja 1: resumen por cliente + vendedor.
 * Hoja 2: detalle de comprobantes y recibos por cliente.
 */
export const exportSaldosPendientesDetalleXlsx = async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user || !roleCanViewSaldos(user.role)) {
    return res.status(403).json({ message: 'Sin permiso para exportar saldos' });
  }

  try {
    const sellerWhere = user.role === 'SELLER' ? 'WHERE c.seller_id = ?' : '';
    const sellerParams: any[] = user.role === 'SELLER' ? [user.id] : [];

    const movements = await query(
      `
      SELECT
        m.customer_id,
        m.customer_name,
        m.seller_id,
        m.seller_name,
        m.fecha,
        m.tipo,
        m.comprobante,
        m.order_id,
        m.debe,
        m.haber
      FROM (
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          COALESCE(i.created_at, o.date) AS fecha,
          'FACTURA' AS tipo,
          CONCAT(
            CASE
              WHEN i.cbte_tipo = 1 THEN 'A '
              WHEN i.cbte_tipo = 6 THEN 'B '
              ELSE ''
            END,
            LPAD(COALESCE(i.punto_venta, 0), 5, '0'),
            '-',
            LPAD(COALESCE(i.cbte_desde, 0), 8, '0')
          ) AS comprobante,
          o.id AS order_id,
          ROUND(COALESCE(o.total, 0) * 1.21, 2) AS debe,
          0 AS haber
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN users u ON u.id = c.seller_id

        UNION ALL

        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          COALESCE(cn.created_at, inv.created_at, o.date) AS fecha,
          'NOTA_CREDITO' AS tipo,
          CONCAT(
            CASE
              WHEN cn.cbte_tipo = 3 THEN 'NC A '
              WHEN cn.cbte_tipo = 8 THEN 'NC B '
              WHEN cn.cbte_tipo = 13 THEN 'NC C '
              ELSE 'NC '
            END,
            LPAD(COALESCE(cn.punto_venta, 0), 5, '0'),
            '-',
            LPAD(COALESCE(cn.cbte_desde, 0), 8, '0')
          ) AS comprobante,
          cn.order_id AS order_id,
          0 AS debe,
          ROUND(COALESCE(cn.amount_credited, 0) * 1.21, 2) AS haber
        FROM credit_notes cn
        JOIN orders o ON o.id = cn.order_id
        LEFT JOIN invoices inv ON inv.id = cn.invoice_id
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN users u ON u.id = c.seller_id

        UNION ALL

        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          COALESCE(ecn.created_at, ei.created_at) AS fecha,
          'NOTA_CREDITO' AS tipo,
          CONCAT(
            CASE
              WHEN ecn.cbte_tipo = 3 THEN 'NC A '
              WHEN ecn.cbte_tipo = 8 THEN 'NC B '
              WHEN ecn.cbte_tipo = 13 THEN 'NC C '
              ELSE 'NC '
            END,
            LPAD(COALESCE(ecn.punto_venta, 0), 5, '0'),
            '-',
            LPAD(COALESCE(ecn.cbte_desde, 0), 8, '0')
          ) AS comprobante,
          ecn.external_order_id AS order_id,
          0 AS debe,
          ROUND(COALESCE(ecn.amount_credited, 0) * 1.21, 2) AS haber
        FROM external_credit_notes ecn
        JOIN external_invoices ei ON ei.id = ecn.external_invoice_id
        JOIN customers c
          ON REPLACE(REPLACE(REPLACE(COALESCE(c.cuit, ''), '-', ''), '.', ''), ' ', '') =
             REPLACE(REPLACE(REPLACE(COALESCE(ei.customer_cuit, ''), '-', ''), '.', ''), ' ', '')
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE REPLACE(REPLACE(REPLACE(COALESCE(ei.customer_cuit, ''), '-', ''), '.', ''), ' ', '') <> ''

        UNION ALL

        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          e.line_date AS fecha,
          'NOTA_CREDITO_IMPORTADA' AS tipo,
          COALESCE(NULLIF(TRIM(e.numero), ''), 'NC importada') AS comprobante,
          NULL AS order_id,
          0 AS debe,
          ROUND(ABS(COALESCE(e.importe, 0)), 2) AS haber
        FROM customer_multimedia_entries e
        JOIN customers c ON c.id = e.customer_id
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE (
          UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('NC', 'N/C', 'NOTA CREDITO', 'NOTA DE CREDITO', 'NOTA DE CRÉDITO')
          OR UPPER(COALESCE(e.detalle, '')) LIKE '%NOTA%CREDITO%'
          OR UPPER(COALESCE(e.detalle, '')) LIKE '%NOTA%CRÉDITO%'
          OR UPPER(COALESCE(e.detalle, '')) LIKE '%N/C%'
        )

        UNION ALL

        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          p.date AS fecha,
          'RECIBO' AS tipo,
          p.receipt_number AS comprobante,
          p.order_id AS order_id,
          0 AS debe,
          ROUND(COALESCE(p.amount, 0), 2) AS haber
        FROM payments p
        JOIN customers c ON c.id = p.customer_id
        LEFT JOIN users u ON u.id = c.seller_id
      ) m
      ${user.role === 'SELLER' ? 'WHERE m.seller_id = ?' : ''}
      ORDER BY m.customer_name ASC, m.fecha ASC, m.tipo ASC
      `,
      sellerParams
    ) as Array<{
      customer_id: string;
      customer_name: string;
      seller_id: string | null;
      seller_name: string | null;
      fecha: string;
      tipo: 'FACTURA' | 'NOTA_CREDITO' | 'NOTA_CREDITO_IMPORTADA' | 'RECIBO';
      comprobante: string;
      order_id: string | null;
      debe: number;
      haber: number;
    }>;

    const customers = await query(
      `SELECT c.id, COALESCE(c.business_name, c.name, 'Cliente') AS customer_name, c.seller_id, u.name AS seller_name
       FROM customers c
       LEFT JOIN users u ON u.id = c.seller_id
       ${sellerWhere}
       ORDER BY customer_name ASC`,
      sellerParams
    ) as Array<{ id: string; customer_name: string; seller_id: string | null; seller_name: string | null }>;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'LupoHub';
    workbook.created = new Date();

    const wsSummary = workbook.addWorksheet('Resumen');
    wsSummary.columns = [
      { header: 'Cliente', key: 'cliente', width: 40 },
      { header: 'Vendedor', key: 'vendedor', width: 28 },
      { header: 'Total Facturas', key: 'facturas', width: 16 },
      { header: 'Total NC', key: 'nc', width: 14 },
      { header: 'Total Recibos', key: 'recibos', width: 16 },
      { header: 'Saldo Pendiente', key: 'saldo', width: 18 }
    ];

    const wsDetail = workbook.addWorksheet('Detalle');
    wsDetail.columns = [
      { header: 'Cliente', key: 'cliente', width: 40 },
      { header: 'Vendedor', key: 'vendedor', width: 28 },
      { header: 'Fecha', key: 'fecha', width: 14 },
      { header: 'Tipo', key: 'tipo', width: 14 },
      { header: 'Comprobante', key: 'comprobante', width: 24 },
      { header: 'Pedido', key: 'pedido', width: 16 },
      { header: 'Debe', key: 'debe', width: 14 },
      { header: 'Haber', key: 'haber', width: 14 },
      { header: 'Saldo Cliente', key: 'saldo', width: 16 }
    ];

    const byCustomer = new Map<string, typeof movements>();
    for (const m of movements) {
      if (!byCustomer.has(m.customer_id)) byCustomer.set(m.customer_id, []);
      byCustomer.get(m.customer_id)!.push(m);
    }

    for (const c of customers) {
      const movs = byCustomer.get(c.id) || [];
      let totalFacturas = 0;
      let totalNc = 0;
      let totalRecibos = 0;
      let running = 0;

      for (const m of movs) {
        const debe = Number(m.debe || 0);
        const haber = Number(m.haber || 0);
        running = Math.round((running + debe - haber) * 100) / 100;

        if (m.tipo === 'FACTURA') totalFacturas += debe;
        else if (m.tipo === 'NOTA_CREDITO' || m.tipo === 'NOTA_CREDITO_IMPORTADA') totalNc += haber;
        else if (
          comprobanteIndicaNotaCredito(String(m.comprobante ?? '')) &&
          Number(m.haber || 0) > 0.001 &&
          Number(m.debe || 0) <= 0.001
        ) {
          totalNc += haber;
        } else totalRecibos += haber;

        wsDetail.addRow({
          cliente: c.customer_name,
          vendedor: c.seller_name ?? c.seller_id ?? '',
          fecha: m.fecha ? new Date(m.fecha) : null,
          tipo: labelTipoSaldoExporter(m),
          comprobante: m.comprobante,
          pedido: m.order_id ?? '',
          debe,
          haber,
          saldo: running
        });
      }

      const saldoPendiente = Math.round(running * 100) / 100;
      if (Math.abs(saldoPendiente) > 0.01) {
        wsSummary.addRow({
          cliente: c.customer_name,
          vendedor: c.seller_name ?? c.seller_id ?? '',
          facturas: totalFacturas,
          nc: totalNc,
          recibos: totalRecibos,
          saldo: saldoPendiente
        });
      }
    }

    const moneyColsSummary = ['C', 'D', 'E', 'F'];
    for (const col of moneyColsSummary) wsSummary.getColumn(col).numFmt = '#,##0.00';
    wsSummary.getRow(1).font = { bold: true };
    wsSummary.views = [{ state: 'frozen', ySplit: 1 }];

    wsDetail.getColumn('C').numFmt = 'dd/mm/yyyy';
    wsDetail.getColumn('G').numFmt = '#,##0.00';
    wsDetail.getColumn('H').numFmt = '#,##0.00';
    wsDetail.getColumn('I').numFmt = '#,##0.00';
    wsDetail.getRow(1).font = { bold: true };
    wsDetail.views = [{ state: 'frozen', ySplit: 1 }];

    const out = await workbook.xlsx.writeBuffer();
    const buf = Buffer.from(out instanceof ArrayBuffer ? new Uint8Array(out) : new Uint8Array(out as ArrayBufferLike));
    const filename = `saldos_pendientes_detalle_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buf);
  } catch (error: any) {
    console.error('exportSaldosPendientesDetalleXlsx:', error);
    return res.status(500).json({ message: 'Error exportando saldos pendientes detallados' });
  }
};

/**
 * Excel con movimientos cargados solo en LupoHub: facturas AFIP, notas de crédito y recibos.
 * Excluye importaciones Multimedia/Tango y comprobantes externos por CUIT.
 */
export const exportSaldosMovimientosSistemaXlsx = async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user || !roleCanViewSaldos(user.role)) {
    return res.status(403).json({ message: 'Sin permiso para exportar saldos' });
  }

  try {
    const sellerWhere = user.role === 'SELLER' ? 'WHERE c.seller_id = ?' : '';
    const sellerParams: any[] = user.role === 'SELLER' ? [user.id] : [];

    const movements = await query(
      `
      SELECT
        m.customer_id,
        m.customer_name,
        m.seller_id,
        m.seller_name,
        m.fecha,
        m.tipo,
        m.comprobante,
        m.order_id,
        m.debe,
        m.haber
      FROM (
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          COALESCE(i.created_at, o.date) AS fecha,
          'FACTURA' AS tipo,
          CONCAT(
            CASE
              WHEN i.cbte_tipo = 1 THEN 'A '
              WHEN i.cbte_tipo = 6 THEN 'B '
              ELSE ''
            END,
            LPAD(COALESCE(i.punto_venta, 0), 5, '0'),
            '-',
            LPAD(COALESCE(i.cbte_desde, 0), 8, '0')
          ) AS comprobante,
          o.id AS order_id,
          ROUND(COALESCE(o.total, 0) * 1.21, 2) AS debe,
          0 AS haber
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN users u ON u.id = c.seller_id

        UNION ALL

        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          COALESCE(cn.created_at, inv.created_at, o.date) AS fecha,
          'NOTA_CREDITO' AS tipo,
          CONCAT(
            CASE
              WHEN cn.cbte_tipo = 3 THEN 'NC A '
              WHEN cn.cbte_tipo = 8 THEN 'NC B '
              WHEN cn.cbte_tipo = 13 THEN 'NC C '
              ELSE 'NC '
            END,
            LPAD(COALESCE(cn.punto_venta, 0), 5, '0'),
            '-',
            LPAD(COALESCE(cn.cbte_desde, 0), 8, '0')
          ) AS comprobante,
          cn.order_id AS order_id,
          0 AS debe,
          ROUND(COALESCE(cn.amount_credited, 0) * 1.21, 2) AS haber
        FROM credit_notes cn
        JOIN orders o ON o.id = cn.order_id
        LEFT JOIN invoices inv ON inv.id = cn.invoice_id
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN users u ON u.id = c.seller_id

        UNION ALL

        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          p.date AS fecha,
          'RECIBO' AS tipo,
          p.receipt_number AS comprobante,
          p.order_id AS order_id,
          0 AS debe,
          ROUND(COALESCE(p.amount, 0), 2) AS haber
        FROM payments p
        JOIN customers c ON c.id = p.customer_id
        LEFT JOIN users u ON u.id = c.seller_id
      ) m
      ${user.role === 'SELLER' ? 'WHERE m.seller_id = ?' : ''}
      ORDER BY m.customer_name ASC, m.fecha ASC, m.tipo ASC
      `,
      sellerParams
    ) as Array<{
      customer_id: string;
      customer_name: string;
      seller_id: string | null;
      seller_name: string | null;
      fecha: string;
      tipo: 'FACTURA' | 'NOTA_CREDITO' | 'RECIBO';
      comprobante: string;
      order_id: string | null;
      debe: number;
      haber: number;
    }>;

    const customers = await query(
      `SELECT c.id, COALESCE(c.business_name, c.name, 'Cliente') AS customer_name, c.seller_id, u.name AS seller_name
       FROM customers c
       LEFT JOIN users u ON u.id = c.seller_id
       ${sellerWhere}
       ORDER BY customer_name ASC`,
      sellerParams
    ) as Array<{ id: string; customer_name: string; seller_id: string | null; seller_name: string | null }>;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'LupoHub';
    workbook.created = new Date();

    const wsSummary = workbook.addWorksheet('Resumen');
    wsSummary.columns = [
      { header: 'Cliente', key: 'cliente', width: 40 },
      { header: 'Vendedor', key: 'vendedor', width: 28 },
      { header: 'Total Facturas', key: 'facturas', width: 16 },
      { header: 'Total NC', key: 'nc', width: 14 },
      { header: 'Total Recibos', key: 'recibos', width: 16 },
      { header: 'Saldo Pendiente', key: 'saldo', width: 18 }
    ];

    const wsDetail = workbook.addWorksheet('Detalle');
    wsDetail.columns = [
      { header: 'Cliente', key: 'cliente', width: 40 },
      { header: 'Vendedor', key: 'vendedor', width: 28 },
      { header: 'Fecha', key: 'fecha', width: 14 },
      { header: 'Tipo', key: 'tipo', width: 22 },
      { header: 'Comprobante', key: 'comprobante', width: 24 },
      { header: 'Pedido', key: 'pedido', width: 16 },
      { header: 'Debe', key: 'debe', width: 14 },
      { header: 'Haber', key: 'haber', width: 14 },
      { header: 'Saldo Cliente', key: 'saldo', width: 16 }
    ];

    const byCustomer = new Map<string, typeof movements>();
    for (const m of movements) {
      if (!byCustomer.has(m.customer_id)) byCustomer.set(m.customer_id, []);
      byCustomer.get(m.customer_id)!.push(m);
    }

    for (const c of customers) {
      const movs = byCustomer.get(c.id) || [];
      let totalFacturas = 0;
      let totalNc = 0;
      let totalRecibos = 0;
      let running = 0;

      for (const m of movs) {
        const debe = Number(m.debe || 0);
        const haber = Number(m.haber || 0);
        running = Math.round((running + debe - haber) * 100) / 100;

        if (m.tipo === 'FACTURA') totalFacturas += debe;
        else if (m.tipo === 'NOTA_CREDITO') totalNc += haber;
        else if (
          comprobanteIndicaNotaCredito(String(m.comprobante ?? '')) &&
          Number(m.haber || 0) > 0.001 &&
          Number(m.debe || 0) <= 0.001
        ) {
          totalNc += haber;
        } else totalRecibos += haber;

        wsDetail.addRow({
          cliente: c.customer_name,
          vendedor: c.seller_name ?? c.seller_id ?? '',
          fecha: m.fecha ? new Date(m.fecha) : null,
          tipo: labelTipoSaldoExporter(m),
          comprobante: m.comprobante,
          pedido: m.order_id ?? '',
          debe,
          haber,
          saldo: running
        });
      }

      const saldoPendiente = Math.round(running * 100) / 100;
      if (Math.abs(saldoPendiente) > 0.01) {
        wsSummary.addRow({
          cliente: c.customer_name,
          vendedor: c.seller_name ?? c.seller_id ?? '',
          facturas: totalFacturas,
          nc: totalNc,
          recibos: totalRecibos,
          saldo: saldoPendiente
        });
      }
    }

    const moneyColsSummary = ['C', 'D', 'E', 'F'];
    for (const col of moneyColsSummary) wsSummary.getColumn(col).numFmt = '#,##0.00';
    wsSummary.getRow(1).font = { bold: true };
    wsSummary.views = [{ state: 'frozen', ySplit: 1 }];

    wsDetail.getColumn('C').numFmt = 'dd/mm/yyyy';
    wsDetail.getColumn('G').numFmt = '#,##0.00';
    wsDetail.getColumn('H').numFmt = '#,##0.00';
    wsDetail.getColumn('I').numFmt = '#,##0.00';
    wsDetail.getRow(1).font = { bold: true };
    wsDetail.views = [{ state: 'frozen', ySplit: 1 }];

    const out = await workbook.xlsx.writeBuffer();
    const buf = Buffer.from(out instanceof ArrayBuffer ? new Uint8Array(out) : new Uint8Array(out as ArrayBufferLike));
    const filename = `movimientos_sistema_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buf);
  } catch (error: any) {
    console.error('exportSaldosMovimientosSistemaXlsx:', error);
    return res.status(500).json({ message: 'Error exportando movimientos del sistema' });
  }
};

/**
 * Exporta saldos pendientes en Excel con una hoja por cliente.
 * Opcional: ?sellerId=... para ADMIN/WAREHOUSE (filtra por vendedor específico).
 */
export const exportSaldosPendientesByCustomerSheetsXlsx = async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user || !roleCanViewSaldos(user.role)) {
    return res.status(403).json({ message: 'Sin permiso para exportar saldos' });
  }

  try {
    const requestedSellerId = String(req.query.sellerId || '').trim();
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    const sellerIdFilter =
      user.role === 'SELLER'
        ? user.id
        : (user.role === 'ADMIN' || user.role === 'WAREHOUSE') && requestedSellerId
          ? requestedSellerId
          : '';

    const source = String(req.query.source || '').trim().toLowerCase();
    const mode: 'historial' | 'sistema' | 'tango' =
      source === 'tango'
        ? 'tango'
        : source === 'sistema' || source === 'solo-sistema'
          ? 'sistema'
          : 'historial';

    const sellerWhere = sellerIdFilter ? 'WHERE c.seller_id = ?' : '';
    const sellerParams: any[] = sellerIdFilter ? [sellerIdFilter] : [];
    /**
     * Detalle del Excel: todos los movimientos hasta `to` (sin cortar por `from`).
     * Si hay `from`, la fila «Saldo anterior» resume lo previo; el saldo final = saldo pendiente.
     */
    const invoiceRangeFilter = `${to ? ' AND DATE(COALESCE(i.created_at, o.date)) <= ?' : ''}`;
    const invoiceOpeningFilter = ' AND DATE(COALESCE(i.created_at, o.date)) < ?';
    const ncRangeFilter = `${to ? ' AND DATE(COALESCE(cn.created_at, inv.created_at, o.date)) <= ?' : ''}`;
    const ncOpeningFilter = ' AND DATE(COALESCE(cn.created_at, inv.created_at, o.date)) < ?';
    const externalNcRangeFilter = `${to ? ' AND DATE(COALESCE(ecn.created_at, ei.created_at)) <= ?' : ''}`;
    const externalNcOpeningFilter = ' AND DATE(COALESCE(ecn.created_at, ei.created_at)) < ?';
    const receiptRangeFilter = `${to ? ' AND DATE(p.date) <= ?' : ''}`;
    const receiptOpeningFilter = ' AND DATE(p.date) < ?';
    const importedRangeFilter = `${to ? ' AND DATE(e.line_date) <= ?' : ''}`;
    const importedOpeningFilter = ' AND DATE(e.line_date) < ?';
    const manualRangeFilter = `${to ? ' AND DATE(m.fecha) <= ?' : ''}`;
    const manualOpeningFilter = ' AND DATE(m.fecha) < ?';

    const branchFacturaSistema = `
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          COALESCE(i.created_at, o.date) AS fecha,
          'FACTURA' AS tipo,
          CONCAT(
            CASE
              WHEN i.cbte_tipo = 1 THEN 'A '
              WHEN i.cbte_tipo = 6 THEN 'B '
              ELSE ''
            END,
            LPAD(COALESCE(i.punto_venta, 0), 5, '0'),
            '-',
            LPAD(COALESCE(i.cbte_desde, 0), 8, '0')
          ) AS comprobante,
          o.id AS order_id,
          ROUND(COALESCE(o.total, 0) * 1.21, 2) AS debe,
          0 AS haber
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE 1=1 ${invoiceRangeFilter}`;

    const branchFacturaSistemaOpening = `
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          COALESCE(i.created_at, o.date) AS fecha,
          'FACTURA' AS tipo,
          CONCAT(
            CASE
              WHEN i.cbte_tipo = 1 THEN 'A '
              WHEN i.cbte_tipo = 6 THEN 'B '
              ELSE ''
            END,
            LPAD(COALESCE(i.punto_venta, 0), 5, '0'),
            '-',
            LPAD(COALESCE(i.cbte_desde, 0), 8, '0')
          ) AS comprobante,
          o.id AS order_id,
          ROUND(COALESCE(o.total, 0) * 1.21, 2) AS debe,
          0 AS haber
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE 1=1 ${invoiceOpeningFilter}`;

    const branchNcSistema = `
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          COALESCE(cn.created_at, inv.created_at, o.date) AS fecha,
          'NOTA_CREDITO' AS tipo,
          CONCAT(
            CASE
              WHEN cn.cbte_tipo = 3 THEN 'NC A '
              WHEN cn.cbte_tipo = 8 THEN 'NC B '
              WHEN cn.cbte_tipo = 13 THEN 'NC C '
              ELSE 'NC '
            END,
            LPAD(COALESCE(cn.punto_venta, 0), 5, '0'),
            '-',
            LPAD(COALESCE(cn.cbte_desde, 0), 8, '0')
          ) AS comprobante,
          cn.order_id AS order_id,
          0 AS debe,
          ROUND(COALESCE(cn.amount_credited, 0) * 1.21, 2) AS haber
        FROM credit_notes cn
        JOIN orders o ON o.id = cn.order_id
        LEFT JOIN invoices inv ON inv.id = cn.invoice_id
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE 1=1 ${ncRangeFilter}`;

    const branchNcSistemaOpening = `
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          COALESCE(cn.created_at, inv.created_at, o.date) AS fecha,
          'NOTA_CREDITO' AS tipo,
          CONCAT(
            CASE
              WHEN cn.cbte_tipo = 3 THEN 'NC A '
              WHEN cn.cbte_tipo = 8 THEN 'NC B '
              WHEN cn.cbte_tipo = 13 THEN 'NC C '
              ELSE 'NC '
            END,
            LPAD(COALESCE(cn.punto_venta, 0), 5, '0'),
            '-',
            LPAD(COALESCE(cn.cbte_desde, 0), 8, '0')
          ) AS comprobante,
          cn.order_id AS order_id,
          0 AS debe,
          ROUND(COALESCE(cn.amount_credited, 0) * 1.21, 2) AS haber
        FROM credit_notes cn
        JOIN orders o ON o.id = cn.order_id
        LEFT JOIN invoices inv ON inv.id = cn.invoice_id
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE 1=1 ${ncOpeningFilter}`;

    const branchNcExterna = `
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          COALESCE(ecn.created_at, ei.created_at) AS fecha,
          'NOTA_CREDITO' AS tipo,
          CONCAT(
            CASE
              WHEN ecn.cbte_tipo = 3 THEN 'NC A '
              WHEN ecn.cbte_tipo = 8 THEN 'NC B '
              WHEN ecn.cbte_tipo = 13 THEN 'NC C '
              ELSE 'NC '
            END,
            LPAD(COALESCE(ecn.punto_venta, 0), 5, '0'),
            '-',
            LPAD(COALESCE(ecn.cbte_desde, 0), 8, '0')
          ) AS comprobante,
          ecn.external_order_id AS order_id,
          0 AS debe,
          ROUND(COALESCE(ecn.amount_credited, 0) * 1.21, 2) AS haber
        FROM external_credit_notes ecn
        JOIN external_invoices ei ON ei.id = ecn.external_invoice_id
        JOIN customers c
          ON REPLACE(REPLACE(REPLACE(COALESCE(c.cuit, ''), '-', ''), '.', ''), ' ', '') =
             REPLACE(REPLACE(REPLACE(COALESCE(ei.customer_cuit, ''), '-', ''), '.', ''), ' ', '')
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE REPLACE(REPLACE(REPLACE(COALESCE(ei.customer_cuit, ''), '-', ''), '.', ''), ' ', '') <> ''
          ${externalNcRangeFilter}`;

    const branchNcExternaOpening = `
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          COALESCE(ecn.created_at, ei.created_at) AS fecha,
          'NOTA_CREDITO' AS tipo,
          CONCAT(
            CASE
              WHEN ecn.cbte_tipo = 3 THEN 'NC A '
              WHEN ecn.cbte_tipo = 8 THEN 'NC B '
              WHEN ecn.cbte_tipo = 13 THEN 'NC C '
              ELSE 'NC '
            END,
            LPAD(COALESCE(ecn.punto_venta, 0), 5, '0'),
            '-',
            LPAD(COALESCE(ecn.cbte_desde, 0), 8, '0')
          ) AS comprobante,
          ecn.external_order_id AS order_id,
          0 AS debe,
          ROUND(COALESCE(ecn.amount_credited, 0) * 1.21, 2) AS haber
        FROM external_credit_notes ecn
        JOIN external_invoices ei ON ei.id = ecn.external_invoice_id
        JOIN customers c
          ON REPLACE(REPLACE(REPLACE(COALESCE(c.cuit, ''), '-', ''), '.', ''), ' ', '') =
             REPLACE(REPLACE(REPLACE(COALESCE(ei.customer_cuit, ''), '-', ''), '.', ''), ' ', '')
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE REPLACE(REPLACE(REPLACE(COALESCE(ei.customer_cuit, ''), '-', ''), '.', ''), ' ', '') <> ''
          ${externalNcOpeningFilter}`;

    const branchReciboSistema = `
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          p.date AS fecha,
          'RECIBO' AS tipo,
          p.receipt_number AS comprobante,
          p.order_id AS order_id,
          0 AS debe,
          ROUND(COALESCE(p.amount, 0), 2) AS haber
        FROM payments p
        JOIN customers c ON c.id = p.customer_id
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE 1=1 ${receiptRangeFilter}`;

    const branchReciboSistemaOpening = `
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          p.date AS fecha,
          'RECIBO' AS tipo,
          p.receipt_number AS comprobante,
          p.order_id AS order_id,
          0 AS debe,
          ROUND(COALESCE(p.amount, 0), 2) AS haber
        FROM payments p
        JOIN customers c ON c.id = p.customer_id
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE 1=1 ${receiptOpeningFilter}`;

    const branchManualComprobante = `
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          m.fecha AS fecha,
          CASE WHEN m.tipo = 'NC' THEN 'NOTA_CREDITO' ELSE 'FACTURA' END AS tipo,
          CONCAT(
            CASE
              WHEN m.cbte_tipo IN (1, 3) THEN 'A '
              WHEN m.cbte_tipo IN (6, 8) THEN 'B '
              ELSE ''
            END,
            LPAD(COALESCE(m.punto_venta, 0), 5, '0'),
            '-',
            LPAD(COALESCE(m.cbte_desde, 0), 8, '0')
          ) AS comprobante,
          m.ref_order_id AS order_id,
          CASE
            WHEN m.tipo = 'FACTURA' THEN ROUND(COALESCE(m.importe_neto, 0) + COALESCE(m.agip_ret_per, 0), 2)
            ELSE 0
          END AS debe,
          CASE
            WHEN m.tipo = 'NC' THEN ROUND(COALESCE(m.importe_neto, 0), 2)
            ELSE 0
          END AS haber
        FROM customer_manual_comprobantes m
        JOIN customers c ON c.id = m.customer_id
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE 1=1 ${manualRangeFilter}`;

    const branchManualComprobanteOpening = `
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          m.fecha AS fecha,
          CASE WHEN m.tipo = 'NC' THEN 'NOTA_CREDITO' ELSE 'FACTURA' END AS tipo,
          CONCAT(
            CASE
              WHEN m.cbte_tipo IN (1, 3) THEN 'A '
              WHEN m.cbte_tipo IN (6, 8) THEN 'B '
              ELSE ''
            END,
            LPAD(COALESCE(m.punto_venta, 0), 5, '0'),
            '-',
            LPAD(COALESCE(m.cbte_desde, 0), 8, '0')
          ) AS comprobante,
          m.ref_order_id AS order_id,
          CASE
            WHEN m.tipo = 'FACTURA' THEN ROUND(COALESCE(m.importe_neto, 0) + COALESCE(m.agip_ret_per, 0), 2)
            ELSE 0
          END AS debe,
          CASE
            WHEN m.tipo = 'NC' THEN ROUND(COALESCE(m.importe_neto, 0), 2)
            ELSE 0
          END AS haber
        FROM customer_manual_comprobantes m
        JOIN customers c ON c.id = m.customer_id
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE 1=1 ${manualOpeningFilter}`;

    /**
     * Rama de importados Multimedia (Tango). En modo `tango` no se deduplican recibos
     * contra `payments` porque por definición el export es solo lo importado.
     */
    const dedupeReciboPagos =
      mode === 'tango'
        ? ''
        : `
          AND NOT (
            UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('REC', 'RECIBO', 'PAGO', 'COBRO', 'INGRESO')
            AND TRIM(COALESCE(e.numero, '')) <> ''
            AND EXISTS (
              SELECT 1
              FROM payments p
              WHERE p.customer_id = e.customer_id
                AND DATE(p.date) = DATE(e.line_date)
                AND ROUND(COALESCE(p.amount, 0), 2) = ROUND(ABS(COALESCE(e.importe, 0)), 2)
                AND UPPER(
                  REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
                ) = CASE
                  WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
                  ELSE UPPER(
                    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
                  )
                END
            )
          )`;

    /**
     * Patrones permisivos para detectar NC importadas de Tango.
     * Tango exporta el "Tipo" tal cual: NC, NCA, NCB, NCC, NCE, N/C, N/CR, CRE, CRED, NOTA CRED,
     * y en muchas instalaciones aparece como CDE (Crédito) o CRÉ. Detectamos por prefijo.
     */
    const isNcImportado = `(
      UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'NC%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'N/C%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'N.C%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'CDE%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'CRE%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'CRÉ%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'NOTA%CRED%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'NOTA%CRÉD%'
      OR UPPER(COALESCE(e.detalle, '')) LIKE '%NOTA%CRED%'
      OR UPPER(COALESCE(e.detalle, '')) LIKE '%NOTA%CRÉD%'
      OR UPPER(COALESCE(e.detalle, '')) LIKE '%N/C%'
      OR UPPER(COALESCE(e.numero, '')) LIKE 'NC %'
      OR UPPER(COALESCE(e.numero, '')) LIKE 'N/C%'
    )`;
    /**
     * Notas de débito. Las dejamos identificadas para que sumen al saldo (DEBE)
     * en lugar de quedar como MOV_IMPORTADO con 0.
     */
    const isNdImportado = `(
      UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'ND%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'N/D%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'DEB%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'DBE%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'DÉB%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'NOTA%DEB%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'NOTA%DÉB%'
      OR UPPER(COALESCE(e.detalle, '')) LIKE '%NOTA%DEB%'
      OR UPPER(COALESCE(e.detalle, '')) LIKE '%NOTA%DÉB%'
    )`;
    const isFacturaImportada = `(
      UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'FAC%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'FC%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'F/A%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('COMP', 'COMPROBANTE')
      OR UPPER(COALESCE(e.detalle, '')) LIKE '%FACTURA%'
      OR UPPER(COALESCE(e.detalle, '')) LIKE '%COMPROBANTE%'
    )`;
    const isReciboImportado = `(
      UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'REC%'
      OR UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('PAGO', 'COBRO', 'INGRESO', 'R/C')
      OR UPPER(COALESCE(e.detalle, '')) LIKE '%RECIBO%'
      OR UPPER(COALESCE(e.detalle, '')) LIKE '%PAGO%'
      OR UPPER(COALESCE(e.detalle, '')) LIKE '%COBRO%'
    )`;

    const branchImportado = `
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          e.line_date AS fecha,
          CASE
            WHEN ${isNcImportado} THEN 'NOTA_CREDITO_IMPORTADA'
            WHEN ${isNdImportado} THEN 'NOTA_DEBITO_IMPORTADA'
            WHEN ${isFacturaImportada} THEN 'FACTURA_IMPORTADA'
            WHEN ${isReciboImportado} THEN 'RECIBO_IMPORTADO'
            ELSE 'MOV_IMPORTADO'
          END AS tipo,
          TRIM(CONCAT(
            COALESCE(NULLIF(TRIM(e.numero), ''), ''),
            CASE WHEN TRIM(COALESCE(e.detalle, '')) <> '' THEN CONCAT(' — ', LEFT(TRIM(e.detalle), 120)) ELSE '' END
          )) AS comprobante,
          NULL AS order_id,
          CASE
            WHEN ${isNcImportado} THEN 0
            WHEN ${isFacturaImportada} THEN ROUND(ABS(COALESCE(e.importe, 0)), 2)
            WHEN ${isNdImportado} THEN ROUND(ABS(COALESCE(e.importe, 0)), 2)
            ELSE 0
          END AS debe,
          CASE
            WHEN ${isNcImportado} THEN ROUND(ABS(COALESCE(e.importe, 0)), 2)
            WHEN ${isReciboImportado} THEN ROUND(ABS(COALESCE(e.importe, 0)), 2)
            ELSE 0
          END AS haber
        FROM customer_multimedia_entries e
        JOIN customers c ON c.id = e.customer_id
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE e.importe IS NOT NULL
          AND ABS(COALESCE(e.importe, 0)) > 0.001
          ${importedRangeFilter}
          AND UPPER(TRIM(COALESCE(e.tipo, ''))) NOT IN ('SALDO AL', 'SALDO_INICIAL', 'SALDO')
          AND (${isNcImportado} OR ${isNdImportado} OR ${isFacturaImportada} OR ${isReciboImportado})${dedupeReciboPagos}`;

    const branchImportadoOpening = `
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          e.line_date AS fecha,
          CASE
            WHEN ${isNcImportado} THEN 'NOTA_CREDITO_IMPORTADA'
            WHEN ${isNdImportado} THEN 'NOTA_DEBITO_IMPORTADA'
            WHEN ${isFacturaImportada} THEN 'FACTURA_IMPORTADA'
            WHEN ${isReciboImportado} THEN 'RECIBO_IMPORTADO'
            ELSE 'MOV_IMPORTADO'
          END AS tipo,
          TRIM(CONCAT(
            COALESCE(NULLIF(TRIM(e.numero), ''), ''),
            CASE WHEN TRIM(COALESCE(e.detalle, '')) <> '' THEN CONCAT(' — ', LEFT(TRIM(e.detalle), 120)) ELSE '' END
          )) AS comprobante,
          NULL AS order_id,
          CASE
            WHEN ${isNcImportado} THEN 0
            WHEN ${isFacturaImportada} THEN ROUND(ABS(COALESCE(e.importe, 0)), 2)
            WHEN ${isNdImportado} THEN ROUND(ABS(COALESCE(e.importe, 0)), 2)
            ELSE 0
          END AS debe,
          CASE
            WHEN ${isNcImportado} THEN ROUND(ABS(COALESCE(e.importe, 0)), 2)
            WHEN ${isReciboImportado} THEN ROUND(ABS(COALESCE(e.importe, 0)), 2)
            ELSE 0
          END AS haber
        FROM customer_multimedia_entries e
        JOIN customers c ON c.id = e.customer_id
        LEFT JOIN users u ON u.id = c.seller_id
        WHERE e.importe IS NOT NULL
          AND ABS(COALESCE(e.importe, 0)) > 0.001
          ${importedOpeningFilter}
          AND UPPER(TRIM(COALESCE(e.tipo, ''))) NOT IN ('SALDO AL', 'SALDO_INICIAL', 'SALDO')
          AND (${isNcImportado} OR ${isNdImportado} OR ${isFacturaImportada} OR ${isReciboImportado})${dedupeReciboPagos}`;

    /**
     * Cada rama aporta los placeholders from/to (si los hay) en este orden.
     * Mantener este array sincronizado con `branchesByMode` define `movementParams`.
     */
    const branchesByMode: Record<typeof mode, string[]> = {
      historial: [
        branchFacturaSistema,
        branchNcSistema,
        branchNcExterna,
        branchReciboSistema,
        branchManualComprobante,
        branchImportado
      ],
      sistema: [
        branchFacturaSistema,
        branchNcSistema,
        branchReciboSistema,
        branchManualComprobante
      ],
      tango: [branchImportado]
    };
    const branchesOpeningByMode: Record<typeof mode, string[]> = {
      historial: [
        branchFacturaSistemaOpening,
        branchNcSistemaOpening,
        branchNcExternaOpening,
        branchReciboSistemaOpening,
        branchManualComprobanteOpening,
        branchImportadoOpening
      ],
      sistema: [
        branchFacturaSistemaOpening,
        branchNcSistemaOpening,
        branchReciboSistemaOpening,
        branchManualComprobanteOpening
      ],
      tango: [branchImportadoOpening]
    };
    const branches = branchesByMode[mode];

    const openingByCustomer = new Map<string, number>();
    if (from) {
      const openingBranches = branchesOpeningByMode[mode];
      const openingParams: any[] = [];
      for (let b = 0; b < openingBranches.length; b += 1) {
        openingParams.push(from);
      }
      if (sellerIdFilter) openingParams.push(sellerIdFilter);
      const openingRows = (await query(
        `
        SELECT m.customer_id, ROUND(SUM(m.debe - m.haber), 2) AS opening
        FROM (
          ${openingBranches.join('\n          UNION ALL\n')}
        ) m
        ${sellerIdFilter ? 'WHERE m.seller_id = ?' : ''}
        GROUP BY m.customer_id
        `,
        openingParams
      )) as Array<{ customer_id: string; opening: number | string }>;
      for (const r of openingRows) {
        openingByCustomer.set(r.customer_id, Number(r.opening) || 0);
      }
    }

    const movementParams: any[] = [];
    for (let b = 0; b < branches.length; b += 1) {
      if (to) movementParams.push(to);
    }
    if (sellerIdFilter) movementParams.push(sellerIdFilter);

    const movements = await query(
      `
      SELECT
        m.customer_id,
        m.customer_name,
        m.seller_id,
        m.seller_name,
        m.fecha,
        m.tipo,
        m.comprobante,
        m.order_id,
        m.debe,
        m.haber
      FROM (
        ${branches.join('\n        UNION ALL\n')}
      ) m
      ${sellerIdFilter ? 'WHERE m.seller_id = ?' : ''}
      ORDER BY m.customer_name ASC, m.fecha ASC, m.tipo ASC
      `,
      movementParams
    ) as Array<{
      customer_id: string;
      customer_name: string;
      seller_id: string | null;
      seller_name: string | null;
      fecha: string;
      tipo:
        | 'FACTURA'
        | 'NOTA_CREDITO'
        | 'NOTA_CREDITO_IMPORTADA'
        | 'NOTA_DEBITO_IMPORTADA'
        | 'RECIBO'
        | 'FACTURA_IMPORTADA'
        | 'RECIBO_IMPORTADO'
        | 'MOV_IMPORTADO';
      comprobante: string;
      order_id: string | null;
      debe: number;
      haber: number;
    }>;

    const customers = await query(
      `SELECT c.id, COALESCE(c.business_name, c.name, 'Cliente') AS customer_name, c.seller_id, u.name AS seller_name
       FROM customers c
       LEFT JOIN users u ON u.id = c.seller_id
       ${sellerWhere}
       ORDER BY customer_name ASC`,
      sellerParams
    ) as Array<{ id: string; customer_name: string; seller_id: string | null; seller_name: string | null }>;

    const carteraByCustomerId = await fetchCarteraSaldoUnificadoMap(sellerIdFilter, user);

    const byCustomer = new Map<string, typeof movements>();
    for (const m of movements) {
      if (!byCustomer.has(m.customer_id)) byCustomer.set(m.customer_id, []);
      byCustomer.get(m.customer_id)!.push(m);
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'LupoHub';
    workbook.created = new Date();

    const wsSummary = workbook.addWorksheet('Resumen');
    wsSummary.columns = [
      { header: 'Cliente', key: 'cliente', width: 40 },
      { header: 'Vendedor', key: 'vendedor', width: 28 },
      { header: 'Saldo pendiente', key: 'saldo', width: 18 }
    ];
    wsSummary.getRow(1).font = { bold: true };
    wsSummary.views = [{ state: 'frozen', ySplit: 1 }];
    wsSummary.getColumn('C').numFmt = '#,##0.00';

    const wsDetalle = workbook.addWorksheet('Detalle clientes');
    wsDetalle.columns = [
      { header: 'Fecha', key: 'fecha', width: 14 },
      { header: 'Tipo', key: 'tipo', width: 22 },
      { header: 'Comprobante', key: 'comprobante', width: 36 },
      { header: 'Pedido', key: 'pedido', width: 16 },
      { header: 'Debe', key: 'debe', width: 14 },
      { header: 'Haber', key: 'haber', width: 14 },
      { header: 'Saldo', key: 'saldo', width: 16 }
    ];
    wsDetalle.views = [{ state: 'frozen', ySplit: 1 }];
    wsDetalle.getColumn('A').numFmt = 'dd/mm/yyyy';
    wsDetalle.getColumn('E').numFmt = '#,##0.00';
    wsDetalle.getColumn('F').numFmt = '#,##0.00';
    wsDetalle.getColumn('G').numFmt = '#,##0.00';
    for (const col of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
      wsDetalle.getColumn(col).alignment = { horizontal: 'left', vertical: 'middle' };
    }

    const customersOrdered = [...customers].sort(
      (a, b) =>
        String(a.seller_name || a.seller_id || '').localeCompare(String(b.seller_name || b.seller_id || ''), 'es') ||
        String(a.customer_name || '').localeCompare(String(b.customer_name || ''), 'es')
    );
    let lastSellerGroup = '';
    for (const c of customersOrdered) {
      const movs = byCustomer.get(c.id) || [];
      const openingBalance = from ? Math.round((openingByCustomer.get(c.id) || 0) * 100) / 100 : 0;
      let running = openingBalance;
      for (const m of movs) {
        running = Math.round((running + Number(m.debe || 0) - Number(m.haber || 0)) * 100) / 100;
      }
      const saldoPeriodo = Math.round(running * 100) / 100;
      const saldoCartera = carteraByCustomerId.get(c.id) ?? saldoPeriodo;

      if (Math.abs(saldoCartera) <= 0.005) continue;

      wsSummary.addRow({
        cliente: c.customer_name,
        vendedor: c.seller_name ?? c.seller_id ?? '',
        saldo: saldoCartera
      });

      // Bloque por cliente dentro de una sola hoja para ahorrar páginas al imprimir.
      if (!sellerIdFilter) {
        const sellerGroup = String(c.seller_name || c.seller_id || 'Sin vendedor');
        if (sellerGroup !== lastSellerGroup) {
          const sellerRow = wsDetalle.addRow([`VENDEDOR: ${sellerGroup}`, '', '', '', '', '', '']);
          wsDetalle.mergeCells(sellerRow.number, 1, sellerRow.number, 7);
          sellerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          sellerRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
          sellerRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
          wsDetalle.addRow(['', '', '', '', '', '', '']);
          lastSellerGroup = sellerGroup;
        }
      }

      const saldoCarteraLabel = saldoCartera.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const titleRow = wsDetalle.addRow([
        `CLIENTE: ${c.customer_name}`,
        `VENDEDOR: ${c.seller_name ?? c.seller_id ?? '-'}`,
        '',
        '',
        '',
        '',
        `SALDO A COBRAR: ${saldoCarteraLabel}`,
      ]);
      wsDetalle.mergeCells(titleRow.number, 1, titleRow.number, 3);
      wsDetalle.mergeCells(titleRow.number, 4, titleRow.number, 6);
      titleRow.font = { bold: true, color: { argb: 'FF0F172A' } };
      titleRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
      });

      const blockHeader = wsDetalle.addRow(['Fecha', 'Tipo', 'Comprobante', 'Pedido', 'Debe', 'Haber', 'Saldo']);
      blockHeader.font = { bold: true, color: { argb: 'FF1E293B' } };
      blockHeader.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
      });

      const movsInTable = from
        ? movs.filter((m) => {
            const d = m.fecha ? new Date(m.fecha) : null;
            if (!d || Number.isNaN(d.getTime())) return true;
            const fromD = new Date(`${from}T12:00:00`);
            return d.getTime() >= fromD.getTime();
          })
        : movs;

      let netoTabla = 0;
      for (const m of movsInTable) {
        const debe = Number(m.debe || 0);
        const haber = Number(m.haber || 0);
        netoTabla = Math.round((netoTabla + debe - haber) * 100) / 100;
      }

      let saldo: number;
      if (from && Math.abs(openingBalance) > 0.005) {
        saldo = openingBalance;
        const saldoAntRow = wsDetalle.addRow({
          fecha: new Date(from),
          tipo: 'Saldo anterior',
          comprobante: '',
          pedido: '',
          debe: 0,
          haber: 0,
          saldo: openingBalance,
        });
        saldoAntRow.font = { italic: true, color: { argb: 'FF64748B' } };
      } else {
        saldo = Math.round((saldoCartera - netoTabla) * 100) / 100;
      }

      for (const m of movsInTable) {
        const debe = Number(m.debe || 0);
        const haber = Number(m.haber || 0);
        saldo = Math.round((saldo + debe - haber) * 100) / 100;
        wsDetalle.addRow({
          fecha: m.fecha ? new Date(m.fecha) : null,
          tipo: labelTipoSaldoExporter(m),
          comprobante: m.comprobante,
          pedido: m.order_id ?? '',
          debe,
          haber,
          saldo
        });
      }

      const resumenLabelRow = wsDetalle.addRow(['RESUMEN', '', '', '', '', '', '']);
      const mainSaldoRow = wsDetalle.addRow(['Saldo pendiente', '', '', '', '', '', saldoCartera]);
      resumenLabelRow.font = { bold: true };
      mainSaldoRow.getCell(1).font = { bold: true, size: 11 };
      mainSaldoRow.getCell(7).font = { bold: true, size: 12 };
      mainSaldoRow.getCell(7).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD1FAE5' },
      };
      wsDetalle.mergeCells(resumenLabelRow.number, 1, resumenLabelRow.number, 6);
      wsDetalle.mergeCells(mainSaldoRow.number, 1, mainSaldoRow.number, 6);
      resumenLabelRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      mainSaldoRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };

      wsDetalle.addRow(['', '', '', '', '', '', '']);
    }

    const out = await workbook.xlsx.writeBuffer();
    const buf = Buffer.from(out instanceof ArrayBuffer ? new Uint8Array(out) : new Uint8Array(out as ArrayBufferLike));
    const datePart = new Date().toISOString().slice(0, 10);
    const sellerNameFromFilter =
      sellerIdFilter && customers.length > 0
        ? String(customers.find((x) => String(x.seller_id || '') === sellerIdFilter)?.seller_name || '').trim()
        : '';
    const sellerLabelRaw =
      (user.role === 'SELLER' ? String(user.name || '').trim() : '') ||
      sellerNameFromFilter ||
      (sellerIdFilter ? String(sellerIdFilter).trim() : 'todos');
    const sellerLabelSafe = sellerLabelRaw
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const modoLabel = mode;
    const filename = `saldos ${modoLabel} - ${sellerLabelSafe || 'todos'} - ${datePart}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buf);
  } catch (error: any) {
    console.error('exportSaldosPendientesByCustomerSheetsXlsx:', error?.message || error, error?.sqlMessage);
    return res.status(500).json({
      message: 'Error exportando saldos pendientes por cliente',
      detail: process.env.NODE_ENV === 'production' ? undefined : String(error?.sqlMessage || error?.message || error)
    });
  }
};

type MergedResumenRow = {
  customerId: string;
  legacy_code: unknown;
  account_zone: unknown;
  account_seller_label: unknown;
  seller_id: unknown;
  businessName: string;
  contactName: string;
  cuit: string;
  saldoPendiente: number;
  /** Cargos pedidos LupoHub (IVA incl.) antes de unificar con cuenta importada. */
  totalCargosPendiente: number;
  /** Recibos en Facturación (misma base que getCarteraTotals). */
  totalPagos: number;
  multimediaSaldo: number;
  pedidosPendientes: number;
  seller_name?: string;
  /** Líneas importadas en customer_multimedia_entries (como en export historial Multimedias). */
  movementCountExcel: number;
};

/**
 * Excel una sola hoja "Resumen" estilizada: Código, Cliente, Vendedor habitual, Zona, Saldo final, Movimientos.
 * Saldo final = max(0, C + M − P): pedidos pendientes IVA + último saldo cuenta importada − pagos registrados.
 * Movimientos = líneas en historial importado + cantidad de pedidos pendientes (misma idea que cartera unificada).
 * Incluye clientes con saldo solo en cuenta importada aunque no tengan pedidos pendientes en LupoHub.
 */
export const exportSaldosPendientesMultimediasXlsx = async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user || !roleCanViewSaldos(user.role)) {
    return res.status(403).json({ message: 'Sin permiso para exportar saldos' });
  }
  const sellerFilter = user.role === 'SELLER' ? ' AND c.seller_id = ?' : '';
  const baseParams: any[] = user.role === 'SELLER' ? [user.id] : [];
  const paymentsJoin =
    user.role === 'SELLER'
      ? `LEFT JOIN (
      SELECT p.customer_id, SUM(p.amount) AS total_pagos
      FROM payments p
      INNER JOIN customers c2 ON c2.id = p.customer_id
      WHERE (p.seller_id = ? OR c2.seller_id = ?)
      GROUP BY p.customer_id
    ) pay ON pay.customer_id = t.customerId`
      : `LEFT JOIN (
      SELECT customer_id, SUM(amount) AS total_pagos
      FROM payments
      GROUP BY customer_id
    ) pay ON pay.customer_id = t.customerId`;
  const payParams: any[] = user.role === 'SELLER' ? [user.id, user.id] : [];
  const paramsWithNc = [...baseParams, ...payParams];
  const paramsSimple = [...baseParams, ...payParams];

  const payMmJoin =
    user.role === 'SELLER'
      ? `LEFT JOIN (
      SELECT p.customer_id, SUM(p.amount) AS total_pagos
      FROM payments p
      INNER JOIN customers c2 ON c2.id = p.customer_id
      WHERE (p.seller_id = ? OR c2.seller_id = ?)
      GROUP BY p.customer_id
    ) pay_mm ON pay_mm.customer_id = c.id`
      : `LEFT JOIN (
      SELECT customer_id, SUM(amount) AS total_pagos
      FROM payments
      GROUP BY customer_id
    ) pay_mm ON pay_mm.customer_id = c.id`;
  const mmParams = [...baseParams, ...payParams];

  const sqlWithNc = `
    SELECT
      t.customerId,
      t.legacy_code,
      t.account_zone,
      t.account_seller_label,
      t.seller_id,
      t.businessName,
      t.contactName,
      t.cuit,
      ROUND(t.cargosPendientes - COALESCE(pay.total_pagos, 0), 2) AS saldoPendiente,
      ROUND(t.cargosPendientes, 2) AS totalCargosPendiente,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      t.pedidosPendientes,
      u.name AS seller_name
    FROM (
      SELECT
        c.id AS customerId,
        c.legacy_code,
        c.account_zone,
        c.account_seller_label,
        c.seller_id,
        c.business_name AS businessName,
        c.name AS contactName,
        c.cuit,
        SUM(ROUND(GREATEST(0, (${SQL_ORDER_NETO_GRAVADO}) - COALESCE(cn.cn_total, 0)) * 1.21, 2)) AS cargosPendientes,
        COUNT(DISTINCT o.id) AS pedidosPendientes
      FROM customers c
      INNER JOIN orders o ON o.customer_id = c.id
      LEFT JOIN (
        SELECT order_id, SUM(amount_credited) AS cn_total
        FROM credit_notes
        GROUP BY order_id
      ) cn ON cn.order_id = o.id
      WHERE ${SQL_ORDER_ACTIVE_COND}
        AND ${SQL_ORDER_IN_SALDO_SCOPE}
        AND ${SQL_ORDER_ACTIVE_COND}
        ${sellerFilter}
      GROUP BY c.id, c.legacy_code, c.account_zone, c.account_seller_label, c.seller_id, c.business_name, c.name, c.cuit
    ) t
    LEFT JOIN users u ON u.id = t.seller_id
    ${paymentsJoin}
    ORDER BY t.businessName ASC, t.contactName ASC
  `;

  const sqlSimple = `
    SELECT
      t.customerId,
      t.legacy_code,
      t.account_zone,
      t.account_seller_label,
      t.seller_id,
      t.businessName,
      t.contactName,
      t.cuit,
      ROUND(t.cargosPendientes - COALESCE(pay.total_pagos, 0), 2) AS saldoPendiente,
      ROUND(t.cargosPendientes, 2) AS totalCargosPendiente,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      t.pedidosPendientes,
      u.name AS seller_name
    FROM (
      SELECT
        c.id AS customerId,
        c.legacy_code,
        c.account_zone,
        c.account_seller_label,
        c.seller_id,
        c.business_name AS businessName,
        c.name AS contactName,
        c.cuit,
        SUM(${SQL_ORDER_CARGO_CON_IVA}) AS cargosPendientes,
        COUNT(DISTINCT o.id) AS pedidosPendientes
      FROM customers c
      INNER JOIN orders o ON o.customer_id = c.id
      WHERE ${SQL_ORDER_ACTIVE_COND}
        AND ${SQL_ORDER_IN_SALDO_SCOPE}
        AND ${SQL_ORDER_ACTIVE_COND}
        ${sellerFilter}
      GROUP BY c.id, c.legacy_code, c.account_zone, c.account_seller_label, c.seller_id, c.business_name, c.name, c.cuit
    ) t
    LEFT JOIN users u ON u.id = t.seller_id
    ${paymentsJoin}
    ORDER BY t.businessName ASC, t.contactName ASC
  `;

  let rows: any[];
  try {
    rows = (await query(sqlWithNc, paramsWithNc)) as any[];
  } catch {
    rows = (await query(sqlSimple, paramsSimple)) as any[];
  }

  const sqlMultimediaSaldos = `
    SELECT
      c.id AS customerId,
      c.legacy_code,
      c.account_zone,
      c.account_seller_label,
      c.seller_id,
      c.business_name AS businessName,
      c.name AS contactName,
      c.cuit,
      CAST(COALESCE(
        (SELECT CAST(e_lo.saldo AS DECIMAL(16,2))
         FROM customer_multimedia_entries e_lo
         WHERE e_lo.customer_id = agg.customer_id
         ORDER BY e_lo.line_order DESC
         LIMIT 1),
        (SELECT CAST(e2.saldo AS DECIMAL(16,2))
         FROM customer_multimedia_entries e2
         WHERE e2.customer_id = agg.customer_id AND e2.saldo IS NOT NULL
         ORDER BY e2.line_order DESC
         LIMIT 1),
        0
      ) AS DECIMAL(16,2)) AS lastSaldo,
      agg.cnt AS movementCount,
      ROUND(COALESCE(pay_mm.total_pagos, 0), 2) AS totalPagos,
      u.name AS seller_name
    FROM (
      SELECT customer_id, COUNT(*) AS cnt
      FROM customer_multimedia_entries
      GROUP BY customer_id
    ) agg
    INNER JOIN customers c ON c.id = agg.customer_id
    LEFT JOIN users u ON u.id = c.seller_id
    ${payMmJoin}
    WHERE 1=1 ${sellerFilter}
  `;

  let mmRows: any[] = [];
  try {
    mmRows = (await query(sqlMultimediaSaldos, mmParams)) as any[];
  } catch {
    mmRows = [];
  }

  const byId = new Map<string, MergedResumenRow>();
  for (const r of rows) {
    const id = String(r.customerId);
    const C = Number(r.totalCargosPendiente) || 0;
    const P = Number(r.totalPagos) || 0;
    byId.set(id, {
      customerId: id,
      legacy_code: r.legacy_code,
      account_zone: r.account_zone,
      account_seller_label: r.account_seller_label,
      seller_id: r.seller_id,
      businessName: String(r.businessName ?? ''),
      contactName: String(r.contactName ?? ''),
      cuit: String(r.cuit ?? ''),
      totalCargosPendiente: C,
      totalPagos: P,
      multimediaSaldo: 0,
      saldoPendiente: Math.round((C + 0 - P) * 100) / 100,
      pedidosPendientes: Number(r.pedidosPendientes) || 0,
      seller_name: r.seller_name,
      movementCountExcel: 0
    });
  }
  for (const m of mmRows) {
    const id = String(m.customerId);
    const excelSaldo = Number(m.lastSaldo) || 0;
    const mmCnt = Number(m.movementCount) || 0;
    const Pmm = Number(m.totalPagos) || 0;
    const existing = byId.get(id);
    const C = existing?.totalCargosPendiente ?? 0;
    const P = existing?.totalPagos ?? Pmm;
    const unified = Math.round((C + excelSaldo - P) * 100) / 100;
    if (existing) {
      existing.multimediaSaldo = excelSaldo;
      existing.totalPagos = P;
      existing.saldoPendiente = unified;
      existing.movementCountExcel = mmCnt;
    } else {
      byId.set(id, {
        customerId: id,
        legacy_code: m.legacy_code,
        account_zone: m.account_zone,
        account_seller_label: m.account_seller_label,
        seller_id: m.seller_id,
        businessName: String(m.businessName ?? ''),
        contactName: String(m.contactName ?? ''),
        cuit: String(m.cuit ?? ''),
        totalCargosPendiente: 0,
        totalPagos: Pmm,
        multimediaSaldo: excelSaldo,
        saldoPendiente: Math.round((0 + excelSaldo - Pmm) * 100) / 100,
        pedidosPendientes: 0,
        seller_name: m.seller_name,
        movementCountExcel: mmCnt
      });
    }
  }

  const mergedList = [...byId.values()]
    .filter((r) => r.saldoPendiente > 0.01)
    .sort((a, b) =>
      (a.businessName || '').localeCompare(b.businessName || '', 'es') ||
      (a.contactName || '').localeCompare(b.contactName || '', 'es')
    );

  const borderThin = {
    style: 'thin' as const,
    color: { argb: 'FF94A3B8' }
  };
  const borderSoft = {
    style: 'thin' as const,
    color: { argb: 'FFE2E8F0' }
  };

  const sellerSummary = new Map<
    string,
    {
      vendedor: string;
      zonaPrincipal: string;
      clientes: number;
      pedidos: number;
      importada: number;
      recibos: number;
      saldo: number;
      movimientos: number;
    }
  >();
  for (const r of mergedList) {
    const vendedorLabel =
      (r.account_seller_label != null && String(r.account_seller_label).trim() !== ''
        ? String(r.account_seller_label).trim()
        : '') ||
      (r.seller_id && r.seller_name ? `${String(r.seller_id).slice(0, 8)} - ${r.seller_name}` : '') ||
      'Sin vendedor';
    const zona = r.account_zone != null ? String(r.account_zone).trim() : '';
    const key = `${vendedorLabel}|${zona}`;
    const prev = sellerSummary.get(key) || {
      vendedor: vendedorLabel,
      zonaPrincipal: zona || 'Sin zona',
      clientes: 0,
      pedidos: 0,
      importada: 0,
      recibos: 0,
      saldo: 0,
      movimientos: 0
    };
    prev.clientes += 1;
    prev.pedidos += Number(r.totalCargosPendiente) || 0;
    prev.importada += Number(r.multimediaSaldo) || 0;
    prev.recibos += Number(r.totalPagos) || 0;
    prev.saldo += Number(r.saldoPendiente) || 0;
    prev.movimientos += (Number(r.movementCountExcel) || 0) + (Number(r.pedidosPendientes) || 0);
    sellerSummary.set(key, prev);
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'LupoHub';
  workbook.created = new Date();
  const ws = workbook.addWorksheet('Resumen', {
    views: [{ state: 'frozen', ySplit: 2 }],
    properties: { defaultRowHeight: 19 }
  });

  ws.columns = [
    { key: 'codigo', width: 14 },
    { key: 'cliente', width: 44 },
    { key: 'vendedor', width: 24 },
    { key: 'zona', width: 18 },
    { key: 'pedidos', width: 15 },
    { key: 'importada', width: 17 },
    { key: 'recibos', width: 17 },
    { key: 'saldo', width: 16 },
    { key: 'movs', width: 13 }
  ];

  const reportDate = new Date().toISOString().slice(0, 10);
  const infoText = `Saldos pendientes por cliente y vendedor | Clientes: ${mergedList.length} | Fecha: ${reportDate}`;
  ws.addRow([infoText, '', '', '', '', '', '', '', '']);
  ws.mergeCells(1, 1, 1, 9);
  const infoCell = ws.getCell('A1');
  infoCell.font = { bold: true, color: { argb: 'FF334155' }, size: 11, name: 'Calibri' };
  infoCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  infoCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFEFF6FF' }
  };
  infoCell.border = {
    top: borderSoft,
    left: borderSoft,
    right: borderSoft,
    bottom: borderSoft
  };
  ws.getRow(1).height = 22;

  const headerTitles = ['Código', 'Cliente', 'Vendedor habitual', 'Zona', 'Pedidos', 'Cuenta importada', 'Recibos sistema', 'Saldo final', 'Movimientos'];
  const headerRow = ws.addRow(headerTitles);
  headerRow.height = 26;
  headerRow.eachCell((cell, colNumber) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E40AF' }
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: colNumber >= 5 ? 'right' : 'left',
      wrapText: true
    };
    cell.border = {
      top: borderThin,
      left: borderThin,
      bottom: { style: 'medium', color: { argb: 'FF1E3A8A' } },
      right: borderThin
    };
  });

  let rowNum = 3;
  for (const r of mergedList) {
    const displayName = String(r.businessName || r.contactName || 'Cliente').trim();
    const legacyTrim = r.legacy_code != null ? String(r.legacy_code).trim() : '';
    const code: string =
      legacyTrim ||
      padLegacyCode(String(r.customerId || '').replace(/-/g, '').slice(0, 6) || '0');
    const vendedor: string =
      (r.account_seller_label != null && String(r.account_seller_label).trim() !== ''
        ? String(r.account_seller_label).trim()
        : '') ||
      (r.seller_id && r.seller_name ? `${String(r.seller_id).slice(0, 8)} - ${r.seller_name}` : '');
    const zona: string = r.account_zone != null ? String(r.account_zone).trim() : '';
    const pedidos = Number(r.totalCargosPendiente) || 0;
    const importada = Number(r.multimediaSaldo) || 0;
    const recibosSistema = Number(r.totalPagos) || 0;
    const saldoFinal = Number(r.saldoPendiente) || 0;
    const movs = (Number(r.movementCountExcel) || 0) + (Number(r.pedidosPendientes) || 0);

    const dataRow = ws.addRow([code, displayName, vendedor, zona, pedidos, importada, recibosSistema, saldoFinal, movs]);
    const zebra = rowNum % 2 === 0;
    dataRow.eachCell((cell, colNumber) => {
      cell.font = { size: 11, name: 'Calibri', color: { argb: 'FF0F172A' } };
      if (zebra) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF1F5F9' }
        };
      }
      cell.border = {
        top: borderThin,
        left: borderThin,
        bottom: borderThin,
        right: borderThin
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: colNumber >= 5 ? 'right' : 'left',
        wrapText: colNumber === 2 || colNumber === 3
      };
      if ([5, 6, 7, 8].includes(colNumber)) {
        cell.numFmt = '#,##0.00';
      }
      if (colNumber === 9) {
        cell.numFmt = '0';
      }
    });
    rowNum++;
  }

  // Fila final: total general al pie de la hoja.
  const totalPedidos = mergedList.reduce((acc, r) => acc + (Number(r.totalCargosPendiente) || 0), 0);
  const totalImportada = mergedList.reduce((acc, r) => acc + (Number(r.multimediaSaldo) || 0), 0);
  const totalRecibosSistema = mergedList.reduce((acc, r) => acc + (Number(r.totalPagos) || 0), 0);
  const totalSaldoFinal = mergedList.reduce((acc, r) => acc + (Number(r.saldoPendiente) || 0), 0);
  const totalMovs = mergedList.reduce(
    (acc, r) => acc + (Number(r.movementCountExcel) || 0) + (Number(r.pedidosPendientes) || 0),
    0
  );

  const totalRow = ws.addRow([
    '',
    'TOTAL GENERAL',
    '',
    '',
    totalPedidos,
    totalImportada,
    totalRecibosSistema,
    totalSaldoFinal,
    totalMovs
  ]);
  totalRow.height = 24;
  totalRow.eachCell((cell, colNumber) => {
    cell.font = { bold: true, size: 11, name: 'Calibri', color: { argb: 'FF0F172A' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE2E8F0' }
    };
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF64748B' } },
      left: borderThin,
      bottom: { style: 'medium', color: { argb: 'FF64748B' } },
      right: borderThin
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: colNumber >= 5 ? 'right' : 'left'
    };
    if ([5, 6, 7, 8].includes(colNumber)) {
      cell.numFmt = '#,##0.00';
    }
    if (colNumber === 9) {
      cell.numFmt = '0';
    }
  });

  if (mergedList.length > 0) {
    ws.autoFilter = {
      from: { row: 2, column: 1 },
      to: { row: mergedList.length + 2, column: 9 }
    };
  }

  const wsSeller = workbook.addWorksheet('Resumen por vendedor', {
    views: [{ state: 'frozen', ySplit: 2 }],
    properties: { defaultRowHeight: 19 }
  });
  wsSeller.columns = [
    { key: 'vendedor', width: 28 },
    { key: 'zona', width: 18 },
    { key: 'clientes', width: 12 },
    { key: 'pedidos', width: 16 },
    { key: 'importada', width: 18 },
    { key: 'recibos', width: 16 },
    { key: 'saldo', width: 16 },
    { key: 'movimientos', width: 14 }
  ];
  wsSeller.addRow([`Resumen agrupado por vendedor | Fecha: ${reportDate}`, '', '', '', '', '', '', '']);
  wsSeller.mergeCells(1, 1, 1, 8);
  wsSeller.getCell('A1').font = { bold: true, color: { argb: 'FF334155' }, size: 11, name: 'Calibri' };
  wsSeller.getCell('A1').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFEFF6FF' }
  };
  wsSeller.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  wsSeller.getRow(1).height = 22;

  const sellerHeader = wsSeller.addRow([
    'Vendedor habitual',
    'Zona',
    'Clientes',
    'Pedidos',
    'Cuenta importada',
    'Recibos sistema',
    'Saldo final',
    'Movimientos'
  ]);
  sellerHeader.height = 24;
  sellerHeader.eachCell((cell, colNumber) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    cell.alignment = { vertical: 'middle', horizontal: colNumber >= 3 ? 'right' : 'left', wrapText: true };
    cell.border = {
      top: borderThin,
      left: borderThin,
      bottom: { style: 'medium', color: { argb: 'FF1E3A8A' } },
      right: borderThin
    };
  });

  const sellerRows = [...sellerSummary.values()].sort((a, b) => b.saldo - a.saldo || a.vendedor.localeCompare(b.vendedor, 'es'));
  let sellerRowNum = 3;
  for (const s of sellerRows) {
    const row = wsSeller.addRow([
      s.vendedor,
      s.zonaPrincipal,
      s.clientes,
      Math.round(s.pedidos * 100) / 100,
      Math.round(s.importada * 100) / 100,
      Math.round(s.recibos * 100) / 100,
      Math.round(s.saldo * 100) / 100,
      s.movimientos
    ]);
    const zebra = sellerRowNum % 2 === 0;
    row.eachCell((cell, colNumber) => {
      cell.font = { size: 11, name: 'Calibri', color: { argb: 'FF0F172A' } };
      if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      cell.border = { top: borderThin, left: borderThin, bottom: borderThin, right: borderThin };
      cell.alignment = { vertical: 'middle', horizontal: colNumber >= 3 ? 'right' : 'left' };
      if ([4, 5, 6, 7].includes(colNumber)) cell.numFmt = '#,##0.00';
      if ([3, 8].includes(colNumber)) cell.numFmt = '0';
    });
    sellerRowNum++;
  }
  if (sellerRows.length > 0) {
    wsSeller.autoFilter = {
      from: { row: 2, column: 1 },
      to: { row: sellerRows.length + 2, column: 8 }
    };
  }

  const out = await workbook.xlsx.writeBuffer();
  const buf = Buffer.from(out instanceof ArrayBuffer ? new Uint8Array(out) : new Uint8Array(out as ArrayBufferLike));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="saldos_pendientes_resumen_${new Date().toISOString().slice(0, 10)}.xlsx"`
  );
  res.send(buf);
};

function normResumenHeader(s: string): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeNameForCustomerMatch(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function cellStrResumenCell(v: unknown): string {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v)) return String(Math.trunc(v));
  return String(v).trim();
}

/**
 * POST multipart file — hoja Resumen Multimedias: asigna customers.seller_id según "Vendedor habitual"
 * (código numérico) vinculado al usuario vendedor.{codigo}@importado.lupohub.local.
 * Cliente: por legacy_code (columna Código) o por nombre (columna Cliente).
 */
export const assignCustomerSellersFromResumen = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).user;
    if (!authUser || authUser.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Solo administradores pueden asignar vendedores en lote' });
    }
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file?.buffer) {
      return res.status(400).json({ message: 'Subí un archivo .xlsx (campo file)' });
    }
    const wb = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return res.status(400).json({ message: 'El archivo no tiene hojas' });
    const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as (string | number | null | undefined)[][];

    let headerRow = -1;
    let codigoCol = -1;
    let vendCol = -1;
    let clienteCol = -1;
    for (let r = 0; r < Math.min(15, matrix.length); r++) {
      const h = matrix[r].map((c) => normResumenHeader(String(c ?? '')));
      const ci = h.findIndex((x) => x === 'codigo');
      const vi = h.findIndex((x) => x.includes('vendedor') && x.includes('habitual'));
      const cl = h.findIndex((x) => x.includes('cliente') && !x.includes('vendedor'));
      if (ci >= 0 && vi >= 0) {
        headerRow = r;
        codigoCol = ci;
        vendCol = vi;
        clienteCol = cl >= 0 ? cl : 1;
        break;
      }
    }
    if (headerRow < 0) {
      return res.status(400).json({
        message: 'No se encontró formato Resumen (columnas Código y Vendedor habitual). Usá el Excel historial Multimedias.',
      });
    }

    const custRows = (await query(`SELECT id, legacy_code, business_name, name FROM customers`)) as any[];
    const legacyToId = new Map<string, string>();
    const normToId = new Map<string, string>();
    for (const c of custRows) {
      const lc = (c.legacy_code && String(c.legacy_code).trim()) || '';
      if (lc) {
        legacyToId.set(lc, c.id);
        legacyToId.set(padLegacyCode(lc), c.id);
        const strip = lc.replace(/^0+/, '') || '0';
        legacyToId.set(strip, c.id);
        const digits = lc.replace(/\D/g, '');
        if (digits && /^\d+$/.test(digits)) {
          legacyToId.set(digits, c.id);
          legacyToId.set(padLegacyCode(digits), c.id);
        }
      }
      const bn = normalizeNameForCustomerMatch(c.business_name);
      if (bn) normToId.set(bn, c.id);
      const nm = normalizeNameForCustomerMatch(c.name);
      if (nm) normToId.set(nm, c.id);
    }

    let rowsProcessed = 0;
    let customersUpdated = 0;
    let skippedNoSeller = 0;
    let skippedNoCustomer = 0;
    let skippedNoVendedorCell = 0;

    for (let i = headerRow + 1; i < matrix.length; i++) {
      const row = matrix[i];
      const codigoRaw = cellStrResumenCell(row[codigoCol]);
      const vendRaw = cellStrResumenCell(row[vendCol]);
      const clienteRaw = clienteCol >= 0 ? cellStrResumenCell(row[clienteCol]) : '';
      if (!codigoRaw && !clienteRaw) continue;
      rowsProcessed++;

      if (!vendRaw) {
        skippedNoVendedorCell++;
        continue;
      }

      const vm = vendRaw.match(/^(\d+)\s*[-–—]\s*(.+)$/u);
      const vendCode = vm ? vm[1].trim().replace(/^0+/, '') || vm[1].trim() || '0' : null;
      if (!vendCode) {
        skippedNoSeller++;
        continue;
      }

      const sellerEmail = `vendedor.${vendCode}@importado.lupohub.local`;
      const sellerRow = await get(`SELECT id FROM users WHERE email = ? AND role = 'SELLER'`, [sellerEmail]);
      if (!sellerRow?.id) {
        skippedNoSeller++;
        continue;
      }

      let customerId: string | undefined;
      if (codigoRaw) {
        const t = codigoRaw.trim();
        const tryKeys = new Set<string>([t]);
        const digits = t.replace(/\D/g, '');
        if (digits) {
          tryKeys.add(digits);
          tryKeys.add(padLegacyCode(digits));
          tryKeys.add(digits.replace(/^0+/, '') || '0');
        }
        for (const k of tryKeys) {
          const hit = legacyToId.get(k);
          if (hit) {
            customerId = hit;
            break;
          }
        }
      }
      if (!customerId && clienteRaw) {
        customerId = normToId.get(normalizeNameForCustomerMatch(clienteRaw));
      }
      if (!customerId) {
        skippedNoCustomer++;
        continue;
      }

      await execute(`UPDATE customers SET seller_id = ? WHERE id = ?`, [sellerRow.id, customerId]);
      customersUpdated++;
    }

    res.json({
      message: 'Asignación de vendedores desde Resumen finalizada',
      rowsProcessed,
      customersUpdated,
      skippedNoSeller,
      skippedNoCustomer,
      skippedNoVendedorCell,
    });
  } catch (e: any) {
    console.error('assignCustomerSellersFromResumen:', e);
    res.status(500).json({ message: 'Error asignando vendedores', detail: e?.message });
  }
};

/** Quita pendientes de pedidos ya despachados para un cliente:
 *  - Si quantity > picked y picked > 0, deja quantity = picked (solo lo enviado)
 *  - Elimina solo renglones que ya estaban en 0 (nunca pedidos)
 *  - No toca pedidos ya facturados en AFIP
 *  - Recalcula total del pedido
 */
export const clearDispatchedPendingsForCustomer = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).user;
    if (!authUser || !['ADMIN', 'SELLER', 'WAREHOUSE', 'DEPOSITO'].includes(authUser.role)) {
      return res.status(403).json({ message: 'Sin permisos para quitar pendientes' });
    }

    const { id: customerId } = req.params;
    if (!customerId) return res.status(400).json({ message: 'ID de cliente requerido' });

    const customer = await get('SELECT id, seller_id FROM customers WHERE id = ?', [customerId]);
    if (!customer) return res.status(404).json({ message: 'Cliente no encontrado' });

    if (authUser.role === 'SELLER' && customer.seller_id && customer.seller_id !== authUser.id) {
      return res.status(403).json({ message: 'Solo podés operar sobre tus clientes' });
    }

    const dispatchedOrders = await query(
      `SELECT o.id FROM orders o
       WHERE o.customer_id = ?
         AND o.status IN ('Despachado', 'DISPATCHED')
         AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id)`,
      [customerId]
    );
    const orderIds = (dispatchedOrders || []).map((o: any) => o.id).filter(Boolean);
    if (orderIds.length === 0) {
      return res.json({ message: 'No hay pedidos despachados para ajustar', ordersUpdated: 0, itemsAdjusted: 0, itemsRemoved: 0 });
    }

    let itemsAdjusted = 0;
    let itemsRemoved = 0;
    let ordersUpdated = 0;

    for (const orderId of orderIds) {
      const beforeAdjust = await get(
        `SELECT COUNT(*) AS cnt
         FROM order_items
         WHERE order_id = ? AND quantity > COALESCE(picked, 0)`,
        [orderId]
      );
      const toAdjust = Number(beforeAdjust?.cnt || 0);

      if (toAdjust > 0) {
        await execute(
          `UPDATE order_items
           SET quantity = COALESCE(picked, 0)
           WHERE order_id = ?
             AND COALESCE(picked, 0) > 0
             AND quantity > COALESCE(picked, 0)`,
          [orderId]
        );
        itemsAdjusted += toAdjust;
      }

      const beforeDelete = await get(
        `SELECT COUNT(*) AS cnt
         FROM order_items
         WHERE order_id = ?
           AND COALESCE(quantity, 0) <= 0
           AND COALESCE(picked, 0) <= 0`,
        [orderId]
      );
      const toDelete = Number(beforeDelete?.cnt || 0);
      if (toDelete > 0) {
        await execute(
          `DELETE FROM order_items
           WHERE order_id = ?
             AND COALESCE(quantity, 0) <= 0
             AND COALESCE(picked, 0) <= 0`,
          [orderId]
        );
        itemsRemoved += toDelete;
      }

      const totalRow = await get(
        `SELECT COALESCE(SUM(quantity * price_at_moment), 0) AS total
         FROM order_items
         WHERE order_id = ?`,
        [orderId]
      );
      await execute(`UPDATE orders SET total = ? WHERE id = ?`, [Number(totalRow?.total || 0), orderId]);
      if (toAdjust > 0 || toDelete > 0) ordersUpdated++;
    }

    return res.json({
      message: 'Pendientes de pedidos despachados ajustados',
      ordersUpdated,
      itemsAdjusted,
      itemsRemoved
    });
  } catch (error: any) {
    console.error('clearDispatchedPendingsForCustomer:', error);
    res.status(500).json({ message: 'Error quitando pendientes de pedidos despachados' });
  }
};

type CustomerFinancialMovement = {
  fecha: string | null;
  tipo: 'FACTURA' | 'NC' | 'RECIBO';
  comprobante: string;
  orderId: string | null;
  debe: number;
  haber: number;
  detalle: string;
};

async function buildCustomerFinancialSummary(customerId: string): Promise<{
  totalFacturas: number;
  totalNc: number;
  totalRecibos: number;
  saldoPendiente: number;
  movements: CustomerFinancialMovement[];
}> {
  const movements = (await query(
    `
    SELECT
      m.fecha,
      m.tipo,
      m.comprobante,
      m.order_id AS orderId,
      m.debe,
      m.haber,
      m.detalle
    FROM (
      SELECT
        COALESCE(i.created_at, o.date) AS fecha,
        'FACTURA' AS tipo,
        CONCAT(
          CASE
            WHEN i.cbte_tipo = 1 THEN 'A '
            WHEN i.cbte_tipo = 6 THEN 'B '
            ELSE ''
          END,
          LPAD(COALESCE(i.punto_venta, 0), 5, '0'),
          '-',
          LPAD(COALESCE(i.cbte_desde, 0), 8, '0')
        ) AS comprobante,
        o.id AS order_id,
        ROUND(COALESCE(o.total, 0) * 1.21 + COALESCE(i.agip_ret_per, 0), 2) AS debe,
        0 AS haber,
        CONCAT('Pedido ', COALESCE(o.id, '')) AS detalle
      FROM invoices i
      JOIN orders o ON o.id = i.order_id
      WHERE o.customer_id = ?

      UNION ALL

      SELECT
        cn.created_at AS fecha,
        'NC' AS tipo,
        CONCAT(
          CASE
            WHEN cn.cbte_tipo = 3 THEN 'NC A '
            WHEN cn.cbte_tipo = 8 THEN 'NC B '
            ELSE 'NC '
          END,
          LPAD(COALESCE(cn.punto_venta, 0), 5, '0'),
          '-',
          LPAD(COALESCE(cn.cbte_desde, 0), 8, '0')
        ) AS comprobante,
        cn.order_id AS order_id,
        0 AS debe,
        ROUND(COALESCE(cn.amount_credited, 0) * 1.21, 2) AS haber,
        CONCAT('NC sobre pedido ', COALESCE(cn.order_id, '')) AS detalle
      FROM credit_notes cn
      JOIN orders o ON o.id = cn.order_id
      WHERE o.customer_id = ?

      UNION ALL

      SELECT
        m.fecha AS fecha,
        m.tipo AS tipo,
        CONCAT(
          CASE
            WHEN m.cbte_tipo IN (1, 3) THEN CASE WHEN m.tipo = 'NC' THEN 'NC A ' ELSE 'A ' END
            WHEN m.cbte_tipo IN (6, 8) THEN CASE WHEN m.tipo = 'NC' THEN 'NC B ' ELSE 'B ' END
            ELSE ''
          END,
          LPAD(COALESCE(m.punto_venta, 0), 5, '0'),
          '-',
          LPAD(COALESCE(m.cbte_desde, 0), 8, '0')
        ) AS comprobante,
        m.ref_order_id AS order_id,
        CASE WHEN m.tipo = 'FACTURA' THEN ROUND(m.importe_neto + COALESCE(m.agip_ret_per, 0), 2) ELSE 0 END AS debe,
        CASE WHEN m.tipo = 'NC' THEN ROUND(m.importe_neto, 2) ELSE 0 END AS haber,
        CONCAT('Comprobante manual', COALESCE(CONCAT(' · ', m.notes), '')) AS detalle
      FROM customer_manual_comprobantes m
      WHERE m.customer_id = ?

      UNION ALL

      SELECT
        o.date AS fecha,
        'PEDIDO' AS tipo,
        o.id AS comprobante,
        o.id AS order_id,
        (${SQL_ORDER_SALDO_RESIDUAL}) AS debe,
        0 AS haber,
        'Saldo pendiente del pedido' AS detalle
      FROM orders o
      LEFT JOIN (
        SELECT order_id, SUM(amount_credited) AS cn_total
        FROM credit_notes
        GROUP BY order_id
      ) cn ON cn.order_id = o.id
      WHERE o.customer_id = ?
        AND ${SQL_ORDER_ACTIVE_COND}
        AND ${SQL_ORDER_IN_SALDO_SCOPE}
        AND (${SQL_ORDER_SALDO_RESIDUAL}) > 0.005

      UNION ALL

      SELECT
        p.date AS fecha,
        'RECIBO' AS tipo,
        COALESCE(p.receipt_number, '') AS comprobante,
        p.order_id AS order_id,
        0 AS debe,
        ROUND(COALESCE(p.amount, 0), 2) AS haber,
        COALESCE(p.notes, '') AS detalle
      FROM payments p
      LEFT JOIN (
        SELECT
          e.customer_id,
          DATE(e.line_date) AS line_date,
          ROUND(COALESCE(e.importe, 0), 2) AS amount,
          UPPER(
            REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
          ) AS receipt_norm
        FROM customer_multimedia_entries e
        WHERE UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('REC', 'RECIBO', 'PAGO', 'COBRO', 'INGRESO')
          AND TRIM(COALESCE(e.numero, '')) <> ''
        GROUP BY
          e.customer_id,
          DATE(e.line_date),
          ROUND(COALESCE(e.importe, 0), 2),
          UPPER(
            REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
          )
      ) me_rec
        ON me_rec.customer_id = p.customer_id
       AND me_rec.line_date = DATE(p.date)
       AND me_rec.amount = ROUND(COALESCE(p.amount, 0), 2)
       AND me_rec.receipt_norm = CASE
         WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
         ELSE UPPER(
           REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
         )
       END
      WHERE p.customer_id = ?
        AND me_rec.customer_id IS NULL
        AND ${SQL_PAYMENT_EXCLUDE_COMMISSION_IMPORT}
    ) m
    ORDER BY m.fecha ASC, m.tipo ASC, m.comprobante ASC
    `,
    [customerId, customerId, customerId, customerId, customerId]
  )) as any[];

  const importedEntries = (await query(
    `
    SELECT
      e.line_date AS fecha,
      UPPER(TRIM(COALESCE(e.tipo, ''))) AS tipo_raw,
      COALESCE(e.numero, '') AS comprobante,
      COALESCE(e.detalle, '') AS detalle,
      COALESCE(e.importe, 0) AS importe,
      e.line_order
    FROM customer_multimedia_entries e
    WHERE e.customer_id = ?
    ORDER BY e.line_date ASC, e.line_order ASC
    `,
    [customerId]
  )) as any[];

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
  const normalizeDate = (v: any): string => {
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
  const normalizeDoc = (v: any) => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const classifyImportedEntry = (tipoRaw: string, detalleRaw: string): 'FACTURA' | 'NC' | 'RECIBO' | null => {
    const tipo = String(tipoRaw || '').toUpperCase().trim();
    const detalle = String(detalleRaw || '').toUpperCase();
    const raw = `${tipo} ${detalle}`;
    if (tipo === 'N/C' || tipo === 'NC' || /NOTA\s*CRED|N\/C\b/.test(raw)) return 'NC';
    if (tipo === 'REC' || /RECIBO|COBRO|PAGO|INGRESO|^REC$|^RC\b/.test(raw)) return 'RECIBO';
    if (tipo === 'FAC' || /FACT|FCA|FCE|DEBITO|COMPROBANTE|^FAC\b/.test(raw)) return 'FACTURA';
    return null;
  };

  const existingKeys = new Set<string>();
  const toKey = (tipo: string, fecha: any, comprobante: any, debe: number, haber: number) =>
    [
      tipo,
      normalizeDate(fecha),
      normalizeDoc(comprobante),
      Number(debe || 0).toFixed(2),
      Number(haber || 0).toFixed(2)
    ].join('|');

  for (const m of movements) {
    const tipo = String(m.tipo || '').toUpperCase();
    existingKeys.add(toKey(tipo, m.fecha, m.comprobante, Number(m.debe || 0), Number(m.haber || 0)));
  }

  for (const e of importedEntries) {
    const tipo = classifyImportedEntry(String(e.tipo_raw || ''), String(e.detalle || ''));
    if (!tipo) continue;
    const importe = Math.round(Math.abs(parseMoney(e.importe)) * 100) / 100;
    if (importe <= 0) continue;
    const debe = tipo === 'FACTURA' ? importe : 0;
    const haber = tipo === 'RECIBO' || tipo === 'NC' ? importe : 0;
    const key = toKey(tipo, e.fecha, e.comprobante, debe, haber);
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    movements.push({
      fecha: normalizeDate(e.fecha),
      tipo,
      comprobante: e.comprobante ?? '',
      orderId: null,
      debe,
      haber,
      detalle: e.detalle ? `Importado: ${e.detalle}` : 'Importado'
    });
  }

  let totalFacturas = 0;
  let totalNc = 0;
  let totalRecibos = 0;
  const mapped: CustomerFinancialMovement[] = movements.map((m) => {
    const debe = Number(m.debe || 0);
    const haber = Number(m.haber || 0);
    if (m.tipo === 'FACTURA' || m.tipo === 'PEDIDO') totalFacturas += debe;
    if (m.tipo === 'NC') totalNc += haber;
    if (m.tipo === 'RECIBO') totalRecibos += haber;
    return {
      fecha: m.fecha ?? null,
      tipo: m.tipo,
      comprobante: m.comprobante ?? '',
      orderId: m.orderId ?? null,
      debe,
      haber,
      detalle: m.detalle ?? ''
    };
  });
  mapped.sort((a, b) => {
    const da = a.fecha ? new Date(a.fecha).getTime() : 0;
    const db = b.fecha ? new Date(b.fecha).getTime() : 0;
    if (da !== db) return da - db;
    return String(a.comprobante || '').localeCompare(String(b.comprobante || ''), 'es');
  });

  totalFacturas = Math.round(totalFacturas * 100) / 100;
  totalNc = Math.round(totalNc * 100) / 100;
  totalRecibos = Math.round(totalRecibos * 100) / 100;
    const saldoPendiente = Math.round((totalFacturas - totalNc - totalRecibos) * 100) / 100;

  return {
    totalFacturas,
    totalNc,
    totalRecibos,
    saldoPendiente,
    movements: mapped
  };
}

/** Detalle por comprobante: LupoHub + líneas FAC/REC/N/C importadas (deduplicadas). El saldo de cartera usa además el último saldo de cuenta importada. */
export const getCustomerFinancialSummary = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).user;
    if (!authUser || !roleCanViewSaldos(authUser.role)) {
      return res.status(403).json({ message: 'Sin permiso para ver saldos del cliente' });
    }
    const customerId = String(req.params?.id || '').trim();
    if (!customerId) return res.status(400).json({ message: 'ID de cliente requerido' });

    const customer = await get(
      `SELECT c.id, c.business_name, c.name, c.seller_id, u.name AS seller_name
       FROM customers c
       LEFT JOIN users u ON u.id = c.seller_id
       WHERE c.id = ?`,
      [customerId]
    ) as any;
    if (!customer) return res.status(404).json({ message: 'Cliente no encontrado' });
    if (authUser.role === 'SELLER' && customer.seller_id !== authUser.id) {
      return res.status(403).json({ message: 'Solo podés ver clientes asignados a tu usuario' });
    }

    const summary = await buildCustomerFinancialSummary(customerId);
    return res.json({
      customerId: customer.id,
      customerName: customer.business_name ?? customer.name ?? 'Cliente',
      sellerName: customer.seller_name ?? customer.seller_id ?? null,
      ...summary
    });
  } catch (error: any) {
    console.error('getCustomerFinancialSummary:', error);
    return res.status(500).json({ message: 'Error obteniendo saldo de facturas y recibos' });
  }
};

/** Exporta Excel del saldo por facturas/NC/recibos para un cliente. */
export const exportCustomerFinancialSummaryXlsx = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).user;
    if (!authUser || !roleCanViewSaldos(authUser.role)) {
      return res.status(403).json({ message: 'Sin permiso para exportar saldo del cliente' });
    }
    const customerId = String(req.params?.id || '').trim();
    if (!customerId) return res.status(400).json({ message: 'ID de cliente requerido' });

    const customer = await get(
      `SELECT c.id, c.business_name, c.name, c.seller_id, u.name AS seller_name
       FROM customers c
       LEFT JOIN users u ON u.id = c.seller_id
       WHERE c.id = ?`,
      [customerId]
    ) as any;
    if (!customer) return res.status(404).json({ message: 'Cliente no encontrado' });
    if (authUser.role === 'SELLER' && customer.seller_id !== authUser.id) {
      return res.status(403).json({ message: 'Solo podés exportar clientes asignados a tu usuario' });
    }

    const summary = await buildCustomerFinancialSummary(customerId);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'LupoHub';
    wb.created = new Date();
    const ws = wb.addWorksheet('Saldo cliente');
    ws.columns = [
      { header: 'Sección', key: 'section', width: 20 },
      { header: 'Fecha', key: 'fecha', width: 14 },
      { header: 'Tipo', key: 'tipo', width: 12 },
      { header: 'Comprobante', key: 'comprobante', width: 24 },
      { header: 'Pedido', key: 'orderId', width: 18 },
      { header: 'Debe', key: 'debe', width: 14 },
      { header: 'Haber', key: 'haber', width: 14 },
      { header: 'Saldo', key: 'saldo', width: 14 },
      { header: 'Detalle', key: 'detalle', width: 42 }
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    ws.addRow({
      section: 'CLIENTE',
      comprobante: customer.id,
      detalle: `${customer.business_name || customer.name || 'Cliente'} | Vendedor: ${customer.seller_name || customer.seller_id || 'N/A'}`
    });
    ws.addRow({
      section: 'RESUMEN',
      tipo: 'SALDO',
      debe: summary.totalFacturas,
      haber: summary.totalNc + summary.totalRecibos,
      saldo: summary.saldoPendiente,
      detalle: `Facturas: ${summary.totalFacturas.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | NC: ${summary.totalNc.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | Recibos: ${summary.totalRecibos.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    });
    ws.addRow({});

    let running = 0;
    for (const m of summary.movements) {
      running = Math.round((running + m.debe - m.haber) * 100) / 100;
      ws.addRow({
        section: 'MOVIMIENTO',
        fecha: m.fecha ? new Date(m.fecha) : null,
        tipo: m.tipo,
        comprobante: m.comprobante,
        orderId: m.orderId ?? '',
        debe: m.debe,
        haber: m.haber,
        saldo: running,
        detalle: m.detalle
      });
    }

    ws.getColumn('B').numFmt = 'dd/mm/yyyy';
    ws.getColumn('F').numFmt = '#,##0.00';
    ws.getColumn('G').numFmt = '#,##0.00';
    ws.getColumn('H').numFmt = '#,##0.00';

    const out = await wb.xlsx.writeBuffer();
    const buf = Buffer.from(out instanceof ArrayBuffer ? new Uint8Array(out) : new Uint8Array(out as ArrayBufferLike));
    const filename = `saldo_facturas_recibos_${(customer.business_name || customer.name || customer.id).toString().replace(/[^\w\-]+/g, '_').slice(0, 40)}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buf);
  } catch (error: any) {
    console.error('exportCustomerFinancialSummaryXlsx:', error);
    return res.status(500).json({ message: 'Error exportando saldo de facturas y recibos' });
  }
};

/** Exporta en Excel el detalle del cliente como un único sistema de movimientos, filtrable por fecha. */
export const exportCustomerDetailXlsx = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).user;
    if (!authUser || !roleCanViewSaldos(authUser.role)) {
      return res.status(403).json({ message: 'Sin permiso para exportar detalle de cliente' });
    }
    const customerId = String(req.params?.id || '').trim();
    if (!customerId) return res.status(400).json({ message: 'ID de cliente requerido' });

    const customer = await get(
      `SELECT c.id, c.business_name, c.name, c.seller_id, u.name AS seller_name
       FROM customers c
       LEFT JOIN users u ON u.id = c.seller_id
       WHERE c.id = ?`,
      [customerId]
    );
    if (!customer) return res.status(404).json({ message: 'Cliente no encontrado' });
    if (authUser.role === 'SELLER' && customer.seller_id !== authUser.id) {
      return res.status(403).json({ message: 'Solo podés exportar clientes asignados a tu usuario' });
    }

    const from = (req.query?.from as string | undefined)?.trim();
    const to = (req.query?.to as string | undefined)?.trim();

    const entriesWhere: string[] = ['e.customer_id = ?'];
    const entriesParams: any[] = [customerId];
    if (from) { entriesWhere.push('e.line_date >= ?'); entriesParams.push(from); }
    if (to) { entriesWhere.push('e.line_date <= ?'); entriesParams.push(to); }
    const entries = await query(
      `SELECT e.line_order, e.line_date, e.tipo, e.numero, e.importe, e.saldo, e.detalle
       FROM customer_multimedia_entries e
       WHERE ${entriesWhere.join(' AND ')}
       ORDER BY e.line_date ASC, e.line_order ASC`,
      entriesParams
    ) as any[];

    const ordersWhere: string[] = ['o.customer_id = ?'];
    const ordersParams: any[] = [customerId];
    if (from) { ordersWhere.push('o.date >= ?'); ordersParams.push(from); }
    if (to) { ordersWhere.push('o.date <= ?'); ordersParams.push(to); }
    const ordersRows = await query(
      `SELECT o.id, o.date, o.status, o.total, o.payment_status
       FROM orders o
       WHERE ${ordersWhere.join(' AND ')}
       ORDER BY o.date DESC, o.id DESC`,
      ordersParams
    ) as any[];

    const paymentsWhere: string[] = ['p.customer_id = ?'];
    const paymentsParams: any[] = [customerId];
    if (from) { paymentsWhere.push('p.date >= ?'); paymentsParams.push(from); }
    if (to) { paymentsWhere.push('p.date <= ?'); paymentsParams.push(to); }
    const paymentsRows = await query(
      `SELECT
         p.date,
         p.created_at,
         p.receipt_number,
         p.amount,
         p.notes,
         p.invoice_id,
         p.order_id,
         GROUP_CONCAT(DISTINCT i.cae) AS invoice_caes,
         GROUP_CONCAT(DISTINCT pi.invoice_id) AS invoice_ids,
         GROUP_CONCAT(DISTINCT pir.invoice_ref) AS invoice_refs
       FROM payments p
       LEFT JOIN payment_invoices pi ON pi.payment_id = p.id
       LEFT JOIN payment_invoice_refs pir ON pir.payment_id = p.id
       LEFT JOIN invoices i ON i.id = COALESCE(pi.invoice_id, p.invoice_id)
       WHERE ${paymentsWhere.join(' AND ')}
       GROUP BY p.id, p.date, p.created_at, p.receipt_number, p.amount, p.notes, p.invoice_id, p.order_id
       ORDER BY p.created_at DESC, p.date DESC`,
      paymentsParams
    ) as any[];

    // Mismo criterio de la tarjeta "Saldo pendiente unificado" (sin filtro por fecha).
    const orderAgg = await get(
      `SELECT
         ROUND(COALESCE(SUM(${SQL_ORDER_SALDO_RESIDUAL}), 0), 2) AS facturas_bruto,
         ROUND(COALESCE(SUM(ROUND(LEAST(COALESCE(cn.cn_total, 0), (${SQL_ORDER_NETO_GRAVADO})) * 1.21, 2)), 0), 2) AS nc_iva
       FROM orders o
       LEFT JOIN (
         SELECT order_id, SUM(amount_credited) AS cn_total
         FROM credit_notes
         GROUP BY order_id
       ) cn ON cn.order_id = o.id
       WHERE o.customer_id = ?
         AND ${SQL_ORDER_ACTIVE_COND}
         AND ${SQL_ORDER_IN_SALDO_SCOPE}`,
      [customerId]
    ) as any;
    const multimediaAgg = await get(
      `SELECT CAST(COALESCE(
         (SELECT CAST(e_lo.saldo AS DECIMAL(16,2))
          FROM customer_multimedia_entries e_lo
          WHERE e_lo.customer_id = ?
          ORDER BY e_lo.line_order DESC
          LIMIT 1),
         (SELECT CAST(e2.saldo AS DECIMAL(16,2))
          FROM customer_multimedia_entries e2
          WHERE e2.customer_id = ? AND e2.saldo IS NOT NULL
          ORDER BY e2.line_order DESC
          LIMIT 1),
         0
       ) AS DECIMAL(16,2)) AS multimediaSaldo`,
      [customerId, customerId]
    ) as any;
    const paymentsAgg = await get(
      `SELECT ROUND(COALESCE(SUM(d.amount), 0), 2) AS totalPagos
       FROM (
         SELECT
           p.customer_id,
           ROUND(COALESCE(p.amount, 0), 2) AS amount,
           DATE(p.date) AS pay_date,
           CASE
             WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
             ELSE UPPER(
               REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
             )
           END AS receipt_norm
         FROM payments p
         LEFT JOIN (
           SELECT
             e.customer_id,
             DATE(e.line_date) AS line_date,
             ROUND(COALESCE(e.importe, 0), 2) AS amount,
             UPPER(
               REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
             ) AS receipt_norm
           FROM customer_multimedia_entries e
           WHERE UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('REC', 'RECIBO', 'PAGO', 'COBRO', 'INGRESO')
             AND TRIM(COALESCE(e.numero, '')) <> ''
           GROUP BY
             e.customer_id,
             DATE(e.line_date),
             ROUND(COALESCE(e.importe, 0), 2),
             UPPER(
               REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
             )
         ) me_rec
           ON me_rec.customer_id = p.customer_id
          AND me_rec.line_date = DATE(p.date)
          AND me_rec.amount = ROUND(COALESCE(p.amount, 0), 2)
          AND me_rec.receipt_norm = CASE
            WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
            ELSE UPPER(
              REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
            )
          END
         WHERE p.customer_id = ?
           AND me_rec.customer_id IS NULL
           AND ${SQL_PAYMENT_UNALLOCATED_COND}
           AND ${SQL_PAYMENT_EXCLUDE_COMMISSION_IMPORT}
         GROUP BY
           p.customer_id,
           DATE(p.date),
           ROUND(COALESCE(p.amount, 0), 2),
           CASE
             WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
             ELSE UPPER(
               REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
             )
           END
       ) d`,
      [customerId]
    ) as any;
    const manualAgg = await get(
      `SELECT
         ROUND(COALESCE(SUM(CASE WHEN tipo = 'FACTURA' THEN importe_neto + COALESCE(agip_ret_per, 0) ELSE 0 END), 0), 2) AS manual_fac,
         ROUND(COALESCE(SUM(CASE WHEN tipo = 'NC' THEN importe_neto ELSE 0 END), 0), 2) AS manual_nc
       FROM customer_manual_comprobantes
       WHERE customer_id = ?`,
      [customerId]
    ) as any;
    const facturasBruto =
      Number(orderAgg?.facturas_bruto || 0) + Number(manualAgg?.manual_fac || 0);
    const ncIva = Number(orderAgg?.nc_iva || 0) + Number(manualAgg?.manual_nc || 0);
    const multimediaSaldo = Number(multimediaAgg?.multimediaSaldo || 0);
    const totalPagos = Number(paymentsAgg?.totalPagos || 0);
    const saldoUnificado = Math.round(
      (multimediaSaldo + facturasBruto - ncIva - totalPagos) * 100
    ) / 100;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'LupoHub';
    wb.created = new Date();
    const ws = wb.addWorksheet('Detalle cliente');
    ws.columns = [
      { header: 'Sección', key: 'section', width: 20 },
      { header: 'Fecha', key: 'fecha', width: 14 },
      { header: 'Movimiento', key: 'tipo', width: 20 },
      { header: 'Referencia', key: 'numero', width: 22 },
      { header: 'Monto', key: 'importe', width: 16 },
      { header: 'Detalle', key: 'detalle', width: 42 }
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    ws.addRow({
      section: 'CLIENTE',
      fecha: '',
      tipo: '',
      numero: customer.id,
      importe: '',
      detalle: `${customer.business_name || customer.name || 'Cliente'} | Vendedor: ${customer.seller_name || customer.seller_id || 'N/A'}`
    });
    ws.addRow({ section: '', fecha: '', tipo: '', numero: '', importe: '', detalle: '' });
    ws.addRow({
      section: 'RESUMEN',
      fecha: '',
      tipo: 'SALDO UNIFICADO',
      numero: '',
      importe: saldoUnificado,
      detalle: ''
    });
    ws.addRow({ section: '', fecha: '', tipo: '', numero: '', importe: '', detalle: '' });

    const timelineRows: Array<{
      section: string;
      fecha: Date | null;
      tipo: string;
      numero: string;
      importe: number | null;
      saldo: number | null;
      detalle: string;
      sortTs: number;
      sortSeq: number;
      sortNumero: string;
    }> = [];

    const normalizeDateKey = (d: Date | null) => {
      if (!d || Number.isNaN(d.getTime())) return '';
      return d.toISOString().slice(0, 10);
    };
    const normalizeNumberKey = (v: any) => String(v || '').trim().toUpperCase();
    const normalizeAmountKey = (v: any) => Number(v || 0).toFixed(2);
    const normalizeUnifiedType = (tipo: any) => {
      const t = String(tipo || '').trim().toUpperCase();
      if (t === 'NC' || t === 'NOTA DE CREDITO' || t === 'NOTA DE CRÉDITO') return 'NC';
      if (t === 'REC' || t === 'RECIBO' || t === 'PAGO' || t === 'COBRO' || t === 'INGRESO') return 'REC';
      if (t === 'FAC' || t === 'FACTURA' || t === 'CARGO') return 'FAC';
      return t || '';
    };

    for (const e of entries) {
      const fecha = e.line_date ? new Date(e.line_date) : null;
      const ts = fecha && !Number.isNaN(fecha.getTime()) ? fecha.getTime() : Number.MAX_SAFE_INTEGER;
      timelineRows.push({
        section: 'SISTEMA',
        fecha,
        tipo: normalizeUnifiedType(e.tipo),
        numero: e.numero ?? '',
        importe: e.importe != null ? Number(e.importe) : null,
        // En modo unificado no mostramos saldo histórico por línea importada.
        saldo: null,
        detalle: e.detalle ?? '',
        sortTs: ts,
        sortSeq: Number(e.line_order || 0),
        sortNumero: String(e.numero || '')
      });
    }

    for (const o of ordersRows) {
      const fecha = o.date ? new Date(o.date) : null;
      const ts = fecha && !Number.isNaN(fecha.getTime()) ? fecha.getTime() : Number.MAX_SAFE_INTEGER;
      timelineRows.push({
        section: 'SISTEMA',
        fecha,
        tipo: 'FAC',
        numero: o.id ?? '',
        importe: Number(o.total || 0),
        saldo: null,
        detalle: `Cobro: ${o.payment_status || 'pendiente'}`,
        sortTs: ts,
        sortSeq: 1000000,
        sortNumero: String(o.id || '')
      });
    }

    for (const p of paymentsRows) {
      const fecha = p.date ? new Date(p.date) : null;
      const ts = fecha && !Number.isNaN(fecha.getTime()) ? fecha.getTime() : Number.MAX_SAFE_INTEGER;
      const caes = Array.from(
        new Set(String(p.invoice_caes || '').split(',').map((x: string) => x.trim()).filter(Boolean))
      );
      const caeFromNumero = String(p.receipt_number || '').trim();
      timelineRows.push({
        section: 'SISTEMA',
        fecha,
        tipo: 'REC',
        numero: p.receipt_number ?? '',
        importe: Number(p.amount || 0),
        saldo: null,
        detalle: `Factura (CAE): ${caeFromNumero || (caes.length ? caes.join(' | ') : '-')}${p.notes ? ` | ${p.notes}` : ''}`,
        sortTs: ts,
        sortSeq: 2000000,
        sortNumero: String(p.receipt_number || '')
      });
    }

    // Evitar duplicados de REC (importado + sistema) por misma fecha/número/importe.
    // Se prioriza el registro del sistema (sortSeq mayor, detalle más trazable).
    const paymentByKey = new Map<string, (typeof timelineRows)[number]>();
    const nonPaymentRows: Array<(typeof timelineRows)[number]> = [];
    for (const row of timelineRows) {
      if (row.tipo !== 'REC') {
        nonPaymentRows.push(row);
        continue;
      }
      const key = [
        normalizeDateKey(row.fecha),
        normalizeNumberKey(row.numero),
        normalizeAmountKey(row.importe)
      ].join('|');
      const existing = paymentByKey.get(key);
      if (!existing || row.sortSeq > existing.sortSeq) {
        paymentByKey.set(key, row);
      }
    }
    const dedupedPaymentRows = Array.from(paymentByKey.values());
    timelineRows.length = 0;
    timelineRows.push(...nonPaymentRows, ...dedupedPaymentRows);

    timelineRows.sort((a, b) => {
      if (a.sortTs !== b.sortTs) return a.sortTs - b.sortTs;
      if (a.sortSeq !== b.sortSeq) return a.sortSeq - b.sortSeq;
      return a.sortNumero.localeCompare(b.sortNumero);
    });

    for (const row of timelineRows) {
      ws.addRow({
        section: row.section,
        fecha: row.fecha,
        tipo: row.tipo,
        numero: row.numero,
        importe: row.importe,
        detalle: row.detalle
      });
    }

    ws.getColumn('B').numFmt = 'dd/mm/yyyy';
    ws.getColumn('E').numFmt = '#,##0.00';
    const out = await wb.xlsx.writeBuffer();
    const buf = Buffer.from(out instanceof ArrayBuffer ? new Uint8Array(out) : new Uint8Array(out as ArrayBufferLike));
    const filename = `cliente_detalle_${(customer.business_name || customer.name || customer.id).toString().replace(/[^\w\-]+/g, '_').slice(0, 40)}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buf);
  } catch (error: any) {
    console.error('exportCustomerDetailXlsx:', error);
    return res.status(500).json({ message: 'Error exportando detalle del cliente' });
  }
};
