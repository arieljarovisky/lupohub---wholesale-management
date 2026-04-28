import { Request, Response } from 'express';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { query, execute, get } from '../database/db';
import { v4 as uuidv4 } from 'uuid';
import { padLegacyCode } from '../utils/multimediaHistorialExcel';

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
    transportNumber: row.transport_number ?? undefined,
    remitoNumber: row.remito_number ?? undefined,
    saleCondition: row.sale_condition ?? undefined,
    condicionIva: row.condicion_iva ?? undefined,
    priceListId: row.price_list_id ?? undefined,
    legacyCode: row.legacy_code ?? undefined,
    accountZone: row.account_zone ?? undefined,
    accountSellerLabel: row.account_seller_label ?? undefined,
    transportes: transportes ?? []
  };
}

/** Listar todos los clientes (camelCase para el frontend) con transportes asignados. */
export const getCustomers = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).user;
    const sellerFilter = authUser?.role === 'SELLER' ? ' WHERE seller_id = ?' : '';
    const params = authUser?.role === 'SELLER' ? [authUser.id] : [];
    const rows = await query(
      `SELECT id, seller_id, user_id, name, business_name, email, address, city, cuit, phone, transport_number, remito_number, sale_condition, condicion_iva, price_list_id,
              legacy_code, account_zone, account_seller_label
       FROM customers${sellerFilter} ORDER BY business_name ASC, name ASC`,
      params
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

/** Exportar clientes individuales (1 fila por cliente) en CSV. */
export const exportCustomersIndividualCsv = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).user;
    const sellerFilter = authUser?.role === 'SELLER' ? ' WHERE c.seller_id = ?' : '';
    const params = authUser?.role === 'SELLER' ? [authUser.id] : [];
    const rows = await query(
      `SELECT
         c.id,
         c.legacy_code,
         c.business_name,
         c.name,
         c.email,
         c.phone,
         c.cuit,
         c.city,
         c.address,
         c.sale_condition,
         c.condicion_iva,
         c.transport_number,
         c.remito_number,
         c.account_zone,
         c.account_seller_label,
         c.seller_id,
         u.name AS seller_name
       FROM customers c
       LEFT JOIN users u ON u.id = c.seller_id
       ${sellerFilter}
       ORDER BY c.business_name ASC, c.name ASC`,
      params
    );

    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = [
      'id',
      'codigo_legacy',
      'razon_social',
      'contacto',
      'email',
      'telefono',
      'cuit',
      'ciudad',
      'direccion',
      'condicion_venta',
      'condicion_iva',
      'numero_transporte',
      'numero_remito',
      'zona',
      'vendedor_habitual',
      'seller_id',
      'seller_name'
    ];
    const lines = [header.join(';')];
    for (const r of rows as any[]) {
      lines.push([
        r.id ?? '',
        r.legacy_code ?? '',
        esc(r.business_name ?? ''),
        esc(r.name ?? ''),
        esc(r.email ?? ''),
        esc(r.phone ?? ''),
        r.cuit ?? '',
        esc(r.city ?? ''),
        esc(r.address ?? ''),
        esc(r.sale_condition ?? ''),
        esc(r.condicion_iva ?? ''),
        esc(r.transport_number ?? ''),
        esc(r.remito_number ?? ''),
        esc(r.account_zone ?? ''),
        esc(r.account_seller_label ?? ''),
        r.seller_id ?? '',
        esc(r.seller_name ?? '')
      ].join(';'));
    }

    const csv = lines.join('\r\n');
    const filename = `clientes_individuales_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send('\uFEFF' + csv);
  } catch (error: any) {
    console.error('exportCustomersIndividualCsv:', error);
    return res.status(500).json({ message: 'Error exportando clientes individuales' });
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
      transportNumber?: string;
      remitoNumber?: string;
      saleCondition?: string;
      condicionIva?: string;
      transporteIds?: string[];
      priceListId?: string;
      legacyCode?: string;
      accountZone?: string;
      accountSellerLabel?: string;
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
    const transportNumber = (body.transportNumber ?? '').toString().trim() || null;
    const remitoNumber = (body.remitoNumber ?? '').toString().trim() || null;
    const saleCondition = (body.saleCondition ?? '').toString().trim() || null;
    const condicionIva = (body.condicionIva ?? '').toString().trim() || null;
    const priceListId = body.priceListId?.trim() || null;
    const legacyCode = (body.legacyCode ?? '').toString().trim() || null;
    const accountZone = (body.accountZone ?? '').toString().trim() || null;
    const accountSellerLabel = (body.accountSellerLabel ?? '').toString().trim() || null;

    // Guardar nombre de contacto y razón social en columnas separadas:
    // - Si solo se carga razón social, "name" queda NULL y "business_name" tiene el valor.
    // - Si solo se carga nombre de contacto, "business_name" toma ese valor.
    const sqlName = name || null;
    const sqlBusinessName = businessName || name || null;

    await execute(
      `INSERT INTO customers (id, seller_id, name, business_name, email, address, city, cuit, phone, transport_number, remito_number, sale_condition, condicion_iva, price_list_id, legacy_code, account_zone, account_seller_label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, sellerId, sqlName, sqlBusinessName, email, address, city, cuit, phone, transportNumber, remitoNumber, saleCondition, condicionIva, priceListId, legacyCode, accountZone, accountSellerLabel]
    );

    const created = await get(
      `SELECT id, seller_id, user_id, name, business_name, email, address, city, cuit, phone, transport_number, remito_number, sale_condition, condicion_iva, price_list_id, legacy_code, account_zone, account_seller_label FROM customers WHERE id = ?`,
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
      transportNumber?: string;
      remitoNumber?: string;
      saleCondition?: string;
      condicionIva?: string;
      transporteIds?: string[];
      priceListId?: string | null;
      legacyCode?: string;
      accountZone?: string;
      accountSellerLabel?: string;
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
    if (body.transportNumber !== undefined) { updates.push('transport_number = ?'); params.push(body.transportNumber?.trim() || null); }
    if (body.remitoNumber !== undefined) { updates.push('remito_number = ?'); params.push(body.remitoNumber?.trim() || null); }
    if (body.saleCondition !== undefined) { updates.push('sale_condition = ?'); params.push(body.saleCondition?.trim() || null); }
    if (body.condicionIva !== undefined) { updates.push('condicion_iva = ?'); params.push(body.condicionIva?.trim() || null); }
    if (body.sellerId !== undefined) { updates.push('seller_id = ?'); params.push(body.sellerId?.trim() || null); }
    if (body.priceListId !== undefined) { updates.push('price_list_id = ?'); params.push(body.priceListId && body.priceListId.trim() ? body.priceListId.trim() : null); }
    if (body.legacyCode !== undefined) { updates.push('legacy_code = ?'); params.push(body.legacyCode?.trim() || null); }
    if (body.accountZone !== undefined) { updates.push('account_zone = ?'); params.push(body.accountZone?.trim() || null); }
    if (body.accountSellerLabel !== undefined) { updates.push('account_seller_label = ?'); params.push(body.accountSellerLabel?.trim() || null); }
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
      `SELECT id, seller_id, user_id, name, business_name, email, address, city, cuit, phone, transport_number, remito_number, sale_condition, condicion_iva, price_list_id, legacy_code, account_zone, account_seller_label FROM customers WHERE id = ?`,
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
      `SELECT id, seller_id, user_id, name, business_name, email, address, city, cuit, phone, transport_number, remito_number, sale_condition, condicion_iva, price_list_id, legacy_code, account_zone, account_seller_label FROM customers WHERE id = ?`,
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

/** Saldos: pedidos con cobro pendiente (IVA 21% sobre neto, neto de NC) menos pagos/recibos en `payments`. */
export const getSaldosPendientes = async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user || !roleCanViewSaldos(user.role)) {
    return res.status(403).json({ message: 'Sin permiso para ver saldos' });
  }
  const sellerFilter = user.role === 'SELLER' ? ' AND c.seller_id = ?' : '';
  const baseParams: any[] = user.role === 'SELLER' ? [user.id] : [];

  const paymentsJoin =
    user.role === 'SELLER'
      ? `LEFT JOIN (
      SELECT p.customer_id, SUM(p.amount) AS total_pagos
      FROM payments p
      INNER JOIN customers c2 ON c2.id = p.customer_id
      WHERE (p.seller_id = ? OR c2.seller_id = ?)
      GROUP BY p.customer_id
    ) pay ON pay.customer_id = t.customerId`
      : `LEFT JOIN (
      SELECT customer_id, SUM(amount) AS total_pagos
      FROM payments
      GROUP BY customer_id
    ) pay ON pay.customer_id = t.customerId`;

  const payParams: any[] = user.role === 'SELLER' ? [user.id, user.id] : [];
  const paramsWithNc = [...baseParams, ...payParams];
  const paramsSimple = [...baseParams, ...payParams];

  const mapRows = (rows: any[]) =>
    rows.map((r) => ({
      customerId: r.customerId,
      businessName: r.businessName ?? '',
      contactName: r.contactName ?? '',
      cuit: r.cuit ?? '',
      city: r.city ?? '',
      email: r.email ?? '',
      saldoPendiente: Number(r.saldoPendiente) || 0,
      totalCargosPendiente: Number(r.totalCargosPendiente) || 0,
      totalPagos: Number(r.totalPagos) || 0,
      pedidosPendientes: Number(r.pedidosPendientes) || 0
    }));

  const sqlWithNc = `
    SELECT
      t.customerId,
      t.businessName,
      t.contactName,
      t.cuit,
      t.city,
      t.email,
      ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) AS saldoPendiente,
      ROUND(t.cargosPendientes, 2) AS totalCargosPendiente,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      t.pedidosPendientes
    FROM (
      SELECT
        c.id AS customerId,
        c.business_name AS businessName,
        c.name AS contactName,
        c.cuit,
        c.city,
        c.email,
        SUM(ROUND(GREATEST(0, o.total - COALESCE(cn.cn_total, 0)) * 1.21, 2)) AS cargosPendientes,
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
    ) t
    ${paymentsJoin}
    WHERE ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) > 0.01
    ORDER BY t.businessName ASC, t.contactName ASC
  `;

  const sqlSimple = `
    SELECT
      t.customerId,
      t.businessName,
      t.contactName,
      t.cuit,
      t.city,
      t.email,
      ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) AS saldoPendiente,
      ROUND(t.cargosPendientes, 2) AS totalCargosPendiente,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      t.pedidosPendientes
    FROM (
      SELECT
        c.id AS customerId,
        c.business_name AS businessName,
        c.name AS contactName,
        c.cuit,
        c.city,
        c.email,
        SUM(ROUND(o.total * 1.21, 2)) AS cargosPendientes,
        COUNT(DISTINCT o.id) AS pedidosPendientes
      FROM customers c
      INNER JOIN orders o ON o.customer_id = c.id
      WHERE o.payment_status = 'pendiente'
        AND o.status NOT IN ('Cancelado', 'Borrador')
        AND (o.archived = 0 OR o.archived IS NULL)
        ${sellerFilter}
      GROUP BY c.id, c.business_name, c.name, c.cuit, c.city, c.email
    ) t
    ${paymentsJoin}
    WHERE ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) > 0.01
    ORDER BY t.businessName ASC, t.contactName ASC
  `;

  try {
    const rows = await query(sqlWithNc, paramsWithNc);
    return res.json(mapRows(rows as any[]));
  } catch (e: any) {
    console.warn('[saldos] consulta con NC falló, reintentando sin NC:', e?.message);
    try {
      const rows = await query(sqlSimple, paramsSimple);
      return res.json(mapRows(rows as any[]));
    } catch (e2: any) {
      console.error('getSaldosPendientes:', e2);
      return res.status(500).json({ message: 'Error listando saldos pendientes' });
    }
  }
};

