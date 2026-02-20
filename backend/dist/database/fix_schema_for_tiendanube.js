"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("./db");
const runMigration = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log("Starting schema fix for Tienda Nube integration...");
        // 1. Widen sizes.size_code
        try {
            console.log("Modifying sizes.size_code to VARCHAR(100)...");
            yield (0, db_1.execute)("ALTER TABLE sizes MODIFY COLUMN size_code VARCHAR(100)");
            console.log("sizes.size_code modified.");
        }
        catch (e) {
            console.error("Error modifying sizes.size_code:", e.message);
        }
        // 2. Add sizes.name if missing
        try {
            console.log("Checking if sizes.name exists...");
            yield (0, db_1.execute)("ALTER TABLE sizes ADD COLUMN name VARCHAR(100) NULL");
            console.log("sizes.name added.");
            // Copy size_code to name for existing
            yield (0, db_1.execute)("UPDATE sizes SET name = size_code WHERE name IS NULL");
        }
        catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log("sizes.name already exists.");
                // Ensure it's wide enough
                yield (0, db_1.execute)("ALTER TABLE sizes MODIFY COLUMN name VARCHAR(100)");
            }
            else {
                console.error("Error adding sizes.name:", e.message);
            }
        }
        // 3. Widen colors.code
        try {
            console.log("Modifying colors.code to VARCHAR(100)...");
            yield (0, db_1.execute)("ALTER TABLE colors MODIFY COLUMN code VARCHAR(100)");
            console.log("colors.code modified.");
        }
        catch (e) {
            console.error("Error modifying colors.code:", e.message);
        }
        // 4. Add colors.hex if missing
        try {
            console.log("Checking if colors.hex exists...");
            yield (0, db_1.execute)("ALTER TABLE colors ADD COLUMN hex VARCHAR(20) DEFAULT '#000000'");
            console.log("colors.hex added.");
        }
        catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log("colors.hex already exists.");
            }
            else {
                console.error("Error adding colors.hex:", e.message);
            }
        }
        // 5. Ensure constraints don't block us (Optional: drop unique index on colors.code if it exists and causes issues?)
        // For now, widening the column helps avoid collisions on truncated values.
        console.log("Schema fix completed.");
        process.exit(0);
    }
    catch (error) {
        console.error("Migration failed:", error);
        process.exit(1);
    }
});
runMigration();
