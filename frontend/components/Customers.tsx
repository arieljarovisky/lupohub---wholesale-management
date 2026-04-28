import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Users, Search, Plus, MapPin, Mail, Phone, Building2, Save, X, ShoppingBag, Calendar, DollarSign, TrendingUp, Clock, ArrowRight, ArrowLeft, Package, PackageCheck, Star, ChevronRight, Pencil, Trash2, FileSpreadsheet, Loader2, Download, Receipt, FileText, LayoutList, Wallet, ArrowUpDown, Filter, AlertTriangle } from 'lucide-react';
import { Customer, Role, Order, OrderItem, OrderStatus, Product, Transporte, User } from '../types';
import { Truck } from 'lucide-react';
import { parseCustomersExcel, parseCustomersCuitUpdateExcel } from '../utils/customersUtils';
import { api } from '../services/api';
import { useNotification } from '../context/NotificationContext';
import { getWholesaleStockImpactMeta } from '../utils/orderStockImpact';

interface CustomersProps {
  customers: Customer[];
  role: Role;
  sellerId: string;
  onCreateCustomer: (customer: Customer) => void;
  onUpdateCustomer?: (customerId: string, data: Partial<Customer>) => void | Promise<void>;
  onDeleteCustomer?: (customerId: string) => void | Promise<void>;
  /** Llamado después de importar clientes desde Excel para refrescar la lista */
  onRefreshData?: () => void;
  orders: Order[];
  products: Product[];
  priceLists?: { id: string; name: string }[];
  transportes?: Transporte[];
  users?: User[];
}

const CONDICIONES_IVA = [
  'Consumidor Final',
  'IVA Responsable Inscripto',
  'Responsable Monotributo',
  'IVA Sujeto Exento',
  'IVA No Alcanzado',
  'Sujeto No Categorizado',
  'IVA Liberado - Ley Nº 19.640',
  'Monotributista Social',
];

const CONDICIONES_VENTA = [
  'Contado',
  'Tarjeta de Débito',
  'Tarjeta de Crédito',
  'Cuenta Corriente',
  'Cheque',
  'Transferencia Bancaria',
  'Otra',
  'Otros medios de pago electrónico',
];

const SELECTED_CUSTOMER_STORAGE_KEY = 'lupohub_customers_selected_customer_id';

