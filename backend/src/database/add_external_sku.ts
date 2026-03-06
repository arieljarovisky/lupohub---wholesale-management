import { execute, query } from './db';

export async function addExternalSkuToVariants(): Promise<void> {
  try {
    const col = await query(
      `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_variants' AND COLUMN_NAME = 'external_sku'`
    );
    if (col && col.length > 0) {
      console.log('✓ external_sku ya existe en product_variants');
      return;
    }
    await execute(`
      ALTER TABLE product_variants
      ADD COLUMN external_sku VARCHAR(100) NULL
    `);
    console.log('✓ Columna external_sku agregada a product_variants (SKU en ML/TN)');
  } catch (e: any) {
    if (e.code === 'ER_DUP_FIELDNAME') {
      console.log('✓ external_sku ya existe en product_variants');
    } else {
      throw e;
    }
  }
}
