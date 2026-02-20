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
        console.log("Adding external ID columns...");
        // Add columns to products table
        try {
            yield (0, db_1.execute)(`
        ALTER TABLE products 
        ADD COLUMN tienda_nube_id VARCHAR(100) NULL,
        ADD COLUMN mercado_libre_id VARCHAR(100) NULL
      `);
            console.log("Added columns to products table");
        }
        catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log("Columns already exist in products table");
            }
            else {
                console.error("Error altering products table:", e);
            }
        }
        // Add columns to product_variants table
        try {
            yield (0, db_1.execute)(`
        ALTER TABLE product_variants 
        ADD COLUMN tienda_nube_variant_id VARCHAR(100) NULL,
        ADD COLUMN mercado_libre_variant_id VARCHAR(100) NULL
      `);
            console.log("Added columns to product_variants table");
        }
        catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log("Columns already exist in product_variants table");
            }
            else {
                console.error("Error altering product_variants table:", e);
            }
        }
        console.log("Migration completed.");
        process.exit(0);
    }
    catch (error) {
        console.error("Migration failed:", error);
        process.exit(1);
    }
});
runMigration();
