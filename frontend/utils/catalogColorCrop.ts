/** Recorte automático de miniaturas de color para catálogo (cuadrado 160px). */

import { resolveCatalogImageSrc } from './catalogImageUrl';

export const CATALOG_COLOR_THUMB_SIZE = 160;

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

/** Detecta el contenido (no fondo blanco) para encuadrar el producto. */
function detectContentBounds(img: HTMLImageElement, sampleStep = 4): { x0: number; y0: number; x1: number; y1: number } {
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
      if (r < 238 || g < 238 || b < 238) {
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

/** Cuadrado enfocado en el producto (torso/cadera en fotos verticales de modelo). */
export function computeAutoColorCropRect(img: HTMLImageElement): CropRect {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const bounds = detectContentBounds(img);
  const bw = bounds.x1 - bounds.x0;
  const bh = bounds.y1 - bounds.y0;

  if (bw > nw * 0.08 && bh > nh * 0.08) {
    const padX = bw * 0.04;
    const padY = bh * 0.04;
    const x0 = bounds.x0 - padX;
    const x1 = bounds.x1 + padX;
    const isPortrait = nh / nw >= 1.15;

    const focusY0 = isPortrait ? bounds.y0 + bh * 0.2 : bounds.y0 - padY;
    const focusY1 = isPortrait ? bounds.y0 + bh * 0.9 : bounds.y1 + padY;
    const focusH = focusY1 - focusY0;
    const focusW = x1 - x0;

    let side = Math.min(focusW, focusH);
    if (isPortrait && nh / nw >= 1.3) {
      side = Math.min(side, nw * 0.95, focusH * 0.82);
    }
    side = clamp(side, Math.min(nw, nh) * 0.22, Math.min(nw, nh));

    const cx = (x0 + x1) / 2;
    const cy = (focusY0 + focusY1) / 2;
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
