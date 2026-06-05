import { Request, Response } from 'express';
import { execute, get } from '../database/db';

/** Clave fija: hay una sola configuración de catálogo por instancia. */
const CONFIG_KEY = 'tiendanube_catalog';

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await execute(`
    CREATE TABLE IF NOT EXISTS catalog_configs (
      config_key VARCHAR(64) PRIMARY KEY,
      config LONGTEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  tableReady = true;
}

/** GET /integrations/tiendanube/catalog/config — devuelve la config guardada (o null). */
export const getTiendaNubeCatalogConfig = async (_req: Request, res: Response) => {
  try {
    await ensureTable();
    const row = await get('SELECT config, updated_at FROM catalog_configs WHERE config_key = ?', [
      CONFIG_KEY,
    ]);
    if (!row?.config) {
      return res.json({ config: null, updatedAt: null });
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(row.config);
    } catch {
      parsed = null;
    }
    res.json({ config: parsed, updatedAt: row.updated_at || null });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[getTiendaNubeCatalogConfig]', msg);
    res.status(500).json({ message: msg });
  }
};

/** PUT /integrations/tiendanube/catalog/config — guarda la config (solo ADMIN). */
export const saveTiendaNubeCatalogConfig = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user?.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Solo administradores pueden editar el catálogo' });
    }
    await ensureTable();
    const config = req.body?.config ?? req.body;
    if (config == null || typeof config !== 'object') {
      return res.status(400).json({ message: 'Configuración inválida' });
    }
    const json = JSON.stringify(config);
    if (json.length > 8_000_000) {
      return res.status(413).json({ message: 'La configuración es demasiado grande' });
    }
    await execute(
      `INSERT INTO catalog_configs (config_key, config) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE config = VALUES(config)`,
      [CONFIG_KEY, json]
    );
    res.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[saveTiendaNubeCatalogConfig]', msg);
    res.status(500).json({ message: msg });
  }
};
