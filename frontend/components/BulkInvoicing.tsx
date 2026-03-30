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
}

const BulkInvoicing: React.FC = () => {
  const [channelTab, setChannelTab] = useState<ChannelTab>('TN');
  const [historySource, setHistorySource] = useState<SourceFilter>('ALL');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [history, setHistory] = useState<ExternalInvoiceRow[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyOffset, setHistoryOffset] = useState(0);
  const historyLimit = 20;

  const fetchHistory = async () => {
    setLoadingHistory(true);
    try {
      const source: 'TIENDANUBE' | 'MERCADOLIBRE' | undefined = historySource === 'ALL' ? undefined : historySource;
      const res = await api.getExternalInvoicesHistory({ source, limit: historyLimit, offset: historyOffset });
      setHistoryTotal(Number(res.total || 0));
      setHistory(res.invoices || []);
    } catch (error) {
      console.error('Error loading external invoices history:', error);
      setHistoryTotal(0);
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    setHistoryOffset(0);
  }, [historySource]);

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

  const stats = useMemo(() => {
    const total = history.length;
    const tn = history.filter(h => h.source === 'TIENDANUBE').length;
    const ml = history.filter(h => h.source === 'MERCADOLIBRE').length;
    return { total, tn, ml };
  }, [history]);

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
            <p className="text-white font-black text-lg">{historyTotal}</p>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {historyPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setHistoryOffset(0)}
              disabled={historyOffset === 0}
              className="p-2 bg-slate-800/50 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-700/50 transition-colors"
            >
              <ChevronLeft size={16} className="text-white" />
              <ChevronLeft size={16} className="text-white -ml-2" />
            </button>
            <button
              type="button"
              onClick={() => setHistoryOffset((v) => Math.max(0, v - historyLimit))}
              disabled={historyOffset === 0}
              className="p-2 bg-slate-800/50 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-700/50 transition-colors"
            >
              <ChevronLeft size={16} className="text-white" />
            </button>
            <span className="px-3 text-sm text-slate-300">
              Página {historyPage} de {historyPages}
            </span>
            <button
              type="button"
              onClick={() => setHistoryOffset((v) => v + historyLimit)}
              disabled={historyPage >= historyPages}
              className="p-2 bg-slate-800/50 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-700/50 transition-colors"
            >
              <ChevronRight size={16} className="text-white" />
            </button>
            <button
              type="button"
              onClick={() => setHistoryOffset((historyPages - 1) * historyLimit)}
              disabled={historyPage >= historyPages}
              className="p-2 bg-slate-800/50 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-700/50 transition-colors"
            >
              <ChevronRight size={16} className="text-white" />
              <ChevronRight size={16} className="text-white -ml-2" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default BulkInvoicing;
