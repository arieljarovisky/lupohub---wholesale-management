import { execute, get } from './db';

/** Guarda los datos del remitente (para remitos + factura) en la DB. */
export async function addRemitenteTable(): Promise<void> {
  console.log('[DB] Verificando tabla remitente_config...');
  try {
    const tbl = await get(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'remitente_config'`
    );
    if (!tbl) {
      await execute(`
        CREATE TABLE IF NOT EXISTS remitente_config (
          id INT AUTO_INCREMENT PRIMARY KEY,
          business_name VARCHAR(255) NULL,
          cuit VARCHAR(20) NULL,
          address VARCHAR(255) NULL,
          city VARCHAR(100) NULL,
          email VARCHAR(255) NULL,
          phone VARCHAR(50) NULL,
          logo_url TEXT NULL,
          cai_remito VARCHAR(100) NULL,
          cai_remito_vencimiento DATE NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      console.log('[DB] Tabla remitente_config creada.');
    } else {
      console.log('[DB] Tabla remitente_config ya existe.');
    }
  } catch (e: any) {
    console.error('[DB] Error verificando/creando remitente_config:', e?.message || e);
  }
}
