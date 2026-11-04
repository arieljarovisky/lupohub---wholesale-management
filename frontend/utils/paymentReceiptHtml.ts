/**
 * HTML imprimible de recibo oficial (layout Multimedias / cuenta corriente).
 * Replica el talonario: encabezado + liquidación + detalle de cobro + importe en letras.
 */
import type { Customer, Payment } from '../types';
import { formatMoneyAr } from './moneyFormat';
import type { FacturaRemitente } from './wholesaleInvoiceHtml';

function escapeHtmlText(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseYmdLocal(raw: string): Date | null {
  const s = String(raw || '').trim();
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) {
    const d = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    const year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    const d = new Date(year, Number(dmy[2]) - 1, Number(dmy[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Fecha del talonario: DD-MM-YY */
function formatFechaTalonario(raw: string): string {
  const d = parseYmdLocal(raw);
  if (!d) return String(raw || '').trim() || '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}-${mm}-${yy}`;
}

function formatFechaDmy(raw: string): string {
  const d = parseYmdLocal(raw);
  if (!d) return String(raw || '').trim() || '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Nº 0001 - 00021103 cuando se puede normalizar; si no, el texto tal cual. */
function formatReceiptNumberDisplay(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '—';
  const m = s.match(/^(\d{1,5})\s*[-–]\s*(\d{1,8})$/);
  if (m) return `${m[1].padStart(4, '0')} - ${m[2].padStart(8, '0')}`;
  if (/^\d{1,8}$/.test(s)) return `0001 - ${s.padStart(8, '0')}`;
  return s;
}

const UNIDADES = [
  '',
  'UN',
  'DOS',
  'TRES',
  'CUATRO',
  'CINCO',
  'SEIS',
  'SIETE',
  'OCHO',
  'NUEVE',
  'DIEZ',
  'ONCE',
  'DOCE',
  'TRECE',
  'CATORCE',
  'QUINCE',
  'DIECISEIS',
  'DIECISIETE',
  'DIECIOCHO',
  'DIECINUEVE',
];
const DECENAS = [
  '',
  'DIEZ',
  'VEINTE',
  'TREINTA',
  'CUARENTA',
  'CINCUENTA',
  'SESENTA',
  'SETENTA',
  'OCHENTA',
  'NOVENTA',
];
const CENTENAS = [
  '',
  'CIENTO',
  'DOSCIENTOS',
  'TRESCIENTOS',
  'CUATROCIENTOS',
  'QUINIENTOS',
  'SEISCIENTOS',
  'SETECIENTOS',
  'OCHOCIENTOS',
  'NOVECIENTOS',
];

function centenasALetras(n: number): string {
  if (n <= 0) return '';
  if (n === 100) return 'CIEN';
  if (n < 20) return UNIDADES[n];
  if (n < 30) {
    const u = n - 20;
    return u === 0 ? 'VEINTE' : `VEINTI${UNIDADES[u]}`;
  }
  if (n < 100) {
    const d = Math.floor(n / 10);
    const u = n % 10;
    return u === 0 ? DECENAS[d] : `${DECENAS[d]} Y ${UNIDADES[u]}`;
  }
  const c = Math.floor(n / 100);
  const r = n % 100;
  return r === 0 ? CENTENAS[c] : `${CENTENAS[c]} ${centenasALetras(r)}`;
}

/** Importe en letras estilo talonario AR: "QUINIENTOS ... CON 58/100". */
export function importeEnLetrasPesos(amount: number): string {
  const n = Math.round(Number(amount || 0) * 100) / 100;
  if (!Number.isFinite(n) || n < 0) return '';
  const entero = Math.floor(n + 1e-9);
  const centavos = Math.round((n - entero) * 100);

  const partes: string[] = [];
  const millones = Math.floor(entero / 1_000_000);
  const miles = Math.floor((entero % 1_000_000) / 1000);
  const resto = entero % 1000;

  if (millones > 0) {
    if (millones === 1) partes.push('UN MILLON');
    else partes.push(`${centenasALetras(millones)} MILLONES`);
  }
  if (miles > 0) {
    if (miles === 1) partes.push('MIL');
    else partes.push(`${centenasALetras(miles)} MIL`);
  }
  if (resto > 0 || partes.length === 0) {
    partes.push(centenasALetras(resto) || 'CERO');
  }

  const letras = partes.join(' ').replace(/\s+/g, ' ').trim();
  return `${letras} CON ${String(centavos).padStart(2, '0')}/100`;
}

type LiquidacionRow = { fecha: string; factura: string; importe: number };

function parseLiquidacionFromLabel(label: string, amountApplied: number): LiquidacionRow {
  const raw = String(label || '').trim();
  const parts = raw.split(/\s+[—–-]\s+/).map((p) => p.trim()).filter(Boolean);
  let fecha = '';
  let factura = raw;
  for (const p of parts) {
    if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(p) || /^\d{4}-\d{2}-\d{2}/.test(p)) {
      fecha = formatFechaDmy(p);
    } else if (/^[A-E]?\s*\d{4,5}-\d{6,8}$/i.test(p) || /^\d{4,5}-\d{6,8}$/.test(p) || /^[A-E]\s+\d/i.test(p)) {
      factura = p.replace(/\s+/g, ' ').trim();
    } else if (/^Remito\s+/i.test(p) || /^Pedido\s+/i.test(p)) {
      factura = p;
    }
  }
  if (!factura && parts[0]) factura = parts[0];
  return { fecha, factura, importe: Math.round(Number(amountApplied || 0) * 100) / 100 };
}

function padRows<T>(rows: T[], min: number, empty: T): T[] {
  const out = [...rows];
  while (out.length < min) out.push(empty);
  return out;
}

export function buildPaymentReceiptHtml(params: {
  payment: Payment;
  customer?: Customer;
  remitente: FacturaRemitente;
}): string {
  const { payment, customer, remitente } = params;
  if (!payment) return '';

  const amount = Math.round(Number(payment.amount || 0) * 100) / 100;
  const receiptNumber = formatReceiptNumberDisplay(String(payment.receiptNumber || ''));
  const fecha = formatFechaTalonario(String(payment.date || ''));

  const razonEmpresaRaw = String(remitente.businessName || 'MULTIMEDIAS S.A.').trim();
  const razonEmpresaLower = razonEmpresaRaw.toLowerCase();
  const isMultimedia =
    razonEmpresaLower.includes('multimedia') ||
    razonEmpresaLower.includes('multimedias') ||
    razonEmpresaLower.includes('lupo');

  const razonEmpresaDisplay = escapeHtmlText(
    isMultimedia
      ? razonEmpresaRaw.replace(/^lupo\s+/i, '').trim() || 'MULTIMEDIAS S.A.'
      : razonEmpresaRaw || 'MULTIMEDIAS S.A.'
  );

  const dirEmpresa = escapeHtmlText(
    isMultimedia
      ? 'Murillo 630 - Piso 2º - (1414) Capital Federal - Bs. As. - Argentina'
      : [remitente.address, remitente.city].filter(Boolean).join(' - ') || ''
  );
  const phone = escapeHtmlText(
    String(remitente.phone || '').trim() || (isMultimedia ? '+54911 6462 2053' : '')
  );
  const email = escapeHtmlText(
    String(remitente.email || '').trim() || (isMultimedia ? 'multimedias@fibertel.com.ar' : '')
  );
  const web = isMultimedia ? 'www.multilupo.com.ar' : '';
  const cuitEmpresa = escapeHtmlText(String(remitente.cuit || '30-70923104-5').trim());
  const iibb = escapeHtmlText(
    String(remitente.ingresosBrutos || '901-211377-3').trim() || '901-211377-3'
  );
  const inicioAct = escapeHtmlText(
    String(remitente.inicioActividad || '13/06/2005').trim() || '13/06/2005'
  );
  const condicionIva = escapeHtmlText(
    String(remitente.condicionIva || remitente.condicion_iva || 'I.V.A. RESPONSABLE INSCRIPTO')
      .trim()
      .toUpperCase()
      .replace(/^RESPONSABLE\s+INSCRIPTO$/i, 'I.V.A. RESPONSABLE INSCRIPTO')
  );

  const logoUrl =
    remitente.logoUrl && String(remitente.logoUrl).trim() ? String(remitente.logoUrl).trim() : '';
  const logoBlock = logoUrl
    ? `<img src="${logoUrl}" alt="Logo" class="logo-img" referrerpolicy="no-referrer" />`
    : `<div class="logo-text">LUPO</div>`;

  const clienteNombre = escapeHtmlText(
    payment.customerBusinessName || customer?.businessName || customer?.name || ''
  );
  const clienteDir = escapeHtmlText([customer?.address, customer?.city].filter(Boolean).join(', ') || '');
  const notes = String(payment.notes || '').trim();
  const notesEsc = escapeHtmlText(notes);
  const firmaEmpresa = escapeHtmlText(
    isMultimedia ? 'P/ MULTIMEDIAS S.A.' : `P/ ${razonEmpresaRaw || 'EMPRESA'}`
  );

  const invoiceLinks =
    Array.isArray(payment.invoiceLinks) && payment.invoiceLinks.length > 0
      ? payment.invoiceLinks
      : (Array.isArray(payment.invoiceIds) ? payment.invoiceIds : []).map((id) => ({
          invoiceId: id,
          label: id,
          amountApplied: 0,
          invoiceOutstanding: NaN,
        }));

  const orderLinks =
    Array.isArray(payment.orderLinks) && payment.orderLinks.length > 0
      ? payment.orderLinks
      : (Array.isArray(payment.orderIds) ? payment.orderIds : []).map((id) => ({
          orderId: id,
          label: id,
          amountApplied: 0,
          orderOutstanding: NaN,
        }));

  const liquidacion: LiquidacionRow[] = [];
  for (const link of invoiceLinks) {
    const imputa = Number(link.amountApplied) || 0;
    liquidacion.push(parseLiquidacionFromLabel(String(link.label || link.invoiceId), imputa > 0 ? imputa : 0));
  }
  for (const link of orderLinks) {
    const imputa = Number(link.amountApplied) || 0;
    liquidacion.push(parseLiquidacionFromLabel(String(link.label || link.orderId), imputa > 0 ? imputa : 0));
  }

  // Si no hay imputaciones con monto, una sola fila a cuenta por el total del recibo.
  if (liquidacion.length === 0) {
    liquidacion.push({
      fecha: formatFechaDmy(String(payment.date || '')),
      factura: 'A CUENTA',
      importe: amount,
    });
  } else {
    const sumImp = liquidacion.reduce((s, r) => s + (Number(r.importe) || 0), 0);
    if (sumImp < 0.005) {
      // Labels sin monto imputado: repartir / mostrar total en una línea resumen
      if (liquidacion.length === 1) liquidacion[0].importe = amount;
      else {
        liquidacion.push({
          fecha: formatFechaDmy(String(payment.date || '')),
          factura: 'TOTAL RECIBO',
          importe: amount,
        });
      }
    }
  }

  const totalLiquidacion =
    Math.round(liquidacion.reduce((s, r) => s + (Number(r.importe) || 0), 0) * 100) / 100 || amount;

  const LIQ_ROWS = 9;
  const liquidacionRows = padRows(liquidacion, LIQ_ROWS, { fecha: '', factura: '', importe: 0 });
  const liquidacionHtml = liquidacionRows
    .map((r) => {
      const imp = Number(r.importe) > 0.005 ? `$${formatMoneyAr(r.importe)}` : '';
      return `<tr>
        <td class="c-fecha">${escapeHtmlText(r.fecha)}</td>
        <td class="c-fact">${escapeHtmlText(r.factura)}</td>
        <td class="c-imp">${imp}</td>
      </tr>`;
    })
    .join('');

  // Detalle de cobro: sin medios de pago estructurados → una línea con el total (y notes si aporta).
  const notesUpper = notes.toUpperCase();
  let cobroCheque = '';
  let cobroFecha = fecha ? formatFechaDmy(String(payment.date || '')) : '';
  let cobroBanco = '';
  let cobroEfectivo = '';
  let cobroImporteLinea = amount;

  if (/\bEFECTIVO\b/.test(notesUpper)) {
    cobroEfectivo = formatMoneyAr(amount);
    cobroImporteLinea = 0;
    cobroFecha = '';
  } else if (/\bCHEQUE\b/.test(notesUpper)) {
    cobroCheque = 'CHEQUE';
    const bancoMatch = notes.match(/banco\s*[:\-]?\s*([^\n,;]+)/i);
    if (bancoMatch) cobroBanco = bancoMatch[1].trim();
  } else if (/\bTRANSF/.test(notesUpper) || /\bDEPOSITO\b|\bDEPÓSITO\b/.test(notesUpper)) {
    cobroCheque = notesUpper.includes('DEP') ? 'DEPOSITO' : 'TRANSF.';
    cobroBanco = notes.replace(/^.*?[:\-]\s*/i, '').slice(0, 28);
  } else if (notes) {
    cobroCheque = notes.slice(0, 18).toUpperCase();
  }

  const COBRO_ROWS = 7;
  const cobroLines: Array<{ cheque: string; fecha: string; banco: string; importe: number }> = [
    {
      cheque: cobroCheque,
      fecha: cobroFecha,
      banco: cobroBanco,
      importe: cobroImporteLinea,
    },
  ];
  const cobroRows = padRows(cobroLines, COBRO_ROWS, { cheque: '', fecha: '', banco: '', importe: 0 });
  const cobroHtml = cobroRows
    .map((r) => {
      const imp = Number(r.importe) > 0.005 ? `$${formatMoneyAr(r.importe)}` : '';
      return `<tr>
        <td>${escapeHtmlText(r.cheque)}</td>
        <td class="c-fecha">${escapeHtmlText(r.fecha)}</td>
        <td>${escapeHtmlText(r.banco)}</td>
        <td class="c-imp">${imp}</td>
      </tr>`;
    })
    .join('');

  const sonPesos = escapeHtmlText(importeEnLetrasPesos(amount));

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Recibo Oficial ${escapeHtmlText(receiptNumber)}</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0; color: #111; background: #fff;
    font-family: Arial, Helvetica, sans-serif; font-size: 11px;
  }
  .sheet {
    width: 277mm; min-height: 190mm; margin: 0 auto; padding: 6mm 7mm;
    border: 1px solid #222;
  }
  .header {
    display: grid;
    grid-template-columns: 1.35fr 70px 1.15fr;
    gap: 8px;
    align-items: start;
    border-bottom: 1px solid #111;
    padding-bottom: 8px;
  }
  .logo-img { max-height: 48px; max-width: 160px; object-fit: contain; display: block; }
  .logo-text { font-size: 28px; font-weight: 900; letter-spacing: 0.04em; line-height: 1; }
  .company-name { font-size: 15px; font-weight: 800; margin-top: 2px; letter-spacing: 0.02em; }
  .company-meta { font-size: 10px; line-height: 1.35; margin-top: 2px; }
  .iva-line { font-size: 10px; font-weight: 700; margin-top: 4px; letter-spacing: 0.02em; }
  .x-box {
    border: 2px solid #111; text-align: center; padding: 6px 4px 8px;
    min-height: 78px; display: flex; flex-direction: column; justify-content: center;
  }
  .x-box .x { font-size: 42px; font-weight: 900; line-height: 0.9; }
  .x-box .x-sub { font-size: 8px; font-weight: 700; line-height: 1.15; margin-top: 4px; text-transform: uppercase; }
  .right-head { text-align: left; padding-left: 4px; }
  .doc-title { font-size: 22px; font-weight: 900; letter-spacing: 0.06em; }
  .doc-num { font-size: 14px; font-weight: 700; margin-top: 4px; }
  .doc-fecha { font-size: 13px; margin-top: 4px; }
  .doc-fecha .val { border-bottom: 1px solid #111; display: inline-block; min-width: 88px; padding: 0 4px; font-weight: 700; }
  .tax-block { font-size: 10px; line-height: 1.4; margin-top: 8px; }
  .payer { margin-top: 10px; font-size: 12px; line-height: 1.7; }
  .payer .line { display: grid; grid-template-columns: 118px 1fr; gap: 6px; align-items: end; }
  .payer .uline { border-bottom: 1px solid #111; min-height: 16px; padding: 0 4px; font-weight: 700; }
  .concept { margin: 4px 0 8px; font-size: 11px; }
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    align-items: stretch;
  }
  .panel { border: 1px solid #111; min-height: 168px; display: flex; flex-direction: column; }
  .panel-title {
    text-align: center; font-weight: 800; font-size: 12px; letter-spacing: 0.08em;
    border-bottom: 1px solid #111; padding: 4px 6px; background: #f3f3f3;
  }
  table.grid { width: 100%; border-collapse: collapse; flex: 1; }
  table.grid th, table.grid td {
    border-right: 1px solid #bbb; border-bottom: 1px solid #ddd;
    padding: 3px 5px; font-size: 10.5px; height: 18px; vertical-align: middle;
  }
  table.grid th:last-child, table.grid td:last-child { border-right: none; }
  table.grid thead th {
    border-bottom: 1px solid #111; font-size: 9px; font-weight: 800;
    letter-spacing: 0.04em; background: #fafafa;
  }
  .c-fecha { width: 72px; white-space: nowrap; }
  .c-fact { }
  .c-imp { text-align: right; width: 92px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .panel-foot {
    border-top: 1px solid #111; padding: 5px 6px; font-weight: 800;
    display: flex; justify-content: flex-end; gap: 8px; align-items: baseline;
  }
  .panel-foot .amt { min-width: 100px; text-align: right; border-bottom: 1px solid #111; padding: 0 4px; }
  .efectivo-row {
    border-top: 1px solid #111; padding: 5px 6px; font-weight: 700;
    display: flex; justify-content: flex-end; gap: 8px; align-items: baseline;
  }
  .efectivo-row .amt { min-width: 100px; text-align: right; border-bottom: 1px solid #111; padding: 0 4px; }
  .total-box {
    margin-top: 8px; border: 2px solid #111; padding: 6px 10px;
    display: flex; justify-content: space-between; align-items: center;
    font-weight: 900; font-size: 14px;
  }
  .son-pesos {
    margin-top: 10px; font-size: 12px; border-bottom: 1px solid #111;
    padding: 4px 2px 6px; min-height: 28px;
  }
  .son-pesos .lab { font-weight: 700; margin-right: 6px; }
  .bottom {
    margin-top: 14px; display: grid; grid-template-columns: 1fr 220px; gap: 16px; align-items: end;
  }
  .copies { font-size: 10px; line-height: 1.4; color: #333; }
  .sign { text-align: center; }
  .sign-line { border-top: 1px solid #111; margin-top: 42px; padding-top: 4px; font-size: 11px; font-weight: 700; }
  .press {
    margin-top: 10px; font-size: 8px; color: #555; border-top: 1px solid #ccc; padding-top: 4px;
  }
  .muted { color: #444; font-weight: 400; font-size: 10px; }
  .no-print { margin-top: 12px; display: flex; gap: 10px; }
  @media print {
    body { background: #fff; }
    .sheet { border: none; width: auto; min-height: auto; padding: 0; }
    .no-print { display: none !important; }
  }
</style></head><body>
  <div class="sheet">
    <div class="header">
      <div>
        ${logoBlock}
        <div class="company-name">${razonEmpresaDisplay}</div>
        ${dirEmpresa ? `<div class="company-meta">${dirEmpresa}</div>` : ''}
        <div class="company-meta">
          ${phone ? `Cel: ${phone}` : ''}
          ${phone && email ? ' &nbsp; ' : ''}
          ${email || ''}
          ${(phone || email) && web ? ' &nbsp; ' : ''}
          ${web ? escapeHtmlText(web) : ''}
        </div>
        <div class="iva-line">${condicionIva.includes('IVA') || condicionIva.includes('I.V.A') ? condicionIva : `I.V.A. ${condicionIva}`}</div>
      </div>
      <div class="x-box">
        <div class="x">X</div>
        <div class="x-sub">Documento<br/>No Válido<br/>Como Factura</div>
      </div>
      <div class="right-head">
        <div class="doc-title">RECIBO OFICIAL</div>
        <div class="doc-num">Nº ${escapeHtmlText(receiptNumber)}</div>
        <div class="doc-fecha">Fecha: <span class="val">${escapeHtmlText(fecha)}</span></div>
        <div class="tax-block">
          <div>C.U.I.T.: ${cuitEmpresa}</div>
          <div>ING. BRUTOS C.M.: ${iibb}</div>
          <div>FECHA INICIO ACTIVIDADES: ${inicioAct}</div>
        </div>
      </div>
    </div>

    <div class="payer">
      <div class="line"><span>Dirección de Pago:</span><span class="uline">${clienteDir}</span></div>
      <div class="line"><span>Recibimos de:</span><span class="uline">${clienteNombre}</span></div>
    </div>
    <div class="concept">En concepto de pago de la liquidación que se detalla.${notesEsc && !/\b(CHEQUE|EFECTIVO|TRANSF|DEPOSITO|DEPÓSITO)\b/i.test(notes) ? ` <span class="muted">(${notesEsc})</span>` : ''}</div>

    <div class="cols">
      <div class="panel">
        <div class="panel-title">LIQUIDACION</div>
        <table class="grid">
          <thead>
            <tr>
              <th class="c-fecha">FECHA</th>
              <th>FACTURA</th>
              <th class="c-imp">IMPORTE</th>
            </tr>
          </thead>
          <tbody>${liquidacionHtml}</tbody>
        </table>
        <div class="panel-foot">
          <span>TOTAL A PAGAR $</span>
          <span class="amt">${formatMoneyAr(totalLiquidacion)}</span>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">DETALLE DE COBRO</div>
        <table class="grid">
          <thead>
            <tr>
              <th style="width:78px">CHEQUE</th>
              <th class="c-fecha">FECHA</th>
              <th>CARGO BANCO</th>
              <th class="c-imp">IMPORTE</th>
            </tr>
          </thead>
          <tbody>${cobroHtml}</tbody>
        </table>
        <div class="efectivo-row">
          <span>EFECTIVO $</span>
          <span class="amt">${cobroEfectivo || ''}</span>
        </div>
        <div class="total-box">
          <span>TOTAL $</span>
          <span>${formatMoneyAr(amount)}</span>
        </div>
      </div>
    </div>

    <div class="son-pesos"><span class="lab">Son PESOS:</span>${sonPesos}</div>

    <div class="bottom">
      <div class="copies">
        ORIGINAL Blanco<br/>
        DUPLICADO Color
      </div>
      <div class="sign">
        <div class="sign-line">${firmaEmpresa}</div>
      </div>
    </div>

    <div class="press">
      Documento generado por LupoHub — comprobante de pago / recibo de cuenta corriente (no válido como factura).
    </div>
  </div>

  <div class="no-print" style="max-width:277mm;margin:12px auto;padding:0 7mm;">
    <button onclick="window.print()" style="padding:10px 18px;font-size:12px;cursor:pointer;background:#1f2937;color:#fff;border:none;border-radius:6px;font-weight:700;">Descargar PDF / Imprimir</button>
    <button onclick="window.close()" style="padding:10px 18px;font-size:12px;cursor:pointer;background:#9ca3af;color:#fff;border:none;border-radius:6px;">Cerrar</button>
  </div>
</body></html>`;
}
