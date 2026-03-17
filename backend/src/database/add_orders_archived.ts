import { execute, get } from './db';

export async function addOrdersArchived(): Promise<void> {
  console.log('[DB] Verificando columna archived en orders...');
  try {
    const col = await get(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'archived'`
    );
    if (col) {
      console.log('[DB] Columna orders.archived ya existe');
      return;
    }
    await execute(`ALTER TABLE orders ADD COLUMN archived TINYINT(1) NOT NULL DEFAULT 0 AFTER dispatched_at`);
    console.log('[DB] Columna orders.archived agregada');
  } catch (e: any) {
    console.error('[DB] Error agregando orders.archived:', e?.message);
  }
}
