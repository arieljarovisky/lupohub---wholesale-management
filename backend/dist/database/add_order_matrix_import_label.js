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
exports.addOrderMatrixImportLabel = void 0;
const db_1 = require("./db");
/** Etiqueta opcional (p. ej. import matriz: a facturar vs pendiente según color de celda). */
function addOrderMatrixImportLabel() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('[DB] Verificando columna matrix_import_label en orders...');
        try {
            const col = yield (0, db_1.get)(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'matrix_import_label'`);
            if (col) {
                console.log('[DB] Columna orders.matrix_import_label ya existe');
                return;
            }
            yield (0, db_1.execute)(`ALTER TABLE orders ADD COLUMN matrix_import_label VARCHAR(120) NULL`);
            console.log('[DB] Columna orders.matrix_import_label agregada');
        }
        catch (e) {
            console.error('[DB] Error agregando orders.matrix_import_label:', e === null || e === void 0 ? void 0 : e.message);
        }
    });
}
exports.addOrderMatrixImportLabel = addOrderMatrixImportLabel;
