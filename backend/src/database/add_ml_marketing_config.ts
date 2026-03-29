import crypto from 'crypto';
import { execute, get } from './db';

/** Configuración singleton para webhooks de marketing ML → n8n (tabla ml_marketing_config). */
export const addMlMarketingConfigTable = async () => {
  try {
    await execute(`
      CREATE TABLE IF NOT EXISTS ml_marketing_config (
        id INT NOT NULL PRIMARY KEY,
        inbound_secret VARCHAR(128) NOT NULL,
        n8n_forward_url VARCHAR(2048) NULL,
        forward_ml_notifications TINYINT(1) NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    const row = await get(`SELECT id FROM ml_marketing_config WHERE id = 1`);
    if (!row) {
      const secret = crypto.randomBytes(32).toString('hex');
      await execute(`INSERT INTO ml_marketing_config (id, inbound_secret) VALUES (1, ?)`, [secret]);
      console.log('[DB] ml_marketing_config: fila inicial creada');
    } else {
      console.log('[DB] ml_marketing_config: ya existe');
    }
  } catch (e: any) {
    console.error('[DB] addMlMarketingConfigTable:', e?.message || e);
  }
};
