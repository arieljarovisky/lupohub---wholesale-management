import { Request, Response } from 'express';
import axios from 'axios';
import { query, execute, get } from '../database/db';
import { Product } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { nombreTalleDesdeCodigo, codigoTalleParaSku } from '../talles-tango';
import { normalizeColorCodeForImportValue } from '../utils/colorCodeCanonical';
import { syncStockToExternalPlatforms, updateMercadoLibreSku, updateTiendaNubeSku } from './stock.controller';
import { skuToCanonicalString } from '../utils/skuString';
import { runMergeDuplicateProductsBySku, nameEmbedsOwnSkuCode, mergeManualIntoKeeper, mergeManualVariantPair } from '../services/mergeDuplicateProductsBySku';
import { touchProductUpdatedAtByVariantId } from '../utils/touchProductUpdatedAt';

export const getProducts = async (req: Request, res: Response) => {
  try {
    const { page = '1', per_page = '20', q = '', sort = 'sku', dir = 'asc', sync_ml, sync_tn, sync_none, skip_total, price_list_id } = req.query as any;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const perPageNum = Math.min(5000, Math.max(1, parseInt(per_page as string, 10) || 20));
    const offset = (pageNum - 1) * perPageNum;
    const sortKey = String(sort || 'sku').toLowerCase();
    const sortCol =
      sortKey === 'stock' ? 'stock_total' :
      sortKey === 'name' ? 'p.name' :
      sortKey === 'created_at' || sortKey === 'created' ? 'p.created_at' :
      sortKey === 'updated_at' || sortKey === 'updated' ? 'p.updated_at' :
      'pv.sku';
    const sortDir = (dir === 'desc' ? 'DESC' : 'ASC');
    const search = (q || '').toString().trim();
    const filterSyncMl = sync_ml === '1' || sync_ml === 'true';
    const filterSyncTn = sync_tn === '1' || sync_tn === 'true';
    const filterSyncNone = sync_none === '1' || sync_none === 'true';
    const skipTotal = skip_total === '1' || skip_total === 'true';
    const priceListId = (price_list_id && String(price_list_id).trim()) || null;

    const conditions: string[] = ['1=1'];
    const params: any[] = [];
    if (search) {
      conditions.push('(pv.sku LIKE ? OR p.sku LIKE ? OR p.name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (filterSyncNone) {
      conditions.push('(p.mercado_libre_id IS NULL OR p.mercado_libre_id = \'\') AND (p.tienda_nube_id IS NULL OR p.tienda_nube_id = \'\')');
    } else {
      if (filterSyncMl) {
        conditions.push('p.mercado_libre_id IS NOT NULL AND p.mercado_libre_id != \'\'');
      }
      if (filterSyncTn) {
        conditions.push('p.tienda_nube_id IS NOT NULL AND p.tienda_nube_id != \'\'');
      }
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const priceJoin = priceListId
      ? `LEFT JOIN price_list_items pli ON pli.price_list_id = ? AND pli.product_id = p.id`
      : '';
    const priceSelect = priceListId
      ? `COALESCE(pli.price, p.base_price) AS base_price`
      : `p.base_price`;
    const priceParams = priceListId ? [priceListId] : [];

    let total = 0;
    if (!skipTotal) {
      const totalRow = await get(
        `
      SELECT COUNT(*) AS total
      FROM products p
      JOIN product_colors pc ON pc.product_id = p.id
      JOIN product_variants pv ON pv.product_color_id = pc.id
      ${priceJoin}
      ${whereClause}
      `,
        [...priceParams, ...params]
      );
      total = Number(totalRow?.total || 0);
    }

    const rows = await query(
      `
      SELECT pv.id, pv.sku, p.name, p.category, ${priceSelect},
             p.id AS product_id, p.sku AS base_sku,
             p.created_at AS product_created_at, p.updated_at AS product_updated_at,
             p.tienda_nube_id, p.mercado_libre_id,
             COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS mayorista_pack_size,
             pv.tienda_nube_variant_id, pv.mercado_libre_variant_id, pv.mercado_libre_item_id,
             COALESCE(st.stock, 0) AS stock_total,
             c.name AS color_name, s.size_code AS size_code, s.name AS size_name
      FROM products p
      JOIN product_colors pc ON pc.product_id = p.id
      JOIN product_variants pv ON pv.product_color_id = pc.id
      LEFT JOIN colors c ON c.id = pc.color_id
      LEFT JOIN sizes s ON s.id = pv.size_id
      LEFT JOIN stocks st ON st.variant_id = pv.id
      ${priceJoin}
      ${whereClause}
      ORDER BY ${sortCol} ${sortDir}, pv.sku ASC
      LIMIT ? OFFSET ?
      `,
      [...priceParams, ...params, perPageNum, offset]
    );

    const mapped = (rows || []).map((r: any) => ({
      id: r.id,
      sku: r.sku,
      base_sku: r.base_sku,
      product_id: r.product_id,
      product_created_at: r.product_created_at ?? null,
      product_updated_at: r.product_updated_at ?? null,
      name: r.name,
      category: r.category,
      base_price: Number(r.base_price ?? 0),
      stock_total: Number(r.stock_total ?? 0),
      mayorista_pack_size: Math.max(1, Number(r.mayorista_pack_size) || 1),
      color_name: r.color_name ?? null,
      size_code: r.size_code ?? null,
      size_name: r.size_name ?? null,
      externalIds: {
        tiendaNube: r.tienda_nube_id,
        mercadoLibre: r.mercado_libre_id,
        tiendaNubeVariant: r.tienda_nube_variant_id,
        mercadoLibreVariant: r.mercado_libre_variant_id,
        mercadoLibreItemId: r.mercado_libre_item_id
      }
    }));

    res.json({ items: mapped, page: pageNum, per_page: perPageNum, total });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching products" });
  }
};

export const createProduct = async (req: any, res: any) => {
  const body = req.body || {};
  const sku = body.sku != null ? String(body.sku).trim() : '';
  const name = body.name != null ? String(body.name).trim() : '';

  console.log('[createProduct] body.sku=', body.sku, 'body.name=', body.name, '-> parsed sku=', sku, 'name=', name);

  if (!sku || !name) {
    console.log('[createProduct] Rechazado: SKU o nombre vacío');
    return res.status(400).json({ message: "SKU y Nombre son requeridos" });
  }

  const category = body.category != null ? String(body.category) : null;
  const basePrice = body.base_price != null ? Number(body.base_price) : (body.price != null ? Number(body.price) : 0);
  const description = body.description != null ? String(body.description) : null;
  const initialStock = body.stock != null ? Math.max(0, parseInt(String(body.stock), 10) || 0) : (body.stock_total != null ? Math.max(0, parseInt(String(body.stock_total), 10) || 0) : 0);

  const parts = sku.split('-');
  const isVariantSkuWithDashes = parts.length >= 3;
  let baseSku = sku;
  let sizeCode: string | null = null;
  let colorCode: string | null = null;

  if (body.base_sku != null && String(body.base_sku).trim() !== '') {
    baseSku = String(body.base_sku).trim();
    const sz = body.sizeCode ?? body.size;
    const cl = body.colorCode ?? body.color;
    if (sz != null && cl != null) {
      sizeCode = String(sz).trim();
      colorCode = String(cl).trim();
    }
  }
  if (sizeCode == null || colorCode == null) {
    if (isVariantSkuWithDashes) {
      baseSku = parts.slice(0, -2).join('-');
      sizeCode = parts[parts.length - 2];
      colorCode = parts[parts.length - 1];
    } else if (sku.length >= 12 && !sku.includes('-')) {
      const parsed = parseCodigoTango(sku);
      if (parsed.articulo && parsed.talle && parsed.color) {
        baseSku = parsed.articulo;
        sizeCode = parsed.talle;
        colorCode = parsed.color;
      }
    }
  }

  const isVariantSku = (sizeCode != null && colorCode != null && (baseSku !== sku || (body.base_sku != null && String(body.base_sku).trim() !== '')));

  if (isVariantSku) {
    // Crear como variante: producto padre + product_colors + product_variants + stocks (igual que import Tango)
    try {
      let productId: string | null = (await get(`SELECT id FROM products WHERE sku = ?`, [baseSku]))?.id || null;
      if (!productId) {
        productId = uuidv4();
        try {
          await execute(
            `INSERT INTO products (id, sku, name, category, base_price, description) VALUES (?, ?, ?, ?, ?, ?)`,
            [productId, baseSku, name, category ?? 'General', basePrice, description]
          );
        } catch (insertErr: any) {
          // Varias requests en paralelo pueden intentar crear el mismo producto; si ya existe, usar ese id
          if (insertErr.code === 'ER_DUP_ENTRY' && insertErr.sqlMessage && String(insertErr.sqlMessage).includes("'products.sku'")) {
            const existing = await get(`SELECT id FROM products WHERE sku = ?`, [baseSku]);
            if (existing?.id) {
              productId = existing.id;
            } else {
              throw insertErr;
            }
          } else {
            throw insertErr;
          }
        }
      }

      let sizeId = (await get(`SELECT id FROM sizes WHERE size_code = ?`, [sizeCode]))?.id;
      if (!sizeId) {
        return res.status(400).json({
          message: `No existe el talle con código "${sizeCode}". Creálo en Configuración > Talles.`,
        });
      }

      let colorId = (await get(`SELECT id FROM colors WHERE code = ?`, [colorCode]))?.id;
      if (!colorId) {
        colorId = (await get(`SELECT id FROM colors WHERE name = ?`, [colorCode]))?.id;
      }
      if (!colorId) {
        return res.status(400).json({
          message: `No existe el color con código "${colorCode}". Creálo en Configuración > Colores.`,
        });
      }

      let productColorId = (await get(`SELECT id FROM product_colors WHERE product_id = ? AND color_id = ?`, [productId, colorId]))?.id;
      if (!productColorId) {
        productColorId = uuidv4();
        await execute(`INSERT INTO product_colors (id, product_id, color_id) VALUES (?, ?, ?)`, [productColorId, productId, colorId]);
      }

      const existingVariant = await get(
        `SELECT id, sku FROM product_variants WHERE product_color_id = ? AND size_id = ?`,
        [productColorId, sizeId]
      );
      if (existingVariant) {
        const productRow = await get(`SELECT name, category, base_price, tienda_nube_id, mercado_libre_id FROM products WHERE id = ?`, [productId]);
        const stockRow = await get(`SELECT stock FROM stocks WHERE variant_id = ?`, [existingVariant.id]);
        return res.status(200).json({
          id: existingVariant.id,
          sku: existingVariant.sku ?? sku,
          name: productRow?.name ?? name,
          category: productRow?.category ?? category ?? 'General',
          base_price: Number(productRow?.base_price ?? basePrice),
          description: productRow?.description ?? description ?? undefined,
          stock_total: Number(stockRow?.stock ?? 0),
          externalIds: {
            tiendaNube: productRow?.tienda_nube_id ?? undefined,
            mercadoLibre: productRow?.mercado_libre_id ?? undefined,
          },
          existing: true,
        });
      }

      const variantId = uuidv4();
      await execute(
        `INSERT INTO product_variants (id, product_color_id, size_id, sku) VALUES (?, ?, ?, ?)`,
        [variantId, productColorId, sizeId, sku]
      );
      await execute(`INSERT INTO stocks (variant_id, stock) VALUES (?, ?) ON DUPLICATE KEY UPDATE stock = VALUES(stock)`, [variantId, initialStock]);

      const productRow = await get(`SELECT name, category, base_price, tienda_nube_id, mercado_libre_id FROM products WHERE id = ?`, [productId]);
      console.log('[createProduct] Variante creada:', sku, 'variantId=', variantId);
      return res.status(201).json({
        id: variantId,
        sku,
        name: productRow?.name ?? name,
        category: productRow?.category ?? category ?? 'General',
        base_price: Number(productRow?.base_price ?? basePrice),
        description: productRow?.description ?? description ?? undefined,
        externalIds: {
          tiendaNube: productRow?.tienda_nube_id ?? undefined,
          mercadoLibre: productRow?.mercado_libre_id ?? undefined,
        },
      });
    } catch (error: any) {
      console.error('[createProduct] Error variante:', error?.code, error?.message);
      if (error.code === 'ER_DUP_ENTRY' || (error.message && error.message.includes('Duplicate entry'))) {
        return res.status(409).json({ message: "La variante ya existe." });
      }
      return res.status(500).json({ message: "Error creando variante", detail: error?.message });
    }
  }

  // SKU simple: un solo producto en tabla products (sin variantes)
  const id = uuidv4();
  try {
    await execute(
      `INSERT INTO products (id, sku, name, category, base_price, description) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, sku, name, category, basePrice, description]
    );
    console.log('[createProduct] INSERT OK:', sku);
    res.status(201).json({ id, sku, name, category: category ?? undefined, base_price: basePrice, description: description ?? undefined });
  } catch (error: any) {
    console.error('[createProduct] Error INSERT:', error?.code, error?.message);
    if (error.code === 'ER_DUP_ENTRY' || (error.message && error.message.includes('Duplicate entry'))) {
      return res.status(409).json({ message: "El SKU ya existe" });
    }
    res.status(500).json({ message: "Error creating product", detail: error?.message });
  }
};

export const getVariantIdBySkuColorSize = async (sku: string, colorCode: string, sizeCode: string): Promise<string | null> => {
  const row = await get(
    `SELECT pv.id AS variant_id
     FROM products p
     JOIN product_colors pc ON pc.product_id = p.id
     JOIN colors c ON c.id = pc.color_id
     JOIN product_variants pv ON pv.product_color_id = pc.id
     JOIN sizes s ON s.id = pv.size_id
     WHERE p.sku = ? AND c.code = ? AND s.size_code = ?`,
    [sku, colorCode, sizeCode]
  );
  return row?.variant_id || null;
};

export const getProductStockTotalBySku = async (sku: string): Promise<number> => {
  const row = await get(
    `SELECT COALESCE(SUM(st.stock), 0) AS stock_total
     FROM products p
     LEFT JOIN product_colors pc ON pc.product_id = p.id
     LEFT JOIN product_variants pv ON pv.product_color_id = pc.id
     LEFT JOIN stocks st ON st.variant_id = pv.id
     WHERE p.sku = ?`,
    [sku]
  );
  return Number(row?.stock_total || 0);
};

/** Obtener un producto por ID (para formulario de edición) */
export const getProductById = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ message: 'ID requerido' });
  try {
    const product = await get(
      `SELECT id, sku, name, category, base_price, description,
              COALESCE(mercado_libre_pack_size, 1) AS mercado_libre_pack_size,
              COALESCE(tienda_nube_pack_size, 1) AS tienda_nube_pack_size,
              COALESCE(NULLIF(mayorista_pack_size, 0), 1) AS mayorista_pack_size
       FROM products WHERE id = ?`,
      [id]
    );
    if (!product) return res.status(404).json({ message: 'Producto no encontrado' });
    res.json(product);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error obteniendo producto' });
  }
};

export const getProductBySku = async (req: any, res: Response) => {
  const { sku } = req.params;
  const includeRelatedRaw = req.query?.includeRelated;
  const includeRelated =
    includeRelatedRaw !== '0' &&
    includeRelatedRaw !== 'false' &&
    includeRelatedRaw !== 'no';
  try {
    const { resolveProductByArticleSku, findRelatedProductIdsForArticleSku } = await import('../services/productSkuFamily');
    const product = await resolveProductByArticleSku(String(sku));

    if (!product) return res.status(404).json({ message: 'Producto no encontrado' });

    let productIds = [product.id];
    if (includeRelated) {
      try {
        productIds = await findRelatedProductIdsForArticleSku(String(sku), product.id);
      } catch (relatedErr) {
        console.warn('[getProductBySku] findRelatedProductIds:', (relatedErr as Error)?.message);
      }
    }
    const idPlaceholders = productIds.map(() => '?').join(',');

    // Variantes del producto y de registros duplicados del mismo artículo (ej. 0127501 + 1275-11)
    const variantsRows = await query(
      `SELECT p.id AS product_id, p.sku, pv.sku AS variant_sku, pv.external_sku,
              c.code AS color_code, c.name AS color_name,
              s.size_code, COALESCE(st.stock,0) AS stock, pv.id AS variant_id,
              pv.tienda_nube_variant_id, pv.mercado_libre_variant_id, pv.mercado_libre_item_id
       FROM products p
       JOIN product_colors pc ON pc.product_id=p.id
       JOIN colors c ON c.id=pc.color_id
       JOIN product_variants pv ON pv.product_color_id=pc.id
       JOIN sizes s ON s.id=pv.size_id
       LEFT JOIN stocks st ON st.variant_id=pv.id
       WHERE p.id IN (${idPlaceholders})
       ORDER BY c.code, s.size_code`,
      productIds
    );
    
    const variants = variantsRows.map((v: any) => ({
      ...v,
      externalIds: {
        tiendaNubeVariant: v.tienda_nube_variant_id,
        mercadoLibreVariant: v.mercado_libre_variant_id,
        mercadoLibreItemId: v.mercado_libre_item_id
      }
    }));

    const stock_total = variants.reduce((sum: number, v: any) => sum + Number(v.stock || 0), 0);
    res.json({ 
      ...product, 
      externalIds: {
        tiendaNube: product.tienda_nube_id,
        mercadoLibre: product.mercado_libre_id
      },
      stock_total, 
      variants 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error obteniendo producto' });
  }
};

export const patchStock = async (req: any, res: any) => {
  const { variantId, sku, colorCode, sizeCode, stock } = req.body as { variantId?: string; sku?: string; colorCode?: string; sizeCode?: string; stock: number };
  try {
    let vId = variantId || null;
    if (!vId) {
      if (!sku || !colorCode || !sizeCode) return res.status(400).json({ message: 'Debe enviar variantId o sku+colorCode+sizeCode' });
      vId = await getVariantIdBySkuColorSize(sku, colorCode, sizeCode);
      if (!vId) return res.status(404).json({ message: 'Variante no encontrada' });
    }
    
    // Usar el nuevo sistema de stock con historial y sincronizaci?n
    const { updateVariantStock } = await import('./stock.controller');
    const success = await updateVariantStock(vId, Number(stock), 'AJUSTE_MANUAL');
    
    if (!success) {
      return res.status(500).json({ message: 'Error actualizando stock' });
    }
    
    res.json({ variantId: vId, stock });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error actualizando stock' });
  }
};

export const updateProduct = async (req: any, res: any) => {
  const { id } = req.params;
  const { sku, name, category, base_price, description, mercadoLibrePackSize, tiendaNubePackSize, mayoristaPackSize } = req.body as {
    sku?: string; name?: string; category?: string; base_price?: number; description?: string;
    mercadoLibrePackSize?: number; tiendaNubePackSize?: number; mayoristaPackSize?: number;
  };
  if (!id) return res.status(400).json({ message: 'ID inv?lido' });
  try {
    const mlPack = mercadoLibrePackSize != null ? Math.max(1, Math.floor(Number(mercadoLibrePackSize))) : null;
    const tnPack = tiendaNubePackSize != null ? Math.max(1, Math.floor(Number(tiendaNubePackSize))) : null;
    const mayPack = mayoristaPackSize != null ? Math.max(1, Math.floor(Number(mayoristaPackSize))) : null;
    await execute(
      `UPDATE products SET 
         sku = COALESCE(?, sku),
         name = COALESCE(?, name),
         category = COALESCE(?, category),
         base_price = COALESCE(?, base_price),
         description = COALESCE(?, description),
         mercado_libre_pack_size = COALESCE(?, mercado_libre_pack_size),
         tienda_nube_pack_size = COALESCE(?, tienda_nube_pack_size),
         mayorista_pack_size = COALESCE(?, mayorista_pack_size)
       WHERE id = ?`,
      [sku != null ? String(sku).trim() : null, name ?? null, category ?? null, base_price ?? null, description ?? null, mlPack, tnPack, mayPack, id]
    );
    // Normalizar SKUs de variantes al formato baseSku-sizeCode-colorCode
    // (evita sufijos con nombre de color o letra de talle).
    await execute(
      `UPDATE product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       JOIN sizes s ON s.id = pv.size_id
       JOIN colors c ON c.id = pc.color_id
       SET pv.sku = CONCAT(p.sku, '-', s.size_code, '-', c.code)
       WHERE p.id = ?`,
      [id]
    );
    const updated = await get(`SELECT id, sku, name, category, base_price, description,
      COALESCE(mercado_libre_pack_size, 1) AS mercado_libre_pack_size,
      COALESCE(tienda_nube_pack_size, 1) AS tienda_nube_pack_size,
      COALESCE(NULLIF(mayorista_pack_size, 0), 1) AS mayorista_pack_size FROM products WHERE id = ?`, [id]);
    if (!updated) return res.status(404).json({ message: 'Producto no encontrado' });
    res.json(updated);
  } catch (error) {
    console.error(error);
    if ((error as any)?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Ya existe un artículo con ese SKU' });
    }
    res.status(500).json({ message: 'Error actualizando producto' });
  }
};

export const updateProductExternalIds = async (req: any, res: any) => {
  const { id } = req.params;
  const body = req.body || {};
  const hasTn = Object.prototype.hasOwnProperty.call(body, 'tiendaNubeId');
  const hasMl = Object.prototype.hasOwnProperty.call(body, 'mercadoLibreId');
  const tiendaNubeId = hasTn ? body.tiendaNubeId : undefined;
  const mercadoLibreId = hasMl ? body.mercadoLibreId : undefined;
  if (!id) return res.status(400).json({ message: 'ID inv?lido' });

  try {
    if (!hasTn && !hasMl) return res.status(400).json({ message: 'Debe enviar tiendaNubeId y/o mercadoLibreId (pueden ser null para desvincular).' });

    const sets: string[] = [];
    const params: any[] = [];
    if (hasTn) { sets.push('tienda_nube_id = ?'); params.push(tiendaNubeId != null && String(tiendaNubeId).trim() !== '' ? String(tiendaNubeId).trim() : null); }
    if (hasMl) { sets.push('mercado_libre_id = ?'); params.push(mercadoLibreId != null && String(mercadoLibreId).trim() !== '' ? String(mercadoLibreId).trim() : null); }
    params.push(id);

    await execute(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, params);
    res.json({ id, tiendaNubeId: hasTn ? (tiendaNubeId ?? null) : undefined, mercadoLibreId: hasMl ? (mercadoLibreId ?? null) : undefined });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error actualizando IDs externos del producto' });
  }
};

export const updateVariantExternalIds = async (req: any, res: any) => {
  const { variantId } = req.params;
  const body = req.body || {};
  const hasTnVar = Object.prototype.hasOwnProperty.call(body, 'tiendaNubeVariantId');
  const hasTnProd = Object.prototype.hasOwnProperty.call(body, 'tiendaNubeProductId');
  const hasMlVar = Object.prototype.hasOwnProperty.call(body, 'mercadoLibreVariantId');
  const hasMlItem = Object.prototype.hasOwnProperty.call(body, 'mercadoLibreItemId');
  const hasExternalSku = Object.prototype.hasOwnProperty.call(body, 'externalSku');
  const tiendaNubeVariantId = hasTnVar ? body.tiendaNubeVariantId : undefined;
  const tiendaNubeProductId = hasTnProd ? body.tiendaNubeProductId : undefined;
  const mercadoLibreVariantId = hasMlVar ? body.mercadoLibreVariantId : undefined;
  const mercadoLibreItemId = hasMlItem ? body.mercadoLibreItemId : undefined;
  const externalSku = hasExternalSku ? body.externalSku : undefined;
  if (!variantId) return res.status(400).json({ message: 'ID de variante inválido' });

  try {
    const mlItemOnVariant =
      hasMlItem && mercadoLibreItemId != null && String(mercadoLibreItemId).trim() !== ''
        ? String(mercadoLibreItemId).trim()
        : null;
    const mlVarOnVariant =
      !mlItemOnVariant && hasMlVar && mercadoLibreVariantId != null && String(mercadoLibreVariantId).trim() !== ''
        ? String(mercadoLibreVariantId).trim()
        : null;

    const sets: string[] = [];
    const params: any[] = [];
    if (hasTnVar) {
      sets.push('tienda_nube_variant_id = ?');
      params.push(
        tiendaNubeVariantId != null && String(tiendaNubeVariantId).trim() !== '' ? String(tiendaNubeVariantId).trim() : null
      );
    }
    if (mlItemOnVariant) {
      sets.push('mercado_libre_item_id = ?', 'mercado_libre_variant_id = NULL');
      params.push(mlItemOnVariant);
    } else if (mlVarOnVariant) {
      sets.push('mercado_libre_variant_id = ?', 'mercado_libre_item_id = NULL');
      params.push(mlVarOnVariant);
    } else if (hasMlVar || hasMlItem) {
      sets.push('mercado_libre_variant_id = NULL', 'mercado_libre_item_id = NULL');
    }
    if (hasExternalSku) {
      sets.push('external_sku = ?');
      params.push(externalSku != null && String(externalSku).trim() !== '' ? String(externalSku).trim() : null);
    }
    if (sets.length > 0) {
      params.push(variantId);
      await execute(`UPDATE product_variants SET ${sets.join(', ')} WHERE id = ?`, params);
    }

    let productRow = await get(
      `SELECT p.id AS product_id, p.tienda_nube_id, p.mercado_libre_id,
              COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack,
              COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack
       FROM products p
       JOIN product_colors pc ON pc.product_id = p.id
       JOIN product_variants pv ON pv.product_color_id = pc.id
       WHERE pv.id = ? LIMIT 1`,
      [variantId]
    );

    // Publicación propia (MLA por variante): no pisar mercado_libre_id del producto padre.
    if (productRow?.product_id) {
      if (hasTnProd) {
        const tnProdToSet =
          tiendaNubeProductId != null && String(tiendaNubeProductId).trim() !== '' ? String(tiendaNubeProductId).trim() : null;
        await execute(`UPDATE products SET tienda_nube_id = ? WHERE id = ?`, [tnProdToSet, productRow.product_id]);
        productRow = { ...productRow, tienda_nube_id: tnProdToSet };
      }
    }

    const tnVariantId =
      tiendaNubeVariantId != null && String(tiendaNubeVariantId).trim() !== '' ? String(tiendaNubeVariantId).trim() : null;
    const tnProductId =
      (productRow?.tienda_nube_id && String(productRow.tienda_nube_id).trim() !== '') ? String(productRow.tienda_nube_id).trim() : null;
    const tnPack = productRow?.tn_pack ?? 1;
    const mlPack = productRow?.ml_pack ?? 1;
    const mlPubItemId = mlItemOnVariant
      || (mlVarOnVariant && productRow?.mercado_libre_id ? String(productRow.mercado_libre_id).trim() : null);

    if (hasTnVar && (!tnProductId || !tnVariantId)) {
      await execute(`DELETE FROM variant_publications WHERE variant_id = ? AND platform = 'tiendanube'`, [variantId]);
    }
    if (hasMlVar || hasMlItem) {
      const hasAnyMl = !!mlPubItemId || !!mlVarOnVariant;
      if (!hasAnyMl) {
        await execute(`DELETE FROM variant_publications WHERE variant_id = ? AND platform = 'mercadolibre'`, [variantId]);
      }
    }

    if (tnProductId && tnVariantId) {
      await execute(`DELETE FROM variant_publications WHERE variant_id = ? AND platform = 'tiendanube'`, [variantId]);
      await execute(
        `INSERT INTO variant_publications (id, variant_id, platform, external_product_id, external_variant_id, pack_size)
         VALUES (?, ?, 'tiendanube', ?, ?, ?)
         ON DUPLICATE KEY UPDATE pack_size = VALUES(pack_size)`,
        [uuidv4(), variantId, tnProductId, tnVariantId, tnPack]
      );
    }
    if (mlPubItemId) {
      await execute(`DELETE FROM variant_publications WHERE variant_id = ? AND platform = 'mercadolibre'`, [variantId]);
      await execute(
        `INSERT INTO variant_publications (id, variant_id, platform, external_product_id, external_variant_id, pack_size)
         VALUES (?, ?, 'mercadolibre', ?, ?, ?)
         ON DUPLICATE KEY UPDATE external_product_id = VALUES(external_product_id), external_variant_id = VALUES(external_variant_id), pack_size = VALUES(pack_size)`,
        [uuidv4(), variantId, mlPubItemId, mlVarOnVariant || '', mlPack]
      );
    }

    // Después de vincular, usar el stock local como fuente de verdad y enviarlo a ML/TN
    try {
      const stockRow = await get(`SELECT stock FROM stocks WHERE variant_id = ?`, [variantId]);
      const currentStock = Number(stockRow?.stock ?? 0);
      await syncStockToExternalPlatforms(variantId, currentStock);
    } catch (syncErr: any) {
      console.error('[updateVariantExternalIds] Error enviando stock local a plataformas externas:', syncErr?.message || syncErr);
    }

    res.json({
      variantId,
      tiendaNubeVariantId,
      mercadoLibreVariantId,
      mercadoLibreItemId: mercadoLibreItemId ?? undefined,
      externalSku: externalSku ?? undefined,
      // Ya no se trae stock desde ML al vincular; el stock local es la fuente de verdad
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error actualizando IDs externos de variante' });
  }
};

/** Desvincular un artículo de Tienda Nube y/o Mercado Libre (producto padre + variantes). */
export const unlinkProductPlatforms = async (req: any, res: any) => {
  const { id } = req.params;
  const body = req.body || {};
  const tiendaNube = body.tiendaNube !== false; // default true
  const mercadoLibre = body.mercadoLibre !== false; // default true
  const unlinkVariants = body.variants !== false; // default true
  if (!id) return res.status(400).json({ message: 'ID inválido' });

  try {
    if (!tiendaNube && !mercadoLibre) {
      return res.status(400).json({ message: 'Debe indicar tiendaNube y/o mercadoLibre.' });
    }

    const result: any = { productId: id, tiendaNube: false, mercadoLibre: false, variants: unlinkVariants };

    if (tiendaNube) {
      await execute(`UPDATE products SET tienda_nube_id = NULL WHERE id = ?`, [id]);
      result.tiendaNube = true;
      if (unlinkVariants) {
        const rows = await query(
          `SELECT pv.id AS variant_id
           FROM product_variants pv
           JOIN product_colors pc ON pc.id = pv.product_color_id
           WHERE pc.product_id = ?`,
          [id]
        );
        const variantIds = (rows || []).map((r: any) => r.variant_id).filter(Boolean);
        await execute(
          `UPDATE product_variants pv
           JOIN product_colors pc ON pc.id = pv.product_color_id
           SET pv.tienda_nube_variant_id = NULL
           WHERE pc.product_id = ?`,
          [id]
        );
        if (variantIds.length > 0) {
          await execute(
            `DELETE FROM variant_publications WHERE platform = 'tiendanube' AND variant_id IN (${variantIds.map(() => '?').join(',')})`,
            variantIds
          );
        }
      }
    }

    if (mercadoLibre) {
      await execute(`UPDATE products SET mercado_libre_id = NULL WHERE id = ?`, [id]);
      result.mercadoLibre = true;
      if (unlinkVariants) {
        const rows = await query(
          `SELECT pv.id AS variant_id
           FROM product_variants pv
           JOIN product_colors pc ON pc.id = pv.product_color_id
           WHERE pc.product_id = ?`,
          [id]
        );
        const variantIds = (rows || []).map((r: any) => r.variant_id).filter(Boolean);
        await execute(
          `UPDATE product_variants pv
           JOIN product_colors pc ON pc.id = pv.product_color_id
           SET pv.mercado_libre_variant_id = NULL,
               pv.mercado_libre_item_id = NULL
           WHERE pc.product_id = ?`,
          [id]
        );
        if (variantIds.length > 0) {
          await execute(
            `DELETE FROM variant_publications WHERE platform = 'mercadolibre' AND variant_id IN (${variantIds.map(() => '?').join(',')})`,
            variantIds
          );
        }
      }
    }

    res.json({ ok: true, ...result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error desvinculando artículo' });
  }
};

/** Vinculación en lote: actualiza IDs externos de varias variantes y opcionalmente el producto padre.
 *  Usa el stock local como fuente de verdad y lo envía a ML/TN (no importa stock desde ML).
 */
export const bulkLinkVariants = async (req: Request, res: Response) => {
  const body = req.body || {};
  const { productId, mercadoLibreItemId, tiendaNubeProductId, links } = body as {
    productId?: string;
    mercadoLibreItemId?: string;
    tiendaNubeProductId?: string;
    links: Array<{
      variantId: string;
      mercadoLibreVariantId?: string | number;
      mercadoLibreItemId?: string;
      tiendaNubeVariantId?: string | number;
      externalSku?: string;
    }>;
  };
  if (!links || !Array.isArray(links) || links.length === 0) {
    console.warn('[bulkLinkVariants] Body recibido sin links v?lidos:', { hasBody: !!req.body, keys: body ? Object.keys(body) : [], linksLength: links?.length });
    return res.status(400).json({ message: 'Se requiere un array "links" con al menos un elemento' });
  }

  try {
    const withMlItem = links.filter((l: any) => l.mercadoLibreItemId != null && String(l.mercadoLibreItemId).trim() !== '').length;
    const withMlVar = links.filter(
      (l: any) =>
        l.mercadoLibreVariantId != null &&
        String(l.mercadoLibreVariantId).trim() !== '' &&
        !(l.mercadoLibreItemId != null && String(l.mercadoLibreItemId).trim() !== '')
    ).length;
    const withTn = links.filter((l: any) => l.tiendaNubeVariantId != null && String(l.tiendaNubeVariantId) !== '').length;
    const allMlOwnPublications = withMlItem > 0 && withMlVar === 0;
    console.log('[bulkLinkVariants] Actualizando', links.length, 'variantes, productId:', productId, 'ML padre:', mercadoLibreItemId, 'TN producto:', tiendaNubeProductId, '| links con ML publicación propia:', withMlItem, 'con TN:', withTn);
    let resolvedProductId = productId;
    if ((mercadoLibreItemId || tiendaNubeProductId) && !resolvedProductId && links.length > 0) {
      const row = await get(
        `SELECT p.id AS product_id FROM products p
         JOIN product_colors pc ON pc.product_id = p.id
         JOIN product_variants pv ON pv.product_color_id = pc.id
         WHERE pv.id = ? LIMIT 1`,
        [links[0].variantId]
      );
      resolvedProductId = row?.product_id ?? undefined;
    }
    if (resolvedProductId) {
      if (tiendaNubeProductId != null && tiendaNubeProductId !== '') {
        await execute(
          `UPDATE products SET tienda_nube_id = ? WHERE id = ?`,
          [String(tiendaNubeProductId), resolvedProductId]
        );
      }
      if (allMlOwnPublications) {
        // Cada variante tiene su MLA: el ID padre no debe usarse para sync (evita pisar stock).
        await execute(`UPDATE products SET mercado_libre_id = NULL WHERE id = ?`, [resolvedProductId]);
      } else if (mercadoLibreItemId != null && mercadoLibreItemId !== '') {
        await execute(
          `UPDATE products SET mercado_libre_id = ? WHERE id = ?`,
          [String(mercadoLibreItemId), resolvedProductId]
        );
      }
    }

    const productRow = resolvedProductId
      ? await get(
          `SELECT tienda_nube_id, mercado_libre_id,
                  COALESCE(NULLIF(tienda_nube_pack_size, 0), 1) AS tn_pack,
                  COALESCE(NULLIF(mercado_libre_pack_size, 0), 1) AS ml_pack
           FROM products WHERE id = ? LIMIT 1`,
          [resolvedProductId]
        )
      : null;
    const tnProductIdForPub =
      (tiendaNubeProductId && String(tiendaNubeProductId).trim()) ||
      (productRow?.tienda_nube_id && String(productRow.tienda_nube_id).trim()) ||
      null;
    const mlParentIdForPub =
      allMlOwnPublications
        ? null
        : (mercadoLibreItemId && String(mercadoLibreItemId).trim()) ||
          (productRow?.mercado_libre_id && String(productRow.mercado_libre_id).trim()) ||
          null;
    const tnPack = Number(productRow?.tn_pack ?? 1) || 1;
    const mlPack = Number(productRow?.ml_pack ?? 1) || 1;

    for (const link of links) {
      const { variantId, mercadoLibreVariantId, mercadoLibreItemId: linkMlItemId, tiendaNubeVariantId, externalSku } = link;
      if (!variantId) continue;
      const mlItemId = (linkMlItemId != null && String(linkMlItemId).trim() !== '') ? String(linkMlItemId).trim() : null;
      const mlVarId =
        !mlItemId && mercadoLibreVariantId != null && String(mercadoLibreVariantId).trim() !== ''
          ? String(mercadoLibreVariantId).trim()
          : null;
      const tnVarId =
        tiendaNubeVariantId != null && String(tiendaNubeVariantId).trim() !== '' ? String(tiendaNubeVariantId).trim() : null;

      const sets: string[] = [];
      const params: unknown[] = [];
      if (tnVarId != null) {
        sets.push('tienda_nube_variant_id = ?');
        params.push(tnVarId);
      }
      if (mlItemId != null) {
        sets.push('mercado_libre_item_id = ?', 'mercado_libre_variant_id = NULL');
        params.push(mlItemId);
      } else if (mlVarId != null) {
        sets.push('mercado_libre_variant_id = ?', 'mercado_libre_item_id = NULL');
        params.push(mlVarId);
      }
      if (externalSku !== undefined && externalSku !== null) {
        sets.push('external_sku = ?');
        params.push(String(externalSku).trim() || null);
      }
      if (sets.length > 0) {
        params.push(variantId);
        await execute(`UPDATE product_variants SET ${sets.join(', ')} WHERE id = ?`, params);
      }

      if (tnVarId && tnProductIdForPub) {
        await execute(`DELETE FROM variant_publications WHERE variant_id = ? AND platform = 'tiendanube'`, [variantId]);
        await execute(
          `INSERT INTO variant_publications (id, variant_id, platform, external_product_id, external_variant_id, pack_size)
           VALUES (?, ?, 'tiendanube', ?, ?, ?)
           ON DUPLICATE KEY UPDATE pack_size = VALUES(pack_size)`,
          [uuidv4(), variantId, tnProductIdForPub, tnVarId, tnPack]
        );
      }

      if (mlItemId || mlVarId) {
        await execute(`DELETE FROM variant_publications WHERE variant_id = ? AND platform = 'mercadolibre'`, [variantId]);
        const pubItemId = mlItemId || mlParentIdForPub;
        if (pubItemId) {
          await execute(
            `INSERT INTO variant_publications (id, variant_id, platform, external_product_id, external_variant_id, pack_size)
             VALUES (?, ?, 'mercadolibre', ?, ?, ?)
             ON DUPLICATE KEY UPDATE external_product_id = VALUES(external_product_id), external_variant_id = VALUES(external_variant_id), pack_size = VALUES(pack_size)`,
            [uuidv4(), variantId, pubItemId, mlVarId || '', mlPack]
          );
        }
      }
    }

    // Enviar stock local a plataformas externas (ML/TN). Por lotes para no disparar el timeout del cliente.
    const SYNC_BATCH = 4;
    let synced = 0;
    const toSync = links.filter((l) => l.variantId);
    for (let i = 0; i < toSync.length; i += SYNC_BATCH) {
      const batch = toSync.slice(i, i + SYNC_BATCH);
      const batchCounts = await Promise.all(
        batch.map(async (link) => {
          try {
            const stockRow = await get(`SELECT stock FROM stocks WHERE variant_id = ?`, [link.variantId]);
            const currentStock = Number(stockRow?.stock ?? 0);
            await syncStockToExternalPlatforms(link.variantId!, currentStock);
            return 1;
          } catch (err: any) {
            console.warn('[bulkLinkVariants] Error enviando stock local a plataformas externas para variante', link.variantId, ':', err?.message || err);
            return 0;
          }
        })
      );
      synced += batchCounts.reduce<number>((a, b) => a + b, 0);
    }

    res.json({
      updated: links.length,
      synced,
      productId: resolvedProductId,
      mercadoLibreItemId: mercadoLibreItemId ?? undefined,
      tiendaNubeProductId: tiendaNubeProductId ?? undefined
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error en vinculaci?n en lote' });
  }
};

export const deleteAllProducts = async (req: any, res: any) => {
  try {
    await execute('SET FOREIGN_KEY_CHECKS = 0');
    await execute('TRUNCATE TABLE stocks');
    await execute('TRUNCATE TABLE product_variants');
    await execute('TRUNCATE TABLE product_colors');
    await execute('TRUNCATE TABLE products');
    // Also delete Colors and Sizes to start fresh
    await execute('TRUNCATE TABLE colors');
    await execute('TRUNCATE TABLE sizes');
    await execute('SET FOREIGN_KEY_CHECKS = 1');
    res.json({ message: 'Todos los productos, variantes, colores y talles han sido eliminados correctamente' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error eliminando todos los datos' });
  }
};

/** Eliminar una variante (y su stock). No se puede si está en pedidos. */
export const deleteVariant = async (req: any, res: any) => {
  const { variantId } = req.params;
  if (!variantId) return res.status(400).json({ message: 'Falta variantId' });
  try {
    const inOrder = await get(
      `SELECT 1 FROM order_items WHERE variant_id = ? LIMIT 1`,
      [variantId]
    );
    if (inOrder) {
      return res.status(400).json({
        message: 'No se puede eliminar la variante porque está en uno o más pedidos.',
      });
    }
    await execute('DELETE FROM stocks WHERE variant_id = ?', [variantId]);
    const result = await execute('DELETE FROM product_variants WHERE id = ?', [variantId]);
    const affected = result && (result as any).affectedRows;
    if (affected === 0) {
      return res.status(404).json({ message: 'Variante no encontrada' });
    }
    res.json({ message: 'Variante eliminada' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error eliminando variante' });
  }
};

/** Obtener una variante por ID (para formulario de edición) */
export const getVariantById = async (req: Request, res: Response) => {
  const { variantId } = req.params;
  if (!variantId) return res.status(400).json({ message: 'ID de variante requerido' });
  try {
    const row = await get(
      `SELECT pv.id, pv.sku, pv.external_sku, pv.tienda_nube_variant_id, pv.mercado_libre_variant_id, pv.mercado_libre_item_id,
              p.name AS product_name, p.sku AS base_sku, p.tienda_nube_id,
              s.size_code, c.code AS color_code, c.name AS color_name,
              COALESCE(st.stock, 0) AS stock
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       JOIN colors c ON c.id = pc.color_id
       JOIN sizes s ON s.id = pv.size_id
       LEFT JOIN stocks st ON st.variant_id = pv.id
       WHERE pv.id = ?`,
      [variantId]
    );
    if (!row) return res.status(404).json({ message: 'Variante no encontrada' });
    res.json(row);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error obteniendo variante' });
  }
};

/** Actualizar variante (SKU y/o external_sku). Si la variante está vinculada a ML/TN, envía el SKU a esas plataformas. */
export const updateVariant = async (req: Request, res: Response) => {
  const { variantId } = req.params;
  const { sku, externalSku } = req.body as { sku?: string; externalSku?: string };
  if (!variantId) return res.status(400).json({ message: 'ID de variante requerido' });
  try {
    const updates: string[] = [];
    const values: any[] = [];
    if (sku !== undefined) {
      // Siempre guardar SKU de variante en formato canónico: baseSku-sizeCode-colorCode.
      const variantMeta = await get(
        `SELECT p.sku AS base_sku, s.size_code, c.code AS color_code
         FROM product_variants pv
         JOIN product_colors pc ON pc.id = pv.product_color_id
         JOIN products p ON p.id = pc.product_id
         JOIN sizes s ON s.id = pv.size_id
         JOIN colors c ON c.id = pc.color_id
         WHERE pv.id = ?`,
        [variantId]
      );
      const canonicalSku = variantMeta?.base_sku && variantMeta?.size_code && variantMeta?.color_code
        ? `${variantMeta.base_sku}-${variantMeta.size_code}-${variantMeta.color_code}`
        : (sku === '' ? null : String(sku).trim());
      updates.push('sku = ?');
      values.push(canonicalSku);
    }
    if (externalSku !== undefined) {
      updates.push('external_sku = ?');
      values.push(externalSku === '' ? null : String(externalSku).trim());
    }
    if (updates.length === 0) {
      return res.status(400).json({ message: 'Indicá al menos un campo a actualizar (sku o externalSku)' });
    }
    values.push(variantId);
    await execute(
      `UPDATE product_variants SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
    await touchProductUpdatedAtByVariantId(variantId);
    const updated = await get(
      `SELECT pv.id, pv.sku, pv.external_sku, pv.mercado_libre_item_id, pv.mercado_libre_variant_id, pv.tienda_nube_variant_id, p.tienda_nube_id
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       WHERE pv.id = ?`,
      [variantId]
    );
    if (!updated) return res.status(404).json({ message: 'Variante no encontrada' });

    const skuToSend = skuToCanonicalString(updated.sku || updated.external_sku || '');
    if (skuToSend) {
      if (updated.mercado_libre_item_id && updated.mercado_libre_variant_id) {
        updateMercadoLibreSku(updated.mercado_libre_item_id, updated.mercado_libre_variant_id, skuToSend).catch(err =>
          console.error('[updateVariant] Error enviando SKU a ML:', err)
        );
      }
      if (updated.tienda_nube_id && updated.tienda_nube_variant_id) {
        updateTiendaNubeSku(updated.tienda_nube_id, updated.tienda_nube_variant_id, skuToSend).catch(err =>
          console.error('[updateVariant] Error enviando SKU a TN:', err)
        );
      }
    }

    res.json({ id: updated.id, sku: updated.sku, external_sku: updated.external_sku });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error actualizando variante' });
  }
};

/** Elimina un producto por ID (variantes, colores, stock en cascada). No elimina si alguna variante está en pedidos. */
export async function deleteProductById(productId: string): Promise<{ deleted: boolean; error?: 'in_orders' | 'not_found' }> {
  const inOrder = await get(
    `SELECT 1 FROM order_items oi
     JOIN product_variants pv ON pv.id = oi.variant_id
     JOIN product_colors pc ON pc.id = pv.product_color_id
     WHERE pc.product_id = ? LIMIT 1`,
    [productId]
  );
  if (inOrder) return { deleted: false, error: 'in_orders' };
  const result = await execute('DELETE FROM products WHERE id = ?', [productId]);
  const affected = result && (result as any).affectedRows;
  if (affected === 0) return { deleted: false, error: 'not_found' };
  return { deleted: true };
}

/** Eliminar un producto (artículo) y todas sus variantes, colores y stock. No se puede si alguna variante está en pedidos. */
export const deleteProduct = async (req: any, res: any) => {
  const productId = req.params.id;
  if (!productId) return res.status(400).json({ message: 'Falta productId' });
  try {
    const r = await deleteProductById(productId);
    if (!r.deleted) {
      if (r.error === 'in_orders') {
        return res.status(400).json({
          message: 'No se puede eliminar el artículo porque alguna variante está en pedidos.',
        });
      }
      return res.status(404).json({ message: 'Producto no encontrado' });
    }
    res.json({ message: 'Producto y variantes eliminados' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error eliminando producto' });
  }
};

// --- Importaci?n desde Tango (Excel): c?digo = 7 art + 3 talle + 3 color ---
function normalizeHeader(h: string): string {
  return (h || '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function findColumn(headers: string[], name: string): number {
  for (let i = 0; i < headers.length; i++) {
    if (normalizeHeader(headers[i]) === name || normalizeHeader(headers[i]).includes(name)) return i;
  }
  return -1;
}

/** Coincidencia exacta del encabezado normalizado (sin acentos, minúsculas). */
function findColumnExact(headers: string[], ...targets: string[]): number {
  for (const t of targets) {
    const want = normalizeHeader(t);
    for (let i = 0; i < headers.length; i++) {
      if (normalizeHeader(headers[i]) === want) return i;
    }
  }
  return -1;
}

/**
 * Color numérico: catálogo 3 dígitos; si el Excel trae 4+ dígitos (ej. 2021 → 202), se usan los primeros 3.
 */
function normalizeColorCodeForImport(val: unknown): string {
  return normalizeColorCodeForImportValue(val);
}

/** Talle Tango numérico o letra (P, M, G, GG, XG…). */
function normalizeTalleForImport(val: unknown): string {
  const s = String(val ?? '').trim();
  if (!s) return '';
  return codigoTalleParaSku(s);
}

function parseRgbToHex(val: unknown): string | null {
  const s = String(val ?? '').trim();
  if (!s) return null;
  const m = s.replace(/\s/g, '').match(/^(\d{1,3}),(\d{1,3}),(\d{1,3})$/);
  if (!m) return null;
  const r = Math.min(255, parseInt(m[1], 10));
  const g = Math.min(255, parseInt(m[2], 10));
  const b = Math.min(255, parseInt(m[3], 10));
  if ([r, g, b].some((x) => Number.isNaN(x))) return null;
  return (
    '#' +
    [r, g, b]
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

function parseCantidadCell(val: unknown): number | undefined {
  if (val == null || val === '') return undefined;
  const n = typeof val === 'number' && Number.isFinite(val) ? Math.trunc(val) : parseInt(String(val).trim(), 10);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.min(n, 9999999);
}

type TangoImportLayout =
  | { mode: 'single'; codigoKey: string; descKey: string | null }
  | {
      mode: 'triple';
      articuloKey: string;
      talleKey: string;
      colorKey: string;
      descKey: string | null;
      colorNameKey?: string | null;
      modeloKey?: string | null;
      cantidadKey?: string | null;
      rgbKey?: string | null;
    };

function resolveTangoImportLayout(headers: string[]): TangoImportLayout | { error: string } {
  const descIdx = findColumn(headers, 'descripcion');
  const descKey = descIdx >= 0 ? headers[descIdx] : null;

  const talleIdx = findColumnExact(headers, 'talle', 'talla', 'size');
  const colorCodeIdx = findColumnExact(
    headers,
    'codigo color',
    'codigocolor',
    'codigo co',
    'codigo col',
    'codigo colo',
    'codcolor'
  );
  const colorNameIdx = findColumnExact(headers, 'color', 'nombre color');
  let colorKey: string | null = null;
  let colorNameKey: string | null = null;
  if (colorCodeIdx >= 0) {
    colorKey = headers[colorCodeIdx];
    if (colorNameIdx >= 0 && colorNameIdx !== colorCodeIdx) colorNameKey = headers[colorNameIdx];
  } else if (colorNameIdx >= 0) {
    colorKey = headers[colorNameIdx];
  }

  if (talleIdx >= 0 && colorKey) {
    const used = new Set([talleIdx, colorCodeIdx >= 0 ? colorCodeIdx : -1, colorNameIdx >= 0 ? colorNameIdx : -1].filter((i) => i >= 0));
    let articuloIdx = findColumnExact(headers, 'articulo', 'artículo', 'sku');
    if (articuloIdx < 0 || used.has(articuloIdx)) {
      const skuCol = findColumn(headers, 'sku');
      if (skuCol >= 0 && !used.has(skuCol)) articuloIdx = skuCol;
    }
    if (articuloIdx < 0 || used.has(articuloIdx)) {
      articuloIdx = findColumnExact(headers, 'codigo articulo', 'codigoarticulo');
    }
    if (articuloIdx < 0 || used.has(articuloIdx)) {
      articuloIdx = findColumnExact(headers, 'codigo', 'código');
    }
    if (articuloIdx < 0 || used.has(articuloIdx)) {
      return {
        error:
          'Con columnas Talle y Color/Código color hace falta también una columna de artículo (Articulo, Codigo, SKU o Codigo articulo).',
      };
    }

    const modeloIdx = findColumnExact(headers, 'modelo', 'model');
    const cantidadIdx = findColumnExact(headers, 'cantidad', 'qty', 'quantity');
    const rgbIdx = findColumnExact(headers, 'rgb');

    return {
      mode: 'triple',
      articuloKey: headers[articuloIdx],
      talleKey: headers[talleIdx],
      colorKey,
      descKey,
      colorNameKey,
      modeloKey: modeloIdx >= 0 ? headers[modeloIdx] : null,
      cantidadKey: cantidadIdx >= 0 ? headers[cantidadIdx] : null,
      rgbKey: rgbIdx >= 0 ? headers[rgbIdx] : null,
    };
  }

  const codigoCol = findColumn(headers, 'codigo');
  if (codigoCol < 0) {
    return {
      error:
        'No se encontró columna Código. Usá un código Tango completo en una columna "Código", o columnas: Código/Articulo/SKU + Talle + Código color (o Color) — opcional Modelo, Descripción, Cantidad, RGB.',
    };
  }
  return { mode: 'single', codigoKey: headers[codigoCol], descKey };
}

/**
 * Parsea un código Tango respetando los caracteres no numéricos del prefijo (ej.: "Q05875", "C01303").
 *
 * El layout real del código en Tango es de ancho fijo:
 *   - Posiciones 0..8 (9 caracteres): código del artículo, padded a la derecha con espacios.
 *     Ej.: "Q05875   ", "C01303   ", "0012501  ", "0587513  "
 *   - Posiciones 9..11 (3 caracteres): talle.
 *   - Posiciones 12..14 (3 caracteres): color.
 *
 * Versiones anteriores hacían `raw.replace(/\D/g, '')` antes de cortar; eso **eliminaba** los prefijos
 * tipo "Q"/"C" del SKU y producía duplicados (ej. "Q05875" y "0587500" como dos productos distintos).
 * Este parser conserva el prefijo como parte del artículo.
 *
 * `codigoCompleto` mantiene el código completo *sin espacios* (artículo + talle + color), útil para
 * usarlo como SKU de variante (legible en remitos/facturas).
 */
function parseCodigoTango(codigo: unknown): { articulo: string; talle: string; color: string; codigo13: string; codigoCompleto: string } {
  const raw = (codigo != null ? String(codigo) : '');
  if (!raw) return { articulo: '', talle: '', color: '', codigo13: '', codigoCompleto: '' };

  const padded = raw.padEnd(15, ' ');
  let articulo = padded.slice(0, 9).trim();
  let talle = padded.slice(9, 12).trim();
  let color = padded.slice(12, 15).trim();

  // Si el formato no respeta el ancho fijo (códigos más cortos o concatenados sin padding) intentamos un fallback.
  if (!articulo) {
    const cleaned = raw.trim();
    if (cleaned.length >= 13) {
      // Asumimos formato concatenado: 7 artículo + 3 talle + 3 color (puede tener letra al inicio o no).
      articulo = cleaned.slice(0, cleaned.length - 6);
      talle = cleaned.slice(cleaned.length - 6, cleaned.length - 3);
      color = cleaned.slice(cleaned.length - 3);
    } else {
      articulo = cleaned;
    }
  }

  // Solo aceptamos talle/color compuestos por dígitos; si trae cualquier otra cosa los descartamos.
  if (!/^\d{1,3}$/.test(talle)) talle = '';
  if (!/^\d{1,3}$/.test(color)) color = '';

  const codigoCompleto = `${articulo}${talle}${color}`;
  // `codigo13` se mantiene para compatibilidad: sigue siendo el "ancho" del SKU concatenado.
  return { articulo, talle, color, codigo13: codigoCompleto, codigoCompleto };
}

/** Dígitos del código base; relleno a 7 como en inventario/stock (solo si aplica). */
function padArticleDigitsTo7FromArticulo(articulo: string): string {
  const digits = String(articulo ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length <= 7 ? digits.padStart(7, '0') : digits;
}

/** Minúsculas, sin espacios/guiones/guiones bajos (para emparejar "18403-03" con export reimportado). */
function skuNormCompactKey(s: string): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_-]/g, '');
}

/**
 * Variantes de SKU base para encontrar un producto ya cargado (evita duplicar el mismo artículo
 * por distinto formato: 058750 vs 0058750, 18403-03 vs 1840303, Q05875…).
 */
function buildProductSkuLookupCandidates(articulo: string): string[] {
  const out = new Set<string>();
  const t = String(articulo ?? '').trim();
  if (!t) return [];
  out.add(t);
  const noHyphen = t.replace(/-/g, '').trim();
  if (noHyphen && noHyphen !== t) out.add(noHyphen);

  const digits = t.replace(/\D/g, '');
  if (digits) {
    out.add(digits);
    const p7 = padArticleDigitsTo7FromArticulo(t);
    if (p7) out.add(p7);
    const trimmed = digits.replace(/^0+/, '') || '0';
    if (trimmed !== digits) {
      out.add(trimmed);
      out.add(trimmed.length <= 7 ? trimmed.padStart(7, '0') : trimmed);
    }
  }
  const m = t.match(/^([A-Za-z]+)(\d[\d\s-]*)$/);
  if (m) {
    const numOnly = m[2].replace(/\D/g, '');
    if (numOnly) {
      out.add(numOnly.length <= 7 ? numOnly.padStart(7, '0') : numOnly);
      out.add(m[1].toUpperCase() + numOnly);
      out.add(m[1].toLowerCase() + numOnly);
    }
  }
  return [...out].filter((x) => x.length > 0 && x.length <= 120);
}

function isTrivialImportProductName(name: string | null | undefined, sku: string, articuloRow: string): boolean {
  const nn = skuNormCompactKey(name || '');
  if (!nn) return true;
  const sn = skuNormCompactKey(sku || '');
  const an = skuNormCompactKey(articuloRow || '');
  return nn === sn || nn === an;
}

async function findExistingProductForImportArticulo(
  articulo: string
): Promise<{ id: string; sku: string; name: string } | null> {
  const uniq = [...new Set(buildProductSkuLookupCandidates(articulo))].slice(0, 40);
  const coreKey = skuNormCompactKey(articulo);
  const parts: string[] = [];
  const params: string[] = [];
  if (uniq.length > 0) {
    parts.push(`sku IN (${uniq.map(() => '?').join(',')})`);
    params.push(...uniq);
  }
  if (coreKey.length >= 4) {
    parts.push(`REPLACE(REPLACE(REPLACE(LOWER(TRIM(sku)), '-', ''), '_', ''), ' ', '') = ?`);
    params.push(coreKey);
  }
  if (parts.length === 0) return null;
  const rows = (await query(`SELECT id, sku, name FROM products WHERE ${parts.join(' OR ')}`, params)) as any[];
  if (!rows?.length) return null;
  const byId = new Map<string, any>();
  for (const r of rows) byId.set(String(r.id), r);
  const list = [...byId.values()];
  if (list.length === 1) return list[0];
  list.sort((a: any, b: any) => {
    const ta = isTrivialImportProductName(a.name, a.sku, articulo);
    const tb = isTrivialImportProductName(b.name, b.sku, articulo);
    if (ta !== tb) return ta ? 1 : -1;
    return String(b.name ?? '').trim().length - String(a.name ?? '').trim().length;
  });
  return list[0];
}

async function maybeUpgradeTrivialProductNameFromImport(
  productId: string,
  sku: string,
  currentName: string,
  descripcion: string | undefined,
  articuloRow: string
): Promise<void> {
  const desc = String(descripcion ?? '').trim();
  if (!desc) return;
  if (!isTrivialImportProductName(currentName, sku, articuloRow)) return;
  const sn = skuNormCompactKey(sku);
  const dn = skuNormCompactKey(desc);
  if (dn === sn || dn === skuNormCompactKey(articuloRow)) return;
  if (desc.length < 3) return;
  await execute(`UPDATE products SET name = ? WHERE id = ?`, [desc, productId]);
}

export const importTangoArticles = async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      rows: Record<string, unknown>[];
      onlyComplete?: boolean;
      /** Default true: al reimportar, no pisa el stock de variantes que ya existían (evita duplicar cantidades). */
      keepStockOnExistingVariants?: boolean;
      /** Si viene, cada fila importada vincula variante/producto a este despacho (ítems + último despacho del producto). */
      despachoId?: string;
    };
    const { rows: rawRows, onlyComplete = true } = body;
    const keepStockOnExistingVariants = body.keepStockOnExistingVariants !== false;
    const despachoIdRaw = body.despachoId != null ? String(body.despachoId).trim() : '';
    let despachoLink: { id: string; pais_origen: string | null } | null = null;
    if (despachoIdRaw) {
      const dRow = await get(`SELECT id, pais_origen FROM despachos WHERE id = ? LIMIT 1`, [despachoIdRaw]);
      if (!dRow?.id) {
        return res.status(400).json({ message: 'despachoId no válido: no existe ese despacho.' });
      }
      despachoLink = { id: dRow.id as string, pais_origen: (dRow as any).pais_origen ?? null };
    }
    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return res.status(400).json({
        message:
          'Se requiere un array "rows" con filas del Excel: columna "Código" (Tango completo) o columnas Código/Articulo + Talle + Código color (o solo Color numérico); opcional Modelo, Descripción, Cantidad, RGB.',
      });
    }
    const headers = Object.keys(rawRows[0] || {});
    const layout = resolveTangoImportLayout(headers);
    if ('error' in layout) {
      return res.status(400).json({ message: layout.error });
    }

    type TangoImportRow = {
      articulo: string;
      talle: string;
      color: string;
      codigo13: string;
      descripcion: string;
      colorName?: string;
      initialStock?: number;
      colorHex?: string | null;
    };
    const rows: TangoImportRow[] = [];

    if (layout.mode === 'triple') {
      const { articuloKey, talleKey, colorKey, descKey, colorNameKey, modeloKey, cantidadKey, rgbKey } = layout;
      for (const row of rawRows) {
        const articulo = String(row[articuloKey] ?? '').trim();
        const talle = normalizeTalleForImport(row[talleKey]);
        const color = normalizeColorCodeForImport(row[colorKey]);
        const parsed = { articulo, talle, color, codigoCompleto: `${articulo}${talle}${color}` };
        const isCompleta = !!(parsed.articulo && parsed.talle && parsed.color);
        if (!isCompleta && onlyComplete) continue;
        const descripcion =
          (descKey && row[descKey] != null && String(row[descKey]).trim()) ||
          (modeloKey && row[modeloKey] != null && String(row[modeloKey]).trim()) ||
          parsed.articulo;
        const colorName = colorNameKey ? String(row[colorNameKey] ?? '').trim() : '';
        const initialStock = cantidadKey ? parseCantidadCell(row[cantidadKey]) : undefined;
        const colorHex = rgbKey ? parseRgbToHex(row[rgbKey]) : null;
        const rec: TangoImportRow = {
          articulo: parsed.articulo,
          talle: parsed.talle,
          color: parsed.color,
          codigo13: parsed.codigoCompleto,
          descripcion,
        };
        if (colorName) rec.colorName = colorName;
        if (initialStock !== undefined) rec.initialStock = initialStock;
        if (colorHex) rec.colorHex = colorHex;
        rows.push(rec);
      }
    } else {
      const { codigoKey, descKey } = layout;
      for (const row of rawRows) {
        const codigo = row[codigoKey];
        const parsed = parseCodigoTango(codigo);
        const isCompleta = !!(parsed.articulo && parsed.talle && parsed.color);
        if (!isCompleta && onlyComplete) continue;
        const descripcion =
          (descKey && row[descKey] != null ? String(row[descKey]).trim() : '') || parsed.articulo;
        rows.push({
          articulo: parsed.articulo,
          talle: parsed.talle,
          color: parsed.color,
          codigo13: parsed.codigoCompleto,
          descripcion,
        });
      }
    }

    let productsCreated = 0;
    let variantsCreated = 0;
    let variantsUpdated = 0;
    let stockUpdatesSkipped = 0;
    let despachoItemsInserted = 0;
    let despachoItemsUpdated = 0;
    let despachoProductsTagged = 0;
    const errors: string[] = [];
    const productNamesByArticulo: Record<string, string> = {};

    const paisForProductUpdate =
      despachoLink?.pais_origen && String(despachoLink.pais_origen).trim()
        ? String(despachoLink.pais_origen).trim()
        : 'Brasil';

    for (const r of rows) {
      try {
        if (!r.articulo || !r.talle || !r.color) continue;

        if (!productNamesByArticulo[r.articulo] && r.descripcion) {
          productNamesByArticulo[r.articulo] = r.descripcion;
        }

        const existingProduct = await findExistingProductForImportArticulo(r.articulo);
        let productId: string | null = existingProduct?.id || null;
        if (productId && existingProduct) {
          await maybeUpgradeTrivialProductNameFromImport(
            productId,
            existingProduct.sku,
            existingProduct.name,
            r.descripcion,
            r.articulo
          );
        }
        if (!productId) {
          productId = uuidv4();
          const name = productNamesByArticulo[r.articulo] || r.articulo;
          await execute(
            `INSERT INTO products (id, sku, name, category, base_price, description) VALUES (?, ?, ?, ?, ?, ?)`,
            [productId, r.articulo, name, 'General', 0, null]
          );
          productsCreated++;
        }

        let sizeId = (await get(`SELECT id FROM sizes WHERE size_code = ?`, [r.talle]))?.id;
        if (!sizeId) {
          sizeId = uuidv4();
          const talleNombre = nombreTalleDesdeCodigo(r.talle);
          await execute(`INSERT INTO sizes (id, size_code, name) VALUES (?, ?, ?)`, [sizeId, r.talle, talleNombre]);
        }

        let colorId = (await get(`SELECT id FROM colors WHERE code = ?`, [r.color]))?.id;
        if (!colorId) {
          colorId = uuidv4();
          const name = (r.colorName && r.colorName.trim()) || r.color;
          const hex = r.colorHex || '#000000';
          await execute(`INSERT INTO colors (id, name, code, hex) VALUES (?, ?, ?, ?)`, [colorId, name, r.color, hex]);
        }

        let productColorId = (await get(`SELECT id FROM product_colors WHERE product_id = ? AND color_id = ?`, [productId, colorId]))?.id;
        if (!productColorId) {
          productColorId = uuidv4();
          await execute(`INSERT INTO product_colors (id, product_id, color_id) VALUES (?, ?, ?)`, [productColorId, productId, colorId]);
        }

        const existingVariant = await get(
          `SELECT id FROM product_variants WHERE product_color_id = ? AND size_id = ?`,
          [productColorId, sizeId]
        );
        let variantId: string;
        if (!existingVariant) {
          variantId = uuidv4();
          await execute(
            `INSERT INTO product_variants (id, product_color_id, size_id, sku) VALUES (?, ?, ?, ?)`,
            [variantId, productColorId, sizeId, r.codigo13]
          );
          const qty = r.initialStock ?? 0;
          await execute(`INSERT INTO stocks (variant_id, stock) VALUES (?, ?)`, [variantId, qty]);
          variantsCreated++;
        } else {
          variantId = existingVariant.id as string;
          await execute(`UPDATE product_variants SET sku = ? WHERE id = ?`, [r.codigo13, variantId]);
          variantsUpdated++;
          if (r.initialStock !== undefined) {
            if (keepStockOnExistingVariants) {
              stockUpdatesSkipped++;
            } else {
              await execute(`UPDATE stocks SET stock = ? WHERE variant_id = ?`, [r.initialStock, variantId]);
            }
          }
        }

        if (despachoLink) {
          let qtyDespacho: number;
          if (r.initialStock !== undefined) {
            qtyDespacho = Math.max(0, Math.floor(Number(r.initialStock) || 0));
          } else {
            const stRow = await get(`SELECT COALESCE(stock, 0) AS stock FROM stocks WHERE variant_id = ?`, [variantId]);
            qtyDespacho = Math.max(0, Math.floor(Number((stRow as any)?.stock) || 0));
          }
          const prodRow = await get(`SELECT name FROM products WHERE id = ?`, [productId]);
          const prodName = String((prodRow as any)?.name || r.articulo || '').trim();
          const descripcionItem = `${prodName} - ${r.codigo13}`.trim();

          if (qtyDespacho > 0) {
            const di = await get(
              `SELECT id FROM despacho_items WHERE despacho_id = ? AND variant_id = ? LIMIT 1`,
              [despachoLink.id, variantId]
            );
            if (di?.id) {
              await execute(
                `UPDATE despacho_items SET cantidad = ?, product_id = ?, descripcion_item = ? WHERE id = ?`,
                [qtyDespacho, productId, descripcionItem, di.id]
              );
              despachoItemsUpdated++;
            } else {
              const diId = uuidv4();
              await execute(
                `INSERT INTO despacho_items (id, despacho_id, product_id, variant_id, cantidad, costo_unitario, descripcion_item) VALUES (?, ?, ?, ?, ?, NULL, ?)`,
                [diId, despachoLink.id, productId, variantId, qtyDespacho, descripcionItem]
              );
              despachoItemsInserted++;
            }
          }

          await execute(`UPDATE products SET ultimo_despacho_id = ?, pais_origen = ? WHERE id = ?`, [
            despachoLink.id,
            paisForProductUpdate,
            productId
          ]);
          despachoProductsTagged++;
        }
      } catch (err: any) {
        errors.push(`Fila ${r.codigo13}: ${err?.message || 'Error'}`);
      }
    }

    res.json({
      message: 'Importación Tango finalizada',
      productsCreated,
      variantsCreated,
      variantsUpdated,
      totalProcessed: rows.filter((r) => r.articulo && r.talle && r.color).length,
      keepStockOnExistingVariants,
      stockUpdatesSkipped: keepStockOnExistingVariants ? stockUpdatesSkipped : 0,
      despachoId: despachoLink?.id,
      despachoItemsInserted,
      despachoItemsUpdated,
      despachoProductsTagged,
      errors: errors.slice(0, 50),
    });
  } catch (error: any) {
    console.error('Import Tango:', error);
    res.status(500).json({ message: 'Error importando artículos Tango', error: error?.message });
  }
};

/**
 * Diagnóstico: lista productos potencialmente duplicados (mismo nombre, distinto SKU base).
 *
 * Devuelve grupos donde:
 *   - El nombre del producto se repite (normalizado a UPPER + TRIM, ignorando espacios múltiples).
 *   - Y/o el "núcleo numérico" del SKU coincide (sirve para detectar pares "Q05875" vs "058750"
 *     donde uno tiene un prefijo letra y el otro no).
 *   - Y/o comparten prefijo numérico sin los últimos 2 dígitos (`duplicateBySkuDigitPrefix`, mismo criterio
 *     que merge por SKU: p. ej. `0322389` ↔ `3223-89` **solo si** el nombre incluye el código de cada SKU).
 *
 * Pensado para verificar a mano antes de fusionar duplicados con `merge-trifil-products` o
 * `npm run merge-duplicate-products` / POST `/products/merge-duplicate-by-sku`.
 *
 * Query params opcionales:
 *   - q: filtra por substring en el nombre (case-insensitive). Ej.: ?q=trifil
 *   - limit: tope de grupos a devolver (default 200)
 */
export const getDuplicateProducts = async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 200));

    // Traemos todos los productos (más sus métricas básicas) y agrupamos en memoria.
    const params: any[] = [];
    let whereName = '';
    if (q) {
      whereName = `WHERE p.name LIKE ?`;
      params.push(`%${q}%`);
    }
    const rows = await query(
      `SELECT p.id, p.sku, p.name,
              (SELECT COUNT(*) FROM product_colors pc WHERE pc.product_id = p.id) AS color_count,
              (SELECT COUNT(*) FROM product_variants pv
                 JOIN product_colors pc ON pc.id = pv.product_color_id
                 WHERE pc.product_id = p.id) AS variant_count,
              (SELECT COALESCE(SUM(st.stock), 0) FROM stocks st
                 JOIN product_variants pv ON pv.id = st.variant_id
                 JOIN product_colors pc ON pc.id = pv.product_color_id
                 WHERE pc.product_id = p.id) AS stock_total
       FROM products p
       ${whereName}
       ORDER BY p.name, p.sku`,
      params
    );

    // Clave 1: nombre normalizado (UPPER + colapsa espacios). Detecta duplicados visibles para el usuario.
    const byName = new Map<string, any[]>();
    // Clave 2: núcleo numérico del SKU. Detecta pares tipo "Q05875" vs "058750".
    const byCore = new Map<string, any[]>();

    const normalizeName = (s: string) => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
    const skuCore = (s: string) => {
      const digits = String(s || '').replace(/\D/g, '');
      // 5 dígitos como núcleo "fuerte"; suficiente para hermanar 058750 con Q058750 (ambos comparten 05875).
      return digits.slice(0, 5);
    };

    /** Núcleo sin ceros a la izquierda (igual que merge duplicados). */
    const digitCoreNorm = (s: string) => {
      const d = String(s || '').replace(/\D/g, '');
      return d.replace(/^0+/, '') || '';
    };
    const byDpre = new Map<string, any[]>();
    for (const r of rows as any[]) {
      const dc = digitCoreNorm(r.sku);
      if (dc.length >= 6) {
        const pre = dc.slice(0, -2);
        if (pre.length >= 4) {
          if (!byDpre.has(pre)) byDpre.set(pre, []);
          byDpre.get(pre)!.push(r);
        }
      }
    }

    for (const r of rows as any[]) {
      const nameKey = normalizeName(r.name);
      if (nameKey) {
        if (!byName.has(nameKey)) byName.set(nameKey, []);
        byName.get(nameKey)!.push(r);
      }
      const core = skuCore(r.sku);
      if (core && core.length >= 4) {
        if (!byCore.has(core)) byCore.set(core, []);
        byCore.get(core)!.push(r);
      }
    }

    const buildGroup = (kind: 'name' | 'sku_core' | 'sku_digit_prefix', key: string, list: any[]) => ({
      kind,
      key,
      productCount: list.length,
      products: list.map((p: any) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        colorCount: Number(p.color_count) || 0,
        variantCount: Number(p.variant_count) || 0,
        stockTotal: Number(p.stock_total) || 0
      }))
    });

    const nameGroups = Array.from(byName.entries())
      .filter(([, list]) => list.length > 1)
      .map(([k, list]) => buildGroup('name', k, list));

    // Núcleo numérico: solo lo reportamos si además existen al menos dos SKUs base distintos
    // (sino estamos mostrando un único producto con muchas variantes, que no es duplicado).
    const coreGroups = Array.from(byCore.entries())
      .filter(([, list]) => {
        if (list.length < 2) return false;
        const baseSkus = new Set(list.map((p: any) => String(p.sku)));
        return baseSkus.size > 1;
      })
      .map(([k, list]) => buildGroup('sku_core', k, list));

    /** Mismo criterio `dpre:` que merge-duplicate-by-sku; solo filas cuyo nombre incluye el código del SKU. */
    const dpreGroups = Array.from(byDpre.entries())
      .map(([k, list]) => {
        const filtered = (list as any[]).filter((p) => nameEmbedsOwnSkuCode(p.name, p.sku));
        return [k, filtered] as const;
      })
      .filter(([, list]) => {
        if (list.length < 2) return false;
        const baseSkus = new Set(list.map((p: any) => String(p.sku)));
        return baseSkus.size > 1;
      })
      .map(([k, list]) => buildGroup('sku_digit_prefix', `dpre:${k}`, list));

    return res.json({
      filter: q || null,
      totalProducts: (rows as any[]).length,
      duplicateByName: nameGroups.slice(0, limit),
      duplicateBySkuCore: coreGroups.slice(0, limit),
      duplicateBySkuDigitPrefix: dpreGroups.slice(0, limit)
    });
  } catch (error: any) {
    console.error('getDuplicateProducts:', error);
    return res.status(500).json({ message: 'Error obteniendo duplicados', error: error?.message });
  }
};

