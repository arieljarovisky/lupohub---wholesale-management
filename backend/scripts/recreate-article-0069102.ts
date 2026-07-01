/**
 * Elimina y recrea el artículo 0069102 migrando pedidos y referencias al producto nuevo.
 *
 * Uso: cd backend && NODE_ENV=production npx ts-node --transpile-only scripts/recreate-article-0069102.ts
 */

import { v4 as uuidv4 } from 'uuid';
import { pool, query } from '../src/database/db';

const ARTICULO = '0069102';

type VariantSnapshot = {
  id: string;
  sku: string;
  size_code: string;
  size_id: string;
  color_code: string;
  color_id: string;
  color_name: string;
  stock: number;
};

type ProductSnapshot = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  base_price: number;
  description: string | null;
  archived: number;
  ultimo_despacho_id: string | null;
  pais_origen: string | null;
  mercado_libre_pack_size: number;
  tienda_nube_pack_size: number;
  mayorista_pack_size: number;
};

function variantKey(sizeCode: string, colorCode: string): string {
  return `${sizeCode}-${colorCode}`;
}

function expectedVariantSku(articulo: string, talle: string, color: string): string {
  return `${articulo}${talle}${color}`;
}

async function resolveOldProduct(): Promise<ProductSnapshot | null> {
  const row = await query(
    `SELECT id, sku, name, category, base_price, description, archived,
            ultimo_despacho_id, pais_origen, mercado_libre_pack_size,
            tienda_nube_pack_size, mayorista_pack_size
     FROM products WHERE sku = ? LIMIT 1`,
    [ARTICULO]
  );
  if (row[0]) return row[0] as ProductSnapshot;

  const legacy = await query(
    `SELECT id, sku, name, category, base_price, description, archived,
            ultimo_despacho_id, pais_origen, mercado_libre_pack_size,
            tienda_nube_pack_size, mayorista_pack_size
     FROM products WHERE sku LIKE ? ORDER BY updated_at DESC LIMIT 1`,
    [`${ARTICULO}__OLD__%`]
  );
  return (legacy[0] as ProductSnapshot) || null;
}

async function loadVariants(productId: string): Promise<VariantSnapshot[]> {
  return (await query(
    `SELECT pv.id, pv.sku, s.size_code, s.id AS size_id, c.code AS color_code, c.id AS color_id,
            c.name AS color_name, COALESCE(st.stock, 0) AS stock
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN sizes s ON s.id = pv.size_id
     JOIN colors c ON c.id = pc.color_id
     LEFT JOIN stocks st ON st.variant_id = pv.id
     WHERE pc.product_id = ?
     ORDER BY s.size_code, c.code`,
    [productId]
  )) as VariantSnapshot[];
}

async function countRefs(productId: string, variantIds: string[]) {
  if (variantIds.length === 0) {
    return { orderItems: 0, stockMovements: 0, luposhop: 0, priceLists: 0, despachoItems: 0 };
  }
  const ph = variantIds.map(() => '?').join(',');
  const [oi, sm, ls, pl, di] = await Promise.all([
    query(`SELECT COUNT(*) AS c FROM order_items WHERE variant_id IN (${ph})`, variantIds),
    query(`SELECT COUNT(*) AS c FROM stock_movements WHERE variant_id IN (${ph})`, variantIds),
    query(`SELECT COUNT(*) AS c FROM variant_luposhop_stock WHERE variant_id IN (${ph})`, variantIds),
    query(`SELECT COUNT(*) AS c FROM price_list_items WHERE product_id = ?`, [productId]),
    query(`SELECT COUNT(*) AS c FROM despacho_items WHERE product_id = ? OR variant_id IN (${ph})`, [
      productId,
      ...variantIds,
    ]),
  ]);
  return {
    orderItems: Number(oi[0]?.c || 0),
    stockMovements: Number(sm[0]?.c || 0),
    luposhop: Number(ls[0]?.c || 0),
    priceLists: Number(pl[0]?.c || 0),
    despachoItems: Number(di[0]?.c || 0),
  };
}

