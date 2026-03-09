import { execute, query } from './db';

/** Agrega mercado_libre_item_id en product_variants para variantes que tienen su propia publicación ML (una publicación por variante). */
export async function addMercadoLibreItemIdToVariants(): Promise<void> {
  try {
    const col = await query(
      `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_variants' AND COLUMN_NAME = 'mercado_libre_item_id'`
    );
    if (col && col.length > 0) {
      console.log('✓ mercado_libre_item_id ya existe en product_variants');
      return;
    }
    await execute(`
      ALTER TABLE product_variants
      ADD COLUMN mercado_libre_item_id VARCHAR(100) NULL
    `);
    console.log('✓ Columna mercado_libre_item_id agregada (publicación ML única por variante)');
  } catch (e: any) {
    if (e.code === 'ER_DUP_FIELDNAME') {
      console.log('✓ mercado_libre_item_id ya existe en product_variants');
    } else {
      throw e;
    }
  }
}
