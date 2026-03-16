import { execute, get } from './db';

/** Agrega teléfono y condición de IVA a clientes. */
export async function addCustomerPhoneIva(): Promise<void> {
  console.log('[DB] Verificando columnas phone y condicion_iva en customers...');
  try {
    const phoneCol = await get(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'phone'`
    );
    if (!phoneCol) {
      await execute(`ALTER TABLE customers ADD COLUMN phone VARCHAR(50) NULL AFTER cuit`);
      console.log('[DB] Columna phone agregada a customers');
    }
    const ivaCol = await get(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'condicion_iva'`
    );
    if (!ivaCol) {
      await execute(`ALTER TABLE customers ADD COLUMN condicion_iva VARCHAR(100) NULL AFTER phone`);
      console.log('[DB] Columna condicion_iva agregada a customers');
    }
  } catch (e: any) {
    console.error('[DB] Error agregando phone/condicion_iva a customers:', e?.message);
  }
}
