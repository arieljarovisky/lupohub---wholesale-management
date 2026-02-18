import { execute } from './db';

const runMigration = async () => {
  try {
    console.log("Adding external ID columns...");

    // Add columns to products table
    try {
      await execute(`
        ALTER TABLE products 
        ADD COLUMN tienda_nube_id VARCHAR(100) NULL,
        ADD COLUMN mercado_libre_id VARCHAR(100) NULL
      `);
      console.log("Added columns to products table");
    } catch (e: any) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log("Columns already exist in products table");
      } else {
        console.error("Error altering products table:", e);
      }
    }

    // Add columns to product_variants table
    try {
      await execute(`
        ALTER TABLE product_variants 
        ADD COLUMN tienda_nube_variant_id VARCHAR(100) NULL,
        ADD COLUMN mercado_libre_variant_id VARCHAR(100) NULL
      `);
      console.log("Added columns to product_variants table");
    } catch (e: any) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log("Columns already exist in product_variants table");
      } else {
        console.error("Error altering product_variants table:", e);
      }
    }

    console.log("Migration completed.");
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
};

runMigration();
