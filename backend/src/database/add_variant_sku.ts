import { execute } from './db';

const runMigration = async () => {
  try {
    await execute(`ALTER TABLE product_variants ADD COLUMN sku VARCHAR(100) NULL`);
    process.exit(0);
  } catch (e: any) {
    if (e.code === 'ER_DUP_FIELDNAME') {
      try {
        await execute(`ALTER TABLE product_variants MODIFY COLUMN sku VARCHAR(100)`);
      } catch {}
      process.exit(0);
    } else {
      process.exit(1);
    }
  }
};

runMigration();
