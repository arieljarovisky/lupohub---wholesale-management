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
exports.addOrderReferenceToOrders = addOrderReferenceToOrders;
const db_1 = require("./db");
/** Agrega referencia opcional (nota/identificador) en pedidos. */
function addOrderReferenceToOrders() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const row = yield (0, db_1.get)(`SELECT COUNT(*) AS cnt
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'orders'
         AND COLUMN_NAME = 'reference'`);
            const exists = Number((row === null || row === void 0 ? void 0 : row.cnt) || 0) > 0;
            if (exists)
                return;
            yield (0, db_1.execute)(`ALTER TABLE orders
       ADD COLUMN reference VARCHAR(255) NULL
       AFTER total`);
            console.log('[DB] Columna orders.reference agregada');
        }
        catch (e) {
            console.error('[DB] addOrderReferenceToOrders:', (e === null || e === void 0 ? void 0 : e.message) || e);
        }
    });
}