/** Fusiona artículos elegidos manualmente en un “principal”. Body: { keeperProductId, duplicateProductIds: string[], dryRun?: boolean }. Solo ADMIN o DEPÓSITO. */
export const mergeManualProducts = async (req: Request, res: Response) => {
  try {
    const keeperProductId = String(req.body?.keeperProductId || '').trim();
    const raw = req.body?.duplicateProductIds;
    const duplicateProductIds = Array.isArray(raw)
      ? raw.map((x: unknown) => String(x ?? '').trim()).filter(Boolean)
      : [];
    const dryRun =
      req.body?.dryRun === true || req.query?.dryRun === 'true' || req.query?.dryRun === '1';
    if (!keeperProductId) {
      return res.status(400).json({ message: 'Indicá el artículo principal (keeperProductId).' });
    }
    if (duplicateProductIds.length === 0) {
      return res.status(400).json({ message: 'Indicá al menos un artículo a absorber (duplicateProductIds).' });
    }
    const result = await mergeManualIntoKeeper(keeperProductId, duplicateProductIds, { dryRun });
    if (result.errors.length && result.productsRemoved === 0 && !dryRun) {
      return res.status(422).json({
        message: 'No se pudo fusionar ningún artículo. Revisá los errores.',
        ...result,
      });
    }
    res.json(result);
  } catch (error: any) {
    console.error('mergeManualProducts:', error);
    return res.status(500).json({ message: 'Error en fusión manual', error: error?.message });
  }
};

