import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Loader2,
  PackageSearch,
  RefreshCw,
  Search,
  Send,
  ShoppingCart,
  UserRound,
  WifiOff,
  Wrench,
  X,
} from 'lucide-react';
import { MercadoLibreLogo, TiendaNubeLogo } from './ChannelLogos';
import { ArticleHistory, stockSyncApi, StockSyncOverview, SyncVariant, VariantLink, WholesaleOrderRef } from '../services/stockSyncApi';
import { useNotification } from '../context/NotificationContext';
import { INVENTORY_STORAGE_KEY } from '../utils/inventoryUtils';

const REFRESH_MS = 15000;
const PAGE = 15;

type Tab = 'review' | 'recent' | 'tools';
type ReviewFilter = 'all' | 'unmatched' | 'failing' | 'alerts';

function timeAgo(value: string | null | undefined): string {
  if (!value) return 'nunca';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 60) return 'recién';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.round(h / 24);
  return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

function formatOrderDate(value: string | null | undefined): string {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
}

function WholesaleLine({ w }: { w: WholesaleOrderRef | null | undefined }) {
  if (!w?.orderId) return null;
  const when = formatOrderDate(w.date);
  const verb =
    w.direction === 'back' ? 'Volvió del pedido de' : w.direction === 'out' ? 'Salió en el pedido de' : 'Figura en el pedido de';
  return (
    <div className="text-xs text-blue-200 truncate" title={[`Pedido #${w.orderId}`, w.notes || ''].filter(Boolean).join(' · ')}>
      {verb} <span className="font-semibold text-white">{w.customer || 'cliente'}</span>
      {when ? ` · ${when}` : ''}
      {w.status ? ` · ${w.status}` : ''}
      {w.direction === 'none' ? <span className="text-slate-400"> · sin cambio de stock</span> : null}
    </div>
  );
}

function clock(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function variantName(v: SyncVariant | null | undefined): string {
  if (!v) return 'Producto';
  const parts = [v.productName, v.color, v.size ? `T. ${v.size}` : ''].filter(Boolean);
  return parts.join(' · ') || v.sku || 'Producto';
}

/** Motivo corto y entendible a partir del error técnico. */
function shortReason(error: string): string {
  const e = error || '';
  if (/no encuentro la variaci/i.test(e)) return 'La variación ya no existe en la publicación';
  if (/ya no existe en Tienda Nube/i.test(e)) return 'La variante ya no existe en Tienda Nube';
  if (/no existe en Mercado Libre|not.?found/i.test(e)) return 'La publicación ya no existe';
  if (/no está conectad|rechazó el acceso|venció el acceso/i.test(e)) return 'Hay que volver a conectar la cuenta';
  if (/muestra/i.test(e)) return 'La plataforma no tomó el cambio';
  return e.length > 90 ? `${e.slice(0, 90)}…` : e || 'Error desconocido';
}

function platformOf(text: string): 'mercadolibre' | 'tiendanube' | null {
  if (/mercado libre|\bML[A-Z]{1,2}\d/i.test(text)) return 'mercadolibre';
  if (/tienda nube/i.test(text)) return 'tiendanube';
  return null;
}

/** Abre Inventario con el artículo ya buscado (y los filtros limpios). */
function openInInventory(v: SyncVariant | null | undefined) {
  if (!v) return;
  const search = (v.productSku || v.sku || v.productName || '').trim();
  try {
    sessionStorage.setItem(
      INVENTORY_STORAGE_KEY,
      JSON.stringify({
        search,
        page: 1,
        subView: 'mine',
        hideZeroStock: false,
        showHiddenVariants: false,
        filterSize: 'ALL',
        filterCategory: 'ALL',
        filterColor: 'ALL',
      })
    );
  } catch {
    /* si el navegador no deja guardar, igual se abre Inventario */
  }
  window.location.hash = 'inventory';
}

/** Nombre del artículo que, al tocarlo, lleva a Inventario. */
const ProductLink: React.FC<{ variant: SyncVariant | null | undefined; className?: string }> = ({ variant, className = '' }) =>
  variant ? (
    <button
      type="button"
      onClick={() => openInInventory(variant)}
      title="Ver en Inventario"
      className={`text-left hover:text-blue-300 hover:underline underline-offset-2 focus:outline-none focus-visible:text-blue-300 ${className}`}
    >
      {variantName(variant)}
    </button>
  ) : (
    <span className={className}>Producto</span>
  );

const PlatformIcon: React.FC<{ platform: string | null; size?: number }> = ({ platform, size = 18 }) =>
  platform === 'mercadolibre' ? (
    <MercadoLibreLogo size={size} />
  ) : platform === 'tiendanube' ? (
    <TiendaNubeLogo size={size} />
  ) : (
    <ShoppingCart size={size} className="text-blue-300 shrink-0" aria-label="Pedido mayorista" />
  );

const Btn: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: 'primary' | 'secondary' | 'success' | 'ghost';
  icon?: React.ReactNode;
  children?: React.ReactNode;
  title?: string;
  className?: string;
}> = ({ onClick, disabled, loading, tone = 'secondary', icon, children, title, className = '' }) => {
  const tones: Record<string, string> = {
    primary: 'bg-blue-600 hover:bg-blue-500 text-white',
    success: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    secondary: 'bg-slate-700 hover:bg-slate-600 text-white',
    ghost: 'bg-transparent hover:bg-slate-700 text-slate-200',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      aria-label={title}
      className={`h-9 px-3 rounded-lg text-sm font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${tones[tone]} ${className}`}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : icon}
      {children && <span>{children}</span>}
    </button>
  );
};

