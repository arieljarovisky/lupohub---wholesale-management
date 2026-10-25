import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  PackagePlus,
  RefreshCw,
  Search,
  Ship,
  TrendingUp
} from 'lucide-react';
import { api, BrazilSuggestionArticle, BrazilSuggestionPriority } from '../services/api';
import { useNotification } from '../context/NotificationContext';
import { INVENTORY_STORAGE_KEY } from '../utils/inventoryUtils';

type PeriodOpt = 30 | 60 | 90;
type FilterTab = 'pedir' | 'urgente' | 'todos';

const PRIORITY_LABEL: Record<BrazilSuggestionPriority, string> = {
  agotado: 'Agotado',
  critico: 'Crítico',
  pedir: 'Pedir',
  ok: 'Alcanza',
  sin_venta: 'Sin ventas'
};

function priorityClass(priority: BrazilSuggestionPriority): string {
  if (priority === 'agotado') return 'bg-red-500/15 text-red-300 border-red-500/30';
  if (priority === 'critico') return 'bg-orange-500/15 text-orange-300 border-orange-500/30';
  if (priority === 'pedir') return 'bg-amber-500/15 text-amber-200 border-amber-500/30';
  if (priority === 'ok') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  return 'bg-slate-700/40 text-slate-400 border-slate-600/40';
}

function formatInt(n: number): string {
  return Math.round(n).toLocaleString('es-AR');
}

function formatCover(days: number | null): string {
  if (days == null) return '—';
  if (days >= 999) return '∞';
  return `${Math.round(days)} d`;
}

function openInInventory(search: string) {
  try {
    sessionStorage.setItem(
      INVENTORY_STORAGE_KEY,
      JSON.stringify({
        search,
        page: 1,
        subView: 'mine',
        hideZeroStock: false,
        showHiddenVariants: false,
        filterSize: 'ALL',
        filterCategory: 'ALL',
        filterColor: 'ALL'
      })
    );
  } catch {
    /* ignore */
  }
  window.location.hash = 'inventory';
}

