/**
 * Vincula 0069102 a MLA759387462 (ML) y producto TN 353258979, luego sincroniza stock.
 *
 * Uso: cd backend && NODE_ENV=production npx ts-node --transpile-only scripts/link-article-0069102.ts
 */

import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { query, get, execute } from '../src/database/db';
import { syncStockToExternalPlatforms } from '../src/controllers/stock.controller';

const PRODUCT_ID = '28e30351-6c5f-48d8-93b5-7d4a4a8f670f';
const ML_ITEM_ID = 'MLA759387462';
const TN_PRODUCT_ID = '353258979';

const SIZE_MAP: Record<string, string> = {
  '130': 'P',
  '140': 'M',
  '150': 'G',
  '160': 'GG',
  '180': 'XG',
};

const COLOR_MAP: Record<string, string> = {
  blanco: 'blanco',
  negro: 'negro',
  bordo: 'bordo',
  'azul acero': 'azul',
  'azul marino': 'azul oscuro',
  grafito: 'gris oscuro',
};

function norm(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function mapColor(name: string): string {
  return COLOR_MAP[norm(name)] || norm(name);
}

type LocalRow = {
  id: string;
  sku: string;
  size_code: string;
  color_name: string;
  stock: number;
};

async function run() {
  const product = await get(`SELECT id, sku, name FROM products WHERE id = ?`, [PRODUCT_ID]);
  if (!product) {
    console.error('Producto 0069102 no encontrado.');
    process.exit(1);
  }

  const locals = (await query(
    `SELECT pv.id, pv.sku, s.size_code, c.name AS color_name, COALESCE(st.stock, 0) AS stock
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN sizes s ON s.id = pv.size_id
     JOIN colors c ON c.id = pc.color_id
     LEFT JOIN stocks st ON st.variant_id = pv.id
     WHERE pc.product_id = ?
     ORDER BY s.size_code, c.code`,
    [PRODUCT_ID]
  )) as LocalRow[];

  const mlTok = await get(`SELECT access_token FROM integrations WHERE platform = 'mercadolibre'`);
  const tnTok = await get(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);
  if (!mlTok?.access_token || !tnTok?.access_token || !tnTok.store_id) {
    console.error('Faltan integraciones ML o TN.');
    process.exit(1);
  }

  const mlHeaders = { Authorization: `Bearer ${mlTok.access_token}` };
  const tnHeaders = {
    Authentication: `bearer ${tnTok.access_token}`,
    'User-Agent': 'LupoHub (link-article-0069102)',
  };

  const mlItem = await axios.get(`https://api.mercadolibre.com/items/${ML_ITEM_ID}`, { headers: mlHeaders });
  const mlVars = (mlItem.data.variations || []).map((v: any) => {
    const attrs = Object.fromEntries(
      (v.attribute_combinations || []).map((a: any) => [norm(a.name), a.value_name as string])
    );
    return {
      id: String(v.id),
      nsize: norm(attrs.talle || ''),
      ncolor: norm(attrs.color || ''),
    };
  });

  const tnProd = await axios.get(
    `https://api.tiendanube.com/v1/${tnTok.store_id}/products/${TN_PRODUCT_ID}`,
    { headers: tnHeaders }
  );
  const tnBySku = new Map<string, string>();
  for (const v of tnProd.data.variants || []) {
    tnBySku.set(norm(v.sku), String(v.id));
  }

  await execute(`UPDATE products SET mercado_libre_id = ?, tienda_nube_id = ? WHERE id = ?`, [
    ML_ITEM_ID,
    TN_PRODUCT_ID,
    PRODUCT_ID,
  ]);

  const usedMl = new Set<string>();
  let tnLinked = 0;
  let mlLinked = 0;
  let synced = 0;

  for (const local of locals) {
    const tnVarId = tnBySku.get(norm(local.sku));
    const letter = SIZE_MAP[local.size_code] || local.size_code;
    const mlMatch = mlVars.find(
      (mv) => mv.nsize === norm(letter) && mv.ncolor === mapColor(local.color_name) && !usedMl.has(mv.id)
    );

    const sets: string[] = [];
    const params: unknown[] = [];

    if (tnVarId) {
      sets.push('tienda_nube_variant_id = ?');
      params.push(tnVarId);
      tnLinked++;
      await execute(
        `INSERT INTO variant_publications (id, variant_id, platform, external_product_id, external_variant_id, pack_size)
         VALUES (?, ?, 'tiendanube', ?, ?, 1)
         ON DUPLICATE KEY UPDATE external_product_id = VALUES(external_product_id), external_variant_id = VALUES(external_variant_id)`,
        [uuidv4(), local.id, TN_PRODUCT_ID, tnVarId]
      );
    }

    if (mlMatch) {
      usedMl.add(mlMatch.id);
      sets.push('mercado_libre_item_id = ?', 'mercado_libre_variant_id = ?');
      params.push(ML_ITEM_ID, mlMatch.id);
      mlLinked++;
      await execute(
        `INSERT INTO variant_publications (id, variant_id, platform, external_product_id, external_variant_id, pack_size)
         VALUES (?, ?, 'mercadolibre', ?, ?, 1)
         ON DUPLICATE KEY UPDATE external_product_id = VALUES(external_product_id), external_variant_id = VALUES(external_variant_id)`,
        [uuidv4(), local.id, ML_ITEM_ID, mlMatch.id]
      );
    }

    if (sets.length > 0) {
      params.push(local.id);
      await execute(`UPDATE product_variants SET ${sets.join(', ')} WHERE id = ?`, params);
      try {
        await syncStockToExternalPlatforms(local.id, Number(local.stock) || 0);
        synced++;
      } catch (e: any) {
        console.warn(`Stock sync falló ${local.sku}:`, e?.message || e);
      }
    }
  }

  console.log(`✓ ${product.sku} — ${product.name}`);
  console.log(`  TN vinculadas: ${tnLinked}/${locals.length} (producto ${TN_PRODUCT_ID})`);
  console.log(`  ML vinculadas: ${mlLinked}/${mlVars.length} variaciones en ${ML_ITEM_ID}`);
  console.log(`  Stock sincronizado en: ${synced} variantes`);
  console.log(`  Sin ML (no existe en catálogo): ${locals.length - mlLinked} variantes locales`);
  process.exit(0);
}

run().catch((e) => {
  console.error(e?.response?.data || e);
  process.exit(1);
});
