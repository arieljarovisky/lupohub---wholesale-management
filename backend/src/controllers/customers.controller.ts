import { Request, Response } from 'express';
import { query, execute, get } from '../database/db';
import { v4 as uuidv4 } from 'uuid';

function toCustomer(row: any) {
  return {
    id: row.id,
    sellerId: row.seller_id ?? '',
    name: row.name ?? '',
    businessName: row.business_name ?? '',
    email: row.email ?? '',
    address: row.address ?? '',
    city: row.city ?? ''
  };
}

/** Listar todos los clientes (camelCase para el frontend). */
export const getCustomers = async (req: Request, res: Response) => {
  try {
    const rows = await query(
      `SELECT id, seller_id, name, business_name, email, address, city 
       FROM customers ORDER BY business_name ASC, name ASC`
    );
    const customers = (rows || []).map(toCustomer);
    res.json(customers);
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

    await execute(
      `INSERT INTO customers (id, seller_id, name, business_name, email, address, city) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, sellerId, name || businessName, businessName || name, email, address, city]
    );

    const created = await get(
      `SELECT id, seller_id, name, business_name, email, address, city FROM customers WHERE id = ?`,
      [id]
    );
    res.status(201).json(toCustomer(created));
  } catch (error: any) {
    console.error('createCustomer:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Ya existe un cliente con ese ID' });
    }
    res.status(500).json({ message: 'Error creando cliente' });
  }
};
