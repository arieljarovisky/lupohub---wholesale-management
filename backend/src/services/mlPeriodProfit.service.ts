import axios from 'axios';
import ExcelJS from 'exceljs';
import { randomUUID } from 'crypto';
import { get, query } from '../database/db';
import { getValidMLToken } from '../controllers/integrations.controller';
import { fobForItem, loadCompanyFobList, skuFromMlItem } from './companyFinancePnl.service';

export type MlChannelInvoice = {
  month: string;
  amount: number;
  invoiceNumber: string | null;
  notes: string | null;
};

export type MlPeriodLine = {
  itemId: string;
  variationId: string;
  title: string;
  sku: string;
  productName: string;
  pack: number;
  packSource: string;
  titlePack: number | null;
  fobUnit: number | null;
  qty: number;
  sales: number;
  orders: number;
  cogs: number;
  profit: number | null;
};

export type MlPeriodProfit = {
  from: string;
  to: string;
  month: string;
  fobListName: string | null;
  orderCount: number;
  salesTotal: number;
  salesWithFob: number;
  salesWithoutFob: number;
  cogs: number;
  grossProfit: number;
  invoice: MlChannelInvoice | null;
  netProfit: number;
  unitsSold: number;
  unitsReal: number;
  withFob: MlPeriodLine[];
  withoutFob: MlPeriodLine[];
};

