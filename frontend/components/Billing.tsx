import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';
import { getRemitente } from '../services/apiIntegration';
import {
  buildWholesaleCreditNoteHtml,
  buildWholesaleFacturaHtml,
  mergeServerInvoiceIntoOrder,
  type ManualFacturaFields,
} from '../utils/wholesaleInvoiceHtml';
import { Customer, Order, Payment, Product, Role, User } from '../types';
import { FileSpreadsheet, Filter, RefreshCw, Search, Eye, Loader2, Percent, RefreshCcw, FileMinus, ExternalLink, Printer } from 'lucide-react';
import { useNotification } from '../context/NotificationContext';
import { formatMoneyAr } from '../utils/moneyFormat';
import { getStoredOrdersListFilters, setStoredOrdersListFilters } from '../utils/ordersListFilters';

const FACTURA_MANUAL_DATA_KEY = 'lupo_factura_manual_data_by_order';
const BILLING_PAGE_SIZE = 25;
const PAYMENTS_PAGE_SIZE = 25;

interface BillingProps {
  role: Role;
  customers: Customer[];
  users?: User[];
  products?: Product[];
  /** Permite navegar a otras vistas del app (ej. ir a Pedidos filtrado por el order_id de la factura). */
  onNavigate?: (view: string) => void;
}

