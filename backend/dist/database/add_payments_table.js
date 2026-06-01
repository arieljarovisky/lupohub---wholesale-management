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
exports.addPaymentsTable = addPaymentsTable;
const db_1 = require("./db");
/** Evita doble inserción del mismo recibo (doble click o dos POST simultáneos). */
function ensurePaymentsNaturalUniqueIndex() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const row = yield (0, db_1.get)(`SELECT COUNT(*) AS cnt FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = 'payments'
         AND index_name = 'uq_payments_client_recibo_fecha_importe'`);
            if (Number((row === null || row === void 0 ? void 0 : row.cnt) || 0) > 0) {
                console.log('[DB] Índice uq_payments_client_recibo_fecha_importe ya existe');
                return;
            }
            yield (0, db_1.execute)(`CREATE UNIQUE INDEX uq_payments_client_recibo_fecha_importe
       ON payments (customer_id, receipt_number(80), date, amount)`);
            console.log('[DB] Índice único uq_payments_client_recibo_fecha_importe creado');
        }
        catch (e) {
            const code = e === null || e === void 0 ? void 0 : e.code;
            const msg = String((e === null || e === void 0 ? void 0 : e.message) || '');
            if (code === 'ER_DUP_KEYNAME' || msg.includes('Duplicate key name'))
                return;
            if (code === 'ER_DUP_ENTRY' || msg.includes('Duplicate entry')) {
                console.warn('[DB] No se aplicó índice único en payments: hay filas duplicadas (cliente+recibo+fecha+importe). Eliminá duplicados y reiniciá el servidor.');
                return;
            }
            console.warn('[DB] ensurePaymentsNaturalUniqueIndex:', msg);
        }
    });
}
/** Tabla de pagos/recibos de clientes (cuenta corriente). */
function addPaymentsTable() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('[DB] Verificando tabla payments...');
        try {
            const row = yield (0, db_1.get)(`SELECT COUNT(*) AS cnt FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'payments'`);
            const exists = Number((row === null || row === void 0 ? void 0 : row.cnt) || 0) > 0;
            if (exists) {
                console.log('[DB] payments ya existe');
                yield ensurePaymentsNaturalUniqueIndex();
                return;
            }
            yield (0, db_1.execute)(`
      CREATE TABLE payments (
        id VARCHAR(36) PRIMARY KEY,
        customer_id VARCHAR(36) NOT NULL,
        seller_id VARCHAR(36) NULL,
        order_id VARCHAR(36) NULL,
        invoice_id VARCHAR(36) NULL,
        receipt_number VARCHAR(100) NOT NULL,
        date DATE NOT NULL,
        amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        notes TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_payments_customer_date (customer_id, date),
        INDEX idx_payments_invoice (invoice_id),
        INDEX idx_payments_order (order_id),
        INDEX idx_payments_seller (seller_id)
      )
    `);
            console.log('[DB] Tabla payments creada');
            yield ensurePaymentsNaturalUniqueIndex();
        }
        catch (e) {
            console.error('[DB] Error creando tabla payments:', e === null || e === void 0 ? void 0 : e.message);
        }
    });
}
