import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Loader2, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import TiendaNubeOrders from './TiendaNubeOrders';
import MercadoLibreOrders from './MercadoLibreOrders';
import { api } from '../services/api';

type SourceFilter = 'ALL' | 'TIENDANUBE' | 'MERCADOLIBRE';
type ChannelTab = 'TN' | 'ML';

interface ExternalInvoiceRow {
  id: string;
  source: string;
  externalOrderId: string;
  orderNumber?: string;
  customerName?: string;
  total: number;
  cae: string;
  cbteTipo: number;
  cbteDesde: number;
  createdAt?: string;
  hasCreditNote?: boolean;
  creditNote?: {
    id: string;
    cae: string;
    cbteTipo: number;
    cbteDesde: number;
  };
}

const BulkInvoicing: React.FC = () => {
  const [channelTab, setChannelTab] = useState<ChannelTab>('TN');
  const [historySource, setHistorySource] = useState<SourceFilter>('ALL');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [history, setHistory] = useState<ExternalInvoiceRow[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [selectedInvoice, setSelectedInvoice] = useState<ExternalInvoiceRow | null>(null);
  const [historyLimit, setHistoryLimit] = useState(20);
  const [globalTotals, setGlobalTotals] = useState({ all: 0, tn: 0, ml: 0 });

  const fetchHistory = async () => {
    setLoadingHistory(true);
    try {
      const source: 'TIENDANUBE' | 'MERCADOLIBRE' | undefined = historySource === 'ALL' ? undefined : historySource;
      const res = await api.getExternalInvoicesHistory({ source, limit: historyLimit, offset: historyOffset });
      setHistoryTotal(Number(res.total || 0));
      setGlobalTotals({
        all: Number(res.totals?.all || 0),
        tn: Number(res.totals?.tn || 0),
        ml: Number(res.totals?.ml || 0),
      });
      setHistory(res.invoices || []);
    } catch (error) {
      console.error('Error loading external invoices history:', error);
      setHistoryTotal(0);
      setGlobalTotals({ all: 0, tn: 0, ml: 0 });
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    setHistoryOffset(0);
  }, [historySource, historyLimit]);

  useEffect(() => {
    fetchHistory();
  }, [historySource, historyOffset]);

  useEffect(() => {
    if (historyOffset > 0 && history.length === 0 && historyTotal > 0) {
      setHistoryOffset((prev) => Math.max(0, prev - historyLimit));
    }
  }, [history.length, historyOffset, historyTotal]);

  const historyPage = Math.floor(historyOffset / historyLimit) + 1;
  const historyPages = Math.max(1, Math.ceil(historyTotal / historyLimit));

  const stats = useMemo(() => globalTotals, [globalTotals]);

  const handleEmitNC = async (row: ExternalInvoiceRow) => {
    if (row.hasCreditNote) {
      window.alert('Esta factura ya tiene nota de crédito emitida.');
      return;
    }
    if (!window.confirm(`¿Emitir nota de crédito TOTAL para la orden #${row.orderNumber || row.externalOrderId}?`)) return;
    try {
      const nc = await api.emitirNotaCreditoExternalInvoice(row.id);
      window.alert(`Nota de crédito emitida.\nCAE: ${nc.cae}\nComprobante: ${nc.cbteTipo}-${nc.cbteDesde}`);
      fetchHistory();
    } catch (error: any) {
      window.alert(error?.message || 'No se pudo emitir la nota de crédito');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-slate-800/30 border border-slate-700/40 rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-white">Facturación masiva</h2>
            <p className="text-sm text-slate-400">Emití facturas AFIP en lote para Tienda Nube o Mercado Libre</p>
          </div>
          <div className="inline-flex p-1 bg-slate-900/60 rounded-xl border border-slate-700/50">
            <button
              type="button"
              onClick={() => setChannelTab('TN')}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${channelTab === 'TN' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}
            >
              Tienda Nube
            </button>
            <button
              type="button"
              onClick={() => setChannelTab('ML')}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${channelTab === 'ML' ? 'bg-yellow-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}
            >
              Mercado Libre
            </button>
          </div>
        </div>
      </div>

      {channelTab === 'TN' ? <TiendaNubeOrders /> : <MercadoLibreOrders />}

      <div className="bg-slate-800/30 border border-slate-700/40 rounded-2xl p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-emerald-400" />
            <h3 className="text-lg font-black text-white">Historial unificado de lotes</h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={historySource}
              onChange={(e) => setHistorySource(e.target.value as SourceFilter)}
              className="bg-slate-900/70 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200"
            >
              <option value="ALL">Todos</option>
              <option value="TIENDANUBE">Tienda Nube</option>
              <option value="MERCADOLIBRE">Mercado Libre</option>
            </select>
            <select
              value={historyLimit}
              onChange={(e) => setHistoryLimit(Number(e.target.value) || 20)}
              className="bg-slate-900/70 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200"
              title="Cantidad por página"
            >
              <option value={10}>10 por página</option>
              <option value={20}>20 por página</option>
              <option value={50}>50 por página</option>
              <option value={100}>100 por página</option>
            </select>
            <button
              type="button"
              onClick={fetchHistory}
              disabled={loadingHistory}
              className="bg-slate-800 border border-slate-700 text-slate-200 px-3 py-2 rounded-xl text-sm font-bold disabled:opacity-50 flex items-center gap-2"
            >
              {loadingHistory ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Actualizar
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="bg-slate-900/40 border border-slate-700/40 rounded-xl px-3 py-2">
            <p className="text-xs text-slate-500">Total</p>
            <p className="text-white font-black text-lg">{stats.all}</p>
          </div>
          <div className="bg-slate-900/40 border border-slate-700/40 rounded-xl px-3 py-2">
            <p className="text-xs text-slate-500">TN</p>
            <p className="text-cyan-400 font-black text-lg">{stats.tn}</p>
          </div>
          <div className="bg-slate-900/40 border border-slate-700/40 rounded-xl px-3 py-2">
            <p className="text-xs text-slate-500">ML</p>
            <p className="text-yellow-400 font-black text-lg">{stats.ml}</p>
          </div>
        </div>

        {loadingHistory ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="animate-spin text-emerald-500" />
          </div>
        ) : history.length === 0 ? (
          <div className="text-sm text-slate-400 bg-slate-900/30 border border-slate-700/30 rounded-xl p-4">
            No hay facturas externas en el historial.
          </div>
        ) : (
          <div className="overflow-auto rounded-xl border border-slate-700/40">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-slate-900/80">
                <tr>
                  <th className="text-left p-3 text-slate-500">Fecha</th>
                  <th className="text-left p-3 text-slate-500">Canal</th>
                  <th className="text-left p-3 text-slate-500">Orden</th>
                  <th className="text-left p-3 text-slate-500">Cliente</th>
                  <th className="text-right p-3 text-slate-500">Total</th>
                  <th className="text-left p-3 text-slate-500">Comprobante</th>
                  <th className="text-left p-3 text-slate-500">CAE</th>
                  <th className="text-left p-3 text-slate-500">Detalle</th>
                  <th className="text-left p-3 text-slate-500">Nota de crédito</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t border-slate-700/30">
                    <td className="p-3 text-slate-300">{h.createdAt ? new Date(h.createdAt).toLocaleString('es-AR') : '-'}</td>
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded-lg text-xs font-bold ${h.source === 'TIENDANUBE' ? 'bg-cyan-700/30 text-cyan-300' : 'bg-yellow-700/30 text-yellow-300'}`}>
                        {h.source === 'TIENDANUBE' ? 'TN' : 'ML'}
                      </span>
                    </td>
                    <td className="p-3 text-white font-semibold">#{h.orderNumber || h.externalOrderId}</td>
                    <td className="p-3 text-slate-300">{h.customerName || '-'}</td>
                    <td className="p-3 text-right text-slate-200">${Number(h.total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
                    <td className="p-3 text-slate-300">{h.cbteTipo} - {h.cbteDesde}</td>
                    <td className="p-3 text-emerald-300 font-mono">{h.cae}</td>
                    <td className="p-3">
                      <button
                        type="button"
                        onClick={() => setSelectedInvoice(h)}
                        className="px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700/70"
                      >
                        Ver
                      </button>
                    </td>
                    <td className="p-3">
                      {h.hasCreditNote ? (
                        <span className="px-2 py-1 rounded-lg text-xs font-bold bg-emerald-700/20 text-emerald-300">
                          NC emitida
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleEmitNC(h)}
                          className="px-2.5 py-1 rounded-lg text-xs font-bold bg-red-700/20 border border-red-600/30 text-red-300 hover:bg-red-700/30"
                        >
                          Nota de crédito
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {historyPages > 1 && (
          <div className="mt-2 pb-1">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="text-xs text-slate-500 px-2">
                Página {historyPage} de {historyPages}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setHistoryOffset(0)}
              disabled={historyOffset === 0}
              className="h-10 px-3 bg-slate-800/50 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-700/50 transition-colors text-slate-200 text-sm font-bold"
            >
              «
            </button>
            <button
              type="button"
              onClick={() => setHistoryOffset((v) => Math.max(0, v - historyLimit))}
              disabled={historyOffset === 0}
              className="h-10 px-3 bg-slate-800/50 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-700/50 transition-colors text-slate-200 text-sm font-bold"
            >
              <ChevronLeft size={16} className="text-white" />
            </button>
            <button
              type="button"
              onClick={() => setHistoryOffset((v) => v + historyLimit)}
              disabled={historyPage >= historyPages}
              className="h-10 px-3 bg-slate-800/50 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-700/50 transition-colors text-slate-200 text-sm font-bold"
            >
              <ChevronRight size={16} className="text-white" />
            </button>
            <button
              type="button"
              onClick={() => setHistoryOffset((historyPages - 1) * historyLimit)}
              disabled={historyPage >= historyPages}
              className="h-10 px-3 bg-slate-800/50 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-700/50 transition-colors text-slate-200 text-sm font-bold"
            >
              »
            </button>
          </div>
          </div>
        )}
      </div>

      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-black text-white">Detalle de factura externa</h4>
              <button onClick={() => setSelectedInvoice(null)} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="text-slate-400">Canal</div><div className="text-white font-semibold">{selectedInvoice.source}</div>
              <div className="text-slate-400">Orden</div><div className="text-white font-semibold">#{selectedInvoice.orderNumber || selectedInvoice.externalOrderId}</div>
              <div className="text-slate-400">Cliente</div><div className="text-white font-semibold">{selectedInvoice.customerName || '-'}</div>
              <div className="text-slate-400">Total</div><div className="text-white font-semibold">${Number(selectedInvoice.total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</div>
              <div className="text-slate-400">Comprobante</div><div className="text-white font-semibold">{selectedInvoice.cbteTipo} - {selectedInvoice.cbteDesde}</div>
              <div className="text-slate-400">CAE</div><div className="text-emerald-300 font-mono">{selectedInvoice.cae}</div>
              <div className="text-slate-400">Fecha</div><div className="text-white">{selectedInvoice.createdAt ? new Date(selectedInvoice.createdAt).toLocaleString('es-AR') : '-'}</div>
              <div className="text-slate-400">NC</div><div className="text-white">{selectedInvoice.hasCreditNote ? `Sí (${selectedInvoice.creditNote?.cbteTipo}-${selectedInvoice.creditNote?.cbteDesde || ''})` : 'No emitida'}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BulkInvoicing;
