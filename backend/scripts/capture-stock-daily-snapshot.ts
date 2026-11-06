/**
 * Guarda la foto del stock de un día (por defecto, hoy en Argentina).
 * Uso: desde backend/ → npx cross-env NODE_ENV=production ts-node scripts/capture-stock-daily-snapshot.ts
 */
import pool from '../src/database/db';
import { buenosAiresDate, captureStockDailySnapshot, isIsoDate } from '../src/services/stockDailySnapshot.service';

async function main() {
  const arg = (process.argv[2] || '').trim();
  const date = arg || buenosAiresDate();
  if (!isIsoDate(date)) {
    console.error('La fecha tiene que ser AAAA-MM-DD');
    process.exitCode = 1;
    return;
  }
  const result = await captureStockDailySnapshot(date);
  console.log(
    `${result.replaced ? 'Actualizada' : 'Guardada'} foto ${result.date}: ${result.variants} variantes, ${result.variantsWithStock} con stock, ${result.units} unidades.`
  );
}

main()
  .catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
