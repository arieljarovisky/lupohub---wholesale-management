import React, { useState, useEffect, useMemo } from 'react';
import { Award, Loader2, RefreshCw, BarChart3, Package, AlertTriangle, Search } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../services/api';
import { Order, OrderStatus } from '../types';
import { useNotification } from '../context/NotificationContext';

type DateRange = '7' | '15' | '30' | '60' | '90';
type ChannelFilter = 'all' | 'tn' | 'ml' | 'mayorista' | 'tn_ml';
type StockFilter = 'all' | 'out' | 'low' | 'ok';
type StockSortBy = 'stock' | 'name' | 'sku';
type SortDir = 'asc' | 'desc';

const CHANNEL_FILTER_LABELS: Record<ChannelFilter, string> = {
  all: 'Todos los canales',
  tn: 'Tienda Nube',
  ml: 'Mercado Libre',
  mayorista: 'Mayorista',
  tn_ml: 'TN + Mercado Libre'
};

const CHANNEL_FILTER_DESC: Record<ChannelFilter, string> = {
  all: 'Ventas pagadas en Tienda Nube, Mercado Libre y pedidos mayoristas confirmados.',
  tn: 'Ventas pagadas en Tienda Nube.',
  ml: 'Ventas pagadas en Mercado Libre.',
  mayorista: 'Pedidos mayoristas confirmados (sin borrador ni cancelados).',
  tn_ml: 'Ventas online en Tienda Nube y Mercado Libre (sin mayorista).'
};

function channelsForFilter(filter: ChannelFilter) {
  return {
    includeTn: filter === 'all' || filter === 'tn' || filter === 'tn_ml',
    includeMl: filter === 'all' || filter === 'ml' || filter === 'tn_ml',
    includeMay: filter === 'all' || filter === 'mayorista'
  };
}

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

type VariantRow = {
  product_id?: string;
  base_sku?: string;
  sku: string;
  name: string;
  stock_total?: number;
  stock?: number;
  externalIds?: {
    tiendaNube?: string;
    mercadoLibre?: string;
    tiendaNubeVariant?: string;
    mercadoLibreVariant?: string;
    mercadoLibreItemId?: string;
  };
};

