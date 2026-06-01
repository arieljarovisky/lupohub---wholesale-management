import { execute, get } from './db';

/** Facturas y NC cargadas a mano (sin pedido AFIP en LupoHub). */
export async function addCustomerManualComprobantesTable(): Promise<void> {
  console.log('[DB] Verificando tabla customer_manual_comprobantes...');
  try {
    const row = await get(
      `SELECT COUNT(*) AS cnt FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'customer_manual_comprobantes'`
    );
    if (Number((row as any)?.cnt || 0) === 0) {
      await execute(`
        CREATE TABLE customer_manual_comprobantes (
          id VARCHAR(36) PRIMARY KEY,
          customer_id VARCHAR(36) NOT NULL,
          tipo VARCHAR(10) NOT NULL,
          fecha DATE NOT NULL,
          punto_venta INT NOT NULL,
          cbte_tipo INT NOT NULL,
          cbte_desde INT NOT NULL,
          cbte_hasta INT NOT NULL,
          cae VARCHAR(20) NULL,
          cae_fch_vto VARCHAR(20) NULL,
          importe_neto DECIMAL(12,2) NOT NULL,
          agip_ret_per DECIMAL(12,2) NOT NULL DEFAULT 0,
          notes TEXT NULL,
          ref_invoice_id VARCHAR(36) NULL,
          ref_manual_comprobante_id VARCHAR(36) NULL,
          ref_order_id VARCHAR(36) NULL,
          created_by VARCHAR(36) NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_cmc_customer_fecha (customer_id, fecha),
          INDEX idx_cmc_tipo (tipo),
          CONSTRAINT fk_cmc_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
        )
      `);
      console.log('[DB] Tabla customer_manual_comprobantes creada');
    } else {
      console.log('[DB] Tabla customer_manual_comprobantes ya existe');
    }
  } catch (e: any) {
    console.error('[DB] Error creando customer_manual_comprobantes:', e?.message);
  }
}
