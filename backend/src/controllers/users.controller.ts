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
      `SELECT id, name, email, role, commission_percentage AS commissionPercentage,
              CASE WHEN role = 'SELLER' THEN NULL ELSE price_list_id END AS priceListId
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
    const validRoles = ['ADMIN', 'SELLER', 'WAREHOUSE', 'CUSTOMER'];
    const roleVal = (role || 'SELLER').toString().toUpperCase();
    if (!validRoles.includes(roleVal)) {
      return res.status(400).json({ message: 'Rol inválido. Use ADMIN, SELLER, WAREHOUSE o CUSTOMER' });
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

    if (roleVal === 'CUSTOMER') {
      const customerId = uuidv4();
      await execute(
        `INSERT INTO customers (id, user_id, seller_id, name, business_name, email, address, city) VALUES (?, ?, NULL, ?, ?, ?, NULL, NULL)`,
        [customerId, id, name.trim(), name.trim(), email.trim()]
      );
    }

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

type SellerImportBodyRow = {
  name?: string;
  email?: string;
  password?: string;
  commissionPercentage?: number;
};

/** Importar vendedores (rol SELLER) en lote. Solo ADMIN. */
export const importSellers = async (req: Request, res: Response) => {
  try {
    if ((req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Solo administradores pueden importar vendedores' });
    }
    const body = req.body as { sellers?: SellerImportBodyRow[]; defaultPassword?: string };
    const rows = Array.isArray(body.sellers) ? body.sellers : [];
    const defaultPassword = (body.defaultPassword ?? '').toString();
    if (rows.length === 0) {
      return res.status(400).json({ message: 'Enviá un array sellers con al menos una fila' });
    }
    if (!defaultPassword || defaultPassword.length < 4) {
      return res.status(400).json({
        message: 'Definí defaultPassword (mínimo 4 caracteres) para las filas sin contraseña propia'
      });
    }

    let created = 0;
    let skipped = 0;
    const errors: { row: number; email?: string; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const name = (r.name ?? '').toString().trim();
      const email = (r.email ?? '').toString().trim().toLowerCase();
      const rowNum = i + 1;
      if (!name) {
        errors.push({ row: rowNum, message: 'Falta nombre' });
        continue;
      }
      if (!email || !email.includes('@')) {
        errors.push({ row: rowNum, message: 'Email inválido o faltante' });
        continue;
      }
      const password = (r.password ?? '').toString().trim() || defaultPassword;
      const commission =
        r.commissionPercentage != null && Number.isFinite(Number(r.commissionPercentage))
          ? Math.min(100, Math.max(0, Number(r.commissionPercentage)))
          : 0;

      const existing = await get('SELECT id FROM users WHERE email = ?', [email]);
      if (existing) {
        skipped++;
        continue;
      }

      const id = uuidv4();
      try {
        await execute(
          `INSERT INTO users (id, name, email, password, role, commission_percentage) VALUES (?, ?, ?, ?, 'SELLER', ?)`,
          [id, name, email, password, commission]
        );
        created++;
      } catch (e: any) {
        if (e?.code === 'ER_DUP_ENTRY') {
          skipped++;
        } else {
          errors.push({ row: rowNum, email, message: e?.message || 'Error insertando' });
        }
      }
    }

    res.json({
      message: 'Importación de vendedores finalizada',
      created,
      skipped,
      errors: errors.slice(0, 30),
      errorCount: errors.length
    });
  } catch (error: any) {
    console.error('importSellers:', error);
    res.status(500).json({ message: 'Error importando vendedores', detail: error?.message });
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
    await execute('UPDATE customers SET user_id = NULL WHERE user_id = ?', [id]);
    res.json({ message: 'Usuario eliminado', id });
  } catch (error: any) {
    console.error('deleteUser:', error);
    res.status(500).json({ message: 'Error eliminando usuario' });
  }
};

/** Actualizar usuario (price_list_id solo para roles que no sean SELLER). Solo ADMIN. */
export const updateUser = async (req: Request, res: Response) => {
  try {
    if ((req as any).user?.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Solo administradores pueden actualizar usuarios' });
    }
    const { id } = req.params;
    const body = req.body as {
      priceListId?: string | null;
      commissionPercentage?: number | null;
      email?: string;
      password?: string;
    };
    const existing = await get('SELECT id, role FROM users WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ message: 'Usuario no encontrado' });
    const userRole = String((existing as { role?: string }).role ?? '');

    let didUpdate = false;
    if (body.priceListId !== undefined) {
      if (userRole === 'SELLER') {
        await execute('UPDATE users SET price_list_id = NULL WHERE id = ?', [id]);
      } else {
        const plId = body.priceListId && body.priceListId.trim() ? body.priceListId.trim() : null;
        await execute('UPDATE users SET price_list_id = ? WHERE id = ?', [plId, id]);
      }
      didUpdate = true;
    }
    if (body.commissionPercentage !== undefined) {
      const commission = Number(body.commissionPercentage);
      if (!Number.isFinite(commission) || commission < 0 || commission > 100) {
        return res.status(400).json({ message: 'commissionPercentage debe estar entre 0 y 100' });
      }
      await execute('UPDATE users SET commission_percentage = ? WHERE id = ?', [commission, id]);
      didUpdate = true;
    }
    if (body.email !== undefined) {
      if (userRole !== 'SELLER') {
        return res.status(400).json({ message: 'Solo se puede editar email de vendedores desde esta pantalla' });
      }
      const nextEmail = String(body.email || '').trim().toLowerCase();
      if (!nextEmail || !nextEmail.includes('@')) {
        return res.status(400).json({ message: 'Email inválido' });
      }
      const existingEmail = await get('SELECT id FROM users WHERE email = ? AND id <> ?', [nextEmail, id]);
      if (existingEmail) {
        return res.status(409).json({ message: 'Ya existe un usuario con ese email' });
      }
      await execute('UPDATE users SET email = ? WHERE id = ?', [nextEmail, id]);
      didUpdate = true;
    }
    if (body.password !== undefined) {
      if (userRole !== 'SELLER') {
        return res.status(400).json({ message: 'Solo se puede editar contraseña de vendedores desde esta pantalla' });
      }
      const nextPassword = String(body.password || '');
      if (nextPassword.length < 4) {
        return res.status(400).json({ message: 'La contraseña debe tener al menos 4 caracteres' });
      }
      await execute('UPDATE users SET password = ? WHERE id = ?', [nextPassword, id]);
      didUpdate = true;
    }
    if (didUpdate && userRole === 'SELLER') {
      await execute('UPDATE users SET price_list_id = NULL WHERE id = ?', [id]);
    }
    if (!didUpdate) {
      return res.status(400).json({ message: 'No hay campos para actualizar' });
    }
    const updated = await get(
      `SELECT id, name, email, role, commission_percentage AS commissionPercentage,
              CASE WHEN role = 'SELLER' THEN NULL ELSE price_list_id END AS priceListId
       FROM users WHERE id = ?`,
      [id]
    );
    res.json(updated);
  } catch (error: any) {
    console.error('updateUser:', error);
    res.status(500).json({ message: 'Error actualizando usuario' });
  }
};
