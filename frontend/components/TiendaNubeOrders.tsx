import React, { useState, useEffect } from 'react';
import { RefreshCw, Package, User, MapPin, Truck, ChevronLeft, ChevronRight, Loader2, ShoppingBag, Calendar, Search, X, Clock, CheckCircle, XCircle, ChevronDown, FileText } from 'lucide-react';
import { api } from '../services/api';
import { getRemitente } from '../services/apiIntegration';

interface TiendaNubeOrder {
  id: number;
  number: number;
  status: string;
  paymentStatus: string;
  paymentStatusRaw?: string | null;
  isPaid?: boolean;
  shippingStatus: string;
  total: string;
  currency: string;
  customer: {
    name: string;
    email: string;
    phone: string;
  };
  products: {
    id: number;
    variantId: number;
    name: string;
    sku: string;
    quantity: number;
    price: string;
  }[];
  shippingAddress: {
    address: string;
    city: string;
    province: string;
    zipcode: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  invoiced?: boolean;
  invoice?: {
    id: string;
    cae: string;
    cbteTipo: number;
    cbteDesde: number;
    createdAt?: string;
  };
}

const TiendaNubeOrders: React.FC = () => {
  const todayIso = new Date().toISOString().split('T')[0];
  const twoDaysAgoIso = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 2);
    return d.toISOString().split('T')[0];
  })();
  const [orders, setOrders] = useState<TiendaNubeOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [showAllOrders, setShowAllOrders] = useState(true); // por defecto: todos los pedidos
  const [onlyUnpaid, setOnlyUnpaid] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedOrder, setExpandedOrder] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState<string>(twoDaysAgoIso);
  const [dateTo, setDateTo] = useState<string>(todayIso);
  const [selectedOrderIds, setSelectedOrderIds] = useState<number[]>([]);
  const [bulkInvoicing, setBulkInvoicing] = useState(false);
  const [selectingAllFiltered, setSelectingAllFiltered] = useState(false);
  const [bulkCbteTipo, setBulkCbteTipo] = useState<'auto' | 'A' | 'B'>('auto');
  const perPage = 15;

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const params: any = { page, per_page: perPage };
      if (!showAllOrders) params.only_paid_pending_shipment = true;
      if (filterStatus) params.status = filterStatus;
      if (dateFrom) params.created_at_min = dateFrom;
      if (dateTo) params.created_at_max = dateTo;
      
      const res = await api.getTiendaNubeOrders(params);
      setOrders(res.orders);
      setTotal(res.total);
      setSelectedOrderIds(prev => prev.filter(id => res.orders.some((o: TiendaNubeOrder) => o.id === id)));
    } catch (error) {
      console.error('Error fetching TN orders:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [page, filterStatus, dateFrom, dateTo, showAllOrders]);

  const statusConfig: Record<string, { label: string; color: string; bg: string; icon: any }> = {
    open: { label: 'Abierta', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30', icon: Clock },
    closed: { label: 'Cerrada', color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/30', icon: CheckCircle },
    cancelled: { label: 'Cancelada', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30', icon: XCircle },
  };

  const paymentStatusConfig: Record<string, { label: string; color: string; bg: string }> = {
    paid: { label: 'PAGADO', color: 'text-green-400', bg: 'bg-green-500/10' },
    pending: { label: 'Pendiente', color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
    refunded: { label: 'Reembolsado', color: 'text-red-400', bg: 'bg-red-500/10' },
    voided: { label: 'Anulado', color: 'text-slate-400', bg: 'bg-slate-500/10' },
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return {
      date: date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }),
      time: date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
      full: date.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    };
  };

  const formatCurrency = (value: string) => {
    return parseFloat(value).toLocaleString('es-AR', { minimumFractionDigits: 2 });
  };

  const filteredOrders = orders.filter(order => {
    if (onlyUnpaid && (order.isPaid === true || order.paymentStatus === 'paid')) return false;
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      order.number.toString().includes(search) ||
      order.customer.name.toLowerCase().includes(search) ||
      order.customer.email.toLowerCase().includes(search) ||
      order.products.some(p => p.name.toLowerCase().includes(search) || p.sku?.toLowerCase().includes(search))
    );
  });

  const totalPages = Math.ceil(total / perPage);

  const stats = {
    total: orders.length,
    paid: orders.filter(o => o.isPaid === true || o.paymentStatus === 'paid').length,
    pending: orders.filter(o => !(o.isPaid === true || o.paymentStatus === 'paid')).length,
    porDespachar: orders.filter(o => (o.isPaid === true || o.paymentStatus === 'paid') && o.shippingStatus !== 'shipped' && o.shippingStatus !== 'delivered').length
  };

  const setQuickDate = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    setDateFrom(from.toISOString().split('T')[0]);
    setDateTo(to.toISOString().split('T')[0]);
    setPage(1);
  };

  const clearDateFilter = () => {
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };
  const clearAllFilters = () => {
    setSearchTerm('');
    setOnlyUnpaid(false);
    setShowAllOrders(true);
    setFilterStatus('');
    setDateFrom(twoDaysAgoIso);
    setDateTo(todayIso);
    setPage(1);
  };

  const toggleOrderSelection = (orderId: number) => {
    setSelectedOrderIds(prev => prev.includes(orderId) ? prev.filter(id => id !== orderId) : [...prev, orderId]);
  };

  const selectAllVisiblePaid = () => {
    const paidIds = filteredOrders
      .filter(o => (o.isPaid === true || o.paymentStatus === 'paid') && !o.invoiced)
      .map(o => o.id);
    setSelectedOrderIds(prev => Array.from(new Set([...prev, ...paidIds])));
  };

  const clearSelection = () => setSelectedOrderIds([]);

  const buildTiendaNubeReceiptHtml = (order: TiendaNubeOrder): string => {
    const remitente = getRemitente();
    const empresa = (remitente.businessName || 'Multimedias SA').toString();
    const empresaCuit = (remitente.cuit || '').toString();
    const empresaDir = [remitente.address, remitente.city].filter(Boolean).join(', ');
    const customerName = (order.customer?.name || 'Cliente').toString().trim();
    const customerEmail = (order.customer?.email || '').toString().trim();
    const customerPhone = (order.customer?.phone || '').toString().trim();
    const createdAt = new Date(order.createdAt);
    const createdAtStr = isNaN(createdAt.getTime())
      ? String(order.createdAt)
      : createdAt.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const now = new Date();
    const nowStr = now.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const address = order.shippingAddress
      ? `${order.shippingAddress.address}, ${order.shippingAddress.city}, ${order.shippingAddress.province}, CP ${order.shippingAddress.zipcode}`
      : 'Sin dirección de envío';
    const totalUnits = (order.products || []).reduce((acc, p) => acc + (Number(p.quantity) || 0), 0);

    const productRows = (order.products || []).map((p) => {
      const qty = Number(p.quantity) || 0;
      return `<tr>
        <td>${(p.name || '').toString().trim() || '—'}</td>
        <td>${(p.sku || '').toString().trim() || '—'}</td>
        <td class="c">${qty}</td>
      </tr>`;
    }).join('');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Recibo TN #${order.number}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; }
    .sheet { max-width: 190mm; margin: 0 auto; }
    h1 { margin: 0 0 4px; font-size: 20px; }
    .muted { color: #555; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 10px; }
    .card { border: 1px solid #222; border-radius: 6px; padding: 10px; min-height: 70px; }
    table { width: 100%; border-collapse: collapse; margin-top: 14px; }
    th, td { border-bottom: 1px solid #ddd; padding: 8px; text-align: left; }
    th { border-top: 1px solid #222; border-bottom: 1px solid #222; font-size: 11px; }
    .c { text-align: center; }
    .signatures { margin-top: 34px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    .sig { border-top: 1px solid #333; padding-top: 6px; text-align: center; min-height: 56px; }
    .print-actions { margin-top: 18px; }
    @media print { .print-actions { display: none; } }
  </style>
</head>
<body>
  <div class="sheet">
    <h1>Recibo de Entrega</h1>
    <div class="muted">Comprobante interno para firma del cliente</div>
    <div class="row">
      <div class="card">
        <div><strong>Empresa:</strong> ${empresa}</div>
        ${empresaCuit ? `<div><strong>CUIT:</strong> ${empresaCuit}</div>` : ''}
        ${empresaDir ? `<div><strong>Domicilio:</strong> ${empresaDir}</div>` : ''}
        <div><strong>Fecha de emisión:</strong> ${nowStr}</div>
      </div>
      <div class="card">
        <div><strong>Pedido Tienda Nube:</strong> #${order.number}</div>
        <div><strong>ID:</strong> ${order.id}</div>
        <div><strong>Fecha pedido:</strong> ${createdAtStr}</div>
        <div><strong>Total unidades:</strong> ${totalUnits}</div>
      </div>
    </div>
    <div class="row">
      <div class="card">
        <div><strong>Cliente:</strong> ${customerName}</div>
        ${customerEmail ? `<div><strong>Email:</strong> ${customerEmail}</div>` : ''}
        ${customerPhone ? `<div><strong>Tel:</strong> ${customerPhone}</div>` : ''}
      </div>
      <div class="card">
        <div><strong>Dirección de entrega:</strong></div>
        <div>${address}</div>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Producto</th>
          <th>SKU</th>
          <th class="c">Cantidad</th>
        </tr>
      </thead>
      <tbody>
        ${productRows || `<tr><td colspan="3" class="c">Sin productos</td></tr>`}
      </tbody>
    </table>
    <div class="signatures">
      <div class="sig">
        Firma cliente<br/>
        Aclaración / DNI
      </div>
      <div class="sig">
        Firma quien entrega<br/>
        Aclaración
      </div>
    </div>
    <div class="print-actions">
      <button onclick="window.print()" style="padding:10px 14px;background:#1f2937;color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer;">Descargar PDF / Imprimir</button>
      <button onclick="window.close()" style="padding:10px 14px;margin-left:8px;background:#94a3b8;color:#fff;border:none;border-radius:6px;cursor:pointer;">Cerrar</button>
    </div>
  </div>
</body>
</html>`;
  };

  const openReceiptForSignature = (order: TiendaNubeOrder) => {
    const html = buildTiendaNubeReceiptHtml(order);
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
  };

  const selectAllFilteredPaid = async () => {
    setSelectingAllFiltered(true);
    try {
      const perPageFetch = 100;
      let currentPage = 1;
      const allPaidIds: number[] = [];

      while (true) {
        const params: any = { page: currentPage, per_page: perPageFetch };
        if (!showAllOrders) params.only_paid_pending_shipment = true;
        if (filterStatus) params.status = filterStatus;
        if (dateFrom) params.created_at_min = dateFrom;
        if (dateTo) params.created_at_max = dateTo;

        const res = await api.getTiendaNubeOrders(params);
        const batch = (res.orders || [])
          .filter((o: any) => (o.isPaid === true || o.paymentStatus === 'paid') && !o.invoiced)
          .map((o: any) => Number(o.id))
          .filter((id: number) => Number.isFinite(id));
        allPaidIds.push(...batch);

        if (!res.orders || res.orders.length < perPageFetch) break;
        currentPage += 1;
        if (currentPage > 500) break;
      }

      const unique = Array.from(new Set(allPaidIds));
      setSelectedOrderIds(unique);
      window.alert(`Se seleccionaron ${unique.length} ventas pagadas del filtro actual.`);
    } catch (error: any) {
      window.alert(error?.message || 'No se pudieron seleccionar todas las ventas pagadas');
    } finally {
      setSelectingAllFiltered(false);
    }
  };

  const handleBulkInvoice = async () => {
    if (selectedOrderIds.length === 0) {
      window.alert('Seleccioná al menos una orden para facturar.');
      return;
    }
    if (!window.confirm(`¿Facturar masivamente ${selectedOrderIds.length} orden(es) de Tienda Nube?`)) return;
    setBulkInvoicing(true);
    try {
      const cbteTipo = bulkCbteTipo === 'A' ? 1 : bulkCbteTipo === 'B' ? 6 : undefined;
      const ids = Array.from(new Set(selectedOrderIds));
      const chunkSize = 100;
      const summary = { invoiced: 0, alreadyInvoiced: 0, skippedUnpaid: 0, errors: 0 };
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const res = await api.invoiceTiendaNubeOrdersBulk({ orderIds: chunk, cbteTipo });
        summary.invoiced += Number(res.summary?.invoiced || 0);
        summary.alreadyInvoiced += Number(res.summary?.alreadyInvoiced || 0);
        summary.skippedUnpaid += Number(res.summary?.skippedUnpaid || 0);
        summary.errors += Number(res.summary?.errors || 0);
      }
      window.alert(
        `Facturación masiva finalizada.\n\n` +
        `Facturadas: ${summary.invoiced}\n` +
        `Ya facturadas: ${summary.alreadyInvoiced}\n` +
        `No pagadas (omitidas): ${summary.skippedUnpaid}\n` +
        `Errores: ${summary.errors}`
      );
      fetchOrders();
    } catch (error: any) {
      window.alert(error?.message || 'No se pudo completar la facturación masiva');
    } finally {
      setBulkInvoicing(false);
    }
  };

  const hasDateFilter = dateFrom || dateTo;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-br from-cyan-500 to-cyan-700 rounded-2xl flex items-center justify-center shadow-lg shadow-cyan-900/30">
            <ShoppingBag className="text-white" size={28} />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white">Ventas Tienda Nube</h2>
            <p className="text-slate-400 text-sm">Gestiona tus órdenes de e-commerce</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={bulkCbteTipo}
            onChange={(e) => setBulkCbteTipo(e.target.value as 'auto' | 'A' | 'B')}
            className="bg-slate-900/70 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-200"
            title="Tipo de factura para lote"
          >
            <option value="auto">Tipo: Auto</option>
            <option value="A">Tipo: Factura A</option>
            <option value="B">Tipo: Factura B</option>
          </select>
          <button
            onClick={selectAllVisiblePaid}
            disabled={loading || filteredOrders.filter(o => (o.isPaid === true || o.paymentStatus === 'paid') && !o.invoiced).length === 0}
            className="bg-slate-800 border border-slate-700 text-slate-200 px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
          >
            Seleccionar pagadas
          </button>
          <button
            onClick={selectAllFilteredPaid}
            disabled={loading || selectingAllFiltered}
            className="bg-cyan-700/40 border border-cyan-600/40 text-cyan-100 px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
            title="Selecciona todas las ventas pagadas según el filtro actual, incluyendo todas las páginas"
          >
            {selectingAllFiltered ? 'Seleccionando...' : 'Seleccionar todas (filtro)'}
          </button>
          <button
            onClick={clearSelection}
            disabled={selectedOrderIds.length === 0}
            className="bg-slate-800 border border-slate-700 text-slate-200 px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
          >
            Limpiar selección
          </button>
          <button
            onClick={handleBulkInvoice}
            disabled={bulkInvoicing || selectedOrderIds.length === 0}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 rounded-xl text-sm font-black disabled:opacity-50"
          >
            {bulkInvoicing ? 'Facturando...' : `Facturar masivo (${selectedOrderIds.length})`}
          </button>
          <button
            onClick={fetchOrders}
            disabled={loading}
            className="bg-gradient-to-r from-cyan-600 to-cyan-700 hover:from-cyan-500 hover:to-cyan-600 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-cyan-900/30 transition-all"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
            Actualizar
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-800/50 rounded-2xl p-4 border border-slate-700/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-700/50 rounded-xl">
              <Package size={20} className="text-slate-400" />
            </div>
            <div>
              <p className="text-2xl font-black text-white">{total}</p>
              <p className="text-xs text-slate-500">Total órdenes</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-2xl p-4 border border-slate-700/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/10 rounded-xl">
              <CheckCircle size={20} className="text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-black text-green-400">{stats.paid}</p>
              <p className="text-xs text-slate-500">Pagadas</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-2xl p-4 border border-slate-700/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-500/10 rounded-xl">
              <Clock size={20} className="text-yellow-400" />
            </div>
            <div>
              <p className="text-2xl font-black text-yellow-400">{stats.pending}</p>
              <p className="text-xs text-slate-500">Pendientes</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-2xl p-4 border border-slate-700/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-500/10 rounded-xl">
              <Truck size={20} className="text-cyan-400" />
            </div>
            <div>
              <p className="text-2xl font-black text-cyan-400">{stats.porDespachar}</p>
              <p className="text-xs text-slate-500">Por despachar</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-slate-800/30 rounded-2xl p-4 border border-slate-700/30 space-y-4">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-[11px] font-black text-slate-500 uppercase">Vista</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => { setShowAllOrders(true); setFilterStatus(''); setPage(1); }}
                className={`px-3 py-2 rounded-xl text-sm font-bold border ${showAllOrders ? 'bg-cyan-600 text-white border-cyan-500' : 'bg-slate-800/50 text-slate-300 border-slate-700'}`}
              >
                Todas las órdenes
              </button>
              <button
                type="button"
                onClick={() => { setShowAllOrders(false); setFilterStatus(''); setPage(1); }}
                className={`px-3 py-2 rounded-xl text-sm font-bold border ${!showAllOrders ? 'bg-cyan-600 text-white border-cyan-500' : 'bg-slate-800/50 text-slate-300 border-slate-700'}`}
              >
                Solo pagadas por enviar
              </button>
              <button
                type="button"
                onClick={() => { setOnlyUnpaid(v => !v); setPage(1); }}
                className={`px-3 py-2 rounded-xl text-sm font-bold border ${onlyUnpaid ? 'bg-amber-600 text-white border-amber-500' : 'bg-slate-800/50 text-slate-300 border-slate-700'}`}
              >
                Solo no pagados
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-[11px] font-black text-slate-500 uppercase">Estado</p>
            <div className="flex flex-wrap gap-2">
              {[
                { value: '', label: 'Todos' },
                { value: 'open', label: 'Abiertas' },
                { value: 'closed', label: 'Cerradas' },
                { value: 'cancelled', label: 'Canceladas' },
              ].map((status) => (
                <button
                  key={status.value}
                  onClick={() => { setFilterStatus(status.value); setPage(1); }}
                  disabled={!showAllOrders && status.value !== ''}
                  className={`px-3 py-2 rounded-xl text-sm font-bold border transition-all ${
                    filterStatus === status.value
                      ? 'bg-cyan-600 text-white border-cyan-500'
                      : 'bg-slate-800/50 text-slate-300 border-slate-700'
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  {status.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto_auto] gap-3">
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Buscar por número, cliente, producto o SKU..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
              className="w-full bg-slate-900/50 border border-slate-700/50 rounded-xl pl-10 pr-10 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
            />
            {searchTerm && (
              <button onClick={() => { setSearchTerm(''); setPage(1); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                <X size={16} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-slate-500" />
            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="bg-slate-800/50 border border-slate-700/50 rounded-xl px-3 py-2 text-white text-sm" />
            <span className="text-slate-500">-</span>
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="bg-slate-800/50 border border-slate-700/50 rounded-xl px-3 py-2 text-white text-sm" />
          </div>
          <div className="flex items-center gap-2 justify-end">
            <button type="button" onClick={() => setQuickDate(2)} className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-800/60 border border-slate-700 text-slate-300 hover:text-white">2d</button>
            <button type="button" onClick={() => setQuickDate(7)} className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-800/60 border border-slate-700 text-slate-300 hover:text-white">7d</button>
            <button type="button" onClick={() => setQuickDate(30)} className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-800/60 border border-slate-700 text-slate-300 hover:text-white">30d</button>
            <button type="button" onClick={clearAllFilters} className="px-3 py-2 rounded-xl text-xs font-bold bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20">Limpiar filtros</button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-1 rounded-lg bg-slate-900/70 border border-slate-700 text-slate-300">
            Vista: {showAllOrders ? 'Todas' : 'Solo pagadas por enviar'}
          </span>
          <span className="px-2 py-1 rounded-lg bg-slate-900/70 border border-slate-700 text-slate-300">
            Estado: {filterStatus || 'Todos'}
          </span>
          {onlyUnpaid && (
            <span className="px-2 py-1 rounded-lg bg-amber-700/20 border border-amber-600/30 text-amber-300">
              Solo no pagados
            </span>
          )}
          {hasDateFilter && (
            <span className="px-2 py-1 rounded-lg bg-cyan-700/20 border border-cyan-600/30 text-cyan-300">
              Fecha: {dateFrom || '...'} a {dateTo || '...'}
            </span>
          )}
        </div>
      </div>

      {/* Orders List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="animate-spin text-cyan-500 mb-4" size={48} />
          <p className="text-slate-400">Cargando órdenes...</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-slate-800/30 rounded-2xl p-16 text-center border border-slate-700/30">
          <Package className="mx-auto text-slate-600 mb-4" size={56} />
          <p className="text-slate-400 text-lg font-medium">No hay órdenes para mostrar</p>
          <p className="text-slate-500 text-sm mt-1">Intenta cambiar los filtros de búsqueda</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredOrders.map((order) => {
            const status = statusConfig[order.status] || statusConfig.open;
            const normalizedPayment = (order.isPaid === true ? 'paid' : order.paymentStatus) || 'pending';
            const payment = paymentStatusConfig[normalizedPayment] || paymentStatusConfig.pending;
            const dateInfo = formatDate(order.createdAt);
            const isExpanded = expandedOrder === order.id;

            return (
              <div 
                key={order.id} 
                className={`bg-slate-800/40 rounded-2xl border transition-all duration-200 ${
                  isExpanded ? 'border-cyan-500/50 shadow-lg shadow-cyan-900/10' : 'border-slate-700/30 hover:border-slate-600/50'
                }`}
              >
                {/* Order Header */}
                <div 
                  className="p-4 cursor-pointer"
                  onClick={() => setExpandedOrder(isExpanded ? null : order.id)}
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    {/* Left: Order Info */}
                    <div className="flex items-center gap-4">
                      <label
                        className="flex items-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selectedOrderIds.includes(order.id)}
                          onChange={() => toggleOrderSelection(order.id)}
                          disabled={order.invoiced}
                          className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-cyan-500"
                          title="Seleccionar para facturación masiva"
                        />
                      </label>
                      <div className="flex flex-col items-center">
                        <span className="text-xs text-slate-500">{dateInfo.date}</span>
                        <span className="text-[10px] text-slate-600">{dateInfo.time}</span>
                      </div>
                      <div className="w-px h-10 bg-slate-700/50" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-white font-black text-lg">#{order.number}</span>
                          <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border ${status.bg} ${status.color}`}>
                            {status.label.toUpperCase()}
                          </span>
                          <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${payment.bg} ${payment.color}`}>
                            {payment.label}
                          </span>
                          <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${order.invoiced ? 'bg-emerald-700/20 text-emerald-300' : 'bg-slate-700/40 text-slate-300'}`}>
                            {order.invoiced ? 'FACTURADA' : 'SIN FACTURA'}
                          </span>
                          {order.paymentStatusRaw && order.paymentStatusRaw !== normalizedPayment && (
                            <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-700/40 text-slate-300">
                              TN: {order.paymentStatusRaw}
                            </span>
                          )}
                        </div>
                        <p className="text-slate-400 text-sm mt-0.5">
                          <User size={12} className="inline mr-1" />
                          {order.customer.name}
                        </p>
                      </div>
                    </div>

                    {/* Right: Cantidad de productos (sin monto) */}
                    <div className="flex items-center gap-4">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openReceiptForSignature(order);
                        }}
                        className="px-3 py-2 rounded-xl bg-cyan-700/30 border border-cyan-600/40 text-cyan-100 text-xs font-black hover:bg-cyan-700/50 flex items-center gap-2"
                        title="Generar recibo del pedido para firma del cliente"
                      >
                        <FileText size={14} />
                        Recibo firma
                      </button>
                      <div className="text-right">
                        <p className="text-sm font-bold text-white">{order.products.length} producto{order.products.length !== 1 ? 's' : ''}</p>
                        <p className="text-xs text-slate-500">#{order.number}</p>
                      </div>
                      <ChevronDown 
                        size={20} 
                        className={`text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} 
                      />
                    </div>
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-slate-700/30 pt-4">
                    <div className="grid lg:grid-cols-3 gap-4">
                      {/* Customer Info */}
                      <div className="bg-slate-900/30 rounded-xl p-4">
                        <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold mb-3">
                          <User size={14} />
                          <span>CLIENTE</span>
                        </div>
                        <p className="text-white font-bold">{order.customer.name}</p>
                        <p className="text-slate-400 text-sm">{order.customer.email}</p>
                        {order.customer.phone && (
                          <p className="text-slate-400 text-sm">{order.customer.phone}</p>
                        )}
                      </div>

                      {/* Shipping Address */}
                      {order.shippingAddress && (
                        <div className="bg-slate-900/30 rounded-xl p-4">
                          <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold mb-3">
                            <MapPin size={14} />
                            <span>ENVÍO</span>
                          </div>
                          <p className="text-white text-sm">{order.shippingAddress.address}</p>
                          <p className="text-slate-400 text-sm">
                            {order.shippingAddress.city}, {order.shippingAddress.province}
                          </p>
                          <p className="text-slate-500 text-sm">CP: {order.shippingAddress.zipcode}</p>
                        </div>
                      )}

                      {/* Order Date */}
                      <div className="bg-slate-900/30 rounded-xl p-4">
                        <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold mb-3">
                          <Calendar size={14} />
                          <span>FECHA</span>
                        </div>
                        <p className="text-white text-sm">{dateInfo.full}</p>
                        <p className="text-slate-400 text-sm">a las {dateInfo.time} hs</p>
                      </div>
                    </div>

                    {/* Products */}
                    <div className="mt-4">
                      <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold mb-3">
                        <Package size={14} />
                        <span>PRODUCTOS</span>
                      </div>
                      <div className="bg-slate-900/30 rounded-xl overflow-hidden">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-slate-700/30">
                              <th className="text-left text-[10px] text-slate-500 font-bold uppercase p-3">Producto</th>
                              <th className="text-left text-[10px] text-slate-500 font-bold uppercase p-3">SKU</th>
                              <th className="text-center text-[10px] text-slate-500 font-bold uppercase p-3">Cant.</th>
                            </tr>
                          </thead>
                          <tbody>
                            {order.products.map((product, i) => (
                              <tr key={i} className="border-b border-slate-700/20 last:border-0">
                                <td className="p-3 text-white text-sm">{product.name}</td>
                                <td className="p-3 text-slate-400 text-xs font-mono">{product.sku || '-'}</td>
                                <td className="p-3 text-center text-cyan-400 font-bold">{product.quantity}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-6 pb-2">
          <div className="flex flex-wrap justify-center items-center gap-2">
            <span className="text-xs text-slate-500 px-2">
              Página {page} de {totalPages}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap justify-center items-center gap-2">
          <button
            onClick={() => setPage(1)}
            disabled={page === 1}
            className="h-10 px-3 bg-slate-800/50 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-700/50 transition-colors text-slate-200 text-sm font-bold"
          >
            «
          </button>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="h-10 px-3 bg-slate-800/50 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-700/50 transition-colors text-slate-200 text-sm font-bold"
          >
            <ChevronLeft size={16} className="text-white" />
          </button>
          
          <div className="flex items-center gap-1 px-1">
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (page <= 3) {
                pageNum = i + 1;
              } else if (page >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = page - 2 + i;
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={`w-10 h-10 rounded-xl font-bold text-sm transition-all ${
                    page === pageNum
                      ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-900/30'
                      : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50 hover:text-white'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="h-10 px-3 bg-slate-800/50 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-700/50 transition-colors text-slate-200 text-sm font-bold"
          >
            <ChevronRight size={16} className="text-white" />
          </button>
          <button
            onClick={() => setPage(totalPages)}
            disabled={page === totalPages}
            className="h-10 px-3 bg-slate-800/50 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-700/50 transition-colors text-slate-200 text-sm font-bold"
          >
            »
          </button>
        </div>
        </div>
      )}
    </div>
  );
};

export default TiendaNubeOrders;
