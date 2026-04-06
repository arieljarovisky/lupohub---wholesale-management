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
  AlertCircle
} from 'lucide-react';
import { api } from '../services/api';
import { formatMoneyAr } from '../utils/moneyFormat';

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

const MercadoLibreProductAds: React.FC = () => {
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

      {dataError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300 flex items-start gap-2">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          {dataError}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {[
          { label: 'Inversión', value: `$${formatMoneyAr(totals.cost)}`, sub: 'Costo publicitario', icon: Wallet },
          { label: 'Ventas atrib.', value: `$${formatMoneyAr(totals.totalAmount)}`, sub: 'Importe total', icon: TrendingUp },
          { label: 'ROAS', value: formatRoas(totals.roas), sub: 'Retorno / inversión', icon: BarChart3 },
          { label: 'ACOS', value: formatPct(totals.acos), sub: 'Costo / ventas', icon: Percent },
          { label: 'Impresiones', value: totals.prints.toLocaleString('es-AR'), sub: 'Prints', icon: Eye },
          { label: 'Clicks', value: totals.clicks.toLocaleString('es-AR'), sub: `CTR ${formatPct(totals.ctr)}`, icon: MousePointerClick }
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-lg shadow-black/20"
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

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Megaphone size={18} className="text-yellow-500" /> Campañas
          </h3>
          <span className="text-xs text-slate-500">{campaignTotal} en total</span>
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
                <th className="pb-2 text-right">Impres.</th>
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
                    <td className="py-2.5 text-right tabular-nums">{toNum(m.prints).toLocaleString('es-AR')}</td>
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
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <BarChart3 size={18} className="text-cyan-400" /> Publicaciones en publicidad
          </h3>
          <span className="text-xs text-slate-500">{adsTotal} en total</span>
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

      <div className="rounded-xl border border-slate-800 bg-slate-900/30 px-4 py-3 text-xs text-slate-500">
        <strong className="text-slate-400">Cómo usar estas métricas:</strong> compará ROAS y ACOS entre campañas y
        publicaciones, identificá anuncios con muchas impresiones y poco retorno para ajustar pujas o creatividades, y
        revisá la inversión diaria frente al presupuesto de cada campaña en el panel de Mercado Libre.
      </div>
    </div>
  );
};

export default MercadoLibreProductAds;
