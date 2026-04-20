import { execute, get } from './db';

/** Detalle por ítem para notas de crédito parciales (permite múltiples artículos en una misma NC). */
export async function addCreditNoteItemsTable(): Promise<void> {
  try {
    const existsRow = await get(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'credit_note_items'`
    );
    const exists = Number((existsRow as any)?.cnt || 0) > 0;
    if (!exists) {
      await execute(
        `CREATE TABLE credit_note_items (
           id VARCHAR(36) PRIMARY KEY,
           credit_note_id VARCHAR(36) NOT NULL,
           order_id VARCHAR(36) NOT NULL,
           item_index INT NOT NULL,
           quantity INT NOT NULL,
           amount_credited DECIMAL(10, 2) NOT NULL,
           created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
           INDEX idx_cni_order_item (order_id, item_index),
           INDEX idx_cni_credit_note (credit_note_id),
           CONSTRAINT fk_cni_credit_note FOREIGN KEY (credit_note_id) REFERENCES credit_notes(id) ON DELETE CASCADE
         )`
      );
      console.log('[DB] Tabla credit_note_items creada');
      return;
    }

    const hasQty = await get(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'credit_note_items'
         AND COLUMN_NAME = 'quantity'`
    );
    if (Number((hasQty as any)?.cnt || 0) === 0) {
      await execute(`ALTER TABLE credit_note_items ADD COLUMN quantity INT NOT NULL DEFAULT 1 AFTER item_index`);
      console.log('[DB] Columna credit_note_items.quantity agregada');
    }
  } catch (e: any) {
    console.error('[DB] addCreditNoteItemsTable:', e?.message || e);
  }
}
