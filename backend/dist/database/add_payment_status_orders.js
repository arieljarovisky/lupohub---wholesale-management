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
exports.addPaymentStatusToOrders = addPaymentStatusToOrders;
const db_1 = require("./db");
/** Estado de cobro del pedido mayorista (cuenta corriente / saldos pendientes). */
function addPaymentStatusToOrders() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('[DB] Verificando columna payment_status en orders...');
        try {
            const col = yield (0, db_1.get)(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'payment_status'`);
            if (col) {
                console.log('[DB] orders.payment_status ya existe');
                return;
            }
            yield (0, db_1.execute)(`ALTER TABLE orders ADD COLUMN payment_status VARCHAR(20) NOT NULL DEFAULT 'pendiente' AFTER total`);
            yield (0, db_1.execute)(`UPDATE orders SET payment_status = 'pagado'`);
            console.log('[DB] orders.payment_status agregada; pedidos existentes marcados como pagados');
        }
        catch (e) {
            console.error('[DB] Error agregando orders.payment_status:', e === null || e === void 0 ? void 0 : e.message);
        }
    });
}
