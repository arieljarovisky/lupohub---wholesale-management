import React, { useState, useEffect } from 'react';
import { History, RefreshCw, Loader2, Search, X, Filter, TrendingUp, TrendingDown, Package, Calendar, ArrowUpCircle, ArrowDownCircle, RotateCcw, ShoppingCart, Store, Zap, Download, Camera, CheckCircle } from 'lucide-react';
import { api } from '../services/api';
import { useNotification } from '../context/NotificationContext';

interface StockMovement {
  id: string;
  variant_id: string;
  previous_stock: number;
  new_stock: number;
  quantity_change: number;
  movement_type: string;
  reference: string | null;
  created_at: string;
  sku: string;
  product_name: string;
}

const movementTypeConfig: Record<string, { label: string; color: string; bgColor: string; icon: React.ReactNode }> = {
  'PEDIDO_MAYORISTA': { 
    label: 'Pedido Mayorista', 
    color: 'text-blue-400', 
    bgColor: 'bg-blue-500/10',
    icon: <ShoppingCart size={16} />
  },
  'VENTA_TIENDA_NUBE': { 
    label: 'Venta Tienda Nube', 
    color: 'text-cyan-400', 
    bgColor: 'bg-cyan-500/10',
    icon: <Store size={16} />
  },
  'VENTA_MERCADO_LIBRE': { 
    label: 'Venta Mercado Libre', 
    color: 'text-yellow-400', 
    bgColor: 'bg-yellow-500/10',
    icon: <Zap size={16} />
  },
  'AJUSTE_MANUAL': { 
    label: 'Ajuste Manual', 
    color: 'text-purple-400', 
    bgColor: 'bg-purple-500/10',
    icon: <Package size={16} />
  },
  'DEVOLUCION': { 
    label: 'Devolución', 
    color: 'text-green-400', 
    bgColor: 'bg-green-500/10',
    icon: <RotateCcw size={16} />
  },
  'IMPORTACION_TN': { 
    label: 'Importación TN', 
    color: 'text-slate-400', 
    bgColor: 'bg-slate-500/10',
    icon: <ArrowDownCircle size={16} />
  },
  'SNAPSHOT_INICIAL': { 
    label: 'Stock Inicial', 
    color: 'text-emerald-400', 
    bgColor: 'bg-emerald-500/10',
    icon: <Camera size={16} />
  }
};

