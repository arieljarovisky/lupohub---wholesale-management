/**
 * `orders.total` y `price_at_moment` = neto gravado (sin IVA).
 * El total de la factura AFIP = neto × 1,21 + percepción IIBB (una sola vez).
 *
 * Si en algún cliente los precios de lista ya incluyen IVA en el pedido:
 * ORDER_PRICES_INCLUDE_IVA=1 (solo afecta cartera/saldo, no la pantalla Facturación).
 */
export const ORDER_PRICES_INCLUDE_IVA =
  process.env.ORDER_PRICES_INCLUDE_IVA === '1' ||
  process.env.ORDER_PRICES_INCLUDE_IVA === 'true';

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

/** SQL: cargo en cartera desde líneas del pedido. */
export function sqlAmountWithIvaFromOrderLines(netoGravadoExpr: string): string {
  if (ORDER_PRICES_INCLUDE_IVA) {
    return `ROUND((${netoGravadoExpr}), 2)`;
  }
  return `ROUND((${netoGravadoExpr}) * ${IVA_MULTIPLIER}, 2)`;
}

/** SQL: NC — amount_credited es neto AFIP. */
export function sqlNetoAfipToAmountWithIva(netoExpr: string): string {
  return `ROUND((${netoExpr}) * ${IVA_MULTIPLIER}, 2)`;
}

/** SQL: importe total de factura AFIP (neto del pedido + IVA 21% + IIBB). */
export function sqlInvoiceAmountFromOrderTotal(): string {
  return `ROUND(COALESCE(o.total, 0) * ${IVA_MULTIPLIER} + COALESCE(i.agip_ret_per, 0), 2)`;
}

/** SQL: neto del pedido + IVA (sin IIBB). */
export function sqlOrderTotalWithIvaExpr(): string {
  return `ROUND(COALESCE(o.total, 0) * ${IVA_MULTIPLIER}, 2)`;
}

/** Importe de factura para historial / listados (siempre neto + IVA + IIBB). */
export function invoiceLedgerImporte(orderTotal: number, agipRetPer = 0): number {
  const neto = Math.round((Number(orderTotal) || 0) * 100) / 100;
  const agip = Math.round((Number(agipRetPer) || 0) * 100) / 100;
  return Math.round((neto * IVA_MULTIPLIER + agip) * 100) / 100;
}

/** NC: amount_credited es neto AFIP. */
export function ncLedgerImporte(amountCreditedNeto: number): number {
  return Math.round((Number(amountCreditedNeto) || 0) * IVA_MULTIPLIER * 100) / 100;
}

/** ND: amount_debited es neto AFIP; agip_ret_per es percepción informada en AFIP. */
export function ndLedgerImporte(amountDebitedNeto: number, agipRetPer = 0): number {
  const neto = Math.round((Number(amountDebitedNeto) || 0) * 100) / 100;
  const agip = Math.round((Number(agipRetPer) || 0) * 100) / 100;
  return Math.round((neto * IVA_MULTIPLIER + agip) * 100) / 100;
}
