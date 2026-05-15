import { execute, get } from './db';

/** Etiqueta opcional (p. ej. import matriz: a facturar vs pendiente según color de celda). */
export async function addOrderMatrixImportLabel(): Promise<void> {
  console.log('[DB] Verificando columna matrix_import_label en orders...');
  try {
    const col = await get(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'matrix_import_label'`
    );
    if (col) {
      console.log('[DB] Columna orders.matrix_import_label ya existe');
      return;
    }
    await execute(`ALTER TABLE orders ADD COLUMN matrix_import_label VARCHAR(120) NULL`);
    console.log('[DB] Columna orders.matrix_import_label agregada');
  } catch (e: any) {
    console.error('[DB] Error agregando orders.matrix_import_label:', e?.message);
  }
}