/** Une dos variantes del mismo artículo con el mismo talle (size_id). Body: { keeperVariantId, absorbVariantId }. */
export const mergeManualVariants = async (req: Request, res: Response) => {
  try {
    const keeperVariantId = String(req.body?.keeperVariantId || '').trim();
    const absorbVariantId = String(req.body?.absorbVariantId || '').trim();
    if (!keeperVariantId || !absorbVariantId) {
      return res.status(400).json({ message: 'keeperVariantId y absorbVariantId son obligatorios.' });
    }
    await mergeManualVariantPair(keeperVariantId, absorbVariantId);
    res.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (
      msg.includes('mismo artículo') ||
      msg.includes('talles') ||
      msg.includes('distintas') ||
      msg.includes('no encontrada') ||
      msg.includes('Indicá')
    ) {
      return res.status(400).json({ message: msg });
    }
    console.error('mergeManualVariants:', e);
    return res.status(500).json({ message: 'Error fusionando variantes', error: msg });
  }
};

/** Fusiona productos con el mismo núcleo de SKU (guiones / ceros / formato). Solo ADMIN o DEPÓSITO. Body/query: dryRun=true para simular. */
export const mergeDuplicateProductsBySku = async (req: Request, res: Response) => {
  try {
    const dryRun =
      req.body?.dryRun === true || req.query?.dryRun === 'true' || req.query?.dryRun === '1';
    const result = await runMergeDuplicateProductsBySku({ dryRun });
    res.json(result);
  } catch (error: any) {
    console.error('mergeDuplicateProductsBySku:', error);
    return res.status(500).json({ message: 'Error fusionando duplicados', error: error?.message });
  }
};

