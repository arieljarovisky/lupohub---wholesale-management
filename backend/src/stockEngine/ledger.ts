/**
 * Libro de stock: ÚNICO lugar donde se escribe `stocks`.
 *
 * Cada cambio corre dentro de una transacción que:
 *  1. bloquea las filas de stock de las variantes (FOR UPDATE, en orden fijo → sin deadlocks),
 *  2. ignora el cambio si su clave de idempotencia ya existe (webhooks repetidos),
 *  3. escribe el stock nuevo y el movimiento,
 *  4. encola la variante para enviarla a ML/TN (en la misma transacción: no se pierde nunca).
 */
import type { PoolConnection } from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../database/db';

export type MovementType =
  | 'PEDIDO_MAYORISTA'
  | 'VENTA_TIENDA_NUBE'
  | 'VENTA_MERCADO_LIBRE'
  | 'CANCEL_VENTA_TIENDA_NUBE'
  | 'CANCEL_VENTA_MERCADO_LIBRE'
  | 'AJUSTE_MANUAL'
  | 'DEVOLUCION'
  | 'IMPORTACION_TN'
  | 'IMPORTACION_ML'
  | 'IMPORTACION_EXCEL'
  | 'IMPORTACION_DESPACHO_GRID'
  | 'SNAPSHOT_INICIAL';

export type LedgerEntry = {
  variantId: string;
  /** Sumar/restar unidades. Usar `delta` o `setTo`, no ambos. */
  delta?: number;
  /** Fijar el stock a este valor. */
  setTo?: number;
  type: MovementType;
  reference?: string | null;
  source?: string | null;
  sourceId?: string | null;
  /** Si ya existe un movimiento con esta clave, el cambio se ignora. */
  idempotencyKey?: string | null;
  /** Si el stock queda negativo, dejar un aviso para el usuario con este texto. */
  alertIfNegative?: string | null;
};

export type LedgerResult = {
  variantId: string;
  previousStock: number;
  newStock: number;
  applied: boolean;
};

export type Conn = PoolConnection;

const RETRYABLE_ERRNOS = new Set([1213 /* deadlock */, 1205 /* lock wait timeout */]);

/** Ejecuta `fn` en una transacción. Reintenta ante deadlock / lock timeout. */
export async function withTransaction<T>(fn: (conn: Conn) => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const out = await fn(conn);
      await conn.commit();
      return out;
    } catch (err: any) {
      lastErr = err;
      try {
        await conn.rollback();
      } catch {
        /* ignore */
      }
      if (!RETRYABLE_ERRNOS.has(Number(err?.errno)) || i === attempts) throw err;
      await new Promise((r) => setTimeout(r, 50 * i + Math.floor(Math.random() * 100)));
    } finally {
      conn.release();
    }
  }
  throw lastErr;
}

export async function q<T = any>(conn: Conn, sql: string, params: any[] = []): Promise<T[]> {
  const [rows] = await conn.query(sql, params);
  return rows as T[];
}

export async function q1<T = any>(conn: Conn, sql: string, params: any[] = []): Promise<T | null> {
  const rows = await q<T>(conn, sql, params);
  return rows.length ? rows[0] : null;
}

function toInt(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v) : 0;
}

/** Bloquea filas de stock (creándolas si faltan) y devuelve el stock actual de cada variante. */
export async function lockStocks(conn: Conn, variantIds: string[]): Promise<Map<string, number>> {
  const ids = Array.from(new Set(variantIds.filter(Boolean))).sort();
  const out = new Map<string, number>();
  if (!ids.length) return out;
  for (const id of ids) {
    await conn.query(`INSERT IGNORE INTO stocks (variant_id, stock) VALUES (?, 0)`, [id]);
  }
  const rows = await q(conn, `SELECT variant_id, stock FROM stocks WHERE variant_id IN (?) ORDER BY variant_id FOR UPDATE`, [ids]);
  for (const r of rows as any[]) out.set(String(r.variant_id), toInt(r.stock));
  return out;
}

/**
 * Encola variantes para enviar su stock a ML/TN (debounce corto para agrupar ráfagas).
 * priority 0 = cambio real de stock (va primero); 1 = reenvío masivo (va después).
 */
