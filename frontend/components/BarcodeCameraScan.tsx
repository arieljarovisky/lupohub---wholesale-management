import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { X } from 'lucide-react';

type Props = {
  open: boolean;
  onClose: () => void;
  onCode: (code: string) => void;
};

function digitsOf(raw: string): string {
  return raw.replace(/\D/g, '');
}

function looksLikeBarcode(code: string): boolean {
  return /^\d{8}$|^\d{12,14}$/.test(code);
}

const BarcodeCameraScan: React.FC<Props> = ({ open, onClose, onCode }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const doneRef = useRef(false);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    doneRef.current = false;
    setError('');

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
          if (doneRef.current || cancelled) return;
          const code = digitsOf(scanResult?.getText?.() || '');
          if (!looksLikeBarcode(code)) return;
          doneRef.current = true;
          stopRef.current?.();
          stopRef.current = null;
          onCodeRef.current(code);
        }
      )
      .then((controls) => {
        if (cancelled || doneRef.current) {
          controls.stop();
          return;
        }
        stopRef.current = () => controls.stop();
      })
      .catch(() => {
        if (cancelled) return;
        setError('No se pudo abrir la cámara. Permití el acceso del navegador.');
      });

    return () => {
      cancelled = true;
      stopRef.current?.();
      stopRef.current = null;
      const stream = video.srcObject;
      if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[130] bg-slate-950/95 flex flex-col pt-[env(safe-area-inset-top)] px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="shrink-0 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 w-11 h-11 flex items-center justify-center rounded-xl bg-slate-800 text-slate-300 hover:text-white"
          aria-label="Cerrar cámara"
        >
          <X size={22} />
        </button>
        <div>
          <h2 className="font-bold text-white text-lg">Buscar con la cámara</h2>
          <p className="text-xs text-slate-400">Apuntá al código de barras del producto.</p>
        </div>
      </div>
      <div className="rounded-2xl overflow-hidden border border-slate-700 bg-black relative aspect-[4/3] sm:aspect-video">
        <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
      </div>
      {error ? <p className="mt-3 text-sm text-amber-300">{error}</p> : <p className="mt-3 text-sm text-slate-400">Cuando lea el código, filtra el inventario.</p>}
    </div>
  );
};

export default BarcodeCameraScan;
