import { execute, get } from './db';

/** Quién creó el pedido (usuario de la sesión). Pedidos viejos quedan NULL. */
export async function addOrderCreatedBy(): Promise<void> {
  console.log('[DB] Verificando columna created_by en orders...');
  try {
    const col = await get(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'created_by'`
    );
    if (col) {
      console.log('[DB] Columna orders.created_by ya existe');
      return;
    }
    await execute(
      `ALTER TABLE orders ADD COLUMN created_by VARCHAR(36) NULL DEFAULT NULL AFTER picked_by`
    );
    try {
      await execute(
        `ALTER TABLE orders ADD CONSTRAINT fk_orders_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL`
      );
    } catch (e: any) {
      if (e?.code !== 'ER_DUP_KEYNAME' && e?.errno !== 1022) {
        console.warn('[DB] FK created_by (opcional):', e?.message);
      }
    }
    console.log('[DB] Columna orders.created_by agregada');
  } catch (e: any) {
    console.error('[DB] Error agregando orders.created_by:', e?.message);
  }
}
