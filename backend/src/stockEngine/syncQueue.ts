/**
 * Trabajador de la cola de sincronización (stock_sync_queue).
 *
 * - Toma variantes pendientes (con "reserva" en la base, así dos servidores no hacen lo mismo).
 * - Lee el stock ACTUAL de la base (nunca un valor viejo guardado en memoria) y lo manda a cada publicación.
 * - Si todo salió bien y nadie volvió a cambiar la variante mientras tanto, la saca de la cola.
 * - Si algo falló, reintenta más tarde con espera creciente (30 s, 1 min, 2, 4… hasta 1 hora). Nunca se rinde.
 */
import { v4 as uuidv4 } from 'uuid';
import { execute, get, query } from '../database/db';
import { pushMercadoLibre, pushTiendaNube, PushResult } from './pushers';
import { bundleAvailableUnits, resolveTargets, SyncTarget, unitsForListing } from './targets';

const TICK_MS = 1500;
const BATCH = 8;
const CONCURRENCY = 3;
const LOCK_SECONDS = 180;

let timer: NodeJS.Timeout | null = null;
let ticking = false;
let lastTickAt: number | null = null;

export function backoffSeconds(attempts: number, permanent: boolean): number {
  if (permanent) return 6 * 60 * 60;
  const n = Math.max(1, attempts);
  return Math.min(60 * 60, 30 * 2 ** (n - 1));
}

export type VariantPushOutcome = {
  variantId: string;
  stock: number;
  results: Array<{ target: SyncTarget; qty: number; result: PushResult }>;
};

async function pushTarget(target: SyncTarget, stock: number): Promise<{ qty: number; result: PushResult }> {
  const qty = target.bundleId ? await bundleAvailableUnits(target.bundleId) : unitsForListing(stock, target.pack);
  const result =
    target.platform === 'tiendanube'
      ? await pushTiendaNube(target.productId, target.externalVariantId, qty)
      : await pushMercadoLibre(target.productId, target.externalVariantId || null, qty, target.hints);
  return { qty, result };
}

async function recordTarget(variantId: string, target: SyncTarget, qty: number, result: PushResult): Promise<void> {
  const ok = result.ok ? 1 : 0;
  const skipped = result.ok && result.skipped ? result.skipped : null;
  const error = result.ok ? null : result.error;
  await execute(
    `INSERT INTO stock_sync_targets (variant_id, target_key, platform, label, last_qty, ok, skipped_reason, last_error, last_attempt_at, last_ok_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), IF(? = 1, NOW(), NULL))
     ON DUPLICATE KEY UPDATE
       platform = VALUES(platform), label = VALUES(label), last_qty = VALUES(last_qty), ok = VALUES(ok),
       skipped_reason = VALUES(skipped_reason), last_error = VALUES(last_error), last_attempt_at = NOW(),
       last_ok_at = IF(VALUES(ok) = 1, NOW(), last_ok_at)`,
    [variantId, target.key, target.platform, target.label.slice(0, 255), qty, ok, skipped, error, ok]
  );
}

/** Apunta el vínculo de ML a la variación nueva (misma publicación, mismo código). */
async function healMlLink(variantId: string, target: SyncTarget, newVar: string): Promise<void> {
  const oldVar = target.externalVariantId || '';
  await execute(
    `UPDATE IGNORE variant_publications SET external_variant_id = ?
     WHERE variant_id = ? AND platform = 'mercadolibre' AND external_product_id = ? AND external_variant_id = ?`,
    [newVar, variantId, target.productId, oldVar]
  );
  // Si ya existía un vínculo con la variación nueva, el UPDATE IGNORE deja el viejo: se borra.
  await execute(
    `DELETE FROM variant_publications WHERE variant_id = ? AND platform = 'mercadolibre' AND external_product_id = ? AND external_variant_id = ?`,
    [variantId, target.productId, oldVar]
  );
  await execute(
    `UPDATE product_variants SET mercado_libre_variant_id = ? WHERE id = ? AND COALESCE(mercado_libre_variant_id, '') = ?`,
    [newVar, variantId, oldVar]
  );
  console.log(`[StockSync] Vínculo corregido solo: variante ${variantId} → ${target.productId} variación ${oldVar || '-'} → ${newVar}`);
}

