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
exports.addRemitoSequence = addRemitoSequence;
const db_1 = require("./db");
/**
 * Crea la tabla `remito_sequence` (contador atómico para numerar remitos) y agrega
 * la columna `orders.remito_number` (INT UNIQUE) que guarda el número asignado a cada pedido.
 *
 * La secuencia arranca en 31457 según requerimiento operativo del negocio.
 * El campo en `orders` es UNIQUE para garantizar que dos pedidos no puedan compartir el mismo número.
 */
function addRemitoSequence() {
    return __awaiter(this, void 0, void 0, function* () {
        const START_VALUE = 31457;
        console.log('[DB] Verificando tabla remito_sequence y columna orders.remito_number...');
        try {
            const tableExists = yield (0, db_1.get)(`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'remito_sequence'`);
            if (!tableExists) {
                yield (0, db_1.execute)(`
        CREATE TABLE remito_sequence (
          id TINYINT NOT NULL PRIMARY KEY,
          next_value INT NOT NULL,
          CHECK (id = 1)
        )
      `);
                yield (0, db_1.execute)(`INSERT INTO remito_sequence (id, next_value) VALUES (1, ?)
         ON DUPLICATE KEY UPDATE next_value = next_value`, [START_VALUE]);
                console.log(`[DB] remito_sequence creada, next_value=${START_VALUE}`);
            }
            else {
                // Asegurar que exista la fila (id=1). Si no existe, insertarla.
                const row = yield (0, db_1.get)(`SELECT next_value FROM remito_sequence WHERE id = 1`);
                if (!row) {
                    yield (0, db_1.execute)(`INSERT INTO remito_sequence (id, next_value) VALUES (1, ?)`, [START_VALUE]);
                    console.log(`[DB] remito_sequence row id=1 creada con next_value=${START_VALUE}`);
                }
            }
            const colExists = yield (0, db_1.get)(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'remito_number'`);
            if (!colExists) {
                yield (0, db_1.execute)(`ALTER TABLE orders ADD COLUMN remito_number INT NULL`);
                yield (0, db_1.execute)(`ALTER TABLE orders ADD UNIQUE KEY uniq_orders_remito_number (remito_number)`);
                console.log('[DB] orders.remito_number agregada (UNIQUE)');
            }
            else {
                const uniqueExists = yield (0, db_1.get)(`SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND CONSTRAINT_NAME = 'uniq_orders_remito_number'`);
                if (!uniqueExists) {
                    try {
                        yield (0, db_1.execute)(`ALTER TABLE orders ADD UNIQUE KEY uniq_orders_remito_number (remito_number)`);
                        console.log('[DB] orders.remito_number UNIQUE agregado');
                    }
                    catch (e) {
                        console.error('[DB] No se pudo agregar UNIQUE a orders.remito_number (¿hay duplicados?):', e === null || e === void 0 ? void 0 : e.message);
                    }
                }
            }
        }
        catch (e) {
            console.error('[DB] Error creando/verificando remito_sequence:', e === null || e === void 0 ? void 0 : e.message);
        }
    });
}
