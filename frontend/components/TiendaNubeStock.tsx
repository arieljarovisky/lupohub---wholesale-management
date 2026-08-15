import React, { useState, useEffect } from 'react';
import {
  RefreshCw,
  Package,
  Loader2,
  Zap,
  Search,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  AlertTriangle,
  Copy,
  Check,
  Download,
  SquareStack,
  Plus,
  Images,
  ImagePlus,
} from 'lucide-react';
import { api } from '../services/api';
import { normalizeTiendaNubeProductId, extractTiendaNubeVariantFromUrl } from '../utils/tiendaNubeUrl';
import { TiendaNubeBulkImagesModal, TiendaNubeProductImagesModal } from './TiendaNubeProductImagesModal';

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

interface TiendaNubeStockProps {
  searchTerm?: string;
  onSearchChange?: (value: string) => void;
  onProductImported?: (baseSku?: string) => void;
  showToast?: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
}

const TiendaNubeStock: React.FC<TiendaNubeStockProps> = ({ searchTerm: searchTermProp, onSearchChange, onProductImported, showToast }) => {
  const [items, setItems] = useState<TNStockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [internalSearchTerm, setInternalSearchTerm] = useState('');
  const searchTerm = searchTermProp !== undefined ? searchTermProp : internalSearchTerm;
  const setSearchTerm = onSearchChange ?? setInternalSearchTerm;
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
  const [importingItemId, setImportingItemId] = useState<string | null>(null);
  const [dupModal, setDupModal] = useState<{ id: string; title: string } | null>(null);
  const [dupTitleSuffix, setDupTitleSuffix] = useState(' (pack)');
  const [dupSkuSuffix, setDupSkuSuffix] = useState('-PACK');
  const [dupSubmitting, setDupSubmitting] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createPrice, setCreatePrice] = useState('');
  const [createStock, setCreateStock] = useState('0');
  const [createSku, setCreateSku] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [imagesModalItem, setImagesModalItem] = useState<{ id: string; title: string } | null>(null);
  const [bulkImagesOpen, setBulkImagesOpen] = useState(false);
  const [categoryImagesModalOpen, setCategoryImagesModalOpen] = useState(false);
  const [categoryImagesName, setCategoryImagesName] = useState('ropa deportiva');
  const [categoryImagesLoading, setCategoryImagesLoading] = useState(false);
  const [categoryPreview, setCategoryPreview] = useState<{
    categoryNames: string[];
    matches: Array<{ id: number; name?: string }>;
  } | null>(null);
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

  const handlePreviewCategory = async () => {
    const cat = categoryImagesName.trim();
    if (!cat) {
      showToast?.('warning', 'Indicá el nombre de la categoría');
      return;
    }
    try {
      const res = await api.previewTiendaNubeCategoryMatches(cat);
      setCategoryPreview({ categoryNames: res.categoryNames, matches: res.matches });
      if (res.matches.length === 0) {
        showToast?.('warning', `No se encontró ninguna categoría «${cat}»`);
      }
    } catch (e: unknown) {
      showToast?.('error', e instanceof Error ? e.message : 'No se pudo buscar la categoría');
    }
  };

  const handleDownloadCategoryImages = async () => {
    const cat = categoryImagesName.trim();
    if (!cat) {
      showToast?.('warning', 'Indicá el nombre de la categoría');
      return;
    }
    setCategoryImagesLoading(true);
    try {
      await api.downloadTiendaNubeCategoryImages({ category: cat });
      showToast?.('success', `Descarga iniciada: imágenes de «${cat}»`);
      setCategoryImagesModalOpen(false);
    } catch (e: unknown) {
      showToast?.('error', e instanceof Error ? e.message : 'No se pudieron descargar las imágenes');
    } finally {
      setCategoryImagesLoading(false);
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
      const raw = searchTerm.trim();
      const tnProductFromUrl = normalizeTiendaNubeProductId(raw);
      const tnVarFromUrl = extractTiendaNubeVariantFromUrl(raw);
      return (
        item.id.toLowerCase().includes(search) ||
        (tnProductFromUrl && String(item.id) === tnProductFromUrl) ||
        (tnVarFromUrl &&
          (item.variations || []).some((v: { variationId?: number | string }) => String(v.variationId) === tnVarFromUrl)) ||
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

  const allVisibleSelected = filteredItems.length > 0 && filteredItems.every((i) => selectedIds.has(i.id));
  const titleById = new Map<string, string>();
  for (const i of items) titleById.set(i.id, i.title);
  for (const i of allItemsForSearch ?? []) titleById.set(i.id, i.title);
  const selectedTargets = [...selectedIds].map((id) => ({
    id,
    title: titleById.get(id) || `Publicación ${id}`,
  }));

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleSelectVisible = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const item of filteredItems) {
        if (checked) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });
  };

  const applyThumbnails = (thumbs: Record<string, string>) => {
    const patch = (list: TNStockItem[]) =>
      list.map((item) => (thumbs[item.id] ? { ...item, thumbnail: thumbs[item.id] } : item));
    setItems((prev) => patch(prev));
    setAllItemsForSearch((prev) => (prev ? patch(prev) : prev));
  };

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
            <p className="text-slate-400 text-sm">
              Inventario en Tienda Nube: creá una publicación simple o duplicá una existente con otro nombre y SKU (ideal para packs).
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setBulkImagesOpen(true)}
            disabled={loading}
            className="bg-slate-700 hover:bg-slate-600 border border-cyan-700/50 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 disabled:opacity-50 transition-all"
            title="Actualizar fotos de varias publicaciones a la vez"
          >
            <ImagePlus size={18} className="text-cyan-400" />
            Actualizar fotos{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
          </button>
          <button
            type="button"
            onClick={() => {
              setCategoryImagesModalOpen(true);
              setCategoryImagesName('ropa deportiva');
              setCategoryPreview(null);
            }}
            disabled={loading || categoryImagesLoading}
            className="bg-slate-700 hover:bg-slate-600 border border-cyan-700/50 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 disabled:opacity-50 transition-all"
            title="Descargar ZIP con todas las fotos de una categoría"
          >
            <Images size={18} className="text-cyan-400" />
            Imágenes por categoría
          </button>
          <button
            type="button"
            onClick={() => {
              setCreateModalOpen(true);
              setCreateName('');
              setCreatePrice('');
              setCreateStock('0');
              setCreateSku('');
            }}
            disabled={loading || createSubmitting || dupSubmitting}
            className="bg-slate-700 hover:bg-slate-600 border border-slate-500/80 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 disabled:opacity-50 transition-all"
          >
            <Plus size={18} />
            Nuevo en TN
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className="bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-cyan-900/30 transition-all"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
            Actualizar
          </button>
        </div>
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
              placeholder="Buscar por ID, link de la publicación, título o SKU..."
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
          <div className="flex items-center justify-between gap-2 px-1">
            <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={(e) => toggleSelectVisible(e.target.checked)}
                className="rounded border-slate-600 bg-slate-900 text-cyan-500 focus:ring-cyan-500/40"
              />
              Seleccionar visibles
            </label>
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-slate-500 hover:text-white font-bold"
              >
                Limpiar selección ({selectedIds.size})
              </button>
            )}
          </div>
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
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => toggleSelected(item.id, e.target.checked)}
                      className="rounded border-slate-600 bg-slate-900 text-cyan-500 focus:ring-cyan-500/40 shrink-0"
                      title="Seleccionar para actualizar fotos"
                    />
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
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setImagesModalItem({ id: item.id, title: item.title });
                          }}
                          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 border border-cyan-700/50 text-white font-bold transition-colors"
                          title="Ver y cambiar las fotos de esta publicación"
                        >
                          <Images size={18} className="text-cyan-400" />
                          Fotos
                        </button>
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (importingItemId || dupSubmitting) return;
                            setImportingItemId(item.id);
                            try {
                              const res = await api.importProductFromTiendaNube(item.id);
                              showToast?.('success', `"${res.name}" agregado a tu inventario (${res.variantsCreated} variante(s))`);
                              onProductImported?.(res.baseSku);
                            } catch (err: any) {
                              showToast?.('error', err?.message || 'Error al agregar a tu inventario');
                            } finally {
                              setImportingItemId(null);
                            }
                          }}
                          disabled={!!importingItemId || dupSubmitting}
                          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold disabled:opacity-50 transition-colors"
                          title="Crear producto en Mi inventario y vincular con Tienda Nube"
                        >
                          {importingItemId === item.id ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                          Agregar a mi stock
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDupModal({ id: item.id, title: item.title });
                            setDupTitleSuffix(' (pack)');
                            setDupSkuSuffix('-PACK');
                          }}
                          disabled={!!importingItemId || dupSubmitting}
                          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 border border-slate-500/80 text-white font-bold disabled:opacity-50 transition-colors"
                          title="Crear una copia en Tienda Nube con otro título y SKU (ideal para packs)"
                        >
                          <SquareStack size={18} />
                          Duplicar en TN
                        </button>
                      </div>
                    {item.permalink && item.permalink !== 'https://tiendanube.com' && (
                      <a
                          href={item.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-cyan-400 hover:text-cyan-300 text-sm font-bold flex items-center gap-2 transition-colors"
                        >
                          Ver en Tienda Nube
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

      {categoryImagesModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tn-category-images-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !categoryImagesLoading) setCategoryImagesModalOpen(false);
          }}
        >
          <div
            className="bg-slate-800 border border-cyan-800/40 rounded-2xl max-w-md w-full p-6 shadow-2xl shadow-black/40"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="tn-category-images-title" className="text-lg font-black text-white mb-1 flex items-center gap-2">
              <Images size={20} className="text-cyan-400" />
              Imágenes por categoría
            </h3>
            <p className="text-slate-500 text-xs mb-4">
              Descarga un ZIP con todas las fotos de la categoría (incluye subcategorías). Cada artículo va en su
              propia carpeta dentro del ZIP. Puede tardar unos minutos si hay muchos productos.
            </p>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1.5">
              Nombre de categoría en Tienda Nube
            </label>
            <input
              type="text"
              value={categoryImagesName}
              onChange={(e) => {
                setCategoryImagesName(e.target.value);
                setCategoryPreview(null);
              }}
              placeholder="Ej. ropa deportiva"
              className="w-full rounded-xl bg-slate-900 border border-slate-600 px-3 py-2.5 text-white text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              disabled={categoryImagesLoading}
            />
            {categoryPreview && categoryPreview.matches.length > 0 && (
              <div className="mb-3 p-3 rounded-xl bg-slate-900/80 border border-slate-700 text-xs text-slate-300">
                <p className="font-bold text-cyan-400 mb-1">
                  {categoryPreview.matches.length} categoría(s) encontrada(s)
                </p>
                <ul className="list-disc list-inside space-y-0.5">
                  {categoryPreview.categoryNames.slice(0, 8).map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                disabled={categoryImagesLoading}
                onClick={() => !categoryImagesLoading && setCategoryImagesModalOpen(false)}
                className="px-4 py-2.5 rounded-xl text-slate-300 hover:bg-slate-700 font-bold text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={categoryImagesLoading || !categoryImagesName.trim()}
                onClick={handlePreviewCategory}
                className="px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm disabled:opacity-50"
              >
                Verificar
              </button>
              <button
                type="button"
                disabled={categoryImagesLoading || !categoryImagesName.trim()}
                onClick={handleDownloadCategoryImages}
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white font-bold text-sm flex items-center gap-2 disabled:opacity-50"
              >
                {categoryImagesLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Download size={16} />
                )}
                Descargar ZIP
              </button>
            </div>
          </div>
        </div>
      )}

      {createModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tn-create-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !createSubmitting) setCreateModalOpen(false);
          }}
        >
          <div
            className="bg-slate-800 border border-slate-600 rounded-2xl max-w-md w-full p-6 shadow-2xl shadow-black/40"
            onClick={e => e.stopPropagation()}
          >
            <h3 id="tn-create-modal-title" className="text-lg font-black text-white mb-1">Nueva publicación en Tienda Nube</h3>
            <p className="text-slate-500 text-xs mb-4">
              Publicación con una sola variante (sin talles ni colores). Para descripciones, fotos o muchas variantes, duplicá un producto similar o editá en el panel de Tienda Nube.
            </p>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1.5">Nombre</label>
            <input
              type="text"
              value={createName}
              onChange={e => setCreateName(e.target.value)}
              placeholder="Ej. Pack x6 Boxer negro"
              className="w-full rounded-xl bg-slate-900 border border-slate-600 px-3 py-2.5 text-white text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              disabled={createSubmitting}
            />
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1.5">Precio</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={createPrice}
                  onChange={e => setCreatePrice(e.target.value)}
                  placeholder="0"
                  className="w-full rounded-xl bg-slate-900 border border-slate-600 px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  disabled={createSubmitting}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1.5">Stock</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={createStock}
                  onChange={e => setCreateStock(e.target.value)}
                  className="w-full rounded-xl bg-slate-900 border border-slate-600 px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  disabled={createSubmitting}
                />
              </div>
            </div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1.5">SKU (opcional)</label>
            <input
              type="text"
              value={createSku}
              onChange={e => setCreateSku(e.target.value)}
              placeholder="Código único"
              className="w-full rounded-xl bg-slate-900 border border-slate-600 px-3 py-2.5 text-white text-sm mb-5 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              disabled={createSubmitting}
            />
            <div className="flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                disabled={createSubmitting}
                onClick={() => !createSubmitting && setCreateModalOpen(false)}
                className="px-4 py-2.5 rounded-xl text-slate-300 hover:bg-slate-700 font-bold text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={createSubmitting || !createName.trim()}
                onClick={async () => {
                  const name = createName.trim();
                  const priceNum = Number(String(createPrice).replace(',', '.'));
                  const priceStr = Number.isFinite(priceNum) ? String(priceNum) : '0';
                  const stockNum = Math.max(0, Math.floor(Number(createStock)));
                  setCreateSubmitting(true);
                  try {
                    const variant: Record<string, unknown> = {
                      price: priceStr,
                      stock_management: true,
                      stock: stockNum,
                      values: []
                    };
                    const sku = createSku.trim();
                    if (sku) variant.sku = sku;
                    const res = await api.createTiendaNubeProduct({
                      name: { es: name, en: name, pt: name },
                      published: true,
                      variants: [variant]
                    });
                    const nid = res.id ?? (res.product as { id?: number })?.id;
                    showToast?.(
                      'success',
                      nid != null
                        ? `Publicación creada en Tienda Nube (ID ${nid}).`
                        : (res.message || 'Producto creado.')
                    );
                    setCreateModalOpen(false);
                    handleRefresh();
                  } catch (err: any) {
                    showToast?.('error', err?.message || 'No se pudo crear');
                  } finally {
                    setCreateSubmitting(false);
                  }
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-sm disabled:opacity-50"
              >
                {createSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                Crear
              </button>
            </div>
          </div>
        </div>
      )}

      {dupModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tn-dup-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !dupSubmitting) setDupModal(null);
          }}
        >
          <div
            className="bg-slate-800 border border-slate-600 rounded-2xl max-w-md w-full p-6 shadow-2xl shadow-black/40"
            onClick={e => e.stopPropagation()}
          >
            <h3 id="tn-dup-modal-title" className="text-lg font-black text-white mb-1">Duplicar publicación</h3>
            <p className="text-slate-400 text-sm mb-4 line-clamp-2" title={dupModal.title}>{dupModal.title}</p>
            <p className="text-slate-500 text-xs mb-4">
              Se crea un producto nuevo en Tienda Nube con las mismas fotos (hasta 9), categorías, precios y stock. Ajustá los sufijos para que el nombre y los SKU no choquen con la publicación original (ej. pack x6: sufijo SKU <code className="text-cyan-400/90">-PX6</code>).
            </p>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1.5">Sufijo del nombre (todos los idiomas)</label>
            <input
              type="text"
              value={dupTitleSuffix}
              onChange={e => setDupTitleSuffix(e.target.value)}
              className="w-full rounded-xl bg-slate-900 border border-slate-600 px-3 py-2.5 text-white text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              disabled={dupSubmitting}
            />
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1.5">Sufijo del SKU (cada variante)</label>
            <input
              type="text"
              value={dupSkuSuffix}
              onChange={e => setDupSkuSuffix(e.target.value)}
              className="w-full rounded-xl bg-slate-900 border border-slate-600 px-3 py-2.5 text-white text-sm mb-5 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              disabled={dupSubmitting}
            />
            <div className="flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                disabled={dupSubmitting}
                onClick={() => !dupSubmitting && setDupModal(null)}
                className="px-4 py-2.5 rounded-xl text-slate-300 hover:bg-slate-700 font-bold text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={dupSubmitting || !dupSkuSuffix.trim()}
                onClick={async () => {
                  setDupSubmitting(true);
                  try {
                    const res = await api.duplicateTiendaNubeProduct(dupModal.id, {
                      titleSuffix: dupTitleSuffix,
                      skuSuffix: dupSkuSuffix.trim() || '-PACK'
                    });
                    const nid = res.newProductId ?? (res.product as { id?: number })?.id;
                    showToast?.(
                      'success',
                      nid != null
                        ? `Nueva publicación en Tienda Nube (ID ${nid}). Actualizá la lista para verla.`
                        : (res.message || 'Duplicado creado.')
                    );
                    setDupModal(null);
                    handleRefresh();
                  } catch (err: any) {
                    showToast?.('error', err?.message || 'No se pudo duplicar');
                  } finally {
                    setDupSubmitting(false);
                  }
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-sm disabled:opacity-50"
              >
                {dupSubmitting ? <Loader2 size={18} className="animate-spin" /> : <SquareStack size={18} />}
                Crear duplicado
              </button>
            </div>
          </div>
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

      {imagesModalItem && (
        <TiendaNubeProductImagesModal
          productId={imagesModalItem.id}
          productTitle={imagesModalItem.title}
          showToast={showToast}
          onClose={() => setImagesModalItem(null)}
          onSaved={(thumb) => {
            if (thumb) applyThumbnails({ [imagesModalItem.id]: thumb });
          }}
        />
      )}
      {bulkImagesOpen && (
        <TiendaNubeBulkImagesModal
          selected={selectedTargets}
          showToast={showToast}
          onClose={() => setBulkImagesOpen(false)}
          onSaved={(thumbs) => applyThumbnails(thumbs)}
        />
      )}
    </div>
  );
};

export default TiendaNubeStock;
