import { Request, Response } from 'express';
import { query, execute, get } from '../database/db';
import axios from 'axios';
import { updateMercadoLibreStock } from './integrations.controller';

const SYNC_DEBOUNCE_MS = 2800;
const pendingSyncByVariant: Record<string, { timeout: NodeJS.Timeout; stock: number }> = {};

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function withRetry429409<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    const status = e.response?.status;
    if (retries > 0 && (status === 429 || status === 409)) {
      const delayMs = status === 429 ? 2500 : 1200;
      await sleep(delayMs);
      return withRetry429409(fn, retries - 1);
    }
    throw e;
  }
}

// Tipos de movimiento de stock
export type StockMovementType = 
  | 'PEDIDO_MAYORISTA'
  | 'VENTA_TIENDA_NUBE'
  | 'VENTA_MERCADO_LIBRE'
  | 'AJUSTE_MANUAL'
  | 'DEVOLUCION'
  | 'IMPORTACION_TN'
  | 'IMPORTACION_ML'
  | 'IMPORTACION_EXCEL'
  | 'SNAPSHOT_INICIAL';

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
    throw error;
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
      scheduleSyncToExternalPlatforms(variantId, newStock);
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

// Aplicar pack size: stock en app es por unidad; en ML/TN puede ser por pack (ej. pack x2 → enviar stock/2).
function stockForPlatform(localStock: number, packSize: number | null | undefined): number {
  const n = Math.max(0, Number(packSize) || 1);
  return n <= 0 ? localStock : Math.floor(localStock / n);
}

// Programar sincronización con debounce para evitar demasiadas llamadas a ML/TN (429 / conflict).
function scheduleSyncToExternalPlatforms(variantId: string, newStock: number): void {
  const prev = pendingSyncByVariant[variantId];
  if (prev) clearTimeout(prev.timeout);
  pendingSyncByVariant[variantId] = {
    stock: newStock,
    timeout: setTimeout(() => {
      const entry = pendingSyncByVariant[variantId];
      const stockToSync = entry?.stock ?? newStock;
      delete pendingSyncByVariant[variantId];
      syncStockToExternalPlatforms(variantId, stockToSync).catch(err =>
        console.error('[Sync debounced] Error:', err?.message || err)
      );
    }, SYNC_DEBOUNCE_MS)
  };
}

