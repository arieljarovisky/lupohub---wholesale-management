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
exports.addLupoStockWebhookConfigTable = void 0;
const db_1 = require("./db");
function addLupoStockWebhookConfigTable() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('[DB] Verificando tabla lupo_stock_webhook_config...');
        try {
            const row = yield (0, db_1.get)(`SELECT COUNT(*) AS cnt FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'lupo_stock_webhook_config'`);
            const exists = Number((row === null || row === void 0 ? void 0 : row.cnt) || 0) > 0;
            if (!exists) {
                yield (0, db_1.execute)(`
        CREATE TABLE lupo_stock_webhook_config (
          id INT PRIMARY KEY DEFAULT 1,
          enabled TINYINT(1) NOT NULL DEFAULT 0,
          webhook_url TEXT NULL,
          api_key TEXT NULL,
          webhook_secret TEXT NULL,
          timeout_ms INT NOT NULL DEFAULT 10000,
          max_retries INT NOT NULL DEFAULT 4,
          backoff_base_ms INT NOT NULL DEFAULT 1000,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CHECK (id = 1)
        )
      `);
                yield (0, db_1.execute)(`INSERT INTO lupo_stock_webhook_config (id, enabled, timeout_ms, max_retries, backoff_base_ms)
         VALUES (1, 0, 10000, 4, 1000)
         ON DUPLICATE KEY UPDATE id = id`);
                console.log('[DB] Tabla lupo_stock_webhook_config creada');
            }
            else {
                console.log('[DB] Tabla lupo_stock_webhook_config ya existe');
                yield (0, db_1.execute)(`INSERT INTO lupo_stock_webhook_config (id, enabled, timeout_ms, max_retries, backoff_base_ms)
         VALUES (1, 0, 10000, 4, 1000)
         ON DUPLICATE KEY UPDATE id = id`);
            }
        }
        catch (e) {
            console.error('[DB] Error verificando tabla lupo_stock_webhook_config:', e === null || e === void 0 ? void 0 : e.message);
        }
    });
}
exports.addLupoStockWebhookConfigTable = addLupoStockWebhookConfigTable;
