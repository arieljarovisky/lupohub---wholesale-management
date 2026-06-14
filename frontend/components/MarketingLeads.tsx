import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarRange,
  ChevronRight,
  Filter,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  TrendingUp,
  UserPlus,
  Users,
  Wallet
} from 'lucide-react';
import { api, MarketingLead, MarketingLeadMetrics } from '../services/api';
import { formatMoneyAr } from '../utils/moneyFormat';
import { useNotification } from '../context/NotificationContext';
import {
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  LEAD_STAGE_LABELS,
  LEAD_STAGE_ORDER,
  SOURCE_COLORS,
  type LeadSource,
  type LeadStage
} from '../utils/marketingLeads';

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function formatRoas(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  return `${value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
}

function SourceBadge({ source }: { source: LeadSource }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${SOURCE_COLORS[source]}`}>
      {LEAD_SOURCE_LABELS[source]}
    </span>
  );
}

const EMPTY_FORM = {
  name: '',
  phone: '',
  email: '',
  source: 'WHATSAPP' as LeadSource,
  campaignName: '',
  campaignId: '',
  notes: ''
};

const MarketingLeads: React.FC = () => {
  const { showToast } = useNotification();
  const today = useMemo(() => new Date(), []);
  const monthAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  }, []);

  const [dateFrom, setDateFrom] = useState(ymd(monthAgo));
  const [dateTo, setDateTo] = useState(ymd(today));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [leads, setLeads] = useState<MarketingLead[]>([]);
  const [metrics, setMetrics] = useState<MarketingLeadMetrics | null>(null);
  const [filterSource, setFilterSource] = useState<string>('');
  const [filterStage, setFilterStage] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [leadsRes, metricsRes] = await Promise.all([
        api.getMarketingLeads({
          date_from: dateFrom,
          date_to: dateTo,
          source: filterSource || undefined,
          stage: filterStage || undefined
        }),
        api.getMarketingLeadMetrics({ date_from: dateFrom, date_to: dateTo })
      ]);
      setLeads(leadsRes.leads);
      setMetrics(metricsRes);
    } catch (e: any) {
      showToast(e?.message || 'Error cargando leads', 'error');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, filterSource, filterStage, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!form.name.trim()) {
      showToast('Ingresá el nombre del lead', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.createMarketingLead({
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        source: form.source,
        campaignName: form.campaignName.trim() || undefined,
        campaignId: form.campaignId.trim() || undefined,
        notes: form.notes.trim() || undefined
      });
      showToast('Lead registrado', 'success');
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (e: any) {
      showToast(e?.message || 'Error al crear lead', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleStageChange = async (lead: MarketingLead, stage: LeadStage) => {
    try {
      const payload: { stage: LeadStage; revenue?: number } = { stage };
      if (stage === 'SALE_CLOSED' && (lead.revenue == null || lead.revenue <= 0)) {
        const raw = window.prompt('Ingresá el monto de la venta (ARS):', '');
        if (raw == null) return;
        const revenue = Number(String(raw).replace(',', '.'));
        if (!Number.isFinite(revenue) || revenue <= 0) {
          showToast('Monto inválido', 'error');
          return;
        }
        payload.revenue = revenue;
      }
      await api.updateMarketingLead(lead.id, payload);
      showToast('Etapa actualizada', 'success');
      await load();
    } catch (e: any) {
      showToast(e?.message || 'Error al actualizar', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('¿Eliminar este lead?')) return;
    try {
      await api.deleteMarketingLead(id);
      showToast('Lead eliminado', 'success');
      await load();
    } catch (e: any) {
      showToast(e?.message || 'Error al eliminar', 'error');
    }
  };

  const funnelMax = useMemo(() => {
    if (!metrics) return 1;
    return Math.max(...LEAD_STAGE_ORDER.map((s) => metrics.funnel[s] || 0), 1);
  }, [metrics]);

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="rounded-2xl border border-teal-500/25 bg-gradient-to-br from-teal-500/10 via-slate-900/80 to-slate-900 p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-11 h-11 rounded-xl bg-teal-500/20 flex items-center justify-center">
              <Users className="text-teal-400" size={22} />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-white">Leads y embudo de ventas</h2>
              <p className="text-slate-400 text-sm mt-1 max-w-xl">
                Registrá leads por origen, seguí el recorrido hasta la venta cerrada y medí el rendimiento por campaña
                (conversión, CPA y ROAS cruzando gasto de Meta/Google). Los leads también pueden entrar solos vía webhook
                (Configuración → Integraciones → Webhooks — Leads automáticos).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium transition"
          >
            <Plus size={16} />
            Nuevo lead
          </button>
        </div>
      </div>

      {showForm && (
        <div className="rounded-2xl border border-slate-700/80 bg-slate-900/60 p-5 space-y-4">
          <h3 className="font-semibold text-white flex items-center gap-2">
            <UserPlus size={18} className="text-teal-400" />
            Registrar lead
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs text-slate-400">Nombre *</span>
              <input
                className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">Teléfono</span>
              <input
                className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">Email</span>
              <input
                className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">Origen *</span>
              <select
                className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white"
                value={form.source}
                onChange={(e) => setForm((f) => ({ ...f, source: e.target.value as LeadSource }))}
              >
                {LEAD_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {LEAD_SOURCE_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">Campaña (nombre)</span>
              <input
                className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white"
                placeholder="Ej. Verano 2026 — Remarketing"
                value={form.campaignName}
                onChange={(e) => setForm((f) => ({ ...f, campaignName: e.target.value }))}
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">ID campaña (Meta/Google)</span>
              <input
                className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white"
                placeholder="Opcional — para cruzar gasto"
                value={form.campaignId}
                onChange={(e) => setForm((f) => ({ ...f, campaignId: e.target.value }))}
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs text-slate-400">Notas</span>
            <textarea
              className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white min-h-[72px]"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={handleCreate}
              className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-medium"
            >
              {saving ? 'Guardando…' : 'Guardar lead'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-sm"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <label className="block">
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <CalendarRange size={12} /> Desde
          </span>
          <input
            type="date"
            className="mt-1 rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500">Hasta</span>
          <input
            type="date"
            className="mt-1 rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <Filter size={12} /> Origen
          </span>
          <select
            className="mt-1 rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white min-w-[140px]"
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value)}
          >
            <option value="">Todos</option>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {LEAD_SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-slate-500">Etapa</span>
          <select
            className="mt-1 rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white min-w-[140px]"
            value={filterStage}
            onChange={(e) => setFilterStage(e.target.value)}
          >
            <option value="">Todas</option>
            {LEAD_STAGE_ORDER.map((s) => (
              <option key={s} value={s}>
                {LEAD_STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </div>

      {loading && !metrics ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-teal-400" size={32} />
        </div>
      ) : (
        <>
          {metrics && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {LEAD_STAGE_ORDER.map((stage, idx) => {
                  const count = metrics.funnel[stage] || 0;
                  const prev = idx > 0 ? metrics.funnel[LEAD_STAGE_ORDER[idx - 1]] || 0 : count;
                  const drop =
                    idx > 0 && prev > 0 ? ((prev - count) / prev) * 100 : 0;
                  return (
                    <div
                      key={stage}
                      className="rounded-xl border border-slate-700/80 bg-slate-900/50 p-4 relative overflow-hidden"
                    >
                      <div
                        className="absolute bottom-0 left-0 h-1 bg-teal-500/60 transition-all"
                        style={{ width: `${(count / funnelMax) * 100}%` }}
                      />
                      <p className="text-xs text-slate-500 uppercase tracking-wide">{LEAD_STAGE_LABELS[stage]}</p>
                      <p className="text-2xl font-bold text-white mt-1 tabular-nums">{count}</p>
                      {idx > 0 && prev > 0 && (
                        <p className="text-xs text-slate-500 mt-1">
                          {drop > 0 ? `−${formatPct(drop)} vs etapa anterior` : 'Sin pérdida'}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-2 items-center text-xs text-slate-500 px-1">
                {LEAD_STAGE_ORDER.map((stage, i) => (
                  <React.Fragment key={stage}>
                    <span className="text-slate-400">{LEAD_STAGE_LABELS[stage]}</span>
                    {i < LEAD_STAGE_ORDER.length - 1 && <ChevronRight size={14} />}
                  </React.Fragment>
                ))}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: 'Leads', value: metrics.totals.leads, icon: Users },
                  { label: 'Ventas', value: metrics.totals.sales, icon: TrendingUp },
                  {
                    label: 'Ingresos',
                    value: `$${formatMoneyAr(metrics.totals.revenue)}`,
                    icon: Wallet
                  },
                  { label: 'Conversión', value: formatPct(metrics.totals.conversionRate), icon: TrendingUp },
                  {
                    label: 'CPA',
                    value: metrics.totals.cpa > 0 ? `$${formatMoneyAr(metrics.totals.cpa)}` : '—',
                    icon: Wallet
                  },
                  { label: 'ROAS', value: formatRoas(metrics.totals.roas), icon: TrendingUp }
                ].map((kpi) => (
                  <div
                    key={kpi.label}
                    className="rounded-xl border border-slate-700/60 bg-slate-900/40 px-3 py-3"
                  >
                    <div className="flex items-center gap-1.5 text-slate-500 text-xs">
                      <kpi.icon size={12} />
                      {kpi.label}
                    </div>
                    <p className="text-lg font-bold text-white mt-1 tabular-nums">
                      {typeof kpi.value === 'number' ? kpi.value.toLocaleString('es-AR') : kpi.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-slate-800 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/60">
                  <h3 className="font-semibold text-white text-sm">Indicadores por campaña</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    El gasto se obtiene de Meta/Google si vinculás el ID o nombre de campaña.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-500 border-b border-slate-800">
                        <th className="py-2.5 px-3 font-medium">Origen</th>
                        <th className="py-2.5 px-3 font-medium">Campaña</th>
                        <th className="py-2.5 px-3 font-medium text-right">Leads</th>
                        <th className="py-2.5 px-3 font-medium text-right">Ventas</th>
                        <th className="py-2.5 px-3 font-medium text-right">Ingresos</th>
                        <th className="py-2.5 px-3 font-medium text-right">Conv.</th>
                        <th className="py-2.5 px-3 font-medium text-right">Gasto</th>
                        <th className="py-2.5 px-3 font-medium text-right">CPA</th>
                        <th className="py-2.5 px-3 font-medium text-right">ROAS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.byCampaign.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="py-8 text-center text-slate-500">
                            Sin leads en el período. Registrá el primero con «Nuevo lead».
                          </td>
                        </tr>
                      ) : (
                        metrics.byCampaign.map((row) => (
                          <tr key={row.key} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                            <td className="py-2.5 px-3">
                              <SourceBadge source={row.source} />
                            </td>
                            <td className="py-2.5 px-3 text-slate-300 max-w-[200px] truncate">
                              {row.campaignName || row.campaignId || '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums">{row.leads}</td>
                            <td className="py-2.5 px-3 text-right tabular-nums">{row.sales}</td>
                            <td className="py-2.5 px-3 text-right tabular-nums">
                              ${formatMoneyAr(row.revenue)}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums">{formatPct(row.conversionRate)}</td>
                            <td className="py-2.5 px-3 text-right tabular-nums">
                              {row.spend > 0 ? `$${formatMoneyAr(row.spend)}` : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums">
                              {row.cpa > 0 ? `$${formatMoneyAr(row.cpa)}` : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums">{formatRoas(row.roas)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {metrics.bySource.length > 0 && (
                <div className="rounded-2xl border border-slate-800 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/60">
                    <h3 className="font-semibold text-white text-sm">Por origen</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-slate-500 border-b border-slate-800">
                          <th className="py-2.5 px-3 font-medium">Origen</th>
                          <th className="py-2.5 px-3 font-medium text-right">Leads</th>
                          <th className="py-2.5 px-3 font-medium text-right">Contactados</th>
                          <th className="py-2.5 px-3 font-medium text-right">Cotizados</th>
                          <th className="py-2.5 px-3 font-medium text-right">Ventas</th>
                          <th className="py-2.5 px-3 font-medium text-right">Ingresos</th>
                          <th className="py-2.5 px-3 font-medium text-right">Conv.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.bySource.map((row) => (
                          <tr key={row.source} className="border-b border-slate-800/60">
                            <td className="py-2.5 px-3">
                              <SourceBadge source={row.source} />
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums">{row.leads}</td>
                            <td className="py-2.5 px-3 text-right tabular-nums">{row.contacted}</td>
                            <td className="py-2.5 px-3 text-right tabular-nums">{row.quoted}</td>
                            <td className="py-2.5 px-3 text-right tabular-nums">{row.sales}</td>
                            <td className="py-2.5 px-3 text-right tabular-nums">${formatMoneyAr(row.revenue)}</td>
                            <td className="py-2.5 px-3 text-right tabular-nums">{formatPct(row.conversionRate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="rounded-2xl border border-slate-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between">
              <h3 className="font-semibold text-white text-sm">Listado de leads ({leads.length})</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-800">
                    <th className="py-2.5 px-3 font-medium">Lead / mensaje</th>
                    <th className="py-2.5 px-3 font-medium">Origen</th>
                    <th className="py-2.5 px-3 font-medium">Campaña</th>
                    <th className="py-2.5 px-3 font-medium">Etapa</th>
                    <th className="py-2.5 px-3 font-medium text-right">Venta</th>
                    <th className="py-2.5 px-3 font-medium">Fecha</th>
                    <th className="py-2.5 px-3 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {leads.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500">
                        <AlertCircle size={16} className="inline mr-1 opacity-60" />
                        No hay leads en este período.
                      </td>
                    </tr>
                  ) : (
                    leads.map((lead) => (
                      <tr key={lead.id} className="border-b border-slate-800/60 hover:bg-slate-800/20">
                        <td className="py-2.5 px-3 max-w-[280px]">
                          <p className="text-white font-medium">{lead.name}</p>
                          <p className="text-xs text-slate-500">
                            {[lead.phone, lead.email].filter(Boolean).join(' · ') || '—'}
                          </p>
                          {lead.notes?.trim() && (
                            <p
                              className="text-xs text-teal-300/90 mt-1 whitespace-pre-wrap break-words line-clamp-3"
                              title={lead.notes}
                            >
                              {lead.notes}
                            </p>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <SourceBadge source={lead.source} />
                        </td>
                        <td className="py-2.5 px-3 text-slate-400 text-xs max-w-[160px] truncate">
                          {lead.campaignName || lead.campaignId || '—'}
                        </td>
                        <td className="py-2.5 px-3">
                          <select
                            className="rounded-lg bg-slate-800 border border-slate-700 px-2 py-1 text-xs text-white"
                            value={lead.stage}
                            onChange={(e) => handleStageChange(lead, e.target.value as LeadStage)}
                          >
                            {LEAD_STAGE_ORDER.map((s) => (
                              <option key={s} value={s}>
                                {LEAD_STAGE_LABELS[s]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-slate-300">
                          {lead.revenue != null && lead.revenue > 0
                            ? `$${formatMoneyAr(lead.revenue)}`
                            : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-xs text-slate-500 whitespace-nowrap">
                          {new Date(lead.enteredAt).toLocaleDateString('es-AR')}
                        </td>
                        <td className="py-2.5 px-3">
                          <button
                            type="button"
                            onClick={() => handleDelete(lead.id)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10"
                            title="Eliminar"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
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

export default MarketingLeads;
