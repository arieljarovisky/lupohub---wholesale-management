import ExcelJS from 'exceljs';
import type { CompanyFinanceChannelEconomics } from '../services/api';

const FONT = 'Calibri';
const MONEY = '"$" #,##0.00';
const PCT = '0.0%';
const INT = '#,##0';
const COLS = 4;

const BORDER = {
  top: { style: 'thin' as const, color: { argb: 'FFCBD5E1' } },
  left: { style: 'thin' as const, color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'thin' as const, color: { argb: 'FFCBD5E1' } },
  right: { style: 'thin' as const, color: { argb: 'FFCBD5E1' } },
};

type FillArgb = string;

function fill(argb: FillArgb): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb }, bgColor: { argb } };
}

export type CompanyFinanceExcelSummary = {
  from: string;
  to: string;
  methodology?: { wholesale: string; retail: string; cogs: string; commissions: string };
  fobListName?: string | null;
  manualIncome: number;
  ordersRevenue: number;
  wholesaleRevenueWithIva?: number;
  wholesaleCreditNotes?: number;
  receiptsTotal: number;
  receiptsCount: number;
  mlSales: number;
  mlFees: number;
  mlCogs?: number;
  mlUnits?: number;
  mlUnitsWithFob?: number;
  mlOrderCount: number;
  mlNote?: string;
  tnSales: number;
  tnFees: number;
  tnCogs?: number;
  tnUnits?: number;
  tnUnitsWithFob?: number;
  tnOrderCount: number;
  tnNote?: string;
  sellerCommissions?: number;
  sellerCommissionReceipts?: number;
  despachosCost: number;
  despachosCount: number;
  manualExpenses: number;
  fixedMonthlyExpenses: number;
  monthsInPeriod: number;
  fixedExpenseItems: Array<{
    id: string;
    categoryLabel: string;
    description: string | null;
    monthlyAmount: number;
    monthsApplied: number;
    periodTotal: number;
  }>;
  totalSales?: number;
  totalCogs?: number;
  grossProfit?: number;
  grossMarginPct?: number | null;
  commercialCosts?: number;
  contributionMargin?: number;
  contributionMarginPct?: number | null;
  operatingExpenses?: number;
  totalIncome: number;
  netResult: number;
  netMarginPct?: number | null;
  channels?: {
    wholesale: CompanyFinanceChannelEconomics;
    mercadoLibre: CompanyFinanceChannelEconomics;
    tiendaNube: CompanyFinanceChannelEconomics;
    retail: CompanyFinanceChannelEconomics;
  };
  opexByCategory?: Array<{ category: string; categoryLabel: string; total: number }>;
  inventory?: {
    units: number;
    unitsWithFob: number;
    value: number;
    skuCount: number;
    coveragePct: number | null;
    fobListName: string | null;
  };
  cogsCoverage?: { wholesalePct: number | null; mlPct: number | null; tnPct: number | null };
  invoicedTotal: number;
  invoicedNet: number;
  invoicedIva: number;
  invoicedCount: number;
  invoicedWholesaleTotal: number;
  invoicedWholesaleCount: number;
  invoicedMlTotal: number;
  invoicedMlCount: number;
  invoicedTnTotal: number;
  invoicedTnCount: number;
  pendingInvoicesTotal: number;
  pendingInvoicesCount: number;
  pendingInvoices: Array<{
    orderDate: string;
    customerName: string;
    invoiceLabel: string;
    amountWithIva: number;
    orderStatus: string;
  }>;
  byCategory: Array<{ entryType: string; categoryLabel: string; total: number; count: number }>;
};

export type CompanyFinanceExcelEntry = {
  entryDate: string;
  entryType: 'expense' | 'income';
  category: string;
  amount: number;
  description: string | null;
};

export type CompanyFinanceExcelFixed = {
  id?: string;
  description: string | null;
  categoryLabel?: string;
  amount: number;
  active: boolean;
  startsFrom: string | null;
  endsAt: string | null;
};

export type CompanyFinanceExcelMp = {
  connected: boolean;
  note?: string;
  summary: { count: number; grossIn: number; fees: number; refunds: number; netIn: number };
  movements: Array<{
    date: string;
    movementType: string;
    description: string;
    grossAmount: number;
    feeAmount: number;
    netAmount: number;
    status: string;
    externalReference: string;
  }>;
} | null;