async function run() {
  const oldProduct = await resolveOldProduct();
  if (!oldProduct) {
    console.error(`No se encontró producto con SKU ${ARTICULO}.`);
    process.exit(1);
  }

  const oldProductId = oldProduct.id;
  const variants = await loadVariants(oldProductId);
  if (variants.length === 0) {
    console.error('El producto no tiene variantes.');
    process.exit(1);
  }

  const oldVariantIds = variants.map((v) => v.id);
  const beforeRefs = await countRefs(oldProductId, oldVariantIds);

  console.log(`Artículo actual: ${oldProduct.sku} (${oldProductId}) — ${variants.length} variantes`);
  console.log('Referencias:', beforeRefs);

  const newProductId = uuidv4();
  const oldSkuBackup = `${ARTICULO}__OLD__${Date.now()}`;
  const idMap = new Map<string, string>();

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(`UPDATE products SET sku = ? WHERE id = ?`, [oldSkuBackup, oldProductId]);

    await conn.execute(
      `INSERT INTO products (
        id, sku, name, category, base_price, description,
        tienda_nube_id, mercado_libre_id, archived,
        ultimo_despacho_id, pais_origen,
        mercado_libre_pack_size, tienda_nube_pack_size, mayorista_pack_size
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
      [
        newProductId,
        ARTICULO,
        oldProduct.name,
        oldProduct.category || 'General',
        oldProduct.base_price ?? 0,
        oldProduct.description,
        oldProduct.archived ?? 0,
        oldProduct.ultimo_despacho_id,
        oldProduct.pais_origen || 'Brasil',
        oldProduct.mercado_libre_pack_size ?? 1,
        oldProduct.tienda_nube_pack_size ?? 1,
        oldProduct.mayorista_pack_size ?? 1,
      ]
    );

    const productColorByColorId = new Map<string, string>();

    for (const v of variants) {
      let productColorId = productColorByColorId.get(v.color_id);
      if (!productColorId) {
        productColorId = uuidv4();
        await conn.execute(`INSERT INTO product_colors (id, product_id, color_id) VALUES (?, ?, ?)`, [
          productColorId,
          newProductId,
          v.color_id,
        ]);
        productColorByColorId.set(v.color_id, productColorId);
      }

      const newVariantId = uuidv4();
      const sku = expectedVariantSku(ARTICULO, v.size_code, v.color_code);
      await conn.execute(
        `INSERT INTO product_variants (id, product_color_id, size_id, sku) VALUES (?, ?, ?, ?)`,
        [newVariantId, productColorId, v.size_id, sku]
      );
      await conn.execute(`INSERT INTO stocks (variant_id, stock) VALUES (?, ?)`, [newVariantId, v.stock]);
      idMap.set(v.id, newVariantId);
    }

    let migratedOrderItems = 0;
    let migratedStockMovements = 0;
    let migratedLuposhop = 0;

    for (const [oldId, newId] of idMap) {
      const [oiRes] = await conn.execute(`UPDATE order_items SET variant_id = ? WHERE variant_id = ?`, [
        newId,
        oldId,
      ]);
      migratedOrderItems += (oiRes as any)?.affectedRows || 0;

      const [smRes] = await conn.execute(`UPDATE stock_movements SET variant_id = ? WHERE variant_id = ?`, [
        newId,
        oldId,
      ]);
      migratedStockMovements += (smRes as any)?.affectedRows || 0;

      const [lsRows] = await conn.query(`SELECT stock FROM variant_luposhop_stock WHERE variant_id = ?`, [oldId]);
      const lsList = lsRows as Array<{ stock: number }>;
      if (lsList.length > 0) {
        await conn.execute(
          `INSERT INTO variant_luposhop_stock (variant_id, stock) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE stock = VALUES(stock)`,
          [newId, lsList[0].stock]
        );
        await conn.execute(`DELETE FROM variant_luposhop_stock WHERE variant_id = ?`, [oldId]);
        migratedLuposhop += 1;
      }

      await conn.execute(
        `UPDATE despacho_items SET variant_id = ?, product_id = ? WHERE variant_id = ?`,
        [newId, newProductId, oldId]
      );
    }

    const [plRes] = await conn.execute(`UPDATE price_list_items SET product_id = ? WHERE product_id = ?`, [
      newProductId,
      oldProductId,
    ]);
    const migratedPriceLists = (plRes as any)?.affectedRows || 0;

    await conn.execute(`UPDATE despacho_items SET product_id = ? WHERE product_id = ?`, [newProductId, oldProductId]);

    await conn.execute(`DELETE FROM products WHERE id = ?`, [oldProductId]);

    await conn.commit();

    const newVariants = await loadVariants(newProductId);
    const afterRefs = await countRefs(newProductId, newVariants.map((v) => v.id));

    console.log('\n✓ Recreación completada');
    console.log(`  Producto nuevo: ${newProductId} (SKU ${ARTICULO})`);
    console.log(`  Producto viejo eliminado: ${oldProductId} (SKU respaldo ${oldSkuBackup})`);
    console.log(`  Variantes nuevas: ${newVariants.length}`);
    console.log(`  order_items migrados: ${migratedOrderItems} (ahora ${afterRefs.orderItems})`);
    console.log(`  stock_movements migrados: ${migratedStockMovements} (ahora ${afterRefs.stockMovements})`);
    console.log(`  variant_luposhop_stock migrados: ${migratedLuposhop} (ahora ${afterRefs.luposhop})`);
    console.log(`  price_list_items migrados: ${migratedPriceLists} (ahora ${afterRefs.priceLists})`);
    console.log(`  despacho_items: ${afterRefs.despachoItems}`);

    if (afterRefs.orderItems !== beforeRefs.orderItems) {
      console.warn('⚠ Cantidad de order_items no coincide con el snapshot previo.');
    }
  } catch (e) {
    try {
      await conn.rollback();
    } catch {
      // ignore
    }
    throw e;
  } finally {
    conn.release();
  }

  process.exit(0);
}

run().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
