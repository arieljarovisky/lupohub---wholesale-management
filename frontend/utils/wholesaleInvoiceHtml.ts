/**
 * HTML imprimible de factura y nota de crédito para pedidos mayorista (misma vista en Pedidos y Facturación).
 * Totales: precios de línea y total del pedido son neto gravado; IVA 21% y total como en AFIP (neto + IVA).
 */
import type { CreditNote, Customer, Order, OrderItem, Product } from '../types';
import { formatMoneyAr } from './moneyFormat';

export type FacturaRemitente = Record<string, unknown> & {
  businessName?: string;
  address?: string;
  city?: string;
  cuit?: string;
  ingresosBrutos?: string;
  inicioActividad?: string;
  email?: string;
  phone?: string;
  logoUrl?: string;
  condicionIva?: string;
  condicion_iva?: string;
};

export function enrichOrderItem(item: OrderItem, products: Product[]): OrderItem {
  if (item.sku != null && item.productName != null) return item;
  const variantId = item.variantId ?? item.productId;
  if (!variantId) return item;
  const p = products.find((x: Product) => x.id === variantId);
  if (!p) return item;
  return {
    ...item,
    sku: item.sku ?? p.sku,
    productName: item.productName ?? p.name,
    sizeCode: item.sizeCode ?? p.size,
    colorName: item.colorName ?? p.color,
  };
}

export function sortOrderItemsForPrint(items: OrderItem[], products: Product[]): OrderItem[] {
  const baseArticleCode = (skuRaw: string): string => {
    const sku = (skuRaw || '').trim();
    if (!sku) return '';
    const match = sku.match(/\d{5,}/);
    if (match) return match[0].slice(0, 5);
    return sku.slice(0, 5);
  };

  return [...items].sort((a, b) => {
    const aVariantId = a.variantId ?? a.productId;
    const bVariantId = b.variantId ?? b.productId;
    const aLocal = aVariantId ? products.find((p: Product) => p.id === aVariantId) : undefined;
    const bLocal = bVariantId ? products.find((p: Product) => p.id === bVariantId) : undefined;

    const aSku = (aLocal?.sku ?? a.sku ?? '').toString().trim();
    const bSku = (bLocal?.sku ?? b.sku ?? '').toString().trim();
    const aBase = baseArticleCode(aSku);
    const bBase = baseArticleCode(bSku);
    const byBase = aBase.localeCompare(bBase, 'es', { numeric: true, sensitivity: 'base' });
    if (byBase !== 0) return byBase;

    const bySku = aSku.localeCompare(bSku, 'es', { numeric: true, sensitivity: 'base' });
    if (bySku !== 0) return bySku;

    const aName = (a.productName ?? '').toString().trim();
    const bName = (b.productName ?? '').toString().trim();
    const byName = aName.localeCompare(bName, 'es', { numeric: true, sensitivity: 'base' });
    if (byName !== 0) return byName;

    const aSize = (a.sizeCode ?? '').toString().trim();
    const bSize = (b.sizeCode ?? '').toString().trim();
    const bySize = aSize.localeCompare(bSize, 'es', { numeric: true, sensitivity: 'base' });
    if (bySize !== 0) return bySize;

    const aColor = (a.colorName ?? '').toString().trim();
    const bColor = (b.colorName ?? '').toString().trim();
    return aColor.localeCompare(bColor, 'es', { numeric: true, sensitivity: 'base' });
  });
}

export type ManualFacturaFields = { remitoNumber?: string; transportNumber?: string; saleCondition?: string };

export function normalizeSkuForPrint(raw: unknown): string {
  return String(raw ?? '').trim().replace(/-/g, '');
}

