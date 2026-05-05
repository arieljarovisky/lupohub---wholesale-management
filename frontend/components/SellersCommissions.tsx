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

interface SellersCommissionsProps {
  orders: Order[];
  users: User[];
  customers: Customer[];
  role: Role;
  currentUser: User;
  onUpdateUser?: (user: User) => void | Promise<void>;
}

const fmtMoney = (n: number) =>
  `$${Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const toYmd = (value?: string) => {
  if (!value) return '';
  return String(value).slice(0, 10);
};

const COMMISSION_FIXED_RATE = 10;
const IVA_DIVISOR = 1.21;
const round2 = (n: number) => Math.round(n * 100) / 100;
const netWithoutIva = (gross: number) => gross / IVA_DIVISOR;
const commissionFromGross = (gross: number) => round2(netWithoutIva(gross) * (COMMISSION_FIXED_RATE / 100));

const salesTotalForSeller = (olist: Order[], sellerId: string) =>
  olist.filter((o) => o.sellerId === sellerId).reduce((sum, o) => sum + (Number(o.total) || 0), 0);

const SellersCommissions: React.FC<SellersCommissionsProps> = ({
  orders,
  users,
  customers,
  role,
  currentUser,
  onUpdateUser
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

  const sellers = useMemo(() => users.filter((u) => u.role === Role.SELLER), [users]);

  const loadSaldosCartera = useCallback(() => {
    setSaldosLoading(true);
    api
      .getCarteraTotals()
      .then((rows) => {
        const m: Record<string, number> = {};
        for (const r of rows) {
          m[r.customerId] = Number(r.saldoPendienteUnificado) || 0;
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

  const runMassExport = async () => {
    const from = massExportFrom.trim();
    const to = massExportTo.trim();
    const validationError = validateMassExportDates(from, to);
    if (validationError) {
      setMassExportError(validationError);
      return;
    }
    setMassExportError('');
    setMassExporting(true);
    try {
      for (const seller of sellers) {
        await api.exportSaldosPendientesPorCliente({
          sellerId: seller.id,
          sellerName: seller.name,
          from: from || undefined,
          to: to || undefined
        });
      }
      setMassExportModalOpen(false);
    } finally {
      setMassExporting(false);
    }
  };

  const getCommissionDetailsForSeller = (seller: User, rows: Payment[]) => {
    const customerToSeller = new Map<string, string>();
    for (const c of customers) if (c.sellerId) customerToSeller.set(c.id, c.sellerId);
    return rows
      .filter((p) => (p.sellerId || customerToSeller.get(p.customerId) || '') === seller.id)
      .map((p) => {
        const amount = Number(p.amount) || 0;
        return {
          id: p.id,
          date: toYmd(p.date),
          customerName: p.customerBusinessName || p.customerId || '',
          receiptNumber: p.receiptNumber || '',
          amount,
          commissionAmount: commissionFromGross(amount)
        };
      })
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  };

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
    ws.columns = [{ width: 14 }, { width: 34 }, { width: 18 }, { width: 14 }, { width: 14 }];
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
      header.values = ['Fecha', 'Cliente', 'Recibo', 'Monto', 'Comision'];
      header.font = { bold: true };
      for (let c = 1; c <= 5; c++) {
        const cell = header.getCell(c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        cell.alignment = { horizontal: 'left' };
      }
      rowIdx += 1;

      for (const r of detailRows) {
        const row = ws.getRow(rowIdx);
        row.values = [r.date, r.customerName, r.receiptNumber, r.amount, r.commissionAmount];
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
      totalRow.values = ['', '', 'TOTAL VENDEDOR', sellerTotalAmount, sellerTotalCommission];
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
    grandRow.values = ['', '', 'TOTAL GENERAL', grandTotalAmount, grandTotalCommission];
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
    setMassExportError('');
    setMassExporting(true);
    try {
      const rows = await api.getPayments({ desde: from || undefined, hasta: to || undefined });
      await downloadCommissionWorkbook({
        sellersToExport: sellers,
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
    const rate = COMMISSION_FIXED_RATE;
    const commissionBase = netWithoutIva(receiptsMonthForSeller(sid));
    const commission = round2(commissionBase * (rate / 100));
    const saldoTotal = totalSaldoCarteraForSeller(sid);
    const commissionDetails = getCommissionDetailsForSeller(
      u || currentUser,
      receiptRowsInRange
    );
    return { custs, ords, sales, rate, commission, saldoTotal, commissionBase, commissionDetails };
  }, [selectedSellerId, orders, users, customers, carteraByCustomer, currentUser, receiptsMonthBySeller, receiptRowsInRange]);

  if (role === Role.SELLER) {
    const sellerSales = salesTotalForSeller(orders, currentUser.id);
    const rate = COMMISSION_FIXED_RATE;
    const sid = currentUser.id;
    const commissionBase = netWithoutIva(receiptsMonthForSeller(sid));
    const commissionAmount = round2(commissionBase * (rate / 100));

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
                <p className="text-sm font-bold text-amber-200">{rate}%</p>
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
          Elegí un vendedor para ver sus clientes, pedidos, saldo pendiente de cartera (unificado) y comisión. Los vendedores se administran en{' '}
          <strong className="text-slate-300">Configuración → Usuarios</strong> o importación Excel.
        </p>
        <button
          type="button"
          onClick={() => {
            setMassExportMode('saldos');
            setMassExportError('');
            setMassExportModalOpen(true);
          }}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-emerald-700/60 text-emerald-300 hover:text-white hover:bg-emerald-700/20 text-sm font-semibold transition disabled:opacity-60"
          title="Descargar un Excel por cada vendedor (solicita fechas)"
          disabled={massExporting}
        >
          {massExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          {massExporting ? 'Exportando por vendedor…' : 'Descargar Excel por vendedor'}
        </button>
        <button
          type="button"
          onClick={() => {
            setMassExportMode('commissionDetail');
            setMassExportError('');
            setMassExportModalOpen(true);
          }}
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
          const commissionRate = COMMISSION_FIXED_RATE;
          const commissionBase = netWithoutIva(receiptsMonthForSeller(seller.id));
          const commissionAmount = round2(commissionBase * (commissionRate / 100));
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
                  <p className="text-sm font-bold text-amber-200">{commissionRate}%</p>
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
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-700">
              <h3 className="text-white font-black text-lg">Descarga masiva por vendedor</h3>
              <p className="text-slate-400 text-sm mt-1">
                {massExportMode === 'saldos'
                  ? 'Elegí rango de fechas para exportar un Excel por cada vendedor.'
                  : 'Elegí rango de fechas para exportar un detalle de comisiones por cada vendedor.'}
              </p>
            </div>

            <div className="px-5 py-4 space-y-4">
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

              {massExportError ? <p className="text-rose-300 text-sm">{massExportError}</p> : null}
            </div>

            <div className="px-5 py-4 border-t border-slate-700 flex items-center justify-end gap-2">
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
                disabled={massExporting}
              >
                {massExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                {massExporting ? 'Exportando…' : 'Descargar'}
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
  rate: number;
  commission: number;
  commissionBase: number;
  saldoTotal: number;
  commissionDetails: Array<{
    id: string;
    date: string;
    customerName: string;
    receiptNumber: string;
    amount: number;
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
  onUpdateCommission
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
}) {
  const { custs, ords, sales, rate, commission, commissionBase, saldoTotal, commissionDetails } = detail;
  const [exportFrom, setExportFrom] = useState<string>('');
  const [exportTo, setExportTo] = useState<string>('');
  const [commissionExporting, setCommissionExporting] = useState(false);
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
        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-700 bg-slate-900/60 text-slate-300 text-sm">
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
        <button
          type="button"
          onClick={() => {
            api
              .exportSaldosPendientesPorCliente({
                sellerId: seller.id,
                sellerName: seller.name,
                from: exportFrom || undefined,
                to: exportTo || undefined
              })
              .catch(() => {});
          }}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-emerald-700/60 text-emerald-300 hover:text-white hover:bg-emerald-700/20 text-sm font-semibold transition"
          title="Exportar saldos pendientes (una hoja por cliente)"
        >
          <Download size={16} />
          Exportar Excel por cliente
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
            <span className="text-xs text-slate-400">Comisión fija</span>
            <span className="text-sm font-bold text-indigo-200">{COMMISSION_FIXED_RATE}%</span>
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
            {rate}% sobre neto sin IVA ({fmtMoney(commissionBase)})
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
                <div className="col-span-4 text-white truncate">{r.customerName}</div>
                <div className="col-span-2 text-slate-300 truncate">{r.receiptNumber}</div>
                <div className="col-span-2 text-right text-emerald-300 tabular-nums">{fmtMoney(r.amount)}</div>
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
                return (
                  <div key={c.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 hover:bg-slate-800/40">
                    <div className="min-w-0">
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
                      <p className="text-[10px] text-slate-500 uppercase">Saldo</p>
                      <p className="text-sm font-bold text-amber-200/95 tabular-nums">
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
