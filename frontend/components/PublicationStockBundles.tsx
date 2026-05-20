import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Plus, Trash2, Layers, RefreshCw, Loader2, Search, Sparkles, ChevronDown, ChevronUp, Wand2 } from 'lucide-react';
import { Product, Role } from '../types';
import { api, PublicationBundleDto, PublicationBundleGroupDto } from '../services/api';
import { normalizeMercadoLibreItemId, extractMercadoLibreVariationIdFromUrl } from '../utils/mercadoLibreItemId';
import { normalizeTiendaNubeProductId, extractTiendaNubeVariantFromUrl } from '../utils/tiendaNubeUrl';
import {
  buildArticlePackMatrix,
  colorAbbrevLabel,
  packItemsFromColorOptions,
  productGroupKey
} from '../utils/suggestPublicationPacks';

type DraftItem = { variantId: string; unitsPerSale: number; label: string };

type DraftPublicationImage = {
  key: string;
  url: string;
  pictureId?: string;
  selected: boolean;
};

type PublicationDraft = {
  resolvedId: string;
  title: string;
  description: string;
  price: string;
  images: DraftPublicationImage[];
};

const PreviewThumb: React.FC<{
  url: string;
  selected?: boolean;
  onToggle?: () => void;
}> = ({ url, selected = true, onToggle }) => {
  const [src, setSrc] = useState(url);
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative rounded-lg overflow-hidden border-2 ${
        selected ? 'border-violet-500' : 'border-slate-700 opacity-50'
      }`}
      title={selected ? 'Quitar de la publicación' : 'Incluir en la publicación'}
    >
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => {
          if (src !== url) setSrc(url);
          else if (url.includes('-O.')) setSrc(url.replace(/-O\./i, '-I.'));
        }}
        className="h-24 w-24 object-cover bg-slate-900"
      />
      <span
        className={`absolute top-1 right-1 w-4 h-4 rounded-full border ${
          selected ? 'bg-violet-500 border-violet-300' : 'bg-slate-800 border-slate-600'
        }`}
      />
    </button>
  );
};

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
  const [publicationDraft, setPublicationDraft] = useState<PublicationDraft | null>(null);
  const [loadingSourcePreview, setLoadingSourcePreview] = useState(false);
  const [sourcePreviewError, setSourcePreviewError] = useState('');
  const [newImageUrl, setNewImageUrl] = useState('');
  const listingLabelTouched = useRef(false);
  const contentDraftTouched = useRef(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionQuery, setSuggestionQuery] = useState('');
  const [selectedArticleKey, setSelectedArticleKey] = useState('');
  const [suggestionSize, setSuggestionSize] = useState('');
  const [suggestionPicksBySize, setSuggestionPicksBySize] = useState<Record<string, string[]>>({});

  const variantById = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  const articleOptions = useMemo(() => {
    const map = new Map<string, { key: string; label: string; variantCount: number }>();
    for (const p of products) {
      const key = productGroupKey(p);
      const name = (p.name || '').trim();
      const label = name ? `${key} — ${name}` : key;
      const prev = map.get(key);
      if (prev) prev.variantCount += 1;
      else map.set(key, { key, label, variantCount: 1 });
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }, [products]);

  const flatVariants = useMemo(() => {
    return products.map((p) => {
      const articleKey = productGroupKey(p);
      const color = p.color || '—';
      const size = p.size || '—';
      const shortLabel = `${color} · ${size} (stock ${p.stock ?? 0})`;
      const fullLabel = `${articleKey} · ${shortLabel}`;
      return {
        variantId: p.id,
        articleKey,
        color,
        size,
        label: fullLabel,
        shortLabel
      };
    });
  }, [products]);

  const articleVariants = useMemo(() => {
    if (!selectedArticleKey) return [];
    return flatVariants.filter((v) => v.articleKey === selectedArticleKey);
  }, [flatVariants, selectedArticleKey]);

  const articlePackMatrix = useMemo(() => {
    if (!selectedArticleKey) return null;
    return buildArticlePackMatrix(products, selectedArticleKey, { query: suggestionQuery });
  }, [products, selectedArticleKey, suggestionQuery]);

  const activeSizeGroup = useMemo(() => {
    if (!articlePackMatrix?.sizeGroups.length) return null;
    const size = suggestionSize || articlePackMatrix.sizeGroups[0]?.size || '';
    return articlePackMatrix.sizeGroups.find((g) => g.size === size) ?? articlePackMatrix.sizeGroups[0];
  }, [articlePackMatrix, suggestionSize]);

  const selectedColorIdsForActiveSize = useMemo(() => {
    const size = activeSizeGroup?.size;
    if (!size) return new Set<string>();
    return new Set(suggestionPicksBySize[size] || []);
  }, [activeSizeGroup, suggestionPicksBySize]);

  useEffect(() => {
    if (!articlePackMatrix?.sizeGroups.length) {
      setSuggestionSize('');
      return;
    }
    const sizes = articlePackMatrix.sizeGroups.map((g) => g.size);
    if (!suggestionSize || !sizes.includes(suggestionSize)) {
      setSuggestionSize(sizes[0]);
    }
  }, [articlePackMatrix, suggestionSize]);

  const resetSuggestionPicks = () => setSuggestionPicksBySize({});

  const toggleSuggestionColor = (size: string, variantId: string) => {
    setSuggestionPicksBySize((prev) => {
      const cur = new Set(prev[size] || []);
      if (cur.has(variantId)) cur.delete(variantId);
      else cur.add(variantId);
      return { ...prev, [size]: [...cur] };
    });
  };

  const selectAllColorsWithStockForSize = (size: string) => {
    const group = articlePackMatrix?.sizeGroups.find((g) => g.size === size);
    if (!group) return;
    const ids = group.colors.filter((c) => c.stock > 0).map((c) => c.variantId);
    setSuggestionPicksBySize((prev) => ({ ...prev, [size]: ids }));
  };

  const draftItemsFromPickedColors = (size: string, variantIds: string[]) => {
    const group = articlePackMatrix?.sizeGroups.find((g) => g.size === size);
    if (!group) return [];
    return packItemsFromColorOptions(group.colors, variantIds).map((it) => ({
      variantId: it.variantId,
      unitsPerSale: it.unitsPerSale,
      label: it.label
    }));
  };

  const appendPackCombination = (label: string, items: DraftItem[]) => {
    if (items.length < 2) {
      showToast('error', 'Un pack multicolor necesita al menos 2 colores');
      return false;
    }
    setPackColorVariants((prev) => {
      const empty = prev.length === 1 && prev[0].items.length === 0 ? prev[0] : null;
      if (empty) {
        return prev.map((p) =>
          p.key === empty.key ? { ...p, label, items, expanded: true } : p
        );
      }
      return [...prev, newPackColorVariant({ label, items, expanded: true })];
    });
    return true;
  };

  const addSelectedColorsAsPackCombination = () => {
    const size = activeSizeGroup?.size;
    if (!size) return;
    const ids = [...selectedColorIdsForActiveSize];
    const items = draftItemsFromPickedColors(size, ids);
    const colorNames =
      activeSizeGroup?.colors.filter((c) => ids.includes(c.variantId)).map((c) => c.color) || [];
    const label = colorAbbrevLabel(colorNames);
    if (!appendPackCombination(label, items)) return;
    showToast('success', `Combinación agregada (${items.length} colores, talle ${size})`);
  };

  const addFullSizePack = (size: string) => {
    const group = articlePackMatrix?.sizeGroups.find((g) => g.size === size);
    if (!group || group.availablePacks < 1) {
      showToast('error', 'No hay stock suficiente para armar el pack en ese talle');
      return;
    }
    const withStock = group.colors.filter((c) => c.stock > 0);
    const items = draftItemsFromPickedColors(
      size,
      withStock.map((c) => c.variantId)
    );
    if (!appendPackCombination(group.packLabel, items)) return;
    showToast('success', `Pack ${group.packLabel} (talle ${size}) agregado`);
  };

  const addAllSizesAsPackCombinations = () => {
    if (!articlePackMatrix) return;
    let added = 0;
    for (const group of articlePackMatrix.sizeGroups) {
      if (group.availablePacks < 1) continue;
      const withStock = group.colors.filter((c) => c.stock > 0);
      if (withStock.length < 2) continue;
      const items = draftItemsFromPickedColors(
        group.size,
        withStock.map((c) => c.variantId)
      );
      if (appendPackCombination(group.packLabel, items)) added += 1;
    }
    if (added === 0) showToast('error', 'No hay talles con al menos 2 colores y stock');
    else showToast('success', `${added} combinación(es) agregada(s) (una por talle)`);
  };

  const prunePackItemsToArticle = (articleKey: string) => {
    if (!articleKey) return;
    setPackColorVariants((prev) =>
      prev.map((pv) => ({
        ...pv,
        items: pv.items.filter((it) => {
          const p = variantById.get(it.variantId);
          return p && productGroupKey(p) === articleKey;
        })
      }))
    );
  };

  const onArticleSelect = (key: string) => {
    setSelectedArticleKey(key);
    resetSuggestionPicks();
    if (key) prunePackItemsToArticle(key);
  };

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
      setPublicationDraft(null);
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
          if (!contentDraftTouched.current) {
            const suffix = titleSuffix.trim() || ' (Pack)';
            const baseTitle = p.title || '';
            const fullTitle =
              baseTitle && !baseTitle.toLowerCase().includes(suffix.trim().toLowerCase())
                ? `${baseTitle}${suffix}`
                : baseTitle || suffix.trim();
            const images: DraftPublicationImage[] = (p.images || []).map((im: { url: string; pictureId?: string }) => ({
              key: Math.random().toString(36).slice(2),
              url: im.url,
              pictureId: im.pictureId,
              selected: true
            }));
            setPublicationDraft({
              resolvedId: p.resolvedId,
              title: fullTitle,
              description: p.description || '',
              price: p.price != null ? String(p.price) : '',
              images
            });
            if (!listingLabelTouched.current) setListingLabel(fullTitle);
          }
        } catch (e: any) {
          if (cancelled) return;
          setPublicationDraft(null);
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
    setPublicationDraft(null);
    setSourcePreviewError('');
    setNewImageUrl('');
    listingLabelTouched.current = false;
    contentDraftTouched.current = false;
    setShowSuggestions(false);
    setSuggestionQuery('');
    setSelectedArticleKey('');
    setSuggestionSize('');
    resetSuggestionPicks();
  };

  const buildPublicationContent = () => {
    if (!publicationDraft) return undefined;
    const selected = publicationDraft.images.filter((im) => im.selected);
    if (!selected.length) return undefined;
    const price = parseFloat(publicationDraft.price.replace(',', '.'));
    return {
      title: publicationDraft.title.trim() || undefined,
      description: publicationDraft.description,
      price: Number.isFinite(price) ? price : undefined,
      pictures: selected.map((im) => ({
        url: im.url,
        pictureId: im.pictureId,
        selected: true
      }))
    };
  };

  const markContentTouched = () => {
    contentDraftTouched.current = true;
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
    const firstVariantId = g.variants[0]?.items[0]?.variantId;
    const firstProduct = firstVariantId ? variantById.get(firstVariantId) : undefined;
    if (firstProduct) setSelectedArticleKey(productGroupKey(firstProduct));
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
    const p = variantById.get(variantId);
    if (!p) return;
    const articleKey = productGroupKey(p);
    if (!selectedArticleKey) {
      setSelectedArticleKey(articleKey);
    } else if (articleKey !== selectedArticleKey) {
      showToast('error', 'Elegí colores del mismo artículo que el seleccionado arriba');
      return;
    }
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
    if (!selectedArticleKey) {
      showToast('error', 'Seleccioná el artículo del pack');
      return;
    }
    const variants = buildVariantsPayload();
    if (variants.length === 0) {
      showToast('error', 'Configurá al menos una combinación con colores');
      return;
    }
    const publicationContent = buildPublicationContent();
    if (!publicationContent?.pictures?.length) {
      showToast('error', 'Seleccioná al menos una imagen para la nueva publicación');
      return;
    }
    setCreatingListing(true);
    try {
      const res = await api.createPublicationBundleListingFromSource({
        platform,
        sourceExternalProductId: sourceId,
        titleSuffix: titleSuffix.trim() || ' (Pack)',
        skuSuffix: skuSuffix.trim() || '-PACK',
        label: (publicationDraft?.title || listingLabel).trim() || undefined,
        published: publishListing,
        publicationContent,
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
    if (!selectedArticleKey) {
      showToast('error', 'Seleccioná el artículo del pack');
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
    if (!selectedArticleKey) return [];
    const pool = articleVariants;
    const query = q.trim().toLowerCase();
    if (!query) return pool.slice(0, 40);
    return pool
      .filter(
        (v) =>
          v.shortLabel.toLowerCase().includes(query) ||
          v.color.toLowerCase().includes(query) ||
          v.size.toLowerCase().includes(query)
      )
      .slice(0, 40);
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
                {linkMode !== 'create' && (
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
                )}
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

              {(loadingSourcePreview || publicationDraft || sourcePreviewError) && linkMode === 'create' && (
                <div className="rounded-lg border border-slate-600 bg-slate-800/60 p-3 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-emerald-300 uppercase tracking-wide">
                      Nueva publicación pack (editable)
                    </p>
                    {loadingSourcePreview && <Loader2 size={14} className="animate-spin text-slate-400" />}
                  </div>
                  {sourcePreviewError && !loadingSourcePreview && (
                    <p className="text-xs text-amber-400">{sourcePreviewError}</p>
                  )}
                  {publicationDraft && !loadingSourcePreview && (
                    <>
                      <p className="text-[10px] font-mono text-slate-500">
                        Base {publicationDraft.resolvedId} · {publicationDraft.images.filter((i) => i.selected).length}/
                        {publicationDraft.images.length} fotos seleccionadas
                      </p>
                      <div>
                        <label className="text-[11px] text-slate-500 block mb-1">Título</label>
                        <input
                          value={publicationDraft.title}
                          onChange={(e) => {
                            markContentTouched();
                            listingLabelTouched.current = true;
                            const v = e.target.value;
                            setPublicationDraft((d) => (d ? { ...d, title: v } : d));
                            setListingLabel(v);
                          }}
                          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-slate-500 block mb-1">Precio</label>
                        <input
                          value={publicationDraft.price}
                          onChange={(e) => {
                            markContentTouched();
                            setPublicationDraft((d) => (d ? { ...d, price: e.target.value } : d));
                          }}
                          type="text"
                          inputMode="decimal"
                          className="w-full max-w-[200px] bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
                        />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                          <label className="text-[11px] text-slate-500">Fotos (clic para incluir / quitar)</label>
                          <div className="flex gap-2 text-[10px]">
                            <button
                              type="button"
                              className="text-violet-300 hover:text-white"
                              onClick={() => {
                                markContentTouched();
                                setPublicationDraft((d) =>
                                  d ? { ...d, images: d.images.map((im) => ({ ...im, selected: true })) } : d
                                );
                              }}
                            >
                              Todas
                            </button>
                            <button
                              type="button"
                              className="text-slate-400 hover:text-white"
                              onClick={() => {
                                markContentTouched();
                                setPublicationDraft((d) =>
                                  d ? { ...d, images: d.images.map((im) => ({ ...im, selected: false })) } : d
                                );
                              }}
                            >
                              Ninguna
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2 max-h-64 overflow-y-auto p-1">
                          {publicationDraft.images.map((im) => (
                            <PreviewThumb
                              key={im.key}
                              url={im.url}
                              selected={im.selected}
                              onToggle={() => {
                                markContentTouched();
                                setPublicationDraft((d) =>
                                  d
                                    ? {
                                        ...d,
                                        images: d.images.map((x) =>
                                          x.key === im.key ? { ...x, selected: !x.selected } : x
                                        )
                                      }
                                    : d
                                );
                              }}
                            />
                          ))}
                        </div>
                        <div className="flex gap-2 mt-2">
                          <input
                            value={newImageUrl}
                            onChange={(e) => setNewImageUrl(e.target.value)}
                            placeholder="https://… agregar foto por URL"
                            className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const u = newImageUrl.trim();
                              if (!u.startsWith('http')) {
                                showToast('error', 'URL de imagen inválida');
                                return;
                              }
                              markContentTouched();
                              setPublicationDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      images: [
                                        ...d.images,
                                        { key: Math.random().toString(36).slice(2), url: u, selected: true }
                                      ]
                                    }
                                  : d
                              );
                              setNewImageUrl('');
                            }}
                            className="px-3 py-1.5 rounded-lg bg-slate-700 text-xs text-white hover:bg-slate-600"
                          >
                            Agregar
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="text-[11px] text-slate-500 block mb-1">Descripción</label>
                        <textarea
                          value={publicationDraft.description}
                          onChange={(e) => {
                            markContentTouched();
                            setPublicationDraft((d) => (d ? { ...d, description: e.target.value } : d));
                          }}
                          rows={8}
                          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm whitespace-pre-wrap resize-y min-h-[120px]"
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="space-y-3">
                <div className="rounded-lg border border-slate-600 bg-slate-800/50 p-3">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-2">
                    Artículo del pack
                  </label>
                  <select
                    value={selectedArticleKey}
                    onChange={(e) => onArticleSelect(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
                  >
                    <option value="">— Seleccioná un artículo —</option>
                    {articleOptions.map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.label} ({a.variantCount} variantes)
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-slate-500 mt-1.5">
                    Todas las combinaciones del pack usan variantes de este artículo (mismo código base).
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-[11px] font-bold text-violet-300 uppercase tracking-wide">
                    Variantes de colores del pack
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={!selectedArticleKey}
                      onClick={() => setShowSuggestions((v) => !v)}
                      className={`text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-lg border font-semibold disabled:opacity-40 disabled:cursor-not-allowed ${
                        showSuggestions
                          ? 'bg-amber-600/30 border-amber-500/60 text-amber-100'
                          : 'border-amber-700/50 text-amber-300 hover:bg-amber-950/40 hover:text-amber-100'
                      }`}
                    >
                      <Wand2 size={14} />
                      Packs sugeridos
                      {articlePackMatrix && articlePackMatrix.sizeGroups.length > 0 ? (
                        <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-amber-500/30 text-[10px]">
                          {articlePackMatrix.sizeGroups.length} talles
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPackColorVariants((prev) => [...prev, newPackColorVariant()])}
                      className="text-xs text-violet-300 hover:text-white flex items-center gap-1"
                    >
                      <Plus size={14} /> Agregar combinación
                    </button>
                  </div>
                </div>

                {showSuggestions && selectedArticleKey && (
                  <div className="rounded-xl border border-amber-800/50 bg-amber-950/25 p-3 space-y-3">
                    <p className="text-xs text-amber-200/90">
                      Elegí el <strong>talle</strong>, marcá los <strong>colores</strong> del pack (1 unidad c/u) y
                      agregá la combinación. En Mercado Libre la publicación usa variante Color + Talle.
                    </p>
                    <div className="relative">
                      <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        value={suggestionQuery}
                        onChange={(e) => setSuggestionQuery(e.target.value)}
                        placeholder="Filtrar color o talle…"
                        className="w-full pl-7 bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-xs"
                      />
                    </div>
                    {!articlePackMatrix?.sizeGroups.length ? (
                      <p className="text-xs text-slate-500 py-2">
                        No hay variantes con stock para este artículo. Probá otro filtro.
                      </p>
                    ) : (
                      <>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide block mb-1.5">
                            1 · Talle
                          </label>
                          <div className="flex flex-wrap gap-1.5">
                            {articlePackMatrix.sizeGroups.map((g) => (
                              <button
                                key={g.size}
                                type="button"
                                onClick={() => setSuggestionSize(g.size)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                                  activeSizeGroup?.size === g.size
                                    ? 'bg-amber-600/40 border-amber-500 text-amber-50'
                                    : 'border-slate-600 text-slate-400 hover:bg-slate-800'
                                }`}
                              >
                                {g.size}
                                {g.availablePacks > 0 ? (
                                  <span className="ml-1 text-[10px] text-emerald-400/90">({g.availablePacks})</span>
                                ) : null}
                              </button>
                            ))}
                          </div>
                        </div>

                        {activeSizeGroup && (
                          <div>
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                                2 · Colores (talle {activeSizeGroup.size})
                              </label>
                              <div className="flex gap-2 text-[10px]">
                                <button
                                  type="button"
                                  className="text-amber-300 hover:text-white"
                                  onClick={() => selectAllColorsWithStockForSize(activeSizeGroup.size)}
                                >
                                  Todos con stock
                                </button>
                                <button
                                  type="button"
                                  className="text-slate-400 hover:text-white"
                                  onClick={() =>
                                    setSuggestionPicksBySize((prev) => ({ ...prev, [activeSizeGroup.size]: [] }))
                                  }
                                >
                                  Ninguno
                                </button>
                              </div>
                            </div>
                            <ul className="max-h-40 overflow-y-auto rounded-lg border border-slate-700 divide-y divide-slate-800">
                              {activeSizeGroup.colors.map((c) => {
                                const checked = selectedColorIdsForActiveSize.has(c.variantId);
                                const disabled = c.stock < 1;
                                return (
                                  <li key={c.variantId}>
                                    <label
                                      className={`flex items-center gap-2 px-2.5 py-2 text-xs cursor-pointer ${
                                        disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-800/80'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        disabled={disabled}
                                        onChange={() =>
                                          toggleSuggestionColor(activeSizeGroup.size, c.variantId)
                                        }
                                        className="rounded border-slate-600 text-amber-500"
                                      />
                                      <span className="flex-1 text-slate-200">{c.color}</span>
                                      <span className="text-slate-500 shrink-0">stock {c.stock}</span>
                                    </label>
                                  </li>
                                );
                              })}
                            </ul>
                            {activeSizeGroup.colors.length < 2 && (
                              <p className="text-[10px] text-amber-400/90 mt-1">
                                Este talle tiene menos de 2 colores en inventario.
                              </p>
                            )}
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            type="button"
                            disabled={selectedColorIdsForActiveSize.size < 2}
                            onClick={addSelectedColorsAsPackCombination}
                            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold disabled:opacity-40"
                          >
                            Agregar colores seleccionados
                          </button>
                          {activeSizeGroup && activeSizeGroup.availablePacks > 0 && (
                            <button
                              type="button"
                              onClick={() => addFullSizePack(activeSizeGroup.size)}
                              className="px-3 py-1.5 rounded-lg border border-amber-700/60 text-amber-200 text-xs hover:bg-amber-950/50"
                            >
                              Pack completo {activeSizeGroup.packLabel} ({activeSizeGroup.size})
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={addAllSizesAsPackCombinations}
                            className="px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 text-xs hover:bg-slate-800"
                          >
                            Un pack por cada talle
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

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
                            disabled={!selectedArticleKey}
                            placeholder={
                              selectedArticleKey
                                ? 'Buscar color o talle de este artículo…'
                                : 'Primero seleccioná el artículo arriba'
                            }
                            className="w-full pl-7 bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-xs disabled:opacity-50"
                          />
                        </div>
                        <div className="max-h-28 overflow-y-auto rounded border border-slate-700 divide-y divide-slate-800">
                          {!selectedArticleKey ? (
                            <p className="px-2 py-3 text-[11px] text-slate-500 text-center">
                              Seleccioná el artículo del pack para ver colores y talles.
                            </p>
                          ) : filterVariantsForSearch(pv.search).length === 0 ? (
                            <p className="px-2 py-3 text-[11px] text-slate-500 text-center">
                              Sin variantes con ese filtro.
                            </p>
                          ) : (
                            filterVariantsForSearch(pv.search).map((v) => (
                              <button
                                key={v.variantId}
                                type="button"
                                onClick={() =>
                                  addItemToColorVariant(pv.key, v.variantId, v.shortLabel)
                                }
                                className="w-full text-left px-2 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800 flex items-center gap-1"
                              >
                                <Plus size={10} className="text-violet-400 shrink-0" />
                                <span className="truncate">{v.shortLabel}</span>
                              </button>
                            ))
                          )}
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
