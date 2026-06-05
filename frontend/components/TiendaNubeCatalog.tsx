import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Loader2,
  RefreshCw,
  Printer,
  Search,
  AlertCircle,
  ImageOff,
  Layers,
  DollarSign,
  Pencil,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  Save,
  X,
  Check,
  BookOpen,
  Type,
  Upload,
  Palette,
  Crop,
  Plus,
} from 'lucide-react';
import {
  api,
  TiendaNubeCatalog as TnCatalog,
  TiendaNubeCatalogProduct,
  TiendaNubeCatalogSection,
} from '../services/api';
import ImageCropModal from './ImageCropModal';

/* ===================== Tipos de configuración editable ===================== */

interface ColorVariant {
  name: string;
  /** Foto del color asignada en Tienda Nube (referencia para recortar). */
  sourceImage?: string;
  /** Miniatura recortada (cuadrado 160px), guardada tras aplicar recorte. */
  image?: string;
}

const COLOR_THUMB_SIZE = 160;

const CATALOG_PRINT_CSS = `
  @page { size: A4; margin: 0; }
  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .tn-catalog-print {
    position: static !important;
    width: 100% !important;
    overflow: visible !important;
    border-radius: 0 !important;
    box-shadow: none !important;
  }
  .tn-cover {
    break-after: page;
    page-break-after: always;
    min-height: 100vh;
    box-sizing: border-box;
  }
  .tn-section:not(:first-child) {
    break-before: page;
    page-break-before: always;
  }
  .tn-product {
    break-inside: avoid;
    page-break-inside: avoid;
    box-shadow: none !important;
  }
`;

interface ProductOverride {
  included?: boolean;
  name?: string;
  description?: string;
  features?: string[];
  composition?: string;
  sizesText?: string;
  /** @deprecated usar colorVariants */
  colors?: string[];
  colorVariants?: ColorVariant[];
  articleCode?: string;
  imageIndex?: number;
  /** Si está presente, reemplaza por completo la lista de imágenes (TN + propias). */
  images?: string[];
}

interface SectionOverride {
  included?: boolean;
  name?: string;
}

interface CoverConfig {
  enabled: boolean;
  brand: string;
  title: string;
  collection: string;
  subtitle: string;
  website: string;
  category: string;
  logoUrl?: string;
  backgroundUrl?: string;
}

interface ColorsConfig {
  heading: string;
  accent: string;
  text: string;
  coverBg: string;
  coverText: string;
}

interface CatalogConfig {
  cover: CoverConfig;
  colors: ColorsConfig;
  showPrice: boolean;
  fontHeading: string;
  fontBody: string;
  sections: Record<string, SectionOverride>;
  products: Record<string, ProductOverride>;
  sectionOrder: number[];
  productOrder: Record<string, number[]>;
}

const defaultCover = (): CoverConfig => ({
  enabled: true,
  brand: 'LUPO',
  title: 'Catálogo',
  collection: 'COLECCIÓN 2026',
  subtitle: 'SUAVIDAD Y AJUSTE PERFECTO TODO EL DÍA',
  website: 'WWW.MULTILUPO.COM.AR',
  category: '',
});

const defaultColors = (): ColorsConfig => ({
  heading: '#0b1f3a',
  accent: '#c8102e',
  text: '#475569',
  coverBg: '#0b1f3a',
  coverText: '#ffffff',
});

const defaultConfig = (): CatalogConfig => ({
  cover: defaultCover(),
  colors: defaultColors(),
  showPrice: false,
  fontHeading: 'default',
  fontBody: 'default',
  sections: {},
  products: {},
  sectionOrder: [],
  productOrder: {},
});

const CATALOG_CACHE_KEY = 'lupo_tn_catalog_cache';
const CONFIG_CACHE_KEY = 'lupo_tn_catalog_config_cache';

function mergeProductOverrides(
  server: Record<string, ProductOverride>,
  local: Record<string, ProductOverride>
): Record<string, ProductOverride> {
  const ids = new Set([...Object.keys(server), ...Object.keys(local)]);
  const out: Record<string, ProductOverride> = {};
  for (const id of ids) {
    const s = server[id] || {};
    const l = local[id] || {};
    out[id] = {
      ...s,
      ...l,
      colorVariants: l.colorVariants?.length ? l.colorVariants : s.colorVariants,
      images: l.images?.length ? l.images : s.images,
    };
  }
  return out;
}

function mergeCatalogConfig(server: CatalogConfig, local: Partial<CatalogConfig> | null): CatalogConfig {
  if (!local) return server;
  return {
    ...server,
    ...local,
    cover: { ...server.cover, ...(local.cover || {}) },
    colors: { ...server.colors, ...(local.colors || {}) },
    sections: { ...server.sections, ...(local.sections || {}) },
    products: mergeProductOverrides(server.products, local.products || {}),
    sectionOrder: local.sectionOrder?.length ? local.sectionOrder : server.sectionOrder,
    productOrder: { ...server.productOrder, ...(local.productOrder || {}) },
  };
}