type PubInfo = {
  packSize: number;
  productId: string;
  sku: string;
  name: string;
  productPack: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function monthBounds(month: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) return null;
  const last = new Date(year, mon, 0).getDate();
  const mm = String(mon).padStart(2, '0');
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, '0')}` };
}

function packFromText(text: string): number | null {
  const t = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (/\btripack\b|\btri\s*pack\b/.test(t)) return 3;
  const patterns = [
    /pack\s*x\s*(\d{1,2})\b/,
    /pack\s+de\s+(\d{1,2})\b/,
    /pack\s+(\d{1,2})\b/,
    /\b(\d{1,2})\s*x\b/,
    /\bx\s*(\d{1,2})\b/,
  ];
  for (const re of patterns) {
    const match = t.match(re);
    if (!match) continue;
    const n = Number(match[1]);
    if (n >= 2 && n <= 12) return n;
  }
  return null;
}

async function multigetMlItems(accessToken: string, itemIds: string[]) {
  const map = new Map<string, Record<string, unknown>>();
  const unique = [...new Set(itemIds.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 20) {
    const chunk = unique.slice(i, i + 20);
    try {
      const res = await axios.get('https://api.mercadolibre.com/items', {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { ids: chunk.join(',') },
        validateStatus: () => true,
      });
      if (res.status !== 200 || !Array.isArray(res.data)) continue;
      for (const entry of res.data) {
        const body = (entry as { body?: Record<string, unknown> })?.body;
        const id = String(body?.id ?? '');
        if (id && body) map.set(id, body);
      }
    } catch {
      /* omitir lote */
    }
  }
  return map;
}

export async function getMlChannelInvoice(month: string): Promise<MlChannelInvoice | null> {
  const row = (await get(
    `SELECT period_month, amount, invoice_number, notes
     FROM ml_channel_invoices WHERE period_month = ?`,
    [month]
  )) as { period_month: string; amount: number | string; invoice_number: string | null; notes: string | null } | null;
  if (!row) return null;
  return {
    month: String(row.period_month),
    amount: round2(Number(row.amount) || 0),
    invoiceNumber: row.invoice_number ? String(row.invoice_number) : null,
    notes: row.notes ? String(row.notes) : null,
  };
}

export async function saveMlChannelInvoice(input: {
  month: string;
  amount: number;
  invoiceNumber?: string | null;
  notes?: string | null;
}): Promise<MlChannelInvoice> {
  const invoiceNumber = String(input.invoiceNumber || '').trim().slice(0, 64) || null;
  const notes = String(input.notes || '').trim().slice(0, 500) || null;
  const amount = round2(Math.max(0, Number(input.amount) || 0));
  await query(
    `INSERT INTO ml_channel_invoices (id, period_month, amount, invoice_number, notes)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       amount = VALUES(amount),
       invoice_number = VALUES(invoice_number),
       notes = VALUES(notes)`,
    [randomUUID(), input.month, amount, invoiceNumber, notes]
  );
  return {
    month: input.month,
    amount,
    invoiceNumber,
    notes,
  };
}

export async function computeMlPeriodProfit(from: string, to: string): Promise<MlPeriodProfit> {
  const mlToken = await getValidMLToken();
  if (!mlToken?.access_token || !mlToken.user_id) {
    throw new Error('Mercado Libre no está conectado');
  }

  const month = from.slice(0, 7);
  const [fobInfo, pubRows, productRows, invoice] = await Promise.all([
    loadCompanyFobList(),
    query(
      `SELECT vp.external_product_id, vp.external_variant_id, vp.pack_size,
              p.id AS productId, p.sku, p.name,
              COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS productPack
       FROM variant_publications vp
       JOIN product_variants pv ON pv.id = vp.variant_id
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       WHERE vp.platform = 'mercadolibre'`
    ) as Promise<
      Array<{
        external_product_id: string;
        external_variant_id: string | null;
        pack_size: number;
        productId: string;
        sku: string | null;
        name: string | null;
        productPack: number;
      }>
    >,
    query(
      `SELECT id, sku, name, COALESCE(NULLIF(mercado_libre_pack_size, 0), 1) AS productPack,
              NULLIF(TRIM(mercado_libre_id), '') AS mlId
       FROM products`
    ) as Promise<
      Array<{ id: string; sku: string | null; name: string | null; productPack: number; mlId: string | null }>
    >,
    getMlChannelInvoice(month),
  ]);

  const byKey = new Map<string, PubInfo>();
  const put = (key: string, info: PubInfo) => {
    const prev = byKey.get(key);
    if (!prev || info.packSize > prev.packSize) byKey.set(key, info);
  };
  for (const r of pubRows) {
    const item = String(r.external_product_id || '').trim().toUpperCase();
    if (!item) continue;
    const variant = String(r.external_variant_id || '').trim();
    const info: PubInfo = {
      packSize: Math.max(1, Number(r.pack_size) || 1),
      productId: String(r.productId),
      sku: String(r.sku || '').trim(),
      name: String(r.name || '').trim(),
      productPack: Math.max(1, Number(r.productPack) || 1),
    };
    put(`${item}|${variant}`, info);
    if (!variant || variant.toUpperCase() === item) put(`${item}|`, info);
  }

  const productById = new Map<string, { sku: string; name: string; productPack: number }>();
  const productByMl = new Map<string, { productId: string; sku: string; name: string; productPack: number }>();
  for (const p of productRows) {
    const rec = {
      sku: String(p.sku || '').trim(),
      name: String(p.name || '').trim(),
      productPack: Math.max(1, Number(p.productPack) || 1),
    };
    productById.set(String(p.id), rec);
    if (p.mlId) productByMl.set(String(p.mlId).trim().toUpperCase(), { productId: String(p.id), ...rec });
  }

  type RawLine = {
    orderId: string;
    itemId: string;
    variationId: string;
    title: string;
    sku: string;
    qty: number;
    unitPrice: number;
  };
  const lines: RawLine[] = [];
  const orderIds = new Set<string>();
  let offset = 0;
  const limit = 50;
  while (offset < 5000) {
    const searchRes = await axios.get('https://api.mercadolibre.com/orders/search', {
      headers: { Authorization: `Bearer ${mlToken.access_token}` },
      params: {
        seller: mlToken.user_id,
        'order.status': 'paid',
        'order.date_created.from': `${from}T00:00:00.000-03:00`,
        'order.date_created.to': `${to}T23:59:59.999-03:00`,
        offset,
        limit,
        sort: 'date_desc',
      },
      validateStatus: () => true,
    });
    if (searchRes.status !== 200) break;
    const results = Array.isArray(searchRes.data?.results) ? searchRes.data.results : [];
    if (results.length === 0) break;
    for (const order of results) {
      const created = String(order?.date_created ?? order?.date_closed ?? '');
      const ymd = created.slice(0, 10);
      if (ymd < from || ymd > to) continue;
      orderIds.add(String(order?.id ?? ''));
      const items = Array.isArray(order?.order_items) ? order.order_items : [];
      for (const oi of items) {
        const item = oi?.item ?? {};
        const itemId = String(item?.id ?? '').trim();
        const qty = Math.max(0, Number(oi?.quantity) || 0);
        const unitPrice = Math.max(0, Number(oi?.unit_price) || 0);
        if (!itemId || qty <= 0 || unitPrice <= 0) continue;
        lines.push({
          orderId: String(order?.id ?? ''),
          itemId,
          variationId: item?.variation_id != null ? String(item.variation_id).trim() : '',
          title: String(item?.title ?? '').trim(),
          sku: String(item?.seller_sku ?? item?.seller_custom_field ?? '').trim(),
          qty,
          unitPrice,
        });
      }
    }
    if (results.length < limit) break;
    offset += limit;
  }

  const itemsMap = await multigetMlItems(
    mlToken.access_token,
    lines.map((l) => l.itemId)
  );

  type Agg = MlPeriodLine & { orderSet: Set<string> };
  const groups = new Map<string, Agg>();

  for (const line of lines) {
    const itemKey = line.itemId.trim().toUpperCase();
    const pub =
      (line.variationId && byKey.get(`${itemKey}|${line.variationId}`)) ||
      byKey.get(`${itemKey}|${line.itemId}`) ||
      byKey.get(`${itemKey}|`) ||
      undefined;
    const byMl = productByMl.get(itemKey);
    const productId = pub?.productId || byMl?.productId || null;
    const product = productId ? productById.get(productId) : undefined;
    const mlItem = itemsMap.get(line.itemId);
    const sku = line.sku || pub?.sku || byMl?.sku || product?.sku || skuFromMlItem(mlItem);
    const title = line.title || String(mlItem?.title ?? '');
    const productName = pub?.name || byMl?.name || product?.name || '';
    const titlePack = packFromText(title);
    const namePack = packFromText(productName);

    let pack = 1;
    let packSource = 'unidad';
    if (titlePack && titlePack > 1) {
      pack = titlePack;
      packSource = 'título';
    } else if (pub && pub.packSize > 1) {
      pack = pub.packSize;
      packSource = 'publicación';
    } else if (!pub && (byMl?.productPack || 0) > 1) {
      pack = byMl!.productPack;
      packSource = 'producto';
    } else if (namePack && namePack > 1) {
      pack = namePack;
      packSource = 'nombre del producto';
    }

    const fobUnit = fobForItem(fobInfo, productId, sku, sku);
    const key = [itemKey, line.variationId, sku, pack, fobUnit == null ? '0' : '1'].join('|');
    let g = groups.get(key);
    if (!g) {
      g = {
        itemId: line.itemId,
        variationId: line.variationId,
        title,
        sku,
        productName,
        pack,
        packSource,
        titlePack,
        fobUnit,
        qty: 0,
        sales: 0,
        orders: 0,
        cogs: 0,
        profit: null,
        orderSet: new Set(),
      };
      groups.set(key, g);
    }
    g.qty += line.qty;
    g.sales += line.unitPrice * line.qty;
    g.orderSet.add(line.orderId);
    if (!g.title && title) g.title = title;
  }

  const finalized: MlPeriodLine[] = [...groups.values()].map((g) => {
    const sales = round2(g.sales);
    const cogs = g.fobUnit == null ? 0 : round2(g.fobUnit * g.pack * g.qty);
    return {
      itemId: g.itemId,
      variationId: g.variationId,
      title: g.title,
      sku: g.sku,
      productName: g.productName,
      pack: g.pack,
      packSource: g.packSource,
      titlePack: g.titlePack,
      fobUnit: g.fobUnit,
      qty: g.qty,
      sales,
      orders: g.orderSet.size,
      cogs,
      profit: g.fobUnit == null ? null : round2(sales - cogs),
    };
  });

  const withFob = finalized.filter((g) => g.fobUnit != null).sort((a, b) => b.sales - a.sales);
  const withoutFob = finalized.filter((g) => g.fobUnit == null).sort((a, b) => b.sales - a.sales);
  const salesTotal = round2(finalized.reduce((s, g) => s + g.sales, 0));
  const salesWithFob = round2(withFob.reduce((s, g) => s + g.sales, 0));
  const salesWithoutFob = round2(withoutFob.reduce((s, g) => s + g.sales, 0));
  const cogs = round2(withFob.reduce((s, g) => s + g.cogs, 0));
  const grossProfit = round2(salesWithFob - cogs);
  const invoiceAmount = invoice?.amount ?? 0;

  return {
    from,
    to,
    month,
    fobListName: fobInfo.name || null,
    orderCount: orderIds.size,
    salesTotal,
    salesWithFob,
    salesWithoutFob,
    cogs,
    grossProfit,
    invoice,
    netProfit: round2(grossProfit - invoiceAmount),
    unitsSold: finalized.reduce((s, g) => s + g.qty, 0),
    unitsReal: finalized.reduce((s, g) => s + g.qty * g.pack, 0),
    withFob,
    withoutFob,
  };
}

function money(cell: ExcelJS.Cell) {
  cell.numFmt = '"$"#,##0.00';
}

function headerRow(ws: ExcelJS.Worksheet, headers: string[]) {
  const row = ws.addRow(headers);
  row.font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  row.alignment = { vertical: 'middle', wrapText: true };
  row.height = 22;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

export async function buildMlPeriodProfitWorkbook(data: MlPeriodProfit): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LupoHub';
  wb.created = new Date();

  const resumen = wb.addWorksheet('Resumen');
  resumen.columns = [{ width: 52 }, { width: 28 }, { width: 70 }];
  const title = resumen.addRow([`Ganancia Mercado Libre — ${data.month}`]);
  title.font = { name: 'Calibri', bold: true, size: 16 };
  resumen.mergeCells('A1:C1');
  resumen.addRow(['Período', `${data.from} al ${data.to}`]);
  resumen.addRow(['Lista de costo', data.fobListName || 'FOB']);
  resumen.addRow([
    'Costo de mercadería',
    'FOB de una unidad × cantidad del pack × unidades vendidas. Un Pack x3 descuenta 3 veces el FOB.',
  ]);
  resumen.addRow([]);
  const head = resumen.addRow(['Concepto', 'Importe', 'Detalle']);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };

  const addMoney = (label: string, value: number, detail: string, bold = false) => {
    const row = resumen.addRow([label, value, detail]);
    money(row.getCell(2));
    if (bold) row.font = { bold: true, size: 12 };
    return row;
  };

  resumen.addRow(['Órdenes pagadas', data.orderCount, '']);
  resumen.addRow(['Publicaciones con FOB', data.withFob.length, '']);
  resumen.addRow(['Publicaciones sin FOB', data.withoutFob.length, 'Ver hoja Sin FOB']);
  resumen.addRow([]);
  addMoney('Ventas con costo FOB', data.salesWithFob, 'Entran en la ganancia');
  addMoney('Costo de mercadería', data.cogs, 'FOB × pack × cantidad');
  addMoney('Ganancia antes de la factura', data.grossProfit, 'Ventas con FOB − mercadería');
  addMoney(
    'Factura Mercado Libre',
    data.invoice?.amount ?? 0,
    data.invoice?.invoiceNumber ? `Comprobante ${data.invoice.invoiceNumber}` : 'Importe a pagar cargado en Márgenes'
  );
  const net = addMoney('Ganancia neta', data.netProfit, 'Mercadería y factura descontadas', true);
  net.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
  net.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
  resumen.addRow([]);
  addMoney('Ventas sin FOB (aparte)', data.salesWithoutFob, 'No se les descontó mercadería');

  const con = wb.addWorksheet('Con FOB');
  headerRow(con, [
    'Publicación',
    'Variación',
    'Título',
    'SKU',
    'Producto',
    'Pack',
    'Origen del pack',
    'FOB unitario',
    'Cantidad vendida',
    'Unidades reales',
    'Ventas',
    'Costo mercadería',
    'Ganancia',
    'Órdenes',
  ]);
  con.columns = [
    { width: 18 },
    { width: 16 },
    { width: 46 },
    { width: 16 },
    { width: 36 },
    { width: 10 },
    { width: 20 },
    { width: 16 },
    { width: 18 },
    { width: 16 },
    { width: 16 },
    { width: 20 },
    { width: 16 },
    { width: 12 },
  ];
  for (const g of data.withFob) {
    const row = con.addRow([
      g.itemId,
      g.variationId,
      g.title,
      g.sku,
      g.productName,
      g.pack,
      g.packSource,
      g.fobUnit,
      g.qty,
      g.qty * g.pack,
      g.sales,
      g.cogs,
      g.profit,
      g.orders,
    ]);
    money(row.getCell(8));
    money(row.getCell(11));
    money(row.getCell(12));
    money(row.getCell(13));
    if (g.pack > 1) row.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
  }
  const tot = con.addRow([
    'TOTAL',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    data.withFob.reduce((s, g) => s + g.qty, 0),
    data.withFob.reduce((s, g) => s + g.qty * g.pack, 0),
    data.salesWithFob,
    data.cogs,
    data.grossProfit,
    '',
  ]);
  tot.font = { bold: true };
  money(tot.getCell(11));
  money(tot.getCell(12));
  money(tot.getCell(13));

  const sin = wb.addWorksheet('Sin FOB');
  headerRow(sin, [
    'Publicación',
    'Variación',
    'Título',
    'SKU',
    'Producto vinculado',
    'Pack',
    'Origen del pack',
    'Cantidad vendida',
    'Unidades reales',
    'Ventas',
    'Órdenes',
  ]);
  sin.columns = [
    { width: 18 },
    { width: 16 },
    { width: 50 },
    { width: 16 },
    { width: 36 },
    { width: 10 },
    { width: 20 },
    { width: 18 },
    { width: 16 },
    { width: 16 },
    { width: 12 },
  ];
  for (const g of data.withoutFob) {
    const row = sin.addRow([
      g.itemId,
      g.variationId,
      g.title,
      g.sku,
      g.productName,
      g.pack,
      g.packSource,
      g.qty,
      g.qty * g.pack,
      g.sales,
      g.orders,
    ]);
    money(row.getCell(10));
  }
  const totSin = sin.addRow([
    'TOTAL',
    '',
    '',
    '',
    '',
    '',
    '',
    data.withoutFob.reduce((s, g) => s + g.qty, 0),
    data.withoutFob.reduce((s, g) => s + g.qty * g.pack, 0),
    data.salesWithoutFob,
    '',
  ]);
  totSin.font = { bold: true };
  money(totSin.getCell(10));

  return wb;
}
