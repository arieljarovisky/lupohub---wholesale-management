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
exports.addCustomerMultimediaLedger = void 0;
const db_1 = require("./db");
/** Código legacy Multimedias, zona/vendedor de cuenta corriente, y movimientos importados del Excel historial. */
function addCustomerMultimediaLedger() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('[DB] Verificando multimedia ledger (customers + customer_multimedia_entries)...');
        try {
            const customerCols = [
                { name: 'legacy_code', sql: `ALTER TABLE customers ADD COLUMN legacy_code VARCHAR(32) NULL` },
                { name: 'account_zone', sql: `ALTER TABLE customers ADD COLUMN account_zone VARCHAR(120) NULL` },
                { name: 'account_seller_label', sql: `ALTER TABLE customers ADD COLUMN account_seller_label VARCHAR(200) NULL` },
            ];
            for (const c of customerCols) {
                const exists = yield (0, db_1.get)(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = ?`, [c.name]);
                if (!exists) {
                    yield (0, db_1.execute)(c.sql);
                    console.log(`[DB] customers.${c.name} agregada`);
                }
            }
            const idx = yield (0, db_1.get)(`SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND INDEX_NAME = 'idx_customers_legacy_code'`);
            if (!Number(idx === null || idx === void 0 ? void 0 : idx.cnt)) {
                try {
                    yield (0, db_1.execute)(`CREATE INDEX idx_customers_legacy_code ON customers (legacy_code)`);
                    console.log('[DB] idx_customers_legacy_code creado');
                }
                catch (_a) {
                    /* ignore */
                }
            }
            const tableRow = yield (0, db_1.get)(`SELECT COUNT(*) AS cnt FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'customer_multimedia_entries'`);
            if (!Number(tableRow === null || tableRow === void 0 ? void 0 : tableRow.cnt)) {
                yield (0, db_1.execute)(`
        CREATE TABLE customer_multimedia_entries (
          id VARCHAR(36) PRIMARY KEY,
          customer_id VARCHAR(36) NOT NULL,
          line_order INT NOT NULL DEFAULT 0,
          line_date DATE NOT NULL,
          tipo VARCHAR(40) NOT NULL,
          numero VARCHAR(120) NULL,
          edc VARCHAR(20) NULL,
          vto DATE NULL,
          importe DECIMAL(16,2) NULL,
          saldo DECIMAL(16,2) NULL,
          detalle VARCHAR(500) NULL,
          pagina_pdf VARCHAR(40) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_cme_customer_order (customer_id, line_order),
          INDEX idx_cme_customer_date (customer_id, line_date),
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
        )
      `);
                console.log('[DB] customer_multimedia_entries creada');
            }
        }
        catch (e) {
            console.error('[DB] Error multimedia ledger:', e === null || e === void 0 ? void 0 : e.message);
        }
    });
}
exports.addCustomerMultimediaLedger = addCustomerMultimediaLedger;
