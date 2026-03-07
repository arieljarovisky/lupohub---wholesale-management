/**
 * Crea tablas de listas de precios y agrega price_list_id a users y customers.
 */
import { query, execute } from './db';

export async function addPriceLists(): Promise<void> {
  try {
    const hasTable = await query(
      `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'price_lists'`
    );
    if (Array.isArray(hasTable) && hasTable.length > 0) {
      console.log('[DB] Tablas de listas de precios ya existen');
    } else {
      await execute(`
        CREATE TABLE price_lists (
          id VARCHAR(36) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          description TEXT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      await execute(`
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

    const colUser = await query(
      `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'price_list_id'`
    );
    if (Array.isArray(colUser) && colUser.length === 0) {
      await execute(`ALTER TABLE users ADD COLUMN price_list_id VARCHAR(36) NULL AFTER commission_percentage`);
      await execute(`ALTER TABLE users ADD CONSTRAINT fk_users_price_list FOREIGN KEY (price_list_id) REFERENCES price_lists(id) ON DELETE SET NULL`);
      console.log('[DB] Columna price_list_id agregada a users');
    } else {
      console.log('[DB] Columna price_list_id ya existe en users');
    }

    const colCustomer = await query(
      `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'price_list_id'`
    );
    if (Array.isArray(colCustomer) && colCustomer.length === 0) {
      await execute(`ALTER TABLE customers ADD COLUMN price_list_id VARCHAR(36) NULL`);
      await execute(`ALTER TABLE customers ADD CONSTRAINT fk_customers_price_list FOREIGN KEY (price_list_id) REFERENCES price_lists(id) ON DELETE SET NULL`);
      console.log('[DB] Columna price_list_id agregada a customers');
    } else {
      console.log('[DB] Columna price_list_id ya existe en customers');
    }
  } catch (e: any) {
    console.error('[DB] Error en add_price_lists:', e?.message);
    throw e;
  }
}
