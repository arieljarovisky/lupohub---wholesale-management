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
exports.addOrdersArchived = addOrdersArchived;
const db_1 = require("./db");
function addOrdersArchived() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('[DB] Verificando columna archived en orders...');
        try {
            const col = yield (0, db_1.get)(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'archived'`);
            if (col) {
                console.log('[DB] Columna orders.archived ya existe');
                return;
            }
            yield (0, db_1.execute)(`ALTER TABLE orders ADD COLUMN archived TINYINT(1) NOT NULL DEFAULT 0 AFTER dispatched_at`);
            console.log('[DB] Columna orders.archived agregada');
        }
        catch (e) {
            console.error('[DB] Error agregando orders.archived:', e === null || e === void 0 ? void 0 : e.message);
        }
    });
}
