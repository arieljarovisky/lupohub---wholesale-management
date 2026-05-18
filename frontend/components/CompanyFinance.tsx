import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  Wallet,
  ArrowDownCircle,
  ArrowUpCircle,
} from 'lucide-react';
import { api } from '../services/api';
import { useNotification } from '../context/NotificationContext';

type FinanceEntry = {
  id: string;
  entryType: 'expense' | 'income';
  category: string;
  amount: number;
  description: string | null;
  entryDate: string;
  createdByEmail?: string;
};

type Summary = Awaited<ReturnType<typeof api.getCompanyFinanceSummary>>;

const fmt = (n: number) =>
  n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

const todayIso = () => new Date().toISOString().slice(0, 10);

const monthRange = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  const from = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const last = new Date(y, m + 1, 0).getDate();
  const to = `${y}-${String(m + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { from, to };
};

const CompanyFinance: React.FC = () => {
  const { showToast } = useNotification();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [access, setAccess] = useState<Awaited<ReturnType<typeof api.getCompanyFinanceAccess>> | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [range, setRange] = useState(() => monthRange());
  const [filterType, setFilterType] = useState<'all' | 'expense' | 'income'>('all');
  const [includeOrders, setIncludeOrders] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    entryType: 'expense' as 'expense' | 'income',
    category: 'sueldo',
    amount: '',
    description: '',
    entryDate: todayIso(),
  });

  const categoryOptions = useMemo(() => {
    if (!access) return [];
    return form.entryType === 'expense' ? access.expenseCategories : access.incomeCategories;
  }, [access, form.entryType]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const acc = await api.getCompanyFinanceAccess();
      if (!acc.allowed) {
        setAccess(acc);
        setSummary(null);
        setEntries([]);
        return;
      }
      setAccess(acc);
      const [sum, list] = await Promise.all([
        api.getCompanyFinanceSummary({ from: range.from, to: range.to, includeOrders }),
        api.getCompanyFinanceEntries({ from: range.from, to: range.to, type: filterType === 'all' ? undefined : filterType }),
      ]);
      setSummary(sum);
      setEntries(list.entries as FinanceEntry[]);
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : 'No se pudieron cargar los datos');
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, filterType, includeOrders, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!categoryOptions.length) return;
    if (!categoryOptions.some((c) => c.id === form.category)) {
      setForm((f) => ({ ...f, category: categoryOptions[0].id }));
    }
  }, [form.entryType, categoryOptions]);

  const resetForm = () => {
    setEditingId(null);
    setForm({
      entryType: 'expense',
      category: 'sueldo',
      amount: '',
      description: '',
      entryDate: todayIso(),
    });
  };

  const openCreate = (type: 'expense' | 'income') => {
    resetForm();
    setForm((f) => ({
      ...f,
      entryType: type,
      category: type === 'expense' ? 'sueldo' : 'ingreso_manual',
    }));
    setFormOpen(true);
  };

  const openEdit = (row: FinanceEntry) => {
    setEditingId(row.id);
    setForm({
      entryType: row.entryType,
      category: row.category,
      amount: String(row.amount),
      description: row.description || '',
      entryDate: row.entryDate,
    });
    setFormOpen(true);
  };

  const handleSave = async () => {
    const amount = Number(String(form.amount).replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast('warning', 'Indicá un importe válido');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        entryType: form.entryType,
        category: form.category,
        amount,
        description: form.description.trim() || undefined,
        entryDate: form.entryDate,
      };
      if (editingId) {
        await api.updateCompanyFinanceEntry(editingId, payload);
        showToast('success', 'Movimiento actualizado');
      } else {
        await api.createCompanyFinanceEntry(payload);
        showToast('success', 'Movimiento registrado');
      }
      setFormOpen(false);
      resetForm();
      load();
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('¿Eliminar este movimiento?')) return;
    try {
      await api.deleteCompanyFinanceEntry(id);
      showToast('success', 'Eliminado');
      load();
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : 'No se pudo eliminar');
    }
  };

  const categoryLabel = (id: string) => {
    const all = [...(access?.expenseCategories || []), ...(access?.incomeCategories || [])];
    return all.find((c) => c.id === id)?.label || id;
  };

  if (access && !access.allowed) {
    return (
      <div className="rounded-2xl border border-slate-700 bg-slate-900/50 p-12 text-center text-slate-400">
        No tenés permiso para ver esta sección.
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-10">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-white flex items-center gap-2">
            <Wallet className="text-violet-400" size={28} />
            Resultados de la empresa
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            Gastos operativos, ingresos manuales y referencia de ventas mayoristas por período.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => openCreate('expense')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-600/90 hover:bg-red-500 text-white text-sm font-bold"
          >
            <Plus size={16} /> Gasto
          </button>
          <button
            type="button"
            onClick={() => openCreate('income')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600/90 hover:bg-emerald-500 text-white text-sm font-bold"
          >
            <Plus size={16} /> Ingreso
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-3 flex-wrap items-end bg-slate-800/40 border border-slate-700 rounded-xl p-4">
        <div>
          <label className="text-[10px] uppercase text-slate-500 font-bold block mb-1">Desde</label>
          <input
            type="date"
            value={range.from}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
            className="rounded-lg bg-slate-900 border border-slate-600 text-white text-sm px-3 py-2"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase text-slate-500 font-bold block mb-1">Hasta</label>
          <input
            type="date"
            value={range.to}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
            className="rounded-lg bg-slate-900 border border-slate-600 text-white text-sm px-3 py-2"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase text-slate-500 font-bold block mb-1">Tipo</label>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as typeof filterType)}
            className="rounded-lg bg-slate-900 border border-slate-600 text-white text-sm px-3 py-2 min-w-[140px]"
          >
            <option value="all">Todos</option>
            <option value="expense">Solo gastos</option>
            <option value="income">Solo ingresos</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300 pb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={includeOrders}
            onChange={(e) => setIncludeOrders(e.target.checked)}
            className="rounded"
          />
          Incluir ventas mayoristas (pedidos)
        </label>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-violet-400" size={40} />
        </div>
      ) : summary ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/30 p-4">
              <p className="text-xs text-slate-500 uppercase font-bold">Ingresos totales</p>
              <p className="text-2xl font-black text-emerald-400 mt-1">{fmt(summary.totalIncome)}</p>
              {includeOrders && summary.ordersRevenue > 0 && (
                <p className="text-[10px] text-slate-500 mt-1">
                  Manual {fmt(summary.manualIncome)} + pedidos {fmt(summary.ordersRevenue)}
                </p>
              )}
            </div>
            <div className="rounded-xl border border-red-800/40 bg-red-950/30 p-4">
              <p className="text-xs text-slate-500 uppercase font-bold">Gastos totales</p>
              <p className="text-2xl font-black text-red-400 mt-1">{fmt(summary.totalExpenses)}</p>
            </div>
            <div
              className={`rounded-xl border p-4 ${
                summary.netResult >= 0
                  ? 'border-emerald-700/50 bg-emerald-950/20'
                  : 'border-red-700/50 bg-red-950/20'
              }`}
            >
              <p className="text-xs text-slate-500 uppercase font-bold flex items-center gap-1">
                {summary.netResult >= 0 ? (
                  <TrendingUp size={14} className="text-emerald-400" />
                ) : (
                  <TrendingDown size={14} className="text-red-400" />
                )}
                Resultado neto
              </p>
              <p
                className={`text-2xl font-black mt-1 ${
                  summary.netResult >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {fmt(summary.netResult)}
              </p>
              <p className="text-[10px] text-slate-500 mt-1">
                {summary.netResult >= 0 ? 'Ganancia del período' : 'Pérdida del período'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
              <p className="text-xs text-slate-500 uppercase font-bold">Movimientos</p>
              <p className="text-lg font-bold text-white mt-1">
                {summary.expenseCount} gastos · {summary.incomeCount} ingresos manuales
              </p>
            </div>
          </div>

          {summary.byCategory.length > 0 && (
            <div className="rounded-xl border border-slate-700 overflow-hidden">
              <div className="px-4 py-3 bg-slate-800/80 border-b border-slate-700 text-sm font-bold text-white">
                Por categoría
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 text-[10px] uppercase">
                    <th className="p-3">Tipo</th>
                    <th className="p-3">Categoría</th>
                    <th className="p-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byCategory.map((r, i) => (
                    <tr key={i} className="border-t border-slate-800/80">
                      <td className="p-3">
                        {r.entryType === 'expense' ? (
                          <span className="text-red-400 flex items-center gap-1">
                            <ArrowDownCircle size={14} /> Gasto
                          </span>
                        ) : (
                          <span className="text-emerald-400 flex items-center gap-1">
                            <ArrowUpCircle size={14} /> Ingreso
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-slate-300">{r.categoryLabel}</td>
                      <td className="p-3 text-right font-mono text-white">{fmt(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      <div className="rounded-xl border border-slate-700 overflow-hidden">
        <div className="px-4 py-3 bg-slate-800/80 border-b border-slate-700 text-sm font-bold text-white">
          Movimientos registrados
        </div>
        {entries.length === 0 ? (
          <p className="p-8 text-center text-slate-500 text-sm">No hay movimientos en este período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-slate-500 text-[10px] uppercase border-b border-slate-700">
                  <th className="p-3">Fecha</th>
                  <th className="p-3">Tipo</th>
                  <th className="p-3">Categoría</th>
                  <th className="p-3">Descripción</th>
                  <th className="p-3 text-right">Importe</th>
                  <th className="p-3 w-20" />
                </tr>
              </thead>
              <tbody>
                {entries.map((row) => (
                  <tr key={row.id} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                    <td className="p-3 text-slate-300">{row.entryDate}</td>
                    <td className="p-3">
                      {row.entryType === 'expense' ? (
                        <span className="text-red-400">Gasto</span>
                      ) : (
                        <span className="text-emerald-400">Ingreso</span>
                      )}
                    </td>
                    <td className="p-3 text-slate-300">{categoryLabel(row.category)}</td>
                    <td className="p-3 text-slate-500 max-w-[200px] truncate">{row.description || '—'}</td>
                    <td
                      className={`p-3 text-right font-mono font-bold ${
                        row.entryType === 'expense' ? 'text-red-400' : 'text-emerald-400'
                      }`}
                    >
                      {row.entryType === 'expense' ? '−' : '+'}
                      {fmt(row.amount)}
                    </td>
                    <td className="p-3">
                      <div className="flex gap-1 justify-end">
                        <button
                          type="button"
                          onClick={() => openEdit(row)}
                          className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400"
                          title="Editar"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(row.id)}
                          className="p-1.5 rounded-lg hover:bg-red-900/40 text-red-400"
                          title="Eliminar"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {formOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && !saving && setFormOpen(false)}
        >
          <div
            className="bg-slate-800 border border-slate-600 rounded-2xl max-w-md w-full p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-black text-white mb-4">
              {editingId ? 'Editar movimiento' : 'Nuevo movimiento'}
            </h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, entryType: 'expense', category: 'sueldo' }))}
                  className={`py-2 rounded-lg text-sm font-bold ${
                    form.entryType === 'expense' ? 'bg-red-600 text-white' : 'bg-slate-900 text-slate-400'
                  }`}
                >
                  Gasto
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setForm((f) => ({ ...f, entryType: 'income', category: 'ingreso_manual' }))
                  }
                  className={`py-2 rounded-lg text-sm font-bold ${
                    form.entryType === 'income' ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-slate-400'
                  }`}
                >
                  Ingreso
                </button>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-bold">Categoría</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  className="w-full mt-1 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm px-3 py-2"
                >
                  {categoryOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] uppercase text-slate-500 font-bold">Importe</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                    className="w-full mt-1 rounded-lg bg-slate-900 border border-slate-600 text-white px-3 py-2"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500 font-bold">Fecha</label>
                  <input
                    type="date"
                    value={form.entryDate}
                    onChange={(e) => setForm((f) => ({ ...f, entryDate: e.target.value }))}
                    className="w-full mt-1 rounded-lg bg-slate-900 border border-slate-600 text-white px-3 py-2"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-bold">Descripción</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Opcional"
                  className="w-full mt-1 rounded-lg bg-slate-900 border border-slate-600 text-white px-3 py-2"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button
                type="button"
                onClick={() => !saving && setFormOpen(false)}
                className="px-4 py-2 rounded-xl text-slate-300 hover:bg-slate-700 font-bold text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-sm flex items-center gap-2 disabled:opacity-50"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CompanyFinance;
