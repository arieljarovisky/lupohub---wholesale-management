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
  Search,
  Package,
  HelpCircle,
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

  const [addPubPlatform, setAddPubPlatform] = useState<Platform>('mercadolibre');
  const [addPubProductId, setAddPubProductId] = useState('');
  const [addPubSelectedVariantId, setAddPubSelectedVariantId] = useState('');
  const [addPubPackSize, setAddPubPackSize] = useState(1);
  const [addPubSaving, setAddPubSaving] = useState(false);
  const [addPubVariants, setAddPubVariants] = useState<ExternalVariantRow[] | null>(null);
  const [loadingAddPubVariants, setLoadingAddPubVariants] = useState(false);
  const [addPubSearch, setAddPubSearch] = useState('');
  const [mobilePanel, setMobilePanel] = useState<'linked' | 'add' | 'settings'>('add');

  const refreshPublications = useCallback(() => {
    if (!variant?.id) {
      setVariantPublications([]);
      return;
    }
    setLoadingPublications(true);
    api
      .getVariantPublications(variant!.id)
      .then(setVariantPublications)
      .catch(() => setVariantPublications([]))
      .finally(() => setLoadingPublications(false));
  }, [variant?.id]);

  useEffect(() => {
    if (!variant) return;
    setLinkExternalSku((variant.sku ?? '').toString());
    setLinkProduct(null);
    setLinkPackMl(1);
    setLinkPackTn(1);
    setAddPubPlatform('mercadolibre');
    setAddPubProductId('');
    setAddPubSelectedVariantId('');
    setAddPubPackSize(1);
    setAddPubVariants(null);
    setAddPubSearch('');
    refreshPublications();
    api.getVariantById(variant.id).then((v) => {
      const groupKey = (v?.base_sku || '').toString().trim();
      if (!groupKey) return;
      api.getProductBySku(groupKey, INVENTORY_PRODUCT_FETCH_OPTS).then((p) => {
        if (p) {
          setLinkProduct({ id: p.id, name: p.name, sku: p.sku, price: p.base_price, category: p.category, description: (p as any).description });
          setLinkPackMl(p.mercado_libre_pack_size ?? 1);
          setLinkPackTn(p.tienda_nube_pack_size ?? 1);
          const variantRow = (p as any).variants?.find((x: any) => x.variant_id === variant.id);
          setLinkExternalSku((variantRow?.external_sku ?? variant.sku ?? '').toString());
        }
      });
    });
  }, [variant, refreshPublications]);

  const skuToMatch = (linkExternalSku || variant?.sku || '').toString().trim();

  const mapMlRows = (
    rows: { variationId: number | string; sku: string; color: string; size: string; stock: number }[]
  ): ExternalVariantRow[] =>
    rows.map((v) => ({ id: String(v.variationId), sku: v.sku, color: v.color, size: v.size, stock: v.stock }));

  const mapTnRows = (
    rows: { variantId: number | string; sku: string; color: string; size: string; stock: number }[]
  ): ExternalVariantRow[] =>
    rows.map((v) => ({ id: String(v.variantId), sku: v.sku, color: v.color, size: v.size, stock: v.stock }));

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
    const v = await api.getVariantById(variant!.id);
    const row = v as any;
    if (platform === 'tiendanube') {
      if (row?.tienda_nube_variant_id) return;
      await api.updateVariantExternalIds(variant!.id, {
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
      await api.updateVariantExternalIds(variant!.id, {
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
    if (!addPubProductId.trim()) {
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
      externalVariantId =
        addPubPlatform === 'tiendanube'
          ? extractTiendaNubeVariantFromUrl(addPubProductId) || ''
          : extractMercadoLibreVariationIdFromUrl(addPubProductId) || '';
    }

    if (addPubVariants && addPubVariants.length > 1 && !externalVariantId) {
      showToast('error', 'Elegí una variante de la lista');
      return;
    }

    setAddPubSaving(true);
    try {
      await api.addVariantPublication(variant!.id, {
        platform: addPubPlatform,
        externalProductId,
        externalVariantId: externalVariantId || undefined,
        packSize: addPubPackSize,
      });
      await syncPrimaryLinkIfNeeded(addPubPlatform, externalProductId, externalVariantId);
      showToast('success', 'Publicación vinculada');
      setAddPubProductId('');
      setAddPubSelectedVariantId('');
      setAddPubVariants(null);
      setAddPubSearch('');
      setAddPubPackSize(addPubPlatform === 'mercadolibre' ? linkPackMl : linkPackTn);
      refreshPublications();
      onSaved?.({ variantId: variant!.id });
    } catch (e: any) {
      showToast('error', e?.message || 'Error agregando publicación');
    } finally {
      setAddPubSaving(false);
    }
  };

  const handleDeletePublication = async (publicationId: string) => {
    try {
      await api.deleteVariantPublication(variant!.id, publicationId);
      showToast('success', 'Publicación desvinculada');
      refreshPublications();
      onSaved?.({ variantId: variant!.id });
    } catch (e: any) {
      showToast('error', e?.message || 'Error al desvincular');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateVariantExternalIds(variant!.id, {
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
      const v = await api.getVariantById(variant!.id);
      const groupKey = (v?.base_sku || '').toString().trim();
      onSaved?.({ groupKey, variantId: variant!.id });
      onClose();
    } catch {
      showToast('error', 'Error guardando configuración');
    } finally {
      setSaving(false);
    }
  };

  const handleUnlink = async (platform: 'tiendanube' | 'mercadolibre' | 'both') => {
    if (!linkProduct?.id) {
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
      showToast('success', platform === 'both' ? 'Desvinculado de TN y ML' : platform === 'tiendanube' ? 'Desvinculado de TN' : 'Desvinculado de ML');
      onSaved?.({ variantId: variant!.id });
      onClose();
    } catch (e: any) {
      showToast('error', e?.message || 'Error al desvincular');
    }
  };

  if (!variant) return null;

  const variantSize = formatSizeForLink(variant.size || '');
  const variantColor = variant.color || '';
  const isMl = addPubPlatform === 'mercadolibre';
  const filteredAddVariants = (addPubVariants || []).filter((v) => {
    const q = addPubSearch.trim().toLowerCase();
    if (!q) return true;
    return [v.sku, v.size, v.color, v.id].some((x) => String(x || '').toLowerCase().includes(q));
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-700/80 w-full sm:max-w-5xl flex flex-col shadow-2xl max-h-[92vh] overflow-hidden">
      <div className="shrink-0 p-4 sm:p-5 border-b border-slate-700/80 flex justify-between items-start gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Link size={18} className="text-indigo-400 shrink-0" />
            Vincular publicaciones
          </h3>
          <p className="text-sm text-slate-400 truncate mt-1">{variant.name}</p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className="font-mono text-xs text-white bg-slate-800 px-2 py-1 rounded-lg border border-slate-600">{variant.sku}</span>
            {(variantSize || variantColor) && (
              <span className="text-xs text-slate-400">{[variantSize, variantColor].filter(Boolean).join(' · ')}</span>
            )}
          </div>
        </div>
        <button type="button" onClick={onClose} className="p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700/80 shrink-0" aria-label="Cerrar">
          <X size={20} />
        </button>
      </div>

      {/* Tabs móvil */}
      <div className="lg:hidden shrink-0 flex gap-1 p-1 rounded-xl bg-slate-800/80 border border-slate-700 mb-3">
        {(
          [
            ['linked', 'Vinculadas'],
            ['add', 'Agregar'],
            ['settings', 'Ajustes'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMobilePanel(id)}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition ${
              mobilePanel === id ? 'bg-indigo-600 text-white' : 'text-slate-400'
            }`}
          >
            {label}
            {id === 'linked' && variantPublications.length > 0 ? ` (${variantPublications.length})` : ''}
          </button>
        ))}
      </div>

      {/* Main grid — ocupa el alto disponible sin scroll de página */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0">
        {/* Columna izquierda: publicaciones vinculadas */}
        <section
          className={`lg:col-span-3 flex flex-col min-h-0 rounded-xl border border-slate-700/60 bg-slate-900/50 overflow-hidden ${
            mobilePanel === 'linked' ? 'flex' : 'hidden lg:flex'
          }`}
        >
          <div className="shrink-0 px-4 py-3 border-b border-slate-700/60 flex items-center gap-2">
            <Package size={15} className="text-slate-400" />
            <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
              Vinculadas {variantPublications.length > 0 && `(${variantPublications.length})`}
            </h2>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
            {loadingPublications ? (
              <div className="flex justify-center py-8 text-slate-500">
                <Loader2 size={20} className="animate-spin" />
              </div>
            ) : variantPublications.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-6 px-2">
                Sin publicaciones. Agregá una desde el panel central.
              </p>
            ) : (
              variantPublications.map((pub) => {
                const isPubMl = pub.platform === 'mercadolibre';
                return (
                  <div
                    key={pub.id}
                    className={`flex items-start gap-2 p-2.5 rounded-lg border text-sm ${
                      isPubMl ? 'bg-amber-950/25 border-amber-800/40' : 'bg-cyan-950/25 border-cyan-800/40'
                    }`}
                  >
                    <span
                      className={`shrink-0 text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                        isPubMl ? 'bg-amber-500/25 text-amber-300' : 'bg-cyan-500/25 text-cyan-300'
                      }`}
                    >
                      {platformShort(pub.platform)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-mono text-slate-200 break-all leading-tight">
                        {pub.external_product_id}
                        {pub.external_variant_id ? ` / ${pub.external_variant_id}` : ''}
                      </p>
                      <p className="text-[10px] text-slate-500 mt-0.5">Pack x{pub.pack_size}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeletePublication(pub.id)}
                      className="p-1 rounded text-slate-500 hover:text-red-400 shrink-0"
                      aria-label="Quitar"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Columna central: agregar publicación */}
        <section
          className={`lg:col-span-6 flex flex-col min-h-0 rounded-xl border border-indigo-700/40 bg-indigo-950/15 overflow-hidden ${
            mobilePanel === 'add' ? 'flex' : 'hidden lg:flex'
          }`}
        >
          <div className="shrink-0 px-4 py-3 border-b border-indigo-800/30 flex items-center gap-2">
            <Plus size={15} className="text-indigo-400" />
            <h2 className="text-xs font-bold text-indigo-300 uppercase tracking-wider">Agregar publicación</h2>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
            <div className="flex gap-1.5 p-1 rounded-lg bg-slate-800/80 border border-slate-700">
              <button
                type="button"
                onClick={() => {
                  setAddPubPlatform('mercadolibre');
                  setAddPubVariants(null);
                  setAddPubSelectedVariantId('');
                  setAddPubPackSize(linkPackMl);
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-bold transition ${
                  isMl ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Zap size={14} /> ML
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddPubPlatform('tiendanube');
                  setAddPubVariants(null);
                  setAddPubSelectedVariantId('');
                  setAddPubPackSize(linkPackTn);
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-bold transition ${
                  !isMl ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Cloud size={14} /> TN
              </button>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={addPubProductId}
                onChange={(e) => {
                  setAddPubProductId(e.target.value);
                  setAddPubVariants(null);
                  setAddPubSelectedVariantId('');
                }}
                placeholder={isMl ? 'Link o MLA…' : 'Link o ID producto TN'}
                className="flex-1 min-w-0 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white font-mono text-sm outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={handleLoadAddPubVariants}
                disabled={!addPubProductId.trim() || loadingAddPubVariants}
                className={`shrink-0 px-3 py-2 rounded-lg text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 ${
                  isMl ? 'bg-amber-600 hover:bg-amber-500' : 'bg-cyan-600 hover:bg-cyan-500'
                }`}
              >
                {loadingAddPubVariants ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                Cargar
              </button>
            </div>

            {addPubVariants && addPubVariants.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-500">Variante ({addPubVariants.length})</span>
                  {addPubVariants.length > 6 && (
                    <input
                      type="text"
                      value={addPubSearch}
                      onChange={(e) => setAddPubSearch(e.target.value)}
                      placeholder="Filtrar…"
                      className="w-32 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-xs outline-none"
                    />
                  )}
                </div>
                <div className="grid grid-cols-2 xl:grid-cols-3 gap-2 max-h-[140px] overflow-y-auto">
                  {filteredAddVariants.map((v) => {
                    const selected = addPubSelectedVariantId === v.id;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setAddPubSelectedVariantId(v.id)}
                        className={`text-left p-2 rounded-lg border text-[11px] transition ${
                          selected
                            ? isMl
                              ? 'border-amber-500 bg-amber-950/50'
                              : 'border-cyan-500 bg-cyan-950/50'
                            : 'border-slate-600 bg-slate-800/50 hover:border-slate-500'
                        }`}
                      >
                        <p className="font-mono text-white truncate">{v.sku || '—'}</p>
                        <p className="text-slate-400 truncate">
                          {[formatSizeForLink(v.size), v.color].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-slate-500 w-full sm:w-auto">Pack:</span>
              {PACK_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setAddPubPackSize(n)}
                  className={`min-w-[36px] px-2 py-1.5 rounded-md text-xs font-bold ${
                    addPubPackSize === n
                      ? isMl
                        ? 'bg-amber-500 text-white'
                        : 'bg-cyan-500 text-white'
                      : 'bg-slate-700 text-slate-400'
                  }`}
                >
                  x{n}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleAddPublication}
              disabled={addPubSaving || !addPubProductId.trim()}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold disabled:opacity-50"
            >
              {addPubSaving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Vincular publicación
            </button>
          </div>
        </section>

        {/* Columna derecha: SKU, packs, desvincular */}
        <section
          className={`lg:col-span-3 flex flex-col min-h-0 gap-3 overflow-hidden ${
            mobilePanel === 'settings' ? 'flex' : 'hidden lg:flex'
          }`}
        >
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-4 space-y-3 shrink-0">
            <p className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1.5">
              <Tag size={12} /> SKU unificado
            </p>
            <input
              type="text"
              value={linkExternalSku}
              onChange={(e) => setLinkExternalSku(e.target.value)}
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white font-mono text-sm outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              onClick={() => setLinkExternalSku(variant.sku)}
              className="w-full py-2 rounded-lg bg-indigo-600/80 hover:bg-indigo-600 text-white text-xs font-bold"
            >
              Usar mismo código
            </button>
          </div>

          <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-4 space-y-3 shrink-0">
            <p className="text-[10px] font-bold text-slate-400 uppercase">Pack por defecto</p>
            <div className="space-y-2">
              <div>
                <span className="text-[10px] text-amber-400 font-semibold">ML</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {PACK_OPTIONS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setLinkPackMl(n)}
                      className={`px-2 py-1 rounded text-xs font-bold ${linkPackMl === n ? 'bg-amber-500 text-white' : 'bg-slate-700 text-slate-400'}`}
                    >
                      x{n}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-[10px] text-cyan-400 font-semibold">TN</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {PACK_OPTIONS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setLinkPackTn(n)}
                      className={`px-2 py-1 rounded text-xs font-bold ${linkPackTn === n ? 'bg-cyan-500 text-white' : 'bg-slate-700 text-slate-400'}`}
                    >
                      x{n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-4 space-y-2 flex-1 min-h-0">
            <p className="text-[10px] font-bold text-slate-500 uppercase">Desvincular</p>
            <button
              type="button"
              onClick={() => handleUnlink('tiendanube')}
              className="w-full py-2 rounded-lg text-xs font-semibold text-cyan-200 bg-cyan-900/25 border border-cyan-800/40 hover:bg-cyan-900/40"
            >
              Desvincular TN
            </button>
            <button
              type="button"
              onClick={() => handleUnlink('mercadolibre')}
              className="w-full py-2 rounded-lg text-xs font-semibold text-amber-200 bg-amber-900/25 border border-amber-800/40 hover:bg-amber-900/40"
            >
              Desvincular ML
            </button>
            <button
              type="button"
              onClick={() => handleUnlink('both')}
              className="w-full py-2 rounded-lg text-xs font-semibold text-red-200 bg-red-900/25 border border-red-800/40 hover:bg-red-900/40"
            >
              Desvincular todo
            </button>
          </div>

          <div
            className="shrink-0 rounded-lg border border-slate-700/50 bg-slate-800/30 px-3 py-2 flex gap-2 text-[10px] text-slate-500"
            title="Stock en unidades; cada publicación tiene su pack (x2 descuenta 2 por venta). Podés vincular varias publicaciones."
          >
            <HelpCircle size={14} className="shrink-0 mt-0.5" />
            <span>Stock en unidades. Pack x2 = 2 unidades por venta. Varias publicaciones por variante.</span>
          </div>
        </section>
      </div>
      </div>

      <footer className="shrink-0 flex flex-col sm:flex-row gap-2 sm:justify-end p-4 sm:p-5 border-t border-slate-700/80 bg-slate-900/80">
        <button
          type="button"
          onClick={onClose}
          className="sm:order-1 px-5 py-2.5 rounded-xl font-semibold text-slate-300 bg-slate-700/60 hover:bg-slate-600 border border-slate-600/60 text-sm"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="sm:order-2 px-6 py-2.5 rounded-xl font-semibold bg-indigo-600 text-white hover:bg-indigo-500 flex items-center justify-center gap-2 text-sm disabled:opacity-50"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
          Guardar
        </button>
      </footer>
      </div>
    </div>
  );
};

export default LinkVariantModal;