export function buildWholesaleFacturaHtml(params: {
  order: Order;
  customer?: Customer;
  products: Product[];
  remitente: FacturaRemitente;
  manual?: ManualFacturaFields;
}): string {
  const { order, customer, products, remitente, manual } = params;
  if (!order.invoice) return '';
  const inv = order.invoice;

  const items = sortOrderItemsForPrint(
    order.items.map((i) => enrichOrderItem(i, products)),
    products
  );

  const formatDateShort = (d: string) => {
    const x = new Date(d);
    if (isNaN(x.getTime())) return d;
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const day = x.getDate();
    const month = meses[x.getMonth()];
    const year = x.getFullYear();
    return `${String(day).padStart(2, '0')} ${month} ${year}`;
  };

  const cbteTipoNum = Number((inv as { cbteTipo?: number }).cbteTipo ?? (inv as { cbte_tipo?: number }).cbte_tipo);
  const tipoFactura = cbteTipoNum === 1 ? 'A' : cbteTipoNum === 11 ? 'C' : 'B';
  const codigoComprobante = cbteTipoNum === 1 ? '001' : cbteTipoNum === 11 ? '011' : '006';
  const nroComprobante = inv.puntoVta != null ? `${String(inv.puntoVta).padStart(5, '0')}-${String(inv.cbteDesde).padStart(8, '0')}` : String(inv.cbteDesde);
  const fechaComprobante = inv.createdAt ? formatDateShort(inv.createdAt) : formatDateShort(order.date);
  const clienteNombre = order.customerBusinessName || customer?.businessName || customer?.name || 'Cliente';

  const sumLines = items.reduce((s, i) => {
    const qty = Number(i.quantity || 0);
    const unit = Number(i.priceAtMoment ?? 0);
    return s + Math.round(qty * unit * 100) / 100;
  }, 0);
  /** Neto gravado: suma de líneas; si no hay ítems, fallback a orders.total (puede estar desactualizado). */
  const netoGravado =
    sumLines > 0 ? Math.round(sumLines * 100) / 100 : Math.round((Number(order.total) > 0 ? Number(order.total) : 0) * 100) / 100;
  const iva21 = Math.round(netoGravado * 0.21 * 100) / 100;
  const total = Math.round((netoGravado + iva21) * 100) / 100;
  const subtotalBruto = netoGravado;

  const rows = items
    .map((i) => {
      const qty = Number(i.quantity || 0);
      const unit = Number(i.priceAtMoment ?? 0);
      const importe = Math.round(qty * unit * 100) / 100;
      const variantId = i.variantId ?? i.productId;
      const localProduct = variantId ? products.find((p: Product) => p.id === variantId) : undefined;
      const sku = normalizeSkuForPrint(localProduct?.sku ?? i.sku ?? '');
      const name = (i.productName ?? '').toString().trim();
      const despacho = (i as OrderItem & { numero_despacho?: string }).numeroDespacho ?? (i as OrderItem & { numero_despacho?: string }).numero_despacho ?? null;
      const despachoCell = despacho != null && String(despacho).trim() ? String(despacho).trim() : '—';
      const desc = name || '—';
      return `<tr>
        <td class="col-c">${qty.toLocaleString('es-AR')}</td>
        <td class="col-c col-code">${sku || '—'}</td>
        <td class="col-desc">${desc}</td>
        <td class="col-c">${despachoCell}</td>
        <td class="col-r">$${formatMoneyAr(unit)}</td>
        <td class="col-r">$${formatMoneyAr(importe)}</td>
      </tr>`;
    })
    .join('');

  const vtoCae = inv.caeFchVto ? formatDateShort(inv.caeFchVto) : '—';
  const logoUrlFactura = remitente.logoUrl && String(remitente.logoUrl).trim() ? String(remitente.logoUrl).trim() : '';
  const logoPlaceholderFactura = ((remitente.businessName || 'Empresa') as string).replace(/</g, '&lt;');
  const logoBlockFactura = logoUrlFactura
    ? `<div style="display:flex;align-items:center;gap:8px;">
           <img src="${logoUrlFactura}" alt="Logo" class="inv-logo" referrerpolicy="no-referrer" style="max-height:56px;max-width:220px;width:auto;height:auto;object-fit:contain;display:block;" />
         </div>`
    : `<span class="inv-logo-placeholder">${logoPlaceholderFactura}</span>`;
  const empresaDir = [remitente.address, remitente.city].filter(Boolean).join(', ') || '';
  const clienteDir = [customer?.address, customer?.city].filter(Boolean).join(', ') || '';
  const razonEmpresa = (remitente.businessName || '—').toString();
  const cuitEmpresa = (remitente.cuit || '').toString();
  const ingresosBrutosEmpresa = (remitente.ingresosBrutos || '901-2113373').toString();
  const inicioActividadEmpresa = (remitente.inicioActividad || '13/06/2005').toString();
  const razonEmpresaLower = razonEmpresa.toLowerCase();
  const dirEmpresa = razonEmpresaLower.includes('multimedia') || razonEmpresaLower.includes('multimedias') ? 'Murillo 630, CABA' : empresaDir || '';
  const razonCliente = clienteNombre || 'Cliente';
  const cuitCliente = (customer?.cuit || '').toString();
  const condicionIvaEmisor = (remitente.condicionIva || remitente.condicion_iva || 'Responsable Inscripto').toString().trim();
  const condicionIvaReceptor = (customer?.condicionIva || 'Consumidor Final').toString().trim();
  const transportNumber = (manual?.transportNumber ?? customer?.transportNumber ?? '').toString().trim();
  const remitoNumber = (manual?.remitoNumber ?? customer?.remitoNumber ?? '').toString().trim();
  const saleConditionRaw = (manual?.saleCondition ?? customer?.saleCondition ?? '').toString().trim().toLowerCase();
  const saleCondition = saleConditionRaw.includes('60') ? '60 días' : '30 días';
  const dirCliente = clienteDir || '';
  const ptoVta = String(inv.puntoVta ?? '').padStart(5, '0');
  const compNro = String(inv.cbteDesde ?? '').padStart(8, '0');
  const periodDate = new Date(order.date);
  const validPeriodDate = !isNaN(periodDate.getTime()) ? periodDate : new Date();
  const periodFrom = new Date(validPeriodDate.getFullYear(), validPeriodDate.getMonth(), 1).toLocaleDateString('es-AR');
  const periodTo = new Date(validPeriodDate.getFullYear(), validPeriodDate.getMonth() + 1, 0).toLocaleDateString('es-AR');

  const fechaQrBase = inv.createdAt ? new Date(inv.createdAt) : new Date(order.date);
  const fechaQr = !isNaN(fechaQrBase.getTime())
    ? `${fechaQrBase.getFullYear()}-${String(fechaQrBase.getMonth() + 1).padStart(2, '0')}-${String(fechaQrBase.getDate()).padStart(2, '0')}`
    : '';
  const cuitEmisorNum = Number(String(cuitEmpresa).replace(/\D/g, '')) || 0;
  const cuitReceptorDigits = String(cuitCliente).replace(/\D/g, '');
  const tipoDocRec = cuitReceptorDigits.length === 11 ? 80 : cuitReceptorDigits.length >= 7 ? 96 : 99;
  const nroDocRec = cuitReceptorDigits ? Number(cuitReceptorDigits) : 0;
  const qrPayload = {
    ver: 1,
    fecha: fechaQr,
    cuit: cuitEmisorNum,
    ptoVta: Number(inv.puntoVta ?? 0),
    tipoCmp: Number((inv as { cbteTipo?: number }).cbteTipo ?? (inv as { cbte_tipo?: number }).cbte_tipo ?? 0),
    nroCmp: Number(inv.cbteDesde ?? 0),
    importe: Number(total.toFixed(2)),
    moneda: 'PES',
    ctz: 1,
    tipoDocRec,
    nroDocRec,
    tipoCodAut: 'E',
    codAut: Number(String(inv.cae || '').replace(/\D/g, '')) || 0,
  };
  const afipQrUrl = `https://www.afip.gob.ar/fe/qr/?p=${btoa(unescape(encodeURIComponent(JSON.stringify(qrPayload))))}`;
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(afipQrUrl)}`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Factura ${nroComprobante}</title><style>
      @page { size: A4; margin: 12mm 12mm 14mm 12mm; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 0; color: #111; background: #fff; font-family: Arial, Helvetica, sans-serif; font-size: 11px; }
      .sheet { width: 210mm; min-height: 297mm; padding: 10mm; margin: 0 auto; }
      .topbar { display: grid; grid-template-columns: 1fr 1.25fr; gap: 0; align-items: stretch; margin-bottom: 0; border: 1px solid #111; border-top: 0; }
      .logo { min-height: 42px; display: flex; align-items: center; }
      .logo img { max-height: 42px; max-width: 140px; object-fit: contain; }
      .original { border: 1px solid #111; text-align: center; font-weight: 700; letter-spacing: 0.05em; padding: 6px 0; margin-bottom: 0; }
      .head-left { border-right: 1px solid #111; padding: 10px 10px 8px; }
      .head-right { padding: 8px 10px; }
      .issuer-title { font-size: inherit; font-weight: inherit; margin: 2px 0 0; letter-spacing: 0; }
      .mini { font-size: 10px; }
      .fact-row { display: grid; grid-template-columns: 72px 1fr; align-items: stretch; gap: 10px; margin-bottom: 8px; }
      .letter-box { border: 1px solid #111; text-align: center; display: flex; flex-direction: column; justify-content: center; min-height: 74px; }
      .letter-box .l { font-size: 44px; line-height: 1; font-weight: 700; }
      .letter-box .c { font-size: 20px; font-weight: 700; margin-top: -4px; }
      .fact-title { font-size: 40px; font-weight: 700; letter-spacing: 0.02em; line-height: 1; margin-top: 4px; }
      .fact-meta { margin-top: 10px; font-size: 13px; }
      .fact-meta div { margin-bottom: 4px; }
      .hr { border-top: 1px solid #111; margin: 0 0 0; }
      .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .block { padding: 8px 10px; border: 1px solid #111; min-height: 58px; }
      .muted { color: #333; }
      .line { display: flex; gap: 8px; }
      .line .k { width: 78px; color: #333; }
      .line .v { flex: 1; }
      .boxrow { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 0; margin-top: 0; }
      .boxrow .block { min-height: 46px; border-top: 0; }
      .period-row { border: 1px solid #111; border-top: 0; padding: 6px 10px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; font-weight: 700; }
      .period-row span { font-weight: 400; }

      table { width: 100%; border-collapse: collapse; margin-top: 10px; }
      thead th { border-top: 1px solid #111; border-bottom: 1px solid #111; padding: 6px 6px; text-align: left; }
      tbody td { padding: 5px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
      tfoot td { padding: 6px; }
      .col-c { text-align: center; }
      .col-r { text-align: right; }
      .col-code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10px; }
      .col-desc { white-space: normal; word-break: break-word; overflow-wrap: anywhere; }
      .summary { display: grid; grid-template-columns: 96px 220px; justify-content: end; align-items: start; gap: 10px; margin-top: 10px; }
      .totals { border: 1px solid #111; }
      .totals .r { display: flex; justify-content: space-between; padding: 6px 8px; border-bottom: 1px solid #ddd; }
      .totals .r:last-child { border-bottom: none; font-weight: 700; }
      .footer { margin-top: 12px; font-size: 10px; }
      .bottom-block { margin-top: auto; }
      .qr-wrap { border: 1px solid #111; padding: 3px; text-align: center; }
      .qr-wrap img { width: 84px; height: 84px; display: block; margin: 0 auto; }
      .qr-label { margin-top: 3px; font-size: 8px; line-height: 1.1; }
      .no-print { margin-top: 14px; display: flex; gap: 10px; }
      @media print { .no-print { display: none !important; } }
    </style></head><body>
      <div class="sheet">
        <div class="original">ORIGINAL</div>
        <div class="topbar">
          <div class="head-left">
            <div class="logo">${logoBlockFactura}</div>
            <div class="issuer-title">${razonEmpresa}</div>
            ${dirEmpresa ? `<div>${dirEmpresa}</div>` : ''}
            ${cuitEmpresa ? `<div>C.U.I.T.: ${cuitEmpresa}</div>` : ''}
            ${condicionIvaEmisor ? `<div><strong>Condición frente al IVA:</strong> ${condicionIvaEmisor}</div>` : ''}
          </div>
          <div class="head-right">
            <div class="fact-row">
              <div class="letter-box">
                <div class="l">${tipoFactura}</div>
                <div class="mini">COD. ${codigoComprobante}</div>
              </div>
              <div>
                <div class="fact-title">FACTURA</div>
                <div class="fact-meta">
                  <div><strong>Punto de Venta:</strong> ${ptoVta} &nbsp;&nbsp; <strong>Comp. Nro:</strong> ${compNro}</div>
                  <div><strong>Fecha de Emisión:</strong> ${fechaComprobante}</div>
                </div>
              </div>
            </div>
            ${cuitEmpresa ? `<div><strong>CUIT:</strong> ${cuitEmpresa}</div>` : ''}
            ${ingresosBrutosEmpresa ? `<div><strong>Ingresos Brutos:</strong> ${ingresosBrutosEmpresa}</div>` : ''}
            ${inicioActividadEmpresa ? `<div><strong>Fecha de Inicio de Actividades:</strong> ${inicioActividadEmpresa}</div>` : ''}
          </div>
        </div>

        <div class="period-row">
          <div>Período Facturado Desde: <span>${periodFrom}</span></div>
          <div>Hasta: <span>${periodTo}</span></div>
          <div>Fecha de Vto. para el pago: <span>${fechaComprobante}</span></div>
        </div>

        <div class="boxrow">
          <div class="block">
            <div><strong>Sr./es:</strong> ${razonCliente}</div>
            ${dirCliente ? `<div>${dirCliente}</div>` : ''}
            ${cuitCliente ? `<div>C.U.I.T.: ${cuitCliente}</div>` : ''}
            ${condicionIvaReceptor ? `<div><strong>Condición frente al IVA:</strong> ${condicionIvaReceptor}</div>` : ''}
          </div>
          <div class="block">
            ${transportNumber ? `<div><strong>N° Transporte:</strong> ${transportNumber}</div>` : ''}
            ${remitoNumber ? `<div><strong>N° Remito:</strong> ${remitoNumber}</div>` : ''}
            <div><strong>Condición de venta:</strong> ${saleCondition}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th class="col-c" style="width: 52px;">CANT.</th>
              <th class="col-c" style="width: 110px;">CÓDIGO</th>
              <th>DESCRIPCIÓN</th>
              <th class="col-c" style="width: 125px;">Nº DESPACHO</th>
              <th class="col-r" style="width: 88px;">P. UNITARIO</th>
              <th class="col-r" style="width: 92px;">IMPORTE</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>

        <div class="bottom-block">
          <div class="summary">
            <div class="qr-wrap">
              <img src="${qrImageUrl}" alt="QR AFIP" />
              <div class="qr-label">Comprobante autorizado<br/>AFIP</div>
            </div>
            <div class="totals">
              <div class="r"><span>Subtotal Bruto</span><span>$${formatMoneyAr(subtotalBruto)}</span></div>
              <div class="r"><span>Bonificación</span><span>$${formatMoneyAr(0)}</span></div>
              <div class="r"><span>Subtotal Neto</span><span>$${formatMoneyAr(netoGravado)}</span></div>
              <div class="r"><span>IVA 21%</span><span>$${formatMoneyAr(iva21)}</span></div>
              <div class="r"><span>Total</span><span>$${formatMoneyAr(total)}</span></div>
            </div>
          </div>
          <div class="footer">
            <div><strong>CAE:</strong> ${inv.cae} &nbsp; <strong>Vto. CAE:</strong> ${vtoCae}</div>
            <div class="muted">Consulta en afip.gob.ar con tu CUIT, fecha ${fechaComprobante} y Pto.Vta ${inv.puntoVta != null ? inv.puntoVta : ''}.</div>
          </div>
        </div>

        <div class="no-print">
          <button onclick="window.print()" style="padding: 10px 18px; font-size: 12px; cursor: pointer; background: #1f2937; color: white; border: none; border-radius: 6px; font-weight: 700;">Descargar PDF / Imprimir</button>
          <button onclick="window.close()" style="padding: 10px 18px; font-size: 12px; cursor: pointer; background: #9ca3af; color: white; border: none; border-radius: 6px;">Cerrar</button>
        </div>
      </div>
    </body></html>`;
}

