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
exports.addExternalSkuToVariants = addExternalSkuToVariants;
const db_1 = require("./db");
function addExternalSkuToVariants() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const col = yield (0, db_1.query)(`SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_variants' AND COLUMN_NAME = 'external_sku'`);
            if (col && col.length > 0) {
                console.log('✓ external_sku ya existe en product_variants');
                return;
            }
            yield (0, db_1.execute)(`
      ALTER TABLE product_variants
      ADD COLUMN external_sku VARCHAR(100) NULL
    `);
            console.log('✓ Columna external_sku agregada a product_variants (SKU en ML/TN)');
        }
        catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log('✓ external_sku ya existe en product_variants');
            }
            else {
                throw e;
            }
        }
    });
}
