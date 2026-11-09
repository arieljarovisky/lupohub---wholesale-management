import { execute } from './db';

/** Una fila por variante y por día. Sirve para comparar cómo baja el stock entre fechas. */
export async function addStockDailySnapshots(): Promise<void> {
  try {
    await execute(`
      CREATE TABLE IF NOT EXISTS stock_daily_snapshots (
        snapshot_date DATE NOT NULL,
        variant_id VARCHAR(36) NOT NULL,
        sku VARCHAR(120) NULL,
        product_sku VARCHAR(100) NULL,
        product_name VARCHAR(255) NULL,
        color_name VARCHAR(120) NULL,
        size_code VARCHAR(100) NULL,
        stock INT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (snapshot_date, variant_id),
        INDEX idx_stock_daily_snapshot_date (snapshot_date)
      )
    `);
    console.log('[DB] stock_daily_snapshots lista');
  } catch (e: any) {
    console.error('[DB] Error creando stock_daily_snapshots:', e?.message);
  }
}
