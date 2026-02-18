import { execute } from './db';

const runMigration = async () => {
  try {
    console.log("Starting schema fix for Tienda Nube integration...");

    // 1. Widen sizes.size_code
    try {
      console.log("Modifying sizes.size_code to VARCHAR(100)...");
      await execute("ALTER TABLE sizes MODIFY COLUMN size_code VARCHAR(100)");
      console.log("sizes.size_code modified.");
    } catch (e: any) {
      console.error("Error modifying sizes.size_code:", e.message);
    }

    // 2. Add sizes.name if missing
    try {
        console.log("Checking if sizes.name exists...");
        await execute("ALTER TABLE sizes ADD COLUMN name VARCHAR(100) NULL");
        console.log("sizes.name added.");
        // Copy size_code to name for existing
        await execute("UPDATE sizes SET name = size_code WHERE name IS NULL");
    } catch (e: any) {
        if (e.code === 'ER_DUP_FIELDNAME') {
            console.log("sizes.name already exists.");
            // Ensure it's wide enough
            await execute("ALTER TABLE sizes MODIFY COLUMN name VARCHAR(100)");
        } else {
            console.error("Error adding sizes.name:", e.message);
        }
    }

    // 3. Widen colors.code
    try {
      console.log("Modifying colors.code to VARCHAR(100)...");
      await execute("ALTER TABLE colors MODIFY COLUMN code VARCHAR(100)");
      console.log("colors.code modified.");
    } catch (e: any) {
      console.error("Error modifying colors.code:", e.message);
    }

    // 4. Add colors.hex if missing
    try {
        console.log("Checking if colors.hex exists...");
        await execute("ALTER TABLE colors ADD COLUMN hex VARCHAR(20) DEFAULT '#000000'");
        console.log("colors.hex added.");
    } catch (e: any) {
        if (e.code === 'ER_DUP_FIELDNAME') {
            console.log("colors.hex already exists.");
        } else {
            console.error("Error adding colors.hex:", e.message);
        }
    }

    // 5. Ensure constraints don't block us (Optional: drop unique index on colors.code if it exists and causes issues?)
    // For now, widening the column helps avoid collisions on truncated values.

    console.log("Schema fix completed.");
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
};

runMigration();