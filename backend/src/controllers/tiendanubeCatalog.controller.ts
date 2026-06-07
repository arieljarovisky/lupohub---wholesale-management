import { Request, Response } from 'express';
import { buildTiendaNubeCatalog } from '../services/tiendanubeCatalog.service';

/**
 * GET /integrations/tiendanube/catalog
 * Devuelve el catálogo completo de Tienda Nube agrupado por sección (categoría),
 * con imágenes, talles, colores, descripción y precio de cada producto.
 * Query opcional: ?categoryIds=1,2,3 para limitar a ciertas secciones.
 */
export const getTiendaNubeCatalog = async (req: Request, res: Response) => {
  try {
    const raw = String(req.query.categoryIds || '').trim();
    const categoryIds = raw
      ? raw
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => Number.isFinite(n))
      : undefined;

    const priceListId = String(req.query.priceListId || req.query.price_list_id || '').trim() || undefined;

    const catalog = await buildTiendaNubeCatalog({ categoryIds, priceListId });
    res.json(catalog);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[getTiendaNubeCatalog]', msg);
    res.status(500).json({ message: msg });
  }
};
