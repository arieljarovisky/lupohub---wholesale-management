import { Request, Response } from 'express';
import { query, execute, get } from '../database/db';
import { v4 as uuidv4 } from 'uuid';

/** Listar usuarios (sin password). Solo ADMIN. */
export const listUsers = async (req: Request, res: Response) => {
  try {
    if ((req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Solo administradores pueden listar usuarios' });
    }
    const rows = await query(
      `SELECT id, name, email, role, commission_percentage AS commissionPercentage 
       FROM users ORDER BY name`
    );
    res.json(rows);
  } catch (error: any) {
    console.error('listUsers:', error);
    res.status(500).json({ message: 'Error listando usuarios' });
  }
};

/** Crear usuario. Solo ADMIN. */
export const createUser = async (req: Request, res: Response) => {
  try {
    if ((req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Solo administradores pueden crear usuarios' });
    }
    const { name, email, password, role, commissionPercentage } = req.body as {
      name?: string;
      email?: string;
      password?: string;
      role?: string;
      commissionPercentage?: number;
    };
    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ message: 'Nombre, email y contraseña son requeridos' });
    }
    const validRoles = ['ADMIN', 'SELLER', 'WAREHOUSE'];
    const roleVal = (role || 'SELLER').toString().toUpperCase();
    if (!validRoles.includes(roleVal)) {
      return res.status(400).json({ message: 'Rol inválido. Use ADMIN, SELLER o WAREHOUSE' });
    }

    const existing = await get('SELECT id FROM users WHERE email = ?', [email.trim()]);
    if (existing) {
      return res.status(409).json({ message: 'Ya existe un usuario con ese email' });
    }

    const id = uuidv4();
    const commission = commissionPercentage != null ? Number(commissionPercentage) : 0;
    await execute(
      `INSERT INTO users (id, name, email, password, role, commission_percentage) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, name.trim(), email.trim(), password, roleVal, commission]
    );

    const created = await get(
      `SELECT id, name, email, role, commission_percentage AS commissionPercentage FROM users WHERE id = ?`,
      [id]
    );
    res.status(201).json(created);
  } catch (error: any) {
    console.error('createUser:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Ya existe un usuario con ese email' });
    }
    res.status(500).json({ message: 'Error creando usuario' });
  }
};

/** Eliminar usuario. Solo ADMIN. No se puede eliminar a uno mismo. */
export const deleteUser = async (req: Request, res: Response) => {
  try {
    if ((req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Solo administradores pueden eliminar usuarios' });
    }
    const { id } = req.params;
    const currentUserId = (req as any).user?.id;
    if (currentUserId && currentUserId === id) {
      return res.status(400).json({ message: 'No podés eliminarte a vos mismo' });
    }
    if (!id) return res.status(400).json({ message: 'ID de usuario requerido' });

    const existing = await get('SELECT id FROM users WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    await execute('DELETE FROM users WHERE id = ?', [id]);
    res.json({ message: 'Usuario eliminado', id });
  } catch (error: any) {
    console.error('deleteUser:', error);
    res.status(500).json({ message: 'Error eliminando usuario' });
  }
};
