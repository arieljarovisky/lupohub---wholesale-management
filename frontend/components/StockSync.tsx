import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  HelpCircle,
  Loader2,
  PackageSearch,
  RefreshCw,
  Search,
  Send,
  ShoppingBag,
  ShoppingCart,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import { stockSyncApi, StockSyncOverview, SyncVariant } from '../services/stockSyncApi';
import { useNotification } from '../context/NotificationContext';

const REFRESH_MS = 15000;

function timeAgo(value: string | null | undefined): string {
  if (!value) return 'nunca';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 60) return 'recién';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} ${m === 1 ? 'minuto' : 'minutos'}`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} ${h === 1 ? 'hora' : 'horas'}`;
  const days = Math.round(h / 24);
  return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

function clock(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function variantName(v: SyncVariant | null | undefined): string {
  if (!v) return 'Producto';
  const parts = [v.productName, v.color, v.size ? `talle ${v.size}` : ''].filter(Boolean);
  return parts.join(' · ') || v.sku || 'Producto';
}

/** Botón grande y claro. */
const BigButton: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: 'primary' | 'secondary' | 'danger' | 'success';
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ onClick, disabled, loading, tone = 'primary', icon, children, className = '' }) => {
  const tones: Record<string, string> = {
    primary: 'bg-blue-600 hover:bg-blue-500 text-white',
    success: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    danger: 'bg-red-600 hover:bg-red-500 text-white',
    secondary: 'bg-slate-700 hover:bg-slate-600 text-white',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={`min-h-[56px] px-6 rounded-2xl text-lg font-bold inline-flex items-center justify-center gap-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-400 ${tones[tone]} ${className}`}
    >
      {loading ? <Loader2 size={24} className="animate-spin" /> : icon}
      <span>{children}</span>
    </button>
  );
};

