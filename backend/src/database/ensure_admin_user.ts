/**
 * Asegura que exista un usuario admin (para producción y desarrollo).
 * En producción usa ADMIN_EMAIL y ADMIN_PASSWORD; en desarrollo usa valores por defecto si no están definidos.
 */
import { v4 as uuidv4 } from 'uuid';
import { execute, get } from './db';

const DEFAULT_ADMIN_EMAIL = 'admin@lupohub.com';
const DEFAULT_ADMIN_PASSWORD = 'admin123';
const ADMIN_ROLE = 'ADMIN';

export async function ensureAdminUser(): Promise<void> {
  const isProd = process.env.NODE_ENV === 'production';
  const email = process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD || (isProd ? '' : DEFAULT_ADMIN_PASSWORD);

  if (isProd && !process.env.ADMIN_PASSWORD) {
    console.log('[DB] ADMIN_PASSWORD no definido en producción; no se crea usuario admin. Definí ADMIN_EMAIL y ADMIN_PASSWORD en Railway.');
    return;
  }

  try {
    const existing = await get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      console.log('[DB] Usuario admin ya existe:', email);
      return;
    }

    const id = uuidv4();
    await execute(
      `INSERT INTO users (id, name, email, password, role, commission_percentage) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, 'Administrador', email, password, ADMIN_ROLE, 0]
    );
    console.log('[DB] Usuario admin creado:', email, isProd ? '(producción)' : '(desarrollo)');
  } catch (err: any) {
    console.error('[DB] Error creando usuario admin:', err?.message);
  }
}
