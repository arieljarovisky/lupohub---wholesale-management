/**
 * Diagnóstico: variantes que NO se están actualizando en Mercado Libre / Tienda Nube.
 *
 * Uso (contra base de producción):
 *   npx cross-env NODE_ENV=production ts-node scripts/diagnose-ml-tn-sync.ts
 *
 * Genera un Excel con dos hojas:
 *  - "Vinculos rotos": vínculos legacy (products/product_variants) verificados contra las APIs de ML y TN.
 *  - "Publicaciones sin variacion": filas de variant_publications de ML sin external_variant_id
 *    (fallan siempre cuando el ítem tiene varias variaciones).
 */
import path from 'path';
import * as XLSX from 'xlsx';
import { query } from '../src/database/db';
import { diagnoseMlTnSyncIssues, getValidMLToken } from '../src/controllers/integrations.controller';

async function main() {
  const onlyWithStock = !process.argv.includes('--all');

  const token = await getValidMLToken();
  if (!token?.access_token) {
    console.error('No hay token válido de Mercado Libre (o no se pudo refrescar). Abortando para no reportar falsos positivos.');
    process.exit(1);
  }
  console.log('Token ML OK. Consultando vínculos y verificando contra las APIs (puede tardar varios minutos)...');

  const issues = await diagnoseMlTnSyncIssues();
  const filtered = onlyWithStock ? issues.filter((i) => Number(i.stock_lupohub) > 0) : issues;

  console.log(`\nVínculos con problemas: ${issues.length} en total, ${filtered.length} con stock en LupoHub.\n`);

  const byType = new Map<string, typeof filtered>();
  for (const i of filtered) {
    if (!byType.has(i.issue_type)) byType.set(i.issue_type, []);
    byType.get(i.issue_type)!.push(i);
  }
  for (const [type, rows] of byType) {
    console.log(`=== ${type} (${rows.length}) ===`);
    for (const r of rows) {
      console.log(
        `  ${r.product_sku} | ${r.product_name} | ${r.color_name} T${r.size_code} | stock=${r.stock_lupohub} | ` +
          `ML=${r.ml_item_id || `${r.ml_id}/${r.ml_variant_id}`} TN=${r.tn_product_id}/${r.tn_variant_id}`
      );
      console.log(`    -> ${r.issue_message}`);
    }
    console.log('');
  }

  // Publicaciones ML en variant_publications sin ID de variación (generan reintentos fallidos en cada cambio de stock)
  const incompletePubs = await query(`
    SELECT vp.id AS publication_id, vp.external_product_id AS ml_item_id,
           pv.id AS variant_id, pv.sku AS variant_sku,
           p.sku AS product_sku, p.name AS product_name,
           c.name AS color_name, sz.size_code AS size_code,
           COALESCE(st.stock, 0) AS stock_lupohub
    FROM variant_publications vp
    JOIN product_variants pv ON pv.id = vp.variant_id
    JOIN product_colors pc ON pc.id = pv.product_color_id
    JOIN products p ON p.id = pc.product_id
    LEFT JOIN colors c ON c.id = pc.color_id
    LEFT JOIN sizes sz ON sz.id = pv.size_id
    LEFT JOIN stocks st ON st.variant_id = pv.id
    WHERE vp.platform = 'mercadolibre'
      AND (vp.external_variant_id IS NULL OR TRIM(vp.external_variant_id) = '')
    ORDER BY p.sku, pv.sku
  `);
  const incompleteFiltered = onlyWithStock
    ? (incompletePubs as any[]).filter((r) => Number(r.stock_lupohub) > 0)
    : (incompletePubs as any[]);

  console.log(`=== Publicaciones ML sin ID de variación (${incompleteFiltered.length}${onlyWithStock ? ' con stock' : ''}) ===`);
  for (const r of incompleteFiltered) {
    console.log(
      `  ${r.product_sku} | ${r.product_name} | ${r.color_name} T${r.size_code} | stock=${r.stock_lupohub} | ` +
        `item=${r.ml_item_id} | publication_id=${r.publication_id}`
    );
  }

  const outPath = path.join(process.cwd(), `diagnostico-sync-ml-tn-${new Date().toISOString().slice(0, 10)}.xlsx`);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      filtered.map((r) => ({
        SKU_Producto: r.product_sku,
        Producto: r.product_name,
        Color: r.color_name,
        Talle: r.size_code,
        Stock_LupoHub: r.stock_lupohub,
        Problema: r.issue_type,
        Detalle: r.issue_message,
        Modo_Sync: r.sync_mode,
        ML_Item: r.ml_item_id || r.ml_id,
        ML_Variacion: r.ml_variant_id,
        TN_Producto: r.tn_product_id,
        TN_Variante: r.tn_variant_id,
        Variant_ID: r.variant_id
      }))
    ),
    'Vinculos rotos'
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      incompleteFiltered.map((r: any) => ({
        SKU_Producto: r.product_sku,
        Producto: r.product_name,
        Color: r.color_name,
        Talle: r.size_code,
        Stock_LupoHub: r.stock_lupohub,
        ML_Item: r.ml_item_id,
        Publication_ID: r.publication_id,
        Variant_ID: r.variant_id
      }))
    ),
    'Publicaciones sin variacion'
  );
  XLSX.writeFile(wb, outPath);
  console.log(`\nExcel generado: ${outPath}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('Error en diagnóstico:', e?.message || e);
  process.exit(1);
});