const Billing: React.FC<BillingProps> = ({ role, customers, users = [], products = [], onNavigate }) => {
  const { showToast, showConfirm } = useNotification();
  const canAfipInvoiceActions = role === Role.ADMIN || role === Role.WAREHOUSE || role === Role.DEPOSITO;
  const defaultRetPerMonth = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  const [activeView, setActiveView] = useState<'billing' | 'payments'>('billing');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [desde, setDesde] = useState<string>('');
  const [hasta, setHasta] = useState<string>('');
  const [customerId, setCustomerId] = useState<string>('ALL');
  const [province, setProvince] = useState<string>('ALL');
  const [tipo, setTipo] = useState<'ALL' | 'FACTURA' | 'NC'>('ALL');

  const [payments, setPayments] = useState<Payment[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [importingPaymentsExcel, setImportingPaymentsExcel] = useState(false);
  const [exportingByCustomerFile, setExportingByCustomerFile] = useState(false);
  const [exportingMovimientosSistema, setExportingMovimientosSistema] = useState(false);
  const [importingAgipPadron, setImportingAgipPadron] = useState(false);
  const [billingPage, setBillingPage] = useState(1);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [retPerMonth, setRetPerMonth] = useState<string>(defaultRetPerMonth);

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
  const billingCustomersFileInputRef = useRef<HTMLInputElement | null>(null);
  const agipPadronInputRef = useRef<HTMLInputElement | null>(null);
  const [payReceipt, setPayReceipt] = useState('');
  const [payDate, setPayDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [payCustomerId, setPayCustomerId] = useState<string>('ALL');
  const [payInvoiceIds, setPayInvoiceIds] = useState<string[]>([]);
  const [paySellerId, setPaySellerId] = useState<string>('');
  const [payAmount, setPayAmount] = useState<string>('');
  const [payNotes, setPayNotes] = useState<string>('');
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [issuerFromApi, setIssuerFromApi] = useState<{ cuit: string; businessName: string; address: string; city: string } | null>(null);
  /** Datos completos del remitente (incluye CAI). Necesarios para imprimir el CAI en remitos/facturas. */
  const [remitenteFromApi, setRemitenteFromApi] = useState<any>(null);
  const [billingExportCuitsText, setBillingExportCuitsText] = useState('');
  const [billingRecalcOrderId, setBillingRecalcOrderId] = useState<string | null>(null);
  const [billingReemitOrderId, setBillingReemitOrderId] = useState<string | null>(null);
  /** Pedido para el que se está emitiendo una NC por el total desde la pantalla de facturación. */
  const [billingEmitNCOrderId, setBillingEmitNCOrderId] = useState<string | null>(null);

  useEffect(() => {
    api.getAfipIssuer().then(setIssuerFromApi).catch(() => setIssuerFromApi(null));
    api.getRemitenteServer().then(setRemitenteFromApi).catch(() => setRemitenteFromApi(null));
  }, []);

  const mergedRemitenteForFactura = () => {
    const localRemitente = getRemitente();
    const mergeSoft = (base: any, extra: any): any => {
      if (!extra) return { ...base };
      const out: any = { ...base };
      for (const k of Object.keys(extra)) {
        const v = (extra as any)[k];
        if (v === undefined || v === null) continue;
        if (typeof v === 'string' && v.trim() === '') continue;
        out[k] = v;
      }
      return out;
    };
    let merged: any = mergeSoft(localRemitente, remitenteFromApi);
    if (issuerFromApi && (issuerFromApi.businessName || issuerFromApi.cuit)) {
      merged = mergeSoft(merged, issuerFromApi);
    }
    merged.logoUrl = localRemitente.logoUrl;
    return merged;
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getBilling({
        desde: desde || undefined,
        hasta: hasta || undefined,
        customerId: customerId !== 'ALL' ? customerId : undefined,
        province: province !== 'ALL' ? province : undefined,
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
        province: province !== 'ALL' ? province : undefined,
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
        province: province !== 'ALL' ? province : undefined,
        tipo: tipo === 'ALL' ? undefined : tipo
      });
      showToast('success', 'Descarga iniciada');
    } catch (err: any) {
      showToast('error', err?.message || 'Error exportando facturación');
    }
  };

  const handleOpenPrint = async () => {
    try {
      await api.openBillingPrint({
        desde: desde || undefined,
        hasta: hasta || undefined,
        customerId: customerId !== 'ALL' ? customerId : undefined,
        province: province !== 'ALL' ? province : undefined,
        tipo: tipo === 'ALL' ? undefined : tipo
      });
    } catch (err: any) {
      showToast('error', err?.message || 'Error abriendo listado para imprimir');
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

  const handleExportMovimientosSistema = async () => {
    setExportingMovimientosSistema(true);
    try {
      await api.exportSaldosMovimientosSistema();
      showToast('success', 'Excel del sistema descargado (facturas, NC y recibos)');
    } catch (err: any) {
      showToast('error', err?.message || 'Error exportando movimientos del sistema');
    } finally {
      setExportingMovimientosSistema(false);
    }
  };

  const handleExportRetPerTxt = async () => {
    try {
      await api.exportRetPerTxt({
        month: retPerMonth || undefined,
        province: province !== 'ALL' ? province : undefined,
        customerId: customerId !== 'ALL' ? customerId : undefined
      });
      showToast('success', 'TXT Ret/Per descargado');
    } catch (err: any) {
      showToast('error', err?.message || 'Error exportando TXT Ret/Per');
    }
  };

  /** Exporta Excel "Ventas por Jurisdicción" para el rango de fechas seleccionado. */
  const handleExportVentasJurisdiccion = async () => {
    const d = (desde || '').trim();
    const h = (hasta || '').trim();
    if (!d || !h) {
      showToast('error', 'Elegí "Desde" y "Hasta" para exportar Ventas por Jurisdicción.');
      return;
    }
    try {
      await api.exportVentasJurisdiccion({ desde: d, hasta: h });
      showToast('success', 'Excel de Ventas por Jurisdicción descargado.');
    } catch (err: any) {
      showToast('error', err?.message || 'Error exportando Ventas por Jurisdicción');
    }
  };

  const handleExportBillingFromCustomersFile = async (file: File | null) => {
    const month = (retPerMonth || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      showToast('error', 'Mes inválido. Usá Mes RetPer en formato YYYY-MM (ej. 2026-04).');
      return;
    }
    const cuitsList = billingExportCuitsText.trim();
    if (!file && !cuitsList) {
      showToast('error', 'Pegá CUIT en la lista de abajo o elegí un archivo Excel.');
      return;
    }
    setExportingByCustomerFile(true);
    try {
      await api.exportBillingByCustomersFile({
        month,
        file: file ?? undefined,
        cuitsList: cuitsList || undefined
      });
      showToast('success', `Comprobantes exportados para ${month} (facturas + NC).`);
    } catch (err: any) {
      showToast('error', err?.message || 'Error exportando comprobantes por clientes');
    } finally {
      setExportingByCustomerFile(false);
      if (billingCustomersFileInputRef.current) billingCustomersFileInputRef.current.value = '';
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

  const handleImportAgipPadronTxt = async (file: File | null) => {
    if (!file) return;
    setImportingAgipPadron(true);
    try {
      const periodFromFilename = (() => {
        const mMyyyy = file.name.match(/(\d{2})(\d{4})(?!\d)/); // ARDJU...052026.txt => 202605
        if (mMyyyy) return `${mMyyyy[2]}${mMyyyy[1]}`;
        const yyyymm = file.name.match(/(20\d{2})(0[1-9]|1[0-2])(?!\d)/);
        if (yyyymm) return `${yyyymm[1]}${yyyymm[2]}`;
        return '';
      })();
      const periodFallback = (retPerMonth || hasta || desde || new Date().toISOString().slice(0, 10)).replace(/-/g, '').slice(0, 7).replace('-', '');
      const period = periodFromFilename || periodFallback;
      const CHUNK_LINES = 1000;
      const CHARS_PER_READ = 2 * 1024 * 1024; // 2MB por lectura para no cargar todo el TXT en memoria
      const shouldUseChunkImport = file.size > 70 * 1024 * 1024;

      const importInChunks = async () => {
        await api.importAgipPadronStart(period);
        let offset = 0;
        let carry = '';
        let batch: Array<{ cuit: string; alicuota: number }> = [];
        let importedTotal = 0;

        const flushBatch = async () => {
          if (batch.length === 0) return;
          const resChunk = await api.importAgipPadronChunk({ period, rows: batch });
          importedTotal += Number(resChunk.imported || 0);
          batch = [];
        };

        while (offset < file.size) {
          const text = await file.slice(offset, offset + CHARS_PER_READ).text();
          offset += CHARS_PER_READ;
          const merged = carry + text;
          const lines = merged.split(/\r?\n/);
          carry = lines.pop() || '';

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;
            const cols = line.split(';');
            if (cols.length < 9) continue;
            const cuit = String(cols[3] || '').replace(/\D/g, '').slice(0, 11);
            if (cuit.length !== 11) continue;
            const a1 = Number(String(cols[7] || '0').replace(',', '.')) || 0;
            const a2 = Number(String(cols[8] || '0').replace(',', '.')) || 0;
            batch.push({ cuit, alicuota: Math.max(a1, a2) });
            if (batch.length >= CHUNK_LINES) await flushBatch();
          }
        }

        const tail = carry.trim();
        if (tail) {
          const cols = tail.split(';');
          if (cols.length >= 9) {
            const cuit = String(cols[3] || '').replace(/\D/g, '').slice(0, 11);
            if (cuit.length === 11) {
              const a1 = Number(String(cols[7] || '0').replace(',', '.')) || 0;
              const a2 = Number(String(cols[8] || '0').replace(',', '.')) || 0;
              batch.push({ cuit, alicuota: Math.max(a1, a2) });
            }
          }
        }
        await flushBatch();
        showToast('success', `Padrón AGIP importado: ${importedTotal} CUIT(s) (${period}).`);
      };

      if (shouldUseChunkImport) {
        await importInChunks();
      } else {
        try {
          const res = await api.importAgipPadron({ file, period });
          showToast('success', `${res.message}: ${res.imported} CUIT(s) (${res.period}).`);
        } catch (uploadErr: any) {
          if (String(uploadErr?.message || '').includes('413')) {
            await importInChunks();
          } else {
            throw uploadErr;
          }
        }
      }
    } catch (err: any) {
      showToast('error', err?.message || 'Error importando padrón AGIP');
    } finally {
      setImportingAgipPadron(false);
      if (agipPadronInputRef.current) agipPadronInputRef.current.value = '';
    }
  };

  const facturaOptions = items
    .filter((x) => x?.tipo === 'FACTURA')
    .map((x) => {
      const hasAfipNumber = Number.isFinite(Number(x.puntoVta)) && Number.isFinite(Number(x.numeroDesde));
      const afipPrefix = x.cbteTipo === 1 ? 'A' : x.cbteTipo === 6 ? 'B' : '';
      const comprobante = hasAfipNumber
        ? `${afipPrefix} ${String(Number(x.puntoVta)).padStart(5, '0')}-${String(Number(x.numeroDesde)).padStart(8, '0')}`.trim()
        : String(x.numeroDesde || x.numeroHasta || '').trim() || 'Comprobante s/n';
      return {
      invoiceId: x.id,
      label: `${comprobante} — ${x.customerBusinessName || ''} — ${(() => {
        const d = new Date(x.fecha);
        return Number.isNaN(d.getTime()) ? String(x.fecha || '') : d.toLocaleDateString('es-AR');
      })()} — $${formatMoneyAr(Number(x.importe || 0))}`.trim(),
      customerId: x.customerId,
    };});

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
        let orderForPdf = order;
        try {
          const latestInv = await api.getOrderInvoice(order.id);
          if (latestInv) {
            orderForPdf = mergeServerInvoiceIntoOrder(order, latestInv as Record<string, unknown>);
          }
        } catch {
          /* usar factura en memoria */
        }
        const html = buildWholesaleCreditNoteHtml({
          order: orderForPdf,
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

      let orderForFactura: Order = order;
      try {
        const latestInv = await api.getOrderInvoice(order.id);
        if (latestInv) {
          orderForFactura = mergeServerInvoiceIntoOrder(order, latestInv as Record<string, unknown>);
        }
      } catch {
        /* seguir con datos del listado */
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
        order: orderForFactura,
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
  const customerCityById = useMemo(() => {
    const out = new Map<string, string>();
    for (const c of customers) out.set(String(c.id), (c.city || '').toString());
    return out;
  }, [customers]);
  const provinceOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of customers) {
      const city = (c.city || '').toString().trim();
      if (city) set.add(city);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }, [customers]);
  const customersFilteredByProvince = useMemo(() => {
    if (province === 'ALL') return customers;
    const p = province.toLowerCase();
    return customers.filter((c) => (c.city || '').toString().toLowerCase().includes(p));
  }, [customers, province]);
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
      if (province !== 'ALL') {
        const city = customerCityById.get(String(it.customerId || '')) || '';
        if (!city.toLowerCase().includes(province.toLowerCase())) return false;
      }
      if (tipo !== 'ALL' && String(it.tipo || '') !== tipo) return false;
      return true;
    });
  }, [items, desde, hasta, customerId, province, tipo, customerCityById]);
  const filteredPayments = useMemo(() => {
    return payments.filter((p: any) => {
      const dateKey = normalizeDateKey(p.date);
      if (desde && dateKey && dateKey < desde) return false;
      if (hasta && dateKey && dateKey > hasta) return false;
      if (customerId !== 'ALL' && String(p.customerId || '') !== customerId) return false;
      if (province !== 'ALL') {
        const city = customerCityById.get(String(p.customerId || '')) || '';
        if (!city.toLowerCase().includes(province.toLowerCase())) return false;
      }
      return true;
    });
  }, [payments, desde, hasta, customerId, province, customerCityById]);

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
  }, [filteredBillingItems.length, desde, hasta, customerId, province, tipo]);

  useEffect(() => {
    setPaymentsPage(1);
  }, [filteredPayments.length, desde, hasta, customerId, province]);

  useEffect(() => {
    if (customerId === 'ALL') return;
    if (!customersFilteredByProvince.some((c) => c.id === customerId)) {
      setCustomerId('ALL');
    }
  }, [customerId, customersFilteredByProvince]);

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
            onClick={() => void handleOpenPrint()}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-sky-700 text-white text-sm font-bold shadow-lg shadow-sky-900/40 hover:bg-sky-600"
            title="Abre una vista imprimible del rango seleccionado con fechas en español"
          >
            <Printer size={16} /> Imprimir listado
          </button>
          <button
            type="button"
            onClick={handleExportPendingDetail}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-cyan-700 text-white text-sm font-bold shadow-lg shadow-cyan-900/40 hover:bg-cyan-600"
          >
            <FileSpreadsheet size={16} /> Saldos pendientes (detalle)
          </button>
          <button
            type="button"
            onClick={() => { void handleExportMovimientosSistema(); }}
            disabled={exportingMovimientosSistema}
            title="Solo facturas AFIP, notas de crédito y recibos cargados en la app. Sin cuenta importada ni comprobantes externos."
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-600 text-white text-sm font-bold shadow-lg shadow-slate-900/40 hover:bg-slate-500 disabled:opacity-50"
          >
            {exportingMovimientosSistema ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
            Solo sistema (Excel)
          </button>
          <button
            type="button"
            onClick={handleExportRetPerTxt}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-700 text-white text-sm font-bold shadow-lg shadow-amber-900/40 hover:bg-amber-600"
            title="Exportar TXT de retenciones/percepciones (layout RetPer)"
          >
            <FileSpreadsheet size={16} /> Exportar TXT IIBB (RetPer)
          </button>
          <button
            type="button"
            onClick={handleExportVentasJurisdiccion}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-700 text-white text-sm font-bold shadow-lg shadow-indigo-900/40 hover:bg-indigo-600"
            title="Excel para el estudio con formato Tango (FAC + NC del rango Desde/Hasta). Provincia detectada de la ciudad del cliente."
          >
            <FileSpreadsheet size={16} /> Ventas por Jurisdicción (Excel)
          </button>
          <input
            ref={billingCustomersFileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => { void handleExportBillingFromCustomersFile(e.target.files?.[0] ?? null); }}
          />
          <button
            type="button"
            disabled={exportingByCustomerFile}
            onClick={() => billingCustomersFileInputRef.current?.click()}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-700 text-white text-sm font-bold shadow-lg shadow-emerald-900/40 hover:bg-emerald-600 disabled:opacity-50"
            title="Subí un Excel de clientes y/o usá la lista de CUIT; mes según Mes RetPer"
          >
            {exportingByCustomerFile ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
            Comprobantes por Excel / lista
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
          <input
            ref={agipPadronInputRef}
            type="file"
            accept=".txt"
            className="hidden"
            onChange={(e) => { void handleImportAgipPadronTxt(e.target.files?.[0] || null); }}
          />
          <button
            type="button"
            disabled={importingAgipPadron}
            onClick={() => agipPadronInputRef.current?.click()}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-fuchsia-700 text-white text-sm font-bold shadow-lg shadow-fuchsia-900/40 hover:bg-fuchsia-600 disabled:opacity-50"
            title="Importar padrón AGIP (ARDJU*.txt)"
          >
            {importingAgipPadron ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
            Importar padrón AGIP (TXT)
          </button>
        </div>
      </div>

      {activeView === 'billing' && (
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 space-y-2">
          <label className="text-[11px] font-black text-slate-500 uppercase tracking-wide">
            Lista de CUIT (export del Mes RetPer: facturas + NC)
          </label>
          <textarea
            value={billingExportCuitsText}
            onChange={(e) => setBillingExportCuitsText(e.target.value)}
            placeholder={'30717547515\n30528992656\n…'}
            rows={5}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm text-slate-100 font-mono placeholder:text-slate-600 resize-y min-h-[120px]"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500 max-w-3xl">
              Un CUIT por línea; también podés elegir Excel arriba y combinar. Duplicados se deduplican. Si falta un dígito (ej. 10 caracteres), revisá la hoja{' '}
              <span className="font-mono text-slate-400">CUIT invalidos</span> del archivo descargado.
            </p>
            <button
              type="button"
              disabled={exportingByCustomerFile || !billingExportCuitsText.trim()}
              onClick={() => void handleExportBillingFromCustomersFile(null)}
              className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-700 text-white text-sm font-bold border border-teal-600 hover:bg-teal-600 disabled:opacity-40 disabled:pointer-events-none"
            >
              {exportingByCustomerFile ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
              Exportar solo por lista
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
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
            {customersFilteredByProvince.map(c => (
              <option key={c.id} value={c.id}>{c.businessName || c.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-black text-slate-500 uppercase">Provincia (en ciudad)</label>
          <select
            value={province}
            onChange={e => setProvince(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-sm text-slate-100"
          >
            <option value="ALL">Todas</option>
            {provinceOptions.map((p) => (
              <option key={p} value={p}>{p}</option>
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
        <div className="space-y-1">
          <label className="text-[11px] font-black text-slate-500 uppercase">Mes RetPer</label>
          <input
            type="month"
            value={retPerMonth}
            onChange={e => setRetPerMonth(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-sm text-slate-100"
          />
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
                      <span className={`inline-flex items-center whitespace-nowrap leading-none px-2.5 py-1 rounded-full text-[11px] font-bold ${item.tipo === 'NC' ? 'bg-amber-900/40 text-amber-300 border border-amber-700/60' : 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/60'}`}>
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
                      <div className="inline-flex flex-wrap items-center justify-end gap-1 max-w-[220px]">
                        <button
                          type="button"
                          onClick={() => handleVer(item)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 text-slate-200 text-xs hover:bg-slate-700"
                          title="Ver detalle del comprobante"
                        >
                          <Eye size={14} /> Ver
                        </button>
                        {item.tipo === 'FACTURA' &&
                          item.orderId &&
                          !String(item.id || '').startsWith('mm-fac-') &&
                          onNavigate && (
                            <button
                              type="button"
                              onClick={() => {
                                /* Pre-cargamos el filtro de Pedidos con el id del pedido para que la lista se filtre directamente.
                                   El campo de búsqueda en Orders.tsx ya matchea contra `o.id`, así que esto funciona sin
                                   inventar una vista nueva ni endpoint adicional. */
                                const prev = getStoredOrdersListFilters();
                                setStoredOrdersListFilters({
                                  ...prev,
                                  customerSearchQuery: String(item.orderId),
                                  filterStatus: 'ALL',
                                  invoiceFilter: 'all',
                                });
                                onNavigate('orders');
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 text-slate-200 text-xs hover:bg-slate-700"
                              title="Ir al pedido (para emitir NC parcial por ítems, ver historial, etc.)"
                            >
                              <ExternalLink size={14} />
                            </button>
                          )}
                        {canAfipInvoiceActions &&
                          item.tipo === 'FACTURA' &&
                          item.orderId &&
                          !String(item.id || '').startsWith('mm-fac-') &&
                          Number(item.creditNotesCount || 0) === 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                showConfirm({
                                  title: 'Emitir nota de crédito por el total',
                                  message:
                                    'Se emitirá en AFIP una nota de crédito por el TOTAL de esta factura. Se restituye el stock al inventario. Esta acción no se puede deshacer en AFIP. ¿Continuar?',
                                  confirmLabel: 'Emitir NC total',
                                  onConfirm: () => {
                                    setBillingEmitNCOrderId(item.orderId);
                                    api
                                      .emitirNotaCredito(item.orderId, { tipo: 'total' })
                                      .then((r) => {
                                        showToast(
                                          'success',
                                          `NC total emitida (CAE ${r?.cae ?? '—'}). Se restituyó el stock.`
                                        );
                                        void load();
                                      })
                                      .catch((err: any) =>
                                        showToast(
                                          'error',
                                          err?.response?.data?.message ||
                                            err?.message ||
                                            'No se pudo emitir la nota de crédito'
                                        )
                                      )
                                      .finally(() => setBillingEmitNCOrderId(null));
                                  }
                                });
                              }}
                              disabled={billingEmitNCOrderId === item.orderId}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 text-orange-200/95 text-xs hover:bg-slate-700 border border-orange-900/40 disabled:opacity-50"
                              title="Emitir NC por el total de la factura (restituye stock). Para NC parcial por ítems, ir al pedido."
                            >
                              {billingEmitNCOrderId === item.orderId ? (
                                <Loader2 size={14} className="animate-spin text-orange-300" />
                              ) : (
                                <FileMinus size={14} />
                              )}
                            </button>
                          )}
                        {canAfipInvoiceActions &&
                          item.tipo === 'FACTURA' &&
                          item.orderId &&
                          !String(item.id || '').startsWith('mm-fac-') && (() => {
                            const tieneIibb =
                              Number(item.agipRetPer || 0) > 0.005 || Number(item.agipAlicuota || 0) > 0.005;
                            return (
                              <button
                                type="button"
                                onClick={() => {
                                  showConfirm({
                                    title: tieneIibb
                                      ? 'Recalcular IIBB en esta factura (PDF)'
                                      : 'Agregar IIBB a esta factura (PDF)',
                                    message: tieneIibb
                                      ? 'Se vuelve a calcular la percepción con el padrón AGIP del mes del pedido y se actualiza la factura guardada. Al reabrir el PDF verás percepción y total actualizados. El CAE en AFIP no cambia.'
                                      : 'Se busca al cliente en el padrón AGIP del mes del pedido y, si tiene alícuota, se le agrega la percepción IIBB a la factura. Al reabrir el PDF verás la percepción y el total actualizado. El CAE en AFIP no cambia (la percepción no se informa a AFIP, queda solo en el comprobante impreso).',
                                    confirmLabel: tieneIibb ? 'Recalcular IIBB' : 'Agregar IIBB',
                                    onConfirm: () => {
                                      setBillingRecalcOrderId(item.orderId);
                                      api
                                        .recalculateStoredInvoiceAgip(item.orderId)
                                        .then((r: { message?: string }) => {
                                          showToast('success', r?.message || 'IIBB actualizado. Reabrí la factura para ver el PDF.');
                                          void load();
                                        })
                                        .catch((err: any) =>
                                          showToast(
                                            'error',
                                            err?.response?.data?.message || err?.message || 'No se pudo actualizar IIBB'
                                          )
                                        )
                                        .finally(() => setBillingRecalcOrderId(null));
                                    }
                                  });
                                }}
                                disabled={billingRecalcOrderId === item.orderId}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 text-amber-200/95 text-xs hover:bg-slate-700 border border-amber-900/40 disabled:opacity-50"
                                title={
                                  tieneIibb
                                    ? 'Recalcular IIBB (AGIP) y guardar para el PDF'
                                    : 'Buscar al cliente en el padrón AGIP y agregar IIBB al PDF de esta factura (no cambia el CAE)'
                                }
                              >
                                {billingRecalcOrderId === item.orderId ? (
                                  <Loader2 size={14} className="animate-spin text-amber-300" />
                                ) : (
                                  <Percent size={14} />
                                )}
                              </button>
                            );
                          })()}
                        {canAfipInvoiceActions &&
                          item.tipo === 'FACTURA' &&
                          item.orderId &&
                          !String(item.id || '').startsWith('mm-fac-') &&
                          (Number(item.agipRetPer || 0) > 0.005 || Number(item.agipAlicuota || 0) > 0.005) &&
                          Number(item.creditNotesCount || 0) === 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    showConfirm({
                                      title: 'Nuevo CAE con IIBB en AFIP',
                                      message:
                                        'Se emitirá en AFIP una nota de crédito por el total del pedido y enseguida una nueva factura con percepción IIBB. El inventario no se modifica. Solo si el pedido no tiene notas de crédito previas. ¿Continuar?',
                                      confirmLabel: 'Reemitir con IIBB',
                                      onConfirm: () => {
                                        setBillingReemitOrderId(item.orderId);
                                        api
                                          .reemitirFacturaConAgip(item.orderId)
                                          .then((r: any) => {
                                            showToast('success', r?.message || 'Factura reemitida con nuevo CAE e IIBB en AFIP.');
                                            void load();
                                          })
                                          .catch((err: any) => {
                                            const d = err?.response?.data;
                                            const base =
                                              d?.message || err?.message || 'No se pudo reemitir la factura con IIBB';
                                            const extra = d?.creditNoteEmitted
                                              ? ` NC emitida (CAE ${d?.creditNote?.cae ?? '—'}). ${d?.detail ? String(d.detail) : ''}`
                                              : '';
                                            showToast('error', `${base}${extra ? ` — ${extra}` : ''}`);
                                            void load();
                                          })
                                          .finally(() => setBillingReemitOrderId(null));
                                      }
                                    });
                                  }}
                                  disabled={billingReemitOrderId === item.orderId}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 text-sky-200/95 text-xs hover:bg-slate-700 border border-sky-900/40 disabled:opacity-50"
                                  title="NC total + nueva factura AFIP con IIBB (nuevo CAE). Sin cambios de stock."
                                >
                                  {billingReemitOrderId === item.orderId ? (
                                    <Loader2 size={14} className="animate-spin text-sky-300" />
                                  ) : (
                                    <RefreshCcw size={14} />
                                  )}
                                </button>
                              )}
                      </div>
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
                      const next = window.prompt('Nueva fecha del recibo (YYYY-MM-DD):', String(p.date || '').slice(0, 10));
                      if (!next) return;
                      const date = next.trim();
                      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                        showToast('error', 'Fecha inválida. Usá formato YYYY-MM-DD');
                        return;
                      }
                      try {
                        if ((p.source === 'imported' || String(p.id || '').startsWith('mm-')) && p.importedLineOrder && p.customerId) {
                          await api.updateImportedPaymentDate({
                            customerId: p.customerId,
                            importedLineOrder: p.importedLineOrder,
                            date
                          });
                        } else {
                          await api.updatePaymentDate(p.id, date);
                        }
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
                    {customersFilteredByProvince.map((c) => (
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

