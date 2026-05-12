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

export type ManualFacturaFields = {
  remitoNumber?: string;
  transportNumber?: string;
  saleCondition?: string;
  /** Transporte elegido para imprimir en la factura (nombre del express). */
  transporteName?: string;
  transporteAddress?: string;
  transporteId?: string;
};

function escapeHtmlText(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

  const itemsOriginal = order.items.map((i) => enrichOrderItem(i, products));
  const items = sortOrderItemsForPrint(itemsOriginal, products);

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
  const agipAlicuota = Number((inv as any).agipAlicuota ?? (inv as any).agip_alicuota ?? 0);
  const agipRetPer = Number((inv as any).agipRetPer ?? (inv as any).agip_ret_per ?? 0);

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
  const manualTransporteName = (manual?.transporteName ?? '').toString().trim();
  const manualTransporteAddress = (manual?.transporteAddress ?? '').toString().trim();
  const manualTransporteLabel = manualTransporteName
    ? (manualTransporteAddress ? `${manualTransporteName} — ${manualTransporteAddress}` : manualTransporteName)
    : '';
  const transportesCliente = (customer?.transportes ?? [])
    .map((t) => {
      const name = (t.name ?? '').toString().trim();
      const address = (t.address ?? '').toString().trim();
      if (!name) return '';
      return address ? `${name} — ${address}` : name;
    })
    .filter(Boolean);
  const transporteNombreFactura = manualTransporteLabel || (transportesCliente.length ? transportesCliente.join(', ') : '');
  // Prioridad: 1) el N° tipeado manualmente; 2) el N° de remito YA generado para este pedido
  // (`order.remitoNumber`, secuencia única desde 31457); 3) el default histórico del cliente.
  // Así, si el usuario imprimió el remito del pedido, la factura sale automáticamente vinculada
  // a ese mismo N° sin tener que copiarlo a mano.
  const manualRemitoTrim = (manual?.remitoNumber ?? '').toString().trim();
  const orderRemitoTrim = (order as any)?.remitoNumber != null ? String((order as any).remitoNumber).trim() : '';
  const customerRemitoTrim = (customer?.remitoNumber ?? '').toString().trim();
  const remitoNumber = manualRemitoTrim || orderRemitoTrim || customerRemitoTrim;
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
            ${transporteNombreFactura ? `<div><strong>Transporte:</strong> ${escapeHtmlText(transporteNombreFactura)}</div>` : ''}
            ${transportNumber ? `<div><strong>N° Transporte:</strong> ${escapeHtmlText(transportNumber)}</div>` : ''}
            ${remitoNumber ? `<div><strong>N° Remito:</strong> ${escapeHtmlText(remitoNumber)}</div>` : ''}
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
              ${(agipRetPer > 0 || agipAlicuota > 0) ? `<div class="r"><span>Percepciones IIBB (${agipAlicuota.toFixed(2)}%)</span><span>$${formatMoneyAr(agipRetPer)}</span></div>` : ''}
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

  // Mantener ambos órdenes:
  // - original: para mapear nc.itemIndex (guardado contra order.items ORDER BY id)
  // - ordenado: para visualización cuando la NC es total
  const itemsOriginal = order.items.map((i) => enrichOrderItem(i, products));
  const items = sortOrderItemsForPrint(itemsOriginal, products);

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
    const name = (i.productName ?? '').toString().trim();
    if (localSku && name) return `${localSku} — ${name}`;
    return localSku || name || '—';
  };

  const scope = nc.scope || 'total';
  const itemIdx = nc.itemIndex;
  const itemIndexesMulti = Array.isArray((nc as any).itemIndexes)
    ? ((nc as any).itemIndexes as number[]).filter((x) => Number.isInteger(x) && x >= 0)
    : [];
  const amountByItemIndex = ((nc as any).amountByItemIndex || {}) as Record<number, number>;
  const quantityByItemIndex = ((nc as any).quantityByItemIndex || {}) as Record<number, number>;
  let rows: string;
  if (scope === 'item' && itemIndexesMulti.length > 0) {
    const selectedRows = itemIndexesMulti
      .filter((idx) => typeof idx === 'number' && idx >= 0 && !!itemsOriginal[idx])
      .map((idx) => {
        const i = itemsOriginal[idx];
        const price = Number(i.priceAtMoment ?? 0);
        const netoLinea = Number(amountByItemIndex[idx] ?? 0);
        const netoSafe = netoLinea > 0 ? netoLinea : Math.round((Number(nc.amountCredited || 0) / Math.max(1, itemIndexesMulti.length)) * 100) / 100;
        const qtyNcRaw = Number(quantityByItemIndex[idx]);
        const qtyNc = Number.isFinite(qtyNcRaw) && qtyNcRaw > 0
          ? qtyNcRaw
          : (price > 0 ? Math.round((netoSafe / price) * 1000) / 1000 : Number(i.quantity || 0));
        const qtyStr = Number.isInteger(qtyNc) ? String(qtyNc) : qtyNc.toLocaleString('es-AR', { maximumFractionDigits: 3 });
        const ivaLinea = Math.round(netoSafe * 0.21 * 100) / 100;
        const totalLinea = Math.round((netoSafe + ivaLinea) * 100) / 100;
        return `<tr><td>${descOf(i)}</td><td class="col-c">${despachoOf(i)}</td><td class="col-c">${qtyStr}</td><td class="col-r">$${formatMoneyAr(netoSafe)}</td><td class="col-r">$${formatMoneyAr(ivaLinea)}</td><td class="col-r">$${formatMoneyAr(totalLinea)}</td></tr>`;
      });
    rows = selectedRows.join('');
  } else if (scope === 'item' && typeof itemIdx === 'number' && itemsOriginal[itemIdx]) {
    // itemIndex se guarda contra el orden original de order.items en backend.
    const i = itemsOriginal[itemIdx];
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
  const cuitEmpresa = (remitente.cuit || '').toString();
  const ingresosBrutosEmpresa = (remitente.ingresosBrutos || '901-2113373').toString();
  const inicioActividadEmpresa = (remitente.inicioActividad || '13/06/2005').toString();
  const razonEmpresa = (remitente.businessName || '—').toString();
  const razonEmpresaLower = razonEmpresa.toLowerCase();
  const dirEmpresa = razonEmpresaLower.includes('multimedia') || razonEmpresaLower.includes('multimedias') ? 'Murillo 630, CABA' : empresaDir || '';
  const cuitCliente = (customer?.cuit || '').toString();
  const ptoVtaNc = String(nc.puntoVta ?? '').padStart(5, '0');
  const compNroNc = String(nc.cbteDesde ?? '').padStart(8, '0');
  const cbteTipoNc = Number((nc as { cbteTipo?: number }).cbteTipo ?? (nc as { cbte_tipo?: number }).cbte_tipo ?? 0);
  const letraNc = cbteTipoNc === 3 ? 'A' : cbteTipoNc === 13 ? 'C' : 'B';
  const codigoNc = String(cbteTipoNc || 8).padStart(3, '0');
  const periodDate = new Date(order.date);
  const validPeriodDate = !isNaN(periodDate.getTime()) ? periodDate : new Date();
  const periodFrom = new Date(validPeriodDate.getFullYear(), validPeriodDate.getMonth(), 1).toLocaleDateString('es-AR');
  const periodTo = new Date(validPeriodDate.getFullYear(), validPeriodDate.getMonth() + 1, 0).toLocaleDateString('es-AR');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Nota de Crédito ${nroNota}</title><style>
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
      .fact-title { font-size: 30px; font-weight: 700; letter-spacing: 0.02em; line-height: 1; margin-top: 6px; }
      .fact-meta { margin-top: 10px; font-size: 13px; }
      .fact-meta div { margin-bottom: 4px; }
      .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .block { padding: 8px 10px; border: 1px solid #111; min-height: 58px; }
      .muted { color: #333; }
      .boxrow { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 0; margin-top: 0; }
      .boxrow .block { min-height: 46px; border-top: 0; }
      .period-row { border: 1px solid #111; border-top: 0; padding: 6px 10px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; font-weight: 700; }
      .period-row span { font-weight: 400; }
      table { width: 100%; border-collapse: collapse; margin-top: 10px; }
      thead th { border-top: 1px solid #111; border-bottom: 1px solid #111; padding: 6px 6px; text-align: left; }
      tbody td { padding: 5px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
      .col-c { text-align: center; }
      .col-r { text-align: right; }
      .summary { display: grid; grid-template-columns: 1fr 220px; justify-content: end; align-items: start; gap: 10px; margin-top: 10px; }
      .totals { border: 1px solid #111; }
      .totals .r { display: flex; justify-content: space-between; padding: 6px 8px; border-bottom: 1px solid #ddd; }
      .totals .r:last-child { border-bottom: none; font-weight: 700; }
      .footer { margin-top: 12px; font-size: 10px; }
      .bottom-block { margin-top: auto; }
      .no-print { margin-top: 14px; display: flex; gap: 10px; }
      @media print { .no-print { display: none !important; } }
    </style></head><body>
      <div class="sheet">
        <div class="original">ORIGINAL</div>
        <div class="topbar">
          <div class="head-left">
            <div class="logo">${logoBlockNc}</div>
            <div class="issuer-title">${razonEmpresa}</div>
            ${dirEmpresa ? `<div>${dirEmpresa}</div>` : ''}
            ${cuitEmpresa ? `<div>C.U.I.T.: ${cuitEmpresa}</div>` : ''}
          </div>
          <div class="head-right">
            <div class="fact-row">
              <div class="letter-box">
                <div class="l">${letraNc}</div>
                <div class="mini">COD. ${codigoNc}</div>
              </div>
              <div>
                <div class="fact-title">NOTA DE CRÉDITO</div>
                <div class="fact-meta">
                  <div><strong>Punto de Venta:</strong> ${ptoVtaNc} &nbsp;&nbsp; <strong>Comp. Nro:</strong> ${compNroNc}</div>
                  <div><strong>Fecha de Emisión:</strong> ${fechaNota}</div>
                  <div><strong>Alcance:</strong> ${scopeLabel}</div>
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
          <div>Fecha de Vto. para el pago: <span>${fechaNota}</span></div>
        </div>

        <div class="boxrow">
          <div class="block">
            <div><strong>Sr./es:</strong> ${clienteNombre}</div>
            ${clienteDir ? `<div>${clienteDir}</div>` : ''}
            ${cuitCliente ? `<div>C.U.I.T.: ${cuitCliente}</div>` : ''}
          </div>
          <div class="block">
            <div><strong>Comprobante:</strong> NC</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Producto / Descripción</th>
              <th class="col-c" style="width: 125px;">Nº DESPACHO</th>
              <th class="col-c" style="width: 70px;">CANT.</th>
              <th class="col-r" style="width: 100px;">BASE</th>
              <th class="col-r" style="width: 90px;">IVA</th>
              <th class="col-r" style="width: 92px;">TOTAL</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        <div class="bottom-block">
          <div class="summary">
            <div></div>
            <div class="totals">
              <div class="r"><span>Base imponible</span><span>$${formatMoneyAr(netoNc)}</span></div>
              <div class="r"><span>IVA 21%</span><span>$${formatMoneyAr(ivaNc)}</span></div>
              <div class="r"><span>Total NC</span><span>$${formatMoneyAr(totalComprobanteNc)}</span></div>
            </div>
          </div>
          <div class="footer">
            <div><strong>CAE:</strong> ${nc.cae} &nbsp; <strong>Vto. CAE:</strong> ${vtoCae}</div>
            <div class="muted">Consulta en afip.gob.ar con tu CUIT, fecha ${fechaNota} y Pto.Vta ${nc.puntoVta != null ? nc.puntoVta : ''}.</div>
          </div>
        </div>

        <div class="no-print">
          <button onclick="window.print()" style="padding: 10px 18px; font-size: 12px; cursor: pointer; background: #1f2937; color: white; border: none; border-radius: 6px; font-weight: 700;">Descargar PDF / Imprimir</button>
          <button onclick="window.close()" style="padding: 10px 18px; font-size: 12px; cursor: pointer; background: #9ca3af; color: white; border: none; border-radius: 6px;">Cerrar</button>
        </div>
      </div>
    </body></html>`;
}
