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
exports.addPaymentInvoicesTable = addPaymentInvoicesTable;
const db_1 = require("./db");
/**
 * Tabla puente para asociar un recibo con múltiples facturas.
 * Mantiene compatibilidad con payments.invoice_id (legacy).
 */
function addPaymentInvoicesTable() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('[DB] Verificando tabla payment_invoices...');
        try {
            yield (0, db_1.execute)(`
      CREATE TABLE IF NOT EXISTS payment_invoices (
        payment_id VARCHAR(36) NOT NULL,
        invoice_id VARCHAR(36) NOT NULL,
        amount_applied DECIMAL(12,2) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (payment_id, invoice_id),
        INDEX idx_payment_invoices_invoice (invoice_id),
        CONSTRAINT fk_payment_invoices_payment
          FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
        CONSTRAINT fk_payment_invoices_invoice
          FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
      )
    `);
            // Backfill: reflejar vínculos legacy de payments.invoice_id en la tabla puente.
            yield (0, db_1.execute)(`
      INSERT IGNORE INTO payment_invoices (payment_id, invoice_id)
      SELECT p.id, p.invoice_id
      FROM payments p
      WHERE p.invoice_id IS NOT NULL AND TRIM(p.invoice_id) <> ''
    `);
            const row = yield (0, db_1.get)(`SELECT COUNT(*) AS cnt FROM payment_invoices`);
            console.log(`[DB] payment_invoices OK (${Number((row === null || row === void 0 ? void 0 : row.cnt) || 0)} relación/es)`);
        }
        catch (e) {
            console.error('[DB] Error creando/verificando payment_invoices:', e === null || e === void 0 ? void 0 : e.message);
        }
    });
}
