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
exports.addCustomerSellerCommission = void 0;
/**
 * Comisión del vendedor por cliente (%). Si es NULL, se usa users.commission_percentage del vendedor asignado.
 */
const db_1 = require("./db");
function addCustomerSellerCommission() {
    return __awaiter(this, void 0, void 0, function* () {
        const col = yield (0, db_1.query)(`SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'seller_commission_percentage'`);
        if (Array.isArray(col) && col.length > 0) {
            console.log('[DB] Columna seller_commission_percentage ya existe en customers');
            return;
        }
        yield (0, db_1.execute)(`ALTER TABLE customers ADD COLUMN seller_commission_percentage DECIMAL(5,2) NULL AFTER seller_id`);
        console.log('[DB] Columna seller_commission_percentage agregada a customers');
    });
}
exports.addCustomerSellerCommission = addCustomerSellerCommission;
