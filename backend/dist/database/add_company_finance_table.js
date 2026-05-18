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
exports.addCompanyFinanceTable = addCompanyFinanceTable;
const db_1 = require("./db");
function addCompanyFinanceTable() {
    return __awaiter(this, void 0, void 0, function* () {
        yield (0, db_1.execute)(`
    CREATE TABLE IF NOT EXISTS company_finance_entries (
      id VARCHAR(36) PRIMARY KEY,
      entry_type ENUM('expense', 'income') NOT NULL,
      category VARCHAR(64) NOT NULL,
      amount DECIMAL(14, 2) NOT NULL,
      description TEXT NULL,
      entry_date DATE NOT NULL,
      created_by_user_id VARCHAR(36) NULL,
      created_by_email VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_company_finance_date (entry_date),
      INDEX idx_company_finance_type_date (entry_type, entry_date),
      INDEX idx_company_finance_category (category),
      CONSTRAINT fk_company_finance_user
        FOREIGN KEY (created_by_user_id) REFERENCES users(id)
        ON DELETE SET NULL
    )
  `);
    });
}
