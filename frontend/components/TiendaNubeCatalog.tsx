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
  Ruler,
  Tag,
} from 'lucide-react';
import {
  api,
  TiendaNubeCatalog as TnCatalog,
  TiendaNubeCatalogProduct,
  TiendaNubeCatalogSection,
} from '../services/api';
import ImageCropModal from './ImageCropModal';
import { articleCodeForPrintGroup } from '../utils/wholesaleInvoiceHtml';
import {
  colorVariantDisplaySrc,
  pickCatalogProductImages,
  resolveCatalogImageSrc,
} from '../utils/catalogImageUrl';
import { autoCropColorThumb, CATALOG_COLOR_THUMB_SIZE } from '../utils/catalogColorCrop';
import { Role, PriceList } from '../types';

/* ===================== Tipos de configuración editable ===================== */

interface ColorVariant {
  name: string;
  /** Foto del color asignada en Tienda Nube (referencia para recortar). */
  sourceImage?: string;
  /** Miniatura recortada (cuadrado 160px), guardada tras aplicar recorte. */
  image?: string;
}

const COLOR_THUMB_SIZE = CATALOG_COLOR_THUMB_SIZE;

const CATALOG_PRINT_CSS = `
  @page { size: A4 landscape; margin: 0; }
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #fff;
    width: 100% !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body.tn-printing aside,
  body.tn-printing header,
  body.tn-printing nav,
  body.tn-printing .tn-noprint {
    display: none !important;
  }
  body.tn-printing main,
  body.tn-printing main > div,
  body.tn-printing #root,
  body.tn-printing #root > div {
    padding: 0 !important;
    margin: 0 !important;
    max-width: none !important;
    width: 100% !important;
    overflow: visible !important;
    height: auto !important;
    min-height: 0 !important;
  }
  .tn-catalog-print {
    position: relative !important;
    width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: visible !important;
    border-radius: 0 !important;
    box-shadow: none !important;
  }
  .tn-catalog-body {
    padding: 0 !important;
    margin: 0 !important;
    gap: 0 !important;
  }
  .tn-catalog-body > .tn-section:first-child .tn-section-head {
    break-before: auto !important;
    page-break-before: auto !important;
  }
  .tn-section {
    margin: 0 !important;
    padding: 0 !important;
  }
  .tn-section > div {
    margin: 0 !important;
  }
  .tn-cover-page {
    width: 297mm !important;
    height: 210mm !important;
    max-height: 210mm !important;
    overflow: hidden !important;
    margin: 0 !important;
    padding: 0 !important;
    break-after: page;
    page-break-after: always;
  }
  .tn-cover {
    break-inside: avoid;
    page-break-inside: avoid;
    width: 297mm !important;
    height: 210mm !important;
    min-height: 210mm !important;
    max-height: 210mm !important;
    aspect-ratio: unset !important;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .tn-cover h1 {
    font-family: 'Montserrat', sans-serif !important;
    font-weight: 700 !important;
    letter-spacing: 0.1em !important;
  }
  .tn-section:first-child .tn-section-head {
    break-before: auto;
    page-break-before: auto;
  }
  .tn-products-list {
    gap: 0 !important;
  }
  .tn-product {
    break-inside: avoid;
    page-break-inside: avoid;
    break-after: page;
    page-break-after: always;
    box-shadow: none !important;
    border: none !important;
    border-radius: 0 !important;
    width: 297mm !important;
    height: 210mm !important;
    min-height: 210mm !important;
    max-height: 210mm !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden;
    box-sizing: border-box;
  }
  .tn-product-layout {
    display: flex !important;
    flex-direction: row !important;
    align-items: stretch !important;
    height: 100% !important;
    min-height: 0 !important;
  }
  .tn-product-layout.tn-product-flip {
    flex-direction: row-reverse !important;
  }
  .tn-product-media {
    width: 60% !important;
    flex: 0 0 60% !important;
    max-width: 60% !important;
    min-height: 0 !important;
    height: 100% !important;
    aspect-ratio: auto !important;
    background: #fff !important;
  }
  .tn-product-media img {
    width: 100% !important;
    height: 100% !important;
    object-fit: cover !important;
  }
  .tn-product-info {
    width: 40% !important;
    flex: 0 0 40% !important;
    max-width: 40% !important;
    padding: 0 !important;
    overflow: hidden !important;
    background: #f9f8f6 !important;
    display: flex !important;
    flex-direction: column !important;
    justify-content: flex-start !important;
    align-items: stretch !important;
  }
  .tn-product-info-inner {
    padding: 14mm 11mm 12mm 14mm !important;
    width: 100% !important;
    height: 100% !important;
    min-height: 0 !important;
    box-sizing: border-box !important;
    display: flex !important;
    flex-direction: column !important;
    justify-content: flex-start !important;
    align-items: flex-start !important;
    gap: 0 !important;
    color: #57534e !important;
  }
  .tn-product-intro {
    width: 100% !important;
  }
  .tn-product-details {
    width: 100% !important;
    display: flex !important;
    flex-direction: column !important;
  }
  .tn-product-section {
    width: 100% !important;
  }
  .tn-brand {
    font-size: 7px !important;
    letter-spacing: 0.38em !important;
    font-weight: 300 !important;
    margin-bottom: 4mm !important;
  }
  .tn-section-rule {
    width: 88% !important;
    margin: 5mm auto !important;
  }
  .tn-product-title {
    font-size: 24px !important;
    line-height: 1.15 !important;
    font-weight: 700 !important;
    margin: 0 0 4mm 0 !important;
  }
  .tn-product-copy {
    display: flex !important;
    flex-direction: column !important;
    gap: 2.5mm !important;
    max-width: 94% !important;
  }
  .tn-product-blurb,
  .tn-product-feature {
    font-size: 10px !important;
    line-height: 1.7 !important;
    font-weight: 400 !important;
    color: #78716c !important;
  }
  .tn-section-icon {
    width: 9mm !important;
    height: 9mm !important;
    border-radius: 50% !important;
    border: 0.2mm solid rgba(168, 162, 158, 0.65) !important;
    background: #f9f8f6 !important;
    flex-shrink: 0 !important;
  }
  .tn-section-icon svg {
    width: 3.5mm !important;
    height: 3.5mm !important;
  }
  .tn-product-section {
    display: flex !important;
    gap: 3mm !important;
    align-items: flex-start !important;
  }
  .tn-spec-label {
    font-size: 8px !important;
    letter-spacing: 0.22em !important;
    font-weight: 300 !important;
    color: #a8a29e !important;
    margin-bottom: 1mm !important;
  }
  .tn-spec-value {
    font-size: 11px !important;
    font-weight: 500 !important;
    color: #44403c !important;
  }
  .tn-color-thumb {
    width: 42px !important;
    height: 42px !important;
    border-radius: 2px !important;
  }
  .tn-color-name {
    font-size: 7px !important;
    letter-spacing: 0.14em !important;
    font-weight: 300 !important;
  }
  .tn-product-sku {
    font-size: 10px !important;
    letter-spacing: 0.2em !important;
    font-weight: 300 !important;
    color: #78716c !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  .tn-section-head {
    break-before: page;
    page-break-before: always;
    break-after: avoid;
    page-break-after: avoid;
    width: 297mm !important;
    height: 210mm !important;
    min-height: 210mm !important;
    max-height: 210mm !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    background: #faf8f5 !important;
    border: none !important;
    padding: 0 !important;
    margin: 0 !important;
  }
  .tn-section-head h2 {
    font-size: 32px !important;
    font-weight: 300 !important;
    letter-spacing: 0.4em !important;
  }
  .tn-catalog-footer {
    background: #1c1917 !important;
    color: #f5f0eb !important;
    padding: 5mm !important;
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

/** Paleta de marca Lupo: negro, blanco, azul. */
const BRAND_BLACK = '#000000';
const BRAND_WHITE = '#ffffff';
const BRAND_BLUE = '#6b99de';

function colorsFromBrandPalette(black = BRAND_BLACK, white = BRAND_WHITE, blue = BRAND_BLUE): ColorsConfig {
  return {
    heading: black,
    accent: blue,
    text: black,
    coverBg: black,
    coverText: white,
  };
}

const defaultColors = (): ColorsConfig => colorsFromBrandPalette();

const defaultConfig = (): CatalogConfig => ({
  cover: defaultCover(),
  colors: defaultColors(),
  showPrice: false,
  fontHeading: 'montserrat',
  fontBody: 'montserrat',
  sections: {},
  products: {},
  sectionOrder: [],
  productOrder: {},
});

const CATALOG_CACHE_KEY = 'lupo_tn_catalog_cache';
const CONFIG_CACHE_KEY = 'lupo_tn_catalog_config_cache';
const SELLER_PRICE_LIST_KEY = 'lupo_tn_catalog_seller_price_list';

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
  { id: 'montserrat', label: 'Montserrat', stack: "'Montserrat', sans-serif", google: 'Montserrat:wght@300;400;500;600;700' },
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

  const enrich = (sv: ColorVariant): ColorVariant => {
    const tn = tnByName.get(sv.name);
    return {
      name: sv.name,
      sourceImage: resolveCatalogImageSrc(sv.sourceImage ?? tn?.sourceImage) || undefined,
      image: sv.image ? resolveCatalogImageSrc(sv.image) : undefined,
    };
  };

  // Lista guardada en el editor manda (incluye colores quitados por el usuario).
  if (ov?.colorVariants !== undefined) {
    return ov.colorVariants.filter((c) => c.name.trim()).map(enrich);
  }

  if (ov?.colors?.length) {
    return ov.colors.filter(Boolean).map((name) => enrich({ name }));
  }

  return fromTn;
}

function mergeProduct(p: TiendaNubeCatalogProduct, ov: ProductOverride | undefined): DisplayProduct {
  const images = pickCatalogProductImages(p.images, ov?.images);
  const imageIndex = Math.min(ov?.imageIndex ?? 0, Math.max(0, images.length - 1));
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
    imageIndex,
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
                  Las miniaturas se recortan solas al producto. Podés ajustar con Recortar si hace falta.
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
  const [black, setBlack] = useState(colors.heading || BRAND_BLACK);
  const [white, setWhite] = useState(colors.coverText || BRAND_WHITE);
  const [blue, setBlue] = useState(colors.accent || BRAND_BLUE);

  const applyPalette = (nextBlack: string, nextWhite: string, nextBlue: string) => {
    setBlack(nextBlack);
    setWhite(nextWhite);
    setBlue(nextBlue);
    setC(colorsFromBrandPalette(nextBlack, nextWhite, nextBlue));
  };

  const swatch = (label: string, value: string, onChange: (hex: string) => void) => (
    <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
      <label className="relative cursor-pointer group">
        <span
          className="block w-14 h-14 rounded-full border border-slate-300/80 shadow-sm"
          style={{ backgroundColor: value }}
        />
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          aria-label={label}
        />
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full max-w-[88px] bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-white text-[10px] font-mono text-center outline-none focus:ring-2 focus:ring-emerald-500"
      />
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
          <p className="text-sm font-semibold text-slate-200 mb-3">Paleta de colores</p>
          <div className="rounded-xl border border-slate-600/80 bg-slate-900/40 px-4 py-5">
            <div className="flex items-start justify-center gap-4 sm:gap-6">
              {swatch('Negro', black, (v) => applyPalette(v, white, blue))}
              {swatch('Blanco', white, (v) => applyPalette(black, v, blue))}
              {swatch('Azul', blue, (v) => applyPalette(black, white, v))}
            </div>
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
              <p className="text-xs mt-1 opacity-80" style={{ color: c.text }}>Descripción del producto de ejemplo.</p>
              <p className="text-[10px] font-bold uppercase tracking-widest mt-2" style={{ color: c.accent }}>Talles</p>
            </div>
          </div>

          <button
            onClick={() => applyPalette(BRAND_BLACK, BRAND_WHITE, BRAND_BLUE)}
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

/** Prefijo de artículo para catálogo (ej. 78416140280 → 78416, 40306-001 → 40306-001). */
function catalogArticleCode(raw: string): string {
  const code = String(raw || '').trim();
  if (!code) return '';
  const dashed = code.match(/^(\d{3,6}-\d{2,3})/);
  if (dashed) return dashed[1];
  return articleCodeForPrintGroup(code) || code;
}

/** Texto descriptivo para ficha (1–2 oraciones, estilo catálogo impreso). */
function catalogBlurb(description: string, features: string[]): string | null {
  if (features.length > 0) return null;
  const clean = description.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  const text = (sentences.slice(0, 2).join(' ') || clean).trim();
  if (text.length <= 320) return text;
  return `${text.slice(0, 317).trim()}…`;
}

/** Talles en una sola línea con puntos medios (XG · XXG · XXXG). */
function formatCatalogSizes(text: string): string {
  return text
    .split(/[\s·,\-/]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' · ');
}

/* ===================== Ficha de producto (display) ===================== */

/** Separador fino entre bloques (no ocupa todo el ancho). */
const CatalogSectionRule: React.FC = () => (
  <div className="flex justify-center w-full my-5 shrink-0">
    <div className="tn-section-rule h-px bg-stone-300/75 w-[88%]" />
  </div>
);

const CatalogSpecLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="tn-spec-label text-[9px] uppercase tracking-[0.22em] text-stone-400 font-light mb-1.5">
    {children}
  </p>
);

const CatalogSectionIcon: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="tn-section-icon w-10 h-10 rounded-full border border-stone-300/80 bg-[#f9f8f6] flex items-center justify-center text-stone-500 shrink-0">
    {children}
  </div>
);

const CatalogDetailSection: React.FC<{
  icon: React.ReactNode;
  label?: string;
  children: React.ReactNode;
}> = ({ icon, label, children }) => (
  <div className="tn-detail-block w-full">
    <CatalogSectionRule />
    <div className="tn-product-section flex gap-3.5 items-start w-full">
      <CatalogSectionIcon>{icon}</CatalogSectionIcon>
      <div className="tn-section-body flex-1 min-w-0 pt-0.5">
        {label ? <CatalogSpecLabel>{label}</CatalogSpecLabel> : null}
        {children}
      </div>
    </div>
  </div>
);

const ProductDisplay: React.FC<{
  product: DisplayProduct;
  flip: boolean;
  showPrice: boolean;
  editMode: boolean;
  headingFont?: string;
  bodyFont?: string;
  colors: ColorsConfig;
  onToggleInclude: () => void;
  onEdit: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}> = ({ product, flip, showPrice, editMode, headingFont, bodyFont, colors, onToggleInclude, onEdit, onMoveUp, onMoveDown }) => {
  const img = resolveCatalogImageSrc(product.images[product.imageIndex] || product.images[0] || '');
  const dimmed = editMode && !product.included;
  const blurb = catalogBlurb(product.description, product.features);
  const fontStack = "'Montserrat', sans-serif";
  const iconProps = { size: 15, strokeWidth: 1.5 as const };

  return (
    <article
      className={`tn-product break-inside-avoid relative overflow-hidden bg-white ${
        editMode ? 'rounded-xl border border-slate-200' : ''
      } ${dimmed ? 'opacity-40' : ''}`}
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

      <div className={`tn-product-layout flex flex-col min-h-[380px] md:min-h-[440px] md:items-stretch ${flip ? 'md:flex-row-reverse tn-product-flip' : 'md:flex-row'}`}>
        {/* Texto — diseño catálogo Lupo (Montserrat) */}
        <div className="tn-product-info md:w-[40%] bg-[#f9f8f6] flex flex-col h-full">
          <div
            className="tn-product-info-inner flex flex-col h-full w-full items-start px-9 py-10 md:px-11 md:py-12 text-stone-600"
            style={{ fontFamily: fontStack }}
          >
            <div className="tn-product-intro w-full">
              <p className="tn-brand text-[8px] uppercase tracking-[0.38em] text-stone-400 font-light mb-5">
                Lupo
              </p>

              <h3
                className="tn-product-title text-[1.55rem] md:text-[1.75rem] font-bold leading-[1.15] text-stone-900 mb-5"
                style={{ fontFamily: fontStack, color: colors.heading }}
              >
                {product.name}
              </h3>

              {showPrice && product.price != null && (
                <p className="text-[12px] text-stone-700 mb-4 font-medium">
                  {product.promotionalPrice != null ? (
                    <>
                      <span>{formatPrice(product.promotionalPrice)}</span>
                      <span className="text-stone-400 line-through ml-2 font-normal">{formatPrice(product.price)}</span>
                    </>
                  ) : (
                    formatPrice(product.price)
                  )}
                </p>
              )}

              {(blurb || product.features.length > 0) && (
                <div className="tn-product-copy space-y-3 max-w-[94%]">
                  {blurb && (
                    <p className="tn-product-blurb text-[11px] leading-[1.7] text-stone-500 font-normal">
                      {blurb}
                    </p>
                  )}
                  {product.features.slice(0, 3).map((f, i) => (
                    <p key={i} className="tn-product-feature text-[11px] leading-[1.7] text-stone-500 font-normal">
                      {f}
                    </p>
                  ))}
                </div>
              )}
            </div>

            <div className="tn-product-details w-full flex flex-col">
              {product.sizesText && (
                <CatalogDetailSection icon={<Ruler {...iconProps} />} label="Talles">
                  <p className="tn-spec-value text-[12px] font-medium tracking-wide text-stone-800">
                    {formatCatalogSizes(product.sizesText)}
                  </p>
                </CatalogDetailSection>
              )}

              {product.composition && (
                <CatalogDetailSection icon={<Layers {...iconProps} />} label="Composición">
                  <p className="tn-spec-value text-[11px] leading-[1.6] text-stone-700 font-normal whitespace-pre-line">
                    {product.composition.replace(/\s*-\s*/g, '\n').replace(/,\s*/g, '\n')}
                  </p>
                </CatalogDetailSection>
              )}

              {product.colorVariants.length > 0 && (
                <CatalogDetailSection icon={<Palette {...iconProps} />} label="Colores">
                  <div className="flex flex-wrap justify-start gap-x-5 gap-y-3">
                    {product.colorVariants.map((cv, i) => {
                      const hex = colorToHex(cv.name);
                      const colorLabel = cv.name.replace(/^\d+\s*[·\-]?\s*/, '').trim() || cv.name;
                      const thumbSrc = colorVariantDisplaySrc(cv);
                      return (
                        <div key={`${cv.name}-${i}`} className="flex flex-col items-start gap-1.5">
                          <div className="tn-color-thumb w-11 h-11 rounded-sm overflow-hidden bg-white border border-stone-200/90">
                            {thumbSrc ? (
                              <img src={thumbSrc} alt={colorLabel} className="w-full h-full object-cover" />
                            ) : (
                              <span className="block w-full h-full" style={{ backgroundColor: hex || '#e7e5e4' }} />
                            )}
                          </div>
                          <span className="tn-color-name text-[8px] uppercase tracking-[0.14em] text-stone-500 font-light leading-tight">
                            {colorLabel}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </CatalogDetailSection>
              )}

              {product.articleCode && (
                <CatalogDetailSection icon={<Tag {...iconProps} />}>
                  <p className="tn-product-sku text-[11px] uppercase tracking-[0.2em] text-stone-500 font-light pt-1.5">
                    Art. {catalogArticleCode(product.articleCode)}
                  </p>
                </CatalogDetailSection>
              )}
            </div>
          </div>
        </div>

        {/* Imagen — full bleed */}
        <div className="tn-product-media md:w-[60%] bg-white flex items-center justify-center aspect-[4/5] md:aspect-auto md:min-h-0 overflow-hidden">
          {img ? (
            <img src={img} alt={product.name} loading="lazy" className="w-full h-full object-cover" />
          ) : (
            <div className="flex flex-col items-center text-stone-300 py-16">
              <ImageOff size={40} />
              <span className="text-[10px] mt-2 tracking-widest uppercase">Sin imagen</span>
            </div>
          )}
        </div>
      </div>
    </article>
  );
};

/* ===================== Componente principal ===================== */

const TiendaNubeCatalogView: React.FC<{ role: Role; priceLists?: PriceList[] }> = ({
  role,
  priceLists = [],
}) => {
  const isAdmin = role === Role.ADMIN;
  const isSeller = role === Role.SELLER;

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
  const [autoCroppingColors, setAutoCroppingColors] = useState(false);
  const [configHydrated, setConfigHydrated] = useState(false);
  const [selectedPriceListId, setSelectedPriceListId] = useState<string>(() => {
    try {
      return sessionStorage.getItem(SELLER_PRICE_LIST_KEY) || '';
    } catch {
      return '';
    }
  });
  const savedSnapshotRef = useRef('');
  const configRef = useRef(config);
  const autoCropDoneRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    savedSnapshotRef.current = savedSnapshot;
  }, [savedSnapshot]);

  useEffect(() => {
    if (!isAdmin) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(config));
      } catch {
        /* quota */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [config, isAdmin]);

  const effectiveShowPrice = isSeller ? !!selectedPriceListId : config.showPrice;
  const selectedPriceListName = useMemo(
    () => priceLists.find((pl) => pl.id === selectedPriceListId)?.name || catalog?.priceListName || '',
    [priceLists, selectedPriceListId, catalog?.priceListName]
  );

  const headingStack = useMemo(() => findFont(config.fontHeading).stack || undefined, [config.fontHeading]);
  const bodyStack = useMemo(() => findFont(config.fontBody).stack || undefined, [config.fontBody]);
  const colors = config.colors || defaultColors();

  useEffect(() => {
    ensureGoogleFont(findFont('montserrat'));
    ensureGoogleFont(findFont(config.fontHeading));
    ensureGoogleFont(findFont(config.fontBody));
  }, [config.fontHeading, config.fontBody]);

  const dirty = useMemo(() => JSON.stringify(config) !== savedSnapshot, [config, savedSnapshot]);

  const load = useCallback(async (overridePriceListId?: string) => {
    const priceListId = isSeller ? (overridePriceListId ?? selectedPriceListId) : '';
    if (isSeller && !priceListId) {
      setError('Elegí una lista de precios antes de generar el catálogo.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [data, cfgRes] = await Promise.all([
        api.getTiendaNubeCatalog(
          isSeller && priceListId ? { priceListId } : undefined
        ),
        api.getTiendaNubeCatalogConfig().catch(() => ({ config: null, updatedAt: null })),
      ]);
      setCatalog(data);
      if (isAdmin) {
        try {
          localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(data));
        } catch {
          /* quota */
        }
      }
      const base = defaultConfig();
      const serverCfg = buildConfigFromResponse(cfgRes?.config, base);
      const merged = isAdmin
        ? mergeCatalogConfig(serverCfg, readCachedConfig())
        : serverCfg;
      const isDirty = isAdmin && JSON.stringify(configRef.current) !== savedSnapshotRef.current;
      if (!isDirty) {
        setConfig(merged);
        const snap = JSON.stringify(merged);
        setSavedSnapshot(snap);
        savedSnapshotRef.current = snap;
        setSavedAt(cfgRes?.updatedAt || null);
      }
      setConfigHydrated(true);
      setActiveSection('all');
    } catch (e: any) {
      setError(e?.message || 'No se pudo generar el catálogo desde Tienda Nube');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, isSeller, selectedPriceListId]);

  // Al montar: recuperar el catálogo cacheado (para que no se borre al cambiar de sección / actualizar)
  // y la configuración guardada.
  useEffect(() => {
    if (isAdmin) {
      try {
        const cached = localStorage.getItem(CATALOG_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed?.sections) setCatalog(parsed);
        }
      } catch { /* ignore */ }
    }

    api
      .getTiendaNubeCatalogConfig()
      .then((res) => {
        const base = defaultConfig();
        const serverCfg = buildConfigFromResponse(res?.config, base);
        const merged = isAdmin ? mergeCatalogConfig(serverCfg, readCachedConfig()) : serverCfg;
        setConfig(merged);
        const snap = JSON.stringify(merged);
        setSavedSnapshot(snap);
        savedSnapshotRef.current = snap;
        setSavedAt(res?.updatedAt || null);
        setConfigHydrated(true);
      })
      .catch(() => {
        if (isAdmin) {
          const cached = readCachedConfig();
          if (cached) {
            const merged = mergeCatalogConfig(defaultConfig(), cached);
            setConfig(merged);
            const snap = JSON.stringify(merged);
            setSavedSnapshot(snap);
            savedSnapshotRef.current = snap;
          }
        }
        setConfigHydrated(true);
      });
  }, [isAdmin]);

  // Recorte automático de miniaturas de color (sin imagen guardada aún).
  useEffect(() => {
    if (!isAdmin || !catalog?.sections?.length || !configHydrated) return;

    let cancelled = false;

    const run = async () => {
      type PendingItem = {
        productId: number;
        product: TiendaNubeCatalogProduct;
        cv: ColorVariant;
      };
      const pending: PendingItem[] = [];

      for (const section of catalog.sections) {
        for (const p of section.products) {
          const ov = configRef.current.products[p.id];
          const variants = resolveColorVariants(ov, p);
          for (const cv of variants) {
            if (!cv.sourceImage || cv.image) continue;
            const key = `${p.id}:${cv.name}:${cv.sourceImage}`;
            if (autoCropDoneRef.current.has(key)) continue;
            pending.push({ productId: p.id, product: p, cv });
          }
        }
      }

      if (pending.length === 0 || cancelled) return;

      setAutoCroppingColors(true);
      for (const item of pending) {
        if (cancelled) break;
        const key = `${item.productId}:${item.cv.name}:${item.cv.sourceImage}`;
        autoCropDoneRef.current.add(key);
        try {
          const blob = await autoCropColorThumb(item.cv.sourceImage!);
          const file = new File([blob], `color-auto-${item.productId}-${Date.now()}.jpg`, {
            type: 'image/jpeg',
          });
          const url = await api.uploadCatalogImage(file);
          if (cancelled) break;

          setConfig((prev) => {
            const ov = prev.products[item.productId] || {};
            const variants = resolveColorVariants(ov, item.product);
            const updated = variants.map((cv) =>
              cv.name === item.cv.name && cv.sourceImage === item.cv.sourceImage ? { ...cv, image: url } : cv
            );
            return {
              ...prev,
              products: {
                ...prev.products,
                [item.productId]: { ...ov, colorVariants: updated },
              },
            };
          });
        } catch {
          autoCropDoneRef.current.delete(key);
        }
      }
      if (!cancelled) setAutoCroppingColors(false);
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [catalog, configHydrated, isAdmin]);

  const handlePriceListChange = (id: string) => {
    setSelectedPriceListId(id);
    try {
      sessionStorage.setItem(SELLER_PRICE_LIST_KEY, id);
    } catch {
      /* ignore */
    }
    setError('');
    if (id && catalog) {
      void load(id);
    }
  };

  const save = useCallback(async () => {
    if (!isAdmin) return;
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
  }, [config, isAdmin]);

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
        const prods = isAdmin && editMode ? products : products.filter((p) => config.products[p.id]?.included !== false);
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
        .tn-cover-page {
          width: 100%;
          max-width: 100%;
          overflow: hidden;
        }
        .tn-cover {
          box-sizing: border-box;
          width: 100%;
          aspect-ratio: 297 / 210;
          max-height: calc(100vw * 210 / 297);
        }
        @media print {
          html, body, #root, main, main > div, .flex, [class*="overflow"], [class*="h-screen"], [class*="h-\\[100dvh\\]"] {
            overflow: visible !important;
            height: auto !important;
            max-height: none !important;
            min-height: 0 !important;
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
              {isSeller
                ? 'Generá el catálogo con la lista de precios que elijas. El diseño lo define el administrador.'
                : 'Diseño editorial estilo lookbook. Editá qué entra y los textos de cada producto.'}
              {autoCroppingColors && (
                <span className="ml-1 text-emerald-400">· Recortando miniaturas de colores…</span>
              )}
              {isAdmin && savedAt && (
                <span className="ml-1 text-slate-500">· Guardado {new Date(savedAt).toLocaleString('es-AR')}</span>
              )}
              {isSeller && selectedPriceListName && catalog && (
                <span className="ml-1 text-emerald-400">· Lista: {selectedPriceListName}</span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 lg:ml-auto">
            {isSeller && (
              <select
                value={selectedPriceListId}
                onChange={(e) => handlePriceListChange(e.target.value)}
                className="min-h-[44px] min-w-[200px] bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">Lista de precios…</option>
                {priceLists.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pl.name}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={() => void load()}
              disabled={loading || (isSeller && (!selectedPriceListId || priceLists.length === 0))}
              className="min-h-[44px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm flex items-center gap-2"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
              {catalog ? 'Actualizar' : 'Generar catálogo'}
            </button>
            {catalog && (
              <>
                {isAdmin && (
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
                  </>
                )}
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

        {(catalog || isSeller) && (
          <div className="mt-4 flex flex-col gap-3">
            {isSeller && priceLists.length === 0 && (
              <p className="text-xs text-amber-300 bg-amber-950/40 border border-amber-800/50 rounded-lg px-3 py-2">
                No hay listas de precios disponibles. Pedile al administrador que las configure.
              </p>
            )}
            {isSeller && priceLists.length > 0 && !selectedPriceListId && (
              <p className="text-xs text-amber-300 bg-amber-950/40 border border-amber-800/50 rounded-lg px-3 py-2">
                Seleccioná una lista de precios para generar el catálogo con tus precios mayoristas.
              </p>
            )}
            {catalog && (
            <>
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
              {isAdmin && (
              <button
                onClick={() => setConfig((p) => ({ ...p, showPrice: !p.showPrice }))}
                className={`min-h-[44px] px-3 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 border ${
                  config.showPrice ? 'bg-amber-600 border-amber-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600'
                }`}
              >
                <DollarSign size={18} /> {config.showPrice ? 'Con precios' : 'Sin precios'}
              </button>
              )}
              {isAdmin && editMode && (
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
            {isAdmin && editMode && (
              <p className="text-xs text-indigo-300 bg-indigo-950/40 border border-indigo-800/50 rounded-lg px-3 py-2">
                Modo edición: usá el ojo para incluir/quitar, el lápiz para editar textos e imagen, y las flechas para reordenar.
                Acordate de <strong>Guardar</strong> al terminar.
              </p>
            )}
            </>
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
          <p className="text-slate-400 font-medium">
            {isSeller ? 'Generá tu catálogo con lista de precios' : 'Generá el catálogo desde tu Tienda Nube'}
          </p>
          <p className="text-slate-600 text-sm mt-1 max-w-md mx-auto">
            {isSeller
              ? 'Elegí la lista de precios y tocá «Generar catálogo» para obtener el PDF con tus precios mayoristas.'
              : 'Tocá «Generar catálogo» para traer todos los productos con imágenes, talles, colores y descripciones, separados por cada sección, con un diseño editorial listo para imprimir.'}
          </p>
        </div>
      )}

      {/* Catálogo (área imprimible) */}
      {catalog && totalShown > 0 && (
        <div className="tn-catalog-print bg-white rounded-2xl overflow-hidden shadow-sm" style={{ fontFamily: bodyStack }}>
          {/* Portada */}
          {cover.enabled && (
            <div className="tn-cover-page">
              <div
                className="tn-cover relative text-center overflow-hidden flex items-center justify-center px-8 sm:px-14"
                style={{
                  backgroundColor: cover.backgroundUrl ? '#000' : colors.coverBg,
                  fontFamily: "'Montserrat', sans-serif",
                }}
              >
                {cover.backgroundUrl ? (
                  <>
                    <img src={cover.backgroundUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
                    <div className="absolute inset-0" style={{ backgroundColor: colors.coverBg, opacity: 0.55 }} />
                  </>
                ) : (
                  <>
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_42%,rgba(255,255,255,0.12)_0%,transparent_58%)]" />
                    <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04)_0%,transparent_45%,rgba(0,0,0,0.25)_100%)]" />
                  </>
                )}
                <div className="relative z-[1] max-w-xl mx-auto flex flex-col items-center py-6" style={{ color: colors.coverText }}>
                  {cover.logoUrl && (
                    <img src={cover.logoUrl} alt="logo" className="mx-auto max-h-16 sm:max-h-20 object-contain mb-6 opacity-95" />
                  )}
                  <p className="text-[10px] sm:text-[11px] tracking-[0.45em] uppercase text-white/50 font-light">
                    {cover.title}
                  </p>
                  <h1 className="text-4xl sm:text-6xl md:text-7xl font-bold tracking-[0.1em] mt-3 sm:mt-4 text-white uppercase">
                    {cover.brand}
                  </h1>
                  <div className="w-14 sm:w-16 h-px mx-auto my-5 sm:my-7 opacity-90" style={{ backgroundColor: colors.accent }} />
                  <p className="text-xs sm:text-sm tracking-[0.35em] uppercase text-white/80 font-light">
                    {cover.collection}
                  </p>
                  {cover.category && (
                    <p className="mt-8 text-xl sm:text-2xl font-light italic text-white/85">{cover.category}</p>
                  )}
                  {cover.subtitle && (
                    <p className="mt-6 sm:mt-8 text-[9px] sm:text-[10px] tracking-[0.28em] uppercase text-white/45 max-w-md mx-auto leading-relaxed font-light">
                      {cover.subtitle}
                    </p>
                  )}
                  <p className="mt-8 sm:mt-10 text-[9px] sm:text-[10px] tracking-[0.35em] uppercase text-white/40 font-light">
                    {cover.website}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="tn-catalog-body">
            {visibleSections.map(({ section, products, included }) => {
              const baseProdIds = section.products.map((p) => p.id);
              return (
                <section key={section.id} className={`tn-section ${editMode && !included ? 'opacity-50' : ''}`}>
                  {/* Divisor de sección */}
                  <div className="relative mb-0">
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
                      <div className="tn-section-head text-center py-14 md:py-20 bg-[#faf8f5] flex items-center justify-center">
                        <div>
                          <p className="text-[9px] uppercase tracking-[0.4em] mb-4 font-light" style={{ color: colors.accent }}>
                            Colección
                          </p>
                          <h2
                            className="text-3xl md:text-4xl font-light uppercase tracking-[0.35em]"
                            style={{ fontFamily: headingStack, color: colors.heading }}
                          >
                            {config.sections[section.id]?.name || section.name}
                          </h2>
                          <div className="w-12 h-px mx-auto mt-6 opacity-60" style={{ backgroundColor: colors.accent }} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Productos */}
                  <div className="tn-products-list space-y-6 md:space-y-8">
                    {products.map((p, i) => {
                      const dp = mergeProduct(p, config.products[p.id]);
                      return (
                        <ProductDisplay
                          key={`${section.id}-${p.id}`}
                          product={dp}
                          flip={i % 2 === 1}
                          showPrice={effectiveShowPrice}
                          editMode={isAdmin && editMode}
                          headingFont={headingStack}
                          bodyFont={bodyStack}
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

          <div
            className="tn-catalog-footer text-center text-[9px] py-4 px-6 tracking-[0.3em] uppercase font-light"
            style={{ backgroundColor: colors.coverBg, color: colors.coverText }}
          >
            <span className="opacity-50">
              {cover.brand} · {cover.website}
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
      {isAdmin && editingProduct && (
        <ProductEditorModal
          product={editingProduct.product}
          override={config.products[editingProduct.product.id]}
          onSave={(ov) => setProductOverride(editingProduct.product.id, ov)}
          onClose={() => setEditingProduct(null)}
        />
      )}
      {isAdmin && editingCover && (
        <CoverEditorModal
          cover={cover}
          onSave={(c) => setConfig((prev) => ({ ...prev, cover: c }))}
          onClose={() => setEditingCover(false)}
        />
      )}
      {isAdmin && editingTypography && (
        <TypographyModal
          fontHeading={config.fontHeading}
          fontBody={config.fontBody}
          onSave={(heading, body) => setConfig((prev) => ({ ...prev, fontHeading: heading, fontBody: body }))}
          onClose={() => setEditingTypography(false)}
        />
      )}
      {isAdmin && editingColors && (
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
