import { Request, Response } from 'express';
import { query, execute, get } from '../database/db';
import { v4 as uuidv4 } from 'uuid';

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
    const { name, description } = req.body as { name?: string; description?: string };
    if (!name?.trim()) {
      return res.status(400).json({ message: 'El nombre es requerido' });
    }
    const id = uuidv4();
    await execute(
      `INSERT INTO price_lists (id, name, description) VALUES (?, ?, ?)`,
      [id, name.trim(), (description ?? '').toString().trim() || null]
    );
    const created = await get(
      `SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt FROM price_lists WHERE id = ?`,
      [id]
    );
    res.status(201).json(created);
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
