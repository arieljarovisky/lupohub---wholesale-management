import { execute, get } from './db';

/** Pedidos sin factura que el usuario marca para sumar al saldo pendiente del cliente. */
export async function addIncludeInSaldoToOrders(): Promise<void> {
  try {
    const row = await get(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'orders'
         AND COLUMN_NAME = 'include_in_saldo'`
    );
    const exists = Number((row as any)?.cnt || 0) > 0;
    if (exists) return;

    await execute(
      `ALTER TABLE orders
       ADD COLUMN include_in_saldo TINYINT(1) NOT NULL DEFAULT 0
       AFTER no_stock_impact`
    );
    console.log('[DB] Columna orders.include_in_saldo agregada');
  } catch (e: any) {
    console.error('[DB] addIncludeInSaldoToOrders:', e?.message || e);
  }
}
