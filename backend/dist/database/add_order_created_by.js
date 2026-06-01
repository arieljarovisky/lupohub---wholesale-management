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
exports.addOrderCreatedBy = addOrderCreatedBy;
const db_1 = require("./db");
/** Quién creó el pedido (usuario de la sesión). Pedidos viejos quedan NULL. */
function addOrderCreatedBy() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('[DB] Verificando columna created_by en orders...');
        try {
            const col = yield (0, db_1.get)(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'created_by'`);
            if (col) {
                console.log('[DB] Columna orders.created_by ya existe');
                return;
            }
            yield (0, db_1.execute)(`ALTER TABLE orders ADD COLUMN created_by VARCHAR(36) NULL DEFAULT NULL AFTER picked_by`);
            try {
                yield (0, db_1.execute)(`ALTER TABLE orders ADD CONSTRAINT fk_orders_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL`);
            }
            catch (e) {
                if ((e === null || e === void 0 ? void 0 : e.code) !== 'ER_DUP_KEYNAME' && (e === null || e === void 0 ? void 0 : e.errno) !== 1022) {
                    console.warn('[DB] FK created_by (opcional):', e === null || e === void 0 ? void 0 : e.message);
                }
            }
            console.log('[DB] Columna orders.created_by agregada');
        }
        catch (e) {
            console.error('[DB] Error agregando orders.created_by:', e === null || e === void 0 ? void 0 : e.message);
        }
    });
}
