import pool, { query } from '../database/db';
import { addStockDailySnapshots } from '../database/add_stock_daily_snapshots';

const BA_TZ = 'America/Argentina/Buenos_Aires';
const DIFF_LIMIT = 8000;

export function buenosAiresDate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export type StockSnapshotDay = {
  date: string;
  variants: number;
  variantsWithStock: number;
  units: number;
  takenAt: string | null;
};

export type StockSnapshotDiffRow = {
  sku: string;
  productSku: string;
  productName: string;
  color: string;
  size: string;
  fromStock: number;
  toStock: number;
  delta: number;
};

export type StockSnapshotCompare = {
  from: string;
  to: string;
  toLabel: string;
  truncated: boolean;
  summary: {
    variantsDown: number;
    unitsDown: number;
    variantsUp: number;
    unitsUp: number;
  };
  rows: StockSnapshotDiffRow[];
};

const VARIANT_SELECT = `
  SELECT
    pv.id AS variant_id,
    COALESCE(NULLIF(TRIM(pv.external_sku), ''), pv.sku) AS sku,
    p.sku AS product_sku,
    p.name AS product_name,
    col.name AS color_name,
    COALESCE(sz.size_code, sz.name) AS size_code,
    COALESCE(s.stock, 0) AS stock
  FROM product_variants pv
  JOIN product_colors pc ON pc.id = pv.product_color_id
  JOIN products p ON p.id = pc.product_id
  LEFT JOIN colors col ON col.id = pc.color_id
  LEFT JOIN sizes sz ON sz.id = pv.size_id
  LEFT JOIN stocks s ON s.variant_id = pv.id
`;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function text(v: unknown): string {
  return v == null ? '' : String(v);
}

export async function listStockSnapshotDays(): Promise<StockSnapshotDay[]> {
  await addStockDailySnapshots();
  const rows = await query(
    `SELECT
       DATE_FORMAT(snapshot_date, '%Y-%m-%d') AS snapshot_date,
       COUNT(*) AS variants,
       SUM(CASE WHEN stock > 0 THEN 1 ELSE 0 END) AS variants_with_stock,
       SUM(stock) AS units,
       DATE_FORMAT(CONVERT_TZ(MIN(created_at), '+00:00', '-03:00'), '%Y-%m-%d %H:%i') AS taken_at
     FROM stock_daily_snapshots
     GROUP BY snapshot_date
     ORDER BY snapshot_date DESC`
  );
  return rows.map((r) => ({
    date: text(r.snapshot_date),
    variants: num(r.variants),
    variantsWithStock: num(r.variants_with_stock),
    units: num(r.units),
    takenAt: r.taken_at ? text(r.taken_at) : null,
  }));
}

