import { execute, get } from './db';

/** Agrega referencia opcional (nota/identificador) en pedidos. */
export async function addOrderReferenceToOrders(): Promise<void> {
  try {
    const row = await get(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'orders'
         AND COLUMN_NAME = 'reference'`
    );
    const exists = Number((row as any)?.cnt || 0) > 0;
    if (exists) return;

    await execute(
      `ALTER TABLE orders
       ADD COLUMN reference VARCHAR(255) NULL
       AFTER total`
    );
    console.log('[DB] Columna orders.reference agregada');
  } catch (e: any) {
    console.error('[DB] addOrderReferenceToOrders:', e?.message || e);
  }
}
