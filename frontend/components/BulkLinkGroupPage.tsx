import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  ChevronDown,
  ChevronUp,
  Layers,
  Plus,
  Trash2,
} from 'lucide-react';
import { api } from '../services/api';
import VariantExtraPublicationsPanel from './VariantExtraPublicationsPanel';
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

type PublicationSource = {
  id: string;
  variationCount?: number;
  loadError?: string;
};

type MlVariationRow = {
  itemId: string;
  variationId: string;
  sku: string;
  color: string;
  size: string;
};

type TnVariantRow = {
  productId: string;
  variantId: string;
  sku: string;
  color: string;
  size: string;
};

type VariantAssignment = {
  ml?: string;
  mlItemId?: string;
  tn?: string;
  tnProductId?: string;
};

function parseIdsFromInput(raw: string, platform: 'ml' | 'tn'): string[] {
  const parts = raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    const id =
      platform === 'ml' ? normalizeMercadoLibreItemId(part) : normalizeTiendaNubeProductId(part);
    if (!id) continue;
    if (platform === 'tn' && !/^\d+$/.test(id)) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function matchLocalToRow(
  local: { sku: string; size: string; color: string },
  row: { sku?: string; size?: string; color?: string }
): boolean {
  const skuN = norm(local.sku);
  if (skuN && row.sku && norm(row.sku) === skuN) return true;
  return norm(row.size || '') === norm(local.size) && norm(row.color || '') === norm(local.color);
}

function mlOptionKey(row: MlVariationRow): string {
  return `${row.itemId}::${row.variationId}`;
}

function tnOptionKey(row: TnVariantRow): string {
  return `${row.productId}::${row.variantId}`;
}

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
  const [mlSources, setMlSources] = useState<PublicationSource[]>([]);
  const [tnSources, setTnSources] = useState<PublicationSource[]>([]);
  const [mlDraft, setMlDraft] = useState('');
  const [tnDraft, setTnDraft] = useState('');
  const [mlVariations, setMlVariations] = useState<MlVariationRow[]>([]);
  const [tnVariants, setTnVariants] = useState<TnVariantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState<Record<string, VariantAssignment>>({});
  const [skuEdits, setSkuEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [mlSearch, setMlSearch] = useState('');
  const [tnSearch, setTnSearch] = useState('');
  const [showMlTip, setShowMlTip] = useState(false);
  const [step1Expanded, setStep1Expanded] = useState(true);
  const autoCollapsedStep1Ref = useRef(false);
  const [packMl, setPackMl] = useState(1);
  const [packTn, setPackTn] = useState(1);
  const [expandedExtraVariantId, setExpandedExtraVariantId] = useState<string | null>(null);
  const [pubCounts, setPubCounts] = useState<Record<string, number>>({});

  const goBack = () => onNavigate('inventory');

  const runAutoMatch = (
    localVariants: typeof variants,
    mlList: MlVariationRow[],
    tnList: TnVariantRow[],
    current?: Record<string, VariantAssignment>
  ): Record<string, VariantAssignment> => {
    const prev = current ?? assignments;
    const next: Record<string, VariantAssignment> = { ...prev };
    localVariants.forEach((local) => {
      const skuN = norm(local.sku);
      const sizeN = norm(local.size);
      const colorN = norm(local.color);
      if (!next[local.variantId]) next[local.variantId] = { ml: '', tn: '' };
      if (!next[local.variantId].ml && mlList.length > 0) {
        let match = skuN ? mlList.find((m) => norm(m.sku) === skuN) : null;
        if (!match) match = mlList.find((m) => norm(m.size) === sizeN && norm(m.color) === colorN);
        if (match) {
          next[local.variantId].ml = match.variationId;
          next[local.variantId].mlItemId = match.itemId;
        } else if (mlList.length === 1) {
          next[local.variantId].ml = mlList[0].variationId;
          next[local.variantId].mlItemId = mlList[0].itemId;
        }
      }
      if (!next[local.variantId].tn && tnList.length > 0) {
        let match = skuN ? tnList.find((t) => norm(t.sku) === skuN) : null;
        if (!match) match = tnList.find((t) => norm(t.size) === sizeN && norm(t.color) === colorN);
        if (match) {
          next[local.variantId].tn = match.variantId;
          next[local.variantId].tnProductId = match.productId;
        } else if (tnList.length === 1) {
          next[local.variantId].tn = tnList[0].variantId;
          next[local.variantId].tnProductId = tnList[0].productId;
        }
      }
    });
    setAssignments(next);
    return next;
  };

  const optionMatch = (
    query: string,
    item: {
      sku?: string;
      size?: string;
      color?: string;
      itemId?: string;
      productId?: string;
      variationId?: string;
      variantId?: string;
    }
  ) => {
    const q = norm(query);
    if (!q) return true;
    const id = item.variationId ?? item.variantId ?? item.itemId ?? item.productId ?? '';
    const text = [
      item.sku || '',
      formatSizeForLink(item.size),
      item.color || '',
      item.itemId || '',
      item.productId || '',
      String(id),
    ].join(' ');
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

  useEffect(() => {
    if (loading || autoCollapsedStep1Ref.current) return;
    const hasLinks = variants.some((v) => {
      const a = assignments[v.variantId];
      return !!(a?.ml?.trim() || a?.tn?.trim());
    });
    if (catalogsLoaded || hasLinks) {
      autoCollapsedStep1Ref.current = true;
      setStep1Expanded(false);
    }
  }, [loading, variants, assignments, catalogsLoaded]);

  const getVisibleTnOptions = (selectedValue?: string, selectedProductId?: string) => {
    const selected = (selectedValue || '').trim();
    const base = filteredTn.length > 0 ? filteredTn : tnVariants;
    if (!selected) return base;
    if (
      base.some(
        (t) => String(t.variantId) === selected && (!selectedProductId || t.productId === selectedProductId)
      )
    ) {
      return base;
    }
    const opt = tnVariants.find(
      (t) => String(t.variantId) === selected && (!selectedProductId || t.productId === selectedProductId)
    );
    return opt ? [opt, ...base] : base;
  };

  const resolveMlLabel = (variantId: string) => {
    const a = assignments[variantId];
    const value = (a?.ml || '').trim();
    if (!value) return null;
    if (/^ML[A-Z]{1,5}\d+$/i.test(value)) return `Publicación ${value.toUpperCase()}`;
    const opt = mlVariations.find(
      (m) =>
        m.variationId === value && (!a?.mlItemId || m.itemId === a.mlItemId)
    );
    if (opt) return `${opt.itemId} · ${formatOptionLabel(opt)}`;
    return a?.mlItemId ? `${a.mlItemId} / ${value}` : `Variación ${value}`;
  };

  const resolveTnLabel = (variantId: string) => {
    const a = assignments[variantId];
    const value = (a?.tn || '').trim();
    if (!value) return null;
    const opt = tnVariants.find(
      (t) => t.variantId === value && (!a?.tnProductId || t.productId === a.tnProductId)
    );
    if (opt) return `${opt.productId} · ${formatOptionLabel(opt)}`;
    return a?.tnProductId ? `${a.tnProductId} / ${value}` : `Variante ${value}`;
  };

  const refreshPublicationCount = useCallback((variantId: string, count: number) => {
    setPubCounts((prev) => ({ ...prev, [variantId]: count }));
  }, []);

  useEffect(() => {
    if (variants.length === 0) return;
    let cancelled = false;
    Promise.all(
      variants.map(async (v) => {
        try {
          const pubs = await api.getVariantPublications(v.variantId);
          return [v.variantId, pubs.length] as const;
        } catch {
          return [v.variantId, 0] as const;
        }
      })
    ).then((entries) => {
      if (!cancelled) setPubCounts(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [variants]);

  useEffect(() => {
    if (!groupKey) return;
    setLoading(true);
    api
      .getProductBySku(groupKey, INVENTORY_PRODUCT_FETCH_OPTS)
      .then(async (p: any) => {
        if (!p) {
          showToast('error', 'Artículo no encontrado');
          goBack();
          return;
        }
        setProductId(p.id);
        setProductName(p.name || groupKey);
        setPackMl(p.mercado_libre_pack_size ?? 1);
        setPackTn(p.tienda_nube_pack_size ?? 1);
        const mlSet = new Set<string>();
        const tnSet = new Set<string>();
        const parentMl = normalizeMercadoLibreItemId(p.externalIds?.mercadoLibre || '');
        const parentTn = normalizeTiendaNubeProductId(p.externalIds?.tiendaNube || '');
        if (parentMl) mlSet.add(parentMl);
        if (parentTn && /^\d+$/.test(parentTn)) tnSet.add(parentTn);
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
        const pubResults = await Promise.all(
          list.map((v: { variantId: string }) =>
            api.getVariantPublications(v.variantId).catch(() => [] as Array<{ platform: string; external_product_id: string }>)
          )
        );
        pubResults.flat().forEach((pub) => {
          if (pub.platform === 'mercadolibre' && pub.external_product_id) {
            mlSet.add(pub.external_product_id);
          }
          if (pub.platform === 'tiendanube' && pub.external_product_id) {
            tnSet.add(pub.external_product_id);
          }
        });
        setMlSources([...mlSet].map((id) => ({ id })));
        setTnSources([...tnSet].map((id) => ({ id })));
        const nextAssign: Record<string, VariantAssignment> = {};
        list.forEach((v: any) => {
          const mlVal =
            v.externalIds?.mercadoLibreVariant != null &&
            String(v.externalIds.mercadoLibreVariant).trim() !== ''
              ? String(v.externalIds.mercadoLibreVariant).trim()
              : v.externalIds?.mercadoLibreItemId != null &&
                  String(v.externalIds.mercadoLibreItemId).trim() !== ''
                ? String(v.externalIds.mercadoLibreItemId).trim()
                : '';
          const mlItemId =
            mlVal && /^ML[A-Z]{1,5}\d+$/i.test(mlVal)
              ? undefined
              : parentMl || undefined;
          nextAssign[v.variantId] = {
            ml: mlVal,
            mlItemId,
            tn: v.externalIds?.tiendaNubeVariant ? String(v.externalIds.tiendaNubeVariant) : '',
            tnProductId: parentTn || undefined,
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

  const appendMlSources = (raw: string) => {
    const ids = parseIdsFromInput(raw, 'ml');
    if (ids.length === 0) {
      showToast('error', 'No se pudo obtener ningún ID de ML');
      return false;
    }
    setMlSources((prev) => {
      const seen = new Set(prev.map((s) => s.id));
      const next = [...prev];
      ids.forEach((id) => {
        if (!seen.has(id)) {
          seen.add(id);
          next.push({ id });
        }
      });
      return next;
    });
    return true;
  };

  const appendTnSources = (raw: string) => {
    const ids = parseIdsFromInput(raw, 'tn');
    if (ids.length === 0) {
      showToast('error', 'No se pudo obtener ningún ID de TN');
      return false;
    }
    setTnSources((prev) => {
      const seen = new Set(prev.map((s) => s.id));
      const next = [...prev];
      ids.forEach((id) => {
        if (!seen.has(id)) {
          seen.add(id);
          next.push({ id });
        }
      });
      return next;
    });
    return true;
  };

  const fetchMlCatalogRows = async (sources: PublicationSource[]) => {
    const allRows: MlVariationRow[] = [];
    const nextSources = await Promise.all(
      sources.map(async (src) => {
        try {
          const res = await api.getMercadoLibreItemVariations(src.id);
          const rows = (res.variations || []).map((v) => ({
            itemId: src.id,
            variationId: String(v.variationId),
            sku: v.sku,
            color: v.color,
            size: v.size,
          }));
          allRows.push(...rows);
          return { ...src, variationCount: rows.length, loadError: undefined };
        } catch (e: any) {
          return { ...src, loadError: e?.message || 'Error al cargar' };
        }
      })
    );
    setMlSources(nextSources);
    setMlVariations(allRows);
    return { rows: allRows, sources: nextSources };
  };

  const fetchTnCatalogRows = async (sources: PublicationSource[]) => {
    const allRows: TnVariantRow[] = [];
    const nextSources = await Promise.all(
      sources.map(async (src) => {
        try {
          const res = await api.getTiendaNubeProductVariants(src.id);
          const rows = (res.variants || []).map((v) => ({
            productId: src.id,
            variantId: String(v.variantId),
            sku: v.sku,
            color: v.color,
            size: v.size,
          }));
          allRows.push(...rows);
          return { ...src, variationCount: rows.length, loadError: undefined };
        } catch (e: any) {
          return { ...src, loadError: e?.message || 'Error al cargar' };
        }
      })
    );
    setTnSources(nextSources);
    setTnVariants(allRows);
    return { rows: allRows, sources: nextSources };
  };

  const handleLoadAllMl = async () => {
    if (mlSources.length === 0) {
      showToast('info', 'Agregá al menos una publicación ML.');
      return;
    }
    setLoading(true);
    const { rows: mlList } = await fetchMlCatalogRows(mlSources);
    runAutoMatch(variants, mlList, tnVariants);
    setLoading(false);
    showToast('success', `Cargadas ${mlList.length} variaciones de ${mlSources.length} publicación(es) ML.`);
  };

  const handleLoadAllTn = async () => {
    if (tnSources.length === 0) {
      showToast('info', 'Agregá al menos un producto TN.');
      return;
    }
    setLoading(true);
    const { rows: tnList } = await fetchTnCatalogRows(tnSources);
    runAutoMatch(variants, mlVariations, tnList);
    setLoading(false);
    showToast('success', `Cargadas ${tnList.length} variantes de ${tnSources.length} producto(s) TN.`);
  };

  const handleLoadAllAndMatch = async () => {
    if (mlSources.length === 0 && tnSources.length === 0) {
      showToast('info', 'Agregá publicaciones ML y/o TN en el paso 1.');
      return;
    }
    setLoading(true);
    const [mlResult, tnResult] = await Promise.all([
      mlSources.length > 0 ? fetchMlCatalogRows(mlSources) : Promise.resolve({ rows: [] as MlVariationRow[], sources: [] as PublicationSource[] }),
      tnSources.length > 0 ? fetchTnCatalogRows(tnSources) : Promise.resolve({ rows: [] as TnVariantRow[], sources: [] as PublicationSource[] }),
    ]);
    const next = runAutoMatch(variants, mlResult.rows, tnResult.rows);
    setLoading(false);
    const errors: string[] = [];
    [...mlResult.sources, ...tnResult.sources].forEach((s) => {
      if (s.loadError) errors.push(`${s.id}: ${s.loadError}`);
    });
    if (errors.length) showToast('error', errors.join(' '));
    else {
      const linked = Object.values(next).filter((a) => a.ml?.trim() || a.tn?.trim()).length;
      showToast(
        'success',
        linked > 0
          ? `Emparejadas ${linked} variantes desde ${mlSources.length} ML y ${tnSources.length} TN.`
          : 'Listas cargadas; no hubo emparejamiento automático.'
      );
    }
  };

  const syncAllSourcePublications = async () => {
    let added = 0;
    for (const v of variants) {
      const local = {
        sku: (skuEdits[v.variantId] ?? v.sku ?? '').toString(),
        size: v.size,
        color: v.color,
      };
      for (const row of mlVariations) {
        if (!matchLocalToRow(local, row)) continue;
        try {
          await api.addVariantPublication(v.variantId, {
            platform: 'mercadolibre',
            externalProductId: row.itemId,
            externalVariantId: row.variationId,
            packSize: packMl,
          });
          added++;
        } catch {
          /* ya vinculada */
        }
      }
      for (const row of tnVariants) {
        if (!matchLocalToRow(local, row)) continue;
        try {
          await api.addVariantPublication(v.variantId, {
            platform: 'tiendanube',
            externalProductId: row.productId,
            externalVariantId: row.variantId,
            packSize: packTn,
          });
          added++;
        } catch {
          /* ya vinculada */
        }
      }
    }
    return added;
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
          const a = assignments[v.variantId];
          const ml = a?.ml?.trim() || '';
          const tn = a?.tn?.trim() || '';
          const isMlItemId = /^ML[A-Z]{1,5}\d+$/i.test(ml);
          return {
            variantId: String(v.variantId),
            mercadoLibreVariantId: !isMlItemId && ml ? ml : undefined,
            mercadoLibreItemId: isMlItemId ? ml : a?.mlItemId?.trim() || undefined,
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
      const primaryMl = mlSources[0]?.id;
      const primaryTn = tnSources[0]?.id;
      const res = await api.bulkLinkVariants({
        productId,
        mercadoLibreItemId: allMlOwn ? undefined : primaryMl || undefined,
        tiendaNubeProductId: primaryTn && /^\d+$/.test(primaryTn) ? primaryTn : undefined,
        links,
      });
      const extraPubs = await syncAllSourcePublications();
      const updated = (res as any)?.updated ?? links.length;
      const synced = (res as any)?.synced ?? 0;
      onImportComplete?.();
      showToast(
        'success',
        synced > 0
          ? `Guardadas ${updated} vinculación(es). Stock enviado a ${synced} variante(s).${extraPubs > 0 ? ` ${extraPubs} publicación(es) extra sincronizadas.` : ''}`
          : `Guardadas ${updated} vinculación(es).${extraPubs > 0 ? ` ${extraPubs} publicación(es) extra sincronizadas.` : ''}`
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
      <div className="flex flex-col items-center justify-center py-20 gap-3">
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
    <div className="flex flex-col gap-4 pb-24 md:pb-8 w-full">
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
        {!step1Expanded ? (
          <button
            type="button"
            onClick={() => setStep1Expanded(true)}
            className="w-full px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-left hover:bg-slate-800/60 transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              {catalogsLoaded ? (
                <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
              ) : (
                <Circle size={16} className="text-slate-500 shrink-0" />
              )}
              <span className="text-sm font-semibold text-slate-200">Paso 1 · Publicaciones a sincronizar</span>
              <span className="text-xs text-slate-500 truncate hidden sm:inline">
                {mlSources.length} publicación{mlSources.length === 1 ? '' : 'es'} ML
                {tnSources.length > 0 ? ` · ${tnSources.length} TN` : ''}
              </span>
            </div>
            <span className="text-xs text-indigo-400 font-medium flex items-center gap-1 shrink-0">
              Mostrar <ChevronDown size={14} />
            </span>
          </button>
        ) : (
          <>
        <div className="px-4 py-3 border-b border-slate-700/60 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-white">Paso 1 · Publicaciones a sincronizar</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Agregá todas las publicaciones ML y productos TN de este artículo. Al guardar, el stock se sincroniza
              en cada una según el emparejamiento por <strong className="text-slate-300">SKU</strong> o{' '}
              <strong className="text-slate-300">talle y color</strong>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStep1Expanded(false)}
              className="flex items-center gap-1 text-xs text-slate-300 hover:text-white px-2.5 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 border border-slate-600 transition-colors"
            >
              Ocultar <ChevronUp size={14} />
            </button>
            <button
              type="button"
              onClick={() => setShowMlTip((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-amber-300/90 hover:text-amber-200 px-2 py-1 rounded-lg hover:bg-amber-950/30 transition-colors"
            >
              <HelpCircle size={14} />
              {showMlTip ? 'Ocultar ayuda' : '¿Publicaciones ML separadas?'}
            </button>
          </div>
        </div>

        {showMlTip && (
          <div className="mx-4 mt-3 mb-1 text-xs text-amber-100/90 bg-amber-950/30 border border-amber-700/40 rounded-xl px-3 py-2.5 leading-relaxed">
            Podés agregar varias publicaciones ML (pack x2, catálogo, publicación por color, etc.) y varios productos TN.
            Si una variante es una publicación ML propia, escribí el MLA completo en la fila del paso 2.
          </div>
        )}

        <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ML sources */}
          <div className="rounded-xl border border-amber-700/40 bg-amber-950/15 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500/20">
                  <Zap size={16} className="text-amber-400" />
                </span>
                <div>
                  <p className="text-sm font-bold text-amber-100">Mercado Libre</p>
                  <p className="text-[11px] text-amber-200/60">{mlSources.length} publicación(es)</p>
                </div>
              </div>
              {mlVariations.length > 0 && (
                <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-600/30">
                  {mlVariations.length} variaciones
                </span>
              )}
            </div>
            <div className="space-y-2 max-h-[160px] overflow-y-auto">
              {mlSources.length === 0 ? (
                <p className="text-xs text-slate-500 py-2 text-center border border-dashed border-amber-800/40 rounded-lg">
                  Sin publicaciones ML
                </p>
              ) : (
                mlSources.map((src) => (
                  <div
                    key={src.id}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-slate-900/50 border border-amber-800/30"
                  >
                    <span className="flex-1 min-w-0 font-mono text-xs text-amber-100 truncate">{src.id}</span>
                    {src.variationCount != null && (
                      <span className="text-[10px] text-emerald-400 shrink-0">{src.variationCount} var.</span>
                    )}
                    {src.loadError && (
                      <span className="text-[10px] text-red-400 shrink-0" title={src.loadError}>
                        Error
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setMlSources((prev) => prev.filter((s) => s.id !== src.id))}
                      className="p-1 text-slate-500 hover:text-red-400 shrink-0"
                      aria-label="Quitar"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={mlDraft}
                onChange={(e) => setMlDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && mlDraft.trim()) {
                    e.preventDefault();
                    if (appendMlSources(mlDraft)) setMlDraft('');
                  }
                }}
                placeholder="Link o MLA… (varios separados por coma o Enter)"
                className="flex-1 min-w-0 bg-slate-900/60 border border-amber-800/50 rounded-lg px-3 py-2 text-white font-mono text-xs outline-none focus:border-amber-500"
              />
              <button
                type="button"
                onClick={() => {
                  if (appendMlSources(mlDraft)) setMlDraft('');
                }}
                disabled={!mlDraft.trim()}
                className="shrink-0 px-3 py-2 rounded-lg bg-amber-700 hover:bg-amber-600 text-white text-xs font-bold disabled:opacity-50"
              >
                <Plus size={14} />
              </button>
            </div>
            <button
              type="button"
              onClick={handleLoadAllMl}
              disabled={mlSources.length === 0 || loading}
              className="w-full px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              Cargar todas ML
            </button>
          </div>

          {/* TN sources */}
          <div className="rounded-xl border border-cyan-700/40 bg-cyan-950/15 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-cyan-500/20">
                  <Cloud size={16} className="text-cyan-400" />
                </span>
                <div>
                  <p className="text-sm font-bold text-cyan-100">Tienda Nube</p>
                  <p className="text-[11px] text-cyan-200/60">{tnSources.length} producto(s)</p>
                </div>
              </div>
              {tnVariants.length > 0 && (
                <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-600/30">
                  {tnVariants.length} variantes
                </span>
              )}
            </div>
            <div className="space-y-2 max-h-[160px] overflow-y-auto">
              {tnSources.length === 0 ? (
                <p className="text-xs text-slate-500 py-2 text-center border border-dashed border-cyan-800/40 rounded-lg">
                  Sin productos TN
                </p>
              ) : (
                tnSources.map((src) => (
                  <div
                    key={src.id}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-slate-900/50 border border-cyan-800/30"
                  >
                    <span className="flex-1 min-w-0 font-mono text-xs text-cyan-100 truncate">{src.id}</span>
                    {src.variationCount != null && (
                      <span className="text-[10px] text-emerald-400 shrink-0">{src.variationCount} var.</span>
                    )}
                    {src.loadError && (
                      <span className="text-[10px] text-red-400 shrink-0" title={src.loadError}>
                        Error
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setTnSources((prev) => prev.filter((s) => s.id !== src.id))}
                      className="p-1 text-slate-500 hover:text-red-400 shrink-0"
                      aria-label="Quitar"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={tnDraft}
                onChange={(e) => setTnDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && tnDraft.trim()) {
                    e.preventDefault();
                    if (appendTnSources(tnDraft)) setTnDraft('');
                  }
                }}
                placeholder="Link o ID TN… (varios separados por coma)"
                className="flex-1 min-w-0 bg-slate-900/60 border border-cyan-800/50 rounded-lg px-3 py-2 text-white font-mono text-xs outline-none focus:border-cyan-500"
              />
              <button
                type="button"
                onClick={() => {
                  if (appendTnSources(tnDraft)) setTnDraft('');
                }}
                disabled={!tnDraft.trim()}
                className="shrink-0 px-3 py-2 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-bold disabled:opacity-50"
              >
                <Plus size={14} />
              </button>
            </div>
            <button
              type="button"
              onClick={handleLoadAllTn}
              disabled={tnSources.length === 0 || loading}
              className="w-full px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              Cargar todas TN
            </button>
          </div>
        </div>

        <div className="px-4 pb-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleLoadAllAndMatch}
            disabled={(mlSources.length === 0 && tnSources.length === 0) || loading || variants.length === 0}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-indigo-900/30 transition-colors"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            Cargar todas y emparejar
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
          </>
        )}
      </section>

      {/* Paso 2: emparejar variantes — altura natural, scroll de página */}
      <section className="rounded-2xl border border-slate-700/80 bg-slate-900/30 overflow-hidden">
        <div className="shrink-0 px-4 py-3 border-b border-slate-700/60 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-white">Paso 2 · Emparejar variantes</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Revisá cada fila. Podés editar SKU, elegir de la lista o pegar IDs manualmente. Al guardar se
                sincroniza stock en todas las publicaciones del paso 1. Usá{' '}
                <strong className="text-indigo-300">Más publ.</strong> para agregar una publicación puntual.
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
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
                  <th className="text-left text-[11px] font-bold text-indigo-400/90 uppercase tracking-wider p-3 w-[120px]">
                    Más publ.
                  </th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v) => {
                  const mlVal = assignments[v.variantId]?.ml ?? '';
                  const tnVal = assignments[v.variantId]?.tn ?? '';
                  const tnProductId = assignments[v.variantId]?.tnProductId ?? '';
                  const status = getRowLinkStatus(mlVal, tnVal);
                  const mlLabel = resolveMlLabel(v.variantId);
                  const tnLabel = resolveTnLabel(v.variantId);
                  const pubCount = pubCounts[v.variantId] ?? 0;
                  const isExtraOpen = expandedExtraVariantId === v.variantId;

                  return (
                    <React.Fragment key={v.variantId}>
                    <tr
                      className={`border-b border-slate-700/40 transition-colors hover:bg-slate-800/40 ${
                        status === 'complete'
                          ? 'bg-emerald-950/10'
                          : status === 'partial'
                            ? 'bg-amber-950/10'
                            : ''
                      } ${isExtraOpen ? 'bg-indigo-950/20' : ''}`}
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
                                [v.variantId]: {
                                  ...prev[v.variantId],
                                  ml: e.target.value.trim(),
                                  mlItemId: /^ML[A-Z]{1,5}\d+$/i.test(e.target.value.trim())
                                    ? undefined
                                    : prev[v.variantId]?.mlItemId,
                                },
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
                                const [itemId, variationId] = val.split('::');
                                setAssignments((prev) => ({
                                  ...prev,
                                  [v.variantId]: {
                                    ...prev[v.variantId],
                                    ml: variationId,
                                    mlItemId: itemId,
                                  },
                                }));
                              }}
                              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-slate-300 text-xs outline-none focus:border-amber-500/60"
                            >
                              <option value="">Elegir de ML cargado…</option>
                              {filteredMl.map((m) => (
                                <option key={mlOptionKey(m)} value={mlOptionKey(m)}>
                                  {m.itemId} · {formatOptionLabel(m)}
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
                              value={
                                tnVal && tnProductId ? tnOptionKey({ productId: tnProductId, variantId: tnVal } as TnVariantRow) : tnVal
                              }
                              onChange={(e) => {
                                const raw = e.target.value;
                                if (!raw) {
                                  setAssignments((prev) => ({
                                    ...prev,
                                    [v.variantId]: { ...prev[v.variantId], tn: '', tnProductId: undefined },
                                  }));
                                  return;
                                }
                                const [productId, tnValNew] = raw.includes('::')
                                  ? raw.split('::')
                                  : ['', raw];
                                const tnOpt = tnVariants.find(
                                  (t) => t.variantId === tnValNew && (!productId || t.productId === productId)
                                );
                                const mlMatch =
                                  tnOpt && mlVariations.find((m) => bulkLinkSkuMatch(tnOpt.sku, m.sku));
                                setAssignments((prev) => ({
                                  ...prev,
                                  [v.variantId]: {
                                    ml: mlMatch ? mlMatch.variationId : prev[v.variantId]?.ml ?? '',
                                    mlItemId: mlMatch ? mlMatch.itemId : prev[v.variantId]?.mlItemId,
                                    tn: tnValNew,
                                    tnProductId: tnOpt?.productId || productId || undefined,
                                  },
                                }));
                              }}
                              className="w-full bg-slate-800/80 border border-cyan-800/40 rounded-lg px-2.5 py-2 text-white text-xs outline-none focus:border-cyan-500/70"
                            >
                              <option value="">Elegir variante TN…</option>
                              {getVisibleTnOptions(tnVal, tnProductId).map((t) => (
                                <option key={tnOptionKey(t)} value={tnOptionKey(t)}>
                                  {t.productId} · {formatOptionLabel(t)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <div className="rounded-lg border border-dashed border-slate-600 bg-slate-800/40 px-2.5 py-2 text-[11px] text-slate-500">
                              Cargá productos TN en el paso 1
                            </div>
                          )}
                          {tnLabel && tnVal && (
                            <p className="text-[10px] text-cyan-200/70 truncate pl-0.5" title={tnLabel}>
                              ↳ {tnLabel}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="p-3 align-top">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedExtraVariantId((prev) => (prev === v.variantId ? null : v.variantId))
                          }
                          className={`w-full flex flex-col items-center gap-1 px-2 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                            isExtraOpen
                              ? 'border-indigo-500 bg-indigo-600/25 text-indigo-200'
                              : pubCount > 0
                                ? 'border-indigo-700/50 bg-indigo-950/30 text-indigo-300 hover:bg-indigo-950/50'
                                : 'border-slate-600 bg-slate-800/50 text-slate-400 hover:text-indigo-300 hover:border-indigo-700/50'
                          }`}
                          title="Gestionar publicaciones adicionales para sincronizar stock"
                        >
                          <Layers size={16} />
                          <span>{pubCount > 0 ? `${pubCount}` : '+'}</span>
                          <span className="text-[9px] font-normal opacity-80">{isExtraOpen ? 'Cerrar' : 'Más'}</span>
                        </button>
                      </td>
                    </tr>
                    {isExtraOpen && (
                      <tr className="border-b border-slate-700/40">
                        <td colSpan={5} className="p-0">
                          <VariantExtraPublicationsPanel
                            variantId={v.variantId}
                            variantSku={skuEdits[v.variantId] ?? v.sku ?? ''}
                            productId={productId}
                            packMl={packMl}
                            packTn={packTn}
                            showToast={showToast}
                            onCountChange={(count) => refreshPublicationCount(v.variantId, count)}
                          />
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="flex flex-col sm:flex-row sm:items-center gap-3 pt-4 mt-2 border-t border-slate-700/60">
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
