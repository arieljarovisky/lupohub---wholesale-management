import React, { useEffect, useState } from 'react';
import { Eye, FilePlus, Clock } from 'lucide-react';
import { api } from '../services/api';
import { useNotification } from '../context/NotificationContext';
import { formatMoneyAr } from '../utils/moneyFormat';
import {
  buildWholesaleDebitNoteHtml,
  enrichOrderItem,
  iibbProratedFromInvoiceForNc,
  orderNetoForNotaCreditoTotal,
} from '../utils/wholesaleInvoiceHtml';
import { calcTotalesDesdeNetoGravado } from '../utils/afipComprobante';
import type { Customer, DebitNote, Order, OrderItem, Product } from '../types';

function orderInvoiceApplicableAgip(order: Order): { alicuota: number; retPer: number } | null {
  if (!order.invoice) return null;
  const inv = order.invoice as Record<string, unknown>;
  const retPer = Number(inv.agipRetPer ?? inv.agip_ret_per ?? 0);
  const alicuota = Number(inv.agipAlicuota ?? inv.agip_alicuota ?? 0);
  if (retPer <= 0.005 && alicuota <= 0.005) return null;
  return { alicuota, retPer };
}

function ncCbteTipoFromFactura(cbteTipoFactura: number): 3 | 8 {
  return Number(cbteTipoFactura) === 1 ? 3 : 8;
}

function ndComprobanteTotalesAfip(
  neto: number,
  inv: Order['invoice'] | undefined,
  netoPedidoTotal: number
): { neto: number; iva: number; iibb: number; total: number; discriminaIva: boolean } {
  const n = Math.round((Number(neto) || 0) * 100) / 100;
  const factTipo = Number(
    (inv as { cbteTipo?: number; cbte_tipo?: number })?.cbteTipo ??
      (inv as { cbte_tipo?: number })?.cbte_tipo ??
      6
  );
  const pr = iibbProratedFromInvoiceForNc(inv, n, netoPedidoTotal);
  const iibb = pr ? pr.retPer : 0;
  const t = calcTotalesDesdeNetoGravado(n, ncCbteTipoFromFactura(factTipo), iibb);
  return { neto: n, iva: t.iva, iibb, total: t.total, discriminaIva: t.discriminaIva };
}

function syntheticDebitNotePreview(
  order: Order,
  netAmount: number,
  tipo: 'iibb' | 'monto' | 'total' | 'item' | 'items',
  extra?: {
    itemIndex?: number;
    itemIndexes?: number[];
    amountByItemIndex?: Record<number, number>;
    quantityByItemIndex?: Record<number, number>;
    agipRetPer?: number;
    agipAlicuota?: number;
    description?: string;
  }
): DebitNote {
  const inv = order.invoice!;
  const factTipo = Number(inv.cbteTipo ?? 6);
  const ndCbteTipo = factTipo === 1 ? 2 : 7;
  return {
    id: 'preview-nd',
    orderId: order.id,
    invoiceId: 'preview',
    cae: '— BORRADOR —',
    caeFchVto: '',
    puntoVta: inv.puntoVta ?? 1,
    cbteTipo: ndCbteTipo,
    cbteDesde: 0,
    cbteHasta: 0,
    amountDebited: Math.round(netAmount * 100) / 100,
    agipRetPer: extra?.agipRetPer,
    agipAlicuota: extra?.agipAlicuota,
    scope: tipo === 'items' ? 'item' : tipo,
    itemIndex: extra?.itemIndex,
    itemIndexes: extra?.itemIndexes,
    amountByItemIndex: extra?.amountByItemIndex,
    quantityByItemIndex: extra?.quantityByItemIndex,
    description: extra?.description,
    createdAt: new Date().toISOString(),
  };
}

