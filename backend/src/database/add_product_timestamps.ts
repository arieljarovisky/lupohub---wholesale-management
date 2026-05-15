import { execute, query } from './db';

/** created_at / updated_at en products para ordenar inventario por recientes. */
export const addProductTimestamps = async () => {
  try {
    const hasCreated = await query(
      `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'created_at'`
    );
    if (hasCreated && (hasCreated as any[]).length > 0) {
      console.log('✓ Timestamps (created_at/updated_at) ya existen en products');
      return;
    }
    await execute(`
      ALTER TABLE products
        ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        ADD INDEX idx_products_created_at (created_at),
        ADD INDEX idx_products_updated_at (updated_at)
    `);
    console.log('✓ Columnas created_at y updated_at agregadas a products');
  } catch (e: any) {
    if (e.code === 'ER_DUP_FIELDNAME') {
      console.log('✓ Timestamps ya existen en products');
    } else {
      throw e;
    }
  }
};