const MarketingTopProducts: React.FC = () => {
  const { showToast } = useNotification();
  const [loading, setLoading] = useState(true);
  const [tnOrders, setTnOrders] = useState<any[]>([]);
  const [mlOrders, setMlOrders] = useState<any[]>([]);
  const [wholesaleOrders, setWholesaleOrders] = useState<Order[]>([]);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>('60');
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [stockSearch, setStockSearch] = useState('');
  const [stockSortBy, setStockSortBy] = useState<StockSortBy>('stock');
  const [stockSortDir, setStockSortDir] = useState<SortDir>('asc');

  const getDateRange = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    return {
      from: from.toISOString().split('T')[0],
      to: to.toISOString().split('T')[0]
    };
  };

  const isInDateRange = (dateStr: string | undefined, from: string, to: string) => {
    if (!dateStr) return false;
    const day = dateStr.slice(0, 10);
    return day >= from && day <= to;
  };

  const loadData = async () => {
    setLoading(true);
    const dates = getDateRange(parseInt(dateRange, 10));
    try {
      const [tnRes, mlRes, ordersRes, inventoryRows] = await Promise.all([
        api.getTiendaNubeOrders({ per_page: 100, created_at_min: dates.from, created_at_max: dates.to }).catch(() => ({ orders: [] })),
        api.getMercadoLibreOrders({ limit: 100, date_from: dates.from, date_to: dates.to }).catch(() => ({ orders: [] })),
        api.getOrders().catch(() => [] as Order[]),
        api.exportInventory().catch(() => [] as Awaited<ReturnType<typeof api.exportInventory>>)
      ]);
      setTnOrders(tnRes.orders || []);
      setMlOrders(mlRes.orders || []);
      setWholesaleOrders(Array.isArray(ordersRes) ? ordersRes : []);
      setVariants(
        (inventoryRows || []).map((row) => ({
          product_id: row.product_sku,
          base_sku: row.product_sku,
          sku: row.variant_sku || row.product_sku,
          name: row.product_name,
          stock_total: Number(row.stock ?? 0),
          externalIds: {
            tiendaNube: row.tienda_nube_id != null ? String(row.tienda_nube_id) : undefined,
            mercadoLibre: row.mercado_libre_id || undefined,
            tiendaNubeVariant: row.tienda_nube_variant_id != null ? String(row.tienda_nube_variant_id) : undefined,
            mercadoLibreVariant: row.mercado_libre_variant_id || undefined,
            mercadoLibreItemId: row.mercado_libre_item_id || undefined
          }
        }))
      );
    } catch (e: any) {
      console.error('Error cargando ventas:', e);
      showToast('error', e?.message || 'Error cargando ventas e inventario');
      setTnOrders([]);
      setMlOrders([]);
      setWholesaleOrders([]);
      setVariants([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [dateRange]);

  const topProducts = useMemo(() => {
    const dates = getDateRange(parseInt(dateRange, 10));
    const { includeTn, includeMl, includeMay } = channelsForFilter(channelFilter);
    const sales: Record<string, { name: string; qty: number; rev: number; channels: Set<string> }> = {};

    if (includeTn) {
      tnOrders.filter((o) => o.paymentStatus === 'paid').forEach((order) => {
        (order.products || []).forEach((p: any) => {
          const key = p.name || p.sku || 'Producto';
          if (!sales[key]) sales[key] = { name: key, qty: 0, rev: 0, channels: new Set() };
          sales[key].qty += p.quantity || 1;
          sales[key].rev += parseAmount(p.price) * (p.quantity || 1);
          sales[key].channels.add('TN');
        });
      });
    }

    if (includeMl) {
      mlOrders.filter((o) => o.status === 'paid').forEach((order) => {
        (order.items || []).forEach((item: any) => {
          const key = item.title || item.sku || 'Producto';
          if (!sales[key]) sales[key] = { name: key, qty: 0, rev: 0, channels: new Set() };
          sales[key].qty += item.quantity || 1;
          sales[key].rev += parseAmount(item.unitPrice) * (item.quantity || 1);
          sales[key].channels.add('ML');
        });
      });
    }

    if (includeMay) {
      wholesaleOrders
        .filter(
          (o) =>
            o.status !== OrderStatus.DRAFT &&
            o.status !== OrderStatus.CANCELLED &&
            isInDateRange(o.date, dates.from, dates.to)
        )
        .forEach((order) => {
          (order.items || []).forEach((item) => {
            const key = item.productName || item.sku || 'Producto';
            if (!sales[key]) sales[key] = { name: key, qty: 0, rev: 0, channels: new Set() };
            const qty = item.quantity || 1;
            sales[key].qty += qty;
            sales[key].rev += parseAmount(item.priceAtMoment) * qty;
            sales[key].channels.add('Mayorista');
          });
        });
    }

    return Object.values(sales)
      .map((s) => ({ ...s, channels: Array.from(s.channels).join(' + ') }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 20);
  }, [tnOrders, mlOrders, wholesaleOrders, dateRange, channelFilter]);

  const stockByProduct = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; sku: string; stock: number; variants: number; ml: boolean; tn: boolean }
    >();

    variants.forEach((v) => {
      const key = v.product_id || v.base_sku || v.sku;
      const stock = Number(v.stock_total ?? v.stock ?? 0);
      const hasMl = !!(
        v.externalIds?.mercadoLibre ||
        v.externalIds?.mercadoLibreVariant ||
        v.externalIds?.mercadoLibreItemId
      );
      const hasTn = !!(v.externalIds?.tiendaNube || v.externalIds?.tiendaNubeVariant);
      const existing = map.get(key);
      if (existing) {
        existing.stock += stock;
        existing.variants += 1;
        existing.ml = existing.ml || hasMl;
        existing.tn = existing.tn || hasTn;
      } else {
        map.set(key, {
          id: key,
          name: v.name,
          sku: v.base_sku || v.sku,
          stock,
          variants: 1,
          ml: hasMl,
          tn: hasTn
        });
      }
    });

    return Array.from(map.values());
  }, [variants]);

  const stockMetrics = useMemo(() => {
    const totalUnits = stockByProduct.reduce((s, p) => s + p.stock, 0);
    const outOfStock = stockByProduct.filter((p) => p.stock === 0).length;
    const lowStock = stockByProduct.filter((p) => p.stock > 0 && p.stock < 10).length;
    const withStock = stockByProduct.filter((p) => p.stock >= 10).length;
    return { totalUnits, outOfStock, lowStock, withStock, products: stockByProduct.length };
  }, [stockByProduct]);

  const filteredStock = useMemo(() => {
    const q = stockSearch.trim().toLowerCase();
    const filtered = stockByProduct.filter((p) => {
      if (stockFilter === 'out' && p.stock !== 0) return false;
      if (stockFilter === 'low' && (p.stock === 0 || p.stock >= 10)) return false;
      if (stockFilter === 'ok' && p.stock < 10) return false;
      if (q && !p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) return false;
      return true;
    });

    const dir = stockSortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (stockSortBy === 'stock') return (a.stock - b.stock) * dir;
      if (stockSortBy === 'name') return a.name.localeCompare(b.name, 'es') * dir;
      return a.sku.localeCompare(b.sku, 'es', { numeric: true }) * dir;
    });
  }, [stockByProduct, stockFilter, stockSearch, stockSortBy, stockSortDir]);

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
        <p className="text-slate-400">Cargando ventas e inventario…</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Ventas */}
      <section className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Award className="text-emerald-400" size={22} />
              Artículos más vendidos
            </h2>
            <p className="text-slate-400 text-sm mt-1">{CHANNEL_FILTER_DESC[channelFilter]}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value as ChannelFilter)}
              className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-fuchsia-500"
            >
              {(Object.keys(CHANNEL_FILTER_LABELS) as ChannelFilter[]).map((key) => (
                <option key={key} value={key}>
                  {CHANNEL_FILTER_LABELS[key]}
                </option>
              ))}
            </select>
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
      </section>

      {/* Stock */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Package className="text-cyan-400" size={22} />
            Informe de stock
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            Stock Lupohub por artículo (suma de variantes). Solo lectura para planificar campañas.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Unidades totales', value: stockMetrics.totalUnits.toLocaleString('es-AR'), color: 'text-white' },
            { label: 'Artículos', value: stockMetrics.products.toLocaleString('es-AR'), color: 'text-white' },
            { label: 'Sin stock', value: stockMetrics.outOfStock.toLocaleString('es-AR'), color: 'text-red-400' },
            { label: 'Stock bajo (<10 u)', value: stockMetrics.lowStock.toLocaleString('es-AR'), color: 'text-amber-400' }
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-xl border border-slate-700/60 bg-slate-900/40 px-3 py-3">
              <p className="text-xs text-slate-500">{kpi.label}</p>
              <p className={`text-xl font-bold tabular-nums mt-1 ${kpi.color}`}>{kpi.value}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={stockSearch}
              onChange={(e) => setStockSearch(e.target.value)}
              placeholder="Buscar por nombre o SKU…"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl py-2.5 pl-9 pr-3 text-white text-sm outline-none focus:border-cyan-500"
            />
          </div>
          <select
            value={stockFilter}
            onChange={(e) => setStockFilter(e.target.value as StockFilter)}
            className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-cyan-500"
          >
            <option value="all">Todo el stock</option>
            <option value="out">Sin stock</option>
            <option value="low">Stock bajo</option>
            <option value="ok">Stock OK (≥10 u)</option>
          </select>
          <select
            value={stockSortBy}
            onChange={(e) => setStockSortBy(e.target.value as StockSortBy)}
            className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-cyan-500"
          >
            <option value="stock">Orden: stock</option>
            <option value="name">Orden: nombre</option>
            <option value="sku">Orden: código</option>
          </select>
          <select
            value={stockSortDir}
            onChange={(e) => setStockSortDir(e.target.value as SortDir)}
            className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-cyan-500"
          >
            <option value="asc">
              {stockSortBy === 'stock' ? 'Menor → mayor' : 'A → Z'}
            </option>
            <option value="desc">
              {stockSortBy === 'stock' ? 'Mayor → menor' : 'Z → A'}
            </option>
          </select>
        </div>

        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
          <div className="p-4 border-b border-slate-700/50 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-400" />
            <h3 className="font-bold text-white text-sm">Inventario por artículo</h3>
            <span className="text-slate-500 text-xs ml-auto">{filteredStock.length} resultados</span>
          </div>
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-900/95 z-10">
                <tr className="text-left text-slate-500 border-b border-slate-700/50">
                  <th className="py-2.5 px-3 font-medium">Artículo</th>
                  <th className="py-2.5 px-3 font-medium">SKU</th>
                  <th className="py-2.5 px-3 font-medium text-right">Stock</th>
                  <th className="py-2.5 px-3 font-medium text-right">Variantes</th>
                  <th className="py-2.5 px-3 font-medium">Canales</th>
                </tr>
              </thead>
              <tbody>
                {filteredStock.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-slate-500">
                      Sin resultados con los filtros actuales
                    </td>
                  </tr>
                ) : (
                  filteredStock.map((p) => (
                    <tr key={p.id} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                      <td className="py-2.5 px-3 text-white max-w-[220px] truncate" title={p.name}>
                        {p.name}
                      </td>
                      <td className="py-2.5 px-3 text-slate-400 font-mono text-xs">{p.sku}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums">
                        <span
                          className={
                            p.stock === 0
                              ? 'text-red-400 font-bold'
                              : p.stock < 10
                                ? 'text-amber-400 font-semibold'
                                : 'text-emerald-400'
                          }
                        >
                          {p.stock.toLocaleString('es-AR')}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-slate-400">{p.variants}</td>
                      <td className="py-2.5 px-3">
                        <div className="flex flex-wrap gap-1">
                          {p.ml && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 border border-yellow-500/25">
                              ML
                            </span>
                          )}
                          {p.tn && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 border border-cyan-500/25">
                              TN
                            </span>
                          )}
                          {!p.ml && !p.tn && <span className="text-slate-600 text-xs">—</span>}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
};

export default MarketingTopProducts;
