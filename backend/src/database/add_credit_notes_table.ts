import { execute, get } from './db';

/** Tabla de notas de crédito AFIP (asociadas a una factura de un pedido). */
export async function addCreditNotesTable(): Promise<void> {
  console.log('[DB] Verificando tabla credit_notes...');
  try {
    const t = await get(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_notes'`
    );
    if (!t) {
      await execute(`
        CREATE TABLE credit_notes (
          id VARCHAR(36) PRIMARY KEY,
          order_id VARCHAR(36) NOT NULL,
          invoice_id VARCHAR(36) NOT NULL,
          cae VARCHAR(20) NOT NULL,
          cae_fch_vto VARCHAR(20) DEFAULT NULL,
          punto_venta INT NOT NULL,
          cbte_tipo INT NOT NULL,
          cbte_desde INT NOT NULL,
          cbte_hasta INT NOT NULL,
          amount_credited DECIMAL(12, 2) NOT NULL,
          scope VARCHAR(10) NOT NULL DEFAULT 'total',
          item_index INT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
          FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
        )
      `);
      console.log('[DB] Tabla credit_notes creada');
    } else {
      console.log('[DB] Tabla credit_notes ya existe');
    }
    // Añadir columnas scope e item_index si no existen (migración)
    const colScope = await get(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_notes' AND COLUMN_NAME = 'scope'`
    );
    if (!colScope) {
      await execute(`ALTER TABLE credit_notes ADD COLUMN scope VARCHAR(10) NOT NULL DEFAULT 'total' AFTER amount_credited`);
      await execute(`ALTER TABLE credit_notes ADD COLUMN item_index INT NULL AFTER scope`);
      console.log('[DB] credit_notes: columnas scope e item_index añadidas');
    }
  } catch (e: any) {
    console.error('[DB] Error creando tabla credit_notes:', e?.message);
  }
}
