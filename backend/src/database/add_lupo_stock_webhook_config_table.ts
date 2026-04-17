import { execute, get } from './db';

export async function addLupoStockWebhookConfigTable(): Promise<void> {
  console.log('[DB] Verificando tabla lupo_stock_webhook_config...');
  try {
    const row = await get(
      `SELECT COUNT(*) AS cnt FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'lupo_stock_webhook_config'`
    );
    const exists = Number((row as any)?.cnt || 0) > 0;
    if (!exists) {
      await execute(`
        CREATE TABLE lupo_stock_webhook_config (
          id INT PRIMARY KEY DEFAULT 1,
          enabled TINYINT(1) NOT NULL DEFAULT 0,
          webhook_url TEXT NULL,
          api_key TEXT NULL,
          webhook_secret TEXT NULL,
          timeout_ms INT NOT NULL DEFAULT 10000,
          max_retries INT NOT NULL DEFAULT 4,
          backoff_base_ms INT NOT NULL DEFAULT 1000,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CHECK (id = 1)
        )
      `);
      await execute(
        `INSERT INTO lupo_stock_webhook_config (id, enabled, timeout_ms, max_retries, backoff_base_ms)
         VALUES (1, 0, 10000, 4, 1000)
         ON DUPLICATE KEY UPDATE id = id`
      );
      console.log('[DB] Tabla lupo_stock_webhook_config creada');
    } else {
      console.log('[DB] Tabla lupo_stock_webhook_config ya existe');
      await execute(
        `INSERT INTO lupo_stock_webhook_config (id, enabled, timeout_ms, max_retries, backoff_base_ms)
         VALUES (1, 0, 10000, 4, 1000)
         ON DUPLICATE KEY UPDATE id = id`
      );
    }
  } catch (e: any) {
    console.error('[DB] Error verificando tabla lupo_stock_webhook_config:', e?.message);
  }
}
