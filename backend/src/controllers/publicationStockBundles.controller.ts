import { Request, Response } from 'express';
import {
  createPublicationBundle,
  deletePublicationBundle,
  listPublicationBundles,
  loadBundleById,
  updatePublicationBundle,
  syncBundleListingStock,
  type PublicationBundlePlatform
} from '../services/publicationStockBundle.service';
import { createPackListingAndBundle } from '../services/packListingCreate.service';

export const listBundles = async (_req: Request, res: Response) => {
  try {
    const rows = await listPublicationBundles();
    res.json(rows);
  } catch (e: any) {
    console.error('listBundles:', e);
    res.status(500).json({ message: 'Error listando packs de publicación' });
  }
};

export const getBundle = async (req: Request, res: Response) => {
  try {
    const bundle = await loadBundleById(String(req.params.id || ''));
    if (!bundle) return res.status(404).json({ message: 'Pack no encontrado' });
    res.json(bundle);
  } catch (e: any) {
    console.error('getBundle:', e);
    res.status(500).json({ message: 'Error obteniendo pack' });
  }
};

export const createBundle = async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      platform?: PublicationBundlePlatform;
      externalProductId?: string;
      externalVariantId?: string;
      label?: string;
      items?: Array<{ variantId: string; unitsPerSale?: number }>;
    };
    if (!body.platform || (body.platform !== 'mercadolibre' && body.platform !== 'tiendanube')) {
      return res.status(400).json({ message: 'platform debe ser mercadolibre o tiendanube' });
    }
    if (!body.externalProductId?.trim()) {
      return res.status(400).json({ message: 'externalProductId es requerido (ID publicación ML o producto TN)' });
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return res.status(400).json({ message: 'items debe tener al menos una variante' });
    }
    const bundle = await createPublicationBundle({
      platform: body.platform,
      externalProductId: body.externalProductId,
      externalVariantId: body.externalVariantId,
      label: body.label,
      items: body.items
    });
    res.status(201).json(bundle);
  } catch (e: any) {
    if (e?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Ya existe un pack para esa publicación' });
    }
    console.error('createBundle:', e);
    res.status(500).json({ message: 'Error creando pack de publicación' });
  }
};

export const updateBundle = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '');
    const body = req.body as {
      label?: string | null;
      externalProductId?: string;
      externalVariantId?: string;
      items?: Array<{ variantId: string; unitsPerSale?: number }>;
    };
    const bundle = await updatePublicationBundle(id, body);
    if (!bundle) return res.status(404).json({ message: 'Pack no encontrado' });
    res.json(bundle);
  } catch (e: any) {
    console.error('updateBundle:', e);
    res.status(500).json({ message: 'Error actualizando pack' });
  }
};

export const removeBundle = async (req: Request, res: Response) => {
  try {
    const ok = await deletePublicationBundle(String(req.params.id || ''));
    if (!ok) return res.status(404).json({ message: 'Pack no encontrado' });
    res.json({ deleted: true });
  } catch (e: any) {
    console.error('removeBundle:', e);
    res.status(500).json({ message: 'Error eliminando pack' });
  }
};

export const createListingFromSource = async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      platform?: PublicationBundlePlatform;
      sourceExternalProductId?: string;
      titleSuffix?: string;
      skuSuffix?: string;
      label?: string;
      published?: boolean;
      items?: Array<{ variantId: string; unitsPerSale?: number }>;
    };
    if (!body.platform || (body.platform !== 'mercadolibre' && body.platform !== 'tiendanube')) {
      return res.status(400).json({ message: 'platform debe ser mercadolibre o tiendanube' });
    }
    if (!body.sourceExternalProductId?.trim()) {
      return res.status(400).json({ message: 'sourceExternalProductId es requerido (publicación individual)' });
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return res.status(400).json({ message: 'items debe tener al menos una variante del pack' });
    }
    const result = await createPackListingAndBundle({
      platform: body.platform,
      sourceExternalProductId: body.sourceExternalProductId,
      titleSuffix: body.titleSuffix,
      skuSuffix: body.skuSuffix,
      label: body.label,
      published: body.published,
      items: body.items
    });
    res.status(201).json(result);
  } catch (e: any) {
    if (e?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Ya existe un pack para esa publicación' });
    }
    console.error('createListingFromSource:', e);
    res.status(500).json({ message: e?.message || 'Error creando publicación pack' });
  }
};

export const syncBundleStock = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '');
    const bundle = await loadBundleById(id);
    if (!bundle) return res.status(404).json({ message: 'Pack no encontrado' });
    await syncBundleListingStock(id);
    const updated = await loadBundleById(id);
    res.json(updated);
  } catch (e: any) {
    console.error('syncBundleStock:', e);
    res.status(500).json({ message: 'Error sincronizando stock del pack' });
  }
};