/**
 * Cartera unificada por cliente: max(0, C + M − P).
 * C = suma pedidos con cobro pendiente (IVA incl.), M = último saldo cuenta importada (Tango/Multimedias), P = recibos en Facturación.
 * Los pagos se aplican al total (no solo a pedidos LupoHub), para que un recibo descuente también de la cuenta importada.
 */
export const getCarteraTotals = async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user || !roleCanViewSaldos(user.role)) {
    return res.status(403).json({ message: 'Sin permiso para ver saldos' });
  }
  const sellerFilter = user.role === 'SELLER' ? ' AND c.seller_id = ?' : '';
  const baseParams: any[] = user.role === 'SELLER' ? [user.id] : [];

  const paymentsSubquery =
    user.role === 'SELLER'
      ? `SELECT p.customer_id, SUM(p.amount) AS total_pagos
         FROM payments p
         INNER JOIN customers c2 ON c2.id = p.customer_id
         WHERE (p.seller_id = ? OR c2.seller_id = ?)
         GROUP BY p.customer_id`
      : `SELECT customer_id, SUM(amount) AS total_pagos
         FROM payments
         GROUP BY customer_id`;
  const payParams: any[] = user.role === 'SELLER' ? [user.id, user.id] : [];
  const paramsWithNc = [...baseParams, ...payParams];
  const paramsSimple = [...baseParams, ...payParams];

  /** Preferir saldo de la última fila (import PDF escribe ahí SALDO DEL CLIENTE); si NULL, último saldo intermedio. */
  const mmSubquery = `
    SELECT
      agg.customer_id,
      CAST(COALESCE(
        (SELECT CAST(e_lo.saldo AS DECIMAL(16,2))
         FROM customer_multimedia_entries e_lo
         WHERE e_lo.customer_id = agg.customer_id
         ORDER BY e_lo.line_order DESC
         LIMIT 1),
        (SELECT CAST(e2.saldo AS DECIMAL(16,2))
         FROM customer_multimedia_entries e2
         WHERE e2.customer_id = agg.customer_id AND e2.saldo IS NOT NULL
         ORDER BY e2.line_order DESC
         LIMIT 1),
        0
      ) AS DECIMAL(16,2)) AS last_saldo
    FROM (
      SELECT customer_id
      FROM customer_multimedia_entries
      GROUP BY customer_id
    ) agg`;

  const sqlWithNc = `
    SELECT
      c.id AS customerId,
      ROUND(COALESCE(oc.cargos, 0), 2) AS orderCargosPendientes,
      ROUND(COALESCE(mm.last_saldo, 0), 2) AS multimediaSaldo,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      ROUND(GREATEST(0, COALESCE(oc.cargos, 0) + COALESCE(mm.last_saldo, 0) - COALESCE(pay.total_pagos, 0)), 2) AS saldoPendienteUnificado
    FROM customers c
    LEFT JOIN (
      SELECT
        o.customer_id,
        SUM(ROUND(GREATEST(0, o.total - COALESCE(cn.cn_total, 0)) * 1.21, 2)) AS cargos
      FROM orders o
      LEFT JOIN (
        SELECT order_id, SUM(amount_credited) AS cn_total
        FROM credit_notes
        GROUP BY order_id
      ) cn ON cn.order_id = o.id
      WHERE o.payment_status = 'pendiente'
        AND o.status NOT IN ('Cancelado', 'Borrador')
        AND (o.archived = 0 OR o.archived IS NULL)
      GROUP BY o.customer_id
    ) oc ON oc.customer_id = c.id
    LEFT JOIN (${mmSubquery}) mm ON mm.customer_id = c.id
    LEFT JOIN (${paymentsSubquery}) pay ON pay.customer_id = c.id
    WHERE 1=1 ${sellerFilter}
      AND (
        COALESCE(oc.cargos, 0) > 0.005
        OR COALESCE(mm.last_saldo, 0) > 0.005
        OR COALESCE(pay.total_pagos, 0) > 0.005
      )
    ORDER BY c.business_name ASC, c.name ASC
  `;

  const sqlSimple = `
    SELECT
      c.id AS customerId,
      ROUND(COALESCE(oc.cargos, 0), 2) AS orderCargosPendientes,
      ROUND(COALESCE(mm.last_saldo, 0), 2) AS multimediaSaldo,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      ROUND(GREATEST(0, COALESCE(oc.cargos, 0) + COALESCE(mm.last_saldo, 0) - COALESCE(pay.total_pagos, 0)), 2) AS saldoPendienteUnificado
    FROM customers c
    LEFT JOIN (
      SELECT
        o.customer_id,
        SUM(ROUND(o.total * 1.21, 2)) AS cargos
      FROM orders o
      WHERE o.payment_status = 'pendiente'
        AND o.status NOT IN ('Cancelado', 'Borrador')
        AND (o.archived = 0 OR o.archived IS NULL)
      GROUP BY o.customer_id
    ) oc ON oc.customer_id = c.id
    LEFT JOIN (${mmSubquery}) mm ON mm.customer_id = c.id
    LEFT JOIN (${paymentsSubquery}) pay ON pay.customer_id = c.id
    WHERE 1=1 ${sellerFilter}
      AND (
        COALESCE(oc.cargos, 0) > 0.005
        OR COALESCE(mm.last_saldo, 0) > 0.005
        OR COALESCE(pay.total_pagos, 0) > 0.005
      )
    ORDER BY c.business_name ASC, c.name ASC
  `;

  try {
    const rows = await query(sqlWithNc, paramsWithNc);
    return res.json(
      (rows as any[]).map((r) => ({
        customerId: r.customerId,
        orderCargosPendientes: Number(r.orderCargosPendientes) || 0,
        multimediaSaldo: Number(r.multimediaSaldo) || 0,
        totalPagos: Number(r.totalPagos) || 0,
        saldoPendienteUnificado: Number(r.saldoPendienteUnificado) || 0
      }))
    );
  } catch (e: any) {
    console.warn('[cartera-totals] consulta con NC falló, reintentando sin NC:', e?.message);
    try {
      const rows = await query(sqlSimple, paramsSimple);
      return res.json(
        (rows as any[]).map((r) => ({
          customerId: r.customerId,
          orderCargosPendientes: Number(r.orderCargosPendientes) || 0,
          multimediaSaldo: Number(r.multimediaSaldo) || 0,
          totalPagos: Number(r.totalPagos) || 0,
          saldoPendienteUnificado: Number(r.saldoPendienteUnificado) || 0
        }))
      );
    } catch (e2: any) {
      console.error('getCarteraTotals:', e2);
      return res.status(500).json({ message: 'Error listando totales de cartera' });
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
  const baseParams: any[] = user.role === 'SELLER' ? [user.id] : [];
  const paymentsJoin =
    user.role === 'SELLER'
      ? `LEFT JOIN (
      SELECT p.customer_id, SUM(p.amount) AS total_pagos
      FROM payments p
      INNER JOIN customers c2 ON c2.id = p.customer_id
      WHERE (p.seller_id = ? OR c2.seller_id = ?)
      GROUP BY p.customer_id
    ) pay ON pay.customer_id = t.customerId`
      : `LEFT JOIN (
      SELECT customer_id, SUM(amount) AS total_pagos
      FROM payments
      GROUP BY customer_id
    ) pay ON pay.customer_id = t.customerId`;
  const payParams: any[] = user.role === 'SELLER' ? [user.id, user.id] : [];
  const paramsWithNc = [...baseParams, ...payParams];
  const paramsSimple = [...baseParams, ...payParams];

  const sqlWithNc = `
    SELECT
      t.customerId,
      t.businessName,
      t.contactName,
      t.cuit,
      t.city,
      t.email,
      ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) AS saldoPendiente,
      ROUND(t.cargosPendientes, 2) AS totalCargosPendiente,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      t.pedidosPendientes
    FROM (
      SELECT
        c.id AS customerId,
        c.business_name AS businessName,
        c.name AS contactName,
        c.cuit,
        c.city,
        c.email,
        SUM(ROUND(GREATEST(0, o.total - COALESCE(cn.cn_total, 0)) * 1.21, 2)) AS cargosPendientes,
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
    ) t
    ${paymentsJoin}
    WHERE ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) > 0.01
    ORDER BY t.businessName ASC, t.contactName ASC
  `;

  const sqlSimple = `
    SELECT
      t.customerId,
      t.businessName,
      t.contactName,
      t.cuit,
      t.city,
      t.email,
      ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) AS saldoPendiente,
      ROUND(t.cargosPendientes, 2) AS totalCargosPendiente,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      t.pedidosPendientes
    FROM (
      SELECT
        c.id AS customerId,
        c.business_name AS businessName,
        c.name AS contactName,
        c.cuit,
        c.city,
        c.email,
        SUM(ROUND(o.total * 1.21, 2)) AS cargosPendientes,
        COUNT(DISTINCT o.id) AS pedidosPendientes
      FROM customers c
      INNER JOIN orders o ON o.customer_id = c.id
      WHERE o.payment_status = 'pendiente'
        AND o.status NOT IN ('Cancelado', 'Borrador')
        AND (o.archived = 0 OR o.archived IS NULL)
        ${sellerFilter}
      GROUP BY c.id, c.business_name, c.name, c.cuit, c.city, c.email
    ) t
    ${paymentsJoin}
    WHERE ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) > 0.01
    ORDER BY t.businessName ASC, t.contactName ASC
  `;

  let rows: any[];
  try {
    rows = (await query(sqlWithNc, paramsWithNc)) as any[];
  } catch {
    rows = (await query(sqlSimple, paramsSimple)) as any[];
  }

  const header = [
    'id_cliente',
    'razon_social',
    'contacto',
    'cuit',
    'ciudad',
    'email',
    'pedidos_impagos',
    'total_cargos_iva',
    'pagos_registrados',
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
        (Number(r.totalCargosPendiente) || 0).toFixed(2).replace('.', ','),
        (Number(r.totalPagos) || 0).toFixed(2).replace('.', ','),
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

/**
 * Exporta saldos pendientes con detalle de movimientos (facturas/NC/recibos) en Excel.
 * Hoja 1: resumen por cliente + vendedor.
 * Hoja 2: detalle de comprobantes y recibos por cliente.
 */
export const exportSaldosPendientesDetalleXlsx = async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user || !roleCanViewSaldos(user.role)) {
    return res.status(403).json({ message: 'Sin permiso para exportar saldos' });
  }

  try {
    const sellerWhere = user.role === 'SELLER' ? 'WHERE c.seller_id = ?' : '';
    const sellerParams: any[] = user.role === 'SELLER' ? [user.id] : [];

    const movements = await query(
      `
      SELECT
        m.customer_id,
        m.customer_name,
        m.seller_id,
        m.seller_name,
        m.fecha,
        m.tipo,
        m.comprobante,
        m.order_id,
        m.debe,
        m.haber
      FROM (
        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          COALESCE(i.created_at, o.date) AS fecha,
          'FACTURA' AS tipo,
          CONCAT(
            CASE
              WHEN i.cbte_tipo = 1 THEN 'A '
              WHEN i.cbte_tipo = 6 THEN 'B '
              ELSE ''
            END,
            LPAD(COALESCE(i.punto_venta, 0), 5, '0'),
            '-',
            LPAD(COALESCE(i.cbte_desde, 0), 8, '0')
          ) AS comprobante,
          o.id AS order_id,
          ROUND(COALESCE(o.total, 0) * 1.21, 2) AS debe,
          0 AS haber
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN users u ON u.id = c.seller_id

        UNION ALL

        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          cn.created_at AS fecha,
          'NOTA_CREDITO' AS tipo,
          CONCAT(
            CASE
              WHEN cn.cbte_tipo = 3 THEN 'NC A '
              WHEN cn.cbte_tipo = 8 THEN 'NC B '
              ELSE 'NC '
            END,
            LPAD(COALESCE(cn.punto_venta, 0), 5, '0'),
            '-',
            LPAD(COALESCE(cn.cbte_desde, 0), 8, '0')
          ) AS comprobante,
          cn.order_id AS order_id,
          0 AS debe,
          ROUND(COALESCE(cn.amount_credited, 0) * 1.21, 2) AS haber
        FROM credit_notes cn
        JOIN orders o ON o.id = cn.order_id
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN users u ON u.id = c.seller_id

        UNION ALL

        SELECT
          c.id AS customer_id,
          COALESCE(c.business_name, c.name, 'Cliente') AS customer_name,
          c.seller_id AS seller_id,
          u.name AS seller_name,
          p.date AS fecha,
          'RECIBO' AS tipo,
          p.receipt_number AS comprobante,
          p.order_id AS order_id,
          0 AS debe,
          ROUND(COALESCE(p.amount, 0), 2) AS haber
        FROM payments p
        JOIN customers c ON c.id = p.customer_id
        LEFT JOIN users u ON u.id = c.seller_id
      ) m
      ${user.role === 'SELLER' ? 'WHERE m.seller_id = ?' : ''}
      ORDER BY m.customer_name ASC, m.fecha ASC, m.tipo ASC
      `,
      sellerParams
    ) as Array<{
      customer_id: string;
      customer_name: string;
      seller_id: string | null;
      seller_name: string | null;
      fecha: string;
      tipo: 'FACTURA' | 'NOTA_CREDITO' | 'RECIBO';
      comprobante: string;
      order_id: string | null;
      debe: number;
      haber: number;
    }>;

    const customers = await query(
      `SELECT c.id, COALESCE(c.business_name, c.name, 'Cliente') AS customer_name, c.seller_id, u.name AS seller_name
       FROM customers c
       LEFT JOIN users u ON u.id = c.seller_id
       ${sellerWhere}
       ORDER BY customer_name ASC`,
      sellerParams
    ) as Array<{ id: string; customer_name: string; seller_id: string | null; seller_name: string | null }>;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'LupoHub';
    workbook.created = new Date();

    const wsSummary = workbook.addWorksheet('Resumen');
    wsSummary.columns = [
      { header: 'Cliente', key: 'cliente', width: 40 },
      { header: 'Vendedor', key: 'vendedor', width: 28 },
      { header: 'Total Facturas', key: 'facturas', width: 16 },
      { header: 'Total NC', key: 'nc', width: 14 },
      { header: 'Total Recibos', key: 'recibos', width: 16 },
      { header: 'Saldo Pendiente', key: 'saldo', width: 18 }
    ];

    const wsDetail = workbook.addWorksheet('Detalle');
    wsDetail.columns = [
      { header: 'Cliente', key: 'cliente', width: 40 },
      { header: 'Vendedor', key: 'vendedor', width: 28 },
      { header: 'Fecha', key: 'fecha', width: 14 },
      { header: 'Tipo', key: 'tipo', width: 14 },
      { header: 'Comprobante', key: 'comprobante', width: 24 },
      { header: 'Pedido', key: 'pedido', width: 16 },
      { header: 'Debe', key: 'debe', width: 14 },
      { header: 'Haber', key: 'haber', width: 14 },
      { header: 'Saldo Cliente', key: 'saldo', width: 16 }
    ];

    const byCustomer = new Map<string, typeof movements>();
    for (const m of movements) {
      if (!byCustomer.has(m.customer_id)) byCustomer.set(m.customer_id, []);
      byCustomer.get(m.customer_id)!.push(m);
    }

    for (const c of customers) {
      const movs = byCustomer.get(c.id) || [];
      let totalFacturas = 0;
      let totalNc = 0;
      let totalRecibos = 0;
      let running = 0;

      for (const m of movs) {
        const debe = Number(m.debe || 0);
        const haber = Number(m.haber || 0);
        running = Math.round((running + debe - haber) * 100) / 100;

        if (m.tipo === 'FACTURA') totalFacturas += debe;
        else if (m.tipo === 'NOTA_CREDITO') totalNc += haber;
        else totalRecibos += haber;

        wsDetail.addRow({
          cliente: c.customer_name,
          vendedor: c.seller_name ?? c.seller_id ?? '',
          fecha: m.fecha ? new Date(m.fecha) : null,
          tipo: m.tipo === 'NOTA_CREDITO' ? 'NC' : m.tipo,
          comprobante: m.comprobante,
          pedido: m.order_id ?? '',
          debe,
          haber,
          saldo: running
        });
      }

      const saldoPendiente = Math.round(Math.max(0, running) * 100) / 100;
      if (saldoPendiente > 0.01) {
        wsSummary.addRow({
          cliente: c.customer_name,
          vendedor: c.seller_name ?? c.seller_id ?? '',
          facturas: totalFacturas,
          nc: totalNc,
          recibos: totalRecibos,
          saldo: saldoPendiente
        });
      }
    }

    const moneyColsSummary = ['C', 'D', 'E', 'F'];
    for (const col of moneyColsSummary) wsSummary.getColumn(col).numFmt = '#,##0.00';
    wsSummary.getRow(1).font = { bold: true };
    wsSummary.views = [{ state: 'frozen', ySplit: 1 }];

    wsDetail.getColumn('C').numFmt = 'dd/mm/yyyy';
    wsDetail.getColumn('G').numFmt = '#,##0.00';
    wsDetail.getColumn('H').numFmt = '#,##0.00';
    wsDetail.getColumn('I').numFmt = '#,##0.00';
    wsDetail.getRow(1).font = { bold: true };
    wsDetail.views = [{ state: 'frozen', ySplit: 1 }];

    const out = await workbook.xlsx.writeBuffer();
    const buf = Buffer.from(out instanceof ArrayBuffer ? new Uint8Array(out) : new Uint8Array(out as ArrayBufferLike));
    const filename = `saldos_pendientes_detalle_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buf);
  } catch (error: any) {
    console.error('exportSaldosPendientesDetalleXlsx:', error);
    return res.status(500).json({ message: 'Error exportando saldos pendientes detallados' });
  }
};

type MergedResumenRow = {
  customerId: string;
  legacy_code: unknown;
  account_zone: unknown;
  account_seller_label: unknown;
  seller_id: unknown;
  businessName: string;
  contactName: string;
  cuit: string;
  saldoPendiente: number;
  /** Cargos pedidos LupoHub (IVA incl.) antes de unificar con cuenta importada. */
  totalCargosPendiente: number;
  /** Recibos en Facturación (misma base que getCarteraTotals). */
  totalPagos: number;
  multimediaSaldo: number;
  pedidosPendientes: number;
  seller_name?: string;
  /** Líneas importadas en customer_multimedia_entries (como en export historial Multimedias). */
  movementCountExcel: number;
};

/**
 * Excel una sola hoja "Resumen" estilizada: Código, Cliente, Vendedor habitual, Zona, Saldo final, Movimientos.
 * Saldo final = max(0, C + M − P): pedidos pendientes IVA + último saldo cuenta importada − pagos registrados.
 * Movimientos = líneas en historial importado + cantidad de pedidos pendientes (misma idea que cartera unificada).
 * Incluye clientes con saldo solo en cuenta importada aunque no tengan pedidos pendientes en LupoHub.
 */
export const exportSaldosPendientesMultimediasXlsx = async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user || !roleCanViewSaldos(user.role)) {
    return res.status(403).json({ message: 'Sin permiso para exportar saldos' });
  }
  const sellerFilter = user.role === 'SELLER' ? ' AND c.seller_id = ?' : '';
  const baseParams: any[] = user.role === 'SELLER' ? [user.id] : [];
  const paymentsJoin =
    user.role === 'SELLER'
      ? `LEFT JOIN (
      SELECT p.customer_id, SUM(p.amount) AS total_pagos
      FROM payments p
      INNER JOIN customers c2 ON c2.id = p.customer_id
      WHERE (p.seller_id = ? OR c2.seller_id = ?)
      GROUP BY p.customer_id
    ) pay ON pay.customer_id = t.customerId`
      : `LEFT JOIN (
      SELECT customer_id, SUM(amount) AS total_pagos
      FROM payments
      GROUP BY customer_id
    ) pay ON pay.customer_id = t.customerId`;
  const payParams: any[] = user.role === 'SELLER' ? [user.id, user.id] : [];
  const paramsWithNc = [...baseParams, ...payParams];
  const paramsSimple = [...baseParams, ...payParams];

  const payMmJoin =
    user.role === 'SELLER'
      ? `LEFT JOIN (
      SELECT p.customer_id, SUM(p.amount) AS total_pagos
      FROM payments p
      INNER JOIN customers c2 ON c2.id = p.customer_id
      WHERE (p.seller_id = ? OR c2.seller_id = ?)
      GROUP BY p.customer_id
    ) pay_mm ON pay_mm.customer_id = c.id`
      : `LEFT JOIN (
      SELECT customer_id, SUM(amount) AS total_pagos
      FROM payments
      GROUP BY customer_id
    ) pay_mm ON pay_mm.customer_id = c.id`;
  const mmParams = [...baseParams, ...payParams];

  const sqlWithNc = `
    SELECT
      t.customerId,
      t.legacy_code,
      t.account_zone,
      t.account_seller_label,
      t.seller_id,
      t.businessName,
      t.contactName,
      t.cuit,
      ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) AS saldoPendiente,
      ROUND(t.cargosPendientes, 2) AS totalCargosPendiente,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      t.pedidosPendientes,
      u.name AS seller_name
    FROM (
      SELECT
        c.id AS customerId,
        c.legacy_code,
        c.account_zone,
        c.account_seller_label,
        c.seller_id,
        c.business_name AS businessName,
        c.name AS contactName,
        c.cuit,
        SUM(ROUND(GREATEST(0, o.total - COALESCE(cn.cn_total, 0)) * 1.21, 2)) AS cargosPendientes,
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
      GROUP BY c.id, c.legacy_code, c.account_zone, c.account_seller_label, c.seller_id, c.business_name, c.name, c.cuit
    ) t
    LEFT JOIN users u ON u.id = t.seller_id
    ${paymentsJoin}
    ORDER BY t.businessName ASC, t.contactName ASC
  `;

  const sqlSimple = `
    SELECT
      t.customerId,
      t.legacy_code,
      t.account_zone,
      t.account_seller_label,
      t.seller_id,
      t.businessName,
      t.contactName,
      t.cuit,
      ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) AS saldoPendiente,
      ROUND(t.cargosPendientes, 2) AS totalCargosPendiente,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      t.pedidosPendientes,
      u.name AS seller_name
    FROM (
      SELECT
        c.id AS customerId,
        c.legacy_code,
        c.account_zone,
        c.account_seller_label,
        c.seller_id,
        c.business_name AS businessName,
        c.name AS contactName,
        c.cuit,
        SUM(ROUND(o.total * 1.21, 2)) AS cargosPendientes,
        COUNT(DISTINCT o.id) AS pedidosPendientes
      FROM customers c
      INNER JOIN orders o ON o.customer_id = c.id
      WHERE o.payment_status = 'pendiente'
        AND o.status NOT IN ('Cancelado', 'Borrador')
        AND (o.archived = 0 OR o.archived IS NULL)
        ${sellerFilter}
      GROUP BY c.id, c.legacy_code, c.account_zone, c.account_seller_label, c.seller_id, c.business_name, c.name, c.cuit
    ) t
    LEFT JOIN users u ON u.id = t.seller_id
    ${paymentsJoin}
    ORDER BY t.businessName ASC, t.contactName ASC
  `;

  let rows: any[];
  try {
    rows = (await query(sqlWithNc, paramsWithNc)) as any[];
  } catch {
    rows = (await query(sqlSimple, paramsSimple)) as any[];
  }

  const sqlMultimediaSaldos = `
    SELECT
      c.id AS customerId,
      c.legacy_code,
      c.account_zone,
      c.account_seller_label,
      c.seller_id,
      c.business_name AS businessName,
      c.name AS contactName,
      c.cuit,
      CAST(COALESCE(
        (SELECT CAST(e_lo.saldo AS DECIMAL(16,2))
         FROM customer_multimedia_entries e_lo
         WHERE e_lo.customer_id = agg.customer_id
         ORDER BY e_lo.line_order DESC
         LIMIT 1),
        (SELECT CAST(e2.saldo AS DECIMAL(16,2))
         FROM customer_multimedia_entries e2
         WHERE e2.customer_id = agg.customer_id AND e2.saldo IS NOT NULL
         ORDER BY e2.line_order DESC
         LIMIT 1),
        0
      ) AS DECIMAL(16,2)) AS lastSaldo,
      agg.cnt AS movementCount,
      ROUND(COALESCE(pay_mm.total_pagos, 0), 2) AS totalPagos,
      u.name AS seller_name
    FROM (
      SELECT customer_id, COUNT(*) AS cnt
      FROM customer_multimedia_entries
      GROUP BY customer_id
    ) agg
    INNER JOIN customers c ON c.id = agg.customer_id
    LEFT JOIN users u ON u.id = c.seller_id
    ${payMmJoin}
    WHERE 1=1 ${sellerFilter}
  `;

  let mmRows: any[] = [];
  try {
    mmRows = (await query(sqlMultimediaSaldos, mmParams)) as any[];
  } catch {
    mmRows = [];
  }

  const byId = new Map<string, MergedResumenRow>();
  for (const r of rows) {
    const id = String(r.customerId);
    const C = Number(r.totalCargosPendiente) || 0;
    const P = Number(r.totalPagos) || 0;
    byId.set(id, {
      customerId: id,
      legacy_code: r.legacy_code,
      account_zone: r.account_zone,
      account_seller_label: r.account_seller_label,
      seller_id: r.seller_id,
      businessName: String(r.businessName ?? ''),
      contactName: String(r.contactName ?? ''),
      cuit: String(r.cuit ?? ''),
      totalCargosPendiente: C,
      totalPagos: P,
      multimediaSaldo: 0,
      saldoPendiente: Math.round(Math.max(0, C + 0 - P) * 100) / 100,
      pedidosPendientes: Number(r.pedidosPendientes) || 0,
      seller_name: r.seller_name,
      movementCountExcel: 0
    });
  }
  for (const m of mmRows) {
    const id = String(m.customerId);
    const excelSaldo = Number(m.lastSaldo) || 0;
    const mmCnt = Number(m.movementCount) || 0;
    const Pmm = Number(m.totalPagos) || 0;
    const existing = byId.get(id);
    const C = existing?.totalCargosPendiente ?? 0;
    const P = existing?.totalPagos ?? Pmm;
    const unified = Math.round(Math.max(0, C + excelSaldo - P) * 100) / 100;
    if (existing) {
      existing.multimediaSaldo = excelSaldo;
      existing.totalPagos = P;
      existing.saldoPendiente = unified;
      existing.movementCountExcel = mmCnt;
    } else {
      byId.set(id, {
        customerId: id,
        legacy_code: m.legacy_code,
        account_zone: m.account_zone,
        account_seller_label: m.account_seller_label,
        seller_id: m.seller_id,
        businessName: String(m.businessName ?? ''),
        contactName: String(m.contactName ?? ''),
        cuit: String(m.cuit ?? ''),
        totalCargosPendiente: 0,
        totalPagos: Pmm,
        multimediaSaldo: excelSaldo,
        saldoPendiente: Math.round(Math.max(0, 0 + excelSaldo - Pmm) * 100) / 100,
        pedidosPendientes: 0,
        seller_name: m.seller_name,
        movementCountExcel: mmCnt
      });
    }
  }

  const mergedList = [...byId.values()]
    .filter((r) => r.saldoPendiente > 0.01)
    .sort((a, b) =>
      (a.businessName || '').localeCompare(b.businessName || '', 'es') ||
      (a.contactName || '').localeCompare(b.contactName || '', 'es')
    );

  const borderThin = {
    style: 'thin' as const,
    color: { argb: 'FF94A3B8' }
  };

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'LupoHub';
  workbook.created = new Date();
  const ws = workbook.addWorksheet('Resumen', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { defaultRowHeight: 19 }
  });

  ws.columns = [
    { key: 'codigo', width: 14 },
    { key: 'cliente', width: 44 },
    { key: 'vendedor', width: 24 },
    { key: 'zona', width: 18 },
    { key: 'saldo', width: 16 },
    { key: 'movs', width: 13 }
  ];

  const headerTitles = ['Código', 'Cliente', 'Vendedor habitual', 'Zona', 'Saldo final', 'Movimientos'];
  const headerRow = ws.addRow(headerTitles);
  headerRow.height = 26;
  headerRow.eachCell((cell, colNumber) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E40AF' }
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: colNumber >= 5 ? 'right' : 'left',
      wrapText: true
    };
    cell.border = {
      top: borderThin,
      left: borderThin,
      bottom: { style: 'medium', color: { argb: 'FF1E3A8A' } },
      right: borderThin
    };
  });

  let rowNum = 2;
  for (const r of mergedList) {
    const displayName = String(r.businessName || r.contactName || 'Cliente').trim();
    const legacyTrim = r.legacy_code != null ? String(r.legacy_code).trim() : '';
    const code: string =
      legacyTrim ||
      padLegacyCode(String(r.customerId || '').replace(/-/g, '').slice(0, 6) || '0');
    const vendedor: string =
      (r.account_seller_label != null && String(r.account_seller_label).trim() !== ''
        ? String(r.account_seller_label).trim()
        : '') ||
      (r.seller_id && r.seller_name ? `${String(r.seller_id).slice(0, 8)} - ${r.seller_name}` : '');
    const zona: string = r.account_zone != null ? String(r.account_zone).trim() : '';
    const saldoFinal = Number(r.saldoPendiente) || 0;
    const movs = (Number(r.movementCountExcel) || 0) + (Number(r.pedidosPendientes) || 0);

    const dataRow = ws.addRow([code, displayName, vendedor, zona, saldoFinal, movs]);
    const zebra = rowNum % 2 === 0;
    dataRow.eachCell((cell, colNumber) => {
      cell.font = { size: 11, name: 'Calibri', color: { argb: 'FF0F172A' } };
      if (zebra) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF1F5F9' }
        };
      }
      cell.border = {
        top: borderThin,
        left: borderThin,
        bottom: borderThin,
        right: borderThin
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: colNumber >= 5 ? 'right' : 'left',
        wrapText: colNumber === 2 || colNumber === 3
      };
      if (colNumber === 5) {
        cell.numFmt = '#,##0.00';
      }
      if (colNumber === 6) {
        cell.numFmt = '0';
      }
    });
    rowNum++;
  }

  if (mergedList.length > 0) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: mergedList.length + 1, column: 6 }
    };
  }

  const out = await workbook.xlsx.writeBuffer();
  const buf = Buffer.from(out instanceof ArrayBuffer ? new Uint8Array(out) : new Uint8Array(out as ArrayBufferLike));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="saldos_pendientes_resumen_${new Date().toISOString().slice(0, 10)}.xlsx"`
  );
  res.send(buf);
};

