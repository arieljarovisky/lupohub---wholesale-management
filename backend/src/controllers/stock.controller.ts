import { Request, Response } from 'express';
import { query, execute, get } from '../database/db';
import axios from 'axios';

// Tipos de movimiento de stock
export type StockMovementType = 
  | 'PEDIDO_MAYORISTA'
  | 'VENTA_TIENDA_NUBE'
  | 'VENTA_MERCADO_LIBRE'
  | 'AJUSTE_MANUAL'
  | 'DEVOLUCION'
  | 'IMPORTACION_TN';

interface StockMovement {
  variantId: string;
  quantity: number;
  type: StockMovementType;
  reference?: string;
}

// Registrar movimiento de stock en historial
export const logStockMovement = async (
  variantId: string,
  previousStock: number,
  newStock: number,
  movementType: StockMovementType,
  reference?: string
) => {
  try {
    await execute(
      `INSERT INTO stock_movements (id, variant_id, previous_stock, new_stock, quantity_change, movement_type, reference, created_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, NOW())`,
      [variantId, previousStock, newStock, newStock - previousStock, movementType, reference || null]
    );
  } catch (error) {
    console.error('Error logging stock movement:', error);
  }
};

// Actualizar stock de una variante
export const updateVariantStock = async (
  variantId: string,
  newStock: number,
  movementType: StockMovementType,
  reference?: string,
  syncExternal: boolean = true
): Promise<boolean> => {
  try {
    const currentStockRow = await get(
      `SELECT stock FROM stocks WHERE variant_id = ?`,
      [variantId]
    );
    const previousStock = currentStockRow?.stock || 0;

    await execute(
      `INSERT INTO stocks (variant_id, stock) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE stock = ?`,
      [variantId, newStock, newStock]
    );

    await logStockMovement(variantId, previousStock, newStock, movementType, reference);

    if (syncExternal) {
      await syncStockToExternalPlatforms(variantId, newStock);
    }

    return true;
  } catch (error) {
    console.error('Error updating variant stock:', error);
    return false;
  }
};

// Descontar stock por pedido mayorista
export const deductStockForOrder = async (orderId: string): Promise<{ success: boolean; errors: string[] }> => {
  const errors: string[] = [];
  
  try {
    const items = await query(
      `SELECT oi.variant_id, oi.quantity, pv.sku, s.stock as current_stock
       FROM order_items oi
       JOIN product_variants pv ON pv.id = oi.variant_id
       LEFT JOIN stocks s ON s.variant_id = oi.variant_id
       WHERE oi.order_id = ?`,
      [orderId]
    );

    for (const item of items) {
      const currentStock = item.current_stock || 0;
      const newStock = Math.max(0, currentStock - item.quantity);

      const success = await updateVariantStock(
        item.variant_id,
        newStock,
        'PEDIDO_MAYORISTA',
        `Pedido: ${orderId}`
      );

      if (!success) {
        errors.push(`Error actualizando stock para variante ${item.sku || item.variant_id}`);
      }
    }

    return { success: errors.length === 0, errors };
  } catch (error: any) {
    console.error('Error deducting stock for order:', error);
    return { success: false, errors: [error.message] };
  }
};

// Restaurar stock cuando se cancela un pedido
export const restoreStockForOrder = async (orderId: string): Promise<{ success: boolean; errors: string[] }> => {
  const errors: string[] = [];
  
  try {
    const items = await query(
      `SELECT oi.variant_id, oi.quantity, pv.sku, s.stock as current_stock
       FROM order_items oi
       JOIN product_variants pv ON pv.id = oi.variant_id
       LEFT JOIN stocks s ON s.variant_id = oi.variant_id
       WHERE oi.order_id = ?`,
      [orderId]
    );

    for (const item of items) {
      const currentStock = item.current_stock || 0;
      const newStock = currentStock + item.quantity;

      const success = await updateVariantStock(
        item.variant_id,
        newStock,
        'DEVOLUCION',
        `Cancelación pedido: ${orderId}`
      );

      if (!success) {
        errors.push(`Error restaurando stock para variante ${item.sku || item.variant_id}`);
      }
    }

    return { success: errors.length === 0, errors };
  } catch (error: any) {
    console.error('Error restoring stock for order:', error);
    return { success: false, errors: [error.message] };
  }
};

