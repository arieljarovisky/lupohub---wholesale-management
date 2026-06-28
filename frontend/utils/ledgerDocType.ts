/** Misma lógica que backend/src/utils/ledgerDocType.ts */
export function normalizeLedgerDocType(tipo: string | null | undefined, detalle?: string | null): string {
  const t0 = String(tipo || '').trim().toUpperCase();
  if (t0 === 'NC' || t0 === 'N/C') return 'NC';
  if (t0 === 'CDE' || t0.startsWith('CDE')) return 'NC';
  if (t0 === 'CRE' || t0.startsWith('CRE') || t0.startsWith('CRÉ')) return 'NC';
  if (t0 === 'NOTA_CREDITO_IMPORTADA' || t0 === 'NOTA_CREDITO') return 'NC';
  if (t0 === 'REC' || t0 === 'RECIBO' || t0 === 'RECIBO_IMPORTADO') return 'REC';
  if (t0 === 'PED' || t0 === 'PEDIDO') return 'PED';
  if (t0 === 'FAC' || t0 === 'FACTURA' || t0 === 'FACTURA_IMPORTADA') return 'FAC';
  if (t0 === 'ND' || t0 === 'NOTA_DEBITO_IMPORTADA') return 'ND';
  if (t0 === 'SALDO' || t0 === 'OPENING' || t0 === 'INICIAL') return 'SALDO';
  const t = `${t0} ${String(detalle || '')}`.toUpperCase();
  if (/SALDO\s*INICIAL|SALDO\s*AL\b/.test(t)) return 'SALDO';
  if (/\bREC\b|RECIBO|COBRO|PAGO/.test(t)) return 'REC';
  if (/\bPED\b|PEDIDO/.test(t)) return 'PED';
  if (/^CDE|NOTA\s*DE\s*CRED|CREDITO|\bNC\b|N\/C/.test(t)) return 'NC';
  if (/NOTA\s*DE\s*DEB|DEBITO|\bND\b/.test(t)) return 'ND';
  if (/\bFAC\b|FACTURA|FCA|FCB|FCC|FCE/.test(t)) return 'FAC';
  return t0 || 'OTRO';
}

export function isVoidedReinvoiceLedgerEntry(entry: {
  tipo?: string | null;
  detalle?: string | null;
  excluirDeSaldo?: boolean;
  voidedForReinvoice?: boolean;
  supersededReinvoicePayment?: boolean;
}): boolean {
  if (entry.voidedForReinvoice) return true;
  if (entry.excluirDeSaldo && normalizeLedgerDocType(entry.tipo) === 'FAC') return true;
  return /factura anulada/i.test(String(entry.detalle || ''));
}

export function isSupersededReinvoicePaymentLedgerEntry(entry: {
  tipo?: string | null;
  excluirDeSaldo?: boolean;
  supersededReinvoicePayment?: boolean;
}): boolean {
  if (entry.supersededReinvoicePayment) return true;
  if (entry.excluirDeSaldo && normalizeLedgerDocType(entry.tipo) === 'REC') return true;
  return false;
}

export function ledgerTipoDisplay(
  tipo: string | null | undefined,
  opts?: {
    detalle?: string | null;
    excluirDeSaldo?: boolean;
    voidedForReinvoice?: boolean;
    supersededReinvoicePayment?: boolean;
  }
): string {
  if (opts && isVoidedReinvoiceLedgerEntry({ tipo, ...opts })) return 'FAC anulada';
  if (opts && isSupersededReinvoicePaymentLedgerEntry({ tipo, ...opts })) return 'REC (cargo anterior)';
  const norm = normalizeLedgerDocType(tipo);
  if (norm === 'SALDO') return 'Saldo inicial';
  if (norm === 'NC' && String(tipo || '').trim().toUpperCase().startsWith('CDE')) return 'NC (CDE)';
  if (norm === 'NC') return 'NC';
  return String(tipo || '—').trim() || '—';
}
