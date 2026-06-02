/**
 * Saldo inicial manual por cliente (arranque de cuenta corriente en LupoHub).
 */
import { query, execute } from './db';

export async function addCustomerOpeningBalance(): Promise<void> {
  const cols = await query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers'
       AND COLUMN_NAME IN ('opening_balance', 'opening_balance_date')`
  );
  const existing = new Set((cols as { COLUMN_NAME: string }[]).map((c) => c.COLUMN_NAME));
  if (!existing.has('opening_balance')) {
    await execute(
      `ALTER TABLE customers ADD COLUMN opening_balance DECIMAL(16, 2) NULL DEFAULT NULL`
    );
    console.log('[DB] Columna customers.opening_balance agregada');
  }
  if (!existing.has('opening_balance_date')) {
    await execute(
      `ALTER TABLE customers ADD COLUMN opening_balance_date DATE NULL DEFAULT NULL`
    );
    console.log('[DB] Columna customers.opening_balance_date agregada');
  }
  if (existing.has('opening_balance') && existing.has('opening_balance_date')) {
    console.log('[DB] Columnas opening_balance ya existen en customers');
  }
}
