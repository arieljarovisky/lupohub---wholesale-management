import React, { useState, useEffect } from 'react';
import { Search, ChevronRight, CheckCircle, Clock, Truck, FileText, Bot, Plus, X, Trash2, Save, PackageCheck, Lock, Filter, Package, Edit, AlertCircle, XCircle, FileSpreadsheet, Receipt, FileMinus, Archive, ArchiveRestore, Wallet } from 'lucide-react';
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
} from '../utils/wholesaleInvoiceHtml';

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

const CONDICIONES_VENTA_FACTURA = [
  'Contado',
  'Tarjeta de Débito',
  'Tarjeta de Crédito',
  'Cuenta Corriente',
  'Cheque',
  'Transferencia Bancaria',
  'Otra',
  'Otros medios de pago electrónico',
];
const FACTURA_MANUAL_DATA_KEY = 'lupo_factura_manual_data_by_order';

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
  const [afipConfigured, setAfipConfigured] = useState(false);
  const [afipProduction, setAfipProduction] = useState(true);
  const [issuerFromApi, setIssuerFromApi] = useState<{ cuit: string; businessName: string; address: string; city: string } | null>(null);
  const [emitiendoFacturaId, setEmitiendoFacturaId] = useState<string | null>(null);
  const [showEmitirFacturaModal, setShowEmitirFacturaModal] = useState(false);
  const [orderToEmitFactura, setOrderToEmitFactura] = useState<Order | null>(null);
  const [emitirFacturaTipo, setEmitirFacturaTipo] = useState<'auto' | 'A' | 'B'>('auto');
  const [ncOrder, setNcOrder] = useState<Order | null>(null);
  const [orderCreditNotes, setOrderCreditNotes] = useState<CreditNote[]>([]);
  const [ncTipo, setNcTipo] = useState<'total' | 'item'>('total');
  const [ncItemIndex, setNcItemIndex] = useState(0);
  const [ncQuantity, setNcQuantity] = useState<number>(1);
  const [emitiendoNC, setEmitiendoNC] = useState(false);
  const [archivingOrderId, setArchivingOrderId] = useState<string | null>(null);
  const [verificandoAfipOrderId, setVerificandoAfipOrderId] = useState<string | null>(null);
  const [manualFacturaDataByOrder, setManualFacturaDataByOrder] = useState<Record<string, { remitoNumber?: string; transportNumber?: string; saleCondition?: string }>>(() => {
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
  const [facturaSaleCondition, setFacturaSaleCondition] = useState('Cuenta Corriente');

  useEffect(() => {
    if (!ncOrder) {
      setOrderCreditNotes([]);
      return;
    }
    api.getOrderCreditNotes(ncOrder.id).then((notes) => {
      setOrderCreditNotes(notes);
      if (notes.some((n) => (n.scope || 'total') === 'total')) setNcTipo('item');
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

  const statusesCancelables = [OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.PENDING_CONTROL, OrderStatus.CONTROLLED];
  const canCancelOrder = (order: Order) =>
    !order.invoice &&
    (statusesCancelables.includes(order.status) || order.status === 'Preparación') &&
    (role === Role.ADMIN || role === Role.SELLER || role === Role.CUSTOMER || role === Role.WAREHOUSE || role === Role.DEPOSITO);

  /** Siguiente estado posible para el flujo Depósito (Preparando → Falta controlar → Controlado → Despachado). */
  const getNextStatusForOrder = (order: Order): OrderStatus | null => {
    const s = order.status;
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
  };

  /** Genera el HTML del remito con formato de factura y multipágina. */
  const buildRemitoHtml = (order: Order, transporteName: string, bultos?: number | string | null, descripcion?: string | null) => {
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
    const remitoBaseNumber = (order.id || '').toString().trim();
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
      return `<tr>
        <td class="col-c">${qty.toLocaleString('es-AR')}</td>
        <td class="col-c col-code">${sku || '—'}</td>
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

    const baseImponible = order.total != null && order.total > 0 ? order.total : items.reduce((s, i) => s + i.quantity * (i.priceAtMoment ?? 0), 0);
    const neto = Math.round(baseImponible * 100) / 100;
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
        <div class="topbar">
          <div class="logo">${logoBlockRemito}</div>
          <div class="codebox">
            <div class="code">REMITO<br>R</div>
            <div class="num">${remitoNumber || '—'}</div>
            <div style="margin-top:6px;" class="muted">Fecha: ${formatDateShort(order.date)}</div>
          </div>
        </div>
        <div class="hr"></div>
        <div class="grid2">
          <div>
            <div><strong>${razonEmpresa}</strong></div>
            ${empresaDir ? `<div>${empresaDir}</div>` : ''}
            ${cuitEmpresa ? `<div>C.U.I.T.: ${cuitEmpresa}</div>` : ''}
            ${ingresosBrutosEmpresa ? `<div>Ingresos Brutos: ${ingresosBrutosEmpresa}</div>` : ''}
            ${inicioActividadEmpresa ? `<div>Inicio de actividad: ${inicioActividadEmpresa}</div>` : ''}
            ${emailEmpresa ? `<div>E-mail: ${emailEmpresa}</div>` : ''}
            ${telEmpresa ? `<div>Tel: ${telEmpresa}</div>` : ''}
          </div>
          <div>
            ${cuitEmpresa ? `<div class="line"><div class="k">C.U.I.T.:</div><div class="v">${cuitEmpresa}</div></div>` : ''}
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
        ${descripcionTrim ? `<div class="desc-box"><strong>Descripción:</strong> ${descripcionTrim}</div>` : ''}
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
        <div class="footer">
          ${caiFooterHtml}
          <div class="muted">Página ${idx + 1} de ${pages.length}</div>
        </div>
      </section>`;
    }).join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Remito ${order.id}</title><style>
      @page { size: A4; margin: 12mm 12mm 14mm 12mm; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 0; color: #111; background: #fff; font-family: Arial, Helvetica, sans-serif; font-size: 11px; }
      .sheet { width: 210mm; min-height: 297mm; padding: 10mm; margin: 0 auto; display: flex; flex-direction: column; }
      .page-break { page-break-before: always; }
      .topbar { display: grid; grid-template-columns: 1fr 170px; gap: 10px; align-items: start; margin-bottom: 6px; }
      .logo { min-height: 42px; display: flex; align-items: center; }
      .logo img { max-height: 42px; max-width: 140px; object-fit: contain; }
      .codebox { border: 1px solid #111; padding: 6px 8px; text-align: center; }
      .codebox .code { font-weight: 700; letter-spacing: 0.08em; }
      .codebox .num { margin-top: 6px; border: 1px solid #111; padding: 6px 8px; font-weight: 700; }
      .hr { border-top: 1px solid #111; margin: 6px 0 10px; }
      .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .block { padding: 6px 8px; border: 1px solid #111; min-height: 58px; }
      .muted { color: #333; }
      .line { display: flex; gap: 8px; }
      .line .k { width: 78px; color: #333; }
      .line .v { flex: 1; }
      .boxrow { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 10px; margin-top: 8px; }
      .boxrow .block { min-height: 46px; }
      .desc-box { margin-top: 8px; border: 1px solid #111; padding: 6px 8px; white-space: pre-line; }
      table { width: 100%; border-collapse: collapse; margin-top: 10px; }
      thead th { border-top: 1px solid #111; border-bottom: 1px solid #111; padding: 6px 6px; text-align: left; }
      tbody td { padding: 5px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
      .col-c { text-align: center; }
      .col-r { text-align: right; }
      .col-code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10px; }
      .col-desc { white-space: normal; word-break: break-word; overflow-wrap: anywhere; }
      .summary { display: grid; grid-template-columns: 1fr 220px; gap: 10px; margin-top: 10px; }
      .totals { border: 1px solid #111; }
      .totals .r { display: flex; justify-content: space-between; padding: 6px 8px; border-bottom: 1px solid #ddd; }
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
    const bultosVal = remitoBultos.trim() ? remitoBultos : null;
    const html = buildRemitoHtml(remitoOrder, remitoTransporteName, bultosVal, remitoDescripcion.trim() || null);
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
    }
    setRemitoOrder(null);
    setRemitoTransporteName('');
    setRemitoBultos('');
    setRemitoDescripcion('');
  };

  const mergedRemitenteForFactura = () => {
    const localRemitente = getRemitente();
    return (issuerFromApi && (issuerFromApi.businessName || issuerFromApi.cuit))
      ? { ...localRemitente, ...issuerFromApi, logoUrl: localRemitente.logoUrl, email: localRemitente.email, phone: localRemitente.phone }
      : localRemitente;
  };

  const buildFacturaHtml = (order: Order, manual?: { remitoNumber?: string; transportNumber?: string; saleCondition?: string }) => {
    const customer = customers.find((c) => c.id === order.customerId);
    return buildWholesaleFacturaHtml({
      order,
      customer,
      products,
      remitente: mergedRemitenteForFactura() as any,
      manual,
    });
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
    if (prev) {
      const html = buildFacturaHtml(order, prev);
      if (!html) return;
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(html);
        w.document.close();
      }
      return;
    }
    const manual = prev ?? {
      transportNumber: (customer?.transportNumber ?? '').toString().trim(),
      remitoNumber: (customer?.remitoNumber ?? '').toString().trim(),
      saleCondition: (customer?.saleCondition ?? 'Cuenta Corriente').toString().trim(),
    };
    setFacturaPreviewOrder(order);
    setFacturaTransportNumber((manual.transportNumber ?? '').toString());
    setFacturaRemitoNumber((manual.remitoNumber ?? '').toString());
    setFacturaSaleCondition((manual.saleCondition ?? 'Cuenta Corriente').toString() || 'Cuenta Corriente');
  };

  const confirmOpenFactura = () => {
    if (!facturaPreviewOrder) return;
    const manual = {
      transportNumber: facturaTransportNumber.trim(),
      remitoNumber: facturaRemitoNumber.trim(),
      saleCondition: facturaSaleCondition.trim() || 'Cuenta Corriente',
    };
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
      const nc = notes[0];
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
    const displayTotal = order.total != null && order.total > 0 ? order.total : totalFromItems;
    const half = Math.ceil(pivotRows.length / 2);
    const left = pivotRows.slice(0, half);
    const right = pivotRows.slice(half);
    const rowsCount = Math.max(left.length, right.length);
    const separator = ['', ''];

    const data: any[][] = [
      ['CLIENTE', customerName, '', '', '', '', '', '', '', '', '', '', '', 'FECHA', formatOrderDate(order.date)],
      ['PEDIDO', order.id, '', '', '', '', '', '', '', '', '', '', '', 'ESTADO', order.status],
      ['TOTAL', displayTotal, '', '', '', '', '', '', '', '', '', '', '', 'UNIDADES', totalUnits],
      [],
      [...blockHeaders, ...separator, ...blockHeaders],
    ];
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
        <h2 className="text-2xl font-bold text-white">Gestión de Pedidos</h2>
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
          const totalItemsCount = order.items.reduce((acc, i) => acc + i.quantity, 0);
          const hasBackorders = order.items.some(i => i.isBackorder);
          
          return (
            <div 
              key={order.id} 
              onClick={() => canEditOrder && onEditOrder?.(order)}
              className={`bg-slate-800 rounded-2xl border border-slate-700 p-4 md:p-5 transition-all group shadow-sm active:bg-slate-750 ${canEditOrder ? 'hover:border-blue-500 cursor-pointer' : 'cursor-default'} touch-manipulation`}
            >
              <div className="flex justify-between items-start">
                <div className="space-y-1 min-w-0 flex-1">
                  <h3 className="text-xl font-black text-white truncate">{order.customerBusinessName || customer?.businessName || customer?.name || 'Cliente desconocido'}</h3>
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
                    {order.noStockImpact && (
                      <span
                        className="bg-amber-900/30 text-amber-300 border border-amber-800/50 px-2 py-0.5 rounded-lg text-[10px] font-black flex items-center gap-1 cursor-help"
                        title="Pedido marcado para facturación administrativa: no descuenta ni restaura stock."
                      >
                        <Package size={10} /> SIN IMPACTO STOCK
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
                <div className="flex items-center gap-2">
                  {afipConfigured && canEmitirFactura && !order.invoice && (() => {
                    const customer = customers.find(c => c.id === order.customerId);
                    const tipoFactura = getTipoFacturaParaCliente(order);
                    const condicionIva = customer?.condicionIva || 'No informada';
                    return (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          showConfirm({
                            title: 'Emitir factura AFIP',
                            message: `Se emitirá Factura ${tipoFactura} para ${order.customerBusinessName || customer?.businessName || customer?.name || 'este cliente'}.\n\nCondición IVA del cliente: ${condicionIva}.\n\nSolo corresponde Factura A si el cliente es Responsable Inscripto. Si no es así, cancelá y editá la ficha del cliente en Clientes (campo Condición de IVA) antes de emitir.\n\n¿Continuar?`,
                            confirmLabel: `Emitir Factura ${tipoFactura}`,
                            onConfirm: () => {
                              setEmitiendoFacturaId(order.id);
                              api.emitirFactura(order.id)
                                .then((res) => {
                                  onFacturaEmitida?.(order.id, { cae: res.cae, caeFchVto: res.caeFchVto, cbteDesde: res.cbteDesde, cbteHasta: res.cbteHasta, cbteTipo: res.cbteTipo });
                                  showToast('success', `Factura ${tipoFactura} emitida. CAE ${res.cae}`);
                                })
                                .catch((err: any) => showToast('error', err?.message || err?.response?.data?.message || 'Error emitiendo factura'))
                                .finally(() => setEmitiendoFacturaId(null));
                            }
                          });
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
                                  onFacturaEmitida?.(order.id, { cae: res.cae, caeFchVto: res.caeFchVto, cbteDesde: res.cbteDesde, cbteHasta: res.cbteHasta, cbteTipo: res.cbteTipo });
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
                  {order.invoice && (
                    <button
                      onClick={(e) => openFactura(order, e)}
                      className="p-2 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-700/50 transition"
                      title="Ver factura AFIP emitida / Descargar PDF"
                    >
                      <Receipt size={16} />
                    </button>
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

              <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-700/50">
                <div className="text-xs text-slate-500">
                  {totalItemsCount} {totalItemsCount === 1 ? 'unidad' : 'unidades'} • {formatOrderDate(order.date)}
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                   {(role === Role.WAREHOUSE || role === Role.DEPOSITO || role === Role.ADMIN) && order.status !== OrderStatus.DISPATCHED && order.status !== OrderStatus.CANCELLED && (
                     <button
                        onClick={(e) => { e.stopPropagation(); onStartPicking?.(order); }}
                        className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-blue-500 transition"
                        title="Abrir pantalla de picking (pone el pedido en Preparando si estaba Confirmado)"
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
                   <div className="text-lg font-black text-blue-400">${formatMoneyAr(order.total)}</div>
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
          <div className="bg-slate-800 rounded-2xl border border-slate-700 shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-1">Emitir factura electrónica AFIP</h3>
            <p className="text-sm text-slate-400 mb-4">Pedido #{orderToEmitFactura.id} — {orderToEmitFactura.customerBusinessName || getCustomerName(orderToEmitFactura)}</p>
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
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => { setShowEmitirFacturaModal(false); setOrderToEmitFactura(null); }} disabled={!!emitiendoFacturaId} className="px-4 py-2.5 rounded-xl font-semibold text-slate-400 hover:bg-slate-700 transition disabled:opacity-50">Cancelar</button>
              <button
                type="button"
                onClick={() => {
                  if (!orderToEmitFactura) return;
                  const cbteTipo = emitirFacturaTipo === 'A' ? 1 as const : emitirFacturaTipo === 'B' ? 6 as const : undefined;
                  setEmitiendoFacturaId(orderToEmitFactura.id);
                  api.emitirFactura(orderToEmitFactura.id, cbteTipo != null ? { cbteTipo } : undefined)
                    .then((res) => {
                      onFacturaEmitida?.(orderToEmitFactura.id, { cae: res.cae, caeFchVto: res.caeFchVto, cbteDesde: res.cbteDesde, cbteHasta: res.cbteHasta, cbteTipo: res.cbteTipo });
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
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => { setRemitoOrder(null); setRemitoTransporteName(''); setRemitoBultos(''); setRemitoDescripcion(''); }}>
            <div className="bg-slate-800 rounded-2xl border border-slate-700 shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-white mb-1">Generar remito</h3>
              <p className="text-sm text-slate-400 mb-4">Pedido #{remitoOrder.id} — {remitoOrder.customerBusinessName || customer?.businessName || customer?.name || 'Cliente'}</p>
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
                <button type="button" onClick={() => { setRemitoOrder(null); setRemitoTransporteName(''); setRemitoBultos(''); setRemitoDescripcion(''); }} className="px-4 py-2.5 rounded-xl font-semibold text-slate-400 hover:bg-slate-700 transition">Cancelar</button>
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
                      const label = [en.productName ?? en.sku ?? 'Ítem', en.sizeCode, en.colorName].filter(Boolean).join(' · ') || `Ítem ${i + 1}`;
                      const cred = creditedByItemIndex[i] ?? 0;
                      const lineTotal = (item.quantity * Number(item.priceAtMoment ?? 0));
                      const yaCred = cred > 0 ? ` — Ya creditado $${formatMoneyAr(cred)}` : '';
                      return <option key={i} value={i}>{label} — {item.quantity} u × ${formatMoneyAr(Number(item.priceAtMoment))}{yaCred}</option>;
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
                    Monto a creditar: ${formatMoneyAr(ncQuantity * Number(ncOrder.items[ncItemIndex]?.priceAtMoment ?? 0))}
                  </p>
                </div>
              )}
              {ncTipo === 'total' && (
                <p className="text-sm text-slate-500">Se emitirá una NC por el total del pedido: <strong className="text-white">${formatMoneyAr(ncOrder.total)}</strong></p>
              )}
                </>
              )}
            </div>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setNcOrder(null)} disabled={emitiendoNC} className="px-4 py-2.5 rounded-xl font-semibold text-slate-400 hover:bg-slate-700 transition disabled:opacity-50">Cancelar</button>
              {!hasNCTotal && (
              <button
                type="button"
                disabled={emitiendoNC || (ncTipo === 'total' ? !canEmitTotal : !canEmitItem || ncQuantity < 1 || (ncTipo === 'item' && ncQuantity > maxQtyRemaining))}
                onClick={async () => {
                  if (!ncOrder) return;
                  setEmitiendoNC(true);
                  try {
                    const payload: { tipo: 'total' | 'item'; itemIndex?: number; quantity?: number } = { tipo: ncTipo };
                    if (ncTipo === 'item') {
                      payload.itemIndex = ncItemIndex;
                      payload.quantity = ncQuantity;
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