// Sincronizar stock a plataformas externas (TN y ML)
export const syncStockToExternalPlatforms = async (variantId: string, newStock: number): Promise<void> => {
  try {
    const variant = await get(
      `SELECT pv.id, pv.tienda_nube_variant_id, pv.mercado_libre_variant_id, 
              p.tienda_nube_id, p.mercado_libre_id, pv.sku
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       WHERE pv.id = ?`,
      [variantId]
    );

    if (!variant) return;

    // Sincronizar con Tienda Nube
    if (variant.tienda_nube_id && variant.tienda_nube_variant_id) {
      await updateTiendaNubeStock(
        variant.tienda_nube_id,
        variant.tienda_nube_variant_id,
        newStock
      );
    }

    // Sincronizar con Mercado Libre
    if (variant.mercado_libre_id && variant.mercado_libre_variant_id) {
      await updateMercadoLibreStockByVariant(
        variant.mercado_libre_id,
        variant.mercado_libre_variant_id,
        newStock
      );
    }
  } catch (error) {
    console.error('Error syncing stock to external platforms:', error);
  }
};

// Actualizar stock en Tienda Nube
export const updateTiendaNubeStock = async (
  productId: string,
  variantId: string,
  stock: number
): Promise<boolean> => {
  try {
    const integration = await get(
      `SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`
    );

    if (!integration?.access_token || !integration?.store_id) {
      console.log('[TN Stock] No hay integración configurada');
      return false;
    }

    const response = await axios.put(
      `https://api.tiendanube.com/v1/${integration.store_id}/products/${productId}/variants/${variantId}`,
      { stock },
      {
        headers: {
          'Authentication': `bearer ${integration.access_token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'LupoHub (lupohub@example.com)'
        }
      }
    );

    console.log(`[TN Stock] Actualizado producto ${productId} variante ${variantId} a ${stock} unidades`);
    return true;
  } catch (error: any) {
    console.error('[TN Stock] Error:', error.response?.data || error.message);
    return false;
  }
};

// Actualizar stock en Mercado Libre por variante
export const updateMercadoLibreStockByVariant = async (
  itemId: string,
  variationId: string,
  stock: number
): Promise<boolean> => {
  try {
    const integration = await get(
      `SELECT access_token FROM integrations WHERE platform = 'mercadolibre'`
    );

    if (!integration?.access_token) {
      console.log('[ML Stock] No hay integración configurada');
      return false;
    }

    const response = await axios.put(
      `https://api.mercadolibre.com/items/${itemId}/variations/${variationId}`,
      { available_quantity: stock },
      {
        headers: {
          'Authorization': `Bearer ${integration.access_token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`[ML Stock] Actualizado item ${itemId} variación ${variationId} a ${stock} unidades`);
    return true;
  } catch (error: any) {
    console.error('[ML Stock] Error:', error.response?.data || error.message);
    return false;
  }
};

// Endpoint: Obtener historial de movimientos de stock
export const getStockMovements = async (req: Request, res: Response) => {
  try {
    const { variantId, type, from, to, limit = '50' } = req.query;
    
    let whereClause = '1=1';
    const params: any[] = [];

    if (variantId) {
      whereClause += ' AND sm.variant_id = ?';
      params.push(variantId);
    }

    if (type) {
      whereClause += ' AND sm.movement_type = ?';
      params.push(type);
    }

    if (from) {
      whereClause += ' AND sm.created_at >= ?';
      params.push(from);
    }

    if (to) {
      whereClause += ' AND sm.created_at <= ?';
      params.push(to);
    }

    params.push(parseInt(limit as string) || 50);

    const movements = await query(
      `SELECT sm.*, pv.sku, p.name as product_name
       FROM stock_movements sm
       JOIN product_variants pv ON pv.id = sm.variant_id
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       WHERE ${whereClause}
       ORDER BY sm.created_at DESC
       LIMIT ?`,
      params
    );

    res.json(movements);
  } catch (error: any) {
    console.error('Error fetching stock movements:', error);
    res.status(500).json({ message: 'Error obteniendo movimientos de stock' });
  }
};

// Endpoint: Forzar sincronización de stock a plataformas externas
export const forceSyncStock = async (req: Request, res: Response) => {
  try {
    const { variantId } = req.params;

    const stockRow = await get(
      `SELECT stock FROM stocks WHERE variant_id = ?`,
      [variantId]
    );

    if (!stockRow) {
      return res.status(404).json({ message: 'Variante no encontrada' });
    }

    await syncStockToExternalPlatforms(variantId, stockRow.stock);

    res.json({ message: 'Sincronización iniciada', variantId, stock: stockRow.stock });
  } catch (error: any) {
    console.error('Error forcing stock sync:', error);
    res.status(500).json({ message: 'Error sincronizando stock' });
  }
};
