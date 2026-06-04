import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  Loader2,
  RefreshCw,
  Printer,
  Search,
  AlertCircle,
  ImageOff,
  ChevronLeft,
  ChevronRight,
  Tag,
  Layers,
  DollarSign,
} from 'lucide-react';
import { api, TiendaNubeCatalog as TnCatalog, TiendaNubeCatalogProduct } from '../services/api';

/** Mapa de nombres de color (es) a un hex aproximado para el swatch. */
const COLOR_HEX: Record<string, string> = {
  negro: '#111827',
  blanco: '#ffffff',
  gris: '#9ca3af',
  'gris melange': '#b8bcc4',
  plomo: '#6b7280',
  rojo: '#dc2626',
  bordo: '#7f1d1d',
  bordeaux: '#7f1d1d',
  azul: '#1d4ed8',
  'azul marino': '#1e3a5f',
  marino: '#1e3a5f',
  celeste: '#38bdf8',
  verde: '#16a34a',
  'verde militar': '#4d5320',
  amarillo: '#facc15',
  naranja: '#f97316',
  rosa: '#f472b6',
  fucsia: '#db2777',
  violeta: '#7c3aed',
  lila: '#c4b5fd',
  beige: '#e7d8c0',
  marron: '#92400e',
  'marrón': '#92400e',
  camel: '#c19a6b',
  nude: '#e8c9b5',
  crudo: '#f3ead6',
  natural: '#f3ead6',
  dorado: '#d4af37',
  plateado: '#c0c0c0',
  turquesa: '#14b8a6',
  coral: '#fb7185',
};

function colorToHex(name: string): string | null {
  const key = name.trim().toLowerCase();
  if (COLOR_HEX[key]) return COLOR_HEX[key];
  for (const k of Object.keys(COLOR_HEX)) {
    if (key.includes(k)) return COLOR_HEX[k];
  }
  return null;
}

function formatPrice(n: number | null): string {
  if (n == null) return '';
  try {
    return n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
  } catch {
    return `$${n}`;
  }
}

