import { execute } from './db';

export async function addCatalogsTable(): Promise<void> {
  await execute(`
    CREATE TABLE IF NOT EXISTS catalogs (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      file_path VARCHAR(500) NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(100) DEFAULT 'application/pdf',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}
