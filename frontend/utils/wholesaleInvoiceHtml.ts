/**
 * HTML imprimible de factura y nota de crédito para pedidos mayorista (misma vista en Pedidos y Facturación).
 * Totales: neto gravado + IVA 21% + percepción IIBB (Factura A); en Factura B el importe impreso lleva IVA incluido sin discriminar.
 */
import type { CreditNote, Customer, Order, OrderItem, Product } from '../types';
import { calcTotalesDesdeNetoGravado } from './afipComprobante';
import { formatMoneyAr } from './moneyFormat';
import { codigoTalleParaSku, nombreTalleDesdeCodigo } from './tallesTango';

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

/** Código de color Tango (tabla colors / tercer segmento del SKU). */
export function colorCodeForPrintItem(item: OrderItem, variantSku?: string): string {
  const fromItem = String(item.colorCode ?? '').trim();
  if (fromItem) return fromItem.replace(/\D/g, '') || fromItem;
  const sku = String(variantSku ?? item.sku ?? '').trim();
  const parts = sku.split('-').filter(Boolean);
  if (parts.length >= 3) {
    const c = parts[parts.length - 1].trim();
    return c.replace(/\D/g, '') || c;
  }
  return '';
}

export function enrichOrderItem(item: OrderItem, products: Product[]): OrderItem {
  const variantId = item.variantId ?? item.productId;
  const p = variantId ? products.find((x: Product) => x.id === variantId) : undefined;
  const variantSku = (p?.sku ?? item.sku ?? '').toString().trim();
  const resolvedColorCode =
    String(item.colorCode ?? '').trim() || (variantSku ? colorCodeForPrintItem(item, variantSku) : '');
  if (item.sku != null && item.productName != null) {
    return {
      ...item,
      colorCode: item.colorCode ?? (resolvedColorCode || undefined),
    };
  }
  if (!p) {
    return resolvedColorCode ? { ...item, colorCode: resolvedColorCode } : item;
  }
  return {
    ...item,
    sku: item.sku ?? p.sku,
    productName: item.productName ?? p.name,
    sizeCode: item.sizeCode ?? p.size,
    colorName: item.colorName ?? p.color,
    colorCode: item.colorCode ?? (resolvedColorCode || undefined),
  };
}

function stripLeadingZerosArticle(s: string): string {
  const digits = String(s || '').replace(/\D/g, '');
  if (!digits) return String(s || '').trim();
  return digits.replace(/^0+/, '') || '0';
}

/** Segmento artículo conservando prefijo alfabético (trifil: C04268…). */
function normalizeArticleSegmentForPrint(articleCode: string): string {
  const raw = String(articleCode || '').trim();
  if (!raw) return '';
  const letterPrefix = (raw.match(/^([A-Za-z]+)/)?.[1] ?? '').toUpperCase();
  if (letterPrefix) {
    const numeric = raw.slice(letterPrefix.length).replace(/\D/g, '');
    const stripped = numeric.replace(/^0+/, '') || (numeric ? '0' : '');
    return stripped ? letterPrefix + stripped : letterPrefix;
  }
  return stripLeadingZerosArticle(raw.replace(/\D/g, ''));
}

/** Código de artículo para agrupar / imprimir (sin color ni talle en el SKU). */
export function articleCodeForPrintGroup(skuRaw: string): string {
  const sku = String(skuRaw || '').trim();
  if (!sku) return '';
  const parts = sku.split('-').filter(Boolean);
  if (parts.length >= 3) return normalizeArticleSegmentForPrint(parts[0]);
  const digits = sku.replace(/\D/g, '');
  if (!digits) return sku;
  // Código impreso completo (ej. 4268130614130614): artículo = dígitos menos talle(3)+color(3)
  if (!sku.includes('-') && digits.length >= 11 && digits.length <= 17) {
    return stripLeadingZerosArticle(digits.slice(0, -6));
  }
  if (digits.length > 9) return stripLeadingZerosArticle(digits.slice(0, -6));
  if (digits.length >= 7) return stripLeadingZerosArticle(digits.slice(0, 7));
  return stripLeadingZerosArticle(digits);
}

function sizeKeyForGroup(sizeCode: string): string {
  const c = String(sizeCode || '').trim().toUpperCase();
  return c || '_';
}

function sizeLabelForPrintGroup(sizeCode: string): string {
  const code = String(sizeCode || '').trim();
  if (!code) return '';
  const letter = nombreTalleDesdeCodigo(code);
  return letter && letter !== code ? letter : code;
}

