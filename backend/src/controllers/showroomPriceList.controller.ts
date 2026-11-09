import { Request, Response } from 'express';
import { buildShowroomPriceList } from '../services/showroomPriceList.service';

/**
 * GET /integrations/tiendanube/showroom-prices
 * Lista de precios de Tienda Nube agrupada por artículo, con precio de transferencia
 * y precio con tarjeta en 1 pago. ?refresh=1 ignora la caché de unos minutos.
 */
export const getShowroomPriceList = async (req: Request, res: Response) => {
  try {
    const refresh = String(req.query.refresh || '').trim() === '1' || req.query.refresh === 'true';
    const list = await buildShowroomPriceList({ refresh });
    res.json(list);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[getShowroomPriceList]', msg);
    res.status(500).json({ message: msg });
  }
};
