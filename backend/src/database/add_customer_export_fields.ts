import { execute, get } from './db';

/** Campos de cliente para facturación de exportación (Factura E / WSFEX). */
export async function addCustomerExportFields(): Promise<void> {
  console.log('[DB] Verificando columnas de exportación en customers...');
  try {
    const cols = [
      {
        name: 'is_export_client',
        sql: `ALTER TABLE customers ADD COLUMN is_export_client TINYINT(1) NOT NULL DEFAULT 0 AFTER condicion_iva`
      },
      {
        name: 'export_dst_cmp',
        sql: `ALTER TABLE customers ADD COLUMN export_dst_cmp INT NULL AFTER is_export_client`
      },
      {
        name: 'export_country_name',
        sql: `ALTER TABLE customers ADD COLUMN export_country_name VARCHAR(120) NULL AFTER export_dst_cmp`
      },
      {
        name: 'foreign_tax_id',
        sql: `ALTER TABLE customers ADD COLUMN foreign_tax_id VARCHAR(80) NULL AFTER export_country_name`
      },
      {
        name: 'export_cuit_pais_cliente',
        sql: `ALTER TABLE customers ADD COLUMN export_cuit_pais_cliente BIGINT NULL AFTER foreign_tax_id`
      }
    ];
    for (const c of cols) {
      const exists = await get(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = ?`,
        [c.name]
      );
      if (!exists) {
        await execute(c.sql);
        console.log(`[DB] customers.${c.name} agregada`);
      }
    }
  } catch (e: any) {
    console.error('[DB] Error agregando columnas export en customers:', e?.message);
  }
}
