import { ledgerDocTypeAffectsSaldo, normalizeLedgerDocType } from './ledgerDocType';

export function normalizeLedgerDocNumber(value: string | null | undefined): string {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  const cleaned = raw.replace(/[^A-Z0-9-]/g, '');
  const parts = cleaned.split('-').map((p) => p.replace(/^0+/, '') || '0');
  return parts.join('-');
}

export function ledgerMovementDedupeKey(row: {
  tipo: string;
  detalle?: string | null;
  lineDate: string | null;
  numero: string | null;
  importe: number | null;
}): string {
  const tipoNorm = normalizeLedgerDocType(row.tipo, row.detalle);
  return [
    tipoNorm,
    String(row.lineDate || '').slice(0, 10),
    normalizeLedgerDocNumber(row.numero),
    Number(row.importe || 0).toFixed(2),
  ].join('|');
}

export type LedgerRunningRow = {
  lineOrder: number;
  lineDate: string | null;
  tipo: string;
  numero: string | null;
  importe: number | null;
  saldo?: number | null;
  detalle?: string | null;
  source?: 'imported' | 'system';
  saldoCorrido?: number | null;
  /** NC de reemisión: visible en historial pero no modifica el saldo corrido. */
  excluirDeSaldo?: boolean;
};

/** Quita movimientos LupoHub que ya existen en el import Tango (misma clave). */
export function filterSystemDuplicatesAgainstImport<T extends LedgerRunningRow>(rows: T[]): T[] {
  const importedKeys = new Set<string>();
  for (const row of rows) {
    if (row.source === 'imported') {
      importedKeys.add(
        ledgerMovementDedupeKey({
          tipo: row.tipo,
          detalle: row.detalle,
          lineDate: row.lineDate,
          numero: row.numero,
          importe: row.importe,
        })
      );
    }
  }
  return rows.filter((row) => {
    if (row.source !== 'system') return true;
    if (String(row.detalle || '').includes('AFIP LupoHub')) return true;
    if (String(row.detalle || '').includes('Factura anulada')) return true;
    const key = ledgerMovementDedupeKey({
      tipo: row.tipo,
      detalle: row.detalle,
      lineDate: row.lineDate,
      numero: row.numero,
      importe: row.importe,
    });
    return !importedKeys.has(key);
  });
}

/** Saldo = Σ facturas/pedidos − Σ NC − Σ recibos (sin usar el saldo del Excel como cierre). */
export function applyLedgerRunningSaldoSimple(rows: LedgerRunningRow[]): number {
  const sorted = [...rows].sort((a, b) => {
    const da = new Date(a.lineDate || 0).getTime() || 0;
    const db = new Date(b.lineDate || 0).getTime() || 0;
    if (da !== db) return da - db;
    return Number(a.lineOrder || 0) - Number(b.lineOrder || 0);
  });

  let running = 0;
  let hasRunning = false;

  for (const row of sorted) {
    if (row.excluirDeSaldo) {
      row.saldoCorrido = hasRunning ? running : null;
      continue;
    }
    if (row.importe != null && Number.isFinite(Number(row.importe))) {
      const tipoNorm = normalizeLedgerDocType(row.tipo, row.detalle);
      const amount = Math.abs(Number(row.importe)) || 0;
      const side = ledgerDocTypeAffectsSaldo(tipoNorm);
      if (side === 'haber') {
        running = Math.round((running - amount) * 100) / 100;
        hasRunning = true;
      } else if (side === 'debe') {
        running = Math.round((running + amount) * 100) / 100;
        hasRunning = true;
      }
    }
    row.saldoCorrido = hasRunning ? running : null;
  }

  return hasRunning ? running : 0;
}

/**
 * Saldo corrido en tabla: en filas importadas con saldo del Excel usa ese cierre;
 * el resto suma debe/haber sin duplicar lo ya importado.
 */
export function applyLedgerRunningSaldo(rows: LedgerRunningRow[]): number {
  const sorted = [...rows].sort((a, b) => {
    const da = new Date(a.lineDate || 0).getTime() || 0;
    const db = new Date(b.lineDate || 0).getTime() || 0;
    if (da !== db) return da - db;
    return Number(a.lineOrder || 0) - Number(b.lineOrder || 0);
  });

  let running = 0;
  let hasRunning = false;

  for (const row of sorted) {
    const importedSaldo =
      row.source === 'imported' && row.saldo != null && Number.isFinite(Number(row.saldo))
        ? Number(row.saldo)
        : null;

    if (importedSaldo != null) {
      running = Math.round(importedSaldo * 100) / 100;
      hasRunning = true;
      row.saldoCorrido = running;
      continue;
    }

    if (row.excluirDeSaldo) {
      row.saldoCorrido = hasRunning ? running : null;
      continue;
    }

    if (row.importe != null && Number.isFinite(Number(row.importe))) {
      const tipoNorm = normalizeLedgerDocType(row.tipo, row.detalle);
      const amount = Math.abs(Number(row.importe)) || 0;
      const side = ledgerDocTypeAffectsSaldo(tipoNorm);
      if (side === 'haber') {
        running = Math.round((running - amount) * 100) / 100;
        hasRunning = true;
      } else if (side === 'debe') {
        running = Math.round((running + amount) * 100) / 100;
        hasRunning = true;
      }
    }
    row.saldoCorrido = hasRunning ? running : null;
  }

  return hasRunning ? running : 0;
}
