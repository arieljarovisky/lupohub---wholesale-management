import React, { useState, useEffect, useMemo } from 'react';
import { Award, Loader2, RefreshCw, BarChart3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../services/api';

type DateRange = '7' | '15' | '30' | '60' | '90';

function parseAmount(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return isNaN(value) ? 0 : value;
  let str = String(value);
  const hasComma = str.includes(',');
  const hasDot = str.includes('.');
  if (hasComma && hasDot) {
    const lastComma = str.lastIndexOf(',');
    const lastDot = str.lastIndexOf('.');
    if (lastComma > lastDot) str = str.replace(/\./g, '').replace(',', '.');
    else str = str.replace(/,/g, '');
  } else if (hasComma) {
    const parts = str.split(',');
    if (parts.length === 2 && parts[1].length <= 2) str = str.replace(',', '.');
    else str = str.replace(/,/g, '');
  }
  str = str.replace(/[^0-9.-]/g, '');
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

const MarketingTopProducts: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [tnOrders, setTnOrders] = useState<any[]>([]);
  const [mlOrders, setMlOrders] = useState<any[]>([]);
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

  const loadData = async () => {
    setLoading(true);
    const dates = getDateRange(parseInt(dateRange, 10));
    try {
      const [tnRes, mlRes] = await Promise.all([
        api.getTiendaNubeOrders({ per_page: 100, created_at_min: dates.from, created_at_max: dates.to }).catch(() => ({ orders: [] })),
        api.getMercadoLibreOrders({ limit: 100, date_from: dates.from, date_to: dates.to }).catch(() => ({ orders: [] }))
      ]);
      setTnOrders(tnRes.orders || []);
      setMlOrders(mlRes.orders || []);
    } catch (e) {
      console.error('Error cargando ventas:', e);
      setTnOrders([]);
      setMlOrders([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [dateRange]);

  const topProducts = useMemo(() => {
    const sales: Record<string, { name: string; qty: number; rev: number; channels: Set<string> }> = {};

    tnOrders.filter((o) => o.paymentStatus === 'paid').forEach((order) => {
      (order.products || []).forEach((p: any) => {
        const key = p.name || p.sku || 'Producto';
        if (!sales[key]) sales[key] = { name: key, qty: 0, rev: 0, channels: new Set() };
        sales[key].qty += p.quantity || 1;
        sales[key].rev += parseAmount(p.price) * (p.quantity || 1);
        sales[key].channels.add('TN');
      });
    });

    mlOrders.filter((o) => o.status === 'paid').forEach((order) => {
      (order.items || []).forEach((item: any) => {
        const key = item.title || item.sku || 'Producto';
        if (!sales[key]) sales[key] = { name: key, qty: 0, rev: 0, channels: new Set() };
        sales[key].qty += item.quantity || 1;
        sales[key].rev += parseAmount(item.unitPrice) * (item.quantity || 1);
        sales[key].channels.add('ML');
      });
    });

    return Object.values(sales)
      .map((s) => ({ ...s, channels: Array.from(s.channels).join(' + ') }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 20);
  }, [tnOrders, mlOrders]);

  const chartData = topProducts.slice(0, 10).map((p) => ({
    name: p.name.length > 28 ? `${p.name.slice(0, 28)}…` : p.name,
    qty: p.qty
  }));

  const formatMoney = (n: number) =>
    n >= 1000000 ? `$${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${n.toLocaleString('es-AR')}`;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <Loader2 className="animate-spin text-fuchsia-500 mb-4" size={40} />
        <p className="text-slate-400">Cargando ventas…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Award className="text-emerald-400" size={22} />
            Artículos más vendidos
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            Ventas pagadas en Tienda Nube y Mercado Libre (sin pedidos mayoristas).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as DateRange)}
            className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-fuchsia-500"
          >
            <option value="7">Últimos 7 días</option>
            <option value="15">Últimos 15 días</option>
            <option value="30">Últimos 30 días</option>
            <option value="60">Últimos 60 días</option>
            <option value="90">Últimos 90 días</option>
          </select>
          <button
            type="button"
            onClick={loadData}
            className="p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 hover:text-white transition"
            title="Actualizar"
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
          <div className="p-4 border-b border-slate-700/50 flex items-center gap-2">
            <Award size={18} className="text-emerald-400" />
            <h3 className="font-bold text-white">Ranking por unidades</h3>
            <span className="text-slate-500 text-xs ml-auto">{dateRange} días</span>
          </div>
          <div className="p-4 max-h-[420px] overflow-y-auto">
            {topProducts.length > 0 ? (
              <div className="space-y-3">
                {topProducts.map((p, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                        i === 0
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : i === 1
                            ? 'bg-slate-400/20 text-slate-300'
                            : i === 2
                              ? 'bg-amber-600/20 text-amber-500'
                              : 'bg-slate-700/50 text-slate-500'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm truncate" title={p.name}>
                        {p.name}
                      </p>
                      <p className="text-[10px] text-slate-500">{p.channels}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-white font-bold text-sm">{p.qty} uds</p>
                      <p className="text-[10px] text-slate-500">{formatMoney(p.rev)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-500 text-center py-12">Sin ventas en el período seleccionado</p>
            )}
          </div>
        </div>

        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
          <div className="p-4 border-b border-slate-700/50 flex items-center gap-2">
            <BarChart3 size={18} className="text-fuchsia-400" />
            <h3 className="font-bold text-white">Top 10 — gráfico</h3>
          </div>
          <div className="p-4 h-[380px]">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis type="number" stroke="#94a3b8" fontSize={11} />
                  <YAxis type="category" dataKey="name" stroke="#94a3b8" fontSize={10} width={100} />
                  <Tooltip
                    contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 8 }}
                    labelStyle={{ color: '#e2e8f0' }}
                  />
                  <Bar dataKey="qty" fill="#d946ef" radius={[0, 4, 4, 0]} name="Unidades" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-slate-500 text-center py-12">Sin datos para graficar</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MarketingTopProducts;
