/** Tipos AFIP WSFE / WSFEX usados en LupoHub (factura / NC). */
export const CBTE_FACTURA_A = 1;
export const CBTE_FACTURA_B = 6;
export const CBTE_FACTURA_C = 11;
export const CBTE_FACTURA_E = 19;
export const CBTE_NC_A = 3;
export const CBTE_NC_B = 8;
export const CBTE_NC_C = 13;

const IVA_RATE = 0.21;

/** Factura B/C y NC B/C: en el papel no se discrimina IVA (precios con IVA incluido). */
export function isComprobanteClaseB(cbteTipo: number): boolean {
  const t = Number(cbteTipo);
  return t === CBTE_FACTURA_B || t === CBTE_NC_B;
}

/** Factura C y NC C: emisor monotributista/exento, sin IVA (total = neto). */
export function isComprobanteClaseC(cbteTipo: number): boolean {
  const t = Number(cbteTipo);
  return t === CBTE_FACTURA_C || t === CBTE_NC_C;
}

export function letraDesdeCbteTipo(cbteTipo: number): 'A' | 'B' | 'C' | 'E' {
  const t = Number(cbteTipo);
  if (t === CBTE_FACTURA_E) return 'E';
  if (t === CBTE_FACTURA_A || t === CBTE_NC_A) return 'A';
  if (t === 11 || t === 13) return 'C';
  return 'B';
}

export function isComprobanteExportacion(cbteTipo: number): boolean {
  return Number(cbteTipo) === CBTE_FACTURA_E;
}

/**
 * Totales desde neto gravado (suma cantidad × precio unitario neto del pedido).
 * Factura A/B: neto + IVA 21% (+ IIBB). Factura C y E (exportación): sin IVA ni percepción.
 * En clase B el comprobante impreso muestra importes finales sin desglosar IVA.
 * En clase C (monotributo/exento) el total = neto, sin IVA.
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
  /** Multiplicador para mostrar P. unitario / importe en PDF (B = precio final con IVA, C y E = sin IVA). */
  factorPrecioImpreso: number;
} {
  const neto = Math.round((Number(netoGravado) || 0) * 100) / 100;
  const esExport = isComprobanteExportacion(cbteTipo);
  const esClaseC = isComprobanteClaseC(cbteTipo);
  const sinIva = esExport || esClaseC;
  const iva = sinIva ? 0 : Math.round(neto * IVA_RATE * 100) / 100;
  const agip = sinIva ? 0 : Math.round((Number(agipRetPer) || 0) * 100) / 100;
  const total = Math.round((neto + iva + agip) * 100) / 100;
  const discriminaIva = !sinIva && !isComprobanteClaseB(cbteTipo);
  return {
    neto,
    iva,
    agip,
    total,
    discriminaIva,
    factorPrecioImpreso: discriminaIva || sinIva ? 1 : 1 + IVA_RATE,
  };
}
