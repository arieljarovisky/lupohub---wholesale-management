-- =============================================================================
-- DIAGNÓSTICO: ¿el stock se descontó de más (bug) o el conteo físico no coincide?
-- Solo lectura (SELECT). Requiere MySQL 8+ (usa funciones de ventana).
--
-- Cómo leer los resultados:
--   Consultas 1, 2, 3 y 5 vacías  -> el sistema hizo las cuentas bien; la diferencia
--                                    está en el conteo físico o en una carga manual.
--   Consulta 1 con filas           -> BUG: el registro del pedido no coincide con lo que se movió.
--   Consulta 2 con filas           -> BUG: un pedido tiene tomado más de lo que corresponde.
--   Consulta 3 con filas           -> doble descuento del sistema VIEJO (antes del 16/10/2026),
--                                    que se arrastró al motor nuevo.
--   Consulta 4                     -> movimientos duplicados del mismo pedido (pista, no prueba).
--   Consulta 5 con filas           -> alguien cambió el stock sin dejar movimiento.
-- =============================================================================


-- 1) Lo que el pedido dice tener tomado vs. lo que realmente se movió en el historial.
--    Si no coinciden, el motor perdió la cuenta (bug).
--    Nota: si se fusionaron variantes duplicadas, pueden aparecer falsos positivos
--    (los movimientos quedan en la variante vieja y el registro pasa a la nueva).
SELECT
  wos.order_id,
  o.status,
  o.stock_state,
  pv.sku,
  wos.units            AS unidades_registradas,
  COALESCE(m.neto, 0)  AS unidades_movidas,
  COALESCE(m.neto, 0) - wos.units AS diferencia
FROM wholesale_order_stock wos
JOIN orders o ON o.id = wos.order_id
LEFT JOIN product_variants pv ON pv.id = wos.variant_id
LEFT JOIN (
  SELECT
    SUBSTRING_INDEX(reference, ': ', -1) AS order_id,
    variant_id,
    -SUM(quantity_change) AS neto
  FROM stock_movements
  WHERE reference REGEXP '^(Pedido|Ajuste pedido|Cancelación pedido|Restauración pedido|Nota de crédito pedido): '
  GROUP BY 1, 2
) m ON m.order_id = wos.order_id AND m.variant_id = wos.variant_id
WHERE COALESCE(m.neto, 0) <> wos.units
ORDER BY ABS(COALESCE(m.neto, 0) - wos.units) DESC;


-- 2) Pedidos del motor nuevo que tienen tomado MÁS de lo que piden/armaron.
--    (Armado terminado = cuenta lo pickeado; antes = cuenta lo pedido. Packs -> unidades.)
SELECT
  o.id AS order_id,
  o.status,
  pv.sku,
  esperado.unidades - COALESCE(wos.returned_units, 0) AS deberia_tener,
  wos.units AS tiene_tomado,
  wos.units - (esperado.unidades - COALESCE(wos.returned_units, 0)) AS de_mas
FROM orders o
JOIN wholesale_order_stock wos ON wos.order_id = o.id
JOIN product_variants pv ON pv.id = wos.variant_id
JOIN (
  SELECT
    oi.order_id,
    oi.variant_id,
    SUM(
      (CASE WHEN o2.status IN ('Falta controlar', 'Controlado', 'Despachado')
            THEN LEAST(oi.quantity, COALESCE(oi.picked, 0))
            ELSE oi.quantity END)
      * (CASE WHEN COALESCE(oi.sell_as_pack, 0) = 1
              THEN GREATEST(1, COALESCE(NULLIF(p.mayorista_pack_size, 0), 1))
              ELSE 1 END)
    ) AS unidades
  FROM order_items oi
  JOIN orders o2 ON o2.id = oi.order_id
  JOIN product_variants pv2 ON pv2.id = oi.variant_id
  JOIN product_colors pc ON pc.id = pv2.product_color_id
  JOIN products p ON p.id = pc.product_id
  GROUP BY oi.order_id, oi.variant_id
) esperado ON esperado.order_id = o.id AND esperado.variant_id = wos.variant_id
WHERE COALESCE(o.stock_frozen, 0) = 0
  AND o.stock_state = 'deducted'
  AND o.status <> 'Cancelado'
  AND wos.units > esperado.unidades - COALESCE(wos.returned_units, 0)
