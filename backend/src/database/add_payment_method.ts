import { execute, get } from './db';

/** Medio de cobro del recibo (cargo banco): transferencia | echeq | efectivo | deposito. */
export async function addPaymentMethodColumn(): Promise<void> {
  console.log('[DB] Verificando columna payment_method en payments...');
  try {
    const col = await get(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND COLUMN_NAME = 'payment_method'`
    );
    if (col) {
      console.log('[DB] Columna payments.payment_method ya existe');
      return;
    }
    await execute(`ALTER TABLE payments ADD COLUMN payment_method VARCHAR(30) NULL`);
    console.log('[DB] Columna payments.payment_method agregada');
  } catch (e: any) {
    console.error('[DB] Error agregando payments.payment_method:', e?.message);
  }
}
