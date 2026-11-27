import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { Camera, Loader2, ScanLine, X, Package, ExternalLink, RefreshCw } from 'lucide-react';
import { api, ShowroomPriceItem } from '../services/api';

function beep(ok: boolean) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = ok ? 880 : 220;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = 0.06;
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.07 : 0.18));
    osc.onended = () => ctx.close().catch(() => undefined);
  } catch {
    /* el navegador puede bloquear el audio hasta un gesto */
  }
}

function formatMoney(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const whole = Math.abs(value - Math.round(value)) < 0.001;
  return value.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
}

function formatPriceSpan(min: number | null, max?: number | null): string {
  if (min == null || !Number.isFinite(min)) return '$ 0';
  if (max == null || !Number.isFinite(max) || Math.abs(max - min) < 0.009) return formatMoney(min);
  return `${formatMoney(min)} – ${formatMoney(max)}`;
}

function stockLabel(stock: number | null): string {
  if (stock == null) return '';
  if (stock <= 0) return 'Sin stock';
  return `Stock: ${stock}`;
}

type Props = {
  open: boolean;
  onClose: () => void;
};

const ShowroomPriceLookup: React.FC<Props> = ({ open, onClose }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopScanRef = useRef<(() => void) | null>(null);
  const busyRef = useRef(false);
  const lastHit = useRef<{ code: string; at: number; source: 'cam' | 'gun' } | null>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [status, setStatus] = useState('');
  const [statusOk, setStatusOk] = useState(true);
  const [looking, setLooking] = useState(false);
  const [result, setResult] = useState<ShowroomPriceItem | null>(null);

  const stopCamera = () => {
    stopScanRef.current?.();
    stopScanRef.current = null;
    const video = videoRef.current;
    const stream = video?.srcObject;
    if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
    if (video) video.srcObject = null;
    setCameraOn(false);
  };

  useEffect(() => {
    if (!open) {
      stopCamera();
      setStatus('');
      setResult(null);
      setCameraError('');
      return;
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    return () => {
      stopScanRef.current?.();
      const video = videoRef.current;
      const stream = video?.srcObject;
      if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!open || !cameraOn) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    setCameraError('');

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
    ]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 180 });

    reader
      .decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        video,
        (scanResult) => {
          const text = scanResult?.getText?.()?.trim() || '';
          if (text.length < 4 || busyRef.current) return;
          void lookup(text, 'cam');
        }
      )
      .then((controls) => {
        if (cancelled) {
          controls.stop();
          return;
        }
        stopScanRef.current = () => controls.stop();
      })
      .catch(() => {
        if (cancelled) return;
        setCameraOn(false);
        setCameraError('No se pudo abrir la cámara. Permití el acceso o usá la pistolita en el campo de abajo.');
      });

    return () => {
      cancelled = true;
      stopScanRef.current?.();
      stopScanRef.current = null;
    };
  }, [open, cameraOn]);

  const lookup = async (raw: string, source: 'cam' | 'gun') => {
    const code = raw.trim();
    if (!code || code.length < 4 || busyRef.current) return;
    const prev = lastHit.current;
    const cooldown = source === 'cam' ? 1100 : 280;
    if (prev && prev.code === code && Date.now() - prev.at < cooldown) return;
    lastHit.current = { code, at: Date.now(), source };
    busyRef.current = true;
    setLooking(true);
    setResult(null);
    if (inputRef.current) inputRef.current.value = '';
    try {
      const item = await api.lookupShowroomPriceByCode(code);
      setResult(item);
      setStatusOk(true);
      setStatus(`${item.articleCode} · ${item.name}`);
      beep(true);
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30);
    } catch (e: any) {
      const message = e?.message || 'No pude leer ese código.';
      setStatusOk(false);
      setStatus(message);
      beep(false);
    } finally {
      busyRef.current = false;
      setLooking(false);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  };

  const submitField = () => {
    const value = inputRef.current?.value || '';
    if (!value.trim()) return;
    void lookup(value, 'gun');
  };

  const clearResult = () => {
    setResult(null);
    setStatus('');
    inputRef.current?.focus();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] bg-slate-950/95 backdrop-blur-sm flex flex-col pt-[env(safe-area-inset-top)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      onPointerDown={(e) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest('button, input, video, a')) return;
        inputRef.current?.focus();
      }}
    >
      <div className="shrink-0 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 w-11 h-11 flex items-center justify-center rounded-xl bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition touch-manipulation"
          aria-label="Cerrar"
        >
          <X size={22} />
        </button>
        <div className="min-w-0">
          <h2 className="font-bold text-white text-xl flex items-center gap-2">
            <ScanLine size={20} className="text-emerald-400" />
            Consultar precio
          </h2>
          <p className="text-xs text-slate-400">Escaneá el código de barras para ver el precio.</p>
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden border border-slate-700 bg-black relative min-h-[180px] max-h-[42vh] aspect-[4/3] sm:aspect-video">
        <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
        {!cameraOn && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-slate-300">La cámara queda apagada hasta que la actives.</p>
            <button
              type="button"
              onClick={() => setCameraOn(true)}
              className="h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm inline-flex items-center gap-2 touch-manipulation"
            >
              <Camera size={18} />
              Activar cámara
            </button>
          </div>
        )}
        {cameraOn && (
          <button
            type="button"
            onClick={stopCamera}
            className="absolute top-3 right-3 h-9 px-3 rounded-lg bg-black/60 text-white text-xs font-semibold"
          >
            Apagar
          </button>
        )}
      </div>
      {cameraError && <p className="mt-2 text-sm text-amber-300">{cameraError}</p>}

      <label className="mt-4 block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
        Pistolita o código a mano
      </label>
      <input
        ref={inputRef}
        type="text"
        inputMode="text"
        autoComplete="off"
        placeholder="Apuntá la pistolita acá y dispará"
        className="mt-1 w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-white font-mono text-lg outline-none focus:border-emerald-500"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Tab') {
            if ((inputRef.current?.value || '').trim()) {
              e.preventDefault();
              submitField();
            }
          }
        }}
      />
      <p className="mt-1 text-[11px] text-slate-500">La pistolita escribe el EAN y manda Enter. El cursor tiene que estar en este campo.</p>

      <div className={`mt-3 rounded-xl border px-3 py-2.5 text-sm min-h-[44px] flex items-center gap-2 ${
        !status ? 'border-slate-800 text-slate-500' : statusOk ? 'border-emerald-800/60 bg-emerald-950/40 text-emerald-200' : 'border-red-900/50 bg-red-950/30 text-red-200'
      }`}>
        {looking && <Loader2 size={16} className="animate-spin shrink-0" />}
        <span>{status || 'Esperando un código…'}</span>
      </div>

      {result && (
        <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-900/80 p-4 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-14 h-14 shrink-0 rounded-xl bg-slate-800 border border-slate-700 overflow-hidden flex items-center justify-center">
              {result.image ? (
                <img src={result.image} alt="" className="w-full h-full object-cover" loading="lazy" />
              ) : (
                <Package size={22} className="text-slate-500" aria-hidden />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-lg font-bold text-white tracking-wide">{result.articleCode}</p>
              <p className="text-sm text-slate-200 truncate">{result.name}</p>
              <p className="text-xs text-slate-500">
                {result.barcode && <span>EAN {result.barcode}</span>}
                {result.barcode && result.stock != null && ' · '}
                {result.stock != null && (
                  <span className={result.stock === 0 ? 'text-amber-400' : ''}>{stockLabel(result.stock)}</span>
                )}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-slate-800/60 border border-emerald-800/40 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/80">Transferencia</p>
              <p className="text-2xl font-black tabular-nums text-emerald-300 leading-tight mt-1">
                {formatPriceSpan(result.priceTransfer, result.priceTransferMax)}
              </p>
            </div>
            <div className="rounded-xl bg-slate-800/60 border border-sky-800/40 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-sky-300/80">Tarjeta</p>
              <p className="text-2xl font-black tabular-nums text-sky-300 leading-tight mt-1">
                {formatPriceSpan(result.priceCard, result.priceCardMax)}
              </p>
            </div>
          </div>

          {result.compareAtPrice != null && (
            <p className="text-sm text-slate-500 text-center line-through">Antes {formatMoney(result.compareAtPrice)}</p>
          )}

          <div className="flex gap-2">
            {result.url && (
              <a
                href={result.url}
                target="_blank"
                rel="noreferrer"
                className="flex-1 h-11 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm inline-flex items-center justify-center gap-2 border border-slate-700"
              >
                <ExternalLink size={16} />
                Ver en la tienda
              </a>
            )}
            <button
              type="button"
              onClick={clearResult}
              className="flex-1 h-11 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm inline-flex items-center justify-center gap-2 border border-slate-700"
            >
              <RefreshCw size={16} />
              Buscar otro
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShowroomPriceLookup;