const ProductCard: React.FC<{ product: TiendaNubeCatalogProduct; showPrice: boolean }> = ({
  product,
  showPrice,
}) => {
  const [imgIdx, setImgIdx] = useState(0);
  const images = product.images.length > 0 ? product.images : [];
  const current = images[Math.min(imgIdx, images.length - 1)];

  const next = useCallback(() => setImgIdx((i) => (images.length ? (i + 1) % images.length : 0)), [images.length]);
  const prev = useCallback(
    () => setImgIdx((i) => (images.length ? (i - 1 + images.length) % images.length : 0)),
    [images.length]
  );

  return (
    <div className="tn-card break-inside-avoid rounded-2xl border border-slate-200 bg-white overflow-hidden flex flex-col shadow-sm">
      <div className="relative bg-slate-50 aspect-[3/4] flex items-center justify-center overflow-hidden">
        {current ? (
          <img
            src={current}
            alt={product.name}
            loading="lazy"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center text-slate-300">
            <ImageOff size={40} />
            <span className="text-xs mt-1">Sin imagen</span>
          </div>
        )}
        {images.length > 1 && (
          <>
            <button
              onClick={prev}
              className="tn-noprint absolute left-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/45 hover:bg-black/65 text-white flex items-center justify-center"
              aria-label="Imagen anterior"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={next}
              className="tn-noprint absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/45 hover:bg-black/65 text-white flex items-center justify-center"
              aria-label="Imagen siguiente"
            >
              <ChevronRight size={18} />
            </button>
            <div className="tn-noprint absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
              {images.map((_, i) => (
                <span
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full ${i === imgIdx ? 'bg-white' : 'bg-white/50'}`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="p-4 flex flex-col gap-3 flex-1">
        <div>
          <h4 className="font-bold text-slate-900 leading-snug text-[15px]">{product.name}</h4>
          {showPrice && product.price != null && (
            <div className="mt-1 flex items-baseline gap-2">
              {product.promotionalPrice != null ? (
                <>
                  <span className="text-lg font-black text-[#c8102e]">
                    {formatPrice(product.promotionalPrice)}
                  </span>
                  <span className="text-sm text-slate-400 line-through">{formatPrice(product.price)}</span>
                </>
              ) : (
                <span className="text-lg font-black text-slate-900">{formatPrice(product.price)}</span>
              )}
            </div>
          )}
        </div>

        {product.description && (
          <p className="text-[13px] text-slate-600 leading-relaxed line-clamp-4 whitespace-pre-line">
            {product.description}
          </p>
        )}

        {product.sizes.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Talles</p>
            <div className="flex flex-wrap gap-1.5">
              {product.sizes.map((s) => (
                <span
                  key={s}
                  className="px-2 py-0.5 rounded-md border border-slate-300 bg-slate-50 text-slate-700 text-xs font-semibold"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {product.colors.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Colores</p>
            <div className="flex flex-wrap gap-1.5">
              {product.colors.map((c) => {
                const hex = colorToHex(c);
                return (
                  <span
                    key={c}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-slate-300 bg-white text-slate-700 text-xs font-medium"
                  >
                    <span
                      className="w-3 h-3 rounded-full border border-slate-300 shrink-0"
                      style={{ backgroundColor: hex || '#e2e8f0' }}
                    />
                    {c}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const TiendaNubeCatalogView: React.FC = () => {
  const [catalog, setCatalog] = useState<TnCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [activeSection, setActiveSection] = useState<number | 'all'>('all');
  const [showPrice, setShowPrice] = useState(false);
  const printRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getTiendaNubeCatalog();
      setCatalog(data);
      setActiveSection('all');
    } catch (e: any) {
      setError(e?.message || 'No se pudo generar el catálogo desde Tienda Nube');
    } finally {
      setLoading(false);
    }
  }, []);

  const filteredSections = useMemo(() => {
    if (!catalog) return [];
    const q = search.trim().toLowerCase();
    return catalog.sections
      .filter((s) => activeSection === 'all' || s.id === activeSection)
      .map((s) => {
        if (!q) return s;
        const products = s.products.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            p.sizes.some((x) => x.toLowerCase().includes(q)) ||
            p.colors.some((x) => x.toLowerCase().includes(q))
        );
        return { ...s, products, productCount: products.length };
      })
      .filter((s) => s.products.length > 0);
  }, [catalog, search, activeSection]);

  const totalShown = useMemo(
    () => filteredSections.reduce((acc, s) => acc + s.products.length, 0),
    [filteredSections]
  );

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-5">
      {/* Print styles: al imprimir, solo se ve el catálogo */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .tn-catalog-print, .tn-catalog-print * { visibility: visible !important; }
          .tn-catalog-print { position: absolute; left: 0; top: 0; width: 100%; }
          .tn-noprint { display: none !important; }
          .tn-card { box-shadow: none !important; border-color: #e5e7eb !important; }
          .tn-print-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; gap: 12px !important; }
          @page { margin: 12mm; }
        }
      `}</style>

      {/* Controles */}
      <div className="tn-noprint bg-slate-800/80 border border-slate-700 rounded-2xl p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div>
            <h3 className="text-white font-bold text-base flex items-center gap-2">
              <Layers size={18} className="text-emerald-400" />
              Catálogo Tienda Nube
            </h3>
            <p className="text-slate-400 text-xs mt-0.5">
              Se genera en vivo desde tu tienda, agrupado por cada sección.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 lg:ml-auto">
            <button
              onClick={load}
              disabled={loading}
              className="min-h-[44px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm flex items-center gap-2"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
              {catalog ? 'Actualizar' : 'Generar catálogo'}
            </button>
            <button
              onClick={() => setShowPrice((v) => !v)}
              className={`min-h-[44px] px-4 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 border ${
                showPrice
                  ? 'bg-amber-600 border-amber-500 text-white'
                  : 'bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600'
              }`}
            >
              <DollarSign size={18} />
              {showPrice ? 'Precios visibles' : 'Mostrar precios'}
            </button>
            <button
              onClick={handlePrint}
              disabled={!catalog || totalShown === 0}
              className="min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white font-bold text-sm flex items-center gap-2 border border-slate-600"
            >
              <Printer size={18} /> Imprimir / PDF
            </button>
          </div>
        </div>

        {catalog && (
          <div className="mt-4 flex flex-col gap-3">
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre, talle o color..."
                className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setActiveSection('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                  activeSection === 'all'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                Todas ({catalog.productCount})
              </button>
              {catalog.sections.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActiveSection(s.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                    activeSection === s.id
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  {s.name} ({s.productCount})
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="tn-noprint bg-red-900/20 border border-red-800 rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={20} />
          <div className="min-w-0">
            <p className="text-red-300 font-medium text-sm">No se pudo generar el catálogo</p>
            <p className="text-slate-400 text-sm mt-0.5">{error}</p>
            <p className="text-slate-500 text-xs mt-1">
              Verificá que Tienda Nube esté conectada en Configuración.
            </p>
          </div>
        </div>
      )}

      {loading && !catalog && (
        <div className="tn-noprint flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 size={40} className="animate-spin text-emerald-500" />
          <p className="text-slate-400 text-sm">Trayendo productos de Tienda Nube…</p>
          <p className="text-slate-600 text-xs">Puede tardar un poco si tenés muchos productos.</p>
        </div>
      )}

      {!loading && !catalog && !error && (
        <div className="tn-noprint bg-slate-800/50 border border-slate-700 border-dashed rounded-2xl p-10 text-center">
          <Layers size={48} className="mx-auto text-slate-600 mb-3" />
          <p className="text-slate-400 font-medium">Generá el catálogo desde tu Tienda Nube</p>
          <p className="text-slate-600 text-sm mt-1 max-w-md mx-auto">
            Toca «Generar catálogo» para traer todos los productos con sus imágenes, talles, colores y
            descripciones, separados por cada sección de la tienda.
          </p>
        </div>
      )}

      {/* Catálogo (área imprimible) */}
      {catalog && totalShown > 0 && (
        <div ref={printRef} className="tn-catalog-print bg-white rounded-2xl overflow-hidden">
          {/* Encabezado branded Lupo */}
          <div className="bg-[#0b1f3a] text-white px-6 sm:px-8 py-6 flex items-center justify-between">
            <div>
              <p className="text-3xl font-black tracking-tight leading-none">LUPO</p>
              <p className="text-xs tracking-[0.3em] text-white/70 mt-1 uppercase">Catálogo Mayorista</p>
            </div>
            <div className="text-right text-white/80">
              <p className="text-sm font-semibold">multilupo.com.ar</p>
              <p className="text-[11px] mt-0.5">
                {new Date(catalog.generatedAt).toLocaleDateString('es-AR', {
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
            </div>
          </div>

          <div className="p-5 sm:p-7 space-y-9">
            {filteredSections.map((section) => (
              <section key={section.id} className="break-inside-avoid">
                <div className="flex items-center gap-3 mb-4 pb-2 border-b-2 border-[#c8102e]">
                  <Tag size={18} className="text-[#c8102e]" />
                  <h3 className="text-xl font-black text-[#0b1f3a] uppercase tracking-wide">
                    {section.name}
                  </h3>
                  <span className="ml-auto text-xs font-semibold text-slate-400">
                    {section.products.length} productos
                  </span>
                </div>
                <div className="tn-print-grid grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                  {section.products.map((p) => (
                    <ProductCard key={`${section.id}-${p.id}`} product={p} showPrice={showPrice} />
                  ))}
                </div>
              </section>
            ))}
          </div>

          <div className="bg-[#0b1f3a] text-white/70 text-center text-[11px] py-3 px-6">
            LUPO · multilupo.com.ar · Catálogo generado el{' '}
            {new Date(catalog.generatedAt).toLocaleString('es-AR')}
          </div>
        </div>
      )}

      {catalog && totalShown === 0 && (
        <div className="tn-noprint bg-slate-800/50 border border-slate-700 rounded-2xl p-10 text-center">
          <Search size={40} className="mx-auto text-slate-600 mb-3" />
          <p className="text-slate-400 font-medium">No hay productos que coincidan con la búsqueda</p>
        </div>
      )}
    </div>
  );
};

export default TiendaNubeCatalogView;