function normResumenHeader(s: string): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeNameForCustomerMatch(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function cellStrResumenCell(v: unknown): string {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v)) return String(Math.trunc(v));
  return String(v).trim();
}

/**
 * POST multipart file — hoja Resumen Multimedias: asigna customers.seller_id según "Vendedor habitual"
 * (código numérico) vinculado al usuario vendedor.{codigo}@importado.lupohub.local.
 * Cliente: por legacy_code (columna Código) o por nombre (columna Cliente).
 */
export const assignCustomerSellersFromResumen = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).user;
    if (!authUser || authUser.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Solo administradores pueden asignar vendedores en lote' });
    }
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file?.buffer) {
      return res.status(400).json({ message: 'Subí un archivo .xlsx (campo file)' });
    }
    const wb = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return res.status(400).json({ message: 'El archivo no tiene hojas' });
    const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as (string | number | null | undefined)[][];

    let headerRow = -1;
    let codigoCol = -1;
    let vendCol = -1;
    let clienteCol = -1;
    for (let r = 0; r < Math.min(15, matrix.length); r++) {
      const h = matrix[r].map((c) => normResumenHeader(String(c ?? '')));
      const ci = h.findIndex((x) => x === 'codigo');
      const vi = h.findIndex((x) => x.includes('vendedor') && x.includes('habitual'));
      const cl = h.findIndex((x) => x.includes('cliente') && !x.includes('vendedor'));
      if (ci >= 0 && vi >= 0) {
        headerRow = r;
        codigoCol = ci;
        vendCol = vi;
        clienteCol = cl >= 0 ? cl : 1;
        break;
      }
    }
    if (headerRow < 0) {
      return res.status(400).json({
        message: 'No se encontró formato Resumen (columnas Código y Vendedor habitual). Usá el Excel historial Multimedias.',
      });
    }

    const custRows = (await query(`SELECT id, legacy_code, business_name, name FROM customers`)) as any[];
    const legacyToId = new Map<string, string>();
    const normToId = new Map<string, string>();
    for (const c of custRows) {
      const lc = (c.legacy_code && String(c.legacy_code).trim()) || '';
      if (lc) {
        legacyToId.set(lc, c.id);
        legacyToId.set(padLegacyCode(lc), c.id);
        const strip = lc.replace(/^0+/, '') || '0';
        legacyToId.set(strip, c.id);
        const digits = lc.replace(/\D/g, '');
        if (digits && /^\d+$/.test(digits)) {
          legacyToId.set(digits, c.id);
          legacyToId.set(padLegacyCode(digits), c.id);
        }
      }
      const bn = normalizeNameForCustomerMatch(c.business_name);
      if (bn) normToId.set(bn, c.id);
      const nm = normalizeNameForCustomerMatch(c.name);
      if (nm) normToId.set(nm, c.id);
    }

    let rowsProcessed = 0;
    let customersUpdated = 0;
    let skippedNoSeller = 0;
    let skippedNoCustomer = 0;
    let skippedNoVendedorCell = 0;

    for (let i = headerRow + 1; i < matrix.length; i++) {
      const row = matrix[i];
      const codigoRaw = cellStrResumenCell(row[codigoCol]);
      const vendRaw = cellStrResumenCell(row[vendCol]);
      const clienteRaw = clienteCol >= 0 ? cellStrResumenCell(row[clienteCol]) : '';
      if (!codigoRaw && !clienteRaw) continue;
      rowsProcessed++;

      if (!vendRaw) {
        skippedNoVendedorCell++;
        continue;
      }

      const vm = vendRaw.match(/^(\d+)\s*[-–—]\s*(.+)$/u);
      const vendCode = vm ? vm[1].trim().replace(/^0+/, '') || vm[1].trim() || '0' : null;
      if (!vendCode) {
        skippedNoSeller++;
        continue;
      }

      const sellerEmail = `vendedor.${vendCode}@importado.lupohub.local`;
      const sellerRow = await get(`SELECT id FROM users WHERE email = ? AND role = 'SELLER'`, [sellerEmail]);
      if (!sellerRow?.id) {
        skippedNoSeller++;
        continue;
      }

      let customerId: string | undefined;
      if (codigoRaw) {
        const t = codigoRaw.trim();
        const tryKeys = new Set<string>([t]);
        const digits = t.replace(/\D/g, '');
        if (digits) {
          tryKeys.add(digits);
          tryKeys.add(padLegacyCode(digits));
          tryKeys.add(digits.replace(/^0+/, '') || '0');
        }
        for (const k of tryKeys) {
          const hit = legacyToId.get(k);
          if (hit) {
            customerId = hit;
            break;
          }
        }
      }
      if (!customerId && clienteRaw) {
        customerId = normToId.get(normalizeNameForCustomerMatch(clienteRaw));
      }
      if (!customerId) {
        skippedNoCustomer++;
        continue;
      }

      await execute(`UPDATE customers SET seller_id = ? WHERE id = ?`, [sellerRow.id, customerId]);
      customersUpdated++;
    }

    res.json({
      message: 'Asignación de vendedores desde Resumen finalizada',
      rowsProcessed,
      customersUpdated,
      skippedNoSeller,
      skippedNoCustomer,
      skippedNoVendedorCell,
    });
  } catch (e: any) {
    console.error('assignCustomerSellersFromResumen:', e);
    res.status(500).json({ message: 'Error asignando vendedores', detail: e?.message });
  }
};

