import { execute } from './db';

export async function addCompanyFinanceTable(): Promise<void> {
  await execute(`
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
}
