import React, { useState, useEffect, useMemo } from 'react';
import { Search, ChevronRight, CheckCircle, Clock, Truck, FileText, Bot, Plus, X, Trash2, Save, PackageCheck, Lock, Filter, Package, Edit, AlertCircle, AlertTriangle, XCircle, FileSpreadsheet, Receipt, FileMinus, Archive, ArchiveRestore, Wallet, ArrowDownToLine, Loader2, Ship, Percent, RefreshCcw, ArrowRight } from 'lucide-react';
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
  mergeServerInvoiceIntoOrder,
  type ManualFacturaFields,
} from '../utils/wholesaleInvoiceHtml';
import { getWholesaleStockImpactMeta } from '../utils/orderStockImpact';

/** Acción en tarjeta de pedido: ícono + texto corto (siempre visible). */
function OrderCardActionButton(props: {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  title: string;
  icon: React.ReactNode;
  label: string;
  variant?: 'default' | 'danger';
}) {
  const { onClick, disabled, title, icon, label, variant = 'default' } = props;
  const tone =
    variant === 'danger'
      ? 'text-slate-400 hover:text-red-400 hover:bg-red-950/25'
      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-700/55';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={`${title}. ${label}`}
      className={`group flex flex-col items-center justify-center gap-0.5 min-w-[48px] max-w-[76px] shrink-0 rounded-xl py-1 px-0.5 transition disabled:pointer-events-none disabled:opacity-35 ${tone}`}
    >
      <span className="flex h-[22px] w-[22px] items-center justify-center shrink-0 [&_svg]:shrink-0">{icon}</span>
      <span className="text-[9px] font-semibold leading-[1.15] text-center text-slate-500 group-hover:text-slate-300 line-clamp-2 px-0.5">
        {label}
      </span>
    </button>
  );
}

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
/** Valor de `remitoEntregaId` cuando se usa la dirección principal del cliente (no una sucursal). */
const REMITO_ENTREGA_PRINCIPAL = '__principal__';

/** Mismo criterio que AFIP: base imponible neto; IVA 21% sobre neto. */
function afipDesdeNeto(neto: number) {
  const n = Number(neto) || 0;
  const iva = Math.round(n * 0.21 * 100) / 100;
  const impTotal = Math.round((n + iva) * 100) / 100;
  return { neto: n, iva, impTotal };
}

/** Suma el monto neto ya creditado por cada ítem (índice) a partir de la lista
 *  de notas de crédito del pedido. Soporta NC nuevas (con `amountByItemIndex`)
 *  y NC históricas (que solo tienen `itemIndex` + `amountCredited`). */
