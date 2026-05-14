import { execute, get } from './db';

/**
 * Guarda en cada NC el comprobante de factura que se anuló (snapshot antes de reemplazar CAE)
 * y marca si esa NC quedó reemplazada por una nueva factura (reemisión con IIBB).
 */
export async function addCreditNotesVoidedInvoiceSnapshot(): Promise<void> {
  console.log('[DB] Verificando columnas credit_notes (voided_invoice / superseded_by_reinvoice)...');
  const cols: Array<{ name: string; sql: string }> = [
    {
      name: 'voided_invoice_cae',
      sql: `ALTER TABLE credit_notes ADD COLUMN voided_invoice_cae VARCHAR(20) NULL AFTER item_index`,
    },
    {
      name: 'voided_invoice_punto_venta',
      sql: `ALTER TABLE credit_notes ADD COLUMN voided_invoice_punto_venta INT NULL AFTER voided_invoice_cae`,
    },
    {
      name: 'voided_invoice_cbte_tipo',
      sql: `ALTER TABLE credit_notes ADD COLUMN voided_invoice_cbte_tipo INT NULL AFTER voided_invoice_punto_venta`,
    },
    {
      name: 'voided_invoice_cbte_desde',
      sql: `ALTER TABLE credit_notes ADD COLUMN voided_invoice_cbte_desde INT NULL AFTER voided_invoice_cbte_tipo`,
    },
    {
      name: 'superseded_by_reinvoice',
      sql: `ALTER TABLE credit_notes ADD COLUMN superseded_by_reinvoice TINYINT(1) NOT NULL DEFAULT 0 AFTER voided_invoice_cbte_desde`,
    },
  ];
  try {
    for (const c of cols) {
      const col = await get(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_notes' AND COLUMN_NAME = ?`,
        [c.name]
      );
      if (!col) {
        await execute(c.sql);
        console.log(`[DB] credit_notes: columna ${c.name} añadida`);
      }
    }
  } catch (e: any) {
    console.error('[DB] Error en addCreditNotesVoidedInvoiceSnapshot:', e?.message);
  }
}
