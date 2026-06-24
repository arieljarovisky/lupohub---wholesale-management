import React, { useState, useEffect } from 'react';
import { RefreshCw, Package, User, Truck, ChevronLeft, ChevronRight, Loader2, Zap, Calendar, Search, X, Clock, CheckCircle, XCircle, ChevronDown, ExternalLink, ShoppingCart, MessageCircle, Download } from 'lucide-react';
import { api } from '../services/api';
import { openExternalInvoicePdf } from '../utils/externalInvoicePdf';
import MercadoLibreQuestions from './MercadoLibreQuestions';

interface MercadoLibreOrder {
  id: number;
  orderIds?: number[];
  status: string;
  statusDetail: string;
  total: number;
  currency: string;
  buyer: {
    id: number;
    nickname: string;
    firstName: string;
    lastName: string;
  };
  items: {
    id: string;
    title: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    variationId: number;
  }[];
  shipping: {
    id: number;
    status: string;
  } | null;
  dateCreated: string;
  dateClosed: string;
  invoiced?: boolean;
  invoicedCount?: number;
  totalOrderIds?: number;
  invoice?: {
    id: string;
    cae: string;
    cbteTipo: number;
    cbteDesde: number;
    createdAt?: string;
  };
}

type MlSection = 'orders' | 'questions';

interface MercadoLibreOrdersProps {
  defaultSection?: MlSection;
  onSectionChange?: (section: MlSection) => void;
}

