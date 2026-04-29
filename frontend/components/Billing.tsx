import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';
import { getRemitente } from '../services/apiIntegration';
import { buildWholesaleCreditNoteHtml, buildWholesaleFacturaHtml, type ManualFacturaFields } from '../utils/wholesaleInvoiceHtml';
import { Customer, Order, Payment, Product, Role, User } from '../types';
import { FileSpreadsheet, Filter, RefreshCw, Search, Eye, Loader2 } from 'lucide-react';
import { useNotification } from '../context/NotificationContext';
import { formatMoneyAr } from '../utils/moneyFormat';

const FACTURA_MANUAL_DATA_KEY = 'lupo_factura_manual_data_by_order';
const BILLING_PAGE_SIZE = 25;
const PAYMENTS_PAGE_SIZE = 25;

interface BillingProps {
  role: Role;
  customers: Customer[];
  users?: User[];
  products?: Product[];
}

const Billing: React.FC<BillingProps> = ({ role, customers, users = [], products = [] }) => {
  const { showToast } = useNotification();
  const [activeView, setActiveView] = useState<'billing' | 'payments'>('billing');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [desde, setDesde] = useState<string>('');
  const [hasta, setHasta] = useState<string>('');
  const [customerId, setCustomerId] = useState<string>('ALL');
  const [tipo, setTipo] = useState<'ALL' | 'FACTURA' | 'NC'>('ALL');

  const [payments, setPayments] = useState<Payment[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [importingPaymentsExcel, setImportingPaymentsExcel] = useState(false);
  const [billingPage, setBillingPage] = useState(1);
  const [paymentsPage, setPaymentsPage] = useState(1);

  const parseMoneyInput = (raw: string): number => {
    const s = String(raw ?? '').trim().replace(/\s/g, '').replace(/\$/g, '');
    if (!s) return 0;
    const hasComma = s.includes(',');
    const hasDot = s.includes('.');
    if (hasComma && hasDot) {
      // Formato típico AR: 1.234.567,89
      const normalized = s.replace(/\./g, '').replace(',', '.');
      const n = Number(normalized);
      return Number.isFinite(n) ? n : NaN;
    }
    if (hasComma) {
      // Ej: 1234,56
      const n = Number(s.replace(',', '.'));
      return Number.isFinite(n) ? n : NaN;
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  };
  const paymentsExcelInputRef = useRef<HTMLInputElement | null>(null);
  const [payReceipt, setPayReceipt] = useState('');
  const [payDate, setPayDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [payCustomerId, setPayCustomerId] = useState<string>('ALL');
  const [payInvoiceIds, setPayInvoiceIds] = useState<string[]>([]);
  const [paySellerId, setPaySellerId] = useState<string>('');
  const [payAmount, setPayAmount] = useState<string>('');
  const [payNotes, setPayNotes] = useState<string>('');
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [issuerFromApi, setIssuerFromApi] = useState<{ cuit: string; businessName: string; address: string; city: string } | null>(null);

  useEffect(() => {
    api.getAfipIssuer().then(setIssuerFromApi).catch(() => setIssuerFromApi(null));
  }, []);

  const mergedRemitenteForFactura = () => {
    const localRemitente = getRemitente();
    return (issuerFromApi && (issuerFromApi.businessName || issuerFromApi.cuit))
      ? { ...localRemitente, ...issuerFromApi, logoUrl: localRemitente.logoUrl, email: localRemitente.email, phone: localRemitente.phone }
      : localRemitente;
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getBilling({
        desde: desde || undefined,
        hasta: hasta || undefined,
        customerId: customerId !== 'ALL' ? customerId : undefined,
        tipo: tipo === 'ALL' ? undefined : tipo
      });
      setItems(data);
    } catch (err: any) {
      showToast('error', err?.message || 'Error cargando facturación');
    }
    setLoading(false);
  };

  const loadPayments = async () => {
    setLoadingPayments(true);
    try {
      const rows = await api.getPayments({
        desde: desde || undefined,
        hasta: hasta || undefined,
        customerId: customerId !== 'ALL' ? customerId : undefined,
      });
      setPayments(Array.isArray(rows) ? (rows as any) : []);
    } catch (err: any) {
      showToast('error', err?.message || 'Error cargando pagos');
    }
    setLoadingPayments(false);
  };

  useEffect(() => {
    load();
    loadPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleExport = async () => {
    try {
      await api.exportBilling({
        desde: desde || undefined,
        hasta: hasta || undefined,
        customerId: customerId !== 'ALL' ? customerId : undefined,
        tipo: tipo === 'ALL' ? undefined : tipo
      });
      showToast('success', 'Descarga iniciada');
    } catch (err: any) {
      showToast('error', err?.message || 'Error exportando facturación');
    }
  };

  const handleExportPendingDetail = async () => {
    try {
      await api.exportSaldosPendientesDetalle();
      showToast('success', 'Descarga iniciada');
    } catch (err: any) {
      showToast('error', err?.message || 'Error exportando saldos pendientes detallados');
    }
  };

  const handleImportPaymentsExcel = async (filesList: FileList | null) => {
    const files = filesList ? Array.from(filesList) : [];
    if (files.length === 0) return;
    setImportingPaymentsExcel(true);
    try {
      const res = await api.importPaymentsExcel(files);
      const importedMsg = `Importación finalizada: ${res.imported} importados, ${res.duplicated} duplicados, ${res.notFound?.length || 0} clientes sin match.`;
      showToast('success', importedMsg);
      await loadPayments();
    } catch (err: any) {
      showToast('error', err?.message || 'Error importando pagos desde Excel');
    } finally {
      setImportingPaymentsExcel(false);
      if (paymentsExcelInputRef.current) paymentsExcelInputRef.current.value = '';
    }
  };

  const facturaOptions = items
    .filter((x) => x?.tipo === 'FACTURA')
    .map((x) => ({
      invoiceId: x.id,
      label: `${x.cbteTipo === 1 ? 'A' : x.cbteTipo === 6 ? 'B' : ''} ${String(x.puntoVta).padStart(5, '0')}-${String(x.numeroDesde).padStart(8, '0')} — ${x.customerBusinessName || ''}`.trim(),
      customerId: x.customerId,
    }));

  /** Facturas del modal de pago: solo las del cliente elegido (misma lista que la grilla según filtros actuales). */
  const facturaOptionsForPayment = useMemo(() => {
    if (!payCustomerId || payCustomerId === 'ALL') return [];
    return facturaOptions.filter((f) => f.customerId === payCustomerId);
  }, [items, payCustomerId]);
  const facturaOptionById = useMemo(
    () => new Map(facturaOptions.map((f) => [f.invoiceId, f.label] as const)),
    [facturaOptions]
  );

  const formatDate = (d: any) => {
    if (!d) return '';
    const x = new Date(d);
    return isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('es-AR');
  };

  const formatTipo = (item: any) => {
    if (item.tipo === 'NC') {
      return item.cbteTipo === 3 ? 'NC A' : item.cbteTipo === 8 ? 'NC B' : 'NC';
    }
    return item.cbteTipo === 1 ? 'Factura A' : item.cbteTipo === 6 ? 'Factura B' : 'Factura';
  };

  const handleVer = async (item: any) => {
    if (!item?.orderId) {
      showToast('error', 'No se encontró el pedido para este comprobante');
      return;
    }

    try {
      const orders = await api.getOrders({ includeArchived: true, orderId: item.orderId });
      const order = orders.find((o) => o.id === item.orderId) as Order | undefined;
      if (!order) {
        showToast('error', 'Pedido no encontrado');
        return;
      }

      if (item.tipo === 'NC' || item.cbteTipo === 3 || item.cbteTipo === 8) {
        const notes = await api.getOrderCreditNotes(order.id);
        const nc = notes.find((n: any) => String(n.cbteDesde) === String(item.cbteDesde) && String(n.puntoVta) === String(item.puntoVta)) || notes[0];
        if (!nc) {
          showToast('error', 'No se encontró la nota de crédito correspondiente');
          return;
        }

        const customerNc = customers.find((c) => c.id === order.customerId);
        const html = buildWholesaleCreditNoteHtml({
          order,
          nc,
          customer: customerNc,
          products,
          remitente: mergedRemitenteForFactura() as any,
        });
        if (!html) {
          showToast('error', 'No se pudo generar la vista previa de la nota de crédito');
          return;
        }

        const w = window.open('', '_blank');
        if (w) {
          w.document.write(html);
          w.document.close();
        } else {
          showToast('error', 'No se pudo abrir la ventana de vista previa (bloqueador de popups?)');
        }

        return;
      }

      if (!order.invoice) {
        showToast('error', 'Este pedido no tiene factura AFIP');
        return;
      }

      let manualFromLs: ManualFacturaFields | undefined;
      try {
        const raw = localStorage.getItem(FACTURA_MANUAL_DATA_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, ManualFacturaFields>;
          manualFromLs = parsed[order.id];
        }
      } catch {
        /* ignore */
      }
      const customer = customers.find((c) => c.id === order.customerId);
      const manual: ManualFacturaFields =
        manualFromLs ??
        ({
          transportNumber: (customer?.transportNumber ?? '').toString().trim(),
          remitoNumber: (customer?.remitoNumber ?? '').toString().trim(),
          saleCondition: (customer?.saleCondition ?? 'Cuenta Corriente').toString().trim(),
        } as const);

      const html = buildWholesaleFacturaHtml({
        order,
        customer,
        products,
        remitente: mergedRemitenteForFactura() as any,
        manual,
      });
      if (!html) {
        showToast('error', 'No se pudo generar la vista previa de factura');
        return;
      }

      const w = window.open('', '_blank');
      if (w) {
        w.document.write(html);
        w.document.close();
      } else {
        showToast('error', 'No se pudo abrir la ventana de vista previa (bloqueador de popups?)');
      }
    } catch (err: any) {
      console.error('Error cargando orden para vista previa', err);
      showToast('error', err?.message || 'Error cargando vista previa de comprobante');
    }
  };

  const filteredCount = items.length;
  const normalizeDateKey = (v: any): string => {
    if (!v) return '';
    if (typeof v === 'string') {
      const raw = v.trim();
      const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    }
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
    return d.toISOString().slice(0, 10);
  };
  const filteredBillingItems = useMemo(() => {
    return items.filter((it: any) => {
      const dateKey = normalizeDateKey(it.fecha);
      if (desde && dateKey && dateKey < desde) return false;
      if (hasta && dateKey && dateKey > hasta) return false;
      if (customerId !== 'ALL' && String(it.customerId || '') !== customerId) return false;
      if (tipo !== 'ALL' && String(it.tipo || '') !== tipo) return false;
      return true;
    });
  }, [items, desde, hasta, customerId, tipo]);
  const filteredPayments = useMemo(() => {
    return payments.filter((p: any) => {
      const dateKey = normalizeDateKey(p.date);
      if (desde && dateKey && dateKey < desde) return false;
      if (hasta && dateKey && dateKey > hasta) return false;
      if (customerId !== 'ALL' && String(p.customerId || '') !== customerId) return false;
      return true;
    });
  }, [payments, desde, hasta, customerId]);

  const filteredCountDisplay = filteredBillingItems.length;
  const pagedItems = useMemo(() => {
    const start = (billingPage - 1) * BILLING_PAGE_SIZE;
    return filteredBillingItems.slice(start, start + BILLING_PAGE_SIZE);
  }, [filteredBillingItems, billingPage]);
  const billingTotalPages = Math.max(1, Math.ceil(filteredBillingItems.length / BILLING_PAGE_SIZE));

  const pagedPayments = useMemo(() => {
    const start = (paymentsPage - 1) * PAYMENTS_PAGE_SIZE;
    return filteredPayments.slice(start, start + PAYMENTS_PAGE_SIZE);
  }, [filteredPayments, paymentsPage]);
  const paymentsTotalPages = Math.max(1, Math.ceil(filteredPayments.length / PAYMENTS_PAGE_SIZE));

  useEffect(() => {
    setBillingPage(1);
  }, [filteredBillingItems.length, desde, hasta, customerId, tipo]);

  useEffect(() => {
    setPaymentsPage(1);
  }, [filteredPayments.length, desde, hasta, customerId]);

  useEffect(() => {
    if (billingPage > billingTotalPages) setBillingPage(billingTotalPages);
  }, [billingPage, billingTotalPages]);

  useEffect(() => {
    if (paymentsPage > paymentsTotalPages) setPaymentsPage(paymentsTotalPages);
  }, [paymentsPage, paymentsTotalPages]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Filter size={20} className="text-emerald-400" /> Facturación (AFIP)
          </h2>
          <p className="text-slate-400 text-sm">Listá todas las facturas y notas de crédito emitidas desde la app. Podés filtrar por fecha, cliente y tipo de comprobante.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center bg-slate-900 border border-slate-700 rounded-xl p-1">
            <button
              type="button"
              onClick={() => setActiveView('billing')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${activeView === 'billing' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
            >
              Facturas / NC
            </button>
            <button
              type="button"
              onClick={() => setActiveView('payments')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${activeView === 'payments' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
            >
              Recibos
            </button>
          </div>
          <button
            type="button"
            onClick={() => { if (activeView === 'billing') load(); else loadPayments(); }}
            disabled={activeView === 'billing' ? loading : loadingPayments}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 text-slate-100 text-sm font-medium border border-slate-700 hover:bg-slate-700 disabled:opacity-50"
          >
            {(activeView === 'billing' ? loading : loadingPayments) ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Actualizar
          </button>
          <button
            type="button"
            onClick={() => {
              setShowPaymentModal(true);
              setPayReceipt('');
              setPayAmount('');
              setPayNotes('');
              setPayInvoiceIds([]);
              const cid = customerId !== 'ALL' ? customerId : 'ALL';
              setPayCustomerId(cid);
              const pre = cid !== 'ALL' ? customers.find((c) => c.id === cid) : undefined;
              setPaySellerId(pre?.sellerId || '');
              setPayDate(new Date().toISOString().slice(0, 10));
            }}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 text-emerald-200 text-sm font-bold border border-emerald-900/60 hover:bg-slate-700"
          >
            Cargar pago
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold shadow-lg shadow-emerald-900/40 hover:bg-emerald-500"
          >
            <FileSpreadsheet size={16} /> Descargar todo (CSV)
          </button>
          <button
            type="button"
            onClick={handleExportPendingDetail}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-cyan-700 text-white text-sm font-bold shadow-lg shadow-cyan-900/40 hover:bg-cyan-600"
          >
            <FileSpreadsheet size={16} /> Saldos pendientes (detalle)
          </button>
          <input
            ref={paymentsExcelInputRef}
            type="file"
            accept=".xlsx,.xls"
            multiple
            className="hidden"
            onChange={(e) => { void handleImportPaymentsExcel(e.target.files); }}
          />
          <button
            type="button"
            disabled={importingPaymentsExcel}
            onClick={() => paymentsExcelInputRef.current?.click()}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-700 text-white text-sm font-bold shadow-lg shadow-indigo-900/40 hover:bg-indigo-600 disabled:opacity-50"
          >
            {importingPaymentsExcel ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
            Importar pagos (Excel)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
        <div className="space-y-1">
          <label className="text-[11px] font-black text-slate-500 uppercase">Desde</label>
          <input
            type="date"
            value={desde}
            onChange={e => setDesde(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-sm text-slate-100"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-black text-slate-500 uppercase">Hasta</label>
          <input
            type="date"
            value={hasta}
            onChange={e => setHasta(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-sm text-slate-100"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-black text-slate-500 uppercase">Cliente</label>
          <select
            value={customerId}
            onChange={e => setCustomerId(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-sm text-slate-100"
          >
            <option value="ALL">Todos</option>
            {customers.map(c => (
              <option key={c.id} value={c.id}>{c.businessName || c.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-black text-slate-500 uppercase">Tipo</label>
          <select
            value={tipo}
            onChange={e => setTipo(e.target.value as any)}
            disabled={activeView === 'payments'}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-sm text-slate-100"
          >
            <option value="ALL">Todos</option>
            <option value="FACTURA">Facturas</option>
            <option value="NC">Notas de crédito</option>
          </select>
        </div>
      </div>

      {activeView === 'billing' && (
      <div className="bg-slate-900/70 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Search size={14} />
            <span>{filteredCountDisplay} comprobante(s) • Página {billingPage}/{billingTotalPages}</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-slate-100">
            <thead className="bg-slate-800/80 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Tipo</th>
                <th className="px-3 py-2 text-left">Pto.Vta</th>
                <th className="px-3 py-2 text-left">Número</th>
                <th className="px-3 py-2 text-left">Pedido</th>
                <th className="px-3 py-2 text-left">Cliente</th>
                <th className="px-3 py-2 text-right">Importe</th>
                <th className="px-3 py-2 text-left">CAE</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredBillingItems.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    No hay comprobantes para los filtros seleccionados.
                  </td>
                </tr>
              )}
              {pagedItems.map((item: any) => {
                const numero = item.numeroDesde === item.numeroHasta ? item.numeroDesde : `${item.numeroDesde}-${item.numeroHasta}`;
                return (
                  <tr key={`${item.tipo}-${item.id}`} className="border-t border-slate-800/70 hover:bg-slate-800/60">
                    <td className="px-3 py-2">{formatDate(item.fecha)}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${item.tipo === 'NC' ? 'bg-amber-900/40 text-amber-300 border border-amber-700/60' : 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/60'}`}>
                        {formatTipo(item)}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{item.puntoVta}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{numero}</td>
                    <td className="px-3 py-2 font-mono whitespace-nowrap">{item.orderId}</td>
                    <td className="px-3 py-2 max-w-[320px] truncate">{item.customerBusinessName}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">${formatMoneyAr(item.importe ?? 0)}</td>
                    <td className="px-3 py-2 text-xs font-mono whitespace-nowrap">{item.cae}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleVer(item)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 text-slate-200 text-xs hover:bg-slate-700"
                        title="Ver detalle del comprobante"
                      >
                        <Eye size={14} /> Ver
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filteredBillingItems.length > BILLING_PAGE_SIZE && (
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-800">
            <button
              type="button"
              disabled={billingPage <= 1}
              onClick={() => setBillingPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-xs font-bold disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={billingPage >= billingTotalPages}
              onClick={() => setBillingPage((p) => Math.min(billingTotalPages, p + 1))}
              className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-xs font-bold disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        )}
      </div>
      )}

      {activeView === 'payments' && (
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="text-white font-black">Pagos / Recibos</div>
          <button
            type="button"
            onClick={loadPayments}
            className="px-3 py-2 rounded-xl bg-slate-800 text-slate-100 text-sm font-medium border border-slate-700 hover:bg-slate-700"
          >
            {loadingPayments ? <Loader2 size={16} className="animate-spin inline mr-2" /> : null}
            Actualizar pagos
          </button>
        </div>
        {loadingPayments ? (
          <div className="py-6 text-center text-slate-400">Cargando pagos…</div>
        ) : filteredPayments.length === 0 ? (
          <div className="py-4 text-slate-500 text-sm">No hay pagos cargados para el filtro actual.</div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs text-slate-400 pb-1">Página {paymentsPage}/{paymentsTotalPages} • {filteredPayments.length} recibo(s)</div>
            {pagedPayments.map((p) => (
              <div key={p.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-800/70 border border-slate-700 rounded-2xl p-3">
                <div className="min-w-0">
                  <div className="text-sm text-white font-bold truncate">{p.customerBusinessName || p.customerId}</div>
                  <div className="text-xs text-slate-400">
                    Recibo <span className="font-mono">{p.receiptNumber}</span> — {formatDate(p.date)}{p.sellerName ? ` — ${p.sellerName}` : ''}
                  </div>
                  {Array.isArray(p.invoiceIds) && p.invoiceIds.length > 0 && (
                    <div className="text-[11px] text-slate-500 truncate">
                      Facturas: {p.invoiceIds.map((id) => facturaOptionById.get(id) || id).join(' | ')}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-[11px] font-bold text-slate-200 hover:bg-slate-800"
                    onClick={async () => {
                      if (String(p.id || '').startsWith('mm-')) {
                        showToast('error', 'Este recibo es importado histórico y no se puede editar desde acá.');
                        return;
                      }
                      const next = window.prompt('Nueva fecha del recibo (YYYY-MM-DD):', String(p.date || '').slice(0, 10));
                      if (!next) return;
                      const date = next.trim();
                      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                        showToast('error', 'Fecha inválida. Usá formato YYYY-MM-DD');
                        return;
                      }
                      try {
                        await api.updatePaymentDate(p.id, date);
                        showToast('success', 'Fecha del recibo actualizada.');
                        await loadPayments();
                      } catch (err: any) {
                        showToast('error', err?.response?.data?.message || err?.message || 'No se pudo actualizar la fecha');
                      }
                    }}
                    title="Editar fecha del recibo"
                  >
                    Editar fecha
                  </button>
                  <div className="text-sm font-black text-emerald-300">${formatMoneyAr(Number(p.amount || 0))}</div>
                </div>
              </div>
            ))}
            {filteredPayments.length > PAYMENTS_PAGE_SIZE && (
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={paymentsPage <= 1}
                  onClick={() => setPaymentsPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-xs font-bold disabled:opacity-40"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={paymentsPage >= paymentsTotalPages}
                  onClick={() => setPaymentsPage((p) => Math.min(paymentsTotalPages, p + 1))}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-xs font-bold disabled:opacity-40"
                >
                  Siguiente
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {showPaymentModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-white font-black text-lg">Cargar pago</h3>
              <button onClick={() => setShowPaymentModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase mb-1">Nº Recibo</label>
                  <input value={payReceipt} onChange={(e) => setPayReceipt(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white outline-none" placeholder="R0001-00001234" />
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase mb-1">Fecha</label>
                  <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white outline-none" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase mb-1">Cliente</label>
                  <select
                    value={payCustomerId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setPayCustomerId(id);
                      setPayInvoiceIds([]);
                      if (id === 'ALL' || !id) {
                        setPaySellerId('');
                      } else {
                        const c = customers.find((x) => x.id === id);
                        setPaySellerId(c?.sellerId || '');
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white outline-none"
                  >
                    <option value="ALL">Seleccionar…</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.businessName || c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase mb-1">Facturas (múltiple)</label>
                  <div className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-white max-h-36 overflow-auto">
                    {payCustomerId === 'ALL' ? (
                      <div className="text-xs text-slate-500 px-1 py-1">(Elegí un cliente para ver sus facturas)</div>
                    ) : facturaOptionsForPayment.length === 0 ? (
                      <div className="text-xs text-slate-500 px-1 py-1">(Sin facturas en el listado actual — ampliá fechas o Actualizar)</div>
                    ) : (
                      <div className="space-y-1">
                        {facturaOptionsForPayment.map((f) => {
                          const checked = payInvoiceIds.includes(f.invoiceId);
                          return (
                            <label key={f.invoiceId} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-900 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setPayInvoiceIds((prev) => Array.from(new Set([...prev, f.invoiceId])));
                                  } else {
                                    setPayInvoiceIds((prev) => prev.filter((x) => x !== f.invoiceId));
                                  }
                                }}
                                className="accent-emerald-500"
                              />
                              <span className="text-xs text-slate-200">{f.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {payInvoiceIds.length > 0 && (
                    <div className="mt-1 text-[11px] text-slate-400">{payInvoiceIds.length} factura(s) seleccionada(s)</div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase mb-1">Vendedor</label>
                  <select value={paySellerId} onChange={(e) => setPaySellerId(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white outline-none">
                    <option value="">(Opcional) —</option>
                    {users.filter(u => u.role === 'SELLER').map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase mb-1">Importe</label>
                  <input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white outline-none" placeholder="0" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-500 uppercase mb-1">Observaciones</label>
                <textarea value={payNotes} onChange={(e) => setPayNotes(e.target.value)} rows={3} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white outline-none resize-y" />
              </div>
            </div>
            <div className="p-5 border-t border-slate-800 flex gap-2">
              <button onClick={() => setShowPaymentModal(false)} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-4 py-3 rounded-2xl font-bold">Cancelar</button>
              <button
                type="button"
                disabled={paySubmitting}
                onClick={async () => {
                  if (paySubmitting) return;
                  try {
                    const amount = parseMoneyInput(payAmount || '0');
                    if (!payReceipt.trim()) { showToast('error', 'Falta Nº recibo'); return; }
                    if (!payDate) { showToast('error', 'Falta fecha'); return; }
                    if (!payCustomerId || payCustomerId === 'ALL') { showToast('error', 'Seleccioná un cliente'); return; }
                    if (Number.isNaN(amount) || amount <= 0) { showToast('error', 'Importe inválido (debe ser mayor a 0)'); return; }
                    setPaySubmitting(true);
                    await api.createPayment({
                      customerId: payCustomerId,
                      receiptNumber: payReceipt.trim(),
                      date: payDate,
                      amount,
                      notes: payNotes?.trim() || undefined,
                      sellerId: paySellerId || null,
                      invoiceId: payInvoiceIds[0] || null,
                      invoiceIds: payInvoiceIds,
                      orderId: null,
                    });
                    showToast('success', 'Pago cargado.');
                    setShowPaymentModal(false);
                    loadPayments();
                  } catch (err: any) {
                    showToast('error', err?.response?.data?.message || err?.message || 'Error cargando pago');
                  } finally {
                    setPaySubmitting(false);
                  }
                }}
                className="flex-1 bg-emerald-700 hover:bg-emerald-600 text-white px-4 py-3 rounded-2xl font-black disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              >
                {paySubmitting && <Loader2 size={18} className="animate-spin shrink-0" aria-hidden />}
                {paySubmitting ? 'Guardando…' : 'Guardar pago'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Billing;

