import { execute, get } from './db';

/** Nota libre del pedido (sucursal, referencia interna, etc.). */
export async function addOrderNotes(): Promise<void> {
  console.log('[DB] Verificando columna notes en orders...');
  try {
    const col = await get(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'notes'`
    );
    if (col) {
      console.log('[DB] Columna orders.notes ya existe');
      return;
    }
    await execute(`ALTER TABLE orders ADD COLUMN notes VARCHAR(200) NULL`);
    console.log('[DB] Columna orders.notes agregada');
  } catch (e: any) {
    console.error('[DB] Error agregando orders.notes:', e?.message);
  }
}
