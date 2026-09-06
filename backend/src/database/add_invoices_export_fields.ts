import { execute, get } from './db';

/** Metadatos de factura de exportación (Factura E) en invoices. */
export async function addInvoicesExportFields(): Promise<void> {
  console.log('[DB] Verificando columnas de exportación en invoices...');
  try {
    const cols = [
      { name: 'moneda_id', sql: `ALTER TABLE invoices ADD COLUMN moneda_id VARCHAR(5) NULL AFTER agip_ret_per` },
      { name: 'moneda_ctz', sql: `ALTER TABLE invoices ADD COLUMN moneda_ctz DECIMAL(14,4) NULL AFTER moneda_id` },
      { name: 'export_dst_cmp', sql: `ALTER TABLE invoices ADD COLUMN export_dst_cmp INT NULL AFTER moneda_ctz` },
      { name: 'export_incoterms', sql: `ALTER TABLE invoices ADD COLUMN export_incoterms VARCHAR(10) NULL AFTER export_dst_cmp` },
      { name: 'export_tipo_expo', sql: `ALTER TABLE invoices ADD COLUMN export_tipo_expo TINYINT NULL AFTER export_incoterms` }
    ];
    for (const c of cols) {
      const exists = await get(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices' AND COLUMN_NAME = ?`,
        [c.name]
      );
      if (!exists) {
        await execute(c.sql);
        console.log(`[DB] invoices.${c.name} agregada`);
      }
    }
  } catch (e: any) {
    console.error('[DB] Error agregando columnas export en invoices:', e?.message);
  }
}
