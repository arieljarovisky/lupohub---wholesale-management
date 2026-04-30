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
      `SELECT id, seller_id, business_name, legacy_code, account_zone, account_seller_label FROM customers WHERE id = ?`,
      [id]
    )) as {
      id: string;
      seller_id: string | null;
      business_name: string | null;
      legacy_code: string | null;
      account_zone: string | null;
      account_seller_label: string | null;
    } | undefined;
    if (!cust) return res.status(404).json({ message: 'Cliente no encontrado' });
    if (user.role === 'SELLER' && cust.seller_id !== user.id) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    const entries = (await query(
      `SELECT line_order, line_date, tipo, numero, edc, vto, importe, saldo, detalle, pagina_pdf
       FROM customer_multimedia_entries WHERE customer_id = ? ORDER BY line_order ASC, line_date ASC`,
      [id]
    )) as any[];
    const paymentEntries = (await query(
      `SELECT
         p.id,
         p.date,
         p.created_at,
         p.receipt_number,
         p.amount,
         p.notes,
         p.invoice_id,
         GROUP_CONCAT(DISTINCT pi.invoice_id) AS invoice_ids,
         GROUP_CONCAT(DISTINCT pir.invoice_ref) AS invoice_refs
       FROM payments p
       LEFT JOIN payment_invoices pi ON pi.payment_id = p.id
       LEFT JOIN payment_invoice_refs pir ON pir.payment_id = p.id
       WHERE p.customer_id = ?
       GROUP BY p.id, p.date, p.created_at, p.receipt_number, p.amount, p.notes, p.invoice_id
       ORDER BY p.created_at ASC, p.date ASC`,
      [id]
    )) as any[];
    let lastSaldo = 0;
    if (entries.length > 0) {
      const tail = entries[entries.length - 1];
      if (tail.saldo != null) {
        lastSaldo = Number(tail.saldo) || 0;
      } else {
        for (let i = entries.length - 1; i >= 0; i--) {
          if (entries[i].saldo != null) {
            lastSaldo = Number(entries[i].saldo) || 0;
            break;
          }
        }
      }
    }
    const maxLineOrder = entries.reduce((m, e) => Math.max(m, Number(e.line_order || 0)), 0);
    const paymentAsEntries = paymentEntries.map((p, idx) => {
      const refs = Array.from(new Set([
        ...String(p.invoice_ids || p.invoice_id || '').split(',').map((x: string) => x.trim()).filter(Boolean),
        ...String(p.invoice_refs || '').split(',').map((x: string) => x.trim()).filter(Boolean),
      ]));
      const refsText = refs.length ? `Factura(s): ${refs.join(' | ')}` : 'Factura(s): -';
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
      ...entries.map((e) => ({
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
        source: 'imported'
      })),
      ...paymentAsEntries
    ];

    // Unificación real: evitar REC duplicados (importado + sistema).
    const deduped: any[] = [];
    const recByKey = new Map<string, any>();
    for (const row of mergedEntries) {
      const tipoNorm = String(row.tipo || '').trim().toUpperCase();
      if (tipoNorm !== 'REC') {
        deduped.push(row);
        continue;
      }
      const key = [
        String(row.lineDate || '').slice(0, 10),
        String(row.numero || '').trim().toUpperCase(),
        Number(row.importe || 0).toFixed(2),
      ].join('|');
      const prev = recByKey.get(key);
      if (!prev) {
        recByKey.set(key, row);
      } else {
        // Priorizar el registro del sistema actual por tener referencias de factura reales.
        const prevSystem = prev.source === 'system';
        const rowSystem = row.source === 'system';
        if (!prevSystem && rowSystem) recByKey.set(key, row);
      }
    }
    deduped.push(...Array.from(recByKey.values()));
    deduped.sort((a, b) => {
      const da = new Date(a.lineDate || 0).getTime() || 0;
      const db = new Date(b.lineDate || 0).getTime() || 0;
      if (da !== db) return da - db;
      return Number(a.lineOrder || 0) - Number(b.lineOrder || 0);
    });

    res.json({
      customerId: id,
      legacyCode: cust.legacy_code ?? null,
      accountZone: cust.account_zone ?? null,
      accountSellerLabel: cust.account_seller_label ?? null,
      movementCount: deduped.length,
      lastSaldo,
      entries: deduped
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
