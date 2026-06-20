import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Loader2, ChevronLeft, ChevronRight, ExternalLink, Calendar, X, Bot, Send, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../services/api';

type QStatus = '' | 'ANSWERED' | 'UNANSWERED';
type AiMode = 'off' | 'suggest' | 'auto';

interface AiSuggestion {
  text: string;
  status: string;
  provider?: string | null;
  updatedAt?: string | null;
}

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
  aiSuggestion?: AiSuggestion | null;
}

const statusLabel: Record<string, string> = {
  ANSWERED: 'Respondida',
  UNANSWERED: 'Sin responder',
  BANNED: 'Bloqueada',
  CLOSED_UNANSWERED: 'Cerrada sin resp.',
  UNDER_REVIEW: 'En revisión',
};

const modeBanner: Record<AiMode, { text: string; className: string } | null> = {
  off: null,
  suggest: {
    text: 'Modo sugerencias: la IA propone respuestas. Revisá, editá y enviá desde cada fila.',
    className: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100',
  },
  auto: {
    text: 'Modo automático: las nuevas preguntas se responden solas con IA (webhook o procesar en Configuración).',
    className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100',
  },
};

const QuestionAiPanel: React.FC<{
  question: MlQuestionRow;
  llmOk: boolean;
  llmLabel: string;
  llmConfigLoaded: boolean;
  onUpdated: () => void;
  onMetricsRefresh?: () => void;
}> = ({ question, llmOk, llmLabel, llmConfigLoaded, onUpdated, onMetricsRefresh }) => {
  const qid = String(question.id);
  const [draft, setDraft] = useState(question.aiSuggestion?.text || '');
  const [busy, setBusy] = useState<'suggest' | 'send' | 'reject' | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(question.aiSuggestion?.text || '');
  }, [question.aiSuggestion?.text, qid]);

  const hasPending = question.aiSuggestion?.status === 'pending' && !!draft.trim();
  const canSend = !!draft.trim();
  const isUnanswered = question.status === 'UNANSWERED' && !question.answerText;

  if (!isUnanswered) return null;

  const handleSuggest = async (force = false) => {
    setBusy('suggest');
    setLocalError(null);
    try {
      const res = await api.suggestMLQuestionAi(qid, force);
      const text = res.suggestion?.suggestionText || res.result.preview || '';
      setDraft(text);
      onUpdated();
    } catch (e: any) {
      setLocalError(e?.message || 'No se pudo generar sugerencia');
    } finally {
      setBusy(null);
    }
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!text) return;
    setBusy('send');
    setLocalError(null);
    try {
      await api.answerMLQuestion(qid, text);
      onUpdated();
      onMetricsRefresh?.();
    } catch (e: any) {
      setLocalError(e?.message || 'No se pudo enviar la respuesta');
    } finally {
      setBusy(null);
    }
  };

  const handleReject = async () => {
    setBusy('reject');
    setLocalError(null);
    try {
      await api.rejectMLQuestionSuggestion(qid);
      setDraft('');
      onUpdated();
      onMetricsRefresh?.();
    } catch (e: any) {
      setLocalError(e?.message || 'No se pudo descartar');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      {hasPending && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase bg-cyan-900/50 text-cyan-200 border border-cyan-700/50">
          <Bot size={12} /> Sugerencia IA
        </span>
      )}
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        className="w-full bg-slate-900/80 border border-slate-700/80 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500 outline-none resize-y min-h-[80px]"
        placeholder="Escribí tu respuesta o usá «Sugerir con IA» para un borrador…"
      />
      {localError && <p className="text-xs text-red-300">{localError}</p>}
      {!canSend && (
        <p className="text-[11px] text-slate-500">
          Escribí tu respuesta en el cuadro de arriba para habilitar <strong className="text-slate-400">Enviar a ML</strong>.
        </p>
      )}
      {llmConfigLoaded && !llmOk && (
        <p className="text-[11px] text-amber-300/90">
          <strong>Sugerir con IA</strong> requiere una clave en el servidor (<code className="text-amber-200/80">GEMINI_API_KEY</code> o <code className="text-amber-200/80">GROQ_API_KEY</code>). Podés responder igual escribiendo a mano.
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={!canSend || busy !== null}
          onClick={handleSend}
          title={canSend ? 'Publicar respuesta en Mercado Libre' : 'Escribí una respuesta primero'}
          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
            canSend
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-900/30'
              : 'bg-slate-700 text-slate-500 cursor-not-allowed'
          } disabled:opacity-60`}
        >
          {busy === 'send' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          Enviar a ML
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            if (!llmOk) {
              setLocalError('IA no disponible: configurá GEMINI_API_KEY o GROQ_API_KEY en el servidor (Railway/.env).');
              return;
            }
            handleSuggest(!!draft.trim());
          }}
          title={llmOk ? 'Generar borrador con IA' : 'Falta clave de IA en el servidor'}
          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
            llmOk
              ? 'bg-cyan-600 hover:bg-cyan-500 text-white'
              : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-200'
          } disabled:opacity-60`}
        >
          {busy === 'suggest' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {draft.trim() ? 'Regenerar con IA' : 'Sugerir con IA'}
        </button>
        {hasPending && (
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => handleSuggest(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-40"
            >
              {busy === 'suggest' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Regenerar
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={handleReject}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-800 border border-slate-600 text-slate-300 hover:text-white disabled:opacity-40"
            >
              {busy === 'reject' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Descartar sugerencia
            </button>
          </>
        )}
      </div>
    </div>
  );
};

const MercadoLibreQuestions: React.FC = () => {
  const [questions, setQuestions] = useState<MlQuestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<QStatus>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [aiMode, setAiMode] = useState<AiMode>('off');
  const [llmOk, setLlmOk] = useState(false);
  const [llmLabel, setLlmLabel] = useState('');
  const [llmConfigLoaded, setLlmConfigLoaded] = useState(false);
  const [unchangedRate, setUnchangedRate] = useState<number | null>(null);
  const [readyForAuto, setReadyForAuto] = useState(false);
  const limit = 15;

  useEffect(() => {
    api.getMLQuestionsAiConfig()
      .then((cfg) => {
        setAiMode(cfg.mode || (cfg.enabled ? 'auto' : 'off'));
        setLlmOk(!!cfg.openAiConfigured);
        setLlmLabel(cfg.llmLabel || '');
      })
      .catch(() => {
        setLlmOk(false);
        setLlmLabel('');
      })
      .finally(() => setLlmConfigLoaded(true));
    api.getMLQuestionsAiMetrics().then((m) => {
      setUnchangedRate(m.unchangedRate);
      setReadyForAuto(m.readyForAuto);
    }).catch(() => {});
  }, []);

  const refreshMetrics = useCallback(() => {
    api.getMLQuestionsAiMetrics().then((m) => {
      setUnchangedRate(m.unchangedRate);
      setReadyForAuto(m.readyForAuto);
    }).catch(() => {});
  }, []);

  const fetchQuestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const df = dateFrom.trim();
      const dt = dateTo.trim();
      const res = await api.getMercadoLibreQuestions({
        offset,
        limit,
        status: statusFilter || undefined,
        date_from: /^\d{4}-\d{2}-\d{2}$/.test(df) ? df : undefined,
        date_to: /^\d{4}-\d{2}-\d{2}$/.test(dt) ? dt : undefined,
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
  }, [offset, limit, statusFilter, dateFrom, dateTo]);

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
  const banner = modeBanner[aiMode];
  const pendingCount = questions.filter((q) => q.aiSuggestion?.status === 'pending').length;

  return (
    <div className="space-y-4">
      {llmConfigLoaded && !llmOk && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          La IA no está configurada en el servidor. Podés <strong>escribir y enviar manualmente</strong> en cada pregunta, o agregar <code className="text-amber-200">GEMINI_API_KEY</code> (gratis) en Railway/variables de entorno.
        </div>
      )}
      {llmConfigLoaded && llmOk && llmLabel && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-2 text-xs text-emerald-200">
          IA activa: {llmLabel}
        </div>
      )}

      {banner && (
        <div className={`rounded-xl border px-4 py-3 text-sm flex items-start gap-2 ${banner.className}`}>
          <Bot size={18} className="shrink-0 mt-0.5" />
          <div>
            <span>{banner.text}{pendingCount > 0 ? ` · ${pendingCount} sugerencia(s) pendiente(s) en esta página.` : ''}</span>
            {aiMode === 'suggest' && unchangedRate != null && (
              <p className="text-xs mt-1 opacity-90">
                Acierto IA: <strong>{unchangedRate}%</strong> enviadas sin editar
                {readyForAuto ? ' · Podés pasar a modo automático en Configuración' : ''}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-400">
          Datos en vivo desde Mercado Libre. Orden: <strong className="text-slate-300">más recientes primero</strong>.
        </p>
        <div className="flex flex-col lg:flex-row lg:flex-wrap items-stretch lg:items-end gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500 uppercase font-semibold flex items-center gap-1">
              <Calendar size={14} /> Fecha pregunta
            </span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setOffset(0);
              }}
              className="bg-slate-900/70 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200"
            />
            <span className="text-slate-500 text-sm">a</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setOffset(0);
              }}
              className="bg-slate-900/70 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200"
            />
            {(dateFrom || dateTo) && (
              <button
                type="button"
                onClick={() => {
                  setDateFrom('');
                  setDateTo('');
                  setOffset(0);
                }}
                className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm text-slate-400 hover:text-white border border-slate-600 hover:bg-slate-800"
              >
                <X size={16} /> Limpiar fechas
              </button>
            )}
          </div>
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
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
                  <th className="p-3 font-semibold min-w-[260px]">Tu respuesta</th>
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
                        <QuestionAiPanel
                          question={q}
                          llmOk={llmOk}
                          llmLabel={llmLabel}
                          llmConfigLoaded={llmConfigLoaded}
                          onUpdated={fetchQuestions}
                          onMetricsRefresh={refreshMetrics}
                        />
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
