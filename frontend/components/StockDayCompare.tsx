import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, Download, Loader2, Search, TrendingDown, TrendingUp } from 'lucide-react';
import { api } from '../services/api';
import { useNotification } from '../context/NotificationContext';

type SnapshotDay = {
  date: string;
  variants: number;
  variantsWithStock: number;
  units: number;
  takenAt: string | null;
};

type DiffRow = {
  sku: string;
  productSku: string;
  productName: string;
  color: string;
  size: string;
  fromStock: number;
  toStock: number;
  delta: number;
};

function formatDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function formatUnits(n: number): string {
  return new Intl.NumberFormat('es-AR').format(n);
}

const StockDayCompare: React.FC = () => {
  const { showToast, showConfirm } = useNotification();
  const [days, setDays] = useState<SnapshotDay[]>([]);
  const [today, setToday] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('live');
  const [loadingDays, setLoadingDays] = useState(true);
  const [saving, setSaving] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [onlyDown, setOnlyDown] = useState(true);
  const [search, setSearch] = useState('');
  const [summary, setSummary] = useState<{ variantsDown: number; unitsDown: number; variantsUp: number; unitsUp: number } | null>(null);
  const [rows, setRows] = useState<DiffRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [toLabel, setToLabel] = useState('Stock de ahora');

  const loadDays = useCallback(async () => {
    setLoadingDays(true);
    try {
      const data = await api.listStockDailySnapshots();
      const list = Array.isArray(data?.days) ? data.days : [];
      setDays(list);
      setToday(data?.today || '');
      setFrom((current) => current || list[0]?.date || data?.today || '');
    } catch (error: any) {
      showToast('error', error?.message || 'No se pudieron leer las fotos de stock');
    } finally {
      setLoadingDays(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadDays();
  }, [loadDays]);

  const compare = useCallback(async (base: string, against: string) => {
    if (!base) return;
    setComparing(true);
    try {
      const data = await api.compareStockDailySnapshots(base, against);
      setSummary(data.summary);
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setTruncated(Boolean(data.truncated));
      setToLabel(data.toLabel || 'Stock de ahora');
    } catch (error: any) {
      setSummary(null);
      setRows([]);
      showToast('error', error?.message || 'No se pudo comparar el stock');
    } finally {
      setComparing(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (from) compare(from, to);
  }, [from, to, compare]);

  const todaySaved = days.some((d) => d.date === today);
  const baseDay = days.find((d) => d.date === from);

  const saveToday = () => {
    showConfirm({
      title: todaySaved ? 'Reemplazar la foto de hoy' : 'Guardar foto del stock de hoy',
      message: todaySaved
        ? 'Ya hay una foto de hoy. Si la guardás de nuevo, queda el stock de este momento y se pierde la anterior.'
        : 'Guarda el stock de cada variante tal como está ahora. Mañana vas a poder ver qué se descontó contra esta foto.',
      confirmLabel: 'Guardar foto',
      onConfirm: () => {
        setSaving(true);
        api.createStockDailySnapshot()
          .then(async (result) => {
            showToast('success', `${result.message}. ${formatUnits(result.units)} unidades en ${formatUnits(result.variantsWithStock)} variantes.`);
            await loadDays();
            const date = result.date;
            setFrom(date);
            if (to === date) setTo('live');
            await compare(date, to === date ? 'live' : to);
          })
          .catch((error: any) => showToast('error', error?.message || 'No se pudo guardar la foto'))
          .finally(() => setSaving(false));
      },
    });
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (onlyDown && row.delta >= 0) return false;
      if (!q) return true;
      return [row.productName, row.productSku, row.sku, row.color, row.size].some((part) =>
        (part || '').toLowerCase().includes(q)
      );
    });
  }, [rows, onlyDown, search]);

  const download = async () => {
    if (!from) return;
    setExporting(true);
    try {
      await api.downloadStockDailySnapshotCompare(from, to);
    } catch (error: any) {
      showToast('error', error?.message || 'No se pudo descargar el Excel');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-semibold">Foto del stock para comparar los días</div>
          <p className="text-xs text-slate-400 max-w-xl">
            La foto no cambia el stock: lo anota. Contra el stock de ahora ves lo que ya se descontó. Si guardás otra foto mañana, podés comparar un día con el otro.
          </p>
          {baseDay && (
            <p className="text-xs text-slate-300">
              Foto del {formatDay(baseDay.date)}
              {baseDay.takenAt ? ` · tomada ${formatDay(baseDay.takenAt.slice(0, 10))} ${baseDay.takenAt.slice(11, 16)}` : ''}
              {' · '}
              {formatUnits(baseDay.units)} unidades en {formatUnits(baseDay.variantsWithStock)} variantes
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={saveToday}
          disabled={saving || loadingDays}
          className="h-9 px-3 rounded-lg text-sm font-semibold inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
          {todaySaved ? 'Actualizar foto de hoy' : 'Guardar foto de hoy'}
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-2 md:items-end">
        <label className="text-xs text-slate-400 flex flex-col gap-1">
          Foto de partida
          <select
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 px-2 rounded-lg bg-slate-800 border border-slate-600 text-sm text-white"
          >
            {days.length === 0 && <option value="">Sin fotos todavía</option>}
            {days.map((day) => (
              <option key={day.date} value={day.date}>
                {formatDay(day.date)} · {formatUnits(day.units)} u.
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400 flex flex-col gap-1">
          Comparar con
          <select
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 px-2 rounded-lg bg-slate-800 border border-slate-600 text-sm text-white"
          >
            <option value="live">Stock de ahora</option>
            {days.filter((day) => day.date !== from).map((day) => (
              <option key={day.date} value={day.date}>
                Foto del {formatDay(day.date)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={download}
          disabled={!from || exporting || comparing}
          className="h-9 px-3 rounded-lg text-sm font-semibold inline-flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-50"
        >
          {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          Excel
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-slate-800 p-3">
            <div className="flex items-center gap-2 text-red-300">
              <TrendingDown size={16} />
              <span className="text-2xl font-bold">-{formatUnits(summary.unitsDown)}</span>
            </div>
            <div className="text-xs text-slate-400">{formatUnits(summary.variantsDown)} variantes bajaron</div>
          </div>
          <div className="rounded-lg border border-slate-800 p-3">
            <div className="flex items-center gap-2 text-emerald-300">
              <TrendingUp size={16} />
              <span className="text-2xl font-bold">+{formatUnits(summary.unitsUp)}</span>
            </div>
            <div className="text-xs text-slate-400">{formatUnits(summary.variantsUp)} variantes subieron</div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar artículo, código, color o talle"
            className="w-full h-9 pl-9 pr-3 rounded-lg bg-slate-800 border border-slate-600 text-sm text-white placeholder:text-slate-500"
          />
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
          <input type="checkbox" checked={onlyDown} onChange={(e) => setOnlyDown(e.target.checked)} className="w-4 h-4 accent-blue-500" />
          Solo lo que se descontó
        </label>
      </div>

      <div className="rounded-lg border border-slate-800 overflow-hidden">
        {comparing || loadingDays ? (
          <p className="p-4 text-sm text-slate-400 flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" /> Comparando stock…
          </p>
        ) : !from ? (
          <p className="p-4 text-sm text-slate-400">Todavía no hay una foto. Guardá la de hoy para tener el punto de partida.</p>
        ) : visible.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">
            {rows.length === 0
              ? `Todavía no hay diferencias entre la foto del ${formatDay(from)} y ${toLabel.toLowerCase()}.`
              : 'Ninguna variante coincide con el filtro.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-slate-400 text-xs">
                <tr>
                  <th className="text-left font-semibold px-3 py-2">Artículo</th>
                  <th className="text-right font-semibold px-3 py-2">Foto</th>
                  <th className="text-right font-semibold px-3 py-2">{to === 'live' ? 'Ahora' : 'Otra foto'}</th>
                  <th className="text-right font-semibold px-3 py-2">Diferencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {visible.map((row) => (
                  <tr key={`${row.sku}-${row.productSku}-${row.color}-${row.size}`}>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-white">{row.productName || row.productSku || 'Artículo'}</div>
                      <div className="text-xs text-slate-400">
                        {[row.productSku, row.color, row.size ? `T. ${row.size}` : '', row.sku].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-200">{formatUnits(row.fromStock)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-200">{formatUnits(row.toStock)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-bold ${row.delta < 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                      {row.delta > 0 ? `+${formatUnits(row.delta)}` : formatUnits(row.delta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {truncated && (
          <p className="px-3 py-2 text-xs text-amber-300 border-t border-slate-800">
            Hay más diferencias de las que entran en la lista. El Excel trae el detalle completo.
          </p>
        )}
      </div>
    </div>
  );
};

export default StockDayCompare;
