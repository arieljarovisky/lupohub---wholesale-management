/** Tipos AFIP WSFE usados en LupoHub (factura / NC). */
export const CBTE_FACTURA_A = 1;
export const CBTE_FACTURA_B = 6;
export const CBTE_NC_A = 3;
export const CBTE_NC_B = 8;

const IVA_RATE = 0.21;

/** Factura B y NC B: en el papel no se discrimina IVA (precios con IVA incluido). */
export function isComprobanteClaseB(cbteTipo: number): boolean {
  const t = Number(cbteTipo);
  return t === CBTE_FACTURA_B || t === CBTE_NC_B;
}

export function letraDesdeCbteTipo(cbteTipo: number): 'A' | 'B' | 'C' {
  const t = Number(cbteTipo);
  if (t === CBTE_FACTURA_A || t === CBTE_NC_A) return 'A';
  if (t === 11 || t === 13) return 'C';
  return 'B';
}

/**
 * Totales desde neto gravado (suma cantidad × precio unitario neto del pedido).
 * AFIP siempre usa neto + IVA 21%; en clase B el comprobante impreso muestra importes finales sin desglosar IVA.
 */
export function calcTotalesDesdeNetoGravado(
  netoGravado: number,
  cbteTipo: number,
  agipRetPer = 0
): {
  neto: number;
  iva: number;
  agip: number;
  total: number;
  discriminaIva: boolean;
  /** Multiplicador para mostrar P. unitario / importe en PDF (B = precio final con IVA). */
  factorPrecioImpreso: number;
} {
  const neto = Math.round((Number(netoGravado) || 0) * 100) / 100;
  const iva = Math.round(neto * IVA_RATE * 100) / 100;
  const agip = Math.round((Number(agipRetPer) || 0) * 100) / 100;
  const total = Math.round((neto + iva + agip) * 100) / 100;
  const discriminaIva = !isComprobanteClaseB(cbteTipo);
  return {
    neto,
    iva,
    agip,
    total,
    discriminaIva,
    factorPrecioImpreso: discriminaIva ? 1 : 1 + IVA_RATE,
  };
}
