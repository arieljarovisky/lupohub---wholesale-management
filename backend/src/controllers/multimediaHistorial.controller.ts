import { Request, Response } from 'express';
import * as XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import { query, execute, get } from '../database/db';
import {
  parseCustomerSheetRows,
  parseSheetName,
  parseArgentineDateDisplay,
  sqlDateToDisplay,
  excelSheetName,
  parseResumenCodeToCliente,
  padLegacyCode,
  normalizeCuitDigits,
  type MultimediaMovementRow,
} from '../utils/multimediaHistorialExcel';
import { INCLUDE_TANGO_IMPORT_IN_SYSTEM } from '../sql/carteraImportedSql';
import { invoiceLedgerImporte, ncLedgerImporte } from '../config/orderPricing';
import {
  backfillPaymentOrdersFromLegacy,
  SQL_ORDER_IN_SALDO_SCOPE,
  SQL_ORDER_NETO_GRAVADO,
  SQL_ORDER_SALDO_RESIDUAL
} from '../services/orderPaymentBalance.service';
import { normalizeLedgerDocType } from '../utils/ledgerDocType';
import {
  applyLedgerRunningSaldo,
  applyLedgerRunningSaldoSimple,
  filterSystemDuplicatesAgainstImport,
  ledgerMovementDedupeKey,
} from '../utils/ledgerRunningSaldo';

const SQL_ORDER_ACTIVE_COND = `o.status NOT IN ('Cancelado', 'Borrador') AND (o.archived = 0 OR o.archived IS NULL)`;

