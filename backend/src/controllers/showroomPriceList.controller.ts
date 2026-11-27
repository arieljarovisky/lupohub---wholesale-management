import { Request, Response } from 'express';
import { buildShowroomPriceList, lookupShowroomPriceByCode } from '../services/showroomPriceList.service';

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

/**
 * GET /integrations/tiendanube/showroom-prices/lookup/:code
 * Busca un producto por código de barras, SKU o código de artículo en Tienda Nube.
 * Devuelve el precio publicado con descuentos de transferencia/tarjeta.
 */
export const lookupShowroomPrice = async (req: Request, res: Response) => {
  const code = String(req.params.code || '').trim();
  if (!code) {
    return res.status(400).json({ message: 'Código requerido' });
  }
  try {
    const item = await lookupShowroomPriceByCode(code);
    if (!item) {
      return res.status(404).json({ message: 'No hay un producto publicado con ese código en Tienda Nube.' });
    }
    res.json(item);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[lookupShowroomPrice]', msg);
    res.status(500).json({ message: msg });
  }
};
