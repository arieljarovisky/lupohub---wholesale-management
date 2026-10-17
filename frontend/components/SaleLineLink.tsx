import React, { useEffect, useState } from 'react';
import { CheckCircle2, Link, Loader2, Package, Search, X } from 'lucide-react';
import { api } from '../services/api';
import { Product } from '../types';

type Platform = 'mercadolibre' | 'tiendanube';

export type SaleLineHubVariant = { id: string; sku: string; label: string };

export type SaleLineHubLinkFields = {
  hubLinkStatus?: 'linked' | 'bundle' | 'unlinked';
  hubVariant?: SaleLineHubVariant | null;
};

export type SaleLineToLink = {
  platform: Platform;
  orderId: string;
  externalProductId: string;
  externalVariantId: string;
  title: string;
  sku: string;
  quantity: number;
  /** La venta está pagada y no cancelada: se puede descontar el stock al asociarla. */
  canDeduct: boolean;
};

const PACK_OPTIONS = [1, 2, 3, 6, 12] as const;

/** Clave de la publicación vendida: todas las líneas con la misma clave quedan asociadas a la vez. */
export function saleLineListingKey(platform: Platform, externalProductId: string, externalVariantId: string): string {
  return platform === 'tiendanube'
    ? `tiendanube|${externalVariantId}`
    : `mercadolibre|${externalProductId}|${externalVariantId}`;
}

/** Estado de asociación de una línea de venta con el artículo del hub. */
export const SaleLineLinkStatus: React.FC<{
  line: SaleLineHubLinkFields;
  onLink: () => void;
}> = ({ line, onLink }) => {
  if (line.hubLinkStatus === 'bundle') {
    return <span className="text-[10px] text-slate-400">Pack multicolor</span>;
  }
  if (line.hubLinkStatus === 'linked' && line.hubVariant) {
    return (
      <div className="flex items-center gap-2 text-[10px]">
        <span className="text-emerald-400/90 truncate" title={line.hubVariant.label}>
          → {line.hubVariant.sku}
        </span>
        <button type="button" onClick={onLink} className="text-slate-500 hover:text-slate-300 underline">
          Cambiar
        </button>
      </div>
    );
  }
  if (line.hubLinkStatus === 'unlinked') {
    return (
      <button
        type="button"
        onClick={onLink}
        className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-300 hover:bg-amber-500/20"
      >
        <Link size={11} />
        Sin artículo · Asociar
      </button>
    );
  }
  return null;
};

/** Ventana para asociar una línea de venta a una variante del hub (el vínculo queda guardado). */
export const SaleLineLinkModal: React.FC<{
  line: SaleLineToLink | null;
  onClose: () => void;
  onLinked: (line: SaleLineToLink, hubVariant: SaleLineHubVariant, deducted: boolean) => void;
}> = ({ line, onClose, onLinked }) => {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  const [packSize, setPackSize] = useState<number>(1);
  const [deductStock, setDeductStock] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!line) return;
    setSearch(line.sku || '');
    setSelected(null);
    setPackSize(1);
    setDeductStock(line.canDeduct);
    setError('');
  }, [line]);

  useEffect(() => {
    if (!line) return;
    const q = search.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.getProductsPaged(1, 25, q, 'sku', 'asc', undefined, { skipTotal: true });
        if (!cancelled) setResults(res.items || []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search, line]);

  if (!line) return null;

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      const res = await api.linkChannelSaleLine({
        platform: line.platform,
        orderId: line.orderId,
        externalProductId: line.externalProductId,
        externalVariantId: line.externalVariantId,
        variantId: selected.id,
        packSize,
        deductStock: line.canDeduct && deductStock,
      });
      const hubVariant: SaleLineHubVariant = res?.hubVariant || {
        id: selected.id,
        sku: selected.sku,
        label: [selected.name, selected.color, selected.size].filter(Boolean).join(' · '),
      };
      onLinked(line, hubVariant, !!res?.deducted);
    } catch (e: any) {
      setError(e?.message || 'No se pudo asociar la venta');
    } finally {
      setSaving(false);
    }
  };

  const platformName = line.platform === 'mercadolibre' ? 'Mercado Libre' : 'Tienda Nube';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-white">Asociar venta a un artículo</h3>
            <p className="mt-1 text-xs text-slate-400">
              {line.title} · SKU {line.sku || '—'} · {line.quantity} un.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por SKU o nombre del artículo..."
            className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:border-slate-500 focus:outline-none"
          />
        </div>

        <div className="mb-4 max-h-64 overflow-y-auto rounded-lg border border-slate-800">
          {searching ? (
            <div className="flex items-center justify-center gap-2 p-4 text-xs text-slate-400">
              <Loader2 size={14} className="animate-spin" /> Buscando...
            </div>
          ) : results.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-500">
              {search.trim().length < 2 ? 'Escribí al menos 2 caracteres.' : 'No se encontraron artículos.'}
            </div>
          ) : (
            results.map((p) => {
              const isSel = selected?.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelected(p)}
                  className={`flex w-full items-center justify-between gap-3 border-b border-slate-800 px-3 py-2 text-left last:border-0 ${
                    isSel ? 'bg-emerald-500/10' : 'hover:bg-slate-800/60'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-slate-200">{p.sku}</p>
                    <p className="truncate text-[11px] text-slate-400">
                      {[p.name, p.color, p.size].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-[11px] text-slate-400">
                    <Package size={12} /> {p.stock}
                    {isSel && <CheckCircle2 size={14} className="text-emerald-400" />}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-slate-300">
          <label className="flex items-center gap-2">
            Unidades por venta
            <select
              value={packSize}
              onChange={(e) => setPackSize(Number(e.target.value))}
              className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-white"
            >
              {PACK_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? '1 (unidad)' : `Pack x${n}`}
                </option>
              ))}
            </select>
          </label>
          {line.canDeduct && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={deductStock} onChange={(e) => setDeductStock(e.target.checked)} />
              Descontar el stock de esta venta
            </label>
          )}
        </div>

        <p className="mb-4 text-[11px] text-slate-500">
          El vínculo queda guardado: las próximas ventas de esta publicación de {platformName} se van a asociar solas a este
          artículo.
        </p>

        {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!selected || saving}
            onClick={handleSave}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Guardar asociación
          </button>
        </div>
      </div>
    </div>
  );
};
