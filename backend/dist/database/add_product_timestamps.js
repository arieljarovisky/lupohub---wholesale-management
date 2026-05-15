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
exports.addProductTimestamps = void 0;
const db_1 = require("./db");
/** created_at / updated_at en products para ordenar inventario por recientes. */
const addProductTimestamps = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const hasCreated = yield (0, db_1.query)(`SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'created_at'`);
        if (hasCreated && hasCreated.length > 0) {
            console.log('✓ Timestamps (created_at/updated_at) ya existen en products');
            return;
        }
        yield (0, db_1.execute)(`
      ALTER TABLE products
        ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        ADD INDEX idx_products_created_at (created_at),
        ADD INDEX idx_products_updated_at (updated_at)
    `);
        console.log('✓ Columnas created_at y updated_at agregadas a products');
    }
    catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
            console.log('✓ Timestamps ya existen en products');
        }
        else {
            throw e;
        }
    }
});
exports.addProductTimestamps = addProductTimestamps;
