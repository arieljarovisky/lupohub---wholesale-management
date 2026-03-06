import { Request, Response } from 'express';
import { query, execute, get } from '../database/db';
import axios from 'axios';
import { updateMercadoLibreStock } from './integrations.controller';

// Tipos de movimiento de stock
export type StockMovementType = 
  | 'PEDIDO_MAYORISTA'
  | 'VENTA_TIENDA_NUBE'
  | 'VENTA_MERCADO_LIBRE'
  | 'AJUSTE_MANUAL'
  | 'DEVOLUCION'
  | 'IMPORTACION_TN'
  | 'IMPORTACION_ML'
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

// Aplicar pack size: stock en app es por unidad; en ML/TN puede ser por pack (ej. pack x2 → enviar stock/2).
function stockForPlatform(localStock: number, packSize: number | null | undefined): number {
  const n = Math.max(0, Number(packSize) || 1);
  return n <= 0 ? localStock : Math.floor(localStock / n);
}

// Sincronizar stock a plataformas externas (TN y ML). Aplica pack size si el producto está en packs (x2, x3, etc.).
export const syncStockToExternalPlatforms = async (variantId: string, newStock: number): Promise<void> => {
  try {
    const variant = await get(
      `SELECT pv.id, pv.tienda_nube_variant_id, pv.mercado_libre_variant_id, 
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

    // Sincronizar con Mercado Libre (SKU externo = mismo que TN)
    if (variant.mercado_libre_id && variant.mercado_libre_variant_id) {
      await updateMercadoLibreStockByVariant(
        variant.mercado_libre_id,
        variant.mercado_libre_variant_id,
        stockML
      );
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
    await axios.put(
      `https://api.mercadolibre.com/items/${itemId}/variations/${variationId}`,
      { available_quantity: stock },
      { headers }
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

  const getRes = await axios.get(`https://api.mercadolibre.com/items/${itemId}`, { headers });
  const item = getRes.data;
  const variations: any[] = item.variations || [];

  if (variations.length === 0) {
    // Ítem sin variaciones: ML usa available_quantity a nivel ítem
    await axios.put(
      `https://api.mercadolibre.com/items/${itemId}`,
      { available_quantity: newStock },
      { headers }
    );
    console.log(`[ML Stock] Actualizado item ${itemId} (sin variaciones) a ${newStock} unidades`);
    return true;
  }

  const variationsPayload = variations.map((v: any) => {
    const isTarget = String(v.id) === String(variationId);
    const qty = isTarget ? newStock : (v.available_quantity ?? 0);
    return { id: v.id, available_quantity: Math.max(0, qty) };
  });

  await axios.put(
    `https://api.mercadolibre.com/items/${itemId}`,
    { variations: variationsPayload },
    { headers }
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
