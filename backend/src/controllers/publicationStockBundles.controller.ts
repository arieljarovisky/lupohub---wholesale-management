import { Request, Response } from 'express';
import {
  createPublicationBundle,
  deletePublicationBundle,
  findBundlesByProduct,
  listPublicationBundles,
  listPublicationBundleGroups,
  loadBundleById,
  savePublicationBundleGroup,
  syncAllBundlesForProduct,
  updatePublicationBundle,
  syncBundleListingStock,
  type PublicationBundlePlatform
} from '../services/publicationStockBundle.service';
import { normalizeMercadoLibreItemId } from './integrations.controller';
import {
  createPackListingAndBundle,
  fetchListingPackVariations,
  fetchPublicationSourcePreview
} from '../services/packListingCreate.service';

export const listBundles = async (req: Request, res: Response) => {
  try {
    if (req.query.grouped === '1' || req.query.grouped === 'true') {
      const groups = await listPublicationBundleGroups();
      return res.json(groups);
    }
    const rows = await listPublicationBundles();
    res.json(rows);
  } catch (e: any) {
    console.error('listBundles:', e);
    const msg = String(e?.message || '');
    if (msg.includes("doesn't exist") || e?.code === 'ER_NO_SUCH_TABLE') {
      return res.json([]);
    }
    res.status(500).json({ message: 'Error listando packs de publicación', detail: msg });
  }
};

export const getSourcePreview = async (req: Request, res: Response) => {
  try {
    const platform = req.query.platform as PublicationBundlePlatform;
    const sourceId = String(req.query.sourceId || req.query.source_id || '').trim();
    if (!platform || (platform !== 'mercadolibre' && platform !== 'tiendanube')) {
      return res.status(400).json({ message: 'platform inválida' });
    }
    if (!sourceId) {
      return res.status(400).json({ message: 'sourceId es requerido' });
    }
    const preview = await fetchPublicationSourcePreview(platform, sourceId);
    if (!preview) {
      const mlauHint =
        platform === 'mercadolibre' && /^MLAU\d+$/i.test(normalizeMercadoLibreItemId(sourceId))
          ? ' Verificá que el MLAU sea de tu cuenta ML y tenga publicaciones (activas o pausadas).'
          : '';
      return res.status(404).json({
        message: `Publicación no encontrada en la plataforma.${mlauHint}`
      });
    }
    res.json(preview);
  } catch (e: any) {
    console.error('getSourcePreview:', e);
    res.status(500).json({ message: e?.message || 'Error cargando vista previa' });
  }
};

export const getListingVariations = async (req: Request, res: Response) => {
  try {
    const platform = req.query.platform as PublicationBundlePlatform;
    const listingId = String(req.query.listingId || req.query.listing_id || '').trim();
    if (!platform || (platform !== 'mercadolibre' && platform !== 'tiendanube')) {
      return res.status(400).json({ message: 'platform inválida' });
    }
    if (!listingId) {
      return res.status(400).json({ message: 'listingId es requerido' });
    }
    const result = await fetchListingPackVariations(platform, listingId);
    if (!result) {
      const mlauHint =
        platform === 'mercadolibre' && /^MLAU\d+$/i.test(normalizeMercadoLibreItemId(listingId))
          ? ' Verificá que el MLAU sea de tu cuenta ML.'
          : '';
      return res.status(404).json({
        message: `Publicación no encontrada en la plataforma.${mlauHint}`
      });
    }
    res.json(result);
  } catch (e: any) {
    console.error('getListingVariations:', e);
    res.status(500).json({ message: e?.message || 'Error obteniendo variaciones' });
  }
};

