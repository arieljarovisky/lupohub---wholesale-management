import { execute, query } from './db';

export async function addInventoryHiddenToVariants(): Promise<void> {
  try {
    const col = await query(
      `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_variants' AND COLUMN_NAME = 'inventory_hidden'`
    );
    if (col && col.length > 0) {
      console.log('✓ inventory_hidden ya existe en product_variants');
      return;
    }
    await execute(`
      ALTER TABLE product_variants
      ADD COLUMN inventory_hidden TINYINT(1) NOT NULL DEFAULT 0
    `);
    console.log('✓ Columna inventory_hidden agregada a product_variants');
  } catch (e: any) {
    if (e.code === 'ER_DUP_FIELDNAME') {
      console.log('✓ inventory_hidden ya existe en product_variants');
    } else {
      throw e;
    }
  }
}
