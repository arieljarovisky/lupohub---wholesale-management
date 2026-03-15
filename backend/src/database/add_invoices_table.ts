import { execute, get } from './db';

/** Tabla de facturas AFIP emitidas por pedido (una factura por pedido). */
export async function addInvoicesTable(): Promise<void> {
  console.log('[DB] Verificando tabla invoices...');
  try {
    const t = await get(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices'`
    );
    if (!t) {
      await execute(`
        CREATE TABLE invoices (
          id VARCHAR(36) PRIMARY KEY,
          order_id VARCHAR(36) NOT NULL UNIQUE,
          cae VARCHAR(20) NOT NULL,
          cae_fch_vto VARCHAR(20) DEFAULT NULL,
          punto_venta INT NOT NULL,
          cbte_tipo INT NOT NULL,
          cbte_desde INT NOT NULL,
          cbte_hasta INT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
        )
      `);
      console.log('[DB] Tabla invoices creada');
    } else {
      console.log('[DB] Tabla invoices ya existe');
    }
  } catch (e: any) {
    console.error('[DB] Error creando tabla invoices:', e?.message);
  }
}
