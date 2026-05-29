import { Request, Response } from 'express';
import { query, execute, get } from '../database/db';
import { v4 as uuidv4 } from 'uuid';

/** Aplica ajuste porcentual (+10 = 10% más, -5 = 5% menos). */
function priceWithPercentAdjust(basePrice: number, percentAdjust?: number | null): number {
  const base = Number(basePrice);
  if (!Number.isFinite(base) || base < 0) return 0;
  const pct = percentAdjust != null && Number.isFinite(Number(percentAdjust)) ? Number(percentAdjust) : 0;
  if (pct === 0) return Math.round(base * 100) / 100;
  const factor = 1 + pct / 100;
  const next = Math.round(base * factor * 100) / 100;
  return next > 0 ? next : 0;
}

async function copyPriceListItems(
  sourceListId: string,
  targetListId: string,
  percentAdjust?: number | null
): Promise<number> {
  const items = await query(
    `SELECT product_id AS productId, price FROM price_list_items WHERE price_list_id = ?`,
    [sourceListId]
  );
  let count = 0;
  for (const it of items || []) {
    const productId = it?.productId;
    const price = priceWithPercentAdjust(Number(it?.price), percentAdjust);
    if (!productId || !Number.isFinite(price) || price <= 0) continue;
    await execute(
      `INSERT INTO price_list_items (id, price_list_id, product_id, price) VALUES (?, ?, ?, ?)`,
      [uuidv4(), targetListId, productId, price]
    );
    count++;
  }
  return count;
}

