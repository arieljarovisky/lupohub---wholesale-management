import { execute, get } from './db';

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
    // Solo al crear la columna: los pedidos viejos heredan la lista actual del cliente.
    if (!idCol) {
      await execute(
        `UPDATE orders o
         INNER JOIN customers c ON c.id = o.customer_id
         INNER JOIN price_lists pl ON pl.id = c.price_list_id
         SET o.price_list_id = c.price_list_id,
             o.price_list_name = LEFT(pl.name, 120)
         WHERE o.price_list_id IS NULL
           AND c.price_list_id IS NOT NULL
           AND TRIM(c.price_list_id) <> ''`
      );
      console.log('[DB] Pedidos existentes actualizados con la lista de precios del cliente');
    }
  } catch (e: any) {
    console.error('[DB] Error en add_order_price_list:', e?.message);
  }
}
