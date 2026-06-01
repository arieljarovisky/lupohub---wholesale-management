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
exports.addPriceLists = addPriceLists;
/**
 * Crea tablas de listas de precios y agrega price_list_id a users y customers.
 */
const db_1 = require("./db");
function addPriceLists() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const hasTable = yield (0, db_1.query)(`SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'price_lists'`);
            if (Array.isArray(hasTable) && hasTable.length > 0) {
                console.log('[DB] Tablas de listas de precios ya existen');
            }
            else {
                yield (0, db_1.execute)(`
        CREATE TABLE price_lists (
          id VARCHAR(36) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          description TEXT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
                yield (0, db_1.execute)(`
        CREATE TABLE price_list_items (
          id VARCHAR(36) PRIMARY KEY,
          price_list_id VARCHAR(36) NOT NULL,
          product_id VARCHAR(36) NOT NULL,
          price DECIMAL(10, 2) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_price_list_product (price_list_id, product_id),
          FOREIGN KEY (price_list_id) REFERENCES price_lists(id) ON DELETE CASCADE,
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        )
      `);
                console.log('[DB] Tablas price_lists y price_list_items creadas');
            }
            const colUser = yield (0, db_1.query)(`SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'price_list_id'`);
            if (Array.isArray(colUser) && colUser.length === 0) {
                yield (0, db_1.execute)(`ALTER TABLE users ADD COLUMN price_list_id VARCHAR(36) NULL AFTER commission_percentage`);
                yield (0, db_1.execute)(`ALTER TABLE users ADD CONSTRAINT fk_users_price_list FOREIGN KEY (price_list_id) REFERENCES price_lists(id) ON DELETE SET NULL`);
                console.log('[DB] Columna price_list_id agregada a users');
            }
            else {
                console.log('[DB] Columna price_list_id ya existe en users');
            }
            const colCustomer = yield (0, db_1.query)(`SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'price_list_id'`);
            if (Array.isArray(colCustomer) && colCustomer.length === 0) {
                yield (0, db_1.execute)(`ALTER TABLE customers ADD COLUMN price_list_id VARCHAR(36) NULL`);
                yield (0, db_1.execute)(`ALTER TABLE customers ADD CONSTRAINT fk_customers_price_list FOREIGN KEY (price_list_id) REFERENCES price_lists(id) ON DELETE SET NULL`);
                console.log('[DB] Columna price_list_id agregada a customers');
            }
            else {
                console.log('[DB] Columna price_list_id ya existe en customers');
            }
        }
        catch (e) {
            console.error('[DB] Error en add_price_lists:', e === null || e === void 0 ? void 0 : e.message);
            throw e;
        }
    });
}
