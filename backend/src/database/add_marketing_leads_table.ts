import { execute } from './db';

export async function addMarketingLeadsTable(): Promise<void> {
  await execute(`
    CREATE TABLE IF NOT EXISTS marketing_leads (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      phone VARCHAR(80) NULL,
      email VARCHAR(255) NULL,
      source VARCHAR(32) NOT NULL,
      stage VARCHAR(32) NOT NULL DEFAULT 'LEAD_ENTERED',
      campaign_id VARCHAR(120) NULL,
      campaign_name VARCHAR(255) NULL,
      revenue DECIMAL(12, 2) NULL,
      notes TEXT NULL,
      entered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      contacted_at DATETIME NULL,
      quoted_at DATETIME NULL,
      closed_at DATETIME NULL,
      created_by VARCHAR(36) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_marketing_leads_source (source),
      INDEX idx_marketing_leads_stage (stage),
      INDEX idx_marketing_leads_campaign (campaign_id),
      INDEX idx_marketing_leads_entered (entered_at),
      CONSTRAINT fk_marketing_leads_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
}
