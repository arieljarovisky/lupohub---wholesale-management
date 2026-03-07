import React, { useState, useEffect } from 'react';
import { RefreshCw, Package, Loader2, Zap, Search, X, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, AlertTriangle, Copy, Check } from 'lucide-react';
import { api } from '../services/api';

interface TNStockItem {
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
    variationId: number | string;
    sku: string;
    color: string;
    size: string;
    stock: number;
    sold: number;
  }[];
}

type SortOption = 'title' | 'stock_asc' | 'stock_desc' | 'sold_desc';

const TiendaNubeStock: React.FC = () => {
  const [items, setItems] = useState<TNStockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [allItemsForSearch, setAllItemsForSearch] = useState<TNStockItem[] | null>(null);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('title');
  const limit = 20;
  const [globalTotals, setGlobalTotals] = useState<{
    totalProducts: number;
    totalStock: number;
    lowStockCount: number;
    noStockCount: number;
  } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard?.writeText(String(text)).then(() => {
      setCopiedId(label);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const fetchTotals = async () => {
    try {
      const res = await api.getTiendaNubeStockTotals();
      setGlobalTotals(res);
    } catch (e) {
      console.error('Error fetching TN totals:', e);
    }
  };

  const fetchStock = async () => {
    setLoading(true);
    try {
      const res = await api.getTiendaNubeStock({ offset, limit });
      const sortedItems = (res.items || []).sort((a: TNStockItem, b: TNStockItem) => a.title.localeCompare(b.title));
      setItems(sortedItems);
      setTotal(res.total || 0);
    } catch (error) {
      console.error('Error fetching TN stock:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    fetchTotals();
    if (offset === 0) {
      setLoading(true);
      api.getTiendaNubeStock({ offset: 0, limit }).then((res) => {
        const sortedItems = (res.items || []).sort((a: TNStockItem, b: TNStockItem) => a.title.localeCompare(b.title));
        setItems(sortedItems);
        setTotal(res.total || 0);
      }).catch(console.error).finally(() => setLoading(false));
    } else {
      setOffset(0);
    }
  };

  useEffect(() => {
    fetchTotals();
  }, []);

  useEffect(() => {
    fetchStock();
  }, [offset]);

  useEffect(() => {
    if (!searchTerm.trim()) {
      setAllItemsForSearch(null);
      return;
    }
    let cancelled = false;
    const pageSize = 50;
    const maxSearchItems = 500;
    const fetchAllForSearch = async () => {
      setLoadingSearch(true);
      setAllItemsForSearch(null);
      try {
        const first = await api.getTiendaNubeStock({ offset: 0, limit: pageSize });
        if (cancelled) return;
        const total = first.total || 0;
        const firstItems = (first.items || []).sort((a: TNStockItem, b: TNStockItem) => a.title.localeCompare(b.title));
        setAllItemsForSearch(firstItems);
        setLoadingSearch(false);
        if (total <= pageSize) return;
        const totalToLoad = Math.min(total, maxSearchItems);
        const restOffsets = Array.from(
          { length: Math.ceil((totalToLoad - pageSize) / pageSize) },
          (_, i) => pageSize + i * pageSize
        );
        const restPages = await Promise.all(
          restOffsets.map(off => api.getTiendaNubeStock({ offset: off, limit: pageSize }))
        );
        if (cancelled) return;
        const all = [...firstItems, ...restPages.flatMap(r => r.items || [])].sort((a, b) => a.title.localeCompare(b.title));
        setAllItemsForSearch(all);
      } catch (e) {
        if (!cancelled) {
          setAllItemsForSearch([]);
          setLoadingSearch(false);
        }
      }
    };
    fetchAllForSearch();
    return () => { cancelled = true; };
  }, [searchTerm]);

  const filteredItems = (searchTerm.trim() ? (allItemsForSearch ?? []) : items)
    .filter(item => {
      if (!searchTerm) return true;
      const search = searchTerm.toLowerCase();
      return (
        item.id.toLowerCase().includes(search) ||
        item.title.toLowerCase().includes(search) ||
        (item.variations || []).some((v: { sku?: string }) => v.sku?.toLowerCase().includes(search))
      );
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'title':
          return a.title.localeCompare(b.title);
        case 'stock_asc':
          return a.totalStock - b.totalStock;
        case 'stock_desc':
          return b.totalStock - a.totalStock;
        case 'sold_desc':
          return b.soldTotal - a.soldTotal;
        default:
          return 0;
      }
    });

  const currentPage = searchTerm ? 1 : Math.floor(offset / limit) + 1;
  const totalPages = searchTerm ? 1 : Math.max(1, Math.ceil(total / limit));

  const stats = {
    totalItems: globalTotals?.totalProducts ?? total,
    totalStock: globalTotals?.totalStock ?? items.reduce((sum, i) => sum + i.totalStock, 0),
    lowStock: globalTotals?.lowStockCount ?? items.filter(i => i.totalStock > 0 && i.totalStock < 5).length,
    noStock: globalTotals?.noStockCount ?? items.filter(i => i.totalStock === 0).length
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-br from-cyan-500 to-teal-600 rounded-2xl flex items-center justify-center shadow-lg shadow-cyan-900/30">
            <Package className="text-white" size={28} />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white">Stock Tienda Nube</h2>
            <p className="text-slate-400 text-sm">Inventario de tus productos en Tienda Nube</p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-cyan-900/30 transition-all"
        >
          {loading ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
          Actualizar
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-500/10 rounded-xl">
              <Zap size={20} className="text-cyan-400" />
            </div>
            <div>
              <p className="text-2xl font-black text-white">{stats.totalItems}</p>
              <p className="text-xs text-slate-500">Productos</p>
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

      {/* Search & Sort */}
      <div className="bg-slate-800/30 rounded-xl p-4 border border-slate-700/30">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Buscar por ID, título o SKU..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-900/50 border border-slate-700/50 rounded-xl pl-10 pr-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                <X size={16} />
              </button>
            )}
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="bg-slate-900/50 border border-slate-700/50 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-cyan-500/50 transition-colors cursor-pointer"
          >
            <option value="title">Ordenar: A-Z</option>
            <option value="stock_asc">Ordenar: Menor stock</option>
            <option value="stock_desc">Ordenar: Mayor stock</option>
            <option value="sold_desc">Ordenar: Más vendidos</option>
          </select>
        </div>
      </div>

      {/* Rango y paginación */}
      {!loading && !searchTerm.trim() && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-400">
          <span>
            Mostrando {offset + 1}–{Math.min(offset + items.length, total)} de {total} productos
          </span>
          {totalPages > 1 && (
            <span className="text-cyan-400 font-medium">
              Página {currentPage} de {totalPages}
            </span>
          )}
        </div>
      )}

      {/* Items List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="animate-spin text-cyan-500 mb-4" size={48} />
          <p className="text-slate-400">Cargando stock de Tienda Nube...</p>
        </div>
      ) : searchTerm.trim() && loadingSearch ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="animate-spin text-cyan-500 mb-4" size={48} />
          <p className="text-slate-400">Buscando en todos los productos...</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="bg-slate-800/30 rounded-2xl p-16 text-center border border-slate-700/30">
          <Package className="mx-auto text-slate-600 mb-4" size={56} />
          <p className="text-slate-400 text-lg font-medium">
            {searchTerm.trim() ? `Ningún producto coincide con "${searchTerm}"` : 'No hay productos'}
          </p>
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
                  isExpanded ? 'border-cyan-500/50 shadow-lg shadow-cyan-900/10' : 'border-slate-700/30 hover:border-slate-600/50'
                }`}
              >
                <div
                  className="p-4 cursor-pointer touch-manipulation"
                  onClick={() => setExpandedItem(isExpanded ? null : item.id)}
                >
                  <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                    <img
                      src={item.thumbnail}
                      alt={item.title}
                      className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl object-cover bg-slate-700 shrink-0"
                    />
                    <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-4 gap-y-1">
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-bold truncate">{item.title}</p>
                        <p className="text-slate-500 text-xs mt-1 flex items-center gap-2 flex-wrap">
                          <span>ID producto: <code className="bg-slate-800 px-1.5 py-0.5 rounded text-cyan-300/90">{item.id}</code></span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(String(item.id), `tn-item-${item.id}`)}
                            className="inline-flex items-center gap-1 text-slate-500 hover:text-cyan-400 transition-colors"
                            title="Copiar ID producto"
                          >
                            {copiedId === `tn-item-${item.id}` ? <Check size={12} /> : <Copy size={12} />}
                          </button>
                          <span className="text-slate-600">· ${item.price?.toLocaleString('es-AR')}</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-4 sm:gap-6">
                        <div className="text-right">
                          <p className={`text-xl sm:text-2xl font-black ${stockColor}`}>{item.totalStock}</p>
                          <p className="text-slate-500 text-xs">disponibles</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-slate-400">{item.soldTotal ?? 0}</p>
                          <p className="text-slate-600 text-xs">vendidos</p>
                        </div>
                      </div>
                    </div>
                    <ChevronDown
                      size={20}
                      className={`text-slate-500 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                    />
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-slate-700/30 pt-4">
                    {item.variations && item.variations.length > 0 ? (
                      <>
                        <p className="text-cyan-400 text-xs font-bold mb-3">VARIACIONES ({item.variations.length})</p>
                        <div className="bg-slate-900/30 rounded-xl overflow-x-auto">
                          <table className="w-full min-w-[400px]">
                            <thead>
                              <tr className="border-b border-slate-700/30">
                                <th className="text-left text-[10px] text-slate-500 font-bold uppercase p-3">ID variante</th>
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
                                  <td className="p-3 text-cyan-300/90 text-xs font-mono flex items-center gap-1">
                                    {v.variationId}
                                    <button
                                      type="button"
                                      onClick={() => copyToClipboard(String(v.variationId), `tn-var-${v.variationId}`)}
                                      className="text-slate-500 hover:text-cyan-400 transition-colors"
                                      title="Copiar ID variante"
                                    >
                                      {copiedId === `tn-var-${v.variationId}` ? <Check size={12} /> : <Copy size={12} />}
                                    </button>
                                  </td>
                                  <td className="p-3 text-slate-400 text-xs font-mono">{v.sku || '-'}</td>
                                  <td className="p-3 text-white text-sm">{v.color || '-'}</td>
                                  <td className="p-3 text-white text-sm">{v.size || '-'}</td>
                                  <td className={`p-3 text-right font-bold ${
                                    v.stock === 0 ? 'text-red-400' : v.stock < 5 ? 'text-orange-400' : 'text-green-400'
                                  }`}>
                                    {v.stock}
                                  </td>
                                  <td className="p-3 text-right text-slate-400">{v.sold ?? 0}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    ) : (
                      <p className="text-slate-500 text-sm mb-3">Sin variaciones (producto único)</p>
                    )}
                    {item.permalink && item.permalink !== 'https://tiendanube.com' && (
                      <div className="mt-4 flex justify-end">
                        <a
                          href={item.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-cyan-400 hover:text-cyan-300 text-sm font-bold flex items-center gap-2 transition-colors"
                        >
                          Ver en Tienda Nube
                          <ExternalLink size={14} />
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination: siempre visible cuando hay productos (aunque sea 1 página) */}
      {total > 0 && (
        <div className="flex flex-col items-center gap-3 pt-4 pb-2">
          <p className="text-slate-500 text-sm">
            Página <span className="text-cyan-400 font-semibold">{currentPage}</span> de <span className="font-semibold text-white">{totalPages}</span>
          </p>
          <nav className="flex items-center gap-1 rounded-2xl bg-slate-800 border border-slate-600/60 shadow-xl shadow-black/30 px-2 py-2" aria-label="Paginación">
            <button
              onClick={() => setOffset(0)}
              disabled={offset === 0}
              className="p-3 rounded-xl text-slate-400 hover:bg-cyan-500/20 hover:text-cyan-300 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-400 transition-all duration-200"
              title="Primera página"
              aria-label="Primera página"
            >
              <ChevronLeft size={20} className="inline-block" strokeWidth={2.5} />
              <ChevronLeft size={20} className="inline-block -ml-3" strokeWidth={2.5} />
            </button>
            <button
              onClick={() => setOffset(o => Math.max(0, o - limit))}
              disabled={offset === 0}
              className="p-3 rounded-xl text-slate-400 hover:bg-cyan-500/20 hover:text-cyan-300 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-400 transition-all duration-200"
              title="Anterior"
              aria-label="Anterior"
            >
              <ChevronLeft size={20} strokeWidth={2.5} />
            </button>
            <span className="min-w-[5rem] text-center px-5 py-2.5 text-sm font-bold text-white bg-slate-700/80 rounded-xl border border-cyan-500/30 mx-1">
              <span className="text-cyan-300">{currentPage}</span>
              <span className="text-slate-500 mx-1.5">/</span>
              <span className="text-slate-300">{totalPages}</span>
            </span>
            <button
              onClick={() => setOffset(o => o + limit)}
              disabled={currentPage >= totalPages}
              className="p-3 rounded-xl text-slate-400 hover:bg-cyan-500/20 hover:text-cyan-300 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-400 transition-all duration-200"
              title="Siguiente"
              aria-label="Siguiente"
            >
              <ChevronRight size={20} strokeWidth={2.5} />
            </button>
            <button
              onClick={() => setOffset((totalPages - 1) * limit)}
              disabled={currentPage >= totalPages}
              className="p-3 rounded-xl text-slate-400 hover:bg-cyan-500/20 hover:text-cyan-300 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-400 transition-all duration-200"
              title="Última página"
              aria-label="Última página"
            >
              <ChevronRight size={20} className="inline-block" strokeWidth={2.5} />
              <ChevronRight size={20} className="inline-block -ml-3" strokeWidth={2.5} />
            </button>
          </nav>
        </div>
      )}
    </div>
  );
};

export default TiendaNubeStock;
