/**
 * Fusiona productos duplicados (mismo núcleo numérico de SKU o mismo SKU sin guiones/espacios).
 *
 * Simulación (no modifica la BD):
 *   cd backend && npm run merge-duplicate-products -- --dry-run
 *
 * Aplicar cambios:
 *   cd backend && npm run merge-duplicate-products
 *
 * Requiere MYSQL_URL / DATABASE_URL o DB_* en .env
 */
import { runMergeDuplicateProductsBySku } from '../src/services/mergeDuplicateProductsBySku';

const dryRun = process.argv.includes('--dry-run') || process.argv.includes('-n');

runMergeDuplicateProductsBySku({ dryRun })
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    if (r.errors.length) {
      console.error('Errores:', r.errors);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