/** Quita pendientes de pedidos ya despachados para un cliente:
 *  - Si quantity > picked, deja quantity = picked (solo lo enviado)
 *  - Elimina renglones con quantity <= 0
 *  - Recalcula total del pedido
 */
export const clearDispatchedPendingsForCustomer = async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).user;
    if (!authUser || !['ADMIN', 'SELLER', 'WAREHOUSE', 'DEPOSITO'].includes(authUser.role)) {
      return res.status(403).json({ message: 'Sin permisos para quitar pendientes' });
    }

    const { id: customerId } = req.params;
    if (!customerId) return res.status(400).json({ message: 'ID de cliente requerido' });

    const customer = await get('SELECT id, seller_id FROM customers WHERE id = ?', [customerId]);
    if (!customer) return res.status(404).json({ message: 'Cliente no encontrado' });

    if (authUser.role === 'SELLER' && customer.seller_id && customer.seller_id !== authUser.id) {
      return res.status(403).json({ message: 'Solo podés operar sobre tus clientes' });
    }

    const dispatchedOrders = await query(
      `SELECT id FROM orders
       WHERE customer_id = ?
         AND status IN ('Despachado', 'DISPATCHED')`,
      [customerId]
    );
    const orderIds = (dispatchedOrders || []).map((o: any) => o.id).filter(Boolean);
    if (orderIds.length === 0) {
      return res.json({ message: 'No hay pedidos despachados para ajustar', ordersUpdated: 0, itemsAdjusted: 0, itemsRemoved: 0 });
    }

    let itemsAdjusted = 0;
    let itemsRemoved = 0;
    let ordersUpdated = 0;

    for (const orderId of orderIds) {
      const beforeAdjust = await get(
        `SELECT COUNT(*) AS cnt
         FROM order_items
         WHERE order_id = ? AND quantity > COALESCE(picked, 0)`,
        [orderId]
      );
      const toAdjust = Number(beforeAdjust?.cnt || 0);

      if (toAdjust > 0) {
        await execute(
          `UPDATE order_items
           SET quantity = COALESCE(picked, 0)
           WHERE order_id = ? AND quantity > COALESCE(picked, 0)`,
          [orderId]
        );
        itemsAdjusted += toAdjust;
      }

      const beforeDelete = await get(
        `SELECT COUNT(*) AS cnt FROM order_items WHERE order_id = ? AND quantity <= 0`,
        [orderId]
      );
      const toDelete = Number(beforeDelete?.cnt || 0);
      if (toDelete > 0) {
        await execute(`DELETE FROM order_items WHERE order_id = ? AND quantity <= 0`, [orderId]);
        itemsRemoved += toDelete;
      }

      const totalRow = await get(
        `SELECT COALESCE(SUM(quantity * price_at_moment), 0) AS total
         FROM order_items
         WHERE order_id = ?`,
        [orderId]
      );
      await execute(`UPDATE orders SET total = ? WHERE id = ?`, [Number(totalRow?.total || 0), orderId]);
      if (toAdjust > 0 || toDelete > 0) ordersUpdated++;
    }

    return res.json({
      message: 'Pendientes de pedidos despachados ajustados',
      ordersUpdated,
      itemsAdjusted,
      itemsRemoved
    });
  } catch (error: any) {
    console.error('clearDispatchedPendingsForCustomer:', error);
    res.status(500).json({ message: 'Error quitando pendientes de pedidos despachados' });
  }
};