// Sincronizar stock a plataformas externas (TN y ML). Aplica pack size si el producto está en packs (x2, x3, etc.).
export const syncStockToExternalPlatforms = async (variantId: string, newStock: number): Promise<void> => {
  try {
    const variant = await get(
      `SELECT pv.id, pv.tienda_nube_variant_id, pv.mercado_libre_variant_id, pv.mercado_libre_item_id,
              p.tienda_nube_id, p.mercado_libre_id, pv.sku, pv.external_sku,
              COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack,
              COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       WHERE pv.id = ?`,
      [variantId]
    );

    if (!variant) return;

    const stockTN = stockForPlatform(newStock, variant.tn_pack);
    const stockML = stockForPlatform(newStock, variant.ml_pack);
    const skuMLTN = variant.external_sku || variant.sku;

    // Sincronizar con Tienda Nube
    if (variant.tienda_nube_id && variant.tienda_nube_variant_id) {
      await updateTiendaNubeStock(
        variant.tienda_nube_id,
        variant.tienda_nube_variant_id,
        stockTN
      );
    }

    // Sincronizar con Mercado Libre: priorizar variación cuando exista (publicación con varias tallas/colores)
    if (variant.mercado_libre_id && variant.mercado_libre_variant_id) {
      await updateMercadoLibreStockByVariant(
        variant.mercado_libre_id,
        variant.mercado_libre_variant_id,
        stockML
      );
    } else if (variant.mercado_libre_item_id) {
      await updateMercadoLibreStockByItem(variant.mercado_libre_item_id, stockML);
    } else if (skuMLTN) {
      await updateMercadoLibreStock(skuMLTN, stockML);
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

    await withRetry429409(() =>
      axios.put(
        `https://api.tiendanube.com/v1/${integration.store_id}/products/${productId}/variants/${variantId}`,
        { stock },
        {
          headers: {
            'Authentication': `bearer ${integration.access_token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'LupoHub (lupohub@example.com)'
          }
        }
      )
    );

    console.log(`[TN Stock] Actualizado producto ${productId} variante ${variantId} a ${stock} unidades`);
    return true;
  } catch (error: any) {
    console.error('[TN Stock] Error:', error.response?.data || error.message);
    return false;
  }
};

// Actualizar stock en Mercado Libre cuando la variante tiene su propia publicación (ítem sin variaciones o con una sola).
export const updateMercadoLibreStockByItem = async (itemId: string, stock: number): Promise<boolean> => {
  const integration = await get(
    `SELECT access_token FROM integrations WHERE platform = 'mercadolibre'`
  );
  if (!integration?.access_token) {
    console.log('[ML Stock] No hay integración configurada');
    return false;
  }
  const headers = {
    'Authorization': `Bearer ${integration.access_token}`,
    'Content-Type': 'application/json'
  };
  try {
    const getRes = await withRetry429409(() => axios.get(`https://api.mercadolibre.com/items/${itemId}`, { headers }));
    const item = getRes.data;
    const variations: any[] = item.variations || [];
    if (variations.length === 0) {
      await withRetry429409(() =>
        axios.put(`https://api.mercadolibre.com/items/${itemId}`, { available_quantity: stock }, { headers })
      );
      console.log(`[ML Stock] Actualizado publicación única ${itemId} a ${stock} unidades`);
      return true;
    }
    if (variations.length === 1) {
      await withRetry429409(() =>
        axios.put(
          `https://api.mercadolibre.com/items/${itemId}`,
          { variations: [{ id: variations[0].id, available_quantity: stock }] },
          { headers }
        )
      );
      console.log(`[ML Stock] Actualizado publicación única (1 variación) ${itemId} a ${stock} unidades`);
      return true;
    }
    console.log(`[ML Stock] Item ${itemId} tiene ${variations.length} variaciones; usar publicación con variaciones en su lugar`);
    return false;
  } catch (e: any) {
    console.error(`[ML Stock] Error actualizando publicación única ${itemId}:`, e.response?.data || e.message);
    return false;
  }
};

// Actualizar stock en Mercado Libre por variante.
// Prueba primero PUT a la subrecurso; si ML devuelve error, usa GET item + PUT item con array variations (formato que exige la API en muchos casos).
export const updateMercadoLibreStockByVariant = async (
  itemId: string,
  variationId: string,
  stock: number
): Promise<boolean> => {
  const integration = await get(
    `SELECT access_token FROM integrations WHERE platform = 'mercadolibre'`
  );

  if (!integration?.access_token) {
    console.log('[ML Stock] No hay integración configurada');
    return false;
  }

  const headers = {
    'Authorization': `Bearer ${integration.access_token}`,
    'Content-Type': 'application/json'
  };

  // 1) Intentar actualización por subrecurso (algunas cuentas lo aceptan)
  try {
    await withRetry429409(() =>
      axios.put(
        `https://api.mercadolibre.com/items/${itemId}/variations/${variationId}`,
        { available_quantity: stock },
        { headers }
      )
    );
    console.log(`[ML Stock] Actualizado item ${itemId} variación ${variationId} a ${stock} unidades`);
    return true;
  } catch (subError: any) {
    const status = subError.response?.status;
    const data = subError.response?.data;
    // Si es 400/404/405, probar método completo (GET + PUT con todas las variaciones)
    if (status === 400 || status === 404 || status === 405 || (status >= 400 && status < 500)) {
      try {
        return await updateMercadoLibreStockByItemUpdate(itemId, variationId, stock, integration.access_token);
      } catch (fullError: any) {
        console.error('[ML Stock] Error método completo:', fullError.response?.data || fullError.message);
        return false;
      }
    }
    console.error('[ML Stock] Error:', data || subError.message);
    return false;
  }
};

// Fallback: obtener ítem de ML, actualizar solo la variación indicada y enviar PUT con todas las variaciones (requerido por la API).
async function updateMercadoLibreStockByItemUpdate(
  itemId: string,
  variationId: string,
  newStock: number,
  accessToken: string
): Promise<boolean> {
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  };

  const getRes = await withRetry429409(() => axios.get(`https://api.mercadolibre.com/items/${itemId}`, { headers }));
  const item = getRes.data;
  const variations: any[] = item.variations || [];

  if (variations.length === 0) {
    await withRetry429409(() =>
      axios.put(
        `https://api.mercadolibre.com/items/${itemId}`,
        { available_quantity: newStock },
        { headers }
      )
    );
    console.log(`[ML Stock] Actualizado item ${itemId} (sin variaciones) a ${newStock} unidades`);
    return true;
  }

  const variationsPayload = variations.map((v: any) => {
    const isTarget = String(v.id) === String(variationId);
    const qty = isTarget ? newStock : (v.available_quantity ?? 0);
    return { id: v.id, available_quantity: Math.max(0, qty) };
  });

  await withRetry429409(() =>
    axios.put(
      `https://api.mercadolibre.com/items/${itemId}`,
      { variations: variationsPayload },
      { headers }
    )
  );
  console.log(`[ML Stock] Actualizado item ${itemId} variación ${variationId} a ${newStock} unidades (vía PUT item)`);
  return true;
}

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

    const limitNum = Math.min(500, Math.max(1, parseInt(limit as string, 10) || 50));
    params.push(limitNum);

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

// Endpoint: Revertir un movimiento de stock (solo último movimiento de la variante)
export const revertStockMovement = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: 'ID de movimiento inválido' });
    }

    const movement = await get(
      `SELECT * FROM stock_movements WHERE id = ?`,
      [id]
    );

    if (!movement) {
      return res.status(404).json({ message: 'Movimiento no encontrado' });
    }

    // No tiene sentido revertir el snapshot inicial
    if (movement.movement_type === 'SNAPSHOT_INICIAL') {
      return res.status(400).json({ message: 'No se puede revertir un snapshot inicial.' });
    }

    // Por seguridad, solo permitir revertir si este movimiento es el último de esa variante
    const later = await get(
      `SELECT id FROM stock_movements WHERE variant_id = ? AND created_at > ? LIMIT 1`,
      [movement.variant_id, movement.created_at]
    );
    if (later?.id) {
      return res.status(400).json({ message: 'No se puede revertir porque hay movimientos posteriores para esta variante.' });
    }

    const targetStock = Number(movement.previous_stock ?? 0);
    const ok = await updateVariantStock(
      movement.variant_id,
      targetStock,
      'AJUSTE_MANUAL',
      `Reversión de movimiento ${movement.id} (${movement.movement_type})`,
      true
    );

    if (!ok) {
      return res.status(500).json({ message: 'No se pudo revertir el movimiento' });
    }

    res.json({
      message: 'Movimiento revertido',
      movementId: movement.id,
      variantId: movement.variant_id,
      previousStock: movement.new_stock,
      restoredStock: targetStock
    });
  } catch (error: any) {
    console.error('Error reverting stock movement:', error);
    res.status(500).json({ message: 'Error revirtiendo movimiento de stock', error: error.message });
  }
};

