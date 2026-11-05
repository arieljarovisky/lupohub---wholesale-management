/**
 * `orders.total` y `price_at_moment` = neto gravado (sin IVA).
 * El total de la factura AFIP = neto × 1,21 + percepción IIBB (una sola vez).
 * Factura E (exportación, cbte_tipo 19): total = neto, sin IVA ni IIBB.
 *
 * Si en algún cliente los precios de lista ya incluyen IVA en el pedido:
 * ORDER_PRICES_INCLUDE_IVA=1 (solo afecta cartera/saldo, no la pantalla Facturación).
 */
export const ORDER_PRICES_INCLUDE_IVA =
  process.env.ORDER_PRICES_INCLUDE_IVA === '1' ||
  process.env.ORDER_PRICES_INCLUDE_IVA === 'true';

export const IVA_MULTIPLIER = 1.21;
/** AFIP WSFEX — Factura de exportación (sin IVA). */
export const CBTE_FACTURA_E = 19;
/** Nota de crédito de exportación (sin IVA ni percepción). */
export const CBTE_NC_E = 21;

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

/** SQL: importe total de factura AFIP (neto + IVA 21% + IIBB; Factura E = solo neto). Requiere alias `i` e `o`. */
export function sqlInvoiceAmountFromOrderTotal(): string {
  return `ROUND(
    CASE
      WHEN COALESCE(i.cbte_tipo, 0) = ${CBTE_FACTURA_E} THEN COALESCE(o.total, 0)
      ELSE COALESCE(o.total, 0) * ${IVA_MULTIPLIER} + COALESCE(i.agip_ret_per, 0)
    END,
  2)`;
}

/** SQL: neto del pedido + IVA (sin IIBB). Factura E no aplica; usar sqlInvoiceAmountFromOrderTotal si hay `i`. */
export function sqlOrderTotalWithIvaExpr(): string {
  return `ROUND(COALESCE(o.total, 0) * ${IVA_MULTIPLIER}, 2)`;
}

/** Importe de factura para historial / listados (neto + IVA + IIBB; E = solo neto). */
export function invoiceLedgerImporte(
  orderTotal: number,
  agipRetPer = 0,
  cbteTipo?: number
): number {
  const neto = Math.round((Number(orderTotal) || 0) * 100) / 100;
  if (Number(cbteTipo) === CBTE_FACTURA_E) return neto;
  const agip = Math.round((Number(agipRetPer) || 0) * 100) / 100;
  return Math.round((neto * IVA_MULTIPLIER + agip) * 100) / 100;
}

/** NC sin percepción: amount_credited es neto AFIP. Para saldo usar `ncLedgerImporteConPercepcion`. */
export function ncLedgerImporte(amountCreditedNeto: number): number {
  return Math.round((Number(amountCreditedNeto) || 0) * IVA_MULTIPLIER * 100) / 100;
}

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Percepción IIBB de una NC, prorrateada como al emitir en AFIP
 * (`importe = percepción factura × neto creditado / neto de la factura`).
 * La NC de reemisión no lleva percepción (solo neto + IVA).
 */
export function ncPercepcionImporte(args: {
  amountCreditedNeto: number;
  agipRetPer?: number;
  agipAlicuota?: number;
  orderTotal?: number;
  supersededByReinvoice?: boolean;
  cbteTipo?: number;
  invoiceCbteTipo?: number;
}): number {
  if (args.supersededByReinvoice) return 0;
  if (Number(args.cbteTipo) === CBTE_NC_E || Number(args.invoiceCbteTipo) === CBTE_FACTURA_E) return 0;
  const retFull = roundMoney(args.agipRetPer || 0);
  if (!(retFull > 0.005)) return 0;
  const netCred = roundMoney(args.amountCreditedNeto);
  if (!(netCred > 0.005)) return 0;
  const alic = Number(args.agipAlicuota) || 0;
  const full = alic > 0.005 ? roundMoney(retFull / (alic / 100)) : roundMoney(args.orderTotal || 0);
  if (!(full > 0.005)) return 0;
  const ratio = Math.min(1, Math.max(0, netCred / full));
  const importe = roundMoney(retFull * ratio);
  if (!(importe > 0.005)) return 0;
  return Math.min(importe, retFull);
}

