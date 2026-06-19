import React, { useCallback, useEffect, useState } from 'react';
import {
  Link,
  X,
  Zap,
  Cloud,
  Tag,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Search,
  Package,
} from 'lucide-react';
import { Product } from '../types';
import { api } from '../services/api';
import { labelTalle, codigoTalleParaSku } from '../utils/tallesTango';
import {
  normalizeMercadoLibreItemId,
  extractMercadoLibreVariationIdFromUrl,
} from '../utils/mercadoLibreItemId';
import { normalizeTiendaNubeProductId, extractTiendaNubeVariantFromUrl } from '../utils/tiendaNubeUrl';

const INVENTORY_PRODUCT_FETCH_OPTS = { includeRelated: false } as const;
const PACK_OPTIONS = [1, 2, 3, 6, 12] as const;

type Platform = 'mercadolibre' | 'tiendanube';

type ExternalVariantRow = {
  id: string;
  sku: string;
  color: string;
  size: string;
  stock: number;
};

type VariantPublication = {
  id: string;
  platform: string;
  external_product_id: string;
  external_variant_id: string;
  pack_size: number;
};

function formatSizeForLink(size: string | undefined | null): string {
  if (size == null || String(size).trim() === '') return '';
  const s = String(size).trim();
  if (/^\d{2,3}$/.test(s)) return labelTalle(s) || s;
  const code = codigoTalleParaSku(s);
  return code && code !== s ? `${code} - ${s}` : s;
}

function platformLabel(platform: string): string {
  return platform === 'mercadolibre' ? 'Mercado Libre' : 'Tienda Nube';
}

function platformShort(platform: string): string {
  return platform === 'mercadolibre' ? 'ML' : 'TN';
}

export interface LinkVariantModalProps {
  variant: Product | null;
  onClose: () => void;
  onSaved?: (payload: { groupKey?: string; variantId: string }) => void;
  showToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
}

