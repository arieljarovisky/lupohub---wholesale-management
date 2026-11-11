import { execute, get, query } from '../database/db';
import { addReceiptSequence } from '../database/add_receipt_sequence';

/** Tope del talonario R0001 (descarta cargas tipo R0001-112233). */
const MAX_SEQ = 99999;
/** Si el último cargado salta más que esto respecto del anterior, es un dato mal cargado. */
const SPIKE_GAP = 1000;

type ReceiptPoint = { n: number; at: number };

function inRange(n: number): number | null {
  if (!Number.isInteger(n) || n < 1 || n > MAX_SEQ) return null;
  return n;
}

/**
 * Número correlativo del talonario 0001.
 * Acepta `R0001-00021450`, `R0001-21450`, `21450` y el formato Tango `0000100021450`.
 */
export function parseReceiptSequence(raw: unknown): number | null {
  const s = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return null;

  const dashed = s.match(/^R?0*1-(\d+)$/);
  if (dashed) return inRange(Number(dashed[1]));

  if (/^\d{1,8}$/.test(s)) return inRange(Number(s));

  const digits = s.replace(/\D/g, '');
  let body = digits;
  if (digits.length === 13 && digits.startsWith('0')) body = digits.slice(1);
  if (body.length === 12 && Number(body.slice(0, 4)) === 1) {
    return inRange(Number(body.slice(4)));
  }
  return null;
}

/**
 * Siguiente correlativo: el del último recibo cargado + 1.
 * "Último" es el de alta más reciente (el que queda arriba en el listado),
 * no el número más alto del historial. Un recibo viejo importado con número
 * mayor no corre el talonario.
 */
export function nextSequenceFromLatest(points: ReceiptPoint[]): number {
  const ordered = points
    .filter((p) => Number.isInteger(p.n) && p.n >= 1 && p.n <= MAX_SEQ && Number.isFinite(p.at))
    .sort((a, b) => a.at - b.at || a.n - b.n);
  while (ordered.length >= 2 && ordered[ordered.length - 1].n - ordered[ordered.length - 2].n > SPIKE_GAP) {
    ordered.pop();
  }
  const last = ordered.length ? ordered[ordered.length - 1].n : 0;
  return last + 1;
}

export function formatReceiptNumber(n: number): string {
  return `R0001-${String(n).padStart(8, '0')}`;
}

/** Recibos del sistema, en el mismo orden en que los muestra el listado (fecha de alta). */
async function loadReceiptPoints(): Promise<ReceiptPoint[]> {
  const payments = (await query(
    `SELECT receipt_number AS n, COALESCE(created_at, date) AS at FROM payments`
  )) as Array<{ n: string | null; at: string | Date | null }>;
  const points: ReceiptPoint[] = [];
  for (const r of payments) {
    const n = parseReceiptSequence(r.n);
    if (n == null || r.at == null) continue;
    const at = new Date(r.at).getTime();
    if (!Number.isFinite(at)) continue;
    points.push({ n, at });
  }
  return points;
}

async function readSequenceCursor(): Promise<number> {
  await addReceiptSequence();
  const row = await get(`SELECT next_value FROM receipt_sequence WHERE id = 1`);
  const n = Number(row?.next_value || 0);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Próximo número, sin consumirlo. Es el que sigue al último recibo cargado. */
export async function peekNextReceiptNumber(): Promise<string> {
  const fromData = nextSequenceFromLatest(await loadReceiptPoints());
  const fromSeq = await readSequenceCursor();
  return formatReceiptNumber(Math.max(fromData, fromSeq));
}

/**
 * Reserva el siguiente número de forma atómica.
 * Sigue al último recibo cargado y no repite un número ya entregado en esta tanda.
 */
export async function allocateNextReceiptNumber(): Promise<string> {
  const desired = nextSequenceFromLatest(await loadReceiptPoints());
  await addReceiptSequence();
  const inc = await execute(
    `UPDATE receipt_sequence
     SET next_value = LAST_INSERT_ID(GREATEST(next_value, ?)) + 1
     WHERE id = 1`,
    [desired]
  );
  const n = Number((inc as { insertId?: number })?.insertId || 0);
  if (!n) {
    throw new Error('No se pudo asignar el número de recibo');
  }
  return formatReceiptNumber(n);
}