function readCachedConfig(): Partial<CatalogConfig> | null {
  try {
    const raw = localStorage.getItem(CONFIG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function buildConfigFromResponse(cfg: Partial<CatalogConfig> | null, base: CatalogConfig): CatalogConfig {
  if (!cfg) return base;
  return {
    ...base,
    ...cfg,
    cover: { ...base.cover, ...(cfg.cover || {}) },
    colors: { ...base.colors, ...(cfg.colors || {}) },
    sections: cfg.sections || {},
    products: cfg.products || {},
    sectionOrder: cfg.sectionOrder || [],
    productOrder: cfg.productOrder || {},
  };
}

/* ===================== Tipografías disponibles ===================== */

interface FontOption {
  id: string;
  label: string;
  stack: string;
  google?: string;
}

const FONT_OPTIONS: FontOption[] = [
  { id: 'default', label: 'Predeterminada (sistema)', stack: '' },
  { id: 'montserrat', label: 'Montserrat', stack: "'Montserrat', sans-serif", google: 'Montserrat:wght@400;600;700;900' },
  { id: 'poppins', label: 'Poppins', stack: "'Poppins', sans-serif", google: 'Poppins:wght@400;600;700;800' },
  { id: 'lato', label: 'Lato', stack: "'Lato', sans-serif", google: 'Lato:wght@400;700;900' },
  { id: 'raleway', label: 'Raleway', stack: "'Raleway', sans-serif", google: 'Raleway:wght@400;600;700;800' },
  { id: 'oswald', label: 'Oswald (condensada)', stack: "'Oswald', sans-serif", google: 'Oswald:wght@400;500;700' },
  { id: 'bebas', label: 'Bebas Neue (titulares)', stack: "'Bebas Neue', sans-serif", google: 'Bebas+Neue' },
  { id: 'playfair', label: 'Playfair Display (serif)', stack: "'Playfair Display', serif", google: 'Playfair+Display:wght@400;700;900' },
  { id: 'cormorant', label: 'Cormorant Garamond (serif)', stack: "'Cormorant Garamond', serif", google: 'Cormorant+Garamond:wght@400;600;700' },
  { id: 'georgia', label: 'Georgia (serif clásica)', stack: "Georgia, 'Times New Roman', serif" },
  { id: 'helvetica', label: 'Helvetica / Arial', stack: 'Helvetica, Arial, sans-serif' },
  { id: 'times', label: 'Times New Roman', stack: "'Times New Roman', Times, serif" },
];

function findFont(id: string): FontOption {
  return FONT_OPTIONS.find((f) => f.id === id) || FONT_OPTIONS[0];
}

/** Carga la hoja de Google Fonts una sola vez por fuente. */
function ensureGoogleFont(opt: FontOption) {
  if (!opt?.google || typeof document === 'undefined') return;
  const id = `tn-font-${opt.id}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${opt.google}&display=swap`;
  document.head.appendChild(link);
}

/* ===================== Helpers de color y precio ===================== */

const COLOR_HEX: Record<string, string> = {
  negro: '#111827',
  blanco: '#ffffff',
  gris: '#9ca3af',
  plomo: '#6b7280',
  rojo: '#dc2626',
  bordo: '#7f1d1d',
  azul: '#1d4ed8',
  marino: '#1e3a5f',
  celeste: '#38bdf8',
  verde: '#16a34a',
  amarillo: '#facc15',
  naranja: '#f97316',
  rosa: '#f472b6',
  fucsia: '#db2777',
  violeta: '#7c3aed',
  lila: '#c4b5fd',
  beige: '#e7d8c0',
  marron: '#92400e',
  camel: '#c19a6b',
  nude: '#e8c9b5',
  natural: '#efe2d2',
  crudo: '#f3ead6',
  capuccino: '#b08968',
  capiccino: '#b08968',
  cappuccino: '#b08968',
  chocolate: '#5b3a29',
  dorado: '#d4af37',
  plateado: '#c0c0c0',
  turquesa: '#14b8a6',
  coral: '#fb7185',
};

/** Quita el código numérico ("999-Negro" -> "negro") para mapear a un hex. */
function colorNamePart(label: string): string {
  return label
    .replace(/\d{2,4}/g, '')
    .replace(/[·\-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function colorToHex(label: string): string | null {
  const name = colorNamePart(label);
  if (!name) return null;
  if (COLOR_HEX[name]) return COLOR_HEX[name];
  for (const k of Object.keys(COLOR_HEX)) {
    if (name.includes(k)) return COLOR_HEX[k];
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

/* ===================== Modelo de producto para mostrar ===================== */

interface DisplayProduct {
  id: number;
  name: string;
  description: string;
  features: string[];
  composition: string;
  sizesText: string;
  colorVariants: ColorVariant[];
  articleCode: string;
  images: string[];
  imageIndex: number;
  price: number | null;
  promotionalPrice: number | null;
  included: boolean;
}

function tnColorVariants(p: TiendaNubeCatalogProduct): ColorVariant[] {
  if (p.colorVariants?.length) {
    return p.colorVariants.map((cv) => ({
      name: cv.name,
      sourceImage: cv.sourceImage || undefined,
    }));
  }
  return p.colors.map((name) => ({ name }));
}

function resolveColorVariants(ov: ProductOverride | undefined, p: TiendaNubeCatalogProduct): ColorVariant[] {
  const fromTn = tnColorVariants(p);
  const tnByName = new Map(fromTn.map((c) => [c.name, c]));
  const saved = ov?.colorVariants || [];
  const savedByName = new Map(saved.map((c) => [c.name, c]));

  if (saved.length > 0 || ov?.colors?.length) {
    const names = fromTn.length
      ? fromTn.map((c) => c.name)
      : ov?.colors?.length
        ? ov.colors
        : saved.map((c) => c.name);
    const uniqueNames = [...new Set(names.filter(Boolean))];
    return uniqueNames.map((name) => {
      const tn = tnByName.get(name);
      const sv = savedByName.get(name);
      return {
        name,
        sourceImage: sv?.sourceImage ?? tn?.sourceImage,
        image: sv?.image,
      };
    });
  }
  return fromTn;
}

function mergeProduct(p: TiendaNubeCatalogProduct, ov: ProductOverride | undefined): DisplayProduct {
  const images = ov?.images && ov.images.length ? ov.images : p.images;
  return {
    id: p.id,
    name: ov?.name ?? p.name,
    description: ov?.description ?? p.description,
    features: ov?.features ?? [],
    composition: ov?.composition ?? p.composition,
    sizesText: ov?.sizesText ?? p.sizes.join('  ·  '),
    colorVariants: resolveColorVariants(ov, p),
    articleCode: ov?.articleCode ?? p.articleCode,
    images,
    imageIndex: Math.min(ov?.imageIndex ?? 0, Math.max(0, images.length - 1)),
    price: p.price,
    promotionalPrice: p.promotionalPrice,
    included: ov?.included !== false,
  };
}

/** Ordena ids según un orden guardado, agregando al final los que falten. */
function orderedIds(saved: number[] | undefined, base: number[]): number[] {
  const result = (saved || []).filter((id) => base.includes(id));
  for (const id of base) if (!result.includes(id)) result.push(id);
  return result;
}

/* ===================== Editor de producto (modal) ===================== */

const ProductEditorModal: React.FC<{
  product: TiendaNubeCatalogProduct;
  override: ProductOverride | undefined;
  onSave: (ov: ProductOverride) => void;
  onClose: () => void;
}> = ({ product, override, onSave, onClose }) => {
  const merged = mergeProduct(product, override);
  const [name, setName] = useState(merged.name);
  const [description, setDescription] = useState(merged.description);
  const [features, setFeatures] = useState((merged.features || []).join('\n'));
  const [composition, setComposition] = useState(merged.composition);
  const [sizesText, setSizesText] = useState(merged.sizesText);
  const [colorVariants, setColorVariants] = useState<ColorVariant[]>(merged.colorVariants);
  const [articleCode, setArticleCode] = useState(merged.articleCode);
  const [images, setImages] = useState<string[]>(merged.images);
  const [imageIndex, setImageIndex] = useState(merged.imageIndex);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [croppingIndex, setCroppingIndex] = useState<number | null>(null);
  const [croppingColorIdx, setCroppingColorIdx] = useState<number | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = e.target.files ? Array.from(e.target.files) : [];
    if (files.length === 0) return;
    setUploadError('');
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const f of files) {
        const url = await api.uploadCatalogImage(f);
        urls.push(url);
      }
      setImages((prev) => {
        const nextList = [...prev, ...urls];
        // si no había imágenes, la primera subida pasa a ser principal
        if (prev.length === 0) setImageIndex(0);
        return nextList;
      });
    } catch (err: any) {
      setUploadError(err?.message || 'No se pudo subir la imagen');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const removeImage = (idx: number) => {
    setImages((prev) => {
      const nextList = prev.filter((_, i) => i !== idx);
      setImageIndex((cur) => {
        if (idx < cur) return cur - 1;
        if (idx === cur) return 0;
        return cur;
      });
      return nextList;
    });
  };

  const moveImage = (idx: number, dir: -1 | 1) => {
    setImages((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      setImageIndex((cur) => (cur === idx ? j : cur === j ? idx : cur));
      return next;
    });
  };

  const save = () => {
    onSave({
      ...override,
      included: override?.included,
      name: name.trim(),
      description,
      features: features.split('\n').map((s) => s.trim()).filter(Boolean),
      composition: composition.trim(),
      sizesText: sizesText.trim(),
      colorVariants: colorVariants.filter((c) => c.name.trim()),
      articleCode: articleCode.trim(),
      images,
      imageIndex: Math.min(imageIndex, Math.max(0, images.length - 1)),
    });
    onClose();
  };

  const resetField = () => {
    // Restaura a los valores originales de Tienda Nube
    setName(product.name);
    setDescription(product.description);
    setFeatures('');
    setComposition(product.composition);
    setSizesText(product.sizes.join('  ·  '));
    setColorVariants(tnColorVariants(product));
    setArticleCode(product.articleCode);
    setImages(product.images);
    setImageIndex(0);
  };

  const isUploaded = (src: string) => /\/catalog-images\//.test(src);

  const applyCroppedImage = async (idx: number, blob: Blob) => {
    const file = new File([blob], `crop-${Date.now()}.jpg`, { type: 'image/jpeg' });
    const url = await api.uploadCatalogImage(file);
    setImages((prev) => prev.map((s, i) => (i === idx ? url : s)));
  };

  const updateColorVariant = (idx: number, patch: Partial<ColorVariant>) => {
    setColorVariants((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  const startColorCrop = (colorIdx: number) => {
    const src = colorVariants[colorIdx]?.sourceImage;
    if (!src) {
      setUploadError('Este color no tiene foto asignada en Tienda Nube.');
      return;
    }
    setUploadError('');
    setCroppingColorIdx(colorIdx);
  };

  const applyCroppedColorImage = async (colorIdx: number, blob: Blob) => {
    setUploadError('');
    try {
      const file = new File([blob], `color-crop-${Date.now()}.jpg`, { type: 'image/jpeg' });
      const url = await api.uploadCatalogImage(file);
      updateColorVariant(colorIdx, { image: url });
    } catch (err: any) {
      setUploadError(err?.message || 'No se pudo guardar el recorte del color');
      throw err;
    }
  };

  const addColorVariant = () => setColorVariants((prev) => [...prev, { name: '' }]);
  const removeColorVariant = (idx: number) => setColorVariants((prev) => prev.filter((_, i) => i !== idx));

  const inputCls =
    'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:ring-2 focus:ring-emerald-500';
  const labelCls = 'text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1 block';

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-slate-800 border-b border-slate-700 px-5 py-4 flex items-center justify-between z-10">
          <h3 className="font-bold text-white flex items-center gap-2">
            <Pencil size={18} className="text-emerald-400" /> Editar producto
          </h3>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-white rounded-lg">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Nombre</label>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Código de artículo</label>
              <input className={inputCls} value={articleCode} onChange={(e) => setArticleCode(e.target.value)} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Descripción</label>
            <textarea className={inputCls} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Características (una por línea)</label>
              <textarea
                className={inputCls}
                rows={5}
                placeholder={'Tecnología Seamless\nMicrofibra premium\nAjuste anatómico'}
                value={features}
                onChange={(e) => setFeatures(e.target.value)}
              />
            </div>
            <div className="space-y-4">
              <div>
                <label className={labelCls}>Composición</label>
                <input
                  className={inputCls}
                  placeholder="Poliamida 93% Elastano 7%"
                  value={composition}
                  onChange={(e) => setComposition(e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls}>Talles</label>
                <input className={inputCls} placeholder="P · M · G · GG" value={sizesText} onChange={(e) => setSizesText(e.target.value)} />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className={labelCls + ' mb-0'}>Colores (fotos de Tienda Nube)</label>
                  <button
                    type="button"
                    onClick={addColorVariant}
                    className="text-xs font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                  >
                    <Plus size={14} /> Agregar
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 mb-2">
                  Las fotos vienen asignadas por color en Tienda Nube. Solo recortá la miniatura cuadrada.
                </p>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {colorVariants.length === 0 && (
                    <p className="text-xs text-slate-500">Sin colores. Agregá uno o restaurá desde Tienda Nube.</p>
                  )}
                  {colorVariants.map((cv, idx) => {
                    const preview = cv.image || cv.sourceImage;
                    return (
                      <div key={idx} className="flex items-center gap-2 bg-slate-900/60 border border-slate-700 rounded-lg p-2">
                        <div className="w-12 h-12 rounded-md overflow-hidden border border-slate-600 shrink-0 bg-slate-800 flex items-center justify-center">
                          {preview ? (
                            <img src={preview} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span
                              className="w-6 h-6 rounded-full border border-slate-500"
                              style={{ backgroundColor: colorToHex(cv.name) || '#64748b' }}
                            />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <input
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-xs outline-none focus:ring-2 focus:ring-emerald-500"
                            value={cv.name}
                            placeholder="999 · Negro"
                            onChange={(e) => updateColorVariant(idx, { name: e.target.value })}
                          />
                          {!cv.sourceImage && (
                            <p className="text-[9px] text-amber-400/90 mt-0.5">Sin foto en TN para este color</p>
                          )}
                        </div>
                        <div className="flex flex-col gap-0.5 shrink-0">
                          <button
                            type="button"
                            disabled={!cv.sourceImage}
                            onClick={() => startColorCrop(idx)}
                            className="text-[10px] font-bold text-emerald-400 hover:text-emerald-300 disabled:text-slate-600 flex items-center gap-1 text-left"
                          >
                            <Crop size={11} /> {cv.image ? 'Re-recortar' : 'Recortar'}
                          </button>
                          {cv.image && (
                            <button
                              type="button"
                              onClick={() => updateColorVariant(idx, { image: undefined })}
                              className="text-[10px] text-red-400 hover:text-red-300 text-left"
                            >
                              Quitar recorte
                            </button>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeColorVariant(idx)}
                          className="w-6 h-6 shrink-0 rounded text-slate-500 hover:text-red-400 flex items-center justify-center"
                          title="Quitar color"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={labelCls + ' mb-0'}>Foto principal del catálogo</label>
              <label className="cursor-pointer text-xs font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1.5">
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Subir desde mi compu
                <input type="file" accept="image/*" multiple className="hidden" onChange={handleUpload} disabled={uploading} />
              </label>
            </div>
            <p className="text-[10px] text-slate-500 mb-2">
              Elegí con el check cuál foto grande se muestra en la ficha. Las demás son de Tienda Nube.
            </p>
            {uploadError && <p className="text-red-400 text-xs mb-2">{uploadError}</p>}
            {images.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-600 p-4 text-center text-slate-500 text-xs">
                Sin imágenes. Subí una desde tu computadora.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {images.map((src, i) => (
                  <div
                    key={`${src}-${i}`}
                    className={`relative w-20 h-24 rounded-lg overflow-hidden border-2 group ${
                      i === imageIndex ? 'border-emerald-500' : 'border-slate-700'
                    }`}
                  >
                    <button onClick={() => setImageIndex(i)} className="w-full h-full" title="Usar como foto principal">
                      <img src={src} alt="" className="w-full h-full object-cover" />
                    </button>
                    {i === imageIndex && (
                      <span className="absolute top-0.5 left-0.5 bg-emerald-500 text-white text-[8px] font-bold px-1 py-0.5 rounded">
                        Principal
                      </span>
                    )}
                    {isUploaded(src) && (
                      <span className="absolute bottom-0.5 left-0.5 bg-indigo-600 text-white text-[8px] px-1 rounded">propia</span>
                    )}
                    <div className="absolute top-0.5 right-0.5 flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition">
                      <button
                        onClick={() => setCroppingIndex(i)}
                        className="w-5 h-5 rounded bg-emerald-600/95 text-white flex items-center justify-center"
                        title="Recortar"
                      >
                        <Crop size={11} />
                      </button>
                      <button onClick={() => removeImage(i)} className="w-5 h-5 rounded bg-red-600/90 text-white flex items-center justify-center" title="Quitar">
                        <X size={11} />
                      </button>
                    </div>
                    <div className="absolute bottom-0.5 right-0.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition">
                      <button onClick={() => moveImage(i, -1)} className="w-5 h-5 rounded bg-black/60 text-white flex items-center justify-center" title="Mover izquierda">
                        <ChevronUp size={11} className="-rotate-90" />
                      </button>
                      <button onClick={() => moveImage(i, 1)} className="w-5 h-5 rounded bg-black/60 text-white flex items-center justify-center" title="Mover derecha">
                        <ChevronDown size={11} className="-rotate-90" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 bg-slate-800 border-t border-slate-700 px-5 py-3 flex flex-wrap gap-2 justify-between">
          <button onClick={resetField} className="px-3 py-2 rounded-lg text-slate-300 hover:bg-slate-700 text-sm font-semibold">
            Restaurar de Tienda Nube
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-700 text-sm font-semibold">
              Cancelar
            </button>
            <button onClick={save} className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold flex items-center gap-2">
              <Check size={16} /> Aplicar
            </button>
          </div>
        </div>
      </div>

      {croppingIndex !== null && images[croppingIndex] && (
        <ImageCropModal
          src={images[croppingIndex]}
          title="Recortar imagen del producto"
          defaultAspect="4:5"
          onClose={() => setCroppingIndex(null)}
          onApply={(blob) => applyCroppedImage(croppingIndex, blob)}
        />
      )}
      {croppingColorIdx !== null && colorVariants[croppingColorIdx]?.sourceImage && (
        <ImageCropModal
          src={colorVariants[croppingColorIdx].sourceImage!}
          title={`Recortar color — ${colorVariants[croppingColorIdx]?.name || 'sin nombre'}`}
          defaultAspect="1:1"
          lockAspect
          outputSize={COLOR_THUMB_SIZE}
          onClose={() => setCroppingColorIdx(null)}
          onApply={(blob) => applyCroppedColorImage(croppingColorIdx, blob)}
        />
      )}
    </div>
  );
};

/* ===================== Editor de portada (modal) ===================== */

const CoverEditorModal: React.FC<{
  cover: CoverConfig;
  onSave: (c: CoverConfig) => void;
  onClose: () => void;
}> = ({ cover, onSave, onClose }) => {
  const [c, setC] = useState<CoverConfig>(cover);
  const [uploading, setUploading] = useState<'logo' | 'bg' | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [cropping, setCropping] = useState<'logo' | 'bg' | null>(null);
  const inputCls =
    'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:ring-2 focus:ring-emerald-500';
  const labelCls = 'text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1 block';
  const set = (k: keyof CoverConfig, v: any) => setC((prev) => ({ ...prev, [k]: v }));

  const uploadImage = async (e: React.ChangeEvent<HTMLInputElement>, target: 'logo' | 'bg') => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError('');
    setUploading(target);
    try {
      const url = await api.uploadCatalogImage(file);
      set(target === 'logo' ? 'logoUrl' : 'backgroundUrl', url);
    } catch (err: any) {
      setUploadError(err?.message || 'No se pudo subir la imagen');
    } finally {
      setUploading(null);
      e.target.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-700 px-5 py-4 flex items-center justify-between">
          <h3 className="font-bold text-white flex items-center gap-2">
            <BookOpen size={18} className="text-emerald-400" /> Editar portada
          </h3>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-white rounded-lg">
            <X size={20} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <label className="flex items-center gap-2 text-sm text-slate-200 font-semibold">
            <input type="checkbox" checked={c.enabled} onChange={(e) => set('enabled', e.target.checked)} className="w-4 h-4 accent-emerald-500" />
            Mostrar portada
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Marca</label>
              <input className={inputCls} value={c.brand} onChange={(e) => set('brand', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Título</label>
              <input className={inputCls} value={c.title} onChange={(e) => set('title', e.target.value)} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Colección</label>
            <input className={inputCls} value={c.collection} onChange={(e) => set('collection', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Subtítulo</label>
            <input className={inputCls} value={c.subtitle} onChange={(e) => set('subtitle', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Sitio web</label>
              <input className={inputCls} value={c.website} onChange={(e) => set('website', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Categoría / línea</label>
              <input className={inputCls} value={c.category} onChange={(e) => set('category', e.target.value)} placeholder="Lencería" />
            </div>
          </div>

          {uploadError && <p className="text-red-400 text-xs">{uploadError}</p>}
          <div className="grid grid-cols-2 gap-3">
            {/* Logo */}
            <div>
              <label className={labelCls}>Logo</label>
              <div className="flex items-center gap-2">
                <div className="w-16 h-16 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center overflow-hidden shrink-0">
                  {c.logoUrl ? <img src={c.logoUrl} alt="logo" className="w-full h-full object-contain" /> : <ImageOff size={20} className="text-slate-600" />}
                </div>
                <div className="flex flex-col gap-1">
                  <label className="cursor-pointer text-xs font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1.5">
                    {uploading === 'logo' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    Subir logo
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadImage(e, 'logo')} disabled={uploading !== null} />
                  </label>
                  {c.logoUrl && (
                    <>
                      <button onClick={() => setCropping('logo')} className="text-xs text-emerald-400 hover:text-emerald-300 text-left flex items-center gap-1">
                        <Crop size={12} /> Recortar
                      </button>
                      <button onClick={() => set('logoUrl', undefined)} className="text-xs text-red-400 hover:text-red-300 text-left">Quitar</button>
                    </>
                  )}
                </div>
              </div>
            </div>
            {/* Fondo */}
            <div>
              <label className={labelCls}>Imagen de fondo</label>
              <div className="flex items-center gap-2">
                <div className="w-16 h-16 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center overflow-hidden shrink-0">
                  {c.backgroundUrl ? <img src={c.backgroundUrl} alt="fondo" className="w-full h-full object-cover" /> : <ImageOff size={20} className="text-slate-600" />}
                </div>
                <div className="flex flex-col gap-1">
                  <label className="cursor-pointer text-xs font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1.5">
                    {uploading === 'bg' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    Subir fondo
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadImage(e, 'bg')} disabled={uploading !== null} />
                  </label>
                  {c.backgroundUrl && (
                    <>
                      <button onClick={() => setCropping('bg')} className="text-xs text-emerald-400 hover:text-emerald-300 text-left flex items-center gap-1">
                        <Crop size={12} /> Recortar
                      </button>
                      <button onClick={() => set('backgroundUrl', undefined)} className="text-xs text-red-400 hover:text-red-300 text-left">Quitar</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="border-t border-slate-700 px-5 py-3 flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-700 text-sm font-semibold">
            Cancelar
          </button>
          <button
            onClick={() => { onSave(c); onClose(); }}
            className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold flex items-center gap-2"
          >
            <Check size={16} /> Aplicar
          </button>
        </div>
      </div>

      {cropping === 'logo' && c.logoUrl && (
        <ImageCropModal
          src={c.logoUrl}
          title="Recortar logo"
          defaultAspect="1:1"
          onClose={() => setCropping(null)}
          onApply={async (blob) => {
            const file = new File([blob], `logo-crop-${Date.now()}.jpg`, { type: 'image/jpeg' });
            const url = await api.uploadCatalogImage(file);
            set('logoUrl', url);
          }}
        />
      )}
      {cropping === 'bg' && c.backgroundUrl && (
        <ImageCropModal
          src={c.backgroundUrl}
          title="Recortar fondo de portada"
          defaultAspect="16:9"
          onClose={() => setCropping(null)}
          onApply={async (blob) => {
            const file = new File([blob], `bg-crop-${Date.now()}.jpg`, { type: 'image/jpeg' });
            const url = await api.uploadCatalogImage(file);
            set('backgroundUrl', url);
          }}
        />
      )}
    </div>
  );
};

/* ===================== Editor de colores (modal) ===================== */

const ColorsModal: React.FC<{
  colors: ColorsConfig;
  onSave: (c: ColorsConfig) => void;
  onClose: () => void;
}> = ({ colors, onSave, onClose }) => {
  const [c, setC] = useState<ColorsConfig>(colors);
  const set = (k: keyof ColorsConfig, v: string) => setC((prev) => ({ ...prev, [k]: v }));

  const row = (k: keyof ColorsConfig, label: string) => (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-slate-200">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={c[k]}
          onChange={(e) => set(k, e.target.value)}
          className="w-24 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-white text-xs font-mono outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <input
          type="color"
          value={c[k]}
          onChange={(e) => set(k, e.target.value)}
          className="w-9 h-9 rounded-lg border border-slate-700 bg-transparent cursor-pointer p-0"
        />
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-700 px-5 py-4 flex items-center justify-between">
          <h3 className="font-bold text-white flex items-center gap-2">
            <Palette size={18} className="text-emerald-400" /> Colores
          </h3>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-white rounded-lg">
            <X size={20} />
          </button>
        </div>
        <div className="p-5">
          <div className="divide-y divide-slate-700/60">
            {row('heading', 'Títulos (nombres, secciones)')}
            {row('accent', 'Acento (líneas, etiquetas)')}
            {row('text', 'Texto de descripción')}
            {row('coverBg', 'Fondo de portada / pie')}
            {row('coverText', 'Texto de portada / pie')}
          </div>

          {/* Vista previa */}
          <div className="mt-4 rounded-xl overflow-hidden border border-slate-200">
            <div className="px-4 py-5 text-center" style={{ backgroundColor: c.coverBg, color: c.coverText }}>
              <p className="text-2xl font-black">LUPO</p>
              <div className="w-12 h-[3px] mx-auto my-2" style={{ backgroundColor: c.accent }} />
              <p className="text-[10px] tracking-widest uppercase opacity-80">Colección 2026</p>
            </div>
            <div className="bg-white p-4">
              <p className="text-lg font-black" style={{ color: c.heading }}>Bombacha Seamless</p>
              <p className="text-xs mt-1" style={{ color: c.text }}>Descripción del producto de ejemplo.</p>
              <p className="text-[10px] font-bold uppercase tracking-widest mt-2" style={{ color: c.accent }}>Talles</p>
            </div>
          </div>

          <button
            onClick={() => setC(defaultColors())}
            className="mt-3 text-xs text-slate-400 hover:text-slate-200 font-semibold"
          >
            Restaurar colores Lupo
          </button>
        </div>
        <div className="border-t border-slate-700 px-5 py-3 flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-700 text-sm font-semibold">
            Cancelar
          </button>
          <button
            onClick={() => { onSave(c); onClose(); }}
            className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold flex items-center gap-2"
          >
            <Check size={16} /> Aplicar
          </button>
        </div>
      </div>
    </div>
  );
};

/* ===================== Editor de tipografía (modal) ===================== */

const TypographyModal: React.FC<{
  fontHeading: string;
  fontBody: string;
  onSave: (heading: string, body: string) => void;
  onClose: () => void;
}> = ({ fontHeading, fontBody, onSave, onClose }) => {
  const [heading, setHeading] = useState(fontHeading);
  const [body, setBody] = useState(fontBody);

  useEffect(() => {
    ensureGoogleFont(findFont(heading));
  }, [heading]);
  useEffect(() => {
    ensureGoogleFont(findFont(body));
  }, [body]);

  const headingStack = findFont(heading).stack || undefined;
  const bodyStack = findFont(body).stack || undefined;
  const selectCls =
    'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:ring-2 focus:ring-emerald-500';
  const labelCls = 'text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1 block';

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-700 px-5 py-4 flex items-center justify-between">
          <h3 className="font-bold text-white flex items-center gap-2">
            <Type size={18} className="text-emerald-400" /> Tipografía
          </h3>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-white rounded-lg">
            <X size={20} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Fuente de títulos</label>
              <select className={selectCls} value={heading} onChange={(e) => setHeading(e.target.value)}>
                {FONT_OPTIONS.map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Fuente de texto</label>
              <select className={selectCls} value={body} onChange={(e) => setBody(e.target.value)}>
                {FONT_OPTIONS.map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Vista previa */}
          <div className="rounded-xl bg-white p-5 border border-slate-200">
            <p className="text-[10px] uppercase tracking-widest text-[#c8102e] font-bold mb-1">Vista previa</p>
            <h4 className="text-2xl font-black text-[#0b1f3a] leading-tight" style={{ fontFamily: headingStack }}>
              Bombacha Básica Seamless
            </h4>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed" style={{ fontFamily: bodyStack }}>
              Bombacha seamless de tacto suave y ajuste anatómico diseñada para acompañarte todos los días con máxima comodidad.
            </p>
            <p className="text-xs font-bold tracking-widest text-slate-400 mt-3" style={{ fontFamily: bodyStack }}>
              ART. 40306-001
            </p>
          </div>
        </div>
        <div className="border-t border-slate-700 px-5 py-3 flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-700 text-sm font-semibold">
            Cancelar
          </button>
          <button
            onClick={() => { onSave(heading, body); onClose(); }}
            className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold flex items-center gap-2"
          >
            <Check size={16} /> Aplicar
          </button>
        </div>
      </div>
    </div>
  );
};

/* ===================== Ficha de producto (display) ===================== */

const ProductDisplay: React.FC<{
  product: DisplayProduct;
  flip: boolean;
  showPrice: boolean;
  editMode: boolean;
  headingFont?: string;
  colors: ColorsConfig;
  onToggleInclude: () => void;
  onEdit: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}> = ({ product, flip, showPrice, editMode, headingFont, colors, onToggleInclude, onEdit, onMoveUp, onMoveDown }) => {
  const img = product.images[product.imageIndex] || product.images[0] || '';
  const dimmed = editMode && !product.included;

  return (
    <article
      className={`tn-product break-inside-avoid relative rounded-xl overflow-hidden border border-slate-200 bg-white ${
        dimmed ? 'opacity-40' : ''
      }`}
    >
      {editMode && (
        <div className="tn-noprint absolute top-2 right-2 z-10 flex gap-1">
          {onMoveUp && (
            <button onClick={onMoveUp} className="w-8 h-8 rounded-lg bg-white/90 border border-slate-300 text-slate-600 hover:bg-white flex items-center justify-center shadow" title="Subir">
              <ChevronUp size={16} />
            </button>
          )}
          {onMoveDown && (
            <button onClick={onMoveDown} className="w-8 h-8 rounded-lg bg-white/90 border border-slate-300 text-slate-600 hover:bg-white flex items-center justify-center shadow" title="Bajar">
              <ChevronDown size={16} />
            </button>
          )}
          <button onClick={onEdit} className="w-8 h-8 rounded-lg bg-white/90 border border-slate-300 text-slate-700 hover:bg-white flex items-center justify-center shadow" title="Editar">
            <Pencil size={15} />
          </button>
          <button
            onClick={onToggleInclude}
            className={`w-8 h-8 rounded-lg border flex items-center justify-center shadow ${
              product.included ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-white/90 border-slate-300 text-slate-500'
            }`}
            title={product.included ? 'Quitar del catálogo' : 'Incluir en el catálogo'}
          >
            {product.included ? <Eye size={15} /> : <EyeOff size={15} />}
          </button>
        </div>
      )}

      <div className={`flex flex-col ${flip ? 'md:flex-row-reverse' : 'md:flex-row'}`}>
        {/* Imagen */}
        <div className="md:w-1/2 bg-[#f4f1ec] flex items-center justify-center aspect-[4/5] md:aspect-auto md:min-h-[340px] overflow-hidden">
          {img ? (
            <img src={img} alt={product.name} loading="lazy" className="w-full h-full object-cover" />
          ) : (
            <div className="flex flex-col items-center text-slate-300 py-16">
              <ImageOff size={44} />
              <span className="text-xs mt-2">Sin imagen</span>
            </div>
          )}
        </div>

        {/* Detalles */}
        <div className="md:w-1/2 p-5 sm:p-7 flex flex-col justify-center">
          <h3 className="text-2xl font-black leading-tight tracking-tight" style={{ fontFamily: headingFont, color: colors.heading }}>{product.name}</h3>

          {showPrice && product.price != null && (
            <div className="mt-1 flex items-baseline gap-2">
              {product.promotionalPrice != null ? (
                <>
                  <span className="text-xl font-black" style={{ color: colors.accent }}>{formatPrice(product.promotionalPrice)}</span>
                  <span className="text-sm text-slate-400 line-through">{formatPrice(product.price)}</span>
                </>
              ) : (
                <span className="text-xl font-black" style={{ color: colors.heading }}>{formatPrice(product.price)}</span>
              )}
            </div>
          )}

          {product.description && (
            <p className="mt-3 text-[13.5px] leading-relaxed whitespace-pre-line" style={{ color: colors.text }}>{product.description}</p>
          )}

          {product.features.length > 0 && (
            <ul className="mt-3 space-y-1">
              {product.features.map((f, i) => (
                <li key={i} className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: colors.heading }}>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: colors.accent }} />
                  {f}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-200 pt-3">
            {product.composition && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: colors.accent }}>Composición</p>
                <p className="text-[13px] text-slate-700 leading-snug">{product.composition}</p>
              </div>
            )}
            {product.sizesText && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: colors.accent }}>Talles</p>
                <p className="text-[13px] font-semibold text-slate-800">{product.sizesText}</p>
              </div>
            )}
          </div>

          {product.colorVariants.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: colors.accent }}>Colores</p>
              <div className="flex flex-wrap gap-3">
                {product.colorVariants.map((cv, i) => {
                  const hex = colorToHex(cv.name);
                  return (
                    <div key={`${cv.name}-${i}`} className="flex flex-col items-center gap-1 min-w-[52px]">
                      <div className="w-12 h-12 rounded-md overflow-hidden border border-slate-200 bg-slate-50 flex items-center justify-center shadow-sm">
                        {cv.image || cv.sourceImage ? (
                          <img src={cv.image || cv.sourceImage} alt={cv.name} className="w-full h-full object-cover" />
                        ) : (
                          <span
                            className="w-7 h-7 rounded-full border border-slate-300"
                            style={{ backgroundColor: hex || '#e2e8f0' }}
                          />
                        )}
                      </div>
                      <span className="text-[11px] font-medium text-slate-700 text-center leading-tight max-w-[72px]">
                        {cv.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {product.articleCode && (
            <p className="mt-4 text-[11px] font-bold tracking-widest text-slate-400">ART. {product.articleCode}</p>
          )}
        </div>
      </div>
    </article>
  );
};

/* ===================== Componente principal ===================== */

const TiendaNubeCatalogView: React.FC = () => {
  const [catalog, setCatalog] = useState<TnCatalog | null>(null);
  const [config, setConfig] = useState<CatalogConfig>(defaultConfig());
  const [savedSnapshot, setSavedSnapshot] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [activeSection, setActiveSection] = useState<number | 'all'>('all');
  const [editMode, setEditMode] = useState(false);
  const [editingProduct, setEditingProduct] = useState<{ section: TiendaNubeCatalogSection; product: TiendaNubeCatalogProduct } | null>(null);
  const [editingCover, setEditingCover] = useState(false);
  const [editingTypography, setEditingTypography] = useState(false);
  const [editingColors, setEditingColors] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const savedSnapshotRef = useRef('');
  const configRef = useRef(config);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    savedSnapshotRef.current = savedSnapshot;
  }, [savedSnapshot]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(config));
      } catch {
        /* quota */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [config]);

  const headingStack = useMemo(() => findFont(config.fontHeading).stack || undefined, [config.fontHeading]);
  const bodyStack = useMemo(() => findFont(config.fontBody).stack || undefined, [config.fontBody]);
  const colors = config.colors || defaultColors();

  useEffect(() => {
    ensureGoogleFont(findFont(config.fontHeading));
    ensureGoogleFont(findFont(config.fontBody));
  }, [config.fontHeading, config.fontBody]);

  const dirty = useMemo(() => JSON.stringify(config) !== savedSnapshot, [config, savedSnapshot]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [data, cfgRes] = await Promise.all([
        api.getTiendaNubeCatalog(),
        api.getTiendaNubeCatalogConfig().catch(() => ({ config: null, updatedAt: null })),
      ]);
      setCatalog(data);
      try {
        localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(data));
      } catch {
        /* quota */
      }
      const base = defaultConfig();
      const serverCfg = buildConfigFromResponse(cfgRes?.config, base);
      const merged = mergeCatalogConfig(serverCfg, readCachedConfig());
      const isDirty = JSON.stringify(configRef.current) !== savedSnapshotRef.current;
      if (!isDirty) {
        setConfig(merged);
        const snap = JSON.stringify(merged);
        setSavedSnapshot(snap);
        savedSnapshotRef.current = snap;
        setSavedAt(cfgRes?.updatedAt || null);
      }
      setActiveSection('all');
    } catch (e: any) {
      setError(e?.message || 'No se pudo generar el catálogo desde Tienda Nube');
    } finally {
      setLoading(false);
    }
  }, []);

  // Al montar: recuperar el catálogo cacheado (para que no se borre al cambiar de sección / actualizar)
  // y la configuración guardada.
  useEffect(() => {
    try {
      const cached = localStorage.getItem(CATALOG_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed?.sections) setCatalog(parsed);
      }
    } catch { /* ignore */ }

    api
      .getTiendaNubeCatalogConfig()
      .then((res) => {
        const base = defaultConfig();
        const serverCfg = buildConfigFromResponse(res?.config, base);
        const merged = mergeCatalogConfig(serverCfg, readCachedConfig());
        setConfig(merged);
        const snap = JSON.stringify(merged);
        setSavedSnapshot(snap);
        savedSnapshotRef.current = snap;
        setSavedAt(res?.updatedAt || null);
      })
      .catch(() => {
        const cached = readCachedConfig();
        if (cached) {
          const merged = mergeCatalogConfig(defaultConfig(), cached);
          setConfig(merged);
          const snap = JSON.stringify(merged);
          setSavedSnapshot(snap);
          savedSnapshotRef.current = snap;
        }
      });
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await api.saveTiendaNubeCatalogConfig(config);
      const snap = JSON.stringify(config);
      setSavedSnapshot(snap);
      savedSnapshotRef.current = snap;
      setSavedAt(new Date().toISOString());
      try {
        localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(config));
      } catch {
        /* quota */
      }
    } catch (e: any) {
      setError(e?.message || 'No se pudo guardar la configuración');
    } finally {
      setSaving(false);
    }
  }, [config]);

  /* ---------- Mutadores de config ---------- */

  const setProductOverride = (id: number, patch: Partial<ProductOverride>) => {
    setConfig((prev) => ({
      ...prev,
      products: { ...prev.products, [id]: { ...prev.products[id], ...patch } },
    }));
  };

  const toggleProduct = (id: number) => {
    setConfig((prev) => {
      const cur = prev.products[id]?.included !== false;
      return { ...prev, products: { ...prev.products, [id]: { ...prev.products[id], included: !cur } } };
    });
  };

  const toggleSection = (id: number) => {
    setConfig((prev) => {
      const cur = prev.sections[id]?.included !== false;
      return { ...prev, sections: { ...prev.sections, [id]: { ...prev.sections[id], included: !cur } } };
    });
  };

  const renameSection = (id: number, name: string) => {
    setConfig((prev) => ({ ...prev, sections: { ...prev.sections, [id]: { ...prev.sections[id], name } } }));
  };

  const moveSection = (id: number, dir: -1 | 1) => {
    if (!catalog) return;
    const base = catalog.sections.map((s) => s.id);
    const order = orderedIds(config.sectionOrder, base);
    const idx = order.indexOf(id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= order.length) return;
    [order[idx], order[j]] = [order[j], order[idx]];
    setConfig((prev) => ({ ...prev, sectionOrder: order }));
  };

  const moveProduct = (sectionId: number, baseIds: number[], id: number, dir: -1 | 1) => {
    const order = orderedIds(config.productOrder[sectionId], baseIds);
    const idx = order.indexOf(id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= order.length) return;
    [order[idx], order[j]] = [order[j], order[idx]];
    setConfig((prev) => ({ ...prev, productOrder: { ...prev.productOrder, [sectionId]: order } }));
  };

  /* ---------- Modelo ordenado / filtrado para render ---------- */

  const orderedSections = useMemo(() => {
    if (!catalog) return [];
    const base = catalog.sections.map((s) => s.id);
    const order = orderedIds(config.sectionOrder, base);
    const byId = new Map(catalog.sections.map((s) => [s.id, s]));
    const q = search.trim().toLowerCase();

    return order
      .map((id) => byId.get(id))
      .filter((s): s is TiendaNubeCatalogSection => !!s)
      .filter((s) => activeSection === 'all' || s.id === activeSection)
      .map((s) => {
        const baseProdIds = s.products.map((p) => p.id);
        const prodOrder = orderedIds(config.productOrder[s.id], baseProdIds);
        const byPid = new Map(s.products.map((p) => [p.id, p]));
        let products = prodOrder.map((pid) => byPid.get(pid)).filter((p): p is TiendaNubeCatalogProduct => !!p);
        if (q) {
          products = products.filter(
            (p) =>
              (config.products[p.id]?.name ?? p.name).toLowerCase().includes(q) ||
              p.description.toLowerCase().includes(q) ||
              p.sizes.some((x) => x.toLowerCase().includes(q)) ||
              resolveColorVariants(config.products[p.id], p).some((x) =>
                x.name.toLowerCase().includes(q)
              )
          );
        }
        return { section: s, products };
      })
      .filter((x) => x.products.length > 0);
  }, [catalog, config, search, activeSection]);

  // Para preview/print, ocultar secciones/productos excluidos
  const visibleSections = useMemo(() => {
    return orderedSections
      .map(({ section, products }) => {
        const incl = config.sections[section.id]?.included !== false;
        if (!editMode && !incl) return null;
        const prods = editMode ? products : products.filter((p) => config.products[p.id]?.included !== false);
        if (!editMode && prods.length === 0) return null;
        return { section, products: prods, included: incl };
      })
      .filter((x): x is { section: TiendaNubeCatalogSection; products: TiendaNubeCatalogProduct[]; included: boolean } => !!x);
  }, [orderedSections, config, editMode]);

  const totalShown = useMemo(
    () => visibleSections.reduce((acc, s) => acc + s.products.length, 0),
    [visibleSections]
  );

  const cover = config.cover;

  const handlePrint = useCallback(() => {
    const run = () => {
      const prevTitle = document.title;
      const printTitle = [config.cover.brand || 'Catálogo', config.cover.collection].filter(Boolean).join(' - ');
      document.title = printTitle;

      document.body.classList.add('tn-printing');
      const cleanup = () => {
        document.body.classList.remove('tn-printing');
        document.title = prevTitle;
      };
      window.addEventListener('afterprint', cleanup, { once: true });
      setTimeout(cleanup, 120000);

      requestAnimationFrame(() => window.print());
    };
    if (editMode) {
      setEditMode(false);
      setTimeout(run, 250);
    } else {
      run();
    }
  }, [config.cover.brand, config.cover.collection, editMode]);

  return (
    <div className="space-y-5">
      <style>{`
        @media print {
          html, body, #root, main, main > div, .flex, [class*="overflow"], [class*="h-screen"], [class*="h-\\[100dvh\\]"] {
            overflow: visible !important;
            height: auto !important;
            max-height: none !important;
            min-height: 0 !important;
            position: static !important;
          }
          body.tn-printing * { visibility: hidden !important; }
          body.tn-printing .tn-catalog-print,
          body.tn-printing .tn-catalog-print * { visibility: visible !important; }
          body.tn-printing .tn-catalog-print {
            position: static !important;
            left: auto !important;
            top: auto !important;
            width: 100% !important;
            overflow: visible !important;
          }
          .tn-noprint { display: none !important; }
          ${CATALOG_PRINT_CSS}
        }
      `}</style>

      {/* Barra de herramientas */}
      <div className="tn-noprint bg-slate-800/80 border border-slate-700 rounded-2xl p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div>
            <h3 className="text-white font-bold text-base flex items-center gap-2">
              <Layers size={18} className="text-emerald-400" />
              Catálogo Tienda Nube
            </h3>
            <p className="text-slate-400 text-xs mt-0.5">
              Diseño editorial estilo lookbook. Editá qué entra y los textos de cada producto.
              {savedAt && <span className="ml-1 text-slate-500">· Guardado {new Date(savedAt).toLocaleString('es-AR')}</span>}
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
            {catalog && (
              <>
                <button
                  onClick={() => setEditMode((v) => !v)}
                  className={`min-h-[44px] px-4 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 border ${
                    editMode ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600'
                  }`}
                >
                  <Pencil size={18} /> {editMode ? 'Editando' : 'Editar'}
                </button>
                <button
                  onClick={save}
                  disabled={!dirty || saving}
                  className="min-h-[44px] px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold text-sm flex items-center gap-2"
                >
                  {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                  {dirty ? 'Guardar' : 'Guardado'}
                </button>
                <button
                  onClick={handlePrint}
                  disabled={totalShown === 0}
                  className="min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white font-bold text-sm flex items-center gap-2 border border-slate-600"
                >
                  <Printer size={18} /> PDF
                </button>
              </>
            )}
          </div>
        </div>

        {catalog && (
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nombre, talle o color..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                />
              </div>
              <button
                onClick={() => setConfig((p) => ({ ...p, showPrice: !p.showPrice }))}
                className={`min-h-[44px] px-3 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 border ${
                  config.showPrice ? 'bg-amber-600 border-amber-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600'
                }`}
              >
                <DollarSign size={18} /> {config.showPrice ? 'Con precios' : 'Sin precios'}
              </button>
              {editMode && (
                <>
                  <button
                    onClick={() => setEditingCover(true)}
                    className="min-h-[44px] px-3 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 border bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600"
                  >
                    <BookOpen size={18} /> Portada
                  </button>
                  <button
                    onClick={() => setEditingTypography(true)}
                    className="min-h-[44px] px-3 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 border bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600"
                  >
                    <Type size={18} /> Fuente
                  </button>
                  <button
                    onClick={() => setEditingColors(true)}
                    className="min-h-[44px] px-3 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 border bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600"
                  >
                    <Palette size={18} /> Colores
                  </button>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setActiveSection('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                  activeSection === 'all' ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                Todas ({catalog.productCount})
              </button>
              {catalog.sections.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActiveSection(s.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                    activeSection === s.id ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  {config.sections[s.id]?.name || s.name} ({s.productCount})
                </button>
              ))}
            </div>
            {editMode && (
              <p className="text-xs text-indigo-300 bg-indigo-950/40 border border-indigo-800/50 rounded-lg px-3 py-2">
                Modo edición: usá el ojo para incluir/quitar, el lápiz para editar textos e imagen, y las flechas para reordenar.
                Acordate de <strong>Guardar</strong> al terminar.
              </p>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="tn-noprint bg-red-900/20 border border-red-800 rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={20} />
          <div className="min-w-0">
            <p className="text-red-300 font-medium text-sm">Ocurrió un problema</p>
            <p className="text-slate-400 text-sm mt-0.5">{error}</p>
            <p className="text-slate-500 text-xs mt-1">Verificá que Tienda Nube esté conectada en Configuración.</p>
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
            Toca «Generar catálogo» para traer todos los productos con imágenes, talles, colores y descripciones,
            separados por cada sección, con un diseño editorial listo para imprimir.
          </p>
        </div>
      )}

      {/* Catálogo (área imprimible) */}
      {catalog && totalShown > 0 && (
        <div className="tn-catalog-print bg-white rounded-2xl overflow-hidden shadow-sm" style={{ fontFamily: bodyStack }}>
          {/* Portada */}
          {cover.enabled && (
            <div
              className="tn-cover relative px-8 py-16 sm:py-24 text-center overflow-hidden"
              style={{ backgroundColor: cover.backgroundUrl ? '#000' : colors.coverBg }}
            >
              {cover.backgroundUrl ? (
                <>
                  <img src={cover.backgroundUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
                  <div className="absolute inset-0" style={{ backgroundColor: colors.coverBg, opacity: 0.62 }} />
                </>
              ) : (
                <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_30%_20%,#ffffff_0,transparent_45%)]" />
              )}
              <div className="relative" style={{ color: colors.coverText }}>
                {cover.logoUrl && (
                  <img src={cover.logoUrl} alt="logo" className="mx-auto max-h-24 object-contain mb-5" />
                )}
                <p className="text-sm tracking-[0.4em] uppercase opacity-60">{cover.title}</p>
                <h1 className="text-6xl sm:text-7xl font-black tracking-tight mt-2" style={{ fontFamily: headingStack }}>{cover.brand}</h1>
                <div className="w-20 h-[3px] mx-auto my-6" style={{ backgroundColor: colors.accent }} />
                <p className="text-lg tracking-[0.25em] uppercase opacity-80">{cover.collection}</p>
                {cover.category && (
                  <p className="mt-8 text-3xl font-light italic opacity-90" style={{ fontFamily: headingStack }}>{cover.category}</p>
                )}
                {cover.subtitle && (
                  <p className="mt-6 text-xs tracking-[0.2em] uppercase opacity-60 max-w-md mx-auto">{cover.subtitle}</p>
                )}
                <p className="mt-10 text-sm tracking-[0.3em] opacity-70">{cover.website}</p>
              </div>
            </div>
          )}

          <div className="p-4 sm:p-7 space-y-12">
            {visibleSections.map(({ section, products, included }) => {
              const baseProdIds = section.products.map((p) => p.id);
              return (
                <section key={section.id} className={`tn-section ${editMode && !included ? 'opacity-50' : ''}`}>
                  {/* Divisor de sección */}
                  <div className="relative mb-6">
                    {editMode ? (
                      <div className="tn-noprint flex flex-wrap items-center gap-2 bg-slate-100 rounded-xl p-2">
                        <button
                          onClick={() => toggleSection(section.id)}
                          className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                            included ? 'bg-emerald-600 text-white' : 'bg-slate-300 text-slate-600'
                          }`}
                          title={included ? 'Quitar sección' : 'Incluir sección'}
                        >
                          {included ? <Eye size={16} /> : <EyeOff size={16} />}
                        </button>
                        <input
                          value={config.sections[section.id]?.name ?? section.name}
                          onChange={(e) => renameSection(section.id, e.target.value)}
                          className="flex-1 min-w-[160px] bg-white border border-slate-300 rounded-lg px-3 py-2 text-[#0b1f3a] font-bold uppercase tracking-wide text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        <span className="text-xs text-slate-400 font-semibold">{products.length} prod.</span>
                        <button onClick={() => moveSection(section.id, -1)} className="w-9 h-9 rounded-lg bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 flex items-center justify-center" title="Subir sección">
                          <ChevronUp size={16} />
                        </button>
                        <button onClick={() => moveSection(section.id, 1)} className="w-9 h-9 rounded-lg bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 flex items-center justify-center" title="Bajar sección">
                          <ChevronDown size={16} />
                        </button>
                      </div>
                    ) : (
                      <div className="text-center py-4 border-y-2" style={{ borderColor: colors.heading }}>
                        <div className="inline-flex items-center gap-3">
                          <span className="w-8 h-[2px]" style={{ backgroundColor: colors.accent }} />
                          <h2 className="text-3xl font-black uppercase tracking-[0.15em]" style={{ fontFamily: headingStack, color: colors.heading }}>
                            {config.sections[section.id]?.name || section.name}
                          </h2>
                          <span className="w-8 h-[2px]" style={{ backgroundColor: colors.accent }} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Productos */}
                  <div className="space-y-6">
                    {products.map((p, i) => {
                      const dp = mergeProduct(p, config.products[p.id]);
                      return (
                        <ProductDisplay
                          key={`${section.id}-${p.id}`}
                          product={dp}
                          flip={i % 2 === 1}
                          showPrice={config.showPrice}
                          editMode={editMode}
                          headingFont={headingStack}
                          colors={colors}
                          onToggleInclude={() => toggleProduct(p.id)}
                          onEdit={() => setEditingProduct({ section, product: p })}
                          onMoveUp={editMode ? () => moveProduct(section.id, baseProdIds, p.id, -1) : undefined}
                          onMoveDown={editMode ? () => moveProduct(section.id, baseProdIds, p.id, 1) : undefined}
                        />
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>

          <div className="text-center text-[11px] py-3 px-6 tracking-widest" style={{ backgroundColor: colors.coverBg, color: colors.coverText }}>
            <span className="opacity-70">
              {cover.brand} · {cover.website} · Generado el {new Date(catalog.generatedAt).toLocaleDateString('es-AR')}
            </span>
          </div>
        </div>
      )}

      {catalog && totalShown === 0 && (
        <div className="tn-noprint bg-slate-800/50 border border-slate-700 rounded-2xl p-10 text-center">
          <Search size={40} className="mx-auto text-slate-600 mb-3" />
          <p className="text-slate-400 font-medium">No hay productos para mostrar con los filtros actuales</p>
        </div>
      )}

      {/* Modales */}
      {editingProduct && (
        <ProductEditorModal
          product={editingProduct.product}
          override={config.products[editingProduct.product.id]}
          onSave={(ov) => setProductOverride(editingProduct.product.id, ov)}
          onClose={() => setEditingProduct(null)}
        />
      )}
      {editingCover && (
        <CoverEditorModal
          cover={cover}
          onSave={(c) => setConfig((prev) => ({ ...prev, cover: c }))}
          onClose={() => setEditingCover(false)}
        />
      )}
      {editingTypography && (
        <TypographyModal
          fontHeading={config.fontHeading}
          fontBody={config.fontBody}
          onSave={(heading, body) => setConfig((prev) => ({ ...prev, fontHeading: heading, fontBody: body }))}
          onClose={() => setEditingTypography(false)}
        />
      )}
      {editingColors && (
        <ColorsModal
          colors={colors}
          onSave={(c) => setConfig((prev) => ({ ...prev, colors: c }))}
          onClose={() => setEditingColors(false)}
        />
      )}
    </div>
  );
};

export default TiendaNubeCatalogView;
