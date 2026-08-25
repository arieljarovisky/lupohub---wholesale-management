import React, { useState, useEffect, useRef } from 'react';
import { 
  Ship, Plus, RefreshCw, Loader2, Search, X, Calendar, Package, 
  DollarSign, MapPin, FileText, Trash2, Edit, Eye, ChevronDown,
  CheckCircle, Clock, Truck, Building, Globe, AlertTriangle, Upload
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '../services/api';
import { parseStockExcel } from '../utils/inventoryUtils';
import { useNotification } from '../context/NotificationContext';

interface Despacho {
  id: string;
  numero_despacho: string;
  fecha_despacho: string;
  pais_origen: string;
  proveedor: string;
  descripcion: string;
  valor_fob: number;
  valor_cif: number;
  moneda: string;
  estado: 'en_transito' | 'en_aduana' | 'despachado' | 'entregado';
  notas: string;
  total_items: number;
  total_unidades: number;
  fob_list_name?: string | null;
  items?: any[];
}

const estadoConfig: Record<string, { label: string; color: string; bgColor: string; icon: React.ReactNode }> = {
  'en_transito': { label: 'En Tránsito', color: 'text-blue-400', bgColor: 'bg-blue-500/10', icon: <Ship size={14} /> },
  'en_aduana': { label: 'En Aduana', color: 'text-yellow-400', bgColor: 'bg-yellow-500/10', icon: <Building size={14} /> },
  'despachado': { label: 'Despachado', color: 'text-purple-400', bgColor: 'bg-purple-500/10', icon: <Truck size={14} /> },
  'entregado': { label: 'Entregado', color: 'text-green-400', bgColor: 'bg-green-500/10', icon: <CheckCircle size={14} /> }
};

const paisesComunes = ['Brasil', 'China', 'Estados Unidos', 'Italia', 'España', 'Alemania', 'Colombia', 'Perú', 'Chile', 'Otro'];

const buildVariantDisplaySku = (p: any): string => {
  const base = String(p?.sku || '').trim();
  const colorCode = String(p?.color_code || '').trim();
  const sizeCode = String(p?.size_code || '').trim();
  if (base && colorCode && sizeCode) return `${base}-${colorCode}-${sizeCode}`;
  if (base && sizeCode) return `${base}-${sizeCode}`;
  const variantSku = String(p?.variant_sku || '').trim();
  return variantSku || base || '-';
};

const Despachos: React.FC = () => {
  const { showToast, showConfirm } = useNotification();
  const [despachos, setDespachos] = useState<Despacho[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterEstado, setFilterEstado] = useState('');
  const [stats, setStats] = useState<any>({});
  
  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [editingDespacho, setEditingDespacho] = useState<Despacho | null>(null);
  const [selectedDespacho, setSelectedDespacho] = useState<Despacho | null>(null);
  const [saving, setSaving] = useState(false);

  // Add product modal
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [productosSinDespacho, setProductosSinDespacho] = useState<any[]>([]);
  const [loadingProductos, setLoadingProductos] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [addCantidad, setAddCantidad] = useState('');
  const [addCosto, setAddCosto] = useState('');
  /** Al agregar línea al despacho: sumar cantidad al stock del depósito (por defecto sí). */
  const [addDespachoIncrementStock, setAddDespachoIncrementStock] = useState(true);
  const [productSearchTerm, setProductSearchTerm] = useState('');
  const [savingProduct, setSavingProduct] = useState(false);

  const despachoTangoFileRef = useRef<HTMLInputElement>(null);
  const despachoGridFileRef = useRef<HTMLInputElement>(null);
  const [tangoImportingForDespacho, setTangoImportingForDespacho] = useState(false);
  /** Misma lógica que Inventario: al reimportar no pisar stock de variantes ya existentes. */
  const [tangoDespachoKeepStockOnExisting, setTangoDespachoKeepStockOnExisting] = useState(true);
  const [gridStockImporting, setGridStockImporting] = useState(false);
  /** Al importar planilla matriz: también escribir cantidades en el depósito (desmarcá solo si el stock ya está cargado). */
  const [despachoGridUpdateDepot, setDespachoGridUpdateDepot] = useState(true);

  // Asignar despacho a todos
  const [showAsignarTodosModal, setShowAsignarTodosModal] = useState(false);
  const [asignarTodosForm, setAsignarTodosForm] = useState({
    numero_despacho: '',
    fecha_despacho: new Date().toISOString().split('T')[0],
    pais_origen: 'Brasil'
  });
  const [savingAsignarTodos, setSavingAsignarTodos] = useState(false);
  const [productosSinDespachoCount, setProductosSinDespachoCount] = useState<number | null>(null);

  const [showAsignarUnoModal, setShowAsignarUnoModal] = useState(false);
  const [asignarUnoForm, setAsignarUnoForm] = useState({ numero_despacho: '', sku: '' });
  const [savingAsignarUno, setSavingAsignarUno] = useState(false);
  const [asignarUnoPreview, setAsignarUnoPreview] = useState<{ name: string; sku: string; stockTotal?: number } | null>(null);
  const [asignarUnoPreviewLoading, setAsignarUnoPreviewLoading] = useState(false);
  const [asignarUnoPreviewSearched, setAsignarUnoPreviewSearched] = useState(false);

  const refreshAsignarUnoPreview = async (skuRaw: string) => {
    const t = skuRaw.trim();
    if (!t) {
      setAsignarUnoPreview(null);
      setAsignarUnoPreviewSearched(false);
      return;
    }
    setAsignarUnoPreviewLoading(true);
    try {
      const base = t.includes('-') ? t.split('-')[0] : t;
      let p = await api.getProductBySku(base);
      if (!p && base !== t) p = await api.getProductBySku(t);
      if (p) {
        const st = (p as { stock_total?: number }).stock_total;
        setAsignarUnoPreview({
          name: p.name,
          sku: p.sku,
          stockTotal: typeof st === 'number' ? st : undefined
        });
      } else {
        setAsignarUnoPreview(null);
      }
      setAsignarUnoPreviewSearched(true);
    } finally {
      setAsignarUnoPreviewLoading(false);
    }
  };

  // Form state
  const [form, setForm] = useState({
    numero_despacho: '',
    fecha_despacho: new Date().toISOString().split('T')[0],
    pais_origen: 'Brasil',
    proveedor: '',
    descripcion: '',
    valor_fob: '',
    valor_cif: '',
    moneda: 'USD',
    estado: 'despachado' as const,
    notas: ''
  });

  const fetchDespachos = async () => {
    setLoading(true);
    try {
      const [despachosRes, statsRes] = await Promise.all([
        api.getDespachos({ estado: filterEstado || undefined, limit: 100 }),
        api.getDespachoStats()
      ]);
      setDespachos(despachosRes.despachos || []);
      setStats(statsRes);
    } catch (error) {
      console.error('Error fetching despachos:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDespachos();
  }, [filterEstado]);

  const filteredDespachos = despachos.filter(d => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      d.numero_despacho?.toLowerCase().includes(search) ||
      d.proveedor?.toLowerCase().includes(search) ||
      d.descripcion?.toLowerCase().includes(search) ||
      d.pais_origen?.toLowerCase().includes(search)
    );
  });

  const resetForm = () => {
    setForm({
      numero_despacho: '',
      fecha_despacho: new Date().toISOString().split('T')[0],
      pais_origen: 'Brasil',
      proveedor: '',
      descripcion: '',
      valor_fob: '',
      valor_cif: '',
      moneda: 'USD',
      estado: 'despachado',
      notas: ''
    });
    setEditingDespacho(null);
  };

  const handleOpenModal = (despacho?: Despacho) => {
    if (despacho) {
      setEditingDespacho(despacho);
      setForm({
        numero_despacho: despacho.numero_despacho,
        fecha_despacho: despacho.fecha_despacho?.split('T')[0] || '',
        pais_origen: despacho.pais_origen || 'Brasil',
        proveedor: despacho.proveedor || '',
        descripcion: despacho.descripcion || '',
        valor_fob: despacho.valor_fob?.toString() || '',
        valor_cif: despacho.valor_cif?.toString() || '',
        moneda: despacho.moneda || 'USD',
        estado: despacho.estado || 'despachado',
        notas: despacho.notas || ''
      });
    } else {
      resetForm();
    }
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.numero_despacho || !form.fecha_despacho) {
      showToast('info', 'Número de despacho y fecha son requeridos');
      return;
    }

    setSaving(true);
    try {
      const data = {
        ...form,
        valor_fob: form.valor_fob ? parseFloat(form.valor_fob) : null,
        valor_cif: form.valor_cif ? parseFloat(form.valor_cif) : null
      };

      if (editingDespacho) {
        await api.updateDespacho(editingDespacho.id, data);
      } else {
        await api.createDespacho(data);
      }

      setShowModal(false);
      resetForm();
      fetchDespachos();
    } catch (error: any) {
      showToast('error', error.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    showConfirm({
      title: 'Eliminar despacho',
      message: '¿Eliminar este despacho? Esta acción no se puede deshacer.',
      confirmLabel: 'Eliminar',
      onConfirm: () => {
        api.deleteDespacho(id).then(() => fetchDespachos()).catch(() => showToast('error', 'Error eliminando despacho'));
      },
    });
  };

  const handleViewDetail = async (despacho: Despacho) => {
    try {
      const detail = await api.getDespachoById(despacho.id);
      setSelectedDespacho(detail);
      setTangoDespachoKeepStockOnExisting(true);
      setDespachoGridUpdateDepot(true);
      setShowDetailModal(true);
    } catch (error) {
      showToast('error', 'Error cargando detalles');
    }
  };

  const handleOpenAddProduct = async () => {
    setShowAddProductModal(true);
    setLoadingProductos(true);
    setSelectedProductId('');
    setAddCantidad('0');
    setAddCosto('');
    setAddDespachoIncrementStock(true);
    setProductSearchTerm('');
    try {
      const productos = await api.getProductosSinDespacho();
      setProductosSinDespacho(productos);
    } catch (error) {
      console.error('Error loading productos:', error);
    } finally {
      setLoadingProductos(false);
    }
  };

  const handleAddProductToDespacho = async () => {
    if (!selectedProductId || !selectedDespacho) {
      showToast('info', 'Seleccioná un producto');
      return;
    }
    const cantidadNum = Number(addCantidad);
    if (!Number.isFinite(cantidadNum) || cantidadNum <= 0) {
      showToast('info', 'Ingresá una cantidad mayor a 0');
      return;
    }
    const costoNum = addCosto === '' ? null : Number(addCosto);
    if (costoNum != null && (!Number.isFinite(costoNum) || costoNum < 0)) {
      showToast('info', 'El costo unitario no es válido');
      return;
    }

    setSavingProduct(true);
    try {
      const producto = productosSinDespacho.find((p) => (p.variant_id || p.id) === selectedProductId);
      const res = await api.addDespachoItem(selectedDespacho.id, {
        product_id: producto?.product_id || null,
        variant_id: producto?.variant_id || selectedProductId,
        cantidad: Math.floor(cantidadNum),
        costo_unitario: costoNum,
        descripcion_item: producto
          ? `${producto.name} - ${producto.variant_sku || producto.sku || ''} ${producto.color_name ? `(${producto.color_name}` : ''}${producto.size_code ? ` ${producto.size_code}` : ''}${producto.color_name ? ')' : ''}`.trim()
          : '',
        incrementStock: addDespachoIncrementStock
      });
      if (!res?.id) {
        throw new Error(res?.message || 'No se pudo agregar el producto al despacho');
      }

      // Recargar detalle
      const detail = await api.getDespachoById(selectedDespacho.id);
      setSelectedDespacho(detail);
      setShowAddProductModal(false);
      showToast(
        'success',
        res?.stockIncremented === false
          ? 'Agregado al despacho sin modificar stock del depósito.'
          : 'Producto agregado al despacho y sumado al stock.'
      );
      fetchDespachos();
    } catch (error: any) {
      showToast('error', error.message || 'No se pudo agregar');
    } finally {
      setSavingProduct(false);
    }
  };

  const handleRemoveItem = (itemId: string) => {
    if (!selectedDespacho) return;
    showConfirm({
      title: 'Quitar producto',
      message: '¿Quitar este producto del despacho?',
      confirmLabel: 'Quitar',
      onConfirm: () => {
        api.removeDespachoItem(selectedDespacho.id, itemId)
          .then(async () => {
            const detail = await api.getDespachoById(selectedDespacho.id);
            setSelectedDespacho(detail);
            fetchDespachos();
          })
          .catch(() => showToast('error', 'Error quitando producto'));
      },
    });
  };

  const handleImportTangoToOpenDespacho = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedDespacho?.id) return;
    setTangoImportingForDespacho(true);
    const despachoId = selectedDespacho.id;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = ev.target?.result;
        if (!data) throw new Error('No se pudo leer el archivo');
        const wb = XLSX.read(data as string, { type: 'binary' });
        const firstSheet = wb.Sheets[wb.SheetNames[0]];
        const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(firstSheet);
        if (rows.length === 0) {
          showToast('info', 'Sin filas en la primera hoja. Usá el mismo Excel que en Inventario → Importar Tango (Código + Talle + Color; opcional Cantidad).');
          return;
        }
        const res = await api.importTangoArticles(rows, true, {
          keepStockOnExistingVariants: tangoDespachoKeepStockOnExisting,
          despachoId,
        });
        const detail = await api.getDespachoById(despachoId);
        setSelectedDespacho(detail);
        fetchDespachos();
        const lines = (res.despachoItemsInserted || 0) + (res.despachoItemsUpdated || 0);
        const parts = [
          `${lines} línea(s) en este despacho`,
          `${res.despachoProductsTagged || 0} producto(s) con último despacho actualizado`,
          `${res.productsCreated} prod. nuevos, ${res.variantsCreated} var. nuevas, ${res.variantsUpdated} filas existentes`,
        ];
        if (res.stockUpdatesSkipped) {
          parts.push(`stock no modificado en ${res.stockUpdatesSkipped} variante(s) ya existente(s)`);
        }
        showToast('success', parts.join(' · '));
        if (res.errors?.length) {
          showToast('error', `Errores en algunas filas: ${res.errors.slice(0, 3).join('; ')}${res.errors.length > 3 ? '…' : ''}`);
        }
      } catch (err: any) {
        const msg = err?.response?.data?.message || err?.message || 'Error importando';
        showToast('error', msg);
      } finally {
        setTangoImportingForDespacho(false);
        if (despachoTangoFileRef.current) despachoTangoFileRef.current.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleImportStockGridToDespacho = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedDespacho?.id) return;
    if (file.name.toLowerCase().endsWith('.numbers')) {
      showToast(
        'info',
        'Los archivos .numbers no se pueden abrir en el navegador. En Numbers: Archivo → Exportar a → Excel (.xlsx), y subí ese archivo.'
      );
      e.target.value = '';
      return;
    }
    setGridStockImporting(true);
    const did = selectedDespacho.id;
    try {
      const rows = await parseStockExcel(file);
      if (rows.length === 0) {
        showToast(
          'warning',
          'Sin filas válidas. La primera fila debe tener CODIGO/Código, COLOR y columnas de talles (P, M, 10, 130 - P, etc.). Si usás Numbers, exportá a .xlsx.'
        );
        return;
      }
      const res = await api.importStockGridToDespacho(did, rows, { updateDepotStock: despachoGridUpdateDepot });
      const detail = await api.getDespachoById(did);
      setSelectedDespacho(detail);
      fetchDespachos();
      showToast(
        'success',
        `Planilla matriz: ${res.updatedStock ?? 0} celdas de stock, +${res.despachoItemsInserted ?? 0} líneas en despacho, ${res.despachoItemsUpdated ?? 0} cantidades actualizadas, ${res.productsTagged ?? 0} producto(s) con último despacho.`
      );
      if ((res.notFoundCount ?? 0) > 0) {
        showToast('error', `${res.notFoundCount} combinación(es) código/color/talle no encontradas en el sistema.`);
      }
    } catch (err: any) {
      showToast('error', err?.response?.data?.message || err?.message || 'Error importando planilla');
    } finally {
      setGridStockImporting(false);
      e.target.value = '';
    }
  };

  const filteredProductos = productosSinDespacho.filter(p => {
    if (!productSearchTerm) return true;
    const search = productSearchTerm.toLowerCase();
    const compact = (v: any) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const searchCompact = compact(productSearchTerm);
    const displaySku = buildVariantDisplaySku(p).toLowerCase();
    const displaySkuCompact = compact(displaySku);
    return (
      p.name?.toLowerCase().includes(search) ||
      p.sku?.toLowerCase().includes(search) ||
      p.variant_sku?.toLowerCase().includes(search) ||
      displaySku.includes(search) ||
      displaySkuCompact.includes(searchCompact) ||
      compact(p.sku).includes(searchCompact) ||
      compact(p.variant_sku).includes(searchCompact) ||
      p.color_name?.toLowerCase().includes(search) ||
      p.size_code?.toLowerCase().includes(search)
    );
  });

  const formatCurrency = (value: number, currency: string = 'USD') => {
    if (!value) return '-';
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency }).format(value);
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('es-AR');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-900/30">
            <Ship className="text-white" size={28} />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white">Despachos de Importación</h2>
            <p className="text-slate-400 text-sm">Control y trazabilidad de mercadería importada</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={fetchDespachos}
            disabled={loading}
            className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all text-sm"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          </button>
          <button
            onClick={async () => {
              setShowAsignarTodosModal(true);
              setAsignarTodosForm({ numero_despacho: '', fecha_despacho: new Date().toISOString().split('T')[0], pais_origen: 'Brasil' });
              try {
                const list = await api.getProductosSinDespacho();
                setProductosSinDespachoCount(Array.isArray(list) ? list.length : 0);
              } catch {
                setProductosSinDespachoCount(null);
              }
            }}
            className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all text-sm border border-slate-600"
          >
            <Package size={18} />
            Asignar Nº a todos los artículos
          </button>
          <button
            type="button"
            onClick={() => {
              setShowAsignarUnoModal(true);
              setAsignarUnoForm({ numero_despacho: '', sku: '' });
              setAsignarUnoPreview(null);
              setAsignarUnoPreviewSearched(false);
            }}
            className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all text-sm border border-slate-600"
          >
            <FileText size={18} />
            Un artículo por código
          </button>
          <button
            onClick={() => handleOpenModal()}
            className="bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-indigo-900/30 transition-all"
          >
            <Plus size={18} />
            Nuevo Despacho
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
          <div className="flex items-center gap-2">
            <Ship size={18} className="text-indigo-400" />
            <div>
              <p className="text-xl font-black text-white">{stats.total_despachos || 0}</p>
              <p className="text-[10px] text-slate-500 uppercase">Total Despachos</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
          <div className="flex items-center gap-2">
            <Clock size={18} className="text-blue-400" />
            <div>
              <p className="text-xl font-black text-blue-400">{stats.en_transito || 0}</p>
              <p className="text-[10px] text-slate-500 uppercase">En Tránsito</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
          <div className="flex items-center gap-2">
            <Building size={18} className="text-yellow-400" />
            <div>
              <p className="text-xl font-black text-yellow-400">{stats.en_aduana || 0}</p>
              <p className="text-[10px] text-slate-500 uppercase">En Aduana</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
          <div className="flex items-center gap-2">
            <Package size={18} className="text-purple-400" />
            <div>
              <p className="text-xl font-black text-purple-400">{stats.total_unidades || 0}</p>
              <p className="text-[10px] text-slate-500 uppercase">Unidades</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
          <div className="flex items-center gap-2">
            <DollarSign size={18} className="text-green-400" />
            <div>
              <p className="text-xl font-black text-green-400">
                {Number(stats.total_fob) >= 1000
                  ? `$${(Number(stats.total_fob) / 1000).toFixed(0)}K`
                  : formatCurrency(Number(stats.total_fob) || 0, 'USD')}
              </p>
              <p className="text-[10px] text-slate-500 uppercase">Total FOB</p>
              {stats.fob_list_name && (
                <p className="text-[9px] text-slate-600 mt-0.5 truncate max-w-[120px]" title={stats.fob_list_name}>
                  {stats.fob_list_name}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-slate-800/30 rounded-xl p-4 border border-slate-700/30">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Buscar por número, proveedor, descripción..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-900/50 border border-slate-700/50 rounded-xl pl-10 pr-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 transition-colors"
            />
          </div>
          <select
            value={filterEstado}
            onChange={(e) => setFilterEstado(e.target.value)}
            className="bg-slate-900/50 border border-slate-700/50 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500/50 transition-colors cursor-pointer"
          >
            <option value="">Todos los estados</option>
            <option value="en_transito">En Tránsito</option>
            <option value="en_aduana">En Aduana</option>
            <option value="despachado">Despachado</option>
            <option value="entregado">Entregado</option>
          </select>
        </div>
      </div>

      {/* Despachos List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="animate-spin text-indigo-500 mb-4" size={48} />
          <p className="text-slate-400">Cargando despachos...</p>
        </div>
      ) : filteredDespachos.length === 0 ? (
        <div className="bg-slate-800/30 rounded-2xl p-16 text-center border border-slate-700/30">
          <Ship className="mx-auto text-slate-600 mb-4" size={56} />
          <p className="text-slate-400 text-lg font-medium">No hay despachos</p>
          <p className="text-slate-500 text-sm mt-2">Creá tu primer despacho de importación</p>
          <button
            onClick={() => handleOpenModal()}
            className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-white font-bold text-sm transition-colors"
          >
            Crear Despacho
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredDespachos.map((despacho) => {
            const config = estadoConfig[despacho.estado] || estadoConfig['despachado'];
            
            return (
              <div 
                key={despacho.id} 
                className="bg-slate-800/40 rounded-2xl border border-slate-700/30 hover:border-slate-600/50 transition-all p-5"
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-xl ${config.bgColor}`}>
                      <Ship size={24} className={config.color} />
                    </div>
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="text-white font-black text-lg">{despacho.numero_despacho}</h3>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold ${config.color} ${config.bgColor}`}>
                          {config.icon}
                          {config.label}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-slate-400">
                        <span className="flex items-center gap-1">
                          <Calendar size={14} />
                          {formatDate(despacho.fecha_despacho)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Globe size={14} />
                          {despacho.pais_origen}
                        </span>
                        {despacho.proveedor && (
                          <span className="flex items-center gap-1">
                            <Building size={14} />
                            {despacho.proveedor}
                          </span>
                        )}
                      </div>
                      {despacho.descripcion && (
                        <p className="text-slate-500 text-sm mt-2 line-clamp-1">{despacho.descripcion}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className="text-slate-500 text-xs uppercase">Unidades</p>
                      <p className="text-white font-black text-xl">{despacho.total_unidades || 0}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-slate-500 text-xs uppercase">FOB</p>
                      <p className="text-green-400 font-bold">{formatCurrency(Number(despacho.valor_fob) || 0, despacho.moneda)}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleViewDetail(despacho)}
                        className="p-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg text-slate-400 hover:text-white transition-colors"
                        title="Ver detalle"
                      >
                        <Eye size={18} />
                      </button>
                      <button
                        onClick={() => handleOpenModal(despacho)}
                        className="p-2 bg-slate-700/50 hover:bg-indigo-600/50 rounded-lg text-slate-400 hover:text-indigo-400 transition-colors"
                        title="Editar"
                      >
                        <Edit size={18} />
                      </button>
                      <button
                        onClick={() => handleDelete(despacho.id)}
                        className="p-2 bg-slate-700/50 hover:bg-red-600/50 rounded-lg text-slate-400 hover:text-red-400 transition-colors"
                        title="Eliminar"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-2xl shadow-2xl my-8">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <Ship className="text-indigo-400" size={24} />
                <h3 className="font-bold text-white text-lg">
                  {editingDespacho ? 'Editar Despacho' : 'Nuevo Despacho de Importación'}
                </h3>
              </div>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-500 font-bold uppercase block mb-1">Número de Despacho *</label>
                  <input
                    type="text"
                    value={form.numero_despacho}
                    onChange={(e) => setForm({ ...form, numero_despacho: e.target.value })}
                    placeholder="Ej: 22-001-IC04-123456-A"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 font-bold uppercase block mb-1">Fecha de Despacho *</label>
                  <input
                    type="date"
                    value={form.fecha_despacho}
                    onChange={(e) => setForm({ ...form, fecha_despacho: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-500 font-bold uppercase block mb-1">País de Origen</label>
                  <select
                    value={form.pais_origen}
                    onChange={(e) => setForm({ ...form, pais_origen: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500"
                  >
                    {paisesComunes.map(pais => (
                      <option key={pais} value={pais}>{pais}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 font-bold uppercase block mb-1">Estado</label>
                  <select
                    value={form.estado}
                    onChange={(e) => setForm({ ...form, estado: e.target.value as any })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="en_transito">En Tránsito</option>
                    <option value="en_aduana">En Aduana</option>
                    <option value="despachado">Despachado</option>
                    <option value="entregado">Entregado</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-500 font-bold uppercase block mb-1">Proveedor</label>
                <input
                  type="text"
                  value={form.proveedor}
                  onChange={(e) => setForm({ ...form, proveedor: e.target.value })}
                  placeholder="Nombre del proveedor"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-500 font-bold uppercase block mb-1">Descripción</label>
                <input
                  type="text"
                  value={form.descripcion}
                  onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                  placeholder="Descripción de la mercadería"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-slate-500 font-bold uppercase block mb-1">Valor FOB</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.valor_fob}
                    onChange={(e) => setForm({ ...form, valor_fob: e.target.value })}
                    placeholder="0.00"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 font-bold uppercase block mb-1">Valor CIF</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.valor_cif}
                    onChange={(e) => setForm({ ...form, valor_cif: e.target.value })}
                    placeholder="0.00"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 font-bold uppercase block mb-1">Moneda</label>
                  <select
                    value={form.moneda}
                    onChange={(e) => setForm({ ...form, moneda: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="BRL">BRL</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-500 font-bold uppercase block mb-1">Notas</label>
                <textarea
                  value={form.notas}
                  onChange={(e) => setForm({ ...form, notas: e.target.value })}
                  placeholder="Notas adicionales..."
                  rows={3}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>
            </div>

            <div className="p-6 pt-0 flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-xl text-white font-bold transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-white font-bold transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : null}
                {editingDespacho ? 'Guardar Cambios' : 'Crear Despacho'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {showDetailModal && selectedDespacho && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-3xl shadow-2xl my-8">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-white text-lg">Despacho {selectedDespacho.numero_despacho}</h3>
                <p className="text-slate-400 text-sm">{formatDate(selectedDespacho.fecha_despacho)} - {selectedDespacho.pais_origen}</p>
              </div>
              <button onClick={() => setShowDetailModal(false)} className="text-slate-400 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
              {/* Info Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-800/50 rounded-xl p-4">
                  <p className="text-xs text-slate-500 uppercase">Estado</p>
                  <p className={`font-bold ${estadoConfig[selectedDespacho.estado]?.color || 'text-white'}`}>
                    {estadoConfig[selectedDespacho.estado]?.label || selectedDespacho.estado}
                  </p>
                </div>
                <div className="bg-slate-800/50 rounded-xl p-4">
                  <p className="text-xs text-slate-500 uppercase">Proveedor</p>
                  <p className="text-white font-bold">{selectedDespacho.proveedor || '-'}</p>
                </div>
                <div className="bg-slate-800/50 rounded-xl p-4">
                  <p className="text-xs text-slate-500 uppercase">Valor FOB</p>
                  <p className="text-green-400 font-bold">{formatCurrency(Number(selectedDespacho.valor_fob) || 0, selectedDespacho.moneda)}</p>
                  {selectedDespacho.fob_list_name && (
                    <p className="text-[10px] text-slate-500 mt-1">{selectedDespacho.fob_list_name}</p>
                  )}
                </div>
                <div className="bg-slate-800/50 rounded-xl p-4">
                  <p className="text-xs text-slate-500 uppercase">Valor CIF</p>
                  <p className="text-blue-400 font-bold">{formatCurrency(selectedDespacho.valor_cif, selectedDespacho.moneda)}</p>
                </div>
              </div>

              {selectedDespacho.descripcion && (
                <div className="bg-slate-800/30 rounded-xl p-4">
                  <p className="text-xs text-slate-500 uppercase mb-2">Descripción</p>
                  <p className="text-slate-300">{selectedDespacho.descripcion}</p>
                </div>
              )}

              {selectedDespacho.notas && (
                <div className="bg-slate-800/30 rounded-xl p-4">
                  <p className="text-xs text-slate-500 uppercase mb-2">Notas</p>
                  <p className="text-slate-300">{selectedDespacho.notas}</p>
                </div>
              )}

              {/* Items */}
              <div>
                <input
                  ref={despachoTangoFileRef}
                  type="file"
                  accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  className="hidden"
                  onChange={handleImportTangoToOpenDespacho}
                />
                <input
                  ref={despachoGridFileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                  className="hidden"
                  onChange={handleImportStockGridToDespacho}
                />
                <div className="flex flex-col gap-3 mb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-white font-bold flex items-center gap-2">
                      <Package size={18} />
                      Productos en este despacho ({selectedDespacho.items?.length || 0})
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => despachoTangoFileRef.current?.click()}
                        disabled={tangoImportingForDespacho || gridStockImporting}
                        className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded-lg text-white text-sm font-bold flex items-center gap-1.5 transition-colors border border-emerald-600/50"
                      >
                        {tangoImportingForDespacho ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Upload size={14} />
                        )}
                        Importar Excel (Tango)
                      </button>
                      <button
                        type="button"
                        onClick={() => despachoGridFileRef.current?.click()}
                        disabled={gridStockImporting || tangoImportingForDespacho}
                        className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 rounded-lg text-white text-sm font-bold flex items-center gap-1.5 transition-colors border border-slate-500/60"
                      >
                        {gridStockImporting ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <FileText size={14} />
                        )}
                        Planilla CODIGO+COLOR+talles
                      </button>
                      <button
                        type="button"
                        onClick={handleOpenAddProduct}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white text-sm font-bold flex items-center gap-1.5 transition-colors"
                      >
                        <Plus size={14} />
                        Agregar Producto
                      </button>
                    </div>
                  </div>
                  <label className="flex items-start gap-2.5 cursor-pointer select-none max-w-3xl">
                    <input
                      type="checkbox"
                      checked={tangoDespachoKeepStockOnExisting}
                      onChange={(e) => setTangoDespachoKeepStockOnExisting(e.target.checked)}
                      className="mt-0.5 rounded border-slate-600 text-emerald-500 focus:ring-emerald-500 shrink-0"
                    />
                    <span className="text-xs text-slate-400 leading-snug">
                      <strong className="text-slate-300">Reimportar sin pisar stock:</strong> si está marcado, las variantes que ya existían no cambian cantidad en depósito (como en Inventario). Las filas se vinculan igual a este despacho con la cantidad del Excel o del stock actual.
                    </span>
                  </label>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Mismo formato que <strong className="text-slate-400">Inventario → Importar Tango</strong>. Si una variante ya tenía línea en este despacho, la cantidad se reemplaza por la del Excel (o stock actual si no hay columna Cantidad).
                  </p>
                  <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 px-3 py-2.5 space-y-2">
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      <strong className="text-slate-300">Planilla matriz</strong> (como <strong className="text-slate-300">articulos_lupo_normalizados</strong>): misma lógica que{' '}
                      <strong className="text-slate-300">Inventario → importar stock por Excel</strong>: fila con código de artículo, color (código o nombre) y una columna por talle (P, 10, 130 - P, etc.).{' '}
                      <span className="text-amber-200/90">Los .numbers no se pueden subir:</span> exportá a <strong className="text-slate-300">.xlsx</strong> desde Numbers.
                    </p>
                    <label className="flex items-start gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={despachoGridUpdateDepot}
                        onChange={(e) => setDespachoGridUpdateDepot(e.target.checked)}
                        className="mt-0.5 rounded border-slate-600 text-slate-400 focus:ring-slate-500 shrink-0"
                      />
                      <span className="text-xs text-slate-400 leading-snug">
                        <strong className="text-slate-300">Actualizar stock del depósito</strong> con las cantidades de la planilla. Desmarcá solo si el depósito ya está cargado y solo querés completar el despacho en el sistema.
                      </span>
                    </label>
                  </div>
                </div>
                {selectedDespacho.items && selectedDespacho.items.length > 0 ? (
                  <div className="bg-slate-800/30 rounded-xl overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-700/50">
                          <th className="text-left text-xs text-slate-500 font-bold uppercase p-3">Producto</th>
                          <th className="text-left text-xs text-slate-500 font-bold uppercase p-3">SKU</th>
                          <th className="text-right text-xs text-slate-500 font-bold uppercase p-3">Cantidad</th>
                          <th className="text-right text-xs text-slate-500 font-bold uppercase p-3">FOB unit.</th>
                          <th className="text-right text-xs text-slate-500 font-bold uppercase p-3">FOB línea</th>
                          <th className="text-right text-xs text-slate-500 font-bold uppercase p-3">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedDespacho.items.map((item: any, i: number) => (
                          <tr key={i} className="border-b border-slate-700/20">
                            <td className="p-3 text-white">{item.product_name || item.descripcion_item || '-'}</td>
                            <td className="p-3 text-slate-400 font-mono text-sm">{item.variant_sku || item.product_sku || '-'}</td>
                            <td className="p-3 text-right text-white font-bold">{item.cantidad}</td>
                            <td className="p-3 text-right text-green-400">
                              {item.precio_fob != null || item.costo_unitario
                                ? formatCurrency(Number(item.precio_fob ?? item.costo_unitario), selectedDespacho.moneda)
                                : '-'}
                            </td>
                            <td className="p-3 text-right text-green-300">
                              {item.costo_linea != null
                                ? formatCurrency(Number(item.costo_linea), selectedDespacho.moneda)
                                : '-'}
                            </td>
                            <td className="p-3 text-right">
                              <button
                                onClick={() => handleRemoveItem(item.id)}
                                className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                title="Quitar del despacho"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="bg-slate-800/30 rounded-xl p-8 text-center">
                    <AlertTriangle className="mx-auto text-yellow-500 mb-2" size={32} />
                    <p className="text-slate-400">No hay productos asignados a este despacho</p>
                    <p className="text-slate-500 text-sm mt-1">
                      Importá un Excel (.xlsx) con Tango, la planilla matriz CODIGO+COLOR+talles, o usá &quot;Agregar Producto&quot;.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="p-6 pt-0 flex justify-end">
              <button
                onClick={() => setShowDetailModal(false)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-xl text-white font-bold transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Product Modal */}
      {showAddProductModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-lg shadow-2xl">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h3 className="font-bold text-white text-lg flex items-center gap-2">
                <Plus size={20} className="text-indigo-400" />
                Agregar Producto al Despacho
              </h3>
              <button onClick={() => setShowAddProductModal(false)} className="text-slate-400 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                <input
                  type="text"
                  placeholder="Buscar producto por nombre o SKU..."
                  value={productSearchTerm}
                  onChange={(e) => setProductSearchTerm(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-10 pr-4 py-3 text-white placeholder-slate-500 focus:border-indigo-500 outline-none"
                />
              </div>

              {/* Product List */}
              <div className="max-h-60 overflow-y-auto space-y-2">
                {loadingProductos ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="animate-spin text-indigo-400" size={24} />
                  </div>
                ) : filteredProductos.length > 0 ? (
                  filteredProductos.slice(0, 50).map((p) => {
                    const variantKey = p.variant_id || p.id;
                    const displaySku = buildVariantDisplaySku(p);
                    return (
                      <label
                        key={variantKey}
                        className={`flex items-center gap-3 p-3 rounded-xl transition-colors cursor-pointer ${
                          selectedProductId === variantKey
                            ? 'bg-indigo-600/20 border border-indigo-500'
                            : 'bg-slate-800/50 border border-transparent hover:bg-slate-800'
                        }`}
                      >
                        <input
                          type="radio"
                          name="product"
                          value={variantKey}
                          checked={selectedProductId === variantKey}
                          onChange={() => {
                            setSelectedProductId(variantKey);
                            setAddCantidad('0');
                          }}
                          className="accent-indigo-500"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-medium truncate">{p.name}</p>
                          <p className="text-slate-400 text-xs font-mono">
                            {displaySku} {p.color_name ? `· ${p.color_name}` : ''} {p.size_code ? `· ${p.size_code}` : ''}
                          </p>
                        </div>
                        <span className="text-slate-500 text-xs">Stock actual: {Number(p.stock_total) || 0}</span>
                      </label>
                    );
                  })
                ) : (
                  <div className="text-center py-8 text-slate-400">
                    <Package className="mx-auto mb-2" size={32} />
                    <p>No hay artículos para mostrar</p>
                  </div>
                )}
              </div>

              <label className="flex items-start gap-2.5 cursor-pointer select-none px-0.5">
                <input
                  type="checkbox"
                  checked={addDespachoIncrementStock}
                  onChange={(e) => setAddDespachoIncrementStock(e.target.checked)}
                  className="mt-0.5 rounded border-slate-600 text-indigo-500 focus:ring-indigo-500 shrink-0"
                />
                <span className="text-xs text-slate-400 leading-snug">
                  <strong className="text-slate-300">Sumar al stock del depósito</strong> esta cantidad. Desmarcá si el stock ya está cargado (ej. Tango) y solo necesitás trazabilidad del despacho.
                </span>
              </label>

              {/* Quantity and Cost */}
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="text-xs text-slate-500 uppercase font-bold mb-1 block">Cantidad</label>
                  <input
                    type="number"
                    value={addCantidad}
                    onChange={(e) => setAddCantidad(e.target.value)}
                    placeholder="0"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white focus:border-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 uppercase font-bold mb-1 block">Costo Unit. (USD)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={addCosto}
                    onChange={(e) => setAddCosto(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white focus:border-indigo-500 outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-slate-800 flex justify-end gap-3">
              <button
                onClick={() => setShowAddProductModal(false)}
                className="px-4 py-2 text-slate-400 hover:text-white transition-colors font-bold"
              >
                Cancelar
              </button>
              <button
                onClick={handleAddProductToDespacho}
                disabled={savingProduct || !selectedProductId || !Number.isFinite(Number(addCantidad)) || Number(addCantidad) <= 0}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-white font-bold flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingProduct ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Agregando...
                  </>
                ) : (
                  <>
                    <CheckCircle size={16} />
                    Agregar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Asignar número de despacho a todos los artículos sin despacho */}
      {showAsignarTodosModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-md shadow-2xl">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h3 className="font-bold text-white text-lg flex items-center gap-2">
                <Package size={20} className="text-indigo-400" />
                Asignar número de despacho a todos los artículos
              </h3>
              <button onClick={() => setShowAsignarTodosModal(false)} className="text-slate-400 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {productosSinDespachoCount !== null && (
                <p className="text-slate-400 text-sm">
                  Hay <strong className="text-white">{productosSinDespachoCount}</strong> producto(s) sin número de despacho. Si el número no existe, se crea el despacho; si ya existe, se reutiliza y se asigna a esos productos.
                </p>
              )}
              <div>
                <label className="text-xs text-slate-500 font-bold uppercase block mb-1">Número de despacho *</label>
                <input
                  type="text"
                  value={asignarTodosForm.numero_despacho}
                  onChange={(e) => setAsignarTodosForm({ ...asignarTodosForm, numero_despacho: e.target.value })}
                  placeholder="Ej: 22-001-IC04-123456-A"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-500 font-bold uppercase block mb-1">Fecha</label>
                  <input
                    type="date"
                    value={asignarTodosForm.fecha_despacho}
                    onChange={(e) => setAsignarTodosForm({ ...asignarTodosForm, fecha_despacho: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 font-bold uppercase block mb-1">País de origen</label>
                  <select
                    value={asignarTodosForm.pais_origen}
                    onChange={(e) => setAsignarTodosForm({ ...asignarTodosForm, pais_origen: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500"
                  >
                    {paisesComunes.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="p-6 pt-0 flex justify-end gap-3">
              <button
                onClick={() => setShowAsignarTodosModal(false)}
                className="px-4 py-2 text-slate-400 hover:text-white font-bold transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  if (!asignarTodosForm.numero_despacho.trim()) {
                    showToast('info', 'Ingresá el número de despacho');
                    return;
                  }
                  setSavingAsignarTodos(true);
                  try {
                    const res = await api.asignarDespachoATodos(asignarTodosForm);
                    setShowAsignarTodosModal(false);
                    showToast('success', res.message || `Se asignó el despacho a ${res.total_asignados} producto(s).`);
                    fetchDespachos();
                  } catch (err: any) {
                    showToast('error', err?.message || 'No se pudo asignar el despacho');
                  } finally {
                    setSavingAsignarTodos(false);
                  }
                }}
                disabled={savingAsignarTodos || !asignarTodosForm.numero_despacho.trim()}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-white font-bold flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                {savingAsignarTodos ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                Asignar a todos
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: asignar un despacho existente a un producto por SKU / código de variante */}
      {showAsignarUnoModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-md shadow-2xl">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h3 className="font-bold text-white text-lg flex items-center gap-2">
                <FileText size={20} className="text-indigo-400" />
                Asignar despacho a un artículo
              </h3>
              <button type="button" onClick={() => setShowAsignarUnoModal(false)} className="text-slate-400 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-slate-400 text-sm">
                El número de despacho tiene que existir en el listado (o crealo con &quot;Nuevo Despacho&quot;). Podés usar el SKU del modelo (ej. <span className="text-slate-300">QE5546</span>) o el código completo de la factura (ej. <span className="text-slate-300">QE5546-158-614</span>).
              </p>
              <div className="bg-slate-800/80 border border-slate-600/60 rounded-xl p-3 text-sm text-slate-300">
                <strong className="text-white">Sin stock en depósito:</strong> igual podés asignar el despacho acá; no hace falta tener unidades. Si en Inventario no lo ves, desactivá el filtro{' '}
                <span className="text-cyan-300 font-semibold">«Ocultar variantes con 0 stock»</span> o buscá por SKU en la barra de búsqueda.
              </div>
              <div>
                <label className="text-xs text-slate-500 font-bold uppercase block mb-1">Número de despacho *</label>
                <input
                  type="text"
                  value={asignarUnoForm.numero_despacho}
                  onChange={(e) => setAsignarUnoForm({ ...asignarUnoForm, numero_despacho: e.target.value })}
                  placeholder="Ej: 26001IC04049980C"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 font-bold uppercase block mb-1">Código del producto *</label>
                <input
                  type="text"
                  value={asignarUnoForm.sku}
                  onChange={(e) => {
                    setAsignarUnoForm({ ...asignarUnoForm, sku: e.target.value });
                    setAsignarUnoPreview(null);
                    setAsignarUnoPreviewSearched(false);
                  }}
                  onBlur={(e) => void refreshAsignarUnoPreview(e.target.value)}
                  placeholder="Ej: QE5546 o QE5546-158-614"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
                {asignarUnoPreviewLoading && (
                  <p className="text-xs text-slate-500 mt-2 flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" /> Buscando producto…
                  </p>
                )}
                {!asignarUnoPreviewLoading && asignarUnoPreview && (
                  <p className="text-xs text-emerald-400/95 mt-2">
                    ✓ Encontrado: <span className="font-semibold text-white">{asignarUnoPreview.name}</span> ({asignarUnoPreview.sku})
                    {typeof asignarUnoPreview.stockTotal === 'number' && (
                      <span className="text-slate-400"> · Stock total actual: {asignarUnoPreview.stockTotal}</span>
                    )}
                  </p>
                )}
                {!asignarUnoPreviewLoading && asignarUnoPreviewSearched && asignarUnoForm.sku.trim() && !asignarUnoPreview && (
                  <p className="text-xs text-amber-400/90 mt-2">
                    No se encontró el producto con ese código. Revisá el SKU del modelo o probá el código base (ej. QE5546).
                  </p>
                )}
              </div>
            </div>
            <div className="p-6 pt-0 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowAsignarUnoModal(false)}
                className="px-4 py-2 text-slate-400 hover:text-white font-bold transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!asignarUnoForm.numero_despacho.trim() || !asignarUnoForm.sku.trim()) {
                    showToast('info', 'Completá número de despacho y código del producto');
                    return;
                  }
                  setSavingAsignarUno(true);
                  try {
                    const res = await api.asignarDespachoAProducto({
                      numero_despacho: asignarUnoForm.numero_despacho.trim(),
                      sku: asignarUnoForm.sku.trim()
                    });
                    setShowAsignarUnoModal(false);
                    showToast('success', res.message || 'Despacho asignado');
                    fetchDespachos();
                  } catch (err: any) {
                    showToast('error', err?.message || 'No se pudo asignar');
                  } finally {
                    setSavingAsignarUno(false);
                  }
                }}
                disabled={savingAsignarUno || !asignarUnoForm.numero_despacho.trim() || !asignarUnoForm.sku.trim()}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-white font-bold flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                {savingAsignarUno ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                Asignar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Despachos;
