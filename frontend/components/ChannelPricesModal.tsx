import React, { useEffect, useState, useMemo } from 'react';
import { X, Loader2, DollarSign, Zap, Cloud } from 'lucide-react';
import { api } from '../services/api';
import type { Product } from '../types';

export type ChannelPriceRow = {
  variantId: string;
  sku: string;
  label: string;
  hasML: boolean;
  hasTN: boolean;
  priceLocal: string;
  priceML: string;
  priceTN: string;
};

type ChannelPricesModalProps = {
  open: boolean;
  onClose: () => void;
  variants: Product[];
  showToast?: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
  onSaved?: () => void;
};

export const ChannelPricesModal: React.FC<ChannelPricesModalProps> = ({
  open,
  onClose,
  variants,
  showToast,
  onSaved,
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<ChannelPriceRow[]>([]);
  const [applyLocal, setApplyLocal] = useState(true);
  const [applyML, setApplyML] = useState(true);
  const [applyTN, setApplyTN] = useState(true);
  const [pctAdjust, setPctAdjust] = useState('');

  const variantIdsKey = useMemo(
    () => variants.map((v) => v.id).sort().join(','),
    [variants]
  );

  useEffect(() => {
    if (!open || variants.length === 0) return;
    let cancelled = false;
    setLoading(true);
    const ids = variants.map((v) => v.id);
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += 80) batches.push(ids.slice(i, i + 80));

    Promise.all(batches.map((batch) => api.getVariantChannelPrices(batch)))
      .then((results) => {
        if (cancelled) return;
        const merged: Record<
          string,
          {
            priceLocal?: number;
            priceML?: number;
            priceTN?: number;
            hasML?: boolean;
            hasTN?: boolean;
          }
        > = {};
        results.forEach((r) => Object.assign(merged, r.prices || {}));
        setRows(
          variants.map((v) => {
            const p = merged[v.id];
            const size = (v as any).size ?? '';
            const color = (v as any).color ?? (v as any).colorCode ?? '';
            return {
              variantId: v.id,
              sku: v.sku,
              label: [color, size].filter(Boolean).join(' · ') || v.sku,
              hasML: p?.hasML ?? !!v.integrations?.mercadoLibre,
              hasTN: p?.hasTN ?? !!v.integrations?.tiendaNube,
              priceLocal: p?.priceLocal != null ? String(p.priceLocal) : String(v.price ?? ''),
              priceML: p?.priceML != null ? String(p.priceML) : '',
              priceTN: p?.priceTN != null ? String(p.priceTN) : '',
            };
          })
        );
      })
      .catch((e: Error) => showToast?.('error', e?.message || 'No se pudieron cargar precios'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, variantIdsKey, variants, showToast]);

  const applyPercentToColumn = (col: 'priceLocal' | 'priceML' | 'priceTN') => {
    const pct = Number(String(pctAdjust).replace(',', '.'));
    if (!Number.isFinite(pct)) {
      showToast?.('warning', 'Indicá un porcentaje válido (ej. 10 o -5)');
      return;
    }
    const factor = 1 + pct / 100;
    setRows((prev) =>
      prev.map((r) => {
        const raw = r[col];
        if (raw === '' || raw == null) return r;
        const n = Number(raw);
        if (!Number.isFinite(n)) return r;
        return { ...r, [col]: String(Math.max(0, Math.round(n * factor))) };
      })
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates = rows.map((r) => ({
        variantId: r.variantId,
        ...(applyLocal && r.priceLocal !== '' ? { priceLocal: Number(r.priceLocal) } : {}),
        ...(applyML && r.hasML && r.priceML !== '' ? { priceML: Number(r.priceML) } : {}),
        ...(applyTN && r.hasTN && r.priceTN !== '' ? { priceTN: Number(r.priceTN) } : {}),
      }));
      let totalLocal = 0;
      let totalML = 0;
      let totalTN = 0;
      const allErrors: string[] = [];
      for (let i = 0; i < updates.length; i += 50) {
        const chunk = updates.slice(i, i + 50);
        const res = await api.bulkUpdateChannelPrices({
          updates: chunk,
          applyLocal,
          applyML,
          applyTN,
        });
        totalLocal += res.updatedLocal ?? 0;
        totalML += res.updatedML ?? 0;
        totalTN += res.updatedTN ?? 0;
        if (res.errors?.length) allErrors.push(...res.errors);
      }
      const errPart = allErrors.length ? ` · ${allErrors.length} aviso(s)` : '';
      showToast?.(
        'success',
        `Precios actualizados — LupoHub: ${totalLocal}, ML: ${totalML}, TN: ${totalTN}${errPart}`
      );
      onSaved?.();
      onClose();
    } catch (e: any) {
      showToast?.('error', e?.message || 'Error al guardar precios');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && !saving && onClose()}
    >
      <div className="bg-slate-800 border border-slate-600 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 p-4 border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-2">
            <DollarSign className="text-emerald-400" size={22} />
            <div>
              <h3 className="text-lg font-black text-white">Precios por canal</h3>
              <p className="text-slate-400 text-xs">{rows.length} variante(s) · valores desde ML/TN en vivo</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="text-slate-400 hover:text-white p-1">
            <X size={22} />
          </button>
        </div>

        <div className="p-4 border-b border-slate-700 flex flex-wrap gap-3 items-end shrink-0">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={applyLocal} onChange={(e) => setApplyLocal(e.target.checked)} />
            LupoHub
          </label>
          <label className="flex items-center gap-2 text-sm text-amber-300">
            <input type="checkbox" checked={applyML} onChange={(e) => setApplyML(e.target.checked)} />
            <Zap size={14} /> ML
          </label>
          <label className="flex items-center gap-2 text-sm text-cyan-300">
            <input type="checkbox" checked={applyTN} onChange={(e) => setApplyTN(e.target.checked)} />
            <Cloud size={14} /> TN
          </label>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <input
              type="text"
              inputMode="decimal"
              placeholder="% ajuste"
              value={pctAdjust}
              onChange={(e) => setPctAdjust(e.target.value)}
              className="w-20 rounded-lg bg-slate-900 border border-slate-600 px-2 py-1.5 text-white text-sm"
            />
            <button
              type="button"
              onClick={() => applyPercentToColumn('priceLocal')}
              className="text-xs px-2 py-1.5 rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600"
            >
              % Lupo
            </button>
            <button
              type="button"
              onClick={() => applyPercentToColumn('priceML')}
              className="text-xs px-2 py-1.5 rounded-lg bg-amber-900/50 text-amber-200 hover:bg-amber-800/50"
            >
              % ML
            </button>
            <button
              type="button"
              onClick={() => applyPercentToColumn('priceTN')}
              className="text-xs px-2 py-1.5 rounded-lg bg-cyan-900/50 text-cyan-200 hover:bg-cyan-800/50"
            >
              % TN
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto min-h-0 p-4">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="animate-spin text-emerald-400" size={36} />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase text-slate-500 border-b border-slate-700">
                  <th className="pb-2 pr-2">Variante</th>
                  <th className="pb-2 pr-2">LupoHub</th>
                  <th className="pb-2 pr-2">Mercado Libre</th>
                  <th className="pb-2">Tienda Nube</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.variantId} className="border-b border-slate-700/50">
                    <td className="py-2 pr-2">
                      <div className="font-mono text-xs text-slate-400">{r.sku}</div>
                      <div className="text-white text-xs">{r.label}</div>
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={r.priceLocal}
                        onChange={(e) => {
                          const v = e.target.value;
                          setRows((prev) => prev.map((row, j) => (j === i ? { ...row, priceLocal: v } : row)));
                        }}
                        className="w-full max-w-[100px] rounded-lg bg-slate-900 border border-slate-600 px-2 py-1 text-white text-sm"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      {r.hasML ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          value={r.priceML}
                          onChange={(e) => {
                            const v = e.target.value;
                            setRows((prev) => prev.map((row, j) => (j === i ? { ...row, priceML: v } : row)));
                          }}
                          className="w-full max-w-[100px] rounded-lg bg-slate-900 border border-amber-700/50 px-2 py-1 text-white text-sm"
                        />
                      ) : (
                        <span className="text-slate-500 text-xs">Sin ML</span>
                      )}
                    </td>
                    <td className="py-2">
                      {r.hasTN ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          value={r.priceTN}
                          onChange={(e) => {
                            const v = e.target.value;
                            setRows((prev) => prev.map((row, j) => (j === i ? { ...row, priceTN: v } : row)));
                          }}
                          className="w-full max-w-[100px] rounded-lg bg-slate-900 border border-cyan-700/50 px-2 py-1 text-white text-sm"
                        />
                      ) : (
                        <span className="text-slate-500 text-xs">Sin TN</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="p-4 border-t border-slate-700 flex justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2.5 rounded-xl text-slate-300 hover:bg-slate-700 font-bold text-sm"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading || rows.length === 0}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm disabled:opacity-50"
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : <DollarSign size={18} />}
            Guardar precios
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChannelPricesModal;
