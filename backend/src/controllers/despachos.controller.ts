import { Request, Response } from 'express';
import { query, execute, get } from '../database/db';
import { v4 as uuidv4 } from 'uuid';

// Obtener todos los despachos
export const getDespachos = async (req: Request, res: Response) => {
  try {
    const { estado, desde, hasta, limit = '50', offset = '0' } = req.query;
    
    let whereClause = '1=1';
    const params: any[] = [];

    if (estado) {
      whereClause += ' AND d.estado = ?';
      params.push(estado);
    }

    if (desde) {
      whereClause += ' AND d.fecha_despacho >= ?';
      params.push(desde);
    }

    if (hasta) {
      whereClause += ' AND d.fecha_despacho <= ?';
      params.push(hasta);
    }

    const despachos = await query(`
      SELECT 
        d.*,
        COUNT(DISTINCT di.id) as total_items,
        SUM(di.cantidad) as total_unidades
      FROM despachos d
      LEFT JOIN despacho_items di ON di.despacho_id = d.id
      WHERE ${whereClause}
      GROUP BY d.id
      ORDER BY d.fecha_despacho DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit as string), parseInt(offset as string)]);

    const countResult = await get(`SELECT COUNT(*) as total FROM despachos d WHERE ${whereClause}`, params);

    res.json({
      despachos,
      total: countResult?.total || 0
    });
  } catch (error: any) {
    console.error('Error fetching despachos:', error);
    res.status(500).json({ message: 'Error obteniendo despachos', error: error.message });
  }
};

// Obtener un despacho por ID con sus items
export const getDespachoById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const despacho = await get(`SELECT * FROM despachos WHERE id = ?`, [id]);
    
    if (!despacho) {
      return res.status(404).json({ message: 'Despacho no encontrado' });
    }

    // Obtener items del despacho
    const items = await query(`
      SELECT 
        di.*,
        p.name as product_name,
        p.sku as product_sku,
        pv.sku as variant_sku,
        pc.color_name
      FROM despacho_items di
      LEFT JOIN products p ON p.id = di.product_id
      LEFT JOIN product_variants pv ON pv.id = di.variant_id
      LEFT JOIN product_colors pc ON pc.id = pv.product_color_id
      WHERE di.despacho_id = ?
      ORDER BY di.created_at
    `, [id]);

    res.json({
      ...despacho,
      items
    });
  } catch (error: any) {
    console.error('Error fetching despacho:', error);
    res.status(500).json({ message: 'Error obteniendo despacho', error: error.message });
  }
};

// Crear nuevo despacho
export const createDespacho = async (req: Request, res: Response) => {
  try {
    const {
      numero_despacho,
      fecha_despacho,
      pais_origen = 'Brasil',
      proveedor,
      descripcion,
      valor_fob,
      valor_cif,
      moneda = 'USD',
      estado = 'despachado',
      notas,
      items = []
    } = req.body;

    if (!numero_despacho || !fecha_despacho) {
      return res.status(400).json({ message: 'Número de despacho y fecha son requeridos' });
    }

    // Verificar que no exista el número de despacho
    const existing = await get(`SELECT id FROM despachos WHERE numero_despacho = ?`, [numero_despacho]);
    if (existing) {
      return res.status(400).json({ message: 'Ya existe un despacho con ese número' });
    }

    const despachoId = uuidv4();

    await execute(`
      INSERT INTO despachos (id, numero_despacho, fecha_despacho, pais_origen, proveedor, descripcion, valor_fob, valor_cif, moneda, estado, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [despachoId, numero_despacho, fecha_despacho, pais_origen, proveedor, descripcion, valor_fob, valor_cif, moneda, estado, notas]);

    // Agregar items si se proporcionaron
    for (const item of items) {
      const itemId = uuidv4();
      await execute(`
        INSERT INTO despacho_items (id, despacho_id, product_id, variant_id, cantidad, costo_unitario, descripcion_item)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [itemId, despachoId, item.product_id || null, item.variant_id || null, item.cantidad || 0, item.costo_unitario || null, item.descripcion_item || null]);

      // Actualizar el último despacho del producto
      if (item.product_id) {
        await execute(`UPDATE products SET ultimo_despacho_id = ?, pais_origen = ? WHERE id = ?`, [despachoId, pais_origen, item.product_id]);
      }
    }

    res.status(201).json({ 
      message: 'Despacho creado exitosamente',
      id: despachoId
    });
  } catch (error: any) {
    console.error('Error creating despacho:', error);
    res.status(500).json({ message: 'Error creando despacho', error: error.message });
  }
};

// Actualizar despacho
export const updateDespacho = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      numero_despacho,
      fecha_despacho,
      pais_origen,
      proveedor,
      descripcion,
      valor_fob,
      valor_cif,
      moneda,
      estado,
      notas
    } = req.body;

    const existing = await get(`SELECT id FROM despachos WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ message: 'Despacho no encontrado' });
    }

    // Verificar número único si se está cambiando
    if (numero_despacho) {
      const duplicate = await get(`SELECT id FROM despachos WHERE numero_despacho = ? AND id != ?`, [numero_despacho, id]);
      if (duplicate) {
        return res.status(400).json({ message: 'Ya existe otro despacho con ese número' });
      }
    }

    await execute(`
      UPDATE despachos SET
        numero_despacho = COALESCE(?, numero_despacho),
        fecha_despacho = COALESCE(?, fecha_despacho),
        pais_origen = COALESCE(?, pais_origen),
        proveedor = COALESCE(?, proveedor),
        descripcion = COALESCE(?, descripcion),
        valor_fob = COALESCE(?, valor_fob),
        valor_cif = COALESCE(?, valor_cif),
        moneda = COALESCE(?, moneda),
        estado = COALESCE(?, estado),
        notas = COALESCE(?, notas)
      WHERE id = ?
    `, [numero_despacho, fecha_despacho, pais_origen, proveedor, descripcion, valor_fob, valor_cif, moneda, estado, notas, id]);

    res.json({ message: 'Despacho actualizado' });
  } catch (error: any) {
    console.error('Error updating despacho:', error);
    res.status(500).json({ message: 'Error actualizando despacho', error: error.message });
  }
};