const Section: React.FC<{ title: string; subtitle?: string; tone?: 'red' | 'amber' | 'slate'; children: React.ReactNode; action?: React.ReactNode }> = ({
  title,
  subtitle,
  tone = 'slate',
  children,
  action,
}) => {
  const border = tone === 'red' ? 'border-red-500/50' : tone === 'amber' ? 'border-amber-500/50' : 'border-slate-700';
  return (
    <section className={`bg-slate-900/60 border-2 ${border} rounded-3xl p-5 sm:p-7 space-y-5`}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h3 className="text-2xl font-black text-white">{title}</h3>
          {subtitle && <p className="text-lg text-slate-300 mt-1">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
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
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-6" role="dialog" aria-modal="true">
      <div className="bg-slate-900 border-2 border-slate-700 rounded-t-3xl sm:rounded-3xl w-full max-w-2xl max-h-[95vh] overflow-y-auto p-6 sm:p-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-2xl font-black text-white">¿Qué producto se vendió?</h3>
            <p className="text-lg text-slate-300 mt-2">
              {line.platformName}: <span className="text-white font-bold">{line.title || 'sin nombre'}</span>
              {line.sku && <> (código {line.sku})</>} — {line.quantity} {line.quantity === 1 ? 'unidad' : 'unidades'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white" aria-label="Cerrar">
            <X size={28} />
          </button>
        </div>

        {!chosen ? (
          <>
            <label className="block">
              <span className="text-lg font-bold text-white">1. Buscá el producto por nombre, código o color</span>
              <div className="mt-3 relative">
                <Search size={24} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Ej: bombacha negra"
                  className="w-full min-h-[60px] pl-14 pr-4 rounded-2xl bg-slate-800 border-2 border-slate-600 focus:border-blue-500 outline-none text-xl text-white placeholder:text-slate-500"
                />
              </div>
            </label>
            <div className="space-y-3">
              {searching && (
                <p className="text-lg text-slate-300 flex items-center gap-3">
                  <Loader2 className="animate-spin" /> Buscando…
                </p>
              )}
              {!searching && q.trim().length >= 2 && results.length === 0 && (
                <p className="text-lg text-slate-300">No encontré nada. Probá con otra palabra.</p>
              )}
              {results.map((v) => (
                <button
                  key={v.variantId}
                  type="button"
                  onClick={() => setChosen(v)}
                  className="w-full text-left min-h-[64px] p-4 rounded-2xl bg-slate-800 hover:bg-slate-700 border-2 border-transparent hover:border-blue-500 transition-colors"
                >
                  <div className="text-xl font-bold text-white">{variantName(v)}</div>
                  <div className="text-base text-slate-300">
                    Código {v.sku || '—'} · Stock actual: <span className="font-bold text-white">{v.stock}</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="p-5 rounded-2xl bg-blue-500/10 border-2 border-blue-500/50">
              <div className="text-base text-blue-200">Elegiste:</div>
              <div className="text-2xl font-black text-white">{variantName(chosen)}</div>
              <div className="text-lg text-slate-300">Stock actual: {chosen.stock}</div>
              <button type="button" onClick={() => setChosen(null)} className="mt-3 text-lg font-bold text-blue-300 underline">
                Elegir otro
              </button>
            </div>

            <div>
              <div className="text-lg font-bold text-white">2. ¿Cuántas unidades trae cada venta?</div>
              <p className="text-base text-slate-400">Si la publicación es un pack (por ejemplo "pack x3"), poné 3. Si es suelta, dejá 1.</p>
              <div className="mt-3 flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => setPack((p) => Math.max(1, p - 1))}
                  className="w-16 h-16 rounded-2xl bg-slate-700 hover:bg-slate-600 text-3xl font-black text-white"
                  aria-label="Menos"
                >
                  −
                </button>
                <div className="w-20 text-center text-4xl font-black text-white" aria-live="polite">
                  {pack}
                </div>
                <button
                  type="button"
                  onClick={() => setPack((p) => Math.min(100, p + 1))}
                  className="w-16 h-16 rounded-2xl bg-slate-700 hover:bg-slate-600 text-3xl font-black text-white"
                  aria-label="Más"
                >
                  +
                </button>
              </div>
            </div>

            <label className="flex items-start gap-4 p-4 rounded-2xl bg-slate-800 cursor-pointer">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-1 w-7 h-7 accent-blue-500" />
              <span className="text-lg text-white">
                Recordarlo para las próximas ventas
                <span className="block text-base text-slate-400">Así la próxima vez se descuenta solo.</span>
              </span>
            </label>

            <BigButton onClick={save} loading={saving} tone="success" icon={<CheckCircle2 size={26} />} className="w-full">
              Descontar {units} {units === 1 ? 'unidad' : 'unidades'}
            </BigButton>
          </>
        )}
      </div>
    </div>
  );
};

const StockSync: React.FC = () => {
  const { showToast, showConfirm } = useNotification();
  const [data, setData] = useState<StockSyncOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<StockSyncOverview['unmatched'][number] | null>(null);
  const [showTools, setShowTools] = useState(false);
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

  const run = async (key: string, fn: () => Promise<unknown>, okTone: 'success' | 'info' = 'success') => {
    setBusy(key);
    try {
      const r = (await fn()) as { message?: string } | undefined;
      if (r && typeof r.message === 'string' && r.message) showToast(okTone, r.message);
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

  if (!data) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center gap-6 text-center p-6">
        {loadError ? (
          <>
            <WifiOff size={56} className="text-red-400" />
            <p className="text-2xl font-bold text-white">{loadError}</p>
            <BigButton onClick={load} icon={<RefreshCw size={24} />}>
              Probar de nuevo
            </BigButton>
          </>
        ) : (
          <>
            <Loader2 size={56} className="animate-spin text-blue-400" />
            <p className="text-2xl font-bold text-white">Cargando…</p>
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
  const sending = data.queue.pending - data.queue.failing;

  // --- Mensaje principal ---
  let banner: { tone: string; icon: React.ReactNode; title: string; text: string };
  if (disconnected.length) {
    banner = {
      tone: 'bg-red-600/20 border-red-500',
      icon: <WifiOff size={56} className="text-red-300 shrink-0" />,
      title: `${disconnected.join(' y ')} no ${disconnected.length > 1 ? 'están conectados' : 'está conectado'}`,
      text: 'Mientras tanto el stock no se puede actualizar ahí. Conectalo en Configuración → Integraciones.',
    };
  } else if (problems > 0) {
    banner = {
      tone: 'bg-amber-500/15 border-amber-500',
      icon: <AlertTriangle size={56} className="text-amber-300 shrink-0" />,
      title: problems === 1 ? 'Hay 1 cosa para revisar' : `Hay ${problems} cosas para revisar`,
      text: 'Abajo te explico cada una y qué tocar. Lo demás funciona solo.',
    };
  } else if (sending > 0) {
    banner = {
      tone: 'bg-blue-600/15 border-blue-500',
      icon: <Loader2 size={56} className="text-blue-300 animate-spin shrink-0" />,
      title: `Actualizando ${sending} ${sending === 1 ? 'producto' : 'productos'}…`,
      text: 'Se están enviando los cambios a Mercado Libre y Tienda Nube. No tenés que hacer nada.',
    };
  } else {
    banner = {
      tone: 'bg-emerald-600/15 border-emerald-500',
      icon: <CheckCircle2 size={56} className="text-emerald-300 shrink-0" />,
      title: 'Todo al día',
      text: 'Mercado Libre y Tienda Nube tienen el mismo stock que este sistema. Las ventas se descuentan solas.',
    };
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto text-white">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-black">Stock y ventas</h2>
          <p className="text-lg text-slate-300 mt-1">Acá ves si Mercado Libre y Tienda Nube están al día con tu stock.</p>
        </div>
        <BigButton tone="secondary" onClick={() => run('reload', async () => undefined)} loading={busy === 'reload'} icon={<RefreshCw size={22} />}>
          Actualizar
        </BigButton>
      </div>

      {/* Mensaje principal */}
      <div className={`rounded-3xl border-2 p-6 sm:p-8 flex items-center gap-6 ${banner.tone}`} role="status" aria-live="polite">
        {banner.icon}
        <div>
          <div className="text-3xl font-black">{banner.title}</div>
          <p className="text-xl text-slate-200 mt-2">{banner.text}</p>
          <p className="text-base text-slate-400 mt-3">
            Última revisión de ventas: {timeAgo(data.ordersCheck.lastAt)}
            {!data.worker.alive && ' · El envío automático está arrancando…'}
          </p>
        </div>
      </div>

      {/* Paso único */}
      {!data.fullResync.enabled && !disconnected.length && (
        <Section
          title="Paso único: igualar el stock en todos lados"
          subtitle="Desde ahora este sistema es el que manda. Para empezar, conviene enviar una vez todo tu stock a Mercado Libre y Tienda Nube. Después se mantiene solo."
          tone="amber"
        >
          <BigButton onClick={confirmResyncAll} loading={busy === 'resync'} icon={<Send size={24} />}>
            Enviar mi stock ahora
          </BigButton>
        </Section>
      )}

      {/* Ventas sin identificar */}
      {data.unmatched.length > 0 && (
        <Section
          title="Ventas que no sé de qué producto son"
          subtitle="Llegó una venta pero no encontré el producto. Elegilo y lo descuento. Si marcás “recordar”, la próxima vez se hace solo."
          tone="red"
        >
          <div className="space-y-4">
            {data.unmatched.map((u) => (
              <div key={u.lineId} className="p-5 rounded-2xl bg-slate-800 space-y-4">
                <div className="flex items-start gap-4">
                  {u.platform === 'mercadolibre' ? (
                    <Zap size={32} className="text-yellow-300 shrink-0" />
                  ) : (
                    <ShoppingBag size={32} className="text-cyan-300 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xl font-bold">
                      Venta de {u.platformName}
                      {u.orderNumber ? ` #${u.orderNumber}` : ''} · {clock(u.date)}
                    </div>
                    <div className="text-lg text-slate-200 break-words">
                      {u.title || 'Sin nombre'}
                      {u.sku && <span className="text-slate-400"> (código {u.sku})</span>}
                    </div>
                    <div className="text-lg text-slate-200">
                      Cantidad: <span className="font-bold text-white">{u.quantity}</span>
                      {u.buyer && <span className="text-slate-400"> · Comprador: {u.buyer}</span>}
                    </div>
                    {u.reason && <div className="text-base text-amber-300 mt-1">{u.reason}</div>}
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <BigButton onClick={() => setChoosing(u)} icon={<PackageSearch size={24} />}>
                    Elegir producto
                  </BigButton>
                  <BigButton
                    tone="secondary"
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
                  >
                    Este producto no lo manejo acá
                  </BigButton>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Publicaciones que no se pudieron actualizar */}
      {data.failing.length > 0 && (
        <Section
          title="No pude actualizar estas publicaciones"
          subtitle="Lo sigo intentando solo. Si el motivo dice que hay que revisar el vínculo, corregilo en Inventario."
          tone="amber"
          action={
            <BigButton tone="secondary" loading={busy === 'retry-all'} onClick={() => run('retry-all', () => stockSyncApi.retryAll())} icon={<RefreshCw size={22} />}>
              Reintentar todo
            </BigButton>
          }
        >
          <div className="space-y-4">
            {data.failing.map((f) => (
              <div key={f.variant.variantId} className="p-5 rounded-2xl bg-slate-800 space-y-3">
                <div className="text-xl font-bold">{variantName(f.variant)}</div>
                <div className="text-lg text-slate-300">
                  Stock en el sistema: <span className="font-bold text-white">{f.variant.stock}</span>
                </div>
                <ul className="space-y-2">
                  {(f.targets.length ? f.targets : [{ label: '', error: f.error }]).map((t, i) => (
                    <li key={i} className="text-lg text-amber-200">
                      {t.label && <span className="font-bold text-white">{t.label}: </span>}
                      {t.error || 'Error desconocido'}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <BigButton
                    tone="secondary"
                    loading={busy === `retry-${f.variant.variantId}`}
                    onClick={() => run(`retry-${f.variant.variantId}`, () => stockSyncApi.retryOne(f.variant.variantId))}
                    icon={<RefreshCw size={22} />}
                  >
                    Reintentar ahora
                  </BigButton>
                  <span className="text-base text-slate-400">Próximo intento automático: {clock(f.nextTryAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Avisos */}
      {data.alerts.length > 0 && (
        <Section
          title="Ventas con poco stock"
          subtitle="Se vendió más de lo que había en el sistema. La venta se descontó igual (el stock puede quedar en negativo). Contá lo que hay y corregilo en Inventario."
          tone="amber"
          action={
            data.alerts.length > 1 ? (
              <BigButton tone="secondary" loading={busy === 'alerts-all'} onClick={() => run('alerts-all', () => stockSyncApi.dismissAllAlerts())}>
                Ya los vi todos
              </BigButton>
            ) : undefined
          }
        >
          <div className="space-y-4">
            {data.alerts.map((a) => (
              <div key={a.id} className="p-5 rounded-2xl bg-slate-800 flex flex-col sm:flex-row sm:items-center gap-4">
                <AlertTriangle size={32} className="text-amber-300 shrink-0" />
                <div className="flex-1 min-w-0">
                  {a.variant && <div className="text-xl font-bold">{variantName(a.variant)}</div>}
                  <div className="text-lg text-slate-200">{a.message}</div>
                  <div className="text-base text-slate-400">
                    {clock(a.date)}
                    {a.variant && <> · Stock ahora: <span className="font-bold text-white">{a.variant.stock}</span></>}
                  </div>
                </div>
                <BigButton tone="secondary" loading={busy === `alert-${a.id}`} onClick={() => run(`alert-${a.id}`, () => stockSyncApi.dismissAlert(a.id))}>
                  Entendido
                </BigButton>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Últimos movimientos */}
      <Section title="Lo último que pasó" subtitle="Ventas, pedidos y cambios de stock más recientes.">
        {data.recent.length === 0 ? (
          <p className="text-lg text-slate-300">Todavía no hay movimientos.</p>
        ) : (
          <ul className="divide-y divide-slate-700">
            {data.recent.map((m) => {
              const up = m.change > 0;
              const icon =
                m.type.includes('MERCADO_LIBRE') ? (
                  <Zap size={28} className="text-yellow-300" />
                ) : m.type.includes('TIENDA_NUBE') ? (
                  <ShoppingBag size={28} className="text-cyan-300" />
                ) : m.type === 'PEDIDO_MAYORISTA' ? (
                  <ShoppingCart size={28} className="text-blue-300" />
                ) : (
                  <RefreshCw size={28} className="text-slate-300" />
                );
              return (
                <li key={m.id} className="py-4 flex items-center gap-4">
                  <div className="shrink-0">{icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-lg font-bold">{m.what}</div>
                    <div className="text-base text-slate-300 truncate">{variantName(m.variant)}</div>
                    <div className="text-sm text-slate-500">{timeAgo(m.date)}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-2xl font-black flex items-center justify-end gap-1 ${up ? 'text-emerald-300' : 'text-red-300'}`}>
                      {up ? <ArrowUp size={22} /> : <ArrowDown size={22} />}
                      {Math.abs(m.change)}
                    </div>
                    <div className={`text-base ${m.stockAfter < 0 ? 'text-red-300 font-bold' : 'text-slate-300'}`}>quedan {m.stockAfter}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Herramientas (ocultas por defecto) */}
      <section className="bg-slate-900/60 border-2 border-slate-700 rounded-3xl">
        <button
          type="button"
          onClick={() => setShowTools((v) => !v)}
          className="w-full min-h-[64px] px-6 sm:px-7 flex items-center justify-between text-left"
          aria-expanded={showTools}
        >
          <span className="text-xl font-bold flex items-center gap-3">
            <HelpCircle size={26} className="text-slate-400" /> Herramientas (solo si algo no cierra)
          </span>
          <ChevronDown size={28} className={`transition-transform ${showTools ? 'rotate-180' : ''}`} />
        </button>
        {showTools && (
          <div className="px-6 sm:px-7 pb-7 space-y-6">
            <div className="space-y-2">
              <div className="text-lg font-bold">Revisar las ventas de las últimas 48 horas</div>
              <p className="text-base text-slate-400">Busca ventas que no se hayan descontado. Las que ya estaban descontadas no se tocan.</p>
              <BigButton tone="secondary" loading={busy === 'check'} onClick={() => run('check', () => stockSyncApi.checkOrders())} icon={<Search size={22} />}>
                Revisar ventas
              </BigButton>
            </div>

            <div className="space-y-2">
              <div className="text-lg font-bold">Volver a enviar todo el stock</div>
              <p className="text-base text-slate-400">Pone en Mercado Libre y Tienda Nube lo que dice este sistema. Se hace solo una vez por día.</p>
              <BigButton tone="secondary" loading={busy === 'resync'} onClick={confirmResyncAll} icon={<Send size={22} />}>
                Enviar todo de nuevo
              </BigButton>
              {data.fullResync.lastAt && <p className="text-base text-slate-500">Último envío completo: {timeAgo(data.fullResync.lastAt)}</p>}
            </div>

            <div className="space-y-3">
              <div className="text-lg font-bold">Procesar una venta puntual</div>
              <p className="text-base text-slate-400">Si una venta no se descontó, escribí su número. Si ya estaba descontada, no pasa nada.</p>
              <div className="flex flex-col sm:flex-row gap-3">
                <select
                  value={manualPlatform}
                  onChange={(e) => setManualPlatform(e.target.value as any)}
                  className="min-h-[56px] px-4 rounded-2xl bg-slate-800 border-2 border-slate-600 text-lg text-white"
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
                  className="flex-1 min-h-[56px] px-4 rounded-2xl bg-slate-800 border-2 border-slate-600 text-lg text-white placeholder:text-slate-500"
                />
                <BigButton
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
                </BigButton>
              </div>
            </div>

            {data.ordersCheck.errors.length > 0 && (
              <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/40">
                <div className="text-lg font-bold text-red-200">Problemas en la última revisión de ventas</div>
                <ul className="mt-2 space-y-1 text-base text-red-200">
                  {data.ordersCheck.errors.slice(0, 5).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

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