/** Código impreso: artículo + talle + código de color (ej. 4180501 + 140 + 111 → 4180501140111). */
export function printCodeArticleSizeColor(
  articleCode: string,
  sizeCode: string,
  colorCode: string
): string {
  const art = normalizeArticleSegmentForPrint(articleCode);
  const talle = codigoTalleParaSku(sizeCode) || String(sizeCode || '').replace(/\D/g, '');
  const color = String(colorCode || '').replace(/\D/g, '') || String(colorCode || '').trim();
  const parts = [art, talle, color].filter(Boolean);
  if (parts.length === 0) return '';
  return normalizeSkuForPrint(parts.join(''));
}

function isTrifilPrintItem(item: OrderItem, localProduct?: Product): boolean {
  const name = String(item.productName ?? localProduct?.name ?? '').toLowerCase();
  return name.includes('trifil');
}

/** Trifil: solo código de artículo (ej. C4268130614), sin concatenar talle ni color. */
function printCodeForTrifilSku(skuRaw: string): string {
  const sku = String(skuRaw || '').trim();
  if (!sku) return '';
  const parts = sku.split('-').filter(Boolean);
  if (parts.length >= 1) {
    return normalizeArticleSegmentForPrint(parts[0]);
  }
  const compact = normalizeSkuForPrint(sku);
  const m = compact.match(/^([A-Za-z]+)(\d+)$/);
  if (m) {
    const letters = m[1].toUpperCase();
    const num = m[2].replace(/^0+/, '') || m[2];
    if (num.length > 10) return letters + num.slice(0, 10);
    return letters + num;
  }
  return normalizeArticleSegmentForPrint(articleCodeForPrintGroup(sku));
}

/** @deprecated Use printCodeArticleSizeColor */
export function printCodeArticleAndSize(articleCode: string, sizeCode: string): string {
  return printCodeArticleSizeColor(articleCode, sizeCode, '');
}

/** Descripción: solo nombre del producto (talle y color van en la columna código). */
export function descriptionForPrintLine(item: OrderItem): string {
  return String(item.productName ?? '').trim() || '—';
}

/**
 * Agrupa por artículo + talle + color: una fila por color (mismo código artículo+talle).
 * Varias líneas seguidas si hay más de un color en el mismo talle.
 */
