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
exports.addCreditNotesVoidedInvoiceSnapshot = addCreditNotesVoidedInvoiceSnapshot;
const db_1 = require("./db");
/**
 * Guarda en cada NC el comprobante de factura que se anuló (snapshot antes de reemplazar CAE)
 * y marca si esa NC quedó reemplazada por una nueva factura (reemisión con IIBB).
 */
function addCreditNotesVoidedInvoiceSnapshot() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('[DB] Verificando columnas credit_notes (voided_invoice / superseded_by_reinvoice)...');
        const cols = [
            {
                name: 'voided_invoice_cae',
                sql: `ALTER TABLE credit_notes ADD COLUMN voided_invoice_cae VARCHAR(20) NULL AFTER item_index`,
            },
            {
                name: 'voided_invoice_punto_venta',
                sql: `ALTER TABLE credit_notes ADD COLUMN voided_invoice_punto_venta INT NULL AFTER voided_invoice_cae`,
            },
            {
                name: 'voided_invoice_cbte_tipo',
                sql: `ALTER TABLE credit_notes ADD COLUMN voided_invoice_cbte_tipo INT NULL AFTER voided_invoice_punto_venta`,
            },
            {
                name: 'voided_invoice_cbte_desde',
                sql: `ALTER TABLE credit_notes ADD COLUMN voided_invoice_cbte_desde INT NULL AFTER voided_invoice_cbte_tipo`,
            },
            {
                name: 'superseded_by_reinvoice',
                sql: `ALTER TABLE credit_notes ADD COLUMN superseded_by_reinvoice TINYINT(1) NOT NULL DEFAULT 0 AFTER voided_invoice_cbte_desde`,
            },
        ];
        try {
            for (const c of cols) {
                const col = yield (0, db_1.get)(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_notes' AND COLUMN_NAME = ?`, [c.name]);
                if (!col) {
                    yield (0, db_1.execute)(c.sql);
                    console.log(`[DB] credit_notes: columna ${c.name} añadida`);
                }
            }
        }
        catch (e) {
            console.error('[DB] Error en addCreditNotesVoidedInvoiceSnapshot:', e === null || e === void 0 ? void 0 : e.message);
        }
    });
}
