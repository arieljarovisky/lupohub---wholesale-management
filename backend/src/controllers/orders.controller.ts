import { Request, Response } from 'express';
import { query, execute, get } from '../database/db';
import { Order, OrderItem } from '../types';
import { v4 as uuidv4 } from 'uuid';

export const getOrders = async (req: any, res: any) => {
  try {
    // 1. Get Orders
    const ordersRow = await query("SELECT * FROM orders ORDER BY date DESC");
    
    // 2. Get Items for each order with productId (variant -> product_color -> product)
    const ordersFull = await Promise.all(ordersRow.map(async (order) => {
      const items = await query(`
        SELECT i.variant_id AS variantId, i.quantity, i.picked, i.price_at_moment AS priceAtMoment,
               pc.product_id AS productId
        FROM order_items i
        JOIN product_variants pv ON pv.id = i.variant_id
        JOIN product_colors pc ON pc.id = pv.product_color_id
        WHERE i.order_id = ?
      `, [order.id]);
      
      const itemsMapped = (items as any[]).map((row: any) => ({
        variantId: row.variantId,
        productId: row.productId,
        quantity: row.quantity,
        picked: row.picked ?? 0,
        priceAtMoment: Number(row.priceAtMoment)
      }));
      
      return {
        id: order.id,
        customerId: order.customer_id,
        sellerId: order.seller_id,
        date: order.date,
        status: order.status,
        total: Number(order.total),
        pickedBy: order.picked_by ?? undefined,
        dispatchedAt: order.dispatched_at ? new Date(order.dispatched_at).toISOString() : undefined,
        items: itemsMapped
      };
    }));

    res.json(ordersFull);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching orders" });
  }
};

export const createOrder = async (req: any, res: any) => {
  const newOrder: Order = req.body;
  
  if (!newOrder.customerId || !newOrder.items.length) {
    return res.status(400).json({ message: "Datos de pedido inválidos" });
  }

  const orderId = newOrder.id || uuidv4();

  try {
    const toSqlDate = (d: string) => {
      try {
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return new Date().toISOString().slice(0, 10);
        return dt.toISOString().slice(0, 10);
      } catch {
        return new Date().toISOString().slice(0, 10);
      }
    };
    const sqlDate = toSqlDate(newOrder.date);
    await execute(
      `INSERT INTO orders (id, customer_id, seller_id, date, status, total) VALUES (?, ?, ?, ?, ?, ?)`,
      [orderId, newOrder.customerId, newOrder.sellerId, sqlDate, newOrder.status, newOrder.total]
    );

    for (const item of newOrder.items as any[]) {
      let variantId = item.variantId;
      if (!variantId && item.sku && item.colorCode && item.sizeCode) {
        const row = await get(
          `SELECT pv.id AS variant_id 
           FROM products p 
           JOIN product_colors pc ON pc.product_id = p.id 
           JOIN colors c ON c.id = pc.color_id 
           JOIN product_variants pv ON pv.product_color_id = pc.id 
           JOIN sizes s ON s.id = pv.size_id 
           WHERE p.sku = ? AND c.code = ? AND s.size_code = ?`,
          [item.sku, item.colorCode, item.sizeCode]
        );
        variantId = row?.variant_id;
      }
      if (!variantId) {
        return res.status(400).json({ message: "Falta variantId o sku+colorCode+sizeCode en item" });
      }
      await execute(
        `INSERT INTO order_items (id, order_id, variant_id, quantity, picked, price_at_moment) VALUES (?, ?, ?, ?, ?, ?)`,
        [uuidv4(), orderId, variantId, item.quantity, 0, item.priceAtMoment ?? 0]
      );
    }

    if (newOrder.status === 'Confirmado') {
      const { deductStockForOrder } = await import('./stock.controller');
      const result = await deductStockForOrder(orderId);
      if (!result.success) console.error('Errores descontando stock al crear pedido confirmado:', result.errors);
    }

    const created = await get('SELECT id, customer_id, seller_id, date, status, total, picked_by, dispatched_at FROM orders WHERE id = ?', [orderId]);
    if (!created) return res.status(201).json({ ...newOrder, id: orderId });
    const items = await query(`
      SELECT i.variant_id AS variantId, i.quantity, i.picked, i.price_at_moment AS priceAtMoment, pc.product_id AS productId
      FROM order_items i
      JOIN product_variants pv ON pv.id = i.variant_id
      JOIN product_colors pc ON pc.id = pv.product_color_id
      WHERE i.order_id = ?
    `, [orderId]);
    const itemsMapped = (items as any[]).map((row: any) => ({
      variantId: row.variantId,
      productId: row.productId,
      quantity: row.quantity,
      picked: row.picked ?? 0,
      priceAtMoment: Number(row.priceAtMoment)
    }));
    const orderResponse = {
      id: created.id,
      customerId: created.customer_id,
      sellerId: created.seller_id,
      date: created.date,
      status: created.status,
      total: Number(created.total),
      pickedBy: created.picked_by ?? undefined,
      dispatchedAt: created.dispatched_at ? new Date(created.dispatched_at).toISOString() : undefined,
      items: itemsMapped
    };
    res.status(201).json(orderResponse);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error creating order" });
  }
};

