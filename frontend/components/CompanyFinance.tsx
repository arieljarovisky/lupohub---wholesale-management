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
  Receipt,
  ShoppingBag,
  Store,
  Package,
  AlertCircle,
  Repeat,
  CreditCard,
  FileText,
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

type FixedExpense = {
  id: string;
  category: string;
  categoryLabel?: string;
  amount: number;
  description: string | null;
  active: boolean;
  startsFrom: string | null;
  endsAt: string | null;
};

type MpMovement = Awaited<ReturnType<typeof api.getCompanyFinanceMercadoPagoMovements>>['movements'][number];
type MpData = Awaited<ReturnType<typeof api.getCompanyFinanceMercadoPagoMovements>>;

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
  const [includeOrders, setIncludeOrders] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [fixedFormOpen, setFixedFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingFixedId, setEditingFixedId] = useState<string | null>(null);
  const [fixedExpenses, setFixedExpenses] = useState<FixedExpense[]>([]);
  const [mpData, setMpData] = useState<MpData | null>(null);
  const [mpLoading, setMpLoading] = useState(false);
  const [form, setForm] = useState({
    entryType: 'expense' as 'expense' | 'income',
    category: 'sueldo',
    amount: '',
    description: '',
    entryDate: todayIso(),
  });
  const [fixedForm, setFixedForm] = useState({
    category: 'alquiler',
    amount: '',
    description: '',
    active: true,
    startsFrom: '',
    endsAt: '',
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
      const [sum, list, fixed] = await Promise.all([
        api.getCompanyFinanceSummary({ from: range.from, to: range.to, includeOrders }),
        api.getCompanyFinanceEntries({ from: range.from, to: range.to, type: filterType === 'all' ? undefined : filterType }),
        api.getCompanyFinanceFixedExpenses(),
      ]);
      setSummary(sum);
      setEntries(list.entries as FinanceEntry[]);
      setFixedExpenses(fixed.items as FixedExpense[]);
      setMpLoading(true);
      api
        .getCompanyFinanceMercadoPagoMovements({ from: range.from, to: range.to })
        .then(setMpData)
        .catch(() => setMpData(null))
        .finally(() => setMpLoading(false));
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

  const resetFixedForm = () => {
    setEditingFixedId(null);
    setFixedForm({
      category: 'alquiler',
      amount: '',
      description: '',
      active: true,
      startsFrom: '',
      endsAt: '',
    });
  };

  const openCreateFixed = () => {
    resetFixedForm();
    setFixedFormOpen(true);
  };

  const openEditFixed = (row: FixedExpense) => {
    setEditingFixedId(row.id);
    setFixedForm({
      category: row.category,
      amount: String(row.amount),
      description: row.description || '',
      active: row.active,
      startsFrom: row.startsFrom || '',
      endsAt: row.endsAt || '',
    });
    setFixedFormOpen(true);
  };

  const handleSaveFixed = async () => {
    const amount = Number(String(fixedForm.amount).replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast('warning', 'Indicá un importe mensual válido');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        category: fixedForm.category,
        amount,
        description: fixedForm.description.trim() || undefined,
        active: fixedForm.active,
        startsFrom: fixedForm.startsFrom.trim() || undefined,
        endsAt: fixedForm.endsAt.trim() || undefined,
      };
      if (editingFixedId) {
        await api.updateCompanyFinanceFixedExpense(editingFixedId, payload);
        showToast('success', 'Gasto fijo actualizado');
      } else {
        await api.createCompanyFinanceFixedExpense(payload);
        showToast('success', 'Gasto fijo mensual agregado');
      }
      setFixedFormOpen(false);
      resetFixedForm();
      load();
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteFixed = async (id: string) => {
    if (!window.confirm('¿Eliminar este gasto fijo mensual?')) return;
    try {
      await api.deleteCompanyFinanceFixedExpense(id);
      showToast('success', 'Eliminado');
      load();
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : 'No se pudo eliminar');
    }
  };

  const toggleFixedActive = async (row: FixedExpense) => {
    try {
      await api.updateCompanyFinanceFixedExpense(row.id, { active: !row.active });
      load();
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : 'No se pudo actualizar');
    }
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
            Recibos, ventas Mercado Libre y Tienda Nube, movimientos Mercado Pago, despachos y facturas pendientes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={openCreateFixed}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-orange-700/90 hover:bg-orange-600 text-white text-sm font-bold"
          >
            <Repeat size={16} /> Gasto fijo
          </button>
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
          Incluir referencia pedidos mayoristas (sin facturar)
        </label>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-violet-400" size={40} />
        </div>
      ) : summary ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/30 p-4">
              <p className="text-xs text-slate-500 uppercase font-bold">Ingresos totales</p>
              <p className="text-2xl font-black text-emerald-400 mt-1">{fmt(summary.totalIncome)}</p>
              <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                Recibos {fmt(summary.receiptsTotal ?? 0)} · ML {fmt(summary.mlSales ?? 0)} · TN{' '}
                {fmt(summary.tnSales ?? 0)}
                {(summary.manualIncome ?? 0) > 0 ? ` · manual ${fmt(summary.manualIncome)}` : ''}
              </p>
            </div>
            <div className="rounded-xl border border-sky-800/40 bg-sky-950/30 p-4">
              <p className="text-xs text-slate-500 uppercase font-bold flex items-center gap-1">
                <FileText size={14} className="text-sky-400" />
                Facturado AFIP
              </p>
              <p className="text-2xl font-black text-sky-300 mt-1">
                {fmt(summary.invoicedTotal ?? 0)}
              </p>
              <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                {summary.invoicedCount ?? 0} factura(s) · neto {fmt(summary.invoicedNet ?? 0)} · IVA{' '}
                {fmt(summary.invoicedIva ?? 0)}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px]">
                <div className="rounded-md bg-emerald-950/40 border border-emerald-800/40 px-2 py-1.5">
                  <p className="text-emerald-300/80 uppercase font-bold tracking-wide">Cobrado</p>
                  <p className="font-mono text-emerald-300 text-xs leading-tight">
                    {fmt(summary.invoicedPaidTotal ?? 0)}
                  </p>
                  <p className="text-slate-500">{summary.invoicedPaidCount ?? 0} fact.</p>
                </div>
                <div className="rounded-md bg-amber-950/40 border border-amber-800/40 px-2 py-1.5">
                  <p className="text-amber-300/80 uppercase font-bold tracking-wide">Sin cobrar</p>
                  <p className="font-mono text-amber-200 text-xs leading-tight">
                    {fmt(summary.invoicedUnpaidTotal ?? 0)}
                  </p>
                  <p className="text-slate-500">{summary.invoicedUnpaidCount ?? 0} fact.</p>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-red-800/40 bg-red-950/30 p-4">
              <p className="text-xs text-slate-500 uppercase font-bold">Gastos totales</p>
              <p className="text-2xl font-black text-red-400 mt-1">{fmt(summary.totalExpenses)}</p>
              <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                Despachos {fmt(summary.despachosCost ?? 0)} · Fijos {fmt(summary.fixedMonthlyExpenses ?? 0)} · ML{' '}
                {fmt(summary.mlFees ?? 0)} · TN {fmt(summary.tnFees ?? 0)}
                {(summary.manualExpenses ?? 0) > 0 ? ` · otros ${fmt(summary.manualExpenses)}` : ''}
              </p>
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
            <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 p-4">
              <p className="text-xs text-slate-500 uppercase font-bold flex items-center gap-1">
                <AlertCircle size={14} className="text-amber-400" />
                Pagos pendientes
              </p>
              <p className="text-2xl font-black text-amber-300 mt-1">
                {fmt(summary.pendingInvoicesTotal ?? 0)}
              </p>
              <p className="text-[10px] text-slate-500 mt-1">
                {summary.pendingInvoicesCount ?? 0} factura(s) sin cobrar
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-emerald-800/30 bg-slate-900/40 overflow-hidden">
              <div className="px-4 py-3 bg-emerald-950/40 border-b border-emerald-900/40 text-sm font-bold text-emerald-300 flex items-center gap-2">
                <ArrowUpCircle size={16} /> Ganancias del período
              </div>
              <ul className="divide-y divide-slate-800/80 text-sm">
                <li className="flex justify-between items-center p-3">
                  <span className="text-slate-300 flex items-center gap-2">
                    <Receipt size={14} className="text-emerald-500" />
                    Recibos ({summary.receiptsCount ?? 0})
                  </span>
                  <span className="font-mono text-emerald-400">{fmt(summary.receiptsTotal ?? 0)}</span>
                </li>
                <li className="flex justify-between items-center p-3">
                  <span className="text-slate-300 flex items-center gap-2">
                    <ShoppingBag size={14} className="text-yellow-500" />
                    Mercado Libre ({summary.mlOrderCount ?? 0} órdenes)
                  </span>
                  <span className="font-mono text-emerald-400">{fmt(summary.mlSales ?? 0)}</span>
                </li>
                <li className="flex justify-between items-center p-3">
                  <span className="text-slate-300 flex items-center gap-2">
                    <Store size={14} className="text-violet-400" />
                    Tienda Nube ({summary.tnOrderCount ?? 0} órdenes)
                  </span>
                  <span className="font-mono text-emerald-400">{fmt(summary.tnSales ?? 0)}</span>
                </li>
                {(summary.manualIncome ?? 0) > 0 && (
                  <li className="flex justify-between items-center p-3">
                    <span className="text-slate-300">Ingresos manuales</span>
                    <span className="font-mono text-emerald-400">{fmt(summary.manualIncome)}</span>
                  </li>
                )}
                {includeOrders && (summary.ordersRevenue ?? 0) > 0 && (
                  <li className="flex justify-between items-center p-3 text-slate-500">
                    <span>Ref. pedidos mayoristas</span>
                    <span className="font-mono">{fmt(summary.ordersRevenue)}</span>
                  </li>
                )}
              </ul>
              {(summary.mlNote || summary.tnNote) && (
                <p className="px-4 pb-3 text-[10px] text-slate-600">
                  {summary.mlNote}
                  {summary.mlNote && summary.tnNote ? ' · ' : ''}
                  {summary.tnNote}
                </p>
              )}
            </div>

            <div className="rounded-xl border border-red-800/30 bg-slate-900/40 overflow-hidden">
              <div className="px-4 py-3 bg-red-950/40 border-b border-red-900/40 text-sm font-bold text-red-300 flex items-center gap-2">
                <ArrowDownCircle size={16} /> Gastos del período
              </div>
              <ul className="divide-y divide-slate-800/80 text-sm">
                <li className="flex justify-between items-center p-3">
                  <span className="text-slate-300 flex items-center gap-2">
                    <Package size={14} className="text-orange-400" />
                    Despachos importación ({summary.despachosCount ?? 0})
                  </span>
                  <span className="font-mono text-red-400">{fmt(summary.despachosCost ?? 0)}</span>
                </li>
                <li className="flex justify-between items-center p-3">
                  <span className="text-slate-300">Comisiones Mercado Libre</span>
                  <span className="font-mono text-red-400">{fmt(summary.mlFees ?? 0)}</span>
                </li>
                <li className="flex justify-between items-center p-3">
                  <span className="text-slate-300">Comisiones Tienda Nube</span>
                  <span className="font-mono text-red-400">{fmt(summary.tnFees ?? 0)}</span>
                </li>
                <li className="flex justify-between items-center p-3">
                  <span className="text-slate-300 flex items-center gap-2">
                    <Repeat size={14} className="text-orange-400" />
                    Gastos fijos mensuales
                    {(summary.monthsInPeriod ?? 1) > 1 && (
                      <span className="text-[10px] text-slate-600">
                        ({summary.monthsInPeriod} meses)
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-red-400">{fmt(summary.fixedMonthlyExpenses ?? 0)}</span>
                </li>
                {(summary.fixedMonthlySubtotal ?? 0) > 0 && (
                  <li className="px-3 pb-2 text-[10px] text-slate-600">
                    Base mensual activa: {fmt(summary.fixedMonthlySubtotal ?? 0)}/mes
                  </li>
                )}
                {(summary.manualExpenses ?? 0) > 0 && (
                  <li className="flex justify-between items-center p-3">
                    <span className="text-slate-300">Gastos operativos manuales</span>
                    <span className="font-mono text-red-400">{fmt(summary.manualExpenses)}</span>
                  </li>
                )}
              </ul>
              <p className="px-4 pb-3 text-[10px] text-slate-600">
                {summary.expenseCount} gasto(s) manual(es) en el período
              </p>
            </div>
          </div>

          {(summary.pendingInvoices?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-amber-800/40 overflow-hidden">
              <div className="px-4 py-3 bg-amber-950/30 border-b border-amber-900/40 text-sm font-bold text-amber-200 flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <AlertCircle size={16} /> Facturas no pagadas
                </span>
                <span className="font-mono text-amber-300">{fmt(summary.pendingInvoicesTotal ?? 0)}</span>
              </div>
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead className="sticky top-0 bg-slate-900/95">
                    <tr className="text-left text-slate-500 text-[10px] uppercase border-b border-slate-800">
                      <th className="p-3">Fecha</th>
                      <th className="p-3">Cliente</th>
                      <th className="p-3">Factura</th>
                      <th className="p-3">Estado pedido</th>
                      <th className="p-3 text-right">Saldo (IVA incl.)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.pendingInvoices.map((inv) => (
                      <tr key={inv.orderId} className="border-b border-slate-800/60">
                        <td className="p-3 text-slate-400">{inv.orderDate}</td>
                        <td className="p-3 text-slate-200">{inv.customerName}</td>
                        <td className="p-3 font-mono text-amber-200/90">{inv.invoiceLabel}</td>
                        <td className="p-3 text-slate-500">{inv.orderStatus}</td>
                        <td className="p-3 text-right font-mono text-amber-300">
                          {fmt(inv.amountWithIva)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

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

      <div className="rounded-xl border border-sky-800/50 overflow-hidden">
        <div className="px-4 py-3 bg-sky-950/40 border-b border-sky-900/50 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-bold text-sky-200 flex items-center gap-2">
            <CreditCard size={16} className="text-sky-400" /> Mercado Pago
          </span>
          {mpData?.connected && mpData.summary && (
            <span className="text-xs text-slate-400 font-mono">
              Neto período:{' '}
              <span className={mpData.summary.netIn >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                {fmt(mpData.summary.netIn)}
              </span>
              {' · '}
              {mpData.summary.count} mov.
            </span>
          )}
        </div>
        {mpLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="animate-spin text-sky-400" size={28} />
          </div>
        ) : !mpData?.connected ? (
          <p className="p-6 text-center text-slate-500 text-sm max-w-lg mx-auto">
            {mpData?.note ||
              'Mercado Pago no está configurado. Agregá MERCADOPAGO_ACCESS_TOKEN en Railway (token de producción).'}
          </p>
        ) : mpData.movements.length === 0 ? (
          <p className="p-6 text-center text-slate-500 text-sm">
            No hay movimientos de Mercado Pago en este período.
            {mpData.note ? <span className="block mt-2 text-[10px] text-slate-600">{mpData.note}</span> : null}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-800/80 border-b border-slate-800 text-center text-xs">
              <div className="bg-slate-900/60 p-3">
                <p className="text-slate-500 uppercase font-bold text-[10px]">Cobros brutos</p>
                <p className="font-mono text-emerald-400 mt-1">{fmt(mpData.summary.grossIn)}</p>
              </div>
              <div className="bg-slate-900/60 p-3">
                <p className="text-slate-500 uppercase font-bold text-[10px]">Comisiones MP</p>
                <p className="font-mono text-red-400 mt-1">{fmt(mpData.summary.fees)}</p>
              </div>
              <div className="bg-slate-900/60 p-3">
                <p className="text-slate-500 uppercase font-bold text-[10px]">Reembolsos</p>
                <p className="font-mono text-amber-400 mt-1">{fmt(mpData.summary.refunds)}</p>
              </div>
              <div className="bg-slate-900/60 p-3">
                <p className="text-slate-500 uppercase font-bold text-[10px]">Neto</p>
                <p
                  className={`font-mono mt-1 ${
                    mpData.summary.netIn >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {fmt(mpData.summary.netIn)}
                </p>
              </div>
            </div>
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="sticky top-0 bg-slate-900/95 z-10">
                  <tr className="text-left text-slate-500 text-[10px] uppercase border-b border-slate-800">
                    <th className="p-3">Fecha</th>
                    <th className="p-3">Tipo</th>
                    <th className="p-3">Descripción</th>
                    <th className="p-3 text-right">Bruto</th>
                    <th className="p-3 text-right">Comisión</th>
                    <th className="p-3 text-right">Neto</th>
                    <th className="p-3">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {mpData.movements.map((row: MpMovement) => (
                    <tr key={row.id} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                      <td className="p-3 text-slate-400 whitespace-nowrap">{row.date}</td>
                      <td className="p-3">
                        {row.movementType === 'reembolso' ? (
                          <span className="text-amber-400">Reembolso</span>
                        ) : row.movementType === 'cobro' ? (
                          <span className="text-emerald-400">Cobro</span>
                        ) : row.movementType === 'pendiente' ? (
                          <span className="text-slate-400">Pendiente</span>
                        ) : (
                          <span className="text-slate-500">Otro</span>
                        )}
                      </td>
                      <td className="p-3 text-slate-300 max-w-[240px]">
                        <div className="truncate" title={row.description}>
                          {row.description}
                        </div>
                        {row.externalReference ? (
                          <div className="text-[10px] text-slate-600 font-mono truncate">
                            Ref: {row.externalReference}
                          </div>
                        ) : null}
                      </td>
                      <td className="p-3 text-right font-mono text-slate-300">{fmt(row.grossAmount)}</td>
                      <td className="p-3 text-right font-mono text-red-400/90">
                        {row.feeAmount > 0 ? `−${fmt(row.feeAmount)}` : '—'}
                      </td>
                      <td
                        className={`p-3 text-right font-mono font-bold ${
                          row.netAmount >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {row.netAmount >= 0 ? '+' : '−'}
                        {fmt(Math.abs(row.netAmount))}
                      </td>
                      <td className="p-3 text-slate-500 text-xs">{row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {mpData.note ? (
              <p className="px-4 py-2 text-[10px] text-slate-600 border-t border-slate-800">{mpData.note}</p>
            ) : null}
          </>
        )}
      </div>

      <div className="rounded-xl border border-orange-900/40 overflow-hidden">
        <div className="px-4 py-3 bg-orange-950/30 border-b border-orange-900/40 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-bold text-orange-200 flex items-center gap-2">
            <Repeat size={16} /> Gastos fijos mensuales
          </span>
          <span className="text-xs text-slate-500">
            Se suman al período ({summary?.monthsInPeriod ?? '—'} mes
            {(summary?.monthsInPeriod ?? 0) !== 1 ? 'es' : ''} en el rango)
          </span>
        </div>
        {fixedExpenses.length === 0 ? (
          <p className="p-6 text-center text-slate-500 text-sm">
            No hay gastos fijos. Usá &quot;Gasto fijo&quot; para cargar alquiler, sueldos fijos, etc.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-slate-500 text-[10px] uppercase border-b border-slate-800">
                  <th className="p-3">Concepto</th>
                  <th className="p-3">Categoría</th>
                  <th className="p-3 text-right">$/mes</th>
                  <th className="p-3">Vigencia</th>
                  <th className="p-3 text-center">Activo</th>
                  <th className="p-3 text-right">En período</th>
                  <th className="p-3 w-20" />
                </tr>
              </thead>
              <tbody>
                {fixedExpenses.map((row) => {
                  const periodItem = summary?.fixedExpenseItems?.find((i) => i.id === row.id);
                  return (
                    <tr
                      key={row.id}
                      className={`border-b border-slate-800/60 ${!row.active ? 'opacity-50' : ''}`}
                    >
                      <td className="p-3 text-slate-200">{row.description || '—'}</td>
                      <td className="p-3 text-slate-400">
                        {row.categoryLabel || categoryLabel(row.category)}
                      </td>
                      <td className="p-3 text-right font-mono text-orange-300">{fmt(row.amount)}</td>
                      <td className="p-3 text-slate-500 text-xs">
                        {row.startsFrom || row.endsAt
                          ? `${row.startsFrom || '…'} → ${row.endsAt || '…'}`
                          : 'Siempre'}
                      </td>
                      <td className="p-3 text-center">
                        <button
                          type="button"
                          onClick={() => toggleFixedActive(row)}
                          className={`text-xs font-bold px-2 py-1 rounded ${
                            row.active
                              ? 'bg-emerald-900/50 text-emerald-400'
                              : 'bg-slate-800 text-slate-500'
                          }`}
                        >
                          {row.active ? 'Sí' : 'No'}
                        </button>
                      </td>
                      <td className="p-3 text-right font-mono text-slate-400 text-xs">
                        {periodItem && row.active ? fmt(periodItem.periodTotal) : '—'}
                      </td>
                      <td className="p-3">
                        <div className="flex gap-1 justify-end">
                          <button
                            type="button"
                            onClick={() => openEditFixed(row)}
                            className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteFixed(row.id)}
                            className="p-1.5 rounded-lg hover:bg-red-900/40 text-red-400"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-700 overflow-hidden">
        <div className="px-4 py-3 bg-slate-800/80 border-b border-slate-700 text-sm font-bold text-white">
          Movimientos puntuales del período
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

      {fixedFormOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && !saving && setFixedFormOpen(false)}
        >
          <div
            className="bg-slate-800 border border-orange-800/50 rounded-2xl max-w-md w-full p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-black text-white mb-1 flex items-center gap-2">
              <Repeat className="text-orange-400" size={20} />
              {editingFixedId ? 'Editar gasto fijo' : 'Nuevo gasto fijo mensual'}
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Se repite cada mes y se suma automáticamente al resumen del período.
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-bold">Categoría</label>
                <select
                  value={fixedForm.category}
                  onChange={(e) => setFixedForm((f) => ({ ...f, category: e.target.value }))}
                  className="w-full mt-1 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm px-3 py-2"
                >
                  {(access?.expenseCategories || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-bold">Importe mensual</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={fixedForm.amount}
                  onChange={(e) => setFixedForm((f) => ({ ...f, amount: e.target.value }))}
                  className="w-full mt-1 rounded-lg bg-slate-900 border border-slate-600 text-white px-3 py-2"
                  placeholder="Ej. 850000"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-bold">Concepto</label>
                <input
                  type="text"
                  value={fixedForm.description}
                  onChange={(e) => setFixedForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Ej. Alquiler depósito"
                  className="w-full mt-1 rounded-lg bg-slate-900 border border-slate-600 text-white px-3 py-2"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] uppercase text-slate-500 font-bold">Vigente desde</label>
                  <input
                    type="date"
                    value={fixedForm.startsFrom}
                    onChange={(e) => setFixedForm((f) => ({ ...f, startsFrom: e.target.value }))}
                    className="w-full mt-1 rounded-lg bg-slate-900 border border-slate-600 text-white px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500 font-bold">Vigente hasta</label>
                  <input
                    type="date"
                    value={fixedForm.endsAt}
                    onChange={(e) => setFixedForm((f) => ({ ...f, endsAt: e.target.value }))}
                    className="w-full mt-1 rounded-lg bg-slate-900 border border-slate-600 text-white px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={fixedForm.active}
                  onChange={(e) => setFixedForm((f) => ({ ...f, active: e.target.checked }))}
                  className="rounded"
                />
                Activo (sumar en resúmenes)
              </label>
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button
                type="button"
                onClick={() => !saving && setFixedFormOpen(false)}
                className="px-4 py-2 rounded-xl text-slate-300 hover:bg-slate-700 font-bold text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveFixed}
                className="px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold text-sm flex items-center gap-2 disabled:opacity-50"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

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
