/** Clasificación de líneas en customer_multimedia_entries (misma lógica que export historial). */

export const SQL_MM_IS_NC_IMPORTADO = `(
  UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'NC%'
  OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'N/C%'
  OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'N.C%'
  OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'CDE%'
  OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'CRE%'
  OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'CRÉ%'
  OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'NOTA%CRED%'
  OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'NOTA%CRÉD%'
  OR UPPER(COALESCE(e.detalle, '')) LIKE '%NOTA%CRED%'
  OR UPPER(COALESCE(e.detalle, '')) LIKE '%NOTA%CRÉD%'
  OR UPPER(COALESCE(e.detalle, '')) LIKE '%N/C%'
  OR UPPER(COALESCE(e.numero, '')) LIKE 'NC %'
  OR UPPER(COALESCE(e.numero, '')) LIKE 'N/C%'
)`;

export const SQL_MM_IS_ND_IMPORTADO = `(
  UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'ND%'
  OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'N/D%'
  OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'DEB%'
  OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'DBE%'
  OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'DÉB%'
  OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'NOTA%DEB%'
  OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE '%NOTA%DÉB%'
  OR UPPER(COALESCE(e.detalle, '')) LIKE '%NOTA%DEB%'
  OR UPPER(COALESCE(e.detalle, '')) LIKE '%NOTA%DÉB%'
)`;

export const SQL_MM_IS_FAC_IMPORTADA = `(
  UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'FAC%'
  OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'FC%'
  OR UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'F/A%'
  OR UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('COMP', 'COMPROBANTE')
  OR UPPER(COALESCE(e.detalle, '')) LIKE '%FACTURA%'
  OR UPPER(COALESCE(e.detalle, '')) LIKE '%COMPROBANTE%'
)`;

/** FAC/ND importada de Tango cuando el mismo pedido ya tiene factura AFIP en LupoHub. */
export const SQL_MM_FAC_IMPORTADA_CON_FACTURA_AFIP = `(
  EXISTS (
    SELECT 1
    FROM invoices i
    INNER JOIN orders o ON o.id = i.order_id
    WHERE o.customer_id = e.customer_id
      AND (
        UPPER(COALESCE(e.detalle, '')) LIKE CONCAT('%', o.id, '%')
        OR UPPER(COALESCE(e.detalle, '')) LIKE CONCAT('%', REPLACE(o.id, 'O-', '0-'), '%')
        OR UPPER(COALESCE(e.detalle, '')) LIKE CONCAT('%', REPLACE(o.id, '0-', 'O-'), '%')
      )
  )
)`;

export const SQL_MM_IS_RECIBO_IMPORTADO = `(
  UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'REC%'
  OR UPPER(TRIM(COALESCE(e.tipo, ''))) IN ('PAGO', 'COBRO', 'INGRESO', 'R/C')
  OR UPPER(COALESCE(e.detalle, '')) LIKE '%RECIBO%'
  OR UPPER(COALESCE(e.detalle, '')) LIKE '%PAGO%'
  OR UPPER(COALESCE(e.detalle, '')) LIKE '%COBRO%'
)`;

/** Recibos importados que no tienen el mismo pago en Facturación (evita restar dos veces). */
export const SQL_MM_RECIBO_IMPORTADO_SIN_PAGO = `(
  ${SQL_MM_IS_RECIBO_IMPORTADO}
  AND TRIM(COALESCE(e.numero, '')) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM payments p
    WHERE p.customer_id = e.customer_id
      AND DATE(p.date) = DATE(e.line_date)
      AND ROUND(COALESCE(p.amount, 0), 2) = ROUND(ABS(COALESCE(e.importe, 0)), 2)
      AND UPPER(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
      ) = CASE
        WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
        ELSE UPPER(
          REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
        )
      END
  )
)`;

export const CARTERA_IMPORTED_MOVEMENTS_AGG_SUBQUERY = `
  SELECT
    e.customer_id,
    SUM(
      CASE
        WHEN (${SQL_MM_IS_FAC_IMPORTADA} OR ${SQL_MM_IS_ND_IMPORTADO})
          AND NOT (${SQL_MM_FAC_IMPORTADA_CON_FACTURA_AFIP})
        THEN ROUND(ABS(COALESCE(e.importe, 0)), 2)
        ELSE 0
      END
    ) AS import_debe,
    SUM(
      CASE
        WHEN ${SQL_MM_IS_NC_IMPORTADO}
        THEN ROUND(ABS(COALESCE(e.importe, 0)), 2)
        ELSE 0
      END
    ) AS import_nc,
    SUM(
      CASE
        WHEN ${SQL_MM_RECIBO_IMPORTADO_SIN_PAGO}
        THEN ROUND(ABS(COALESCE(e.importe, 0)), 2)
        ELSE 0
      END
    ) AS import_rec
  FROM customer_multimedia_entries e
  WHERE e.importe IS NOT NULL
    AND ABS(COALESCE(e.importe, 0)) > 0.001
    AND UPPER(TRIM(COALESCE(e.tipo, ''))) NOT IN ('SALDO AL', 'SALDO_INICIAL', 'SALDO')
  GROUP BY e.customer_id`;