/** Manda el stock actual de una variante a todas sus publicaciones (o solo a las plataformas pedidas). */
export async function pushVariant(
  variantId: string,
  platforms?: Array<'tiendanube' | 'mercadolibre'>
): Promise<VariantPushOutcome> {
  const row = await get(`SELECT COALESCE(stock, 0) AS stock FROM stocks WHERE variant_id = ?`, [variantId]);
  const stock = Number(row?.stock) || 0;
  let targets = await resolveTargets(variantId);
  if (platforms?.length) targets = targets.filter((t) => platforms.includes(t.platform));

  const results: VariantPushOutcome['results'] = [];
  for (const target of targets) {
    const { qty, result } = await pushTarget(target, stock);
    results.push({ target, qty, result });
    if (result.ok && result.healedVariationId) {
      await healMlLink(variantId, target, result.healedVariationId).catch((e) =>
        console.warn('[StockSync] No pude guardar el vínculo corregido:', e?.message || e)
      );
      // El estado se guarda con la clave nueva; la vieja se borra abajo al limpiar.
      const healed = { ...target, key: `ml:${target.productId}/${result.healedVariationId}`, externalVariantId: result.healedVariationId };
      await recordTarget(variantId, healed, qty, result).catch(() => undefined);
      targets[targets.indexOf(target)] = healed;
      continue;
    }
    await recordTarget(variantId, target, qty, result).catch(() => undefined);
  }
  // Limpiar estados de publicaciones que ya no están vinculadas.
  if (!platforms?.length) {
    const keys = targets.map((t) => t.key);
    if (keys.length) {
      await execute(`DELETE FROM stock_sync_targets WHERE variant_id = ? AND target_key NOT IN (?)`, [variantId, keys]).catch(
        () => undefined
      );
    } else {
      await execute(`DELETE FROM stock_sync_targets WHERE variant_id = ?`, [variantId]).catch(() => undefined);
    }
  }
  return { variantId, stock, results };
}

async function processClaimed(row: { variant_id: string; version: number; attempts: number; lock_token: string }): Promise<void> {
  let outcome: VariantPushOutcome | null = null;
  let crash: string | null = null;
  try {
    outcome = await pushVariant(row.variant_id);
  } catch (e: any) {
    crash = e?.message || String(e);
  }

  const failures = outcome?.results.filter((r) => !r.result.ok) ?? [];
  if (!crash && failures.length === 0) {
    const del = await execute(`DELETE FROM stock_sync_queue WHERE variant_id = ? AND version = ? AND lock_token = ?`, [
      row.variant_id,
      row.version,
      row.lock_token,
    ]);
    if (!del?.affectedRows) {
      // Cambió el stock mientras enviábamos: liberar para que vuelva a procesarse ya.
      await execute(
        `UPDATE stock_sync_queue SET locked_until = NULL, lock_token = NULL WHERE variant_id = ? AND lock_token = ?`,
        [row.variant_id, row.lock_token]
      );
    }
    return;
  }

  const permanent = !crash && failures.every((f) => !f.result.ok && (f.result as any).permanent);
  const message = crash
    ? `Error interno: ${crash}`
    : failures.map((f) => `${f.target.label}: ${(f.result as any).error}`).join(' | ');
  const attempts = row.attempts + 1;
  const wait = backoffSeconds(attempts, permanent);
  // Si mientras tanto llegó un cambio nuevo (version distinta), se procesa enseguida igual.
  await execute(
    `UPDATE stock_sync_queue
     SET attempts = IF(version = ?, ?, attempts),
         due_at = IF(version = ?, NOW(3) + INTERVAL ? SECOND, due_at),
         last_error = ?,
         locked_until = NULL, lock_token = NULL
     WHERE variant_id = ? AND lock_token = ?`,
    [row.version, attempts, row.version, wait, message.slice(0, 4000), row.variant_id, row.lock_token]
  );
}

