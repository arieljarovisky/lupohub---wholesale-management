import { execute, get } from './db';

/** Permite marcar pedidos que no deben impactar stock (p/ facturar sin movimiento de inventario). */
export async function addNoStockImpactToOrders(): Promise<void> {
  try {
    const row = await get(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'orders'
         AND COLUMN_NAME = 'no_stock_impact'`
    );
    const exists = Number((row as any)?.cnt || 0) > 0;
    if (exists) return;

    await execute(
      `ALTER TABLE orders
       ADD COLUMN no_stock_impact TINYINT(1) NOT NULL DEFAULT 0
       AFTER payment_status`
    );
    console.log('[DB] Columna orders.no_stock_impact agregada');
  } catch (e: any) {
    console.error('[DB] addNoStockImpactToOrders:', e?.message || e);
  }
}
