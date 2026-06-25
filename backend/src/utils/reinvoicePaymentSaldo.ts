import { IVA_MULTIPLIER } from '../config/orderPricing';

export type SupersededReinvoiceCreditNote = {
  order_id: string;
  amount_credited: number;
};

function ncAmountWithIva(amountCreditedNeto: number): number {
  return Math.round((Number(amountCreditedNeto) || 0) * IVA_MULTIPLIER * 100) / 100;
}

/** Recibo del cargo anterior a reemisión IIBB: visible pero no modifica saldo corrido. */
export function paymentCoversSupersededReinvoiceCargo(
  paymentAmount: number,
  linkedOrderIds: string[],
  supersededCreditNotes: SupersededReinvoiceCreditNote[],
  unallocated: boolean
): boolean {
  const amount = Math.round(Math.abs(Number(paymentAmount) || 0) * 100) / 100;
  const orders = new Set(linkedOrderIds.map((id) => String(id || '').trim()).filter(Boolean));
  for (const cn of supersededCreditNotes) {
    const ncAmount = ncAmountWithIva(Number(cn.amount_credited || 0));
    if (Math.abs(amount - ncAmount) > 0.005) continue;
    const orderId = String(cn.order_id || '').trim();
    if (!orderId) continue;
    if (orders.has(orderId)) return true;
    if (unallocated && orders.size === 0) return true;
  }
  return false;
}
