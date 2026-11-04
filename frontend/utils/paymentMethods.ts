/** Medios de cobro del recibo (columna Cargo Banco del talonario). */
export const PAYMENT_METHODS = [
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'echeq', label: 'ECHEQ' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'deposito', label: 'Depósito' },
] as const;

export type PaymentMethodValue = (typeof PAYMENT_METHODS)[number]['value'];

export function isPaymentMethod(v: unknown): v is PaymentMethodValue {
  return PAYMENT_METHODS.some((m) => m.value === v);
}

export function normalizePaymentMethod(v: unknown): PaymentMethodValue | undefined {
  const raw = String(v ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!raw) return undefined;
  if (raw === 'transferencia' || raw === 'transfer' || raw === 'transf') return 'transferencia';
  if (raw === 'echeq' || raw === 'e-cheq' || raw === 'e cheq' || raw === 'cheque electronico') return 'echeq';
  if (raw === 'efectivo' || raw === 'cash') return 'efectivo';
  if (raw === 'deposito' || raw === 'dep') return 'deposito';
  return undefined;
}

export function paymentMethodLabel(v: unknown): string {
  const n = normalizePaymentMethod(v);
  if (!n) return '';
  return PAYMENT_METHODS.find((m) => m.value === n)?.label || n.toUpperCase();
}

/** Texto para la columna CARGO BANCO del recibo oficial. */
export function paymentMethodCargoBanco(v: unknown): string {
  const n = normalizePaymentMethod(v);
  if (!n) return '';
  if (n === 'transferencia') return 'TRANSFERENCIA';
  if (n === 'echeq') return 'ECHEQ';
  if (n === 'efectivo') return 'EFECTIVO';
  if (n === 'deposito') return 'DEPOSITO';
  return '';
}
