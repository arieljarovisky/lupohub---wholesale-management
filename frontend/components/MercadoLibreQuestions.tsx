import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Loader2, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { api } from '../services/api';

type QStatus = '' | 'ANSWERED' | 'UNANSWERED';

interface MlQuestionRow {
  id: string | number;
  text: string;
  status: string;
  itemId: string | null;
  itemTitle: string | null;
  dateCreated: string | null;
  buyerNickname: string | null;
  answerText: string | null;
  answerDate: string | null;
}

const statusLabel: Record<string, string> = {
  ANSWERED: 'Respondida',
  UNANSWERED: 'Sin responder',
  BANNED: 'Bloqueada',
  CLOSED_UNANSWERED: 'Cerrada sin resp.',
  UNDER_REVIEW: 'En revisión',
};

const MercadoLibreQuestions: React.FC = () => {
  const [questions, setQuestions] = useState<MlQuestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<QStatus>('');
  const limit = 15;

  const fetchQuestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getMercadoLibreQuestions({
        offset,
        limit,
        status: statusFilter || undefined,
      });
      setQuestions(res.questions || []);
      setTotal(res.total ?? 0);
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar las preguntas');
      setQuestions([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [offset, limit, statusFilter]);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  const formatDt = (iso: string | null) => {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleString('es-AR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  const itemUrl = (itemId: string) =>
    `https://www.mercadolibre.com.ar/p/${encodeURIComponent(itemId)}`;

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          Datos en vivo desde Mercado Libre: pregunta del comprador y tu respuesta (si existe).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as QStatus);
              setOffset(0);
            }}
            className="bg-slate-900/70 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-200 min-w-[180px]"
          >
            <option value="">Todas</option>
            <option value="ANSWERED">Respondidas</option>
            <option value="UNANSWERED">Sin responder</option>
          </select>
          <button
            type="button"
            onClick={() => fetchQuestions()}
            disabled={loading}
            className="bg-gradient-to-r from-yellow-600 to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-white px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 disabled:opacity-50"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
            Actualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading && questions.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-slate-500 gap-2">
          <Loader2 className="animate-spin" size={22} />
          Cargando preguntas…
        </div>
      ) : questions.length === 0 ? (
        <div className="rounded-2xl border border-slate-700/80 bg-slate-800/40 p-10 text-center text-slate-500">
          No hay preguntas para mostrar con este filtro.
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-700/80 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left min-w-[640px]">
              <thead>
                <tr className="bg-slate-800/90 border-b border-slate-700 text-slate-400 text-xs uppercase tracking-wide">
                  <th className="p-3 font-semibold">Fecha</th>
                  <th className="p-3 font-semibold">Estado</th>
                  <th className="p-3 font-semibold">Publicación</th>
                  <th className="p-3 font-semibold">Comprador</th>
                  <th className="p-3 font-semibold min-w-[200px]">Pregunta</th>
                  <th className="p-3 font-semibold min-w-[200px]">Tu respuesta</th>
                </tr>
              </thead>
              <tbody>
                {questions.map((q) => (
                  <tr key={String(q.id)} className="border-b border-slate-700/50 hover:bg-slate-800/40 align-top">
                    <td className="p-3 text-slate-300 whitespace-nowrap">{formatDt(q.dateCreated)}</td>
                    <td className="p-3">
                      <span className="inline-block px-2 py-0.5 rounded-lg text-xs font-medium bg-slate-700/80 text-slate-200">
                        {statusLabel[q.status] || q.status || '—'}
                      </span>
                    </td>
                    <td className="p-3">
                      {q.itemId ? (
                        <a
                          href={itemUrl(q.itemId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-amber-300/95 hover:text-amber-200 flex items-start gap-1.5 max-w-[220px]"
                        >
                          <span className="line-clamp-2">{q.itemTitle || q.itemId}</span>
                          <ExternalLink size={14} className="shrink-0 mt-0.5 opacity-70" />
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="p-3 text-slate-300">{q.buyerNickname || '—'}</td>
                    <td className="p-3 text-slate-200 whitespace-pre-wrap">{q.text || '—'}</td>
                    <td className="p-3">
                      {q.answerText ? (
                        <div>
                          <p className="text-emerald-200/95 whitespace-pre-wrap">{q.answerText}</p>
                          {q.answerDate && (
                            <p className="text-xs text-slate-500 mt-1">Resp.: {formatDt(q.answerDate)}</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {total > limit && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
          <p className="text-xs text-slate-500">
            Mostrando {questions.length} de {total} · Página {currentPage} / {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={offset === 0 || loading}
              onClick={() => setOffset((o) => Math.max(0, o - limit))}
              className="p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 disabled:opacity-40"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              type="button"
              disabled={offset + limit >= total || loading}
              onClick={() => setOffset((o) => o + limit)}
              className="p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 disabled:opacity-40"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MercadoLibreQuestions;
