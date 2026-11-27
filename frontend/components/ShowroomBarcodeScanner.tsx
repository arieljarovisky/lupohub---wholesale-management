import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { Camera, Loader2, ScanLine, X, Package } from 'lucide-react';
import { ShowroomPriceItem } from '../services/api';

type Props = {
  open: boolean;
  items: ShowroomPriceItem[];
  onClose: () => void;
};

function normalizeCode(value: string): string {
  return value.toLowerCase().replace(/[\s-]/g, '');
}

function findByBarcode(items: ShowroomPriceItem[], code: string): ShowroomPriceItem | null {
  const normalized = code.replace(/\D/g, '');
  if (!normalized) return null;
  for (const item of items) {
    if (item.barcode && item.barcode.replace(/\D/g, '') === normalized) return item;
    const haystack = normalizeCode(item.searchText || '');
    if (haystack.includes(normalizeCode(normalized))) return item;
  }
  return null;
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
  if (min == null || !Number.isFinite(min)) return '—';
  if (max == null || !Number.isFinite(max) || Math.abs(max - min) < 0.009) return formatMoney(min);
  return `${formatMoney(min)} – ${formatMoney(max)}`;
}

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

const ProductResult: React.FC<{ item: ShowroomPriceItem }> = ({ item }) => (
  <div className="rounded-2xl border border-emerald-800/60 bg-emerald-950/40 p-4">
    <div className="flex items-start gap-3">
      <div className="w-16 h-16 shrink-0 rounded-xl bg-slate-800 border border-slate-700 overflow-hidden flex items-center justify-center">
        {item.image ? (
          <img src={item.image} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <Package size={24} className="text-slate-500" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-lg font-bold text-white tracking-wide">{item.articleCode || 'Sin código'}</p>
        <p className="text-sm text-slate-200 truncate">{item.name}</p>
        {item.brand && <p className="text-xs text-slate-400">{item.brand}</p>}
        {item.barcode && <p className="text-xs text-slate-500 font-mono">EAN {item.barcode}</p>}
      </div>
    </div>
    <div className="mt-4 grid grid-cols-2 gap-3">
      <div className="rounded-xl bg-emerald-900/40 border border-emerald-700/50 px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/80">Transferencia</p>
        <p className="text-2xl font-black tabular-nums text-emerald-300 leading-tight">
          {formatPriceSpan(item.priceTransfer, item.priceTransferMax)}
        </p>
      </div>
      <div className="rounded-xl bg-sky-900/40 border border-sky-700/50 px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-sky-300/80">Tarjeta</p>
        <p className="text-2xl font-black tabular-nums text-sky-300 leading-tight">
          {formatPriceSpan(item.priceCard, item.priceCardMax)}
        </p>
      </div>
    </div>
    {item.compareAtPrice != null && (
      <p className="mt-2 text-sm text-slate-400 line-through tabular-nums text-center">
        Antes {formatMoney(item.compareAtPrice)}
      </p>
    )}
  </div>
);

const ShowroomBarcodeScanner: React.FC<Props> = ({ open, items, onClose }) => {
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
  const [foundItem, setFoundItem] = useState<ShowroomPriceItem | null>(null);
  const [recent, setRecent] = useState<ShowroomPriceItem[]>([]);

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
      setFoundItem(null);
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
    
    const item = findByBarcode(items, code);
    if (item) {
      setFoundItem(item);
      setStatusOk(true);
      setStatus(`${item.articleCode} · ${item.name}`);
      setRecent((list) => [item, ...list.filter((r) => r.id !== item.id)].slice(0, 8));
      beep(true);
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30);
    } else {
      setFoundItem(null);
      setStatusOk(false);
      setStatus(`No encontré ningún producto con el código ${code}`);
      beep(false);
    }
    
    busyRef.current = false;
    setLooking(false);
    window.setTimeout(() => inputRef.current?.focus(), 30);
  };

  const submitField = () => {
    const value = inputRef.current?.value || '';
    if (!value.trim()) return;
    void lookup(value, 'gun');
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] bg-slate-950/95 backdrop-blur-sm flex flex-col pt-[env(safe-area-inset-top)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] overflow-y-auto"
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
            Consultar precio
          </h2>
          <p className="text-xs text-slate-400">Escaneá el código de barras para ver el precio.</p>
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden border border-slate-700 bg-black relative min-h-[180px] max-h-[32vh] aspect-[4/3] sm:aspect-video">
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
      <p className="mt-1 text-[11px] text-slate-500">
        La pistolita escribe el EAN y manda Enter. El cursor tiene que estar en este campo.
      </p>

      <div
        className={`mt-3 rounded-xl border px-3 py-2.5 text-sm min-h-[44px] flex items-center gap-2 ${
          !status
            ? 'border-slate-800 text-slate-500'
            : statusOk
            ? 'border-emerald-800/60 bg-emerald-950/40 text-emerald-200'
            : 'border-red-900/50 bg-red-950/30 text-red-200'
        }`}
      >
        {looking && <Loader2 size={16} className="animate-spin shrink-0" />}
        <span>{status || 'Esperando un código…'}</span>
      </div>

      {foundItem && (
        <div className="mt-4">
          <ProductResult item={foundItem} />
        </div>
      )}

      {recent.length > 1 && (
        <div className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Consultas recientes</p>
          <ul className="space-y-2">
            {recent.slice(1).map((item) => (
              <li
                key={item.id}
                className="text-sm text-slate-300 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 flex items-center gap-3 cursor-pointer hover:bg-slate-800/60"
                onClick={() => setFoundItem(item)}
              >
                <div className="w-10 h-10 shrink-0 rounded-lg bg-slate-800 border border-slate-700 overflow-hidden flex items-center justify-center">
                  {item.image ? (
                    <img src={item.image} alt="" className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <Package size={16} className="text-slate-500" aria-hidden />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-mono font-bold text-white">{item.articleCode}</p>
                  <p className="text-xs text-slate-400 truncate">{item.name}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-emerald-300 tabular-nums">{formatMoney(item.priceTransfer)}</p>
                  <p className="text-xs text-sky-300 tabular-nums">{formatMoney(item.priceCard)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default ShowroomBarcodeScanner;
