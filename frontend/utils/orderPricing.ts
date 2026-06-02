/** Alineado con backend/src/config/orderPricing.ts */
export const ORDER_PRICES_INCLUDE_IVA =
  (import.meta as { env?: { VITE_ORDER_PRICES_INCLUDE_IVA?: string } }).env
    ?.VITE_ORDER_PRICES_INCLUDE_IVA === '1' ||
  (import.meta as { env?: { VITE_ORDER_PRICES_INCLUDE_IVA?: string } }).env
    ?.VITE_ORDER_PRICES_INCLUDE_IVA === 'true';

export const IVA_MULTIPLIER = 1.21;
export const IVA_RATE = 0.21;

export function orderGrossToAfipNeto(gross: number): number {
  const g = Math.round((Number(gross) || 0) * 100) / 100;
  if (!ORDER_PRICES_INCLUDE_IVA) return g;
  return Math.round((g / IVA_MULTIPLIER) * 100) / 100;
}

export function orderAfipNetoToGross(neto: number): number {
  const n = Math.round((Number(neto) || 0) * 100) / 100;
  if (!ORDER_PRICES_INCLUDE_IVA) return n;
  return Math.round(n * IVA_MULTIPLIER * 100) / 100;
}

/** Total factura AFIP desde neto gravado del pedido. */
export function invoiceTotalFromOrderNeto(orderTotal: number, agipRetPer = 0): number {
  const neto = Math.round((Number(orderTotal) || 0) * 100) / 100;
  const agip = Math.round((Number(agipRetPer) || 0) * 100) / 100;
  return Math.round((neto * IVA_MULTIPLIER + agip) * 100) / 100;
}
