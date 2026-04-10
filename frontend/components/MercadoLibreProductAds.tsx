import React, { useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  RefreshCw,
  Megaphone,
  MousePointerClick,
  Eye,
  Wallet,
  TrendingUp,
  Percent,
  BarChart3,
  ExternalLink,
  CalendarRange,
  AlertCircle,
  FileSpreadsheet,
  Download,
  BookOpen,
  ChevronDown
} from 'lucide-react';
import { api } from '../services/api';
import { formatMoneyAr } from '../utils/moneyFormat';
import { useNotification } from '../context/NotificationContext';
import {
  buildExportBaseName,
  computeProductAdsTotals,
  downloadAdsCsv,
  downloadCampaignsCsv,
  downloadProductAdsExcel,
  downloadSingleCampaignCsv,
  downloadSingleCampaignExcel,
  fetchAllAdsForExport,
  fetchAllCampaignsForExport
} from '../utils/productAdsExport';

type AdvertiserRow = { advertiser_id: number; site_id: string; advertiser_name: string; account_name: string };

function toNum(v: unknown): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sumMetrics(rows: any[], key: string): number {
  return rows.reduce((acc, r) => acc + toNum(r?.metrics?.[key]), 0);
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

/** Definiciones breves para la pantalla (alineadas con métricas típicas de Mercado Ads). */
const MARKETING_GLOSSARY: { term: string; text: string }[] = [
  {
    term: 'Product Ads',
    text: 'Modalidad de publicidad de Mercado Libre que promociona publicaciones en resultados de búsqueda y espacios de descubrimiento. Aquí ves el rendimiento de esas inversiones.'
  },
  {
    term: 'Métricas por campaña y por publicación',
    text: 'Por campaña: agregás costo, ventas, ROAS, etc. a cada campaña que configuraste. Por publicación: las mismas métricas pero para cada anuncio/ítem promocionado. Sirve para ver qué campaña rinde y qué publicación conviene potenciar o pausar.'
  },
  {
    term: 'Inversión · costo publicitario',
    text: 'Dinero gastado en anuncios en el período seleccionado. Es la base para calcular eficiencia frente a las ventas.'
  },
  {
    term: 'Ventas atribuidas',
    text: 'Importe de ventas que la plataforma asocia a la publicidad (suele incluir ventas directas e indirectas según las reglas de atribución de Mercado Libre).'
  },
  {
    term: 'ROAS (Return On Ad Spend)',
    text: 'Retorno sobre la inversión publicitaria: cuántos pesos de venta generás por cada peso gastado. Ej.: 4× significa ~$4 de ventas por $1 invertido. Cuanto más alto, mejor suele ser el retorno relativo al gasto.'
  },
  {
    term: 'ACOS (Advertising Cost of Sales)',
    text: 'Costo publicitario en relación a las ventas, en porcentaje: (costo ÷ ventas) × 100. Un ACOS más bajo indica que la publicidad “pesa” menos sobre el facturado atribuido.'
  },
  {
    term: 'Impresiones',
    text: 'Cantidad de veces que se mostró tu anuncio (en la API suelen llamarse “prints”). Sirve para medir alcance y comparar con clicks.'
  },
  {
    term: 'Clicks',
    text: 'Veces que alguien hizo clic en tu anuncio. Más clicks con buen ROAS suelen indicar creatividad y oferta relevantes.'
  },
  {
    term: 'CTR (Click-Through Rate)',
    text: 'Tasa de clics: clicks ÷ impresiones, en porcentaje. Mide qué tan seguido la gente que ve el anuncio hace clic; ayuda a detectar títulos, precio o foto poco atractivos.'
  },
  {
    term: 'CPC (Costo por clic)',
    text: 'Costo promedio que pagás por cada clic (costo ÷ clicks). Útil para comparar competencia y eficiencia del tráfico pagado.'
  },
  {
    term: 'CVR (tasa de conversión)',
    text: 'Relación entre interacciones y ventas atribuidas en el modelo de la plataforma. Un CVR bajo con muchos clicks puede indicar ficha, precio o stock a revisar.'
  },
  {
    term: 'SOV (Share of Voice)',
    text: 'Participación de visibilidad de tus anuncios frente al espacio publicitario disponible (según Mercado Ads). Más SOV implica más presencia, pero conviene cruzarlo con ROAS/ACOS.'
  },
  {
    term: 'Presupuesto diario',
    text: 'Tope de gasto por día configurado en la campaña. Mercado Libre puede distribuir el gasto según subastas y días; no siempre se gasta el 100 % cada día.'
  },
  {
    term: 'Ventas directas e indirectas',
    text: 'Directa: compra ligada de forma más inmediata al anuncio. Indirecta: el usuario interactuó con la publicidad pero la compra se atribuye por otro camino dentro de las reglas de ML. Ambas suelen sumarse en “ventas totales” según el reporte.'
  },
  {
    term: 'Estrategia de campaña',
    text: 'Objetivo configurado (por ejemplo rentabilidad vs. crecimiento de ventas). Cambia cómo la plataforma optimiza pujas y presencia frente a tus metas de ROAS/ACOS.'
  }
];

const MercadoLibreProductAds: React.FC = () => {
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

  const CAMPAIGN_LIMIT = 50;
  const ADS_LIMIT = 40;

  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [campaignTotal, setCampaignTotal] = useState(0);
  const [campaignOffset, setCampaignOffset] = useState(0);
  const [ads, setAds] = useState<any[]>([]);
  const [adsTotal, setAdsTotal] = useState(0);
  const [adsOffset, setAdsOffset] = useState(0);
  const [metricsSummary, setMetricsSummary] = useState<Record<string, number> | null>(null);

  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [advRetry, setAdvRetry] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const [exportingFull, setExportingFull] = useState(false);
  const [exportingSingleCampaignId, setExportingSingleCampaignId] = useState<string | number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingAdv(true);
      setAdvError(null);
      try {
        const res = await api.getMercadoLibreProductAdsAdvertisers();
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
  }, [advRetry]);

  useEffect(() => {
    if (!siteId || advertiserId === '') return;
    let cancelled = false;
    setLoadingData(true);
    setDataError(null);
    (async () => {
      try {
        const [campRes, adsRes] = await Promise.all([
          api.getMercadoLibreProductAdsCampaigns({
            site_id: siteId,
            advertiser_id: advertiserId,
            date_from: dateFrom,
            date_to: dateTo,
            limit: CAMPAIGN_LIMIT,
            offset: campaignOffset,
            metrics_summary: true
          }),
          api.getMercadoLibreProductAdsAds({
            site_id: siteId,
            advertiser_id: advertiserId,
            date_from: dateFrom,
            date_to: dateTo,
            limit: ADS_LIMIT,
            offset: adsOffset,
            channel: 'marketplace'
          })
        ]);
        if (cancelled) return;
        const cResults = Array.isArray(campRes?.results) ? campRes.results : [];
        setCampaigns(cResults);
        setCampaignTotal(campRes?.paging?.total ?? cResults.length);
        setMetricsSummary(
          campRes?.metrics_summary && typeof campRes.metrics_summary === 'object'
            ? campRes.metrics_summary
            : null
        );

        const aResults = Array.isArray(adsRes?.results) ? adsRes.results : [];
        setAds(aResults);
        setAdsTotal(adsRes?.paging?.total ?? aResults.length);
      } catch (e: any) {
        if (cancelled) return;
        const msg = e?.response?.data?.message || e?.message || 'Error cargando métricas';
        setDataError(msg);
        setCampaigns([]);
        setAds([]);
        setCampaignTotal(0);
        setAdsTotal(0);
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [siteId, advertiserId, dateFrom, dateTo, campaignOffset, adsOffset, refreshTick]);

  const totals = useMemo(() => {
    const base = metricsSummary || {};
    const cost = toNum(base.cost) || sumMetrics(campaigns, 'cost');
    const clicks = toNum(base.clicks) || sumMetrics(campaigns, 'clicks');
    const prints = toNum(base.prints) || sumMetrics(campaigns, 'prints');
    const totalAmount = toNum(base.total_amount) || sumMetrics(campaigns, 'total_amount');
    const roasApi = toNum(base.roas);
    const acosApi = toNum(base.acos);
    const ctrApi = toNum(base.ctr);

    const roas = cost > 0 && totalAmount > 0 ? totalAmount / cost : roasApi;
    const acos = totalAmount > 0 ? (cost / totalAmount) * 100 : acosApi;
    const ctr = prints > 0 ? (clicks / prints) * 100 : ctrApi;

    return { cost, clicks, prints, totalAmount, roas, acos, ctr };
  }, [metricsSummary, campaigns]);

  const setPresetDays = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    setDateFrom(ymd(start));
    setDateTo(ymd(end));
    setCampaignOffset(0);
    setAdsOffset(0);
  };

  const selectedAdvertiserLabel = useMemo(() => {
    const a = advertisers.find((x) => x.site_id === siteId && x.advertiser_id === advertiserId);
    return a ? `${a.advertiser_name} (${a.site_id})` : '';
  }, [advertisers, siteId, advertiserId]);

  const accountLabelForExport = useMemo(() => {
    const a = advertisers.find((x) => x.site_id === siteId && x.advertiser_id === advertiserId);
    return a?.account_name || a?.advertiser_name || siteId || 'cuenta';
  }, [advertisers, siteId, advertiserId]);

  const runExportExcel = (
    scopeNote: string,
    camp: any[],
    adsRows: any[],
    ms: Record<string, number> | null
  ) => {
    const totalsExport = computeProductAdsTotals(ms, camp);
    downloadProductAdsExcel({
      meta: {
        siteId,
        advertiserId: advertiserId as number,
        accountLabel: accountLabelForExport,
        dateFrom,
        dateTo,
        exportedAt: new Date().toLocaleString('es-AR'),
        scopeNote
      },
      metricsSummary: ms,
      totals: totalsExport,
      campaigns: camp,
      ads: adsRows
    });
  };

  const handleExportExcelCurrent = () => {
    try {
      runExportExcel(
        'Vista actual: filas visibles según paginación en pantalla (no necesariamente todo el período).',
        campaigns,
        ads,
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
      const [{ campaigns: allCamp, metricsSummary: ms }, allAds] = await Promise.all([
        fetchAllCampaignsForExport(siteId, advertiserId, dateFrom, dateTo),
        fetchAllAdsForExport(siteId, advertiserId, dateFrom, dateTo)
      ]);
      runExportExcel(
        'Período completo: todas las campañas y publicaciones disponibles en la API para las fechas elegidas.',
        allCamp,
        allAds,
        ms
      );
      showToast('success', `Excel generado (${allCamp.length} campañas, ${allAds.length} publicaciones)`);
    } catch (e: any) {
      showToast('error', e?.response?.data?.message || e?.message || 'Error al exportar');
    } finally {
      setExportingFull(false);
    }
  };

  const handleExportCsvCurrent = () => {
    try {
      const base = buildExportBaseName(siteId, dateFrom, dateTo);
      downloadCampaignsCsv(campaigns, `${base}_vista`);
      downloadAdsCsv(ads, `${base}_vista`);
      showToast('success', 'Se descargaron 2 archivos CSV (campañas y publicaciones)');
    } catch (e: any) {
      showToast('error', e?.message || 'Error al exportar CSV');
    }
  };

  const handleExportCsvFull = async () => {
    if (advertiserId === '') return;
    setExportingFull(true);
    try {
      const [{ campaigns: allCamp }, allAds] = await Promise.all([
        fetchAllCampaignsForExport(siteId, advertiserId, dateFrom, dateTo),
        fetchAllAdsForExport(siteId, advertiserId, dateFrom, dateTo)
      ]);
      const base = buildExportBaseName(siteId, dateFrom, dateTo);
      downloadCampaignsCsv(allCamp, `${base}_completo`);
      downloadAdsCsv(allAds, `${base}_completo`);
      showToast('success', `CSV listo (${allCamp.length} campañas, ${allAds.length} publicaciones)`);
    } catch (e: any) {
      showToast('error', e?.response?.data?.message || e?.message || 'Error al exportar');
    } finally {
      setExportingFull(false);
    }
  };

  const handleExportAdsCsvCurrent = () => {
    try {
      const base = buildExportBaseName(siteId, dateFrom, dateTo);
      downloadAdsCsv(ads, `${base}_vista_solo_anuncios`);
      showToast('success', 'CSV listo: solo publicaciones/anuncios de la vista actual');
    } catch (e: any) {
      showToast('error', e?.message || 'Error al exportar anuncios');
    }
  };

  const handleExportAdsCsvFull = async () => {
    if (advertiserId === '') return;
    setExportingFull(true);
    try {
      const allAds = await fetchAllAdsForExport(siteId, advertiserId, dateFrom, dateTo);
      const base = buildExportBaseName(siteId, dateFrom, dateTo);
      downloadAdsCsv(allAds, `${base}_completo_solo_anuncios`);
      showToast('success', `CSV listo: ${allAds.length} publicaciones del período completo`);
    } catch (e: any) {
      showToast('error', e?.response?.data?.message || e?.message || 'Error al exportar anuncios');
    } finally {
      setExportingFull(false);
    }
  };

  if (loadingAdv) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
        <Loader2 className="animate-spin text-yellow-500" size={36} />
        <p className="text-sm">Conectando con Mercado Ads…</p>
      </div>
    );
  }

  if (advError) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6 flex gap-4">
        <AlertCircle className="text-amber-400 shrink-0 mt-0.5" size={22} />
        <div>
          <h3 className="text-amber-200 font-semibold mb-1">Product Ads no disponible</h3>
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
        <Megaphone className="mx-auto mb-3 text-slate-500" size={40} />
        <p className="text-sm">No hay cuentas con Product Ads asociadas a esta integración.</p>
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
              setAdsOffset(0);
            }}
            className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:ring-2 focus:ring-yellow-600/50 focus:border-yellow-600"
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
                setAdsOffset(0);
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
                setAdsOffset(0);
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
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-yellow-600 hover:bg-yellow-500 text-slate-950 font-semibold text-sm disabled:opacity-50"
          >
            {loadingData ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
            Actualizar
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500 flex items-center gap-2">
        <CalendarRange size={14} />
        Los datos de métricas suelen actualizarse una vez al día (referencia API Mercado Ads). Período máximo consultable: 90 días.
        {selectedAdvertiserLabel ? <span className="text-slate-600">· {selectedAdvertiserLabel}</span> : null}
      </p>

      <div className="rounded-2xl border border-emerald-800/50 bg-gradient-to-br from-emerald-950/40 to-slate-900/80 p-4 sm:p-5 shadow-lg shadow-black/20">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <FileSpreadsheet size={20} className="text-emerald-400 shrink-0" />
              Exportar métricas
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-xl">
              Descargá <strong className="text-slate-300">todas las campañas</strong> y{' '}
              <strong className="text-slate-300">todas las publicaciones</strong> del período (Excel o CSV). Para una sola
              campaña usá los iconos en la tabla de abajo.
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
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-800/90 hover:bg-emerald-700 text-emerald-50 text-sm font-semibold border border-emerald-600/50 disabled:opacity-40"
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
          <button
            type="button"
            disabled={loadingData || exportingFull}
            onClick={handleExportAdsCsvCurrent}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-900/70 hover:bg-indigo-800 text-indigo-100 text-sm font-medium border border-indigo-700/70 disabled:opacity-40"
          >
            <Download size={18} />
            CSV anuncios · vista actual
          </button>
          <button
            type="button"
            disabled={loadingData || exportingFull}
            onClick={() => void handleExportAdsCsvFull()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-900/70 hover:bg-indigo-800 text-indigo-100 text-sm font-medium border border-indigo-700/70 disabled:opacity-40"
          >
            <Download size={18} />
            CSV anuncios · período completo
          </button>
        </div>
        <p className="text-[11px] text-slate-500 mt-3">
          Excel incluye hojas <strong className="text-slate-500">Resumen</strong>, <strong className="text-slate-500">Campañas</strong> y{' '}
          <strong className="text-slate-500">Publicaciones</strong>. CSV separador <strong className="text-slate-500">;</strong>.{' '}
          <em>Período completo</em> recorre todas las filas (puede tardar).
        </p>
      </div>

      <div className="rounded-xl border border-yellow-900/35 bg-yellow-950/15 px-4 py-3 text-xs text-slate-400 leading-relaxed">
        <span className="font-semibold text-yellow-200/90">Vista de datos:</span> tablas por campaña y por publicación en el
        centro; <span className="text-slate-500">resumen de KPIs del período al final</span>. Exportación masiva arriba; una
        campaña suelta en cada fila.
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
              <Megaphone size={18} className="text-yellow-500 shrink-0" /> Métricas por campaña
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-2xl">
              Cada fila es una <strong className="text-slate-400">campaña</strong> de Product Ads. Mostramos costo, ventas
              atribuidas, ROAS, ACOS, clicks e impresiones de esa campaña en el período elegido.
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
                <th className="pb-2 pr-4 text-right">Presup. día</th>
                <th className="pb-2 pr-4 text-right">Costo</th>
                <th className="pb-2 pr-4 text-right">Ventas</th>
                <th className="pb-2 pr-4 text-right">ROAS</th>
                <th className="pb-2 pr-4 text-right">ACOS</th>
                <th className="pb-2 pr-4 text-right">Clicks</th>
                <th className="pb-2 pr-2 text-right">Impres.</th>
                <th className="pb-2 pl-2 text-right min-w-[168px] align-bottom">
                  <span className="text-[10px] uppercase tracking-wide text-slate-400 font-black block">
                    Esta campaña
                  </span>
                  <span className="text-[9px] text-slate-600 normal-case font-normal leading-snug block mt-1 max-w-[200px] ml-auto">
                    <strong className="text-emerald-500/90">Excel</strong> = archivo .xlsx con{' '}
                    <strong className="text-slate-400">2 pestañas</strong> (Datos generales + Detalle) y estilos.{' '}
                    <strong className="text-slate-500">CSV</strong> = una sola hoja, sin colores ni pestañas.
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {campaigns.map((c) => {
                const m = c.metrics || {};
                return (
                  <tr key={c.id} className="border-b border-slate-800/60 hover:bg-slate-800/30">
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
                    <td className="py-2.5 pr-4 text-right tabular-nums">{toNum(c.budget).toLocaleString('es-AR')}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">${formatMoneyAr(toNum(m.cost))}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">${formatMoneyAr(toNum(m.total_amount))}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{formatRoas(toNum(m.roas))}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{formatPct(toNum(m.acos))}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{toNum(m.clicks).toLocaleString('es-AR')}</td>
                    <td className="py-2.5 pr-2 text-right tabular-nums">{toNum(m.prints).toLocaleString('es-AR')}</td>
                    <td className="py-2.5 pl-2 text-right align-middle">
                      <div className="inline-flex items-stretch gap-1.5 justify-end">
                        <button
                          type="button"
                          title="Excel (.xlsx): 2 pestañas — Datos generales y Detalle — con colores y bordes. Recomendado."
                          aria-label="Descargar Excel con dos hojas y estilos"
                          disabled={advertiserId === '' || exportingSingleCampaignId === c.id}
                          className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-200 border-2 border-emerald-600/55 shadow-sm shadow-emerald-950/20 transition-colors disabled:opacity-40 min-w-[4.5rem]"
                          onClick={() => {
                            if (advertiserId === '') return;
                            void (async () => {
                              setExportingSingleCampaignId(c.id);
                              try {
                                await downloadSingleCampaignExcel(c, {
                                  accountLabel: accountLabelForExport,
                                  siteId,
                                  advertiserId: advertiserId as number,
                                  dateFrom,
                                  dateTo
                                });
                                showToast(
                                  'success',
                                  'Descargado .xlsx: abrí el archivo y mirá las pestañas inferiores «Datos generales» y «Detalle». Los estilos se ven mejor en Excel de escritorio que en Google Sheets.'
                                );
                              } catch (e: any) {
                                showToast('error', e?.response?.data?.message || e?.message || 'Error al exportar Excel');
                              } finally {
                                setExportingSingleCampaignId(null);
                              }
                            })();
                          }}
                        >
                          {exportingSingleCampaignId === c.id ? (
                            <Loader2 size={16} className="text-emerald-400 animate-spin" aria-hidden />
                          ) : (
                            <FileSpreadsheet size={16} className="text-emerald-400" aria-hidden />
                          )}
                          <span className="text-[9px] font-black text-emerald-300 leading-none tracking-tight">Excel</span>
                          <span className="text-[8px] text-slate-500 leading-none">2 hojas</span>
                        </button>
                        <button
                          type="button"
                          title="CSV: texto plano, una sola hoja al abrirlo; sin pestañas ni formato. Útil para importar a otros sistemas."
                          aria-label="Descargar CSV una sola hoja sin formato"
                          disabled={advertiserId === '' || exportingSingleCampaignId === c.id}
                          className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-2 rounded-xl bg-slate-800/60 hover:bg-slate-700/80 text-slate-400 border border-slate-600/50 transition-colors disabled:opacity-40 min-w-[4.25rem]"
                          onClick={() => {
                            if (advertiserId === '') return;
                            void (async () => {
                              setExportingSingleCampaignId(c.id);
                              try {
                                await downloadSingleCampaignCsv(c, {
                                  dateFrom,
                                  dateTo,
                                  siteId,
                                  advertiserId: advertiserId as number
                                });
                                showToast(
                                  'warning',
                                  'CSV = una sola hoja y sin estilos (así es el formato). Para 2 pestañas y colores usá el botón Excel (.xlsx) al lado.'
                                );
                              } catch (e: any) {
                                showToast('error', e?.response?.data?.message || e?.message || 'Error al exportar CSV');
                              } finally {
                                setExportingSingleCampaignId(null);
                              }
                            })();
                          }}
                        >
                          {exportingSingleCampaignId === c.id ? (
                            <Loader2 size={16} className="text-slate-500 animate-spin" aria-hidden />
                          ) : (
                            <Download size={16} className="text-slate-500" aria-hidden />
                          )}
                          <span className="text-[9px] font-bold text-slate-500 leading-none">CSV</span>
                          <span className="text-[8px] text-slate-600 leading-none">1 hoja</span>
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
          <p className="text-sm text-slate-500 py-6 text-center">No hay campañas en esta página o sin actividad en el período.</p>
        )}
        {campaignTotal > CAMPAIGN_LIMIT && (
          <div className="flex justify-center gap-2 mt-4">
            <button
              type="button"
              disabled={campaignOffset === 0 || loadingData}
              onClick={() => setCampaignOffset((o) => Math.max(0, o - CAMPAIGN_LIMIT))}
              className="px-3 py-1.5 rounded-lg bg-slate-800 text-sm disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={campaignOffset + CAMPAIGN_LIMIT >= campaignTotal || loadingData}
              onClick={() => setCampaignOffset((o) => o + CAMPAIGN_LIMIT)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 text-sm disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <BarChart3 size={18} className="text-cyan-400 shrink-0" /> Métricas por publicación (anuncios)
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-2xl">
              Cada fila es una <strong className="text-slate-400">publicación</strong> que está en publicidad: el rendimiento
              del anuncio de ese ítem (mismas métricas que arriba, pero a nivel ítem).
            </p>
          </div>
          <span className="text-xs text-slate-500 shrink-0">{adsTotal} publicaciones en total</span>
        </div>
        <div className="overflow-x-auto -mx-2">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-800">
                <th className="pb-2 pr-3">Publicación</th>
                <th className="pb-2 pr-3">Estado</th>
                <th className="pb-2 pr-3 text-right">Costo</th>
                <th className="pb-2 pr-3 text-right">Ventas</th>
                <th className="pb-2 pr-3 text-right">ROAS</th>
                <th className="pb-2 pr-3 text-right">Clicks</th>
                <th className="pb-2 text-right">Impres.</th>
                <th className="pb-2 w-10" />
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {ads.map((row) => {
                const m = row.metrics || {};
                return (
                  <tr key={row.item_id} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                    <td className="py-2.5 pr-3 max-w-[280px]">
                      <span className="text-white line-clamp-2">{row.title || row.item_id}</span>
                      <span className="text-[10px] text-slate-600 block">{row.item_id}</span>
                    </td>
                    <td className="py-2.5 pr-3 text-xs capitalize">{row.status}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">${formatMoneyAr(toNum(m.cost))}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">${formatMoneyAr(toNum(m.total_amount))}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{formatRoas(toNum(m.roas))}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{toNum(m.clicks).toLocaleString('es-AR')}</td>
                    <td className="py-2.5 text-right tabular-nums">{toNum(m.prints).toLocaleString('es-AR')}</td>
                    <td className="py-2.5">
                      {row.permalink ? (
                        <a
                          href={row.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-cyan-400 hover:text-cyan-300 inline-flex"
                          aria-label="Abrir en Mercado Libre"
                        >
                          <ExternalLink size={16} />
                        </a>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {ads.length === 0 && !loadingData && (
          <p className="text-sm text-slate-500 py-6 text-center">No hay anuncios con datos en el período seleccionado.</p>
        )}
        {adsTotal > ADS_LIMIT && (
          <div className="flex justify-center gap-2 mt-4">
            <button
              type="button"
              disabled={adsOffset === 0 || loadingData}
              onClick={() => setAdsOffset((o) => Math.max(0, o - ADS_LIMIT))}
              className="px-3 py-1.5 rounded-lg bg-slate-800 text-sm disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={adsOffset + ADS_LIMIT >= adsTotal || loadingData}
              onClick={() => setAdsOffset((o) => o + ADS_LIMIT)}
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
            <span className="truncate">Glosario: significado de las métricas de marketing</span>
          </span>
          <ChevronDown
            size={18}
            className="gloss-chevron text-slate-500 shrink-0 transition-transform duration-200"
            aria-hidden
          />
        </summary>
        <div className="px-4 pb-4 pt-0 border-t border-slate-800/80">
          <p className="text-xs text-slate-500 mt-3 mb-4">
            Definiciones orientativas para leer los números de Product Ads. Los cálculos exactos y la atribución los define
            Mercado Libre en su plataforma.
          </p>
          <dl className="space-y-4 text-sm">
            {MARKETING_GLOSSARY.map((item) => (
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
            Totales consolidados del rango de fechas (no reemplaza el desglose por campaña ni por publicación de las tablas).
            Pasá el mouse por cada tarjeta para una ayuda breve.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {[
            {
              label: 'Inversión',
              value: `$${formatMoneyAr(totals.cost)}`,
              sub: 'Costo publicitario',
              icon: Wallet,
              hint: 'Dinero gastado en publicidad en el período. Ver glosario arriba para más detalle.'
            },
            {
              label: 'Ventas atrib.',
              value: `$${formatMoneyAr(totals.totalAmount)}`,
              sub: 'Importe total',
              icon: TrendingUp,
              hint: 'Ventas que Mercado Libre asocia a tus anuncios en el período (atribución de la plataforma).'
            },
            {
              label: 'ROAS',
              value: formatRoas(totals.roas),
              sub: 'Retorno / inversión',
              icon: BarChart3,
              hint: 'Return On Ad Spend: pesos de venta por cada peso invertido en publicidad.'
            },
            {
              label: 'ACOS',
              value: formatPct(totals.acos),
              sub: 'Costo / ventas',
              icon: Percent,
              hint: 'Advertising Cost of Sales: % del facturado atribuido que representa el gasto en ads.'
            },
            {
              label: 'Impresiones',
              value: totals.prints.toLocaleString('es-AR'),
              sub: 'Prints',
              icon: Eye,
              hint: 'Veces que se mostró tu anuncio. En la API suelen llamarse “prints”.'
            },
            {
              label: 'Clicks',
              value: totals.clicks.toLocaleString('es-AR'),
              sub: `CTR ${formatPct(totals.ctr)}`,
              icon: MousePointerClick,
              hint: 'Clics en el anuncio. CTR = clicks ÷ impresiones (qué tan clickeable es el anuncio).'
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

      <div className="rounded-xl border border-slate-800 bg-slate-900/30 px-4 py-3 text-xs text-slate-500">
        <strong className="text-slate-400">Cómo usar estas métricas:</strong> compará campañas en la primera tabla y
        publicaciones en la segunda; cruzá ROAS y ACOS para ver dónde conviene subir o bajar presencia, y revisá presupuesto
        diario en Mercado Libre.
      </div>
    </div>
  );
};

export default MercadoLibreProductAds;
