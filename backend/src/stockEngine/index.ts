/** Arranque del motor de stock: cola de envío a ML/TN, revisión periódica de ventas y reenvío diario. */
import { getEngineState, setEngineState } from './schema';
import { enqueueAllLinked, startSyncWorker } from './syncQueue';
import { pollRecentOrders } from './channelOrders';

const POLL_EVERY_MS = 10 * 60 * 1000;
const RESYNC_CHECK_EVERY_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

let started = false;
let polling = false;

/** Revisa las ventas recientes de TN y ML por si se perdió algún aviso (webhook). */
export async function checkRecentOrders(windowMs?: number): Promise<{ tn: number; ml: number; errors: string[] }> {
  if (polling) return { tn: 0, ml: 0, errors: ['Ya hay una revisión en curso'] };
  polling = true;
  try {
    const now = Date.now();
    const last = Number(new Date((await getEngineState('last_order_poll_at')) || 0).getTime()) || 0;
    const cutover = Number(new Date((await getEngineState('cutover_at')) || 0).getTime()) || 0;
    // Ventana: desde la última revisión (con 30 min de margen), como mucho 48 h, nunca antes del corte.
    let since = windowMs ? now - windowMs : last ? last - 30 * 60 * 1000 : now - 6 * 60 * 60 * 1000;
    since = Math.max(since, now - 48 * 60 * 60 * 1000, cutover - 60 * 60 * 1000);
    const res = await pollRecentOrders(since);
    await setEngineState('last_order_poll_at', new Date(now).toISOString());
    if (res.errors.length) await setEngineState('last_order_poll_errors', res.errors.slice(0, 20).join('\n'));
    else await setEngineState('last_order_poll_errors', '');
    return res;
  } finally {
    polling = false;
  }
}

async function maybeDailyResync(): Promise<void> {
  // El reenvío diario se activa recién cuando el usuario hizo el primer "Enviar todo" a mano.
  if ((await getEngineState('full_resync_enabled')) !== '1') return;
  const last = new Date((await getEngineState('last_full_resync_at')) || 0).getTime() || 0;
  if (Date.now() - last < DAY_MS) return;
  const n = await enqueueAllLinked();
  await setEngineState('last_full_resync_at', new Date().toISOString());
  console.log(`[StockEngine] Reenvío diario: ${n} variantes en cola`);
}

export function startStockEngine(): void {
  if (started) return;
  started = true;
  startSyncWorker();

  const poll = () =>
    checkRecentOrders()
      .then((r) => {
        if (r.errors.length) console.warn('[StockEngine] Revisión de ventas con errores:', r.errors.slice(0, 5));
      })
      .catch((e) => console.error('[StockEngine] Revisión de ventas falló:', e?.message || e));
  setTimeout(poll, 60 * 1000);
  setInterval(poll, POLL_EVERY_MS);

  const resync = () => maybeDailyResync().catch((e) => console.error('[StockEngine] Reenvío diario falló:', e?.message || e));
  setTimeout(resync, 5 * 60 * 1000);
  setInterval(resync, RESYNC_CHECK_EVERY_MS);

  console.log('[StockEngine] Motor de stock iniciado (cola ML/TN + revisión de ventas cada 10 min)');
}
