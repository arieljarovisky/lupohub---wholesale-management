import { Request, Response } from 'express';
import multer from 'multer';
import axios from 'axios';
import {
  getTiendaNubeProductImages,
  previewTiendaNubeImageMatches,
  saveTiendaNubeProductImages,
  type ImageSaveItem,
  type UploadedImageFile,
} from '../services/tiendanubeProductImages.service';

const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
]);

export const uploadTnProductImagesMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 15 },
  fileFilter: (_req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    if (!ALLOWED_MIMES.has(mime) && !/\.(jpe?g|png|gif|webp)$/i.test(file.originalname || '')) {
      cb(new Error('Solo se permiten imágenes JPG, PNG, GIF o WebP'));
      return;
    }
    cb(null, true);
  },
}).array('files', 15);

function errorMessage(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const data = e.response?.data as any;
    return (
      (data && (data.description || data.message || data.error)) ||
      e.message ||
      'Error de Tienda Nube'
    );
  }
  return e instanceof Error ? e.message : 'Error actualizando imágenes';
}

function statusOf(e: unknown): number {
  if (axios.isAxiosError(e) && e.response?.status) return e.response.status >= 400 ? e.response.status : 502;
  const s = (e as { status?: number })?.status;
  return typeof s === 'number' && s >= 400 ? s : 500;
}

function mapFiles(req: Request): UploadedImageFile[] {
  const raw = ((req as any).files || []) as Express.Multer.File[];
  return raw.map((f) => ({
    buffer: f.buffer,
    filename: f.originalname || 'image.jpg',
    mimetype: f.mimetype || 'image/jpeg',
  }));
}

function parseItems(raw: unknown): ImageSaveItem[] {
  if (raw == null || raw === '') return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((it: any) => {
      const out: ImageSaveItem = {};
      if (it?.id != null && String(it.id).trim() !== '') out.id = Number(it.id);
      if (it?.fileIndex != null && String(it.fileIndex).trim() !== '') out.fileIndex = Number(it.fileIndex);
      return out;
    });
  } catch {
    throw Object.assign(new Error('items inválido: se esperaba un JSON array'), { status: 400 });
  }
}

function truthyFlag(v: unknown): boolean {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

/** GET /integrations/tiendanube/products/:productId/images */
export const getTiendaNubeProductImagesEndpoint = async (req: Request, res: Response) => {
  try {
    const productId = String(req.params.productId || '').trim();
    if (!productId) return res.status(400).json({ message: 'Falta productId' });
    const data = await getTiendaNubeProductImages(productId);
    res.json(data);
  } catch (e: unknown) {
    const msg = errorMessage(e);
    console.error('[getTiendaNubeProductImages]', msg);
    res.status(statusOf(e)).json({ message: msg });
  }
};

/** POST /integrations/tiendanube/products/:productId/images */
export const saveTiendaNubeProductImagesEndpoint = async (req: Request, res: Response) => {
  try {
    const productId = String(req.params.productId || '').trim();
    if (!productId) return res.status(400).json({ message: 'Falta productId' });
    const files = mapFiles(req);
    let items = parseItems((req.body as any)?.items);
    if (items.length === 0 && files.length > 0) {
      items = files.map((_, fileIndex) => ({ fileIndex }));
    }
    const keepExisting = truthyFlag((req.body as any)?.keepExisting);
    const data = await saveTiendaNubeProductImages(productId, { items, files, keepExisting });
    res.json({
      ...data,
      message: 'Imágenes actualizadas en Tienda Nube',
    });
  } catch (e: unknown) {
    const msg = errorMessage(e);
    console.error('[saveTiendaNubeProductImages]', msg);
    res.status(statusOf(e)).json({ message: msg });
  }
};

/** POST /integrations/tiendanube/products/images/match-preview */
export const previewTiendaNubeImageMatchesEndpoint = async (req: Request, res: Response) => {
  try {
    const paths = Array.isArray(req.body?.paths)
      ? req.body.paths.map((p: unknown) => String(p || '').trim()).filter(Boolean)
      : [];
    if (paths.length === 0) {
      return res.status(400).json({ message: 'Enviá paths: lista de nombres o rutas de archivo' });
    }
    const productIds = Array.isArray(req.body?.productIds)
      ? req.body.productIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : undefined;
    const result = await previewTiendaNubeImageMatches({ paths, productIds });
    res.json(result);
  } catch (e: unknown) {
    const msg = errorMessage(e);
    console.error('[previewTiendaNubeImageMatches]', msg);
    res.status(statusOf(e)).json({ message: msg });
  }
};
