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
exports.addCustomerDirect = addCustomerDirect;
const db_1 = require("./db");
/** Agrega user_id a customers (cliente directo) y permite seller_id NULL en orders. */
function addCustomerDirect() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('[DB] Verificando soporte cliente directo...');
        try {
            const col = yield (0, db_1.get)(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'user_id'`);
            if (!col) {
                yield (0, db_1.execute)(`ALTER TABLE customers ADD COLUMN user_id VARCHAR(36) NULL UNIQUE AFTER seller_id`);
                console.log('[DB] Columna user_id agregada a customers');
            }
            else {
                console.log('[DB] Columna user_id ya existe en customers');
            }
        }
        catch (e) {
            console.error('[DB] Error agregando user_id a customers:', e === null || e === void 0 ? void 0 : e.message);
        }
        try {
            yield (0, db_1.execute)(`ALTER TABLE orders MODIFY COLUMN seller_id VARCHAR(36) NULL`);
            console.log('[DB] orders.seller_id permite NULL (pedido directo)');
        }
        catch (e) {
            if ((e === null || e === void 0 ? void 0 : e.code) !== 'ER_BAD_FIELD_ERROR')
                console.error('[DB] Error modificando orders.seller_id:', e === null || e === void 0 ? void 0 : e.message);
        }
    });
}
