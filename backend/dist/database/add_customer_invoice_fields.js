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
exports.addCustomerInvoiceFields = void 0;
const db_1 = require("./db");
/** Campos comerciales del cliente para imprimir en factura. */
function addCustomerInvoiceFields() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('[DB] Verificando columnas comerciales de customers...');
        try {
            const cols = [
                { name: 'transport_number', sql: `ALTER TABLE customers ADD COLUMN transport_number VARCHAR(120) NULL AFTER phone` },
                { name: 'remito_number', sql: `ALTER TABLE customers ADD COLUMN remito_number VARCHAR(120) NULL AFTER transport_number` },
                { name: 'sale_condition', sql: `ALTER TABLE customers ADD COLUMN sale_condition VARCHAR(120) NULL AFTER remito_number` },
            ];
            for (const c of cols) {
                const exists = yield (0, db_1.get)(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = ?`, [c.name]);
                if (!exists) {
                    yield (0, db_1.execute)(c.sql);
                    console.log(`[DB] customers.${c.name} agregada`);
                }
            }
        }
        catch (e) {
            console.error('[DB] Error agregando columnas comerciales en customers:', e === null || e === void 0 ? void 0 : e.message);
        }
    });
}
exports.addCustomerInvoiceFields = addCustomerInvoiceFields;
