import { Request, Response } from 'express';
import { query, execute, get } from '../database/db';
import { v4 as uuidv4 } from 'uuid';

function toCustomer(row: any, transportes?: { id: string; name: string; address?: string }[]) {
  return {
    id: row.id,
    sellerId: row.seller_id ?? '',
    userId: row.user_id ?? undefined,
    name: row.name ?? '',
    businessName: row.business_name ?? '',
    email: row.email ?? '',
    address: row.address ?? '',
    city: row.city ?? '',
    cuit: row.cuit ?? undefined,
    priceListId: row.price_list_id ?? undefined,
    transportes: transportes ?? []
  };
}

/** Listar todos los clientes (camelCase para el frontend) con transportes asignados. */
export const getCustomers = async (req: Request, res: Response) => {
  try {
    const rows = await query(
      `SELECT id, seller_id, user_id, name, business_name, email, address, city, cuit, price_list_id
       FROM customers ORDER BY business_name ASC, name ASC`
    );
    const customers = (rows || []).map((r: any) => toCustomer(r));
    const ids = customers.map((c: any) => c.id);
    if (ids.length === 0) return res.json(customers);
    const placeholders = ids.map(() => '?').join(',');
    const links = await query(
      `SELECT ct.customer_id AS customerId, t.id AS transporteId, t.name AS transporteName, t.address AS transporteAddress
       FROM customer_transportes ct
       JOIN transportes t ON t.id = ct.transporte_id
       WHERE ct.customer_id IN (${placeholders})
       ORDER BY t.name ASC`,
      ids
    );
    const transportesByCustomer: Record<string, { id: string; name: string; address?: string }[]> = {};
    for (const c of customers) transportesByCustomer[c.id] = [];
    for (const link of (links || []) as any[]) {
      const custId = link.customerId;
      if (transportesByCustomer[custId])
        transportesByCustomer[custId].push({ id: link.transporteId, name: link.transporteName ?? link.transporteId, address: link.transporteAddress ?? undefined });
    }
    const result = customers.map((c: any) => toCustomer(c, transportesByCustomer[c.id] ?? []));
    res.json(result);
  } catch (error: any) {
    console.error('getCustomers:', error);
    res.status(500).json({ message: 'Error listando clientes' });
  }
};

