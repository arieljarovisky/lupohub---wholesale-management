import { Request, Response } from 'express';
import {
  previewTiendaNubeMercadoLibrePublish,
  publishTiendaNubeProductToMercadoLibre,
  TnToMlPublishError
} from '../services/tnToMercadoLibrePublish.service';

function fail(res: Response, error: any, fallback: string) {
  const status = error instanceof TnToMlPublishError ? error.statusCode : 500;
  const message = error?.message || fallback;
  if (status >= 500) console.error('[TN→ML]', message);
  return res.status(status).json({ message });
}

/** GET — título, variantes, fotos y publicaciones ML parecidas para usar de modelo. */
export const previewTiendaNubeToMercadoLibre = async (req: Request, res: Response) => {
  try {
    const data = await previewTiendaNubeMercadoLibrePublish(String(req.params.productId || ''));
    return res.json(data);
  } catch (error: any) {
    return fail(res, error, 'No se pudo preparar la publicación');
  }
};

/** POST { sourceItemId, title?, price?, paused?, linkLocal? } — crea la publicación en Mercado Libre. */
export const publishTiendaNubeToMercadoLibre = async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const price = body.price != null && body.price !== '' ? Number(body.price) : undefined;
    const data = await publishTiendaNubeProductToMercadoLibre(String(req.params.productId || ''), {
      sourceItemId: String(body.sourceItemId || ''),
      title: body.title != null ? String(body.title) : undefined,
      price: Number.isFinite(price) ? price : undefined,
      paused: body.paused !== false,
      linkLocal: body.linkLocal !== false
    });
    const status = data.failed ? 207 : 201;
    return res.status(status).json(data);
  } catch (error: any) {
    return fail(res, error, 'No se pudo publicar en Mercado Libre');
  }
};
