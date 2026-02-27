import React, { useState, useEffect } from 'react';
import { RefreshCw, Package, User, Truck, ChevronLeft, ChevronRight, Loader2, Zap, DollarSign, Calendar, Search, X, Clock, CheckCircle, XCircle, ChevronDown, ExternalLink, ShoppingCart } from 'lucide-react';
import { api } from '../services/api';

interface MercadoLibreOrder {
  id: number;
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
}

const MercadoLibreOrders: React.FC = () => {
  const [orders, setOrders] = useState<MercadoLibreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedOrder, setExpandedOrder] = useState<number | null>(null);
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const limit = 15;

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const params: any = { offset, limit };
      if (filterStatus) params.status = filterStatus;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      
      const res = await api.getMercadoLibreOrders(params);
      setOrders(res.orders);
      setTotal(res.total);
    } catch (error) {
      console.error('Error fetching ML orders:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [offset, filterStatus, dateFrom, dateTo]);

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
    totalAmount: orders.reduce((sum, o) => sum + (o.total || 0), 0)
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

  const hasDateFilter = dateFrom || dateTo;

  return (
    <div className="space-y-6">
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
        <button
          onClick={fetchOrders}
          disabled={loading}
          className="bg-gradient-to-r from-yellow-600 to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-yellow-900/30 transition-all"
        >
          {loading ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
          Actualizar
        </button>
      </div>

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
              <DollarSign size={20} className="text-yellow-400" />
            </div>
            <div>
              <p className="text-2xl font-black text-yellow-400">${formatCurrency(stats.totalAmount)}</p>
              <p className="text-xs text-slate-500">Facturado</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-slate-800/30 rounded-2xl p-4 border border-slate-700/30 space-y-4">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Search */}
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Buscar por ID, comprador, producto o SKU..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-900/50 border border-slate-700/50 rounded-xl pl-10 pr-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-yellow-500/50 transition-colors"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                <X size={16} />
              </button>
            )}
          </div>

          {/* Date Filter Toggle */}
          <button
            onClick={() => setShowDateFilter(!showDateFilter)}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${
              hasDateFilter
                ? 'bg-yellow-600 text-white shadow-lg shadow-yellow-900/30'
                : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50 hover:text-white border border-slate-700/50'
            }`}
          >
            <Calendar size={16} />
            {hasDateFilter ? 'Filtro activo' : 'Filtrar por fecha'}
            {hasDateFilter && (
              <span 
                onClick={(e) => { e.stopPropagation(); clearDateFilter(); }}
                className="ml-1 hover:bg-yellow-700 rounded-full p-0.5"
              >
                <X size={14} />
              </span>
            )}
          </button>

          {/* Status Filter */}
          <div className="flex gap-2 flex-wrap">
            {[
              { value: '', label: 'Todas' },
              { value: 'paid', label: 'Pagadas' },
              { value: 'confirmed', label: 'Confirmadas' },
              { value: 'cancelled', label: 'Canceladas' },
            ].map((status) => (
              <button
                key={status.value}
                onClick={() => { setFilterStatus(status.value); setOffset(0); }}
                className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                  filterStatus === status.value
                    ? 'bg-yellow-600 text-white shadow-lg shadow-yellow-900/30'
                    : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50 hover:text-white border border-slate-700/50'
                }`}
              >
                {status.label}
              </button>
            ))}
          </div>
        </div>

        {/* Date Filter Panel */}
        {showDateFilter && (
          <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/30">
            <div className="flex flex-col lg:flex-row gap-4 items-end">
              {/* Quick Filters */}
              <div className="flex-1">
                <p className="text-xs text-slate-500 font-bold uppercase mb-2">Filtros rápidos</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setQuickDate(7)}
                    className="px-3 py-1.5 bg-slate-800/50 hover:bg-slate-700/50 text-slate-300 hover:text-white rounded-lg text-xs font-bold transition-colors"
                  >
                    Últimos 7 días
                  </button>
                  <button
                    onClick={() => setQuickDate(15)}
                    className="px-3 py-1.5 bg-slate-800/50 hover:bg-slate-700/50 text-slate-300 hover:text-white rounded-lg text-xs font-bold transition-colors"
                  >
                    Últimos 15 días
                  </button>
                  <button
                    onClick={() => setQuickDate(30)}
                    className="px-3 py-1.5 bg-slate-800/50 hover:bg-slate-700/50 text-slate-300 hover:text-white rounded-lg text-xs font-bold transition-colors"
                  >
                    Últimos 30 días
                  </button>
                  <button
                    onClick={() => setQuickDate(60)}
                    className="px-3 py-1.5 bg-slate-800/50 hover:bg-slate-700/50 text-slate-300 hover:text-white rounded-lg text-xs font-bold transition-colors"
                  >
                    Últimos 60 días
                  </button>
                  <button
                    onClick={() => setQuickDate(90)}
                    className="px-3 py-1.5 bg-slate-800/50 hover:bg-slate-700/50 text-slate-300 hover:text-white rounded-lg text-xs font-bold transition-colors"
                  >
                    Últimos 90 días
                  </button>
                </div>
              </div>

              {/* Custom Date Range */}
              <div className="flex gap-3 items-end">
                <div>
                  <p className="text-xs text-slate-500 font-bold uppercase mb-2">Desde</p>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => { setDateFrom(e.target.value); setOffset(0); }}
                    className="bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-yellow-500/50"
                  />
                </div>
                <div>
                  <p className="text-xs text-slate-500 font-bold uppercase mb-2">Hasta</p>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => { setDateTo(e.target.value); setOffset(0); }}
                    className="bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-yellow-500/50"
                  />
                </div>
                {hasDateFilter && (
                  <button
                    onClick={clearDateFilter}
                    className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-sm font-bold transition-colors"
                  >
                    Limpiar
                  </button>
                )}
              </div>
            </div>

            {/* Active Filter Display */}
            {hasDateFilter && (
              <div className="mt-3 pt-3 border-t border-slate-700/30">
                <p className="text-xs text-yellow-400">
                  Mostrando ventas {dateFrom && `desde ${new Date(dateFrom).toLocaleDateString('es-AR')}`} {dateTo && `hasta ${new Date(dateTo).toLocaleDateString('es-AR')}`}
                </p>
              </div>
            )}
          </div>
        )}
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

            return (
              <div 
                key={order.id} 
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
                      <div className="flex flex-col items-center">
                        <span className="text-xs text-slate-500">{dateInfo.date}</span>
                        <span className="text-[10px] text-slate-600">{dateInfo.time}</span>
                      </div>
                      <div className="w-px h-10 bg-slate-700/50" />
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-white font-black text-lg">#{order.id}</span>
                          <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border ${status.bg} ${status.color}`}>
                            {status.label.toUpperCase()}
                          </span>
                          {shipping && (
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

                    {/* Right: Total & Actions */}
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-2xl font-black text-white">${formatCurrency(order.total)}</p>
                        <p className="text-xs text-slate-500">{order.items.length} producto{order.items.length !== 1 ? 's' : ''}</p>
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
                              <th className="text-right text-[10px] text-slate-500 font-bold uppercase p-3">Precio</th>
                              <th className="text-right text-[10px] text-slate-500 font-bold uppercase p-3">Subtotal</th>
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
                                <td className="p-3 text-center text-white font-bold">{item.quantity}</td>
                                <td className="p-3 text-right text-slate-400 text-sm">${formatCurrency(item.unitPrice)}</td>
                                <td className="p-3 text-right text-white font-bold">${formatCurrency(item.unitPrice * item.quantity)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="bg-slate-800/50">
                              <td colSpan={4} className="p-3 text-right text-slate-400 font-bold">TOTAL</td>
                              <td className="p-3 text-right text-yellow-400 font-black text-lg">${formatCurrency(order.total)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>

                    {/* External Link */}
                    <div className="mt-4 flex justify-end">
                      <a
                        href={`https://www.mercadolibre.com.ar/ventas/${order.id}/detalle`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-yellow-400 hover:text-yellow-300 text-sm font-bold flex items-center gap-2 transition-colors"
                      >
                        Ver en Mercado Libre
                        <ExternalLink size={14} />
                      </a>
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
        <div className="flex justify-center items-center gap-2">
          <button
            onClick={() => setOffset(0)}
            disabled={offset === 0}
            className="p-2 bg-slate-800/50 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-700/50 transition-colors"
          >
            <ChevronLeft size={18} className="text-white" />
            <ChevronLeft size={18} className="text-white -ml-3" />
          </button>
          <button
            onClick={() => setOffset(o => Math.max(0, o - limit))}
            disabled={offset === 0}
            className="p-2 bg-slate-800/50 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-700/50 transition-colors"
          >
            <ChevronLeft size={18} className="text-white" />
          </button>
          
          <div className="flex items-center gap-1 px-4">
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
            className="p-2 bg-slate-800/50 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-700/50 transition-colors"
          >
            <ChevronRight size={18} className="text-white" />
          </button>
          <button
            onClick={() => setOffset((totalPages - 1) * limit)}
            disabled={currentPage >= totalPages}
            className="p-2 bg-slate-800/50 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-700/50 transition-colors"
          >
            <ChevronRight size={18} className="text-white" />
            <ChevronRight size={18} className="text-white -ml-3" />
          </button>
        </div>
      )}
    </div>
  );
};

export default MercadoLibreOrders;
