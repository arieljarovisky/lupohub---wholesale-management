import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  RefreshCw,
  Facebook,
  MousePointerClick,
  Eye,
  Wallet,
  TrendingUp,
  Percent,
  BarChart3,
  CalendarRange,
  AlertCircle,
  ExternalLink,
  Users,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Download,
  BookOpen,
  Filter,
  Layers,
  Image
} from 'lucide-react';
import { api, MetaAdsMetricsRow } from '../services/api';
import { formatMoneyAr } from '../utils/moneyFormat';
import { useNotification } from '../context/NotificationContext';
import {
  downloadMetaAdsExcel,
  fetchMetaFullExport,
  metaManagerUrl,
  type MetaRow
} from '../utils/metaAdsExport';

const GLOSSARY: { term: string; text: string }[] = [
  { term: 'Inversión', text: 'Dinero gastado en anuncios en el período (spend en Meta).' },
  { term: 'Valor ventas', text: 'Importe de compras atribuidas a los anuncios según Meta (action_values de purchase).' },
  { term: 'ROAS', text: 'Return On Ad Spend: cuántos pesos de venta generó cada peso invertido. Ej. 3× = $3 de ventas por $1 gastado.' },
  { term: 'CPA', text: 'Costo por adquisición/compra: inversión dividida conversiones, o el costo por resultado que reporta Meta.' },
  { term: 'CTR', text: 'Click-through rate: porcentaje de impresiones que terminaron en clic.' },
  { term: 'CPC', text: 'Costo por clic promedio.' },
  { term: 'Alcance', text: 'Personas únicas que vieron el anuncio al menos una vez.' },
  { term: 'Frecuencia', text: 'Promedio de veces que cada persona vio el anuncio (impresiones / alcance).' },
  { term: 'Conversiones', text: 'Compras registradas por el píxel o eventos de compra de Meta en el período.' },
  { term: 'Conjunto de anuncios', text: 'Agrupación de anuncios con audiencia, ubicación y presupuesto dentro de una campaña.' },
  { term: 'Anuncio', text: 'Creatividad concreta (imagen, video, texto) que se muestra a las personas.' }
];

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatPct(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toLocaleString('es-AR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

function formatRoas(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  return `${value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
}

function statusBadge(status: string) {
  const active = status === 'ACTIVE' || status === 'ENABLED';
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full ${
        active ? 'bg-green-500/20 text-green-400' : 'bg-slate-600/30 text-slate-400'
      }`}
    >
      {status}
    </span>
  );
}

function MetricsCells({ row }: { row: MetaAdsMetricsRow }) {
  return (
    <>
      <td className="py-2.5 px-3 text-right tabular-nums text-slate-400 whitespace-nowrap">
        {row.dailyBudget != null && row.dailyBudget > 0 ? `$${formatMoneyAr(row.dailyBudget)}` : '—'}
      </td>
      <td className="py-2.5 px-3 text-right tabular-nums">${formatMoneyAr(row.spend)}</td>
      <td className="py-2.5 px-3 text-right tabular-nums">${formatMoneyAr(row.purchaseValue)}</td>
      <td className="py-2.5 px-3 text-right tabular-nums">{formatRoas(row.roas)}</td>
      <td className="py-2.5 px-3 text-right tabular-nums">${formatMoneyAr(row.cpa)}</td>
      <td className="py-2.5 px-3 text-right tabular-nums">{row.conversions}</td>
      <td className="py-2.5 px-3 text-right tabular-nums">{row.impressions.toLocaleString('es-AR')}</td>
      <td className="py-2.5 px-3 text-right tabular-nums">{row.clicks.toLocaleString('es-AR')}</td>
      <td className="py-2.5 px-3 text-right tabular-nums">{formatPct(row.ctr)}</td>
      <td className="py-2.5 px-3 text-right tabular-nums">${formatMoneyAr(row.cpc)}</td>
      <td className="py-2.5 px-3 text-right tabular-nums">{row.reach.toLocaleString('es-AR')}</td>
      <td className="py-2.5 px-3 text-right tabular-nums">{row.frequency > 0 ? row.frequency.toFixed(2) : '—'}</td>
    </>
  );
}

const METRIC_HEADERS = (
  <>
    <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">Ppto/día</th>
    <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">Inversión</th>
    <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">Ventas</th>
    <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">ROAS</th>
    <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">CPA</th>
    <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">Conv.</th>
    <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">Impr.</th>
    <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">Clics</th>
    <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">CTR</th>
    <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">CPC</th>
    <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">Alcance</th>
    <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">Freq.</th>
  </>
);