/** Ventana para elegir el producto de una venta que no se pudo identificar. */
const ChooseProductModal: React.FC<{
  line: StockSyncOverview['unmatched'][number];
  onClose: () => void;
  onDone: () => void;
}> = ({ line, onClose, onDone }) => {
  const { showToast } = useNotification();
  const [q, setQ] = useState(line.sku || '');
  const [results, setResults] = useState<SyncVariant[]>([]);
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState<SyncVariant | null>(null);
  const [pack, setPack] = useState(1);
  const [remember, setRemember] = useState(true);
  const [saving, setSaving] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setResults([]);
      return;
    }
    const id = ++reqId.current;
    setSearching(true);
    const t = setTimeout(() => {
      stockSyncApi
        .searchVariants(text)
        .then((items) => {
          if (id === reqId.current) setResults(items);
        })
        .catch(() => {
          if (id === reqId.current) setResults([]);
        })
        .finally(() => {
          if (id === reqId.current) setSearching(false);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const units = line.quantity * pack;

  const save = async () => {
    if (!chosen) return;
    setSaving(true);
    try {
      const r = await stockSyncApi.resolveLine(line.lineId, chosen.variantId, pack, remember);
      showToast(r.ok ? 'success' : 'warning', r.message);
      onDone();
    } catch (e: any) {
      showToast('error', e?.message || 'No pude guardar. Probá de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center sm:p-6" role="dialog" aria-modal="true">
      <div className="bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-800">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-white">¿Qué producto se vendió?</h3>
            <p className="text-sm text-slate-400 truncate" title={line.title}>
              {line.platformName} · {line.title || 'sin nombre'}
              {line.sku && ` · ${line.sku}`} · {line.quantity} u.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300" aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          {!chosen ? (
            <>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar por nombre, código o color"
                  className="w-full h-10 pl-9 pr-3 rounded-lg bg-slate-800 border border-slate-600 focus:border-blue-500 outline-none text-sm text-white placeholder:text-slate-500"
                />
              </div>
              {searching && (
                <p className="text-sm text-slate-400 flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> Buscando…
                </p>
              )}
              {!searching && q.trim().length >= 2 && results.length === 0 && (
                <p className="text-sm text-slate-400">No encontré nada. Probá con otra palabra.</p>
              )}
              <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 overflow-hidden">
                {results.map((v) => (
                  <li key={v.variantId}>
                    <button
                      type="button"
                      onClick={() => setChosen(v)}
                      className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-center justify-between gap-3"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-white truncate">{variantName(v)}</span>
                        <span className="block text-xs text-slate-400">{v.sku || '—'}</span>
                      </span>
                      <span className="text-xs text-slate-300 shrink-0">Stock {v.stock}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/40">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-white truncate">{variantName(chosen)}</div>
                  <div className="text-xs text-slate-400">Stock actual: {chosen.stock}</div>
                </div>
                <button type="button" onClick={() => setChosen(null)} className="text-xs font-semibold text-blue-300 hover:underline shrink-0">
                  Cambiar
                </button>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">Unidades por venta</div>
                  <div className="text-xs text-slate-400">Si es "pack x3" poné 3; si es suelto, 1.</div>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setPack((p) => Math.max(1, p - 1))} className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 font-bold text-white" aria-label="Menos">
                    −
                  </button>
                  <span className="w-8 text-center text-lg font-bold text-white" aria-live="polite">
                    {pack}
                  </span>
                  <button type="button" onClick={() => setPack((p) => Math.min(100, p + 1))} className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 font-bold text-white" aria-label="Más">
                    +
                  </button>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="w-4 h-4 accent-blue-500" />
                Recordarlo para las próximas ventas
              </label>
            </>
          )}
        </div>

        {chosen && (
          <div className="p-4 border-t border-slate-800">
            <Btn tone="success" onClick={save} loading={saving} icon={<CheckCircle2 size={16} />} className="w-full h-10">
              Descontar {units} {units === 1 ? 'unidad' : 'unidades'}
            </Btn>
          </div>
        )}
      </div>
    </div>
  );
};

/** Ventana para corregir o quitar un vínculo roto con Mercado Libre / Tienda Nube. */
const FixLinkModal: React.FC<{
  variant: SyncVariant;
  onClose: () => void;
  onDone: () => void;
}> = ({ variant, onClose, onDone }) => {
  const { showToast, showConfirm } = useNotification();
  const [links, setLinks] = useState<VariantLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const loadLinks = useCallback(async () => {
    setError(null);
    try {
      const l = await stockSyncApi.links(variant.variantId);
      setLinks(l);
      const pre: Record<string, string> = {};
      for (const link of l) {
        const sug = link.options.find((o) => o.suggested);
        if (sug) pre[link.key] = sug.id;
      }
      setPicked(pre);
    } catch (e: any) {
      setError(e?.message || 'No pude cargar los vínculos.');
    }
  }, [variant.variantId]);

  useEffect(() => {
    loadLinks();
  }, [loadLinks]);

  const fix = async (link: VariantLink) => {
    const id = picked[link.key];
    if (!id) return;
    setSaving(`fix-${link.key}`);
    try {
      const r = await stockSyncApi.fixLink(variant.variantId, link.key, id);
      showToast('success', r.message);
      onDone();
    } catch (e: any) {
      showToast('error', e?.message || 'No pude corregir el vínculo.');
    } finally {
      setSaving(null);
    }
  };

  const remove = (link: VariantLink) =>
    showConfirm({
      title: 'Quitar vínculo',
      message: `${link.label} ya no va a recibir el stock de ${variantName(variant)}. ¿Seguro?`,
      confirmLabel: 'Sí, quitar',
      cancelLabel: 'Volver',
      onConfirm: async () => {
        setSaving(`remove-${link.key}`);
        try {
          const r = await stockSyncApi.removeLink(variant.variantId, link.key);
          showToast('success', r.message);
          onDone();
        } catch (e: any) {
          showToast('error', e?.message || 'No pude quitar el vínculo.');
        } finally {
          setSaving(null);
        }
      },
    });

  const broken = (links || []).filter((l) => l.ok === false);
  const healthy = (links || []).filter((l) => l.ok !== false);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center sm:p-6" role="dialog" aria-modal="true">
      <div className="bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-800">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-white">Arreglar vínculo</h3>
            <p className="text-sm text-slate-400 truncate">
              <ProductLink variant={variant} /> · stock {variant.stock}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300" aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          {error && (
            <div className="text-sm text-red-300 flex items-center justify-between gap-2">
              {error}
              <Btn onClick={loadLinks} icon={<RefreshCw size={14} />}>
                Reintentar
              </Btn>
            </div>
          )}
          {!links && !error && (
            <p className="text-sm text-slate-400 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Consultando la publicación…
            </p>
          )}
          {links && broken.length === 0 && (
            <p className="text-sm text-emerald-300 flex items-center gap-2">
              <CheckCircle2 size={16} /> Ya no hay vínculos con error. Tocá Actualizar.
            </p>
          )}

          {broken.map((link) => (
            <div key={link.key} className="rounded-lg border border-amber-500/40 overflow-hidden">
              <div className="px-3 py-2 bg-amber-500/10 flex items-center gap-2">
                <PlatformIcon platform={link.platform} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate" title={link.remoteTitle || link.label}>
                    {link.remoteTitle || link.label}
                  </div>
                  <div className="text-xs text-amber-200 truncate" title={link.error || ''}>
                    {shortReason(link.error || '')} · {link.label}
                  </div>
                </div>
              </div>

              {link.remoteError && <p className="px-3 py-2 text-xs text-slate-300">{link.remoteError}</p>}

              {link.options.length > 0 && (
                <>
                  <div className="px-3 pt-2 text-xs text-slate-400">Elegí la variación correcta:</div>
                  <ul className="max-h-60 overflow-y-auto divide-y divide-slate-800">
                    {link.options.map((o) => (
                      <li key={o.id}>
                        <label className="px-3 py-2 flex items-center gap-3 cursor-pointer hover:bg-slate-800/60">
                          <input
                            type="radio"
                            name={`opt-${link.key}`}
                            checked={picked[link.key] === o.id}
                            onChange={() => setPicked((p) => ({ ...p, [link.key]: o.id }))}
                            className="w-4 h-4 accent-blue-500"
                          />
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm text-white truncate">
                              {o.label}
                              {o.suggested && <span className="ml-2 px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-xs">Sugerida</span>}
                            </span>
                            <span className="block text-xs text-slate-400 truncate">
                              {o.sku || 'sin código'}
                              {o.usedBy.length > 0 && <span className="text-amber-300"> · ya usada por {o.usedBy[0]}{o.usedBy.length > 1 ? ` y ${o.usedBy.length - 1} más` : ''}</span>}
                            </span>
                          </span>
                          {o.stock != null && <span className="text-xs text-slate-400 shrink-0">stock {o.stock}</span>}
                        </label>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <div className="px-3 py-2 border-t border-slate-800 flex flex-wrap justify-end gap-2">
                <Btn tone="ghost" loading={saving === `remove-${link.key}`} onClick={() => remove(link)} icon={<X size={14} />}>
                  Quitar vínculo
                </Btn>
                {link.options.length > 0 && (
                  <Btn
                    tone="primary"
                    disabled={!picked[link.key] || picked[link.key] === link.externalVariantId}
                    loading={saving === `fix-${link.key}`}
                    onClick={() => fix(link)}
                    icon={<CheckCircle2 size={14} />}
                  >
                    Usar esta variación
                  </Btn>
                )}
              </div>
            </div>
          ))}

          {healthy.length > 0 && (
            <div className="text-xs text-slate-500">
              Funcionan bien: {healthy.map((l) => l.label).join(' · ')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const ArticleHistoryPanel: React.FC<{
  recent: StockSyncOverview['recent'];
  shown: number;
  onShowMore: () => void;
}> = ({ recent, shown, onShowMore }) => {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SyncVariant[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<SyncVariant | null>(null);
  const [history, setHistory] = useState<ArticleHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchReq = useRef(0);
  const historyReq = useRef(0);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2 || picked) {
      setResults([]);
      setSearching(false);
      return;
    }
    const id = ++searchReq.current;
    setSearching(true);
    const t = setTimeout(() => {
      stockSyncApi
        .searchVariants(text)
        .then((items) => {
          if (id === searchReq.current) setResults(items);
        })
        .catch(() => {
          if (id === searchReq.current) setResults([]);
        })
        .finally(() => {
          if (id === searchReq.current) setSearching(false);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [q, picked]);

  const loadHistory = async (params: { variantId?: string; productId?: string }, variant: SyncVariant | null) => {
    const id = ++historyReq.current;
    setPicked(variant);
    setQ('');
    setResults([]);
    setHistory(null);
    setLoading(true);
    setError(null);
    try {
      const data = await stockSyncApi.history(params);
      if (id !== historyReq.current) return;
      setHistory(data);
    } catch (e: any) {
      if (id !== historyReq.current) return;
      setHistory(null);
      setError(e?.message || 'No pude cargar el historial de este artículo.');
    } finally {
      if (id === historyReq.current) setLoading(false);
    }
  };

  const clearHistory = () => {
    historyReq.current += 1;
    setPicked(null);
    setHistory(null);
    setError(null);
    setQ('');
  };

  const movementRow = (m: {
    id: string;
    what: string;
    type: string;
    change: number;
    stockAfter: number;
    date: string;
    reference: string;
    actor?: string;
    variant: SyncVariant | null;
    wholesale?: WholesaleOrderRef | null;
  }) => {
    const manual = m.type === 'AJUSTE_MANUAL';
    const platform = m.type.includes('MERCADO_LIBRE') ? 'mercadolibre' : m.type.includes('TIENDA_NUBE') ? 'tiendanube' : null;
    const sku = (m.variant?.sku || m.variant?.productSku || '').trim();
    const actor =
      (m.actor || '').trim() ||
      (/^Ajuste por usuario:\s*(.+)$/i.exec(m.reference || '')?.[1] || '').trim();
    return (
      <li
        key={m.id}
        className={`px-3 py-2 flex items-center gap-3 ${manual ? 'bg-amber-500/[0.08] border-l-2 border-amber-400' : ''}`}
      >
        {manual ? (
          <span className="shrink-0 w-7 h-7 rounded-lg bg-amber-500/20 text-amber-200 flex items-center justify-center" title="Ajuste manual">
            <UserRound size={15} />
          </span>
        ) : m.type === 'PEDIDO_MAYORISTA' || m.type === 'DEVOLUCION' || platform ? (
          <PlatformIcon platform={platform} size={22} />
        ) : (
          <RefreshCw size={16} className="text-slate-400 shrink-0" />
        )}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {sku ? (
            <span className="shrink-0 font-mono text-xs font-semibold text-slate-100 bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded" title="SKU">
              {sku}
            </span>
          ) : null}
          <div className="min-w-0">
            <div className="text-sm truncate">
              <span className={`font-semibold ${manual ? 'text-amber-200' : ''}`}>{m.what}</span>
              <span className="text-slate-400"> · </span>
              <ProductLink variant={m.variant} className="text-slate-400" />
            </div>
            <WholesaleLine w={m.wholesale} />
            <div className="text-xs text-slate-500 truncate">
              {manual ? <span className="text-amber-200/90">{actor ? `por ${actor}` : 'usuario no identificado'}</span> : null}
              {manual ? ' · ' : ''}
              {timeAgo(m.date)}
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-sm font-bold inline-flex items-center gap-0.5 ${m.change > 0 ? 'text-emerald-300' : m.change < 0 ? 'text-red-300' : 'text-slate-400'}`}>
            {m.change > 0 ? <ArrowUp size={14} /> : m.change < 0 ? <ArrowDown size={14} /> : null}
            {m.change > 0 ? `+${m.change}` : m.change}
          </div>
          <div className={`text-xs ${m.stockAfter < 0 ? 'text-red-300 font-semibold' : 'text-slate-400'}`}>quedan {m.stockAfter}</div>
        </div>
        {m.variant && !picked ? (
          <Btn tone="ghost" title="Ver historial de este artículo" onClick={() => loadHistory({ variantId: m.variant!.variantId }, m.variant)}>
            Historial
          </Btn>
        ) : null}
      </li>
    );
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => {
            if (picked) clearHistory();
            setQ(e.target.value);
          }}
          placeholder="Buscar un artículo para ver su historial…"
          className="w-full h-10 pl-9 pr-3 rounded-lg bg-slate-900 border border-slate-700 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          aria-label="Buscar artículo"
        />
        {searching && <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />}
        {!picked && results.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
            {results.map((v) => (
              <li key={v.variantId}>
                <button
                  type="button"
                  onClick={() => loadHistory({ variantId: v.variantId }, v)}
                  className="w-full text-left px-3 py-2 hover:bg-slate-800 text-sm"
                >
                  <span className="font-mono text-xs text-slate-200">{v.sku || v.productSku}</span>
                  <span className="text-slate-300"> · {variantName(v)}</span>
                  <span className="text-slate-500"> · stock {v.stock}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {picked && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={clearHistory} className="text-sm font-semibold text-blue-300 hover:text-blue-200">
            Volver al historial general
          </button>
          {picked.productId && history?.scope === 'variant' && (
            <Btn tone="secondary" onClick={() => loadHistory({ productId: picked.productId }, picked)}>
              Ver todo el artículo
            </Btn>
          )}
          {picked.variantId && history?.scope === 'article' && (
            <Btn tone="secondary" onClick={() => loadHistory({ variantId: picked.variantId }, picked)}>
              Solo esta variante
            </Btn>
          )}
        </div>
      )}

      {picked && loading && (
        <div className="p-6 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
          <Loader2 size={16} className="animate-spin" />
          Cargando historial…
        </div>
      )}
      {error && <p className="text-sm text-red-300">{error}</p>}

      {picked && !loading && history && (
        <div className="space-y-3">
          <div>
            <h3 className="text-base font-bold text-white">{history.title}</h3>
            <p className="text-xs text-slate-400">
              {history.scope === 'article' ? 'Todas las variantes del artículo' : 'Esta variante'}
              {history.truncated ? ' · se muestran los últimos 1000 movimientos' : ''}
            </p>
          </div>
          <div className="rounded-lg border border-blue-500/40 bg-blue-500/10 p-3">
            <p className="text-sm font-semibold text-blue-100 mb-2">Pedidos mayoristas en los que salió</p>
            {history.orders.length === 0 ? (
              <p className="text-sm text-slate-300">No hay salidas en pedidos mayoristas.</p>
            ) : (
              <ul className="space-y-2">
                {history.orders.map((o) => {
                  const moved = o.unitsOut > 0 || o.unitsBack > 0;
                  return (
                    <li key={o.orderId} className="text-sm">
                      <div className="text-white">
                        <span className="font-semibold">{o.customer || 'Cliente'}</span>
                        {formatOrderDate(o.date) ? ` · ${formatOrderDate(o.date)}` : ''}
                        {o.status ? ` · ${o.status}` : ''}
                        {moved ? (
                          <>
                            {o.unitsOut > 0 ? <span className="text-blue-200"> · {o.unitsOut} u. salieron</span> : null}
                            {o.unitsBack > 0 ? <span className="text-emerald-300"> · {o.unitsBack} u. volvieron</span> : null}
                          </>
                        ) : (
                          <span className="text-slate-400"> · figura en el pedido, sin unidades descontadas</span>
                        )}
                      </div>
                      {o.notes ? <div className="text-xs text-cyan-200/90 truncate">{o.notes}</div> : null}
                      <div className="text-xs font-mono text-slate-400 truncate" title={o.orderId}>
                        Pedido #{o.orderId}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="rounded-lg border border-slate-800 overflow-hidden">
            {history.movements.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-400">Este artículo no tiene movimientos.</p>
            ) : (
              <ul className="divide-y divide-slate-800">{history.movements.map((m) => movementRow(m))}</ul>
            )}
          </div>
        </div>
      )}

      {!picked && !loading && (
        <div className="rounded-lg border border-slate-800 overflow-hidden">
          {recent.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-400">Todavía no hay movimientos.</p>
          ) : (
            <ul className="divide-y divide-slate-800">{recent.slice(0, shown).map((m) => movementRow(m))}</ul>
          )}
          {recent.length > shown && (
            <button
              type="button"
              onClick={onShowMore}
              className="w-full py-2 text-sm font-semibold text-blue-300 hover:bg-slate-900/60 border-t border-slate-800"
            >
              Ver más
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const StockSync: React.FC = () => {
  const { showToast, showConfirm } = useNotification();
  const [data, setData] = useState<StockSyncOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<StockSyncOverview['unmatched'][number] | null>(null);
  const [fixing, setFixing] = useState<SyncVariant | null>(null);
  const [tab, setTab] = useState<Tab>('recent');
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const [shown, setShown] = useState(PAGE);
  const [manualPlatform, setManualPlatform] = useState<'tiendanube' | 'mercadolibre'>('mercadolibre');
  const [manualOrder, setManualOrder] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await stockSyncApi.overview();
      setData(d);
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e?.message || 'No pude cargar el estado.');
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => setShown(PAGE), [filter, tab]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      const r = (await fn()) as { message?: string } | undefined;
      if (r && typeof r.message === 'string' && r.message) showToast('success', r.message);
      await load();
    } catch (e: any) {
      showToast('error', e?.message || 'Algo salió mal. Probá de nuevo.');
    } finally {
      setBusy(null);
    }
  };

  const confirmResyncAll = () =>
    showConfirm({
      title: 'Enviar todo el stock',
      message:
        'Vamos a poner en Mercado Libre y Tienda Nube el mismo stock que tenés en este sistema, para todos los productos vinculados. Revisá que el stock del sistema esté bien antes de seguir. ¿Continuamos?',
      confirmLabel: 'Sí, enviar todo',
      cancelLabel: 'No, todavía no',
      onConfirm: () => run('resync', () => stockSyncApi.resyncAll()),
    });

  // Una sola lista con todo lo que hay que revisar, para mostrarla como tabla compacta.
  const reviewRows = useMemo(() => {
    if (!data) return [];
    const rows: Array<
      | { kind: 'unmatched'; key: string; date: string; item: StockSyncOverview['unmatched'][number] }
      | { kind: 'failing'; key: string; date: string; item: StockSyncOverview['failing'][number] }
      | { kind: 'alerts'; key: string; date: string; item: StockSyncOverview['alerts'][number] }
    > = [];
    if (filter === 'all' || filter === 'unmatched') for (const u of data.unmatched) rows.push({ kind: 'unmatched', key: `u${u.lineId}`, date: u.date, item: u });
    if (filter === 'all' || filter === 'failing') for (const f of data.failing) rows.push({ kind: 'failing', key: `f${f.variant.variantId}`, date: f.nextTryAt, item: f });
    if (filter === 'all' || filter === 'alerts') for (const a of data.alerts) rows.push({ kind: 'alerts', key: `a${a.id}`, date: a.date, item: a });
    return rows;
  }, [data, filter]);

  if (!data) {
    return (
      <div className="min-h-[40vh] flex flex-col items-center justify-center gap-3 text-center p-6">
        {loadError ? (
          <>
            <WifiOff size={32} className="text-red-400" />
            <p className="text-base font-semibold text-white">{loadError}</p>
            <Btn onClick={load} icon={<RefreshCw size={16} />}>
              Probar de nuevo
            </Btn>
          </>
        ) : (
          <>
            <Loader2 size={28} className="animate-spin text-blue-400" />
            <p className="text-sm text-slate-300">Cargando…</p>
          </>
        )}
      </div>
    );
  }

  const disconnected = [
    !data.connections.mercadolibre ? 'Mercado Libre' : null,
    !data.connections.tiendanube ? 'Tienda Nube' : null,
  ].filter(Boolean) as string[];
  const problems = data.unmatched.length + data.failing.length + data.alerts.length;
  const staleCount = data.failing.reduce((n, f) => n + f.targets.filter((t) => t.stale).length, 0);
  const sending = Math.max(0, data.queue.pending - data.queue.failing);

  // Estado general en una línea.
  let status: { tone: string; icon: React.ReactNode; text: string };
  if (disconnected.length) {
    status = {
      tone: 'border-red-500/60 bg-red-500/10 text-red-200',
      icon: <WifiOff size={18} />,
      text: `${disconnected.join(' y ')} sin conectar. Conectalo en Configuración → Integraciones.`,
    };
  } else if (problems > 0) {
    status = {
      tone: 'border-amber-500/60 bg-amber-500/10 text-amber-200',
      icon: <AlertTriangle size={18} />,
      text: `${problems} ${problems === 1 ? 'cosa' : 'cosas'} para revisar. Lo demás se actualiza solo.`,
    };
  } else if (sending > 0) {
    status = {
      tone: 'border-blue-500/60 bg-blue-500/10 text-blue-200',
      icon: <Loader2 size={18} className="animate-spin" />,
      text: `Enviando ${sending} ${sending === 1 ? 'cambio' : 'cambios'} a Mercado Libre y Tienda Nube…`,
    };
  } else {
    status = {
      tone: 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200',
      icon: <CheckCircle2 size={18} />,
      text: 'Todo al día. Las ventas se descuentan solas.',
    };
  }

  const counters: Array<{ id: ReviewFilter; label: string; value: number; tone: string }> = [
    { id: 'unmatched', label: 'Ventas sin identificar', value: data.unmatched.length, tone: 'text-red-300' },
    { id: 'failing', label: 'Publicaciones con error', value: data.failing.length, tone: 'text-amber-300' },
    { id: 'alerts', label: 'Vendidas sin stock', value: data.alerts.length, tone: 'text-amber-300' },
  ];

  const tabBtn = (id: Tab, label: string, count?: number) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`h-9 px-3 rounded-lg text-sm font-semibold transition-colors ${tab === id ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
      aria-pressed={tab === id}
    >
      {label}
      {count ? <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-xs">{count}</span> : null}
    </button>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-4 text-white">
      {/* Encabezado */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold">Stock y ventas</h2>
          <p className="text-sm text-slate-400">Última revisión de ventas: {timeAgo(data.ordersCheck.lastAt)}</p>
        </div>
        <Btn onClick={() => run('reload', async () => undefined)} loading={busy === 'reload'} icon={<RefreshCw size={16} />}>
          Actualizar
        </Btn>
      </div>

      {/* Estado general */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium ${status.tone}`} role="status" aria-live="polite">
        {status.icon}
        <span>{status.text}</span>
      </div>

      {/* Paso único */}
      {!data.fullResync.enabled && !disconnected.length && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border border-blue-500/50 bg-blue-500/10">
          <p className="text-sm text-blue-100">
            <span className="font-bold">Paso único:</span> mandá una vez tu stock a Mercado Libre y Tienda Nube. Después se mantiene solo.
          </p>
          <Btn tone="primary" onClick={confirmResyncAll} loading={busy === 'resync'} icon={<Send size={16} />}>
            Enviar mi stock ahora
          </Btn>
        </div>
      )}

      {/* Contadores */}
      <div className="grid grid-cols-3 gap-3">
        {counters.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              setTab('review');
              setFilter(filter === c.id ? 'all' : c.id);
            }}
            className={`text-left p-3 rounded-lg border transition-colors ${filter === c.id && tab === 'review' ? 'border-blue-500 bg-slate-800' : 'border-slate-700 bg-slate-900/60 hover:bg-slate-800'}`}
          >
            <div className={`text-2xl font-bold ${c.value ? c.tone : 'text-slate-500'}`}>{c.value}</div>
            <div className="text-xs text-slate-400 leading-tight">{c.label}</div>
          </button>
        ))}
      </div>

      {/* Pestañas */}
      <div className="flex items-center gap-1 border-b border-slate-800 pb-2">
        {tabBtn('recent', 'Historial')}
        {tabBtn('review', 'Para revisar', problems)}
        {tabBtn('tools', 'Herramientas')}
      </div>

      {tab === 'review' && (
        <div className="rounded-lg border border-slate-800 overflow-hidden">
          {data.failing.length > 0 && (filter === 'all' || filter === 'failing') && (
            <div className="flex items-center justify-between gap-3 px-3 py-2 bg-slate-900/80 border-b border-slate-800">
              <span className="text-xs text-slate-400">Las publicaciones con error se reintentan solas.</span>
              <div className="flex items-center gap-1">
                {staleCount > 0 && (
                  <Btn
                    tone="primary"
                    loading={busy === 'cleanup'}
                    icon={<Wrench size={14} />}
                    onClick={() =>
                      showConfirm({
                        title: 'Limpiar vínculos viejos',
                        message: `Voy a quitar ${staleCount} vínculo(s) a publicaciones que ya no tienen ese producto. Solo los de productos que tienen otra publicación funcionando bien, así que ninguno se queda sin sincronizar. ¿Seguimos?`,
                        confirmLabel: 'Sí, limpiar',
                        cancelLabel: 'Volver',
                        onConfirm: () => run('cleanup', () => stockSyncApi.cleanupStaleLinks()),
                      })
                    }
                  >
                    Limpiar vínculos viejos ({staleCount})
                  </Btn>
                )}
                <Btn tone="ghost" loading={busy === 'retry-all'} onClick={() => run('retry-all', () => stockSyncApi.retryAll())} icon={<RefreshCw size={14} />}>
                  Reintentar todas
                </Btn>
              </div>
            </div>
          )}
          {reviewRows.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-400 flex flex-col items-center gap-2">
              <CheckCircle2 size={24} className="text-emerald-400" />
              No hay nada para revisar.
            </div>
          ) : (
            <ul className="divide-y divide-slate-800">
              {reviewRows.slice(0, shown).map((row) => {
                if (row.kind === 'unmatched') {
                  const u = row.item;
                  return (
                    <li key={row.key} className="px-3 py-2.5 flex items-center gap-3 hover:bg-slate-900/60">
                      <PlatformIcon platform={u.platform} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate" title={u.title}>
                          {u.title || 'Sin nombre'} <span className="font-normal text-slate-400">× {u.quantity}</span>
                        </div>
                        <div className="text-xs text-slate-400 truncate">
                          <span className="text-red-300">Venta sin identificar</span> · {u.platformName}
                          {u.orderNumber ? ` #${u.orderNumber}` : ''} · {clock(u.date)}
                          {u.sku && ` · ${u.sku}`}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Btn tone="primary" onClick={() => setChoosing(u)} icon={<PackageSearch size={14} />}>
                          Elegir producto
                        </Btn>
                        <Btn
                          tone="ghost"
                          title="No descontar esta venta"
                          loading={busy === `dismiss-${u.lineId}`}
                          onClick={() =>
                            showConfirm({
                              title: 'No descontar esta venta',
                              message: 'Esta venta no va a mover el stock de ningún producto. ¿Seguro?',
                              confirmLabel: 'Sí, no descontar',
                              cancelLabel: 'Volver',
                              onConfirm: () => run(`dismiss-${u.lineId}`, () => stockSyncApi.dismissLine(u.lineId)),
                            })
                          }
                          icon={<X size={14} />}
                        />
                      </div>
                    </li>
                  );
                }
                if (row.kind === 'failing') {
                  const f = row.item;
                  const targets: Array<{ label: string; error: string; stale?: boolean }> = f.targets.length
                    ? f.targets
                    : [{ label: '', error: f.error }];
                  const full = targets.map((t) => `${t.label ? `${t.label}: ` : ''}${t.error}`).join('\n');
                  const allStale = targets.every((t) => t.stale);
                  const itemId = (targets[0]?.label.match(/\b(ML[A-Z]{1,2}\d+|\d{6,})\b/) || [])[1];
                  return (
                    <li key={row.key} className="px-3 py-2.5 flex items-center gap-3 hover:bg-slate-900/60">
                      <PlatformIcon platform={platformOf(`${targets[0]?.label || ''} ${targets[0]?.error || ''}`)} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">
                          <ProductLink variant={f.variant} /> <span className="font-normal text-slate-400">· stock {f.variant.stock}</span>
                        </div>
                        <div className="text-xs text-slate-400 truncate" title={full}>
                          {allStale ? (
                            <>
                              <span className="text-slate-300">Vínculo viejo{itemId ? ` (${itemId})` : ''}: esa publicación ya no tiene este producto.</span>{' '}
                              <span className="text-emerald-300">La publicación principal está bien.</span>
                            </>
                          ) : (
                            <>
                              <span className="text-amber-300">{shortReason(targets[0]?.error || '')}</span>
                              {itemId && ` (${itemId})`}
                              {targets.length > 1 && ` (+${targets.length - 1})`} · próximo intento {clock(f.nextTryAt)}
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Btn tone="primary" onClick={() => setFixing(f.variant)} icon={<Wrench size={14} />}>
                          Arreglar
                        </Btn>
                        <Btn
                          tone="ghost"
                          title="Reintentar ahora"
                          loading={busy === `retry-${f.variant.variantId}`}
                          onClick={() => run(`retry-${f.variant.variantId}`, () => stockSyncApi.retryOne(f.variant.variantId))}
                          icon={<RefreshCw size={14} />}
                        />
                      </div>
                    </li>
                  );
                }
                const a = row.item;
                return (
                  <li key={row.key} className="px-3 py-2.5 flex items-center gap-3 hover:bg-slate-900/60">
                    <AlertTriangle size={16} className="text-amber-300 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">
                        <ProductLink variant={a.variant} />
                        {a.variant && <span className={`font-normal ${a.variant.stock < 0 ? 'text-red-300' : 'text-slate-400'}`}> · stock {a.variant.stock}</span>}
                      </div>
                      <div className="text-xs text-slate-400 truncate" title={a.message}>
                        <span className="text-amber-300">Se vendió sin stock</span> · {clock(a.date)} · contá y corregilo en Inventario
                      </div>
                    </div>
                    <Btn tone="ghost" loading={busy === `alert-${a.id}`} onClick={() => run(`alert-${a.id}`, () => stockSyncApi.dismissAlert(a.id))}>
                      Entendido
                    </Btn>
                  </li>
                );
              })}
            </ul>
          )}
          {reviewRows.length > shown && (
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE)}
              className="w-full py-2 text-sm font-semibold text-blue-300 hover:bg-slate-900/60 border-t border-slate-800"
            >
              Ver {Math.min(PAGE, reviewRows.length - shown)} más ({reviewRows.length - shown} restantes)
            </button>
          )}
          {filter === 'alerts' && data.alerts.length > 1 && (
            <div className="px-3 py-2 border-t border-slate-800 flex justify-end">
              <Btn tone="ghost" loading={busy === 'alerts-all'} onClick={() => run('alerts-all', () => stockSyncApi.dismissAllAlerts())}>
                Marcar todos como vistos
              </Btn>
            </div>
          )}
        </div>
      )}

      {tab === 'recent' && (
        <ArticleHistoryPanel
          recent={data.recent}
          shown={shown}
          onShowMore={() => setShown((n) => n + PAGE)}
        />
      )}

      {tab === 'tools' && (
        <div className="rounded-lg border border-slate-800 divide-y divide-slate-800">
          <div className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Revisar ventas de las últimas 48 h</div>
              <div className="text-xs text-slate-400">Busca ventas que no se hayan descontado. Las ya descontadas no se tocan.</div>
            </div>
            <Btn loading={busy === 'check'} onClick={() => run('check', () => stockSyncApi.checkOrders())} icon={<Search size={14} />}>
              Revisar ventas
            </Btn>
          </div>
          <div className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Volver a enviar todo el stock</div>
              <div className="text-xs text-slate-400">
                Pone en ML y TN lo que dice este sistema. Se repite solo una vez por día.
                {data.fullResync.lastAt && ` Último: ${timeAgo(data.fullResync.lastAt)}.`}
              </div>
            </div>
            <Btn loading={busy === 'resync'} onClick={confirmResyncAll} icon={<Send size={14} />}>
              Enviar todo
            </Btn>
          </div>
          <div className="p-3 space-y-2">
            <div>
              <div className="text-sm font-semibold">Procesar una venta puntual</div>
              <div className="text-xs text-slate-400">Si una venta no se descontó, escribí su número. Si ya estaba descontada, no pasa nada.</div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={manualPlatform}
                onChange={(e) => setManualPlatform(e.target.value as 'tiendanube' | 'mercadolibre')}
                className="h-9 px-2 rounded-lg bg-slate-800 border border-slate-600 text-sm text-white"
                aria-label="Dónde fue la venta"
              >
                <option value="mercadolibre">Mercado Libre</option>
                <option value="tiendanube">Tienda Nube</option>
              </select>
              <input
                value={manualOrder}
                onChange={(e) => setManualOrder(e.target.value)}
                inputMode="numeric"
                placeholder="Número de venta"
                className="flex-1 h-9 px-3 rounded-lg bg-slate-800 border border-slate-600 text-sm text-white placeholder:text-slate-500"
              />
              <Btn
                tone="primary"
                loading={busy === 'manual'}
                disabled={!manualOrder.trim()}
                onClick={() =>
                  run('manual', async () => {
                    const r = await stockSyncApi.reprocessOrder(manualPlatform, manualOrder.trim());
                    setManualOrder('');
                    return r;
                  })
                }
              >
                Procesar
              </Btn>
            </div>
          </div>
          {data.ordersCheck.errors.length > 0 && (
            <div className="p-3 text-xs text-red-200 bg-red-500/10">
              <div className="font-semibold mb-1">Problemas en la última revisión de ventas</div>
              <ul className="space-y-0.5">
                {data.ordersCheck.errors.slice(0, 5).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {fixing && (
        <FixLinkModal
          variant={fixing}
          onClose={() => setFixing(null)}
          onDone={() => {
            setFixing(null);
            load();
          }}
        />
      )}

      {choosing && (
        <ChooseProductModal
          line={choosing}
          onClose={() => setChoosing(null)}
          onDone={() => {
            setChoosing(null);
            load();
          }}
        />
      )}
    </div>
  );
};

export default StockSync;
