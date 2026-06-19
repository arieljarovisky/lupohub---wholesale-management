import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cloud, Loader2, Plus, Search, Trash2, Zap } from 'lucide-react';
import { api } from '../services/api';
import { labelTalle, codigoTalleParaSku } from '../utils/tallesTango';
import {
  normalizeMercadoLibreItemId,
  extractMercadoLibreVariationIdFromUrl,
} from '../utils/mercadoLibreItemId';
import { normalizeTiendaNubeProductId, extractTiendaNubeVariantFromUrl } from '../utils/tiendaNubeUrl';

const PACK_OPTIONS = [1, 2, 3, 6, 12] as const;

type Platform = 'mercadolibre' | 'tiendanube';

type VariantPublication = {
  id: string;
  platform: string;
  external_product_id: string;
  external_variant_id: string;
  pack_size: number;
};

type ExternalVariantRow = {
  id: string;
  sku: string;
  color: string;
  size: string;
  stock: number;
};

function formatSizeForLink(size: string | undefined | null): string {
  if (size == null || String(size).trim() === '') return '';
  const s = String(size).trim();
  if (/^\d{2,3}$/.test(s)) return labelTalle(s) || s;
  const code = codigoTalleParaSku(s);
  return code && code !== s ? `${code} - ${s}` : s;
}

function platformShort(platform: string): string {
  return platform === 'mercadolibre' ? 'ML' : 'TN';
}

export interface VariantExtraPublicationsPanelProps {
  variantId: string;
  variantSku: string;
  productId: string | null;
  packMl: number;
  packTn: number;
  showToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
  onCountChange?: (count: number) => void;
}