// Endpoint: Forzar sincronización de stock a plataformas externas
export const forceSyncStock = async (req: Request, res: Response) => {
  try {
    const { variantId } = req.params;
    const stockRow = await get(`SELECT stock FROM stocks WHERE variant_id = ?`, [variantId]);
    if (!stockRow) return res.status(404).json({ message: 'Variante no encontrada' });
    await syncStockToExternalPlatforms(variantId, stockRow.stock);
    res.json({ message: 'Sincronización iniciada', variantId, stock: stockRow.stock });
  } catch (error: any) {
    console.error('Error forcing stock sync:', error);
    res.status(500).json({ message: 'Error sincronizando stock' });
  }
};

// Endpoint: Ajuste manual de stock (Admin o Depósito)
export const updateVariantStockEndpoint = async (req: Request, res: Response) => {
  try {
    const { variantId } = req.params;
    const { stock } = req.body;
    const user = (req as any).user;
    const userId = user?.id || 'sistema';
    if (typeof stock !== 'number' || stock < 0) {
      return res.status(400).json({ message: 'stock debe ser un número >= 0' });
    }
    const ok = await updateVariantStock(
      variantId,
      Math.floor(stock),
      'AJUSTE_MANUAL',
      `Ajuste por usuario ${userId}`,
      true
    );
    if (!ok) return res.status(500).json({ message: 'Error actualizando stock' });
    res.json({ variantId, stock: Math.floor(stock) });
  } catch (error: any) {
    console.error('Error updating variant stock:', error);
    res.status(500).json({ message: 'Error actualizando stock' });
  }
};

