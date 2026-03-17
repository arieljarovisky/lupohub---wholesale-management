/**
 * Tabla variant_publications: permite vincular una variante con varias publicaciones
 * (ej. misma variante en ML por unidad y en ML por pack, o en TN en dos productos distintos).
 * Cada publicación tiene su propio pack_size para el stock enviado.
 */
import { execute, query, get } from './db';

export const addVariantPublicationsTable = async () => {
  try {
    const tableExists = await query(
      `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'variant_publications'`
    );
    if (tableExists && (tableExists as any[]).length > 0) {
      console.log('✓ Tabla variant_publications ya existe');
      await migrateExistingLinksToVariantPublications();
      return;
    }

    await execute(`
      CREATE TABLE variant_publications (
        id VARCHAR(36) PRIMARY KEY,
        variant_id VARCHAR(36) NOT NULL,
        platform VARCHAR(50) NOT NULL,
        external_product_id VARCHAR(100) NOT NULL,
        external_variant_id VARCHAR(100) NOT NULL DEFAULT '',
        pack_size INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE,
        UNIQUE KEY uq_variant_platform_external (variant_id, platform, external_product_id, external_variant_id)
      )
    `);
    console.log('✓ Tabla variant_publications creada');

    await migrateExistingLinksToVariantPublications();
  } catch (e: any) {
    console.error('[variant_publications] Error:', e.message);
    throw e;
  }
};

async function migrateExistingLinksToVariantPublications() {
  const { v4: uuidv4 } = await import('uuid');
  const rows = await query(`
    SELECT pv.id AS variant_id, p.tienda_nube_id AS tn_product_id, pv.tienda_nube_variant_id AS tn_variant_id,
           p.tienda_nube_pack_size AS tn_pack,
           p.mercado_libre_id AS ml_product_id, pv.mercado_libre_variant_id AS ml_variant_id, pv.mercado_libre_item_id AS ml_item_id,
           COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack
    FROM product_variants pv
    JOIN product_colors pc ON pc.id = pv.product_color_id
    JOIN products p ON p.id = pc.product_id
    WHERE pv.tienda_nube_variant_id IS NOT NULL AND pv.tienda_nube_variant_id != ''
       OR pv.mercado_libre_variant_id IS NOT NULL AND pv.mercado_libre_variant_id != ''
       OR pv.mercado_libre_item_id IS NOT NULL AND pv.mercado_libre_item_id != ''
  `);

  let inserted = 0;
  for (const r of rows as any[]) {
    const tnPack = Math.max(1, Number(r.tn_pack) || 1);
    const mlPack = Math.max(1, Number(r.ml_pack) || 1);

    if (r.tn_product_id && r.tn_variant_id) {
      const existing = await query(
        `SELECT id FROM variant_publications WHERE variant_id = ? AND platform = 'tiendanube' AND external_product_id = ? AND external_variant_id = ?`,
        [r.variant_id, r.tn_product_id, r.tn_variant_id]
      );
      if (!(existing as any[])?.length) {
        await execute(
          `INSERT INTO variant_publications (id, variant_id, platform, external_product_id, external_variant_id, pack_size) VALUES (?, ?, 'tiendanube', ?, ?, ?)`,
          [uuidv4(), r.variant_id, r.tn_product_id, r.tn_variant_id, tnPack]
        );
        inserted++;
      }
    }

    const mlProductId = r.ml_item_id || r.ml_product_id;
    const mlVariantId = (r.ml_variant_id && String(r.ml_variant_id).trim()) || '';
    if (mlProductId) {
      const existing = await query(
        `SELECT id FROM variant_publications WHERE variant_id = ? AND platform = 'mercadolibre' AND external_product_id = ? AND external_variant_id = ?`,
        [r.variant_id, mlProductId, mlVariantId]
      );
      if (!(existing as any[])?.length) {
        await execute(
          `INSERT INTO variant_publications (id, variant_id, platform, external_product_id, external_variant_id, pack_size) VALUES (?, ?, 'mercadolibre', ?, ?, ?)`,
          [uuidv4(), r.variant_id, mlProductId, mlVariantId, mlPack]
        );
        inserted++;
      }
    }
  }
  if (inserted > 0) {
    console.log(`✓ Migrados ${inserted} enlaces existentes a variant_publications`);
  }
}
