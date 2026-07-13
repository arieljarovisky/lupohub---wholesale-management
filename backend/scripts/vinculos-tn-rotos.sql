-- Vínculos TN rotos detectados en logs del 2026-06-29 (AutoSync ML→TN, error 404).
-- Ejecutar en la base de datos de producción para obtener artículo, nombre, color y talle.

-- Opción A: listar variantes LupoHub cuyo vínculo TN coincide con los IDs del log
SELECT
  p.sku AS articulo_sku,
  p.name AS articulo_nombre,
  COALESCE(NULLIF(TRIM(pv.external_sku), ''), NULLIF(TRIM(pv.sku), ''), pv.sku) AS variante_sku,
  c.name AS color,
  sz.size_code AS talle,
  COALESCE(st.stock, 0) AS stock_lupohub,
  p.mercado_libre_id AS ml_publicacion_padre,
  pv.mercado_libre_variant_id AS ml_variacion,
  pv.mercado_libre_item_id AS ml_item_propio,
  p.tienda_nube_id AS tn_producto,
  pv.tienda_nube_variant_id AS tn_variante,
  CASE
    WHEN pv.mercado_libre_item_id IS NOT NULL AND TRIM(pv.mercado_libre_item_id) != '' THEN 'publicacion_propia'
    WHEN p.mercado_libre_id IS NOT NULL AND pv.mercado_libre_variant_id IS NOT NULL THEN 'publicacion_padre'
    ELSE 'otro'
  END AS modo_sync
FROM product_variants pv
JOIN product_colors pc ON pc.id = pv.product_color_id
JOIN products p ON p.id = pc.product_id
LEFT JOIN colors c ON c.id = pc.color_id
LEFT JOIN sizes sz ON sz.id = pv.size_id
LEFT JOIN stocks st ON st.variant_id = pv.id
WHERE CONCAT(p.tienda_nube_id, '/', pv.tienda_nube_variant_id) IN (
  '198442872/1455293949',
  '198444444/810207647',
  '198576969/1455291344',
  '204276887/850644068',
  '204276887/850644062',
  '204276887/850644040',
  '204276887/1344829142',
  '204276887/1344829137',
  '204276887/850644103',
  '204276887/850644024',
  '204276887/850644132',
  '204276887/850644046',
  '204276887/850644098',
  '204276887/1344829133',
  '204276887/1344829125',
  '211518587/1075460769',
  '211518587/901278411',
  '211518587/1075460778',
  '211518587/1075460771',
  '211518587/1075460774',
  '211518587/1075460783',
  '211518587/1075460781',
  '251857667/1455426848',
  '251857667/1455426850',
  '251857667/1455426866',
  '302752027/1509710914',
  '302752027/1497631663',
  '302752027/1497631671',
  '302752027/1509710926',
  '302752027/1509710925',
  '302752027/1509710923',
  '302752027/1509710918',
  '302752027/1509710919',
  '307915388/1455288065',
  '307915388/1368449206',
  '344560142/1525936696',
  '344560142/1525936675',
  '344560142/1525936693',
  '344560142/1525936685',
  '344560142/1525936684',
  '344560142/1525936678',
  '346947261/1532655435',
  '346947261/1532655432',
  '346947261/1532655440',
  '346947261/1532655437'
)
ORDER BY p.sku, variante_sku;

-- Opción B: resumen por artículo (cuántas variantes rotas tiene cada uno)
SELECT
  p.sku AS articulo_sku,
  p.name AS articulo_nombre,
  COUNT(*) AS variantes_con_vinculo_tn_roto,
  GROUP_CONCAT(DISTINCT p.tienda_nube_id ORDER BY p.tienda_nube_id) AS productos_tn_afectados
FROM product_variants pv
JOIN product_colors pc ON pc.id = pv.product_color_id
JOIN products p ON p.id = pc.product_id
WHERE CONCAT(p.tienda_nube_id, '/', pv.tienda_nube_variant_id) IN (
  '198442872/1455293949', '198444444/810207647', '198576969/1455291344',
  '204276887/850644068', '204276887/850644062', '204276887/850644040',
  '204276887/1344829142', '204276887/1344829137', '204276887/850644103',
  '204276887/850644024', '204276887/850644132', '204276887/850644046',
  '204276887/850644098', '204276887/1344829133', '204276887/1344829125',
  '211518587/1075460769', '211518587/901278411', '211518587/1075460778',
  '211518587/1075460771', '211518587/1075460774', '211518587/1075460783',
  '211518587/1075460781', '251857667/1455426848', '251857667/1455426850',
  '251857667/1455426866', '302752027/1509710914', '302752027/1497631663',
  '302752027/1497631671', '302752027/1509710926', '302752027/1509710925',
  '302752027/1509710923', '302752027/1509710918', '302752027/1509710919',
  '307915388/1455288065', '307915388/1368449206', '344560142/1525936696',
  '344560142/1525936675', '344560142/1525936693', '344560142/1525936685',
  '344560142/1525936684', '344560142/1525936678', '346947261/1532655435',
  '346947261/1532655432', '346947261/1532655440', '346947261/1532655437'
)
GROUP BY p.sku, p.name
ORDER BY variantes_con_vinculo_tn_roto DESC, p.sku;

-- Opción C (recomendada en vivo): usar el diagnóstico del backend
-- GET /api/integrations/mercadolibre/sync-issues
-- Filtrar en cliente las filas con issue_type = 'TN_NO_ENCONTRADO'