export function buildWholesaleCreditNoteHtml(params: {
  order: Order;
  nc: CreditNote;
  customer?: Customer;
  products: Product[];
  remitente: FacturaRemitente;
}): string {
  const { order, nc, customer, products, remitente } = params;

  const items = sortOrderItemsForPrint(
    order.items.map((i) => enrichOrderItem(i, products)),
    products
  );

  const formatDateShort = (d: string) => {
    const x = new Date(d);
    if (isNaN(x.getTime())) return d;
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const day = x.getDate();
    const month = meses[x.getMonth()];
    const year = x.getFullYear();
    return `${String(day).padStart(2, '0')} ${month} ${year}`;
  };
  const nroNota = nc.puntoVta != null ? `${String(nc.puntoVta).padStart(5, '0')}-${String(nc.cbteDesde).padStart(8, '0')}` : String(nc.cbteDesde);
  const fechaNota = nc.createdAt ? formatDateShort(nc.createdAt) : formatDateShort(order.date);
  const clienteNombre = order.customerBusinessName || customer?.businessName || customer?.name || 'Cliente';
  /** Monto creditado en BD = neto (ImpNeto AFIP), igual que en emitirNotaCredito. */
  const totalNota = Number(nc.amountCredited || 0);
  const netoNc = Math.round(totalNota * 100) / 100;
  const ivaNc = Math.round(netoNc * 0.21 * 100) / 100;
  const totalComprobanteNc = Math.round((netoNc + ivaNc) * 100) / 100;

  const despachoOf = (i: OrderItem) => {
    const despacho = (i as OrderItem & { numero_despacho?: string }).numeroDespacho ?? (i as OrderItem & { numero_despacho?: string }).numero_despacho ?? null;
    return despacho != null && String(despacho).trim() ? String(despacho).trim() : '—';
  };
  const descOf = (i: OrderItem) => {
    const variantId = i.variantId ?? i.productId;
    const localProduct = variantId ? products.find((p: Product) => p.id === variantId) : undefined;
    const localSku = (localProduct?.sku ?? i.sku ?? '').toString().trim();
    return [localSku, (i.productName ?? '').toString().trim(), i.sizeCode ?? '', i.colorName ?? ''].filter(Boolean).join(' — ') || '—';
  };

  const scope = nc.scope || 'total';
  const itemIdx = nc.itemIndex;
  let rows: string;
  if (scope === 'item' && typeof itemIdx === 'number' && items[itemIdx]) {
    const i = items[itemIdx];
    const price = Number(i.priceAtMoment ?? 0);
    const qtyNc = price > 0 ? Math.round((totalNota / price) * 1000) / 1000 : i.quantity;
    const qtyStr = Number.isInteger(qtyNc) ? String(qtyNc) : qtyNc.toLocaleString('es-AR', { maximumFractionDigits: 3 });
    rows = `<tr><td>${descOf(i)}</td><td class="col-c">${despachoOf(i)}</td><td class="col-c">${qtyStr}</td><td class="col-r">$${formatMoneyAr(netoNc)}</td><td class="col-r">$${formatMoneyAr(ivaNc)}</td><td class="col-r">$${formatMoneyAr(totalComprobanteNc)}</td></tr>`;
  } else {
    rows = items
      .map((i) => {
        const qty = Number(i.quantity || 0);
        const unit = Number(i.priceAtMoment ?? 0);
        const lineNeto = Math.round(qty * unit * 100) / 100;
        const lineIva = Math.round(lineNeto * 0.21 * 100) / 100;
        const lineTotal = Math.round((lineNeto + lineIva) * 100) / 100;
        return `<tr><td>${descOf(i)}</td><td class="col-c">${despachoOf(i)}</td><td class="col-c">${i.quantity}</td><td class="col-r">$${formatMoneyAr(lineNeto)}</td><td class="col-r">$${formatMoneyAr(lineIva)}</td><td class="col-r">$${formatMoneyAr(lineTotal)}</td></tr>`;
      })
      .join('');
  }

  const vtoCae = nc.caeFchVto ? formatDateShort(nc.caeFchVto) : '—';
  const empresaDir = [remitente.address, remitente.city].filter(Boolean).join(', ') || '';
  const clienteDir = [customer?.address, customer?.city].filter(Boolean).join(', ') || '';

  const logoUrlNc = remitente.logoUrl && String(remitente.logoUrl).trim() ? String(remitente.logoUrl).trim() : '';
  const logoPlaceholderNc = ((remitente.businessName || 'Empresa') as string).replace(/</g, '&lt;');
  const logoBlockNc = logoUrlNc
    ? `<div style="display:flex;align-items:center;gap:8px;">
           <img src="${logoUrlNc}" alt="Logo" class="inv-logo" referrerpolicy="no-referrer"
             onerror="this.style.display='none'; var ph=this.parentElement.querySelector('.inv-logo-placeholder'); if(ph) ph.style.display='inline-block';" />
           <span class="inv-logo-placeholder" style="display:none;">${logoPlaceholderNc}</span>
         </div>`
    : `<span class="inv-logo-placeholder">${logoPlaceholderNc}</span>`;

  const scopeLabel = scope === 'item' ? 'Crédito por ítem' : 'Crédito total del pedido';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Nota de Crédito ${nroNota}</title><style>
      @page { size: A4; margin: 14mm 14mm 18mm 14mm; }
      * { box-sizing: border-box; }
      body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; margin: 0; padding: 24px 16px 40px; color: #111827; background: #f3f4f6; font-size: 13px; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .nc-doc { width: 100%; max-width: 190mm; margin: 0 auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; box-shadow: 0 10px 40px rgba(17,24,39,0.08); padding: 28px 32px 32px; }
      .nc-badge { display: inline-block; font-size: 0.65rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #92400e; background: linear-gradient(135deg, #fef3c7, #fde68a); border: 1px solid #f59e0b; padding: 5px 12px; border-radius: 999px; margin-bottom: 10px; }
      .inv-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 22px; padding-bottom: 20px; border-bottom: 3px solid #d97706; }
      .inv-logo-wrap { min-height: 56px; display: flex; align-items: center; }
      .inv-logo { max-height: 56px; max-width: 200px; width: auto; height: auto; object-fit: contain; display: block; }
      .inv-logo-placeholder { font-size: 1.25rem; font-weight: 800; color: #111827; letter-spacing: -0.02em; }
      .inv-meta { text-align: right; flex-shrink: 0; }
      .inv-meta .inv-num { font-size: 1.15rem; font-weight: 800; color: #b45309; letter-spacing: -0.02em; }
      .inv-meta .inv-fecha { font-size: 0.88rem; color: #6b7280; margin-top: 6px; font-weight: 600; }
      .inv-meta .inv-scope { font-size: 0.75rem; color: #78716c; margin-top: 8px; }
      .inv-datos { display: grid; grid-template-columns: 1fr 1fr; gap: 20px 28px; margin-bottom: 22px; padding: 16px 18px; background: #fafafa; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 0.86rem; line-height: 1.55; }
      .inv-datos strong { display: block; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; margin-bottom: 8px; font-weight: 700; }
      .inv-table-wrap { margin-bottom: 22px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
      .inv-table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
      .inv-table thead { background: linear-gradient(180deg, #fffbeb 0%, #fef3c7 100%); }
      .inv-table th { text-align: left; padding: 11px 12px; font-weight: 700; color: #78350f; border-bottom: 2px solid #f59e0b; white-space: nowrap; }
      .inv-table th:nth-child(2), .inv-table th:nth-child(3) { text-align: center; }
      .inv-table th:nth-child(n+4) { text-align: right; }
      .inv-table td { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
      .inv-table tbody tr:nth-child(even) td { background: #fafafa; }
      .inv-table tbody tr:last-child td { border-bottom: none; }
      .col-c { text-align: center; color: #4b5563; }
      .col-r { text-align: right; font-variant-numeric: tabular-nums; }
      .inv-summary { display: flex; justify-content: flex-end; margin-bottom: 24px; }
      .inv-summary-inner { min-width: 260px; font-size: 0.86rem; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
      .inv-summary-inner .row { display: flex; justify-content: space-between; gap: 20px; padding: 9px 14px; border-bottom: 1px solid #f3f4f6; }
      .inv-summary-inner .row:last-child { border-bottom: none; }
      .inv-summary-inner .row.total { font-weight: 800; font-size: 1.02rem; background: linear-gradient(90deg, #fffbeb, #fef9c3); color: #92400e; border-top: 2px solid #fbbf24; }
      .inv-footer { padding: 16px 18px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 0.78rem; color: #4b5563; }
      .inv-cae { margin-bottom: 6px; color: #374151; font-variant-numeric: tabular-nums; }
      .inv-cae strong { color: #111827; }
      .no-print { margin-top: 24px; display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
      .no-print button { padding: 11px 22px; font-size: 0.92rem; cursor: pointer; border: none; border-radius: 8px; font-weight: 600; transition: transform 0.12s, box-shadow 0.12s; }
      .no-print button:first-child { background: linear-gradient(180deg, #1f2937, #111827); color: #fff; box-shadow: 0 2px 8px rgba(17,24,39,0.25); }
      .no-print button:first-child:hover { transform: translateY(-1px); }
      .no-print button:last-child { background: #e5e7eb; color: #374151; }
      .no-print button:last-child:hover { background: #d1d5db; }
      @media print {
        .no-print { display: none !important; }
        body { background: #fff; padding: 0; }
        .nc-doc { box-shadow: none; border-radius: 0; border: none; max-width: 100%; padding: 0; }
        .inv-table tbody tr:nth-child(even) td { background: transparent; }
        .inv-datos, .inv-footer, .inv-table-wrap, .inv-summary-inner { break-inside: avoid; }
        .inv-table tr { page-break-inside: avoid; }
      }
    </style></head><body>
      <div class="nc-doc">
        <div class="nc-badge">Nota de crédito</div>
        <div class="inv-top">
          <div class="inv-logo-wrap">${logoBlockNc}</div>
          <div class="inv-meta">
            <div class="inv-num">NOTA DE CRÉDITO Nº ${nroNota}</div>
            <div class="inv-fecha">Fecha: ${fechaNota}</div>
            <div class="inv-scope">${scopeLabel}</div>
          </div>
        </div>
        <div class="inv-datos">
          <div>
            <strong>Datos empresa</strong>
            ${remitente.businessName || '—'}<br>
            ${empresaDir ? empresaDir + '<br>' : ''}${remitente.cuit ? 'CUIT ' + remitente.cuit + '<br>' : ''}${remitente.email ? remitente.email + '<br>' : ''}${remitente.phone ? remitente.phone : ''}
          </div>
          <div>
            <strong>Datos cliente</strong>
            ${clienteNombre}<br>
            ${clienteDir ? clienteDir + '<br>' : ''}${customer?.cuit ? 'CUIT ' + customer.cuit + '<br>' : ''}${customer?.email ? customer.email + '<br>' : ''}${customer?.phone ? customer.phone : ''}
          </div>
        </div>
        <div class="inv-table-wrap">
          <table class="inv-table">
            <thead><tr><th>Producto / Descripción</th><th>Nº Despacho</th><th>Cantidad</th><th>Base</th><th>IVA</th><th>Total</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="inv-summary">
          <div class="inv-summary-inner">
            <div class="row"><span>Base imponible</span><span>$${formatMoneyAr(netoNc)}</span></div>
            <div class="row"><span>IVA 21%</span><span>$${formatMoneyAr(ivaNc)}</span></div>
            <div class="row"><span>Retención</span><span>—</span></div>
            <div class="row total"><span>Total NC</span><span>$${formatMoneyAr(totalComprobanteNc)}</span></div>
          </div>
        </div>
        <div class="inv-footer">
          <div class="inv-cae"><strong>CAE:</strong> ${nc.cae} &nbsp;&nbsp; <strong>Vto. CAE:</strong> ${vtoCae}</div>
          <p style="font-size: 0.72rem; margin: 8px 0 0; color: #6b7280;">Consultá en afip.gob.ar con tu CUIT, fecha ${fechaNota} y Pto. Vta. ${nc.puntoVta != null ? nc.puntoVta : ''}.</p>
        </div>
      </div>
      <div class="no-print">
        <button type="button" onclick="window.print()">Imprimir / Guardar PDF</button>
        <button type="button" onclick="window.close()">Cerrar</button>
      </div>
    </body></html>`;
}