ORDER BY de_mas DESC;


-- 3) Pedidos migrados del sistema viejo (congelados) donde se descontó más de lo pedido.
--    Esto es un doble descuento VIEJO que quedó guardado al migrar.
SELECT
  o.id AS order_id,
  o.date,
  o.status,
  pv.sku,
  pedido.unidades AS unidades_pedidas,
  wos.frozen_units AS unidades_descontadas_sistema_viejo,
  wos.units AS sigue_tomado,
  wos.frozen_units - pedido.unidades AS de_mas
FROM orders o
JOIN wholesale_order_stock wos ON wos.order_id = o.id
JOIN product_variants pv ON pv.id = wos.variant_id
JOIN (
  SELECT
    oi.order_id,
    oi.variant_id,
    SUM(oi.quantity * (CASE WHEN COALESCE(oi.sell_as_pack, 0) = 1
                            THEN GREATEST(1, COALESCE(NULLIF(p.mayorista_pack_size, 0), 1))
                            ELSE 1 END)) AS unidades
  FROM order_items oi
  JOIN product_variants pv2 ON pv2.id = oi.variant_id
  JOIN product_colors pc ON pc.id = pv2.product_color_id
  JOIN products p ON p.id = pc.product_id
  GROUP BY oi.order_id, oi.variant_id
) pedido ON pedido.order_id = o.id AND pedido.variant_id = wos.variant_id
WHERE COALESCE(o.stock_frozen, 0) = 1
  AND wos.frozen_units > pedido.unidades
ORDER BY de_mas DESC;


-- 4) Mismo pedido + misma variante con más de un descuento 'Pedido: ...'.
--    Puede ser normal (faltaba stock y se completó después, o se ajustó al terminar el armado);
--    mirá las fechas y cantidades: dos descuentos iguales con segundos de diferencia es sospechoso.
SELECT
  sm.reference,
  pv.sku,
  COUNT(*) AS cantidad_descuentos,
  SUM(-sm.quantity_change) AS total_descontado,
  GROUP_CONCAT(CONCAT(sm.created_at, ' (', sm.quantity_change, ')') ORDER BY sm.created_at SEPARATOR ' | ') AS detalle
FROM stock_movements sm
LEFT JOIN product_variants pv ON pv.id = sm.variant_id
WHERE sm.reference LIKE 'Pedido: %'
  AND sm.quantity_change < 0
GROUP BY sm.reference, sm.variant_id, pv.sku
HAVING COUNT(*) > 1
ORDER BY sm.reference;


-- 5) Saltos en el historial: el stock "anterior" de un movimiento no coincide con el "nuevo"
--    del movimiento previo. Significa que algo cambió el stock SIN registrar movimiento.
SELECT *
FROM (
  SELECT
    pv.sku,
    sm.created_at,
    sm.movement_type,
    sm.reference,
    LAG(sm.new_stock) OVER (PARTITION BY sm.variant_id ORDER BY sm.created_at, sm.id) AS stock_que_habia,
    sm.previous_stock AS stock_que_registro,
    sm.previous_stock - LAG(sm.new_stock) OVER (PARTITION BY sm.variant_id ORDER BY sm.created_at, sm.id) AS salto
  FROM stock_movements sm
  LEFT JOIN product_variants pv ON pv.id = sm.variant_id
  WHERE sm.created_at >= '2026-10-16'
) t
WHERE t.salto <> 0
ORDER BY t.created_at DESC;


-- 6) Historial completo de UN artículo (cambiá el SKU). Útil para revisar un caso puntual
--    a mano contra el conteo físico.
SELECT
  sm.created_at,
  sm.movement_type,
  sm.reference,
  sm.previous_stock,
  sm.quantity_change,
  sm.new_stock
FROM stock_movements sm
JOIN product_variants pv ON pv.id = sm.variant_id
WHERE pv.sku = 'PONER_SKU_ACA'
ORDER BY sm.created_at, sm.id;
