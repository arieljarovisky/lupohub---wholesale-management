/**
 * Crea tabla seller_price_lists para asignar listas de precios específicas a vendedores.
 * Relación muchos-a-muchos entre users (SELLER) y price_lists.
 */
import { query, execute } from './db';

export async function addSellerPriceLists(): Promise<void> {
  try {
    const hasTable = await query(
      `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'seller_price_lists'`
    );
    if (Array.isArray(hasTable) && hasTable.length > 0) {
      console.log('[DB] Tabla seller_price_lists ya existe');
      return;
    }

    await execute(`
      CREATE TABLE seller_price_lists (
        id VARCHAR(36) PRIMARY KEY,
        seller_id VARCHAR(36) NOT NULL,
        price_list_id VARCHAR(36) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_seller_price_list (seller_id, price_list_id),
        FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (price_list_id) REFERENCES price_lists(id) ON DELETE CASCADE
      )
    `);
    console.log('[DB] Tabla seller_price_lists creada');
  } catch (e: any) {
    console.error('[DB] Error en add_seller_price_lists:', e?.message);
    throw e;
  }
}
