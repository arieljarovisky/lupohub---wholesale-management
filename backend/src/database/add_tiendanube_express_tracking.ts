import { execute, get } from './db';

/**
 * Seguimiento de envíos express de Tienda Nube.
 * Cada orden TN express recibe un código único (ej. LHE100001) al generar etiqueta/recibo.
 */
export async function addTiendaNubeExpressTracking(): Promise<void> {
  const START_VALUE = 100001;
  console.log('[DB] Verificando tablas tiendanube_express_tracking...');
  try {
    const seqExists = await get(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tiendanube_express_tracking_sequence'`
    );
    if (!seqExists) {
      await execute(`
        CREATE TABLE tiendanube_express_tracking_sequence (
          id TINYINT NOT NULL PRIMARY KEY,
          next_value INT NOT NULL,
          CHECK (id = 1)
        )
      `);
      await execute(
        `INSERT INTO tiendanube_express_tracking_sequence (id, next_value) VALUES (1, ?)`,
        [START_VALUE]
      );
      console.log(`[DB] tiendanube_express_tracking_sequence creada, next_value=${START_VALUE}`);
    } else {
      const row = await get(`SELECT next_value FROM tiendanube_express_tracking_sequence WHERE id = 1`);
      if (!row) {
        await execute(
          `INSERT INTO tiendanube_express_tracking_sequence (id, next_value) VALUES (1, ?)`,
          [START_VALUE]
        );
      }
    }

    const tableExists = await get(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tiendanube_express_tracking'`
    );
    if (!tableExists) {
      await execute(`
        CREATE TABLE tiendanube_express_tracking (
          external_order_id VARCHAR(80) NOT NULL PRIMARY KEY,
          order_number VARCHAR(40) NULL,
          tracking_code VARCHAR(40) NOT NULL,
          manual_status VARCHAR(24) NULL,
          manual_status_updated_at DATETIME NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_tn_express_tracking_code (tracking_code),
          INDEX idx_tn_express_tracking_created (created_at)
        )
      `);
      console.log('[DB] Tabla tiendanube_express_tracking creada');
    } else {
      const cols = [
        {
          name: 'manual_status',
          sql: `ALTER TABLE tiendanube_express_tracking ADD COLUMN manual_status VARCHAR(24) NULL AFTER tracking_code`,
        },
        {
          name: 'manual_status_updated_at',
          sql: `ALTER TABLE tiendanube_express_tracking ADD COLUMN manual_status_updated_at DATETIME NULL AFTER manual_status`,
        },
      ];
      for (const c of cols) {
        const col = await get(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tiendanube_express_tracking' AND COLUMN_NAME = ?`,
          [c.name]
        );
        if (!col) await execute(c.sql);
      }
      await execute(
        `UPDATE tiendanube_express_tracking
         SET manual_status = 'preparing', manual_status_updated_at = COALESCE(manual_status_updated_at, created_at, NOW())
         WHERE manual_status IS NULL OR manual_status = ''`
      );
    }
  } catch (e: any) {
    console.error('[DB] Error creando tablas tiendanube_express_tracking:', e?.message);
  }
}
