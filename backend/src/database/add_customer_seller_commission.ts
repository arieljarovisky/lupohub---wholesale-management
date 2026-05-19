/**
 * Comisión del vendedor por cliente (%). Si es NULL, se usa users.commission_percentage del vendedor asignado.
 */
import { query, execute } from './db';

export async function addCustomerSellerCommission(): Promise<void> {
  const col = await query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'seller_commission_percentage'`
  );
  if (Array.isArray(col) && col.length > 0) {
    console.log('[DB] Columna seller_commission_percentage ya existe en customers');
    return;
  }
  await execute(
    `ALTER TABLE customers ADD COLUMN seller_commission_percentage DECIMAL(5,2) NULL AFTER seller_id`
  );
  console.log('[DB] Columna seller_commission_percentage agregada a customers');
}