export function groupOrderItemsByArticleAndSize(
  items: OrderItem[],
  products: Product[],
  getQty: (item: OrderItem) => number = (i) => Number(i.quantity || 0)
): OrderItem[] {
  type Acc = {
    template: OrderItem;
    qty: number;
    lineNeto: number;
    despachos: Set<string>;
    articleCode: string;
    sizeCode: string;
    colorCode: string;
  };
  const map = new Map<string, Acc>();

  for (const item of items) {
    const qty = getQty(item);
    if (qty <= 0) continue;
    const variantId = item.variantId ?? item.productId;
    const localProduct = variantId ? products.find((p: Product) => p.id === variantId) : undefined;
    const variantSku = (localProduct?.sku ?? item.sku ?? '').toString().trim();
    const completePrint = tryCompletePrintCodeFromSku(variantSku);
    const { sizeCode, colorCode } = sizeAndColorCodesForPrint(item, variantSku, localProduct);
    const articleCode = articleCodeForPrintGroup(variantSku);
    const sizeKey = sizeKeyForGroup(sizeCode);
    const unit = Number(item.priceAtMoment ?? 0);
    const groupKey = completePrint
      ? `${completePrint}|${Math.round(unit * 100)}`
      : `${articleCode}|${sizeKey}|${colorCode}|${Math.round(unit * 100)}`;

    const despachoRaw =
      (item as OrderItem & { numeroDespacho?: string; numero_despacho?: string }).numeroDespacho ??
      (item as OrderItem & { numero_despacho?: string }).numero_despacho;
    const despachoStr = despachoRaw != null && String(despachoRaw).trim() ? String(despachoRaw).trim() : '';

    let acc = map.get(groupKey);
    if (!acc) {
      acc = {
        template: item,
        qty: 0,
        lineNeto: 0,
        despachos: new Set(),
        articleCode,
        sizeCode,
        colorCode,
      };
      map.set(groupKey, acc);
    }
    acc.qty += qty;
    acc.lineNeto += Math.round(qty * unit * 100) / 100;
    if (despachoStr) acc.despachos.add(despachoStr);
  }

  const grouped: OrderItem[] = [];
  for (const acc of map.values()) {
    const qty = acc.qty;
    if (qty <= 0) continue;
    const unit = Math.round((acc.lineNeto / qty) * 100) / 100;
    const baseName = String(acc.template.productName ?? '').trim();
    const variantSkuGrouped = (() => {
      const vid = acc.template.variantId ?? acc.template.productId;
      const lp = vid ? products.find((p: Product) => p.id === vid) : undefined;
      return (lp?.sku ?? acc.template.sku ?? '').toString().trim();
    })();
    const printCode = printCodeForOrderItem(
      {
        ...acc.template,
        sizeCode: acc.sizeCode,
        colorCode: acc.colorCode || acc.template.colorCode,
        sku: undefined,
      },
      products
    );
    const despachos = [...acc.despachos];
    const numeroDespacho =
      despachos.length === 0 ? undefined : despachos.length === 1 ? despachos[0] : despachos.join(', ');

    grouped.push({
      ...acc.template,
      quantity: qty,
      priceAtMoment: unit,
      productName: baseName || '—',
      sku: printCode,
      sizeCode: acc.sizeCode,
      colorCode: acc.colorCode || undefined,
      ...(numeroDespacho
        ? ({ numeroDespacho, numero_despacho: numeroDespacho } as OrderItem & {
            numeroDespacho: string;
            numero_despacho: string;
          })
        : {}),
    });
  }

  return sortOrderItemsForPrint(grouped, products);
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

/** Une el snapshot de `GET /orders/:id/invoice` al pedido antes de armar el PDF (IIBB/CAE al día). */
/** Neto según cantidades pedidas (sin usar `picked`). */
export function orderNetoFromItemsByQuantity(order: Order): number {
  if (!order.items?.length) return Number(order.total) || 0;
  let s = 0;
  for (const i of order.items) {
    const q = Number(i.quantity) || 0;
    const p = Number(i.priceAtMoment ?? 0);
    s += Math.round(q * p * 100) / 100;
  }
  return Math.round(s * 100) / 100;
}

/** Neto gravado según líneas (alineado con factura AFIP tras picking). */
export function orderNetoFromItemsForAfip(order: Order): number {
  if (!order.items?.length) return Number(order.total) || 0;
  const postPicking =
    !order.noStockImpact &&
    ['Falta controlar', 'Controlado', 'Despachado'].includes(String(order.status || ''));
  let s = 0;
  for (const i of order.items) {
    s += lineNetoForCreditNoteItem(i, order, postPicking);
  }
  return Math.round(s * 100) / 100;
}

/** Cantidad y neto por línea para NC / AFIP: usa pickeado si hay; si no, cantidad pedida (pedidos ya facturados). */
function lineNetoForCreditNoteItem(item: OrderItem, order: Order, postPicking?: boolean): number {
  const q = Number(item.quantity) || 0;
  const price = Number(item.priceAtMoment ?? 0);
  const usePicked =
    postPicking ??
    (!order.noStockImpact &&
      ['Falta controlar', 'Controlado', 'Despachado'].includes(String(order.status || '')));
  if (!usePicked) return Math.round(q * price * 100) / 100;
  const picked = Math.max(0, Number(item.picked) || 0);
  const qty = picked > 0 ? Math.min(q, picked) : q;
  return Math.round(qty * price * 100) / 100;
}

function lineQuantityForCreditNoteItem(item: OrderItem, order: Order): number {
  const q = Number(item.quantity) || 0;
  const postPicking =
    !order.noStockImpact &&
    ['Falta controlar', 'Controlado', 'Despachado'].includes(String(order.status || ''));
  if (!postPicking) return q;
  const picked = Math.max(0, Number(item.picked) || 0);
  return picked > 0 ? Math.min(q, picked) : q;
}

/**
 * Neto a creditar en NC total: alineado con lo facturado (IIBB guardado, pickeado o cantidades del pedido).
 * Evita total $0 cuando el pedido ya está facturado pero `picked` quedó en 0 en la UI.
 */
export function orderNetoForNotaCreditoTotal(order: Order): number {
  if (order.invoice) {
    const fromInvoice = orderNetoFacturadoEstimado(order);
    if (fromInvoice > 0.005) return fromInvoice;
  }
  const fromAfipLines = orderNetoFromItemsForAfip(order);
  if (fromAfipLines > 0.005) return fromAfipLines;
  const fromQty = orderNetoFromItemsByQuantity(order);
  if (fromQty > 0.005) return fromQty;
  return Math.round((Number(order.total) || 0) * 100) / 100;
}

/**
 * Neto en la tarjeta del listado de pedidos: total de todas las líneas (cantidad × precio).
 * No usa `picked`; coincide con el subtotal del armado del pedido.
 */
export function orderNetoSaldoForOrderCard(order: Order): number {
  return orderNetoFromItemsByQuantity(order);
}

export type OrderFiscalTotalsDisplay = {
  neto: number;
  iva: number;
  iibb: number;
  total: number;
  discriminaIva: boolean;
};

function ncCbteTipoFromFactura(cbteTipoFactura: number): number {
  return Number(cbteTipoFactura) === 1 ? 3 : 8;
}

/** Neto gravado estimado de la factura (IIBB guardado, picking o cantidades del pedido). */
export function orderNetoFacturadoEstimado(order: Order): number {
  if (!order.invoice) return 0;
  const inv = order.invoice;
  const retPer = Number(inv.agipRetPer ?? (inv as { agip_ret_per?: number }).agip_ret_per ?? 0);
  const alicuota = Number(inv.agipAlicuota ?? (inv as { agip_alicuota?: number }).agip_alicuota ?? 0);
  if (retPer > 0.005 && alicuota > 0.005) {
    return Math.round((retPer / (alicuota / 100)) * 100) / 100;
  }
  const netoPicked = orderNetoFromItemsForAfip(order);
  if (netoPicked > 0.005) return netoPicked;
  const netoQty = orderNetoFromItemsByQuantity(order);
  if (netoQty > 0.005) return netoQty;
  const stored = Math.round((Number(order.total) || 0) * 100) / 100;
  if (stored > 0.005) return stored;
  return 0;
}

/** Unidades a mostrar en tarjeta de pedido (ítems o estimado desde neto si se vació el detalle). */
export function orderUnitsDisplayCount(order: Order): number | null {
  const fromItems = (order.items || []).reduce((acc, i) => acc + (Number(i.quantity) || 0), 0);
  if (fromItems > 0) return fromItems;
  if (!order.invoice) return fromItems;
  const neto = orderNetoFacturadoEstimado(order);
  const prices = (order.items || []).map((i) => Number(i.priceAtMoment ?? 0)).filter((p) => p > 0);
  const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  if (neto > 0.005 && avgPrice > 0.005) return Math.round(neto / avgPrice);
  return null;
}

/** Total del comprobante facturado (neto + IVA + IIBB según datos guardados). */
export function orderTotalesFacturado(order: Order): OrderFiscalTotalsDisplay | null {
  if (!order.invoice) return null;
  const neto = orderNetoFacturadoEstimado(order);
  const cbteTipo = Number(order.invoice.cbteTipo ?? 6);
  const agipRet = Number(order.invoice.agipRetPer ?? 0);
  const t = calcTotalesDesdeNetoGravado(neto, cbteTipo, agipRet);
  return {
    neto: t.neto,
    iva: t.iva,
    iibb: t.agip,
    total: t.total,
    discriminaIva: t.discriminaIva,
  };
}

/** Total de notas de crédito del pedido (neto creditado + IVA + IIBB prorrateado). */
export function orderTotalesNotaCredito(order: Order): OrderFiscalTotalsDisplay | null {
  const ncNeto = Math.round((Number(order.creditNotesNetoCredited) || 0) * 100) / 100;
  if (!(ncNeto > 0.005) || !order.invoice) return null;
  const netoFactura = orderNetoFacturadoEstimado(order);
  const pr = iibbProratedFromInvoiceForNc(order.invoice, ncNeto, netoFactura);
  const iibb = pr?.retPer ?? 0;
  const ncCbte = ncCbteTipoFromFactura(Number(order.invoice.cbteTipo ?? 6));
  const t = calcTotalesDesdeNetoGravado(ncNeto, ncCbte, iibb);
  return {
    neto: t.neto,
    iva: t.iva,
    iibb: t.agip,
    total: t.total,
    discriminaIva: t.discriminaIva,
  };
}

/** Etiqueta corta para el bloque de NC en la tarjeta del pedido. */
export function orderCreditNoteResumenLabel(order: Order): string | null {
  const ncNeto = Number(order.creditNotesNetoCredited || 0);
  if (!(ncNeto > 0.005)) return null;
  const activeVoid = Number(
    order.creditNotesActiveTotalVoidCount ?? order.creditNotesTotalCount ?? 0
  );
  const itemCnt = Number(order.creditNotesItemCount || 0);
  const cnt = Number(order.creditNotesCount || 0);
  if (activeVoid > 0) return 'NC por el total';
  if (itemCnt > 0) return `NC parcial (${itemCnt})`;
  if (cnt > 0) return `NC (${cnt})`;
  return 'Nota de crédito';
}

/** Prorrateo de percepción IIBB de la factura (`invoices.agip_*`), igual que el backend al emitir NC. */
export function iibbProratedFromInvoiceForNc(
  inv: Order['invoice'] | undefined,
  netCredito: number,
  netoTotalPedido: number
): { retPer: number; alicuota: number } | undefined {
  if (!inv) return undefined;
  const retFull = Number((inv as { agipRetPer?: number; agip_ret_per?: number }).agipRetPer
    ?? (inv as { agip_ret_per?: number }).agip_ret_per
    ?? 0);
  if (!(retFull > 0.005)) return undefined;
  const full = Math.max(Math.round((Number(netoTotalPedido) || 0) * 100) / 100, 0.01);
  const netC = Math.round((Number(netCredito) || 0) * 100) / 100;
  const ratio = Math.min(1, Math.max(0, netC / full));
  const ret = Math.round(retFull * ratio * 100) / 100;
  if (!(ret > 0.005)) return undefined;
  const alic = Number(
    (inv as { agipAlicuota?: number; agip_alicuota?: number }).agipAlicuota
      ?? (inv as { agip_alicuota?: number }).agip_alicuota
      ?? 0
  );
  return { retPer: ret, alicuota: alic };
}

export function mergeServerInvoiceIntoOrder(order: Order, latest: Record<string, unknown> | null | undefined): Order {
  if (!order.invoice || !latest) return order;
  const inv = latest;
  const base = order.invoice;
  return {
    ...order,
    invoice: {
      ...base,
      cae: String(inv.cae ?? base.cae),
      caeFchVto: (inv.caeFchVto as string | undefined) ?? base.caeFchVto,
      puntoVta: (inv.puntoVta as number | undefined) ?? base.puntoVta,
      cbteTipo: Number(inv.cbteTipo ?? base.cbteTipo),
      cbteDesde: Number(inv.cbteDesde ?? base.cbteDesde),
      cbteHasta: Number(inv.cbteHasta ?? base.cbteHasta),
      createdAt: (inv.createdAt as string | undefined) ?? base.createdAt,
      agipAlicuota: Number(inv.agipAlicuota ?? (base as any).agipAlicuota ?? (base as any).agip_alicuota ?? 0),
      agipRetPer: Number(inv.agipRetPer ?? (base as any).agipRetPer ?? (base as any).agip_ret_per ?? 0),
    },
  };
}

function escapeHtmlText(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function despachoCellForPrint(item: OrderItem): string {
  const despacho =
    (item as OrderItem & { numero_despacho?: string }).numeroDespacho ??
    (item as OrderItem & { numero_despacho?: string }).numero_despacho ??
    null;
  if (despacho == null || !String(despacho).trim()) return '—';
  return escapeHtmlText(String(despacho).trim());
}

/** Fila de ítems igual que factura: CANT | CÓDIGO | DESCRIPCIÓN | Nº DESPACHO | P. UNITARIO | IMPORTE */
function wholesalePrintLineRowHtml(
  item: OrderItem,
  qty: number,
  products: Product[],
  factorPrecio: number,
  lineNetoOverride?: number
): string {
  const qtySafe = qty > 0 ? qty : 0;
  const qtyStr = Number.isInteger(qtySafe)
    ? qtySafe.toLocaleString('es-AR')
    : qtySafe.toLocaleString('es-AR', { maximumFractionDigits: 3 });
  const unitBase =
    lineNetoOverride != null && lineNetoOverride > 0 && qtySafe > 0
      ? lineNetoOverride / qtySafe
      : Number(item.priceAtMoment ?? 0);
  const unitPrint = Math.round(unitBase * factorPrecio * 100) / 100;
  const importe = Math.round(qtySafe * unitPrint * 100) / 100;
  const code = escapeHtmlText(printCodeForOrderItem(item, products) || '—');
  const desc = escapeHtmlText(descriptionForPrintLine(item));
  return `<tr>
        <td class="col-c">${qtyStr}</td>
        <td class="col-c col-code">${code}</td>
        <td class="col-desc">${desc}</td>
        <td class="col-c col-despacho">${despachoCellForPrint(item)}</td>
        <td class="col-r">$${formatMoneyAr(unitPrint)}</td>
        <td class="col-r">$${formatMoneyAr(importe)}</td>
      </tr>`;
}

export function normalizeSkuForPrint(raw: unknown): string {
  const s = String(raw ?? '').trim().replace(/-/g, '');
  if (!s) return '';
  const letterMatch = s.match(/^([A-Za-z]+)(.*)$/);
  if (letterMatch?.[1]) {
    const letters = letterMatch[1].toUpperCase();
    const num = (letterMatch[2] || '').replace(/\D/g, '').replace(/^0+/, '') || '';
    return num ? letters + num : letters;
  }
  const digits = s.replace(/\D/g, '');
  return digits.replace(/^0+/, '') || digits;
}

/** SKU ya impreso (solo dígitos, sin guiones): no recomponer artículo+talle+color. */
export function tryCompletePrintCodeFromSku(skuRaw: string): string | null {
  const sku = String(skuRaw ?? '').trim();
  if (!sku || sku.includes('-')) return null;
  const compact = sku.replace(/-/g, '');
  if (!/^\d+$/.test(compact)) return null;
  if (compact.length < 11 || compact.length > 17) return null;
  return compact;
}

/** Talle y color del SKU Tango `artículo-talle-color` (prioridad sobre sizeCode del pedido). */
export function talleColorFromHyphenatedSku(skuRaw: string): { talle: string; color: string } | null {
  const parts = String(skuRaw ?? '').trim().split('-').filter(Boolean);
  if (parts.length < 3) return null;
  const talle = (parts[parts.length - 2].replace(/\D/g, '') || parts[parts.length - 2]).trim();
  const color = (parts[parts.length - 1].replace(/\D/g, '') || parts[parts.length - 1]).trim();
  if (!talle || !color) return null;
  return { talle, color };
}

function sizeAndColorCodesForPrint(
  item: OrderItem,
  variantSku: string,
  localProduct: Product | undefined
): { sizeCode: string; colorCode: string } {
  const fromSku =
    talleColorFromHyphenatedSku(variantSku) ??
    talleColorFromHyphenatedSku(String(item.sku ?? '').trim());
  const sizeCode = fromSku?.talle ?? String(item.sizeCode ?? localProduct?.size ?? '').trim();
  const colorCode = fromSku?.color ?? colorCodeForPrintItem(item, variantSku);
  return { sizeCode, colorCode };
}

/** Código impreso en factura/NC: artículo+talle+color sin guiones (mismo criterio que columna CÓDIGO de la factura). */
export function printCodeForOrderItem(item: OrderItem, products: Product[]): string {
  const variantId = item.variantId ?? item.productId;
  const localProduct = variantId ? products.find((p: Product) => p.id === variantId) : undefined;
  const variantSku = (localProduct?.sku ?? item.sku ?? '').toString().trim();
  const rawItemSku = (item.sku ?? '').toString().trim();

  if (isTrifilPrintItem(item, localProduct)) {
    return printCodeForTrifilSku(variantSku || rawItemSku);
  }

  const complete =
    tryCompletePrintCodeFromSku(rawItemSku) ?? tryCompletePrintCodeFromSku(variantSku);
  if (complete) return complete;

  const { sizeCode, colorCode } = sizeAndColorCodesForPrint(item, variantSku, localProduct);
  const built = printCodeArticleSizeColor(
    articleCodeForPrintGroup(variantSku || rawItemSku),
    sizeCode,
    colorCode
  );
  if (built) return built;
  return normalizeSkuForPrint(rawItemSku || variantSku);
}

/** Cantidad por línea en PDF factura/NC (misma regla: pickeado si hay, si no cantidad pedida). */
export function qtyForWholesalePrintLine(order: Order, item: OrderItem): number {
  const q = Number(item.quantity || 0);
  const anyPicked = (order.items ?? []).some((i) => Number(i.picked) > 0);
  if (!anyPicked) return q;
  const p = Math.max(0, Math.floor(Number(item.picked) || 0));
  return Math.min(q, p);
}

/** Ítems agrupados y ordenados igual que en la factura impresa. */
export function getGroupedItemsForWholesalePrint(
  order: Order,
  products: Product[],
  getQty: (item: OrderItem) => number = (i) => qtyForWholesalePrintLine(order, i)
): OrderItem[] {
  const itemsOriginal = order.items.map((i) => enrichOrderItem(i, products));
  const itemsSorted = sortOrderItemsForPrint(itemsOriginal, products);
  return groupOrderItemsByArticleAndSize(itemsSorted, products, getQty);
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

  const items = getGroupedItemsForWholesalePrint(order, products);

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

  const lineQty = (i: OrderItem) => Number(i.quantity || 0);

  const sumLines = items.reduce((s, i) => {
    const qty = lineQty(i);
    const unit = Number(i.priceAtMoment ?? 0);
    return s + Math.round(qty * unit * 100) / 100;
  }, 0);
  /** Neto gravado: suma de líneas; si no hay ítems, fallback a orders.total (puede estar desactualizado). */
  const netoGravado =
    sumLines > 0 ? Math.round(sumLines * 100) / 100 : Math.round((Number(order.total) > 0 ? Number(order.total) : 0) * 100) / 100;
  const agipAlicuota = Number((inv as any).agipAlicuota ?? (inv as any).agip_alicuota ?? 0);
  const agipRetPer = Number((inv as any).agipRetPer ?? (inv as any).agip_ret_per ?? 0);
  const totales = calcTotalesDesdeNetoGravado(netoGravado, cbteTipoNum, agipRetPer);
  const { neto: netoImpreso, iva: iva21, total, discriminaIva, factorPrecioImpreso } = totales;
  const subtotalBruto = discriminaIva ? netoGravado : Math.round((netoGravado + totales.iva) * 100) / 100;

  const rows = items
    .map((i) => {
      const qty = lineQty(i);
      const unit = Math.round(Number(i.priceAtMoment ?? 0) * factorPrecioImpreso * 100) / 100;
      const importe = Math.round(qty * unit * 100) / 100;
      const variantId = i.variantId ?? i.productId;
      const localProduct = variantId ? products.find((p: Product) => p.id === variantId) : undefined;
      return wholesalePrintLineRowHtml(i, qty, products, factorPrecioImpreso);
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
      .col-code, .col-despacho { white-space: nowrap; }
      .col-r { text-align: right; }
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
              ${
                discriminaIva
                  ? `<div class="r"><span>Subtotal Bruto</span><span>$${formatMoneyAr(subtotalBruto)}</span></div>
              <div class="r"><span>Bonificación</span><span>$${formatMoneyAr(0)}</span></div>
              <div class="r"><span>Subtotal Neto</span><span>$${formatMoneyAr(netoImpreso)}</span></div>
              <div class="r"><span>IVA 21%</span><span>$${formatMoneyAr(iva21)}</span></div>`
                  : `<div class="r"><span>Subtotal</span><span>$${formatMoneyAr(subtotalBruto)}</span></div>
              <div class="r" style="font-size:9px;border-bottom:none;padding-top:2px;"><span class="muted">IVA incluido en el precio</span><span></span></div>`
              }
              ${(agipRetPer > 0 || agipAlicuota > 0) ? `<div class="r"><span>Percepciones IIBB (${agipAlicuota.toFixed(2)}%)</span><span>$${formatMoneyAr(agipRetPer)}</span></div>` : ''}
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
  /** Si se pasa, suma percepción IIBB al total (mismo criterio que AFIP / factura). */
  previewAgip?: { retPer: number; alicuota: number } | null;
}): string {
  const { order, nc, customer, products, remitente, previewAgip } = params;

  // Mantener ambos órdenes:
  // - original: para mapear nc.itemIndex (guardado contra order.items ORDER BY id)
  // - ordenado: para visualización cuando la NC es total
  const itemsOriginal = order.items.map((i) => enrichOrderItem(i, products));

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
  const cbteTipoNc = Number((nc as { cbteTipo?: number }).cbteTipo ?? (nc as { cbte_tipo?: number }).cbte_tipo ?? 0);
  const netoPedidoFull = orderNetoForNotaCreditoTotal(order);
  const agipResolved =
    previewAgip && Number(previewAgip.retPer) > 0.005
      ? previewAgip
      : iibbProratedFromInvoiceForNc(order.invoice, netoNc, netoPedidoFull);
  let iibbNc = 0;
  let alicuotaIibbNc = 0;
  if (agipResolved && Number(agipResolved.retPer) > 0.005) {
    iibbNc = Math.round(Number(agipResolved.retPer) * 100) / 100;
    alicuotaIibbNc = Math.round(Number(agipResolved.alicuota || 0) * 100) / 100;
  }
  const totalesNc = calcTotalesDesdeNetoGravado(netoNc, cbteTipoNc, iibbNc);
  const { iva: ivaNc, total: totalComprobanteNc, discriminaIva: discriminaIvaNc, factorPrecioImpreso: factorNc } = totalesNc;
  const iibbRowHtml =
    iibbNc > 0.005
      ? `<div class="r"><span>Percepciones IIBB${alicuotaIibbNc > 0.005 ? ` (${alicuotaIibbNc.toFixed(2)}%)` : ''}</span><span>$${formatMoneyAr(iibbNc)}</span></div>`
      : '';

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
        return wholesalePrintLineRowHtml(i, qtyNc, products, factorNc, netoSafe);
      });
    rows = selectedRows.join('');
  } else if (scope === 'item' && typeof itemIdx === 'number' && itemsOriginal[itemIdx]) {
    // itemIndex se guarda contra el orden original de order.items en backend.
    const i = itemsOriginal[itemIdx];
    const price = Number(i.priceAtMoment ?? 0);
    const qtyNc = price > 0 ? Math.round((totalNota / price) * 1000) / 1000 : i.quantity;
    rows = wholesalePrintLineRowHtml(i, qtyNc, products, factorNc, netoNc);
  } else {
    const itemsForNc = getGroupedItemsForWholesalePrint(order, products);
    rows = itemsForNc
      .map((i) => {
        const qty = Number(i.quantity || 0);
        if (qty <= 0) return '';
        return wholesalePrintLineRowHtml(i, qty, products, factorNc);
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
  const condicionIvaReceptorNc = (customer?.condicionIva || 'Consumidor Final').toString().trim();
  const transportesClienteNc = (customer?.transportes ?? [])
    .map((t) => {
      const name = (t.name ?? '').toString().trim();
      const address = (t.address ?? '').toString().trim();
      if (!name) return '';
      return address ? `${name} — ${address}` : name;
    })
    .filter(Boolean);
  const transporteNombreNc = transportesClienteNc.length ? transportesClienteNc.join(', ') : '';
  const saleConditionRawNc = (customer?.saleCondition ?? '').toString().trim().toLowerCase();
  const saleConditionNc = saleConditionRawNc.includes('60') ? '60 días' : '30 días';
  const ptoVtaNc = String(nc.puntoVta ?? '').padStart(5, '0');
  const compNroNc = String(nc.cbteDesde ?? '').padStart(8, '0');
  const letraNc = cbteTipoNc === 3 ? 'A' : cbteTipoNc === 13 ? 'C' : 'B';
  const codigoNc = String(cbteTipoNc || 8).padStart(3, '0');
  const periodDate = new Date(order.date);
  const validPeriodDate = !isNaN(periodDate.getTime()) ? periodDate : new Date();
  const periodFrom = new Date(validPeriodDate.getFullYear(), validPeriodDate.getMonth(), 1).toLocaleDateString('es-AR');
  const periodTo = new Date(validPeriodDate.getFullYear(), validPeriodDate.getMonth() + 1, 0).toLocaleDateString('es-AR');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Nota de Crédito ${nroNota}</title><!-- lupohub-print-nc-v4 --><style>
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
      .col-code, .col-despacho { white-space: nowrap; }
      .col-desc { white-space: normal; word-break: break-word; overflow-wrap: anywhere; }
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
            <div><strong>Sr./es:</strong> ${escapeHtmlText(clienteNombre)}</div>
            ${clienteDir ? `<div>${escapeHtmlText(clienteDir)}</div>` : ''}
            ${cuitCliente ? `<div>C.U.I.T.: ${escapeHtmlText(cuitCliente)}</div>` : ''}
            ${condicionIvaReceptorNc ? `<div><strong>Condición frente al IVA:</strong> ${escapeHtmlText(condicionIvaReceptorNc)}</div>` : ''}
          </div>
          <div class="block">
            ${transporteNombreNc ? `<div><strong>Transporte:</strong> ${escapeHtmlText(transporteNombreNc)}</div>` : ''}
            <div><strong>Condición de venta:</strong> ${saleConditionNc}</div>
            <div><strong>Comprobante:</strong> Nota de Crédito ${letraNc}</div>
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
          <tbody>${rows}</tbody>
        </table>

        <div class="bottom-block">
          <div class="summary">
            <div></div>
            <div class="totals">
              ${
                discriminaIvaNc
                  ? `<div class="r"><span>Base imponible</span><span>$${formatMoneyAr(netoNc)}</span></div>
              <div class="r"><span>IVA 21%</span><span>$${formatMoneyAr(ivaNc)}</span></div>`
                  : `<div class="r"><span>Subtotal</span><span>$${formatMoneyAr(Math.round((netoNc + ivaNc) * 100) / 100)}</span></div>
              <div class="r" style="font-size:9px;border-bottom:none;padding-top:2px;"><span class="muted">IVA incluido en el precio</span><span></span></div>`
              }
              ${iibbRowHtml}
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