/** Exportar inventario completo: productos + variantes + stock (para Excel en frontend). */
export const exportInventory = async (req: Request, res: Response) => {
  try {
    const rows = await query(`
      SELECT
        p.sku AS product_sku,
        p.name AS product_name,
        p.category,
        p.base_price,
        pv.sku AS variant_sku,
        s.size_code,
        s.name AS size_name,
        c.code AS color_code,
        c.name AS color_name,
        COALESCE(st.stock, 0) AS stock
      FROM products p
      JOIN product_colors pc ON pc.product_id = p.id
      JOIN colors c ON c.id = pc.color_id
      JOIN product_variants pv ON pv.product_color_id = pc.id
      JOIN sizes s ON s.id = pv.size_id
      LEFT JOIN stocks st ON st.variant_id = pv.id
      ORDER BY p.sku, s.size_code, c.code
    `);
    const withTalleLabel = (rows || []).map((r: any) => ({
      ...r,
      talle_display: nombreTalleDesdeCodigo(r.size_code) || r.size_name || r.size_code,
    }));
    res.json({ rows: withTalleLabel });
  } catch (error: any) {
    console.error('Export inventory:', error);
    res.status(500).json({ message: 'Error exportando inventario', error: error?.message });
  }
};

/** Listar publicaciones vinculadas a una variante (variant_publications) */
export const getVariantPublications = async (req: Request, res: Response) => {
  const { variantId } = req.params;
  if (!variantId) return res.status(400).json({ message: 'variantId requerido' });
  try {
    const exists = await get('SELECT id FROM product_variants WHERE id = ?', [variantId]);
    if (!exists) return res.status(404).json({ message: 'Variante no encontrada' });
    const rows = await query(
      `SELECT id, platform, external_product_id, external_variant_id, pack_size, created_at FROM variant_publications WHERE variant_id = ? ORDER BY platform, external_product_id`,
      [variantId]
    );
    res.json(rows || []);
  } catch (error: any) {
    console.error('getVariantPublications:', error);
    res.status(500).json({ message: 'Error listando publicaciones' });
  }
};

