import { execute, get } from './db';

/** Estado de cobro del pedido mayorista (cuenta corriente / saldos pendientes). */
export async function addPaymentStatusToOrders(): Promise<void> {
  console.log('[DB] Verificando columna payment_status en orders...');
  try {
    const col = await get(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'payment_status'`
    );
    if (col) {
      console.log('[DB] orders.payment_status ya existe');
      return;
    }
    await execute(
      `ALTER TABLE orders ADD COLUMN payment_status VARCHAR(20) NOT NULL DEFAULT 'pendiente' AFTER total`
    );
    await execute(`UPDATE orders SET payment_status = 'pagado'`);
    console.log('[DB] orders.payment_status agregada; pedidos existentes marcados como pagados');
  } catch (e: any) {
    console.error('[DB] Error agregando orders.payment_status:', e?.message);
  }
}
