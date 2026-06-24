import { RemitenteConfig } from '../types';

export type TiendaNubeExpressLabelOrder = {
  id: number;
  number: number;
  shippingMethod?: string;
  customer: {
    name: string;
    email?: string;
    phone?: string;
  };
  products?: Array<{ name?: string; sku?: string; quantity?: number }>;
  shippingAddress: {
    address?: string;
    city?: string;
    province?: string;
    zipcode?: string;
    number?: string;
    floor?: string;
    apartment?: string;
    locality?: string;
    country?: string;
    betweenStreets?: string;
  } | null;
  createdAt?: string;
};

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatShippingAddress(shipping: TiendaNubeExpressLabelOrder['shippingAddress']): string {
  if (!shipping) return 'Sin dirección de envío';
  const line1 = [shipping.address, shipping.number].filter(Boolean).join(' ').trim();
  const line2Parts = [
    shipping.floor ? `Piso ${shipping.floor}` : '',
    shipping.apartment ? `Dto ${shipping.apartment}` : ''
  ].filter(Boolean);
  const line2 = line2Parts.join(' - ');
  const line3 = [shipping.locality, shipping.city, shipping.province].filter(Boolean).join(', ').trim();
  const line4 = [shipping.zipcode ? `CP ${shipping.zipcode}` : '', shipping.country || ''].filter(Boolean).join(', ');
  const between = shipping.betweenStreets ? `Entre: ${shipping.betweenStreets}` : '';
  return [line1, line2, line3, line4, between].filter(Boolean).join('<br/>') || 'Sin dirección de envío';
}

/** Contenido interno de la etiqueta (sin documento HTML completo). */
export function buildTiendaNubeExpressLabelInnerHtml(
  order: TiendaNubeExpressLabelOrder,
  trackingCode: string,
  remitente: RemitenteConfig
): string {
  const empresa = (remitente.businessName || 'Multimedias SA').toString();
  const empresaDir = [remitente.address, remitente.city].filter(Boolean).join(', ');
  const empresaPhone = (remitente.phone || '').toString().trim();
  const customerName = (order.customer?.name || 'Cliente').toString().trim();
  const customerPhone = (order.customer?.phone || '').toString().trim();
  const shippingMethod = (order.shippingMethod || 'Envío Express').toString().trim();
  const address = formatShippingAddress(order.shippingAddress);
  const totalUnits = (order.products || []).reduce((acc, p) => acc + (Number(p.quantity) || 0), 0);
  const barcodeUrl = `https://bwipjs-api.metafloor.com/?bcid=code128&text=${encodeURIComponent(trackingCode)}&scale=3&height=12&includetext`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(trackingCode)}`;

  return `
  <div class="express-label">
    <div class="header">
      <div class="badge">EXPRESS</div>
      <div class="order-ref">
        <strong>TN #${esc(order.number)}</strong>
        ID ${esc(order.id)}<br/>
        ${totalUnits} u.
      </div>
    </div>
    <div class="block">
      <div class="block-title">Remitente</div>
      <div><strong>${esc(empresa)}</strong></div>
      ${empresaDir ? `<div>${esc(empresaDir)}</div>` : ''}
      ${empresaPhone ? `<div>Tel: ${esc(empresaPhone)}</div>` : ''}
    </div>
    <div class="block">
      <div class="block-title">Destinatario</div>
      <div class="dest-name">${esc(customerName)}</div>
      ${customerPhone ? `<div class="dest-phone">Tel: ${esc(customerPhone)}</div>` : ''}
      <div style="margin-top:6px;line-height:1.35;">${address}</div>
    </div>
    <div class="tracking">
      <div class="tracking-label">Código de seguimiento</div>
      <div class="tracking-code">${esc(trackingCode)}</div>
      <div class="barcode"><img src="${barcodeUrl}" alt="Código de barras" /></div>
      <div class="qr-row"><img src="${qrUrl}" alt="QR seguimiento" /></div>
    </div>
    <div class="meta">
      <span>${esc(shippingMethod)}</span>
      <span>Tienda Nube</span>
    </div>
  </div>`;
}

export const EXPRESS_LABEL_CSS = `
  .express-label { width: 92mm; margin: 0 auto; border: 2px solid #111; padding: 6px; display: flex; flex-direction: column; gap: 6px; font-size: 11px; }
  .express-label .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 6px; }
  .express-label .badge { background: #111; color: #fff; font-weight: 900; font-size: 13px; padding: 4px 8px; letter-spacing: 0.05em; }
  .express-label .order-ref { text-align: right; font-size: 10px; line-height: 1.35; }
  .express-label .order-ref strong { font-size: 14px; display: block; }
  .express-label .block { border: 1px solid #333; border-radius: 4px; padding: 6px; }
  .express-label .block-title { font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.08em; color: #444; margin-bottom: 3px; }
  .express-label .dest-name { font-size: 15px; font-weight: 900; line-height: 1.2; }
  .express-label .dest-phone { font-size: 11px; margin-top: 2px; }
  .express-label .tracking { text-align: center; border: 2px dashed #111; border-radius: 6px; padding: 8px 4px; }
  .express-label .tracking-code { font-size: 20px; font-weight: 900; letter-spacing: 0.12em; font-family: monospace; }
  .express-label .tracking-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: #444; margin-bottom: 4px; }
  .express-label .barcode img { max-width: 100%; height: auto; display: block; margin: 4px auto 0; }
  .express-label .qr-row { display: flex; justify-content: center; align-items: center; gap: 8px; margin-top: 4px; }
  .express-label .qr-row img { width: 56px; height: 56px; border: 1px solid #ccc; }
  .express-label .meta { font-size: 10px; color: #333; display: flex; justify-content: space-between; gap: 8px; }
  .express-label-page { page-break-before: always; margin-top: 24px; }
`;

/** HTML imprimible de etiqueta express (100×150 mm aprox.) con código de seguimiento. */
export function buildTiendaNubeExpressLabelHtml(
  order: TiendaNubeExpressLabelOrder,
  trackingCode: string,
  remitente: RemitenteConfig
): string {
  const inner = buildTiendaNubeExpressLabelInnerHtml(order, trackingCode, remitente);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Etiqueta Express TN #${order.number}</title>
  <style>
    @page { size: 100mm 150mm; margin: 4mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; }
    ${EXPRESS_LABEL_CSS}
    .print-actions { margin-top: 10px; text-align: center; }
    @media print { .print-actions { display: none; } body { margin: 0; } }
  </style>
</head>
<body>
  ${inner}
  <div class="print-actions">
    <button onclick="window.print()" style="padding:10px 14px;background:#1f2937;color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer;">Imprimir etiqueta</button>
    <button onclick="window.close()" style="padding:10px 14px;margin-left:8px;background:#94a3b8;color:#fff;border:none;border-radius:6px;cursor:pointer;">Cerrar</button>
  </div>
</body>
</html>`;
}
