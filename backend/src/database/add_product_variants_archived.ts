import { execute, get } from './db';

export async function addProductVariantsArchived(): Promise<void> {
  try {
    console.log('[DB] Verificando columna archived en product_variants...');
    const row = await get(
      `SELECT COUNT(*) AS c
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_variants' AND COLUMN_NAME = 'archived'`
    );
    if (Number((row as any)?.c || 0) > 0) {
      console.log('[DB] Columna product_variants.archived ya existe');
      return;
    }
    await execute(`ALTER TABLE product_variants ADD COLUMN archived TINYINT(1) NOT NULL DEFAULT 0 AFTER sku`);
    console.log('[DB] Columna product_variants.archived agregada');
  } catch (e: any) {
    console.error('[DB] Error agregando product_variants.archived:', e?.message || e);
  }
}