const VariantExtraPublicationsPanel: React.FC<VariantExtraPublicationsPanelProps> = ({
  variantId,
  variantSku,
  productId,
  packMl,
  packTn,
  showToast,
  onCountChange,
}) => {
  const [publications, setPublications] = useState<VariantPublication[]>([]);
  const [loadingPublications, setLoadingPublications] = useState(true);
  const [addPubPlatform, setAddPubPlatform] = useState<Platform>('mercadolibre');
  const [addPubProductId, setAddPubProductId] = useState('');
  const [addPubSelectedVariantId, setAddPubSelectedVariantId] = useState('');
  const [addPubPackSize, setAddPubPackSize] = useState(1);
  const [addPubSaving, setAddPubSaving] = useState(false);
  const [addPubVariants, setAddPubVariants] = useState<ExternalVariantRow[] | null>(null);
  const [loadingAddPubVariants, setLoadingAddPubVariants] = useState(false);
  const [addPubSearch, setAddPubSearch] = useState('');

  const isMl = addPubPlatform === 'mercadolibre';
  const skuToMatch = variantSku.trim();
  const onCountChangeRef = useRef(onCountChange);
  onCountChangeRef.current = onCountChange;

  const refreshPublications = useCallback(() => {
    setLoadingPublications(true);
    return api
      .getVariantPublications(variantId)
      .then((rows) => {
        setPublications(rows);
        onCountChangeRef.current?.(rows.length);
      })
      .catch(() => {
        setPublications([]);
        onCountChangeRef.current?.(0);
      })
      .finally(() => setLoadingPublications(false));
  }, [variantId]);

  useEffect(() => {
    setAddPubPlatform('mercadolibre');
    setAddPubProductId('');
    setAddPubSelectedVariantId('');
    setAddPubPackSize(packMl);
    setAddPubVariants(null);
    setAddPubSearch('');
  }, [variantId, packMl, packTn]);

  useEffect(() => {
    let cancelled = false;
    setLoadingPublications(true);
    api
      .getVariantPublications(variantId)
      .then((rows) => {
        if (cancelled) return;
        setPublications(rows);
        onCountChangeRef.current?.(rows.length);
      })
      .catch(() => {
        if (cancelled) return;
        setPublications([]);
        onCountChangeRef.current?.(0);
      })
      .finally(() => {
        if (!cancelled) setLoadingPublications(false);
      });
    return () => {
      cancelled = true;
    };
  }, [variantId]);

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
          showToast('error', 'No se pudo obtener el ID de ML');
          return;
        }
        const res = await api.getMercadoLibreItemVariations(id);
        const rows = mapMlRows(res.variations || []);
        setAddPubVariants(rows);
        autoSelectVariant(rows, extractMercadoLibreVariationIdFromUrl(addPubProductId) || undefined);
      } else {
        const id = normalizeTiendaNubeProductId(addPubProductId);
        if (!id || !/^\d+$/.test(id)) {
          showToast('error', 'No se pudo obtener el ID del producto TN');
          return;
        }
        const res = await api.getTiendaNubeProductVariants(id);
        const rows = mapTnRows(res.variants || []);
        setAddPubVariants(rows);
        autoSelectVariant(rows, extractTiendaNubeVariantFromUrl(addPubProductId) || undefined);
      }
    } catch {
      showToast('error', 'No se pudieron cargar las variantes');
    } finally {
      setLoadingAddPubVariants(false);
    }
  };

  const syncPrimaryLinkIfNeeded = async (
    platform: Platform,
    externalProductId: string,
    externalVariantId: string
  ) => {
    const row = (await api.getVariantById(variantId)) as any;
    if (platform === 'tiendanube') {
      if (row?.tienda_nube_variant_id) return;
      await api.updateVariantExternalIds(variantId, {
        tiendaNubeVariantId: externalVariantId || undefined,
        tiendaNubeProductId: externalProductId,
        externalSku: skuToMatch || undefined,
      });
      if (productId) {
        await api.updateProductExternalIds(productId, { tiendaNubeId: externalProductId });
      }
    } else {
      const isCatalog = /^ML[A-Z]{1,5}\d+$/i.test(externalProductId);
      const hasVariation = !!externalVariantId;
      const isOwnPublication = isCatalog && !hasVariation;
      if (row?.mercado_libre_item_id || row?.mercado_libre_variant_id) return;
      await api.updateVariantExternalIds(variantId, {
        mercadoLibreItemId: isOwnPublication ? externalProductId : undefined,
        mercadoLibreVariantId: isOwnPublication
          ? undefined
          : hasVariation
            ? externalVariantId
            : !isCatalog
              ? externalProductId
              : undefined,
        externalSku: skuToMatch || undefined,
      });
      if (productId && isCatalog && hasVariation) {
        await api.updateProductExternalIds(productId, { mercadoLibreId: externalProductId });
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
      await api.addVariantPublication(variantId, {
        platform: addPubPlatform,
        externalProductId,
        externalVariantId: externalVariantId || undefined,
        packSize: addPubPackSize,
      });
      await syncPrimaryLinkIfNeeded(addPubPlatform, externalProductId, externalVariantId);
      showToast('success', 'Publicación vinculada — el stock se sincroniza a todas');
      setAddPubProductId('');
      setAddPubSelectedVariantId('');
      setAddPubVariants(null);
      setAddPubSearch('');
      setAddPubPackSize(addPubPlatform === 'mercadolibre' ? packMl : packTn);
      refreshPublications();
    } catch (e: any) {
      showToast('error', e?.message || 'Error agregando publicación');
    } finally {
      setAddPubSaving(false);
    }
  };

  const handleDeletePublication = async (publicationId: string) => {
    try {
      await api.deleteVariantPublication(variantId, publicationId);
      showToast('success', 'Publicación desvinculada');
      refreshPublications();
    } catch (e: any) {
      showToast('error', e?.message || 'Error al desvincular');
    }
  };

  const filteredAddVariants = useMemo(() => {
    const q = addPubSearch.trim().toLowerCase();
    if (!q) return addPubVariants || [];
    return (addPubVariants || []).filter((v) =>
      [v.sku, v.size, v.color, v.id].some((x) => String(x || '').toLowerCase().includes(q))
    );
  }, [addPubVariants, addPubSearch]);

  return (
    <div className="px-4 py-4 bg-slate-950/40 border-t border-indigo-800/30">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-xs font-semibold text-indigo-200">
          Publicaciones adicionales — el stock se sincroniza a todas las vinculadas
        </p>
        {loadingPublications ? (
          <Loader2 size={14} className="animate-spin text-slate-500" />
        ) : (
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {publications.length} vinculada{publications.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-2 min-h-[80px]">
          {loadingPublications ? (
            <div className="flex justify-center py-6">
              <Loader2 size={18} className="animate-spin text-slate-500" />
            </div>
          ) : publications.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center rounded-lg border border-dashed border-slate-700">
              Sin publicaciones extra. Agregá otra ML o TN para sincronizar stock en más canales.
            </p>
          ) : (
            publications.map((pub) => {
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
                    aria-label="Quitar publicación"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="rounded-xl border border-indigo-700/40 bg-indigo-950/15 p-3 space-y-3">
          <p className="text-[10px] font-bold text-indigo-300 uppercase tracking-wider">Agregar publicación</p>
          <div className="flex gap-1.5 p-1 rounded-lg bg-slate-800/80 border border-slate-700">
            <button
              type="button"
              onClick={() => {
                setAddPubPlatform('mercadolibre');
                setAddPubVariants(null);
                setAddPubSelectedVariantId('');
                setAddPubPackSize(packMl);
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
                setAddPubPackSize(packTn);
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
              className="flex-1 min-w-0 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white font-mono text-xs outline-none focus:border-indigo-500"
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
                {addPubVariants.length > 4 && (
                  <input
                    type="text"
                    value={addPubSearch}
                    onChange={(e) => setAddPubSearch(e.target.value)}
                    placeholder="Filtrar…"
                    className="w-28 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-xs outline-none"
                  />
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 max-h-[120px] overflow-y-auto">
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
            <span className="text-[11px] text-slate-500">Pack:</span>
            {PACK_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setAddPubPackSize(n)}
                className={`min-w-[32px] px-2 py-1 rounded-md text-xs font-bold ${
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
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold disabled:opacity-50"
          >
            {addPubSaving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Vincular y sincronizar stock
          </button>
        </div>
      </div>
    </div>
  );
};

export default VariantExtraPublicationsPanel;
