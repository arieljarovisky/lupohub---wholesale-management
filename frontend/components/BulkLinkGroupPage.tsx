import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Link,
  Loader2,
  History,
  Zap,
  CheckCircle2,
  AlertCircle,
  Circle,
  Search,
  Cloud,
  HelpCircle,
  Sparkles,
} from 'lucide-react';
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

function formatOptionLabel(item: { sku?: string; size?: string; color?: string }): string {
  const parts = [
    item.sku?.trim() || '',
    [formatSizeForLink(item.size), item.color].filter(Boolean).join(' / '),
  ].filter(Boolean);
  return parts.join(' · ') || '—';
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

type RowLinkStatus = 'complete' | 'partial' | 'empty';

function getRowLinkStatus(ml?: string, tn?: string): RowLinkStatus {
  const hasMl = !!ml?.trim();
  const hasTn = !!tn?.trim();
  if (hasMl && hasTn) return 'complete';
  if (hasMl || hasTn) return 'partial';
  return 'empty';
}

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
  const [showMlTip, setShowMlTip] = useState(false);

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

  const linkStats = useMemo(() => {
    let ml = 0;
    let tn = 0;
    let both = 0;
    variants.forEach((v) => {
      const a = assignments[v.variantId];
      const hasMl = !!a?.ml?.trim();
      const hasTn = !!a?.tn?.trim();
      if (hasMl) ml++;
      if (hasTn) tn++;
      if (hasMl && hasTn) both++;
    });
    const total = variants.length;
    const progress = total ? Math.round(((ml + tn) / (total * 2)) * 100) : 0;
    return { total, ml, tn, both, progress };
  }, [variants, assignments]);

  const catalogsLoaded = mlVariations.length > 0 || tnVariants.length > 0;
  const currentStep = catalogsLoaded ? 2 : 1;

  const getVisibleTnOptions = (selectedValue?: string) => {
    const selected = (selectedValue || '').trim();
    const base = filteredTn.length > 0 ? filteredTn : tnVariants;
    if (!selected) return base;
    if (base.some((t) => String(t.variantId) === selected)) return base;
    const opt = tnVariants.find((t) => String(t.variantId) === selected);
    return opt ? [opt, ...base] : base;
  };

  const resolveMlLabel = (value?: string) => {
    const id = (value || '').trim();
    if (!id) return null;
    if (/^ML[A-Z]{1,5}\d+$/i.test(id)) return `Publicación ${id.toUpperCase()}`;
    const opt = mlVariations.find((m) => String(m.variationId) === id);
    return opt ? formatOptionLabel(opt) : `Variación ${id}`;
  };

  const resolveTnLabel = (value?: string) => {
    const id = (value || '').trim();
    if (!id) return null;
    const opt = tnVariants.find((t) => String(t.variantId) === id);
    return opt ? formatOptionLabel(opt) : `Variante ${id}`;
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
      <div className="flex flex-1 flex-col items-center justify-center min-h-[40vh] gap-3">
        <Loader2 size={36} className="text-indigo-400 animate-spin" />
        <p className="text-sm text-slate-400">Cargando variantes del artículo…</p>
      </div>
    );
  }

  const steps = [
    { n: 1, label: 'Cargar publicaciones', active: currentStep === 1, done: catalogsLoaded },
    { n: 2, label: 'Revisar emparejamientos', active: currentStep === 2, done: linkStats.ml > 0 || linkStats.tn > 0 },
    { n: 3, label: 'Guardar', active: false, done: false },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden gap-4">
      {/* Header */}
      <header className="shrink-0 flex flex-wrap items-start gap-4 pb-1">
        <button
          type="button"
          onClick={goBack}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800/80 text-sm font-medium transition-colors"
        >
          <ArrowLeft size={18} />
          Inventario
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2.5">
            <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30">
              <Link size={18} className="text-indigo-400" />
            </span>
            Vincular grupo con ML y TN
          </h1>
          <p className="text-sm text-slate-400 mt-1 truncate">
            <span className="text-slate-200">{productName}</span>
            <span className="mx-2 text-slate-600">·</span>
            <span className="font-mono text-slate-300">{groupKey}</span>
            <span className="mx-2 text-slate-600">·</span>
            <span>{linkStats.total} variantes</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('stock_history')}
          className="shrink-0 px-3 py-2 rounded-xl bg-slate-800 hover:bg-violet-600/80 border border-slate-700 text-slate-300 hover:text-white text-sm font-medium flex items-center gap-2 transition-colors"
        >
          <History size={16} />
          Historial
        </button>
      </header>

      {/* Pasos */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 sm:gap-0">
        {steps.map((step, i) => (
          <React.Fragment key={step.n}>
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                step.active
                  ? 'bg-indigo-600/25 text-indigo-200 border border-indigo-500/40'
                  : step.done
                    ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-700/40'
                    : 'bg-slate-800/60 text-slate-500 border border-slate-700/60'
              }`}
            >
              <span
                className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-black ${
                  step.done ? 'bg-emerald-600 text-white' : step.active ? 'bg-indigo-500 text-white' : 'bg-slate-700 text-slate-400'
                }`}
              >
                {step.done ? '✓' : step.n}
              </span>
              {step.label}
            </div>
            {i < steps.length - 1 && (
              <div className="hidden sm:block w-8 h-px bg-slate-700 mx-1" aria-hidden />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Paso 1: cargar publicaciones */}
      <section className="shrink-0 rounded-2xl border border-slate-700/80 bg-slate-800/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700/60 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-white">Paso 1 · Publicaciones externas</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Pegá el link o ID. El sistema empareja por <strong className="text-slate-300">SKU</strong> y, si no
              coincide, por <strong className="text-slate-300">talle y color</strong>.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowMlTip((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-amber-300/90 hover:text-amber-200 px-2 py-1 rounded-lg hover:bg-amber-950/30 transition-colors"
          >
            <HelpCircle size={14} />
            {showMlTip ? 'Ocultar ayuda' : '¿Publicaciones ML separadas?'}
          </button>
        </div>

        {showMlTip && (
          <div className="mx-4 mt-3 mb-1 text-xs text-amber-100/90 bg-amber-950/30 border border-amber-700/40 rounded-xl px-3 py-2.5 leading-relaxed">
            Si cada variante es una publicación ML distinta (sin ID padre compartido), dejá vacío el campo ML de
            arriba y escribí el MLA completo en cada fila de la tabla.
          </div>
        )}

        <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ML card */}
          <div className="rounded-xl border border-amber-700/40 bg-amber-950/15 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500/20">
                  <Zap size={16} className="text-amber-400" />
                </span>
                <div>
                  <p className="text-sm font-bold text-amber-100">Mercado Libre</p>
                  <p className="text-[11px] text-amber-200/60">Publicación padre (opcional)</p>
                </div>
              </div>
              {mlVariations.length > 0 ? (
                <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-600/30">
                  {mlVariations.length} variaciones
                </span>
              ) : (
                <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-slate-700/60 text-slate-400">
                  Sin cargar
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={mlId}
                onChange={(e) => setMlId(e.target.value)}
                placeholder="Link o MLA…"
                className="flex-1 min-w-0 bg-slate-900/60 border border-amber-800/50 rounded-lg px-3 py-2.5 text-white font-mono text-sm outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30"
              />
              <button
                type="button"
                onClick={handleLoadMl}
                disabled={!mlId.trim() || loading}
                className="shrink-0 px-4 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-1.5 transition-colors"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                Cargar
              </button>
            </div>
          </div>

          {/* TN card */}
          <div className="rounded-xl border border-cyan-700/40 bg-cyan-950/15 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-cyan-500/20">
                  <Cloud size={16} className="text-cyan-400" />
                </span>
                <div>
                  <p className="text-sm font-bold text-cyan-100">Tienda Nube</p>
                  <p className="text-[11px] text-cyan-200/60">Producto padre</p>
                </div>
              </div>
              {tnVariants.length > 0 ? (
                <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-600/30">
                  {tnVariants.length} variantes
                </span>
              ) : (
                <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-slate-700/60 text-slate-400">
                  Sin cargar
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={tnId}
                onChange={(e) => setTnId(e.target.value)}
                placeholder="Link o número de producto"
                className="flex-1 min-w-0 bg-slate-900/60 border border-cyan-800/50 rounded-lg px-3 py-2.5 text-white font-mono text-sm outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30"
              />
              <button
                type="button"
                onClick={handleLoadTn}
                disabled={!tnId.trim() || loading}
                className="shrink-0 px-4 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-1.5 transition-colors"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                Cargar
              </button>
            </div>
          </div>
        </div>

        <div className="px-4 pb-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleLoadBoth}
            disabled={!mlId.trim() || !tnId.trim() || loading || variants.length === 0}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-indigo-900/30 transition-colors"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            Cargar ambos y emparejar
          </button>
          {catalogsLoaded && (
            <button
              type="button"
              onClick={() => runAutoMatch(variants, mlVariations, tnVariants)}
              className="text-sm text-indigo-400 hover:text-indigo-300 font-medium px-2 py-1 rounded-lg hover:bg-indigo-950/40 transition-colors"
            >
              Volver a emparejar automáticamente
            </button>
          )}
          {loading && (
            <span className="text-xs text-slate-500 flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" />
              Consultando APIs…
            </span>
          )}
        </div>
      </section>

      {/* Progreso + tabla */}
      <section className="flex-1 min-h-0 flex flex-col rounded-2xl border border-slate-700/80 bg-slate-900/30 overflow-hidden">
        <div className="shrink-0 px-4 py-3 border-b border-slate-700/60 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-white">Paso 2 · Emparejar variantes</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Revisá cada fila. Podés editar SKU, elegir de la lista o pegar IDs manualmente.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="px-2 py-1 rounded-lg bg-amber-950/40 text-amber-300 border border-amber-800/40 font-semibold">
                ML {linkStats.ml}/{linkStats.total}
              </span>
              <span className="px-2 py-1 rounded-lg bg-cyan-950/40 text-cyan-300 border border-cyan-800/40 font-semibold">
                TN {linkStats.tn}/{linkStats.total}
              </span>
              <span className="px-2 py-1 rounded-lg bg-emerald-950/40 text-emerald-300 border border-emerald-800/40 font-semibold">
                Completas {linkStats.both}/{linkStats.total}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-emerald-500 transition-all duration-500"
                style={{ width: `${linkStats.progress}%` }}
              />
            </div>
            <span className="text-xs font-mono text-slate-400 w-10 text-right">{linkStats.progress}%</span>
          </div>
          {catalogsLoaded && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                <input
                  type="text"
                  value={mlSearch}
                  onChange={(e) => setMlSearch(e.target.value)}
                  placeholder={`Filtrar opciones ML (${mlVariations.length})`}
                  className="w-full bg-slate-800/80 border border-slate-600/80 rounded-lg pl-8 pr-3 py-2 text-white text-xs outline-none focus:border-amber-500/60"
                />
              </div>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                <input
                  type="text"
                  value={tnSearch}
                  onChange={(e) => setTnSearch(e.target.value)}
                  placeholder={`Filtrar opciones TN (${tnVariants.length})`}
                  className="w-full bg-slate-800/80 border border-slate-600/80 rounded-lg pl-8 pr-3 py-2 text-white text-xs outline-none focus:border-cyan-500/60"
                />
              </div>
            </div>
          )}
        </div>

        {variants.length === 0 ? (
          <p className="text-slate-500 text-center py-16 text-sm">Este artículo no tiene variantes.</p>
        ) : (
          <div className="flex-1 min-h-0 overflow-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="sticky top-0 z-10 bg-slate-800/95 backdrop-blur-sm">
                <tr className="border-b border-slate-700/80">
                  <th className="text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider p-3 w-8" />
                  <th className="text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider p-3">
                    Mi variante
                  </th>
                  <th className="text-left text-[11px] font-bold text-amber-400/90 uppercase tracking-wider p-3">
                    Mercado Libre
                  </th>
                  <th className="text-left text-[11px] font-bold text-cyan-400/90 uppercase tracking-wider p-3">
                    Tienda Nube
                  </th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v) => {
                  const mlVal = assignments[v.variantId]?.ml ?? '';
                  const tnVal = assignments[v.variantId]?.tn ?? '';
                  const status = getRowLinkStatus(mlVal, tnVal);
                  const mlLabel = resolveMlLabel(mlVal);
                  const tnLabel = resolveTnLabel(tnVal);

                  return (
                    <tr
                      key={v.variantId}
                      className={`border-b border-slate-700/40 transition-colors hover:bg-slate-800/40 ${
                        status === 'complete'
                          ? 'bg-emerald-950/10'
                          : status === 'partial'
                            ? 'bg-amber-950/10'
                            : ''
                      }`}
                    >
                      <td className="p-3 align-top">
                        {status === 'complete' ? (
                          <CheckCircle2 size={18} className="text-emerald-400" title="ML y TN vinculados" />
                        ) : status === 'partial' ? (
                          <AlertCircle size={18} className="text-amber-400" title="Falta ML o TN" />
                        ) : (
                          <Circle size={18} className="text-slate-600" title="Sin vincular" />
                        )}
                      </td>
                      <td className="p-3 align-top min-w-[180px]">
                        <div className="space-y-1.5">
                          <input
                            type="text"
                            value={skuEdits[v.variantId] ?? v.sku ?? ''}
                            onChange={(e) => setSkuEdits((prev) => ({ ...prev, [v.variantId]: e.target.value }))}
                            className="w-full bg-slate-800/80 border border-slate-600 rounded-lg px-2.5 py-2 text-blue-200 text-xs font-mono outline-none focus:border-indigo-500/60"
                            title="SKU (editable para mejorar el emparejamiento)"
                          />
                          <p className="text-xs text-slate-400 pl-0.5">
                            <span className="text-slate-300 font-medium">{formatSizeForLink(v.size)}</span>
                            <span className="text-slate-600 mx-1">·</span>
                            {v.color}
                          </p>
                        </div>
                      </td>
                      <td className="p-3 align-top min-w-[220px]">
                        <div className="space-y-1.5">
                          <input
                            type="text"
                            value={mlVal}
                            onChange={(e) =>
                              setAssignments((prev) => ({
                                ...prev,
                                [v.variantId]: { ...prev[v.variantId], ml: e.target.value.trim() },
                              }))
                            }
                            placeholder={mlVariations.length > 0 ? 'ID variación o MLA' : 'MLA o variación'}
                            className="w-full bg-slate-800/80 border border-amber-800/40 rounded-lg px-2.5 py-2 text-white text-xs font-mono outline-none focus:border-amber-500/70"
                          />
                          {mlLabel && (
                            <p className="text-[10px] text-amber-200/70 truncate pl-0.5" title={mlLabel}>
                              ↳ {mlLabel}
                            </p>
                          )}
                          {mlVariations.length > 0 ? (
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
                              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-slate-300 text-xs outline-none focus:border-amber-500/60"
                            >
                              <option value="">Elegir de ML cargado…</option>
                              {filteredMl.map((m) => (
                                <option key={String(m.variationId)} value={String(m.variationId)}>
                                  {formatOptionLabel(m)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            !mlVal && (
                              <p className="text-[10px] text-slate-500 pl-0.5">Cargá ML arriba o pegá un MLA</p>
                            )
                          )}
                        </div>
                      </td>
                      <td className="p-3 align-top min-w-[220px]">
                        <div className="space-y-1.5">
                          {tnVariants.length > 0 ? (
                            <select
                              value={tnVal}
                              onChange={(e) => {
                                const tnValNew = e.target.value;
                                const tnOpt = tnVariants.find((t) => String(t.variantId) === tnValNew);
                                const mlMatch =
                                  tnOpt && mlVariations.find((m) => bulkLinkSkuMatch(tnOpt.sku, m.sku));
                                setAssignments((prev) => ({
                                  ...prev,
                                  [v.variantId]: {
                                    ml: mlMatch ? String(mlMatch.variationId) : prev[v.variantId]?.ml ?? '',
                                    tn: tnValNew,
                                  },
                                }));
                              }}
                              className="w-full bg-slate-800/80 border border-cyan-800/40 rounded-lg px-2.5 py-2 text-white text-xs outline-none focus:border-cyan-500/70"
                            >
                              <option value="">Elegir variante TN…</option>
                              {getVisibleTnOptions(tnVal).map((t) => (
                                <option key={String(t.variantId)} value={String(t.variantId)}>
                                  {formatOptionLabel(t)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <div className="rounded-lg border border-dashed border-slate-600 bg-slate-800/40 px-2.5 py-2 text-[11px] text-slate-500">
                              Cargá Tienda Nube arriba para ver opciones
                            </div>
                          )}
                          {tnLabel && tnVal && (
                            <p className="text-[10px] text-cyan-200/70 truncate pl-0.5" title={tnLabel}>
                              ↳ {tnLabel}
                            </p>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="shrink-0 flex flex-col sm:flex-row sm:items-center gap-3 pt-1 border-t border-slate-700/60">
        <div className="flex-1 text-xs text-slate-400">
          {linkStats.ml + linkStats.tn > 0 ? (
            <>
              <span className="text-slate-300 font-medium">{linkStats.ml + linkStats.tn}</span> vínculos listos
              {linkStats.both < linkStats.total && (
                <span className="text-amber-400/90 ml-1">
                  · faltan {linkStats.total - linkStats.both} variantes sin ML+TN completos
                </span>
              )}
            </>
          ) : (
            'Cargá las publicaciones y emparejá al menos una variante para guardar.'
          )}
        </div>
        <div className="flex gap-2 sm:justify-end">
          <button
            type="button"
            onClick={goBack}
            className="px-5 py-2.5 rounded-xl font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-sm transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !productId || variants.length === 0}
            className="px-6 py-2.5 rounded-xl font-bold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 text-sm shadow-lg shadow-indigo-900/25 flex items-center justify-center gap-2 min-w-[180px] transition-colors"
          >
            {saving ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Guardando…
              </>
            ) : (
              <>
                <CheckCircle2 size={16} />
                Guardar vinculaciones
              </>
            )}
          </button>
        </div>
      </footer>
    </div>
  );
};

export default BulkLinkGroupPage;
