import { execute, get } from './db';

/** Contador atómico del talonario de recibos (punto de venta 0001). */
export async function addReceiptSequence(): Promise<void> {
  try {
    const tableExists = await get(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'receipt_sequence'`
    );
    if (!tableExists) {
      await execute(`
        CREATE TABLE receipt_sequence (
          id TINYINT NOT NULL PRIMARY KEY,
          next_value INT NOT NULL,
          CHECK (id = 1)
        )
      `);
      console.log('[DB] receipt_sequence creada');
    }
    const row = await get(`SELECT next_value FROM receipt_sequence WHERE id = 1`);
    if (!row) {
      await execute(`INSERT INTO receipt_sequence (id, next_value) VALUES (1, 1)`);
    }
  } catch (e: any) {
    console.error('[DB] Error creando/verificando receipt_sequence:', e?.message);
  }
}
