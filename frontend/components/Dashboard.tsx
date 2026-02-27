import React, { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { DollarSign, Package, AlertTriangle, Cloud, Zap, ShoppingCart, RefreshCw, Loader2, Award, AlertCircle, Calendar } from 'lucide-react';
import { Product, Order, OrderStatus, Role } from '../types';
import { api } from '../services/api';

interface DashboardProps {
  products: Product[];
  orders: Order[];
  role: Role;
}

type DateRange = '7' | '15' | '30' | '60' | '90';

const Dashboard: React.FC<DashboardProps> = ({ products: propProducts, orders, role }) => {
  const [loading, setLoading] = useState(true);
  const [tnOrders, setTnOrders] = useState<any[]>([]);
  const [mlOrders, setMlOrders] = useState<any[]>([]);
  const [productCount, setProductCount] = useState(0);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>('60');

  const getDateRange = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    return {
      from: from.toISOString().split('T')[0],
      to: to.toISOString().split('T')[0]
    };
  };

  useEffect(() => {
    loadDashboardData();
  }, [dateRange]);

  const loadDashboardData = async () => {
    setLoading(true);
    const dates = getDateRange(parseInt(dateRange));
    
    try {
      // Cargar todo en paralelo para mayor velocidad
      const [productsRes, tnRes, mlRes] = await Promise.all([
        api.getProductsPaged(1, 1000).catch(() => ({ items: [], total: 0 })),
        api.getTiendaNubeOrders({ 
          per_page: 50,
          created_at_min: dates.from,
          created_at_max: dates.to
        }).catch(() => ({ orders: [], total: 0 })),
        api.getMercadoLibreOrders({ 
          limit: 50,
          date_from: dates.from,
          date_to: dates.to
        }).catch(() => ({ orders: [], total: 0 }))
      ]);

      setAllProducts(productsRes.items || []);
      setProductCount(productsRes.total || productsRes.items?.length || 0);
      setTnOrders(tnRes.orders || []);
      setMlOrders(mlRes.orders || []);

    } catch (error) {
      console.error('Error loading dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const products = allProducts.length > 0 ? allProducts : propProducts;

  // Función para parsear montos de forma segura
  const parseAmount = (value: any): number => {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return isNaN(value) ? 0 : value;
    
    // Convertir a string y limpiar
    let str = String(value);
    
    // Si tiene formato "123.45" (con punto decimal)
    // O formato "1.234,56" (europeo) o "1,234.56" (americano)
    // Detectar el formato
    const hasComma = str.includes(',');
    const hasDot = str.includes('.');
    
    if (hasComma && hasDot) {
      // Formato mixto: determinar cuál es el decimal
      const lastComma = str.lastIndexOf(',');
      const lastDot = str.lastIndexOf('.');
      if (lastComma > lastDot) {
        // Formato europeo: 1.234,56
        str = str.replace(/\./g, '').replace(',', '.');
      } else {
        // Formato americano: 1,234.56
        str = str.replace(/,/g, '');
      }
    } else if (hasComma) {
      // Solo coma: puede ser decimal europeo o separador de miles
      const parts = str.split(',');
      if (parts.length === 2 && parts[1].length <= 2) {
        // Probablemente decimal europeo
        str = str.replace(',', '.');
      } else {
        // Separador de miles
        str = str.replace(/,/g, '');
      }
    }
    
    // Remover cualquier caracter que no sea número, punto o signo negativo
    str = str.replace(/[^0-9.-]/g, '');
    
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
  };

  // Facturación
  const facturacion = useMemo(() => {
    let tnTotal = 0;
    let mlTotal = 0;
    let mayTotal = 0;

    tnOrders.forEach(o => {
      if (o.paymentStatus === 'paid') {
        tnTotal += parseAmount(o.total);
      }
    });

    mlOrders.forEach(o => {
      if (o.status === 'paid') {
        mlTotal += parseAmount(o.total);
      }
    });

    orders.forEach(o => {
      if (o.status === OrderStatus.DISPATCHED || o.status === OrderStatus.CONFIRMED) {
        mayTotal += parseAmount(o.total);
      }
    });

    return { 
      tn: Math.round(tnTotal), 
      ml: Math.round(mlTotal), 
      may: Math.round(mayTotal), 
      total: Math.round(tnTotal + mlTotal + mayTotal) 
    };
  }, [tnOrders, mlOrders, orders]);

  // Productos más vendidos
  const topProducts = useMemo(() => {
    const sales: Record<string, { name: string; qty: number; rev: number }> = {};

    tnOrders.filter(o => o.paymentStatus === 'paid').forEach(order => {
      (order.products || []).forEach((p: any) => {
        const key = p.name || p.sku || 'Producto';
        if (!sales[key]) sales[key] = { name: key, qty: 0, rev: 0 };
        sales[key].qty += p.quantity || 1;
        sales[key].rev += parseAmount(p.price) * (p.quantity || 1);
      });
    });

    mlOrders.filter(o => o.status === 'paid').forEach(order => {
      (order.items || []).forEach((item: any) => {
        const key = item.title || item.sku || 'Producto';
        if (!sales[key]) sales[key] = { name: key, qty: 0, rev: 0 };
        sales[key].qty += item.quantity || 1;
        sales[key].rev += parseAmount(item.unitPrice) * (item.quantity || 1);
      });
    });

    return Object.values(sales).sort((a, b) => b.qty - a.qty).slice(0, 10);
  }, [tnOrders, mlOrders]);

  // Stock crítico
  const lowStockProducts = useMemo(() => {
    return [...products]
      .map(p => ({
        name: p.name,
        sku: p.sku,
        stock: p.stock_total ?? p.stock ?? 0
      }))
      .sort((a, b) => a.stock - b.stock)
      .slice(0, 10);
  }, [products]);

  const outOfStock = products.filter(p => (p.stock_total ?? p.stock ?? 0) === 0).length;
  const lowStock = products.filter(p => {
    const s = p.stock_total ?? p.stock ?? 0;
    return s > 0 && s < 10;
  }).length;

  const orderCounts = {
    tn: tnOrders.filter(o => o.paymentStatus === 'paid').length,
    ml: mlOrders.filter(o => o.status === 'paid').length,
    may: orders.filter(o => o.status !== OrderStatus.DRAFT).length
  };
  orderCounts.total = orderCounts.tn + orderCounts.ml + orderCounts.may;

  const formatMoney = (n: number) => {
    if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `$${Math.round(n / 1000)}K`;
    return `$${n.toLocaleString('es-AR')}`;
  };

  const salesByChannel = [
    { name: 'Tienda Nube', value: facturacion.tn, color: '#06b6d4' },
    { name: 'Mercado Libre', value: facturacion.ml, color: '#eab308' },
    { name: 'Mayoristas', value: facturacion.may, color: '#3b82f6' }
  ].filter(d => d.value > 0);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <Loader2 className="animate-spin text-blue-500 mb-4" size={48} />
        <p className="text-slate-400">Cargando dashboard...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Dashboard</h2>
          <p className="text-slate-500 text-sm">Resumen de tu negocio</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-1">
            {(['7', '15', '30', '60', '90'] as DateRange[]).map((d) => (
              <button
                key={d}
                onClick={() => setDateRange(d)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  dateRange === d ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          <button
            onClick={loadDashboardData}
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors"
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 text-slate-500 text-sm">
        <Calendar size={16} />
        <span>Últimos <strong className="text-white">{dateRange} días</strong></span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 rounded-xl p-5 border border-emerald-500/20">
          <div className="flex items-center justify-between mb-3">
            <span className="text-emerald-400 text-xs font-semibold uppercase">Facturado</span>
            <DollarSign size={20} className="text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-white">{formatMoney(facturacion.total)}</p>
          <p className="text-slate-500 text-xs mt-2">Órdenes pagadas</p>
        </div>

        <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 rounded-xl p-5 border border-blue-500/20">
          <div className="flex items-center justify-between mb-3">
            <span className="text-blue-400 text-xs font-semibold uppercase">Órdenes</span>
            <ShoppingCart size={20} className="text-blue-400" />
          </div>
          <p className="text-2xl font-bold text-white">{orderCounts.total}</p>
          <p className="text-slate-500 text-xs mt-2">TN: {orderCounts.tn} · ML: {orderCounts.ml} · May: {orderCounts.may}</p>
        </div>

        <div className="bg-gradient-to-br from-indigo-500/10 to-indigo-600/5 rounded-xl p-5 border border-indigo-500/20">
          <div className="flex items-center justify-between mb-3">
            <span className="text-indigo-400 text-xs font-semibold uppercase">Productos</span>
            <Package size={20} className="text-indigo-400" />
          </div>
          <p className="text-2xl font-bold text-white">{productCount || products.length}</p>
          <p className="text-slate-500 text-xs mt-2">En catálogo</p>
        </div>

        <div className="bg-gradient-to-br from-red-500/10 to-red-600/5 rounded-xl p-5 border border-red-500/20">
          <div className="flex items-center justify-between mb-3">
            <span className="text-red-400 text-xs font-semibold uppercase">Alertas</span>
            <AlertTriangle size={20} className="text-red-400" />
          </div>
          <p className="text-2xl font-bold text-red-400">{outOfStock + lowStock}</p>
          <p className="text-slate-500 text-xs mt-2">{outOfStock} sin stock · {lowStock} bajo</p>
        </div>
      </div>

      {/* Por Canal */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 flex items-center gap-4">
          <div className="p-3 bg-cyan-500/10 rounded-xl">
            <Cloud size={24} className="text-cyan-400" />
          </div>
          <div className="flex-1">
            <p className="text-slate-500 text-xs">Tienda Nube</p>
            <p className="text-xl font-bold text-white">{formatMoney(facturacion.tn)}</p>
          </div>
          <div className="text-right">
            <p className="text-cyan-400 text-sm font-bold">
              {facturacion.total > 0 ? Math.round((facturacion.tn / facturacion.total) * 100) : 0}%
            </p>
            <p className="text-slate-600 text-xs">{orderCounts.tn} órdenes</p>
          </div>
        </div>

        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 flex items-center gap-4">
          <div className="p-3 bg-yellow-500/10 rounded-xl">
            <Zap size={24} className="text-yellow-400" />
          </div>
          <div className="flex-1">
            <p className="text-slate-500 text-xs">Mercado Libre</p>
            <p className="text-xl font-bold text-white">{formatMoney(facturacion.ml)}</p>
          </div>
          <div className="text-right">
            <p className="text-yellow-400 text-sm font-bold">
              {facturacion.total > 0 ? Math.round((facturacion.ml / facturacion.total) * 100) : 0}%
            </p>
            <p className="text-slate-600 text-xs">{orderCounts.ml} órdenes</p>
          </div>
        </div>

        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 flex items-center gap-4">
          <div className="p-3 bg-blue-500/10 rounded-xl">
            <ShoppingCart size={24} className="text-blue-400" />
          </div>
          <div className="flex-1">
            <p className="text-slate-500 text-xs">Mayoristas</p>
            <p className="text-xl font-bold text-white">{formatMoney(facturacion.may)}</p>
          </div>
          <div className="text-right">
            <p className="text-blue-400 text-sm font-bold">
              {facturacion.total > 0 ? Math.round((facturacion.may / facturacion.total) * 100) : 0}%
            </p>
            <p className="text-slate-600 text-xs">{orderCounts.may} pedidos</p>
          </div>
        </div>
      </div>

      {/* Tablas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
          <div className="p-4 border-b border-slate-700/50 flex items-center gap-2">
            <Award size={18} className="text-emerald-400" />
            <h3 className="font-bold text-white">Más Vendidos</h3>
            <span className="text-slate-500 text-xs ml-auto">{dateRange} días</span>
          </div>
          <div className="p-4">
            {topProducts.length > 0 ? (
              <div className="space-y-3">
                {topProducts.map((p, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      i === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                      i === 1 ? 'bg-slate-400/20 text-slate-300' :
                      i === 2 ? 'bg-amber-600/20 text-amber-500' :
                      'bg-slate-700/50 text-slate-500'
                    }`}>{i + 1}</span>
                    <p className="flex-1 text-white text-sm truncate">{p.name}</p>
                    <div className="text-right">
                      <p className="text-white font-bold text-sm">{p.qty} uds</p>
                      <p className="text-slate-500 text-xs">{formatMoney(p.rev)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-500 text-center py-8">Sin datos de ventas</p>
            )}
          </div>
        </div>

        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
          <div className="p-4 border-b border-slate-700/50 flex items-center gap-2">
            <AlertCircle size={18} className="text-red-400" />
            <h3 className="font-bold text-white">Stock Crítico</h3>
          </div>
          <div className="p-4">
            {lowStockProducts.length > 0 ? (
              <div className="space-y-3">
                {lowStockProducts.map((p, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${
                      p.stock === 0 ? 'bg-red-500' : p.stock < 5 ? 'bg-orange-500' : 'bg-yellow-500'
                    }`}></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm truncate">{p.name}</p>
                      <p className="text-slate-600 text-xs">{p.sku || '-'}</p>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-bold ${
                      p.stock === 0 ? 'bg-red-500/10 text-red-400' :
                      p.stock < 5 ? 'bg-orange-500/10 text-orange-400' :
                      'bg-yellow-500/10 text-yellow-400'
                    }`}>
                      {p.stock === 0 ? 'SIN STOCK' : `${p.stock} uds`}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-500 text-center py-8">Sin alertas</p>
            )}
          </div>
        </div>
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4">
          <h3 className="font-bold text-white mb-4">Top 5 Productos</h3>
          <div className="h-64">
            {topProducts.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProducts.slice(0, 5)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis 
                    dataKey="name" 
                    type="category" 
                    width={100} 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                    tickFormatter={(v) => v.length > 15 ? v.substring(0, 15) + '...' : v}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155' }}
                    formatter={(value: number) => [`${value} uds`, 'Vendidos']}
                  />
                  <Bar dataKey="qty" fill="#10b981" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500">Sin datos</div>
            )}
          </div>
        </div>

        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4">
          <h3 className="font-bold text-white mb-4">Por Canal</h3>
          <div className="h-64 flex items-center">
            {salesByChannel.length > 0 ? (
              <>
                <div className="w-1/2 h-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={salesByChannel} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                        {salesByChannel.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155' }}
                        formatter={(value: number) => [formatMoney(value), '']}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="w-1/2 space-y-4">
                  {salesByChannel.map((item, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></div>
                      <div className="flex-1">
                        <p className="text-white text-sm">{item.name}</p>
                        <p className="text-slate-500 text-xs">{formatMoney(item.value)}</p>
                      </div>
                      <p className="text-white font-bold text-sm">
                        {facturacion.total > 0 ? Math.round((item.value / facturacion.total) * 100) : 0}%
                      </p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-slate-500 text-center w-full">Sin datos</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
