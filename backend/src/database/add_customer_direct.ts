import { execute, get } from './db';

/** Agrega user_id a customers (cliente directo) y permite seller_id NULL en orders. */
export async function addCustomerDirect(): Promise<void> {
  console.log('[DB] Verificando soporte cliente directo...');
  try {
    const col = await get(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'user_id'`
    );
    if (!col) {
      await execute(`ALTER TABLE customers ADD COLUMN user_id VARCHAR(36) NULL UNIQUE AFTER seller_id`);
      console.log('[DB] Columna user_id agregada a customers');
    } else {
      console.log('[DB] Columna user_id ya existe en customers');
    }
  } catch (e: any) {
    console.error('[DB] Error agregando user_id a customers:', e?.message);
  }

  try {
    await execute(`ALTER TABLE orders MODIFY COLUMN seller_id VARCHAR(36) NULL`);
    console.log('[DB] orders.seller_id permite NULL (pedido directo)');
  } catch (e: any) {
    if (e?.code !== 'ER_BAD_FIELD_ERROR') console.error('[DB] Error modificando orders.seller_id:', e?.message);
  }
}