// Eliminar despacho
export const deleteDespacho = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await get(`SELECT id FROM despachos WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ message: 'Despacho no encontrado' });
    }

    // Los items se eliminan automáticamente por CASCADE
    await execute(`DELETE FROM despachos WHERE id = ?`, [id]);

    res.json({ message: 'Despacho eliminado' });
  } catch (error: any) {
    console.error('Error deleting despacho:', error);
    res.status(500).json({ message: 'Error eliminando despacho', error: error.message });
  }
};

// Agregar item a un despacho
export const addDespachoItem = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { product_id, variant_id, cantidad, costo_unitario, descripcion_item } = req.body;

    const despacho = await get(`SELECT id, pais_origen FROM despachos WHERE id = ?`, [id]);
    if (!despacho) {
      return res.status(404).json({ message: 'Despacho no encontrado' });
    }

    const itemId = uuidv4();
    await execute(`
      INSERT INTO despacho_items (id, despacho_id, product_id, variant_id, cantidad, costo_unitario, descripcion_item)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [itemId, id, product_id || null, variant_id || null, cantidad || 0, costo_unitario || null, descripcion_item || null]);

    // Actualizar el último despacho del producto
    if (product_id) {
      await execute(`UPDATE products SET ultimo_despacho_id = ?, pais_origen = ? WHERE id = ?`, [id, despacho.pais_origen, product_id]);
    }

    res.status(201).json({ 
      message: 'Item agregado al despacho',
      id: itemId
    });
  } catch (error: any) {
    console.error('Error adding despacho item:', error);
    res.status(500).json({ message: 'Error agregando item', error: error.message });
  }
};

// Eliminar item de un despacho
export const removeDespachoItem = async (req: Request, res: Response) => {
  try {
    const { id, itemId } = req.params;

    await execute(`DELETE FROM despacho_items WHERE id = ? AND despacho_id = ?`, [itemId, id]);

    res.json({ message: 'Item eliminado del despacho' });
  } catch (error: any) {
    console.error('Error removing despacho item:', error);
    res.status(500).json({ message: 'Error eliminando item', error: error.message });
  }
};

// Obtener productos sin despacho asignado
export const getProductosSinDespacho = async (req: Request, res: Response) => {
  try {
    const productos = await query(`
      SELECT 
        p.id, 
        p.name, 
        p.sku, 
        p.pais_origen,
        COALESCE(SUM(pv.stock), 0) as stock_total
      FROM products p
      LEFT JOIN product_variants pv ON pv.product_id = p.id
      WHERE p.ultimo_despacho_id IS NULL
      GROUP BY p.id, p.name, p.sku, p.pais_origen
      ORDER BY p.name
      LIMIT 200
    `);

    res.json(productos);
  } catch (error: any) {
    console.error('Error fetching productos sin despacho:', error);
    res.status(500).json({ message: 'Error obteniendo productos', error: error.message });
  }
};

// Estadísticas de despachos
export const getDespachoStats = async (req: Request, res: Response) => {
  try {
    const stats = await get(`
      SELECT 
        COUNT(*) as total_despachos,
        SUM(CASE WHEN estado = 'en_transito' THEN 1 ELSE 0 END) as en_transito,
        SUM(CASE WHEN estado = 'en_aduana' THEN 1 ELSE 0 END) as en_aduana,
        SUM(CASE WHEN estado = 'despachado' THEN 1 ELSE 0 END) as despachados,
        SUM(CASE WHEN estado = 'entregado' THEN 1 ELSE 0 END) as entregados,
        SUM(valor_fob) as total_fob,
        SUM(valor_cif) as total_cif
      FROM despachos
    `);

    const itemsStats = await get(`
      SELECT 
        COUNT(DISTINCT product_id) as productos_importados,
        SUM(cantidad) as total_unidades
      FROM despacho_items
    `);

    const porPais = await query(`
      SELECT pais_origen, COUNT(*) as cantidad
      FROM despachos
      GROUP BY pais_origen
      ORDER BY cantidad DESC
    `);

    res.json({
      ...stats,
      ...itemsStats,
      por_pais: porPais
    });
  } catch (error: any) {
    console.error('Error fetching despacho stats:', error);
    res.status(500).json({ message: 'Error obteniendo estadísticas', error: error.message });
  }
};
