import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2, DollarSign, Zap, Cloud, TrendingUp, TrendingDown } from 'lucide-react';
import { api } from '../services/api';

export type ChannelPriceArticle = {
  productId: string;
  productName: string;
  baseSku: string;
  cost: number | null;
  variantIds: string[];
  hasML: boolean;
  hasTN: boolean;
};

export type TnFeePreview = {
  ratePercent: number;
  cptPercent: number;
  appliesIva: boolean;
};

type ArticleEdit = ChannelPriceArticle & {
  priceLocal: string;
  priceML: string;
  priceTN: string;
  priceTNPromo: string;
};

type ChannelPricesModalProps = {
  open: boolean;
  onClose: () => void;
  articles: ChannelPriceArticle[];
  tnFee?: TnFeePreview | null;
  ivaPercent?: number;
  showToast?: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
  onSaved?: () => void;
};

const fmt = (n: number | null | undefined) =>
  n != null && Number.isFinite(n)
    ? n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
    : '—';

function parseMoney(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function moneyInput(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return '';
  return String(Math.round(n * 100) / 100);
}

function sameMoney(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((n): n is number => n != null && Number.isFinite(n) && n > 0);
  if (nums.length === 0) return null;
  const first = Math.round(nums[0] * 100) / 100;
  return nums.every((n) => Math.round(n * 100) / 100 === first) ? first : first;
}

export function previewTnMargin(
  listRaw: string,
  promoRaw: string,
  cost: number | null,
  fee: TnFeePreview | null | undefined,
  ivaPercent: number
): { selling: number; fee: number; margin: number; marginPercent: number; promoInvalid: boolean } | null {
  const list = parseMoney(listRaw);
  const promo = parseMoney(promoRaw);
  const selling = promo != null && promo > 0 ? promo : list;
  if (selling == null || selling <= 0 || cost == null || !Number.isFinite(cost) || !fee) return null;
  const promoInvalid = promo != null && list != null && promo >= list;
  const iva = fee.appliesIva ? 1 + (Number(ivaPercent) || 0) / 100 : 1;
  const ratePart = selling * (fee.ratePercent / 100) * iva;
  const cptPart = selling * (fee.cptPercent / 100);
  const feeTotal = Math.round((ratePart + cptPart) * 100) / 100;
  const margin = Math.round((selling - feeTotal - cost) * 100) / 100;
  const marginPercent = Math.round((margin / selling) * 1000) / 10;
  return { selling, fee: feeTotal, margin, marginPercent, promoInvalid };
}

export const ChannelPricesModal: React.FC<ChannelPricesModalProps> = ({
  open,
  onClose,
  articles,
  tnFee,
  ivaPercent = 21,
  showToast,
  onSaved,
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<ArticleEdit[]>([]);
  const [applyLocal, setApplyLocal] = useState(false);
  const [applyML, setApplyML] = useState(false);
  const [applyTN, setApplyTN] = useState(true);
  const [pctAdjust, setPctAdjust] = useState('');

  const articlesKey = useMemo(
    () => articles.map((a) => `${a.productId}:${a.variantIds.join(',')}`).join('|'),
    [articles]
  );

  useEffect(() => {
    if (!open || articles.length === 0) return;
    let cancelled = false;
    setLoading(true);
    const ids = articles.flatMap((a) => a.variantIds);
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += 80) batches.push(ids.slice(i, i + 80));

    Promise.all(batches.map((batch) => api.getVariantChannelPrices(batch)))
      .then((results) => {
        if (cancelled) return;
        const merged: Record<string, {
          priceLocal?: number;
          priceML?: number;
          priceTN?: number;
          priceTNList?: number;
          priceTNPromo?: number | null;
        }> = {};
        results.forEach((r) => Object.assign(merged, r.prices || {}));
        setRows(
          articles.map((article) => {
            const slots = article.variantIds.map((id) => merged[id]).filter(Boolean);
            const list = sameMoney(slots.map((s) => s?.priceTNList ?? s?.priceTN));
            const promo = sameMoney(slots.map((s) => s?.priceTNPromo));
            const ml = sameMoney(slots.map((s) => s?.priceML));
            const local = sameMoney(slots.map((s) => s?.priceLocal));
            return {
              ...article,
              priceLocal: moneyInput(local),
              priceML: moneyInput(ml),
              priceTN: moneyInput(list),
              priceTNPromo: moneyInput(promo),
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
  }, [open, articlesKey, articles, showToast]);

  const applyPercent = (col: 'priceLocal' | 'priceML' | 'priceTN' | 'priceTNPromo') => {
    const pct = parseMoney(pctAdjust);
    if (pct == null) {
      showToast?.('warning', 'Indicá un porcentaje válido (ej. 10 o -5)');
      return;
    }
    const factor = 1 + pct / 100;
    setRows((prev) =>
      prev.map((r) => {
        const raw = r[col];
        const n = parseMoney(raw);
        if (n == null) return r;
        return { ...r, [col]: String(Math.max(0, Math.round(n * factor * 100) / 100)) };
      })
    );
  };

  const patch = (productId: string, field: keyof ArticleEdit, value: string) => {
    setRows((prev) => prev.map((r) => (r.productId === productId ? { ...r, [field]: value } : r)));
  };

  const promoInvalid = rows.some((r) => {
    if (!applyTN || !r.hasTN) return false;
    return previewTnMargin(r.priceTN, r.priceTNPromo, r.cost, tnFee, ivaPercent)?.promoInvalid === true;
  });

  const handleSave = async () => {
    if (promoInvalid) {
      showToast?.('warning', 'El precio promocional tiene que ser menor que el precio de Tienda Nube');
      return;
    }
    setSaving(true);
    try {
      const updates = rows.flatMap((r) => {
        const priceLocal = parseMoney(r.priceLocal);
        const priceML = parseMoney(r.priceML);
        const priceTN = parseMoney(r.priceTN);
        const promoParsed = parseMoney(r.priceTNPromo);
        const clearTNPromo = r.priceTNPromo.trim() === '';
        return r.variantIds.map((variantId) => ({
          variantId,
          ...(applyLocal && priceLocal != null ? { priceLocal } : {}),
          ...(applyML && r.hasML && priceML != null ? { priceML } : {}),
          ...(applyTN && r.hasTN && priceTN != null ? { priceTN } : {}),
          ...(applyTN && r.hasTN && promoParsed != null ? { priceTNPromo: promoParsed } : {}),
          ...(applyTN && r.hasTN && clearTNPromo ? { clearTNPromo: true } : {}),
        }));
      });
      let totalLocal = 0;
      let totalML = 0;
      let totalTN = 0;
      const allErrors: string[] = [];
      for (let i = 0; i < updates.length; i += 150) {
        const res = await api.bulkUpdateChannelPrices({
          updates: updates.slice(i, i + 150),
          applyLocal,
          applyML,
          applyTN,
        });
        totalLocal += res.updatedLocal ?? 0;
        totalML += res.updatedML ?? 0;
        totalTN += res.updatedTN ?? 0;
        if (res.errors?.length) allErrors.push(...res.errors);
      }
      if (applyTN && totalTN === 0 && allErrors.length) {
        showToast?.('error', allErrors.slice(0, 2).join(' · ') || 'Tienda Nube no aceptó los precios');
        return;
      }
      const errPart = allErrors.length ? ` · ${allErrors.length} aviso(s)` : '';
      showToast?.(
        'success',
        `Precios actualizados — TN: ${totalTN} variante(s), ML: ${totalML}, LupoHub: ${totalLocal}${errPart}`
      );
      onSaved?.();
      onClose();
    } catch (e: unknown) {
      showToast?.('error', e instanceof Error ? e.message : 'Error al guardar precios');
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
      <div
        className="bg-slate-800 border border-slate-600 rounded-2xl w-full max-w-6xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 p-4 border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-2">
            <DollarSign className="text-emerald-400" size={22} />
            <div>
              <h3 className="text-lg font-black text-white">Precios de Tienda Nube</h3>
              <p className="text-slate-400 text-xs">
                Precio y promocional se aplican a todas las variantes. El margen usa el promocional si está cargado.
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="text-slate-400 hover:text-white p-1">
            <X size={22} />
          </button>
        </div>

        <div className="p-4 border-b border-slate-700 flex flex-wrap gap-3 items-end shrink-0">
          <label className="flex items-center gap-2 text-sm text-cyan-300">
            <input type="checkbox" checked={applyTN} onChange={(e) => setApplyTN(e.target.checked)} />
            <Cloud size={14} /> Tienda Nube
          </label>
          <label className="flex items-center gap-2 text-sm text-amber-300">
            <input type="checkbox" checked={applyML} onChange={(e) => setApplyML(e.target.checked)} />
            <Zap size={14} /> Mercado Libre
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={applyLocal} onChange={(e) => setApplyLocal(e.target.checked)} />
            LupoHub
          </label>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <input
              type="text"
              inputMode="decimal"
              placeholder="% ajuste"
              value={pctAdjust}
              onChange={(e) => setPctAdjust(e.target.value)}
              className="w-24 rounded-lg bg-slate-900 border border-slate-600 px-2 py-1.5 text-white text-sm"
            />
            <button type="button" onClick={() => applyPercent('priceTN')} className="text-xs px-2 py-1.5 rounded-lg bg-cyan-900/50 text-cyan-200 hover:bg-cyan-800/50">
              % precio
            </button>
            <button type="button" onClick={() => applyPercent('priceTNPromo')} className="text-xs px-2 py-1.5 rounded-lg bg-cyan-900/50 text-cyan-200 hover:bg-cyan-800/50">
              % promo
            </button>
            <button type="button" onClick={() => applyPercent('priceML')} className="text-xs px-2 py-1.5 rounded-lg bg-amber-900/50 text-amber-200 hover:bg-amber-800/50">
              % ML
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto min-h-0 p-4">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="animate-spin text-emerald-400" size={36} />
            </div>
          ) : (
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="text-left text-[10px] uppercase text-slate-500 border-b border-slate-700">
                  <th className="pb-2 pr-2">Artículo</th>
                  <th className="pb-2 pr-2">Costo</th>
                  <th className="pb-2 pr-2 text-cyan-300">Precio TN</th>
                  <th className="pb-2 pr-2 text-cyan-300">Promocional</th>
                  <th className="pb-2 pr-2">Margen TN</th>
                  <th className="pb-2 pr-2 text-amber-300">ML</th>
                  <th className="pb-2">LupoHub</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const preview = previewTnMargin(r.priceTN, r.priceTNPromo, r.cost, tnFee, ivaPercent);
                  return (
                    <tr key={r.productId} className="border-b border-slate-700/50 align-top">
                      <td className="py-3 pr-2">
                        {r.baseSku ? <div className="font-mono text-xs text-blue-400">{r.baseSku}</div> : null}
                        <div className="text-white text-xs font-medium">{r.productName}</div>
                        <div className="text-slate-500 text-[11px]">
                          {r.variantIds.length} variante{r.variantIds.length !== 1 ? 's' : ''}
                        </div>
                      </td>
                      <td className="py-3 pr-2 text-slate-300 whitespace-nowrap">{fmt(r.cost)}</td>
                      <td className="py-3 pr-2">
                        {r.hasTN ? (
                          <input
                            type="text"
                            inputMode="decimal"
                            value={r.priceTN}
                            disabled={!applyTN}
                            onChange={(e) => patch(r.productId, 'priceTN', e.target.value)}
                            className="w-full max-w-[120px] rounded-lg bg-slate-900 border border-cyan-700/50 px-2 py-1 text-white text-sm disabled:opacity-40"
                          />
                        ) : (
                          <span className="text-slate-500 text-xs">Sin TN</span>
                        )}
                      </td>
                      <td className="py-3 pr-2">
                        {r.hasTN ? (
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="Sin promo"
                            value={r.priceTNPromo}
                            disabled={!applyTN}
                            onChange={(e) => patch(r.productId, 'priceTNPromo', e.target.value)}
                            className={`w-full max-w-[120px] rounded-lg bg-slate-900 border px-2 py-1 text-white text-sm disabled:opacity-40 ${
                              preview?.promoInvalid ? 'border-red-500' : 'border-cyan-700/50'
                            }`}
                          />
                        ) : (
                          <span className="text-slate-500 text-xs">—</span>
                        )}
                      </td>
                      <td className="py-3 pr-2 text-xs min-w-[140px]">
                        {preview?.promoInvalid ? (
                          <span className="text-red-400">El promo tiene que ser menor</span>
                        ) : preview ? (
                          <div>
                            <div className="text-slate-500">Venta {fmt(preview.selling)}</div>
                            <div className="text-slate-500">Comisión −{fmt(preview.fee)}</div>
                            <div className={`font-semibold inline-flex items-center gap-1 ${preview.margin >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {preview.margin >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                              {fmt(preview.margin)} ({preview.marginPercent.toFixed(1)}%)
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-500">Sin costo o precio</span>
                        )}
                      </td>
                      <td className="py-3 pr-2">
                        {r.hasML ? (
                          <input
                            type="text"
                            inputMode="decimal"
                            value={r.priceML}
                            disabled={!applyML}
                            onChange={(e) => patch(r.productId, 'priceML', e.target.value)}
                            className="w-full max-w-[110px] rounded-lg bg-slate-900 border border-amber-700/50 px-2 py-1 text-white text-sm disabled:opacity-40"
                          />
                        ) : (
                          <span className="text-slate-500 text-xs">Sin ML</span>
                        )}
                      </td>
                      <td className="py-3">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={r.priceLocal}
                          disabled={!applyLocal}
                          onChange={(e) => patch(r.productId, 'priceLocal', e.target.value)}
                          className="w-full max-w-[110px] rounded-lg bg-slate-900 border border-slate-600 px-2 py-1 text-white text-sm disabled:opacity-40"
                        />
                      </td>
                    </tr>
                  );
                })}
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
            disabled={saving || loading || rows.length === 0 || promoInvalid}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm disabled:opacity-50"
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : <DollarSign size={18} />}
            Guardar en Tienda Nube
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChannelPricesModal;