function n(v: number | null | undefined): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function pctRatio(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return v / 100;
}

function covNote(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return 'Sin cobertura FOB';
  return `Cobertura FOB ${v.toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`;
}

function downloadBuffer(buffer: ExcelJS.Buffer, filename: string) {
  const u8 =
    buffer instanceof Uint8Array
      ? buffer
      : buffer instanceof ArrayBuffer
        ? new Uint8Array(buffer)
        : Uint8Array.from(buffer as number[]);
  const blob = new Blob([u8], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function setupSheet(ws: ExcelJS.Worksheet, freeze = 6) {
  ws.views = [{ state: 'frozen', ySplit: freeze, showGridLines: false }];
  ws.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
    margins: { left: 0.5, right: 0.5, top: 0.7, bottom: 0.6, header: 0.25, footer: 0.25 },
    printTitlesRow: '1:5',
  };
  ws.headerFooter = {
    oddHeader: '&L&BLupoHub&CResultados de la empresa&R&D',
    oddFooter: '&LConfidencial&C&P / &N&RGenerado desde LupoHub',
  };
}

function paintRange(ws: ExcelJS.Worksheet, row: number, cols: number, argb: FillArgb) {
  for (let c = 1; c <= cols; c++) ws.getCell(row, c).fill = fill(argb);
}

function writeBanner(ws: ExcelJS.Worksheet, title: string, subtitle: string, meta: string[]) {
  ws.mergeCells(1, 1, 1, COLS);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { name: FONT, bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
  t.alignment = { vertical: 'middle', horizontal: 'left' };
  paintRange(ws, 1, COLS, 'FF0F172A');
  ws.getRow(1).height = 32;

  ws.mergeCells(2, 1, 2, COLS);
  const s = ws.getCell(2, 1);
  s.value = subtitle;
  s.font = { name: FONT, bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
  s.alignment = { vertical: 'middle' };
  paintRange(ws, 2, COLS, 'FF1E3A5F');
  ws.getRow(2).height = 22;

  meta.forEach((line, i) => {
    const r = 3 + i;
    ws.mergeCells(r, 1, r, COLS);
    const cell = ws.getCell(r, 1);
    cell.value = line;
    cell.font = { name: FONT, size: 10, italic: true, color: { argb: 'FF334155' } };
    paintRange(ws, r, COLS, 'FFF1F5F9');
    ws.getRow(r).height = 18;
  });
}

function tableHeader(ws: ExcelJS.Worksheet, row: number, headers: string[]) {
  headers.forEach((h, i) => {
    const cell = ws.getCell(row, i + 1);
    cell.value = h;
    cell.font = { name: FONT, bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill('FF1E40AF');
    cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'right', wrapText: true };
    cell.border = BORDER;
  });
  ws.getRow(row).height = 22;
}

type LineKind = 'section' | 'detail' | 'total' | 'net';

function pnlLine(
  ws: ExcelJS.Worksheet,
  row: number,
  opts: {
    label: string;
    amount?: number | { formula: string; result?: number };
    pct?: number | null | { formula: string; result?: number };
    note?: string;
    kind: LineKind;
    indent?: number;
    expense?: boolean;
    positive?: boolean;
  }
) {
  const { label, amount, pct, note, kind, indent = 0, expense } = opts;
  const c1 = ws.getCell(row, 1);
  const c2 = ws.getCell(row, 2);
  const c3 = ws.getCell(row, 3);
  const c4 = ws.getCell(row, 4);

  c1.value = label;
  c1.alignment = { vertical: 'middle', horizontal: 'left', indent };
  c2.alignment = { vertical: 'middle', horizontal: 'right' };
  c3.alignment = { vertical: 'middle', horizontal: 'center' };
  c4.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  [c1, c2, c3, c4].forEach((c) => {
    c.border = BORDER;
    c.font = { name: FONT, size: 11 };
  });

  if (amount !== undefined) {
    c2.value = amount;
    c2.numFmt = MONEY;
  }
  if (pct !== undefined && pct !== null) {
    c3.value = pct;
    c3.numFmt = PCT;
  }
  if (note) c4.value = note;

  if (kind === 'section') {
    paintRange(ws, row, COLS, opts.expense ? 'FF9F1239' : 'FF0F766E');
    [c1, c2, c3, c4].forEach((c) => {
      c.font = { name: FONT, bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    });
    ws.getRow(row).height = 22;
  } else if (kind === 'total') {
    paintRange(ws, row, COLS, 'FFE2E8F0');
    [c1, c2, c3].forEach((c) => {
      c.font = { name: FONT, bold: true, size: 11, color: { argb: 'FF0F172A' } };
    });
    ws.getRow(row).height = 20;
  } else if (kind === 'net') {
    const positive = opts.positive ?? (typeof amount === 'number' ? amount >= 0 : true);
    paintRange(ws, row, COLS, positive ? 'FF14532D' : 'FF7F1D1D');
    [c1, c2, c3, c4].forEach((c) => {
      c.font = { name: FONT, bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    });
    ws.getRow(row).height = 24;
  } else {
    const zebra = row % 2 === 0;
    if (zebra) paintRange(ws, row, COLS, 'FFF8FAFC');
    c1.font = { name: FONT, size: 11, color: { argb: 'FF334155' } };
    if (typeof amount === 'number') {
      c2.font = {
        name: FONT,
        size: 11,
        color: { argb: amount < 0 || expense ? 'FFB91C1C' : 'FF047857' },
      };
    }
    ws.getRow(row).height = 18;
  }
}

function addTableSheet(
  wb: ExcelJS.Workbook,
  name: string,
  title: string,
  subtitle: string,
  headers: string[],
  rows: Array<Array<string | number | null>>,
  moneyCols: number[],
  pctCols: number[] = [],
  intCols: number[] = []
) {
  const ws = wb.addWorksheet(name.slice(0, 31));
  const colCount = headers.length;
  ws.views = [{ state: 'frozen', ySplit: 5, showGridLines: false }];
  ws.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
  };

  ws.mergeCells(1, 1, 1, colCount);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { name: FONT, bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  t.alignment = { vertical: 'middle' };
  paintRange(ws, 1, colCount, 'FF0F172A');
  ws.getRow(1).height = 28;

  ws.mergeCells(2, 1, 2, colCount);
  const s = ws.getCell(2, 1);
  s.value = subtitle;
  s.font = { name: FONT, size: 10, color: { argb: 'FF334155' } };
  paintRange(ws, 2, colCount, 'FFF1F5F9');

  tableHeader(ws, 4, headers);
  rows.forEach((vals, i) => {
    const r = 5 + i;
    vals.forEach((v, c) => {
      const cell = ws.getCell(r, c + 1);
      cell.value = v ?? '';
      cell.font = { name: FONT, size: 10, color: { argb: 'FF0F172A' } };
      cell.border = BORDER;
      cell.alignment = {
        vertical: 'middle',
        horizontal: c === 0 ? 'left' : 'right',
        wrapText: c === 0,
      };
      if (i % 2 === 1) cell.fill = fill('FFF8FAFC');
      if (moneyCols.includes(c + 1) && typeof v === 'number') cell.numFmt = MONEY;
      if (pctCols.includes(c + 1) && typeof v === 'number') cell.numFmt = PCT;
      if (intCols.includes(c + 1) && typeof v === 'number') cell.numFmt = INT;
    });
    ws.getRow(r).height = 18;
  });

  ws.columns = headers.map((h, i) => ({
    width: i === 0 ? 36 : Math.max(14, Math.min(28, h.length + 6)),
  }));
  if (rows.length > 0) {
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + rows.length, column: colCount } };
  }
  return ws;
}

function buildPnlSheet(wb: ExcelJS.Workbook, summary: CompanyFinanceExcelSummary) {
  const ws = wb.addWorksheet('Estado de resultados');
  setupSheet(ws, 6);
  ws.columns = [{ width: 44 }, { width: 18 }, { width: 14 }, { width: 52 }];

  const generated = new Date().toLocaleString('es-AR');
  writeBanner(
    ws,
    'LupoHub — Resultados de la empresa',
    `Período ${summary.from}  →  ${summary.to}`,
    [
      `Generado: ${generated}   ·   Lista FOB: ${summary.fobListName || 'sin lista'}`,
      'Importes en pesos argentinos. Las líneas de costo y gasto van en negativo para que el resultado sea la suma de la columna.',
    ]
  );

  tableHeader(ws, 6, ['Concepto', 'Importe', '% ventas', 'Nota']);

  const wholesale = n(summary.channels?.wholesale.revenue ?? summary.ordersRevenue);
  const ml = n(summary.mlSales);
  const tn = n(summary.tnSales);
  const other = n(summary.manualIncome);
  const cmvW = -n(summary.channels?.wholesale.cogs);
  const cmvMl = -n(summary.channels?.mercadoLibre.cogs ?? summary.mlCogs);
  const cmvTn = -n(summary.channels?.tiendaNube.cogs ?? summary.tnCogs);
  const feeMl = -n(summary.mlFees);
  const feeTn = -n(summary.tnFees);
  const feeSeller = -n(summary.sellerCommissions);
  const opexRows = summary.opexByCategory?.length
    ? summary.opexByCategory.map((r) => ({ label: r.categoryLabel, amount: -n(r.total) }))
    : [
        { label: 'Gastos fijos mensuales', amount: -n(summary.fixedMonthlyExpenses) },
        { label: 'Gastos puntuales', amount: -n(summary.manualExpenses) },
      ];

  let r = 7;
  const mark = (label: string, extra?: Partial<Parameters<typeof pnlLine>[2]>) => {
    pnlLine(ws, r, { label, kind: 'section', ...extra });
    return r++;
  };
  const detail = (
    label: string,
    amount: number,
    note?: string,
    expense?: boolean
  ) => {
    const row = r;
    pnlLine(ws, r, { label, amount, note, kind: 'detail', indent: 1, expense });
    r++;
    return row;
  };

  mark('VENTAS');
  const rowW = detail(
    'Mayorista',
    wholesale,
    `${summary.channels?.wholesale.orderCount ?? 0} pedidos · sin IVA · IVA incl. ${n(summary.wholesaleRevenueWithIva).toLocaleString('es-AR')}`
  );
  const rowMl = detail('Mercado Libre (minorista)', ml, `${summary.mlOrderCount} órdenes pagadas`);
  const rowTn = detail('Tienda Nube (minorista)', tn, `${summary.tnOrderCount} órdenes pagadas`);
  const rowOth = detail('Otros ingresos', other);

  const salesTotal = n(summary.totalSales ?? summary.totalIncome);
  const cmvTotal = -n(summary.totalCogs);
  const gross = n(summary.grossProfit);
  const commTotal = -n(summary.commercialCosts);
  const contrib = n(summary.contributionMargin);
  const opexTotal = -n(summary.operatingExpenses);
  const net = n(summary.netResult);
  const ratio = (num: number) => (salesTotal === 0 ? null : num / salesTotal);

  const rowSales = r;
  pnlLine(ws, r, {
    kind: 'total',
    label: 'Total ventas',
    amount: { formula: `B${rowW}+B${rowMl}+B${rowTn}+B${rowOth}`, result: salesTotal },
    pct: 1,
  });
  r++;

  r++;
  mark('COSTO DE MERCADERÍA VENDIDA (FOB)', { expense: true });
  const rowCmvW = detail('CMV mayorista', cmvW, covNote(summary.cogsCoverage?.wholesalePct), true);
  const rowCmvMl = detail('CMV Mercado Libre', cmvMl, covNote(summary.cogsCoverage?.mlPct), true);
  const rowCmvTn = detail('CMV Tienda Nube', cmvTn, covNote(summary.cogsCoverage?.tnPct), true);
  const rowCmv = r;
  pnlLine(ws, r, {
    kind: 'total',
    label: 'Total CMV',
    amount: { formula: `B${rowCmvW}+B${rowCmvMl}+B${rowCmvTn}`, result: cmvTotal },
    pct: { formula: `IF(B${rowSales}=0,NA(),B${r}/B${rowSales})`, result: ratio(cmvTotal) ?? undefined },
  });
  r++;

  r++;
  const rowGross = r;
  pnlLine(ws, r, {
    kind: 'total',
    label: 'MARGEN BRUTO',
    amount: { formula: `B${rowSales}+B${rowCmv}`, result: gross },
    pct: { formula: `IF(B${rowSales}=0,NA(),B${r}/B${rowSales})`, result: ratio(gross) ?? undefined },
    note: 'Ventas menos costo FOB de lo vendido',
  });
  r++;

  r++;
  mark('COSTOS DE CANAL Y COMERCIALES', { expense: true });
  const rowFeeMl = detail('Comisiones Mercado Libre', feeMl, summary.mlNote, true);
  const rowFeeTn = detail('Comisiones Tienda Nube', feeTn, summary.tnNote, true);
  const rowFeeS = detail(
    'Comisiones vendedores',
    feeSeller,
    `Sobre ${summary.sellerCommissionReceipts ?? 0} recibos cobrados (neto de IVA)`,
    true
  );
  const rowComm = r;
  pnlLine(ws, r, {
    kind: 'total',
    label: 'Total costos comerciales',
    amount: { formula: `B${rowFeeMl}+B${rowFeeTn}+B${rowFeeS}`, result: commTotal },
    pct: { formula: `IF(B${rowSales}=0,NA(),B${r}/B${rowSales})`, result: ratio(commTotal) ?? undefined },
  });
  r++;

  r++;
  const rowContrib = r;
  pnlLine(ws, r, {
    kind: 'total',
    label: 'MARGEN DE CONTRIBUCIÓN',
    amount: { formula: `B${rowGross}+B${rowComm}`, result: contrib },
    pct: { formula: `IF(B${rowSales}=0,NA(),B${r}/B${rowSales})`, result: ratio(contrib) ?? undefined },
  });
  r++;

  r++;
  mark('GASTOS OPERATIVOS', { expense: true });
  const opexStart = r;
  opexRows.forEach((row) => detail(row.label, row.amount, undefined, true));
  const opexEnd = r - 1;
  const rowOpex = r;
  pnlLine(ws, r, {
    kind: 'total',
    label: 'Total gastos operativos',
    amount: {
      formula: opexEnd >= opexStart ? `SUM(B${opexStart}:B${opexEnd})` : '0',
      result: opexTotal,
    },
    pct: { formula: `IF(B${rowSales}=0,NA(),B${r}/B${rowSales})`, result: ratio(opexTotal) ?? undefined },
  });
  r++;

  r++;
  pnlLine(ws, r, {
    kind: 'net',
    label: 'RESULTADO NETO DEL PERÍODO',
    amount: { formula: `B${rowContrib}+B${rowOpex}`, result: net },
    pct: { formula: `IF(B${rowSales}=0,NA(),B${r}/B${rowSales})`, result: ratio(net) ?? undefined },
    note: net >= 0 ? 'Ganancia' : 'Pérdida',
    positive: net >= 0,
  });

  r += 2;
  ws.mergeCells(r, 1, r, COLS);
  ws.getCell(r, 1).value = 'Cómo se lee este informe';
  ws.getCell(r, 1).font = { name: FONT, bold: true, size: 11, color: { argb: 'FF0F172A' } };
  paintRange(ws, r, COLS, 'FFE2E8F0');
  r++;
  const notes = [
    summary.methodology?.wholesale,
    summary.methodology?.retail,
    summary.methodology?.cogs,
    summary.methodology?.commissions,
    'Los despachos de importación son compras de stock (ver hoja Posición), no un gasto de este resultado.',
    'Los recibos son cobranza; las ventas mayoristas son lo vendido en el período.',
  ].filter(Boolean) as string[];
  notes.forEach((text) => {
    ws.mergeCells(r, 1, r, COLS);
    const cell = ws.getCell(r, 1);
    cell.value = `•  ${text}`;
    cell.font = { name: FONT, size: 9, color: { argb: 'FF475569' } };
    cell.alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(r).height = 28;
    r++;
  });

  ws.autoFilter = undefined;
}

function emptyChannel(): CompanyFinanceChannelEconomics {
  return {
    revenue: 0,
    cogs: 0,
    fees: 0,
    units: 0,
    unitsWithFob: 0,
    orderCount: 0,
    grossProfit: 0,
    contribution: 0,
    contributionMarginPct: null,
    grossMarginPct: null,
  };
}

function buildChannelsSheet(wb: ExcelJS.Workbook, summary: CompanyFinanceExcelSummary) {
  const ch = summary.channels;
  const rows: Array<{ name: string; data: CompanyFinanceChannelEconomics; note: string }> = [
    { name: 'Mayorista', data: ch?.wholesale || emptyChannel(), note: 'Pedidos confirmados o posteriores, sin IVA' },
    { name: 'Mercado Libre', data: ch?.mercadoLibre || emptyChannel(), note: summary.mlNote || 'Minorista' },
    { name: 'Tienda Nube', data: ch?.tiendaNube || emptyChannel(), note: summary.tnNote || 'Minorista' },
    { name: 'Minorista (ML + TN)', data: ch?.retail || emptyChannel(), note: 'Canales de venta al público' },
  ];
  addTableSheet(
    wb,
    'Por canal',
    'Resultado por canal',
    `Período ${summary.from} a ${summary.to}`,
    [
      'Canal',
      'Ventas',
      'Costo FOB',
      'Margen bruto',
      'Margen bruto %',
      'Comisiones',
      'Contribución',
      'Contribución %',
      'Pedidos',
      'Unidades',
      'U. con FOB',
      'Nota',
    ],
    rows.map((row) => [
      row.name,
      n(row.data.revenue),
      n(row.data.cogs),
      n(row.data.grossProfit),
      pctRatio(row.data.grossMarginPct),
      n(row.data.fees),
      n(row.data.contribution),
      pctRatio(row.data.contributionMarginPct),
      n(row.data.orderCount),
      n(row.data.units),
      n(row.data.unitsWithFob),
      row.note,
    ]),
    [2, 3, 4, 6, 7],
    [5, 8],
    [9, 10, 11]
  );
}

function buildPositionSheet(wb: ExcelJS.Workbook, summary: CompanyFinanceExcelSummary) {
  const cobradoVsVendido = n(summary.receiptsTotal) - n(summary.channels?.wholesale.revenue ?? summary.ordersRevenue);
  addTableSheet(
    wb,
    'Posición',
    'Posición operativa (no es el P&L)',
    `Período ${summary.from} a ${summary.to}  ·  Cuentas por cobrar, stock, compras y facturación`,
    ['Concepto', 'Importe', 'Detalle'],
    [
      ['Facturado AFIP total (IVA incl.)', n(summary.invoicedTotal), `${summary.invoicedCount} comprobantes`],
      ['Facturado neto / IVA 21%', n(summary.invoicedNet), `IVA ${n(summary.invoicedIva).toLocaleString('es-AR')}`],
      ['Facturado mayorista', n(summary.invoicedWholesaleTotal), `${summary.invoicedWholesaleCount} facturas`],
      ['Facturado Mercado Libre', n(summary.invoicedMlTotal), `${summary.invoicedMlCount} facturas`],
      ['Facturado Tienda Nube', n(summary.invoicedTnTotal), `${summary.invoicedTnCount} facturas`],
      ['Recibos cobrados', n(summary.receiptsTotal), `${summary.receiptsCount} recibos`],
      ['Ventas mayoristas (devengado)', n(summary.channels?.wholesale.revenue ?? summary.ordersRevenue), 'Lo vendido en el período'],
      ['Diferencia cobrado vs vendido', cobradoVsVendido, cobradoVsVendido >= 0 ? 'Se cobró más de lo vendido' : 'Queda por cobrar del período'],
      ['Facturas mayoristas por cobrar', n(summary.pendingInvoicesTotal), `${summary.pendingInvoicesCount} facturas`],
      ['Inventario valorizado a FOB', n(summary.inventory?.value), `${(summary.inventory?.units ?? 0).toLocaleString('es-AR')} u. · ${(summary.inventory?.unitsWithFob ?? 0).toLocaleString('es-AR')} con FOB (${summary.inventory?.coveragePct ?? '—'}%)`],
      ['Despachos del período (compras)', n(summary.despachosCost), `${summary.despachosCount} despachos · no es gasto del resultado`],
    ],
    [2],
    [],
    []
  );
}

export async function exportCompanyFinanceExcel(opts: {
  summary: CompanyFinanceExcelSummary;
  entries: CompanyFinanceExcelEntry[];
  fixedExpenses: CompanyFinanceExcelFixed[];
  mpData: CompanyFinanceExcelMp;
  categoryLabel: (id: string) => string;
}): Promise<void> {
  const { summary, entries, fixedExpenses, mpData, categoryLabel } = opts;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LupoHub';
  wb.company = 'LupoHub';
  wb.created = new Date();
  wb.title = `Resultados de la empresa ${summary.from} a ${summary.to}`;

  buildPnlSheet(wb, summary);
  buildChannelsSheet(wb, summary);
  buildPositionSheet(wb, summary);

  const periodItem = (id: string) => summary.fixedExpenseItems.find((i) => i.id === id);
  addTableSheet(
    wb,
    'Gastos fijos',
    'Gastos fijos mensuales',
    `Se prorratean por los ${summary.monthsInPeriod} mes(es) del período`,
    ['Concepto', 'Categoría', '$ / mes', 'Vigencia', 'Activo', 'En el período'],
    fixedExpenses.map((row) => [
      row.description || '—',
      row.categoryLabel || '',
      n(row.amount),
      row.startsFrom || row.endsAt ? `${row.startsFrom || '…'} → ${row.endsAt || '…'}` : 'Siempre',
      row.active ? 'Sí' : 'No',
      row.active ? n(periodItem(row.id || '')?.periodTotal) : 0,
    ]),
    [3, 6]
  );

  addTableSheet(
    wb,
    'Movimientos',
    'Movimientos puntuales del período',
    `Gastos e ingresos cargados a mano · ${summary.from} a ${summary.to}`,
    ['Fecha', 'Tipo', 'Categoría', 'Descripción', 'Importe'],
    entries.map((row) => [
      row.entryDate,
      row.entryType === 'expense' ? 'Gasto' : 'Ingreso',
      categoryLabel(row.category),
      row.description || '—',
      row.entryType === 'expense' ? -n(row.amount) : n(row.amount),
    ]),
    [5]
  );

  addTableSheet(
    wb,
    'Por categoría',
    'Movimientos puntuales agrupados',
    `Período ${summary.from} a ${summary.to}`,
    ['Tipo', 'Categoría', 'Cantidad', 'Total'],
    summary.byCategory.map((row) => [
      row.entryType === 'expense' ? 'Gasto' : 'Ingreso',
      row.categoryLabel,
      n(row.count),
      row.entryType === 'expense' ? -n(row.total) : n(row.total),
    ]),
    [4],
    [],
    [3]
  );

  addTableSheet(
    wb,
    'Por cobrar',
    'Facturas mayoristas sin cobrar',
    `Saldo con IVA incluido · ${summary.pendingInvoicesCount} factura(s) · total ${n(summary.pendingInvoicesTotal).toLocaleString('es-AR')}`,
    ['Fecha', 'Cliente', 'Factura', 'Estado pedido', 'Saldo IVA incl.'],
    summary.pendingInvoices.map((inv) => [
      inv.orderDate,
      inv.customerName,
      inv.invoiceLabel,
      inv.orderStatus,
      n(inv.amountWithIva),
    ]),
    [5]
  );

  if (mpData?.connected) {
    addTableSheet(
      wb,
      'Mercado Pago',
      'Movimientos Mercado Pago',
      `Bruto ${n(mpData.summary.grossIn).toLocaleString('es-AR')} · comisiones ${n(mpData.summary.fees).toLocaleString('es-AR')} · neto ${n(mpData.summary.netIn).toLocaleString('es-AR')}${mpData.note ? ` · ${mpData.note}` : ''}`,
      ['Fecha', 'Tipo', 'Descripción', 'Bruto', 'Comisión', 'Neto', 'Estado', 'Referencia'],
      mpData.movements.map((m) => [
        m.date,
        m.movementType,
        m.description,
        n(m.grossAmount),
        n(m.feeAmount),
        n(m.netAmount),
        m.status,
        m.externalReference || '',
      ]),
      [4, 5, 6]
    );
  }

  const filename = `LupoHub-Resultados-${summary.from}_${summary.to}.xlsx`;
  const buffer = await wb.xlsx.writeBuffer();
  downloadBuffer(buffer, filename);
}
