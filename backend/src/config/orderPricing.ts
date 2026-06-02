/**
 * Precios de pedido mayorista (`price_at_moment`, `orders.total`): importe con IVA 21% incluido.
 * AFIP y NC siguen usando neto gravado; las conversiones se hacen acá.
 * Para volver al modelo neto + IVA aparte: ORDER_PRICES_INCLUDE_IVA=0
 */
export const ORDER_PRICES_INCLUDE_IVA =
  process.env.ORDER_PRICES_INCLUDE_IVA !== '0' &&
  process.env.ORDER_PRICES_INCLUDE_IVA !== 'false';

export const IVA_MULTIPLIER = 1.21;

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

/** SQL: importe con IVA desde suma de líneas / total pedido (ya con IVA o neto según config). */
export function sqlAmountWithIvaFromOrderLines(netoGravadoExpr: string): string {
  if (ORDER_PRICES_INCLUDE_IVA) {
    return `ROUND((${netoGravadoExpr}), 2)`;
  }
  return `ROUND((${netoGravadoExpr}) * ${IVA_MULTIPLIER}, 2)`;
}

/** SQL: NC u otro neto AFIP → importe con IVA (amount_credited siempre es neto). */
export function sqlNetoAfipToAmountWithIva(netoExpr: string): string {
  return `ROUND((${netoExpr}) * ${IVA_MULTIPLIER}, 2)`;
}

/** SQL: importe factura desde orders.total (con o sin IVA según config). */
export function sqlInvoiceAmountFromOrderTotal(): string {
  if (ORDER_PRICES_INCLUDE_IVA) {
    return 'ROUND(COALESCE(o.total, 0) + COALESCE(i.agip_ret_per, 0), 2)';
  }
  return 'ROUND(COALESCE(o.total, 0) * 1.21 + COALESCE(i.agip_ret_per, 0), 2)';
}

/** SQL: importe factura solo desde orders.total (sin IIBB). */
export function sqlOrderTotalWithIvaExpr(): string {
  if (ORDER_PRICES_INCLUDE_IVA) {
    return 'ROUND(COALESCE(o.total, 0), 2)';
  }
  return 'ROUND(COALESCE(o.total, 0) * 1.21, 2)';
}

/** Importe con IVA para historial / ledger (orders.total con IVA incluido). */
export function invoiceLedgerImporte(orderTotal: number, agipRetPer = 0): number {
  const gross = Math.round((Number(orderTotal) || 0) * 100) / 100;
  const agip = Math.round((Number(agipRetPer) || 0) * 100) / 100;
  if (ORDER_PRICES_INCLUDE_IVA) return Math.round((gross + agip) * 100) / 100;
  return Math.round((gross * IVA_MULTIPLIER + agip) * 100) / 100;
}

/** NC: amount_credited es neto AFIP. */
export function ncLedgerImporte(amountCreditedNeto: number): number {
  return Math.round((Number(amountCreditedNeto) || 0) * IVA_MULTIPLIER * 100) / 100;
}
