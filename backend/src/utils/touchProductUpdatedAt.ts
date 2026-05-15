import { execute } from '../database/db';

/** Marca el artículo padre como modificado (p. ej. tras cambio de stock en una variante). */
export async function touchProductUpdatedAt(productId: string): Promise<void> {
  if (!productId) return;
  await execute(`UPDATE products SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [productId]);
}

export async function touchProductUpdatedAtByVariantId(variantId: string): Promise<void> {
  if (!variantId) return;
  await execute(
    `UPDATE products p
     JOIN product_colors pc ON pc.product_id = p.id
     JOIN product_variants pv ON pv.product_color_id = pc.id
     SET p.updated_at = CURRENT_TIMESTAMP
     WHERE pv.id = ?`,
    [variantId]
  );
}