const LinkVariantModal: React.FC<LinkVariantModalProps> = ({ variant, onClose, onSaved, showToast }) => {
  const [linkExternalSku, setLinkExternalSku] = useState('');
  const [linkProduct, setLinkProduct] = useState<{
    id: string;
    name?: string;
    sku?: string;
    price?: number;
    category?: string;
    description?: string;
  } | null>(null);
  const [linkPackMl, setLinkPackMl] = useState(1);
  const [linkPackTn, setLinkPackTn] = useState(1);
  const [variantPublications, setVariantPublications] = useState<VariantPublication[]>([]);
  const [loadingPublications, setLoadingPublications] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const [addPubPlatform, setAddPubPlatform] = useState<Platform>('mercadolibre');
  const [addPubProductId, setAddPubProductId] = useState('');
  const [addPubSelectedVariantId, setAddPubSelectedVariantId] = useState('');
  const [addPubPackSize, setAddPubPackSize] = useState(1);
  const [addPubSaving, setAddPubSaving] = useState(false);
  const [addPubVariants, setAddPubVariants] = useState<ExternalVariantRow[] | null>(null);
  const [loadingAddPubVariants, setLoadingAddPubVariants] = useState(false);
  const [addPubSearch, setAddPubSearch] = useState('');

  const refreshPublications = useCallback(() => {
    if (!variant?.id) {
      setVariantPublications([]);
      return;
    }
    setLoadingPublications(true);
    api
      .getVariantPublications(variant.id)
      .then(setVariantPublications)
      .catch(() => setVariantPublications([]))
      .finally(() => setLoadingPublications(false));
  }, [variant?.id]);

  useEffect(() => {
    if (!variant) return;
    setAddPubPlatform('mercadolibre');
    setAddPubProductId('');
    setAddPubSelectedVariantId('');
    setAddPubPackSize(1);
    setAddPubVariants(null);
    setAddPubSearch('');
    setLinkExternalSku((variant.sku ?? '').toString());
    setLinkProduct(null);
    setLinkPackMl(1);
    setLinkPackTn(1);
    refreshPublications();

    api.getVariantById(variant.id).then((v) => {
      const groupKey = (v?.base_sku || (variant as any).base_sku || '').toString().trim();
      if (!groupKey) return;
      api.getProductBySku(groupKey, INVENTORY_PRODUCT_FETCH_OPTS).then((p) => {
        if (p) {
          setLinkProduct({
            id: p.id,
            name: p.name,
            sku: p.sku,
            price: p.base_price,
            category: p.category,
            description: (p as any).description,
          });
          setLinkPackMl(p.mercado_libre_pack_size ?? 1);
          setLinkPackTn(p.tienda_nube_pack_size ?? 1);
          const variantRow = (p as any).variants?.find((x: any) => x.variant_id === variant.id);
          setLinkExternalSku((variantRow?.external_sku ?? variant.sku ?? '').toString());
        }
      });
    });
  }, [variant, refreshPublications]);

  const skuToMatch = (linkExternalSku || variant?.sku || '').toString().trim();

  const mapMlRows = (rows: { variationId: number | string; sku: string; color: string; size: string; stock: number }[]): ExternalVariantRow[] =>
    rows.map((v) => ({
      id: String(v.variationId),
      sku: v.sku,
      color: v.color,
      size: v.size,
      stock: v.stock,
    }));

  const mapTnRows = (rows: { variantId: number | string; sku: string; color: string; size: string; stock: number }[]): ExternalVariantRow[] =>
    rows.map((v) => ({
      id: String(v.variantId),
      sku: v.sku,
      color: v.color,
      size: v.size,
      stock: v.stock,
    }));

  const autoSelectVariant = (rows: ExternalVariantRow[], urlHint?: string) => {
    if (urlHint && rows.some((v) => v.id === urlHint)) {
      setAddPubSelectedVariantId(urlHint);
      return;
    }
    const match = rows.find((v) => v.sku && skuToMatch && v.sku.trim() === skuToMatch);
    if (match) setAddPubSelectedVariantId(match.id);
    else if (rows.length === 1) setAddPubSelectedVariantId(rows[0].id);
    else setAddPubSelectedVariantId('');
  };

  const handleLoadAddPubVariants = async () => {
    if (!addPubProductId.trim()) {
      showToast('error', 'Pegá el link o el ID de la publicación');
      return;
    }
    setLoadingAddPubVariants(true);
    setAddPubVariants(null);
    setAddPubSelectedVariantId('');
    try {
      if (addPubPlatform === 'mercadolibre') {
        const id = normalizeMercadoLibreItemId(addPubProductId);
        if (!id) {
          showToast('error', 'No se pudo obtener el ID de ML. Pegá el link o el MLA…');
          return;
        }
        const res = await api.getMercadoLibreItemVariations(id);
        const rows = mapMlRows(res.variations || []);
        setAddPubVariants(rows);
        autoSelectVariant(rows, extractMercadoLibreVariationIdFromUrl(addPubProductId) || undefined);
      } else {
        const id = normalizeTiendaNubeProductId(addPubProductId);
        if (!id || !/^\d+$/.test(id)) {
          showToast('error', 'No se pudo obtener el ID del producto TN. Pegá el link o el número.');
          return;
        }
        const res = await api.getTiendaNubeProductVariants(id);
        const rows = mapTnRows(res.variants || []);
        setAddPubVariants(rows);
        autoSelectVariant(rows, extractTiendaNubeVariantFromUrl(addPubProductId) || undefined);
      }
    } catch {
      showToast('error', 'No se pudieron cargar las variantes. Revisá el ID o el link.');
    } finally {
      setLoadingAddPubVariants(false);
    }
  };

  const syncPrimaryLinkIfNeeded = async (
    platform: Platform,
    externalProductId: string,
    externalVariantId: string
  ) => {
    if (!variant?.id) return;
    const v = await api.getVariantById(variant.id);
    const row = v as any;
    if (platform === 'tiendanube') {
      if (row?.tienda_nube_variant_id) return;
      await api.updateVariantExternalIds(variant.id, {
        tiendaNubeVariantId: externalVariantId || undefined,
        tiendaNubeProductId: externalProductId,
        externalSku: linkExternalSku.trim() || undefined,
      });
      if (linkProduct?.id) {
        await api.updateProductExternalIds(linkProduct.id, { tiendaNubeId: externalProductId });
      }
    } else {
      const isCatalog = /^ML[A-Z]{1,5}\d+$/i.test(externalProductId);
      const hasVariation = !!externalVariantId;
      const isOwnPublication = isCatalog && !hasVariation;
      if (row?.mercado_libre_item_id || row?.mercado_libre_variant_id) return;
      await api.updateVariantExternalIds(variant.id, {
        mercadoLibreItemId: isOwnPublication ? externalProductId : undefined,
        mercadoLibreVariantId: isOwnPublication
          ? undefined
          : hasVariation
            ? externalVariantId
            : !isCatalog
              ? externalProductId
              : undefined,
        externalSku: linkExternalSku.trim() || undefined,
      });
      if (linkProduct?.id && isCatalog && hasVariation) {
        await api.updateProductExternalIds(linkProduct.id, { mercadoLibreId: externalProductId });
      }
    }
  };

  const handleAddPublication = async () => {
    if (!variant?.id || !addPubProductId.trim()) {
      showToast('error', 'Ingresá el ID o el link de la publicación');
      return;
    }
    const mlProd = normalizeMercadoLibreItemId(addPubProductId);
    const tnProd = normalizeTiendaNubeProductId(addPubProductId);
    const externalProductId = addPubPlatform === 'mercadolibre' ? mlProd : tnProd;
    if (addPubPlatform === 'mercadolibre' && !externalProductId) {
      showToast('error', 'No se pudo obtener el ID de la publicación ML');
      return;
    }
    if (addPubPlatform === 'tiendanube' && (!externalProductId || !/^\d+$/.test(externalProductId))) {
      showToast('error', 'No se pudo obtener el ID del producto TN');
      return;
    }

    let externalVariantId = addPubSelectedVariantId.trim();
    if (!externalVariantId) {
      if (addPubPlatform === 'tiendanube') {
        externalVariantId = extractTiendaNubeVariantFromUrl(addPubProductId) || '';
      } else {
        externalVariantId = extractMercadoLibreVariationIdFromUrl(addPubProductId) || '';
      }
    }

    if (addPubVariants && addPubVariants.length > 1 && !externalVariantId) {
      showToast('error', 'Elegí una variante de la lista');
      return;
    }

    setAddPubSaving(true);
    try {
      await api.addVariantPublication(variant.id, {
        platform: addPubPlatform,
        externalProductId,
        externalVariantId: externalVariantId || undefined,
        packSize: addPubPackSize,
      });
      await syncPrimaryLinkIfNeeded(addPubPlatform, externalProductId, externalVariantId);
      showToast('success', 'Publicación vinculada. El stock se sincronizará a esta publicación.');
      setAddPubProductId('');
      setAddPubSelectedVariantId('');
      setAddPubVariants(null);
      setAddPubSearch('');
      setAddPubPackSize(addPubPlatform === 'mercadolibre' ? linkPackMl : linkPackTn);
      refreshPublications();
      onSaved?.({ variantId: variant.id });
    } catch (e: any) {
      showToast('error', e?.message || 'Error agregando publicación');
    } finally {
      setAddPubSaving(false);
    }
  };

  const handleDeletePublication = async (publicationId: string) => {
    if (!variant?.id) return;
    try {
      await api.deleteVariantPublication(variant.id, publicationId);
      showToast('success', 'Publicación desvinculada');
      refreshPublications();
    } catch (e: any) {
      showToast('error', e?.message || 'Error al desvincular');
    }
  };

  const handleSave = async () => {
    if (!variant) return;
    setSaving(true);
    try {
      await api.updateVariantExternalIds(variant.id, {
        externalSku: linkExternalSku.trim() || undefined,
      });
      if (linkProduct) {
        await api.updateProduct({
          ...linkProduct,
          id: linkProduct.id,
          name: linkProduct.name ?? '',
          sku: linkProduct.sku ?? '',
          price: linkProduct.price ?? 0,
          mercadoLibrePackSize: linkPackMl,
          tiendaNubePackSize: linkPackTn,
        } as Product & { mercadoLibrePackSize: number; tiendaNubePackSize: number });
      }
      showToast('success', 'Configuración guardada');
      const v = await api.getVariantById(variant.id);
      const groupKey = (v?.base_sku || (variant as any).base_sku || '').toString().trim();
      onSaved?.({ groupKey, variantId: variant.id });
      onClose();
    } catch {
      showToast('error', 'Error guardando configuración');
    } finally {
      setSaving(false);
    }
  };

  const handleUnlink = async (platform: 'tiendanube' | 'mercadolibre' | 'both') => {
    if (!variant || !linkProduct?.id) {
      showToast('error', 'No se pudo resolver el artículo para desvincular.');
      return;
    }
    try {
      const opts =
        platform === 'both'
          ? { tiendaNube: true, mercadoLibre: true, variants: true }
          : platform === 'tiendanube'
            ? { tiendaNube: true, mercadoLibre: false, variants: true }
            : { tiendaNube: false, mercadoLibre: true, variants: true };
      await api.unlinkProductPlatforms(linkProduct.id, opts);
      const msg =
        platform === 'both'
          ? 'Artículo desvinculado de TN y ML.'
          : platform === 'tiendanube'
            ? 'Artículo desvinculado de Tienda Nube.'
            : 'Artículo desvinculado de Mercado Libre.';
      showToast('success', msg);
      const v = await api.getVariantById(variant.id);
      const groupKey = (v?.base_sku || (variant as any).base_sku || '').toString().trim();
      onSaved?.({ groupKey, variantId: variant.id });
      onClose();
    } catch (e: any) {
      showToast('error', e?.message || 'Error al desvincular');
    }
  };

  if (!variant) return null;

  const variantSize = formatSizeForLink((variant as any).size || '');
  const variantColor = (variant as any).color || '';
  const filteredAddVariants = (addPubVariants || []).filter((v) => {
    const q = addPubSearch.trim().toLowerCase();
    if (!q) return true;
    return [v.sku, v.size, v.color, v.id].some((x) => String(x || '').toLowerCase().includes(q));
  });

  const isMl = addPubPlatform === 'mercadolibre';

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-700/80 w-full sm:max-w-2xl flex flex-col shadow-2xl max-h-[92vh] sm:max-h-[90vh] overflow-hidden">
        <div className="shrink-0 p-4 sm:p-5 border-b border-slate-700/80">
          <div className="flex justify-between items-start gap-3">
            <div className="min-w-0">
              <h3 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-indigo-500/20 shrink-0">
                  <Link size={18} className="text-indigo-400" />
                </span>
                Vincular publicaciones
              </h3>
              <p className="text-sm text-slate-400 mt-1 truncate">{variant.name}</p>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span className="font-mono text-xs text-white bg-slate-800 px-2 py-1 rounded-lg border border-slate-600">
                  {variant.sku}
                </span>
                {(variantSize || variantColor) && (
                  <span className="text-xs text-slate-400">
                    {[variantSize, variantColor].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700/80 transition shrink-0"
              aria-label="Cerrar"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5 min-h-0">
          {/* Publicaciones vinculadas */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Package size={14} />
                Publicaciones vinculadas
                {variantPublications.length > 0 && (
                  <span className="text-slate-500 font-normal">({variantPublications.length})</span>
                )}
              </h4>
            </div>

            {loadingPublications ? (
              <div className="flex items-center justify-center py-8 text-slate-500">
                <Loader2 size={20} className="animate-spin mr-2" />
                Cargando…
              </div>
            ) : variantPublications.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-600 bg-slate-800/30 p-6 text-center">
                <p className="text-sm text-slate-400">Todavía no hay publicaciones vinculadas.</p>
                <p className="text-xs text-slate-500 mt-1">Usá el formulario de abajo para agregar ML o TN.</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {variantPublications.map((pub) => {
                  const isPubMl = pub.platform === 'mercadolibre';
                  return (
                    <li
                      key={pub.id}
                      className={`flex items-center gap-3 py-3 px-3 rounded-xl border ${
                        isPubMl
                          ? 'bg-amber-950/20 border-amber-800/40'
                          : 'bg-cyan-950/20 border-cyan-800/40'
                      }`}
                    >
                      <span
                        className={`shrink-0 text-[10px] font-black uppercase px-2 py-1 rounded-md ${
                          isPubMl ? 'bg-amber-500/20 text-amber-300' : 'bg-cyan-500/20 text-cyan-300'
                        }`}
                      >
                        {platformShort(pub.platform)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-mono text-slate-200 truncate">
                          {pub.external_product_id}
                          {pub.external_variant_id ? ` / ${pub.external_variant_id}` : ''}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          Pack x{pub.pack_size} · {platformLabel(pub.platform)}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs font-bold text-indigo-300 bg-indigo-900/40 px-2 py-1 rounded-lg">
                        x{pub.pack_size}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeletePublication(pub.id)}
                        className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-slate-700/50 transition shrink-0"
                        aria-label="Quitar publicación"
                      >
                        <Trash2 size={15} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Agregar publicación */}
          <section className="rounded-xl border border-indigo-700/40 bg-indigo-950/20 p-4 space-y-4">
            <h4 className="text-xs font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-2">
              <Plus size={14} />
              Agregar publicación
            </h4>

            <div className="flex gap-2 p-1 rounded-xl bg-slate-800/80 border border-slate-700">
              <button
                type="button"
                onClick={() => {
                  setAddPubPlatform('mercadolibre');
                  setAddPubVariants(null);
                  setAddPubSelectedVariantId('');
                  setAddPubPackSize(linkPackMl);
                }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition ${
                  isMl ? 'bg-amber-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Zap size={15} />
                Mercado Libre
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddPubPlatform('tiendanube');
                  setAddPubVariants(null);
                  setAddPubSelectedVariantId('');
                  setAddPubPackSize(linkPackTn);
                }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition ${
                  !isMl ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Cloud size={15} />
                Tienda Nube
              </button>
            </div>

            <div>
              <label className="text-[11px] text-slate-500 block mb-1.5">
                {isMl ? 'Link o ID de publicación ML' : 'Link o ID de producto TN'}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={addPubProductId}
                  onChange={(e) => {
                    setAddPubProductId(e.target.value);
                    setAddPubVariants(null);
                    setAddPubSelectedVariantId('');
                  }}
                  placeholder={isMl ? 'https://… o MLA1234567890' : 'https://… o número de producto'}
                  className="flex-1 bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 focus:border-indigo-500 outline-none font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={handleLoadAddPubVariants}
                  disabled={!addPubProductId.trim() || loadingAddPubVariants}
                  className={`px-4 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50 whitespace-nowrap flex items-center gap-2 ${
                    isMl ? 'bg-amber-600 hover:bg-amber-500' : 'bg-cyan-600 hover:bg-cyan-500'
                  }`}
                >
                  {loadingAddPubVariants ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Search size={16} />
                  )}
                  Cargar variantes
                </button>
              </div>
            </div>

            {addPubVariants && addPubVariants.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[11px] text-slate-500">
                    Elegí la variante ({addPubVariants.length})
                  </label>
                  {addPubVariants.length > 4 && (
                    <input
                      type="text"
                      value={addPubSearch}
                      onChange={(e) => setAddPubSearch(e.target.value)}
                      placeholder="Filtrar por SKU, talle, color…"
                      className="w-44 bg-slate-800 border border-slate-600 rounded-lg px-2 py-1 text-white text-xs outline-none focus:border-indigo-500"
                    />
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                  {filteredAddVariants.map((v) => {
                    const selected = addPubSelectedVariantId === v.id;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setAddPubSelectedVariantId(v.id)}
                        className={`text-left p-3 rounded-xl border transition ${
                          selected
                            ? isMl
                              ? 'border-amber-500 bg-amber-950/40 ring-1 ring-amber-500/50'
                              : 'border-cyan-500 bg-cyan-950/40 ring-1 ring-cyan-500/50'
                            : 'border-slate-600 bg-slate-800/60 hover:border-slate-500'
                        }`}
                      >
                        <p className="text-xs font-mono text-white truncate">{v.sku || '(sin SKU)'}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {[formatSizeForLink(v.size), v.color].filter(Boolean).join(' · ') || '—'}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-1">ID {v.id} · stock {v.stock}</p>
                      </button>
                    );
                  })}
                </div>
                {filteredAddVariants.length === 0 && (
                  <p className="text-xs text-slate-500 text-center py-2">Sin coincidencias para el filtro.</p>
                )}
              </div>
            )}

            {addPubVariants && addPubVariants.length === 0 && (
              <p className="text-xs text-slate-500">
                Esta publicación no tiene variantes (venta por unidad). Podés vincularla directamente.
              </p>
            )}

            <div>
              <label className={`text-[11px] font-semibold uppercase tracking-wide block mb-2 ${isMl ? 'text-amber-400/90' : 'text-cyan-400/90'}`}>
                Pack (unidades por venta)
              </label>
              <div className="flex flex-wrap gap-2 items-center">
                {PACK_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setAddPubPackSize(n)}
                    className={`min-w-[44px] px-3 py-2 rounded-lg text-sm font-bold transition ${
                      addPubPackSize === n
                        ? isMl
                          ? 'bg-amber-500 text-white'
                          : 'bg-cyan-500 text-white'
                        : 'bg-slate-700/80 text-slate-400 hover:bg-slate-600 hover:text-white border border-slate-600/50'
                    }`}
                  >
                    x{n}
                  </button>
                ))}
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={addPubPackSize}
                  onChange={(e) => setAddPubPackSize(Math.max(1, Math.min(999, parseInt(e.target.value, 10) || 1)))}
                  className="w-20 bg-slate-800 border border-slate-600 rounded-lg px-2 py-2 text-white font-mono text-sm outline-none"
                  aria-label="Pack personalizado"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleAddPublication}
              disabled={addPubSaving || !addPubProductId.trim()}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold disabled:opacity-50 transition"
            >
              {addPubSaving ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
              Vincular esta publicación
            </button>
          </section>

          {/* SKU */}
          <section className="rounded-xl bg-slate-800/40 border border-slate-700/60 p-4 space-y-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
              <Tag size={12} />
              SKU unificado
            </p>
            <div className="flex gap-2 flex-wrap">
              <input
                type="text"
                value={linkExternalSku}
                onChange={(e) => setLinkExternalSku(e.target.value)}
                placeholder="Mismo código para inventario, ML y TN"
                className="flex-1 min-w-[140px] bg-slate-800 border border-slate-600 rounded-xl px-4 py-2.5 text-white font-mono text-sm outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={() => setLinkExternalSku(variant.sku)}
                className="px-3 py-2.5 rounded-xl bg-indigo-600/80 hover:bg-indigo-600 text-white text-xs font-bold whitespace-nowrap"
              >
                Usar mismo código
              </button>
            </div>
          </section>

          {/* Pack por defecto */}
          <section className="rounded-xl bg-slate-800/40 border border-slate-700/60 p-4 space-y-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
              Pack por defecto (nuevos vínculos)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] text-amber-400 font-semibold block mb-2">Mercado Libre</label>
                <div className="flex flex-wrap gap-2">
                  {PACK_OPTIONS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setLinkPackMl(n)}
                      className={`min-w-[40px] px-2.5 py-1.5 rounded-lg text-sm font-bold ${
                        linkPackMl === n ? 'bg-amber-500 text-white' : 'bg-slate-700 text-slate-400'
                      }`}
                    >
                      x{n}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] text-cyan-400 font-semibold block mb-2">Tienda Nube</label>
                <div className="flex flex-wrap gap-2">
                  {PACK_OPTIONS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setLinkPackTn(n)}
                      className={`min-w-[40px] px-2.5 py-1.5 rounded-lg text-sm font-bold ${
                        linkPackTn === n ? 'bg-cyan-500 text-white' : 'bg-slate-700 text-slate-400'
                      }`}
                    >
                      x{n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            className="w-full flex items-center justify-between gap-2 text-left text-xs text-slate-500 hover:text-slate-300 py-2"
          >
            <span>¿Cómo funciona el pack y el stock?</span>
            {showHelp ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {showHelp && (
            <ul className="text-[12px] text-slate-400 space-y-1.5 list-none pl-1 pb-2">
              <li>· Tu stock en depósito siempre está en unidades.</li>
              <li>· Cada publicación tiene su pack: x1 = venta por unidad, x2 = cada venta descuenta 2 unidades.</li>
              <li>· Podés vincular varias publicaciones a la misma variante (ej. una por unidad y otra pack x6).</li>
              <li>· Pegá el link o ID y tocá «Cargar variantes» para elegir talle/color automáticamente por SKU.</li>
            </ul>
          )}
        </div>

        <div className="shrink-0 p-4 sm:p-5 border-t border-slate-700/80 bg-slate-900/80 space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Desvincular</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleUnlink('tiendanube')}
              className="flex-1 min-w-[calc(50%-0.25rem)] sm:flex-initial px-3 py-2.5 rounded-xl font-semibold text-cyan-200 bg-cyan-900/20 hover:bg-cyan-800/30 border border-cyan-700/30 text-xs sm:text-sm min-h-[44px]"
            >
              Desvincular TN
            </button>
            <button
              type="button"
              onClick={() => handleUnlink('mercadolibre')}
              className="flex-1 min-w-[calc(50%-0.25rem)] sm:flex-initial px-3 py-2.5 rounded-xl font-semibold text-amber-200 bg-amber-900/20 hover:bg-amber-800/30 border border-amber-700/30 text-xs sm:text-sm min-h-[44px]"
            >
              Desvincular ML
            </button>
            <button
              type="button"
              onClick={() => handleUnlink('both')}
              className="w-full sm:w-auto px-3 py-2.5 rounded-xl font-semibold text-red-200 bg-red-900/20 hover:bg-red-800/30 border border-red-700/30 text-xs sm:text-sm min-h-[44px]"
            >
              Desvincular todo
            </button>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:justify-end pt-1 border-t border-slate-700/50">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl font-semibold text-slate-300 bg-slate-700/60 hover:bg-slate-600 border border-slate-600/60 text-sm min-h-[44px]"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="w-full sm:w-auto px-5 py-2.5 rounded-xl font-semibold bg-indigo-600 text-white hover:bg-indigo-500 flex items-center justify-center gap-2 text-sm min-h-[44px] disabled:opacity-50"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LinkVariantModal;
