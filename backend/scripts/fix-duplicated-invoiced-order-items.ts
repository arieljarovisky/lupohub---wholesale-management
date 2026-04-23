/**
 * Corrige líneas duplicadas idénticas en pedidos que ya tienen factura.
 *
 * Duplicado idéntico = mismo order_id + variant_id + despacho_id + quantity + picked + price_at_moment + sell_as_pack.
 * Mantiene 1 fila y elimina solo las repetidas extra.
 *
 * Uso:
 *   # Diagnóstico (sin borrar)
 *   NODE_ENV=production npx ts-node scripts/fix-duplicated-invoiced-order-items.ts
 *
 *   # Aplicar cambios
 *   NODE_ENV=production npx ts-node scripts/fix-duplicated-invoiced-order-items.ts --apply
 *
 *   # Limitar a un pedido
 *   NODE_ENV=production npx ts-node scripts/fix-duplicated-invoiced-order-items.ts --order-id O-123456 --apply
 */
import pool, { execute, query } from '../src/database/db';

type DupRow = {
  order_id: string;
  variant_id: string;
  despacho_key: string;
  quantity: number;
  picked_key: number;
  price_key: number;
  sell_as_pack_key: number;
  cnt: number;
  ids: string;
};

function parseArgValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

async function main() {
  const apply = process.argv.includes('--apply');
  const orderId = parseArgValue('--order-id');

  const where = ['1=1'];
  const params: any[] = [];
  if (orderId) {
    where.push('oi.order_id = ?');
    params.push(orderId);
  }

  const rows = (await query(
    `
    SELECT
      oi.order_id,
      oi.variant_id,
      COALESCE(oi.despacho_id, '') AS despacho_key,
      oi.quantity,
      COALESCE(oi.picked, 0) AS picked_key,
      CAST(oi.price_at_moment AS DECIMAL(14,4)) AS price_key,
      COALESCE(oi.sell_as_pack, 0) AS sell_as_pack_key,
      COUNT(*) AS cnt,
      GROUP_CONCAT(oi.id ORDER BY oi.id SEPARATOR ',') AS ids
    FROM order_items oi
    JOIN invoices inv ON inv.order_id = oi.order_id
    WHERE ${where.join(' AND ')}
    GROUP BY
      oi.order_id,
      oi.variant_id,
      COALESCE(oi.despacho_id, ''),
      oi.quantity,
      COALESCE(oi.picked, 0),
      CAST(oi.price_at_moment AS DECIMAL(14,4)),
      COALESCE(oi.sell_as_pack, 0)
    HAVING COUNT(*) > 1
    ORDER BY oi.order_id ASC
    `
    ,
    params
  )) as DupRow[];

  let duplicateGroups = 0;
  let deletedRows = 0;
  const affectedByOrder = new Map<string, number>();

  for (const r of rows) {
    duplicateGroups++;
    const ids = String(r.ids || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    if (ids.length <= 1) continue;
    const toDelete = ids.slice(1);
    if (toDelete.length === 0) continue;

    affectedByOrder.set(r.order_id, (affectedByOrder.get(r.order_id) || 0) + toDelete.length);

    if (apply) {
      const placeholders = toDelete.map(() => '?').join(',');
      const result = await execute(`DELETE FROM order_items WHERE id IN (${placeholders})`, toDelete);
      deletedRows += Number((result as any)?.affectedRows || 0);
    } else {
      deletedRows += toDelete.length;
    }
  }

  const topOrders = Array.from(affectedByOrder.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  console.log('---------------------------------------');
  console.log(`Modo: ${apply ? 'APPLY (corrigiendo)' : 'DRY RUN (sin cambios)'}`);
  console.log(`Filtro pedido: ${orderId || '(todos los pedidos facturados)'}`);
  console.log(`Grupos duplicados detectados: ${duplicateGroups}`);
  console.log(`${apply ? 'Filas eliminadas' : 'Filas a eliminar'}: ${deletedRows}`);
  console.log(`Pedidos afectados: ${affectedByOrder.size}`);
  if (topOrders.length > 0) {
    console.log('Top pedidos afectados:');
    for (const [o, n] of topOrders) {
      console.log(`- ${o}: ${n}`);
    }
  }
}

main()
  .catch((e) => {
    console.error('[fix-duplicated-invoiced-order-items] Error:', e?.message || e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

