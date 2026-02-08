import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { DollarSign, Package, ShoppingBag, TrendingUp, AlertTriangle, Cloud, Zap, Store } from 'lucide-react';
import { Product, Order, OrderStatus, Role } from '../types';

interface DashboardProps {
  products: Product[];
  orders: Order[];
  role: Role;
}

import { getApiConfig } from '../services/apiIntegration';

import axios from 'axios';

const Dashboard: React.FC<DashboardProps> = ({ products, orders, role }) => {
  const [isOnline, setIsOnline] = React.useState(true);

  React.useEffect(() => {
    // Simple check to see if we are running on mock data or real backend
    const apiBase = localStorage.getItem('lupo_api_base') || (import.meta.env?.VITE_API_URL as string) || 'http://localhost:3010/api';
    const healthUrl = apiBase.replace(/\/api\/?$/, '') + '/health';
    
    axios.get(healthUrl)
      .then(() => setIsOnline(true))
      .catch(() => setIsOnline(false));
  }, []);

  const totalSales = orders.reduce((acc, order) => acc + order.total, 0);
  const activeOrders = orders.filter(o => o.status !== OrderStatus.DISPATCHED && o.status !== OrderStatus.DRAFT).length;
  const lowStockCount = products.filter(p => p.stock < 20).length;
  
  // Data for charts
  const salesData = [
    { name: 'Lun', ventas: 4000 },
    { name: 'Mar', ventas: 3000 },
    { name: 'Mie', ventas: 2000 },
    { name: 'Jue', ventas: 2780 },
    { name: 'Vie', ventas: 1890 },
    { name: 'Sab', ventas: 2390 },
    { name: 'Dom', ventas: 3490 },
  ];

  const categoryData = products.reduce((acc: any[], curr) => {
    const existing = acc.find(item => item.name === curr.category);
    if (existing) {
      existing.stock += curr.stock;
    } else {
      acc.push({ name: curr.category, stock: curr.stock });
    }
    return acc;
  }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-white">Panel General</h2>
        <div className="flex space-x-2">
           <span className={`px-3 py-1 ${isOnline ? 'bg-blue-900/30 text-blue-300 border-blue-800' : 'bg-red-900/30 text-red-300 border-red-800'} border rounded-full text-xs font-semibold flex items-center gap-2`}>
             <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'} animate-pulse`}></div>
             {isOnline ? 'Sistema Online' : 'Modo Offline'}
           </span>
        </div>
      </div>

      {/* Integrations Status Banner */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600/20 p-2 rounded-lg text-blue-400">
            <Cloud size={20} />
          </div>
          <div>
            <h3 className="font-bold text-white text-sm">Stock Unificado Activo</h3>
            <p className="text-xs text-slate-400">Los cambios de stock se sincronizan automáticamente.</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
             <Cloud size={14} className="text-blue-400" /> Tienda Nube
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
             <Zap size={14} className="text-yellow-400" /> Mercado Libre
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
             <Store size={14} className="text-emerald-400" /> Locales
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {role !== Role.WAREHOUSE && (
          <div className="bg-slate-800 p-6 rounded-2xl shadow-lg border border-slate-700">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-slate-400 text-sm font-medium">Ventas Totales</p>
                <h3 className="text-3xl font-bold text-white mt-2">${totalSales.toLocaleString()}</h3>
              </div>
              <div className="p-3 bg-emerald-900/30 text-emerald-400 rounded-xl border border-emerald-900/50">
                <DollarSign size={24} />
              </div>
            </div>
            <div className="mt-4 flex items-center text-sm text-emerald-400">
              <TrendingUp size={16} className="mr-1" />
              <span>+12.5% vs mes anterior</span>
            </div>
          </div>
        )}

        <div className="bg-slate-800 p-6 rounded-2xl shadow-lg border border-slate-700">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-slate-400 text-sm font-medium">Pedidos Activos</p>
              <h3 className="text-3xl font-bold text-white mt-2">{activeOrders}</h3>
            </div>
            <div className="p-3 bg-blue-900/30 text-blue-400 rounded-xl border border-blue-900/50">
              <ShoppingBag size={24} />
            </div>
          </div>
           <div className="mt-4 text-sm text-slate-500">
              En preparación o confirmados
            </div>
        </div>

        <div className="bg-slate-800 p-6 rounded-2xl shadow-lg border border-slate-700">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-slate-400 text-sm font-medium">Total Productos</p>
              <h3 className="text-3xl font-bold text-white mt-2">{products.length}</h3>
            </div>
            <div className="p-3 bg-indigo-900/30 text-indigo-400 rounded-xl border border-indigo-900/50">
              <Package size={24} />
            </div>
          </div>
           <div className="mt-4 text-sm text-slate-500">
              SKUs activos en catálogo
            </div>
        </div>

        <div className="bg-slate-800 p-6 rounded-2xl shadow-lg border border-slate-700">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-slate-400 text-sm font-medium">Stock Bajo</p>
              <h3 className="text-3xl font-bold text-red-500 mt-2">{lowStockCount}</h3>
            </div>
            <div className="p-3 bg-red-900/30 text-red-400 rounded-xl border border-red-900/50">
              <AlertTriangle size={24} />
            </div>
          </div>
           <div className="mt-4 text-sm text-red-400/80 font-medium">
              Requiere atención inmediata
            </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-800 p-6 rounded-2xl shadow-lg border border-slate-700 h-80 min-w-0">
          <h3 className="text-lg font-bold text-white mb-6">Tendencia de Ventas (Semana)</h3>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={salesData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
              <Tooltip 
                contentStyle={{backgroundColor: '#1e293b', borderRadius: '12px', border: '1px solid #334155', color: '#fff'}}
                itemStyle={{color: '#fff'}}
                cursor={{stroke: '#3b82f6', strokeWidth: 2}}
              />
              <Line type="monotone" dataKey="ventas" stroke="#3b82f6" strokeWidth={3} dot={{r: 4, strokeWidth: 2, fill: '#1e293b'}} activeDot={{r: 6}} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-slate-800 p-6 rounded-2xl shadow-lg border border-slate-700 h-80 min-w-0">
          <h3 className="text-lg font-bold text-white mb-6">Stock por Categoría</h3>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={categoryData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#334155" />
              <XAxis type="number" hide />
              <YAxis dataKey="name" type="category" width={100} axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12, fontWeight: 500}} />
              <Tooltip cursor={{fill: '#334155'}} contentStyle={{backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155', color: '#fff'}} itemStyle={{color: '#fff'}} />
              <Bar dataKey="stock" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
