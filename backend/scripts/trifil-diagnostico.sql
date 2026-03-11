-- =============================================================================
-- DIAGNÓSTICO: Productos "trifil" agrupados por artículo base (primeros 6 caracteres del SKU)
-- Ejecutá estas consultas en tu cliente MySQL para ver cómo quedan agrupados.
-- =============================================================================

-- 1) Productos que contienen "trifil" en el nombre, con artículo base (LEFT(sku, 6))
SELECT
  LEFT(p.sku, 6) AS articulo_base,
  COUNT(*) AS cantidad_productos,
  GROUP_CONCAT(p.sku ORDER BY p.sku SEPARATOR ', ') AS skus,
  MAX(p.name) AS nombre_ejemplo
FROM products p
WHERE p.name LIKE '%trifil%'
GROUP BY LEFT(p.sku, 6)
ORDER BY articulo_base;

-- 2) Detalle por producto: SKU, nombre, stock total
SELECT
  p.id,
  p.sku,
  LEFT(p.sku, 6) AS articulo_base,
  p.name,
  (SELECT COALESCE(SUM(s.stock), 0) FROM product_variants pv LEFT JOIN stocks s ON s.variant_id = pv.id WHERE pv.product_color_id IN (SELECT id FROM product_colors WHERE product_id = p.id)) AS stock_total
FROM products p
WHERE p.name LIKE '%trifil%'
ORDER BY LEFT(p.sku, 6), p.sku;

-- 3) Variantes por producto (para ver talle/color de cada uno)
SELECT
  p.sku AS product_sku,
  LEFT(p.sku, 6) AS articulo_base,
  pv.sku AS variant_sku,
  s.size_code,
  c.code AS color_code
FROM products p
JOIN product_colors pc ON pc.product_id = p.id
JOIN product_variants pv ON pv.product_color_id = pc.id
JOIN sizes s ON s.id = pv.size_id
JOIN colors c ON c.id = pc.color_id
WHERE p.name LIKE '%trifil%'
ORDER BY LEFT(p.sku, 6), p.sku, pv.sku;
