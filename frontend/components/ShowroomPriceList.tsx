import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, RefreshCw, Loader2, AlertCircle, ExternalLink, Package, Tag } from 'lucide-react';
import { api, ShowroomPriceItem, ShowroomPriceList } from '../services/api';

const PAGE_SIZE = 80;

function formatMoney(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const whole = Math.abs(value - Math.round(value)) < 0.001;
  return value.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
}

function normalizeCode(value: string): string {
  return value.toLowerCase().replace(/[\s-]/g, '');
}

function matchesQuery(item: ShowroomPriceItem, query: string): boolean {
  const q = normalizeCode(query);
  if (!q) return true;
  const haystack = [item.articleCode, item.barcode || '', item.name, item.brand || '']
    .map(normalizeCode)
    .join(' ');
  return haystack.includes(q);
}

function highlight(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-400/25 text-amber-100 rounded px-0.5">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

function stockLabel(stock: number | null): string | null {
  if (stock == null) return null;
  if (stock <= 0) return 'Sin stock';
  return `Stock ${stock}`;
}

const PricePair: React.FC<{ item: ShowroomPriceItem }> = ({ item }) => (
  <div className="grid grid-cols-2 gap-2 min-w-[220px]">
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/80">Transferencia</p>
      <p className="text-lg font-black tabular-nums text-emerald-300 leading-tight">{formatMoney(item.priceTransfer)}</p>
    </div>
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-sky-300/80">Tarjeta</p>
      <p className="text-lg font-black tabular-nums text-sky-300 leading-tight">{formatMoney(item.priceCard)}</p>
    </div>
  </div>
);

const ProductCell: React.FC<{ item: ShowroomPriceItem; query: string }> = ({ item, query }) => (
  <div className="flex items-center gap-3 min-w-0">
    <div className="w-12 h-12 shrink-0 rounded-lg bg-slate-800 border border-slate-700 overflow-hidden flex items-center justify-center">
      {item.image ? (
        <img src={item.image} alt="" className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <Package size={18} className="text-slate-500" aria-hidden />
      )}
    </div>
    <div className="min-w-0">
      <p className="font-mono text-sm font-bold text-white tracking-wide">
        {item.articleCode ? highlight(item.articleCode, query) : 'Sin código'}
      </p>
      <p className="text-sm text-slate-200 truncate">{highlight(item.name, query)}</p>
      <p className="text-xs text-slate-500 truncate">
        {item.brand ? <span>{highlight(item.brand, query)}</span> : null}
        {item.brand && item.barcode ? ' · ' : null}
        {item.barcode ? <span>EAN {highlight(item.barcode, query)}</span> : null}
        {(item.brand || item.barcode) && stockLabel(item.stock) ? ' · ' : null}
        {stockLabel(item.stock) ? (
          <span className={item.stock === 0 ? 'text-amber-400' : undefined}>{stockLabel(item.stock)}</span>
        ) : null}
      </p>
      {item.compareAtPrice != null && (
        <p className="text-xs text-slate-500 line-through tabular-nums">Antes {formatMoney(item.compareAtPrice)}</p>
      )}
    </div>
  </div>
);

const ShowroomPriceListView: React.FC = () => {
  const [data, setData] = useState<ShowroomPriceList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError('');
    try {
      const list = await api.getShowroomPriceList(refresh);
      setData(list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la lista de precios');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [query]);

  const filtered = useMemo(() => {
    const items = data?.items || [];
    const q = query.trim();
    if (!q) return items;
    return items.filter((item) => matchesQuery(item, q));
  }, [data, query]);

  const shown = filtered.slice(0, query.trim() ? filtered.length : visibleCount);
  const hidden = filtered.length - shown.length;

  const discountNote = useMemo(() => {
    if (!data) return '';
    const transfer = data.transferDiscountPercent;
    const card = data.cardDiscountPercent;
    if (transfer > 0 || card > 0) {
      return `Descuento de Pago Nube aplicado sobre el precio publicado: transferencia ${transfer}% y tarjeta ${card}%. La tarjeta es en 1 pago, sin el interés de las cuotas.`;
    }
    return 'Sin descuento extra por medio de pago: transferencia y tarjeta en 1 pago coinciden con el precio publicado en la tienda.';
  }, [data]);

  const updatedLabel = data?.generatedAt
    ? new Date(data.generatedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className="space-y-4 max-w-[1400px] mx-auto pb-8">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-white flex items-center gap-2">
            <Tag className="text-emerald-400" size={26} aria-hidden />
            Lista de precios del showroom
          </h2>
          <p className="text-slate-400 text-sm mt-1 max-w-2xl">{discountNote || 'Precios publicados en Tienda Nube.'}</p>
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm font-semibold border border-slate-700 disabled:opacity-60"
        >
          {loading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <RefreshCw size={16} aria-hidden />}
          Actualizar precios
        </button>
      </div>

      <div className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-slate-950/95 backdrop-blur">
        <label htmlFor="showroom-code" className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
          Código de artículo
        </label>
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden />
          <input
            id="showroom-code"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por código, EAN o nombre"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className="w-full h-12 pl-10 pr-4 rounded-xl bg-slate-900 border border-slate-700 text-base text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
          />
        </div>
        <p className="mt-2 text-sm text-slate-400" aria-live="polite">
          {loading && !data
            ? 'Buscando precios en Tienda Nube…'
            : `${filtered.length.toLocaleString('es-AR')} de ${(data?.productCount || 0).toLocaleString('es-AR')} publicaciones${updatedLabel ? ` · actualizado ${updatedLabel}` : ''}`}
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200" role="alert">
          <AlertCircle size={18} className="shrink-0 mt-0.5" aria-hidden />
          <div>
            <p>{error}</p>
            <button type="button" onClick={() => load(true)} className="mt-2 underline font-semibold min-h-11">
              Reintentar
            </button>
          </div>
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center gap-3 py-20 text-slate-300">
          <Loader2 size={28} className="animate-spin text-emerald-400" aria-hidden />
          <p>Trayendo el catálogo de Tienda Nube. La primera vez puede tardar un momento.</p>
        </div>
      )}

      {data && filtered.length === 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-6 py-12 text-center">
          <p className="text-white font-semibold">Ningún producto coincide con ese código.</p>
          <p className="text-slate-400 text-sm mt-1">Probá con el código de artículo, el EAN o parte del nombre.</p>
        </div>
      )}

      {shown.length > 0 && (
        <>
          <ul className="md:hidden space-y-2">
            {shown.map((item) => (
              <li key={item.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                <ProductCell item={item} query={query} />
                <div className="mt-3 flex items-end justify-between gap-3">
                  <PricePair item={item} />
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center w-11 h-11 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800"
                      aria-label={`Ver ${item.name} en la tienda`}
                    >
                      <ExternalLink size={18} aria-hidden />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden md:block overflow-x-auto rounded-2xl border border-slate-800">
            <table className="w-full text-left border-collapse">
              <caption className="sr-only">Precios de Tienda Nube para el showroom</caption>
              <thead className="bg-slate-900">
                <tr className="text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">
                  <th scope="col" className="px-4 py-3 font-bold">Artículo</th>
                  <th scope="col" className="px-4 py-3 font-bold text-emerald-300/90">Transferencia</th>
                  <th scope="col" className="px-4 py-3 font-bold text-sky-300/90">Tarjeta · 1 pago</th>
                  <th scope="col" className="px-3 py-3 font-bold w-14">
                    <span className="sr-only">Tienda</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => (
                  <tr key={item.id} className="border-b border-slate-800/80 hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <ProductCell item={item} query={query} />
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="text-xl font-black tabular-nums text-emerald-300">{formatMoney(item.priceTransfer)}</span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="text-xl font-black tabular-nums text-sky-300">{formatMoney(item.priceCard)}</span>
                    </td>
                    <td className="px-2 py-3 align-middle">
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-center w-11 h-11 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800"
                          aria-label={`Ver ${item.name} en la tienda`}
                        >
                          <ExternalLink size={18} aria-hidden />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
              className="w-full min-h-11 rounded-xl border border-slate-700 bg-slate-900 text-slate-200 font-semibold hover:bg-slate-800"
            >
              Ver {Math.min(PAGE_SIZE, hidden)} más
            </button>
          )}
        </>
      )}
    </div>
  );
};

export default ShowroomPriceListView;
