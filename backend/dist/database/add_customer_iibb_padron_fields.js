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
exports.addCustomerIibbPadronFields = addCustomerIibbPadronFields;
const db_1 = require("./db");
/** Agrega campos para padrón mensual de percepción IIBB por cliente (RetPer). */
function addCustomerIibbPadronFields() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('[DB] Verificando campos IIBB en customers...');
        try {
            const columns = [
                {
                    name: 'iibb_perception_rate',
                    sql: `ALTER TABLE customers ADD COLUMN iibb_perception_rate DECIMAL(7,4) NULL`,
                },
                {
                    name: 'iibb_padron_period',
                    sql: `ALTER TABLE customers ADD COLUMN iibb_padron_period VARCHAR(6) NULL`,
                },
                {
                    name: 'iibb_padron_source',
                    sql: `ALTER TABLE customers ADD COLUMN iibb_padron_source VARCHAR(255) NULL`,
                },
                {
                    name: 'iibb_padron_updated_at',
                    sql: `ALTER TABLE customers ADD COLUMN iibb_padron_updated_at DATETIME NULL`,
                },
            ];
            for (const c of columns) {
                const exists = yield (0, db_1.get)(`SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'customers'
           AND COLUMN_NAME = ?`, [c.name]);
                if (!exists) {
                    yield (0, db_1.execute)(c.sql);
                    console.log(`[DB] customers.${c.name} agregada`);
                }
            }
        }
        catch (e) {
            console.error('[DB] Error agregando campos IIBB en customers:', (e === null || e === void 0 ? void 0 : e.message) || e);
        }
    });
}