/** Agregar una publicación a una variante */
export const addVariantPublication = async (req: Request, res: Response) => {
  const { variantId } = req.params;
  const { platform, externalProductId, externalVariantId, packSize } = req.body as {
    platform: 'mercadolibre' | 'tiendanube';
    externalProductId: string;
    externalVariantId?: string;
    packSize?: number;
  };
  if (!variantId || !platform || !externalProductId) {
    return res.status(400).json({ message: 'variantId, platform y externalProductId son requeridos' });
  }
  if (platform !== 'mercadolibre' && platform !== 'tiendanube') {
    return res.status(400).json({ message: 'platform debe ser mercadolibre o tiendanube' });
  }
  const extVariantId = (externalVariantId != null && String(externalVariantId).trim() !== '') ? String(externalVariantId).trim() : '';
  const pack = Math.max(1, Math.floor(Number(packSize) || 1));
  try {
    const exists = await get('SELECT id FROM product_variants WHERE id = ?', [variantId]);
    if (!exists) return res.status(404).json({ message: 'Variante no encontrada' });
    const id = uuidv4();
    await execute(
      `INSERT INTO variant_publications (id, variant_id, platform, external_product_id, external_variant_id, pack_size) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, variantId, platform, String(externalProductId).trim(), extVariantId, pack]
    );
    const row = await get(
      'SELECT id, variant_id, platform, external_product_id, external_variant_id, pack_size, created_at FROM variant_publications WHERE id = ?',
      [id]
    );
    res.status(201).json(row);
  } catch (error: any) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Esa publicación ya está vinculada a esta variante' });
    }
    console.error('addVariantPublication:', error);
    res.status(500).json({ message: 'Error agregando publicación' });
  }
};

/** Eliminar una publicación de una variante */
export const deleteVariantPublication = async (req: Request, res: Response) => {
  const { variantId, publicationId } = req.params;
  if (!variantId || !publicationId) return res.status(400).json({ message: 'variantId y publicationId requeridos' });
  try {
    const result = await execute(
      'DELETE FROM variant_publications WHERE id = ? AND variant_id = ?',
      [publicationId, variantId]
    );
    const deleted = (result as any)?.affectedRows || 0;
    if (deleted === 0) {
      return res.status(404).json({ message: 'Publicación no encontrada o no pertenece a esta variante' });
    }
    res.json({ deleted: true });
  } catch (error: any) {
    console.error('deleteVariantPublication:', error);
    res.status(500).json({ message: 'Error eliminando publicación' });
  }
};