export async function enqueueSyncInTx(conn: Conn, variantIds: string[], delayMs = 1000, priority: 0 | 1 = 0): Promise<void> {
  const ids = Array.from(new Set(variantIds.filter(Boolean)));
  for (const id of ids) {
    await conn.query(
      `INSERT INTO stock_sync_queue (variant_id, version, due_at, attempts, priority)
       VALUES (?, 1, NOW(3) + INTERVAL ? MICROSECOND, 0, ?)
       ON DUPLICATE KEY UPDATE
         version = version + 1,
         attempts = 0,
         priority = LEAST(priority, VALUES(priority)),
         due_at = LEAST(due_at, NOW(3) + INTERVAL ? MICROSECOND)`,
      [id, delayMs * 1000, priority, delayMs * 1000]
    );
  }
}

/**
 * Aplica movimientos dentro de una transacción ya abierta.
 * Las variantes inexistentes generan error (no se inventan filas de stock huérfanas).
 */
export async function applyEntriesInTx(
  conn: Conn,
  entries: LedgerEntry[],
  opts: { syncExternal?: boolean } = {}
): Promise<LedgerResult[]> {
  const syncExternal = opts.syncExternal !== false;
  if (!entries.length) return [];

  const ids = Array.from(new Set(entries.map((e) => e.variantId))).sort();
  const known = await q(conn, `SELECT id FROM product_variants WHERE id IN (?)`, [ids]);
  const knownIds = new Set((known as any[]).map((r) => String(r.id)));
  const missing = ids.filter((id) => !knownIds.has(id));
  if (missing.length) {
    throw new Error(`Variante inexistente: ${missing.join(', ')}`);
  }

  const current = await lockStocks(conn, ids);
  const results: LedgerResult[] = [];
  const touched = new Set<string>();

  for (const e of entries) {
    const hasDelta = e.delta != null;
    const hasSet = e.setTo != null;
    if (hasDelta === hasSet) throw new Error('LedgerEntry necesita delta o setTo (uno solo)');

    const prev = current.get(e.variantId) ?? 0;

    if (e.idempotencyKey) {
      const dup = await q1(
        conn,
        `SELECT id FROM stock_movements WHERE idempotency_key = ? LOCK IN SHARE MODE`,
        [e.idempotencyKey]
      );
      if (dup) {
        results.push({ variantId: e.variantId, previousStock: prev, newStock: prev, applied: false });
        continue;
      }
    }

    const next = hasSet ? toInt(e.setTo) : prev + toInt(e.delta);
    const change = next - prev;

    if (change !== 0 || e.type === 'SNAPSHOT_INICIAL' || e.idempotencyKey) {
      await conn.query(`UPDATE stocks SET stock = ? WHERE variant_id = ?`, [next, e.variantId]);
      await conn.query(
        `INSERT INTO stock_movements
           (id, variant_id, previous_stock, new_stock, quantity_change, movement_type, reference, source, source_id, idempotency_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          uuidv4(),
          e.variantId,
          prev,
          next,
          change,
          e.type,
          e.reference ?? null,
          e.source ?? null,
          e.sourceId ?? null,
          e.idempotencyKey ?? null,
        ]
      );
    }

    if (next < 0 && change < 0 && e.alertIfNegative) {
      await conn.query(
        `INSERT INTO stock_alerts (id, kind, variant_id, message, reference) VALUES (?, 'oversold', ?, ?, ?)`,
        [uuidv4(), e.variantId, e.alertIfNegative.slice(0, 500), e.reference ?? null]
      );
    }

    current.set(e.variantId, next);
    touched.add(e.variantId);
    results.push({ variantId: e.variantId, previousStock: prev, newStock: next, applied: true });
  }

  if (touched.size) {
    await conn.query(
      `UPDATE products p
       JOIN product_colors pc ON pc.product_id = p.id
       JOIN product_variants pv ON pv.product_color_id = pc.id
       SET p.updated_at = CURRENT_TIMESTAMP
       WHERE pv.id IN (?)`,
      [Array.from(touched)]
    ).catch(() => undefined);
    if (syncExternal) await enqueueSyncInTx(conn, Array.from(touched));
  }

  return results;
}

/** Atajo: aplica movimientos en su propia transacción. */
export async function applyEntries(
  entries: LedgerEntry[],
  opts: { syncExternal?: boolean } = {}
): Promise<LedgerResult[]> {
  if (!entries.length) return [];
  return withTransaction((conn) => applyEntriesInTx(conn, entries, opts));
}

/** Encola variantes para reenviar su stock (sin cambiar stock). */
export async function enqueueSync(variantIds: string[], delayMs = 1000, priority: 0 | 1 = 0): Promise<void> {
  if (!variantIds.length) return;
  // De a bloques para no armar transacciones gigantes.
  const ids = Array.from(new Set(variantIds));
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    await withTransaction((conn) => enqueueSyncInTx(conn, chunk, delayMs, priority));
  }
}
