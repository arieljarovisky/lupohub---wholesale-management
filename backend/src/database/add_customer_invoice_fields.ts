import { execute, get } from './db';

/** Campos comerciales del cliente para imprimir en factura. */
export async function addCustomerInvoiceFields(): Promise<void> {
  console.log('[DB] Verificando columnas comerciales de customers...');
  try {
    const cols = [
      { name: 'transport_number', sql: `ALTER TABLE customers ADD COLUMN transport_number VARCHAR(120) NULL AFTER phone` },
      { name: 'remito_number', sql: `ALTER TABLE customers ADD COLUMN remito_number VARCHAR(120) NULL AFTER transport_number` },
      { name: 'sale_condition', sql: `ALTER TABLE customers ADD COLUMN sale_condition VARCHAR(120) NULL AFTER remito_number` },
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
    console.error('[DB] Error agregando columnas comerciales en customers:', e?.message);
  }
}