// Endpoint: Eliminar el snapshot inicial (todos los movimientos SNAPSHOT_INICIAL) para poder crear uno nuevo
export const deleteStockSnapshot = async (req: Request, res: Response) => {
  try {
    const result = await execute(
      `DELETE FROM stock_movements WHERE movement_type = 'SNAPSHOT_INICIAL'`
    );
    const deleted = Number((result as any)?.affectedRows) || 0;
    res.json({
      message: deleted > 0 ? `Snapshot inicial eliminado (${deleted} registros).` : 'No había snapshot inicial para eliminar.',
      deleted
    });
  } catch (error: any) {
    console.error('Error deleting stock snapshot:', error);
    res.status(500).json({ message: 'Error eliminando snapshot', error: error.message });
  }
};

// Endpoint: Crear snapshot inicial de todo el stock actual
export const createStockSnapshot = async (req: Request, res: Response) => {
  try {
    // Verificar si ya existe un snapshot inicial
    const existingSnapshot = await get(
      `SELECT COUNT(*) as count FROM stock_movements WHERE movement_type = 'SNAPSHOT_INICIAL'`
    );

    if (existingSnapshot?.count > 0) {
      return res.status(400).json({ 
        message: 'Ya existe un snapshot inicial. Elimínalo primero si querés crear uno nuevo.',
        existingCount: existingSnapshot.count
      });
    }

    // Obtener todo el stock actual
    const allStock = await query(`
      SELECT 
        s.variant_id,
        s.stock,
        pv.sku,
        p.name as product_name
      FROM stocks s
      JOIN product_variants pv ON pv.id = s.variant_id
      JOIN product_colors pc ON pc.id = pv.product_color_id
      JOIN products p ON p.id = pc.product_id
      WHERE s.stock > 0
    `);

    let created = 0;
    for (const item of allStock) {
      await execute(
        `INSERT INTO stock_movements (id, variant_id, previous_stock, new_stock, quantity_change, movement_type, reference, created_at)
         VALUES (UUID(), ?, 0, ?, ?, 'SNAPSHOT_INICIAL', ?, NOW())`,
        [item.variant_id, item.stock, item.stock, `Stock inicial: ${item.sku || item.product_name}`]
      );
      created++;
    }

    res.json({ 
      message: 'Snapshot inicial creado',
      variantsProcessed: created
    });
  } catch (error: any) {
    console.error('Error creating stock snapshot:', error);
    res.status(500).json({ message: 'Error creando snapshot', error: error.message });
  }
};

