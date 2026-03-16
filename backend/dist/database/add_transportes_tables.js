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
exports.addTransportesTables = addTransportesTables;
const db_1 = require("./db");
/** Crea tablas de transportes (express) y asignación a clientes. */
function addTransportesTables() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('[DB] Verificando tablas transportes...');
        try {
            const t = yield (0, db_1.get)(`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transportes'`);
            if (!t) {
                yield (0, db_1.execute)(`
        CREATE TABLE transportes (
          id VARCHAR(36) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          address VARCHAR(500) NULL
        )
      `);
                console.log('[DB] Tabla transportes creada');
            }
            else {
                const col = yield (0, db_1.get)(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transportes' AND COLUMN_NAME = 'address'`);
                if (!col) {
                    yield (0, db_1.execute)(`ALTER TABLE transportes ADD COLUMN address VARCHAR(500) NULL AFTER name`);
                    console.log('[DB] Columna transportes.address agregada');
                }
            }
            const ct = yield (0, db_1.get)(`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customer_transportes'`);
            if (!ct) {
                yield (0, db_1.execute)(`
        CREATE TABLE customer_transportes (
          customer_id VARCHAR(36) NOT NULL,
          transporte_id VARCHAR(36) NOT NULL,
          PRIMARY KEY (customer_id, transporte_id),
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
          FOREIGN KEY (transporte_id) REFERENCES transportes(id) ON DELETE CASCADE
        )
      `);
                console.log('[DB] Tabla customer_transportes creada');
            }
            else {
                console.log('[DB] Tabla customer_transportes ya existe');
            }
        }
        catch (e) {
            console.error('[DB] Error creando tablas transportes:', e === null || e === void 0 ? void 0 : e.message);
        }
    });
}
