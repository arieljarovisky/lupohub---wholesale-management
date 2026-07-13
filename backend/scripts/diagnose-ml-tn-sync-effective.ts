/**
 * Diagnóstico efectivo: variantes con stock cuyo stock NO llega a Mercado Libre y/o Tienda Nube.
 *
 * Replica la lógica real de syncStockToExternalPlatforms (stock.controller.ts):
 *  - Si la variante tiene filas en variant_publications, SOLO se usan esas (el legacy se ignora).
 *  - Si no tiene, se usan los vínculos legacy de product_variants/products.
 *  - Un envío a ML "por ítem" (sin ID de variación) falla si el ítem tiene más de 1 variación.
 *  - Un envío a ML "por variación" falla si la variación ya no existe en el ítem.
 *
 * Uso:
 *   npx cross-env NODE_ENV=production ts-node --transpile-only scripts/diagnose-ml-tn-sync-effective.ts
 */
import path from 'path';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { query } from '../src/database/db';
import { getValidMLToken } from '../src/controllers/integrations.controller';

type MlItem = { id: string; status?: string; variations?: { id: number | string }[] } | null;

const mlItemCache = new Map<string, MlItem>();
let mlToken: { access_token: string } | null = null;

async function fetchMlItem(id: string): Promise<MlItem> {
  const key = String(id).trim();
  if (!key) return null;
  if (mlItemCache.has(key)) return mlItemCache.get(key) ?? null;
  try {
    const res = await axios.get(`https://api.mercadolibre.com/items/${key}`, {
      headers: { Authorization: `Bearer ${mlToken!.access_token}` },
      validateStatus: () => true
    });
    const item = res.status === 200 ? res.data : null;
    mlItemCache.set(key, item);
    return item;
  } catch {
    mlItemCache.set(key, null);
    return null;
  }
}

