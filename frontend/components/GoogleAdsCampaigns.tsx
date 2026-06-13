import React, { useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  RefreshCw,
  Chrome,
  MousePointerClick,
  Eye,
  Wallet,
  TrendingUp,
  Percent,
  BarChart3,
  CalendarRange,
  AlertCircle,
  ExternalLink
} from 'lucide-react';
import { api } from '../services/api';
import { formatMoneyAr } from '../utils/moneyFormat';
import { useNotification } from '../context/NotificationContext';

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

const GoogleAdsCampaigns: React.FC = () => {
  const { showToast } = useNotification();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return ymd(d);
  });
  const [dateTo, setDateTo] = useState(() => ymd(new Date()));

  const loadCampaigns = async () => {
    setLoading(true);
    setError(null);
    setNotConfigured(false);
    try {
      const res = await api.getGoogleAdsCampaigns({ date_from: dateFrom, date_to: dateTo });
      setCampaigns(Array.isArray(res.campaigns) ? res.campaigns : []);
      setSummary(res.summary || {});
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || 'Error cargando campañas Google';
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
  };

  useEffect(() => {
    loadCampaigns();
  }, [dateFrom, dateTo]);

  const kpis = useMemo(
    () => [
      { label: 'Inversión', value: `$${formatMoneyAr(summary.cost || 0)}`, icon: Wallet, color: 'text-red-400' },
      { label: 'Impresiones', value: (summary.impressions || 0).toLocaleString('es-AR'), icon: Eye, color: 'text-cyan-400' },
      { label: 'Clics', value: (summary.clicks || 0).toLocaleString('es-AR'), icon: MousePointerClick, color: 'text-emerald-400' },
      { label: 'CTR', value: formatPct(summary.ctr || 0), icon: Percent, color: 'text-amber-400' },
      { label: 'CPC prom.', value: summary.cpc ? `$${formatMoneyAr(summary.cpc)}` : '—', icon: BarChart3, color: 'text-violet-400' },
      { label: 'Conversiones', value: (summary.conversions || 0).toLocaleString('es-AR'), icon: TrendingUp, color: 'text-green-400' }
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
              <h2 className="text-lg font-bold text-white">Google Ads no configurado</h2>
              <p className="text-slate-400 text-sm mt-2">
                Un administrador debe completar la configuración en{' '}
                <strong className="text-slate-300">Configuración → Integraciones → Google Ads</strong>: Customer ID,
                developer token, refresh token OAuth, y en el servidor{' '}
                <code className="text-xs text-slate-500">GOOGLE_ADS_CLIENT_ID</code> /{' '}
                <code className="text-xs text-slate-500">GOOGLE_ADS_CLIENT_SECRET</code>.
              </p>
            </div>
          </div>
        </div>
        <a
          href="https://ads.google.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-sm"
        >
          <ExternalLink size={16} /> Abrir Google Ads
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Chrome className="text-red-400" size={22} />
            Campañas Google Ads
          </h2>
          <p className="text-slate-400 text-sm mt-1">Búsqueda, display, shopping y más — métricas agregadas por campaña.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CalendarRange size={16} className="text-slate-500" />
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
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-900/20 p-4 text-red-300 text-sm flex gap-2">
          <AlertCircle size={18} className="shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-red-500" size={40} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {kpis.map((k) => (
              <div key={k.label} className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <k.icon size={14} className={k.color} />
                  <span className="text-[10px] text-slate-500 uppercase font-bold">{k.label}</span>
                </div>
                <p className="text-white font-bold text-sm tabular-nums">{k.value}</p>
              </div>
            ))}
          </div>

          <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
            <div className="p-4 border-b border-slate-700/50">
              <h3 className="font-bold text-white">Campañas ({campaigns.length})</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left min-w-[800px]">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-700/80">
                    <th className="py-3 px-4 font-medium">Campaña</th>
                    <th className="py-3 px-4 font-medium">Estado</th>
                    <th className="py-3 px-4 font-medium">Canal</th>
                    <th className="py-3 px-4 font-medium text-right">Inversión</th>
                    <th className="py-3 px-4 font-medium text-right">Impresiones</th>
                    <th className="py-3 px-4 font-medium text-right">Clics</th>
                    <th className="py-3 px-4 font-medium text-right">CTR</th>
                    <th className="py-3 px-4 font-medium text-right">CPC</th>
                    <th className="py-3 px-4 font-medium text-right">Conv.</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-500">
                        Sin campañas en el período
                      </td>
                    </tr>
                  ) : (
                    campaigns.map((c) => (
                      <tr key={c.id} className="border-b border-slate-800/80 text-slate-300 hover:bg-slate-800/30">
                        <td className="py-3 px-4 max-w-[220px]">
                          <span className="line-clamp-2 font-medium text-white" title={c.name}>
                            {c.name}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">{c.id}</span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${
                              c.status === 'ENABLED' ? 'bg-green-500/20 text-green-400' : 'bg-slate-600/30 text-slate-400'
                            }`}
                          >
                            {c.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-400">{c.channelType}</td>
                        <td className="py-3 px-4 text-right tabular-nums">${formatMoneyAr(c.cost)}</td>
                        <td className="py-3 px-4 text-right tabular-nums">{c.impressions.toLocaleString('es-AR')}</td>
                        <td className="py-3 px-4 text-right tabular-nums">{c.clicks.toLocaleString('es-AR')}</td>
                        <td className="py-3 px-4 text-right tabular-nums">{formatPct(c.ctr)}</td>
                        <td className="py-3 px-4 text-right tabular-nums">${formatMoneyAr(c.cpc)}</td>
                        <td className="py-3 px-4 text-right tabular-nums">{c.conversions}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default GoogleAdsCampaigns;
