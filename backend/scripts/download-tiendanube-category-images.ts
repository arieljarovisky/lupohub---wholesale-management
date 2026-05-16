/**
 * Descarga todas las imágenes de productos de una categoría de Tienda Nube.
 *
 * Uso:
 *   cd backend
 *   npm run download-tn-category-images
 *   npm run download-tn-category-images -- --category "ropa deportiva"
 *   npm run download-tn-category-images -- --category-id 123456
 *   npm run download-tn-category-images -- --output ./downloads/mi-carpeta
 *
 * Credenciales: integración TN en BD, o TN_STORE_ID + TN_ACCESS_TOKEN en .env
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
import { downloadCategoryImages } from '../src/services/tiendanubeCategoryImages.service';

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

async function main() {
  const categoryQuery = argValue('--category') || 'ropa deportiva';
  const categoryIdRaw = argValue('--category-id');
  const categoryId = categoryIdRaw ? parseInt(categoryIdRaw, 10) : undefined;
  const outputArg = argValue('--output');
  const slug = categoryQuery
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const outputDir =
    outputArg ||
    path.join(process.cwd(), 'downloads', `tiendanube-${slug || 'categoria'}`);

  console.log(`Categoría: «${categoryQuery}»${categoryId ? ` (id ${categoryId})` : ''}`);
  console.log(`Destino: ${outputDir}\n`);

  const result = await downloadCategoryImages({
    categoryQuery,
    categoryId: Number.isFinite(categoryId) ? categoryId : undefined,
    outputDir: path.resolve(outputDir),
    includeSubcategories: true,
  });

  console.log('\n--- Resumen ---');
  console.log(JSON.stringify(result, null, 2));
  if (result.failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
