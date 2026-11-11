import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { Camera, Loader2, Printer, ScanLine, Search } from 'lucide-react';
import { MercadoLibreLogo } from './ChannelLogos';
import { api } from '../services/api';

type ScanResult = Awaited<ReturnType<typeof api.scanMercadoLibreLabel>>;

const ORDER_STATUS: Record<string, string> = {
  paid: 'Pagada',
  confirmed: 'Confirmada',
  cancelled: 'Cancelada',
  pending: 'Pendiente',
  partially_paid: 'Pago parcial',
};

const SHIP_STATUS: Record<string, string> = {
  delivered: 'Entregado',
  shipped: 'En camino',
  ready_to_ship: 'Listo para enviar',
  pending: 'Pendiente',
  handling: 'En preparación',
  to_be_agreed: 'A coordinar',
  not_delivered: 'No entregado',
  cancelled: 'Cancelado',
};

const SUBSTATUS: Record<string, string> = {
  printed: 'Etiqueta impresa',
  ready_to_print: 'Lista para imprimir',
  in_hub: 'En el centro de distribución',
  soon_deliver: 'Pronto a entregar',
  waiting_for_withdrawal: 'Espera retiro',
  picked_up: 'Retirado',
  authorized_by_carrier: 'Autorizado por el correo',
};

function labelOf(map: Record<string, string>, value: string | null | undefined): string {
  if (!value) return '';
  return map[value] || value.replace(/_/g, ' ');
}

function money(value: number, currency: string) {
  const formatted = value.toLocaleString('es-AR', { minimumFractionDigits: 2 });
  return currency === 'ARS' ? `$ ${formatted}` : `${currency} ${formatted}`;
}

function sheetCodeFrom(result: ScanResult): string {
  const scanned = result.scannedCode.replace(/\s+/g, '').toUpperCase();
  if (/^[A-Z0-9]{20,32}$/.test(scanned) && /[A-Z]/.test(scanned) && /\d/.test(scanned)) return scanned;
  return result.identificationCode || '';
}

