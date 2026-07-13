/**
 * Import Tango/Multimedias (`customer_multimedia_entries`).
 * En false: no entra al saldo ni al historial del cliente (solo LupoHub).
 * El Excel sigue importándose para archivo; no se muestra en la ficha ni en cartera.
 */
export const INCLUDE_TANGO_IMPORT_IN_SYSTEM = false;

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

export const SQL_CARTERA_IMPORT_JOIN = INCLUDE_TANGO_IMPORT_IN_SYSTEM
  ? `LEFT JOIN (${CARTERA_IMPORTED_MOVEMENTS_AGG_SUBQUERY}) imp ON imp.customer_id = c.id`
  : '';

export const SQL_CARTERA_IMPORT_DEBE_EXPR = INCLUDE_TANGO_IMPORT_IN_SYSTEM
  ? 'COALESCE(imp.import_debe, 0)'
  : '0';

export const SQL_CARTERA_IMPORT_NC_EXPR = INCLUDE_TANGO_IMPORT_IN_SYSTEM
  ? 'COALESCE(imp.import_nc, 0)'
  : '0';

export const SQL_CARTERA_IMPORT_REC_EXPR = INCLUDE_TANGO_IMPORT_IN_SYSTEM
  ? 'COALESCE(imp.import_rec, 0)'
  : '0';

export const SQL_CARTERA_MULTIMEDIA_SALDO_EXPR = INCLUDE_TANGO_IMPORT_IN_SYSTEM
  ? `ROUND(${SQL_CARTERA_IMPORT_DEBE_EXPR} - ${SQL_CARTERA_IMPORT_NC_EXPR} - ${SQL_CARTERA_IMPORT_REC_EXPR}, 2)`
  : '0';

/** Número de recibo normalizado para emparejar payments ↔ líneas REC importadas. */
export const SQL_PAYMENT_RECEIPT_NORM_P = `CASE
  WHEN TRIM(COALESCE(p.receipt_number, '')) = '' THEN CONCAT('__ID__', p.id)
  ELSE UPPER(
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(p.receipt_number), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
  )
END`;

/** Pago en \`payments\` que duplica un recibo del Excel Tango/Multimedia. */
export const SQL_PAYMENT_MATCHES_MM_REC = `EXISTS (
  SELECT 1
  FROM customer_multimedia_entries e
  WHERE e.customer_id = p.customer_id
    AND (${SQL_MM_IS_RECIBO_IMPORTADO})
    AND TRIM(COALESCE(e.numero, '')) <> ''
    AND DATE(e.line_date) = DATE(p.date)
    AND ROUND(COALESCE(e.importe, 0), 2) = ROUND(COALESCE(p.amount, 0), 2)
    AND UPPER(
      REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(e.numero, '')), '-', ''), ' ', ''), '/', ''), '.', ''), '_', '')
    ) = ${SQL_PAYMENT_RECEIPT_NORM_P}
)`;

export const SQL_PAYMENT_NOTES_ARE_TANGO_IMPORT = `(
  COALESCE(p.notes, '') LIKE 'Importado Tango%'
  OR COALESCE(p.notes, '') LIKE 'Importado desde Excel%'
)`;

export const SQL_PAYMENT_RECEIPT_IS_TANGO_SYNTHETIC = `(
  TRIM(COALESCE(p.receipt_number, '')) LIKE 'IMPORT-%'
)`;

/** Cuando INCLUDE_TANGO_IMPORT_IN_SYSTEM es false: solo recibos cargados en LupoHub. */
export const SQL_WHERE_PAYMENT_SOLO_LUPOHUB = INCLUDE_TANGO_IMPORT_IN_SYSTEM
  ? '1=1'
  : `NOT (${SQL_PAYMENT_MATCHES_MM_REC})
      AND NOT (${SQL_PAYMENT_NOTES_ARE_TANGO_IMPORT})
      AND NOT (${SQL_PAYMENT_RECEIPT_IS_TANGO_SYNTHETIC})`;
