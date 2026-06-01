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
exports.addExternalCreditNotesTable = void 0;
const db_1 = require("./db");
/** Notas de crédito AFIP emitidas para facturas externas (TN/ML). */
function addExternalCreditNotesTable() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('[DB] Verificando tabla external_credit_notes...');
        try {
            const row = yield (0, db_1.get)(`SELECT COUNT(*) AS cnt FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'external_credit_notes'`);
            const exists = Number((row === null || row === void 0 ? void 0 : row.cnt) || 0) > 0;
            if (!exists) {
                yield (0, db_1.execute)(`
        CREATE TABLE external_credit_notes (
          id VARCHAR(36) PRIMARY KEY,
          external_invoice_id VARCHAR(36) NOT NULL,
          source VARCHAR(40) NOT NULL,
          external_order_id VARCHAR(80) NOT NULL,
          cae VARCHAR(20) NOT NULL,
          cae_fch_vto VARCHAR(20) DEFAULT NULL,
          punto_venta INT NOT NULL,
          cbte_tipo INT NOT NULL,
          cbte_desde INT NOT NULL,
          cbte_hasta INT NOT NULL,
          amount_credited DECIMAL(12,2) NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_external_nc_invoice (external_invoice_id),
          INDEX idx_external_nc_source_created (source, created_at)
        )
      `);
                console.log('[DB] Tabla external_credit_notes creada');
            }
            else {
                console.log('[DB] Tabla external_credit_notes ya existe');
            }
        }
        catch (e) {
            console.error('[DB] Error creando tabla external_credit_notes:', e === null || e === void 0 ? void 0 : e.message);
        }
    });
}
exports.addExternalCreditNotesTable = addExternalCreditNotesTable;
