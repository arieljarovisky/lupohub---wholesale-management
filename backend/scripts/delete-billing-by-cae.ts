/**
 * Elimina filas de facturación local (credit_notes + invoices) por CAE.
 * Útil para borrar pruebas. Los comprobantes emitidos en AFIP siguen existiendo en ARCA/AFIP.
 *
 * Uso: desde backend/ → npx ts-node scripts/delete-billing-by-cae.ts
 */
import pool, { execute } from '../src/database/db';

const CAES = [
  '86128335805747',
  '86128335798198',
  '86128328542031',
  '86128294297529',
  '86128259198918',
  '86128259187375',
  '86117930965685',
  '86117927902576',
  '86118126190622',
  '86118105616990'
];

async function main() {
  const placeholders = CAES.map(() => '?').join(',');
  const r1 = await execute(`DELETE FROM credit_notes WHERE cae IN (${placeholders})`, CAES);
  const r2 = await execute(`DELETE FROM invoices WHERE cae IN (${placeholders})`, CAES);
  const deletedNc = (r1 as mysql2Ok)?.affectedRows ?? 0;
  const deletedInv = (r2 as mysql2Ok)?.affectedRows ?? 0;
  console.log(`credit_notes eliminadas: ${deletedNc}`);
  console.log(`invoices eliminadas: ${deletedInv}`);
}

type mysql2Ok = { affectedRows: number };

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