// Endpoint: Importar historial de ventas de TN y ML
export const importSalesHistory = async (req: Request, res: Response) => {
  try {
    const { days = 60 } = req.body;
    const logs: string[] = [];
    let imported = 0;

    // Calcular fecha desde
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - days);
    const dateFromStr = dateFrom.toISOString().split('T')[0];

    logs.push(`Importando ventas de los últimos ${days} días (desde ${dateFromStr})`);

    // Importar de Tienda Nube
    const tnIntegration = await get(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);
    if (tnIntegration?.access_token) {
      try {
        const axios = (await import('axios')).default;
        let page = 1;
        let hasMore = true;

        while (hasMore && page <= 10) {
          const ordersRes = await axios.get(
            `https://api.tiendanube.com/v1/${tnIntegration.store_id}/orders?created_at_min=${dateFromStr}&per_page=50&page=${page}&status=paid`,
            {
              headers: {
                'Authentication': `bearer ${tnIntegration.access_token}`,
                'User-Agent': 'LupoHub (lupohub@example.com)'
              }
            }
          );

          const orders = ordersRes.data || [];
          if (orders.length === 0) {
            hasMore = false;
            break;
          }

          for (const order of orders) {
            // Verificar si ya existe este movimiento
            const exists = await get(
              `SELECT id FROM stock_movements WHERE reference LIKE ? AND movement_type = 'VENTA_TIENDA_NUBE'`,
              [`%TN-${order.id}%`]
            );
            if (exists) continue;

            for (const product of order.products || []) {
              const tnVariantId = product.variant_id;
              const qty = product.quantity || 1;
              const itemSku = (product.sku || product.variant_sku || '').toString().trim();

              let variant = await get(`SELECT pv.id FROM product_variants pv WHERE pv.tienda_nube_variant_id = ?`, [tnVariantId]);
              if (!variant?.id && itemSku) {
                variant = await get(`SELECT pv.id FROM product_variants pv WHERE COALESCE(pv.external_sku, pv.sku) = ? OR pv.sku = ?`, [itemSku, itemSku]);
              }
              if (!variant?.id && itemSku) {
                variant = await get(
                  `SELECT pv.id FROM product_variants pv
                   JOIN product_colors pc ON pc.id = pv.product_color_id
                   JOIN products p ON p.id = pc.product_id
                   WHERE p.sku = ? OR pv.sku LIKE ? OR pv.external_sku = ? LIMIT 1`,
                  [itemSku, `${itemSku}%`, itemSku]
                );
              }

              if (variant?.id) {
                await execute(
                  `INSERT INTO stock_movements (id, variant_id, previous_stock, new_stock, quantity_change, movement_type, reference, created_at)
                   VALUES (UUID(), ?, 0, 0, ?, 'VENTA_TIENDA_NUBE', ?, ?)`,
                  [variant.id, -qty, `Orden TN-${order.id} (histórico)`, order.created_at]
                );
                imported++;
              }
            }
          }

          page++;
          if (orders.length < 50) hasMore = false;
        }
        logs.push(`✓ Tienda Nube: ${imported} movimientos importados`);
      } catch (e: any) {
        logs.push(`✗ Error Tienda Nube: ${e.message}`);
      }
    }

    // Importar de Mercado Libre
    const mlIntegration = await get(`SELECT access_token, user_id FROM integrations WHERE platform = 'mercadolibre'`);
    if (mlIntegration?.access_token) {
      try {
        const axios = (await import('axios')).default;
        let offset = 0;
        let mlImported = 0;

        while (offset < 500) {
          const ordersRes = await axios.get(
            `https://api.mercadolibre.com/orders/search?seller=${mlIntegration.user_id}&order.status=paid&order.date_created.from=${dateFromStr}T00:00:00.000-03:00&offset=${offset}&limit=50&sort=date_desc`,
            {
              headers: { 'Authorization': `Bearer ${mlIntegration.access_token}` }
            }
          );

          const orders = ordersRes.data.results || [];
          if (orders.length === 0) break;

          for (const order of orders) {
            // Verificar si ya existe
            const exists = await get(
              `SELECT id FROM stock_movements WHERE reference LIKE ? AND movement_type = 'VENTA_MERCADO_LIBRE'`,
              [`%ML-${order.id}%`]
            );
            if (exists) continue;

            for (const item of order.order_items || []) {
              const mlVariationId = item.item?.variation_id;
              const qty = item.quantity || 1;
              const itemSku = (item.item?.sku || item.sku || '').toString().trim();

              let variant = null;
              if (mlVariationId) {
                variant = await get(`SELECT pv.id FROM product_variants pv WHERE pv.mercado_libre_variant_id = ?`, [mlVariationId]);
              }
              if (!variant?.id && itemSku) {
                variant = await get(`SELECT pv.id FROM product_variants pv WHERE COALESCE(pv.external_sku, pv.sku) = ? OR pv.sku = ?`, [itemSku, itemSku]);
              }
              if (!variant?.id && itemSku) {
                variant = await get(
                  `SELECT pv.id FROM product_variants pv
                   JOIN product_colors pc ON pc.id = pv.product_color_id
                   JOIN products p ON p.id = pc.product_id
                   WHERE p.sku = ? OR pv.sku LIKE ? OR pv.external_sku = ? LIMIT 1`,
                  [itemSku, `${itemSku}%`, itemSku]
                );
              }

              if (variant?.id) {
                await execute(
                  `INSERT INTO stock_movements (id, variant_id, previous_stock, new_stock, quantity_change, movement_type, reference, created_at)
                   VALUES (UUID(), ?, 0, 0, ?, 'VENTA_MERCADO_LIBRE', ?, ?)`,
                  [variant.id, -qty, `Orden ML-${order.id} (histórico)`, order.date_created]
                );
                mlImported++;
              }
            }
          }

          offset += 50;
          if (orders.length < 50) break;
        }
        imported += mlImported;
        logs.push(`✓ Mercado Libre: ${mlImported} movimientos importados`);
      } catch (e: any) {
        logs.push(`✗ Error Mercado Libre: ${e.message}`);
      }
    }

    res.json({
      message: 'Importación completada',
      totalImported: imported,
      logs
    });
  } catch (error: any) {
    console.error('Error importing sales history:', error);
    res.status(500).json({ message: 'Error importando historial', error: error.message });
  }
};

