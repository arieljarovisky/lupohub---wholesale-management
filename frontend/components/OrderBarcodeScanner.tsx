import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { Camera, Loader2, ScanLine, X } from 'lucide-react';
import { api } from '../services/api';

export type BarcodeLookup = Awaited<ReturnType<typeof api.getVariantByBarcode>>;

type Props = {
  open: boolean;
  priceListId?: string | null;
  onClose: () => void;
  /** Suma la unidad al pedido y devuelve el texto para mostrar. */
  onFound: (hit: BarcodeLookup) => string;
};

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

const OrderBarcodeScanner: React.FC<Props> = ({ open, priceListId, onClose, onFound }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopScanRef = useRef<(() => void) | null>(null);
  const busyRef = useRef(false);
  const onFoundRef = useRef(onFound);
  const priceListRef = useRef(priceListId);
  const lastHit = useRef<{ code: string; at: number; source: 'cam' | 'gun' } | null>(null);
  onFoundRef.current = onFound;
  priceListRef.current = priceListId;

  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [status, setStatus] = useState('');
  const [statusOk, setStatusOk] = useState(true);
  const [looking, setLooking] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);

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
      setRecent([]);
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
          if (text.length < 8 || busyRef.current) return;
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
    const code = raw.replace(/\D/g, '');
    if (!/^\d{8}$|^\d{12,14}$/.test(code) || busyRef.current) return;
    const prev = lastHit.current;
    const cooldown = source === 'cam' ? 1100 : 280;
    if (prev && prev.code === code && Date.now() - prev.at < cooldown) return;
    lastHit.current = { code, at: Date.now(), source };
    busyRef.current = true;
    setLooking(true);
    if (inputRef.current) inputRef.current.value = '';
    try {
      const hit = await api.getVariantByBarcode(code, priceListRef.current);
      const message = onFoundRef.current(hit);
      setStatusOk(true);
      setStatus(message);
      setRecent((list) => [message, ...list.filter((row) => row !== message)].slice(0, 8));
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
          aria-label="Cerrar escáner"
        >
          <X size={22} />
        </button>
        <div className="min-w-0">
          <h2 className="font-bold text-white text-xl flex items-center gap-2">
            <ScanLine size={20} className="text-emerald-400" />
            Escanear para el pedido
          </h2>
          <p className="text-xs text-slate-400">Cada lectura suma 1 unidad de esa variante.</p>
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
        inputMode="numeric"
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

      {recent.length > 0 && (
        <ul className="mt-3 flex-1 min-h-0 overflow-y-auto space-y-1">
          {recent.map((line, i) => (
            <li key={`${line}-${i}`} className="text-xs text-slate-300 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default OrderBarcodeScanner;