const MercadoLibreOrders: React.FC<MercadoLibreOrdersProps> = ({ defaultSection = 'orders', onSectionChange }) => {
  const [orders, setOrders] = useState<MercadoLibreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [showAllSales, setShowAllSales] = useState(false); // por defecto solo por despachar + canceladas
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedOrder, setExpandedOrder] = useState<number | null>(null);
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [selectedOrderIds, setSelectedOrderIds] = useState<number[]>([]);
  const [bulkInvoicing, setBulkInvoicing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{
    processed: number;
    total: number;
    chunksDone: number;
    chunksTotal: number;
  } | null>(null);
  const [selectingAllFiltered, setSelectingAllFiltered] = useState(false);
  const [bulkCbteTipo, setBulkCbteTipo] = useState<'auto' | 'A' | 'B'>('auto');
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState<string | null>(null);
  const [mlSection, setMlSection] = useState<MlSection>(defaultSection);
  const limit = 15;

  useEffect(() => {
    setMlSection(defaultSection);
  }, [defaultSection]);

  const switchSection = (section: MlSection) => {
    setMlSection(section);
    onSectionChange?.(section);
  };

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const params: any = { offset, limit };
      if (!showAllSales) params.only_pending_shipment_and_cancelled = true;
      if (filterStatus) params.status = filterStatus;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      
      const res = await api.getMercadoLibreOrders(params);
      setOrders(res.orders);
      setTotal(res.total);
      const visibleIds = new Set<number>();
      res.orders.forEach((o: MercadoLibreOrder) => {
        if (Array.isArray(o.orderIds) && o.orderIds.length > 0) {
          o.orderIds.forEach(id => visibleIds.add(id));
        } else {
          visibleIds.add(o.id);
        }
      });
      setSelectedOrderIds(prev => prev.filter(id => visibleIds.has(id)));
    } catch (error) {
      console.error('Error fetching ML orders:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [offset, filterStatus, dateFrom, dateTo, showAllSales]);

  const statusConfig: Record<string, { label: string; color: string; bg: string; icon: any }> = {
    paid: { label: 'Pagada', color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/30', icon: CheckCircle },
    confirmed: { label: 'Confirmada', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30', icon: Clock },
    cancelled: { label: 'Cancelada', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30', icon: XCircle },
    pending: { label: 'Pendiente', color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30', icon: Clock },
  };

  const shippingStatusConfig: Record<string, { label: string; color: string }> = {
    delivered: { label: 'Entregado', color: 'text-green-400' },
    shipped: { label: 'Enviado', color: 'text-blue-400' },
    ready_to_ship: { label: 'Listo', color: 'text-cyan-400' },
    pending: { label: 'Pendiente', color: 'text-slate-400' },
    handling: { label: 'Preparando', color: 'text-orange-400' },
    to_be_agreed: { label: 'A coordinar', color: 'text-purple-400' },
    not_delivered: { label: 'No entregado', color: 'text-red-400' },
    cancelled: { label: 'Cancelado', color: 'text-red-400' },
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return {
      date: date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }),
      time: date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
      full: date.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    };
  };

  const formatCurrency = (value: number) => {
    return value.toLocaleString('es-AR', { minimumFractionDigits: 2 });
  };

  const totalUnitsForOrder = (order: MercadoLibreOrder): number =>
    (order.items || []).reduce((acc, item) => acc + Math.max(0, Number(item.quantity) || 0), 0);

  const filteredOrders = orders.filter(order => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      order.id.toString().includes(search) ||
      order.buyer.nickname.toLowerCase().includes(search) ||
      `${order.buyer.firstName} ${order.buyer.lastName}`.toLowerCase().includes(search) ||
      order.items.some(item => item.title.toLowerCase().includes(search) || item.sku?.toLowerCase().includes(search))
    );
  });

  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);

  const stats = {
    total: orders.length,
    paid: orders.filter(o => o.status === 'paid').length,
    pending: orders.filter(o => o.status === 'pending' || o.status === 'confirmed').length,
    porDespachar: orders.filter(o => o.status === 'paid' && o.shipping?.status && ['ready_to_ship', 'pending', 'handling'].includes(o.shipping.status)).length
  };

  const setQuickDate = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    setDateFrom(from.toISOString().split('T')[0]);
    setDateTo(to.toISOString().split('T')[0]);
    setOffset(0);
  };

  const clearDateFilter = () => {
    setDateFrom('');
    setDateTo('');
    setOffset(0);
  };
  const clearAllFilters = () => {
    setShowAllSales(false);
    setFilterStatus('');
    setDateFrom('');
    setDateTo('');
    setSearchTerm('');
    setOffset(0);
  };

  const rowOrderIds = (order: MercadoLibreOrder): number[] =>
    (order.orderIds && order.orderIds.length > 0 ? order.orderIds : [order.id]).map(Number).filter(n => Number.isFinite(n));

  const rowSelectableOrderIds = (order: MercadoLibreOrder): number[] => {
    const all = rowOrderIds(order);
    const invoicedCount = Number(order.invoicedCount || 0);
    if (!invoicedCount) return all;
    if (order.invoiced) return [];
    // Para filas agrupadas, priorizamos no volver a seleccionar los ya facturados.
    // Si backend no informa exactamente cuáles, al menos limitamos por diferencia.
    return all.slice(0, Math.max(0, all.length - invoicedCount));
  };

  const rowIsFullySelected = (order: MercadoLibreOrder): boolean => {
    const ids = rowOrderIds(order);
    return ids.length > 0 && ids.every(id => selectedOrderIds.includes(id));
  };

  const toggleRowSelection = (order: MercadoLibreOrder) => {
    const ids = rowSelectableOrderIds(order);
    setSelectedOrderIds(prev => {
      const selected = new Set(prev);
      const allSelected = ids.every(id => selected.has(id));
      if (allSelected) ids.forEach(id => selected.delete(id));
      else ids.forEach(id => selected.add(id));
      return Array.from(selected);
    });
  };

  const selectAllVisiblePaid = () => {
    const paidIds = filteredOrders
      .filter(o => o.status === 'paid' && !o.invoiced)
      .flatMap(o => rowSelectableOrderIds(o));
    setSelectedOrderIds(prev => Array.from(new Set([...prev, ...paidIds])));
  };

  const clearSelection = () => setSelectedOrderIds([]);

  const selectAllFilteredPaid = async () => {
    setSelectingAllFiltered(true);
    try {
      const limitFetch = 50;
      let currentOffset = 0;
      const allPaidIds: number[] = [];

      while (true) {
        const params: any = { offset: currentOffset, limit: limitFetch };
        if (!showAllSales) params.only_pending_shipment_and_cancelled = true;
        if (filterStatus) params.status = filterStatus;
        if (dateFrom) params.date_from = dateFrom;
        if (dateTo) params.date_to = dateTo;

        const res = await api.getMercadoLibreOrders(params);
        const batchOrders = res.orders || [];
        for (const o of batchOrders as any[]) {
          if (o.status !== 'paid' || o.invoiced) continue;
          const ids = (Array.isArray(o.orderIds) && o.orderIds.length > 0 ? o.orderIds : [o.id])
            .map((id: any) => Number(id))
            .filter((id: number) => Number.isFinite(id));
          allPaidIds.push(...ids);
        }

        currentOffset += limitFetch;
        if (currentOffset >= Number(res.total || 0)) break;
        if (currentOffset > 50000) break;
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

  const handleDownloadInvoice = async (order: MercadoLibreOrder, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const invoiceId = order.invoice?.id;
    if (!invoiceId) {
      window.alert('Esta venta aún no tiene factura emitida en LupoHub.');
      return;
    }
    setDownloadingInvoiceId(invoiceId);
    try {
      await openExternalInvoicePdf(invoiceId);
    } catch (error: any) {
      window.alert(error?.message || 'No se pudo abrir la factura');
    } finally {
      setDownloadingInvoiceId(null);
    }
  };

  const handleBulkInvoice = async () => {
    if (selectedOrderIds.length === 0) {
      window.alert('Seleccioná al menos una orden para facturar.');
      return;
    }
    if (!window.confirm(`¿Facturar masivamente ${selectedOrderIds.length} orden(es) de Mercado Libre?`)) return;
    setBulkInvoicing(true);
    setBulkProgress(null);
    try {
      const cbteTipo = bulkCbteTipo === 'A' ? 1 : bulkCbteTipo === 'B' ? 6 : undefined;
      const ids = Array.from(new Set(selectedOrderIds));
      const chunkSize = 100;
      const chunksTotal = Math.ceil(ids.length / chunkSize);
      const summary = { invoiced: 0, alreadyInvoiced: 0, skippedUnpaid: 0, errors: 0 };
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const chunkIndex = Math.floor(i / chunkSize) + 1;
        setBulkProgress({
          processed: i,
          total: ids.length,
          chunksDone: chunkIndex - 1,
          chunksTotal
        });
        const res = await api.invoiceMercadoLibreOrdersBulk({ orderIds: chunk, cbteTipo });
        summary.invoiced += Number(res.summary?.invoiced || 0);
        summary.alreadyInvoiced += Number(res.summary?.alreadyInvoiced || 0);
        summary.skippedUnpaid += Number(res.summary?.skippedUnpaid || 0);
        summary.errors += Number(res.summary?.errors || 0);
        setBulkProgress({
          processed: Math.min(i + chunk.length, ids.length),
          total: ids.length,
          chunksDone: chunkIndex,
          chunksTotal
        });
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
      setBulkProgress(null);
    }
  };

  const hasDateFilter = dateFrom || dateTo;

  return (
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-slate-700/80 pb-0">
        <button
          type="button"
          onClick={() => switchSection('orders')}
          className={`px-4 py-2.5 rounded-t-xl text-sm font-bold transition-colors ${
            mlSection === 'orders'
              ? 'bg-slate-800 text-white border border-b-0 border-slate-600'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          Ventas
        </button>
        <button
          type="button"
          onClick={() => switchSection('questions')}
          className={`px-4 py-2.5 rounded-t-xl text-sm font-bold transition-colors flex items-center gap-1.5 ${
            mlSection === 'questions'
              ? 'bg-slate-800 text-cyan-200 border border-b-0 border-cyan-600/50'
              : 'text-slate-500 hover:text-cyan-300/90'
          }`}
        >
          <MessageCircle size={16} />
          Preguntas
        </button>
      </div>

      {mlSection === 'questions' ? (
        <MercadoLibreQuestions />
      ) : (
      <>
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-br from-yellow-500 to-yellow-700 rounded-2xl flex items-center justify-center shadow-lg shadow-yellow-900/30">
            <Zap className="text-white" size={28} />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white">Ventas Mercado Libre</h2>
            <p className="text-slate-400 text-sm">Gestiona tus ventas del marketplace</p>
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
            disabled={loading || filteredOrders.filter(o => o.status === 'paid' && !o.invoiced).length === 0}
            className="bg-slate-800 border border-slate-700 text-slate-200 px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
          >
            Seleccionar pagadas
          </button>
          <button
            onClick={selectAllFilteredPaid}
            disabled={loading || selectingAllFiltered}
            className="bg-yellow-700/40 border border-yellow-600/40 text-yellow-100 px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
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
            {bulkInvoicing
              ? `Facturando ${bulkProgress?.processed || 0}/${bulkProgress?.total || selectedOrderIds.length}`
              : `Facturar masivo (${selectedOrderIds.length})`}
          </button>
          <button
            onClick={fetchOrders}
            disabled={loading}
            className="bg-gradient-to-r from-yellow-600 to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-yellow-900/30 transition-all"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
            Actualizar
          </button>
        </div>
      </div>
      {bulkInvoicing && bulkProgress && (
        <div className="text-xs text-emerald-300 bg-emerald-900/20 border border-emerald-700/40 rounded-xl px-3 py-2">
          Facturando lote {bulkProgress.chunksDone}/{bulkProgress.chunksTotal} - {bulkProgress.processed}/{bulkProgress.total} ordenes procesadas.
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-800/50 rounded-2xl p-4 border border-slate-700/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-700/50 rounded-xl">
              <ShoppingCart size={20} className="text-slate-400" />
            </div>
            <div>
              <p className="text-2xl font-black text-white">{total}</p>
              <p className="text-xs text-slate-500">Total ventas</p>
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
              <p className="text-xs text-slate-500">En proceso</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-2xl p-4 border border-slate-700/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-500/10 rounded-xl">
              <Truck size={20} className="text-yellow-400" />
            </div>
            <div>
              <p className="text-2xl font-black text-yellow-400">{stats.porDespachar}</p>
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
                onClick={() => { setShowAllSales(false); setFilterStatus(''); setOffset(0); }}
                className={`px-3 py-2 rounded-xl text-sm font-bold border ${!showAllSales ? 'bg-yellow-600 text-white border-yellow-500' : 'bg-slate-800/50 text-slate-300 border-slate-700'}`}
              >
                Solo por enviar
              </button>
              <button
                type="button"
                onClick={() => { setShowAllSales(true); setOffset(0); }}
                className={`px-3 py-2 rounded-xl text-sm font-bold border ${showAllSales ? 'bg-yellow-600 text-white border-yellow-500' : 'bg-slate-800/50 text-slate-300 border-slate-700'}`}
              >
                Todas las ventas
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-[11px] font-black text-slate-500 uppercase">Estado</p>
            <div className="flex flex-wrap gap-2">
              {[
                { value: '', label: 'Todos' },
                { value: 'paid', label: 'Pagadas' },
                { value: 'confirmed', label: 'Confirmadas' },
                { value: 'cancelled', label: 'Canceladas' },
              ].map((status) => (
                <button
                  key={status.value}
                  onClick={() => { setFilterStatus(status.value); setOffset(0); }}
                  disabled={!showAllSales && status.value !== ''}
                  className={`px-3 py-2 rounded-xl text-sm font-bold border transition-all ${
                    filterStatus === status.value
                      ? 'bg-yellow-600 text-white border-yellow-500'
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
              placeholder="Buscar por ID, comprador, producto o SKU..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setOffset(0); }}
              className="w-full bg-slate-900/50 border border-slate-700/50 rounded-xl pl-10 pr-10 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-yellow-500/50 transition-colors"
            />
            {searchTerm && (
              <button onClick={() => { setSearchTerm(''); setOffset(0); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                <X size={16} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-slate-500" />
            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setOffset(0); }} className="bg-slate-800/50 border border-slate-700/50 rounded-xl px-3 py-2 text-white text-sm" />
            <span className="text-slate-500">-</span>
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setOffset(0); }} className="bg-slate-800/50 border border-slate-700/50 rounded-xl px-3 py-2 text-white text-sm" />
          </div>
          <div className="flex items-center gap-2 justify-end">
            <button type="button" onClick={() => setQuickDate(7)} className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-800/60 border border-slate-700 text-slate-300 hover:text-white">7d</button>
            <button type="button" onClick={() => setQuickDate(30)} className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-800/60 border border-slate-700 text-slate-300 hover:text-white">30d</button>
            <button type="button" onClick={() => setQuickDate(90)} className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-800/60 border border-slate-700 text-slate-300 hover:text-white">90d</button>
            <button type="button" onClick={clearAllFilters} className="px-3 py-2 rounded-xl text-xs font-bold bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20">Limpiar filtros</button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-1 rounded-lg bg-slate-900/70 border border-slate-700 text-slate-300">
            Vista: {showAllSales ? 'Todas' : 'Solo por enviar'}
          </span>
          <span className="px-2 py-1 rounded-lg bg-slate-900/70 border border-slate-700 text-slate-300">
            Estado: {filterStatus || 'Todos'}
          </span>
          {hasDateFilter && (
            <span className="px-2 py-1 rounded-lg bg-yellow-700/20 border border-yellow-600/30 text-yellow-300">
              Fecha: {dateFrom || '...'} a {dateTo || '...'}
            </span>
          )}
        </div>
      </div>

      {/* Orders List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="animate-spin text-yellow-500 mb-4" size={48} />
          <p className="text-slate-400">Cargando ventas...</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-slate-800/30 rounded-2xl p-16 text-center border border-slate-700/30">
          <Package className="mx-auto text-slate-600 mb-4" size={56} />
          <p className="text-slate-400 text-lg font-medium">No hay ventas para mostrar</p>
          <p className="text-slate-500 text-sm mt-1">Intenta cambiar los filtros de búsqueda</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredOrders.map((order) => {
            const status = statusConfig[order.status] || statusConfig.pending;
            const shipping = order.shipping ? (shippingStatusConfig[order.shipping.status] || shippingStatusConfig.pending) : null;
            const dateInfo = formatDate(order.dateCreated);
            const isExpanded = expandedOrder === order.id;
            const isGrouped = order.orderIds && order.orderIds.length > 1;

            return (
              <div 
                key={order.orderIds ? order.orderIds.join('-') : order.id} 
                className={`bg-slate-800/40 rounded-2xl border transition-all duration-200 ${
                  isExpanded ? 'border-yellow-500/50 shadow-lg shadow-yellow-900/10' : 'border-slate-700/30 hover:border-slate-600/50'
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
                          checked={rowIsFullySelected(order)}
                          onChange={() => toggleRowSelection(order)}
                          disabled={order.invoiced}
                          className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-yellow-500"
                          title="Seleccionar para facturación masiva"
                        />
                      </label>
                      <div className="flex flex-col items-center">
                        <span className="text-xs text-slate-500">{dateInfo.date}</span>
                        <span className="text-[10px] text-slate-600">{dateInfo.time}</span>
                      </div>
                      <div className="w-px h-10 bg-slate-700/50" />
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {isGrouped ? (
                            <span className="text-white font-black text-lg">
                              {order.orderIds!.length} órdenes · #{order.orderIds![0]}
                            </span>
                          ) : (
                            <span className="text-white font-black text-lg">#{order.id}</span>
                          )}
                          <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border ${status.bg} ${status.color}`}>
                            {status.label.toUpperCase()}
                          </span>
                          <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${order.invoiced ? 'bg-emerald-700/20 text-emerald-300' : 'bg-slate-700/40 text-slate-300'}`}>
                            {order.invoiced ? 'FACTURADA' : 'SIN FACTURA'}
                            {typeof order.invoicedCount === 'number' && typeof order.totalOrderIds === 'number' && order.totalOrderIds > 1
                              ? ` (${order.invoicedCount}/${order.totalOrderIds})`
                              : ''}
                          </span>
                          {shipping && order.status !== 'cancelled' && (
                            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold bg-slate-700/50 ${shipping.color} flex items-center gap-1`}>
                              <Truck size={10} />
                              {shipping.label}
                            </span>
                          )}
                        </div>
                        <p className="text-slate-400 text-sm mt-0.5">
                          <User size={12} className="inline mr-1" />
                          {order.buyer.firstName} {order.buyer.lastName}
                          <span className="text-slate-500 ml-2">@{order.buyer.nickname}</span>
                        </p>
                      </div>
                    </div>

                    {/* Right: Cantidad de productos (sin monto) */}
                    <div className="flex items-center gap-4">
                      {order.invoiced && order.invoice?.id && (
                        <button
                          type="button"
                          onClick={(e) => handleDownloadInvoice(order, e)}
                          disabled={downloadingInvoiceId === order.invoice!.id}
                          className="px-3 py-2 rounded-xl bg-emerald-700/30 border border-emerald-600/40 text-emerald-100 text-xs font-black hover:bg-emerald-700/50 disabled:opacity-50 flex items-center gap-2"
                          title="Descargar factura AFIP (PDF)"
                        >
                          {downloadingInvoiceId === order.invoice.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Download size={14} />
                          )}
                          Factura PDF
                        </button>
                      )}
                      <div className="text-right">
                        <p className="text-sm font-bold text-white">
                          {totalUnitsForOrder(order)} unidad{totalUnitsForOrder(order) !== 1 ? 'es' : ''}
                        </p>
                        <p className="text-xs text-slate-500">
                          {order.items.length} línea{order.items.length !== 1 ? 's' : ''} de producto
                        </p>
                        <p className="text-xs text-slate-500">{isGrouped ? `Compra con ${order.orderIds!.length} órdenes ML` : `#${order.id}`}</p>
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
                      {/* Buyer Info */}
                      <div className="bg-slate-900/30 rounded-xl p-4">
                        <div className="flex items-center gap-2 text-yellow-400 text-xs font-bold mb-3">
                          <User size={14} />
                          <span>COMPRADOR</span>
                        </div>
                        <p className="text-white font-bold">{order.buyer.firstName} {order.buyer.lastName}</p>
                        <p className="text-slate-400 text-sm">@{order.buyer.nickname}</p>
                        <p className="text-slate-500 text-xs mt-2">ID: {order.buyer.id}</p>
                      </div>

                      {/* Shipping Info */}
                      {order.shipping && (
                        <div className="bg-slate-900/30 rounded-xl p-4">
                          <div className="flex items-center gap-2 text-yellow-400 text-xs font-bold mb-3">
                            <Truck size={14} />
                            <span>ENVÍO</span>
                          </div>
                          <p className={`font-bold ${shipping?.color || 'text-white'}`}>
                            {shipping?.label || order.shipping.status}
                          </p>
                          <p className="text-slate-500 text-xs mt-2">ID: {order.shipping.id}</p>
                        </div>
                      )}

                      {/* Order Date */}
                      <div className="bg-slate-900/30 rounded-xl p-4">
                        <div className="flex items-center gap-2 text-yellow-400 text-xs font-bold mb-3">
                          <Calendar size={14} />
                          <span>FECHA</span>
                        </div>
                        <p className="text-white text-sm">{dateInfo.full}</p>
                        <p className="text-slate-400 text-sm">a las {dateInfo.time} hs</p>
                        {order.orderIds && order.orderIds.length > 1 && (
                          <p className="text-slate-400 text-xs mt-2">
                            Órdenes ML: {order.orderIds.map(id => `#${id}`).join(', ')}
                          </p>
                        )}
                        {order.dateClosed && (
                          <p className="text-slate-500 text-xs mt-2">
                            Cerrada: {formatDate(order.dateClosed).full}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Products */}
                    <div className="mt-4">
                      <div className="flex items-center gap-2 text-yellow-400 text-xs font-bold mb-3">
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
                            {order.items.map((item, i) => (
                              <tr key={i} className="border-b border-slate-700/20 last:border-0">
                                <td className="p-3">
                                  <p className="text-white text-sm">{item.title}</p>
                                  <p className="text-slate-500 text-[10px]">ID: {item.id}</p>
                                </td>
                                <td className="p-3 text-slate-400 text-xs font-mono">{item.sku || '-'}</td>
                                <td className="p-3 text-center text-yellow-400 font-bold">{item.quantity}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* External Link(s) */}
                    <div className="mt-4 flex justify-end flex-wrap gap-2">
                      {order.orderIds && order.orderIds.length > 1 ? (
                        order.orderIds.slice(0, 3).map((oid) => (
                          <a
                            key={oid}
                            href={`https://www.mercadolibre.com.ar/ventas/${oid}/detalle`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-yellow-400 hover:text-yellow-300 text-sm font-bold flex items-center gap-1 transition-colors"
                          >
                            #{oid} <ExternalLink size={12} />
                          </a>
                        ))
                      ) : (
                        <a
                          href={`https://www.mercadolibre.com.ar/ventas/${order.id}/detalle`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-yellow-400 hover:text-yellow-300 text-sm font-bold flex items-center gap-2 transition-colors"
                        >
                          Ver en Mercado Libre
                          <ExternalLink size={14} />
                        </a>
                      )}
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
              Página {currentPage} de {totalPages}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap justify-center items-center gap-2">
          <button
            onClick={() => setOffset(0)}
            disabled={offset === 0}
            className="h-10 px-3 bg-slate-800/50 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-700/50 transition-colors text-slate-200 text-sm font-bold"
          >
            «
          </button>
          <button
            onClick={() => setOffset(o => Math.max(0, o - limit))}
            disabled={offset === 0}
            className="h-10 px-3 bg-slate-800/50 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-700/50 transition-colors text-slate-200 text-sm font-bold"
          >
            <ChevronLeft size={16} className="text-white" />
          </button>
          
          <div className="flex items-center gap-1 px-1">
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (currentPage <= 3) {
                pageNum = i + 1;
              } else if (currentPage >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = currentPage - 2 + i;
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => setOffset((pageNum - 1) * limit)}
                  className={`w-10 h-10 rounded-xl font-bold text-sm transition-all ${
                    currentPage === pageNum
                      ? 'bg-yellow-600 text-white shadow-lg shadow-yellow-900/30'
                      : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50 hover:text-white'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => setOffset(o => o + limit)}
            disabled={currentPage >= totalPages}
            className="h-10 px-3 bg-slate-800/50 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-700/50 transition-colors text-slate-200 text-sm font-bold"
          >
            <ChevronRight size={16} className="text-white" />
          </button>
          <button
            onClick={() => setOffset((totalPages - 1) * limit)}
            disabled={currentPage >= totalPages}
            className="h-10 px-3 bg-slate-800/50 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-700/50 transition-colors text-slate-200 text-sm font-bold"
          >
            »
          </button>
        </div>
        </div>
      )}
      </>
      )}
    </div>
  );
};

export default MercadoLibreOrders;
