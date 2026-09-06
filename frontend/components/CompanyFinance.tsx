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
  FileText,
  Percent,
  Landmark,
  Info,
  Download,
  Warehouse,
  Search,
  ChevronDown,
  ChevronUp,
  ListOrdered,
} from 'lucide-react';
import { api } from '../services/api';
import { useNotification } from '../context/NotificationContext';
import { exportCompanyFinanceExcel } from '../utils/companyFinanceExcel';

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


const fmt = (n: number) =>
  n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

const fmtDec = (n: number) =>
  n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtPct = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '—' : `${n.toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`;

const moneyClass = (n: number, invert = false) => {
  const positive = invert ? n < 0 : n >= 0;
  return positive ? 'text-emerald-400' : 'text-red-400';
};

type PnlLineProps = {
  label: string;
  value: number;
  hint?: string;
  indent?: number;
  bold?: boolean;
  section?: boolean;
  invert?: boolean;
  pct?: number | null;
};

const PnlLine: React.FC<PnlLineProps> = ({
  label,
  value,
  hint,
  indent = 0,
  bold,
  section,
  invert,
  pct,
}) => (
  <li
    className={`flex justify-between items-start gap-2 sm:gap-3 px-2 sm:px-4 py-2 sm:py-2.5 ${
      section ? 'bg-slate-800/50 border-y border-slate-700/80' : 'border-b border-slate-800/60'
    }`}
    style={{ paddingLeft: 8 + indent * 12 }}
  >
    <span className={`text-xs sm:text-sm ${bold || section ? 'font-bold text-white' : 'text-slate-300'} min-w-0`}>
      {label}
      {hint ? <span className="hidden sm:block text-[10px] font-normal text-slate-500 mt-0.5">{hint}</span> : null}
    </span>
    <span className="text-right shrink-0">
      <span
        className={`font-mono text-xs sm:text-sm ${bold || section ? 'font-black' : ''} ${
          invert ? 'text-red-400' : moneyClass(value)
        }`}
      >
        {invert ? `−${fmt(value)}` : fmt(value)}
      </span>
      {pct != null && Number.isFinite(pct) ? (
        <span className="block text-[9px] sm:text-[10px] text-slate-500 font-mono">{fmtPct(pct)}</span>
      ) : null}
    </span>
  </li>
);

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
  const [formOpen, setFormOpen] = useState(false);
  const [fixedFormOpen, setFixedFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingFixedId, setEditingFixedId] = useState<string | null>(null);
  const [fixedExpenses, setFixedExpenses] = useState<FixedExpense[]>([]);
  const [exporting, setExporting] = useState(false);
  const [stockSearch, setStockSearch] = useState('');
  const [showPeriodOrders, setShowPeriodOrders] = useState(false);
  const [periodOrdersFilter, setPeriodOrdersFilter] = useState<'all' | 'invoiced' | 'uninvoiced'>('all');
  const [loadingPeriodOrders, setLoadingPeriodOrders] = useState(false);
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

  const warehouseArticles = useMemo(() => {
    const list = summary?.inventory?.articles || [];
    const q = stockSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (a) =>
        a.sku.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q)
    );
  }, [summary, stockSearch]);

  const filteredPeriodOrders = useMemo(() => {
    const list = summary?.periodWholesaleOrders || [];
    if (periodOrdersFilter === 'invoiced') return list.filter((o) => o.invoiced);
    if (periodOrdersFilter === 'uninvoiced') return list.filter((o) => !o.invoiced);
    return list;
  }, [summary?.periodWholesaleOrders, periodOrdersFilter]);

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
        api.getCompanyFinanceSummary({ from: range.from, to: range.to }),
        api.getCompanyFinanceEntries({ from: range.from, to: range.to, type: filterType === 'all' ? undefined : filterType }),
        api.getCompanyFinanceFixedExpenses(),
      ]);
      setSummary(sum);
      setEntries(list.entries as FinanceEntry[]);
      setFixedExpenses(fixed.items as FixedExpense[]);
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : 'No se pudieron cargar los datos');
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, filterType, showToast]);

  const loadPeriodOrders = useCallback(async () => {
    setLoadingPeriodOrders(true);
    try {
      const sum = await api.getCompanyFinanceSummary({
        from: range.from,
        to: range.to,
        includeOrders: true,
      });
      setSummary((prev) =>
        prev
          ? {
              ...prev,
              wholesaleOrdersInvoicedCount: sum.wholesaleOrdersInvoicedCount,
              wholesaleOrdersInvoicedNet: sum.wholesaleOrdersInvoicedNet,
              wholesaleOrdersUninvoicedCount: sum.wholesaleOrdersUninvoicedCount,
              wholesaleOrdersUninvoicedNet: sum.wholesaleOrdersUninvoicedNet,
              wholesaleOrdersTotalCount: sum.wholesaleOrdersTotalCount,
              wholesaleOrdersTotalNet: sum.wholesaleOrdersTotalNet,
              periodWholesaleOrders: sum.periodWholesaleOrders,
            }
          : sum
      );
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : 'No se pudieron cargar los pedidos');
    } finally {
      setLoadingPeriodOrders(false);
    }
  }, [range.from, range.to, showToast]);

  const togglePeriodOrders = useCallback(() => {
    if (showPeriodOrders) {
      setShowPeriodOrders(false);
      return;
    }
    setShowPeriodOrders(true);
    void loadPeriodOrders();
  }, [showPeriodOrders, loadPeriodOrders]);

  useEffect(() => {
    load();
    setShowPeriodOrders(false);
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

  const handleExportExcel = async () => {
    if (!summary) {
      showToast('warning', 'Esperá a que cargue el resumen');
      return;
    }
    setExporting(true);
    try {
      const list = await api.getCompanyFinanceEntries({ from: range.from, to: range.to });
      await exportCompanyFinanceExcel({
        summary,
        entries: (list.entries as FinanceEntry[]).map((e) => ({
          entryDate: e.entryDate,
          entryType: e.entryType,
          category: e.category,
          amount: e.amount,
          description: e.description,
        })),
        fixedExpenses,
        mpData: null,
        categoryLabel,
      });
      showToast('success', 'Excel descargado');
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : 'No se pudo exportar el Excel');
    } finally {
      setExporting(false);
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
    <div className="space-y-6 max-w-7xl mx-auto pb-10">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2">
            <Wallet className="text-violet-400 shrink-0" size={24} />
            Resultados de la empresa
          </h2>
          <p className="text-slate-400 text-xs sm:text-sm mt-1 hidden sm:block">
            Estado de resultados: ventas mayoristas y minoristas, costo FOB, márgenes, comisiones y gastos.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={!summary || loading || exporting}
            className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs sm:text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            <span className="hidden sm:inline">Excel</span>
          </button>
          <button
            type="button"
            onClick={openCreateFixed}
            className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-orange-700/90 hover:bg-orange-600 text-white text-xs sm:text-sm font-bold"
          >
            <Repeat size={14} /> <span className="hidden sm:inline">Gasto</span> fijo
          </button>
          <button
            type="button"
            onClick={() => openCreate('expense')}
            className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-red-600/90 hover:bg-red-500 text-white text-xs sm:text-sm font-bold"
          >
            <Plus size={14} /> Gasto
          </button>
          <button
            type="button"
            onClick={() => openCreate('income')}
            className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-emerald-600/90 hover:bg-emerald-500 text-white text-xs sm:text-sm font-bold"
          >
            <Plus size={14} /> Ingreso
          </button>
        </div>
      </div>

      <div className="flex flex-row gap-2 sm:gap-3 flex-wrap items-end bg-slate-800/40 border border-slate-700 rounded-xl p-2.5 sm:p-4">
        <div className="flex-1 min-w-[100px]">
          <label className="text-[9px] sm:text-[10px] uppercase text-slate-500 font-bold block mb-1">Desde</label>
          <input
            type="date"
            value={range.from}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
            className="rounded-lg bg-slate-900 border border-slate-600 text-white text-xs sm:text-sm px-2 sm:px-3 py-1.5 sm:py-2 w-full"
          />
        </div>
        <div className="flex-1 min-w-[100px]">
          <label className="text-[9px] sm:text-[10px] uppercase text-slate-500 font-bold block mb-1">Hasta</label>
          <input
            type="date"
            value={range.to}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
            className="rounded-lg bg-slate-900 border border-slate-600 text-white text-xs sm:text-sm px-2 sm:px-3 py-1.5 sm:py-2 w-full"
          />
        </div>
        <div className="flex-1 min-w-[100px]">
          <label className="text-[9px] sm:text-[10px] uppercase text-slate-500 font-bold block mb-1">Tipo</label>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as typeof filterType)}
            className="rounded-lg bg-slate-900 border border-slate-600 text-white text-xs sm:text-sm px-2 sm:px-3 py-1.5 sm:py-2 w-full"
          >
            <option value="all">Todos</option>
            <option value="expense">Gastos</option>
            <option value="income">Ingresos</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-violet-400" size={40} />
        </div>
      ) : summary ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
            <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/30 p-3 sm:p-4">
              <p className="text-[10px] sm:text-xs text-slate-500 uppercase font-bold">Ventas totales</p>
              <p className="text-lg sm:text-2xl font-black text-emerald-400 mt-1">
                {fmt(summary.totalSales ?? summary.totalIncome)}
              </p>
              <p className="text-[9px] sm:text-[10px] text-slate-500 mt-1 leading-relaxed hidden sm:block">
                Mayorista {fmt(summary.channels?.wholesale.revenue ?? summary.ordersRevenue ?? 0)} · ML{' '}
                {fmt(summary.mlSales ?? 0)} · TN {fmt(summary.tnSales ?? 0)}
              </p>
            </div>
            <div className="rounded-xl border border-orange-800/40 bg-orange-950/30 p-3 sm:p-4">
              <p className="text-[10px] sm:text-xs text-slate-500 uppercase font-bold">Costo FOB</p>
              <p className="text-lg sm:text-2xl font-black text-orange-300 mt-1">{fmt(summary.totalCogs ?? 0)}</p>
              <p className="text-[9px] sm:text-[10px] text-slate-500 mt-1 leading-relaxed hidden sm:block">
                Lista {summary.fobListName || 'FOB'} · cobertura may.{' '}
                {fmtPct(summary.cogsCoverage?.wholesalePct)}
              </p>
            </div>
            <div className="rounded-xl border border-violet-800/40 bg-violet-950/30 p-3 sm:p-4">
              <p className="text-[10px] sm:text-xs text-slate-500 uppercase font-bold flex items-center gap-1">
                <Percent size={14} className="text-violet-400 hidden sm:block" />
                Margen bruto
              </p>
              <p className={`text-lg sm:text-2xl font-black mt-1 ${moneyClass(summary.grossProfit ?? 0)}`}>
                {fmt(summary.grossProfit ?? 0)}
              </p>
              <p className="text-[9px] sm:text-[10px] text-slate-500 mt-1">{fmtPct(summary.grossMarginPct)}</p>
            </div>
            <div
              className={`rounded-xl border p-3 sm:p-4 ${
                summary.netResult >= 0
                  ? 'border-emerald-700/50 bg-emerald-950/20'
                  : 'border-red-700/50 bg-red-950/20'
              }`}
            >
              <p className="text-[10px] sm:text-xs text-slate-500 uppercase font-bold flex items-center gap-1">
                {summary.netResult >= 0 ? (
                  <TrendingUp size={14} className="text-emerald-400 hidden sm:block" />
                ) : (
                  <TrendingDown size={14} className="text-red-400 hidden sm:block" />
                )}
                Resultado neto
              </p>
              <p className={`text-lg sm:text-2xl font-black mt-1 ${moneyClass(summary.netResult)}`}>
                {fmt(summary.netResult)}
              </p>
              <p className="text-[9px] sm:text-[10px] text-slate-500 mt-1">
                {fmtPct(summary.netMarginPct)}
              </p>
            </div>
            <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 p-3 sm:p-4">
              <p className="text-[10px] sm:text-xs text-slate-500 uppercase font-bold flex items-center gap-1">
                <AlertCircle size={14} className="text-amber-400 hidden sm:block" />
                Por cobrar
              </p>
              <p className="text-lg sm:text-2xl font-black text-amber-300 mt-1">
                {fmt(summary.pendingInvoicesTotal ?? 0)}
              </p>
              <p className="text-[9px] sm:text-[10px] text-slate-500 mt-1">
                {summary.pendingInvoicesCount ?? 0} fact. sin cobrar
              </p>
            </div>
            <div className="rounded-xl border border-cyan-800/40 bg-cyan-950/20 p-3 sm:p-4">
              <p className="text-[10px] sm:text-xs text-slate-500 uppercase font-bold flex items-center gap-1">
                <Warehouse size={14} className="text-cyan-400 hidden sm:block" />
                Depósito FOB
              </p>
              <p className="text-lg sm:text-2xl font-black text-cyan-300 mt-1">
                {fmt(summary.inventory?.value ?? 0)}
              </p>
              <p className="text-[9px] sm:text-[10px] text-slate-500 mt-1">
                {(summary.inventory?.units ?? 0).toLocaleString('es-AR')} u. ·{' '}
                {summary.inventory?.articleCount ?? summary.inventory?.skuCount ?? 0} art.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-700 overflow-hidden bg-slate-900/40">
            <div className="px-3 sm:px-4 py-2 sm:py-3 bg-slate-800/80 border-b border-slate-700 text-xs sm:text-sm font-bold text-white flex items-center gap-2">
              <Landmark size={16} className="text-violet-400 shrink-0" />
              Estado de resultados
            </div>
            <ul>
              <PnlLine
                section
                bold
                label="Ventas"
                value={summary.totalSales ?? summary.totalIncome}
              />
              <PnlLine
                indent={1}
                label="Mayorista"
                value={summary.channels?.wholesale.revenue ?? summary.ordersRevenue ?? 0}
                hint={`${summary.wholesaleOrdersTotalCount ?? summary.channels?.wholesale.orderCount ?? 0} pedidos · ${summary.wholesaleOrdersInvoicedCount ?? 0} fact. · ${summary.wholesaleOrdersUninvoicedCount ?? 0} sin fact. · sin IVA · IVA incl. ${fmt(summary.wholesaleRevenueWithIva ?? 0)}`}
              />
              <PnlLine
                indent={1}
                label="Mercado Libre (minorista)"
                value={summary.mlSales ?? 0}
                hint={`${summary.mlOrderCount ?? 0} órdenes pagadas`}
              />
              <PnlLine
                indent={1}
                label="Tienda Nube (minorista)"
                value={summary.tnSales ?? 0}
                hint={`${summary.tnOrderCount ?? 0} órdenes pagadas`}
              />
              {(summary.manualIncome ?? 0) > 0 && (
                <PnlLine indent={1} label="Otros ingresos" value={summary.manualIncome} />
              )}
              <PnlLine
                section
                invert
                label="Costo de mercadería vendida (FOB)"
                value={summary.totalCogs ?? 0}
                hint={summary.methodology?.cogs}
              />
              <PnlLine
                indent={1}
                invert
                label="CMV mayorista"
                value={summary.channels?.wholesale.cogs ?? 0}
                hint={`${summary.channels?.wholesale.unitsWithFob ?? 0} / ${summary.channels?.wholesale.units ?? 0} u. con FOB (${fmtPct(summary.cogsCoverage?.wholesalePct)})`}
              />
              <PnlLine
                indent={1}
                invert
                label="CMV Mercado Libre"
                value={summary.channels?.mercadoLibre.cogs ?? summary.mlCogs ?? 0}
                hint={`${summary.mlUnitsWithFob ?? 0} / ${summary.mlUnits ?? 0} u. (${fmtPct(summary.cogsCoverage?.mlPct)})`}
              />
              <PnlLine
                indent={1}
                invert
                label="CMV Tienda Nube"
                value={summary.channels?.tiendaNube.cogs ?? summary.tnCogs ?? 0}
                hint={`${summary.tnUnitsWithFob ?? 0} / ${summary.tnUnits ?? 0} u. (${fmtPct(summary.cogsCoverage?.tnPct)})`}
              />
              <PnlLine
                section
                bold
                label="Margen bruto"
                value={summary.grossProfit ?? 0}
                pct={summary.grossMarginPct}
              />
              <PnlLine
                section
                invert
                label="Costos de canal y comerciales"
                value={summary.commercialCosts ?? 0}
              />
              <PnlLine indent={1} invert label="Comisiones Mercado Libre" value={summary.mlFees ?? 0} />
              <PnlLine indent={1} invert label="Comisiones Tienda Nube" value={summary.tnFees ?? 0} />
              <PnlLine
                indent={1}
                invert
                label="Comisiones vendedores"
                value={summary.sellerCommissions ?? 0}
                hint={`Sobre ${summary.sellerCommissionReceipts ?? 0} recibos cobrados (neto de IVA)`}
              />
              <PnlLine
                section
                bold
                label="Margen de contribución"
                value={summary.contributionMargin ?? 0}
                pct={summary.contributionMarginPct}
              />
              <PnlLine
                section
                invert
                label="Gastos operativos"
                value={summary.operatingExpenses ?? 0}
              />
              {(summary.opexByCategory || []).map((row) => (
                <PnlLine
                  key={row.category}
                  indent={1}
                  invert
                  label={row.categoryLabel}
                  value={row.total}
                />
              ))}
              {(summary.opexByCategory || []).length === 0 && (
                <>
                  <PnlLine
                    indent={1}
                    invert
                    label="Gastos fijos mensuales"
                    value={summary.fixedMonthlyExpenses ?? 0}
                  />
                  <PnlLine
                    indent={1}
                    invert
                    label="Gastos puntuales"
                    value={summary.manualExpenses ?? 0}
                  />
                </>
              )}
              <PnlLine
                section
                bold
                label="Resultado neto del período"
                value={summary.netResult}
                pct={summary.netMarginPct}
              />
            </ul>
            <p className="px-3 sm:px-4 py-2 sm:py-3 text-[9px] sm:text-[10px] text-slate-500 leading-relaxed hidden sm:flex gap-2">
              <Info size={12} className="shrink-0 mt-0.5 text-slate-600" />
              <span>
                {summary.methodology?.wholesale} {summary.methodology?.retail}{' '}
                {summary.methodology?.commissions} Los despachos de importación y los recibos cobrados
                no entran al resultado: figuran abajo como compras de stock y cobranza.
              </span>
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
            {[
              {
                title: 'Mayorista',
                icon: <Receipt size={16} className="text-emerald-400" />,
                ch: summary.channels?.wholesale,
                extra: `IVA incl. ${fmt(summary.wholesaleRevenueWithIva ?? 0)}`,
              },
              {
                title: 'Mercado Libre',
                icon: <ShoppingBag size={16} className="text-yellow-500" />,
                ch: summary.channels?.mercadoLibre,
                extra: summary.mlNote,
              },
              {
                title: 'Tienda Nube',
                icon: <Store size={16} className="text-violet-400" />,
                ch: summary.channels?.tiendaNube,
                extra: summary.tnNote,
              },
              {
                title: 'Minorista (ML + TN)',
                icon: <ShoppingBag size={16} className="text-sky-400" />,
                ch: summary.channels?.retail,
                extra: 'Canales de venta al público',
              },
            ].map((card) => (
              <div key={card.title} className="rounded-xl border border-slate-700 bg-slate-900/40 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800 text-sm font-bold text-white flex items-center gap-2">
                  {card.icon}
                  {card.title}
                </div>
                <ul className="text-sm divide-y divide-slate-800/80">
                  <li className="flex justify-between p-3">
                    <span className="text-slate-400">Ventas</span>
                    <span className="font-mono text-emerald-400">{fmt(card.ch?.revenue ?? 0)}</span>
                  </li>
                  <li className="flex justify-between p-3">
                    <span className="text-slate-400">Costo FOB</span>
                    <span className="font-mono text-red-400">{fmt(card.ch?.cogs ?? 0)}</span>
                  </li>
                  <li className="flex justify-between p-3">
                    <span className="text-slate-400">Margen bruto</span>
                    <span className={`font-mono ${moneyClass(card.ch?.grossProfit ?? 0)}`}>
                      {fmt(card.ch?.grossProfit ?? 0)}
                      <span className="block text-[10px] text-slate-500 text-right">
                        {fmtPct(card.ch?.grossMarginPct)}
                      </span>
                    </span>
                  </li>
                  <li className="flex justify-between p-3">
                    <span className="text-slate-400">Comisiones canal</span>
                    <span className="font-mono text-red-400">{fmt(card.ch?.fees ?? 0)}</span>
                  </li>
                  <li className="flex justify-between p-3">
                    <span className="text-slate-300 font-bold">Contribución</span>
                    <span className={`font-mono font-black ${moneyClass(card.ch?.contribution ?? 0)}`}>
                      {fmt(card.ch?.contribution ?? 0)}
                      <span className="block text-[10px] text-slate-500 font-normal text-right">
                        {fmtPct(card.ch?.contributionMarginPct)}
                      </span>
                    </span>
                  </li>
                </ul>
                {card.extra ? (
                  <p className="px-4 pb-3 text-[10px] text-slate-600">{card.extra}</p>
                ) : null}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            <div className="rounded-xl border border-sky-800/30 bg-slate-900/40 overflow-hidden">
              <div className="px-3 sm:px-4 py-2 sm:py-3 bg-sky-950/40 border-b border-sky-900/40 text-xs sm:text-sm font-bold text-sky-300 flex items-center gap-2">
                <FileText size={16} className="shrink-0" /> Facturado AFIP
              </div>
              <ul className="divide-y divide-slate-800/80 text-xs sm:text-sm">
                <li className="flex justify-between items-center p-2 sm:p-3">
                  <span className="text-slate-300">Total c/IVA</span>
                  <span className="font-mono text-sky-300">{fmt(summary.invoicedTotal ?? 0)}</span>
                </li>
                <li className="flex justify-between items-center p-2 sm:p-3">
                  <span className="text-slate-400">Neto / IVA</span>
                  <span className="font-mono text-slate-300 text-right">
                    <span className="block sm:inline">{fmt(summary.invoicedNet ?? 0)}</span>
                    <span className="hidden sm:inline"> · </span>
                    <span className="block sm:inline text-slate-400">{fmt(summary.invoicedIva ?? 0)}</span>
                  </span>
                </li>
                <li className="flex justify-between items-center p-2 sm:p-3">
                  <span className="text-slate-300">Mayorista ({summary.invoicedWholesaleCount ?? 0})</span>
                  <span className="font-mono text-sky-300">{fmt(summary.invoicedWholesaleTotal ?? 0)}</span>
                </li>
                <li className="flex justify-between items-center p-2 sm:p-3">
                  <span className="text-slate-300">ML ({summary.invoicedMlCount ?? 0})</span>
                  <span className="font-mono text-sky-300">{fmt(summary.invoicedMlTotal ?? 0)}</span>
                </li>
                <li className="flex justify-between items-center p-2 sm:p-3">
                  <span className="text-slate-300">TN ({summary.invoicedTnCount ?? 0})</span>
                  <span className="font-mono text-sky-300">{fmt(summary.invoicedTnTotal ?? 0)}</span>
                </li>
              </ul>
            </div>

            <div className="rounded-xl border border-emerald-800/30 bg-slate-900/40 overflow-hidden">
              <div className="px-3 sm:px-4 py-2 sm:py-3 bg-emerald-950/40 border-b border-emerald-900/40 text-xs sm:text-sm font-bold text-emerald-300 flex items-center gap-2">
                <Wallet size={16} className="shrink-0" /> Cobranza y caja
              </div>
              <ul className="divide-y divide-slate-800/80 text-xs sm:text-sm">
                <li className="flex justify-between items-center p-2 sm:p-3">
                  <span className="text-slate-300">Recibos ({summary.receiptsCount ?? 0})</span>
                  <span className="font-mono text-emerald-400">{fmt(summary.receiptsTotal ?? 0)}</span>
                </li>
                <li className="flex justify-between items-center p-2 sm:p-3">
                  <span className="text-slate-300">Ventas may. (dev.)</span>
                  <span className="font-mono text-slate-200">
                    {fmt(summary.channels?.wholesale.revenue ?? 0)}
                  </span>
                </li>
                <li className="flex justify-between items-center p-2 sm:p-3">
                  <span className="text-slate-400 text-[10px] sm:text-xs">Dif. cobrado vs vendido</span>
                  <span
                    className={`font-mono ${moneyClass(
                      (summary.receiptsTotal ?? 0) - (summary.channels?.wholesale.revenue ?? 0)
                    )}`}
                  >
                    {fmt((summary.receiptsTotal ?? 0) - (summary.channels?.wholesale.revenue ?? 0))}
                  </span>
                </li>
              </ul>
              <p className="px-3 sm:px-4 pb-2 sm:pb-3 text-[9px] sm:text-[10px] text-slate-600 hidden sm:block">
                Los recibos son plata que entra; las ventas mayoristas son lo facturable del período.
              </p>
            </div>

            <div className="rounded-xl border border-orange-800/30 bg-slate-900/40 overflow-hidden">
              <div className="px-3 sm:px-4 py-2 sm:py-3 bg-orange-950/40 border-b border-orange-900/40 text-xs sm:text-sm font-bold text-orange-300 flex items-center gap-2">
                <Package size={16} className="shrink-0" /> Stock y compras
              </div>
              <ul className="divide-y divide-slate-800/80 text-xs sm:text-sm">
                <li className="flex justify-between items-center p-2 sm:p-3">
                  <span className="text-slate-300">Inventario a FOB</span>
                  <span className="font-mono text-orange-300">{fmt(summary.inventory?.value ?? 0)}</span>
                </li>
                <li className="flex justify-between items-center p-2 sm:p-3">
                  <span className="text-slate-400">Unidades</span>
                  <span className="font-mono text-slate-300">
                    {(summary.inventory?.unitsWithFob ?? 0).toLocaleString('es-AR')} /{' '}
                    {(summary.inventory?.units ?? 0).toLocaleString('es-AR')}
                  </span>
                </li>
                <li className="flex justify-between items-center p-2 sm:p-3">
                  <span className="text-slate-300">
                    Despachos ({summary.despachosCount ?? 0})
                  </span>
                  <span className="font-mono text-orange-300">{fmt(summary.despachosCost ?? 0)}</span>
                </li>
              </ul>
              <p className="px-3 sm:px-4 pb-2 sm:pb-3 text-[9px] sm:text-[10px] text-slate-600 hidden sm:block">
                Los despachos son compras de mercadería (activo), no un gasto del resultado.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-cyan-800/40 overflow-hidden bg-slate-900/40">
            <div className="px-3 sm:px-4 py-2 sm:py-3 bg-cyan-950/40 border-b border-cyan-900/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
              <div>
                <p className="text-xs sm:text-sm font-bold text-cyan-200 flex items-center gap-2">
                  <Warehouse size={16} className="shrink-0" /> Mercadería de depósito
                </p>
                <p className="text-[9px] sm:text-[10px] text-slate-500 mt-0.5 hidden sm:block">
                  Stock actual a FOB ({summary.inventory?.fobListName || 'lista FOB'}). No es del período: es lo que hay hoy en depósito.
                </p>
              </div>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="search"
                  value={stockSearch}
                  onChange={(e) => setStockSearch(e.target.value)}
                  placeholder="Buscar..."
                  className="rounded-lg bg-slate-900 border border-slate-600 text-white text-xs sm:text-sm pl-8 pr-3 py-1.5 sm:py-2 w-full sm:w-64"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-800/80 border-b border-slate-800 text-center text-xs">
              <div className="bg-slate-900/60 p-2 sm:p-3">
                <p className="text-slate-500 uppercase font-bold text-[9px] sm:text-[10px]">Valor FOB</p>
                <p className="font-mono text-cyan-300 mt-1 text-sm sm:text-lg font-black">{fmt(summary.inventory?.value ?? 0)}</p>
              </div>
              <div className="bg-slate-900/60 p-2 sm:p-3">
                <p className="text-slate-500 uppercase font-bold text-[9px] sm:text-[10px]">Unidades</p>
                <p className="font-mono text-white mt-1 text-sm sm:text-lg font-black">
                  {(summary.inventory?.units ?? 0).toLocaleString('es-AR')}
                </p>
              </div>
              <div className="bg-slate-900/60 p-2 sm:p-3">
                <p className="text-slate-500 uppercase font-bold text-[9px] sm:text-[10px]">Artículos</p>
                <p className="font-mono text-white mt-1 text-sm sm:text-lg font-black">
                  {(summary.inventory?.articleCount ?? summary.inventory?.skuCount ?? 0).toLocaleString('es-AR')}
                </p>
              </div>
              <div className="bg-slate-900/60 p-2 sm:p-3">
                <p className="text-slate-500 uppercase font-bold text-[9px] sm:text-[10px]">Con FOB</p>
                <p className="font-mono text-emerald-400 mt-1 text-sm sm:text-lg font-black">
                  {fmtPct(summary.inventory?.coveragePct)}
                </p>
                {(summary.inventory?.unitsWithoutFob ?? 0) > 0 && (
                  <p className="text-[9px] sm:text-[10px] text-amber-400/80 mt-0.5 hidden sm:block">
                    {(summary.inventory?.unitsWithoutFob ?? 0).toLocaleString('es-AR')} u. sin FOB
                  </p>
                )}
              </div>
            </div>

            {(summary.inventory?.byCategory?.length ?? 0) > 0 && (
              <div className="overflow-x-auto border-b border-slate-800">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="text-left text-slate-500 text-[10px] uppercase border-b border-slate-800">
                      <th className="p-3">Rubro</th>
                      <th className="p-3 text-right">Artículos</th>
                      <th className="p-3 text-right">Unidades</th>
                      <th className="p-3 text-right">Valor FOB</th>
                      <th className="p-3 text-right">% depósito</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.inventory?.byCategory?.map((row) => (
                      <tr key={row.category} className="border-b border-slate-800/60">
                        <td className="p-3 text-slate-200">{row.category}</td>
                        <td className="p-3 text-right font-mono text-slate-400">{row.articleCount}</td>
                        <td className="p-3 text-right font-mono text-slate-300">
                          {row.units.toLocaleString('es-AR')}
                        </td>
                        <td className="p-3 text-right font-mono text-cyan-300">{fmt(row.value)}</td>
                        <td className="p-3 text-right font-mono text-slate-500">
                          {(summary.inventory?.value ?? 0) > 0
                            ? fmtPct((row.value / (summary.inventory?.value ?? 1)) * 100)
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="overflow-x-auto max-h-[28rem]">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="sticky top-0 bg-slate-900/95 z-10">
                  <tr className="text-left text-slate-500 text-[10px] uppercase border-b border-slate-800">
                    <th className="p-3">SKU</th>
                    <th className="p-3">Artículo</th>
                    <th className="p-3">Rubro</th>
                    <th className="p-3 text-right">Unidades</th>
                    <th className="p-3 text-right">FOB unit.</th>
                    <th className="p-3 text-right">Valor FOB</th>
                  </tr>
                </thead>
                <tbody>
                  {warehouseArticles.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-500 text-sm">
                        {stockSearch.trim()
                          ? 'No hay artículos que coincidan con la búsqueda.'
                          : 'No hay stock en depósito.'}
                      </td>
                    </tr>
                  ) : (
                    warehouseArticles.map((row) => (
                      <tr key={row.productId} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                        <td className="p-3 font-mono text-slate-400 text-xs">{row.sku}</td>
                        <td className="p-3 text-slate-200">{row.name}</td>
                        <td className="p-3 text-slate-500">{row.category}</td>
                        <td className="p-3 text-right font-mono text-slate-300">
                          {row.units.toLocaleString('es-AR')}
                          {row.units > row.unitsWithFob ? (
                            <span className="block text-[10px] text-amber-400/80">
                              {row.unitsWithFob.toLocaleString('es-AR')} con FOB
                            </span>
                          ) : null}
                        </td>
                        <td className="p-3 text-right font-mono text-slate-400">
                          {row.fob != null ? fmtDec(row.fob) : '—'}
                        </td>
                        <td className="p-3 text-right font-mono font-bold text-cyan-300">{fmt(row.value)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {(summary.wholesaleOrdersTotalCount ?? 0) > 0 && (
            <div className="rounded-xl border border-violet-800/40 overflow-hidden">
              <div className="px-3 sm:px-4 py-2 sm:py-3 bg-violet-950/30 border-b border-violet-900/40 text-xs sm:text-sm font-bold text-violet-200 flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <ListOrdered size={16} className="shrink-0" />
                  Pedidos mayoristas del período
                </span>
                <button
                  type="button"
                  onClick={togglePeriodOrders}
                  className="inline-flex items-center gap-1 text-[10px] sm:text-xs font-semibold text-violet-300 hover:text-violet-100 transition-colors"
                >
                  {showPeriodOrders ? (
                    <>
                      Ocultar listado <ChevronUp size={14} />
                    </>
                  ) : (
                    <>
                      Ver listado <ChevronDown size={14} />
                    </>
                  )}
                </button>
              </div>
              <ul className="divide-y divide-slate-800/80 text-xs sm:text-sm">
                <li className="flex justify-between items-center p-2 sm:p-3">
                  <span className="text-slate-300">
                    Facturados ({summary.wholesaleOrdersInvoicedCount ?? 0})
                  </span>
                  <span className="font-mono text-emerald-300">{fmt(summary.wholesaleOrdersInvoicedNet ?? 0)}</span>
                </li>
                <li className="flex justify-between items-center p-2 sm:p-3">
                  <span className="text-slate-300">
                    Sin facturar ({summary.wholesaleOrdersUninvoicedCount ?? 0})
                  </span>
                  <span className="font-mono text-amber-300">{fmt(summary.wholesaleOrdersUninvoicedNet ?? 0)}</span>
                </li>
                <li className="flex justify-between items-center p-2 sm:p-3 bg-slate-800/30">
                  <span className="text-slate-200 font-bold">Total ({summary.wholesaleOrdersTotalCount ?? 0})</span>
                  <span className="font-mono font-bold text-violet-200">{fmt(summary.wholesaleOrdersTotalNet ?? 0)}</span>
                </li>
              </ul>
              <p className="px-3 sm:px-4 pb-2 sm:pb-3 text-[9px] sm:text-[10px] text-slate-600">
                Por fecha del pedido, neto de notas de crédito y sin IVA. Distinto del bloque «Facturado AFIP», que usa fecha de emisión.
              </p>
              {showPeriodOrders && (
                <div className="border-t border-violet-900/40">
                  <div className="px-3 sm:px-4 py-2 flex flex-wrap gap-2 items-center border-b border-slate-800/80">
                    {(
                      [
                        { key: 'all' as const, label: 'Todos' },
                        { key: 'invoiced' as const, label: 'Facturados' },
                        { key: 'uninvoiced' as const, label: 'Sin facturar' },
                      ] as const
                    ).map(({ key, label }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setPeriodOrdersFilter(key)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] sm:text-xs font-semibold transition-colors ${
                          periodOrdersFilter === key
                            ? 'bg-violet-600/30 text-violet-200 border border-violet-500/50'
                            : 'text-slate-400 hover:text-slate-200 border border-transparent'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                    {loadingPeriodOrders ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 ml-auto">
                        <Loader2 size={12} className="animate-spin" /> Cargando…
                      </span>
                    ) : null}
                  </div>
                  <div className="overflow-x-auto max-h-80 overflow-y-auto">
                    <table className="w-full text-sm min-w-[640px]">
                      <thead className="sticky top-0 bg-slate-900/95">
                        <tr className="text-left text-slate-500 text-[10px] uppercase border-b border-slate-800">
                          <th className="p-3">Fecha</th>
                          <th className="p-3">Cliente</th>
                          <th className="p-3">Estado</th>
                          <th className="p-3">Factura</th>
                          <th className="p-3">Cobro</th>
                          <th className="p-3 text-right">Neto</th>
                          <th className="p-3 text-right">c/IVA</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPeriodOrders.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="p-4 text-center text-slate-500 text-xs">
                              {loadingPeriodOrders
                                ? 'Cargando pedidos…'
                                : 'No hay pedidos para este filtro.'}
                            </td>
                          </tr>
                        ) : (
                          filteredPeriodOrders.map((order) => (
                            <tr key={order.orderId} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                              <td className="p-3 text-slate-400">{order.orderDate}</td>
                              <td className="p-3 text-slate-200">{order.customerName}</td>
                              <td className="p-3 text-slate-500">{order.orderStatus}</td>
                              <td className="p-3 font-mono text-xs">
                                {order.invoiced ? (
                                  <span className="text-emerald-300">{order.invoiceLabel}</span>
                                ) : (
                                  <span className="text-amber-400/90">Sin factura</span>
                                )}
                              </td>
                              <td className="p-3 text-slate-500 capitalize">{order.paymentStatus}</td>
                              <td className="p-3 text-right font-mono text-slate-200">{fmt(order.net)}</td>
                              <td className="p-3 text-right font-mono text-slate-400">{fmt(order.netWithIva)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

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
