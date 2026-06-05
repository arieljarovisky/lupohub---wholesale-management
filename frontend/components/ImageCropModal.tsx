import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, X, ZoomIn, ZoomOut } from 'lucide-react';

type AspectPreset = 'free' | '4:5' | '1:1' | '3:4' | '16:9';

const ASPECT_VALUES: Record<AspectPreset, number | null> = {
  free: null,
  '4:5': 4 / 5,
  '1:1': 1,
  '3:4': 3 / 4,
  '16:9': 16 / 9,
};

async function loadImageElement(src: string): Promise<HTMLImageElement> {
  // Misma API: sin problema de CORS
  if (src.includes('/catalog-images/')) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
      img.src = src;
    });
  }

  // Externas (Tienda Nube): intentar fetch como blob
  try {
    const res = await fetch(src, { mode: 'cors' });
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
    // Fallback: crossOrigin anonymous
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(
          new Error(
            'No se puede recortar esta imagen por restricciones del servidor. Subila primero desde tu compu y recortala.'
          )
        );
      img.src = src;
    });
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

interface ImageCropModalProps {
  src: string;
  title?: string;
  defaultAspect?: AspectPreset;
  /** Oculta selector de proporción y fija el recorte (ej. miniaturas de color). */
  lockAspect?: boolean;
  /** Si se define, exporta un cuadrado de ese tamaño en px (ej. 160). */
  outputSize?: number;
  onApply: (blob: Blob) => void | Promise<void>;
  onClose: () => void;
}

const ImageCropModal: React.FC<ImageCropModalProps> = ({
  src,
  title = 'Recortar imagen',
  defaultAspect = '4:5',
  lockAspect = false,
  outputSize,
  onApply,
  onClose,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [aspect, setAspect] = useState<AspectPreset>(defaultAspect);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, px: 0, py: 0 });
  const [applying, setApplying] = useState(false);

  const VIEW_W = 360;
  const VIEW_H = 420;

  useEffect(() => {
    setLoading(true);
    setError('');
    loadImageElement(src)
      .then((el) => {
        setImg(el);
        setScale(1);
        setPos({ x: 0, y: 0 });
      })
      .catch((e) => setError(e?.message || 'Error cargando imagen'))
      .finally(() => setLoading(false));
  }, [src]);

  const aspectRatio = ASPECT_VALUES[aspect];

  const cropBox = useCallback(() => {
    const pad = 16;
    let w = VIEW_W - pad * 2;
    let h = VIEW_H - pad * 2;
    if (aspectRatio) {
      if (w / h > aspectRatio) w = h * aspectRatio;
      else h = w / aspectRatio;
    }
    return {
      w: Math.round(w),
      h: Math.round(h),
      x: Math.round((VIEW_W - w) / 2),
      y: Math.round((VIEW_H - h) / 2),
    };
  }, [aspectRatio]);

  const getBaseScale = useCallback(() => {
    if (!img) return 1;
    const box = cropBox();
    return Math.max(box.w / img.naturalWidth, box.h / img.naturalHeight);
  }, [img, cropBox]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!img) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setPos({
      x: dragStart.current.px + (e.clientX - dragStart.current.x),
      y: dragStart.current.py + (e.clientY - dragStart.current.y),
    });
  };

  const onPointerUp = () => setDragging(false);

  const applyCrop = async () => {
    if (!img) return;
    const box = cropBox();
    const base = getBaseScale() * scale;
    const dispW = img.naturalWidth * base;
    const dispH = img.naturalHeight * base;
    const imgLeft = VIEW_W / 2 - dispW / 2 + pos.x;
    const imgTop = VIEW_H / 2 - dispH / 2 + pos.y;

    const sx = clamp((box.x - imgLeft) / base, 0, img.naturalWidth);
    const sy = clamp((box.y - imgTop) / base, 0, img.naturalHeight);
    const sw = clamp(box.w / base, 1, img.naturalWidth - sx);
    const sh = clamp(box.h / base, 1, img.naturalHeight - sy);

    const outW = outputSize ? outputSize : Math.round(sw);
    const outH = outputSize ? outputSize : Math.round(sh);
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);

    setApplying(true);
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen recortada'))),
          'image/jpeg',
          0.92
        );
      });
      await onApply(blob);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Error al recortar');
    } finally {
      setApplying(false);
    }
  };

  const box = cropBox();
  const base = img ? getBaseScale() * scale : 1;
  const dispW = img ? img.naturalWidth * base : 0;
  const dispH = img ? img.naturalHeight * base : 0;

  return (
    <div className="fixed inset-0 z-[140] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-700 px-5 py-4 flex items-center justify-between">
          <h3 className="font-bold text-white text-sm">{title}</h3>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-white rounded-lg">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={32} className="animate-spin text-emerald-500" />
            </div>
          ) : error ? (
            <p className="text-red-400 text-sm text-center py-8 px-2">{error}</p>
          ) : (
            <>
              <p className="text-xs text-slate-400 text-center">
                {lockAspect
                  ? 'Arrastrá la foto del producto para encuadrar la miniatura del color.'
                  : 'Arrastrá la imagen para encuadrar. Usá zoom si necesitás.'}
              </p>
              <div
                ref={containerRef}
                className="relative mx-auto bg-slate-950 rounded-xl overflow-hidden select-none touch-none cursor-grab active:cursor-grabbing"
                style={{ width: VIEW_W, height: VIEW_H }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
              >
                {img && (
                  <img
                    src={src}
                    alt=""
                    draggable={false}
                    className="absolute pointer-events-none max-w-none"
                    style={{
                      width: dispW,
                      height: dispH,
                      left: VIEW_W / 2 - dispW / 2 + pos.x,
                      top: VIEW_H / 2 - dispH / 2 + pos.y,
                    }}
                  />
                )}
                {/* Máscara de recorte */}
                <div
                  className="absolute pointer-events-none rounded-sm"
                  style={{
                    left: box.x,
                    top: box.y,
                    width: box.w,
                    height: box.h,
                    boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
                    border: '2px solid #34d399',
                  }}
                />
              </div>

              {!lockAspect && (
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {(['free', '4:5', '1:1', '3:4', '16:9'] as AspectPreset[]).map((a) => (
                    <button
                      key={a}
                      onClick={() => setAspect(a)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                        aspect === a ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                    >
                      {a === 'free' ? 'Libre' : a}
                    </button>
                  ))}
                </div>
              )}
              {lockAspect && outputSize && (
                <p className="text-[10px] text-slate-500 text-center">
                  Formato fijo: cuadrado {outputSize}×{outputSize} px
                </p>
              )}

              <div className="flex items-center gap-3 px-1">
                <ZoomOut size={16} className="text-slate-500 shrink-0" />
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.02}
                  value={scale}
                  onChange={(e) => setScale(parseFloat(e.target.value))}
                  className="flex-1 accent-emerald-500"
                />
                <ZoomIn size={16} className="text-slate-500 shrink-0" />
              </div>
            </>
          )}
        </div>

        <div className="border-t border-slate-700 px-5 py-3 flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-700 text-sm font-semibold">
            Cancelar
          </button>
          <button
            onClick={applyCrop}
            disabled={loading || !!error || applying}
            className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold flex items-center gap-2"
          >
            {applying ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            Aplicar recorte
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImageCropModal;
