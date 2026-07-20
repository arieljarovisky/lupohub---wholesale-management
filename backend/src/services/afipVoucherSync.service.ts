/**
 * Sincroniza comprobantes AFIP de puntos de venta externos (Facturador Mercado Libre, etc.)
 * hacia `afip_synced_vouchers` para reportes (Ventas por jurisdicción).
 */
import { v4 as uuidv4 } from 'uuid';
import { execute, get } from '../database/db';
import {
  consultarComprobanteAfip,
  getLastAfipVoucherNumber,
  isAfipConfigured,
} from './afip.service';

/** Tipos de comprobante a sincronizar: FA/ND/NC A-B-C. */
const CBTE_TIPOS_SYNC = [1, 2, 3, 6, 7, 8, 11, 12, 13] as const;

/** PV del Facturador de Mercado Libre por defecto. Override: AFIP_ML_PTO_VTA=22 o "22,23". */
const ML_PTO_VTA_DEFAULT = 22;

/** Tope de llamadas AFIP por export (evita timeouts en la primera sync grande). */
const DEFAULT_MAX_AFIP_CALLS = Math.min(
  2500,
  Math.max(50, parseInt(process.env.AFIP_JURISDICCION_SYNC_MAX_CALLS || '1200', 10) || 1200)
);

const CONCURRENCY = Math.min(
  5,
  Math.max(1, parseInt(process.env.AFIP_JURISDICCION_SYNC_CONCURRENCY || '3', 10) || 3)
);

export type AfipSyncResult = {
  puntosVenta: number[];
  scanned: number;
  upserted: number;
  incomplete: boolean;
  skipped: boolean;
  message?: string;
};

