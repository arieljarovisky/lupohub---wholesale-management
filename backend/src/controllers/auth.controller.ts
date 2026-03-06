import { Request, Response } from 'express';
import { get } from '../database/db';
import jwt from 'jsonwebtoken';

const JWT_SECRET = () => process.env.JWT_SECRET || 'devsecret';
/** Duración del token: 30 días (no expira cada 2h). */
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';
/** Ventana para refrescar: si el token expiró hace menos de 7 días, se puede renovar. */
const REFRESH_GRACE_DAYS = 7;

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    return res.status(400).json({ message: 'Email y contraseña son requeridos' });
  }

  try {
    const user = await get(
      'SELECT id, name, email, role, commission_percentage AS commissionPercentage, password FROM users WHERE email = ?',
      [email]
    );

    if (!user) {
      return res.status(401).json({ message: 'Usuario no encontrado' });
    }
    if (String(user.password) !== String(password)) {
      return res.status(401).json({ message: 'Contraseña incorrecta' });
    }

    const { password: _pwd, ...safeUser } = user;
    const secret = JWT_SECRET();
    const token = jwt.sign(
      { id: safeUser.id, email: safeUser.email, role: safeUser.role },
      secret,
      { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
    );
    return res.json({ user: safeUser, token });
  } catch (error) {
    return res.status(500).json({ message: 'Error al autenticar' });
  }
};

/** Refresca el token: acepta el token actual (incluso recién expirado) y devuelve uno nuevo. */
export const refreshToken = async (req: Request, res: Response) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) {
    return res.status(401).json({ message: 'Token no enviado' });
  }

  try {
    const secret = JWT_SECRET();
    const decoded = jwt.verify(token, secret, { ignoreExpiration: true }) as { id?: string; email?: string; role?: string; exp?: number };
    if (!decoded?.id || !decoded?.email) {
      return res.status(401).json({ message: 'Token inválido' });
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const exp = decoded.exp ?? 0;
    if (exp < nowSec - REFRESH_GRACE_DAYS * 24 * 3600) {
      return res.status(401).json({ message: 'Token vencido hace demasiado tiempo; volvé a iniciar sesión' });
    }

    const user = await get(
      'SELECT id, name, email, role, commission_percentage AS commissionPercentage FROM users WHERE id = ?',
      [decoded.id]
    );
    if (!user) {
      return res.status(401).json({ message: 'Usuario no encontrado' });
    }

    const newToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      secret,
      { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
    );
    return res.json({ token: newToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, commissionPercentage: user.commissionPercentage } });
  } catch {
    return res.status(401).json({ message: 'Token inválido' });
  }
};
