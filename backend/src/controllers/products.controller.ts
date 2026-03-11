import { Request, Response } from 'express';
import axios from 'axios';
import { query, execute, get } from '../database/db';
import { Product } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { nombreTalleDesdeCodigo } from '../talles-tango';

export const getProducts = async (req: Request, res: Response) => {
  try {
    const { page = '1', per_page = '20', q = '', sort = 'sku', dir = 'asc', sync_ml, sync_tn, sync_none, skip_total, price_list_id } = req.query as any;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const perPageNum = Math.min(5000, Math.max(1, parseInt(per_page as string, 10) || 20));
    const offset = (pageNum - 1) * perPageNum;
    const sortCol = (sort === 'stock' ? 'stock_total' : sort === 'name' ? 'p.name' : 'pv.sku');
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
             p.tienda_nube_id, p.mercado_libre_id,
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
      ORDER BY ${sortCol} ${sortDir}
      LIMIT ? OFFSET ?
      `,
      [...priceParams, ...params, perPageNum, offset]
    );

    const mapped = (rows || []).map((r: any) => ({
      id: r.id,
      sku: r.sku,
      base_sku: r.base_sku,
      product_id: r.product_id,
      name: r.name,
      category: r.category,
      base_price: Number(r.base_price ?? 0),
      stock_total: Number(r.stock_total ?? 0),
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
    } else if (sku.length >= 13 && !sku.includes('-')) {
      const parsed = parseCodigoTango(sku);
      if (parsed.codigo13.length >= 13) {
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
        `SELECT id FROM product_variants WHERE product_color_id = ? AND size_id = ?`,
        [productColorId, sizeId]
      );
      if (existingVariant) {
        return res.status(409).json({ message: "La variante ya existe para este artículo, talle y color." });
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
              COALESCE(tienda_nube_pack_size, 1) AS tienda_nube_pack_size
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

export const getProductBySku = async (req: any, res: any) => {
  const { sku } = req.params;
  try {
    // Buscar por SKU exacto o por SKU base (para agrupar variantes)
    let product = await get(
      `SELECT p.id, p.sku, p.name, p.category, p.base_price, p.tienda_nube_id, p.mercado_libre_id,
              COALESCE(p.mercado_libre_pack_size, 1) AS mercado_libre_pack_size,
              COALESCE(p.tienda_nube_pack_size, 1) AS tienda_nube_pack_size
       FROM products p WHERE p.sku = ?`,
      [sku]
    );
    
    // Si no se encuentra exacto, buscar por SKU base
    if (!product) {
      product = await get(
        `SELECT p.id, p.sku, p.name, p.category, p.base_price, p.tienda_nube_id, p.mercado_libre_id,
                COALESCE(p.mercado_libre_pack_size, 1) AS mercado_libre_pack_size,
                COALESCE(p.tienda_nube_pack_size, 1) AS tienda_nube_pack_size
         FROM products p WHERE p.sku LIKE ? ORDER BY p.sku LIMIT 1`,
        [`${sku}-%`]
      );
    }
    
    if (!product) return res.status(404).json({ message: 'Producto no encontrado' });
    
    // Obtener todas las variantes del producto encontrado
    const variantsRows = await query(
      `SELECT p.sku, pv.sku AS variant_sku, pv.external_sku,
              c.code AS color_code, c.name AS color_name,
              s.size_code, COALESCE(st.stock,0) AS stock, pv.id AS variant_id,
              pv.tienda_nube_variant_id, pv.mercado_libre_variant_id, pv.mercado_libre_item_id
       FROM products p
       JOIN product_colors pc ON pc.product_id=p.id
       JOIN colors c ON c.id=pc.color_id
       JOIN product_variants pv ON pv.product_color_id=pc.id
       JOIN sizes s ON s.id=pv.size_id
       LEFT JOIN stocks st ON st.variant_id=pv.id
       WHERE p.id=?
       ORDER BY c.code, s.size_code`,
      [product.id]
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
  const { name, category, base_price, description, mercadoLibrePackSize, tiendaNubePackSize } = req.body as {
    name?: string; category?: string; base_price?: number; description?: string;
    mercadoLibrePackSize?: number; tiendaNubePackSize?: number;
  };
  if (!id) return res.status(400).json({ message: 'ID inv?lido' });
  try {
    const mlPack = mercadoLibrePackSize != null ? Math.max(1, Math.floor(Number(mercadoLibrePackSize))) : null;
    const tnPack = tiendaNubePackSize != null ? Math.max(1, Math.floor(Number(tiendaNubePackSize))) : null;
    await execute(
      `UPDATE products SET 
         name = COALESCE(?, name),
         category = COALESCE(?, category),
         base_price = COALESCE(?, base_price),
         description = COALESCE(?, description),
         mercado_libre_pack_size = COALESCE(?, mercado_libre_pack_size),
         tienda_nube_pack_size = COALESCE(?, tienda_nube_pack_size)
       WHERE id = ?`,
      [name ?? null, category ?? null, base_price ?? null, description ?? null, mlPack, tnPack, id]
    );
    const updated = await get(`SELECT id, sku, name, category, base_price, description,
      COALESCE(mercado_libre_pack_size, 1) AS mercado_libre_pack_size,
      COALESCE(tienda_nube_pack_size, 1) AS tienda_nube_pack_size FROM products WHERE id = ?`, [id]);
    if (!updated) return res.status(404).json({ message: 'Producto no encontrado' });
    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error actualizando producto' });
  }
};

export const updateProductExternalIds = async (req: any, res: any) => {
  const { id } = req.params;
  const { tiendaNubeId, mercadoLibreId } = req.body;
  if (!id) return res.status(400).json({ message: 'ID inv?lido' });

  try {
    await execute(
      `UPDATE products SET 
         tienda_nube_id = COALESCE(?, tienda_nube_id),
         mercado_libre_id = COALESCE(?, mercado_libre_id)
       WHERE id = ?`,
      [tiendaNubeId ?? null, mercadoLibreId ?? null, id]
    );
    res.json({ id, tiendaNubeId, mercadoLibreId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error actualizando IDs externos del producto' });
  }
};

export const updateVariantExternalIds = async (req: any, res: any) => {
  const { variantId } = req.params;
  const { tiendaNubeVariantId, mercadoLibreVariantId, mercadoLibreItemId, externalSku } = req.body;
  if (!variantId) return res.status(400).json({ message: 'ID de variante inválido' });

  try {
    await execute(
      `UPDATE product_variants SET 
         tienda_nube_variant_id = COALESCE(?, tienda_nube_variant_id),
         mercado_libre_variant_id = COALESCE(?, mercado_libre_variant_id),
         mercado_libre_item_id = COALESCE(?, mercado_libre_item_id),
         external_sku = COALESCE(?, external_sku)
       WHERE id = ?`,
      [tiendaNubeVariantId ?? null, mercadoLibreVariantId ?? null, mercadoLibreItemId ?? null, externalSku !== undefined ? externalSku : null, variantId]
    );

    let stockFromML: number | null = null;
    const mlItemId = mercadoLibreItemId ?? null;
    const mlVariantId = mercadoLibreVariantId ?? null;

    if (mlItemId) {
      const productRow = await get(
        `SELECT p.id AS product_id FROM products p
         JOIN product_colors pc ON pc.product_id = p.id
         JOIN product_variants pv ON pv.product_color_id = pc.id
         WHERE pv.id = ? LIMIT 1`,
        [variantId]
      );
      if (productRow?.product_id) {
        await execute(
          `UPDATE products SET mercado_libre_id = COALESCE(?, mercado_libre_id) WHERE id = ?`,
          [mlItemId, productRow.product_id]
        );
      }

      const integration = await get(`SELECT access_token FROM integrations WHERE platform = 'mercadolibre'`);
      if (integration?.access_token) {
        try {
          const itemRes = await axios.get(
            `https://api.mercadolibre.com/items/${mlItemId}?include_attributes=all`,
            { headers: { Authorization: `Bearer ${integration.access_token}` } }
          );
          const item = itemRes.data;
          const variations = item?.variations || [];
          let qty = 0;
          if (variations.length > 0) {
            const v = mlVariantId
              ? variations.find((x: any) => String(x.id) === String(mlVariantId))
              : variations[0];
            qty = v ? (v.available_quantity ?? 0) : 0;
          } else {
            qty = item.available_quantity ?? 0;
          }
          await execute(
            `INSERT INTO stocks (variant_id, stock) VALUES (?, ?) ON DUPLICATE KEY UPDATE stock = VALUES(stock)`,
            [variantId, qty]
          );
          stockFromML = qty;
        } catch (mlErr: any) {
          console.error('[updateVariantExternalIds] Error trayendo stock de ML:', mlErr?.response?.data || mlErr?.message);
        }
      }
    }

    res.json({
      variantId,
      tiendaNubeVariantId,
      mercadoLibreVariantId,
      mercadoLibreItemId: mercadoLibreItemId ?? undefined,
      externalSku: externalSku ?? undefined,
      stockFromML: stockFromML ?? undefined
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error actualizando IDs externos de variante' });
  }
};