export const updateOrderStatus = async (req: any, res: any) => {
  const { id } = req.params;
  const { status, pickedBy } = req.body;

  try {
    // Obtener estado anterior
    const currentOrder = await get("SELECT status FROM orders WHERE id = ?", [id]);
    const previousStatus = currentOrder?.status;

    // Si pasa de Borrador a Confirmado, descontar stock
    if (previousStatus === 'Borrador' && status === 'Confirmado') {
      const { deductStockForOrder } = await import('./stock.controller');
      const result = await deductStockForOrder(id);
      
      if (!result.success) {
        console.error('Errores descontando stock:', result.errors);
      }
    }

    // Si se cancela un pedido confirmado, restaurar stock
    if (previousStatus === 'Confirmado' && status === 'Cancelado') {
      const { restoreStockForOrder } = await import('./stock.controller');
      const result = await restoreStockForOrder(id);
      
      if (!result.success) {
        console.error('Errores restaurando stock:', result.errors);
      }
    }

    // Documentar quién prepara/despacha y cuándo
    if (status === 'Preparación' && pickedBy) {
      await execute("UPDATE orders SET status = ?, picked_by = ? WHERE id = ?", [status, pickedBy, id]);
    } else if (status === 'Despachado') {
      await execute(
        "UPDATE orders SET status = ?, picked_by = COALESCE(?, picked_by), dispatched_at = NOW() WHERE id = ?",
        [status, pickedBy || null, id]
      );
    } else {
      await execute("UPDATE orders SET status = ? WHERE id = ?", [status, id]);
    }
    res.json({ id, status, previousStatus });
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ message: "Error updating order status" });
  }
};

export const updateOrder = async (req: any, res: any) => {
  const { id } = req.params;
  const updated: Order = req.body;
  if (!id || !updated || !updated.items?.length) {
    return res.status(400).json({ message: "Datos de pedido inválidos" });
  }
  try {
    const toSqlDate = (d: string) => {
      try {
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return new Date().toISOString().slice(0, 10);
        return dt.toISOString().slice(0, 10);
      } catch {
        return new Date().toISOString().slice(0, 10);
      }
    };
    const sqlDate = toSqlDate(updated.date);
    await execute(
      "UPDATE orders SET customer_id = ?, seller_id = ?, date = ?, status = ?, total = ? WHERE id = ?",
      [updated.customerId, updated.sellerId, sqlDate, updated.status, updated.total, id]
    );
    await execute("DELETE FROM order_items WHERE order_id = ?", [id]);
    for (const item of updated.items as any[]) {
      let variantId = item.variantId;
      if (!variantId && item.sku && item.colorCode && item.sizeCode) {
        const row = await get(
          `SELECT pv.id AS variant_id 
           FROM products p 
           JOIN product_colors pc ON pc.product_id = p.id 
           JOIN colors c ON c.id = pc.color_id 
           JOIN product_variants pv ON pv.product_color_id = pc.id 
           JOIN sizes s ON s.id = pv.size_id 
           WHERE p.sku = ? AND c.code = ? AND s.size_code = ?`,
          [item.sku, item.colorCode, item.sizeCode]
        );
        variantId = row?.variant_id;
      }
      if (!variantId) {
        return res.status(400).json({ message: "Falta variantId o sku+colorCode+sizeCode en item" });
      }
      await execute(
        "INSERT INTO order_items (id, order_id, variant_id, quantity, picked, price_at_moment) VALUES (?, ?, ?, ?, ?, ?)",
        [uuidv4(), id, variantId, item.quantity, item.picked || 0, item.priceAtMoment]
      );
    }
    const created = await get('SELECT id, customer_id, seller_id, date, status, total, picked_by, dispatched_at FROM orders WHERE id = ?', [id]);
    if (!created) return res.json({ ...updated, id });
    const itemsRows = await query(`
      SELECT i.variant_id AS variantId, i.quantity, i.picked, i.price_at_moment AS priceAtMoment, pc.product_id AS productId
      FROM order_items i
      JOIN product_variants pv ON pv.id = i.variant_id
      JOIN product_colors pc ON pc.id = pv.product_color_id
      WHERE i.order_id = ?
    `, [id]);
    const itemsMapped = (itemsRows as any[]).map((row: any) => ({
      variantId: row.variantId,
      productId: row.productId,
      quantity: row.quantity,
      picked: row.picked ?? 0,
      priceAtMoment: Number(row.priceAtMoment)
    }));
    res.json({
      id: created.id,
      customerId: created.customer_id,
      sellerId: created.seller_id,
      date: created.date,
      status: created.status,
      total: Number(created.total),
      pickedBy: created.picked_by ?? undefined,
      dispatchedAt: created.dispatched_at ? new Date(created.dispatched_at).toISOString() : undefined,
      items: itemsMapped
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error actualizando pedido" });
  }
}

export const deleteOrder = async (req: any, res: any) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ message: "ID inválido" });
  try {
    const currentOrder = await get("SELECT status FROM orders WHERE id = ?", [id]);
    const status = currentOrder?.status;
    if (status === 'Confirmado' || status === 'Preparación') {
      const { restoreStockForOrder } = await import('./stock.controller');
      const result = await restoreStockForOrder(id);
      if (!result.success) {
        console.error('Errores restaurando stock al eliminar pedido:', result.errors);
        return res.status(500).json({ message: 'Error restaurando stock: ' + (result.errors?.join(', ') || 'desconocido') });
      }
    }
    await execute("DELETE FROM orders WHERE id = ?", [id]);
    res.json({ id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error eliminando pedido" });
  }
};