async function runPool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item).catch((e) => console.error('[StockSync] Error procesando ítem de la cola:', e?.message || e));
    }
  });
  await Promise.all(workers);
}

export async function tick(): Promise<number> {
  if (ticking) return 0;
  ticking = true;
  lastTickAt = Date.now();
  try {
    const token = uuidv4();
    const claim = await execute(
      `UPDATE stock_sync_queue
       SET lock_token = ?, locked_until = NOW(3) + INTERVAL ? SECOND
       WHERE due_at <= NOW(3) AND (locked_until IS NULL OR locked_until < NOW(3))
       ORDER BY priority, due_at
       LIMIT ${BATCH}`,
      [token, LOCK_SECONDS]
    );
    if (!claim?.affectedRows) return 0;
    const rows = (await query(
      `SELECT variant_id, version, attempts, lock_token FROM stock_sync_queue WHERE lock_token = ?`,
      [token]
    )) as any[];
    await runPool(rows, CONCURRENCY, (r) =>
      processClaimed({
        variant_id: String(r.variant_id),
        version: Number(r.version),
        attempts: Number(r.attempts) || 0,
        lock_token: String(r.lock_token),
      })
    );
    return rows.length;
  } catch (e: any) {
    console.error('[StockSync] Error en la cola:', e?.message || e);
    return 0;
  } finally {
    ticking = false;
  }
}

export function startSyncWorker(): void {
  if (timer) return;
  const loop = async () => {
    const n = await tick();
    // Si había trabajo, seguir enseguida; si no, esperar el intervalo.
    timer = setTimeout(loop, n > 0 ? 100 : TICK_MS);
  };
  timer = setTimeout(loop, TICK_MS);
  console.log('[StockSync] Cola de sincronización ML/TN iniciada');
}

export function workerHeartbeat(): number | null {
  return lastTickAt;
}

/** Pone en la cola todas las variantes que tienen alguna publicación vinculada. */
export async function enqueueAllLinked(): Promise<number> {
  const rows = (await query(
    `SELECT DISTINCT pv.id
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN products p ON p.id = pc.product_id
     LEFT JOIN variant_publications vp ON vp.variant_id = pv.id
     LEFT JOIN publication_stock_bundle_items bi ON bi.variant_id = pv.id
     WHERE vp.id IS NOT NULL
        OR bi.id IS NOT NULL
        OR (pv.tienda_nube_variant_id IS NOT NULL AND pv.tienda_nube_variant_id <> '' AND p.tienda_nube_id IS NOT NULL AND p.tienda_nube_id <> '')
        OR (pv.mercado_libre_item_id IS NOT NULL AND pv.mercado_libre_item_id <> '')
        OR (p.mercado_libre_id IS NOT NULL AND p.mercado_libre_id <> '')`
  )) as any[];
  const ids = rows.map((r) => String(r.id));
  const { enqueueSync } = await import('./ledger');
  // Prioridad baja: el reenvío total nunca demora una venta nueva.
  await enqueueSync(ids, 2000, 1);
  return ids.length;
}

/** Reintentar ya todo lo que está esperando. */
export async function retryAllNow(): Promise<number> {
  const r = await execute(`UPDATE stock_sync_queue SET due_at = NOW(3), attempts = 0 WHERE locked_until IS NULL OR locked_until < NOW(3)`);
  return Number(r?.affectedRows || 0);
}

export async function retryVariantNow(variantId: string): Promise<void> {
  const { enqueueSync } = await import('./ledger');
  await enqueueSync([variantId], 0);
}
