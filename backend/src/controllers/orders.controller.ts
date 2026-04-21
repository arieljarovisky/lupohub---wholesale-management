import { Request, Response } from 'express';
import { query, execute, get } from '../database/db';
import { Order, OrderItem } from '../types';
import { restoreStockForOrder, restoreStockForOrderItem } from './stock.controller';
import { v4 as uuidv4 } from 'uuid';

async function resolveDespachoIdForItem(item: any, variantId?: string): Promise<string | null> {
  const raw = item?.despachoId ?? item?.despacho_id;
  if (raw != null && raw !== '') {
    const id = String(raw).trim();
    if (id) {
      const row = await get('SELECT id FROM despachos WHERE id = ?', [id]);
      if (row?.id) return row.id;
    }
  }

  // Fallback automático: si no viene despacho explícito, usar el último despacho del producto de la variante.
  if (!variantId) return null;
  const fallback = await get(
    `SELECT p.ultimo_despacho_id AS despacho_id
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN products p ON p.id = pc.product_id
     WHERE pv.id = ?
     LIMIT 1`,
    [variantId]
  );
  const fallbackId = fallback?.despacho_id;
  if (!fallbackId) return null;
  const exists = await get('SELECT id FROM despachos WHERE id = ?', [fallbackId]);
  return exists?.id ?? null;
}

function mapPaymentStatus(row: any): 'pendiente' | 'pagado' {
  return row?.payment_status === 'pendiente' ? 'pendiente' : 'pagado';
}

function normalizeOrderReference(raw: unknown): string | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  return v.slice(0, 255);
}

/** Neto gravado = Σ (cantidad × precio unitario) en order_items. */
async function getOrderNetFromLineItems(orderId: string, pickedOnly = false): Promise<number> {
  const rows = await query(
    `SELECT quantity, picked, price_at_moment FROM order_items WHERE order_id = ? ORDER BY id`,
    [orderId]
  ) as { quantity: number; picked?: number | null; price_at_moment: string | number }[];
  let sum = 0;
  for (const r of rows) {
    const rawQty = pickedOnly ? Number(r.picked ?? 0) : Number(r.quantity);
    const baseQty = Number.isFinite(rawQty) ? rawQty : 0;
    const qty = Math.max(0, Math.min(baseQty, Number(r.quantity) || 0));
    if (qty <= 0) continue;
    const price = Number(r.price_at_moment) || 0;
    sum += Math.round(qty * price * 100) / 100;
  }
  return Math.round(sum * 100) / 100;
}