const Customers: React.FC<CustomersProps> = ({ customers, role, sellerId, onCreateCustomer, onUpdateCustomer, onDeleteCustomer, onRefreshData, orders, products, priceLists = [], transportes = [], users = [] }) => {
  const { showToast } = useNotification();
  const [isCreating, setIsCreating] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [onlyPendingDispatchInCustomer, setOnlyPendingDispatchInCustomer] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [importingExcel, setImportingExcel] = useState(false);
  const [updatingCuit, setUpdatingCuit] = useState(false);
  const importExcelInputRef = useRef<HTMLInputElement>(null);
  const cuitUpdateInputRef = useRef<HTMLInputElement>(null);

  // Estado para acceso de cliente (usuario propio)
  const [accessEmail, setAccessEmail] = useState('');
  const [accessPassword, setAccessPassword] = useState('');
  const [savingAccessUser, setSavingAccessUser] = useState(false);

  const canViewSaldos = role === Role.ADMIN || role === Role.SELLER || role === Role.WAREHOUSE || role === Role.DEPOSITO;
  /** max(0, pedidos LupoHub + cuenta importada − recibos Facturación) por cliente */
  const [carteraById, setCarteraById] = useState<
    Record<
      string,
      {
        saldoPendienteUnificado: number;
        orderCargosPendientes: number;
        multimediaSaldo: number;
        totalPagos: number;
      }
    >
  >({});
  const [saldosLoading, setSaldosLoading] = useState(false);

  const loadCarteraTotals = () => {
    if (!canViewSaldos) return;
    setSaldosLoading(true);
    api
      .getCarteraTotals()
      .then((rows) => {
        const m: Record<
          string,
          {
            saldoPendienteUnificado: number;
            orderCargosPendientes: number;
            multimediaSaldo: number;
            totalPagos: number;
          }
        > = {};
        for (const r of rows) {
          m[r.customerId] = {
            saldoPendienteUnificado: Number(r.saldoPendienteUnificado) || 0,
            orderCargosPendientes: Number(r.orderCargosPendientes) || 0,
            multimediaSaldo: Number(r.multimediaSaldo) || 0,
            totalPagos: Number(r.totalPagos) || 0
          };
        }
        setCarteraById(m);
      })
      .catch(() => {
        showToast('error', 'No se pudieron cargar los saldos de cartera.');
        setCarteraById({});
      })
      .finally(() => setSaldosLoading(false));
  };

  useEffect(() => {
    loadCarteraTotals();
  }, [canViewSaldos, role]);

  useEffect(() => {
    if (!selectedCustomer?.id || !canViewSaldos) {
      setMultimediaLedger(null);
      return;
    }
    let cancelled = false;
    setMultimediaLedgerLoading(true);
    api
      .getCustomerMultimediaLedger(selectedCustomer.id)
      .then((d) => {
        if (!cancelled) setMultimediaLedger(d);
      })
      .catch(() => {
        if (!cancelled) setMultimediaLedger(null);
      })
      .finally(() => {
        if (!cancelled) setMultimediaLedgerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCustomer?.id, canViewSaldos]);

  // Mantiene la vista de cliente al refrescar la página.
  useEffect(() => {
    try {
      if (!selectedCustomer?.id) return;
      sessionStorage.setItem(SELECTED_CUSTOMER_STORAGE_KEY, selectedCustomer.id);
    } catch {
      // ignore storage errors
    }
  }, [selectedCustomer?.id]);

  // Restaura/actualiza el cliente seleccionado cuando cambia la lista.
  useEffect(() => {
    if (!Array.isArray(customers) || customers.length === 0) return;

    if (selectedCustomer?.id) {
      const refreshed = customers.find((c) => c.id === selectedCustomer.id);
      if (!refreshed) {
        setSelectedCustomer(null);
        return;
      }
      if (refreshed !== selectedCustomer) setSelectedCustomer(refreshed);
      return;
    }

    try {
      const savedId = sessionStorage.getItem(SELECTED_CUSTOMER_STORAGE_KEY);
      if (!savedId) return;
      const savedCustomer = customers.find((c) => c.id === savedId);
      if (savedCustomer) setSelectedCustomer(savedCustomer);
      else sessionStorage.removeItem(SELECTED_CUSTOMER_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
  }, [customers, selectedCustomer?.id]);

  // Form State
  const [newBusinessName, setNewBusinessName] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newCity, setNewCity] = useState('');
  const [newCuit, setNewCuit] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newTransportNumber, setNewTransportNumber] = useState('');
  const [newRemitoNumber, setNewRemitoNumber] = useState('');
  const [newSaleCondition, setNewSaleCondition] = useState('');
  const [newCondicionIva, setNewCondicionIva] = useState('');
  const [newLegacyCode, setNewLegacyCode] = useState('');
  const [newAccountZone, setNewAccountZone] = useState('');
  const [newAccountSellerLabel, setNewAccountSellerLabel] = useState('');
  const [selectedTransporteIds, setSelectedTransporteIds] = useState<string[]>([]);
  const multimediaHistorialInputRef = useRef<HTMLInputElement>(null);
  const assignSellersResumenInputRef = useRef<HTMLInputElement>(null);
  const [groupBySeller, setGroupBySeller] = useState(false);
  const [assigningSellersResumen, setAssigningSellersResumen] = useState(false);
  const [multimediaExporting, setMultimediaExporting] = useState(false);
  const [multimediaImporting, setMultimediaImporting] = useState(false);
  const [saldosMultimediasExporting, setSaldosMultimediasExporting] = useState(false);
  const [wholesaleMetricsExporting, setWholesaleMetricsExporting] = useState(false);
  const [showExportSheetsModal, setShowExportSheetsModal] = useState(false);
  const [exportSheetSelectedIds, setExportSheetSelectedIds] = useState<string[]>([]);
  const [exportingSheets, setExportingSheets] = useState(false);
  const [showCustomerDetailExportModal, setShowCustomerDetailExportModal] = useState(false);
  const [customerDetailExportFrom, setCustomerDetailExportFrom] = useState('');
  const [customerDetailExportTo, setCustomerDetailExportTo] = useState('');
  const [exportingCustomerDetail, setExportingCustomerDetail] = useState(false);
  const [multimediaLedger, setMultimediaLedger] = useState<Awaited<ReturnType<typeof api.getCustomerMultimediaLedger>> | null>(null);
  const [multimediaLedgerLoading, setMultimediaLedgerLoading] = useState(false);

  /** Filtro por vendedor (solo ADMIN): '' = todos, '__none__' = sin vendedor, o id de usuario SELLER */
  const [sellerFilterId, setSellerFilterId] = useState<string>('');
  type SortPreset =
    | 'business_asc'
    | 'business_desc'
    | 'contact_asc'
    | 'city_asc'
    | 'saldo_desc'
    | 'saldo_asc'
    | 'seller_asc';
  const [sortPreset, setSortPreset] = useState<SortPreset>('business_asc');

  const clearSelectedCustomerView = () => {
    try {
      sessionStorage.removeItem(SELECTED_CUSTOMER_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
    setSelectedCustomer(null);
  };

  const matchesSearch = (c: Customer, qRaw: string) => {
    const q = qRaw.trim().toLowerCase();
    if (!q) return true;
    const inText = (s: string) => s.toLowerCase().includes(q);
    if (inText(c.businessName) || inText(c.name)) return true;
    if (c.email && inText(c.email)) return true;
    if (c.city && inText(c.city)) return true;
    if (c.legacyCode && String(c.legacyCode).toLowerCase().includes(q.replace(/\s/g, ''))) return true;
    const qDigits = q.replace(/\D/g, '');
    if (qDigits.length >= 4 && c.cuit) {
      const cuitDigits = c.cuit.replace(/\D/g, '');
      if (cuitDigits.includes(qDigits)) return true;
    }
    return false;
  };

  /** Un solo saldo: pedidos + cuenta importada − recibos (Facturación). */
  const getSaldoPendienteTotal = (c: Customer) => {
    const t = carteraById[c.id];
    return t != null ? Number(t.saldoPendienteUnificado) || 0 : 0;
  };

  const displayCustomers = useMemo(() => {
    let list = customers.filter((c) => matchesSearch(c, searchTerm));
    if (role === Role.ADMIN && sellerFilterId) {
      if (sellerFilterId === '__none__') list = list.filter((c) => !c.sellerId);
      else list = list.filter((c) => c.sellerId === sellerFilterId);
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortPreset) {
        case 'business_asc':
          cmp = a.businessName.localeCompare(b.businessName, 'es');
          break;
        case 'business_desc':
          cmp = b.businessName.localeCompare(a.businessName, 'es');
          break;
        case 'contact_asc':
          cmp = a.name.localeCompare(b.name, 'es');
          break;
        case 'city_asc':
          cmp = (a.city || '').localeCompare(b.city || '', 'es');
          break;
        case 'saldo_desc':
          cmp = getSaldoPendienteTotal(b) - getSaldoPendienteTotal(a);
          break;
        case 'saldo_asc':
          cmp = getSaldoPendienteTotal(a) - getSaldoPendienteTotal(b);
          break;
        case 'seller_asc': {
          const nameFor = (sid?: string) =>
            sid ? users.find((u) => u.id === sid)?.name || 'Vendedor' : 'Sin vendedor';
          const la = nameFor(a.sellerId).toLocaleLowerCase('es');
          const lb = nameFor(b.sellerId).toLocaleLowerCase('es');
          cmp = la.localeCompare(lb, 'es');
          break;
        }
        default:
          cmp = 0;
      }
      return cmp;
    });
    return sorted;
  }, [
    customers,
    searchTerm,
    sellerFilterId,
    sortPreset,
    role,
    carteraById,
    users
  ]);

  const groupedForList = useMemo(() => {
    if (!groupBySeller || searchTerm.trim()) {
      return [{ key: 'all', label: '', customers: displayCustomers }];
    }
    const map = new Map<string, { label: string; customers: Customer[] }>();
    for (const c of displayCustomers) {
      const sid = c.sellerId || '__none__';
      const label =
        sid !== '__none__'
          ? users.find((u) => u.id === c.sellerId)?.name || 'Vendedor'
          : 'Sin vendedor asignado';
      if (!map.has(sid)) map.set(sid, { label, customers: [] });
      map.get(sid)!.customers.push(c);
    }
    const arr = [...map.entries()].map(([key, v]) => ({
      key,
      label: v.label,
      customers: v.customers
    }));
    arr.sort((a, b) => {
      if (a.key === '__none__') return 1;
      if (b.key === '__none__') return -1;
      return a.label.localeCompare(b.label, 'es');
    });
    return arr;
  }, [groupBySeller, searchTerm, displayCustomers, users]);

  const currentCustomerUserEmail = (c: Customer | null) => {
    // De momento usamos el email del propio cliente como referencia visual.
    return c?.email || '';
  };

  const getSellerName = (sellerId?: string) => {
    if (!sellerId) return '';
    const seller = users.find(u => u.id === sellerId);
    return seller?.name || '';
  };

  /** El backend ya envía nombre/SKU/talle/color por línea; el catálogo local puede no estar cargado. */
  const lineTitleForItem = (item: OrderItem) => {
    const fromApi = item.productName?.trim();
    if (fromApi) return fromApi;
    const p = products.find((pr) => pr.id === item.productId);
    return p?.name?.trim() || 'Producto Desconocido';
  };

  const lineMetaForItem = (item: OrderItem) => {
    const p = products.find((pr) => pr.id === item.productId);
    const sku = item.sku ?? p?.sku;
    const size = item.sizeCode ?? p?.size;
    const color = item.colorName ?? p?.color;
    const parts = [sku, size, color].filter((x) => x != null && String(x).trim() !== '');
    return parts.length ? parts.join(' • ') : '—';
  };

  const getStatusColor = (status: OrderStatus) => {
    switch(status) {
      case OrderStatus.DRAFT: return 'bg-slate-700 text-slate-300';
      case OrderStatus.PENDING_ADMIN_CONFIRMATION: return 'bg-violet-900/40 text-violet-300 border border-violet-800';
      case OrderStatus.CONFIRMED: return 'bg-blue-900/40 text-blue-300 border border-blue-800';
      case OrderStatus.PREPARING: return 'bg-yellow-900/40 text-yellow-300 border border-yellow-800';
      case OrderStatus.PENDING_CONTROL: return 'bg-amber-900/40 text-amber-300 border border-amber-800';
      case OrderStatus.CONTROLLED: return 'bg-emerald-900/40 text-emerald-300 border border-emerald-800';
      case OrderStatus.DISPATCHED: return 'bg-green-900/40 text-green-300 border border-green-800';
      case OrderStatus.CANCELLED: return 'bg-red-900/40 text-red-300 border border-red-800';
      default: return 'bg-slate-700 text-slate-400';
    }
  };

  const getPendingUnitsForOrder = (order: Order) => {
    return (order.items || []).reduce((sum, item) => {
      const qty = Number(item.quantity || 0);
      const picked = Number(item.picked || 0);
      const pending = Math.max(0, qty - picked);
      return sum + pending;
    }, 0);
  };

  const handleSave = () => {
    if (!newBusinessName || !newEmail) return;

    if (editingCustomer && onUpdateCustomer) {
      const data: Partial<Customer> = {
        businessName: newBusinessName,
        name: newContactName,
        email: newEmail,
        address: newAddress || undefined,
        city: newCity || undefined,
        cuit: newCuit || undefined,
        phone: newPhone || undefined,
        transportNumber: newTransportNumber || undefined,
        remitoNumber: newRemitoNumber || undefined,
        saleCondition: newSaleCondition || undefined,
        condicionIva: newCondicionIva || undefined,
        transporteIds: selectedTransporteIds,
        legacyCode: newLegacyCode.trim() || undefined,
        accountZone: newAccountZone.trim() || undefined,
        accountSellerLabel: newAccountSellerLabel.trim() || undefined
      };
      Promise.resolve(onUpdateCustomer(editingCustomer.id, data)).then(() => {
        setSelectedCustomer(prev => prev?.id === editingCustomer.id ? { ...prev, ...data, transportes: selectedTransporteIds.map(id => ({ id, name: transportes.find(t => t.id === id)?.name ?? '' })) } : prev);
        setEditingCustomer(null);
        setNewBusinessName('');
        setNewContactName('');
        setNewEmail('');
        setNewAddress('');
        setNewCity('');
        setNewCuit('');
        setNewPhone('');
        setNewTransportNumber('');
        setNewRemitoNumber('');
        setNewSaleCondition('');
        setNewCondicionIva('');
        setNewLegacyCode('');
        setNewAccountZone('');
        setNewAccountSellerLabel('');
        setSelectedTransporteIds([]);
      }).catch(() => {});
      return;
    }

    const newCustomer: Customer = {
      id: `c${Date.now()}`,
      sellerId: sellerId,
      businessName: newBusinessName,
      name: newContactName,
      email: newEmail,
      address: newAddress,
      city: newCity,
      cuit: newCuit || undefined,
      phone: newPhone || undefined,
      transportNumber: newTransportNumber || undefined,
      remitoNumber: newRemitoNumber || undefined,
      saleCondition: newSaleCondition || undefined,
      condicionIva: newCondicionIva || undefined,
      legacyCode: newLegacyCode.trim() || undefined,
      accountZone: newAccountZone.trim() || undefined,
      accountSellerLabel: newAccountSellerLabel.trim() || undefined,
      transportes: selectedTransporteIds.map(id => ({ id, name: transportes.find(t => t.id === id)?.name ?? '' }))
    };

    onCreateCustomer(newCustomer);
    setIsCreating(false);
    setNewBusinessName('');
    setNewContactName('');
    setNewEmail('');
    setNewAddress('');
    setNewCity('');
    setNewCuit('');
    setNewPhone('');
    setNewTransportNumber('');
    setNewRemitoNumber('');
    setNewSaleCondition('');
    setNewCondicionIva('');
    setNewLegacyCode('');
    setNewAccountZone('');
    setNewAccountSellerLabel('');
    setSelectedTransporteIds([]);
  };

  // --- LOGIC FOR STATISTICS ---
  const getCustomerStats = (customerId: string) => {
    const customerOrders = orders.filter(o => o.customerId === customerId).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const totalSpent = customerOrders.reduce((sum, o) => sum + o.total, 0);
    const completedOrders = customerOrders.filter(o => o.status === OrderStatus.DISPATCHED).length;
    
    // Calculate Top Product
    const productCounts: Record<string, number> = {};
    customerOrders.forEach(order => {
      order.items.forEach(item => {
        if (item.productId) {
          productCounts[item.productId] = (productCounts[item.productId] || 0) + item.quantity;
        }
      });
    });
    
    let topProductId = '';
    let topProductCount = 0;
    
    Object.entries(productCounts).forEach(([id, count]) => {
      if (count > topProductCount) {
        topProductCount = count;
        topProductId = id;
      }
    });

    const topProduct = products.find(p => p.id === topProductId);
    const averageTicket = customerOrders.length > 0 ? totalSpent / customerOrders.length : 0;

    return {
      orders: customerOrders,
      totalSpent,
      completedOrders,
      topProduct,
      topProductCount,
      averageTicket,
      lastOrderDate: customerOrders.length > 0 ? customerOrders[0].date : 'N/A'
    };
  };

  type LedgerEntry = NonNullable<Awaited<ReturnType<typeof api.getCustomerMultimediaLedger>>['entries']>[number];

  const migratedBuckets = useMemo(() => {
    const entries = multimediaLedger?.entries;
    if (!entries?.length) return null;
    const recibos: LedgerEntry[] = [];
    const facturas: LedgerEntry[] = [];
    const pedidosTango: LedgerEntry[] = [];
    const otros: LedgerEntry[] = [];
    for (const e of entries) {
      const u = `${e.tipo} ${e.detalle || ''}`.toUpperCase();
      if (/RECIBO|COBRO|PAGO|NC\s*A|INGRESO/i.test(u)) recibos.push(e);
      else if (/FACT|FCA|FCE|NOTA\s*DE\s*CR|COMPROBANTE|CREDITO|DEBITO|NC\s*D/i.test(u)) facturas.push(e);
      else if (/PEDIDO|REMITO|PRESUP|PREFACT|ORDEN/i.test(u)) pedidosTango.push(e);
      else otros.push(e);
    }
    return { recibos, facturas, pedidosTango, otros };
  }, [multimediaLedger]);

  const pendingShipLines = useMemo(() => {
    if (!selectedCustomer) return [] as { order: Order; item: OrderItem; pendiente: number }[];
    const customerOrders = orders.filter((o) => o.customerId === selectedCustomer.id);
    const out: { order: Order; item: OrderItem; pendiente: number }[] = [];
    for (const o of customerOrders) {
      for (const it of o.items || []) {
        const pend = Math.max(0, Number(it.quantity || 0) - Number(it.picked || 0));
        if (pend > 0) out.push({ order: o, item: it, pendiente: pend });
      }
    }
    return out;
  }, [selectedCustomer?.id, orders]);

  const formatLedgerDate = (sql: string) => {
    const m = String(sql || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return sql || '—';
    return `${m[3]}/${m[2]}/${m[1]}`;
  };

  const renderLedgerTable = (title: string, icon: React.ReactNode, rows: LedgerEntry[]) => {
    if (rows.length === 0) return null;
    return (
      <div className="rounded-2xl border border-slate-600/60 overflow-hidden bg-slate-950/50 shadow-inner shadow-black/20">
        <div className="px-4 py-3 border-b border-slate-700/70 flex items-center gap-2 bg-gradient-to-r from-slate-900/95 to-slate-950/90">
          {icon}
          <span className="text-xs font-black text-slate-100 uppercase tracking-[0.12em]">{title}</span>
          <span className="text-[10px] text-slate-500 ml-auto tabular-nums">{rows.length} mov.</span>
        </div>
        <div className="overflow-x-auto max-h-56 overflow-y-auto">
          <table className="min-w-full text-xs text-left">
            <thead className="text-[10px] uppercase text-slate-500 border-b border-slate-800 sticky top-0 bg-slate-950">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Número</th>
                <th className="px-3 py-2 text-right">Importe</th>
                <th className="px-3 py-2 text-right">Saldo</th>
                <th className="px-3 py-2">Detalle</th>
              </tr>
            </thead>
            <tbody className="text-slate-300 divide-y divide-slate-800/80">
              {rows.map((e, idx) => (
                <tr key={`${e.lineOrder}-${idx}`} className="hover:bg-slate-800/30">
                  <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">{formatLedgerDate(e.lineDate)}</td>
                  <td className="px-3 py-1.5">{e.tipo}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px]">{e.numero ?? '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {e.importe != null ? `$${Number(e.importe).toLocaleString('es-AR')}` : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {e.saldo != null ? `$${Number(e.saldo).toLocaleString('es-AR')}` : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-slate-400 max-w-[200px] truncate" title={e.detalle || ''}>
                    {e.detalle || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // --- VIEWS ---

  // 1. Order Detail View (Drill down Level 2)
  if (selectedOrder && selectedCustomer) {
    return (
      <div className="animate-fade-in space-y-6">
        <div className="flex items-center gap-3 mb-6">
          <button 
            onClick={() => setSelectedOrder(null)} 
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl transition text-slate-300"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
             <h2 className="text-2xl font-bold text-white">Pedido #{selectedOrder.id}</h2>
             <p className="text-sm text-slate-400">Detalles de la compra</p>
          </div>
        </div>

        <div className="bg-slate-800 rounded-3xl border border-slate-700 overflow-hidden shadow-xl">
           <div className="p-6 border-b border-slate-700 bg-slate-900/50 flex justify-between items-center">
              <div className="flex items-center gap-3">
                 <div className="w-12 h-12 bg-blue-600/20 rounded-xl flex items-center justify-center text-blue-400">
                    <ShoppingBag size={24} />
                 </div>
                 <div>
                    <div className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded w-fit mb-1 ${getStatusColor(selectedOrder.status)}`}>
                       {selectedOrder.status}
                    </div>
                    <div className="text-sm text-slate-400 flex items-center gap-2">
                       <Calendar size={14} /> {selectedOrder.date}
                    </div>
                 </div>
              </div>
              <div className="text-right">
                 <p className="text-sm text-slate-500 uppercase font-bold">Total</p>
                 <p className="text-3xl font-black text-white">${selectedOrder.total.toLocaleString()}</p>
              </div>
           </div>
           
           <div className="p-6">
              <h3 className="text-sm font-black text-slate-500 uppercase tracking-widest mb-4">Items del Pedido</h3>
              <div className="space-y-3">
                 {selectedOrder.items.map((item, itemIdx) => {
                    return (
                       <div key={item.variantId || `${item.productId || 'line'}-${itemIdx}`} className="flex items-center justify-between p-4 bg-slate-900 rounded-2xl border border-slate-800">
                          <div className="flex items-center gap-4">
                             <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center text-slate-500 font-bold">
                                {item.quantity}x
                             </div>
                             <div>
                                <p className="font-bold text-white">{lineTitleForItem(item)}</p>
                                <p className="text-xs text-slate-500">{lineMetaForItem(item)}</p>
                             </div>
                          </div>
                          <div className="text-right">
                             <p className="font-bold text-white">${(item.priceAtMoment * item.quantity).toLocaleString()}</p>
                             <p className="text-xs text-slate-500">${item.priceAtMoment.toLocaleString()} c/u</p>
                          </div>
                       </div>
                    );
                 })}
              </div>
           </div>
        </div>
      </div>
    );
  }

  // 2. Customer Detail View (Drill down Level 1)
  if (selectedCustomer) {
    const stats = getCustomerStats(selectedCustomer.id);
    const visibleOrders = onlyPendingDispatchInCustomer
      ? stats.orders.filter(o => getPendingUnitsForOrder(o) > 0)
      : stats.orders;

    const editModal = (isCreating || editingCustomer) && (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
        <div className="bg-slate-900 rounded-3xl w-full max-w-lg border border-slate-700 shadow-2xl flex flex-col max-h-[90vh]">
          <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900 rounded-t-3xl">
            <h3 className="text-xl font-bold text-white">{editingCustomer ? 'Editar cliente' : 'Alta de Cliente'}</h3>
            <button
              onClick={() => { setIsCreating(false); setEditingCustomer(null); setNewPhone(''); setNewTransportNumber(''); setNewRemitoNumber(''); setNewSaleCondition(''); setNewCondicionIva(''); setNewLegacyCode(''); setNewAccountZone(''); setNewAccountSellerLabel(''); setSelectedTransporteIds([]); }}
              className="text-slate-400 hover:text-white bg-slate-800 p-2 rounded-full hover:bg-slate-700 transition"
            >
              <X size={20} />
            </button>
          </div>
          <div className="p-6 space-y-4 overflow-y-auto">
            <div>
              <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Razón Social</label>
              <input type="text" className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all" value={newBusinessName} onChange={(e) => setNewBusinessName(e.target.value)} placeholder="Ej: Lenceria Perez SRL" />
            </div>
            <div>
              <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Nombre Contacto</label>
              <input type="text" className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all" value={newContactName} onChange={(e) => setNewContactName(e.target.value)} placeholder="Ej: Juan Perez" />
            </div>
            <div>
              <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Email</label>
              <input type="email" className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="contacto@empresa.com" />
            </div>
            <div>
              <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">CUIT / CUIL (para facturación)</label>
              <input type="text" className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-mono" value={newCuit} onChange={(e) => setNewCuit(e.target.value.replace(/\D/g, '').slice(0, 11))} placeholder="20-12345678-9 (solo números)" />
            </div>
            <div>
              <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Teléfono</label>
              <input type="text" className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Ej: 11 1234-5678" />
            </div>
            <div>
              <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">N° Transporte</label>
              <input type="text" className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all" value={newTransportNumber} onChange={(e) => setNewTransportNumber(e.target.value)} placeholder="Ej: 12345" />
            </div>
            <div>
              <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">N° Remito</label>
              <input type="text" className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all" value={newRemitoNumber} onChange={(e) => setNewRemitoNumber(e.target.value)} placeholder="Ej: R-0001-00001234" />
            </div>
            <div>
              <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Condición de venta</label>
              <select
                className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                value={newSaleCondition}
                onChange={(e) => setNewSaleCondition(e.target.value)}
              >
                <option value="">— Seleccionar —</option>
                {CONDICIONES_VENTA.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
                {newSaleCondition && !CONDICIONES_VENTA.includes(newSaleCondition) && (
                  <option value={newSaleCondition}>{newSaleCondition}</option>
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Condición de IVA</label>
              <select className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all" value={newCondicionIva} onChange={(e) => setNewCondicionIva(e.target.value)}>
                <option value="">— Seleccionar —</option>
                {CONDICIONES_IVA.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
                {newCondicionIva && !CONDICIONES_IVA.includes(newCondicionIva) && (
                  <option value={newCondicionIva}>{newCondicionIva}</option>
                )}
              </select>
            </div>
            {transportes.length > 0 && (
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase mb-2 ml-1">Transportes (factura, remitos y despacho)</label>
                <p className="text-[10px] text-slate-500 mb-2 ml-1">Si el cliente usa varios, marcá todos; al imprimir la factura podés elegir uno o listar todos.</p>
                <div className="flex flex-wrap gap-2">
                  {transportes.map(t => (
                    <label key={t.id} className="flex items-center gap-2 px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl cursor-pointer hover:bg-slate-750 transition">
                      <input type="checkbox" checked={selectedTransporteIds.includes(t.id)} onChange={(e) => { if (e.target.checked) setSelectedTransporteIds(prev => [...prev, t.id]); else setSelectedTransporteIds(prev => prev.filter(id => id !== t.id)); }} className="rounded border-slate-600 text-blue-500 focus:ring-blue-500" />
                      <span className="text-sm text-slate-200">{t.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Dirección</label>
                <input type="text" className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all" value={newAddress} onChange={(e) => setNewAddress(e.target.value)} placeholder="Calle 123" />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Ciudad</label>
                <input type="text" className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all" value={newCity} onChange={(e) => setNewCity(e.target.value)} placeholder="CABA" />
              </div>
            </div>
            <div className="pt-3 border-t border-slate-800/80">
              <p className="text-[10px] text-slate-500 uppercase font-black mb-2 ml-1">Cuenta corriente / Excel Multimedias</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Código legacy</label>
                  <input type="text" className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-mono text-sm" value={newLegacyCode} onChange={(e) => setNewLegacyCode(e.target.value)} placeholder="Ej: 000809" />
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Zona (export)</label>
                  <input type="text" className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-sm" value={newAccountZone} onChange={(e) => setNewAccountZone(e.target.value)} placeholder="Ej: 02 - Interior" />
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Vendedor habitual (export)</label>
                  <input type="text" className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-sm" value={newAccountSellerLabel} onChange={(e) => setNewAccountSellerLabel(e.target.value)} placeholder="Ej: 27 - Colombo" />
                </div>
              </div>
            </div>
          </div>
          <div className="p-6 border-t border-slate-800 bg-slate-900 rounded-b-3xl flex justify-end gap-3">
            <button onClick={() => { setIsCreating(false); setEditingCustomer(null); setNewPhone(''); setNewTransportNumber(''); setNewRemitoNumber(''); setNewSaleCondition(''); setNewCondicionIva(''); setNewLegacyCode(''); setNewAccountZone(''); setNewAccountSellerLabel(''); setSelectedTransporteIds([]); }} className="px-5 py-2.5 text-slate-400 hover:bg-slate-800 rounded-xl transition font-medium">Cancelar</button>
            <button onClick={handleSave} disabled={!newBusinessName || !newEmail} className="bg-blue-600 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-blue-900/40 active:scale-95 transition-all">
              <Save size={18} />
              {editingCustomer ? 'Guardar cambios' : 'Guardar Cliente'}
            </button>
          </div>
        </div>
      </div>
    );
    
    return (
      <>
      <div className="animate-fade-in space-y-6 pb-12">
        {/* Navigation Header */}
        <div className="flex items-center justify-between">
           <div className="flex items-center gap-3">
             <button 
               onClick={clearSelectedCustomerView} 
               className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl transition text-slate-300"
             >
               <ArrowLeft size={20} />
             </button>
             <div>
                <h2 className="text-2xl font-bold text-white">{selectedCustomer.businessName}</h2>
                <div className="flex items-center gap-3 text-sm text-slate-400 flex-wrap">
                  <span className="flex items-center gap-1"><Users size={14}/> {selectedCustomer.name}</span>
                  <span className="w-1 h-1 bg-slate-600 rounded-full"></span>
                  <span className="flex items-center gap-1"><MapPin size={14}/> {selectedCustomer.city}</span>
                  {selectedCustomer.phone && (
                    <>
                      <span className="w-1 h-1 bg-slate-600 rounded-full"></span>
                      <span className="flex items-center gap-1"><Phone size={14}/> {selectedCustomer.phone}</span>
                    </>
                  )}
                  {selectedCustomer.cuit && (
                    <>
                      <span className="w-1 h-1 bg-slate-600 rounded-full"></span>
                      <span className="font-mono">CUIT {selectedCustomer.cuit}</span>
                    </>
                  )}
                  {selectedCustomer.condicionIva && (
                    <>
                      <span className="w-1 h-1 bg-slate-600 rounded-full"></span>
                      <span>IVA: {selectedCustomer.condicionIva}</span>
                    </>
                  )}
                  {selectedCustomer.transportes && selectedCustomer.transportes.length > 0 && (
                    <>
                      <span className="w-1 h-1 bg-slate-600 rounded-full"></span>
                      <span className="flex items-center gap-1"><Truck size={14} /> {selectedCustomer.transportes.map(t => t.name).join(', ')}</span>
                    </>
                  )}
                </div>
             </div>
           </div>
           <div className="flex items-center gap-2">
             <button
               onClick={() => {
                 setCustomerDetailExportFrom('');
                 setCustomerDetailExportTo('');
                 setShowCustomerDetailExportModal(true);
               }}
               className="px-4 py-2 bg-emerald-900/40 border border-emerald-700/50 rounded-xl text-sm font-bold text-emerald-200 hover:bg-emerald-900/60 hover:text-white transition flex items-center gap-2"
               title="Exportar detalle del cliente con filtro de fechas"
             >
               <FileSpreadsheet size={16} />
               Exportar detalle
             </button>
             <button
               onClick={() => {
                 setExportSheetSelectedIds([selectedCustomer.id]);
                 setShowExportSheetsModal(true);
               }}
               className="px-4 py-2 bg-cyan-900/40 border border-cyan-700/50 rounded-xl text-sm font-bold text-cyan-200 hover:bg-cyan-900/60 hover:text-white transition flex items-center gap-2"
               title="Descargar Excel con una hoja por cliente"
             >
               <Download size={16} />
               Exportar por hojas
             </button>
             <button
               onClick={() => {
                 setNewBusinessName(selectedCustomer.businessName);
                 setNewContactName(selectedCustomer.name);
                 setNewEmail(selectedCustomer.email);
                 setNewAddress(selectedCustomer.address || '');
                 setNewCity(selectedCustomer.city || '');
                 setNewCuit(selectedCustomer.cuit || '');
                 setNewPhone(selectedCustomer.phone || '');
                 setNewTransportNumber(selectedCustomer.transportNumber || '');
                 setNewRemitoNumber(selectedCustomer.remitoNumber || '');
                 setNewSaleCondition(selectedCustomer.saleCondition || '');
                 setNewCondicionIva(selectedCustomer.condicionIva || '');
                 setNewLegacyCode(selectedCustomer.legacyCode || '');
                 setNewAccountZone(selectedCustomer.accountZone || '');
                 setNewAccountSellerLabel(selectedCustomer.accountSellerLabel || '');
                 setSelectedTransporteIds(selectedCustomer.transportes?.map(t => t.id) ?? []);
                 setEditingCustomer(selectedCustomer);
               }}
               className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition flex items-center gap-2"
             >
               <Pencil size={16} />
               Editar Datos
             </button>
             {onDeleteCustomer && (
               <button
                 onClick={() => {
                  if (window.confirm(`¿Eliminar el cliente "${selectedCustomer.businessName}"? Esta acción no se puede deshacer.`)) {
                    Promise.resolve(onDeleteCustomer(selectedCustomer.id)).then(() => clearSelectedCustomerView()).catch(() => {});
                   }
                 }}
                 className="px-4 py-2 bg-red-900/50 border border-red-800 rounded-xl text-sm font-bold text-red-300 hover:bg-red-900 hover:text-white transition flex items-center gap-2"
               >
                 <Trash2 size={16} />
                 Eliminar
               </button>
             )}
           </div>
        </div>

        {showCustomerDetailExportModal && selectedCustomer && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <h3 className="text-white font-bold">Exportar detalle del cliente</h3>
                <button onClick={() => setShowCustomerDetailExportModal(false)} className="text-slate-400 hover:text-white">
                  <X size={18} />
                </button>
              </div>
              <div className="p-4 space-y-4">
                <p className="text-sm text-slate-400">
                  Elegí rango de fechas (opcional). Se exportan movimientos de archivo y pedidos en LupoHub.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-black text-slate-500 uppercase mb-1">Desde</label>
                    <input
                      type="date"
                      value={customerDetailExportFrom}
                      onChange={(e) => setCustomerDetailExportFrom(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-sm text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-slate-500 uppercase mb-1">Hasta</label>
                    <input
                      type="date"
                      value={customerDetailExportTo}
                      onChange={(e) => setCustomerDetailExportTo(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-sm text-slate-100"
                    />
                  </div>
                </div>
              </div>
              <div className="p-4 border-t border-slate-800 flex gap-2">
                <button
                  onClick={() => setShowCustomerDetailExportModal(false)}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-xl font-semibold"
                >
                  Cancelar
                </button>
                <button
                  disabled={exportingCustomerDetail}
                  onClick={async () => {
                    if (customerDetailExportFrom && customerDetailExportTo && customerDetailExportFrom > customerDetailExportTo) {
                      showToast('error', 'La fecha desde no puede ser mayor que la fecha hasta.');
                      return;
                    }
                    try {
                      setExportingCustomerDetail(true);
                      await api.exportCustomerDetail(selectedCustomer.id, {
                        from: customerDetailExportFrom || undefined,
                        to: customerDetailExportTo || undefined
                      });
                      showToast('success', 'Excel descargado');
                      setShowCustomerDetailExportModal(false);
                    } catch (err: any) {
                      showToast('error', err?.message || 'Error al exportar detalle');
                    } finally {
                      setExportingCustomerDetail(false);
                    }
                  }}
                  className="flex-1 bg-emerald-700 hover:bg-emerald-600 text-white px-4 py-2.5 rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {exportingCustomerDetail ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  Descargar Excel
                </button>
              </div>
            </div>
          </div>
        )}

        {showExportSheetsModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <h3 className="text-white font-bold">Exportar clientes por hojas</h3>
                <button
                  onClick={() => setShowExportSheetsModal(false)}
                  className="text-slate-400 hover:text-white"
                  aria-label="Cerrar"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="p-4 space-y-3 max-h-[60vh] overflow-y-auto">
                <p className="text-sm text-slate-400">
                  Elegí los clientes a incluir. El Excel se genera con una hoja por cliente.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setExportSheetSelectedIds(displayCustomers.map((c) => c.id))}
                    className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700"
                  >
                    Seleccionar visibles
                  </button>
                  <button
                    type="button"
                    onClick={() => setExportSheetSelectedIds([])}
                    className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700"
                  >
                    Limpiar
                  </button>
                </div>
                <div className="space-y-2">
                  {displayCustomers.map((c) => {
                    const checked = exportSheetSelectedIds.includes(c.id);
                    return (
                      <label key={c.id} className="flex items-center gap-3 p-2 rounded-lg border border-slate-800 hover:bg-slate-800/60 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const on = e.target.checked;
                            setExportSheetSelectedIds((prev) =>
                              on ? [...prev, c.id] : prev.filter((id) => id !== c.id)
                            );
                          }}
                        />
                        <span className="text-sm text-slate-200">{c.businessName || c.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="p-4 border-t border-slate-800 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowExportSheetsModal(false)}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-xl font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={exportingSheets || exportSheetSelectedIds.length === 0}
                  onClick={async () => {
                    try {
                      setExportingSheets(true);
                      await api.exportCustomersBySheets(exportSheetSelectedIds);
                      showToast('success', 'Excel descargado');
                      setShowExportSheetsModal(false);
                    } catch (err: any) {
                      showToast('error', err?.message || 'Error al exportar');
                    } finally {
                      setExportingSheets(false);
                    }
                  }}
                  className="flex-1 bg-cyan-700 hover:bg-cyan-600 text-white px-4 py-2.5 rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {exportingSheets ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  Descargar Excel
                </button>
              </div>
            </div>
          </div>
        )}

        {role === Role.ADMIN && priceLists.length > 0 && onUpdateCustomer && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-2">
              <label className="block text-xs font-black text-slate-500 uppercase mb-2">
                Lista de precios (cliente con acceso a la app)
              </label>
              <select
                value={selectedCustomer.priceListId ?? ''}
                onChange={async (e) => {
                  const value = e.target.value || null;
                  try {
                    await Promise.resolve(onUpdateCustomer(selectedCustomer.id, { priceListId: value }));
                    setSelectedCustomer(prev => prev ? { ...prev, priceListId: value ?? undefined } : null);
                  } catch (err) {
                    console.error(err);
                  }
                }}
                className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="">Precio base</option>
                {priceLists.map(pl => (
                  <option key={pl.id} value={pl.id}>{pl.name}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="mt-6">
          <h3 className="text-xs font-black text-slate-500 uppercase tracking-[0.25em] mb-3 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.8)]" />
            Resumen de actividad
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Spent */}
            <div className="relative overflow-hidden bg-gradient-to-br from-emerald-900/60 via-slate-900 to-slate-900 p-5 rounded-3xl border border-emerald-700/70 shadow-[0_18px_45px_rgba(16,185,129,0.25)]">
              <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-emerald-500/20 blur-2xl" />
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-emerald-500/20 rounded-xl text-emerald-300">
                  <DollarSign size={20} />
                </div>
                <span className="text-[10px] font-black text-emerald-200 uppercase tracking-[0.22em]">
                  Inversión Total
                </span>
              </div>
              <p className="text-2xl font-black text-white">${stats.totalSpent.toLocaleString()}</p>
              <p className="text-[10px] text-slate-400 mt-1">Histórico acumulado</p>
            </div>

            {/* Orders Count */}
            <div className="bg-slate-800/90 p-5 rounded-3xl border border-slate-700 shadow-lg">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-blue-900/20 rounded-lg text-blue-500">
                  <ShoppingBag size={20} />
                </div>
                <span className="text-xs font-black text-slate-400 uppercase tracking-wider">
                  Pedidos
                </span>
              </div>
              <p className="text-2xl font-black text-white">{stats.orders.length}</p>
              <p className="text-[10px] text-slate-500 mt-1">
                {stats.completedOrders} completados
              </p>
            </div>

            {/* Average Ticket */}
            <div className="bg-slate-800/90 p-5 rounded-3xl border border-slate-700 shadow-lg">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-purple-900/20 rounded-lg text-purple-500">
                  <TrendingUp size={20} />
                </div>
                <span className="text-xs font-black text-slate-400 uppercase tracking-wider">
                  Ticket Promedio
                </span>
              </div>
              <p className="text-2xl font-black text-white">
                ${Math.round(stats.averageTicket).toLocaleString()}
              </p>
              <p className="text-[10px] text-slate-500 mt-1">Por pedido realizado</p>
            </div>

            {/* Top Product */}
            <div className="bg-gradient-to-br from-indigo-900 to-slate-900 p-5 rounded-3xl border border-indigo-800 shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 w-20 h-20 bg-indigo-500 blur-3xl opacity-20 rounded-full" />
              <div className="flex items-center gap-3 mb-2 relative z-10">
                <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-300">
                  <Star size={20} />
                </div>
                <span className="text-xs font-black text-indigo-300 uppercase tracking-wider">
                  Más Comprado
                </span>
              </div>
              {stats.topProduct ? (
                <div className="relative z-10">
                  <p
                    className="text-lg font-bold text-white truncate"
                    title={stats.topProduct.name}
                  >
                    {stats.topProduct.name}
                  </p>
                  <p className="text-xs text-indigo-300 mt-0.5">
                    {stats.topProductCount} unidades adquiridas
                  </p>
                </div>
              ) : (
                <p className="text-sm text-slate-500 relative z-10">
                  Sin datos suficientes
                </p>
              )}
            </div>
          </div>
        </div>

        {canViewSaldos && (
          <div className="mt-6 rounded-3xl border border-amber-500/35 bg-gradient-to-br from-slate-900 via-slate-900/95 to-slate-950 p-6 shadow-xl shadow-black/30 ring-1 ring-amber-500/10">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-amber-100/90">
                  <Wallet size={22} className="text-amber-400 shrink-0" aria-hidden />
                  <span className="text-sm font-black uppercase tracking-[0.22em]">Saldo pendiente unificado</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed max-w-xl">
                  Pedidos LupoHub con cobro pendiente, más el último saldo de cuenta importada (Tango / Multimedias), menos los
                  recibos cargados en Facturación.
                </p>
                {selectedCustomer && carteraById[selectedCustomer.id] && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500 font-mono tabular-nums pt-1">
                    <span>
                      Pedidos: $
                      {carteraById[selectedCustomer.id].orderCargosPendientes.toLocaleString('es-AR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                      })}
                    </span>
                    <span>
                      Cuenta importada: $
                      {carteraById[selectedCustomer.id].multimediaSaldo.toLocaleString('es-AR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                      })}
                    </span>
                    <span className="text-emerald-500/90">
                      − Recibos: $
                      {carteraById[selectedCustomer.id].totalPagos.toLocaleString('es-AR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                      })}
                    </span>
                  </div>
                )}
              </div>
              <p className="text-3xl font-black text-white tabular-nums sm:text-right shrink-0">
                $
                {getSaldoPendienteTotal(selectedCustomer).toLocaleString('es-AR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2
                })}
              </p>
            </div>
          </div>
        )}

        {/* Zona de configuración avanzada (lista de precios, vendedor asignado, acceso cliente) */}
        {role === Role.ADMIN && (
          <div className="mt-10 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-black text-slate-500 uppercase tracking-[0.25em] flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.8)]" />
                Configuración del cliente
              </h3>
              <span className="text-[11px] text-slate-500 bg-slate-800/70 border border-slate-700 px-3 py-1 rounded-full">
                Solo visible para administradores
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Lista de precios */}
            {priceLists.length > 0 && onUpdateCustomer && (
              <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-2">
                <label className="block text-xs font-black text-slate-500 uppercase mb-2">
                  Lista de precios
                </label>
                <select
                  value={selectedCustomer.priceListId ?? ''}
                  onChange={async (e) => {
                    const value = e.target.value || null;
                    try {
                      await Promise.resolve(onUpdateCustomer(selectedCustomer.id, { priceListId: value }));
                      setSelectedCustomer(prev => prev ? { ...prev, priceListId: value ?? undefined } : null);
                    } catch (err) {
                      console.error(err);
                    }
                  }}
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">Precio base</option>
                  {priceLists.map(pl => (
                    <option key={pl.id} value={pl.id}>{pl.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Vendedor asignado */}
            {onUpdateCustomer && (
              <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-2">
                <label className="block text-xs font-black text-slate-500 uppercase mb-2">
                  Vendedor asignado
                </label>
                <select
                  value={selectedCustomer.sellerId || ''}
                  onChange={async (e) => {
                    const value = e.target.value || '';
                    try {
                      await Promise.resolve(onUpdateCustomer(selectedCustomer.id, { sellerId: value || undefined }));
                      setSelectedCustomer(prev => prev ? { ...prev, sellerId: value || '' } : null);
                    } catch (err) {
                      console.error(err);
                    }
                  }}
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">Sin vendedor (cliente directo)</option>
                  {users
                    .filter(u => u.role === Role.SELLER)
                    .map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  Si dejás vacío, el cliente se considera <strong>cliente directo</strong> (sin vendedor asignado).
                </p>
              </div>
            )}

            {/* Acceso directo del cliente */}
            <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users size={16} className="text-slate-400" />
                  <span className="text-xs font-black text-slate-400 uppercase tracking-[0.18em]">
                    Acceso del cliente
                  </span>
                </div>
              </div>

              {selectedCustomer.userId ? (
                <div className="space-y-1 text-sm">
                  <p className="text-slate-300">
                    Este cliente ya tiene un usuario asignado.
                  </p>
                  <p className="text-slate-400">
                    Email de acceso:&nbsp;
                    <span className="font-semibold text-slate-100">
                      {currentCustomerUserEmail(selectedCustomer) || '—'}
                    </span>
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Para cambiar contraseña o datos del usuario, usá la sección de usuarios o el flujo de recuperación de contraseña.
                  </p>
                </div>
              ) : (
                <div className="space-y-3 text-sm">
                  <p className="text-slate-300">
                    Creá un usuario para que este cliente pueda ingresar y hacer sus propios pedidos mayoristas.
                  </p>
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide">
                      Email de acceso
                    </label>
                    <input
                      type="email"
                      className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
                      placeholder={selectedCustomer.email || 'cliente@ejemplo.com'}
                      value={accessEmail}
                      onChange={(e) => setAccessEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide">
                      Contraseña inicial
                    </label>
                    <input
                      type="password"
                      className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
                      value={accessPassword}
                      onChange={(e) => setAccessPassword(e.target.value)}
                      placeholder="Mínimo 6 caracteres"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={savingAccessUser || !accessEmail || !accessPassword}
                    onClick={async () => {
                      if (!selectedCustomer) return;
                      if (!accessEmail || !accessPassword) return;
                      setSavingAccessUser(true);
                      try {
                        const payload = {
                          name: selectedCustomer.businessName || selectedCustomer.name || undefined,
                          email: accessEmail || selectedCustomer.email,
                          password: accessPassword,
                        };
                        const updated = await api.attachUserToCustomer(selectedCustomer.id, payload);
                        showToast('success', 'Usuario de cliente creado y asignado.');
                        onUpdateCustomer?.(updated.id, updated);
                        setSelectedCustomer(updated);
                        setAccessEmail('');
                        setAccessPassword('');
                      } catch (e: any) {
                        const msg =
                          e?.response?.data?.message ||
                          e?.message ||
                          'Error creando el usuario del cliente';
                        showToast('error', msg);
                      } finally {
                        setSavingAccessUser(false);
                      }
                    }}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm px-4 py-2.5 transition disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {savingAccessUser && <Loader2 size={16} className="animate-spin" />}
                    <span>Crear usuario para este cliente</span>
                  </button>
                  <p className="text-[11px] text-slate-500">
                    El usuario tendrá rol <strong>CLIENTE</strong> y solo verá sus propios pedidos.
                  </p>
                </div>
              )}
            </div>
            {/* cierre grid de configuración */}
          </div>
        </div>
        )}

        {canViewSaldos && (
          <div className="mt-10 space-y-5">
            <div className="rounded-3xl border border-slate-600/50 bg-gradient-to-b from-slate-900/90 to-slate-950 p-6 shadow-lg ring-1 ring-white/5">
              <div className="flex flex-col gap-2 border-b border-slate-700/60 pb-4 mb-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/15 ring-1 ring-amber-400/30">
                    <Building2 size={22} className="text-amber-300" aria-hidden />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white tracking-tight">
                      Cuenta corriente histórica
                    </h3>
                    <p className="text-[11px] text-slate-500 uppercase tracking-[0.2em] font-semibold">
                      Tango · Multimedias · importación Excel
                    </p>
                  </div>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed max-w-2xl">
                  Historial de movimientos tal como viene del archivo. Los recibos que cargás hoy en Facturación no se listan
                  acá: impactan en el <strong className="text-slate-300">saldo unificado</strong> de arriba.
                </p>
              </div>
            {multimediaLedgerLoading ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
                <Loader2 className="animate-spin" size={18} aria-hidden />
                Cargando historial importado…
              </div>
            ) : multimediaLedger && multimediaLedger.movementCount > 0 ? (
              <div className="space-y-5">
                <p className="text-xs text-slate-400 font-medium">
                  <span className="text-white font-bold tabular-nums">{multimediaLedger.movementCount}</span> movimientos en
                  archivo
                  {multimediaLedger.legacyCode ? (
                    <span className="text-slate-500"> · código legacy {multimediaLedger.legacyCode}</span>
                  ) : null}
                </p>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {migratedBuckets &&
                    renderLedgerTable('Recibos / pagos', <Receipt size={16} className="text-emerald-400 shrink-0" aria-hidden />, migratedBuckets.recibos)}
                  {migratedBuckets &&
                    renderLedgerTable(
                      'Facturas y comprobantes',
                      <FileText size={16} className="text-sky-400 shrink-0" aria-hidden />,
                      migratedBuckets.facturas
                    )}
                  {migratedBuckets &&
                    renderLedgerTable(
                      'Pedidos (sistema anterior)',
                      <Package size={16} className="text-violet-400 shrink-0" aria-hidden />,
                      migratedBuckets.pedidosTango
                    )}
                </div>
                {migratedBuckets && migratedBuckets.otros.length > 0
                  ? renderLedgerTable(
                      'Movimientos sin clasificar',
                      <Clock size={16} className="text-amber-400/90 shrink-0" aria-hidden />,
                      migratedBuckets.otros
                    )
                  : null}
              </div>
            ) : (
              <p className="text-sm text-slate-500 leading-relaxed">
                No hay movimientos importados para este cliente. Desde la cartera importá el Excel de Multimedias: se intenta
                vincular por <strong className="text-slate-400">código legacy</strong>,{' '}
                <strong className="text-slate-400">razón social</strong> (nombre parecido),{' '}
                <strong className="text-slate-400">CUIT</strong> cargado en el cliente o en la fila del Excel, y la columna{' '}
                <strong className="text-slate-400">Cliente</strong> de la hoja Resumen del archivo.
              </p>
            )}
            </div>
          </div>
        )}

        {pendingShipLines.length > 0 && (
          <div className="mt-8 bg-slate-900 rounded-3xl border border-amber-900/35 overflow-hidden">
            <div className="p-4 border-b border-amber-900/25 flex items-center gap-2">
              <Package size={18} className="text-amber-400 shrink-0" aria-hidden />
              <h3 className="font-bold text-white text-sm">Artículos pendientes de envío</h3>
              <span className="text-xs text-amber-200/80 ml-auto tabular-nums">{pendingShipLines.length} línea(s)</span>
            </div>
            <div className="divide-y divide-slate-800 max-h-64 overflow-y-auto">
              {pendingShipLines.map(({ order, item, pendiente }, i) => (
                <div
                  key={`${order.id}-${item.productId ?? i}-${i}`}
                  className="px-4 py-2.5 flex flex-wrap gap-2 justify-between text-sm"
                >
                  <div className="min-w-0">
                    <span className="text-slate-500 text-xs">Pedido #{order.id}</span>
                    <p className="text-slate-200 truncate">{lineTitleForItem(item)}</p>
                    <p className="text-[11px] text-slate-500">{lineMetaForItem(item)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-amber-300 font-bold tabular-nums">{pendiente} u. pend.</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Orders List Section */}
        <div className="bg-slate-900 rounded-3xl border border-slate-800 overflow-hidden">
           <div className="p-6 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="font-bold text-white flex items-center gap-2">
                   <ShoppingBag size={20} className="text-blue-500"/> Pedidos en LupoHub
                </h3>
                <span className="text-xs font-bold text-slate-500 bg-slate-800 px-3 py-1 rounded-full">
                  {visibleOrders.length} / {stats.orders.length} pedidos
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOnlyPendingDispatchInCustomer(v => !v)}
                  className={`px-3 py-2 rounded-xl text-xs font-bold transition border ${
                    onlyPendingDispatchInCustomer
                      ? 'bg-blue-700/30 border-blue-600/50 text-blue-200'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                  }`}
                  title="Filtrar pedidos que todavía tienen unidades pendientes de envío"
                >
                  {onlyPendingDispatchInCustomer ? 'Solo con pendientes' : 'Filtrar pendientes'}
                </button>
                {(role === Role.ADMIN || role === Role.SELLER || role === Role.WAREHOUSE || role === Role.DEPOSITO) && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!selectedCustomer) return;
                      try {
                        const res = await api.clearCustomerDispatchedPendings(selectedCustomer.id);
                        if ((res.ordersUpdated || 0) > 0 || (res.itemsAdjusted || 0) > 0 || (res.itemsRemoved || 0) > 0) {
                          showToast('success', `Listo. Pedidos ajustados: ${res.ordersUpdated}. Ítems ajustados: ${res.itemsAdjusted}.`);
                        } else {
                          showToast('info', 'No había pendientes para quitar en pedidos despachados.');
                        }
                        await onRefreshData?.();
                      } catch (e: any) {
                        showToast('error', e?.message || 'No se pudieron quitar pendientes');
                      }
                    }}
                    className="px-3 py-2 bg-amber-700/30 border border-amber-600/50 rounded-xl text-xs font-bold text-amber-200 hover:bg-amber-700/50 transition"
                    title="Quitar pendientes de pedidos despachados de este cliente (deja solo lo efectivamente enviado)"
                  >
                    Quitar pendientes despachados
                  </button>
                )}
              </div>
           </div>
           
           {visibleOrders.length > 0 ? (
             <div className="divide-y divide-slate-800">
               {visibleOrders.map(order => {
                 const stockImpact = getWholesaleStockImpactMeta(order);
                 return (
                 <div 
                   key={order.id} 
                   onClick={() => setSelectedOrder(order)}
                   className={`p-4 hover:bg-slate-800 transition-colors cursor-pointer flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 group pl-0 ${stockImpact.cardAccentClass}`}
                 >
                    <div className="flex items-center gap-4 pl-4">
                       <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 group-hover:bg-blue-900/20 group-hover:text-blue-400 transition-colors">
                          <Package size={24} />
                       </div>
                       <div>
                          <div className="flex items-center gap-2 flex-wrap">
                             <span className="font-bold text-white">Pedido #{order.id}</span>
                             <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${getStatusColor(order.status)}`}>
                                {order.status}
                             </span>
                             {stockImpact.label && (
                               <span
                                 className={`px-2 py-0.5 rounded-lg text-[9px] font-black flex items-center gap-1 border cursor-help ${stockImpact.badgeClassName}`}
                                 title={stockImpact.title}
                               >
                                 {stockImpact.variant === 'no_impact' && <Package size={9} />}
                                 {stockImpact.variant === 'pending' && <Clock size={9} />}
                                 {stockImpact.variant === 'deducted' && <PackageCheck size={9} />}
                                 {stockImpact.variant === 'not_applied' && <AlertTriangle size={9} />}
                                 {stockImpact.label}
                               </span>
                             )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                             <span className="flex items-center gap-1"><Calendar size={12}/> {order.date}</span>
                             <span className="w-1 h-1 bg-slate-700 rounded-full"></span>
                             <span>{order.items.reduce((a,b) => a + b.quantity, 0)} items</span>
                             {getPendingUnitsForOrder(order) > 0 && (
                               <>
                                 <span className="w-1 h-1 bg-slate-700 rounded-full"></span>
                                 <span className="text-amber-400 font-bold">{getPendingUnitsForOrder(order)} pendiente(s)</span>
                               </>
                             )}
                          </div>
                       </div>
                    </div>
                    
                    <div className="flex items-center gap-6 w-full sm:w-auto justify-between sm:justify-end">
                       <div className="text-right">
                          <p className="font-black text-white text-lg">${order.total.toLocaleString()}</p>
                       </div>
                       <ChevronRight size={20} className="text-slate-600 group-hover:text-blue-400 transition-transform group-hover:translate-x-1" />
                    </div>
                 </div>
               );
               })}
             </div>
           ) : (
              <div className="p-12 text-center text-slate-500">
                 <ShoppingBag size={48} className="mx-auto text-slate-800 mb-4"/>
                 <p className="font-medium">No hay historial de pedidos para este cliente.</p>
              </div>
           )}
        </div>
      </div>
      {editModal}
    </>
    );
  }

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportingExcel(true);
    try {
      const rows = await parseCustomersExcel(file);
      if (rows.length === 0) {
        showToast('warning', 'No se encontraron filas válidas. El Excel debe tener Razón social y CUIT en cada fila.');
        setImportingExcel(false);
        return;
      }
      const res = await api.importCustomers(rows, role === Role.SELLER ? sellerId : undefined);
      const skipped = res.skipped ?? 0;
      if (res.created > 0) {
        let msg = `Se importaron ${res.created} cliente(s).`;
        if (skipped > 0) msg += ` Omitidos (ya existían): ${skipped}.`;
        showToast('success', msg);
        onRefreshData?.();
      } else if (skipped > 0) {
        showToast('info', `Todos los clientes del archivo ya existían (${skipped} omitidos). No se duplicaron.`);
        onRefreshData?.();
      }
      if (res.errors?.length) {
        const msg = res.errors.slice(0, 3).map(e => `Fila ${e.row}: ${e.message}`).join('; ');
        showToast('warning', `${res.errors.length} error(es): ${msg}${res.errors.length > 3 ? '…' : ''}`);
      }
      if (res.created === 0 && skipped === 0 && !res.errors?.length) {
        showToast('warning', 'No se creó ningún cliente. Revisá que haya columnas Razón social y CUIT (o Número).');
      }
    } catch (err: any) {
      showToast('error', err?.message || 'Error al importar el Excel.');
    }
    setImportingExcel(false);
  };

  const handleCuitUpdateExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUpdatingCuit(true);
    try {
      const rows = await parseCustomersCuitUpdateExcel(file);
      if (rows.length === 0) {
        showToast('warning', 'No se encontraron filas con CUIT. El Excel debe tener Razón social o Email + columna CUIT/Número.');
        setUpdatingCuit(false);
        return;
      }
      const res = await api.bulkUpdateCuit(rows);
      if (res.updated > 0) {
        showToast('success', `Se actualizó el CUIT a ${res.updated} cliente(s).`);
        onRefreshData?.();
      }
      if (res.notFound > 0) {
        showToast('info', `${res.notFound} fila(s) no coincidieron con ningún cliente (revisá razón social o email).`);
      }
      if (res.errors?.length) {
        const msg = res.errors.slice(0, 3).map(er => `Fila ${er.row}: ${er.message}`).join('; ');
        showToast('warning', `${res.errors.length} error(es): ${msg}${res.errors.length > 3 ? '…' : ''}`);
      }
      if (res.updated === 0 && res.notFound === 0 && !res.errors?.length) {
        showToast('info', 'No se actualizó ningún cliente.');
      }
    } catch (err: any) {
      showToast('error', err?.message || 'Error al actualizar CUIT.');
    }
    setUpdatingCuit(false);
  };

  const handleMultimediaHistorialImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMultimediaImporting(true);
    try {
      const res = await api.importMultimediaHistorial(file);
      showToast(
        'success',
        `${res.customersUpdated} cliente(s) actualizados, ${res.rowsInserted} filas de historial importadas.`
      );
      if (res.notFoundCount > 0) {
        showToast(
          'warning',
          `${res.notFoundCount} hoja(s) sin cliente coincidente. Revisá CUIT en el cliente, razón social, código legacy o la hoja Resumen del Excel.`
        );
      }
      if (res.skippedCount > 0) {
        showToast('info', `${res.skippedCount} hoja(s) omitidas (no son clientes asignados a tu usuario).`);
      }
      onRefreshData?.();
      loadCarteraTotals();
      if (selectedCustomer) {
        try {
          const ledger = await api.getCustomerMultimediaLedger(selectedCustomer.id);
          setMultimediaLedger(ledger);
        } catch {
          /* ignore */
        }
      }
    } catch (err: any) {
      showToast('error', err?.message || 'Error al importar el Excel de historial.');
    }
    setMultimediaImporting(false);
  };

  const handleAssignSellersFromResumen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAssigningSellersResumen(true);
    try {
      const res = await api.assignCustomerSellersFromResumen(file);
      showToast(
        'success',
        `${res.customersUpdated} cliente(s) con vendedor asignado (${res.rowsProcessed} filas del Resumen).`
      );
      if (res.skippedNoCustomer > 0) {
        showToast('warning', `${res.skippedNoCustomer} fila(s) sin cliente coincidente (código o nombre).`);
      }
      if (res.skippedNoSeller > 0) {
        showToast('info', `${res.skippedNoSeller} fila(s) sin vendedor en el sistema (importá vendedores desde Configuración primero).`);
      }
      if (res.skippedNoVendedorCell > 0) {
        showToast('info', `${res.skippedNoVendedorCell} fila(s) sin texto en "Vendedor habitual".`);
      }
      onRefreshData?.();
    } catch (err: any) {
      showToast('error', err?.message || 'Error al asignar vendedores desde el Resumen.');
    }
    setAssigningSellersResumen(false);
  };

  // 3. List View (Default)
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-white">Cartera de Clientes</h2>
        <div className="flex gap-2">
          <input
            ref={importExcelInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleImportExcel}
          />
          <input
            ref={cuitUpdateInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleCuitUpdateExcel}
          />
          {canViewSaldos && (
            <input
              ref={multimediaHistorialInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleMultimediaHistorialImport}
            />
          )}
          {role === Role.ADMIN && (
            <input
              ref={assignSellersResumenInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleAssignSellersFromResumen}
            />
          )}
          {canViewSaldos && (
            <button
              type="button"
              onClick={async () => {
                setWholesaleMetricsExporting(true);
                try {
                  await api.exportWholesaleTopProductsMetrics();
                  showToast('success', 'Excel de métricas mayoristas descargado.');
                } catch (err: any) {
                  showToast('error', err?.message || 'Error al exportar métricas mayoristas.');
                }
                setWholesaleMetricsExporting(false);
              }}
              disabled={wholesaleMetricsExporting}
              className="bg-fuchsia-900/40 text-fuchsia-100 px-4 py-2 rounded-lg hover:bg-fuchsia-900/55 border border-fuchsia-700/50 transition flex items-center gap-2 font-medium disabled:opacity-50"
              title="Top de artículos más pedidos en mayorista"
            >
              {wholesaleMetricsExporting ? <Loader2 size={18} className="animate-spin" /> : <FileSpreadsheet size={18} />}
              <span>{wholesaleMetricsExporting ? 'Exportando…' : 'Métricas mayorista (Top artículos)'}</span>
            </button>
          )}
          {canViewSaldos && (
            <button
              type="button"
              onClick={async () => {
                setSaldosMultimediasExporting(true);
                try {
                  await api.exportSaldosPendientesMultimedias();
                  showToast('success', 'Excel descargado: hoja Resumen con saldos pendientes de cobro (formato Multimedias).');
                } catch (err: any) {
                  showToast('error', err?.message || 'Error al exportar.');
                }
                setSaldosMultimediasExporting(false);
              }}
              disabled={saldosMultimediasExporting}
              className="bg-amber-900/40 text-amber-100 px-4 py-2 rounded-lg hover:bg-amber-900/55 border border-amber-700/50 transition flex items-center gap-2 font-medium disabled:opacity-50"
              title="Una hoja Resumen con formato: código, cliente, vendedor, zona, saldo pendiente unificado, movimientos (sin columna Hoja)"
            >
              {saldosMultimediasExporting ? <Loader2 size={18} className="animate-spin" /> : <FileSpreadsheet size={18} />}
              <span>{saldosMultimediasExporting ? 'Exportando…' : 'Excel saldos pendientes (Resumen)'}</span>
            </button>
          )}
          {canViewSaldos && (
            <button
              type="button"
              onClick={async () => {
                setMultimediaExporting(true);
                try {
                  await api.exportMultimediaHistorial();
                  showToast('success', 'Excel de historial Multimedias descargado.');
                } catch (err: any) {
                  showToast('error', err?.message || 'Error al exportar.');
                }
                setMultimediaExporting(false);
              }}
              disabled={multimediaExporting}
              className="bg-slate-700 text-white px-4 py-2 rounded-lg hover:bg-slate-600 border border-slate-600 transition flex items-center gap-2 font-medium disabled:opacity-50"
              title="Genera el mismo formato que el Excel historial_clientes_multimedias (Resumen + una hoja por cliente)"
            >
              {multimediaExporting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
              <span>{multimediaExporting ? 'Exportando…' : 'Exportar historial Multimedias'}</span>
            </button>
          )}
          {canViewSaldos && (
            <button
              type="button"
              onClick={() => multimediaHistorialInputRef.current?.click()}
              disabled={multimediaImporting}
              className="bg-slate-700 text-white px-4 py-2 rounded-lg hover:bg-slate-600 border border-slate-600 transition flex items-center gap-2 font-medium disabled:opacity-50"
              title="Importa movimientos desde el Excel; reemplaza el historial guardado por cada cliente que se pueda vincular"
            >
              {multimediaImporting ? <Loader2 size={18} className="animate-spin" /> : <FileSpreadsheet size={18} />}
              <span>{multimediaImporting ? 'Importando…' : 'Importar historial Multimedias'}</span>
            </button>
          )}
          {role === Role.ADMIN && (
            <button
              type="button"
              onClick={() => assignSellersResumenInputRef.current?.click()}
              disabled={assigningSellersResumen}
              className="bg-indigo-900/50 text-indigo-100 px-4 py-2 rounded-lg hover:bg-indigo-900/70 border border-indigo-700/40 transition flex items-center gap-2 font-medium disabled:opacity-50"
              title="Misma hoja Resumen del Excel Multimedias: asigna cada cliente al vendedor de la columna Vendedor habitual (usuarios importados vendedor.N@importado.lupohub.local)"
            >
              {assigningSellersResumen ? <Loader2 size={18} className="animate-spin" /> : <Users size={18} />}
              <span>{assigningSellersResumen ? 'Asignando…' : 'Asignar vendedores (Resumen)'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => cuitUpdateInputRef.current?.click()}
            disabled={updatingCuit}
            className="bg-slate-700 text-white px-4 py-2 rounded-lg hover:bg-slate-600 border border-slate-600 transition flex items-center gap-2 font-medium disabled:opacity-50"
            title="Excel con Razón social o Email + CUIT para actualizar solo el CUIT de clientes existentes"
          >
            {updatingCuit ? <Loader2 size={18} className="animate-spin" /> : <FileSpreadsheet size={18} />}
            <span>{updatingCuit ? 'Actualizando…' : 'Actualizar CUIT en lote'}</span>
          </button>
          <button
            type="button"
            onClick={() => importExcelInputRef.current?.click()}
            disabled={importingExcel}
            className="bg-slate-700 text-white px-4 py-2 rounded-lg hover:bg-slate-600 border border-slate-600 transition flex items-center gap-2 font-medium disabled:opacity-50"
          >
            {importingExcel ? <Loader2 size={18} className="animate-spin" /> : <FileSpreadsheet size={18} />}
            <span>{importingExcel ? 'Importando…' : 'Importar Excel'}</span>
          </button>
          <button 
            onClick={() => { setIsCreating(true); setEditingCustomer(null); setNewBusinessName(''); setNewContactName(''); setNewEmail(''); setNewAddress(''); setNewCity(''); setNewCuit(''); setNewPhone(''); setNewTransportNumber(''); setNewRemitoNumber(''); setNewSaleCondition(''); setNewCondicionIva(''); setNewLegacyCode(''); setNewAccountZone(''); setNewAccountSellerLabel(''); setSelectedTransporteIds([]); }}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition flex items-center gap-2 shadow-lg shadow-blue-900/50 font-medium"
          >
            <Plus size={18} />
            <span>Nuevo Cliente</span>
          </button>
        </div>
      </div>

      <div className="bg-slate-800 rounded-xl shadow-lg border border-slate-700 overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-slate-700 bg-slate-900/50 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="relative max-w-md flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text"
                placeholder="Buscar: razón social, contacto, email, ciudad, CUIT, código…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-white placeholder-slate-500 text-sm"
              />
            </div>
            {users.some((u) => u.role === Role.SELLER) && (
              <button
                type="button"
                onClick={() => setGroupBySeller((v) => !v)}
                className={`shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border transition ${
                  groupBySeller
                    ? 'bg-blue-600/25 border-blue-500/50 text-blue-100'
                    : 'bg-slate-950 border-slate-700 text-slate-300 hover:border-slate-600'
                }`}
                title={searchTerm.trim() ? 'Desactivá la búsqueda para ver grupos por vendedor' : 'Agrupa las tarjetas por vendedor asignado'}
              >
                <LayoutList size={16} />
                Agrupar por vendedor
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {role === Role.ADMIN && users.some((u) => u.role === Role.SELLER) && (
              <div className="flex items-center gap-2 min-w-0">
                <Filter size={14} className="text-slate-500 shrink-0" />
                <label className="sr-only" htmlFor="customers-seller-filter">
                  Filtrar por vendedor
                </label>
                <select
                  id="customers-seller-filter"
                  value={sellerFilterId}
                  onChange={(e) => setSellerFilterId(e.target.value)}
                  className="max-w-[min(100%,220px)] bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">Todos los vendedores</option>
                  <option value="__none__">Sin vendedor asignado</option>
                  {users
                    .filter((u) => u.role === Role.SELLER)
                    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                </select>
              </div>
            )}
            <div className="flex items-center gap-2 min-w-0 flex-1 sm:flex-initial">
              <ArrowUpDown size={14} className="text-slate-500 shrink-0" />
              <label className="sr-only" htmlFor="customers-sort">
                Ordenar
              </label>
              <select
                id="customers-sort"
                value={sortPreset}
                onChange={(e) => setSortPreset(e.target.value as SortPreset)}
                className="flex-1 sm:min-w-[240px] sm:max-w-sm bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="business_asc">Orden: razón social (A→Z)</option>
                <option value="business_desc">Orden: razón social (Z→A)</option>
                <option value="contact_asc">Orden: contacto (A→Z)</option>
                <option value="city_asc">Orden: ciudad (A→Z)</option>
                {canViewSaldos && (
                  <>
                    <option value="saldo_desc">Orden: mayor saldo pendiente</option>
                    <option value="saldo_asc">Orden: menor saldo pendiente</option>
                  </>
                )}
                {role === Role.ADMIN && users.some((u) => u.role === Role.SELLER) && (
                  <option value="seller_asc">Orden: vendedor (A→Z)</option>
                )}
              </select>
            </div>
          </div>
        </div>

        {/* List Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
          {groupedForList.map((group) => (
            <React.Fragment key={group.key}>
              {group.label ? (
                <div className="col-span-full flex items-center gap-2 pt-2 pb-1 border-b border-slate-700/80 -mt-1 first:pt-0 first:mt-0">
                  <Users size={16} className="text-slate-500 shrink-0" />
                  <span className="text-sm font-semibold text-slate-300">{group.label}</span>
                  <span className="text-xs text-slate-500">({group.customers.length})</span>
                </div>
              ) : null}
              {group.customers.map((customer) => {
            const saldoPendienteTotal = getSaldoPendienteTotal(customer);
            return (
            <div 
              key={customer.id} 
              onClick={() => setSelectedCustomer(customer)}
              className="bg-slate-900 p-5 rounded-2xl border border-slate-800 hover:border-blue-500/50 hover:shadow-xl hover:shadow-blue-900/10 transition-all group cursor-pointer active:scale-[0.98] relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-blue-600/10 to-transparent rounded-bl-full -mr-4 -mt-4 transition-opacity group-hover:opacity-100 opacity-0"></div>

              <div className="flex items-start justify-between mb-4 relative z-10">
                <div className="bg-slate-800 p-3 rounded-xl text-slate-400 group-hover:text-white group-hover:bg-blue-600 transition-colors shadow-sm">
                   <Building2 size={24} />
                </div>
                <div className="flex items-center gap-2">
                  {onDeleteCustomer && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`¿Eliminar a "${customer.businessName}"?`)) {
                          Promise.resolve(onDeleteCustomer(customer.id)).catch(() => {});
                        }
                      }}
                      className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-900/20 transition"
                      title="Eliminar cliente"
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                  {role === Role.ADMIN && (
                    <span className="text-[10px] bg-slate-800 border border-slate-700 text-slate-400 px-2 py-1 rounded font-mono" title={customer.id}>ID: {customer.id?.slice(0, 8) || '—'}</span>
                  )}
                </div>
              </div>
              
              <div className="relative z-10">
                <h3 className="text-lg font-bold text-white mb-0.5 truncate">{customer.businessName}</h3>
                <p className="text-sm text-slate-400 mb-2 truncate">{customer.name}</p>

                {canViewSaldos && (
                  <div
                    className="mb-2 rounded-xl border border-slate-600/35 bg-slate-900/55 px-2.5 py-2 text-[11px]"
                    title="Suma del saldo de cuenta importada (Excel) y del saldo pendiente de pedidos en LupoHub."
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 text-slate-400 font-bold uppercase text-[10px] tracking-wide">
                        <Wallet size={12} className="text-slate-500 shrink-0" />
                        Saldo pendiente
                      </div>
                      <span className="text-white font-bold tabular-nums text-right">
                        {saldosLoading
                          ? '...'
                          : `$${saldoPendienteTotal.toLocaleString('es-AR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2
                            })}`}
                      </span>
                    </div>
                  </div>
                )}

                {role === Role.ADMIN && customer.sellerId && (
                  <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-slate-800/80 border border-slate-700 px-2 py-1 text-[11px] text-slate-300">
                    <Users size={11} className="text-slate-400" />
                    <span>Vendedor: {getSellerName(customer.sellerId) || customer.sellerId.slice(0, 6)}</span>
                  </div>
                )}
                
                <div className="space-y-2 text-xs border-t border-slate-800 pt-3 mt-2">
                  <div className="flex items-center text-slate-500 truncate">
                    <Mail size={12} className="mr-2 text-slate-600 shrink-0" />
                    {customer.email}
                  </div>
                  {customer.cuit && (
                    <div className="flex items-center text-slate-500 truncate font-mono">
                      <span className="mr-2 text-slate-600 shrink-0">CUIT</span>
                      {customer.cuit}
                    </div>
                  )}
                  {customer.transportes && customer.transportes.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap text-slate-500">
                      <Truck size={12} className="text-slate-600 shrink-0" />
                      {customer.transportes.map(t => t.name).join(', ')}
                    </div>
                  )}
                  <div className="flex items-center text-slate-500 truncate">
                    <MapPin size={12} className="mr-2 text-slate-600 shrink-0" />
                    {customer.address}, {customer.city}
                  </div>
                </div>
              </div>
              
              <div className="mt-4 flex items-center justify-end text-blue-500 text-xs font-bold opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0">
                 Ver Perfil Completo <ArrowRight size={12} className="ml-1"/>
              </div>
            </div>
            );
              })}
            </React.Fragment>
          ))}
          {displayCustomers.length === 0 && (
            <div className="col-span-full py-16 text-center text-slate-500">
               <Users size={48} className="mx-auto text-slate-800 mb-4"/>
               <p>No hay clientes que coincidan con la búsqueda, el filtro de vendedor u orden aplicado.</p>
            </div>
          )}
        </div>
      </div>

      {/* Modal Crear / Editar Cliente */}
      {(isCreating || editingCustomer) && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-slate-900 rounded-3xl w-full max-w-lg border border-slate-700 shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900 rounded-t-3xl">
              <h3 className="text-xl font-bold text-white">{editingCustomer ? 'Editar cliente' : 'Alta de Cliente'}</h3>
              <button
                onClick={() => { setIsCreating(false); setEditingCustomer(null); setNewPhone(''); setNewTransportNumber(''); setNewRemitoNumber(''); setNewSaleCondition(''); setNewCondicionIva(''); setNewLegacyCode(''); setNewAccountZone(''); setNewAccountSellerLabel(''); setSelectedTransporteIds([]); }}
                className="text-slate-400 hover:text-white bg-slate-800 p-2 rounded-full hover:bg-slate-700 transition"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Razón Social</label>
                <input 
                  type="text" 
                  className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  value={newBusinessName}
                  onChange={(e) => setNewBusinessName(e.target.value)}
                  placeholder="Ej: Lenceria Perez SRL"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Nombre Contacto</label>
                <input 
                  type="text" 
                  className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  value={newContactName}
                  onChange={(e) => setNewContactName(e.target.value)}
                  placeholder="Ej: Juan Perez"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Email</label>
                <input 
                  type="email" 
                  className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="contacto@empresa.com"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">CUIT / CUIL (para facturación)</label>
                <input
                  type="text"
                  className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-mono"
                  value={newCuit}
                  onChange={(e) => setNewCuit(e.target.value.replace(/\D/g, '').slice(0, 11))}
                  placeholder="20-12345678-9 (solo números)"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Teléfono</label>
                <input 
                  type="text" 
                  className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="Ej: 11 1234-5678"
                />
              </div>
                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">N° Transporte</label>
                  <input
                    type="text"
                    className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                    value={newTransportNumber}
                    onChange={(e) => setNewTransportNumber(e.target.value)}
                    placeholder="Ej: 12345"
                  />
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">N° Remito</label>
                  <input
                    type="text"
                    className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                    value={newRemitoNumber}
                    onChange={(e) => setNewRemitoNumber(e.target.value)}
                    placeholder="Ej: R-0001-00001234"
                  />
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Condición de venta</label>
                  <select
                    className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                    value={newSaleCondition}
                    onChange={(e) => setNewSaleCondition(e.target.value)}
                  >
                    <option value="">— Seleccionar —</option>
                    {CONDICIONES_VENTA.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                    {newSaleCondition && !CONDICIONES_VENTA.includes(newSaleCondition) && (
                      <option value={newSaleCondition}>{newSaleCondition}</option>
                    )}
                  </select>
                </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Condición de IVA</label>
                <select
                  className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  value={newCondicionIva}
                  onChange={(e) => setNewCondicionIva(e.target.value)}
                >
                  <option value="">— Seleccionar —</option>
                  {CONDICIONES_IVA.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                  {newCondicionIva && !CONDICIONES_IVA.includes(newCondicionIva) && (
                    <option value={newCondicionIva}>{newCondicionIva}</option>
                  )}
                </select>
              </div>
              {transportes.length > 0 && (
                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase mb-2 ml-1">Transportes (factura, remitos y despacho)</label>
                  <p className="text-[10px] text-slate-500 mb-2 ml-1">Si el cliente usa varios, marcá todos; al imprimir la factura podés elegir uno o listar todos.</p>
                  <div className="flex flex-wrap gap-2">
                    {transportes.map(t => (
                      <label key={t.id} className="flex items-center gap-2 px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl cursor-pointer hover:bg-slate-750 transition">
                        <input
                          type="checkbox"
                          checked={selectedTransporteIds.includes(t.id)}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedTransporteIds(prev => [...prev, t.id]);
                            else setSelectedTransporteIds(prev => prev.filter(id => id !== t.id));
                          }}
                          className="rounded border-slate-600 text-blue-500 focus:ring-blue-500"
                        />
                        <span className="text-sm text-slate-200">{t.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Dirección</label>
                    <input 
                      type="text" 
                      className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                      value={newAddress}
                      onChange={(e) => setNewAddress(e.target.value)}
                      placeholder="Calle 123"
                    />
                </div>
                <div>
                    <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Ciudad</label>
                    <input 
                      type="text" 
                      className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                      value={newCity}
                      onChange={(e) => setNewCity(e.target.value)}
                      placeholder="CABA"
                    />
                </div>
              </div>
              <div className="pt-3 border-t border-slate-800/80">
                <p className="text-[10px] text-slate-500 uppercase font-black mb-2 ml-1">Cuenta corriente / Excel Multimedias</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Código legacy</label>
                    <input type="text" className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-mono text-sm" value={newLegacyCode} onChange={(e) => setNewLegacyCode(e.target.value)} placeholder="Ej: 000809" />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Zona (export)</label>
                    <input type="text" className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-sm" value={newAccountZone} onChange={(e) => setNewAccountZone(e.target.value)} placeholder="Ej: 02 - Interior" />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Vendedor habitual (export)</label>
                    <input type="text" className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-sm" value={newAccountSellerLabel} onChange={(e) => setNewAccountSellerLabel(e.target.value)} placeholder="Ej: 27 - Colombo" />
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-slate-800 bg-slate-900 rounded-b-3xl flex justify-end gap-3">
              <button 
                onClick={() => { setIsCreating(false); setEditingCustomer(null); setNewPhone(''); setNewTransportNumber(''); setNewRemitoNumber(''); setNewSaleCondition(''); setNewCondicionIva(''); setNewLegacyCode(''); setNewAccountZone(''); setNewAccountSellerLabel(''); setSelectedTransporteIds([]); }}
                className="px-5 py-2.5 text-slate-400 hover:bg-slate-800 rounded-xl transition font-medium"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSave}
                disabled={!newBusinessName || !newEmail}
                className="bg-blue-600 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-blue-900/40 active:scale-95 transition-all"
              >
                <Save size={18} />
                {editingCustomer ? 'Guardar cambios' : 'Guardar Cliente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Customers;