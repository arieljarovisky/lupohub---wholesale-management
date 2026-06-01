import { execute, get } from './db';

/** PDF adjunto y modo sin número AFIP en comprobantes manuales. */
export async function addCustomerManualComprobantesPdfColumns(): Promise<void> {
  console.log('[DB] Verificando columnas PDF / sin_detalle en customer_manual_comprobantes...');
  try {
    const table = await get(
      `SELECT COUNT(*) AS cnt FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'customer_manual_comprobantes'`
    );
    if (Number((table as any)?.cnt || 0) === 0) return;

    const col = async (name: string) => {
      const r = await get(
        `SELECT COUNT(*) AS cnt FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'customer_manual_comprobantes' AND column_name = ?`,
        [name]
      );
      return Number((r as any)?.cnt || 0) > 0;
    };

    if (!(await col('sin_detalle'))) {
      await execute(
        `ALTER TABLE customer_manual_comprobantes
         ADD COLUMN sin_detalle TINYINT(1) NOT NULL DEFAULT 0 AFTER notes`
      );
      console.log('[DB] Columna sin_detalle agregada');
    }
    if (!(await col('pdf_path'))) {
      await execute(
        `ALTER TABLE customer_manual_comprobantes
         ADD COLUMN pdf_path VARCHAR(500) NULL AFTER sin_detalle`
      );
      console.log('[DB] Columna pdf_path agregada');
    }
    if (!(await col('pdf_file_name'))) {
      await execute(
        `ALTER TABLE customer_manual_comprobantes
         ADD COLUMN pdf_file_name VARCHAR(255) NULL AFTER pdf_path`
      );
      console.log('[DB] Columna pdf_file_name agregada');
    }
  } catch (e: any) {
    console.error('[DB] Error alterando customer_manual_comprobantes:', e?.message);
  }
}
