import { execute, get } from './db';

/** Agrega CUIT/CUIL a clientes para facturación (Argentina). */
export async function addCustomerCuit(): Promise<void> {
  console.log('[DB] Verificando columna CUIT en customers...');
  try {
    const col = await get(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'cuit'`
    );
    if (!col) {
      await execute(`ALTER TABLE customers ADD COLUMN cuit VARCHAR(20) NULL AFTER city`);
      console.log('[DB] Columna cuit agregada a customers (para facturación)');
    } else {
      console.log('[DB] Columna cuit ya existe en customers');
    }
  } catch (e: any) {
    console.error('[DB] Error agregando cuit a customers:', e?.message);
  }
}
