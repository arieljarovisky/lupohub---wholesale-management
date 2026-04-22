import { execute, get } from './db';

/** Agrega campos para padrón mensual de percepción IIBB por cliente (RetPer). */
export async function addCustomerIibbPadronFields(): Promise<void> {
  console.log('[DB] Verificando campos IIBB en customers...');
  try {
    const columns = [
      {
        name: 'iibb_perception_rate',
        sql: `ALTER TABLE customers ADD COLUMN iibb_perception_rate DECIMAL(7,4) NULL`,
      },
      {
        name: 'iibb_padron_period',
        sql: `ALTER TABLE customers ADD COLUMN iibb_padron_period VARCHAR(6) NULL`,
      },
      {
        name: 'iibb_padron_source',
        sql: `ALTER TABLE customers ADD COLUMN iibb_padron_source VARCHAR(255) NULL`,
      },
      {
        name: 'iibb_padron_updated_at',
        sql: `ALTER TABLE customers ADD COLUMN iibb_padron_updated_at DATETIME NULL`,
      },
    ];

    for (const c of columns) {
      const exists = await get(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'customers'
           AND COLUMN_NAME = ?`,
        [c.name]
      );
      if (!exists) {
        await execute(c.sql);
        console.log(`[DB] customers.${c.name} agregada`);
      }
    }
  } catch (e: any) {
    console.error('[DB] Error agregando campos IIBB en customers:', e?.message || e);
  }
}
