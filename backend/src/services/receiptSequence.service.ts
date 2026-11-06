import { execute, get, query } from '../database/db';
import { addReceiptSequence } from '../database/add_receipt_sequence';

/** Tope del talonario R0001 (descarta cargas tipo R0001-112233). */
const MAX_SEQ = 99999;
/** Si el máximo queda aislado por más de este salto, es un dato mal cargado. */
const SPIKE_GAP = 1000;

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

/** Siguiente correlativo: máximo vigente + 1, sin reutilizar y sin seguir un pico suelto. */
export function nextSequenceFromExisting(nums: number[]): number {
  const uniq = [...new Set(nums.filter((n) => Number.isInteger(n) && n >= 1 && n <= MAX_SEQ))].sort(
    (a, b) => a - b
  );
  while (uniq.length >= 2 && uniq[uniq.length - 1] - uniq[uniq.length - 2] > SPIKE_GAP) {
    uniq.pop();
  }
  const max = uniq.length ? uniq[uniq.length - 1] : 0;
  return max + 1;
}

export function formatReceiptNumber(n: number): string {
  return `R0001-${String(n).padStart(8, '0')}`;
}

async function loadSequences(): Promise<number[]> {
  const payments = (await query(`SELECT receipt_number AS n FROM payments`)) as Array<{ n: string | null }>;
  const nums = payments.map((r) => parseReceiptSequence(r.n)).filter((n): n is number => n != null);
  try {
    const imported = (await query(
      `SELECT numero AS n FROM customer_multimedia_entries
       WHERE UPPER(TRIM(COALESCE(tipo, ''))) LIKE 'REC%'`
    )) as Array<{ n: string | null }>;
    for (const r of imported) {
      const n = parseReceiptSequence(r.n);
      if (n != null) nums.push(n);
    }
  } catch {
    /* sin historial importado */
  }
  return nums;
}

async function readSequenceCursor(): Promise<number> {
  await addReceiptSequence();
  const row = await get(`SELECT next_value FROM receipt_sequence WHERE id = 1`);
  const n = Number(row?.next_value || 0);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Próximo número, sin consumirlo. */
export async function peekNextReceiptNumber(): Promise<string> {
  const fromData = nextSequenceFromExisting(await loadSequences());
  const fromSeq = await readSequenceCursor();
  return formatReceiptNumber(Math.max(fromData, fromSeq));
}

/**
 * Reserva el siguiente número de forma atómica.
 * Nunca baja del último recibo ya cargado ni reutiliza un número entregado.
 */
export async function allocateNextReceiptNumber(): Promise<string> {
  const desired = nextSequenceFromExisting(await loadSequences());
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