const MetaAdsCampaigns: React.FC = () => {
  const { showToast } = useNotification();
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [campaigns, setCampaigns] = useState<MetaAdsMetricsRow[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState<'all' | 'ACTIVE' | 'PAUSED'>('all');
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [expandedAdset, setExpandedAdset] = useState<string | null>(null);
  const [adsetsByCampaign, setAdsetsByCampaign] = useState<Record<string, MetaAdsMetricsRow[]>>({});
  const [adsByAdset, setAdsByAdset] = useState<Record<string, MetaAdsMetricsRow[]>>({});
  const [loadingAdsets, setLoadingAdsets] = useState<string | null>(null);
  const [loadingAds, setLoadingAds] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return ymd(d);
  });
  const [dateTo, setDateTo] = useState(() => ymd(new Date()));

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotConfigured(false);
    setExpandedCampaign(null);
    setExpandedAdset(null);
    setAdsetsByCampaign({});
    setAdsByAdset({});
    try {
      const res = await api.getMetaAdsCampaigns({ date_from: dateFrom, date_to: dateTo });
      setAccountId(res.accountId || '');
      setCampaigns(Array.isArray(res.campaigns) ? res.campaigns : []);
      setSummary(res.summary || {});
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || 'Error cargando campañas Meta';
      if (e?.response?.data?.configured === false || msg.toLowerCase().includes('no configurado')) {
        setNotConfigured(true);
        setCampaigns([]);
        setSummary({});
      } else {
        setError(msg);
        showToast('error', msg);
      }
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, showToast]);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  const filteredCampaigns = useMemo(() => {
    if (statusFilter === 'all') return campaigns;
    return campaigns.filter((c) => c.status === statusFilter);
  }, [campaigns, statusFilter]);

  const toggleCampaign = async (campaignId: string) => {
    if (expandedCampaign === campaignId) {
      setExpandedCampaign(null);
      setExpandedAdset(null);
      return;
    }
    setExpandedCampaign(campaignId);
    setExpandedAdset(null);
    if (adsetsByCampaign[campaignId]) return;
    setLoadingAdsets(campaignId);
    try {
      const res = await api.getMetaAdSets(campaignId, { date_from: dateFrom, date_to: dateTo });
      setAdsetsByCampaign((prev) => ({ ...prev, [campaignId]: res.adsets || [] }));
    } catch (e: any) {
      showToast('error', e?.response?.data?.message || e?.message || 'Error cargando conjuntos');
    } finally {
      setLoadingAdsets(null);
    }
  };

  const toggleAdset = async (adsetId: string) => {
    if (expandedAdset === adsetId) {
      setExpandedAdset(null);
      return;
    }
    setExpandedAdset(adsetId);
    if (adsByAdset[adsetId]) return;
    setLoadingAds(adsetId);
    try {
      const res = await api.getMetaAdsForAdSet(adsetId, { date_from: dateFrom, date_to: dateTo });
      setAdsByAdset((prev) => ({ ...prev, [adsetId]: res.ads || [] }));
    } catch (e: any) {
      showToast('error', e?.response?.data?.message || e?.message || 'Error cargando anuncios');
    } finally {
      setLoadingAds(null);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const full = await fetchMetaFullExport(dateFrom, dateTo);
      await downloadMetaAdsExcel({
        dateFrom,
        dateTo,
        accountId: full.accountId,
        campaigns: full.campaigns as MetaRow[],
        adsets: full.adsets,
        ads: full.ads,
        summary: full.summary
      });
      showToast('success', 'Excel exportado');
    } catch (e: any) {
      showToast('error', e?.message || 'Error exportando');
    } finally {
      setExporting(false);
    }
  };

  const kpis = useMemo(
    () => [
      { label: 'Inversión', value: `$${formatMoneyAr(summary.spend || 0)}`, icon: Wallet, color: 'text-blue-400' },
      { label: 'Ventas atrib.', value: `$${formatMoneyAr(summary.purchaseValue || 0)}`, icon: TrendingUp, color: 'text-emerald-400' },
      { label: 'ROAS', value: formatRoas(summary.roas || 0), icon: BarChart3, color: 'text-amber-400' },
      { label: 'CPA', value: summary.cpa ? `$${formatMoneyAr(summary.cpa)}` : '—', icon: Wallet, color: 'text-orange-400' },
      { label: 'Conversiones', value: (summary.conversions || 0).toLocaleString('es-AR'), icon: TrendingUp, color: 'text-green-400' },
      { label: 'Impresiones', value: (summary.impressions || 0).toLocaleString('es-AR'), icon: Eye, color: 'text-cyan-400' },
      { label: 'Clics', value: (summary.clicks || 0).toLocaleString('es-AR'), icon: MousePointerClick, color: 'text-violet-400' },
      { label: 'CTR', value: formatPct(summary.ctr || 0), icon: Percent, color: 'text-fuchsia-400' },
      { label: 'CPC prom.', value: summary.cpc ? `$${formatMoneyAr(summary.cpc)}` : '—', icon: BarChart3, color: 'text-indigo-400' },
      { label: 'Alcance', value: (summary.reach || 0).toLocaleString('es-AR'), icon: Users, color: 'text-pink-400' },
      {
        label: 'Frecuencia prom.',
        value: summary.frequency ? summary.frequency.toFixed(2) : '—',
        icon: Users,
        color: 'text-slate-400'
      }
    ],
    [summary]
  );

  if (notConfigured) {
    return (
      <div className="max-w-3xl space-y-6">
        <div className="rounded-2xl border border-amber-500/30 bg-amber-900/20 p-6">
          <div className="flex gap-3">
            <AlertCircle className="text-amber-400 shrink-0" size={24} />
            <div>
              <h2 className="text-lg font-bold text-white">Meta Ads no configurado</h2>
              <p className="text-slate-400 text-sm mt-2">
                Configurá el token y la cuenta en <strong className="text-slate-300">Configuración → Integraciones → Meta Ads</strong>.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Facebook className="text-blue-400" size={22} />
            Campañas Meta Ads
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            Campañas, conjuntos y anuncios con métricas completas. Clic en una fila para desglosar.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Filter size={16} className="text-slate-500" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
          >
            <option value="all">Todas</option>
            <option value="ACTIVE">Activas</option>
            <option value="PAUSED">Pausadas</option>
          </select>
          <CalendarRange size={16} className="text-slate-500 ml-1" />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
          />
          <span className="text-slate-500">→</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
          />
          <button
            type="button"
            onClick={loadCampaigns}
            disabled={loading}
            className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white"
            title="Actualizar"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || loading || campaigns.length === 0}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50"
          >
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
            Exportar Excel
          </button>
          {accountId && (
            <a
              href={metaManagerUrl(accountId)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 text-sm"
            >
              <ExternalLink size={14} /> Meta
            </a>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-900/20 p-4 text-red-300 text-sm flex gap-2">
          <AlertCircle size={18} className="shrink-0" />
          {error}
        </div>
      )}

      <details className="rounded-xl border border-slate-700/60 bg-slate-800/30 group">
        <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-2 text-sm text-slate-300 hover:text-white">
          <BookOpen size={16} className="text-blue-400 shrink-0" />
          <span className="truncate">Glosario: significado de las métricas de Meta Ads</span>
          <ChevronDown size={16} className="ml-auto shrink-0 group-open:rotate-180 transition-transform" />
        </summary>
        <div className="px-4 pb-4 grid sm:grid-cols-2 gap-3 border-t border-slate-700/50 pt-3">
          {GLOSSARY.map((g) => (
            <div key={g.term}>
              <p className="text-xs font-bold text-blue-300">{g.term}</p>
              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{g.text}</p>
            </div>
          ))}
        </div>
      </details>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-blue-500" size={40} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-10 gap-3">
            {kpis.map((k) => (
              <div key={k.label} className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <k.icon size={13} className={k.color} />
                  <span className="text-[9px] text-slate-500 uppercase font-bold leading-tight">{k.label}</span>
                </div>
                <p className="text-white font-bold text-sm tabular-nums">{k.value}</p>
              </div>
            ))}
          </div>

          <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
            <div className="p-4 border-b border-slate-700/50 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-white">Campañas ({filteredCampaigns.length})</h3>
              <p className="text-xs text-slate-500">Expandí una campaña para ver conjuntos y anuncios</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left min-w-[1200px]">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-700/80 text-xs">
                    <th className="py-2.5 px-3 font-medium w-8" />
                    <th className="py-2.5 px-3 font-medium min-w-[200px]">Nombre</th>
                    <th className="py-2.5 px-3 font-medium">Estado</th>
                    <th className="py-2.5 px-3 font-medium">Objetivo</th>
                    {METRIC_HEADERS}
                    <th className="py-2.5 px-3 font-medium w-10" />
                  </tr>
                </thead>
                <tbody>
                  {filteredCampaigns.length === 0 ? (
                    <tr>
                      <td colSpan={16} className="py-12 text-center text-slate-500">
                        Sin campañas en el período o con el filtro elegido
                      </td>
                    </tr>
                  ) : (
                    filteredCampaigns.map((c) => {
                      const isOpen = expandedCampaign === c.id;
                      const adsets = adsetsByCampaign[c.id] || [];
                      return (
                        <React.Fragment key={c.id}>
                          <tr
                            className={`border-b border-slate-800/80 text-slate-300 cursor-pointer hover:bg-slate-800/40 ${
                              isOpen ? 'bg-slate-800/30' : ''
                            }`}
                            onClick={() => toggleCampaign(c.id)}
                          >
                            <td className="py-2.5 px-3 text-slate-500">
                              {loadingAdsets === c.id ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : isOpen ? (
                                <ChevronDown size={14} />
                              ) : (
                                <ChevronRight size={14} />
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="font-medium text-white line-clamp-2" title={c.name}>
                                {c.name}
                              </span>
                              <span className="text-[10px] text-slate-500 font-mono block">{c.id}</span>
                            </td>
                            <td className="py-2.5 px-3">{statusBadge(c.status)}</td>
                            <td className="py-2.5 px-3 text-xs text-slate-400 max-w-[120px] truncate" title={c.objective}>
                              {c.objective || '—'}
                            </td>
                            <MetricsCells row={c} />
                            <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                              {accountId && (
                                <a
                                  href={metaManagerUrl(accountId, { campaignId: c.id })}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-400 hover:text-blue-300"
                                  title="Abrir en Meta"
                                >
                                  <ExternalLink size={14} />
                                </a>
                              )}
                            </td>
                          </tr>
                          {isOpen &&
                            (adsets.length === 0 && loadingAdsets !== c.id ? (
                              <tr className="bg-slate-900/40">
                                <td colSpan={16} className="py-4 px-8 text-slate-500 text-xs">
                                  Sin conjuntos de anuncios en este período
                                </td>
                              </tr>
                            ) : (
                              adsets.map((as) => {
                                const asOpen = expandedAdset === as.id;
                                const ads = adsByAdset[as.id] || [];
                                return (
                                  <React.Fragment key={as.id}>
                                    <tr
                                      className="bg-slate-900/50 border-b border-slate-800/60 cursor-pointer hover:bg-slate-900/70"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleAdset(as.id);
                                      }}
                                    >
                                      <td className="py-2 px-3 pl-8 text-violet-400">
                                        {loadingAds === as.id ? (
                                          <Loader2 size={12} className="animate-spin" />
                                        ) : asOpen ? (
                                          <ChevronDown size={12} />
                                        ) : (
                                          <ChevronRight size={12} />
                                        )}
                                      </td>
                                      <td className="py-2 px-3">
                                        <div className="flex items-center gap-2">
                                          <Layers size={12} className="text-violet-400 shrink-0" />
                                          <div>
                                            <span className="text-slate-200 text-xs font-medium">{as.name}</span>
                                            <span className="text-[10px] text-slate-500 font-mono block">{as.id}</span>
                                          </div>
                                        </div>
                                      </td>
                                      <td className="py-2 px-3">{statusBadge(as.status)}</td>
                                      <td className="py-2 px-3 text-xs text-slate-500">—</td>
                                      <MetricsCells row={as} />
                                      <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                                        {accountId && (
                                          <a
                                            href={metaManagerUrl(accountId, { campaignId: c.id, adsetId: as.id })}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-400/80 hover:text-blue-300"
                                          >
                                            <ExternalLink size={12} />
                                          </a>
                                        )}
                                      </td>
                                    </tr>
                                    {asOpen &&
                                      ads.map((ad) => (
                                        <tr key={ad.id} className="bg-slate-950/60 border-b border-slate-800/40">
                                          <td className="py-1.5 px-3" />
                                          <td className="py-1.5 px-3 pl-14">
                                            <div className="flex items-center gap-2">
                                              <Image size={11} className="text-cyan-500 shrink-0" />
                                              <div>
                                                <span className="text-slate-400 text-xs">{ad.name}</span>
                                                <span className="text-[10px] text-slate-600 font-mono block">{ad.id}</span>
                                              </div>
                                            </div>
                                          </td>
                                          <td className="py-1.5 px-3">{statusBadge(ad.status)}</td>
                                          <td className="py-1.5 px-3 text-xs text-slate-600">—</td>
                                          <MetricsCells row={ad} />
                                          <td className="py-1.5 px-3">
                                            {accountId && (
                                              <a
                                                href={metaManagerUrl(accountId, {
                                                  campaignId: c.id,
                                                  adsetId: as.id,
                                                  adId: ad.id
                                                })}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-blue-400/70 hover:text-blue-300"
                                              >
                                                <ExternalLink size={11} />
                                              </a>
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    {asOpen && ads.length === 0 && loadingAds !== as.id && (
                                      <tr className="bg-slate-950/40">
                                        <td colSpan={16} className="py-2 pl-20 text-slate-600 text-xs">
                                          Sin anuncios con métricas en el período
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                );
                              })
                            ))}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-[11px] text-slate-500 flex items-start gap-2">
            <Download size={12} className="shrink-0 mt-0.5" />
            El Excel incluye hojas de resumen, campañas, conjuntos y anuncios. Los enlaces externos abren la entidad
            seleccionada en el Administrador de anuncios de Meta.
          </p>
        </>
      )}
    </div>
  );
};

export default MetaAdsCampaigns;
