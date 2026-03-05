import { execute, query } from './db';

export const addPackSizeToProducts = async () => {
  try {
    const col = await query(
      `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'mercado_libre_pack_size'`
    );
    if (col && col.length > 0) {
      console.log('✓ Pack size (ML/TN) ya existen en products');
      return;
    }
    await execute(`
      ALTER TABLE products
        ADD COLUMN mercado_libre_pack_size INT NOT NULL DEFAULT 1,
        ADD COLUMN tienda_nube_pack_size INT NOT NULL DEFAULT 1
    `);
    console.log('✓ Columnas mercado_libre_pack_size y tienda_nube_pack_size agregadas a products');
  } catch (e: any) {
    if (e.code === 'ER_DUP_FIELDNAME') {
      console.log('✓ Pack size ya existen en products');
    } else {
      throw e;
    }
  }
};
