/**
 * Stock de pedidos mayoristas.
 *
 * Idea central: por cada pedido guardamos cuántas unidades de cada variante tiene "tomadas" del stock
 * (wholesale_order_stock). Cada vez que algo cambia (estado, ítems, armado, cancelación, nota de crédito)
 * se calcula cuánto DEBERÍA tener tomado y se mueve solo la diferencia. Así:
 *  - nunca se descuenta dos veces,
 *  - cancelar devuelve exactamente lo descontado,
 *  - editar un pedido ya descontado ajusta el stock solo.
 *
 * Cuándo descuenta (igual que antes): al terminar el armado (Falta controlar / Controlado / Despachado),
 * o al instante en ventas de showroom, o cuando alguien lo pide a mano.
 */
import { applyEntriesInTx, Conn, LedgerEntry, q, q1, withTransaction } from './ledger';
import { PICKING_DONE } from './schema';

type OrderRow = {
  id: string;
  status: string;
  no_stock_impact: number;
  stock_state: string | null;
  stock_frozen: number;
};

export type WholesaleStockReason = 'auto' | 'manual_apply' | 'manual_restore' | 'cancel' | 'credit_note' | 'delete';

const RESTORE_REFERENCE: Record<WholesaleStockReason, (id: string) => string> = {
  auto: (id) => `Ajuste pedido: ${id}`,
  manual_apply: (id) => `Ajuste pedido: ${id}`,
  manual_restore: (id) => `Restauración pedido: ${id}`,
  cancel: (id) => `Cancelación pedido: ${id}`,
  credit_note: (id) => `Nota de crédito pedido: ${id}`,
  delete: (id) => `Cancelación pedido: ${id}`,
};

export function isPickingDone(status: string | null | undefined): boolean {
  return PICKING_DONE.includes(String(status || ''));
}

/** Unidades por ítem: si se vende por pack, la cantidad está en packs. */
export function itemUnits(quantity: number, picked: number, sellAsPack: boolean, packSize: number, usePicked: boolean): number {
  const q = Math.max(0, Math.floor(Number(quantity) || 0));
  const p = Math.max(0, Math.floor(Number(picked) || 0));
  const base = usePicked ? Math.min(q, p) : q;
  return sellAsPack ? base * Math.max(1, Math.floor(Number(packSize) || 1)) : base;
}

/** Diferencias a aplicar: positivo = hay que tomar más stock, negativo = devolver. */
export function computeWholesaleDeltas(
  current: Map<string, number>,
  desired: Map<string, number>
): Array<{ variantId: string; take: number; desired: number }> {
  const ids = new Set<string>([...current.keys(), ...desired.keys()]);
  const out: Array<{ variantId: string; take: number; desired: number }> = [];
  for (const id of Array.from(ids).sort()) {
    const want = Math.max(0, desired.get(id) ?? 0);
    const has = current.get(id) ?? 0;
    if (want !== has) out.push({ variantId: id, take: want - has, desired: want });
  }
  return out;
}

async function lockOrder(conn: Conn, orderId: string): Promise<OrderRow | null> {
  return q1<OrderRow>(
    conn,
    `SELECT id, status, COALESCE(no_stock_impact, 0) AS no_stock_impact, stock_state, COALESCE(stock_frozen, 0) AS stock_frozen
     FROM orders WHERE id = ? FOR UPDATE`,
    [orderId]
  );
}

async function itemUnitsByVariant(conn: Conn, orderId: string, usePicked: boolean): Promise<Map<string, number>> {
  const rows = await q(
    conn,
    `SELECT oi.variant_id, oi.quantity, COALESCE(oi.picked, 0) AS picked, COALESCE(oi.sell_as_pack, 0) AS sell_as_pack,
            COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS pack
     FROM order_items oi
     JOIN product_variants pv ON pv.id = oi.variant_id
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN products p ON p.id = pc.product_id
     WHERE oi.order_id = ?`,
    [orderId]
  );
  const out = new Map<string, number>();
  for (const r of rows as any[]) {
    const u = itemUnits(r.quantity, r.picked, !!Number(r.sell_as_pack), r.pack, usePicked);
    const id = String(r.variant_id);
    out.set(id, (out.get(id) ?? 0) + u);
  }
  return out;
}

