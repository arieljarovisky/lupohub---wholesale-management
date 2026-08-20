import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Star,
  Download,
  Search,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { api } from '../services/api';

type ReviewRow = {
  id: string | number;
  title: string;
  content: string;
  rate: number | null;
  status: string;
  dateCreated: string | null;
  buyingDate: string | null;
  likes: number;
  dislikes: number;
  attributes: Array<{ id?: string; name?: string; value_id?: string; value_name?: string }>;
};

type ItemReviews = {
  itemId: string;
  title: string;
  permalink: string | null;
  status: string | null;
  thumbnail: string | null;
  ratingAverage: number | null;
  reviewsCount: number;
  ratingLevels: {
    oneStar: number;
    twoStar: number;
    threeStar: number;
    fourStar: number;
    fiveStar: number;
  };
  reviews: ReviewRow[];
};

const Stars: React.FC<{ value: number | null; size?: number }> = ({ value, size = 14 }) => {
  const n = value == null || !Number.isFinite(value) ? 0 : Math.round(value);
  return (
    <span className="inline-flex items-center gap-0.5" title={value != null ? `${value} / 5` : 'Sin calificación'}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          className={i <= n ? 'fill-amber-400 text-amber-400' : 'text-slate-600'}
        />
      ))}
    </span>
  );
};

const formatDt = (iso: string | null) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
};

