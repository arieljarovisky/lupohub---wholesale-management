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
exports.addProductsArchived = addProductsArchived;
const db_1 = require("./db");
function addProductsArchived() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.log('[DB] Verificando columna archived en products...');
            const row = yield (0, db_1.get)(`SELECT COUNT(*) AS c
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'archived'`);
            if (Number((row === null || row === void 0 ? void 0 : row.c) || 0) > 0) {
                console.log('[DB] Columna products.archived ya existe');
                return;
            }
            yield (0, db_1.execute)(`ALTER TABLE products ADD COLUMN archived TINYINT(1) NOT NULL DEFAULT 0 AFTER mercado_libre_id`);
            console.log('[DB] Columna products.archived agregada');
        }
        catch (e) {
            console.error('[DB] Error agregando products.archived:', (e === null || e === void 0 ? void 0 : e.message) || e);
        }
    });
}