export function getMercadoLibreAfipPuntosVenta(): number[] {
  const raw = String(process.env.AFIP_ML_PTO_VTA || ML_PTO_VTA_DEFAULT).trim();
  const nums = raw
    .split(/[,;\s]+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return Array.from(new Set(nums.length ? nums : [ML_PTO_VTA_DEFAULT]));
}

function parseAfipCbteFchToYmd(v: unknown): string | null {
  const s = String(v ?? '').replace(/\D/g, '');
  if (s.length !== 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function extractImpTrib(r: Record<string, unknown>): number {
  const impTrib = Number(r.ImpTrib ?? r.impTrib ?? 0);
  if (impTrib > 0.005) return round2(impTrib);
  const raw = (r.Tributos as { Tributo?: unknown } | undefined)?.Tributo ?? r.tributos;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  let sum = 0;
  for (const t of list) {
    const row = t as Record<string, unknown>;
    sum += Number(row.Importe ?? row.importe ?? 0) || 0;
  }
  return round2(sum);
}

function sourceHintForPuntoVenta(puntoVenta: number): string {
  const mlPvs = new Set(getMercadoLibreAfipPuntosVenta());
  return mlPvs.has(puntoVenta) ? 'MERCADOLIBRE' : 'AFIP';
}

async function upsertVoucher(params: {
  puntoVenta: number;
  cbteTipo: number;
  cbteDesde: number;
  cbteHasta: number;
  cae: string | null;
  fecha: string;
  impNeto: number;
  impIva: number;
  impTrib: number;
  impTotal: number;
  docTipo: number | null;
  docNro: string | null;
  sourceHint: string;
}): Promise<boolean> {
  const existing = (await get(
    `SELECT id FROM afip_synced_vouchers
     WHERE punto_venta = ? AND cbte_tipo = ? AND cbte_desde = ?
     LIMIT 1`,
    [params.puntoVenta, params.cbteTipo, params.cbteDesde]
  )) as { id: string } | undefined;

  if (existing?.id) {
    await execute(
      `UPDATE afip_synced_vouchers SET
         cbte_hasta = ?, cae = ?, fecha = ?,
         imp_neto = ?, imp_iva = ?, imp_trib = ?, imp_total = ?,
         doc_tipo = ?, doc_nro = ?, source_hint = ?
       WHERE id = ?`,
      [
        params.cbteHasta,
        params.cae,
        params.fecha,
        params.impNeto,
        params.impIva,
        params.impTrib,
        params.impTotal,
        params.docTipo,
        params.docNro,
        params.sourceHint,
        existing.id,
      ]
    );
    return false;
  }

  await execute(
    `INSERT INTO afip_synced_vouchers
     (id, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, cae, fecha,
      imp_neto, imp_iva, imp_trib, imp_total, doc_tipo, doc_nro, source_hint)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      params.puntoVenta,
      params.cbteTipo,
      params.cbteDesde,
      params.cbteHasta,
      params.cae,
      params.fecha,
      params.impNeto,
      params.impIva,
      params.impTrib,
      params.impTotal,
      params.docTipo,
      params.docNro,
      params.sourceHint,
    ]
  );
  return true;
}

async function fetchAndStoreVoucher(
  puntoVenta: number,
  cbteTipo: number,
  cbteNro: number,
  sourceHint: string
): Promise<{ stored: boolean; fecha: string | null; exists: boolean }> {
  let consulta: Awaited<ReturnType<typeof consultarComprobanteAfip>>;
  try {
    consulta = await consultarComprobanteAfip(puntoVenta, cbteTipo, cbteNro);
  } catch (err: any) {
    console.warn(
      `[AFIP sync] Error consultando ${puntoVenta}/${cbteTipo}/${cbteNro}:`,
      err?.message || err
    );
    return { stored: false, fecha: null, exists: false };
  }
  if (!consulta.existe || !consulta.resultado) {
    return { stored: false, fecha: null, exists: false };
  }

  const r = consulta.resultado as Record<string, unknown>;
  const fecha = parseAfipCbteFchToYmd(r.CbteFch ?? r.cbteFch);
  if (!fecha) return { stored: false, fecha: null, exists: true };

  const cae = String(r.CodAutorizacion ?? r.codAutorizacion ?? '').trim() || null;
  const cbteHasta = Number(r.CbteHasta ?? r.cbteHasta ?? cbteNro) || cbteNro;
  const impNeto = round2(Number(r.ImpNeto ?? r.impNeto ?? 0));
  const impIva = round2(Number(r.ImpIVA ?? r.impIVA ?? r.ImpIva ?? 0));
  const impTrib = extractImpTrib(r);
  const impTotal = round2(Number(r.ImpTotal ?? r.impTotal ?? 0));
  const docTipoRaw = Number(r.DocTipo ?? r.docTipo ?? 0);
  const docTipo = Number.isFinite(docTipoRaw) && docTipoRaw > 0 ? docTipoRaw : null;
  const docNroRaw = String(r.DocNro ?? r.docNro ?? '').replace(/\D/g, '');
  const docNro = docNroRaw || null;

  const inserted = await upsertVoucher({
    puntoVenta,
    cbteTipo,
    cbteDesde: cbteNro,
    cbteHasta,
    cae,
    fecha,
    impNeto,
    impIva,
    impTrib,
    impTotal,
    docTipo,
    docNro,
    sourceHint,
  });

  return { stored: inserted, fecha, exists: true };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

type Bounds = { maxNro: number; minFecha: string | null; minNro: number };

async function getSyncedBounds(puntoVenta: number, cbteTipo: number): Promise<Bounds> {
  const row = (await get(
    `SELECT
       COALESCE(MAX(cbte_desde), 0) AS max_nro,
       COALESCE(MIN(cbte_desde), 0) AS min_nro,
       MIN(fecha) AS min_fecha
     FROM afip_synced_vouchers
     WHERE punto_venta = ? AND cbte_tipo = ?`,
    [puntoVenta, cbteTipo]
  )) as { max_nro: number; min_nro: number; min_fecha: string | Date | null } | undefined;

  const minFechaRaw = row?.min_fecha;
  let minFecha: string | null = null;
  if (minFechaRaw instanceof Date && !Number.isNaN(minFechaRaw.getTime())) {
    minFecha = minFechaRaw.toISOString().slice(0, 10);
  } else if (minFechaRaw != null) {
    const s = String(minFechaRaw).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) minFecha = s;
  }

  return {
    maxNro: Number(row?.max_nro || 0),
    minNro: Number(row?.min_nro || 0),
    minFecha,
  };
}

/**
 * Asegura que los comprobantes AFIP de los PV configurados (ML) cubran [desde, hasta].
 * Incremental: primero completa hacia adelante (números nuevos), luego hacia atrás si falta historial.
 */
export async function syncAfipVouchersForDateRange(opts: {
  desde: string;
  hasta: string;
  puntosVenta?: number[];
  maxCalls?: number;
}): Promise<AfipSyncResult> {
  const puntosVenta = opts.puntosVenta?.length
    ? opts.puntosVenta
    : getMercadoLibreAfipPuntosVenta();
  const maxCalls = opts.maxCalls ?? DEFAULT_MAX_AFIP_CALLS;

  if (!isAfipConfigured()) {
    return {
      puntosVenta,
      scanned: 0,
      upserted: 0,
      incomplete: false,
      skipped: true,
      message: 'AFIP no configurado: se omitió sync de facturas ML (PV configurados).',
    };
  }

  let scanned = 0;
  let upserted = 0;
  let incomplete = false;
  const budget = { left: maxCalls };

  for (const puntoVenta of puntosVenta) {
    const sourceHint = sourceHintForPuntoVenta(puntoVenta);

    for (const cbteTipo of CBTE_TIPOS_SYNC) {
      if (budget.left <= 0) {
        incomplete = true;
        break;
      }

      let last = 0;
      try {
        last = await getLastAfipVoucherNumber(puntoVenta, cbteTipo);
      } catch (err: any) {
        console.warn(
          `[AFIP sync] getLastVoucher ${puntoVenta}/${cbteTipo}:`,
          err?.message || err
        );
        continue;
      }
      if (!last || last < 1) continue;

      const bounds = await getSyncedBounds(puntoVenta, cbteTipo);

      // 1) Forward: números nuevos desde el máximo local hasta el último de AFIP.
      if (bounds.maxNro < last) {
        const forwardFrom = bounds.maxNro + 1;
        const forwardNums: number[] = [];
        for (let n = forwardFrom; n <= last && forwardNums.length < budget.left; n += 1) {
          forwardNums.push(n);
        }
        if (forwardNums.length < last - forwardFrom + 1) incomplete = true;

        const forwardResults = await mapPool(forwardNums, CONCURRENCY, async (n) => {
          const r = await fetchAndStoreVoucher(puntoVenta, cbteTipo, n, sourceHint);
          return r;
        });
        scanned += forwardResults.length;
        budget.left -= forwardResults.length;
        upserted += forwardResults.filter((r) => r.stored).length;
      }

      // 2) Backfill: si no hay datos o el más viejo es posterior a `desde`, bajar desde min local.
      const boundsAfter = await getSyncedBounds(puntoVenta, cbteTipo);
      const needsBackfill =
        boundsAfter.maxNro === 0 ||
        !boundsAfter.minFecha ||
        boundsAfter.minFecha > opts.desde;

      if (needsBackfill && budget.left > 0) {
        const startDown =
          boundsAfter.minNro > 0 ? boundsAfter.minNro - 1 : Math.min(last, boundsAfter.maxNro || last);
        const backNums: number[] = [];
        for (let n = startDown; n >= 1 && backNums.length < budget.left; n -= 1) {
          backNums.push(n);
        }

        let consecutiveOlder = 0;
        // Procesar en lotes para poder cortar al salir del rango.
        const BATCH = Math.max(CONCURRENCY * 4, 12);
        for (let offset = 0; offset < backNums.length && budget.left > 0; offset += BATCH) {
          const batch = backNums.slice(offset, offset + BATCH).slice(0, budget.left);
          const batchResults = await mapPool(batch, CONCURRENCY, async (n) => {
            const r = await fetchAndStoreVoucher(puntoVenta, cbteTipo, n, sourceHint);
            return { n, ...r };
          });
          scanned += batchResults.length;
          budget.left -= batchResults.length;
          upserted += batchResults.filter((r) => r.stored).length;

          // Ordenar por nro descendente para evaluar corte por fecha.
          batchResults.sort((a, b) => b.n - a.n);
          for (const r of batchResults) {
            if (!r.fecha) continue;
            if (r.fecha < opts.desde) {
              consecutiveOlder += 1;
              if (consecutiveOlder >= 8) {
                // Suficiente evidencia de que salimos del rango pedido.
                budget.left = budget.left; // no-op, salimos del for externo
                offset = backNums.length;
                break;
              }
            } else {
              consecutiveOlder = 0;
            }
          }
          if (consecutiveOlder >= 8) break;
        }

        // Si aún no cubrimos `desde` y se acabó el presupuesto, marcar incomplete.
        const boundsFinal = await getSyncedBounds(puntoVenta, cbteTipo);
        if (
          budget.left <= 0 &&
          (boundsFinal.maxNro === 0 || !boundsFinal.minFecha || boundsFinal.minFecha > opts.desde)
        ) {
          incomplete = true;
        }
      }
    }
    if (budget.left <= 0) incomplete = true;
  }

  return {
    puntosVenta,
    scanned,
    upserted,
    incomplete,
    skipped: false,
    message: incomplete
      ? 'Sync AFIP parcial: reexportá para completar comprobantes más antiguos del rango.'
      : undefined,
  };
}

/** Tipos FA/ND → FAC; NC → CDE. */
export function afipCbteTipoToJurisdiccionTipo(cbteTipo: number): 'FAC' | 'CDE' {
  const n = Number(cbteTipo);
  if (n === 3 || n === 8 || n === 13) return 'CDE';
  return 'FAC';
}

export async function countSyncedVouchersInRange(
  puntosVenta: number[],
  desde: string,
  hasta: string
): Promise<number> {
  if (!puntosVenta.length) return 0;
  const ph = puntosVenta.map(() => '?').join(',');
  const row = (await get(
    `SELECT COUNT(*) AS cnt FROM afip_synced_vouchers
     WHERE punto_venta IN (${ph}) AND fecha >= ? AND fecha <= ?`,
    [...puntosVenta, desde, hasta]
  )) as { cnt: number } | undefined;
  return Number(row?.cnt || 0);
}
