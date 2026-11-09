/**
 * Vincula 1847102 a las publicaciones pack x3:
 *  - Mercado Libre MLA808768850
 *  - Tienda Nube / lupo.ar 379791108 (pack x3)
 *
 * Colores fijos: pack x3 (3 unidades del mismo color y talle).
 * Surtido: 1 negro + 1 blanco + 1 azul marino del mismo talle.
 * No toca el producto suelto de Tienda Nube (379429878).
 *
 * Uso: cd backend && npx cross-env NODE_ENV=production npx ts-node --transpile-only scripts/link-article-1847102-packs.ts
 */
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { execute, get, query } from '../src/database/db';
import { syncStockToExternalPlatforms } from '../src/controllers/stock.controller';
import {
  createPublicationBundle,
  findBundleByListing,
  updatePublicationBundle,
} from '../src/services/publicationStockBundle.service';

const PRODUCT_SKU = '1847102';
const ML_ITEM_ID = 'MLA808768850';
const TN_PACK_PRODUCT_ID = '379791108';
const PACK = 3;

const SIZE_BY_LETTER: Record<string, string> = { p: '130', m: '140', g: '150', gg: '160' };
const SURTIDO_COLORS = ['negro', 'blanco', 'azul marino'];

function norm(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type LocalVariant = { id: string; sku: string; size_code: string; color_name: string; stock: number };

async function upsertPublication(
  variantId: string,
  platform: 'mercadolibre' | 'tiendanube',
  productId: string,
  variantExtId: string,
  packSize: number
) {
  await execute(
    `INSERT INTO variant_publications (id, variant_id, platform, external_product_id, external_variant_id, pack_size)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE pack_size = VALUES(pack_size)`,
    [uuidv4(), variantId, platform, productId, variantExtId, packSize]
  );
}

async function upsertBundle(
  platform: 'mercadolibre' | 'tiendanube',
  productId: string,
  variantExtId: string,
  label: string,
  items: Array<{ variantId: string; unitsPerSale: number }>
) {
  const existing = await findBundleByListing(platform, productId, variantExtId);
  if (existing) {
    await updatePublicationBundle(existing.id, { label, externalVariantId: variantExtId, items });
    return 'updated';
  }
  await createPublicationBundle({
    platform,
    externalProductId: productId,
    externalVariantId: variantExtId,
    label,
    items,
  });
  return 'created';
}

async function run() {
  const product = await get(`SELECT id, sku, name FROM products WHERE sku = ?`, [PRODUCT_SKU]);
  if (!product) {
    console.error('No encontré el artículo 1847102.');
    process.exit(1);
  }

  const locals = (await query(
    `SELECT pv.id, pv.sku, s.size_code, c.name AS color_name, COALESCE(st.stock, 0) AS stock
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN sizes s ON s.id = pv.size_id
     JOIN colors c ON c.id = pc.color_id
     LEFT JOIN stocks st ON st.variant_id = pv.id
     WHERE pc.product_id = ?`,
    [product.id]
  )) as LocalVariant[];

  const bySku = new Map(locals.map((v) => [norm(v.sku), v]));
  const bySizeColor = new Map(locals.map((v) => [`${v.size_code}|${norm(v.color_name)}`, v]));

  const mlTok = await get(`SELECT access_token FROM integrations WHERE platform = 'mercadolibre'`);
  const tnTok = await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
  if (!mlTok?.access_token || !tnTok?.access_token) {
    console.error('Faltan integraciones de Mercado Libre o Tienda Nube.');
    process.exit(1);
  }
  const storeId = tnTok.store_id || tnTok.user_id;

  const mlItem = await axios.get(`https://api.mercadolibre.com/items/${ML_ITEM_ID}`, {
    headers: { Authorization: `Bearer ${mlTok.access_token}` },
    params: { include_attributes: 'all' },
    validateStatus: () => true,
  });
  if (mlItem.status !== 200) {
    console.error('No pude leer la publicación de Mercado Libre', mlItem.status);
    process.exit(1);
  }

  const tnProd = await axios.get(`https://api.tiendanube.com/v1/${storeId}/products/${TN_PACK_PRODUCT_ID}`, {
    headers: {
      Authentication: `bearer ${tnTok.access_token}`,
      'User-Agent': 'LupoHub (link-article-1847102)',
    },
    validateStatus: () => true,
  });
  if (tnProd.status !== 200) {
    console.error('No pude leer el pack de Tienda Nube', tnProd.status);
    process.exit(1);
  }

  await execute(
    `UPDATE products SET mercado_libre_id = ?, mercado_libre_pack_size = ? WHERE id = ?`,
    [ML_ITEM_ID, PACK, product.id]
  );

  type RemoteVar = { platform: 'mercadolibre' | 'tiendanube'; id: string; sku: string; color: string; size: string };
  const remotes: RemoteVar[] = [];

  for (const v of mlItem.data.variations || []) {
    const attrs = Object.fromEntries(
      (v.attribute_combinations || []).map((a: any) => [norm(a.name), String(a.value_name || '')])
    );
    const sku = (v.attributes || []).find((a: any) => a.id === 'SELLER_SKU')?.value_name || '';
    remotes.push({
      platform: 'mercadolibre',
      id: String(v.id),
      sku: String(sku),
      color: attrs.color || '',
      size: attrs.talle || '',
    });
  }

  for (const v of tnProd.data.variants || []) {
    const labels = (v.values || []).map((x: any) => (typeof x === 'object' ? x.es || Object.values(x)[0] : x));
    remotes.push({
      platform: 'tiendanube',
      id: String(v.id),
      sku: String(v.sku || ''),
      color: String(labels[0] || ''),
      size: String(labels[1] || ''),
    });
  }

  let solids = 0;
  let surtidos = 0;
  const missed: string[] = [];

  for (const remote of remotes) {
    const skuNorm = norm(remote.sku);
    const isSurtido = skuNorm.includes('surt') || norm(remote.color).startsWith('surtido') || norm(remote.color) === 'multicolor';
    const sizeCode = SIZE_BY_LETTER[norm(remote.size)];
    const platformLabel = remote.platform === 'mercadolibre' ? 'ML' : 'TN';

    try {
    if (isSurtido) {
      if (!sizeCode) {
        missed.push(`${platformLabel} surtido sin talle: ${remote.sku}`);
        continue;
      }
      const items = SURTIDO_COLORS.map((color) => {
        const local = bySizeColor.get(`${sizeCode}|${color}`);
        return local ? { variantId: local.id, unitsPerSale: 1 } : null;
      }).filter(Boolean) as Array<{ variantId: string; unitsPerSale: number }>;
      if (items.length !== 3) {
        missed.push(`${platformLabel} surtido ${remote.size}: faltan colores (${items.length}/3)`);
        continue;
      }
      const action = await upsertBundle(
        remote.platform,
        remote.platform === 'mercadolibre' ? ML_ITEM_ID : TN_PACK_PRODUCT_ID,
        remote.id,
        `Surtido ${remote.size.toUpperCase()}`,
        items
      );
      surtidos++;
      console.log(`  ${action} ${platformLabel} surtido ${remote.size} → ${remote.id}`);
      await sleep(700);
      continue;
    }

    const baseSku = skuNorm.replace(/-x3$/, '').replace(/x3$/, '');
    const local = bySku.get(baseSku) || bySku.get(skuNorm);
    if (!local) {
      missed.push(`${platformLabel} ${remote.sku} (${remote.color} ${remote.size}) sin variante local`);
      continue;
    }
    await upsertPublication(
      local.id,
      remote.platform,
      remote.platform === 'mercadolibre' ? ML_ITEM_ID : TN_PACK_PRODUCT_ID,
      remote.id,
      PACK
    );
    if (remote.platform === 'tiendanube') {
      const action = await upsertBundle(remote.platform, TN_PACK_PRODUCT_ID, remote.id, `Pack x3 ${remote.color} ${remote.size}`, [
        { variantId: local.id, unitsPerSale: PACK },
      ]);
      console.log(`  ${action} TN pack x3 ${remote.color} ${remote.size} → ${remote.id} (${Math.floor(local.stock / PACK)} packs)`);
      await sleep(700);
    } else {
      console.log(`  ML pack x3 ${remote.color} ${remote.size} → ${remote.id} (${Math.floor(local.stock / PACK)} packs)`);
    }
    solids++;
    } catch (err: any) {
      missed.push(`${platformLabel} ${remote.sku}: ${err?.message || err}`);
    }
  }

  console.log('\nSincronizando stock de las variantes locales...');
  for (const local of locals) {
    const result = await syncStockToExternalPlatforms(local.id, local.stock);
    for (const line of result.logs) console.log(' ', line);
    await sleep(500);
  }

  console.log(`\n✓ ${product.sku} — ${product.name}`);
  console.log(`  Colores fijos vinculados (pack x${PACK}): ${solids}`);
  console.log(`  Surtidos vinculados: ${surtidos}`);
  if (missed.length) {
    console.log('  Sin vincular:');
    for (const m of missed) console.log('   -', m);
  }
  process.exit(missed.length ? 1 : 0);
}

run().catch((e) => {
  console.error(e?.response?.data || e);
  process.exit(1);
});
