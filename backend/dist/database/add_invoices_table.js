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
exports.addInvoicesTable = addInvoicesTable;
const db_1 = require("./db");
/** Tabla de facturas AFIP emitidas por pedido (una factura por pedido). */
function addInvoicesTable() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('[DB] Verificando tabla invoices...');
        try {
            const t = yield (0, db_1.get)(`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices'`);
            if (!t) {
                yield (0, db_1.execute)(`
        CREATE TABLE invoices (
          id VARCHAR(36) PRIMARY KEY,
          order_id VARCHAR(36) NOT NULL UNIQUE,
          cae VARCHAR(20) NOT NULL,
          cae_fch_vto VARCHAR(20) DEFAULT NULL,
          punto_venta INT NOT NULL,
          cbte_tipo INT NOT NULL,
          cbte_desde INT NOT NULL,
          cbte_hasta INT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
        )
      `);
                console.log('[DB] Tabla invoices creada');
            }
            else {
                console.log('[DB] Tabla invoices ya existe');
            }
        }
        catch (e) {
            console.error('[DB] Error creando tabla invoices:', e === null || e === void 0 ? void 0 : e.message);
        }
    });
}
