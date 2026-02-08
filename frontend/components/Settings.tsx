import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Tag, Palette, Cloud, Zap, RefreshCw, Link, ExternalLink, Check, AlertCircle, Loader2, Power, Save, Key, User as UserIcon, TrendingUp, Percent, DollarSign, Shield, Mail, Lock } from 'lucide-react';
import { Attribute, Role, ApiConfig, User, Order } from '../types';
import { getApiConfig, saveApiConfig } from '../services/apiIntegration';
import { setBaseUrl, setAuthToken, request } from '../services/httpClient';

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
          <div className="bg-slate-800 rounded-3xl border border-slate-700 overflow-hidden shadow-xl">
             <div className="p-6 bg-slate-900/50 border-b border-slate-700 flex justify-between items-center">
                <div className="flex items-center gap-3">
                   <div className="bg-blue-600/20 p-2.5 rounded-2xl text-blue-400"><Cloud size={24} /></div>
                   <h3 className="font-black text-white text-lg">Tienda Nube</h3>
                </div>
                <button onClick={handleSaveConfig} className="p-2.5 bg-blue-600 rounded-xl text-white shadow-lg active:scale-95 transition-all hover:bg-blue-500"><Save size={20}/></button>
             </div>
             <div className="p-6 space-y-5">
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">Store ID (Tienda)</label>
                   <input 
                      type="text" 
                      value={apiConfig.tiendaNube.storeId}
                      onChange={(e) => setApiConfig({...apiConfig, tiendaNube: {...apiConfig.tiendaNube, storeId: e.target.value}})}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl p-4 text-sm focus:ring-2 focus:ring-blue-500 outline-none text-white font-mono"
                   />
                </div>
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">API Access Token</label>
                   <input 
                      type="password" 
                      value={apiConfig.tiendaNube.accessToken}
                      onChange={(e) => setApiConfig({...apiConfig, tiendaNube: {...apiConfig.tiendaNube, accessToken: e.target.value}})}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl p-4 text-sm focus:ring-2 focus:ring-blue-500 outline-none text-white font-mono"
                   />
                </div>
             </div>
          </div>

           <div className="bg-slate-800 rounded-3xl border border-slate-700 overflow-hidden shadow-xl">
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

          <div className="bg-slate-800 rounded-3xl border border-slate-700 overflow-hidden shadow-xl">
             <div className="p-6 bg-slate-900/50 border-b border-slate-700 flex justify-between items-center">
                <div className="flex items-center gap-3">
                   <div className="bg-yellow-600/20 p-2.5 rounded-2xl text-yellow-500"><Zap size={24} /></div>
                   <h3 className="font-black text-white text-lg">Mercado Libre</h3>
                </div>
                <button onClick={handleSaveConfig} className="p-2.5 bg-yellow-600 rounded-xl text-white shadow-lg active:scale-95 transition-all hover:bg-yellow-500"><Save size={20}/></button>
             </div>
             <div className="p-6 space-y-5">
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">App User ID (Vendedor)</label>
                   <input 
                      type="text" 
                      value={apiConfig.mercadoLibre.userId}
                      onChange={(e) => setApiConfig({...apiConfig, mercadoLibre: {...apiConfig.mercadoLibre, userId: e.target.value}})}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl p-4 text-sm focus:ring-2 focus:ring-blue-500 outline-none text-white font-mono"
                   />
                </div>
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">Bearer Token</label>
                   <input 
                      type="password" 
                      value={apiConfig.mercadoLibre.accessToken}
                      onChange={(e) => setApiConfig({...apiConfig, mercadoLibre: {...apiConfig.mercadoLibre, accessToken: e.target.value}})}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl p-4 text-sm focus:ring-2 focus:ring-blue-500 outline-none text-white font-mono"
                   />
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
             {(activeTab === 'sizes' ? sizes : colors).map(attr => (
               <div key={attr.id} className="bg-slate-900 p-4 rounded-2xl border border-slate-800 flex items-center justify-between group hover:border-slate-600 transition-colors">
                  <div className="flex items-center gap-3">
                    {attr.type === 'color' && <div className="w-5 h-5 rounded-full border border-white/10 shadow-sm" style={{background: attr.value}} />}
                    <span className="text-sm font-black text-slate-200 tracking-tight">{attr.name}</span>
                  </div>
                  <button onClick={() => onDeleteAttribute(attr.id)} className="text-slate-600 hover:text-red-400 transition-colors p-1"><Trash2 size={16}/></button>
               </div>
             ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
