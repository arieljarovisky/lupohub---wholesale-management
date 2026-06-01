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
exports.addCustomerPhoneIva = addCustomerPhoneIva;
const db_1 = require("./db");
/** Agrega teléfono y condición de IVA a clientes. */
function addCustomerPhoneIva() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('[DB] Verificando columnas phone y condicion_iva en customers...');
        try {
            const phoneCol = yield (0, db_1.get)(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'phone'`);
            if (!phoneCol) {
                yield (0, db_1.execute)(`ALTER TABLE customers ADD COLUMN phone VARCHAR(50) NULL AFTER cuit`);
                console.log('[DB] Columna phone agregada a customers');
            }
            const ivaCol = yield (0, db_1.get)(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'condicion_iva'`);
            if (!ivaCol) {
                yield (0, db_1.execute)(`ALTER TABLE customers ADD COLUMN condicion_iva VARCHAR(100) NULL AFTER phone`);
                console.log('[DB] Columna condicion_iva agregada a customers');
            }
        }
        catch (e) {
            console.error('[DB] Error agregando phone/condicion_iva a customers:', e === null || e === void 0 ? void 0 : e.message);
        }
    });
}
