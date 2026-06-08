/** Recorte automático de miniaturas de color para catálogo (cuadrado 160px). */

import { resolveCatalogImageSrc } from './catalogImageUrl';

export const CATALOG_COLOR_THUMB_SIZE = 160;

/** Versión del algoritmo: al subir, se vuelven a recortar miniaturas pendientes. */
export const CATALOG_COLOR_CROP_ALGO = 'v3';

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export async function loadCatalogImageElement(src: string): Promise<HTMLImageElement> {
  const resolved = resolveCatalogImageSrc(src);

  if (resolved.includes('/catalog-images/')) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
      img.src = resolved;
    });
  }

  try {
    const res = await fetch(resolved, { mode: 'cors' });
    if (!res.ok) throw new Error('fetch failed');
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('No se pudo decodificar la imagen'));
      };
      img.src = objectUrl;
    });
  } catch {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('No se pudo cargar la imagen externa'));
      img.src = resolved;
    });
  }
}

interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

interface ContentBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function isNearWhite(r: number, g: number, b: number): boolean {
  return r >= 238 && g >= 238 && b >= 238;
}

function isSkinTone(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return r > 95 && g > 55 && b > 35 && r >= g && g >= b && max - min < 85 && r - b < 95;
}

/** Detecta el contenido (no fondo blanco) para encuadrar el producto. */
function detectContentBounds(img: HTMLImageElement, sampleStep = 4): ContentBounds {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = nw;
  canvas.height = nh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { x0: 0, y0: 0, x1: nw, y1: nh };

  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, nw, nh).data;

  let x0 = nw;
  let y0 = nh;
  let x1 = 0;
  let y1 = 0;

  for (let y = 0; y < nh; y += sampleStep) {
    for (let x = 0; x < nw; x += sampleStep) {
      const i = (y * nw + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (!isNearWhite(r, g, b)) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }

  if (x1 <= x0 || y1 <= y0) return { x0: 0, y0: 0, x1: nw, y1: nh };
  return { x0, y0, x1, y1 };
}

/** Tablas de talles / guías: mucho blanco y contenido ancho. */
export function isLikelyCatalogChartImage(img: HTMLImageElement): boolean {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (nw < 8 || nh < 8) return false;

  const bounds = detectContentBounds(img, 6);
  const bw = bounds.x1 - bounds.x0;
  const bh = bounds.y1 - bounds.y0;
  if (bw < nw * 0.08 || bh < nh * 0.08) return false;

  const aspect = bw / Math.max(bh, 1);
  if (aspect > 1.2 && bw > nw * 0.45) return true;

  const canvas = document.createElement('canvas');
  canvas.width = nw;
  canvas.height = nh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(bounds.x0, bounds.y0, bw, bh).data;

  let white = 0;
  let edge = 0;
  let total = 0;
  const step = 5;

  for (let y = 0; y < bh; y += step) {
    for (let x = 0; x < bw; x += step) {
      const i = (y * bw + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      total++;
      if (isNearWhite(r, g, b)) white++;
      const lum = (r + g + b) / 3;
      if (lum < 70 || lum > 225) edge++;
    }
  }

  if (total === 0) return false;
  const whiteRatio = white / total;
  const edgeRatio = edge / total;
  return whiteRatio > 0.62 && aspect > 0.85 && edgeRatio > 0.08;
}

/**
 * Elige la mejor foto de producto para un color.
 * Evita tablas de talles y prioriza fotos verticales de modelo.
 */
export async function pickBestColorSourceImage(
  candidates: string[],
  preferred?: string | null
): Promise<string> {
  const unique = [...new Set(candidates.map(resolveCatalogImageSrc).filter(Boolean))];
  if (unique.length === 0) return preferred ? resolveCatalogImageSrc(preferred) : '';

  const score = (img: HTMLImageElement): number => {
    if (isLikelyCatalogChartImage(img)) return -1000;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const bounds = detectContentBounds(img);
    const bh = bounds.y1 - bounds.y0;
    const portrait = nh / Math.max(nw, 1);
    let s = 0;
    if (portrait >= 1.05) s += 40;
    if (portrait >= 1.25) s += 20;
    if (bh / nh > 0.55) s += 15;
    return s;
  };

  const ranked: Array<{ src: string; s: number }> = [];
  for (const src of unique) {
    try {
      const img = await loadCatalogImageElement(src);
      ranked.push({ src, s: score(img) });
    } catch {
      ranked.push({ src, s: -500 });
    }
  }
  ranked.sort((a, b) => b.s - a.s);

  const preferredResolved = preferred ? resolveCatalogImageSrc(preferred) : '';
  if (preferredResolved) {
    const pref = ranked.find((r) => r.src === preferredResolved);
    if (pref && pref.s > -100) return preferredResolved;
  }

  const best = ranked.find((r) => r.s > -100);
  return best?.src || preferredResolved || ranked[0]?.src || '';
}

/** Centro ponderado hacia la prenda (menos piel, más contraste/saturación). */
function computeProductFocus(img: HTMLImageElement, sampleStep = 4): { cx: number; cy: number; weight: number } {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = nw;
  canvas.height = nh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { cx: nw / 2, cy: nh * 0.52, weight: 0 };

  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, nw, nh).data;
  const portrait = nh / nw >= 1.05;
  const yMin = portrait ? nh * 0.18 : nh * 0.05;
  const yMax = portrait ? nh * 0.92 : nh * 0.98;

  let sumX = 0;
  let sumY = 0;
  let sumW = 0;

  for (let y = 0; y < nh; y += sampleStep) {
    for (let x = 0; x < nw; x += sampleStep) {
      if (y < yMin || y > yMax) continue;
      const i = (y * nw + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (isNearWhite(r, g, b)) continue;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max - min;

      let w = 1;
      if (isSkinTone(r, g, b)) {
        w = 0.12;
      } else if (max < 85) {
        w = 3.2;
      } else if (sat > 35) {
        w = 2.4;
      } else {
        w = 0.55;
      }

      if (portrait) {
        const relY = y / nh;
        if (relY >= 0.34 && relY <= 0.62) w *= 1.8;
        else if (relY < 0.28) w *= 0.25;
      }

      sumX += x * w;
      sumY += y * w;
      sumW += w;
    }
  }

  if (sumW < 1) {
    const bounds = detectContentBounds(img);
    return {
      cx: (bounds.x0 + bounds.x1) / 2,
      cy: bounds.y0 + (bounds.y1 - bounds.y0) * 0.52,
      weight: 0,
    };
  }

  return { cx: sumX / sumW, cy: sumY / sumW, weight: sumW };
}

/** Cuadrado enfocado en la prenda (cintura/cadera en fotos verticales). */
export function computeAutoColorCropRect(img: HTMLImageElement): CropRect {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const portrait = nh / nw >= 1.05;
  const bounds = detectContentBounds(img);
  const bw = bounds.x1 - bounds.x0;
  const bh = bounds.y1 - bounds.y0;
  const focus = computeProductFocus(img);

  if (bw > nw * 0.08 && bh > nh * 0.08) {
    let side: number;
    if (portrait) {
      side = clamp(nw * 0.46, nw * 0.3, Math.min(nw * 0.72, bh * 0.58));
    } else {
      side = clamp(Math.min(bw, bh) * 0.72, Math.min(nw, nh) * 0.28, Math.min(nw, nh));
    }

    let cx = focus.cx;
    let cy = focus.cy;

    if (portrait) {
      cy = clamp(cy, nh * 0.36, nh * 0.68);
      cx = clamp(cx, bounds.x0 + side * 0.2, bounds.x1 - side * 0.2);
    }

    const sw = Math.round(side);
    const sx = clamp(Math.round(cx - sw / 2), 0, nw - sw);
    const sy = clamp(Math.round(cy - sw / 2), 0, nh - sw);
    return { sx, sy, sw, sh: sw };
  }

  const side = Math.min(nw, nh);
  return {
    sx: Math.round((nw - side) / 2),
    sy: Math.round((nh - side) / 2),
    sw: side,
    sh: side,
  };
}

export async function autoCropColorThumb(
  src: string,
  outputSize = CATALOG_COLOR_THUMB_SIZE
): Promise<Blob> {
  const img = await loadCatalogImageElement(src);
  if (isLikelyCatalogChartImage(img)) {
    throw new Error('La imagen parece una tabla de talles, no una foto de producto');
  }

  const { sx, sy, sw, sh } = computeAutoColorCropRect(img);

  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo preparar el recorte');

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outputSize, outputSize);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo generar la miniatura'))),
      'image/jpeg',
      0.92
    );
  });
}
