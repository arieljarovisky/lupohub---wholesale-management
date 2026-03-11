/**
 * Script para agrupar productos "trifil" mal creados.
 * Toma todos los productos cuyo nombre contiene "trifil", los agrupa por artículo base
 * (primeros 6 caracteres del SKU, ej. C01323 o Q05460) y fusiona cada grupo en un solo producto
 * con varias variantes (una por cada talle/color que existía).
 *
 * Uso (desde la raíz del repo):
 *   cd backend && npx ts-node -r tsconfig-paths/register scripts/merge-trifil-products.ts
 * o con variables de entorno cargadas:
 *   cd backend && node --loader ts-node/esm ../../node_modules/ts-node/dist/esm.mjs scripts/merge-trifil-products.ts
 *
 * Requiere MYSQL_URL o DATABASE_URL en .env (o variables DB_*).
 */

import { query, execute, get } from '../src/database/db';
import { v4 as uuidv4 } from 'uuid';

const BASE_SKU_LENGTH = 6;

async function run() {
  console.log('Buscando productos con "trifil" en el nombre...');
  const products = await query(
    `SELECT id, sku, name, category, base_price FROM products WHERE name LIKE ? ORDER BY sku`,
    ['%trifil%']
  );
  if (products.length === 0) {
    console.log('No se encontraron productos con "trifil".');
    return;
  }

  const byBase = new Map<string, typeof products>();
  for (const p of products) {
    const base = String(p.sku).substring(0, BASE_SKU_LENGTH);
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base)!.push(p);
  }

  const toMerge = Array.from(byBase.entries()).filter(([, list]) => list.length > 1);
  if (toMerge.length === 0) {
    console.log('Todos los productos trifil ya tienen SKU base único (no hay duplicados por artículo).');
    return;
  }

  console.log(`Se fusionarán ${toMerge.length} grupo(s).`);
  for (const [baseSku, list] of toMerge) {
    console.log(`  - ${baseSku}: ${list.length} productos -> 1 (${list.map((p: any) => p.sku).join(', ')})`);
  }

  for (const [baseSku, list] of toMerge) {
    const keeper = list[0];
    const others = list.slice(1);
    const keeperName = keeper.name;
    const keeperId = keeper.id;

    console.log(`\nProcesando artículo base ${baseSku} (keeper: ${keeper.sku}, id: ${keeperId})...`);

    await execute(`UPDATE products SET sku = ?, name = ? WHERE id = ?`, [baseSku, keeperName, keeperId]);

    for (const other of others) {
      const otherProductColors = await query(
        `SELECT id, color_id FROM product_colors WHERE product_id = ?`,
        [other.id]
      );
      for (const opc of otherProductColors) {
        let keeperPc = await get(
          `SELECT id FROM product_colors WHERE product_id = ? AND color_id = ?`,
          [keeperId, opc.color_id]
        );
        if (!keeperPc) {
          const newPcId = uuidv4();
          await execute(
            `INSERT INTO product_colors (id, product_id, color_id) VALUES (?, ?, ?)`,
            [newPcId, keeperId, opc.color_id]
          );
          keeperPc = { id: newPcId };
        }
        const res = await execute(
          `UPDATE product_variants SET product_color_id = ? WHERE product_color_id = ?`,
          [keeperPc.id, opc.id]
        );
        const affected = (res as any)?.affectedRows ?? 0;
        if (affected > 0) console.log(`    Movidas ${affected} variante(s) de producto ${other.sku} -> keeper`);
      }
      await execute(`DELETE FROM products WHERE id = ?`, [other.id]);
      console.log(`    Eliminado producto duplicado: ${other.sku} (id: ${other.id})`);
    }
  }

  console.log('\nListo. Ejecutá de nuevo las queries de trifil-diagnostico.sql para verificar.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
