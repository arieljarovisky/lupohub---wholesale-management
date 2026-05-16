import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import archiver from 'archiver';
import {
  downloadCategoryImages,
  fetchAllTnCategories,
  getTiendaNubeIntegration,
  resolveCategoryIds,
} from '../services/tiendanubeCategoryImages.service';

/** GET ?category=ropa%20deportiva — lista categorías que coinciden (sin descargar). */
export const listTiendaNubeCategoryMatches = async (req: Request, res: Response) => {
  try {
    const query = String(req.query.category || 'ropa deportiva').trim();
    const { accessToken, storeId } = await getTiendaNubeIntegration();
    const all = await fetchAllTnCategories(storeId, accessToken);
    const { ids, names } = resolveCategoryIds(all, query);
    const matches = all
      .filter((c) => ids.includes(c.id))
      .map((c) => ({
        id: c.id,
        name:
          c.name && typeof c.name === 'object'
            ? c.name.es || c.name.en || Object.values(c.name)[0]
            : c.name,
        parent: c.parent,
      }));
    res.json({ query, categoryIds: ids, categoryNames: names, matches });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ message: msg });
  }
};

/** GET ?category=ropa%20deportiva — descarga imágenes y devuelve ZIP. */
export const downloadTiendaNubeCategoryImagesZip = async (req: Request, res: Response) => {
  const tmpDir = path.join(os.tmpdir(), `lupohub-tn-images-${Date.now()}`);
  try {
    const categoryQuery = String(req.query.category || 'ropa deportiva').trim();
    const categoryIdRaw = req.query.categoryId || req.query.category_id;
    const categoryId = categoryIdRaw ? parseInt(String(categoryIdRaw), 10) : undefined;

    const result = await downloadCategoryImages({
      categoryQuery,
      categoryId: Number.isFinite(categoryId) ? categoryId : undefined,
      outputDir: tmpDir,
      includeSubcategories: true,
    });

    if (result.imageCount === 0) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return res.status(404).json({
        message: 'No hay imágenes en los productos de esa categoría',
        ...result,
      });
    }

    const slug = categoryQuery
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
    const filename = `tiendanube-${slug || 'categoria'}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Download-Stats', JSON.stringify({
      products: result.productCount,
      images: result.imageCount,
      downloaded: result.downloaded,
    }));

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => {
      throw err;
    });
    archive.pipe(res);
    archive.directory(tmpDir, false);
    await archive.finalize();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[downloadTiendaNubeCategoryImagesZip]', msg);
    if (!res.headersSent) {
      res.status(500).json({ message: msg });
    }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
};
