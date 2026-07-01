/**
 * Reset seguro del artículo 0069102 (Slip Microfibra S/Costura).
 * No elimina el producto si hay pedidos (preserva historial).
 * Limpia vínculos ML/TN, normaliza SKUs y recrea variantes sin pedidos.
 *
 * Uso: cd backend && NODE_ENV=production npx ts-node --transpile-only scripts/reset-article-0069102.ts
 */

import { v4 as uuidv4 } from 'uuid';
import { query, get, execute } from '../src/database/db';
import { deleteProductById } from '../src/controllers/products.controller';

const ARTICULO = '0069102';
const PRODUCT_ID = 'cea1a123-77ff-44ca-b189-b05118a68fdc';

type VariantRow = {
  id: string;
  sku: string;
  size_code: string;
  color_code: string;
  color_name: string;
  stock: number;
  order_count: number;
};

function expectedVariantSku(articulo: string, talle: string, color: string): string {
  return `${articulo}${talle}${color}`;
}

async function unlinkAll(productId: string): Promise<void> {
  await execute(`UPDATE products SET tienda_nube_id = NULL, mercado_libre_id = NULL WHERE id = ?`, [productId]);
  await execute(
    `UPDATE product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     SET pv.tienda_nube_variant_id = NULL,
         pv.mercado_libre_variant_id = NULL,
         pv.mercado_libre_item_id = NULL,
         pv.external_sku = NULL
     WHERE pc.product_id = ?`,
    [productId]
  );
  const variantRows = await query(
    `SELECT pv.id FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     WHERE pc.product_id = ?`,
    [productId]
  );
  const ids = variantRows.map((r: { id: string }) => r.id);
  if (ids.length > 0) {
    await execute(
      `DELETE FROM variant_publications WHERE variant_id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
  }
}

async function loadVariants(productId: string): Promise<VariantRow[]> {
  return (await query(
    `SELECT pv.id, pv.sku, s.size_code, c.code AS color_code, c.name AS color_name,
            COALESCE(st.stock, 0) AS stock,
            (SELECT COUNT(*) FROM order_items oi WHERE oi.variant_id = pv.id) AS order_count
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN sizes s ON s.id = pv.size_id
     JOIN colors c ON c.id = pc.color_id
     LEFT JOIN stocks st ON st.variant_id = pv.id
     WHERE pc.product_id = ?
     ORDER BY s.size_code, c.code`,
    [productId]
  )) as VariantRow[];
}

async function recreateVariantWithoutOrders(
  productId: string,
  v: VariantRow,
  productName: string
): Promise<void> {
  await execute('DELETE FROM stocks WHERE variant_id = ?', [v.id]);
  await execute('DELETE FROM product_variants WHERE id = ?', [v.id]);

  let sizeId = (await get(`SELECT id FROM sizes WHERE size_code = ?`, [v.size_code]))?.id;
  if (!sizeId) {
    sizeId = uuidv4();
    await execute(`INSERT INTO sizes (id, size_code, name) VALUES (?, ?, ?)`, [sizeId, v.size_code, v.size_code]);
  }

  let colorId = (await get(`SELECT id FROM colors WHERE code = ?`, [v.color_code]))?.id;
  if (!colorId) {
    colorId = uuidv4();
    await execute(`INSERT INTO colors (id, name, code, hex) VALUES (?, ?, ?, ?)`, [
      colorId,
      v.color_name || v.color_code,
      v.color_code,
      '#000000',
    ]);
  }

  let productColorId = (
    await get(`SELECT id FROM product_colors WHERE product_id = ? AND color_id = ?`, [productId, colorId])
  )?.id;
  if (!productColorId) {
    productColorId = uuidv4();
    await execute(`INSERT INTO product_colors (id, product_id, color_id) VALUES (?, ?, ?)`, [
      productColorId,
      productId,
      colorId,
    ]);
  }

  const variantId = uuidv4();
  const sku = expectedVariantSku(ARTICULO, v.size_code, v.color_code);
  await execute(
    `INSERT INTO product_variants (id, product_color_id, size_id, sku) VALUES (?, ?, ?, ?)`,
    [variantId, productColorId, sizeId, sku]
  );
  await execute(`INSERT INTO stocks (variant_id, stock) VALUES (?, ?)`, [variantId, v.stock]);
  console.log(`  Recreada variante ${sku} (stock ${v.stock}) — antes: ${v.id}`);
}

async function run() {
  console.log(`Reset artículo ${ARTICULO} (id ${PRODUCT_ID})...`);

  const product = await get(`SELECT id, sku, name FROM products WHERE id = ?`, [PRODUCT_ID]);
  if (!product) {
    console.error('Producto no encontrado.');
    process.exit(1);
  }
  console.log('Producto:', product.sku, '-', product.name);

  const del = await deleteProductById(PRODUCT_ID);
  if (del.deleted) {
    console.log('Producto eliminado (sin pedidos). Recreá con importación Tango.');
    process.exit(0);
  }
  if (del.error === 'in_orders') {
    console.log('No se puede eliminar el producto: hay variantes en pedidos. Continuando reset parcial...');
  }

  const before = await loadVariants(PRODUCT_ID);
  console.log(`Variantes actuales: ${before.length}`);

  console.log('1) Desvinculando ML/TN y limpiando publicaciones...');
  await unlinkAll(PRODUCT_ID);

  console.log('2) Normalizando SKUs...');
  for (const v of before) {
    const want = expectedVariantSku(ARTICULO, v.size_code, v.color_code);
    if (v.sku !== want) {
      await execute(`UPDATE product_variants SET sku = ? WHERE id = ?`, [want, v.id]);
      console.log(`  ${v.sku} -> ${want}`);
    }
  }

  console.log('3) Recreando variantes sin pedidos...');
  const fresh = await loadVariants(PRODUCT_ID);
  for (const v of fresh) {
    if (Number(v.order_count) === 0) {
      await recreateVariantWithoutOrders(PRODUCT_ID, v, product.name);
    }
  }

  const after = await loadVariants(PRODUCT_ID);
  console.log('\nListo. Variantes finales:', after.length);
  const withLinks = after.filter(
    (v: VariantRow & { mercado_libre_variant_id?: string }) =>
      (v as any).mercado_libre_variant_id || (v as any).tienda_nube_variant_id
  );
  console.log('Con vínculos ML/TN:', withLinks.length);
  console.log('Podés volver a vincular desde Inventario > Vincular y sincronizar.');
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
