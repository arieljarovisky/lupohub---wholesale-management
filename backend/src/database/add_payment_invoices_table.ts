import { execute, get } from './db';

/**
 * Tabla puente para asociar un recibo con múltiples facturas.
 * Mantiene compatibilidad con payments.invoice_id (legacy).
 */
export async function addPaymentInvoicesTable(): Promise<void> {
  console.log('[DB] Verificando tabla payment_invoices...');
  try {
    await execute(`
      CREATE TABLE IF NOT EXISTS payment_invoices (
        payment_id VARCHAR(36) NOT NULL,
        invoice_id VARCHAR(36) NOT NULL,
        amount_applied DECIMAL(12,2) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (payment_id, invoice_id),
        INDEX idx_payment_invoices_invoice (invoice_id),
        CONSTRAINT fk_payment_invoices_payment
          FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
        CONSTRAINT fk_payment_invoices_invoice
          FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
      )
    `);

    // Backfill: reflejar vínculos legacy de payments.invoice_id en la tabla puente.
    await execute(`
      INSERT IGNORE INTO payment_invoices (payment_id, invoice_id)
      SELECT p.id, p.invoice_id
      FROM payments p
      WHERE p.invoice_id IS NOT NULL AND TRIM(p.invoice_id) <> ''
    `);

    const row = await get(`SELECT COUNT(*) AS cnt FROM payment_invoices`);
    console.log(`[DB] payment_invoices OK (${Number((row as any)?.cnt || 0)} relación/es)`);
  } catch (e: any) {
    console.error('[DB] Error creando/verificando payment_invoices:', e?.message);
  }
}

