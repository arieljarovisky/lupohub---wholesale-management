import { execute, get } from './db';

export async function addProductsArchived(): Promise<void> {
  try {
    console.log('[DB] Verificando columna archived en products...');
    const row = await get(
      `SELECT COUNT(*) AS c
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'archived'`
    );
    if (Number((row as any)?.c || 0) > 0) {
      console.log('[DB] Columna products.archived ya existe');
      return;
    }
    await execute(`ALTER TABLE products ADD COLUMN archived TINYINT(1) NOT NULL DEFAULT 0 AFTER mercado_libre_id`);
    console.log('[DB] Columna products.archived agregada');
  } catch (e: any) {
    console.error('[DB] Error agregando products.archived:', e?.message || e);
  }
}
