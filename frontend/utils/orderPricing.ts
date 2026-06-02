/** Alineado con backend/src/config/orderPricing.ts */
export const ORDER_PRICES_INCLUDE_IVA =
  (import.meta as { env?: { VITE_ORDER_PRICES_INCLUDE_IVA?: string } }).env
    ?.VITE_ORDER_PRICES_INCLUDE_IVA !== '0' &&
  (import.meta as { env?: { VITE_ORDER_PRICES_INCLUDE_IVA?: string } }).env
    ?.VITE_ORDER_PRICES_INCLUDE_IVA !== 'false';

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