export const getOrders = async (req: any, res: any) => {
  try {
    const includeArchived = req.query.includeArchived === 'true' || req.query.includeArchived === '1';
    const archivedOnly = req.query.archivedOnly === 'true' || req.query.archivedOnly === '1';
    let whereArchived = ' AND (o.archived = 0 OR o.archived IS NULL)';
    if (archivedOnly) whereArchived = ' AND o.archived = 1';
    else if (includeArchived) whereArchived = '';

    let ordersRow = await query(`
      SELECT o.*, c.business_name AS customer_business_name, c.name AS customer_name
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE 1=1 ${whereArchived}
      ORDER BY o.date DESC
    `);
    const user = req.user;
    if (user?.role === 'CUSTOMER') {
      const { get } = await import('../database/db');
      const customer = await get('SELECT id FROM customers WHERE user_id = ?', [user.id]);
      if (customer?.id) {
        ordersRow = ordersRow.filter((o: any) => o.customer_id === customer.id);
      } else {
        ordersRow = [];
      }
    }

    const orderId = req.query.orderId as string | undefined;
    if (orderId) {
      ordersRow = ordersRow.filter((o: any) => o.id === orderId);
    }

    if (ordersRow.length === 0) {
      return res.json([]);
    }

    const orderIds = ordersRow.map((o: any) => o.id);
    const placeholders = orderIds.map(() => '?').join(',');
    const itemsRows = await query(`
      SELECT i.order_id, i.variant_id AS variantId, i.despacho_id AS despachoId, i.quantity, i.picked, i.price_at_moment AS priceAtMoment,
             COALESCE(i.sell_as_pack, 0) AS sellAsPack,
             COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS mayoristaPackSize,
             pc.product_id AS productId,
             COALESCE(pv.sku, p.sku) AS sku,
             p.name AS productName,
             s.size_code AS sizeCode,
             c.name AS colorName,
             COALESCE(d_item.numero_despacho, d_prod.numero_despacho) AS numeroDespacho
      FROM order_items i
      JOIN product_variants pv ON pv.id = i.variant_id
      JOIN product_colors pc ON pc.id = pv.product_color_id
      JOIN products p ON p.id = pc.product_id
      LEFT JOIN sizes s ON s.id = pv.size_id
      LEFT JOIN colors c ON c.id = pc.color_id
      LEFT JOIN despachos d_item ON d_item.id = i.despacho_id
      LEFT JOIN despachos d_prod ON d_prod.id = p.ultimo_despacho_id
      WHERE i.order_id IN (${placeholders})
    `, orderIds);

    const itemsByOrderId: Record<string, any[]> = {};
    for (const o of ordersRow) {
      itemsByOrderId[o.id] = [];
    }
    for (const row of itemsRows as any[]) {
      const items = itemsByOrderId[row.order_id];
      if (items) {
        items.push({
          variantId: row.variantId,
          productId: row.productId,
          despachoId: row.despachoId ?? undefined,
          quantity: row.quantity,
          picked: row.picked ?? 0,
          priceAtMoment: Number(row.priceAtMoment),
          sellAsPack: !!(row.sellAsPack),
          mayoristaPackSize: row.mayoristaPackSize != null ? Number(row.mayoristaPackSize) : 1,
          sku: row.sku ?? undefined,
          productName: row.productName ?? undefined,
          sizeCode: row.sizeCode ?? undefined,
          colorName: row.colorName ?? undefined,
          numeroDespacho: row.numeroDespacho ?? row.numero_despacho ?? undefined
        });
      }
    }

    const invoicesRows = await query(
      `SELECT order_id, cae, cae_fch_vto, punto_venta, cbte_desde, cbte_hasta, cbte_tipo, created_at FROM invoices WHERE order_id IN (${placeholders})`,
      orderIds
    );
    const invoiceByOrderId: Record<string, any> = {};
    for (const inv of invoicesRows as any[]) {
      invoiceByOrderId[inv.order_id] = {
        cae: inv.cae,
        caeFchVto: inv.cae_fch_vto ?? undefined,
        puntoVta: inv.punto_venta ?? undefined,
        cbteDesde: inv.cbte_desde,
        cbteHasta: inv.cbte_hasta,
        cbteTipo: inv.cbte_tipo,
        createdAt: inv.created_at ? new Date(inv.created_at).toISOString() : undefined
      };
    }

    let creditNotesCountByOrderId: Record<string, number> = {};
    let creditNotesTotalByOrderId: Record<string, number> = {};
    let creditNotesItemByOrderId: Record<string, number> = {};
    try {
      const cnRows = await query(
        `SELECT order_id,
                COUNT(*) AS cnt,
                SUM(CASE WHEN scope = 'total' THEN 1 ELSE 0 END) AS total_cnt,
                SUM(CASE WHEN scope = 'item' THEN 1 ELSE 0 END) AS item_cnt
         FROM credit_notes
         WHERE order_id IN (${placeholders})
         GROUP BY order_id`,
        orderIds
      );
      for (const r of cnRows as any[]) {
        creditNotesCountByOrderId[r.order_id] = Number(r.cnt) || 0;
        creditNotesTotalByOrderId[r.order_id] = Number(r.total_cnt) || 0;
        creditNotesItemByOrderId[r.order_id] = Number(r.item_cnt) || 0;
      }
    } catch (_) {
      // Tabla credit_notes puede no existir en DB antiguas
    }

    const ordersFull = ordersRow.map((order: any) => ({
      id: order.id,
      customerId: order.customer_id,
      customerBusinessName: order.customer_business_name ?? order.customer_name ?? undefined,
      sellerId: order.seller_id,
      reference: order.reference ?? undefined,
      date: order.date,
      status: order.status,
      total: Number(order.total),
      pickedBy: order.picked_by ?? undefined,
      dispatchedAt: order.dispatched_at ? new Date(order.dispatched_at).toISOString() : undefined,
      archived: !!(order.archived),
      items: itemsByOrderId[order.id] || [],
      invoice: invoiceByOrderId[order.id] ?? undefined,
      creditNotesCount: creditNotesCountByOrderId[order.id] ?? 0,
      creditNotesTotalCount: creditNotesTotalByOrderId[order.id] ?? 0,
      creditNotesItemCount: creditNotesItemByOrderId[order.id] ?? 0,
      paymentStatus: mapPaymentStatus(order),
      noStockImpact: !!order.no_stock_impact
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

  const user = req.user;
  let sellerId = newOrder.sellerId ?? null;
  if (user?.role === 'CUSTOMER') {
    const { get } = await import('../database/db');
    const customer = await get('SELECT id FROM customers WHERE user_id = ?', [user.id]);
    if (!customer || customer.id !== newOrder.customerId) {
      return res.status(403).json({ message: 'Como cliente directo solo podés crear pedidos para tu propio perfil' });
    }
    sellerId = null;
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
    const paymentStatus =
      (newOrder as any).paymentStatus === 'pagado' || (newOrder as any).paymentStatus === 'PAGADO' ? 'pagado' : 'pendiente';
    const noStockImpact = (newOrder as any).noStockImpact === true || (newOrder as any).no_stock_impact === 1 ? 1 : 0;
    const reference = normalizeOrderReference(
      (newOrder as any).reference ?? (newOrder as any).identifier ?? (newOrder as any).note
    );
    await execute(
      `INSERT INTO orders (id, customer_id, seller_id, date, status, total, reference, payment_status, no_stock_impact) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderId, newOrder.customerId, sellerId, sqlDate, newOrder.status, newOrder.total, reference, paymentStatus, noStockImpact]
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
      const sellAsPack = item.sellAsPack === true || item.sellAsPack === 1 ? 1 : 0;
      const despachoId = await resolveDespachoIdForItem(item, variantId);
      await execute(
        `INSERT INTO order_items (id, order_id, variant_id, quantity, picked, price_at_moment, sell_as_pack, despacho_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), orderId, variantId, item.quantity, 0, item.priceAtMoment ?? 0, sellAsPack, despachoId]
      );
    }

    if (newOrder.status === 'Confirmado' && !noStockImpact) {
      const { deductStockForOrder } = await import('./stock.controller');
      const result = await deductStockForOrder(orderId);
      if (!result.success) console.error('Errores descontando stock al crear pedido confirmado:', result.errors);
    }

    const created = await get(
      'SELECT id, customer_id, seller_id, date, status, total, reference, picked_by, dispatched_at, payment_status, no_stock_impact FROM orders WHERE id = ?',
      [orderId]
    );
    if (!created) return res.status(201).json({ ...newOrder, id: orderId, paymentStatus });
    const items = await query(`
      SELECT i.variant_id AS variantId, i.despacho_id AS despachoId, i.quantity, i.picked, i.price_at_moment AS priceAtMoment,
             COALESCE(i.sell_as_pack, 0) AS sellAsPack, COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS mayoristaPackSize,
             pc.product_id AS productId,
             COALESCE(pv.sku, p.sku) AS sku, p.name AS productName, s.size_code AS sizeCode, c.name AS colorName,
             COALESCE(d_item.numero_despacho, d_prod.numero_despacho) AS numeroDespacho
      FROM order_items i
      JOIN product_variants pv ON pv.id = i.variant_id
      JOIN product_colors pc ON pc.id = pv.product_color_id
      JOIN products p ON p.id = pc.product_id
      LEFT JOIN sizes s ON s.id = pv.size_id
      LEFT JOIN colors c ON c.id = pc.color_id
      LEFT JOIN despachos d_item ON d_item.id = i.despacho_id
      LEFT JOIN despachos d_prod ON d_prod.id = p.ultimo_despacho_id
      WHERE i.order_id = ?
    `, [orderId]);
    const itemsMapped = (items as any[]).map((row: any) => ({
      variantId: row.variantId,
      productId: row.productId,
      despachoId: row.despachoId ?? undefined,
      quantity: row.quantity,
      picked: row.picked ?? 0,
      priceAtMoment: Number(row.priceAtMoment),
      sellAsPack: !!(row.sellAsPack),
      mayoristaPackSize: row.mayoristaPackSize != null ? Number(row.mayoristaPackSize) : 1,
      sku: row.sku ?? undefined,
      productName: row.productName ?? undefined,
      sizeCode: row.sizeCode ?? undefined,
      colorName: row.colorName ?? undefined,
      numeroDespacho: row.numeroDespacho ?? undefined
    }));
    const orderResponse = {
      id: created.id,
      customerId: created.customer_id,
      sellerId: created.seller_id,
      reference: created.reference ?? undefined,
      date: created.date,
      status: created.status,
      total: Number(created.total),
      pickedBy: created.picked_by ?? undefined,
      dispatchedAt: created.dispatched_at ? new Date(created.dispatched_at).toISOString() : undefined,
      items: itemsMapped,
      paymentStatus: mapPaymentStatus(created),
      noStockImpact: !!created.no_stock_impact
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
    const currentOrder = await get("SELECT status, no_stock_impact FROM orders WHERE id = ?", [id]);
    const previousStatus = currentOrder?.status;
    const noStockImpact = !!currentOrder?.no_stock_impact;

    // Si pasa de Borrador a Confirmado, descontar stock
    if (previousStatus === 'Borrador' && status === 'Confirmado' && !noStockImpact) {
      const { deductStockForOrder } = await import('./stock.controller');
      const result = await deductStockForOrder(id);
      
      if (!result.success) {
        console.error('Errores descontando stock:', result.errors);
      }
    }

    // Si se cancela un pedido que ya tenía stock descontado, restaurar stock (todos los estados salvo Borrador y Despachado)
    const hadStockDeducted =
      !noStockImpact && ['Confirmado', 'Preparando', 'Preparación', 'Falta controlar', 'Controlado'].includes(previousStatus);
    if (status === 'Cancelado' && hadStockDeducted) {
      const { restoreStockForOrder } = await import('./stock.controller');
      const result = await restoreStockForOrder(id);
      
      if (!result.success) {
        console.error('Errores restaurando stock:', result.errors);
      }
    }

    // Documentar quién prepara/despacha y cuándo
    if ((status === 'Preparando' || status === 'Preparación') && pickedBy) {
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
    const sellerId = updated.sellerId ?? null;
    const paymentStatus =
      (updated as any).paymentStatus === 'pagado' || (updated as any).paymentStatus === 'PAGADO' ? 'pagado' : 'pendiente';
    const noStockImpact = (updated as any).noStockImpact === true || (updated as any).no_stock_impact === 1 ? 1 : 0;
    const reference = normalizeOrderReference(
      (updated as any).reference ?? (updated as any).identifier ?? (updated as any).note
    );
    await execute(
      'UPDATE orders SET customer_id = ?, seller_id = ?, date = ?, status = ?, total = ?, reference = ?, payment_status = ?, no_stock_impact = ? WHERE id = ?',
      [updated.customerId, sellerId, sqlDate, updated.status, updated.total, reference, paymentStatus, noStockImpact, id]
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
      const sellAsPack = item.sellAsPack === true || item.sellAsPack === 1 ? 1 : 0;
      const despachoId = await resolveDespachoIdForItem(item, variantId);
      await execute(
        "INSERT INTO order_items (id, order_id, variant_id, quantity, picked, price_at_moment, sell_as_pack, despacho_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [uuidv4(), id, variantId, item.quantity, item.picked || 0, item.priceAtMoment, sellAsPack, despachoId]
      );
    }
    const created = await get(
      'SELECT id, customer_id, seller_id, date, status, total, reference, picked_by, dispatched_at, payment_status, no_stock_impact FROM orders WHERE id = ?',
      [id]
    );
    if (!created) return res.json({ ...updated, id });
    const itemsRows = await query(`
      SELECT i.variant_id AS variantId, i.despacho_id AS despachoId, i.quantity, i.picked, i.price_at_moment AS priceAtMoment,
             COALESCE(i.sell_as_pack, 0) AS sellAsPack, COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS mayoristaPackSize,
             pc.product_id AS productId,
             COALESCE(pv.sku, p.sku) AS sku, p.name AS productName, s.size_code AS sizeCode, c.name AS colorName,
             COALESCE(d_item.numero_despacho, d_prod.numero_despacho) AS numeroDespacho
      FROM order_items i
      JOIN product_variants pv ON pv.id = i.variant_id
      JOIN product_colors pc ON pc.id = pv.product_color_id
      JOIN products p ON p.id = pc.product_id
      LEFT JOIN sizes s ON s.id = pv.size_id
      LEFT JOIN colors c ON c.id = pc.color_id
      LEFT JOIN despachos d_item ON d_item.id = i.despacho_id
      LEFT JOIN despachos d_prod ON d_prod.id = p.ultimo_despacho_id
      WHERE i.order_id = ?
    `, [id]);
    const itemsMapped = (itemsRows as any[]).map((row: any) => ({
      variantId: row.variantId,
      productId: row.productId,
      despachoId: row.despachoId ?? undefined,
      quantity: row.quantity,
      picked: row.picked ?? 0,
      priceAtMoment: Number(row.priceAtMoment),
      sellAsPack: !!(row.sellAsPack),
      mayoristaPackSize: row.mayoristaPackSize != null ? Number(row.mayoristaPackSize) : 1,
      sku: row.sku ?? undefined,
      productName: row.productName ?? undefined,
      sizeCode: row.sizeCode ?? undefined,
      colorName: row.colorName ?? undefined,
      numeroDespacho: row.numeroDespacho ?? undefined
    }));
    res.json({
      id: created.id,
      customerId: created.customer_id,
      sellerId: created.seller_id,
      reference: created.reference ?? undefined,
      date: created.date,
      status: created.status,
      total: Number(created.total),
      pickedBy: created.picked_by ?? undefined,
      dispatchedAt: created.dispatched_at ? new Date(created.dispatched_at).toISOString() : undefined,
      items: itemsMapped,
      paymentStatus: mapPaymentStatus(created),
      noStockImpact: !!created.no_stock_impact
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error actualizando pedido" });
  }
}

/** Marca cobro del pedido (pendiente / pagado) sin reenviar ítems. */
export const patchOrderPaymentStatus = async (req: any, res: any) => {
  const { id } = req.params;
  const user = req.user;
  if (!user || !['ADMIN', 'SELLER', 'WAREHOUSE', 'DEPOSITO'].includes(user.role)) {
    return res.status(403).json({ message: 'Sin permiso para modificar cobranza' });
  }
  const raw = req.body?.paymentStatus ?? req.body?.payment_status;
  const paymentStatus = raw === 'pagado' || raw === 'PAGADO' ? 'pagado' : 'pendiente';
  if (!id) return res.status(400).json({ message: 'ID inválido' });
  try {
    const row = await get('SELECT id FROM orders WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ message: 'Pedido no encontrado' });
    if (user.role === 'SELLER') {
      const ord = await get('SELECT customer_id FROM orders WHERE id = ?', [id]);
      const cust = ord?.customer_id
        ? await get('SELECT seller_id FROM customers WHERE id = ?', [ord.customer_id])
        : null;
      if (cust?.seller_id && cust.seller_id !== user.id) {
        return res.status(403).json({ message: 'Solo podés modificar pedidos de tus clientes' });
      }
    }
    await execute('UPDATE orders SET payment_status = ? WHERE id = ?', [paymentStatus, id]);
    res.json({ id, paymentStatus });
  } catch (error) {
    console.error('patchOrderPaymentStatus:', error);
    res.status(500).json({ message: 'Error actualizando estado de cobro' });
  }
};

/** Archiva o desarchiva un pedido (ocultar/mostrar en lista). */
export const archiveOrder = async (req: any, res: any) => {
  const { id } = req.params;
  const archived = req.body?.archived === true || req.body?.archived === 1;
  if (!id) return res.status(400).json({ message: "ID de pedido inválido" });
  try {
    const row = await get("SELECT id FROM orders WHERE id = ?", [id]);
    if (!row) return res.status(404).json({ message: "Pedido no encontrado" });
    await execute("UPDATE orders SET archived = ? WHERE id = ?", [archived ? 1 : 0, id]);
    res.json({ id, archived });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error actualizando archivado del pedido" });
  }
};

export const deleteOrder = async (req: any, res: any) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ message: "ID inválido" });
  try {
    const hasInvoice = await get("SELECT id FROM invoices WHERE order_id = ?", [id]);
    if (hasInvoice) {
      return res.status(400).json({
        message: "No se puede eliminar un pedido que tiene factura emitida. La factura sigue vigente en AFIP. Para anular el efecto fiscal emití una nota de crédito."
      });
    }
    const currentOrder = await get("SELECT status, no_stock_impact FROM orders WHERE id = ?", [id]);
    const status = currentOrder?.status;
    const hadStockDeducted =
      !currentOrder?.no_stock_impact &&
      ['Confirmado', 'Preparando', 'Preparación', 'Falta controlar', 'Controlado'].includes(status);
    if (hadStockDeducted) {
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

/** Obtiene la factura AFIP asociada a un pedido (si existe). */
export const getOrderInvoice = async (req: any, res: any) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ message: 'ID de pedido inválido' });
  try {
    const inv = await get(
      'SELECT id, order_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, created_at FROM invoices WHERE order_id = ?',
      [id]
    );
    if (!inv) return res.status(404).json({ message: 'Este pedido no tiene factura emitida' });
    res.json({
      id: inv.id,
      orderId: inv.order_id,
      cae: inv.cae,
      caeFchVto: inv.cae_fch_vto ?? undefined,
      puntoVta: inv.punto_venta,
      cbteTipo: inv.cbte_tipo,
      cbteDesde: inv.cbte_desde,
      cbteHasta: inv.cbte_hasta,
      createdAt: inv.created_at
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error obteniendo factura' });
  }
};

/** Emite factura electrónica AFIP para un pedido. Solo ADMIN o WAREHOUSE. */
export const emitirFactura = async (req: any, res: any) => {
  const { id } = req.params;
  const user = req.user;
  if (!user || (user.role !== 'ADMIN' && user.role !== 'WAREHOUSE' && user.role !== 'DEPOSITO')) {
    return res.status(403).json({ message: 'Solo ADMIN o Depósito pueden emitir facturas' });
  }
  if (!id) return res.status(400).json({ message: 'ID de pedido inválido' });
  try {
    const orderRow = await get('SELECT id, customer_id, date, total, no_stock_impact FROM orders WHERE id = ?', [id]);
    if (!orderRow) return res.status(404).json({ message: 'Pedido no encontrado' });
    const noStockImpact = req.body?.noStockImpact === true || req.body?.no_stock_impact === 1;
    if (noStockImpact && !orderRow.no_stock_impact) {
      await execute('UPDATE orders SET no_stock_impact = 1 WHERE id = ?', [id]);
    }
    const existingInv = await get('SELECT id FROM invoices WHERE order_id = ?', [id]);
    if (existingInv) return res.status(409).json({ message: 'Este pedido ya tiene una factura emitida', invoiceId: existingInv.id });

    const customerRow = await get(
      'SELECT id, business_name, cuit, condicion_iva FROM customers WHERE id = ?',
      [orderRow.customer_id]
    );
    if (!customerRow) return res.status(400).json({ message: 'Cliente del pedido no encontrado' });

    const cbteTipoFromBody = req.body?.cbteTipo;
    const forceCbteTipo = (cbteTipoFromBody === 1 || cbteTipoFromBody === 6) ? (cbteTipoFromBody as 1 | 6) : undefined;

    // Facturar únicamente lo efectivamente retirado/pickeado del pedido.
    const netFromPickedItems = await getOrderNetFromLineItems(id, true);
    const totalForAfip = netFromPickedItems;
    if (totalForAfip <= 0) {
      return res.status(400).json({ message: 'No hay unidades retiradas para facturar en este pedido.' });
    }

    const { emitirFactura: emitirAfip } = await import('../services/afip.service');
    const result = await emitirAfip(
      { id: orderRow.id, date: orderRow.date, total: totalForAfip, customerId: orderRow.customer_id },
      {
        id: customerRow.id,
        businessName: customerRow.business_name ?? '',
        cuit: customerRow.cuit,
        condicionIva: customerRow.condicion_iva ?? null
      },
      forceCbteTipo
    );

    const { v4: uuidv4 } = await import('uuid');
    const invoiceId = uuidv4();
    await execute(
      `INSERT INTO invoices (id, order_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [invoiceId, id, result.cae, result.caeFchVto || null, result.puntoVta, result.cbteTipo, result.cbteDesde, result.cbteHasta]
    );
    res.status(201).json({
      id: invoiceId,
      orderId: id,
      cae: result.cae,
      caeFchVto: result.caeFchVto,
      puntoVta: result.puntoVta,
      cbteTipo: result.cbteTipo,
      cbteDesde: result.cbteDesde,
      cbteHasta: result.cbteHasta
    });
  } catch (error: any) {
    console.error('emitirFactura:', error);
    const msg = error?.message || 'Error emitiendo factura AFIP';
    const upstreamStatus = Number(error?.response?.status || error?.cause?.response?.status || 0);
    const msgLower = String(msg).toLowerCase();
    const status = msgLower.includes('no configurado')
      ? 503
      : msgLower.includes('ya tiene')
        ? 409
        : (upstreamStatus === 503 || msgLower.includes('service unavailable') || msgLower.includes('(503)')
            ? 503
            : 500);
    res.status(status).json({ message: msg });
  }
};

/** Lista las notas de crédito emitidas para un pedido. */
export const getOrderCreditNotes = async (req: any, res: any) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ message: 'ID de pedido inválido' });
  try {
    let rows: any[] = [];
    try {
      rows = await query(
        `SELECT
           cn.id, NULL AS credit_note_id, cn.order_id, cn.invoice_id, cn.cae, cn.cae_fch_vto, cn.punto_venta, cn.cbte_tipo, cn.cbte_desde, cn.cbte_hasta,
           cn.amount_credited, cn.scope, cn.item_index, cn.created_at
         FROM credit_notes cn
         WHERE cn.order_id = ?
         UNION ALL
         SELECT
           cni.id, cni.credit_note_id, cni.order_id, cn.invoice_id, cn.cae, cn.cae_fch_vto, cn.punto_venta, cn.cbte_tipo, cn.cbte_desde, cn.cbte_hasta,
           cni.amount_credited, 'item' AS scope, cni.item_index, cni.created_at
         FROM credit_note_items cni
         JOIN credit_notes cn ON cn.id = cni.credit_note_id
         WHERE cni.order_id = ?
         ORDER BY created_at DESC`,
        [id, id]
      ) as any[];
    } catch (e: any) {
      if (String(e?.message || '').toLowerCase().includes('credit_note_items')) {
        rows = await query(
          `SELECT id, order_id, invoice_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, amount_credited, scope, item_index, created_at
           FROM credit_notes WHERE order_id = ? ORDER BY created_at DESC`,
          [id]
        ) as any[];
      } else {
        throw e;
      }
    }
    res.json((rows as any[]).map((r: any) => ({
      id: r.id,
      creditNoteId: r.credit_note_id ?? r.id,
      orderId: r.order_id,
      invoiceId: r.invoice_id,
      cae: r.cae,
      caeFchVto: r.cae_fch_vto ?? undefined,
      puntoVta: r.punto_venta,
      cbteTipo: r.cbte_tipo,
      cbteDesde: r.cbte_desde,
      cbteHasta: r.cbte_hasta,
      amountCredited: Number(r.amount_credited),
      scope: r.scope ?? 'total',
      itemIndex: r.item_index ?? undefined,
      createdAt: r.created_at
    })));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error listando notas de crédito' });
  }
};

/** Emite una Nota de Crédito AFIP: todo el pedido o un ítem. Solo ADMIN/WAREHOUSE/DEPOSITO. */
export const emitirNotaCredito = async (req: any, res: any) => {
  const { id } = req.params;
  const user = req.user;
  if (!user || (user.role !== 'ADMIN' && user.role !== 'WAREHOUSE' && user.role !== 'DEPOSITO')) {
    return res.status(403).json({ message: 'Solo ADMIN o Depósito pueden emitir notas de crédito' });
  }
  if (!id) return res.status(400).json({ message: 'ID de pedido inválido' });
  const { tipo, itemIndex, quantity, items: partialItems } = req.body || {};
  if (!tipo || (tipo !== 'total' && tipo !== 'item')) {
    return res.status(400).json({ message: 'Body debe incluir tipo: "total" o "item"' });
  }

  try {
    const orderRow = await get('SELECT id, customer_id, total FROM orders WHERE id = ?', [id]);
    if (!orderRow) return res.status(404).json({ message: 'Pedido no encontrado' });

    const invRow = await get(
      'SELECT id, punto_venta, cbte_tipo, cbte_desde FROM invoices WHERE order_id = ?',
      [id]
    );
    if (!invRow) return res.status(400).json({ message: 'Este pedido no tiene factura; primero emití la factura.' });

    const customerRow = await get(
      'SELECT id, business_name, cuit, condicion_iva FROM customers WHERE id = ?',
      [orderRow.customer_id]
    );
    if (!customerRow) return res.status(400).json({ message: 'Cliente del pedido no encontrado' });

    // Validar: si ya existe NC por el total, no se permite ninguna NC más (ni total ni por ítem)
    const existingNCs = await query(
      `SELECT scope, item_index, amount_credited FROM credit_notes WHERE order_id = ?`,
      [id]
    ) as { scope?: string; item_index?: number | null; amount_credited: string }[];

    const yaExisteNCTotal = existingNCs.some(
      (r) => (r.scope || 'total') === 'total'
    );
    if (yaExisteNCTotal) {
      return res.status(400).json({
        message: 'Ya existe una nota de crédito por el total de este pedido. No se pueden emitir más notas de crédito.',
      });
    }

    let amountToCredit: number;
    let selectedItemsForCredit: Array<{ itemIndex: number; quantity: number; amount: number }> = [];

    if (tipo === 'total') {
      const netFromItems = await getOrderNetFromLineItems(id);
      amountToCredit = netFromItems > 0 ? netFromItems : Number(orderRow.total) || 0;
      if (amountToCredit <= 0) return res.status(400).json({ message: 'El total del pedido debe ser mayor a 0.' });
    } else {
      const itemsRows = await query(
        `SELECT quantity, price_at_moment FROM order_items WHERE order_id = ? ORDER BY id`,
        [id]
      );
      const items = itemsRows as { quantity: number; price_at_moment: string }[];
      if (!items.length) return res.status(400).json({ message: 'El pedido no tiene ítems.' });
      const payloadItemsRaw: Array<{ itemIndex: number; quantity?: number }> =
        Array.isArray(partialItems) && partialItems.length > 0
          ? partialItems
          : [{ itemIndex: itemIndex, quantity }];
      const normalized = payloadItemsRaw
        .map((it: any) => ({
          itemIndex: typeof it?.itemIndex === 'number' ? it.itemIndex : parseInt(String(it?.itemIndex), 10),
          quantity: it?.quantity != null ? (typeof it.quantity === 'number' ? it.quantity : parseInt(String(it.quantity), 10)) : undefined
        }))
        .filter((it) => Number.isFinite(it.itemIndex));
      if (normalized.length === 0) {
        return res.status(400).json({ message: 'Para NC parcial indicá al menos un ítem con itemIndex.' });
      }

      const uniqueByIndex = new Map<number, { itemIndex: number; quantity?: number }>();
      for (const it of normalized) {
        if (!uniqueByIndex.has(it.itemIndex)) uniqueByIndex.set(it.itemIndex, it);
      }

      let existingItemRows: Array<{ item_index: number; amount_credited: string }> = [];
      try {
        existingItemRows = await query(
          `SELECT item_index, amount_credited FROM credit_note_items WHERE order_id = ?`,
          [id]
        ) as { item_index: number; amount_credited: string }[];
      } catch (e: any) {
        if (!String(e?.message || '').toLowerCase().includes('credit_note_items')) {
          throw e;
        }
      }
      const creditedByItemIndex: Record<number, number> = {};
      existingNCs
        .filter((r) => (r.scope || '') === 'item' && typeof r.item_index === 'number')
        .forEach((r) => {
          const idx = Number(r.item_index);
          creditedByItemIndex[idx] = (creditedByItemIndex[idx] || 0) + Number(r.amount_credited || 0);
        });
      existingItemRows.forEach((r) => {
        const idx = Number(r.item_index);
        if (!Number.isFinite(idx)) return;
        creditedByItemIndex[idx] = (creditedByItemIndex[idx] || 0) + Number(r.amount_credited || 0);
      });

      amountToCredit = 0;
      for (const it of uniqueByIndex.values()) {
        const idx = it.itemIndex;
        if (isNaN(idx) || idx < 0 || idx >= items.length) {
          return res.status(400).json({ message: `itemIndex debe ser entre 0 y ${items.length - 1}` });
        }
        const item = items[idx];
        const qty = it.quantity != null ? it.quantity : item.quantity;
        if (isNaN(qty) || qty <= 0 || qty > item.quantity) {
          return res.status(400).json({ message: `quantity debe ser entre 1 y ${item.quantity} para el ítem ${idx + 1}` });
        }
        const price = Number(item.price_at_moment) || 0;
        const amount = Math.round(qty * price * 100) / 100;
        if (amount <= 0) {
          return res.status(400).json({ message: `El monto a creditar del ítem ${idx + 1} es 0.` });
        }
        const itemLineTotal = Math.round(Number(item.quantity) * price * 100) / 100;
        const yaCreditadoItem = creditedByItemIndex[idx] || 0;
        if (yaCreditadoItem + amount > itemLineTotal + 0.01) {
          return res.status(400).json({
            message: `No se puede creditar más de lo facturado para el ítem ${idx + 1}. Ya creditado: $${yaCreditadoItem.toFixed(2)}. Máximo a creditar: $${(itemLineTotal - yaCreditadoItem).toFixed(2)}.`,
          });
        }
        selectedItemsForCredit.push({ itemIndex: idx, quantity: qty, amount });
        amountToCredit = Math.round((amountToCredit + amount) * 100) / 100;
      }
    }

    const { emitirNotaCredito: emitirNCAfip } = await import('../services/afip.service');
    const result = await emitirNCAfip(
      { puntoVta: invRow.punto_venta, cbteTipo: invRow.cbte_tipo, cbteDesde: invRow.cbte_desde },
      { id: customerRow.id, businessName: customerRow.business_name ?? '', cuit: customerRow.cuit, condicionIva: customerRow.condicion_iva ?? undefined },
      amountToCredit
    );

    const creditNoteId = uuidv4();
    const scope = tipo;
    const itemIndexVal = tipo === 'item' && selectedItemsForCredit.length === 1 ? selectedItemsForCredit[0].itemIndex : null;
    await execute(
      `INSERT INTO credit_notes (id, order_id, invoice_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, amount_credited, scope, item_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [creditNoteId, id, invRow.id, result.cae, result.caeFchVto || null, result.puntoVta, result.cbteTipo, result.cbteDesde, result.cbteHasta, amountToCredit, scope, itemIndexVal]
    );

    if (scope === 'item' && selectedItemsForCredit.length > 1) {
      for (const it of selectedItemsForCredit) {
        await execute(
          `INSERT INTO credit_note_items (id, credit_note_id, order_id, item_index, quantity, amount_credited)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [uuidv4(), creditNoteId, id, it.itemIndex, it.quantity, it.amount]
        );
      }
    }

    if (scope === 'total') {
      const stockResult = await restoreStockForOrder(id);
      if (!stockResult.success) {
        return res.status(500).json({ message: 'Error actualizando stock después de la nota de crédito total', errors: stockResult.errors });
      }
    } else if (scope === 'item' && selectedItemsForCredit.length > 0) {
      const stockErrors: string[] = [];
      for (const it of selectedItemsForCredit) {
        const stockResult = await restoreStockForOrderItem(id, it.itemIndex, it.quantity);
        if (!stockResult.success) stockErrors.push(...stockResult.errors);
      }
      if (stockErrors.length > 0) {
        return res.status(500).json({ message: 'Error actualizando stock después de la nota de crédito parcial', errors: stockErrors });
      }
    }

    res.status(201).json({
      id: creditNoteId,
      orderId: id,
      invoiceId: invRow.id,
      cae: result.cae,
      caeFchVto: result.caeFchVto,
      puntoVta: result.puntoVta,
      cbteTipo: result.cbteTipo,
      cbteDesde: result.cbteDesde,
      cbteHasta: result.cbteHasta,
      amountCredited: amountToCredit,
      items: scope === 'item' ? selectedItemsForCredit : undefined
    });
  } catch (error: any) {
    console.error('emitirNotaCredito:', error);
    const msg = error?.message || 'Error emitiendo nota de crédito AFIP';
    const upstreamStatus = Number(error?.response?.status || error?.cause?.response?.status || 0);
    const msgLower = String(msg).toLowerCase();
    const status = msgLower.includes('no configurado')
      ? 503
      : (upstreamStatus === 503 || msgLower.includes('service unavailable') || msgLower.includes('(503)')
          ? 503
          : 500);
    res.status(status).json({ message: msg });
  }
};
