"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IVA_MULTIPLIER = exports.ORDER_PRICES_INCLUDE_IVA = void 0;
exports.orderGrossToAfipNeto = orderGrossToAfipNeto;
exports.orderAfipNetoToGross = orderAfipNetoToGross;
exports.sqlAmountWithIvaFromOrderLines = sqlAmountWithIvaFromOrderLines;
exports.sqlNetoAfipToAmountWithIva = sqlNetoAfipToAmountWithIva;
exports.sqlInvoiceAmountFromOrderTotal = sqlInvoiceAmountFromOrderTotal;
exports.sqlOrderTotalWithIvaExpr = sqlOrderTotalWithIvaExpr;
exports.invoiceLedgerImporte = invoiceLedgerImporte;
exports.ncLedgerImporte = ncLedgerImporte;
exports.ndLedgerImporte = ndLedgerImporte;
/**
 * `orders.total` y `price_at_moment` = neto gravado (sin IVA).
 * El total de la factura AFIP = neto × 1,21 + percepción IIBB (una sola vez).
 *
 * Si en algún cliente los precios de lista ya incluyen IVA en el pedido:
 * ORDER_PRICES_INCLUDE_IVA=1 (solo afecta cartera/saldo, no la pantalla Facturación).
 */
exports.ORDER_PRICES_INCLUDE_IVA = process.env.ORDER_PRICES_INCLUDE_IVA === '1' ||
    process.env.ORDER_PRICES_INCLUDE_IVA === 'true';
exports.IVA_MULTIPLIER = 1.21;
function orderGrossToAfipNeto(gross) {
    const g = Math.round((Number(gross) || 0) * 100) / 100;
    if (!exports.ORDER_PRICES_INCLUDE_IVA)
        return g;
    return Math.round((g / exports.IVA_MULTIPLIER) * 100) / 100;
}
function orderAfipNetoToGross(neto) {
    const n = Math.round((Number(neto) || 0) * 100) / 100;
    if (!exports.ORDER_PRICES_INCLUDE_IVA)
        return n;
    return Math.round(n * exports.IVA_MULTIPLIER * 100) / 100;
}
/** SQL: cargo en cartera desde líneas del pedido. */
function sqlAmountWithIvaFromOrderLines(netoGravadoExpr) {
    if (exports.ORDER_PRICES_INCLUDE_IVA) {
        return `ROUND((${netoGravadoExpr}), 2)`;
    }
    return `ROUND((${netoGravadoExpr}) * ${exports.IVA_MULTIPLIER}, 2)`;
}
/** SQL: NC — amount_credited es neto AFIP. */
function sqlNetoAfipToAmountWithIva(netoExpr) {
    return `ROUND((${netoExpr}) * ${exports.IVA_MULTIPLIER}, 2)`;
}
/** SQL: importe total de factura AFIP (neto del pedido + IVA 21% + IIBB). */
function sqlInvoiceAmountFromOrderTotal() {
    return `ROUND(COALESCE(o.total, 0) * ${exports.IVA_MULTIPLIER} + COALESCE(i.agip_ret_per, 0), 2)`;
}
/** SQL: neto del pedido + IVA (sin IIBB). */
function sqlOrderTotalWithIvaExpr() {
    return `ROUND(COALESCE(o.total, 0) * ${exports.IVA_MULTIPLIER}, 2)`;
}
/** Importe de factura para historial / listados (siempre neto + IVA + IIBB). */
function invoiceLedgerImporte(orderTotal, agipRetPer = 0) {
    const neto = Math.round((Number(orderTotal) || 0) * 100) / 100;
    const agip = Math.round((Number(agipRetPer) || 0) * 100) / 100;
    return Math.round((neto * exports.IVA_MULTIPLIER + agip) * 100) / 100;
}
/** NC: amount_credited es neto AFIP. */
function ncLedgerImporte(amountCreditedNeto) {
    return Math.round((Number(amountCreditedNeto) || 0) * exports.IVA_MULTIPLIER * 100) / 100;
}
/** ND: amount_debited es neto AFIP; agip_ret_per es percepción informada en AFIP. */
function ndLedgerImporte(amountDebitedNeto, agipRetPer = 0) {
    const neto = Math.round((Number(amountDebitedNeto) || 0) * 100) / 100;
    const agip = Math.round((Number(agipRetPer) || 0) * 100) / 100;
    return Math.round((neto * exports.IVA_MULTIPLIER + agip) * 100) / 100;
}
