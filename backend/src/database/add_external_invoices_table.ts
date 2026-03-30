import { execute, get } from './db';

/** Facturas AFIP emitidas para órdenes externas (ej. Tienda Nube). */
export async function addExternalInvoicesTable(): Promise<void> {
  console.log('[DB] Verificando tabla external_invoices...');
  try {
    const row = await get(
      `SELECT COUNT(*) AS cnt FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'external_invoices'`
    );
    const exists = Number((row as any)?.cnt || 0) > 0;
    if (!exists) {
      await execute(`
        CREATE TABLE external_invoices (
          id VARCHAR(36) PRIMARY KEY,
          source VARCHAR(40) NOT NULL,
          external_order_id VARCHAR(80) NOT NULL,
          order_number VARCHAR(120) NULL,
          customer_name VARCHAR(255) NULL,
          total DECIMAL(12,2) NOT NULL DEFAULT 0,
          cae VARCHAR(20) NOT NULL,
          cae_fch_vto VARCHAR(20) DEFAULT NULL,
          punto_venta INT NOT NULL,
          cbte_tipo INT NOT NULL,
          cbte_desde INT NOT NULL,
          cbte_hasta INT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_external_source_order (source, external_order_id),
          INDEX idx_external_source_created (source, created_at)
        )
      `);
      console.log('[DB] Tabla external_invoices creada');
    } else {
      console.log('[DB] Tabla external_invoices ya existe');
    }
  } catch (e: any) {
    console.error('[DB] Error creando tabla external_invoices:', e?.message);
  }
}
