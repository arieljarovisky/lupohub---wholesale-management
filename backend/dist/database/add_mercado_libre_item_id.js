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
exports.addMercadoLibreItemIdToVariants = void 0;
const db_1 = require("./db");
/** Agrega mercado_libre_item_id en product_variants para variantes que tienen su propia publicación ML (una publicación por variante). */
function addMercadoLibreItemIdToVariants() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const col = yield (0, db_1.query)(`SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_variants' AND COLUMN_NAME = 'mercado_libre_item_id'`);
            if (col && col.length > 0) {
                console.log('✓ mercado_libre_item_id ya existe en product_variants');
                return;
            }
            yield (0, db_1.execute)(`
      ALTER TABLE product_variants
      ADD COLUMN mercado_libre_item_id VARCHAR(100) NULL
    `);
            console.log('✓ Columna mercado_libre_item_id agregada (publicación ML única por variante)');
        }
        catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log('✓ mercado_libre_item_id ya existe en product_variants');
            }
            else {
                throw e;
            }
        }
    });
}
exports.addMercadoLibreItemIdToVariants = addMercadoLibreItemIdToVariants;