const MercadoLibreLabelScan: React.FC = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const burstStart = useRef(0);
  const busyRef = useRef(false);
  const scanTimer = useRef<number | null>(null);
  const labelUrlRef = useRef<string | null>(null);
  const lookupRef = useRef<(raw: string) => void>(() => undefined);
  const stopScanRef = useRef<(() => void) | null>(null);

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [labelUrl, setLabelUrl] = useState<string | null>(null);
  const [labelError, setLabelError] = useState('');
  const [labelLoading, setLabelLoading] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [cameraError, setCameraError] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [recent, setRecent] = useState<Array<{ code: string; title: string }>>([]);

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
    return () => {
      stopScanRef.current?.();
      if (scanTimer.current) window.clearTimeout(scanTimer.current);
      if (labelUrlRef.current) URL.revokeObjectURL(labelUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (!cameraOn) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    setCameraError('');

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.CODE_128,
      BarcodeFormat.QR_CODE,
      BarcodeFormat.PDF_417,
      BarcodeFormat.CODE_39,
      BarcodeFormat.ITF,
      BarcodeFormat.EAN_13,
      BarcodeFormat.DATA_MATRIX,
    ]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 200 });

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
        (scanResult, _scanError, controls) => {
          if (!stopScanRef.current) stopScanRef.current = () => controls.stop();
          const text = scanResult?.getText?.()?.trim() || '';
          if (text.length < 6 || busyRef.current) return;
          controls.stop();
          stopScanRef.current = null;
          setCameraOn(false);
          lookupRef.current(text);
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
        setCameraError('No se pudo abrir la cámara. Permití el acceso del navegador, o ingresá el código a mano.');
        setManualOpen(true);
      });

    return () => {
      cancelled = true;
      stopScanRef.current?.();
      stopScanRef.current = null;
    };
  }, [cameraOn]);

  const remember = (scanned: string, title: string) => {
    setRecent((prev) => [{ code: scanned, title }, ...prev.filter((row) => row.code !== scanned)].slice(0, 8));
  };

  const scanAgain = () => {
    setResult(null);
    setError('');
    setLabelError('');
    setCode('');
    setCameraOn(true);
  };

  const lookup = async (raw: string) => {
    const scanned = raw.trim();
    if (scanned.length < 6 || busyRef.current) return;
    busyRef.current = true;
    if (scanTimer.current) window.clearTimeout(scanTimer.current);
    stopCamera();
    setLoading(true);
    setCheckedItems({});
    setError('');
    setLabelError('');
    setCode('');
    try {
      const data = await api.scanMercadoLibreLabel(scanned);
      setResult(data);
      const buyerName = [data.buyer?.firstName, data.buyer?.lastName].filter(Boolean).join(' ') || data.buyer?.nickname || 'Venta';
      remember(scanned, buyerName);
      if (labelUrlRef.current) {
        URL.revokeObjectURL(labelUrlRef.current);
        labelUrlRef.current = null;
      }
      setLabelUrl(null);
      if (data.shipment?.id) {
        setLabelLoading(true);
        try {
          const blob = await api.getMercadoLibreShipmentLabelBlob(data.shipment.id);
          const url = URL.createObjectURL(blob);
          labelUrlRef.current = url;
          setLabelUrl(url);
        } catch (labelErr: any) {
          setLabelError(labelErr?.message || 'No se pudo mostrar la etiqueta.');
        } finally {
          setLabelLoading(false);
        }
      } else {
        setLabelError('Esta venta no tiene un envío con etiqueta en Mercado Libre.');
      }
    } catch (err: any) {
      setResult(null);
      setLabelUrl(null);
      setError(err?.message || 'No se pudo leer ese código.');
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  };

  lookupRef.current = lookup;

  const onCodeChange = (value: string) => {
    const now = Date.now();
    if (!code) burstStart.current = now;
    setCode(value);
    if (scanTimer.current) window.clearTimeout(scanTimer.current);
    const trimmed = value.trim();
    const burst = now - burstStart.current;
    if (trimmed.length >= 8 && burst < 150) {
      scanTimer.current = window.setTimeout(() => lookup(trimmed), 180);
    }
  };

  const printLabel = () => {
    if (!labelUrl) return;
    const opened = window.open(labelUrl, '_blank');
    if (!opened) {
      frameRef.current?.contentWindow?.focus();
      frameRef.current?.contentWindow?.print();
    }
  };

  const printSheet = () => {
    const html = sheetRef.current?.innerHTML;
    if (!html) return;
    const popup = window.open('', '_blank', 'noopener,noreferrer');
    if (!popup) return;
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><base href="${window.location.origin}/"><title>Hoja Mercado Libre</title>
      <style>
        body { margin: 24px; color: #222; font-family: Arial, Helvetica, sans-serif; }
        button { display: none; }
      </style></head><body>${html}</body></html>`);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  const buyerLine = result?.buyer
    ? [result.buyer.firstName, result.buyer.lastName].filter(Boolean).join(' ') || result.buyer.nickname
    : '';
  const units = (result?.orders || []).reduce(
    (sum, order) => sum + order.items.reduce((acc, item) => acc + (Number(item.quantity) || 0), 0),
    0
  );
  const receiver = result?.shipment?.receiver;
  const address = receiver
    ? [receiver.street, receiver.city, receiver.state, receiver.zip].filter(Boolean).join(', ')
    : '';

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <MercadoLibreLogo size={52} />
        <div>
          <h2 className="text-2xl font-black text-white">Escanear etiqueta</h2>
          <p className="text-slate-400 text-sm">Apuntá la cámara al código de barras de la etiqueta. Después ves el PDF y el detalle de la venta.</p>
        </div>
      </div>

      {cameraOn && (
        <div className="relative overflow-hidden rounded-2xl border border-yellow-500/40 bg-black">
          <video ref={videoRef} muted playsInline autoPlay className="w-full h-[min(70vh,520px)] object-cover" />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="w-[78%] max-w-md h-28 border-2 border-yellow-400 rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
          <p className="absolute bottom-3 left-0 right-0 text-center text-sm font-bold text-white drop-shadow">
            Encuadrá el código de barras de la etiqueta
          </p>
        </div>
      )}

      {loading && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-yellow-100 text-sm flex items-center gap-2">
          <Loader2 size={16} className="animate-spin" /> Buscando la venta de ese código…
        </div>
      )}

      {cameraError && <p className="text-sm text-amber-300">{cameraError}</p>}

      {!cameraOn && !loading && (
        <button
          type="button"
          onClick={scanAgain}
          className="inline-flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black px-4 py-3 rounded-xl"
        >
          <Camera size={18} />
          {result ? 'Escanear otra con la cámara' : 'Abrir la cámara'}
        </button>
      )}

      <div className="bg-slate-900/70 border border-slate-700 rounded-2xl p-4">
        <button
          type="button"
          onClick={() => setManualOpen((open) => !open)}
          className="text-sm font-bold text-slate-300"
        >
          {manualOpen ? 'Ocultar ingreso manual' : 'Si la cámara no lee, ingresá el código a mano'}
        </button>
        {manualOpen && (
          <form
            className="mt-3 flex flex-col sm:flex-row gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              lookup(code);
            }}
          >
            <div className="relative flex-1">
              <ScanLine size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-yellow-400" />
              <input
                id="ml-label-code"
                ref={inputRef}
                value={code}
                autoComplete="off"
                spellCheck={false}
                placeholder="Número de envío o de venta"
                onChange={(event) => onCodeChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    lookup(code);
                  }
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-3 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:border-yellow-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading || code.trim().length < 6}
              className="inline-flex items-center justify-center gap-2 bg-slate-800 border border-slate-600 text-white font-bold px-4 py-3 rounded-xl disabled:opacity-50"
            >
              <Search size={18} />
              Buscar
            </button>
          </form>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-red-200 text-sm">{error}</div>
      )}

      {result && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-lg font-black text-white">Hoja de productos</h3>
            <button
              type="button"
              onClick={printSheet}
              className="inline-flex items-center gap-2 bg-white text-slate-950 font-bold px-3 py-2 rounded-xl"
            >
              <Printer size={16} />
              Imprimir hoja
            </button>
          </div>
          <article ref={sheetRef} className="bg-white text-neutral-800 rounded-xl overflow-hidden shadow-lg">
            <header className="flex items-start justify-between gap-4 px-5 pt-5 pb-3 text-[13px] leading-snug">
              <p>
                Despacha tus productos cuanto antes <strong>¡No te relajes!</strong> Tu comprador los está esperando.
              </p>
              <img src="/icons/mercado-libre.png" alt="Mercado Libre" className="h-10 w-10 shrink-0 object-contain" />
            </header>
            <div className="grid grid-cols-1 md:grid-cols-2 bg-neutral-400 text-white text-sm font-bold">
              <div className="px-4 py-2">Identificación</div>
              <div className="px-4 py-2">Productos</div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2">
              <div className="px-4 py-4 md:border-r border-neutral-300 space-y-1 text-sm">
                {sheetCodeFrom(result) && (
                  <p className="font-black text-base tracking-wide break-all">{sheetCodeFrom(result)}</p>
                )}
                {Array.from(new Set(result.orders.map((order) => order.packId).filter((id): id is number => !!id))).map((packId) => (
                  <p key={packId}><span className="font-bold">Pack ID:</span> {packId}</p>
                ))}
                {result.orders.map((order) => (
                  <p key={order.id}><span className="font-bold">Venta:</span> {order.id}</p>
                ))}
                {buyerLine && <p className="pt-2">{buyerLine}</p>}
              </div>
              <div>
                {result.orders.flatMap((order) =>
                  order.items.map((item, index) => {
                    const key = `${order.id}-${item.id}-${index}`;
                    const checked = !!checkedItems[key];
                    return (
                      <label key={key} className="flex gap-3 px-4 py-3 border-b border-neutral-200 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setCheckedItems((prev) => ({ ...prev, [key]: !prev[key] }))}
                          className="mt-1 h-4 w-4 accent-neutral-800"
                        />
                        <span className={checked ? 'opacity-50 line-through' : ''}>
                          <span className="block font-semibold leading-snug">{item.title}</span>
                          {item.sku && <span className="block">SKU: <strong>{item.sku}</strong></span>}
                          <span className="block">Cantidad: {item.quantity}</span>
                          {item.color && <span className="block">Color: {item.color}</span>}
                          {item.size && <span className="block">Talle: {item.size}</span>}
                        </span>
                      </label>
                    );
                  })
                )}
                {units === 0 && <p className="px-4 py-3 text-sm text-neutral-500">Mercado Libre no devolvió los productos de esta venta.</p>}
              </div>
            </div>
          </article>
        </section>
      )}

      {result && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
          <section className="bg-slate-900/70 border border-slate-700 rounded-2xl p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Venta</p>
                <h3 className="text-xl font-black text-white">{buyerLine || 'Comprador sin nombre'}</h3>
                {result.buyer?.nickname && <p className="text-sm text-slate-400">{result.buyer.nickname}</p>}
              </div>
              <div className="text-right">
                <p className="text-2xl font-black text-yellow-300">{units} u.</p>
                <p className="text-sm text-slate-300">{money(result.total, result.currency)}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              {result.orders.map((order) => (
                <span key={order.id} className="rounded-full border border-slate-600 bg-slate-800 px-2.5 py-1 text-slate-200">
                  Venta {order.id} · {labelOf(ORDER_STATUS, order.status)}
                </span>
              ))}
              {result.shipment && (
                <span className="rounded-full border border-yellow-600/40 bg-yellow-500/10 px-2.5 py-1 text-yellow-100">
                  Envío {result.shipment.id} · {labelOf(SHIP_STATUS, result.shipment.status)}
                  {result.shipment.substatus ? ` · ${labelOf(SUBSTATUS, result.shipment.substatus)}` : ''}
                </span>
              )}
              {result.shipment?.logisticLabel && (
                <span className="rounded-full border border-slate-600 px-2.5 py-1 text-slate-300">{result.shipment.logisticLabel}</span>
              )}
            </div>

            {(receiver?.name || address) && (
              <div className="rounded-xl bg-slate-950/70 border border-slate-800 px-3 py-2 text-sm">
                {receiver?.name && <p className="font-bold text-white">{receiver.name}</p>}
                {address && <p className="text-slate-300">{address}</p>}
                {receiver?.comment && <p className="text-slate-500">{receiver.comment}</p>}
                {result.shipment?.trackingNumber && (
                  <p className="text-slate-400 mt-1">Tracking: {result.shipment.trackingNumber}</p>
                )}
              </div>
            )}

            <div className="space-y-2">
              {result.orders.flatMap((order) =>
                order.items.map((item, index) => (
                  <div key={`${order.id}-${item.id}-${index}`} className="flex gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                    <div className="w-12 shrink-0 text-center">
                      <p className="text-2xl font-black text-white leading-none">{item.quantity}</p>
                      <p className="text-[10px] uppercase text-slate-500">cant.</p>
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-white leading-snug">{item.title}</p>
                      <p className="text-sm text-slate-400">
                        {item.sku ? `SKU ${item.sku}` : 'Sin SKU'}
                        {item.variation ? ` · ${item.variation}` : ''}
                      </p>
                      <p className="text-xs text-slate-500">{money(item.unitPrice, order.currency)} c/u</p>
                    </div>
                  </div>
                ))
              )}
              {units === 0 && <p className="text-sm text-slate-400">Mercado Libre no devolvió los productos de esta venta.</p>}
            </div>
          </section>

          <section className="bg-slate-900/70 border border-slate-700 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Etiqueta</p>
                <h3 className="text-lg font-black text-white">PDF de Mercado Libre</h3>
              </div>
              <button
                type="button"
                onClick={printLabel}
                disabled={!labelUrl}
                className="inline-flex items-center gap-2 bg-white text-slate-950 font-bold px-3 py-2 rounded-xl disabled:opacity-40"
              >
                <Printer size={16} />
                Imprimir
              </button>
            </div>
            {labelLoading && (
              <div className="h-[520px] rounded-xl bg-slate-950 flex items-center justify-center text-slate-400 gap-2">
                <Loader2 size={18} className="animate-spin" /> Bajando la etiqueta…
              </div>
            )}
            {!labelLoading && labelUrl && (
              <iframe ref={frameRef} title="Etiqueta de Mercado Libre" src={labelUrl} className="w-full h-[680px] rounded-xl bg-white" />
            )}
            {!labelLoading && labelError && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-100 text-sm">{labelError}</div>
            )}
          </section>
        </div>
      )}

      {recent.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {recent.map((row) => (
            <button
              key={row.code}
              type="button"
              onClick={() => lookup(row.code)}
              className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 hover:text-white"
            >
              {row.title} · {row.code}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default MercadoLibreLabelScan;