export const getBundlesByProduct = async (req: Request, res: Response) => {
  try {
    const platform = req.query.platform as PublicationBundlePlatform;
    const externalProductId = String(req.query.externalProductId || '').trim();
    if (!platform || (platform !== 'mercadolibre' && platform !== 'tiendanube')) {
      return res.status(400).json({ message: 'platform inválida' });
    }
    if (!externalProductId) {
      return res.status(400).json({ message: 'externalProductId es requerido' });
    }
    const variants = await findBundlesByProduct(platform, externalProductId);
    res.json({ platform, externalProductId, variants });
  } catch (e: any) {
    console.error('getBundlesByProduct:', e);
    res.status(500).json({ message: 'Error obteniendo variantes del pack' });
  }
};

export const saveBundleGroup = async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      platform?: PublicationBundlePlatform;
      externalProductId?: string;
      listingLabel?: string | null;
      variants?: Array<{
        id?: string;
        label?: string | null;
        externalVariantId?: string;
        items?: Array<{ variantId: string; unitsPerSale?: number }>;
      }>;
    };
    if (!body.platform || (body.platform !== 'mercadolibre' && body.platform !== 'tiendanube')) {
      return res.status(400).json({ message: 'platform debe ser mercadolibre o tiendanube' });
    }
    if (!body.externalProductId?.trim()) {
      return res.status(400).json({ message: 'externalProductId es requerido' });
    }
    if (!Array.isArray(body.variants) || body.variants.length === 0) {
      return res.status(400).json({ message: 'variants debe tener al menos una combinación de colores' });
    }
    const group = await savePublicationBundleGroup({
      platform: body.platform,
      externalProductId: body.externalProductId,
      listingLabel: body.listingLabel,
      variants: body.variants.map((v) => ({
        id: v.id,
        label: v.label,
        externalVariantId: v.externalVariantId,
        items: v.items || []
      }))
    });
    res.json(group);
  } catch (e: any) {
    console.error('saveBundleGroup:', e);
    res.status(500).json({ message: e?.message || 'Error guardando grupo de packs' });
  }
};

export const syncListingBundlesStock = async (req: Request, res: Response) => {
  try {
    const body = req.body as { platform?: PublicationBundlePlatform; externalProductId?: string };
    if (!body.platform || !body.externalProductId?.trim()) {
      return res.status(400).json({ message: 'platform y externalProductId son requeridos' });
    }
    await syncAllBundlesForProduct(body.platform, body.externalProductId);
    const variants = await findBundlesByProduct(body.platform, body.externalProductId);
    res.json({ platform: body.platform, externalProductId: body.externalProductId, variants });
  } catch (e: any) {
    console.error('syncListingBundlesStock:', e);
    res.status(500).json({ message: 'Error sincronizando stock de variantes' });
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
      variants?: Array<{
        label?: string;
        items?: Array<{ variantId: string; unitsPerSale?: number }>;
      }>;
      publicationContent?: {
        title?: string;
        description?: string;
        price?: number;
        pictures?: Array<{ url?: string; pictureId?: string; selected?: boolean }>;
      };
    };
    if (!body.platform || (body.platform !== 'mercadolibre' && body.platform !== 'tiendanube')) {
      return res.status(400).json({ message: 'platform debe ser mercadolibre o tiendanube' });
    }
    if (!body.sourceExternalProductId?.trim()) {
      return res.status(400).json({ message: 'sourceExternalProductId es requerido (publicación individual)' });
    }
    const hasVariants = Array.isArray(body.variants) && body.variants.length > 0;
    const hasItems = Array.isArray(body.items) && body.items.length > 0;
    if (!hasVariants && !hasItems) {
      return res.status(400).json({ message: 'Indicá al menos una combinación de colores (variants o items)' });
    }
    const result = await createPackListingAndBundle({
      platform: body.platform,
      sourceExternalProductId: body.sourceExternalProductId,
      titleSuffix: body.titleSuffix,
      skuSuffix: body.skuSuffix,
      label: body.label,
      published: body.published,
      items: body.items,
      variants: body.variants?.map((v) => ({
        label: v.label,
        items: v.items ?? []
      })),
      publicationContent: body.publicationContent
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
