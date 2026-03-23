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
    phone: row.phone ?? undefined,
    condicionIva: row.condicion_iva ?? undefined,
    priceListId: row.price_list_id ?? undefined,
    transportes: transportes ?? []
  };
}

/** Listar todos los clientes (camelCase para el frontend) con transportes asignados. */
export const getCustomers = async (req: Request, res: Response) => {
  try {
    const rows = await query(
      `SELECT id, seller_id, user_id, name, business_name, email, address, city, cuit, phone, condicion_iva, price_list_id
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
    const result = customers.map((c: any) => ({ ...c, transportes: transportesByCustomer[c.id] ?? [] }));
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
      phone?: string;
      condicionIva?: string;
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
    const phone = (body.phone ?? '').toString().trim() || null;
    const condicionIva = (body.condicionIva ?? '').toString().trim() || null;
    const priceListId = body.priceListId?.trim() || null;

    // Guardar nombre de contacto y razón social en columnas separadas:
    // - Si solo se carga razón social, "name" queda NULL y "business_name" tiene el valor.
    // - Si solo se carga nombre de contacto, "business_name" toma ese valor.
    const sqlName = name || null;
    const sqlBusinessName = businessName || name || null;

    await execute(
      `INSERT INTO customers (id, seller_id, name, business_name, email, address, city, cuit, phone, condicion_iva, price_list_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, sellerId, sqlName, sqlBusinessName, email, address, city, cuit, phone, condicionIva, priceListId]
    );

    const created = await get(
      `SELECT id, seller_id, user_id, name, business_name, email, address, city, cuit, phone, condicion_iva, price_list_id FROM customers WHERE id = ?`,
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

/** Actualizar cliente (ej. vendedor, razón social, price_list_id, etc.). */
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
      phone?: string;
      condicionIva?: string;
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
    if (body.phone !== undefined) { updates.push('phone = ?'); params.push(body.phone?.trim() || null); }
    if (body.condicionIva !== undefined) { updates.push('condicion_iva = ?'); params.push(body.condicionIva?.trim() || null); }
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
      `SELECT id, seller_id, user_id, name, business_name, email, address, city, cuit, phone, condicion_iva, price_list_id FROM customers WHERE id = ?`,
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

/** Crear o vincular usuario de acceso directo a un cliente (rol CUSTOMER). Solo ADMIN. */
export const attachUserToCustomer = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).user;
    if (!authUser || authUser.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Solo administradores pueden asignar usuarios a clientes' });
    }

    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'ID de cliente requerido' });

    const body = req.body as { name?: string; email?: string; password?: string };
    const name = (body.name ?? '').toString().trim();
    const email = (body.email ?? '').toString().trim();
    const password = (body.password ?? '').toString();

    if (!email || !password) {
      return res.status(400).json({ message: 'Email y contraseña son requeridos para crear el usuario del cliente' });
    }

    const existingCustomer = await get(
      'SELECT id, user_id, business_name, name, email FROM customers WHERE id = ?',
      [id]
    );
    if (!existingCustomer) {
      return res.status(404).json({ message: 'Cliente no encontrado' });
    }

    // Si ya tiene user_id asociado, no creamos otro usuario
    if (existingCustomer.user_id) {
      return res.status(400).json({ message: 'Este cliente ya tiene un usuario asignado' });
    }

    // ¿Ya existe un usuario con ese email?
    const existingUser = await get(
      'SELECT id, name, email, role FROM users WHERE email = ?',
      [email]
    );

    let userId: string;
    if (existingUser) {
      // Solo permitimos vincular usuarios de rol CUSTOMER
      if (existingUser.role !== 'CUSTOMER') {
        return res.status(400).json({ message: 'Ya existe un usuario con ese email y no es de tipo CLIENTE' });
      }
      userId = existingUser.id;
    } else {
      // Crear usuario nuevo con rol CUSTOMER
      userId = uuidv4();
      const displayName =
        name ||
        existingCustomer.business_name ||
        existingCustomer.name ||
        email;
      await execute(
        'INSERT INTO users (id, name, email, password, role, commission_percentage) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, displayName, email, password, 'CUSTOMER', 0]
      );
    }

    // Vincular usuario al cliente
    await execute('UPDATE customers SET user_id = ? WHERE id = ?', [userId, id]);

    const updated = await get(
      `SELECT id, seller_id, user_id, name, business_name, email, address, city, cuit, phone, condicion_iva, price_list_id FROM customers WHERE id = ?`,
      [id]
    );
    const links = await query(
      `SELECT t.id AS transporteId, t.name AS transporteName, t.address AS transporteAddress FROM customer_transportes ct JOIN transportes t ON t.id = ct.transporte_id WHERE ct.customer_id = ? ORDER BY t.name`,
      [id]
    );
    const transportes = (links || []).map((l: any) => ({
      id: l.transporteId,
      name: l.transporteName ?? l.transporteId,
      address: l.transporteAddress ?? undefined
    }));

    return res.status(200).json(toCustomer(updated, transportes));
  } catch (error: any) {
    console.error('attachUserToCustomer:', error);
    res.status(500).json({ message: 'Error asignando usuario al cliente', detail: error?.message });
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

/** Importar clientes en lote. Se exige razón social y CUIT. No duplica por CUIT ni por email. */
export const importCustomers = async (req: Request, res: Response) => {
  try {
    const body = req.body as { customers?: Array<{ name?: string; businessName?: string; email?: string; address?: string; city?: string; cuit?: string; phone?: string; condicionIva?: string }>; sellerId?: string };
    const rows = Array.isArray(body.customers) ? body.customers : [];
    const sellerId = body.sellerId?.trim() || null;
    let created = 0;
    let skipped = 0;
    const errors: { row: number; email?: string; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const name = (r.name ?? '').toString().trim();
      const businessName = (r.businessName ?? '').toString().trim();
      let email = (r.email ?? '').toString().trim();
      const address = (r.address ?? '').toString().trim() || null;
      const city = (r.city ?? '').toString().trim() || null;
      const cuit = (r.cuit ?? '').toString().trim() || null;
      const cuitSolo = (cuit || '').replace(/\D/g, '');
      const phone = (r.phone ?? '').toString().trim() || null;
      const condicionIva = (r.condicionIva ?? '').toString().trim() || null;
      const rowNum = i + 1;

      if (!businessName && !name) {
        errors.push({ row: rowNum, message: 'Falta razón social' });
        continue;
      }
      if (!cuit || !cuitSolo) {
        errors.push({ row: rowNum, message: 'Falta CUIT' });
        continue;
      }

      if (!email) {
        email = `importado-${cuitSolo}@sin-email.local`;
      }

      const existingByCuit = cuit ? await get(`SELECT id FROM customers WHERE cuit = ? LIMIT 1`, [cuit]) : null;
      if (existingByCuit) {
        skipped++;
        continue;
      }
      const existingByEmail = await get(`SELECT id FROM customers WHERE email = ? LIMIT 1`, [email]);
      if (existingByEmail) {
        skipped++;
        continue;
      }

      const id = uuidv4();
      const nameVal = name || businessName;
      const businessNameVal = businessName || name;

      try {
        await execute(
          `INSERT INTO customers (id, seller_id, name, business_name, email, address, city, cuit, phone, condicion_iva, price_list_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, sellerId, nameVal, businessNameVal, email, address, city, cuit, phone, condicionIva, null]
        );
        created++;
      } catch (err: any) {
        if (err.code === 'ER_DUP_ENTRY') {
          skipped++;
        } else {
          errors.push({ row: rowNum, email, message: err.message || 'Error al crear' });
        }
      }
    }

    res.json({ created, skipped, errors });
  } catch (error: any) {
    console.error('importCustomers:', error);
    res.status(500).json({ message: 'Error importando clientes' });
  }
};

/** Actualizar CUIT en lote. Recibe lista con identificador (email o razón social) + CUIT; actualiza solo el campo cuit. */
export const bulkUpdateCuit = async (req: Request, res: Response) => {
  try {
    const body = req.body as { updates?: Array<{ email?: string; businessName?: string; cuit: string; newBusinessName?: string; condicionIva?: string }> };
    const updates = Array.isArray(body.updates) ? body.updates : [];
    let updated = 0;
    let notFound = 0;
    const errors: { row: number; message: string }[] = [];

    for (let i = 0; i < updates.length; i++) {
      const u = updates[i];
      const cuit = (u.cuit ?? '').toString().trim().replace(/\D/g, '').slice(0, 11);
      const email = (u.email ?? '').toString().trim() || null;
      const businessName = (u.businessName ?? '').toString().trim() || null;
      const newBusinessName = (u.newBusinessName ?? '').toString().trim() || null;
      const condicionIva = (u.condicionIva ?? '').toString().trim() || null;

      if (!cuit) {
        errors.push({ row: i + 1, message: 'CUIT vacío' });
        continue;
      }
      if (!email && !businessName) {
        errors.push({ row: i + 1, message: 'Falta email o razón social' });
        continue;
      }

      let customer: any = null;
      if (email) {
        customer = await get('SELECT id FROM customers WHERE LOWER(TRIM(email)) = LOWER(?) LIMIT 1', [email]);
      }
      if (!customer && businessName) {
        customer = await get('SELECT id, business_name, condicion_iva FROM customers WHERE TRIM(business_name) = ? LIMIT 1', [businessName]);
      }
      if (!customer) {
        notFound++;
        continue;
      }

      const setClauses: string[] = ['cuit = ?'];
      const params: any[] = [cuit];
      if (newBusinessName) {
        setClauses.push('business_name = ?');
        params.push(newBusinessName);
      }
      if (condicionIva) {
        setClauses.push('condicion_iva = ?');
        params.push(condicionIva);
      }
      params.push(customer.id);
      await execute(`UPDATE customers SET ${setClauses.join(', ')} WHERE id = ?`, params);
      updated++;
    }

    res.json({ updated, notFound, errors });
  } catch (error: any) {
    console.error('bulkUpdateCuit:', error);
    res.status(500).json({ message: 'Error actualizando CUIT en lote' });
  }
};

function roleCanViewSaldos(role: string | undefined): boolean {
  return role === 'ADMIN' || role === 'SELLER' || role === 'WAREHOUSE' || role === 'DEPOSITO';
}

/** Lista saldos pendientes por cliente (pedidos con cobro pendiente, neto de NC). */
export const getSaldosPendientes = async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user || !roleCanViewSaldos(user.role)) {
    return res.status(403).json({ message: 'Sin permiso para ver saldos' });
  }
  const sellerFilter = user.role === 'SELLER' ? ' AND c.seller_id = ?' : '';
  const params: any[] = user.role === 'SELLER' ? [user.id] : [];

  const mapRows = (rows: any[]) =>
    rows.map((r) => ({
      customerId: r.customerId,
      businessName: r.businessName ?? '',
      contactName: r.contactName ?? '',
      cuit: r.cuit ?? '',
      city: r.city ?? '',
      email: r.email ?? '',
      saldoPendiente: Number(r.saldoPendiente) || 0,
      pedidosPendientes: Number(r.pedidosPendientes) || 0
    }));

  const sqlWithNc = `
    SELECT
      c.id AS customerId,
      c.business_name AS businessName,
      c.name AS contactName,
      c.cuit,
      c.city,
      c.email,
      SUM(GREATEST(0, o.total - COALESCE(cn.cn_total, 0))) AS saldoPendiente,
      COUNT(DISTINCT o.id) AS pedidosPendientes
    FROM customers c
    INNER JOIN orders o ON o.customer_id = c.id
    LEFT JOIN (
      SELECT order_id, SUM(amount_credited) AS cn_total
      FROM credit_notes
      GROUP BY order_id
    ) cn ON cn.order_id = o.id
    WHERE o.payment_status = 'pendiente'
      AND o.status NOT IN ('Cancelado', 'Borrador')
      AND (o.archived = 0 OR o.archived IS NULL)
      ${sellerFilter}
    GROUP BY c.id, c.business_name, c.name, c.cuit, c.city, c.email
    HAVING SUM(GREATEST(0, o.total - COALESCE(cn.cn_total, 0))) > 0.01
    ORDER BY c.business_name ASC, c.name ASC
  `;

  const sqlSimple = `
    SELECT
      c.id AS customerId,
      c.business_name AS businessName,
      c.name AS contactName,
      c.cuit,
      c.city,
      c.email,
      SUM(o.total) AS saldoPendiente,
      COUNT(DISTINCT o.id) AS pedidosPendientes
    FROM customers c
    INNER JOIN orders o ON o.customer_id = c.id
    WHERE o.payment_status = 'pendiente'
      AND o.status NOT IN ('Cancelado', 'Borrador')
      AND (o.archived = 0 OR o.archived IS NULL)
      ${sellerFilter}
    GROUP BY c.id, c.business_name, c.name, c.cuit, c.city, c.email
    HAVING SUM(o.total) > 0.01
    ORDER BY c.business_name ASC, c.name ASC
  `;

  try {
    const rows = await query(sqlWithNc, params);
    return res.json(mapRows(rows as any[]));
  } catch (e: any) {
    console.warn('[saldos] consulta con NC falló, reintentando sin NC:', e?.message);
    try {
      const rows = await query(sqlSimple, params);
      return res.json(mapRows(rows as any[]));
    } catch (e2: any) {
      console.error('getSaldosPendientes:', e2);
      return res.status(500).json({ message: 'Error listando saldos pendientes' });
    }
  }
};

/** Exporta saldos pendientes en CSV (UTF-8 con BOM para Excel). */
export const exportSaldosPendientesCsv = async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user || !roleCanViewSaldos(user.role)) {
    return res.status(403).json({ message: 'Sin permiso para exportar saldos' });
  }
  const sellerFilter = user.role === 'SELLER' ? ' AND c.seller_id = ?' : '';
  const params: any[] = user.role === 'SELLER' ? [user.id] : [];

  const sqlWithNc = `
    SELECT
      c.id AS customerId,
      c.business_name AS businessName,
      c.name AS contactName,
      c.cuit,
      c.city,
      c.email,
      SUM(GREATEST(0, o.total - COALESCE(cn.cn_total, 0))) AS saldoPendiente,
      COUNT(DISTINCT o.id) AS pedidosPendientes
    FROM customers c
    INNER JOIN orders o ON o.customer_id = c.id
    LEFT JOIN (
      SELECT order_id, SUM(amount_credited) AS cn_total
      FROM credit_notes
      GROUP BY order_id
    ) cn ON cn.order_id = o.id
    WHERE o.payment_status = 'pendiente'
      AND o.status NOT IN ('Cancelado', 'Borrador')
      AND (o.archived = 0 OR o.archived IS NULL)
      ${sellerFilter}
    GROUP BY c.id, c.business_name, c.name, c.cuit, c.city, c.email
    HAVING SUM(GREATEST(0, o.total - COALESCE(cn.cn_total, 0))) > 0.01
    ORDER BY c.business_name ASC, c.name ASC
  `;

  const sqlSimple = `
    SELECT
      c.id AS customerId,
      c.business_name AS businessName,
      c.name AS contactName,
      c.cuit,
      c.city,
      c.email,
      SUM(o.total) AS saldoPendiente,
      COUNT(DISTINCT o.id) AS pedidosPendientes
    FROM customers c
    INNER JOIN orders o ON o.customer_id = c.id
    WHERE o.payment_status = 'pendiente'
      AND o.status NOT IN ('Cancelado', 'Borrador')
      AND (o.archived = 0 OR o.archived IS NULL)
      ${sellerFilter}
    GROUP BY c.id, c.business_name, c.name, c.cuit, c.city, c.email
    HAVING SUM(o.total) > 0.01
    ORDER BY c.business_name ASC, c.name ASC
  `;

  let rows: any[];
  try {
    rows = (await query(sqlWithNc, params)) as any[];
  } catch {
    rows = (await query(sqlSimple, params)) as any[];
  }

  const header = [
    'id_cliente',
    'razon_social',
    'contacto',
    'cuit',
    'ciudad',
    'email',
    'pedidos_impagos',
    'saldo_pendiente'
  ];
  const lines = [header.join(';')];
  for (const r of rows) {
    const esc = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    lines.push(
      [
        r.customerId,
        esc(r.businessName ?? ''),
        esc(r.contactName ?? ''),
        r.cuit ?? '',
        esc(r.city ?? ''),
        esc(r.email ?? ''),
        Number(r.pedidosPendientes) || 0,
        (Number(r.saldoPendiente) || 0).toFixed(2).replace('.', ',')
      ].join(';')
    );
  }
  const csv = lines.join('\r\n');
  const filename = `saldos_pendientes_${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + csv);
};
