import { execute } from './db';

/** Factura mensual de Mercado Libre: importe que hay que pagar, para restarlo del resultado del canal. */
export async function addMlChannelInvoicesTable(): Promise<void> {
  await execute(`
    CREATE TABLE IF NOT EXISTS ml_channel_invoices (
      id VARCHAR(36) PRIMARY KEY,
      period_month CHAR(7) NOT NULL,
      amount DECIMAL(14, 2) NOT NULL DEFAULT 0,
      invoice_number VARCHAR(64) NULL,
      notes VARCHAR(500) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_ml_channel_invoice_month (period_month)
    )
  `);
}
