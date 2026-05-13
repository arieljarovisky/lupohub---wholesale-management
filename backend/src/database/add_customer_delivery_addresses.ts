import { query, execute } from './db';

/** Direcciones adicionales de entrega / sucursales (JSON en customers.delivery_addresses). */
export async function addCustomerDeliveryAddresses(): Promise<void> {
  try {
    const rows = await query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'delivery_addresses'`
    );
    if (Array.isArray(rows) && rows.length > 0) return;
    await execute(
      `ALTER TABLE customers ADD COLUMN delivery_addresses TEXT NULL COMMENT 'JSON: sucursales [{id,label,address,city}]'`
    );
    console.log('[DB] customers.delivery_addresses agregada');
  } catch (e: any) {
    console.error('[DB] Error en addCustomerDeliveryAddresses:', e?.message);
  }
}