function normalizeNameForMatch(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function canManage(role?: string): boolean {
  return role === 'ADMIN' || role === 'SELLER' || role === 'WAREHOUSE' || role === 'DEPOSITO';
}

/** Número AFIP al estilo Tango/Multimedias: A00021000000006 (sin guiones). */
function formatLedgerAfipNumero(cbteTipo: number, puntoVta: number, cbteDesde: number): string {
  const letra =
    cbteTipo === 1 || cbteTipo === 3
      ? 'A'
      : cbteTipo === 6 || cbteTipo === 8
        ? 'B'
        : cbteTipo === 11 || cbteTipo === 13
          ? 'C'
          : 'X';
  return `${letra}${String(puntoVta || 0).padStart(5, '0')}${String(cbteDesde || 0).padStart(8, '0')}`;
}

function tryFuzzyNameMatch(
  normSheet: string,
  customerByNorm: Map<string, { id: string; seller_id: string | null }>
): { id: string; seller_id: string | null } | null {
  if (!normSheet || normSheet.length < 5) return null;
  if (customerByNorm.has(normSheet)) return customerByNorm.get(normSheet)!;
  for (const [k, v] of customerByNorm) {
    if (k.length < 5) continue;
    if (normSheet === k) return v;
    if (normSheet.startsWith(k) || k.startsWith(normSheet)) return v;
    if (k.length >= 8 && normSheet.includes(k)) return v;
    if (normSheet.length >= 8 && k.includes(normSheet)) return v;
  }
  return null;
}

async function resolveCustomerForSheet(
  sheetName: string,
  parsed: ReturnType<typeof parseCustomerSheetRows>,
  customerByLegacy: Map<string, { id: string; seller_id: string | null }>,
  customerByNorm: Map<string, { id: string; seller_id: string | null }>,
  customerByCuit: Map<string, { id: string; seller_id: string | null }>,
  resumenByCode: Map<string, string>
): Promise<{ id: string; seller_id: string | null } | null> {
  const fromName = parseSheetName(sheetName);
  const codeCandidates = new Set<string>();
  if (parsed?.code) codeCandidates.add(padLegacyCode(parsed.code));
  if (fromName?.code) codeCandidates.add(padLegacyCode(fromName.code));
  for (const c of codeCandidates) {
    const hit = customerByLegacy.get(c) || customerByLegacy.get(c.replace(/^0+/, '') || '0');
    if (hit) return hit;
  }

  const cuitParsed = normalizeCuitDigits(parsed?.cuitFromSheet || '');
  if (cuitParsed.length >= 8) {
    const byCuit = customerByCuit.get(cuitParsed);
    if (byCuit) return byCuit;
  }

  for (const c of codeCandidates) {
    const resumenCliente = resumenByCode.get(c);
    if (resumenCliente) {
      const nr = normalizeNameForMatch(resumenCliente);
      if (nr && customerByNorm.has(nr)) return customerByNorm.get(nr)!;
      const fuzzyR = tryFuzzyNameMatch(nr, customerByNorm);
      if (fuzzyR) return fuzzyR;
    }
  }

  const normTitle = normalizeNameForMatch(parsed?.businessNameFromTitle || '');
  if (normTitle && customerByNorm.has(normTitle)) return customerByNorm.get(normTitle)!;
  const fuzzyTitle = tryFuzzyNameMatch(normTitle, customerByNorm);
  if (fuzzyTitle) return fuzzyTitle;

  if (fromName?.restName) {
    const n = normalizeNameForMatch(fromName.restName);
    if (n && customerByNorm.has(n)) return customerByNorm.get(n)!;
    const fuzzyN = tryFuzzyNameMatch(n, customerByNorm);
    if (fuzzyN) return fuzzyN;
  }
  return null;
}

function movementToSqlDates(m: MultimediaMovementRow): { lineDate: string | null; vto: string | null } {
  const lineDate = parseArgentineDateDisplay(m.fecha);
  const vtoRaw = m.vto.trim();
  const vto = vtoRaw ? parseArgentineDateDisplay(vtoRaw) : null;
  return { lineDate, vto };
}

/** GET → Excel mismo formato que historial Multimedias */
export const exportMultimediaHistorial = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user || !canManage(user.role)) {
      return res.status(403).json({ message: 'Sin permiso' });
    }

    const sellerFilter = user.role === 'SELLER' ? ' WHERE c.seller_id = ?' : '';
    const params: any[] = user.role === 'SELLER' ? [user.id] : [];

    const custRows = (await query(
      `SELECT c.id, c.legacy_code, c.business_name, c.name, c.account_zone, c.account_seller_label,
              c.seller_id, u.name AS seller_name
       FROM customers c
       LEFT JOIN users u ON u.id = c.seller_id
       ${sellerFilter}
       ORDER BY COALESCE(c.legacy_code, c.business_name, c.name) ASC`,
      params
    )) as any[];

    const resumenRows: (string | number)[][] = [
      ['Código', 'Cliente', 'Vendedor habitual', 'Zona', 'Saldo final', 'Movimientos', 'Hoja'],
    ];

    const sheetsOut: { name: string; data: (string | number)[][] }[] = [];
    const usedSheetNames = new Set<string>();

    for (const c of custRows) {
      const code =
        (c.legacy_code && String(c.legacy_code).trim()) ||
        (String(c.id).replace(/-/g, '').slice(0, 6) || '000000');
      const displayName = (c.business_name || c.name || 'Cliente').trim();
      const baseTitle = excelSheetName(code, displayName);
      let sheetNm = baseTitle.slice(0, 31);
      let dup = 1;
      while (usedSheetNames.has(sheetNm)) {
        const extra = ` (${dup++})`;
        sheetNm = (baseTitle.slice(0, Math.max(1, 31 - extra.length)) + extra).slice(0, 31);
      }
      usedSheetNames.add(sheetNm);

      const entries = (await query(
        `SELECT line_order, line_date, tipo, numero, edc, vto, importe, saldo, detalle, pagina_pdf
         FROM customer_multimedia_entries
         WHERE customer_id = ?
         ORDER BY line_order ASC, line_date ASC`,
        [c.id]
      )) as any[];

      const vendedor =
        (c.account_seller_label && String(c.account_seller_label).trim()) ||
        (c.seller_id && c.seller_name ? `${String(c.seller_id).slice(0, 8)} - ${c.seller_name}` : '');
      const zona = (c.account_zone && String(c.account_zone).trim()) || '';

      let saldoFinal = 0;
      let movCount = entries.length;
      if (entries.length > 0) {
        const last = entries[entries.length - 1];
        saldoFinal = Number(last.saldo) || 0;
      }

      resumenRows.push([code, displayName, vendedor, zona, saldoFinal, movCount, sheetNm]);

      const grid: (string | number)[][] = [];
      grid.push([`Cliente ${code} - ${displayName}`, '', '', '', '', '', '', '', '']);
      grid.push([
        'Código',
        code,
        'Vendedor habitual',
        vendedor,
        'Zona',
        zona,
        'Saldo final',
        saldoFinal,
        '',
      ]);
      grid.push(['', '', '', '', '', '', '', '', '']);
      grid.push(['Fecha', 'Tipo', 'Número', 'EDC', 'Vto.', 'Importe', 'Saldo', 'Vendedor / detalle', 'Página PDF']);

      if (entries.length === 0) {
        grid.push(['31/12/2014', 'SALDO AL', '', '', '', '', 0, 'Saldo inicial', 1]);
      } else {
        for (const e of entries) {
          grid.push([
            sqlDateToDisplay(e.line_date),
            e.tipo ?? '',
            e.numero ?? '',
            e.edc ?? '',
            e.vto ? sqlDateToDisplay(e.vto) : '',
            e.importe != null ? Number(e.importe) : '',
            e.saldo != null ? Number(e.saldo) : '',
            e.detalle ?? '',
            e.pagina_pdf != null && e.pagina_pdf !== '' ? Number(e.pagina_pdf) || e.pagina_pdf : '',
          ]);
        }
      }

      sheetsOut.push({ name: sheetNm.slice(0, 31), data: grid });
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumenRows), 'Resumen');
    for (const s of sheetsOut) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.data), s.name);
    }

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="historial_clientes_multimedias.xlsx"');
    res.send(buf);
  } catch (e: any) {
    console.error('exportMultimediaHistorial:', e);
    res.status(500).json({ message: 'Error exportando historial', detail: e?.message });
  }
};

