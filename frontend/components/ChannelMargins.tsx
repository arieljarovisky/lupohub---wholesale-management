import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search,
  RefreshCw,
  Loader2,
  Zap,
  Cloud,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Info,
  Pencil,
} from 'lucide-react';
import { api } from '../services/api';
import { useNotification } from '../context/NotificationContext';
import { ChannelPricesModal } from './ChannelPricesModal';
import type { Product } from '../types';

type ArticleRow = Awaited<ReturnType<typeof api.getChannelMargins>>['rows'][number];

const fmt = (n: number | null | undefined) =>
  n != null && Number.isFinite(n)
    ? n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
    : '—';

const fmtPct = (n: number | null | undefined) =>
  n != null && Number.isFinite(n) ? `${n.toFixed(1)}%` : '—';

const marginClass = (m: number | null | undefined) => {
  if (m == null || !Number.isFinite(m)) return 'text-slate-500';
  if (m < 0) return 'text-red-400 font-semibold';
  if (m > 0) return 'text-emerald-400 font-semibold';
  return 'text-slate-300';
};

const ChannelMargins: React.FC = () => {
  const { showToast } = useNotification();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [channel, setChannel] = useState<'all' | 'ml' | 'tn'>('all');
  const [tnFeePreset, setTnFeePreset] = useState('tn_mp_instant');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getChannelMargins>> | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [pricesModalOpen, setPricesModalOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getChannelMargins({
        search: searchDebounced || undefined,
        page,
        limit: 100,
        channel,
        tnFeePreset,
      });
      setData(res);
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : 'No se pudieron cargar los márgenes');
    } finally {
      setLoading(false);
    }
  }, [searchDebounced, page, channel, tnFeePreset, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [searchDebounced, channel, tnFeePreset]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  const rowsByProductId = useMemo(() => {
    const m = new Map<string, ArticleRow>();
    for (const r of data?.rows || []) m.set(r.productId, r);
    return m;
  }, [data?.rows]);

  const selectedVariantCount = useMemo(() => {
    let n = 0;
    for (const pid of selectedProductIds) {
      n += rowsByProductId.get(pid)?.variantIds.length ?? 0;
    }
    return n;
  }, [selectedProductIds, rowsByProductId]);

  const selectedVariants: Product[] = useMemo(() => {
    const out: Product[] = [];
    for (const pid of selectedProductIds) {
      const row = rowsByProductId.get(pid);
      if (!row) continue;
      for (const variantId of row.variantIds) {
        out.push({
          id: variantId,
          sku: row.baseSku,
          name: row.productName,
          category: '',
          price: 0,
          description: '',
          stock: 0,
          integrations: {
            local: true,
            mercadoLibre: !!row.ml?.linked,
            tiendaNube: !!row.tn?.linked,
          },
        } as Product);
      }
    }
    return out;
  }, [selectedProductIds, rowsByProductId]);

  const isProductSelected = (productId: string) => selectedProductIds.includes(productId);

  const toggleProduct = (productId: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]
    );
  };

  const toggleSelectAll = () => {
    if (!data?.rows.length) return;
    const ids = data.rows.map((r) => r.productId);
    const allSelected = ids.every((id) => selectedProductIds.includes(id));
    setSelectedProductIds(allSelected ? [] : ids);
  };

  const config = data?.config;

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto pb-8">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-white flex items-center gap-2">
            <TrendingUp className="text-emerald-400" size={28} />
            Márgenes por canal
          </h2>
          <p className="text-slate-400 text-sm mt-1 max-w-2xl">
            Una fila por artículo: todas las variantes comparten el mismo precio en ML y TN. Ganancia estimada:
            precio − comisiones − FOB.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-sm font-bold disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Actualizar
          </button>
          {selectedProductIds.length > 0 && (
            <button
              type="button"
              onClick={() => setPricesModalOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold"
            >
              <Pencil size={16} />
              Editar precios ({selectedProductIds.length} artículo
              {selectedProductIds.length !== 1 ? 's' : ''}
              {selectedVariantCount > 0 ? ` · ${selectedVariantCount} variantes` : ''})
            </button>
          )}
        </div>
      </div>

      {config && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-slate-800/80 border border-slate-700 text-sm text-slate-300">
          <Info size={18} className="text-blue-400 shrink-0 mt-0.5" />
          <div>
            <p>
              <strong className="text-white">FOB:</strong>{' '}
              {config.fobListName
                ? `lista «${config.fobListName}»`
                : 'sin lista FOB (creá una lista con "fob" en el nombre o definí LUPOHUB_FOB_PRICE_LIST_ID)'}
            </p>
            <p className="mt-1">
              <strong className="text-amber-300">Mercado Libre:</strong> {config.mlListingFeeSource} + CPT cobro{' '}
              {config.mlPaymentCptPercent}% ({config.mlPaymentCptSource})
            </p>
            <p className="mt-1">
              <strong className="text-cyan-300">Tienda Nube:</strong> {config.tnFeePresetLabel} (tasas con IVA{' '}
              {config.ivaPercent}%)
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
          <input
            type="search"
            placeholder="Buscar por SKU o artículo…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-800 border border-slate-600 text-white text-sm"
          />
        </div>
        <select
          value={channel}
          onChange={(e) => setChannel(e.target.value as 'all' | 'ml' | 'tn')}
          className="rounded-xl bg-slate-800 border border-slate-600 text-white text-sm px-4 py-2.5 min-w-[140px]"
        >
          <option value="all">Todos los canales</option>
          <option value="ml">Solo Mercado Libre</option>
          <option value="tn">Solo Tienda Nube</option>
        </select>
        <select
          value={tnFeePreset}
          onChange={(e) => setTnFeePreset(e.target.value)}
          className="rounded-xl bg-slate-800 border border-cyan-700/50 text-white text-sm px-4 py-2.5 min-w-[220px] max-w-full"
          title="Medio de cobro en Tienda Nube"
        >
          {(config?.tnFeePresets?.length
            ? config.tnFeePresets
            : [{ id: 'tn_mp_instant', label: 'Mercado Pago en TN · al momento' }]
          ).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="custom">Personalizado (.env)</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-700 bg-slate-900/50">
        <table className="w-full text-sm min-w-[1100px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-700 bg-slate-800/80">
              <th className="p-3 w-10">
                <input
                  type="checkbox"
                  checked={
                    !!data?.rows.length &&
                    data.rows.every((r) => selectedProductIds.includes(r.productId))
                  }
                  onChange={toggleSelectAll}
                  title="Seleccionar página"
                />
              </th>
              <th className="p-3">Artículo</th>
              <th className="p-3">FOB</th>
              <th className="p-3 text-amber-300">
                <span className="inline-flex items-center gap-1">
                  <Zap size={12} /> Mercado Libre
                </span>
              </th>
              <th className="p-3 text-cyan-300">
                <span className="inline-flex items-center gap-1">
                  <Cloud size={12} /> Tienda Nube
                </span>
              </th>
            </tr>
            <tr className="text-[9px] uppercase text-slate-600 border-b border-slate-700/80">
              <th />
              <th />
              <th className="pb-2 px-3 font-normal">Costo</th>
              <th className="pb-2 px-1 font-normal">Precio · Comisión · Ganancia</th>
              <th className="pb-2 px-1 font-normal">Precio · Comisión · Ganancia</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data?.rows.length ? (
              <tr>
                <td colSpan={5} className="p-12 text-center text-slate-400">
                  <Loader2 className="animate-spin inline mr-2 text-emerald-400" size={24} />
                  Calculando márgenes (consultando ML/TN)…
                </td>
              </tr>
            ) : !data?.rows.length ? (
              <tr>
                <td colSpan={5} className="p-12 text-center text-slate-400">
                  No hay artículos vinculados a canales con estos filtros.
                </td>
              </tr>
            ) : (
              data.rows.map((r) => (
                <MarginTableRow
                  key={r.productId}
                  row={r}
                  selected={isProductSelected(r.productId)}
                  onToggle={() => toggleProduct(r.productId)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {data && data.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
          <span>
            {data.total} artículo{data.total !== 1 ? 's' : ''} · página {data.page} de {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 rounded-lg bg-slate-700 text-white disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 rounded-lg bg-slate-700 text-white disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}

      <ChannelPricesModal
        open={pricesModalOpen}
        onClose={() => setPricesModalOpen(false)}
        variants={selectedVariants}
        showToast={showToast}
        onSaved={() => {
          setPricesModalOpen(false);
          setSelectedProductIds([]);
          load();
        }}
      />
    </div>
  );
};

const MarginTableRow: React.FC<{
  row: ArticleRow;
  selected: boolean;
  onToggle: () => void;
}> = ({ row, selected, onToggle }) => (
  <tr className="border-b border-slate-800/80 hover:bg-slate-800/40">
    <td className="p-3 align-top">
      <input type="checkbox" checked={selected} onChange={onToggle} />
    </td>
    <td className="p-3 align-top">
      {row.baseSku ? <div className="font-mono text-xs text-blue-400">{row.baseSku}</div> : null}
      <div className="text-white font-medium">{row.productName}</div>
      <div className="text-slate-500 text-xs">
        {row.variantCount} variante{row.variantCount !== 1 ? 's' : ''} · mismo precio en canal
      </div>
    </td>
    <td className="p-3 align-top text-slate-300">{fmt(row.fob)}</td>
    <td className="p-3 align-top">
      {row.ml ? <ChannelCells slice={row.ml} accent="amber" /> : <span className="text-slate-600 text-xs">—</span>}
    </td>
    <td className="p-3 align-top">
      {row.tn ? <ChannelCells slice={row.tn} accent="cyan" /> : <span className="text-slate-600 text-xs">—</span>}
    </td>
  </tr>
);

const ChannelCells: React.FC<{
  slice: NonNullable<ArticleRow['ml']>;
  accent: 'amber' | 'cyan';
}> = ({ slice, accent }) => {
  const border = accent === 'amber' ? 'border-amber-900/40' : 'border-cyan-900/40';
  if (!slice.linked) return <span className="text-slate-600 text-xs">Sin vínculo</span>;
  if (slice.price <= 0) return <span className="text-slate-500 text-xs">Sin precio</span>;
  return (
    <div className={`space-y-1 text-xs rounded-lg border ${border} p-2 bg-slate-900/50`}>
      <div className="flex justify-between gap-2">
        <span className="text-slate-500">Precio</span>
        <span className="text-white">{fmt(slice.price)}</span>
      </div>
      <div className="flex justify-between gap-2">
        <span className="text-slate-500">Comisión</span>
        <span className="text-slate-300">−{fmt(slice.fee)}</span>
      </div>
      {slice.feeListing != null && (
        <div className="flex justify-between gap-2 text-[10px] text-slate-500 pl-1">
          <span>Venta ML</span>
          <span>−{fmt(slice.feeListing)}</span>
        </div>
      )}
      {slice.feePayment != null && slice.feePayment > 0 && (
        <div className="flex justify-between gap-2 text-[10px] text-slate-500 pl-1">
          <span>CPT cobro</span>
          <span>−{fmt(slice.feePayment)}</span>
        </div>
      )}
      {slice.feeRate != null && (
        <div className="flex justify-between gap-2 text-[10px] text-slate-500 pl-1">
          <span>Tasas (+ IVA)</span>
          <span>−{fmt(slice.feeRate)}</span>
        </div>
      )}
      {slice.feeCpt != null && slice.feeCpt > 0 && (
        <div className="flex justify-between gap-2 text-[10px] text-slate-500 pl-1">
          <span>CPT</span>
          <span>−{fmt(slice.feeCpt)}</span>
        </div>
      )}
      <div className="flex justify-between gap-2 border-t border-slate-700/50 pt-1">
        <span className="text-slate-400 flex items-center gap-1">
          {slice.margin != null && slice.margin >= 0 ? (
            <TrendingUp size={12} className="text-emerald-500" />
          ) : (
            <TrendingDown size={12} className="text-red-500" />
          )}
          Ganancia
        </span>
        <span className={marginClass(slice.margin)}>
          {fmt(slice.margin)}
          {slice.marginPercent != null ? ` (${fmtPct(slice.marginPercent)})` : ''}
        </span>
      </div>
    </div>
  );
};

export default ChannelMargins;