/** Crear cliente. */
export const createCustomer = async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      id?: string;
      sellerId?: string;
      name?: string;
      businessName?: string;
      email?: string;
      address?: string;
      city?: string;
      cuit?: string;
      transporteIds?: string[];
      priceListId?: string;
    };
    const name = (body.name ?? '').toString().trim();
    const businessName = (body.businessName ?? '').toString().trim();
    const email = (body.email ?? '').toString().trim();
    if (!businessName && !name) {
      return res.status(400).json({ message: 'Razón social o nombre de contacto es requerido' });
    }
    if (!email) {
      return res.status(400).json({ message: 'El email es requerido' });
    }

    const id = body.id && body.id.trim() ? body.id.trim() : uuidv4();
    const sellerId = body.sellerId?.trim() || null;
    const address = (body.address ?? '').toString().trim() || null;
    const city = (body.city ?? '').toString().trim() || null;
    const cuit = (body.cuit ?? '').toString().trim() || null;
    const priceListId = body.priceListId?.trim() || null;

    await execute(
      `INSERT INTO customers (id, seller_id, name, business_name, email, address, city, cuit, price_list_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, sellerId, name || businessName, businessName || name, email, address, city, cuit, priceListId]
    );

    const created = await get(
      `SELECT id, seller_id, user_id, name, business_name, email, address, city, cuit, price_list_id FROM customers WHERE id = ?`,
      [id]
    );
    const transporteIds = Array.isArray(body.transporteIds) ? body.transporteIds.filter((x: string) => x && typeof x === 'string') : [];
    for (const tid of transporteIds) {
      await execute(`INSERT IGNORE INTO customer_transportes (customer_id, transporte_id) VALUES (?, ?)`, [id, tid]);
    }
    const links = await query(
      `SELECT t.id AS transporteId, t.name AS transporteName, t.address AS transporteAddress FROM customer_transportes ct JOIN transportes t ON t.id = ct.transporte_id WHERE ct.customer_id = ? ORDER BY t.name`,
      [id]
    );
    const transportes = (links || []).map((l: any) => ({ id: l.transporteId, name: l.transporteName ?? l.transporteId, address: l.transporteAddress ?? undefined }));
    res.status(201).json(toCustomer(created, transportes));
  } catch (error: any) {
    console.error('createCustomer:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Ya existe un cliente con ese ID' });
    }
    res.status(500).json({ message: 'Error creando cliente' });
  }
};

/** Actualizar cliente (ej. price_list_id para clientes con acceso). */
export const updateCustomer = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as {
      name?: string;
      businessName?: string;
      email?: string;
      address?: string;
      city?: string;
      sellerId?: string;
      cuit?: string;
      transporteIds?: string[];
      priceListId?: string | null;
    };
    const existing = await get('SELECT id FROM customers WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ message: 'Cliente no encontrado' });
    const updates: string[] = [];
    const params: any[] = [];
    if (body.name !== undefined) { updates.push('name = ?'); params.push(body.name.trim()); }
    if (body.businessName !== undefined) { updates.push('business_name = ?'); params.push(body.businessName?.trim() || null); }
    if (body.email !== undefined) { updates.push('email = ?'); params.push(body.email?.trim() || null); }
    if (body.address !== undefined) { updates.push('address = ?'); params.push(body.address?.trim() || null); }
    if (body.city !== undefined) { updates.push('city = ?'); params.push(body.city?.trim() || null); }
    if (body.cuit !== undefined) { updates.push('cuit = ?'); params.push(body.cuit?.trim() || null); }
    if (body.sellerId !== undefined) { updates.push('seller_id = ?'); params.push(body.sellerId?.trim() || null); }
    if (body.priceListId !== undefined) { updates.push('price_list_id = ?'); params.push(body.priceListId && body.priceListId.trim() ? body.priceListId.trim() : null); }
    if (updates.length > 0) {
      params.push(id);
      await execute(`UPDATE customers SET ${updates.join(', ')} WHERE id = ?`, params);
    }
    if (body.transporteIds !== undefined) {
      await execute(`DELETE FROM customer_transportes WHERE customer_id = ?`, [id]);
      const transporteIds = Array.isArray(body.transporteIds) ? body.transporteIds.filter((x: string) => x && typeof x === 'string') : [];
      for (const tid of transporteIds) {
        await execute(`INSERT IGNORE INTO customer_transportes (customer_id, transporte_id) VALUES (?, ?)`, [id, tid]);
      }
    }
    const updated = await get(
      `SELECT id, seller_id, user_id, name, business_name, email, address, city, cuit, price_list_id FROM customers WHERE id = ?`,
      [id]
    );
    const links = await query(
      `SELECT t.id AS transporteId, t.name AS transporteName, t.address AS transporteAddress FROM customer_transportes ct JOIN transportes t ON t.id = ct.transporte_id WHERE ct.customer_id = ? ORDER BY t.name`,
      [id]
    );
    const transportes = (links || []).map((l: any) => ({ id: l.transporteId, name: l.transporteName ?? l.transporteId, address: l.transporteAddress ?? undefined }));
    res.json(toCustomer(updated, transportes));
  } catch (error: any) {
    console.error('updateCustomer:', error);
    res.status(500).json({ message: 'Error actualizando cliente' });
  }
};

/** Eliminar cliente. No se permite si tiene pedidos asociados. */
export const deleteCustomer = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await get('SELECT id FROM customers WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ message: 'Cliente no encontrado' });

    const orderRow = await get('SELECT 1 FROM orders WHERE customer_id = ? LIMIT 1', [id]);
    if (orderRow) {
      return res.status(400).json({
        message: 'No se puede eliminar el cliente porque tiene pedidos asociados. Eliminá o reassigná los pedidos primero.'
      });
    }

    await execute('DELETE FROM customers WHERE id = ?', [id]);
    res.status(204).send();
  } catch (error: any) {
    console.error('deleteCustomer:', error);
    res.status(500).json({ message: 'Error eliminando cliente' });
  }
};