/** POST multipart file → importa movimientos por cliente */
export const importMultimediaHistorial = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user || !canManage(user.role)) {
      return res.status(403).json({ message: 'Sin permiso' });
    }

    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file?.buffer) {
      return res.status(400).json({ message: 'Subí un archivo .xlsx (campo file)' });
    }

    const wb = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });

    let resumenByCode = new Map<string, string>();
    const resumenWs = wb.Sheets['Resumen'];
    if (resumenWs) {
      const resumenMatrix = XLSX.utils.sheet_to_json(resumenWs, { header: 1, defval: '' }) as (
        | string
        | number
        | null
        | undefined
      )[][];
      resumenByCode = parseResumenCodeToCliente(resumenMatrix);
    }

    const customers = (await query(
      `SELECT id, business_name, name, seller_id, legacy_code, cuit FROM customers`
    )) as {
      id: string;
      business_name?: string | null;
      name?: string | null;
      seller_id?: string | null;
      legacy_code?: string | null;
      cuit?: string | null;
    }[];

    const customerByLegacy = new Map<string, { id: string; seller_id: string | null }>();
    const customerByNorm = new Map<string, { id: string; seller_id: string | null }>();
    const customerByCuit = new Map<string, { id: string; seller_id: string | null }>();
    for (const c of customers) {
      if (c.legacy_code) {
        const lc = String(c.legacy_code).trim();
        if (lc) {
          customerByLegacy.set(lc, { id: c.id, seller_id: c.seller_id ?? null });
          customerByLegacy.set(padLegacyCode(lc), { id: c.id, seller_id: c.seller_id ?? null });
        }
      }
      const k1 = normalizeNameForMatch(c.business_name);
      const k2 = normalizeNameForMatch(c.name);
      if (k1 && !customerByNorm.has(k1)) customerByNorm.set(k1, { id: c.id, seller_id: c.seller_id ?? null });
      if (k2 && !customerByNorm.has(k2)) customerByNorm.set(k2, { id: c.id, seller_id: c.seller_id ?? null });
      const cu = normalizeCuitDigits(c.cuit);
      if (cu.length >= 8 && !customerByCuit.has(cu)) {
        customerByCuit.set(cu, { id: c.id, seller_id: c.seller_id ?? null });
      }
    }

    let sheetsProcessed = 0;
    let customersUpdated = 0;
    let rowsInserted = 0;
    const notFound: string[] = [];
    const skippedSeller: string[] = [];

    for (const sheetName of wb.SheetNames) {
      if (sheetName === 'Resumen') continue;
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;
      const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as (string | number | null | undefined)[][];
      const parsed = parseCustomerSheetRows(matrix);
      if (!parsed) continue;

      const cust = await resolveCustomerForSheet(
        sheetName,
        parsed,
        customerByLegacy,
        customerByNorm,
        customerByCuit,
        resumenByCode
      );
      if (!cust) {
        notFound.push(sheetName);
        continue;
      }
      if (user.role === 'SELLER' && cust.seller_id !== user.id) {
        skippedSeller.push(sheetName);
        continue;
      }

      sheetsProcessed++;
      const legacy = padLegacyCode(parsed.code || parseSheetName(sheetName)?.code || '');
      await execute(
        `UPDATE customers SET legacy_code = ?, account_zone = ?, account_seller_label = ? WHERE id = ?`,
        [legacy || null, parsed.zona?.trim() || null, parsed.vendedorHabitual?.trim() || null, cust.id]
      );
      customersUpdated++;

      await execute(`DELETE FROM customer_multimedia_entries WHERE customer_id = ?`, [cust.id]);

      let order = 0;
      for (const m of parsed.movements) {
        const { lineDate, vto } = movementToSqlDates(m);
        if (!lineDate) continue;
        const tipo = (m.tipo || '').trim();
        if (!tipo) continue;

        await execute(
          `INSERT INTO customer_multimedia_entries
           (id, customer_id, line_order, line_date, tipo, numero, edc, vto, importe, saldo, detalle, pagina_pdf)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(),
            cust.id,
            order++,
            lineDate,
            tipo,
            m.numero?.trim() || null,
            m.edc?.trim() || null,
            vto,
            m.importe,
            m.saldo,
            m.detalle?.trim() || null,
            m.paginaPdf?.trim() || null,
          ]
        );
        rowsInserted++;
      }

      if (legacy) {
        customerByLegacy.set(legacy, cust);
        customerByLegacy.set(padLegacyCode(legacy), cust);
      }
    }

    res.json({
      message: 'Importación de historial Multimedias finalizada',
      sheetsProcessed,
      customersUpdated,
      rowsInserted,
      notFoundSheets: notFound.slice(0, 50),
      notFoundCount: notFound.length,
      skippedNotYourCustomer: skippedSeller.slice(0, 20),
      skippedCount: skippedSeller.length,
    });
  } catch (e: any) {
    console.error('importMultimediaHistorial:', e);
    res.status(500).json({ message: 'Error importando historial', detail: e?.message });
  }
};

/** GET /customers/:id/multimedia-ledger — movimientos importados (Excel Tango/Multimedias) para la ficha del cliente. */
export const getCustomerMultimediaLedger = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user || !canManage(user.role)) {
      return res.status(403).json({ message: 'Sin permiso' });
    }
    const { id } = req.params;
    const cust = (await get(
      `SELECT id, seller_id, business_name, legacy_code, account_zone, account_seller_label, opening_balance, opening_balance_date FROM customers WHERE id = ?`,
      [id]
    )) as {
      id: string;
      seller_id: string | null;
      business_name: string | null;
      legacy_code: string | null;
      account_zone: string | null;
      account_seller_label: string | null;
      opening_balance?: number | string | null;
      opening_balance_date?: string | Date | null;
    } | undefined;
    if (!cust) return res.status(404).json({ message: 'Cliente no encontrado' });
    if (user.role === 'SELLER' && cust.seller_id !== user.id) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    const openingBalance =
      cust.opening_balance != null && cust.opening_balance !== ''
        ? Math.round(Number(cust.opening_balance) * 100) / 100
        : 0;
    const openingBalanceDate =
      cust.opening_balance_date != null && String(cust.opening_balance_date).trim()
        ? String(cust.opening_balance_date).slice(0, 10)
        : null;
    const movementOnOrAfterOpening = (lineDate: unknown) => {
      if (!openingBalanceDate) return true;
      const d = lineDate == null ? '' : String(lineDate).slice(0, 10);
      if (!d) return true;
      return d >= openingBalanceDate;
    };
    await backfillPaymentOrdersFromLegacy();
    const entries = INCLUDE_TANGO_IMPORT_IN_SYSTEM
      ? ((await query(
          `SELECT line_order, line_date, tipo, numero, edc, vto, importe, saldo, detalle, pagina_pdf
       FROM customer_multimedia_entries WHERE customer_id = ? ORDER BY line_order ASC, line_date ASC`,
          [id]
        )) as any[])
      : [];
    const paymentEntries = (await query(
      `SELECT
         p.id,
         p.date,
         p.created_at,
         p.receipt_number,
         p.amount,
         p.notes,
         p.invoice_id,
         p.order_id,
         GROUP_CONCAT(DISTINCT pi.invoice_id) AS invoice_ids,
         GROUP_CONCAT(DISTINCT pir.invoice_ref) AS invoice_refs,
         GROUP_CONCAT(DISTINCT po.order_id) AS payment_order_ids
       FROM payments p
       LEFT JOIN payment_invoices pi ON pi.payment_id = p.id
       LEFT JOIN payment_invoice_refs pir ON pir.payment_id = p.id
       LEFT JOIN payment_orders po ON po.payment_id = p.id
       WHERE p.customer_id = ?
       GROUP BY p.id, p.date, p.created_at, p.receipt_number, p.amount, p.notes, p.invoice_id, p.order_id
       ORDER BY p.created_at ASC, p.date ASC`,
      [id]
    )) as any[];
    const orderSaldoRows = (await query(
      `SELECT
         o.id AS order_id,
         o.date AS order_date,
         o.remito_number,
         (${SQL_ORDER_SALDO_RESIDUAL}) AS residual
       FROM orders o
       LEFT JOIN (
         SELECT order_id, SUM(amount_credited) AS cn_total
         FROM credit_notes
         WHERE COALESCE(superseded_by_reinvoice, 0) = 0
         GROUP BY order_id
       ) cn ON cn.order_id = o.id
       LEFT JOIN invoices i ON i.order_id = o.id
       WHERE o.customer_id = ?
         AND ${SQL_ORDER_ACTIVE_COND}
         AND ${SQL_ORDER_IN_SALDO_SCOPE}
         AND i.id IS NULL
         AND (${SQL_ORDER_SALDO_RESIDUAL}) > 0.005
       ORDER BY o.date ASC, o.id ASC`,
      [id]
    )) as any[];
    const invoiceRows = (await query(
      `SELECT
         i.id,
         i.order_id,
         i.cbte_tipo,
         i.punto_venta,
         i.cbte_desde,
         COALESCE(DATE(i.created_at), o.date) AS line_date,
         i.agip_ret_per,
         o.total,
         o.date AS order_date
       FROM invoices i
       JOIN orders o ON o.id = i.order_id
       WHERE o.customer_id = ?
       ORDER BY i.created_at ASC, i.id ASC`,
      [id]
    )) as any[];
    const creditNoteRows = (await query(
      `SELECT
         cn.id,
         cn.order_id,
         cn.cbte_tipo,
         cn.punto_venta,
         cn.cbte_desde,
         cn.created_at,
         cn.amount_credited
       FROM credit_notes cn
       JOIN orders o ON o.id = cn.order_id
       WHERE o.customer_id = ?
       ORDER BY cn.created_at ASC, cn.id ASC`,
      [id]
    )) as any[];
    let manualComprobanteRows: any[] = [];
    try {
      manualComprobanteRows = (await query(
        `SELECT id, tipo, fecha, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, importe_neto, agip_ret_per, notes, ref_order_id, sin_detalle, pdf_path, created_at
         FROM customer_manual_comprobantes
         WHERE customer_id = ?
         ORDER BY fecha ASC, created_at ASC`,
        [id]
      )) as any[];
    } catch {
      manualComprobanteRows = (await query(
        `SELECT id, tipo, fecha, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, importe_neto, agip_ret_per, notes, ref_order_id, created_at
         FROM customer_manual_comprobantes
         WHERE customer_id = ?
         ORDER BY fecha ASC, created_at ASC`,
        [id]
      )) as any[];
    }
    const normalizeDocType = (tipo: any, detalle: any) => normalizeLedgerDocType(tipo, detalle);
    const maxLineOrder = entries.reduce((m, e) => Math.max(m, Number(e.line_order || 0)), 0);
    const orderSaldoAsEntries = orderSaldoRows.filter((ord) => movementOnOrAfterOpening(ord.order_date)).map((ord, idx) => {
      const residual = Math.round(Number(ord.residual || 0) * 100) / 100;
      const numero =
        ord.remito_number != null && Number(ord.remito_number) > 0
          ? String(Number(ord.remito_number))
          : String(ord.order_id || '').slice(0, 12);
      return {
        lineOrder: maxLineOrder + 50000 + idx,
        lineDate: ord.order_date,
        tipo: 'PED',
        numero,
        edc: null,
        vto: null,
        importe: residual > 0 ? residual : null,
        saldo: null,
        detalle: `Pedido ${ord.order_id || ''} · Saldo pendiente (sin factura)`,
        paginaPdf: null,
        source: 'system' as const
      };
    });
    const invoiceAsEntries = invoiceRows.filter((inv) => movementOnOrAfterOpening(inv.line_date || inv.order_date)).map((inv, idx) => {
      const importe = invoiceLedgerImporte(Number(inv.total || 0), Number(inv.agip_ret_per || 0));
      const numero = formatLedgerAfipNumero(
        Number(inv.cbte_tipo || 0),
        Number(inv.punto_venta || 0),
        Number(inv.cbte_desde || 0)
      );
      return {
        lineOrder: maxLineOrder + 55000 + idx,
        lineDate: inv.line_date || inv.order_date,
        tipo: 'FAC',
        numero,
        edc: null,
        vto: null,
        importe: importe > 0 ? importe : null,
        saldo: null,
        detalle: `Pedido ${inv.order_id || ''} · Factura AFIP LupoHub`,
        paginaPdf: null,
        source: 'system' as const
      };
    });
    const creditNoteAsEntries = creditNoteRows.filter((cn) => movementOnOrAfterOpening(cn.created_at)).map((cn, idx) => {
      const importe = ncLedgerImporte(Number(cn.amount_credited || 0));
      const numero = formatLedgerAfipNumero(
        Number(cn.cbte_tipo || 0),
        Number(cn.punto_venta || 0),
        Number(cn.cbte_desde || 0)
      );
      return {
        lineOrder: maxLineOrder + 60000 + idx,
        lineDate: cn.created_at,
        tipo: 'NC',
        numero,
        edc: null,
        vto: null,
        importe: importe > 0 ? importe : null,
        saldo: null,
        detalle: `Pedido ${cn.order_id || ''} · NC AFIP LupoHub`,
        paginaPdf: null,
        source: 'system' as const
      };
    });
    const manualComprobanteAsEntries = manualComprobanteRows.filter((m) => movementOnOrAfterOpening(m.fecha || m.created_at)).map((m, idx) => {
      const importe =
        m.tipo === 'FACTURA'
          ? Math.round((Number(m.importe_neto || 0) + Number(m.agip_ret_per || 0)) * 100) / 100
          : Math.round(Number(m.importe_neto || 0) * 100) / 100;
      const sinDetalle = !!Number(m.sin_detalle);
      const numero = sinDetalle
        ? 'Sin nº AFIP'
        : formatLedgerAfipNumero(
            Number(m.cbte_tipo || 0),
            Number(m.punto_venta || 0),
            Number(m.cbte_desde || 0)
          );
      const tipoLabel = m.tipo === 'NC' ? 'NC' : 'FAC';
      const detalleExtra = m.notes ? String(m.notes).trim() : '';
      const pdfNote = m.pdf_path ? ' · PDF adjunto' : '';
      const pedidoRef = m.ref_order_id ? `Pedido ${m.ref_order_id}` : 'Sin pedido';
      return {
        lineOrder: maxLineOrder + 70000 + idx,
        lineDate: m.fecha || m.created_at,
        tipo: tipoLabel,
        numero,
        edc: null,
        vto: null,
        importe: importe > 0 ? importe : null,
        saldo: null,
        detalle: `${pedidoRef} · Comprobante manual${pdfNote}${detalleExtra ? ` · ${detalleExtra}` : ''}`,
        paginaPdf: null,
        manualComprobanteId: m.id,
        source: 'system' as const
      };
    });
    const paymentAsEntries = paymentEntries.filter((p) => movementOnOrAfterOpening(p.date)).map((p, idx) => {
      const invoiceRefs = Array.from(new Set([
        ...String(p.invoice_ids || p.invoice_id || '').split(',').map((x: string) => x.trim()).filter(Boolean),
        ...String(p.invoice_refs || '').split(',').map((x: string) => x.trim()).filter(Boolean),
      ]));
      const orderRefs = Array.from(new Set([
        ...String(p.payment_order_ids || '').split(',').map((x: string) => x.trim()).filter(Boolean),
        ...(p.order_id ? [String(p.order_id).trim()] : []),
      ])).filter((oid) => oid && !oid.startsWith('mm-'));
      const parts: string[] = [];
      if (invoiceRefs.length) parts.push(`Factura(s): ${invoiceRefs.join(' | ')}`);
      if (orderRefs.length) parts.push(`Pedido(s): ${orderRefs.join(' | ')}`);
      const refsText = parts.length ? parts.join(' · ') : 'Sin imputar';
      const detail = `${refsText}${p.notes ? ` | ${String(p.notes).trim()}` : ''}`;
      return {
        lineOrder: maxLineOrder + 100000 + idx,
        lineDate: p.date,
        tipo: 'REC',
        numero: p.receipt_number || '',
        edc: null,
        vto: null,
        importe: p.amount != null ? Number(p.amount) : null,
        saldo: null,
        detalle: detail,
        paginaPdf: null,
        source: 'system'
      };
    });
    const mergedEntries = [
      ...(INCLUDE_TANGO_IMPORT_IN_SYSTEM
        ? entries.filter((e) => movementOnOrAfterOpening(e.line_date)).map((e) => ({
            lineOrder: e.line_order,
            lineDate: e.line_date,
            tipo: e.tipo,
            numero: e.numero,
            edc: e.edc,
            vto: e.vto,
            importe: e.importe != null ? Number(e.importe) : null,
            saldo: e.saldo != null ? Number(e.saldo) : null,
            detalle: e.detalle,
            paginaPdf: e.pagina_pdf,
            source: 'imported' as const
          }))
        : []),
      ...orderSaldoAsEntries,
      ...invoiceAsEntries,
      ...creditNoteAsEntries,
      ...manualComprobanteAsEntries,
      ...paymentAsEntries
    ];

    // Unificación real: evitar duplicados entre importado y sistema.
    const deduped: any[] = [];
    const movementByKey = new Map<string, any>();
    for (const row of mergedEntries) {
      const tipoNorm = normalizeDocType(row.tipo, row.detalle);
      if (!['REC', 'FAC', 'NC', 'ND', 'PED'].includes(tipoNorm)) {
        deduped.push(row);
        continue;
      }
      const key =
        ledgerMovementDedupeKey({
          tipo: row.tipo,
          detalle: row.detalle,
          lineDate: row.lineDate,
          numero: row.numero,
          importe: row.importe,
        }) + (String(row.detalle || '').includes('AFIP LupoHub') ? '|LH' : '');
      const prev = movementByKey.get(key);
      if (!prev) {
        movementByKey.set(key, row);
      } else {
        // Priorizar registro del sistema actual sobre importado al detectar duplicado.
        const prevSystem = prev.source === 'system';
        const rowSystem = row.source === 'system';
        if (!prevSystem && rowSystem) movementByKey.set(key, row);
      }
    }
    deduped.push(...Array.from(movementByKey.values()));
    const unified = filterSystemDuplicatesAgainstImport(deduped);
    unified.sort((a, b) => {
      const da = new Date(a.lineDate || 0).getTime() || 0;
      const db = new Date(b.lineDate || 0).getTime() || 0;
      if (da !== db) return da - db;
      return Number(a.lineOrder || 0) - Number(b.lineOrder || 0);
    });
    if (Math.abs(openingBalance) > 0.005) {
      const fechaLabel = openingBalanceDate
        ? openingBalanceDate.split('-').reverse().join('/')
        : '';
      unified.unshift({
        lineOrder: -1,
        lineDate: openingBalanceDate || null,
        tipo: 'SALDO',
        numero: 'INICIAL',
        edc: null,
        vto: null,
        importe: openingBalance,
        saldo: null,
        detalle: fechaLabel
          ? `Saldo inicial manual al ${fechaLabel}`
          : 'Saldo inicial manual',
        paginaPdf: null,
        source: 'system' as const
      });
    }
    applyLedgerRunningSaldo(unified);
    const lastSaldo = applyLedgerRunningSaldoSimple(unified);
    for (const row of unified) {
      row.saldo = row.saldoCorrido ?? null;
    }

    res.json({
      customerId: id,
      legacyCode: cust.legacy_code ?? null,
      accountZone: cust.account_zone ?? null,
      accountSellerLabel: cust.account_seller_label ?? null,
      movementCount: unified.length,
      lastSaldo,
      entries: unified
    });
  } catch (e: any) {
    console.error('getCustomerMultimediaLedger:', e);
    res.status(500).json({ message: 'Error leyendo historial importado', detail: e?.message });
  }
};

/** GET /customers/multimedia-saldos-summary — último saldo por cliente (Excel importado) para las cards de cartera. */
export const getMultimediaSaldosSummary = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user || !canManage(user.role)) {
      return res.status(403).json({ message: 'Sin permiso' });
    }
    if (!INCLUDE_TANGO_IMPORT_IN_SYSTEM) {
      return res.json([]);
    }
    const sellerFilter = user.role === 'SELLER' ? ' AND c.seller_id = ?' : '';
    const params: any[] = user.role === 'SELLER' ? [user.id] : [];

    const rows = (await query(
      `SELECT
         agg.customer_id AS customerId,
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
         agg.cnt AS movementCount
       FROM (
         SELECT customer_id, COUNT(*) AS cnt
         FROM customer_multimedia_entries
         GROUP BY customer_id
       ) agg
       INNER JOIN customers c ON c.id = agg.customer_id
       WHERE 1=1${sellerFilter}`,
      params
    )) as any[];

    res.json(
      (rows || []).map((r) => ({
        customerId: r.customerId,
        lastSaldo: Number(r.lastSaldo) || 0,
        movementCount: Number(r.movementCount) || 0
      }))
    );
  } catch (e: any) {
    console.error('getMultimediaSaldosSummary:', e);
    res.status(500).json({ message: 'Error leyendo saldos importados', detail: e?.message });
  }
};