export async function captureStockDailySnapshot(date = buenosAiresDate()): Promise<{
  date: string;
  variants: number;
  variantsWithStock: number;
  units: number;
  replaced: boolean;
}> {
  if (!isIsoDate(date)) throw new Error('Fecha inválida');
  await addStockDailySnapshots();

  const variants = await query(VARIANT_SELECT);
  const existing = await query(
    `SELECT COUNT(*) AS n FROM stock_daily_snapshots WHERE snapshot_date = ?`,
    [date]
  );
  const replaced = num(existing[0]?.n) > 0;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM stock_daily_snapshots WHERE snapshot_date = ?`, [date]);

    const chunkSize = 250;
    for (let i = 0; i < variants.length; i += chunkSize) {
      const chunk = variants.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?)').join(',');
      const params: unknown[] = [];
      for (const row of chunk) {
        params.push(
          date,
          row.variant_id,
          text(row.sku) || null,
          text(row.product_sku) || null,
          text(row.product_name) || null,
          text(row.color_name) || null,
          text(row.size_code) || null,
          Math.trunc(num(row.stock))
        );
      }
      await conn.query(
        `INSERT INTO stock_daily_snapshots
           (snapshot_date, variant_id, sku, product_sku, product_name, color_name, size_code, stock)
         VALUES ${placeholders}`,
        params
      );
    }

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  let units = 0;
  let variantsWithStock = 0;
  for (const row of variants) {
    const stock = Math.trunc(num(row.stock));
    units += stock;
    if (stock > 0) variantsWithStock += 1;
  }

  return {
    date,
    variants: variants.length,
    variantsWithStock,
    units,
    replaced,
  };
}

function snapshotSql(): string {
  return `
    SELECT variant_id, sku, product_sku, product_name, color_name, size_code, stock
    FROM stock_daily_snapshots
    WHERE snapshot_date = ?
  `;
}

function mapDiff(row: any): StockSnapshotDiffRow {
  const fromStock = num(row.from_stock);
  const toStock = num(row.to_stock);
  return {
    sku: text(row.sku),
    productSku: text(row.product_sku),
    productName: text(row.product_name),
    color: text(row.color_name),
    size: text(row.size_code),
    fromStock,
    toStock,
    delta: toStock - fromStock,
  };
}

export async function compareStockSnapshots(args: {
  from: string;
  to: string;
  limit?: number;
}): Promise<StockSnapshotCompare> {
  const from = args.from;
  const to = args.to || 'live';
  if (!isIsoDate(from)) throw new Error('Fecha de la foto inválida');
  if (to !== 'live' && !isIsoDate(to)) throw new Error('Fecha a comparar inválida');
  if (to !== 'live' && to === from) throw new Error('Elegí dos fechas distintas');

  await addStockDailySnapshots();

  const fromExists = await query(
    `SELECT COUNT(*) AS n FROM stock_daily_snapshots WHERE snapshot_date = ?`,
    [from]
  );
  if (num(fromExists[0]?.n) === 0) throw new Error(`No hay foto de stock del ${from}`);

  if (to !== 'live') {
    const toExists = await query(
      `SELECT COUNT(*) AS n FROM stock_daily_snapshots WHERE snapshot_date = ?`,
      [to]
    );
    if (num(toExists[0]?.n) === 0) throw new Error(`No hay foto de stock del ${to}`);
  }

  const fromSql = snapshotSql();
  const toSql = to === 'live' ? VARIANT_SELECT : snapshotSql();
  // Orden de los ? en el SQL: foto base, foto destino, foto destino (UNION), foto base.
  const params: string[] = [from];
  if (to !== 'live') params.push(to, to);
  params.push(from);

  const limit = Math.min(20000, Math.max(1, args.limit ?? DIFF_LIMIT));
  const rows = await query(
    `SELECT sku, product_sku, product_name, color_name, size_code, from_stock, to_stock, delta
     FROM (
       SELECT
         COALESCE(t.sku, f.sku) AS sku,
         COALESCE(t.product_sku, f.product_sku) AS product_sku,
         COALESCE(t.product_name, f.product_name) AS product_name,
         COALESCE(t.color_name, f.color_name) AS color_name,
         COALESCE(t.size_code, f.size_code) AS size_code,
         COALESCE(f.stock, 0) AS from_stock,
         COALESCE(t.stock, 0) AS to_stock,
         COALESCE(t.stock, 0) - COALESCE(f.stock, 0) AS delta
       FROM (${fromSql}) f
       LEFT JOIN (${toSql}) t ON t.variant_id = f.variant_id
       UNION ALL
       SELECT
         t.sku,
         t.product_sku,
         t.product_name,
         t.color_name,
         t.size_code,
         0 AS from_stock,
         t.stock AS to_stock,
         t.stock AS delta
       FROM (${toSql}) t
       LEFT JOIN (${fromSql}) f ON f.variant_id = t.variant_id
       WHERE f.variant_id IS NULL
     ) cmp
     WHERE from_stock <> to_stock
     ORDER BY delta ASC, product_name, color_name, size_code
     LIMIT ${limit + 1}`,
    params
  );

  const truncated = rows.length > limit;
  const mapped = rows.slice(0, limit).map(mapDiff);
  let unitsDown = 0;
  let unitsUp = 0;
  let variantsDown = 0;
  let variantsUp = 0;
  for (const row of mapped) {
    if (row.delta < 0) {
      variantsDown += 1;
      unitsDown += Math.abs(row.delta);
    } else if (row.delta > 0) {
      variantsUp += 1;
      unitsUp += row.delta;
    }
  }

  return {
    from,
    to,
    toLabel: to === 'live' ? 'Stock de ahora' : to,
    truncated,
    summary: { variantsDown, unitsDown, variantsUp, unitsUp },
    rows: mapped,
  };
}
