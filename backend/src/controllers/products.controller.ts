import { Request, Response } from 'express';
import { query, execute, get } from '../database/db';
import { Product } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { updateMercadoLibreStock } from './integrations.controller';

export const getProducts = async (req: Request, res: Response) => {
  try {
    const { page = '1', per_page = '20', q = '', sort = 'sku', dir = 'asc' } = req.query as any;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const perPageNum = Math.min(100, Math.max(1, parseInt(per_page as string, 10) || 20));
    const offset = (pageNum - 1) * perPageNum;
    const sortCol = (sort === 'stock' ? 'stock_total' : sort === 'name' ? 'name' : 'sku');
    const sortDir = (dir === 'desc' ? 'DESC' : 'ASC');
    const search = (q || '').toString().trim();

    const whereClause = search ? `WHERE p.sku LIKE ? OR p.name LIKE ?` : '';
    const params: any[] = [];
    if (search) {
      params.push(`%${search}%`, `%${search}%`);
    }

    const totalRow = await get(
      `
      SELECT COUNT(*) AS total
      FROM products p
      ${whereClause}
      `,
      params
    );
    const total = Number(totalRow?.total || 0);

    const rows = await query(
      `
      SELECT p.id, p.sku, p.name, p.category, p.base_price,
             p.tienda_nube_id, p.mercado_libre_id,
             COALESCE(SUM(st.stock), 0) AS stock_total
      FROM products p
      LEFT JOIN product_colors pc ON pc.product_id = p.id
      LEFT JOIN product_variants pv ON pv.product_color_id = pc.id
      LEFT JOIN stocks st ON st.variant_id = pv.id
      ${whereClause}
      GROUP BY p.id, p.sku, p.name, p.category, p.base_price, p.tienda_nube_id, p.mercado_libre_id
      ORDER BY ${sortCol} ${sortDir}
      LIMIT ? OFFSET ?
      `,
      [...params, perPageNum, offset]
    );
    
    const mapped = rows.map((r: any) => ({
      id: r.id,
      sku: r.sku,
      name: r.name,
      category: r.category,
      base_price: Number(r.base_price ?? 0),
      stock_total: Number(r.stock_total ?? 0),
      externalIds: {
        tiendaNube: r.tienda_nube_id,
        mercadoLibre: r.mercado_libre_id
      }
    }));
    
    res.json({ items: mapped, page: pageNum, per_page: perPageNum, total });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching products" });
  }
};

export const createProduct = async (req: any, res: any) => {
  const newProduct: Product = req.body;
  
  if (!newProduct.sku || !newProduct.name) {
    return res.status(400).json({ message: "SKU y Nombre son requeridos" });
  }

  const id = uuidv4();

  try {
    await execute(
      `INSERT INTO products (id, sku, name, category, base_price, description) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, newProduct.sku, newProduct.name, newProduct.category, newProduct.base_price, newProduct.description]
    );
    res.status(201).json({ id, sku: newProduct.sku, name: newProduct.name, category: newProduct.category, base_price: newProduct.base_price, description: newProduct.description });
  } catch (error: any) {
    console.error(error);
    // MySQL error code for Duplicate Entry is 1062 or code 'ER_DUP_ENTRY'
    if (error.code === 'ER_DUP_ENTRY' || error.message.includes('Duplicate entry')) {
      return res.status(409).json({ message: "El SKU ya existe" });
    }
    res.status(500).json({ message: "Error creating product" });
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

export const getProductBySku = async (req: any, res: any) => {
  const { sku } = req.params;
  try {
    const product = await get(
      `SELECT p.id, p.sku, p.name, p.category, p.base_price, p.tienda_nube_id, p.mercado_libre_id FROM products p WHERE p.sku = ?`,
      [sku]
    );
    if (!product) return res.status(404).json({ message: 'Producto no encontrado' });
    
    const variantsRows = await query(
      `SELECT p.sku, c.code AS color_code, c.name AS color_name,
              s.size_code, COALESCE(st.stock,0) AS stock, pv.id AS variant_id,
              pv.tienda_nube_variant_id, pv.mercado_libre_variant_id
       FROM products p
       JOIN product_colors pc ON pc.product_id=p.id
       JOIN colors c ON c.id=pc.color_id
       JOIN product_variants pv ON pv.product_color_id=pc.id
       JOIN sizes s ON s.id=pv.size_id
       LEFT JOIN stocks st ON st.variant_id=pv.id
       WHERE p.sku=?
       ORDER BY c.code, s.size_code`,
      [sku]
    );
    
    const variants = variantsRows.map((v: any) => ({
      ...v,
      externalIds: {
        tiendaNubeVariant: v.tienda_nube_variant_id,
        mercadoLibreVariant: v.mercado_libre_variant_id
      }
    }));

    const stock_total = await getProductStockTotalBySku(sku);
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
    await execute(
      `INSERT INTO stocks(variant_id, stock) VALUES (?,?)
       ON DUPLICATE KEY UPDATE stock = VALUES(stock)`,
      [vId, stock]
    );
    let targetSku = sku || null;
    if (!targetSku) {
      const row = await get(
        `SELECT p.sku AS sku
         FROM products p
         JOIN product_colors pc ON pc.product_id = p.id
         JOIN product_variants pv ON pv.product_color_id = pc.id
         WHERE pv.id = ?`,
        [vId]
      );
      targetSku = row?.sku || null;
    }
    if (targetSku) {
      updateMercadoLibreStock(targetSku, Number(stock)).catch(() => {});
    }
    res.json({ variantId: vId, stock });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error actualizando stock' });
  }
};

export const updateProduct = async (req: any, res: any) => {
  const { id } = req.params;
  const { name, category, base_price, description } = req.body as { name?: string; category?: string; base_price?: number; description?: string };
  if (!id) return res.status(400).json({ message: 'ID inválido' });
  try {
    await execute(
      `UPDATE products SET 
         name = COALESCE(?, name),
         category = COALESCE(?, category),
         base_price = COALESCE(?, base_price),
         description = COALESCE(?, description)
       WHERE id = ?`,
      [name ?? null, category ?? null, base_price ?? null, description ?? null, id]
    );
    const updated = await get(`SELECT id, sku, name, category, base_price, description FROM products WHERE id = ?`, [id]);
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
  if (!id) return res.status(400).json({ message: 'ID inválido' });

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
  const { tiendaNubeVariantId, mercadoLibreVariantId } = req.body;
  if (!variantId) return res.status(400).json({ message: 'ID de variante inválido' });

  try {
    await execute(
      `UPDATE product_variants SET 
         tienda_nube_variant_id = COALESCE(?, tienda_nube_variant_id),
         mercado_libre_variant_id = COALESCE(?, mercado_libre_variant_id)
       WHERE id = ?`,
      [tiendaNubeVariantId ?? null, mercadoLibreVariantId ?? null, variantId]
    );
    res.json({ variantId, tiendaNubeVariantId, mercadoLibreVariantId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error actualizando IDs externos de variante' });
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
