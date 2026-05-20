import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Plus, Trash2, Layers, RefreshCw, Loader2, Search, Sparkles } from 'lucide-react';
import { Product, Role } from '../types';
import { api, PublicationBundleDto } from '../services/api';
import { normalizeMercadoLibreItemId, extractMercadoLibreVariationIdFromUrl } from '../utils/mercadoLibreItemId';
import { normalizeTiendaNubeProductId, extractTiendaNubeVariantFromUrl } from '../utils/tiendaNubeUrl';

type DraftItem = { variantId: string; unitsPerSale: number; label: string };

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
  const [bundles, setBundles] = useState<PublicationBundleDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [platform, setPlatform] = useState<'mercadolibre' | 'tiendanube'>('mercadolibre');
  const [label, setLabel] = useState('');
  const [listingInput, setListingInput] = useState('');
  const [variantInput, setVariantInput] = useState('');
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [variantSearch, setVariantSearch] = useState('');
  const [linkMode, setLinkMode] = useState<'existing' | 'create'>('create');
  const [sourceListingInput, setSourceListingInput] = useState('');
  const [titleSuffix, setTitleSuffix] = useState(' (Pack)');
  const [skuSuffix, setSkuSuffix] = useState('-PACK');
  const [publishListing, setPublishListing] = useState(true);
  const [creatingListing, setCreatingListing] = useState(false);

  const flatVariants = useMemo(() => {
    return products.map((p) => {
      const base = p.base_sku || p.sku?.split('-').slice(0, -2).join('-') || p.sku || '';
      return {
        variantId: p.id,
        stock: Number(p.stock) || 0,
        label: `${base} · ${p.color || '—'} · ${p.size || '—'} (stock ${p.stock ?? 0})`
      };
    });
  }, [products]);

  const filteredVariants = useMemo(() => {
    const q = variantSearch.trim().toLowerCase();
    if (!q) return flatVariants.slice(0, 40);
    return flatVariants.filter((v) => v.label.toLowerCase().includes(q)).slice(0, 40);
  }, [flatVariants, variantSearch]);

  const loadBundles = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.getPublicationBundles();
      setBundles(rows);
    } catch {
      showToast('error', 'No se pudieron cargar los packs');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (open) loadBundles();
  }, [open, loadBundles]);

  const resetForm = () => {
    setEditingId(null);
    setLabel('');
    setListingInput('');
    setVariantInput('');
    setDraftItems([]);
    setPlatform('mercadolibre');
    setLinkMode('create');
    setSourceListingInput('');
    setTitleSuffix(' (Pack)');
    setSkuSuffix('-PACK');
    setPublishListing(true);
  };

  const parseSourceListingId = () => {
    if (platform === 'mercadolibre') {
      return normalizeMercadoLibreItemId(sourceListingInput) || sourceListingInput.trim();
    }
    return normalizeTiendaNubeProductId(sourceListingInput) || sourceListingInput.trim();
  };

  const parseListingIds = () => {
    if (platform === 'mercadolibre') {
      const productId = normalizeMercadoLibreItemId(listingInput) || listingInput.trim();
      const varId =
        extractMercadoLibreVariationIdFromUrl(variantInput) ||
        (variantInput.trim() && /^\d+$/.test(variantInput.trim()) ? variantInput.trim() : '');
      return { productId, varId };
    }
    const productId = normalizeTiendaNubeProductId(listingInput) || listingInput.trim();
    const varId = extractTiendaNubeVariantFromUrl(variantInput) || variantInput.trim();
    return { productId, varId };
  };

  const startEdit = (b: PublicationBundleDto) => {
    setEditingId(b.id);
    setPlatform(b.platform);
    setLabel(b.label || '');
    setListingInput(b.externalProductId);
    setVariantInput(b.externalVariantId || '');
    setDraftItems(
      b.items.map((it) => ({
        variantId: it.variantId,
        unitsPerSale: it.unitsPerSale,
        label: `${it.productName || ''} ${it.colorName || ''} ${it.sizeCode || ''} (${it.sku || it.variantId})`.trim()
      }))
    );
  };

  const addVariantToDraft = (variantId: string, labelText: string) => {
    if (draftItems.some((d) => d.variantId === variantId)) return;
    setDraftItems((prev) => [...prev, { variantId, unitsPerSale: 1, label: labelText }]);
  };

  const createListingAndBundle = async () => {
    const sourceId = parseSourceListingId();
    if (!sourceId) {
      showToast('error', 'Indicá la publicación individual de origen (un color)');
      return;
    }
    if (draftItems.length === 0) {
      showToast('error', 'Agregá las variantes del pack (negro, gris, blanco, etc.)');
      return;
    }
    setCreatingListing(true);
    try {
      const res = await api.createPublicationBundleListingFromSource({
        platform,
        sourceExternalProductId: sourceId,
        titleSuffix: titleSuffix.trim() || ' (Pack)',
        skuSuffix: skuSuffix.trim() || '-PACK',
        label: label.trim() || undefined,
        published: publishListing,
        items: draftItems.map((d) => ({ variantId: d.variantId, unitsPerSale: d.unitsPerSale }))
      });
      setListingInput(res.newExternalProductId);
      setVariantInput(res.newExternalVariantId || '');
      showToast('success', res.message || 'Publicación pack creada');
      resetForm();
      setLinkMode('existing');
      await loadBundles();
    } catch (e: any) {
      showToast('error', e?.message || 'No se pudo crear la publicación pack');
    } finally {
      setCreatingListing(false);
    }
  };

  const saveBundle = async () => {
    const { productId, varId } = parseListingIds();
    if (!productId) {
      showToast('error', 'Indicá el ID o link de la publicación');
      return;
    }
    if (draftItems.length === 0) {
      showToast('error', 'Agregá al menos una variante al pack');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        platform,
        externalProductId: productId,
        externalVariantId: varId || undefined,
        label: label.trim() || undefined,
        items: draftItems.map((d) => ({ variantId: d.variantId, unitsPerSale: d.unitsPerSale }))
      };
      if (editingId) {
        await api.updatePublicationBundle(editingId, payload);
        showToast('success', 'Pack actualizado');
      } else {
        await api.createPublicationBundle(payload);
        showToast('success', 'Pack creado');
      }
      resetForm();
      await loadBundles();
    } catch (e: any) {
      showToast('error', e?.message || 'Error guardando pack');
    } finally {
      setSaving(false);
    }
  };

  const removeBundle = async (id: string) => {
    if (!window.confirm('¿Eliminar este pack de publicación?')) return;
    try {
      await api.deletePublicationBundle(id);
      showToast('success', 'Pack eliminado');
      if (editingId === id) resetForm();
      await loadBundles();
    } catch {
      showToast('error', 'No se pudo eliminar');
    }
  };

  const syncStock = async (id: string) => {
    try {
      await api.syncPublicationBundleStock(id);
      showToast('success', 'Stock del pack sincronizado a la publicación');
      await loadBundles();
    } catch {
      showToast('error', 'Error al sincronizar stock');
    }
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
                Cada venta del pack descuenta stock de cada color/talle configurado (ej. pack x3: 1 negro + 1 gris + 1 blanco).
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
              <h3 className="text-sm font-bold text-violet-200">{editingId ? 'Editar pack' : 'Nuevo pack'}</h3>

              {!editingId && (
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
              )}

              {!editingId && linkMode === 'create' && (
                <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/20 p-3 space-y-3">
                  <p className="text-xs text-emerald-200/90">
                    Tomá una publicación <strong>individual</strong> (ej. boxer negro). El sistema crea una{' '}
                    <strong>nueva</strong> publicación pack con las <strong>mismas fotos</strong> y registra el pack
                    para descontar cada color al vender.
                  </p>
                  <div>
                    <label className="text-[11px] text-slate-500 block mb-1">
                      {platform === 'mercadolibre' ? 'Publicación origen (MLA / link)' : 'Producto origen TN'}
                    </label>
                    <input
                      value={sourceListingInput}
                      onChange={(e) => setSourceListingInput(e.target.value)}
                      placeholder={platform === 'mercadolibre' ? 'MLA de un color (ej. negro)' : 'ID producto TN de un color'}
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white font-mono text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-[11px] text-slate-500 block mb-1">Sufijo título</label>
                      <input
                        value={titleSuffix}
                        onChange={(e) => setTitleSuffix(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-500 block mb-1">Sufijo SKU</label>
                      <input
                        value={skuSuffix}
                        onChange={(e) => setSkuSuffix(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
                      />
                    </div>
                    <div className="flex items-end pb-1">
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
                  <label className="text-[11px] text-slate-500 block mb-1">Nombre (opcional)</label>
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Pack 3 boxer NGB"
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
                  />
                </div>
              </div>
              {(editingId || linkMode === 'existing') && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-slate-500 block mb-1">
                      {platform === 'mercadolibre' ? 'ID o link publicación pack' : 'ID o link producto pack TN'}
                    </label>
                    <input
                      value={listingInput}
                      onChange={(e) => setListingInput(e.target.value)}
                      placeholder={platform === 'mercadolibre' ? 'MLA del pack' : 'ID producto pack TN'}
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500 block mb-1">
                      {platform === 'mercadolibre' ? 'ID variación ML (opcional)' : 'ID variante TN del pack'}
                    </label>
                    <input
                      value={variantInput}
                      onChange={(e) => setVariantInput(e.target.value)}
                      placeholder="Si aplica"
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white font-mono text-sm"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="text-[11px] text-slate-500 block mb-1">Componentes del pack</label>
                {draftItems.length > 0 && (
                  <ul className="mb-2 space-y-1">
                    {draftItems.map((d) => (
                      <li
                        key={d.variantId}
                        className="flex items-center gap-2 py-2 px-3 rounded-lg bg-slate-800/80 border border-slate-700 text-sm"
                      >
                        <span className="flex-1 truncate text-slate-200">{d.label}</span>
                        <input
                          type="number"
                          min={1}
                          max={99}
                          value={d.unitsPerSale}
                          onChange={(e) => {
                            const n = Math.max(1, parseInt(e.target.value, 10) || 1);
                            setDraftItems((prev) =>
                              prev.map((x) => (x.variantId === d.variantId ? { ...x, unitsPerSale: n } : x))
                            );
                          }}
                          className="w-14 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-right text-xs"
                          title="Unidades a descontar por cada pack vendido"
                        />
                        <span className="text-[10px] text-slate-500">u/pack</span>
                        <button
                          type="button"
                          onClick={() => setDraftItems((prev) => prev.filter((x) => x.variantId !== d.variantId))}
                          className="text-slate-500 hover:text-red-400"
                        >
                          <Trash2 size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    value={variantSearch}
                    onChange={(e) => setVariantSearch(e.target.value)}
                    placeholder="Buscar variante por SKU, color, talle…"
                    className="w-full pl-9 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
                  />
                </div>
                <div className="mt-2 max-h-36 overflow-y-auto rounded-lg border border-slate-700 divide-y divide-slate-800">
                  {filteredVariants.map((v) => (
                    <button
                      key={v.variantId}
                      type="button"
                      onClick={() => addVariantToDraft(v.variantId, v.label)}
                      className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 flex items-center gap-2"
                    >
                      <Plus size={12} className="text-violet-400 shrink-0" />
                      <span className="truncate">{v.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {!editingId && linkMode === 'create' ? (
                  <button
                    type="button"
                    onClick={() => void createListingAndBundle()}
                    disabled={creatingListing || saving}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
                  >
                    {creatingListing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                    Crear publicación pack + guardar
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void saveBundle()}
                    disabled={saving}
                    className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold disabled:opacity-50"
                  >
                    {saving ? <Loader2 size={16} className="animate-spin inline" /> : null}{' '}
                    {editingId ? 'Guardar cambios' : 'Guardar pack'}
                  </button>
                )}
                {editingId ? (
                  <button type="button" onClick={resetForm} className="px-3 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm">
                    Cancelar edición
                  </button>
                ) : null}
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
            {bundles.length === 0 ? (
              <p className="text-sm text-slate-500">Todavía no hay packs. Creá uno para tu publicación de 3 boxer multicolor.</p>
            ) : (
              <ul className="space-y-2">
                {bundles.map((b) => (
                  <li key={b.id} className="rounded-xl border border-slate-700 bg-slate-800/50 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-white truncate">{b.label || b.externalProductId}</p>
                        <p className="text-xs font-mono text-slate-400">
                          {b.platform === 'mercadolibre' ? 'ML' : 'TN'} {b.externalProductId}
                          {b.externalVariantId ? ` / ${b.externalVariantId}` : ''}
                        </p>
                        <p className="text-xs text-emerald-400/90 mt-1">
                          Stock en publicación: {b.availableStock ?? '—'} pack(s) · {b.items.length} componente(s)
                        </p>
                        <p className="text-[10px] text-slate-500 mt-1">
                          {b.items
                            .map((it) => `${it.colorName || it.sku}×${it.unitsPerSale}`)
                            .join(' + ')}
                        </p>
                      </div>
                      {canEdit && (
                        <div className="flex flex-wrap gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => startEdit(b)}
                            className="px-2 py-1 rounded text-xs border border-slate-600 text-slate-300 hover:bg-slate-700"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => void syncStock(b.id)}
                            className="px-2 py-1 rounded text-xs border border-violet-700 text-violet-300 hover:bg-violet-900/30"
                          >
                            Sync stock
                          </button>
                          <button
                            type="button"
                            onClick={() => void removeBundle(b.id)}
                            className="px-2 py-1 rounded text-xs border border-red-900/50 text-red-400 hover:bg-red-950/30"
                          >
                            Eliminar
                          </button>
                        </div>
                      )}
                    </div>
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