/** Recalcula y aplica la diferencia. Debe llamarse con el pedido bloqueado. */
async function reconcileLocked(conn: Conn, order: OrderRow, reason: WholesaleStockReason): Promise<number> {
  const stockRows = await q(
    conn,
    `SELECT variant_id, units, frozen_units, returned_units FROM wholesale_order_stock WHERE order_id = ? FOR UPDATE`,
    [order.id]
  );
  const current = new Map<string, number>();
  const returned = new Map<string, number>();
  const frozen = new Map<string, number>();
  for (const r of stockRows as any[]) {
    const id = String(r.variant_id);
    current.set(id, Math.max(0, Number(r.units) || 0));
    returned.set(id, Math.max(0, Number(r.returned_units) || 0));
    if (r.frozen_units != null) frozen.set(id, Math.max(0, Number(r.frozen_units) || 0));
  }

  const active = order.stock_state === 'deducted' && order.status !== 'Cancelado' && !Number(order.no_stock_impact);
  const base = Number(order.stock_frozen) ? frozen : await itemUnitsByVariant(conn, order.id, isPickingDone(order.status));
  const desired = new Map<string, number>();
  if (active) {
    for (const [id, units] of base) desired.set(id, Math.max(0, units - (returned.get(id) ?? 0)));
  }

  // Variantes que ya no existen (borradas): se olvidan, no hay stock al que devolver.
  const allIds = Array.from(new Set([...current.keys(), ...desired.keys()]));
  if (allIds.length) {
    const existing = await q(conn, `SELECT id FROM product_variants WHERE id IN (?)`, [allIds]);
    const alive = new Set((existing as any[]).map((r) => String(r.id)));
    const gone = allIds.filter((id) => !alive.has(id));
    for (const id of gone) {
      current.delete(id);
      desired.delete(id);
    }
    if (gone.length) {
      await conn.query(`DELETE FROM wholesale_order_stock WHERE order_id = ? AND variant_id IN (?)`, [order.id, gone]);
    }
  }

  const deltas = computeWholesaleDeltas(current, desired);
  if (!deltas.length) return 0;

  const entries: LedgerEntry[] = deltas.map((d) => ({
    variantId: d.variantId,
    delta: -d.take,
    type: d.take > 0 ? 'PEDIDO_MAYORISTA' : 'DEVOLUCION',
    reference: d.take > 0 ? `Pedido: ${order.id}` : RESTORE_REFERENCE[reason](order.id),
    source: 'wholesale',
    sourceId: order.id,
    alertIfNegative: d.take > 0 ? `Pedido mayorista sin stock suficiente (pedía ${d.take} u. más).` : null,
  }));
  const applied = await applyEntriesInTx(conn, entries);

  for (let i = 0; i < deltas.length; i++) {
    const d = deltas[i];
    const had = current.get(d.variantId) ?? 0;
    // Si no alcanzaba, queda registrado solo lo que sí se tomó. Al cancelar se devuelve eso, no de más.
    // La próxima vez que se guarde el pedido se intenta tomar el resto, si ya hay stock.
    const held = d.take > 0 ? had + (applied[i]?.deducted ?? 0) : d.desired;
    await conn.query(
      `INSERT INTO wholesale_order_stock (order_id, variant_id, units, returned_units) VALUES (?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE units = VALUES(units)`,
      [order.id, d.variantId, held]
    );
  }
  return deltas.length;
}

/**
 * Llamar SIEMPRE después de guardar un cambio en un pedido (estado, ítems, armado).
 * `previousStatus`: estado anterior; `null` si el pedido se acaba de crear; `undefined` si no cambió el estado.
 */
export async function syncWholesaleOrderStock(
  orderId: string,
  opts: { previousStatus?: string | null } = {}
): Promise<{ changed: number }> {
  return withTransaction(async (conn) => {
    const order = await lockOrder(conn, orderId);
    if (!order) return { changed: 0 };
    const statusChanged = opts.previousStatus !== undefined;
    const entersPickingDone = statusChanged && !isPickingDone(opts.previousStatus) && isPickingDone(order.status);
    if (!order.stock_state && entersPickingDone && !Number(order.no_stock_impact)) {
      await conn.query(`UPDATE orders SET stock_state = 'deducted' WHERE id = ?`, [orderId]);
      order.stock_state = 'deducted';
    }
    const reason: WholesaleStockReason = order.status === 'Cancelado' ? 'cancel' : 'auto';
    return { changed: await reconcileLocked(conn, order, reason) };
  });
}

/** "Descontar stock ahora" (botón manual). */
export async function applyWholesaleStock(orderId: string): Promise<{ changed: number; alreadyApplied: boolean }> {
  return withTransaction(async (conn) => {
    const order = await lockOrder(conn, orderId);
    if (!order) throw new Error('Pedido no encontrado');
    const alreadyApplied = order.stock_state === 'deducted';
    if (!alreadyApplied) {
      await conn.query(`UPDATE orders SET stock_state = 'deducted' WHERE id = ?`, [orderId]);
      order.stock_state = 'deducted';
    }
    return { changed: await reconcileLocked(conn, order, 'manual_apply'), alreadyApplied };
  });
}

