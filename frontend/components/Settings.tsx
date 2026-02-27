import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Tag, Palette, Cloud, Zap, RefreshCw, Link, ExternalLink, Check, AlertCircle, Loader2, Power, Save, Key, User as UserIcon, TrendingUp, Percent, DollarSign, Shield, Mail, Lock, AlertTriangle, X } from 'lucide-react';
import { Attribute, Role, ApiConfig, User, Order } from '../types';
import { api } from '../services/api';
import { getApiConfig, saveApiConfig } from '../services/apiIntegration';
import { setBaseUrl, setAuthToken, request } from '../services/httpClient';

const Modal = ({ isOpen, onClose, title, children, footer }: { isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-slide-up">
        <div className="p-6 border-b border-slate-800 flex justify-between items-center">
          <h3 className="font-bold text-white text-lg">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="p-6">
          {children}
        </div>
        {footer && (
          <div className="p-6 pt-0 flex justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

interface SettingsProps {
  attributes: Attribute[];
  onCreateAttribute: (attr: Attribute) => void;
  onDeleteAttribute: (id: string) => void;
  role: Role;
  users?: User[];
  onUpdateUser?: (user: User) => void;
  onCreateUser?: (user: User) => void;
  onDeleteUser?: (id: string) => void;
  orders?: Order[];
  currentUser?: User;
}

const Settings: React.FC<SettingsProps> = ({ 
  attributes, onCreateAttribute, onDeleteAttribute, role, 
  users = [], onUpdateUser, onCreateUser, onDeleteUser, orders = [], currentUser 
}) => {
  const [activeTab, setActiveTab] = useState<'sizes' | 'colors' | 'integrations' | 'sellers' | 'users'>('users');
  const [newName, setNewName] = useState('');
  const [newColorValue, setNewColorValue] = useState('#000000');

  // Integration State
  const [apiConfig, setApiConfig] = useState<ApiConfig>({
    tiendaNube: { accessToken: '', storeId: '', userAgent: '' },
    mercadoLibre: { accessToken: '', userId: '' }
  });
  const [apiBaseUrl, setApiBaseUrl] = useState<string>(localStorage.getItem('lupo_api_base') || (import.meta.env?.VITE_API_URL as string) || 'http://localhost:3001/api');
  const [apiToken, setApiTokenState] = useState<string>(localStorage.getItem('lupo_api_token') || '');
  const [saved, setSaved] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthResult, setHealthResult] = useState<'' | 'ok' | 'error'>('');
  const [healthMessage, setHealthMessage] = useState<string>('');

  // Integration Logic
  const [integrations, setIntegrations] = useState<{ mercadolibre: boolean; tiendanube: boolean }>({ mercadolibre: false, tiendanube: false });
  const [loadingIntegrations, setLoadingIntegrations] = useState(false);

  // Mercado Libre Test Connection
  const [mlTestLoading, setMlTestLoading] = useState(false);
  const [mlTestResult, setMlTestResult] = useState<{ success: boolean; message: string; details: any } | null>(null);
  const [showMlTestModal, setShowMlTestModal] = useState(false);

  // Mercado Libre Sync
  const [mlSyncLoading, setMlSyncLoading] = useState(false);
  const [mlSyncResult, setMlSyncResult] = useState<{ message: string; linkedVariants: number; linkedProducts?: number; notFound?: number; totalItems?: number; logs: string[] } | null>(null);
  const [showMlSyncModal, setShowMlSyncModal] = useState(false);

  const [loadingSync, setLoadingSync] = useState(false);
  const [syncLogs, setSyncLogs] = useState<string[]>([]);
  const [syncCompleted, setSyncCompleted] = useState(false);
  const [syncStats, setSyncStats] = useState({ imported: 0, updated: 0 });
  const [loadingNormalizeSizes, setLoadingNormalizeSizes] = useState(false);
  const [showNormalizeSizesModal, setShowNormalizeSizesModal] = useState(false);
  const [normalizeSizesResult, setNormalizeSizesResult] = useState<{ updatedVariants: number; skippedProducts: number; logs: string[] } | null>(null);
  const groupedLogs = React.useMemo(() => {
    const groups: { product: string; variants: string[]; errors: string[] }[] = [];
    let current: { product: string; variants: string[]; errors: string[] } | null = null;
    for (const line of syncLogs) {
      const trimmed = line.trim();
      if (line.startsWith('[Sync] Processing Product:')) {
        const namePart = line.split('[Sync] Processing Product:')[1] || '';
        const productName = namePart.split('(ID:')[0].trim();
        if (current) groups.push(current);
        current = { product: productName || line, variants: [], errors: [] };
      } else if (trimmed.startsWith('[Variant]')) {
        if (!current) current = { product: 'Producto', variants: [], errors: [] };
        current.variants.push(trimmed);
      } else if (line.includes('[ERROR]')) {
        if (!current) current = { product: 'Producto', variants: [], errors: [] };
        current.errors.push(line);
      } else {
        if (!current) current = { product: 'Producto', variants: [], errors: [] };
        current.variants.push(line);
      }
    }
    if (current) groups.push(current);
    return groups;
  }, [syncLogs]);

  // Modals State
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteStep, setDeleteStep] = useState(1); // 1: Warning, 2: Confirmation

  // Stock Sync State
  const [tnStockSyncLoading, setTnStockSyncLoading] = useState(false);
  const [mlStockSyncLoading, setMlStockSyncLoading] = useState(false);
  const [stockSyncResult, setStockSyncResult] = useState<{ platform: string; updated: number; errors: number; logs: string[] } | null>(null);
  const [showStockSyncModal, setShowStockSyncModal] = useState(false);

  useEffect(() => {
    // Check for status params
    const hash = window.location.hash;
    if (hash.includes('status=success')) {
       setSaved(true);
       setTimeout(() => setSaved(false), 3000);
    }
    
    // Fetch integration status
    const fetchStatus = async () => {
      setLoadingIntegrations(true);
      try {
        const status = await api.getIntegrationStatus();
        setIntegrations(status);
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingIntegrations(false);
      }
    };
    fetchStatus();
  }, []);

  const handleConnect = async (platform: 'mercadolibre' | 'tiendanube') => {
    try {
      const { url } = await api.getAuthUrl(platform);
      if (url) {
        window.location.href = url;
      } else {
        alert('No se pudo obtener la URL de autenticación');
      }
    } catch (e) {
      alert('Error iniciando conexión');
    }
  };
  
  const handleSyncMercadoLibre = async () => {
    setShowMlSyncModal(true);
    setMlSyncLoading(true);
    setMlSyncResult(null);
    try {
      const res = await api.syncProductsFromMercadoLibre();
      setMlSyncResult(res);
    } catch (e: any) {
      setMlSyncResult({ message: 'Error sincronizando', linkedVariants: 0, logs: [e.message || 'Error desconocido'] });
    } finally {
      setMlSyncLoading(false);
    }
  };

  const handleDisconnect = async (platform: 'mercadolibre' | 'tiendanube') => {
    try {
      await api.disconnectIntegration(platform);
      setIntegrations(prev => ({ ...prev, [platform]: false }));
    } catch {
      alert('Error desconectando');
    }
  };

  const handleTestMercadoLibre = async () => {
    setShowMlTestModal(true);
    setMlTestLoading(true);
    setMlTestResult(null);
    try {
      const res = await api.testMercadoLibreConnection();
      setMlTestResult(res);
    } catch (e: any) {
      setMlTestResult({ success: false, message: 'Error de conexión', details: e.message });
    } finally {
      setMlTestLoading(false);
    }
  };

  // Sincronizar stock a Tienda Nube
  const handleSyncStockToTiendaNube = async () => {
    setShowStockSyncModal(true);
    setTnStockSyncLoading(true);
    setStockSyncResult(null);
    try {
      const res = await api.syncStockToTiendaNube();
      setStockSyncResult({ platform: 'Tienda Nube', updated: res.updated, errors: res.errors, logs: res.logs });
    } catch (e: any) {
      setStockSyncResult({ platform: 'Tienda Nube', updated: 0, errors: 1, logs: [e.message || 'Error desconocido'] });
    } finally {
      setTnStockSyncLoading(false);
    }
  };

  // Sincronizar stock a Mercado Libre
  const handleSyncStockToMercadoLibre = async () => {
    setShowStockSyncModal(true);
    setMlStockSyncLoading(true);
    setStockSyncResult(null);
    try {
      const res = await api.syncStockToMercadoLibre();
      setStockSyncResult({ platform: 'Mercado Libre', updated: res.updated, errors: res.errors, logs: res.logs });
    } catch (e: any) {
      setStockSyncResult({ platform: 'Mercado Libre', updated: 0, errors: 1, logs: [e.message || 'Error desconocido'] });
    } finally {
      setMlStockSyncLoading(false);
    }
  };

  const handleNormalizeSizesTiendaNube = async () => {
    setShowNormalizeSizesModal(true);
    setLoadingNormalizeSizes(true);
    setNormalizeSizesResult(null);
    try {
      const res = await api.normalizeSizesInTiendaNube();
      setNormalizeSizesResult({ updatedVariants: res.updatedVariants, skippedProducts: res.skippedProducts, logs: res.logs || [] });
    } catch (e) {
      console.error(e);
      setNormalizeSizesResult({ updatedVariants: 0, skippedProducts: 0, logs: ['Error al conectar con el servidor.'] });
    } finally {
      setLoadingNormalizeSizes(false);
    }
  };

  const handleSyncTiendaNube = async () => {
    // This is now triggered from the modal
    setLoadingSync(true);
    setSyncLogs([]);
    setSyncCompleted(false);
    try {
      const res = await api.syncProductsFromTiendaNube();
      if (res.logs) {
        setSyncLogs(res.logs);
      }
      setSyncStats({ imported: res.imported, updated: res.updated });
      setSyncCompleted(true);
    } catch (e: any) {
      setSyncLogs(prev => [...prev, `ERROR: ${e.message || 'Error desconocido'}`]);
    } finally {
      setLoadingSync(false);
    }
  };

  const handleDeleteAllProducts = async () => {
    setLoadingSync(true);
    try {
      await api.deleteAllProducts();
      setShowDeleteModal(false);
      window.location.reload(); // Reload to refresh state
    } catch (e: any) {
      alert('Error eliminando productos: ' + (e.message || 'Error desconocido'));
    } finally {
      setLoadingSync(false);
    }
  };

  // User Creation State
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPass, setNewUserPass] = useState('');
  const [newUserRole, setNewUserRole] = useState<Role>(Role.SELLER);

  useEffect(() => {
    const config = getApiConfig();
    setApiConfig(config);
  }, []);

  if (role !== Role.ADMIN) {
    return (
      <div className="p-12 text-center text-slate-400">
        No tienes permisos para acceder a esta sección.
      </div>
    );
  }

  const sizes = attributes.filter(a => a.type === 'size');
  const colors = attributes.filter(a => a.type === 'color');
  const sellers = users.filter(u => u.role === Role.SELLER);

  const handleCreateAttribute = () => {
    if (!newName) return;
    const newAttr: Attribute = {
      id: `attr-${Date.now()}`,
      type: activeTab === 'sizes' ? 'size' : 'color',
      name: newName,
      value: activeTab === 'colors' ? newColorValue : undefined
    };
    onCreateAttribute(newAttr);
    setNewName('');
    setNewColorValue('#000000');
  };

  const handleSaveConfig = () => {
    saveApiConfig(apiConfig);
    // Apply internal API settings (base URL + token) to http client
    try {
      setBaseUrl(apiBaseUrl);
      setAuthToken(apiToken || null);
    } catch (err) {
      console.error('Error applying HTTP client settings', err);
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const updateCommission = (userId: string, value: string) => {
    const user = users.find(u => u.id === userId);
    if (user && onUpdateUser) {
      onUpdateUser({
        ...user,
        commissionPercentage: parseFloat(value) || 0
      });
    }
  };

  const handleCreateUser = () => {
    if (!newUserName || !newUserEmail || !newUserPass || !onCreateUser) return;
    
    const newUser: User = {
      id: `u-${Date.now()}`,
      name: newUserName,
      email: newUserEmail,
      role: newUserRole,
      password: newUserPass,
      commissionPercentage: 0
    };

    onCreateUser(newUser);
    
    // Reset Form
    setNewUserName('');
    setNewUserEmail('');
    setNewUserPass('');
    setNewUserRole(Role.SELLER);
  };

  const handleCheckHealth = async () => {
    setHealthLoading(true);
    setHealthResult('');
    setHealthMessage('');
    try {
      const base = apiBaseUrl.replace(/\/api\/?$/, '');
      const res = await request(`${base}/health`, 'GET');
      setHealthResult('ok');
      setHealthMessage(typeof res === 'string' ? res : JSON.stringify(res));
    } catch (err: any) {
      setHealthResult('error');
      setHealthMessage(err?.message || 'Error de conexión');
    } finally {
      setHealthLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      <div>
         <h2 className="text-2xl font-bold text-white">Configuración</h2>
         <p className="text-slate-400 text-sm">Administración central de LUPO Hub Argentina.</p>
      </div>

      <div className="flex space-x-2 border-b border-slate-700 overflow-x-auto scrollbar-hide">
        <button
          onClick={() => setActiveTab('users')}
          className={`pb-3 px-4 text-xs font-bold transition-all border-b-2 whitespace-nowrap ${
            activeTab === 'users' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-500'
          }`}
        >
          USUARIOS DEL SISTEMA
        </button>
        <button
          onClick={() => setActiveTab('sellers')}
          className={`pb-3 px-4 text-xs font-bold transition-all border-b-2 whitespace-nowrap ${
            activeTab === 'sellers' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-500'
          }`}
        >
          COMISIONES
        </button>
        <button
          onClick={() => setActiveTab('integrations')}
          className={`pb-3 px-4 text-xs font-bold transition-all border-b-2 whitespace-nowrap ${
            activeTab === 'integrations' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-500'
          }`}
        >
          CONECTIVIDAD APIs
        </button>
        <button
          onClick={() => setActiveTab('sizes')}
          className={`pb-3 px-4 text-xs font-bold transition-all border-b-2 whitespace-nowrap ${
            activeTab === 'sizes' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-500'
          }`}
        >
          TALLES
        </button>
        <button
          onClick={() => setActiveTab('colors')}
          className={`pb-3 px-4 text-xs font-bold transition-all border-b-2 whitespace-nowrap ${
            activeTab === 'colors' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-500'
          }`}
        >
          COLORES
        </button>
      </div>

      {/* USER MANAGEMENT TAB */}
      {activeTab === 'users' && (
        <div className="space-y-8">
           {/* CREATE USER FORM */}
           <div className="bg-slate-800 rounded-3xl border border-slate-700 p-6 shadow-xl">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Plus className="bg-blue-600 rounded p-0.5 text-white" size={20} />
                Alta de Nuevo Usuario
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                 <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Nombre Completo</label>
                    <div className="relative">
                      <UserIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
                      <input 
                        type="text" 
                        value={newUserName}
                        onChange={(e) => setNewUserName(e.target.value)}
                        placeholder="Ej: Juan Perez"
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl py-3 pl-9 pr-4 text-white text-sm outline-none focus:border-blue-500"
                        autoComplete="name"
                      />
                    </div>
                 </div>
                 <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Email (Usuario)</label>
                    <div className="relative">
                      <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
                      <input 
                        type="email" 
                        value={newUserEmail}
                        onChange={(e) => setNewUserEmail(e.target.value)}
                        placeholder="usuario@lupo.ar"
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl py-3 pl-9 pr-4 text-white text-sm outline-none focus:border-blue-500"
                        autoComplete="email"
                      />
                    </div>
                 </div>
                 <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Rol</label>
                    <div className="relative">
                      <Shield size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
                      <select
                        value={newUserRole}
                        onChange={(e) => setNewUserRole(e.target.value as Role)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl py-3 pl-9 pr-4 text-white text-sm outline-none focus:border-blue-500 appearance-none cursor-pointer"
                      >
                         <option value={Role.SELLER}>Vendedor</option>
                         <option value={Role.WAREHOUSE}>Depósito</option>
                         <option value={Role.ADMIN}>Administrador</option>
                      </select>
                    </div>
                 </div>
                 <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Contraseña</label>
                    <div className="relative flex items-center gap-2">
                      <div className="relative flex-1">
                         <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
                         <input 
                           type="password" 
                           value={newUserPass}
                           onChange={(e) => setNewUserPass(e.target.value)}
                           placeholder="••••••"
                           className="w-full bg-slate-900 border border-slate-700 rounded-xl py-3 pl-9 pr-4 text-white text-sm outline-none focus:border-blue-500"
                           autoComplete="new-password"
                         />
                      </div>
                      <button 
                        onClick={handleCreateUser}
                        disabled={!newUserName || !newUserEmail || !newUserPass}
                        className="bg-blue-600 hover:bg-blue-500 text-white p-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                      >
                         <Save size={20} />
                      </button>
                    </div>
                 </div>
              </div>
           </div>

           {/* USER LIST */}
           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {users.map(u => (
                 <div key={u.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between group hover:border-slate-600 transition-colors">
                    <div className="flex items-center gap-4">
                       <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-xl ${
                          u.role === Role.ADMIN ? 'bg-purple-600' : u.role === Role.WAREHOUSE ? 'bg-orange-600' : 'bg-blue-600'
                       }`}>
                          {u.name.charAt(0)}
                       </div>
                       <div>
                          <h4 className="font-bold text-white">{u.name} {currentUser?.id === u.id && <span className="text-slate-500 text-xs">(Tú)</span>}</h4>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                             <span>{u.email}</span>
                             <span className="w-1 h-1 rounded-full bg-slate-600"></span>
                             <span className="uppercase font-bold tracking-wider">{u.role}</span>
                          </div>
                          {u.password && (
                             <div className="mt-1 text-[10px] text-slate-600 font-mono bg-slate-950 inline-block px-2 py-0.5 rounded border border-slate-800">
                                Pass: {u.password}
                             </div>
                          )}
                       </div>
                    </div>
                    {currentUser?.id !== u.id && (
                       <button 
                         onClick={() => onDeleteUser && onDeleteUser(u.id)}
                         className="p-2 text-slate-600 hover:text-red-400 hover:bg-red-900/10 rounded-lg transition-all"
                         title="Eliminar usuario"
                       >
                          <Trash2 size={18} />
                       </button>
                    )}
                 </div>
              ))}
           </div>
        </div>
      )}

      {activeTab === 'sellers' && (
        <div className="space-y-4">
           {sellers.map(seller => {
             const sellerSales = orders
               .filter(o => o.sellerId === seller.id)
               .reduce((sum, o) => sum + o.total, 0);
             const commissionRate = seller.commissionPercentage || 0;
             const commissionAmount = sellerSales * (commissionRate / 100);

             return (
               <div key={seller.id} className="bg-slate-800 rounded-3xl border border-slate-700 p-5 md:p-6 shadow-lg flex flex-col gap-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                       <div className="w-14 h-14 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl flex items-center justify-center text-white shadow-xl rotate-3">
                          <UserIcon size={28} />
                       </div>
                       <div>
                          <h4 className="font-black text-white text-xl tracking-tight">{seller.name}</h4>
                          <p className="text-xs text-slate-500 font-medium">{seller.email}</p>
                       </div>
                    </div>
                    <div className="bg-slate-900/50 px-3 py-1.5 rounded-xl border border-slate-700 flex flex-col items-end">
                       <span className="text-[8px] font-black text-slate-500 uppercase">Estado</span>
                       <span className="text-[10px] font-bold text-green-400 flex items-center gap-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div> ACTIVO
                       </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
                     <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/50">
                        <p className="text-[10px] font-black text-slate-500 uppercase mb-1 flex items-center gap-1"><DollarSign size={10}/> Ventas Totales</p>
                        <p className="text-lg font-black text-white">${sellerSales.toLocaleString()}</p>
                     </div>
                     
                     <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/50">
                        <p className="text-[10px] font-black text-slate-500 uppercase mb-1 flex items-center gap-1"><Percent size={10} /> Tasa Comisión</p>
                        <div className="flex items-center gap-2">
                          <input 
                            type="number" 
                            step="0.1"
                            value={commissionRate}
                            onChange={(e) => updateCommission(seller.id, e.target.value)}
                            className="w-16 bg-slate-800 border border-slate-600 rounded-lg p-1 text-center text-white font-black text-md focus:ring-2 focus:ring-blue-500 outline-none"
                          />
                          <span className="text-slate-400 font-bold">%</span>
                        </div>
                     </div>

                     <div className="bg-indigo-900/20 p-4 rounded-2xl border border-indigo-800/50">
                        <p className="text-[10px] font-black text-indigo-400 uppercase mb-1 flex items-center gap-1"><TrendingUp size={10}/> Ganancia Vendedor</p>
                        <p className="text-lg font-black text-indigo-300">${commissionAmount.toLocaleString()}</p>
                     </div>
                  </div>
               </div>
             );
           })}
        </div>
      )}

      {activeTab === 'integrations' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Tienda Nube */}
          <div className="bg-slate-800 rounded-3xl border border-slate-700 overflow-hidden shadow-xl">
             <div className="p-6 bg-slate-900/50 border-b border-slate-700 flex justify-between items-center">
                <div className="flex items-center gap-3">
                   <div className="bg-blue-600/20 p-2.5 rounded-2xl text-blue-400"><Cloud size={24} /></div>
                   <h3 className="font-black text-white text-lg">Tienda Nube</h3>
                </div>
                {integrations.tiendanube ? (
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-xs font-bold border border-green-500/50 flex items-center gap-2">
                      <Check size={12} /> CONECTADO
                    </span>
                    <button 
                      onClick={() => handleDisconnect('tiendanube')}
                      className="px-3 py-1 bg-red-600/80 hover:bg-red-600 rounded-xl text-white text-xs font-bold"
                    >
                      Desconectar
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={() => handleConnect('tiendanube')}
                    disabled={loadingIntegrations}
                    className="px-4 py-2 bg-blue-600 rounded-xl text-white text-xs font-bold shadow-lg active:scale-95 transition-all hover:bg-blue-500 uppercase tracking-wide disabled:opacity-50"
                  >
                    {loadingIntegrations ? '...' : 'Conectar'}
                  </button>
                )}
             </div>
             <div className="p-6 space-y-5">
                <p className="text-slate-400 text-sm">
                  Vincula tu tienda de Tienda Nube para sincronizar automáticamente productos y stock.
                </p>
                {integrations.tiendanube && (
                  <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/50 flex flex-col gap-4">
                    <div className="flex flex-wrap justify-between items-center gap-2">
                      <div>
                        <p className="text-xs text-slate-500">Estado de sincronización</p>
                        <p className="text-white font-bold">Activo</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button 
                          onClick={() => setShowSyncModal(true)}
                          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2"
                        >
                          <RefreshCw size={14} />
                          IMPORTAR PRODUCTOS
                        </button>
                        <button 
                          onClick={handleSyncStockToTiendaNube}
                          disabled={tnStockSyncLoading}
                          className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
                          title="Sincronizar stock local a Tienda Nube"
                        >
                          {tnStockSyncLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                          SINCRONIZAR STOCK
                        </button>
                        <button 
                          onClick={handleNormalizeSizesTiendaNube}
                          disabled={loadingNormalizeSizes}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
                          title="Convertir todos los talles en Tienda Nube a P, M, G, GG, XG, XXG, XXXG"
                        >
                          {loadingNormalizeSizes ? <Loader2 size={14} className="animate-spin" /> : <Tag size={14} />}
                          NORMALIZAR TALLES
                        </button>
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-500">
                      Sincronizar stock: envía el stock local a Tienda Nube. Normalizar talles: convierte a P, M, G, GG, XG, XXG, XXXG.</p>
                  </div>
                )}
             </div>
          </div>

          {/* Mercado Libre */}
          <div className="bg-slate-800 rounded-3xl border border-slate-700 overflow-hidden shadow-xl">
             <div className="p-6 bg-slate-900/50 border-b border-slate-700 flex justify-between items-center">
                <div className="flex items-center gap-3">
                   <div className="bg-yellow-600/20 p-2.5 rounded-2xl text-yellow-500"><Zap size={24} /></div>
                   <h3 className="font-black text-white text-lg">Mercado Libre</h3>
                </div>
                {integrations.mercadolibre ? (
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-xs font-bold border border-green-500/50 flex items-center gap-2">
                      <Check size={12} /> CONECTADO
                    </span>
                    <button 
                      onClick={() => handleDisconnect('mercadolibre')}
                      className="px-3 py-1 bg-red-600/80 hover:bg-red-600 rounded-xl text-white text-xs font-bold"
                    >
                      Desconectar
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={() => handleConnect('mercadolibre')}
                    disabled={loadingIntegrations}
                    className="px-4 py-2 bg-yellow-600 rounded-xl text-white text-xs font-bold shadow-lg active:scale-95 transition-all hover:bg-yellow-500 uppercase tracking-wide disabled:opacity-50"
                  >
                    {loadingIntegrations ? '...' : 'Conectar'}
                  </button>
                )}
             </div>
             <div className="p-6 space-y-5">
                <p className="text-slate-400 text-sm">
                  Conecta tu cuenta de Mercado Libre para mantener el stock y precios actualizados en tiempo real.
                </p>
                 {integrations.mercadolibre && (
                  <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/50 flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-slate-500">Estado de sincronización</p>
                        <p className="text-white font-bold">Activo</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button 
                          onClick={handleTestMercadoLibre}
                          disabled={mlTestLoading}
                          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
                        >
                          {mlTestLoading ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                          PROBAR CONEXIÓN
                        </button>
                        <button 
                          onClick={handleSyncMercadoLibre}
                          className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2"
                        >
                          <RefreshCw size={14} />
                          VINCULAR PRODUCTOS
                        </button>
                        <button 
                          onClick={handleSyncStockToMercadoLibre}
                          disabled={mlStockSyncLoading}
                          className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
                        >
                          {mlStockSyncLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                          SINCRONIZAR STOCK
                        </button>
                      </div>
                    </div>
                  </div>
                )}
             </div>
          </div>

           {/* API Interna */}
           <div className="bg-slate-800 rounded-3xl border border-slate-700 overflow-hidden shadow-xl lg:col-span-2">
              <div className="p-6 bg-slate-900/50 border-b border-slate-700 flex justify-between items-center">
               <div className="flex items-center gap-3">
                 <div className="bg-indigo-600/20 p-2.5 rounded-2xl text-indigo-400"><Link size={24} /></div>
                 <h3 className="font-black text-white text-lg">API Interna (LupoHub)</h3>
               </div>
               <div className="flex items-center gap-2">
                 <button onClick={handleCheckHealth} className="p-2.5 bg-slate-700 rounded-xl text-white shadow-lg active:scale-95 transition-all hover:bg-slate-600">
                   {healthLoading ? <Loader2 size={20} className="animate-spin" /> : <RefreshCw size={20} />}
                 </button>
                 <button onClick={handleSaveConfig} className="p-2.5 bg-indigo-600 rounded-xl text-white shadow-lg active:scale-95 transition-all hover:bg-indigo-500"><Save size={20}/></button>
               </div>
             </div>
             <div className="p-6 space-y-5">
               <div className="bg-red-900/20 p-4 rounded-xl border border-red-800/50 flex justify-between items-center">
                 <div>
                   <p className="text-xs text-red-400 font-bold uppercase mb-1">Zona de Peligro</p>
                   <p className="text-xs text-slate-400">Eliminar todo el inventario y stock.</p>
                 </div>
                 <button 
                   onClick={() => { setShowDeleteModal(true); setDeleteStep(1); }}
                   className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2"
                 >
                   <Trash2 size={14} />
                   ELIMINAR TODO
                 </button>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <div className="space-y-2">
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">Base URL</label>
                   <input 
                     type="text" 
                     value={apiBaseUrl}
                     onChange={(e) => setApiBaseUrl(e.target.value)}
                     className="w-full bg-slate-900 border border-slate-700 rounded-xl p-4 text-sm focus:ring-2 focus:ring-blue-500 outline-none text-white font-mono"
                   />
                 </div>
                 <div className="space-y-2">
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">API Token (Bearer)</label>
                   <input 
                     type="password" 
                     value={apiToken}
                     onChange={(e) => setApiTokenState(e.target.value)}
                     className="w-full bg-slate-900 border border-slate-700 rounded-xl p-4 text-sm focus:ring-2 focus:ring-blue-500 outline-none text-white font-mono"
                   />
                 </div>
               </div>
               <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 flex items-center justify-between">
                 <div className="flex items-center gap-3">
                   <span className="text-[10px] font-black text-slate-500 uppercase">Estado de conexión</span>
                   {healthLoading && <Loader2 size={16} className="text-slate-400 animate-spin" />}
                   {!healthLoading && healthResult === 'ok' && <span className="text-[10px] font-bold text-green-400 flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-green-500"></div> OK</span>}
                   {!healthLoading && healthResult === 'error' && <span className="text-[10px] font-bold text-red-400 flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-red-500"></div> ERROR</span>}
                 </div>
                 <span className="text-[10px] text-slate-400 truncate max-w-[50%]">{healthMessage}</span>
               </div>
             </div>
           </div>
        </div>
      )}

      {(activeTab === 'sizes' || activeTab === 'colors') && (
        <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
          <div className="flex flex-col md:flex-row gap-4 mb-8 items-end">
            <div className="flex-1 w-full">
              <label className="block text-xs font-black text-slate-500 uppercase mb-2">Nombre del {activeTab === 'sizes' ? 'Talle' : 'Color'}</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ej: XXL o Turquesa"
                className="w-full bg-slate-900 border border-slate-700 rounded-xl p-4 text-white placeholder-slate-600 focus:ring-2 focus:ring-blue-500 outline-none font-bold"
              />
            </div>
            {activeTab === 'colors' && (
              <div className="flex flex-col gap-2">
                 <label className="block text-xs font-black text-slate-500 uppercase">Selector</label>
                 <input type="color" value={newColorValue} onChange={(e) => setNewColorValue(e.target.value)} className="h-14 w-20 bg-slate-900 border border-slate-700 rounded-xl p-1 cursor-pointer" />
              </div>
            )}
            <button onClick={handleCreateAttribute} className="bg-blue-600 text-white h-14 px-8 rounded-xl font-black flex items-center gap-2 active:scale-95 transition-all shadow-lg shadow-blue-900/40 uppercase text-xs tracking-widest"><Plus size={20}/> Agregar</button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
             {(activeTab === 'sizes' ? sizes : colors).map(attr => {
               const displayName = attr.name || (attr as any).code || 'Sin nombre';
               const code = (attr as any).code;
               return (
                 <div key={attr.id} className="bg-slate-900 p-4 rounded-2xl border border-slate-800 flex items-center justify-between group hover:border-slate-600 transition-colors">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {attr.type === 'color' && <div className="w-5 h-5 rounded-full border border-white/10 shadow-sm shrink-0" style={{background: attr.value || '#000'}} />}
                      <span className="text-sm font-black text-slate-200 tracking-tight truncate" title={displayName}>
                        {displayName}
                      </span>
                    </div>
                    <button onClick={() => onDeleteAttribute(attr.id)} className="text-slate-600 hover:text-red-400 transition-colors p-1 shrink-0"><Trash2 size={16}/></button>
                 </div>
               );
             })}
          </div>
        </div>
      )}

      {/* Sync Modal */}
      <Modal 
        isOpen={showSyncModal} 
        onClose={() => { if (!loadingSync) setShowSyncModal(false); }} 
        title={syncCompleted ? "¡Sincronización Exitosa!" : "Sincronizar Tienda Nube"}
        footer={
           !loadingSync && !syncCompleted ? (
             <button onClick={handleSyncTiendaNube} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-bold text-sm w-full">
               Comenzar Importación
             </button>
           ) : syncCompleted ? (
              <button onClick={() => setShowSyncModal(false)} className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg font-bold text-sm w-full">
                Finalizar
              </button>
           ) : null
        }
      >
        <div className="space-y-4">
          {!syncCompleted ? (
             <>
                <p className="text-slate-300 text-sm">
                   Esta acción descargará todos los productos y variantes de Tienda Nube y actualizará la base de datos local.
                </p>
                <div className="bg-yellow-900/20 p-3 rounded-lg border border-yellow-800/30 flex items-start gap-2">
                  <AlertTriangle className="text-yellow-500 shrink-0 mt-0.5" size={16} />
                  <p className="text-xs text-yellow-200/80">
                     Si ya existen productos, se actualizarán sus precios y stock. Asegúrate de haber eliminado datos antiguos si quieres una importación limpia.
                  </p>
                </div>
             </>
          ) : (
             <div className="bg-green-900/20 p-4 rounded-xl border border-green-800/30 flex flex-col items-center text-center gap-2">
                <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center text-white mb-2 shadow-lg shadow-green-900/50">
                   <Check size={24} strokeWidth={3} />
                </div>
                <h4 className="text-white font-bold text-lg">Proceso Completado</h4>
                <div className="flex gap-4 mt-2">
                   <div className="bg-slate-900/50 p-2 rounded-lg border border-slate-700/50 min-w-[80px]">
                      <p className="text-[10px] text-slate-400 uppercase font-black">Importados</p>
                      <p className="text-xl font-black text-white">{syncStats.imported}</p>
                   </div>
                   <div className="bg-slate-900/50 p-2 rounded-lg border border-slate-700/50 min-w-[80px]">
                      <p className="text-[10px] text-slate-400 uppercase font-black">Actualizados</p>
                      <p className="text-xl font-black text-white">{syncStats.updated}</p>
                   </div>
                </div>
             </div>
          )}
          
          {loadingSync && (
             <div className="py-4 flex flex-col items-center justify-center gap-3">
                <Loader2 className="animate-spin text-blue-500" size={32} />
                <p className="text-sm text-blue-400 font-bold animate-pulse">Sincronizando productos...</p>
             </div>
          )}

          {groupedLogs.length > 0 && (
            <div className="mt-2 bg-black/80 p-3 rounded-lg border border-slate-800 h-64 overflow-y-auto font-mono text-[10px] shadow-inner">
              {groupedLogs.map((g, idx) => (
                <div key={idx} className="mb-2">
                  <div className="text-green-400 font-bold">{g.product}</div>
                  <div className="mt-1 pl-2 border-l border-slate-700 space-y-0.5">
                    {g.variants.map((v, i) => (
                      <div key={i} className="text-green-300">{v}</div>
                    ))}
                    {g.errors.map((e, i) => (
                      <div key={`e-${i}`} className="text-red-400">{e}</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* Normalize sizes modal */}
      <Modal
        isOpen={showNormalizeSizesModal}
        onClose={() => setShowNormalizeSizesModal(false)}
        title="Normalizar talles en Tienda Nube"
        footer={
          <button onClick={() => setShowNormalizeSizesModal(false)} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-bold text-sm">
            Cerrar
          </button>
        }
      >
        <div className="space-y-4">
          {normalizeSizesResult && (
            <>
              <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex gap-4">
                <div className="flex-1">
                  <p className="text-[10px] text-slate-500 uppercase font-black">Variantes actualizadas</p>
                  <p className="text-xl font-black text-green-400">{normalizeSizesResult.updatedVariants}</p>
                </div>
                <div className="flex-1">
                  <p className="text-[10px] text-slate-500 uppercase font-black">Productos sin atributo Talle</p>
                  <p className="text-xl font-black text-slate-400">{normalizeSizesResult.skippedProducts}</p>
                </div>
              </div>
              <p className="text-xs text-slate-400">
                Los talles en Tienda Nube se convirtieron a: P, M, G, GG, XG, XXG, XXXG (y U para único). Volvé a &quot;Importar productos&quot; para reflejar los cambios en LupoHub.
              </p>
              {normalizeSizesResult.logs.length > 0 && (
                <div className="bg-black/80 p-3 rounded-lg border border-slate-800 h-48 overflow-y-auto font-mono text-[10px]">
                  {normalizeSizesResult.logs.slice(-50).map((line, i) => (
                    <div key={i} className={line.includes('[ERROR]') ? 'text-red-400' : 'text-green-300'}>{line}</div>
                  ))}
                </div>
              )}
            </>
          )}
          {loadingNormalizeSizes && (
            <div className="py-6 flex flex-col items-center gap-3">
              <Loader2 className="animate-spin text-blue-500" size={32} />
              <p className="text-sm text-blue-400 font-bold">Actualizando talles en Tienda Nube...</p>
            </div>
          )}
        </div>
      </Modal>

      {/* Mercado Libre Test Modal */}
      <Modal
        isOpen={showMlTestModal}
        onClose={() => setShowMlTestModal(false)}
        title="Prueba de Conexión - Mercado Libre"
        footer={
          <button onClick={() => setShowMlTestModal(false)} className="bg-yellow-600 hover:bg-yellow-500 text-white px-4 py-2 rounded-lg font-bold text-sm w-full">
            Cerrar
          </button>
        }
      >
        <div className="space-y-4">
          {mlTestLoading && (
            <div className="py-6 flex flex-col items-center gap-3">
              <Loader2 className="animate-spin text-yellow-500" size={32} />
              <p className="text-sm text-yellow-400 font-bold">Probando conexión con Mercado Libre...</p>
            </div>
          )}
          {mlTestResult && !mlTestLoading && (
            <>
              <div className={`p-4 rounded-xl border flex items-center gap-3 ${mlTestResult.success ? 'bg-green-900/20 border-green-800/50' : 'bg-red-900/20 border-red-800/50'}`}>
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${mlTestResult.success ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
                  {mlTestResult.success ? <Check size={24} strokeWidth={3} /> : <AlertCircle size={24} />}
                </div>
                <div>
                  <p className={`font-bold ${mlTestResult.success ? 'text-green-400' : 'text-red-400'}`}>{mlTestResult.message}</p>
                  {!mlTestResult.success && mlTestResult.details && typeof mlTestResult.details === 'string' && (
                    <p className="text-xs text-slate-400 mt-1">{mlTestResult.details}</p>
                  )}
                </div>
              </div>
              {mlTestResult.success && mlTestResult.details && typeof mlTestResult.details === 'object' && (
                <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-black">Usuario</p>
                      <p className="text-white font-bold">{mlTestResult.details.nickname || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-black">User ID</p>
                      <p className="text-white font-mono text-sm">{mlTestResult.details.userId || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-black">Email</p>
                      <p className="text-white text-sm truncate">{mlTestResult.details.email || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-black">País</p>
                      <p className="text-white font-bold">{mlTestResult.details.country || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-black">Publicaciones</p>
                      <p className="text-yellow-400 font-black text-xl">{mlTestResult.details.totalItems || 0}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-black">Token Expira</p>
                      <p className="text-white text-xs">{mlTestResult.details.expiresAt || 'N/A'}</p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>

      {/* Mercado Libre Sync Modal */}
      <Modal
        isOpen={showMlSyncModal}
        onClose={() => { if (!mlSyncLoading) setShowMlSyncModal(false); }}
        title="Sincronización Mercado Libre"
        footer={
          !mlSyncLoading && (
            <button onClick={() => setShowMlSyncModal(false)} className="bg-yellow-600 hover:bg-yellow-500 text-white px-4 py-2 rounded-lg font-bold text-sm w-full">
              Cerrar
            </button>
          )
        }
      >
        <div className="space-y-4">
          {mlSyncLoading && (
            <div className="py-6 flex flex-col items-center gap-3">
              <Loader2 className="animate-spin text-yellow-500" size={32} />
              <p className="text-sm text-yellow-400 font-bold">Sincronizando con Mercado Libre...</p>
              <p className="text-xs text-slate-500">Esto puede tomar unos segundos</p>
            </div>
          )}
          {mlSyncResult && !mlSyncLoading && (
            <>
              <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-black">Publicaciones ML</p>
                  <p className="text-xl font-black text-white">{mlSyncResult.totalItems || 0}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-black">Variantes Vinculadas</p>
                  <p className="text-xl font-black text-green-400">{mlSyncResult.linkedVariants}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-black">Productos Vinculados</p>
                  <p className="text-xl font-black text-blue-400">{mlSyncResult.linkedProducts || 0}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-black">No Encontrados</p>
                  <p className="text-xl font-black text-red-400">{mlSyncResult.notFound || 0}</p>
                </div>
              </div>
              <p className="text-xs text-slate-400">
                La vinculación se hace por SKU. Asegúrate de que los SKUs en Mercado Libre coincidan con los de Tienda Nube.
              </p>
              {mlSyncResult.logs && mlSyncResult.logs.length > 0 && (
                <div className="bg-black/80 p-3 rounded-lg border border-slate-800 h-64 overflow-y-auto font-mono text-[10px]">
                  {mlSyncResult.logs.map((line, i) => (
                    <div key={i} className={
                      line.includes('VINCULADO') ? 'text-green-400' : 
                      line.includes('NO encontrado') || line.includes('Error') ? 'text-red-400' : 
                      line.includes('[ML Item]') ? 'text-yellow-400 font-bold mt-2' :
                      line.includes('=====') ? 'text-blue-400 font-bold mt-2' :
                      'text-slate-400'
                    }>{line}</div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </Modal>

      {/* Stock Sync Modal */}
      <Modal
        isOpen={showStockSyncModal}
        onClose={() => { if (!tnStockSyncLoading && !mlStockSyncLoading) setShowStockSyncModal(false); }}
        title={`Sincronizar Stock a ${stockSyncResult?.platform || 'Plataforma'}`}
        footer={
          !tnStockSyncLoading && !mlStockSyncLoading && (
            <button onClick={() => setShowStockSyncModal(false)} className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg font-bold text-sm w-full">
              Cerrar
            </button>
          )
        }
      >
        <div className="space-y-4">
          {(tnStockSyncLoading || mlStockSyncLoading) && (
            <div className="py-6 flex flex-col items-center gap-3">
              <Loader2 className="animate-spin text-green-500" size={32} />
              <p className="text-sm text-green-400 font-bold">Sincronizando stock...</p>
              <p className="text-xs text-slate-500">Esto puede tomar unos minutos</p>
            </div>
          )}
          {stockSyncResult && !tnStockSyncLoading && !mlStockSyncLoading && (
            <>
              <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-black">Variantes Actualizadas</p>
                  <p className="text-xl font-black text-green-400">{stockSyncResult.updated}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-black">Errores</p>
                  <p className="text-xl font-black text-red-400">{stockSyncResult.errors}</p>
                </div>
              </div>
              {stockSyncResult.logs && stockSyncResult.logs.length > 0 && (
                <div className="bg-black/80 p-3 rounded-lg border border-slate-800 h-64 overflow-y-auto font-mono text-[10px]">
                  {stockSyncResult.logs.map((line, i) => (
                    <div key={i} className={
                      line.includes('[OK]') ? 'text-green-400' : 
                      line.includes('[ERROR]') ? 'text-red-400' : 
                      'text-slate-400'
                    }>{line}</div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </Modal>

      {/* Delete Modal */}
      <Modal 
        isOpen={showDeleteModal} 
        onClose={() => setShowDeleteModal(false)} 
        title="Eliminar Todo el Inventario"
        footer={
           <div className="flex gap-2 w-full">
             <button onClick={() => setShowDeleteModal(false)} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg font-bold text-sm">
               Cancelar
             </button>
             {deleteStep === 1 ? (
                <button onClick={() => setDeleteStep(2)} className="flex-1 bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg font-bold text-sm">
                  Continuar
                </button>
             ) : (
                <button onClick={handleDeleteAllProducts} disabled={loadingSync} className="flex-1 bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center justify-center gap-2">
                  {loadingSync ? <Loader2 className="animate-spin" size={16}/> : <Trash2 size={16} />}
                  CONFIRMAR ELIMINACIÓN
                </button>
             )}
           </div>
        }
      >
        <div className="space-y-4 text-center py-4">
           <div className="w-16 h-16 bg-red-900/30 rounded-full flex items-center justify-center mx-auto text-red-500 mb-2">
             <AlertTriangle size={32} />
           </div>
           {deleteStep === 1 ? (
             <>
               <h4 className="text-white font-bold text-lg">¿Estás absolutamente seguro?</h4>
               <p className="text-slate-400 text-sm">
                 Esta acción eliminará <strong>TODOS</strong> los productos, variantes, stock, colores y talles de la base de datos local.
               </p>
               <p className="text-slate-400 text-sm">
                 Esta acción <strong>NO</strong> se puede deshacer.
               </p>
             </>
           ) : (
             <>
               <h4 className="text-red-500 font-black text-lg uppercase">¡Última Advertencia!</h4>
               <p className="text-slate-300 text-sm">
                 Estás a punto de borrar todo el inventario. ¿Confirmas que quieres proceder?
               </p>
             </>
           )}
        </div>
      </Modal>

    </div>
  );
};

export default Settings;
