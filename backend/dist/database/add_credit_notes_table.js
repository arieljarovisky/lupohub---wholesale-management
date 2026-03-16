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
exports.addCreditNotesTable = addCreditNotesTable;
const db_1 = require("./db");
/** Tabla de notas de crédito AFIP (asociadas a una factura de un pedido). */
function addCreditNotesTable() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('[DB] Verificando tabla credit_notes...');
        try {
            const t = yield (0, db_1.get)(`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_notes'`);
            if (!t) {
                yield (0, db_1.execute)(`
        CREATE TABLE credit_notes (
          id VARCHAR(36) PRIMARY KEY,
          order_id VARCHAR(36) NOT NULL,
          invoice_id VARCHAR(36) NOT NULL,
          cae VARCHAR(20) NOT NULL,
          cae_fch_vto VARCHAR(20) DEFAULT NULL,
          punto_venta INT NOT NULL,
          cbte_tipo INT NOT NULL,
          cbte_desde INT NOT NULL,
          cbte_hasta INT NOT NULL,
          amount_credited DECIMAL(12, 2) NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
          FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
        )
      `);
                console.log('[DB] Tabla credit_notes creada');
            }
            else {
                console.log('[DB] Tabla credit_notes ya existe');
            }
        }
        catch (e) {
            console.error('[DB] Error creando tabla credit_notes:', e === null || e === void 0 ? void 0 : e.message);
        }
    });
}