/** Devolver al stock todo lo que tomó el pedido, sin cancelarlo (botón manual, NC total o borrado). */
export async function releaseWholesaleStock(
  orderId: string,
  reason: Extract<WholesaleStockReason, 'manual_restore' | 'credit_note' | 'delete' | 'cancel'>
): Promise<{ changed: number; wasDeducted: boolean }> {
  return withTransaction(async (conn) => {
    const order = await lockOrder(conn, orderId);
    if (!order) return { changed: 0, wasDeducted: false };
    const wasDeducted = order.stock_state === 'deducted';
    if (wasDeducted) {
      await conn.query(`UPDATE orders SET stock_state = 'released' WHERE id = ?`, [orderId]);
      order.stock_state = 'released';
    }
    return { changed: await reconcileLocked(conn, order, reason), wasDeducted };
  });
}

/**
 * Nota de crédito parcial: devuelve unidades de un ítem.
 * Solo devuelve si el pedido realmente había descontado (antes devolvía igual y "inventaba" stock).
 */
export async function returnWholesaleUnits(
  orderId: string,
  variantId: string,
  units: number
): Promise<{ returned: number }> {
  const want = Math.max(0, Math.floor(Number(units) || 0));
  if (!want) return { returned: 0 };
  return withTransaction(async (conn) => {
    const order = await lockOrder(conn, orderId);
    if (!order || order.stock_state !== 'deducted') return { returned: 0 };
    const row = await q1(
      conn,
      `SELECT units, returned_units FROM wholesale_order_stock WHERE order_id = ? AND variant_id = ? FOR UPDATE`,
      [orderId, variantId]
    );
    const taken = Math.max(0, Number(row?.units) || 0);
    const give = Math.min(want, taken);
    if (!give) return { returned: 0 };
    const alive = await q1(conn, `SELECT id FROM product_variants WHERE id = ?`, [variantId]);
    if (!alive) return { returned: 0 };
    // Se devuelve directo, sin recalcular el pedido: si el pedido había quedado corto de stock,
    // recalcular acá intentaba tomar lo que faltaba y la nota de crédito terminaba DESCONTANDO stock.
    await applyEntriesInTx(conn, [
      {
        variantId,
        delta: give,
        type: 'DEVOLUCION',
        reference: RESTORE_REFERENCE.credit_note(orderId),
        source: 'wholesale',
        sourceId: orderId,
      },
    ]);
    await conn.query(
      `UPDATE wholesale_order_stock SET units = units - ?, returned_units = returned_units + ? WHERE order_id = ? AND variant_id = ?`,
      [give, give, orderId, variantId]
    );
    return { returned: give };
  });
}

export async function wholesaleStockState(orderId: string): Promise<'deducted' | 'released' | null> {
  return withTransaction(async (conn) => {
    const r = await q1(conn, `SELECT stock_state FROM orders WHERE id = ?`, [orderId]);
    const st = r?.stock_state;
    return st === 'deducted' || st === 'released' ? st : null;
  });
}

/**
 * Al fusionar dos variantes duplicadas: pasar a la variante que queda lo que pedidos y ventas tenían tomado.
 * El stock ya se sumó aparte, así que acá solo se mueven los registros (sin mover stock).
 */
export async function moveVariantStockRecords(fromVariantId: string, toVariantId: string): Promise<void> {
  if (!fromVariantId || !toVariantId || fromVariantId === toVariantId) return;
  await withTransaction(async (conn) => {
    const rows = await q(
      conn,
      `SELECT order_id, units, frozen_units, returned_units FROM wholesale_order_stock WHERE variant_id = ? FOR UPDATE`,
      [fromVariantId]
    );
    for (const r of rows as any[]) {
      await conn.query(
        `INSERT INTO wholesale_order_stock (order_id, variant_id, units, frozen_units, returned_units)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           units = units + VALUES(units),
           returned_units = returned_units + VALUES(returned_units),
           frozen_units = CASE WHEN frozen_units IS NULL AND VALUES(frozen_units) IS NULL THEN NULL
                               ELSE COALESCE(frozen_units, 0) + COALESCE(VALUES(frozen_units), 0) END`,
        [r.order_id, toVariantId, Number(r.units) || 0, r.frozen_units, Number(r.returned_units) || 0]
      );
    }
    await conn.query(`DELETE FROM wholesale_order_stock WHERE variant_id = ?`, [fromVariantId]);
    await conn.query(`UPDATE channel_order_lines SET variant_id = ? WHERE variant_id = ?`, [toVariantId, fromVariantId]);
    await conn.query(`DELETE FROM stock_sync_queue WHERE variant_id = ?`, [fromVariantId]);
    await conn.query(`DELETE FROM stock_sync_targets WHERE variant_id = ?`, [fromVariantId]);
  });
}

/** Al borrar un pedido: limpiar su registro (el stock ya se devolvió con releaseWholesaleStock). */
export async function forgetWholesaleOrder(orderId: string): Promise<void> {
  await withTransaction(async (conn) => {
    await conn.query(`DELETE FROM wholesale_order_stock WHERE order_id = ?`, [orderId]);
  });
}
