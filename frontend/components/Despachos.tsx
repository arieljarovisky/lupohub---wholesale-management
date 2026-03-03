import React, { useState, useEffect } from 'react';
import { 
  Ship, Plus, RefreshCw, Loader2, Search, X, Calendar, Package, 
  DollarSign, MapPin, FileText, Trash2, Edit, Eye, ChevronDown,
  CheckCircle, Clock, Truck, Building, Globe, AlertTriangle
} from 'lucide-react';
import { api } from '../services/api';

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
  items?: any[];
}

const estadoConfig: Record<string, { label: string; color: string; bgColor: string; icon: React.ReactNode }> = {
  'en_transito': { label: 'En Tránsito', color: 'text-blue-400', bgColor: 'bg-blue-500/10', icon: <Ship size={14} /> },
  'en_aduana': { label: 'En Aduana', color: 'text-yellow-400', bgColor: 'bg-yellow-500/10', icon: <Building size={14} /> },
  'despachado': { label: 'Despachado', color: 'text-purple-400', bgColor: 'bg-purple-500/10', icon: <Truck size={14} /> },
  'entregado': { label: 'Entregado', color: 'text-green-400', bgColor: 'bg-green-500/10', icon: <CheckCircle size={14} /> }
};

const paisesComunes = ['Brasil', 'China', 'Estados Unidos', 'Italia', 'España', 'Alemania', 'Colombia', 'Perú', 'Chile', 'Otro'];

const Despachos: React.FC = () => {
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
  const [productSearchTerm, setProductSearchTerm] = useState('');
  const [savingProduct, setSavingProduct] = useState(false);

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
      alert('Número de despacho y fecha son requeridos');
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
      alert('Error: ' + (error.message || 'No se pudo guardar'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este despacho? Esta acción no se puede deshacer.')) return;
    
    try {
      await api.deleteDespacho(id);
      fetchDespachos();
    } catch (error) {
      alert('Error eliminando despacho');
    }
  };

  const handleViewDetail = async (despacho: Despacho) => {
    try {
      const detail = await api.getDespachoById(despacho.id);
      setSelectedDespacho(detail);
      setShowDetailModal(true);
    } catch (error) {
      alert('Error cargando detalles');
    }
  };

  const handleOpenAddProduct = async () => {
    setShowAddProductModal(true);
    setLoadingProductos(true);
    setSelectedProductId('');
    setAddCantidad('');
    setAddCosto('');
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
      alert('Seleccioná un producto');
      return;
    }

    setSavingProduct(true);
    try {
      const producto = productosSinDespacho.find(p => p.id === selectedProductId);
      await api.addDespachoItem(selectedDespacho.id, {
        product_id: selectedProductId,
        variant_id: null,
        cantidad: parseInt(addCantidad) || 0,
        costo_unitario: addCosto ? parseFloat(addCosto) : null,
        descripcion_item: producto ? `${producto.name} - ${producto.sku}` : ''
      });

      // Recargar detalle
      const detail = await api.getDespachoById(selectedDespacho.id);
      setSelectedDespacho(detail);
      setShowAddProductModal(false);
      fetchDespachos();
    } catch (error: any) {
      alert('Error: ' + (error.message || 'No se pudo agregar'));
    } finally {
      setSavingProduct(false);
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    if (!selectedDespacho || !confirm('¿Quitar este producto del despacho?')) return;
    
    try {
      await api.removeDespachoItem(selectedDespacho.id, itemId);
      const detail = await api.getDespachoById(selectedDespacho.id);
      setSelectedDespacho(detail);
      fetchDespachos();
    } catch (error) {
      alert('Error quitando producto');
    }
  };

  const filteredProductos = productosSinDespacho.filter(p => {
    if (!productSearchTerm) return true;
    const search = productSearchTerm.toLowerCase();
    return (
      p.name?.toLowerCase().includes(search) ||
      p.sku?.toLowerCase().includes(search)
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
        <div className="flex gap-2">
          <button
            onClick={fetchDespachos}
            disabled={loading}
            className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all text-sm"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
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
              <p className="text-xl font-black text-green-400">${((stats.total_fob || 0) / 1000).toFixed(0)}K</p>
              <p className="text-[10px] text-slate-500 uppercase">Total FOB</p>
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
                    {despacho.valor_fob && (
                      <div className="text-right">
                        <p className="text-slate-500 text-xs uppercase">FOB</p>
                        <p className="text-green-400 font-bold">{formatCurrency(despacho.valor_fob, despacho.moneda)}</p>
                      </div>
                    )}
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
                  <p className="text-green-400 font-bold">{formatCurrency(selectedDespacho.valor_fob, selectedDespacho.moneda)}</p>
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
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-white font-bold flex items-center gap-2">
                    <Package size={18} />
                    Productos en este despacho ({selectedDespacho.items?.length || 0})
                  </h4>
                  <button
                    onClick={handleOpenAddProduct}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white text-sm font-bold flex items-center gap-1.5 transition-colors"
                  >
                    <Plus size={14} />
                    Agregar Producto
                  </button>
                </div>
                {selectedDespacho.items && selectedDespacho.items.length > 0 ? (
                  <div className="bg-slate-800/30 rounded-xl overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-700/50">
                          <th className="text-left text-xs text-slate-500 font-bold uppercase p-3">Producto</th>
                          <th className="text-left text-xs text-slate-500 font-bold uppercase p-3">SKU</th>
                          <th className="text-right text-xs text-slate-500 font-bold uppercase p-3">Cantidad</th>
                          <th className="text-right text-xs text-slate-500 font-bold uppercase p-3">Costo Unit.</th>
                          <th className="text-right text-xs text-slate-500 font-bold uppercase p-3">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedDespacho.items.map((item: any, i: number) => (
                          <tr key={i} className="border-b border-slate-700/20">
                            <td className="p-3 text-white">{item.product_name || item.descripcion_item || '-'}</td>
                            <td className="p-3 text-slate-400 font-mono text-sm">{item.variant_sku || item.product_sku || '-'}</td>
                            <td className="p-3 text-right text-white font-bold">{item.cantidad}</td>
                            <td className="p-3 text-right text-green-400">{item.costo_unitario ? `$${item.costo_unitario}` : '-'}</td>
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
                    <p className="text-slate-500 text-sm mt-1">Hacé clic en "Agregar Producto" para asignar productos</p>
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
                  filteredProductos.slice(0, 50).map(p => (
                    <label
                      key={p.id}
                      className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors ${
                        selectedProductId === p.id 
                          ? 'bg-indigo-600/20 border border-indigo-500' 
                          : 'bg-slate-800/50 border border-transparent hover:bg-slate-800'
                      }`}
                    >
                      <input
                        type="radio"
                        name="product"
                        value={p.id}
                        checked={selectedProductId === p.id}
                        onChange={() => setSelectedProductId(p.id)}
                        className="accent-indigo-500"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">{p.name}</p>
                        <p className="text-slate-400 text-xs font-mono">{p.sku}</p>
                      </div>
                      <span className="text-slate-500 text-xs">Stock: {p.stock_total || 0}</span>
                    </label>
                  ))
                ) : (
                  <div className="text-center py-8 text-slate-400">
                    <Package className="mx-auto mb-2" size={32} />
                    <p>No hay productos sin despacho asignado</p>
                  </div>
                )}
              </div>

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
                disabled={savingProduct || !selectedProductId}
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
    </div>
  );
};

export default Despachos;
