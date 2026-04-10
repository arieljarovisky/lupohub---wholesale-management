import React, { useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  RefreshCw,
  MousePointerClick,
  Eye,
  Wallet,
  TrendingUp,
  Percent,
  BarChart3,
  CalendarRange,
  AlertCircle,
  FileSpreadsheet,
  Download,
  BookOpen,
  ChevronDown,
  Sparkles,
  LayoutGrid
} from 'lucide-react';
import { api } from '../services/api';
import { formatMoneyAr } from '../utils/moneyFormat';
import { useNotification } from '../context/NotificationContext';
import { computeProductAdsTotals } from '../utils/productAdsExport';
import {
  buildBrandDisplayBaseName,
  downloadBrandDisplayCampaignsCsv,
  downloadBrandDisplayExcel,
  downloadSingleBrandDisplayCampaignCsv,
  downloadSingleBrandDisplayCampaignExcel,
  fetchAllBrandCampaignsForExport,
  fetchAllDisplayCampaignsForExport
} from '../utils/brandDisplayAdsExport';

type AdvertiserRow = { advertiser_id: number; site_id: string; advertiser_name: string; account_name: string };

export type MercadoAdsKind = 'brand' | 'display';

function toNum(v: unknown): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatPct(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toLocaleString('es-AR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

function formatRoas(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '—';
  return `${value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const GLOSSARY_BRAND: { term: string; text: string }[] = [
  {
    term: 'Brand Ads',
    text: 'Publicidad de marca en Mercado Libre (búsqueda y posición destacada). Las métricas vienen por campaña según la API oficial.'
  },
  {
    term: 'Inversión · costo',
    text: 'Equivale al presupuesto consumido en el período (en la API suele figurar como consumed_budget).'
  },
  {
    term: 'Ventas (importe atrib.)',
    text: 'Importe asociado a conversiones según el bloque de atribución de la API (p. ej. event_time.units_amount en Brand Ads).'
  },
  {
    term: 'ROAS / ACOS',
    text: 'ROAS: retorno por peso invertido cuando podemos derivarlo de costo e importe. ACOS: costo sobre ventas cuando la API lo informa.'
  }
];

const GLOSSARY_DISPLAY: { term: string; text: string }[] = [
  {
    term: 'Display Ads',
    text: 'Campañas display en el ecosistema Mercado Libre (habilitación vía asesor comercial). Métricas por campaña en el período elegido.'
  },
  {
    term: 'Alcance y frecuencia',
    text: 'En display pueden aparecer métricas como alcance (reach) o frecuencia; la tabla prioriza costo, impresiones, clics y ventas atribuidas.'
  },
  {
    term: 'Resumen global',
    text: 'Los KPI inferiores agregan todas las campañas del anunciante en el rango (hasta 200 campañas con métricas en el servidor; si hay más, puede mostrarse un aviso).'
  }
];

const CFG: Record<
  MercadoAdsKind,
  {
    title: string;
    shortLabel: string;
    exportPrefix: string;
    productTitle: string;
    loadAdvertisers: () => Promise<{ advertisers: AdvertiserRow[] }>;
    loadCampaigns: (p: {
      advertiser_id: number;
      date_from: string;
      date_to: string;
      limit: number;
      offset: number;
    }) => Promise<{ results: any[]; paging?: { total: number }; metrics_summary?: Record<string, number>; summary_partial?: boolean }>;
    emptyCopy: string;
    errorTitle: string;
    glossary: { term: string; text: string }[];
    Icon: typeof Sparkles;
    theme: 'violet' | 'fuchsia';
  }
> = {
  brand: {
    title: 'Brand Ads — campañas',
    shortLabel: 'Brand Ads',
    exportPrefix: 'BrandAds',
    productTitle: 'Brand Ads',
    loadAdvertisers: () => api.getMercadoLibreBrandAdsAdvertisers(),
    loadCampaigns: (p) =>
      api.getMercadoLibreBrandAdsCampaigns({
        advertiser_id: p.advertiser_id,
        date_from: p.date_from,
        date_to: p.date_to,
        limit: p.limit,
        offset: p.offset
      }),
    emptyCopy: 'No hay cuentas con Brand Ads asociadas a esta integración.',
    errorTitle: 'Brand Ads no disponible',
    glossary: GLOSSARY_BRAND,
    Icon: Sparkles,
    theme: 'violet'
  },
  display: {
    title: 'Display Ads — campañas',
    shortLabel: 'Display Ads',
    exportPrefix: 'DisplayAds',
    productTitle: 'Display Ads',
    loadAdvertisers: () => api.getMercadoLibreDisplayAdsAdvertisers(),
    loadCampaigns: (p) =>
      api.getMercadoLibreDisplayAdsCampaigns({
        advertiser_id: p.advertiser_id,
        date_from: p.date_from,
        date_to: p.date_to,
        limit: p.limit,
        offset: p.offset
      }),
    emptyCopy: 'No hay cuentas con Display Ads asociadas a esta integración.',
    errorTitle: 'Display Ads no disponible',
    glossary: GLOSSARY_DISPLAY,
    Icon: LayoutGrid,
    theme: 'fuchsia'
  }
};

export interface MercadoLibreBrandDisplayAdsProps {
  kind: MercadoAdsKind;
}

const MercadoLibreBrandDisplayAdsInner: React.FC<{ kind: MercadoAdsKind }> = ({ kind }) => {
  const cfg = CFG[kind];
  const { showToast } = useNotification();
  const [advertisers, setAdvertisers] = useState<AdvertiserRow[]>([]);
  const [advError, setAdvError] = useState<string | null>(null);
  const [loadingAdv, setLoadingAdv] = useState(true);

  const [siteId, setSiteId] = useState('');
  const [advertiserId, setAdvertiserId] = useState<number | ''>('');

  const today = useMemo(() => new Date(), []);
  const [dateFrom, setDateFrom] = useState(() => {
    const t = new Date();
    t.setDate(t.getDate() - 29);
    return ymd(t);
  });
  const [dateTo, setDateTo] = useState(() => ymd(today));

  const PAGE = 50;

  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [campaignTotal, setCampaignTotal] = useState(0);
  const [campaignOffset, setCampaignOffset] = useState(0);
  const [metricsSummary, setMetricsSummary] = useState<Record<string, number> | null>(null);
  const [summaryPartial, setSummaryPartial] = useState(false);

  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [advRetry, setAdvRetry] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const [exportingFull, setExportingFull] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingAdv(true);
      setAdvError(null);
      try {
        const res = await cfg.loadAdvertisers();
        if (cancelled) return;
        const list = Array.isArray(res?.advertisers) ? res.advertisers : [];
        setAdvertisers(list);
        if (list.length > 0) {
          setSiteId((prev) => prev || list[0].site_id);
          setAdvertiserId((prev) => (prev === '' ? list[0].advertiser_id : prev));
        }
      } catch (e: any) {
        if (cancelled) return;
        const msg = e?.response?.data?.message || e?.message || 'No se pudieron cargar los anunciantes';
        setAdvError(msg);
        setAdvertisers([]);
      } finally {
        if (!cancelled) setLoadingAdv(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [advRetry, kind]);

  useEffect(() => {
    if (advertiserId === '') return;
    let cancelled = false;
    setLoadingData(true);
    setDataError(null);
    (async () => {
      try {
        const campRes = await cfg.loadCampaigns({
          advertiser_id: advertiserId as number,
          date_from: dateFrom,
          date_to: dateTo,
          limit: PAGE,
          offset: campaignOffset
        });
        if (cancelled) return;
        const cResults = Array.isArray(campRes?.results) ? campRes.results : [];
        setCampaigns(cResults);
        setCampaignTotal(campRes?.paging?.total ?? cResults.length);
        setMetricsSummary(
          campRes?.metrics_summary && typeof campRes.metrics_summary === 'object'
            ? campRes.metrics_summary
            : null
        );
        setSummaryPartial(!!campRes?.summary_partial);
      } catch (e: any) {
        if (cancelled) return;
        const msg = e?.response?.data?.message || e?.message || 'Error cargando métricas';
        setDataError(msg);
        setCampaigns([]);
        setCampaignTotal(0);
        setMetricsSummary(null);
        setSummaryPartial(false);
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [advertiserId, dateFrom, dateTo, campaignOffset, refreshTick, kind]);

  const totalsExport = useMemo(() => computeProductAdsTotals(metricsSummary, campaigns), [metricsSummary, campaigns]);

  const setPresetDays = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    setDateFrom(ymd(start));
    setDateTo(ymd(end));
    setCampaignOffset(0);
  };

  const selectedAdvertiserLabel = useMemo(() => {
    const a = advertisers.find((x) => x.site_id === siteId && x.advertiser_id === advertiserId);
    return a ? `${a.advertiser_name} (${a.site_id})` : '';
  }, [advertisers, siteId, advertiserId]);

  const accountLabelForExport = useMemo(() => {
    const a = advertisers.find((x) => x.site_id === siteId && x.advertiser_id === advertiserId);
    return a?.account_name || a?.advertiser_name || siteId || 'cuenta';
  }, [advertisers, siteId, advertiserId]);

  const runExportExcel = (scopeNote: string, camp: any[], ms: Record<string, number> | null) => {
    downloadBrandDisplayExcel({
      meta: {
        siteId,
        advertiserId: advertiserId as number,
        accountLabel: accountLabelForExport,
        dateFrom,
        dateTo,
        exportedAt: new Date().toLocaleString('es-AR'),
        scopeNote,
        productTitle: cfg.productTitle
      },
      metricsSummary: ms,
      totals: computeProductAdsTotals(ms, camp),
      campaigns: camp
    });
  };

  const handleExportExcelCurrent = () => {
    try {
      runExportExcel(
        'Vista actual: filas visibles según paginación en pantalla (no necesariamente todo el período).',
        campaigns,
        metricsSummary
      );
      showToast('success', 'Archivo Excel generado');
    } catch (e: any) {
      showToast('error', e?.message || 'Error al exportar');
    }
  };

  const handleExportExcelFull = async () => {
    if (advertiserId === '') return;
    setExportingFull(true);
    try {
      const { campaigns: allCamp, metricsSummary: ms } =
        kind === 'brand'
          ? await fetchAllBrandCampaignsForExport(advertiserId as number, dateFrom, dateTo)
          : await fetchAllDisplayCampaignsForExport(advertiserId as number, dateFrom, dateTo);
      runExportExcel(
        'Período completo: todas las campañas disponibles en la API para las fechas elegidas.',
        allCamp,
        ms
      );
      showToast('success', `Excel generado (${allCamp.length} campañas)`);
    } catch (e: any) {
      showToast('error', e?.response?.data?.message || e?.message || 'Error al exportar');
    } finally {
      setExportingFull(false);
    }
  };

  const handleExportCsvCurrent = () => {
    try {
      const base = buildBrandDisplayBaseName(cfg.exportPrefix, siteId, dateFrom, dateTo);
      downloadBrandDisplayCampaignsCsv(campaigns, `${base}_vista`);
      showToast('success', 'CSV de campañas descargado');
    } catch (e: any) {
      showToast('error', e?.message || 'Error al exportar CSV');
    }
  };

  const handleExportCsvFull = async () => {
    if (advertiserId === '') return;
    setExportingFull(true);
    try {
      const { campaigns: allCamp } =
        kind === 'brand'
          ? await fetchAllBrandCampaignsForExport(advertiserId as number, dateFrom, dateTo)
          : await fetchAllDisplayCampaignsForExport(advertiserId as number, dateFrom, dateTo);
      const base = buildBrandDisplayBaseName(cfg.exportPrefix, siteId, dateFrom, dateTo);
      downloadBrandDisplayCampaignsCsv(allCamp, `${base}_completo`);
      showToast('success', `CSV listo (${allCamp.length} campañas)`);
    } catch (e: any) {
      showToast('error', e?.response?.data?.message || e?.message || 'Error al exportar');
    } finally {
      setExportingFull(false);
    }
  };

  const ringClass =
    cfg.theme === 'violet'
      ? 'border-violet-800/50 from-violet-950/40'
      : 'border-fuchsia-800/50 from-fuchsia-950/40';
  const btnPrimary =
    cfg.theme === 'violet'
      ? 'bg-violet-600 hover:bg-violet-500'
      : 'bg-fuchsia-600 hover:bg-fuchsia-500';
  const btnSecondary =
    cfg.theme === 'violet'
      ? 'bg-violet-800/90 hover:bg-violet-700 border-violet-600/50'
      : 'bg-fuchsia-800/90 hover:bg-fuchsia-700 border-fuchsia-600/50';

  if (loadingAdv) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
        <Loader2 className={`animate-spin ${cfg.theme === 'violet' ? 'text-violet-500' : 'text-fuchsia-500'}`} size={36} />
        <p className="text-sm">Conectando con Mercado Ads…</p>
      </div>
    );
  }

  if (advError) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6 flex gap-4">
        <AlertCircle className="text-amber-400 shrink-0 mt-0.5" size={22} />
        <div>
          <h3 className="text-amber-200 font-semibold mb-1">{cfg.errorTitle}</h3>
          <p className="text-sm text-slate-400 mb-4">{advError}</p>
          <button
            type="button"
            onClick={() => setAdvRetry((t) => t + 1)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-sm hover:bg-slate-700"
          >
            <RefreshCw size={16} /> Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (advertisers.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-700 bg-slate-900/50 p-8 text-center text-slate-400">
        <cfg.Icon className="mx-auto mb-3 text-slate-500" size={40} />
        <p className="text-sm">{cfg.emptyCopy}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end gap-4 flex-wrap">
        <div className="flex flex-col gap-1 min-w-[200px]">
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Cuenta / anunciante</label>
          <select
            value={`${siteId}|${advertiserId}`}
            onChange={(e) => {
              const [s, aid] = e.target.value.split('|');
              setSiteId(s);
              setAdvertiserId(aid ? Number(aid) : '');
              setCampaignOffset(0);
            }}
            className={`bg-slate-900 border rounded-xl px-3 py-2.5 text-sm text-white focus:ring-2 focus:border-transparent ${
              cfg.theme === 'violet'
                ? 'border-slate-700 focus:ring-violet-600/50 focus:border-violet-600'
                : 'border-slate-700 focus:ring-fuchsia-600/50 focus:border-fuchsia-600'
            }`}
          >
            {advertisers.map((a) => (
              <option key={`${a.site_id}-${a.advertiser_id}`} value={`${a.site_id}|${a.advertiser_id}`}>
                {a.account_name || a.advertiser_name} — {a.site_id}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Desde</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setCampaignOffset(0);
              }}
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Hasta</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setCampaignOffset(0);
              }}
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-slate-500 self-center mr-1">Rango:</span>
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setPresetDays(d)}
                className="px-3 py-2 rounded-xl text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
              >
                {d} días
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setRefreshTick((t) => t + 1)}
            disabled={loadingData}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-slate-950 font-semibold text-sm disabled:opacity-50 ${btnPrimary}`}
          >
            {loadingData ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
            Actualizar
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
        <CalendarRange size={14} />
        Los datos suelen actualizarse una vez al día. Período máximo consultable en la API: 90 días (Display desde sep/2022 según documentación).
        {selectedAdvertiserLabel ? <span className="text-slate-600">· {selectedAdvertiserLabel}</span> : null}
      </p>

      {summaryPartial && kind === 'display' ? (
        <p className="text-xs text-amber-400/90">
          Nota: el resumen global suma métricas de hasta 200 campañas; si tenés más, los KPI pueden ser parciales.
        </p>
      ) : null}

      <div
        className={`rounded-2xl border bg-gradient-to-br to-slate-900/80 p-4 sm:p-5 shadow-lg shadow-black/20 ${ringClass}`}
      >
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <FileSpreadsheet size={20} className="text-emerald-400 shrink-0" />
              Exportar métricas
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-xl">
              Descargá todas las <strong className="text-slate-300">campañas</strong> del período (Excel o CSV). Para una
              sola campaña usá los iconos en la tabla.
            </p>
          </div>
          {exportingFull ? (
            <span className="text-xs text-emerald-300/90 inline-flex items-center gap-1.5 shrink-0">
              <Loader2 size={14} className="animate-spin" /> Generando archivo…
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={loadingData || exportingFull}
            onClick={handleExportExcelCurrent}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold shadow-md shadow-emerald-900/30 disabled:opacity-40"
          >
            <FileSpreadsheet size={18} />
            Excel · vista actual
          </button>
          <button
            type="button"
            disabled={loadingData || exportingFull}
            onClick={() => void handleExportExcelFull()}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-emerald-50 text-sm font-semibold border disabled:opacity-40 ${btnSecondary}`}
          >
            <FileSpreadsheet size={18} />
            Excel · período completo
          </button>
          <button
            type="button"
            disabled={loadingData || exportingFull}
            onClick={handleExportCsvCurrent}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium border border-slate-600/80 disabled:opacity-40"
          >
            <Download size={18} />
            CSV · vista actual
          </button>
          <button
            type="button"
            disabled={loadingData || exportingFull}
            onClick={() => void handleExportCsvFull()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium border border-slate-600/80 disabled:opacity-40"
          >
            <Download size={18} />
            CSV · período completo
          </button>
        </div>
        <p className="text-[11px] text-slate-500 mt-3">
          Excel incluye hojas <strong className="text-slate-500">Resumen</strong> y <strong className="text-slate-500">Campañas</strong>.
          CSV separador <strong className="text-slate-500">;</strong>.
        </p>
      </div>

      <div
        className={`rounded-xl border px-4 py-3 text-xs text-slate-400 leading-relaxed ${
          cfg.theme === 'violet' ? 'border-violet-900/35 bg-violet-950/15' : 'border-fuchsia-900/35 bg-fuchsia-950/15'
        }`}
      >
        <span className={`font-semibold ${cfg.theme === 'violet' ? 'text-violet-200/90' : 'text-fuchsia-200/90'}`}>
          Vista de datos:
        </span>{' '}
        tabla por campaña; KPIs del período al final. Exportación masiva arriba.
      </div>

      {dataError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300 flex items-start gap-2">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          {dataError}
        </div>
      )}

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <cfg.Icon size={18} className="shrink-0 text-yellow-500" /> Métricas por campaña
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-2xl">
              Cada fila es una <strong className="text-slate-400">campaña</strong> de {cfg.shortLabel}. Costo, ventas
              atribuidas, ROAS, ACOS, impresiones y clics en el período elegido (según API Mercado Ads).
            </p>
          </div>
          <span className="text-xs text-slate-500 shrink-0">{campaignTotal} campañas en total</span>
        </div>
        <div className="overflow-x-auto -mx-2">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-800">
                <th className="pb-2 pr-4">Campaña</th>
                <th className="pb-2 pr-4">Estado</th>
                <th className="pb-2 pr-4 text-right">Total invertido</th>
                <th className="pb-2 pr-4 text-right">Ventas atrib.</th>
                <th className="pb-2 pr-4 text-right">ROAS</th>
                <th className="pb-2 pr-4 text-right">ACOS</th>
                <th className="pb-2 pr-4 text-right">Clicks</th>
                <th className="pb-2 pr-2 text-right">Impres.</th>
                <th className="pb-2 pl-2 text-right w-[100px]">
                  <span className="text-[10px] uppercase tracking-wide text-slate-500 leading-tight block">
                    Solo esta
                    <br />
                    campaña
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {campaigns.map((c) => {
                const m = c.metrics || {};
                return (
                  <tr key={String(c.id)} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                    <td className="py-2.5 pr-4 max-w-[220px]">
                      <span className="text-white font-medium truncate block">{c.name || c.id}</span>
                      <span className="text-[10px] text-slate-600">#{c.id}</span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-lg ${
                          c.status === 'active' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-700 text-slate-400'
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">${formatMoneyAr(toNum(m.cost))}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">${formatMoneyAr(toNum(m.total_amount))}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{formatRoas(toNum(m.roas))}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{formatPct(toNum(m.acos))}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{toNum(m.clicks).toLocaleString('es-AR')}</td>
                    <td className="py-2.5 pr-2 text-right tabular-nums">{toNum(m.prints).toLocaleString('es-AR')}</td>
                    <td className="py-2.5 pl-2 text-right align-middle">
                      <div className="inline-flex items-center gap-0.5 justify-end">
                        <button
                          type="button"
                          title="Descargar CSV solo con esta campaña"
                          className="p-2 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-300 border border-slate-700/80 transition-colors"
                          onClick={() => {
                            downloadSingleBrandDisplayCampaignCsv(c, { dateFrom, dateTo });
                            showToast('success', 'CSV de la campaña descargado');
                          }}
                        >
                          <Download size={16} className="text-emerald-400/90" aria-hidden />
                        </button>
                        <button
                          type="button"
                          title="Descargar Excel solo con esta campaña"
                          disabled={advertiserId === ''}
                          className="p-2 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-300 border border-slate-700/80 transition-colors disabled:opacity-40"
                          onClick={() => {
                            if (advertiserId === '') return;
                            downloadSingleBrandDisplayCampaignExcel(c, {
                              accountLabel: accountLabelForExport,
                              siteId,
                              advertiserId: advertiserId as number,
                              dateFrom,
                              dateTo,
                              productTitle: cfg.productTitle
                            });
                            showToast('success', 'Excel de la campaña descargado');
                          }}
                        >
                          <FileSpreadsheet size={16} className="text-emerald-400/90" aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {campaigns.length === 0 && !loadingData && (
          <p className="text-sm text-slate-500 py-6 text-center">No hay campañas en esta página o sin datos en el período.</p>
        )}
        {campaignTotal > PAGE && (
          <div className="flex justify-center gap-2 mt-4">
            <button
              type="button"
              disabled={campaignOffset === 0 || loadingData}
              onClick={() => setCampaignOffset((o) => Math.max(0, o - PAGE))}
              className="px-3 py-1.5 rounded-lg bg-slate-800 text-sm disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={campaignOffset + PAGE >= campaignTotal || loadingData}
              onClick={() => setCampaignOffset((o) => o + PAGE)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 text-sm disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        )}
      </div>

      <details className="rounded-2xl border border-slate-700/80 bg-slate-900/45 open:bg-slate-900/55 open:[&_.gloss-chevron]:rotate-180">
        <summary className="px-4 py-3.5 cursor-pointer list-none flex items-center justify-between gap-3 text-sm font-semibold text-slate-100 select-none [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2 min-w-0">
            <BookOpen size={18} className="text-yellow-500 shrink-0" aria-hidden />
            <span className="truncate">Glosario breve</span>
          </span>
          <ChevronDown
            size={18}
            className="gloss-chevron text-slate-500 shrink-0 transition-transform duration-200"
            aria-hidden
          />
        </summary>
        <div className="px-4 pb-4 pt-0 border-t border-slate-800/80">
          <dl className="space-y-4 text-sm mt-3">
            {cfg.glossary.map((item) => (
              <div key={item.term} className="border-b border-slate-800/60 pb-4 last:border-0 last:pb-0">
                <dt className="text-yellow-500/95 font-semibold mb-1">{item.term}</dt>
                <dd className="text-slate-400 leading-relaxed">{item.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      </details>

      <div className="space-y-3 pt-2 border-t border-slate-800/80">
        <div>
          <h3 className="text-base font-bold text-white">Métricas resumidas del período</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-3xl">
            Totales consolidados del rango (origen: resumen de API cuando existe; si no, coherente con las filas cargadas).
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {[
            {
              label: 'Inversión',
              value: `$${formatMoneyAr(totalsExport.cost)}`,
              sub: 'Costo publicitario',
              icon: Wallet,
              hint: 'Suma de costo / presupuesto consumido en el período.'
            },
            {
              label: 'Ventas atrib.',
              value: `$${formatMoneyAr(totalsExport.totalAmount)}`,
              sub: 'Importe',
              icon: TrendingUp,
              hint: 'Importe atribuido según el modelo de la API en pantalla.'
            },
            {
              label: 'ROAS',
              value: formatRoas(totalsExport.roas),
              sub: 'Retorno / inversión',
              icon: BarChart3,
              hint: 'Retorno sobre inversión publicitaria cuando hay costo e importe.'
            },
            {
              label: 'ACOS',
              value: formatPct(totalsExport.acos),
              sub: 'Costo / ventas',
              icon: Percent,
              hint: 'Porcentaje del facturado atribuido que representa el gasto.'
            },
            {
              label: 'Impresiones',
              value: totalsExport.prints.toLocaleString('es-AR'),
              sub: 'Prints',
              icon: Eye,
              hint: 'Impresiones agregadas del resumen o de las filas visibles.'
            },
            {
              label: 'Clicks',
              value: totalsExport.clicks.toLocaleString('es-AR'),
              sub: `CTR ${formatPct(totalsExport.ctr)}`,
              icon: MousePointerClick,
              hint: 'Clics y CTR derivados del resumen o de las filas cargadas.'
            }
          ].map((card) => (
            <div
              key={card.label}
              title={card.hint}
              className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-lg shadow-black/20 cursor-help"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{card.label}</span>
                <card.icon size={16} className="text-yellow-500/80" />
              </div>
              <p className="text-lg font-bold text-white tabular-nums leading-tight">{card.value}</p>
              <p className="text-[11px] text-slate-500 mt-1">{card.sub}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const MercadoLibreBrandAds: React.FC = () => <MercadoLibreBrandDisplayAdsInner kind="brand" />;
export const MercadoLibreDisplayAds: React.FC = () => <MercadoLibreBrandDisplayAdsInner kind="display" />;

const MercadoLibreBrandDisplayAds: React.FC<MercadoLibreBrandDisplayAdsProps> = ({ kind }) => (
  <MercadoLibreBrandDisplayAdsInner kind={kind} />
);

export default MercadoLibreBrandDisplayAds;
