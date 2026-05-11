import React, { useState, useEffect } from 'react';
import { Search, ChevronRight, CheckCircle, Clock, Truck, FileText, Bot, Plus, X, Trash2, Save, PackageCheck, Lock, Filter, Package, Edit, AlertCircle, AlertTriangle, XCircle, FileSpreadsheet, Receipt, FileMinus, Archive, ArchiveRestore, Wallet, ArrowDownToLine, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Order, OrderStatus, Role, Product, Customer, OrderItem, User, OrderInvoice, Transporte, CreditNote } from '../types';
import { useNotification } from '../context/NotificationContext';
import { getRemitente } from '../services/apiIntegration';
import { api } from '../services/api';
import { formatMoneyAr } from '../utils/moneyFormat';
import {
  enrichOrderItem,
  sortOrderItemsForPrint as sortItemsForFacturaPrint,
  buildWholesaleFacturaHtml,
  buildWholesaleCreditNoteHtml,
  normalizeSkuForPrint,
  type ManualFacturaFields,
} from '../utils/wholesaleInvoiceHtml';
import { getWholesaleStockImpactMeta } from '../utils/orderStockImpact';

/** Lista para factura/remito: transportes del cliente o, si no tiene, el catálogo global. */
function transporteOptionsForCustomer(customer: Customer | undefined, allTransportes: Transporte[]): Transporte[] {
  const c = customer?.transportes;
  if (c && c.length > 0) return c;
  return allTransportes;
}

function pickInitialTransporteId(prev: ManualFacturaFields | undefined, opts: Transporte[]): string {
  if (!opts.length) return '';
  if (prev?.transporteId && opts.some((o) => o.id === prev.transporteId)) return prev.transporteId;
  if (prev?.transporteName) {
    const byName = opts.find((o) => o.name === prev.transporteName);
    if (byName) return byName.id;
  }
  if (opts.length === 1) return opts[0].id;
  return '';
}

function orderRoleLabelEs(role: string | undefined): string {
  if (!role) return '';
  const m: Record<string, string> = {
    ADMIN: 'Admin',
    SELLER: 'Vendedor',
    WAREHOUSE: 'Depósito',
    DEPOSITO: 'Depósito',
    CUSTOMER: 'Cliente',
  };
  return m[role] || role;
}

interface OrdersProps {
  orders: Order[];
  products: Product[];
  customers: Customer[];
  transportes?: Transporte[];
  users: User[];
  role: Role;
  currentUserId?: string;
  onUpdateStatus: (orderId: string, status: OrderStatus) => void;
  onCreateOrder: (order: Order) => void;
  onNavigate: (view: string) => void;
  onStartPicking?: (order: Order) => void;
  onEditOrder?: (order: Order) => void;
  onDeleteOrder?: (orderId: string) => void;
  onFacturaEmitida?: (orderId: string, invoice: OrderInvoice) => void;
  onCreditNoteEmitida?: (orderId: string) => void;
  orderArchivedFilter?: 'no' | 'yes' | 'only';
  setOrderArchivedFilter?: (v: 'no' | 'yes' | 'only') => void;
  refreshOrders?: () => void;
}

const CONDICIONES_VENTA_FACTURA = ['30 días', '60 días'] as const;
const FACTURA_MANUAL_DATA_KEY = 'lupo_factura_manual_data_by_order';

/** Mismo criterio que AFIP: base imponible neto; IVA 21% sobre neto. */
function afipDesdeNeto(neto: number) {
  const n = Number(neto) || 0;
  const iva = Math.round(n * 0.21 * 100) / 100;
  const impTotal = Math.round((n + iva) * 100) / 100;
  return { neto: n, iva, impTotal };
}

/** Neto gravado según líneas (cantidad × precio); coincide con subtotal de factura por ítems. `orders.total` puede estar desfasado. */
function orderNetoFromItems(order: Order): number {
  if (!order.items?.length) return Number(order.total) || 0;
  let s = 0;
  for (const i of order.items) {
    const qty = Number(i.quantity) || 0;
    const p = Number(i.priceAtMoment ?? 0);
    s += Math.round(qty * p * 100) / 100;
  }
  return Math.round(s * 100) / 100;
}

