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
exports.addCreditNoteItemsTable = addCreditNoteItemsTable;
const db_1 = require("./db");
/** Detalle por ítem para notas de crédito parciales (permite múltiples artículos en una misma NC). */
function addCreditNoteItemsTable() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const existsRow = yield (0, db_1.get)(`SELECT COUNT(*) AS cnt
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'credit_note_items'`);
            const exists = Number((existsRow === null || existsRow === void 0 ? void 0 : existsRow.cnt) || 0) > 0;
            if (!exists) {
                yield (0, db_1.execute)(`CREATE TABLE credit_note_items (
           id VARCHAR(36) PRIMARY KEY,
           credit_note_id VARCHAR(36) NOT NULL,
           order_id VARCHAR(36) NOT NULL,
           item_index INT NOT NULL,
           quantity INT NOT NULL,
           amount_credited DECIMAL(10, 2) NOT NULL,
           created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
           INDEX idx_cni_order_item (order_id, item_index),
           INDEX idx_cni_credit_note (credit_note_id),
           CONSTRAINT fk_cni_credit_note FOREIGN KEY (credit_note_id) REFERENCES credit_notes(id) ON DELETE CASCADE
         )`);
                console.log('[DB] Tabla credit_note_items creada');
                return;
            }
            const hasQty = yield (0, db_1.get)(`SELECT COUNT(*) AS cnt
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'credit_note_items'
         AND COLUMN_NAME = 'quantity'`);
            if (Number((hasQty === null || hasQty === void 0 ? void 0 : hasQty.cnt) || 0) === 0) {
                yield (0, db_1.execute)(`ALTER TABLE credit_note_items ADD COLUMN quantity INT NOT NULL DEFAULT 1 AFTER item_index`);
                console.log('[DB] Columna credit_note_items.quantity agregada');
            }
        }
        catch (e) {
            console.error('[DB] addCreditNoteItemsTable:', (e === null || e === void 0 ? void 0 : e.message) || e);
        }
    });
}
