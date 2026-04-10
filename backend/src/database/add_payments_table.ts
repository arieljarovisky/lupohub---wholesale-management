import { execute, get } from './db';

/** Evita doble inserción del mismo recibo (doble click o dos POST simultáneos). */
async function ensurePaymentsNaturalUniqueIndex(): Promise<void> {
  try {
    await execute(
      `CREATE UNIQUE INDEX uq_payments_client_recibo_fecha_importe
       ON payments (customer_id, receipt_number(80), date, amount)`
    );
    console.log('[DB] Índice único uq_payments_client_recibo_fecha_importe creado/ok');
  } catch (e: any) {
    const code = e?.code;
    const msg = String(e?.message || '');
    if (code === 'ER_DUP_KEYNAME' || msg.includes('Duplicate key name')) return;
    if (code === 'ER_DUP_ENTRY' || msg.includes('Duplicate entry')) {
      console.warn(
        '[DB] No se aplicó índice único en payments: hay filas duplicadas (cliente+recibo+fecha+importe). Eliminá duplicados y reiniciá el servidor.'
      );
      return;
    }
    console.warn('[DB] ensurePaymentsNaturalUniqueIndex:', msg);
  }
}

/** Tabla de pagos/recibos de clientes (cuenta corriente). */
export async function addPaymentsTable(): Promise<void> {
  console.log('[DB] Verificando tabla payments...');
  try {
    const row = await get(
      `SELECT COUNT(*) AS cnt FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'payments'`
    );
    const exists = Number((row as any)?.cnt || 0) > 0;
    if (exists) {
      console.log('[DB] payments ya existe');
      await ensurePaymentsNaturalUniqueIndex();
      return;
    }

    await execute(`
      CREATE TABLE payments (
        id VARCHAR(36) PRIMARY KEY,
        customer_id VARCHAR(36) NOT NULL,
        seller_id VARCHAR(36) NULL,
        order_id VARCHAR(36) NULL,
        invoice_id VARCHAR(36) NULL,
        receipt_number VARCHAR(100) NOT NULL,
        date DATE NOT NULL,
        amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        notes TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_payments_customer_date (customer_id, date),
        INDEX idx_payments_invoice (invoice_id),
        INDEX idx_payments_order (order_id),
        INDEX idx_payments_seller (seller_id)
      )
    `);

    console.log('[DB] Tabla payments creada');
    await ensurePaymentsNaturalUniqueIndex();
  } catch (e: any) {
    console.error('[DB] Error creando tabla payments:', e?.message);
  }
}