function injectPreviewBanner(html: string) {
  const banner =
    '<div style="background:#422006;color:#fcd34d;padding:10px 14px;font:bold 13px Arial;text-align:center;border-bottom:2px solid #f59e0b">VISTA PREVIA — no es un comprobante fiscal válido</div>';
  return html.replace(/<body[^>]*>/i, (m) => `${m}${banner}`);
}

export interface EmitDebitNoteModalProps {
  order: Order | null;
  onClose: () => void;
  products: Product[];
  customers: Customer[];
  remitente: Record<string, unknown>;
  customerLabel?: string;
  /** Tipo inicial al abrir el modal. */
  defaultTipo?: 'iibb' | 'monto' | 'total' | 'item' | 'items';
  onEmitted?: (orderId: string) => void;
}

const EmitDebitNoteModal: React.FC<EmitDebitNoteModalProps> = ({
  order: ndOrder,
  onClose,
  products,
  customers,
  remitente,
  customerLabel,
  defaultTipo = 'monto',
  onEmitted,
}) => {
  const { showToast } = useNotification();
  const [ndTipo, setNdTipo] = useState<'iibb' | 'monto' | 'total' | 'item' | 'items'>(defaultTipo);
  const [ndMontoNeto, setNdMontoNeto] = useState('');
  const [ndDescription, setNdDescription] = useState('');
  const [ndItemIndex, setNdItemIndex] = useState(0);
  const [ndQuantity, setNdQuantity] = useState(1);
  const [ndItemsQuantities, setNdItemsQuantities] = useState<Record<number, number>>({});
  const [emitiendoND, setEmitiendoND] = useState(false);

  useEffect(() => {
    if (!ndOrder) return;
    setNdTipo(defaultTipo);
    setNdMontoNeto('');
    setNdDescription('');
    setNdItemIndex(0);
    setNdQuantity(ndOrder.items[0]?.quantity ?? 1);
    setNdItemsQuantities({});
  }, [ndOrder?.id, defaultTipo]);

  if (!ndOrder) return null;

  const enrichItem = (item: OrderItem) => enrichOrderItem(item, products);
  const displayName =
    customerLabel ||
    ndOrder.customerBusinessName ||
    customers.find((c) => c.id === ndOrder.customerId)?.businessName ||
    customers.find((c) => c.id === ndOrder.customerId)?.name ||
    'Cliente';

  const buildDebitNoteHtml = (
    order: Order,
    nd: DebitNote,
    previewAgip?: { retPer: number; alicuota: number }
  ) => {
    const customer = customers.find((c) => c.id === order.customerId);
    return buildWholesaleDebitNoteHtml({
      order,
      nd,
      customer,
      products,
      remitente: remitente as never,
      previewAgip,
    });
  };

  const netoPedidoTotalNd = orderNetoForNotaCreditoTotal(ndOrder);
  const agipPreview = orderInvoiceApplicableAgip(ndOrder);
  const invAgipAfip = Number(
    (ndOrder.invoice as Record<string, unknown>)?.agipRetPer ??
      (ndOrder.invoice as Record<string, unknown>)?.agip_ret_per ??
      0
  );
  const iibbSoloNd = agipPreview && invAgipAfip <= 0.005 ? agipPreview : null;
  const currentItem = ndOrder.items[ndItemIndex];
  const itemPrice = Number(currentItem?.priceAtMoment ?? 0);
  const maxQtyItem = itemPrice > 0 ? (currentItem?.quantity ?? 0) : 0;
  const multiCandidates = ndOrder.items.map((item, i) => {
    const price = Number(item?.priceAtMoment ?? 0);
    const qty = Number(item?.quantity ?? 0);
    return { index: i, item, price, qty, maxQty: qty };
  });
  const selectedMulti = multiCandidates
    .map((c) => ({
      ...c,
      selectedQty: Math.max(0, Math.min(c.maxQty, Number(ndItemsQuantities[c.index] || 0))),
    }))
    .filter((c) => c.selectedQty > 0);
  const netCredPreview =
    ndTipo === 'iibb'
      ? 0
      : ndTipo === 'monto'
        ? Math.round((parseFloat(ndMontoNeto.replace(',', '.')) || 0) * 100) / 100
        : ndTipo === 'total'
          ? netoPedidoTotalNd
          : ndTipo === 'item'
            ? Math.round(ndQuantity * itemPrice * 100) / 100
            : Math.round(selectedMulti.reduce((sum, c) => sum + c.selectedQty * c.price, 0) * 100) / 100;
  const previewAgipNd =
    ndTipo === 'iibb' && iibbSoloNd
      ? iibbSoloNd
      : netCredPreview > 0
        ? iibbProratedFromInvoiceForNc(ndOrder.invoice, netCredPreview, netoPedidoTotalNd)
        : null;
  const totalesNdPreview = ndComprobanteTotalesAfip(netCredPreview, ndOrder.invoice, netoPedidoTotalNd);
  const iibbAmountPreview = previewAgipNd?.retPer ?? (ndTipo === 'iibb' ? 0 : totalesNdPreview.iibb);
  const totalNdPreview =
    ndTipo === 'iibb' && iibbSoloNd
      ? Math.round(iibbSoloNd.retPer * 100) / 100
      : totalesNdPreview.total;
  const ndPreviewDisabled =
    emitiendoND ||
    (ndTipo === 'iibb'
      ? !iibbSoloNd
      : ndTipo === 'monto'
        ? !(netCredPreview > 0)
        : ndTipo === 'item'
          ? !(ndQuantity >= 1 && ndQuantity <= maxQtyItem)
          : ndTipo === 'items'
            ? selectedMulti.length === 0
            : !(netCredPreview > 0));

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={() => !emitiendoND && onClose()}
    >
      <div
        className="bg-slate-800 rounded-2xl border border-slate-700 shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-white mb-1">Emitir nota de débito</h3>
        <p className="text-sm text-slate-400 mb-4">
          Pedido #{ndOrder.id} — {displayName}
        </p>
        <div className="space-y-4 mb-6">
          <div className="flex gap-3 flex-wrap">
            {(
              [
                ['iibb', 'Percepción IIBB'],
                ['monto', 'Monto neto'],
                ['total', 'Todo el pedido'],
                ['item', 'Un artículo'],
                ['items', 'Varios artículos'],
              ] as const
            ).map(([val, label]) => (
              <label key={val} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="ndTipoBilling"
                  checked={ndTipo === val}
                  onChange={() => setNdTipo(val)}
                  className="rounded border-slate-500 text-violet-500"
                />
                <span className="text-white text-sm">{label}</span>
              </label>
            ))}
          </div>
          {ndTipo === 'iibb' && (
            <div className="text-sm text-slate-400 space-y-2">
              {iibbSoloNd ? (
                <>
                  <p>Registra en AFIP la percepción IIBB que no estaba en la factura original.</p>
                  <p className="text-white font-semibold">
                    Importe IIBB: ${formatMoneyAr(iibbSoloNd.retPer)} ({iibbSoloNd.alicuota.toFixed(2)}%)
                  </p>
                </>
              ) : (
                <p className="text-amber-400 bg-amber-900/20 rounded-lg p-3">
                  {invAgipAfip > 0.005
                    ? 'La factura ya tiene percepción IIBB en AFIP.'
                    : 'No hay percepción IIBB calculable (CUIT o padrón AGIP).'}
                </p>
              )}
            </div>
          )}
          {ndTipo === 'monto' && (
            <div className="space-y-3">
              <label className="block text-xs font-semibold text-slate-400 uppercase">Monto neto (sin IVA)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={ndMontoNeto}
                onChange={(e) => setNdMontoNeto(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-xl p-3 text-white focus:ring-2 focus:ring-violet-500 outline-none"
              />
              <label className="block text-xs font-semibold text-slate-400 uppercase">Descripción (opcional)</label>
              <input
                type="text"
                value={ndDescription}
                onChange={(e) => setNdDescription(e.target.value)}
                placeholder="Ej. Intereses, ajuste"
                className="w-full bg-slate-900 border border-slate-600 rounded-xl p-3 text-white focus:ring-2 focus:ring-violet-500 outline-none"
              />
            </div>
          )}
          {ndTipo === 'total' && (
            <p className="text-sm text-slate-400">
              Monto neto del pedido: <strong className="text-white">${formatMoneyAr(netoPedidoTotalNd)}</strong>
              {totalesNdPreview.iibb > 0.005 ? (
                <> · IIBB prorrateado ${formatMoneyAr(totalesNdPreview.iibb)}</>
              ) : null}{' '}
              → total comprobante ${formatMoneyAr(totalesNdPreview.total)}
            </p>
          )}
          {ndTipo === 'item' && ndOrder.items.length > 0 && (
            <div className="space-y-3">
              <select
                value={ndItemIndex}
                onChange={(e) => {
                  const i = parseInt(e.target.value, 10);
                  setNdItemIndex(i);
                  setNdQuantity(ndOrder.items[i]?.quantity ?? 1);
                }}
                className="w-full bg-slate-900 border border-slate-600 rounded-xl p-3 text-white"
              >
                {ndOrder.items.map((item, i) => {
                  const en = enrichItem(item);
                  const label = [en.productName ?? 'Ítem', en.sizeCode, en.colorName].filter(Boolean).join(' · ');
                  return (
                    <option key={i} value={i}>
                      {label} — {item.quantity} u
                    </option>
                  );
                })}
              </select>
              <input
                type="number"
                min={1}
                max={maxQtyItem}
                value={ndQuantity}
                onChange={(e) =>
                  setNdQuantity(Math.max(1, Math.min(maxQtyItem, parseInt(e.target.value, 10) || 1)))
                }
                className="w-full bg-slate-900 border border-slate-600 rounded-xl p-3 text-white"
              />
            </div>
          )}
          {ndTipo === 'items' && (
            <div className="max-h-48 overflow-auto space-y-2">
              {multiCandidates.map((c) => (
                <div key={c.index} className="flex items-center gap-2 rounded-lg border border-slate-700 p-2">
                  <span className="text-sm text-slate-200 flex-1">
                    Ítem {c.index + 1} (máx {c.maxQty})
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={c.maxQty}
                    value={Number(ndItemsQuantities[c.index] || 0)}
                    onChange={(e) =>
                      setNdItemsQuantities((prev) => ({
                        ...prev,
                        [c.index]: Math.max(0, Math.min(c.maxQty, parseInt(e.target.value, 10) || 0)),
                      }))
                    }
                    className="w-20 bg-slate-900 border border-slate-600 rounded-lg p-2 text-white"
                  />
                </div>
              ))}
            </div>
          )}
          {ndTipo !== 'iibb' && netCredPreview > 0 && (
            <p className="text-xs text-slate-500">
              Total estimado del comprobante:{' '}
              <strong className="text-slate-300">${formatMoneyAr(totalNdPreview)}</strong>
              {iibbAmountPreview > 0.005 ? (
                <> (incl. IIBB ${formatMoneyAr(iibbAmountPreview)})</>
              ) : null}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-3 justify-between items-center pt-2 border-t border-slate-700/80">
          <button
            type="button"
            disabled={ndPreviewDisabled}
            onClick={() => {
              if (!ndOrder.invoice || ndPreviewDisabled) return;
              let nd: DebitNote;
              if (ndTipo === 'iibb' && iibbSoloNd) {
                nd = syntheticDebitNotePreview(ndOrder, 0, 'iibb', {
                  agipRetPer: iibbSoloNd.retPer,
                  agipAlicuota: iibbSoloNd.alicuota,
                });
              } else if (ndTipo === 'monto') {
                nd = syntheticDebitNotePreview(ndOrder, netCredPreview, 'monto', {
                  description: ndDescription.trim() || undefined,
                  agipRetPer: previewAgipNd?.retPer,
                  agipAlicuota: previewAgipNd?.alicuota,
                });
              } else if (ndTipo === 'total') {
                nd = syntheticDebitNotePreview(ndOrder, netCredPreview, 'total', {
                  agipRetPer: previewAgipNd?.retPer,
                  agipAlicuota: previewAgipNd?.alicuota,
                });
              } else if (ndTipo === 'item') {
                nd = syntheticDebitNotePreview(ndOrder, netCredPreview, 'item', {
                  itemIndex: ndItemIndex,
                  agipRetPer: previewAgipNd?.retPer,
                  agipAlicuota: previewAgipNd?.alicuota,
                });
              } else {
                const amountByItemIndex: Record<number, number> = {};
                const quantityByItemIndex: Record<number, number> = {};
                const itemIndexes: number[] = [];
                for (const c of selectedMulti) {
                  itemIndexes.push(c.index);
                  amountByItemIndex[c.index] = Math.round(c.selectedQty * c.price * 100) / 100;
                  quantityByItemIndex[c.index] = c.selectedQty;
                }
                nd = syntheticDebitNotePreview(ndOrder, netCredPreview, 'items', {
                  itemIndexes,
                  amountByItemIndex,
                  quantityByItemIndex,
                  agipRetPer: previewAgipNd?.retPer,
                  agipAlicuota: previewAgipNd?.alicuota,
                });
              }
              const html = injectPreviewBanner(
                buildDebitNoteHtml(ndOrder, nd, previewAgipNd ?? undefined)
              );
              const w = window.open('', '_blank');
              if (w) {
                w.document.write(html);
                w.document.close();
              }
            }}
            className="px-4 py-2.5 rounded-xl font-semibold text-slate-200 bg-slate-700 hover:bg-slate-600 flex items-center gap-2 text-sm disabled:opacity-50"
          >
            <Eye size={18} /> Vista previa PDF (ND)
          </button>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={emitiendoND}
              className="px-4 py-2.5 rounded-xl font-semibold text-slate-400 hover:bg-slate-700"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={ndPreviewDisabled}
              onClick={async () => {
                setEmitiendoND(true);
                try {
                  const payload: Parameters<typeof api.emitirNotaDebito>[1] = { tipo: ndTipo };
                  if (ndTipo === 'monto') {
                    payload.netAmount = netCredPreview;
                    if (ndDescription.trim()) payload.description = ndDescription.trim();
                  } else if (ndTipo === 'item') {
                    payload.itemIndex = ndItemIndex;
                    payload.quantity = ndQuantity;
                  } else if (ndTipo === 'items') {
                    payload.items = selectedMulti.map((c) => ({
                      itemIndex: c.index,
                      quantity: c.selectedQty,
                    }));
                  }
                  const res = await api.emitirNotaDebito(ndOrder.id, payload);
                  showToast('success', `Nota de débito emitida. CAE ${res.cae}.`);
                  onEmitted?.(ndOrder.id);
                  onClose();
                } catch (err: unknown) {
                  const e = err as { message?: string; response?: { data?: { message?: string } } };
                  showToast(
                    'error',
                    e?.message || e?.response?.data?.message || 'Error emitiendo nota de débito'
                  );
                } finally {
                  setEmitiendoND(false);
                }
              }}
              className="px-5 py-2.5 rounded-xl font-bold bg-violet-600 hover:bg-violet-500 text-white flex items-center gap-2 disabled:opacity-50"
            >
              {emitiendoND ? <Clock size={18} className="animate-pulse" /> : <FilePlus size={18} />}
              {emitiendoND ? 'Emitiendo…' : 'Emitir nota de débito'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmitDebitNoteModal;