const BrazilOrder: React.FC = () => {
  const { showToast } = useNotification();
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [periodDays, setPeriodDays] = useState<PeriodOpt>(90);
  const [leadTimeDays, setLeadTimeDays] = useState(45);
  const [coverageDays, setCoverageDays] = useState(60);
  const [filter, setFilter] = useState<FilterTab>('pedir');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getBrazilOrderSuggestion>> | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getBrazilOrderSuggestion({ periodDays, leadTimeDays, coverageDays });
      setData(res);
    } catch (e: any) {
      console.error('BrazilOrder:', e);
      showToast('error', e?.message || 'No se pudo calcular el pedido a Brasil');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [periodDays, leadTimeDays, coverageDays]);

  const rows = useMemo(() => {
    const articles = data?.articles || [];
    const q = search.trim().toLowerCase();
    return articles.filter((a) => {
      if (filter === 'pedir' && a.suggestedQty <= 0) return false;
      if (filter === 'urgente' && a.priority !== 'agotado' && a.priority !== 'critico') return false;
      if (q && !a.name.toLowerCase().includes(q) && !a.sku.toLowerCase().includes(q) && !a.category.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [data, filter, search]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await api.exportBrazilOrderSuggestion({ periodDays, leadTimeDays, coverageDays });
      showToast('success', 'Planilla de pedido a Brasil descargada');
    } catch (e: any) {
      showToast('error', e?.message || 'Error exportando la planilla');
    } finally {
      setExporting(false);
    }
  };

  const summary = data?.summary;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <p className="text-slate-400 text-sm max-w-2xl">
            Cruza lo que vendiste (Tienda Nube, Mercado Libre y mayorista) con el stock actual y lo que ya
            viene en camino. Sugiere cuánto pedir a Brasil para no quedarte sin mercadería mientras llega
            el contenedor.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="p-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 hover:text-white transition min-w-[44px] min-h-[44px] inline-flex items-center justify-center"
            title="Actualizar"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || loading || !data}
            className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition disabled:opacity-60 min-h-[44px]"
          >
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {exporting ? 'Exportando…' : 'Exportar planilla'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="bg-slate-800/50 border border-slate-700/50 rounded-xl px-3 py-3">
          <span className="block text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
            Ventas de los últimos
          </span>
          <select
            value={periodDays}
            onChange={(e) => setPeriodDays(Number(e.target.value) as PeriodOpt)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-emerald-500"
          >
            <option value={30}>30 días</option>
            <option value={60}>60 días</option>
            <option value={90}>90 días</option>
          </select>
        </label>
        <label className="bg-slate-800/50 border border-slate-700/50 rounded-xl px-3 py-3">
          <span className="block text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
            Días hasta que llega
          </span>
          <select
            value={leadTimeDays}
            onChange={(e) => setLeadTimeDays(Number(e.target.value))}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-emerald-500"
          >
            <option value={30}>30 días</option>
            <option value={45}>45 días</option>
            <option value={60}>60 días</option>
          </select>
        </label>
        <label className="bg-slate-800/50 border border-slate-700/50 rounded-xl px-3 py-3">
          <span className="block text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
            Stock que querés al llegar
          </span>
          <select
            value={coverageDays}
            onChange={(e) => setCoverageDays(Number(e.target.value))}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-emerald-500"
          >
            <option value={30}>30 días</option>
            <option value={60}>60 días</option>
            <option value={90}>90 días</option>
          </select>
        </label>
      </div>

      <p className="text-xs text-slate-500">
        Pedir = ventas por día × ({leadTimeDays} días de importación + {coverageDays} días de cobertura) − stock −
        mercadería en camino. Si un talle se agota antes de que llegue el pedido, queda marcado como crítico.
      </p>

      {loading && !data ? (
        <div className="flex flex-col items-center justify-center h-56">
          <Loader2 className="animate-spin text-emerald-500 mb-3" size={36} />
          <p className="text-slate-400">Calculando ventas, stock y sugerencia…</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SummaryCard
              icon={<PackagePlus size={18} className="text-emerald-400" />}
              label="Artículos a pedir"
              value={formatInt(summary?.articlesToOrder || 0)}
            />
            <SummaryCard
              icon={<TrendingUp size={18} className="text-blue-400" />}
              label="Unidades sugeridas"
              value={formatInt(summary?.unitsToOrder || 0)}
            />
            <SummaryCard
              icon={<AlertTriangle size={18} className="text-orange-400" />}
              label="Críticos / agotados"
              value={formatInt(summary?.urgent || 0)}
            />
            <SummaryCard
              icon={<Ship size={18} className="text-cyan-400" />}
              label="En camino"
              value={formatInt(summary?.incomingUnits || 0)}
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="flex rounded-xl bg-slate-800/70 border border-slate-700 p-1">
              {(
                [
                  ['pedir', 'Solo pedir'],
                  ['urgente', 'Urgentes'],
                  ['todos', 'Todos']
                ] as Array<[FilterTab, string]>
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium min-h-[40px] ${
                    filter === id ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar artículo, código o categoría"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-9 pr-3 py-2.5 text-white text-sm outline-none focus:border-emerald-500 min-h-[44px]"
              />
            </div>
          </div>

          <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl overflow-hidden">
            {rows.length === 0 ? (
              <div className="px-4 py-12 text-center text-slate-400 text-sm">
                {filter === 'pedir'
                  ? 'Con estos parámetros no hace falta pedir nada: el stock cubre la importación y la cobertura.'
                  : 'No hay artículos para este filtro.'}
              </div>
            ) : (
              <ul className="divide-y divide-slate-700/60">
                {rows.map((article) => (
                  <ArticleRow
                    key={article.productId}
                    article={article}
                    open={expanded.has(article.productId)}
                    onToggle={() => toggle(article.productId)}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
};

const SummaryCard: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
    <div className="flex items-center gap-2 text-slate-400 text-xs uppercase tracking-wider font-semibold">
      {icon}
      {label}
    </div>
    <p className="text-2xl font-bold text-white mt-2 tabular-nums">{value}</p>
  </div>
);

const ArticleRow: React.FC<{
  article: BrazilSuggestionArticle;
  open: boolean;
  onToggle: () => void;
}> = ({ article, open, onToggle }) => {
  const detail = article.variants.filter((v) => v.suggestedQty > 0 || v.sold > 0 || v.stock !== 0 || v.incoming > 0);

  return (
    <li>
      <div className="flex items-stretch gap-2 px-3 py-3 hover:bg-slate-800/70">
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 w-10 h-10 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/70"
          aria-expanded={open}
          aria-label={open ? 'Ocultar talles' : 'Ver talles y colores'}
        >
          {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => openInInventory(article.sku)}
              className="text-left text-white font-semibold hover:text-emerald-300 hover:underline underline-offset-2"
              title="Ver en Inventario"
            >
              {article.name}
            </button>
            <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase border ${priorityClass(article.priority)}`}>
              {PRIORITY_LABEL[article.priority]}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {article.sku}
            {article.category ? ` · ${article.category}` : ''}
          </p>
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
            <Stat label="Stock" value={formatInt(article.stock)} />
            <Stat label="En camino" value={formatInt(article.incoming)} />
            <Stat label="Vendidas" value={formatInt(article.sold)} hint={`${formatInt(article.soldTn)} TN · ${formatInt(article.soldMl)} ML · ${formatInt(article.soldMay)} may.`} />
            <Stat label="Cobertura" value={formatCover(article.daysOfCover)} />
            <Stat label="Pedir" value={formatInt(article.suggestedQty)} emphasize />
          </div>
        </div>
      </div>
      {open && (
        <div className="px-3 pb-4 pl-14">
          <div className="overflow-x-auto rounded-xl border border-slate-700/60">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/80 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left font-semibold px-3 py-2">Color</th>
                  <th className="text-left font-semibold px-3 py-2">Talle</th>
                  <th className="text-right font-semibold px-3 py-2">Stock</th>
                  <th className="text-right font-semibold px-3 py-2">Camino</th>
                  <th className="text-right font-semibold px-3 py-2">Vendidas</th>
                  <th className="text-right font-semibold px-3 py-2">Cobertura</th>
                  <th className="text-right font-semibold px-3 py-2">Pedir</th>
                </tr>
              </thead>
              <tbody>
                {detail.map((v) => (
                  <tr key={v.variantId} className="border-t border-slate-800 text-slate-300">
                    <td className="px-3 py-2">
                      {v.colorName}
                      {v.colorCode ? <span className="text-slate-500"> · {v.colorCode}</span> : null}
                    </td>
                    <td className="px-3 py-2">{v.sizeLabel}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatInt(v.stock)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatInt(v.incoming)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" title={`TN ${v.soldTn} · ML ${v.soldMl} · May. ${v.soldMay}`}>
                      {formatInt(v.sold)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCover(v.daysOfCover)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-300">{formatInt(v.suggestedQty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </li>
  );
};

const Stat: React.FC<{ label: string; value: string; hint?: string; emphasize?: boolean }> = ({
  label,
  value,
  hint,
  emphasize
}) => (
  <div title={hint}>
    <p className="text-slate-500">{label}</p>
    <p className={`tabular-nums font-semibold ${emphasize ? 'text-emerald-300 text-sm' : 'text-slate-200'}`}>{value}</p>
  </div>
);

export default BrazilOrder;
