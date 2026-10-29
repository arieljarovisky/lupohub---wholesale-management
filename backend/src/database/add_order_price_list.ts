import { execute, get, query } from './db';

/** Una lista cuenta como la facturada si al menos este porcentaje de líneas tiene el mismo precio. */
const INVOICED_LIST_MATCH_RATIO = 0.75;

/**
 * Lista de precios con la que se armó y facturó el pedido.
 * Guarda id y el nombre en ese momento, para que un cambio posterior del cliente no reescriba el historial.
 */
export async function addOrderPriceList(): Promise<void> {
  console.log('[DB] Verificando lista de precios en orders...');
  try {
    const idCol = await get(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'price_list_id'`
    );
    if (!idCol) {
      await execute(`ALTER TABLE orders ADD COLUMN price_list_id VARCHAR(36) NULL`);
      console.log('[DB] Columna orders.price_list_id agregada');
    }
    const nameCol = await get(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'price_list_name'`
    );
    if (!nameCol) {
      await execute(`ALTER TABLE orders ADD COLUMN price_list_name VARCHAR(120) NULL`);
      console.log('[DB] Columna orders.price_list_name agregada');
    }
    await repairOrderPriceListsFromInvoicedPrices();
  } catch (e: any) {
    console.error('[DB] Error en add_order_price_list:', e?.message);
  }
}

/**
 * La carga inicial copió la lista actual del cliente a todos los pedidos viejos.
 * Acá se corrige: se queda la lista cuyos precios coinciden con `price_at_moment` (lo facturado).
 * Si la lista guardada ya coincide, no se toca.
 */
export async function repairOrderPriceListsFromInvoicedPrices(): Promise<void> {
  const anyList = await get(`SELECT id FROM price_lists LIMIT 1`);
  if (!anyList) return;

  const scored = (await query(
    `SELECT o.id AS order_id,
            o.price_list_id AS stored_id,
            pl.id AS list_id,
            pl.name AS list_name,
            pl.created_at AS list_created,
            COUNT(*) AS lines,
            SUM(CASE
              WHEN pli.price IS NOT NULL AND ABS(oi.price_at_moment - pli.price) < 0.02 THEN 1
              ELSE 0
            END) AS hits
     FROM orders o
     INNER JOIN order_items oi ON oi.order_id = o.id AND oi.price_at_moment > 0
     INNER JOIN product_variants pv ON pv.id = oi.variant_id
     INNER JOIN product_colors pc ON pc.id = pv.product_color_id
     CROSS JOIN price_lists pl
     LEFT JOIN price_list_items pli
       ON pli.price_list_id = pl.id AND pli.product_id = pc.product_id
     GROUP BY o.id, o.price_list_id, pl.id, pl.name, pl.created_at`
  )) as Array<{
    order_id: string;
    stored_id: string | null;
    list_id: string;
    list_name: string;
    list_created: Date | string | null;
    lines: number | string;
    hits: number | string;
  }>;

  const baseRows = (await query(
    `SELECT o.id AS order_id,
            COUNT(*) AS lines,
            SUM(CASE WHEN ABS(oi.price_at_moment - p.base_price) < 0.02 THEN 1 ELSE 0 END) AS hits
     FROM orders o
     INNER JOIN order_items oi ON oi.order_id = o.id AND oi.price_at_moment > 0
     INNER JOIN product_variants pv ON pv.id = oi.variant_id
     INNER JOIN product_colors pc ON pc.id = pv.product_color_id
     INNER JOIN products p ON p.id = pc.product_id
     GROUP BY o.id`
  )) as Array<{ order_id: string; lines: number | string; hits: number | string }>;
  const baseByOrder = new Map(baseRows.map((r) => [String(r.order_id), r]));

  type Best = { id: string; name: string; hits: number; created: number };
  type Acc = { storedId: string | null; lines: number; storedHits: number; best: Best | null };
  const byOrder = new Map<string, Acc>();

  for (const row of scored) {
    const lines = Number(row.lines) || 0;
    const hits = Number(row.hits) || 0;
    if (lines <= 0) continue;
    const orderId = String(row.order_id);
    let acc = byOrder.get(orderId);
    if (!acc) {
      const storedRaw = row.stored_id != null ? String(row.stored_id).trim() : '';
      acc = { storedId: storedRaw || null, lines, storedHits: 0, best: null };
      byOrder.set(orderId, acc);
    }
    if (acc.storedId && String(row.list_id) === acc.storedId) acc.storedHits = hits;
    if (hits <= 0 || hits / lines < INVOICED_LIST_MATCH_RATIO) continue;
    const created = row.list_created ? new Date(row.list_created).getTime() : Number.MAX_SAFE_INTEGER;
    const candidate: Best = {
      id: String(row.list_id),
      name: String(row.list_name || '').trim(),
      hits,
      created: Number.isFinite(created) ? created : Number.MAX_SAFE_INTEGER,
    };
    if (
      !acc.best ||
      candidate.hits > acc.best.hits ||
      (candidate.hits === acc.best.hits && candidate.created < acc.best.created)
    ) {
      acc.best = candidate;
    }
  }

  let reassigned = 0;
  let cleared = 0;
  for (const [orderId, acc] of byOrder) {
    const storedRatio = acc.lines > 0 ? acc.storedHits / acc.lines : 0;
    if (storedRatio >= INVOICED_LIST_MATCH_RATIO) continue;

    if (acc.best && acc.best.id !== acc.storedId) {
      await execute(`UPDATE orders SET price_list_id = ?, price_list_name = ? WHERE id = ?`, [
        acc.best.id,
        acc.best.name.slice(0, 120) || null,
        orderId,
      ]);
      reassigned++;
      continue;
    }

    const base = baseByOrder.get(orderId);
    const baseLines = Number(base?.lines) || 0;
    const baseRatio = baseLines > 0 ? Number(base?.hits || 0) / baseLines : 0;
    if (acc.storedId && !acc.best && baseRatio >= INVOICED_LIST_MATCH_RATIO) {
      await execute(`UPDATE orders SET price_list_id = NULL, price_list_name = NULL WHERE id = ?`, [orderId]);
      cleared++;
    }
  }

  if (reassigned || cleared) {
    console.log(
      `[DB] Listas de pedidos alineadas a lo facturado: ${reassigned} reasignadas, ${cleared} pasaron a precio base`
    );
  } else {
    console.log('[DB] Listas de pedidos: coinciden con los precios facturados');
  }
}
