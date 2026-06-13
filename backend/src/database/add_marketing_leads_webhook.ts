import { execute, get } from './db';

export async function addMarketingLeadsWebhookSupport(): Promise<void> {
  const col = await get(
    `SELECT COUNT(*) AS cnt FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'marketing_leads' AND column_name = 'external_id'`
  );
  if (Number((col as any)?.cnt || 0) === 0) {
    await execute(`ALTER TABLE marketing_leads ADD COLUMN external_id VARCHAR(120) NULL`);
    await execute(`ALTER TABLE marketing_leads ADD COLUMN external_provider VARCHAR(40) NULL`);
    await execute(
      `CREATE UNIQUE INDEX uq_marketing_leads_external ON marketing_leads (external_provider, external_id)`
    );
  }

  await execute(`
    CREATE TABLE IF NOT EXISTS marketing_leads_webhook_config (
      id INT PRIMARY KEY DEFAULT 1,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      webhook_secret VARCHAR(80) NOT NULL,
      meta_verify_token VARCHAR(80) NOT NULL,
      meta_app_secret VARCHAR(255) NULL,
      meta_leads_enabled TINYINT(1) NOT NULL DEFAULT 1,
      whatsapp_enabled TINYINT(1) NOT NULL DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CHECK (id = 1)
    )
  `);

  const existing = await get('SELECT id FROM marketing_leads_webhook_config WHERE id = 1');
  if (!existing) {
    const { randomBytes } = await import('crypto');
    const webhookSecret = randomBytes(24).toString('hex');
    const metaVerifyToken = randomBytes(16).toString('hex');
    await execute(
      `INSERT INTO marketing_leads_webhook_config
        (id, enabled, webhook_secret, meta_verify_token, meta_leads_enabled, whatsapp_enabled)
       VALUES (1, 1, ?, ?, 1, 1)`,
      [webhookSecret, metaVerifyToken]
    );
  }
}
