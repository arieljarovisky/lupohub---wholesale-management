/**
 * Exporta recibos de LupoHub a Excel.
 *
 * Uso:
 *   npx ts-node scripts/export-all-receipts.ts [ruta_salida.xlsx]
 *   npx ts-node scripts/export-all-receipts.ts --sistema [ruta_salida.xlsx]
 *
 * --sistema  Solo recibos cargados en LupoHub (tabla payments), con columnas extra.
 */
import path from 'path';
import * as XLSX from 'xlsx';
import { query } from '../src/database/db';

type ReceiptRow = {
  origen: string;
  fecha: string;
  numeroRecibo: string;
  importe: number;
  cliente: string;
  cuit: string;
  ciudad: string;
  codigoCliente: string;
  vendedor: string;
  imputado: string;
  notas: string;
  facturasVinculadas: string;
  pedidosVinculados: string;
  fechaCarga: string;
  horaCarga: string;
  id: string;
};

function parseMoney(v: unknown): number {
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

function normalizeDate(v: unknown): string {
  if (typeof v === 'string') {
    const raw = v.trim();
    const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  }
  const d = new Date(v as string | number | Date);
  if (Number.isNaN(d.getTime())) return String(v || '').slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function formatTime(v: unknown): string {
  if (!v) return '';
  const d = new Date(v as string | number | Date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function normalizeNumber(v: unknown): string {
  return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeAmount(v: unknown): string {
  return parseMoney(v).toFixed(2);
}

function formatInvoiceLabel(r: {
  invoice_punto_venta?: number | null;
  invoice_cbte_tipo?: number | null;
  invoice_cbte_desde?: number | null;
}): string {
  if (r.invoice_punto_venta == null && r.invoice_cbte_desde == null) return '';
  const tipo =
    r.invoice_cbte_tipo === 1 ? 'A ' :
    r.invoice_cbte_tipo === 6 ? 'B ' :
    r.invoice_cbte_tipo === 11 ? 'C ' : '';
  const pv = String(r.invoice_punto_venta ?? 0).padStart(5, '0');
  const nro = String(r.invoice_cbte_desde ?? 0).padStart(8, '0');
  return `${tipo}${pv}-${nro}`;
}

async function fetchSystemReceipts(): Promise<ReceiptRow[]> {
  const systemRows = (await query(`
    SELECT
      p.id, p.customer_id, p.receipt_number, p.date, p.amount, p.notes, p.created_at,
      p.order_id, p.invoice_id,
      c.business_name AS customer_business_name, c.name AS customer_name,
      c.cuit AS customer_cuit, c.city AS customer_city, c.legacy_code AS customer_legacy_code,
      u.name AS seller_name,
      i.punto_venta AS invoice_punto_venta, i.cbte_tipo AS invoice_cbte_tipo, i.cbte_desde AS invoice_cbte_desde,
      GROUP_CONCAT(DISTINCT pi.invoice_id) AS invoice_ids,
      GROUP_CONCAT(DISTINCT po.order_id) AS order_ids,
      GROUP_CONCAT(DISTINCT pir.invoice_ref) AS invoice_refs,
      GROUP_CONCAT(DISTINCT CONCAT(
        CASE
          WHEN inv2.cbte_tipo = 1 THEN 'A '
          WHEN inv2.cbte_tipo = 6 THEN 'B '
          WHEN inv2.cbte_tipo = 11 THEN 'C '
          ELSE ''
        END,
        LPAD(COALESCE(inv2.punto_venta, 0), 5, '0'),
        '-',
        LPAD(COALESCE(inv2.cbte_desde, 0), 8, '0')
      ) SEPARATOR ', ') AS invoice_labels,
      CASE
        WHEN EXISTS (SELECT 1 FROM payment_orders po_u WHERE po_u.payment_id = p.id)
          OR EXISTS (SELECT 1 FROM payment_invoices pi_u WHERE pi_u.payment_id = p.id)
          OR (p.invoice_id IS NOT NULL AND TRIM(COALESCE(p.invoice_id, '')) <> '')
          OR (p.order_id IS NOT NULL AND TRIM(COALESCE(p.order_id, '')) <> '')
        THEN 'Sí'
        ELSE 'No'
      END AS imputado
    FROM payments p
    JOIN customers c ON c.id = p.customer_id
    LEFT JOIN users u ON u.id = COALESCE(p.seller_id, c.seller_id)
    LEFT JOIN invoices i ON i.id = p.invoice_id
    LEFT JOIN payment_invoices pi ON pi.payment_id = p.id
    LEFT JOIN invoices inv2 ON inv2.id = pi.invoice_id
    LEFT JOIN payment_orders po ON po.payment_id = p.id
    LEFT JOIN payment_invoice_refs pir ON pir.payment_id = p.id
    GROUP BY p.id, p.customer_id, p.receipt_number, p.date, p.amount, p.notes, p.created_at,
             p.order_id, p.invoice_id, c.business_name, c.name, c.cuit, c.city, c.legacy_code,
             u.name, i.punto_venta, i.cbte_tipo, i.cbte_desde
    ORDER BY p.date DESC, p.created_at DESC
  `)) as any[];

  return systemRows.map((r) => {
    const invoiceLabels = Array.from(new Set([
      ...String(r.invoice_labels || '').split(',').map((x: string) => x.trim()).filter(Boolean),
      ...String(r.invoice_refs || '').split(',').map((x: string) => x.trim()).filter(Boolean),
      formatInvoiceLabel(r),
    ].filter(Boolean)));

    const orderIds = Array.from(new Set(
      String(r.order_ids || r.order_id || '').split(',').map((x: string) => x.trim()).filter(Boolean)
    ));

    return {
      origen: 'Sistema',
      fecha: normalizeDate(r.date),
      numeroRecibo: String(r.receipt_number || ''),
      importe: Math.round((Number(r.amount) || 0) * 100) / 100,
      cliente: String(r.customer_business_name || r.customer_name || ''),
      cuit: String(r.customer_cuit || ''),
      ciudad: String(r.customer_city || ''),
      codigoCliente: String(r.customer_legacy_code || ''),
      vendedor: String(r.seller_name || ''),
      imputado: String(r.imputado || 'No'),
      notas: String(r.notes || ''),
      facturasVinculadas: invoiceLabels.join(', '),
      pedidosVinculados: orderIds.join(', '),
      fechaCarga: r.created_at ? normalizeDate(r.created_at) : '',
      horaCarga: r.created_at ? formatTime(r.created_at) : '',
      id: String(r.id),
    };
  });
}

async function fetchImportedReceipts(existingKeys: Set<string>): Promise<ReceiptRow[]> {
  const importedRows = (await query(`
    SELECT
      e.customer_id, e.line_order, e.line_date, e.numero, e.importe, e.detalle,
      c.business_name AS customer_business_name, c.name AS customer_name,
      c.cuit AS customer_cuit, c.city AS customer_city, c.legacy_code AS customer_legacy_code,
      u.name AS seller_name
    FROM customer_multimedia_entries e
    JOIN customers c ON c.id = e.customer_id
    LEFT JOIN users u ON u.id = c.seller_id
    WHERE UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'REC%'
    ORDER BY e.line_date DESC, e.line_order DESC
  `)) as any[];

  const out: ReceiptRow[] = [];
  for (const r of importedRows) {
    const fecha = normalizeDate(r.line_date);
    const key = [fecha, normalizeNumber(r.numero), normalizeAmount(r.importe)].join('|');
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);

    out.push({
      origen: 'Importado Tango',
      fecha,
      numeroRecibo: String(r.numero || ''),
      importe: Math.round(parseMoney(r.importe) * 100) / 100,
      cliente: String(r.customer_business_name || r.customer_name || ''),
      cuit: String(r.customer_cuit || ''),
      ciudad: String(r.customer_city || ''),
      codigoCliente: String(r.customer_legacy_code || ''),
      vendedor: String(r.seller_name || ''),
      imputado: '',
      notas: r.detalle ? `Importado Tango: ${r.detalle}` : 'Importado Tango',
      facturasVinculadas: '',
      pedidosVinculados: '',
      fechaCarga: '',
      horaCarga: '',
      id: `mm-${r.customer_id}-${r.line_order}`,
    });
  }
  return out;
}

function buildSheet(receipts: ReceiptRow[], sistemaOnly: boolean) {
  const headers = sistemaOnly
    ? [
        'Fecha',
        'Nº Recibo',
        'Importe',
        'Cliente',
        'CUIT',
        'Ciudad',
        'Cód. cliente',
        'Vendedor',
        'Imputado',
        'Facturas vinculadas',
        'Pedidos vinculados',
        'Notas',
        'Fecha carga',
        'Hora carga',
        'ID interno',
      ]
    : [
        'Origen',
        'Fecha',
        'Nº Recibo',
        'Importe',
        'Cliente',
        'CUIT',
        'Ciudad',
        'Cód. cliente',
        'Vendedor',
        'Imputado',
        'Notas',
        'Facturas vinculadas',
        'Pedidos vinculados',
        'Fecha carga',
        'Hora carga',
        'ID interno',
      ];

  const data = receipts.map((r) =>
    sistemaOnly
      ? [
          r.fecha, r.numeroRecibo, r.importe, r.cliente, r.cuit, r.ciudad, r.codigoCliente,
          r.vendedor, r.imputado, r.facturasVinculadas, r.pedidosVinculados, r.notas,
          r.fechaCarga, r.horaCarga, r.id,
        ]
      : [
          r.origen, r.fecha, r.numeroRecibo, r.importe, r.cliente, r.cuit, r.ciudad, r.codigoCliente,
          r.vendedor, r.imputado, r.notas, r.facturasVinculadas, r.pedidosVinculados,
          r.fechaCarga, r.horaCarga, r.id,
        ]
  );

  const totalImporte = receipts.reduce((s, r) => s + r.importe, 0);
  const imputados = receipts.filter((r) => r.imputado === 'Sí').length;
  const sinImputar = receipts.filter((r) => r.imputado === 'No').length;

  const ws = XLSX.utils.aoa_to_sheet([
    headers,
    ...data,
    [],
    ['TOTAL RECIBOS', receipts.length, '', Math.round(totalImporte * 100) / 100],
    ...(sistemaOnly
      ? [['Imputados', imputados], ['Sin imputar', sinImputar]]
      : [
          ['Sistema', receipts.filter((r) => r.origen === 'Sistema').length],
          ['Importado Tango', receipts.filter((r) => r.origen === 'Importado Tango').length],
        ]),
  ]);

  ws['!cols'] = headers.map((h) => ({
    wch: h.includes('Notas') ? 50 : h.includes('Cliente') ? 40 : h.includes('Facturas') || h.includes('Pedidos') ? 30 : 16,
  }));

  return ws;
}

async function main() {
  const args = process.argv.slice(2);
  const sistemaOnly = args.includes('--sistema');
  const outArg = args.find((a) => !a.startsWith('--'));
  const dateTag = new Date().toISOString().slice(0, 10);

  const outPath =
    outArg ||
    path.join(
      process.env.USERPROFILE || process.env.HOME || process.cwd(),
      'Desktop',
      sistemaOnly
        ? `recibos_lupohub_sistema_${dateTag}.xlsx`
        : `recibos_lupohub_${dateTag}.xlsx`
    );

  const systemReceipts = await fetchSystemReceipts();
  let receipts: ReceiptRow[];

  if (sistemaOnly) {
    receipts = systemReceipts;
  } else {
    const existingKeys = new Set(
      systemReceipts.map((p) => [p.fecha, normalizeNumber(p.numeroRecibo), normalizeAmount(p.importe)].join('|'))
    );
    const imported = await fetchImportedReceipts(existingKeys);
    receipts = [...systemReceipts, ...imported];
    receipts.sort((a, b) => {
      const da = new Date(a.fecha).getTime() || 0;
      const db = new Date(b.fecha).getTime() || 0;
      if (db !== da) return db - da;
      return a.numeroRecibo.localeCompare(b.numeroRecibo);
    });
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSheet(receipts, sistemaOnly), sistemaOnly ? 'Recibos sistema' : 'Recibos');
  XLSX.writeFile(wb, outPath);

  const totalImporte = receipts.reduce((s, r) => s + r.importe, 0);
  console.log(
    sistemaOnly
      ? `Exportados ${receipts.length} recibos del sistema`
      : `Exportados ${receipts.length} recibos (${systemReceipts.length} sistema + ${receipts.length - systemReceipts.length} importados Tango)`
  );
  console.log(`Total importe: $${totalImporte.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`);
  console.log(`Archivo: ${outPath}`);
}

main().catch((e) => {
  console.error('Error exportando recibos:', e?.message || e);
  process.exit(1);
});
