/**
 * HTML imprimible de recibo / comprobante de pago (cuenta corriente).
 * Misma idea de vista previa + window.print que facturas mayoristas.
 */
import type { Customer, Payment } from '../types';
import { formatOrderDate } from './formatDate';
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
  const m = String(raw || '')
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Fecha larga en español (ej. 04 de noviembre de 2026). */
function formatFechaLarga(raw: string): string {
  const d = parseYmdLocal(raw);
  if (!d) return formatOrderDate(raw) || raw || '—';
  const meses = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ];
  return `${String(d.getDate()).padStart(2, '0')} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
}

export function buildPaymentReceiptHtml(params: {
  payment: Payment;
  customer?: Customer;
  remitente: FacturaRemitente;
}): string {
  const { payment, customer, remitente } = params;
  if (!payment) return '';

  const receiptNumber = String(payment.receiptNumber || '').trim() || '—';
  const fecha = formatOrderDate(payment.date) || String(payment.date || '').slice(0, 10) || '—';
  const fechaLarga = formatFechaLarga(String(payment.date || ''));
  const amount = Math.round(Number(payment.amount || 0) * 100) / 100;

  const razonEmpresa = escapeHtmlText(String(remitente.businessName || 'Empresa'));
  const cuitEmpresa = escapeHtmlText(String(remitente.cuit || ''));
  const condicionIvaEmisor = escapeHtmlText(
    String(remitente.condicionIva || remitente.condicion_iva || 'Responsable Inscripto').trim()
  );
  const empresaDirRaw = [remitente.address, remitente.city].filter(Boolean).join(', ');
  const razonEmpresaLower = String(remitente.businessName || '').toLowerCase();
  const dirEmpresa = escapeHtmlText(
    razonEmpresaLower.includes('multimedia') || razonEmpresaLower.includes('multimedias')
      ? 'Murillo 630, CABA'
      : empresaDirRaw || ''
  );

  const logoUrl = remitente.logoUrl && String(remitente.logoUrl).trim() ? String(remitente.logoUrl).trim() : '';
  const logoBlock = logoUrl
    ? `<div style="display:flex;align-items:center;gap:8px;">
           <img src="${logoUrl}" alt="Logo" referrerpolicy="no-referrer" style="max-height:56px;max-width:220px;width:auto;height:auto;object-fit:contain;display:block;" />
         </div>`
    : `<span style="font-weight:700;font-size:16px;">${razonEmpresa}</span>`;

  const clienteNombre = escapeHtmlText(
    payment.customerBusinessName || customer?.businessName || customer?.name || 'Cliente'
  );
  const clienteDir = escapeHtmlText([customer?.address, customer?.city].filter(Boolean).join(', ') || '');
  const cuitCliente = escapeHtmlText(String(customer?.cuit || '').trim());
  const condicionIvaCliente = escapeHtmlText(String(customer?.condicionIva || '').trim());
  const sellerName = escapeHtmlText(String(payment.sellerName || '').trim());
  const notes = escapeHtmlText(String(payment.notes || '').trim());

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

  const allocationRows: string[] = [];
  for (const link of orderLinks) {
    const label = escapeHtmlText(String(link.label || link.orderId || 'Pedido'));
    const imputa = Number(link.amountApplied) || 0;
    allocationRows.push(`<tr>
      <td>Pedido</td>
      <td class="mono">${label}</td>
      <td class="col-r">${imputa > 0.005 ? `$${formatMoneyAr(imputa)}` : '—'}</td>
    </tr>`);
  }
  for (const link of invoiceLinks) {
    const label = escapeHtmlText(String(link.label || link.invoiceId || 'Factura'));
    const imputa = Number(link.amountApplied) || 0;
    allocationRows.push(`<tr>
      <td>Factura</td>
      <td class="mono">${label}</td>
      <td class="col-r">${imputa > 0.005 ? `$${formatMoneyAr(imputa)}` : '—'}</td>
    </tr>`);
  }

  const allocationsBlock =
    allocationRows.length > 0
      ? `<div class="section-title">Comprobantes imputados</div>
        <table>
          <thead>
            <tr>
              <th style="width:88px;">Tipo</th>
              <th>Detalle</th>
              <th class="col-r" style="width:110px;">Imputa</th>
            </tr>
          </thead>
          <tbody>
            ${allocationRows.join('')}
          </tbody>
        </table>`
      : `<div class="muted" style="margin-top:14px;">Sin facturas ni pedidos asociados (a cuenta del cliente).</div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Recibo ${escapeHtmlText(receiptNumber)}</title><style>
      @page { size: A4; margin: 12mm 12mm 14mm 12mm; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 0; color: #111; background: #fff; font-family: Arial, Helvetica, sans-serif; font-size: 11px; }
      .sheet { width: 210mm; min-height: 297mm; padding: 10mm; margin: 0 auto; }
      .original { border: 1px solid #111; text-align: center; font-weight: 700; letter-spacing: 0.05em; padding: 6px 0; margin-bottom: 0; }
      .topbar { display: grid; grid-template-columns: 1fr 1.15fr; gap: 0; align-items: stretch; border: 1px solid #111; border-top: 0; }
      .head-left { border-right: 1px solid #111; padding: 10px; }
      .head-right { padding: 8px 10px; }
      .issuer-title { font-weight: 700; margin: 6px 0 2px; }
      .fact-row { display: grid; grid-template-columns: 72px 1fr; align-items: stretch; gap: 10px; margin-bottom: 6px; }
      .letter-box { border: 1px solid #111; text-align: center; display: flex; flex-direction: column; justify-content: center; min-height: 74px; }
      .letter-box .l { font-size: 36px; line-height: 1; font-weight: 700; }
      .letter-box .c { font-size: 11px; font-weight: 700; margin-top: 2px; }
      .doc-title { font-size: 32px; font-weight: 700; letter-spacing: 0.02em; line-height: 1; margin-top: 4px; }
      .fact-meta { margin-top: 10px; font-size: 13px; }
      .fact-meta div { margin-bottom: 4px; }
      .boxrow { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 0; }
      .block { padding: 8px 10px; border: 1px solid #111; border-top: 0; min-height: 64px; }
      .amount-box { margin-top: 16px; border: 2px solid #111; padding: 14px 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
      .amount-box .label { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
      .amount-box .value { font-size: 28px; font-weight: 800; letter-spacing: 0.01em; }
      .section-title { margin-top: 18px; margin-bottom: 6px; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
      table { width: 100%; border-collapse: collapse; }
      thead th { border-top: 1px solid #111; border-bottom: 1px solid #111; padding: 6px; text-align: left; }
      tbody td { padding: 5px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
      .col-r { text-align: right; }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10.5px; }
      .muted { color: #444; }
      .notes { margin-top: 14px; border: 1px solid #111; padding: 8px 10px; min-height: 42px; }
      .signs { margin-top: 36px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
      .sign { text-align: center; padding-top: 36px; border-top: 1px solid #111; font-size: 11px; }
      .disclaimer { margin-top: 18px; font-size: 9px; color: #555; }
      .no-print { margin-top: 14px; display: flex; gap: 10px; }
      @media print {
        .sheet { min-height: auto; padding: 0; width: auto; }
        .no-print { display: none !important; }
      }
    </style></head><body>
      <div class="sheet">
        <div class="original">ORIGINAL</div>
        <div class="topbar">
          <div class="head-left">
            <div>${logoBlock}</div>
            <div class="issuer-title">${razonEmpresa}</div>
            ${dirEmpresa ? `<div>${dirEmpresa}</div>` : ''}
            ${cuitEmpresa ? `<div>C.U.I.T.: ${cuitEmpresa}</div>` : ''}
            ${condicionIvaEmisor ? `<div><strong>Condición frente al IVA:</strong> ${condicionIvaEmisor}</div>` : ''}
          </div>
          <div class="head-right">
            <div class="fact-row">
              <div class="letter-box">
                <div class="l">X</div>
                <div class="c">RECIBO</div>
              </div>
              <div>
                <div class="doc-title">RECIBO</div>
                <div class="fact-meta">
                  <div><strong>Nº:</strong> ${escapeHtmlText(receiptNumber)}</div>
                  <div><strong>Fecha:</strong> ${escapeHtmlText(fecha)}</div>
                </div>
              </div>
            </div>
            <div class="muted">Documento no fiscal — comprobante de pago / cuenta corriente</div>
          </div>
        </div>

        <div class="boxrow">
          <div class="block">
            <div><strong>Recibimos de:</strong> ${clienteNombre}</div>
            ${clienteDir ? `<div>${clienteDir}</div>` : ''}
            ${cuitCliente ? `<div>C.U.I.T.: ${cuitCliente}</div>` : ''}
            ${condicionIvaCliente ? `<div><strong>Condición frente al IVA:</strong> ${condicionIvaCliente}</div>` : ''}
          </div>
          <div class="block">
            <div><strong>Fecha del pago:</strong> ${escapeHtmlText(fechaLarga)}</div>
            ${sellerName ? `<div><strong>Vendedor:</strong> ${sellerName}</div>` : ''}
            <div><strong>Concepto:</strong> Cancelación / pago a cuenta</div>
          </div>
        </div>

        <div class="amount-box">
          <div class="label">Importe recibido</div>
          <div class="value">$${formatMoneyAr(amount)}</div>
        </div>

        ${allocationsBlock}

        <div class="notes">
          <strong>Observaciones:</strong>
          <div style="margin-top:4px;">${notes || '—'}</div>
        </div>

        <div class="signs">
          <div class="sign">Firma del receptor</div>
          <div class="sign">Aclaración / sello</div>
        </div>

        <div class="disclaimer">
          Este recibo acredita el pago indicado y su imputación a los comprobantes listados (si los hay).
          No constituye factura ni comprobante fiscal AFIP.
        </div>

        <div class="no-print">
          <button onclick="window.print()" style="padding: 10px 18px; font-size: 12px; cursor: pointer; background: #1f2937; color: white; border: none; border-radius: 6px; font-weight: 700;">Descargar PDF / Imprimir</button>
          <button onclick="window.close()" style="padding: 10px 18px; font-size: 12px; cursor: pointer; background: #9ca3af; color: white; border: none; border-radius: 6px;">Cerrar</button>
        </div>
      </div>
    </body></html>`;
}
