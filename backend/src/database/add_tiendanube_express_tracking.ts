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
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_tn_express_tracking_code (tracking_code),
          INDEX idx_tn_express_tracking_created (created_at)
        )
      `);
      console.log('[DB] Tabla tiendanube_express_tracking creada');
    }
  } catch (e: any) {
    console.error('[DB] Error creando tablas tiendanube_express_tracking:', e?.message);
  }
}
