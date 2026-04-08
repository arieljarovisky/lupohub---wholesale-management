import React, { useEffect, useMemo, useState } from 'react';
import {
  Zap,
  Megaphone,
  Sparkles,
  LayoutGrid,
  Package,
  Settings,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  ExternalLink,
  Loader2,
  RefreshCw,
  TrendingUp,
  AlertTriangle,
  PlusCircle
} from 'lucide-react';
import { api } from '../services/api';
import { formatMoneyAr } from '../utils/moneyFormat';
import { loadProductAdsRecommendations, type RecRow } from '../utils/mercadoLibreProductAdsRecommendations';
import { useNotification } from '../context/NotificationContext';

interface MercadoLibreCanalDifusionProps {
  onNavigate?: (view: string) => void;
}

const TIPS: { title: string; body: string }[] = [
  {
    title: 'Orden sugerido',
    body: 'Primero base operativa (stock, envíos, preguntas). Después Product Ads en ítems que ya venden bien. Brand/Display cuando quieras escalar marca o una promo concreta.'
  },
  {
    title: 'Product Ads',
    body: 'Revisá semanalmente costo, ventas atribuidas y ROAS. Bajá puja o pausá anuncios con muchos clics y pocas ventas: suele ser ficha, precio o competencia.'
  },
  {
    title: 'Ficha y catálogo',
    body: 'Títulos claros, fotos consistentes y atributos completos mejoran conversión orgánica y hacen más eficiente la publicidad.'
  },
  {
    title: 'Stock en LupoHub',
    body: 'Mantené sincronizado el inventario con ML para evitar ventas sin unidad y penalizaciones.'
  }
];

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function RecTable({
  rows,
  kind
}: {
  rows: RecRow[];
  kind: 'scale' | 'review' | 'add';
}) {
  if (rows.length === 0) {
    return (
      <p className="text-xs text-slate-500 py-2">
        {kind === 'add'
          ? 'No hay candidatos con ventas orgánicas y stock que no aparecen en las métricas de pago del período.'
          : 'Ninguna publicación cumple estos criterios en el rango de fechas elegido.'}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm text-left">
        <thead>
          <tr className="text-slate-500 border-b border-slate-700/80">
            <th className="py-2 pr-3 font-medium">Publicación</th>
            <th className="py-2 pr-3 font-medium whitespace-nowrap">ID</th>
            {kind !== 'add' && (
              <>
                <th className="py-2 pr-3 font-medium whitespace-nowrap">ROAS</th>
                <th className="py-2 pr-3 font-medium whitespace-nowrap">Costo</th>
                <th className="py-2 pr-3 font-medium whitespace-nowrap">Ventas atrib.</th>
                <th className="py-2 pr-3 font-medium whitespace-nowrap">Clics</th>
              </>
            )}
            <th className="py-2 font-medium">Motivo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.itemId} className="border-b border-slate-800/80 text-slate-300">
              <td className="py-2 pr-3 max-w-[220px]">
                <span className="line-clamp-2" title={r.title}>
                  {r.title || '—'}
                </span>
              </td>
              <td className="py-2 pr-3 align-top whitespace-nowrap font-mono text-xs text-slate-500">
                {r.permalink ? (
                  <a
                    href={r.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-amber-400/90 hover:text-amber-300 underline-offset-2"
                  >
                    {r.itemId}
                  </a>
                ) : (
                  r.itemId
                )}
              </td>
              {kind !== 'add' && (
                <>
                  <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{r.roas > 0 ? `${r.roas.toFixed(2)}×` : '—'}</td>
                  <td className="py-2 pr-3 whitespace-nowrap tabular-nums">${formatMoneyAr(r.cost)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap tabular-nums">${formatMoneyAr(r.totalAmount)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{r.clicks}</td>
                </>
              )}
              <td className="py-2 text-slate-400 text-xs leading-snug">{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const MercadoLibreCanalDifusion: React.FC<MercadoLibreCanalDifusionProps> = ({ onNavigate }) => {
  const { showToast } = useNotification();
  const [glossaryOpen, setGlossaryOpen] = useState(false);

  const today = useMemo(() => new Date(), []);
  const [dateFrom, setDateFrom] = useState(() => {
    const t = new Date();
    t.setDate(t.getDate() - 29);
    return ymd(t);
  });
  const [dateTo, setDateTo] = useState(() => ymd(today));

  const [advertisers, setAdvertisers] = useState<Array<{ advertiser_id: number; site_id: string; advertiser_name: string; account_name: string }>>([]);
  const [advLoading, setAdvLoading] = useState(true);
  const [advError, setAdvError] = useState<string | null>(null);
  const [siteId, setSiteId] = useState('');
  const [advertiserId, setAdvertiserId] = useState<number | ''>('');

  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [potenciar, setPotenciar] = useState<RecRow[]>([]);
  const [revisar, setRevisar] = useState<RecRow[]>([]);
  const [sumar, setSumar] = useState<RecRow[]>([]);
  const [lanzamientos, setLanzamientos] = useState<RecRow[]>([]);
  const [recStats, setRecStats] = useState<{ adsAnalyzed: number; stockFetched: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setAdvLoading(true);
      setAdvError(null);
      try {
        const res = await api.getMercadoLibreProductAdsAdvertisers();
        if (cancelled) return;
        const list = Array.isArray(res?.advertisers) ? res.advertisers : [];
        setAdvertisers(list);
        if (list.length > 0) {
          setSiteId((prev) => prev || list[0].site_id);
          setAdvertiserId((prev) => (prev === '' ? list[0].advertiser_id : prev));
        }
      } catch (e: unknown) {
        if (cancelled) return;
        const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : 'No se pudieron cargar los anunciantes';
        setAdvError(msg);
        setAdvertisers([]);
      } finally {
        if (!cancelled) setAdvLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runRecommendations = async () => {
    if (!siteId || advertiserId === '') {
      showToast('warning', 'Elegí una cuenta de Mercado Ads');
      return;
    }
    setRecLoading(true);
    setRecError(null);
    try {
      const out = await loadProductAdsRecommendations(siteId, advertiserId as number, dateFrom, dateTo);
      setPotenciar(out.potenciar);
      setRevisar(out.revisar);
      setSumar(out.sumar);
      setLanzamientos(out.lanzamientos);
      setRecStats(out.stats);
    } catch (e: unknown) {
      const ax = e && typeof e === 'object' ? (e as { message?: string; response?: { data?: { message?: string } } }) : null;
      const msg =
        ax?.response?.data?.message || ax?.message || 'Error al generar recomendaciones';
      setRecError(msg);
      setPotenciar([]);
      setRevisar([]);
      setSumar([]);
      setLanzamientos([]);
      setRecStats(null);
      showToast('error', msg);
    } finally {
      setRecLoading(false);
    }
  };

  const go = (view: string) => onNavigate?.(view);

  const links = [
    {
      view: 'mercadolibre_orders',
      icon: Zap,
      title: 'Ventas Mercado Libre',
      desc: 'Pedidos, envíos y preguntas de compradores.',
      color: 'from-amber-500/20 to-yellow-600/10 border-amber-500/30'
    },
    {
      view: 'mercadolibre_product_ads',
      icon: Megaphone,
      title: 'Product Ads',
      desc: 'Campañas y métricas por publicación.',
      color: 'from-yellow-500/15 to-amber-600/10 border-yellow-500/25'
    },
    {
      view: 'mercadolibre_brand_ads',
      icon: Sparkles,
      title: 'Brand Ads',
      desc: 'Visibilidad de marca en Mercado Libre.',
      color: 'from-violet-500/15 to-purple-600/10 border-violet-500/25'
    },
    {
      view: 'mercadolibre_display_ads',
      icon: LayoutGrid,
      title: 'Display Ads',
      desc: 'Banners y campañas de display.',
      color: 'from-cyan-500/15 to-teal-600/10 border-cyan-500/25'
    },
    {
      view: 'inventory',
      icon: Package,
      title: 'Inventario',
      desc: 'Stock, vínculos con publicaciones ML y sincronización.',
      color: 'from-emerald-500/15 to-green-600/10 border-emerald-500/25'
    },
    {
      view: 'settings',
      icon: Settings,
      title: 'Configuración',
      desc: 'Integración OAuth, sync de productos y opciones de IA.',
      color: 'from-slate-600/40 to-slate-700/30 border-slate-500/30'
    }
  ];

  const topPotenciar = potenciar.slice(0, 3);
  const topSumar = sumar.slice(0, 3);
  const topRevisar = revisar.slice(0, 2);
  const topLanzamientos = lanzamientos.slice(0, 3);

  const accionesSugeridas = useMemo(() => {
    const out: string[] = [];
    if (topLanzamientos.length > 0) {
      out.push(`Comunicá ${topLanzamientos.length} lanzamientos (publicaciones creadas en últimos 30 días).`);
    }
    if (topPotenciar.length > 0) {
      out.push(`Subí inversión en ${topPotenciar.length} publicaciones con mejor ROAS para capturar más demanda.`);
    }
    if (topSumar.length > 0) {
      out.push(`Probá campañas en ${topSumar.length} publicaciones con ventas orgánicas y stock disponible.`);
    }
    if (topRevisar.length > 0) {
      out.push(`Revisá o pausá ${topRevisar.length} publicaciones con bajo retorno para evitar gasto ineficiente.`);
    }
    if (out.length === 0) {
      out.push('Generá recomendaciones para ver un plan accionable del período elegido.');
    }
    return out;
  }, [topLanzamientos.length, topPotenciar.length, topSumar.length, topRevisar.length]);

  const ideasComunicacion = useMemo(() => {
    const ideas: Array<{ title: string; text: string }> = [];
    if (topLanzamientos[0]) {
      ideas.push({
        title: 'Idea lanzamiento',
        text: `Lanzamiento recomendado: ${topLanzamientos[0].title}. Está dentro de los últimos 30 días, ideal para comunicar como novedad.`
      });
    }
    if (topSumar[0]) {
      ideas.push({
        title: 'Idea producto en promoción',
        text: `Oferta recomendada: ${topSumar[0].title}. Ya tiene demanda orgánica, ideal para empujar conversión.`
      });
    }
    if (topRevisar[0]) {
      ideas.push({
        title: 'Idea cupón selectivo',
        text: `Activá cupón por tiempo limitado en ${topRevisar[0].title} para recuperar conversión sin subir puja.`
      });
    }
    return ideas;
  }, [topLanzamientos, topPotenciar, topSumar, topRevisar]);

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-slate-700/80 bg-gradient-to-br from-slate-900/90 to-slate-950 p-6 md:p-8">
        <p className="text-slate-300 text-sm md:text-base leading-relaxed max-w-3xl">
          En Mercado Libre, <strong className="text-white font-semibold">difundir</strong> tu oferta es la suma de la{' '}
          <strong className="text-amber-200/90">visibilidad orgánica</strong> (reputación, envíos, catálogo) y los{' '}
          <strong className="text-yellow-200/90">canales de publicidad</strong> (Product, Brand y Display Ads). Esta
          pantalla agrupa las herramientas de LupoHub y una lista prioritaria para decidir qué tocar primero.
        </p>
      </div>

      <div className="rounded-2xl border border-amber-500/25 bg-gradient-to-br from-amber-950/40 to-slate-950 p-6 md:p-8">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-6">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <TrendingUp className="text-amber-400 shrink-0" size={22} />
              Qué publicidades promover
            </h2>
            <p className="text-slate-400 text-sm mt-2 max-w-2xl leading-relaxed">
              Usamos las métricas de <strong className="text-slate-300">Product Ads</strong> del período (misma API que la pantalla de campañas) y tu{' '}
              <strong className="text-slate-300">listado de publicaciones activas</strong> para sugerir dónde invertir más, dónde revisar y qué ítems con venta
              orgánica podrías sumar a campañas.
            </p>
          </div>
          <button
            type="button"
            onClick={runRecommendations}
            disabled={recLoading || advLoading || !siteId || advertiserId === ''}
            className="shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm"
          >
            {recLoading ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
            {recLoading ? 'Analizando…' : 'Generar recomendaciones'}
          </button>
        </div>

        <div className="mb-6 rounded-xl border border-slate-700/70 bg-slate-900/40 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-sm text-slate-200 font-semibold">Canal de difusión de Mercado Libre</p>
              <p className="text-xs text-slate-500 mt-1">
                La publicación de comunicaciones se hace desde Mercado Libre. Desde LupoHub te guiamos con qué comunicar y qué artículos impulsar.
              </p>
            </div>
            <a
              href="https://www.mercadolibre.com.ar/ventas"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm"
            >
              Abrir panel de vendedor <ExternalLink size={14} />
            </a>
          </div>
        </div>

        {advLoading && (
          <div className="flex items-center gap-2 text-slate-500 text-sm py-4">
            <Loader2 className="animate-spin" size={18} /> Cargando cuentas de Mercado Ads…
          </div>
        )}
        {advError && <p className="text-sm text-red-400/90 py-2">{advError}</p>}

        {!advLoading && advertisers.length > 0 && (
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 mb-6">
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Cuenta / anunciante
              <select
                value={advertiserId === '' ? '' : advertiserId}
                onChange={(e) => {
                  const id = e.target.value;
                  const row = advertisers.find((a) => String(a.advertiser_id) === id);
                  if (row) {
                    setAdvertiserId(row.advertiser_id);
                    setSiteId(row.site_id);
                  }
                }}
                className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white min-w-[220px]"
              >
                {advertisers.map((a) => (
                  <option key={`${a.site_id}-${a.advertiser_id}`} value={a.advertiser_id}>
                    {a.account_name || a.advertiser_name} ({a.site_id})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Desde
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Hasta
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
              />
            </label>
          </div>
        )}

        {recError && <p className="text-sm text-red-400/90 mb-4">{recError}</p>}

        {recStats && (
          <p className="text-xs text-slate-500 mb-6">
            Análisis: {recStats.adsAnalyzed} filas de anuncios con métricas · {recStats.stockFetched} publicaciones activas revisadas en inventario ML.
          </p>
        )}

        <div className="space-y-8">
          <div>
            <h3 className="text-sm font-bold text-emerald-300/90 flex items-center gap-2 mb-3">
              <TrendingUp size={18} /> Potenciar (buen ROAS)
            </h3>
            <p className="text-xs text-slate-500 mb-3">
              Publicaciones con inversión y clics suficientes y ROAS alto: suelen ser buenas candidatas para mantener o subir presupuesto si el stock lo permite.
            </p>
            <RecTable rows={potenciar} kind="scale" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-amber-300/90 flex items-center gap-2 mb-3">
              <AlertTriangle size={18} /> Revisar o pausar
            </h3>
            <p className="text-xs text-slate-500 mb-3">
              ROAS bajo o muchos clics sin ventas atribuidas: revisá precio, ficha, competencia o reducí la inversión en esas publicaciones.
            </p>
            <RecTable rows={revisar} kind="review" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-cyan-300/90 flex items-center gap-2 mb-3">
              <PlusCircle size={18} /> Considerar sumar a campañas
            </h3>
            <p className="text-xs text-slate-500 mb-3">
              Publicaciones con ventas orgánicas y stock que <strong className="text-slate-400">no aparecen</strong> en métricas de Product Ads en este período (no
              estuvieron en campaña o no registraron impresiones de pago). Buen punto de partida para probar nuevas campañas.
            </p>
            <RecTable rows={sumar} kind="add" />
          </div>
        </div>

        <p className="text-[11px] text-slate-600 mt-6 leading-relaxed">
          Criterios orientativos: ROAS “bueno” ≥ 2,2× con costo ≥ $200 y ≥ 3 clics; “revisar” si ROAS &lt; 1,3× o ≥ 15 clics sin ventas atribuidas. Ajustá
          fechas si tenés pocas filas. Para ver el detalle completo de campañas, abrí{' '}
          <button type="button" onClick={() => go('mercadolibre_product_ads')} className="text-amber-500/90 hover:underline">
            Product Ads
          </button>
          .
        </p>
      </div>

      <div className="rounded-2xl border border-slate-700/80 bg-slate-900/50 p-6 md:p-8">
        <h2 className="text-lg font-bold text-white mb-4">Asistente para canal de difusión</h2>
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4">
            <h3 className="text-sm font-semibold text-amber-200 mb-3">Qué hacer ahora</h3>
            <ul className="space-y-2">
              {accionesSugeridas.map((a) => (
                <li key={a} className="text-sm text-slate-300">- {a}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4">
            <h3 className="text-sm font-semibold text-cyan-200 mb-3">Ideas para comunicar hoy</h3>
            {ideasComunicacion.length === 0 ? (
              <p className="text-sm text-slate-500">Generá recomendaciones para crear mensajes sugeridos automáticamente.</p>
            ) : (
              <div className="space-y-3">
                {ideasComunicacion.map((idea) => (
                  <div key={idea.title} className="border border-slate-700 rounded-lg p-3 bg-slate-950/40">
                    <p className="text-xs text-slate-500 mb-1">{idea.title}</p>
                    <p className="text-sm text-slate-300">{idea.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <Lightbulb className="text-amber-400 shrink-0" size={22} />
          Accesos rápidos
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {links.map(({ view, icon: Icon, title, desc, color }) => (
            <button
              key={view}
              type="button"
              onClick={() => go(view)}
              className={`text-left rounded-xl border p-4 transition-all hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-amber-500/50 bg-gradient-to-br ${color}`}
            >
              <div className="flex items-start justify-between gap-2">
                <Icon className="text-amber-300 shrink-0 mt-0.5" size={22} />
                <ChevronRight className="text-slate-500 shrink-0" size={18} />
              </div>
              <h3 className="text-white font-semibold mt-2">{title}</h3>
              <p className="text-slate-400 text-sm mt-1">{desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-bold text-white mb-4">Consejos prácticos</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {TIPS.map((t) => (
            <div
              key={t.title}
              className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 md:p-5"
            >
              <h3 className="text-amber-200/90 font-semibold text-sm mb-2">{t.title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{t.body}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-700/60 overflow-hidden">
        <button
          type="button"
          onClick={() => setGlossaryOpen((o) => !o)}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-slate-900/60 hover:bg-slate-800/60 text-left text-sm font-medium text-slate-200"
        >
          <span>Centro de vendedores y ayuda oficial</span>
          {glossaryOpen ? <ChevronDown size={18} className="shrink-0" /> : <ChevronRight size={18} className="shrink-0" />}
        </button>
        {glossaryOpen && (
          <div className="px-4 pb-4 pt-0 border-t border-slate-700/60 bg-slate-950/40">
            <p className="text-slate-400 text-sm mt-3 leading-relaxed">
              Para crear o ajustar campañas directamente en Mercado Libre (presupuestos, creatividades, exclusiones),
              usá el panel de Mercado Ads en el sitio. LupoHub te permite ver rendimiento y exportar datos desde las
              pantallas de Product, Brand y Display Ads.
            </p>
            <a
              href="https://ads.mercadolibre.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 mt-3 text-sm text-amber-400 hover:text-amber-300"
            >
              Mercado Ads <ExternalLink size={14} />
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

export default MercadoLibreCanalDifusion;