const MercadoLibreReviews: React.FC = () => {
  const [items, setItems] = useState<ItemReviews[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [minRate, setMinRate] = useState<number | ''>('');
  const [includeClosed, setIncludeClosed] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<{
    publicationsWithReviews: number;
    reviewsReturned: number;
    ratingAverageGlobal: number | null;
  } | null>(null);
  const limit = 15;
  const forceRefreshRef = React.useRef(true);

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const refresh = forceRefreshRef.current;
      forceRefreshRef.current = false;
      const res = await api.getMercadoLibreReviews({
        offset,
        limit,
        q: q || undefined,
        min_rate: minRate === '' ? undefined : minRate,
        include_closed: includeClosed || undefined,
        only_with_reviews: true,
        refresh,
      });
      setItems(res.items || []);
      setTotal(res.total ?? 0);
      setSummary(res.summary || null);
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar las reseñas');
      setItems([]);
      setTotal(0);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [offset, limit, q, minRate, includeClosed]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  const applySearch = () => {
    setOffset(0);
    setQ(searchInput.trim());
  };

  const toggleExpand = (itemId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      await api.exportMercadoLibreReviews({
        include_closed: includeClosed || undefined,
        only_with_reviews: true,
      });
    } catch (e: any) {
      setError(e?.message || 'No se pudo exportar el Excel');
    } finally {
      setExporting(false);
    }
  };

  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">Opiniones de publicaciones</h2>
          <p className="text-sm text-slate-400">
            Reseñas de compradores vía API de Mercado Libre. La primera carga puede demorar si tenés muchas publicaciones.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              forceRefreshRef.current = true;
              fetchReviews();
            }}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-slate-800 border border-slate-600 text-slate-200 hover:bg-slate-700 disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Actualizar
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50"
          >
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            Exportar Excel
          </button>
        </div>
      </div>

      {summary && !loading && (
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-300">
            Publicaciones con opiniones: <strong className="text-white">{summary.publicationsWithReviews}</strong>
          </span>
          <span className="px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-300">
            Opiniones listadas: <strong className="text-white">{summary.reviewsReturned}</strong>
          </span>
          {summary.ratingAverageGlobal != null && (
            <span className="px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-300 inline-flex items-center gap-2">
              Promedio global: <strong className="text-amber-300">{summary.ratingAverageGlobal}</strong>
              <Stars value={summary.ratingAverageGlobal} />
            </span>
          )}
        </div>
      )}

      <div className="flex flex-col md:flex-row flex-wrap gap-2 items-stretch md:items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applySearch()}
            placeholder="Buscar por título, ID o texto de opinión…"
            className="w-full pl-9 pr-9 py-2 rounded-xl bg-slate-900 border border-slate-700 text-sm text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-amber-500/50 outline-none"
          />
          {searchInput && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              onClick={() => {
                setSearchInput('');
                setQ('');
                setOffset(0);
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={applySearch}
          className="px-3 py-2 rounded-xl text-sm font-bold bg-slate-700 text-white hover:bg-slate-600"
        >
          Buscar
        </button>
        <select
          value={minRate === '' ? '' : String(minRate)}
          onChange={(e) => {
            setOffset(0);
            setMinRate(e.target.value === '' ? '' : Number(e.target.value));
          }}
          className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-sm text-slate-200"
        >
          <option value="">Promedio mínimo</option>
          <option value="4">4★ o más</option>
          <option value="3">3★ o más</option>
          <option value="2">2★ o más</option>
          <option value="1">1★ o más</option>
        </select>
        <label className="inline-flex items-center gap-2 text-sm text-slate-400 px-2 cursor-pointer">
          <input
            type="checkbox"
            checked={includeClosed}
            onChange={(e) => {
              setOffset(0);
              setIncludeClosed(e.target.checked);
            }}
            className="rounded border-slate-600"
          />
          Incluir cerradas
        </label>
      </div>

      {error && (
        <div className="rounded-xl border border-red-700/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
          <Loader2 className="animate-spin text-amber-400" size={32} />
          <p className="text-sm">Consultando opiniones en Mercado Libre…</p>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-700 bg-slate-900/50 px-4 py-12 text-center text-slate-400">
          No hay publicaciones con opiniones para los filtros actuales.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const open = expanded.has(item.itemId);
            return (
              <div
                key={item.itemId}
                className="rounded-xl border border-slate-700/80 bg-slate-900/60 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggleExpand(item.itemId)}
                  className="w-full flex items-start gap-3 p-3 text-left hover:bg-slate-800/40 transition-colors"
                >
                  {item.thumbnail ? (
                    <img
                      src={item.thumbnail}
                      alt=""
                      className="w-12 h-12 rounded-lg object-cover bg-slate-800 shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-slate-800 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-mono text-slate-500">{item.itemId}</span>
                      {item.status && (
                        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                          {item.status}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-slate-100 truncate">{item.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                      <span className="inline-flex items-center gap-1.5">
                        <Stars value={item.ratingAverage} />
                        <span className="text-amber-300 font-bold">
                          {item.ratingAverage != null ? item.ratingAverage.toFixed(1) : '—'}
                        </span>
                      </span>
                      <span>{item.reviewsCount} opinión(es)</span>
                      <span className="text-slate-500">
                        ★{item.ratingLevels.fiveStar}/{item.ratingLevels.fourStar}/
                        {item.ratingLevels.threeStar}/{item.ratingLevels.twoStar}/
                        {item.ratingLevels.oneStar}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {item.permalink && (
                      <a
                        href={item.permalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-amber-300 hover:bg-slate-800"
                        title="Abrir en Mercado Libre"
                      >
                        <ExternalLink size={16} />
                      </a>
                    )}
                    {open ? <ChevronUp size={18} className="text-slate-500" /> : <ChevronDown size={18} className="text-slate-500" />}
                  </div>
                </button>

                {open && (
                  <div className="border-t border-slate-700/60 px-3 pb-3 space-y-2">
                    {item.reviews.length === 0 ? (
                      <p className="text-sm text-slate-500 py-3">
                        Hay promedio registrado, pero la API no devolvió el detalle de opiniones.
                      </p>
                    ) : (
                      item.reviews.map((r) => (
                        <div
                          key={String(r.id)}
                          className="mt-2 rounded-lg bg-slate-950/50 border border-slate-800 p-3"
                        >
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <Stars value={r.rate} size={12} />
                            {r.title && <span className="text-sm font-semibold text-slate-200">{r.title}</span>}
                            <span className="text-[11px] text-slate-500 ml-auto">{formatDt(r.dateCreated)}</span>
                          </div>
                          {r.content && <p className="text-sm text-slate-300 whitespace-pre-wrap">{r.content}</p>}
                          {r.attributes.length > 0 && (
                            <p className="mt-1 text-[11px] text-slate-500">
                              {r.attributes
                                .map((a) => [a.name || a.id, a.value_name || a.value_id].filter(Boolean).join(': '))
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          )}
                          <p className="mt-1 text-[11px] text-slate-600">
                            Compra: {formatDt(r.buyingDate)}
                            {r.likes || r.dislikes
                              ? ` · Útil: ${r.likes} / No útil: ${r.dislikes}`
                              : ''}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && total > 0 && (
        <div className="flex items-center justify-between gap-2 pt-2">
          <p className="text-xs text-slate-500">
            Página {page} de {pages} · {total} publicación(es)
          </p>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={offset <= 0}
              onClick={() => setOffset((o) => Math.max(0, o - limit))}
              className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 disabled:opacity-40"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              disabled={offset + limit >= total}
              onClick={() => setOffset((o) => o + limit)}
              className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 disabled:opacity-40"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MercadoLibreReviews;
