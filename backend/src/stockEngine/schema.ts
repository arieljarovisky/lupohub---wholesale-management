/**
 * Tablas del motor de stock.
 *
 * - stock_movements (+ columnas): libro de movimientos con clave de idempotencia.
 * - stock_sync_queue: cola persistente "esta variante tiene que llegar a ML/TN".
 * - stock_sync_targets: último resultado por publicación (para la pantalla).
 * - channel_orders / channel_order_lines: ventas de TN/ML ya procesadas, línea por línea.
 * - stock_alerts: avisos para el usuario (vendiste sin stock, etc.).
 * - wholesale_order_stock: unidades que cada pedido mayorista tiene tomadas del stock.
 * - stock_engine_state: valores sueltos (fecha de corte, último reenvío total).
 */
import { execute, get, query } from '../database/db';

async function columnExists(table: string, column: string): Promise<boolean> {
  const row = await get(
    `SELECT 1 AS ok FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return !!row;
}

async function indexExists(table: string, index: string): Promise<boolean> {
  const row = await get(
    `SELECT 1 AS ok FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, index]
  );
  return !!row;
}

export async function getEngineState(key: string): Promise<string | null> {
  const row = await get(`SELECT v FROM stock_engine_state WHERE k = ?`, [key]);
  return row?.v != null ? String(row.v) : null;
}

export async function setEngineState(key: string, value: string): Promise<void> {
  await execute(
    `INSERT INTO stock_engine_state (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)`,
    [key, value]
  );
}

