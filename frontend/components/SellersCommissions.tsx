import React, { useState, useEffect, useMemo, useCallback } from 'react';
import ExcelJS from 'exceljs';
import {
  User as UserIcon,
  TrendingUp,
  DollarSign,
  ArrowLeft,
  ShoppingBag,
  Users,
  Wallet,
  Mail,
  MapPin,
  Building2,
  Calendar,
  Loader2,
  ChevronRight,
  Download
} from 'lucide-react';
import { Customer, Order, Payment, Role, User } from '../types';
import { api } from '../services/api';
import {
  commissionFromGross,
  commissionRateLabelForCustomers,
  effectiveCommissionRate,
  netWithoutIva,
  roundMoney2
} from '../utils/sellerCommission';

interface SellersCommissionsProps {
  orders: Order[];
  users: User[];
  customers: Customer[];
  role: Role;
  currentUser: User;
  onUpdateUser?: (user: User) => void | Promise<void>;
  onUpdateCustomer?: (customerId: string, data: Partial<Customer>) => void | Promise<void>;
}

const fmtMoney = (n: number) =>
  `$${Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const toYmd = (value?: string) => {
  if (!value) return '';
  return String(value).slice(0, 10);
};

const formatYmdLocal = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

type MassExportRangePreset =
  | 'all'
  | 'current_month'
  | 'last_month'
  | 'last_3_months'
  | 'last_6_months'
  | 'last_12_months'
  | 'ytd';

const MASS_EXPORT_RANGE_PRESETS: { id: MassExportRangePreset; label: string }[] = [
  { id: 'all', label: 'Todo el historial' },
  { id: 'current_month', label: 'Mes en curso' },
  { id: 'last_month', label: 'Mes anterior' },
  { id: 'last_3_months', label: 'Últimos 3 meses' },
  { id: 'last_6_months', label: 'Últimos 6 meses' },
  { id: 'last_12_months', label: 'Últimos 12 meses' },
  { id: 'ytd', label: 'Año en curso' }
];

function massExportRangeForPreset(preset: MassExportRangePreset): { from: string; to: string } {
  const today = new Date();
  const to = formatYmdLocal(today);
  const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
  const addMonths = (anchor: Date, delta: number) =>
    new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1);

  switch (preset) {
    case 'all':
      return { from: '', to: '' };
    case 'current_month':
      return { from: formatYmdLocal(monthStart(today)), to };
    case 'last_month': {
      const from = addMonths(monthStart(today), -1);
      const toLast = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: formatYmdLocal(from), to: formatYmdLocal(toLast) };
    }
    case 'last_3_months':
      return { from: formatYmdLocal(addMonths(monthStart(today), -2)), to };
    case 'last_6_months':
      return { from: formatYmdLocal(addMonths(monthStart(today), -5)), to };
    case 'last_12_months':
      return { from: formatYmdLocal(addMonths(monthStart(today), -11)), to };
    case 'ytd':
      return { from: `${today.getFullYear()}-01-01`, to };
    default:
      return { from: '', to: '' };
  }
}

const salesTotalForSeller = (olist: Order[], sellerId: string) =>
  olist.filter((o) => o.sellerId === sellerId).reduce((sum, o) => sum + (Number(o.total) || 0), 0);

const SellersCommissions: React.FC<SellersCommissionsProps> = ({
  orders,
  users,
  customers,
  role,
  currentUser,
  onUpdateUser,
  onUpdateCustomer
}) => {
  const todayYmd = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const monthStartYmd = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  }, []);
  const [selectedSellerId, setSelectedSellerId] = useState<string | null>(null);
  const [carteraByCustomer, setCarteraByCustomer] = useState<Record<string, number>>({});
  const [saldosLoading, setSaldosLoading] = useState(false);
  const [receiptsMonthBySeller, setReceiptsMonthBySeller] = useState<Record<string, number>>({});
  const [receiptRowsInRange, setReceiptRowsInRange] = useState<Payment[]>([]);
  const [commissionFrom, setCommissionFrom] = useState<string>(monthStartYmd);
  const [commissionTo, setCommissionTo] = useState<string>(todayYmd);
  const [commissionRangeLoading, setCommissionRangeLoading] = useState(false);
  const [massExporting, setMassExporting] = useState(false);
  const [massExportModalOpen, setMassExportModalOpen] = useState(false);
  const [massExportMode, setMassExportMode] = useState<'saldos' | 'commissionDetail'>('saldos');
  const [massExportFrom, setMassExportFrom] = useState<string>('');
  const [massExportTo, setMassExportTo] = useState<string>('');
  const [massExportError, setMassExportError] = useState<string>('');
  const [massExportSaldosSource, setMassExportSaldosSource] = useState<'historial' | 'sistema' | 'tango'>('sistema');
  const [massExportSellerIds, setMassExportSellerIds] = useState<string[]>([]);

  const sellers = useMemo(() => users.filter((u) => u.role === Role.SELLER), [users]);

  const massExportSellersSelected = useMemo(
    () => sellers.filter((s) => massExportSellerIds.includes(s.id)),
    [sellers, massExportSellerIds]
  );

  const allMassExportSellersSelected =
    sellers.length > 0 && massExportSellerIds.length === sellers.length;

  const loadSaldosCartera = useCallback(() => {
    setSaldosLoading(true);
    api
      .getCarteraTotals()
      .then((rows) => {
        const m: Record<string, number> = {};
        for (const r of rows) {
          const n = Number(r.saldoPendienteUnificado);
          m[r.customerId] = Number.isFinite(n) ? n : 0;
        }
        setCarteraByCustomer(m);
      })
      .catch(() => setCarteraByCustomer({}))
      .finally(() => setSaldosLoading(false));
  }, []);

  useEffect(() => {
    loadSaldosCartera();
  }, [loadSaldosCartera]);

  const loadReceiptsInRange = useCallback((from: string, to: string) => {
    setCommissionRangeLoading(true);
    api
      .getPayments({ desde: from, hasta: to })
      .then((rows) => {
        setReceiptRowsInRange(Array.isArray(rows) ? rows : []);
        const bySeller: Record<string, number> = {};
        for (const s of sellers) bySeller[s.id] = 0;
        const customerToSeller = new Map<string, string>();
        for (const c of customers) {
          if (c.sellerId) customerToSeller.set(c.id, c.sellerId);
        }
        for (const p of rows || []) {
          const sellerId = p.sellerId || customerToSeller.get(p.customerId) || '';
          if (!sellerId) continue;
          bySeller[sellerId] = (bySeller[sellerId] || 0) + (Number(p.amount) || 0);
        }
        setReceiptsMonthBySeller(bySeller);
      })
      .catch(() => {
        setReceiptsMonthBySeller({});
        setReceiptRowsInRange([]);
      })
      .finally(() => setCommissionRangeLoading(false));
  }, [customers, sellers]);

  useEffect(() => {
    loadReceiptsInRange(monthStartYmd, todayYmd);
  }, [loadReceiptsInRange, monthStartYmd, todayYmd]);

  const updateCommission = async (userId: string, value: string) => {
    const user = users.find((u) => u.id === userId);
    if (user && onUpdateUser) {
      await Promise.resolve(
        onUpdateUser({
          ...user,
          commissionPercentage: parseFloat(value) || 0
        })
      );
    }
  };

  const customersForSeller = (sellerId: string) => customers.filter((c) => c.sellerId === sellerId);
  const ordersForSeller = (sellerId: string) => orders.filter((o) => o.sellerId === sellerId);

  const unifiedSaldoForCustomer = (customerId: string) => carteraByCustomer[customerId] ?? 0;

  const totalSaldoCarteraForSeller = (sellerId: string) => {
    const ids = customersForSeller(sellerId).map((c) => c.id);
    return ids.reduce((sum, id) => sum + unifiedSaldoForCustomer(id), 0);
  };
  const receiptsMonthForSeller = (sellerId: string) => receiptsMonthBySeller[sellerId] ?? 0;

  const selectedSeller = selectedSellerId ? users.find((u) => u.id === selectedSellerId) : null;
  const validateMassExportDates = (from: string, to: string): string => {
    const isYmd = (v: string) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!isYmd(from) || !isYmd(to)) return 'Formato inválido. Usá YYYY-MM-DD.';
    if (from && to && from > to) return '"Desde" no puede ser mayor que "Hasta".';
    return '';
  };

  const openMassExportModal = (mode: 'saldos' | 'commissionDetail') => {
    // Saldos: por defecto todo el historial (si se fuerza el mes, las facturas viejas no salen como filas).
    // Comisiones: mes en curso (el detalle es por período de cobros).
    const { from, to } =
      mode === 'saldos' ? massExportRangeForPreset('all') : massExportRangeForPreset('current_month');
    setMassExportMode(mode);
    setMassExportFrom(from);
    setMassExportTo(to);
    setMassExportSellerIds(sellers.map((s) => s.id));
    setMassExportError('');
    setMassExportModalOpen(true);
  };

  const toggleMassExportSeller = (sellerId: string) => {
    setMassExportSellerIds((prev) =>
      prev.includes(sellerId) ? prev.filter((id) => id !== sellerId) : [...prev, sellerId]
    );
  };

  const applyMassExportPreset = (preset: MassExportRangePreset) => {
    const { from, to } = massExportRangeForPreset(preset);
    setMassExportFrom(from);
    setMassExportTo(to);
    setMassExportError('');
  };

  const activeMassExportPreset = useMemo((): MassExportRangePreset | null => {
    const from = massExportFrom.trim();
    const to = massExportTo.trim();
    if (!from && !to) return 'all';
    for (const p of MASS_EXPORT_RANGE_PRESETS) {
      if (p.id === 'all') continue;
      const r = massExportRangeForPreset(p.id);
      if (r.from === from && r.to === to) return p.id;
    }
    return null;
  }, [massExportFrom, massExportTo]);

  const runMassExport = async () => {
    const from = massExportFrom.trim();
    const to = massExportTo.trim();
    const validationError = validateMassExportDates(from, to);
    if (validationError) {
      setMassExportError(validationError);
      return;
    }
    if (massExportSellersSelected.length === 0) {
      setMassExportError('Seleccioná al menos un vendedor.');
      return;
    }
    setMassExportError('');
    setMassExporting(true);
    try {
      for (const seller of massExportSellersSelected) {
        await api.exportSaldosPendientesPorCliente({
          sellerId: seller.id,
          sellerName: seller.name,
          from: from || undefined,
          to: to || undefined,
          source: massExportSaldosSource
        });
      }
      setMassExportModalOpen(false);
    } finally {
      setMassExporting(false);
    }
  };

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const getCommissionDetailsForSeller = (seller: User, rows: Payment[]) => {
    const customerToSeller = new Map<string, string>();
    for (const c of customers) if (c.sellerId) customerToSeller.set(c.id, c.sellerId);
    return rows
      .filter((p) => (p.sellerId || customerToSeller.get(p.customerId) || '') === seller.id)
      .map((p) => {
        const amount = Number(p.amount) || 0;
        const cust = customerById.get(p.customerId);
        const rate = effectiveCommissionRate(cust, seller);
        return {
          id: p.id,
          date: toYmd(p.date),
          customerName: p.customerBusinessName || cust?.businessName || p.customerId || '',
          receiptNumber: p.receiptNumber || '',
          amount,
          commissionRate: rate,
          commissionAmount: commissionFromGross(amount, rate)
        };
      })
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  };

  const totalCommissionForSeller = (seller: User, rows: Payment[]) =>
    roundMoney2(
      getCommissionDetailsForSeller(seller, rows).reduce((sum, r) => sum + r.commissionAmount, 0)
    );

  const downloadCommissionWorkbook = async (opts: {
    sellersToExport: User[];
    from: string;
    to: string;
    rows: Payment[];
    fileName: string;
  }) => {
    const { sellersToExport, from, to, rows, fileName } = opts;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Detalle comisiones');
    ws.columns = [{ width: 14 }, { width: 34 }, { width: 18 }, { width: 14 }, { width: 12 }, { width: 14 }];
    let rowIdx = 1;
    let grandTotalAmount = 0;
    let grandTotalCommission = 0;

    for (const seller of sellersToExport) {
      const detailRows = getCommissionDetailsForSeller(seller, rows);
      const sellerTotalAmount = detailRows.reduce((sum, r) => sum + r.amount, 0);
      const sellerTotalCommission = detailRows.reduce((sum, r) => sum + r.commissionAmount, 0);
      grandTotalAmount += sellerTotalAmount;
      grandTotalCommission += sellerTotalCommission;
      ws.mergeCells(`A${rowIdx}:E${rowIdx}`);
      const title = ws.getCell(`A${rowIdx}`);
      title.value = `Vendedor: ${seller.name} (${from || 'inicio'} a ${to || 'hoy'})`;
      title.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
      title.alignment = { horizontal: 'left', vertical: 'middle' };
      rowIdx += 1;

      const header = ws.getRow(rowIdx);
      header.values = ['Fecha', 'Cliente', 'Recibo', 'Monto', '% Comisión', 'Comisión'];
      header.font = { bold: true };
      for (let c = 1; c <= 5; c++) {
        const cell = header.getCell(c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        cell.alignment = { horizontal: 'left' };
      }
      rowIdx += 1;

      for (const r of detailRows) {
        const row = ws.getRow(rowIdx);
        row.values = [r.date, r.customerName, r.receiptNumber, r.amount, r.commissionRate, r.commissionAmount];
        row.getCell(4).numFmt = '#,##0.00';
        row.getCell(5).numFmt = '#,##0.00';
        rowIdx += 1;
      }

      if (detailRows.length === 0) {
        ws.mergeCells(`A${rowIdx}:E${rowIdx}`);
        ws.getCell(`A${rowIdx}`).value = 'Sin recibos en el rango.';
        ws.getCell(`A${rowIdx}`).font = { italic: true, color: { argb: 'FF64748B' } };
        rowIdx += 1;
      }

      const totalRow = ws.getRow(rowIdx);
      totalRow.values = ['', '', 'TOTAL VENDEDOR', sellerTotalAmount, '', sellerTotalCommission];
      totalRow.font = { bold: true };
      totalRow.getCell(3).alignment = { horizontal: 'right' };
      totalRow.getCell(4).numFmt = '#,##0.00';
      totalRow.getCell(5).numFmt = '#,##0.00';
      for (let c = 3; c <= 5; c++) {
        totalRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      }
      rowIdx += 1;

      rowIdx += 2;
    }

    const grandRow = ws.getRow(rowIdx);
    grandRow.values = ['', '', 'TOTAL GENERAL', grandTotalAmount, '', grandTotalCommission];
    grandRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    grandRow.getCell(3).alignment = { horizontal: 'right' };
    grandRow.getCell(4).numFmt = '#,##0.00';
    grandRow.getCell(5).numFmt = '#,##0.00';
    for (let c = 3; c <= 5; c++) {
      grandRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    }

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const runMassCommissionDetailExport = async () => {
    const from = massExportFrom.trim();
    const to = massExportTo.trim();
    const validationError = validateMassExportDates(from, to);
    if (validationError) {
      setMassExportError(validationError);
      return;
    }
    if (massExportSellersSelected.length === 0) {
      setMassExportError('Seleccioná al menos un vendedor.');
      return;
    }
    setMassExportError('');
    setMassExporting(true);
    try {
      const rows = await api.getPayments({ desde: from || undefined, hasta: to || undefined });
      await downloadCommissionWorkbook({
        sellersToExport: massExportSellersSelected,
        from,
        to,
        rows: rows || [],
        fileName: `detalle_comisiones_vendedores_${from || 'desde'}_${to || 'hasta'}.xlsx`
      });
      setMassExportModalOpen(false);
    } finally {
      setMassExporting(false);
    }
  };

  const sellerDetail = useMemo(() => {
    if (!selectedSellerId) return null;
    const sid = selectedSellerId;
    const custs = customersForSeller(sid);
    const ords = ordersForSeller(sid).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const sales = salesTotalForSeller(orders, sid);
    const u = users.find((x) => x.id === sid);
    const sellerUser = u || currentUser;
    const commissionBase = netWithoutIva(receiptsMonthForSeller(sid));
    const commission = totalCommissionForSeller(sellerUser, receiptRowsInRange);
    const rateLabel = commissionRateLabelForCustomers(custs, sellerUser);
    const saldoTotal = totalSaldoCarteraForSeller(sid);
    const commissionDetails = getCommissionDetailsForSeller(sellerUser, receiptRowsInRange);
    return { custs, ords, sales, rateLabel, commission, saldoTotal, commissionBase, commissionDetails, sellerUser };
  }, [selectedSellerId, orders, users, customers, carteraByCustomer, currentUser, receiptsMonthBySeller, receiptRowsInRange, customerById]);

  if (role === Role.SELLER) {
    const sellerSales = salesTotalForSeller(orders, currentUser.id);
    const sid = currentUser.id;
    const myCusts = customersForSeller(sid);
    const rateLabel = commissionRateLabelForCustomers(myCusts, currentUser);
    const commissionAmount = totalCommissionForSeller(currentUser, receiptRowsInRange);

    if (selectedSellerId === sid && sellerDetail) {
      return (
        <SellerDetailView
          seller={currentUser}
          detail={sellerDetail}
          commissionFrom={commissionFrom}
          commissionTo={commissionTo}
          onExportCommissionDetail={async (from, to) => {
            const rows = await api.getPayments({ desde: from || undefined, hasta: to || undefined });
            await downloadCommissionWorkbook({
              sellersToExport: [currentUser],
              from,
              to,
              rows: rows || [],
              fileName: `detalle_comision_${currentUser.name}_${from || 'desde'}_${to || 'hasta'}.xlsx`
            });
          }}
          saldosLoading={saldosLoading}
          unifiedSaldoForCustomer={unifiedSaldoForCustomer}
          onBack={() => setSelectedSellerId(null)}
          onRefreshSaldos={loadSaldosCartera}
          commissionEditable={false}
          onUpdateCommission={updateCommission}
          onUpdateCustomer={onUpdateCustomer}
        />
      );
    }

    return (
      <div className="space-y-6 animate-fade-in pb-10">
        <p className="text-sm text-slate-400">
          Tocá la tarjeta para ver clientes, pedidos, saldos de cartera y métricas.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <button
            type="button"
            onClick={() => setSelectedSellerId(sid)}
            className="text-left bg-slate-800/90 hover:bg-slate-800 rounded-2xl border border-slate-700 hover:border-blue-500/40 p-5 transition-all shadow-lg group"
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl flex items-center justify-center text-white shadow-lg shrink-0">
                <UserIcon size={24} />
              </div>
              <ChevronRight className="text-slate-600 group-hover:text-blue-400 shrink-0" size={20} />
            </div>
            <h4 className="font-black text-white text-lg truncate">{currentUser.name}</h4>
            <p className="text-xs text-slate-500 truncate mb-4">{currentUser.email}</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-slate-900/60 rounded-xl py-2 border border-slate-700/50">
                <p className="text-[9px] font-black text-slate-500 uppercase">Ventas</p>
                <p className="text-sm font-bold text-white tabular-nums">{fmtMoney(sellerSales)}</p>
              </div>
              <div className="bg-slate-900/60 rounded-xl py-2 border border-slate-700/50">
                <p className="text-[9px] font-black text-slate-500 uppercase">%</p>
                <p className="text-sm font-bold text-amber-200">{rateLabel}</p>
              </div>
              <div className="bg-indigo-950/40 rounded-xl py-2 border border-indigo-800/40">
                <p className="text-[9px] font-black text-indigo-400 uppercase">Est.</p>
                <p className="text-sm font-bold text-indigo-200 tabular-nums">{fmtMoney(commissionAmount)}</p>
              </div>
            </div>
          </button>
        </div>
      </div>
    );
  }

  if (sellers.length === 0) {
    return (
      <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-8 text-center text-slate-400 text-sm">
        No hay usuarios con rol vendedor. Creá uno en Configuración.
      </div>
    );
  }

  if (selectedSellerId && selectedSeller && sellerDetail) {
    return (
      <SellerDetailView
        seller={selectedSeller}
        detail={sellerDetail}
        commissionFrom={commissionFrom}
        commissionTo={commissionTo}
        onExportCommissionDetail={async (from, to) => {
          const rows = await api.getPayments({ desde: from || undefined, hasta: to || undefined });
          await downloadCommissionWorkbook({
            sellersToExport: [selectedSeller],
            from,
            to,
            rows: rows || [],
            fileName: `detalle_comision_${selectedSeller.name}_${from || 'desde'}_${to || 'hasta'}.xlsx`
          });
        }}
        saldosLoading={saldosLoading}
        unifiedSaldoForCustomer={unifiedSaldoForCustomer}
        onBack={() => setSelectedSellerId(null)}
        onRefreshSaldos={loadSaldosCartera}
        commissionEditable
        onUpdateCommission={updateCommission}
        onUpdateCustomer={onUpdateCustomer}
      />
    );
  }

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] font-black uppercase tracking-wide text-slate-500 mb-1">Comisión desde</label>
          <input
            type="date"
            value={commissionFrom}
            onChange={(e) => setCommissionFrom(e.target.value)}
            className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-wide text-slate-500 mb-1">Comisión hasta</label>
          <input
            type="date"
            value={commissionTo}
            onChange={(e) => setCommissionTo(e.target.value)}
            className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            if (!commissionFrom || !commissionTo) {
              window.alert('Completá ambas fechas para calcular comisión.');
              return;
            }
            if (commissionFrom > commissionTo) {
              window.alert('El rango es inválido: "desde" no puede ser mayor que "hasta".');
              return;
            }
            loadReceiptsInRange(commissionFrom, commissionTo);
          }}
          disabled={commissionRangeLoading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-indigo-700/60 text-indigo-300 hover:text-white hover:bg-indigo-700/20 text-sm font-semibold transition disabled:opacity-50"
        >
          {commissionRangeLoading ? <Loader2 size={16} className="animate-spin" /> : null}
          Calcular comisión
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          Elegí un vendedor para ver sus clientes, pedidos, saldo pendiente de cartera (unificado) y comisión. Podés definir un % por defecto del vendedor y un % distinto por cliente. Los vendedores se administran en{' '}
          <strong className="text-slate-300">Configuración → Usuarios</strong> o importación Excel.
        </p>
        <button
          type="button"
          onClick={() => openMassExportModal('saldos')}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-emerald-700/60 text-emerald-300 hover:text-white hover:bg-emerald-700/20 text-sm font-semibold transition disabled:opacity-60"
          title="Descargar un Excel por cada vendedor (solicita fechas)"
          disabled={massExporting}
        >
          {massExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          {massExporting ? 'Exportando por vendedor…' : 'Descargar Excel por vendedor'}
        </button>
        <button
          type="button"
          onClick={() => openMassExportModal('commissionDetail')}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-indigo-700/60 text-indigo-300 hover:text-white hover:bg-indigo-700/20 text-sm font-semibold transition disabled:opacity-60"
          title="Descargar detalle de comisiones por cada vendedor (solicita fechas)"
          disabled={massExporting}
        >
          {massExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          {massExporting ? 'Exportando detalle…' : 'Descargar detalle comisiones por vendedor'}
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {sellers.map((seller) => {
          const sellerSales = salesTotalForSeller(orders, seller.id);
          const custsForCard = customersForSeller(seller.id);
          const commissionBase = netWithoutIva(receiptsMonthForSeller(seller.id));
          const commissionAmount = totalCommissionForSeller(seller, receiptRowsInRange);
          const commissionRateLabel = commissionRateLabelForCustomers(custsForCard, seller);
          const nCli = customersForSeller(seller.id).length;
          const nOrd = ordersForSeller(seller.id).length;

          return (
            <button
              key={seller.id}
              type="button"
              onClick={() => setSelectedSellerId(seller.id)}
              className="text-left bg-slate-800/90 hover:bg-slate-800 rounded-2xl border border-slate-700 hover:border-blue-500/40 p-5 transition-all shadow-lg group"
            >
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl flex items-center justify-center text-white shadow-lg shrink-0">
                    <UserIcon size={24} />
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-black text-white text-lg truncate">{seller.name}</h4>
                    <p className="text-xs text-slate-500 truncate">{seller.email}</p>
                  </div>
                </div>
                <ChevronRight className="text-slate-600 group-hover:text-blue-400 shrink-0" size={22} />
              </div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[9px] font-black text-slate-500 uppercase px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700">
                  Activo
                </span>
                <span className="text-[11px] text-slate-500">
                  {nCli} cliente(s) · {nOrd} pedido(s)
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-slate-900/60 rounded-xl py-2.5 border border-slate-700/50">
                  <p className="text-[9px] font-black text-slate-500 uppercase mb-0.5">Ventas</p>
                  <p className="text-sm font-bold text-white tabular-nums">{fmtMoney(sellerSales)}</p>
                </div>
                <div className="bg-slate-900/60 rounded-xl py-2.5 border border-slate-700/50">
                  <p className="text-[9px] font-black text-slate-500 uppercase mb-0.5">Comisión</p>
                  <p className="text-sm font-bold text-amber-200">{commissionRateLabel}</p>
                </div>
                <div className="bg-indigo-950/40 rounded-xl py-2.5 border border-indigo-800/40">
                  <p className="text-[9px] font-black text-indigo-400 uppercase mb-0.5">Estimado</p>
                  <p className="text-sm font-bold text-indigo-200 tabular-nums">{fmtMoney(commissionAmount)}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {massExportModalOpen && (
        <div className="fixed inset-0 z-[110] bg-black/65 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl max-h-[min(92vh,720px)] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-700 shrink-0">
              <h3 className="text-white font-black text-lg">Descarga masiva por vendedor</h3>
              <p className="text-slate-400 text-sm mt-1">
                {massExportMode === 'saldos'
                  ? 'Elegí vendedores y, si querés, un rango. Por defecto se incluye todo el historial (facturas, pedidos, NC y recibos) de cada cliente.'
                  : 'Elegí vendedores y rango de fechas. Se arma un detalle de comisiones por cada uno.'}
              </p>
            </div>

            <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1 min-h-0">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    Vendedores ({massExportSellersSelected.length}/{sellers.length})
                  </p>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={massExporting || allMassExportSellersSelected}
                      onClick={() => setMassExportSellerIds(sellers.map((s) => s.id))}
                      className="px-2 py-1 rounded-md text-[11px] font-semibold border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                    >
                      Todos
                    </button>
                    <button
                      type="button"
                      disabled={massExporting || massExportSellerIds.length === 0}
                      onClick={() => setMassExportSellerIds([])}
                      className="px-2 py-1 rounded-md text-[11px] font-semibold border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                    >
                      Ninguno
                    </button>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-700 bg-slate-950/60 max-h-44 overflow-y-auto divide-y divide-slate-800">
                  {sellers.map((seller) => {
                    const checked = massExportSellerIds.includes(seller.id);
                    return (
                      <label
                        key={seller.id}
                        className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-800/50 ${
                          checked ? 'bg-blue-950/20' : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="accent-blue-500 shrink-0"
                          checked={checked}
                          disabled={massExporting}
                          onChange={() => toggleMassExportSeller(seller.id)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-slate-100 truncate">{seller.name}</span>
                          <span className="block text-[11px] text-slate-500 truncate">{seller.email}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Rango rápido</p>
                <div className="flex flex-wrap gap-1.5">
                  {MASS_EXPORT_RANGE_PRESETS.map((p) => {
                    const active = activeMassExportPreset === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => applyMassExportPreset(p.id)}
                        disabled={massExporting}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition touch-manipulation ${
                          active
                            ? 'bg-blue-600/30 border-blue-500/70 text-blue-100'
                            : 'bg-slate-800/80 border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white'
                        } disabled:opacity-50`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">Desde</label>
                <input
                  type="date"
                  value={massExportFrom}
                  onChange={(e) => setMassExportFrom(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">Hasta</label>
                <input
                  type="date"
                  value={massExportTo}
                  onChange={(e) => setMassExportTo(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {massExportMode === 'saldos' && (
                <p className="text-[11px] text-slate-500 leading-snug">
                  Con fechas vacías («Todo el historial») el detalle lista todas las facturas/pedidos/NC/recibos de cada cliente.
                  Si filtrás un rango, solo aparecen movimientos de ese período; el saldo verde sigue siendo la deuda actual.
                </p>
              )}

              {massExportMode === 'saldos' ? (
                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Tipo de saldos por cliente</p>
                  <label className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
                    <input
                      type="radio"
                      name="massExportSaldosSource"
                      className="accent-emerald-500"
                      checked={massExportSaldosSource === 'sistema'}
                      onChange={() => setMassExportSaldosSource('sistema')}
                    />
                    Solo cargado en LupoHub (facturas, NC y recibos AFIP)
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
                    <input
                      type="radio"
                      name="massExportSaldosSource"
                      className="accent-emerald-500"
                      checked={massExportSaldosSource === 'historial'}
                      onChange={() => setMassExportSaldosSource('historial')}
                    />
                    Historial completo (sistema + externos por CUIT; sin import Tango)
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
                    <input
                      type="radio"
                      name="massExportSaldosSource"
                      className="accent-amber-500"
                      checked={massExportSaldosSource === 'tango'}
                      onChange={() => {
                        setMassExportSaldosSource('tango');
                        // El import Tango es histórico: un rango de mes oculta todas las FAC.
                        setMassExportFrom('');
                        setMassExportTo('');
                      }}
                    />
                    Solo importado de Tango (Multimedia) — historial completo
                  </label>
                  {massExportSaldosSource === 'tango' ? (
                    <p className="text-[11px] text-amber-200/90 leading-snug">
                      En modo Tango se listan todas las facturas/recibos importados del cliente (se ignora el rango de fechas).
                    </p>
                  ) : null}
                </div>
              ) : null}

              {massExportError ? <p className="text-rose-300 text-sm">{massExportError}</p> : null}
            </div>

            <div className="px-5 py-4 border-t border-slate-700 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  if (massExporting) return;
                  setMassExportModalOpen(false);
                  setMassExportError('');
                }}
                className="px-3 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 text-sm font-semibold transition"
                disabled={massExporting}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={massExportMode === 'saldos' ? runMassExport : runMassCommissionDetailExport}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-700/60 text-emerald-300 hover:text-white hover:bg-emerald-700/20 text-sm font-semibold transition disabled:opacity-60"
                disabled={massExporting || massExportSellersSelected.length === 0}
              >
                {massExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                {massExporting
                  ? 'Exportando…'
                  : `Descargar (${massExportSellersSelected.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

type DetailShape = {
  custs: Customer[];
  ords: Order[];
  sales: number;
  rateLabel: string;
  commission: number;
  commissionBase: number;
  saldoTotal: number;
  commissionDetails: Array<{
    id: string;
    date: string;
    customerName: string;
    receiptNumber: string;
    amount: number;
    commissionRate: number;
    commissionAmount: number;
  }>;
};

function SellerDetailView({
  seller,
  detail,
  commissionFrom,
  commissionTo,
  onExportCommissionDetail,
  saldosLoading,
  unifiedSaldoForCustomer,
  onBack,
  onRefreshSaldos,
  commissionEditable,
  onUpdateCommission,
  onUpdateCustomer
}: {
  seller: User;
  detail: DetailShape;
  commissionFrom: string;
  commissionTo: string;
  onExportCommissionDetail: (from: string, to: string) => Promise<void>;
  saldosLoading: boolean;
  unifiedSaldoForCustomer: (customerId: string) => number;
  onBack: () => void;
  onRefreshSaldos: () => void;
  commissionEditable: boolean;
  onUpdateCommission: (userId: string, value: string) => void | Promise<void>;
  onUpdateCustomer?: (customerId: string, data: Partial<Customer>) => void | Promise<void>;
}) {
  const { custs, ords, sales, rateLabel, commission, commissionBase, saldoTotal, commissionDetails } = detail;
  const defaultSellerRate = seller.commissionPercentage ?? 0;
  const [savingCustomerCommissionId, setSavingCustomerCommissionId] = useState<string | null>(null);
  const [exportFrom, setExportFrom] = useState<string>('');
  const [exportTo, setExportTo] = useState<string>('');
  const [commissionExporting, setCommissionExporting] = useState(false);
  const [exportSaldosLoading, setExportSaldosLoading] = useState<'idle' | 'historial' | 'sistema' | 'tango'>('idle');
  const downloadCommissionDetailExcel = async () => {
    setCommissionExporting(true);
    try {
      await onExportCommissionDetail(commissionFrom, commissionTo);
    } finally {
      setCommissionExporting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700 text-sm font-semibold transition"
        >
          <ArrowLeft size={18} />
          Volver
        </button>
        <button
          type="button"
          onClick={onRefreshSaldos}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-700 text-slate-400 hover:text-white text-sm"
        >
          {saldosLoading ? <Loader2 size={16} className="animate-spin" /> : null}
          Actualizar saldos
        </button>
        <div className="inline-flex flex-col gap-1 px-3 py-2 rounded-xl border border-slate-700 bg-slate-900/60 text-slate-300 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400">Desde</span>
            <input
              type="date"
              value={exportFrom}
              onChange={(e) => setExportFrom(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded-lg px-2 py-1 text-xs text-white outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-slate-400">Hasta</span>
            <input
              type="date"
              value={exportTo}
              onChange={(e) => setExportTo(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded-lg px-2 py-1 text-xs text-white outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <span className="text-[10px] text-slate-500 max-w-md leading-snug">
            Dejá las fechas vacías para listar todas las facturas/pedidos de cada cliente. Si ponés rango, el detalle solo incluye movimientos entre «desde» y «hasta»; el saldo verde es la deuda actual.
          </span>
        </div>
        <button
          type="button"
          disabled={exportSaldosLoading !== 'idle'}
          onClick={async () => {
            setExportSaldosLoading('sistema');
            try {
              await api.exportSaldosPendientesPorCliente({
                sellerId: seller.id,
                sellerName: seller.name,
                from: exportFrom || undefined,
                to: exportTo || undefined,
                source: 'sistema'
              });
            } catch {
              window.alert('No se pudo exportar solo sistema. Probá de nuevo o revisá la conexión.');
            } finally {
              setExportSaldosLoading('idle');
            }
          }}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-emerald-700/60 text-emerald-300 hover:text-white hover:bg-emerald-700/20 text-sm font-semibold transition disabled:opacity-50"
          title="Solo facturas AFIP, notas de crédito y recibos cargados en LupoHub (sin import ni externos)"
        >
          {exportSaldosLoading === 'sistema' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          Excel por cliente · solo sistema
        </button>
        <button
          type="button"
          disabled={exportSaldosLoading !== 'idle'}
          onClick={async () => {
            setExportSaldosLoading('historial');
            try {
              await api.exportSaldosPendientesPorCliente({
                sellerId: seller.id,
                sellerName: seller.name,
                from: exportFrom || undefined,
                to: exportTo || undefined,
                source: 'historial'
              });
            } catch {
              window.alert('No se pudo exportar el historial. Probá de nuevo o revisá la conexión.');
            } finally {
              setExportSaldosLoading('idle');
            }
          }}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-600 text-slate-200 hover:text-white hover:bg-slate-800 text-sm font-semibold transition disabled:opacity-50"
          title="Facturas, notas de crédito y recibos del sistema más comprobantes externos por CUIT (sin import Tango)"
        >
          {exportSaldosLoading === 'historial' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          Excel por cliente · historial
        </button>
        <button
          type="button"
          disabled={exportSaldosLoading !== 'idle'}
          onClick={async () => {
            setExportSaldosLoading('tango');
            try {
              await api.exportSaldosPendientesPorCliente({
                sellerId: seller.id,
                sellerName: seller.name,
                source: 'tango'
              });
            } catch {
              window.alert('No se pudo exportar lo de Tango. Probá de nuevo o revisá la conexión.');
            } finally {
              setExportSaldosLoading('idle');
            }
          }}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-amber-700/60 text-amber-300 hover:text-white hover:bg-amber-700/20 text-sm font-semibold transition disabled:opacity-50"
          title="Historial completo importado de Tango/Multimedia (ignora el rango de fechas)"
        >
          {exportSaldosLoading === 'tango' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          Excel por cliente · solo Tango
        </button>
        <button
          type="button"
          onClick={() => {
            void downloadCommissionDetailExcel();
          }}
          disabled={commissionExporting}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-indigo-700/60 text-indigo-300 hover:text-white hover:bg-indigo-700/20 text-sm font-semibold transition"
          title="Descargar detalle de comisiones por recibo"
        >
          {commissionExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          Exportar detalle de comisiones
        </button>
      </div>

      <div className="flex flex-wrap items-start gap-4 justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl flex items-center justify-center text-white shadow-xl shrink-0">
            <UserIcon size={32} />
          </div>
          <div className="min-w-0">
            <h2 className="text-2xl font-black text-white truncate">{seller.name}</h2>
            <p className="text-sm text-slate-500 truncate">{seller.email}</p>
          </div>
        </div>
        {commissionEditable && (
          <div className="flex items-center gap-2 bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-2">
            <span className="text-xs text-slate-400 whitespace-nowrap">Comisión por defecto</span>
            <input
              type="number"
              min={0}
              max={100}
              step={0.01}
              key={`seller-rate-${seller.id}-${defaultSellerRate}`}
              defaultValue={defaultSellerRate}
              onBlur={(e) => {
                void onUpdateCommission(seller.id, e.target.value);
              }}
              className="w-20 bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-sm text-indigo-200 font-bold text-right outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <span className="text-xs text-slate-500">%</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-slate-800/90 rounded-2xl border border-slate-700 p-4">
          <div className="flex items-center gap-2 text-slate-500 text-[10px] font-black uppercase mb-1">
            <Users size={12} /> Clientes
          </div>
          <p className="text-2xl font-black text-white">{custs.length}</p>
        </div>
        <div className="bg-slate-800/90 rounded-2xl border border-slate-700 p-4">
          <div className="flex items-center gap-2 text-slate-500 text-[10px] font-black uppercase mb-1">
            <ShoppingBag size={12} /> Pedidos
          </div>
          <p className="text-2xl font-black text-white">{ords.length}</p>
        </div>
        <div className="bg-slate-800/90 rounded-2xl border border-slate-700 p-4">
          <div className="flex items-center gap-2 text-slate-500 text-[10px] font-black uppercase mb-1">
            <DollarSign size={12} /> Ventas
          </div>
          <p className="text-xl font-black text-white tabular-nums">{fmtMoney(sales)}</p>
        </div>
        <div className="bg-slate-800/90 rounded-2xl border border-amber-900/40 p-4">
          <div className="flex items-center gap-2 text-amber-400/90 text-[10px] font-black uppercase mb-1">
            <Wallet size={12} /> Saldo pendiente
          </div>
          <p className="text-xl font-black text-amber-100 tabular-nums">
            {saldosLoading ? '…' : fmtMoney(saldoTotal)}
          </p>
          <p className="text-[10px] text-slate-500 mt-1">Importado + facturas/pedidos − NC − recibos (cartera)</p>
        </div>
        <div className="bg-indigo-950/50 rounded-2xl border border-indigo-800/50 p-4">
          <div className="flex items-center gap-2 text-indigo-400 text-[10px] font-black uppercase mb-1">
            <TrendingUp size={12} /> Comisión est.
          </div>
          <p className="text-xl font-black text-indigo-200 tabular-nums">{fmtMoney(commission)}</p>
          <p className="text-[10px] text-slate-500 mt-1">
            {rateLabel} sobre neto sin IVA ({fmtMoney(commissionBase)})
          </p>
        </div>
      </div>

      <div className="bg-slate-800/60 rounded-2xl border border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between gap-2">
          <h3 className="font-bold text-white text-sm">
            Detalle comisión ({commissionFrom || '...'} a {commissionTo || '...'})
          </h3>
          <button
            type="button"
            onClick={() => {
              void downloadCommissionDetailExcel();
            }}
            disabled={commissionExporting}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-indigo-700/60 text-indigo-300 hover:text-white hover:bg-indigo-700/20 text-xs font-semibold transition"
          >
            {commissionExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Descargar detalle
          </button>
        </div>
        <div className="max-h-[320px] overflow-y-auto divide-y divide-slate-800">
          {commissionDetails.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No hay recibos en el rango seleccionado para este vendedor.</p>
          ) : (
            commissionDetails.map((r) => (
              <div key={r.id} className="px-4 py-3 grid grid-cols-12 gap-2 items-center text-sm">
                <div className="col-span-2 text-slate-400">{r.date}</div>
                <div className="col-span-3 text-white truncate">{r.customerName}</div>
                <div className="col-span-2 text-slate-300 truncate">{r.receiptNumber}</div>
                <div className="col-span-2 text-right text-emerald-300 tabular-nums">{fmtMoney(r.amount)}</div>
                <div className="col-span-1 text-right text-amber-200/90 tabular-nums text-xs">{r.commissionRate}%</div>
                <div className="col-span-2 text-right text-indigo-300 tabular-nums">{fmtMoney(r.commissionAmount)}</div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-slate-800/60 rounded-2xl border border-slate-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-2">
            <Building2 size={18} className="text-blue-400" />
            <h3 className="font-bold text-white text-sm">Clientes ({custs.length})</h3>
          </div>
          <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-800">
            {custs.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">Sin clientes asignados a este vendedor.</p>
            ) : (
              custs.map((c) => {
                const sal = unifiedSaldoForCustomer(c.id);
                const effectiveRate = effectiveCommissionRate(c, seller);
                const pctValue =
                  c.sellerCommissionPercentage != null && Number.isFinite(c.sellerCommissionPercentage)
                    ? String(c.sellerCommissionPercentage)
                    : '';
                return (
                  <div key={c.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 hover:bg-slate-800/40">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-white truncate">{c.businessName}</p>
                      <p className="text-xs text-slate-500 flex items-center gap-2 truncate">
                        <Mail size={11} className="shrink-0" /> {c.email}
                      </p>
                      {c.city ? (
                        <p className="text-[11px] text-slate-600 flex items-center gap-1 mt-0.5">
                          <MapPin size={11} /> {c.city}
                        </p>
                      ) : null}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-slate-500 uppercase">Comisión</p>
                      {commissionEditable && onUpdateCustomer ? (
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.01}
                          defaultValue={pctValue}
                          placeholder={String(defaultSellerRate)}
                          disabled={savingCustomerCommissionId === c.id}
                          title={`Vacío = comisión por defecto del vendedor (${defaultSellerRate}%)`}
                          onBlur={async (e) => {
                            const raw = e.target.value.trim();
                            const next =
                              raw === '' ? null : Math.min(100, Math.max(0, parseFloat(raw) || 0));
                            if (
                              (next == null && c.sellerCommissionPercentage == null) ||
                              (next != null && c.sellerCommissionPercentage === next)
                            ) {
                              return;
                            }
                            setSavingCustomerCommissionId(c.id);
                            try {
                              await onUpdateCustomer(c.id, { sellerCommissionPercentage: next });
                            } finally {
                              setSavingCustomerCommissionId(null);
                            }
                          }}
                          className="mt-0.5 w-16 bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-sm text-amber-200 font-bold text-right outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      ) : (
                        <p className="text-sm font-bold text-amber-200 tabular-nums">{effectiveRate}%</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-slate-500 uppercase">Saldo</p>
                      <p
                        className={`text-sm font-bold tabular-nums ${
                          sal < -0.01 ? 'text-emerald-300' : sal > 0.01 ? 'text-amber-200/95' : 'text-slate-400'
                        }`}
                        title={sal < -0.01 ? 'Saldo a favor del cliente (le debés)' : undefined}
                      >
                        {saldosLoading ? '…' : fmtMoney(sal)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="bg-slate-800/60 rounded-2xl border border-slate-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-2">
            <ShoppingBag size={18} className="text-emerald-400" />
            <h3 className="font-bold text-white text-sm">Pedidos ({ords.length})</h3>
          </div>
          <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-800">
            {ords.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">Sin pedidos asignados a este vendedor.</p>
            ) : (
              ords.map((o) => (
                <div key={o.id} className="px-4 py-3 hover:bg-slate-800/40">
                  <div className="flex justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500">#{o.id.slice(0, 8)}</p>
                      <p className="font-medium text-white truncate">{o.customerBusinessName || 'Cliente'}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-white tabular-nums">{fmtMoney(Number(o.total) || 0)}</p>
                      <p className="text-[10px] text-slate-500">{o.status}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
                    <Calendar size={12} />
                    {o.date ? new Date(o.date).toLocaleDateString('es-AR') : '—'}
                    {o.paymentStatus ? (
                      <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700">{o.paymentStatus}</span>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SellersCommissions;
