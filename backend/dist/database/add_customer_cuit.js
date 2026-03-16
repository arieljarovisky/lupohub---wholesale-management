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
exports.addCustomerCuit = addCustomerCuit;
const db_1 = require("./db");
/** Agrega CUIT/CUIL a clientes para facturación (Argentina). */
function addCustomerCuit() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('[DB] Verificando columna CUIT en customers...');
        try {
            const col = yield (0, db_1.get)(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'cuit'`);
            if (!col) {
                yield (0, db_1.execute)(`ALTER TABLE customers ADD COLUMN cuit VARCHAR(20) NULL AFTER city`);
                console.log('[DB] Columna cuit agregada a customers (para facturación)');
            }
            else {
                console.log('[DB] Columna cuit ya existe en customers');
            }
        }
        catch (e) {
            console.error('[DB] Error agregando cuit a customers:', e === null || e === void 0 ? void 0 : e.message);
        }
    });
}
