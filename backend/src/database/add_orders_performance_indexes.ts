import { execute, get } from './db';

/** Índices para acelerar listados de pedidos, ítems e IIBB (AGIP). Idempotente. */
export async function addOrdersPerformanceIndexes(): Promise<void> {
  console.log('[DB] Verificando índices de performance (orders / order_items / AGIP)...');

  const ensureIndex = async (table: string, indexName: string, ddl: string) => {
    const row = await get(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [table, indexName]
    );
    if (Number((row as any)?.cnt)) return;
    try {
      await execute(ddl);
      console.log(`[DB] Índice ${indexName} en ${table} creado`);
    } catch (e: any) {
      console.warn(`[DB] No se pudo crear ${indexName}:`, e?.message || e);
    }
  };

  const tableExists = async (name: string) => {
    const row = await get(
      `SELECT COUNT(*) AS cnt FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = ?`,
      [name]
    );
    return Number((row as any)?.cnt) > 0;
  };

  await ensureIndex(
    'orders',
    'idx_orders_customer_date',
    'CREATE INDEX idx_orders_customer_date ON orders (customer_id, date DESC)'
  );
  await ensureIndex(
    'orders',
    'idx_orders_date',
    'CREATE INDEX idx_orders_date ON orders (date DESC)'
  );
  await ensureIndex(
    'orders',
    'idx_orders_archived_date',
    'CREATE INDEX idx_orders_archived_date ON orders (archived, date DESC)'
  );

  if (await tableExists('stock_movements')) {
    await ensureIndex(
      'stock_movements',
      'idx_stock_movements_type_reference',
      'CREATE INDEX idx_stock_movements_type_reference ON stock_movements (movement_type, reference(64))'
    );
  }

  if (await tableExists('agip_padron_alicuotas')) {
    await ensureIndex(
      'agip_padron_alicuotas',
      'idx_agip_padron_period_cuit',
      'CREATE INDEX idx_agip_padron_period_cuit ON agip_padron_alicuotas (period_yyyymm, cuit)'
    );
  }
}
