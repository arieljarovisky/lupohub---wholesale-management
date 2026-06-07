import { getBaseUrl } from '../services/httpClient';

/** Convierte rutas relativas de catalog-images a URL absoluta del API. */
export function resolveCatalogImageSrc(src: string | undefined | null): string {
  if (!src) return '';
  const s = src.trim();
  if (!s) return '';
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  if (s.startsWith('/catalog-images/') || s.startsWith('catalog-images/')) {
    const base = getBaseUrl().replace(/\/$/, '');
    const path = s.startsWith('/') ? s : `/${s}`;
    return `${base}${path}`;
  }
  return s;
}

function isTnCdnUrl(url: string): boolean {
  return /tiendanube|nuvemshop|cdn/i.test(url);
}

function isCurrentApiUrl(url: string): boolean {
  try {
    const base = new URL(getBaseUrl());
    const u = new URL(url);
    return u.origin === base.origin;
  } catch {
    return false;
  }
}

/** Prioriza overrides válidos; si son rutas rotas o de otro entorno, usa las de Tienda Nube. */
export function pickCatalogProductImages(tnImages: string[], overrideImages?: string[]): string[] {
  const tn = tnImages.map(resolveCatalogImageSrc).filter(Boolean);
  if (!overrideImages?.length) return tn;
  const resolved = overrideImages.map(resolveCatalogImageSrc).filter(Boolean);
  const usable = resolved.filter((u) => isTnCdnUrl(u) || isCurrentApiUrl(u));
  if (usable.length > 0) return usable;
  return tn.length > 0 ? tn : resolved;
}

export function colorVariantDisplaySrc(cv: { image?: string; sourceImage?: string }): string {
  const custom = resolveCatalogImageSrc(cv.image);
  const source = resolveCatalogImageSrc(cv.sourceImage);
  if (custom && (isTnCdnUrl(custom) || isCurrentApiUrl(custom))) return custom;
  if (source) return source;
  return custom;
}