const StockHistory: React.FC = () => {
  const { showToast, showConfirm } = useNotification();
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ message: string; logs: string[] } | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [filterType, setFilterType] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [limit, setLimit] = useState(50);

  const fetchMovements = React.useCallback(async (abort?: { current: boolean }) => {
    setLoading(true);
    try {
      const params: any = { limit: Math.min(200, Math.max(10, limit)) };
      if (filterType) params.type = filterType;
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo + 'T23:59:59';

      const data = await api.getStockMovements(params);
      if (abort?.current) return;
      setMovements(Array.isArray(data) ? data : []);
    } catch (error) {
      if (abort?.current) return;
      console.error('Error fetching stock movements:', error);
      setMovements([]);
    } finally {
      if (!abort?.current) setLoading(false);
    }
  }, [filterType, dateFrom, dateTo, limit]);

  useEffect(() => {
    const abort = { current: false };
    fetchMovements(abort);
    return () => { abort.current = true; };
  }, [filterType, dateFrom, dateTo, limit, fetchMovements]);

  const handleCreateSnapshot = () => {
    showConfirm({
      title: 'Crear snapshot de stock',
      message: '¿Crear un snapshot del stock actual? Esto registrará el stock de todas las variantes como punto de partida.',
      confirmLabel: 'Crear snapshot',
      onConfirm: () => {
        setSnapshotLoading(true);
        api.createStockSnapshot()
          .then((result) => {
            showToast('success', `${result.message}\nVariantes procesadas: ${result.variantsProcessed || 0}`);
            fetchMovements();
          })
          .catch((error: any) => showToast('error', error?.message || 'No se pudo crear el snapshot'))
          .finally(() => setSnapshotLoading(false));
      },
    });
  };

  const handleImportHistory = async (days: number) => {
    setImportLoading(true);
    setImportResult(null);
    try {
      const result = await api.importSalesHistory(days);
      setImportResult({ message: result.message, logs: result.logs });
      fetchMovements();
    } catch (error: any) {
      setImportResult({ message: 'Error: ' + (error.message || 'No se pudo importar'), logs: [] });
    } finally {
      setImportLoading(false);
    }
  };

  const filteredMovements = movements.filter(m => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      m.sku?.toLowerCase().includes(search) ||
      m.product_name?.toLowerCase().includes(search) ||
      m.reference?.toLowerCase().includes(search)
    );
  });

  // Estadísticas
  const stats = {
    total: filteredMovements.length,
    entradas: filteredMovements.filter(m => m.quantity_change > 0).reduce((sum, m) => sum + m.quantity_change, 0),
    salidas: filteredMovements.filter(m => m.quantity_change < 0).reduce((sum, m) => sum + Math.abs(m.quantity_change), 0),
    ventasTN: filteredMovements.filter(m => m.movement_type === 'VENTA_TIENDA_NUBE').length,
    ventasML: filteredMovements.filter(m => m.movement_type === 'VENTA_MERCADO_LIBRE').length,
    mayoristas: filteredMovements.filter(m => m.movement_type === 'PEDIDO_MAYORISTA').length
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('es-AR', { 
      day: '2-digit', 
      month: '2-digit', 
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const setQuickDate = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    setDateFrom(from.toISOString().split('T')[0]);
    setDateTo(to.toISOString().split('T')[0]);
  };

  const clearFilters = () => {
    setSearchTerm('');
    setFilterType('');
    setDateFrom('');
    setDateTo('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-br from-purple-500 to-purple-700 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-900/30">
            <History className="text-white" size={28} />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white">Historial de Stock</h2>
            <p className="text-slate-400 text-sm">Movimientos y cambios de inventario</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowImportModal(true)}
            className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all text-sm"
          >
            <Download size={16} />
            Importar Historial
          </button>
          <button
            onClick={handleCreateSnapshot}
            disabled={snapshotLoading}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 disabled:opacity-50 transition-all text-sm"
          >
            {snapshotLoading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
            Snapshot Inicial
          </button>
          <button
            onClick={fetchMovements}
            disabled={loading}
            className="bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-purple-900/30 transition-all text-sm"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Actualizar
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
          <div className="flex items-center gap-2">
            <Package size={18} className="text-slate-400" />
            <div>
              <p className="text-xl font-black text-white">{stats.total}</p>
              <p className="text-[10px] text-slate-500 uppercase">Movimientos</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
          <div className="flex items-center gap-2">
            <TrendingUp size={18} className="text-green-400" />
            <div>
              <p className="text-xl font-black text-green-400">+{stats.entradas}</p>
              <p className="text-[10px] text-slate-500 uppercase">Entradas</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
          <div className="flex items-center gap-2">
            <TrendingDown size={18} className="text-red-400" />
            <div>
              <p className="text-xl font-black text-red-400">-{stats.salidas}</p>
              <p className="text-[10px] text-slate-500 uppercase">Salidas</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
          <div className="flex items-center gap-2">
            <Store size={18} className="text-cyan-400" />
            <div>
              <p className="text-xl font-black text-cyan-400">{stats.ventasTN}</p>
              <p className="text-[10px] text-slate-500 uppercase">Tienda Nube</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
          <div className="flex items-center gap-2">
            <Zap size={18} className="text-yellow-400" />
            <div>
              <p className="text-xl font-black text-yellow-400">{stats.ventasML}</p>
              <p className="text-[10px] text-slate-500 uppercase">Mercado Libre</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
          <div className="flex items-center gap-2">
            <ShoppingCart size={18} className="text-blue-400" />
            <div>
              <p className="text-xl font-black text-blue-400">{stats.mayoristas}</p>
              <p className="text-[10px] text-slate-500 uppercase">Mayoristas</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-slate-800/30 rounded-xl p-4 border border-slate-700/30 space-y-4">
        {/* Quick date filters */}
        <div className="flex flex-wrap gap-2">
          <span className="text-slate-500 text-xs font-bold uppercase self-center mr-2">Período:</span>
          {[
            { label: 'Hoy', days: 0 },
            { label: '7 días', days: 7 },
            { label: '15 días', days: 15 },
            { label: '30 días', days: 30 },
            { label: '60 días', days: 60 },
          ].map(({ label, days }) => (
            <button
              key={days}
              onClick={() => setQuickDate(days)}
              className="px-3 py-1.5 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg text-xs font-bold text-slate-300 transition-colors"
            >
              {label}
            </button>
          ))}
          {(dateFrom || dateTo || filterType || searchTerm) && (
            <button
              onClick={clearFilters}
              className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-xs font-bold text-red-400 transition-colors flex items-center gap-1"
            >
              <X size={12} />
              Limpiar
            </button>
          )}
        </div>

        {/* Search and filters */}
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Buscar por SKU, producto o referencia..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-900/50 border border-slate-700/50 rounded-xl pl-10 pr-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500/50 transition-colors"
            />
          </div>
          
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="bg-slate-900/50 border border-slate-700/50 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500/50 transition-colors cursor-pointer"
          >
            <option value="">Todos los tipos</option>
            <option value="VENTA_TIENDA_NUBE">Ventas Tienda Nube</option>
            <option value="VENTA_MERCADO_LIBRE">Ventas Mercado Libre</option>
            <option value="PEDIDO_MAYORISTA">Pedidos Mayoristas</option>
            <option value="AJUSTE_MANUAL">Ajustes Manuales</option>
            <option value="DEVOLUCION">Devoluciones</option>
            <option value="IMPORTACION_TN">Importaciones</option>
          </select>

          <div className="flex gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="bg-slate-900/50 border border-slate-700/50 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500/50 transition-colors"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="bg-slate-900/50 border border-slate-700/50 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500/50 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Movements List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="animate-spin text-purple-500 mb-4" size={48} />
          <p className="text-slate-400">Cargando historial...</p>
        </div>
      ) : filteredMovements.length === 0 ? (
        <div className="bg-slate-800/30 rounded-2xl p-16 text-center border border-slate-700/30">
          <History className="mx-auto text-slate-600 mb-4" size={56} />
          <p className="text-slate-400 text-lg font-medium">No hay movimientos</p>
          <p className="text-slate-500 text-sm mt-2">Los movimientos de stock aparecerán aquí</p>
        </div>
      ) : (
        <div className="bg-slate-800/30 rounded-2xl border border-slate-700/30 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700/50">
                  <th className="text-left text-[10px] text-slate-500 font-bold uppercase p-4">Fecha</th>
                  <th className="text-left text-[10px] text-slate-500 font-bold uppercase p-4">Producto</th>
                  <th className="text-left text-[10px] text-slate-500 font-bold uppercase p-4">SKU</th>
                  <th className="text-left text-[10px] text-slate-500 font-bold uppercase p-4">Tipo</th>
                  <th className="text-center text-[10px] text-slate-500 font-bold uppercase p-4">Anterior</th>
                  <th className="text-center text-[10px] text-slate-500 font-bold uppercase p-4">Cambio</th>
                  <th className="text-center text-[10px] text-slate-500 font-bold uppercase p-4">Nuevo</th>
                  <th className="text-left text-[10px] text-slate-500 font-bold uppercase p-4">Referencia</th>
                </tr>
              </thead>
              <tbody>
                {filteredMovements.map((movement) => {
                  const config = movementTypeConfig[movement.movement_type] || {
                    label: movement.movement_type,
                    color: 'text-slate-400',
                    bgColor: 'bg-slate-500/10',
                    icon: <Package size={16} />
                  };
                  const isPositive = movement.quantity_change > 0;

                  return (
                    <tr key={movement.id} className="border-b border-slate-700/20 hover:bg-slate-700/10 transition-colors">
                      <td className="p-4">
                        <div className="flex items-center gap-2 text-slate-400 text-xs">
                          <Calendar size={14} />
                          {formatDate(movement.created_at)}
                        </div>
                      </td>
                      <td className="p-4">
                        <p className="text-white font-medium text-sm truncate max-w-[200px]" title={movement.product_name}>
                          {movement.product_name}
                        </p>
                      </td>
                      <td className="p-4">
                        <span className="text-slate-400 font-mono text-xs">{movement.sku || '-'}</span>
                      </td>
                      <td className="p-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${config.color} ${config.bgColor}`}>
                          {config.icon}
                          {config.label}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        <span className="text-slate-500 font-mono">{movement.previous_stock}</span>
                      </td>
                      <td className="p-4 text-center">
                        <span className={`font-bold font-mono ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                          {isPositive ? '+' : ''}{movement.quantity_change}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        <span className="text-white font-bold font-mono">{movement.new_stock}</span>
                      </td>
                      <td className="p-4">
                        <span className="text-slate-500 text-xs truncate max-w-[150px] block" title={movement.reference || ''}>
                          {movement.reference || '-'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          
          {/* Load more */}
          {filteredMovements.length >= limit && (
            <div className="p-4 border-t border-slate-700/30 text-center">
              <button
                onClick={() => setLimit(l => l + 100)}
                className="px-4 py-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg text-sm font-bold text-slate-300 transition-colors"
              >
                Cargar más movimientos
              </button>
            </div>
          )}
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <Download className="text-purple-400" size={24} />
                <h3 className="font-bold text-white text-lg">Importar Historial de Ventas</h3>
              </div>
              <button 
                onClick={() => { setShowImportModal(false); setImportResult(null); }} 
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <p className="text-slate-400 text-sm">
                Importa el historial de ventas de Tienda Nube y Mercado Libre para reconstruir los movimientos de stock pasados.
              </p>
              
              <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
                <p className="text-xs text-slate-500 uppercase font-bold mb-3">Seleccionar período</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Últimos 30 días', days: 30 },
                    { label: 'Últimos 60 días', days: 60 },
                    { label: 'Últimos 90 días', days: 90 },
                    { label: 'Últimos 180 días', days: 180 },
                  ].map(({ label, days }) => (
                    <button
                      key={days}
                      onClick={() => handleImportHistory(days)}
                      disabled={importLoading}
                      className="px-4 py-3 bg-slate-700/50 hover:bg-purple-600/50 rounded-xl text-sm font-bold text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {importLoading ? <Loader2 size={16} className="animate-spin" /> : null}
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {importResult && (
                <div className={`rounded-xl p-4 border ${importResult.logs.some(l => l.includes('Error')) ? 'bg-red-500/10 border-red-500/30' : 'bg-green-500/10 border-green-500/30'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle size={18} className={importResult.logs.some(l => l.includes('Error')) ? 'text-red-400' : 'text-green-400'} />
                    <p className="text-white font-bold text-sm">{importResult.message}</p>
                  </div>
                  {importResult.logs.length > 0 && (
                    <div className="space-y-1 mt-3">
                      {importResult.logs.map((log, i) => (
                        <p key={i} className={`text-xs ${log.includes('✓') ? 'text-green-400' : log.includes('✗') ? 'text-red-400' : 'text-slate-400'}`}>
                          {log}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="bg-yellow-500/10 rounded-xl p-4 border border-yellow-500/30">
                <p className="text-yellow-400 text-xs font-bold mb-1">Nota importante</p>
                <p className="text-slate-400 text-xs">
                  Solo se importarán ventas de productos que estén vinculados en el sistema. Los valores de "stock anterior" y "stock nuevo" se mostrarán como 0 en registros históricos.
                </p>
              </div>
            </div>

            <div className="p-6 pt-0 flex justify-end">
              <button
                onClick={() => { setShowImportModal(false); setImportResult(null); }}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-xl text-white text-sm font-bold transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StockHistory;