/** Vinculaci?n en lote: actualiza IDs externos de varias variantes y opcionalmente el producto padre. No trae stock de ML. */
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
    const withTn = links.filter((l: any) => l.tiendaNubeVariantId != null && String(l.tiendaNubeVariantId) !== '').length;
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
      if (mercadoLibreItemId != null && mercadoLibreItemId !== '') {
        await execute(
          `UPDATE products SET mercado_libre_id = ? WHERE id = ?`,
          [String(mercadoLibreItemId), resolvedProductId]
        );
      }
    }
    for (const link of links) {
      const { variantId, mercadoLibreVariantId, mercadoLibreItemId: linkMlItemId, tiendaNubeVariantId, externalSku } = link;
      if (!variantId) continue;
      const mlVarId = (mercadoLibreVariantId != null && String(mercadoLibreVariantId).trim() !== '') ? String(mercadoLibreVariantId) : null;
      const mlItemId = (linkMlItemId != null && String(linkMlItemId).trim() !== '') ? String(linkMlItemId).trim() : null;
      await execute(
        `UPDATE product_variants SET
           tienda_nube_variant_id = COALESCE(?, tienda_nube_variant_id),
           mercado_libre_variant_id = COALESCE(?, mercado_libre_variant_id),
           mercado_libre_item_id = COALESCE(?, mercado_libre_item_id),
           external_sku = COALESCE(?, external_sku)
         WHERE id = ?`,
        [
          tiendaNubeVariantId != null && tiendaNubeVariantId !== '' ? String(tiendaNubeVariantId) : null,
          mlVarId,
          mlItemId,
          externalSku !== undefined && externalSku !== null ? String(externalSku) : null,
          variantId
        ]
      );
    }

    // Traer stock de Mercado Libre al inventario local (ML = fuente de verdad)
    let synced = 0;
    const parentMlItemId = (mercadoLibreItemId != null && String(mercadoLibreItemId).trim() !== '') ? String(mercadoLibreItemId).trim() : null;
    const integration = await get(`SELECT access_token FROM integrations WHERE platform = 'mercadolibre'`);
    if (integration?.access_token) {
      // Caso 1: variantes con publicación propia (cada una tiene mercadoLibreItemId en el link)
      for (const link of links) {
        const perItemId = (link as any).mercadoLibreItemId != null && String((link as any).mercadoLibreItemId).trim() !== '' ? String((link as any).mercadoLibreItemId).trim() : null;
        if (!link.variantId || !perItemId) continue;
        try {
          const itemRes = await axios.get(
            `https://api.mercadolibre.com/items/${perItemId}?include_attributes=all`,
            { headers: { Authorization: `Bearer ${integration.access_token}` } }
          );
          const item = itemRes.data;
          const qty = item?.available_quantity ?? (item?.variations?.[0]?.available_quantity ?? 0);
          await execute(
            `INSERT INTO stocks (variant_id, stock) VALUES (?, ?) ON DUPLICATE KEY UPDATE stock = VALUES(stock)`,
            [link.variantId, qty]
          );
          synced++;
        } catch (err: any) {
          console.warn('[bulkLinkVariants] Error trayendo ítem ML (publicación propia)', link.variantId, perItemId, err?.message);
        }
      }
      // Caso 2: publicación padre con variaciones (mismo ID para todas)
      if (parentMlItemId && links.some(l => l.mercadoLibreVariantId != null && String(l.mercadoLibreVariantId) !== '')) {
        try {
          const itemRes = await axios.get(
            `https://api.mercadolibre.com/items/${parentMlItemId}?include_attributes=all`,
            { headers: { Authorization: `Bearer ${integration.access_token}` } }
          );
          const item = itemRes.data;
          const variations = item?.variations || [];
          const hasVariations = variations.length > 0;
          for (const link of links) {
            const hasMl = link.mercadoLibreVariantId != null && String(link.mercadoLibreVariantId) !== '';
            const hasPerItem = (link as any).mercadoLibreItemId != null && String((link as any).mercadoLibreItemId).trim() !== '';
            if (!link.variantId || !hasMl || hasPerItem) continue;
            try {
              let qty = 0;
              if (hasVariations) {
                const v = variations.find((x: any) => String(x.id) === String(link.mercadoLibreVariantId));
                qty = v ? (v.available_quantity ?? 0) : 0;
              } else {
                qty = item.available_quantity ?? 0;
              }
              await execute(
                `INSERT INTO stocks (variant_id, stock) VALUES (?, ?) ON DUPLICATE KEY UPDATE stock = VALUES(stock)`,
                [link.variantId, qty]
              );
              synced++;
            } catch (err: any) {
              console.warn('[bulkLinkVariants] Error actualizando stock local desde ML para variante', link.variantId, ':', err?.message);
            }
          }
        } catch (mlErr: any) {
          console.warn('[bulkLinkVariants] Error trayendo ítem de ML:', mlErr?.response?.data || mlErr?.message);
        }
      }
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
              p.name AS product_name, p.sku AS base_sku,
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

/** Actualizar variante (SKU y/o external_sku) */
export const updateVariant = async (req: Request, res: Response) => {
  const { variantId } = req.params;
  const { sku, externalSku } = req.body as { sku?: string; externalSku?: string };
  if (!variantId) return res.status(400).json({ message: 'ID de variante requerido' });
  try {
    const updates: string[] = [];
    const values: any[] = [];
    if (sku !== undefined) {
      updates.push('sku = ?');
      values.push(sku === '' ? null : String(sku).trim());
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
    const updated = await get(
      `SELECT pv.id, pv.sku, pv.external_sku FROM product_variants pv WHERE pv.id = ?`,
      [variantId]
    );
    if (!updated) return res.status(404).json({ message: 'Variante no encontrada' });
    res.json(updated);
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

function parseCodigoTango(codigo: unknown): { articulo: string; talle: string; color: string; codigo13: string } {
  const raw = (codigo != null ? String(codigo).trim() : '');
  const s = raw.replace(/\D/g, '');
  return {
    articulo: s.slice(0, 7),
    talle: s.slice(7, 10),
    color: s.slice(10, 13),
    codigo13: s.slice(0, 13),
  };
}

export const importTangoArticles = async (req: Request, res: Response) => {
  try {
    const { rows: rawRows, onlyComplete = true } = req.body as {
      rows: Record<string, unknown>[];
      onlyComplete?: boolean;
    };
    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return res.status(400).json({ message: 'Se requiere un array "rows" con las filas del Excel (con columna C?digo y opcional Descripci?n).' });
    }
    const headers = Object.keys(rawRows[0] || {});
    const codigoCol = findColumn(headers, 'codigo');
    if (codigoCol < 0) {
      return res.status(400).json({ message: 'No se encontr? la columna "C?digo" en las filas enviadas.' });
    }
    const descCol = findColumn(headers, 'descripcion');
    const codigoKey = headers[codigoCol];
    const descKey = descCol >= 0 ? headers[descCol] : null;

    const rows: { articulo: string; talle: string; color: string; codigo13: string; descripcion: string }[] = [];
    for (const row of rawRows) {
      const codigo = row[codigoKey];
      const parsed = parseCodigoTango(codigo);
      if (parsed.codigo13.length < 13 && onlyComplete) continue;
      const descripcion = (descKey && row[descKey] != null ? String(row[descKey]).trim() : '') || parsed.articulo;
      rows.push({
        articulo: parsed.articulo,
        talle: parsed.talle,
        color: parsed.color,
        codigo13: parsed.codigo13,
        descripcion,
      });
    }

    let productsCreated = 0;
    let variantsCreated = 0;
    let variantsUpdated = 0;
    const errors: string[] = [];
    const productNamesByArticulo: Record<string, string> = {};

    for (const r of rows) {
      try {
        if (r.codigo13.length < 13) continue;
        if (!r.articulo) continue;

        if (!productNamesByArticulo[r.articulo] && r.descripcion) {
          productNamesByArticulo[r.articulo] = r.descripcion;
        }

        let productId: string | null = (await get(`SELECT id FROM products WHERE sku = ?`, [r.articulo]))?.id || null;
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
          await execute(`INSERT INTO colors (id, name, code, hex) VALUES (?, ?, ?, ?)`, [colorId, r.color, r.color, '#000000']);
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
        if (!existingVariant) {
          const variantId = uuidv4();
          await execute(
            `INSERT INTO product_variants (id, product_color_id, size_id, sku) VALUES (?, ?, ?, ?)`,
            [variantId, productColorId, sizeId, r.codigo13]
          );
          await execute(`INSERT INTO stocks (variant_id, stock) VALUES (?, 0) ON DUPLICATE KEY UPDATE stock = stock`, [variantId]);
          variantsCreated++;
        } else {
          await execute(`UPDATE product_variants SET sku = ? WHERE id = ?`, [r.codigo13, existingVariant.id]);
          variantsUpdated++;
        }
      } catch (err: any) {
        errors.push(`Fila ${r.codigo13}: ${err?.message || 'Error'}`);
      }
    }

    res.json({
      message: 'Importaci?n Tango finalizada',
      productsCreated,
      variantsCreated,
      variantsUpdated,
      totalProcessed: rows.filter((r) => r.codigo13.length >= 13).length,
      errors: errors.slice(0, 50),
    });
  } catch (error: any) {
    console.error('Import Tango:', error);
    res.status(500).json({ message: 'Error importando art?culos Tango', error: error?.message });
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
