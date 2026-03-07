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
exports.addPackSizeToProducts = void 0;
const db_1 = require("./db");
const addPackSizeToProducts = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const col = yield (0, db_1.query)(`SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'mercado_libre_pack_size'`);
        if (col && col.length > 0) {
            console.log('✓ Pack size (ML/TN) ya existen en products');
            return;
        }
        yield (0, db_1.execute)(`
      ALTER TABLE products
        ADD COLUMN mercado_libre_pack_size INT NOT NULL DEFAULT 1,
        ADD COLUMN tienda_nube_pack_size INT NOT NULL DEFAULT 1
    `);
        console.log('✓ Columnas mercado_libre_pack_size y tienda_nube_pack_size agregadas a products');
    }
    catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
            console.log('✓ Pack size ya existen en products');
        }
        else {
            throw e;
        }
    }
});
exports.addPackSizeToProducts = addPackSizeToProducts;
