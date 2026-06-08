import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Users, Search, Plus, MapPin, Mail, Phone, Building2, Save, X, ShoppingBag, Calendar, DollarSign, TrendingUp, Clock, ArrowRight, ArrowLeft, Package, PackageCheck, Star, ChevronRight, Pencil, Trash2, FileSpreadsheet, Loader2, Download, Receipt, FileText, LayoutList, Wallet, ArrowUpDown, Filter, AlertTriangle, ChevronDown, SlidersHorizontal, ExternalLink } from 'lucide-react';
import { Customer, Role, Order, OrderItem, OrderStatus, Product, Transporte, User, CustomerDeliveryAddress } from '../types';
import { Truck } from 'lucide-react';
import { parseCustomersExcel, parseCustomersCuitUpdateExcel } from '../utils/customersUtils';
import { api } from '../services/api';
import { useNotification } from '../context/NotificationContext';
import { getWholesaleStockImpactMeta } from '../utils/orderStockImpact';
import { orderPedidoImporteDisplay } from '../utils/wholesaleInvoiceHtml';
import { formatMoneyAr } from '../utils/moneyFormat';
import { formatOrderDate } from '../utils/formatDate';
import { canonicalizeCityInput, cityDisplayLabel, isCabaCity, normalizeCityKey } from '../utils/cityNormalize';
import { CityInput } from './CityInput';
import { isVoidedReinvoiceLedgerEntry, ledgerTipoDisplay, normalizeLedgerDocType } from '../utils/ledgerDocType';

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
  const { showToast, showConfirm } = useNotification();
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
  /** Saldo unificado por cliente: cuenta importada + pedidos LupoHub − NC − recibos. */
  const [carteraById, setCarteraById] = useState<
    Record<
      string,
      {
        saldoPendienteUnificado: number;
        orderCargosPendientes: number;
        totalNotasCredito: number;
        multimediaSaldo: number;
        totalPagos: number;
      }
    >
  >({});
  const [saldosLoading, setSaldosLoading] = useState(false);
  const LEDGER_MOVEMENTS_PAGE = 40;
  const [ledgerVisibleCount, setLedgerVisibleCount] = useState(LEDGER_MOVEMENTS_PAGE);
  const [detailActionsOpen, setDetailActionsOpen] = useState(false);

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
            totalNotasCredito: number;
            multimediaSaldo: number;
            totalPagos: number;
          }
        > = {};
        for (const r of rows) {
          m[r.customerId] = {
            saldoPendienteUnificado: (() => {
              const n = Number(r.saldoPendienteUnificado);
              return Number.isFinite(n) ? n : 0;
            })(),
            orderCargosPendientes: Number(r.orderCargosPendientes) || 0,
            totalNotasCredito: Number(r.totalNotasCredito) || 0,
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
      setFinancialSummaryMovements([]);
      setSelectedLedgerEntry(null);
      return;
    }
    let cancelled = false;
    setMultimediaLedgerLoading(true);
    setFinancialSummaryMovements([]);
    setSelectedLedgerEntry(null);
    api
      .getCustomerMultimediaLedger(selectedCustomer.id)
      .then((d) => {
        if (cancelled) return;
        setMultimediaLedger(d);
        const ct = (d as { carteraTotals?: typeof carteraById[string] }).carteraTotals;
        const saldoUni = Number((d as { saldoPendienteUnificado?: number }).saldoPendienteUnificado);
        if (ct && Number.isFinite(saldoUni)) {
          setCarteraById((prev) => ({
            ...prev,
            [selectedCustomer.id]: {
              orderCargosPendientes: Number(ct.orderCargosPendientes) || 0,
              totalNotasCredito: Number(ct.totalNotasCredito) || 0,
              totalPagos: Number(ct.totalPagos) || 0,
              multimediaSaldo: 0,
              saldoPendienteUnificado: saldoUni
            }
          }));
        }
        if (!d.entries?.length) {
          api
            .getCustomerFinancialSummary(selectedCustomer.id)
            .then((summary) => {
              if (!cancelled) setFinancialSummaryMovements(summary.movements || []);
            })
            .catch(() => {
              if (!cancelled) setFinancialSummaryMovements([]);
            });
        }
      })
      .catch((err: any) => {
        if (cancelled) return;
        setMultimediaLedger(null);
        showToast('error', err?.message || 'No se pudo cargar el detalle de movimientos');
      })
      .finally(() => {
        if (!cancelled) setMultimediaLedgerLoading(false);
      });
    if (canViewSaldos) loadCarteraTotals();
    return () => {
      cancelled = true;
    };
  }, [selectedCustomer?.id, selectedCustomer?.openingBalance, selectedCustomer?.openingBalanceDate, canViewSaldos]);

  useEffect(() => {
    setLedgerVisibleCount(LEDGER_MOVEMENTS_PAGE);
  }, [selectedCustomer?.id]);

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
  const [newOpeningBalance, setNewOpeningBalance] = useState('');
  const [newOpeningBalanceDate, setNewOpeningBalanceDate] = useState('');
  const [selectedTransporteIds, setSelectedTransporteIds] = useState<string[]>([]);
  /** Sucursales / puntos de entrega adicionales (se guardan en `deliveryAddresses`). */
  const [deliveryBranchRows, setDeliveryBranchRows] = useState<CustomerDeliveryAddress[]>([]);
  const multimediaHistorialInputRef = useRef<HTMLInputElement>(null);
  const assignSellersResumenInputRef = useRef<HTMLInputElement>(null);
  const [groupBySeller, setGroupBySeller] = useState(false);
  const [assigningSellersResumen, setAssigningSellersResumen] = useState(false);
  const [multimediaExporting, setMultimediaExporting] = useState(false);
  const [multimediaImporting, setMultimediaImporting] = useState(false);
  const [saldosMultimediasExporting, setSaldosMultimediasExporting] = useState(false);
  const [wholesaleMetricsExporting, setWholesaleMetricsExporting] = useState(false);
  const [exportingCustomersWithLocation, setExportingCustomersWithLocation] = useState(false);
  const [customerToolsOpen, setCustomerToolsOpen] = useState(false);
  const [customerToolsPosition, setCustomerToolsPosition] = useState<{ top: number; left: number } | null>(null);
  const customerToolsRef = useRef<HTMLDivElement>(null);
  const [customerOrdersMenuOpen, setCustomerOrdersMenuOpen] = useState(false);
  const [customerOrdersMenuPosition, setCustomerOrdersMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const customerOrdersMenuRef = useRef<HTMLDivElement>(null);
  const [showExportSheetsModal, setShowExportSheetsModal] = useState(false);
  const [exportSheetSelectedIds, setExportSheetSelectedIds] = useState<string[]>([]);
  const [exportingSheets, setExportingSheets] = useState(false);
  const [showCustomerDetailExportModal, setShowCustomerDetailExportModal] = useState(false);
  const [customerDetailExportFrom, setCustomerDetailExportFrom] = useState('');
  const [customerDetailExportTo, setCustomerDetailExportTo] = useState('');
  const [exportingCustomerDetail, setExportingCustomerDetail] = useState(false);
  const [exportingFinancialSummary, setExportingFinancialSummary] = useState(false);
  const [multimediaLedger, setMultimediaLedger] = useState<Awaited<ReturnType<typeof api.getCustomerMultimediaLedger>> | null>(null);
  const [multimediaLedgerLoading, setMultimediaLedgerLoading] = useState(false);
  const [selectedLedgerEntry, setSelectedLedgerEntry] = useState<
    NonNullable<Awaited<ReturnType<typeof api.getCustomerMultimediaLedger>>['entries']>[number] | null
  >(null);
  const [financialSummaryMovements, setFinancialSummaryMovements] = useState<
    Awaited<ReturnType<typeof api.getCustomerFinancialSummary>>['movements']
  >([]);

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
    if (c.city) {
      if (inText(c.city)) return true;
      if (normalizeCityKey(qRaw) === 'caba' && isCabaCity(c.city)) return true;
      if (isCabaCity(qRaw) && isCabaCity(c.city)) return true;
    }
    if (c.legacyCode && String(c.legacyCode).toLowerCase().includes(q.replace(/\s/g, ''))) return true;
    const qDigits = q.replace(/\D/g, '');
    if (qDigits.length >= 4 && c.cuit) {
      const cuitDigits = c.cuit.replace(/\D/g, '');
      if (cuitDigits.includes(qDigits)) return true;
    }
    return false;
  };

  /** Saldo unificado API (misma fórmula que el saldo corrido del historial). */
  const getSaldoPendienteTotal = (c: Customer) => {
    const t = carteraById[c.id];
    if (t == null) return 0;
    const n = Number(t.saldoPendienteUnificado);
    return Number.isFinite(n) ? n : 0;
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

  const normalizedDeliveryBranches = (): CustomerDeliveryAddress[] =>
    deliveryBranchRows
      .map((r, idx) => ({
        id: (r.id || '').trim() || `da-${Date.now()}-${idx}`,
        label: (r.label || 'Sucursal').trim() || 'Sucursal',
        address: r.address.trim(),
        city: canonicalizeCityInput(r.city || ''),
      }))
      .filter((r) => r.address.length > 0);

  const handleSave = () => {
    if (!newBusinessName || !newEmail) return;

    if (editingCustomer && onUpdateCustomer) {
      const data: Partial<Customer> = {
        businessName: newBusinessName,
        name: newContactName,
        email: newEmail,
        address: newAddress || undefined,
        city: canonicalizeCityInput(newCity) || undefined,
        cuit: newCuit || undefined,
        phone: newPhone || undefined,
        transportNumber: newTransportNumber || undefined,
        remitoNumber: newRemitoNumber || undefined,
        saleCondition: newSaleCondition || undefined,
        condicionIva: newCondicionIva || undefined,
        transporteIds: selectedTransporteIds,
        legacyCode: newLegacyCode.trim() || undefined,
        accountZone: newAccountZone.trim() || undefined,
        accountSellerLabel: newAccountSellerLabel.trim() || undefined,
        deliveryAddresses: normalizedDeliveryBranches(),
        ...(role === Role.ADMIN
          ? {
              openingBalance: newOpeningBalance.trim()
                ? Number(newOpeningBalance.replace(/\./g, '').replace(',', '.'))
                : null,
              openingBalanceDate: newOpeningBalanceDate.trim() || null
            }
          : {})
      };
      Promise.resolve(onUpdateCustomer(editingCustomer.id, data)).then(() => {
        setSelectedCustomer(prev => prev?.id === editingCustomer.id ? { ...prev, ...data, transportes: selectedTransporteIds.map(id => ({ id, name: transportes.find(t => t.id === id)?.name ?? '' })), deliveryAddresses: normalizedDeliveryBranches() } : prev);
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
        setNewOpeningBalance('');
        setNewOpeningBalanceDate('');
        setSelectedTransporteIds([]);
        setDeliveryBranchRows([]);
        loadCarteraTotals();
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
      city: canonicalizeCityInput(newCity) || undefined,
      cuit: newCuit || undefined,
      phone: newPhone || undefined,
      transportNumber: newTransportNumber || undefined,
      remitoNumber: newRemitoNumber || undefined,
      saleCondition: newSaleCondition || undefined,
      condicionIva: newCondicionIva || undefined,
      legacyCode: newLegacyCode.trim() || undefined,
      accountZone: newAccountZone.trim() || undefined,
      accountSellerLabel: newAccountSellerLabel.trim() || undefined,
      transportes: selectedTransporteIds.map(id => ({ id, name: transportes.find(t => t.id === id)?.name ?? '' })),
      deliveryAddresses: normalizedDeliveryBranches(),
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
    setDeliveryBranchRows([]);
  };

  const renderDeliveryBranchesBlock = () => (
    <div className="pt-3 border-t border-slate-800/80">
      <p className="text-[10px] text-slate-500 uppercase font-black mb-1 ml-1">Sucursales u otras direcciones de entrega</p>
      <p className="text-[10px] text-slate-500 mb-3 ml-1">Opcional: al generar el remito se puede elegir una de estas direcciones en lugar de la principal.</p>
      <div className="space-y-3">
        {deliveryBranchRows.map((row, idx) => (
          <div key={row.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
            <div className="flex justify-between items-center gap-2">
              <span className="text-[10px] font-bold text-slate-500 uppercase">Punto de entrega {idx + 1}</span>
              <button
                type="button"
                onClick={() => setDeliveryBranchRows((prev) => prev.filter((_, i) => i !== idx))}
                className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
              >
                <Trash2 size={14} /> Quitar
              </button>
            </div>
            <input
              type="text"
              className="w-full p-2 bg-slate-900 border border-slate-800 rounded-lg text-white text-sm"
              placeholder="Nombre (ej: Sucursal Rosario)"
              value={row.label}
              onChange={(e) => setDeliveryBranchRows((prev) => prev.map((r, i) => (i === idx ? { ...r, label: e.target.value } : r)))}
            />
            <input
              type="text"
              className="w-full p-2 bg-slate-900 border border-slate-800 rounded-lg text-white text-sm"
              placeholder="Dirección"
              value={row.address}
              onChange={(e) => setDeliveryBranchRows((prev) => prev.map((r, i) => (i === idx ? { ...r, address: e.target.value } : r)))}
            />
            <CityInput
              compact
              value={row.city}
              onChange={(v) => setDeliveryBranchRows((prev) => prev.map((r, i) => (i === idx ? { ...r, city: v } : r)))}
              placeholder="Ciudad / localidad"
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() =>
          setDeliveryBranchRows((prev) => [
            ...prev,
            { id: `da-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, label: 'Sucursal', address: '', city: '' },
          ])
        }
        className="mt-3 w-full py-2 text-sm font-semibold text-blue-300 border border-blue-700/50 rounded-xl hover:bg-blue-900/20 transition"
      >
        + Agregar sucursal
      </button>
    </div>
  );

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

  const isLedgerCreditNote = (e: LedgerEntry) => normalizeLedgerDocType(e.tipo, e.detalle) === 'NC';

  const parseOrderIdFromLedgerDetalle = (detalle?: string | null) => {
    const m = String(detalle || '').match(/Pedido\s+(O-[\w-]+)/i);
    return m ? m[1] : null;
  };

  const getLedgerOrderId = (entry: LedgerEntry): string | null =>
    entry.orderId ||
    entry.ncLinks?.orderId ||
    entry.facLinks?.orderId ||
    parseOrderIdFromLedgerDetalle(entry.detalle) ||
    null;

  const isLedgerEntryClickable = (entry: LedgerEntry) => {
    const norm = normalizeLedgerDocType(entry.tipo, entry.detalle);
    if (norm === 'NC') return true;
    if (norm === 'FAC' || norm === 'PED') return !!getLedgerOrderId(entry);
    return false;
  };

  const goToLedgerOrder = (orderId: string | null | undefined) => {
    if (!orderId) return;
    const order = orders.find((o) => o.id === orderId);
    if (!order) {
      showToast('error', `No se encontró el pedido ${orderId} en la lista cargada.`);
      return;
    }
    setSelectedLedgerEntry(null);
    setSelectedOrder(order);
  };

  const financialSummaryAsLedger = useMemo((): LedgerEntry[] => {
    if (!financialSummaryMovements.length) return [];
    const tipoMap: Record<string, string> = {
      FACTURA: 'FAC',
      NC: 'NC',
      RECIBO: 'REC',
      PEDIDO: 'PED'
    };
    return financialSummaryMovements.map((m, idx) => {
      const importe = Number(m.debe || 0) > 0 ? Number(m.debe) : Number(m.haber || 0);
      return {
        lineOrder: 300000 + idx,
        lineDate: m.fecha || '',
        tipo: tipoMap[String(m.tipo || '').toUpperCase()] || String(m.tipo || ''),
        numero: m.comprobante || '',
        edc: null,
        vto: null,
        importe: importe > 0 ? importe : null,
        saldo: null,
        detalle: m.detalle || '',
        paginaPdf: null
      };
    });
  }, [financialSummaryMovements]);

  const ledgerDateMs = (raw: string | null | undefined) => {
    if (!raw) return 0;
    const m = String(raw).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const d = m
      ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
      : new Date(raw);
    const t = d.getTime();
    return Number.isFinite(t) ? t : 0;
  };

  const unifiedLedgerEntries = useMemo(() => {
    const entries = multimediaLedger?.entries?.length
      ? multimediaLedger.entries
      : financialSummaryAsLedger;
    if (!entries?.length) return [];
    return [...entries].sort((a, b) => {
      const da = ledgerDateMs(a.lineDate) - ledgerDateMs(b.lineDate);
      if (da !== 0) return da;
      return Number(a.lineOrder || 0) - Number(b.lineOrder || 0);
    });
  }, [multimediaLedger, financialSummaryAsLedger]);

  const ledgerSaldoHistorialFinal =
    multimediaLedger?.lastSaldo != null && Number.isFinite(Number(multimediaLedger.lastSaldo))
      ? Number(multimediaLedger.lastSaldo)
      : unifiedLedgerEntries.length > 0
        ? unifiedLedgerEntries[unifiedLedgerEntries.length - 1]?.saldo ?? null
        : null;

  const unifiedLedgerEntriesNewestFirst = useMemo(() => {
    if (!unifiedLedgerEntries.length) return [];
    return [...unifiedLedgerEntries].sort((a, b) => {
      const byDate = ledgerDateMs(b.lineDate) - ledgerDateMs(a.lineDate);
      if (byDate !== 0) return byDate;
      return Number(b.lineOrder || 0) - Number(a.lineOrder || 0);
    });
  }, [unifiedLedgerEntries]);

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

  const reloadSelectedCustomerLedger = async () => {
    if (!selectedCustomer?.id) return;
    setMultimediaLedgerLoading(true);
    try {
      const d = await api.getCustomerMultimediaLedger(selectedCustomer.id);
      setMultimediaLedger(d);
      loadCarteraTotals();
    } catch (err: any) {
      showToast('error', err?.message || 'No se pudo actualizar el historial');
    } finally {
      setMultimediaLedgerLoading(false);
    }
  };

  const handleDeleteLedgerManualComprobante = (entry: LedgerEntry) => {
    const id = entry.manualComprobanteId;
    if (!id) return;
    const isNc = normalizeLedgerDocType(entry.tipo, entry.detalle) === 'NC';
    showConfirm({
      title: isNc ? 'Eliminar nota de crédito manual' : 'Eliminar comprobante manual',
      message: `¿Eliminar ${entry.numero ? `el comprobante ${entry.numero}` : 'este comprobante'} del historial y del saldo de ${selectedCustomer?.businessName || selectedCustomer?.name || 'este cliente'}?`,
      confirmLabel: 'Eliminar',
      onConfirm: async () => {
        try {
          await api.deleteManualComprobante(id);
          showToast('success', isNc ? 'NC manual eliminada' : 'Comprobante eliminado');
          setSelectedLedgerEntry(null);
          await reloadSelectedCustomerLedger();
        } catch (err: any) {
          showToast('error', err?.response?.data?.message || err?.message || 'No se pudo eliminar');
        }
      }
    });
  };

  const renderLedgerTable = (
    title: string,
    icon: React.ReactNode,
    rows: LedgerEntry[],
    opts?: { visibleCount?: number; onLoadMore?: () => void }
  ) => {
    if (rows.length === 0) return null;
    const limit = opts?.visibleCount ?? rows.length;
    const shown = rows.slice(0, limit);
    const remaining = rows.length - shown.length;
    return (
      <div className="rounded-2xl border border-slate-600/60 overflow-hidden bg-slate-950/50 shadow-inner shadow-black/20">
        <div className="px-4 py-3 border-b border-slate-700/70 flex flex-wrap items-center gap-2 bg-gradient-to-r from-slate-900/95 to-slate-950/90">
          {icon}
          <span className="text-xs font-black text-slate-100 uppercase tracking-[0.12em]">{title}</span>
            <span className="text-[10px] text-slate-500 ml-auto tabular-nums">
            {shown.length < rows.length
              ? `Mostrando ${shown.length} de ${rows.length}`
              : `${rows.length} mov.`}
            {' · '}
            <span className="text-amber-400/90">más recientes primero</span>
            {' · '}
            <span className="text-violet-400/80">reemisión IIBB agrupada por fecha</span>
          </span>
        </div>
        <div className="overflow-x-auto max-h-[min(70vh,28rem)] mobile-scroll-y touch-scroll">
          <table className="min-w-full text-xs text-left">
            <thead className="text-[10px] uppercase text-slate-500 border-b border-slate-800 sticky top-0 bg-slate-950 z-[1]">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Número</th>
                <th className="px-3 py-2 text-right">Importe</th>
                <th className="px-3 py-2 text-right" title="Reconstruido desde importes; puede diferir del saldo pendiente oficial">
                  Saldo corrido
                </th>
                <th className="px-3 py-2">Detalle</th>
                {canViewSaldos && <th className="px-3 py-2 w-10" title="Eliminar comprobante manual" />}
              </tr>
            </thead>
            <tbody className="text-slate-300 divide-y divide-slate-800/80">
              {shown.map((e, idx) => {
                const voidedReinvoice = isVoidedReinvoiceLedgerEntry(e);
                const ledgerNorm = normalizeLedgerDocType(e.tipo, e.detalle);
                const isFac = ledgerNorm === 'FAC';
                const isPed = ledgerNorm === 'PED';
                const ledgerClickable = isLedgerEntryClickable(e);
                const orderId = getLedgerOrderId(e);
                return (
                <tr
                  key={`${e.lineOrder}-${idx}`}
                  role={ledgerClickable ? 'button' : undefined}
                  tabIndex={ledgerClickable ? 0 : undefined}
                  onClick={ledgerClickable ? () => setSelectedLedgerEntry(e) : undefined}
                  onKeyDown={
                    ledgerClickable
                      ? (ev) => {
                          if (ev.key === 'Enter' || ev.key === ' ') {
                            ev.preventDefault();
                            setSelectedLedgerEntry(e);
                          }
                        }
                      : undefined
                  }
                  className={
                    voidedReinvoice
                      ? 'bg-violet-950/20 text-slate-500 hover:bg-violet-950/30 cursor-pointer'
                      : ledgerClickable
                        ? isPed
                          ? 'hover:bg-blue-950/25 cursor-pointer focus:outline-none focus:bg-blue-950/30'
                          : isFac
                            ? 'hover:bg-emerald-950/20 cursor-pointer focus:outline-none focus:bg-emerald-950/25'
                            : 'hover:bg-violet-950/25 cursor-pointer focus:outline-none focus:bg-violet-950/30'
                        : 'hover:bg-slate-800/30'
                  }
                >
                  <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">{formatLedgerDate(e.lineDate)}</td>
                  <td
                    className="px-3 py-1.5"
                    title={
                      voidedReinvoice
                        ? 'Factura anulada — tocá para ver pedido y factura nueva'
                        : ledgerClickable
                          ? isPed
                            ? 'Tocá para ver el pedido'
                            : isFac
                              ? 'Tocá para ver factura y pedido'
                              : 'Tocá para ver factura emitida'
                          : e.tipo
                    }
                  >
                    <span
                      className={
                        voidedReinvoice
                          ? 'inline-flex items-center gap-1 rounded-md bg-violet-900/40 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-300/90'
                          : ledgerClickable
                            ? `inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                                isPed
                                  ? 'bg-blue-900/35 text-blue-200/90'
                                  : isFac
                                    ? 'bg-emerald-900/35 text-emerald-200/90'
                                    : 'bg-violet-900/30 text-violet-200/90'
                              }`
                            : undefined
                      }
                    >
                      {ledgerTipoDisplay(e.tipo, {
                        detalle: e.detalle,
                        excluirDeSaldo: e.excluirDeSaldo,
                        voidedForReinvoice: e.voidedForReinvoice
                      })}
                      {ledgerClickable ? <ChevronRight size={12} className="opacity-70" aria-hidden /> : null}
                    </span>
                  </td>
                  <td
                    className={`px-3 py-1.5 font-mono text-[11px] ${ledgerClickable && orderId ? 'text-sky-300/90 underline decoration-sky-500/40 underline-offset-2' : ''}`}
                    title={orderId ? `Pedido ${orderId}` : undefined}
                  >
                    {e.numero ?? '—'}
                  </td>
                  <td
                    className={`px-3 py-1.5 text-right tabular-nums ${voidedReinvoice ? 'line-through decoration-violet-400/50' : ''}`}
                    title={voidedReinvoice ? 'Importe histórico; no suma al saldo' : undefined}
                  >
                    {e.importe != null ? `$${Number(e.importe).toLocaleString('es-AR')}` : '—'}
                  </td>
                  <td
                    className="px-3 py-1.5 text-right tabular-nums text-slate-500"
                    title={voidedReinvoice ? 'Sin cambio: la factura fue anulada y reemitida' : undefined}
                  >
                    {e.saldo != null ? `$${Number(e.saldo).toLocaleString('es-AR')}` : '—'}
                  </td>
                  <td
                    className={`px-3 py-1.5 max-w-[240px] truncate italic ${voidedReinvoice ? 'text-violet-300/70' : 'text-slate-400'}`}
                    title={e.detalle || ''}
                  >
                    {e.detalle || '—'}
                  </td>
                  {canViewSaldos && (
                    <td className="px-3 py-1.5 text-right">
                      {e.manualComprobanteId &&
                      normalizeLedgerDocType(e.tipo, e.detalle) === 'NC' ? (
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            handleDeleteLedgerManualComprobante(e);
                          }}
                          className="inline-flex items-center justify-center p-1.5 rounded-lg text-red-400 hover:bg-red-950/40 hover:text-red-300 border border-transparent hover:border-red-800/50"
                          title="Eliminar NC manual"
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : null}
                    </td>
                  )}
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>
        {remaining > 0 && opts?.onLoadMore && (
          <div className="px-4 py-3 border-t border-slate-700/70 flex justify-center bg-slate-950/80">
            <button
              type="button"
              onClick={opts.onLoadMore}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-bold border border-slate-600 touch-manipulation"
            >
              Cargar más ({remaining.toLocaleString('es-AR')} restantes)
            </button>
          </div>
        )}
      </div>
    );
  };

  const customerToolsBusy =
    exportingCustomersWithLocation ||
    wholesaleMetricsExporting ||
    saldosMultimediasExporting ||
    multimediaExporting ||
    multimediaImporting ||
    assigningSellersResumen ||
    updatingCuit ||
    importingExcel;

  const closeCustomerTools = () => setCustomerToolsOpen(false);

  useEffect(() => {
    if (!customerToolsOpen) return;
    const onOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (customerToolsRef.current?.contains(target)) return;
      if ((target as Element).closest?.('[data-customer-tools-dropdown]')) return;
      setCustomerToolsOpen(false);
    };
    document.addEventListener('click', onOutside);
    return () => document.removeEventListener('click', onOutside);
  }, [customerToolsOpen]);

  useEffect(() => {
    if (!customerToolsOpen || !customerToolsRef.current) {
      setCustomerToolsPosition(null);
      return;
    }
    const update = () => {
      if (!customerToolsRef.current) return;
      const rect = customerToolsRef.current.getBoundingClientRect();
      const menuWidth = 300;
      setCustomerToolsPosition({
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)),
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [customerToolsOpen]);

  useEffect(() => {
    if (!customerOrdersMenuOpen) return;
    const onOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (customerOrdersMenuRef.current?.contains(target)) return;
      if ((target as Element).closest?.('[data-customer-orders-menu]')) return;
      setCustomerOrdersMenuOpen(false);
    };
    document.addEventListener('click', onOutside);
    return () => document.removeEventListener('click', onOutside);
  }, [customerOrdersMenuOpen]);

  useEffect(() => {
    if (!customerOrdersMenuOpen || !customerOrdersMenuRef.current) {
      setCustomerOrdersMenuPosition(null);
      return;
    }
    const update = () => {
      if (!customerOrdersMenuRef.current) return;
      const rect = customerOrdersMenuRef.current.getBoundingClientRect();
      const menuWidth = 280;
      setCustomerOrdersMenuPosition({
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)),
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [customerOrdersMenuOpen]);

  useEffect(() => {
    setCustomerOrdersMenuOpen(false);
  }, [selectedCustomer?.id]);

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
                 {(() => {
                   const disp = orderPedidoImporteDisplay(selectedOrder);
                   return (
                     <>
                       <p className="text-sm text-slate-500 uppercase font-bold">{disp.mainLabel}</p>
                       <p className="text-3xl font-black text-white tabular-nums">${formatMoneyAr(disp.mainAmount)}</p>
                       {disp.fact && disp.fact.iibb > 0.005 ? (
                         <p className="text-[10px] text-slate-500 tabular-nums mt-1 max-w-[220px] ml-auto leading-snug">
                           Incluye IIBB ${formatMoneyAr(disp.fact.iibb)}
                         </p>
                       ) : null}
                     </>
                   );
                 })()}
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
                             <p className="font-bold text-white tabular-nums">
                               ${formatMoneyAr(item.priceAtMoment * item.quantity)}
                             </p>
                             <p className="text-xs text-slate-500 tabular-nums">
                               ${formatMoneyAr(item.priceAtMoment)} c/u
                               {selectedOrder.invoice ? ' · neto' : ''}
                             </p>
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
              onClick={() => { setIsCreating(false); setEditingCustomer(null); setNewPhone(''); setNewTransportNumber(''); setNewRemitoNumber(''); setNewSaleCondition(''); setNewCondicionIva(''); setNewLegacyCode(''); setNewAccountZone(''); setNewAccountSellerLabel(''); setNewOpeningBalance(''); setNewOpeningBalanceDate(''); setSelectedTransporteIds([]); setDeliveryBranchRows([]); }}
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
                <CityInput value={newCity} onChange={setNewCity} />
              </div>
            </div>
            {renderDeliveryBranchesBlock()}
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
            {role === Role.ADMIN && (
              <div className="pt-3 border-t border-amber-500/20">
                <p className="text-[10px] text-amber-200/80 uppercase font-black mb-2 ml-1">Saldo inicial de cuenta corriente</p>
                <p className="text-[10px] text-slate-500 mb-3 ml-1 leading-relaxed">
                  Cargá el saldo que el cliente tenía a una fecha (ej. cierre 31/03). Solo se suman movimientos LupoHub desde esa fecha.
                  Dejá vacío para quitar el saldo inicial.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Importe ($)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all font-mono text-sm"
                      value={newOpeningBalance}
                      onChange={(e) => setNewOpeningBalance(e.target.value)}
                      placeholder="Ej: 1228093.27"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Desde fecha</label>
                    <input
                      type="date"
                      className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all text-sm"
                      value={newOpeningBalanceDate}
                      onChange={(e) => setNewOpeningBalanceDate(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="p-6 border-t border-slate-800 bg-slate-900 rounded-b-3xl flex justify-end gap-3">
            <button onClick={() => { setIsCreating(false); setEditingCustomer(null); setNewPhone(''); setNewTransportNumber(''); setNewRemitoNumber(''); setNewSaleCondition(''); setNewCondicionIva(''); setNewLegacyCode(''); setNewAccountZone(''); setNewAccountSellerLabel(''); setNewOpeningBalance(''); setNewOpeningBalanceDate(''); setSelectedTransporteIds([]); setDeliveryBranchRows([]); }} className="px-5 py-2.5 text-slate-400 hover:bg-slate-800 rounded-xl transition font-medium">Cancelar</button>
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
        <div className="flex flex-col gap-4">
           <div className="flex items-start gap-3 min-w-0">
             <button 
               onClick={clearSelectedCustomerView} 
               className="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl transition text-slate-300 shrink-0 touch-manipulation"
               aria-label="Volver al listado"
             >
               <ArrowLeft size={20} />
             </button>
             <div className="min-w-0 flex-1">
                <h2 className="text-xl sm:text-2xl font-bold text-white break-words">{selectedCustomer.businessName}</h2>
                <div className="flex items-center gap-3 text-sm text-slate-400 flex-wrap">
                  <span className="flex items-center gap-1"><Users size={14}/> {selectedCustomer.name}</span>
                  <span className="w-1 h-1 bg-slate-600 rounded-full"></span>
                  <span className="flex items-center gap-1"><MapPin size={14}/> {cityDisplayLabel(selectedCustomer.city || '')}</span>
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
                  <span className="w-1 h-1 bg-slate-600 rounded-full"></span>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border ${
                      selectedCustomer.shouldRetainIibb
                        ? 'bg-amber-900/30 text-amber-300 border-amber-700/60'
                        : 'bg-emerald-900/20 text-emerald-300 border-emerald-700/50'
                    }`}
                    title={selectedCustomer.agipPadronPeriod ? `Padrón AGIP ${selectedCustomer.agipPadronPeriod}` : 'Sin padrón AGIP'}
                  >
                    <AlertTriangle size={12} />
                    {selectedCustomer.shouldRetainIibb
                      ? `Retener IIBB: Sí (${Number(selectedCustomer.iibbAlicuota || 0).toFixed(2)}%)`
                      : 'Retener IIBB: No'}
                  </span>
                  {selectedCustomer.transportes && selectedCustomer.transportes.length > 0 && (
                    <>
                      <span className="w-1 h-1 bg-slate-600 rounded-full"></span>
                      <span className="flex items-center gap-1"><Truck size={14} /> {selectedCustomer.transportes.map(t => t.name).join(', ')}</span>
                    </>
                  )}
                </div>
             </div>
           </div>
           <div className="flex flex-wrap gap-2 w-full">
             <button
               type="button"
               onClick={() => setDetailActionsOpen((v) => !v)}
               className="md:hidden flex-1 min-w-[8rem] px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm font-bold text-slate-200 touch-manipulation"
             >
               {detailActionsOpen ? 'Ocultar acciones' : 'Más acciones'}
             </button>
             <div className={`${detailActionsOpen ? 'flex' : 'hidden'} md:flex flex-wrap gap-2 w-full md:w-auto`}>
             <button
               onClick={() => {
                 setCustomerDetailExportFrom('');
                 setCustomerDetailExportTo('');
                 setShowCustomerDetailExportModal(true);
               }}
               className="flex-1 sm:flex-none px-3 py-2.5 bg-emerald-900/40 border border-emerald-700/50 rounded-xl text-sm font-bold text-emerald-200 hover:bg-emerald-900/60 hover:text-white transition flex items-center justify-center gap-2 touch-manipulation"
               title="Exportar detalle del cliente con filtro de fechas"
             >
               <FileSpreadsheet size={16} />
               <span className="hidden xs:inline">Exportar detalle</span>
               <span className="xs:hidden">Detalle</span>
             </button>
             {role === Role.ADMIN && (
             <button
               onClick={() => {
                 setExportSheetSelectedIds([selectedCustomer.id]);
                 setShowExportSheetsModal(true);
               }}
               className="flex-1 sm:flex-none px-3 py-2.5 bg-cyan-900/40 border border-cyan-700/50 rounded-xl text-sm font-bold text-cyan-200 hover:bg-cyan-900/60 hover:text-white transition flex items-center justify-center gap-2 touch-manipulation"
               title="Descargar Excel con una hoja por cliente"
             >
               <Download size={16} />
               Por hojas
             </button>
             )}
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
                 setNewOpeningBalance(
                   selectedCustomer.openingBalance != null && Number.isFinite(selectedCustomer.openingBalance)
                     ? String(selectedCustomer.openingBalance)
                     : ''
                 );
                 setNewOpeningBalanceDate(selectedCustomer.openingBalanceDate || '');
                 setSelectedTransporteIds(selectedCustomer.transportes?.map(t => t.id) ?? []);
                 setDeliveryBranchRows((selectedCustomer.deliveryAddresses ?? []).map((d) => ({ ...d })));
                 setEditingCustomer(selectedCustomer);
               }}
               className="flex-1 sm:flex-none px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition flex items-center justify-center gap-2 touch-manipulation"
             >
               <Pencil size={16} />
               Editar
             </button>
             {onDeleteCustomer && role === Role.ADMIN && (
               <button
                 onClick={() => {
                  if (window.confirm(`¿Eliminar el cliente "${selectedCustomer.businessName}"? Esta acción no se puede deshacer.`)) {
                    Promise.resolve(onDeleteCustomer(selectedCustomer.id)).then(() => clearSelectedCustomerView()).catch(() => {});
                   }
                 }}
                 className="flex-1 sm:flex-none px-3 py-2.5 bg-red-900/50 border border-red-800 rounded-xl text-sm font-bold text-red-300 hover:bg-red-900 hover:text-white transition flex items-center justify-center gap-2 touch-manipulation"
               >
                 <Trash2 size={16} />
                 Eliminar
               </button>
             )}
             </div>
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

        {selectedLedgerEntry && (() => {
          const entry = selectedLedgerEntry;
          const kind = normalizeLedgerDocType(entry.tipo, entry.detalle);
          const orderId = getLedgerOrderId(entry);
          const title =
            kind === 'NC'
              ? 'Nota de crédito'
              : kind === 'PED'
                ? 'Pedido'
                : isVoidedReinvoiceLedgerEntry(entry)
                  ? 'Factura anulada'
                  : 'Factura';
          const borderClass =
            kind === 'PED' ? 'border-blue-500/30' : kind === 'FAC' ? 'border-emerald-500/30' : 'border-violet-500/30';
          return (
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedLedgerEntry(null)}
          >
            <div
              className={`w-full max-w-md bg-slate-900 border ${borderClass} rounded-2xl shadow-2xl overflow-hidden`}
              onClick={(ev) => ev.stopPropagation()}
              role="dialog"
              aria-labelledby="ledger-entry-dialog-title"
            >
              <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-3">
                <div>
                  <h3 id="ledger-entry-dialog-title" className="text-white font-bold">
                    {title}
                  </h3>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">{entry.numero ?? '—'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedLedgerEntry(null)}
                  className="text-slate-400 hover:text-white p-1"
                  aria-label="Cerrar"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="p-4 space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-slate-500 uppercase font-black tracking-wide mb-1">Fecha</p>
                    <p className="text-slate-200 tabular-nums">{formatLedgerDate(entry.lineDate)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 uppercase font-black tracking-wide mb-1">Importe</p>
                    <p className="text-white font-bold tabular-nums">
                      {entry.importe != null
                        ? `$${Number(entry.importe).toLocaleString('es-AR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                          })}`
                        : '—'}
                    </p>
                  </div>
                </div>

                {orderId ? (
                  <button
                    type="button"
                    onClick={() => goToLedgerOrder(orderId)}
                    className="w-full rounded-xl border border-blue-500/30 bg-blue-950/30 px-3 py-3 text-left hover:bg-blue-950/50 transition-colors group"
                  >
                    <p className="text-[10px] uppercase font-black text-blue-300/80 tracking-wide mb-1">Pedido</p>
                    <p className="text-blue-100 font-mono text-sm font-bold flex items-center justify-between gap-2">
                      <span>{orderId}</span>
                      <ExternalLink size={16} className="text-blue-300/80 group-hover:text-blue-200 shrink-0" />
                    </p>
                  </button>
                ) : null}

                {kind === 'NC' && entry.ncLinks?.voidedInvoiceNumero ? (
                  <div className="rounded-xl border border-violet-500/20 bg-violet-950/20 px-3 py-2.5">
                    <p className="text-[10px] uppercase font-black text-violet-300/80 tracking-wide mb-1">
                      Factura anulada por esta NC
                    </p>
                    <p className="text-violet-100 font-mono text-sm">{entry.ncLinks.voidedInvoiceNumero}</p>
                  </div>
                ) : null}

                {kind === 'NC' && entry.ncLinks?.issuedInvoiceNumero ? (
                  <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/20 px-3 py-2.5 space-y-2">
                    <p className="text-[10px] uppercase font-black text-emerald-300/90 tracking-wide">
                      {entry.ncLinks.reissueWithIibb
                        ? 'Factura emitida (reemisión con IIBB)'
                        : 'Factura vigente del pedido'}
                    </p>
                    <p className="text-emerald-100 font-mono text-base font-bold">
                      {entry.ncLinks.issuedInvoiceNumero}
                    </p>
                    {entry.ncLinks.issuedInvoiceImporte != null ? (
                      <p className="text-emerald-200/90 tabular-nums text-xs">
                        Total: $
                        {Number(entry.ncLinks.issuedInvoiceImporte).toLocaleString('es-AR', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2
                        })}
                        {entry.ncLinks.issuedInvoiceIibb != null && entry.ncLinks.issuedInvoiceIibb > 0.005
                          ? ` (incl. IIBB $${Number(entry.ncLinks.issuedInvoiceIibb).toLocaleString('es-AR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2
                            })})`
                          : ''}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {kind === 'FAC' && entry.facLinks?.voidedInvoiceNumero ? (
                  <div className="rounded-xl border border-violet-500/20 bg-violet-950/20 px-3 py-2.5">
                    <p className="text-[10px] uppercase font-black text-violet-300/80 tracking-wide mb-1">
                      Factura anulada (referencia)
                    </p>
                    <p className="text-violet-100 font-mono text-sm">{entry.facLinks.voidedInvoiceNumero}</p>
                  </div>
                ) : null}

                {kind === 'FAC' && !entry.facLinks?.voidedForReinvoice && entry.facLinks?.invoiceNumero ? (
                  <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/20 px-3 py-2.5 space-y-1">
                    <p className="text-[10px] uppercase font-black text-emerald-300/90 tracking-wide">
                      Comprobante AFIP
                    </p>
                    <p className="text-emerald-100 font-mono text-base font-bold">{entry.facLinks.invoiceNumero}</p>
                    {entry.facLinks.agipRetPer != null && entry.facLinks.agipRetPer > 0.005 ? (
                      <p className="text-emerald-200/90 text-xs tabular-nums">
                        IIBB: $
                        {Number(entry.facLinks.agipRetPer).toLocaleString('es-AR', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2
                        })}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {kind === 'FAC' && entry.facLinks?.voidedForReinvoice && entry.facLinks.invoiceNumero ? (
                  <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/20 px-3 py-2.5 space-y-1">
                    <p className="text-[10px] uppercase font-black text-emerald-300/90 tracking-wide">
                      Factura vigente (reemisión IIBB)
                    </p>
                    <p className="text-emerald-100 font-mono text-base font-bold">{entry.facLinks.invoiceNumero}</p>
                  </div>
                ) : null}

                {kind === 'PED' ? (
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Pedido sin factura AFIP con saldo pendiente en cartera.
                  </p>
                ) : null}

                {kind === 'NC' && !entry.ncLinks?.issuedInvoiceNumero ? (
                  <p className="text-slate-500 text-xs leading-relaxed">
                    No hay factura vinculada en LupoHub para esta NC.
                  </p>
                ) : null}

                {entry.detalle ? (
                  <p className="text-[11px] text-slate-500 leading-relaxed border-t border-slate-800 pt-3">
                    {entry.detalle}
                  </p>
                ) : null}
              </div>
              <div className="p-4 border-t border-slate-800 flex flex-col gap-2">
                {orderId ? (
                  <button
                    type="button"
                    onClick={() => goToLedgerOrder(orderId)}
                    className="w-full bg-blue-700 hover:bg-blue-600 text-white px-4 py-2.5 rounded-xl font-bold inline-flex items-center justify-center gap-2"
                  >
                    <ExternalLink size={16} />
                    Ver pedido {orderId}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setSelectedLedgerEntry(null)}
                  className="w-full bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-xl font-semibold"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
          );
        })()}

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

        {canViewSaldos && selectedCustomer && (
          <div className="mt-6 rounded-3xl border border-amber-500/35 bg-gradient-to-br from-slate-900 via-slate-900/95 to-slate-950 p-4 sm:p-6 shadow-xl shadow-black/30 ring-1 ring-amber-500/10">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 text-amber-100/90">
                  <Wallet size={22} className="text-amber-400 shrink-0" aria-hidden />
                  <span className="text-sm font-black uppercase tracking-[0.22em]">Saldo pendiente</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed max-w-xl">
                  Es la <span className="text-slate-300">deuda actual</span>: saldo inicial manual (si cargaste uno) + facturas y pedidos
                  LupoHub desde esa fecha − notas de crédito − recibos. La tabla de abajo es el historial; el número grande de arriba es el
                  que importa para cobrar.
                </p>
                {carteraById[selectedCustomer.id] && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500 font-mono tabular-nums pt-1">
                    {(() => {
                      const ob =
                        Number(multimediaLedger?.openingBalance ?? selectedCustomer.openingBalance) || 0;
                      if (Math.abs(ob) <= 0.005) return null;
                      const dateLabel = selectedCustomer.openingBalanceDate
                        ? ` (${selectedCustomer.openingBalanceDate.split('-').reverse().join('/')})`
                        : '';
                      return (
                        <span className="text-amber-300/90">
                          + Saldo inicial{dateLabel}: $
                          {ob.toLocaleString('es-AR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                          })}
                        </span>
                      );
                    })()}
                    <span>
                      + Facturas/pedidos: $
                      {carteraById[selectedCustomer.id].orderCargosPendientes.toLocaleString('es-AR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                      })}
                    </span>
                    <span className="text-violet-400/90">
                      − Notas de crédito: $
                      {carteraById[selectedCustomer.id].totalNotasCredito.toLocaleString('es-AR', {
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
              <div className="flex flex-col items-stretch sm:items-end gap-2 shrink-0">
                <p
                  className={`text-3xl font-black tabular-nums sm:text-right ${
                    getSaldoPendienteTotal(selectedCustomer) < -0.01
                      ? 'text-emerald-300'
                      : 'text-white'
                  }`}
                  title={
                    getSaldoPendienteTotal(selectedCustomer) < -0.01
                      ? 'Saldo a favor del cliente (le debés)'
                      : undefined
                  }
                >
                  {saldosLoading ? (
                    <Loader2 size={28} className="animate-spin text-amber-400/80" />
                  ) : (
                    <>
                      $
                      {getSaldoPendienteTotal(selectedCustomer).toLocaleString('es-AR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                      })}
                    </>
                  )}
                </p>
                <button
                  type="button"
                  disabled={exportingFinancialSummary}
                  onClick={async () => {
                    try {
                      setExportingFinancialSummary(true);
                      await api.exportCustomerFinancialSummary(selectedCustomer.id);
                      showToast('success', 'Excel descargado');
                    } catch (err: any) {
                      showToast('error', err?.message || 'No se pudo exportar');
                    } finally {
                      setExportingFinancialSummary(false);
                    }
                  }}
                  className="px-4 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-600 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 touch-manipulation"
                >
                  {exportingFinancialSummary ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  Exportar Excel
                </button>
              </div>
            </div>

            {multimediaLedgerLoading ? (
              <div className="py-8 flex items-center justify-center gap-2 text-slate-400 text-sm border-t border-slate-800/80 mt-4">
                <Loader2 size={18} className="animate-spin" />
                Cargando facturas, NC y recibos…
              </div>
            ) : unifiedLedgerEntriesNewestFirst.length > 0 ? (
              <div className="mt-4 pt-4 border-t border-slate-800/80">
                {multimediaLedger?.movementCount ? (
                  <p className="text-xs text-slate-500 font-medium mb-3">
                    <span className="text-white font-bold tabular-nums">{multimediaLedger.movementCount}</span> movimientos
                    {multimediaLedger.legacyCode ? (
                      <span className="text-slate-500"> · legacy {multimediaLedger.legacyCode}</span>
                    ) : null}
                  </p>
                ) : null}
                <div className="mb-3 rounded-xl border border-slate-600/60 bg-slate-950/60 px-3 py-2.5 text-xs text-slate-400 leading-relaxed space-y-1.5">
                  <p>
                    <span className="font-bold text-amber-200">Saldo pendiente</span> (arriba) = cuánto debe el cliente
                    hoy. Usá ese número para cobranza.
                  </p>
                  <p>
                    <span className="font-bold text-slate-300">Saldo corrido</span> (columna de la tabla) = historial
                    movimiento por movimiento. Tocá una fila de{' '}
                    <span className="text-violet-300/90">NC</span>,{' '}
                    <span className="text-emerald-300/90">factura</span> o{' '}
                    <span className="text-blue-300/90">pedido</span> para ver el vínculo e ir al pedido.
                  </p>
                  {carteraById[selectedCustomer.id] &&
                  ledgerSaldoHistorialFinal != null &&
                  Math.abs(ledgerSaldoHistorialFinal - getSaldoPendienteTotal(selectedCustomer)) > 1 ? (
                    <p className="text-amber-100/80">
                      En el Excel por vendedor: ignorá el «saldo del período con arrastre» si no coincide; el que dice{' '}
                      <span className="font-bold">Saldo pendiente</span> en verde es el mismo que acá.
                    </p>
                  ) : null}
                </div>
                {renderLedgerTable(
                  'Facturas, NC y recibos',
                  <Receipt size={16} className="text-emerald-400 shrink-0" aria-hidden />,
                  unifiedLedgerEntriesNewestFirst,
                  {
                    visibleCount: ledgerVisibleCount,
                    onLoadMore: () =>
                      setLedgerVisibleCount((n) =>
                        Math.min(n + LEDGER_MOVEMENTS_PAGE, unifiedLedgerEntriesNewestFirst.length)
                      )
                  }
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500 mt-4 py-4 text-center border-t border-slate-800/80 leading-relaxed">
                Sin movimientos en el detalle. El saldo puede provenir de pedidos o facturas LupoHub pendientes de cobro.
              </p>
            )}
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

            {onUpdateCustomer && selectedCustomer.sellerId && (
              <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-2">
                <label className="block text-xs font-black text-slate-500 uppercase mb-2">
                  Comisión del vendedor (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={
                    selectedCustomer.sellerCommissionPercentage != null &&
                    Number.isFinite(selectedCustomer.sellerCommissionPercentage)
                      ? selectedCustomer.sellerCommissionPercentage
                      : ''
                  }
                  placeholder={
                    users.find((u) => u.id === selectedCustomer.sellerId)?.commissionPercentage != null
                      ? String(users.find((u) => u.id === selectedCustomer.sellerId)?.commissionPercentage)
                      : '0'
                  }
                  onChange={(e) => {
                    const raw = e.target.value;
                    const parsed = raw === '' ? null : Math.min(100, Math.max(0, parseFloat(raw) || 0));
                    setSelectedCustomer((prev) =>
                      prev ? { ...prev, sellerCommissionPercentage: parsed } : null
                    );
                  }}
                  onBlur={async () => {
                    try {
                      await Promise.resolve(
                        onUpdateCustomer(selectedCustomer.id, {
                          sellerCommissionPercentage:
                            selectedCustomer.sellerCommissionPercentage ?? null
                        })
                      );
                    } catch (err) {
                      console.error(err);
                    }
                  }}
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Por cliente: si está vacío, usa el % por defecto del vendedor en{' '}
                  <strong className="text-slate-300">Vendedores</strong> o Configuración.
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
           <div className="p-4 sm:p-6 border-b border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                <h3 className="font-bold text-white flex items-center gap-2 text-sm sm:text-base min-w-0">
                   <ShoppingBag size={18} className="text-blue-500 shrink-0"/> 
                   <span className="truncate">Pedidos en LupoHub</span>
                </h3>
                <span className="text-[11px] sm:text-xs font-bold text-slate-500 bg-slate-800 px-2.5 py-1 rounded-full shrink-0 tabular-nums">
                  {visibleOrders.length} / {stats.orders.length}
                </span>
                {onlyPendingDispatchInCustomer && (
                  <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wide text-blue-300 bg-blue-900/30 px-2 py-0.5 rounded-full shrink-0">
                    Filtro activo
                  </span>
                )}
              </div>
              <div className="relative shrink-0" ref={customerOrdersMenuRef}>
                <button
                  type="button"
                  onClick={() => setCustomerOrdersMenuOpen((prev) => !prev)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition border min-h-[40px] ${
                    onlyPendingDispatchInCustomer
                      ? 'bg-blue-700/25 border-blue-600/40 text-blue-200'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                  aria-expanded={customerOrdersMenuOpen}
                  aria-haspopup="menu"
                >
                  <SlidersHorizontal size={15} className="shrink-0" />
                  <span className="hidden sm:inline">Opciones</span>
                  <ChevronDown size={14} className={`shrink-0 transition-transform ${customerOrdersMenuOpen ? 'rotate-180' : ''}`} />
                </button>
                {customerOrdersMenuOpen && customerOrdersMenuPosition && createPortal(
                  <div
                    data-customer-orders-menu
                    role="menu"
                    className="py-2 w-[280px] bg-slate-900/95 backdrop-blur-md border border-slate-600 rounded-2xl shadow-2xl z-[9999]"
                    style={{
                      position: 'fixed',
                      top: customerOrdersMenuPosition.top,
                      left: customerOrdersMenuPosition.left,
                      zIndex: 9999,
                    }}
                  >
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={onlyPendingDispatchInCustomer}
                      onClick={() => {
                        setOnlyPendingDispatchInCustomer((v) => !v);
                        setCustomerOrdersMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition ${
                        onlyPendingDispatchInCustomer
                          ? 'text-blue-200 bg-blue-500/10'
                          : 'text-slate-200 hover:bg-slate-700/80'
                      }`}
                    >
                      <Filter size={16} className={`shrink-0 ${onlyPendingDispatchInCustomer ? 'text-blue-400' : 'text-slate-400'}`} />
                      <span className="leading-snug">
                        {onlyPendingDispatchInCustomer ? 'Mostrar todos los pedidos' : 'Filtrar solo con pendientes'}
                      </span>
                    </button>
                    {(role === Role.ADMIN || role === Role.SELLER || role === Role.WAREHOUSE || role === Role.DEPOSITO) && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={async () => {
                          setCustomerOrdersMenuOpen(false);
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
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-amber-100 hover:bg-amber-500/10 border-t border-slate-700/80 mt-1 pt-3"
                        title="Quitar pendientes de pedidos despachados sin factura AFIP. Solo recorta cantidad cuando hay unidades pickeadas; no borra pedidos facturados."
                      >
                        <PackageCheck size={16} className="text-amber-400 shrink-0" />
                        <span className="leading-snug">Quitar pendientes despachados</span>
                      </button>
                    )}
                  </div>,
                  document.body
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
                             <span className="flex items-center gap-1"><Calendar size={12}/> {formatOrderDate(order.date)}</span>
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
                          {(() => {
                            const disp = orderPedidoImporteDisplay(order);
                            return (
                              <>
                                <p className="font-black text-white text-lg tabular-nums">
                                  ${formatMoneyAr(disp.mainAmount)}
                                </p>
                                <p className="text-[10px] text-slate-500 uppercase tracking-wide">{disp.mainLabel}</p>
                                {disp.fact && disp.fact.iibb > 0.005 ? (
                                  <p className="text-[9px] text-slate-600 tabular-nums mt-0.5">
                                    + IIBB ${formatMoneyAr(disp.fact.iibb)}
                                  </p>
                                ) : null}
                              </>
                            );
                          })()}
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h2 className="text-2xl font-bold text-white">Cartera de Clientes</h2>
        <div className="flex items-center gap-2 shrink-0">
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
          <div className="relative" ref={customerToolsRef}>
            <button
              type="button"
              onClick={() => setCustomerToolsOpen((prev) => !prev)}
              className="flex items-center gap-2 bg-slate-800 text-slate-200 px-3 sm:px-4 py-2.5 rounded-xl border border-slate-700 hover:bg-slate-700 hover:text-white transition min-h-[44px] font-medium text-sm"
              aria-expanded={customerToolsOpen}
              aria-haspopup="menu"
            >
              {customerToolsBusy ? (
                <Loader2 size={18} className="animate-spin text-blue-400" />
              ) : (
                <SlidersHorizontal size={18} className="text-slate-400" />
              )}
              <span>Herramientas</span>
              <ChevronDown size={16} className={`text-slate-400 transition-transform ${customerToolsOpen ? 'rotate-180' : ''}`} />
            </button>
            {customerToolsOpen && customerToolsPosition && createPortal(
              <div
                data-customer-tools-dropdown
                role="menu"
                className="py-2 w-[300px] max-h-[min(70vh,520px)] overflow-y-auto bg-slate-900/95 backdrop-blur-md border border-slate-600 rounded-2xl shadow-2xl z-[9999]"
                style={{
                  position: 'fixed',
                  top: customerToolsPosition.top,
                  left: customerToolsPosition.left,
                  zIndex: 9999,
                }}
              >
                <div className="px-4 py-2 border-b border-slate-700/80">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Exportar</p>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={async () => {
                    closeCustomerTools();
                    setExportingCustomersWithLocation(true);
                    try {
                      await api.exportCustomersIndividuals();
                      showToast('success', 'Excel de clientes con ubicación descargado (incluye ciudad y dirección).');
                    } catch (err: any) {
                      showToast('error', err?.message || 'Error al exportar clientes con ubicación.');
                    }
                    setExportingCustomersWithLocation(false);
                  }}
                  disabled={exportingCustomersWithLocation}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-emerald-100 hover:bg-emerald-500/10 disabled:opacity-50"
                  title="Excel de clientes (1 fila por cliente) con ciudad y dirección"
                >
                  {exportingCustomersWithLocation ? <Loader2 size={16} className="animate-spin shrink-0" /> : <Download size={16} className="text-emerald-400 shrink-0" />}
                  <span className="leading-snug">Exportar clientes con ubicación</span>
                </button>
                {canViewSaldos && (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={async () => {
                        closeCustomerTools();
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
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-fuchsia-100 hover:bg-fuchsia-500/10 disabled:opacity-50"
                    >
                      {wholesaleMetricsExporting ? <Loader2 size={16} className="animate-spin shrink-0" /> : <FileSpreadsheet size={16} className="text-fuchsia-400 shrink-0" />}
                      <span className="leading-snug">Métricas mayorista (Top artículos)</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={async () => {
                        closeCustomerTools();
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
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-amber-100 hover:bg-amber-500/10 disabled:opacity-50"
                    >
                      {saldosMultimediasExporting ? <Loader2 size={16} className="animate-spin shrink-0" /> : <FileSpreadsheet size={16} className="text-amber-400 shrink-0" />}
                      <span className="leading-snug">Excel saldos pendientes (Resumen)</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={async () => {
                        closeCustomerTools();
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
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-200 hover:bg-slate-700/80 disabled:opacity-50"
                    >
                      {multimediaExporting ? <Loader2 size={16} className="animate-spin shrink-0" /> : <Download size={16} className="text-slate-400 shrink-0" />}
                      <span className="leading-snug">Exportar historial Multimedias</span>
                    </button>
                  </>
                )}
                <div className="px-4 py-2 mt-1 border-t border-b border-slate-700/80">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Importar</p>
                </div>
                {canViewSaldos && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closeCustomerTools();
                      multimediaHistorialInputRef.current?.click();
                    }}
                    disabled={multimediaImporting}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-200 hover:bg-slate-700/80 disabled:opacity-50"
                  >
                    {multimediaImporting ? <Loader2 size={16} className="animate-spin shrink-0" /> : <FileSpreadsheet size={16} className="text-blue-400 shrink-0" />}
                    <span className="leading-snug">Importar historial Multimedias</span>
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeCustomerTools();
                    importExcelInputRef.current?.click();
                  }}
                  disabled={importingExcel}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-200 hover:bg-slate-700/80 disabled:opacity-50"
                >
                  {importingExcel ? <Loader2 size={16} className="animate-spin shrink-0" /> : <FileSpreadsheet size={16} className="text-cyan-400 shrink-0" />}
                  <span className="leading-snug">Importar Excel de clientes</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeCustomerTools();
                    cuitUpdateInputRef.current?.click();
                  }}
                  disabled={updatingCuit}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-200 hover:bg-slate-700/80 disabled:opacity-50"
                >
                  {updatingCuit ? <Loader2 size={16} className="animate-spin shrink-0" /> : <FileSpreadsheet size={16} className="text-violet-400 shrink-0" />}
                  <span className="leading-snug">Actualizar CUIT en lote</span>
                </button>
                {role === Role.ADMIN && (
                  <>
                    <div className="px-4 py-2 mt-1 border-t border-slate-700/80">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Administración</p>
                    </div>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        closeCustomerTools();
                        assignSellersResumenInputRef.current?.click();
                      }}
                      disabled={assigningSellersResumen}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-indigo-100 hover:bg-indigo-500/10 disabled:opacity-50"
                    >
                      {assigningSellersResumen ? <Loader2 size={16} className="animate-spin shrink-0" /> : <Users size={16} className="text-indigo-400 shrink-0" />}
                      <span className="leading-snug">Asignar vendedores (Resumen)</span>
                    </button>
                  </>
                )}
              </div>,
              document.body
            )}
          </div>
          <button
            type="button"
            onClick={() => { setIsCreating(true); setEditingCustomer(null); setNewBusinessName(''); setNewContactName(''); setNewEmail(''); setNewAddress(''); setNewCity(''); setNewCuit(''); setNewPhone(''); setNewTransportNumber(''); setNewRemitoNumber(''); setNewSaleCondition(''); setNewCondicionIva(''); setNewLegacyCode(''); setNewAccountZone(''); setNewAccountSellerLabel(''); setSelectedTransporteIds([]); setDeliveryBranchRows([]); }}
            className="bg-blue-600 text-white px-4 py-2.5 rounded-xl hover:bg-blue-500 transition flex items-center gap-2 shadow-lg shadow-blue-900/40 font-semibold min-h-[44px] text-sm"
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
                  {onDeleteCustomer && role === Role.ADMIN && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`¿Eliminar a "${customer.businessName}"?`)) {
                          Promise.resolve(onDeleteCustomer(customer.id)).catch(() => {});
                        }
                      }}
                      className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-900/20 transition touch-manipulation"
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
                    title="Facturas/pedidos − notas de crédito − recibos (LupoHub). Tocá el cliente para el desglose."
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 text-slate-400 font-bold uppercase text-[10px] tracking-wide">
                        <Wallet size={12} className="text-slate-500 shrink-0" />
                        Saldo pendiente
                      </div>
                      <span
                        className={`font-bold tabular-nums text-right ${
                          saldoPendienteTotal < -0.01
                            ? 'text-emerald-300'
                            : saldoPendienteTotal > 0.01
                              ? 'text-white'
                              : 'text-slate-400'
                        }`}
                        title={
                          saldoPendienteTotal < -0.01 ? 'Saldo a favor del cliente (le debés)' : undefined
                        }
                      >
                        {saldosLoading
                          ? '...'
                          : `$${saldoPendienteTotal.toLocaleString('es-AR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2
                            })}`}
                      </span>
                    </div>
                    {role === Role.SELLER && (
                      <p className="text-[10px] text-blue-400/90 mt-1.5 flex items-center gap-1">
                        <FileText size={11} />
                        Ver facturas y recibos →
                      </p>
                    )}
                  </div>
                )}

                {role === Role.ADMIN && customer.sellerId && (
                  <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-slate-800/80 border border-slate-700 px-2 py-1 text-[11px] text-slate-300">
                    <Users size={11} className="text-slate-400" />
                    <span>Vendedor: {getSellerName(customer.sellerId) || customer.sellerId.slice(0, 6)}</span>
                  </div>
                )}
                <div
                  className={`mb-2 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] ${
                    customer.shouldRetainIibb
                      ? 'bg-amber-900/30 text-amber-300 border-amber-700/60'
                      : 'bg-emerald-900/20 text-emerald-300 border-emerald-700/50'
                  }`}
                  title={customer.agipPadronPeriod ? `Padrón AGIP ${customer.agipPadronPeriod}` : 'Sin padrón AGIP'}
                >
                  <AlertTriangle size={11} />
                  <span>
                    {customer.shouldRetainIibb
                      ? `Retener IIBB: Sí (${Number(customer.iibbAlicuota || 0).toFixed(2)}%)`
                      : 'Retener IIBB: No'}
                  </span>
                </div>
                
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
                    {customer.address}{customer.city ? `, ${cityDisplayLabel(customer.city)}` : ''}
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
                onClick={() => { setIsCreating(false); setEditingCustomer(null); setNewPhone(''); setNewTransportNumber(''); setNewRemitoNumber(''); setNewSaleCondition(''); setNewCondicionIva(''); setNewLegacyCode(''); setNewAccountZone(''); setNewAccountSellerLabel(''); setNewOpeningBalance(''); setNewOpeningBalanceDate(''); setSelectedTransporteIds([]); setDeliveryBranchRows([]); }}
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
                    <CityInput value={newCity} onChange={setNewCity} />
                </div>
              </div>
              {renderDeliveryBranchesBlock()}
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
              {role === Role.ADMIN && (
                <div className="pt-3 border-t border-amber-500/20">
                  <p className="text-[10px] text-amber-200/80 uppercase font-black mb-2 ml-1">Saldo inicial de cuenta corriente</p>
                  <p className="text-[10px] text-slate-500 mb-3 ml-1 leading-relaxed">
                    Cargá el saldo que el cliente tenía a una fecha (ej. cierre 31/03). Solo se suman movimientos LupoHub desde esa fecha.
                    Dejá vacío para quitar el saldo inicial.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Importe ($)</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all font-mono text-sm"
                        value={newOpeningBalance}
                        onChange={(e) => setNewOpeningBalance(e.target.value)}
                        placeholder="Ej: 1228093.27"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Desde fecha</label>
                      <input
                        type="date"
                        className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all text-sm"
                        value={newOpeningBalanceDate}
                        onChange={(e) => setNewOpeningBalanceDate(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-slate-800 bg-slate-900 rounded-b-3xl flex justify-end gap-3">
              <button 
                onClick={() => { setIsCreating(false); setEditingCustomer(null); setNewPhone(''); setNewTransportNumber(''); setNewRemitoNumber(''); setNewSaleCondition(''); setNewCondicionIva(''); setNewLegacyCode(''); setNewAccountZone(''); setNewAccountSellerLabel(''); setNewOpeningBalance(''); setNewOpeningBalanceDate(''); setSelectedTransporteIds([]); setDeliveryBranchRows([]); }}
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