function trimmed(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

async function main() {
  mlToken = await getValidMLToken();
  if (!mlToken?.access_token) {
    console.error('No hay token válido de Mercado Libre. Abortando.');
    process.exit(1);
  }

  const variants = await query(`
    SELECT pv.id AS variant_id, pv.sku AS variant_sku,
           p.sku AS product_sku, p.name AS product_name,
           c.name AS color_name, sz.size_code AS size_code,
           COALESCE(st.stock, 0) AS stock,
           pv.mercado_libre_item_id AS legacy_ml_item_id,
           pv.mercado_libre_variant_id AS legacy_ml_variant_id,
           p.mercado_libre_id AS legacy_ml_parent_id,
           p.tienda_nube_id AS legacy_tn_product_id,
           pv.tienda_nube_variant_id AS legacy_tn_variant_id
    FROM product_variants pv
    JOIN product_colors pc ON pc.id = pv.product_color_id
    JOIN products p ON p.id = pc.product_id
    LEFT JOIN colors c ON c.id = pc.color_id
    LEFT JOIN sizes sz ON sz.id = pv.size_id
    LEFT JOIN stocks st ON st.variant_id = pv.id
    WHERE COALESCE(st.stock, 0) > 0
    ORDER BY p.sku, pv.sku
  `);

  const pubs = await query(`
    SELECT variant_id, platform, external_product_id, external_variant_id
    FROM variant_publications
  `);
  const pubsByVariant = new Map<string, any[]>();
  for (const pub of pubs as any[]) {
    const vid = String(pub.variant_id);
    if (!pubsByVariant.has(vid)) pubsByVariant.set(vid, []);
    pubsByVariant.get(vid)!.push(pub);
  }

  type ResultRow = {
    product_sku: string;
    product_name: string;
    color_name: string;
    size_code: string;
    stock: number;
    variant_id: string;
    ml_status: string;
    ml_detail: string;
    tn_status: string;
    tn_detail: string;
  };
  const results: ResultRow[] = [];

  console.log(`Variantes con stock > 0: ${(variants as any[]).length}. Verificando rutas de sincronización...`);
  let processed = 0;

  for (const v of variants as any[]) {
    const vid = String(v.variant_id);
    const vPubs = pubsByVariant.get(vid) || [];
    const hasPubs = vPubs.length > 0;

    let mlStatus = 'OK';
    let mlDetail = '';
    let tnStatus = 'OK';
    let tnDetail = '';

    if (hasPubs) {
      // --- ML vía publicaciones ---
      const mlPubs = vPubs.filter((p) => p.platform === 'mercadolibre');
      if (mlPubs.length === 0) {
        mlStatus = 'SIN_RUTA';
        mlDetail = 'Tiene publicaciones pero ninguna de Mercado Libre (el vínculo legacy se ignora al existir publicaciones).';
      } else {
        let anyOk = false;
        const problems: string[] = [];
        for (const pub of mlPubs) {
          const itemId = trimmed(pub.external_product_id);
          const varId = trimmed(pub.external_variant_id);
          const item = await fetchMlItem(itemId);
          if (!item) {
            problems.push(`ítem ${itemId} no existe o no accesible`);
            continue;
          }
          const variations = item.variations || [];
          if (varId) {
            if (variations.some((x) => String(x.id) === varId)) anyOk = true;
            else problems.push(`variación ${varId} no existe en ${itemId}`);
          } else {
            if (variations.length <= 1) anyOk = true;
            else problems.push(`publicación sin ID de variación y el ítem ${itemId} tiene ${variations.length} variaciones`);
          }
        }
        if (!anyOk) {
          mlStatus = 'ROTA';
          mlDetail = problems.join('; ');
        } else if (problems.length > 0) {
          mlDetail = `OK con ruido: ${problems.join('; ')}`;
        }
      }
      // --- TN vía publicaciones ---
      const tnPubs = vPubs.filter((p) => p.platform === 'tiendanube');
      const tnOkPub = tnPubs.find((p) => trimmed(p.external_variant_id) !== '');
      if (tnPubs.length === 0) {
        tnStatus = 'SIN_RUTA';
        tnDetail = 'Tiene publicaciones pero ninguna de Tienda Nube (el vínculo legacy se ignora al existir publicaciones).';
      } else if (!tnOkPub) {
        tnStatus = 'ROTA';
        tnDetail = 'Publicación TN sin ID de variante: el código la saltea.';
      }
    } else {
      // --- Legacy ---
      const ownItemId = trimmed(v.legacy_ml_item_id);
      const ownVarId = trimmed(v.legacy_ml_variant_id);
      const parentId = trimmed(v.legacy_ml_parent_id);

      if (ownItemId) {
        const item = await fetchMlItem(ownItemId);
        if (!item) {
          mlStatus = 'ROTA';
          mlDetail = `Ítem ML ${ownItemId} no existe o no accesible.`;
        } else if (ownVarId) {
          const variations = item.variations || [];
          if (!variations.some((x) => String(x.id) === ownVarId)) {
            mlStatus = 'ROTA';
            mlDetail = `Variación ${ownVarId} no existe en ítem ${ownItemId}.`;
          }
        } else {
          const variations = item.variations || [];
          if (variations.length > 1) {
            mlStatus = 'ROTA';
            mlDetail = `Ítem ${ownItemId} tiene ${variations.length} variaciones y el vínculo no tiene ID de variación.`;
          }
        }
      } else if (parentId && ownVarId) {
        const item = await fetchMlItem(parentId);
        if (!item) {
          mlStatus = 'ROTA';
          mlDetail = `Publicación ML ${parentId} no existe o no accesible.`;
        } else {
          const variations = item.variations || [];
          if (variations.length > 0 && !variations.some((x) => String(x.id) === ownVarId)) {
            mlStatus = 'ROTA';
            mlDetail = `Variación ${ownVarId} no existe en publicación ${parentId}.`;
          }
        }
      } else if (trimmed(v.variant_sku)) {
        mlStatus = 'SOLO_SKU';
        mlDetail = 'Sin vínculo ML directo; se intenta por búsqueda de SKU (poco confiable).';
      } else {
        mlStatus = 'SIN_RUTA';
        mlDetail = 'Sin vínculo ML ni SKU.';
      }

      const tnProd = trimmed(v.legacy_tn_product_id);
      const tnVar = trimmed(v.legacy_tn_variant_id);
      if (!tnProd || !tnVar) {
        tnStatus = 'SIN_RUTA';
        tnDetail = `Falta ${!tnProd ? 'producto TN' : ''}${!tnProd && !tnVar ? ' y ' : ''}${!tnVar ? 'variante TN' : ''} en el vínculo.`;
      }
    }

    if (mlStatus !== 'OK' || tnStatus !== 'OK') {
      results.push({
        product_sku: String(v.product_sku || ''),
        product_name: String(v.product_name || ''),
        color_name: String(v.color_name || ''),
        size_code: String(v.size_code || ''),
        stock: Number(v.stock),
        variant_id: vid,
        ml_status: mlStatus,
        ml_detail: mlDetail,
        tn_status: tnStatus,
        tn_detail: tnDetail
      });
    }

    processed++;
    if (processed % 200 === 0) console.log(`  ...${processed} variantes procesadas`);
  }

  const mlBroken = results.filter((r) => r.ml_status === 'ROTA' || r.ml_status === 'SIN_RUTA');
  const tnBroken = results.filter((r) => r.tn_status === 'ROTA' || r.tn_status === 'SIN_RUTA');
  const bothBroken = results.filter(
    (r) => (r.ml_status === 'ROTA' || r.ml_status === 'SIN_RUTA') && (r.tn_status === 'ROTA' || r.tn_status === 'SIN_RUTA')
  );

  console.log(`\n========== RESUMEN (solo variantes con stock > 0) ==========`);
  console.log(`No se actualizan en Mercado Libre: ${mlBroken.length}`);
  console.log(`No se actualizan en Tienda Nube:  ${tnBroken.length}`);
  console.log(`No se actualizan en NINGUNO:      ${bothBroken.length}`);
  console.log(`Solo por SKU (frágil) en ML:      ${results.filter((r) => r.ml_status === 'SOLO_SKU').length}`);

  const printGroup = (title: string, rows: ResultRow[]) => {
    console.log(`\n=== ${title} (${rows.length}) ===`);
    for (const r of rows) {
      console.log(
        `  ${r.product_sku} | ${r.product_name} | ${r.color_name} T${r.size_code} | stock=${r.stock} | ML=${r.ml_status} TN=${r.tn_status}`
      );
      if (r.ml_detail) console.log(`    ML: ${r.ml_detail}`);
      if (r.tn_detail) console.log(`    TN: ${r.tn_detail}`);
    }
  };
  printGroup('NO SE ACTUALIZAN EN MERCADO LIBRE', mlBroken);
  printGroup('NO SE ACTUALIZAN EN TIENDA NUBE', tnBroken);

  const outPath = path.join(process.cwd(), `variantes-sin-sync-${new Date().toISOString().slice(0, 10)}.xlsx`);
  const toSheet = (rows: ResultRow[]) =>
    XLSX.utils.json_to_sheet(
      rows.map((r) => ({
        SKU_Producto: r.product_sku,
        Producto: r.product_name,
        Color: r.color_name,
        Talle: r.size_code,
        Stock: r.stock,
        Estado_ML: r.ml_status,
        Detalle_ML: r.ml_detail,
        Estado_TN: r.tn_status,
        Detalle_TN: r.tn_detail,
        Variant_ID: r.variant_id
      }))
    );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, toSheet(mlBroken), 'No actualiza ML');
  XLSX.utils.book_append_sheet(wb, toSheet(tnBroken), 'No actualiza TN');
  XLSX.utils.book_append_sheet(wb, toSheet(results), 'Todos los problemas');
  XLSX.writeFile(wb, outPath);
  console.log(`\nExcel generado: ${outPath}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('Error en diagnóstico:', e?.message || e);
  process.exit(1);
});
