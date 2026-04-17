import { execute, get } from './db';

/** Snapshot del último stock enviado con éxito a la tienda online (webhook Lupo Shop). */
export async function addVariantLuposhopStockTable(): Promise<void> {
  console.log('[DB] Verificando tabla variant_luposhop_stock...');
  try {
    const row = await get(
      `SELECT COUNT(*) AS cnt FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'variant_luposhop_stock'`
    );
    const exists = Number((row as any)?.cnt || 0) > 0;
    if (!exists) {
      await execute(`
        CREATE TABLE variant_luposhop_stock (
          variant_id VARCHAR(36) PRIMARY KEY,
          stock INT NOT NULL DEFAULT 0,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_luposhop_updated (updated_at)
        )
      `);
      console.log('[DB] Tabla variant_luposhop_stock creada');
    } else {
      console.log('[DB] Tabla variant_luposhop_stock ya existe');
    }
  } catch (e: any) {
    console.error('[DB] Error verificando tabla variant_luposhop_stock:', e?.message);
  }
}
