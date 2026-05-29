import { execute, get } from './db';

/**
 * Tabla puente para asociar un recibo con pedidos sin factura (include_in_saldo).
 */
export async function addPaymentOrdersTable(): Promise<void> {
  console.log('[DB] Verificando tabla payment_orders...');
  try {
    await execute(`
      CREATE TABLE IF NOT EXISTS payment_orders (
        payment_id VARCHAR(36) NOT NULL,
        order_id VARCHAR(36) NOT NULL,
        amount_applied DECIMAL(12,2) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (payment_id, order_id),
        INDEX idx_payment_orders_order (order_id),
        CONSTRAINT fk_payment_orders_payment
          FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
        CONSTRAINT fk_payment_orders_order
          FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
      )
    `);

    await execute(`
      INSERT IGNORE INTO payment_orders (payment_id, order_id, amount_applied)
      SELECT p.id, p.order_id, ROUND(COALESCE(p.amount, 0), 2)
      FROM payments p
      WHERE p.order_id IS NOT NULL AND TRIM(p.order_id) <> ''
        AND (p.invoice_id IS NULL OR TRIM(p.invoice_id) = '')
        AND NOT EXISTS (SELECT 1 FROM payment_invoices pi WHERE pi.payment_id = p.id)
    `);

    const row = await get(`SELECT COUNT(*) AS cnt FROM payment_orders`);
    console.log(`[DB] payment_orders OK (${Number((row as any)?.cnt || 0)} relación/es)`);
  } catch (e: any) {
    console.error('[DB] Error creando/verificando payment_orders:', e?.message);
  }
}
