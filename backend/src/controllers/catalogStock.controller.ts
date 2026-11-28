import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { query } from '../database/db';

/**
 * Stock de solo lectura para el catálogo mayorista (catalogo.lupo.ar).
 * Servidor a servidor: requiere el header `x-api-key` igual a CATALOG_STOCK_API_KEY.
 * Sin esa variable configurada, el endpoint responde 503 (apagado).
 */
function safeEqual(a: string, b: string): boolean {
  const left = crypto.createHash('sha256').update(a).digest();
  const right = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(left, right);
}

export const catalogStockAuth = (req: Request, res: Response, next: NextFunction) => {
  const expected = String(process.env.CATALOG_STOCK_API_KEY || '').trim();
  if (!expected) return res.status(503).json({ message: 'Stock para catálogo no configurado' });
  const given = String(req.headers['x-api-key'] || '').trim();
  if (!given || !safeEqual(given, expected)) return res.status(401).json({ message: 'No autorizado' });
  next();
};

/**
 * GET /api/catalog-stock[?skus=17800-01,523-02]
 * Devuelve una fila por variante: código del artículo, color, talle y stock.
 */
export const getCatalogStock = async (req: Request, res: Response) => {
  try {
    const raw = String(req.query.skus || '').trim();
    const skus = raw
      ? raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 2000)
      : [];
    const where = skus.length ? `WHERE p.sku IN (${skus.map(() => '?').join(',')})` : '';
    const rows = await query(
      `
      SELECT p.sku AS product_sku, pv.sku AS variant_sku,
             c.code AS color_code, c.name AS color_name,
             s.size_code AS size_code, s.name AS size_name,
             COALESCE(st.stock, 0) AS stock
      FROM products p
      JOIN product_colors pc ON pc.product_id = p.id
      JOIN product_variants pv ON pv.product_color_id = pc.id
      LEFT JOIN colors c ON c.id = pc.color_id
      LEFT JOIN sizes s ON s.id = pv.size_id
      LEFT JOIN stocks st ON st.variant_id = pv.id
      ${where}
      `,
      skus
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      updatedAt: new Date().toISOString(),
      items: (rows || []).map((r: any) => ({
        sku: r.product_sku,
        variantSku: r.variant_sku ?? null,
        colorCode: r.color_code ?? null,
        colorName: r.color_name ?? null,
        size: r.size_code ?? r.size_name ?? null,
        stock: Math.max(0, Number(r.stock) || 0),
      })),
    });
  } catch (err: any) {
    console.error('getCatalogStock', err);
    res.status(500).json({ message: 'No se pudo leer el stock' });
  }
};
