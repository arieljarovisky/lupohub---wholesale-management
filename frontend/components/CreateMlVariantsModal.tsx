import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, X, Zap } from 'lucide-react';
import { api } from '../services/api';
import { labelTalle } from '../utils/tallesTango';

type PreviewRow = {
  variantId: string;
  sku: string;
  color: string;
  size: string;
  stock: number;
  listingStock: number;
  alreadyOnMl: boolean;
  linkedItemId: string | null;
};

type Preview = {
  productName: string;
  anchorItemId: string;
  anchorTitle: string;
  mode: 'user_product' | 'classic';
  variesBy: { color: boolean; size: boolean };
  variants: PreviewRow[];
};

type Props = {
  open: boolean;
  productId: string;
  productName: string;
  initialAnchorItemId?: string;
  onClose: () => void;
  onCreated?: () => void;
  showToast?: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
};

const CreateMlVariantsModal: React.FC<Props> = ({
  open,
  productId,
  productName,
  initialAnchorItemId,
  onClose,
  onCreated,
  showToast
}) => {
  const [anchorInput, setAnchorInput] = useState(initialAnchorItemId || '');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setAnchorInput(initialAnchorItemId || '');
    setPreview(null);
    setError('');
    setSelected(new Set());
  }, [open, productId, initialAnchorItemId]);

  const load = async (anchor: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.previewMercadoLibreVariants(productId, anchor);
      setPreview(res);
      if (res.anchorItemId) setAnchorInput(res.anchorItemId);
      const next = new Set<string>();
      for (const row of res.variants || []) {
        if (!row.alreadyOnMl || !row.linkedItemId) next.add(row.variantId);
      }
      setSelected(next);
    } catch (e: any) {
      setPreview(null);
      setError(e?.message || 'No se pudo leer la publicación de Mercado Libre');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !productId) return;
    void load(initialAnchorItemId || '');
    // Solo al abrir o cambiar de artículo. El MLA se recarga con el botón.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, productId]);

  const rows = preview?.variants || [];
  const missing = rows.filter((r) => !r.alreadyOnMl);
  const axes = preview?.variesBy;
  const axisLabel = useMemo(() => {
    if (!axes) return '';
    if (axes.color && axes.size) return 'talles y colores';
    if (axes.color) return 'colores';
    if (axes.size) return 'talles';
    return 'variantes';
  }, [axes]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (!preview || selected.size === 0) return;
    setSubmitting(true);
    try {
      const res = await api.createMercadoLibreVariants({
        productId,
        anchorItemId: preview.anchorItemId,
        variantIds: [...selected]
      });
      const created = res.created?.length || 0;
      const linked = res.linkedExisting?.length || 0;
      const failed = res.failed || [];
      if (created > 0) {
        showToast?.('success', `Se crearon ${created} variante(s) en Mercado Libre${linked ? ` y se vincularon ${linked} que ya existían` : ''}.`);
      } else if (linked > 0 && failed.length === 0) {
        showToast?.('success', `Esas variantes ya estaban en Mercado Libre. Se vincularon ${linked}.`);
      }
      if (failed.length) {
        const first = failed[0];
        const label = [first.color, labelTalle(first.size) || first.size].filter(Boolean).join(' · ');
        showToast?.('error', `${failed.length} no se pudieron crear${label ? ` (${label})` : ''}: ${first.error}`);
      }
      if (created > 0 || linked > 0) onCreated?.();
      if (failed.length === 0) onClose();
      else await load(preview.anchorItemId);
    } catch (e: any) {
      showToast?.('error', e?.message || 'No se pudieron crear las variantes');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ml-variants-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-5 border-b border-slate-800">
          <div>
            <h3 id="ml-variants-title" className="text-lg font-black text-white">Crear variantes en Mercado Libre</h3>
            <p className="text-slate-400 text-sm mt-1">{productName}</p>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          <p className="text-xs text-slate-500">
            Se crean en la publicación que indiques los talles y colores de este artículo que todavía no están en Mercado Libre.
            El precio y las fotos se copian de esa publicación. El stock enviado es el de LupoHub (dividido por el pack ML, si tiene).
          </p>

          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1.5">Publicación modelo (MLA o MLAU)</label>
            <div className="flex gap-2">
              <input
                value={anchorInput}
                onChange={(e) => setAnchorInput(e.target.value)}
                placeholder="MLA… o link de la publicación"
                disabled={loading || submitting}
                className="flex-1 rounded-xl bg-slate-950 border border-slate-700 px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500/60"
              />
              <button
                type="button"
                disabled={loading || submitting}
                onClick={() => void load(anchorInput)}
                className="px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-bold disabled:opacity-50"
              >
                Ver
              </button>
            </div>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <Loader2 size={16} className="animate-spin" /> Leyendo variantes de Mercado Libre…
            </div>
          )}
          {error && <p className="text-sm text-red-300">{error}</p>}

          {preview && !loading && (
            <>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">
                <span className="text-slate-500">Publicación: </span>
                {preview.anchorTitle || preview.anchorItemId}
                <span className="text-slate-500"> · {preview.anchorItemId}</span>
                <span className="block text-xs text-amber-300/90 mt-1">
                  Acepta {axisLabel}
                  {preview.mode === 'user_product' ? ' (cada talle y color es una publicación de la misma familia)' : ' (variaciones de la misma publicación)'}
                </span>
                {axes && (!axes.color || !axes.size) && (
                  <span className="block text-xs text-slate-500 mt-1">
                    {axes.color
                      ? 'Esta publicación no separa por talle: los colores iguales se toman como la misma variante.'
                      : 'Esta publicación no separa por color: los talles iguales se toman como la misma variante.'}
                  </span>
                )}
              </div>

              {rows.length === 0 ? (
                <p className="text-sm text-slate-400">Este artículo no tiene variantes locales.</p>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-slate-500 px-1">
                    <span>{missing.length} sin publicar · {rows.length - missing.length} ya en Mercado Libre</span>
                    <button
                      type="button"
                      className="text-amber-300 font-bold"
                      onClick={() =>
                        setSelected(new Set(rows.filter((r) => !r.alreadyOnMl || !r.linkedItemId).map((r) => r.variantId)))
                      }
                    >
                      Marcar faltantes
                    </button>
                  </div>
                  <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-800 divide-y divide-slate-800">
                    {rows.map((row) => {
                      const sizeLabel = labelTalle(row.size) || row.size;
                      const linked = row.alreadyOnMl && !!row.linkedItemId;
                      const disabled = linked || submitting;
                      return (
                        <label key={row.variantId} className={`flex items-center gap-3 px-3 py-2.5 text-sm ${disabled ? 'opacity-60' : 'cursor-pointer hover:bg-slate-800/50'}`}>
                          <input
                            type="checkbox"
                            checked={linked || selected.has(row.variantId)}
                            disabled={disabled}
                            onChange={() => toggle(row.variantId)}
                            className="accent-amber-500"
                          />
                          <span className="flex-1 text-slate-200">
                            {row.color} · {sizeLabel}
                            <span className="text-slate-500 text-xs ml-2">{row.sku}</span>
                          </span>
                          <span className="text-xs text-slate-500">stock {row.listingStock}</span>
                          {linked && <span className="text-[10px] font-bold uppercase text-emerald-400">Vinculada</span>}
                          {row.alreadyOnMl && !linked && <span className="text-[10px] font-bold uppercase text-amber-300">Vincular</span>}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-4 border-t border-slate-800 flex justify-end gap-2">
          <button type="button" disabled={submitting} onClick={onClose} className="px-4 py-2.5 rounded-xl text-slate-300 hover:bg-slate-800 font-bold text-sm">
            Cancelar
          </button>
          <button
            type="button"
            disabled={submitting || loading || selected.size === 0}
            onClick={() => void submit()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-sm disabled:opacity-50"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
            Crear {selected.size || ''} en Mercado Libre
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateMlVariantsModal;
