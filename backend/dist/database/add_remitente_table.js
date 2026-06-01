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
exports.addRemitenteTable = void 0;
const db_1 = require("./db");
/** Guarda los datos del remitente (para remitos + factura) en la DB. */
function addRemitenteTable() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('[DB] Verificando tabla remitente_config...');
        try {
            const tbl = yield (0, db_1.get)(`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'remitente_config'`);
            if (!tbl) {
                yield (0, db_1.execute)(`
        CREATE TABLE IF NOT EXISTS remitente_config (
          id INT AUTO_INCREMENT PRIMARY KEY,
          business_name VARCHAR(255) NULL,
          cuit VARCHAR(20) NULL,
          address VARCHAR(255) NULL,
          city VARCHAR(100) NULL,
          email VARCHAR(255) NULL,
          phone VARCHAR(50) NULL,
          logo_url TEXT NULL,
          cai_remito VARCHAR(100) NULL,
          cai_remito_vencimiento DATE NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
                console.log('[DB] Tabla remitente_config creada.');
            }
            else {
                console.log('[DB] Tabla remitente_config ya existe.');
            }
        }
        catch (e) {
            console.error('[DB] Error verificando/creando remitente_config:', (e === null || e === void 0 ? void 0 : e.message) || e);
        }
    });
}
exports.addRemitenteTable = addRemitenteTable;
