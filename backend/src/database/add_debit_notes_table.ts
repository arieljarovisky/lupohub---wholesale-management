import { execute, get } from './db';

/** Tabla de notas de débito AFIP (asociadas a una factura de un pedido). */
export async function addDebitNotesTable(): Promise<void> {
  console.log('[DB] Verificando tabla debit_notes...');
  try {
    const t = await get(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'debit_notes'`
    );
    if (!t) {
      await execute(`
        CREATE TABLE debit_notes (
          id VARCHAR(36) PRIMARY KEY,
          order_id VARCHAR(36) NOT NULL,
          invoice_id VARCHAR(36) NOT NULL,
          cae VARCHAR(20) NOT NULL,
          cae_fch_vto VARCHAR(20) DEFAULT NULL,
          punto_venta INT NOT NULL,
          cbte_tipo INT NOT NULL,
          cbte_desde INT NOT NULL,
          cbte_hasta INT NOT NULL,
          amount_debited DECIMAL(12, 2) NOT NULL DEFAULT 0,
          agip_alicuota DECIMAL(8, 4) NULL,
          agip_ret_per DECIMAL(12, 2) NULL,
          scope VARCHAR(10) NOT NULL DEFAULT 'total',
          item_index INT NULL,
          description VARCHAR(255) NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
          FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
        )
      `);
      console.log('[DB] Tabla debit_notes creada');
    } else {
      console.log('[DB] Tabla debit_notes ya existe');
    }
  } catch (e: any) {
    console.error('[DB] Error creando tabla debit_notes:', e?.message);
  }
}
