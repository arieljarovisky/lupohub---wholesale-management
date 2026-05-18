import { execute } from './db';

export async function addCompanyFinanceFixedExpensesTable(): Promise<void> {
  await execute(`
    CREATE TABLE IF NOT EXISTS company_finance_fixed_expenses (
      id VARCHAR(36) PRIMARY KEY,
      category VARCHAR(64) NOT NULL,
      amount DECIMAL(14, 2) NOT NULL,
      description VARCHAR(255) NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      starts_from DATE NULL,
      ends_at DATE NULL,
      created_by_user_id VARCHAR(36) NULL,
      created_by_email VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_company_finance_fixed_active (active),
      CONSTRAINT fk_company_finance_fixed_user
        FOREIGN KEY (created_by_user_id) REFERENCES users(id)
        ON DELETE SET NULL
    )
  `);
}
