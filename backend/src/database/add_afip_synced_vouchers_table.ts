import { execute, get } from './db';

/**
 * Caché local de comprobantes AFIP consultados (ej. Facturador Mercado Libre, PV 22).
 * Se usa para Ventas por jurisdicción sin reconsultar AFIP en cada export.
 */
export async function addAfipSyncedVouchersTable(): Promise<void> {
  console.log('[DB] Verificando tabla afip_synced_vouchers...');
  try {
    const row = await get(
      `SELECT COUNT(*) AS cnt FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'afip_synced_vouchers'`
    );
    const exists = Number((row as any)?.cnt || 0) > 0;
    if (!exists) {
      await execute(`
        CREATE TABLE afip_synced_vouchers (
          id VARCHAR(36) PRIMARY KEY,
          punto_venta INT NOT NULL,
          cbte_tipo INT NOT NULL,
          cbte_desde INT NOT NULL,
          cbte_hasta INT NOT NULL,
          cae VARCHAR(20) NULL,
          fecha DATE NOT NULL,
          imp_neto DECIMAL(14,2) NOT NULL DEFAULT 0,
          imp_iva DECIMAL(14,2) NOT NULL DEFAULT 0,
          imp_trib DECIMAL(14,2) NOT NULL DEFAULT 0,
          imp_total DECIMAL(14,2) NOT NULL DEFAULT 0,
          doc_tipo INT NULL,
          doc_nro VARCHAR(20) NULL,
          source_hint VARCHAR(40) NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_afip_synced_voucher (punto_venta, cbte_tipo, cbte_desde),
          INDEX idx_afip_synced_fecha (punto_venta, fecha),
          INDEX idx_afip_synced_source_fecha (source_hint, fecha)
        )
      `);
      console.log('[DB] Tabla afip_synced_vouchers creada');
    } else {
      console.log('[DB] Tabla afip_synced_vouchers ya existe');
    }
  } catch (e: any) {
    console.error('[DB] Error creando tabla afip_synced_vouchers:', e?.message);
  }
}
