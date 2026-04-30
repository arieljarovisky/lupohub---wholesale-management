import { Request, Response } from 'express';
import { get, query, execute } from '../database/db';
import { v4 as uuidv4 } from 'uuid';

const TASKS_OWNER_EMAIL = 'ariel@lupo.ar';

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function isTasksOwner(req: Request): boolean {
  const email = normalizeEmail((req as any)?.user?.email);
  return email === TASKS_OWNER_EMAIL;
}

export const getMyUserTasks = async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail((req as any)?.user?.email);
    if (!email) return res.status(401).json({ message: 'Sesión inválida' });
    const rows = await query(
      `SELECT id, message, assigned_to_email AS assignedToEmail, created_by_email AS createdByEmail, expires_at AS expiresAt, created_at AS createdAt
       FROM user_tasks
       WHERE assigned_to_email = ? AND expires_at > NOW()
       ORDER BY expires_at ASC, created_at DESC`,
      [email]
    );
    res.json(rows);
  } catch (error: any) {
    console.error('getMyUserTasks:', error);
    res.status(500).json({ message: 'Error obteniendo tareas' });
  }
};

export const listAssignedUserTasks = async (req: Request, res: Response) => {
  try {
    if (!isTasksOwner(req)) return res.status(403).json({ message: 'Sin permiso' });
    const rows = await query(
      `SELECT id, message, assigned_to_email AS assignedToEmail, created_by_email AS createdByEmail, expires_at AS expiresAt, created_at AS createdAt
       FROM user_tasks
       ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (error: any) {
    console.error('listAssignedUserTasks:', error);
    res.status(500).json({ message: 'Error listando tareas' });
  }
};

export const createAssignedUserTask = async (req: Request, res: Response) => {
  try {
    if (!isTasksOwner(req)) return res.status(403).json({ message: 'Sin permiso' });
    const message = String(req.body?.message || '').trim();
    const assignedToEmail = normalizeEmail(req.body?.assignedToEmail);
    const expiresAt = String(req.body?.expiresAt || '').trim();
    if (!message) return res.status(400).json({ message: 'La tarea no puede estar vacía' });
    if (!assignedToEmail || !assignedToEmail.includes('@')) {
      return res.status(400).json({ message: 'assignedToEmail inválido' });
    }
    if (!expiresAt) return res.status(400).json({ message: 'expiresAt es obligatorio' });
    const expiresDate = new Date(expiresAt);
    if (isNaN(expiresDate.getTime())) return res.status(400).json({ message: 'expiresAt inválido' });
    if (expiresDate.getTime() <= Date.now()) return res.status(400).json({ message: 'La fecha de fin debe ser futura' });

    const id = uuidv4();
    const creator = (req as any)?.user || {};
    const createdByEmail = normalizeEmail(creator.email);
    const createdByUserId = creator.id || null;
    await execute(
      `INSERT INTO user_tasks (id, message, assigned_to_email, created_by_user_id, created_by_email, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, message, assignedToEmail, createdByUserId, createdByEmail, expiresDate]
    );
    const created = await get(
      `SELECT id, message, assigned_to_email AS assignedToEmail, created_by_email AS createdByEmail, expires_at AS expiresAt, created_at AS createdAt
       FROM user_tasks WHERE id = ?`,
      [id]
    );
    res.status(201).json(created);
  } catch (error: any) {
    console.error('createAssignedUserTask:', error);
    res.status(500).json({ message: 'Error creando tarea' });
  }
};

export const deleteAssignedUserTask = async (req: Request, res: Response) => {
  try {
    if (!isTasksOwner(req)) return res.status(403).json({ message: 'Sin permiso' });
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'ID inválido' });
    await execute('DELETE FROM user_tasks WHERE id = ?', [id]);
    res.json({ id });
  } catch (error: any) {
    console.error('deleteAssignedUserTask:', error);
    res.status(500).json({ message: 'Error eliminando tarea' });
  }
};
