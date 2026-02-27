import React, { useState, useEffect } from 'react';
import { RefreshCw, Package, Loader2, Zap, Search, X, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';

interface MLStockItem {
  id: string;
  title: string;
  status: string;
  price: number;
  totalStock: number;
  soldTotal: number;
  thumbnail: string;
  permalink: string;
  hasVariations: boolean;
  variations: {
    variationId: number;
    sku: string;
    color: string;
    size: string;
    stock: number;
    sold: number;
  }[];
}

const MercadoLibreStock: React.FC = () => {
  const [items, setItems] = useState<MLStockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const limit = 20;

  const fetchStock = async () => {
    setLoading(true);
    try {
      const res = await api.getMercadoLibreStock({ offset, limit, status: 'active' });
      setItems(res.items || []);
      setTotal(res.total || 0);
    } catch (error) {
      console.error('Error fetching ML stock:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStock();
  }, [offset]);

  const filteredItems = items.filter(item => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      item.id.toLowerCase().includes(search) ||
      item.title.toLowerCase().includes(search) ||
      item.variations.some(v => v.sku?.toLowerCase().includes(search))
    );
  });

  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);

  const stats = {
    totalItems: total,
    totalStock: items.reduce((sum, i) => sum + i.totalStock, 0),
    lowStock: items.filter(i => i.totalStock > 0 && i.totalStock < 5).length,
    noStock: items.filter(i => i.totalStock === 0).length
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-br from-yellow-500 to-yellow-700 rounded-2xl flex items-center justify-center shadow-lg shadow-yellow-900/30">
            <Package className="text-white" size={28} />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white">Stock Mercado Libre</h2>
            <p className="text-slate-400 text-sm">Inventario de tus publicaciones activas</p>
          </div>
        </div>
        <button
          onClick={fetchStock}
          disabled={loading}
          className="bg-gradient-to-r from-yellow-600 to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-yellow-900/30 transition-all"
        >
          {loading ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
          Actualizar
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-500/10 rounded-xl">
              <Zap size={20} className="text-yellow-400" />
            </div>
            <div>
              <p className="text-2xl font-black text-white">{stats.totalItems}</p>
              <p className="text-xs text-slate-500">Publicaciones</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-xl">
              <Package size={20} className="text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-black text-blue-400">{stats.totalStock}</p>
              <p className="text-xs text-slate-500">Stock total</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-500/10 rounded-xl">
              <AlertTriangle size={20} className="text-orange-400" />
            </div>
            <div>
              <p className="text-2xl font-black text-orange-400">{stats.lowStock}</p>
              <p className="text-xs text-slate-500">Stock bajo</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-500/10 rounded-xl">
              <AlertTriangle size={20} className="text-red-400" />
            </div>
            <div>
              <p className="text-2xl font-black text-red-400">{stats.noStock}</p>
              <p className="text-xs text-slate-500">Sin stock</p>
            </div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="bg-slate-800/30 rounded-xl p-4 border border-slate-700/30">
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Buscar por ID, título o SKU..."
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
      </div>

      {/* Items List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="animate-spin text-yellow-500 mb-4" size={48} />
          <p className="text-slate-400">Cargando stock de Mercado Libre...</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="bg-slate-800/30 rounded-2xl p-16 text-center border border-slate-700/30">
          <Package className="mx-auto text-slate-600 mb-4" size={56} />
          <p className="text-slate-400 text-lg font-medium">No hay publicaciones</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => {
            const isExpanded = expandedItem === item.id;
            const stockColor = item.totalStock === 0 ? 'text-red-400' : item.totalStock < 5 ? 'text-orange-400' : 'text-green-400';

            return (
              <div 
                key={item.id} 
                className={`bg-slate-800/40 rounded-2xl border transition-all duration-200 ${
                  isExpanded ? 'border-yellow-500/50 shadow-lg shadow-yellow-900/10' : 'border-slate-700/30 hover:border-slate-600/50'
                }`}
              >
                {/* Item Header */}
                <div 
                  className="p-4 cursor-pointer"
                  onClick={() => setExpandedItem(isExpanded ? null : item.id)}
                >
                  <div className="flex items-center gap-4">
                    {/* Thumbnail */}
                    <img 
                      src={item.thumbnail} 
                      alt={item.title}
                      className="w-16 h-16 rounded-xl object-cover bg-slate-700"
                    />
                    
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-bold truncate">{item.title}</p>
                      <p className="text-slate-500 text-xs mt-1">
                        ID: {item.id} · ${item.price?.toLocaleString('es-AR')}
                      </p>
                    </div>

                    {/* Stock */}
                    <div className="text-right">
                      <p className={`text-2xl font-black ${stockColor}`}>{item.totalStock}</p>
                      <p className="text-slate-500 text-xs">disponibles</p>
                    </div>

                    {/* Sold */}
                    <div className="text-right">
                      <p className="text-lg font-bold text-slate-400">{item.soldTotal}</p>
                      <p className="text-slate-600 text-xs">vendidos</p>
                    </div>

                    {item.hasVariations && (
                      <ChevronDown 
                        size={20} 
                        className={`text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} 
                      />
                    )}
                  </div>
                </div>

                {/* Variations */}
                {isExpanded && item.hasVariations && (
                  <div className="px-4 pb-4 border-t border-slate-700/30 pt-4">
                    <p className="text-yellow-400 text-xs font-bold mb-3">VARIACIONES ({item.variations.length})</p>
                    <div className="bg-slate-900/30 rounded-xl overflow-hidden">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-slate-700/30">
                            <th className="text-left text-[10px] text-slate-500 font-bold uppercase p-3">SKU</th>
                            <th className="text-left text-[10px] text-slate-500 font-bold uppercase p-3">Color</th>
                            <th className="text-left text-[10px] text-slate-500 font-bold uppercase p-3">Talle</th>
                            <th className="text-right text-[10px] text-slate-500 font-bold uppercase p-3">Stock</th>
                            <th className="text-right text-[10px] text-slate-500 font-bold uppercase p-3">Vendidos</th>
                          </tr>
                        </thead>
                        <tbody>
                          {item.variations.map((v, i) => (
                            <tr key={i} className="border-b border-slate-700/20 last:border-0">
                              <td className="p-3 text-slate-400 text-xs font-mono">{v.sku || '-'}</td>
                              <td className="p-3 text-white text-sm">{v.color || '-'}</td>
                              <td className="p-3 text-white text-sm">{v.size || '-'}</td>
                              <td className={`p-3 text-right font-bold ${
                                v.stock === 0 ? 'text-red-400' : v.stock < 5 ? 'text-orange-400' : 'text-green-400'
                              }`}>
                                {v.stock}
                              </td>
                              <td className="p-3 text-right text-slate-400">{v.sold}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Link to ML */}
                    <div className="mt-4 flex justify-end">
                      <a
                        href={item.permalink}
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
          
          <span className="px-4 text-white font-bold">
            {currentPage} / {totalPages}
          </span>

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

export default MercadoLibreStock;