/** Normaliza código/SKU para búsqueda: quitar guiones, barras y espacios. */
function normalizeCodigo(s: string): string {
  return String(s ?? '')
    .trim()
    .replace(/[-/\s]/g, '')
    .toUpperCase();
}

/** Código de artículo a 7 dígitos con ceros adelante (ej. 52302 → 0052302). */
function padArticleCodeTo7(s: string): string {
  const digits = String(s ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length <= 7 ? digits.padStart(7, '0') : digits;
}

/** Escapa % y _ para uso en LIKE. */
function escapeLike(s: string): string {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** Resuelve variant_id por código de producto (base SKU), código de color y código de talle. Prueba exacto, normalizado y "empieza con". */
async function getVariantIdByCodigoColorSize(
  codigo: string,
  colorCode: string,
  sizeCode: string
): Promise<string | null> {
  const codigoTrim = (codigo ?? '').toString().trim();
  const colorStr = (colorCode ?? '').toString().trim();
  const sizeStr = (sizeCode ?? '').toString().trim();
  if (!codigoTrim || !colorStr || !sizeStr) return null;

  let row = await get(
    `SELECT pv.id AS variant_id
     FROM products p
     JOIN product_colors pc ON pc.product_id = p.id
     JOIN colors c ON c.id = pc.color_id
     JOIN product_variants pv ON pv.product_color_id = pc.id
     JOIN sizes s ON s.id = pv.size_id
     WHERE p.sku = ? AND c.code = ? AND s.size_code = ?`,
    [codigoTrim, colorStr, sizeStr]
  );
  if (row?.variant_id) return row.variant_id;

  const padded = padArticleCodeTo7(codigoTrim);
  if (padded && padded !== codigoTrim) {
    row = await get(
      `SELECT pv.id AS variant_id
       FROM products p
       JOIN product_colors pc ON pc.product_id = p.id
       JOIN colors c ON c.id = pc.color_id
       JOIN product_variants pv ON pv.product_color_id = pc.id
       JOIN sizes s ON s.id = pv.size_id
       WHERE p.sku = ? AND c.code = ? AND s.size_code = ?`,
      [padded, colorStr, sizeStr]
    );
    if (row?.variant_id) return row.variant_id;
  }

  const normalized = normalizeCodigo(codigoTrim);
  if (!normalized) return null;

  row = await get(
    `SELECT pv.id AS variant_id
     FROM products p
     JOIN product_colors pc ON pc.product_id = p.id
     JOIN colors c ON c.id = pc.color_id
     JOIN product_variants pv ON pv.product_color_id = pc.id
     JOIN sizes s ON s.id = pv.size_id
     WHERE REPLACE(REPLACE(REPLACE(p.sku, '-', ''), '/', ''), CHAR(32), '') = ? AND c.code = ? AND s.size_code = ?`,
    [normalized, colorStr, sizeStr]
  );
  if (row?.variant_id) return row.variant_id;

  const pattern = escapeLike(normalized) + '%';
  row = await get(
    `SELECT pv.id AS variant_id
     FROM products p
     JOIN product_colors pc ON pc.product_id = p.id
     JOIN colors c ON c.id = pc.color_id
     JOIN product_variants pv ON pv.product_color_id = pc.id
     JOIN sizes s ON s.id = pv.size_id
     WHERE REPLACE(REPLACE(REPLACE(p.sku, '-', ''), '/', ''), CHAR(32), '') LIKE ? AND c.code = ? AND s.size_code = ?
     LIMIT 1`,
    [pattern, colorStr, sizeStr]
  );
  return row?.variant_id || null;
}

const EXCEL_SIZE_COLUMNS = ['P', 'M', 'G', 'GG', 'XG', 'XXG', 'XXXG'];

function parseStockValue(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number' && !Number.isNaN(v)) return Math.max(0, Math.floor(v));
  const s = String(v).trim().toUpperCase();
  if (s === 'X' || s === '-' || s === 'N/A') return 0;
  const n = parseFloat(s.replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isNaN(n) ? 0 : Math.max(0, Math.floor(n));
}

export const importStockFromExcel = async (req: Request, res: Response) => {
  try {
    const { rows: rawRows } = req.body as { rows?: Array<Record<string, unknown>> };
    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return res.status(400).json({
        message: 'Se requiere un array "rows" con las filas del Excel (columnas CODIGO, COLOR y tallas P, M, G, etc.).'
      });
    }

    const notFound: string[] = [];
    const errors: string[] = [];
    let updated = 0;

    for (const row of rawRows) {
      const codigo = (row.codigo ?? row.CODIGO ?? row.Codigo ?? '').toString().trim();
      const colorRaw = row.color ?? row.COLOR ?? row.Color;
      const colorStr = colorRaw != null ? String(colorRaw).trim() : '';
      if (!codigo || !colorStr) continue;

      for (const sizeCode of EXCEL_SIZE_COLUMNS) {
        const rawVal = row[sizeCode] ?? row[sizeCode.toLowerCase()];
        const stock = parseStockValue(rawVal);
        const variantId = await getVariantIdByCodigoColorSize(codigo, colorStr, sizeCode);
        if (!variantId) {
          const key = `${codigo}-${colorStr}-${sizeCode}`;
          if (!notFound.includes(key)) notFound.push(key);
          continue;
        }
        const ok = await updateVariantStock(
          variantId,
          stock,
          'IMPORTACION_EXCEL',
          'Importación Excel',
          true
        );
        if (ok) updated++;
        else errors.push(`Error actualizando ${codigo} color ${colorStr} talle ${sizeCode}`);
      }
    }

    res.json({
      message: 'Importación de stock completada',
      updated,
      notFound: notFound.slice(0, 200),
      notFoundCount: notFound.length,
      errors: errors.length > 0 ? errors.slice(0, 50) : undefined
    });
  } catch (error: any) {
    console.error('Error importing stock from Excel:', error);
    res.status(500).json({ message: 'Error importando stock desde Excel', error: error.message });
  }
};
