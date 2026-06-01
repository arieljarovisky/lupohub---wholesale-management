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
exports.addOrdersPerformanceIndexes = addOrdersPerformanceIndexes;
const db_1 = require("./db");
/** Índices para acelerar listados de pedidos, ítems e IIBB (AGIP). Idempotente. */
function addOrdersPerformanceIndexes() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('[DB] Verificando índices de performance (orders / order_items / AGIP)...');
        const ensureIndex = (table, indexName, ddl) => __awaiter(this, void 0, void 0, function* () {
            const row = yield (0, db_1.get)(`SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`, [table, indexName]);
            if (Number(row === null || row === void 0 ? void 0 : row.cnt))
                return;
            try {
                yield (0, db_1.execute)(ddl);
                console.log(`[DB] Índice ${indexName} en ${table} creado`);
            }
            catch (e) {
                console.warn(`[DB] No se pudo crear ${indexName}:`, (e === null || e === void 0 ? void 0 : e.message) || e);
            }
        });
        const tableExists = (name) => __awaiter(this, void 0, void 0, function* () {
            const row = yield (0, db_1.get)(`SELECT COUNT(*) AS cnt FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = ?`, [name]);
            return Number(row === null || row === void 0 ? void 0 : row.cnt) > 0;
        });
        yield ensureIndex('orders', 'idx_orders_customer_date', 'CREATE INDEX idx_orders_customer_date ON orders (customer_id, date DESC)');
        yield ensureIndex('orders', 'idx_orders_date', 'CREATE INDEX idx_orders_date ON orders (date DESC)');
        yield ensureIndex('orders', 'idx_orders_archived_date', 'CREATE INDEX idx_orders_archived_date ON orders (archived, date DESC)');
        if (yield tableExists('stock_movements')) {
            yield ensureIndex('stock_movements', 'idx_stock_movements_type_reference', 'CREATE INDEX idx_stock_movements_type_reference ON stock_movements (movement_type, reference(64))');
        }
        if (yield tableExists('agip_padron_alicuotas')) {
            yield ensureIndex('agip_padron_alicuotas', 'idx_agip_padron_period_cuit', 'CREATE INDEX idx_agip_padron_period_cuit ON agip_padron_alicuotas (period_yyyymm, cuit)');
        }
    });
}
