import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Link, Loader2, History } from 'lucide-react';
import { api } from '../services/api';
import { labelTalle, codigoTalleParaSku } from '../utils/tallesTango';
import { normalizeMercadoLibreItemId } from '../utils/mercadoLibreItemId';
import { normalizeTiendaNubeProductId } from '../utils/tiendaNubeUrl';

const INVENTORY_PRODUCT_FETCH_OPTS = { includeRelated: false } as const;

function formatSizeForLink(size: string | undefined | null): string {
  if (size == null || String(size).trim() === '') return '';
  const s = String(size).trim();
  if (/^\d{2,3}$/.test(s)) return labelTalle(s) || s;
  const code = codigoTalleParaSku(s);
  return code && code !== s ? `${code} - ${s}` : s;
}

const norm = (s: string) => (s || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');

const bulkLinkSkuMatch = (skuA: string, skuB: string) => {
  const a = norm(skuA);
  const b = norm(skuB);
  if (!a || !b) return false;
  if (a === b) return true;
  const aBase = a.replace(/\s+ac\.?$/i, '').replace(/\s*—.*$/, '').trim();
  const bBase = b.replace(/\s+ac\.?$/i, '').replace(/\s*—.*$/, '').trim();
  return aBase === bBase || a.startsWith(bBase) || b.startsWith(aBase);
};

export interface BulkLinkGroupPageProps {
  groupKey: string;
  onNavigate: (view: string) => void;
  onImportComplete?: () => void;
  showToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
}

const BulkLinkGroupPage: React.FC<BulkLinkGroupPageProps> = ({
  groupKey,
  onNavigate,
  onImportComplete,
  showToast,
}) => {
  const [productId, setProductId] = useState<string | null>(null);
  const [productName, setProductName] = useState('');
  const [variants, setVariants] = useState<
    Array<{ variantId: string; sku: string; size: string; color: string; externalIds?: any }>
  >([]);
  const [mlId, setMlId] = useState('');
  const [tnId, setTnId] = useState('');
  const [mlVariations, setMlVariations] = useState<
    { variationId: number | string; sku: string; color: string; size: string }[]
  >([]);
  const [tnVariants, setTnVariants] = useState<
    { variantId: number | string; sku: string; color: string; size: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState<Record<string, { ml?: string; tn?: string }>>({});
  const [skuEdits, setSkuEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [mlSearch, setMlSearch] = useState('');
  const [tnSearch, setTnSearch] = useState('');

  const goBack = () => onNavigate('inventory');

  const runAutoMatch = (
    localVariants: typeof variants,
    mlList: typeof mlVariations,
    tnList: typeof tnVariants,
    current?: Record<string, { ml?: string; tn?: string }>
  ): Record<string, { ml?: string; tn?: string }> => {
    const prev = current ?? assignments;
    const next: Record<string, { ml?: string; tn?: string }> = { ...prev };
    localVariants.forEach((local) => {
      const skuN = norm(local.sku);
      const sizeN = norm(local.size);
      const colorN = norm(local.color);
      if (!next[local.variantId]) next[local.variantId] = { ml: '', tn: '' };
      if (!next[local.variantId].ml && mlList.length > 0) {
        let match = skuN ? mlList.find((m) => norm(m.sku) === skuN) : null;
        if (!match) match = mlList.find((m) => norm(m.size) === sizeN && norm(m.color) === colorN);
        if (match) next[local.variantId].ml = String(match.variationId);
        else if (mlList.length === 1) next[local.variantId].ml = String(mlList[0].variationId);
      }
      if (!next[local.variantId].tn && tnList.length > 0) {
        let match = skuN ? tnList.find((t) => norm(t.sku) === skuN) : null;
        if (!match) match = tnList.find((t) => norm(t.size) === sizeN && norm(t.color) === colorN);
        if (match) next[local.variantId].tn = String(match.variantId);
        else if (tnList.length === 1) next[local.variantId].tn = String(tnList[0].variantId);
      }
    });
    setAssignments(next);
    return next;
  };

  const optionMatch = (
    query: string,
    item: { sku?: string; size?: string; color?: string; variationId?: string | number; variantId?: string | number }
  ) => {
    const q = norm(query);
    if (!q) return true;
    const id = item.variationId ?? item.variantId ?? '';
    const text = [item.sku || '', formatSizeForLink(item.size), item.color || '', String(id)].join(' ');
    return norm(text).includes(q);
  };

  const filteredMl = useMemo(
    () => mlVariations.filter((m) => optionMatch(mlSearch, m)),
    [mlVariations, mlSearch]
  );
  const filteredTn = useMemo(
    () => tnVariants.filter((t) => optionMatch(tnSearch, t)),
    [tnVariants, tnSearch]
  );

  const getVisibleTnOptions = (selectedValue?: string) => {
    const selected = (selectedValue || '').trim();
    const base = filteredTn.length > 0 ? filteredTn : tnVariants;
    if (!selected) return base;
    if (base.some((t) => String(t.variantId) === selected)) return base;
    const opt = tnVariants.find((t) => String(t.variantId) === selected);
    return opt ? [opt, ...base] : base;
  };

  useEffect(() => {
    if (!groupKey) return;
    setLoading(true);
    api
      .getProductBySku(groupKey, INVENTORY_PRODUCT_FETCH_OPTS)
      .then((p: any) => {
        if (!p) {
          showToast('error', 'Artículo no encontrado');
          goBack();
          return;
        }
        setProductId(p.id);
        setProductName(p.name || groupKey);
        setMlId(p.externalIds?.mercadoLibre || '');
        setTnId(p.externalIds?.tiendaNube || '');
        const list = (p.variants || []).map((v: any) => {
          const variantId = v.variant_id;
          const rawSku = (v.variant_sku ?? '').toString().trim();
          const extSku = (v.external_sku ?? '').toString().trim();
          const fallbackSku = `${groupKey}-${v.size_code}-${v.color_code}`;
          const sku =
            rawSku && rawSku !== String(variantId) ? rawSku : extSku ? extSku : fallbackSku;
          return {
            variantId,
            sku,
            size: v.size_code,
            color: v.color_name,
            externalIds: v.externalIds,
          };
        });
        setVariants(list);
        const nextAssign: Record<string, { ml: string; tn: string }> = {};
        list.forEach((v: any) => {
          const mlVal =
            v.externalIds?.mercadoLibreVariant != null &&
            String(v.externalIds.mercadoLibreVariant).trim() !== ''
              ? String(v.externalIds.mercadoLibreVariant).trim()
              : v.externalIds?.mercadoLibreItemId != null &&
                  String(v.externalIds.mercadoLibreItemId).trim() !== ''
                ? String(v.externalIds.mercadoLibreItemId).trim()
                : '';
          nextAssign[v.variantId] = {
            ml: mlVal,
            tn: v.externalIds?.tiendaNubeVariant ? String(v.externalIds.tiendaNubeVariant) : '',
          };
        });
        setAssignments(nextAssign);
        const skuMap: Record<string, string> = {};
        list.forEach((v: any) => {
          skuMap[v.variantId] = String(v.sku || '');
        });
        setSkuEdits(skuMap);
      })
      .catch(() => showToast('error', 'Error cargando el artículo'))
      .finally(() => setLoading(false));
  }, [groupKey]);

  const handleLoadMl = async () => {
    const id = normalizeMercadoLibreItemId(mlId);
    if (!id) return;
    setLoading(true);
    try {
      const res = await api.getMercadoLibreItemVariations(id);
      const mlList = res.variations || [];
      setMlVariations(mlList);
      runAutoMatch(variants, mlList, tnVariants);
      if (mlList.length > 0 && variants.length > mlList.length) {
        showToast(
          'info',
          `ML devolvió ${mlList.length} opción(es) para ${variants.length} variantes locales.`
        );
      }
    } catch {
      showToast('error', 'No se pudieron cargar las variaciones de ML.');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadTn = async () => {
    const id = normalizeTiendaNubeProductId(tnId);
    if (!id || !/^\d+$/.test(id)) {
      showToast('error', 'No se pudo obtener el ID del producto TN.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.getTiendaNubeProductVariants(id);
      const tnList = res.variants || [];
      setTnVariants(tnList);
      runAutoMatch(variants, mlVariations, tnList);
    } catch {
      showToast('error', 'No se pudieron cargar las variantes de TN.');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadBoth = async () => {
    const mlNorm = normalizeMercadoLibreItemId(mlId);
    const tnNorm = normalizeTiendaNubeProductId(tnId);
    if (!mlNorm || !tnNorm || !/^\d+$/.test(tnNorm)) {
      showToast('info', 'Ingresá ambos enlaces o IDs (ML y TN).');
      return;
    }
    setLoading(true);
    const [mlSettled, tnSettled] = await Promise.allSettled([
      api.getMercadoLibreItemVariations(mlNorm),
      api.getTiendaNubeProductVariants(tnNorm),
    ]);
    let mlList: typeof mlVariations = [];
    let tnList: typeof tnVariants = [];
    const errors: string[] = [];
    if (mlSettled.status === 'fulfilled') {
      mlList = mlSettled.value?.variations || [];
      setMlVariations(mlList);
      if (mlList.length === 0) errors.push('ML no devolvió variaciones.');
    } else {
      errors.push(`Mercado Libre: ${String(mlSettled.reason?.message || mlSettled.reason)}`);
    }
    if (tnSettled.status === 'fulfilled') {
      tnList = tnSettled.value?.variants || [];
      setTnVariants(tnList);
      if (tnList.length === 0) errors.push('TN no devolvió variantes.');
    } else {
      errors.push(`Tienda Nube: ${String(tnSettled.reason?.message || tnSettled.reason)}`);
    }
    const next = runAutoMatch(variants, mlList, tnList);
    if (errors.length) showToast('error', errors.join(' '));
    else {
      const linked = Object.values(next).filter((a) => a.ml?.trim() || a.tn?.trim()).length;
      showToast(
        'success',
        linked > 0
          ? `Emparejadas ${linked} variantes. Revisá la tabla y guardá.`
          : 'Listas cargadas; no hubo emparejamiento automático.'
      );
    }
    setLoading(false);
  };

  const handleSave = async () => {
    if (!productId) return;
    setSaving(true);
    try {
      for (const v of variants) {
        const nextSku = (skuEdits[v.variantId] ?? v.sku ?? '').toString().trim();
        if (!nextSku || nextSku === v.sku) continue;
        await api.updateVariant(String(v.variantId), { sku: nextSku });
      }
      const links = variants
        .map((v) => {
          const ml = assignments[v.variantId]?.ml?.trim() || '';
          const tn = assignments[v.variantId]?.tn?.trim() || '';
          const isMlItemId = /^ML[A-Z]{1,5}\d+$/i.test(ml);
          return {
            variantId: String(v.variantId),
            mercadoLibreVariantId: !isMlItemId && ml ? ml : undefined,
            mercadoLibreItemId: isMlItemId ? ml : undefined,
            tiendaNubeVariantId: tn || undefined,
          };
        })
        .filter(
          (l) => l.mercadoLibreVariantId != null || l.mercadoLibreItemId != null || l.tiendaNubeVariantId != null
        );
      if (links.length === 0) {
        showToast('info', 'Asigná al menos una variación ML o variante TN.');
        setSaving(false);
        return;
      }
      const allMlOwn =
        links.every((l) => {
          const ml = assignments[l.variantId]?.ml?.trim() || '';
          return !ml || /^ML[A-Z]{1,5}\d+$/i.test(ml);
        }) && links.some((l) => /^ML[A-Z]{1,5}\d+$/i.test(assignments[l.variantId]?.ml?.trim() || ''));
      const res = await api.bulkLinkVariants({
        productId,
        mercadoLibreItemId: allMlOwn ? undefined : normalizeMercadoLibreItemId(mlId) || undefined,
        tiendaNubeProductId: (() => {
          const n = normalizeTiendaNubeProductId(tnId);
          return /^\d+$/.test(n) ? n : tnId.trim() || undefined;
        })(),
        links,
      });
      const updated = (res as any)?.updated ?? links.length;
      const synced = (res as any)?.synced ?? 0;
      onImportComplete?.();
      showToast(
        'success',
        synced > 0
          ? `Guardadas ${updated} vinculación(es). Stock enviado a ${synced} variante(s).`
          : `Guardadas ${updated} vinculación(es).`
      );
      goBack();
    } catch (e: any) {
      showToast('error', e?.message || 'Error al guardar vinculaciones.');
    } finally {
      setSaving(false);
    }
  };

  if (loading && variants.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-[40vh]">
        <Loader2 size={36} className="text-indigo-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <header className="shrink-0 flex flex-wrap items-center gap-3 pb-4 border-b border-slate-700/80">
        <button
          type="button"
          onClick={goBack}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 text-sm font-medium"
        >
          <ArrowLeft size={18} />
          Inventario
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Link size={20} className="text-indigo-400 shrink-0" />
            Vincular grupo con ML y TN
          </h1>
          <p className="text-sm text-slate-400 mt-0.5 truncate">
            {productName} · <span className="font-mono text-slate-300">{groupKey}</span>
          </p>
        </div>
      </header>

      <div className="shrink-0 py-4 space-y-3">
        <p className="text-sm text-slate-400">
          Pegá el link o ID de ML y TN. Se empareja por <strong className="text-slate-200">SKU</strong> y, si no
          coincide, por <strong className="text-slate-200">talle y color</strong>.
        </p>
        <p className="text-sm text-amber-200/90 bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2">
          Si cada variante es una publicación ML distinta, dejá vacío el ID padre ML y escribí el MLA en cada fila.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-400">Link o ID publicación ML</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={mlId}
                onChange={(e) => setMlId(e.target.value)}
                placeholder="Link o MLA…"
                className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white font-mono text-sm outline-none focus:border-amber-500"
              />
              <button
                type="button"
                onClick={handleLoadMl}
                disabled={!mlId.trim() || loading}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium disabled:opacity-50"
              >
                Cargar
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-400">Link o ID producto TN</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={tnId}
                onChange={(e) => setTnId(e.target.value)}
                placeholder="Link o número"
                className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white font-mono text-sm outline-none focus:border-cyan-500"
              />
              <button
                type="button"
                onClick={handleLoadTn}
                disabled={!tnId.trim() || loading}
                className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium disabled:opacity-50"
              >
                Cargar
              </button>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleLoadBoth}
            disabled={!mlId.trim() || !tnId.trim() || loading || variants.length === 0}
            className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
          >
            <Link size={16} />
            Cargar y emparejar todo
          </button>
          {(mlVariations.length > 0 || tnVariants.length > 0) && (
            <button
              type="button"
              onClick={() => runAutoMatch(variants, mlVariations, tnVariants)}
              className="text-sm text-indigo-400 hover:text-indigo-300"
            >
              Volver a emparejar
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigate('stock_history')}
            className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-violet-600 text-slate-200 text-sm font-semibold flex items-center gap-2"
          >
            <History size={16} />
            Historial
          </button>
        </div>
        {(mlVariations.length > 0 || tnVariants.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input
              type="text"
              value={mlSearch}
              onChange={(e) => setMlSearch(e.target.value)}
              placeholder={`Filtrar ML (${mlVariations.length})`}
              className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-xs outline-none"
            />
            <input
              type="text"
              value={tnSearch}
              onChange={(e) => setTnSearch(e.target.value)}
              placeholder={`Filtrar TN (${tnVariants.length})`}
              className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-xs outline-none"
            />
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 rounded-xl border border-slate-700 overflow-hidden flex flex-col bg-slate-900/40">
        {variants.length === 0 ? (
          <p className="text-slate-500 text-center py-12">Este artículo no tiene variantes.</p>
        ) : (
          <div className="flex-1 min-h-0 overflow-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 z-10 bg-slate-800/95 backdrop-blur-sm">
                <tr className="border-b border-slate-700">
                  <th className="text-left text-slate-400 font-semibold p-3">Mi variante</th>
                  <th className="text-left text-slate-400 font-semibold p-3">Variación ML</th>
                  <th className="text-left text-slate-400 font-semibold p-3">Variante TN</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v) => (
                  <tr key={v.variantId} className="border-b border-slate-700/50 hover:bg-slate-800/30">
                    <td className="p-3 align-top">
                      <input
                        type="text"
                        value={skuEdits[v.variantId] ?? v.sku ?? ''}
                        onChange={(e) => setSkuEdits((prev) => ({ ...prev, [v.variantId]: e.target.value }))}
                        className="w-full max-w-[220px] bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-blue-200 text-xs font-mono outline-none"
                      />
                      <span className="text-slate-500 text-xs block mt-1">
                        {formatSizeForLink(v.size)} / {v.color}
                      </span>
                    </td>
                    <td className="p-3 align-top">
                      <input
                        type="text"
                        value={assignments[v.variantId]?.ml ?? ''}
                        onChange={(e) =>
                          setAssignments((prev) => ({
                            ...prev,
                            [v.variantId]: { ...prev[v.variantId], ml: e.target.value.trim() },
                          }))
                        }
                        placeholder="MLA o variación"
                        className="w-full max-w-[240px] bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-xs font-mono outline-none"
                      />
                      {mlVariations.length > 0 && (
                        <select
                          value=""
                          onChange={(e) => {
                            const val = e.target.value;
                            if (!val) return;
                            setAssignments((prev) => ({
                              ...prev,
                              [v.variantId]: { ...prev[v.variantId], ml: val },
                            }));
                          }}
                          className="w-full max-w-[240px] mt-1.5 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-slate-300 text-xs outline-none"
                        >
                          <option value="">Desde publicación cargada…</option>
                          {filteredMl.map((m) => (
                            <option key={String(m.variationId)} value={String(m.variationId)}>
                              {m.sku || '—'} — {[formatSizeForLink(m.size), m.color].filter(Boolean).join(' / ')}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="p-3 align-top">
                      <select
                        value={assignments[v.variantId]?.tn ?? ''}
                        onChange={(e) => {
                          const tnVal = e.target.value;
                          const tnOpt = tnVariants.find((t) => String(t.variantId) === tnVal);
                          const mlMatch =
                            tnOpt && mlVariations.find((m) => bulkLinkSkuMatch(tnOpt.sku, m.sku));
                          setAssignments((prev) => ({
                            ...prev,
                            [v.variantId]: {
                              ml: mlMatch ? String(mlMatch.variationId) : prev[v.variantId]?.ml ?? '',
                              tn: tnVal,
                            },
                          }));
                        }}
                        className="w-full max-w-[240px] bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-xs outline-none"
                      >
                        <option value="">—</option>
                        {getVisibleTnOptions(assignments[v.variantId]?.tn).map((t) => (
                          <option key={String(t.variantId)} value={String(t.variantId)}>
                            {t.sku || '—'} — {[formatSizeForLink(t.size), t.color].filter(Boolean).join(' / ')}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <footer className="shrink-0 flex flex-col sm:flex-row gap-2 sm:justify-end pt-4 border-t border-slate-700/80 mt-4">
        <button
          type="button"
          onClick={goBack}
          className="px-5 py-2.5 rounded-xl font-semibold text-slate-300 bg-slate-700/60 hover:bg-slate-600 text-sm"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !productId || variants.length === 0}
          className="px-6 py-2.5 rounded-xl font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 text-sm"
        >
          {saving ? 'Guardando…' : 'Guardar vinculaciones'}
        </button>
      </footer>
    </div>
  );
};

export default BulkLinkGroupPage;
