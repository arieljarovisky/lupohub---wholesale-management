import { Request, Response } from 'express';
import { query, execute, get } from '../database/db';
import { v4 as uuidv4 } from 'uuid';

/** Listar todos los transportes (express). */
export const getTransportes = async (_req: Request, res: Response) => {
  try {
    const rows = await query(
      `SELECT id, name FROM transportes ORDER BY name ASC`
    );
    res.json((rows || []).map((r: any) => ({ id: r.id, name: r.name })));
  } catch (error: any) {
    console.error('getTransportes:', error);
    res.status(500).json({ message: 'Error listando transportes' });
  }
};

/** Crear transporte. */
export const createTransporte = async (req: Request, res: Response) => {
  try {
    const { name } = req.body as { name?: string };
    const trimmed = (name ?? '').toString().trim();
    if (!trimmed) {
      return res.status(400).json({ message: 'El nombre del transporte es requerido' });
    }
    const id = uuidv4();
    await execute(`INSERT INTO transportes (id, name) VALUES (?, ?)`, [id, trimmed]);
    const created = await get(`SELECT id, name FROM transportes WHERE id = ?`, [id]);
    res.status(201).json(created);
  } catch (error: any) {
    console.error('createTransporte:', error);
    res.status(500).json({ message: 'Error creando transporte' });
  }
};

/** Actualizar transporte. */
export const updateTransporte = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name } = req.body as { name?: string };
    const trimmed = (name ?? '').toString().trim();
    if (!trimmed) {
      return res.status(400).json({ message: 'El nombre del transporte es requerido' });
    }
    const existing = await get(`SELECT id FROM transportes WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ message: 'Transporte no encontrado' });
    await execute(`UPDATE transportes SET name = ? WHERE id = ?`, [trimmed, id]);
    const updated = await get(`SELECT id, name FROM transportes WHERE id = ?`, [id]);
    res.json(updated);
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