export async function ensureStockEngineSchema(): Promise<void> {
  // --- stock_movements: columnas nuevas ---
  if (!(await columnExists('stock_movements', 'source'))) {
    await execute(`ALTER TABLE stock_movements ADD COLUMN source VARCHAR(32) NULL`);
  }
  if (!(await columnExists('stock_movements', 'source_id'))) {
    await execute(`ALTER TABLE stock_movements ADD COLUMN source_id VARCHAR(191) NULL`);
  }
  if (!(await columnExists('stock_movements', 'idempotency_key'))) {
    await execute(`ALTER TABLE stock_movements ADD COLUMN idempotency_key VARCHAR(191) NULL`);
  }
  if (!(await indexExists('stock_movements', 'uq_stock_movements_idem'))) {
    await execute(`ALTER TABLE stock_movements ADD UNIQUE KEY uq_stock_movements_idem (idempotency_key)`);
  }
  if (!(await indexExists('stock_movements', 'idx_stock_movements_source'))) {
    await execute(`ALTER TABLE stock_movements ADD INDEX idx_stock_movements_source (source, source_id)`);
  }
  if (!(await indexExists('stock_movements', 'idx_stock_movements_reference'))) {
    await execute(`ALTER TABLE stock_movements ADD INDEX idx_stock_movements_reference (reference)`);
  }

  await execute(`
    CREATE TABLE IF NOT EXISTS stock_engine_state (
      k VARCHAR(64) PRIMARY KEY,
      v TEXT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS stock_sync_queue (
      variant_id VARCHAR(36) PRIMARY KEY,
      version INT NOT NULL DEFAULT 1,
      due_at DATETIME(3) NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      priority TINYINT NOT NULL DEFAULT 0,
      locked_until DATETIME(3) NULL,
      lock_token VARCHAR(36) NULL,
      last_error TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_stock_sync_queue_due (priority, due_at),
      INDEX idx_stock_sync_queue_token (lock_token)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS stock_sync_targets (
      variant_id VARCHAR(36) NOT NULL,
      target_key VARCHAR(191) NOT NULL,
      platform VARCHAR(20) NOT NULL,
      label VARCHAR(255) NULL,
      last_qty INT NULL,
      ok TINYINT(1) NOT NULL DEFAULT 0,
      skipped_reason VARCHAR(255) NULL,
      last_error TEXT NULL,
      last_attempt_at DATETIME NULL,
      last_ok_at DATETIME NULL,
      PRIMARY KEY (variant_id, target_key),
      INDEX idx_stock_sync_targets_ok (ok)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS channel_orders (
      platform VARCHAR(20) NOT NULL,
      external_order_id VARCHAR(64) NOT NULL,
      order_number VARCHAR(64) NULL,
      state VARCHAR(20) NOT NULL,
      remote_status VARCHAR(64) NULL,
      buyer VARCHAR(255) NULL,
      order_created_at DATETIME NULL,
      applied_at DATETIME NULL,
      reverted_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (platform, external_order_id),
      INDEX idx_channel_orders_state (state),
      INDEX idx_channel_orders_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS channel_order_lines (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      platform VARCHAR(20) NOT NULL,
      external_order_id VARCHAR(64) NOT NULL,
      line_key VARCHAR(191) NOT NULL,
      external_item_id VARCHAR(64) NULL,
      external_variant_id VARCHAR(64) NULL,
      sku VARCHAR(128) NULL,
      title VARCHAR(255) NULL,
      quantity INT NOT NULL DEFAULT 0,
      pack_size INT NOT NULL DEFAULT 1,
      units INT NOT NULL DEFAULT 0,
      variant_id VARCHAR(36) NULL,
      bundle_id VARCHAR(36) NULL,
      state VARCHAR(20) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_channel_order_line (platform, external_order_id, line_key),
      INDEX idx_channel_order_lines_state (state)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS stock_alerts (
      id VARCHAR(36) PRIMARY KEY,
      kind VARCHAR(32) NOT NULL,
      variant_id VARCHAR(36) NULL,
      message VARCHAR(500) NOT NULL,
      reference VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      dismissed_at DATETIME NULL,
      INDEX idx_stock_alerts_open (dismissed_at, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS wholesale_order_stock (
      order_id VARCHAR(36) NOT NULL,
      variant_id VARCHAR(36) NOT NULL,
      units INT NOT NULL DEFAULT 0,
      frozen_units INT NULL,
      returned_units INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (order_id, variant_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  if (!(await columnExists('orders', 'stock_state'))) {
    await execute(`ALTER TABLE orders ADD COLUMN stock_state VARCHAR(16) NULL`);
  }
  if (!(await columnExists('orders', 'stock_frozen'))) {
    await execute(`ALTER TABLE orders ADD COLUMN stock_frozen TINYINT(1) NOT NULL DEFAULT 0`);
  }

  // Fecha de corte: las ventas de TN/ML anteriores a este momento ya las manejó el sistema viejo.
  if (!(await getEngineState('cutover_at'))) {
    await setEngineState('cutover_at', new Date().toISOString());
  }

  await migrateLegacyWholesaleOrders();
}

const PICKING_DONE = ['Falta controlar', 'Controlado', 'Despachado'];

/**
 * Una sola vez: pasa los pedidos mayoristas que el sistema viejo ya descontó a la tabla nueva.
 * Se toma lo que realmente se movió (movimientos), no lo que "debería" haberse movido,
 * y esos pedidos quedan congelados: sus cantidades no se recalculan.
 */
async function migrateLegacyWholesaleOrders(): Promise<void> {
  if (await getEngineState('legacy_wholesale_migrated')) return;

  const rows = await query(
    `SELECT reference, variant_id, SUM(quantity_change) AS qty
     FROM stock_movements
     WHERE reference LIKE 'Pedido: %'
        OR reference LIKE 'Cancelación pedido: %'
        OR reference LIKE 'Restauración pedido: %'
        OR reference LIKE 'Nota de crédito pedido: %'
     GROUP BY reference, variant_id`
  );

  const prefixes = ['Pedido: ', 'Cancelación pedido: ', 'Restauración pedido: ', 'Nota de crédito pedido: '];
  // Por pedido y variante: cuánto se descontó originalmente y cuánto quedó tomado (neto).
  const byOrder = new Map<string, Map<string, { deducted: number; net: number }>>();
  for (const r of rows as any[]) {
    const ref = String(r.reference || '');
    const prefix = prefixes.find((p) => ref.startsWith(p));
    if (!prefix) continue;
    const orderId = ref.slice(prefix.length).trim();
    if (!orderId) continue;
    const qty = Math.round(Number(r.qty) || 0);
    const byVariant = byOrder.get(orderId) ?? new Map<string, { deducted: number; net: number }>();
    const cur = byVariant.get(String(r.variant_id)) ?? { deducted: 0, net: 0 };
    if (prefix === 'Pedido: ') cur.deducted += Math.max(0, -qty);
    cur.net += qty;
    byVariant.set(String(r.variant_id), cur);
    byOrder.set(orderId, byVariant);
  }

  let migrated = 0;
  for (const [orderId, byVariant] of byOrder) {
    const anyDeducted = Array.from(byVariant.values()).some((v) => v.deducted > 0);
    if (!anyDeducted) continue;
    const order = await get(`SELECT id, status, stock_state FROM orders WHERE id = ?`, [orderId]);
    if (!order || order.stock_state) continue;
    const anyTaken = Array.from(byVariant.values()).some((v) => -v.net > 0);
    for (const [variantId, v] of byVariant) {
      const frozen = v.deducted;
      const taken = Math.min(frozen, Math.max(0, -v.net));
      // Si sigue descontado, lo devuelto parcialmente (notas de crédito) queda como "devuelto".
      const returned = anyTaken ? frozen - taken : 0;
      await execute(
        `INSERT INTO wholesale_order_stock (order_id, variant_id, units, frozen_units, returned_units)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE units = VALUES(units), frozen_units = VALUES(frozen_units), returned_units = VALUES(returned_units)`,
        [orderId, variantId, taken, frozen, returned]
      );
    }
    const state = anyTaken ? 'deducted' : 'released';
    await execute(`UPDATE orders SET stock_state = ?, stock_frozen = 1 WHERE id = ?`, [state, orderId]);
    migrated++;
  }

  await setEngineState('legacy_wholesale_migrated', new Date().toISOString());
  console.log(`[StockEngine] Pedidos mayoristas migrados al motor nuevo: ${migrated}`);
}

export { PICKING_DONE };