/** Listar listas de precios. Solo ADMIN. */
export const listPriceLists = async (req: Request, res: Response) => {
  try {
    if ((req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Solo administradores pueden listar listas de precios' });
    }
    const rows = await query(
      `SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt FROM price_lists ORDER BY name`
    );
    res.json(rows || []);
  } catch (error: any) {
    console.error('listPriceLists:', error);
    res.status(500).json({ message: 'Error listando listas de precios' });
  }
};

/** Obtener una lista con sus ítems (product_id y price). Solo ADMIN. */
export const getPriceList = async (req: Request, res: Response) => {
  try {
    if ((req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Solo administradores pueden ver listas de precios' });
    }
    const { id } = req.params;
    const list = await get(
      `SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt FROM price_lists WHERE id = ?`,
      [id]
    );
    if (!list) return res.status(404).json({ message: 'Lista de precios no encontrada' });
    const items = await query(
      `SELECT id, product_id AS productId, price FROM price_list_items WHERE price_list_id = ? ORDER BY product_id`,
      [id]
    );
    res.json({ ...list, items: items || [] });
  } catch (error: any) {
    console.error('getPriceList:', error);
    res.status(500).json({ message: 'Error obteniendo lista de precios' });
  }
};

/** Crear lista de precios. Solo ADMIN. */
export const createPriceList = async (req: Request, res: Response) => {
  try {
    if ((req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Solo administradores pueden crear listas de precios' });
    }
    const { name, description, sourceListId, percentAdjust } = req.body as {
      name?: string;
      description?: string;
      sourceListId?: string;
      percentAdjust?: number;
    };
    if (!name?.trim()) {
      return res.status(400).json({ message: 'El nombre es requerido' });
    }
    const sourceId = sourceListId?.trim() || null;
    if (sourceId) {
      const source = await get('SELECT id FROM price_lists WHERE id = ?', [sourceId]);
      if (!source) return res.status(404).json({ message: 'Lista origen no encontrada' });
    }
    const id = uuidv4();
    await execute(
      `INSERT INTO price_lists (id, name, description) VALUES (?, ?, ?)`,
      [id, name.trim(), (description ?? '').toString().trim() || null]
    );
    let itemsCopied = 0;
    if (sourceId) {
      itemsCopied = await copyPriceListItems(sourceId, id, percentAdjust);
    }
    const created = await get(
      `SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt FROM price_lists WHERE id = ?`,
      [id]
    );
    res.status(201).json({ ...created, itemsCopied, percentAdjust: percentAdjust ?? 0 });
  } catch (error: any) {
    console.error('createPriceList:', error);
    res.status(500).json({ message: 'Error creando lista de precios' });
  }
};

/** Actualizar lista de precios (nombre/descripción). Solo ADMIN. */
export const updatePriceList = async (req: Request, res: Response) => {
  try {
    if ((req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Solo administradores pueden editar listas de precios' });
    }
    const { id } = req.params;
    const { name, description } = req.body as { name?: string; description?: string };
    const existing = await get('SELECT id FROM price_lists WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ message: 'Lista de precios no encontrada' });
    if (name !== undefined) {
      await execute(`UPDATE price_lists SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [name.trim(), id]);
    }
    if (description !== undefined) {
      await execute(`UPDATE price_lists SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [description.trim() || null, id]);
    }
    const updated = await get(
      `SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt FROM price_lists WHERE id = ?`,
      [id]
    );
    res.json(updated);
  } catch (error: any) {
    console.error('updatePriceList:', error);
    res.status(500).json({ message: 'Error actualizando lista de precios' });
  }
};

/** Eliminar lista de precios. Solo ADMIN. */
export const deletePriceList = async (req: Request, res: Response) => {
  try {
    if ((req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Solo administradores pueden eliminar listas de precios' });
    }
    const { id } = req.params;
    const existing = await get('SELECT id FROM price_lists WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ message: 'Lista de precios no encontrada' });
    await execute('DELETE FROM price_lists WHERE id = ?', [id]);
    res.json({ message: 'Lista de precios eliminada', id });
  } catch (error: any) {
    console.error('deletePriceList:', error);
    res.status(500).json({ message: 'Error eliminando lista de precios' });
  }
};

/** Obtener ítems de una lista (product_id, price y opcionalmente nombre/sku del producto). Solo ADMIN. */
export const getPriceListItems = async (req: Request, res: Response) => {
  try {
    if ((req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Solo administradores pueden ver ítems de listas de precios' });
    }
    const { id } = req.params;
    const exists = await get('SELECT id FROM price_lists WHERE id = ?', [id]);
    if (!exists) return res.status(404).json({ message: 'Lista de precios no encontrada' });
    const items = await query(
      `SELECT pli.id, pli.product_id AS productId, pli.price, p.sku, p.name
       FROM price_list_items pli
       JOIN products p ON p.id = pli.product_id
       WHERE pli.price_list_id = ?
       ORDER BY p.sku`,
      [id]
    );
    res.json(items || []);
  } catch (error: any) {
    console.error('getPriceListItems:', error);
    res.status(500).json({ message: 'Error obteniendo ítems de la lista' });
  }
};

/** Reemplazar ítems de una lista (array de { productId, price }). Solo ADMIN. */
export const setPriceListItems = async (req: Request, res: Response) => {
  try {
    if ((req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Solo administradores pueden editar ítems de listas de precios' });
    }
    const { id } = req.params;
    const items = req.body as Array<{ productId: string; price: number }>;
    const exists = await get('SELECT id FROM price_lists WHERE id = ?', [id]);
    if (!exists) return res.status(404).json({ message: 'Lista de precios no encontrada' });
    if (!Array.isArray(items)) {
      return res.status(400).json({ message: 'Se espera un array de { productId, price }' });
    }
    await execute('DELETE FROM price_list_items WHERE price_list_id = ?', [id]);
    for (const it of items) {
      const productId = it?.productId;
      const price = Number(it?.price);
      if (!productId || isNaN(price) || price < 0) continue;
      const itemId = uuidv4();
      await execute(
        `INSERT INTO price_list_items (id, price_list_id, product_id, price) VALUES (?, ?, ?, ?)`,
        [itemId, id, productId, price]
      );
    }
    const updated = await query(
      `SELECT product_id AS productId, price FROM price_list_items WHERE price_list_id = ? ORDER BY product_id`,
      [id]
    );
    res.json({ items: updated || [] });
  } catch (error: any) {
    console.error('setPriceListItems:', error);
    res.status(500).json({ message: 'Error guardando ítems de la lista' });
  }
};

/** Crear varias listas de precios de una vez. Body: { names: string[] } o { names: string, description?: string }[]. Solo ADMIN. */
export const createPriceListsBulk = async (req: Request, res: Response) => {
  try {
    if ((req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Solo administradores pueden crear listas de precios' });
    }
    const body = req.body as { names?: string[]; lists?: { name: string; description?: string }[] };
    const lists: { name: string; description?: string }[] = body.lists?.length
      ? body.lists
      : Array.isArray(body.names)
        ? body.names.map((n: string) => ({ name: String(n).trim(), description: undefined }))
        : [];
    const toCreate = lists.filter(l => l.name.length > 0);
    if (toCreate.length === 0) {
      return res.status(400).json({ message: 'Enviá al menos un nombre de lista (names o lists)' });
    }
    const created: any[] = [];
    for (const { name, description } of toCreate) {
      const id = uuidv4();
      await execute(
        `INSERT INTO price_lists (id, name, description) VALUES (?, ?, ?)`,
        [id, name, (description ?? '').toString().trim() || null]
      );
      const row = await get(
        `SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt FROM price_lists WHERE id = ?`,
        [id]
      );
      created.push(row);
    }
    res.status(201).json({ created, count: created.length });
  } catch (error: any) {
    console.error('createPriceListsBulk:', error);
    res.status(500).json({ message: 'Error creando listas de precios' });
  }
};

/** Duplicar una lista (nueva lista con el mismo nombre + sufijo y los mismos ítems). Body: { name: string }. Solo ADMIN. */
export const duplicatePriceList = async (req: Request, res: Response) => {
  try {
    if ((req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Solo administradores pueden duplicar listas de precios' });
    }
    const { id } = req.params;
    const { name, percentAdjust } = req.body as { name?: string; percentAdjust?: number };
    if (!name?.trim()) return res.status(400).json({ message: 'El nombre de la nueva lista es requerido' });
    const source = await get('SELECT id, name FROM price_lists WHERE id = ?', [id]);
    if (!source) return res.status(404).json({ message: 'Lista de precios no encontrada' });
    const newId = uuidv4();
    await execute(
      `INSERT INTO price_lists (id, name, description) VALUES (?, ?, NULL)`,
      [newId, name.trim()]
    );
    const itemsCopied = await copyPriceListItems(id, newId, percentAdjust);
    const created = await get(
      `SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt FROM price_lists WHERE id = ?`,
      [newId]
    );
    res.status(201).json({ ...created, itemsCopied, percentAdjust: percentAdjust ?? 0 });
  } catch (error: any) {
    console.error('duplicatePriceList:', error);
    res.status(500).json({ message: 'Error duplicando la lista' });
  }
};

/** Rellenar lista con todos los productos del catálogo (precio base * multiplier). Body: { multiplier?: number }. Solo ADMIN. */
export const fillPriceListFromBase = async (req: Request, res: Response) => {
  try {
    if ((req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Solo administradores pueden rellenar listas' });
    }
    const { id } = req.params;
    const multiplier = Number((req.body as { multiplier?: number }).multiplier);
    const factor = isNaN(multiplier) || multiplier <= 0 ? 1 : multiplier;
    const exists = await get('SELECT id FROM price_lists WHERE id = ?', [id]);
    if (!exists) return res.status(404).json({ message: 'Lista de precios no encontrada' });
    const products = await query(
      `SELECT
         p.id,
         COALESCE(
           NULLIF(p.base_price, 0),
           (
             SELECT MAX(pli.price)
             FROM price_list_items pli
             WHERE pli.product_id = p.id AND pli.price > 0
           ),
           0
         ) AS source_price
       FROM products p`
    );
    await execute('DELETE FROM price_list_items WHERE price_list_id = ?', [id]);
    let count = 0;
    let skippedWithoutBase = 0;
    for (const p of products || []) {
      const source = Number((p as any).source_price ?? 0);
      if (!Number.isFinite(source) || source <= 0) {
        skippedWithoutBase++;
        continue;
      }
      const price = Math.round(source * factor * 100) / 100;
      if (!Number.isFinite(price) || price <= 0) {
        skippedWithoutBase++;
        continue;
      }
      await execute(
        `INSERT INTO price_list_items (id, price_list_id, product_id, price) VALUES (?, ?, ?, ?)`,
        [uuidv4(), id, p.id, price]
      );
      count++;
    }
    const items = await query(
      `SELECT product_id AS productId, price FROM price_list_items WHERE price_list_id = ? ORDER BY product_id`,
      [id]
    );
    res.json({ items: items || [], count, skippedWithoutBase });
  } catch (error: any) {
    console.error('fillPriceListFromBase:', error);
    res.status(500).json({ message: 'Error rellenando la lista' });
  }
};

/** Reemplazar ítems por SKU. Body: { items: { sku: string; price: number }[] }. Solo ADMIN. */
export const setPriceListItemsBySku = async (req: Request, res: Response) => {
  try {
    if ((req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Solo administradores pueden editar ítems de listas de precios' });
    }
    const { id } = req.params;
    const body = req.body as { items?: Array<{ sku: string; price: number }> };
    const input = Array.isArray(body?.items) ? body.items : [];
    const exists = await get('SELECT id FROM price_lists WHERE id = ?', [id]);
    if (!exists) return res.status(404).json({ message: 'Lista de precios no encontrada' });
    const resolved: { productId: string; price: number }[] = [];
    const notFound: string[] = [];
    const normalizeSku = (s: string) => String(s).replace(/[-/\s]/g, '').trim();
    const escapeLike = (s: string) => String(s).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const padArticleCodeTo7 = (s: string) => { const d = String(s).replace(/\D/g, ''); return d ? (d.length <= 7 ? d.padStart(7, '0') : d) : ''; };
    for (const it of input) {
      const sku = String(it?.sku ?? '').trim();
      const price = Number(it?.price);
      if (!sku || isNaN(price) || price < 0) continue;
      let productId: string | undefined;
      const byBase = await get(`SELECT id FROM products WHERE sku = ?`, [sku]);
      if (byBase?.id) productId = byBase.id;
      if (!productId) {
        const byVariant = await get(
          `SELECT pc.product_id AS id FROM product_variants pv
           JOIN product_colors pc ON pc.id = pv.product_color_id
           WHERE pv.sku = ?
           LIMIT 1`,
          [sku]
        );
        if (byVariant?.id) productId = byVariant.id;
      }
      if (!productId) {
        const padded = padArticleCodeTo7(sku);
        if (padded && padded !== sku) {
          const byBasePadded = await get(`SELECT id FROM products WHERE sku = ?`, [padded]);
          if (byBasePadded?.id) productId = byBasePadded.id;
        }
      }
      if (!productId) {
        const padded = padArticleCodeTo7(sku);
        if (padded && padded !== sku) {
          const byVarPadded = await get(
            `SELECT pc.product_id AS id FROM product_variants pv
             JOIN product_colors pc ON pc.id = pv.product_color_id
             WHERE pv.sku = ?
             LIMIT 1`,
            [padded]
          );
          if (byVarPadded?.id) productId = byVarPadded.id;
        }
      }
      if (!productId) {
        const normalized = normalizeSku(sku);
        if (normalized) {
          const byBaseNorm = await get(
            `SELECT id FROM products WHERE REPLACE(REPLACE(REPLACE(sku, '-', ''), '/', ''), CHAR(32), '') = ?`,
            [normalized]
          );
          if (byBaseNorm?.id) productId = byBaseNorm.id;
        }
      }
      if (!productId) {
        const normalized = normalizeSku(sku);
        if (normalized) {
          const byVarNorm = await get(
            `SELECT pc.product_id AS id FROM product_variants pv
             JOIN product_colors pc ON pc.id = pv.product_color_id
             WHERE REPLACE(REPLACE(REPLACE(pv.sku, '-', ''), '/', ''), CHAR(32), '') = ?
             LIMIT 1`,
            [normalized]
          );
          if (byVarNorm?.id) productId = byVarNorm.id;
        }
      }
      if (!productId) {
        const normalized = normalizeSku(sku);
        if (normalized) {
          const pattern = escapeLike(normalized) + '%';
          const byBaseStarts = await get(
            `SELECT id FROM products WHERE REPLACE(REPLACE(REPLACE(sku, '-', ''), '/', ''), CHAR(32), '') LIKE ? LIMIT 1`,
            [pattern]
          );
          if (byBaseStarts?.id) productId = byBaseStarts.id;
        }
      }
      if (!productId) {
        const normalized = normalizeSku(sku);
        if (normalized) {
          const pattern = escapeLike(normalized) + '%';
          const byVarStarts = await get(
            `SELECT pc.product_id AS id FROM product_variants pv
             JOIN product_colors pc ON pc.id = pv.product_color_id
             WHERE REPLACE(REPLACE(REPLACE(pv.sku, '-', ''), '/', ''), CHAR(32), '') LIKE ?
             LIMIT 1`,
            [pattern]
          );
          if (byVarStarts?.id) productId = byVarStarts.id;
        }
      }
      if (productId) resolved.push({ productId, price });
      else notFound.push(sku);
    }
    await execute('DELETE FROM price_list_items WHERE price_list_id = ?', [id]);
    const byProduct = new Map<string, number>();
    for (const it of resolved) byProduct.set(it.productId, it.price);
    for (const [productId, price] of byProduct) {
      await execute(
        `INSERT INTO price_list_items (id, price_list_id, product_id, price) VALUES (?, ?, ?, ?)`,
        [uuidv4(), id, productId, price]
      );
    }
    const items = await query(
      `SELECT product_id AS productId, price FROM price_list_items WHERE price_list_id = ? ORDER BY product_id`,
      [id]
    );
    res.json({ items: items || [], imported: byProduct.size, notFound: notFound.length ? notFound : undefined });
  } catch (error: any) {
    console.error('setPriceListItemsBySku:', error);
    res.status(500).json({ message: 'Error importando por SKU' });
  }
};
