import { execute, get } from './db';

/**
 * Crea la tabla `remito_sequence` (contador atómico para numerar remitos) y agrega
 * la columna `orders.remito_number` (INT UNIQUE) que guarda el número asignado a cada pedido.
 *
 * La secuencia arranca en 31457 según requerimiento operativo del negocio.
 * El campo en `orders` es UNIQUE para garantizar que dos pedidos no puedan compartir el mismo número.
 */
export async function addRemitoSequence(): Promise<void> {
  const START_VALUE = 31457;
  console.log('[DB] Verificando tabla remito_sequence y columna orders.remito_number...');
  try {
    const tableExists = await get(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'remito_sequence'`
    );
    if (!tableExists) {
      await execute(`
        CREATE TABLE remito_sequence (
          id TINYINT NOT NULL PRIMARY KEY,
          next_value INT NOT NULL,
          CHECK (id = 1)
        )
      `);
      await execute(
        `INSERT INTO remito_sequence (id, next_value) VALUES (1, ?)
         ON DUPLICATE KEY UPDATE next_value = next_value`,
        [START_VALUE]
      );
      console.log(`[DB] remito_sequence creada, next_value=${START_VALUE}`);
    } else {
      // Asegurar que exista la fila (id=1). Si no existe, insertarla.
      const row = await get(`SELECT next_value FROM remito_sequence WHERE id = 1`);
      if (!row) {
        await execute(`INSERT INTO remito_sequence (id, next_value) VALUES (1, ?)`, [START_VALUE]);
        console.log(`[DB] remito_sequence row id=1 creada con next_value=${START_VALUE}`);
      }
    }

    const colExists = await get(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'remito_number'`
    );
    if (!colExists) {
      await execute(`ALTER TABLE orders ADD COLUMN remito_number INT NULL`);
      await execute(`ALTER TABLE orders ADD UNIQUE KEY uniq_orders_remito_number (remito_number)`);
      console.log('[DB] orders.remito_number agregada (UNIQUE)');
    } else {
      const uniqueExists = await get(
        `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND CONSTRAINT_NAME = 'uniq_orders_remito_number'`
      );
      if (!uniqueExists) {
        try {
          await execute(`ALTER TABLE orders ADD UNIQUE KEY uniq_orders_remito_number (remito_number)`);
          console.log('[DB] orders.remito_number UNIQUE agregado');
        } catch (e: any) {
          console.error('[DB] No se pudo agregar UNIQUE a orders.remito_number (¿hay duplicados?):', e?.message);
        }
      }
    }
  } catch (e: any) {
    console.error('[DB] Error creando/verificando remito_sequence:', e?.message);
  }
}
