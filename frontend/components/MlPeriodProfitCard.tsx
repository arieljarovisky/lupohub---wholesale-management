import React, { useCallback, useEffect, useState } from 'react';
import { Download, FileText, Loader2, Receipt } from 'lucide-react';
import { api } from '../services/api';
import { useNotification } from '../context/NotificationContext';

type Profit = Awaited<ReturnType<typeof api.getMlPeriodProfit>>;

const fmt = (n: number | null | undefined) =>
  n != null && Number.isFinite(n)
    ? n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
    : '—';

const previousMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const parseMoney = (raw: string): number | null => {
  const t = raw.trim();
  if (!t) return 0;
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/[^\d.-]/g, '');
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
};

const formatMoneyInput = (n: number) =>
  n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MlPeriodProfitCard: React.FC = () => {
  const { showToast } = useNotification();
  const [month, setMonth] = useState(previousMonth);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Profit | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [invoiceNotes, setInvoiceNotes] = useState('');
  const [showMissing, setShowMissing] = useState(false);

  const loadInvoice = useCallback(async (period: string) => {
    try {
      const res = await api.getMlPeriodInvoice(period);
      setInvoiceNumber(res.invoice?.invoiceNumber || '');
      setInvoiceAmount(res.invoice ? formatMoneyInput(res.invoice.amount) : '');
      setInvoiceNotes(res.invoice?.notes || '');
    } catch {
      setInvoiceNumber('');
      setInvoiceAmount('');
      setInvoiceNotes('');
    }
  }, []);

  useEffect(() => {
    setResult(null);
    setShowMissing(false);
    void loadInvoice(month);
  }, [month, loadInvoice]);

  const invoiceValue = parseMoney(invoiceAmount);
  const net =
    result && invoiceValue != null ? Math.round((result.grossProfit - invoiceValue) * 100) / 100 : null;

  const calculate = async () => {
    setLoading(true);
    try {
      const res = await api.getMlPeriodProfit(month);
      setResult(res);
      showToast('success', `Resultado de ${month} calculado`);
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : 'No se pudo calcular el mes');
    } finally {
      setLoading(false);
    }
  };

  const saveInvoice = async () => {
    const amount = parseMoney(invoiceAmount);
    if (amount == null) {
      showToast('error', 'El importe de la factura no es válido');
      return;
    }
    setSaving(true);
    try {
      const res = await api.saveMlPeriodInvoice({
        month,
        amount,
        invoiceNumber,
        notes: invoiceNotes,
      });
      setInvoiceAmount(formatMoneyInput(res.invoice.amount));
      setResult((prev) =>
        prev
          ? {
              ...prev,
              invoice: res.invoice,
              netProfit: Math.round((prev.grossProfit - res.invoice.amount) * 100) / 100,
            }
          : prev
      );
      showToast('success', 'Factura de Mercado Libre guardada');
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : 'No se pudo guardar la factura');
    } finally {
      setSaving(false);
    }
  };

  const download = async () => {
    setExporting(true);
    try {
      await api.exportMlPeriodProfitExcel(month);
      showToast('success', 'Excel descargado');
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : 'No se pudo descargar el Excel');
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="rounded-xl border border-amber-900/40 bg-slate-900/60 p-4 sm:p-5 space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-black text-white flex items-center gap-2">
            <Receipt className="text-amber-400" size={20} />
            Resultado Mercado Libre del mes
          </h3>
          <p className="text-slate-400 text-sm mt-1 max-w-2xl">
            Ventas pagadas menos el costo FOB. Si la publicación es un pack, el costo se multiplica por esa cantidad
            (un Pack x3 descuenta 3 veces el FOB). Después se resta la factura de Mercado Libre, que es lo que hay que pagar.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-xl bg-slate-800 border border-slate-600 text-white text-sm px-3 py-2.5"
          />
          <button
            type="button"
            onClick={() => void calculate()}
            disabled={loading || !month}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Receipt size={16} />}
            {loading ? 'Calculando…' : 'Calcular mes'}
          </button>
          <button
            type="button"
            onClick={() => void download()}
            disabled={exporting || !month}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-sm font-bold disabled:opacity-50"
          >
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            Excel
          </button>
        </div>
      </div>

      {result && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Metric label="Ventas con FOB" value={fmt(result.salesWithFob)} hint={`${result.orderCount} órdenes`} />
          <Metric label="Costo mercadería" value={fmt(result.cogs)} hint={result.fobListName || 'FOB'} negative />
          <Metric label="Antes de la factura" value={fmt(result.grossProfit)} />
          <Metric
            label="Ganancia neta"
            value={fmt(net)}
            hint="Mercadería y factura descontadas"
            emphasis
          />
        </div>
      )}

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <FileText size={16} className="text-amber-300" />
          Factura de Mercado Libre
        </div>
        <p className="text-xs text-slate-400">
          Cargá el importe de la factura del mes. Ese monto es lo que Mercado Libre te cobra y se descuenta de la ganancia.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block text-xs text-slate-400">
            Número
            <input
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="Ej. 0001-00001234"
              className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-600 text-white text-sm px-3 py-2"
            />
          </label>
          <label className="block text-xs text-slate-400">
            Importe a pagar
            <input
              value={invoiceAmount}
              onChange={(e) => setInvoiceAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-600 text-white text-sm px-3 py-2 font-mono"
            />
          </label>
          <label className="block text-xs text-slate-400">
            Nota
            <input
              value={invoiceNotes}
              onChange={(e) => setInvoiceNotes(e.target.value)}
              placeholder="Opcional"
              className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-600 text-white text-sm px-3 py-2"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={() => void saveInvoice()}
          disabled={saving || !month}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-bold disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          Guardar factura
        </button>
      </div>

      {result && result.withoutFob.length > 0 && (
        <div className="rounded-xl border border-slate-700 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowMissing((v) => !v)}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left text-sm bg-slate-800/80 hover:bg-slate-800"
          >
            <span className="text-slate-200">
              Sin FOB: {result.withoutFob.length} publicaciones · ventas {fmt(result.salesWithoutFob)}
            </span>
            <span className="text-slate-500 text-xs">{showMissing ? 'Ocultar' : 'Ver'}</span>
          </button>
          {showMissing && (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-slate-500 uppercase tracking-wider">
                  <tr className="border-b border-slate-700">
                    <th className="p-2">Publicación</th>
                    <th className="p-2">SKU</th>
                    <th className="p-2">Pack</th>
                    <th className="p-2 text-right">Cantidad</th>
                    <th className="p-2 text-right">Ventas</th>
                  </tr>
                </thead>
                <tbody>
                  {result.withoutFob.map((row, index) => (
                    <tr key={`${row.itemId}-${row.sku}-${index}`} className="border-b border-slate-800 text-slate-300">
                      <td className="p-2">
                        <div className="text-white">{row.title || row.itemId}</div>
                        <div className="text-slate-500">{row.productName}</div>
                      </td>
                      <td className="p-2 font-mono text-blue-300">{row.sku || '—'}</td>
                      <td className="p-2">{row.pack > 1 ? `x${row.pack}` : '1'}</td>
                      <td className="p-2 text-right">{row.qty}</td>
                      <td className="p-2 text-right">{fmt(row.sales)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

const Metric: React.FC<{ label: string; value: string; hint?: string; negative?: boolean; emphasis?: boolean }> = ({
  label,
  value,
  hint,
  negative,
  emphasis,
}) => (
  <div className={`rounded-xl border p-3 ${emphasis ? 'border-emerald-800/60 bg-emerald-950/30' : 'border-slate-700 bg-slate-950/40'}`}>
    <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
    <div className={`mt-1 font-mono font-black text-sm sm:text-base ${negative ? 'text-red-400' : emphasis ? 'text-emerald-300' : 'text-white'}`}>
      {value}
    </div>
    {hint ? <div className="text-[10px] text-slate-500 mt-1">{hint}</div> : null}
  </div>
);

export default MlPeriodProfitCard;