const Orders: React.FC<OrdersProps> = React.memo(({ 
  orders, products, customers, transportes = [], users, role, 
  currentUserId, onUpdateStatus, onCreateOrder, 
  onNavigate, onStartPicking, onEditOrder, onDeleteOrder, onFacturaEmitida, onCreditNoteEmitida,
  orderArchivedFilter = 'no', setOrderArchivedFilter, refreshOrders
}) => {
  const { showConfirm, showToast } = useNotification();
  const [filterStatus, setFilterStatus] = useState<OrderStatus | 'ALL'>('ALL');
  const [filterCustomer, setFilterCustomer] = useState<string>('ALL');
  const [remitoOrder, setRemitoOrder] = useState<Order | null>(null);
  const [remitoTransporteName, setRemitoTransporteName] = useState<string>('');
  const [remitoBultos, setRemitoBultos] = useState<string>('');
  const [remitoDescripcion, setRemitoDescripcion] = useState<string>('');
  /** N° de remito impreso (manual); obligatorio al generar el PDF. */
  const [remitoDocumentNumber, setRemitoDocumentNumber] = useState<string>('');
  const [afipConfigured, setAfipConfigured] = useState(false);
  const [afipProduction, setAfipProduction] = useState(true);
  const [issuerFromApi, setIssuerFromApi] = useState<{ cuit: string; businessName: string; address: string; city: string } | null>(null);
  const [emitiendoFacturaId, setEmitiendoFacturaId] = useState<string | null>(null);
  const [applyingMayoristaStockId, setApplyingMayoristaStockId] = useState<string | null>(null);
  const [showEmitirFacturaModal, setShowEmitirFacturaModal] = useState(false);
  const [orderToEmitFactura, setOrderToEmitFactura] = useState<Order | null>(null);
  const [emitirFacturaTipo, setEmitirFacturaTipo] = useState<'auto' | 'A' | 'B'>('auto');
  const [emitirFacturaSaleCondition, setEmitirFacturaSaleCondition] = useState<'30 días' | '60 días'>('30 días');
  const [ncOrder, setNcOrder] = useState<Order | null>(null);
  const [orderCreditNotes, setOrderCreditNotes] = useState<CreditNote[]>([]);
  const [ncTipo, setNcTipo] = useState<'total' | 'item' | 'items'>('total');
  const [ncItemIndex, setNcItemIndex] = useState(0);
  const [ncQuantity, setNcQuantity] = useState<number>(1);
  const [ncItemsQuantities, setNcItemsQuantities] = useState<Record<number, number>>({});
  const [emitiendoNC, setEmitiendoNC] = useState(false);
  const [archivingOrderId, setArchivingOrderId] = useState<string | null>(null);
  const [verificandoAfipOrderId, setVerificandoAfipOrderId] = useState<string | null>(null);
  const [manualFacturaDataByOrder, setManualFacturaDataByOrder] = useState<Record<string, ManualFacturaFields>>(() => {
    try {
      const raw = localStorage.getItem(FACTURA_MANUAL_DATA_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [facturaPreviewOrder, setFacturaPreviewOrder] = useState<Order | null>(null);
  const [facturaTransportNumber, setFacturaTransportNumber] = useState('');
  const [facturaRemitoNumber, setFacturaRemitoNumber] = useState('');
  const [facturaSaleCondition, setFacturaSaleCondition] = useState<'30 días' | '60 días'>('30 días');
  /** '' = imprimir todos los transportes asignados al cliente (si hay más de uno). */
  const [facturaTransporteId, setFacturaTransporteId] = useState('');
  const [emitirFacturaTransporteId, setEmitirFacturaTransporteId] = useState('');

  useEffect(() => {
    if (!ncOrder) {
      setOrderCreditNotes([]);
      return;
    }
    api.getOrderCreditNotes(ncOrder.id).then((notes) => {
      setOrderCreditNotes(notes);
      if (notes.some((n) => (n.scope || 'total') === 'total')) setNcTipo('items');
    }).catch(() => setOrderCreditNotes([]));
  }, [ncOrder?.id]);

  useEffect(() => {
    if (!ncOrder || ncTipo !== 'item' || !ncOrder.items[ncItemIndex]) return;
    const creditedByItem: Record<number, number> = {};
    orderCreditNotes.filter((n) => n.scope === 'item' && typeof n.itemIndex === 'number').forEach((n) => {
      creditedByItem[n.itemIndex!] = (creditedByItem[n.itemIndex!] || 0) + n.amountCredited;
    });
    const item = ncOrder.items[ncItemIndex];
    const price = Number(item?.priceAtMoment ?? 0);
    const qty = item?.quantity ?? 0;
    const lineTotal = qty * price;
    const credited = creditedByItem[ncItemIndex] ?? 0;
    const remaining = Math.round((lineTotal - credited) * 100) / 100;
    const maxQ = remaining <= 0 ? 0 : Math.min(qty, Math.floor(remaining / price + 0.001));
    if (ncQuantity > maxQ) setNcQuantity(maxQ);
  }, [orderCreditNotes, ncOrder, ncItemIndex, ncTipo]);

  const canEmitirFactura = role === Role.ADMIN || role === Role.WAREHOUSE || role === Role.DEPOSITO;
  useEffect(() => {
    if (!canEmitirFactura) return;
    api.getAfipStatus().then(r => {
      setAfipConfigured(r?.configured ?? false);
      setAfipProduction(r?.production ?? true);
    }).catch(() => { setAfipConfigured(false); setAfipProduction(true); });
    api.getAfipIssuer().then(setIssuerFromApi).catch(() => setIssuerFromApi(null));
  }, [canEmitirFactura]);

  useEffect(() => {
    try {
      localStorage.setItem(FACTURA_MANUAL_DATA_KEY, JSON.stringify(manualFacturaDataByOrder));
    } catch {
      // ignore localStorage failures
    }
  }, [manualFacturaDataByOrder]);

  const getStatusColor = (status: OrderStatus) => {
    switch(status) {
      case OrderStatus.DRAFT: return 'bg-slate-700/50 text-slate-300 border border-slate-600';
      case OrderStatus.PENDING_ADMIN_CONFIRMATION: return 'bg-violet-900/30 text-violet-300 border border-violet-800';
      case OrderStatus.CONFIRMED: return 'bg-blue-900/30 text-blue-300 border border-blue-800';
      case OrderStatus.PREPARING: return 'bg-yellow-900/30 text-yellow-300 border border-yellow-800';
      case OrderStatus.PENDING_CONTROL: return 'bg-amber-900/30 text-amber-300 border border-amber-800';
      case OrderStatus.CONTROLLED: return 'bg-emerald-900/30 text-emerald-300 border border-emerald-800';
      case OrderStatus.DISPATCHED: return 'bg-green-900/30 text-green-300 border border-green-800';
      case OrderStatus.CANCELLED: return 'bg-red-900/30 text-red-300 border border-red-800';
      case 'Preparación': return 'bg-yellow-900/30 text-yellow-300 border border-yellow-800'; // compat antiguo
      default: return 'bg-slate-700/50 text-slate-400 border border-slate-600';
    }
  };

  const filteredOrders = orders.filter(o =>
    (filterStatus === 'ALL' || o.status === filterStatus) &&
    (filterCustomer === 'ALL' || o.customerId === filterCustomer)
  );

  const statusesCancelables = [OrderStatus.PENDING_ADMIN_CONFIRMATION, OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.PENDING_CONTROL, OrderStatus.CONTROLLED];
  const canCancelOrder = (order: Order) =>
    !order.invoice &&
    (statusesCancelables.includes(order.status) || order.status === 'Preparación') &&
    (role === Role.ADMIN || role === Role.SELLER || role === Role.CUSTOMER || role === Role.WAREHOUSE || role === Role.DEPOSITO);

  /** Siguiente estado posible para el flujo Depósito (Preparando → Falta controlar → Controlado → Despachado). */
  const getNextStatusForOrder = (order: Order): OrderStatus | null => {
    const s = order.status;
    if (s === OrderStatus.CONFIRMED) return OrderStatus.PREPARING;
    if (s === OrderStatus.PREPARING || s === 'Preparación') return OrderStatus.PENDING_CONTROL;
    if (s === OrderStatus.PENDING_CONTROL) return OrderStatus.CONTROLLED;
    if (s === OrderStatus.CONTROLLED) return OrderStatus.DISPATCHED;
    return null;
  };

  const canEditOrderBase = role === Role.ADMIN || role === Role.SELLER || role === Role.CUSTOMER;

  /** Tipo de factura que se emitirá según condición IVA del cliente (misma regla que el backend). */
  const getTipoFacturaParaCliente = (order: Order): 'A' | 'B' => {
    const customer = customers.find(c => c.id === order.customerId);
    const condicion = (customer?.condicionIva ?? '').toLowerCase();
    const esRI = condicion.includes('responsable inscripto') && !condicion.includes('no inscripto');
    const tieneCuit = customer?.cuit && String(customer.cuit).replace(/\D/g, '').length >= 10;
    return tieneCuit && esRI ? 'A' : 'B';
  };

  const getCustomerName = (orderOrCustomerId: Order | string) => {
    if (typeof orderOrCustomerId === 'object' && orderOrCustomerId?.customerBusinessName) return orderOrCustomerId.customerBusinessName;
    const id = typeof orderOrCustomerId === 'string' ? orderOrCustomerId : (orderOrCustomerId as Order).customerId;
    return customers.find(c => c.id === id)?.businessName || customers.find(c => c.id === id)?.name || id;
  };

  /** Fecha legible en la lista de pedidos (DD/MM/YYYY). */
  const formatOrderDate = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  /** Nombre seguro para hoja Excel (máx 31 caracteres, sin caracteres inválidos). */
  const safeSheetName = (order: Order) => {
    const base = `#${order.id}`.replace(/[\\/*?:\[\]]/g, '');
    const name = getCustomerName(order).replace(/[\\/*?:\[\]]/g, '').slice(0, 12);
    const sheetName = `${base} ${name}`.trim().slice(0, 31);
    return sheetName || `Pedido_${order.id.slice(-8)}`;
  };

  const enrichItem = (item: OrderItem): OrderItem => enrichOrderItem(item, products);

  /** Abre el modal para elegir transporte, bultos y descripción (para expreso al interior) y luego genera el remito. */
  const openRemitoModal = (order: Order, e: React.MouseEvent) => {
    e.stopPropagation();
    const customer = customers.find(c => c.id === order.customerId);
    const firstTransport = customer?.transportes?.[0]?.name ?? '';
    setRemitoOrder(order);
    setRemitoTransporteName(firstTransport);
    setRemitoBultos('');
    setRemitoDescripcion('');
    setRemitoDocumentNumber((customer?.remitoNumber ?? '').toString().trim());
  };

  /** Genera el HTML del remito con formato de factura y multipágina. `remitoDocumentNumber` es el N° que va arriba a la derecha. */
  const buildRemitoHtml = (
    order: Order,
    transporteName: string,
    remitoDocumentNumber: string,
    bultos?: number | string | null,
    descripcion?: string | null
  ) => {
    const customer = customers.find(c => c.id === order.customerId);
    const localRemitente = getRemitente();
    const remitente = (issuerFromApi && (issuerFromApi.businessName || issuerFromApi.cuit))
      ? { ...localRemitente, ...issuerFromApi, logoUrl: localRemitente.logoUrl, email: localRemitente.email, phone: localRemitente.phone }
      : localRemitente;
    const items = sortItemsForFacturaPrint(order.items.map(enrichItem), products);
    const formatDateShort = (d: string) => {
      const x = new Date(d);
      if (isNaN(x.getTime())) return d;
      const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
      const day = x.getDate();
      const month = meses[x.getMonth()];
      const year = x.getFullYear();
      return `${String(day).padStart(2,'0')} ${month} ${year}`;
    };
    const selectedTransport = customer?.transportes?.find(t => t.name === transporteName) ?? transportes.find(t => t.name === transporteName);
    const transportNumber = transporteName.trim()
      ? (selectedTransport?.address ? `${transporteName} — ${selectedTransport.address}` : transporteName)
      : (customer?.transportNumber || '').toString().trim();
    const remitoBaseNumber = (remitoDocumentNumber || '').toString().trim();
    const saleCondition = (customer?.saleCondition || 'Cuenta Corriente').toString().trim();
    const numBultos = bultos !== undefined && bultos !== null && bultos !== '' ? (typeof bultos === 'number' ? bultos : parseInt(String(bultos), 10)) : null;
    const descripcionTrim = descripcion && String(descripcion).trim() ? String(descripcion).trim().replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';

    const localSkuOf = (i: OrderItem) => {
      const variantId = i.variantId ?? i.productId;
      const localProduct = variantId ? products.find((p: Product) => p.id === variantId) : undefined;
      return (localProduct?.sku ?? i.sku ?? '').toString().trim();
    };

    const rowsFor = (slice: OrderItem[]) => slice.map(i => {
      const qty = Number(i.quantity || 0);
      const unit = Number(i.priceAtMoment ?? 0);
      const importe = Math.round(qty * unit * 100) / 100;
      const sku = localSkuOf(i);
      const desc = (i.productName ?? '').toString().trim() || '—';
      const despacho = (i as any).numeroDespacho ?? (i as any).numero_despacho ?? null;
      const despachoCell = despacho != null && String(despacho).trim() ? String(despacho).trim() : '—';
      const codePrint = normalizeSkuForPrint(sku);
      return `<tr>
        <td class="col-c">${qty.toLocaleString('es-AR')}</td>
        <td class="col-c col-code">${codePrint || '—'}</td>
        <td class="col-desc">${desc}</td>
        <td class="col-c">${despachoCell}</td>
        <td class="col-r">$${formatMoneyAr(unit)}</td>
        <td class="col-r">$${formatMoneyAr(importe)}</td>
      </tr>`;
    }).join('');

    const itemsPerPage = 18;
    const pages: OrderItem[][] = [];
    for (let i = 0; i < items.length; i += itemsPerPage) pages.push(items.slice(i, i + itemsPerPage));
    if (pages.length === 0) pages.push([]);

    const netFromLines = orderNetoFromItems(order);
    const neto =
      netFromLines > 0
        ? netFromLines
        : Math.round(
            (order.total != null && order.total > 0 ? order.total : items.reduce((s, i) => s + i.quantity * (i.priceAtMoment ?? 0), 0)) * 100
          ) / 100;
    const iva21 = Math.round(neto * 0.21 * 100) / 100;
    const total = Math.round((neto + iva21) * 100) / 100;
    const subtotalBruto = neto;

    const empresaDir = [remitente.address, remitente.city].filter(Boolean).join(', ') || '';
    const clienteNombre = order.customerBusinessName || customer?.businessName || customer?.name || 'Cliente';
    const clienteDir = [customer?.address, customer?.city].filter(Boolean).join(', ') || '';
    const razonEmpresa = (remitente.businessName || '—').toString();
    const cuitEmpresa = ((remitente as any).cuit || '').toString();
    const ingresosBrutosEmpresa = ((remitente as any).ingresosBrutos || '901-2113373').toString();
    const inicioActividadEmpresa = ((remitente as any).inicioActividad || '13/06/2005').toString();
    const emailEmpresa = ((remitente as any).email || '').toString();
    const telEmpresa = ((remitente as any).phone || '').toString();
    const cuitCliente = (customer?.cuit || '').toString();

    const caiRemitoTrim = remitente.caiRemito?.trim();
    const caiVencimientoStr = remitente.caiRemitoVencimiento
      ? (() => { const d = new Date(remitente.caiRemitoVencimiento! + 'T12:00:00'); return isNaN(d.getTime()) ? remitente.caiRemitoVencimiento : formatDateShort(remitente.caiRemitoVencimiento); })()
      : '';
    const caiFooterHtml = caiRemitoTrim
      ? `<div><strong>C.A.I.:</strong> ${caiRemitoTrim}${caiVencimientoStr ? ` &nbsp; <strong>Vto. C.A.I.:</strong> ${caiVencimientoStr}` : ''}</div>`
      : '';

    const logoUrlRemito = (remitente.logoUrl && remitente.logoUrl.trim()) ? remitente.logoUrl.trim() : '';
    const logoPlaceholder = (remitente.businessName || 'Empresa').replace(/</g, '&lt;');
    const logoBlockRemito = logoUrlRemito
      ? `<div style="display:flex;align-items:center;gap:8px;">
           <img src="${logoUrlRemito}" alt="Logo" class="inv-logo" referrerpolicy="no-referrer" style="max-height:56px;max-width:220px;width:auto;height:auto;object-fit:contain;display:block;" />
         </div>`
      : `<span class="inv-logo-placeholder">${logoPlaceholder}</span>`;

    const pagesHtml = pages.map((pageItems, idx) => {
      const remitoNumber = pages.length > 1
        ? `${remitoBaseNumber}-${String(idx + 1).padStart(2, '0')}`
        : remitoBaseNumber;
      const isLast = idx === pages.length - 1;
      const pageRows = rowsFor(pageItems);

      return `<section class="sheet ${idx > 0 ? 'page-break' : ''}">
        <div class="original">ORIGINAL</div>
        <div class="topbar">
          <div class="head-left">
            <div class="logo">${logoBlockRemito}</div>
            <div class="issuer-title">${razonEmpresa}</div>
            ${empresaDir ? `<div>${empresaDir}</div>` : ''}
            ${cuitEmpresa ? `<div>C.U.I.T.: ${cuitEmpresa}</div>` : ''}
            ${ingresosBrutosEmpresa ? `<div><strong>Ingresos Brutos:</strong> ${ingresosBrutosEmpresa}</div>` : ''}
            ${inicioActividadEmpresa ? `<div><strong>Inicio de actividad:</strong> ${inicioActividadEmpresa}</div>` : ''}
            ${emailEmpresa ? `<div><strong>E-mail:</strong> ${emailEmpresa}</div>` : ''}
            ${telEmpresa ? `<div><strong>Tel:</strong> ${telEmpresa}</div>` : ''}
          </div>
          <div class="head-right">
            <div class="fact-row">
              <div class="letter-box">
                <div class="l">R</div>
                <div class="mini">REMITO</div>
              </div>
              <div>
                <div class="fact-title remito-title">REMITO</div>
                <div class="fact-meta">
                  <div><strong>N° Remito:</strong> ${remitoNumber || '—'}</div>
                  <div><strong>Fecha:</strong> ${formatDateShort(order.date)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="boxrow">
          <div class="block">
            <div><strong>Sr./es:</strong> ${clienteNombre}</div>
            ${clienteDir ? `<div>${clienteDir}</div>` : ''}
            ${cuitCliente ? `<div>C.U.I.T.: ${cuitCliente}</div>` : ''}
          </div>
          <div class="block">
            ${transportNumber ? `<div><strong>N° Transporte:</strong> ${transportNumber}</div>` : ''}
            <div><strong>N° Remito:</strong> ${remitoNumber || '—'}</div>
            ${saleCondition ? `<div><strong>Condición de venta:</strong> ${saleCondition}</div>` : ''}
            ${(numBultos != null && !isNaN(numBultos)) ? `<div><strong>Bultos:</strong> ${numBultos}</div>` : ''}
          </div>
        </div>
        ${descripcionTrim ? `<div class="desc-box"><strong>Descripción del envío:</strong> ${descripcionTrim}</div>` : ''}
        <table class="items-table">
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
          <tbody>${pageRows}</tbody>
        </table>
        ${isLast ? `<div class="summary">
          <div></div>
          <div class="totals">
            <div class="r"><span>Subtotal Bruto</span><span>$${formatMoneyAr(subtotalBruto)}</span></div>
            <div class="r"><span>Bonificación</span><span>$${formatMoneyAr(0)}</span></div>
            <div class="r"><span>Subtotal Neto</span><span>$${formatMoneyAr(neto)}</span></div>
            <div class="r"><span>IVA 21%</span><span>$${formatMoneyAr(iva21)}</span></div>
            <div class="r"><span>Total</span><span>$${formatMoneyAr(total)}</span></div>
          </div>
        </div>` : ''}
        ${caiFooterHtml ? `<div class="footer">${caiFooterHtml}</div>` : ''}
      </section>`;
    }).join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Remito ${order.id}</title><style>
      @page { size: A4; margin: 12mm 12mm 14mm 12mm; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 0; color: #111; background: #fff; font-family: Arial, Helvetica, sans-serif; font-size: 11px; }
      .sheet { width: 210mm; min-height: 297mm; padding: 10mm; margin: 0 auto; display: flex; flex-direction: column; }
      .page-break { page-break-before: always; }
      .original { border: 1px solid #111; text-align: center; font-weight: 700; letter-spacing: 0.05em; padding: 6px 0; margin-bottom: 0; }
      .topbar { display: grid; grid-template-columns: 1fr 1.2fr; gap: 0; align-items: stretch; margin-bottom: 0; border: 1px solid #111; border-top: 0; }
      .head-left { border-right: 1px solid #111; padding: 10px 10px 8px; }
      .head-right { padding: 8px 10px; display: flex; align-items: center; justify-content: flex-end; }
      .logo { min-height: 42px; display: flex; align-items: center; margin-bottom: 4px; }
      .logo img { max-height: 48px; max-width: 200px; object-fit: contain; }
      .issuer-title { font-size: 12px; font-weight: 700; margin: 2px 0 6px; }
      .head-left > div { margin-bottom: 3px; line-height: 1.35; }
      .fact-row { display: grid; grid-template-columns: 72px 1fr; align-items: stretch; gap: 10px; width: 100%; max-width: 320px; }
      .letter-box { border: 1px solid #111; text-align: center; display: flex; flex-direction: column; justify-content: center; min-height: 74px; }
      .letter-box .l { font-size: 40px; line-height: 1; font-weight: 700; }
      .letter-box .mini { font-size: 9px; font-weight: 700; letter-spacing: 0.06em; margin-top: 4px; }
      .fact-title { font-size: 32px; font-weight: 700; letter-spacing: 0.02em; line-height: 1; margin-top: 2px; }
      .remito-title { font-size: 28px; }
      .fact-meta { margin-top: 10px; font-size: 12px; }
      .fact-meta div { margin-bottom: 4px; }
      .boxrow { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 0; margin-top: 0; border: 1px solid #111; border-top: 0; }
      .block { padding: 8px 10px; border-right: 1px solid #111; min-height: 58px; }
      .boxrow .block:last-child { border-right: none; }
      .block > div { margin-bottom: 4px; line-height: 1.35; }
      .desc-box { border: 1px solid #111; border-top: 0; padding: 8px 10px; white-space: pre-line; line-height: 1.4; }
      table.items-table { width: 100%; border-collapse: collapse; margin-top: 0; border: 1px solid #111; border-top: 0; }
      table.items-table thead th { border: 1px solid #111; padding: 6px 6px; text-align: left; background: #f3f4f6; font-weight: 700; font-size: 10px; }
      table.items-table tbody td { border: 1px solid #111; padding: 5px 6px; vertical-align: top; }
      .col-c { text-align: center; }
      .col-r { text-align: right; }
      .col-code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10px; }
      .col-desc { white-space: normal; word-break: break-word; overflow-wrap: anywhere; }
      .summary { display: grid; grid-template-columns: 1fr 220px; gap: 10px; margin-top: 10px; align-items: start; }
      .totals { border: 1px solid #111; }
      .totals .r { display: flex; justify-content: space-between; padding: 6px 8px; border-bottom: 1px solid #ddd; gap: 12px; }
      .totals .r:last-child { border-bottom: none; font-weight: 700; }
      .footer { margin-top: 12px; font-size: 10px; }
      .no-print { margin: 14px auto 18px; width: 210mm; padding: 0 10mm; display: flex; gap: 10px; }
      @media print { .no-print { display: none !important; } .sheet { margin: 0 auto; } }
    </style></head><body>
      ${pagesHtml}
      <div class="no-print">
        <button onclick="window.print()" style="padding: 10px 18px; font-size: 12px; cursor: pointer; background: #1f2937; color: white; border: none; border-radius: 6px; font-weight: 700;">Descargar PDF / Imprimir</button>
        <button onclick="window.close()" style="padding: 10px 18px; font-size: 12px; cursor: pointer; background: #9ca3af; color: white; border: none; border-radius: 6px;">Cerrar</button>
      </div>
    </body></html>`;
  };

  const confirmRemito = () => {
    if (!remitoOrder) return;
    const docNro = remitoDocumentNumber.trim();
    if (!docNro) {
      showToast('error', 'Ingresá el número de remito (aparece arriba a la derecha en el PDF).');
      return;
    }
    const bultosVal = remitoBultos.trim() ? remitoBultos : null;
    const html = buildRemitoHtml(remitoOrder, remitoTransporteName, docNro, bultosVal, remitoDescripcion.trim() || null);
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
    }
    setRemitoOrder(null);
    setRemitoTransporteName('');
    setRemitoBultos('');
    setRemitoDescripcion('');
    setRemitoDocumentNumber('');
  };

  const mergedRemitenteForFactura = () => {
    const localRemitente = getRemitente();
    return (issuerFromApi && (issuerFromApi.businessName || issuerFromApi.cuit))
      ? { ...localRemitente, ...issuerFromApi, logoUrl: localRemitente.logoUrl, email: localRemitente.email, phone: localRemitente.phone }
      : localRemitente;
  };

  const buildFacturaHtml = (order: Order, manual?: ManualFacturaFields) => {
    const customer = customers.find((c) => c.id === order.customerId);
    return buildWholesaleFacturaHtml({
      order,
      customer,
      products,
      remitente: mergedRemitenteForFactura() as any,
      manual,
    });
  };

  const injectPreviewBanner = (html: string) => {
    if (!html) return html;
    return html.replace(
      '<body>',
      '<body><div style="position:sticky;top:0;z-index:9999;background:#7f1d1d;color:#fff;padding:10px 14px;font:700 12px Arial,Helvetica,sans-serif;letter-spacing:.03em;text-transform:uppercase;text-align:center;">Vista previa sin validez fiscal - aun no emitida en AFIP</div>'
    );
  };

  const getCbteTipoFromEmitSelection = (order: Order): 1 | 6 => {
    if (emitirFacturaTipo === 'A') return 1;
    if (emitirFacturaTipo === 'B') return 6;
    return getTipoFacturaParaCliente(order) === 'A' ? 1 : 6;
  };

  const openFacturaPreviewBeforeEmit = () => {
    if (!orderToEmitFactura) return;
    const cbteTipo = getCbteTipoFromEmitSelection(orderToEmitFactura);
    const custEmit = customers.find((c) => c.id === orderToEmitFactura.customerId);
    const netPreview = orderNetoFromItems(orderToEmitFactura);
    const agipAlicuotaPreview = (custEmit?.shouldRetainIibb && Number(custEmit?.iibbAlicuota || 0) > 0)
      ? Number(custEmit?.iibbAlicuota || 0)
      : 0;
    const agipRetPerPreview = Math.round(netPreview * (agipAlicuotaPreview / 100) * 100) / 100;
    const optsEmit = transporteOptionsForCustomer(custEmit, transportes);
    const manual: ManualFacturaFields = {
      ...(manualFacturaDataByOrder[orderToEmitFactura.id] || {}),
      saleCondition: emitirFacturaSaleCondition,
    };
    if (emitirFacturaTransporteId) {
      const t = optsEmit.find((o) => o.id === emitirFacturaTransporteId);
      if (t) {
        manual.transporteId = t.id;
        manual.transporteName = t.name;
        manual.transporteAddress = t.address;
      }
    } else {
      delete manual.transporteId;
      delete manual.transporteName;
      delete manual.transporteAddress;
    }
    setManualFacturaDataByOrder((prev) => ({
      ...prev,
      [orderToEmitFactura.id]: manual
    }));

    const previewOrder: Order = {
      ...orderToEmitFactura,
      invoice: {
        cae: '',
        caeFchVto: '',
        puntoVta: 0,
        cbteTipo,
        cbteDesde: 0,
        cbteHasta: 0,
        createdAt: orderToEmitFactura.date,
        agipAlicuota: agipAlicuotaPreview,
        agipRetPer: agipRetPerPreview,
      } as any
    };
    const html = injectPreviewBanner(buildFacturaHtml(previewOrder, manual));
    if (!html) {
      showToast('error', 'No se pudo generar la vista previa');
      return;
    }
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  };

  const buildCreditNoteHtml = (order: Order, nc: CreditNote) => {
    const customer = customers.find((c) => c.id === order.customerId);
    return buildWholesaleCreditNoteHtml({
      order,
      nc,
      customer,
      products,
      remitente: mergedRemitenteForFactura() as any,
    });
  };

  const openFactura = (order: Order, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!order.invoice) return;
    const customer = customers.find(c => c.id === order.customerId);
    const prev = manualFacturaDataByOrder[order.id];
    const initialSaleCondition: '30 días' | '60 días' =
      String(prev?.saleCondition ?? customer?.saleCondition ?? '').toLowerCase().includes('60') ? '60 días' : '30 días';
    const manual = prev ?? {
      transportNumber: (customer?.transportNumber ?? '').toString().trim(),
      remitoNumber: (customer?.remitoNumber ?? '').toString().trim(),
      saleCondition: initialSaleCondition,
    };
    const transporteOpts = transporteOptionsForCustomer(customer, transportes);
    setFacturaPreviewOrder(order);
    setFacturaTransportNumber((manual.transportNumber ?? '').toString());
    setFacturaRemitoNumber((manual.remitoNumber ?? '').toString());
    setFacturaSaleCondition(String(manual.saleCondition ?? '').toLowerCase().includes('60') ? '60 días' : '30 días');
    setFacturaTransporteId(pickInitialTransporteId(prev, transporteOpts));
  };

  const confirmOpenFactura = () => {
    if (!facturaPreviewOrder) return;
    const cust = customers.find((c) => c.id === facturaPreviewOrder.customerId);
    const transporteOpts = transporteOptionsForCustomer(cust, transportes);
    const manual: ManualFacturaFields = {
      transportNumber: facturaTransportNumber.trim(),
      remitoNumber: facturaRemitoNumber.trim(),
      saleCondition: facturaSaleCondition.trim() || '30 días',
    };
    if (facturaTransporteId) {
      const t = transporteOpts.find((o) => o.id === facturaTransporteId);
      if (t) {
        manual.transporteId = t.id;
        manual.transporteName = t.name;
        manual.transporteAddress = t.address;
      }
    }
    setManualFacturaDataByOrder(prevMap => ({ ...prevMap, [facturaPreviewOrder.id]: manual }));
    const html = buildFacturaHtml(facturaPreviewOrder, manual);
    if (html) {
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(html);
        w.document.close();
      }
    }
    setFacturaPreviewOrder(null);
  };

  const openNotaCredito = async (order: Order, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const notes = await api.getOrderCreditNotes(order.id);
      if (!notes || notes.length === 0) {
        showToast('info', 'No hay notas de crédito para este pedido');
        return;
      }
      const byVoucher = new Map<string, CreditNote[]>();
      for (const n of notes) {
        const k = `${n.puntoVta}|${n.cbteTipo}|${n.cbteDesde}|${n.cae}`;
        if (!byVoucher.has(k)) byVoucher.set(k, []);
        byVoucher.get(k)!.push(n);
      }
      const grouped = Array.from(byVoucher.values()).sort((a, b) => {
        const da = new Date(a[0]?.createdAt || 0).getTime() || 0;
        const db = new Date(b[0]?.createdAt || 0).getTime() || 0;
        return db - da;
      });
      const selectedGroup = grouped[0] || [];
      const baseNc = selectedGroup[0];
      if (!baseNc) {
        showToast('info', 'No hay notas de crédito para este pedido');
        return;
      }
      const amountByItemIndex: Record<number, number> = {};
      const quantityByItemIndex: Record<number, number> = {};
      const itemIndexes: number[] = [];
      selectedGroup
        .filter((n) => (n.scope || 'total') === 'item' && typeof n.itemIndex === 'number')
        .forEach((n) => {
          const idx = Number(n.itemIndex);
          if (!Number.isInteger(idx) || idx < 0) return;
          itemIndexes.push(idx);
          amountByItemIndex[idx] = (amountByItemIndex[idx] || 0) + Number(n.amountCredited || 0);
          const price = Number(order.items[idx]?.priceAtMoment ?? 0);
          if (price > 0) {
            const q = Number(n.amountCredited || 0) / price;
            quantityByItemIndex[idx] = (quantityByItemIndex[idx] || 0) + q;
          }
        });
      const nc = {
        ...baseNc,
        amountCredited: selectedGroup.reduce((s, n) => s + Number(n.amountCredited || 0), 0),
        itemIndexes: Array.from(new Set(itemIndexes)),
        amountByItemIndex,
        quantityByItemIndex
      } as CreditNote & { itemIndexes?: number[]; amountByItemIndex?: Record<number, number>; quantityByItemIndex?: Record<number, number> };
      const html = buildCreditNoteHtml(order, nc);
      if (!html) {
        showToast('error', 'No se pudo generar la nota de crédito');
        return;
      }
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(html);
        w.document.close();
      }
    } catch (err: any) {
      showToast('error', err?.message || 'Error obteniendo notas de crédito');
    }
  };

  const buildOrderSheet = (order: Order) => {
    const customerName = getCustomerName(order);
    const enrichedItems = order.items.map(enrichItem);
    const colorCodeFromSku = (skuRaw: string): string => {
      const sku = String(skuRaw || '').trim();
      if (!sku) return '';
      const parts = sku.split('-').filter(Boolean);
      if (parts.length >= 3) {
        const d = parts[parts.length - 1].replace(/\D/g, '');
        if (d.length >= 3) return d.slice(0, 3);
      }
      const digits = sku.replace(/\D/g, '');
      if (digits.length >= 3) return digits.slice(-3);
      return '';
    };
    const articleCodeFromSku = (skuRaw: string): string => {
      const sku = String(skuRaw || '').trim();
      if (!sku) return '';
      const parts = sku.split('-').filter(Boolean);
      if (parts.length >= 3) return parts[0];
      const digits = sku.replace(/\D/g, '');
      if (!digits) return sku;
      // Formato común local: BASE(7) + TALLE(3) + COLOR(3)
      if (digits.length > 9) return digits.slice(0, -6);
      return digits;
    };
    const colorCodeFromName = (nameRaw: string): string => {
      const name = String(nameRaw || '').trim();
      if (!name) return '';
      // Ej: "614 - Natural", "997 - Negro"
      const leading = name.match(/^([A-Z0-9]+)\s*-/i);
      if (leading?.[1]) return leading[1].toUpperCase();
      // Ej: "TRICOLOR_905", "ESTAMPADO_948"
      const embedded = name.match(/(?:^|_)(\d{3})(?:$|_)/);
      if (embedded?.[1]) return embedded[1];
      return '';
    };

    const SIZE_COLS = ['U', 'P', 'M', 'G', 'GG', 'XG', 'XXG', 'XXXG'] as const;
    const sizeLabelFromCode = (raw: string): string => {
      const code = String(raw || '').trim().toUpperCase();
      if (!code) return '';
      if (SIZE_COLS.includes(code as any)) return code;
      const map: Record<string, string> = {
        '170': 'U',
        '130': 'P',
        '140': 'M',
        '150': 'G',
        '160': 'GG',
        '180': 'XG',
        '200': 'XXG',
        '250': 'XXXG',
      };
      return map[code] || '';
    };

    type PivotRow = {
      codigo: string;
      color: string;
      price: number;
      qtyBySize: Record<string, number>;
      totalUnits: number;
    };

    const byKey = new Map<string, PivotRow>();
    for (const item of enrichedItems) {
      const codigo = articleCodeFromSku(String(item.sku || '')) || String(item.sku || '').trim() || '—';
      const color = String((item as any).colorCode || '').trim()
        || colorCodeFromSku(String(item.sku || ''))
        || colorCodeFromName(String(item.colorName || ''))
        || String(item.colorName || '').trim()
        || '—';
      const size = String(item.sizeCode || '').trim() || '';
      const price = Number(item.priceAtMoment || 0);
      const qty = Number(item.quantity || 0);
      const key = `${codigo}__${color}__${price}`;

      if (!byKey.has(key)) {
        byKey.set(key, {
          codigo,
          color,
          price,
          qtyBySize: {},
          totalUnits: 0
        });
      }
      const row = byKey.get(key)!;
      const sizeLabel = sizeLabelFromCode(size);
      if (sizeLabel) row.qtyBySize[sizeLabel] = (row.qtyBySize[sizeLabel] || 0) + qty;
      row.totalUnits += qty;
    }

    const pivotRows = Array.from(byKey.values()).sort((a, b) => {
      const byCode = a.codigo.localeCompare(b.codigo, undefined, { numeric: true });
      if (byCode !== 0) return byCode;
      return a.color.localeCompare(b.color, undefined, { numeric: true });
    });

    const blockHeaders = ['CÓDIGO', 'COLOR', ...SIZE_COLS, 'PRECIO'];
    const blockRow = (r?: PivotRow) => {
      if (!r) return Array(blockHeaders.length).fill('');
      return [
        r.codigo,
        r.color,
        ...SIZE_COLS.map(s => {
          const q = Number(r.qtyBySize[s] || 0);
          return q > 0 ? q : '';
        }),
        r.price
      ];
    };

    const totalUnits = enrichedItems.reduce((s, i) => s + Number(i.quantity || 0), 0);
    const totalFromItems = pivotRows.reduce((sum, r) => sum + (r.totalUnits * r.price), 0);
    const netFromLines = orderNetoFromItems(order);
    const displayTotal =
      netFromLines > 0 ? netFromLines : order.total != null && order.total > 0 ? order.total : totalFromItems;
    const half = Math.ceil(pivotRows.length / 2);
    const left = pivotRows.slice(0, half);
    const right = pivotRows.slice(half);
    const rowsCount = Math.max(left.length, right.length);
    const separator = ['', ''];

    const data: any[][] = [
      ['CLIENTE', customerName, '', '', '', '', '', '', '', '', '', '', '', 'FECHA', formatOrderDate(order.date)],
      ['PEDIDO', order.id, '', '', '', '', '', '', '', '', '', '', '', 'ESTADO', order.status],
      ['TOTAL', displayTotal, '', '', '', '', '', '', '', '', '', '', '', 'UNIDADES', totalUnits],
    ];
    if (order.createdByName) {
      const creado = `${order.createdByName}${order.createdByRole ? ` (${orderRoleLabelEs(order.createdByRole)})` : ''}`;
      data.push(['CREADO POR', creado, '', '', '', '', '', '', '', '', '', '', '', '', '']);
    }
    const sellerForExport = order.sellerName || (order.sellerId ? users.find((u) => u.id === order.sellerId)?.name : '');
    if (order.sellerId && sellerForExport && (order.createdBy !== order.sellerId || !order.createdByName)) {
      data.push(['VENDEDOR', sellerForExport, '', '', '', '', '', '', '', '', '', '', '', '', '']);
    }
    data.push([]);
    data.push([...blockHeaders, ...separator, ...blockHeaders]);
    for (let i = 0; i < rowsCount; i++) {
      data.push([...blockRow(left[i]), ...separator, ...blockRow(right[i])]);
    }
    return XLSX.utils.aoa_to_sheet(data);
  };

  /** Exportar todos los pedidos (filtrados o todos): un archivo Excel con una hoja por pedido, cada una como planilla. */
  const exportOrdersToExcel = () => {
    const list = filteredOrders.length > 0 ? filteredOrders : orders;
    if (list.length === 0) return;
    const workbook = XLSX.utils.book_new();
    const usedNames = new Set<string>();
    list.forEach((order, index) => {
      let sheetName = safeSheetName(order);
      if (usedNames.has(sheetName)) sheetName = `${sheetName.slice(0, 28)}_${index}`.slice(0, 31);
      usedNames.add(sheetName);
      const ws = buildOrderSheet(order);
      XLSX.utils.book_append_sheet(workbook, ws, sheetName);
    });
    const filename = `pedidos_mayoristas_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(workbook, filename);
  };

  /** Exportar un solo pedido a Excel (una hoja en formato planilla). */
  const exportOneOrderToExcel = (order: Order, e: React.MouseEvent) => {
    e.stopPropagation();
    const workbook = XLSX.utils.book_new();
    const ws = buildOrderSheet(order);
    const sheetName = safeSheetName(order).slice(0, 31);
    XLSX.utils.book_append_sheet(workbook, ws, sheetName);
    const clientNameForFile = getCustomerName(order).replace(/[\\/*?:\[\]"]/g, '').replace(/\s+/g, '_').slice(0, 40) || 'cliente';
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `pedido_${order.id}_${clientNameForFile}_${dateStr}.xlsx`);
  };

  return (
    <div className="space-y-6">
       <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Gestión de Pedidos</h2>
          <p className="text-[11px] text-slate-500 mt-1 max-w-xl leading-relaxed">
            Cada pedido tiene un <strong className="text-slate-400">borde a la izquierda</strong>: verde = stock ya descontado; ámbar
            = borrador o pendiente de admin (sin impacto de stock); naranja = confirmado pero el movimiento de stock todavía no se aplicó; gris = cancelado.
            Usá el botón de descontar stock si hace falta. Pasá el mouse por el chip para leer el detalle.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={exportOrdersToExcel}
            className="w-full sm:w-auto bg-slate-700 hover:bg-slate-600 text-white px-4 py-3 rounded-2xl transition flex items-center justify-center gap-2 border border-slate-600 font-semibold active:scale-95"
          >
            <FileSpreadsheet size={20} />
            <span>Exportar a Excel</span>
          </button>
          {(role === Role.SELLER || role === Role.ADMIN || role === Role.CUSTOMER) && (
            <button
              onClick={() => onNavigate('create_order')}
              className="w-full sm:w-auto bg-blue-600 text-white px-6 py-3 rounded-2xl hover:bg-blue-700 transition flex items-center justify-center gap-2 shadow-lg shadow-blue-900/50 font-bold active:scale-95"
            >
              <Plus size={20} />
              <span>Nuevo Pedido</span>
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex gap-2 overflow-x-auto touch-scroll pb-2 scrollbar-hide -mx-1 px-1 sm:mx-0 sm:px-0 touch-manipulation">
          {['ALL', ...Object.values(OrderStatus)].map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status as OrderStatus | 'ALL')}
              className={`px-4 sm:px-5 py-3 sm:py-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition-all border min-h-[44px] ${
                filterStatus === status 
                ? 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-900/30' 
                : 'bg-slate-800 text-slate-400 border-slate-700 active:bg-slate-700'
              }`}
            >
              {status === 'ALL' ? 'Todos' : status}
            </button>
          ))}
        </div>

        <div className="relative">
          <select
            value={filterCustomer}
            onChange={(e) => setFilterCustomer(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-sm rounded-xl p-3 outline-none appearance-none cursor-pointer"
          >
            <option value="ALL">Todos los Clientes</option>
            {customers.map(c => (
              <option key={c.id} value={c.id}>{c.businessName || c.name || 'Cliente'}</option>
            ))}
          </select>
        </div>

        {setOrderArchivedFilter && (role === Role.ADMIN || role === Role.WAREHOUSE || role === Role.DEPOSITO) && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs font-semibold text-slate-500 uppercase">Archivados:</span>
            <button
              type="button"
              onClick={() => setOrderArchivedFilter('no')}
              className={`px-3 py-2 rounded-xl text-sm font-medium border transition ${orderArchivedFilter === 'no' ? 'bg-slate-600 text-white border-slate-500' : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'}`}
            >
              Ocultar archivados
            </button>
            <button
              type="button"
              onClick={() => setOrderArchivedFilter('yes')}
              className={`px-3 py-2 rounded-xl text-sm font-medium border transition ${orderArchivedFilter === 'yes' ? 'bg-slate-600 text-white border-slate-500' : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'}`}
            >
              Ver todos
            </button>
            <button
              type="button"
              onClick={() => setOrderArchivedFilter('only')}
              className={`px-3 py-2 rounded-xl text-sm font-medium border transition ${orderArchivedFilter === 'only' ? 'bg-slate-600 text-white border-slate-500' : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'}`}
            >
              Solo archivados
            </button>
          </div>
        )}
      </div>

      {afipConfigured && !afipProduction && (
        <div className="rounded-xl border border-amber-700/60 bg-amber-900/30 text-amber-200 px-4 py-3 text-sm flex items-center gap-2">
          <AlertCircle size={20} className="flex-shrink-0 text-amber-400" />
          <span><strong>Facturación en homologación.</strong> Las facturas se emiten en el ambiente de prueba de AFIP y <strong>no aparecen en AFIP real</strong>. Para que lleguen a AFIP, configurá <code className="bg-amber-900/50 px-1 rounded">AFIP_PRODUCTION=true</code> y usá certificado/token de producción en el servidor.</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-4">
          {filteredOrders.map((order) => {
          const canEditOrder = canEditOrderBase && !order.invoice;
          const customer = customers.find(c => c.id === order.customerId);
          const sellerDisplayName =
            order.sellerName || (order.sellerId ? users.find((u) => u.id === order.sellerId)?.name : undefined);
          const showSellerLine = Boolean(
            order.sellerId && sellerDisplayName && (order.createdBy !== order.sellerId || !order.createdByName)
          );
          const totalItemsCount = order.items.reduce((acc, i) => acc + i.quantity, 0);
          const hasBackorders = order.items.some(i => i.isBackorder);
          const stockImpact = getWholesaleStockImpactMeta(order);
          
          return (
            <div 
              key={order.id} 
              onClick={() => canEditOrder && onEditOrder?.(order)}
              className={`bg-slate-800 rounded-2xl border border-slate-700 p-4 md:p-5 transition-all group shadow-sm active:bg-slate-750 ${canEditOrder ? 'hover:border-blue-500 cursor-pointer' : 'cursor-default'} touch-manipulation ${stockImpact.cardAccentClass}`}
            >
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
                <div className="space-y-1 min-w-0 flex-1">
                  <h3 className="text-lg sm:text-xl font-black text-white leading-tight break-words line-clamp-2 sm:line-clamp-1">
                    {order.customerBusinessName || customer?.businessName || customer?.name || 'Cliente desconocido'}
                  </h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-400">#{order.id}</span>
                    <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider ${getStatusColor(order.status)}`}>
                      {order.status}
                    </span>
                    {hasBackorders && (
                       <span className="bg-red-900/30 text-red-400 border border-red-800/50 px-2 py-0.5 rounded-lg text-[10px] font-black flex items-center gap-1">
                         <AlertCircle size={10} /> PENDIENTES
                       </span>
                    )}
                    {order.invoice && (
                      <span
                        className="bg-emerald-900/30 text-emerald-300 border border-emerald-800/50 px-2 py-0.5 rounded-lg text-[10px] font-black flex items-center gap-1 cursor-help"
                        title={
                          [
                            'Factura real AFIP.',
                            `CAE: ${order.invoice.cae}`,
                            order.invoice.puntoVta != null ? `Nº: ${order.invoice.puntoVta}-${order.invoice.cbteDesde}` : `Nº: ${order.invoice.cbteDesde}`,
                            order.invoice.caeFchVto ? `Vto. CAE: ${new Date(order.invoice.caeFchVto).toLocaleDateString('es-AR')}` : '',
                            'Verificá en afip.gob.ar (Consulta de CUIT / comprobantes) con tu CUIT y este CAE.'
                          ].filter(Boolean).join('\n')
                        }
                      >
                        <Receipt size={10} /> FACTURADO
                      </span>
                    )}
                    {stockImpact.label && (
                      <span
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-black flex items-center gap-1 cursor-help border ${stockImpact.badgeClassName}`}
                        title={stockImpact.title}
                      >
                        {stockImpact.variant === 'no_impact' && <Package size={10} />}
                        {stockImpact.variant === 'pending' && <Clock size={10} />}
                        {stockImpact.variant === 'deducted' && <PackageCheck size={10} />}
                        {stockImpact.variant === 'not_applied' && <AlertTriangle size={10} />}
                        {stockImpact.label}
                      </span>
                    )}
                    {role !== Role.CUSTOMER && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const current = order.paymentStatus ?? 'pagado';
                          const next: 'pendiente' | 'pagado' = current === 'pendiente' ? 'pagado' : 'pendiente';
                          showConfirm({
                            title: 'Cobranza del pedido',
                            message:
                              next === 'pagado'
                                ? '¿Marcar este pedido como cobrado? Dejará de sumar al saldo pendiente del cliente.'
                                : '¿Marcar como pendiente de cobro? Sumará al saldo pendiente del cliente.',
                            confirmLabel: next === 'pagado' ? 'Marcar cobrado' : 'Marcar pendiente',
                            onConfirm: () => {
                              api
                                .patchOrderPaymentStatus(order.id, next)
                                .then(() => {
                                  showToast('success', next === 'pagado' ? 'Pedido marcado como cobrado.' : 'Pedido marcado como pendiente de cobro.');
                                  refreshOrders?.();
                                })
                                .catch((err: any) => showToast('error', err?.message || 'No se pudo actualizar el cobro.'));
                            }
                          });
                        }}
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-black flex items-center gap-1 border transition touch-manipulation ${
                          (order.paymentStatus ?? 'pagado') === 'pendiente'
                            ? 'bg-amber-900/40 text-amber-200 border-amber-700/50 hover:bg-amber-900/60'
                            : 'bg-emerald-900/25 text-emerald-300/90 border-emerald-800/40 hover:bg-emerald-900/40'
                        }`}
                        title="Tocá para cambiar pendiente / cobrado (cuenta corriente)"
                      >
                        <Wallet size={10} />
                        {(order.paymentStatus ?? 'pagado') === 'pendiente' ? 'PENDIENTE COBRO' : 'COBRADO'}
                      </button>
                    )}
                    {Number(order.creditNotesTotalCount || 0) > 0 && (
                      <span className="bg-violet-900/30 text-violet-300 border border-violet-800/50 px-2 py-0.5 rounded-lg text-[10px] font-black">
                        <FileMinus size={10} /> N.C. TOTAL ({order.creditNotesTotalCount})
                      </span>
                    )}
                    {Number(order.creditNotesTotalCount || 0) === 0 && Number(order.creditNotesItemCount || 0) > 0 && (
                      <span className="bg-amber-900/30 text-amber-300 border border-amber-800/50 px-2 py-0.5 rounded-lg text-[10px] font-black">
                        <FileMinus size={10} /> N.C. PARCIAL ({order.creditNotesItemCount})
                      </span>
                    )}
                  </div>
                  {(order.createdByName || showSellerLine) && (
                    <div className="text-xs text-slate-500 space-y-0.5 mt-1">
                      {order.createdByName && (
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-slate-600">Creado por</span>
                          <span className="text-slate-400 font-medium">{order.createdByName}</span>
                          {order.createdByRole && (
                            <span className="text-slate-500">({orderRoleLabelEs(order.createdByRole)})</span>
                          )}
                        </div>
                      )}
                      {showSellerLine && (
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-slate-600">Vendedor del pedido</span>
                          <span className="text-slate-400 font-medium">{sellerDisplayName}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {order.status === OrderStatus.DISPATCHED && order.pickedBy && (
                    <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                      <Truck size={12} />
                      Sacado por <span className="text-slate-400 font-medium">{users.find(u => u.id === order.pickedBy)?.name || order.pickedBy}</span>
                      {order.dispatchedAt && (
                        <> el {new Date(order.dispatchedAt).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 sm:gap-2 self-end sm:self-auto max-w-full [&>button]:min-w-[40px] [&>button]:min-h-[40px]">
                  {afipConfigured && canEmitirFactura && !order.invoice && (() => {
                    const customer = customers.find(c => c.id === order.customerId);
                    const tipoFactura = getTipoFacturaParaCliente(order);
                    const condicionIva = customer?.condicionIva || 'No informada';
                    return (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOrderToEmitFactura(order);
                          setEmitirFacturaTipo('auto');
                          const prevSale = manualFacturaDataByOrder[order.id]?.saleCondition?.toLowerCase() || '';
                          setEmitirFacturaSaleCondition(prevSale.includes('60') ? '60 días' : '30 días');
                          const custEmit = customers.find((c) => c.id === order.customerId);
                          const optsEmit = transporteOptionsForCustomer(custEmit, transportes);
                          setEmitirFacturaTransporteId(pickInitialTransporteId(manualFacturaDataByOrder[order.id], optsEmit));
                          setShowEmitirFacturaModal(true);
                        }}
                        disabled={!!emitiendoFacturaId}
                        className="p-2 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-700/50 transition disabled:opacity-50"
                        title={`Emitir factura electrónica AFIP (se emitirá Factura ${tipoFactura} según condición IVA del cliente)`}
                      >
                        {emitiendoFacturaId === order.id ? <Clock size={16} className="animate-pulse" /> : <Receipt size={16} />}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          showConfirm({
                            title: 'Facturar sin stock',
                            message: `Se emitirá Factura ${tipoFactura} y este pedido quedará marcado como "sin impacto de stock".\n\nUsar solo para facturación administrativa (sin movimiento real de inventario).\n\n¿Continuar?`,
                            confirmLabel: `Facturar sin stock`,
                            onConfirm: () => {
                              setEmitiendoFacturaId(order.id);
                              api.emitirFactura(order.id, { noStockImpact: true })
                                .then((res) => {
                                  onFacturaEmitida?.(order.id, {
                                    cae: res.cae,
                                    caeFchVto: res.caeFchVto,
                                    cbteDesde: res.cbteDesde,
                                    cbteHasta: res.cbteHasta,
                                    cbteTipo: res.cbteTipo,
                                    puntoVta: res.puntoVta,
                                    agipAlicuota: Number((res as any).agipAlicuota || 0),
                                    agipRetPer: Number((res as any).agipRetPer || 0)
                                  });
                                  showToast('success', `Factura ${tipoFactura} emitida sin impactar stock. CAE ${res.cae}`);
                                })
                                .catch((err: any) => showToast('error', err?.message || err?.response?.data?.message || 'Error emitiendo factura'))
                                .finally(() => setEmitiendoFacturaId(null));
                            }
                          });
                        }}
                        disabled={!!emitiendoFacturaId}
                        className="p-2 rounded-lg text-slate-400 hover:text-amber-300 hover:bg-slate-700/50 transition disabled:opacity-50"
                        title="Emitir factura sin descontar stock"
                      >
                        <Package size={16} />
                      </button>
                    </>
                    );
                  })()}
                  <button
                    onClick={(e) => openRemitoModal(order, e)}
                    className="p-2 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-700/50 transition"
                    title="Generar remito (hoja de despacho) en PDF"
                  >
                    <FileText size={16} />
                  </button>
                  {role !== Role.CUSTOMER &&
                    !order.noStockImpact &&
                    order.status !== OrderStatus.CANCELLED &&
                    order.mayoristaStockApplied !== true && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setApplyingMayoristaStockId(order.id);
                          api
                            .applyMayoristaStock(order.id)
                            .then((r) => {
                              showToast(
                                'success',
                                r.message ||
                                  (r.alreadyApplied
                                    ? 'El stock de este pedido ya estaba descontado.'
                                    : 'Stock descontado correctamente.')
                              );
                              refreshOrders?.();
                            })
                            .catch((err: any) =>
                              showToast('error', err?.response?.data?.message || err?.message || 'Error al descontar stock')
                            )
                            .finally(() => setApplyingMayoristaStockId(null));
                        }}
                        disabled={applyingMayoristaStockId === order.id}
                        className="p-2 rounded-lg text-slate-400 hover:text-cyan-300 hover:bg-slate-700/50 transition disabled:opacity-50"
                        title="Descontar stock ahora: en borrador pasa a confirmado y aplica; si ya estaba confirmado, solo registra el movimiento de inventario si aún faltaba."
                      >
                        {applyingMayoristaStockId === order.id ? (
                          <Loader2 size={16} className="animate-spin text-cyan-400" />
                        ) : (
                          <ArrowDownToLine size={16} />
                        )}
                      </button>
                    )}
                  {order.invoice && (
                    <>
                      <button
                        onClick={(e) => openFactura(order, e)}
                        className="p-2 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-700/50 transition"
                        title="Completar datos y abrir factura (PDF)"
                      >
                        <Receipt size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => openFactura(order, e)}
                        className="px-2 py-1 rounded-lg text-[11px] font-bold text-emerald-400/95 hover:text-emerald-300 hover:bg-slate-700/60 transition whitespace-nowrap"
                        title="Abrir el mismo modal para vista previa de la factura"
                      >
                        Vista previa
                      </button>
                    </>
                  )}
                  {Number(order.creditNotesCount || 0) > 0 && (
                    <button
                      onClick={(e) => openNotaCredito(order, e)}
                      className="p-2 rounded-lg text-slate-400 hover:text-violet-400 hover:bg-slate-700/50 transition"
                      title="Ver nota(s) de crédito / Descargar PDF"
                    >
                      <FileMinus size={16} />
                    </button>
                  )}
                  {order.invoice && afipConfigured && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const inv = order.invoice!;
                        const ptoVta = (inv as any).puntoVta ?? (inv as any).punto_venta ?? 1;
                        const cbteTipo = (inv as any).cbteTipo ?? (inv as any).cbte_tipo ?? 6;
                        const cbteNro = (inv as any).cbteDesde ?? (inv as any).cbte_desde ?? 0;
                        if (!cbteNro) return;
                        setVerificandoAfipOrderId(order.id);
                        api.consultarComprobanteAfip(ptoVta, cbteTipo, cbteNro)
                          .then((r) => {
                            if (r.existe) {
                              showToast('success', `AFIP tiene el comprobante. CAE: ${(r.resultado?.CodAutorizacion ?? r.resultado?.codAutorizacion) ?? 'OK'}`);
                            } else {
                              showToast('warning', r.error ?? 'AFIP no devolvió el comprobante.');
                            }
                          })
                          .catch((err: any) => showToast('error', err?.message ?? 'Error al consultar AFIP'))
                          .finally(() => setVerificandoAfipOrderId(null));
                      }}
                      disabled={verificandoAfipOrderId === order.id}
                      className="p-2 rounded-lg text-slate-400 hover:text-sky-400 hover:bg-slate-700/50 transition"
                      title="Verificar en AFIP que el comprobante existe (FECompConsultar)"
                    >
                      {verificandoAfipOrderId === order.id ? (
                        <span className="text-xs">...</span>
                      ) : (
                        <CheckCircle size={16} />
                      )}
                    </button>
                  )}
                  {order.invoice && afipConfigured && canEmitirFactura && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setNcOrder(order);
                        setNcTipo('total');
                        setNcItemIndex(0);
                        setNcQuantity(order.items[0]?.quantity ?? 1);
                        setNcItemsQuantities({});
                      }}
                      className="p-2 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-700/50 transition"
                      title="Emitir nota de crédito AFIP (total o por artículo)"
                    >
                      <FileMinus size={16} />
                    </button>
                  )}
                  <button
                    onClick={(e) => exportOneOrderToExcel(order, e)}
                    className="p-2 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-700/50 transition"
                    title="Exportar este pedido a Excel (planilla)"
                  >
                    <FileSpreadsheet size={16} />
                  </button>
                  {canCancelOrder(order) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); showConfirm({ title: 'Cancelar pedido', message: '¿Cancelar este pedido? Se restaurará el stock.', confirmLabel: 'Cancelar pedido', onConfirm: () => onUpdateStatus(order.id, OrderStatus.CANCELLED) }); }}
                      className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-900/20 transition"
                      title="Cancelar pedido (restaura stock)"
                    >
                      <XCircle size={16} />
                    </button>
                  )}
                  {role === Role.ADMIN && !order.invoice && (
                    <button
                      onClick={(e) => { e.stopPropagation(); showConfirm({ title: 'Eliminar pedido', message: '¿Eliminar pedido? Esta acción no se puede deshacer.', confirmLabel: 'Eliminar', onConfirm: () => onDeleteOrder?.(order.id) }); }}
                      className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-900/20 transition"
                      title="Eliminar pedido definitivamente"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                  {refreshOrders && (role === Role.ADMIN || role === Role.WAREHOUSE || role === Role.DEPOSITO) && (
                    order.archived ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setArchivingOrderId(order.id);
                          api.archiveOrder(order.id, false).then(() => { refreshOrders(); showToast('success', 'Pedido desarchivado'); }).catch((err: any) => showToast('error', err?.message || 'Error')).finally(() => setArchivingOrderId(null));
                        }}
                        disabled={!!archivingOrderId}
                        className="p-2 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-700/50 transition disabled:opacity-50"
                        title="Desarchivar (mostrar en lista activa)"
                      >
                        {archivingOrderId === order.id ? <Clock size={16} className="animate-pulse" /> : <ArchiveRestore size={16} />}
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setArchivingOrderId(order.id);
                          api.archiveOrder(order.id, true).then(() => { refreshOrders(); showToast('success', 'Pedido archivado'); }).catch((err: any) => showToast('error', err?.message || 'Error')).finally(() => setArchivingOrderId(null));
                        }}
                        disabled={!!archivingOrderId}
                        className="p-2 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-700/50 transition disabled:opacity-50"
                        title="Archivar (ocultar de la lista activa)"
                      >
                        {archivingOrderId === order.id ? <Clock size={16} className="animate-pulse" /> : <Archive size={16} />}
                      </button>
                    )
                  )}
                  {canEditOrder && <ChevronRight size={20} className="text-slate-600 group-hover:text-blue-400 transition-colors" />}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4 pt-3 border-t border-slate-700/50">
                <div className="text-xs text-slate-500">
                  {totalItemsCount} {totalItemsCount === 1 ? 'unidad' : 'unidades'} • {formatOrderDate(order.date)}
                </div>
                <div className="flex items-center justify-between sm:justify-end gap-3 flex-wrap w-full sm:w-auto">
                   {(role === Role.WAREHOUSE || role === Role.DEPOSITO || role === Role.ADMIN) &&
                    [OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.PENDING_CONTROL, OrderStatus.CONTROLLED].includes(order.status) && (
                     <button
                        onClick={(e) => { e.stopPropagation(); onStartPicking?.(order); }}
                        className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-blue-500 transition"
                        title="Abrir pantalla de picking (requiere confirmación admin previa)"
                     >
                        Picking
                     </button>
                   )}
                   {getNextStatusForOrder(order) !== null && (role === Role.WAREHOUSE || role === Role.DEPOSITO || role === Role.ADMIN) && (
                     <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const next = getNextStatusForOrder(order);
                          if (next) onUpdateStatus(order.id, next);
                        }}
                        className="bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-emerald-500 transition"
                        title={`Pasar a ${getNextStatusForOrder(order)}`}
                     >
                        → {getNextStatusForOrder(order)}
                     </button>
                   )}
                   <div className="text-right ml-auto sm:ml-0">
                     <div className="text-lg font-black text-blue-400">${formatMoneyAr(orderNetoFromItems(order))}</div>
                     <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Neto (sin IVA)</div>
                   </div>
                </div>
              </div>
            </div>
          );
        })}

        {filteredOrders.length === 0 && (
          <div className="text-center py-20 bg-slate-900/50 rounded-3xl border-2 border-dashed border-slate-800">
             <Package size={48} className="mx-auto opacity-10 text-slate-500 mb-2" />
             <p className="text-slate-500 font-medium">No se encontraron pedidos.</p>
          </div>
        )}
      </div>

      {/* Modal: elegir tipo de factura (A o B) antes de emitir */}
      {showEmitirFacturaModal && orderToEmitFactura && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => { if (!emitiendoFacturaId) { setShowEmitirFacturaModal(false); setOrderToEmitFactura(null); } }}>
          <div className="bg-slate-800 rounded-2xl border border-slate-700 shadow-xl w-full max-w-2xl p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-1">Emitir factura electrónica AFIP</h3>
            <p className="text-sm text-slate-400 mb-4">Pedido #{orderToEmitFactura.id} — {orderToEmitFactura.customerBusinessName || getCustomerName(orderToEmitFactura)}</p>
            <p className="text-xs text-slate-500 mb-4">
              Condición IVA del cliente: {customers.find(c => c.id === orderToEmitFactura.customerId)?.condicionIva || 'No informada'}.
              Solo corresponde Factura A si el cliente es Responsable Inscripto.
            </p>
            <label className="block text-xs font-semibold text-slate-400 uppercase mb-2">Tipo de comprobante</label>
            <div className="space-y-2 mb-6">
              <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-600 hover:bg-slate-700/50 cursor-pointer">
                <input type="radio" name="tipoFactura" checked={emitirFacturaTipo === 'auto'} onChange={() => setEmitirFacturaTipo('auto')} className="rounded border-slate-500 text-emerald-500" />
                <span className="text-white">Automático</span>
                <span className="text-slate-500 text-xs">(según condición IVA del cliente)</span>
              </label>
              <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-600 hover:bg-slate-700/50 cursor-pointer">
                <input type="radio" name="tipoFactura" checked={emitirFacturaTipo === 'A'} onChange={() => setEmitirFacturaTipo('A')} className="rounded border-slate-500 text-emerald-500" />
                <span className="text-white font-medium">Factura A</span>
                <span className="text-slate-500 text-xs">(cliente con CUIT, Responsable Inscripto)</span>
              </label>
              <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-600 hover:bg-slate-700/50 cursor-pointer">
                <input type="radio" name="tipoFactura" checked={emitirFacturaTipo === 'B'} onChange={() => setEmitirFacturaTipo('B')} className="rounded border-slate-500 text-emerald-500" />
                <span className="text-white font-medium">Factura B</span>
                <span className="text-slate-500 text-xs">(Consumidor final / Monotributo)</span>
              </label>
            </div>
            <label className="block text-xs font-semibold text-slate-400 uppercase mb-2">Condición de venta</label>
            <div className="mb-4">
              <select
                value={emitirFacturaSaleCondition}
                onChange={(e) => setEmitirFacturaSaleCondition((e.target.value === '60 días' ? '60 días' : '30 días'))}
                className="w-full bg-slate-900 border border-slate-600 rounded-xl p-3 text-white focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                <option value="30 días">30 días</option>
                <option value="60 días">60 días</option>
              </select>
            </div>
            {(() => {
              const custE = customers.find((c) => c.id === orderToEmitFactura.customerId);
              const optsE = transporteOptionsForCustomer(custE, transportes);
              return (
                <div className="mb-6">
                  <label className="block text-xs font-semibold text-slate-400 uppercase mb-2">Transporte (en la factura impresa)</label>
                  <select
                    value={emitirFacturaTransporteId}
                    onChange={(e) => setEmitirFacturaTransporteId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl p-3 text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    <option value="">{optsE.length > 1 ? 'Todos los asignados al cliente' : '— Sin especificar —'}</option>
                    {optsE.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}{t.address ? ` — ${t.address}` : ''}
                      </option>
                    ))}
                  </select>
                  {optsE.length === 0 && (
                    <p className="text-xs text-amber-400/95 mt-2">No hay transportes cargados. En Configuración → Remitos cargá transportes y asignalos al cliente en Clientes.</p>
                  )}
                </div>
              );
            })()}
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => { setShowEmitirFacturaModal(false); setOrderToEmitFactura(null); }}
                disabled={!!emitiendoFacturaId}
                className="px-4 py-2.5 rounded-xl font-semibold text-slate-400 hover:bg-slate-700 transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={openFacturaPreviewBeforeEmit}
                disabled={!!emitiendoFacturaId}
                className="px-5 py-2.5 rounded-xl font-bold bg-slate-700 hover:bg-slate-600 text-white flex items-center gap-2 transition disabled:opacity-50"
              >
                <FileText size={18} />
                Vista previa
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!orderToEmitFactura) return;
                  const cbteTipo = emitirFacturaTipo === 'A' ? 1 as const : emitirFacturaTipo === 'B' ? 6 as const : undefined;
                  setEmitiendoFacturaId(orderToEmitFactura.id);
                  const custEmit = customers.find((c) => c.id === orderToEmitFactura.customerId);
                  const optsEmit = transporteOptionsForCustomer(custEmit, transportes);
                  const manual: ManualFacturaFields = {
                    ...(manualFacturaDataByOrder[orderToEmitFactura.id] || {}),
                    saleCondition: emitirFacturaSaleCondition,
                  };
                  if (emitirFacturaTransporteId) {
                    const t = optsEmit.find((o) => o.id === emitirFacturaTransporteId);
                    if (t) {
                      manual.transporteId = t.id;
                      manual.transporteName = t.name;
                      manual.transporteAddress = t.address;
                    }
                  } else {
                    delete manual.transporteId;
                    delete manual.transporteName;
                    delete manual.transporteAddress;
                  }
                  setManualFacturaDataByOrder((prev) => ({
                    ...prev,
                    [orderToEmitFactura.id]: manual
                  }));
                  api.emitirFactura(orderToEmitFactura.id, cbteTipo != null ? { cbteTipo } : undefined)
                    .then((res) => {
                      onFacturaEmitida?.(orderToEmitFactura.id, {
                        cae: res.cae,
                        caeFchVto: res.caeFchVto,
                        cbteDesde: res.cbteDesde,
                        cbteHasta: res.cbteHasta,
                        cbteTipo: res.cbteTipo,
                        puntoVta: res.puntoVta,
                        agipAlicuota: Number((res as any).agipAlicuota || 0),
                        agipRetPer: Number((res as any).agipRetPer || 0)
                      } as any);
                      showToast('success', `Factura emitida. CAE ${res.cae}`);
                      setShowEmitirFacturaModal(false);
                      setOrderToEmitFactura(null);
                    })
                    .catch((err: any) => showToast('error', err?.message || err?.response?.data?.message || 'Error emitiendo factura'))
                    .finally(() => setEmitiendoFacturaId(null));
                }}
                disabled={!!emitiendoFacturaId}
                className="px-5 py-2.5 rounded-xl font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-2 transition disabled:opacity-50"
              >
                {emitiendoFacturaId === orderToEmitFactura?.id ? <Clock size={18} className="animate-pulse" /> : <Receipt size={18} />}
                {emitiendoFacturaId === orderToEmitFactura?.id ? 'Emitiendo…' : 'Emitir factura'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: completar datos para vista de factura */}
      {facturaPreviewOrder && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setFacturaPreviewOrder(null)}>
          <div className="bg-slate-800 rounded-2xl border border-slate-700 shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-1">Completar datos de factura</h3>
            <p className="text-sm text-slate-400 mb-4">
              Pedido #{facturaPreviewOrder.id} — {facturaPreviewOrder.customerBusinessName || getCustomerName(facturaPreviewOrder)}
            </p>
            <div className="space-y-3 mb-6">
              {(() => {
                const custF = customers.find((c) => c.id === facturaPreviewOrder.customerId);
                const optsF = transporteOptionsForCustomer(custF, transportes);
                return (
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Transporte (factura impresa)</label>
                    <select
                      value={facturaTransporteId}
                      onChange={(e) => setFacturaTransporteId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-600 rounded-xl p-3 text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                    >
                      <option value="">{optsF.length > 1 ? 'Todos los asignados al cliente' : '— Sin especificar —'}</option>
                      {optsF.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}{t.address ? ` — ${t.address}` : ''}
                        </option>
                      ))}
                    </select>
                    {optsF.length === 0 && (
                      <p className="text-xs text-amber-400/95 mt-1.5">No hay transportes. Cargalos en Configuración → Remitos y asignalos al cliente.</p>
                    )}
                    {optsF.length > 1 && (
                      <p className="text-[10px] text-slate-500 mt-1">Si elegís un transporte, solo ese nombre se imprime. Si no, se listan todos los del cliente.</p>
                    )}
                  </div>
                );
              })()}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">N° Transporte</label>
                <input
                  type="text"
                  value={facturaTransportNumber}
                  onChange={(e) => setFacturaTransportNumber(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl p-3 text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                  placeholder="Opcional"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">N° Remito</label>
                <input
                  type="text"
                  value={facturaRemitoNumber}
                  onChange={(e) => setFacturaRemitoNumber(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl p-3 text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                  placeholder="Ej: R-0001-00001234"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Condición de venta</label>
                <select
                  value={facturaSaleCondition}
                  onChange={(e) => setFacturaSaleCondition(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl p-3 text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  {CONDICIONES_VENTA_FACTURA.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setFacturaPreviewOrder(null)} className="px-4 py-2.5 rounded-xl font-semibold text-slate-400 hover:bg-slate-700 transition">Cancelar</button>
              <button type="button" onClick={confirmOpenFactura} className="px-5 py-2.5 rounded-xl font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition">
                Ver factura
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: elegir transporte para el remito */}
      {remitoOrder && (() => {
        const customer = customers.find(c => c.id === remitoOrder.customerId);
        const transportesDelCliente = customer?.transportes ?? [];
        const transportesOpciones = transportesDelCliente.length > 0 ? transportesDelCliente : transportes;
        return (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => { setRemitoOrder(null); setRemitoTransporteName(''); setRemitoBultos(''); setRemitoDescripcion(''); setRemitoDocumentNumber(''); }}>
            <div className="bg-slate-800 rounded-2xl border border-slate-700 shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-white mb-1">Generar remito</h3>
              <p className="text-sm text-slate-400 mb-4">Pedido #{remitoOrder.id} — {remitoOrder.customerBusinessName || customer?.businessName || customer?.name || 'Cliente'}</p>
              <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">N° Remito (se imprime arriba a la derecha)</label>
              <input
                type="text"
                value={remitoDocumentNumber}
                onChange={(e) => setRemitoDocumentNumber(e.target.value)}
                placeholder="Ej: 0008-12345678"
                className="w-full bg-slate-900 border border-slate-600 rounded-xl p-3 text-white font-mono focus:ring-2 focus:ring-amber-500 outline-none mb-4"
              />
              <label className="block text-xs font-semibold text-slate-400 uppercase mb-2">Transporte para este envío</label>
              <select
                value={remitoTransporteName}
                onChange={(e) => setRemitoTransporteName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-xl p-3 text-white focus:ring-2 focus:ring-amber-500 outline-none mb-4"
              >
                <option value="">— No especificado</option>
                {transportesOpciones.map(t => (
                  <option key={t.id} value={t.name}>{t.name}{t.address ? ` — ${t.address}` : ''}</option>
                ))}
              </select>
              {transportesOpciones.length === 0 && (
                <p className="text-amber-500/90 text-xs mb-2">No hay transportes cargados. Agregá al menos uno en Configuración → Remitos y opcionalmente asignálos al cliente en Clientes.</p>
              )}
              <p className="text-xs text-amber-200/90 mb-2">Para envío por expreso (al interior)</p>
              <div className="grid grid-cols-1 gap-3 mb-4">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Cantidad de bultos</label>
                  <input
                    type="number"
                    min={0}
                    placeholder="Ej: 2"
                    value={remitoBultos}
                    onChange={(e) => setRemitoBultos(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl p-3 text-white font-mono focus:ring-2 focus:ring-amber-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Descripción de lo que va</label>
                  <textarea
                    placeholder="Ej: 2 cajas con indumentaria"
                    value={remitoDescripcion}
                    onChange={(e) => setRemitoDescripcion(e.target.value)}
                    rows={2}
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl p-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-amber-500 outline-none resize-y"
                  />
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => { setRemitoOrder(null); setRemitoTransporteName(''); setRemitoBultos(''); setRemitoDescripcion(''); setRemitoDocumentNumber(''); }} className="px-4 py-2.5 rounded-xl font-semibold text-slate-400 hover:bg-slate-700 transition">Cancelar</button>
                <button type="button" onClick={confirmRemito} className="px-5 py-2.5 rounded-xl font-bold bg-amber-600 hover:bg-amber-500 text-white flex items-center gap-2 transition">
                  <FileText size={18} /> Generar remito
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal: emitir nota de crédito (todo el pedido o un artículo) */}
      {ncOrder && (() => {
        const hasNCTotal = orderCreditNotes.some((nc) => (nc.scope || 'total') === 'total');
        const creditedByItemIndex: Record<number, number> = {};
        orderCreditNotes.filter((nc) => nc.scope === 'item' && typeof nc.itemIndex === 'number').forEach((nc) => {
          creditedByItemIndex[nc.itemIndex!] = (creditedByItemIndex[nc.itemIndex!] || 0) + nc.amountCredited;
        });
        const currentItem = ncOrder.items[ncItemIndex];
        const itemPrice = Number(currentItem?.priceAtMoment ?? 0);
        const itemQty = currentItem?.quantity ?? 0;
        const itemLineTotal = Math.round(itemQty * itemPrice * 100) / 100;
        const creditedItem = creditedByItemIndex[ncItemIndex] ?? 0;
        const remainingCredit = Math.round((itemLineTotal - creditedItem) * 100) / 100;
        const maxQtyRemaining = remainingCredit <= 0 ? 0 : Math.min(itemQty, Math.floor(remainingCredit / itemPrice + 0.001));
        const canEmitTotal = !hasNCTotal;
        const canEmitItem = maxQtyRemaining > 0;
        const multiCandidates = ncOrder.items.map((item, i) => {
          const price = Number(item?.priceAtMoment ?? 0);
          const qty = Number(item?.quantity ?? 0);
          const lineTotal = Math.round(qty * price * 100) / 100;
          const credited = creditedByItemIndex[i] ?? 0;
          const remaining = Math.round((lineTotal - credited) * 100) / 100;
          const maxQty = remaining <= 0 || price <= 0 ? 0 : Math.min(qty, Math.floor(remaining / price + 0.001));
          return { index: i, item, price, qty, credited, remaining, maxQty };
        });
        const selectedMulti = multiCandidates
          .map((c) => ({ ...c, selectedQty: Math.max(0, Math.min(c.maxQty, Number(ncItemsQuantities[c.index] || 0))) }))
          .filter((c) => c.selectedQty > 0);
        const canEmitItems = selectedMulti.length > 0;
        return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => !emitiendoNC && setNcOrder(null)}>
          <div className="bg-slate-800 rounded-2xl border border-slate-700 shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-1">Emitir nota de crédito</h3>
            <p className="text-sm text-slate-400 mb-4">
              Pedido #{ncOrder.id} — {ncOrder.customerBusinessName || getCustomerName(ncOrder)}
            </p>
            <div className="space-y-4 mb-6">
              {hasNCTotal ? (
                <p className="text-sm text-amber-400 bg-amber-900/20 rounded-lg p-3">Ya existe una nota de crédito por el total de este pedido. No se pueden emitir más notas de crédito.</p>
              ) : (
                <>
              <div className="flex gap-4 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="ncTipo"
                    checked={ncTipo === 'total'}
                    onChange={() => setNcTipo('total')}
                    className="rounded border-slate-500 text-amber-500"
                  />
                  <span className="text-white">Todo el pedido</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="ncTipo" checked={ncTipo === 'item'} onChange={() => setNcTipo('item')} className="rounded border-slate-500 text-amber-500" />
                  <span className="text-white">Un artículo</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="ncTipo" checked={ncTipo === 'items'} onChange={() => setNcTipo('items')} className="rounded border-slate-500 text-amber-500" />
                  <span className="text-white">Varios artículos</span>
                </label>
              </div>
              {ncTipo === 'item' && ncOrder.items.length > 0 && (
                <div className="space-y-3 pl-1">
                  <label className="block text-xs font-semibold text-slate-400 uppercase">Artículo</label>
                  <select
                    value={ncItemIndex}
                    onChange={(e) => {
                      const i = parseInt(e.target.value, 10);
                      setNcItemIndex(i);
                      const q = ncOrder.items[i]?.quantity ?? 1;
                      const p = Number(ncOrder.items[i]?.priceAtMoment ?? 0);
                      const cred = creditedByItemIndex[i] ?? 0;
                      const rem = Math.round((q * p - cred) * 100) / 100;
                      const maxQ = rem <= 0 ? 0 : Math.min(q, Math.floor(rem / p + 0.001));
                      setNcQuantity(maxQ > 0 ? Math.min(maxQ, q) : 0);
                    }}
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl p-3 text-white focus:ring-2 focus:ring-amber-500 outline-none"
                  >
                    {ncOrder.items.map((item, i) => {
                      const en = enrichItem(item);
                      const code = String((en.sku || item.sku || item.productId || '')).trim();
                      const label = [en.productName ?? 'Ítem', en.sizeCode, en.colorName].filter(Boolean).join(' · ') || `Ítem ${i + 1}`;
                      const cred = creditedByItemIndex[i] ?? 0;
                      const yaCred = cred > 0 ? ` — Ya creditado $${formatMoneyAr(cred)}` : '';
                      return <option key={i} value={i}>{label} {code ? `[${code}]` : ''} — {item.quantity} u × ${formatMoneyAr(Number(item.priceAtMoment))}{yaCred}</option>;
                    })}
                  </select>
                  {creditedItem > 0 && (
                    <p className="text-xs text-amber-400">Ya creditado para este ítem: ${formatMoneyAr(creditedItem)}. Máximo a creditar: ${formatMoneyAr(remainingCredit)} ({maxQtyRemaining} u)</p>
                  )}
                  <label className="block text-xs font-semibold text-slate-400 uppercase">Cantidad a creditar</label>
                  <input
                    type="number"
                    min={0}
                    max={maxQtyRemaining}
                    value={ncQuantity}
                    onChange={(e) => setNcQuantity(Math.max(0, Math.min(maxQtyRemaining, parseInt(e.target.value, 10) || 0)))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl p-3 text-white focus:ring-2 focus:ring-amber-500 outline-none"
                  />
                  {maxQtyRemaining === 0 && (
                    <p className="text-xs text-amber-400">No queda monto a creditar para este ítem.</p>
                  )}
                  <p className="text-xs text-slate-500">
                    {(() => {
                      const lineNet = ncQuantity * Number(ncOrder.items[ncItemIndex]?.priceAtMoment ?? 0);
                      const { iva, impTotal } = afipDesdeNeto(lineNet);
                      return (
                        <>
                          Monto neto a creditar (sin IVA): <strong className="text-slate-300">${formatMoneyAr(lineNet)}</strong>
                          <span className="block mt-1 text-slate-400">
                            AFIP: IVA 21% ${formatMoneyAr(iva)} → total comprobante ${formatMoneyAr(impTotal)}
                          </span>
                        </>
                      );
                    })()}
                  </p>
                </div>
              )}
              {ncTipo === 'total' && (() => {
                const baseNc = orderNetoFromItems(ncOrder);
                const { neto, iva, impTotal } = afipDesdeNeto(baseNc);
                return (
                  <div className="text-sm text-slate-500 space-y-2">
                    <p>
                      La NC se emite sobre el <strong className="text-white">monto neto</strong> del pedido (sin IVA), igual que la factura:{' '}
                      <strong className="text-white">${formatMoneyAr(neto)}</strong>
                    </p>
                    <p className="text-xs text-slate-400">
                      En AFIP: IVA 21% ${formatMoneyAr(iva)} → total del comprobante ${formatMoneyAr(impTotal)}.
                    </p>
                  </div>
                );
              })()}
              {ncTipo === 'items' && (
                <div className="space-y-3 pl-1">
                  <div className="flex items-center justify-between gap-2">
                    <label className="block text-xs font-semibold text-slate-400 uppercase">Artículos a incluir</label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="px-2 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-[11px] font-bold text-slate-200"
                        onClick={() => {
                          const next: Record<number, number> = {};
                          multiCandidates.forEach((c) => { next[c.index] = c.maxQty; });
                          setNcItemsQuantities(next);
                        }}
                      >
                        Completar máximos
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-[11px] font-bold text-slate-200"
                        onClick={() => setNcItemsQuantities({})}
                      >
                        Limpiar
                      </button>
                    </div>
                  </div>
                  <div className="max-h-64 overflow-auto space-y-2 pr-1">
                    {multiCandidates.map((c) => {
                      const en = enrichItem(c.item);
                      const code = String((en.sku || c.item.sku || c.item.productId || '')).trim();
                      const label = [en.productName ?? `Ítem ${c.index + 1}`, en.sizeCode, en.colorName].filter(Boolean).join(' · ');
                      const selectedQty = Math.max(0, Math.min(c.maxQty, Number(ncItemsQuantities[c.index] || 0)));
                      return (
                        <div key={c.index} className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] items-start gap-2 mb-2">
                            <div>
                              <div className="text-sm text-slate-100 font-semibold">{label}</div>
                              <div className="text-[11px] text-slate-400">{code ? `Código: ${code}` : 'Sin código'}</div>
                            </div>
                            <div className="text-[11px] text-slate-400">{c.qty} u × ${formatMoneyAr(c.price)}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              max={c.maxQty}
                              value={selectedQty}
                              onChange={(e) => {
                                const next = Math.max(0, Math.min(c.maxQty, parseInt(e.target.value, 10) || 0));
                                setNcItemsQuantities((prev) => ({ ...prev, [c.index]: next }));
                              }}
                              className="w-24 bg-slate-800 border border-slate-600 rounded-lg p-2 text-white focus:ring-2 focus:ring-amber-500 outline-none"
                            />
                            <span className="text-[11px] text-slate-500">máx: {c.maxQty} u</span>
                            <span className="text-[11px] text-slate-500">importe: ${formatMoneyAr(selectedQty * c.price)}</span>
                          </div>
                          {c.credited > 0 && (
                            <div className="text-[11px] text-amber-400 mt-1">
                              Ya creditado: ${formatMoneyAr(c.credited)} · disponible: ${formatMoneyAr(c.remaining)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-slate-500">
                    {(() => {
                      const net = selectedMulti.reduce((sum, c) => sum + (c.selectedQty * c.price), 0);
                      const { iva, impTotal } = afipDesdeNeto(net);
                      return (
                        <>
                          Monto neto a creditar (sin IVA): <strong className="text-slate-300">${formatMoneyAr(net)}</strong>
                          <span className="block mt-1 text-slate-400">
                            AFIP: IVA 21% ${formatMoneyAr(iva)} → total comprobante ${formatMoneyAr(impTotal)}
                          </span>
                        </>
                      );
                    })()}
                  </p>
                </div>
              )}
                </>
              )}
            </div>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setNcOrder(null)} disabled={emitiendoNC} className="px-4 py-2.5 rounded-xl font-semibold text-slate-400 hover:bg-slate-700 transition disabled:opacity-50">Cancelar</button>
              {!hasNCTotal && (
              <button
                type="button"
                disabled={emitiendoNC || (ncTipo === 'total'
                  ? !canEmitTotal
                  : ncTipo === 'item'
                    ? (!canEmitItem || ncQuantity < 1 || ncQuantity > maxQtyRemaining)
                    : !canEmitItems)}
                onClick={async () => {
                  if (!ncOrder) return;
                  setEmitiendoNC(true);
                  try {
                    const payload: { tipo: 'total' | 'item' | 'items'; itemIndex?: number; quantity?: number; items?: Array<{ itemIndex: number; quantity: number }> } = { tipo: ncTipo };
                    if (ncTipo === 'item') {
                      payload.itemIndex = ncItemIndex;
                      payload.quantity = ncQuantity;
                    } else if (ncTipo === 'items') {
                      payload.items = selectedMulti.map((c) => ({ itemIndex: c.index, quantity: c.selectedQty }));
                    }
                    const res = await api.emitirNotaCredito(ncOrder.id, payload);
                    showToast('success', `Nota de crédito emitida. CAE ${res.cae}`);
                    onCreditNoteEmitida?.(ncOrder.id);
                    setNcOrder(null);
                  } catch (err: any) {
                    showToast('error', err?.message || err?.response?.data?.message || 'Error emitiendo nota de crédito');
                  } finally {
                    setEmitiendoNC(false);
                  }
                }}
                className="px-5 py-2.5 rounded-xl font-bold bg-amber-600 hover:bg-amber-500 text-white flex items-center gap-2 transition disabled:opacity-50"
              >
                {emitiendoNC ? <Clock size={18} className="animate-pulse" /> : <FileMinus size={18} />}
                {emitiendoNC ? 'Emitiendo…' : 'Emitir nota de crédito'}
              </button>
              )}
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
});

export default Orders;