/** NC en saldo / historial: neto × IVA (o solo neto si es NC E) + percepción prorrateada. */
export function ncLedgerImporteConPercepcion(
  amountCreditedNeto: number,
  args: Omit<Parameters<typeof ncPercepcionImporte>[0], 'amountCreditedNeto'>
): number {
  const neto = roundMoney(amountCreditedNeto);
  const gravado =
    Number(args.cbteTipo) === CBTE_NC_E || Number(args.invoiceCbteTipo) === CBTE_FACTURA_E
      ? neto
      : roundMoney(neto * IVA_MULTIPLIER);
  return roundMoney(gravado + ncPercepcionImporte({ ...args, amountCreditedNeto: neto }));
}

/**
 * Importe de NC en SQL de saldos. Requiere alias `cn` (credit_notes), `o` (orders)
 * y el alias de `invoices` indicado (por defecto `i`).
 * `grouped`: comprobante AFIP con varias filas (una por ítem); usa SUM/MAX.
 */
function sqlCreditNoteSaldoInner(invoiceAlias: string, grouped: boolean): { neto: string; percepcion: string; total: string } {
  const i = invoiceAlias;
  const ret = grouped ? `MAX(COALESCE(${i}.agip_ret_per, 0))` : `COALESCE(${i}.agip_ret_per, 0)`;
  const alic = grouped ? `MAX(COALESCE(${i}.agip_alicuota, 0))` : `COALESCE(${i}.agip_alicuota, 0)`;
  const total = grouped ? `MAX(COALESCE(o.total, 0))` : `COALESCE(o.total, 0)`;
  const superseded = grouped
    ? `MAX(COALESCE(cn.superseded_by_reinvoice, 0))`
    : `COALESCE(cn.superseded_by_reinvoice, 0)`;
  const cbte = grouped ? `MAX(COALESCE(cn.cbte_tipo, 0))` : `COALESCE(cn.cbte_tipo, 0)`;
  const invCbte = grouped ? `MAX(COALESCE(${i}.cbte_tipo, 0))` : `COALESCE(${i}.cbte_tipo, 0)`;
  const credited = grouped ? `SUM(COALESCE(cn.amount_credited, 0))` : `COALESCE(cn.amount_credited, 0)`;
  const base = `CASE
    WHEN ${alic} > 0.005 AND ${ret} > 0.005 THEN ROUND(${ret} / (${alic} / 100), 2)
    WHEN ${total} > 0.005 THEN ROUND(${total}, 2)
    ELSE 0
  END`;
  const percepcion = `CASE
    WHEN ${superseded} = 1 THEN 0
    WHEN ${cbte} = ${CBTE_NC_E} OR ${invCbte} = ${CBTE_FACTURA_E} THEN 0
    WHEN ${ret} <= 0.005 THEN 0
    WHEN (${base}) <= 0.005 THEN 0
    ELSE LEAST(
      ROUND(${ret}, 2),
      ROUND(${ret} * LEAST(GREATEST(${credited}, 0), (${base})) / GREATEST((${base}), 0.01), 2)
    )
  END`;
  const neto = `CASE
    WHEN ${cbte} = ${CBTE_NC_E} OR ${invCbte} = ${CBTE_FACTURA_E}
      THEN ROUND(${credited}, 2)
    ELSE ROUND(${credited} * ${IVA_MULTIPLIER}, 2)
  END`;
  return {
    neto,
    percepcion,
    total: `ROUND((${neto}) + (${percepcion}), 2)`
  };
}

/** Una fila de `credit_notes`: neto con IVA + percepción IIBB prorrateada. */
export function sqlCreditNoteSaldoAmount(invoiceAlias = 'i'): string {
  return sqlCreditNoteSaldoInner(invoiceAlias, false).total;
}

/** NC agrupada por comprobante AFIP (varias filas, un CAE). */
export function sqlGroupedCreditNoteSaldoAmount(invoiceAlias = 'i'): string {
  return sqlCreditNoteSaldoInner(invoiceAlias, true).total;
}

/** Percepción prorrateada de una NC agrupada por comprobante AFIP. */
export function sqlGroupedCreditNotePercepcion(invoiceAlias = 'i'): string {
  return sqlCreditNoteSaldoInner(invoiceAlias, true).percepcion;
}

/** ND: amount_debited es neto AFIP; agip_ret_per es percepción informada en AFIP. */
export function ndLedgerImporte(amountDebitedNeto: number, agipRetPer = 0): number {
  const neto = Math.round((Number(amountDebitedNeto) || 0) * 100) / 100;
  const agip = Math.round((Number(agipRetPer) || 0) * 100) / 100;
  return Math.round((neto * IVA_MULTIPLIER + agip) * 100) / 100;
}
