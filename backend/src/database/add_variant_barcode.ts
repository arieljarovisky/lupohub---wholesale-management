import { execute, query } from './db';

/** EAN/GTIN por variante (talle + color). */
export async function addBarcodeToVariants(): Promise<void> {
  try {
    const col = await query(
      `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_variants' AND COLUMN_NAME = 'barcode'`
    );
    if (!col || col.length === 0) {
      await execute(`
        ALTER TABLE product_variants
        ADD COLUMN barcode VARCHAR(32) NULL,
        ADD UNIQUE INDEX idx_product_variants_barcode (barcode)
      `);
      console.log('✓ Columna barcode (EAN) agregada a product_variants');
      return;
    }
    const idx = await query(
      `SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_variants' AND INDEX_NAME = 'idx_product_variants_barcode'`
    );
    if (!idx || idx.length === 0) {
      await execute(`ALTER TABLE product_variants ADD UNIQUE INDEX idx_product_variants_barcode (barcode)`);
      console.log('✓ Índice único de barcode agregado a product_variants');
    } else {
      console.log('✓ barcode ya existe en product_variants');
    }
  } catch (e: any) {
    if (e.code === 'ER_DUP_FIELDNAME' || e.code === 'ER_DUP_KEYNAME') {
      console.log('✓ barcode ya existe en product_variants');
    } else {
      throw e;
    }
  }
}
