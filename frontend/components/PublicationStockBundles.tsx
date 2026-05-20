import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Plus, Trash2, Layers, RefreshCw, Loader2, Search, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { Product, Role } from '../types';
import { api, PublicationBundleDto, PublicationBundleGroupDto } from '../services/api';
import { normalizeMercadoLibreItemId, extractMercadoLibreVariationIdFromUrl } from '../utils/mercadoLibreItemId';
import { normalizeTiendaNubeProductId, extractTiendaNubeVariantFromUrl } from '../utils/tiendaNubeUrl';

type DraftItem = { variantId: string; unitsPerSale: number; label: string };

type PackColorVariant = {
  key: string;
  bundleId?: string;
  label: string;
  externalVariantId: string;
  items: DraftItem[];
  search: string;
  expanded: boolean;
};

const newPackColorVariant = (partial?: Partial<PackColorVariant>): PackColorVariant => ({
  key: Math.random().toString(36).slice(2),
  label: '',
  externalVariantId: '',
  items: [],
  search: '',
  expanded: true,
  ...partial
});

interface PublicationStockBundlesProps {
  open: boolean;
  onClose: () => void;
  products: Product[];
  role: Role;
  showToast: (type: 'success' | 'error', message: string) => void;
}

const PublicationStockBundles: React.FC<PublicationStockBundlesProps> = ({
  open,
  onClose,
  products,
  role,
  showToast
}) => {
  const canEdit = role === Role.ADMIN || role === Role.DEPOSITO;
  const [groups, setGroups] = useState<PublicationBundleGroupDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [platform, setPlatform] = useState<'mercadolibre' | 'tiendanube'>('mercadolibre');
  const [listingLabel, setListingLabel] = useState('');
  const [listingInput, setListingInput] = useState('');
  const [packColorVariants, setPackColorVariants] = useState<PackColorVariant[]>([newPackColorVariant()]);
  const [linkMode, setLinkMode] = useState<'existing' | 'create'>('create');
  const [sourceListingInput, setSourceListingInput] = useState('');
  const [titleSuffix, setTitleSuffix] = useState(' (Pack)');
  const [skuSuffix, setSkuSuffix] = useState('-PACK');
  const [publishListing, setPublishListing] = useState(true);
  const [creatingListing, setCreatingListing] = useState(false);
  const [sourcePreview, setSourcePreview] = useState<{
    resolvedId: string;
    title: string;
    description: string;
    images: string[];
    price?: number;
  } | null>(null);
  const [loadingSourcePreview, setLoadingSourcePreview] = useState(false);
  const [sourcePreviewError, setSourcePreviewError] = useState('');
  const listingLabelTouched = useRef(false);

  const flatVariants = useMemo(() => {
    return products.map((p) => {
      const base = p.base_sku || p.sku?.split('-').slice(0, -2).join('-') || p.sku || '';
      return {
        variantId: p.id,
        label: `${base} · ${p.color || '—'} · ${p.size || '—'} (stock ${p.stock ?? 0})`
      };
    });
  }, [products]);

  const loadBundles = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.getPublicationBundleGroups();
      setGroups(rows);
    } catch {
      showToast('error', 'No se pudieron cargar los packs');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (open) loadBundles();
  }, [open, loadBundles]);

  const parseSourceListingId = () => {
    if (platform === 'mercadolibre') {
      return normalizeMercadoLibreItemId(sourceListingInput) || sourceListingInput.trim();
    }
    return normalizeTiendaNubeProductId(sourceListingInput) || sourceListingInput.trim();
  };

  const parseListingProductId = () => {
    if (platform === 'mercadolibre') {
      return normalizeMercadoLibreItemId(listingInput) || listingInput.trim();
    }
    return normalizeTiendaNubeProductId(listingInput) || listingInput.trim();
  };

  const previewSourceId = useMemo(() => {
    if (linkMode === 'create') return parseSourceListingId();
    return parseListingProductId();
  }, [linkMode, platform, sourceListingInput, listingInput]);

  useEffect(() => {
    if (!open || !previewSourceId || previewSourceId.length < 4) {
      setSourcePreview(null);
      setSourcePreviewError('');
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setLoadingSourcePreview(true);
        setSourcePreviewError('');
        try {
          const p = await api.getPublicationBundleSourcePreview(platform, previewSourceId);
          if (cancelled) return;
          setSourcePreview(p);
          if (!listingLabelTouched.current && p.title) {
            setListingLabel(p.title);
          }
        } catch (e: any) {
          if (cancelled) return;
          setSourcePreview(null);
          setSourcePreviewError(e?.message || 'No se encontró la publicación');
        } finally {
          if (!cancelled) setLoadingSourcePreview(false);
        }
      })();
    }, 650);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, platform, linkMode, previewSourceId]);

  const resetForm = () => {
    setListingLabel('');
    setListingInput('');
    setPackColorVariants([newPackColorVariant()]);
    setPlatform('mercadolibre');
    setLinkMode('create');
    setSourceListingInput('');
    setTitleSuffix(' (Pack)');
    setSkuSuffix('-PACK');
    setPublishListing(true);
    setSourcePreview(null);
    setSourcePreviewError('');
    listingLabelTouched.current = false;
  };

  const parseExternalVariantId = (raw: string) => {
    if (platform === 'mercadolibre') {
      return (
        extractMercadoLibreVariationIdFromUrl(raw) ||
        (raw.trim() && /^\d+$/.test(raw.trim()) ? raw.trim() : '')
      );
    }
    return extractTiendaNubeVariantFromUrl(raw) || raw.trim();
  };

  const startEditGroup = (g: PublicationBundleGroupDto) => {
    setPlatform(g.platform);
    setListingLabel(g.listingLabel || '');
    setListingInput(g.externalProductId);
    setLinkMode('existing');
    setPackColorVariants(
      g.variants.map((b) =>
        newPackColorVariant({
          bundleId: b.id,
          label: b.label || '',
          externalVariantId: b.externalVariantId || '',
          expanded: true,
          items: b.items.map((it) => ({
            variantId: it.variantId,
            unitsPerSale: it.unitsPerSale,
            label: `${it.productName || ''} ${it.colorName || ''} ${it.sizeCode || ''} (${it.sku || it.variantId})`.trim()
          }))
        })
      )
    );
  };

  const startEditSingle = (b: PublicationBundleDto) => {
    startEditGroup({
      platform: b.platform,
      externalProductId: b.externalProductId,
      listingLabel: b.label,
      variants: [b]
    });
  };

  const updateColorVariant = (key: string, patch: Partial<PackColorVariant>) => {
    setPackColorVariants((prev) => prev.map((v) => (v.key === key ? { ...v, ...patch } : v)));
  };

  const addItemToColorVariant = (key: string, variantId: string, labelText: string) => {
    setPackColorVariants((prev) =>
      prev.map((v) => {
        if (v.key !== key || v.items.some((d) => d.variantId === variantId)) return v;
        return { ...v, items: [...v.items, { variantId, unitsPerSale: 1, label: labelText }] };
      })
    );
  };

  const buildVariantsPayload = () =>
    packColorVariants
      .filter((pv) => pv.items.length > 0)
      .map((pv) => ({
        id: pv.bundleId,
        label: pv.label.trim() || undefined,
        externalVariantId: parseExternalVariantId(pv.externalVariantId) || undefined,
        items: pv.items.map((d) => ({ variantId: d.variantId, unitsPerSale: d.unitsPerSale }))
      }));

  const createListingAndBundle = async () => {
    const sourceId = parseSourceListingId();
    if (!sourceId) {
      showToast('error', 'Indicá la publicación individual de origen (un color)');
      return;
    }
    const variants = buildVariantsPayload();
    if (variants.length === 0) {
      showToast('error', 'Configurá al menos una combinación con colores');
      return;
    }
    setCreatingListing(true);
    try {
      const res = await api.createPublicationBundleListingFromSource({
        platform,
        sourceExternalProductId: sourceId,
        titleSuffix: titleSuffix.trim() || ' (Pack)',
        skuSuffix: skuSuffix.trim() || '-PACK',
        label: listingLabel.trim() || undefined,
        published: publishListing,
        variants: variants.map((v) => ({
          label: v.label,
          items: v.items
        }))
      });
      setListingInput(res.newExternalProductId);
      showToast('success', res.message || 'Publicación pack creada');
      resetForm();
      setLinkMode('existing');
      if (res.group?.variants?.length) {
        startEditGroup(res.group);
      }
      await loadBundles();
    } catch (e: any) {
      showToast('error', e?.message || 'No se pudo crear la publicación pack');
    } finally {
      setCreatingListing(false);
    }
  };

  const saveGroup = async () => {
    const productId = parseListingProductId();
    if (!productId) {
      showToast('error', 'Indicá el ID o link de la publicación pack');
      return;
    }
    const variants = buildVariantsPayload();
    if (variants.length === 0) {
      showToast('error', 'Agregá al menos una combinación de colores');
      return;
    }
    setSaving(true);
    try {
      await api.savePublicationBundleGroup({
        platform,
        externalProductId: productId,
        listingLabel: listingLabel.trim() || null,
        variants
      });
      showToast('success', 'Pack guardado');
      resetForm();
      await loadBundles();
    } catch (e: any) {
      showToast('error', e?.message || 'Error guardando pack');
    } finally {
      setSaving(false);
    }
  };

  const removeGroup = async (g: PublicationBundleGroupDto) => {
    if (!window.confirm('¿Eliminar todas las variantes de este pack?')) return;
    try {
      for (const v of g.variants) {
        await api.deletePublicationBundle(v.id);
      }
      showToast('success', 'Pack eliminado');
      resetForm();
      await loadBundles();
    } catch {
      showToast('error', 'No se pudo eliminar');
    }
  };

  const syncListingStock = async (g: PublicationBundleGroupDto) => {
    try {
      await api.syncPublicationBundleListingStock(g.platform, g.externalProductId);
      showToast('success', 'Stock sincronizado en todas las variantes');
      await loadBundles();
    } catch {
      showToast('error', 'Error al sincronizar stock');
    }
  };

  const filterVariantsForSearch = (q: string) => {
    const query = q.trim().toLowerCase();
    if (!query) return flatVariants.slice(0, 40);
    return flatVariants.filter((v) => v.label.toLowerCase().includes(query)).slice(0, 40);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70">
      <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col rounded-2xl border border-slate-600 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-700">
          <div className="flex items-center gap-2 min-w-0">
            <Layers size={22} className="text-violet-400 shrink-0" />
            <div>
              <h2 className="text-lg font-black text-white">Packs de publicación (multicolor)</h2>
              <p className="text-xs text-slate-400">
                Una publicación puede tener varias variantes de pack (ej. NGB y Bordo/Azul/Beige). Cada venta descuenta
                los colores de esa variante.
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {canEdit && (
            <div className="rounded-xl border border-violet-800/50 bg-violet-950/20 p-4 space-y-4">
              <h3 className="text-sm font-bold text-violet-200">Configurar pack</h3>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setLinkMode('create')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                    linkMode === 'create'
                      ? 'bg-violet-600 border-violet-500 text-white'
                      : 'border-slate-600 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  Crear publicación pack
                </button>
                <button
                  type="button"
                  onClick={() => setLinkMode('existing')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                    linkMode === 'existing'
                      ? 'bg-violet-600 border-violet-500 text-white'
                      : 'border-slate-600 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  Vincular publicación existente
                </button>
              </div>

              {linkMode === 'create' && (
                <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/20 p-3 space-y-3">
                  <p className="text-xs text-emerald-200/90">
                    Publicación origen (un color) → se crea la publicación pack con <strong>mismas fotos</strong> y las
                    variantes de colores que definas abajo.
                  </p>
                  <div>
                    <label className="text-[11px] text-slate-500 block mb-1">
                      {platform === 'mercadolibre' ? 'Publicación base (MLA / link)' : 'Producto base TN'}
                    </label>
                    <input
                      value={sourceListingInput}
                      onChange={(e) => setSourceListingInput(e.target.value)}
                      placeholder={platform === 'mercadolibre' ? 'MLA de un color' : 'ID producto TN de un color'}
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white font-mono text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <input
                      value={titleSuffix}
                      onChange={(e) => setTitleSuffix(e.target.value)}
                      placeholder="Sufijo título"
                      className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
                    />
                    <input
                      value={skuSuffix}
                      onChange={(e) => setSkuSuffix(e.target.value)}
                      placeholder="Sufijo SKU"
                      className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
                    />
                    <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={publishListing}
                        onChange={(e) => setPublishListing(e.target.checked)}
                        className="rounded border-slate-600"
                      />
                      Publicar activa
                    </label>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-slate-500 block mb-1">Plataforma</label>
                  <select
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value as 'mercadolibre' | 'tiendanube')}
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
                  >
                    <option value="mercadolibre">Mercado Libre</option>
                    <option value="tiendanube">Tienda Nube</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-slate-500 block mb-1">Nombre publicación (opcional)</label>
                  <input
                    value={listingLabel}
                    onChange={(e) => {
                      listingLabelTouched.current = true;
                      setListingLabel(e.target.value);
                    }}
                    placeholder="Pack 3 boxer"
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
                  />
                </div>
              </div>

              {linkMode === 'existing' && (
                <div>
                  <label className="text-[11px] text-slate-500 block mb-1">
                    {platform === 'mercadolibre' ? 'MLA / link publicación pack' : 'ID producto pack TN'}
                  </label>
                  <input
                    value={listingInput}
                    onChange={(e) => setListingInput(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white font-mono text-sm"
                  />
                </div>
              )}

              {(loadingSourcePreview || sourcePreview || sourcePreviewError) && (
                <div className="rounded-lg border border-slate-600 bg-slate-800/60 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-slate-300 uppercase tracking-wide">Vista previa publicación base</p>
                    {loadingSourcePreview && <Loader2 size={14} className="animate-spin text-slate-400" />}
                  </div>
                  {sourcePreviewError && !loadingSourcePreview && (
                    <p className="text-xs text-amber-400">{sourcePreviewError}</p>
                  )}
                  {sourcePreview && !loadingSourcePreview && (
                    <>
                      <div>
                        <p className="text-sm font-semibold text-white leading-snug">{sourcePreview.title || 'Sin título'}</p>
                        <p className="text-[10px] font-mono text-slate-500 mt-0.5">
                          ID {sourcePreview.resolvedId}
                          {sourcePreview.price != null ? ` · $${sourcePreview.price}` : ''}
                        </p>
                      </div>
                      {sourcePreview.images.length > 0 ? (
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {sourcePreview.images.map((url, i) => (
                            <img
                              key={`${url}-${i}`}
                              src={url}
                              alt=""
                              className="h-20 w-20 shrink-0 rounded-lg object-cover border border-slate-600 bg-slate-900"
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">Sin imágenes en la publicación</p>
                      )}
                      {sourcePreview.description ? (
                        <div>
                          <p className="text-[10px] text-slate-500 mb-1">Descripción (se copiará al crear el pack)</p>
                          <div className="max-h-36 overflow-y-auto rounded-lg bg-slate-900/80 border border-slate-700 px-3 py-2 text-xs text-slate-300 whitespace-pre-wrap">
                            {sourcePreview.description}
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">Sin descripción</p>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[11px] font-bold text-violet-300 uppercase tracking-wide">
                    Variantes de colores del pack
                  </label>
                  <button
                    type="button"
                    onClick={() => setPackColorVariants((prev) => [...prev, newPackColorVariant()])}
                    className="text-xs text-violet-300 hover:text-white flex items-center gap-1"
                  >
                    <Plus size={14} /> Agregar combinación
                  </button>
                </div>

                {packColorVariants.map((pv, idx) => (
                  <div key={pv.key} className="rounded-lg border border-slate-600 bg-slate-800/40 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => updateColorVariant(pv.key, { expanded: !pv.expanded })}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-800/80"
                    >
                      {pv.expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                      <span className="text-sm font-semibold text-white flex-1 truncate">
                        {pv.label.trim() || `Combinación ${idx + 1}`}
                        {pv.items.length > 0 ? (
                          <span className="text-slate-500 font-normal ml-2">
                            ({pv.items.map((i) => i.label.split('·')[1]?.trim() || i.label).join(' + ')})
                          </span>
                        ) : null}
                      </span>
                      {packColorVariants.length > 1 && (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPackColorVariants((prev) => prev.filter((x) => x.key !== pv.key));
                          }}
                          className="text-slate-500 hover:text-red-400 p-1"
                        >
                          <Trash2 size={14} />
                        </span>
                      )}
                    </button>

                    {pv.expanded && (
                      <div className="px-3 pb-3 space-y-3 border-t border-slate-700/80">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-3">
                          <div>
                            <label className="text-[10px] text-slate-500 block mb-1">Nombre combo (ej. NGB)</label>
                            <input
                              value={pv.label}
                              onChange={(e) => updateColorVariant(pv.key, { label: e.target.value })}
                              placeholder="Negro / Gris / Blanco"
                              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-sm"
                            />
                          </div>
                          {linkMode === 'existing' && (
                            <div>
                              <label className="text-[10px] text-slate-500 block mb-1">
                                {platform === 'mercadolibre' ? 'ID variación ML' : 'ID variante TN'}
                              </label>
                              <input
                                value={pv.externalVariantId}
                                onChange={(e) => updateColorVariant(pv.key, { externalVariantId: e.target.value })}
                                placeholder="Obligatorio si hay varias"
                                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white font-mono text-xs"
                              />
                            </div>
                          )}
                        </div>

                        {pv.items.length > 0 && (
                          <ul className="space-y-1">
                            {pv.items.map((d) => (
                              <li
                                key={d.variantId}
                                className="flex items-center gap-2 py-1.5 px-2 rounded bg-slate-900/80 border border-slate-700 text-xs"
                              >
                                <span className="flex-1 truncate text-slate-200">{d.label}</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={99}
                                  value={d.unitsPerSale}
                                  onChange={(e) => {
                                    const n = Math.max(1, parseInt(e.target.value, 10) || 1);
                                    updateColorVariant(pv.key, {
                                      items: pv.items.map((x) =>
                                        x.variantId === d.variantId ? { ...x, unitsPerSale: n } : x
                                      )
                                    });
                                  }}
                                  className="w-12 bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-white text-right"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateColorVariant(pv.key, {
                                      items: pv.items.filter((x) => x.variantId !== d.variantId)
                                    })
                                  }
                                  className="text-slate-500 hover:text-red-400"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}

                        <div className="relative">
                          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
                          <input
                            value={pv.search}
                            onChange={(e) => updateColorVariant(pv.key, { search: e.target.value })}
                            placeholder="Buscar color/talle para agregar…"
                            className="w-full pl-7 bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-xs"
                          />
                        </div>
                        <div className="max-h-28 overflow-y-auto rounded border border-slate-700 divide-y divide-slate-800">
                          {filterVariantsForSearch(pv.search).map((v) => (
                            <button
                              key={v.variantId}
                              type="button"
                              onClick={() => addItemToColorVariant(pv.key, v.variantId, v.label)}
                              className="w-full text-left px-2 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800 flex items-center gap-1"
                            >
                              <Plus size={10} className="text-violet-400 shrink-0" />
                              <span className="truncate">{v.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                {linkMode === 'create' ? (
                  <button
                    type="button"
                    onClick={() => void createListingAndBundle()}
                    disabled={creatingListing || saving}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
                  >
                    {creatingListing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                    Crear publicación + variantes
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void saveGroup()}
                    disabled={saving}
                    className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold disabled:opacity-50"
                  >
                    {saving ? <Loader2 size={16} className="animate-spin inline" /> : null} Guardar pack
                  </button>
                )}
                <button type="button" onClick={resetForm} className="px-3 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm">
                  Limpiar
                </button>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white">Packs configurados</h3>
              <button type="button" onClick={() => void loadBundles()} className="text-slate-400 hover:text-white text-xs flex items-center gap-1">
                {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Actualizar
              </button>
            </div>
            {groups.length === 0 ? (
              <p className="text-sm text-slate-500">Todavía no hay packs configurados.</p>
            ) : (
              <ul className="space-y-3">
                {groups.map((g) => (
                  <li key={`${g.platform}-${g.externalProductId}`} className="rounded-xl border border-slate-700 bg-slate-800/50 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-white truncate">{g.listingLabel || g.externalProductId}</p>
                        <p className="text-xs font-mono text-slate-400">
                          {g.platform === 'mercadolibre' ? 'ML' : 'TN'} {g.externalProductId} · {g.variants.length}{' '}
                          variante(s)
                        </p>
                      </div>
                      {canEdit && (
                        <div className="flex flex-wrap gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => startEditGroup(g)}
                            className="px-2 py-1 rounded text-xs border border-slate-600 text-slate-300 hover:bg-slate-700"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => void syncListingStock(g)}
                            className="px-2 py-1 rounded text-xs border border-violet-700 text-violet-300 hover:bg-violet-900/30"
                          >
                            Sync todas
                          </button>
                          <button
                            type="button"
                            onClick={() => void removeGroup(g)}
                            className="px-2 py-1 rounded text-xs border border-red-900/50 text-red-400 hover:bg-red-950/30"
                          >
                            Eliminar
                          </button>
                        </div>
                      )}
                    </div>
                    <ul className="space-y-1.5">
                      {g.variants.map((b) => (
                        <li
                          key={b.id}
                          className="rounded-lg bg-slate-900/60 border border-slate-700/80 px-2.5 py-2 text-xs"
                        >
                          <div className="flex justify-between gap-2">
                            <span className="font-medium text-violet-200">{b.label || 'Sin nombre'}</span>
                            <span className="text-emerald-400/90 shrink-0">{b.availableStock ?? '—'} pack(s)</span>
                          </div>
                          {b.externalVariantId ? (
                            <p className="font-mono text-slate-500 text-[10px]">var {b.externalVariantId}</p>
                          ) : null}
                          <p className="text-slate-500 mt-0.5">
                            {b.items.map((it) => `${it.colorName || it.sku}×${it.unitsPerSale}`).join(' + ')}
                          </p>
                          {canEdit && g.variants.length === 1 && (
                            <button
                              type="button"
                              onClick={() => startEditSingle(b)}
                              className="mt-1 text-[10px] text-slate-400 hover:text-white"
                            >
                              Editar
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PublicationStockBundles;