function sumCreditedByItemIndex(notes: CreditNote[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const n of notes) {
    if ((n.scope || 'total') !== 'item') continue;
    const map = n.amountByItemIndex;
    if (map && typeof map === 'object' && Object.keys(map).length > 0) {
      for (const k of Object.keys(map)) {
        const idx = Number(k);
        if (!Number.isInteger(idx) || idx < 0) continue;
        out[idx] = Math.round(((out[idx] || 0) + Number(map[idx] || 0)) * 100) / 100;
      }
    } else if (typeof n.itemIndex === 'number' && n.itemIndex >= 0) {
      out[n.itemIndex] = Math.round(((out[n.itemIndex] || 0) + Number(n.amountCredited || 0)) * 100) / 100;
    }
  }
  return out;
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

/** Percepción IIBB (AGIP) que aplica al pedido facturado: viene de `getOrders` (BD o recálculo con padrón). */
function orderInvoiceApplicableAgip(order: Order): { alicuota: number; retPer: number } | null {
  if (!order.invoice) return null;
  const inv = order.invoice as any;
  const retPer = Number(inv.agipRetPer ?? inv.agip_ret_per ?? 0);
  const alicuota = Number(inv.agipAlicuota ?? inv.agip_alicuota ?? 0);
  if (retPer <= 0.005 && alicuota <= 0.005) return null;
  return { alicuota, retPer };
}

/** Filtros de lista: AFIP + si en la factura guardada figura percepción de ingresos brutos. */
type OrdersInvoiceListFilter =
  | 'all'
  | 'uninvoiced'
  | 'invoiced'
  | 'invoiced_with_iibb'
  | 'invoiced_no_iibb';

function orderMatchesInvoiceListFilter(order: Order, f: OrdersInvoiceListFilter): boolean {
  if (f === 'all') return true;
  if (f === 'uninvoiced') return !order.invoice;
  if (f === 'invoiced') return !!order.invoice;
  if (f === 'invoiced_with_iibb') return !!order.invoice && orderInvoiceApplicableAgip(order) != null;
  if (f === 'invoiced_no_iibb') return !!order.invoice && orderInvoiceApplicableAgip(order) == null;
  return true;
}

/** Una línea legible tipo AFIP: PV — nº comprobante (tipo). */
function formatAfipDocLine(puntoVta?: number | null, cbteDesde?: number | null, cbteTipo?: number | null): string {
  if (puntoVta == null || cbteDesde == null) return '—';
  const t = cbteTipo != null ? ` · tipo ${cbteTipo}` : '';
  return `${puntoVta}-${cbteDesde}${t}`;
}

const Orders: React.FC<OrdersProps> = React.memo(({ 
  orders, products, customers, transportes = [], users, role, 
  currentUserId, onUpdateStatus, onCreateOrder, 
  onNavigate, onStartPicking, onEditOrder, onDeleteOrder, onFacturaEmitida, onCreditNoteEmitida,
  orderArchivedFilter = 'no', setOrderArchivedFilter, refreshOrders
}) => {
  const { showConfirm, showToast } = useNotification();
  const [filterStatus, setFilterStatus] = useState<OrderStatus | 'ALL'>('ALL');
  /** Filtro por comprobante AFIP y por percepción IIBB persistida en la factura. */
  const [invoiceFilter, setInvoiceFilter] = useState<OrdersInvoiceListFilter>('all');
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [remitoOrder, setRemitoOrder] = useState<Order | null>(null);
  const [remitoTransporteId, setRemitoTransporteId] = useState<string>('');
  const [remitoEntregaId, setRemitoEntregaId] = useState<string>(REMITO_ENTREGA_PRINCIPAL);
  const [remitoBultos, setRemitoBultos] = useState<string>('');
  const [remitoDescripcion, setRemitoDescripcion] = useState<string>('');
  /** N° de remito asignado al pedido (secuencia única que arranca en 31457). Se autoasigna al abrir el modal. */
  const [remitoDocumentNumber, setRemitoDocumentNumber] = useState<string>('');
  /** Estado de carga mientras el backend asigna el N° de remito al abrir el modal. */
  const [remitoNumberLoading, setRemitoNumberLoading] = useState<boolean>(false);
  const [afipConfigured, setAfipConfigured] = useState(false);
  const [afipProduction, setAfipProduction] = useState(true);
  const [issuerFromApi, setIssuerFromApi] = useState<{ cuit: string; businessName: string; address: string; city: string } | null>(null);
  /**
   * Datos del remitente persistidos en la base (incluye `caiRemito` y `caiRemitoVencimiento`).
   * `getRemitente()` de `apiIntegration.ts` solo lee localStorage, por eso aunque el CAI esté configurado
   * en Settings, los remitos imprimían "Documento no fiscal" desde otros navegadores. Acá lo traemos del backend.
   */
  const [remitenteFromApi, setRemitenteFromApi] = useState<{
    caiRemito: string;
    caiRemitoVencimiento: string;
    businessName: string;
    address: string;
    city: string;
    cuit: string;
    email: string;
    phone: string;
    logoUrl: string;
  } | null>(null);
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
  const [recalculatingAgipOrderId, setRecalculatingAgipOrderId] = useState<string | null>(null);
  const [reemittingInvoiceOrderId, setReemittingInvoiceOrderId] = useState<string | null>(null);
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
  /** Modal: asignar despachos faltantes a los ítems de un pedido específico. */
  const [assignDespachosOrder, setAssignDespachosOrder] = useState<Order | null>(null);
  const [assignDespachosItems, setAssignDespachosItems] = useState<Array<{
    orderItemId: string;
    variantId: string;
    productId: string;
    sku: string;
    productName: string;
    sizeCode: string;
    colorName: string;
    quantity: number;
    productLastDespachoId: string | null;
    productLastDespachoNumero: string | null;
  }>>([]);
  const [assignDespachosCatalog, setAssignDespachosCatalog] = useState<Array<{ id: string; numero_despacho: string; pais_origen?: string | null; fecha_despacho?: string | null }>>([]);
  const [assignDespachosLoading, setAssignDespachosLoading] = useState(false);
  const [assignDespachosSaving, setAssignDespachosSaving] = useState(false);
  /** Selección por ítem: 'existing' usa `despachoId`; 'new' usa `numeroDespacho` (crea o reutiliza por número). */
  const [assignDespachosByItem, setAssignDespachosByItem] = useState<Record<string, {
    mode: 'existing' | 'new';
    despachoId: string;
    numeroDespacho: string;
    paisOrigen: string;
    fechaDespacho: string;
  }>>({});

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
    const creditedByItem = sumCreditedByItemIndex(orderCreditNotes);
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

  // El remitente (CAI y vencimiento incluidos) se carga siempre que el componente esté visible:
  // cualquier rol que genere un remito debe poder ver el CAI configurado en Settings.
  useEffect(() => {
    api.getRemitenteServer().then(setRemitenteFromApi).catch(() => setRemitenteFromApi(null));
  }, []);

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

  const filteredOrders = useMemo(() => {
    const needle = customerSearchQuery.trim().toLowerCase();
    return orders.filter((o) => {
      if (filterStatus !== 'ALL' && o.status !== filterStatus) return false;
      if (!orderMatchesInvoiceListFilter(o, invoiceFilter)) return false;
      if (!needle) return true;
      const c = customers.find((x) => x.id === o.customerId);
      const hay = [
        (o.customerBusinessName || '').trim(),
        (c?.businessName || '').trim(),
        (c?.name || '').trim(),
        String(o.id || '').toLowerCase(),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [orders, customers, filterStatus, invoiceFilter, customerSearchQuery]);

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

  /**
   * Abre el modal de remito sin consumir número de la secuencia.
   *
   * - Si el pedido **ya tiene** un remito generado previamente (`order.remitoNumber`), se muestra ese mismo
   *   número (idempotente: una reimpresión no consume un número nuevo).
   * - Si **nunca se generó**, el número queda en blanco con la leyenda "Se asignará al generar".
   *   La asignación real (y atómica) ocurre solo cuando el usuario hace click en "Generar remito".
   */
  const openRemitoModal = (order: Order, e: React.MouseEvent) => {
    e.stopPropagation();
    const customer = customers.find(c => c.id === order.customerId);
    const topOpts = transporteOptionsForCustomer(customer, transportes);
    setRemitoOrder(order);
    setRemitoTransporteId(topOpts[0]?.id ?? '');
    setRemitoEntregaId(REMITO_ENTREGA_PRINCIPAL);
    setRemitoBultos('');
    setRemitoDescripcion('');
    setRemitoDocumentNumber(order.remitoNumber != null ? String(order.remitoNumber) : '');
    setRemitoNumberLoading(false);
  };

  /** Genera el HTML del remito con formato de factura y multipágina. `remitoDocumentNumber` es el N° que va arriba a la derecha. */
  const buildRemitoHtml = (
    order: Order,
    remitoDocumentNumber: string,
    bultos?: number | string | null,
    descripcion?: string | null,
    remitoOpts?: { transporteId?: string; entregaId?: string }
  ) => {
    const customer = customers.find(c => c.id === order.customerId);
    const localRemitente = getRemitente();
    // Merge "soft": un campo del servidor solo pisa al local si tiene valor real (no string vacío / null).
    // Antes hacíamos `{ ...local, ...server }` lo que rompía: si el backend devolvía `caiRemito: ''`,
    // sobrescribía el valor válido del localStorage y el remito salía sin CAI.
    const mergeSoft = (base: any, extra: any): any => {
      if (!extra) return { ...base };
      const out: any = { ...base };
      for (const k of Object.keys(extra)) {
        const v = (extra as any)[k];
        if (v === undefined || v === null) continue;
        if (typeof v === 'string' && v.trim() === '') continue;
        out[k] = v;
      }
      return out;
    };
    // Prioridad: 1) localStorage  ←  2) backend (remitente_config)  ←  3) AFIP issuer env (solo razón social / CUIT / domicilio).
    let remitenteMerged: any = mergeSoft(localRemitente, remitenteFromApi);
    if (issuerFromApi && (issuerFromApi.businessName || issuerFromApi.cuit)) {
      remitenteMerged = mergeSoft(remitenteMerged, issuerFromApi);
    }
    remitenteMerged.logoUrl = localRemitente.logoUrl; // siempre el SVG fijo
    const remitente = remitenteMerged;
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
    const formatDateDMY = (d: string) => {
      const x = new Date(d);
      if (isNaN(x.getTime())) return d;
      return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}/${x.getFullYear()}`;
    };
    const esc = (v: unknown) =>
      String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const transporteIdSel = (remitoOpts?.transporteId ?? '').trim();
    const selectedTransport =
      transporteIdSel.length > 0
        ? (customer?.transportes?.find((t) => t.id === transporteIdSel) ?? transportes.find((t) => t.id === transporteIdSel))
        : undefined;
    const transportNumber = selectedTransport
      ? selectedTransport.address
        ? `${selectedTransport.name} — ${selectedTransport.address}`
        : selectedTransport.name
      : (customer?.transportNumber || '').toString().trim();
    const remitoBaseNumber = (remitoDocumentNumber || '').toString().trim();
    const saleCondition = (customer?.saleCondition || 'Cuenta Corriente').toString().trim();
    const numBultos = bultos !== undefined && bultos !== null && bultos !== '' ? (typeof bultos === 'number' ? bultos : parseInt(String(bultos), 10)) : null;
    const descripcionTrim = descripcion && String(descripcion).trim() ? String(descripcion).trim().replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
    // Envío por expreso (al interior): se identifica por tener bultos cargados.
    // En ese caso el remito no detalla productos ni precios; muestra solo el valor declarado (sin IVA).
    const isExpreso = numBultos != null && !isNaN(numBultos) && numBultos > 0;
    /** Neto pedido por líneas (mismo criterio que antes). Las NC AFIP guardan `amount_credited` en neto. */
    const netoPedidoPorItems = Math.round(
      items.reduce((s, i) => {
        const qty = Number(i.quantity || 0);
        const unit = Number(i.priceAtMoment ?? 0);
        return s + qty * unit;
      }, 0) * 100
    ) / 100;
    const ncNetoTotal = Math.round((Number(order.creditNotesNetoCredited) || 0) * 100) / 100;
    const montoDeclaradoSinIva = isExpreso
      ? Math.max(0, Math.round((netoPedidoPorItems - ncNetoTotal) * 100) / 100)
      : 0;

    const localSkuOf = (i: OrderItem) => {
      const variantId = i.variantId ?? i.productId;
      const localProduct = variantId ? products.find((p: Product) => p.id === variantId) : undefined;
      return (localProduct?.sku ?? i.sku ?? '').toString().trim();
    };

    const rowsFor = (slice: OrderItem[]) =>
      slice
        .map((i) => {
          const qty = Number(i.quantity || 0);
          const sku = localSkuOf(i);
          const desc = (i.productName ?? '').toString().trim() || '—';
          const despacho = (i as any).numeroDespacho ?? (i as any).numero_despacho ?? null;
          const despachoCell = despacho != null && String(despacho).trim() ? String(despacho).trim() : '—';
          const codePrint = normalizeSkuForPrint(sku);
          const unit = Number(i.priceAtMoment ?? 0);
          const importe = Math.round(qty * unit * 100) / 100;
          return `<tr>
        <td class="ri-c">${qty.toLocaleString('es-AR')}</td>
        <td class="ri-c ri-code">${esc(codePrint) || '—'}</td>
        <td class="ri-desc">${esc(desc)}</td>
        <td class="ri-c">${esc(despachoCell)}</td>
        <td class="ri-r">$${formatMoneyAr(unit)}</td>
        <td class="ri-r">$${formatMoneyAr(importe)}</td>
      </tr>`;
        })
        .join('');

    const itemsPerPage = 16;
    const pages: OrderItem[][] = [];
    if (isExpreso) {
      // En remito por expreso no se detallan los ítems, así que va una sola hoja.
      pages.push([]);
    } else {
      for (let i = 0; i < items.length; i += itemsPerPage) pages.push(items.slice(i, i + itemsPerPage));
      if (pages.length === 0) pages.push([]);
    }

    const empresaDir = [remitente.address, remitente.city].filter(Boolean).join(', ') || '';
    const clienteNombre = order.customerBusinessName || customer?.businessName || customer?.name || 'Cliente';
    const entregaId = (remitoOpts?.entregaId ?? REMITO_ENTREGA_PRINCIPAL).trim() || REMITO_ENTREGA_PRINCIPAL;
    const branch =
      entregaId !== REMITO_ENTREGA_PRINCIPAL
        ? customer?.deliveryAddresses?.find((d) => d.id === entregaId)
        : undefined;
    const clienteDomicilio = (branch ? branch.address : customer?.address || '').toString().trim();
    const clienteLocalidad = (branch ? branch.city : customer?.city || '').toString().trim();
    const clienteDir = [clienteDomicilio, clienteLocalidad].filter(Boolean).join(', ') || '';
    const razonEmpresa = (remitente.businessName || '—').toString();
    const cuitEmpresa = ((remitente as any).cuit || '').toString();
    const ingresosBrutosEmpresa = ((remitente as any).ingresosBrutos || '901-2113373').toString();
    const inicioActividadEmpresa = ((remitente as any).inicioActividad || '13/06/2005').toString();
    const emailEmpresa = ((remitente as any).email || '').toString();
    const telEmpresa = ((remitente as any).phone || '').toString();
    const cuitCliente = (customer?.cuit || '').toString();
    const inv = order.invoice;
    const facturaNroStr =
      inv && (inv.cbteDesde != null || inv.cbteHasta != null)
        ? `${String(inv.puntoVta ?? 0).padStart(4, '0')} - ${String(inv.cbteDesde ?? inv.cbteHasta ?? 0).padStart(8, '0')}`
        : '';
    const condIvaCliente = (customer?.condicionIva || '').toString().trim() || '—';
    const clienteNro = (customer?.legacyCode || '').toString().trim();
    const webEmpresa = ((remitente as any).website || '').toString().trim();
    const ivaEmisorTxt = ((remitente as any).condicionIva || 'I.V.A. RESPONSABLE INSCRIPTO').toString();
    const caiRemitoTrim = remitente.caiRemito?.trim();
    const caiVencimientoStr = remitente.caiRemitoVencimiento
      ? (() => { const d = new Date(remitente.caiRemitoVencimiento! + 'T12:00:00'); return isNaN(d.getTime()) ? remitente.caiRemitoVencimiento : formatDateShort(remitente.caiRemitoVencimiento); })()
      : '';
    const caiFooterHtml = caiRemitoTrim
      ? `<div class="r-cai"><strong>C.A.I.:</strong> ${esc(caiRemitoTrim)}${caiVencimientoStr ? ` &nbsp; <strong>Fecha Vto.:</strong> ${esc(caiVencimientoStr)}` : ''}</div>`
      : '';

    const logoUrlRemito = (remitente.logoUrl && remitente.logoUrl.trim()) ? remitente.logoUrl.trim() : '';
    const logoPlaceholder = (remitente.businessName || 'Empresa').replace(/</g, '&lt;');
    const logoBlockRemito = logoUrlRemito
      ? `<div style="display:flex;align-items:center;gap:8px;">
           <img src="${logoUrlRemito}" alt="Logo" class="inv-logo" referrerpolicy="no-referrer" style="max-height:56px;max-width:220px;width:auto;height:auto;object-fit:contain;display:block;" />
         </div>`
      : `<span class="inv-logo-placeholder">${logoPlaceholder}</span>`;

    /** Marca de agua: logo LUPO (misma URL que el encabezado); si no hay logo, texto LUPO. */
    const wmLogoSrc = esc(logoUrlRemito);
    const watermarkBlock = logoUrlRemito
      ? `<img class="r-wm-img" src="${wmLogoSrc}" alt="" referrerpolicy="no-referrer" />`
      : `<div class="r-wm-text" aria-hidden="true">LUPO</div>`;

    const pagesHtml = pages.map((pageItems, idx) => {
      const remitoNumber = pages.length > 1
        ? `${remitoBaseNumber}-${String(idx + 1).padStart(2, '0')}`
        : remitoBaseNumber;
      const isLast = idx === pages.length - 1;
      const pageRows = rowsFor(pageItems);
      const nroRemitoEsc = esc(remitoNumber || '—');
      const fechaDMY = esc(formatDateDMY(order.date));
      const hojaLine =
        pages.length > 1
          ? `<div class="r-hoja">${idx > 0 ? 'Continúa — ' : ''}Hoja ${idx + 1} / ${pages.length}</div>`
          : '';
      const transporteFirma = [transportNumber ? esc(transportNumber) : '', numBultos != null && !isNaN(numBultos) ? `Bultos: ${numBultos}` : '']
        .filter(Boolean)
        .join('<br/>');
      const caiBlock = isLast ? (caiFooterHtml || `<div class="r-cai r-cai-muted">Comprobante no válido como factura — Documento no fiscal</div>`) : '';

      return `<section class="sheet ${idx > 0 ? 'page-break' : ''}">
        <div class="side-talon">ORIGINAL Blanco - DUPLICADO Color</div>
        <div class="remito-doc">
          ${hojaLine}
          <div class="r-head3">
            <div class="r-h-izq">
              <div class="r-logo">${logoBlockRemito}</div>
              <div class="r-razon">${esc(razonEmpresa)}</div>
              ${empresaDir ? `<div class="r-line-sm">${esc(empresaDir)}</div>` : ''}
              ${telEmpresa ? `<div class="r-line-sm">Tel.: ${esc(telEmpresa)}</div>` : ''}
              ${emailEmpresa ? `<div class="r-line-sm">${esc(emailEmpresa)}</div>` : ''}
              ${webEmpresa ? `<div class="r-line-sm">${esc(webEmpresa)}</div>` : ''}
              <div class="r-iva-line">${esc(ivaEmisorTxt)}</div>
            </div>
            <div class="r-h-mid">
              <div class="r-caja-r">R</div>
              <div class="r-cod91">CODIGO Nº 91</div>
            </div>
            <div class="r-h-der">
              <div class="r-doc-title">REMITO</div>
              <div class="r-doc-nro">Nº ${nroRemitoEsc}</div>
              <div class="r-doc-fecha">FECHA: ${fechaDMY}</div>
              ${cuitEmpresa ? `<div class="r-doc-tax"><span class="r-dlbl">C.U.I.T.</span> ${esc(cuitEmpresa)}</div>` : ''}
              ${ingresosBrutosEmpresa ? `<div class="r-doc-tax"><span class="r-dlbl">Ing. Brutos</span> ${esc(ingresosBrutosEmpresa)}</div>` : ''}
              ${inicioActividadEmpresa ? `<div class="r-doc-tax"><span class="r-dlbl">Inicio actividades</span> ${esc(inicioActividadEmpresa)}</div>` : ''}
            </div>
          </div>
          <div class="r-cli">
            <div class="r-cli-up">
              <div class="r-cli-left">
                <div class="r-row"><span class="r-k">Señores:</span> ${esc(clienteNombre)}</div>
                <div class="r-row"><span class="r-k">Domicilio:</span> ${clienteDomicilio ? esc(clienteDomicilio) : '—'}</div>
                <div class="r-row"><span class="r-k">Localidad:</span> ${clienteLocalidad ? esc(clienteLocalidad) : '—'}</div>
                <div class="r-row"><span class="r-k">IVA Responsable:</span> ${esc(condIvaCliente)}</div>
              </div>
              <div class="r-cli-right">
                <div class="r-row"><span class="r-k">Factura Nº:</span> ${facturaNroStr ? esc(facturaNroStr) : '—'}</div>
                <div class="r-row"><span class="r-k">C.U.I.T.:</span> ${cuitCliente ? esc(cuitCliente) : '—'}</div>
              </div>
            </div>
            ${descripcionTrim ? `<div class="r-cli-obs"><span class="r-k">Observaciones:</span> ${descripcionTrim}</div>` : ''}
            <div class="r-cli-low">
              <div class="r-c3"><div class="r-c3t">CLIENTE Nº</div><div class="r-c3v">${clienteNro ? esc(clienteNro) : '—'}</div></div>
              <div class="r-c3"><div class="r-c3t">Condiciones de Venta</div><div class="r-c3v">${esc(saleCondition)}</div></div>
              <div class="r-c3"><div class="r-c3t">Despachar por</div><div class="r-c3v">${transportNumber ? esc(transportNumber) : '—'}</div></div>
            </div>
          </div>
          <div class="r-items-outer">
            ${watermarkBlock}
            ${
              isExpreso
                ? (() => {
                    // En el remito por expreso se imita la planilla manuscrita del cliente:
                    // una tabla simple de dos columnas (CANTIDAD + DESCRIPCIÓN) con UNA sola fila que detalla
                    // qué se envía, valor declarado sin IVA, expreso y su dirección.
                    const expresoDescripcion = descripcionTrim || 'CAJA TIENDA';
                    const expresoExpNombre = selectedTransport?.name ? esc(String(selectedTransport.name).toUpperCase()) : '';
                    const expresoExpDireccion = selectedTransport?.address ? esc(String(selectedTransport.address).toUpperCase()) : '';
                    // Un solo importe: neto del pedido menos NC (sin mostrar la NC por separado).
                    const expresoValor = `$${formatMoneyAr(montoDeclaradoSinIva)}`;
                    return `<table class="r-items r-items-expreso">
                      <thead>
                        <tr>
                          <th class="ri-c" style="width:80px;">CANTIDAD</th>
                          <th>DESCRIPCIÓN</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td class="ri-c ri-exp-qty">${numBultos}</td>
                          <td class="ri-desc ri-exp-desc">
                            <div class="ri-exp-line">${esc(expresoDescripcion)}</div>
                            <div class="ri-exp-line"><span class="ri-exp-lbl">VALOR DECLARADO (sin IVA):</span> ${esc(expresoValor)}</div>
                            ${expresoExpNombre ? `<div class="ri-exp-line"><span class="ri-exp-lbl">EXP:</span> ${expresoExpNombre}</div>` : ''}
                            ${expresoExpDireccion ? `<div class="ri-exp-line">${expresoExpDireccion}</div>` : ''}
                          </td>
                        </tr>
                      </tbody>
                    </table>`;
                  })()
                : `<table class="r-items">
                    <thead>
                      <tr>
                        <th class="ri-c" style="width:52px;">CANT.</th>
                        <th class="ri-c ri-code" style="width:100px;">CÓDIGO</th>
                        <th>DESCRIPCIÓN</th>
                        <th class="ri-c" style="width:118px;">Nº DESPACHO</th>
                        <th class="ri-r" style="width:84px;">P. UNITARIO</th>
                        <th class="ri-r" style="width:88px;">IMPORTE</th>
                      </tr>
                    </thead>
                    <tbody>${pageRows || '<tr><td class="ri-c" colspan="6">&nbsp;</td></tr>'}</tbody>
                  </table>`
            }
            <div class="r-items-ley">La mercadería viaja por cuenta y cargo del cliente</div>
          </div>
          ${
            isLast
              ? `<div class="r-firma-row">
              <div class="r-firma-cell"><div class="r-firma-t">TRANSPORTE:</div><div class="r-firma-b">${transporteFirma || '&nbsp;'}</div></div>
              <div class="r-firma-cell"><div class="r-firma-t">RECIBI CONFORME:</div><div class="r-firma-b r-firma-sign">&nbsp;</div></div>
            </div>
            ${caiBlock}
            <div class="r-micro">Pedido interno #${esc(order.id)}${clienteDir ? ` · ${esc(clienteDir)}` : ''}</div>`
              : ''
          }
        </div>
      </section>`;
    }).join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Remito ${order.id}</title><style>
      @page { size: A4; margin: 10mm 10mm 12mm 14mm; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 0; color: #000; background: #fff; font-family: Arial, Helvetica, sans-serif; font-size: 11px; }
      .sheet { position: relative; width: 210mm; min-height: 297mm; padding: 8mm 8mm 10mm 11mm; margin: 0 auto; }
      .page-break { page-break-before: always; }
      .side-talon {
        position: absolute;
        left: 1mm;
        top: 22mm;
        bottom: 22mm;
        width: 7mm;
        display: flex;
        align-items: center;
        justify-content: center;
        writing-mode: vertical-rl;
        transform: rotate(180deg);
        text-orientation: mixed;
        font-size: 7px;
        font-weight: 700;
        letter-spacing: 0.06em;
        color: #222;
      }
      .remito-doc { border: 2px solid #000; margin-left: 5mm; min-height: calc(297mm - 18mm); }
      .r-hoja { text-align: right; font-size: 9px; font-weight: 700; padding: 4px 8px; border-bottom: 1px solid #000; background: #fafafa; }
      .r-head3 { display: grid; grid-template-columns: 1.35fr 92px 1fr; border-bottom: 2px solid #000; min-height: 118px; }
      .r-h-izq { padding: 8px 10px 8px 8px; border-right: 2px solid #000; }
      .r-h-mid { border-right: 2px solid #000; padding: 8px 6px; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; }
      .r-h-der { padding: 8px 10px; }
      .r-logo { margin-bottom: 4px; }
      .r-logo img { max-height: 52px; max-width: 200px; object-fit: contain; display: block; }
      .inv-logo-placeholder { font-size: 22px; font-weight: 800; letter-spacing: 0.02em; }
      .r-razon { font-size: 12px; font-weight: 700; margin-bottom: 4px; line-height: 1.2; }
      .r-line-sm { font-size: 10px; line-height: 1.35; margin-bottom: 2px; }
      .r-iva-line { font-size: 10px; font-weight: 700; margin-top: 6px; }
      .r-caja-r {
        width: 56px;
        height: 56px;
        border: 2px solid #000;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 38px;
        font-weight: 800;
        line-height: 1;
      }
      .r-cod91 { font-size: 8px; font-weight: 700; margin-top: 6px; text-align: center; letter-spacing: 0.02em; }
      .r-doc-title { font-size: 22px; font-weight: 800; letter-spacing: 0.04em; margin-bottom: 4px; }
      .r-doc-nro { font-size: 13px; font-weight: 700; margin-bottom: 4px; }
      .r-doc-fecha { font-size: 11px; font-weight: 700; margin-bottom: 8px; }
      .r-doc-tax { font-size: 10px; line-height: 1.45; margin-bottom: 2px; }
      .r-dlbl { font-weight: 700; display: inline-block; min-width: 108px; }
      .r-cli { border-bottom: 2px solid #000; }
      .r-cli-up { display: grid; grid-template-columns: 1.2fr 0.85fr; border-bottom: 1px solid #000; }
      .r-cli-left { padding: 8px 10px; border-right: 1px solid #000; }
      .r-cli-right { padding: 8px 10px; }
      .r-row { font-size: 10px; line-height: 1.45; margin-bottom: 4px; }
      .r-row:last-child { margin-bottom: 0; }
      .r-k { font-weight: 700; display: inline-block; min-width: 112px; }
      .r-cli-obs { padding: 6px 10px; font-size: 10px; border-bottom: 1px solid #000; line-height: 1.4; }
      .r-cli-low { display: grid; grid-template-columns: 1fr 1fr 1fr; }
      .r-c3 { border-right: 1px solid #000; padding: 6px 8px; min-height: 44px; }
      .r-c3:last-child { border-right: none; }
      .r-c3t { font-size: 9px; font-weight: 700; margin-bottom: 4px; }
      .r-c3v { font-size: 10px; line-height: 1.35; word-break: break-word; }
      .r-items-outer { position: relative; border-bottom: 2px solid #000; min-height: 120mm; }
      .r-wm-text {
        position: absolute;
        left: 50%;
        top: 48%;
        transform: translate(-50%, -50%) rotate(-18deg);
        font-size: 88px;
        font-weight: 800;
        color: #000;
        opacity: 0.06;
        pointer-events: none;
        z-index: 0;
        white-space: nowrap;
      }
      .r-wm-img {
        position: absolute;
        left: 50%;
        top: 48%;
        transform: translate(-50%, -50%) rotate(-14deg);
        max-width: 260px;
        max-height: 180px;
        width: auto;
        height: auto;
        object-fit: contain;
        opacity: 0.07;
        pointer-events: none;
        z-index: 0;
        filter: grayscale(100%);
      }
      table.r-items { position: relative; z-index: 1; width: 100%; border-collapse: collapse; font-size: 10px; }
      table.r-items thead th { border: 1px solid #000; padding: 6px 6px; font-weight: 700; text-align: left; background: #fff; }
      table.r-items tbody td { border: 1px solid #000; padding: 5px 6px; vertical-align: top; }
      .ri-c { text-align: center; }
      .ri-r { text-align: right; }
      .ri-code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 9px; }
      .ri-desc { text-align: left; word-break: break-word; overflow-wrap: anywhere; font-weight: 600; }
      .r-items-ley { position: relative; z-index: 1; text-align: center; font-size: 10px; font-weight: 700; padding: 8px 10px; border-top: 1px solid #000; }
      /* Variante "expreso" de la tabla: una sola fila con cantidad de bultos + descripción multi-línea. */
      .r-items-expreso tbody td { padding: 18px 14px; vertical-align: top; min-height: 110mm; }
      .ri-exp-qty { font-size: 26px; font-weight: 800; vertical-align: middle; }
      .ri-exp-desc { font-size: 14px; font-weight: 700; line-height: 1.7; letter-spacing: 0.02em; }
      .ri-exp-line { margin-bottom: 4px; }
      .ri-exp-line:last-child { margin-bottom: 0; }
      .ri-exp-lbl { font-weight: 800; margin-right: 4px; }
      .r-firma-row { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 2px solid #000; min-height: 72px; }
      .r-firma-cell { border-right: 1px solid #000; padding: 6px 8px; vertical-align: top; }
      .r-firma-cell:last-child { border-right: none; }
      .r-firma-t { font-size: 10px; font-weight: 800; margin-bottom: 6px; }
      .r-firma-b { font-size: 10px; line-height: 1.35; min-height: 36px; }
      .r-firma-sign { border-bottom: 1px solid #000; margin-top: 8px; max-width: 85%; }
      .r-cai { padding: 6px 10px 4px; font-size: 9px; line-height: 1.4; border-bottom: 1px solid #000; }
      .r-cai-muted { color: #444; }
      .r-micro { padding: 4px 8px 8px; font-size: 8px; color: #555; text-align: right; }
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

  /**
   * Genera el remito. Recién acá se consume un número de la secuencia (si el pedido todavía no tenía uno).
   *
   * Importante para preservar la regla "el contador solo avanza cuando el remito se imprime de verdad":
   *  - Si el pedido ya tiene `remitoNumber`, lo reutilizamos sin tocar la secuencia.
   *  - Si no, le pedimos al backend que asigne uno (operación atómica).
   *  - Si el usuario cancela el modal sin llegar acá, ningún número se consume.
   */
  const confirmRemito = async () => {
    if (!remitoOrder) return;
    setRemitoNumberLoading(true);
    let docNro = (remitoDocumentNumber || '').trim();
    let updatedOrder: Order | null = null;
    try {
      if (!docNro) {
        const res = await api.assignRemitoNumber(remitoOrder.id);
        docNro = String(res.remitoNumber);
        setRemitoDocumentNumber(docNro);
        updatedOrder = { ...remitoOrder, remitoNumber: res.remitoNumber };
        setRemitoOrder(updatedOrder);
      }
    } catch (err: any) {
      setRemitoNumberLoading(false);
      showToast('error', err?.response?.data?.message || err?.message || 'No se pudo asignar el N° de remito');
      return;
    }
    setRemitoNumberLoading(false);

    if (!docNro) {
      showToast('error', 'No se pudo obtener un N° de remito. Reintentá en unos segundos.');
      return;
    }

    const bultosVal = remitoBultos.trim() ? remitoBultos : null;
    const orderForHtml = updatedOrder || remitoOrder;
    const html = buildRemitoHtml(orderForHtml, docNro, bultosVal, remitoDescripcion.trim() || null, {
      transporteId: remitoTransporteId || undefined,
      entregaId: remitoEntregaId || REMITO_ENTREGA_PRINCIPAL,
    });
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
    }
    setRemitoOrder(null);
    setRemitoTransporteId('');
    setRemitoEntregaId(REMITO_ENTREGA_PRINCIPAL);
    setRemitoBultos('');
    setRemitoDescripcion('');
    setRemitoDocumentNumber('');
  };

  /** Abre el modal para asignar despachos a los ítems del pedido que están en NULL. */
  const openAssignDespachosModal = async (order: Order, e: React.MouseEvent) => {
    e.stopPropagation();
    setAssignDespachosOrder(order);
    setAssignDespachosLoading(true);
    setAssignDespachosByItem({});
    try {
      const [items, despachos] = await Promise.all([
        api.getOrderItemsMissingDespacho(order.id),
        api.getDespachos({ limit: 500 })
      ]);
      setAssignDespachosItems(items || []);
      setAssignDespachosCatalog((despachos?.despachos || []).map((d: any) => ({
        id: d.id,
        numero_despacho: d.numero_despacho ?? d.numeroDespacho ?? '',
        pais_origen: d.pais_origen ?? d.paisOrigen ?? null,
        fecha_despacho: d.fecha_despacho ?? d.fechaDespacho ?? null
      })));
      const init: Record<string, { mode: 'existing' | 'new'; despachoId: string; numeroDespacho: string; paisOrigen: string; fechaDespacho: string }> = {};
      for (const it of items || []) {
        init[it.orderItemId] = {
          mode: it.productLastDespachoId ? 'existing' : 'new',
          despachoId: it.productLastDespachoId || '',
          numeroDespacho: '',
          paisOrigen: '',
          fechaDespacho: ''
        };
      }
      setAssignDespachosByItem(init);
    } catch (err: any) {
      showToast('error', err?.response?.data?.message || err?.message || 'Error cargando ítems sin despacho.');
      setAssignDespachosOrder(null);
    } finally {
      setAssignDespachosLoading(false);
    }
  };

  const closeAssignDespachosModal = () => {
    if (assignDespachosSaving) return;
    setAssignDespachosOrder(null);
    setAssignDespachosItems([]);
    setAssignDespachosByItem({});
    setAssignDespachosCatalog([]);
  };

  /** Aplica las asignaciones elegidas y refresca el pedido para que aparezcan los despachos en el remito/factura. */
  const confirmAssignDespachos = async () => {
    if (!assignDespachosOrder) return;
    const orderId = assignDespachosOrder.id;
    const assignments: Array<{ orderItemId: string; despachoId?: string; numeroDespacho?: string; paisOrigen?: string; fechaDespacho?: string }> = [];
    const validationErrors: string[] = [];
    for (const it of assignDespachosItems) {
      const sel = assignDespachosByItem[it.orderItemId];
      const label = `${it.productName || it.sku || it.orderItemId}${it.sizeCode || it.colorName ? ` (${[it.sizeCode, it.colorName].filter(Boolean).join(' / ')})` : ''}`;
      if (!sel) {
        validationErrors.push(`Falta asignar despacho a ${label}.`);
        continue;
      }
      if (sel.mode === 'existing') {
        if (!sel.despachoId) {
          validationErrors.push(`Falta elegir despacho para ${label}.`);
          continue;
        }
        assignments.push({ orderItemId: it.orderItemId, despachoId: sel.despachoId });
      } else {
        const numero = sel.numeroDespacho.trim();
        if (!numero) {
          validationErrors.push(`Ingresá el número de despacho para ${label}.`);
          continue;
        }
        assignments.push({
          orderItemId: it.orderItemId,
          numeroDespacho: numero,
          paisOrigen: sel.paisOrigen.trim() || undefined,
          fechaDespacho: sel.fechaDespacho.trim() || undefined
        });
      }
    }
    if (validationErrors.length > 0) {
      showToast('error', validationErrors[0]);
      return;
    }
    if (assignments.length === 0) {
      showToast('warning', 'No hay asignaciones para aplicar.');
      return;
    }
    setAssignDespachosSaving(true);
    try {
      const res = await api.assignDespachosToOrderItems(orderId, assignments);
      const appliedCount = res?.applied?.length || 0;
      const errs = res?.errors || [];
      if (appliedCount > 0) {
        showToast('success', `Se actualizaron ${appliedCount} ítem(s). Re-imprimí el remito/factura para que muestren los despachos.`);
      }
      if (errs.length > 0) {
        showToast('error', errs[0]);
      }
      await refreshOrders?.();
      closeAssignDespachosModal();
    } catch (err: any) {
      showToast('error', err?.response?.data?.message || err?.message || 'Error al asignar despachos.');
    } finally {
      setAssignDespachosSaving(false);
    }
  };

  const mergedRemitenteForFactura = () => {
    const localRemitente = getRemitente();
    const mergeSoft = (base: any, extra: any): any => {
      if (!extra) return { ...base };
      const out: any = { ...base };
      for (const k of Object.keys(extra)) {
        const v = (extra as any)[k];
        if (v === undefined || v === null) continue;
        if (typeof v === 'string' && v.trim() === '') continue;
        out[k] = v;
      }
      return out;
    };
    let merged: any = mergeSoft(localRemitente, remitenteFromApi);
    if (issuerFromApi && (issuerFromApi.businessName || issuerFromApi.cuit)) {
      merged = mergeSoft(merged, issuerFromApi);
    }
    merged.logoUrl = localRemitente.logoUrl;
    return merged;
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
    // Si el pedido ya tiene un N° de remito generado, lo precargamos automáticamente.
    // Solo dejamos prevalecer lo que el usuario tipeó antes (`prev?.remitoNumber`) si efectivamente
    // ingresó algo distinto al default del cliente; un valor vacío en `manual` no debe pisar el
    // remito real del pedido.
    const manualRemitoTyped = (manual.remitoNumber ?? '').toString().trim();
    const orderRemito = order.remitoNumber != null ? String(order.remitoNumber) : '';
    setFacturaRemitoNumber(manualRemitoTyped || orderRemito);
    setFacturaSaleCondition(String(manual.saleCondition ?? '').toLowerCase().includes('60') ? '60 días' : '30 días');
    setFacturaTransporteId(pickInitialTransporteId(prev, transporteOpts));
  };

  const confirmOpenFactura = async () => {
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
    let orderForPdf: Order = facturaPreviewOrder;
    try {
      const latestInv = await api.getOrderInvoice(facturaPreviewOrder.id);
      if (latestInv) {
        orderForPdf = mergeServerInvoiceIntoOrder(facturaPreviewOrder, latestInv as Record<string, unknown>);
      }
    } catch {
      /* usar factura en memoria */
    }
    const html = buildFacturaHtml(orderForPdf, manual);
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
      // El backend ya consolida varias filas de credit_notes que comparten CAE en
      // una sola entrada con itemIndexes/amountByItemIndex/quantityByItemIndex.
      // Tomamos la más reciente.
      const sorted = [...notes].sort((a, b) => {
        const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return db - da;
      });
      const nc = sorted[0];
      if (!nc) {
        showToast('info', 'No hay notas de crédito para este pedido');
        return;
      }
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
            = borrador o pendiente de admin (sin impacto de stock); naranja = confirmado pero el movimiento de stock todavía no se aplicó; gris = cancelado;
            <strong className="text-orange-300/90"> naranja intenso (doble señal)</strong> = el comprobante AFIP del pedido sigue anulado por una <strong className="text-slate-300">NC por el total</strong> sin factura nueva registrada (o datos viejos sin migración).
            Si ya reemitiste con IIBB y sigue en naranja, en MySQL podés marcar la NC como reemplazada: <code className="text-slate-400 bg-slate-900/80 px-1 rounded">UPDATE credit_notes SET superseded_by_reinvoice = 1 WHERE order_id = '…' AND scope = 'total' LIMIT 1;</code>.
            En la fila de chips, <strong className="text-amber-200/90">ámbar “Con IIBB”</strong> indica que en la factura guardada figura percepción de ingresos brutos; <strong className="text-slate-400">gris “Sin percepción IIBB”</strong> = facturado AFIP pero sin ese importe en el comprobante (0 o no cargado).
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
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
          <input
            type="search"
            enterKeyHint="search"
            value={customerSearchQuery}
            onChange={(e) => setCustomerSearchQuery(e.target.value)}
            placeholder="Buscar por cliente o nº de pedido…"
            autoComplete="off"
            className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-sm rounded-xl py-3 pl-10 pr-10 outline-none placeholder:text-slate-500 focus:border-slate-600 focus:ring-1 focus:ring-slate-600"
            aria-label="Buscar pedidos por cliente o número de pedido"
          />
          {customerSearchQuery.trim() !== '' && (
            <button
              type="button"
              onClick={() => setCustomerSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
              title="Limpiar búsqueda"
              aria-label="Limpiar búsqueda"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs font-semibold text-slate-500 uppercase shrink-0">Comprobante AFIP:</span>
            {(
              [
                { key: 'all' as const, label: 'Todos' },
                { key: 'uninvoiced' as const, label: 'Sin facturar' },
                { key: 'invoiced' as const, label: 'Facturados' },
              ] as const
            ).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setInvoiceFilter(key)}
                className={`px-3 py-2 rounded-xl text-sm font-semibold border transition touch-manipulation min-h-[40px] ${
                  invoiceFilter === key
                    ? 'bg-emerald-800/90 text-white border-emerald-600 shadow-md shadow-emerald-950/30'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-750'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs font-semibold text-slate-500 uppercase shrink-0">Ingresos brutos (solo ya facturados):</span>
            {(
              [
                { key: 'invoiced_with_iibb' as const, label: 'Con percepción IIBB' },
                { key: 'invoiced_no_iibb' as const, label: 'Sin percepción IIBB' },
              ] as const
            ).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setInvoiceFilter(key)}
                className={`px-3 py-2 rounded-xl text-sm font-semibold border transition touch-manipulation min-h-[40px] ${
                  invoiceFilter === key
                    ? 'bg-amber-900/85 text-amber-50 border-amber-600 shadow-md shadow-amber-950/25'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-750'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
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
          /** Permite hacer click en la tarjeta y abrir el detalle. Si el pedido está facturado, el editor se abre en modo solo lectura. */
          const canOpenOrder = canEditOrderBase;
          /** Permite editar (modificar). Se sigue bloqueando cuando ya hay factura emitida. */
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
          const activeTotalVoid =
            order.creditNotesActiveTotalVoidCount != null
              ? Number(order.creditNotesActiveTotalVoidCount)
              : Number(order.creditNotesTotalCount || 0);
          const ncTotalAnnulled = activeTotalVoid > 0;
          const agipOnInvoice = order.invoice ? orderInvoiceApplicableAgip(order) : null;
          const cardAccentClass = ncTotalAnnulled ? 'border-l-[5px] border-orange-500' : stockImpact.cardAccentClass;

          return (
            <div 
              key={order.id} 
              onClick={() => canOpenOrder && onEditOrder?.(order)}
              className={`bg-slate-800 rounded-2xl border border-slate-700 p-4 md:p-5 transition-all group shadow-sm active:bg-slate-750 ${
                ncTotalAnnulled
                  ? 'opacity-[0.93] ring-2 ring-orange-900/45 ring-inset bg-slate-900/50'
                  : ''
              } ${
                canOpenOrder
                  ? ncTotalAnnulled
                    ? 'hover:border-orange-600/70 cursor-pointer'
                    : 'hover:border-blue-500 cursor-pointer'
                  : 'cursor-default'
              } touch-manipulation ${cardAccentClass}`}
            >
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
                <div className="space-y-1 min-w-0 flex-1">
                  <h3 className={`text-lg sm:text-xl font-black leading-tight break-words line-clamp-2 sm:line-clamp-1 ${ncTotalAnnulled ? 'text-slate-400 line-through decoration-slate-600 decoration-2' : 'text-white'}`}>
                    {order.customerBusinessName || customer?.businessName || customer?.name || 'Cliente desconocido'}
                  </h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-400">#{order.id}</span>
                    <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider ${getStatusColor(order.status)}`}>
                      {order.status}
                    </span>
                    {hasBackorders && (
                      <span className="bg-red-950/45 text-red-300 border border-red-800/45 px-2 py-0.5 rounded-lg text-[10px] font-bold inline-flex items-center gap-1">
                        <AlertCircle size={10} aria-hidden />
                        Pendientes stock
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
                    {ncTotalAnnulled ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full border border-orange-700/60 bg-orange-950/70 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-orange-100"
                        title={[
                          'La factura del pedido fue anulada fiscalmente en AFIP mediante nota(s) de crédito por el total.',
                          order.invoice
                            ? `Comprobante original: CAE ${order.invoice.cae} (${order.invoice.puntoVta != null ? `${order.invoice.puntoVta}-` : ''}${order.invoice.cbteDesde}).`
                            : '',
                          agipOnInvoice
                            ? `Ese comprobante registraba percepción IIBB: ${agipOnInvoice.alicuota.toFixed(2)}% ($${formatMoneyAr(agipOnInvoice.retPer)}).`
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <FileMinus size={12} className="shrink-0 text-orange-300" aria-hidden />
                        Anulado fiscal · NC total ({order.creditNotesTotalCount})
                      </span>
                    ) : order.invoice ? (
                      <>
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-emerald-700/50 bg-emerald-950/65 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-emerald-100 cursor-help"
                          title={
                            [
                              'Factura AFIP emitida.',
                              `CAE: ${order.invoice.cae}`,
                              order.invoice.puntoVta != null ? `Nº: ${order.invoice.puntoVta}-${order.invoice.cbteDesde}` : `Nº: ${order.invoice.cbteDesde}`,
                              order.invoice.caeFchVto ? `Vto. CAE: ${new Date(order.invoice.caeFchVto).toLocaleDateString('es-AR')}` : '',
                              'Consultá en ARCA/AFIP con tu CUIT y este CAE.',
                            ]
                              .filter(Boolean)
                              .join('\n')
                          }
                        >
                          <Receipt size={12} className="shrink-0 text-emerald-300" aria-hidden />
                          Facturado AFIP
                        </span>
                        {(() => {
                          const agip = agipOnInvoice;
                          if (agip) {
                            return (
                              <span
                                className="inline-flex items-center gap-1 rounded-full border border-amber-700/50 bg-amber-950/60 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-100 cursor-help"
                                title={`Percepción de ingresos brutos en el comprobante guardado: alícuota ${agip.alicuota.toFixed(2)}%, importe $${formatMoneyAr(agip.retPer)}.`}
                              >
                                <Percent size={12} className="shrink-0 text-amber-300" aria-hidden />
                                Con IIBB
                                {agip.alicuota > 0.005 ? ` (${agip.alicuota.toFixed(2)}%)` : ''}
                              </span>
                            );
                          }
                          return (
                            <span
                              className="inline-flex items-center gap-1 rounded-full border border-slate-600/75 bg-slate-900/70 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400 cursor-help"
                              title="Factura AFIP sin percepción de ingresos brutos en los datos guardados (importe 0 o no informado). Si el cliente debe retención según AGIP, recalculá IIBB o reemití con IIBB desde las acciones de la tarjeta."
                            >
                              <Percent size={12} className="shrink-0 text-slate-500 opacity-80" aria-hidden />
                              Sin percepción IIBB
                            </span>
                          );
                        })()}
                      </>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 rounded-full border border-slate-600/80 bg-slate-900/80 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400"
                        title="Este pedido todavía no tiene comprobante AFIP guardado (sin factura emitida desde el sistema)."
                      >
                        <Receipt size={12} className="shrink-0 text-slate-500" aria-hidden />
                        Sin facturar AFIP
                      </span>
                    )}
                    {stockImpact.label && (
                      <span
                        className={`inline-flex items-center gap-1 cursor-help ${
                          stockImpact.variant === 'pending' || stockImpact.variant === 'not_applied'
                            ? 'text-amber-200/95'
                            : 'text-slate-400'
                        }`}
                        title={stockImpact.title}
                      >
                        {stockImpact.variant === 'no_impact' && <Package size={12} className="shrink-0 opacity-70" aria-hidden />}
                        {stockImpact.variant === 'pending' && <Clock size={12} className="shrink-0 opacity-70" aria-hidden />}
                        {stockImpact.variant === 'deducted' && <PackageCheck size={12} className="shrink-0 opacity-70" aria-hidden />}
                        {stockImpact.variant === 'not_applied' && <AlertTriangle size={12} className="shrink-0 opacity-70" aria-hidden />}
                        <span className="font-medium">{stockImpact.label}</span>
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
                                  showToast(
                                    'success',
                                    next === 'pagado' ? 'Pedido marcado como cobrado.' : 'Pedido marcado como pendiente de cobro.'
                                  );
                                  refreshOrders?.();
                                })
                                .catch((err: any) => showToast('error', err?.message || 'No se pudo actualizar el cobro.'));
                            },
                          });
                        }}
                        className={`inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-left font-medium transition touch-manipulation hover:bg-slate-700/45 ${
                          (order.paymentStatus ?? 'pagado') === 'pendiente' ? 'text-amber-200' : 'text-slate-400'
                        }`}
                        title="Cuenta corriente: tocá para alternar cobro pendiente / cobrado"
                      >
                        <Wallet size={12} className="shrink-0 opacity-80" aria-hidden />
                        {(order.paymentStatus ?? 'pagado') === 'pendiente' ? 'Cobro pendiente' : 'Cobro registrado'}
                      </button>
                    )}
                    {Number(order.creditNotesTotalCount || 0) === 0 && Number(order.creditNotesItemCount || 0) > 0 && (
                      <span className="inline-flex items-center gap-1 text-slate-400">
                        <FileMinus size={12} className="shrink-0 opacity-80" aria-hidden />
                        <span className="font-medium">NC parcial ({order.creditNotesItemCount})</span>
                      </span>
                    )}
                  </div>
                  {!ncTotalAnnulled &&
                    Number(order.creditNotesTotalCount || 0) > 0 &&
                    order.lastTotalCreditNoteFiscal && (
                      <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1.5 rounded-xl border border-slate-700/80 bg-slate-900/40 px-2.5 py-2 text-[10px] text-slate-300">
                        <span className="font-bold text-slate-500 uppercase tracking-wide shrink-0">
                          Secuencia fiscal
                        </span>
                        {order.lastTotalCreditNoteFiscal.voidedInvoice && (
                          <>
                            <span
                              className="rounded-md border border-slate-600/70 bg-slate-800/80 px-2 py-0.5 font-mono"
                              title={`Factura anulada en AFIP por la NC. CAE ${order.lastTotalCreditNoteFiscal.voidedInvoice.cae}`}
                            >
                              Fact. previa{' '}
                              {formatAfipDocLine(
                                order.lastTotalCreditNoteFiscal.voidedInvoice.puntoVta,
                                order.lastTotalCreditNoteFiscal.voidedInvoice.cbteDesde,
                                order.lastTotalCreditNoteFiscal.voidedInvoice.cbteTipo
                              )}
                            </span>
                            <ArrowRight size={12} className="shrink-0 text-slate-600" aria-hidden />
                          </>
                        )}
                        <span
                          className="rounded-md border border-violet-800/50 bg-violet-950/50 px-2 py-0.5 font-mono text-violet-100"
                          title={`Nota de crédito AFIP. CAE ${order.lastTotalCreditNoteFiscal.creditNote.cae}`}
                        >
                          NC{' '}
                          {formatAfipDocLine(
                            order.lastTotalCreditNoteFiscal.creditNote.puntoVta,
                            order.lastTotalCreditNoteFiscal.creditNote.cbteDesde,
                            order.lastTotalCreditNoteFiscal.creditNote.cbteTipo
                          )}
                        </span>
                        <ArrowRight size={12} className="shrink-0 text-slate-600" aria-hidden />
                        <span
                          className="rounded-md border border-emerald-800/45 bg-emerald-950/40 px-2 py-0.5 font-mono text-emerald-100"
                          title={
                            order.invoice
                              ? `Comprobante vigente en el pedido. CAE ${order.invoice.cae}`
                              : 'Sin factura en el pedido'
                          }
                        >
                          Fact. vigente{' '}
                          {order.invoice
                            ? formatAfipDocLine(order.invoice.puntoVta, order.invoice.cbteDesde, order.invoice.cbteTipo)
                            : '—'}
                        </span>
                        {order.lastTotalCreditNoteFiscal.supersededByReinvoice && (
                          <span className="text-[9px] font-medium text-slate-500 normal-case">
                            (NC + nueva factura con IIBB)
                          </span>
                        )}
                      </div>
                    )}
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
                <div className="flex flex-wrap items-end justify-end gap-y-1 gap-x-0.5 self-end sm:self-auto max-w-full sm:max-w-[min(100%,560px)] border-t border-slate-700/40 sm:border-0 pt-2 sm:pt-0 mt-1 sm:mt-0">
                  {afipConfigured && canEmitirFactura && !order.invoice && (() => {
                    const tipoFactura = getTipoFacturaParaCliente(order);
                    return (
                    <>
                      <OrderCardActionButton
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
                        title={`Emitir factura AFIP (Factura ${tipoFactura} según el cliente)`}
                        icon={emitiendoFacturaId === order.id ? <Clock size={16} className="animate-pulse" /> : <Receipt size={16} />}
                        label="Emitir AFIP"
                      />
                      <OrderCardActionButton
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
                        title="Emitir factura sin descontar stock en el pedido"
                        icon={<Package size={16} />}
                        label="Sin stock"
                      />
                    </>
                    );
                  })()}
                  <OrderCardActionButton
                    onClick={(e) => openRemitoModal(order, e)}
                    title="Generar remito (despacho) en PDF"
                    icon={<FileText size={16} />}
                    label="Remito"
                  />
                  {(order.items || []).some((it: any) => !it?.despachoId) && (
                    <div className="relative shrink-0">
                      <OrderCardActionButton
                        onClick={(e) => openAssignDespachosModal(order, e)}
                        title="Hay artículos sin despacho asignado"
                        icon={<Ship size={16} />}
                        label="Despacho"
                      />
                      <span className="pointer-events-none absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-400" aria-hidden />
                    </div>
                  )}
                  {role !== Role.CUSTOMER &&
                    !order.noStockImpact &&
                    order.status !== OrderStatus.CANCELLED &&
                    order.mayoristaStockApplied !== true && (
                      <OrderCardActionButton
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
                        title="Descontar stock del pedido en inventario"
                        icon={
                          applyingMayoristaStockId === order.id ? (
                            <Loader2 size={16} className="animate-spin text-cyan-400" />
                          ) : (
                            <ArrowDownToLine size={16} />
                          )
                        }
                        label="Descontar"
                      />
                    )}
                  {order.invoice && (
                    <>
                      <OrderCardActionButton
                        onClick={(e) => openFactura(order, e)}
                        title="Datos de transporte y abrir factura en PDF"
                        icon={<Receipt size={16} />}
                        label="Factura PDF"
                      />
                      {canEmitirFactura && orderInvoiceApplicableAgip(order) && (
                        <OrderCardActionButton
                          onClick={(e) => {
                            e.stopPropagation();
                            showConfirm({
                              title: 'Guardar IIBB en esta factura (PDF)',
                              message:
                                'Se recalcula la percepción con el padrón AGIP y el neto del pedido y se guarda en el sistema. Al reabrir el PDF verás percepción y total actualizados. El CAE en AFIP no cambia: si el contador te pide registrar el tributo en ARCA, puede ser con otro comprobante (p. ej. nota de débito).',
                              confirmLabel: 'Guardar IIBB',
                              onConfirm: () => {
                                setRecalculatingAgipOrderId(order.id);
                                api
                                  .recalculateStoredInvoiceAgip(order.id)
                                  .then((r: { message?: string }) => {
                                    showToast('success', r?.message || 'IIBB actualizado. Reabrí la factura para ver el PDF.');
                                    refreshOrders?.();
                                  })
                                  .catch((err: any) =>
                                    showToast('error', err?.response?.data?.message || err?.message || 'No se pudo actualizar IIBB')
                                  )
                                  .finally(() => setRecalculatingAgipOrderId(null));
                              }
                            });
                          }}
                          disabled={recalculatingAgipOrderId === order.id}
                          title="Guardar percepción IIBB en el PDF (no cambia el CAE en AFIP)"
                          icon={
                            recalculatingAgipOrderId === order.id ? (
                              <Loader2 size={16} className="animate-spin text-amber-400" />
                            ) : (
                              <Percent size={16} />
                            )
                          }
                          label="IIBB PDF"
                        />
                      )}
                      {canEmitirFactura &&
                        orderInvoiceApplicableAgip(order) &&
                        Number(order.creditNotesCount || 0) === 0 && (
                        <OrderCardActionButton
                          onClick={(e) => {
                            e.stopPropagation();
                            showConfirm({
                              title: 'Nuevo CAE con IIBB en AFIP',
                              message:
                                'Se emitirá en AFIP una nota de crédito por el total del pedido (anula fiscalmente la factura actual) y enseguida una nueva factura con percepción IIBB según el padrón AGIP. El inventario no se modifica (no se revierte stock). Solo disponible si el pedido no tiene notas de crédito previas. ¿Continuar?',
                              confirmLabel: 'Reemitir con IIBB',
                              onConfirm: () => {
                                setReemittingInvoiceOrderId(order.id);
                                api
                                  .reemitirFacturaConAgip(order.id)
                                  .then((r: any) => {
                                    const inv = r?.invoice;
                                    if (inv && typeof inv === 'object') {
                                      onFacturaEmitida?.(order.id, {
                                        cae: String(inv.cae ?? ''),
                                        caeFchVto: inv.caeFchVto,
                                        cbteDesde: Number(inv.cbteDesde),
                                        cbteHasta: Number(inv.cbteHasta),
                                        cbteTipo: Number(inv.cbteTipo),
                                        puntoVta: inv.puntoVta != null ? Number(inv.puntoVta) : undefined,
                                        agipAlicuota: Number(inv.agipAlicuota ?? 0),
                                        agipRetPer: Number(inv.agipRetPer ?? 0)
                                      });
                                    }
                                    onCreditNoteEmitida?.(order.id);
                                    showToast('success', r?.message || 'Factura reemitida con nuevo CAE e IIBB en AFIP.');
                                    refreshOrders?.();
                                  })
                                  .catch((err: any) => {
                                    const d = err?.response?.data;
                                    const base =
                                      d?.message || err?.message || 'No se pudo reemitir la factura con IIBB';
                                    const extra = d?.creditNoteEmitted
                                      ? ` NC emitida (CAE ${d?.creditNote?.cae ?? '—'}). ${d?.detail ? String(d.detail) : ''}`
                                      : '';
                                    showToast('error', `${base}${extra ? ` — ${extra}` : ''}`);
                                    refreshOrders?.();
                                  })
                                  .finally(() => setReemittingInvoiceOrderId(null));
                              }
                            });
                          }}
                          disabled={reemittingInvoiceOrderId === order.id}
                          title="NC total + nueva factura con IIBB (nuevo CAE). Sin tocar stock."
                          icon={
                            reemittingInvoiceOrderId === order.id ? (
                              <Loader2 size={16} className="animate-spin text-sky-400" />
                            ) : (
                              <RefreshCcw size={16} />
                            )
                          }
                          label="Reemitir"
                        />
                      )}
                    </>
                  )}
                  {Number(order.creditNotesCount || 0) > 0 && (
                    <OrderCardActionButton
                      onClick={(e) => openNotaCredito(order, e)}
                      title="Ver notas de crédito y descargar PDF"
                      icon={<FileMinus size={16} />}
                      label="Ver NC"
                    />
                  )}
                  {order.invoice && afipConfigured && (
                    <OrderCardActionButton
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
                      title="Consultar en AFIP si el comprobante existe"
                      icon={
                        verificandoAfipOrderId === order.id ? (
                          <Loader2 size={14} className="animate-spin text-sky-400" />
                        ) : (
                          <CheckCircle size={16} />
                        )
                      }
                      label="Verificar"
                    />
                  )}
                  {order.invoice && afipConfigured && canEmitirFactura && (
                    <OrderCardActionButton
                      onClick={(e) => {
                        e.stopPropagation();
                        setNcOrder(order);
                        setNcTipo('total');
                        setNcItemIndex(0);
                        setNcQuantity(order.items[0]?.quantity ?? 1);
                        setNcItemsQuantities({});
                      }}
                      title="Emitir nota de crédito AFIP (total o por artículo)"
                      icon={<FileMinus size={16} />}
                      label="Emitir NC"
                    />
                  )}
                  <OrderCardActionButton
                    onClick={(e) => exportOneOrderToExcel(order, e)}
                    title="Exportar pedido a Excel"
                    icon={<FileSpreadsheet size={16} />}
                    label="Excel"
                  />
                  {canCancelOrder(order) && (
                    <OrderCardActionButton
                      variant="danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        showConfirm({
                          title: 'Cancelar pedido',
                          message: '¿Cancelar este pedido? Se restaurará el stock.',
                          confirmLabel: 'Cancelar pedido',
                          onConfirm: () => onUpdateStatus(order.id, OrderStatus.CANCELLED),
                        });
                      }}
                      title="Cancelar pedido y restaurar stock"
                      icon={<XCircle size={16} />}
                      label="Anular"
                    />
                  )}
                  {role === Role.ADMIN && !order.invoice && (
                    <OrderCardActionButton
                      variant="danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        showConfirm({
                          title: 'Eliminar pedido',
                          message: '¿Eliminar pedido? Esta acción no se puede deshacer.',
                          confirmLabel: 'Eliminar',
                          onConfirm: () => onDeleteOrder?.(order.id),
                        });
                      }}
                      title="Eliminar pedido definitivamente"
                      icon={<Trash2 size={16} />}
                      label="Borrar"
                    />
                  )}
                  {refreshOrders && (role === Role.ADMIN || role === Role.WAREHOUSE || role === Role.DEPOSITO) && (
                    order.archived ? (
                      <OrderCardActionButton
                        onClick={(e) => {
                          e.stopPropagation();
                          setArchivingOrderId(order.id);
                          api
                            .archiveOrder(order.id, false)
                            .then(() => {
                              refreshOrders();
                              showToast('success', 'Pedido desarchivado');
                            })
                            .catch((err: any) => showToast('error', err?.message || 'Error'))
                            .finally(() => setArchivingOrderId(null));
                        }}
                        disabled={!!archivingOrderId}
                        title="Volver a mostrar el pedido en la lista activa"
                        icon={archivingOrderId === order.id ? <Clock size={16} className="animate-pulse" /> : <ArchiveRestore size={16} />}
                        label="Desarchivar"
                      />
                    ) : (
                      <OrderCardActionButton
                        onClick={(e) => {
                          e.stopPropagation();
                          setArchivingOrderId(order.id);
                          api
                            .archiveOrder(order.id, true)
                            .then(() => {
                              refreshOrders();
                              showToast('success', 'Pedido archivado');
                            })
                            .catch((err: any) => showToast('error', err?.message || 'Error'))
                            .finally(() => setArchivingOrderId(null));
                        }}
                        disabled={!!archivingOrderId}
                        title="Ocultar el pedido de la lista principal"
                        icon={archivingOrderId === order.id ? <Clock size={16} className="animate-pulse" /> : <Archive size={16} />}
                        label="Archivar"
                      />
                    )
                  )}
                  {canOpenOrder && (
                    <div className="flex flex-col items-center justify-center pl-1 text-slate-600" title="Abrir pedido">
                      <ChevronRight size={20} className="group-hover:text-blue-400 transition-colors" />
                      <span className="text-[9px] font-semibold text-slate-600 group-hover:text-slate-400 mt-0.5">Abrir</span>
                    </div>
                  )}
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
                   <div className={`text-right ml-auto sm:ml-0 ${ncTotalAnnulled ? 'opacity-55' : ''}`}>
                     <div className="text-lg font-black text-blue-400">${formatMoneyAr(orderNetoFromItems(order))}</div>
                     <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Neto (sin IVA)</div>
                     {order.invoice &&
                       (() => {
                         const agip = orderInvoiceApplicableAgip(order);
                         if (!agip) return null;
                         const neto = orderNetoFromItems(order);
                         const { impTotal } = afipDesdeNeto(neto);
                         const totalConIvaEIibb = Math.round((impTotal + agip.retPer) * 100) / 100;
                         return (
                           <div className="mt-1.5 space-y-0.5 text-right">
                             <div className="text-[11px] text-amber-200/95">
                               IIBB
                               {agip.alicuota > 0.005 ? ` (${agip.alicuota.toFixed(2)}%)` : ''}:{' '}
                               <span className="font-mono font-bold">${formatMoneyAr(agip.retPer)}</span>
                             </div>
                             <div className="text-[11px] font-bold text-slate-200">
                               Total c/ IVA e IIBB:{' '}
                               <span className="text-emerald-300">${formatMoneyAr(totalConIvaEIibb)}</span>
                             </div>
                           </div>
                         );
                       })()}
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
                {facturaPreviewOrder?.remitoNumber != null && String(facturaPreviewOrder.remitoNumber) === facturaRemitoNumber && (
                  <p className="text-[11px] text-emerald-400/90 mt-1">
                    Vinculado automáticamente al remito generado para este pedido.
                  </p>
                )}
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
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => { setRemitoOrder(null); setRemitoTransporteId(''); setRemitoEntregaId(REMITO_ENTREGA_PRINCIPAL); setRemitoBultos(''); setRemitoDescripcion(''); setRemitoDocumentNumber(''); }}>
            <div className="bg-slate-800 rounded-2xl border border-slate-700 shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-white mb-1">Generar remito</h3>
              <p className="text-sm text-slate-400 mb-4">Pedido #{remitoOrder.id} — {remitoOrder.customerBusinessName || customer?.businessName || customer?.name || 'Cliente'}</p>
              <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">N° Remito (asignado automáticamente)</label>
              <div className="relative mb-1">
                <input
                  type="text"
                  value={remitoDocumentNumber}
                  readOnly
                  placeholder={remitoNumberLoading ? 'Asignando número…' : 'Se asignará al generar el remito'}
                  className="w-full bg-slate-900/60 border border-slate-700 rounded-xl p-3 text-white font-mono cursor-not-allowed outline-none placeholder-slate-500"
                />
                {remitoNumberLoading && (
                  <Loader2 size={18} className="animate-spin text-amber-400 absolute right-3 top-1/2 -translate-y-1/2" />
                )}
              </div>
              <p className="text-[11px] text-slate-500 mb-4">
                {remitoDocumentNumber
                  ? 'Este pedido ya tiene un N° asignado: se reutiliza para reimpresiones.'
                  : 'El N° único se asigna recién al hacer click en "Generar remito" (no se consume si cancelás).'}
              </p>
              <label className="block text-xs font-semibold text-slate-400 uppercase mb-2">Transporte para este envío</label>
              <select
                value={remitoTransporteId}
                onChange={(e) => setRemitoTransporteId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-xl p-3 text-white focus:ring-2 focus:ring-amber-500 outline-none mb-3"
              >
                <option value="">— No especificado</option>
                {transportesOpciones.map(t => (
                  <option key={t.id} value={t.id}>{t.name}{t.address ? ` — ${t.address}` : ''}</option>
                ))}
              </select>
              <label className="block text-xs font-semibold text-slate-400 uppercase mb-2">Dirección de entrega en el remito</label>
              <select
                value={remitoEntregaId}
                onChange={(e) => setRemitoEntregaId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-xl p-3 text-white focus:ring-2 focus:ring-amber-500 outline-none mb-4"
              >
                <option value={REMITO_ENTREGA_PRINCIPAL}>
                  Principal{customer?.address ? ` — ${customer.address}${customer?.city ? `, ${customer.city}` : ''}` : ''}
                </option>
                {(customer?.deliveryAddresses ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}: {d.address}{d.city ? `, ${d.city}` : ''}
                  </option>
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
                <button type="button" onClick={() => { setRemitoOrder(null); setRemitoTransporteId(''); setRemitoEntregaId(REMITO_ENTREGA_PRINCIPAL); setRemitoBultos(''); setRemitoDescripcion(''); setRemitoDocumentNumber(''); }} className="px-4 py-2.5 rounded-xl font-semibold text-slate-400 hover:bg-slate-700 transition">Cancelar</button>
                <button
                  type="button"
                  onClick={confirmRemito}
                  disabled={remitoNumberLoading}
                  className="px-5 py-2.5 rounded-xl font-bold bg-amber-600 hover:bg-amber-500 text-white flex items-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {remitoNumberLoading ? <Loader2 size={18} className="animate-spin" /> : <FileText size={18} />}
                  {remitoNumberLoading ? 'Asignando N°…' : 'Generar remito'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal: asignar despachos faltantes a los ítems del pedido */}
      {assignDespachosOrder && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={closeAssignDespachosModal}
        >
          <div
            className="bg-slate-800 rounded-2xl border border-slate-700 shadow-xl w-full max-w-3xl p-6 max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-1">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Ship size={18} className="text-amber-400" />
                  Asignar despachos faltantes
                </h3>
                <p className="text-sm text-slate-400">
                  Pedido #{assignDespachosOrder.id} — {assignDespachosOrder.customerBusinessName || getCustomerName(assignDespachosOrder)}
                </p>
              </div>
              <button
                type="button"
                onClick={closeAssignDespachosModal}
                disabled={assignDespachosSaving}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition disabled:opacity-50"
                aria-label="Cerrar"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-xs text-amber-200/90 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 mb-4 leading-relaxed">
              Al asignar despachos se actualiza el pedido para que aparezcan en remito/factura impresos.
              El comprobante AFIP ya emitido (CAE) no cambia: los despachos solo se imprimen en el PDF del sistema.
            </p>

            {assignDespachosLoading ? (
              <div className="py-12 flex items-center justify-center text-slate-400 gap-2">
                <Loader2 className="animate-spin" size={18} /> Cargando ítems sin despacho...
              </div>
            ) : assignDespachosItems.length === 0 ? (
              <div className="py-8 text-center text-slate-300">
                Este pedido no tiene ítems con despacho NULL. Si igualmente aparece "—" en el PDF, puede ser por el último despacho del producto; volvé a imprimir luego de cargarlo.
              </div>
            ) : (
              <div className="space-y-3 mb-5">
                {assignDespachosItems.map((it) => {
                  const sel = assignDespachosByItem[it.orderItemId] || { mode: 'existing', despachoId: '', numeroDespacho: '', paisOrigen: '', fechaDespacho: '' };
                  const updateSel = (patch: Partial<typeof sel>) => {
                    setAssignDespachosByItem((prev) => ({
                      ...prev,
                      [it.orderItemId]: { ...sel, ...patch }
                    }));
                  };
                  return (
                    <div key={it.orderItemId} className="bg-slate-900 border border-slate-700 rounded-xl p-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                        <div className="min-w-0">
                          <div className="text-white font-semibold leading-tight truncate">
                            {it.productName || it.sku || it.orderItemId}
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            {[it.sku, it.sizeCode, it.colorName].filter(Boolean).join(' · ') || '—'}
                          </div>
                        </div>
                        <div className="text-sm text-amber-300 font-semibold">
                          {it.quantity} u. sin despacho
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-3 mb-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name={`mode-${it.orderItemId}`}
                            checked={sel.mode === 'existing'}
                            onChange={() => updateSel({ mode: 'existing' })}
                            className="text-amber-500"
                          />
                          <span className="text-sm text-slate-200">Usar despacho existente</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name={`mode-${it.orderItemId}`}
                            checked={sel.mode === 'new'}
                            onChange={() => updateSel({ mode: 'new' })}
                            className="text-amber-500"
                          />
                          <span className="text-sm text-slate-200">Ingresar nuevo número</span>
                        </label>
                      </div>

                      {sel.mode === 'existing' ? (
                        <div>
                          <select
                            value={sel.despachoId}
                            onChange={(e) => updateSel({ despachoId: e.target.value })}
                            className="w-full bg-slate-800 border border-slate-600 rounded-xl p-3 text-white font-mono focus:ring-2 focus:ring-amber-500 outline-none"
                          >
                            <option value="">— Elegí un despacho cargado —</option>
                            {assignDespachosCatalog.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.numero_despacho || d.id}{d.pais_origen ? ` · ${d.pais_origen}` : ''}{d.fecha_despacho ? ` · ${String(d.fecha_despacho).slice(0, 10)}` : ''}
                              </option>
                            ))}
                          </select>
                          {it.productLastDespachoNumero && (
                            <p className="text-[11px] text-slate-500 mt-1">
                              Último despacho cargado para este producto: <span className="text-slate-300 font-mono">{it.productLastDespachoNumero}</span>
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="md:col-span-1">
                            <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Nº Despacho</label>
                            <input
                              type="text"
                              value={sel.numeroDespacho}
                              onChange={(e) => updateSel({ numeroDespacho: e.target.value })}
                              placeholder="Ej: 25001IC04200218H"
                              className="w-full bg-slate-800 border border-slate-600 rounded-xl p-3 text-white font-mono focus:ring-2 focus:ring-amber-500 outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">País origen</label>
                            <input
                              type="text"
                              value={sel.paisOrigen}
                              onChange={(e) => updateSel({ paisOrigen: e.target.value })}
                              placeholder="Brasil"
                              className="w-full bg-slate-800 border border-slate-600 rounded-xl p-3 text-white focus:ring-2 focus:ring-amber-500 outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Fecha despacho</label>
                            <input
                              type="date"
                              value={sel.fechaDespacho}
                              onChange={(e) => updateSel({ fechaDespacho: e.target.value })}
                              className="w-full bg-slate-800 border border-slate-600 rounded-xl p-3 text-white focus:ring-2 focus:ring-amber-500 outline-none"
                            />
                          </div>
                          <p className="text-[11px] text-slate-500 md:col-span-3">
                            Si el número ya existe en la base se reutiliza; si no, se crea un despacho nuevo con estos datos.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex flex-wrap gap-3 justify-end">
              <button
                type="button"
                onClick={closeAssignDespachosModal}
                disabled={assignDespachosSaving}
                className="px-4 py-2.5 rounded-xl font-semibold text-slate-300 hover:bg-slate-700 transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmAssignDespachos}
                disabled={assignDespachosSaving || assignDespachosLoading || assignDespachosItems.length === 0}
                className="px-5 py-2.5 rounded-xl font-bold bg-amber-600 hover:bg-amber-500 text-white flex items-center gap-2 transition disabled:opacity-50"
              >
                {assignDespachosSaving ? <Loader2 size={18} className="animate-spin" /> : <Ship size={18} />}
                Asignar despachos
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: emitir nota de crédito (todo el pedido o un artículo) */}
      {ncOrder && (() => {
        const hasNCTotal = orderCreditNotes.some((nc) => (nc.scope || 'total') === 'total');
        const creditedByItemIndex = sumCreditedByItemIndex(orderCreditNotes);
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
