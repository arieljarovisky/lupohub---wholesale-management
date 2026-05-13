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
exports.addCustomerDeliveryAddresses = addCustomerDeliveryAddresses;
const db_1 = require("./db");
/** Direcciones adicionales de entrega / sucursales (JSON en customers.delivery_addresses). */
function addCustomerDeliveryAddresses() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const rows = yield (0, db_1.query)(`SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'delivery_addresses'`);
            if (Array.isArray(rows) && rows.length > 0)
                return;
            yield (0, db_1.execute)(`ALTER TABLE customers ADD COLUMN delivery_addresses TEXT NULL COMMENT 'JSON: sucursales [{id,label,address,city}]'`);
            console.log('[DB] customers.delivery_addresses agregada');
        }
        catch (e) {
            console.error('[DB] Error en addCustomerDeliveryAddresses:', e === null || e === void 0 ? void 0 : e.message);
        }
    });
}
