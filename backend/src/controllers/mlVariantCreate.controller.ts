import { Request, Response } from 'express';
import {
  createMlVariantsFromLocal,
  MlVariantCreateError,
  previewMlVariantsFromLocal
} from '../services/mlVariantCreate.service';

function fail(res: Response, e: any) {
  const status = e instanceof MlVariantCreateError ? e.statusCode : 500;
  if (status >= 500) console.error('mlVariantCreate:', e);
  res.status(status).json({ message: e?.message || 'Error creando variantes en Mercado Libre' });
}

export const previewMercadoLibreVariants = async (req: Request, res: Response) => {
  try {
    const productId = String(req.query.productId || '').trim();
    const anchorItemId = String(req.query.anchorItemId || req.query.anchor || '').trim();
    if (!productId) return res.status(400).json({ message: 'productId es requerido' });
    const preview = await previewMlVariantsFromLocal(productId, anchorItemId || undefined);
    res.json(preview);
  } catch (e: any) {
    fail(res, e);
  }
};

export const createMercadoLibreVariants = async (req: Request, res: Response) => {
  try {
    const productId = String(req.body?.productId || '').trim();
    const anchorItemId = String(req.body?.anchorItemId || '').trim();
    const variantIds = Array.isArray(req.body?.variantIds) ? req.body.variantIds.map((id: unknown) => String(id)) : [];
    if (!productId) return res.status(400).json({ message: 'productId es requerido' });
    const result = await createMlVariantsFromLocal(productId, variantIds, anchorItemId || undefined);
    res.json(result);
  } catch (e: any) {
    fail(res, e);
  }
};
