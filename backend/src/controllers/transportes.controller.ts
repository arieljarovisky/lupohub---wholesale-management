import { Request, Response } from 'express';
import { query, execute, get } from '../database/db';
import { v4 as uuidv4 } from 'uuid';

/** Listar todos los transportes (express). */
export const getTransportes = async (_req: Request, res: Response) => {
  try {
    const rows = await query(
      `SELECT id, name, address FROM transportes ORDER BY name ASC`
    );
    res.json((rows || []).map((r: any) => ({ id: r.id, name: r.name, address: r.address ?? undefined })));
  } catch (error: any) {
    console.error('getTransportes:', error);
    res.status(500).json({ message: 'Error listando transportes' });
  }
};

/** Crear transporte. */
export const createTransporte = async (req: Request, res: Response) => {
  try {
    const { name, address } = req.body as { name?: string; address?: string };
    const trimmed = (name ?? '').toString().trim();
    if (!trimmed) {
      return res.status(400).json({ message: 'El nombre del transporte es requerido' });
    }
    const addressVal = (address ?? '').toString().trim() || null;
    const id = uuidv4();
    await execute(`INSERT INTO transportes (id, name, address) VALUES (?, ?, ?)`, [id, trimmed, addressVal]);
    const created = await get(`SELECT id, name, address FROM transportes WHERE id = ?`, [id]);
    res.status(201).json({ id: created.id, name: created.name, address: created.address ?? undefined });
  } catch (error: any) {
    console.error('createTransporte:', error);
    res.status(500).json({ message: 'Error creando transporte' });
  }
};

/** Actualizar transporte. */
export const updateTransporte = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, address } = req.body as { name?: string; address?: string };
    const trimmed = (name ?? '').toString().trim();
    if (!trimmed) {
      return res.status(400).json({ message: 'El nombre del transporte es requerido' });
    }
    const existing = await get(`SELECT id FROM transportes WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ message: 'Transporte no encontrado' });
    const addressVal = (address ?? '').toString().trim() || null;
    await execute(`UPDATE transportes SET name = ?, address = ? WHERE id = ?`, [trimmed, addressVal, id]);
    const updated = await get(`SELECT id, name, address FROM transportes WHERE id = ?`, [id]);
    res.json({ id: updated.id, name: updated.name, address: updated.address ?? undefined });
  } catch (error: any) {
    console.error('updateTransporte:', error);
    res.status(500).json({ message: 'Error actualizando transporte' });
  }
};

/** Eliminar transporte. */
export const deleteTransporte = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await get(`SELECT id FROM transportes WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ message: 'Transporte no encontrado' });
    await execute(`DELETE FROM customer_transportes WHERE transporte_id = ?`, [id]);
    await execute(`DELETE FROM transportes WHERE id = ?`, [id]);
    res.status(204).send();
  } catch (error: any) {
    console.error('deleteTransporte:', error);
    res.status(500).json({ message: 'Error eliminando transporte' });
  }
};
